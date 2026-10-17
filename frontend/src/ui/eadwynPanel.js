import { useEffect, useSyncExternalStore } from 'react';

/**
 * D698 — THE EADWYN PANEL ON A PHONE, as a store (Cycle Overview canvas,
 * CO:30-36; D-h).
 *
 * Below 1024px a founder opens Eadwyn in a right panel, 300px wide. The page's
 * own Eadwyn button opens it (#1661's pushed bar, #1665's cycle pages, #1662's
 * account pages) through `openEadwynPanel(label)`; `WorkerRail` draws the
 * panel (`ui/EadwynPanel.jsx`) with its own body inside. A module store rather
 * than a provider, for the reason `hooks/useAssistMode.js` gives: the button
 * and the rail sit in different subtrees of about ninety pages.
 *
 * WHO IT SERVES (S1's ruling on #1660): a founder on a founder page, and no
 * one else. `available` is true only while a `WorkerRail` with
 * `role="founder"` is mounted for a viewer whose `useViewMode().shellRole` is
 * `'founder'` (the `role` prop stands in for the viewer only outside that
 * provider). Settings, Perks and every cycle page pass `role="founder"` to
 * every viewer, so the prop alone would serve an admin or an investor too; the
 * shell role is the role the session browses as, so an admin who chooses View
 * as founder is served, as they see #1661's phone shell. Everyone else keeps
 * D405's floating button and sheet.
 *
 * WHO OPENS IT. A page's own button registers itself with
 * `useEadwynTrigger()` while it is mounted. While none is, a served founder
 * keeps the rail's floating button, and it opens this panel, never the sheet:
 * about two dozen founder desks have no phone bar yet, and the button goes
 * page by page as the bars arrive (D-h).
 *
 * HOW IT CLOSES: the scrim, the ×, Escape, a route change, and the window
 * widening to 1024px. Each is an event on `eadwynPanelEvent`, which is what the
 * tests drive: this repository renders without a DOM.
 */
const CLOSERS = new Set(['scrim', 'close', 'escape', 'route', 'desktop']);

let state = { open: false, label: '', available: false, triggered: false };
let served = 0;
let triggers = 0;
const listeners = new Set();

function set(next) {
  if (next.open === state.open && next.label === state.label
    && next.available === state.available && next.triggered === state.triggered) return;
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const snapshot = () => state;
const CLOSED = { open: false, label: '', available: false, triggered: false };
const serverSnapshot = () => CLOSED;

/**
 * Every way the panel changes: `{ type: 'open', label }` and the five closers.
 * Nothing opens the panel for a viewer it does not serve.
 */
export function eadwynPanelEvent(event) {
  if (event?.type === 'open') {
    if (!state.available) return;
    const label = typeof event.label === 'string' ? event.label.trim() : '';
    set({ ...state, open: true, label });
    return;
  }
  if (state.open && CLOSERS.has(event?.type)) set({ ...state, open: false });
}

export const openEadwynPanel = (label) => eadwynPanelEvent({ type: 'open', label });
export const closeEadwynPanel = () => eadwynPanelEvent({ type: 'close' });

/** `{ open, label, available, triggered }`. Closed and unavailable on the server. */
export function useEadwynPanel() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * The rail says whether it serves its viewer, for as long as it is mounted.
 * Only `WorkerRail` calls this.
 */
export function useEadwynRailServes(serves) {
  useEffect(() => {
    if (!serves) return undefined;
    served += 1;
    set({ ...state, available: true });
    return () => {
      served -= 1;
      if (served <= 0) {
        served = 0;
        set({ ...state, open: false, available: false });
      }
    };
  }, [serves]);
}

/**
 * A page's own Eadwyn button calls this while it is mounted, so the rail
 * hides its floating button. It registers nothing while the panel serves no
 * one: no page can offer the panel to a viewer it does not serve.
 */
export function useEadwynTrigger() {
  const { available } = useEadwynPanel();
  useEffect(() => {
    if (!available) return undefined;
    triggers += 1;
    set({ ...state, triggered: true });
    return () => {
      triggers -= 1;
      if (triggers <= 0) {
        triggers = 0;
        set({ ...state, triggered: false });
      }
    };
  }, [available]);
  return available;
}

/** Test seam: forget every rail, trigger and listener. Never called by the app. */
export function __resetEadwynPanelForTest() {
  state = { ...CLOSED };
  served = 0;
  triggers = 0;
  listeners.clear();
}
