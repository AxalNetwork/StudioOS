-- 208 — the stores behind Pipeline · Negotiations and Retainers, and the four
-- Delivery zones.
--
-- WHAT IS MISSING TODAY. Six of the fifteen partner zones render a real body.
-- The other nine render a `NoStoreYet` card naming the column they would need,
-- and every one of those columns was verified absent before this file was
-- written. `engagements` (sql/t13_t14_t15.sql:366) has eighteen columns and one
-- ALTER ever added to it (`company_id`, migration 196), with no cadence, no
-- renewal date, no consumption, no milestone, no hours, no last client contact
-- and no acknowledgment. `quotes` (:347) has a four-value status and a
-- `decided_at`, and nothing between "sent" and "decided". This file adds ten
-- tables for the six zones in Pipeline and Delivery; 209 does Offers.
--
-- SIDE TABLES, NOT COLUMNS, and not only because `users` is full. `quotes` and
-- `engagements` are each defined three times across schema.sql,
-- t13_t14_t15.sql and the migration set, and D1 keeps one table per name —
-- so a column added to one lineage may or may not exist on the row that won.
-- `check-migration-column-shapes.mjs` exists because migration 196 learned
-- that the hard way. Every table here keys on `id`, which every definition has.
--
-- WHICH PARTNER KEY. There are two live conventions: `users.id` for facts about
-- an ACCOUNT (perks, service_offerings, partner_deals) and `partners.id` for
-- facts about the DIRECTORY ENTITY (quotes, engagements, office hours). Every
-- table below hangs off an engagement or a quote rather than off a partner
-- directly, so it inherits whichever key its parent already uses and introduces
-- no third convention.
--
-- MONEY IS INTEGER CENTS even though `engagements.price` beside it is REAL.
-- The float half of this schema is a data migration over live records, not a
-- lint fix, and it is not attempted here — but `check-money-cents.mjs` stops
-- the split growing, and a retainer's monthly figure is new money.
--
-- WHAT THIS FILE DOES NOT DECIDE. Nothing here is a derived value. Engagement
-- health is computed at read time from milestones, retainer usage and last
-- client contact — a stored health score would be a second source of truth for
-- something three tables already say, and the first time one of them moved the
-- two would disagree. The same reasoning keeps "days stalled", "utilisation"
-- and "median days to open" out of the schema entirely.
--
-- IDEMPOTENT AND REPLAYABLE. Every statement is IF NOT EXISTS and there is no
-- transaction wrapper — D1 rejects BEGIN/COMMIT inside a migration, which is
-- what migration 200 was rewritten for. The runner is forward-only and aborts
-- the whole deploy on the first failing statement, so a mistake here would
-- hold every later migration and the worker itself.

-- ── Pipeline · Negotiations ────────────────────────────────────────────────
-- A quote today is sent or decided. The conversation between those two states
-- is what this zone is about, and none of it was recorded.
--
-- `ball` is the zone's organising fact: whose move it is. Stored rather than
-- derived because it is a judgement the operator makes, not something the
-- timestamps can be read to mean — a client who has gone quiet for a week may
-- still owe the answer.
CREATE TABLE IF NOT EXISTS quote_negotiations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  stage TEXT NOT NULL DEFAULT 'scoping'
    CHECK (stage IN ('scoping', 'terms', 'legal', 'ready_to_sign', 'closed')),
  ball TEXT NOT NULL DEFAULT 'them'
    CHECK (ball IN ('us', 'them')),
  open_question TEXT,
  -- Set by whoever records a move. "Days stalled" is this subtracted from now
  -- at read time; storing the age would be a number that is wrong by one day
  -- every day nobody writes to the row.
  last_moved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_negotiations_quote
  ON quote_negotiations(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_negotiations_stage
  ON quote_negotiations(stage, last_moved_at DESC);

-- One row per term under discussion. Three positions rather than one value,
-- because "what we asked, what they asked, where it landed" is the whole
-- content of a negotiation and collapsing it to a current value loses the two
-- halves that explain the third.
CREATE TABLE IF NOT EXISTS quote_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  negotiation_id INTEGER NOT NULL REFERENCES quote_negotiations(id),
  label TEXT NOT NULL,
  our_position TEXT,
  their_position TEXT,
  landing TEXT,
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'agreed', 'conceded', 'refused')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quote_terms_negotiation
  ON quote_terms(negotiation_id, state);

-- ── Pipeline · Retainers ───────────────────────────────────────────────────
-- An engagement is a single accepted quote at a single price, so nothing in
-- the store distinguishes a retainer from a one-off. `shape` is that missing
-- fact, and every figure the zone shows depends on it.
CREATE TABLE IF NOT EXISTS partner_retainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  shape TEXT NOT NULL DEFAULT 'retainer'
    CHECK (shape IN ('retainer', 'embedded_seat')),
  cadence TEXT NOT NULL DEFAULT 'monthly'
    CHECK (cadence IN ('monthly', 'quarterly')),
  -- Integer cents. `engagements.price` beside it is REAL and grandfathered;
  -- this is new money and takes the dialect the schema is moving to.
  amount_cents INTEGER,
  -- What the client bought per period. NULL means the retainer is not sold by
  -- the hour, which is a different thing from zero hours and must read as one.
  retained_hours REAL,
  renews_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_retainers_engagement
  ON partner_retainers(engagement_id);
CREATE INDEX IF NOT EXISTS idx_partner_retainers_renews
  ON partner_retainers(renews_at);

-- Consumption per period. Utilisation is this over `retained_hours`, computed
-- at read time and absent when either side is NULL — a retainer with no hours
-- sold has no utilisation, and rendering 0% would assert one.
CREATE TABLE IF NOT EXISTS retainer_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retainer_id INTEGER NOT NULL REFERENCES partner_retainers(id),
  period TEXT NOT NULL,
  hours_used REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_retainer_usage_period
  ON retainer_usage(retainer_id, period);

-- ── Delivery · Health ──────────────────────────────────────────────────────
-- Health is DERIVED and this is one of its three inputs. A health pill
-- computed from `engagements.status` alone would rate every live engagement
-- identically and call it a judgement.
CREATE TABLE IF NOT EXISTS engagement_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  title TEXT NOT NULL,
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_engagement_milestones_engagement
  ON engagement_milestones(engagement_id, due_at);

-- ── Delivery · Deliverables ────────────────────────────────────────────────
-- Nothing recorded what was shipped, and nothing recorded whether it was read.
-- A deliverable sent and never opened is the firm's most expensive state —
-- invoiced, unreviewed, and blocking the next milestone.
--
-- `opened_at` and `signed_off_at` are the CLIENT's to set. Only the founder
-- side can truthfully say a thing was read, so a partner-side write to either
-- would be the firm reporting a metric about itself, which is the failure the
-- Proof zone in 209 is shaped to avoid as well.
CREATE TABLE IF NOT EXISTS engagement_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  title TEXT NOT NULL,
  version TEXT,
  link_url TEXT,
  sent_at TEXT,
  sent_by INTEGER,
  opened_at TEXT,
  signed_off_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_engagement_deliverables_engagement
  ON engagement_deliverables(engagement_id, sent_at DESC);

-- ── Delivery · Capacity ────────────────────────────────────────────────────
-- Two stores, because the zone's consequential row is a person who is BOTH
-- over-committed AND holding a granted seat inside a client's systems. That is
-- a trust exposure rather than only a throughput one, and neither table can
-- state it alone.
--
-- `revoked_at` rather than a delete: a revoked grant stays visible, which is
-- how the Delivery board keeps a struck-through seat on the page instead of
-- silently losing the fact that access once existed.
CREATE TABLE IF NOT EXISTS engagement_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  holder_user_id INTEGER NOT NULL REFERENCES users(id),
  -- Free text on purpose: what a client granted is their vocabulary, not ours.
  -- "Board, KPIs" is a truthful record; an enum would force it into ours.
  scope TEXT,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_engagement_seats_engagement
  ON engagement_seats(engagement_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_engagement_seats_holder
  ON engagement_seats(holder_user_id, revoked_at);

CREATE TABLE IF NOT EXISTS engagement_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  person_user_id INTEGER NOT NULL REFERENCES users(id),
  period TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_hours_period
  ON engagement_hours(engagement_id, person_user_id, period);
CREATE INDEX IF NOT EXISTS idx_engagement_hours_person
  ON engagement_hours(person_user_id, period);

-- ── Delivery · Status reports ──────────────────────────────────────────────
-- The recurring client-facing update: shipped, next, blocked. It reads the
-- deliverables log above and the blockers below, which is why it is last.
CREATE TABLE IF NOT EXISTS engagement_status_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  period TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'sent')),
  shipped TEXT,
  next_up TEXT,
  sent_at TEXT,
  sent_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_status_reports_period
  ON engagement_status_reports(engagement_id, period);

-- `side` is the column the zone's editorial point rests on: a blocker on the
-- client's side has to be nameable as such, plainly and without treating it as
-- an excuse. A blockers table with no side would make every delay the firm's.
CREATE TABLE IF NOT EXISTS engagement_blockers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  side TEXT NOT NULL DEFAULT 'ours'
    CHECK (side IN ('ours', 'client')),
  summary TEXT NOT NULL,
  raised_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleared_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_engagement_blockers_engagement
  ON engagement_blockers(engagement_id, cleared_at);
