import { guidePlacement } from './guidePlacement';

// D599 (#1280) — the Help Center's addresses and its one derived figure, as
// plain functions, so the layout and tests run the same address and signal
// helpers. D626 supplies task-area labels from the placement table.

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

// ── D621 (#1280 step 2) — "Popular this week" and "Did this answer it?" ──────
// The page side of D603's stores (`routes/help_center.ts`).

/** The guide an `<area>/<guide>` anchor names, among the sections given, or null. */
export function guideFor(anchor, sections) {
  const [area, guide] = String(anchor || '').split('/');
  const s = (sections || []).find((x) => x.id === area);
  const sub = s?.subsections.find((x) => x.id === guide);
  return sub ? { anchor: `${area}/${guide}`, title: sub.title, area: guidePlacement(`${area}/${guide}`)?.areaTitle || s.title } : null;
}

/** Cards in "Popular this week"; the page asks the route for its maximum, 10. */
export const POPULAR_SHOWN = 4;
export const POPULAR_ASKED = 10;
export const POPULAR_DAYS = 7;

/**
 * The cards from `GET /api/help/popular`: the first four the viewer can open,
 * in the route's order (most views, then the anchor). A guide the manifest no
 * longer has, or one this viewer cannot read, is left out, never shown as a
 * dead card. Null when the reply carries no list, so the card can say the read
 * failed instead of showing a week with nothing read.
 */
export function popularGuides(reply, sections) {
  if (!Array.isArray(reply?.guides)) return null;
  const out = [];
  for (const r of reply.guides) {
    const g = guideFor(r?.anchor, sections);
    const views = Number(r?.views);
    if (!g || !Number.isFinite(views) || views <= 0) continue;
    out.push({ ...g, views });
    if (out.length === POPULAR_SHOWN) break;
  }
  return out;
}

/** "1,240 views". A view is one member reading a guide on one day (D603). */
export const viewsLine = (n) => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? 'view' : 'views'}`;

/** What was missing is at most this long: `MISSING_MAX` in `routes/help_center.ts`. */
export const MISSING_MAX = 500;

/**
 * The reader's own answer, from `GET /api/help/guides/:area/:guide/feedback`
 * (`{ anchor, feedback }`, where `feedback` is null until they answer).
 */
export function feedbackFrom(reply) {
  if (!reply || typeof reply !== 'object' || !('feedback' in reply)) return { state: 'unreadable' };
  const f = reply.feedback;
  if (f == null) return { state: 'none' };
  if (f.answer !== 'yes' && f.answer !== 'no') return { state: 'unreadable' };
  return { state: 'answered', answer: f.answer, missing: f.answer === 'no' && f.missing ? String(f.missing) : null };
}

export const answeredLine = (answer) => (answer === 'yes' ? 'You said this answered it.' : 'You said this did not answer it.');

/**
 * The admin's view of every member's answers, from `GET /api/admin/help/feedback`:
 * per-guide counts, the route's order (most "no" first), and each "what was
 * missing", newest first. Each names its guide; one the manifest no longer has
 * keeps its anchor. Null when the reply is not that shape.
 */
export function adminFeedbackView(reply, sections) {
  if (!Array.isArray(reply?.guides) || !Array.isArray(reply?.missing)) return null;
  const name = (anchor) => guideFor(anchor, sections) || { anchor: String(anchor || ''), title: String(anchor || ''), area: null };
  const guides = reply.guides.map((g) => ({ ...name(g.anchor), yes: Number(g.yes) || 0, no: Number(g.no) || 0 }));
  return {
    guides,
    missing: reply.missing.map((m) => ({ ...name(m.anchor), text: String(m.text || ''), at: m.at || null })),
    yes: guides.reduce((n, g) => n + g.yes, 0),
    no: guides.reduce((n, g) => n + g.no, 0),
  };
}
