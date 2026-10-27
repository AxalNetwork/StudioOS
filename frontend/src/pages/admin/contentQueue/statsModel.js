/**
 * D1297 (#3393, part 7 of #2383) — the Content queue's Authors and
 * Performance tabs (ART9–ART12, ART18), as pure rules so
 * `frontend/test/content_queue_stats_d1297.test.mjs` holds each one.
 *
 * Every figure is D1294's:
 *   - `GET /api/admin/articles/authors` for the authors, their counts and the
 *     summary tiles;
 *   - `GET /api/admin/articles/performance?from=&to=` for the weeks, views by
 *     week and sector, the top articles, the time to a decision and follower
 *     reach.
 * A figure a read does not carry is "Not recorded", with the read's own reason,
 * never a zero. Nothing here sums views: each total is the Worker's or a sum of
 * the weeks it sent.
 */
import { NOT_RECORDED } from '../../../lib/absence';
import { profileName } from '../../trust/memberTrustModel';

export { NOT_RECORDED };

// `Number(null)` is 0, so null and '' are tested first: unknown is never 0.
const int = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n));
const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 Oct 2026" from a D1 stamp or a date; null when it is not one. */
export function dayWord(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "21 Oct" for a week's start. */
export const weekWord = (v) => dayWord(v)?.replace(/ \d{4}$/, '') ?? null;

/** Hours as the canvas says them: "5 hours", "2 days"; null when there is no figure. */
export function hoursWord(h) {
  const n = int(h);
  if (n == null) return null;
  if (n < 24) return `${Math.max(1, Math.round(n))} hour${Math.round(n) === 1 ? '' : 's'}`;
  const d = Math.round(n / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** "80%" of decided; "No decisions yet" when none was decided. */
export function approvalWord(approval) {
  const decided = int(approval?.decided);
  const approved = int(approval?.approved);
  if (!decided || approved == null) return 'No decisions yet';
  return `${Math.round((100 * approved) / decided)}%`;
}

// ───────────────────────────────────────────── Authors (ART9, ART10)

/** One row per author, in the canvas's columns. */
export function authorRow(a, readFollowers = true) {
  const week = a?.this_week || {};
  return {
    id: Number(a?.user_id),
    name: a?.name || `Account #${a?.user_id}`,
    profile: a?.role ? profileName(a.role) : NOT_RECORDED,
    role: a?.role || null,
    published: int(a?.published) ?? 0,
    waiting: int(a?.waiting) ?? 0,
    rejected: int(a?.rejected) ?? 0,
    approval: approvalWord(a?.approval),
    approvalShare: int(a?.approval?.decided) ? int(a.approval.approved) / int(a.approval.decided) : null,
    views: fmt(a?.views_all_time) ?? NOT_RECORDED,
    viewsN: int(a?.views_all_time),
    // The follows read is its own: a failed one is "couldn't be read", never 0.
    followers: readFollowers && a?.followers != null ? fmt(a.followers) : 'Couldn’t be read',
    followersN: readFollowers ? int(a?.followers) : null,
    lastSubmitted: dayWord(a?.last_submitted_at) ?? 'Never',
    lastAt: a?.last_submitted_at || '',
    firstSubmitted: dayWord(a?.first_submitted_at),
    week: `${int(week.used) ?? 0} of ${int(week.limit) ?? '?'}`,
    atLimit: week.at_limit === true,
    medianDecision: hoursWord(a?.median_hours_to_decision),
  };
}

/** The four tiles (ART9), from the read's summary. */
export function authorTiles(data) {
  const s = data?.summary || {};
  const limit = int(data?.submissions_per_week);
  return [
    { key: 'published', label: 'Authors with a published article', value: fmt(s.with_published) ?? NOT_RECORDED },
    { key: 'new', label: 'New authors, last 90 days', value: fmt(s.new_last_90_days) ?? NOT_RECORDED },
    { key: 'first', label: 'Articles waiting from first-time authors', value: fmt(s.waiting_from_first_time) ?? NOT_RECORDED },
    { key: 'limit', label: 'At the weekly limit', value: fmt(s.at_weekly_limit) ?? NOT_RECORDED, sub: limit ? `${limit} submissions in 7 days` : null },
  ];
}

/** The read's state: reading, couldn't be read, no author yet, or the rows. */
export function authorsView(read) {
  if (!read || read.status === 'loading') return { status: 'loading', rows: [], tiles: [] };
  if (read.status !== 'ready' || !Array.isArray(read.data?.authors)) return { status: 'unreadable', rows: [], tiles: [] };
  const rows = read.data.authors.map((a) => authorRow(a, read.data.followers_read !== false));
  return {
    status: rows.length ? 'ready' : 'empty',
    rows,
    tiles: authorTiles(read.data),
    viewsNote: read.data.views_note || null,
    followersRead: read.data.followers_read !== false,
  };
}

export const AUTHOR_SORTS = Object.freeze([
  { key: 'published', label: 'Most published' },
  { key: 'waiting', label: 'Most waiting' },
  { key: 'views', label: 'Most views, all time' },
  { key: 'followers', label: 'Most followers' },
  { key: 'last', label: 'Last submitted' },
  { key: 'name', label: 'Name' },
]);

const byName = (a, b) => a.name.localeCompare(b.name);
const SORTERS = {
  published: (a, b) => b.published - a.published || byName(a, b),
  waiting: (a, b) => b.waiting - a.waiting || byName(a, b),
  views: (a, b) => (b.viewsN ?? -1) - (a.viewsN ?? -1) || byName(a, b),
  // A follower count that couldn't be read sorts last, never as 0.
  followers: (a, b) => (b.followersN ?? -1) - (a.followersN ?? -1) || byName(a, b),
  last: (a, b) => String(b.lastAt).localeCompare(String(a.lastAt)) || byName(a, b),
  name: byName,
};

/** Search, the Profile filter and "Has articles waiting", then the sort. */
export function filterAuthors(rows, { q = '', role = '', waiting = false, sort = 'published' } = {}) {
  const needle = q.trim().toLowerCase();
  const out = rows.filter((r) => (!needle || r.name.toLowerCase().includes(needle))
    && (!role || r.role === role)
    && (!waiting || r.waiting > 0));
  return out.sort(SORTERS[sort] || SORTERS.published);
}

/** The profiles the authors hold, for the Profile filter. */
export const profilesOf = (rows) => [...new Map(rows.filter((r) => r.role).map((r) => [r.role, r.profile])).entries()]
  .map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));

export const PAGE_SIZES = Object.freeze([25, 50, 100]);

/** One page of rows and its words: "1–25 of 37", "Page 1 of 2". */
export function pageOf(rows, page, size) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, page), pages);
  const start = (at - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: at,
    pages,
    range: rows.length ? `${start + 1}–${start + slice.length} of ${rows.length}` : '0 of 0',
  };
}

/** The author drawer's facts (ART10), each from the authors read. */
export function authorFacts(row) {
  return [
    ['Writing since', row.firstSubmitted ?? NOT_RECORDED],
    ['Published', String(row.published)],
    ['Waiting', String(row.waiting)],
    ['Rejected', String(row.rejected)],
    ['Approval rate', row.approval],
    ['Median time to a decision', row.medianDecision ?? 'No decisions timed yet'],
    ['Followers', row.followers],
    ['This week', row.week],
    ['Views, all time', row.views],
  ];
}

/** ART10's blocks the authors read does not carry, said as such. */
export const DRAWER_WAITS = Object.freeze([
  'Published per month and the review history are not read here yet: the authors read gives each author’s totals, not each article.',
]);

// ───────────────────────────────────────────── Performance (ART11, ART12, ART15c)

export const PERIODS = Object.freeze([
  { key: '12w', label: 'Last 12 weeks', days: null },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '12m', label: 'Last 12 months', days: 365 },
]);

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * The range a period asks for. "Last 12 weeks" sends none: the Worker's own
 * default is the twelve Monday weeks to today. The Worker allows at most 400
 * days, so there is no "All time".
 */
export function rangeFor(key, today = new Date()) {
  const p = PERIODS.find((x) => x.key === key);
  if (!p || p.days == null) return {};
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(to.getTime() - (p.days - 1) * 86_400_000);
  return { from: iso(from), to: iso(to) };
}

const sum = (rows, key) => rows.reduce((n, r) => n + (int(r[key]) ?? 0), 0);

/**
 * The performance read as the page draws it. Views are known only from the
 * first daily row: before it a week's views are null and say Not recorded with
 * the Worker's reason; the week the count started in is marked partial.
 */
export function performanceView(read) {
  if (!read || read.status === 'loading') return { status: 'loading' };
  if (read.status !== 'ready' || !Array.isArray(read.data?.weeks)) return { status: 'unreadable' };
  const d = read.data;
  const weeks = d.weeks.map((w) => ({
    week: w.week,
    label: weekWord(w.week) ?? w.week,
    published: int(w.published) ?? 0,
    submitted: int(w.submitted) ?? 0,
    approved: int(w.approved) ?? 0,
    changes: int(w.changes_requested) ?? 0,
    rejected: int(w.rejected) ?? 0,
    views: w.views == null ? null : int(w.views),
    partial: w.views_partial === true,
  }));
  const viewed = weeks.filter((w) => w.views != null);
  const published = sum(weeks, 'published');
  const submitted = sum(weeks, 'submitted');
  const approved = sum(weeks, 'approved');
  const changes = sum(weeks, 'changes');
  const rejected = sum(weeks, 'rejected');
  const views = viewed.length ? viewed.reduce((n, w) => n + w.views, 0) : null;
  // The week the count started in is partial too, not only the weeks before it.
  const fromStart = viewed.length < weeks.length || weeks.some((w) => w.partial);
  const reach = d.follower_reach || {};
  const decided = d.decisions || {};
  const range = `${dayWord(d.from) ?? d.from} to ${dayWord(d.to) ?? d.to}`;
  return {
    status: 'ready',
    range,
    weeks,
    viewsReason: d.views_reason || 'Not recorded: no view has been counted per day yet.',
    viewsKnown: viewed.length > 0,
    tiles: [
      { key: 'published', label: 'Published', value: fmt(published), sub: range },
      views == null
        ? { key: 'views', label: 'Views', value: NOT_RECORDED, sub: d.views_reason || null, missing: true }
        : { key: 'views', label: 'Views', value: fmt(views), sub: fromStart ? `Counted from ${dayWord(d.views_recorded_since) ?? 'the first daily count'}` : range },
      decided.median_hours_to_decision == null
        ? { key: 'decision', label: 'Median time to a decision', value: NOT_RECORDED, sub: 'No decision in the range was timed.', missing: true }
        : { key: 'decision', label: 'Median time to a decision', value: hoursWord(decided.median_hours_to_decision), sub: `${fmt(decided.timed)} decision${int(decided.timed) === 1 ? '' : 's'} timed` },
      { key: 'reach', label: 'Followers told', value: fmt(reach.notified) ?? NOT_RECORDED, sub: `${fmt(reach.publishes_recorded) ?? 0} publish${int(reach.publishes_recorded) === 1 ? '' : 'es'} with a recorded reach` },
    ],
    summaries: {
      published: `Published per week, ${range}: ${published} in all.`,
      decided: `${range}: ${submitted} submitted. Reviews ended in ${approved} approvals, ${changes} change requests and ${rejected} rejections.`,
      views: views == null ? null : `Views per week, ${range}: ${fmt(views)} in all${fromStart ? `, counted from ${dayWord(d.views_recorded_since) ?? 'the first daily count'}` : ''}.`,
    },
    sectors: Array.isArray(d.views_by_sector) ? d.views_by_sector.map((s) => ({ sector: s.sector || 'No sector', views: int(s.views) ?? 0 })) : null,
    top: Array.isArray(d.top_articles) ? d.top_articles.map((t, i) => ({
      rank: i + 1,
      id: t.id,
      title: t.title || NOT_RECORDED,
      author: t.author_name || NOT_RECORDED,
      published: dayWord(t.published_at) ?? NOT_RECORDED,
      views: fmt(t.views) ?? NOT_RECORDED,
      read: t.read_minutes == null ? NOT_RECORDED : `${t.read_minutes} min`,
    })) : null,
    notRecorded: Object.entries(d.not_recorded || {}).map(([key, line]) => ({ key, title: NOT_RECORDED_TITLES[key] || key, line })),
    reachNote: reach.note || null,
    decisionNote: decided.note || null,
  };
}

const NOT_RECORDED_TITLES = Object.freeze({
  unique_readers: 'Unique readers',
  read_through: 'How far people read',
  sources: 'Where readers came from',
  newsletter_clicks: 'Newsletter clicks',
});

export const NOT_RECORDED_LINE = 'These need new tracking. Until then, they are left out rather than shown as zero.';
