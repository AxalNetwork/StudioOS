/**
 * D1493 (#3906, SY8) — Eadwyn proposes one channel's copy for an event: its
 * title, its description, or both. Pure: no binding, no fetch.
 *
 * One press is one rail option, `draft:syndication-copy`, on the record
 * `events:<id>`, run once through `run()` on `rail_write` by
 * `routes/event_syndication_assist.ts`. Its answer becomes one
 * `ai_rail_proposals` row per field asked for (`kind: 'proposal'`), each
 * `{ account_uid, channel, field, value, source }`, the value cut to the
 * channel's `title_limit` or `text_limit`. Nothing here writes an override and
 * nothing posts: Accept is the rail's decide, and the page's own
 * `PUT /api/events/:id/syndication` saves the override.
 *
 * The model reads the event as it is stored: title, type, start, where, place,
 * summary and description, each cut. It is asked for the channel's own limits.
 */
import { DEFAULT_TEXT_LIMIT, DEFAULT_TITLE_LIMIT, syndicationChannel } from './channels';

export const SYNDICATION_COPY_OPTION = 'draft:syndication-copy';
export const COPY_FIELDS = ['title', 'description'] as const;
export type CopyField = typeof COPY_FIELDS[number];

/** The words a channel goes by in the prompt and in `source`. */
const CHANNEL_NAME: Record<string, string> = {
  luma: 'Luma', eventbrite: 'Eventbrite', google: 'Google Business Profile', linkedin: 'LinkedIn', facebook: 'Facebook',
};
export const channelName = (channel: string) => CHANNEL_NAME[channel] ?? channel;

/** The member's profile name for the rail page (`frontend/src/lib/railPages.js`, `PROFILE_OF_ROLE`). */
const PROFILE_OF_ROLE: Record<string, string> = {
  founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner',
  admin: 'Admin', branch_admin: 'Admin', super_admin: 'Super Admin',
};

/** The rail page a press is filed under: `<Profile> · Events`, the page key of the events a member manages. */
export function eventsPage(role: unknown): string {
  return `${PROFILE_OF_ROLE[String(role ?? '')] ?? 'Member'} · Events`;
}

export const eventRecord = (id: number) => `events:${id}`;

/** The channel's limits, or Part A's defaults while it has no adapter. */
export function channelLimits(channel: string): { title: number; description: number } {
  const a = syndicationChannel(channel);
  return { title: a?.title_limit ?? DEFAULT_TITLE_LIMIT, description: a?.text_limit ?? DEFAULT_TEXT_LIMIT };
}

/** The fields a press asks for, in `COPY_FIELDS` order, or null when the list is not one we accept. */
export function fieldsOf(raw: unknown): CopyField[] | null {
  if (raw == null) return [...COPY_FIELDS];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > COPY_FIELDS.length) return null;
  if (!raw.every((f) => (COPY_FIELDS as readonly string[]).includes(f as string))) return null;
  return COPY_FIELDS.filter((f) => raw.includes(f));
}

export const EVENT_TEXT_MAX = 6_000;

export type EventFacts = {
  title?: string | null; summary?: string | null; description?: string | null; type?: string | null; starts_at?: string | null;
  location_kind?: string | null; location_text?: string | null;
};

/** The event as the model reads it. */
export function eventTextOf(e: EventFacts): string {
  const line = (label: string, v: unknown, max: number) => (typeof v === 'string' && v.trim() ? `${label}: ${v.trim().slice(0, max)}` : '');
  return [
    line('Title', e.title, 300),
    line('Type', e.type, 60),
    line('Starts', e.starts_at, 40),
    line('Where', e.location_kind, 40),
    line('Place', e.location_text, 200),
    line('Summary', e.summary, 600),
    line('Description', e.description, EVENT_TEXT_MAX),
  ].filter(Boolean).join('\n');
}

const SYSTEM = [
  'You write event listings for the Axal network, from the event as its host described it.',
  'Write in plain, clear English and keep the host\'s meaning.',
  'Do not invent speakers, sponsors, prices, numbers, quotes or outcomes.',
  'Return only what is asked.',
].join(' ');

/** The messages one press sends. */
export function messageOf(event: EventFacts, channel: string, fields: CopyField[]): { system: string; user: string } {
  const lim = channelLimits(channel);
  const asks = fields.map((f) => (f === 'title'
    ? `"title": a title of at most ${lim.title} characters`
    : `"description": a description of at most ${lim.description} characters, plain text`));
  return {
    system: SYSTEM,
    user: `Write this event's listing for ${channelName(channel)}. Answer as JSON with ${asks.join(' and ')}.\n\nThe event:\n${eventTextOf(event) || '(no details)'}`,
  };
}

/** The first JSON object in a model's answer, or null. */
function objectOf(raw: unknown): Record<string, unknown> | null {
  const s = typeof raw === 'string' ? raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim() : '';
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** A value cut to `max` characters, on a word where one is near, without a trailing space. */
export function cutTo(value: string, max: number): string {
  const s = value.replace(/\s+\n/g, '\n').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const space = head.lastIndexOf(' ');
  return (space > max * 0.6 ? head.slice(0, space) : head).trim();
}

export type CopyProposal = { account_uid: string; channel: string; field: CopyField; value: string; source: string };

/** One payload per field the answer filled, each cut to the channel's limit; empty when it filled none. */
export function payloadsOf(output: unknown, accountUid: string, channel: string, fields: CopyField[]): CopyProposal[] {
  const parsed = objectOf(output);
  if (!parsed) return [];
  const lim = channelLimits(channel);
  const out: CopyProposal[] = [];
  for (const field of fields) {
    const raw = parsed[field];
    if (typeof raw !== 'string') continue;
    const value = cutTo(raw, field === 'title' ? lim.title : lim.description);
    if (value) out.push({ account_uid: accountUid, channel, field, value, source: `Eadwyn, from the event's description, for ${channelName(channel)}` });
  }
  return out;
}
