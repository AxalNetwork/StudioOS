-- 557 / D991 / #2802: Partner profiles part 2 — who reviewed a profile and
-- when, the reason a member reads, Reopen, an append-only history, and the
-- flag for a profile that changed after its verdict. Assigned by S21 on
-- #2802 (D989 §6). Additive: no existing row or column changes.
--
-- ON THE PROFILE (what is true now):
--   reviewed_at              when the current verdict was given (ISO text).
--   reviewed_by              the admin who gave it (users.id).
--   reject_reason            the member-facing reason of a rejection, which
--                            the member reads. Null unless rejected.
--   changed_after_review_at  set when a capture lands on a profile that has a
--                            verdict: the verdict stays and the page draws the
--                            flag (D989 §5, owner decision 3). Cleared by the
--                            next verdict or a Reopen.
-- A verdict given before this migration has no date or reviewer stored
-- anywhere, so those stay null and read "Not recorded".
--
-- THE HISTORY (what happened): `partner_profile_events`, one row per capture
-- and per decision, never updated or deleted. It is keyed by the profile's
-- reference (556), never by its email. `source` says which writer captured
-- (the onboarding chat, a partner invitation, Eadwyn's partner questions) and
-- is set only on a capture. `admin_user_id` is set only on a decision. It
-- starts here: nothing before 557 recorded these events, so none is invented.

ALTER TABLE partner_profiles ADD COLUMN reviewed_at TEXT;
ALTER TABLE partner_profiles ADD COLUMN reviewed_by INTEGER;
ALTER TABLE partner_profiles ADD COLUMN reject_reason TEXT;
ALTER TABLE partner_profiles ADD COLUMN changed_after_review_at TEXT;

CREATE TABLE IF NOT EXISTS partner_profile_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('captured', 'verified', 'rejected', 'reopened')),
  source TEXT CHECK (source IN ('chat', 'invitation', 'eadwyn')),
  admin_user_id INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL,
  CHECK ((kind = 'captured') = (source IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_partner_profile_events_ref
  ON partner_profile_events(profile_ref, created_at);
