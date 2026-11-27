-- Signals — founder decision-engine schema (D1 / SQLite).
-- Migration 136. Applied automatically by scripts/migrate-d1.mjs (numeric order,
-- ledgered in schema_migrations). Additive + idempotent; seeds no rows.
--
-- This is a DECISION-SUPPORT engine over PUBLIC company data — NOT a trading
-- store. There is deliberately no OHLC / candlestick table here; only slow,
-- descriptive facts (who a company serves, how big, where, how mature) plus the
-- derived founder-actionable signals and their evidence trail.
--
-- Normalized entities (mirrors services/signals/types.ts):
--   signal_sources         → Source registry (swappable adapters)
--   signal_companies       → Company / Market profile
--   signals                → Signal card
--   signal_company_map     → Signal ⇄ Company (many-to-many, "related companies")
--   signal_evidence        → EvidenceItem
--   signal_ingest_runs     → background-refresh / ingestion job audit trail
--
-- Region / Niche / CustomerSegment / BuildOpportunity are modelled as
-- normalized columns / JSON on `signals` (see the column comments) rather than
-- separate lookup tables — they are low-cardinality controlled vocabularies
-- enforced in the service layer, so a lookup table would add joins without
-- adding integrity we don't already get from the TS enums.

-- ---------------------------------------------------------------------------
-- Source registry. One row per adapter. quality_weight (0..1) and
-- freshness_halflife_days feed the confidence score.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signal_sources (
    key                     TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    kind                    TEXT NOT NULL,   -- fundamentals|market_data|news|filing|registry|earnings|hiring
    tier                    TEXT NOT NULL DEFAULT 'free', -- free|free_tier|premium
    quality_weight          REAL NOT NULL DEFAULT 0.5,    -- 0..1 trust in accuracy
    freshness_halflife_days INTEGER NOT NULL DEFAULT 30,
    homepage                TEXT,
    enabled                 INTEGER NOT NULL DEFAULT 1,
    notes                   TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Normalized public-company profile (Company + Market).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signal_companies (
    symbol          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    exchange        TEXT,
    country         TEXT,
    region          TEXT,
    sector          TEXT,
    industry        TEXT,
    market_cap      REAL,            -- USD
    market_cap_band TEXT,            -- nano|micro|small|mid|large|mega
    employee_count  INTEGER,
    employee_band   TEXT,            -- 1-50|51-200|201-1k|1k-5k|5k-20k|20k+
    ceo             TEXT,
    description     TEXT,
    customer_type   TEXT,            -- smb|mid_market|enterprise|consumer|...
    maturity_stage  TEXT,            -- emerging|scaling|established|incumbent
    source_key      TEXT REFERENCES signal_sources(key),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signal_companies_sector ON signal_companies(sector);
CREATE INDEX IF NOT EXISTS idx_signal_companies_region ON signal_companies(region);
CREATE INDEX IF NOT EXISTS idx_signal_companies_cap_band ON signal_companies(market_cap_band);

-- ---------------------------------------------------------------------------
-- Signal cards.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signals (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,   -- one of SIGNAL_TYPES
    title               TEXT NOT NULL,
    thesis              TEXT NOT NULL,
    why_now             TEXT NOT NULL DEFAULT '',

    region              TEXT NOT NULL,
    country             TEXT NOT NULL,
    sector              TEXT NOT NULL,
    industry            TEXT,
    niche               TEXT NOT NULL,

    market_cap_band     TEXT NOT NULL,
    target_customers    TEXT NOT NULL DEFAULT '[]', -- JSON array of CustomerType
    maturity_stage      TEXT,

    founder_opportunity TEXT NOT NULL DEFAULT '',
    advisor_note        TEXT NOT NULL DEFAULT '',
    build_opportunity   TEXT NOT NULL DEFAULT '{}', -- JSON BuildOpportunity
    market_context      TEXT NOT NULL DEFAULT '{}', -- JSON MarketContext

    -- Persisted score HINTS. The ranking engine recomputes at read time; these
    -- are cached so a cold read (or an external analytics job) has a value.
    confidence_score    REAL NOT NULL DEFAULT 0,
    freshness_score     REAL NOT NULL DEFAULT 0,
    rank_score          REAL NOT NULL DEFAULT 0,

    tags                TEXT NOT NULL DEFAULT '[]', -- JSON array
    status              TEXT NOT NULL DEFAULT 'active', -- active|archived
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(type);
CREATE INDEX IF NOT EXISTS idx_signals_region ON signals(region);
CREATE INDEX IF NOT EXISTS idx_signals_sector ON signals(sector);
CREATE INDEX IF NOT EXISTS idx_signals_rank ON signals(rank_score DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);

-- Signal ⇄ Company (the "representative public companies" on a card).
CREATE TABLE IF NOT EXISTS signal_company_map (
    signal_id   TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL REFERENCES signal_companies(symbol),
    role        TEXT NOT NULL DEFAULT 'supporting', -- supporting|anchor|acquirer|target
    PRIMARY KEY (signal_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_signal_company_map_symbol ON signal_company_map(symbol);

-- Evidence trail.
CREATE TABLE IF NOT EXISTS signal_evidence (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    signal_id   TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,   -- EvidenceKind
    title       TEXT NOT NULL,
    detail      TEXT,
    source_key  TEXT NOT NULL REFERENCES signal_sources(key),
    url         TEXT,
    weight      REAL NOT NULL DEFAULT 0.5,
    observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signal_evidence_signal ON signal_evidence(signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_evidence_source ON signal_evidence(source_key);

-- Ingestion / background-refresh audit trail. One row per refresh run so the
-- UI can show "last updated" and ops can debug adapter failures.
CREATE TABLE IF NOT EXISTS signal_ingest_runs (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_key    TEXT REFERENCES signal_sources(key),
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at   TEXT,
    status        TEXT NOT NULL DEFAULT 'running', -- running|ok|error|skipped
    companies_seen INTEGER NOT NULL DEFAULT 0,
    signals_written INTEGER NOT NULL DEFAULT 0,
    error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_signal_ingest_runs_source ON signal_ingest_runs(source_key);
