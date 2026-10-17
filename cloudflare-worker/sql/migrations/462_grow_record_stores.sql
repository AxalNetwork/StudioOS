-- 462 — the stores behind Grow's Add forms and records (D691 S19-A, #1697).
--
-- Every Grow Add form (`Cycle Overview.dc.html`, CO:324-330) gets a store
-- behind each field it asks for, and every Grow record (CO:382-388) a home for
-- the rows it draws. #1697 builds the writes on these; #1698 the records, the
-- actions and the daily step. Decision numbers are #1697's.
--
-- Grep first (D-t): no column below exists on its table in schema_baseline.sql
-- or in any earlier migration, and none of the nine new tables exists.
-- `grow_writes_d691.test.ts` holds that as an assertion. A column or table a
-- store already has is reused, never doubled: `product_feedback.from_name`,
-- `from_email`, `theme` and `roadmap_item_*` (443), `job_postings.team` and
-- `target_start` (443), `compliance_events.recurrence` (baseline) and
-- `project_metrics` (249) for every typed KPI but a custom one.
--
--   product_feedback.from_company / notify_on_ship / told_at / told_via
--     "[Name] · [Company]" and "Tell them when it ships" (decision 5). The
--     platform never emails a venture's customer: Mark told records how the
--     founder told them.
--
--   growth_channels.kind / cac_bar_cents / bar_currency, channel_experiments
--     The eight Channel chips and "Strong when CAC under [€200]"; a channel's
--     experiments (#1698's add-experiment action).
--
--   kpi_alerts, custom_kpis, custom_kpi_values
--     Enter a KPI's Custom chip (decision 4), and the alerts #1698's daily step
--     checks. A typed money value is whole cents.
--
--   job_postings.comp_min_cents / comp_max_cents / comp_currency / equity_pct
--     "Compensation band" on Open a role. Stored and shown on the record only,
--     never on the public jobs board.
--
--   growth_partners, rebuilt (decision 7)
--     SQLite cannot alter a CHECK, and Type gains Co-marketing and Stage gains
--     Paused. Terms keep a percentage and an amount apart; the free-text
--     `terms` stays and is read when `terms_kind` is NULL.
--
--   growth_partner_deals
--     The deals a partner sourced. `partner_deals` is the partner programme's
--     table (schema_baseline.sql), so this name.
--
--   markets.geography_ref / size_cents / size_currency / size_source,
--   market_entry_steps, market_localisation
--     "Attach" a Research › Geographies country (`research_countries.code`,
--     376), the market's size, its entry plan and its localisation checks.
--
--   compliance_events.remind_days_json, obligation_agenda_items,
--   obligation_occurrences
--     Remind ("[14] days before"), an obligation's agenda and each time it was
--     held. `compliance_events` has two definitions (034 and the baseline), so
--     this file names only its `id` and the column it adds.
--
-- THE REBUILD. D1 runs this file as one implicit transaction, so it carries no
-- transaction keywords, and `PRAGMA defer_foreign_keys = TRUE` lets the check
-- run at the batch's end (migration 200, GOTCHAS.md). The table is dropped and
-- recreated under its OWN name, then filled, because only inserts into the
-- named table clear the deferred-violation counter. `DROP TABLE growth_partners`
-- runs an implicit DELETE that fires `partner_revenue`'s ON DELETE CASCADE
-- whatever the pragma says, so `partner_revenue` is snapshotted too and its
-- rows are put back with their ids. Every partner keeps its `id` and `uid`.
--
-- Additive otherwise: no row is rewritten or backfilled. Money is `*_cents
-- INTEGER` with a three-letter lowercase currency stored only beside an amount.

-- Preflight: the shape 443 gave growth_partners. Reads nothing; fails the file
-- on a database without it. Keep it first.
SELECT id, uid, project_id, name, type, stage, terms, comarketing_pitch_id, created_by, created_at, updated_at
  FROM growth_partners WHERE 0;

PRAGMA defer_foreign_keys = TRUE;

-- ── Product improvement (MG1) ───────────────────────────────────────────────
ALTER TABLE product_feedback ADD COLUMN from_company TEXT;
ALTER TABLE product_feedback ADD COLUMN notify_on_ship INTEGER NOT NULL DEFAULT 0 CHECK (notify_on_ship IN (0, 1));
ALTER TABLE product_feedback ADD COLUMN told_at TEXT;
ALTER TABLE product_feedback ADD COLUMN told_via TEXT CHECK (told_via IS NULL OR told_via IN ('email', 'call', 'message', 'in_person'));

-- ── Distribution (MG2) ──────────────────────────────────────────────────────
ALTER TABLE growth_channels ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('content', 'paid_search', 'paid_social', 'outbound', 'referral', 'partner', 'events', 'other'));
ALTER TABLE growth_channels ADD COLUMN cac_bar_cents INTEGER CHECK (cac_bar_cents IS NULL OR cac_bar_cents >= 0);
ALTER TABLE growth_channels ADD COLUMN bar_currency TEXT;

CREATE TABLE IF NOT EXISTS channel_experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  channel_id INTEGER NOT NULL REFERENCES growth_channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  run_on TEXT,
  cac_cents INTEGER CHECK (cac_cents IS NULL OR cac_cents >= 0),
  currency TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channel_experiments_channel ON channel_experiments(channel_id);

-- ── Revenue and traction (MG3) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_key TEXT NOT NULL,
  measure TEXT NOT NULL DEFAULT 'value' CHECK (measure IN ('value', 'change_30d_pct')),
  op TEXT NOT NULL CHECK (op IN ('below', 'above')),
  -- A count or a percentage.
  threshold REAL,
  -- A money KPI's value.
  threshold_cents INTEGER,
  created_by INTEGER REFERENCES users(id),
  last_crossed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((threshold IS NULL) <> (threshold_cents IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_kpi_alerts_project ON kpi_alerts(project_id, kpi_key);

CREATE TABLE IF NOT EXISTS custom_kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  unit TEXT NOT NULL DEFAULT 'count' CHECK (unit IN ('count', 'pct', 'money')),
  currency TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One custom KPI per name per venture, whatever its case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_kpis_label ON custom_kpis(project_id, lower(label));

CREATE TABLE IF NOT EXISTS custom_kpi_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  kpi_id INTEGER NOT NULL REFERENCES custom_kpis(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  value REAL,
  value_cents INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((value IS NULL) <> (value_cents IS NULL))
);
-- One value per KPI per day per source: a second entry the same day updates it,
-- as the metric CSV import upserts `project_metrics`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_kpi_values_day ON custom_kpi_values(kpi_id, as_of, source);

-- ── Team expansion (MG4) ────────────────────────────────────────────────────
ALTER TABLE job_postings ADD COLUMN comp_min_cents INTEGER;
ALTER TABLE job_postings ADD COLUMN comp_max_cents INTEGER;
ALTER TABLE job_postings ADD COLUMN comp_currency TEXT;
ALTER TABLE job_postings ADD COLUMN equity_pct REAL CHECK (equity_pct IS NULL OR equity_pct BETWEEN 0 AND 100);

-- ── Partner network (MG5): the rebuild ──────────────────────────────────────
DROP TABLE IF EXISTS growth_partners_pre462_snapshot;
DROP TABLE IF EXISTS partner_revenue_pre462_snapshot;
CREATE TABLE growth_partners_pre462_snapshot AS SELECT * FROM growth_partners;
CREATE TABLE partner_revenue_pre462_snapshot AS SELECT * FROM partner_revenue;

DROP TABLE growth_partners;

CREATE TABLE growth_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  type TEXT NOT NULL CHECK (type IN ('reseller', 'integration', 'agency', 'referral', 'co_marketing', 'other')),
  stage TEXT NOT NULL DEFAULT 'talking' CHECK (stage IN ('talking', 'terms', 'signed', 'paused', 'ended')),
  -- Free text, as 443 kept it; read when terms_kind is NULL.
  terms TEXT,
  comarketing_pitch_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  terms_kind TEXT CHECK (terms_kind IS NULL OR terms_kind IN ('rev_share', 'services_fee', 'referral_fee', 'none')),
  terms_pct REAL CHECK (terms_pct IS NULL OR terms_pct BETWEEN 0 AND 100),
  terms_amount_cents INTEGER CHECK (terms_amount_cents IS NULL OR terms_amount_cents >= 0),
  terms_currency TEXT,
  renewal_on TEXT,
  contact_name TEXT,
  contact_email TEXT,
  -- A percentage or an amount, never both.
  CHECK (terms_pct IS NULL OR terms_amount_cents IS NULL)
);

INSERT INTO growth_partners (id, uid, project_id, name, type, stage, terms, comarketing_pitch_id, created_by, created_at, updated_at)
SELECT id, uid, project_id, name, type, stage, terms, comarketing_pitch_id, created_by, created_at, updated_at
  FROM growth_partners_pre462_snapshot;

-- Whether or not the cascade fired, the revenue rows end as they began.
DELETE FROM partner_revenue;
INSERT INTO partner_revenue (id, partner_id, month, amount_cents, source, recorded_by, created_at)
SELECT id, partner_id, month, amount_cents, source, recorded_by, created_at
  FROM partner_revenue_pre462_snapshot;

DROP TABLE growth_partners_pre462_snapshot;
DROP TABLE partner_revenue_pre462_snapshot;

CREATE INDEX IF NOT EXISTS idx_growth_partners_project ON growth_partners(project_id);
CREATE INDEX IF NOT EXISTS idx_partner_revenue_partner ON partner_revenue(partner_id);

CREATE TABLE IF NOT EXISTS growth_partner_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,
  customer TEXT NOT NULL CHECK (length(trim(customer)) > 0),
  closed_on TEXT,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_growth_partner_deals_partner ON growth_partner_deals(partner_id);

-- ── Market expansion (MG6) ──────────────────────────────────────────────────
-- A research_countries.code; no foreign key, as the directory is reloaded.
ALTER TABLE markets ADD COLUMN geography_ref TEXT;
ALTER TABLE markets ADD COLUMN size_cents INTEGER CHECK (size_cents IS NULL OR size_cents >= 0);
ALTER TABLE markets ADD COLUMN size_currency TEXT;
ALTER TABLE markets ADD COLUMN size_source TEXT;

CREATE TABLE IF NOT EXISTS market_entry_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  owner_name TEXT,
  due_on TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_entry_steps_market ON market_entry_steps(market_id);

CREATE TABLE IF NOT EXISTS market_localisation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key IN ('language', 'payments', 'legal_entity')),
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (market_id, key)
);

-- ── Durable company-building (MG7) ──────────────────────────────────────────
-- Whole days before the due date, at most three, as a JSON array.
ALTER TABLE compliance_events ADD COLUMN remind_days_json TEXT;

CREATE TABLE IF NOT EXISTS obligation_agenda_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  event_id INTEGER NOT NULL REFERENCES compliance_events(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  owner_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obligation_agenda_items_event ON obligation_agenda_items(event_id);

CREATE TABLE IF NOT EXISTS obligation_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  event_id INTEGER NOT NULL REFERENCES compliance_events(id) ON DELETE CASCADE,
  held_on TEXT NOT NULL,
  minutes_file_key TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obligation_occurrences_event ON obligation_occurrences(event_id, held_on);
