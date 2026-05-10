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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_founders_email ON founders(email);

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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

CREATE TABLE IF NOT EXISTS score_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id),
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
    project_id INTEGER REFERENCES projects(id),
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
    project_id INTEGER NOT NULL REFERENCES projects(id),
    partner_id INTEGER REFERENCES partners(id),
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'scored', 'active', 'funded', 'rejected')),
    notes TEXT,
    amount REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deals_project ON deals(project_id);

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
    project_id INTEGER NOT NULL REFERENCES projects(id),
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

CREATE TABLE IF NOT EXISTS roadmap_okrs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
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
