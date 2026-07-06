-- T13/T14/T15 — Advisors, Partner Office Hours, Watchlist, Decision Journal,
-- Portfolio Health, Reference Checks, Co-marketing, Company Profiles,
-- Founder Needs / RFPs / Quotes / Engagements, Insights.
--
-- Apply once after deploy:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/t13_t14_t15.sql --remote
--
-- All tables use `IF NOT EXISTS` so re-runs are no-ops. We rely on UNIQUE
-- constraints + INSERT...ON CONFLICT (UPSERT) for race-safety since D1 has
-- no `SELECT ... FOR UPDATE`.

-- ---------------------------------------------------------------------------
-- T13.1 — Advisors + office-hour slots + bookings + reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  bio TEXT,
  expertise_json TEXT NOT NULL DEFAULT '[]',
  sectors_json TEXT NOT NULL DEFAULT '[]',
  linkedin_url TEXT,
  hourly_rate_usd INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advisors_active ON advisors(is_active);

-- Augment users so a user row knows about its advisor profile.
-- D1/SQLite: ALTER TABLE ADD COLUMN is fine; this errors if already present
-- on re-run, so we wrap in a no-op TRY pattern via separate file convention.
-- (Operators applying twice should ignore the "duplicate column" error.)
ALTER TABLE users ADD COLUMN advisor_id INTEGER;

CREATE TABLE IF NOT EXISTS advisor_office_hour_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  meeting_url TEXT,
  notes TEXT,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advisor_slots_advisor ON advisor_office_hour_slots(advisor_id, starts_at);

CREATE TABLE IF NOT EXISTS advisor_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  slot_id INTEGER NOT NULL,
  advisor_id INTEGER NOT NULL,
  founder_user_id INTEGER NOT NULL,
  topic TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|completed|cancelled|no_show
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (slot_id, founder_user_id)
);
CREATE INDEX IF NOT EXISTS idx_advisor_bookings_advisor ON advisor_bookings(advisor_id, status);
CREATE INDEX IF NOT EXISTS idx_advisor_bookings_founder ON advisor_bookings(founder_user_id, status);

CREATE TABLE IF NOT EXISTS advisor_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL,
  reviewer_user_id INTEGER NOT NULL,
  reviewer_role TEXT NOT NULL, -- 'founder' | 'advisor'
  rating INTEGER NOT NULL,     -- 1..5
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (booking_id, reviewer_role)
);

-- ---------------------------------------------------------------------------
-- T13.2 — Partner office hours (separate tables; same shape as advisor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_office_hour_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  meeting_url TEXT,
  notes TEXT,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_slots_partner ON partner_office_hour_slots(partner_id, starts_at);

CREATE TABLE IF NOT EXISTS partner_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  slot_id INTEGER NOT NULL,
  partner_id INTEGER NOT NULL,
  founder_user_id INTEGER NOT NULL,
  topic TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (slot_id, founder_user_id)
);
CREATE INDEX IF NOT EXISTS idx_partner_bookings_partner ON partner_bookings(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_bookings_founder ON partner_bookings(founder_user_id, status);

-- ---------------------------------------------------------------------------
-- T14.1 — Watchlist items (per-user, project-level), with anti-portfolio flag
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  conviction TEXT,            -- 'low' | 'medium' | 'high'
  thesis TEXT,
  next_check_at TEXT,
  status TEXT NOT NULL DEFAULT 'watching', -- watching | converted | passed
  passed_reason TEXT,
  passed_at TEXT,
  converted_deal_id INTEGER,
  converted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_owner ON watchlist_items(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_watchlist_project ON watchlist_items(project_id);

-- ---------------------------------------------------------------------------
-- T14.2 — Decision journal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decision_journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL,
  project_id INTEGER,
  deal_id INTEGER,
  decision TEXT NOT NULL,           -- 'invest' | 'pass' | 'follow' | 'other'
  thesis TEXT NOT NULL,
  expected_outcome TEXT,
  conviction TEXT,                  -- low|medium|high
  outcome TEXT,                     -- 'win'|'loss'|'pending'
  outcome_notes TEXT,
  outcome_recorded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_owner ON decision_journal_entries(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_journal_project ON decision_journal_entries(project_id);

-- ---------------------------------------------------------------------------
-- T14.3 — Portfolio health snapshots (one per project per day)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_health_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,        -- YYYY-MM-DD
  score INTEGER NOT NULL,             -- 0..100
  badge TEXT NOT NULL,                -- green|yellow|red
  intervention INTEGER NOT NULL DEFAULT 0,
  drivers_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_health_project ON portfolio_health_snapshots(project_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- T14.4 — Reference checks (table named `reference_checks` to avoid the
-- SQL reserved word `REFERENCES`)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  deal_id INTEGER NOT NULL,
  reference_name TEXT NOT NULL,
  reference_email TEXT,
  reference_role TEXT,
  relationship TEXT,
  scheduled_at TEXT,
  consent_given INTEGER NOT NULL DEFAULT 0,
  consent_given_at TEXT,
  consent_text TEXT,
  consent_captured_by INTEGER,
  recording_file_key TEXT,
  recording_size_bytes INTEGER,
  recording_content_type TEXT,
  recording_uploaded_at TEXT,
  transcript TEXT,
  transcribed_at TEXT,
  summary_json TEXT,
  summarized_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refchk_deal ON reference_checks(deal_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- T15.1 — Co-marketing pitches + attributions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comarketing_pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL,
  submitter_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'webinar',
  proposed_date TEXT,
  target_audience TEXT,
  distribution_channels TEXT,
  co_branding_notes TEXT,
  asset_url TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|rejected|published|withdrawn
  review_notes TEXT,
  reviewed_by_user_id INTEGER,
  reviewed_at TEXT,
  published_at TEXT,
  published_url TEXT,
  attribution_code TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comark_status ON comarketing_pitches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comark_partner ON comarketing_pitches(partner_id, status);

CREATE TABLE IF NOT EXISTS comarketing_attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  pitch_id INTEGER NOT NULL,
  partner_id INTEGER NOT NULL,
  event_kind TEXT NOT NULL, -- visit|signup|lead|conversion
  user_id INTEGER,
  project_id INTEGER,
  lead_email TEXT,
  referrer TEXT,
  landing_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comark_attr_pitch ON comarketing_attributions(pitch_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- T15.2 — Company profiles + memberships
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  stage TEXT,
  revenue_range TEXT,
  employee_count INTEGER,
  current_products TEXT,
  international_presence TEXT,
  expansion_goals TEXT,
  logo_url TEXT,
  website TEXT,
  linkedin_url TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_company_stage ON company_profiles(stage);

CREATE TABLE IF NOT EXISTS user_company_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role_in_company TEXT NOT NULL DEFAULT 'Member',
  is_primary_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_uclink_user ON user_company_links(user_id);

-- ---------------------------------------------------------------------------
-- T15.3 — Founder needs / RFPs / Quotes / Engagements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS founder_needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  founder_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  budget_min REAL,
  budget_max REAL,
  timeline TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open|in_review|closed|filled
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_needs_status ON founder_needs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_needs_founder ON founder_needs(founder_id);
CREATE INDEX IF NOT EXISTS idx_needs_project ON founder_needs(project_id);

CREATE TABLE IF NOT EXISTS rfps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  need_id INTEGER NOT NULL UNIQUE,
  scope_md TEXT NOT NULL,
  deliverables_md TEXT,
  deadline_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  need_id INTEGER NOT NULL,
  rfp_id INTEGER,
  partner_id INTEGER NOT NULL,
  price REAL NOT NULL,
  timeline_weeks INTEGER,
  deliverables TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted|accepted|rejected|withdrawn
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (need_id, partner_id)
);
CREATE INDEX IF NOT EXISTS idx_quotes_need ON quotes(need_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_partner ON quotes(partner_id, status);

CREATE TABLE IF NOT EXISTS engagements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  need_id INTEGER NOT NULL,
  quote_id INTEGER NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL,
  founder_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  delivered_at TEXT,
  delivery_notes TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  invoice_id TEXT,
  invoiced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_engagements_partner ON engagements(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_engagements_founder ON engagements(founder_id, status);

CREATE TABLE IF NOT EXISTS engagement_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL,
  reviewer_user_id INTEGER NOT NULL,
  reviewer_role TEXT NOT NULL, -- 'founder' | 'partner'
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (engagement_id, reviewer_role)
);

CREATE TABLE IF NOT EXISTS service_offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_min REAL,
  price_max REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- T15.4 — Insights subscriptions + digests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insight_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  is_subscribed INTEGER NOT NULL DEFAULT 1,
  cadence TEXT NOT NULL DEFAULT 'weekly',
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insight_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  digest_date TEXT NOT NULL,
  body_json TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (digest_date)
);
