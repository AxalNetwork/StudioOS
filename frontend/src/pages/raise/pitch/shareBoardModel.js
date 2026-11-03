// D4254 P4 (#4272, ps7, ps7x, ps7b) — Share & analytics, the tile's model: what the
// daily read (`GET /api/decks/:id/analytics/daily`, D4272) draws. Pure, so it is
// tested without a page. A value the read answers as null is "Not recorded",
// never 0; a counted 0 (a day with no views, a link nobody opened) is a 0.
import { NOT_RECORDED } from './pitchStudioModel';

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
