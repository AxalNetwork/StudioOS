-- 579 — Reporting part 2: duties, periods and events (D1058, #2928, part 2 of
-- #2427). Reserved for this part by D1056 §6.
--
-- A reporting duty is what a signed document says a company owes one investor:
-- "Quarterly KPI report · 45 days after quarter end · Investors' Rights
-- Agreement §1.1(b)". CAPITAL's close (D1215, `closings` and `closing_lines`,
-- migration 612) names who signed; `createReportingDuties(closing)`
-- (`services/reportingDuties.ts`) writes one duty per received line and right.
-- `reporting_duties` is the one table #2424 and #2427 share: CAPITAL names it
-- and its close creates its rows; this part adds it, with every column #2427
-- lists, and owns its periods.
--
--   reporting_duties             one duty: the closing line it is owed on, the
--                                holder, kind, cadence, due rule and days,
--                                required figures and documents, recipients,
--                                and its source (envelope, clause,
--                                body_sha256). A term the paper leaves blank
--                                takes owner question 4's default and is named
--                                in `defaulted_json`. One duty per line and
--                                kind.
--   reporting_periods            one period of a duty, opened by the daily step
--                                as it ends: its label, start, end and due day,
--                                the founder's expected date and note, a waiver,
--                                and the report that met it. Unique on duty and
--                                label. LATE AND MISSING ARE NEVER STORED: they
--                                are worked out on read from `due_on`, today and
--                                the next period.
--   reporting_events             the audit, append-only (the triggers below
--                                refuse an UPDATE or a DELETE). Who, what, when
--                                and ids; never a figure. A reminder is one row
--                                per period and offset, and an ask one per
--                                period and investor, each held by a partial
--                                unique index so a second run or a second press
--                                writes nothing.
--   reporting_reminder_settings  a venture's reminder offsets, channels and
--                                team recipients (RPT7). A venture with no row
--                                takes the defaults in the service.
--
-- MONEY. None of these tables holds an amount.
--
-- Grep first (D689 D-t): no `reporting_duties`, `reporting_periods`,
-- `reporting_events` or `reporting_reminder_settings` table exists in an
-- earlier migration or in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS reporting_duties (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  closing_id          INTEGER NOT NULL REFERENCES closings(id),
  closing_line_id     INTEGER NOT NULL REFERENCES closing_lines(id),
  closing_line_uid    TEXT NOT NULL,
  project_id          INTEGER NOT NULL REFERENCES projects(id),
  holder_user_id      INTEGER REFERENCES users(id),
  kind                TEXT NOT NULL CHECK (kind IN ('monthly_financials', 'quarterly_kpi', 'quarterly_update', 'annual_audited', 'annual_budget')),
  cadence             TEXT NOT NULL CHECK (cadence IN ('monthly', 'quarterly', 'annual')),
  due_rule            TEXT NOT NULL DEFAULT 'after_end' CHECK (due_rule IN ('after_end', 'before_start')),
  due_days            INTEGER NOT NULL CHECK (typeof(due_days) = 'integer' AND due_days BETWEEN 0 AND 366),
  required_figures    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_figures) AND json_type(required_figures) = 'array'),
  required_documents  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_documents) AND json_type(required_documents) = 'array'),
  recipients_json     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recipients_json) AND json_type(recipients_json) = 'array'),
  source_envelope_id  INTEGER REFERENCES esign_envelopes(id),
  source_document     TEXT NOT NULL,
  source_clause       TEXT NOT NULL,
  body_sha256         TEXT,
  source_kind         TEXT NOT NULL CHECK (source_kind IN ('signed_envelope', 'closing_template')),
  defaulted_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(defaulted_json) AND json_type(defaulted_json) = 'array'),
  starts_on           TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reporting_duties_line_kind ON reporting_duties (closing_line_id, kind);
CREATE INDEX IF NOT EXISTS idx_reporting_duties_project ON reporting_duties (project_id, id);
CREATE INDEX IF NOT EXISTS idx_reporting_duties_holder ON reporting_duties (holder_user_id, project_id);

CREATE TABLE IF NOT EXISTS reporting_periods (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  duty_id         INTEGER NOT NULL REFERENCES reporting_duties(id),
  period_label    TEXT NOT NULL CHECK (length(period_label) BETWEEN 4 AND 16),
  period_start    TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end      TEXT NOT NULL CHECK (period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_on          TEXT NOT NULL CHECK (due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expected_on     TEXT CHECK (expected_on IS NULL OR expected_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expected_note   TEXT CHECK (expected_note IS NULL OR length(expected_note) <= 280),
  expected_by     INTEGER REFERENCES users(id),
  waived_at       TEXT,
  waived_by       INTEGER REFERENCES users(id),
  met_update_id   INTEGER REFERENCES portfolio_updates(id),
  met_at          TEXT,
  opened_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reporting_periods_duty_label ON reporting_periods (duty_id, period_label);
CREATE INDEX IF NOT EXISTS idx_reporting_periods_due ON reporting_periods (due_on, duty_id);

CREATE TABLE IF NOT EXISTS reporting_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  duty_id       INTEGER REFERENCES reporting_duties(id),
  period_id     INTEGER REFERENCES reporting_periods(id),
  actor_user_id INTEGER REFERENCES users(id),
  event         TEXT NOT NULL CHECK (event IN (
                  'duty_created', 'period_opened', 'reminder_sent', 'reminders_set', 'draft_built', 'figure_left_out',
                  'mercury_figure_shared', 'preview_opened', 'sent', 'opened', 'corrected', 'asked', 'expected_set', 'waived')),
  ref           TEXT CHECK (ref IS NULL OR length(ref) <= 200),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reporting_events_project ON reporting_events (project_id, id);
CREATE INDEX IF NOT EXISTS idx_reporting_events_period ON reporting_events (period_id, id);
-- A reminder is sent once per period and offset; an investor asks once per period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reporting_events_reminder ON reporting_events (period_id, ref) WHERE event = 'reminder_sent';
CREATE UNIQUE INDEX IF NOT EXISTS uq_reporting_events_ask ON reporting_events (period_id, actor_user_id) WHERE event = 'asked';

CREATE TRIGGER IF NOT EXISTS trg_reporting_events_no_update
BEFORE UPDATE ON reporting_events
BEGIN
  SELECT RAISE(ABORT, 'reporting_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_reporting_events_no_delete
BEFORE DELETE ON reporting_events
BEGIN
  SELECT RAISE(ABORT, 'reporting_events is append-only');
END;

CREATE TABLE IF NOT EXISTS reporting_reminder_settings (
  project_id         INTEGER PRIMARY KEY REFERENCES projects(id),
  offsets_json       TEXT NOT NULL CHECK (json_valid(offsets_json) AND json_type(offsets_json) = 'array'),
  channels_json      TEXT NOT NULL CHECK (json_valid(channels_json) AND json_type(channels_json) = 'array'),
  recipients_json    TEXT NOT NULL CHECK (json_valid(recipients_json) AND json_type(recipients_json) = 'array'),
  updated_by         INTEGER NOT NULL REFERENCES users(id),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
