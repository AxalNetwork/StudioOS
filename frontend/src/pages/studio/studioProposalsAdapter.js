/**
 * D1419 (#3698) — THE SEAM between the Studio and Eadwyn's layout proposals
 * (SM9, SM10, SM13c: "Arrange my Studio for this stage", Accept, Edit,
 * Discard, Accept all, the hold line "Holds up to $X · you pay what it uses").
 *
 * STILL UNAVAILABLE, keyed to its issue: #3864 (D1420) builds the
 * `studio:layout` run on `POST /api/ai/rail/run`, which reads the layout, the
 * catalogue, the Lab week and readiness, holds the cost, and returns add,
 * remove and resize rows with a source. Until it is on `main`, `propose`
 * answers `{ available: false, reason, issue }` and nothing is drawn in the
 * chat: no client method exists for a route that does not (the drift check,
 * `scripts/check-api-drift.mjs`). The builder of #3864 replaces only the body
 * of `propose` with a call through the method it adds to `lib/api`.
 *
 * ACCEPT IS NOT BEHIND THIS SEAM: it applies the rows with `applyProposal`
 * and saves through `PUT /api/studio/layout` (`studioLayoutApi.saveLayout`),
 * which exists. Nothing changes on the Studio until the member accepts.
 */
import { add, remove, resize } from './studioLayoutModel';

export const PROPOSALS_ISSUE = '#3864';
export const PROPOSALS_OFF_REASON = 'Eadwyn’s layout proposals aren’t available yet.';

/** The unavailable answer, naming the issue that builds the route. */
export const unavailable = (reason = PROPOSALS_OFF_REASON) => ({ available: false, reason, issue: PROPOSALS_ISSUE });

/** #3864: `POST /api/ai/rail/run` with the `studio:layout` option → `{ rows: [{ op, key, size?, source }] }`. */
export const propose = async (/* profile, { layout, revision } */) => unavailable();

/**
 * The layout after accepting `rows`, applied in order to a copy: `add` at the
 * catalogue's default size or the row's, `remove`, `resize`. A row that names
 * a module not in `catalogue`, or that the plan locks, is skipped, so a
 * proposal can never place what the Worker would refuse.
 */
export function applyProposal(layout, rows, catalogue) {
  const byKey = new Map((Array.isArray(catalogue) ? catalogue : []).map((m) => [m.key, m]));
  let out = Array.isArray(layout) ? layout.map((e) => ({ key: e.key, size: e.size })) : [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.op === 'remove') { out = remove(out, r.key); continue; }
    const mod = byKey.get(r?.key);
    if (!mod || mod.locked_by_plan) continue;
    if (r.op === 'add') out = add(out, { ...mod, default_size: r.size || mod.default_size });
    else if (r.op === 'resize') out = resize(out, r.key, r.size);
  }
  return out;
}
