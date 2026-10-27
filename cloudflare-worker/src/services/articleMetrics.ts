/**
 * D1294 (#3390, part 4 of #2383) — what Authors and Performance read: the
 * daily view count, the authors read, the performance read and the followers
 * each publish reached (migration 637).
 *
 * DAILY VIEWS HOLD NO PERSONAL DATA. One row per article per UTC day, counted
 * on the public read only (`GET /api/articles/:slug`), as `public_pageviews`
 * is: no IP, user agent, cookie, account or referrer is stored or read for
 * it. A read by an admin, by the article's author or in an impersonated
 * session is not counted; the caller's token is read only to tell that, and
 * nothing of it is kept.
 *
 * NEVER A ZERO FOR A MISSING VALUE. Before the first daily row there is no
 * daily count at all, so a week that ends before it reads `null` (Not
 * recorded, with `views_reason`), never 0; a week it starts in is partial and
 * says so. A median with no decision behind it is null. Every statement is
 * bound; names are read for the admin, never logged.
 */
import type { Env } from '../types';
import { SUBMISSIONS_PER_WEEK } from './newsSchema';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** The UTC day of an instant, as YYYY-MM-DD: the day boundary is midnight UTC. */
export const viewDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** The day of a stored stamp, either 'YYYY-MM-DD HH:MM:SS' or ISO; null when unreadable. */
const dayOf = (raw: unknown): string | null => {
  const s = typeof raw === 'string' ? raw.slice(0, 10) : '';
  return DAY_RE.test(s) ? s : null;
};
const msOf = (raw: unknown): number | null => {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const ms = Date.parse(/([zZ]|[+-]\d{2}:\d{2})$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ms) ? ms : null;
};
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** The Monday (UTC) on or before a day. */
export const weekOf = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
};

export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const hours = (ms: number | null) => (ms == null ? null : Math.round((ms / 3_600_000) * 10) / 10);

/** Who is reading, from their token, only to leave admins, authors and impersonated sessions out of the count. */
export type Viewer = { userId: number | null; role: string | null; impersonated: boolean } | null;

/**
 * Count one public read of a published article on today's UTC row. Not
 * counted: an admin, the article's own author, an impersonated session. The
 * insert selects the article by its slug and status, so an unpublished or
 * missing slug writes nothing.
 */
export async function countDailyView(env: Env, slug: string, viewer: Viewer, now: Date = new Date()): Promise<boolean> {
  if (viewer && (viewer.impersonated || String(viewer.role || '').toLowerCase() === 'admin')) return false;
  // The article is chosen in a subquery so the upsert's conflict columns are
  // read as the daily table's, and `WHERE true` keeps SQLite's upsert parse
  // unambiguous after a SELECT.
  const res = await env.DB.prepare(
    `INSERT INTO article_daily_views (article_id, day, views)
     SELECT p.id, ?, 1 FROM (SELECT id FROM articles WHERE slug = ? AND status = 'published' AND author_user_id IS NOT ?) p WHERE true
     ON CONFLICT(article_id, day) DO UPDATE SET views = views + 1`,
  ).bind(viewDay(now), slug, viewer?.userId ?? null).run();
  return Number(res?.meta?.changes ?? 0) > 0;
}

/** Record one publish's follower reach. Best-effort: a failure here never fails the publish. */
export async function recordFollowerReach(env: Env, articleId: number, publishedAt: string, followers: number, notified: number): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO article_follower_reach (article_id, published_at, followers, notified) VALUES (?, ?, ?, ?)',
    ).bind(articleId, publishedAt, followers, Math.min(notified, followers)).run();
  } catch {
    console.warn('[articleMetrics] follower reach not recorded');
  }
}

/** The first day with a daily count, or null when none has been counted yet. */
async function recordedSince(env: Env): Promise<string | null> {
  const r = await env.DB.prepare('SELECT MIN(day) AS d FROM article_daily_views').first<{ d: string | null }>();
  return r?.d ?? null;
}

export const NOT_RECORDED_YET = 'Not recorded: no view has been counted per day yet. Views were one all-time total per article until migration 637.';
export const recordedFrom = (since: string) => `Views per day are counted from ${since}. Before it there is one all-time total per article, so earlier weeks are not recorded.`;

/** The canvas's "Not recorded" blocks this read does not serve: each needs a reader-analytics decision first. */
export const READER_ANALYTICS = Object.freeze({
  unique_readers: 'Nothing counts readers, only page loads. It needs a reader-analytics decision first.',
  read_through: 'How far people read is not measured. It needs a reader-analytics decision first.',
  sources: 'Where readers came from is not stored: daily views keep no referrer. It needs a reader-analytics decision first.',
  newsletter_clicks: 'Newsletter clicks are not counted per article. It needs a reader-analytics decision first.',
});

type ArticleRow = {
  id: number; author_user_id: number; status: string; views: number | null; sector: string | null; title: string;
  submitted_at: string | null; approved_at: string | null; rejected_at: string | null; published_at: string | null; read_minutes: number | null;
};

/**
 * One decided article's time from its latest submission to its decision, in
 * ms, or null. A decision older than the latest submission (an approved
 * article sent back by an edit) times nothing: it answered an earlier one.
 */
function decisionMs(a: ArticleRow): { at: string; ms: number; kind: 'approved' | 'rejected' } | null {
  const sub = msOf(a.submitted_at);
  const decidedAt = a.approved_at || (a.status === 'rejected' ? a.rejected_at : null);
  const dec = msOf(decidedAt);
  if (sub == null || dec == null || dec < sub) return null;
  return { at: decidedAt as string, ms: dec - sub, kind: a.approved_at ? 'approved' : 'rejected' };
}

/** The 7-day window the submission cap counts (routes/articles.ts): the same space-form stamp. */
const weekAgoStamp = (now: Date) => new Date(now.getTime() - 7 * DAY_MS).toISOString().replace('T', ' ').slice(0, 19);

/**
 * `GET /api/admin/articles/authors`: each author with an article past draft —
 * counts by stage, all-time views, followers, this week's submissions against
 * the cap, the approval count, and the median time to a decision. No email.
 */
export async function authorsRead(env: Env, now: Date = new Date()) {
  const articles = ((await env.DB.prepare(
    `SELECT id, author_user_id, status, views, sector, title, submitted_at, approved_at, rejected_at, published_at, read_minutes
       FROM articles WHERE status <> 'draft'`,
  ).all<ArticleRow>()).results || []);
  const weekAgo = weekAgoStamp(now);
  const subs = ((await env.DB.prepare(
    `SELECT author_id, SUM(CASE WHEN submitted_at >= ? THEN 1 ELSE 0 END) AS week, MAX(submitted_at) AS last_at, MIN(submitted_at) AS first_at
       FROM article_submission_log GROUP BY author_id`,
  ).bind(weekAgo).all<{ author_id: number; week: number; last_at: string | null; first_at: string | null }>()).results || []);
  let followers: Array<{ entity_id: number; n: number }> = [];
  let followersRead = true;
  try {
    followers = ((await env.DB.prepare(
      `SELECT entity_id, COUNT(*) AS n FROM follows WHERE entity_type = 'user' AND follower_user_id <> entity_id GROUP BY entity_id`,
    ).all<{ entity_id: number; n: number }>()).results || []);
  } catch { followersRead = false; }
  const ids = [...new Set(articles.map((a) => Number(a.author_user_id)))];
  const users = ids.length ? ((await env.DB.prepare(
    'SELECT id, name, role FROM users WHERE id IN (SELECT value FROM json_each(?))',
  ).bind(JSON.stringify(ids)).all<{ id: number; name: string | null; role: string | null }>()).results || []) : [];
  const userOf = new Map(users.map((u) => [Number(u.id), u]));
  const subOf = new Map(subs.map((s) => [Number(s.author_id), s]));
  const folOf = new Map(followers.map((f) => [Number(f.entity_id), Number(f.n)]));
  const ninetyAgo = viewDay(new Date(now.getTime() - 90 * DAY_MS));

  const authors = ids.map((id) => {
    const mine = articles.filter((a) => Number(a.author_user_id) === id);
    const stages: Record<string, number> = {};
    for (const a of mine) stages[a.status] = (stages[a.status] || 0) + 1;
    const approved = mine.filter((a) => a.approved_at).length;
    const rejected = mine.filter((a) => !a.approved_at && a.status === 'rejected').length;
    const times = mine.map(decisionMs).filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.ms);
    const s = subOf.get(id);
    const used = Number(s?.week ?? 0);
    const u = userOf.get(id);
    return {
      user_id: id,
      name: u?.name ?? null,
      role: u?.role ?? null,
      stages,
      published: stages.published || 0,
      waiting: (stages.submitted || 0) + (stages.in_review || 0),
      rejected: stages.rejected || 0,
      views_all_time: mine.reduce((n, a) => n + (Number(a.views) || 0), 0),
      followers: followersRead ? (folOf.get(id) ?? 0) : null,
      this_week: { used, limit: SUBMISSIONS_PER_WEEK, at_limit: used >= SUBMISSIONS_PER_WEEK },
      last_submitted_at: s?.last_at ?? null,
      first_submitted_at: s?.first_at ?? null,
      approval: { approved, decided: approved + rejected },
      median_hours_to_decision: hours(median(times)),
      decisions_timed: times.length,
    };
  }).sort((a, b) => b.published - a.published || String(a.name || '').localeCompare(String(b.name || '')));

  const publishedAuthors = new Set(authors.filter((a) => a.published > 0).map((a) => a.user_id));
  return {
    authors,
    summary: {
      with_published: publishedAuthors.size,
      new_last_90_days: authors.filter((a) => a.first_submitted_at && String(a.first_submitted_at).slice(0, 10) >= ninetyAgo).length,
      waiting_from_first_time: articles.filter((a) => ['submitted', 'in_review'].includes(a.status) && !publishedAuthors.has(Number(a.author_user_id))).length,
      at_weekly_limit: authors.filter((a) => a.this_week.at_limit).length,
    },
    submissions_per_week: SUBMISSIONS_PER_WEEK,
    followers_read: followersRead,
    views_note: 'Views, all time: one total per article, counting every page load, admins’ and repeats included, since before daily views.',
  };
}

export class MetricsRefusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

export const PERFORMANCE_MAX_DAYS = 400;

/** The range a performance read asks for: YYYY-MM-DD both ends, at most 400 days; by default the last 12 weeks to today. */
export function rangeOf(from: string | undefined, to: string | undefined, now: Date = new Date()): { from: string; to: string } {
  const end = to ?? viewDay(now);
  const start = from ?? addDays(weekOf(end), -7 * 11);
  if (!DAY_RE.test(start) || !DAY_RE.test(end) || Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || Number.isNaN(Date.parse(`${end}T00:00:00Z`))) {
    throw new MetricsRefusal(400, 'invalid_range', 'Give from and to as YYYY-MM-DD.');
  }
  if (start > end) throw new MetricsRefusal(400, 'invalid_range', 'from must be on or before to.');
  if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS > PERFORMANCE_MAX_DAYS) {
    throw new MetricsRefusal(400, 'range_too_long', `Ask for at most ${PERFORMANCE_MAX_DAYS} days.`);
  }
  return { from: start, to: end };
}

/**
 * `GET /api/admin/articles/performance?from=&to=`: per Monday week, the
 * articles published, submitted and decided, and the views counted that week;
 * views by sector and the top articles over the range; the median time to a
 * decision; and the followers the range's publishes reached.
 */
export async function performanceRead(env: Env, fromQ: string | undefined, toQ: string | undefined, now: Date = new Date()) {
  const { from, to } = rangeOf(fromQ, toQ, now);
  const since = await recordedSince(env);
  const inRange = (d: string | null) => !!d && d >= from && d <= to;

  const articles = ((await env.DB.prepare(
    `SELECT id, author_user_id, status, views, sector, title, submitted_at, approved_at, rejected_at, published_at, read_minutes
       FROM articles
      WHERE substr(published_at, 1, 10) BETWEEN ? AND ? OR substr(approved_at, 1, 10) BETWEEN ? AND ? OR substr(rejected_at, 1, 10) BETWEEN ? AND ?`,
  ).bind(from, to, from, to, from, to).all<ArticleRow>()).results || []);
  const submitted = ((await env.DB.prepare(
    'SELECT substr(submitted_at, 1, 10) AS day, COUNT(*) AS n FROM article_submission_log WHERE substr(submitted_at, 1, 10) BETWEEN ? AND ? GROUP BY day',
  ).bind(from, to).all<{ day: string; n: number }>()).results || []);
  const changes = ((await env.DB.prepare(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM article_revisions WHERE reason = 'request_changes' AND substr(created_at, 1, 10) BETWEEN ? AND ? GROUP BY day",
  ).bind(from, to).all<{ day: string; n: number }>()).results || []);
  const daily = ((await env.DB.prepare(
    'SELECT v.day, v.article_id, v.views FROM article_daily_views v WHERE v.day BETWEEN ? AND ?',
  ).bind(from, to).all<{ day: string; article_id: number; views: number }>()).results || []);
  const reach = ((await env.DB.prepare(
    'SELECT COUNT(*) AS publishes, COALESCE(SUM(notified), 0) AS notified, COALESCE(SUM(followers), 0) AS followers FROM article_follower_reach WHERE substr(published_at, 1, 10) BETWEEN ? AND ?',
  ).bind(from, to).first<{ publishes: number; notified: number; followers: number }>()));

  // The weeks, Monday first, that touch the range.
  const weeks: Array<Record<string, any>> = [];
  for (let w = weekOf(from); w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    const lo = w < from ? from : w;
    const hi = end > to ? to : end;
    const viewsKnown = since != null && hi >= since;
    weeks.push({
      week: w, from: lo, to: hi,
      published: 0, submitted: 0, approved: 0, rejected: 0, changes_requested: 0,
      views: viewsKnown ? 0 : null,
      views_partial: viewsKnown && lo < (since as string),
    });
  }
  const weekFor = (d: string | null) => (d ? weeks.find((x) => d >= x.from && d <= x.to) : undefined);
  for (const a of articles) {
    if (inRange(dayOf(a.published_at))) { const x = weekFor(dayOf(a.published_at)); if (x) x.published += 1; }
    if (inRange(dayOf(a.approved_at))) { const x = weekFor(dayOf(a.approved_at)); if (x) x.approved += 1; }
    // A rejection that week is a decision that week, even if the article was approved later (its latest rejection is kept).
    if (inRange(dayOf(a.rejected_at))) { const x = weekFor(dayOf(a.rejected_at)); if (x) x.rejected += 1; }
  }
  for (const s of submitted) { const x = weekFor(s.day); if (x) x.submitted += Number(s.n); }
  for (const s of changes) { const x = weekFor(s.day); if (x) x.changes_requested += Number(s.n); }
  for (const v of daily) { const x = weekFor(v.day); if (x && x.views != null) x.views += Number(v.views); }

  // Views by sector and the top articles, from the daily rows only.
  const byArticle = new Map<number, number>();
  for (const v of daily) byArticle.set(Number(v.article_id), (byArticle.get(Number(v.article_id)) || 0) + Number(v.views));
  const ids = [...byArticle.keys()];
  const meta = ids.length ? ((await env.DB.prepare(
    `SELECT a.id, a.title, a.sector, a.published_at, a.read_minutes, u.name AS author_name
       FROM articles a LEFT JOIN users u ON u.id = a.author_user_id WHERE a.id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(ids)).all<any>()).results || []) : [];
  const metaOf = new Map(meta.map((m: any) => [Number(m.id), m]));
  const sectors = new Map<string, number>();
  for (const [id, n] of byArticle) {
    const key = metaOf.get(id)?.sector || 'No sector';
    sectors.set(key, (sectors.get(key) || 0) + n);
  }
  const viewsRecorded = since != null && to >= since;
  const decided = articles.map(decisionMs).filter((x): x is NonNullable<typeof x> => !!x && inRange(dayOf(x.at)));
  return {
    from, to,
    views_recorded_since: since,
    views_reason: since == null ? NOT_RECORDED_YET : recordedFrom(since),
    weeks,
    views_by_sector: viewsRecorded
      ? [...sectors.entries()].map(([sector, views]) => ({ sector, views })).sort((a, b) => b.views - a.views)
      : null,
    top_articles: viewsRecorded
      ? [...byArticle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, views]) => {
        const m = metaOf.get(id) || {};
        return { id, title: m.title ?? null, author_name: m.author_name ?? null, published_at: m.published_at ?? null, read_minutes: m.read_minutes ?? null, views };
      })
      : null,
    decisions: {
      median_hours_to_decision: hours(median(decided.map((d) => d.ms))),
      timed: decided.length,
      note: 'From an article’s latest submission to its approval or rejection. A change request is counted per week but not timed: the submission it answered is not kept once the author resubmits.',
    },
    follower_reach: {
      publishes_recorded: Number(reach?.publishes ?? 0),
      followers: Number(reach?.followers ?? 0),
      notified: Number(reach?.notified ?? 0),
      note: 'Recorded for each publish from migration 637 on. A publish before it has no reach recorded.',
    },
    not_recorded: READER_ANALYTICS,
  };
}
