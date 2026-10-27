/**
 * D1291 (#3387, part 1 of #2383) — the content queue's read: what the
 * canvas's Pipeline board and list (ART1, ART2) and its Calendar (ART7) draw.
 *
 * STAGES. An article's stage is its status, except that `approved` splits in
 * two: `ready` (approved, no `publish_at`) and `scheduled` (approved, with a
 * `publish_at` the per-minute cron publishes at, D484). The default view,
 * `open`, is the same rows the queue always showed: submitted, in review,
 * changes requested and approved (now ready or scheduled).
 *
 * ONE STATEMENT, EVERY VALUE BOUND. The filters are `(? IS NULL OR …)`
 * predicates and the sort is a bound CASE key, so no filter or sort ever
 * splices text into the SQL (`schema_guards`). The old handler built its
 * WHERE by interpolation; this one does not.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A stage with no articles is a measured 0;
 * a stage whose waiting time has no recorded start (changes requested: no
 * column records when they were asked for) says so instead of a number. The
 * counts and the Publications chips are blocks of their own: one that fails
 * says `unreadable` and leaves the rows standing.
 */
import type { Env } from '../types';

export const STAGES = ['submitted', 'in_review', 'changes_requested', 'ready', 'scheduled', 'published', 'rejected'] as const;
export type Stage = typeof STAGES[number];
/** `open` is the review queue (the default); `calendar` is what goes out; `all` is every stage. */
const VIEWS = ['open', 'calendar', 'all'] as const;
export const SORTS = ['waiting', 'newest', 'goes_out', 'rounds', 'title'] as const;
const STATUSES = ['draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'published', 'rejected'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** The calendar reads at most a quarter at once; a week and a month both fit. */
export const MAX_RANGE_DAYS = 92;

export interface QueueQuery {
  status: string | null;
  stage: string;
  q: string | null;
  author: number | null;
  profile: string | null;
  sector: string | null;
  reviewer: number | null;
  submittedFrom: string | null;
  submittedTo: string | null;
  openComments: 0 | 1 | null;
  sort: string;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}

type Parsed = { ok: true; query: QueueQuery } | { ok: false; code: string; error: string };

const day = (s: string | null): string | null | false => {
  if (s == null || s === '') return null;
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : false;
};
const id = (s: string | null): number | null | false => {
  if (s == null || s === '') return null;
  return /^[1-9]\d{0,14}$/.test(s) ? Number(s) : false;
};
const span = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

/** The query string, checked. A bad value is refused with its name, never ignored or guessed. */
export function parseQueueQuery(p: URLSearchParams, limit: number, offset: number): Parsed {
  const bad = (code: string, error: string): Parsed => ({ ok: false, code, error });
  const status = p.get('status') || null;
  if (status && !STATUSES.includes(status)) return bad('invalid_status', 'status is not an article status');
  const from = day(p.get('from')), to = day(p.get('to'));
  if (from === false || to === false) return bad('invalid_range', 'from and to are dates, YYYY-MM-DD');
  if ((from == null) !== (to == null)) return bad('invalid_range', 'from and to go together');
  if (from && to && (from > to || span(from, to) > MAX_RANGE_DAYS)) return bad('invalid_range', `from must not be after to, and the range is at most ${MAX_RANGE_DAYS} days`);
  const stage = p.get('stage') || (from ? 'calendar' : 'open');
  if (!(STAGES as readonly string[]).includes(stage) && !(VIEWS as readonly string[]).includes(stage)) return bad('invalid_stage', 'stage is not a queue stage');
  const sort = p.get('sort') || 'waiting';
  if (!(SORTS as readonly string[]).includes(sort)) return bad('invalid_sort', 'sort is not a queue sort');
  const author = id(p.get('author')), reviewer = id(p.get('reviewer'));
  if (author === false || reviewer === false) return bad('invalid_filter', 'author and reviewer are user ids');
  const submittedFrom = day(p.get('submitted_from')), submittedTo = day(p.get('submitted_to'));
  if (submittedFrom === false || submittedTo === false) return bad('invalid_filter', 'submitted_from and submitted_to are dates, YYYY-MM-DD');
  const oc = p.get('open_comments');
  if (oc != null && oc !== '' && oc !== '0' && oc !== '1') return bad('invalid_filter', 'open_comments is 1 or 0');
  const text = (k: string, max: number) => { const v = (p.get(k) || '').trim(); return v ? v.slice(0, max) : null; };
  return { ok: true, query: {
    status, stage, sort, from, to, author, reviewer, submittedFrom, submittedTo, limit, offset,
    q: text('q', 120), profile: text('profile', 40), sector: text('sector', 80),
    openComments: oc === '1' ? 1 : oc === '0' ? 0 : null,
  } };
}

/** A LIKE pattern that matches the words as typed: `%` and `_` are literal. */
const like = (s: string | null) => (s == null ? null : `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

/**
 * Each article with its stage, its open comments, its rounds (one per
 * submission, `article_submission_log`) and the day it goes out: `publish_at`
 * while scheduled, `published_at` once published. The page of rows and the
 * total that matches come from one statement.
 */
export async function queueRows(env: Env, q: QueueQuery) {
  const res = await env.DB.prepare(`WITH base AS (
  SELECT a.id, a.slug, a.title, a.status, a.author_user_id, a.submitted_at, a.reviewed_at, a.approved_at,
         a.updated_at, a.word_count, a.read_minutes, a.views, a.sector, a.publish_at, a.published_at,
         a.reviewer_user_id, u.name AS author_name, u.email AS author_email, u.role AS author_role,
         r.name AS reviewer_name,
         CASE WHEN a.status = 'approved' AND a.publish_at IS NOT NULL THEN 'scheduled'
              WHEN a.status = 'approved' THEN 'ready' ELSE a.status END AS stage,
         (SELECT COUNT(*) FROM article_review_comments c WHERE c.article_id = a.id AND c.resolved_at IS NULL) AS open_comments,
         (SELECT COUNT(*) FROM article_submission_log l WHERE l.article_id = a.id) AS rounds,
         CASE WHEN a.status = 'published' THEN a.published_at WHEN a.status = 'approved' THEN a.publish_at END AS goes_out
    FROM articles a
    LEFT JOIN users u ON u.id = a.author_user_id
    LEFT JOIN users r ON r.id = a.reviewer_user_id
)
SELECT base.*, COUNT(*) OVER () AS total_rows FROM base
 WHERE (? IS NULL OR status = ?)
   AND (? = 'all'
        OR (? = 'open' AND stage IN ('submitted', 'in_review', 'changes_requested', 'ready', 'scheduled'))
        OR (? = 'calendar' AND stage IN ('scheduled', 'published'))
        OR stage = ?)
   AND (? IS NULL OR title LIKE ? ESCAPE '\\' OR author_name LIKE ? ESCAPE '\\')
   AND (? IS NULL OR author_user_id = ?)
   AND (? IS NULL OR author_role = ?)
   AND (? IS NULL OR sector = ?)
   AND (? IS NULL OR reviewer_user_id = ?)
   AND (? IS NULL OR substr(submitted_at, 1, 10) >= ?)
   AND (? IS NULL OR substr(submitted_at, 1, 10) <= ?)
   AND (? IS NULL OR (? = 1 AND open_comments > 0) OR (? = 0 AND open_comments = 0))
   AND (? IS NULL OR substr(goes_out, 1, 10) >= ?)
   AND (? IS NULL OR substr(goes_out, 1, 10) <= ?)
 ORDER BY
   CASE WHEN ? = 'goes_out' THEN goes_out IS NULL END,
   CASE WHEN ? = 'goes_out' THEN goes_out END ASC,
   CASE WHEN ? = 'rounds' THEN rounds END DESC,
   CASE WHEN ? = 'title' THEN title COLLATE NOCASE END ASC,
   CASE WHEN ? = 'newest' THEN COALESCE(submitted_at, updated_at) END DESC,
   COALESCE(submitted_at, updated_at) ASC, id ASC
 LIMIT ? OFFSET ?`).bind(
    q.status, q.status,
    q.stage, q.stage, q.stage, q.stage,
    q.q, like(q.q), like(q.q),
    q.author, q.author,
    q.profile, q.profile,
    q.sector, q.sector,
    q.reviewer, q.reviewer,
    q.submittedFrom, q.submittedFrom,
    q.submittedTo, q.submittedTo,
    q.openComments, q.openComments, q.openComments,
    q.from, q.from,
    q.to, q.to,
    q.sort, q.sort, q.sort, q.sort, q.sort,
    q.limit, q.offset,
  ).all<any>();
  const rows = res.results ?? [];
  // The window's total rides on every row; an empty page past the end reads the count alone.
  let total = rows.length ? Number(rows[0].total_rows) : null;
  if (total == null) total = q.offset > 0 ? await countOnly(env, q) : 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total };
}

/** The total for a page past the end, by the same predicate. */
async function countOnly(env: Env, q: QueueQuery): Promise<number> {
  const r = await queueRows(env, { ...q, offset: 0, limit: 1 });
  return r.total;
}

/** When a stage's wait began, or null where no column records it. */
const SINCE: Record<Stage, string | null> = {
  submitted: 'submitted_at',
  in_review: 'reviewed_at',
  changes_requested: null,
  ready: 'approved_at',
  scheduled: 'approved_at',
  published: null,
  rejected: null,
};
const WAIT_REASON: Partial<Record<Stage, string>> = {
  changes_requested: 'No column records when changes were requested',
  published: 'A published article is not waiting',
  rejected: 'A rejected article is not waiting',
};

/**
 * Counts per stage over the whole table, whatever the filters, with when the
 * longest wait in each stage began. A stage with none is a measured 0.
 */
export async function stageCounts(env: Env, now = Date.now()) {
  const res = await env.DB.prepare(`WITH s AS (
  SELECT CASE WHEN status = 'approved' AND publish_at IS NOT NULL THEN 'scheduled'
              WHEN status = 'approved' THEN 'ready' ELSE status END AS stage,
         submitted_at, reviewed_at, approved_at
    FROM articles
)
SELECT stage, COUNT(*) AS n, MIN(submitted_at) AS min_submitted, MIN(reviewed_at) AS min_reviewed, MIN(approved_at) AS min_approved
  FROM s GROUP BY stage`).all<{ stage: string; n: number; min_submitted: string | null; min_reviewed: string | null; min_approved: string | null }>();
  const by = new Map((res.results ?? []).map((r) => [r.stage, r]));
  const col = { submitted_at: 'min_submitted', reviewed_at: 'min_reviewed', approved_at: 'min_approved' } as const;
  const stages = Object.fromEntries(STAGES.map((s) => {
    const r = by.get(s);
    const n = Number(r?.n ?? 0);
    const key = SINCE[s];
    const since = key && r ? (r as any)[col[key as keyof typeof col]] as string | null : null;
    const t = since ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(since) ? since : `${since.replace(' ', 'T')}Z`) : NaN;
    return [s, {
      count: n,
      oldest_since: n && Number.isFinite(t) ? since : null,
      oldest_hours: n && Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 3_600_000)) : null,
      // Why there is no age: an empty stage has nothing waiting; some stages record no start.
      oldest_reason: !n ? 'Nothing in this stage' : !key ? WAIT_REASON[s] ?? 'Not recorded' : Number.isFinite(t) ? null : 'Not recorded',
    }];
  }));
  return { available: true as const, reason: null, stages, total: Object.values(stages).reduce((a, s) => a + s.count, 0) };
}

/** The calendar's Publications chips: what went out on `published_at` in the range. */
export async function publicationChips(env: Env, from: string, to: string) {
  const res = await env.DB.prepare(
    `SELECT id, slug, title, published_at FROM admin_publications
      WHERE status = 'published' AND published_at IS NOT NULL
        AND substr(published_at, 1, 10) >= ? AND substr(published_at, 1, 10) <= ?
      ORDER BY published_at, id LIMIT 200`,
  ).bind(from, to).all<{ id: number; slug: string; title: string; published_at: string }>();
  return { available: true as const, reason: null, items: res.results ?? [] };
}

