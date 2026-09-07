/**
 * One builder, four profiles — the filter half of the zone header row.
 *
 * `zoneActionBuilder.js` does this for the `ops:` array of a `Pages · …`
 * artboard. This does it for the `filters:` array on the same row, and it
 * exists for the same reason: the canvas draws both, the product shipped only
 * one, and a reader looking for `Timeline / Board / Dependencies / Scenarios`
 * on `/build/roadmap` found nothing at all.
 *
 * WHY A FILTER NEEDS THE HONESTY RULE AS MUCH AS A BUTTON DOES. `ZoneActions`
 * already refuses to draw an action nothing performs. A filter is the subtler
 * case, because a filter that cannot run does not fail loudly — it returns an
 * empty set, and an empty set reads as an ANSWER. `/grow/customers` shipped a
 * live "Stalled" chip whose predicate was literally `return []`; clicking it
 * said "you have no stalled accounts" when the truth is that no store records
 * stalling at all. That is the product's central rule — absent is not empty —
 * failing in the one place where the failure looks like data.
 *
 * So a filter is one of exactly two things:
 *
 *   `key: 'blockers'` — it narrows the rows the page has loaded. Rendered as a
 *                       chip; selecting it sets the page's own view state.
 *   `unbuilt: '…'`    — nothing in the store distinguishes it. The entry stays
 *                       so `canvasFilterLabels` can still prove this table
 *                       accounted for every string the artboard drew, and so a
 *                       reader of this file learns why. IT RENDERS NOTHING —
 *                       not a chip, and not a sentence either.
 *
 * WHY IT RENDERS NOTHING, WHEN IT USED TO RENDER ITS OWN REASON. The field was
 * called `note`, and `ZoneToolbar` collected the notes into prose beneath the
 * chips, so the design's four-word filter row shipped as three paragraphs
 * explaining which of its filters the store cannot tell apart. Not drawing a
 * dead chip is right and has not changed. Printing the reason in the chip row
 * put design-review commentary on the customer surface — and `noteAlways`,
 * which appended a standing sentence BESIDE working chips, did it on rows that
 * were otherwise entirely fine. The reason belongs in this file. What the
 * reader needs on the page is the filters that work.
 *
 * `canvas` IS THE PROVENANCE AND IS ALWAYS THE ARTBOARD'S OWN STRING.
 * `label` is what renders, and defaults to `canvas`. They differ only where the
 * canvas label carries a sample figure from the mock data — `All 14`, `All 14
 * mo`, `Aug 2026`. Printing those verbatim would state a count this founder's
 * account has not got. A live entry may write `{n}` in its `label` and the page
 * supplies the real figure through `counts`; when the page has no figure the
 * clause is dropped rather than guessed, so the chip reads `All` and never
 * `All 14`. `frontend/test/profile_zone_filters.test.mjs` re-derives every
 * `canvas` string from the canvases, so this table cannot drift from them.
 */

/**
 * Substitute the page's own count, or drop the clause rather than invent one.
 *
 * A zero drops the clause too, and rendering is what settled that: a founder
 * with no stored snapshots got a chip reading "All 0 months", which is not a
 * filter name — it is a broken string. "All months" over an empty ledger is
 * still true, and the count that is genuinely absent already has its own place
 * to be said, in this zone's stat strip ("Months on record · Unavailable").
 * This is the same call as `boards/format.js` refusing to print "0 retainers"
 * from a `?? 0`: a figure belongs where a figure is being reported.
 */
function withCount(label, count) {
  if (!String(label).includes('{n}')) return label;
  if (!Number.isFinite(count) || count <= 0) return String(label).replace(/\s*\{n\}/g, '').trim();
  return String(label).replace(/\{n\}/g, String(count));
}

/**
 * Bind a table, and get back the `(key, { value, onChange, counts })` function
 * a page calls.
 *
 * The page owns the state and the predicate, because only the page knows its
 * rows; the table owns which views the canvas promised and which of them the
 * store can actually tell apart. That is the same split `zoneActionBuilder`
 * uses, where the table owns the labels and the page supplies the payload.
 */
export function makeZoneFilters(TABLE) {
  return function zoneFilters(zoneKey, { value, onChange, counts = {}, dynamic = {} } = {}) {
    const spec = TABLE[zoneKey];
    if (!spec) return [];
    const slug = zoneKey.split('/').pop();
    const id = (label) => `filter-${slug}-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const chip = (key, label) => ({
      label: withCount(label, counts[key]),
      testid: id(label),
      active: value === key,
      onSelect: () => onChange?.(key),
    });
    return spec.flatMap((item) => {
      const first = Array.isArray(item.canvas) ? item.canvas[0] : item.canvas;
      // A dynamic group: the canvas draws one chip per role, segment or stage
      // and fills them with sample names. The real names come from the store,
      // so the page supplies them; with none supplied there is no chip group to
      // draw and the group contributes nothing to the row.
      if (item.dynamic) {
        const supplied = dynamic[item.dynamic] || [];
        if (!supplied.length) return [];
        return supplied.map((one) => chip(one.key, one.label));
      }
      if (item.unbuilt) return [];
      return [chip(item.key, item.label || first)];
    });
  };
}

/**
 * Every canvas string one zone accounts for, flattened — what the guard reads
 * to prove the table dropped nothing the artboard drew.
 */
export function canvasFilterLabels(TABLE, zoneKey) {
  return (TABLE[zoneKey] || []).flatMap((item) => (Array.isArray(item.canvas) ? item.canvas : [item.canvas]));
}
