### Pitch › Script & rehearsal: likely questions answered, and the Rehearsals list (D4270, #4270)

- **Worker:** `routes/deck_qa.ts` adds `PUT`/`DELETE /api/decks/:id/qa/answers/:key` and `POST /api/decks/:id/qa/answers` (migration `202611031500_deck_qa_written`); `GET /api/decks/:id/qa` adds `written`, `answered`, typed questions, `answered_count` of `total`. `routes/deck_rehearsals.ts`'s list adds wpm, fillers, cards over and notes covered per run.
- **Who:** the founder writes; an HQ admin reads; a support session does neither. Never shown to investors: no other route reads `deck_qa_written`.
- **Client:** `deckQaApi.saveAnswer`, `addQuestion`, `removeAnswer`; `/raise/pitch/script?view=questions` and `?view=rehearsals` (`ScriptTile.jsx`).
