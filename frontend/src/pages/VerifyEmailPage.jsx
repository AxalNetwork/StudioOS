import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CheckCircle, XCircle, ShieldCheck, ArrowRight } from 'lucide-react';
import TotpEnrollment from '../components/TotpEnrollment';

// Task #11 — TOTP is optional now. Verifying the email link signs the user in
// directly (confirm-verify-email mints an email_only session, mirroring the
// magic-link flow) and authenticator enrolment becomes an optional,
// recommended step offered right here — or later from Settings → Security.
export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading'); // loading | verified | error
  const [error, setError] = useState('');
  // True when confirm-verify-email returned a session (new worker). Old
  // responses without a token fall back to a "Sign in" CTA.
  const [signedIn, setSignedIn] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  // The confirm call single-uses (rotates) the token, so React.StrictMode's
  // dev double-invoke of effects would make the second run fail with
  // "invalid token". Run-once guard keeps local testing sane.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setError('Missing verification token.');
      return;
    }
    (async () => {
      try {
        // GET response is just `{ valid: true }` per T22.2 (no PII echo).
        await api.checkVerifyEmail(token);
        const res = await api.confirmVerifyEmail({ token });
        // Task #11 — the confirm step now mints a session (same shape as
        // POST /login). Store it exactly like LoginPage does so the user
        // lands signed in instead of bouncing to a login screen.
        if (res?.token) {
          localStorage.setItem('token', res.token);
          if (res.user) localStorage.setItem('user', JSON.stringify(res.user));
          setSignedIn(true);
        }
        setStatus('verified');
      } catch (e) {
        setError(e.message || 'Verification failed.');
        setStatus('error');
      }
    })();
  }, [searchParams]);

  // Full page load (not SPA navigate) so AuthContext re-reads the fresh
  // localStorage session. RequireAuth routes brand-new users on to
  // /onboarding/chat from here.
  const continueToApp = () => { window.location.href = '/dashboard'; };

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 py-8 dark:bg-gray-950">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800">
        {status === 'error' && (
          <div className="text-center py-4">
            <div className="flex items-center justify-center w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full mx-auto mb-4">
              <XCircle size={32} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2 dark:text-gray-100">Verification Failed</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{error}</p>
            <div className="space-y-3">
              <Link to="/register" className="block w-full bg-violet-600 hover:bg-violet-700 rounded-lg py-2.5 text-sm font-medium text-white text-center transition-colors">
                Register Again
              </Link>
              <Link to="/login" className="block w-full text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-1 text-center transition-colors">
                Back to Sign In
              </Link>
            </div>
          </div>
        )}

        {status === 'verified' && !enrolling && (
          <div className="py-2">
            <div className="text-center mb-6">
              <div className="flex items-center justify-center w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full mx-auto mb-4">
                <CheckCircle size={32} className="text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2 dark:text-gray-100">You're verified!</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {signedIn
                  ? "Your email is confirmed and you're signed in."
                  : 'Your email is confirmed. Sign in to get started.'}
              </p>
            </div>

            {enrolled && (
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 mb-4">
                <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                <p className="text-xs text-emerald-700 dark:text-emerald-400">Authenticator app added — your account has an extra lock on it.</p>
              </div>
            )}

            <div className="space-y-3">
              {signedIn ? (
                <button onClick={continueToApp}
                  className="w-full bg-violet-600 hover:bg-violet-700 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors">
                  Continue to your account <ArrowRight size={14} />
                </button>
              ) : (
                <Link to="/login"
                  className="block w-full bg-violet-600 hover:bg-violet-700 rounded-lg py-2.5 text-sm font-medium text-white text-center transition-colors">
                  Go to Sign In
                </Link>
              )}

              {signedIn && !enrolled && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck size={18} className="text-violet-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add an authenticator app</div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                        Recommended — a 6-digit code from your phone keeps your account safe even if
                        someone gets into your email. Takes about a minute; you can also do this
                        later from Settings.
                      </p>
                      <button onClick={() => setEnrolling(true)}
                        className="mt-2.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline">
                        Set it up now →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {status === 'verified' && enrolling && (
          <div className="py-2">
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 mb-4">
              <CheckCircle size={14} className="text-emerald-600 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Email verified — you're signed in.</p>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-4 dark:text-gray-100">Set Up Authenticator</h2>
            <TotpEnrollment
              onDone={() => { setEnrolled(true); setEnrolling(false); }}
              onCancel={() => setEnrolling(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
