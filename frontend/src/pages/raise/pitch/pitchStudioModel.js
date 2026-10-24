/**
 * D894 (#2434) — the Pitch deck studio's words and derivations, kept pure so
 * the tests read them without a browser.
 *
 * WHAT IS READ, AND FROM WHERE. Every figure here comes from a read that is
 * already on `main`:
 *   - `GET /api/decks/by-project/:pid`  → the versions (no slides);
 *   - `GET /api/decks/:id`              → the current version's slides (its cover);
 *   - `GET /api/decks/:id/engagement`   → that version's views and NDA count;
 *   - `GET /api/cycles/raise/modules/pitch-deck` → views per week, seconds per
 *     slide and the investor links, for every version of the venture, a page of
 *     links at a time.
 * Nothing is a sample. A read that fails says so where its figure would be, and
 * a value nobody recorded reads "Not recorded", never 0. A figure worked out
 * from a list the Worker caps says so.
 *
 * WHAT IS NOT DRAWN YET, AND WHO DRAWS IT. The canvas's coverage meter, checks,
 * source chips, audience and round columns, the fast-path build, "New in your
 * data", per-version seconds, present mode and the share dialog need stores the
 * Worker does not have. Each is a slot task on #2434; this file grows the
 * derivation when its read lands.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { ENGAGEMENT_VIEW_ROWS } from '../../../lib/deckShareViews.js';

export const STUDIO_PATH = '/raise/pitch';
export const EDIT_PATH = '/raise/pitch/edit';
export const REVIEW_PATH = '/raise/pitch/review';
export const ANALYTICS_PATH = '/raise/pitch/analytics';

/** The old `?mode=workspace` address now redirects to the editor with this key. */
export const MOVED_KEY = 'pitch-workspace';
export const MOVED_NOTICE = 'Pitch deck has a new address. Update your bookmark.';

export const TITLE = 'Pitch deck studio';
// The canvas's second sentence, "Every figure shows its source.", waits for the
// source chips (#2434 part 2): it is not true of the builder yet.
export const LINE = 'Build your deck from what StudioOS already knows.';
export const READ_ONLY = 'Read only.';

export const TABS = [
  { id: 'decks', label: 'Decks', path: STUDIO_PATH },
  { id: 'review', label: 'Review', path: REVIEW_PATH },
  { id: 'analytics', label: 'Share & analytics', path: ANALYTICS_PATH },
];

export const EMPTY_DECK = 'No deck yet. Start from your records.';
export const NO_VIEWS = 'No one has opened a link yet.';
export const NO_VENTURE = 'No venture to build a deck for yet.';
export { NOT_RECORDED, ENGAGEMENT_VIEW_ROWS };

/** The query every studio address carries: the venture, and nothing else. */
export const ventureQuery = (projectId) => (projectId ? `?project_id=${encodeURIComponent(projectId)}` : '');

/** Where the old `/raise/pitch?mode=workspace` sends you: the editor, query and hash kept. */
export function movedTarget(search = '', hash = '') {
  const next = new URLSearchParams(search);
  next.delete('mode');
  next.set('moved', MOVED_KEY);
  return { pathname: EDIT_PATH, search: `?${next.toString()}`, hash };
}

/**
 * An admin reads the studio and changes nothing (PD21); everyone else the route
 * admits works in it, as before D894. An admin viewing as a founder (viewMode)
 * is still an admin account, so still reads.
 */
export const isReadOnly = (user) => String(user?.role || '') === 'admin';

export const asList = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};

export const currentVersion = (versions) => versions.find((v) => v.is_current || v.current) || versions[0] || null;

const parse = (value) => {
  if (!value) return null;
  // D1 stores "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(value)) ? `${String(value).replace(' ', 'T')}Z` : String(value);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function dayLabel(value) {
  const d = parse(value);
  return d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d) : 'Date not recorded';
}

/** Seconds as m:ss, the canvas's time format. A missing value is not 0:00. */
export function mmss(seconds) {
  const s = Number(seconds);
  if (seconds == null || !Number.isFinite(s) || s < 0) return null;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export const versionLabel = (v) => (v?.version == null ? 'Version not recorded' : `v${v.version}`);

/** The versions table, newest first, as the canvas sorts it by default. */
export function versionRows(versions) {
  return [...versions]
    .sort((a, b) => Number(b.version ?? -1) - Number(a.version ?? -1))
    .map((v) => ({
      id: v.id,
      label: versionLabel(v),
      title: String(v.title || '').trim() || 'Untitled deck',
      saved: dayLabel(v.created_at),
      current: Boolean(v.is_current || v.current),
    }));
}

/**
 * The cover of a deck: its first slide's title and subtitle fields (the
 * template's headline and tagline), else the deck's own title. The slide's own
 * `title` is its section name ("Title", or "Problem" on a generated deck) and
 * its `subtitle` the venture's name, so the section name comes last and the
 * venture's name, already the cover's eyebrow, never.
 */
// The Worker fills a field nobody wrote with a dash (`autofill.ts` PLACEHOLDER).
const written = (v) => { const t = String(v ?? '').trim(); return t === '—' ? '' : t; };

export function coverOf(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const first = slides[0] || {};
  const field = (key) => (Array.isArray(first.fields) ? first.fields.find((f) => f?.key === key || f?.kind === key) : null);
  const headline = written(field('title')?.value) || written(deck?.title) || written(first.title);
  const sub = written(field('subtitle')?.value);
  return { headline: headline || 'Untitled deck', sub, slides: slides.length || null };
}

const seriesOf = (card, kind) => (Array.isArray(card?.series) ? card.series.find((s) => s?.kind === kind) : null);

/**
 * Views per week, oldest first, from the module card (eight weeks, every
 * version). `null` when the card holds no series: no deck, no views, or a read
 * that failed — the card's own state says which. Eight zeros is a real count:
 * the venture has views, none of them in the last eight weeks.
 */
export function weeklyViews(card) {
  const bars = seriesOf(card, 'vbars');
  if (!bars || !Array.isArray(bars.values)) return null;
  const values = bars.values.map((n) => Number(n) || 0);
  return { values, total: values.reduce((a, b) => a + b, 0), weeks: values.length };
}

/**
 * What the module card says about the views, for both tabs. `failed`: the read
 * or the card could not be read. `unopened`: the Worker's own empty card, no
 * view ever, the one case that says "No one has opened a link yet.". `no-deck`:
 * the Worker's other empty card. `ok`: views exist, perhaps none lately.
 */
export function viewsState(card, readStatus) {
  if (readStatus === 'error' || !card || card.state === 'unreadable') return 'failed';
  if (noViewsYet(card)) return 'unopened';
  if (card.state === 'empty') return 'no-deck';
  return weeklyViews(card) ? 'ok' : 'failed';
}

/** Seconds per slide, every version together, as the module card counts them. */
export function slideSeconds(card) {
  const bar = seriesOf(card, 'hbar');
  if (!bar || !Array.isArray(bar.items)) return [];
  return bar.items
    .map((item) => {
      const index = Number(/(\d+)/.exec(String(item.label || ''))?.[1]);
      return { index: Number.isFinite(index) ? index : null, label: String(item.label || ''), seconds: Number(item.value) || 0 };
    })
    .filter((r) => r.index != null);
}

/** The slide read longest, and the one read fastest, for the chart's caption. */
export function slideExtremes(rows) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.seconds - a.seconds || a.index - b.index);
  return { longest: sorted[0], fastest: sorted[sorted.length - 1] };
}

export function slideCaption(rows) {
  const ex = slideExtremes(rows);
  if (!ex) return null;
  if (ex.longest.index === ex.fastest.index) return `Viewers spend longest on slide ${ex.longest.index}.`;
  return `Viewers spend longest on slide ${ex.longest.index}; slide ${ex.fastest.index} is read fastest.`;
}

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * One version's readers, from its engagement read. A viewer is one browser
 * (`ip_hash` with `ua_fingerprint`); a view with neither counts alone.
 *
 * The Worker sends at most ENGAGEMENT_VIEW_ROWS views, newest first, and counts
 * `total_views` from that list, so at the cap `capped` is true: the views are
 * "at least", and the viewers and the median cover the latest views only. The
 * NDA count is not capped, and it counts signatures, not browsers: it is never
 * divided by `viewers`.
 */
export function readerStats(engagement) {
  if (!engagement || typeof engagement !== 'object') return null;
  const views = asList(engagement, 'views');
  const viewers = new Set(views.map((v) => (v.ip_hash || v.ua_fingerprint ? `${v.ip_hash || ''}|${v.ua_fingerprint || ''}` : `view:${v.id}`)));
  const seconds = views.map((v) => Number(v.read_seconds)).filter((n) => Number.isFinite(n) && n > 0);
  const nda = engagement.conversions?.nda_signed;
  return {
    views: Number.isFinite(Number(engagement.total_views)) ? Number(engagement.total_views) : views.length,
    viewers: viewers.size,
    medianSeconds: median(seconds),
    ndaSigned: Number.isFinite(Number(nda)) ? Number(nda) : null,
    capped: views.length >= ENGAGEMENT_VIEW_ROWS,
  };
}

/**
 * The funnel, over one denominator from the same engagement read: the version's
 * views. Each row is a count, and its bar that count's share of the views,
 * never past the end of its track.
 */
export function funnelRows(stats) {
  const of = stats?.views ?? null;
  const share = (n) => (n == null || !of ? 0 : Math.min(100, Math.round((n / of) * 100)));
  return [
    { label: 'Opened', n: of, width: share(of) },
    { label: 'Accepted the NDA', n: stats?.ndaSigned ?? null, width: share(stats?.ndaSigned ?? null) },
  ];
}

/**
 * The investor links, as the module's records give them, with what the
 * engagement read adds.
 *
 * A link is live only when it has not expired or been withdrawn (the record's
 * own expiry cell) AND it still has a view left. The records do not carry the
 * second. The engagement read's `shares` do (`exhausted`: the Worker's
 * `used_at`, or `view_count` at `view_limit`), for the current version's links,
 * and a link nobody has opened has every view left. An opened link the
 * engagement read does not list (another version's, one past its newest 50,
 * or any opened link while that read is running or has failed) is neither live
 * nor dead: `live` is null. The page still offers Withdraw on it, and says why
 * its views left are not shown; withdrawing one that had already been used up
 * marks it Revoked, and the dialog says so.
 */
export function linkRows(records, engagement = null) {
  const shares = new Map(asList(engagement, 'shares').map((s) => [String(s.id), s]));
  return asList(records, 'rows').map((row) => {
    const c = row.cells || {};
    const exp = c.expires && typeof c.expires === 'object' ? c.expires : { text: String(c.expires ?? ''), tone: '' };
    const views = Number.isFinite(Number(c.views)) ? Number(c.views) : null;
    const share = shares.get(String(row.id));
    const usedUp = exp.tone === 'ok' && Boolean(share?.exhausted);
    return {
      id: row.id,
      investor: String(c.link || '').trim() || 'Investor not recorded',
      expires: usedUp ? 'Used up' : exp.text || NOT_RECORDED,
      live: exp.tone !== 'ok' || usedUp ? false : share || views === 0 ? true : null,
      views,
      time: c.time == null || c.time === '' ? null : String(c.time),
      mostRead: c.most_read == null ? null : String(c.most_read),
    };
  });
}

/**
 * Where this page of links sits in the read's own total, for the pager; null
 * when the read gave no total (the records could not be read).
 */
export function linkPage(records) {
  if (records?.total == null || records?.page_size == null) return null;
  const total = Number(records.total);
  const size = Number(records.page_size);
  if (!Number.isInteger(total) || !Number.isInteger(size) || size < 1) return null;
  const page = Math.max(1, Number(records.page) || 1);
  const shown = asList(records, 'rows').length;
  const from = shown ? (page - 1) * size + 1 : 0;
  return { page, pages: Math.max(1, Math.ceil(total / size)), total, from, to: shown ? from + shown - 1 : 0 };
}

/** The module's own "New link" address, when it offers one. */
export const newLinkHref = (records) => (records?.add?.href && /^\/raise\/pitch-deck\/new/.test(records.add.href) ? records.add.href : null);

/** Whether the module says nobody has opened a link yet (an empty card with a deck). */
export const noViewsYet = (card) => card?.state === 'empty' && /No one has opened/i.test(String(card?.reason || ''));
