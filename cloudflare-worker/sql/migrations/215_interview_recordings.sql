-- 215 — a recording, and the text it became.
--
-- This is the third of the three things the rail's mode note promises, and the
-- one migration 214 said it could not keep: "`discovery_interviews` has no
-- transcript, no recording key, no duration and no audio column, and no R2
-- allowlist in this worker admits an audio MIME. It is a separate migration and
-- a separate task class, and until it lands the mode note names two things
-- rather than three." This is that migration.
--
-- THE SHAPE IS COPIED FROM `reference_checks`, WHICH HAS HAD IT SINCE t13 AND
-- HAS NEVER WORKED. That table declares `recording_file_key`,
-- `recording_size_bytes`, `recording_content_type`, `recording_uploaded_at`,
-- `transcript` and `transcribed_at`, and all four of its routes return 501
-- ("Transcription not yet supported in worker"). It is a good shape and a
-- warning at the same time: columns without routes are a promise the schema
-- makes on the product's behalf. The routes land in the same change as these
-- columns.
--
-- WHY THE COLUMNS ARE ON `discovery_interviews` AND NOT A SIDE TABLE. One
-- interview has at most one recording — it is the conversation, not an
-- attachment to it — and a 1:1 table would mean a JOIN on every read of a row
-- that is already read on four pages. `users` is the reason to hesitate (it sits
-- at D1's 100-column ceiling, which is why migration 199 moved the super-admin
-- elevation to a side table); `discovery_interviews` has sixteen columns, so
-- five more is not close to that wall.
--
-- WHAT IS DELIBERATELY NOT HERE:
--
--   · A DURATION THE CLIENT SENDS. `recording_duration_sec` is what a browser
--     measured, and it is for DISPLAY only. Billing uses
--     `audioMinutesFromBytes` over `recording_size_bytes`, because a number the
--     client chooses must not decide what a run costs.
--   · A TRANSCRIPT VERSION HISTORY. Re-transcribing overwrites. The audio is
--     retained, so a second run is reproducible from the source rather than
--     from a copy of an older answer.
--   · SPEAKER LABELS OR TIMESTAMPS. Whisper returns `words` and `vtt` and the
--     product has nowhere to show either. Storing them because they arrive is
--     how a column comes to exist that nothing reads — which is the same
--     mistake `interview_pain_severities` (migration 211) is still sitting in.
--
-- NO TRANSACTION STATEMENTS. D1's HTTP API rejects BEGIN/COMMIT in a migration
-- file; migration 200 shipped with them and failed the production deploy at the
-- migration step.

-- The R2 object key. DERIVED SERVER-SIDE from the owner and a fresh uid — a
-- caller-supplied key is a path-traversal write into another account's prefix,
-- which is the rule `routes/research.ts` states at its own upload.
ALTER TABLE discovery_interviews ADD COLUMN recording_r2_key TEXT;

-- The MIME the upload declared, checked against an allowlist before the object
-- was written. Kept so a download can be served with the type it arrived as
-- rather than a guess from the extension.
ALTER TABLE discovery_interviews ADD COLUMN recording_mime TEXT;

-- Byte length, and the only input to what a transcription costs. See
-- `audioMinutesFromBytes` in `services/aiRouter.ts` for why bytes and not the
-- duration below.
ALTER TABLE discovery_interviews ADD COLUMN recording_size_bytes INTEGER;

-- What the browser measured, for the screen. NULL is a real state and means the
-- client could not read a duration — which happens for a stream with no
-- container metadata — and the UI says "length not recorded" rather than 0:00.
ALTER TABLE discovery_interviews ADD COLUMN recording_duration_sec INTEGER;

ALTER TABLE discovery_interviews ADD COLUMN recording_uploaded_at TEXT;

-- The text. NULL means not transcribed; empty string means transcribed and the
-- clip contained no speech, which is an answer and not a failure. Folding the
-- two together would have the UI offer "Transcribe" forever on a silent clip,
-- and charge for it every time.
ALTER TABLE discovery_interviews ADD COLUMN transcript TEXT;

ALTER TABLE discovery_interviews ADD COLUMN transcribed_at TEXT;

-- The model that produced it. Same reason `validate_proposals` records one: the
-- router falls back to a smaller sibling under load, so the model that ran is
-- not always the model that was asked for, and a transcript is an artefact
-- whose quality depends on which one did the work.
ALTER TABLE discovery_interviews ADD COLUMN transcribed_by_model TEXT;
