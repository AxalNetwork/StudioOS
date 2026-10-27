# Venture scorecard engine

D1255 (#3278, part 2 of #2428). The engine behind the eleven-scope venture
scorecard that D1253's panel and strip draw. D1256 (#3279, part 3) reads it
through `/api/venture-scores` (`../../routes/venture_scores.ts`).

| File | What it holds |
|---|---|
| `model.ts` | Model v1 as data: the ten scopes this engine scores, each input's weight, rule, freshness window and store, the floor, confidence cut-offs and bands, and `NEVER_READ`. Product-market fit is `../scoring/pmf.ts` (D1143), reused unchanged. |
| `engine.ts` | The pure `scoreScope`: value, band, confidence and coverage. Not recorded is never 0 and never 50; weights renormalise; the grade sets confidence, never the value; stale halves a grade; below 0.25 is "Not enough recorded". |
| `collectors.ts` | One collector per scope, every statement static and bound (`STATEMENTS`). Personal inputs leave as one count per venture. |
| `access.ts` | D1256: who reads a scorecard and what they see (founder, staff, shared advisor; an investor through a deal, masked before the NDA, never when the founder's switch is off), the logged reads, reviews, corrections, weighting and sharing (migration 626). |
| `jobs.ts` | D1256: the nightly recompute, the recompute after a connector sync, and the quarterly fairness aggregate (cells under five ventures suppressed). |
| `store.ts` | `scoreVenture` recomputes on read and keeps a signed row per scope only when its input hash changed, in migration 598's shared store (`state` from 625). PMF is recomputed by `../scoring/pmfStore.ts`, its one writer. `storedScorecard` reads without recomputing. |

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
