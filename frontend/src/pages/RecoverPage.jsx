import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Mail, MessageSquare, KeyRound, Users, ShieldAlert } from 'lucide-react';
import AxalLogo from '../components/AxalLogo';

// Task #50 — Lost-TOTP recovery landing page. Lists available layers in
// order of friction. Layers fan out into their own mini-flows below.
//
// All URLs in emitted emails / SMS land here (env.APP_URL → axal.vc).
const API = '';  // same-origin via Cloudflare Worker

// Mirror the double-submit CSRF logic from frontend/src/lib/api.js: read the
// JS-readable `studioos_csrf` cookie and echo it back in the X-CSRF-Token
// header on every mutating (POST) request. The Worker only enforces CSRF when
// an auth cookie is present (e.g. a stale session lingering on this device), so
// without this header the recovery POSTs fail with "CSRF token missing or
// invalid". Returns {} when the cookie is absent (dev / never-logged-in), where
// the Worker doesn't enforce the check anyway.
function csrfHeader() {
  if (typeof document === 'undefined') return {};
  const cookie = document.cookie || '';
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === 'studioos_csrf') {
      return { 'X-CSRF-Token': trimmed.slice(eq + 1) };
    }
  }
  return {};
}

async function post(path, body) {
  const r = await fetch(`${API}/api/auth/recover${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeader() },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
  return j;
}

function FrictionBadge({ level }) {
  const map = {
    fast: { txt: '< 60 seconds', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    medium: { txt: '~ 5 minutes', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    slow: { txt: 'up to 48 hours', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  };
  const it = map[level] || map.medium;
  return <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${it.cls}`}>{it.txt}</span>;
}

function Card({ icon: Icon, title, friction, body, cta, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full text-left bg-white border rounded-xl p-4 transition ${disabled ? 'opacity-40 cursor-not-allowed border-gray-200' : 'border-gray-200 hover:border-violet-300 hover:shadow-sm'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-violet-600" />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{title}</span>
        </div>
        <FrictionBadge level={friction} />
      </div>
      <p className="text-xs text-gray-600 leading-relaxed mb-2">{body}</p>
      <span className="text-xs font-medium text-violet-700">{cta} →</span>
    </button>
  );
}

export default function RecoverPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [layers, setLayers] = useState(null);
  const [mode, setMode] = useState('intro');  // intro|backup|sms|email|trusted|admin|email_link
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Backup code
  const [code, setCode] = useState('');

  // SMS
  const [smsSession, setSmsSession] = useState('');
  const [, setSmsLast4] = useState('');
  const [smsCode, setSmsCode] = useState('');

  // Admin escalation reason
  const [reason, setReason] = useState('');

  // Email-link consume (when arriving via magic URL)
  const linkToken = params.get('token');
  const linkTicket = params.get('ticket');
  const isTrusted = params.get('trusted') === '1';
  const isAdmin = params.get('admin') === '1';

  useEffect(() => {
    // If landing here from the magic URL, resolve the session immediately.
    if (!linkToken || !linkTicket) return;
    (async () => {
      setBusy(true); setError(''); setInfo('');
      try {
        const r = (isTrusted || isAdmin)
          ? await post('/claim', { token: linkToken, ticket_id: Number(linkTicket) })
          : await fetch(`/api/auth/recover/email/verify?token=${encodeURIComponent(linkToken)}&ticket=${encodeURIComponent(linkTicket)}`, { credentials: 'include' })
              .then(async (res) => { const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`); return j; });
        if (r?.token) localStorage.setItem('token', r.token);
        if (r?.user) localStorage.setItem('user', JSON.stringify(r.user));
        setInfo(r?.note || 'Recovery complete. Redirecting…');
        setTimeout(() => { window.location.href = '/account#security'; }, 1500);
      } catch (e) {
        setError(e?.message || 'Could not complete recovery.');
      } finally { setBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScan = async () => {
    if (!email.trim()) { setError('Enter your account email.'); return; }
    setBusy(true); setError('');
    try {
      const r = await post('/start', { email: email.trim() });
      setLayers(r);
    } catch (e) { setError(e?.message || 'Could not start recovery.'); }
    finally { setBusy(false); }
  };

  const submitBackup = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await post('/backup-code', { email: email.trim(), code });
      if (r?.token) localStorage.setItem('token', r.token);
      if (r?.user) localStorage.setItem('user', JSON.stringify(r.user));
      setInfo(r?.note || 'Recovery complete.');
      setTimeout(() => { window.location.href = '/account#security'; }, 1200);
    } catch (e) { setError(e?.message || 'Invalid code.'); }
    finally { setBusy(false); }
  };

  const startSms = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await post('/sms/start', { email: email.trim() });
      if (!r?.session_info) { setError('SMS recovery is not available for this account.'); return; }
      setSmsSession(r.session_info); setSmsLast4(r.last4 || '');
      setInfo(`Code sent to •••• •••• ${r.last4 || ''}. Enter the 6 digits below.`);
    } catch (e) { setError(e?.message || 'Could not send SMS.'); }
    finally { setBusy(false); }
  };

  const verifySms = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await post('/sms/verify', { email: email.trim(), session_info: smsSession, code: smsCode });
      if (r?.token) localStorage.setItem('token', r.token);
      if (r?.user) localStorage.setItem('user', JSON.stringify(r.user));
      setInfo(r?.note || 'Recovery complete.');
      setTimeout(() => { window.location.href = '/account#security'; }, 1500);
    } catch (e) { setError(e?.message || 'Invalid code.'); }
    finally { setBusy(false); }
  };

  const sendEmailMagic = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      await post('/email/start', { email: email.trim() });
      setInfo('If an account exists with that email, a sign-in link is on the way. It expires in 15 minutes. The resulting session is lower-assurance: re-enrol your authenticator within 7 days or your account will re-lock.');
    } catch (e) { setError(e?.message || 'Could not send email.'); }
    finally { setBusy(false); }
  };

  const startTrusted = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      await post('/trusted-contact/start', { email: email.trim() });
      // Endpoint is constant-shape (Task #50, no enumeration). We don't
      // surface ticket_id / contact count to the unauthenticated caller
      // — the trusted contacts get an email out-of-band.
      setInfo("If your account has at least two trusted contacts on file, they've each been emailed an attest link. Once both approve, you'll receive a claim link to finish recovery.");
    } catch (e) {
      setError(e?.message === 'not_enough_trusted_contacts'
        ? 'You need at least two active trusted contacts to use this layer.'
        : e?.message || 'Could not start trusted-contact recovery.');
    } finally { setBusy(false); }
  };

  const escalateAdmin = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await post('/admin/escalate', { email: email.trim(), reason });
      setInfo(`Submitted to Axal VC security (ticket #${r.ticket_id || '-'}). Two admins must co-sign; you'll get an email with a claim link once approved. This can take up to 48 hours.`);
    } catch (e) { setError(e?.message || 'Could not submit.'); }
    finally { setBusy(false); }
  };

  // When arriving via magic URL, render a minimal status screen.
  if (linkToken && linkTicket) {
    return (
      <Shell>
        <h2 className="text-xl font-bold mb-2">Completing recovery…</h2>
        {error && <Banner kind="error">{error}</Banner>}
        {info && <Banner kind="info">{info}</Banner>}
        {busy && <p className="text-sm text-gray-600">Working…</p>}
        <p className="text-xs text-gray-500 mt-6">
          You can close this tab once you see the redirect.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h2 className="text-xl font-bold mb-1">Recover your account</h2>
      <p className="text-sm text-gray-600 mb-5">
        Lost your authenticator? Pick the option you can still access. Each step adds friction so social-engineering takeovers stay blocked, while legitimate recovery completes in minutes.
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      {info && <Banner kind="info">{info}</Banner>}

      {mode === 'intro' && (
        <>
          <label className="text-xs text-gray-600 block mb-1">Account email</label>
          <input type="email" value={email} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm mb-3 dark:border-gray-700" />
          {!layers ? (
            <button onClick={startScan} disabled={busy || !email.trim()}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
              {busy ? 'Checking…' : 'See my options'}
            </button>
          ) : (
            <div className="space-y-3">
              <Card icon={KeyRound} title="Backup recovery code" friction="fast"
                disabled={!layers.backup_code}
                body={layers.backup_code
                  ? 'Use one of the 12-character codes you printed when you enabled two-factor. Single-use, no cool-off, full access immediately.'
                  : 'No active backup codes on file for this account.'}
                cta="Use a backup code" onClick={() => setMode('backup')} />
              <Card icon={MessageSquare} title="SMS verification" friction="fast"
                disabled={!layers.sms}
                body={layers.sms
                  ? 'We text a one-time code to the phone on file. Recovery completes immediately; billing, contracts and other sensitive actions pause for 24 hours.'
                  : layers.sms_available ? 'No SMS factor is enrolled on this account.' : 'SMS is not configured on this server.'}
                cta="Send SMS code" onClick={() => setMode('sms')} />
              <Card icon={Mail} title="Email magic link" friction="medium"
                body="We email a one-time sign-in link. The resulting session is lower-assurance — sensitive actions are paused for 24 hours and you must re-enrol your authenticator within 7 days or your account re-locks."
                cta="Email me a link" onClick={() => setMode('email')} />
              <Card icon={Users} title="Trusted contacts (2 of 2)" friction="medium"
                disabled={!layers.trusted_contact}
                body={layers.trusted_contact
                  ? 'Two of your trusted contacts (added in Settings → Security) confirm it\'s really you. They must each sign in with their own authenticator on Axal VC.'
                  : 'Set up at least two trusted contacts before this option is available (Settings → Security).'}
                cta="Ask my trusted contacts" onClick={() => setMode('trusted')} />
              <Card icon={ShieldAlert} title="Admin manual review" friction="slow"
                body="Submit a ticket. Two Axal VC admins must co-sign and you'll get a one-time claim link by email. Used when no other option is available."
                cta="Escalate to Axal VC security" onClick={() => setMode('admin')} />
            </div>
          )}
        </>
      )}

      {mode === 'backup' && (
        <FlowBox onBack={() => setMode('intro')} title="Backup recovery code">
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX" maxLength={14}
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-base font-mono tracking-widest text-center mb-3 dark:border-gray-700" />
          <button onClick={submitBackup} disabled={busy || code.replace(/[-\s]/g, '').length !== 12}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
            {busy ? 'Verifying…' : 'Recover account'}
          </button>
        </FlowBox>
      )}

      {mode === 'sms' && (
        <FlowBox onBack={() => setMode('intro')} title="SMS verification">
          {!smsSession ? (
            <button onClick={startSms} disabled={busy}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
              {busy ? 'Sending…' : 'Send code'}
            </button>
          ) : (
            <>
              <input type="text" value={smsCode} inputMode="numeric" maxLength={6}
                onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-2xl text-center tracking-[0.5em] font-mono mb-3 dark:border-gray-700" />
              <button onClick={verifySms} disabled={busy || smsCode.length !== 6}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
                {busy ? 'Verifying…' : 'Verify and sign in'}
              </button>
            </>
          )}
        </FlowBox>
      )}

      {mode === 'email' && (
        <FlowBox onBack={() => setMode('intro')} title="Email magic link">
          <p className="text-xs text-gray-600 mb-3">
            The link expires in 15 minutes and can only be used once. The resulting session is lower-assurance: billing, contracts, capital movement, DD downloads, KYC re-submission and impersonation are paused for 24 hours, and you must re-enrol your authenticator within 7 days.
          </p>
          <button onClick={sendEmailMagic} disabled={busy}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </FlowBox>
      )}

      {mode === 'trusted' && (
        <FlowBox onBack={() => setMode('intro')} title="Trusted contacts">
          <p className="text-xs text-gray-600 mb-3">
            Both contacts must sign in to Axal VC with their own authenticator to attest. You'll get a one-time claim link by email when both have approved.
          </p>
          <button onClick={startTrusted} disabled={busy}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
            {busy ? 'Notifying contacts…' : 'Ask my trusted contacts'}
          </button>
        </FlowBox>
      )}

      {mode === 'admin' && (
        <FlowBox onBack={() => setMode('intro')} title="Admin manual review">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)}
            rows={4} maxLength={2000}
            placeholder="Briefly describe what happened (lost device, locked out, etc.) — admins read this when reviewing your ticket."
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-sm mb-3 dark:border-gray-700" />
          <button onClick={escalateAdmin} disabled={busy || !email.trim()}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white">
            {busy ? 'Submitting…' : 'Submit to Axal VC security'}
          </button>
        </FlowBox>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <Link to="/login" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-6">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center justify-center mb-5">
            <AxalLogo size="lg" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function FlowBox({ children, onBack, title }) {
  return (
    <div>
      <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-900 mb-3 flex items-center gap-1">
        <ArrowLeft size={12} /> Back to options
      </button>
      <h3 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">{title}</h3>
      {children}
    </div>
  );
}

function Banner({ kind, children }) {
  const cls = kind === 'error'
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-violet-50 border-violet-200 text-violet-800';
  return <div className={`text-xs border rounded-lg px-3 py-2 mb-4 ${cls}`}>{children}</div>;
}
