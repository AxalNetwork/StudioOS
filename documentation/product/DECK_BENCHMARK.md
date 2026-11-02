# Deck benchmark

D1518 (#3770, deck v2 A7). Our deck against the five bars (Gamma, Canva, Pitch, Genspark and Dokie), measured by one harness (`scripts/eval-elements.mjs`, `scripts/lib/deckEval.mjs`). Every figure on this page is measured; an arm not run says so and carries no figure.

## The zero-edit acceptance arm (the gate for #3768)

The owner's bar: one press of "Generate from my data" gives a deck presentable with **zero edits**. The arm scores the one-click output for the three sample ventures exactly as generated: `buildCards` on each venture's records, every unrecorded record unticked (as the one-click run does), the recorded words the fake binding answers (`cloudflare-worker/test/_fake_ai.mjs`, D1511). It passes when:

- rubric v0 (D1517's code rubric) is at least `RUBRIC_GATE`;
- the deck draws **0** "Not recorded" placeholders;
- **0** blocks overflow.

#3768's zero-edit acceptance is measured here. Gamma and Dokie are compared on the same brief once the owner's decision F allows those arms.

Baseline, 2026-11-01 (refresh with `scripts/eval-elements.mjs --benchmark --write`; `cloudflare-worker/test/deck_eval_d1518.test.ts` fails when this table and the arm disagree):

<!-- zero-edit:start -->
| Venture | Rubric v0 | "Not recorded" | Overflow | Verdict | Gamma | Dokie |
| --- | --- | --- | --- | --- | --- | --- |
| full | 100 | 0 | 0 | pass | not run (F) | not run (F) |
| sparse | 86 | 7 | 0 | fail: 7 "Not recorded" placeholder(s) | not run (F) | not run (F) |
| conflicting | 100 | 0 | 0 | pass | not run (F) | not run (F) |
<!-- zero-edit:end -->

**Reading today's baseline.** The full and conflicting ventures pass. The sparse venture does not: with its unrecorded records unticked it still draws "Not recorded" lines on cards whose every record is missing. That is the gap #3768 closes, and this row turning to "pass" is its acceptance.

## The competitor arms

| Tool | Status |
| --- | --- |
| Gamma | not run: owner decision F (benchmark access) is pending |
| Canva | not run: owner decision F (benchmark access) is pending |
| Pitch | not run: owner decision F (benchmark access) is pending |
| Genspark | not run: owner decision F (benchmark access) is pending |
| Dokie | not run: owner decision F (benchmark access) is pending |

Buying access is the owner's (F); spend on evaluation waits on decision N. Neither is assumed here.

## Editing tasks v0

Editing stays available after one-click generation, so the editing tasks (plan §7.4 and §7.4b) are kept beside the zero-edit arm: `EDITING_TASKS_V0` in `scripts/lib/deckEval.mjs`, each with a target number of steps. None has been timed yet; each is timed by a person, ours against each bar F allows, and written here with the date.

## The investor rubric

Recorded, not gated: `INVESTOR_RUBRIC_V0` in `scripts/lib/deckEval.mjs` (problem, why now, traction, team, ask, flow; 1 to 5 by a person). No score has been recorded yet.
