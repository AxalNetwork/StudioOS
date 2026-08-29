-- 183 — the two fields the Co-marketing pitch form has always asked for in the
-- design and never had anywhere to put.
--
-- The canvas's pitch form has four inputs: content type, title, "Angle · what
-- makes this worth an audience's time", and "What you bring · audience &
-- distribution". Only the first two map onto columns. The angle is the field
-- the review actually turns on — the canvas's own copy says "Specific angles
-- get approved. 'How we cut onboarding to 4 minutes' beats 'onboarding best
-- practices'" — and it was the one thing a reviewer could not read.
--
-- Both are nullable, so every one of the existing rows stays valid and the
-- form keeps working for anyone who does not fill them in. Nothing is
-- backfilled: an older pitch genuinely has no angle on file, and inventing one
-- from its summary would put words in a partner's mouth.
--
-- NOT idempotent (SQLite has no ADD COLUMN IF NOT EXISTS) — the ledger in
-- scripts/migrate-d1.mjs is what stops a replay.

ALTER TABLE comarketing_pitches ADD COLUMN angle TEXT;
ALTER TABLE comarketing_pitches ADD COLUMN what_you_bring TEXT;
