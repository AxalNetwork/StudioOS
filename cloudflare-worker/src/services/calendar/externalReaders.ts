/**
 * D1485 (#3979, parts 3 and 4 of #3723) — the member's own Google and Outlook
 * events, read only, on the page.
 *
 * Two kinds, `external_google` and `external_microsoft`. Both are page only and
 * never pushable (`registry.ts`), so no `.ics` file, feed or provider copy ever
 * carries one: copying an external event back out would loop. Nothing is
 * stored (owner question A, S1's pick a): every page read asks the provider for
 * that window.
 *
 * - Google pages `events.list` (`singleEvents=true`, `timeMin`/`timeMax`, only
 *   the fields the page draws), as `services/google/raise.ts` does. It reads
 *   only when the stored grant names a calendar scope (owner step E confirms
 *   production's consent screen covers `calendar.readonly`).
 * - Microsoft reads Graph `/me/calendarView` with `$select` and `$top`, in UTC.
 * - Each stops at 4 pages of 250 and marks its source `truncated`.
 * - A member with no connection has no external source at all (`NoSource`):
 *   absence is not an error. An expired or revoked token is `reconnect`, a 429
 *   is `rate_limited`, anything else `unreadable`, and only that source fails.
 *
 * NEVER LOG A TITLE, AN ATTENDEE, AN ADDRESS OR A PROVIDER BODY. Codes only.
 *
 * `dedupeExternal` runs on the page read: an external event that is Axal's own
 * copy (its id is a `calendar_sync_records.external_event_id` for this member
 * and provider, or its iCalUID is an Axal item's `source_uid`) is dropped, and
 * the Axal item gains `also_on`. One that only starts within a minute of an
 * Axal item with an overlapping title is flagged `possible_duplicate`, never
 * merged.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

export type ExternalKind = 'external_google' | 'external_microsoft';
export type ExternalProvider = 'google' | 'microsoft';
export const EXTERNAL_KINDS: readonly ExternalKind[] = ['external_google', 'external_microsoft'];
export const isExternalKind = (kind: string): kind is ExternalKind => (EXTERNAL_KINDS as readonly string[]).includes(kind);
export const PROVIDER_OF: Readonly<Record<ExternalKind, ExternalProvider>> = { external_google: 'google', external_microsoft: 'microsoft' };
export const PAGE_SIZE = 250;
export const MAX_PAGES = 4;

/** The member has no such connection: the source is not listed at all. */
export class NoSource extends Error { constructor() { super('no_source'); } }
/** A source that failed, with the code the page shows. */
export class ExternalReadError extends Error {
  code: 'reconnect' | 'rate_limited' | 'unreadable';
  constructor(code: 'reconnect' | 'rate_limited' | 'unreadable') { super(code); this.code = code; }
}

/** What a reader returns: the events, and whether it stopped at the page cap. */
export type ExternalRead = CalendarEvent[] & { truncated?: boolean };

export type ExternalDeps = {
  fetcher?: typeof fetch;
  /** The token store and refresh, injectable for tests. */
  token?: (env: Env, provider: ExternalProvider, userId: number) => Promise<{ access: string; address: string | null } | null>;
};

const GOOGLE_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const GRAPH_VIEW = 'https://graph.microsoft.com/v1.0/me/calendarView';
const READONLY = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'];

/** The member's access token for one provider, or null when not connected. A refused refresh is `reconnect`. */
async function storedToken(env: Env, provider: ExternalProvider, userId: number) {
  const { loadRefreshTokenExport, refreshGoogleAccessToken, refreshMicrosoftAccessToken, reencryptRefreshTokenExport } = await import('../calendar');
  const table = provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
  const row = provider === 'google'
    ? await env.DB.prepare('SELECT scope, google_email AS address FROM google_oauth_tokens WHERE user_id = ?').bind(userId).first<{ scope: string | null; address: string | null }>()
    : await env.DB.prepare('SELECT scope, microsoft_email AS address FROM microsoft_oauth_tokens WHERE user_id = ?').bind(userId).first<{ scope: string | null; address: string | null }>();
  if (!row) return null;
  if (provider === 'google' && !String(row.scope || '').split(/[\s,]+/).some((s) => READONLY.includes(s))) throw new ExternalReadError('reconnect');
  const stored = await loadRefreshTokenExport(env, table, userId);
  if (!stored?.raw) return null;
  let access: string;
  try {
    access = provider === 'google' ? await refreshGoogleAccessToken(env, stored.raw) : await refreshMicrosoftAccessToken(env, stored.raw);
  } catch {
    throw new ExternalReadError('reconnect');
  }
  if (stored.wasPlaintext) await reencryptRefreshTokenExport(env, table, userId, stored.raw);
  return { access, address: row.address ?? null };
}

function failure(status: number): ExternalReadError {
  if (status === 401 || status === 403) return new ExternalReadError('reconnect');
  if (status === 429) return new ExternalReadError('rate_limited');
  return new ExternalReadError('unreadable');
}

async function getJson(fetcher: typeof fetch, url: string, headers: Record<string, string>): Promise<any> {
  let res: Response;
  try { res = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers }); }
  catch { throw new ExternalReadError('unreadable'); }
  if (!res.ok) throw failure(res.status);
  const body: any = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new ExternalReadError('unreadable');
  return body;
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);
const isoOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function item(kind: ExternalKind, o: {
  id: string; ical: string | null; title: string | null; start: string; end: string; url: string | null; join: string | null; address: string | null;
}): CalendarEvent {
  return {
    id: `${kind}:${o.id}`, kind, source_id: 0, source_uid: o.id,
    title: o.title || 'Busy', start_at: o.start, end_at: o.end, status: 'confirmed',
    location_kind: o.join ? 'video' : null, location_uri: o.join,
    organizer_email: null, attendees: [], notes: null,
    url: o.url ?? undefined, read_only: true,
    external: { provider: PROVIDER_OF[kind], ical_uid: o.ical, account: { provider: PROVIDER_OF[kind], address: o.address } },
  };
}

/** Google: `events.list` on the primary calendar, paged, at most 4 × 250. */
export async function googleEvents(env: Env, userId: number, fromIso: string, toIso: string, deps: ExternalDeps = {}): Promise<ExternalRead> {
  const tok = await (deps.token ?? storedToken)(env, 'google', userId);
  if (!tok) throw new NoSource();
  const fetcher = deps.fetcher ?? fetch;
  const out: ExternalRead = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(GOOGLE_EVENTS);
    url.search = new URLSearchParams({
      timeMin: fromIso, timeMax: toIso, singleEvents: 'true', orderBy: 'startTime', maxResults: String(PAGE_SIZE),
      fields: 'items(id,iCalUID,summary,start,end,status,htmlLink,hangoutLink),nextPageToken',
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const body = await getJson(fetcher, url.toString(), { Authorization: `Bearer ${tok.access}` });
    for (const e of Array.isArray(body.items) ? body.items : []) {
      if (e?.status === 'cancelled') continue;
      const id = str(e?.id, 1024);
      const start = isoOf(e?.start?.dateTime ?? e?.start?.date);
      const end = isoOf(e?.end?.dateTime ?? e?.end?.date);
      if (!id || !start || !end) continue;
      out.push(item('external_google', {
        id, ical: str(e?.iCalUID, 1024), title: str(e?.summary, 500), start, end,
        url: str(e?.htmlLink, 2048)?.startsWith('https://') ? e.htmlLink : null,
        join: str(e?.hangoutLink, 2048)?.startsWith('https://') ? e.hangoutLink : null, address: tok.address,
      }));
    }
    pageToken = str(body.nextPageToken, 2048);
    if (!pageToken) return out;
  }
  out.truncated = true;
  return out;
}

/** Outlook: Graph `/me/calendarView` in UTC, paged by `@odata.nextLink` on Graph only, at most 4 × 250. */
export async function microsoftEvents(env: Env, userId: number, fromIso: string, toIso: string, deps: ExternalDeps = {}): Promise<ExternalRead> {
  const tok = await (deps.token ?? storedToken)(env, 'microsoft', userId);
  if (!tok) throw new NoSource();
  const fetcher = deps.fetcher ?? fetch;
  const out: ExternalRead = [];
  const first = new URL(GRAPH_VIEW);
  first.search = new URLSearchParams({
    startDateTime: fromIso, endDateTime: toIso, $top: String(PAGE_SIZE),
    $select: 'id,iCalUId,subject,start,end,isCancelled,webLink,onlineMeeting', $orderby: 'start/dateTime',
  }).toString();
  let next: string | null = first.toString();
  for (let page = 0; page < MAX_PAGES && next; page += 1) {
    const body = await getJson(fetcher, next, { Authorization: `Bearer ${tok.access}`, Prefer: 'outlook.timezone="UTC"' });
    for (const e of Array.isArray(body.value) ? body.value : []) {
      if (e?.isCancelled === true) continue;
      const id = str(e?.id, 1024);
      const start = isoOf(e?.start?.dateTime);
      const end = isoOf(e?.end?.dateTime);
      if (!id || !start || !end) continue;
      const join = str(e?.onlineMeeting?.joinUrl, 2048);
      out.push(item('external_microsoft', {
        id, ical: str(e?.iCalUId, 1024), title: str(e?.subject, 500), start, end,
        url: str(e?.webLink, 2048)?.startsWith('https://') ? e.webLink : null,
        join: join?.startsWith('https://') ? join : null, address: tok.address,
      }));
    }
    const link = str(body['@odata.nextLink'], 4096);
    // Only Graph itself: a next link anywhere else is not followed.
    next = link && link.startsWith('https://graph.microsoft.com/') ? link : null;
  }
  if (next) out.truncated = true;
  return out;
}

const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
const overlaps = (a: string, b: string) => {
  const wa = words(a); if (!wa.size) return false;
  for (const w of words(b)) if (wa.has(w)) return true;
  return false;
};

/**
 * The page read's dedupe. `synced` holds the member's own copies:
 * `${provider}:${external_event_id}` → `${source_kind}:${source_id}` of the Axal item it copies.
 */
export function dedupeExternal(events: CalendarEvent[], synced: Map<string, string>): CalendarEvent[] {
  const axal = events.filter((e) => !isExternalKind(e.kind));
  const byCopy = new Map(axal.map((e) => [`${e.kind}:${e.source_id}`, e]));
  const byUid = new Map(axal.filter((e) => e.source_uid).map((e) => [e.source_uid, e]));
  const out: CalendarEvent[] = [];
  const mark = (e: CalendarEvent, provider: ExternalProvider) => {
    e.also_on = [...new Set([...(e.also_on ?? []), provider])];
  };
  for (const e of events) {
    if (!e.external) { out.push(e); continue; }
    const provider = e.external.provider;
    const copied = byCopy.get(synced.get(`${provider}:${e.source_uid}`) ?? '');
    const same = copied ?? (e.external.ical_uid ? byUid.get(e.external.ical_uid) : undefined);
    if (same) { mark(same, provider); continue; }
    const start = Date.parse(e.start_at);
    const near = axal.some((a) => Math.abs(Date.parse(a.start_at) - start) <= 60_000 && overlaps(a.title, e.title));
    out.push(near ? { ...e, possible_duplicate: true } : e);
  }
  return out;
}

/** The member's own provider copies, for the dedupe: `${provider}:${external_event_id}` → `${kind}:${source_id}`. */
export async function syncedCopies(env: Env, userId: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const r = await env.DB.prepare(
      'SELECT provider, source_kind, source_id, external_event_id FROM calendar_sync_records WHERE user_id = ? LIMIT 5000',
    ).bind(userId).all<{ provider: string; source_kind: string; source_id: number; external_event_id: string }>();
    for (const row of r.results ?? []) out.set(`${row.provider}:${row.external_event_id}`, `${row.source_kind}:${row.source_id}`);
  } catch {
    console.warn('[calendar] sync records unreadable', { outcome: 'dedupe_by_ical_only' });
  }
  return out;
}
