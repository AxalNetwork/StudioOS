CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'founder' CHECK (role IN ('admin', 'founder', 'partner')),
    password_hash TEXT,
    founder_id INTEGER REFERENCES founders(id),
    partner_id INTEGER REFERENCES partners(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    verification_token TEXT,
    verification_token_expires TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);

CREATE TABLE IF NOT EXISTS founders (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    linkedin_url TEXT,
    domain_expertise TEXT,
    experience_years INTEGER NOT NULL DEFAULT 0,
    bio TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_founders_email ON founders(email);

CREATE TABLE IF NOT EXISTS partners (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT UNIQUE NOT NULL,
    specialization TEXT,
    referral_code TEXT UNIQUE,
    referrals_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partners_email ON partners(email);

CREATE TABLE IF NOT EXISTS entities (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('holding_company', 'project', 'subsidiary', 'vc_fund')),
    parent_id INTEGER REFERENCES entities(id),
    jurisdiction TEXT,
    incorporation_date DATE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
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
    tam DOUBLE PRECISION,
    sam DOUBLE PRECISION,
    users_count INTEGER,
    revenue DOUBLE PRECISION,
    growth_signals TEXT,
    cost_to_mvp DOUBLE PRECISION,
    funding_needed DOUBLE PRECISION,
    use_of_funds TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

CREATE TABLE IF NOT EXISTS score_snapshots (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    total_score DOUBLE PRECISION NOT NULL,
    tier TEXT NOT NULL,
    market_size DOUBLE PRECISION DEFAULT 0,
    market_urgency DOUBLE PRECISION DEFAULT 0,
    market_trend DOUBLE PRECISION DEFAULT 0,
    market_total DOUBLE PRECISION DEFAULT 0,
    team_expertise DOUBLE PRECISION DEFAULT 0,
    team_execution DOUBLE PRECISION DEFAULT 0,
    team_network DOUBLE PRECISION DEFAULT 0,
    team_total DOUBLE PRECISION DEFAULT 0,
    product_mvp_time DOUBLE PRECISION DEFAULT 0,
    product_complexity DOUBLE PRECISION DEFAULT 0,
    product_dependency DOUBLE PRECISION DEFAULT 0,
    product_total DOUBLE PRECISION DEFAULT 0,
    capital_cost_mvp DOUBLE PRECISION DEFAULT 0,
    capital_time_revenue DOUBLE PRECISION DEFAULT 0,
    capital_burn_traction DOUBLE PRECISION DEFAULT 0,
    capital_total DOUBLE PRECISION DEFAULT 0,
    fit_alignment DOUBLE PRECISION DEFAULT 0,
    fit_synergy DOUBLE PRECISION DEFAULT 0,
    fit_total DOUBLE PRECISION DEFAULT 0,
    distribution_channels DOUBLE PRECISION DEFAULT 0,
    distribution_virality DOUBLE PRECISION DEFAULT 0,
    distribution_total DOUBLE PRECISION DEFAULT 0,
    ai_adjustment DOUBLE PRECISION DEFAULT 0,
    ai_notes TEXT,
    scored_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_project ON score_snapshots(project_id);

CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    project_id INTEGER REFERENCES projects(id),
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'sent', 'signed')),
    content TEXT,
    template_name TEXT,
    signed_by TEXT,
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_memos (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    score_snapshot_id INTEGER REFERENCES score_snapshots(id),
    startup_name TEXT NOT NULL,
    founders TEXT NOT NULL,
    sector TEXT,
    stage TEXT,
    total_score DOUBLE PRECISION NOT NULL,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memos_project ON deal_memos(project_id);

CREATE TABLE IF NOT EXISTS deals (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    partner_id INTEGER REFERENCES partners(id),
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'scored', 'active', 'funded', 'rejected')),
    notes TEXT,
    amount DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_project ON deals(project_id);

CREATE TABLE IF NOT EXISTS lp_investors (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    committed_capital DOUBLE PRECISION NOT NULL DEFAULT 0,
    called_capital DOUBLE PRECISION NOT NULL DEFAULT 0,
    fund_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capital_calls (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    lp_investor_id INTEGER NOT NULL REFERENCES lp_investors(id),
    project_id INTEGER REFERENCES projects(id),
    amount DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    due_date DATE,
    paid_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    submitted_by TEXT,
    assigned_to TEXT,
    user_id INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    project_id INTEGER REFERENCES projects(id),
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT,
    actor TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id);
