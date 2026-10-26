-- 618 — an investor firm's own deal flow (D1238, #3251; part 2 of #2423).
-- Given by S1 on #3251, 2026-10-25.
--
-- Today one round status per deal (`deals.status`) is moved by studio staff
-- only, so every investor sees the same stage and an investor's "pass" could
-- only ever be the round's. #2423's owner question 1 (recommended answer):
-- each investor firm keeps its own stage per deal, the round's status shows
-- beside it, and an investor's pass is theirs alone.
--
-- `scope_key` is whose flow a row belongs to: 'c:<company_id>' for a firm
-- (every seat linked to the company reads and moves the same rows), or
-- 'u:<investor_user_id>' for an investor with no firm selected. Nothing here
-- writes `deals.status`, and nothing here grants a deal read: the door to a
-- deal stays DEAL's rule (invited or committed, `deals.ts` canReadDeal).
--
-- Grep first (D689 D-t): no `deal_flow_*` table exists in an earlier
-- migration or in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS deal_flow_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT    NOT NULL UNIQUE,
  scope_key         TEXT    NOT NULL CHECK (scope_key GLOB 'c:[0-9]*' OR scope_key GLOB 'u:[0-9]*'),
  company_id        INTEGER,
  investor_user_id  INTEGER NOT NULL,
  deal_id           INTEGER NOT NULL,
  stage             TEXT    NOT NULL DEFAULT 'sourcing'
                    CHECK (stage IN ('sourcing', 'screening', 'diligence', 'commit', 'closing', 'passed')),
  owner_user_id     INTEGER,
  entered_via       TEXT    NOT NULL
                    CHECK (entered_via IN ('invited', 'requested', 'committed', 'added', 'thesis', 'introduction', 'syndicate', 'watchlist')),
  entered_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  stage_changed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  -- The same five reasons as the studio's pass (services/dealPassTaxonomy.ts).
  pass_reason       TEXT    CHECK (pass_reason IS NULL OR pass_reason IN ('early', 'valuation', 'thesis', 'team', 'competitive')),
  passed_at         TEXT,
  revisit           TEXT    CHECK (revisit IS NULL OR revisit IN ('next_round', 'date')),
  revisit_at        TEXT,
  note              TEXT    CHECK (note IS NULL OR length(note) <= 2000),
  CHECK (stage <> 'passed' OR (pass_reason IS NOT NULL AND passed_at IS NOT NULL)),
  CHECK (revisit IS NOT 'date' OR revisit_at IS NOT NULL),
  UNIQUE (scope_key, deal_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_flow_entries_scope ON deal_flow_entries (scope_key, stage);
CREATE INDEX IF NOT EXISTS idx_deal_flow_entries_deal ON deal_flow_entries (deal_id);

-- What happened to each row, newest last. No note's text is kept here.
CREATE TABLE IF NOT EXISTS deal_flow_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id       INTEGER NOT NULL,
  scope_key      TEXT    NOT NULL,
  deal_id        INTEGER NOT NULL,
  actor_user_id  INTEGER NOT NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('entered', 'moved', 'owner', 'passed', 'note')),
  from_stage     TEXT,
  to_stage       TEXT,
  pass_reason    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deal_flow_events_entry ON deal_flow_events (entry_id, id);

-- "Not for me" on New for you: the item stays hidden for this flow.
CREATE TABLE IF NOT EXISTS deal_flow_dismissals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key     TEXT    NOT NULL,
  item_key      TEXT    NOT NULL CHECK (length(item_key) BETWEEN 3 AND 80),
  reason        TEXT    CHECK (reason IS NULL OR length(reason) <= 500),
  dismissed_by  INTEGER NOT NULL,
  dismissed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scope_key, item_key)
);
