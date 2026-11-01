/**
 * D1207 (#3173, part 2 of #2420) — what each Calendar item carries for the
 * person reading it: CAL4's drawer, CAL5's other kinds and CAL19's dialogs.
 *
 * ONLY THE PAGE READ CALLS THIS (`GET /calendar/events`). The .ics feed, the
 * Google and Outlook sync and the one-event push keep the plain
 * `CalendarEvent`, so nothing here reaches a provider or a feed.
 *
 * NEVER A GUESS. A name the store does not hold is null, a time zone nothing
 * recorded is null, and a check-in's cancel reason is null because
 * `founder_checkins` has no column for one.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';
import { sourceOf, type ItemSource } from './registry';

/** The canvas's five families (D1205's `FAMILIES`), by kind. */
export type ItemFamily = 'events' | 'meetings' | 'sessions' | 'deadlines' | 'learning' | 'grow' | 'other';
export const FAMILY_OF: Readonly<Record<CalendarEvent['kind'], ItemFamily>> = {
  event_ticket: 'events',
  event_hosted: 'events',
  ic_meeting: 'meetings',
  founder_checkin: 'meetings',
  investor_meeting: 'meetings',
  advisor_booking: 'sessions',
  partner_office_hour: 'sessions',
  expert_booking: 'sessions',
  calendly_event: 'other',
  // D1384: the Compliance layer.
  compliance_due: 'deadlines',
  // D1484 (#3977): D1208's readers and "New event".
  interview_call: 'meetings',
  cohort_date: 'deadlines',
  deal_closing: 'deadlines',
  manual: 'events',
  // #3959: the member's own learning plan.
  learning: 'learning',
  // D1486 §b (#3981): Grow's sends and planned pieces.
  publish_send: 'grow',
  content_planned: 'grow',
  // #3982 (D1486 §c): a round's close and an NDA's expiry are deadlines.
  round_close: 'deadlines',
  nda_expiry: 'deadlines',
  // #3983 (D1486 §d): a task's due date is a deadline.
  workflow_task: 'deadlines',
  mvp_task: 'deadlines',
  contact_task: 'deadlines',
  engagement_milestone: 'deadlines',
};

/** The kinds `POST /calendar/push/:kind/:source_id` copies to Google or Outlook. */
export const COPYABLE_KINDS: readonly CalendarEvent['kind'][] = [
  'advisor_booking', 'ic_meeting', 'founder_checkin', 'partner_office_hour',
  'event_ticket', 'event_hosted',
];

/** Where the reader stands, in the canvas's words (CAL3's agenda, CAL5's people). */
export const ROLE_WORDS: Readonly<Record<string, string>> = {
  organiser: 'Organiser',
  invited: 'Invited',
  giving: 'You give this session',
  booked: 'Booked by you',
  ticket_holder: 'Ticket holder',
  hosting: 'Host',
  from_calendly: 'From Calendly',
  venture_deadline: 'Your venture’s deadline',
  interviewer: 'You run this interview',
  cohort_member: 'Your cohort',
  investor_in_room: 'In your deal room',
  yours: 'Your event',
  learning_plan: 'Your learning plan',
  venture_team: 'Your venture’s team',
  your_send: 'You confirmed this send',
  venture_round: 'Your venture’s round',
  nda_party: 'A party to this NDA',
  assigned_to_you: 'Assigned to you',
  venture_follow_up: 'Your venture’s follow-up',
  delivering: 'You deliver this',
};

/** The role a kind's reader does not set, because there is only one. */
const ROLE_BY_KIND: Partial<Record<CalendarEvent['kind'], string>> = {
  expert_booking: 'booked',
  event_ticket: 'ticket_holder',
  event_hosted: 'hosting',
  investor_meeting: 'organiser',
  calendly_event: 'from_calendly',
  compliance_due: 'venture_deadline',
  interview_call: 'interviewer',
  cohort_date: 'cohort_member',
  deal_closing: 'investor_in_room',
  manual: 'yours',
  learning: 'learning_plan',
  publish_send: 'your_send',
  content_planned: 'venture_team',
  round_close: 'venture_round',
  nda_expiry: 'nda_party',
  workflow_task: 'assigned_to_you',
  mvp_task: 'assigned_to_you',
  contact_task: 'venture_follow_up',
  engagement_milestone: 'delivering',
};

export interface CalendarItem extends Omit<CalendarEvent, 'my_role' | 'advisor_uid'> {
  family: ItemFamily;
  /** D1484: where it comes from, in plain words (the registry), never a table name. */
  source: ItemSource;
  my_role: { code: string; words: string };
  can: { rsvp: boolean; reschedule: boolean; cancel: boolean; copy: boolean };
  all_day: boolean;
  /** The item's own page on StudioOS, or null when it has none. */
  href: string | null;
  cancel_reason: string | null;
  deal_name: string | null;
  project_name: string | null;
  time_zone: string | null;
}

/** The item's source page. Null for a Calendly booking: it lives in Calendly. */
export function hrefOf(ev: CalendarEvent): string | null {
  switch (ev.kind) {
    case 'ic_meeting': return ev.deal_id ? `/deals/${ev.deal_id}` : null;
    case 'founder_checkin': return ev.project_id ? `/projects/${ev.project_id}` : null;
    case 'advisor_booking':
      if (ev.my_role === 'giving') return '/practice/sessions';
      return ev.advisor_uid ? `/advisors/${ev.advisor_uid}` : null;
    // A requester's partner booking has no page of its own yet (D1207 §1).
    case 'partner_office_hour': return ev.my_role === 'giving' ? '/partner/office-hours' : null;
    case 'expert_booking': return '/wellbeing';
    case 'event_ticket': return ev.event_id ? `/my/events/ticket/${ev.event_id}` : null;
    case 'event_hosted': return ev.event_id ? `/my/events/hosting/${ev.event_id}` : null;
    case 'investor_meeting': return '/raise/capital-relationships';
    case 'deal_closing': return ev.deal_id ? `/deals/${ev.deal_id}` : null;
    case 'interview_call': return ev.project_id ? `/validate/customer-research?project=${ev.project_id}` : null;
    // #3959: the Learning page the plan item names (its course, lesson, video, webinar, exercise or exam).
    case 'learning': return typeof ev.url === 'string' && ev.url.startsWith('/learning') ? ev.url : '/learning';
    // D1486 §b: the send's Grow module, and Distribution for a planned piece.
    case 'publish_send': return typeof ev.url === 'string' && ev.url.startsWith('/grow') ? ev.url : '/grow';
    case 'content_planned': return '/grow/distribution';
    case 'round_close': return '/raise/capital-relationships';
    // #3983: a workflow task has no page of its own; the others open their board.
    case 'mvp_task': return '/build/board';
    case 'contact_task': return '/contacts';
    case 'engagement_milestone': return '/delivery/health';
    default: return null;
  }
}

/**
 * What the reader may do from the item. Reschedule and Cancel are the
 * organiser's or an admin's on an IC meeting, and either party's on a
 * check-in (its cancel route's rule, since a check-in stores no booker).
 * Nothing is offered on a cancelled item, and nothing but Copy on one that
 * has ended.
 */
export function canOf(ev: CalendarEvent, isAdmin: boolean, nowMs = Date.now()): CalendarItem['can'] {
  const live = ev.status !== 'cancelled';
  const ahead = live && new Date(ev.end_at).getTime() > nowMs;
  const changes = ev.kind === 'ic_meeting'
    ? ev.my_role === 'organiser' || isAdmin
    : ev.kind === 'founder_checkin';
  return {
    rsvp: ahead && ev.kind === 'ic_meeting' && ev.my_role === 'invited',
    reschedule: ahead && changes,
    cancel: ahead && changes,
    copy: live && COPYABLE_KINDS.includes(ev.kind),
  };
}

/** A date with no time is a whole day. Every reader today writes a time. */
export function isAllDay(ev: CalendarEvent): boolean {
  // D1484: D1208's all-day readers write a bare date (`deadline()`), so this holds for them too.
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ev.start_at));
}

async function namesById(env: Env, sqlText: string, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const r = await env.DB.prepare(sqlText).bind(JSON.stringify(ids)).all<{ id: number; name: string | null }>();
  for (const row of r.results || []) if (row.name) out.set(Number(row.id), String(row.name));
  return out;
}

/** Each event, with the fields the page draws. One query per name kind for the whole page. */
export async function describeItems(
  env: Env, user: { id: number; role: string }, events: CalendarEvent[],
): Promise<CalendarItem[]> {
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const dealIds = [...new Set(events.map((e) => Number(e.deal_id)).filter((n) => Number.isInteger(n) && n > 0))];
  const projectIds = [...new Set(events.map((e) => Number(e.project_id)).filter((n) => Number.isInteger(n) && n > 0))];
  let deals = new Map<number, string>();
  let projects = new Map<number, string>();
  // A name that cannot be read is null on the item; the page still answers.
  try {
    // A deal has no name of its own: it is its venture's.
    deals = await namesById(env,
      `SELECT d.id, p.name FROM deals d JOIN projects p ON p.id = d.project_id
        WHERE d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND p.deleted_at IS NULL`, dealIds);
    projects = await namesById(env,
      `SELECT id, name FROM projects WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND deleted_at IS NULL`, projectIds);
  } catch {
    console.warn('[calendar] item names unreadable', { deals: dealIds.length, projects: projectIds.length });
  }
  const nowMs = Date.now();
  return events.map((ev) => {
    const { advisor_uid: _advisorUid, my_role: role, ...rest } = ev;
    const code = role || ROLE_BY_KIND[ev.kind] || 'invited';
    return {
      ...rest,
      family: FAMILY_OF[ev.kind],
      source: sourceOf(ev.kind),
      my_role: { code, words: ROLE_WORDS[code] },
      can: canOf({ ...ev, my_role: code }, isAdmin, nowMs),
      all_day: isAllDay(ev),
      href: hrefOf({ ...ev, my_role: code }),
      cancel_reason: ev.status === 'cancelled' ? (ev.cancel_reason ?? null) : null,
      deal_name: ev.deal_id ? deals.get(Number(ev.deal_id)) ?? null : null,
      project_name: ev.project_id ? projects.get(Number(ev.project_id)) ?? null : null,
      time_zone: ev.time_zone ?? null,
    };
  });
}
