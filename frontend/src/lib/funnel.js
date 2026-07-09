// Task #2 — First-party, consent-aware signup-funnel tracker.
//
// Fires the audit's ~15 funnel events (see ANALYTICS_FUNNEL.md) to the
// Worker's POST /api/track sink, which appends them to the D1 `funnel_events`
// table. No third-party analytics, no session replay.
//
// Privacy contract:
//   - GATED ON COOKIE CONSENT. Nothing is persisted or transmitted unless the
//     visitor granted the "analytics" category (lib/cookieConsent.js). While
//     the banner is undecided, events buffer IN MEMORY ONLY (capped) and are
//     flushed if the visitor accepts within the page session — discarded on
//     decline or page exit. On revoke, the queue, the anonymous id, and the
//     first-dashboard flag are all deleted.
//   - anon_id is a random UUID minted only after consent — never derived from
//     the user, never linked to an account id or email.
//   - URL capture is ALLOWLISTED (utm_source/utm_medium/utm_campaign, ref,
//     lane, invite, product). Full query strings are never read into events,
//     so verification / magic-link tokens can never ride along. `path` is
//     location.pathname only; `referrer` is a cross-origin origin only.
//   - Requests use `credentials:'omit'` (mirrors lib/log.js): no auth cookie,
//     no CSRF surface, no session token in the telemetry path. Do NOT switch
//     to navigator.sendBeacon — it always sends cookies.
//
// Like the error beacon, the network path is PROD-ONLY: the dev FastAPI has
// no /api/track, so in dev we console.debug instead of 404-spamming.
//
// Usage: track('register_view'); track('login_error', { code: 'bad_totp' });
//        trackOnce('dashboard_first_view');
// This module must NEVER throw.

import { safeReadJSON, safeWriteJSON, safeRemove } from './storage';
import { hasConsent, isDecided, subscribe } from './cookieConsent';

const isDev = typeof import.meta !== 'undefined' && !!import.meta.env && !!import.meta.env.DEV;

const ANON_KEY = 'axal:funnel_anon_id';        // localStorage (consent-scoped)
const ONCE_KEY = 'axal:funnel_once';           // localStorage — trackOnce() flags
const SESSION_KEY = 'axal:funnel_session_id';  // sessionStorage
const ATTR_KEY = 'axal:funnel_attribution';    // sessionStorage — first-touch UTM/ref/lane

const FLUSH_AT = 10;          // flush when the queue reaches this size
const FLUSH_MS = 5000;        // …or after this many ms
const MAX_BATCH = 20;         // server-side cap per request — keep in sync with track.ts
const PAGE_CAP = 50;          // self-cap per page session (runaway-loop guard)
const PRECONSENT_CAP = 20;    // in-memory buffer while the banner is undecided

// Keep in sync with FUNNEL_EVENT_ALLOWLIST in cloudflare-worker/src/routes/track.ts
// and the event table in ANALYTICS_FUNNEL.md.
export const FUNNEL_EVENTS = new Set([
  'landing_view',
  'register_view',
  'register_form_start',
  'register_field_error',
  'register_turnstile_failed',
  'register_submit',
  'register_success',
  'register_resend_click',
  'verify_email_view',
  'verify_email_result',
  'totp_setup_start',
  'totp_setup_complete',
  'totp_setup_abandon',
  'login_view',
  'login_submit',
  'login_error',
  'login_success',
  'onboarding_chat_view',
  'onboarding_chat_complete',
  'onboarding_chat_skip',
  'dashboard_first_view',
]);

// --- sessionStorage helpers (storage.js only covers localStorage) ----------
function sessionRead(key) {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function sessionWrite(key, value) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode / quota — tracking stays best-effort */ }
}
function sessionRemove(key) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(key);
  } catch { /* noop */ }
}

let _uuidCounter = 0;
function uuid() {
  try {
    if (typeof crypto !== 'undefined') {
      if (crypto.randomUUID) return crypto.randomUUID();
      if (crypto.getRandomValues) {
        // Older engines without randomUUID — still crypto-grade.
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return 'f' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      }
    }
  } catch { /* fall through */ }
  // Last resort (no Web Crypto at all): time-derived pseudonymous analytics id.
  // Deliberately avoids Math.random (CodeQL js/insecure-randomness).
  return 'f' + Date.now().toString(36) + (++_uuidCounter).toString(36);
}

// --- identity ---------------------------------------------------------------
// anon_id persists across sessions (funnel spans the email round-trip) but is
// only ever minted AFTER analytics consent. session_id is per-tab-session.
function getAnonId() {
  if (!hasConsent('analytics')) return null;
  let id = safeReadJSON(ANON_KEY, null);
  if (typeof id !== 'string' || !id) {
    id = uuid();
    safeWriteJSON(ANON_KEY, id);
  }
  return id;
}

// Held in module memory while the banner is undecided; only persisted to
// sessionStorage once analytics consent exists (pre-consent = memory only).
let _sessionId = null;
let _sessionPersisted = false;
function getSessionId() {
  if (!_sessionId) {
    const saved = sessionRead(SESSION_KEY);
    _sessionId = typeof saved === 'string' && saved ? saved : uuid();
    _sessionPersisted = _sessionId === saved;
  }
  if (!_sessionPersisted && hasConsent('analytics')) {
    sessionWrite(SESSION_KEY, _sessionId);
    _sessionPersisted = true;
  }
  return _sessionId;
}

// --- attribution (first-touch within the tab session) -----------------------
// Captured once from the ALLOWLISTED query params + referrer, persisted in
// sessionStorage so it survives the landing → register → verify hops. First
// value wins; later pages never overwrite (e.g. /verify-email has no ?ref=).
const LANES = ['partner', 'investor', 'lp', 'founder'];

// Like the session id: merged first-touch values live in module memory and
// are only written to sessionStorage after consent (pre-consent = memory only).
let _attr = null;
function readAttribution() {
  const saved = _attr || sessionRead(ATTR_KEY);
  const attr = saved && typeof saved === 'object' ? saved : {};
  try {
    const params = new URLSearchParams(window.location.search);
    const pick = (key) => {
      const v = (params.get(key) || '').trim();
      return v ? v.slice(0, 80) : null;
    };
    const merged = {
      utm_source: attr.utm_source || pick('utm_source'),
      utm_medium: attr.utm_medium || pick('utm_medium'),
      utm_campaign: attr.utm_campaign || pick('utm_campaign'),
      ref_code: attr.ref_code || pick('ref'),
      lane: attr.lane || (LANES.includes(params.get('lane')) ? params.get('lane') : null),
      // Invite type: explicit ?invite= wins; else infer from the entry point
      // (?invitee= = referral-invitation email, ?product= = product page CTA).
      invite_type:
        attr.invite_type ||
        pick('invite') ||
        (params.get('invitee') ? 'referral_email' : null) ||
        (pick('product') ? `product:${pick('product')}` : null),
      referrer: attr.referrer !== undefined ? attr.referrer : crossOriginReferrer(),
    };
    _attr = merged;
    if (hasConsent('analytics')
        && JSON.stringify(merged) !== JSON.stringify(sessionRead(ATTR_KEY))) {
      sessionWrite(ATTR_KEY, merged);
    }
    return merged;
  } catch {
    return attr;
  }
}

function crossOriginReferrer() {
  try {
    if (!document.referrer) return null;
    const origin = new URL(document.referrer).origin;
    return origin === window.location.origin ? null : origin.slice(0, 200);
  } catch { return null; }
}

function deviceKind() {
  try {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      return navigator.userAgentData.mobile ? 'mobile' : 'desktop';
    }
    return window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  } catch { return null; }
}

// --- queue + transport -------------------------------------------------------
let _queue = [];          // consented, awaiting flush
let _preConsent = [];     // banner undecided — memory only, never persisted
let _flushTimer = null;
let _sentCount = 0;

function buildEvent(event, props) {
  const attr = readAttribution();
  const entry = {
    event,
    anon_id: getAnonId(),
    session_id: getSessionId(),
    client_ts: Date.now(),
    path: typeof window !== 'undefined' && window.location ? window.location.pathname : null,
    referrer: attr.referrer || null,
    device: deviceKind(),
    utm_source: attr.utm_source || null,
    utm_medium: attr.utm_medium || null,
    utm_campaign: attr.utm_campaign || null,
    ref_code: attr.ref_code || null,
    lane: attr.lane || null,
    invite_type: attr.invite_type || null,
  };
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    // Shallow, scalar-only, capped — event props are labels, never payloads.
    const clean = {};
    let n = 0;
    for (const [k, v] of Object.entries(props)) {
      if (n >= 8) break;
      if (v == null) continue;
      const t = typeof v;
      if (t === 'string') clean[k] = v.slice(0, 120);
      else if (t === 'number' || t === 'boolean') clean[k] = v;
      else continue;
      n += 1;
    }
    if (Object.keys(clean).length) entry.props = clean;
  }
  return entry;
}

function send(events) {
  if (!events.length) return;
  if (isDev) {
    try { console.debug('[funnel] (dev, not sent)', events); } catch { /* noop */ }
    return;
  }
  try {
    if (typeof fetch !== 'function') return;
    fetch('/api/track', {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    }).catch(() => { /* telemetry is best-effort */ });
  } catch { /* never throw from the tracker */ }
}

function flush() {
  try {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    if (!hasConsent('analytics')) return;
    while (_queue.length) {
      send(_queue.splice(0, MAX_BATCH));
    }
  } catch { /* never throw */ }
}

function scheduleFlush() {
  if (_queue.length >= FLUSH_AT) { flush(); return; }
  if (_flushTimer) return;
  try {
    _flushTimer = setTimeout(() => { _flushTimer = null; flush(); }, FLUSH_MS);
  } catch { /* noop */ }
}

// --- public API --------------------------------------------------------------
export function track(event, props) {
  try {
    if (typeof window === 'undefined') return;
    if (!FUNNEL_EVENTS.has(event)) {
      if (isDev) console.warn('[funnel] unknown event dropped:', event);
      return;
    }
    if (_sentCount >= PAGE_CAP) return;

    const consent = hasConsent('analytics');
    const decided = consentDecided();
    if (!consent && decided) return; // declined — drop, full stop.

    _sentCount += 1;
    const entry = buildEvent(event, props);

    if (!consent) {
      // Banner undecided: hold in memory only; flushed on accept (below),
      // discarded on decline or page exit. anon_id is null here — it gets
      // stamped at flush time once consent exists.
      if (_preConsent.length < PRECONSENT_CAP) _preConsent.push(entry);
      return;
    }

    _queue.push(entry);
    // If the page is already hidden (e.g. pagehide-driven abandon events),
    // flush synchronously so the keepalive fetch can still leave.
    if (document.visibilityState === 'hidden') flush();
    else scheduleFlush();
  } catch { /* the tracker must never break a signup flow */ }
}

// Fire an event at most once per browser (per anon-id lifetime) — used for
// dashboard_first_view. The flag lives beside the anon id and is cleared with
// it on consent revoke.
export function trackOnce(event, props) {
  try {
    if (!hasConsent('analytics')) {
      // Without consent there is no durable identity to scope "once" to, and
      // buffering a maybe-duplicate is worse than dropping — skip entirely.
      return;
    }
    const seen = safeReadJSON(ONCE_KEY, {});
    const flags = seen && typeof seen === 'object' ? seen : {};
    if (flags[event]) return;
    flags[event] = Date.now();
    safeWriteJSON(ONCE_KEY, flags);
    track(event, props);
  } catch { /* never throw */ }
}

// hasConsent() is false both for "declined" and "not yet decided" — we need
// the distinction to know whether to buffer (undecided) or drop (declined).
function consentDecided() {
  try { return isDecided(); } catch { return false; }
}

// --- lifecycle wiring (module scope, browser only) ---------------------------
if (typeof window !== 'undefined') {
  try {
    // Consent transitions: grant → adopt the pre-consent buffer and flush;
    // revoke/decline → drop everything and erase the stored identity.
    subscribe(() => {
      try {
        if (hasConsent('analytics')) {
          // Persist the identity that was memory-only while undecided.
          getSessionId();
          readAttribution();
          if (_preConsent.length) {
            for (const e of _preConsent) {
              e.anon_id = getAnonId(); // minted now, at grant time
              _queue.push(e);
            }
            _preConsent = [];
          }
          flush();
        } else {
          _queue = [];
          _preConsent = [];
          safeRemove(ANON_KEY);
          safeRemove(ONCE_KEY);
          sessionRemove(SESSION_KEY);
          sessionRemove(ATTR_KEY);
          _sessionId = null;
          _sessionPersisted = false;
          _attr = null;
        }
      } catch { /* noop */ }
    });

    // Flush on page exit; pre-consent events never survive the page (but a
    // mere tab switch keeps the buffer — only real exits drop it).
    window.addEventListener('pagehide', () => {
      _preConsent = [];
      flush();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  } catch { /* tracking wiring must never break the app */ }
}
