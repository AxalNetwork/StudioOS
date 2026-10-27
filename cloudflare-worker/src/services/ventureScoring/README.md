# Venture scorecard engine

D1255 (#3278, part 2 of #2428). The engine behind the eleven-scope venture
scorecard that D1253's panel and strip draw. D1256 (#3279, part 3) reads it
through `/api/venture-scores` (`../../routes/venture_scores.ts`).

| File | What it holds |
|---|---|
| `model.ts` | Model v1 as data, and v1.1 (D1259: v1 with the country indices given a store), in `VENTURE_MODELS`: the ten scopes this engine scores, each input's weight, rule, freshness window and store, the floor, confidence cut-offs and bands, and `NEVER_READ`. Product-market fit is `../scoring/pmf.ts` (D1143), reused unchanged. |
| `engine.ts` | The pure `scoreScope`: value, band, confidence and coverage. Not recorded is never 0 and never 50; weights renormalise; the grade sets confidence, never the value; stale halves a grade; below 0.25 is "Not enough recorded". |
| `collectors.ts` | One collector per scope, every statement static and bound (`STATEMENTS`). Personal inputs leave as one count per venture. |
| `store.ts` | `scoreVenture` recomputes on read and keeps a signed row per scope only when its input hash changed, in migration 598's shared store (`state` from 625), with the live model (`liveModel`: the latest publication, else v1). PMF is recomputed by `../scoring/pmfStore.ts`, its one writer. `storedScorecard` reads without recomputing. |
| `countryIndex.ts` | D1259: the country index sources with their recorded licences (`INDEX_SOURCES`), the WGI fetch and list import into migration 627's editions and values, and HQ's source read. A source without a recorded licence is neither imported nor read. |
| `publish.ts` | D1259: `publishModel` makes a newer version live; `continuePublication` rescores every venture in claimed batches from the every-minute job; `modelVersions` and `modelChanges` feed HQ › Scoring. |
| `access.ts` | D1256: who reads a scorecard and what they see (founder, staff, shared advisor; an investor through a deal, masked before the NDA, never when the founder's switch is off), the logged reads, reviews, corrections, weighting and sharing (migration 626). |
| `riskLayers.ts` | D1260: the ten venture-risk layers as Risk's sub-rows (SC5): each layer's analyst review from `venture_risk_overrides`, or Not reviewed, never 0. Read with every scorecard read and never stored; the analyst's note is staff's only, and an investor gets the layers only after the NDA. The old automatic layer score is not read. |
| `jobs.ts` | D1256: the nightly recompute, the recompute after a connector sync, and the quarterly fairness aggregate (cells under five ventures suppressed). |

Rules for adding to it:

- A new input or weight is a new model version, never an edit of v1. A
  stored model row that differs from the code is refused
  (`scorecard_model_mismatch`).
- Each input feeds one scope only.
- Never an input: name, email, photo, gender, age or date of birth,
  nationality, residence, ethnicity, religion, health, school or employer,
  or `kyc_data`. `../../../test/venture_scoring_d1255.test.ts` scans every statement.
- No client sends a computed field, and no score sets a deal or venture
  status. Callers gate the venture first.

**The Raise evidence pack (D1269 §3).** SCORING's one read of the founder's evidence is `evidencePack(env, projectId, { audience: 'scoring' })` in `../raiseEvidence.ts` (D1265 §5): items shared beyond Private and current at read, each with its `backs`, Source label and the value an investor after the NDA would see, the linked claim states, and `pack_hash`. The collectors here do not call it yet; only `mercuryRunway` is read from `../raiseEvidence.ts`. When a part wires it, no input is read from a Private item, the grade stays `SOURCE_GRADE`'s, and the pack's hash is stored with the scorecard row.
