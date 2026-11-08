/**
 * D4961 — leaving a page with unsaved changes asks first, whichever way you leave.
 *
 * The app mounts a declarative `<BrowserRouter>`, whose `useBlocker` does not exist (it needs a data router),
 * so the form only guarded a reload or a closed tab (`beforeunload`). Moving to Team, Legal or Projects, any
 * other in-app link, and the browser's Back and Forward all dropped the edits without a word.
 *
 * `createLeaveGuard({ win, navigator, confirmLeave })` closes the three doors:
 *
 *   1. A reload or a closed tab: `beforeunload`, as before.
 *   2. A link or a `navigate()`: the router's navigator (`UNSAFE_NavigationContext`) has `push`, `replace`
 *      and `go`; while the guard is on, each asks first and only then calls the original.
 *   3. Back and Forward: the browser has already moved when `popstate` fires, so the guard has to take the
 *      event before the router sees it. Leaving is confirmed, then the event is passed on once
 *      (re-dispatched, marked so the gate lets it through). Staying walks the history back by the
 *      distance the router recorded (`history.state.idx`), and that return trip is let through too.
 *
 * WHY A GATE INSTALLED AT BOOT. A browser runs a window's `popstate` listeners in the order they were added
 * (a capture flag does not move a listener ahead of an earlier one on the window itself; a real Chromium
 * showed it), and the router adds its listener when it mounts. A listener added when a form turns dirty is
 * therefore always behind the router's and stops nothing. `installLeaveGate()` adds ONE listener at app boot,
 * before the router mounts (`main.jsx`), and it defers to whichever guard is armed; with none armed it does
 * nothing. A guard armed without the gate installed installs it then, which still guards a window whose
 * router is not yet listening (the tests) but cannot get ahead of one that is.
 *
 * It is a controller with injected `win`, `navigator` and `confirmLeave` so a test can drive every branch
 * without a browser; `useLeaveGuard` is the thin React binding.
 */
import { useContext, useEffect, useRef } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

export const LEAVE_MESSAGE = 'Leave without saving? Your changes will be lost.';

/** The router stamps each history entry with `idx`; the distance between two entries is the difference. */
const idxOf = (state) => (state && Number.isInteger(state.idx) ? state.idx : null);

let armed = null;                 // the one guard that is on, if any
const gated = new WeakSet();      // windows that already carry the gate

/** Add the gate's one `popstate` listener to `win` (idempotent). Call it before the router mounts. */
export function installLeaveGate(win = typeof window !== 'undefined' ? window : null) {
  if (!win || gated.has(win)) return;
  gated.add(win);
  win.addEventListener('popstate', (e) => { if (armed) armed.onPop(e); }, true);
}

export function createLeaveGuard({ win, navigator = null, confirmLeave, message = LEAVE_MESSAGE }) {
  let on = false;
  let current = null;       // the history idx the router is showing
  let passing = false;      // a popstate we re-dispatched or caused ourselves: let it through
  const original = {};

  const ask = () => {
    try { return confirmLeave(message) !== false; } catch { return true; }
  };

  const beforeUnload = (e) => {
    e.preventDefault();
    e.returnValue = message;
    return message;
  };

  const onPop = (e) => {
    if (passing) { passing = false; return; }
    const next = idxOf(e.state ?? win.history?.state);
    const delta = current != null && next != null ? next - current : null;
    // Take it before the router does, then decide.
    e.stopImmediatePropagation?.();
    if (ask()) {
      // Leaving: hand the same event on, once.
      passing = true;
      win.dispatchEvent(new win.PopStateEvent('popstate', { state: e.state ?? win.history?.state }));
      current = next ?? current;
      // A return trip is always let through; this one was ours.
      passing = false;
    } else if (delta) {
      // Staying: undo the browser's move. The return popstate carries the entry we are already showing.
      passing = true;
      win.history.go(-delta);
    }
  };

  function wrapNavigator() {
    if (!navigator) return;
    for (const name of ['push', 'replace', 'go']) {
      if (typeof navigator[name] !== 'function') continue;
      original[name] = navigator[name];
      navigator[name] = (...args) => {
        if (!on) return original[name].apply(navigator, args);
        if (!ask()) return undefined;
        // The page is being left on purpose: from here the guard has nothing to protect.
        return original[name].apply(navigator, args);
      };
    }
  }

  function unwrapNavigator() {
    if (!navigator) return;
    for (const name of Object.keys(original)) {
      navigator[name] = original[name];
      delete original[name];
    }
  }

  return {
    onPop,
    /** Turn the guard on or off to match "there are unsaved changes". */
    set(dirty) {
      if (dirty === on) return;
      on = dirty;
      if (on) {
        current = idxOf(win.history?.state);
        win.addEventListener('beforeunload', beforeUnload);
        installLeaveGate(win);
        armed = this;
        wrapNavigator();
      } else {
        win.removeEventListener('beforeunload', beforeUnload);
        if (armed === this) armed = null;
        unwrapNavigator();
      }
    },
    dispose() { this.set(false); },
    get active() { return on; },
  };
}

/** Guard the current page while `dirty`; `confirmLeave` defaults to the browser's own confirm. */
export function useLeaveGuard(dirty, message = LEAVE_MESSAGE, confirmLeave = (m) => (typeof window !== 'undefined' ? window.confirm(m) : true)) {
  const nav = useContext(UNSAFE_NavigationContext);
  const guard = useRef(null);
  const confirmRef = useRef(confirmLeave);
  confirmRef.current = confirmLeave;
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    guard.current = createLeaveGuard({ win: window, navigator: nav?.navigator ?? null, confirmLeave: (m) => confirmRef.current(m), message });
    return () => guard.current?.dispose();
  }, [nav, message]);
  useEffect(() => { guard.current?.set(Boolean(dirty)); }, [dirty]);
}
