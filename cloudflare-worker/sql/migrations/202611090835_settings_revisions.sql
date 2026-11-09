-- D4615 (#4615) — a revision per preference group, so a save can name the
-- revision it read and a stale one (a delayed request, another tab) changes
-- nothing instead of replacing a newer choice.
--
--   privacy_revision        the Visibility & discovery group (visibility,
--                           directory, discoverable, matching consent)
--   notifications_revision  digest, the per-category maps and quiet hours
--
-- The public-profile field switches live in `users.privacy_prefs`; `users` is at
-- D1's 100-column limit, so their revision is the `revision` key inside that
-- JSON, not a column (D4615 §2). Additive; every existing row reads revision 0.
-- `services/userSettings.ts` declares the same two columns at runtime.
ALTER TABLE user_settings ADD COLUMN privacy_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN notifications_revision INTEGER NOT NULL DEFAULT 0;
