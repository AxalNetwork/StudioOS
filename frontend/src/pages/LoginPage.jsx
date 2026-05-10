import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, LogIn, MessageSquare, KeyRound } from 'lucide-react';
import { api } from '../lib/api';

// Task #6 — Login is now a 3-step flow:
//   1. Email   →  GET /auth/factors  →  decide which factor(s) the user has
//   2. Picker  →  if both TOTP+SMS are enrolled, let the user choose; if only
//                 one, skip straight to its input
//   3. Verify  →  POST /auth/login  (TOTP) or /auth/sms/verify-challenge (SMS)
//
// TOTP remains the recommended/default factor (it's pre-selected in the
// picker). SMS-only sessions cannot reach impersonation, billing, contract
// void or DD report generation — those are gated server-side via
// requireFactor('totp'). The login UI surfaces this constraint via copy
// only ("TOTP is required for billing and admin actions") so users with
// both factors enrolled understand why they may be re-prompted later.
export default function LoginPage() {
  const [step, setStep] = useState('email');           // email | choose | totp | sms
  const [email, setEmail] = useState('');
  const [factors, setFactors] = useState({ totp: false, sms: false, sms_available: false });
  const [totpCode, setTotpCode] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsLast4, setSmsLast4] = useState('');
  const [smsSession, setSmsSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const continueFromEmail = async () => {
    if (!email.trim()) { setError('Enter your email to continue.'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.authFactors(email.trim());
      const f = { totp: !!res.totp, sms: !!res.sms, sms_available: !!res.sms_available };
      setFactors(f);
      // No SMS available on the server, or only TOTP enrolled → straight to TOTP.
      if (!f.sms || !f.sms_available) { setStep('totp'); return; }
      // Only SMS enrolled → straight to SMS challenge.
      if (!f.totp) { await startSms(); return; }
      // Both enrolled → picker.
      setStep('choose');
    } catch (e) {
      // Don't reveal account existence — fall through to TOTP and let the
      // login endpoint return its generic "Invalid credentials" if needed.
      setStep('totp');
    } finally {
      setLoading(false);
    }
  };

  const startSms = async () => {
    setLoading(true); setError('');
    try {
      const res = await api.smsStartChallenge(email.trim(), null);
      if (!res.session_info) {
        // Account doesn't exist or no SMS enrolled — surface a generic msg
        // and let the user try TOTP instead.
        setError('We couldn\'t text you. Try your authenticator code instead.');
        if (factors.totp) setStep('totp');
        return;
      }
      setSmsSession(res.session_info);
      setSmsLast4(res.last4 || '');
      setStep('sms');
    } catch (e) {
      setError(e?.message || 'Could not send SMS. Try again or use your authenticator.');
    } finally {
      setLoading(false);
    }
  };

  const verifyTotp = async () => {
    if (totpCode.length !== 6) { setError('Enter the 6-digit code from your authenticator.'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.login({ email: email.trim(), totp_code: totpCode });
      if (!res?.token || !res?.user) throw new Error('Invalid response from server.');
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      window.location.href = 'https://axal.vc';
    } catch (e) {
      setError(e?.message || 'Sign in failed.');
    } finally { setLoading(false); }
  };

  const verifySms = async () => {
    if (smsCode.length !== 6) { setError('Enter the 6-digit code we just sent.'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.smsVerifyChallenge(email.trim(), smsSession, smsCode);
      if (!res?.token || !res?.user) throw new Error('Invalid response from server.');
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      window.location.href = 'https://axal.vc';
    } catch (e) {
      setError(e?.message || 'Sign in failed.');
    } finally { setLoading(false); }
  };

  const reset = () => {
    setStep('email'); setTotpCode(''); setSmsCode(''); setSmsSession(null); setSmsLast4(''); setError('');
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
            <span style={{fontFamily:"'Space Grotesk', sans-serif"}} className="text-lg font-bold text-gray-900">Axal VC</span>
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-1">Welcome Back</h2>
          <p className="text-sm text-gray-600 mb-6">
            {step === 'email' && 'Sign in with your email and a verification code.'}
            {step === 'choose' && 'Choose how you want to verify.'}
            {step === 'totp' && 'Enter the 6-digit code from your authenticator app.'}
            {step === 'sms' && (smsLast4
              ? <>We just sent a code to <span className="font-mono">•••• {smsLast4}</span>.</>
              : 'Enter the 6-digit code we just sent.')}
          </p>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>
          )}

          {step === 'email' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-600 block mb-1">Email</label>
                <input type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && continueFromEmail()}
                  placeholder="john@company.com"
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm" />
              </div>
              <button onClick={continueFromEmail} disabled={loading || !email}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2">
                {loading ? 'Checking…' : <>Continue <LogIn size={14} /></>}
              </button>
            </div>
          )}

          {step === 'choose' && (
            <div className="space-y-3">
              <button onClick={() => setStep('totp')}
                className="w-full text-left border border-violet-300 bg-violet-50 hover:bg-violet-100 rounded-lg px-4 py-3 flex items-start gap-3">
                <KeyRound size={16} className="text-violet-700 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-gray-900">Authenticator app (recommended)</div>
                  <div className="text-xs text-gray-600">Use the 6-digit code from Google Authenticator, Authy, 1Password, etc.</div>
                </div>
              </button>
              <button onClick={startSms} disabled={loading}
                className="w-full text-left border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-3 flex items-start gap-3 disabled:opacity-50">
                <MessageSquare size={16} className="text-gray-700 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-gray-900">Text me a code (SMS)</div>
                  <div className="text-xs text-gray-600">{loading ? 'Sending…' : 'We\'ll send a 6-digit code to your verified phone.'}</div>
                </div>
              </button>
              <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 mt-1">← Use a different email</button>
            </div>
          )}

          {step === 'totp' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-600 block mb-1">Authenticator code</label>
                <input type="text" value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && verifyTotp()}
                  placeholder="000000" maxLength={6}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-2xl text-center tracking-[0.5em] font-mono" />
                <p className="text-[10px] text-gray-500 mt-1">If you've lost your authenticator, enter a recovery code instead.</p>
              </div>
              <button onClick={verifyTotp} disabled={loading || totpCode.length !== 6}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              {factors.sms && factors.sms_available && (
                <button onClick={startSms} disabled={loading}
                  className="w-full text-xs text-gray-600 hover:text-gray-900 underline">
                  Use SMS instead
                </button>
              )}
              <button onClick={reset} className="block w-full text-xs text-gray-500 hover:text-gray-700">← Use a different email</button>
            </div>
          )}

          {step === 'sms' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-600 block mb-1">SMS code</label>
                <input type="text" value={smsCode}
                  onChange={e => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && verifySms()}
                  placeholder="000000" maxLength={6}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-2xl text-center tracking-[0.5em] font-mono" />
              </div>
              <button onClick={verifySms} disabled={loading || smsCode.length !== 6}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
                {loading ? 'Verifying…' : 'Verify & sign in'}
              </button>
              <button onClick={startSms} disabled={loading}
                className="w-full text-xs text-gray-600 hover:text-gray-900 underline">
                Resend code
              </button>
              {factors.totp && (
                <button onClick={() => setStep('totp')} className="w-full text-xs text-gray-500 hover:text-gray-700">
                  Use my authenticator instead
                </button>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 bg-violet-50 rounded-lg p-3 mt-4 border border-violet-300">
            <Shield size={14} className="text-violet-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-violet-700">
              Your authenticator app stays the recommended factor. Billing changes, impersonation and other sensitive actions still require an authenticator code.
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
