### Present › Record: the recorded walkthrough (D1590, #3837)

- **Worker:** `routes/deck_recordings.ts`, self-mounted before `decks`: `POST /api/decks/:id/recordings/quote`, `POST /api/decks/:id/recordings` (a take of one card, form upload, captions through `run()` on the Listen job `WALKTHROUGH_CAPTIONS`), `GET /api/decks/:id/recordings`, `GET /api/decks/:id/recordings/:uid/media`, `DELETE /api/decks/:id/recordings/:uid` (the stored file goes, then the row) and `PUT /api/decks/:id/recordings/links/:shareId { attach }`. Migration `202611031710_deck_recordings`.
- **Client:** `lib/api/deckRecordings.js` (`deckRecordingsApi`). The pd36 screen follows in the same PR.
- **Who:** the founder, on a deck version they may write; a take is its maker's alone. Behind `deck:walkthrough`.
- **Storage:** a take is kept until its maker deletes it (owner decision W = A) and counts in the `deck_recordings` storage area.
