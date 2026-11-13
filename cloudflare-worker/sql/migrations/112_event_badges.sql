-- Migration 112 — Cross-system event badges (Task #7).
--
-- Seeds the three event-participation badge definitions that
-- services/eventBadges.ts grants from agenda membership + check-ins. Idempotent
-- (INSERT OR IGNORE on the global slug), mirroring 108's badge seed. kind='event'
-- so the badge wall / hub groups them apart from archetype + milestone awards.
-- icon keys must exist in frontend/src/lib/assessmentMeta.js::iconFor (mic /
-- network / ticket were added there); unknown icons fall back to Sparkles.
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
