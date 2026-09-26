/**
 * What the command palette indexes, decided in one pure place (D284).
 *
 * For an admin shell — `admin` or `super_admin` — the palette indexes the
 * shell's own rows, the consoles the H35 map places, and the 29 working
 * pages. It never offers an `hqOnly` route to someone without the elevation,
 * never indexes the parked X, and every entry carries its real route. The
 * other shells keep indexing their own sidebar, as they did before.
 *
 * Pure, so `frontend/test/workspaces_launcher_d284.test.mjs` can put a
 * holder, a plain admin and a founder through it.
 */
import { SIDEBAR_GROUPS, hasTier, hasInvestorTier } from '../sidebarConfig.js';
import { ADMIN_PLACEMENT, WORKSPACES } from './adminPlacement.js';

export const KIND_ORDER = ['page', 'action', 'article', 'activity', 'doc'];

export const ADMIN_SHELLS = ['admin', 'super_admin'];

// The roles `/messages` admits, in App.jsx's own order. The top-bar Messages
// button is offered to exactly these, and the guard reads the route line to
// keep the two lists one.
export const MESSAGES_ROLES = ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'];

const pageItem = (to, label, hint) => ({ id: `page:${to}`, kind: 'page', label, hint, to });

/** A shell's own rows, tier-filtered, as the palette always indexed them. */
export function sidebarPageItems(role, user) {
  const groups = SIDEBAR_GROUPS[role] || SIDEBAR_GROUPS.founder || [];
  const out = [];
  for (const g of groups) {
    for (const it of g.items || []) {
      // Cmd+K should not jump into a paywall flow; the locked rail tile
      // already provides that path.
      if (it.requiredTier && !hasTier(user, it.requiredTier)) continue;
      if (it.requiredInvestorTier && !hasInvestorTier(user, it.requiredInvestorTier)) continue;
      out.push(pageItem(it.to, it.label, g.label));
    }
  }
  return out;
}

/** The admin index: the shell's rows, then the placed consoles, then the 29. */
export function adminPageItems(shellRole, { superAdmin = false } = {}) {
  const out = [];
  const seen = new Set();
  const add = (item) => {
    if (seen.has(item.to)) return;
    seen.add(item.to);
    out.push(item);
  };
  // A sidebar row can point at an hqOnly route (the plain admin shell's
  // Telegram row does, and its comment says the row ends at a notice for an
  // admin without the elevation). The map knows which routes those are, and
  // the palette offers none of them to someone the notice would stop.
  const hqOnlyRoutes = new Set(ADMIN_PLACEMENT.filter((e) => e.hqOnly).map((e) => e.route));
  for (const g of SIDEBAR_GROUPS[shellRole] || []) {
    for (const it of g.items || []) {
      if (hqOnlyRoutes.has(it.to) && !superAdmin) continue;
      add(pageItem(it.to, it.label, g.label));
    }
  }
  for (const e of ADMIN_PLACEMENT) {
    if (e.tier !== 'HQ' && e.tier !== 'Admin') continue;
    if (e.hqOnly && !superAdmin) continue;
    add(pageItem(e.route, e.label, `${e.tier} · ${e.row}`));
  }
  for (const w of WORKSPACES) add(pageItem(w.route, w.label, `Workspaces · ${w.group}`));
  return out;
}

export function pageItemsFor({ role, shellRole, user, superAdmin = false }) {
  if (ADMIN_SHELLS.includes(shellRole)) return adminPageItems(shellRole, { superAdmin });
  return sidebarPageItems(role, user);
}

/** Every kind gets a bucket, so a result of any indexed kind renders. */
export function groupByKind(items) {
  const out = Object.fromEntries(KIND_ORDER.map((k) => [k, []]));
  for (const it of items) if (out[it.kind]) out[it.kind].push(it);
  return out;
}
