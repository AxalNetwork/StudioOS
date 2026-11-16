import React, { useEffect, useRef, useState } from 'react';
import './signInSurface.css';

/**
 * #6958 (Sign In v2, canvas D6956) — the container /login's steps sit in.
 *
 * Desktop: one compact card centred over the artwork (SGN-01). No entrance
 * animation.
 *
 * Phone (below 640px): a bottom sheet, open on arrival, rising 280 ms (a 120 ms
 * fade under reduced motion), content height, rounded top, a flat scrim, the
 * skyline visible above it at rest (SGN-02). It is a modal dialog while open:
 * focus is contained in it, Escape goes Back one step (or closes it on the
 * first view), and closing it shows a "Sign in" button above the home
 * indicator that reopens it. Focus moves to that button on close and back to
 * the sheet's heading on reopen (SGN-13). With the keyboard open the sheet is
 * limited to the visual viewport and scrolls inside itself, and a focused
 * field is scrolled into view (SGN-11).
 *
 * The page owns the steps; this owns only the container. `onEscape` is called
 * for Escape inside it; return true to say the page handled it (a Back).
 */
const PHONE_QUERY = '(max-width: 639px)';

export function usePhoneLayout() {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(PHONE_QUERY).matches;
  const [phone, setPhone] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function SignInSurface({ phone, labelledBy, onEscape, children, testId = 'signin-surface' }) {
  const [open, setOpen] = useState(true);
  const sheetRef = useRef(null);
  const reopenRef = useRef(null);
  const closedOnce = useRef(false);

  // The sheet follows the visual viewport, so an open keyboard shrinks it and
  // it scrolls inside itself instead of hiding the field under the keyboard.
  useEffect(() => {
    if (!phone) return undefined;
    const vv = window.visualViewport;
    const set = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--signin-vvh', `${Math.round(h)}px`);
    };
    set();
    vv?.addEventListener('resize', set);
    window.addEventListener('resize', set);
    return () => {
      vv?.removeEventListener('resize', set);
      window.removeEventListener('resize', set);
      document.documentElement.style.removeProperty('--signin-vvh');
    };
  }, [phone]);

  // Focus follows the sheet: to "Sign in" when it closes, to the sheet's
  // heading when it reopens. The first open is the page's own load, which does
  // not take focus.
  useEffect(() => {
    if (!phone) return;
    if (!open) { reopenRef.current?.focus(); return; }
    if (closedOnce.current) {
      const h = labelledBy && document.getElementById(labelledBy);
      h?.focus();
    }
  }, [open, phone, labelledBy]);

  const close = () => { closedOnce.current = true; setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (onEscape?.()) { e.stopPropagation(); return; }
      if (phone) { e.stopPropagation(); close(); }
      return;
    }
    if (!phone || e.key !== 'Tab' || !sheetRef.current) return;
    // Focus containment for the open sheet.
    const items = [...sheetRef.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !sheetRef.current.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };

  // A focused field stays above the keyboard.
  const onFocus = (e) => {
    if (!phone) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && typeof t.scrollIntoView === 'function') {
      setTimeout(() => { try { t.scrollIntoView({ block: 'nearest' }); } catch { /* old engines */ } }, 250);
    }
  };

  if (!phone) {
    return (
      <main className="signin-center" aria-labelledby={labelledBy} data-testid={testId}>
        <section className="signin-card" onKeyDown={onKeyDown}>
          {children}
        </section>
      </main>
    );
  }

  return (
    <main className="signin-phone" aria-labelledby={labelledBy} data-testid={testId}>
      {open && <div className="signin-scrim" aria-hidden="true" />}
      {open ? (
        <section
          ref={sheetRef}
          className="signin-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          data-testid="signin-sheet"
        >
          <span className="signin-grab" aria-hidden="true" />
          <div className="signin-sheet-top">
            <button type="button" className="signin-close" aria-label="Close sign-in" onClick={close}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              Close
            </button>
          </div>
          {children}
        </section>
      ) : (
        <div className="signin-reopen">
          <button ref={reopenRef} type="button" className="signin-pill" onClick={() => setOpen(true)} data-testid="signin-reopen">
            Sign in
          </button>
        </div>
      )}
    </main>
  );
}
