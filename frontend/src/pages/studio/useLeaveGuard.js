/**
 * D4621 (#4621) — leaving a Studio with unsaved edits asks first.
 *
 * The app's router is a `BrowserRouter`, which has no blocker, so the three
 * ways out are caught here:
 *   - closing or reloading the tab: `beforeunload`;
 *   - a link: a plain same-origin click on an anchor, caught before the router
 *     sees it. Discard or Save then re-sends the same click, which the guard
 *     lets through once;
 *   - Back: a history entry is pushed when edits begin. Back lands on the
 *     entry beneath it, on the same page, so nothing unmounts; Stay pushes it
 *     again, Discard goes back once more.
 * Nothing is installed while there is nothing to lose.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** A plain left-click on a link that would change the page (not a hash, a new tab, a download or another site). Pure. */
export function leavingLink(event, here) {
  if (!event || event.defaultPrevented || event.button > 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const a = event.target?.closest?.('a[href]');
  if (!a) return null;
  if ((a.target && a.target !== '_self') || a.hasAttribute?.('download')) return null;
  let to;
  try { to = new URL(a.getAttribute('href'), here.href); } catch { return null; }
  if (to.origin !== here.origin) return null;
  if (to.pathname === here.pathname && to.search === here.search) return null;
  return a;
}

export function useLeaveGuard(dirty) {
  const [asking, setAsking] = useState(null); // { kind: 'link', anchor } | { kind: 'back' }
  const askingRef = useRef(null);
  const sentinel = useRef(false);
  const bypass = useRef(false);
  const ask = useCallback((next) => { askingRef.current = next; setAsking(next); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!dirty) {
      // Edits ended while the page stayed: take the extra entry back off.
      if (sentinel.current) { sentinel.current = false; window.history?.go?.(-1); }
      ask(null);
      return undefined;
    }
    const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      if (bypass.current) { bypass.current = false; return; }
      const a = leavingLink(e, window.location);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      ask({ kind: 'link', anchor: a });
    };
    const onPop = () => { sentinel.current = false; ask({ kind: 'back' }); };
    window.history?.pushState?.(window.history.state, '', window.location.href);
    sentinel.current = true;
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, ask]);

  // Stay: keep editing. A Back that was caught needs its entry again.
  const stay = useCallback(() => {
    if (askingRef.current?.kind === 'back' && !sentinel.current) {
      window.history?.pushState?.(window.history.state, '', window.location.href);
      sentinel.current = true;
    }
    ask(null);
  }, [ask]);

  // Go on to where the person was headed (after Discard, or once a save is done).
  const proceed = useCallback((held) => {
    const was = held || askingRef.current;
    ask(null);
    sentinel.current = false;
    if (was?.kind === 'link') { bypass.current = true; was.anchor.click(); }
    else if (was?.kind === 'back') window.history?.go?.(-1);
  }, [ask]);

  const current = useCallback(() => askingRef.current, []);
  return { asking: !!asking, kind: asking?.kind || null, stay, proceed, current };
}
