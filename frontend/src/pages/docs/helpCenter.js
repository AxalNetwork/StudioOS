// D599 (#1280) — the Help Center's addresses and its one derived figure, as
// plain functions, so `help_center_contract.test.mjs` can run them rather than
// read them. No JSX and no imports: the layout and the test share this file.

/** `/help/<area>/<guide>` → `{ area, guide }`, anything else → null. */
export function parseGuidePath(pathname) {
  const m = /^\/help\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/.exec(String(pathname || ''));
  return m ? { area: m[1], guide: m[2] } : null;
}

/** The address of one guide, from its `<area>/<guide>` anchor. */
export const guideHref = (anchor) => `/help/${anchor}`;

/**
 * Where a `#<area>/<guide>` hash on `/help` should send the reader.
 *
 * That hash was every guide's address until each guide had its own page, and
 * it is in notifications already sent, the advisor's tools and bookmarks. So:
 *   - a guide the viewer can read → its page;
 *   - an admin-only anchor, for anyone but an admin → `/help`, dropping the
 *     hash, so the page behaves as if the guide did not exist;
 *   - anything else → null: the home stays as it is.
 */
export function hashTarget(hash, visibleSections, { isAdmin = false, restricted = new Set() } = {}) {
  const anchor = String(hash || '').replace(/^#/, '');
  if (!anchor) return null;
  if (!isAdmin && restricted.has(anchor)) return '/help';
  const [area, guide] = anchor.split('/');
  const known = (visibleSections || []).some(
    (s) => s.id === area && s.subsections.some((g) => g.id === guide),
  );
  return known ? guideHref(`${area}/${guide}`) : null;
}

/** Reading time from the guide's own words, at 200 a minute, never under one. */
export function readingMinutes(sub) {
  const text = [sub?.overview, ...(sub?.howto || []), ...(sub?.tips || []), ...(sub?.pitfalls || [])]
    .filter(Boolean).join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const OPEN_TICKET_STATES = new Set(['open', 'in_progress']);

/**
 * The open tickets in a `GET /api/tickets` reply, latest activity first.
 * Null when the reply is not a list, so the card can say the read failed
 * instead of showing a list of nothing.
 */
export function openTicketsByActivity(rows) {
  if (!Array.isArray(rows)) return null;
  const at = (t) => String(t?.updated_at || t?.created_at || '');
  return rows
    .filter((t) => t && OPEN_TICKET_STATES.has(t.status))
    .sort((a, b) => at(b).localeCompare(at(a)));
}
