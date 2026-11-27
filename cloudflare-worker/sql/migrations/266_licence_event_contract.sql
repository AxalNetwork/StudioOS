-- 266 — `licence_events` admits the event the code already writes.
--
-- THE DEFECT, stated rather than quietly patched. `routes/admin_licences.ts`
-- writes `logEvent(… 'contract_instantiated' …)` when HQ instantiates a licence
-- agreement from the master template. Migration 187 built `licence_events` with
-- a CHECK admitting nine values, and that is not one of them — 187 was written
-- before licence contracts existed (they arrived in 259), so the vocabulary is
-- simply out of date.
--
-- WHY IT MATTERS MORE THAN A MISSING AUDIT ROW. `logEvent` is a bare `await`
-- with no try/catch, and it sits AFTER the contract INSERT and BEFORE the 201.
-- So on a database that enforces the CHECK the order is: supersede the previous
-- contract, write the new one, raise, and answer 400. The operator is told the
-- request failed about a contract that was created — and pressing the button
-- again supersedes that one and writes another, stacking a superseded draft per
-- attempt.
--
-- IT HAS NEVER FIRED. Production holds zero `territory_licences`, zero
-- `licence_contracts` and zero `licence_events`: no licence has ever been
-- issued, so no contract has ever been instantiated. This is latent, not live,
-- and the PR that carries it says so. What the emptiness changes is the COST:
-- the copy below moves nothing today and would move a real audit trail later.
-- Migration 257 already wrote that argument one table over — the rule holds
-- "even when the table it corrects is empty in every database that exists,
-- because the rule is what makes that emptiness something we can stop having to
-- check."
--
-- WHY A REBUILD RATHER THAN AN ADD COLUMN. SQLite cannot ALTER a CHECK
-- constraint. The only supported way to widen one is the documented table
-- rebuild: create the table anew with the corrected constraint, copy, drop,
-- rename. That is a departure from this repo's additive-only habit and it is
-- stated here rather than discovered: the table is append-only, carries no
-- foreign keys pointing AT it, and its one index is recreated below.
--
-- WHY NOT DROP THE CHECK. It is the thing that would have caught this, and
-- `licence_contract_instantiate.test.ts` shows what its absence costs: that
-- fixture recreated `licence_events` WITHOUT the CHECK and then asserted the
-- row, so the suite went green against a table production does not have. The
-- constraint is right; the list was short.
--
-- WHY NOT RENAME THE EVENT to one of the nine. `terms_changed` and `activated`
-- are smaller acts than instantiating the agreement, and the trail is what the
-- table exists for. The constraint is wrong, not the write.
--
-- D1 REJECTS BEGIN/COMMIT (the #26 lesson), so there is no transaction here.
-- Each statement stands alone and the order is the one SQLite documents.

CREATE TABLE IF NOT EXISTS licence_events_266 (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id   INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    event        TEXT NOT NULL
                 CHECK (event IN ('created', 'territory_changed', 'seats_changed',
                                  'terms_changed', 'activated', 'suspended',
                                  'reinstated', 'renewed', 'terminated',
                                  -- 266: the agreement instantiated from the
                                  -- master template at a named version.
                                  'contract_instantiated')),
    -- JSON: whatever the event changed, before and after.
    detail_json  TEXT,
    note         TEXT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Columns named rather than `SELECT *`, so a future column added to one side
-- and not the other fails loudly here instead of shifting values silently.
INSERT INTO licence_events_266 (id, licence_id, event, detail_json, note, actor_user_id, created_at)
    SELECT id, licence_id, event, detail_json, note, actor_user_id, created_at FROM licence_events;

DROP TABLE licence_events;

ALTER TABLE licence_events_266 RENAME TO licence_events;

-- 187's index, recreated by name on the rebuilt table.
CREATE INDEX IF NOT EXISTS idx_licence_events_licence
    ON licence_events(licence_id, created_at);
