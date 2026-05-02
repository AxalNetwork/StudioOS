import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import {
  CheckCircle, Check, Copy, XCircle, Smartphone,
  ChevronDown, ChevronRight, HelpCircle,
} from 'lucide-react';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState(null);
  const [totpData, setTotpData] = useState(null);
  const [copied, setCopied] = useState(false);
  // Which "I can't scan the QR" app card is expanded. null = all collapsed.
  const [manualOpen, setManualOpen] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setError('Missing verification token.');
      return;
    }

    const verify = async () => {
      try {
        const res = await api.verifyEmail(token);
        setUserData(res.user);
        setTotpData(res.totp);
        setStatus('totp_setup');
      } catch (e) {
        setError(e.message || 'Verification failed.');
        setStatus('error');
      }
    };

    verify();
  }, [searchParams]);

  // Draw the QR onto the canvas once we have a provisioning URI. Without
  // this the page used to show a blank canvas — the manual-entry secret
  // below was the only way through.
  useEffect(() => {
    if (totpData?.provisioning_uri && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, totpData.provisioning_uri, {
        width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' },
      });
    }
  }, [totpData]);

  const confirmVerification = async () => {
    setLoading(true);
    setError('');
    try {
      await api.confirmVerification(userData.email);
      navigate('/login');
    } catch (e) {
      setError(e.message || 'Unable to confirm verification.');
    }
    setLoading(false);
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(totpData.totp_secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 py-8">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-sm border border-gray-200 p-6">
        {status === 'error' && (
          <div className="text-center py-4">
            <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-4">
              <XCircle size={32} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Verification Failed</h2>
            <p className="text-sm text-gray-600 mb-6">{error}</p>
            <div className="space-y-3">
              <Link to="/register" className="block w-full bg-violet-600 hover:bg-violet-700 rounded-lg py-2.5 text-sm font-medium text-white text-center transition-colors">
                Register Again
              </Link>
              <Link to="/login" className="block w-full text-sm text-gray-500 hover:text-gray-700 py-1 text-center transition-colors">
                Back to Sign In
              </Link>
            </div>
          </div>
        )}

        {status === 'totp_setup' && totpData && (
          <>
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
              <CheckCircle size={14} className="text-emerald-600 shrink-0" />
              <p className="text-xs text-emerald-700">Email verified successfully!</p>
            </div>

            <h2 className="text-xl font-bold text-gray-900 mb-1">Set Up Authenticator</h2>
            <p className="text-sm text-gray-600 mb-6">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>

            <div className="bg-white rounded-xl p-4 flex items-center justify-center mb-4 border-2 border-gray-200">
              <canvas ref={canvasRef} className="rounded" />
            </div>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 border border-gray-200">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] text-gray-600 uppercase mb-0.5 font-medium">Secret Key (manual entry)</div>
                  <div className="text-xs text-gray-900 font-mono tracking-wider break-all">{totpData.totp_secret}</div>
                </div>
                <button
                  onClick={copySecret}
                  aria-label={copied ? 'Secret key copied to clipboard' : 'Copy secret key to clipboard'}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 bg-white border border-gray-300 hover:border-gray-400 rounded-md px-2.5 py-1.5 transition-colors"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span className={copied ? 'text-emerald-600 font-medium' : ''}>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
              {/* Screen reader announcement when copy succeeds */}
              <div role="status" aria-live="polite" className="sr-only">
                {copied ? 'Secret key copied to clipboard.' : ''}
              </div>
            </div>

            {/* I can't scan the QR — manual-entry instructions per app */}
            <details className="mb-6 group" onToggle={(e) => { if (!e.currentTarget.open) setManualOpen(null); }}>
              <summary className="flex items-center gap-2 text-xs font-medium text-gray-700 hover:text-gray-900 cursor-pointer select-none px-1 py-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                <HelpCircle size={14} className="text-gray-500" />
                <span>I can't scan the QR — show manual setup instructions</span>
                <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-gray-500 px-1">
                  Pick your authenticator app below and follow the steps. The secret key is the same value shown above.
                </p>
                {[
                  {
                    key: 'google',
                    name: 'Google Authenticator',
                    steps: [
                      'Open Google Authenticator on your phone.',
                      'Tap the + button (bottom right) → "Enter a setup key".',
                      'Account: type "Axal VC" (or your email). Key: paste the secret key above.',
                      'Time-based should be selected (default). Tap "Add".',
                      'A new 6-digit code will appear — you\'ll use it next time you sign in.',
                    ],
                  },
                  {
                    key: 'authy',
                    name: 'Authy',
                    steps: [
                      'Open Authy and tap "Add Account" (or the + icon).',
                      'Tap "Enter Code Manually".',
                      'Paste the secret key above and tap the arrow.',
                      'Account name: "Axal VC". Logo: search for "Axal" or skip. Tap "Save".',
                      'Authy will start showing a 6-digit code — you\'ll use it next time you sign in.',
                    ],
                  },
                  {
                    key: '1password',
                    name: '1Password',
                    steps: [
                      'Open 1Password → find or create the login item for Axal VC.',
                      'Edit the item and tap "Add more" → "One-Time Password".',
                      'Tap "From QR Code or Setup Code" → "Enter setup code manually".',
                      'Paste the secret key above. Save the item.',
                      '1Password will start generating a 6-digit code for sign-in.',
                    ],
                  },
                  {
                    key: 'bitwarden',
                    name: 'Bitwarden',
                    steps: [
                      'Open Bitwarden → find or create the login item for Axal VC. Premium is required for built-in TOTP.',
                      'Edit the item and find the "Authenticator key (TOTP)" field.',
                      'Paste the secret key above into that field and save.',
                      'Bitwarden will display a rotating 6-digit code under the item.',
                      'You\'ll use that code next time you sign in.',
                    ],
                  },
                ].map(app => {
                  const open = manualOpen === app.key;
                  return (
                    <div key={app.key} className="border border-gray-200 rounded-lg bg-white">
                      <button
                        type="button"
                        onClick={() => setManualOpen(open ? null : app.key)}
                        aria-expanded={open}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                      >
                        <span className="flex items-center gap-2">
                          <Smartphone size={13} className="text-violet-600" />
                          {app.name}
                        </span>
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      {open && (
                        <ol className="list-decimal list-outside pl-8 pr-3 pb-3 pt-1 space-y-1 text-[11px] text-gray-700 leading-relaxed">
                          {app.steps.map((s, i) => <li key={i}>{s}</li>)}
                        </ol>
                      )}
                    </div>
                  );
                })}
                <p className="text-[11px] text-gray-500 text-center pt-1">
                  Already set up?{' '}
                  <Link to="/login" className="text-violet-600 hover:underline font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded">
                    Sign in
                  </Link>
                </p>
              </div>
            </details>

            <button onClick={confirmVerification} disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors">
              {loading ? 'Continuing...' : 'Go to Sign In'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
