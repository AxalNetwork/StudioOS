-- StudioOS D1 (SQLite) Schema
-- Run via: npx wrangler d1 execute studioos-db --file=sql/schema.sql

CREATE TABLE IF NOT EXISTS founders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    linkedin_url TEXT,
    domain_expertise TEXT,
    experience_years INTEGER NOT NULL DEFAULT 0,
    bio TEXT,
    sf_contact_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_founders_email ON founders(email);
CREATE INDEX IF NOT EXISTS idx_founders_sf_contact ON founders(sf_contact_id);

CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    company TEXT,
    email TEXT UNIQUE NOT NULL,
    specialization TEXT,
    referral_code TEXT UNIQUE,
    referrals_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    accepting_intros INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_partners_email ON partners(email);

CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('holding_company', 'project', 'subsidiary', 'vc_fund')),
    parent_id INTEGER REFERENCES entities(id),
    jurisdiction TEXT,
    incorporation_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 0.1 — investor (LP / VC / Angel / Scout) profile, parallel to partner.
-- Defined before `users` because users.investor_id FK references it.
CREATE TABLE IF NOT EXISTS investors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER,
    investor_type TEXT NOT NULL DEFAULT 'angel',
    accreditation_status TEXT NOT NULL DEFAULT 'unverified',
    check_size_min REAL,
    check_size_max REAL,
    sector_focus TEXT,
    stage_focus TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_investors_user ON investors(user_id);
CREATE INDEX IF NOT EXISTS idx_investors_type ON investors(investor_type);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'founder' CHECK (role IN ('admin', 'founder', 'partner', 'investor')),
    investor_id INTEGER REFERENCES investors(id),
    password_hash TEXT,
    founder_id INTEGER REFERENCES founders(id),
    partner_id INTEGER REFERENCES partners(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verification_token TEXT,
    verification_token_expires TEXT,
    -- Spin-Out Lab — 4-week guided sprint state for pre-incorporation
    -- founders. Defaults keep the lab OFF so existing users are unaffected
    -- until /api/spinout-lab/start fires. `is_incorporated` flips once the
    -- /exit route runs (or — outside the lab — after a full incorporate
    -- wizard completes).
    spinout_lab_active INTEGER NOT NULL DEFAULT 0,
    spinout_lab_week INTEGER NOT NULL DEFAULT 1,
    spinout_lab_started_at TEXT,
    is_incorporated INTEGER NOT NULL DEFAULT 0,
    -- Task #16 — Profile expansion (personal identity).
    -- PII columns are column-cipher v1 ciphertext (services/columnCipher.ts);
    -- the *_last4 plaintext columns let lists render `••••1234` cheaply.
    full_legal_name TEXT,
    date_of_birth TEXT,
    nationality TEXT,
    tax_residency_country TEXT,
    tax_id_number_enc TEXT,
    tax_id_last4 TEXT,
    phone_e164_enc TEXT,
    phone_last4 TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state_or_region TEXT,
    postal_code TEXT,
    country TEXT,
    profile_completion_pct INTEGER DEFAULT 0,
    -- LinkedIn OAuth identity (audit L4 — moved off the request-path lazy
    -- ALTER that used to live in routes/linkedin.ts::ensureColumns).
    -- Existing DBs: apply sql/linkedin_alter.sql manually via wrangler d1 execute.
    linkedin_sub TEXT,
    linkedin_email TEXT,
    linkedin_name TEXT,
    linkedin_connected_at TEXT,
    -- Task #1 (DB) — public FOUNDER_ID / PARTNER_ID surfaced in legal
    -- contracts (via {{counterparty.founder_id}} merge field). Allocated
    -- on first role grant (services/publicIds.ts) from id_sequences.
    founder_public_id TEXT,
    partner_public_id TEXT,
    -- Task #1 (DB) — last-active stamp; updated by middleware/lastActive.ts
    -- with a 5-min KV throttle.
    last_active_at TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_founder_public_id
  ON users(founder_public_id) WHERE founder_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_partner_public_id
  ON users(partner_public_id) WHERE partner_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_active
  ON users(last_active_at);

-- Companion 1:1 table for per-user profile fields that would otherwise push the
-- `users` table past Cloudflare D1's hard 100-column-per-table limit. Structured
-- public career background (Task #66) + the LinkedIn photo URL (Task #67). Same
-- side-table pattern as author_websites / corporate_profiles. Created by
-- migrations 131/133 and self-healed by ensureProfileExpansionSchema().
CREATE TABLE IF NOT EXISTS user_profile_ext (
    user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    experience           TEXT,  -- JSON array of career/experience entries
    education            TEXT,  -- JSON array of education entries
    certifications       TEXT,  -- JSON array of certification entries
    website              TEXT,  -- personal / professional website URL
    linkedin_picture_url TEXT,  -- licdn.com CDN URL captured at OAuth callback
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task #16 — Profile expansion (corporate block, one per user).
CREATE TABLE IF NOT EXISTS corporate_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    entity_name TEXT,
    entity_type TEXT,
    registration_number TEXT,
    tax_id_number_enc TEXT,
    tax_id_last4 TEXT,
    registered_country TEXT,
    registered_address_line1 TEXT,
    registered_address_line2 TEXT,
    registered_city TEXT,
    registered_state TEXT,
    registered_postal TEXT,
    signing_authority_name TEXT,
    signing_authority_title TEXT,
    signing_authority_email TEXT,
    ubos_json TEXT NOT NULL DEFAULT '[]',
    directors_json TEXT NOT NULL DEFAULT '[]',
    insurance_carriers_json TEXT NOT NULL DEFAULT '[]',
    ubo_disclosed INTEGER NOT NULL DEFAULT 0,
    aml_high_risk_jurisdiction INTEGER NOT NULL DEFAULT 0,
    sanctions_last_checked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_corp_profiles_high_risk
  ON corporate_profiles(aml_high_risk_jurisdiction)
  WHERE aml_high_risk_jurisdiction = 1;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);

-- Generic admin_audit_log (export / publication actions) PLUS, per
-- Task #1 (DB), per-conversation profile-view rows with first-class
-- viewed_user_id / conversation_id / viewed_at columns. Was originally
-- introduced by migration 036_monitoring_analytics.sql; declared here
-- so a fresh `wrangler d1 execute --file=schema.sql` bootstrap
-- produces the full canonical shape including the Task #1 columns.
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    report_type TEXT,
    format TEXT,
    filters_json TEXT,
    storage_key TEXT,
    download_url TEXT,
    exported_at TEXT NOT NULL DEFAULT (datetime('now')),
    viewed_user_id INTEGER,
    conversation_id INTEGER,
    viewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user_ts
    ON admin_audit_log(admin_user_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_ts
    ON admin_audit_log(action, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_viewed_user
    ON admin_audit_log(viewed_user_id, viewed_at DESC);

-- Task #1 (DB) — atomic monotonic counter table backing
-- AXF-/AXP- public id allocation in services/publicIds.ts.
CREATE TABLE IF NOT EXISTS id_sequences (
    name        TEXT PRIMARY KEY,
    next_value  INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axf', 1);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axp', 1);

-- Task #1 (DB) — per-conversation profile-view audit trail with
-- first-class columns (admin_user_id, viewed_user_id, conversation_id,
-- viewed_at). Mirrored into admin_audit_log by
-- routes/admin.ts::auditConversationView so existing Trust-Center
-- oversight reports continue to work.
CREATE TABLE IF NOT EXISTS admin_profile_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id   INTEGER NOT NULL REFERENCES users(id),
    viewed_user_id  INTEGER NOT NULL REFERENCES users(id),
    conversation_id INTEGER,
    action          TEXT NOT NULL,
    viewed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_viewed
    ON admin_profile_audit(viewed_user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_admin
    ON admin_profile_audit(admin_user_id, viewed_at DESC);

-- Spin-Out Lab milestone log. One row per (user_id, milestone_key); the
-- handler only ever issues INSERT OR IGNORE so re-calls are no-ops.
CREATE TABLE IF NOT EXISTS spinout_lab_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week INTEGER NOT NULL,
    milestone_key TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS idx_spinout_lab_milestones_user
    ON spinout_lab_milestones(user_id);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    sector TEXT,
    stage TEXT NOT NULL DEFAULT 'idea',
    status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake', 'scoring', 'tier_1', 'tier_2', 'rejected', 'spinout', 'active')),
    playbook_week TEXT NOT NULL DEFAULT 'week_1' CHECK (playbook_week IN ('week_1', 'week_2', 'week_3', 'week_4', 'complete')),
    founder_id INTEGER REFERENCES founders(id),
    entity_id INTEGER REFERENCES entities(id),
    problem_statement TEXT,
    solution TEXT,
    why_now TEXT,
    tam REAL,
    sam REAL,
    users_count INTEGER,
    revenue REAL,
    growth_signals TEXT,
    cost_to_mvp REAL,
    funding_needed REAL,
    use_of_funds TEXT,
    hubspot_company_id TEXT,
    hubspot_primary_contact_id TEXT,
    sf_account_id TEXT,
    sf_primary_contact_id TEXT,
    crunchbase_uuid TEXT,
    crunchbase_data_json TEXT,
    crunchbase_synced_at TEXT,
    founded_year INTEGER,
    hq TEXT,
    employee_count TEXT,
    last_funding_round TEXT,
    total_funding REAL,
    -- Task #7 (AM) — soft-delete marker. Founder DELETE sets this; admin
    -- "?hard=true" path bypasses it. List endpoints filter `deleted_at IS NULL`.
    deleted_at TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_sf_account ON projects(sf_account_id);
CREATE INDEX IF NOT EXISTS idx_projects_crunchbase_uuid ON projects(crunchbase_uuid);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);

CREATE TABLE IF NOT EXISTS score_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    -- Task #7 (AM) — ON DELETE CASCADE so admin hard-delete drops scores too.
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    total_score REAL NOT NULL,
    tier TEXT NOT NULL,
    market_size REAL DEFAULT 0,
    market_urgency REAL DEFAULT 0,
    market_trend REAL DEFAULT 0,
    market_total REAL DEFAULT 0,
    team_expertise REAL DEFAULT 0,
    team_execution REAL DEFAULT 0,
    team_network REAL DEFAULT 0,
    team_total REAL DEFAULT 0,
    product_mvp_time REAL DEFAULT 0,
    product_complexity REAL DEFAULT 0,
    product_dependency REAL DEFAULT 0,
    product_total REAL DEFAULT 0,
    capital_cost_mvp REAL DEFAULT 0,
    capital_time_revenue REAL DEFAULT 0,
    capital_burn_traction REAL DEFAULT 0,
    capital_total REAL DEFAULT 0,
    fit_alignment REAL DEFAULT 0,
    fit_synergy REAL DEFAULT 0,
    fit_total REAL DEFAULT 0,
    distribution_channels REAL DEFAULT 0,
    distribution_virality REAL DEFAULT 0,
    distribution_total REAL DEFAULT 0,
    ai_adjustment REAL DEFAULT 0,
    ai_notes TEXT,
    scored_by TEXT,
    -- Epic 5 — anti-cheat columns. Fresh DBs get them here; existing DBs get
    -- them via sql/score_anti_cheat.sql (gated on _migrations marker).
    is_sandbox INTEGER NOT NULL DEFAULT 0,
    integrity_hash TEXT,
    integrity_version TEXT NOT NULL DEFAULT 'v1',
    inputs_json TEXT,
    qualitative_text TEXT,
    anomaly_flags TEXT,
    admin_review_status TEXT NOT NULL DEFAULT 'auto_approved',
    admin_review_notes TEXT,
    admin_reviewed_by INTEGER REFERENCES users(id),
    admin_reviewed_at TEXT,
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_project      ON score_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_scores_sandbox      ON score_snapshots(project_id, is_sandbox, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_review       ON score_snapshots(admin_review_status);
CREATE INDEX IF NOT EXISTS idx_scores_locked_until ON score_snapshots(project_id, locked_until);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    -- Task #7 (AM) — ON DELETE CASCADE so admin hard-delete drops docs too.
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'sent', 'signed')),
    content TEXT,
    template_name TEXT,
    signed_by TEXT,
    signed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    score_snapshot_id INTEGER REFERENCES score_snapshots(id),
    startup_name TEXT NOT NULL,
    founders TEXT NOT NULL,
    sector TEXT,
    stage TEXT,
    total_score REAL NOT NULL,
    tier TEXT NOT NULL,
    problem TEXT,
    solution TEXT,
    why_now TEXT,
    users TEXT,
    revenue_info TEXT,
    growth_signals TEXT,
    cost_to_mvp TEXT,
    funding_needed TEXT,
    use_of_funds TEXT,
    strategic_alignment TEXT,
    partner_synergies TEXT,
    risks TEXT,
    decision TEXT NOT NULL DEFAULT 'pending',
    terms_amount TEXT,
    terms_equity TEXT,
    terms_structure TEXT,
    key_insight TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memos_project ON deal_memos(project_id);

CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    -- Task #7 (AM) — ON DELETE CASCADE so admin hard-delete drops deals too.
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    partner_id INTEGER REFERENCES partners(id),
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'scored', 'active', 'funded', 'rejected')),
    notes TEXT,
    amount REAL,
    hubspot_deal_id TEXT,
    sf_opportunity_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deals_project ON deals(project_id);
CREATE INDEX IF NOT EXISTS idx_deals_sf_opp ON deals(sf_opportunity_id);

CREATE TABLE IF NOT EXISTS lp_investors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    committed_capital REAL NOT NULL DEFAULT 0,
    called_capital REAL NOT NULL DEFAULT 0,
    fund_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS capital_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    lp_investor_id INTEGER NOT NULL REFERENCES lp_investors(id),
    project_id INTEGER REFERENCES projects(id),
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    due_date TEXT,
    paid_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    submitted_by TEXT,
    assigned_to TEXT,
    user_id INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    github_issue_number INTEGER,
    github_issue_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id),
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT,
    actor TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id);

-- ---------------------------------------------------------------------------
-- Task #8 — Customer Discovery + Roadmap (worker port of progress.py).
-- Mirrored as cloudflare-worker/sql/migrations/001_progress_tables.sql so the
-- file can be applied to remote D1 via a single wrangler call. Column names
-- mirror the FastAPI model so the shipping frontend works unchanged.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Task #7 (AM) — ON DELETE CASCADE so admin hard-delete drops interviews too.
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    interviewee_name TEXT NOT NULL,
    interviewee_role TEXT,
    interview_date TEXT,
    notes TEXT,
    hypotheses_json TEXT,
    pains_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project
    ON discovery_interviews (project_id);

-- Task #29 — founder-curated grouping of logged discovery pains for the
-- Spin-Out deck's "PAIN FREQUENCY ACROSS INTERVIEWS" slide. Logged pains
-- stay plain strings in discovery_interviews.pains_json; these tables hold
-- only the curation layer (theme titles + phrase→group aliases).
CREATE TABLE IF NOT EXISTS pain_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pain_groups_project
    ON pain_groups (project_id);

CREATE TABLE IF NOT EXISTS pain_group_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES pain_groups(id) ON DELETE CASCADE,
    phrase_norm TEXT NOT NULL,
    display_phrase TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pain_group_aliases_project_phrase
    ON pain_group_aliases (project_id, phrase_norm);

CREATE INDEX IF NOT EXISTS idx_pain_group_aliases_group
    ON pain_group_aliases (group_id);

CREATE TABLE IF NOT EXISTS roadmap_okrs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Task #7 (AM) — ON DELETE CASCADE so admin hard-delete drops OKRs too.
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    key_results_json TEXT,
    kanban_status TEXT NOT NULL DEFAULT 'now',
    quarter TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roadmap_okrs_project_status_order
    ON roadmap_okrs (project_id, kanban_status, sort_order);

-- ---------------------------------------------------------------------------
-- Task #11 — Subscription plan catalog. Decouples MRR/ARR analytics from the
-- old hardcoded `PLAN_MONTHLY_USD` map. Mirrored as
-- `cloudflare-worker/sql/migrations/004_subscription_plans.sql` so the file
-- can be applied to remote D1 with a single wrangler call. The Stripe webhook
-- upserts a row here on every `customer.subscription.created|updated` event.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plans (
    plan_id           TEXT PRIMARY KEY,
    monthly_price_usd REAL NOT NULL,
    display_name      TEXT,
    stripe_price_id   TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1,
    -- Task #14 — preserve native Stripe currency so MRR can be displayed in
    -- the original billing currency without re-querying Stripe.
    currency          TEXT NOT NULL DEFAULT 'USD',
    native_amount     REAL,
    native_interval   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sub_plans_active ON subscription_plans(is_active);

INSERT OR IGNORE INTO subscription_plans (plan_id, monthly_price_usd, display_name)
VALUES
  ('mi_pro_monthly', 49, 'MI Pro · Monthly'),
  ('mi_pro_annual',  39, 'MI Pro · Annual');

-- Task #14 — FX lookup used by Admin Analytics `?currency=` queries.
-- Admins refresh rates by editing rows directly; the as-of timestamp is
-- surfaced in every API response so consumers can judge staleness.
CREATE TABLE IF NOT EXISTS fx_rates (
    currency   TEXT PRIMARY KEY,
    usd_rate   REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO fx_rates (currency, usd_rate) VALUES
  ('USD', 1.0000), ('EUR', 0.9200), ('GBP', 0.7900), ('CAD', 1.3700),
  ('AUD', 1.5200), ('JPY', 152.0000), ('INR', 83.5000), ('SGD', 1.3500),
  ('CHF', 0.8800), ('SEK', 10.4000);
-- Task #1 (Integrations Foundation) — provider registry tables.
--
-- Replaces the legacy `integrations` table the FastAPI backend used (Fernet-
-- encrypted columns). New schema is namespaced for the Cloudflare Worker
-- surface: credentials live in a single AES-GCM ciphertext blob keyed by
-- (table, column, rowId) via services/columnCipher.ts.
--
-- Apply via:
--   wrangler d1 execute studioos-db \
--     --file=cloudflare-worker/sql/migrations/016_integrations.sql \
--     --remote --env=""
--
-- All statements use IF NOT EXISTS so re-runs are no-ops.

CREATE TABLE IF NOT EXISTS integrations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  user_id               INTEGER NOT NULL,
  provider_key          TEXT NOT NULL,
  display_name          TEXT,
  status                TEXT NOT NULL DEFAULT 'active',     -- active|paused|error|disconnected
  auth_type             TEXT NOT NULL,                      -- api_key|oauth2|webhook
  credentials_enc       TEXT,                               -- v1.<b64> (services/columnCipher.ts)
  webhook_secret_enc    TEXT,
  config_json           TEXT,                               -- non-secret per-conn config
  capabilities_json     TEXT,                               -- ["push_deals","pull_contacts"]
  scopes_json           TEXT,                               -- granted oauth scopes
  external_account_id   TEXT,
  external_account_name TEXT,
  last_synced_at        TIMESTAMP,
  last_error            TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider_key)
);
CREATE INDEX IF NOT EXISTS idx_integrations_user      ON integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_integrations_provider  ON integrations(provider_key);
CREATE INDEX IF NOT EXISTS idx_integrations_status    ON integrations(status);

CREATE TABLE IF NOT EXISTS integration_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id    INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  provider_key      TEXT NOT NULL,
  direction         TEXT NOT NULL,                          -- inbound|outbound|internal
  event_type        TEXT NOT NULL,                          -- connect|sync|push|webhook|disconnect|error|oauth_callback
  status            TEXT NOT NULL,                          -- ok|error
  http_status       INTEGER,
  request_summary   TEXT,
  response_summary  TEXT,
  external_id       TEXT,
  payload_json      TEXT,                                   -- redacted; never raw secrets
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_integration_logs_int   ON integration_logs(integration_id, datetime(created_at) DESC);
CREATE INDEX IF NOT EXISTS idx_integration_logs_user  ON integration_logs(user_id, datetime(created_at) DESC);
CREATE INDEX IF NOT EXISTS idx_integration_logs_event ON integration_logs(event_type);

CREATE TABLE IF NOT EXISTS integration_waitlist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  provider_key  TEXT NOT NULL,
  notes         TEXT,
  notified_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider_key)
);
CREATE INDEX IF NOT EXISTS idx_integration_waitlist_provider ON integration_waitlist(provider_key);

-- Task #3 — Calendly integration. Unified projection table for events
-- pulled in from external scheduling providers (Calendly first; future
-- Cal.com / SavvyCal fit the same shape). Read by services/calendar.ts
-- for kind='calendly_event'. Idempotent on (source, external_uri).
CREATE TABLE IF NOT EXISTS calendar_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT    NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL,
  source          TEXT    NOT NULL,
  external_uri    TEXT    NOT NULL,
  external_id     TEXT,
  title           TEXT,
  start_at        TEXT    NOT NULL,
  end_at          TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'scheduled',
  location_kind   TEXT,
  location_uri    TEXT,
  organizer_email TEXT,
  invitee_email   TEXT,
  invitee_name    TEXT,
  notes           TEXT,
  raw_json        TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_uri)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_time   ON calendar_events(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_source_status ON calendar_events(source, status);

-- Task #2 — HubSpot integration. Indexes for the inline external-id columns
-- declared in `projects` and `deals` above (also in migration 017).
CREATE INDEX IF NOT EXISTS idx_deals_hubspot ON deals(hubspot_deal_id);
CREATE INDEX IF NOT EXISTS idx_projects_hubspot_company ON projects(hubspot_company_id);

-- Task #1 (AG) — Backing tables for unmounted Worker routes (mirrors
-- migration 034_unmounted_routes.sql). Idempotent.
CREATE TABLE IF NOT EXISTS founder_risk_pulls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
    score REAL,
    signals_json TEXT NOT NULL DEFAULT '[]',
    source TEXT,
    pulled_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_founder_risk_pulls_founder
    ON founder_risk_pulls(founder_id, created_at DESC);

-- Task #9 — Venture Risk analyst overrides (mirrors migration
-- 114_venture_risk.sql). Auto scores are computed live by
-- services/ventureRisk.ts from score_snapshots + projects and are NOT stored;
-- this table persists only the analyst override layer, one row per
-- (project_id, layer_key). Idempotent.
CREATE TABLE IF NOT EXISTS venture_risk_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    layer_key TEXT NOT NULL,
    analyst_score REAL,
    analyst_band TEXT,
    analyst_note TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    updated_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, layer_key)
);
CREATE INDEX IF NOT EXISTS idx_venture_risk_overrides_project
    ON venture_risk_overrides(project_id);

CREATE TABLE IF NOT EXISTS service_offerings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    summary TEXT,
    price_usd REAL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_offerings_owner
    ON service_offerings(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_service_offerings_active_created
    ON service_offerings(is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS service_engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    offering_id INTEGER NOT NULL REFERENCES service_offerings(id) ON DELETE CASCADE,
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_engagements_owner
    ON service_engagements(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_engagements_requester
    ON service_engagements(requester_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot_date TEXT NOT NULL,
    mrr REAL,
    active_users INTEGER,
    notes TEXT,
    source TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_project
    ON metrics_snapshots(project_id, snapshot_date DESC);

-- Task #1 (AG) — spec-contract placeholder tables (mirror of migration 034).
CREATE TABLE IF NOT EXISTS comarketing_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    pitch_id INTEGER REFERENCES comarketing_pitches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comarketing_campaigns_status
    ON comarketing_campaigns(status, created_at DESC);
CREATE TABLE IF NOT EXISTS cofounder_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS cofounder_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_a, user_b)
);
CREATE TABLE IF NOT EXISTS insights_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_insights_signals_kind
    ON insights_signals(kind, created_at DESC);
CREATE TABLE IF NOT EXISTS marketplace_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS marketplace_inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS marketplace_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id TEXT,
    onboarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id)
);

-- Task #1 (AG) — spec-name parity placeholders (mirror of migration 034 tail).
CREATE TABLE IF NOT EXISTS calendar_google_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS mentor_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mentor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS captable_holders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    shares REAL NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'common',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS captable_securities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    shares REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS captable_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    company_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_oh_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS references_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    referee_name TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Round-4 spec-name parity additions (mirror of migration 034 tail).
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    thesis TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mentor_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    slot_id INTEGER,
    booker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'booked',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ic_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS founder_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mood INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS compliance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wellbeing_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wellbeing_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS financial_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS needs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    need_id INTEGER REFERENCES needs(id) ON DELETE CASCADE,
    provider_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    amount_cents INTEGER,
    currency TEXT DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Trust Center (Task #3 / Y-1, plus Task AH pairwise NDA + sanctions extras
-- in migration 035). Mirrored here so a fresh `wrangler d1 execute --file
-- schema.sql` provisions the full Trust Center stack in one shot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  obligation_key TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP,
  evidence_envelope_uuid TEXT,
  evidence_meta TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, obligation_key)
);
CREATE INDEX IF NOT EXISTS idx_legal_obligations_user   ON legal_obligations(user_id);
CREATE INDEX IF NOT EXISTS idx_legal_obligations_status ON legal_obligations(status);
CREATE INDEX IF NOT EXISTS idx_legal_obligations_expiry ON legal_obligations(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS pairwise_ndas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_a_user_id INTEGER NOT NULL,
  party_b_user_id INTEGER NOT NULL,
  intermediary TEXT NOT NULL DEFAULT 'axal',
  nda_envelope_uuid TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  valid_until TIMESTAMP,
  signers_json TEXT NOT NULL DEFAULT '[]',
  voided_at TIMESTAMP,
  voided_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(party_a_user_id, party_b_user_id)
);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_a       ON pairwise_ndas(party_a_user_id);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_b       ON pairwise_ndas(party_b_user_id);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_status  ON pairwise_ndas(status);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_expiry  ON pairwise_ndas(valid_until)
  WHERE valid_until IS NOT NULL;

-- Task AH — sanctions screening history (per-user verdicts; source list
-- payloads stay in KV under `sanctions:list:v1:*`).
CREATE TABLE IF NOT EXISTS sanctions_screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hit INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'none',
  match_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  reviewed_by INTEGER,
  reviewed_at TIMESTAMP,
  review_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_sanctions_user   ON sanctions_screenings(user_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_run_at ON sanctions_screenings(run_at);
CREATE INDEX IF NOT EXISTS idx_sanctions_hit    ON sanctions_screenings(hit, run_at);

-- Axal Fit (migration 115, Task #19) — mirrored here so a fresh schema apply
-- carries the best-fit tables. See sql/migrations/115_axal_fit.sql for docs.
CREATE TABLE IF NOT EXISTS axal_values (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value_key  TEXT NOT NULL,
    score      REAL NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, value_key)
);
CREATE INDEX IF NOT EXISTS idx_axal_values_user ON axal_values (user_id, updated_at);

CREATE TABLE IF NOT EXISTS axal_fit_scores (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona        TEXT NOT NULL,
    total_score    REAL NOT NULL DEFAULT 0,
    band           TEXT NOT NULL,
    rubric_json    TEXT,
    red_flags_json TEXT,
    signal_quality REAL NOT NULL DEFAULT 0,
    narrative_fit  TEXT,
    computed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_axal_fit_scores_latest
    ON axal_fit_scores (user_id, persona, computed_at);

CREATE TABLE IF NOT EXISTS axal_fit_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona     TEXT,
    report_json TEXT NOT NULL,
    computed_by INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_axal_fit_reports_user ON axal_fit_reports (user_id, created_at);

CREATE TABLE IF NOT EXISTS admin_consultation_bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid          TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id     INTEGER REFERENCES users(id),
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    slot_at      TEXT,
    status       TEXT NOT NULL DEFAULT 'requested',
    topic        TEXT,
    notes        TEXT,
    report_id    INTEGER REFERENCES axal_fit_reports(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consultation_bookings_user   ON admin_consultation_bookings (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_consultation_bookings_status ON admin_consultation_bookings (status, requested_at);
