import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';
import {
  isDecided,
  getConsent,
  acceptAll,
  rejectAll,
  saveConsent,
  COOKIE_ROWS,
  OPEN_PREFERENCES_EVENT,
} from '../lib/cookieConsent';
import './cookieConsent.css';

// Task #13 — Discreet cookie consent banner.
//
// A small, bottom-anchored card (NOT a full-width/blocking overlay). It renders
// only when no choice is recorded, or when reopened from the footer "Cookie
// preferences" link. Mounted globally in App.jsx inside a SafeMount so a render
// error degrades to "banner missing" rather than blanking the app.
//
// D680 — "More choices" and the footer's "Cookie preferences" open the owner's
// canvas dialog (COOKIE PREFERENCES), `CookiePreferencesDialog` below. It draws
// one row per entry in COOKIE_ROWS (lib/cookieConsent.js), which holds only the
// categories the site really sets. The first-visit banner keeps its look and
// its three choices; the canvas has no banner of its own.

// The optional purposes the banner names: the rows with a switch.
const OPTIONAL_PURPOSES = COOKIE_ROWS.filter((r) => !r.locked).map((r) => r.title.toLowerCase());

function prefsFromConsent() {
  const c = getConsent();
  return {
    functional: c.categories.functional,
    analytics: c.categories.analytics,
    advertising: c.categories.advertising,
  };
}

export default function CookieConsent() {
  // Initial visibility: only auto-show when the visitor hasn't decided yet.
  const [open, setOpen] = useState(() => !isDecided());
  const [view, setView] = useState('basic'); // 'basic' | 'prefs'
  const [prefs, setPrefs] = useState(prefsFromConsent);
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef(null);
  const focusOnOpenRef = useRef(false);

  // Move focus into the card only when it's *explicitly* reopened from the
  // footer link, so keyboard/screen-reader users land on the chooser. We skip
  // this on the first-visit auto-show so the card stays discreet (no focus
  // ring grabbing attention before the visitor has engaged).
  useEffect(() => {
    if (open && focusOnOpenRef.current && dialogRef.current) {
      dialogRef.current.focus();
      focusOnOpenRef.current = false;
    }
  }, [open, view]);

  // Reopen (from the footer link) at any time, pre-filled with the saved choice.
  useEffect(() => {
    const onOpen = () => {
      setPrefs(prefsFromConsent());
      setSaved(false);
      setView('prefs');
      focusOnOpenRef.current = true;
      setOpen(true);
    };
    window.addEventListener(OPEN_PREFERENCES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setView('basic');
    setSaved(false);
  }, []);

  // Dismissing via ✕, Esc or the dialog's backdrop records an explicit
  // "essential only" decision when the visitor hasn't chosen yet, so the banner
  // stops re-prompting on every refresh/navigation. No consent is inferred for
  // non-essential categories. If a choice already exists (reopened from the
  // footer link, or saved in the dialog), dismissing leaves it untouched.
  const dismiss = useCallback(() => {
    if (!isDecided()) rejectAll();
    close();
  }, [close]);

  // Esc dismisses — same persist-on-dismiss behavior as the ✕ button.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  const onAcceptAll = () => { acceptAll(); close(); };
  const onRejectAll = () => { rejectAll(); close(); };
  const openPrefs = () => { focusOnOpenRef.current = true; setView('prefs'); };

  if (view === 'prefs') {
    return (
      <CookiePreferencesDialog
        dialogRef={dialogRef}
        prefs={prefs}
        saved={saved}
        onToggle={(key) => { setPrefs((p) => ({ ...p, [key]: !p[key] })); setSaved(false); }}
        onSave={() => { saveConsent(prefs); setSaved(true); }}
        onAcceptAll={() => { const next = acceptAll(); setPrefs({ ...next.categories }); setSaved(true); }}
        onClose={dismiss}
      />
    );
  }

  const titleId = 'cookie-consent-title';
  const primaryBtn =
    'flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white ' +
    'hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 ' +
    'transition-colors';
  const secondaryBtn =
    'flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold ' +
    'text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 ' +
    'dark:hover:bg-gray-800 transition-colors';
  const linkBtn =
    'text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline ' +
    'dark:text-gray-400 dark:hover:text-gray-200';

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      // D504 — above the phone's tab bar. `--mobile-tabbar-h` is the bar's full
      // height, set on <html> only while a bar is drawn and only below 1024px
      // (mobileTabBar.css, D425), so this is 16px off the bottom everywhere a
      // bar is not drawn and 16px above the bar where one is. The fallback is
      // load-bearing: `var(--x)` with no fallback is an invalid value, which
      // would drop the rule and pin the card to the very bottom off a phone.
      style={{ bottom: 'calc(var(--mobile-tabbar-h, 0px) + 16px)' }}
      className="fixed z-50 left-4 right-4 sm:right-auto sm:max-w-sm
                 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl outline-none
                 dark:border-gray-700 dark:bg-gray-900 sm:p-5"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-700
                   dark:hover:text-gray-200"
      >
        <X size={16} />
      </button>

      <div className="flex items-center gap-2 pr-6">
        <Cookie size={18} className="shrink-0 text-gray-700 dark:text-gray-300" />
        <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
          We use cookies
        </h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {/* D680 — names only the optional purposes the site has (COOKIE_ROWS);
            it used to list functional and advertising, which nothing sets. */}
        By clicking “Accept all”, you agree to the storing of cookies on your device for{' '}
        {OPTIONAL_PURPOSES.join(' and ')} purposes.
      </p>

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onAcceptAll} className={primaryBtn}>Accept all</button>
        <button type="button" onClick={onRejectAll} className={secondaryBtn}>Reject all</button>
      </div>
      <button
        type="button"
        onClick={openPrefs}
        className={`${secondaryBtn} mt-2 w-full`}
      >
        More choices
      </button>

      <div className="mt-3 text-center">
        <Link to="/privacy" className={linkBtn}>See our privacy policy</Link>
      </div>
    </div>
  );
}

/**
 * D680 — the canvas's COOKIE PREFERENCES dialog. Presentational: the caller
 * owns the choice and what saving does. `rows` defaults to COOKIE_ROWS; when it
 * holds no optional row the dialog says the site sets none and offers no
 * switch to flip.
 */
export function CookiePreferencesDialog({
  rows = COOKIE_ROWS, prefs, saved, onToggle, onSave, onAcceptAll, onClose, dialogRef,
}) {
  const titleId = 'cookie-prefs-title';
  const optional = rows.filter((r) => !r.locked);
  return (
    <div className="ax-ck-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ax-ck"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ax-ck-head">
          <div>
            <h2 id={titleId} className="ax-ck-title">Cookie preferences</h2>
            <p className="ax-ck-intro">
              We use a minimal set of cookies. Essential cookies keep the workspaces signed in and cannot be
              disabled. Everything else is optional and off by default.
            </p>
          </div>
          <button type="button" className="ax-ck-x" aria-label="Close cookie preferences" onClick={onClose}>×</button>
        </div>

        <ul className="ax-ck-rows">
          {rows.map((row) => {
            const on = row.locked ? true : Boolean(prefs?.[row.key]);
            const tId = `ax-ck-${row.key}-t`;
            const dId = `ax-ck-${row.key}-d`;
            return (
              <li key={row.key} className="ax-ck-row" data-category={row.key}>
                <div className="ax-ck-text">
                  <div id={tId} className="ax-ck-t">{row.title}</div>
                  <div id={dId} className="ax-ck-d">{row.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={tId}
                  aria-describedby={dId}
                  disabled={row.locked}
                  className={`ax-ck-switch${on ? ' is-on' : ''}${row.locked ? ' is-locked' : ''}`}
                  onClick={row.locked ? undefined : () => onToggle(row.key)}
                >
                  <span className="ax-ck-knob" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>

        {optional.length === 0 ? (
          <p className="ax-ck-none">The site sets no optional cookies, so there is nothing to switch off.</p>
        ) : (
          <div className="ax-ck-actions">
            <button type="button" className="ax-ck-save" onClick={onSave}>Save preferences</button>
            <button type="button" className="ax-ck-all" onClick={onAcceptAll}>Accept all</button>
          </div>
        )}
        {saved && <p className="ax-ck-saved" role="status">Preferences saved.</p>}
      </div>
    </div>
  );
}
