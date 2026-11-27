/**
 * The canonical event types, and the one place either side may enumerate them.
 *
 * There were three lists and they disagreed, which is how the bug below
 * survived:
 *
 *   migration 109 / EventEditorPage   7 types — what you can actually create
 *   PublicEventsPage filter          10 types — four of which nothing creates
 *   preferredEventTypes (worker)      keys off 'conference' and 'social'
 *
 * The consequence was not cosmetic. `/events/suggested` recommends by track,
 * and the partner track asked for `['conference', 'meetup', 'social']` — two
 * of those could never exist, so a partner's suggestions quietly collapsed to
 * meetups. The investor track lost 'conference' the same way.
 *
 * The fix is additive on purpose. Removing 'conference' and 'roundtable' from
 * the public filter would have been the smaller diff, but production rows may
 * already carry those types (the column is free TEXT and always has been), and
 * hiding a real event is worse than offering one more option in a dropdown. So
 * everything either side knew about is canonical now, and both sides read this.
 *
 * `lp_briefing` is new — the Events canvas types an LP briefing distinctly from
 * a demo day, and there was no type for it.
 *
 * The worker mirrors this file at cloudflare-worker/src/services/eventTypes.ts;
 * frontend/test/event_types_parity.test.mjs fails the build if they drift.
 */
export const EVENT_TYPES = [
  { id: 'demo_day', label: 'Demo Day' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'office_hours', label: 'Office Hours' },
  { id: 'lp_briefing', label: 'LP Briefing' },
  { id: 'networking', label: 'Networking' },
  { id: 'roundtable', label: 'Roundtable' },
  { id: 'fireside', label: 'Fireside' },
  { id: 'conference', label: 'Conference' },
  { id: 'webinar', label: 'Webinar' },
  { id: 'meetup', label: 'Meetup' },
  { id: 'social', label: 'Social' },
  { id: 'other', label: 'Other' },
];

export const EVENT_TYPE_IDS = EVENT_TYPES.map((t) => t.id);

/** The public filter's own list, which leads with an "All types" option. */
export const EVENT_TYPE_FILTERS = [{ id: '', label: 'All types' }, ...EVENT_TYPES];
