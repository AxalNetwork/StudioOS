-- 527 — a session's segments translated into the founder's working language (D857, #2502).
--
-- Additive, nullable, nothing backfilled. A segment written before this, or
-- not yet reached, has every column NULL and reads as "not translated yet";
-- the next structuring pass translates it (`services/sessionTranslation.ts`).
--
-- Grep first (D-t): no column named source_lang, translated_*, translation_*
-- or validate_working_lang exists in schema_baseline.sql or any earlier
-- migration. No BEGIN/COMMIT.
--
--   interview_transcript_segments
--     source_lang                  The detected language (ISO 639-1), or NULL when unknown.
--     translated_text              The translation, columnCipher ciphertext (AAD
--                                  `interview_transcript_segments:translated_text:<id>`).
--                                  Customer content: never logged, and gone with the row.
--     translated_lang              The language it was translated into.
--     translation_model            The model that answered.
--     translation_reservation_uid  The AI token hold it was charged under (D844), from its ai_usage_logs row.
--     translation_status           done | same (already in the working language: nothing charged) |
--                                  pending (failed or refused: the original stands, and it is retried) |
--                                  undetected (no language could be placed: the original stands).
--     translation_attempts         How many times a pending segment has been tried; it stops at three.
--
--   user_settings
--     validate_working_lang        The member's working language for Validate. NULL is the
--                                  account's own language (`locale`), else English (D857 Q1, A).

ALTER TABLE interview_transcript_segments ADD COLUMN source_lang TEXT;
ALTER TABLE interview_transcript_segments ADD COLUMN translated_text TEXT;
ALTER TABLE interview_transcript_segments ADD COLUMN translated_lang TEXT;
ALTER TABLE interview_transcript_segments ADD COLUMN translation_model TEXT;
ALTER TABLE interview_transcript_segments ADD COLUMN translation_reservation_uid TEXT;
ALTER TABLE interview_transcript_segments ADD COLUMN translation_status TEXT
  CHECK (translation_status IS NULL OR translation_status IN ('done', 'same', 'pending', 'undetected'));
ALTER TABLE interview_transcript_segments ADD COLUMN translation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN validate_working_lang TEXT;
