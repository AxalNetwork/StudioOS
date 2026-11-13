-- 443 — the Grow stores behind /api/cycles/grow (D664, #1477; part of #1469, D656).
--
-- The Grow overview and its seven module pages (`Cycle Overview.dc.html`,
-- `Cycle Modules · Boards.dc.html` MG1–MG7) read real stores. Where `main`
-- or the Spin-Out Lab already holds one, it is reused; this adds only what is
-- missing. Every typed figure keeps `source = 'manual'`, and the page says so.
-- Nothing here is a 0 standing in for "not recorded": a missing value is NULL.
--
-- Additive: CREATE TABLE IF NOT EXISTS and ADD COLUMN. No row is changed.

-- Product improvement (MG1). No founder product-feedback store existed
-- (`tickets` is the platform's own support desk).
CREATE TABLE IF NOT EXISTS product_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  source TEXT NOT NULL CHECK (source IN ('customer', 'investor', 'team')),
  -- Who gave it, so "Tell the [n] customers who asked" can name them.
  from_name TEXT,
  from_email TEXT,
  theme TEXT,
  -- The roadmap item it led to, as that item's id in its own store; NULL = none yet.
  roadmap_item_ref TEXT,
  roadmap_item_label TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'shipped')),
  shipped_on TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_feedback_project ON product_feedback(project_id, created_at DESC);

-- Distribution (MG2). A channel matches attributed customers by its UTM
-- source (contacts.utm_json, migration 166). Spend is typed per month.
CREATE TABLE IF NOT EXISTS growth_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  utm_source TEXT NOT NULL CHECK (utm_source = lower(trim(utm_source)) AND length(utm_source) > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'testing', 'paused')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, utm_source)
);
CREATE TABLE IF NOT EXISTS channel_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES growth_channels(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  spend_cents INTEGER NOT NULL CHECK (spend_cents >= 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (channel_id, month)
);

-- Revenue and traction (MG3). The split of recurring revenue into new,
-- expansion and churned, by month, computed from the revenue ledger
-- (revenue_entries, migration 311) and rewritten whenever the ledger changes
-- (by hand, CSV or the Stripe import). `source` is the weakest proof level of
-- the rows behind the figure (verified, supported, manual). 'unsplit' holds
-- new and expansion together for a month whose rows cannot tell a customer
-- apart (a Stripe charge with no customer).
CREATE TABLE IF NOT EXISTS revenue_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('new', 'expansion', 'churned', 'unsplit')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  customers INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('verified', 'supported', 'manual')),
  as_of TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, month, kind)
);

-- Team expansion (MG4): a team and a target start on a posting, and a stage
-- that moves on an application. `submitted` rows read as 'applied'.
ALTER TABLE job_postings ADD COLUMN team TEXT;
ALTER TABLE job_postings ADD COLUMN target_start TEXT;
ALTER TABLE job_applications ADD COLUMN stage TEXT NOT NULL DEFAULT 'applied'
  CHECK (stage IN ('applied', 'screen', 'interview', 'offer', 'hired', 'declined'));
ALTER TABLE job_applications ADD COLUMN stage_changed_at TEXT;
ALTER TABLE job_applications ADD COLUMN stage_changed_by INTEGER REFERENCES users(id);

-- Partner network (MG5). Co-marketing pitches are a partner's proposals to the
-- studio, not a founder's partner book, so the founder's partners are their own
-- rows; a partner may point at the pitch it came from.
CREATE TABLE IF NOT EXISTS growth_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  type TEXT NOT NULL CHECK (type IN ('reseller', 'integration', 'agency', 'referral', 'other')),
  stage TEXT NOT NULL DEFAULT 'talking' CHECK (stage IN ('talking', 'terms', 'signed', 'ended')),
  terms TEXT,
  comarketing_pitch_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_revenue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (partner_id, month)
);

-- Market expansion (MG6). Nothing existed. Four readiness parts, each out of
-- 10 with its source; a part with no score is NULL, "Not recorded".
CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  state TEXT NOT NULL DEFAULT 'considering' CHECK (state IN ('considering', 'entering', 'served', 'not_now')),
  demand_score INTEGER CHECK (demand_score IS NULL OR demand_score BETWEEN 0 AND 10),
  demand_source TEXT,
  regulation_score INTEGER CHECK (regulation_score IS NULL OR regulation_score BETWEEN 0 AND 10),
  regulation_source TEXT,
  partners_score INTEGER CHECK (partners_score IS NULL OR partners_score BETWEEN 0 AND 10),
  partners_source TEXT,
  cost_score INTEGER CHECK (cost_score IS NULL OR cost_score BETWEEN 0 AND 10),
  cost_source TEXT,
  decision TEXT CHECK (decision IS NULL OR decision IN ('enter', 'not_yet', 'exit')),
  decided_on TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, name),
  -- A score names where it came from.
  CHECK (demand_score IS NULL OR length(trim(coalesce(demand_source, ''))) > 0),
  CHECK (regulation_score IS NULL OR length(trim(coalesce(regulation_source, ''))) > 0),
  CHECK (partners_score IS NULL OR length(trim(coalesce(partners_source, ''))) > 0),
  CHECK (cost_score IS NULL OR length(trim(coalesce(cost_source, ''))) > 0)
);

-- Durable company-building (MG7): an owner and a kind on a compliance event,
-- and a durability checklist that starts from the Lab's graduation gates.
ALTER TABLE compliance_events ADD COLUMN kind TEXT;
ALTER TABLE compliance_events ADD COLUMN owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE compliance_events ADD COLUMN owner_name TEXT;
ALTER TABLE compliance_events ADD COLUMN created_by INTEGER REFERENCES users(id);
CREATE TABLE IF NOT EXISTS durability_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  done_at TEXT,
  done_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, item_key)
);
