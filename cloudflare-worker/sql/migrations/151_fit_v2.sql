-- Migration 151 — Axal VC Fit & Values v2 (Fit v2).
--
-- Fit v2 upgrades the v1 Axal Fit engine (migration 115, services/axalFit.ts)
-- into a three-layer methodology — Values (what a person optimizes for),
-- Archetypes (how they operate), Skills (what they reliably execute) — scored
-- independently and combined by a six-outcome decision rubric
-- (services/fitDecision.ts). v1 keeps writing axal_values / axal_fit_scores
-- unchanged; v2 stores staged-flow state and append-only decisions here.
--
-- Answers do NOT live in these tables: staged answers are written through the
-- existing advisor pipeline (advisor_answers rows on a hidden
-- advisor_conversations row with state='fit_v2', plus field_sources), so the
-- conversational advisor and the staged /fit flow share one profile.
--
-- Idempotent (IF NOT EXISTS / INSERT OR IGNORE). Mirrored into schema.sql.
-- Lazy bootstrap: services/fitV2Schema.ts::ensureFitV2Schema (tables/indexes
-- only, never the seed — same split as skillsTaxonomySchema).

-- Staged assessment sessions. One in_progress session per (user, role_context)
-- at a time (enforced by the route, not a constraint — history rows keep
-- older statuses). role_context is decoupled from users.role so any user can
-- assess against e.g. internal_hire.
CREATE TABLE IF NOT EXISTS fit_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    uid             TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_context    TEXT NOT NULL,              -- founder|investor|operator|advisor|internal_hire|portfolio_talent
    bank_version    TEXT NOT NULL DEFAULT 'v2.0',
    core_only       INTEGER NOT NULL DEFAULT 1, -- 1 = MVP core subset, 0 = full bank
    status          TEXT NOT NULL DEFAULT 'in_progress', -- in_progress|submitted|scored|abandoned
    current_stage   TEXT NOT NULL DEFAULT 'context',     -- context|values|archetypes|skills|validation|review
    conversation_id INTEGER REFERENCES advisor_conversations(id), -- hidden state='fit_v2' row
    progress_json   TEXT,                       -- {stage:{answered,total}} snapshot for fast resume
    decision_id     INTEGER,                    -- fit_decisions.id once scored
    source          TEXT NOT NULL DEFAULT 'staged',      -- staged|admin_initiated
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_fit_sessions_user ON fit_sessions (user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_fit_sessions_role ON fit_sessions (user_id, role_context, started_at);

-- Append-only v2 decisions; the latest row per (user_id, role_context) is the
-- current decision (v1 axal_fit_scores keeps its own append-only history).
-- Scores/JSON are snapshots at compute time and are never re-derived, so old
-- decisions stay interpretable across bank/engine version bumps.
CREATE TABLE IF NOT EXISTS fit_decisions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                 TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id          INTEGER REFERENCES fit_sessions(id),  -- NULL = admin recompute outside a session
    role_context        TEXT NOT NULL,
    bank_version        TEXT NOT NULL DEFAULT 'v2.0',
    engine_version      TEXT NOT NULL DEFAULT 'v2.0',
    outcome             TEXT NOT NULL,            -- high_fit|conditional_fit|specialist_fit|low_fit|misaligned|insufficient_evidence
    culture_score       REAL NOT NULL DEFAULT 0,  -- 0..100 values vs Axal baseline
    role_score          REAL NOT NULL DEFAULT 0,  -- 0..100 role-template-weighted skills+rubric
    archetype_primary   TEXT,                     -- builder|visionary|connector|operator|scout|steward
    archetype_secondary TEXT,
    archetype_margin    REAL NOT NULL DEFAULT 0,
    confidence          REAL NOT NULL DEFAULT 0,  -- 0..1
    evidence_quality    REAL NOT NULL DEFAULT 0,  -- 0..1
    coverage_json       TEXT,                     -- {values,archetypes,skills,validation: 0..1}
    values_json         TEXT,                     -- {key:{score,confidence,n}} over the 6 v2 values
    skills_json         TEXT,                     -- {slug:{score,confidence,n}} over the 10 priority skills
    rubric_json         TEXT,                     -- role-template rubric category scores
    gaps_json           TEXT,                     -- [{layer,key,detail}]
    flags_json          TEXT,                     -- red-flag keys fired (v1 vocabulary)
    contradictions_json TEXT,                     -- [{pair:[qidA,qidB],delta,dimension}]
    narrative           TEXT,
    computed_by         INTEGER REFERENCES users(id), -- NULL = self/system, admin id on recompute
    computed_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fit_decisions_latest ON fit_decisions (user_id, role_context, computed_at);
CREATE INDEX IF NOT EXISTS idx_fit_decisions_review ON fit_decisions (outcome, computed_at);

-- Reviewer layer: per-question evidence ratings, outcome overrides, and
-- follow-up markers. Upsertable per (decision, reviewer); review history is
-- preserved because decisions themselves are append-only.
CREATE TABLE IF NOT EXISTS fit_reviews (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id           INTEGER NOT NULL REFERENCES fit_decisions(id) ON DELETE CASCADE,
    subject_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id           INTEGER NOT NULL REFERENCES users(id),
    evidence_ratings_json TEXT,        -- {question_id: 0..3} (0 none … 3 strong verified)
    override_outcome      TEXT,        -- NULL = no override; else one of the 6 outcomes
    override_reason       TEXT,
    requires_followup     INTEGER NOT NULL DEFAULT 0,
    followup_json         TEXT,        -- [{topic, note}]
    notes                 TEXT,
    status                TEXT NOT NULL DEFAULT 'open',  -- open|resolved
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (decision_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_fit_reviews_subject ON fit_reviews (subject_user_id, created_at);

-- The 10 Fit v2 priority skills as rows in the existing taxonomy catalog
-- (089/090). display_order 901+ keeps them clear of the v1 per-category
-- representative-skill resolution (lowest display_order wins there), so the
-- v1 skill_axis write path is untouched. Category mapping follows the 089
-- absorption notes (capital_network absorbs Fundraising + Recruiting, etc.).
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('fitv2_fundraising_narrative', 'capital_network', 'Fundraising & Capital Narrative', 'Constructing and delivering a fundable capital story.', 901),
  ('fitv2_market_research',       'product',         'Market Research',                 'Structured sizing, segmentation, and competitive mapping.', 902),
  ('fitv2_analytical_judgment',   'finance_ops',     'Analytical Judgment',             'Reasoning under uncertainty with numbers and evidence.', 903),
  ('fitv2_product_thinking',      'product',         'Product Thinking',                'Problem selection, scoping, and iteration judgment.', 904),
  ('fitv2_sales_relationships',   'gtm_sales',       'Sales & Relationship Building',   'Opening, advancing, and closing high-trust relationships.', 905),
  ('fitv2_hiring',                'capital_network', 'Hiring',                          'Attracting, assessing, and closing talent.', 906),
  ('fitv2_execution_management',  'finance_ops',     'Execution Management',            'Turning plans into shipped outcomes on a cadence.', 907),
  ('fitv2_communication',         'marketing_brand', 'Communication',                   'Clear written and spoken communication under pressure.', 908),
  ('fitv2_diligence',             'finance_ops',     'Diligence',                       'Verifying claims: references, data rooms, primary checks.', 909),
  ('fitv2_strategic_synthesis',   'product',         'Strategic Synthesis',             'Integrating signals into a coherent, decision-ready view.', 910);
