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

`saveBaseSplit` is the part-3 writer contract: it writes both the new Base and
the deck's existing `projects.use_of_funds`, `funding_needed` and
`use_of_funds_meta.runway_months` in one batch, preserving unrelated metadata.
It accepts only the authenticated founder, never an AI payload. The existing
Raise writer/routes are unchanged; part 3 (#3103) mounts and audits these
services. No read of this service reaches Mercury or another user's records.

Migration 606 creates the three new stores. Hires remain in
`use_of_funds_hires` (migration 463); part 3 scopes and supplies that list.
