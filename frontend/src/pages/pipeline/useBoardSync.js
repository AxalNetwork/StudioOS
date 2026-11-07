import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The Pipeline board's list, kept true while people move cards (#4701).
 *
 * WHAT WENT WRONG BEFORE. The board dropped a live event whenever any local
 * move was in flight, and nothing re-read afterwards, so a card another person
 * moved during your drag stayed where it was until you pressed Refresh. A
 * socket that dropped and came back had the same hole: whatever happened while
 * it was down was never fetched. A failed read left the board empty with no
 * message, and a slow older read could land over a newer one.
 *
 * WHAT THIS DOES.
 *   · `refresh()` is the one way a re-read is asked for. With a local move in
 *     flight it only records that the board is stale; the re-read runs when the
 *     last move settles. With a read already in flight it asks for exactly one
 *     more, not one per event.
 *   · A move settling bumps the generation, so a read that began before the
 *     move finished (and may predate it) is dropped, and a fresh one follows.
 *   · `reconnected()` is `refresh()`: a socket coming back cannot know what it
 *     missed.
 *   · Four distinct states: `loading` (first read), `ready` (rows, possibly
 *     `refreshing` underneath), `unreadable` (the first read failed — not an
 *     empty board), and `ready` with `deals: []` (a read that answered nothing).
 *   · A re-read that fails over a board that already has rows keeps the rows
 *     and sets `refreshError`; a remainder that could not be paged in sets
 *     `partial`.
 *
 * @param {() => Promise<{items:any[], total?:number, complete?:boolean}>} loadAll
 */
export default function useBoardSync(loadAll) {
  const [state, setState] = useState({
    status: 'loading', deals: [], total: null, partial: false, refreshing: false, refreshError: false,
  });
  const loadRef = useRef(loadAll);
  loadRef.current = loadAll;
  const generation = useRef(0);
  const pending = useRef(new Set());   // deal ids with a move in flight
  const stale = useRef(false);         // an event arrived while a move was in flight
  const inFlight = useRef(false);
  const again = useRef(false);
  const mounted = useRef(true);

  const reload = useCallback(function reload() {
    const mine = (generation.current += 1);
    inFlight.current = true;
    again.current = false;
    stale.current = false;
    setState((s) => (s.status === 'ready' ? { ...s, refreshing: true } : { ...s, status: 'loading' }));
    Promise.resolve()
      .then(() => loadRef.current())
      .then(
        (r) => {
          if (!mounted.current || generation.current !== mine) return;
          const moving = pending.current;
          setState((s) => {
            const byId = new Map(s.deals.map((d) => [d.id, d]));
            const rows = r.items || [];
            // A card with a move in flight keeps the stage the reader dropped it on.
            const deals = moving.size
              ? rows.map((d) => (moving.has(d.id) && byId.has(d.id) ? { ...d, pipeline_stage: byId.get(d.id).pipeline_stage } : d))
              : rows;
            return {
              status: 'ready', deals, total: r.total ?? deals.length,
              partial: r.complete === false, refreshing: false, refreshError: false,
            };
          });
        },
        () => {
          if (!mounted.current || generation.current !== mine) return;
          setState((s) => (s.status === 'ready'
            ? { ...s, refreshing: false, refreshError: true }
            : { status: 'unreadable', deals: [], total: null, partial: false, refreshing: false, refreshError: false }));
        },
      )
      .finally(() => {
        if (generation.current === mine) inFlight.current = false;
        if (mounted.current && again.current && pending.current.size === 0) reload();
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; generation.current += 1; };
  }, [reload]);

  const refresh = useCallback(() => {
    if (pending.current.size > 0) { stale.current = true; return; }
    if (inFlight.current) { again.current = true; return; }
    reload();
  }, [reload]);

  /** False when this card already has a move in flight. */
  const beginMove = useCallback((id) => {
    if (pending.current.has(id)) return false;
    pending.current.add(id);
    return true;
  }, []);

  const endMove = useCallback((id) => {
    pending.current.delete(id);
    // A read that started before this move settled may predate it: drop it.
    generation.current += 1;
    // The read being dropped still has to be replaced, even if another move is
    // in flight: the replacement runs when the last one settles.
    if (inFlight.current) stale.current = true;
    inFlight.current = false;
    if (pending.current.size === 0 && (stale.current || again.current)) reload();
  }, [reload]);

  const isMoving = useCallback((id) => pending.current.has(id), []);
  const setDeals = useCallback((update) => setState((s) => ({ ...s, deals: update(s.deals) })), []);

  return { ...state, reload, refresh, reconnected: refresh, beginMove, endMove, isMoving, setDeals };
}
