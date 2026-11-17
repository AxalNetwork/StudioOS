/**
 * D6029 (#6029, BD23) — which sidebar rows list their own sub-pages right now.
 *
 * Build's row lists Overview · Plan · Progress, then the six modules
 * (`BUILD_SUBPAGES` in `sidebarConfig.js`), so on desktop the sidebar is the
 * one module switcher and the Build header draws no module tabs (BD23). That
 * holds only while the sidebar shows the list: it is open, expanded (not the
 * icon rail) and the shell's groups carry the row. Otherwise the set is empty
 * and every page keeps its tabs.
 *
 * Pure apart from the React context.
 */
import { createContext, useContext } from 'react';

/** The `to` of each row that carries `children`, across the groups. */
export function subpageRoots(groups) {
  const roots = new Set();
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const item of g?.items || []) if (Array.isArray(item?.children) && item.children.length) roots.add(item.to);
  }
  return roots;
}

/** A stable key for the roots (a memo dependency: the groups are rebuilt on every render). */
export function subpageRootsKey(groups) {
  return [...subpageRoots(groups)].sort().join('|');
}

/** The roots the sidebar lists now: none while it is closed or collapsed to icons. */
export function visibleSubpageRoots(groups, { open, collapsed }) {
  return open && !collapsed ? subpageRoots(groups) : new Set();
}

export const SidebarSubpagesContext = createContext(new Set());

/** True when the sidebar lists `root`'s sub-pages now (`/build`). */
export function useSidebarListsSubpages(root) {
  return useContext(SidebarSubpagesContext).has(root);
}
