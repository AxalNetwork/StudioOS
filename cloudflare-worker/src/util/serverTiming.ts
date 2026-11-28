/**
 * D9169 (#9169) — the `Server-Timing` header on every `/api/*` response: how
 * long this request spent in the role-schema bootstrap (`bootstrap`), the KV
 * rate limiter (`ratelimit`) and resolving its caller (`auth`), in
 * milliseconds. A phase that did not run is reported with `dur=0` and
 * `desc="skipped"`, so a 0 that was measured and a phase that was never
 * entered read differently.
 *
 * Phase names and numbers only: never a path, a bucket, a user id or a token.
 * The timings live in a WeakMap keyed by the request object the Worker entry
 * hands to Hono (Hono's `c.req.raw` is that same object), so the entry, the
 * rate limiter and `getCurrentUser` write to one record without a context
 * variable, and the record goes when the request does.
 *
 * In workerd the clock only advances across I/O, which is exactly what these
 * phases are (D1 statements, KV reads and writes); CPU-only work reads as 0.
 */

export const SERVER_TIMING_PHASES = ['bootstrap', 'ratelimit', 'auth'] as const;
export type ServerTimingPhase = (typeof SERVER_TIMING_PHASES)[number];

const TIMINGS = new WeakMap<Request, Map<ServerTimingPhase, number>>();

const now = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

/** Add `ms` to the request's `phase` (a phase entered twice, as `auth` can be, sums). */
export function recordPhase(request: Request | undefined | null, phase: ServerTimingPhase, ms: number): void {
  if (!request || typeof request !== 'object' || !Number.isFinite(ms)) return;
  let byPhase = TIMINGS.get(request);
  if (!byPhase) { byPhase = new Map(); TIMINGS.set(request, byPhase); }
  byPhase.set(phase, (byPhase.get(phase) ?? 0) + Math.max(0, ms));
}

/** Run `work`, recording its wall time as `phase` whether it resolves or throws. */
export async function timePhase<T>(request: Request | undefined | null, phase: ServerTimingPhase, work: () => Promise<T>): Promise<T> {
  const start = now();
  try {
    return await work();
  } finally {
    recordPhase(request, phase, now() - start);
  }
}

/** The header value for `request`: every phase, in a fixed order. */
export function serverTimingValue(request: Request): string {
  const byPhase = TIMINGS.get(request);
  return SERVER_TIMING_PHASES.map((phase) => {
    const ms = byPhase?.get(phase);
    return ms === undefined ? `${phase};dur=0;desc="skipped"` : `${phase};dur=${ms.toFixed(1)}`;
  }).join(', ');
}

/**
 * `response` with `Server-Timing` appended. A WebSocket upgrade (101, or a
 * response carrying a socket) is returned untouched: rebuilding it would drop
 * the socket. Immutable headers (a response passed through from a `fetch`)
 * are copied onto a new Response with the same body, status and headers.
 */
export function withServerTiming(response: Response, request: Request): Response {
  if (response.status === 101 || (response as Response & { webSocket?: unknown }).webSocket) return response;
  const value = serverTimingValue(request);
  try {
    response.headers.append('Server-Timing', value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.append('Server-Timing', value);
    return copy;
  }
}
