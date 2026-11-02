/**
 * D1502 part 2 (#3753, deck v2 A3a): the `AiGovernor` — per-step throttles for a
 * deck generation run, and the backoff a busy model gets.
 *
 * The caps are THROTTLES on steps, never a ceiling on a run's size (#3753 spec
 * change 3). A whole-deck run of 40 areas is admitted whole; its steps queue
 * here and start as the account's slots free:
 *   - at most `KIND_CAPS[kind]` steps of a kind running at once per account
 *     (image 3, text 6, vision 4; a guard, critique or retry counts as text);
 *   - at most `ACCOUNT_RUNS` (2) of the account's runs drawing steps at once;
 *   - a token bucket per model per account (`BUCKET_CAPACITY` steps, refilled
 *     at `BUCKET_REFILL_PER_S`), guard calls counted like any other.
 * A lease that is never released expires after `LEASE_TTL_MS`, so a driver
 * that died holds nothing for long.
 *
 * Busy models: a 429, or Workers AI's 3040 ("capacity temporarily exceeded"),
 * backs off with jitter (`backoffMs`) and retries `MAX_BUSY_RETRIES` times;
 * then the step falls back within the same tier, the element's other
 * suggestions (D1503's `chain`), and the step records `fallback_used`.
 *
 * `Governor` is pure and in memory. The `AiGovernor` Durable Object
 * (`durable-objects/ai-governor.ts`) holds one per account; `governorFor`
 * talks to it, or to an in-process one where the binding is absent (tests, a
 * local dev Worker).
 */
import type { Env } from '../../types';
import { doNamespace } from '../../util/doNamespace';

export const KIND_CAPS: Readonly<Record<'image' | 'text' | 'vision', number>> = Object.freeze({ image: 3, text: 6, vision: 4 });
export const ACCOUNT_RUNS = 2;
export const BUCKET_CAPACITY = 20;
export const BUCKET_REFILL_PER_S = 20 / 60;
export const LEASE_TTL_MS = 120_000;
export const MAX_BUSY_RETRIES = 2;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 20_000;

export type CapKind = keyof typeof KIND_CAPS;
/** The throttle a step's kind falls under: a draw or an edit is an image, a screen is vision, the rest is text. */
export function capKindOf(kind: string): CapKind {
  if (kind === 'image' || kind === 'draw' || kind === 'edit_image') return 'image';
  if (kind === 'vision' || kind === 'screen') return 'vision';
  return 'text';
}

export type AcquireInput = { account: number; run: string; kind: string; model: string | null };
export type Lease = { id: string; account: number; run: string; kind: CapKind; model: string | null; expires: number };
export type Acquired = { ok: true; lease: Lease } | { ok: false; wait_ms: number; reason: 'kind_cap' | 'account_runs' | 'model_bucket' };

type Bucket = { tokens: number; at: number };

export class Governor {
  private leases = new Map<string, Lease>();
  private buckets = new Map<string, Bucket>();
  private seq = 0;

  private sweep(now: number) {
    for (const [id, l] of this.leases) if (l.expires <= now) this.leases.delete(id);
  }

  acquire(input: AcquireInput, now = Date.now()): Acquired {
    this.sweep(now);
    const kind = capKindOf(input.kind);
    const mine = [...this.leases.values()].filter((l) => l.account === input.account);
    const runs = new Set(mine.map((l) => l.run));
    if (!runs.has(input.run) && runs.size >= ACCOUNT_RUNS) return { ok: false, wait_ms: 1_000, reason: 'account_runs' };
    if (mine.filter((l) => l.kind === kind).length >= KIND_CAPS[kind]) return { ok: false, wait_ms: 500, reason: 'kind_cap' };
    if (input.model) {
      const key = `${input.account}|${input.model}`;
      const b = this.buckets.get(key) ?? { tokens: BUCKET_CAPACITY, at: now };
      const tokens = Math.min(BUCKET_CAPACITY, b.tokens + ((now - b.at) / 1000) * BUCKET_REFILL_PER_S);
      if (tokens < 1) {
        this.buckets.set(key, { tokens, at: now });
        return { ok: false, wait_ms: Math.ceil(((1 - tokens) / BUCKET_REFILL_PER_S) * 1000), reason: 'model_bucket' };
      }
      this.buckets.set(key, { tokens: tokens - 1, at: now });
    }
    const lease: Lease = { id: `lease-${++this.seq}`, account: input.account, run: input.run, kind, model: input.model, expires: now + LEASE_TTL_MS };
    this.leases.set(lease.id, lease);
    return { ok: true, lease };
  }

  release(id: string): boolean {
    return this.leases.delete(id);
  }

  /** What the account holds now, for the status read and the tests. */
  held(account: number, now = Date.now()): { runs: number; image: number; text: number; vision: number } {
    this.sweep(now);
    const mine = [...this.leases.values()].filter((l) => l.account === account);
    return {
      runs: new Set(mine.map((l) => l.run)).size,
      image: mine.filter((l) => l.kind === 'image').length,
      text: mine.filter((l) => l.kind === 'text').length,
      vision: mine.filter((l) => l.kind === 'vision').length,
    };
  }
}

/** Exponential backoff with jitter: half the step, plus up to half again at random. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(step / 2 + random() * (step / 2));
}

/** A model that said "busy": an HTTP 429, or Workers AI's 3040. */
export function isBusy(f: { status?: number | null; code?: number | null } | null | undefined): boolean {
  return !!f && (f.status === 429 || f.code === 3040);
}

export type GovernorClient = {
  acquire(input: AcquireInput): Promise<Acquired>;
  release(id: string): Promise<void>;
};

const LOCAL = new Map<number, Governor>();
function localGovernor(account: number): Governor {
  let g = LOCAL.get(account);
  if (!g) { g = new Governor(); LOCAL.set(account, g); }
  return g;
}
/** Tests only: forget the in-process governors. */
export function __resetGovernorsForTest() { LOCAL.clear(); }

/** The account's governor: its Durable Object where bound, else one in this isolate. */
export function governorFor(env: Env, account: number): GovernorClient {
  if (!env.AI_GOVERNOR) {
    const g = localGovernor(account);
    return { acquire: async (i) => g.acquire(i), release: async (id) => { g.release(id); } };
  }
  // D264: under the branch's Durable Object jurisdiction, never an unrestricted one.
  const ns = doNamespace(env, env.AI_GOVERNOR);
  const stub = ns.get(ns.idFromName(`account:${account}`));
  const call = async (path: string, body: unknown) => {
    const r = await stub.fetch(`https://ai-governor${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`ai_governor_${r.status}`);
    return r.json();
  };
  return {
    acquire: async (i) => (await call('/acquire', i)) as Acquired,
    release: async (id) => { await call('/release', { id }); },
  };
}

/** Waits for a slot, polling the governor; gives up (null) after `maxWaitMs`. */
export async function waitForSlot(
  gov: GovernorClient, input: AcquireInput,
  opts: { sleep: (ms: number) => Promise<void>; maxWaitMs?: number; onWait?: (reason: string, ms: number) => void | Promise<void> },
): Promise<Lease | null> {
  let waited = 0;
  const max = opts.maxWaitMs ?? 10 * 60_000;
  for (;;) {
    const a = await gov.acquire(input);
    if (a.ok) return a.lease;
    if (waited >= max) return null;
    const ms = Math.min(a.wait_ms, 5_000);
    await opts.onWait?.(a.reason, ms);
    await opts.sleep(ms);
    waited += ms;
  }
}
