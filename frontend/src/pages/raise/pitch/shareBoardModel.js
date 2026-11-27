// D4254 P4 (#4272, ps7, ps7x, ps7b) — Share & analytics, the tile's model: what the
// daily read (`GET /api/decks/:id/analytics/daily`, D4272) draws. Pure, so it is
// tested without a page. A value the read answers as null is "Not recorded",
// never 0; a counted 0 (a day with no views, a link nobody opened) is a 0.
import { NOT_RECORDED } from './pitchStudioModel';
import { ABSENCE, durationWords } from './slideAnalyticsModel.js';

export const NDA_LINE = 'The NDA is set per link. Each investor gets their own link.';
export const NO_LINKS = 'No investor link yet. Share the deck to see who reads it.';
export const NO_VIEWS = 'Views appear here the moment a reader opens their link.';
export const UNREADABLE = "Views couldn't be read.";
export const TIME_OFF = 'Only visits are counted for this link.';
export const NDA_FILTERS = Object.freeze([
  { value: 'all', label: 'All links' },
  { value: 'yes', label: 'NDA links' },
  { value: 'no', label: 'No-NDA links' },
]);
export const FUNNEL_STEPS = Object.freeze([
  ['sent', 'Sent'], ['opened', 'Opened'], ['nda_shown', 'NDA shown'], ['accepted', 'Accepted'], ['reached_ask', 'Reached the ask'],
]);

/** The board's state: the read's, then whether any investor link exists, then whether any was opened. */
export function boardState(read) {
  if (!read || read.status === 'loading' || read.status === 'idle') return 'loading';
  if (read.status === 'error' || !read.data) return 'unreadable';
  const f = read.data.funnels;
  const sent = (Number(f?.nda?.sent) || 0) + (Number(f?.open?.sent) || 0);
  const views = (read.data.days || []).reduce((s, d) => s + (Number(d.nda) || 0) + (Number(d.open) || 0), 0);
  if (!sent && !views) return 'no-links';
  if (!views) return 'no-views';
  return 'ready';
}

/** Views per day as two series, each bar a share of the busiest day; first views kept per day. */
export function dailyBars(days) {
  const list = Array.isArray(days) ? days : [];
  const max = Math.max(1, ...list.map((d) => (Number(d.nda) || 0) + (Number(d.open) || 0)));
  return list.map((d) => {
    const nda = Number(d.nda) || 0;
    const open = Number(d.open) || 0;
    return {
      date: d.date,
      nda, open,
      first: (Number(d.first_nda) || 0) + (Number(d.first_open) || 0),
      ndaPct: Math.round((nda / max) * 100),
      openPct: Math.round((open / max) * 100),
    };
  });
}

/** One funnel's rows: each step's count (null drawn "Not recorded"), its bar against Sent, and what a null means. */
export function funnelRows(funnel, gated) {
  const sent = Number(funnel?.sent) || 0;
  return FUNNEL_STEPS.map(([key, label]) => {
    const raw = funnel ? funnel[key] : null;
    const n = raw == null ? null : Number(raw);
    let note = null;
    if (n == null && !gated && (key === 'nda_shown' || key === 'accepted')) note = 'No NDA on these links';
    else if (n == null) note = NOT_RECORDED;
    return { key, label, n, note, width: n == null || !sent ? 0 : Math.round((n / sent) * 100) };
  });
}

/** One version's drop-off rows: seconds and the drop after each card, both null when nobody counted them. */
export function dropRows(side) {
  if (!side || !Array.isArray(side.cards)) return [];
  const max = Math.max(1, ...side.cards.map((c) => Number(c.seconds) || 0));
  return side.cards.map((c) => ({
    index: c.index,
    title: c.title || `Card ${Number(c.index) + 1}`,
    seconds: c.seconds == null ? null : Number(c.seconds),
    drop: c.drop_pct == null ? null : Number(c.drop_pct),
    pct: c.seconds == null ? 0 : Math.round((Number(c.seconds) / max) * 100),
  }));
}

/** The drop-off heading: "v7 against v6", or the one version when there is no earlier one. */
export function dropTitle(dropoff) {
  const cur = dropoff?.current?.version;
  const prev = dropoff?.previous?.version;
  if (cur == null) return 'Where readers drop off';
  return prev == null ? `Where readers drop off · v${cur}` : `Where readers drop off · v${cur} against v${prev}`;
}

/**
 * ps7b: site traffic from PostHog only when the venture is connected. Not
 * connected is one quiet line; a failed read is neutral, never red.
 */
export function posthogLine(read) {
  if (!read || read.status === 'loading' || read.status === 'idle') return null;
  if (read.status === 'error') return { kind: 'neutral', text: "PostHog couldn't be read just now." };
  const link = read.data?.link;
  if (!link?.linked || !link?.active) return { kind: 'connect', text: 'Connect PostHog to see site traffic around your share days.' };
  const tracked = Array.isArray(read.data?.tracked) ? read.data.tracked : [];
  if (!tracked.length) return { kind: 'neutral', text: 'PostHog is connected. Track a metric on Pitch to see it beside your share days.' };
  return { kind: 'tracked', text: 'From PostHog', tracked };
}

// ── D6062 (#6062, Pitch Studio v2 PS-08 A): visits, the most-read card, reach ──

export const OVERVIEW_ZERO = 'Measured: your investor links exist and nobody opened one in this period.';
export const NO_TIMED_CARD = 'No card on this version has counted reading time in this period.';
export const NO_ASK_FUNNEL = 'No link here sends an ask card and counts time per slide, so reaching the ask cannot be counted.';
export const ASK_ZERO = 'Measured: no link that times its cards reached the ask in this period.';
// D8250 (#8250): readers are counted by link, the only identity a share link has.
export const NO_READERS = 'No investor link was opened in this period, so there is no reader to count.';
export const READERS_UNSENT = 'This read did not count readers.';
export const NO_PER_READER = 'No card counted reading time on a link in this period, so there is no average per reader.';
export const PER_READER_UNSENT = 'This read did not count readers on this card.';
export const ZERO_DAY_NOTE = 'A grey line is a day with no views, counted: a measured zero, not missing data.';

/**
 * PS-08 A's three tiles from the daily read (D4272): Visits with first views
 * and revisits, the most-read card on the version shown, and how many links
 * reached the ask of those opened. A null the read answers is Not recorded; a
 * counted 0 is a measured zero. Reactions and feedback are not a tile here:
 * they wait for proposal 9 (D6062).
 */
export function overviewFigures(data) {
  if (!data || typeof data !== 'object') {
    const u = { kind: 'unreadable', why: ABSENCE.unreadable.line };
    return { visits: u, mostRead: u, ask: u, investors: u, perReader: u };
  }
  const days = Array.isArray(data.days) ? data.days : [];
  const views = days.reduce((s, d) => s + (Number(d.nda) || 0) + (Number(d.open) || 0), 0);
  const first = days.reduce((s, d) => s + (Number(d.first_nda) || 0) + (Number(d.first_open) || 0), 0);
  const visits = views === 0
    ? { kind: 'measured_zero', value: '0', why: OVERVIEW_ZERO }
    : { kind: 'value', value: String(views), sub: `${first} first ${first === 1 ? 'view' : 'views'} · ${views - first} ${views - first === 1 ? 'revisit' : 'revisits'}` };

  const cur = data.dropoff?.current;
  const cards = Array.isArray(cur?.cards) ? cur.cards : [];
  let top = null;
  for (const c of cards) if (Number(c?.seconds) > 0 && (!top || Number(c.seconds) > Number(top.seconds))) top = c;
  const mostRead = top
    ? { kind: 'value', value: `${Number(top.index) + 1} · ${top.title || `Card ${Number(top.index) + 1}`}`, sub: `${durationWords(top.seconds)} in all on v${cur.version} · links with Time per slide on` }
    : { kind: 'not_recorded', why: NO_TIMED_CARD };

  const f = data.funnels || {};
  const known = [f.nda, f.open].filter((x) => x && x.reached_ask != null);
  let ask;
  if (!known.length) ask = { kind: 'not_recorded', why: NO_ASK_FUNNEL };
  else {
    const n = known.reduce((s, x) => s + (Number(x.reached_ask) || 0), 0);
    const opened = known.reduce((s, x) => s + (Number(x.opened) || 0), 0);
    const sub = `of ${opened} opened ${opened === 1 ? 'link' : 'links'} · counted on links with Time per slide on`;
    ask = n === 0 ? { kind: 'measured_zero', value: '0', why: ASK_ZERO, sub } : { kind: 'value', value: String(n), sub };
  }
  return { visits, mostRead, ask, ...readerFigures(data, views, top) };
}

/**
 * D8250 (#8250): PS07's "N investors" under Visits and the most-read card's
 * average per reader. Both count share links, the only identity a link has:
 * one investor with two links is two, two people on one link are one, and the
 * words say "link". With no view, no timed card or no count from the read,
 * each is Not recorded, never 0.
 */
export function readerFigures(data, views, top) {
  if (!data || typeof data !== 'object') {
    const u = { kind: 'unreadable', why: ABSENCE.unreadable.line };
    return { investors: u, perReader: u };
  }
  const raw = data.readers?.count;
  const n = raw == null ? null : Number(raw);
  let investors;
  if (!views) investors = { kind: 'not_recorded', why: NO_READERS };
  else if (!(n > 0)) investors = { kind: 'not_recorded', why: READERS_UNSENT };
  else investors = { kind: 'value', value: `${n} investor ${n === 1 ? 'link' : 'links'} opened` };

  let perReader;
  const per = top ? Number(top.seconds_per_reader) : NaN;
  const readers = top ? Number(top.readers) : NaN;
  if (!top) perReader = { kind: 'not_recorded', why: NO_PER_READER };
  else if (!(per > 0) || !(readers > 0)) perReader = { kind: 'not_recorded', why: PER_READER_UNSENT };
  else perReader = { kind: 'value', value: `${durationWords(per)} per link on average · ${readers} ${readers === 1 ? 'link' : 'links'} read it` };
  return { investors, perReader };
}

/** The period the daily read answered, as the board heads it: "1 Oct to 30 Oct 2026". */
export function periodWords(data) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').map(Number) : null);
  const a = d(data?.from);
  const b = d(data?.to);
  if (!a || !b) return null;
  return `${a[2]} ${M[a[1] - 1]} to ${b[2]} ${M[b[1] - 1]} ${b[0]}`;
}
