/**
 * Task #39 — Event engine: shared serialization + slug + ICS helpers.
 */
import type { Env } from '../types';
import { parseAudienceRules } from './eventAudience';

export const EVENT_TYPES = [
  'meetup',
  'workshop',
  'webinar',
  'demo_day',
  'office_hours',
  'conference',
  'social',
  'other',
] as const;

export const EVENT_VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export const LOCATION_KINDS = ['virtual', 'physical', 'hybrid'] as const;

export function slugify(input: string): string {
  const base = (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || `event-${crypto.randomUUID().slice(0, 8)}`;
}

/** Slugify `title`, then append -2/-3/… until it's unique among events. */
export async function ensureUniqueEventSlug(
  env: Env,
  title: string,
  excludeId?: number,
): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const row: any = await env.DB.prepare(
      `SELECT id FROM events WHERE slug = ? ${excludeId ? 'AND id <> ?' : ''} LIMIT 1`,
    ).bind(...(excludeId ? [candidate, excludeId] : [candidate])).first();
    if (!row) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

const TRUTHY = (v: unknown): boolean => v === 1 || v === true || v === '1';

/**
 * Public-safe event projection. `includePrivate` adds host-only operational
 * fields (audience rules, admin flags). Boolean-ish INTEGER columns are coerced
 * so the JSON surface is stable regardless of the D1/SQLite driver.
 */
export function shapeEvent(row: any, opts: { includePrivate?: boolean } = {}) {
  if (!row) return null;
  const base: Record<string, unknown> = {
    id: row.id,
    slug: row.slug,
    host_user_id: row.host_user_id ?? null,
    project_id: row.project_id ?? null,
    type: row.type,
    title: row.title,
    summary: row.summary ?? null,
    description: row.description ?? null,
    cover_url: row.cover_url ?? null,
    starts_at: row.starts_at,
    ends_at: row.ends_at ?? null,
    timezone: row.timezone ?? 'UTC',
    location_kind: row.location_kind ?? 'virtual',
    location_text: row.location_text ?? null,
    location_url: row.location_url ?? null,
    capacity: row.capacity != null ? Number(row.capacity) : null,
    waitlist_enabled: TRUTHY(row.waitlist_enabled),
    approval_required: TRUTHY(row.approval_required),
    visibility: row.visibility,
    status: row.status,
    featured: TRUTHY(row.featured),
    price_cents: Number(row.price_cents || 0),
    currency: row.currency ?? 'usd',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (opts.includePrivate) {
    base.admin_published = TRUTHY(row.admin_published);
    base.audience_rules = parseAudienceRules(row.audience_rules_json);
  }
  return base;
}

export function shapeAgendaItem(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    slug: row.slug ?? null,
    title: row.title,
    description: row.description ?? null,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    speaker_user_id: row.speaker_user_id ?? null,
    speaker_name: row.speaker_name ?? null,
    speaker_title: row.speaker_title ?? null,
    display_order: Number(row.display_order || 0),
  };
}

function icsEscape(s: string): string {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** ISO-8601 (or `YYYY-MM-DD HH:MM:SS`) → ICS UTC stamp `YYYYMMDDTHHMMSSZ`. */
function toIcsStamp(value: string | null | undefined): string {
  if (!value) return '';
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function vevent(event: any, baseUrl: string): string[] {
  const uid = `event-${event.id}@axal.vc`;
  const dtStart = toIcsStamp(event.starts_at);
  const dtEnd = toIcsStamp(event.ends_at) || dtStart;
  const url = `${baseUrl.replace(/\/$/, '')}/events/${event.slug}`;
  const locationParts = [event.location_text, event.location_url].filter(Boolean);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsStamp(event.updated_at || event.created_at) || dtStart}`,
  ];
  if (dtStart) lines.push(`DTSTART:${dtStart}`);
  if (dtEnd) lines.push(`DTEND:${dtEnd}`);
  lines.push(`SUMMARY:${icsEscape(event.title)}`);
  if (event.summary || event.description) {
    lines.push(`DESCRIPTION:${icsEscape(event.summary || event.description)}`);
  }
  if (locationParts.length) lines.push(`LOCATION:${icsEscape(locationParts.join(' — '))}`);
  lines.push(`URL:${icsEscape(url)}`);
  lines.push('END:VEVENT');
  return lines;
}

export function buildEventIcs(event: any, baseUrl = 'https://axal.vc'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Axal StudioOS//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...vevent(event, baseUrl),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

export function buildEventsIcs(events: any[], baseUrl = 'https://axal.vc'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Axal StudioOS//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Axal Events',
  ];
  for (const e of events) lines.push(...vevent(e, baseUrl));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
