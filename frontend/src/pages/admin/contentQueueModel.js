/**
 * D1290 (#2383) — HQ › Content › Content queue, as the owner's canvas draws it
 * (`design/incoming/Content queue · Boards.dc.html`, ART1–ART18): one page,
 * four tabs, each its own address, and one address per article.
 *
 *   /admin/articles               Pipeline (today's queue and review panel)
 *   /admin/articles/<id>          Pipeline, with that article's review open
 *   /admin/articles/calendar      Calendar
 *   /admin/articles/authors       Authors
 *   /admin/articles/performance   Performance
 *
 * Pure, so the tests hold the addresses without a router.
 */

export const QUEUE_BASE = '/admin/articles';

export const QUEUE_TABS = Object.freeze([
  { key: 'pipeline', label: 'Pipeline', to: QUEUE_BASE },
  { key: 'calendar', label: 'Calendar', to: `${QUEUE_BASE}/calendar` },
  { key: 'authors', label: 'Authors', to: `${QUEUE_BASE}/authors` },
  { key: 'performance', label: 'Performance', to: `${QUEUE_BASE}/performance` },
]);

const NAMED = new Set(QUEUE_TABS.map((t) => t.key).filter((k) => k !== 'pipeline'));

/**
 * `{ tab, id }` for a location. An article address is a positive whole
 * number; anything else under the base that is not a tab is Pipeline with no
 * article, never a guess.
 */
export function viewOf(pathname) {
  const rest = String(pathname || '').replace(/\/+$/, '');
  if (rest === QUEUE_BASE || !rest.startsWith(`${QUEUE_BASE}/`)) return { tab: 'pipeline', id: null };
  const seg = rest.slice(QUEUE_BASE.length + 1);
  if (NAMED.has(seg)) return { tab: seg, id: null };
  return /^[1-9]\d{0,15}$/.test(seg) ? { tab: 'pipeline', id: Number(seg) } : { tab: 'pipeline', id: null };
}

/** The address of one article's review. */
export const articleHref = (id) => `${QUEUE_BASE}/${id}`;

/** The page's line, in plain words (#2383 item 14: no "edge cache"). */
export const PAGE_LINE = 'Articles members propose, from submission to publish. Each decision is an admin’s, and the author is told.';

/**
 * What each tab waits on, until its slot task lands (D1290 §4). Each says
 * where today's version of the block is, never an empty board or a zero.
 */
export const WAITS = Object.freeze({
  calendar: {
    title: 'The calendar is not built yet',
    lines: [
      'It shows every scheduled and published article by day, with Move… on each one. It needs the queue to answer by date range (D1291) and is built by D1296.',
      'Until then, an approved article’s time to go out is set in its review panel on Pipeline, in your zone and in UTC.',
    ],
  },
  authors: {
    title: 'Authors is not built yet',
    lines: [
      'It lists each author with their articles by stage, followers, this week’s submissions against the cap, and approval rate. It needs an authors read (D1294) and is built by D1297.',
      'Until then, each article’s author shows in its review panel on Pipeline.',
    ],
  },
  performance: {
    title: 'Performance is not built yet',
    lines: [
      'Views per week: Not recorded. Article views are counted as one all-time number today, with no date, so there is no week to show. D1294 adds a daily count with no personal data; D1297 draws it.',
      'Decisions per week and time to a decision come from the queue’s own dates once D1291 serves them.',
    ],
  },
});
