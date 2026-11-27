### A deck version's working copy (D1501, #3751)

`routes/deck_draft.ts`, mounted at `/api/decks` beside `deck_grid.ts`, before `decks`, over migration 715's `pitch_deck_cards`. Client: `lib/api/deckDraft.js` (`deckDraftApi`), read through `deckV2Adapter.saveCard`, `discardDraft` and `draft` (`SWAPPED` rows). The autosave loop, IndexedDB replay and the offline, conflict and restore banners are #3767's.

| Route | Who | What it answers |
| --- | --- | --- |
| `PATCH /api/decks/:id/cards/:uid` | the deck's writers (`projectOwned` write) | Takes `{ card, ord? }` with `If-Match: <rev>` (`0` for the card's first copy). `{ ok, deck_id, card: { uid, ord, rev, updated_at, card } }`, the revision one higher. 409 `card_rev_conflict` `{ rev, server }` when another tab or member changed it; 409 `draft_full` past 60 cards; 428 `if_match_required`; 400 `invalid_if_match`, `invalid_card_uid`, `card_required`, `invalid_ord`, `SLIDE_MODEL` (the save's own model rules). |
| `GET /api/decks/:id/draft` | the deck's readers | `{ deck_id, version, rev, updated_at, cards: [{ uid, ord, rev, updated_at, card }] }`; no draft reads as `cards: []`. |
| `DELETE /api/decks/:id/draft` | the deck's writers | `{ ok, deck_id, discarded }`. |
| `PUT /api/decks/:id` (changed) | as before | `If-Match: <version>`, when sent, must be the version being saved and it must be current; otherwise 409 `deck_version_conflict` with `{ current: { id, version }, rev, server, message }`, the body #3748's stale base now answers too. Without the header, the save works as before. |

No share link, export or reader reads `pitch_deck_cards`: "Save as version" stays the explicit `PUT`.

