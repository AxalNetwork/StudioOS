### Pitch preflight dismissals (D4208, #4208)

- **Worker:** `routes/deck_preflight.ts`, mounted by the route registry at `/api/decks`, before `decks.ts`:
  - `GET /:id/preflight/dismissals?version=<n>` → `{ deck_id, version, dismissed: [finding_id] }`
  - `PUT /:id/preflight/dismissals` `{ version, finding_id, dismissed, severity? }` → the same shape, after the write.
- **Who:** the access of `GET /api/decks/:id`. A reader may read; only an editor may write.
- **Kept per version:** one row per `(deck_id, version, finding_id)` in `deck_preflight_dismissals` (migration `202611022244_deck_preflight_dismissals.sql`). A new version starts clean. Only the finding's id is stored, never its words.
- **Blocking is never dismissed:** `layout`, `overflow`, an `image` block with no image (read from the version's own card), and a finding the client calls `blocking` are each refused 422 `finding_blocking`.
- **Client:** `lib/api/deckPreflight.js` (`deckPreflightApi.dismissals`, `setDismissed`). The preflight panel's `usePreflight` reads it on open and writes on Dismiss and Undo once that panel is on main (#3661).
