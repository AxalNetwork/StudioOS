import React, { useState, useEffect, useRef } from 'react';
import { safeReadJSON } from '../lib/storage';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Check, Mail, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import useForcedLightTheme from '../hooks/useForcedLightTheme';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export default function RegisterPage() {
  useForcedLightTheme();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ email: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  // Task #10 — fail-visible Turnstile: true once the 50-attempt (~10s) poll
  // gives up, so we can explain ourselves instead of a silently dead button.
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  // Task #10 — which email flow produced the "Check Your Email" step:
  // 'magic' (primary: one-click sign-in link) or 'classic' (verification
  // email → TOTP enrolment). Drives step-3 copy and the resend action.
  const [emailMode, setEmailMode] = useState('magic');
  const [emailWarning, setEmailWarning] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState('');
  const [refCode, setRefCode] = useState('');
  const [lane, setLane] = useState(null); // 'partner' | 'investor' | 'lp' | 'founder' | null
  const [productIntent, setProductIntent] = useState(null); // 'spinout-lab' | null
  // Task #51 — optional "Continue with Google" on step 1. Hidden when the
  // worker has no GOOGLE_AUTH_CLIENT_ID configured (start returns 503).
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.googleStartUrl({ action: 'signin' });
        if (!cancelled) setGoogleAvailable(true);
      } catch { /* leave hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const continueWithGoogle = async () => {
    setGoogleBusy(true); setError('');
    try {
      const { url } = await api.googleStartUrl({ action: 'signin' });
      if (!url) throw new Error('No redirect URL returned.');
      window.location.href = url;
    } catch (e) {
      setError(e?.message || 'Google sign-in unavailable.');
      setGoogleBusy(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('ref');
    if (r) {
      // Task #4 (DH) — Normalise to the new short form for display.
      // Both formats still work server-side via resolveReferralCode().
      const normalised = r.trim().toUpperCase().replace(/^AXAL[-_]?/, '').replace(/[^A-Z0-9]/g, '');
      setRefCode(normalised || r.toUpperCase());
    }
    const l = params.get('lane');
    if (l && ['partner', 'investor', 'lp', 'founder'].includes(l)) {
      setLane(l);
      try { localStorage.setItem('gvpn:intent', JSON.stringify({ lane: l, ts: Date.now() })); } catch {}
    } else {
      try {
        const saved = safeReadJSON('gvpn:intent', null);
        if (saved?.lane) setLane(saved.lane);
      } catch {}
    }
    const p = params.get('product');
    if (p === 'spinout-lab') setProductIntent('spinout-lab');
    // Prefill the email when arriving from a flow that already captured it
    // (e.g. the public job-board apply → register hand-off passes ?email=).
    const em = params.get('email');
    if (em && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      setForm((f) => ({ ...f, email: em }));
    }
  }, []);

  // Task #10 — audit copy fix: no more "We use TOTP…" jargon in subheads.
  const laneCopy = {
    partner: {
      title: 'Join the Partner Network',
      desc: "Get matched with deals before they go public. Free to join — no password to remember, we'll email you a secure sign-in link.",
    },
    lp: {
      title: 'Open your LP Account',
      desc: "Track commitments, calls, and distributions. Free to join — no password to remember, we'll email you a secure sign-in link.",
    },
    founder: {
      title: 'Submit your pitch',
      desc: "We'll score your venture within 72 hours. Free to join — no password to remember, we'll email you a secure sign-in link.",
    },
  };
  const activeLane = lane && laneCopy[lane] ? laneCopy[lane] : null;

  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current || step !== 1) return;
    if (typeof window.turnstile === 'undefined') {
      // T19 — Cap the polling at 50 attempts (~10s). Without this bound the
      // loop runs forever if the Turnstile script never loads (network
      // block, ad blocker, offline) — leaking an interval per mount.
      let attempts = 0;
      const interval = setInterval(() => {
        attempts += 1;
        if (typeof window.turnstile !== 'undefined' && turnstileRef.current) {
          clearInterval(interval);
          renderTurnstile();
        } else if (attempts >= 50) {
          clearInterval(interval);
          // Task #10 — surface the failure instead of silently leaving the
          // CTA disabled forever (ad blocker / strict network).
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
  }, [step]);

  const validateStep1 = () => {
    if (!form.name.trim()) { setError('Please enter your full name'); return false; }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!form.email.trim() || !emailRe.test(form.email.trim())) { setError('Please enter a valid email address (e.g. you@example.com)'); return false; }
    return true;
  };

  const resetTurnstileWidget = () => {
    if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
      try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
      setTurnstileToken('');
    }
  };

  // Task #10 — primary email path: create/refresh the account (deferring the
  // classic verification email), then send a magic sign-in link. One tap on
  // the link both verifies the address and signs the user in (BLOCK-AUTH-01).
  // If the account already exists with TOTP configured, /register answers 409
  // — the magic link still signs them in, so we proceed identically.
  const registerWithMagic = async () => {
    if (!validateStep1()) return;
    if (TURNSTILE_SITE_KEY && !turnstileFailed && !turnstileToken) { setError('Please complete the verification challenge'); return; }
    setLoading(true);
    setError('');
    try {
      // When Turnstile never loaded, /register would reject us (the token is
      // server-enforced) — skip account pre-creation and fall back to the
      // bare magic link, which find-or-creates the account on verify and has
      // its own per-IP/per-email rate limits. Referral attribution is lost in
      // that edge case, but the user isn't.
      if (!(TURNSTILE_SITE_KEY && turnstileFailed)) {
        try {
          await api.register({ ...form, turnstileToken, ref_code: refCode || undefined, defer_email: true });
        } catch (e) {
          if (!/already registered/i.test(e?.message || '')) throw e;
        }
      }
      await api.magicStart(form.email.trim());
      setEmailMode('magic');
      setResendCooldown(60);
      setStep(3);
    } catch (e) {
      setError(e.message);
      resetTurnstileWidget();
    }
    setLoading(false);
  };

  // Task #10 — 'classic' secondary path (verification email → TOTP enrolment),
  // for users who want an authenticator from day one.
  const register = async () => {
    if (!validateStep1()) return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) { setError(turnstileFailed ? 'Bot verification could not load, so the authenticator flow is unavailable right now. Use the sign-in link instead.' : 'Please complete the verification challenge'); return; }
    setLoading(true);
    setError('');
    try {
      // Task #66 — the inline pre-login chatbot (legacy step 2) is retired.
      // The full-screen post-login `/onboarding/chat` page is now the single
      // arbiter of role assignment, gated by `onboarding_progress.flow='chat'`
      // and unlocked by `/api/profiling/save` (auth-bound). Register sends
      // the verification email immediately and jumps straight to the
      // "Check Your Email" step; the chatbot runs after the user logs in.
      const res = await api.register({ ...form, turnstileToken, ref_code: refCode || undefined });
      setEmailWarning(res?.email_sent === false);
      if (res?.verification_url) setVerificationUrl(res.verification_url);
      setEmailMode('classic');
      setStep(3);
    } catch (e) {
      setError(e.message);
      resetTurnstileWidget();
    }
    setLoading(false);
  };

  const resendEmail = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      if (emailMode === 'magic') {
        // Task #10 — resend the magic sign-in link (server rate-limits
        // 3/15min per email; surface its error message if we hit the cap).
        await api.magicStart(form.email.trim());
      } else {
        const res = await api.resendVerification({ email: form.email });
        if (res?.verification_url) {
          setVerificationUrl(res.verification_url);
          setEmailWarning(true);
        }
      }
      setResendCooldown(60);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-8">
          <ArrowLeft size={14} /> Back to Axal VC
        </Link>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <img src="/axal-mark.png" alt="Axal VC" className="h-9 w-9 rounded-lg object-contain" />
            <span style={{fontFamily:"'Space Grotesk', sans-serif"}} className="text-lg font-bold text-gray-900">Axal VC</span>
          </div>

          {/* Task #11 — 2-step progress bar (details → check your email).
              Steps 2 (inline chatbot) and 4 (mandatory TOTP enrolment) are
              gone: the chatbot runs post-login at /onboarding/chat, and
              authenticator setup is now optional (verify page / Settings). */}
          <div className="flex gap-2 mb-6">
            {[1, 3].map(n => (
              <div key={n} className={`flex-1 h-1 rounded-full ${step >= n ? 'bg-violet-600' : 'bg-gray-300'}`} />
            ))}
          </div>

          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-1">{activeLane?.title || 'Create Your Account'}</h2>
              {/* Task #10 — audit's exact subhead copy (fix 10). */}
              <p className="text-sm text-gray-600 mb-6">{activeLane?.desc || "Free to join. No password to remember — we'll email you a secure sign-in link."}</p>

              {productIntent === 'spinout-lab' && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mb-4 text-xs text-amber-800">
                  You're applying for <b>Spin-Out Lab</b> — our 30-day cohort.
                </div>
              )}

              {refCode && (
                <div className="bg-violet-50 border border-violet-300 rounded-lg px-3 py-2 mb-4 text-xs text-violet-700">
                  Joining via referral code <span className="font-mono font-bold">{refCode}</span>
                </div>
              )}

              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

              {/* Task #10 — real <form> so Enter submits (audit fix 12);
                  inputs get autocomplete/inputmode and ≥16px mobile font
                  (fix 13, prevents iOS focus zoom). */}
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); registerWithMagic(); }}>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Full Name</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="John Smith" autoComplete="name"
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-base sm:text-sm text-gray-900 placeholder-gray-500 focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="john@company.com" autoComplete="email" inputMode="email"
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-base sm:text-sm text-gray-900 placeholder-gray-500 focus:border-violet-500 focus:outline-none" />
                </div>
                {TURNSTILE_SITE_KEY && (
                  <div ref={turnstileRef} className="flex justify-center" />
                )}
                {/* Task #10 — fail-visible fallback: explain a dead Turnstile
                    instead of a silently disabled CTA. The sign-in link still
                    works (server rate-limits it independently). */}
                {TURNSTILE_SITE_KEY && turnstileFailed && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                    Human verification couldn't load — usually an ad blocker or strict network.
                    You can still continue with an emailed sign-in link below.
                  </div>
                )}
                <button type="submit" disabled={loading || (TURNSTILE_SITE_KEY && !turnstileToken && !turnstileFailed)}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors flex items-center justify-center gap-2">
                  <Mail size={14} /> {loading ? 'Sending link…' : 'Email me a sign-in link'}
                </button>
                {/* Task #10 — audit's exact trust line (fix 15). */}
                <p className="text-[10px] text-gray-500 text-center leading-relaxed">
                  By continuing you agree to our <Link to="/terms" className="underline hover:text-gray-700">Terms</Link> and{' '}
                  <Link to="/privacy" className="underline hover:text-gray-700">Privacy Policy</Link>. We'll only email you about your account.
                </p>
                <p className="text-xs text-gray-500 text-center">
                  Prefer an authenticator app from day one?{' '}
                  <button type="button" onClick={register} disabled={loading}
                    className="text-violet-600 hover:underline font-medium disabled:opacity-50">
                    Verify by email and set one up
                  </button>
                </p>

                {/* Task #51 — Optional "Continue with Google" sign-up. Skips
                    the email-verification and TOTP-enrolment steps (steps 3-4)
                    because Google has already verified the email; the user
                    can still enrol TOTP from Settings → Security afterwards
                    and is gently reminded to do so when they hit a step-up
                    surface. */}
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
                      {googleBusy ? 'Redirecting…' : 'Continue with Google — fastest'}
                    </button>
                    <p className="text-[10px] text-gray-500 text-center">
                      We'll create your account from your Google profile. You can enrol an authenticator later from Settings.
                    </p>
                  </>
                )}
              </form>

              <p className="text-xs text-gray-600 text-center mt-4">
                Already have an account? <Link to="/login" className="text-violet-600 hover:underline font-medium">Sign in</Link>
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center justify-center w-16 h-16 bg-violet-100 rounded-full mx-auto mb-6">
                <Mail size={28} className="text-violet-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-1 text-center">
                {emailWarning ? 'Verify Your Email' : 'Check Your Email'}
              </h2>
              <p className="text-sm text-gray-600 mb-3 text-center">
                {emailWarning
                  ? 'Email delivery is not configured. Use the link below to verify:'
                  : emailMode === 'magic'
                    ? `We've sent a sign-in link to`
                    : `We've sent a verification link to`}
              </p>
              {!emailWarning && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 mb-6 text-center">
                  <span className="text-sm font-medium text-gray-900">{form.email}</span>
                </div>
              )}

              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

              {emailWarning && verificationUrl ? (
                <div className="mb-5">
                  <a
                    href={verificationUrl}
                    className="block w-full text-center bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg py-3 transition-colors mb-3"
                  >
                    Click Here to Verify Your Email
                  </a>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 mb-1 uppercase font-medium">Or copy this verification link:</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-violet-600 break-all flex-1">{verificationUrl}</p>
                      <button
                        onClick={() => { navigator.clipboard.writeText(verificationUrl); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }}
                        className="shrink-0 text-gray-500 hover:text-gray-800 p-1"
                      >
                        {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 text-center mt-2">This link expires in 24 hours.</p>
                </div>
              ) : !emailWarning && (
                <div className="flex items-start gap-2 bg-violet-50 border border-violet-300 rounded-lg p-3 mb-4">
                  <Mail size={16} className="text-violet-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-violet-700">
                    {emailMode === 'magic'
                      ? "Tap the link in the email and you're signed in — no password or authenticator needed. The link expires in 15 minutes and works once."
                      : 'Click the link in the email to verify your address and continue setting up your authenticator. The link expires in 24 hours.'}
                  </p>
                </div>
              )}

              {/* Task #10 — audit's exact spam hint + inbox deep links. */}
              {!emailWarning && (
                <div className="mb-6">
                  <p className="text-[11px] text-gray-500 text-center mb-2">
                    It can take a minute. Check spam for mail from <strong>support@axal.vc</strong>.
                  </p>
                  <div className="flex gap-2">
                    <a href="https://mail.google.com" target="_blank" rel="noopener noreferrer"
                      className="flex-1 text-center text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md py-1.5 transition-colors">
                      Open Gmail
                    </a>
                    <a href="https://outlook.live.com/mail" target="_blank" rel="noopener noreferrer"
                      className="flex-1 text-center text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md py-1.5 transition-colors">
                      Open Outlook
                    </a>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <button onClick={resendEmail} disabled={loading || resendCooldown > 0}
                  className="w-full bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-gray-700 flex items-center justify-center gap-2 transition-colors">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : loading ? 'Sending...' : emailMode === 'magic' ? 'Resend sign-in link' : 'Resend Verification Email'}
                </button>
                <button onClick={() => { setStep(1); setError(''); setVerificationUrl(''); setEmailWarning(false); }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700 py-1 transition-colors">
                  Use a different email
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
