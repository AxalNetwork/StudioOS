-- 486 — AI credits: the token-pack store and the append-only top-up ledger (D755, #1905).
--
-- WHAT IT ADDS.
--   * `ai_token_packs`: the list of token packs a member can buy. A pack is a
--     one-time USD Stripe price credited at face value, plus an optional bonus
--     of at most 10%. The list lives here, never in Stripe metadata: any Admin
--     can edit metadata, and a metadata marker would let them mint AI balance
--     (D755 §3). The label ("$25 of tokens") is derived from `face_cents` and
--     never stored.
--   * `ai_credit_ledger`: one row for every movement of the AI top-up balance
--     (`ai_topup_accounts.balance_microusd`, 419). For every user,
--     SUM(delta_microusd) equals that balance; the tests assert it and CR2's
--     reconcile read lists anyone for whom it fails. `UNIQUE(kind, source_ref)`
--     is the idempotency key. UPDATE and DELETE abort.
--   * Triggers on `ai_budget_reservations` that write the hold, the release and
--     the spend, so the reserve, settle and review code in services/aiBudget.ts
--     stays as it is. Only its legacy `draw` INSERT goes (D755 §7).
--   * Four columns on `ai_topup_purchases`: the pack, its bonus at purchase
--     time, what refunds and disputes have taken back, and the dispute state.
--
-- THREE BALANCES, NEVER MIXED (D755 §1). This file touches neither the perk
-- nor the introduction ledger, and nothing here converts between them.
--
-- UNITS. Every amount is integer micro-USD ($1 = 1,000,000), as 419 (D629),
-- except `face_cents`, which is Stripe's integer cents.
--
-- WHY 419 IS NOT EDITED. Migration 419 is immutable
-- (scripts/migration-immutability-gate.mjs). `ai_topup_ledger` stays: the
-- Worker stops writing it with D755's second PR, and a later cleanup removes
-- it. Its balance CHECK (at least 0) stays too.
--
-- THE OLD WORKER. The predeploy hook applies migrations before the new Worker
-- ships (CLAUDE.md fact 1), so for a moment the old Worker runs against this
-- schema. It still writes `ai_topup_ledger`:
--   * a `credit` row is mirrored here as a `purchase` by the trigger below;
--   * a `draw` row is NOT mirrored. The reservation trigger already writes that
--     run's `spend` when the reservation settles, and mirroring the draw as well
--     would count it twice.
-- The triggers are created before the backfill, so a row the old Worker writes
-- while this file runs is either written by a trigger or copied by the
-- backfill, and `INSERT OR IGNORE` on `UNIQUE(kind, source_ref)` keeps one.
--
-- NO INVARIANT TRIGGER. The ledger-equals-balance rule is checked by the tests
-- and by the reconcile read, not by a trigger on every balance write.
--
-- Grepped first: no `ai_token_packs` or `ai_credit_ledger` table, and none of
-- the four `ai_topup_purchases` columns, exists in schema_baseline.sql or an
-- earlier migration. Seeds no pack.
--
-- RE-RUNNING. Every statement but the four ALTERs is idempotent (IF NOT EXISTS,
-- INSERT OR IGNORE). SQLite's ADD COLUMN is not re-runnable; the runner applies
-- this file once.

CREATE TABLE IF NOT EXISTS ai_token_packs (
  uid             TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  price_id        TEXT NOT NULL UNIQUE CHECK (price_id LIKE 'price_%'),
  product_id      TEXT NOT NULL,
  face_cents      INTEGER NOT NULL CHECK (typeof(face_cents) = 'integer' AND face_cents BETWEEN 500 AND 50000),
  bonus_microusd  INTEGER NOT NULL DEFAULT 0 CHECK (typeof(bonus_microusd) = 'integer' AND bonus_microusd BETWEEN 0 AND face_cents * 1000),
  on_sale         INTEGER NOT NULL DEFAULT 0 CHECK (on_sale IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0 CHECK (typeof(sort) = 'integer'),
  origin          TEXT NOT NULL CHECK (origin IN ('created', 'adopted')),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT,
  -- An archived pack is never on sale.
  CHECK (archived_at IS NULL OR on_sale = 0)
);

CREATE TABLE IF NOT EXISTS ai_credit_ledger (
  uid                 TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  user_id             INTEGER NOT NULL REFERENCES users(id),
  kind                TEXT NOT NULL CHECK (kind IN ('purchase', 'bonus', 'hold', 'release', 'spend', 'refund', 'dispute', 'dispute_won', 'adjustment')),
  delta_microusd      INTEGER NOT NULL CHECK (typeof(delta_microusd) = 'integer' AND delta_microusd BETWEEN -9007199254740991 AND 9007199254740991),
  -- pi:<payment intent> | res:<reservation> | rf:<charge>:<amount refunded> | dp:<dispute> | dw:<dispute> | adj:<idempotency key>
  source_ref          TEXT NOT NULL CHECK (length(source_ref) > 0),
  payment_intent_id   TEXT,
  reservation_uid     TEXT,
  pack_uid            TEXT REFERENCES ai_token_packs(uid),
  -- What a negative movement could not take because the balance never goes below zero.
  shortfall_microusd  INTEGER NOT NULL DEFAULT 0 CHECK (typeof(shortfall_microusd) = 'integer' AND shortfall_microusd BETWEEN 0 AND 9007199254740991),
  actor               TEXT NOT NULL,
  reason              TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, source_ref),
  -- The sign of each kind.
  CHECK (
    (kind IN ('purchase', 'bonus', 'release', 'dispute_won') AND delta_microusd > 0)
    OR (kind IN ('hold', 'spend') AND delta_microusd < 0)
    OR (kind IN ('refund', 'dispute') AND (delta_microusd < 0 OR (delta_microusd = 0 AND shortfall_microusd > 0)))
    OR (kind = 'adjustment' AND delta_microusd <> 0 AND reason IS NOT NULL AND length(trim(reason)) >= 10)
  )
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_user ON ai_credit_ledger(user_id, created_at, uid);

CREATE TRIGGER IF NOT EXISTS ai_credit_ledger_no_update
BEFORE UPDATE ON ai_credit_ledger
BEGIN
  SELECT RAISE(ABORT, 'ai_credit_ledger is append-only (D755).');
END;

CREATE TRIGGER IF NOT EXISTS ai_credit_ledger_no_delete
BEFORE DELETE ON ai_credit_ledger
BEGIN
  SELECT RAISE(ABORT, 'ai_credit_ledger is append-only (D755).');
END;

-- A run reserved with part of the top-up balance holds that part.
CREATE TRIGGER IF NOT EXISTS ai_credit_ledger_reservation_hold
AFTER INSERT ON ai_budget_reservations
WHEN NEW.topup_microusd > 0
BEGIN
  INSERT OR IGNORE INTO ai_credit_ledger(user_id, kind, delta_microusd, source_ref, reservation_uid, actor)
  VALUES (NEW.user_id, 'hold', -NEW.topup_microusd, 'res:' || NEW.uid, NEW.uid, CAST(NEW.user_id AS TEXT));
END;

-- Settling or refunding releases the whole hold, and a settled run then spends
-- what it cost the top-up balance. Moving between pending and review writes nothing.
CREATE TRIGGER IF NOT EXISTS ai_credit_ledger_reservation_settle
AFTER UPDATE OF status ON ai_budget_reservations
WHEN OLD.status IN ('pending', 'review') AND NEW.status IN ('settled', 'refunded') AND OLD.topup_microusd > 0
BEGIN
  INSERT OR IGNORE INTO ai_credit_ledger(user_id, kind, delta_microusd, source_ref, reservation_uid, actor)
  VALUES (NEW.user_id, 'release', OLD.topup_microusd, 'res:' || NEW.uid, NEW.uid, CAST(NEW.user_id AS TEXT));
  INSERT OR IGNORE INTO ai_credit_ledger(user_id, kind, delta_microusd, source_ref, reservation_uid, actor)
  SELECT NEW.user_id, 'spend', -NEW.actual_topup_microusd, 'res:' || NEW.uid, NEW.uid, CAST(NEW.user_id AS TEXT)
  WHERE NEW.actual_topup_microusd > 0;
END;

-- The old Worker's credit, mirrored as a purchase. Its draw is not mirrored:
-- the settle trigger above already writes that spend (see the header).
CREATE TRIGGER IF NOT EXISTS ai_credit_ledger_mirror_topup_credit
AFTER INSERT ON ai_topup_ledger
WHEN NEW.kind = 'credit'
BEGIN
  INSERT OR IGNORE INTO ai_credit_ledger(uid, user_id, kind, delta_microusd, source_ref, payment_intent_id, actor, created_at)
  VALUES (NEW.uid, NEW.user_id, 'purchase', NEW.amount_microusd, 'pi:' || NEW.payment_intent_id, NEW.payment_intent_id, NEW.actor, NEW.created_at);
END;

-- The backfill. Each row keeps its original created_at.
INSERT OR IGNORE INTO ai_credit_ledger(uid, user_id, kind, delta_microusd, source_ref, payment_intent_id, actor, created_at)
SELECT uid, user_id, 'purchase', amount_microusd, 'pi:' || payment_intent_id, payment_intent_id, actor, created_at
FROM ai_topup_ledger WHERE kind = 'credit';

INSERT OR IGNORE INTO ai_credit_ledger(uid, user_id, kind, delta_microusd, source_ref, reservation_uid, actor, created_at)
SELECT uid, user_id, 'spend', -amount_microusd, 'res:' || reservation_uid, reservation_uid, actor, created_at
FROM ai_topup_ledger WHERE kind = 'draw';

INSERT OR IGNORE INTO ai_credit_ledger(user_id, kind, delta_microusd, source_ref, reservation_uid, actor, created_at)
SELECT user_id, 'hold', -topup_microusd, 'res:' || uid, uid, CAST(user_id AS TEXT), created_at
FROM ai_budget_reservations WHERE status IN ('pending', 'review') AND topup_microusd > 0;

ALTER TABLE ai_topup_purchases ADD COLUMN pack_uid TEXT REFERENCES ai_token_packs(uid);
ALTER TABLE ai_topup_purchases ADD COLUMN bonus_microusd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(bonus_microusd) = 'integer' AND bonus_microusd BETWEEN 0 AND 9007199254740991);
ALTER TABLE ai_topup_purchases ADD COLUMN reversed_microusd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reversed_microusd) = 'integer' AND reversed_microusd BETWEEN 0 AND 9007199254740991);
ALTER TABLE ai_topup_purchases ADD COLUMN dispute_state TEXT CHECK (dispute_state IS NULL OR dispute_state IN ('open', 'won', 'lost'));
