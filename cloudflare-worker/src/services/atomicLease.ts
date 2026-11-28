/**
 * D9205 (#9205): the minute cron's queue lease and the fail-closed rate-limit
 * counters, taken atomically in the existing `AiGovernor` Durable Object
 * instead of a KV read followed by a KV write.
 *
 * KV is eventually consistent (a read can be served from cache for about 60
 * seconds) and accepts about one write per second per key. With get-then-put,
 * two ticks could both take `cron:queue:lease`, a tick could still see a
 * released lease and skip its minute, and two requests could read the same
 * count and both pass a fail-closed bucket. A Durable Object applies its calls
 * one at a time over its own storage, so take, release and bump are each one
 * read-modify-write nobody else can interleave.
 *
 *   - The cron lease is one object, `cron-lease:cron:queue:lease`, holding the
 *     D201 lease-holder value (`leaseHolderValue`) and its expiry, 90 seconds
 *     as before. `take` sets it only when it is free or expired and otherwise
 *     returns the holder, so the `deduped` / `skipped` record is unchanged.
 *     `release` clears it only for the holder that took it.
 *   - A fail-closed bucket's counter is one object per bucket and scope
 *     (`rate-counter:rl:<scope>:<bucket>`), holding the current window and its
 *     count. A request in a newer window starts it at 1. An alarm clears the
 *     counter after its window ends, so idle callers leave nothing behind.
 *
 * The pure functions below are applied by `durable-objects/ai-governor.ts`.
 * The clients throw on any answer the object cannot give. The callers keep
 * their policies: the cron runs its tick on a failed take (as it did on a
 * failed KV read) and a fail-closed bucket refuses with 503.
 *
 * With no `AI_GOVERNOR` binding (unit tests, a local `wrangler dev` without
 * Durable Objects) the callers use the KV path they used before. Every
 * deployed environment in wrangler.toml binds `AI_GOVERNOR`.
 */
import type { Env } from '../types';
import { doNamespace } from '../util/doNamespace';

/** The lease's life, as the KV lease's `expirationTtl: 90`. */
export const CRON_LEASE_TTL_MS = 90_000;
/** The one lease every trigger shares (D201): one queue drain at a time. */
export const CRON_LEASE_NAME = 'cron:queue:lease';
export const cronLeaseObjectName = (lease: string) => `cron-lease:${lease}`;
export const counterObjectName = (counter: string) => `rate-counter:${counter}`;

/** The storage keys inside the object. */
export const CRON_LEASE_KEY = 'cron-lease';
export const COUNTER_KEY = 'counter';

export type CronLeaseState = { holder: string; expiresAt: number } | null;
export type CounterState = { window: number; count: number; endsAt: number } | null;

export function readCronLease(v: unknown): CronLeaseState {
  const s = v as any;
  return s && typeof s.holder === 'string' && Number.isFinite(s.expiresAt) ? { holder: s.holder, expiresAt: s.expiresAt } : null;
}

export function readCounter(v: unknown): CounterState {
  const s = v as any;
  return s && Number.isFinite(s.window) && Number.isFinite(s.count) && Number.isFinite(s.endsAt)
    ? { window: s.window, count: s.count, endsAt: s.endsAt }
    : null;
}

/** Take the lease when it is free or expired; otherwise say who holds it. */
export function takeLease(s: CronLeaseState, holder: string, now: number, ttlMs = CRON_LEASE_TTL_MS):
  { state: CronLeaseState; out: { taken: true } | { taken: false; heldBy: string } } {
  if (s && s.expiresAt > now) return { state: s, out: { taken: false, heldBy: s.holder } };
  return { state: { holder, expiresAt: now + ttlMs }, out: { taken: true } };
}

/** Release the lease only for the holder that took it. */
export function releaseLease(s: CronLeaseState, holder: string): { state: CronLeaseState; out: { released: boolean } } {
  if (s && s.holder === holder) return { state: null, out: { released: true } };
  return { state: s, out: { released: false } };
}

/**
 * Count one request in `window` (a minute or hour index). A newer window
 * starts at 1; an older one (a clock a little behind another isolate's) is
 * counted in the stored, newer window, never resetting it.
 */
export function bumpWindow(s: CounterState, window: number, windowSec: number): { state: CounterState; out: { count: number } } {
  if (!s || window > s.window) {
    const state = { window, count: 1, endsAt: (window + 1) * windowSec * 1000 };
    return { state, out: { count: 1 } };
  }
  const state = { ...s, count: s.count + 1 };
  return { state, out: { count: state.count } };
}

function stub(env: Env, name: string) {
  const ns = doNamespace(env, env.AI_GOVERNOR!);
  return ns.get(ns.idFromName(name));
}

async function call(env: Env, name: string, path: string, body: unknown): Promise<any> {
  const r = await stub(env, name).fetch(`https://ai-governor${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`ai_governor_${r.status}`);
  return r.json();
}

/** Take the cron lease. Returns the holder that has it when this tick did not get it. */
export async function takeCronLease(env: Env, holder: string): Promise<{ taken: true } | { taken: false; heldBy: string }> {
  const r = await call(env, cronLeaseObjectName(CRON_LEASE_NAME), '/cron-lease/take', { holder, ttlMs: CRON_LEASE_TTL_MS });
  if (r?.taken === true) return { taken: true };
  if (r?.taken === false && typeof r.heldBy === 'string') return { taken: false, heldBy: r.heldBy };
  throw new Error('ai_governor_bad_reply');
}

/** Release the cron lease if this holder still has it. */
export async function releaseCronLease(env: Env, holder: string): Promise<boolean> {
  const r = await call(env, cronLeaseObjectName(CRON_LEASE_NAME), '/cron-lease/release', { holder });
  return r?.released === true;
}

/** Count one request on a fail-closed bucket's counter and return the count in this window. */
export async function bumpAtomicCounter(env: Env, counter: string, window: number, windowSec: number): Promise<number> {
  const r = await call(env, counterObjectName(counter), '/counter/bump', { window, windowSec });
  if (!Number.isSafeInteger(r?.count) || r.count < 1) throw new Error('ai_governor_bad_reply');
  return r.count;
}
