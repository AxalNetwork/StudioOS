### Pitch › Script & rehearsal › Script (D4268, #4268)

- **`deck_script.ts`** (self-mounting ahead of `decks`), over `services/decks/script.ts`:
  - `POST /api/decks/:id/script/quote` and `POST /api/decks/:id/script` `{ length_s, audience, tone, cards? }`: the whole-deck script, card by card. One quote, one hold, each card its own run under it on `deck:notes`, settled once at what the placed cards cost. A card whose draft names a figure that is not on it fails at zero. Nothing is saved.
  - `PUT /api/decks/:id/notes-script` `{ notes: [{ card_uid, notes }] }`: the notes-only save, one version.

  The venture's writers only. No migration; the pace reads `deck_rehearsals` (migration 743).
- **Frontend:** `deckScriptApi` in `frontend/src/lib/api/deckScript.js`; `ScriptTab.jsx` replaces the tile's "coming" placeholder at `/raise/pitch/script`.
