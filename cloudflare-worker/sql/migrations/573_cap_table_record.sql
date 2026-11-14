-- 573 — the cap table's record: issuances, share classes and a currency per
-- venture (D1017, #2854, part 2 of #2432). Numbered by D1015 §6.
--
-- On `main` before this, nothing recorded what was issued: every reader took
-- the canonical row of `cap_table_scenarios`, which is a model (CAP_TABLE_MAP
-- §3). These tables are the record: what exists, with a date, a source and a
-- document. A scenario models it; it never writes it.
--
-- cap_table_share_classes  one row per class of a venture.
--   kind                   common, preferred or option_pool (an option pool is
--                          a class whose `authorized_shares` is its size).
--   authorized_shares      NULL is "Not recorded", never 0.
--   price_per_share_micros the class's issue price in millionths of the
--                          venture's currency unit; NULL is "Not recorded".
--   liquidation_multiple_bps  10000 is 1×.
--   participating          0 (non-participating) unless stated.
--   conversion_ratio       into common; 1 unless stated.
--
-- cap_table_issuances      one row per issuance, per venture.
--   kind                   founding, priced, safe, note, grant, exercise,
--                          transfer, conversion, cancellation or correction.
--   holder_id | holder_name  a `cap_table_holders` row, or a name.
--   class_id               the class the shares land in (a grant's is a pool;
--                          an exercise's `from_class_id` is the pool it draws).
--   from_holder_*          a transfer's giver.
--   related_issuance_id    what a conversion converts, a cancellation cancels
--                          or a correction corrects.
--   shares                 whole shares; a correction's may be negative.
--   amount_cents           money in the smallest unit of `currency`.
--   terms                  cap_cents, discount_bps, basis, mfn, interest_bps,
--                          maturity_on; each NULL is "Not recorded".
--   safe_issuance_uid      a SAFE sent through StudioOS: its terms are read
--                          from `safe_issuances`, never copied here.
--   document_ref           'legal_documents:<id>' or 'data_room_files:<id>'.
--   source                 connector_carta, connector_mercury, signed,
--                          document or typed.
--   status                 proposed (changes nothing until a person accepts
--                          it), recorded, void (kept, struck through, with
--                          `void_reason`) or dismissed.
--   origin, origin_ref     who proposed it (owner, cofounder, admin, mercury,
--                          import, close) and the source's own key, so one
--                          source item is proposed once.
--   correction_reason      an admin's reason, which the founder reads.
--
-- cap_table_currency       a venture's ISO 4217 code. No row is the default,
--                          USD: no company or project stores a currency
--                          (owner question 8 read as A, D1015 §5).
--
-- Grep first (D689 D-t): none of the three tables exists in an earlier
-- migration or in schema_baseline.sql.
CREATE TABLE IF NOT EXISTS cap_table_share_classes (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                       TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id                INTEGER NOT NULL REFERENCES projects(id),
  name                      TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind                      TEXT NOT NULL CHECK (kind IN ('common', 'preferred', 'option_pool')),
  authorized_shares         INTEGER CHECK (authorized_shares IS NULL OR authorized_shares >= 0),
  price_per_share_micros    INTEGER CHECK (price_per_share_micros IS NULL OR price_per_share_micros >= 0),
  liquidation_multiple_bps  INTEGER NOT NULL DEFAULT 10000 CHECK (liquidation_multiple_bps >= 0),
  participating             INTEGER NOT NULL DEFAULT 0 CHECK (participating IN (0, 1)),
  conversion_ratio          REAL NOT NULL DEFAULT 1 CHECK (conversion_ratio > 0),
  created_by                INTEGER REFERENCES users(id),
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_cap_table_share_classes_project ON cap_table_share_classes (project_id, id);

CREATE TABLE IF NOT EXISTS cap_table_issuances (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                    TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id             INTEGER NOT NULL REFERENCES projects(id),
  kind                   TEXT NOT NULL CHECK (kind IN ('founding', 'priced', 'safe', 'note', 'grant', 'exercise', 'transfer', 'conversion', 'cancellation', 'correction')),
  holder_id              INTEGER REFERENCES cap_table_holders(id),
  holder_name            TEXT,
  class_id               INTEGER REFERENCES cap_table_share_classes(id),
  from_holder_id         INTEGER REFERENCES cap_table_holders(id),
  from_holder_name       TEXT,
  from_class_id          INTEGER REFERENCES cap_table_share_classes(id),
  related_issuance_id    INTEGER REFERENCES cap_table_issuances(id),
  shares                 INTEGER,
  amount_cents           INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency               TEXT,
  price_per_share_micros INTEGER CHECK (price_per_share_micros IS NULL OR price_per_share_micros >= 0),
  issued_on              TEXT,
  cap_cents              INTEGER CHECK (cap_cents IS NULL OR cap_cents > 0),
  discount_bps           INTEGER CHECK (discount_bps IS NULL OR (discount_bps >= 0 AND discount_bps < 10000)),
  basis                  TEXT CHECK (basis IS NULL OR basis IN ('post_money', 'pre_money')),
  mfn                    INTEGER CHECK (mfn IS NULL OR mfn IN (0, 1)),
  interest_bps           INTEGER CHECK (interest_bps IS NULL OR interest_bps >= 0),
  maturity_on            TEXT,
  safe_issuance_uid      TEXT,
  document_ref           TEXT,
  source                 TEXT NOT NULL CHECK (source IN ('connector_carta', 'connector_mercury', 'signed', 'document', 'typed')),
  status                 TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'recorded', 'void', 'dismissed')),
  origin                 TEXT NOT NULL CHECK (origin IN ('owner', 'cofounder', 'admin', 'mercury', 'import', 'close')),
  origin_ref             TEXT,
  note                   TEXT,
  correction_reason      TEXT,
  void_reason            TEXT,
  dismiss_reason         TEXT,
  proposed_by            INTEGER REFERENCES users(id),
  recorded_by            INTEGER REFERENCES users(id),
  recorded_at            TEXT,
  voided_by              INTEGER REFERENCES users(id),
  voided_at              TEXT,
  dismissed_by           INTEGER REFERENCES users(id),
  dismissed_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (holder_id IS NOT NULL OR holder_name IS NOT NULL),
  CHECK (status != 'void' OR length(trim(COALESCE(void_reason, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_cap_table_issuances_project ON cap_table_issuances (project_id, status, id);
-- One live row per source item, and per SAFE sent through StudioOS.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cap_table_issuances_origin
  ON cap_table_issuances (project_id, origin, origin_ref)
  WHERE origin_ref IS NOT NULL AND status IN ('proposed', 'recorded');
CREATE UNIQUE INDEX IF NOT EXISTS uq_cap_table_issuances_safe
  ON cap_table_issuances (safe_issuance_uid)
  WHERE safe_issuance_uid IS NOT NULL AND status IN ('proposed', 'recorded');

CREATE TABLE IF NOT EXISTS cap_table_currency (
  project_id  INTEGER PRIMARY KEY REFERENCES projects(id),
  currency    TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  set_by      INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
