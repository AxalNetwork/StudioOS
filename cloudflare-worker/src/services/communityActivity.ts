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

/** The consoles a row links to. Wellbeing has its own console at /admin/wellbeing (D1121). */
export const CONSOLE_HREF: Record<ActivityRow['kind'], string> = {
  events: '/admin/events',
  jobs: '/admin/jobs',
  circles: '/admin/circles',
  wellbeing: '/admin/wellbeing',
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
 * The sources, as ARMS (#4717 package 5). A source is one or two arms, and
 * each arm is its own statement with every filter INSIDE it: the window, the
 * title search and the admin filter are on the arm's own columns, before any
 * UNION or GROUP BY, so an index can answer them and a row outside the window
 * is never read. The arms used to be one UNION per source wrapped in an outer
 * query that filtered and sorted the result, so every request read every
 * row of history, and registrations were grouped across all time before the
 * window was applied.
 *
 * A filter that is absent is absent from the text: `(? IS NULL OR …)` cannot
 * use an index. Each statement is built once from fixed fragments below and
 * held in a map; every value is bound.
 *
 * Indexes (migration 202611070900): `admin_audit_log (report_type,
 * datetime(exported_at), action)` and `(action, datetime(exported_at))`, and
 * `event_registrations (date(registered_at), event_id, datetime(registered_at))`.
 * Query plans are pinned by `community_reads_4717.test.ts`.
 * ------------------------------------------------------------------ */

type ArmFlags = { from: boolean; to: boolean; q: boolean; admin: boolean };
type Arm = {
  /** The arm's `at` column, the thing the window and the order are on. */
  at: string;
  /** SELECT … FROM … JOINs, without WHERE. */
  from: string;
  /** The arm's own fixed WHERE terms. */
  where: string[];
  /** The title the search reads; NULL for a source without one. */
  title: string;
  /** The order's tiebreak after the time. */
  order: string;
  /** With `admin`: a term that keeps admins' acts, or `skip` when the arm has none. */
  admin: string | 'all' | 'skip';
};

const EVENT_ACTS = `('event_approved', 'event_rejected', 'event_unpublished', 'event_featured', 'event_cancelled')`;

const ARMS: Record<Exclude<ActivitySource, 'event_registrations'>, Arm[]> = {
  events: [
    {
      at: 'a.exported_at',
      from: `SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, e.title AS title,
         json_extract(a.filters_json, '$.featured') AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN events e ON e.id = json_extract(a.filters_json, '$.event_id')`,
      where: [`a.report_type = 'events'`, `a.action IN ${EVENT_ACTS}`],
      title: 'e.title', order: 'a.id DESC', admin: 'all',
    },
    {
      at: 'a.exported_at',
      from: `SELECT CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END AS actor, a.action AS action, a.exported_at AS at,
         e.title AS title, NULL AS featured, a.id AS tiebreak
    FROM admin_audit_log a
    LEFT JOIN events e ON e.id = json_extract(a.filters_json, '$.event_id')
    LEFT JOIN users u ON u.id = a.admin_user_id`,
      where: [`a.action = 'event_submitted'`],
      title: 'e.title', order: 'a.id DESC', admin: `u.role = 'admin'`,
    },
  ],
  jobs: [
    {
      at: 'a.exported_at',
      from: `SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, j.title AS title, NULL AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN job_postings j ON j.id = json_extract(a.filters_json, '$.posting_id')`,
      where: [`a.report_type = 'jobs'`, `a.action IN ('job_approved', 'job_rejected', 'job_unpublished')`],
      title: 'j.title', order: 'a.id DESC', admin: 'all',
    },
    {
      // A host's acts, dated by the posting's last change; never an admin's, so `admin` skips the arm.
      at: 'j.updated_at',
      from: `SELECT 'member' AS actor, CASE WHEN j.status = 'closed' THEN 'job_closed' ELSE 'job_submitted' END AS action,
         j.updated_at AS at, j.title AS title, NULL AS featured, -j.id AS tiebreak
    FROM job_postings j`,
      where: [`j.status IN ('pending_review', 'closed')`],
      title: 'j.title', order: 'j.id ASC', admin: 'skip',
    },
  ],
  circles: [
    {
      at: 'a.exported_at',
      from: `SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, ci.name AS title,
         json_extract(a.filters_json, '$.featured') AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN circles ci ON ci.id = json_extract(a.filters_json, '$.circle_id')`,
      where: [`a.report_type = 'circles'`, `a.action IN ('circle_created', 'circle_published', 'circle_unpublished', 'circle_featured')`],
      title: 'ci.name', order: 'a.id DESC', admin: 'all',
    },
  ],
  wellbeing: [
    {
      at: 'a.exported_at',
      from: `SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, NULL AS title, NULL AS featured, a.id AS tiebreak
    FROM admin_audit_log a`,
      where: [`a.report_type = 'wellbeing'`, `a.action IN ('expert_verified', 'expert_unverified', 'expert_hidden', 'expert_restored', 'expert_declined')`],
      title: 'NULL', order: 'a.id DESC', admin: 'all',
    },
  ],
};

/** The WHERE terms an arm adds for the filters given, in bind order: from, to, then the search. */
function armWhere(arm: Arm, f: ArmFlags): string {
  const terms = [...arm.where];
  if (f.from) terms.push(`datetime(${arm.at}) >= datetime(?)`);
  if (f.to) terms.push(`datetime(${arm.at}) < datetime(?, '+1 day')`);
  if (f.q) terms.push(`lower(coalesce(${arm.title}, '')) LIKE ? ESCAPE '\\'`);
  if (f.admin && arm.admin !== 'all' && arm.admin !== 'skip') terms.push(arm.admin);
  return terms.join('\n     AND ');
}

const armRowsSql = (arm: Arm, f: ArmFlags) =>
  `${arm.from}\n   WHERE ${armWhere(arm, f)}\n   ORDER BY datetime(${arm.at}) DESC, ${arm.order} LIMIT ?`;
/**
 * A count of what a select returns. The one place this wrapper is written:
 * `scripts/check-sqlite-columns.mjs` counts every SQL string it cannot read
 * (a spliced fragment) and fails the build at 500 (`schema_guards.test.mjs`),
 * so the dynamic SQL here is kept to the fewest strings it takes, not one per
 * wrapper. Every value is still bound; only fixed fragments are spliced.
 */
const countOf = (select: string) => `SELECT COUNT(*) AS n FROM (${select})`;
const armCountSql = (arm: Arm, f: ArmFlags) => countOf(`${arm.from}\n   WHERE ${armWhere(arm, f)}`);

/*
 * Registrations: one row per event per UTC day. The window is a range of days,
 * so it is applied to `date(registered_at)` BEFORE the GROUP BY, and the index
 * on that expression answers it. Unfiltered, the newest N groups lie on the
 * newest N days that have one (each day has at least one group, and a group
 * is dated inside its day), so a first read finds that N-th day from the
 * index and the grouping reads only the days from it on.
 */
const REG_FROM = `FROM event_registrations r JOIN events e ON e.id = r.event_id`;
type RegFlags = { from: boolean; to: boolean; q: boolean };
function regWhere(f: RegFlags & { since: boolean }): string {
  const terms: string[] = [];
  if (f.from) terms.push('date(r.registered_at) >= ?');
  if (f.to) terms.push('date(r.registered_at) <= ?');
  if (f.since) terms.push('date(r.registered_at) >= ?');
  if (f.q) terms.push(`lower(coalesce(e.title, '')) LIKE ? ESCAPE '\\'`);
  return terms.length ? `\n   WHERE ${terms.join(' AND ')}` : '';
}
const regDaysSql = (f: RegFlags) =>
  `SELECT DISTINCT date(r.registered_at) AS d ${REG_FROM}${regWhere({ ...f, since: false })}\n   ORDER BY d DESC LIMIT ?`;
const regRowsSql = (f: RegFlags & { since: boolean }) =>
  `SELECT 'member' AS actor, 'registrations' AS action, MAX(r.registered_at) AS at, e.title AS title,
         COUNT(*) AS n, -MIN(r.id) AS tiebreak
    ${REG_FROM}${regWhere(f)}
   GROUP BY date(r.registered_at), r.event_id
   ORDER BY datetime(at) DESC, tiebreak DESC LIMIT ?`;
const regCountSql = (f: RegFlags) =>
  countOf(['SELECT 1', REG_FROM + regWhere({ ...f, since: false }), 'GROUP BY date(r.registered_at), r.event_id'].join('\n   '));

/** Every statement, built once per shape. */
const SQL = new Map<string, string>();
const sqlOf = (key: string, build: () => string) => {
  let s = SQL.get(key);
  if (s === undefined) { s = build(); SQL.set(key, s); }
  return s;
};

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
    case 'expert_declined': return { ...base, icon: 'expert-declined', sentence: 'An admin declined a wellbeing expert.' };
    default: return { ...base, icon: 'activity', sentence: by === 'admin' ? 'An admin made a change.' : 'A change was made.' };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const UNREADABLE = (src: ActivitySource, e: unknown) =>
  `The ${src.replace('_', ' ')} store could not be read: ${(e as Error)?.message || 'unknown'}.`;

type Ranked = { row: ActivityRow; tie: number };
type Answer = { rows: Ranked[]; n: number };

/** One audit or posting arm: its first `window` rows and its count, every filter inside it. */
async function readArm(env: Env, src: ActivitySource, i: number, arm: Arm, q: ActivityQuery, window: number): Promise<Answer> {
  const f: ArmFlags = { from: q.from !== null, to: q.to !== null, q: q.q !== null, admin: q.kind === 'admin' };
  if (f.admin && arm.admin === 'skip') return { rows: [], n: 0 };
  const key = `${src}.${i}.${Number(f.from)}${Number(f.to)}${Number(f.q)}${Number(f.admin)}`;
  const b = [...(f.from ? [q.from] : []), ...(f.to ? [q.to] : []), ...(f.q ? [likeNeedleLower(q.q, 1)] : [])];
  const [rows, count] = await Promise.all([
    env.DB.prepare(sqlOf(`rows.${key}`, () => armRowsSql(arm, f))).bind(...b, window).all<Raw & { tiebreak: number }>(),
    env.DB.prepare(sqlOf(`count.${key}`, () => armCountSql(arm, f))).bind(...b).first<{ n: number }>(),
  ]);
  return { rows: (rows.results || []).map((r) => ({ row: shapeRow(src, r), tie: Number(r.tiebreak) || 0 })), n: Number(count?.n) || 0 };
}

/**
 * Registrations: the first `window` (event, day) groups and how many there are.
 * Unfiltered by `from`, the grouping starts at the `window`-th newest day that
 * has a registration (read from the index), never at the start of history.
 */
async function readRegistrations(env: Env, q: ActivityQuery, window: number): Promise<Answer> {
  const f: RegFlags = { from: q.from !== null, to: q.to !== null, q: q.q !== null };
  const key = `${Number(f.from)}${Number(f.to)}${Number(f.q)}`;
  const b = [...(f.from ? [q.from] : []), ...(f.to ? [q.to] : []), ...(f.q ? [likeNeedleLower(q.q, 1)] : [])];
  let since: string | null = null;
  if (!f.from) {
    const days = await env.DB.prepare(sqlOf(`reg.days.${key}`, () => regDaysSql(f))).bind(...b, window).all<{ d: string | null }>();
    const ds = (days.results || []).map((r) => r.d);
    // Fewer days than the window, or an undated group among them: every group can be in the page, so read them all.
    if (ds.length === window && ds.every((d) => typeof d === 'string')) since = ds[ds.length - 1] as string;
  }
  const rf = { ...f, since: since !== null };
  // regWhere's order: from, to, since, then the search.
  const rb = [...(f.from ? [q.from] : []), ...(f.to ? [q.to] : []), ...(since !== null ? [since] : []), ...(f.q ? [likeNeedleLower(q.q, 1)] : [])];
  const [rows, count] = await Promise.all([
    env.DB.prepare(sqlOf(`reg.rows.${key}${Number(rf.since)}`, () => regRowsSql(rf))).bind(...rb, window).all<Raw & { tiebreak: number }>(),
    env.DB.prepare(sqlOf(`reg.count.${key}`, () => regCountSql(f))).bind(...b).first<{ n: number }>(),
  ]);
  return { rows: (rows.results || []).map((r) => ({ row: shapeRow('event_registrations', r), tie: Number(r.tiebreak) || 0 })), n: Number(count?.n) || 0 };
}

/** The read. Each source is asked for its first `offset + limit` rows and its count, alone; a source is its arms together. */
export async function communityActivity(env: Env, q: ActivityQuery) {
  const sources = sourcesFor(q.kind);
  const window = q.offset + q.limit;
  const answers = await Promise.all(sources.map(async (src) => {
    try {
      const parts = src === 'event_registrations'
        ? [await readRegistrations(env, q, window)]
        : await Promise.all(ARMS[src].map((arm, i) => readArm(env, src, i, arm, q, window)));
      return { src, ok: true as const, rows: parts.flatMap((p) => p.rows), n: parts.reduce((t, p) => t + p.n, 0) };
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
