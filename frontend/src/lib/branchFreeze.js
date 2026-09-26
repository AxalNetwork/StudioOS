/**
 * WHAT A SUSPENDED BRANCH CAN STILL DO — one list, read by the shell and
 * asserted against the worker's own gate (D142).
 *
 * WHY THIS IS A MODULE AND NOT COPY ON A PAGE. S7 draws two columns, Still
 * readable and Locked, and the Locked column is a claim about what the SERVER
 * refuses. A hand-typed copy of that claim is a fifth copy of a rule that lives
 * in `requireBranchNotSuspended`'s call sites, and the day somebody adds a sixth
 * gate the screen quietly stops describing the product. So `gatedIn` names the
 * route files, and `branch_shell_s7_s13.test.mjs` asserts that the set of worker
 * files calling the gate is EXACTLY the union of these — a new gate with no row
 * fails, and a row naming a file with no gate fails too.
 *
 * That is the sixth consolidation in this programme, and the same argument each
 * time: D127 one `GROUP BY role`, D128 one LIKE escaper, D130 one definition of
 * open, D131 one count, D138 one definition of what freezes an ADMIN, D140 one
 * zone formatter, and now one definition of what freezes a BRANCH.
 *
 * READS ARE NEVER GATED, AND THAT IS STRUCTURAL RATHER THAN A PROMISE.
 * `requireBranchNotSuspended` is called from write handlers only, and
 * `auth.ts`'s own header states the rule — *"IT NEVER GATES A READ"*. So the
 * Still-readable column below is not a list of exceptions somebody maintains;
 * it is a description of the four places a branch admin most needs to look
 * while they sort the suspension out.
 */

/**
 * Locked: the write families the worker actually refuses with 423.
 *
 * `gatedIn` is the evidence. Each name is a file under
 * `cloudflare-worker/src/routes/` that calls `requireBranchNotSuspended`.
 */
export const FROZEN = [
  {
    // D260 — "Every queue frozen" was never true: Approvals has eleven lanes
    // since D215, and four of them have no gate. The row now names both sides.
    row: 'Approvals',
    note: 'LP applications, referrals, Spin-Out moderation and KYC verdicts are frozen, approve and reject alike. Items keep their SLA age, so nothing looks fresh when it unfreezes. Partner profiles, Exploring, Best-Fit consultations and due diligence are not frozen.',
    gatedIn: ['admin_lp_applications.ts', 'refer_earn.ts', 'spinout_moderation.ts', 'kyc.ts'],
  },
  {
    // D260 — the older application decide in admin.ts writes the same cohort
    // queue, so "admissions closed" was true of one door only until it gated.
    row: 'Programs',
    note: 'Cohort and Spin-Out Lab admissions closed, by the cohort queue and by the older application decide alike. The running cohort continues to its end date — its week decisions are not frozen, because the founders in it did nothing.',
    gatedIn: ['admin_cohort.ts', 'admin.ts'],
  },
  {
    // D260 — the admin acts that decide an account's access: both KYC
    // verdicts, the grant of limited access, and the two Lab admissions.
    // Revoking limited access is a takedown and stays open, as FREEZE_RULE says.
    row: 'Access',
    note: 'No KYC verdict, no grant of limited access, and no admission to the Spin-Out Lab. Revoking limited access still works.',
    gatedIn: ['admin.ts', 'kyc.ts'],
  },
  {
    // D303 — Wellbeing joined the other three Community consoles behind
    // this gate: a new resource, an un-hidden expert or a freshly verified
    // one are all "something new under the brand"; a takedown (delete a
    // resource, hide an expert, remove a verification) still works.
    row: 'Community',
    note: 'Events, jobs, circles and Wellbeing cannot be published, verified or restored. Existing pages stay up, and a takedown still works.',
    gatedIn: ['admin_events.ts', 'admin_jobs.ts', 'admin_circles.ts', 'wellbeing.ts'],
  },
];

/**
 * THE RULE THAT DECIDED WHICH COMMUNITY WRITES FREEZE, because "Community" is
 * three files and fifteen handlers and only seven of them are gated.
 *
 * A suspended branch may not put anything NEW under the brand, and may still
 * take things DOWN. So `approve`, `publish`, `feature` and the two circle
 * writes that can set `published` are refused; `reject`, `unpublish`, `cancel`,
 * `delete` and an event's capacity edit are not. Freezing a takedown would trap
 * a frozen branch with content under its own brand that it cannot remove, which
 * is a worse outcome than the freeze it implements — and the canvas asks for
 * exactly this split: *"Events, jobs and circles cannot be published. Existing
 * pages stay up."*
 */
export const FREEZE_RULE =
  'A suspended branch cannot publish, approve or feature anything new. Taking something down still works.';

/** Still readable: where a branch admin looks while the suspension stands. */
export const STILL_READABLE = [
  { row: 'Accounts', note: 'Every account and its seat basis, read-only.' },
  { row: 'Contracts', note: 'Signed agreements and their envelopes.' },
  { row: 'Insights', note: 'Your figures to the day of suspension. The HQ benchmark stops updating; its "as of" shows why.' },
  { row: 'Settings', note: 'Staff and roles remain editable — the people who will lift this need to be able to sign in.' },
];

/**
 * DRAWN BY THE CANVAS AND DELIBERATELY NOT DRAWN HERE, with the measurement
 * that decided it.
 *
 * S7's fourth Locked row reads *"Seat assignment — Assign and release removed,
 * not greyed."* There is nothing to remove: `seat_assignments` has **no
 * migration** (zero hits in `cloudflare-worker/sql/`, and it is not in the
 * baseline), **no route**, and **no `api.js` method**. Its only trace in the
 * worker is a comment at `routes/licence.ts` recording that the store was
 * promised and never built — D127 and D129 chose a different design, where
 * seats-used is counted from `users.role` and `seats_used_basis` says so on
 * screen.
 *
 * Drawing a freeze on a control that does not exist is the same false claim
 * this programme has now deleted three times (D129's seat store, D131's six S1
 * blocks, D140's adjustable dates). So it is recorded here instead, and the
 * test asserts this list stays empty of anything that DOES have a gate.
 */
export const NOT_BUILT = [
  {
    row: 'Seat assignment',
    why: 'There is no seat ledger to freeze: `seat_assignments` has no migration, no route and no api method. Seats used is counted from roles (D127/D129).',
  },
];
