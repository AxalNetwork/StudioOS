/**
 * The H36 sub-navigation strips, and which HQ row a location lights (D285).
 *
 * Two rows of the HQ shell hold consoles the old Admin Console still renders:
 * Platform (nine items) and Content (seven). H36 draws each as a strip that
 * stays visible after the item lands in the old console, with the row still
 * lit. The strips below are H36's order, verbatim; the H35 map (D283) is what
 * they are held to — every legacy console placed as a sub-navigation item on
 * one of these rows is in its strip, and every strip item that is a legacy
 * console is placed on that row.
 *
 * THE SHELL RENDERS THE STRIPS AS LITERAL LINKS (App.jsx), not from this
 * list: `admin_route_reachability.test.mjs` reads navigation syntax in the
 * chrome and in routed pages, and a `.map` over data is not a door it can
 * see. `/admin/team`'s only door once D286 replaces the admin rows is the
 * Content strip, so the strip has to be literal. This list is what the row
 * highlight, the palette and the guard read, and the guard holds the chrome's
 * literal sequence equal to it.
 */
import { SIDEBAR_GROUPS } from '../sidebarConfig.js';
import { ADMIN_PLACEMENT } from './adminPlacement.js';

const strip = (pairs) => pairs.map(([label, route]) => ({ label, route }));

export const HQ_STRIPS = {
  Platform: strip([
    ['Overview', '/admin/platform'],
    ['Switches', '/admin/platform/switches'],
    ['Topology', '/admin/platform/topology'],
    ['Integration keys', '/admin?tab=integration-keys'],
    ['GitHub Sync', '/admin?tab=github'],
    ['Payments', '/admin?tab=payments'],
    ['Promo codes', '/admin?tab=promos'],
    ['Monitoring', '/monitoring'],
    ['Telegram', '/admin/telegram'],
  ]),
  Content: strip([
    ['Overview', '/admin/content'],
    ['Content queue', '/admin/articles'],
    ['Publications', '/admin/publications'],
    ['Assessment Studio', '/admin/assessment'],
    ['Personas', '/admin?tab=personas'],
    ['Advisors & Partners', '/admin?tab=network-profiles'],
    ['Public team page', '/admin/team'],
  ]),
};

/** HQ row label → the row's route, read off the shell rather than typed. */
export const HQ_ROW_ROUTE = Object.fromEntries(
  (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []).map((it) => [it.label, it.to]),
);

/** The location as a strip item writes it: the path, plus `?tab=` when one is set. */
export function hereFrom(pathname, search = '') {
  const tab = new URLSearchParams(search || '').get('tab');
  return tab ? `${pathname}?tab=${tab}` : pathname;
}

/** Which strip a location belongs to — 'Platform', 'Content' or null. */
export function stripFor(pathname, search = '') {
  const here = hereFrom(pathname, search);
  for (const [row, items] of Object.entries(HQ_STRIPS)) {
    if (items.some((i) => i.route === here)) return row;
  }
  return null;
}

/**
 * The HQ row a location lights, by route — or null when only the path
 * decides. A `?tab=` on /admin lights the HQ row the map places that tab on
 * (Contracts on legal, Team on users, Revenue on billing, Platform and
 * Content on theirs); a strip's own pages light the strip's row.
 */
export function hqRowFor(pathname, search = '') {
  const tab = pathname === '/admin' ? new URLSearchParams(search || '').get('tab') : null;
  if (tab) {
    const entry = ADMIN_PLACEMENT.find((e) => e.key === `tab:${tab}`);
    const onHq = entry && [entry, ...(entry.also || [])].find((p) => p.tier === 'HQ');
    return onHq ? (HQ_ROW_ROUTE[onHq.row] ?? null) : null;
  }
  const row = stripFor(pathname, search);
  return row ? (HQ_ROW_ROUTE[row] ?? null) : null;
}

/** Admin row label → the row's route, read off the shell rather than typed (D286). */
export const ADMIN_ROW_ROUTE = Object.fromEntries(
  (SIDEBAR_GROUPS.admin || []).flatMap((g) => g.items || []).map((it) => [it.label, it.to]),
);

/**
 * "This location lights no row" — distinct from `null`, which hands the
 * decision back to the path rules. On `/admin` the path rules cannot be
 * trusted: the Contracts row points at `/admin?tab=legal`, and `NavLink`
 * compares pathnames only, so it would light on every tab.
 */
export const NO_ROW = '';

/**
 * The Admin row a location lights on the S20 shell (D286), by route; `NO_ROW`
 * for an `/admin` tab the map places on no Admin row (Integration keys,
 * GitHub, Payments, Promo codes and Billing are HQ's); `null` everywhere
 * else, where the path — a row's own `to`, or its `match` list — decides.
 *
 * READ FROM THE H35 MAP, NOT TYPED: the `users` tab lights Accounts because
 * the map places it there (`also`), `legal` lights Contracts, `kyc`
 * Approvals, `wellbeing` Community. A bare `/admin` is the Users tab.
 */
export function adminRowFor(pathname, search = '') {
  if (pathname !== '/admin') return null;
  const tab = new URLSearchParams(search || '').get('tab') || 'users';
  const entry = ADMIN_PLACEMENT.find((e) => e.key === `tab:${tab}`);
  const onAdmin = entry && [entry, ...(entry.also || [])].find((p) => p.tier === 'Admin');
  return onAdmin ? (ADMIN_ROW_ROUTE[onAdmin.row] ?? NO_ROW) : NO_ROW;
}
