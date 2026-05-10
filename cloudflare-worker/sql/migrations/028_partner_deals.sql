-- Task #8 (X-1) — Partner deal engine.
--
-- Tables:
--   partner_invitations            — admin-issued onboarding magic links
--   partner_profiles               — chatbot-collected partner profile
--   partner_deals                  — selected, signed deal record + tier grants
--   partner_referral_redemptions   — registrations attributed to a deal's referral code

CREATE TABLE IF NOT EXISTS partner_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  -- JSON array of EQUITY_PARTNERSHIP|SERVICES_PARTNERSHIP|DEAL_SOURCING_REVSHARE|CAPITAL_PARTNERSHIP|CUSTOM
  allowed_deal_types TEXT NOT NULL DEFAULT '[]',
  personal_message TEXT,
  -- sent | viewed | profiled | proposed | selected | finalized | signed | expired | revoked
  status TEXT NOT NULL DEFAULT 'sent',
  expires_at TIMESTAMP NOT NULL,
  viewed_at TIMESTAMP,
  signed_at TIMESTAMP,
  resulting_user_id INTEGER REFERENCES users(id),
  resulting_deal_id INTEGER,
  envelope_id INTEGER,
  revoked_at TIMESTAMP,
  revoked_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_invitations_email     ON partner_invitations(recipient_email);
CREATE INDEX IF NOT EXISTS idx_partner_invitations_status    ON partner_invitations(status);
CREATE INDEX IF NOT EXISTS idx_partner_invitations_invited_by ON partner_invitations(invited_by_user_id);

CREATE TABLE IF NOT EXISTS partner_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER NOT NULL UNIQUE REFERENCES partner_invitations(id),
  user_id INTEGER REFERENCES users(id),
  full_name TEXT,
  organization TEXT,
  role_title TEXT,
  expertise TEXT,             -- comma list
  sectors TEXT,               -- comma list
  geography TEXT,
  capacity_per_month TEXT,
  capital_capacity_usd INTEGER,
  motivation TEXT,
  prior_deals TEXT,
  linkedin_url TEXT,
  raw_chat_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_profiles_user ON partner_profiles(user_id);

CREATE TABLE IF NOT EXISTS partner_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER REFERENCES partner_invitations(id),
  user_id INTEGER REFERENCES users(id),                -- NULL until signed
  -- equity_partnership | services_partnership | deal_sourcing_revshare | capital_partnership | custom
  deal_type TEXT NOT NULL,
  proposal_json TEXT NOT NULL,                         -- {summary, terms{...}, tiers{...}}
  granted_tier_founder TEXT,                           -- e.g. founder_pro / founder_elite / NULL
  granted_tier_investor TEXT,                          -- professional / institutional / NULL
  term_months INTEGER NOT NULL DEFAULT 12,
  referral_code TEXT UNIQUE,                           -- one-time partner code
  envelope_id INTEGER,
  -- proposed | awaiting_signature | active | terminated | expired
  status TEXT NOT NULL DEFAULT 'proposed',
  activated_at TIMESTAMP,
  expires_at TIMESTAMP,
  terminated_at TIMESTAMP,
  terminated_by_user_id INTEGER REFERENCES users(id),
  termination_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_deals_invitation ON partner_deals(invitation_id);
CREATE INDEX IF NOT EXISTS idx_partner_deals_user       ON partner_deals(user_id);
CREATE INDEX IF NOT EXISTS idx_partner_deals_status     ON partner_deals(status);
CREATE INDEX IF NOT EXISTS idx_partner_deals_referral   ON partner_deals(referral_code);
CREATE INDEX IF NOT EXISTS idx_partner_deals_envelope   ON partner_deals(envelope_id);

CREATE TABLE IF NOT EXISTS partner_referral_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_deal_id INTEGER NOT NULL REFERENCES partner_deals(id),
  redeemed_by_user_id INTEGER NOT NULL REFERENCES users(id),
  granted_tier_founder TEXT,
  granted_tier_investor TEXT,
  granted_until TIMESTAMP,
  attribution_kind TEXT NOT NULL DEFAULT 'referral',   -- referral | deal_sourcing_revshare
  redeemed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(partner_deal_id, redeemed_by_user_id)
);
CREATE INDEX IF NOT EXISTS idx_prr_deal ON partner_referral_redemptions(partner_deal_id);
CREATE INDEX IF NOT EXISTS idx_prr_user ON partner_referral_redemptions(redeemed_by_user_id);
