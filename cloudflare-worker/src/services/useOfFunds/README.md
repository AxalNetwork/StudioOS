# Use-of-funds model v1 (D1175)

`plan.ts` exports the pure `plan(PlanInputs)` engine and `MODEL_V1` assumptions.
All derived blocks carry `source: Modelled`, version, the input snapshot and a
missing-input reason. These are forecasts, never runway today or actual OKR
completion. A null list is unread; an empty list is known empty. Whole cents
and explicit zeroes are preserved. No provider, AI or clock is called.

Budgets use the five fixed sections. Payroll recurs from each hire's recorded
start month; the remaining allocation is spread across the target months.
Payroll over budget stays visible. Cash receipts need an explicit arrival
month. Cash deficits are retained; an unexhausted horizon yields a lower bound,
not an invented exhaustion date. Milestones consume section budgets in
deadline/id order; `reached` is only modelled affordability through the deadline.

`legacy.ts` exposes `copyLegacyBase(DB, projectId, authenticatedFounderUserId)`:
one transaction creates Base, its five nullable lines, section milestones and
costed OKRs. Concurrent calls and retries preserve existing rows and edits.
The original JSON is never modified by a copy. Unknown/stale OKRs or malformed
legacy data refuse the copy atomically for correction; they are never omitted.
Legacy dollars become cents; no source is invented: copied rows carry the
original module reference and the #2431 `recorded` provenance label.
An optional `onCreate(uid)` statement lets the route include its conditional
creation audit inside that same copy transaction. Support reads do not copy.

`saveBaseSplit` remains the lower-level founder-only dual writer from D1175.
D1176's `store.ts` extends the dual-write boundary to admin attribution and an
atomic activity row, sharing it between the module PUT and record drawer.
It also projects milestones/OKR costs when Base changes, retaining legacy-only
entries and refusing conflicting edits of the same key. A failed legacy copy
names the existing projects PUT correction route; it never drops stale costs.
Deleting a milestone does not require its old OKR still to exist. No read
reaches a provider or another user's Mercury records.
An unrelated Base edit retains a historical split with omitted sections;
promotion/replacement requires a complete split. Later legacy financial edits
must be explicitly reconciled rather than overwritten by a rename.

Migration 606 creates the three new stores. Hires remain in
`use_of_funds_hires` (migration 463); part 3 scopes and supplies that list.

D1176: `store.ts` supplies scoped scenario/milestone/hire writes, the shared module and record-drawer split writer, Base projection and atomic activity rows. `read.ts` supplies independent Home blocks, round precedence, founder-only cached Mercury, measured runway precedence, ties and Needs you. Neither uses a forecast as runway today. See D1176 for the API contract.
