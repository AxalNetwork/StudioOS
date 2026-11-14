-- D958 (#2791, Programs part 5 of #2371) — referral partners, their segment,
-- per-partner custom terms that the Super Admin approves, and which terms paid
-- each commission.
--
-- OD3 (A): a referral partner is a member HQ adds, with a segment, on a row
-- here. It is not a new account role, and the member's own referral code is
-- the code that earns.
--
-- O-TERMS (A, no bonuses): terms pass draft → submitted → approved → sent →
-- signed. `active` and `expired` are read from `starts_on` and `ends_on` by
-- every reader (services/referralPartnerTerms.ts), so no sweep writes them;
-- the CHECK names them so the canvas's steps and the store agree. A commission
-- paid under terms pays no L2 or L3 bonus.
--
-- It also declares `commissions.reversed_amount_cents` and `reversed_at`,
-- which only dev and preview added (services/referralCommissions.ts), so
-- production gains the column the refund reversal writes (D359's baseline
-- entry asked for a migration number). Production D1 was read on 2026-10-26:
-- neither column, nor any table below, exists there.

CREATE TABLE IF NOT EXISTS referral_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  segment TEXT NOT NULL CHECK (segment IN ('event_organisers', 'venture_scouts', 'deal_makers')),
  note TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_referral_partners_segment ON referral_partners(segment);

CREATE TABLE IF NOT EXISTS referral_partner_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES referral_partners(id),
  segment TEXT NOT NULL CHECK (segment IN ('event_organisers', 'venture_scouts', 'deal_makers')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'sent', 'signed', 'active', 'ended', 'expired')),
  starts_on TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on TEXT CHECK (ends_on IS NULL OR (ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ends_on >= starts_on)),
  cap_per_intro_cents INTEGER CHECK (cap_per_intro_cents IS NULL OR cap_per_intro_cents > 0),
  overall_cap_cents INTEGER CHECK (overall_cap_cents IS NULL OR overall_cap_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3 AND currency = upper(currency)),
  -- A JSON array of sector names the terms cover, or NULL for every sector.
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

-- One row per trigger. Each pays exactly one of a flat amount or a share, as a
-- standard rule does.
CREATE TABLE IF NOT EXISTS referral_partner_term_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terms_id INTEGER NOT NULL REFERENCES referral_partner_terms(id),
  rule_key TEXT NOT NULL,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
  percentage_bps INTEGER CHECK (percentage_bps IS NULL OR (percentage_bps > 0 AND percentage_bps <= 10000)),
  CHECK ((amount_cents IS NULL) <> (percentage_bps IS NULL)),
  UNIQUE (terms_id, rule_key)
);

-- Which terms paid a commission; NULL for a standard rule.
ALTER TABLE commissions ADD COLUMN terms_id INTEGER REFERENCES referral_partner_terms(id);
CREATE INDEX IF NOT EXISTS idx_commissions_terms ON commissions(terms_id);
ALTER TABLE commissions ADD COLUMN reversed_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commissions ADD COLUMN reversed_at TIMESTAMP;
