// Task #13 — Cookie consent storage + helper.
//
// Consent lives entirely in the browser (localStorage via the safe helpers in
// ./storage). There is NO server-side logging or per-user storage — the visitor's
// choice is a local preference.
//
// The app loads no third-party analytics/advertising scripts today, so the
// Analytics/Advertising categories record the visitor's INTENT only — there is
// nothing to gate yet. Any future tracker MUST gate itself on hasConsent(cat)
// (and re-check via subscribe()) so it respects the stored choice.

import { safeReadJSON, safeWriteJSON, safeRemove } from './storage';

const STORAGE_KEY = 'axal_cookie_consent_v1';

// Bump when the cookie policy materially changes: a stored choice carrying an
// older version is treated as "not decided", so every visitor is re-prompted.
export const CONSENT_VERSION = 1;

// Order matters for display. Essential is always on and not toggleable.
export const COOKIE_CATEGORIES = ['essential', 'functional', 'analytics', 'advertising'];
const TOGGLEABLE = ['functional', 'analytics', 'advertising'];

const CHANGE_EVENT = 'axal:cookie_consent_changed';
export const OPEN_PREFERENCES_EVENT = 'axal:open_cookie_preferences';

function categoriesFrom(source, fallback) {
  const src = source && typeof source === 'object' ? source : {};
  const out = { essential: true };
  for (const key of TOGGLEABLE) {
    out[key] = src[key] === true ? true : src[key] === false ? false : fallback;
  }
  return out;
}

// Returns the persisted consent record, or null when nothing valid is stored
// (never decided, corrupted, or written under an older CONSENT_VERSION → the
// caller should treat that as "re-prompt").
export function readConsent() {
  const raw = safeReadJSON(STORAGE_KEY, null);
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== CONSENT_VERSION) return null;
  return {
    version: CONSENT_VERSION,
    decided: raw.decided === true,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    categories: categoriesFrom(raw.categories, false),
  };
}

// A safe, always-populated record for rendering the preferences form even
// before a choice is made (defaults: only essential on).
export function getConsent() {
  return (
    readConsent() || {
      version: CONSENT_VERSION,
      decided: false,
      updatedAt: null,
      categories: categoriesFrom(null, false),
    }
  );
}

export function isDecided() {
  const c = readConsent();
  return Boolean(c && c.decided);
}

// The reader other code uses to respect the visitor's choice. Essential is
// always granted; every other category requires a recorded, opted-in choice.
export function hasConsent(category) {
  if (category === 'essential') return true;
  const c = readConsent();
  if (!c || !c.decided) return false;
  return c.categories[category] === true;
}

export function saveConsent(categories) {
  const next = {
    version: CONSENT_VERSION,
    decided: true,
    updatedAt: new Date().toISOString(),
    categories: categoriesFrom(categories, false),
  };
  safeWriteJSON(STORAGE_KEY, next);
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  } catch { /* no window (SSR) */ }
  return next;
}

export function acceptAll() {
  return saveConsent(categoriesFrom(null, true));
}

export function rejectAll() {
  return saveConsent(categoriesFrom(null, false));
}

// Clears the stored choice — primarily for tests / manual reset.
export function resetConsent() {
  safeRemove(STORAGE_KEY);
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: null }));
  } catch { /* no window */ }
}

// Subscribe to consent changes — both in-tab (CustomEvent) and cross-tab
// (the native `storage` event fires in OTHER tabs). Returns an unsubscribe fn.
export function subscribe(callback) {
  if (typeof window === 'undefined') return () => {};
  const onChange = (e) => callback(e?.detail ?? readConsent());
  const onStorage = (e) => { if (e.key === STORAGE_KEY) callback(readConsent()); };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

// Fired by the footer "Cookie preferences" link to reopen the chooser.
export function openCookiePreferences() {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_EVENT));
  } catch { /* no window */ }
}
