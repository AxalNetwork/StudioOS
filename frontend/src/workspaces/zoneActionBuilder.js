import { exportView } from '../lib/csvExport';

/**
 * One builder, four profiles.
 *
 * A zone action table declares, for each zone, exactly the `ops:` array of its
 * artboard in `design/canvases/integrated/Pages · …` — in the canvas's order,
 * nothing invented and nothing dropped. Each entry is one of three things:
 *
 *   `kind: 'export'` — runs here, over the rows the page has loaded.
 *   `to: '/path'`    — the flow is built, on a route the reader may open, and
 *                      this is a link to it. Every one is re-checked against
 *                      `App.jsx`'s guard by `frontend/test/profile_zone_actions.test.mjs`.
 *   `unbuilt: '…'`   — nothing performs it yet. The entry stays here so the
 *                      canvas-order guard can still prove this table dropped
 *                      nothing the artboard drew, and so a reader of this file
 *                      learns why. IT RENDERS NOTHING. The builder returns null
 *                      and the caller drops it before `ZoneActions` ever sees it.
 *
 * WHY `unbuilt` RENDERS NOTHING, WHEN IT USED TO RENDER ITS OWN REASON. The
 * field was called `note` and `ZoneActions` drew it as `{label} — {note}`, so
 * the design's `Comparables` chip shipped to customers as "Comparables — no
 * competitor can be filed as a comparable: the form offers direct or adjacent,
 * and every writer coerces anything else to direct". That is a true sentence in
 * the wrong place. Refusing to draw a button nothing performs is right and has
 * not changed; printing the refusal INSIDE the control's own label turned every
 * unbuilt op into a paragraph of design-review commentary on the customer
 * surface, and turned five zone headers into essays. The reason belongs in this
 * file, where the person who can act on it reads it.
 *
 * WHY THE BUILDER IS SHARED AND THE TABLES ARE NOT. The rules are identical
 * across profiles — what an empty export says, how a link carries the reader's
 * current scope, what an unbuilt op does — and this repo already carries three
 * copies of one CSV escaper that disagree with each other. The tables are per
 * profile because the answers are: `/matches` is a real destination for an
 * investor's "Request an intro" and a closed door for a founder's, and the same
 * label under the same canvas heading is therefore a link on one and absent on
 * the other.
 */

/** Merge a page's `?project_id=…` into a link that may carry its own query. */
export function withQuery(to, query) {
  if (!query) return to;
  const [path, own = ''] = String(to).split('?');
  const params = new URLSearchParams(own);
  for (const [k, v] of new URLSearchParams(String(query).replace(/^\?/, ''))) params.set(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Bind a table, and get back the `(key, { query, view })` function a page calls.
 *
 * `view` is the export payload: `{ scope, header, rows, cells }`. `cells` maps
 * one loaded record to the array of values under `header`, so the file carries
 * the columns the page is showing rather than whatever keys the API returns —
 * and it runs on the click, not on every render.
 *
 * AN EXPORT OVER NOTHING LOADED IS THE ONE CONTROL THAT STAYS AND GOES QUIET.
 * It is not unbuilt — the store is there and the writer is there; the rows have
 * simply not arrived. So it keeps the canvas's `Export` label and renders
 * disabled, which is the state that is actually true, and it becomes live the
 * moment the page has rows. A file with a header row and no body reads as
 * "there is no data" when the truth is almost always "it has not loaded yet".
 */
export function makeZoneActions(TABLE) {
  return function zoneActions(key, { query = '', view = null } = {}) {
    const spec = TABLE[key];
    if (!spec) return [];
    const slug = key.split('/').pop();
    return spec.map((item) => {
      const testid = `action-${slug}-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (item.kind === 'export') {
        const rows = view?.rows || [];
        if (!rows.length) {
          return { label: item.label, testid, disabled: true, title: 'nothing loaded to export yet' };
        }
        return {
          label: `${item.label} · this view`,
          testid,
          onClick: () => exportView({
            scope: view.scope,
            zone: view.zone || slug,
            header: view.header,
            rows: view.cells ? rows.map(view.cells) : rows,
          }),
        };
      }
      if (item.to) {
        return { label: item.label, testid, to: withQuery(item.to, query), title: item.linkNote };
      }
      return null;
    }).filter(Boolean);
  };
}
