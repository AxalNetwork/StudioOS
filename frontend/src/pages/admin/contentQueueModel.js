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
 * What a tab waits on, until its slot task lands (D1290 §4). Calendar is
 * D1296's and Authors and Performance are D1297's, all in `contentQueue/`,
 * so none of the four tabs waits. A later tab says where today's version of
 * the block is, never an empty board or a zero.
 */
export const WAITS = Object.freeze({});
