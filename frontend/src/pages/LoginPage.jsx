import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Shield, LogIn, KeyRound, Mail, ChevronDown, ChevronUp } from 'lucide-react';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api } from '../lib/api';
import { track } from '../lib/funnel';
import { storePendingNext } from '../lib/pendingNext';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import { loadTurnstile } from '../lib/turnstile';
import AuthShell, { AuthCard, authV2 } from '../components/auth/AuthShell';

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
  // Task #10 — passwordless magic-link sign-in (BLOCK-AUTH-01 finally gets UI).
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicSentTo, setMagicSentTo] = useState('');
  const [magicCooldown, setMagicCooldown] = useState(0);
  // Set when /login answers "Account not set up for TOTP authentication" —
  // e.g. partners created by deal activation. We swap the raw error for
  // friendly copy and steer them to the magic link.
  const [totpMissing, setTotpMissing] = useState(false);
  const [showAltFactors, setShowAltFactors] = useState(false);
  // Task #10 — fail-visible Turnstile: true once the 50-attempt (~10s) poll
  // gives up, so we can explain the disabled button instead of staying silent.
  const [turnstileFailed, setTurnstileFailed] = useState(false);

  useEffect(() => {
    if (magicCooldown <= 0) return;
    const t = setTimeout(() => setMagicCooldown(magicCooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [magicCooldown]);

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
      // Task #2 — funnel: OAuth callback bounced the user back with an error.
      track('login_error', { method: 'google', reason: code.slice(0, 40) });
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
      // Task #2 — funnel: magic-link verify failed (expired/re-used/invalid).
      track('login_error', { method: 'magic', reason: code.slice(0, 40) });
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
    track('login_submit', { method: 'passkey' });
    try {
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
      window.location.href = safeNextPath() || '/studio'; // codeql[js/client-side-unvalidated-url-redirection] -- safeNextPath() returns only same-origin '/'-prefixed paths (rejects '//'); defence-in-depth
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        setError('Passkey sign-in was cancelled.');
        track('login_error', { method: 'passkey', reason: 'cancelled' });
      } else {
        setError(e?.message || 'Passkey sign-in failed.');
        track('login_error', { method: 'passkey' });
      }
    } finally { setPasskeyBusy(false); }
  };

  const continueWithGoogle = async () => {
    setGoogleBusy(true); setError('');
    // Task #2 — funnel: no login_success counterpart here — the OAuth
    // callback lands the user signed in; failures bounce back as
    // ?google_error= (tracked above).
    track('login_submit', { method: 'google' });
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
    loadTurnstile().catch(() => {});
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
          // Task #10 — surface the failure instead of silently leaving the
          // sign-in button disabled forever (ad blocker / strict network).
          setTurnstileFailed(true);
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
        callback: (token) => { setTurnstileToken(token); setTurnstileFailed(false); },
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
      // on (axal.vc post-flip). The Worker serves the SPA on /studio for
      // both axal.vc and app.axal.vc per the apex routing table in wrangler.toml.
      window.location.href = safeNextPath() || '/studio'; // codeql[js/client-side-unvalidated-url-redirection] -- safeNextPath() returns only same-origin '/'-prefixed paths (rejects '//'); defence-in-depth
    } catch (e) {
      const msg = e?.message || 'Sign in failed.';
      // Task #10 — accounts without a TOTP enrolment (e.g. partners created
      // by deal activation, magic-link signups) hit this exact server error.
      // Map it to actionable copy + highlight the magic-link path.
      if (/not set up for TOTP/i.test(msg)) {
        setTotpMissing(true);
        setError("Your account doesn't have an authenticator app yet — that's normal if you joined by signing a partner agreement or via an email link. Use “Email me a sign-in link” below instead.");
        track('login_error', { method: 'totp', reason: 'totp_missing' });
      } else {
        setError(msg);
        track('login_error', { method: 'totp' });
      }
      resetTurnstile();
    } finally { setLoading(false); }
  };

  // ---- Task #10 — request a magic sign-in link ----
  const sendMagicLink = async () => {
    const target = email.trim();
    if (!target) { setError('Enter your email above, then request a sign-in link.'); return; }
    // Turnstile still gates the request when the widget is working; when it
    // failed to load, the magic link is deliberately the recovery path
    // (the endpoint has its own per-IP + per-email rate limits server-side).
    if (TURNSTILE_SITE_KEY && !turnstileFailed && !turnstileToken) {
      setError('Please complete the verification challenge first.');
      return;
    }
    if (magicBusy || magicCooldown > 0) return;
    setMagicBusy(true); setError('');
    // Task #2 — funnel: "submit" for the magic path = link requested. The
    // sign-in itself completes server-side on /magic/verify; failures bounce
    // back as ?magic_error= (tracked above).
    track('login_submit', { method: 'magic' });
    try {
      await api.magicStart(target);
      setMagicSentTo(target);
      setMagicCooldown(60);
    } catch (e) {
      setError(e?.message || 'Could not send your sign-in link. Please try again in a moment.');
      track('login_error', { method: 'magic', reason: 'send_failed' });
    } finally { setMagicBusy(false); }
  };

  return (
    <AuthShell showApplyCard applyLabel="Apply to Axal VC →" backgroundSrc="/auth/login-background.webp">
      <AuthCard>
        <h1 className="m-0 text-[25px] font-extrabold tracking-tight leading-tight text-[#241f38]">
          Sign in
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#6b6577]">
          Passwordless by default — we email you a one-time link. Google, passkey, and authenticator codes are also available.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="mt-6 space-y-4">
          <div>
            <label className={authV2.label}>Email</label>
            <input
              type="email"
              value={email}
              autoComplete="email"
              inputMode="email"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !showAltFactors && sendMagicLink()}
              placeholder="you@company.com"
              className={`${authV2.input} mt-1.5`}
              style={{ borderColor: authV2.hair }}
            />
          </div>

          {TURNSTILE_SITE_KEY && (
            <div ref={turnstileRef} className="flex justify-center" />
          )}

          {TURNSTILE_SITE_KEY && turnstileFailed && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
              Human verification could not load — usually an ad blocker or strict network.
              You can still request a sign-in link; the server applies its own rate limits.
            </div>
          )}

          {magicSentTo ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 space-y-2">
              <p className="text-xs text-emerald-800">
                <strong>Sign-in link sent to {magicSentTo}.</strong> Tap the link in the email — it expires in 15 minutes and works once.
              </p>
              <button
                type="button"
                onClick={sendMagicLink}
                disabled={magicBusy || magicCooldown > 0}
                className="w-full text-xs text-emerald-800 hover:text-emerald-900 disabled:opacity-60 py-1 font-medium"
              >
                {magicCooldown > 0 ? `Resend available in ${magicCooldown}s` : magicBusy ? 'Sending…' : 'Resend link'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={magicBusy}
              className={authV2.btnPrimary}
              style={{ background: authV2.purple, borderColor: authV2.purple }}
            >
              <Mail size={14} className="inline mr-2 align-text-bottom" />
              {magicBusy ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
          )}

          {googleAvailable && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: authV2.hair }} />
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#6b6577]">or</span>
                <div className="flex-1 h-px" style={{ background: authV2.hair }} />
              </div>
              <button
                type="button"
                onClick={continueWithGoogle}
                disabled={googleBusy}
                className={authV2.btnSecondary}
                style={{ borderColor: authV2.hair, background: '#fff', color: authV2.ink }}
              >
                <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                {googleBusy ? 'Redirecting…' : 'Continue with Google'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowAltFactors((v) => !v)}
            className="w-full text-[13px] font-semibold text-[#6b6577] flex items-center justify-center gap-1 py-1"
          >
            {showAltFactors ? <>Hide other sign-in options <ChevronUp size={14} /></> : <>Passkey or authenticator code <ChevronDown size={14} /></>}
          </button>

          {showAltFactors && (
            <div className="space-y-4 pt-1 border-t" style={{ borderColor: authV2.hair }}>
              {passkeySupported && (
                <button
                  type="button"
                  onClick={signInWithPasskey}
                  disabled={passkeyBusy}
                  className={authV2.btnSecondary}
                  style={{ borderColor: authV2.hair, background: '#fff', color: authV2.ink }}
                >
                  <KeyRound size={14} /> {passkeyBusy ? 'Waiting for passkey…' : 'Sign in with a passkey'}
                </button>
              )}

              <div>
                <label className={authV2.label}>Authenticator code</label>
                <input
                  type="text"
                  value={totpCode}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="000000"
                  maxLength={6}
                  className={`${authV2.input} mt-1.5 text-center text-xl tracking-[0.4em] font-mono`}
                  style={{ borderColor: authV2.hair }}
                />
              </div>

              <button
                onClick={submit}
                disabled={loading || (TURNSTILE_SITE_KEY && !turnstileToken && !turnstileFailed) || totpCode.length !== 6}
                className={authV2.btnSecondary}
                style={{ borderColor: authV2.hair, background: '#fff', color: authV2.ink }}
              >
                {loading ? 'Signing in…' : <>Sign in with code <LogIn size={14} /></>}
              </button>

              {totpMissing && (
                <p className="text-[11px] text-[#6b6577]">
                  No authenticator yet? Use the email sign-in link above — that is the normal path for new members.
                </p>
              )}
            </div>
          )}

          {showDemoQuickLogin && (
            <div className="pt-2 border-t space-y-2" style={{ borderColor: authV2.hair }}>
              <button
                onClick={() => demoLogin()}
                disabled={!!demoLoading}
                data-testid="demo-investor-login"
                className="w-full bg-amber-100 hover:bg-amber-200 border border-amber-300 disabled:opacity-50 rounded-lg py-2 text-xs font-medium text-amber-900"
              >
                {demoLoading === 'investor' ? 'Signing in…' : 'Sign in as demo investor (dev only)'}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg p-3 mt-5 border" style={{ background: authV2.purpleTint, borderColor: '#ddd0fb' }}>
          <Shield size={14} className="text-violet-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-violet-800 leading-relaxed">
            Lost your authenticator? Use a recovery code, or visit{' '}
            <Link to="/auth/recover" className="font-medium underline">account recovery</Link>.
          </p>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
