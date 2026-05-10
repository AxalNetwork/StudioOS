import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, LogIn } from 'lucide-react';
import { api } from '../lib/api';

// Single-page sign-in: email + authenticator code + Cloudflare Turnstile.
// SMS is intentionally NOT offered as a primary sign-in factor — it lives
// only in Settings → Security as a backup verification factor for account
// recovery. See cloudflare-worker/src/routes/auth_sms.ts.
//
// Turnstile is REQUIRED here (matches /register). It must never be removed.
// Backend `/api/auth/login` verifies the token via verifyTurnstile() and
// fails closed in production when the secret is unset.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      window.location.href = 'https://axal.vc';
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
          </div>

          <div className="flex items-start gap-2 bg-violet-50 rounded-lg p-3 mt-5 border border-violet-300">
            <Shield size={14} className="text-violet-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-violet-700">
              Lost your authenticator? Use one of your recovery codes here, or contact support.
              You can enrol an SMS backup factor later from Settings → Security.
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
