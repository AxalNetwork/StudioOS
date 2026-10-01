import { Building2, Mail, ShieldCheck } from 'lucide-react';
import { SIDEBAR_GROUPS } from '../sidebarConfig.js';

/**
 * The phone's navigation plan: four tabs and a More sheet, per licence (D425).
 *
 * The Mobile canvas (M1) keeps four rows as tabs by STANDING INTENTION: rows
 * opened by habit several times a session earn a tab, rows opened with intent
 * but less often go one tap deeper into More. "Nothing is renamed and nothing
 * is dropped." Both halves of that sentence are properties of this module:
 *
 *   - NOTHING IS RENAMED. Every tab and every More row that is a sidebar row
 *     is built FROM the sidebar row: its `to`, `label`, `icon` and `match`
 *     come from `SIDEBAR_GROUPS`, never retyped here. The canvas's "Home" tab
 *     is the founder's first row, which the sidebar calls "Studio", so the tab
 *     says "Studio".
 *   - NOTHING IS DROPPED. Every row the founder sidebar holds lands in exactly
 *     one place, tabs or More, in the sidebar's own order. A row Session 5 adds
 *     to the sidebar appears in More without an edit here.
 *
 * FOUNDER FIRST. The other three licences have allocations on the canvas and
 * are the next step; until each is built, `mobilePlan` returns null for it and
 * the bar draws nothing, rather than a founder bar on an investor's phone.
 */

/** M1's founder tabs, in the canvas's order: Home, Build, Raise, Grow. */
export const FOUNDER_TAB_PATHS = ['/studio', '/build', '/raise', '/grow'];

/**
 * Doors that are not sidebar rows, carried in More because a phone has no
 * other way to them.
 *
 * - Messages left the sidebar for the top bar (D284), and the top bar hides
 *   it below 640px, so a phone had no Messages door at all.
 * - Trust and Company Settings are the canvas's own More rows; on desktop they
 *   sit in the account menu.
 *
 * Each is a route the founder guard already admits (`/messages`, `/trust`,
 * `/company-settings` in App.jsx), and `mobile_tab_bar_d425` holds that.
 */
export const FOUNDER_MORE_DOORS = [
  { to: '/messages', label: 'Messages', icon: Mail },
  { to: '/trust', label: 'Trust', icon: ShieldCheck },
  { to: '/company-settings', label: 'Company Settings', icon: Building2 },
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
  const tabs = FOUNDER_TAB_PATHS.map((to) => rows.find((r) => r.to === to)).filter(Boolean);
  const onTab = new Set(tabs.map((r) => r.to));
  const more = [...rows.filter((r) => !onTab.has(r.to)), ...FOUNDER_MORE_DOORS];
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
