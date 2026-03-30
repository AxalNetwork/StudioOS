import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Loader, Shield, Smartphone, Copy, Check } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const [userData, setUserData] = useState(null);
  const [totpData, setTotpData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const hasChecked = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No verification token provided.');
      return;
    }
    if (hasChecked.current) return;
    hasChecked.current = true;

    const checkToken = async () => {
      try {
        const res = await api.checkVerifyEmail(token);
        if (res.valid) {
          setUserData(res);
          setStatus('confirm');
        }
      } catch (e) {
        setStatus('error');
        setError(e.message || 'Verification failed');
      }
    };
    checkToken();
  }, [token]);

  useEffect(() => {
    if (totpData?.provisioning_uri && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, totpData.provisioning_uri, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
    }
  }, [totpData]);

  const confirmVerification = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.confirmVerifyEmail({ token });
      if (res.verified) {
        setUserData(res);
        const totpRes = await api.setupTotp({ email: res.email, token: res.setup_token });
        setTotpData(totpRes);
        setStatus('totp_setup');
      }
    } catch (e) {
      setStatus('error');
      setError(e.message || 'Verification failed');
    }
    setLoading(false);
  };

  const verifyTotp = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const email = userData?.email || totpData?.email;
      const res = await api.verifyTotp({ email, totp_code: verifyCode });
      if (res.valid) {
        const loginRes = await api.login({ email, totp_code: verifyCode });
        localStorage.setItem('token', loginRes.token);
        localStorage.setItem('user', JSON.stringify(loginRes.user));
        window.location.href = '/dashboard';
      } else {
        setError('Invalid code. Make sure your authenticator app is synced correctly.');
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const copySecret = () => {
    if (totpData?.totp_secret) {
      navigator.clipboard.writeText(totpData.totp_secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-8">
          <ArrowLeft size={14} /> Back to Axal Ventures
        </Link>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <img src="/axal-mark.png" alt="Axal" className="h-8 mb-6" />

          <div className="flex gap-2 mb-6">
            <div className="flex-1 h-1 rounded-full bg-violet-600" />
            <div className={`flex-1 h-1 rounded-full ${['confirm', 'totp_setup'].includes(status) ? 'bg-violet-600' : 'bg-gray-300'}`} />
            <div className={`flex-1 h-1 rounded-full ${status === 'totp_setup' ? 'bg-violet-600' : 'bg-gray-300'}`} />
          </div>

          {status === 'checking' && (
            <div className="text-center py-8">
              <Loader size={40} className="text-violet-600 animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Checking Verification Link</h2>
              <p className="text-sm text-gray-600">Please wait...</p>
            </div>
          )}

          {status === 'confirm' && userData && (
            <div className="text-center py-4">
              <div className="flex items-center justify-center w-16 h-16 bg-violet-100 rounded-full mx-auto mb-4">
                <CheckCircle size={32} className="text-violet-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Verify Your Email</h2>
              <p className="text-sm text-gray-600 mb-2">
                Click the button below to confirm your email address:
              </p>
              <div className="bg-gray-50 rounded-lg px-4 py-3 mb-6">
                <span className="text-sm font-medium text-gray-900">{userData.email}</span>
              </div>

              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

              <button onClick={confirmVerification} disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors">
                <CheckCircle size={14} /> {loading ? 'Verifying...' : 'Confirm & Continue Setup'}
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-4">
              <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-4">
                <XCircle size={32} className="text-red-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Verification Failed</h2>
              <p className="text-sm text-gray-600 mb-6">{error}</p>
              <div className="space-y-3">
                <Link to="/register"
                  className="block w-full bg-violet-600 hover:bg-violet-700 rounded-lg py-2.5 text-sm font-medium text-white text-center transition-colors">
                  Register Again
                </Link>
                <Link to="/login"
                  className="block w-full text-sm text-gray-500 hover:text-gray-700 py-1 text-center transition-colors">
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

              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

              <div className="bg-white rounded-xl p-4 flex items-center justify-center mb-4 border-2 border-gray-200">
                <canvas ref={canvasRef} className="rounded" />
              </div>

              <div className="bg-gray-50 rounded-lg p-3 mb-4 border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-gray-600 uppercase mb-0.5 font-medium">Secret Key (manual entry)</div>
                    <div className="text-xs text-gray-900 font-mono tracking-wider">{totpData.totp_secret}</div>
                  </div>
                  <button onClick={copySecret} className="text-gray-600 hover:text-gray-900 p-1">
                    {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-violet-50 border border-violet-300 rounded-lg p-3 mb-6">
                <Smartphone size={16} className="text-violet-600 shrink-0 mt-0.5" />
                <p className="text-xs text-violet-700">
                  Open your authenticator app, scan the QR code or enter the secret key manually, then enter the 6-digit code below to verify.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Enter 6-digit code from authenticator</label>
                  <input type="text" value={verifyCode} onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" maxLength={6}
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-400 focus:border-violet-500 focus:outline-none" />
                </div>
                <button onClick={verifyTotp} disabled={loading || verifyCode.length !== 6}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors">
                  <Shield size={14} /> {loading ? 'Verifying...' : 'Verify & Enter Dashboard'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
