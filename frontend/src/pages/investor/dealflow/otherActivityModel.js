/**
 * D4815 (#4815), canvas DX1 — the "Other deal activity" line under Deal flow.
 *
 * `/deals` has one job: the investor's own deal flow. Screening, the investment
 * committee and Closing each have their own route, so the root carries one
 * compact line with a count per zone and a link to it, not a mini-version of
 * each zone. Each count is the headline its zone page draws, read from the
 * same endpoint, so the line cannot report a number the zone cannot reproduce:
 *
 *   Screening      — `GET /api/deals/screening`, the desk's rows.
 *   IC decisions   — `GET /api/ic/commit-room`, the decisions not yet decided.
 *   Closing        — `GET /api/deals?scope=mine`, the deals at the closing stage.
 *   Deal rooms     — `GET /api/deals`, the live rooms the panel below lists.
 *
 * A read that fails, or a store the reply marks unavailable, is `null`: the
 * line says "Unreadable" for that zone alone and never prints 0 in its place.
 */
import { dealStage } from '../../../lib/dealFlow';

export const OTHER_ACTIVITY_TITLE = 'Other deal activity';
/** When the personal flow could not be read, what survives is said to be separate from it. */
export const OTHER_ACTIVITY_SURVIVING = 'Other deal information is still available';

const rowsOf = (r) => (Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : null));

/** The four counts, each from its own reply; `null` where that reply is missing or unavailable. */
export const OTHER_ACTIVITY = Object.freeze([
  {
    key: 'screening',
    label: 'Screening',
    href: '/deals/screening',
    count: (r) => (r?.desk?.available && Array.isArray(r.desk.rows) ? r.desk.rows.length : null),
  },
  {
    key: 'commit',
    label: 'IC decisions',
    href: '/deals/commit',
    count: (r) => (r?.decisions?.available && Array.isArray(r.decisions.rows)
      ? r.decisions.rows.filter((d) => d?.status !== 'decided').length : null),
  },
  {
    key: 'closing',
    label: 'Closing',
    href: '/deals/closing',
    count: (r) => { const xs = rowsOf(r); return xs ? xs.filter((d) => dealStage(d) === 'closing').length : null; },
  },
  {
    key: 'rooms',
    label: 'Deal rooms',
    href: '#deal-rooms',
    count: (r) => { const xs = rowsOf(r); return xs ? xs.filter((d) => dealStage(d) !== null).length : null; },
  },
]);

/**
 * One entry per zone from four read states (`{ kind: 'loading' | 'ok' | 'unreadable', data }`).
 * `state` is what the line draws: `loading`, `count` with a number, or `unreadable`.
 */
export function otherActivityItems(reads) {
  return OTHER_ACTIVITY.map(({ key, label, href, count }) => {
    const read = reads?.[key];
    if (!read || read.kind === 'loading') return { key, label, href, state: 'loading', count: null };
    const n = read.kind === 'ok' ? count(read.data) : null;
    return n == null ? { key, label, href, state: 'unreadable', count: null } : { key, label, href, state: 'count', count: n };
  });
}

/** The words a screen reader hears for one entry; a count never stands in for an unread one. */
export function otherActivityLabel(item) {
  if (item.state === 'count') return `${item.label}: ${item.count}`;
  if (item.state === 'unreadable') return `${item.label}: could not be read`;
  return `${item.label}: reading`;
}
