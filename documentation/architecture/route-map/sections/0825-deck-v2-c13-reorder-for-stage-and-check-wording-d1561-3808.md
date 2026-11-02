### Deck v2 C13: Reorder for stage and Check wording (D1561, #3808)

`routes/deck_actions.ts`, mounted at `/api/decks` ahead of `decks` (its `mount` export). Rules in `services/decks/deckActions.ts`; the order is D1522's stage plan (`services/decks/stagePlan.ts`). Client: `lib/api/deckActions.js` (`deckActionsApi`), read through `deckV2Adapter.deckActions` (a `SWAPPED` row) by the stage sheet (`DeckSheets.jsx` `StageSheet`, ⋯ › Stage and ⋯ › Reorder for stage), and directly by the Check claims sheet's Wording section (`WordingSection.jsx`). No migration.

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/decks/:id/reorder-for-stage` `{ stage?, investor_type? }` | the venture's deck writers (`projectOwned`, write) | `{ deck, stage, stage_label, stage_source, moved, one_undo_step: true }`: one new version, every card kept, in the stage plan's order. `{ unchanged: true, moved: 0 }` when already in order (nothing written). 409 version conflict when the version is no longer current; 503 `unreadable`; 400; 403; 404. Free: no model. |
| `POST /api/decks/:id/check/wording/quote` | the venture's deck writers | `{ ai: true, hold_microusd, model }` \| `{ ai: false, reason, message }`. Runs nothing. |
| `POST /api/decks/:id/check/wording` | the venture's deck writers | `{ deck_id, version, state: 'ok', findings: [{ key, kind: guarantee \| unsupported, label, card_uid, card_index, quote, message, action }], dropped, cost }` \| `{ state: 'off', message }`. One run under `deck:wording`, charged only when pressed; a finding is shown only when its quote is on its card word for word. 403; 404; 503 `unreadable`. |

Check claims' figures (`GET /api/decks/:id/figures`, D1523) and consistency (`consistency` on `GET`/`POST /api/decks/:id/check`, D1555) are unchanged; the sheet draws them beside Wording.
