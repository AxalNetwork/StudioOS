-- 278 — seven declarations that a sub-cutoff migration never applied, each
-- with a live reader. This lands them (D190).
--
-- WHY A MIGRATION'S TABLES CAN GO MISSING WHILE ITS LEDGER ROW SAYS APPLIED.
-- All five declaring files here — 034, 048, 056, 095 and 114 — sit below
-- BASELINE_CUTOFF = 219. On a new database `migrate-d1 --bootstrap` loads
-- `schema_baseline.sql` and then MARKS every file at or below the cutoff as
-- applied WITHOUT RUNNING A STATEMENT OF IT (scripts/lib/migrationPlan.mjs,
-- mode 'bootstrap'). That is correct — the sub-cutoff files are not
-- replayable, because CREATE TABLE users, projects, deals and documents live
-- only in sql/historical/schema.sql. So a sub-cutoff migration's effect
-- reaches a database ONLY IF THE BASELINE ALREADY CARRIES IT, and the
-- baseline is a dump of production taken before these seven landed.
--
-- This is the same class migration 276 (D188) repaired one migration over,
-- and the same class 275 (D187) repaired before that. 276 took the COLUMNS
-- migration 042 declared; 278 takes the TABLES.
--
-- MEASURED read-only against production studioos-db on 2026-09-22, schema and
-- aggregates only, no user content. `sqlite_master` returns NONE of the eight
-- objects below; the query came back holding only the FK parents —
-- advisor_answers, founders, partners, projects, service_offerings, users.
-- So every parent this file references is present and every child is absent.
--
--   service_engagements      034   routes/services.ts:132,255
--                                  routes/research.ts:1493 (COUNT subquery)
--   founder_risk_pulls       034   routes/founder_risk.ts:44,121,139
--   venture_risk_overrides   114   services/ventureRisk.ts:522,557,581
--   customer_chat_threads    056   routes/customer_chat.ts:63,98,226,232,
--                                  303,310,321
--   customer_chat_messages   056   routes/customer_chat.ts:75,237,334
--   advisor_state            048   services/advisor/stateMachine.ts:246,
--                                  314,555
--   partners.accepting_intros 095  routes/partner_portal.ts:152 (SELECT),
--                                  :168 (write)
--
-- THE FAILURES ARE NOT UNIFORM, AND THAT IS WHY THIS WAS INVISIBLE.
-- `advisor_state`'s three statements each sit inside a bare
-- `catch { /* best-effort */ }` — stateMachine.ts:213-215 says the helpers
-- "swallow D1 errors and degrade to an empty result … even on a stale dev DB
-- without `advisor_state` migrated." So the 5-minute anti-repeat penalty and
-- the answer counter have simply never worked, silently. The others throw.
--
-- 034's OTHER DECLARATIONS ARE DELIBERATELY NOT HERE. That file creates about
-- twenty tables; only two of them are missing. `service_offerings` — the FK
-- parent of `service_engagements` — already exists in production, so
-- re-declaring it would be noise at best. Only the objects measured absent
-- are restored.
--
-- 048 DECLARES A THIRD INDEX ON A DIFFERENT TABLE and it belongs with the
-- rest: `idx_advisor_answers_user_status` on `advisor_answers(user_id,
-- saved_status)`. Measured absent from the baseline AND from production,
-- while `advisor_answers` itself exists in both (11 columns). The declaration
-- guard tracks tables and columns, not indexes, so nothing reported it — it
-- is 048's own declaration and it is restored here.
--
-- SHAPES ARE THE DECLARING MIGRATION'S OWN, COPIED VERBATIM, never re-chosen,
-- so the table a reader expects is the table it gets. That is D188's rule and
-- it is why `customer_chat_*` keeps DATETIME where the others keep TEXT: 056
-- wrote it that way, the two are the same SQLite storage class, and changing
-- it here would be a re-decision dressed as a restore.
--
-- SIZING: every object below is created empty. Nothing is rewritten, nothing
-- is dropped, and the one ALTER is on `partners`, which has 19 columns —
-- nowhere near D1's 100-column cap (measured; that cap is what made 042's
-- eighteenth declaration dead as written, recorded in 276).
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).

-- Founder Risk pulls — 034 -------------------------------------------------
-- Admin-recorded; the latest row per founder is "current".
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

-- Service engagements — 034 ------------------------------------------------
-- A founder requesting an offering from its owner. `service_offerings`, the
-- FK parent, already exists and is NOT re-declared here.
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

-- Venture Risk analyst overrides — 114 -------------------------------------
-- The AUTO score per layer is computed live and is NOT stored; this table
-- persists only the ANALYST override, one row per (project_id, layer_key).
-- The upsert path binds ON CONFLICT(project_id, layer_key), so the UNIQUE
-- constraint below is load-bearing rather than decorative.
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

-- Customer chat — 056 ------------------------------------------------------
-- One feature, two tables; they stand or fall together. Maps a StudioOS
-- user_id to a Slack channel + thread_ts so replies route back to the panel.
CREATE TABLE IF NOT EXISTS customer_chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  slack_channel TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'closed'
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  last_message_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cct_user
  ON customer_chat_threads(user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_cct_thread
  ON customer_chat_threads(slack_channel, slack_thread_ts);

CREATE TABLE IF NOT EXISTS customer_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  direction TEXT NOT NULL,                       -- 'in' (user→Slack) | 'out' (Slack→user)
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES customer_chat_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_cct_msg_thread
  ON customer_chat_messages(thread_id, created_at);

-- Advisor per-question state — 048 -----------------------------------------
-- `last_asked_at` drives the 5-minute anti-repeat penalty; `answer_count` is
-- bumped by onAnswered(). UNIQUE(user_id, question_id) gives the two upserts
-- at stateMachine.ts:314 and :555 their ON CONFLICT target.
--
-- A REPOINT AT `advisor_turn_audit` WAS CONSIDERED AND IS STRUCTURALLY
-- UNAVAILABLE: that table has twelve columns (043 creates eleven, 270 adds
-- guardrail_category) and `question_id` is not among them, while all three
-- readers key on (user_id, question_id). A table with no question_id cannot
-- carry per-question state. So this is a restore, not a product decision.
CREATE TABLE IF NOT EXISTS advisor_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  last_asked_at TEXT NOT NULL DEFAULT (datetime('now')),
  answer_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_advisor_state_user ON advisor_state(user_id);
CREATE INDEX IF NOT EXISTS idx_advisor_state_user_asked ON advisor_state(user_id, last_asked_at DESC);
-- 048's third index, on a DIFFERENT table — see the header. It lets the state
-- machine ask "has THIS USER ever answered question X?" across conversations;
-- advisor_answers' own index is conversation-scoped only.
CREATE INDEX IF NOT EXISTS idx_advisor_answers_user_status ON advisor_answers(user_id, saved_status);

-- Partner intro opt-out — 095 ----------------------------------------------
-- LAST ON PURPOSE, AND THAT ORDER IS THE ONE THING IN THIS FILE THAT IS NOT
-- 095'S OWN. D1's ALTER TABLE … ADD COLUMN has no IF NOT EXISTS, so this is
-- the only statement here that can fail, and a failure aborts the rest of the
-- file — the runner is forward-only and ordered, which is how 199's failed
-- ALTER held 200–207 out of production (#413). Measured absent from
-- production and from the baseline, so it will apply; placing it after the
-- six idempotent CREATEs means that if it ever meets a database that already
-- has the column, the six tables have already landed before the abort.
ALTER TABLE partners ADD COLUMN accepting_intros INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_partners_accepting_intros
  ON partners (accepting_intros, status);
