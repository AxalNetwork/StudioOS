/**
 * The canonical event types — the worker's half of the pair.
 *
 * This mirrors frontend/src/lib/eventTypes.js, which carries the full reasoning
 * for why the list looks like this. In short: three lists disagreed, and
 * `preferredEventTypes` in routes/events.ts keyed off two types nothing could
 * create, so the partner track's suggestions collapsed to meetups.
 *
 * frontend/test/event_types_parity.test.mjs fails the build if the two files
 * drift, and asserts every type named in a suggestion set is one of these.
 */
export const EVENT_TYPE_IDS = [
  'demo_day',
  'workshop',
  'office_hours',
  'lp_briefing',
  'networking',
  'roundtable',
  'fireside',
  'conference',
  'webinar',
  'meetup',
  'social',
  'other',
] as const;

export type EventType = (typeof EVENT_TYPE_IDS)[number];

const VALID = new Set<string>(EVENT_TYPE_IDS);

/** True when `t` is a type this platform recognises. */
export function isEventType(t: unknown): t is EventType {
  return typeof t === 'string' && VALID.has(t);
}
