/**
 * D932 (#2716) — Admin · Community's "Recent activity" (CM1 row 7) and its
 * lightbox (CM6): the newest community items, merged across five sources and
 * paged.
 *
 * MEMBERS ARE NEVER NAMED. A row carries a kind, who acted (`admin` or
 * `member`, never which one), an icon key, a sentence, the item's title, a
 * link to its console and a time. An admin's act reads "An admin published
 * …"; a member's act reads as the item ("… submitted for review") or as a
 * count ("12 registrations for …"). No row carries a name, an email, an
 * account id or an audit row id, and a registration is never one row per
 * person: it is one row per event per day.
 *
 * EACH SOURCE ANSWERS ALONE. A source whose store failed is listed in
 * `unreadable` with its reason, its rows are absent and its count is not in
 * `total`. Nothing is invented to fill the gap.
 *
 * WHERE EACH ROW COMES FROM:
 *   - events: `admin_audit_log` rows with `report_type = 'events'` (published,
 *     sent back, unpublished, featured, cancelled), written by
 *     `routes/admin_events.ts`; and the `event_submitted` row `logAdminAction`
 *     writes when a host submits an event for review (`routes/events.ts`).
 *     The events table keeps only `created_at` and `updated_at`, and
 *     `updated_at` moves on every edit, so it dates no change.
 *   - jobs: `admin_audit_log` rows with `report_type = 'jobs'` (published,
 *     sent back, unpublished), written by `routes/admin_jobs.ts`; and the
 *     postings whose status is `pending_review` or `closed`, dated by their
 *     own `updated_at`. Submitting and closing are a host's acts and write no
 *     audit row, so the posting's last change is the only date there is; the
 *     row says so (`dated_by: 'last_change'`).
 *   - circles: `admin_audit_log` rows with `report_type = 'circles'`
 *     (created, published, unpublished, featured), written by
 *     `routes/admin_circles.ts`.
 *   - event_registrations: one row per event per UTC day, counting the
 *     registrations made that day, whatever their status now.
 *   - wellbeing: `admin_audit_log` rows with `report_type = 'wellbeing'`
 *     (an expert verified, unverified, hidden or restored), written by
 *     `routes/wellbeing.ts` from D932 on. The expert is not named: an
 *     expert's name is a person's details.
 */
import type { Env } from '../types';
import { likeNeedleLower } from '../util/likeSearch';

export const ACTIVITY_KINDS = ['events', 'jobs', 'circles', 'wellbeing', 'admin'] as const;
export type ActivityKind = typeof ACTIVITY_KINDS[number];
export const ACTIVITY_SOURCES = ['events', 'jobs', 'circles', 'event_registrations', 'wellbeing'] as const;
export type ActivitySource = typeof ACTIVITY_SOURCES[number];

export const ACTIVITY_LIMIT_DEFAULT = 10;
export const ACTIVITY_LIMIT_MAX = 50;
/** How far a page may reach: offset + limit. Past it the read is a 400, never a quietly short page. */
export const ACTIVITY_WINDOW_MAX = 1000;

export type ActivityRow = {
  kind: Exclude<ActivityKind, 'admin'>;
  actor: 'admin' | 'member';
  icon: string;
  sentence: string;
  title: string | null;
  href: string;
  at: string;
  dated_by?: 'last_change';
  count?: number;
};

export type ActivityQuery = {
  kind: ActivityKind | null;
  from: string | null;
  to: string | null;
  q: string | null;
  limit: number;
  offset: number;
};

/** The consoles a row links to. Wellbeing is a tab on the admin console until #2375. */
export const CONSOLE_HREF: Record<ActivityRow['kind'], string> = {
  events: '/admin/events',
  jobs: '/admin/jobs',
  circles: '/admin/circles',
  wellbeing: '/admin?tab=wellbeing',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The query, or the 400 to send. */
export function parseActivityQuery(get: (k: string) => string | undefined):
  { ok: true; query: ActivityQuery } | { ok: false; code: string; detail: string } {
  const rawKind = (get('kind') || '').trim().toLowerCase();
  const kind = rawKind ? (ACTIVITY_KINDS as readonly string[]).includes(rawKind) ? rawKind as ActivityKind : undefined : null;
  if (kind === undefined) return { ok: false, code: 'bad_kind', detail: `kind must be one of ${ACTIVITY_KINDS.join(', ')}.` };
  const from = (get('from') || '').trim() || null;
  const to = (get('to') || '').trim() || null;
  for (const [k, v] of [['from', from], ['to', to]] as const) {
    if (v !== null && (!DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) {
      return { ok: false, code: 'bad_date', detail: `${k} must be a date, YYYY-MM-DD.` };
    }
  }
  if (from && to && from > to) return { ok: false, code: 'bad_date', detail: 'from must not be after to.' };
  const q = (get('q') || '').trim().slice(0, 100) || null;
  const limitRaw = get('limit');
  const limit = limitRaw === undefined || limitRaw === '' ? ACTIVITY_LIMIT_DEFAULT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_LIMIT_MAX) {
    return { ok: false, code: 'bad_limit', detail: `limit must be a whole number from 1 to ${ACTIVITY_LIMIT_MAX}.` };
  }
  const offsetRaw = get('offset');
  const offset = offsetRaw === undefined || offsetRaw === '' ? 0 : Number(offsetRaw);
  if (!Number.isInteger(offset) || offset < 0 || offset + limit > ACTIVITY_WINDOW_MAX) {
    return { ok: false, code: 'bad_offset', detail: `offset must be a whole number, and offset + limit at most ${ACTIVITY_WINDOW_MAX}.` };
  }
  return { ok: true, query: { kind, from, to, q, limit, offset } };
}

/** SQLite's `YYYY-MM-DD HH:MM:SS` (UTC) as ISO 8601. */
export function isoOf(raw: unknown): string {
  const s = String(raw ?? '');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) return `${s.slice(0, 10)}T${s.slice(11, 19)}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ------------------------------------------------------------------ *
 * The sources. Every statement is fixed text; the filters are bound:
 * `(? IS NULL OR …)` twice per filter, so an absent filter matches all.
 * ------------------------------------------------------------------ */

const WINDOW = `(? IS NULL OR datetime(at) >= datetime(?)) AND (? IS NULL OR datetime(at) < datetime(?, '+1 day'))
   AND (? IS NULL OR lower(coalesce(title, '')) LIKE ? ESCAPE '\\')`;

const EVENTS_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, e.title AS title,
         json_extract(a.filters_json, '$.featured') AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN events e ON e.id = json_extract(a.filters_json, '$.event_id')
   WHERE a.report_type = 'events'
     AND a.action IN ('event_approved', 'event_rejected', 'event_unpublished', 'event_featured', 'event_cancelled')
  UNION ALL
  SELECT CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END, a.action, a.exported_at, e.title, NULL, a.id
    FROM admin_audit_log a
    LEFT JOIN events e ON e.id = json_extract(a.filters_json, '$.event_id')
    LEFT JOIN users u ON u.id = a.admin_user_id
   WHERE a.action = 'event_submitted'`;

const JOBS_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, j.title AS title, NULL AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN job_postings j ON j.id = json_extract(a.filters_json, '$.posting_id')
   WHERE a.report_type = 'jobs' AND a.action IN ('job_approved', 'job_rejected', 'job_unpublished')
  UNION ALL
  SELECT 'member', CASE WHEN j.status = 'closed' THEN 'job_closed' ELSE 'job_submitted' END, j.updated_at, j.title, NULL, -j.id
    FROM job_postings j
   WHERE j.status IN ('pending_review', 'closed')`;

const CIRCLES_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, ci.name AS title,
         json_extract(a.filters_json, '$.featured') AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN circles ci ON ci.id = json_extract(a.filters_json, '$.circle_id')
   WHERE a.report_type = 'circles'
     AND a.action IN ('circle_created', 'circle_published', 'circle_unpublished', 'circle_featured')`;

const REGISTRATIONS_SQL = `
  SELECT 'member' AS actor, 'registrations' AS action, MAX(r.registered_at) AS at, e.title AS title,
         COUNT(*) AS n, -MIN(r.id) AS tiebreak
    FROM event_registrations r JOIN events e ON e.id = r.event_id
   GROUP BY r.event_id, date(r.registered_at)`;

const WELLBEING_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, NULL AS title, NULL AS featured, a.id AS tiebreak
    FROM admin_audit_log a
   WHERE a.report_type = 'wellbeing'
     AND a.action IN ('expert_verified', 'expert_unverified', 'expert_hidden', 'expert_restored')`;

const BASE: Record<ActivitySource, string> = {
  events: EVENTS_SQL,
  jobs: JOBS_SQL,
  circles: CIRCLES_SQL,
  event_registrations: REGISTRATIONS_SQL,
  wellbeing: WELLBEING_SQL,
};

/** `admin` narrows to admins' acts in every source; a source with none is not asked. */
const ADMIN_FILTER = `(? IS NULL OR actor = 'admin')`;

function rowsSql(src: ActivitySource): string {
  return `SELECT * FROM (${BASE[src]}) WHERE ${WINDOW} AND ${ADMIN_FILTER} ORDER BY datetime(at) DESC, tiebreak DESC LIMIT ?`;
}
function countSql(src: ActivitySource): string {
  return `SELECT COUNT(*) AS n FROM (${BASE[src]}) WHERE ${WINDOW} AND ${ADMIN_FILTER}`;
}
const ROWS_SQL = Object.fromEntries(ACTIVITY_SOURCES.map((s) => [s, rowsSql(s)])) as Record<ActivitySource, string>;
const COUNT_SQL = Object.fromEntries(ACTIVITY_SOURCES.map((s) => [s, countSql(s)])) as Record<ActivitySource, string>;

/** Which sources a kind asks. Registrations are members' acts, so `admin` skips them. */
export function sourcesFor(kind: ActivityKind | null): ActivitySource[] {
  if (kind === null) return [...ACTIVITY_SOURCES];
  if (kind === 'admin') return ['events', 'jobs', 'circles', 'wellbeing'];
  if (kind === 'events') return ['events', 'event_registrations'];
  return [kind];
}

const KIND_OF: Record<ActivitySource, ActivityRow['kind']> = {
  events: 'events', jobs: 'jobs', circles: 'circles', event_registrations: 'events', wellbeing: 'wellbeing',
};

type Raw = { actor: string; action: string; at: string; title: string | null; featured?: unknown; n?: number };

const quoted = (t: string | null, fallback: string) => (t ? `“${t}”` : fallback);

/** One row's sentence and icon. Never a person: "An admin" or the item. */
export function shapeRow(src: ActivitySource, r: Raw): ActivityRow {
  const kind = KIND_OF[src];
  const title = r.title ?? null;
  const by = r.actor === 'admin' ? 'admin' : 'member';
  const base = { kind, actor: by as ActivityRow['actor'], title, href: CONSOLE_HREF[kind], at: isoOf(r.at) };
  const ev = quoted(title, 'an event'), job = quoted(title, 'a job posting'), circle = quoted(title, 'a circle');
  const on = r.featured === 1 || r.featured === true || r.featured === '1' || r.featured === 'true';
  switch (r.action) {
    case 'event_approved': return { ...base, icon: 'event-published', sentence: `An admin published ${ev}.` };
    case 'event_rejected': return { ...base, icon: 'event-returned', sentence: `An admin sent ${ev} back to its host.` };
    case 'event_unpublished': return { ...base, icon: 'event-unpublished', sentence: `An admin unpublished ${ev}.` };
    case 'event_featured': return { ...base, icon: 'event-featured', sentence: on ? `An admin featured ${ev}.` : `An admin stopped featuring ${ev}.` };
    case 'event_cancelled': return { ...base, icon: 'event-cancelled', sentence: `An admin cancelled ${ev}.` };
    case 'event_submitted': return { ...base, icon: 'event-submitted', sentence: by === 'admin' ? `An admin submitted ${ev} for review.` : `${cap(ev)} was submitted for review.` };
    case 'job_approved': return { ...base, icon: 'job-published', sentence: `An admin published ${job}.` };
    case 'job_rejected': return { ...base, icon: 'job-returned', sentence: `An admin sent ${job} back to its host.` };
    case 'job_unpublished': return { ...base, icon: 'job-unpublished', sentence: `An admin unpublished ${job}.` };
    case 'job_submitted': return { ...base, icon: 'job-submitted', sentence: `${cap(job)} was submitted for review.`, dated_by: 'last_change' };
    case 'job_closed': return { ...base, icon: 'job-closed', sentence: `${cap(job)} was closed.`, dated_by: 'last_change' };
    case 'circle_created': return { ...base, icon: 'circle-created', sentence: `An admin created ${circle}.` };
    case 'circle_published': return { ...base, icon: 'circle-published', sentence: `An admin published ${circle}.` };
    case 'circle_unpublished': return { ...base, icon: 'circle-unpublished', sentence: `An admin unpublished ${circle}.` };
    case 'circle_featured': return { ...base, icon: 'circle-featured', sentence: on ? `An admin featured ${circle}.` : `An admin stopped featuring ${circle}.` };
    case 'registrations': {
      const n = Number(r.n) || 0;
      return { ...base, icon: 'registrations', count: n, sentence: `${n} ${n === 1 ? 'registration' : 'registrations'} for ${ev} on ${isoOf(r.at).slice(0, 10)}.` };
    }
    case 'expert_verified': return { ...base, icon: 'expert-verified', sentence: 'An admin verified a wellbeing expert.' };
    case 'expert_unverified': return { ...base, icon: 'expert-unverified', sentence: 'An admin removed a wellbeing expert’s verification.' };
    case 'expert_hidden': return { ...base, icon: 'expert-hidden', sentence: 'An admin hid a wellbeing expert from the directory.' };
    case 'expert_restored': return { ...base, icon: 'expert-restored', sentence: 'An admin restored a wellbeing expert to the directory.' };
    default: return { ...base, icon: 'activity', sentence: by === 'admin' ? 'An admin made a change.' : 'A change was made.' };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function binds(q: ActivityQuery): unknown[] {
  const like = likeNeedleLower(q.q, 1);
  const admin = q.kind === 'admin' ? 1 : null;
  return [q.from, q.from, q.to, q.to, like, like, admin];
}

const UNREADABLE = (src: ActivitySource, e: unknown) =>
  `The ${src.replace('_', ' ')} store could not be read: ${(e as Error)?.message || 'unknown'}.`;

/** The read. Each source is asked for its first `offset + limit` rows and its count, alone. */
export async function communityActivity(env: Env, q: ActivityQuery) {
  const sources = sourcesFor(q.kind);
  const window = q.offset + q.limit;
  const b = binds(q);
  const answers = await Promise.all(sources.map(async (src) => {
    try {
      const [rows, count] = await Promise.all([
        env.DB.prepare(ROWS_SQL[src]).bind(...b, window).all<Raw & { tiebreak: number }>(),
        env.DB.prepare(COUNT_SQL[src]).bind(...b).first<{ n: number }>(),
      ]);
      return { src, ok: true as const, rows: (rows.results || []).map((r) => ({ row: shapeRow(src, r), tie: Number(r.tiebreak) || 0 })), n: Number(count?.n) || 0 };
    } catch (e) {
      return { src, ok: false as const, reason: UNREADABLE(src, e) };
    }
  }));

  const merged = answers.flatMap((a) => (a.ok ? a.rows.map((r) => ({ ...r, src: a.src })) : []))
    .sort((x, y) => (y.row.at.localeCompare(x.row.at)) || (ACTIVITY_SOURCES.indexOf(x.src) - ACTIVITY_SOURCES.indexOf(y.src)) || (y.tie - x.tie));
  const ok = answers.filter((a) => a.ok);
  return {
    rows: merged.slice(q.offset, q.offset + q.limit).map((m) => m.row),
    total: ok.reduce((t, a) => t + (a.ok ? a.n : 0), 0),
    limit: q.limit,
    offset: q.offset,
    filters: { kind: q.kind, from: q.from, to: q.to, q: q.q },
    sources: ok.map((a) => a.src),
    unreadable: answers.flatMap((a) => (a.ok ? [] : [{ source: a.src, reason: a.reason }])),
    definition: 'The newest community items: admins’ acts on events, jobs, circles and wellbeing experts, events submitted for review, '
      + 'job postings waiting for review or closed (dated by their last change), and registrations counted per event per day. '
      + 'No member is named; an admin is “An admin”.',
  };
}
