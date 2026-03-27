import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Smartphone, Copy, Check } from 'lucide-react';
import { api } from '../lib/api';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ email: '', name: '', role: 'partner' });
  const [totpData, setTotpData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const register = async () => {
    if (!form.email || !form.name) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.register(form);
      setTotpData(res);
      setStep(2);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const verify = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.verifyTotp({ email: form.email, totp_code: verifyCode });
      if (res.valid) {
        const loginRes = await api.login({ email: form.email, totp_code: verifyCode });
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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-8">
          <ArrowLeft size={14} /> Back to Axal Ventures
        </Link>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center font-bold text-sm text-white">A</div>
            <div>
              <div className="text-sm font-semibold text-white">StudioOS</div>
              <div className="text-[10px] text-gray-500">Axal VC v1.0</div>
            </div>
          </div>

          <div className="flex gap-2 mb-6">
            <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-violet-500' : 'bg-gray-800'}`} />
            <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-violet-500' : 'bg-gray-800'}`} />
          </div>

          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-white mb-1">Create Your Account</h2>
              <p className="text-sm text-gray-400 mb-6">Join the Axal partner network. We use TOTP for secure, passwordless authentication.</p>

              {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">{error}</div>}

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Full Name</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="john@company.com"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Role</label>
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 focus:border-violet-500 focus:outline-none">
                    <option value="partner">Partner / Investor</option>
                    <option value="founder">Founder</option>
                  </select>
                </div>
                <button onClick={register} disabled={loading}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors">
                  {loading ? 'Creating Account...' : 'Continue'}
                </button>
              </div>

              <p className="text-xs text-gray-500 text-center mt-4">
                Already have an account? <Link to="/login" className="text-violet-400 hover:underline">Sign in</Link>
              </p>
            </>
          )}

          {step === 2 && totpData && (
            <>
              <h2 className="text-xl font-bold text-white mb-1">Set Up Authenticator</h2>
              <p className="text-sm text-gray-400 mb-6">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>

              {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">{error}</div>}

              <div className="bg-white rounded-xl p-4 flex items-center justify-center mb-4">
                {totpData.qr_code ? (
                  <img src={`data:image/png;base64,${totpData.qr_code}`} alt="TOTP QR Code" className="w-48 h-48" />
                ) : (
                  <div className="text-gray-500 text-sm py-8">QR code unavailable. Use the secret key below.</div>
                )}
              </div>

              <div className="bg-gray-800 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase mb-0.5">Secret Key (manual entry)</div>
                    <div className="text-xs text-white font-mono tracking-wider">{totpData.totp_secret}</div>
                  </div>
                  <button onClick={copySecret} className="text-gray-400 hover:text-white p-1">
                    {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 mb-6">
                <Smartphone size={16} className="text-violet-400 shrink-0 mt-0.5" />
                <p className="text-xs text-violet-300">
                  Open your authenticator app, scan the QR code or enter the secret key manually, then enter the 6-digit code below to verify.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Enter 6-digit code from authenticator</label>
                  <input type="text" value={verifyCode} onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" maxLength={6}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-600 focus:border-violet-500 focus:outline-none" />
                </div>
                <button onClick={verify} disabled={loading || verifyCode.length !== 6}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors">
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
