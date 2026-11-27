-- Build queue #129 — Round Manager: closes/tranches and pro-rata rights.
--
-- A round rarely lands as one wire. This adds the two things the raise
-- pipeline (migrations 128 + 145) could not express:
--
--   1. raise_closes — tranches of a round. Each close has its own
--      target/actual date, its own state, and its own subtotal. The
--      existing `uq_raise_rounds_active` partial index (145:33) keeps
--      ONE active round per project, which stays true: tranches hang
--      off that single round rather than becoming extra round rows.
--
--   2. raise_pro_rata — existing holders' rights in the new round.
--      Entitlement is computed (services/roundMath.ts), never stored,
--      so it can never drift from the round size; what IS stored is the
--      holder's prior stake and what they decided to do about it.
--
-- Allocations deliberately do NOT get a new table. A prospect who
-- commits IS the allocation, so `raise_prospects` gains close_id,
-- commit_status, and instrument instead. One entity, no dual-write, no
-- reconciliation job between a "prospect" and an "allocation" row.

CREATE TABLE IF NOT EXISTS raise_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  name TEXT NOT NULL,                       -- 'First close', 'Second close', 'Final close'
  sequence INTEGER NOT NULL DEFAULT 0,      -- display order
  state TEXT NOT NULL DEFAULT 'planned',    -- planned | open | closed
  target_date TEXT,                         -- YYYY-MM-DD, intended wire date
  closed_date TEXT,                         -- YYYY-MM-DD, actual
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_raise_closes_round ON raise_closes(round_id, sequence);
CREATE INDEX IF NOT EXISTS idx_raise_closes_project ON raise_closes(project_id);

CREATE TABLE IF NOT EXISTS raise_pro_rata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  holder_name TEXT NOT NULL,
  holder_email TEXT,
  -- Fully-diluted ownership BEFORE this round, as a percent. Seeded
  -- from cap_table_holders where available; editable, because a cap
  -- table snapshot is often staler than the founder's own knowledge.
  prior_stake_pct REAL NOT NULL DEFAULT 0,
  -- What the holder said they would take. NULL = has not answered.
  taking_amount REAL,
  state TEXT NOT NULL DEFAULT 'offered',    -- offered | taking | waived | expired
  offered_at TEXT,
  responded_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_raise_pro_rata_round ON raise_pro_rata(round_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_pro_rata_holder
  ON raise_pro_rata(round_id, holder_email) WHERE holder_email IS NOT NULL;

-- Round-level inputs the pro-rata and dilution math needs. Both
-- nullable: a founder who has not set them gets the 'raw' entitlement
-- rule and no post-round stake, never a fabricated default.
ALTER TABLE raise_rounds ADD COLUMN pro_rata_reserved REAL;
ALTER TABLE raise_rounds ADD COLUMN pre_money REAL;

-- Allocation fields on the existing prospect row.
--
-- commit_status is NULL for anything not yet committed. For a prospect
-- already at stage='committed' when this migration lands, the read path
-- treats NULL as 'signed' — which makes the new `committed` total
-- (wired + signed) exactly equal the old `raised` figure
-- (SUM(amount) WHERE stage='committed'). Existing numbers do not move
-- on deploy; founders refine each row to wired/soft afterwards.
ALTER TABLE raise_prospects ADD COLUMN close_id INTEGER;
ALTER TABLE raise_prospects ADD COLUMN commit_status TEXT;
ALTER TABLE raise_prospects ADD COLUMN instrument TEXT;   -- safe | note | equity

CREATE INDEX IF NOT EXISTS idx_raise_prospects_close ON raise_prospects(close_id);
