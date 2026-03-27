import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, LogIn } from 'lucide-react';
import { api } from '../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = async () => {
    if (!email || totpCode.length !== 6) {
      setError('Please enter your email and 6-digit authenticator code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.login({ email, totp_code: totpCode });
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-8">
          <ArrowLeft size={14} /> Back to Axal Ventures
        </Link>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <img src="/axal-mark.png" alt="Axal" className="h-8" />
            <span className="font-bold text-lg text-gray-900">Axal</span>
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-1">Welcome Back</h2>
          <p className="text-sm text-gray-600 mb-6">Sign in with your email and authenticator code.</p>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="john@company.com"
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-500 focus:border-violet-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Authenticator Code</label>
              <input type="text" value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && login()}
                placeholder="000000" maxLength={6}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-400 focus:border-violet-500 focus:outline-none" />
              <p className="text-[10px] text-gray-500 mt-1">Enter the 6-digit code from your authenticator app</p>
            </div>
            <button onClick={login} disabled={loading || !email || totpCode.length !== 6}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors">
              <LogIn size={14} /> {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </div>

          <div className="flex items-start gap-2 bg-violet-50 rounded-lg p-3 mt-4 border border-violet-300">
            <Shield size={14} className="text-violet-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-violet-700">
              We use TOTP-based authentication for enhanced security. Open your authenticator app (Google Authenticator, Authy) to get your code.
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
