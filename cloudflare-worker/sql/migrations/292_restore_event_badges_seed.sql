-- Migration 292 — Restore the three event-badge seed rows dropped by the
-- BASELINE_CUTOFF (task 336 / D257).
--
-- Migration 112 (below BASELINE_CUTOFF=219) seeds the three
-- assessment_badges rows that services/eventBadges.ts::grantBadge() grants
-- from agenda membership + check-ins. On a fresh database built from
-- schema_baseline.sql + migrations above the cutoff, `migrate-d1
-- --bootstrap` marks 112 applied without running it, and schema_baseline.sql
-- never carried its data (only its shape, via the assessment_badges CREATE
-- TABLE). Every event-badge award then fails its
-- `user_badges.badge_slug REFERENCES assessment_badges(slug)` foreign key —
-- silently, since grantBadge()'s caller swallows the error — on every
-- freshly built database, i.e. every branch.
--
-- This re-runs 112's three rows verbatim, as INSERT OR IGNORE (idempotent on
-- the global slug, safe to apply whether or not 112 actually ran). It does
-- NOT re-land the 26 other assessment badges from migrations 108/110 — see
-- D257 in documentation/architecture/DECISIONS.md for why: nothing in the
-- current codebase awards them (the player/award code for archetype and
-- milestone badges is gone), so re-seeding them would restore inert rows,
-- not fix a bug.
INSERT OR IGNORE INTO assessment_badges
  (slug, label, description, kind, icon, criteria_json, xp_reward, display_order) VALUES
  ('event_demo_day_presenter', 'Demo Day Presenter',
    'Presented as a speaker on a Demo Day agenda.', 'event', 'mic',
    '{"event":"agenda_speaker","event_type":"demo_day"}', 75, 20),
  ('event_networker', 'Networker',
    'Checked in to five or more events.', 'event', 'network',
    '{"event":"checkins","count":5}', 100, 21),
  ('event_founding_attendee', 'Founding Attendee',
    'Checked in to your first event.', 'event', 'ticket',
    '{"event":"first_checkin"}', 50, 22);
