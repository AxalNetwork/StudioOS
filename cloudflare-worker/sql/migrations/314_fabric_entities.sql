-- 314_fabric_entities.sql — the Funds · Fabric canvas's F1 store: what an
-- entity is in the fund fabric, and which entities a fund runs through
-- (D376, wave 8, Session 9).
--
-- `entities` (baseline) holds a name, a type from four (holding_company,
-- project, subsidiary, vc_fund), a parent, a jurisdiction and an
-- incorporation date. F1 draws more: whether an entity is a GP, a management
-- company or a fund vehicle; its registration number and registered agent;
-- its officers. And F6's jurisdiction column needs a fund to name the entity
-- it is, which no column did — `vc_funds.gp_entity` is a free-text name.
--
-- NO TENANT COLUMN. Which branch an entity belongs to is which database holds
-- it, exactly as D245 settled for funds: every branch runs its own D1, so a
-- tenant column would restate the database and could only disagree with it.
--
-- THE ROLE IS A NEW COLUMN, NOT A WIDER `entity_type`. `entity_type` carries
-- a CHECK that SQLite cannot alter without rebuilding the table, and its four
-- values answer a different question (what kind of company) from F1's (what
-- it does in a fund). Null until someone records it.
--
--   entities.fabric_role          TEXT  gp_entity | management_company |
--                                       fund_vehicle | holding | operating
--   entities.registration_number  TEXT  as the registry issued it
--   entities.registered_agent     TEXT  the agent's name, as filed
--   vc_funds.gp_entity_id         INTEGER → entities.id, the fund's GP
--   vc_funds.vehicle_entity_id    INTEGER → entities.id, the fund itself
--
-- OFFICERS ARE PEOPLE, SO THEY ARE THEIR OWN TABLE, read by staff only and
-- never carried by the unauthenticated `fundsRegistry` RPC. An appointment is
-- never deleted: it is ceased, with the date, so the record of who held the
-- office stays.
--
-- STANDS ALONE: additive ALTERs and one new table, depending on no other
-- wave-8 migration. No BEGIN/COMMIT. Apply through the ledger-driven runner:
--
--   npm run d1:migrate:remote

ALTER TABLE entities ADD COLUMN fabric_role TEXT
  CHECK (fabric_role IS NULL OR fabric_role IN ('gp_entity', 'management_company', 'fund_vehicle', 'holding', 'operating'));

ALTER TABLE entities ADD COLUMN registration_number TEXT;

ALTER TABLE entities ADD COLUMN registered_agent TEXT;

ALTER TABLE vc_funds ADD COLUMN gp_entity_id INTEGER REFERENCES entities(id);

ALTER TABLE vc_funds ADD COLUMN vehicle_entity_id INTEGER REFERENCES entities(id);

CREATE INDEX IF NOT EXISTS idx_vc_funds_gp_entity ON vc_funds(gp_entity_id);

CREATE INDEX IF NOT EXISTS idx_vc_funds_vehicle_entity ON vc_funds(vehicle_entity_id);

CREATE TABLE IF NOT EXISTS entity_officers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    uid             TEXT    NOT NULL UNIQUE,
    entity_id       INTEGER NOT NULL REFERENCES entities(id),
    name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    title           TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    appointed_on    TEXT,
    ceased_on       TEXT,
    recorded_by     INTEGER REFERENCES users(id),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_officers_entity ON entity_officers(entity_id, ceased_on);
