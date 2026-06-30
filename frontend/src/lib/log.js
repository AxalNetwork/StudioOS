// T18 / Task #10 — Lightweight client error reporter with PRODUCTION capture.
//
// Previously this was a prod no-op, which is why a production-only failure
// (e.g. the passkey → /studio blank) left no trace anywhere. Now reportError /
// reportWarn ALWAYS log to the console (dev + prod) and, in the browser:
//   1. push a sanitized entry to a capped localStorage ring buffer
//      (`axal:client-errors`) so support can retrieve recent errors straight
//      from an affected user's browser — no backend round-trip required; and
//   2. (errors only, prod only) fire a sanitized, fire-and-forget beacon to
//      POST /api/client-error so the failure lands in the Worker logs.
//
// No third-party dependency (no Sentry). The logger must NEVER throw and must
// NEVER include secrets/PII (tokens, cookies, the user object, query strings).
//
// Pattern: reportError('PageName:operation', err)

const isDev = typeof import.meta !== 'undefined' && !!import.meta.env && !!import.meta.env.DEV;

const RING_KEY = 'axal:client-errors';
const RING_MAX = 50;     // keep the last N entries only
const MSG_MAX = 500;     // clip noisy messages
const STACK_MAX = 2000;  // clip stacks to a usable excerpt

function clip(value, max) {
  if (value == null) return undefined;
  const str = String(value);
  return str.length > max ? str.slice(0, max) : str;
}

// Redact secrets / PII before anything is stored or beaconed. Error messages
// and stacks are free-form and can carry whatever a caller (or a thrown server
// error) put in them — tokens, emails, OAuth / magic-link query params, etc.
// This runs on the CLIENT so both the local ring buffer and the network beacon
// are already clean; the Worker never sees the raw values. Best-effort and
// deliberately over-eager (telemetry legibility < privacy). Never throws.
function redact(value) {
  if (value == null) return value;
  let s = String(value);
  try {
    // Strip query/fragment from any real URL so magic-link / oauth params don't ride along.
    s = s.replace(/(https?:\/\/[^\s'"]*?)[?#][^\s'"]*/gi, '$1[redacted]');
    // Emails.
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
    // JWTs (three base64url segments).
    s = s.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt]');
    // `Bearer <x>` and sensitive `key=value` / `key: value` pairs (incl. oauth/query params).
    s = s.replace(
      /\b(bearer\s+|(?:access_?token|id_?token|refresh_?token|token|auth|authorization|api[_-]?key|key|secret|password|pwd|code|state|nonce|sig|signature|otp)\s*[=:]\s*)([^\s&'";]+)/gi,
      '$1[redacted]',
    );
    // Backstop: long opaque token-like runs (mixed letters+digits, 24+ chars).
    s = s.replace(/\b[A-Za-z0-9_-]{24,}\b/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '[redacted]' : m));
  } catch { /* a bad regex pass must never break logging */ }
  return s;
}

// Build a sanitized, serializable entry. Only ever reads known-safe fields —
// deliberately NOT the user object, tokens, cookies, or the full URL (query
// strings can carry magic-link / oauth params). `pathname` only.
function toEntry(scope, err, level) {
  const isErrObj = err && typeof err === 'object';
  return {
    scope: clip(scope, 200) || 'unknown',
    level,
    name: isErrObj ? clip(err.name, 100) : undefined,
    message: clip(redact(isErrObj ? (err.message ?? String(err)) : err), MSG_MAX),
    stack: isErrObj ? clip(redact(err.stack), STACK_MAX) : undefined,
    path: redact((typeof window !== 'undefined' && window.location) ? window.location.pathname : undefined),
    ts: Date.now(),
  };
}

// Capped ring buffer in localStorage so support can read recent client errors
// from an affected user's browser (Console: `window.__axalErrors()`).
function pushRing(entry) {
  try {
    if (typeof localStorage === 'undefined') return;
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(RING_KEY) || '[]'); } catch { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push(entry);
    if (arr.length > RING_MAX) arr = arr.slice(arr.length - RING_MAX);
    localStorage.setItem(RING_KEY, JSON.stringify(arr));
  } catch { /* storage full / blocked / quota — never throw from the logger */ }
}

// Per-page-session self-throttle so an error loop can't beacon-DoS the user's
// own rate budget or the Worker logs: cap total beacons and dedupe identical
// (scope+message) reports within a short window.
let _beaconCount = 0;
const _BEACON_MAX = 25;
const _DEDUPE_MS = 5000;
const _recentBeacons = new Map();

// Fire-and-forget sanitized beacon. `credentials:'omit'` means no auth cookie
// is sent — that keeps the request outside CSRF enforcement AND guarantees no
// session token leaks into the telemetry path. `keepalive:true` lets it survive
// a page unload / redirect, which is exactly the "flash then blank" window we
// need to capture.
function beacon(entry) {
  try {
    if (typeof fetch !== 'function') return;
    if (_beaconCount >= _BEACON_MAX) return;
    const key = `${entry.scope}|${entry.message}`;
    const now = Date.now();
    if (now - (_recentBeacons.get(key) || 0) < _DEDUPE_MS) return;
    _recentBeacons.set(key, now);
    _beaconCount += 1;
    fetch('/api/client-error', {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => { /* telemetry is best-effort */ });
  } catch { /* never throw from the logger */ }
}

export function reportError(scope, err) {
  const entry = toEntry(scope, err, 'error');
  try { console.error(`[${entry.scope}]`, err); } catch { /* console missing */ }
  pushRing(entry);
  if (!isDev) beacon(entry);
}

export function reportWarn(scope, msg) {
  const entry = toEntry(scope, msg, 'warn');
  try { console.warn(`[${entry.scope}]`, msg); } catch { /* console missing */ }
  pushRing(entry);
  // Warnings are kept in the local ring buffer but NOT beaconed, to keep the
  // Worker log volume focused on real errors.
}

// Support/debug helpers — retrieve or clear the local ring buffer. Exposed on
// `window` (browser only) so support can ask a user to run
// `window.__axalErrors()` in the console and paste the output.
export function getClientErrors() {
  try { return JSON.parse(localStorage.getItem(RING_KEY) || '[]'); } catch { return []; }
}
export function clearClientErrors() {
  try { localStorage.removeItem(RING_KEY); } catch { /* noop */ }
}
if (typeof window !== 'undefined') {
  try {
    window.__axalErrors = getClientErrors;
    window.__axalClearErrors = clearClientErrors;
  } catch { /* readonly window — noop */ }
}
