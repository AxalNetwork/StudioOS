import { Briefcase, Check, DollarSign, Mail, TrendingUp } from 'lucide-react';
import { SIDEBAR_GROUPS } from '../sidebarConfig.js';

/**
 * The phone's navigation plan: four tabs and More, per licence (D425, D699).
 *
 * "Nothing is renamed and nothing is dropped" (M1) is a property of this
 * module:
 *
 *   - NOTHING IS RENAMED. Every tab and every More row that is a sidebar row
 *     is built FROM the sidebar row: its `to`, `label` and `match` come from
 *     `SIDEBAR_GROUPS`, never retyped here, so a tab lights for exactly the
 *     pages its row lights for. Only a tab's icon is the canvas's own (D699).
 *   - NOTHING IS DROPPED. Every row the founder sidebar holds lands in exactly
 *     one place: a tab, the band, or More, in the sidebar's own order. A row
 *     Session 5 adds to the sidebar appears in More without an edit here.
 *
 * D699 (Cycle Overview canvas, CO:219) supersedes D425's founder allocation:
 * the tabs are the four cycles, Validate, Build, Raise and Grow; Studio moves
 * to the band's glyph (`ui/phone/PhoneHeader.jsx`), so no tab and not More is
 * lit on `/studio` (CO:218); and More is a page, `/more`, not a sheet.
 *
 * FOUNDER FIRST. The other licences keep D425: `mobilePlan` returns null for
 * them and the bar draws nothing, rather than a founder bar on an investor's
 * phone.
 */

/** The canvas's founder tabs, in its order (CO:219). */
export const FOUNDER_TAB_PATHS = ['/validate', '/build', '/raise', '/grow'];

/** The canvas's tab icons (CO:593): a check, a briefcase, a dollar, a trend line. */
export const TAB_ICONS = {
  '/validate': Check,
  '/build': Briefcase,
  '/raise': DollarSign,
  '/grow': TrendingUp,
};

/** Sidebar rows the phone band carries, so More leaves them out (D699). */
export const FOUNDER_BAND_PATHS = ['/studio'];

/**
 * Doors that are not sidebar rows, carried in More because a phone has no
 * other way to them.
 *
 * - Messages left the sidebar for the top bar (D284), and the top bar hides
 *   it below 640px, so a phone had no Messages door at all.
 *
 * Trust and Company Settings were D425's More rows. Since D699 the account
 * sheet carries Trust Center and the company sheet carries Company Settings,
 * both opened from the band.
 *
 * Each is a route the founder guard already admits (`/messages` in App.jsx),
 * and `mobile_tab_bar_d425` holds that.
 */
export const FOUNDER_MORE_DOORS = [
  { to: '/messages', label: 'Messages', icon: Mail },
];

/** Every row of a licence's sidebar, flattened in display order. */
function sidebarRows(groups, role) {
  return (groups?.[role] || []).flatMap((g) => g.items || []);
}

/**
 * `{ tabs, more }` for a licence, or null where no phone plan is built yet.
 *
 * `groups` defaults to the live sidebar and is a parameter so a test can hand
 * it a sidebar with a row added and see the row reach More.
 */
export function mobilePlan(role, groups = SIDEBAR_GROUPS) {
  if (role !== 'founder') return null;
  const rows = sidebarRows(groups, 'founder');
  const tabs = FOUNDER_TAB_PATHS
    .map((to) => rows.find((r) => r.to === to))
    .filter(Boolean)
    .map((row) => ({ ...row, icon: TAB_ICONS[row.to] }));
  const elsewhere = new Set([...tabs.map((r) => r.to), ...FOUNDER_BAND_PATHS]);
  const more = [...rows.filter((r) => !elsewhere.has(r.to)), ...FOUNDER_MORE_DOORS];
  return { tabs, more };
}

/**
 * Whether a row owns the current path — the sidebar's own rule
 * (`ui/SidebarNav.jsx`), so a tab and its sidebar row light for the same
 * pages.
 *
 * A row that declares `match` owns its exact `to` plus each listed prefix and
 * that prefix's subtree, and nothing else: `/build` is the Build desk, while
 * `/build/discovery` is Validate's and `/build/team` is Grow's. A row with no
 * `match` owns its exact `to` only: the sidebar renders it as a `NavLink` with
 * `end`, so `/studio` does not light for `/studio/anything`. A trailing slash
 * is the same path, as it is to `NavLink`.
 */
export function rowActive(row, pathname) {
  let path = String(pathname || '');
  // A loop rather than a trailing-slash regex over the URL.
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const owns = (p) => path === p || path.startsWith(`${p}/`);
  if (Array.isArray(row?.match)) return path === row.to || row.match.some(owns);
  return path === row?.to;
}
