### The stage plan (D1522, #3774)

`routes/deck_stage.ts`, mounted at `/api/decks` beside `deck_grid.ts`. Rules in `services/narrative/arcs.ts`, records read by `services/decks/stagePlan.ts` (also called by the one-click run). Client: `lib/api/deckStage.js` (`deckStageApi.stagePlan`), read through `deckV2Adapter.stagePlan` (a `SWAPPED` row).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/decks/:id/stage-plan?stage=&investor_type=` | whoever may read the deck (`projectOwned`) | `{ deck_id, version, stage, stage_label, stage_source: asked \| audience \| venture \| default, investor_type, order: [{ card, title, why, weight, required, in_deck, proof: recorded \| missing \| unchecked }], warnings: [{ card, code: missing_card \| missing_proof \| unchecked_proof, message, action }], extra, sources, evidence, objections: { state, unanswered } }`. 400 for a stage or investor type not on the lists; 403; 404. No model, no charge, no write. |
