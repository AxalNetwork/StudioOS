/**
 * D4860 part 2 (#4860, finding 14, canvas PL-12) — the Eadwyn rail on an
 * operations screen: collapsed to its spine unless it is asked or pinned.
 *
 * On HQ's Platform consoles and Monitoring, health has to outrank the rail's
 * model choice and token balance, so a host that passes `operations` to
 * `WorkerRail` gets a rail that starts collapsed on every visit. It opens for
 * the visit when the operator opens it, and on every visit while it is pinned
 * open on that page ("Pin open on this page"). Each page keeps its own pin.
 *
 * The rail's shared collapse preference (`worker_rail_collapsed`, D406) is not
 * read or written by an operations rail, so collapsing here never collapses
 * the founder desks, and a member who keeps the rail open elsewhere still sees
 * Platform collapsed.
 *
 * The canvas also opens the rail for an actionable operational insight. No
 * store records such an insight, so nothing opens it that way (D4860, "Built
 * (part 2)").
 */

/** Per-viewer, per-browser: the pages whose operations rail is pinned open. */
export const RAIL_PINNED_KEY = 'worker_rail_pinned_pages';

/** A page's pin key: its path, without a trailing slash. */
export function pinPage(pathname) {
  const p = typeof pathname === 'string' ? pathname.trim() : '';
  if (!p) return null;
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** The stored list, read defensively: anything that is not a list of paths is no pins. */
export function pinnedPages(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((p) => typeof p === 'string' && p.startsWith('/')))];
}

export function isPinned(raw, pathname) {
  const page = pinPage(pathname);
  return page != null && pinnedPages(raw).includes(page);
}

/** The stored list with `pathname` pinned (`on`) or unpinned. */
export function withPin(raw, pathname, on) {
  const page = pinPage(pathname);
  const pages = pinnedPages(raw).filter((p) => p !== page);
  return on && page != null ? [...pages, page] : pages;
}

/**
 * Whether the rail draws its spine. A detail sheet always takes the spine
 * (D1317). An operations rail is open only while opened this visit; any other
 * rail follows the shared preference.
 */
export function railCollapsed({ operations = false, stored = false, visitOpen = false, sheetOpen = false } = {}) {
  if (sheetOpen) return true;
  return operations ? !visitOpen : stored === true;
}
