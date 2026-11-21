/**
 * D1597 (#3870) — Advisor › Expertise › Visibility: the read behind
 * `GET /api/advisors/me/visibility`, built only from what the product records.
 *
 *   surfaces  one row per booking link the advisor owns, plus `no_link`: the
 *             bookings created in the window on this advisor, by link, with
 *             their statuses (`advisor_bookings.booking_link_id`, migration 394).
 *   writing   the advisor's published pieces and their opens here on Axal
 *             (`articles.views`, lifetime: a counter, not a windowed figure).
 *             D4827 (#4827): `top` is the most-opened pieces (at most
 *             TOP_ARTICLES, by opens) and `others` the rest, as a count and
 *             their opens, so the parts add up to the whole.
 *   unlinked_services
 *             D4827: the advisor's active session types that no active booking
 *             link sells, so a founder cannot book them from a link. At most
 *             UNLINKED_PAGE, with `more` when there are others.
 *   views, engagements
 *             always null, each with its sentence. No profile view is recorded
 *             anywhere (owner answer H = b, 2026-11-01), and no engagement
 *             records the link or piece it came through.
 *
 * A FAILED READ IS NEVER A ZERO. `surfaces` and `writing` are read apart; one
 * that fails is null and `unreadable` is true, while the other still answers.
 * A zero is returned only when its read succeeded.
 *
 * LINKS ARE PAGED; ATTRIBUTION IS NOT (#4689). `surfaces` holds one page of
 * the advisor's links (`?limit=&offset=`, at most 100, ordered to `id`), and
 * `links` says where that page sits in the whole list. Each booking is matched
 * to its link in SQL, against every link the advisor owns, so a booking on
 * link 101 is that link's even when only links 1–100 are shown: it never
 * falls into "Booked without a link". `requests` is the window's total over
 * every link and none, so no figure describes only the page on screen.
 *
 * NOTHING IS ADDED UP ACROSS STORES: opens and booking requests are never one
 * "reach" figure, and no rate is computed over rows that name no surface.
 */
import type { Env } from '../types';
import { pageFacts, pageWindow, type PageFacts, type PageWindow } from './listPage';

/** The most booking links one page of `surfaces` holds. */
export const LINKS_PAGE = 100;

/** D4827: the most-opened pieces the writing block names one by one. */
export const TOP_ARTICLES = 3;
/** D4827: the most session types without a booking link the read lists. */
export const UNLINKED_PAGE = 20;

export const MIN_DAYS = 1;
export const MAX_DAYS = 370;
export const DEFAULT_DAYS = 30;

export const NO_LINK_NOTE = 'These bookings name no link: they were made before links were recorded, or without one.';
export const OPENS_NOTE = 'Times your pieces were opened here on Axal since each was published. An open is counted each time, so this is not a count of people. Where a piece ran elsewhere is not recorded.';
export const WRITING_REQUESTS_NOTE = 'A booking does not record which piece led to it.';
export const ENGAGEMENTS_NOTE = 'No engagement records the link or piece it came through, so none is attributed to a surface.';
export const VIEWS_NOTE = 'No profile view is recorded anywhere in the product, so a view count would be invented rather than measured.';

export interface VisibilityWindow { from: string; until: string; days: number }

/** The window: the last `days` days up to now, `days` clamped to 1–370 (30 when absent or not a number). */
export function visibilityWindow(raw: unknown, now = Date.now()): VisibilityWindow {
  const n = Math.trunc(Number(raw));
  const days = raw === undefined || raw === null || raw === '' || !Number.isFinite(n) ? DEFAULT_DAYS : Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
  return { from: new Date(now - days * 86_400_000).toISOString(), until: new Date(now).toISOString(), days };
}

export interface Surface {
  key: string;
  kind: 'booking_link' | 'no_link';
  name: string;
  audience?: string;
  is_active?: boolean;
  requests: number;
  by_status: Record<string, number>;
  views: null;
  note?: string;
}

export interface ArticleOpens { slug: string; title: string; opens: number; published_at: string | null }

export interface Writing {
  published: number;
  opens: number;
  opens_note: string;
  /** D4827: the most-opened pieces, by opens (lifetime, as `opens`). */
  top: ArticleOpens[];
  /** D4827: every other published piece, so `top` and `others` add up to `published` and `opens`. */
  others: { count: number; opens: number };
  requests: null;
  requests_note: string;
}

export interface UnlinkedServices { items: Array<{ uid: string; name: string }>; more: boolean }

type LinkRow = { id: number; uid: string; slug: string; audience: string; is_active: number };
type CountRow = { link_id: number | null; status: string; n: number };

export interface Requests { total: number; by_status: Record<string, number> }
export interface SurfacesRead { surfaces: Surface[]; links: PageFacts; requests: Requests }

/**
 * One page of the advisor's links, and the bookings created on this advisor in
 * the window grouped by link and status. The link is resolved in SQL against
 * all of the advisor's links: `link_id` is null only when the booking names no
 * link, or a link that is not this advisor's, and only those count under
 * `no_link`. A booking on a link outside this page is in `requests` and is
 * never `no_link`.
 */
async function readSurfaces(env: Env, advisorId: number, w: VisibilityWindow, page: PageWindow = { offset: 0, limit: LINKS_PAGE }): Promise<SurfacesRead> {
  const links = await env.DB.prepare(
    `SELECT id, uid, slug, audience, is_active FROM advisor_booking_links
      WHERE advisor_id = ? ORDER BY is_active DESC, id ASC LIMIT ? OFFSET ?`,
  ).bind(advisorId, page.limit, page.offset).all<LinkRow>();
  const linkTotal = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM advisor_booking_links WHERE advisor_id = ?',
  ).bind(advisorId).first<{ n: number }>();
  const counts = await env.DB.prepare(
    `SELECT l.id AS link_id, b.status AS status, COUNT(*) AS n
       FROM advisor_bookings b
       LEFT JOIN advisor_booking_links l ON l.id = b.booking_link_id AND l.advisor_id = b.advisor_id
      WHERE b.advisor_id = ? AND datetime(b.created_at) >= datetime(?) AND datetime(b.created_at) < datetime(?)
      GROUP BY l.id, b.status`,
  ).bind(advisorId, w.from, w.until).all<CountRow>();
  const own = (links.results || []) as LinkRow[];
  const byLink = new Map<number, Surface>();
  const surfaces: Surface[] = own.map((l) => {
    const s: Surface = {
      key: `link:${l.uid}`, kind: 'booking_link', name: `/b/${l.slug}`, audience: l.audience, is_active: !!l.is_active,
      requests: 0, by_status: {}, views: null,
    };
    byLink.set(l.id, s);
    return s;
  });
  const noLink: Surface = { key: 'no_link', kind: 'no_link', name: 'Booked without a link', requests: 0, by_status: {}, views: null, note: NO_LINK_NOTE };
  const requests: Requests = { total: 0, by_status: {} };
  for (const row of (counts.results || []) as CountRow[]) {
    const n = Number(row.n) || 0;
    requests.total += n;
    requests.by_status[row.status] = (requests.by_status[row.status] || 0) + n;
    // A link of this advisor's that is not on this page: counted in `requests`, drawn on its own page.
    const s = row.link_id == null ? noLink : byLink.get(Number(row.link_id));
    if (!s) continue;
    s.requests += n;
    s.by_status[row.status] = (s.by_status[row.status] || 0) + n;
  }
  return { surfaces: [...surfaces, noLink], links: pageFacts(page, Number(linkTotal?.n) || 0, own.length), requests };
}

/** The advisor's published pieces and their lifetime opens here on Axal. */
async function readWriting(env: Env, authorUserId: number): Promise<Writing> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS published, COALESCE(SUM(views), 0) AS opens FROM articles
      WHERE author_user_id = ? AND status = 'published'`,
  ).bind(authorUserId).first<{ published: number; opens: number }>();
  const top = await env.DB.prepare(
    `SELECT slug, title, views AS opens, published_at FROM articles
      WHERE author_user_id = ? AND status = 'published'
      ORDER BY views DESC, id ASC LIMIT ?`,
  ).bind(authorUserId, TOP_ARTICLES).all<{ slug: string; title: string; opens: number; published_at: string | null }>();
  const published = Number(row?.published) || 0;
  const opens = Number(row?.opens) || 0;
  const named = (top.results || []).map((a) => ({ slug: String(a.slug), title: String(a.title), opens: Number(a.opens) || 0, published_at: a.published_at ?? null }));
  return {
    published,
    opens,
    opens_note: OPENS_NOTE,
    top: named,
    others: { count: Math.max(0, published - named.length), opens: Math.max(0, opens - named.reduce((t, a) => t + a.opens, 0)) },
    requests: null,
    requests_note: WRITING_REQUESTS_NOTE,
  };
}

/**
 * D4827: the advisor's active session types that no active booking link sells. A link with no session type sells
 * none in particular, so it does not count for one.
 */
async function readUnlinkedServices(env: Env, advisorId: number): Promise<UnlinkedServices> {
  const rows = await env.DB.prepare(
    `SELECT t.uid, t.name FROM advisor_session_types t
      WHERE t.advisor_id = ? AND t.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM advisor_booking_links l
                         WHERE l.advisor_id = t.advisor_id AND l.session_type_id = t.id AND l.is_active = 1)
      ORDER BY t.sort_order, t.id LIMIT ?`,
  ).bind(advisorId, UNLINKED_PAGE + 1).all<{ uid: string; name: string }>();
  const all = (rows.results || []).map((r) => ({ uid: String(r.uid), name: String(r.name) }));
  return { items: all.slice(0, UNLINKED_PAGE), more: all.length > UNLINKED_PAGE };
}

/** The reads, replaceable in tests so one can fail alone. */
export const visibilityReads = { readSurfaces, readWriting, readUnlinkedServices };

export async function advisorVisibility(
  env: Env, who: { advisorId: number; userId: number }, rawDays: unknown, now = Date.now(),
  rawPage: { limit?: unknown; offset?: unknown } = {},
) {
  const window = visibilityWindow(rawDays, now);
  const page = pageWindow(rawPage, LINKS_PAGE);
  const [read, writing, unlinked] = await Promise.all([
    visibilityReads.readSurfaces(env, who.advisorId, window, page).catch((e) => { console.warn('[advisor_visibility] surfaces unreadable', e); return null; }),
    visibilityReads.readWriting(env, who.userId).catch((e) => { console.warn('[advisor_visibility] writing unreadable', e); return null; }),
    visibilityReads.readUnlinkedServices(env, who.advisorId).catch((e) => { console.warn('[advisor_visibility] session types unreadable', e); return null; }),
  ]);
  const surfaces = read ? read.surfaces : null;
  return {
    window,
    surfaces,
    // Null with `surfaces` when the links could not be read: never a zero.
    links: read ? read.links : null,
    requests: read ? read.requests : null,
    writing,
    // D4827: null when the session types could not be read, never an empty list.
    unlinked_services: unlinked,
    // Which block failed is the one that is null; this says that one did.
    unreadable: surfaces === null || writing === null || unlinked === null,
    engagements: null,
    engagements_note: ENGAGEMENTS_NOTE,
    views: null,
    views_note: VIEWS_NOTE,
  };
}
