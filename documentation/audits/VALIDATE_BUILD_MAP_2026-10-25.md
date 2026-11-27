# Validate → Build — the canvas against the code, 2026-10-25

S21's map for D1063 (#2426). It reads the owner's "Validate → Build" canvas against `origin/main` at `7723cfbd10`. The canvas has boards VB1–VB22 with lettered boards, in `design/incoming/Validate → Build Page.dc.html` and `Validate → Build · Boards.dc.html`. It is true as of that date: re-check the code before acting on a line here.

Paths: `fe/` is `frontend/src/`, `wk/` is `cloudflare-worker/src/`.

## 1. What #2426 called broken, re-checked

| # | #2426's finding | Today | Where |
|---|---|---|---|
| 1 | Spin-Out Lab founders reach Validate but not Build | **Open**: Build's routes use `guard(['admin', 'founder'])`; the Worker admits them (`ownsVenture`) | `fe/App.jsx` (`/build`, `/build/:slug` and the rest) |
| 2 | A trashed venture still takes a decision | **Open**: no `deleted_at IS NULL` | `wk/routes/cycle_verdict.ts` ~42, `wk/routes/cycle_validate.ts` ~67 |
| 3 | Build's creates read the new id back with `SELECT MAX(id)` outside their batch | **Open** | `wk/routes/cycle_build.ts` ~959, ~1064, ~1221 (and ~1059, ~1183, ~1215) |
| 4 | A new must-have's activity line is filed under Solution design | **Open** | `wk/routes/cycle_build.ts` ~1061 |

## 2. The reads on `main`

| Read | Shape | Boards |
|---|---|---|
| `GET /api/cycles/validate/overview` | One card per Validate module, in the five card states, with its caption and next action | VB1 "What Validate proved" |
| `GET /api/cycles/build/overview`, `/modules/:slug` | Build's cards and modules; `parts.github` on Prototype / MVP and Product roadmap | VB2, VB10 (GitHub facts, not drawn yet) |
| `POST /api/cycles/validate/decisions` | The Verdict (D693) | VB2, VB14 (not drawn yet) |
| `GET /api/connectors/:uid/repositories` | The founder's picked repositories | VB7 (not drawn yet) |

Not stored anywhere yet:
- a plan, its items, their proposals and evidence links (`build_plans`, `build_plan_items`, `build_evidence_links`);
- a handoff and its marker (`build_handoffs`);
- a fed row's link back to a plan item;
- a progress stage per item.

## 3. Board by board

| Board | Drawn by D1063 | Waits for |
|---|---|---|
| VB1 Plan | `/build/plan` under Build's header: title, line, Plan and Progress tabs; "What Validate proved" from the Validate overview's own cards (Problem discovery, Experiments, Ideal customer profile, Demand); each module's section as "Not read here yet" with what it would propose; Founding team's line | parts 2, 3, 6 |
| VB2 Entry points | The Build overview's door "Open the plan" | the Verdict card (part 6) |
| VB3–VB5 Card states, Edit and accept, Eadwyn's wording | — | parts 3, 6, 8 |
| VB6–VB9 Send to…, Back in | — | parts 5, 7 |
| VB10–VB12 Progress, the trail, dark | `/build/plan/progress` as "Not read here yet" | parts 3, 5, 7 |
| VB13, VB14 New evidence, Verdict states | — | parts 4, 6 |
| VB15, VB16 Operating Partner, admin | Build's guard today (admin, founder) | part 7 |
| VB17–VB19 Empty, loading, error | Each read answers alone; a failed Validate read says it is not a claim of none | part 6 |
| VB20 No permission, a Lab venture | — | parts 1, 6, 7 |
| VB21, VB22 Phone | `CycleBar` below 1024px | parts 6, 7 |
