import { useSyncExternalStore } from 'react';

/**
 * D1317 — WHICH DETAIL SHEETS ARE OPEN, as a module store (`ui/Sheet.jsx`).
 *
 * The sheet and the Eadwyn rail sit in different subtrees of every page, so
 * they meet here, the way `eadwynPanel.js` joins the rail and a page's own
 * Eadwyn button. Two readers:
 *
 *   · `WorkerRail` draws its 44px spine while any sheet is open (without
 *     touching the member's stored preference), and its spine button closes
 *     the open sheets before it opens the rail: "opening the rail closes the
 *     sheet first".
 *   · `Sheet` reads nothing from here; it registers itself while mounted.
 *
 * A stack, so the spine closes the top sheet first and then the rest, each
 * through its own `onClose` (a route back to the list, a state flip).
 */
let stack = [];
const listeners = new Set();

function emit() { for (const l of listeners) l(); }
function subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const snapshot = () => stack.length > 0;
const serverSnapshot = () => false;

/** Register an open sheet; returns the function that unregisters it. */
export function pushSheet(id, close) {
  stack = [...stack, { id, close }];
  emit();
  return () => {
    const next = stack.filter((s) => s.id !== id);
    if (next.length === stack.length) return;
    stack = next;
    emit();
  };
}

/** Ask every open sheet to close, the top one first. */
export function closeSheets() {
  for (const s of [...stack].reverse()) s.close?.();
}

/** True while any sheet is open. */
export function useSheetOpen() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** For tests: how many sheets are open. */
export const openSheets = () => stack.length;
