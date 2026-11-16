/**
 * D4708 (#4708) — the Security ledger's cursor and server-side filters: `parseFeedQuery`, which stores a filtered
 * read can hold a row from, the binds in statement order, and the whole-second page rule. Moved from
 * `routes/admin_security.ts` unchanged; the outcome list is the shared contract's (`./contract`, `lib/securityContract.js`).
 */
import { parseStoredTs } from '../sessionStatus';
import { FEED_OUTCOMES } from './contract';

export { FEED_OUTCOMES };

/**
 * D4803 (Events, SE03) — the ledger's cursor and its server-side filters.
 *
 * Each store applies the same four conditions in its own SQL, every value
 * bound and every timestamp normalised through `datetime()` (D124), so each
 * store still returns its OWN newest FEED_LIMIT matching rows and the merge
 * stays exact, as the whole-feed read always was:
 *
 *   before  older than this instant (the cursor; the page's last `at`)
 *   from    on or after this day, `YYYY-MM-DD`, UTC
 *   to      on or before this day, `YYYY-MM-DD`, UTC (the whole day)
 *   actor   a user id: who acted (a gate or step-up event also matches the
 *           support operator acting for that account)
 *   q       a search, matched as a substring, case-insensitively for ASCII
 *           (SQLite's LIKE), against the action, the names and emails the row
 *           joins, and the store's own text column
 *   outcome ok | refused | live | ended | not_closed
 *   source  one store's table name
 *   skip    D4708 part 2: with `before`, the rows of the cursor's own second
 *           the last page already showed. The read then includes that second
 *           and continues after those rows, so a page that lay wholly inside
 *           one second is followed by the rest of it, never past it.
 *
 * A value outside its shape is a 400 naming the field, never a quietly
 * widened read: an investigator who typed a date the server ignored would be
 * reading a list that is not the one they asked for.
 */
export const FEED_SOURCES = [
  'admin_audit_log', 'activity_logs', 'impersonation_sessions', 'licence_events', 'security_events',
] as const;
export type FeedOutcome = (typeof FEED_OUTCOMES)[number];
export type FeedSource = (typeof FEED_SOURCES)[number];
/**
 * D4708 part 2 — the most rows of one second the cursor can continue past (ten full pages). Each store then
 * reads at most FEED_LIMIT + FEED_SKIP_MAX rows; a second that holds more than that is paged as before, after it.
 */
export const FEED_SKIP_MAX = 600;
export type FeedQuery = {
  upper: string | null;
  lower: string | null;
  actor: number | null;
  like: string | null;
  outcome: FeedOutcome | null;
  source: FeedSource | null;
  /** D4708 part 2 — continue inside the cursor's second: its start (epoch ms) and how many of its rows were shown. */
  skip: { second: number; rows: number } | null;
  applied: Record<string, string | number>;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_MAX = 100;
/** `YYYY-MM-DD HH:MM:SS`, UTC: the shape `datetime()` returns, so a bound value compares as the column does. */
const sqlStamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** The query string as a FeedQuery, or the first field that is out of shape. */
export function parseFeedQuery(q: (k: string) => string | undefined):
  { ok: true; query: FeedQuery } | { ok: false; field: string; message: string } {
  const applied: Record<string, string | number> = {};
  const text = (k: string) => {
    const v = q(k);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  let upper: number | null = null;
  let lower: number | null = null;
  let skip: { second: number; rows: number } | null = null;

  const before = text('before');
  if (before) {
    const ms = parseStoredTs(before);
    if (Number.isNaN(ms)) return { ok: false, field: 'before', message: 'The cursor is not a timestamp.' };
    upper = ms;
    applied.before = before;
  }
  const skipText = text('skip');
  if (skipText) {
    const rows = /^[1-9]\d{0,3}$/.test(skipText) ? Number(skipText) : NaN;
    if (upper === null || !(rows <= FEED_SKIP_MAX)) {
      return { ok: false, field: 'skip', message: `The skip is a row count of at most ${FEED_SKIP_MAX}, with a cursor.` };
    }
    // The cursor's whole second is read again; the rows already shown are dropped after the merge.
    const second = Math.floor(upper / 1000) * 1000;
    skip = { second, rows };
    upper = second + 1000;
    applied.skip = rows;
  }
  const day = (k: 'from' | 'to') => {
    const v = text(k);
    if (!v) return { ok: true as const, ms: null };
    const ms = DAY_RE.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN;
    if (Number.isNaN(ms)) return { ok: false as const };
    applied[k] = v;
    return { ok: true as const, ms };
  };
  const from = day('from');
  if (!from.ok) return { ok: false, field: 'from', message: 'The start date must be YYYY-MM-DD.' };
  const to = day('to');
  if (!to.ok) return { ok: false, field: 'to', message: 'The end date must be YYYY-MM-DD.' };
  if (from.ms !== null) lower = from.ms;
  // `to` names a whole day, so the bound is the start of the next one.
  if (to.ms !== null) {
    const end = to.ms + 86_400_000;
    upper = upper === null ? end : Math.min(upper, end);
  }
  if (lower !== null && upper !== null && lower >= upper) {
    return { ok: false, field: 'from', message: 'The start date is after the end of the range.' };
  }

  const actorText = text('actor');
  let actor: number | null = null;
  if (actorText) {
    if (!/^[1-9]\d{0,9}$/.test(actorText)) return { ok: false, field: 'actor', message: 'The actor must be a user id.' };
    actor = Number(actorText);
    applied.actor = actor;
  }

  const search = text('q');
  let like: string | null = null;
  if (search) {
    if (search.length > SEARCH_MAX) return { ok: false, field: 'q', message: `A search is at most ${SEARCH_MAX} characters.` };
    // `!` escapes LIKE's own wildcards, so a search for "50%" finds "50%".
    like = `%${search.replace(/[!%_]/g, (ch) => `!${ch}`)}%`;
    applied.q = search;
  }

  const outcomeText = text('outcome');
  let outcome: FeedOutcome | null = null;
  if (outcomeText) {
    if (!(FEED_OUTCOMES as readonly string[]).includes(outcomeText)) {
      return { ok: false, field: 'outcome', message: `The outcome is one of ${FEED_OUTCOMES.join(', ')}.` };
    }
    outcome = outcomeText as FeedOutcome;
    applied.outcome = outcome;
  }

  const sourceText = text('source');
  let source: FeedSource | null = null;
  if (sourceText) {
    if (!(FEED_SOURCES as readonly string[]).includes(sourceText)) {
      return { ok: false, field: 'source', message: 'The source is not one of the five stores.' };
    }
    source = sourceText as FeedSource;
    applied.source = source;
  }

  return {
    ok: true,
    query: {
      upper: upper === null ? null : sqlStamp(upper),
      lower: lower === null ? null : sqlStamp(lower),
      actor, like, outcome, source, skip, applied,
    },
  };
}

/** The binds for one store's time, actor and search conditions, in statement order. */
export const timeBinds = (f: FeedQuery) => [f.upper, f.upper, f.lower, f.lower];
export const actorBinds = (f: FeedQuery, n = 2) => [f.actor, ...Array(n - 1).fill(f.actor)];
export const likeBinds = (f: FeedQuery, n: number) => [f.like, ...Array(n).fill(f.like)];

/**
 * Which stores a filtered read can hold a row from. Only `security_events`
 * stores an outcome; the other four are written after their act (`ok`), and an
 * impersonation's outcome is a state (live, ended, not closed).
 */
export function storesFor(f: FeedQuery): Record<FeedSource, boolean> {
  const all = {
    admin_audit_log: true, activity_logs: true, impersonation_sessions: true, licence_events: true, security_events: true,
  };
  if (f.outcome === 'refused') Object.assign(all, { admin_audit_log: false, activity_logs: false, impersonation_sessions: false, licence_events: false });
  if (f.outcome === 'ok') all.impersonation_sessions = false;
  if (f.outcome === 'live' || f.outcome === 'ended' || f.outcome === 'not_closed') {
    Object.assign(all, { admin_audit_log: false, activity_logs: false, licence_events: false, security_events: false });
  }
  if (f.source) for (const k of FEED_SOURCES) if (k !== f.source) all[k] = false;
  return all;
}

/**
 * The page ends on a whole second. The cursor is the last row's time and the
 * next read takes rows strictly older, at the second `datetime()` keeps, so a
 * page cut inside a second would drop that second's remaining rows. Trailing
 * rows in the last row's second are held back to the next page — unless the
 * whole page is one second, which is returned whole and said so (`split`).
 * D4708 part 2: the reply's cursor then carries `skip`, and the next read
 * continues inside that second (`governanceFeed.ts`).
 */
export function trimToSecond<T extends { ts: number }>(rows: T[], more: boolean): { page: T[]; split: boolean } {
  if (!more || rows.length === 0) return { page: rows, split: false };
  const sec = (t: number) => (Number.isNaN(t) ? NaN : Math.floor(t / 1000));
  const last = sec(rows[rows.length - 1].ts);
  let cut = rows.length;
  while (cut > 0 && sec(rows[cut - 1].ts) === last) cut -= 1;
  return cut === 0 ? { page: rows, split: true } : { page: rows.slice(0, cut), split: false };
}
