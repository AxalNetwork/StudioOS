import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Fetch a bucket board's sources in parallel, one state per source.
 *
 * WHY THE OVERVIEW READS THE ZONE'S OWN ENDPOINT. A board section states a
 * count — "4 open · 38% win rate" — and the zone behind it states the same
 * count. The obvious way to build that is one aggregate endpoint per bucket.
 * It is the wrong way, because the honesty rule in this product does not live
 * in the component: it lives in the worker, attached to the absence itself.
 * `partner_offers.ts` returns `views: null` beside `views_note` — "No
 * impression is recorded anywhere in the product, so a view count would be
 * invented rather than measured." `partner_pipeline.ts` returns
 * `mrr_cents: counted ? mrrCents : null` beside `mrr_basis` and `mrr_note` —
 * "A retainer with no amount is skipped, never counted as zero — zero would
 * claim the client pays nothing." `partner_delivery.ts` returns `unrated_note`
 * — "Silence is not good news."
 *
 * An aggregate endpoint would have to re-derive those figures or re-copy those
 * sentences, and `partner_delivery.ts:230` already refuses the first in as many
 * words: it calls "the same helper the Retainers zone calls, NOT a second
 * computation of the same ratio". Reading the same endpoint the zone reads
 * makes the overview's number the same number by construction, and its caveat
 * the same sentence. It also means this whole feature adds no route, no query
 * and nothing for `check-api-drift.mjs` to see.
 *
 * PER-SOURCE STATE, NOT PER-BOARD. Each section reads only its own key, and
 * one store being down greys one section; it does not blank a page of five.
 *
 * EACH SOURCE PUBLISHES WHEN IT SETTLES (#4697). It used to wait for
 * `Promise.allSettled`, so the slowest source (Proof, one read per claim)
 * held every other section on its skeleton. Now a section draws as soon as
 * its own read answers.
 *
 * NO STALE ANSWER LANDS. A board switches when the reader moves between
 * bucket roots, and the old board's promises can still be in flight. Every
 * read carries the run it started in and its own attempt number; an answer
 * from an earlier run, or from a retry that was superseded, is dropped, so a
 * section never renders another bucket's rows under this bucket's heading.
 *
 * A FAILED SECTION RETRIES ON ITS OWN. Each state carries `retry()`, which
 * reads that source again and leaves the others as they are. A failure reads
 * as one fixed sentence (`SOURCE_UNREADABLE`), never the raw error text, and
 * never as an empty list.
 *
 * @param {Record<string, () => Promise<any>>} sources
 * @returns {Record<string, {state:'loading'|'error'|'ready', data:any, error:string|null, retry:() => void}>}
 */
export const SOURCE_UNREADABLE = 'This section could not be read.';
const LOADING = { state: 'loading', data: null, error: null };

export default function useBucketSources(sources) {
  const keys = useMemo(() => Object.keys(sources || {}), [sources]);
  const [byKey, setByKey] = useState(() =>
    Object.fromEntries(keys.map((k) => [k, LOADING])));
  // The registry rebuilds `sources` every render; a retry reads the latest.
  const latest = useRef(sources);
  latest.current = sources;
  const run = useRef(0);
  const attempts = useRef({});

  const read = useCallback((key, mine) => {
    const attempt = (attempts.current[key] = (attempts.current[key] || 0) + 1);
    const current = () => run.current === mine && attempts.current[key] === attempt;
    Promise.resolve()
      .then(() => latest.current[key]())
      .then(
        (data) => { if (current()) setByKey((prev) => ({ ...prev, [key]: { state: 'ready', data, error: null } })); },
        () => { if (current()) setByKey((prev) => ({ ...prev, [key]: { state: 'error', data: null, error: SOURCE_UNREADABLE } })); },
      );
  }, []);

  useEffect(() => {
    const mine = (run.current += 1);
    attempts.current = {};
    setByKey(Object.fromEntries(keys.map((k) => [k, LOADING])));
    for (const k of keys) read(k, mine);
    // Leaving the board (or switching it) retires every read still in flight.
    return () => { if (run.current === mine) run.current += 1; };
    // `sources` is rebuilt per render by the registry, so the key list is the
    // stable identity. A board's key set changes only when the board does.
  }, [keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback((key) => {
    setByKey((prev) => ({ ...prev, [key]: LOADING }));
    read(key, run.current);
  }, [read]);

  return useMemo(() => Object.fromEntries(Object.entries(byKey).map(([k, v]) => [k, { ...v, retry: () => retry(k) }])), [byKey, retry]);
}
