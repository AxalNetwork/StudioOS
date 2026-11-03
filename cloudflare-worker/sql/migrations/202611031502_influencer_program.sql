-- D4289 P1 (#4290): the Influencer program and its membership.
--
-- WHAT THIS ADDS (#4289, S1's decisions D-a, D-b, D-i, D-j, D-l):
--   programs / playbook   the registry row `influencer` ("Network and
--                         referrals", "By application", partly built) and its
--                         How-it-runs sections, published as version 1 with a
--                         draft copy, as migration 560 seeded the nine.
--   influencer_tier_defaults
--                         the four tiers' defaults that new terms copy (D4289
--                         §1.7: the rates are data, never copy). Seeded with the
--                         owner's table of 2026-11-03; the Super Admin changes
--                         them. Strategic Partner's rate is negotiated, so it is
--                         NULL ("Not set"), never a guess.
--   influencer_applications
--                         one row per application: the answers as JSON, the
--                         terms version the applicant accepted, and HQ's
--                         decision. One open application per member (applied or
--                         more_requested), by a partial unique index.
--   influencers           one row per admitted member (`user_id` UNIQUE): tier,
--                         status, and the `referral_partners` row that carries
--                         their terms (D-b), and `handle`: the column is P1's
--                         (S21's hand-out on #4289), its rules and writes are
--                         P2's (#4291). NULL until P2 sets one.
--   influencer_events     append-only, enforced by trigger as `testing_events`
--                         is (D812): every apply, decision and change.
--
-- WHY referral_partners AND referral_partner_terms ARE REBUILT. D-b puts an
-- admitted influencer in a new segment, `influencers`. Migration 563 holds the
-- segment to three values in a CHECK on both tables, and SQLite cannot widen a
-- CHECK in place. Both are rebuilt under their OWN names (GOTCHAS: never a
-- scratch table renamed into place, which leaves child foreign keys naming the
-- scratch table): every row is copied aside with its id, the table is dropped
-- and recreated with the wider CHECK, the rows come back, and the AUTOINCREMENT
-- high-water mark is kept. No foreign key into either table cascades
-- (referral_partner_terms.partner_id, referral_partner_term_triggers.terms_id
-- and commissions.terms_id are all plain), so the drop deletes nothing else;
-- the checks are deferred so the children's rows stay valid once the parents'
-- rows are back. No transaction statements (D1 rejects them).
--
-- WHY program_grant_defaults IS REBUILT. Migration 553 holds its key to the
-- nine in a CHECK (553:68-72), and each program needs its row (D981: the flag
-- and the schedule rule are seeded, every money default starts "Not
-- recorded"). Nothing references it, so it is copied aside, dropped and
-- recreated with `influencer` in the CHECK. Influencers stays at HQ, so its
-- row ships off (grantable 0), as Product testing's does.
--
-- program_grants IS NOT REBUILT. #4290 asked for its CHECK (553:29-32) to
-- include `influencer`, but migration 562 already widened that CHECK to any
-- registry slug, so `influencer` passes it as it stands.

PRAGMA defer_foreign_keys = TRUE;

-- ─────────────────────────────────────────────── the segment CHECKs

CREATE TABLE referral_partners_keep_p1 AS SELECT * FROM referral_partners;
CREATE TABLE referral_partner_terms_keep_p1 AS SELECT * FROM referral_partner_terms;
CREATE TABLE referral_partner_seq_keep_p1 AS
  SELECT name, seq FROM sqlite_sequence WHERE name IN ('referral_partners', 'referral_partner_terms');

DROP TABLE referral_partner_terms;
DROP TABLE referral_partners;

CREATE TABLE referral_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  segment TEXT NOT NULL CHECK (segment IN ('event_organisers', 'venture_scouts', 'deal_makers', 'influencers')),
  note TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_referral_partners_segment ON referral_partners(segment);

CREATE TABLE referral_partner_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES referral_partners(id),
  segment TEXT NOT NULL CHECK (segment IN ('event_organisers', 'venture_scouts', 'deal_makers', 'influencers')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'sent', 'signed', 'active', 'ended', 'expired')),
  starts_on TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on TEXT CHECK (ends_on IS NULL OR (ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ends_on >= starts_on)),
  cap_per_intro_cents INTEGER CHECK (cap_per_intro_cents IS NULL OR cap_per_intro_cents > 0),
  overall_cap_cents INTEGER CHECK (overall_cap_cents IS NULL OR overall_cap_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3 AND currency = upper(currency)),
  sectors TEXT,
  contract_slug TEXT,
  envelope_id INTEGER,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_by INTEGER REFERENCES users(id),
  submitted_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  sent_by INTEGER REFERENCES users(id),
  sent_at TEXT,
  signed_at TEXT,
  ended_by INTEGER REFERENCES users(id),
  ended_at TEXT,
  end_reason TEXT,
  CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('approved', 'sent', 'signed', 'active') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status NOT IN ('sent', 'signed', 'active') OR (envelope_id IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (status NOT IN ('signed', 'active') OR signed_at IS NOT NULL),
  CHECK (status <> 'ended' OR (ended_at IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_referral_partner_terms_partner ON referral_partner_terms(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_partner_terms_status ON referral_partner_terms(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_referral_partner_terms_envelope ON referral_partner_terms(envelope_id);

INSERT INTO referral_partners (id, user_id, segment, note, added_by, added_at, updated_at)
SELECT id, user_id, segment, note, added_by, added_at, updated_at FROM referral_partners_keep_p1 ORDER BY id;

INSERT INTO referral_partner_terms (
  id, uid, partner_id, segment, status, starts_on, ends_on, cap_per_intro_cents, overall_cap_cents, currency, sectors,
  contract_slug, envelope_id, note, created_by, created_at, updated_at, submitted_by, submitted_at, approved_by,
  approved_at, sent_by, sent_at, signed_at, ended_by, ended_at, end_reason)
SELECT
  id, uid, partner_id, segment, status, starts_on, ends_on, cap_per_intro_cents, overall_cap_cents, currency, sectors,
  contract_slug, envelope_id, note, created_by, created_at, updated_at, submitted_by, submitted_at, approved_by,
  approved_at, sent_by, sent_at, signed_at, ended_by, ended_at, end_reason
  FROM referral_partner_terms_keep_p1 ORDER BY id;

-- Keep each AUTOINCREMENT high-water mark. The copy's INSERT … SELECT makes
-- the table's sqlite_sequence row even when it copies no rows (seq 0), so the
-- row is always there to raise, an emptied table's included.
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT k.seq FROM referral_partner_seq_keep_p1 k WHERE k.name = sqlite_sequence.name), 0))
 WHERE name IN ('referral_partners', 'referral_partner_terms');

DROP TABLE referral_partners_keep_p1;
DROP TABLE referral_partner_terms_keep_p1;
DROP TABLE referral_partner_seq_keep_p1;

-- ─────────────────────────────────────────────── the program grant defaults

CREATE TABLE program_grant_defaults_keep_p1 AS SELECT * FROM program_grant_defaults;
DROP TABLE program_grant_defaults;
CREATE TABLE program_grant_defaults (
    program_key               TEXT PRIMARY KEY
                              CHECK (program_key IN ('spinout-lab', 'ai-native-venture', 'mentor-cohorts',
                                                     'investor-cohorts', 'referral-partners', 'refer-and-earn',
                                                     'perks', 'learning', 'product-testing', 'influencer')),
    grantable                 INTEGER NOT NULL DEFAULT 0 CHECK (grantable IN (0, 1)),
    ends_with_licence         INTEGER CHECK (ends_with_licence IS NULL OR ends_with_licence IN (0, 1)),
    capacity_cap              INTEGER CHECK (capacity_cap IS NULL OR capacity_cap > 0),
    capacity_uncapped         INTEGER CHECK (capacity_uncapped IS NULL OR capacity_uncapped IN (0, 1)),
    cohorts_per_year          INTEGER CHECK (cohorts_per_year IS NULL OR cohorts_per_year >= 0),
    credits_per_quarter       INTEGER CHECK (credits_per_quarter IS NULL OR credits_per_quarter >= 0),
    fee_cents                 INTEGER CHECK (fee_cents IS NULL OR fee_cents >= 0),
    currency                  TEXT CHECK (currency IS NULL OR length(currency) = 3),
    hq_share_bps              INTEGER CHECK (hq_share_bps IS NULL OR (hq_share_bps >= 0 AND hq_share_bps <= 10000)),
    hq_approves_each_cohort   INTEGER CHECK (hq_approves_each_cohort IS NULL OR hq_approves_each_cohort IN (0, 1)),
    hq_approval_above_cents   INTEGER CHECK (hq_approval_above_cents IS NULL OR hq_approval_above_cents >= 0),
    playbook                  TEXT CHECK (playbook IS NULL OR playbook IN ('as_written', 'may_adapt')),
    brand                     TEXT CHECK (brand IS NULL OR brand IN ('axal', 'studio')),
    reporting                 TEXT CHECK (reporting IS NULL OR reporting IN ('monthly', 'quarterly', 'yearly')),
    requires_signed_schedule  INTEGER CHECK (requires_signed_schedule IS NULL OR requires_signed_schedule IN (0, 1)),
    updated_by_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at                TEXT
);
INSERT INTO program_grant_defaults (
    program_key, grantable, ends_with_licence, capacity_cap, capacity_uncapped, cohorts_per_year, credits_per_quarter, fee_cents,
    currency, hq_share_bps, hq_approves_each_cohort, hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule,
    updated_by_user_id, updated_at)
SELECT
    program_key, grantable, ends_with_licence, capacity_cap, capacity_uncapped, cohorts_per_year, credits_per_quarter, fee_cents,
    currency, hq_share_bps, hq_approves_each_cohort, hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule,
    updated_by_user_id, updated_at
  FROM program_grant_defaults_keep_p1;
DROP TABLE program_grant_defaults_keep_p1;
INSERT OR IGNORE INTO program_grant_defaults (program_key, grantable, requires_signed_schedule) VALUES ('influencer', 0, 1);

-- ─────────────────────────────────────────────── the tier defaults

CREATE TABLE IF NOT EXISTS influencer_tier_defaults (
  tier               TEXT    PRIMARY KEY
                     CHECK (tier IN ('affiliate_creator', 'verified_influencer', 'strategic_creator', 'strategic_partner')),
  position           INTEGER NOT NULL,
  -- The share of net software subscription revenue, in basis points; NULL is
  -- "Not set" (Strategic Partner's rate is negotiated per signed terms).
  percentage_bps     INTEGER CHECK (percentage_bps IS NULL OR (percentage_bps > 0 AND percentage_bps <= 10000)),
  -- How many of a referred member's paid invoices earn (D4289 §1.1: invoices,
  -- not months); NULL is "per signed terms".
  duration_invoices  INTEGER CHECK (duration_invoices IS NULL OR duration_invoices > 0),
  -- The offer budget new terms carry (P4 reads it); NULL is "Not set".
  offer_budget_cents INTEGER CHECK (offer_budget_cents IS NULL OR offer_budget_cents > 0),
  currency           TEXT    NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3 AND currency = upper(currency)),
  updated_by         INTEGER REFERENCES users(id),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The owner's table (#4289, 2026-11-03): the seed, which the Super Admin changes.
INSERT OR IGNORE INTO influencer_tier_defaults (tier, position, percentage_bps, duration_invoices) VALUES
  ('affiliate_creator', 1, 2000, 12),
  ('verified_influencer', 2, 2500, 12),
  ('strategic_creator', 3, 3000, 12),
  ('strategic_partner', 4, NULL, NULL);

-- ─────────────────────────────────────────────── applications and members

CREATE TABLE IF NOT EXISTS influencer_applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT    NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  answers_json    TEXT    NOT NULL CHECK (json_valid(answers_json) AND length(answers_json) <= 16384),
  consent_version TEXT    NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 40),
  status          TEXT    NOT NULL DEFAULT 'applied'
                  CHECK (status IN ('applied', 'admitted', 'declined', 'withdrawn', 'more_requested')),
  -- The tier HQ admitted at; NULL until admitted.
  tier            TEXT    CHECK (tier IS NULL OR tier IN ('affiliate_creator', 'verified_influencer', 'strategic_creator', 'strategic_partner')),
  -- A decline's reason, or HQ's question when it asks for more.
  reason          TEXT    CHECK (reason IS NULL OR length(reason) <= 2000),
  decided_by      INTEGER REFERENCES users(id),
  decided_at      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (status NOT IN ('admitted', 'declined') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'admitted' OR tier IS NOT NULL),
  CHECK (status NOT IN ('declined', 'more_requested') OR reason IS NOT NULL)
);
-- One open application per member: two presses, or two tabs, make one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_influencer_applications_open
  ON influencer_applications(user_id) WHERE status IN ('applied', 'more_requested');
CREATE INDEX IF NOT EXISTS idx_influencer_applications_status ON influencer_applications(status, created_at);
CREATE INDEX IF NOT EXISTS idx_influencer_applications_user ON influencer_applications(user_id, id);

CREATE TABLE IF NOT EXISTS influencers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT    NOT NULL UNIQUE,
  user_id        INTEGER NOT NULL UNIQUE REFERENCES users(id),
  tier           TEXT    NOT NULL
                 CHECK (tier IN ('affiliate_creator', 'verified_influencer', 'strategic_creator', 'strategic_partner')),
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  -- The member's handle (`axal.vc/@handle`): lower-case, 3 to 24 of [a-z0-9_].
  -- P2 (#4291) owns the rules; the CHECK only holds the shape.
  handle         TEXT    CHECK (handle IS NULL OR (length(handle) BETWEEN 3 AND 24 AND handle NOT GLOB '*[^a-z0-9_]*')),
  partner_id     INTEGER REFERENCES referral_partners(id),
  application_id INTEGER REFERENCES influencer_applications(id),
  admitted_by    INTEGER NOT NULL REFERENCES users(id),
  admitted_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Whether this membership set the member's Investor Pro (D-l): only then does
  -- a pause or an end take it back, so a member's own plan is never touched.
  investor_grant INTEGER NOT NULL DEFAULT 0 CHECK (investor_grant IN (0, 1)),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_influencers_status ON influencers(status, tier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_influencers_handle ON influencers(handle) WHERE handle IS NOT NULL;

-- Append-only (D812's rule): every apply, decision and change, who and what.
CREATE TABLE IF NOT EXISTS influencer_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  application_id INTEGER REFERENCES influencer_applications(id),
  influencer_id  INTEGER REFERENCES influencers(id),
  event          TEXT    NOT NULL CHECK (event IN (
                   'applied', 'withdrawn', 'admitted', 'declined', 'more_requested',
                   'tier_changed', 'paused', 'resumed', 'ended')),
  detail_json    TEXT    CHECK (detail_json IS NULL OR (json_valid(detail_json) AND length(detail_json) <= 4096)),
  actor_user_id  INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_influencer_events_user ON influencer_events(user_id, id);

CREATE TRIGGER IF NOT EXISTS influencer_events_no_update
BEFORE UPDATE ON influencer_events
BEGIN
  SELECT RAISE(ABORT, 'influencer_events is append-only (D4289).');
END;

CREATE TRIGGER IF NOT EXISTS influencer_events_no_delete
BEFORE DELETE ON influencer_events
BEGIN
  SELECT RAISE(ABORT, 'influencer_events is append-only (D4289).');
END;

-- ─────────────────────────────────────────────── the registry row

INSERT OR IGNORE INTO programs (key, grp, name, purpose, who, join_method, status, position) VALUES
  ('influencer', 'Network and referrals', 'Influencers',
   'People with an audience bring members to Axal through their own link and earn a share of the subscriptions they bring.',
   'Any member, in any role, with an audience', 'By application', 'partly_built', 10);

INSERT OR IGNORE INTO program_playbook_sections (program_key, version, section_key, position, title, body, computed) VALUES
  ('influencer', 1, 'purpose', 1, 'Purpose',
   'Influencers are distribution partners. They share their own link and earn a share of the software subscriptions the members they bring pay for.', 0),
  ('influencer', 1, 'who', 2, 'Who it is for',
   'Any member, in any role, with an audience: creators, newsletter writers, community leads, VC firms and accelerators. Being an influencer is a membership, not a role.', 0),
  ('influencer', 1, 'join', 3, 'How people join',
   'A member applies from Refer & Earn or the public Influencers page: their channels and audience, regions, topics, why Axal, and the Influencer terms. HQ admits them at a tier, declines with a reason, or asks for more. A declined member can apply again after 90 days.', 0),
  ('influencer', 1, 'rewards', 4, 'Rewards',
   'Commission on every paid software subscription a referred member pays: founder, investor, advisor and partner plans. Never on fund commitments, deals, management fees or carry. The rate and how many invoices earn are each tier''s, in Settings, and each influencer''s signed terms. Commission is net of discount, tax and refunds, held 30 days, then payable. Bonuses at 10, 25, 50, 100 and 250 paid members. While active, an influencer holds Investor Pro.', 0),
  ('influencer', 1, 'terms', 5, 'Terms and contracts',
   'Admitting an influencer makes them a referral partner in the Influencers segment, with draft terms copied from their tier''s defaults. The Super Admin approves the terms and the influencer signs them before anything is paid. Every promotion is labelled as paid, influencers may not promote specific deals or funds, and self-referral is not permitted.', 0),
  ('influencer', 1, 'measure', 6, 'How we measure it',
   'Visits per channel
Sign-ups
Paid members
Revenue influenced, per currency
Commission pending, payable, paid and reversed', 0),
  ('influencer', 1, 'admin-tools', 7, 'What you do',
   'Each day: decide new applications.
When someone needs a change: change their tier, pause them or end them, each with a reason.
When terms are drafted: the Super Admin approves and sends them for signature.', 0);

INSERT OR IGNORE INTO program_playbook_versions (program_key, version, published_by_user_id)
SELECT DISTINCT program_key, 1, NULL FROM program_playbook_sections WHERE program_key = 'influencer' AND version = 1;

INSERT OR IGNORE INTO program_playbook_sections
  (program_key, version, section_key, position, title, body, computed, template_keys)
SELECT program_key, 0, section_key, position, title, body, computed, template_keys
  FROM program_playbook_sections WHERE program_key = 'influencer' AND version = 1;
