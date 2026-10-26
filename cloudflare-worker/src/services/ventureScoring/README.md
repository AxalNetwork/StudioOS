# Venture scorecard engine

D1255 (#3278, part 2 of #2428). The engine behind the eleven-scope venture
scorecard that D1253's panel and strip draw. No route reads it yet:
`/api/venture-scores` is part 3 (#3279).

| File | What it holds |
|---|---|
| `model.ts` | Model v1 as data, and v1.1 (D1259: v1 with the country indices given a store), in `VENTURE_MODELS`: the ten scopes this engine scores, each input's weight, rule, freshness window and store, the floor, confidence cut-offs and bands, and `NEVER_READ`. Product-market fit is `../scoring/pmf.ts` (D1143), reused unchanged. |
| `engine.ts` | The pure `scoreScope`: value, band, confidence and coverage. Not recorded is never 0 and never 50; weights renormalise; the grade sets confidence, never the value; stale halves a grade; below 0.25 is "Not enough recorded". |
| `collectors.ts` | One collector per scope, every statement static and bound (`STATEMENTS`). Personal inputs leave as one count per venture. |
| `store.ts` | `scoreVenture` recomputes on read and keeps a signed row per scope only when its input hash changed, in migration 598's shared store (`state` from 625), with the live model (`liveModel`: the latest publication, else v1). PMF is recomputed by `../scoring/pmfStore.ts`, its one writer. `storedScorecard` reads without recomputing. |
| `countryIndex.ts` | D1259: the country index sources with their recorded licences (`INDEX_SOURCES`), the WGI fetch and list import into migration 627's editions and values, and HQ's source read. A source without a recorded licence is neither imported nor read. |
| `publish.ts` | D1259: `publishModel` makes a newer version live; `continuePublication` rescores every venture in claimed batches from the every-minute job; `modelVersions` and `modelChanges` feed HQ › Scoring. |

Rules for adding to it:

- A new input or weight is a new model version, never an edit of v1. A
  stored model row that differs from the code is refused
  (`scorecard_model_mismatch`).
- Each input feeds one scope only.
- Never an input: name, email, photo, gender, age or date of birth,
  nationality, residence, ethnicity, religion, health, school or employer,
  or `kyc_data`. `test/venture_scoring_d1255.test.ts` scans every statement.
- No client sends a computed field, and no score sets a deal or venture
  status. Callers gate the venture first.
