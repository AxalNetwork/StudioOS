import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * #4698 (Delivery audit 4/6) — the two things every Delivery zone needs from
 * its reads and its writes, so no zone grows its own copy.
 *
 * `useZoneRead` keeps POPULATED CONTENT MOUNTED during a refetch. The zones
 * used to set `loading: true` on every reload, and `ZoneBody` answers that
 * with a skeleton in place of its children: saving one record unmounted every
 * open editor on the page and threw away what was typed into them. Here the
 * skeleton belongs to the first read only. A later read marks `refreshing`,
 * keeps the rows on screen, and if it fails keeps them too and says so in
 * `refreshError` — a zone that already read its store has not become unreadable
 * because a second read failed. A response that lands after a newer read has
 * started is dropped.
 *
 * `useMutations` tracks what is in flight BEFORE the request starts, per
 * operation key. The guard is a ref, written synchronously, because a React
 * state flag is only visible after the next render and two clicks in one
 * frame both see the old value. Independent operations (two different rows)
 * use different keys and do not block each other; the same key refuses a
 * second start. `run` resolves to `{ ok: true, value }`, `{ ok: false, error }`
 * or `{ ok: false, skipped: true }`, and never throws, so a caller closes or
 * resets an editor only on `ok`.
 */

export function useZoneRead(fetcher, failure, deps = []) {
  const [state, setState] = useState({
    loading: true, error: '', data: null, refreshing: false, refreshError: '',
  });
  const seq = useRef(0);
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const message = useRef(failure);
  message.current = failure;

  const load = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    setState((s) => (s.data
      ? { ...s, refreshing: true, refreshError: '' }
      : { loading: true, error: '', data: null, refreshing: false, refreshError: '' }));
    try {
      const data = await latest.current();
      if (mine !== seq.current) return { ok: true, stale: true };
      setState({ loading: false, error: '', data, refreshing: false, refreshError: '' });
      return { ok: true };
    } catch (e) {
      if (mine !== seq.current) return { ok: false, stale: true };
      const text = e?.message || message.current;
      setState((s) => (s.data
        ? { ...s, refreshing: false, refreshError: text }
        : { loading: false, error: text, data: null, refreshing: false, refreshError: '' }));
      return { ok: false, error: e };
    }
  }, []);

  useEffect(() => { load(); }, deps);
  return { state, load };
}

export function useMutations() {
  const inflight = useRef(new Set());
  const [pending, setPending] = useState(() => new Set());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = useCallback(async (key, fn) => {
    if (inflight.current.has(key)) return { ok: false, skipped: true };
    inflight.current.add(key);
    setPending((p) => new Set(p).add(key));
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    } finally {
      inflight.current.delete(key);
      if (alive.current) {
        setPending((p) => { const n = new Set(p); n.delete(key); return n; });
      }
    }
  }, []);

  const isPending = useCallback((key) => pending.has(key), [pending]);
  return { run, isPending, anyPending: pending.size > 0 };
}

/** The values a draft is seeded from, as one comparable string. */
export const signature = (...parts) => JSON.stringify(parts);
