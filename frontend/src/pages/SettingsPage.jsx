import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';
import {
  User, Globe, Mail, ShieldCheck, Bell, Lock, Briefcase, Users,
  Camera, Save, AlertTriangle, CheckCircle2, Trash2, LogOut, Download,
  Plus, X, KeyRound, Palette, Plug, CreditCard, Code, UserCog,
  Sun, Moon, Monitor, ChevronDown, Check,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';

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

// Task #1 — Settings expansion (tabbed). Nine tabs per the audit-plan brief.
// `roles` controls visibility per signed-in role; absence = visible to all.
const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'account', label: 'Account', icon: UserCog },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'billing', label: 'Billing', icon: CreditCard, roles: ['founder'] },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'developer', label: 'Developer', icon: Code, roles: ['admin'] },
];

// ---------- Page ------------------------------------------------------------

// Map a deep-link URL path → preselected section id. The page is mounted
// at both `/settings` (top-level) and `/settings/:section` so the bell can
// land users directly on the notification matrix.
const PATH_TO_SECTION = {
  notifications: 'notifications',
  profile: 'profile',
  account: 'account',
  security: 'security',
  privacy: 'privacy',
  integrations: 'integrations',
  billing: 'billing',
  appearance: 'appearance',
  developer: 'developer',
  // Back-compat: old deep links still resolve to a sensible new tab.
  jurisdictions: 'profile',
  email: 'account',
  auth: 'security',
  role: 'profile',
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

  // After settings load, if `active` was deep-linked to a tab the user's
  // role isn't allowed to see, bounce them back to Profile (which also
  // rewrites the URL via the URL-sync effect above).
  useEffect(() => {
    if (!data) return;
    const r = (data.role || '').toLowerCase();
    const allowed = new Set(SECTIONS.filter(s => !s.roles || s.roles.includes(r)).map(s => s.id));
    if (!allowed.has(active)) setActive('profile');
  }, [data, active]);

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

  if (loading) return <div className="text-gray-600 dark:text-gray-400 text-center py-20">Loading…</div>;
  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 max-w-xl">
      Could not load your settings: {error}
    </div>
  );
  if (!data) return null;

  const role = (data.role || '').toLowerCase();
  const sections = SECTIONS.filter(s => !s.roles || s.roles.includes(role));
  // Render-time gate: a non-admin who deep-links to /settings/developer must
  // not get the Developer UI rendered just because the URL parsed `active`
  // before role was known. Mirror the nav filter on the content side.
  const allowedIds = new Set(sections.map(s => s.id));
  const safeActive = allowedIds.has(active) ? active : 'profile';

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Settings</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">Profile, security, notifications, and role preferences for your Axal account.</p>

      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${
          toast.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {toast.kind === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {toast.message}
        </div>
      )}

      <div className="grid lg:grid-cols-[200px_1fr] gap-6">
        <div className="lg:hidden mb-2">
          <SectionDropdown sections={sections} active={safeActive} onChange={setActive} />
        </div>
        <nav className="hidden lg:block space-y-1 text-sm sticky top-4 self-start">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                safeActive === s.id ? 'bg-violet-50 text-violet-700 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50'
              }`}
            >
              <s.icon size={14} />
              {s.label}
            </button>
          ))}
        </nav>

        <div className="space-y-6">
          {safeActive === 'profile' && (
            <>
              <ProfileSection data={data} onSaved={(d) => setData(prev => ({ ...prev, ...d }))} flash={flash} patch={patch} />
              <ProfileExtrasCard flash={flash} />
              <JurisdictionsSection data={data} patch={patch} />
              <RolePreferencesSection data={data} patch={patch} />
            </>
          )}
          {safeActive === 'account' && (
            <>
              <EmailSection data={data} flash={flash} reload={() => api.getSettings().then(setData)} />
              <AccountDeletionCard data={data} flash={flash} reload={() => api.getSettings().then(setData)} />
            </>
          )}
          {safeActive === 'security' && <AuthSection data={data} flash={flash} />}
          {safeActive === 'notifications' && (
            <>
              <NotificationsSection data={data} patch={patch} />
              <DigestQuietHoursCard flash={flash} />
            </>
          )}
          {safeActive === 'privacy' && (
            <>
              <PrivacyCoreCard flash={flash} />
              <PrivacySection data={data} patch={patch} flash={flash} reload={() => api.getSettings().then(setData)} hideAccountDelete />
            </>
          )}
          {safeActive === 'integrations' && allowedIds.has('integrations') && <IntegrationsTab flash={flash} />}
          {safeActive === 'billing' && allowedIds.has('billing') && <BillingTab data={data} />}
          {safeActive === 'appearance' && <AppearanceTab flash={flash} />}
          {safeActive === 'developer' && allowedIds.has('developer') && <DeveloperTab flash={flash} />}
        </div>
      </div>
    </div>
  );
}

// ---------- Mobile section dropdown ----------------------------------------

function SectionDropdown({ sections, active, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const current = sections.find(s => s.id === active) || sections[0];
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const Icon = current.icon;
  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm shadow-sm hover:border-gray-300 transition-colors"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center flex-shrink-0">
            <Icon size={14} />
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{current.label}</span>
        </span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-40 py-1 max-h-[70vh] overflow-y-auto"
        >
          {sections.map(s => {
            const SIcon = s.icon;
            const isActive = s.id === active;
            return (
              <li key={s.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => { onChange(s.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                    isActive ? 'bg-violet-50 text-violet-700' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isActive ? 'bg-violet-100 text-violet-700' : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                  }`}>
                    <SIcon size={14} />
                  </span>
                  <span className="flex-1 font-medium">{s.label}</span>
                  {isActive && <Check size={14} className="text-violet-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- Sections --------------------------------------------------------

function Card({ title, description, children, footer }) {
  return (
    <div data-card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
      <div data-card-header className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
      </div>
      <div data-card-body className="p-5">{children}</div>
      {footer && <div data-card-footer className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">{footer}</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500';

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
            <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden">
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
                isSel ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-violet-400'
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
          <input value={data.email} disabled className={`${inputCls} bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400`} />
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
            <div className="text-sm text-gray-700 dark:text-gray-300">
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
            <div className="text-sm text-gray-700 dark:text-gray-300">Scan with your authenticator. After scanning, sign out and back in to confirm.</div>
            {qrPayload.qr_code ? (
              <img src={`data:image/png;base64,${qrPayload.qr_code}`} alt="TOTP QR"
                className="w-48 h-48 border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-white dark:bg-gray-900" />
            ) : (
              <div className="text-xs text-gray-600 dark:text-gray-400 break-all p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">{qrPayload.provisioning_uri}</div>
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
                <div key={i} className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 select-all">{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadCodes}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
                Download as .txt
              </button>
              <button onClick={() => setGeneratedCodes(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-700 dark:text-gray-300 rounded-lg text-sm">
                I've saved them
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              {remaining > 0
                ? <>You have <span className="font-semibold">{remaining}</span> unused recovery code{remaining === 1 ? '' : 's'}.</>
                : <span className="text-amber-700">You don't have any recovery codes yet — generate a set and store them somewhere safe.</span>}
            </div>
            {data.totp_configured ? (
              <Field label="Enter your current 6-digit TOTP code to generate 10 new recovery codes">
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
              <div className="text-sm text-gray-500 dark:text-gray-400">Configure TOTP first.</div>
            )}
          </div>
        )}
      </Card>

      <Card title="Active sessions" description="See every device with an active session and revoke individual ones — or sign everything out at once.">
        {sessionsErr && <div className="text-sm text-red-600 mb-3">{sessionsErr}</div>}
        {sessions === null ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">No tracked sessions yet. New sign-ins will appear here.</div>
        ) : (
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
                    <tr key={s.id} className={`border-b border-gray-100 dark:border-gray-800 ${isRevoked ? 'text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
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
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left px-2 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium">Event</th>
            {NOTIFICATION_CHANNELS.map(c => (
              <th key={c.key}
                className="text-center px-2 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider"
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
            <tr key={ev.key} className="border-b border-gray-100 dark:border-gray-800">
              <td className="px-2 py-2 text-gray-800 dark:text-gray-200">{ev.label}</td>
              {NOTIFICATION_CHANNELS.map(c => {
                const checked = !!prefs[ev.key]?.[c.key];
                return (
                  <td key={c.key} className="text-center px-2 py-2">
                    <input type="checkbox" checked={checked} disabled={!!c.disabled}
                      onChange={e => setEvent(ev.key, c.key, e.target.checked)}
                      title={c.disabled ? c.hint : undefined}
                      className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500 disabled:opacity-40 disabled:cursor-not-allowed" />
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

function PrivacySection({ data, patch, flash, reload, hideAccountDelete }) {
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
              <button onClick={copyPublicUrl} className="ml-auto rounded-md border border-violet-300 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-violet-700 hover:bg-violet-100">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {fieldList.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" checked={pp[key] !== false}
                onChange={e => setVisible(key, e.target.checked)}
                className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Email and account details are never published. Inactive or deletion-requested accounts return 404.
        </p>
      </Card>

      {!hideAccountDelete && (
        <Card title="Your data" description="Download everything we know about you, or request deletion.">
          <div className="flex flex-wrap gap-3">
            <button onClick={exportData} disabled={exporting}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-800 dark:text-gray-200 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
              <Download size={14} /> {exporting ? 'Preparing…' : 'Download my data'}
            </button>
            {data.deletion_requested_at ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-amber-700">Deletion requested {new Date(data.deletion_requested_at).toLocaleDateString()}</span>
                <button onClick={cancelDelete} disabled={deleting}
                  className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel request</button>
              </div>
            ) : (
              <button onClick={requestDelete} disabled={deleting}
                className="px-4 py-2 border border-red-200 hover:border-red-400 text-red-700 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
                <Trash2 size={14} /> Request account deletion
              </button>
            )}
          </div>
        </Card>
      )}
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
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading invites…</div>
      ) : invites.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No invites yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
                else if (i.revoked_at) { status = 'Revoked'; cls = 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'; }
                return (
                  <tr key={i.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-2 py-2">
                      <div className="text-gray-800 dark:text-gray-200">{i.invitee_name || i.invitee_email}</div>
                      {i.invitee_name && <div className="text-xs text-gray-500 dark:text-gray-400">{i.invitee_email}</div>}
                    </td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{i.role}</td>
                    <td className="px-2 py-2">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600 dark:text-gray-400">
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
          <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400 mt-1">
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

// ---------------------------------------------------------------------------
// Task #1 — Settings expansion (tabbed). New tab components below back the
// /api/settings/{profile,privacy,notifications,appearance,integrations,developer}
// sub-routes against the user_settings table (002_user_settings.sql).
// Each tab fetches its own slice on mount and saves on blur/change.
// ---------------------------------------------------------------------------

const COMMON_TIMEZONES = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Toronto', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Zurich', 'Europe/Madrid',
  'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney',
];

function ProfileExtrasCard({ flash }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getProfileSettings()
      .then(r => { if (!cancelled) setRow(r); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load profile settings'); });
    return () => { cancelled = true; };
  }, []);

  const save = async (delta) => {
    if (!row) return;
    const next = { ...row, ...delta };
    setRow(next);
    setBusy(true);
    try {
      const res = await api.updateProfileSettings(delta);
      setRow({ ...next, ...res });
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
      // Reload from server to undo optimistic update on failure.
      try { setRow(await api.getProfileSettings()); } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  };

  if (err) return <Card title="Profile details"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Profile details"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const tz = row.timezone || 'UTC';
  const tzOptions = COMMON_TIMEZONES.includes(tz) ? COMMON_TIMEZONES : [tz, ...COMMON_TIMEZONES];

  return (
    <Card title="Profile details" description="Locale, timezone, pronouns, and your public profile URL.">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Timezone" hint="Used for digests and quiet hours.">
          <select value={tz} onChange={e => save({ timezone: e.target.value })} disabled={busy} className={inputCls}>
            {tzOptions.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Locale">
          <select value={row.locale || 'en'} onChange={e => save({ locale: e.target.value })} disabled={busy} className={inputCls}>
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
        </Field>
        <Field label="Pronouns" hint="Optional. Up to 32 characters.">
          <input value={row.pronouns || ''} maxLength={32}
            onChange={e => setRow({ ...row, pronouns: e.target.value })}
            onBlur={() => save({ pronouns: row.pronouns || null })}
            placeholder="they/them" className={inputCls} />
        </Field>
        <Field label="Public profile slug"
          hint="2–40 lowercase letters, numbers, or hyphens. Becomes /u/<slug>.">
          <input value={row.profile_slug || ''} maxLength={40}
            onChange={e => setRow({ ...row, profile_slug: e.target.value.toLowerCase() })}
            onBlur={() => save({ profile_slug: row.profile_slug || null })}
            placeholder="jane-doe" className={inputCls} />
        </Field>
      </div>
    </Card>
  );
}

function AccountDeletionCard({ data, flash, reload }) {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const blob = await api.exportMyData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `axal-data-export-${data.uid || data.id}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      flash('Export downloaded');
    } catch (e) {
      flash(e.message || 'Export failed', 'error');
    } finally { setExporting(false); }
  };

  const requestDelete = async () => {
    if (!window.confirm('Submit an account deletion request? Hard delete after a 30-day grace period; our team will reach out within 7 days to confirm.')) return;
    setDeleting(true);
    try {
      const res = await api.requestAccountDeletion();
      flash(res.message || 'Deletion request submitted');
      reload();
    } catch (e) { flash(e.message || 'Failed to submit request', 'error'); }
    finally { setDeleting(false); }
  };

  const cancelDelete = async () => {
    setDeleting(true);
    try {
      await api.cancelAccountDeletion();
      flash('Deletion request cancelled');
      reload();
    } catch (e) { flash(e.message || 'Failed to cancel', 'error'); }
    finally { setDeleting(false); }
  };

  return (
    <Card title="Account & data" description="Export your data, or request account deletion (30-day grace period before hard delete).">
      <div className="flex flex-wrap gap-3">
        <button onClick={exportData} disabled={exporting}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-800 dark:text-gray-200 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
          <Download size={14} /> {exporting ? 'Preparing…' : 'Download my data (JSON)'}
        </button>
        {data.deletion_requested_at ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-700">Deletion requested {new Date(data.deletion_requested_at).toLocaleDateString()}</span>
            <button onClick={cancelDelete} disabled={deleting}
              className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel request</button>
          </div>
        ) : (
          <button onClick={requestDelete} disabled={deleting}
            className="px-4 py-2 border border-red-200 hover:border-red-400 text-red-700 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
            <Trash2 size={14} /> Request account deletion
          </button>
        )}
      </div>
    </Card>
  );
}

const NOTIF_CATEGORY_KEYS = [
  { key: 'mentions', label: 'Mentions & comments' },
  { key: 'deals', label: 'Deal flow & pipeline' },
  { key: 'calendar', label: 'Calendar & meetings' },
  { key: 'scoring', label: 'Scoring & matches' },
  { key: 'billing', label: 'Billing & invoices' },
];

function DigestQuietHoursCard({ flash }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getNotificationSettings()
      .then(r => { if (!cancelled) setRow(r); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load notification settings'); });
    return () => { cancelled = true; };
  }, []);

  const save = async (delta) => {
    if (!row) return;
    const next = { ...row, ...delta };
    setRow(next);
    setBusy(true);
    try {
      const res = await api.updateNotificationSettings(delta);
      setRow({ ...next, ...res });
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
      try { setRow(await api.getNotificationSettings()); } catch { /* ignore */ }
    } finally { setBusy(false); }
  };

  if (err) return <Card title="Digest & quiet hours"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Digest & quiet hours"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const email = row.notif_categories_email || {};
  const inapp = row.notif_categories_inapp || {};
  const setCategory = (channel, key, value) => {
    if (channel === 'email') save({ notif_categories_email: { ...email, [key]: value } });
    else save({ notif_categories_inapp: { ...inapp, [key]: value } });
  };

  return (
    <>
      <Card title="Digest & categories"
        description="Roll-up email cadence, plus per-category overrides. Quiet hours below silence push notifications during your stated window.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Digest frequency">
            <select value={row.digest_frequency || 'weekly'}
              onChange={e => save({ digest_frequency: e.target.value })} disabled={busy} className={inputCls}>
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="text-left px-2 py-2 font-medium">Category</th>
                <th className="text-center px-2 py-2 font-medium">Email</th>
                <th className="text-center px-2 py-2 font-medium">In-app</th>
              </tr>
            </thead>
            <tbody>
              {NOTIF_CATEGORY_KEYS.map(c => (
                <tr key={c.key} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-2 text-gray-800 dark:text-gray-200">{c.label}</td>
                  <td className="text-center px-2 py-2">
                    <input type="checkbox" checked={!!email[c.key]} disabled={busy}
                      onChange={e => setCategory('email', c.key, e.target.checked)}
                      className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
                  </td>
                  <td className="text-center px-2 py-2">
                    <input type="checkbox" checked={!!inapp[c.key]} disabled={busy}
                      onChange={e => setCategory('inapp', c.key, e.target.checked)}
                      className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Quiet hours"
        description="Push and real-time alerts are skipped during this window (digest emails still send). Use HH:MM 24-hour format. Leave both blank to disable.">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Start (HH:MM)">
            <input type="time" value={row.quiet_hours_start || ''}
              onChange={e => setRow({ ...row, quiet_hours_start: e.target.value })}
              onBlur={() => save({ quiet_hours_start: row.quiet_hours_start || null })}
              className={inputCls} />
          </Field>
          <Field label="End (HH:MM)">
            <input type="time" value={row.quiet_hours_end || ''}
              onChange={e => setRow({ ...row, quiet_hours_end: e.target.value })}
              onBlur={() => save({ quiet_hours_end: row.quiet_hours_end || null })}
              className={inputCls} />
          </Field>
          <Field label="Timezone">
            <input value={row.quiet_hours_tz || ''}
              onChange={e => setRow({ ...row, quiet_hours_tz: e.target.value })}
              onBlur={() => save({ quiet_hours_tz: row.quiet_hours_tz || null })}
              placeholder="UTC" className={inputCls} />
          </Field>
        </div>
      </Card>
    </>
  );
}

function PrivacyCoreCard({ flash }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getPrivacySettings()
      .then(r => { if (!cancelled) setRow(r); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load privacy settings'); });
    return () => { cancelled = true; };
  }, []);

  const save = async (delta) => {
    if (!row) return;
    const next = { ...row, ...delta };
    setRow(next);
    setBusy(true);
    try {
      const res = await api.updatePrivacySettings(delta);
      setRow({ ...next, ...res });
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
      try { setRow(await api.getPrivacySettings()); } catch { /* ignore */ }
    } finally { setBusy(false); }
  };

  if (err) return <Card title="Visibility"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Visibility"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  return (
    <Card title="Visibility & discovery"
      description="Who can find you across the platform. Public Directory listings honour these toggles in real time.">
      <div className="space-y-3">
        <Field label="Profile visibility">
          <select value={row.visibility || 'network'} onChange={e => save({ visibility: e.target.value })} disabled={busy} className={inputCls}>
            <option value="public">Public — anyone with the link</option>
            <option value="network">Network only — Axal members</option>
            <option value="private">Private — admins only</option>
          </select>
        </Field>
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={!!row.show_in_directory} disabled={busy}
            onChange={e => save({ show_in_directory: e.target.checked })}
            className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
          Show me in the Public Directory
        </label>
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={!!row.discoverable} disabled={busy}
            onChange={e => save({ discoverable: e.target.checked })}
            className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
          Allow mentors and founders to discover me for matching
        </label>
      </div>
    </Card>
  );
}

const PROVIDER_LABELS = {
  linkedin: 'LinkedIn',
  google: 'Google (Calendar & Mail)',
  outlook: 'Microsoft 365 / Outlook',
  slack: 'Slack',
};

function IntegrationsTab({ flash }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  const [busyProvider, setBusyProvider] = useState(null);

  const load = async () => {
    try {
      const r = await api.getIntegrationSettings();
      setRow(r);
    } catch (e) {
      setErr(e.message || 'Failed to load integrations');
    }
  };
  useEffect(() => { load(); }, []);

  const disconnect = async (provider, url) => {
    if (!url) return;
    if (!window.confirm(`Disconnect ${PROVIDER_LABELS[provider] || provider}?`)) return;
    setBusyProvider(provider);
    try {
      // Disconnect endpoints live outside /settings; call them via fetch with cookie auth.
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
      flash(`${PROVIDER_LABELS[provider] || provider} disconnected`);
      await load();
    } catch (e) {
      flash(e.message || 'Disconnect failed', 'error');
    } finally {
      setBusyProvider(null);
    }
  };

  if (err) return <Card title="Integrations"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Integrations"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  return (
    <>
      <Card title="Connected accounts"
        description="OAuth links to third-party services. Disconnecting revokes the stored refresh token; the provider may still show Axal as authorized until you remove it from their account settings.">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {(row.accounts || []).map(acct => (
            <div key={acct.provider} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{PROVIDER_LABELS[acct.provider] || acct.provider}</div>
                <div className={`text-xs ${acct.connected ? 'text-emerald-700' : 'text-gray-500 dark:text-gray-400'}`}>
                  {acct.connected ? 'Connected' : 'Not connected'}
                </div>
              </div>
              {acct.connected && acct.disconnect_url ? (
                <button onClick={() => disconnect(acct.provider, acct.disconnect_url)}
                  disabled={busyProvider === acct.provider}
                  className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
                  {busyProvider === acct.provider ? 'Disconnecting…' : 'Disconnect'}
                </button>
              ) : !acct.connected ? (
                <span className="text-xs text-gray-400">
                  {acct.provider === 'slack' ? 'Coming soon' : 'Connect from the relevant page'}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
      {row.api_keys_enabled && (
        <Card title="API keys"
          description="Personal access tokens for programmatic access. Each key is shown exactly once.">
          <div className="text-sm text-gray-500 dark:text-gray-400">No keys yet.</div>
        </Card>
      )}
    </>
  );
}

function BillingTab({ data }) {
  const tier = data?.tier || data?.subscription_tier || 'free';
  return (
    <Card title="Billing"
      description="Subscription tier, payment method, and invoices. Full self-serve management is shipping with the Tiers track.">
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Current tier</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 capitalize">{tier}</div>
          </div>
          <a href="/founder?tab=billing"
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
            Manage plan
          </a>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Need an invoice or to update your payment method? Contact <a className="text-violet-700 hover:underline" href="mailto:billing@axal.vc">billing@axal.vc</a>.
        </div>
      </div>
    </Card>
  );
}

function AppearanceTab({ flash }) {
  const { appearance, effectiveTheme, setAppearance, loading } = useSettings();
  const [busy, setBusy] = useState(false);

  const set = async (delta) => {
    setBusy(true);
    try {
      await setAppearance(delta);
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally { setBusy(false); }
  };

  if (loading) return <Card title="Appearance"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <>
      <Card title="Theme"
        description={`Light, dark, or follow your operating system. Currently rendering as ${effectiveTheme}.`}>
        <div className="grid grid-cols-3 gap-2">
          {themes.map(t => {
            const active = appearance.theme === t.value;
            const Icon = t.icon;
            return (
              <button key={t.value} disabled={busy} onClick={() => set({ theme: t.value })}
                className={`flex flex-col items-center gap-2 px-4 py-4 rounded-lg border text-sm transition-colors ${
                  active ? 'border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900'
                }`}>
                <Icon size={20} />
                {t.label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Density" description="Tighter spacing reclaims vertical real-estate on dashboards.">
        <div className="grid grid-cols-2 gap-2">
          {['comfy', 'compact'].map(d => {
            const active = appearance.density === d;
            return (
              <button key={d} disabled={busy} onClick={() => set({ density: d })}
                className={`px-4 py-3 rounded-lg border text-sm capitalize transition-colors ${
                  active ? 'border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900'
                }`}>{d}</button>
            );
          })}
        </div>
      </Card>

      <Card title="Sidebar default" description="Whether the sidebar starts expanded or collapsed on each visit.">
        <div className="grid grid-cols-2 gap-2">
          {['expanded', 'collapsed'].map(s => {
            const active = appearance.sidebar_default === s;
            return (
              <button key={s} disabled={busy} onClick={() => set({ sidebar_default: s })}
                className={`px-4 py-3 rounded-lg border text-sm capitalize transition-colors ${
                  active ? 'border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900'
                }`}>{s}</button>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function DeveloperTab({ flash }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newFlag, setNewFlag] = useState('');
  const [resyncing, setResyncing] = useState(false);

  const load = async () => {
    try { setRow(await api.getDeveloperSettings()); }
    catch (e) { setErr(e.message || 'Failed to load developer settings'); }
  };
  useEffect(() => { load(); }, []);

  const setFlags = async (flags) => {
    setBusy(true);
    try {
      const res = await api.updateDeveloperSettings({ feature_flags: flags });
      setRow({ ...row, feature_flags: res.feature_flags || flags });
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally { setBusy(false); }
  };

  const toggleFlag = (key, value) => {
    const next = { ...(row.feature_flags || {}), [key]: value };
    setFlags(next);
  };
  const addFlag = () => {
    const k = newFlag.trim();
    if (!k) return;
    if (!/^[a-z0-9_]{1,64}$/i.test(k)) {
      flash('Flag names must be 1–64 alphanumeric or underscore characters', 'error');
      return;
    }
    setNewFlag('');
    setFlags({ ...(row.feature_flags || {}), [k]: true });
  };
  const removeFlag = (key) => {
    const next = { ...(row.feature_flags || {}) };
    delete next[key];
    setFlags(next);
  };

  const resync = async () => {
    setResyncing(true);
    try {
      const res = await api.resyncDeveloperIndices();
      flash(res.message || 'Re-sync queued');
    } catch (e) {
      flash(e.message || 'Re-sync failed', 'error');
    } finally { setResyncing(false); }
  };

  if (err) return <Card title="Developer"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Developer"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const flags = row.feature_flags || {};
  const flagKeys = Object.keys(flags).sort();

  return (
    <>
      <Card title="Feature flags" description="Per-account toggles. Use sparingly — most product flags belong in the worker bindings.">
        {flagKeys.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">No flags set.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 mb-3">
            {flagKeys.map(k => (
              <div key={k} className="flex items-center justify-between py-2">
                <div className="font-mono text-sm text-gray-800 dark:text-gray-200">{k}</div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <input type="checkbox" checked={!!flags[k]} disabled={busy}
                      onChange={e => toggleFlag(k, e.target.checked)}
                      className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
                    {flags[k] ? 'On' : 'Off'}
                  </label>
                  <button onClick={() => removeFlag(k)} disabled={busy}
                    className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={newFlag} onChange={e => setNewFlag(e.target.value)}
            placeholder="new_flag_key" className={inputCls} maxLength={64} />
          <button onClick={addFlag} disabled={busy || !newFlag.trim()}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-1">
            <Plus size={14} /> Add
          </button>
        </div>
      </Card>

      <Card title="Search indices" description="Force re-sync of derived caches and search indices for your account.">
        <button onClick={resync} disabled={resyncing}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-800 dark:text-gray-200 rounded-lg text-sm disabled:opacity-50">
          {resyncing ? 'Queueing…' : 'Re-sync indices'}
        </button>
      </Card>

      <Card title="Raw user object" description="Read-only view of the user row backing this session.">
        <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(row.raw_user, null, 2)}
        </pre>
      </Card>
    </>
  );
}
