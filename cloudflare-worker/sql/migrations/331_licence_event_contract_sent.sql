-- 331 — `licence_events` admits contract_sent (D451, Session 16 item 2).
--
-- `POST /admin/licences/:uid/contract/:contractUid/send` records when HQ sends
-- a licence agreement through createAndSendEnvelope. Same rebuild pattern as
-- 266: SQLite cannot widen a CHECK in place.

CREATE TABLE IF NOT EXISTS licence_events_331 (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id   INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    event        TEXT NOT NULL
                 CHECK (event IN ('created', 'territory_changed', 'seats_changed',
                                  'terms_changed', 'activated', 'suspended',
                                  'reinstated', 'renewed', 'terminated',
                                  'contract_instantiated',
                                  'contract_sent')),
    detail_json  TEXT,
    note         TEXT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO licence_events_331 (id, licence_id, event, detail_json, note, actor_user_id, created_at)
    SELECT id, licence_id, event, detail_json, note, actor_user_id, created_at FROM licence_events;

DROP TABLE licence_events;

ALTER TABLE licence_events_331 RENAME TO licence_events;

CREATE INDEX IF NOT EXISTS idx_licence_events_licence ON licence_events(licence_id, created_at DESC);
