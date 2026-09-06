import { useEffect, useMemo, useRef, useState } from 'react';

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
 * PER-SOURCE STATE, NOT PER-BOARD. `Promise.allSettled`, and each section reads
 * only its own key. One store being down greys one section; it does not blank
 * a page of five.
 *
 * @param {Record<string, () => Promise<any>>} sources
 * @returns {Record<string, {state:'loading'|'error'|'ready', data:any, error:string|null}>}
 */
const LOADING = { state: 'loading', data: null, error: null };

export default function useBucketSources(sources) {
  const keys = useMemo(() => Object.keys(sources || {}), [sources]);
  const [byKey, setByKey] = useState(() =>
    Object.fromEntries(keys.map((k) => [k, LOADING])));

  // A board switches when the reader moves between bucket roots, and the old
  // board's promises can still be in flight. Without this the slower one wins
  // and a section renders another bucket's rows under this bucket's heading.
  const run = useRef(0);

  useEffect(() => {
    const mine = (run.current += 1);
    setByKey(Object.fromEntries(keys.map((k) => [k, LOADING])));
    if (!keys.length) return undefined;
    let live = true;
    Promise.allSettled(keys.map((k) => sources[k]())).then((settled) => {
      if (!live || run.current !== mine) return;
      setByKey(Object.fromEntries(settled.map((r, i) => [
        keys[i],
        r.status === 'fulfilled'
          ? { state: 'ready', data: r.value, error: null }
          : { state: 'error', data: null, error: message(r.reason) },
      ])));
    });
    return () => { live = false; };
    // `sources` is rebuilt per render by the registry, so the key list is the
    // stable identity. A board's key set changes only when the board does.
  }, [keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  return byKey;
}

function message(reason) {
  const raw = reason?.detail || reason?.message || String(reason || '');
  const text = String(raw).trim();
  if (!text || /^\[object/.test(text)) return 'The source did not respond.';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
