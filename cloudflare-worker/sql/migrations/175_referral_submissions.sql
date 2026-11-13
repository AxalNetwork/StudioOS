-- 175 — Referral submissions pipeline.
--
-- Replaces the Stripe-Connect payout model on /referrals with a submission +
-- review pipeline. A referral is now a tracked object with a category, a
-- reviewable status, and an append-only event history — not a commission row
-- waiting on a bank transfer.
--
-- Rewards are recorded as free-text LABELS (`reward_label`, e.g. "$400 credit
-- issued", "Eligible on acceptance") rather than cents. That is deliberate:
-- the three programmes settle differently (milestone-based on formation,
-- platform credit on onboarding, negotiated case-by-case for strategic
-- introductions) and none of them move money through this platform. Storing a
-- cents amount here would re-create the payout ledger this migration exists to
-- retire, and would imply a payment obligation the product no longer makes.
--
-- NOTE: this migration deliberately does NOT drop `referral_payouts` or the
-- users.stripe_connect_* columns from 058. The Connect *code* is removed in
-- the same change, but historical rows may record real money that was really
-- moved, and dropping them is irreversible. They are left in place, unread, so
-- the history stays auditable and any outstanding balance stays visible to a
-- direct D1 query. Retiring them is a separate, deliberate decision.

CREATE TABLE IF NOT EXISTS referral_submissions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Public-facing opaque id. The UI addresses submissions by uid so a
  -- sequential integer never leaks total programme volume.
  uid                TEXT NOT NULL UNIQUE,
  referrer_user_id   INTEGER NOT NULL,
  -- startup   — founder referrals into the Spin-Out Lab (highest priority)
  -- customer  — platform users: advisors, service partners, evaluating teams
  -- strategic — capital/distribution introductions (invite-only)
  category           TEXT NOT NULL DEFAULT 'startup'
                     CHECK (category IN ('startup', 'customer', 'strategic')),
  referred_name      TEXT NOT NULL,
  referred_org       TEXT,
  referred_contact   TEXT,
  -- The referrer's own relationship to the referred party ("Former colleague",
  -- "Investor in their last round"). Review leans on this heavily: a warm,
  -- specific relationship is the single strongest quality signal.
  your_role          TEXT,
  context            TEXT,
  status             TEXT NOT NULL DEFAULT 'submitted'
                     CHECK (status IN (
                       'draft', 'submitted', 'under_review', 'more_info_needed',
                       'qualified', 'in_conversation', 'converted',
                       'reward_eligible', 'reward_issued', 'rejected', 'closed'
                     )),
  reward_label       TEXT,
  next_step          TEXT,
  -- Reviewer-authored note on why this does or doesn't fit. Surfaced to the
  -- referrer in the detail drawer, so it is written to be read by them.
  fit_notes          TEXT,
  -- 'form' | 'csv' — bulk-imported rows arrive thinner (name/org/context only)
  -- and are worth distinguishing when tuning the quality bar.
  source             TEXT NOT NULL DEFAULT 'form',
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_submissions_referrer
  ON referral_submissions(referrer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_submissions_status
  ON referral_submissions(status, created_at DESC);

-- Append-only timeline. Every status change writes one row, so the detail
-- drawer renders real history instead of inferring it from updated_at.
CREATE TABLE IF NOT EXISTS referral_submission_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL,
  -- Human-readable label as shown in the timeline ("Onboarded — reward
  -- issued"), stored rather than derived so relabelling a status later does
  -- not silently rewrite past history.
  label          TEXT NOT NULL,
  status         TEXT,
  note           TEXT,
  -- NULL for system-generated entries (e.g. the initial submission).
  actor_user_id  INTEGER,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_submission_events_submission
  ON referral_submission_events(submission_id, created_at);

-- Requests for access to the invite-only strategic programme. Kept separate
-- from submissions: this is a request to participate, not a referral.
CREATE TABLE IF NOT EXISTS referral_strategic_access (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL UNIQUE,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested', 'granted', 'declined')),
  decided_at   TIMESTAMP,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
