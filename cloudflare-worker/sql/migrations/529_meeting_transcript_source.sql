-- 529 — where a call's text came from, the call's language, and its audio run (D870, #2517).
--
-- Additive. A Zoom call with no native transcript is now transcribed from its
-- authorized audio recording by Workers AI speech-to-text
-- (`services/channels/meetingAudio.ts`). These columns say which path a call
-- took and what the next import does. Every existing row stays NULL: a call
-- imported before 529 reads as "source not recorded", never as native.
--
-- Grep first (D-t): `interview_channel_refs` is migration 449's; 451 and 452
-- touch other columns. No earlier migration adds these columns. No BEGIN/COMMIT.
--
--   interview_channel_refs.transcript_source
--     'native' (the provider's own transcript) or 'whisper' (Workers AI over the
--     call's audio). NULL until an import, and on rows from before 529.
--   interview_channel_refs.call_lang
--     The call's language as the founder set it, ISO-639-1 with an optional
--     region (`meetings.ts` normalCallLang). NULL is auto. Not English prefers
--     the audio path over an English provider transcript.
--   interview_channel_refs.stt_reservation_uid
--     The audio run's key, minted when the call's audio is first stored as
--     chunks; the chunks' R2 metadata carry it, so a resumed run is the same run.
ALTER TABLE interview_channel_refs ADD COLUMN transcript_source TEXT CHECK (transcript_source IN ('native', 'whisper'));
ALTER TABLE interview_channel_refs ADD COLUMN call_lang TEXT;
ALTER TABLE interview_channel_refs ADD COLUMN stt_reservation_uid TEXT;
