-- 109_events_core.sql — Task #44
--
-- Core schema for the Event system: events plus their invitations,
-- registrations (with waitlist), check-ins, and agenda/speaker slots. Full
-- design: design/EVENT_SYSTEM.md (§1 visibility/status/publish-gate,
-- §2 invitations, §3 capacity/waitlist, §4 registration/check-in,
-- §7 comp eligibility, §8 API).
--
-- PUBLISH GATE (design §1): an event is visible on the PUBLIC calendar only when
--   visibility = 'public' AND status = 'published' AND admin_published = 1.
-- A founder choosing "publish public" sets status='pending_review'; an admin
-- approval sets status='published' AND admin_published=1. private/unlisted events
-- self-publish (status='published', admin_published stays 0) and are reachable
-- only by direct link / invitation token, never the public feed.
--
-- COMP ELIGIBILITY (design §7): audience_rules_json on an event declares who gets
-- a free seat. eventAudience.ts (E1) evaluates it against partners
-- (status='active' official partners; KYB via corporate_profiles),
-- limited_partners (invested_amount > 0), investors, project founders, and host
-- connections, then auto-mints comp event_invitations (source auto_partner /
-- auto_lp). Comp registrations skip payment.
--
-- ADDITIVE-ONLY + IDEMPOTENT: every statement is `CREATE TABLE IF NOT EXISTS` /
-- `CREATE INDEX IF NOT EXISTS`, so re-applying this file is a clean no-op. There
-- is NO `ALTER TABLE users` — attendee state lives in event_registrations keyed
-- by (event_id, user_id). Soft FKs (REFERENCES …) document intent only. The lazy
-- bootstrap mirror lives in services/eventsSchema.ts (shape only; never seeds).
--
-- Apply (wrangler needs Node 22+ — see GOTCHAS "Migrations & schema"):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/109_events_core.sql

-- ---------------------------------------------------------------------------
-- events — the central record. slug is the public, URL-safe identifier
-- (UNIQUE). host_user_id is the founder/host (NULL for official Axal events
-- created by an admin). capacity NULL = unlimited. waitlist_enabled toggles the
-- overflow queue; approval_required gates registrations behind host approval.
-- price_cents = 0 means free (paid tickets use the Stripe PaymentIntent flow,
-- design §4). audience_rules_json declares comp eligibility (design §7).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE,
  host_user_id       INTEGER REFERENCES users(id),
  project_id         INTEGER REFERENCES projects(id),
  type               TEXT NOT NULL DEFAULT 'meetup',     -- see cloudflare-worker/src/services/eventTypes.ts for the canonical list
  title              TEXT NOT NULL,
  summary            TEXT,
  description        TEXT,
  cover_url          TEXT,
  starts_at          TEXT NOT NULL,
  ends_at            TEXT,
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  location_kind      TEXT NOT NULL DEFAULT 'virtual',    -- virtual | in_person | hybrid
  location_text      TEXT,
  location_url       TEXT,
  capacity           INTEGER,                            -- NULL = unlimited
  waitlist_enabled   INTEGER NOT NULL DEFAULT 1,
  approval_required  INTEGER NOT NULL DEFAULT 0,
  visibility         TEXT NOT NULL DEFAULT 'private',    -- public | unlisted | private
  status             TEXT NOT NULL DEFAULT 'draft',      -- draft | pending_review | published | cancelled
  admin_published    INTEGER NOT NULL DEFAULT 0,         -- the admin gate; required (with public+published) for the public feed
  featured           INTEGER NOT NULL DEFAULT 0,
  audience_rules_json TEXT NOT NULL DEFAULT '{}',        -- comp-eligibility rules (design §7)
  price_cents        INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'usd',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Public-feed query path: WHERE visibility='public' AND status='published' AND admin_published=1 ORDER BY starts_at.
CREATE INDEX IF NOT EXISTS idx_events_public_feed
  ON events (visibility, status, admin_published, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_host
  ON events (host_user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_status
  ON events (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_starts
  ON events (starts_at);

-- ---------------------------------------------------------------------------
-- event_invitations — one row per invited principal. token is the opaque RSVP
-- key used by the public /invite/:token routes (UNIQUE). Exactly one of
-- invited_user_id / invited_email identifies the recipient. source distinguishes
-- a manual invite from an auto-minted comp invite (auto_partner / auto_lp).
-- comp = a free seat (skips payment). status tracks the RSVP lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id         INTEGER NOT NULL REFERENCES events(id),
  token            TEXT NOT NULL UNIQUE,
  invited_user_id  INTEGER REFERENCES users(id),
  invited_email    TEXT,
  invited_name     TEXT,
  source           TEXT NOT NULL DEFAULT 'manual',   -- manual | auto_partner | auto_lp
  comp             INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | revoked
  personal_message TEXT,
  invited_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_invitations_event
  ON event_invitations (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_invitations_user
  ON event_invitations (invited_user_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_email
  ON event_invitations (invited_email);

-- ---------------------------------------------------------------------------
-- event_registrations — one row per attendee per event. status drives the seat
-- math (design §3): registered/confirmed hold a seat; waitlisted are queued
-- (waitlist_position orders promotion on a cancel); attended is set at check-in;
-- cancelled frees a seat. comp marks a free seat; payment_* track the Stripe
-- PaymentIntent for paid tickets. UNIQUE(event_id,user_id) and
-- UNIQUE(event_id,email) keep a principal to a single registration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_registrations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL REFERENCES events(id),
  user_id           INTEGER REFERENCES users(id),
  email             TEXT,
  name              TEXT,
  status            TEXT NOT NULL DEFAULT 'registered',  -- registered | waitlisted | confirmed | attended | cancelled | declined
  source            TEXT NOT NULL DEFAULT 'self',        -- self | invite | comp | admin
  comp              INTEGER NOT NULL DEFAULT 0,
  invitation_id     INTEGER REFERENCES event_invitations(id),
  waitlist_position INTEGER,
  payment_status    TEXT NOT NULL DEFAULT 'none',        -- none | pending | paid | refunded
  payment_intent_id TEXT,
  amount_cents      INTEGER NOT NULL DEFAULT 0,
  answers_json      TEXT NOT NULL DEFAULT '{}',
  registered_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, user_id),
  UNIQUE (event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_event_registrations_event
  ON event_registrations (event_id, status, waitlist_position);
CREATE INDEX IF NOT EXISTS idx_event_registrations_user
  ON event_registrations (user_id, registered_at);

-- ---------------------------------------------------------------------------
-- event_checkins — a scan record. code is the per-registration QR payload
-- (UNIQUE); scanning it sets the registration to attended and writes this row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_checkins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        INTEGER NOT NULL REFERENCES events(id),
  registration_id INTEGER NOT NULL REFERENCES event_registrations(id),
  code            TEXT NOT NULL UNIQUE,
  checked_in_at   TEXT,
  checked_in_by   INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_event_checkins_event
  ON event_checkins (event_id);

-- ---------------------------------------------------------------------------
-- event_agenda_items — ordered agenda slots, each optionally fronted by a
-- speaker. speaker_user_id links a platform user (read by phase F to award the
-- Demo Day Presenter badge to founders in an event agenda); speaker_name covers
-- external speakers. UNIQUE(event_id,slug) keeps authoring idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_agenda_items (
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
);

CREATE INDEX IF NOT EXISTS idx_event_agenda_event
  ON event_agenda_items (event_id, display_order);
CREATE INDEX IF NOT EXISTS idx_event_agenda_speaker
  ON event_agenda_items (speaker_user_id);
