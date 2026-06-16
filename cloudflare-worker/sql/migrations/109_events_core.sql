-- Task #EVENTS-1 — Event Management System: core tables.
--
-- A full event system distinct from the existing surfaces: calendar_events
-- (external Google/Microsoft/Calendly sync), ic_meetings (investment committee),
-- mentor_bookings / partner_oh_slots (1:1 office hours) and compliance_events
-- (obligation calendar). None of those model a hostable, invitable, public-or-
-- private event with a capacity cap, an RSVP/registration roster, comp-invite
-- eligibility, and an admin publish gate. This migration adds that.
--
-- ADMIN OWNS WHAT GOES PUBLIC. A founder/partner can create and self-publish a
-- PRIVATE (invite-only) event to their own invitees immediately, but a PUBLIC
-- listing requires admin approval: status goes draft → pending_review → (admin)
-- published, and only events with visibility='public' AND admin_published=1 AND
-- status='published' ever appear on the public calendar. Admin can publish,
-- unpublish, feature, cancel or edit ANY event and writes an admin_audit_log
-- row (report_type='events') for each moderation action.
--
-- COMP (free) INVITES BY ELIGIBILITY. events.audience_rules_json declares who
-- is auto-eligible for a free seat — e.g. official partners and LPs who have
-- invested. The route layer evaluates it against the partners / limited_partners
-- / investors records to mint comp invitations and waive any ticket price.
--
-- CAPACITY. events.capacity (NULL = unlimited) caps CONFIRMED seats; overflow
-- goes to status='waitlisted' with a waitlist_position and auto-promotes on
-- cancellation. Hosts/admin can override.
--
-- Additive only, every statement is IF NOT EXISTS. Lazy bootstrap mirror in
-- services/eventsSchema.ts::ensureEventsSchema(). Apply:
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/109_events_core.sql
--
-- ============================================================================
-- VISIBILITY (events.visibility)
--   public    Listed on the public calendar once admin_published=1
--   unlisted  Reachable only by direct link / invite (not listed), no review
--   private   Invite-only; never listed; only invitees can see/register
--
-- STATUS (events.status)
--   draft → pending_review → published   (public path needs admin approval)
--   private/unlisted may go straight draft → published (host self-publish)
--   plus: cancelled | completed
--
-- TYPE (events.type)
--   demo_day | pitch | webinar | workshop | networking | ama | launch | office_hours | custom
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) events — the core record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  slug                 TEXT NOT NULL UNIQUE,        -- public URL: /events/:slug
  host_user_id         INTEGER REFERENCES users(id),-- NULL == Axal/official (admin-hosted)
  type                 TEXT NOT NULL DEFAULT 'custom',
  title                TEXT NOT NULL,
  summary              TEXT,
  description_md       TEXT,
  cover_image_url      TEXT,
  visibility           TEXT NOT NULL DEFAULT 'private', -- public|unlisted|private
  status               TEXT NOT NULL DEFAULT 'draft',    -- see STATUS above
  admin_published      INTEGER NOT NULL DEFAULT 0,       -- admin gate for public listing
  featured             INTEGER NOT NULL DEFAULT 0,       -- admin pin on public calendar
  timezone             TEXT NOT NULL DEFAULT 'UTC',
  start_at             TEXT NOT NULL,                    -- ISO8601 UTC
  end_at               TEXT,
  location_kind        TEXT NOT NULL DEFAULT 'virtual',  -- virtual|physical|hybrid
  location_uri         TEXT,                             -- join link (virtual)
  location_address     TEXT,                             -- venue (physical)
  capacity             INTEGER,                          -- NULL = unlimited
  waitlist_enabled     INTEGER NOT NULL DEFAULT 1,
  approval_required    INTEGER NOT NULL DEFAULT 0,       -- host approves each registrant
  registration_opens_at  TEXT,
  registration_closes_at TEXT,
  price_cents          INTEGER NOT NULL DEFAULT 0,       -- 0 = free
  currency             TEXT NOT NULL DEFAULT 'usd',
  audience_rules_json  TEXT NOT NULL DEFAULT '{}',        -- comp-eligibility rules (see header)
  project_id           INTEGER REFERENCES projects(id),  -- demo-day cohort link (nullable)
  cohort               TEXT,
  published_at         TEXT,
  published_by         INTEGER REFERENCES users(id),
  cancelled_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_public
  ON events (visibility, status, admin_published, start_at);
CREATE INDEX IF NOT EXISTS idx_events_host
  ON events (host_user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_start
  ON events (start_at);

-- ---------------------------------------------------------------------------
-- 2) event_hosts — co-hosts / speakers (the owner is events.host_user_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_hosts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id),
  user_id     INTEGER REFERENCES users(id),
  name        TEXT,                                -- for non-user speakers
  role        TEXT NOT NULL DEFAULT 'cohost',      -- owner|cohost|speaker|moderator
  bio         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_hosts_event ON event_hosts (event_id);

-- ---------------------------------------------------------------------------
-- 3) event_agenda — ordered agenda / programme items (e.g. demo-day pitch slots).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_agenda (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id),
  title         TEXT NOT NULL,
  speaker       TEXT,
  project_id    INTEGER REFERENCES projects(id),   -- presenting startup (demo day)
  start_at      TEXT,
  end_at        TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_agenda_event
  ON event_agenda (event_id, display_order);

-- ---------------------------------------------------------------------------
-- 4) event_invitations — a directed invite (personal, or auto-minted for comp-
--    eligible partners/LPs). token drives the public RSVP link /invite/:token.
--    comp=1 waives any ticket price. audience tags why they were invited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  event_id         INTEGER NOT NULL REFERENCES events(id),
  inviter_user_id  INTEGER REFERENCES users(id),
  invitee_user_id  INTEGER REFERENCES users(id),    -- NULL if invited by email only
  invitee_email    TEXT NOT NULL,
  invitee_name     TEXT,
  audience         TEXT NOT NULL DEFAULT 'general',  -- investor|partner|client|lp|speaker|general
  token            TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  comp             INTEGER NOT NULL DEFAULT 0,        -- 1 = free seat (partner/LP/VIP)
  status           TEXT NOT NULL DEFAULT 'sent',      -- sent|opened|accepted|declined|revoked|bounced
  personal_message TEXT,
  source           TEXT NOT NULL DEFAULT 'personal',  -- personal|auto_partner|auto_lp|admin|landing
  reminder_count   INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TEXT,
  sent_at          TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at     TEXT,
  UNIQUE (event_id, invitee_email)
);
CREATE INDEX IF NOT EXISTS idx_event_invitations_event
  ON event_invitations (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_invitations_invitee
  ON event_invitations (invitee_user_id, status);

-- ---------------------------------------------------------------------------
-- 5) event_registrations — the roster. A seat is CONFIRMED only when
--    status='confirmed' (or 'approved' then 'confirmed'); overflow past
--    capacity is 'waitlisted' with a waitlist_position. ticket_code backs the
--    QR check-in (qrcode dep already in package.json). source records the
--    acquisition path. UNIQUE(event_id,email) dedupes landing + invite signups.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_registrations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  event_id            INTEGER NOT NULL REFERENCES events(id),
  user_id             INTEGER REFERENCES users(id),    -- NULL for external/landing signups
  invitation_id       INTEGER REFERENCES event_invitations(id),
  email               TEXT NOT NULL,
  name                TEXT,
  role_at_registration TEXT,                            -- snapshot: founder|investor|partner|guest…
  status              TEXT NOT NULL DEFAULT 'confirmed', -- pending|approved|confirmed|waitlisted|declined|cancelled|attended|no_show
  waitlist_position   INTEGER,
  comp                INTEGER NOT NULL DEFAULT 0,        -- free seat
  source              TEXT NOT NULL DEFAULT 'landing',   -- personal_invite|landing|admin|auto_partner|auto_lp|self
  ticket_code         TEXT UNIQUE DEFAULT (lower(hex(randomblob(8)))), -- QR check-in
  payment_intent_id   TEXT,                              -- set when price_cents>0 and paid
  answers_json        TEXT NOT NULL DEFAULT '{}',         -- registration question answers
  checked_in_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, email)
);
CREATE INDEX IF NOT EXISTS idx_event_registrations_event
  ON event_registrations (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_registrations_user
  ON event_registrations (user_id, status);
