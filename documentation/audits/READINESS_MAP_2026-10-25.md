# Fundraising readiness map — 2026-10-25

The owner's Fundraising readiness canvas (#2433, boards RD1–RD19), read against the code on `origin/main` at `dcd1386be1`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1141.

## 1. The canvas

`design/incoming/Fundraising readiness · Boards.dc.html` holds the board grid, which imports `Fundraising Readiness Page.dc.html`.

| Boards | What they draw |
|---|---|
| RD1 | The founder's page at desktop: Product-market fit and the raise kit side by side, the inputs, the gaps and the next steps (RD1r: runway with no Mercury connection) |
| RD2–RD3 | An input as a lightbox: Claims supported, Paying demand |
| RD4 | How Product-market fit is scored: model v1.0, the ten inputs, weights, grades and bands |
| RD5–RD7 | A checklist item (Traction proof), Re-score, Score Team |
| RD8–RD10 | Score history, Product pull before and after a product is live, after a Pivot |
| RD11 | Eadwyn: Explain this score |
| RD12 | Validate's overview hand-off chip |
| RD13 | Admin and Super Admin |
| RD14–RD19 | Empty, loading, error and partial, no access, phone, dark |

## 2. #2433's broken items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | A person can overwrite a computed check | **Fixed** by #2445: `PUT /readiness/:key` refuses every computed key with 400 and writes nothing (`raise_writes_d691.test.ts`) |
| 2 | Team is self-scored and can be called measured | **Fixed** by #2445: Team with `measured` is 400 (same test). Team stays the one item a person scores, as RD7 draws |
| 3 | The overall hides how little is scored | **Fixed** by #2445: the figure carries `coverage: {scored, total}`, counting valid checks only, and the overview draws "N of 7 items scored" (`CycleOverview.jsx`) |
| 4 | The Lab score sits on the card unexplained | **Fixed** by #2445: the row reads "Your Lab score" (`benchmarkRows`) |
| 5 | A claim's verdict ignores most of its evidence | Open. Owner question 6, A, keeps Validate's verdict rule; Product-market fit counts paid demand and experiments as its own inputs (part 2) |
| 6 | The experiments chart counts pain links only | Open (`cycleValidate.ts`, the per-week query reads `hypothesis_pain_links`). Left with question 6 |
| 7 | An experiment has no outcome field | Open. Part 2 reads an outcome from an evidence link's direction (`hypothesis_evidence_links`) |
| 8 | Two other lists are called "readiness" | Open, a naming question; not this canvas's |

## 3. What the page can read today

| Block | Read | Drawn by D1141 |
|---|---|---|
| Readiness items, the overall, the gaps | `GET /api/cycles/raise/modules/fundraising-readiness` and the overview's `readiness_score` figure | Unchanged: the module page as CycleRoute draws it |
| Runway | `parts.mercury` (the founder's own read) | Unchanged: the From Mercury part |
| Product-market fit | none: no service, store or route computes it (`grep` for `pmf` and "product-market fit" in `cloudflare-worker/src` finds only copy and prompts) | Not scored yet, with model v1 shown as proposed and a link to Validate |
| Inputs, confidence, coverage, next steps | none | Not drawn (part 4, after parts 2 and 3) |
| History | none: `venture_scorecards` and `scoring_model_versions` do not exist | Not drawn (part 3) |
| Validate's hand-off | the Validate overview, unchanged | One line with a link to the readiness page (RD12, the chip is part 5) |

## 4. What waits, and on what

- **The engine** (part 2, #3029): a pure `scorePmf` over model v1 as data, with a collector over Validate's loaders. Nothing else can start before it.
- **The store and the reads** (part 3, #3030, migration 598): the scorecard rows, `parts.pmf`, history, Re-score, the audit, and checklist item 8. SCORING (#2428) defines the same two tables; whichever lands first creates them.
- **The page** (part 4, #3031), **RD4 and RD12's chip** (part 5, #3032) and **Eadwyn** (part 6, #3033) follow part 3.
