import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { googleSignInApi } from '../lib/api/googleSignIn.js';
import { appleSignInApi } from '../lib/api/appleSignIn.js';
import { track } from '../lib/funnel';
import { signInContextFor, storePendingNext, sameOriginNextPath } from '../lib/pendingNext';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import { loadTurnstile } from '../lib/turnstile';
import {
  loadGis, gisReady, whenIdle, newPopupState,
  writePopupStateCookie, clearPopupStateCookie, openCodePopup,
  popupRequestBody, applyGoogleSession, popupShouldRedirect, wantsGoogleCanary,
} from '../lib/googlePopup';
import {
  PARENT, stepFromSearch, searchForStep, restorableStep, EMAIL_RE,
  cleanCode, codeReady, stepForMagicError, APPLE_ERROR_COPY, isCancellation,
} from '../lib/loginSteps';
import AuthShell from '../components/auth/AuthShell';
import SignInSurface, { usePhoneLayout } from '../components/auth/SignInSurface';

// #6958 (Sign In v2, canvas D6956). The first view asks one question — how do
// you want to sign in? — with Continue with Email, Continue with Apple and
// Continue with Google, and a quiet Create an account link. Everything else
// appears inside the Email branch, at the step that needs it: the method
// chooser (sign-in link, passkey, authenticator code), then that method's own
// step. One centred card on desktop, a bottom sheet on a phone
// (components/auth/SignInSurface.jsx). Each step is a history entry
// (lib/loginSteps.js), so every Back goes one step up.
//
// SMS is intentionally NOT offered as a primary sign-in factor — it lives
// only in Settings → Security as a backup verification factor for account
// recovery. See cloudflare-worker/src/routes/auth_sms.ts.
//
// Turnstile is REQUIRED for the authenticator code (matches /register). It
// must never be removed. Backend `/api/auth/login` verifies the token via
// verifyTurnstile() and fails closed in production when the secret is unset.
// It is mounted only in the link and code steps, so the opening chooser shows
// no challenge.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

// Task #51 — "Continue with Google" error → toast copy. Mirrors the codes
// raised by routes/auth_google.ts::callbackError() so the user gets a
// human-readable explanation when the callback couldn't sign them in.
// D722 — the same map serves Google's window: the codes POST
// /api/auth/google/popup answers with, and GIS's own failure types
// (popup_failed_to_open, popup_closed, access_denied), so both ways in say
// the same thing for the same cause.
const GOOGLE_ERROR_COPY = {
  not_configured: "Google sign-in isn't available right now. Use Continue with Email.",
  cancelled: 'Google sign-in was cancelled. Nothing was changed.',
  access_denied: 'Google sign-in was cancelled. Nothing was changed.',
  popup_closed: 'Google sign-in was cancelled. Nothing was changed.',
  popup_failed_to_open: 'Your browser blocked the Google window, so Google is opening in this tab.',
  provider_error: "Google didn't confirm your sign-in. Please try again.",
  missing_code: 'Google sign-in failed. Please try again.',
  bad_state: 'This sign-in attempt expired. Press Continue with Google again.',
  bad_request: 'Google sign-in failed. Please try again.',
  bad_origin: 'Google sign-in failed. Please try again.',
  // The switch was turned off after this tab loaded, or the window's answer
  // was refused before any exchange (a rate limit): the redirect takes over.
  popup_off: 'Continuing with Google in this tab instead.',
  popup_fallback: 'Continuing with Google in this tab instead.',
  exchange_failed: "Google didn't confirm your sign-in. Please try again.",
  token_invalid: "We couldn't verify your Google account. Please try again.",
  email_unverified_at_google: 'Your Google email is not verified. Verify it with Google, then retry.',
  // Rule 2 links a verified address on its own, so the old "then link Google
  // in Settings" step is gone: confirming the address once is all it takes.
  link_blocked_unverified: "An Axal VC account already uses this email, but the address isn't confirmed yet. Use 'Email me a sign-in link' once to confirm it; after that, Continue with Google works.",
  // Rules 2 and 4 need Google to vouch for the inbox (gmail.com or a Workspace
  // account); for any other address the email link proves it, and Settings
  // binds Google from inside that session.
  link_requires_email_proof: "Google can't prove this inbox is yours. Use Continue with Email once, then link Google under Account → Security; after that, Continue with Google works.",
  // The page fills in both addresses when it has them (differentAccountCopy).
  different_account: 'Google signed in a different account. Continue with Google again and choose the account you use for Axal VC.',
  account_inactive: 'Your Axal VC account is inactive. Contact support.',
  internal_error: 'Something went wrong on our side. Please try again.',
  unreachable: "We couldn't reach Axal VC. Check your connection and try again.",
  // A 403 with no code of ours: the request arrived, and something in front of
  // the route refused it — a Cloudflare challenge, or the CSRF check on a
  // stale session cookie.
  security_check: "A security check stopped this sign-in. Reload the page and try again, or use Continue with Email.",
  rate_limited: 'Too many Google sign-in attempts from this network. Wait a minute, then try again.',
};

function differentAccountCopy(typed, googleEmail) {
  if (!typed || !googleEmail) return GOOGLE_ERROR_COPY.different_account;
  return `You typed ${typed}, but Google signed in ${googleEmail}. Choose ${typed} in the Google window, or clear the email field to continue as ${googleEmail}.`;
}

// What the person reads when POST /api/auth/google/popup does not sign them
// in. The server's code picks the sentence; a refusal with no code we know
// keeps the server's own sentence. No status at all is a network that never
// answered; a 403 with no code is not ours (a Cloudflare challenge, the CSRF
// check); a 429 names no bucket to the person. (A 429 normally never reaches
// this: `popupShouldRedirect` continues through the redirect first.)
function googlePopupErrorCopy(e, typed) {
  const code = e?.code;
  if (code === 'different_account') return differentAccountCopy(typed, e?.data?.google_email);
  if (code && GOOGLE_ERROR_COPY[code]) return GOOGLE_ERROR_COPY[code];
  if (code === 'timeout') return e.message;
  if (!e?.status) return GOOGLE_ERROR_COPY.unreachable;
  if (e.status === 403 && !code) return GOOGLE_ERROR_COPY.security_check;
  if (e.status === 429) return GOOGLE_ERROR_COPY.rate_limited;
  return e?.message || GOOGLE_ERROR_COPY.provider_error;
}

// BLOCK-AUTH-01 — copy for the codes raised by GET /api/auth/magic/verify when
// a magic link can't sign the user in (mirrors routes/auth.ts::fail()). The
// return opens the link step (stepForMagicError), ready to send a new one.
const MAGIC_ERROR_COPY = {
  invalid: 'That sign-in link is invalid. Send a new one.',
  expired: 'That sign-in link has expired or was already used. Send a new one.',
  rate: 'Too many attempts. Please wait a minute and try again.',
  // Not the person's fault, so it must not read like it is: `limiter` is what
  // /magic/verify returns when the rate-limit store could not be consulted at
  // all. Telling them to wait would be advice that never comes true.
  limiter: 'We could not check the request limit, so the link was refused. This is a problem on our side — please try the link again in a moment.',
  inactive: 'Your Axal VC account is inactive. Contact support.',
  error: 'Something went wrong completing your sign-in. Please try again.',
};

// Honor a `?next=` return path (e.g. a paid event invitation that bounced the
// user here to sign in) while refusing open redirects: the value is parsed
// against this origin and kept only if it stays here (`sameOriginNextPath`:
// a single leading `/`, no backslash or control character — `/\evil.com` and
// `/%09/evil.com` both resolve to evil.com in a browser). Everything else
// falls through to the default landing page chosen by the caller.
function safeNextPath() {
  try {
    return sameOriginNextPath(new URLSearchParams(window.location.search).get('next'), window.location.origin);
  } catch { /* ignore */ }
  return null;
}

/**
 * #4579 (D4579): the area the kept destination belongs to (Grow), so the page can say where signing in leads and what
 * account it needs; and the sign-up link that keeps the same destination. Null for a direct visit, which keeps the
 * generic page.
 */
function signInContext() {
  try { return signInContextFor(safeNextPath(), window.location.search); } catch { return null; }
}

/** The step this load opens: a magic-link return opens its retry view. */
function initialStep() {
  try {
    const params = new URLSearchParams(window.location.search);
    const magic = params.get('magic_error');
    if (magic) return stepForMagicError(magic);
    return restorableStep(stepFromSearch(window.location.search));
  } catch { return 'first'; }
}

const TITLE_ID = 'signin-title';

// ---- glyphs (decorative; every control is named by its visible text) ----
const Svg = ({ size = 18, children, stroke = true }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    {...(stroke ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } : {})}>
    {children}
  </svg>
);
const MailIcon = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5l8.5 6.5 8.5-6.5" /></Svg>;
const LinkIcon = () => <Svg><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>;
const KeyIcon = () => <Svg><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M17 6l3 3M14.5 8.5l2 2" /></Svg>;
const ShieldIcon = () => <Svg><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></Svg>;
const ChevIcon = () => <span className="signin-chev"><Svg size={16}><path d="M9 5l7 7-7 7" /></Svg></span>;
const BackIcon = () => <Svg size={16}><path d="M15 5l-7 7 7 7" /></Svg>;
const LockIcon = () => <Svg size={13}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
const AppleIcon = () => (
  <Svg size={19} stroke={false}>
    <path fill="currentColor" d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.21z" />
  </Svg>
);
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
const Spin = () => <span className="signin-spin" aria-hidden="true" />;

/**
 * Turnstile for one step. Mounted with the link or code form and removed with
 * it, in `interaction-only` mode, so Cloudflare shows a challenge only when it
 * wants one. `onFailed` fires when the script never arrives (~10s), so the
 * step can explain itself instead of leaving a dead button.
 */
function TurnstileBox({ onToken, onFailed }) {
  const ref = useRef(null);
  const widget = useRef(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return undefined;
    let interval = null;
    const render = () => {
      if (!ref.current || typeof window.turnstile === 'undefined') return;
      if (widget.current !== null) { try { window.turnstile.remove(widget.current); } catch {} }
      widget.current = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(''),
        appearance: 'interaction-only',
        theme: 'light',
      });
    };
    loadTurnstile().catch(() => {});
    if (typeof window.turnstile === 'undefined') {
      // Cap polling at 50 attempts (~10s) so a blocked Turnstile script
      // doesn't leak intervals.
      let attempts = 0;
      interval = setInterval(() => {
        attempts += 1;
        if (typeof window.turnstile !== 'undefined' && ref.current) { clearInterval(interval); render(); }
        else if (attempts >= 50) { clearInterval(interval); onFailed(); }
      }, 200);
    } else {
      render();
    }
    return () => {
      if (interval) clearInterval(interval);
      if (widget.current !== null) { try { window.turnstile.remove(widget.current); } catch {} widget.current = null; }
      onToken('');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} className="flex justify-center" data-testid="login-turnstile" />;
}

export default function LoginPage() {
  useForcedLightTheme();
  const phone = usePhoneLayout();
  const [context] = useState(signInContext);
  const [step, setStep] = useState(initialStep);
  const [email, setEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  // Bumped to remount a step's Turnstile after a refused try (a token is single-use).
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // An informational banner (a cancellation, a fallback): role=status, not alert.
  const [notice, setNotice] = useState('');
  // #4577: which field a message is about, so the input it names can say so (aria-invalid); the message itself is always described.
  const [errorField, setErrorField] = useState(null);
  useEffect(() => { if (!error) setErrorField(null); }, [error]);
  // The polite live region: one sentence for what is happening now.
  const [status, setStatus] = useState('');
  // D722 — '' | 'waiting' (Google's window is open) | 'signing' (its code is
  // with the Worker) | 'redirecting' (the same-tab fallback is under way).
  const [googleStage, setGoogleStage] = useState('');
  // `{ clientId }` once GET /api/auth/google/config says this deployment opens
  // Google's window; null means every click redirects. Refs, not state: the
  // button never renders differently for it, and the click reads it in the
  // same turn it opens the window.
  const googlePopupRef = useRef(null);
  const googleConfigAskedRef = useRef(false);
  const googleAttemptRef = useRef(null);
  const mountedRef = useRef(true);
  // D6957 — the Apple button shows only once /api/auth/apple/config says this
  // deployment is configured: a button that always fails is not shown (D6956).
  const [appleConfigured, setAppleConfigured] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  // BLOCK-AUTH-02 — passkey state.
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  // The full WebAuthn probe runs only after a passkey click. Checking property
  // presence here keeps the native API and browser library off initial render.
  const passkeySupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window;
  // Task #10 — passwordless magic-link sign-in (BLOCK-AUTH-01 finally gets UI).
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicSentTo, setMagicSentTo] = useState('');
  const [magicCooldown, setMagicCooldown] = useState(0);
  // Set when /login answers "Account not set up for TOTP authentication" —
  // e.g. partners created by deal activation. We swap the raw error for
  // friendly copy and steer them to the magic link.
  const [totpMissing, setTotpMissing] = useState(false);

  // ---- steps, history and focus ----
  // How many entries this page pushed, so Back can use the browser's own
  // history (which keeps the browser and the in-card Back in step) and fall
  // back to replacing the entry when the page was opened on a later step.
  const pushedRef = useRef(0);
  // The control that opened each step, so Back can return focus to it.
  const openerRef = useRef({});
  // Where focus goes after the next render: 'heading', an element id, or null
  // (the first render, which does not take focus).
  const focusRef = useRef(null);

  // A banner that must survive the step change it causes (a cancelled passkey
  // goes Back and says so). Applied after Back clears the old step's messages.
  const carryRef = useRef(null);
  const clearMessages = () => {
    setError(''); setNotice('');
    const carry = carryRef.current;
    carryRef.current = null;
    if (carry?.notice) setNotice(carry.notice);
    if (carry?.error) setError(carry.error);
  };

  const go = (next, openerId) => {
    if (openerId) openerRef.current[step] = openerId;
    clearMessages();
    focusRef.current = 'heading';
    try {
      window.history.pushState({ signinStep: next }, '', window.location.pathname + searchForStep(window.location.search, next));
      pushedRef.current += 1;
    } catch { /* a sandboxed frame: the step still changes */ }
    setStep(next);
  };

  const back = () => {
    const parent = PARENT[step];
    if (!parent) return false;
    if (pushedRef.current > 0) {
      window.history.back(); // popstate below moves the step
      return true;
    }
    clearMessages();
    focusRef.current = openerRef.current[parent] || 'heading';
    try { window.history.replaceState({ signinStep: parent }, '', window.location.pathname + searchForStep(window.location.search, parent)); } catch {}
    setStep(parent);
    return true;
  };

  useEffect(() => {
    const onPop = () => {
      pushedRef.current = Math.max(0, pushedRef.current - 1);
      const s = stepFromSearch(window.location.search);
      setStep((cur) => {
        // An action that already happened is not replayed by Forward: a sent
        // step with nothing sent, or a passkey step with no prompt, is its start.
        const next = (s === 'sent' && !magicSentToRef.current) || (s === 'passkey' && !passkeyBusyRef.current) ? restorableStep(s) : s;
        focusRef.current = PARENT[cur] === next ? (openerRef.current[next] || 'heading') : 'heading';
        return next;
      });
      clearMessages();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const magicSentToRef = useRef('');
  useEffect(() => { magicSentToRef.current = magicSentTo; }, [magicSentTo]);
  const passkeyBusyRef = useRef(false);
  useEffect(() => { passkeyBusyRef.current = passkeyBusy; }, [passkeyBusy]);

  useEffect(() => {
    const target = focusRef.current;
    focusRef.current = null;
    if (!target) return;
    const el = target === 'heading' ? document.getElementById(TITLE_ID) : document.getElementById(target);
    (el || document.getElementById(TITLE_ID))?.focus();
  }, [step]);

  // One-time codes are cleared on leaving the code step; the typed address is
  // kept for the whole visit.
  useEffect(() => {
    if (step !== 'code') { setTotpCode(''); setTotpMissing(false); }
    // Each step mounts its own Turnstile; a token never outlives its widget.
    setTurnstileToken('');
    setTurnstileFailed(false);
  }, [step]);

  useEffect(() => {
    if (magicCooldown <= 0) return;
    const t = setTimeout(() => setMagicCooldown(magicCooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [magicCooldown]);
  // The countdown is not read out each second: once at send, once at the end.
  useEffect(() => {
    if (magicSentTo && magicCooldown === 0) setStatus('You can resend the link now.');
  }, [magicCooldown, magicSentTo]);

  // Task #1 — persist `?next=` so the MAGIC-LINK path honours it too. The
  // TOTP and Google paths below read safeNextPath() directly, but the magic
  // link round-trips through the user's inbox and the worker's /magic/verify
  // (which lands on the default page); RequireAuth consumes this stored copy
  // post-auth and routes the user to their invitation target.
  useEffect(() => {
    storePendingNext(safeNextPath());
    // Task #2 — funnel: sign-in page reached.
    track('login_view');
  }, []);

  // NO PRE-FLIGHT PROBE for Google, and that is the fix rather than an
  // omission. This page used to call /api/auth/google/start on mount and render
  // the button only if that call succeeded; four unrelated failures each
  // removed the user's primary sign-in method (2026-09-21). A capability is not
  // predicted here any more — continueWithGoogle() calls /start for real and
  // surfaces the server's own answer, including GOOGLE_ERROR_COPY.not_configured
  // for a genuine 503.
  //
  // D722 — the one Google request this page makes before a click is NOT that
  // probe. GET /api/auth/google/config is a pure read of env (no D1, no KV, no
  // cookie), rate-limit exempt, run after first paint at idle, and it decides
  // only HOW the button works: Google's own window when the deployment
  // switched it on, the redirect otherwise. It never decides WHETHER the
  // button renders.
  //
  // D6957 — Apple's /config is the same kind of read and is asked at the same
  // idle moment. It does decide whether Apple's button renders: Apple is new,
  // and until a deployment is configured there is no Apple sign-in to offer.
  useEffect(() => {
    mountedRef.current = true;
    const cancel = whenIdle(() => askGoogleConfig());
    const cancelApple = whenIdle(() => {
      appleSignInApi.config().then((cfg) => {
        if (mountedRef.current && cfg?.configured === true) setAppleConfigured(true);
      }).catch(() => { /* no Apple button */ });
    });
    return () => { mountedRef.current = false; cancel(); cancelApple(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from Apple's or Google's page, a browser may restore this page from
  // its back-forward cache exactly as it left it: on "Taking you to Apple…"
  // with the button disabled. A restored page starts from a usable chooser.
  useEffect(() => {
    const onShow = (e) => {
      if (!e.persisted) return;
      setAppleBusy(false);
      setGoogleStage('');
      setStatus('');
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const askGoogleConfig = () => {
    if (googleConfigAskedRef.current) return;
    googleConfigAskedRef.current = true;
    // `/login?google_window=1` is the owner's canary page (GOOGLE_SIGNIN_POPUP
    // "canary"): only it is offered the window until the switch is "on".
    googleSignInApi.config({ canary: wantsGoogleCanary(window.location.search) }).then((cfg) => {
      if (!mountedRef.current) return;
      if (cfg?.popup === true && typeof cfg.client_id === 'string' && cfg.client_id) {
        googlePopupRef.current = { clientId: cfg.client_id };
        loadGis().catch(() => { /* every click redirects until a load succeeds */ });
      }
    }).catch(() => { /* the redirect is the answer */ });
  };

  // Hover, focus or a touch on the button: ask now if the idle call has not
  // run yet, and start loading Google's script if the window is on.
  const primeGoogle = () => {
    askGoogleConfig();
    if (googlePopupRef.current && !gisReady()) loadGis().catch(() => { /* redirect */ });
  };

  // One-shot banners for the codes a provider or a link bounced us back with.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = new URL(window.location.href);
    let touched = false;
    const google = params.get('google_error');
    if (google) {
      if (isCancellation(google)) setNotice(GOOGLE_ERROR_COPY[google]);
      else setError(GOOGLE_ERROR_COPY[google] || 'Google sign-in failed.');
      // Task #2 — funnel: OAuth callback bounced the user back with an error.
      track('login_error', { method: 'google', reason: google.slice(0, 40) });
      url.searchParams.delete('google_error'); touched = true;
    }
    const apple = params.get('apple_error');
    if (apple) {
      if (isCancellation(apple)) setNotice(APPLE_ERROR_COPY[apple]);
      else setError(APPLE_ERROR_COPY[apple] || "Apple didn't confirm your sign-in. Try again, or use Continue with Email.");
      track('login_error', { method: 'apple', reason: apple.slice(0, 40) });
      url.searchParams.delete('apple_error'); touched = true;
    }
    // BLOCK-AUTH-01 — a magic-link failure bounced back as ?magic_error=; the
    // page opened on the link step (initialStep), ready to send a new one.
    const magic = params.get('magic_error');
    if (magic) {
      setError(MAGIC_ERROR_COPY[magic] || 'That sign-in link could not be used. Send a new one.');
      // Task #2 — funnel: magic-link verify failed (expired/re-used/invalid).
      track('login_error', { method: 'magic', reason: magic.slice(0, 40) });
      url.searchParams.delete('magic_error'); touched = true;
      const s = stepForMagicError(magic);
      if (s === 'first') url.searchParams.delete('step'); else url.searchParams.set('step', s);
    }
    if (touched) window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
  }, []);

  // ---- Apple (D6957) ----
  // The whole tab goes to Apple: its answer comes back by form POST to the
  // Worker, never into this page. Independent of any address typed earlier.
  const continueWithApple = async () => {
    if (appleBusy) return;
    clearMessages();
    setAppleBusy(true);
    setStatus('Taking you to Apple…');
    track('login_submit', { method: 'apple' });
    try {
      const { url } = await appleSignInApi.startUrl({ action: 'signin', redirect: safeNextPath() || '/studio' });
      if (!url) throw new Error('No redirect URL returned.');
      window.location.href = url; // codeql[js/client-side-unvalidated-url-redirection] -- the Worker's own authorize URL for appleid.apple.com
    } catch (e) {
      setError(APPLE_ERROR_COPY[e?.code] || e?.message || "Sign in with Apple isn't available right now. Use Continue with Email.");
      setStatus('');
      setAppleBusy(false);
    }
  };

  // BLOCK-AUTH-02 — sign in with a passkey. Email is optional: a discoverable
  // (resident) credential lets the authenticator pick the account, so we pass
  // whatever's typed but don't require it. A passkey assertion mints a
  // full-assurance session server-side. Cancelling returns to the Email
  // methods with the other choices there.
  const signInWithPasskey = async () => {
    setPasskeyBusy(true); clearMessages();
    setStatus('Waiting for your passkey…');
    track('login_submit', { method: 'passkey' });
    try {
      const { startAuthentication, browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
      if (!browserSupportsWebAuthn()) {
        throw new Error('Passkeys are not supported in this browser. Use an authenticator code or sign-in link.');
      }
      const wanted = email.trim() || undefined;
      const options = await api.passkey.authOptions(wanted);
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await api.passkey.authVerify(wanted, assertion);
      if (!res?.token || !res?.user) throw new Error('Invalid response from server.');
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      // Task #2 — funnel: flushed by the tracker's pagehide hook as this
      // full-page navigation unloads the SPA.
      track('login_success', { method: 'passkey' });
      setStatus('Signing you in…');
      window.location.href = safeNextPath() || '/studio'; // codeql[js/client-side-unvalidated-url-redirection] -- safeNextPath() is parsed against this origin and kept only if it stays here; defence-in-depth
    } catch (e) {
      setStatus('');
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        track('login_error', { method: 'passkey', reason: 'cancelled' });
        carryRef.current = { notice: 'Passkey sign-in was cancelled. Nothing was changed.' };
        if (!back()) clearMessages();
      } else {
        setError(e?.message || 'Passkey sign-in failed.');
        track('login_error', { method: 'passkey' });
      }
    } finally { setPasskeyBusy(false); }
  };

  const choosePasskey = () => {
    go('passkey', 'signin-method-passkey');
    signInWithPasskey();
  };

  // D722 — Google's window answered with a code. Only the CURRENT attempt's
  // answer is used: a second click starts a fresh attempt, and a late answer
  // from the first window carries the first state, so it is dropped here.
  const finishGooglePopup = async ({ code, state }, typed) => {
    if (!state || state !== googleAttemptRef.current) return;
    googleAttemptRef.current = null;
    setGoogleStage('signing');
    setStatus('Signing you in…');
    try {
      // lib/googlePopup.js: the body, the Task #4 purge, the session and the
      // landing are pure functions there, pinned by node tests.
      const res = await googleSignInApi.popup(popupRequestBody({ code, state, typed }));
      clearPopupStateCookie();
      const landing = applyGoogleSession(res, localStorage, { next: safeNextPath() });
      track('login_success', { method: 'google' });
      window.location.href = landing; // codeql[js/client-side-unvalidated-url-redirection] -- landing is safeNextPath() (parsed against this origin and kept only if it stays here) or a literal
    } catch (e) {
      clearPopupStateCookie();
      if (popupShouldRedirect(e)) {
        // Refused before any exchange — a rate limit, the limiter's store, or
        // the switch turned off since this tab loaded. The redirect still works.
        track('login_error', { method: 'google', reason: String(e?.code || e?.status || 'popup').slice(0, 40) });
        continueWithGoogle({ forceRedirect: true, notice: GOOGLE_ERROR_COPY.popup_fallback });
        return;
      }
      setError(googlePopupErrorCopy(e, typed));
      track('login_error', { method: 'google', reason: String(e?.code || 'popup').slice(0, 40) });
      setGoogleStage('');
      setStatus('');
    }
  };

  // D722 — Google's window did not give us a code. A blocked window is not a
  // failure: the same-tab redirect takes over and says why.
  const failGooglePopup = ({ type, state }) => {
    if (!state || state !== googleAttemptRef.current) return;
    googleAttemptRef.current = null;
    clearPopupStateCookie();
    if (type === 'popup_failed_to_open') {
      track('login_error', { method: 'google', reason: 'popup_blocked' });
      continueWithGoogle({ forceRedirect: true, notice: GOOGLE_ERROR_COPY.popup_failed_to_open });
      return;
    }
    setGoogleStage('');
    setStatus('');
    if (isCancellation(type)) setNotice(GOOGLE_ERROR_COPY[type]);
    else setError(GOOGLE_ERROR_COPY[type] || GOOGLE_ERROR_COPY.provider_error);
    track('login_error', { method: 'google', reason: String(type || 'popup').slice(0, 40) });
  };

  // `opts` is read defensively because the button passes its click event.
  const continueWithGoogle = async (opts) => {
    const forceRedirect = opts?.forceRedirect === true;
    const popup = googlePopupRef.current;
    // D722 — Google's own window. NOTHING IS AWAITED between the click and
    // requestCode(): a browser opens a window only inside the click that asked
    // for it, and Safari counts an await as leaving it. The script was loaded
    // ahead of time; when it is not ready, the redirect below runs instead.
    if (!forceRedirect && popup && gisReady()) {
      clearMessages();
      track('login_submit', { method: 'google' });
      // #6958: Google launches from the first view, independent of any draft
      // address typed in the Email branch earlier in the visit, so no hint is
      // sent and no "different account" check is asked for.
      const typed = '';
      const state = newPopupState();
      googleAttemptRef.current = state;
      try {
        writePopupStateCookie(state);
        openCodePopup({
          clientId: popup.clientId,
          state,
          loginHint: typed,
          onCode: (r) => { finishGooglePopup(r, typed); },
          onError: failGooglePopup,
        });
        // Google reports a blocked window INSIDE requestCode(), before it
        // returns (gsi/client: `!this.i && this.error_callback ? …
        // "popup_failed_to_open"`), so failGooglePopup may already have spent
        // this attempt and started the redirect. Only a live attempt waits.
        // The button stays enabled while it does: pressing it again opens a
        // fresh attempt.
        if (googleAttemptRef.current === state) setGoogleStage('waiting');
        if (googleAttemptRef.current === state) setStatus('Waiting for Google…');
        return;
      } catch {
        // The library is there but refused to build a client — the redirect
        // still works, so use it rather than report a failure.
        googleAttemptRef.current = null;
        clearPopupStateCookie();
      }
    }
    setGoogleStage('redirecting'); setError(''); setNotice(opts?.notice || '');
    setStatus('Taking you to Google…');
    // Task #2 — funnel: no login_success counterpart here — the OAuth
    // callback lands the user signed in; failures bounce back as
    // ?google_error= (tracked above).
    if (!opts?.notice) track('login_submit', { method: 'google' });
    try {
      // Preserve a `?next=` return path (e.g. a paid event invite) across the
      // Google round-trip. The worker's /auth/google/start re-sanitizes the
      // `redirect` param (absolute same-origin path only) before signing it
      // into the OAuth state, so safeNextPath() here is defence-in-depth.
      const { url } = await api.googleStartUrl({ action: 'signin', redirect: safeNextPath() || '/studio' });
      if (!url) throw new Error('No redirect URL returned.');
      window.location.href = url;
    } catch (e) {
      setError(e?.message || 'Google sign-in unavailable.');
      setGoogleStage('');
      setStatus('');
    }
  };

  // ---- Task #41 — DEV-ONLY demo-account quick-login ----
  // The dev FastAPI backend exposes POST /api/auth/dev/quick-login
  // which mints a JWT for an allowlisted seeded demo account
  // without TOTP / Turnstile (refused entirely when ENVIRONMENT=production).
  // The button is gated on Vite's `import.meta.env.DEV` so the production
  // bundle never includes it.
  const showDemoQuickLogin = !!import.meta.env.DEV;
  const [demoLoading, setDemoLoading] = useState('');
  const demoLogin = async ({ email: demoEmail, landing } = {}) => {
    setDemoLoading(demoEmail || 'investor'); clearMessages();
    try {
      const res = await fetch('/api/auth/dev/quick-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(demoEmail ? { email: demoEmail } : {}),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Demo login unavailable (${res.status}). ${txt}`.trim());
      }
      const data = await res.json();
      if (!data?.token || !data?.user) throw new Error('Invalid response from demo login.');
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = landing || '/deals';
    } catch (e) {
      setError(e?.message || 'Demo login failed.');
    } finally { setDemoLoading(''); }
  };

  // ---- Authenticator code ----
  const submit = async () => {
    if (!email.trim()) { setErrorField('email'); setError('Enter your email.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setErrorField('email'); setError('Enter a valid email address (e.g. you@example.com).'); return; }
    if (TURNSTILE_SITE_KEY && turnstileFailed) {
      setError("Human verification couldn't load, so codes can't be checked. Use a sign-in link instead.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError('Please complete the verification challenge.');
      return;
    }
    if (!codeReady(totpCode)) { setErrorField('totp'); setError('Enter the 6-digit code from your authenticator, or a recovery code.'); return; }
    setLoading(true); clearMessages();
    setStatus('Signing you in…');
    track('login_submit', { method: 'totp' });
    try {
      const res = await api.login({ email: email.trim(), totp_code: totpCode, turnstileToken });
      if (!res?.token || !res?.user) throw new Error('Invalid response from server.');
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      // Task #2 — funnel: flushed by the tracker's pagehide hook as this
      // full-page navigation unloads the SPA.
      track('login_success', { method: 'totp' });
      // Relative path — stays on whichever canonical host the user signed in
      // on (axal.vc post-flip).
      window.location.href = safeNextPath() || '/studio'; // codeql[js/client-side-unvalidated-url-redirection] -- safeNextPath() is parsed against this origin and kept only if it stays here; defence-in-depth
    } catch (e) {
      setStatus('');
      const msg = e?.message || 'Sign in failed.';
      // Task #10 — accounts without a TOTP enrolment (e.g. partners created
      // by deal activation, magic-link signups) hit this exact server error.
      if (/not set up for TOTP/i.test(msg)) {
        setTotpMissing(true);
        track('login_error', { method: 'totp', reason: 'totp_missing' });
      } else {
        setErrorField('totp');
        setError(msg);
        track('login_error', { method: 'totp' });
      }
      setTotpCode('');
      // The widget is single-use: remount it for the next try.
      setTurnstileToken('');
      setTurnstileKey((k) => k + 1);
    } finally { setLoading(false); }
  };

  const pasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setTotpCode(cleanCode(text));
      document.getElementById('login-totp')?.focus();
    } catch {
      setNotice('Paste with your keyboard or the long-press menu instead.');
    }
  };

  // ---- Task #10 — request a magic sign-in link ----
  const sendMagicLink = async () => {
    const target = email.trim();
    if (!target) { setErrorField('email'); setError('Enter your email.'); return; }
    if (!EMAIL_RE.test(target)) { setErrorField('email'); setError('Enter a valid email address (e.g. you@example.com).'); return; }
    // Turnstile still gates the request when the widget is working; when it
    // failed to load, the magic link is deliberately the recovery path
    // (the endpoint has its own per-IP + per-email rate limits server-side).
    if (TURNSTILE_SITE_KEY && !turnstileFailed && !turnstileToken) {
      setError('Please complete the verification challenge first.');
      return;
    }
    if (magicBusy || magicCooldown > 0) return;
    setMagicBusy(true); clearMessages();
    setStatus('Sending link…');
    // Task #2 — funnel: "submit" for the magic path = link requested. The
    // sign-in itself completes server-side on /magic/verify; failures bounce
    // back as ?magic_error= (tracked above).
    track('login_submit', { method: 'magic' });
    try {
      await api.magicStart(target);
      setMagicSentTo(target);
      setMagicCooldown(60);
      setStatus(`Sign-in link sent to ${target}.`);
      if (step !== 'sent') go('sent', 'signin-send');
    } catch (e) {
      setStatus('');
      setError(e?.message || "We couldn't send your sign-in link. Try again in a moment.");
      track('login_error', { method: 'magic', reason: 'send_failed' });
    } finally { setMagicBusy(false); }
  };

  // D722 — while Google's window is open the button stays live (a second press
  // opens a fresh attempt); it locks only once a sign-in is actually under way.
  const googleLocked = googleStage === 'signing' || googleStage === 'redirecting';
  const GOOGLE_LABELS = {
    waiting: 'Waiting for Google…',
    signing: 'Signing you in…',
    redirecting: 'Redirecting…',
  };
  const googleLabel = GOOGLE_LABELS[googleStage] || 'Continue with Google';

  const onEscape = () => (step !== 'first' ? back() : false);

  // ---- pieces shared by the steps ----
  const heading = (text) => <h1 id={TITLE_ID} tabIndex={-1} className="signin-h1">{text}</h1>;
  const backButton = (
    <button type="button" className="signin-back" onClick={back}>
      <BackIcon />Back
    </button>
  );
  const destination = context ? (
    <p className="signin-dest" data-testid="login-destination-short"><LockIcon />After sign-in: <b>{context.area.name}</b></p>
  ) : null;
  const banners = (
    <>
      {error && (
        <div id="login-error" role="alert" className="signin-bn err">{error}</div>
      )}
      {notice && <div role="status" className="signin-bn info">{notice}</div>}
    </>
  );
  const otherMethod = (
    <p className="signin-links">
      <button type="button" className="signin-linkbtn" onClick={() => (PARENT[step] === 'email' ? back() : go('email'))}>Use a different method</button>
    </p>
  );
  const emailField = (
    <div>
      <label htmlFor="login-email" className="signin-lbl">Email</label>
      <input
        id="login-email"
        type="email"
        aria-invalid={error && errorField === 'email' ? true : undefined}
        aria-describedby={error ? 'login-error' : undefined}
        value={email}
        autoComplete="email"
        inputMode="email"
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (step === 'link') sendMagicLink(); else document.getElementById('login-totp')?.focus(); } }}
        placeholder="you@company.com"
        className="signin-in"
      />
    </div>
  );

  let body;
  if (step === 'email') {
    body = (
      <>
        {backButton}
        {destination}
        {heading('Sign in with email')}
        <p className="signin-sub muted">Choose how you want to prove it’s you.</p>
        {banners}
        <ul className="signin-meth" aria-label="Email sign-in methods">
          <li>
            <button type="button" id="signin-method-link" className="signin-row" onClick={() => go('link', 'signin-method-link')}>
              <span className="signin-rt"><LinkIcon /></span>
              <span className="signin-rx"><b>Email me a sign-in link</b><small>A link that works once, for 15 minutes</small></span>
              <ChevIcon />
            </button>
          </li>
          {passkeySupported && (
            <li>
              <button type="button" id="signin-method-passkey" className="signin-row" onClick={choosePasskey}>
                <span className="signin-rt"><KeyIcon /></span>
                <span className="signin-rx"><b>Use a passkey</b><small>Face ID, Touch ID, Windows Hello or a security key</small></span>
                <ChevIcon />
              </button>
            </li>
          )}
          <li>
            <button type="button" id="signin-method-code" className="signin-row" onClick={() => go('code', 'signin-method-code')}>
              <span className="signin-rt"><ShieldIcon /></span>
              <span className="signin-rx"><b>Use an authenticator code</b><small>The 6-digit code from your authenticator app</small></span>
              <ChevIcon />
            </button>
          </li>
        </ul>
        <p className="signin-links"><Link to="/auth/recover" className="signin-lk">Can’t sign in? Account recovery</Link></p>
      </>
    );
  } else if (step === 'link') {
    body = (
      <>
        {backButton}
        {destination}
        {heading('Email me a sign-in link')}
        <p className="signin-sub muted hide-on-type">We’ll send a link that signs you in. It works once and expires in 15 minutes.</p>
        {banners}
        <form className="signin-form" noValidate onSubmit={(e) => { e.preventDefault(); sendMagicLink(); }}>
          {emailField}
          <TurnstileBox key={`link-${turnstileKey}`} onToken={setTurnstileToken} onFailed={() => setTurnstileFailed(true)} />
          {TURNSTILE_SITE_KEY && turnstileFailed && (
            <div role="status" className="signin-bn warn">Human verification couldn’t load. You can still send a sign-in link.</div>
          )}
          <button type="submit" id="signin-send" className="signin-b pri" disabled={magicBusy}>
            {magicBusy ? <><Spin />Sending link…</> : 'Send sign-in link'}
          </button>
        </form>
        {otherMethod}
      </>
    );
  } else if (step === 'sent') {
    body = (
      <>
        {backButton}
        {destination}
        <span className="signin-big ok" aria-hidden="true"><MailIcon /></span>
        {heading('Check your email')}
        <p className="signin-sub">We sent a sign-in link to</p>
        <p className="signin-addr">{magicSentTo}</p>
        <p className="signin-sub">Open it on this device. It works once and expires in 15 minutes.</p>
        {banners}
        <div className="signin-form">
          <button type="button" className="signin-b sec" onClick={sendMagicLink} disabled={magicBusy || magicCooldown > 0}>
            {magicCooldown > 0 ? `Resend link in ${magicCooldown}s` : magicBusy ? 'Sending…' : 'Resend link'}
          </button>
        </div>
        <p className="signin-links">
          <button type="button" className="signin-linkbtn" onClick={back}>Change address</button>
          <button type="button" className="signin-linkbtn" onClick={() => go('email')}>Use a different method</button>
        </p>
        <p className="signin-fine">No email after a few minutes? Check spam, or confirm the address is the one on your account.</p>
      </>
    );
  } else if (step === 'code') {
    body = (
      <>
        {backButton}
        {destination}
        {heading('Use an authenticator code')}
        <p className="signin-sub muted hide-on-type">Open your authenticator app and enter the current code for Axal VC.</p>
        {banners}
        {totpMissing && (
          <div role="status" className="signin-bn info">
            Your account doesn’t use an authenticator yet — that’s normal if you joined by signing a partner agreement or through an email link.
            {' '}<button type="button" className="signin-linkbtn" onClick={() => go('link')}>Email me a sign-in link</button>
          </div>
        )}
        <form className="signin-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {emailField}
          <div>
            <label htmlFor="login-totp" className="signin-lbl">6-digit code</label>
            <div className="signin-codewrap">
              <input
                id="login-totp"
                type="text"
                aria-invalid={error && errorField === 'totp' ? true : undefined}
                aria-describedby={error ? 'login-error login-totp-help' : 'login-totp-help'}
                value={totpCode}
                inputMode={/[A-Za-z]/.test(totpCode) ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setTotpCode(cleanCode(e.target.value))}
                onPaste={(e) => { const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); setTotpCode(cleanCode(t)); } }}
                placeholder="000000"
                maxLength={24}
                className="signin-in code"
              />
              {typeof navigator !== 'undefined' && navigator.clipboard?.readText && (
                <button type="button" className="signin-paste" onClick={pasteCode}>Paste</button>
              )}
            </div>
            <p id="login-totp-help" className="signin-help">Paste works. A recovery code works here too.</p>
          </div>
          <TurnstileBox key={`code-${turnstileKey}`} onToken={setTurnstileToken} onFailed={() => setTurnstileFailed(true)} />
          {TURNSTILE_SITE_KEY && turnstileFailed && (
            <div role="status" className="signin-bn warn">
              Human verification couldn’t load, so codes can’t be checked.{' '}
              <button type="button" className="signin-linkbtn" onClick={() => go('link')}>Use a sign-in link instead</button>
            </div>
          )}
          <button
            type="submit"
            className="signin-b pri"
            disabled={loading || (TURNSTILE_SITE_KEY && (turnstileFailed || !turnstileToken)) || !codeReady(totpCode)}
          >
            {loading ? <><Spin />Signing in…</> : 'Sign in'}
          </button>
        </form>
        <p className="signin-links"><Link to="/auth/recover" className="signin-lk">Lost your authenticator? Account recovery</Link></p>
        {otherMethod}
      </>
    );
  } else if (step === 'passkey') {
    body = (
      <>
        {backButton}
        {destination}
        <span className="signin-big" aria-hidden="true"><KeyIcon /></span>
        {heading('Use your passkey')}
        <p className="signin-sub muted">Follow the prompt from your browser or device. No address needed if your passkey is saved here.</p>
        {banners}
        {passkeyBusy ? (
          <div className="signin-wait"><Spin />Waiting for your passkey…</div>
        ) : (
          <div className="signin-form">
            <button type="button" className="signin-b pri" onClick={signInWithPasskey}><KeyIcon />Try passkey again</button>
          </div>
        )}
        {otherMethod}
      </>
    );
  } else {
    body = (
      <>
        {heading(context ? `Sign in to continue to ${context.area.name}` : 'Sign in to Axal VC')}
        {context && (
          <p className="signin-sub" data-testid="login-destination">
            {context.area.what} {context.area.who}
          </p>
        )}
        {context?.ended && (
          <p role="status" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] leading-relaxed text-sky-900" data-testid="login-session-ended">
            {context.ended}
          </p>
        )}
        {banners}
        <div className="signin-stack">
          <button type="button" id="signin-email" className="signin-b pri" onClick={() => go('email', 'signin-email')} data-testid="login-email-method">
            <MailIcon />Continue with Email
          </button>
          {appleConfigured && (
            <button type="button" className="signin-b apl" onClick={continueWithApple} disabled={appleBusy} data-testid="login-apple">
              <AppleIcon />{appleBusy ? 'Taking you to Apple…' : 'Continue with Apple'}
            </button>
          )}
          {/* ALWAYS RENDERED — never behind a capability probe. A button that
              might fail is strictly better than one that is missing, because a
              missing one leaves the person no path and nothing to retry. */}
          <button
            type="button"
            onClick={continueWithGoogle}
            onPointerEnter={primeGoogle}
            onFocus={primeGoogle}
            onTouchStart={primeGoogle}
            disabled={googleLocked}
            className="signin-b ggl"
            data-testid="login-google"
          >
            <GoogleIcon />
            {googleLabel}
          </button>
        </div>
        <p className="signin-quiet">
          New to Axal VC? <Link to={context?.registerHref || '/register'}>Create an account</Link>
        </p>
        {showDemoQuickLogin && (
          <div className="mt-4 pt-3 border-t space-y-2" style={{ borderColor: '#e8e6ee' }}>
            <button
              onClick={() => demoLogin()}
              disabled={!!demoLoading}
              data-testid="demo-investor-login"
              className="w-full bg-amber-100 hover:bg-amber-200 border border-amber-300 disabled:opacity-50 rounded-lg py-2 text-xs font-medium text-amber-900"
            >
              {demoLoading === 'investor' ? 'Signing in…' : 'Sign in as demo investor (dev only)'}
            </button>
            <button
              onClick={() => demoLogin({ email: 'demo-admin@axal.test', landing: '/admin/accounts/all' })}
              disabled={!!demoLoading}
              data-testid="demo-admin-login"
              className="w-full bg-violet-100 hover:bg-violet-200 border border-violet-300 disabled:opacity-50 rounded-lg py-2 text-xs font-medium text-violet-900"
            >
              {demoLoading === 'demo-admin@axal.test' ? 'Signing in…' : 'Sign in as demo admin (dev only)'}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <AuthShell signInScene backgroundSrc="/auth/login-background.webp">
      <SignInSurface phone={phone} labelledBy={TITLE_ID} onEscape={onEscape}>
        <div className="signin-sr" role="status" aria-live="polite">{status}</div>
        {body}
      </SignInSurface>
    </AuthShell>
  );
}
