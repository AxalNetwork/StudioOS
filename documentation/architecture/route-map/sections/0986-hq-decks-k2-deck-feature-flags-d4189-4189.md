### HQ › Decks K2: deck feature flags (D4189, #4189, under D4155)

- **Worker:** `routes/admin_feature_flags.ts`, behind `requireAdmin`.
  - `PUT /api/admin/feature-flags` takes `{ key, scope, scope_id?, enabled, reason }`. It answers 400 `reason_required` when the reason is shorter than 10 characters, and writes one `feature_flag_set` admin audit row with the value before and after.
  - `GET` answers `{ flags: [{ key, scope, scope_id, enabled, updated_by: { uid, name } | null, updated_at, affected }], keys, labels, cache_s }`.
- **Deck keys and their gates:** `deck:rehearsal` (`deck_rehearsals.ts`), `deck:pptx_import` (the `.pptx` upload in `imports.ts`) and `deck:logo_wall` (`POST /api/decks/:id/logos`). Off answers 404 `not_switched_on`.
- **Client:** none yet; S21's HQ › Decks PR adds `lib/api/adminFeatureFlags.js`.
