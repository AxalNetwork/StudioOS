-- Task #50 — Lost-TOTP recovery flow.
--
-- Additive-only, IF NOT EXISTS, safe to replay. Tables track recovery
-- tickets (the audit + state machine) and trusted-contact attestations
-- (Layer 3f, the 2-of-2 social-recovery path). Columns added to `users`
-- carry the per-account cool-off + assurance-level state and to
-- `user_sessions` so step-up gating can read the originating layer.

CREATE TABLE IF NOT EXISTS auth_recovery_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  -- 'backup_code' | 'passkey' | 'sms' | 'email_magic' | 'trusted_contact'
  -- | 'kyc_reverify' | 'admin_manual'
  layer TEXT NOT NULL,
  -- 'open' | 'awaiting_contacts' | 'awaiting_admin' | 'awaiting_admin_cosign'
  -- | 'resolved' | 'denied' | 'expired'
  status TEXT NOT NULL DEFAULT 'open',
  -- 'none' | 'email_only' | 'full' — the assurance level the resolution
  -- minted on success. Drives /api/auth/me.assurance_level and gates the
  -- cool-off middleware list of sensitive routes.
  assurance_level TEXT,
  initiator_ip TEXT,
  initiator_ua TEXT,
  -- per-layer state bag (e.g. magic-link token hash, SMS sessionInfo,
  -- KYC inquiry id, admin co-signers, attestations).
  state_json TEXT,
  resolved_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_recovery_tickets_user ON auth_recovery_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_tickets_status ON auth_recovery_tickets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_trusted_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,         -- owner of the contact list
  contact_user_id INTEGER,           -- nullable: invited Axal user not yet joined
  contact_email TEXT NOT NULL,       -- canonical lookup
  display_name TEXT,
  -- 'pending_invite' | 'active' | 'removed'
  status TEXT NOT NULL DEFAULT 'pending_invite',
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,
  removed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trusted_contacts_user ON auth_trusted_contacts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trusted_contacts_lookup ON auth_trusted_contacts(contact_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_contacts_pair ON auth_trusted_contacts(user_id, contact_email);

-- Per-account cool-off window after ANY non-Layer-1 recovery; blocks
-- billing/contract/capital/DD/KYC-resubmit/impersonation for 24h.
ALTER TABLE users ADD COLUMN recovery_cooling_off_until TIMESTAMP;
-- Lower-assurance sessions (email-magic / KYC-vendor / admin-manual) carry
-- a deadline by which the user must re-enrol TOTP or a passkey; the
-- frontend nags + the worker re-locks the account if it elapses.
ALTER TABLE users ADD COLUMN recovery_step_up_due_at TIMESTAMP;

-- Per-session assurance carried for step-up gating. Mirrors
-- user_sessions.factor but distinguishes 'email_only' from 'sms' etc.
ALTER TABLE user_sessions ADD COLUMN assurance_level TEXT;
