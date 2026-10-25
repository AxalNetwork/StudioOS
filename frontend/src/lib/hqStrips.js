/**
 * The H36 sub-navigation strips, and which HQ row a location lights (D285).
 *
 * Three rows of the HQ shell carry a strip: Licences (D981), Platform and
 * Content. H36 draws each as a strip that stays visible on every item's page,
 * with the row still lit. The strips below are H36's order, verbatim; the H35
 * map (D283) is what they are held to — every legacy console placed as a
 * sub-navigation item on one of these rows is in its strip, and every strip
 * item that is a legacy console is placed on that row. Since D938 (#2743)
 * each of those consoles is a page at its own address, not an `/admin` tab.
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

const strip = (pairs) => pairs.map(([label, route]) => ({ label, route }));

export const HQ_STRIPS = {
  // D981 (#2376): the ledger and Program grants, #2375's "Ledger · Program grants".
  Licences: strip([
    ['Ledger', '/admin/licences'],
    ['Program grants', '/admin/licences/programs'],
  ]),
  Platform: strip([
    ['Overview', '/admin/platform'],
    ['Switches', '/admin/platform/switches'],
    ['Topology', '/admin/platform/topology'],
    ['AI allowances', '/admin/platform/allowances'],
    ['AI usage', '/admin/platform/ai-usage'],
    // D938 (#2743): the four left the Admin Console for Platform's own addresses.
    ['Payments', '/admin/platform/payments'],
    ['Bank accounts', '/admin/platform/bank-accounts'],
    ['Product testing', '/admin/platform/product-testing'],
    ['Promo codes', '/admin/platform/promo-codes'],
    ['Monitoring', '/monitoring'],
    ['Telegram', '/admin/telegram'],
  ]),
  Content: strip([
    ['Overview', '/admin/content'],
    ['Content queue', '/admin/articles'],
    ['Publications', '/admin/publications'],
    ['Persona segments', '/admin/persona-segments'],
    ['Advisors & Partners', '/admin/advisors-partners'],
    ['Public team page', '/admin/team'],
  ]),
};

/** HQ row label → the row's route, read off the shell rather than typed. */
export const HQ_ROW_ROUTE = Object.fromEntries(
  (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []).map((it) => [it.label, it.to]),
);

/**
 * Which strip a location belongs to — 'Platform', 'Licences', 'Content' or
 * null. A page's tabs are sub-paths of its address (D936), so an item also
 * owns its subtree: `/admin/platform/promo-codes/usage` keeps the strip. Since
 * D938 no strip item lives on a query, so the path alone decides.
 */
const owns = (route, pathname) => route === pathname || pathname.startsWith(`${route}/`);

export function stripFor(pathname) {
  for (const [row, items] of Object.entries(HQ_STRIPS)) {
    if (items.some((i) => owns(i.route, pathname))) return row;
  }
  return null;
}

/**
 * The strip item a location opens: the item whose address is the longest
 * that owns it, so Platform's Overview is not lit on `/admin/platform/payments`
 * while Promo codes stays lit on its own tabs. Null off every strip.
 */
export function stripItemFor(pathname) {
  let hit = null;
  for (const items of Object.values(HQ_STRIPS)) {
    for (const i of items) if (owns(i.route, pathname) && (!hit || i.route.length > hit.length)) hit = i.route;
  }
  return hit;
}

/**
 * The HQ row a location lights, by its strip — or null when the path and the
 * rows' `match` lists decide. A strip's own pages light the strip's row, even
 * where the item's address sits under another row's path (`/monitoring`,
 * `/admin/persona-segments`).
 */
export function hqRowFor(pathname) {
  const row = stripFor(pathname);
  return row ? (HQ_ROW_ROUTE[row] ?? null) : null;
}
