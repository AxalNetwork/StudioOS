import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, Check, X } from 'lucide-react';
import {
  isDecided,
  getConsent,
  acceptAll,
  rejectAll,
  saveConsent,
  OPEN_PREFERENCES_EVENT,
} from '../lib/cookieConsent';

// Task #13 — Discreet cookie consent banner.
//
// A small, bottom-anchored card (NOT a full-width/blocking overlay). It renders
// only when no choice is recorded, or when reopened from the footer "Cookie
// preferences" link. Mounted globally in App.jsx inside a SafeMount so a render
// error degrades to "banner missing" rather than blanking the app.

const TOGGLEABLE = [
  { key: 'functional', label: 'Functional', desc: 'Remember your preferences and settings.' },
  { key: 'analytics', label: 'Analytics', desc: 'Help us understand how the platform is used.' },
  { key: 'advertising', label: 'Advertising', desc: 'Support measuring or tailoring marketing.' },
];

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
  }, []);

  // Esc dismisses (a recorded choice persists; an undecided visitor is simply
  // re-prompted on the next load — never a trap).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const onAcceptAll = () => { acceptAll(); close(); };
  const onRejectAll = () => { rejectAll(); close(); };
  const onConfirm = () => { saveConsent(prefs); close(); };
  const toggle = (key) => setPrefs((p) => ({ ...p, [key]: !p[key] }));

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
      className="fixed z-50 bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm
                 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl outline-none
                 dark:border-gray-700 dark:bg-gray-900 sm:p-5"
    >
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-700
                   dark:hover:text-gray-200"
      >
        <X size={16} />
      </button>

      {view === 'basic' ? (
        <>
          <div className="flex items-center gap-2 pr-6">
            <Cookie size={18} className="shrink-0 text-gray-700 dark:text-gray-300" />
            <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
              We use cookies
            </h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            By clicking “Accept all”, you agree to the storing of cookies on your device for
            functional, analytics, and advertising purposes.
          </p>

          <div className="mt-4 flex gap-2">
            <button type="button" onClick={onAcceptAll} className={primaryBtn}>Accept all</button>
            <button type="button" onClick={onRejectAll} className={secondaryBtn}>Reject all</button>
          </div>
          <button
            type="button"
            onClick={() => setView('prefs')}
            className={`${secondaryBtn} mt-2 w-full`}
          >
            More choices
          </button>

          <div className="mt-3 text-center">
            <Link to="/privacy" className={linkBtn}>See our privacy policy</Link>
          </div>
        </>
      ) : (
        <>
          <h2 id={titleId} className="pr-6 text-base font-semibold text-gray-900 dark:text-white">
            What can we use data for?
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Essential cookies keep the platform working and are always on.
          </p>

          <div className="mt-3 space-y-1">
            {/* Essential — always on, not toggleable. */}
            <div
              role="checkbox"
              aria-checked="true"
              aria-disabled="true"
              aria-label="Essential — always on"
              className="flex items-start gap-3 rounded-lg px-2 py-2"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded
                           bg-gray-300 text-white dark:bg-gray-600"
              >
                <Check size={13} strokeWidth={3} />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                  Essential <span className="text-xs font-normal text-gray-400">· always on</span>
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  Required for sign-in, security, and remembering your choices.
                </span>
              </span>
            </div>

            {TOGGLEABLE.map(({ key, label, desc }) => {
              const checked = prefs[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(key)}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left
                             hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border
                      ${checked
                        ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                        : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900'}`}
                  >
                    {checked && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <button type="button" onClick={onConfirm} className={`${primaryBtn} mt-4 w-full`}>
            Confirm
          </button>

          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={() => setView('basic')} className={linkBtn}>
              Simpler choices
            </button>
            <Link to="/privacy" className={linkBtn}>See our privacy policy</Link>
          </div>
        </>
      )}
    </div>
  );
}
