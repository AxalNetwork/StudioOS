import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CheckCircle, Copy, XCircle } from 'lucide-react';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState(null);
  const [totpData, setTotpData] = useState(null);
  const [copied, setCopied] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
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

            <button onClick={confirmVerification} disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors">
              {loading ? 'Continuing...' : 'Go to Sign In'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
