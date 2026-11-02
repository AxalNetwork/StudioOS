# Element eval

D1518 (#3770, deck v2 A7). Each routed deck element measured against the models its job may use, so the defaults on #3721's plan are measured, not guessed. **This file is the proposal:** it holds the plan's jobs as the eval reads them and, once a live run has been made, the change each measurement proposes to #3721's plan. There is no separate defaults file; a measured change lands in `cloudflare-worker/src/services/ai/modelUseCases.ts` (and so in `ELEMENT_ROUTES`) through #3721, never here. No model id is listed here: the catalogue (`services/ai/catalogue.ts`, D760) is the only model list.

## How it runs

`scripts/eval-elements.mjs` reads `scripts/lib/deckEval.mjs`:

- `--plan` (the default): each golden brief, its element's job and the models #3741's rail suggests for it. Calls nothing.
- `--benchmark`: the zero-edit acceptance arm (see `DECK_BENCHMARK.md`). Calls no model.
- `--live`: each brief through each suggested model on a staging Worker. **Refused** until the owner sets the evaluation cap (decision N) and a staging URL, and never against production.

```
node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs scripts/eval-elements.mjs --plan
```

## The golden briefs

Twenty briefs, one element each, written from the three sample ventures' records (`cloudflare-worker/test/fixtures/pitchStoryFixtures.ts`: full, sparse, conflicting). **A brief is a venture's records and the card it is for, never a prompt**: New deck has no prompt field (plan §0 row 3), so a brief is the input the one-click run reads. Each brief says what a run must hold to:

- `records_only`: every figure it writes is one its records hold (D1503's output rule);
- `fits`: its words fit the card's areas at the smallest step (D1517);
- `honest_gaps`: on the sparse venture, a missing record stays "Not recorded", never a made-up figure.

## The plan's jobs

The jobs #3721's plan gives each routed element. `cloudflare-worker/test/deck_eval_d1518.test.ts` holds this table equal to `ELEMENT_ROUTES` both ways: an element routed with no row here, a row for an element no longer routed, or a job that differs fails the build.

<!-- plan-jobs:start -->
| Element | Group | Job | Kind | Golden briefs | Eval | Proposed change to #3721 |
| --- | --- | --- | --- | --- | --- | --- |
| title | text | DK2 | write | 2 | not run (N) | none until measured |
| kicker | text | DK2 | write | 1 | not run (N) | none until measured |
| body | text | DK2 | write | 1 | not run (N) | none until measured |
| bullets | text | DK2 | write | 1 | not run (N) | none until measured |
| callout | text | DK2 | write | 1 | not run (N) | none until measured |
| caption | text | DK2 | write | 0 | not run (N) | none until measured |
| team_bios | text | DK2 | write | 2 | not run (N) | none until measured |
| speaker_notes | text | DK2 | write | 1 | not run (N) | none until measured |
| photo | images | DK4 | draw | 1 | not run (N) | none until measured |
| illustration | images | DK4 | draw | 1 | not run (N) | none until measured |
| edit_vary | images | DK5 | edit_image | 0 | not run (N) | none until measured |
| remove_bg | images | DK5 | edit_image | 0 | not run (N) | none until measured |
| upscale | images | DK5 | edit_image | 0 | not run (N) | none until measured |
| chart | data | DK2 | write | 1 | not run (N) | none until measured |
| table | data | DK2 | write | 1 | not run (N) | none until measured |
| timeline | data | DK2 | write | 1 | not run (N) | none until measured |
| market_size | data | DK2 | write | 1 | not run (N) | none until measured |
| projections | data | DK2 | write | 0 | not run (N) | none until measured |
| competition | data | DK2 | write | 1 | not run (N) | none until measured |
| typed_table | data | DK2 | write | 0 | not run (N) | none until measured |
| market_chart | data | DK2 | write | 0 | not run (N) | none until measured |
| projection_chart | data | DK2 | write | 0 | not run (N) | none until measured |
| positioning | data | DK2 | write | 0 | not run (N) | none until measured |
| flow | diagrams | DK2 | write | 0 | not run (N) | none until measured |
| cycle | diagrams | DK2 | write | 0 | not run (N) | none until measured |
| matrix | diagrams | DK2 | write | 0 | not run (N) | none until measured |
| funnel | diagrams | DK2 | write | 1 | not run (N) | none until measured |
| hierarchy | diagrams | DK2 | write | 0 | not run (N) | none until measured |
| hub | diagrams | DK2 | write | 0 | not run (N) | none until measured |
| use_of_funds | venture | DK3 | write | 1 | not run (N) | none until measured |
| round_terms | venture | DK3 | write | 1 | not run (N) | none until measured |
| interview_quote | venture | DK3 | write | 0 | not run (N) | none until measured |
| cap_table | venture | DK3 | write | 1 | not run (N) | none until measured |
<!-- plan-jobs:end -->

`Eval` reads "not run (N)" until the owner sets the evaluation cap (decision N). `Proposed change` stays "none until measured": a change is proposed only from a measured run, with the run's date, the briefs it passed and its cost.

## Scoring

Rubric v0 is D1517's code rubric (`services/decks/rubric.ts`, gate `RUBRIC_GATE`). The investor rubric v0 (problem, why now, traction, team, ask, flow; 1 to 5 by a person) is recorded beside it and **never gated**.
