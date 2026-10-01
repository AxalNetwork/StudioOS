/**
 * Deck share links and their views, as the Pitch Deck page shows them (D364).
 * Pure, so node --test runs it.
 *
 * The Worker already counts every view (GET /api/decks/:id/engagement reads
 * pitch_deck_share_tokens.view_count and deck_share_views); the Lab page never
 * showed it. Two facts about a link belong on screen beside it, because both
 * surprise a founder who assumes otherwise:
 *   - A link opens ONCE unless a view limit is asked for (decks.ts: view_limit
 *     defaults to 1, capped at 100). The Lab page asks for none, so every link
 *     it issues is single-view: forwarded, previewed by a mail scanner or
 *     opened twice, it is used up.
 *   - No link lives longer than 30 days (decks.ts caps expires_in_hours at
 *     24 × 30). There is no never-expiring link.
 */

/** The Worker's cap on a deck link's life, in hours (decks.ts). */
export const DECK_SHARE_MAX_HOURS = 24 * 30;

/** Rows GET /decks/:id/engagement reads from deck_share_views (its LIMIT). */
export const ENGAGEMENT_VIEW_ROWS = 200;

/** The sentence for a link's view limit, from the Worker's own answer. */
export function viewLimitCopy(viewLimit) {
  const n = Number(viewLimit);
  if (!Number.isInteger(n) || n < 1) return null;
  if (n === 1) {
    return 'Opens once: the first view uses it up, so issue a new link for each investor. A forwarded link, or one a mail scanner previews, will not open again.';
  }
  return `Opens up to ${n} times, then stops working.`;
}

/** "2026-09-27 18:07:20" (UTC, as D1 writes it) → epoch ms, or null. */
function utcMs(s) {
  if (!s) return null;
  const iso = String(s).includes('T') ? String(s) : `${String(s).replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * One link's state. Withdrawn outranks used up, which outranks expired: a
 * revoke also sets expires_at, so "expired" alone would hide that the founder
 * ended it.
 */
export function shareLinkState(share, nowMs = Date.now()) {
  if (share?.revoked_at) return 'withdrawn';
  if (share?.exhausted) return 'used_up';
  const exp = utcMs(share?.expires_at);
  if (exp !== null && exp <= nowMs) return 'expired';
  return 'live';
}

export const SHARE_STATE_LABEL = {
  live: 'Live',
  used_up: 'Used up',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};

/**
 * The engagement body → what the card shows. Every count is the Worker's;
 * nothing here is estimated. A body without a `shares` list is not a reading
 * of zero links, so it returns null for the page to render as Unreadable.
 */
export function summarizeDeckShares(engagement, nowMs = Date.now()) {
  if (!engagement || !Array.isArray(engagement.shares)) return null;
  const links = engagement.shares.map((s) => ({
    id: s.id,
    created_at: s.created_at,
    expires_at: s.expires_at,
    last_viewed_at: s.last_viewed_at || null,
    view_count: Number.isInteger(s.view_count) ? s.view_count : null,
    view_limit: Number.isInteger(s.view_limit) ? s.view_limit : null,
    state: shareLinkState(s, nowMs),
  }));
  return {
    links,
    live: links.filter((l) => l.state === 'live').length,
    totalViews: Number.isInteger(engagement.total_views) ? engagement.total_views : null,
    // The Worker reads at most ENGAGEMENT_VIEW_ROWS view rows, so a total at
    // that ceiling is "at least", not an exact count.
    viewsAtLeast: engagement.total_views === ENGAGEMENT_VIEW_ROWS,
    lastViewedAt: engagement.last_viewed_at || null,
  };
}
