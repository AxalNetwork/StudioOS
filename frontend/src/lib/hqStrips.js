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
 *
 * D4860 part 5 (#4860, findings 12 and 13). The Platform strip is grouped by
 * domain: an item's third field names its group, and `HqSubNavStrip` draws a
 * group's name before its first item. Two of Platform's consoles keep
 * addresses outside `/admin/platform` (Monitoring, Telegram): they belong to
 * Platform's row, and the strip says where they live (`outsidePlatform`)
 * rather than moving them. Integration keys stays an HQ row of its own (the
 * owner's ruling of 2026-10-20), so it is not in the strip; the overview's
 * Detailed consoles link to it across HQ.
 */
import { SIDEBAR_GROUPS } from '../sidebarConfig.js';

const strip = (rows) => rows.map(([label, route, group]) => (group ? { label, route, group } : { label, route }));

export const HQ_STRIPS = {
  // D981 (#2376): the ledger and Program grants, #2375's "Ledger · Program grants";
  // D4819 (#4819) names the second "Program access by licence", at the same address.
  Licences: strip([
    ['Ledger', '/admin/licences'],
    ['Program access by licence', '/admin/licences/programs'],
  ]),
  // D4860 part 5 (#4860, findings 12 and 13): grouped by domain, in the
  // groups and order of the overview's Detailed consoles (`CONSOLE_GROUPS`,
  // canvas PL-07), so Platform has one map. Overview leads, ungrouped.
  Platform: strip([
    ['Overview', '/admin/platform'],
    ['Monitoring', '/monitoring', 'Infrastructure'],
    ['Topology', '/admin/platform/topology', 'Infrastructure'],
    // D1172 (#3085, STG20): what members store, totals only.
    ['Storage', '/admin/platform/storage', 'Infrastructure'],
    // #3588: the meeting-bot runs and Diagnose Eadwyn AI had no strip link, only a card the owner could not find.
    ['Meeting bots', '/admin/platform/meeting-bots', 'Infrastructure'],
    // D938 (#2743): Payments, Bank accounts, Product testing and Promo codes left the Admin Console for Platform's own addresses.
    ['Payments', '/admin/platform/payments', 'Payments'],
    ['Bank accounts', '/admin/platform/bank-accounts', 'Payments'],
    ['Promo codes', '/admin/platform/promo-codes', 'Payments'],
    ['AI allowances', '/admin/platform/allowances', 'AI'],
    ['AI usage', '/admin/platform/ai-usage', 'AI'],
    // D1253 (#2428): the venture scorecard's model, indices and fairness check.
    ['Scoring', '/admin/platform/scoring', 'AI'],
    ['Telegram', '/admin/telegram', 'Integrations'],
    ['Switches', '/admin/platform/switches', 'Controls'],
    ['Product testing', '/admin/platform/product-testing', 'Product'],
    // D4155 (#4155): HQ › Decks, the deck studio's admin screens.
    ['Decks', '/admin/platform/decks', 'Product'],
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

/** Platform's own address family. */
export const PLATFORM_HOME = '/admin/platform';

/**
 * Whether a console lives outside Platform's address family (D4860 part 5,
 * finding 13): Monitoring and Telegram on the strip, Integration keys,
 * Licences or Security from the overview. One rule, read by the strip and the
 * overview's Detailed consoles, so the two say the same thing.
 */
export function outsidePlatform(route) {
  const path = String(route).split('?')[0].split('#')[0];
  return !owns(PLATFORM_HOME, path);
}

/**
 * The group a strip item opens, or null: the item's group when it differs
 * from the item before it in its strip. `HqSubNavStrip` draws it before the
 * item, so the literal links in App.jsx stay links and nothing else.
 */
export function stripGroupStart(route) {
  for (const items of Object.values(HQ_STRIPS)) {
    const i = items.findIndex((x) => x.route === route);
    if (i < 0) continue;
    const g = items[i].group || null;
    return g && g !== (items[i - 1]?.group || null) ? g : null;
  }
  return null;
}
