import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';
import {
  User, Globe, Mail, ShieldCheck, Bell, Lock, Briefcase, Users,
  Camera, Save, AlertTriangle, CheckCircle2, Trash2, LogOut, Download,
  Plus, X, KeyRound,
} from 'lucide-react';

// ---------- Reference data --------------------------------------------------

// ISO 3166-1 alpha-2 + a couple of common alpha-3 codes — pared down to the
// jurisdictions Axal LPs/founders typically operate in. The backend stores
// whatever 2/3-letter codes we send, so this is a UI-side curation.
const JURISDICTIONS = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'EE', name: 'Estonia' },
  { code: 'AE', name: 'UAE' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'IL', name: 'Israel' },
  { code: 'IN', name: 'India' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'KY', name: 'Cayman Islands' },
  { code: 'BM', name: 'Bermuda' },
  { code: 'VG', name: 'British Virgin Islands' },
];

const NOTIFICATION_EVENTS = [
  { key: 'deal_assigned', label: 'New deal assigned to me' },
  { key: 'pipeline_status_change', label: 'Pipeline status changes' },
  { key: 'capital_call_issued', label: 'Capital call issued' },
  { key: 'capital_call_paid', label: 'Capital call marked paid' },
  { key: 'agreement_ready_to_sign', label: 'Agreement ready to sign' },
  { key: 'kyc_status_change', label: 'KYC status updates' },
  { key: 'mentions_and_comments', label: 'Mentions & comments' },
  { key: 'ticket_update', label: 'Ticket updates' },
  { key: 'deal_stage_change', label: 'Deal stage changes' },
  { key: 'score_generated', label: 'New score generated for your project' },
  { key: 'vote_threshold_reached', label: 'Pipeline vote threshold reached' },
  { key: 'weekly_digest', label: 'Weekly digest' },
  { key: 'product_announcements', label: 'Product announcements' },
];

// Channel keys are the canonical names used by services/notify.{py,ts}.
// `inapp` is kept as an alias-only column for legacy `notification_prefs`
// rows, but the new subsystem reads/writes `in_app`.
const NOTIFICATION_CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'in_app', label: 'In-app' },
  { key: 'slack', label: 'Slack' },
  // SMS column reserved — wired in the table as disabled until Twilio is provisioned.
  { key: 'sms', label: 'SMS', disabled: true, hint: 'Coming soon' },
];

// Partner-only events — surfaced as a sub-section so partners can wire deal-flow
// and mandate-relevant alerts independently of the core event grid.
const PARTNER_NOTIFICATION_EVENTS = [
  { key: 'partner_high_score_deal', label: 'New deal scores above your threshold' },
  { key: 'partner_pipeline_activity', label: 'Founder activity on watched deals' },
  { key: 'partner_capital_call_due', label: 'Capital call due in 7 days' },
  { key: 'partner_match_recommendation', label: 'AI match recommendation' },
  { key: 'partner_kyc_block', label: 'A founder you backed is blocked on KYC' },
];

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'jurisdictions', label: 'Jurisdictions', icon: Globe },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'auth', label: 'Authentication', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'role', label: 'Role preferences', icon: Briefcase },
];

// ---------- Page ------------------------------------------------------------

// Map a deep-link URL path → preselected section id. The page is mounted
// at both `/settings` (top-level) and `/settings/:section` so the bell can
// land users directly on the notification matrix.
const PATH_TO_SECTION = {
  notifications: 'notifications',
  profile: 'profile',
  jurisdictions: 'jurisdictions',
  auth: 'auth',
  privacy: 'privacy',
  role: 'role',
};

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialSection = (() => {
    const m = location.pathname.match(/^\/settings\/([^/]+)/);
    if (m && PATH_TO_SECTION[m[1]]) return PATH_TO_SECTION[m[1]];
    return 'profile';
  })();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(initialSection);

  // Keep the URL in lockstep with the active section so deep links work
  // both ways (bell → /settings/notifications, sidebar click → URL update).
  useEffect(() => {
    const want = active === 'profile' ? '/settings' : `/settings/${active}`;
    if (location.pathname !== want && location.pathname.startsWith('/settings')) {
      navigate(want, { replace: true });
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  // T19 — useToast handles cleanup on unmount; replaces inline `window.setTimeout(setToast, 4500)`.
  const { toast, showToast: setToastSafe } = useToast(4500);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getSettings();
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const flash = (message, kind = 'success') => setToastSafe({ message, kind });

  const patch = async (delta) => {
    try {
      await api.updateSettings(delta);
      setData(prev => ({ ...prev, ...delta }));
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    }
  };

  if (loading) return <div className="text-gray-600 text-center py-20">Loading…</div>;
  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 max-w-xl">
      Could not load your settings: {error}
    </div>
  );
  if (!data) return null;

  const sections = SECTIONS.filter(s => s.id !== 'role' || data.role !== 'admin');

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Settings</h1>
      <p className="text-gray-600 mb-6">Profile, security, notifications, and role preferences for your Axal account.</p>

      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${
          toast.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {toast.kind === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {toast.message}
        </div>
      )}

      <div className="grid lg:grid-cols-[200px_1fr] gap-6">
        <nav className="space-y-1 text-sm sticky top-4 self-start">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                active === s.id ? 'bg-violet-50 text-violet-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <s.icon size={14} />
              {s.label}
            </button>
          ))}
        </nav>

        <div className="space-y-6">
          {active === 'profile' && <ProfileSection data={data} onSaved={(d) => setData(prev => ({ ...prev, ...d }))} flash={flash} patch={patch} />}
          {active === 'jurisdictions' && <JurisdictionsSection data={data} patch={patch} />}
          {active === 'email' && <EmailSection data={data} flash={flash} reload={() => api.getSettings().then(setData)} />}
          {active === 'auth' && <AuthSection data={data} flash={flash} />}
          {active === 'notifications' && <NotificationsSection data={data} patch={patch} />}
          {active === 'privacy' && <PrivacySection data={data} patch={patch} flash={flash} reload={() => api.getSettings().then(setData)} />}
          {active === 'role' && <RolePreferencesSection data={data} patch={patch} />}
        </div>
      </div>
    </div>
  );
}

// ---------- Sections --------------------------------------------------------

function Card({ title, description, children, footer }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">{footer}</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-gray-500 block mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500';

function ProfileSection({ data, onSaved, flash, patch }) {
  const [name, setName] = useState(data.name || '');
  const [bio, setBio] = useState(data.profile?.bio || '');
  const [socials, setSocials] = useState(data.profile?.socials || {});
  const [headshotPreview, setHeadshotPreview] = useState(data.profile?.headshot_url || null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const onFile = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      flash('Image must be JPEG, PNG, or WebP', 'error');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      flash('Image must be under 3MB', 'error');
      return;
    }
    const dataUri = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setBusy(true);
    try {
      const res = await api.uploadHeadshot(dataUri);
      setHeadshotPreview(`${res.headshot_url}?t=${Date.now()}`);
      onSaved({ profile: { ...data.profile, headshot_url: res.headshot_url } });
      flash('Headshot updated');
    } catch (e) {
      flash(e.message || 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Profile" description="Your headshot, name, and bio show up across the platform.">
        <div className="flex items-start gap-5">
          <div className="flex flex-col items-center gap-2">
            <div className="w-24 h-24 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden">
              {headshotPreview ? (
                <img src={headshotPreview} alt="" className="w-full h-full object-cover" onError={() => setHeadshotPreview(null)} />
              ) : (
                <User size={36} className="text-gray-400" />
              )}
            </div>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              className="text-xs text-violet-700 hover:text-violet-800 flex items-center gap-1 disabled:opacity-50">
              <Camera size={12} /> {busy ? 'Uploading…' : 'Change'}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          </div>
          <div className="flex-1 space-y-3">
            <Field label="Display name">
              <input value={name} onChange={e => setName(e.target.value)}
                onBlur={() => name !== data.name && patch({ name })} className={inputCls} />
            </Field>
            <Field label="Bio" hint="Up to 2,000 characters. Markdown is not rendered.">
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={4}
                onBlur={() => bio !== (data.profile?.bio || '') && patch({ bio })} className={inputCls} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Social links" description="Optional. Public to other Axal members.">
        <div className="grid sm:grid-cols-2 gap-3">
          {['linkedin', 'twitter', 'website', 'github'].map(k => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
              <input value={socials[k] || ''} onChange={e => setSocials({ ...socials, [k]: e.target.value })}
                onBlur={() => patch({ socials })} placeholder={`https://...`} className={inputCls} />
            </Field>
          ))}
        </div>
      </Card>
    </>
  );
}

function JurisdictionsSection({ data, patch }) {
  const selected = useMemo(() => new Set(data.jurisdictions || []), [data.jurisdictions]);
  const [picked, setPicked] = useState(selected);

  const toggle = (code) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code); else next.add(code);
    setPicked(next);
    patch({ jurisdictions: Array.from(next) });
  };

  return (
    <Card title="Jurisdictions" description="Where you operate or invest. Used to filter deal flow and compliance prompts.">
      <div className="flex flex-wrap gap-2">
        {JURISDICTIONS.map(j => {
          const isSel = picked.has(j.code);
          return (
            <button key={j.code} onClick={() => toggle(j.code)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                isSel ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-700 border-gray-200 hover:border-violet-400'
              }`}>
              {j.code} · {j.name}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function EmailSection({ data, flash, reload }) {
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = data.pending_email_change;

  const submit = async () => {
    if (!newEmail.trim()) return;
    setBusy(true);
    try {
      const res = await api.requestEmailChange(newEmail.trim());
      const msg = res.email_sent
        ? `Confirmation link sent to ${res.new_email}. A revocation link was also sent to your current email.`
        : `Confirmation link generated. Open it from your inbox or this dev URL: ${res.confirm_url || '(check server logs)'}`;
      flash(msg);
      setNewEmail('');
      reload();
    } catch (e) {
      flash(e.message || 'Failed to start email change', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Email address" description="The new address must confirm within 24 hours. The old address can revoke the change within 24 hours of the request.">
      <div className="space-y-3">
        <Field label="Current email">
          <input value={data.email} disabled className={`${inputCls} bg-gray-50 text-gray-500`} />
        </Field>
        {pending ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            Pending change to <span className="font-medium">{pending.new_email}</span> — confirm by{' '}
            {new Date(pending.expires_at).toLocaleString()}.
          </div>
        ) : (
          <Field label="New email" hint="We'll send a confirmation link to this address.">
            <div className="flex gap-2">
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={inputCls} />
              <button onClick={submit} disabled={busy || !newEmail}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
                {busy ? 'Sending…' : 'Send confirmation'}
              </button>
            </div>
          </Field>
        )}
      </div>
    </Card>
  );
}

function AuthSection({ data, flash }) {
  const [code, setCode] = useState('');
  const [qrPayload, setQrPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Sessions list (per-device revocation, populated from /settings/sessions).
  const [sessions, setSessions] = useState(null);
  const [sessionsErr, setSessionsErr] = useState(null);
  const [sessionBusyId, setSessionBusyId] = useState(null);

  // Recovery codes
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState(null);
  const remaining = data.totp_recovery_codes_remaining ?? 0;

  const loadSessions = async () => {
    try {
      const res = await api.listSessions();
      setSessions(res?.sessions || []);
      setSessionsErr(null);
    } catch (e) {
      setSessionsErr(e.message || 'Failed to load sessions');
    }
  };
  useEffect(() => { loadSessions(); }, []);

  const repair = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await api.repairTotp(code.trim());
      setQrPayload(res);
      setCode('');
      flash('TOTP re-paired. Scan the new QR with your authenticator before signing in again.');
    } catch (e) {
      flash(e.message || 'TOTP repair failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    if (!window.confirm('Sign out all active sessions including this one?')) return;
    setRevoking(true);
    try {
      await api.revokeAllSessions();
      flash('All sessions revoked. You will be signed out shortly.');
      window.setTimeout(() => {
        try { localStorage.clear(); } catch {}
        window.location.href = '/login';
      }, 1500);
    } catch (e) {
      flash(e.message || 'Failed to revoke sessions', 'error');
      setRevoking(false);
    }
  };

  const revokeOne = async (sess) => {
    if (sess.is_current && !window.confirm('This is your current session — revoking will sign you out. Continue?')) return;
    setSessionBusyId(sess.id);
    try {
      await api.revokeSession(sess.id);
      flash('Session revoked.');
      if (sess.is_current) {
        window.setTimeout(() => {
          try { localStorage.clear(); } catch {}
          window.location.href = '/login';
        }, 800);
      } else {
        await loadSessions();
      }
    } catch (e) {
      flash(e.message || 'Failed to revoke session', 'error');
    } finally {
      setSessionBusyId(null);
    }
  };

  const regenerateRecovery = async () => {
    if (!recoveryCode.trim()) return;
    if (remaining > 0 && !window.confirm('This invalidates any existing recovery codes. Continue?')) return;
    setRecoveryBusy(true);
    try {
      const res = await api.regenerateRecoveryCodes(recoveryCode.trim());
      setGeneratedCodes(res?.codes || []);
      setRecoveryCode('');
      flash('Recovery codes generated — save them now.');
    } catch (e) {
      flash(e.message || 'Failed to generate recovery codes', 'error');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const downloadCodes = () => {
    if (!generatedCodes) return;
    const txt = `Axal — TOTP recovery codes (${data.email})\nGenerated ${new Date().toISOString()}\n\n${generatedCodes.join('\n')}\n\nEach code can be used exactly once if you lose access to your authenticator app.\nDo not share these. Store somewhere safe (password manager, sealed envelope, etc.).\n`;
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `axal-recovery-codes-${(data.uid || data.id)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Card title="Two-factor authentication" description="Re-pair your authenticator if you lost or replaced your device.">
        {!qrPayload ? (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              Status: {data.totp_configured
                ? <span className="text-emerald-700 font-medium">Configured</span>
                : <span className="text-amber-700 font-medium">Not configured</span>}
            </div>
            {data.totp_configured && (
              <Field label="Enter your current 6-digit code to re-pair">
                <div className="flex gap-2">
                  <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" inputMode="numeric" className={inputCls} />
                  <button onClick={repair} disabled={busy || code.length !== 6}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
                    {busy ? 'Verifying…' : 'Re-pair'}
                  </button>
                </div>
              </Field>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">Scan with your authenticator. After scanning, sign out and back in to confirm.</div>
            {qrPayload.qr_code ? (
              <img src={`data:image/png;base64,${qrPayload.qr_code}`} alt="TOTP QR"
                className="w-48 h-48 border border-gray-200 rounded-lg p-2 bg-white" />
            ) : (
              <div className="text-xs text-gray-600 break-all p-3 bg-gray-50 rounded-lg">{qrPayload.provisioning_uri}</div>
            )}
            <Field label="Manual entry secret">
              <input value={qrPayload.totp_secret} readOnly className={`${inputCls} font-mono`} onFocus={e => e.target.select()} />
            </Field>
          </div>
        )}
      </Card>

      <Card title="Recovery codes"
        description="One-time codes you can use to sign in if you lose access to your authenticator app.">
        {generatedCodes ? (
          <div className="space-y-3">
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              These codes will not be shown again. Save them somewhere safe before you leave this page.
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {generatedCodes.map((c, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded px-3 py-2 select-all">{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadCodes}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
                Download as .txt
              </button>
              <button onClick={() => setGeneratedCodes(null)}
                className="px-4 py-2 border border-gray-300 hover:border-gray-400 text-gray-700 rounded-lg text-sm">
                I've saved them
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              {remaining > 0
                ? <>You have <span className="font-semibold">{remaining}</span> unused recovery code{remaining === 1 ? '' : 's'}.</>
                : <span className="text-amber-700">You don't have any recovery codes yet — generate a set and store them somewhere safe.</span>}
            </div>
            {data.totp_configured ? (
              <Field label="Enter your current 6-digit TOTP code to generate 8 new recovery codes">
                <div className="flex gap-2">
                  <input value={recoveryCode}
                    onChange={e => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" inputMode="numeric" className={inputCls} />
                  <button onClick={regenerateRecovery} disabled={recoveryBusy || recoveryCode.length !== 6}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
                    {recoveryBusy ? 'Generating…' : (remaining > 0 ? 'Regenerate codes' : 'Generate codes')}
                  </button>
                </div>
              </Field>
            ) : (
              <div className="text-sm text-gray-500">Configure TOTP first.</div>
            )}
          </div>
        )}
      </Card>

      <Card title="Active sessions" description="See every device with an active session and revoke individual ones — or sign everything out at once.">
        {sessionsErr && <div className="text-sm text-red-600 mb-3">{sessionsErr}</div>}
        {sessions === null ? (
          <div className="text-sm text-gray-500">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-gray-500 mb-3">No tracked sessions yet. New sign-ins will appear here.</div>
        ) : (
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-2 py-2 font-medium">Device</th>
                  <th className="text-left px-2 py-2 font-medium">IP</th>
                  <th className="text-left px-2 py-2 font-medium">First seen</th>
                  <th className="text-left px-2 py-2 font-medium">Last seen</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const isRevoked = !!s.revoked_at;
                  return (
                    <tr key={s.id} className={`border-b border-gray-100 ${isRevoked ? 'text-gray-400' : 'text-gray-800'}`}>
                      <td className="px-2 py-2 max-w-xs truncate" title={s.user_agent || ''}>
                        {s.user_agent || 'Unknown device'}
                        {s.is_current && (
                          <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            This device
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">{s.ip || '—'}</td>
                      <td className="px-2 py-2 text-xs">{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td>
                      <td className="px-2 py-2 text-xs">{s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : '—'}</td>
                      <td className="px-2 py-2 text-right">
                        {isRevoked ? (
                          <span className="text-xs text-gray-400">Revoked</span>
                        ) : (
                          <button onClick={() => revokeOne(s)} disabled={sessionBusyId === s.id}
                            className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
                            {sessionBusyId === s.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button onClick={revokeAll} disabled={revoking}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium flex items-center gap-2">
          <LogOut size={14} /> {revoking ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </Card>
    </>
  );
}

function NotificationsSection({ data, patch }) {
  const prefs = data.notification_prefs || {};
  const setEvent = (eventKey, channel, value) => {
    const cur = { ...(prefs[eventKey] || {}) };
    cur[channel] = value;
    // Keep `inapp`/`in_app` mirrored so the new bell subsystem and any
    // legacy reader stay consistent during the transition.
    if (channel === 'in_app') cur.inapp = value;
    if (channel === 'inapp') cur.in_app = value;
    const next = { ...prefs, [eventKey]: cur };
    patch({ notification_prefs: next });
  };

  const renderTable = (events) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left px-2 py-2 text-xs text-gray-500 font-medium">Event</th>
            {NOTIFICATION_CHANNELS.map(c => (
              <th key={c.key}
                className="text-center px-2 py-2 text-xs text-gray-500 font-medium uppercase tracking-wider"
                title={c.disabled ? c.hint : undefined}>
                {c.label}
                {c.disabled && (
                  <div className="text-[10px] normal-case font-normal text-gray-400 tracking-normal">
                    {c.hint}
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map(ev => (
            <tr key={ev.key} className="border-b border-gray-100">
              <td className="px-2 py-2 text-gray-800">{ev.label}</td>
              {NOTIFICATION_CHANNELS.map(c => {
                const checked = !!prefs[ev.key]?.[c.key];
                return (
                  <td key={c.key} className="text-center px-2 py-2">
                    <input type="checkbox" checked={checked} disabled={!!c.disabled}
                      onChange={e => setEvent(ev.key, c.key, e.target.checked)}
                      title={c.disabled ? c.hint : undefined}
                      className="w-4 h-4 text-violet-600 border-gray-300 rounded focus:ring-violet-500 disabled:opacity-40 disabled:cursor-not-allowed" />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Card title="Notifications" description="Choose where each kind of alert is delivered.">
        {renderTable(NOTIFICATION_EVENTS)}
      </Card>
      {data.role === 'partner' && (
        <Card title="Partner notification triggers"
          description="Deal-flow and mandate alerts specific to your partner / LP role.">
          {renderTable(PARTNER_NOTIFICATION_EVENTS)}
        </Card>
      )}
    </>
  );
}

// Task #55 — per-role public-profile field map. Owner sees toggles
// only for fields that actually render on /u/<handle> for their role,
// so the editor stays focused.
const PUBLIC_PROFILE_FIELDS_COMMON = [
  { key: 'name', label: 'Name' },
  { key: 'bio', label: 'Bio' },
  { key: 'headshot', label: 'Headshot' },
  { key: 'socials', label: 'Social links' },
];
const PUBLIC_PROFILE_FIELDS_BY_ROLE = {
  founder: [
    { key: 'projects', label: 'Projects (names + stage)' },
    { key: 'traction', label: 'Traction summary (users + revenue)' },
  ],
  investor: [
    { key: 'thesis', label: 'Investment thesis (sectors, stages, check size)' },
    { key: 'portfolio_summary', label: 'Portfolio engagements count' },
  ],
  partner: [
    { key: 'services', label: 'Services & categories' },
    { key: 'reviews', label: 'Reviews summary' },
    { key: 'pricing', label: 'Pricing tier & hourly rate' },
  ],
};
// Defaults must mirror backend `_DEFAULTS` in public_profiles.py so the
// owner-side toggles reflect what visitors actually see when no
// override has been saved yet.
const PUBLIC_PROFILE_DEFAULTS = {
  founder:  { name: true, bio: true, headshot: true, socials: false, projects: true, traction: true },
  investor: { name: true, bio: true, headshot: true, socials: false, thesis: true, portfolio_summary: false },
  partner:  { name: true, bio: true, headshot: true, socials: false, services: true, reviews: true, pricing: false },
  admin:    { name: true, bio: true, headshot: true, socials: false },
  mentor:   { name: true, bio: true, headshot: true, socials: false },
};

function PrivacySection({ data, patch, flash, reload }) {
  const role = (data.role || 'founder').toLowerCase();
  const defaults = PUBLIC_PROFILE_DEFAULTS[role] || PUBLIC_PROFILE_DEFAULTS.admin;
  const saved = data.privacy_prefs?.public_profile || {};
  const pp = { ...defaults, ...saved };
  const fieldList = [
    ...PUBLIC_PROFILE_FIELDS_COMMON,
    ...(PUBLIC_PROFILE_FIELDS_BY_ROLE[role] || []),
  ];
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const setVisible = (key, value) => {
    patch({ privacy_prefs: { ...data.privacy_prefs, public_profile: { ...pp, [key]: value } } });
  };

  const publicUrl = data.handle
    ? `${window.location.origin}/u/${data.handle}`
    : null;
  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      flash('Copy failed — select & copy manually', 'error');
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const blob = await api.exportMyData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `axal-data-export-${data.uid || data.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash('Export downloaded');
    } catch (e) {
      flash(e.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const requestDelete = async () => {
    if (!window.confirm('Submit an account deletion request? Our team will reach out within 7 days to confirm.')) return;
    setDeleting(true);
    try {
      const res = await api.requestAccountDeletion();
      flash(res.message || 'Deletion request submitted');
      reload();
    } catch (e) {
      flash(e.message || 'Failed to submit request', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = async () => {
    setDeleting(true);
    try {
      await api.cancelAccountDeletion();
      flash('Deletion request cancelled');
      reload();
    } catch (e) {
      flash(e.message || 'Failed to cancel', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card title="Public profile" description="Anyone with the link below can view this page. Choose what's visible per field.">
        {publicUrl && (
          <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-violet-700">Your public link</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <a href={publicUrl} target="_blank" rel="noreferrer noopener"
                 className="font-mono text-sm text-violet-900 hover:underline break-all">{publicUrl}</a>
              <button onClick={copyPublicUrl} className="ml-auto rounded-md border border-violet-300 bg-white px-2 py-1 text-xs text-violet-700 hover:bg-violet-100">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {fieldList.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 text-sm text-gray-800">
              <input type="checkbox" checked={pp[key] !== false}
                onChange={e => setVisible(key, e.target.checked)}
                className="w-4 h-4 text-violet-600 border-gray-300 rounded focus:ring-violet-500" />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Email and account details are never published. Inactive or deletion-requested accounts return 404.
        </p>
      </Card>

      <Card title="Your data" description="Download everything we know about you, or request deletion.">
        <div className="flex flex-wrap gap-3">
          <button onClick={exportData} disabled={exporting}
            className="px-4 py-2 border border-gray-300 hover:border-gray-400 text-gray-800 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing…' : 'Download my data'}
          </button>
          {data.deletion_requested_at ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-amber-700">Deletion requested {new Date(data.deletion_requested_at).toLocaleDateString()}</span>
              <button onClick={cancelDelete} disabled={deleting}
                className="px-3 py-2 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel request</button>
            </div>
          ) : (
            <button onClick={requestDelete} disabled={deleting}
              className="px-4 py-2 border border-red-200 hover:border-red-400 text-red-700 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
              <Trash2 size={14} /> Request account deletion
            </button>
          )}
        </div>
      </Card>
    </>
  );
}

function RolePreferencesSection({ data, patch }) {
  if (data.role === 'founder') return <FounderPrefs data={data} patch={patch} />;
  if (data.role === 'partner') return <PartnerPrefs data={data} patch={patch} />;
  return null;
}

function FounderPrefs({ data, patch }) {
  const rp = data.role_prefs || {};
  const [draft, setDraft] = useState(rp);
  const save = (delta) => {
    const next = { ...draft, ...delta };
    setDraft(next);
    patch({ role_prefs: next });
  };

  return (
    <>
      <Card title="Founder preferences" description="How you want to be matched with deals, capital, and partners.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Preferred raise band">
            <select value={draft.raise_band || ''} onChange={e => save({ raise_band: e.target.value })} className={inputCls}>
              <option value="">—</option>
              <option value="pre_seed">Pre-seed (under $1M)</option>
              <option value="seed">Seed ($1M – $5M)</option>
              <option value="series_a">Series A ($5M – $20M)</option>
              <option value="growth">Growth ($20M+)</option>
            </select>
          </Field>
          <Field label="Stage now">
            <select value={draft.stage || ''} onChange={e => save({ stage: e.target.value })} className={inputCls}>
              <option value="">—</option>
              <option value="idea">Idea</option>
              <option value="prototype">Prototype</option>
              <option value="mvp">MVP</option>
              <option value="revenue">Revenue</option>
              <option value="scaling">Scaling</option>
            </select>
          </Field>
          <Field label="Co-founder seats open">
            <input type="number" min={0} max={10} value={draft.cofounder_seats ?? 0}
              onChange={e => save({ cofounder_seats: Number(e.target.value) || 0 })} className={inputCls} />
          </Field>
          <Field label="Board posture">
            <select value={draft.board_posture || ''} onChange={e => save({ board_posture: e.target.value })} className={inputCls}>
              <option value="">—</option>
              <option value="independent">Founder-led, independent</option>
              <option value="balanced">Balanced founder + investor</option>
              <option value="investor_led">Investor-led</option>
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="What you're looking for from Axal" hint="Free text. Used by partners reviewing your profile.">
            <textarea value={draft.notes || ''} onChange={e => save({ notes: e.target.value })} rows={3} className={inputCls} />
          </Field>
        </div>
      </Card>
      <CofounderInvitesCard />
    </>
  );
}

function CofounderInvitesCard() {
  const [invites, setInvites] = useState(null);
  const [cap, setCap] = useState(10);
  const [err, setErr] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('co-founder');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingLink, setPendingLink] = useState(null);

  const load = async () => {
    try {
      const res = await api.listFounderInvites();
      setInvites(res?.invites || []);
      setCap(res?.cap_per_project ?? 10);
    } catch (e) {
      setErr(e.message || 'Failed to load invites');
    }
  };
  useEffect(() => { load(); }, []);

  const send = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setPendingLink(null);
    try {
      const res = await api.createFounderInvite({
        invitee_email: email.trim().toLowerCase(),
        invitee_name: name.trim() || undefined,
        role,
      });
      setEmail('');
      setName('');
      if (!res?.email_sent && res?.accept_url) setPendingLink(res.accept_url);
      await load();
    } catch (e) {
      setErr(e.message || 'Failed to send invite');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    if (!window.confirm('Revoke this invite?')) return;
    setBusyId(id);
    try {
      await api.revokeFounderInvite(id);
      await load();
    } catch (e) {
      setErr(e.message || 'Failed to revoke invite');
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = (invites || []).filter(i => !i.accepted_at && !i.revoked_at).length;

  return (
    <Card title="Co-founder invites"
      description={`Invite a co-founder, advisor, or operating partner to join your project on Axal. Up to ${cap} active invites at a time, each valid for 14 days.`}>
      {err && <div className="text-sm text-red-600 mb-3">{err}</div>}

      <div className="grid sm:grid-cols-3 gap-2 mb-3">
        <input type="email" placeholder="cofounder@example.com" value={email}
          onChange={e => setEmail(e.target.value)} className={inputCls} />
        <input type="text" placeholder="Name (optional)" value={name}
          onChange={e => setName(e.target.value)} className={inputCls} />
        <div className="flex gap-2">
          <select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
            <option value="co-founder">Co-founder</option>
            <option value="advisor">Advisor</option>
            <option value="operator">Operating partner</option>
          </select>
          <button onClick={send} disabled={busy || !email.trim() || pendingCount >= cap}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>

      {pendingCount >= cap && (
        <div className="text-xs text-amber-700 mb-3">Cap reached. Revoke a pending invite to send a new one.</div>
      )}
      {pendingLink && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 break-all">
          Email delivery is unavailable in this environment — share this link manually:
          <div className="font-mono mt-1">{pendingLink}</div>
        </div>
      )}

      {invites === null ? (
        <div className="text-sm text-gray-500">Loading invites…</div>
      ) : invites.length === 0 ? (
        <div className="text-sm text-gray-500">No invites yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
                <th className="text-left px-2 py-2 font-medium">Invitee</th>
                <th className="text-left px-2 py-2 font-medium">Role</th>
                <th className="text-left px-2 py-2 font-medium">Status</th>
                <th className="text-left px-2 py-2 font-medium">Expires</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map(i => {
                let status = 'Pending';
                let cls = 'text-amber-700 bg-amber-50 border-amber-200';
                if (i.accepted_at) { status = 'Accepted'; cls = 'text-emerald-700 bg-emerald-50 border-emerald-200'; }
                else if (i.revoked_at) { status = 'Revoked'; cls = 'text-gray-500 bg-gray-50 border-gray-200'; }
                return (
                  <tr key={i.id} className="border-b border-gray-100">
                    <td className="px-2 py-2">
                      <div className="text-gray-800">{i.invitee_name || i.invitee_email}</div>
                      {i.invitee_name && <div className="text-xs text-gray-500">{i.invitee_email}</div>}
                    </td>
                    <td className="px-2 py-2 text-gray-700">{i.role}</td>
                    <td className="px-2 py-2">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600">
                      {i.expires_at ? new Date(i.expires_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!i.accepted_at && !i.revoked_at && (
                        <button onClick={() => revoke(i.id)} disabled={busyId === i.id}
                          className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
                          {busyId === i.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PartnerPrefs({ data, patch }) {
  const rp = data.role_prefs || {};
  const [draft, setDraft] = useState(rp);
  const [whitelist, setWhitelist] = useState((rp.sector_whitelist || []).join(', '));
  const [blacklist, setBlacklist] = useState((rp.sector_blacklist || []).join(', '));
  const [autoPass, setAutoPass] = useState(JSON.stringify(rp.auto_pass_rules || {}, null, 2));

  const save = (delta) => {
    const next = { ...draft, ...delta };
    setDraft(next);
    patch({ role_prefs: next });
  };
  const commitLists = () => {
    save({
      sector_whitelist: whitelist.split(',').map(s => s.trim()).filter(Boolean),
      sector_blacklist: blacklist.split(',').map(s => s.trim()).filter(Boolean),
    });
  };
  const commitAutoPass = () => {
    try {
      const parsed = JSON.parse(autoPass || '{}');
      save({ auto_pass_rules: parsed });
    } catch {
      // leave draft alone; surface validation via the textarea border below
    }
  };

  let autoPassValid = true;
  try { JSON.parse(autoPass || '{}'); } catch { autoPassValid = false; }

  return (
    <Card title="Partner / LP investment mandate"
      description="Used to score and pre-filter deals shown to you in Pipeline, Deal Flow, and AI Matches.">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Cheque size (min, USD)">
          <input type="number" min={0} value={draft.min_check ?? ''}
            onChange={e => save({ min_check: Number(e.target.value) || 0 })} className={inputCls} placeholder="25000" />
        </Field>
        <Field label="Cheque size (max, USD)">
          <input type="number" min={0} value={draft.max_check ?? ''}
            onChange={e => save({ max_check: Number(e.target.value) || 0 })} className={inputCls} placeholder="500000" />
        </Field>
        <Field label="Stage focus">
          <select value={draft.stage_focus || ''} onChange={e => save({ stage_focus: e.target.value })} className={inputCls}>
            <option value="">—</option>
            <option value="pre_seed">Pre-seed</option>
            <option value="seed">Seed</option>
            <option value="series_a">Series A</option>
            <option value="growth">Growth</option>
            <option value="opportunistic">Opportunistic</option>
          </select>
        </Field>
        <Field label="Vintage" hint="Year you started actively investing.">
          <input type="number" min={1990} max={new Date().getFullYear()} value={draft.vintage ?? ''}
            onChange={e => save({ vintage: Number(e.target.value) || null })} className={inputCls} />
        </Field>
        <Field label="Fund size cap (USD)">
          <input type="number" min={0} value={draft.fund_size_cap ?? ''}
            onChange={e => save({ fund_size_cap: Number(e.target.value) || 0 })} className={inputCls} placeholder="50000000" />
        </Field>
        <Field label="Risk tolerance"
          hint="Bucket used by older deal scoring. The numeric slider below replaces it for new matching.">
          <select value={draft.risk_tolerance || ''} onChange={e => save({ risk_tolerance: e.target.value })} className={inputCls}>
            <option value="">—</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="frontier">Frontier</option>
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <Field label={`Risk score: ${draft.risk_score ?? 50} / 100`}
          hint="0 = capital preservation, 100 = swing-for-the-fences. Used by AI matching to weight deals against your mandate.">
          <input type="range" min={0} max={100} step={1}
            value={draft.risk_score ?? 50}
            onChange={e => setDraft({ ...draft, risk_score: Number(e.target.value) })}
            onMouseUp={e => save({ risk_score: Number(e.target.value) })}
            onTouchEnd={e => save({ risk_score: Number(e.target.value) })}
            onKeyUp={e => save({ risk_score: Number(e.target.value) })}
            className="w-full accent-violet-600" />
          <div className="flex justify-between text-[11px] text-gray-500 mt-1">
            <span>Capital preservation</span>
            <span>Balanced</span>
            <span>Frontier / venture</span>
          </div>
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <Field label="Sector whitelist" hint="Comma-separated. Empty = no filter.">
          <input value={whitelist} onChange={e => setWhitelist(e.target.value)} onBlur={commitLists}
            placeholder="AI/ML, Fintech, Climate" className={inputCls} />
        </Field>
        <Field label="Sector blacklist" hint="Comma-separated.">
          <input value={blacklist} onChange={e => setBlacklist(e.target.value)} onBlur={commitLists}
            placeholder="Crypto, Cannabis" className={inputCls} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Auto-pass rules (JSON)"
          hint='Example: {"min_team_size": 2, "exclude_geos": ["RU"]}. Saved on blur if valid JSON.'>
          <textarea value={autoPass} onChange={e => setAutoPass(e.target.value)} onBlur={commitAutoPass} rows={6}
            className={`${inputCls} font-mono ${!autoPassValid ? 'border-red-400 focus:ring-red-500' : ''}`} />
        </Field>
        {!autoPassValid && (
          <div className="text-xs text-red-600 mt-1">Invalid JSON — fix to save.</div>
        )}
      </div>
    </Card>
  );
}
