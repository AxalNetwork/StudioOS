-- Advisor directory: relationship fields so advisor cards can surface the
-- last session, running notes, and the next follow-up. Nullable TEXT columns
-- (ISO-8601 dates for *_at) on the founder-scoped advisor_profiles table.
ALTER TABLE advisor_profiles ADD COLUMN last_session_at TEXT;
ALTER TABLE advisor_profiles ADD COLUMN notes TEXT;
ALTER TABLE advisor_profiles ADD COLUMN follow_up_at TEXT;
ALTER TABLE advisor_profiles ADD COLUMN follow_up_note TEXT;
