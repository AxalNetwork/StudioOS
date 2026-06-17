/**
 * Task #39 — Event engine: lazy schema bootstrap.
 *
 * Shape-only mirror of sql/migrations/109_events_core.sql so dev/preview D1
 * (which never runs `wrangler d1 execute`) still serves the event routes. Every
 * statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` —
 * additive, idempotent, and NEVER seeds a row. Each route handler calls
 * `ensureEventsSchema(env)` before touching the tables (the same lazy-bootstrap
 * pattern used by services/notify.ts and the telegram/news schemas).
 */
import type { Env } from '../types';

let _ready = false;

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS events (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     slug               TEXT NOT NULL UNIQUE,
     host_user_id       INTEGER REFERENCES users(id),
     project_id         INTEGER REFERENCES projects(id),
     type               TEXT NOT NULL DEFAULT 'meetup',
     title              TEXT NOT NULL,
     summary            TEXT,
     description        TEXT,
     cover_url          TEXT,
     starts_at          TEXT NOT NULL,
     ends_at            TEXT,
     timezone           TEXT NOT NULL DEFAULT 'UTC',
     location_kind      TEXT NOT NULL DEFAULT 'virtual',
     location_text      TEXT,
     location_url       TEXT,
     capacity           INTEGER,
     waitlist_enabled   INTEGER NOT NULL DEFAULT 1,
     approval_required  INTEGER NOT NULL DEFAULT 0,
     visibility         TEXT NOT NULL DEFAULT 'private',
     status             TEXT NOT NULL DEFAULT 'draft',
     admin_published    INTEGER NOT NULL DEFAULT 0,
     featured           INTEGER NOT NULL DEFAULT 0,
     audience_rules_json TEXT NOT NULL DEFAULT '{}',
     price_cents        INTEGER NOT NULL DEFAULT 0,
     currency           TEXT NOT NULL DEFAULT 'usd',
     created_at         TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_events_public_feed
     ON events (visibility, status, admin_published, starts_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_host
     ON events (host_user_id, starts_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_status
     ON events (status, starts_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_starts
     ON events (starts_at)`,
  `CREATE TABLE IF NOT EXISTS event_invitations (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id         INTEGER NOT NULL REFERENCES events(id),
     token            TEXT NOT NULL UNIQUE,
     invited_user_id  INTEGER REFERENCES users(id),
     invited_email    TEXT,
     invited_name     TEXT,
     source           TEXT NOT NULL DEFAULT 'manual',
     comp             INTEGER NOT NULL DEFAULT 0,
     status           TEXT NOT NULL DEFAULT 'pending',
     personal_message TEXT,
     invited_by       INTEGER REFERENCES users(id),
     created_at       TEXT NOT NULL DEFAULT (datetime('now')),
     responded_at     TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_event_invitations_event
     ON event_invitations (event_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_event_invitations_user
     ON event_invitations (invited_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_invitations_email
     ON event_invitations (invited_email)`,
  `CREATE TABLE IF NOT EXISTS event_registrations (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id          INTEGER NOT NULL REFERENCES events(id),
     user_id           INTEGER REFERENCES users(id),
     email             TEXT,
     name              TEXT,
     status            TEXT NOT NULL DEFAULT 'registered',
     source            TEXT NOT NULL DEFAULT 'self',
     comp              INTEGER NOT NULL DEFAULT 0,
     invitation_id     INTEGER REFERENCES event_invitations(id),
     waitlist_position INTEGER,
     payment_status    TEXT NOT NULL DEFAULT 'none',
     payment_intent_id TEXT,
     amount_cents      INTEGER NOT NULL DEFAULT 0,
     answers_json      TEXT NOT NULL DEFAULT '{}',
     registered_at     TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, user_id),
     UNIQUE (event_id, email)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_event_registrations_event
     ON event_registrations (event_id, status, waitlist_position)`,
  `CREATE INDEX IF NOT EXISTS idx_event_registrations_user
     ON event_registrations (user_id, registered_at)`,
  `CREATE TABLE IF NOT EXISTS event_checkins (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id        INTEGER NOT NULL REFERENCES events(id),
     registration_id INTEGER NOT NULL REFERENCES event_registrations(id),
     code            TEXT NOT NULL UNIQUE,
     checked_in_at   TEXT,
     checked_in_by   INTEGER REFERENCES users(id),
     created_at      TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, registration_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_event_checkins_event
     ON event_checkins (event_id)`,
  `CREATE TABLE IF NOT EXISTS event_agenda_items (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id        INTEGER NOT NULL REFERENCES events(id),
     slug            TEXT,
     title           TEXT NOT NULL,
     description     TEXT,
     starts_at       TEXT,
     ends_at         TEXT,
     speaker_user_id INTEGER REFERENCES users(id),
     speaker_name    TEXT,
     speaker_title   TEXT,
     display_order   INTEGER NOT NULL DEFAULT 0,
     created_at      TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, slug)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_event_agenda_event
     ON event_agenda_items (event_id, display_order)`,
  `CREATE INDEX IF NOT EXISTS idx_event_agenda_speaker
     ON event_agenda_items (speaker_user_id)`,
  // Task #6 — reminder/notification ledger (mirror of 111_event_notifications.sql).
  `CREATE TABLE IF NOT EXISTS event_notifications (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id      INTEGER NOT NULL REFERENCES events(id),
     principal_key TEXT NOT NULL,
     kind          TEXT NOT NULL,
     created_at    TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, principal_key, kind)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_event_notifications_event
     ON event_notifications (event_id, kind)`,
];

export async function ensureEventsSchema(env: Env): Promise<boolean> {
  if (_ready) return true;
  try {
    for (const ddl of STATEMENTS) {
      try {
        await env.DB.prepare(ddl).run();
      } catch (e) {
        // An individual already-exists / partial-state statement must not abort
        // the rest of the bootstrap.
        console.warn('[eventsSchema] statement failed (continuing)', (e as Error).message);
      }
    }
    _ready = true;
    return true;
  } catch (e) {
    console.error('[eventsSchema] bootstrap failed', e);
    return false;
  }
}
