/**
 * D1484 (#3977, part 1 of #3723) — the calendar's sources, in one list.
 *
 * Every kind the calendar can show has one entry: its family, the module it
 * comes from and its label, both in plain words, and whether it is page only
 * (never in an .ics file, a subscription feed or a provider copy) and whether
 * one event of it can be pushed to Google or Outlook.
 *
 * `READERS` in `../calendar.ts`, `FAMILY_OF` and `COPYABLE_KINDS` in
 * `items.ts`, the route's `PUSHABLE_KINDS` and D1384's `PAGE_ONLY_KINDS` /
 * `FEED_KINDS` are derived from it or asserted against it
 * (`calendar_registry_d1484.test.ts`). `Record<CalendarEvent['kind'], …>`
 * makes tsc refuse a kind with no entry.
 *
 * NEVER A TABLE NAME. `module` and `label` are what a member reads, so the
 * test refuses any that matches a `CREATE TABLE` name in the baseline.
 */
import type { CalendarEvent } from '../calendar';

export type SourceFamily = 'meetings' | 'events' | 'validate' | 'grow' | 'deadlines' | 'raise' | 'tasks' | 'learning' | 'external';
export const SOURCE_FAMILIES: readonly SourceFamily[] = ['meetings', 'events', 'validate', 'grow', 'deadlines', 'raise', 'tasks', 'learning', 'external'];

export interface SourceDef {
  family: SourceFamily;
  /** Where it comes from, in plain words: "Raise › Capital relationships". */
  module: string;
  /** What one item is, in plain words: "Investor meeting". */
  label: string;
  /** Read on the page only: never an .ics file, a feed or a provider copy. */
  page_only: boolean;
  /** One event of it can be copied to Google or Outlook (`POST /calendar/push/:kind/:id`). */
  pushable: boolean;
}

export const SOURCES: Readonly<Record<CalendarEvent['kind'], SourceDef>> = Object.freeze({
  ic_meeting: { family: 'meetings', module: 'Deals › Investment committee', label: 'IC meeting', page_only: false, pushable: true },
  founder_checkin: { family: 'meetings', module: 'Ventures › Check-ins', label: 'Check-in', page_only: false, pushable: true },
  advisor_booking: { family: 'meetings', module: 'Advisors › Sessions', label: 'Advisor session', page_only: false, pushable: true },
  partner_office_hour: { family: 'meetings', module: 'Partners › Office hours', label: 'Office hour', page_only: false, pushable: true },
  calendly_event: { family: 'external', module: 'Calendly', label: 'Calendly booking', page_only: false, pushable: false },
  expert_booking: { family: 'meetings', module: 'Wellbeing › Expert sessions', label: 'Expert session', page_only: false, pushable: false },
  event_ticket: { family: 'events', module: 'My events › Tickets', label: 'Event ticket', page_only: false, pushable: true },
  event_hosted: { family: 'events', module: 'My events › Hosting', label: 'Hosting', page_only: false, pushable: true },
  investor_meeting: { family: 'raise', module: 'Raise › Capital relationships', label: 'Investor meeting', page_only: false, pushable: false },
  compliance_due: { family: 'deadlines', module: 'Build › Compliance', label: 'Compliance deadline', page_only: true, pushable: false },
  // D1208's three readers, wired by D1484.
  interview_call: { family: 'validate', module: 'Validate › Customer research', label: 'Interview call', page_only: true, pushable: false },
  cohort_date: { family: 'deadlines', module: 'Spin-Out Lab › Cohort', label: 'Cohort date', page_only: true, pushable: false },
  deal_closing: { family: 'deadlines', module: 'Deals › Closings', label: 'Deal closing', page_only: true, pushable: false },
  // The events a member adds with "New event" (`POST /calendar/events`).
  manual: { family: 'tasks', module: 'Calendar', label: 'Your event', page_only: true, pushable: false },
  // #3959: the member's own learning plan; page only until its feed and provider copy are designed.
  learning: { family: 'learning', module: 'Learning › Your plan', label: 'Learning', page_only: true, pushable: false },
  // D1486 §a (#3980): the meeting bot's calls; `done` reads Recorded.
  bot_call: { family: 'meetings', module: 'Validate › Record a session', label: 'Recorded call', page_only: true, pushable: false },
});

export const SOURCE_KINDS = Object.keys(SOURCES) as CalendarEvent['kind'][];
export const pageOnlyKinds = (): CalendarEvent['kind'][] => SOURCE_KINDS.filter((k) => SOURCES[k].page_only);
export const pushableKinds = (): CalendarEvent['kind'][] => SOURCE_KINDS.filter((k) => SOURCES[k].pushable);

/** An item's `source`: its family, module and label. `account` is set by #3723 part 3's connected calendars only. */
export type ItemSource = { family: SourceFamily; module: string; label: string; account: null };
export function sourceOf(kind: CalendarEvent['kind']): ItemSource {
  const s = SOURCES[kind];
  return { family: s.family, module: s.module, label: s.label, account: null };
}
