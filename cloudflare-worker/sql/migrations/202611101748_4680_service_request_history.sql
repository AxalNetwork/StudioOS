-- Preserve catalogue request history and snapshot new quotes (#4680).
CREATE TABLE service_engagements_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    offering_id INTEGER NOT NULL REFERENCES service_offerings(id) ON DELETE RESTRICT,
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    quoted_price_cents INTEGER,
    quoted_currency TEXT
);
INSERT INTO service_engagements_history
    (id, uid, offering_id, requester_user_id, owner_user_id, note, status, created_at, updated_at)
SELECT id, uid, offering_id, requester_user_id, owner_user_id, note, status, created_at, updated_at
FROM service_engagements;
DROP TABLE service_engagements;
ALTER TABLE service_engagements_history RENAME TO service_engagements;
CREATE INDEX idx_service_engagements_owner ON service_engagements(owner_user_id, created_at DESC);
CREATE INDEX idx_service_engagements_requester ON service_engagements(requester_user_id, created_at DESC);
CREATE INDEX idx_service_engagements_offering ON service_engagements(offering_id);
