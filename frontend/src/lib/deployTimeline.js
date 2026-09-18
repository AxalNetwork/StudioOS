/**
 * What a branch deployment's single `status` can honestly say about eight steps.
 *
 * THE DEFECT THIS EXISTS TO FIX (D149). `AdminLicences.jsx` drew the timeline
 * as `const done = at >= 0 && i <= at` — a check or an empty circle, two states
 * for three. `failed` is not one of the eight steps, so `at` was **-1** and a
 * FAILED deployment rendered all eight steps blank: byte for byte what a
 * deployment nobody had started would render. And a run still working on step 4
 * rendered exactly like one that failed after step 3. Two different states drawn
 * the same way is this programme's recurring defect — D107's empty-vs-absent
 * licence copy, D128's tile-vs-table, D147's never-pushed-vs-pushed-empty.
 *
 * WHY IT IS HERE AND NOT IN THE PAGE. Which steps a status implies is a fact
 * about migration 258's vocabulary, not about a layout, and `lib/README.md`'s
 * rule puts a fact here. It is also what makes the fix TESTABLE: a source scan
 * over the page can see that three markers are written and cannot see that a
 * running deployment and a failed one now differ, which is the entire defect.
 * `sortCells` in `lib/licenceCoverage.js` moved here for the same reason (D146).
 *
 * WHAT THE STORE CANNOT SAY, AND SO IS NOT MODELLED. `licence_deployments`
 * carries ONE `status` and ONE `status_note`, with no per-step history. So:
 *
 *   · a failed deployment cannot mark WHICH step failed. `status` was
 *     overwritten with 'failed' and whatever progress it had reached is gone,
 *     so every step is `unknown` — NOT `fail`. Marking all eight failed would
 *     claim the request was never even made, and the row saying so is right
 *     there. `unknown` is the honest word and the canvas's third state is not
 *     reachable from this store;
 *   · no step carries a time, and only the deployment carries a note. The
 *     canvas draws `Secrets present · 10:02:24 · fail · BRANCH_SIGNING_KEY
 *     missing`; the page STATES both absences rather than deriving seven
 *     timestamps from the one `requested_at`, which is the D140/D147 rule.
 *
 * A per-step ledger would be a new migration and a store decision, which is not
 * this task's to take.
 */

// What provisioning reports, in the order it happens (migration 258). Kept as a
// list rather than inferred from the row, so a deployment sitting at
// `schema_applied` shows the four steps still ahead of it.
export const DEPLOY_TIMELINE = [
  ['requested', 'Requested'],
  ['database_created', 'Database created'],
  ['schema_applied', 'Schema applied'],
  ['secrets_present', 'Secrets present'],
  ['principal_seeded', 'Principal seeded'],
  ['worker_live', 'Worker live'],
  ['hostname_active', 'Hostname active'],
  ['linked', 'Linked to HQ'],
];

/**
 * @param {string} status one of migration 258's nine values
 * @returns {{failed: boolean, done: number, total: number, states: string[], summary: string}}
 */
export function deployProgress(status) {
  const total = DEPLOY_TIMELINE.length;
  const at = DEPLOY_TIMELINE.findIndex(([k]) => k === status);
  // `failed` IS the only status migration 258 admits that is not one of the
  // eight steps, so `at < 0` is the failure rather than an unrecognised value —
  // and an unrecognised value is treated the same way on purpose, because
  // "something we cannot place on the timeline" is exactly what `unknown` says.
  const failed = at < 0;
  const done = failed ? 0 : at + 1;
  return {
    failed,
    done,
    total,
    states: DEPLOY_TIMELINE.map((_, i) => {
      if (failed) return 'unknown';
      return i <= at ? 'ok' : 'wait';
    }),
    summary: failed
      ? `Failed. Of the ${total} steps, which one it failed at is not recorded.`
      : `${done} of ${total} complete · ${total - done} waiting`,
  };
}
