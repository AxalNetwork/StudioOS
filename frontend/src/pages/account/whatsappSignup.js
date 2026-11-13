/**
 * D684 (#1575, S02 #1578) — Meta's WhatsApp Embedded Signup, in coexistence
 * mode, launched from "Connect WhatsApp Business".
 *
 * WHAT HAPPENS:
 *   1. The member clicks. Only then is Meta's JavaScript SDK loaded
 *      (`SDK_URL`); nothing from Meta is on the page before that.
 *   2. `FB.login` opens Meta's window with the configuration id the Worker
 *      handed out, asking for an authorization CODE (never a token in the
 *      browser) and the WhatsApp Business app onboarding, so the member keeps
 *      using their WhatsApp Business app on the same number.
 *   3. Meta's window posts a `WA_EMBEDDED_SIGNUP` message with the WABA and
 *      phone number ids it set up; the login callback carries the code. The
 *      message is read only from a facebook.com origin over https.
 *   4. The three go to `POST /api/channels/whatsapp/connect`, which exchanges
 *      the code server-side. The ids are never drawn on the page.
 *
 * Every browser dependency (`win`, `doc`, `FB`) is a parameter, so
 * `frontend/test/interview_channels_d684.test.mjs` runs the whole flow
 * against fakes.
 *
 * NO CSP STANDS IN THE WAY: the SPA's HTML carries no Content-Security-Policy
 * (see `frontend/public/_headers`), so neither the script from
 * connect.facebook.net nor Meta's window is blocked. If a CSP is ever added
 * there, it must allow `https://connect.facebook.net` (script) and
 * `https://www.facebook.com` (frame and window) on /account/connectors/* (the
 * hub and WhatsApp's own page, D753 C1) and the interview pages, or this
 * button stops working.
 */

export const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
export const SDK_ID = 'facebook-jssdk';
/** The Graph API version the SDK is initialised with, unless the Worker names another. */
export const DEFAULT_GRAPH_VERSION = 'v23.0';

/** The options `FB.login` is called with: a code, Embedded Signup, coexistence. */
export function signupLoginOptions(configId) {
  return {
    config_id: String(configId),
    response_type: 'code',
    override_default_response_type: true,
    extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
  };
}

/** Whether a `message` event came from Meta: https and facebook.com or a subdomain of it. */
export function isFacebookOrigin(origin) {
  try {
    const u = new URL(String(origin || ''));
    return u.protocol === 'https:' && (u.hostname === 'facebook.com' || u.hostname.endsWith('.facebook.com')) && !u.port;
  } catch {
    return false;
  }
}

const FINISH = new Set(['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING']);
const ID = /^\d{1,30}$/;

/**
 * One `message` event, read: `{ kind: 'finish', waba_id, phone_number_id }`,
 * `{ kind: 'cancel' }`, `{ kind: 'error' }`, or null for anything that is not
 * Embedded Signup's from Meta. A coexistence finish may name the WABA only;
 * the Worker then finds the number on it.
 */
export function readSignupMessage(event) {
  if (!event || !isFacebookOrigin(event.origin)) return null;
  let data = event.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || data.type !== 'WA_EMBEDDED_SIGNUP') return null;
  const ev = String(data.event || '');
  if (FINISH.has(ev)) {
    const waba = String(data.data?.waba_id ?? '');
    const phone = String(data.data?.phone_number_id ?? '');
    if (!ID.test(waba)) return { kind: 'error' };
    return { kind: 'finish', waba_id: waba, phone_number_id: ID.test(phone) ? phone : null };
  }
  if (ev === 'CANCEL') return { kind: 'cancel' };
  if (ev === 'ERROR') return { kind: 'error' };
  return null;
}

/** Why the flow stopped, in the member's words. */
export const SIGNUP_ERRORS = {
  cancelled: 'You closed Meta’s window before finishing. Nothing was connected.',
  meta_error: 'Meta could not finish setting up your number. Nothing was connected. Try again, or check the number in WhatsApp Manager.',
  incomplete: 'Meta did not say which number you chose. Nothing was connected. Try again.',
  sdk_failed: 'Meta’s sign-up window could not load. Check that your browser is not blocking connect.facebook.net, then try again.',
  not_configured: 'WhatsApp is not set up on Axal yet.',
};

export class SignupError extends Error {
  constructor(code) {
    super(SIGNUP_ERRORS[code] || SIGNUP_ERRORS.meta_error);
    this.name = 'SignupError';
    this.code = code;
  }
}

let sdkPromise = null;

/**
 * Load Meta's SDK once, on demand, and initialise it with the app id. A second
 * call reuses the first load. `doc`/`win` default to the page's.
 */
export function loadFacebookSdk({ appId, version = DEFAULT_GRAPH_VERSION, doc = globalThis.document, win = globalThis.window, timeoutMs = 20000 } = {}) {
  const init = (FB) => { FB.init({ appId: String(appId), autoLogAppEvents: true, xfbml: false, version }); return FB; };
  if (win?.FB && typeof win.FB.login === 'function') return Promise.resolve(init(win.FB));
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (!doc || !win) { reject(new SignupError('sdk_failed')); return; }
    // A script that failed is removed, so the next click loads it afresh.
    let s = null;
    const fail = () => { clearTimeout(timer); s?.remove?.(); reject(new SignupError('sdk_failed')); };
    const timer = setTimeout(fail, timeoutMs);
    win.fbAsyncInit = () => {
      clearTimeout(timer);
      try { resolve(init(win.FB)); } catch { reject(new SignupError('sdk_failed')); }
    };
    if (doc.getElementById?.(SDK_ID)) return;
    s = doc.createElement('script');
    s.id = SDK_ID;
    s.src = SDK_URL;
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = fail;
    (doc.body || doc.head).appendChild(s);
  }).catch((e) => { sdkPromise = null; throw e; });
  return sdkPromise;
}

/**
 * Run Embedded Signup with a loaded SDK: resolves `{ code, waba_id,
 * phone_number_id }` once Meta has sent both the ids and the code, rejects
 * with a `SignupError` otherwise. Call it straight from the click (the SDK
 * already loaded), so the browser lets Meta's window open.
 */
export function runEmbeddedSignup({ FB, win = globalThis.window, configId, idsWaitMs = 15000 }) {
  return new Promise((resolve, reject) => {
    let ids = null;
    let code = null;
    let done = false;
    let wait = null;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      if (wait) clearTimeout(wait);
      win.removeEventListener('message', onMessage);
      if (err) reject(err); else resolve(value);
    };
    const settle = () => {
      if (ids && code) finish(null, { code, waba_id: ids.waba_id, phone_number_id: ids.phone_number_id });
    };
    function onMessage(event) {
      const m = readSignupMessage(event);
      if (!m) return;
      if (m.kind === 'cancel') finish(new SignupError('cancelled'));
      else if (m.kind === 'error') finish(new SignupError('meta_error'));
      else { ids = m; settle(); }
    }
    win.addEventListener('message', onMessage);
    try {
      // A plain function: the SDK refuses an async callback.
      FB.login(function onLogin(response) {
        const c = response && response.authResponse && response.authResponse.code;
        if (!c) { finish(new SignupError('cancelled')); return; }
        code = String(c);
        settle();
        if (!done) wait = setTimeout(() => finish(new SignupError('incomplete')), idsWaitMs);
      }, signupLoginOptions(configId));
    } catch {
      finish(new SignupError('sdk_failed'));
    }
  });
}
