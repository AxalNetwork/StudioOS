### Pitch › Share & analytics: viewer feedback (D6064, #6064)

- **`deck_share_feedback.ts`**: `GET /api/decks/:id/share-feedback?version=N` answers the deck's venture across its versions: each viewer's per-card reactions and written feedback, by investor link, newest first, at most 200 (`truncated` past it). The owner and co-founders only (`deckFor(…, true)`). `viewer` is signed in or anonymous, never an identity. No migration (071, 714).
- **Frontend:** `deckShareFeedbackApi.read` in `frontend/src/lib/api/deckShareFeedback.js`; `ShareFeedback.jsx` in the Share & analytics board. The note also appears on the Customer Discovery panel, and the block says so.
