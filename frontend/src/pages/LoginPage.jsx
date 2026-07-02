import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, LogIn, KeyRound } from 'lucide-react';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api } from '../lib/api';
import useForcedLightTheme from '../hooks/useForcedLightTheme';

// Single-page sign-in: email + authenticator code + Cloudflare Turnstile.
// SMS is intentionally NOT offered as a primary sign-in factor — it lives
// only in Settings → Security as a backup verification factor for account
// recovery. See cloudflare-worker/src/routes/auth_sms.ts.
//
// Turnstile is REQUIRED here (matches /register). It must never be removed.
// Backend `/api/auth/login` verifies the token via verifyTurnstile() and
// fails closed in production when the secret is unset.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

// Task #51 — "Continue with Google" error → toast copy. Mirrors the codes
// raised by routes/auth_google.ts::callbackError() so the user gets a
// human-readable explanation when the callback couldn't sign them in.
const GOOGLE_ERROR_COPY = {
  not_configured: 'Google sign-in is not enabled on this environment.',
  cancelled: 'Google sign-in cancelled.',
  provider_error: 'Google sign-in failed. Please try again.',
  missing_code: 'Google sign-in failed. Please try again.',
  bad_state: 'Sign-in link expired. Please try again.',
  exchange_failed: 'Could not verify your Google account. Please try again.',
  email_unverified_at_google: 'Your Google email is not verified. Verify it with Google, then retry.',
  link_blocked_unverified: 'An Axal VC account exists for that email but the address is unverified. Sign in with a magic link first to verify, then link Google in Settings → Security.',
  account_inactive: 'Your Axal VC account is inactive. Contact support.',
  internal_error: 'Something went wrong on our side. Please try again.',
};

// BLOCK-AUTH-01 — copy for the codes raised by GET /api/auth/magic/verify when
// a magic link can't sign the user in (mirrors routes/auth.ts::fail()).
const MAGIC_ERROR_COPY = {
  invalid: 'That sign-in link is invalid. Request a new one below.',
  expired: 'That sign-in link has expired or was already used. Request a new one below.',
  rate: 'Too many attempts. Please wait a minute and try again.',
  inactive: 'Your Axal VC account is inactive. Contact support.',
  error: 'Something went wrong completing your sign-in. Please try again.',
};

// Honor a `?next=` return path (e.g. a paid event invitation that bounced the
// user here to sign in) while refusing open redirects: only same-origin paths
// that start with a single `/` are accepted, everything else falls through to
// the default landing page chosen by the caller.
function safeNextPath() {
  try {
    const n = new URLSearchParams(window.location.search).get('next');
    if (n && n.startsWith('/') && !n.startsWith('//')) return n;
  } catch { /* ignore */ }
  return null;
}

export default function LoginPage() {
  useForcedLightTheme();
  const [email, setEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // BLOCK-AUTH-02 — passkey state.
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeySupported = typeof window !== 'undefined' && browserSupportsWebAuthn();

  // Discover whether the worker has Google OAuth configured; hide the
  // button otherwise so we don't show users a control that returns 503.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.googleStartUrl({ action: 'signin' });
        if (!cancelled) setGoogleAvailable(true);
      } catch {
        if (!cancelled) setGoogleAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // One-shot toast for any error the callback bounced us back with.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('google_error');
    if (code) {
      setError(GOOGLE_ERROR_COPY[code] || 'Google sign-in failed.');
      const url = new URL(window.location.href);
      url.searchParams.delete('google_error');
      window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
    }
  }, []);

  // BLOCK-AUTH-01 — surface any magic-link failure bounced back as ?magic_error=.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('magic_error');
    if (code) {
      setError(MAGIC_ERROR_COPY[code] || 'That sign-in link could not be used. Request a new one below.');
      const url = new URL(window.location.href);
      url.searchParams.delete('magic_error');
      window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
    }
  }, []);

  // BLOCK-AUTH-02 — sign in with a passkey. Email is optional: a discoverable
  // (resident) credential lets the authenticator pick the account, so we pass
  // whatever's typed but don't require it. A passkey assertion mints a
  // full-assurance session server-side.
  const signInWithPasskey = async () => {
    setPasskeyBusy(true); setError('');
    try {
      const wanted = email.trim() || undefined;
      const options = await api.passkey.authOptions(wanted);
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await api.passkey.authVerify(wanted, assertion);
      if (!res?.token || !res?.user) throw new Error('Invalid response from server.');
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      window.location.href = safeNextPath() || '/studio'; // codeql[js/client-side-unvalidated-url-redirection] -- safeNextPath() returns only same-origin '/'-prefixed paths (rejects '//'); defence-in-depth
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        setError('Passkey sign-in was cancelled.');
      } else {
        setError(e?.message || 'Passkey sign-in failed.');
      }
    } finally { setPasskeyBusy(false); }
  };

  const continueWithGoogle = async () => {
    setGoogleBusy(true); setError('');
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
      setGoogleBusy(false);
    }
  };

  // ---- Turnstile widget lifecycle (mirrors RegisterPage) ----
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return;
    if (typeof window.turnstile === 'undefined') {
      // Cap polling at 50 attempts (~10s) so a blocked Turnstile script
      // doesn't leak intervals.
      let attempts = 0;
      const interval = setInterval(() => {
        attempts += 1;
        if (typeof window.turnstile !== 'undefined' && turnstileRef.current) {
          clearInterval(interval);
          renderTurnstile();
        } else if (attempts >= 50) {
          clearInterval(interval);
        }
      }, 200);
      return () => clearInterval(interval);
    }
    renderTurnstile();

    function renderTurnstile() {
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
      }
      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        theme: 'light',
      });
    }

    return () => {
      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }
    };
  }, []);

  const resetTurnstile = () => {
    if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
      try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
      setTurnstileToken('');
    }
  };

  // ---- Task #41 — DEV-ONLY demo investor quick-login ----
  // The dev FastAPI backend exposes POST /api/auth/dev/quick-login
  // which mints a JWT for the seeded `demo-investor@axal.test` account
  // without TOTP / Turnstile (refused entirely when ENVIRONMENT=production).
  // The button is gated on Vite's `import.meta.env.DEV` so the production
  // bundle never includes it. Lands the user on /deals so testers can
  // immediately drive the LockedFounderCard → Request intro flow.
  const showDemoQuickLogin = !!import.meta.env.DEV;
  const [demoLoading, setDemoLoading] = useState('');
  const demoLogin = async ({ email: demoEmail, landing } = {}) => {
    setDemoLoading(demoEmail || 'investor'); setError('');
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

  // ---- Submit ----
  const submit = async () => {
    if (!email.trim()) { setError('Enter your email.'); return; }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError('Please complete the verification challenge.');
      return;
    }
    if (totpCode.length !== 6) { setError('Enter the 6-digit code from your authenticator.'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.login({ email: email.trim(), totp_code: totpCode, turnstileToken });
      if (!res?.token || !res?.user) throw new Error('Invalid response from server.');
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      // Relative path — stays on whichever canonical host the user signed in
      // on (axal.vc post-flip). The Worker serves the SPA on /studio for
      // both axal.vc and app.axal.vc per the apex routing table in wrangler.toml.
      window.location.href = safeNextPath() || '/studio'; // codeql[js/client-side-unvalidated-url-redirection] -- safeNextPath() returns only same-origin '/'-prefixed paths (rejects '//'); defence-in-depth
    } catch (e) {
      setError(e?.message || 'Sign in failed.');
      resetTurnstile();
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-8">
          <ArrowLeft size={14} /> Back to Axal VC
        </Link>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <img src="/axal-mark.png" alt="Axal VC" className="h-10 w-10 rounded-lg object-contain flex-shrink-0" />
            <span style={{ fontFamily: "'Space Grotesk', sans-serif" }} className="text-lg font-bold text-gray-900">Axal VC</span>
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-1">Welcome Back</h2>
          <p className="text-sm text-gray-600 mb-6">
            Sign in with your email and your authenticator code.
          </p>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Email</label>
              <input type="email" value={email} autoComplete="email"
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="john@company.com"
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
            </div>

            <div>
              <label className="text-xs text-gray-600 block mb-1">Authenticator code</label>
              <input type="text" value={totpCode} inputMode="numeric" autoComplete="one-time-code"
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="000000" maxLength={6}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-2xl text-center tracking-[0.5em] font-mono" />
              <p className="text-[10px] text-gray-500 mt-1">
                6-digit code from Google Authenticator, Authy, 1Password, etc. Recovery codes also work here.
              </p>
            </div>

            {/* Cloudflare Turnstile — required. Do not remove. */}
            {TURNSTILE_SITE_KEY && (
              <div ref={turnstileRef} className="flex justify-center" />
            )}

            <button onClick={submit}
              disabled={loading || (TURNSTILE_SITE_KEY && !turnstileToken) || totpCode.length !== 6}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2">
              {loading ? 'Signing in…' : <>Sign in <LogIn size={14} /></>}
            </button>

            {/* BLOCK-AUTH-02 — passkey sign-in (Face ID / Touch ID / security key). */}
            {passkeySupported && (
              <button type="button" onClick={signInWithPasskey} disabled={passkeyBusy}
                className="w-full bg-white hover:bg-gray-50 border border-gray-300 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-gray-700 flex items-center justify-center gap-2">
                <KeyRound size={14} /> {passkeyBusy ? 'Waiting for passkey…' : 'Sign in with a passkey'}
              </button>
            )}

            {googleAvailable && (
              <>
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">or</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <button
                  type="button"
                  onClick={continueWithGoogle}
                  disabled={googleBusy}
                  className="w-full bg-white hover:bg-gray-50 border border-gray-300 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-gray-700 flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z" />
                  </svg>
                  {googleBusy ? 'Redirecting…' : 'Continue with Google'}
                </button>
                <p className="text-[10px] text-gray-500 text-center">
                  Google is one factor — sensitive actions still ask for your authenticator.
                </p>
              </>
            )}

            {showDemoQuickLogin && (
              <div className="pt-2 border-t border-gray-200 space-y-2">
                <button
                  onClick={() => demoLogin()}
                  disabled={!!demoLoading}
                  data-testid="demo-investor-login"
                  className="w-full bg-amber-100 hover:bg-amber-200 border border-amber-300 disabled:opacity-50 rounded-lg py-2 text-xs font-medium text-amber-900 flex items-center justify-center gap-2"
                >
                  {demoLoading === 'investor' ? 'Signing in…' : 'Sign in as demo investor (dev only)'}
                </button>
                <button
                  onClick={() => demoLogin({ email: 'demo-admin@axal.test', landing: '/admin' })}
                  disabled={!!demoLoading}
                  data-testid="demo-admin-login"
                  className="w-full bg-violet-100 hover:bg-violet-200 border border-violet-300 disabled:opacity-50 rounded-lg py-2 text-xs font-medium text-violet-900 flex items-center justify-center gap-2"
                >
                  {demoLoading === 'demo-admin@axal.test' ? 'Signing in…' : 'Sign in as demo admin (dev only)'}
                </button>
                <p className="text-[10px] text-gray-500 mt-1 text-center">
                  Skips TOTP &amp; Turnstile. Admin lands on <code>/admin</code>. Disabled in production builds.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 bg-violet-50 rounded-lg p-3 mt-5 border border-violet-300">
            <Shield size={14} className="text-violet-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-violet-700">
              Lost your authenticator? Use one of your recovery codes here, or visit{' '}
              <Link to="/auth/recover" className="font-medium underline">account recovery</Link>{' '}
              for SMS / email / trusted-contact / admin-review options.
            </p>
          </div>

          <p className="text-xs text-gray-600 text-center mt-4">
            Don't have an account? <Link to="/register" className="text-violet-600 hover:underline font-medium">Register here</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
