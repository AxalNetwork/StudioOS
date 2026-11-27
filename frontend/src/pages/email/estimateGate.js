// D4666 (#4666) — which estimate a button may act on.
//
// An estimate belongs to one operation: a first draft, a regenerate of the same request, or a revision of
// exact text. The page keeps the last answer WITH the key of the operation it answered, and reads the gate
// from the operation on screen NOW. An answer for any other operation is not "stale but usable": it is no
// answer, so the button stays shut until the right one arrives. Pure: no React, no network.

export const operationKey = (op) => JSON.stringify(op ?? null);

export const UNREADABLE_LINE = 'The cost of this could not be worked out. Try again.';
export const STALE_LINE = 'That estimate expired. Reading a new one…';

/**
 * `result` is the last answer `{ key, estimate, error }`; `key` is the operation on screen. The status is one of
 * `idle` (nothing to estimate), `loading` (no answer for THIS operation yet), `failed`, `stale` and `ready`.
 * Only `ready` carries an estimate, and only one that names a price and a quote: a missing price is never 0.
 */
export function gateOf(result, key, now = Date.now()) {
  if (!key) return { status: 'idle', estimate: null, error: null };
  if (!result || result.key !== key) return { status: 'loading', estimate: null, error: null };
  if (result.error) return { status: 'failed', estimate: null, error: result.error };
  const e = result.estimate;
  if (!e || !(Number(e.hold_microusd) > 0) || typeof e.quote !== 'string' || !e.quote) return { status: 'failed', estimate: null, error: UNREADABLE_LINE };
  if (e.expires_at && Date.parse(e.expires_at) <= now) return { status: 'stale', estimate: null, error: STALE_LINE };
  return { status: 'ready', estimate: e, error: null };
}

export const pressable = (gate, busy = false) => !busy && gate?.status === 'ready';

/** The fresh estimate a refused run came back with (409 `estimate_required`), or null for any other failure. */
export function refreshedFrom(e) {
  const fresh = e?.data?.estimate;
  return e?.status === 409 && e?.code === 'estimate_required' && fresh && typeof fresh === 'object' ? fresh : null;
}
