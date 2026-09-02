-- 200 — `service_offerings`: move production onto the shape the code reads.
--
-- WHAT IS BROKEN TODAY, confirmed by PRAGMA against production rather than
-- inferred. `service_offerings` in production is the `sql/t13_t14_t15.sql`
-- shape:
--
--     id, uid, partner_id NOT NULL, category NOT NULL, title NOT NULL,
--     description, price_min, price_max, is_active, created_at
--
-- Every query in `routes/services.ts` is written against the OTHER shape, the
-- one `sql/schema.sql` and `sql/migrations/034_unmounted_routes.sql` declare
-- byte-identically to each other:
--
--     id, uid, owner_user_id NOT NULL, title, category, summary, price_usd,
--     is_active, created_at, updated_at
--
-- All three files declare the table with `IF NOT EXISTS`, D1 keeps one table
-- per name, and t13 ran first. So the Partner **Offers** surface cannot work:
--
--   * `POST /api/services` (services.ts:115) names `owner_user_id`, `summary`,
--     `price_usd` and `updated_at` — none of which exist — and supplies no
--     `partner_id`, which is NOT NULL with no default. It fails twice over.
--   * `GET /api/services?mine=1` (services.ts:59) filters on `owner_user_id`.
--     No such column.
--   * `GET /api/services` (the marketplace arm) is the quiet one: the query
--     succeeds, and then `serialize()` (services.ts:34-45) reads four columns
--     that are not there, so every offering renders with a null title body,
--     summary and price. An empty catalogue, not an error.
--
-- `scripts/sqlite-table-collisions-baseline.json` predicted this in as many
-- words — "If the t13 file was applied first, that INSERT cannot succeed" — and
-- recorded that it could not be settled from the repository. It has now been
-- settled from the database, and this file acts on the answer.
--
-- WHY A REBUILD AND NOT FOUR `ADD COLUMN`s. Adding `owner_user_id`, `summary`,
-- `price_usd` and `updated_at` to the live table is smaller and was the first
-- thing tried on paper. It does not fix the write: `partner_id NOT NULL` stays,
-- the INSERT still omits it, and every POST still fails on the constraint.
-- Dropping a NOT NULL column is what needs the rebuild, so the rebuild is the
-- minimum that actually repairs the surface.
--
-- THIS FILE IS ONE-WAY, AND SAYS SO IN ITS FIRST STATEMENT. A database that
-- already holds the target shape — anything built from `sql/migrations/*` alone,
-- which is what the runner gives a fresh local or preview D1 — has no
-- `partner_id` to read. The preflight SELECT below therefore fails on exactly
-- those databases, before a single row is touched, and D1 rolls the whole file
-- back. That is the intended outcome, not an accident: the file is a repair of
-- one database's divergence, and on a database that never diverged it must do
-- nothing rather than something clever. Mark it applied there
-- (`node scripts/migrate-d1.mjs --local --baseline`) instead of executing it.
--
-- NOTHING IS DESTROYED. `id` is copied rather than regenerated, because
-- `service_engagements.offering_id` REFERENCES it (schema.sql:846). Rows whose
-- `partner_id` no user holds cannot enter a NOT NULL `owner_user_id` and are
-- copied to `service_offerings_orphans_pre200` rather than dropped — a rebuild
-- that silently loses rows is worse than the bug it fixes. The price range is
-- preserved in prose when the two bounds differ, because `price_usd` is one
-- number and `price_min`/`price_max` are two: collapsing them without saying so
-- would invent a price.
--
-- DROP-THEN-RENAME, not rename-then-drop. A modern SQLite `ALTER TABLE … RENAME
-- TO` REWRITES the `REFERENCES service_offerings(id)` clause in
-- `service_engagements` to follow the renamed table — so renaming the old table
-- out of the way would silently repoint the foreign key at the backup copy.
-- Dropping it and renaming the new table into the freed name leaves the
-- reference resolving to the right table by name. Same `PRAGMA foreign_keys`
-- bracket that migration 039 uses for its rebuilds.

-- Preflight. Reads nothing, writes nothing, and fails the whole file on a
-- database that is already in the target shape. Keep it first.
SELECT partner_id FROM service_offerings WHERE 0;

PRAGMA foreign_keys=OFF;

BEGIN;

-- 1. Orphans first, while the source table is still intact. A partner_id that
--    no user account holds has no `users(id)` to become, and `owner_user_id` is
--    NOT NULL in the target. These rows are parked, with everything they had,
--    for a human to reconcile or discard deliberately.
CREATE TABLE IF NOT EXISTS service_offerings_orphans_pre200 (
    id INTEGER,
    uid TEXT,
    partner_id INTEGER,
    category TEXT,
    title TEXT,
    description TEXT,
    -- Integer minor units, not the REAL dollars the source column held. A new
    -- table follows the repo's money rule even when it is archiving rows that
    -- did not: `check-money-cents` would otherwise be asked to accept two more
    -- float money columns, and cents are the more faithful record anyway — a
    -- REAL is what made the original imprecise.
    price_min_cents INTEGER,
    price_max_cents INTEGER,
    is_active INTEGER,
    created_at TEXT,
    company_id INTEGER,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO service_offerings_orphans_pre200
       (id, uid, partner_id, category, title, description, price_min_cents, price_max_cents, is_active, created_at, company_id)
SELECT o.id, o.uid, o.partner_id, o.category, o.title, o.description,
       CAST(ROUND(o.price_min * 100) AS INTEGER), CAST(ROUND(o.price_max * 100) AS INTEGER),
       o.is_active, o.created_at, o.company_id
  FROM service_offerings o
  LEFT JOIN users u ON u.partner_id = o.partner_id
 WHERE u.id IS NULL;

-- 2. The target shape, verbatim from schema.sql, plus the `company_id` that
--    migration 196 added to the old table — it must survive the rebuild.
CREATE TABLE service_offerings_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    summary TEXT,
    price_usd REAL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    company_id INTEGER
);

-- 3. Copy every row whose owner resolves, bridging partners(id) -> users.
--    MIN(u.id) keeps the copy deterministic if two accounts somehow share a
--    partner_id; the join is one-to-one in practice.
INSERT INTO service_offerings_new
       (id, uid, owner_user_id, title, category, summary, price_usd, is_active, created_at, updated_at, company_id)
SELECT o.id,
       o.uid,
       (SELECT MIN(u.id) FROM users u WHERE u.partner_id = o.partner_id),
       o.title,
       o.category,
       -- `summary` takes the old `description`. When the offering carried a
       -- RANGE, the range is appended in words rather than thrown away: the
       -- target holds one price, and silently keeping the lower bound would
       -- turn "5000 to 15000" into "5000" with nothing recording that it ever
       -- had a ceiling.
       CASE
         WHEN o.price_min IS NOT NULL AND o.price_max IS NOT NULL AND o.price_max <> o.price_min
           THEN TRIM(COALESCE(o.description, '')
                || ' (Indicative range: ' || CAST(o.price_min AS TEXT)
                || '-' || CAST(o.price_max AS TEXT) || '.)')
         ELSE o.description
       END,
       COALESCE(o.price_min, o.price_max),
       o.is_active,
       o.created_at,
       -- The old shape had no `updated_at`. Seeding it from creation is the
       -- honest value; `datetime('now')` would assert every offering was edited
       -- the moment this migration ran.
       o.created_at,
       o.company_id
  FROM service_offerings o
 WHERE EXISTS (SELECT 1 FROM users u WHERE u.partner_id = o.partner_id);

DROP TABLE service_offerings;
ALTER TABLE service_offerings_new RENAME TO service_offerings;

-- 4. Indexes. 196's `idx_offerings_company` died with the dropped table; the
--    owner index is what `?mine=1` filters on and the old shape never had one.
CREATE INDEX IF NOT EXISTS idx_offerings_company ON service_offerings(owner_user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_offerings_active ON service_offerings(is_active);

COMMIT;

PRAGMA foreign_keys=ON;
