/**
 * D722 — Google's own sign-in window for /login. No React here: the page owns
 * its state (hooks/README.md: state used by one page belongs in that page),
 * this file owns the browser half of the flow.
 *
 * WHICH WINDOW. Google Identity Services' authorization-code client in popup
 * mode — `google.accounts.oauth2.initCodeClient({ ux_mode: 'popup' })` — the
 * same `gsi/client` library and the same accounts.google.com window
 * mail.axal.vc opens when its server needs the result. The page gets a code,
 * never a token; only the Worker can exchange it (routes/auth_google.ts,
 * POST /api/auth/google/popup). The rendered ID-token button and One Tap are
 * not used: they run through FedCM and third-party iframes, the fragile part
 * this change exists to remove.
 *
 * THE CLICK IS SYNCHRONOUS. A browser lets a page open a window only inside
 * the click that asked for it, so `openCodePopup` does nothing that waits: it
 * builds the client and calls `requestCode()` in the same turn. The script is
 * loaded ahead of the click (`loadGis`, at idle and on hover/focus/touch); a
 * click that arrives before it has loaded takes the same-tab redirect instead.
 *
 * THE STATE. Each attempt gets 32 random bytes, written to a SameSite=Strict
 * cookie scoped to /api/auth/google and passed to Google, which hands it back
 * with the code. The Worker requires the two to match, so a code captured by
 * another page cannot sign this browser in, and the page ignores an answer
 * whose state is not the current attempt's.
 */

export const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const POPUP_STATE_COOKIE = 'studioos_google_popup';
export const POPUP_SCOPE = 'openid email profile';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A typed address worth handing Google as the account to preselect. */
export function looksLikeEmail(s) {
  return typeof s === 'string' && s.length <= 320 && EMAIL_RE.test(s);
}

let gisPromise = null;

/** True once the library is loaded and the code client is callable. */
export function gisReady() {
  return typeof window !== 'undefined'
    && typeof window.google?.accounts?.oauth2?.initCodeClient === 'function';
}

/**
 * Load the library once. A failed load (offline, a content blocker) resets,
 * so the next hover or click can try again; until then every click redirects.
 */
export function loadGis() {
  if (gisReady()) return Promise.resolve();
  if (typeof document === 'undefined') return Promise.reject(new Error('No document to load Google sign-in into.'));
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        try { s.remove(); } catch { /* already detached */ }
        reject(new Error('Could not load Google sign-in.'));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

/**
 * Run `fn` once the browser is idle, and at the latest after `timeoutMs`.
 * Safari has no requestIdleCallback, so it gets a short timeout instead.
 * Returns a cancel function.
 */
export function whenIdle(fn, timeoutMs = 1500) {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return () => { try { window.cancelIdleCallback(id); } catch { /* gone */ } };
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}

export function base64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes as 43 base64url characters — one sign-in attempt. */
export function newPopupState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function popupStateCookie(state) {
  return `${POPUP_STATE_COOKIE}=${state}; Path=/api/auth/google; Max-Age=600; Secure; SameSite=Strict`;
}

export function writePopupStateCookie(state) {
  document.cookie = popupStateCookie(state);
}

export function clearPopupStateCookie() {
  try {
    document.cookie = `${POPUP_STATE_COOKIE}=; Path=/api/auth/google; Max-Age=0; Secure; SameSite=Strict`;
  } catch { /* no document */ }
}

// ───────────────────────────────────── after Google's window answers ──
//
// Everything the page does once a code is in hand, as pure functions, so the
// node tests pin it without a browser (login_google_popup_d722.test.mjs).

/** The body POST /api/auth/google/popup takes: the typed address only when it is one. */
export function popupRequestBody({ code, state, typed }) {
  const body = { code, state };
  if (looksLikeEmail(typed)) body.expected_email = typed;
  return body;
}

/**
 * What a Google sign-in clears before it stores its own session (Task #4, as
 * useAuthSync does when the account changes): a previous person's Bearer, view
 * mode and impersonation handles must not ride along into this session.
 */
export const GOOGLE_SESSION_PURGE = ['token', 'viewMode', 'realUser', 'realToken'];

/**
 * Store the session /popup answered with, as passkey sign-in does, and return
 * where the page goes: `next` (a same-origin path the caller already checked),
 * else /onboarding for a new account, else /studio. An answer that is not a
 * session throws before anything is cleared or written.
 */
export function applyGoogleSession(res, storage, { next = null } = {}) {
  if (!res?.token || !res?.user) {
    const e = new Error('Invalid response from server.');
    e.code = 'internal_error';
    throw e;
  }
  for (const key of GOOGLE_SESSION_PURGE) {
    try { storage.removeItem(key); } catch { /* storage unavailable */ }
  }
  storage.setItem('token', res.token);
  storage.setItem('user', JSON.stringify(res.user));
  return next || (res.new_signup ? '/onboarding' : '/studio');
}

/**
 * Refusals of POST /popup that the same-tab redirect still gets past, so the
 * page continues there instead of stopping on an error: a rate limit (the
 * limiter refuses before any exchange, so nothing was spent), the limiter's
 * store being unavailable, and the switch turned off after this tab loaded.
 */
export function popupShouldRedirect(e) {
  return e?.status === 429 || e?.code === 'rate_limit_unavailable' || e?.code === 'popup_off';
}

/**
 * Whether this /login was opened as the owner's canary (`?google_window=1`):
 * while GOOGLE_SIGNIN_POPUP is "canary", only such a page is offered the window.
 */
export function wantsGoogleCanary(search) {
  try { return new URLSearchParams(search || '').get('google_window') === '1'; } catch { return false; }
}

/**
 * Open Google's window for one attempt. Synchronous on purpose (see the
 * header): build the code client, then `requestCode()`, in the click's own
 * turn. `onCode({ code, state })` gets a code whose state is this attempt's;
 * an answer carrying any other state is dropped. `onError({ type })` gets
 * GIS's own failure types (`popup_failed_to_open`, `popup_closed`) and
 * Google's refusals (`access_denied`, …) under one shape.
 */
export function openCodePopup({ clientId, state, loginHint, onCode, onError }) {
  const client = window.google.accounts.oauth2.initCodeClient({
    client_id: clientId,
    scope: POPUP_SCOPE,
    ux_mode: 'popup',
    state,
    select_account: true,
    ...(looksLikeEmail(loginHint) ? { login_hint: loginHint } : {}),
    callback: (r) => {
      if (!r || r.state !== state) return;
      if (r.code) onCode({ code: r.code, state: r.state });
      else onError({ type: r.error || 'unknown', state });
    },
    error_callback: (e) => onError({ type: (e && e.type) || 'unknown', state }),
  });
  client.requestCode();
}
