-- Illustration sex for the Profile & Fit archetype sprite.
--
-- Lives on user_settings (NOT users — that table is at the D1 column ceiling).
-- Values: 'm' | 'f' | 'both' | NULL. NULL means unset; the card then falls
-- back to pronouns (he/him → m, she/her → f) or shows both sprites.
-- Additive, nullable, no backfill.

ALTER TABLE user_settings ADD COLUMN archetype_sex TEXT;
