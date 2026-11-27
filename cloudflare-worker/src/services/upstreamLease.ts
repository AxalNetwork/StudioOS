/**
 * D5338 (#5338): the admission lease for SHARED UPSTREAM CAPACITY — one AI
 * Gateway and the models behind it, across every tenant and product that
 * calls it. It sits behind `runGatewayTextModel`'s `deps.admit` seam (D4556
 * §8) and is held in the existing `AiGovernor` Durable Object, under one
 * object per gateway (`upstream-lease:<slug>`), in that object's durable
 * storage. It is a throttle only: the D1 hold and settlement (D844) stay the
 * only financial authority, and tenant fairness for deck steps stays the
 * per-account governor's (`services/decks/aiGovernor.ts`).
 *
 * What it enforces, per gateway (`UPSTREAM_LIMITS`, sources in D5338 §4):
 *   - at most `modelConcurrent` executions of one model at once, and at most
 *     `tenantConcurrent` of them for one tenant, so a noisy tenant cannot take
 *     every slot;
 *   - at most `windowRequests` upstream requests in a sliding `windowMs`, and
 *     at most `tenantWindowRequests` of them for one tenant. The first request
 *     is counted at admission; every retry is counted by `attempt` under the
 *     SAME lease, so retries never amplify past the window.
 *
 * Restart safety. The state lives in Durable Object storage, so an eviction,
 * a restart or a deploy reads back every outstanding lease. Each lease has a
 * fresh random token; release and attempt name it, so a late or duplicate
 * release of a lease that expired or was replaced frees nothing. A lease
 * expires `LEASE_TTL_MS` after its last admission or attempt, which is longer
 * than the gateway run's own ceiling, so a live call never loses its slot. A
 * run that ended with its completion unknown (a timeout: the provider may
 * still be working) keeps its slot until that expiry instead of freeing it.
 *
 * The functions here are pure over a state object; the Durable Object reads,
 * applies and writes it. `upstreamAdmission` is the client: with no
 * `AI_GOVERNOR` binding it refuses. There is no in-memory fallback.
 */
import type { Env } from '../types';
import { doNamespace } from '../util/doNamespace';

/**
 * The limits applied, per gateway. `windowRequests` is 150 of the 200 requests
 * per 60 seconds per gateway that Cloudflare publishes for Unified Billing
 * (read 2026-11-10, https://developers.cloudflare.com/ai-gateway/reference/limits/):
 * a published limit, not a capacity promise, so the lease keeps a margin
 * below it. The concurrency figures are Axal's own policy: no concurrency
 * limit is published for `openai/gpt-5-mini` on its catalogue page (read
 * 2026-11-10), and none has been measured.
 */
export const UPSTREAM_LIMITS = Object.freeze({
  windowMs: 60_000,
  windowRequests: 150,
  tenantWindowRequests: 50,
  modelConcurrent: 8,
  tenantConcurrent: 2,
});
export type UpstreamLimits = typeof UPSTREAM_LIMITS;

/**
 * A lease's life after its last admission or attempt. Longer than the gateway
 * run's ceiling (`GATEWAY_MAX_ATTEMPTS * GATEWAY_ATTEMPT_TIMEOUT_MS +
 * GATEWAY_RETRY_BUDGET_MS + 30 s` = 124 s, the metered run's own timeout),
 * which a test holds, so a lease can only expire under a run that has
 * already given up or died.
 */
export const LEASE_TTL_MS = 180_000;
/** How long a refused admission polls the governor before it answers `capacity_unavailable`. */
export const ADMIT_MAX_WAIT_MS = 5_000;
/** The poll interval while every slot of the model is held (a release is not announced). */
export const SLOT_POLL_MS = 500;

export type UpstreamLease = {
  token: string; execution: string; tenant: string; product: string; model: string;
  acquired: number; expires: number;
  /** Set once released with the completion unknown: the slot stays held until `expires`. */
  unknown?: true;
};
export type UpstreamState = { v: 1; leases: UpstreamLease[]; requests: Array<{ at: number; tenant: string }> };
export const emptyUpstreamState = (): UpstreamState => ({ v: 1, leases: [], requests: [] });

export type UpstreamRefusalReason = 'model_full' | 'tenant_share' | 'window_full' | 'tenant_window' | 'execution_held' | 'lease_gone';
export type UpstreamAcquireInput = { execution: string; tenant: string; product: string; model: string };
export type UpstreamAcquired =
  | { ok: true; token: string; expires: number }
  | { ok: false; reason: UpstreamRefusalReason; wait_ms: number };
export type Completion = 'done' | 'none' | 'unknown';

/** A stored value read back as a state: anything unreadable is an empty state, never a crash. */
export function readUpstreamState(raw: unknown): UpstreamState {
  const s = raw as Partial<UpstreamState> | null | undefined;
  if (!s || s.v !== 1 || !Array.isArray(s.leases) || !Array.isArray(s.requests)) return emptyUpstreamState();
  return { v: 1, leases: s.leases.filter((l) => l && typeof l.token === 'string' && Number.isFinite(l.expires)), requests: s.requests.filter((r) => r && Number.isFinite(r.at)) };
}

/** Drops expired leases and requests outside the window. */
export function reap(s: UpstreamState, now: number, limits: UpstreamLimits = UPSTREAM_LIMITS): UpstreamState {
  return { v: 1, leases: s.leases.filter((l) => l.expires > now), requests: s.requests.filter((r) => r.at > now - limits.windowMs) };
}

/** The wait until the window frees one request, for `tenant` or for everyone. */
function windowWait(reqs: UpstreamState['requests'], now: number, limits: UpstreamLimits): number {
  const oldest = reqs.reduce((m, r) => Math.min(m, r.at), Infinity);
  return Number.isFinite(oldest) ? Math.max(1, oldest + limits.windowMs - now) : 1;
}

/** Room for one more upstream request from `tenant`, or why not. */
function windowRefusal(s: UpstreamState, tenant: string, now: number, limits: UpstreamLimits): UpstreamAcquired | null {
  if (s.requests.length >= limits.windowRequests) return { ok: false, reason: 'window_full', wait_ms: windowWait(s.requests, now, limits) };
  const mine = s.requests.filter((r) => r.tenant === tenant);
  if (mine.length >= limits.tenantWindowRequests) return { ok: false, reason: 'tenant_window', wait_ms: windowWait(mine, now, limits) };
  return null;
}

export function acquireUpstream(
  state: UpstreamState, input: UpstreamAcquireInput, now: number, token: string, limits: UpstreamLimits = UPSTREAM_LIMITS,
): { state: UpstreamState; result: UpstreamAcquired } {
  const s = reap(state, now, limits);
  const refuse = (result: UpstreamAcquired) => ({ state: s, result });
  // One execution, one lease: a second admission under the same id waits for the first to end.
  if (s.leases.some((l) => l.execution === input.execution)) return refuse({ ok: false, reason: 'execution_held', wait_ms: SLOT_POLL_MS });
  const model = s.leases.filter((l) => l.model === input.model);
  if (model.length >= limits.modelConcurrent) return refuse({ ok: false, reason: 'model_full', wait_ms: SLOT_POLL_MS });
  if (model.filter((l) => l.tenant === input.tenant).length >= limits.tenantConcurrent) return refuse({ ok: false, reason: 'tenant_share', wait_ms: SLOT_POLL_MS });
  const w = windowRefusal(s, input.tenant, now, limits);
  if (w) return refuse(w);
  const lease: UpstreamLease = { token, execution: input.execution, tenant: input.tenant, product: input.product, model: input.model, acquired: now, expires: now + LEASE_TTL_MS };
  return {
    state: { v: 1, leases: [...s.leases, lease], requests: [...s.requests, { at: now, tenant: input.tenant }] },
    result: { ok: true, token, expires: lease.expires },
  };
}

/** One more upstream request (a retry) under a live lease: counted in the window, and the lease renewed. */
export function attemptUpstream(
  state: UpstreamState, token: string, now: number, limits: UpstreamLimits = UPSTREAM_LIMITS,
): { state: UpstreamState; result: UpstreamAcquired } {
  const s = reap(state, now, limits);
  const lease = s.leases.find((l) => l.token === token && !l.unknown);
  if (!lease) return { state: s, result: { ok: false, reason: 'lease_gone', wait_ms: 0 } };
  const w = windowRefusal(s, lease.tenant, now, limits);
  if (w) return { state: s, result: w };
  const expires = now + LEASE_TTL_MS;
  return {
    state: { v: 1, leases: s.leases.map((l) => (l === lease ? { ...l, expires } : l)), requests: [...s.requests, { at: now, tenant: lease.tenant }] },
    result: { ok: true, token, expires },
  };
}

/**
 * Ends a lease by its token. Only the live lease that token names is touched:
 * an expired, replaced, unknown or already-released token frees nothing. With
 * the completion unknown the slot stays held until the lease's own expiry.
 */
export function releaseUpstream(
  state: UpstreamState, token: string, completion: Completion, now: number, limits: UpstreamLimits = UPSTREAM_LIMITS,
): { state: UpstreamState; released: boolean } {
  const s = reap(state, now, limits);
  const lease = s.leases.find((l) => l.token === token && !l.unknown);
  if (!lease) return { state: s, released: false };
  const leases = completion === 'unknown'
    ? s.leases.map((l) => (l === lease ? { ...l, unknown: true as const } : l))
    : s.leases.filter((l) => l !== lease);
  return { state: { v: 1, leases, requests: s.requests }, released: true };
}

/** What the gateway holds now, for the tests and a status read. Counts only; no execution ids leave the object. */
export function upstreamHeld(state: UpstreamState, now: number, limits: UpstreamLimits = UPSTREAM_LIMITS) {
  const s = reap(state, now, limits);
  const byTenant: Record<string, number> = {};
  for (const l of s.leases) byTenant[l.tenant] = (byTenant[l.tenant] ?? 0) + 1;
  return { leases: s.leases.length, unknown: s.leases.filter((l) => l.unknown).length, requests: s.requests.length, byTenant };
}

// ─────────────────────────────────── the client behind `deps.admit`

/** The lease the gateway run holds: retries go through `attempt`, and `release` says how the run ended. */
export type UpstreamAdmitted = {
  ok: true;
  release: (end?: { completion: Completion }) => Promise<void>;
  attempt: () => Promise<boolean>;
};
export type UpstreamAdmissionRequest = { gatewaySlug: string; userId: number; model: string; task: string; executionId: string };
export type UpstreamAdmission = (req: UpstreamAdmissionRequest) => Promise<UpstreamAdmitted | { ok: false; retryAfterSec: number | null; reason?: string }>;

/** The Durable Object name of a gateway's lease. One object per gateway: its request window is the gateway's. */
export const upstreamObjectName = (slug: string) => `upstream-lease:${slug}`;

/**
 * The admission `runGatewayTextModel` calls. It waits at most `maxWaitMs`,
 * polling the governor, then refuses with the wait it was told. Without the
 * `AI_GOVERNOR` binding it refuses (`no_binding`): an in-isolate counter would
 * not be shared across isolates, so it is never the authority. Any answer the
 * object cannot give throws, and the seam reads a throw as a refusal.
 */
export function upstreamAdmission(
  env: Env, opts: { maxWaitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): UpstreamAdmission {
  return async (req) => {
    if (!env.AI_GOVERNOR) return { ok: false, retryAfterSec: null, reason: 'no_binding' };
    // D264: under the branch's Durable Object jurisdiction, never an unrestricted one.
    const ns = doNamespace(env, env.AI_GOVERNOR);
    const stub = ns.get(ns.idFromName(upstreamObjectName(req.gatewaySlug)));
    const call = async (path: string, body: unknown): Promise<any> => {
      const r = await stub.fetch(`https://ai-governor/upstream/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`ai_governor_${r.status}`);
      return r.json();
    };
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
    const max = Math.max(0, opts.maxWaitMs ?? ADMIT_MAX_WAIT_MS);
    const input: UpstreamAcquireInput = { execution: req.executionId, tenant: `user:${req.userId}`, product: req.task, model: req.model };
    let waited = 0;
    for (;;) {
      const a = (await call('acquire', input)) as UpstreamAcquired;
      if (a.ok === true) {
        const token = a.token;
        let ended = false;
        return {
          ok: true,
          attempt: async () => ((await call('attempt', { token })) as UpstreamAcquired).ok === true,
          release: async (end) => {
            if (ended) return;
            ended = true;
            await call('release', { token, completion: end?.completion ?? 'unknown' });
          },
        };
      }
      if (a.ok !== false || !Number.isFinite(a.wait_ms)) throw new Error('ai_governor_unreadable');
      const ms = Math.min(Math.max(1, a.wait_ms), max - waited);
      if (ms <= 0) return { ok: false, retryAfterSec: Math.max(1, Math.ceil(a.wait_ms / 1000)), reason: a.reason };
      await sleep(ms);
      waited += ms;
    }
  };
}
