-- Spin-Out Lab graduation certificates — persistence + public verification.
--
-- Until now the credential reference was DERIVED on the fly
-- (lib/graduationCertificate.js certificateRef(): AXL-SOL-{cohort}-{YYMMDD}-{uid}).
-- That is reproducible, which is what made it usable without a store, but it
-- means nothing is issued, nothing can be revoked, and a third party has
-- nothing to verify against. This table is the registry that fixes that.
--
-- Column split follows the public/private boundary deliberately:
--   * public_*      — safe to serve unauthenticated from /api/public/verify
--   * everything else — owner or admin only
-- Admin operational metadata (email delivery, render version, storage paths)
-- and the audit log are intentionally NOT in this migration: they belong with
-- the issuance pipeline that will write them, and an empty column that no code
-- populates reads as a working feature when it is not.

CREATE TABLE IF NOT EXISTS spinout_certificates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The derived reference, persisted at issuance so it is stable even if the
  -- inputs later change (a cohort relabel must not silently reissue an ID).
  credential_id       TEXT UNIQUE NOT NULL,
  -- Unguessable public handle. The public URL uses THIS, not credential_id,
  -- so the credential reference cannot be enumerated by walking user ids.
  public_token        TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),

  user_id             INTEGER NOT NULL,
  project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,

  -- Public-safe snapshot, frozen at issuance. Snapshotted rather than joined
  -- so a later profile edit cannot retroactively rewrite an issued credential.
  public_name         TEXT NOT NULL,
  public_company      TEXT,
  public_cohort       TEXT,
  public_issued_on    TEXT NOT NULL,          -- YYYY-MM-DD, conferral date
  public_jurisdiction TEXT,
  public_program_days INTEGER,

  -- Lifecycle. 'issued' | 'revoked'. Revoked rows stay for verification:
  -- a third party checking a revoked credential must be told it is revoked,
  -- not that it does not exist.
  status              TEXT NOT NULL DEFAULT 'issued',
  revoked_at          TEXT,
  revocation_reason   TEXT,

  -- Whether the holder has opted the credential into public verification.
  -- Defaults ON: a credential the graduate cannot share has little purpose,
  -- and every public field above is already conferral fact, not personal data.
  public_share_enabled INTEGER NOT NULL DEFAULT 1,

  issued_by_user_id   INTEGER,                -- admin who issued, when issued by one
  issued_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One live credential per graduate. Revoked rows are kept, so the partial
-- index only constrains issued ones.
CREATE UNIQUE INDEX IF NOT EXISTS uq_spinout_cert_user_issued
  ON spinout_certificates(user_id) WHERE status = 'issued';

CREATE INDEX IF NOT EXISTS idx_spinout_cert_token  ON spinout_certificates(public_token);
CREATE INDEX IF NOT EXISTS idx_spinout_cert_credid ON spinout_certificates(credential_id);
CREATE INDEX IF NOT EXISTS idx_spinout_cert_user   ON spinout_certificates(user_id);
