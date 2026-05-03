import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Smartphone, Copy, Check, Mail, RefreshCw, Send, Sparkles, ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export default function RegisterPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ email: '', name: '' });
  const [totpData, setTotpData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [emailWarning, setEmailWarning] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState('');
  const [refCode, setRefCode] = useState('');
  const [lane, setLane] = useState(null); // 'partner' | 'lp' | 'founder' | null
  const [productIntent, setProductIntent] = useState(null); // 'spinout-lab' | null
  // Which "I can't scan the QR" app card is expanded on step 4. null = all collapsed.
  const [manualOpen, setManualOpen] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('ref');
    if (r) setRefCode(r.toUpperCase());
    const l = params.get('lane');
    if (l && ['partner', 'lp', 'founder'].includes(l)) {
      setLane(l);
      try { localStorage.setItem('gvpn:intent', JSON.stringify({ lane: l, ts: Date.now() })); } catch {}
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem('gvpn:intent') || 'null');
        if (saved?.lane) setLane(saved.lane);
      } catch {}
    }
    const p = params.get('product');
    if (p === 'spinout-lab') setProductIntent('spinout-lab');
  }, []);

  const laneCopy = {
    partner: {
      title: 'Join the Partner Network',
      desc: "Get matched with deals before they go public. We use TOTP for secure, passwordless authentication.",
      chatGreeting: "Welcome to the GVPN Partner Network. To match you with the right deal flow, tell me what you bring — sector expertise, capital, distribution, technical, legal, or operational?",
    },
    lp: {
      title: 'Open your LP Account',
      desc: 'Track commitments, calls, and distributions. We use TOTP for secure, passwordless authentication.',
      chatGreeting: "Welcome to GVPN's Capital Lane. To set up your LP profile, tell me about your fund or family office: vintage focus, ticket size, sectors, and any restrictions.",
    },
    founder: {
      title: 'Submit your pitch',
      desc: "We'll score your venture within 72 hours. We use TOTP for secure, passwordless authentication.",
      chatGreeting: "Welcome to GVPN. To run our 100-point scoring on your venture, tell me about it: problem, team, traction, and the next 12 months. If you're applying to Spin-Out Lab, mention that too.",
    },
  };
  const activeLane = lane && laneCopy[lane] ? laneCopy[lane] : null;

  // Chatbot state (step 2) — greeting reflects lane intent when known.
  const DEFAULT_GREETING = "Welcome to the Global Venture Partner Network. Are you joining as an Investor (LP / Syndicate / Co-Investor), a Founder, an Operator/Advisor, a Legal or Technical Partner, or a Liquidity Provider?";
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: DEFAULT_GREETING },
  ]);
  // When lane resolves from URL/localStorage after first render, swap the
  // initial greeting — but only if the user hasn't typed anything yet.
  useEffect(() => {
    if (!activeLane) return;
    setChatMessages((prev) => {
      const onlyDefault = prev.length === 1 && prev[0].role === 'assistant';
      if (!onlyDefault) return prev;
      return [{ role: 'assistant', content: activeLane.chatGreeting }];
    });
  }, [lane]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const chatScrollRef = useRef(null);

  const canvasRef = useRef(null);
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  useEffect(() => {
    if (totpData?.provisioning_uri && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, totpData.provisioning_uri, {
        width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' },
      });
    }
  }, [totpData]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current || step !== 1) return;
    if (typeof window.turnstile === 'undefined') {
      const interval = setInterval(() => {
        if (typeof window.turnstile !== 'undefined' && turnstileRef.current) {
          clearInterval(interval);
          renderTurnstile();
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
  }, [step]);

  const register = async () => {
    if (!form.name.trim()) { setError('Please enter your full name'); return; }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!form.email.trim() || !emailRe.test(form.email.trim())) { setError('Please enter a valid email address (e.g. you@example.com)'); return; }
    if (TURNSTILE_SITE_KEY && !turnstileToken) { setError('Please complete the verification challenge'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await api.register({ ...form, turnstileToken, ref_code: refCode || undefined });
      setEmailWarning(res?.email_sent === false);
      if (res?.verification_url) setVerificationUrl(res.verification_url);
      setStep(2);
    } catch (e) {
      setError(e.message);
      if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
        try { window.turnstile.reset(turnstileWidgetId.current); } catch {}
        setTurnstileToken('');
      }
    }
    setLoading(false);
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const newMessages = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);
    setError('');
    try {
      const res = await api.profilingChat({ email: form.email, messages: newMessages });
      setChatMessages([...newMessages, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setError(e.message);
      setChatMessages([...newMessages, { role: 'assistant', content: "I had trouble responding. Please try again, or click 'Save profile & continue' when ready." }]);
    }
    setChatLoading(false);
  };

  const finishProfiling = async () => {
    if (chatMessages.filter(m => m.role === 'user').length < 1) {
      setError('Please answer at least one question before continuing.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.profilingSave({ email: form.email, messages: chatMessages });
      setProfileSaved(true);
      setStep(3);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const resendEmail = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.resendVerification({ email: form.email });
      if (res?.verification_url) {
        setVerificationUrl(res.verification_url);
        setEmailWarning(true);
      }
      setResendCooldown(60);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const verify = async () => {
    if (!verifyCode || verifyCode.length !== 6) { setError('Please enter a 6-digit code'); return; }
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
    } catch (e) { setError(e.message); }
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
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-8">
          <ArrowLeft size={14} /> Back to GVPN
        </Link>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <img src="/axal-mark.png" alt="Axal VC" className="h-9 w-9 rounded-lg object-contain" />
            <span style={{fontFamily:"'Space Grotesk', sans-serif"}} className="text-lg font-bold text-gray-900">Axal VC</span>
          </div>

          {/* 4-step progress bar */}
          <div className="flex gap-2 mb-6">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className={`flex-1 h-1 rounded-full ${step >= n ? 'bg-violet-600' : 'bg-gray-300'}`} />
            ))}
          </div>

          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-1">{activeLane?.title || 'Create Your Account'}</h2>
              <p className="text-sm text-gray-600 mb-6">{activeLane?.desc || 'Join the Global Venture Partner Network. We use TOTP for secure, passwordless authentication.'}</p>

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

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Full Name</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-500 focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="john@company.com"
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-500 focus:border-violet-500 focus:outline-none" />
                </div>
                {TURNSTILE_SITE_KEY && (
                  <div ref={turnstileRef} className="flex justify-center" />
                )}
                <button onClick={register} disabled={loading || (TURNSTILE_SITE_KEY && !turnstileToken)}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors">
                  {loading ? 'Creating Account...' : 'Continue'}
                </button>
              </div>

              <p className="text-xs text-gray-600 text-center mt-4">
                Already have an account? <Link to="/login" className="text-violet-600 hover:underline font-medium">Sign in</Link>
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={18} className="text-violet-600" />
                <h2 className="text-xl font-bold text-gray-900">Tell us about yourself</h2>
              </div>
              <p className="text-sm text-gray-600 mb-4">Our AI assistant will profile your interest so an Axal admin can propose the right partnership agreement.</p>

              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}

              <div ref={chatScrollRef} className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 h-72 overflow-y-auto space-y-2">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] text-xs px-3 py-2 rounded-lg whitespace-pre-wrap leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-violet-600 text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                    }`}>{m.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 text-gray-500 text-xs px-3 py-2 rounded-lg rounded-bl-sm">
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  placeholder="Type your reply..."
                  disabled={chatLoading}
                  className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
                />
                <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                  className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-3 text-white transition-colors">
                  <Send size={14} />
                </button>
              </div>

              <button onClick={finishProfiling} disabled={loading || chatLoading}
                className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors">
                {loading ? 'Saving profile...' : 'Save profile & continue'}
              </button>
              <p className="text-[11px] text-gray-500 text-center mt-2">An admin will review your profile and propose a Closing Binder.</p>
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
                {emailWarning ? 'Email delivery is not configured. Use the link below to verify:' : `We've sent a verification link to`}
              </p>
              {!emailWarning && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 mb-6 text-center">
                  <span className="text-sm font-medium text-gray-900">{form.email}</span>
                </div>
              )}

              {profileSaved && (
                <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-300 rounded-lg p-3 mb-4">
                  <Check size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700">
                    Profile captured. An Axal admin will review it and propose your partnership agreement once your email is verified.
                  </p>
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
                <div className="flex items-start gap-2 bg-violet-50 border border-violet-300 rounded-lg p-3 mb-6">
                  <Mail size={16} className="text-violet-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-violet-700">
                    Click the link in the email to verify your address and continue setting up your authenticator. The link expires in 24 hours.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <button onClick={resendEmail} disabled={loading || resendCooldown > 0}
                  className="w-full bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-gray-700 flex items-center justify-center gap-2 transition-colors">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : loading ? 'Sending...' : 'Resend Verification Email'}
                </button>
                <button onClick={() => { setStep(1); setError(''); setVerificationUrl(''); setEmailWarning(false); }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700 py-1 transition-colors">
                  Use a different email
                </button>
              </div>
            </>
          )}

          {step === 4 && totpData && (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Set Up Authenticator</h2>
              <p className="text-sm text-gray-600 mb-6">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>

              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

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

              <div className="flex items-start gap-2 bg-violet-50 border border-violet-300 rounded-lg p-3 mb-4">
                <Smartphone size={16} className="text-violet-600 shrink-0 mt-0.5" />
                <p className="text-xs text-violet-700">
                  Open your authenticator app, scan the QR code or enter the secret key manually, then enter the 6-digit code below to verify.
                </p>
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
                        'A new 6-digit code will appear. Type it into the verification box below.',
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
                        'Authy will show a 6-digit code — type it into the verification box below.',
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
                        '1Password will start generating a 6-digit code — copy it into the verification box below.',
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
                        'Type the current code into the verification box below.',
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

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">Enter 6-digit code from authenticator</label>
                  <input type="text" value={verifyCode} onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" maxLength={6}
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-400 focus:border-violet-500 focus:outline-none" />
                </div>
                <button onClick={verify} disabled={loading || verifyCode.length !== 6}
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
