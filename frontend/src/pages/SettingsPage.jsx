import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { EXPLAINERS } from '../lib/explainers';
import { useToast } from '../components/useToast';
import {
  User, Globe, Mail, ShieldCheck, Bell, Lock, Briefcase, Users,
  Camera, Save, AlertTriangle, CheckCircle2, Trash2, LogOut, Download,
  Plus, X, KeyRound, Palette, Plug, CreditCard, Code, UserCog,
  Sun, Moon, ChevronDown, Check,
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
  { key: 'contract_signed', label: 'Contract fully signed' },
  { key: 'mentor_session_booked', label: 'Mentor session booked' },
  { key: 'dd_report_ready', label: 'Due-diligence report ready' },
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

      <ProfileCompletionBanner onJump={() => setActive('profile')} />

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
            <ProfileTabs data={data} onSaved={(d) => setData(prev => ({ ...prev, ...d }))} flash={flash} patch={patch} />
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
              <InvestorSignalsContributionCard flash={flash} role={data?.role} />
              <PrivacySection data={data} patch={patch} flash={flash} reload={() => api.getSettings().then(setData)} hideAccountDelete />
            </>
          )}
          {safeActive === 'integrations' && allowedIds.has('integrations') && <IntegrationsTab flash={flash} />}
          {safeActive === 'billing' && allowedIds.has('billing') && <BillingTab data={data} flash={flash} />}
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

// ---------- Task #16 — Profile sub-tabs (Personal / Corporate / Verification)

const ENTITY_TYPE_OPTIONS = [
  ['', '— select —'],
  ['llc', 'LLC'],
  ['c_corp', 'C-Corp'],
  ['s_corp', 'S-Corp'],
  ['b_corp', 'B-Corp'],
  ['ltd', 'Ltd'],
  ['plc', 'PLC'],
  ['gmbh', 'GmbH'],
  ['ug', 'UG'],
  ['ag', 'AG'],
  ['sa', 'SA'],
  ['sas', 'SAS'],
  ['sarl', 'SARL'],
  ['bv', 'BV'],
  ['nv', 'NV'],
  ['spa', 'SpA'],
  ['srl', 'Srl'],
  ['ab', 'AB'],
  ['as', 'AS'],
  ['oy', 'Oy'],
  ['pte_ltd', 'Pte Ltd'],
  ['pty_ltd', 'Pty Ltd'],
  ['kk', 'KK'],
  ['gk', 'GK'],
  ['sole_proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership'],
  ['other', 'Other'],
];

function CompletionRing({ pct, hint }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = 22, c = 2 * Math.PI * r;
  const off = c * (1 - v / 100);
  return (
    <div className="flex items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 56 56" className="flex-shrink-0">
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-gray-200 dark:text-gray-700" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="5"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          transform="rotate(-90 28 28)"
          className={v >= 80 ? 'text-emerald-500' : v >= 50 ? 'text-violet-500' : 'text-amber-500'} />
        <text x="28" y="32" textAnchor="middle" fontSize="12" fontWeight="600" className="fill-gray-900 dark:fill-gray-100">{v}%</text>
      </svg>
      <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug">{hint}</div>
    </div>
  );
}

// AE-2 — Top-of-Settings completion banner. Pulls `profile_completion_pct`
// from /profile/identity (which always carries the freshly-recomputed
// percentage from the AE-1 helpers) and lists the unfilled required
// fields so the user knows exactly what to fill next. Silent on error
// (anonymous / network) — the banner is decorative, not blocking.
const REQUIRED_PROFILE_FIELDS = [
  ['full_legal_name', 'Full legal name'],
  ['date_of_birth', 'Date of birth'],
  ['nationality', 'Nationality'],
  ['tax_residency_country', 'Tax residency'],
  ['has_tax_id', 'Tax ID'],
  ['address_line1', 'Address'],
  ['city', 'City'],
  ['postal_code', 'Postal code'],
  ['country', 'Country'],
];
function ProfileCompletionBanner({ onJump }) {
  const [row, setRow] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.getIdentitySettings()
      .then(r => { if (!cancelled) setRow(r); })
      .catch(() => { /* silent — banner is optional */ });
    const onSaved = () => {
      api.getIdentitySettings()
        .then(r => { if (!cancelled) setRow(r); })
        .catch(() => {});
    };
    window.addEventListener('axal:profile_saved', onSaved);
    return () => { cancelled = true; window.removeEventListener('axal:profile_saved', onSaved); };
  }, []);
  if (!row) return null;
  const pct = Number(row.profile_completion_pct || 0);
  const missing = REQUIRED_PROFILE_FIELDS.filter(([k]) => {
    const v = row[k];
    return !v || (k === 'has_tax_id' && !row.has_tax_id);
  }).map(([, label]) => label);
  if (pct >= 100) return null;
  return (
    <div data-card className="mb-6 bg-violet-50/60 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl px-5 py-4 flex items-start gap-4">
      <CompletionRing pct={pct} hint={
        missing.length === 0
          ? <span>Profile complete — nice.</span>
          : <span>
              Still missing: <span className="font-medium text-gray-800 dark:text-gray-200">{missing.slice(0, 4).join(', ')}{missing.length > 4 ? `, +${missing.length - 4} more` : ''}</span>.
              <button onClick={onJump} className="ml-2 underline text-violet-700 dark:text-violet-300 hover:no-underline">Jump to Profile</button>
            </span>
      } />
    </div>
  );
}

function ProfileTabs({ data, onSaved, flash, patch }) {
  const [sub, setSub] = useState('personal');
  const [pct, setPct] = useState(0);
  const tabs = [
    { id: 'personal', label: 'Personal' },
    { id: 'corporate', label: 'Corporate' },
    { id: 'verification', label: 'Verification' },
  ];
  return (
    <>
      <div className="flex flex-wrap gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              sub === t.id ? 'bg-white dark:bg-gray-900 text-violet-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
            }`}>{t.label}</button>
        ))}
      </div>
      {sub === 'personal' && (
        <>
          <PersonalIdentityCard flash={flash} onPctChange={setPct} pct={pct} />
          <ProfileSection data={data} onSaved={onSaved} flash={flash} patch={patch} />
          <ProfileExtrasCard flash={flash} />
          <JurisdictionsSection data={data} patch={patch} />
          <RolePreferencesSection data={data} patch={patch} />
        </>
      )}
      {sub === 'corporate' && <CorporateIdentityCard flash={flash} onPctChange={setPct} />}
      {sub === 'verification' && <VerificationStubCard data={data} />}
    </>
  );
}

function PersonalIdentityCard({ flash, onPctChange }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [taxIdInput, setTaxIdInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    api.getPersonalProfile()
      .then(r => { if (!cancelled) { setRow(r); onPctChange?.(r.profile_completion_pct || 0); } })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load identity'); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch) => {
    setBusy(true);
    setFieldErrors({});
    try {
      const updated = await api.updatePersonalProfile(patch);
      setRow(updated);
      onPctChange?.(updated.profile_completion_pct || 0);
      try { window.dispatchEvent(new CustomEvent('axal:profile_saved')); } catch {}
      flash('Saved');
      if ('tax_id_number' in patch) setTaxIdInput('');
      if ('phone_e164' in patch) setPhoneInput('');
    } catch (e) {
      // AE-2: prefer the field-errors map; only flash a toast when the
      // error is genuinely whole-form (no field metadata).
      const errsMap = e?.data?.errors;
      if (errsMap && typeof errsMap === 'object') setFieldErrors(errsMap);
      else if (e?.field) setFieldErrors({ [e.field]: e.message });
      if (!e?.field && !errsMap) flash(e.message || 'Failed to save', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <Card title="Identity"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Identity"><div className="text-sm text-gray-500">Loading…</div></Card>;

  const r = row;
  const set = (k, v) => setRow({ ...r, [k]: v });
  const onBlurSave = (k) => {
    const v = r[k] ?? null;
    if (v === '' || v === null) save({ [k]: null });
    else save({ [k]: v });
  };
  const fe = (k) => fieldErrors[k] ? <span className="text-[11px] text-red-600 block mt-1">{fieldErrors[k]}</span> : null;

  return (
    <Card title="Identity"
      description="Used to auto-fill contracts between you and Axal. Sensitive fields are encrypted at rest.">
      <div className="mb-4">
        <CompletionRing pct={r.profile_completion_pct}
          hint="Fill in legal name, DOB, address, country and tax ID to unlock contract auto-fill." />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Full legal name">
          <input value={r.full_legal_name || ''} onChange={e => set('full_legal_name', e.target.value)}
            onBlur={() => onBlurSave('full_legal_name')} disabled={busy} className={inputCls} />
        </Field>
        <Field label="Date of birth" hint="Must be 18 or older.">
          <input type="date" value={r.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)}
            onBlur={() => onBlurSave('date_of_birth')} disabled={busy} className={inputCls} />
          {fe('date_of_birth')}
        </Field>
        <Field label="Nationality (ISO α-2)">
          <input value={r.nationality || ''} maxLength={2}
            onChange={e => set('nationality', e.target.value.toUpperCase())}
            onBlur={() => onBlurSave('nationality')} disabled={busy} className={inputCls} placeholder="US" />
          {fe('nationality')}
        </Field>
        <Field label="Tax residency (ISO α-2)">
          <input value={r.tax_residency_country || ''} maxLength={2}
            onChange={e => set('tax_residency_country', e.target.value.toUpperCase())}
            onBlur={() => onBlurSave('tax_residency_country')} disabled={busy} className={inputCls} placeholder="US" />
          {fe('tax_residency_country')}
        </Field>
        <Field label={`Tax ID${r.has_tax_id ? ' (saved · ••••' + (r.tax_id_last4 || '••••') + ')' : ''}`}
          hint="Encrypted at rest. Type a new value to replace.">
          <div className="flex gap-2">
            <input value={taxIdInput} onChange={e => setTaxIdInput(e.target.value)}
              disabled={busy} className={inputCls} placeholder={r.has_tax_id ? 'Replace…' : 'Enter…'} />
            <button onClick={() => taxIdInput && save({ tax_id_number: taxIdInput })}
              disabled={busy || !taxIdInput}
              className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg">Save</button>
            {r.has_tax_id && (
              <button onClick={() => save({ tax_id_number: null })} disabled={busy}
                className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg">Clear</button>
            )}
          </div>
          {fe('tax_id_number')}
        </Field>
        <Field label={`Phone${r.has_phone ? ' (saved · ••••' + (r.phone_last4 || '••••') + ')' : ''}`}
          hint="E.164 format, e.g. +14155551234.">
          <div className="flex gap-2">
            <input value={phoneInput} onChange={e => setPhoneInput(e.target.value)}
              disabled={busy} className={inputCls} placeholder={r.has_phone ? 'Replace…' : '+1…'} />
            <button onClick={() => phoneInput && save({ phone_e164: phoneInput })}
              disabled={busy || !phoneInput}
              className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg">Save</button>
            {r.has_phone && (
              <button onClick={() => save({ phone_e164: null })} disabled={busy}
                className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg">Clear</button>
            )}
          </div>
          {fe('phone_e164')}
        </Field>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Address</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Address line 1">
            <input value={r.address_line1 || ''} onChange={e => set('address_line1', e.target.value)}
              onBlur={() => onBlurSave('address_line1')} disabled={busy} className={inputCls} />
          </Field>
          <Field label="Address line 2">
            <input value={r.address_line2 || ''} onChange={e => set('address_line2', e.target.value)}
              onBlur={() => onBlurSave('address_line2')} disabled={busy} className={inputCls} />
          </Field>
          <Field label="City">
            <input value={r.city || ''} onChange={e => set('city', e.target.value)}
              onBlur={() => onBlurSave('city')} disabled={busy} className={inputCls} />
          </Field>
          <Field label="State / region">
            <input value={r.state_or_region || ''} onChange={e => set('state_or_region', e.target.value)}
              onBlur={() => onBlurSave('state_or_region')} disabled={busy} className={inputCls} />
          </Field>
          <Field label="Postal code">
            <input value={r.postal_code || ''} onChange={e => set('postal_code', e.target.value)}
              onBlur={() => onBlurSave('postal_code')} disabled={busy} className={inputCls} />
            {fe('postal_code')}
          </Field>
          <Field label="Country (ISO α-2)">
            <input value={r.country || ''} maxLength={2}
              onChange={e => set('country', e.target.value.toUpperCase())}
              onBlur={() => onBlurSave('country')} disabled={busy} className={inputCls} placeholder="US" />
            {fe('country')}
          </Field>
        </div>
      </div>
    </Card>
  );
}

function CorporateIdentityCard({ flash, onPctChange }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [taxIdInput, setTaxIdInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [draftUbo, setDraftUbo] = useState({ name: '', nationality: '', ownership_pct: '' });

  useEffect(() => {
    let cancelled = false;
    // AE-2: prefer the /legal-entity alias which always returns
    // `profile_completion_pct` so the parent ring & top banner stay
    // in sync without a second round-trip.
    api.getLegalEntity()
      .then(r => { if (!cancelled) { setRow(r); onPctChange?.(r.profile_completion_pct || 0); } })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load corporate profile'); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch) => {
    setBusy(true);
    setFieldErrors({});
    try {
      const updated = await api.updateLegalEntity(patch);
      setRow(updated);
      onPctChange?.(updated.profile_completion_pct || 0);
      // Notify the top-of-Settings banner to re-fetch.
      try { window.dispatchEvent(new CustomEvent('axal:profile_saved')); } catch {}
      flash('Saved');
      if ('tax_id_number' in patch) setTaxIdInput('');
      if ('ubos' in patch) setDraftUbo({ name: '', nationality: '', ownership_pct: '' });
    } catch (e) {
      // AE-2: surface field-level errors inline. The AE-1 envelope is
      // `{error, field, errors:{[field]: msg}}` — prefer the map form
      // when present (multi-field), fall back to single-field shape.
      const errsMap = e?.data?.errors;
      if (errsMap && typeof errsMap === 'object') setFieldErrors(errsMap);
      else if (e?.field) setFieldErrors({ [e.field]: e.message });
      // Only flash a toast when the error has no field — pure inline
      // otherwise, per AE-2 acceptance ("never a generic toast").
      if (!e?.field && !errsMap) flash(e.message || 'Failed to save', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <Card title="Legal entity"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Legal entity"><div className="text-sm text-gray-500">Loading…</div></Card>;

  const r = row;
  const set = (k, v) => setRow({ ...r, [k]: v });
  const onBlurSave = (k) => {
    const v = r[k] ?? null;
    save({ [k]: v === '' ? null : v });
  };
  const fe = (k) => fieldErrors[k] ? <span className="text-[11px] text-red-600 block mt-1">{fieldErrors[k]}</span> : null;

  const addUbo = () => {
    const pct = Number(draftUbo.ownership_pct);
    if (!draftUbo.name.trim() || !Number.isFinite(pct)) {
      flash('UBO needs a name and a numeric ownership %', 'error');
      return;
    }
    const next = [...(r.ubos || []), {
      name: draftUbo.name.trim(),
      nationality: draftUbo.nationality ? draftUbo.nationality.toUpperCase() : null,
      ownership_pct: pct,
      is_pep: false,
    }];
    save({ ubos: next });
  };
  const removeUbo = (i) => {
    const next = (r.ubos || []).filter((_, idx) => idx !== i);
    save({ ubos: next });
  };

  return (
    <>
      <Card title="Legal entity"
        description="Used to identify your company on Axal-VC contracts. Leave blank if you operate as an individual.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Entity name">
            <input value={r.entity_name || ''} onChange={e => set('entity_name', e.target.value)}
              onBlur={() => onBlurSave('entity_name')} disabled={busy} className={inputCls} />
          </Field>
          <Field label="Entity type">
            <select value={r.entity_type || ''} onChange={e => { set('entity_type', e.target.value); save({ entity_type: e.target.value || null }); }}
              disabled={busy} className={inputCls}>
              {ENTITY_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {fe('entity_type')}
          </Field>
          <Field label="Registration number" hint="Required when entity type is set.">
            <input value={r.registration_number || ''} onChange={e => set('registration_number', e.target.value)}
              onBlur={() => onBlurSave('registration_number')} disabled={busy} className={inputCls} />
            {fe('registration_number')}
          </Field>
          <Field label="Registered country (ISO α-2)">
            <input value={r.registered_country || ''} maxLength={2}
              onChange={e => set('registered_country', e.target.value.toUpperCase())}
              onBlur={() => onBlurSave('registered_country')} disabled={busy} className={inputCls} placeholder="US" />
            {fe('registered_country')}
          </Field>
          <Field label={`Tax ID / EIN${r.has_tax_id ? ' (saved · ••••' + (r.tax_id_last4 || '••••') + ')' : ''}`}>
            <div className="flex gap-2">
              <input value={taxIdInput} onChange={e => setTaxIdInput(e.target.value)}
                disabled={busy} className={inputCls} placeholder={r.has_tax_id ? 'Replace…' : 'Enter…'} />
              <button onClick={() => taxIdInput && save({ tax_id_number: taxIdInput })}
                disabled={busy || !taxIdInput}
                className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg">Save</button>
              {r.has_tax_id && (
                <button onClick={() => save({ tax_id_number: null })} disabled={busy}
                  className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg">Clear</button>
              )}
            </div>
            {fe('tax_id_number')}
          </Field>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Registered address</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Address line 1"><input value={r.registered_address_line1 || ''} onChange={e => set('registered_address_line1', e.target.value)} onBlur={() => onBlurSave('registered_address_line1')} disabled={busy} className={inputCls} /></Field>
            <Field label="Address line 2"><input value={r.registered_address_line2 || ''} onChange={e => set('registered_address_line2', e.target.value)} onBlur={() => onBlurSave('registered_address_line2')} disabled={busy} className={inputCls} /></Field>
            <Field label="City"><input value={r.registered_city || ''} onChange={e => set('registered_city', e.target.value)} onBlur={() => onBlurSave('registered_city')} disabled={busy} className={inputCls} /></Field>
            <Field label="State / region"><input value={r.registered_state || ''} onChange={e => set('registered_state', e.target.value)} onBlur={() => onBlurSave('registered_state')} disabled={busy} className={inputCls} /></Field>
            <Field label="Postal code">
              <input value={r.registered_postal || ''} onChange={e => set('registered_postal', e.target.value)} onBlur={() => onBlurSave('registered_postal')} disabled={busy} className={inputCls} />
              {fe('registered_postal')}
            </Field>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Signing authority</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Name"><input value={r.signing_authority_name || ''} onChange={e => set('signing_authority_name', e.target.value)} onBlur={() => onBlurSave('signing_authority_name')} disabled={busy} className={inputCls} /></Field>
            <Field label="Title"><input value={r.signing_authority_title || ''} onChange={e => set('signing_authority_title', e.target.value)} onBlur={() => onBlurSave('signing_authority_title')} disabled={busy} className={inputCls} placeholder="CEO" /></Field>
            <Field label="Email">
              <input value={r.signing_authority_email || ''} onChange={e => set('signing_authority_email', e.target.value)} onBlur={() => onBlurSave('signing_authority_email')} disabled={busy} className={inputCls} placeholder="founder@…" />
              {fe('signing_authority_email')}
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Ultimate beneficial owners (UBOs)"
        description="List anyone with ≥25% ownership. We mark the entity as UBO-disclosed once at least one ≥25% holder is on file.">
        <div className="space-y-2">
          {(r.ubos || []).length === 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400">No UBOs added yet.</div>
          )}
          {(r.ubos || []).map((u, i) => (
            <div key={i} className="flex items-center gap-2 text-sm border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
              <span className="font-medium text-gray-900 dark:text-gray-100 flex-1 truncate">{u.name}</span>
              <span className="text-xs text-gray-500">{u.nationality || '—'}</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-16 text-right">{u.ownership_pct}%</span>
              <button onClick={() => removeUbo(i)} disabled={busy}
                className="text-xs text-red-600 hover:text-red-700"><X size={14} /></button>
            </div>
          ))}
        </div>
        <div className="mt-3 grid sm:grid-cols-[1fr_80px_100px_auto] gap-2">
          <input value={draftUbo.name} onChange={e => setDraftUbo({ ...draftUbo, name: e.target.value })}
            placeholder="Full name" className={inputCls} />
          <input value={draftUbo.nationality} onChange={e => setDraftUbo({ ...draftUbo, nationality: e.target.value.toUpperCase() })}
            maxLength={2} placeholder="ISO" className={inputCls} />
          <input value={draftUbo.ownership_pct} onChange={e => setDraftUbo({ ...draftUbo, ownership_pct: e.target.value })}
            type="number" min="0" max="100" step="0.01" placeholder="%" className={inputCls} />
          <button onClick={addUbo} disabled={busy}
            className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg whitespace-nowrap">
            <Plus size={12} className="inline" /> Add
          </button>
        </div>
        {fe('ubos')}
        <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          Status: {r.ubo_disclosed
            ? <span className="text-emerald-600 font-medium">Disclosed (≥25% holder on file)</span>
            : <span className="text-amber-600 font-medium">Pending — add a ≥25% holder.</span>}
        </div>
      </Card>
    </>
  );
}

function VerificationStubCard({ data }) {
  const kyc = (data.kyc_status || 'not_started').toLowerCase();
  const tone = kyc === 'approved' ? 'emerald' : kyc === 'pending' ? 'amber' : 'gray';
  return (
    <Card title="Verification"
      description="Government ID and proof of address are managed in the KYC flow.">
      <div className={`text-sm flex items-center gap-2 text-${tone}-700`}>
        <ShieldCheck size={16} />
        <span>KYC status: <span className="font-medium">{kyc.replace(/_/g, ' ')}</span></span>
      </div>
      <a href="/kyc" className="mt-3 inline-block text-sm text-violet-700 hover:text-violet-800">
        Open KYC →
      </a>
      <div className="mt-4 text-[11px] text-gray-500 dark:text-gray-400">
        Document upload, sanctions/PEP rechecks and high-risk-jurisdiction flags are
        wired in a follow-up slice. The Identity and Legal entity blocks above are
        already used to auto-fill contracts.
      </div>
    </Card>
  );
}

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

// Task #6 — SMS 2FA panel. Only renders the enrolment UI when the worker
// reports `sms_available=true` (GCIP API key configured); otherwise falls
// back to a quiet "not available" notice so single-tenant deployments
// without GCIP don't see a broken form. Phone numbers are stored encrypted
// at rest server-side; the UI only ever sees the last 4 digits.
function SmsPanel({ data, flash }) {
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState('idle');           // idle | enroll | verify
  const [country, setCountry] = useState('US');
  const [phone, setPhone] = useState('');
  const [session, setSession] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { setStatus(await api.smsStatus()); }
    catch { setStatus({ configured: false, sms_available: false }); }
  };
  useEffect(() => { refresh(); }, []);

  const start = async () => {
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      flash('Phone must be E.164 format, e.g. +14155551234.', 'error'); return;
    }
    setBusy(true);
    try {
      const res = await api.smsStartEnrollment(phone, country, null);
      setSession(res.session_info);
      setStep('verify');
      flash('Verification code sent.');
    } catch (e) {
      flash(e?.message || 'Could not send verification code.', 'error');
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      await api.smsConfirmEnrollment(session, code);
      flash('SMS 2FA enabled.');
      setStep('idle'); setPhone(''); setCode(''); setSession(null);
      await refresh();
    } catch (e) {
      flash(e?.message || 'Verification failed.', 'error');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!data.totp_configured) {
      flash('Configure your authenticator first — every account must keep at least one 2FA method.', 'error');
      return;
    }
    if (!window.confirm('Remove SMS as a sign-in method?')) return;
    setBusy(true);
    try {
      await api.smsDisable();
      flash('SMS 2FA disabled.');
      await refresh();
    } catch (e) {
      flash(e?.message || 'Could not disable SMS.', 'error');
    } finally { setBusy(false); }
  };

  if (!status) {
    return <Card title="SMS as a backup factor" description="Loading…"><div className="text-sm text-gray-500">…</div></Card>;
  }
  if (!status.sms_available) {
    return (
      <Card title="SMS as a backup factor" description="SMS verification is not enabled on this server yet.">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          An administrator needs to provision Google Cloud Identity Platform credentials
          (<span className="font-mono">GCIP_API_KEY</span>) to turn this on. Once enabled, you'll
          be able to add a phone number here as a backup factor for account recovery.
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="SMS as a backup factor"
      description="Add a phone number as a backup verification factor. You'll receive a 6-digit code by text to confirm the number — used only for account recovery, never as a primary sign-in method."
    >
      <div className="text-xs text-amber-800 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-200 dark:border-amber-900 rounded-lg p-3 mb-3">
        <strong>SIM-swap warning:</strong> SMS is less secure than your authenticator app — anyone who takes over your phone number can use it to sign in.
        Billing changes, impersonation and other sensitive actions will always still require your authenticator code.
      </div>

      {status.configured && step === 'idle' && (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Status: <span className="text-emerald-700 font-medium">Enrolled</span>
            <span className="text-gray-500 dark:text-gray-400"> · ending in {status.last4} ({status.country})</span>
          </div>
          <button onClick={disable} disabled={busy}
            className="px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 rounded-lg text-sm font-medium">
            {busy ? 'Removing…' : 'Remove SMS factor'}
          </button>
        </div>
      )}

      {!status.configured && step === 'idle' && (
        <button onClick={() => setStep('enroll')}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
          Add a phone number
        </button>
      )}

      {step === 'enroll' && (
        <div className="space-y-3">
          <Field label="Country (ISO 2-letter, e.g. US, GB, CA)">
            <input value={country} onChange={e => setCountry(e.target.value.toUpperCase().slice(0, 2))}
              className={inputCls} maxLength={2} />
          </Field>
          <Field label="Phone (E.164 format, including +)">
            <input value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 16))}
              placeholder="+14155551234" className={`${inputCls} font-mono`} />
          </Field>
          <div className="flex gap-2">
            <button onClick={start} disabled={busy || !phone || country.length !== 2}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium">
              {busy ? 'Sending…' : 'Send verification code'}
            </button>
            <button onClick={() => { setStep('idle'); setPhone(''); }}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-300">Enter the 6-digit code we just texted to your phone.</div>
          <div className="flex gap-2">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" inputMode="numeric"
              className={`${inputCls} font-mono text-center tracking-widest`} />
            <button onClick={confirm} disabled={busy || code.length !== 6}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
              {busy ? 'Verifying…' : 'Confirm'}
            </button>
          </div>
          <button onClick={() => { setStep('enroll'); setCode(''); setSession(null); }}
            className="text-xs text-gray-500 hover:text-gray-700">Use a different number</button>
        </div>
      )}
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

      <SmsPanel data={data} flash={flash} />

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
  // Task #1 (Slack, 2026-05-10) — Slack column is gated on whether the
  // signed-in user has an active Slack integration. We poll the
  // integrations list once on mount; on failure we treat Slack as
  // disconnected (fail-closed — never invite the user to toggle a
  // channel that won't deliver).
  const [slackConnected, setSlackConnected] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    api.integrationsList().then(res => {
      if (cancelled) return;
      const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      setSlackConnected(items.some(i => i.provider_key === 'slack' && i.status === 'active'));
    }).catch(() => { if (!cancelled) setSlackConnected(false); });
    return () => { cancelled = true; };
  }, []);
  const channels = React.useMemo(() => NOTIFICATION_CHANNELS.map(c => {
    if (c.key !== 'slack') return c;
    return slackConnected
      ? c
      : { ...c, disabled: true, hint: 'Connect Slack first' };
  }), [slackConnected]);

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
            {channels.map(c => (
              <th key={c.key}
                className="text-center px-2 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider"
                title={c.disabled ? c.hint : undefined}>
                {c.label}
                {c.key === 'slack' && !slackConnected && (
                  <div className="text-[10px] normal-case font-normal text-violet-500 tracking-normal">
                    <a href="/settings/integrations" className="hover:underline">Connect Slack</a>
                  </div>
                )}
                {c.disabled && c.key !== 'slack' && (
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
              {channels.map(c => {
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
  // Task #5 — Personal assistant proactive nudges (Dashboard greeting
  // card + suggested next-actions). Stored in the same JSON columns so
  // the existing /api/settings/notifications endpoint is the source of
  // truth — the assistant reads notif_categories_inapp.proactive_nudges.
  { key: 'proactive_nudges', label: 'Assistant proactive nudges' },
];

// Task #14 — IANA tz list for the Quiet hours timezone picker. Browser
// runtimes ship `Intl.supportedValuesOf('timeZone')`; fall back to a
// sensible default set so older Safari / restricted environments still
// render a usable select.
const TZ_FALLBACK = [
  'UTC', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Athens', 'Europe/Istanbul',
  'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai',
  'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
  'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
];
function listTimezones() {
  try {
    const list = Intl.supportedValuesOf?.('timeZone');
    if (Array.isArray(list) && list.length) return list;
  } catch { /* noop */ }
  return TZ_FALLBACK;
}

function DigestQuietHoursCard({ flash }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Task #14 — per-field inline error messages from the worker.
  const [fieldErrors, setFieldErrors] = useState({});
  const tzList = useMemo(() => listTimezones(), []);

  useEffect(() => {
    let cancelled = false;
    api.getNotificationSettings()
      .then(r => {
        if (cancelled) return;
        // Default tz from the user's profile if quiet_hours_tz hasn't been
        // explicitly set yet — a much friendlier first-run experience.
        let next = { ...r };
        if (!next.quiet_hours_tz) {
          try {
            const cached = JSON.parse(localStorage.getItem('user') || '{}');
            if (cached?.timezone) next.quiet_hours_tz = cached.timezone;
          } catch { /* noop */ }
        }
        setRow(next);
      })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load notification settings'); });
    return () => { cancelled = true; };
  }, []);

  const save = async (delta, fieldHint) => {
    if (!row) return;
    const next = { ...row, ...delta };
    setRow(next);
    setBusy(true);
    setFieldErrors({});
    try {
      const res = await api.updateNotificationSettings(delta);
      setRow({ ...next, ...res });
      flash('Saved');
    } catch (e) {
      // Task #14 — surface field-level validation errors inline. The
      // worker returns `{error, field, errors:{[field]:msg}}` for 400s
      // raised by SettingsValidationError; older toasts only fire when
      // we can't pin the failure to a known field.
      const targetField = e?.field || fieldHint || null;
      if (targetField && e?.status === 400) {
        setFieldErrors({ [targetField]: e.message || 'Invalid value' });
      } else {
        flash(e.message || 'Failed to save', 'error');
      }
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
          <Field label="Digest frequency"
            hint="Send a daily digest at 9 AM (your time) — non-critical updates collected into a single email instead of arriving one-by-one.">
            <select value={row.digest_frequency || 'weekly'}
              onChange={e => save({ digest_frequency: e.target.value }, 'digest_frequency')} disabled={busy} className={inputCls}>
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            {fieldErrors.digest_frequency && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.digest_frequency}</p>
            )}
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
        description="Push and non-critical email are paused during this window. Critical alerts (security, billing, contract signing) always come through. Leave both blank to disable.">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Start (HH:MM)">
            <input type="time" value={row.quiet_hours_start || ''}
              onChange={e => setRow({ ...row, quiet_hours_start: e.target.value })}
              onBlur={() => save({ quiet_hours_start: row.quiet_hours_start || null }, 'quiet_hours_start')}
              className={inputCls} />
            {fieldErrors.quiet_hours_start && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.quiet_hours_start}</p>
            )}
          </Field>
          <Field label="End (HH:MM)">
            <input type="time" value={row.quiet_hours_end || ''}
              onChange={e => setRow({ ...row, quiet_hours_end: e.target.value })}
              onBlur={() => save({ quiet_hours_end: row.quiet_hours_end || null }, 'quiet_hours_end')}
              className={inputCls} />
            {fieldErrors.quiet_hours_end && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.quiet_hours_end}</p>
            )}
          </Field>
          <Field label="Timezone">
            <select value={row.quiet_hours_tz || ''}
              onChange={e => save({ quiet_hours_tz: e.target.value || null }, 'quiet_hours_tz')}
              disabled={busy} className={inputCls}>
              <option value="">UTC (default)</option>
              {tzList.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            {fieldErrors.quiet_hours_tz && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.quiet_hours_tz}</p>
            )}
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

// Task #4 — Investor Signals contribution toggle. Lives in Privacy because
// the data is fully anonymized (k≥5) but users may still want to opt out.
// Opting out flips contribute_to_signals=0; the next 6h aggregation cron
// will exclude this user automatically.
function InvestorSignalsContributionCard({ flash, role }) {
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getInvestorProfile()
      .then(r => { if (!cancelled) setProfile(r.profile); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load'); });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (next) => {
    if (!profile) return;
    setBusy(true);
    try {
      const r = await api.saveInvestorProfile({
        investor_type: profile.investor_type,
        sectors: profile.sectors,
        stages: profile.stages,
        geos: profile.geos,
        ticket_band: profile.ticket_band,
        thesis_text: profile.thesis_text,
        contribute_to_signals: next,
      });
      setProfile(r.profile);
      flash(next ? 'Now contributing to Investor Signals' : 'Opted out — your data will be removed within 6 hours');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Hide entirely from non-investor accounts that have never filled out a
  // profile (no value to surface). Investors always see it.
  const isInvestor = String(role || '').toLowerCase() === 'investor';
  if (!isInvestor && !profile?.completed_at) return null;

  if (err) return <Card title="Investor Signals"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!profile) return <Card title="Investor Signals"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const completed = !!profile.completed_at;
  return (
    <Card
      title="Anonymized Investor Signals"
      description="Your sector, stage, geography, ticket size and thesis can power the platform-wide Axal Investor Signals dashboard. We only ever publish a cell when at least 5 investors share the same answer."
    >
      <div className="space-y-3">
        {!completed && (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-md px-3 py-2">
            You haven&apos;t finished the investor profiling chatbot yet. <a href="/onboarding/investor" className="text-violet-600 hover:underline">Complete it now</a> to be included.
          </div>
        )}
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={!!profile.contribute_to_signals} disabled={busy}
            onChange={e => toggle(e.target.checked)}
            className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
          Contribute my answers to anonymized Investor Signals (k ≥ 5)
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Opting out removes your contribution within 6 hours, the next time the aggregator runs.
        </p>
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
                  {acct.provider === 'slack' ? 'Connect from the Integrations marketplace' : 'Connect from the relevant page'}
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

// Task #6 — Live tier billing tab. Reads /api/billing/tier/status; "Upgrade"
// opens Stripe Checkout for the chosen tier (or the dev-upgrade fallback when
// Stripe isn't configured); "Manage subscription" opens the Stripe billing
// portal so users can update card / cancel / download invoices.
function BillingTab({ data, flash }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.tierStatus()
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(() => { /* keep null → fall back to data prop */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Auto-flash when the URL carries an upgrade-completion param.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === '1') {
      flash?.('Subscription updated.');
      params.delete('upgraded');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
    } else if (params.get('upgrade_cancelled') === '1') {
      flash?.('Upgrade cancelled.', 'error');
      params.delete('upgrade_cancelled');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
    }
  }, [flash]);

  const tier = String(status?.tier || data?.subscription_tier || 'free').toLowerCase();
  const subStatus = status?.status || data?.subscription_status || 'active';
  const renews = status?.renews_at || data?.subscription_renews_at;
  const hasCustomer = status?.has_customer ?? !!data?.stripe_customer_id;

  const upgrade = async (target) => {
    setBusy(target);
    try {
      const res = await api.tierCheckout(target);
      if (res?.url) window.location.href = res.url;
    } catch (e) { flash?.(e.message || 'Checkout failed', 'error'); }
    finally { setBusy(null); }
  };

  const portal = async () => {
    setBusy('portal');
    try {
      const res = await api.tierPortal();
      if (res?.url) window.location.href = res.url;
    } catch (e) { flash?.(e.message || 'Could not open billing portal', 'error'); }
    finally { setBusy(null); }
  };

  const TIER_LABEL = { free: 'Free', growth: 'Growth — $79/mo', studio: 'Studio — $249/mo' };
  const ladder = ['free', 'growth', 'studio'];
  const RANK = { free: 0, growth: 1, studio: 2 };

  return (
    <>
      <Card title="Current plan" description="Your founder workspace subscription.">
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : (
          <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Tier</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {TIER_LABEL[tier] || tier}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Status: <span className="capitalize">{subStatus}</span>
                {renews ? <> · Renews {new Date(renews).toLocaleDateString()}</> : null}
              </div>
            </div>
            {hasCustomer && (
              <button type="button" disabled={busy === 'portal'} onClick={portal}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm font-medium disabled:opacity-50">
                {busy === 'portal' ? 'Opening…' : 'Manage subscription'}
              </button>
            )}
          </div>
        )}
      </Card>

      <Card title="Plans" description="Upgrade any time. Downgrade or cancel from Manage subscription.">
        <div className="grid gap-3 sm:grid-cols-3">
          {ladder.map((t) => {
            const current = t === tier;
            const upgradable = RANK[t] > RANK[tier];
            return (
              <div key={t}
                className={`rounded-lg border p-4 ${current ? 'border-violet-600 bg-violet-50/50 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="font-semibold text-gray-900 dark:text-gray-100 capitalize">{t}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t === 'free' && '1 project · 5 interviews · 3 OKRs'}
                  {t === 'growth' && '$79/mo · Unlimited builds, deck, scoring, mentors'}
                  {t === 'studio' && '$249/mo · + Capital, legal, partner tools'}
                </div>
                <div className="mt-3">
                  {current && (
                    <span className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">Current plan</span>
                  )}
                  {upgradable && (
                    <button type="button" disabled={busy === t} onClick={() => upgrade(t)}
                      className="w-full px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
                      {busy === t ? 'Opening checkout…' : `Upgrade to ${t}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          Questions? Contact <a className="text-violet-700 hover:underline" href="mailto:billing@axal.vc">billing@axal.vc</a>.
        </div>
      </Card>
    </>
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
  ];

  return (
    <>
      <Card title="Theme"
        description={`Choose Light or Dark. Currently rendering as ${effectiveTheme}.`}>
        <div className="grid grid-cols-2 gap-2">
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

      <HelpExplainersCard flash={flash} />
    </>
  );
}

// Task #15 — restore previously-dismissed page explainers.
function HelpExplainersCard({ flash }) {
  const [dismissed, setDismissed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getExplainersDismissed();
      const list = Array.isArray(res?.dismissed) ? res.dismissed : [];
      setDismissed(list);
      try { localStorage.setItem('dismissed_explainers', JSON.stringify(list)); } catch {}
      try { window.dispatchEvent(new CustomEvent('axal:explainers_synced')); } catch {}
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const restore = async (key) => {
    setBusy(true);
    try {
      const res = await api.restoreExplainer(key);
      const list = Array.isArray(res?.dismissed) ? res.dismissed : [];
      setDismissed(list);
      try { localStorage.setItem('dismissed_explainers', JSON.stringify(list)); } catch {}
      try { window.dispatchEvent(new CustomEvent('axal:explainers_synced')); } catch {}
      flash(key === 'all' ? 'Restored all explainers' : 'Restored');
    } catch (e) {
      flash(e.message || 'Failed to restore', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Card title="Help & explainers"
      description="Page explainers you've dismissed. Restore one to see it again on its page.">
      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      ) : dismissed.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Nothing dismissed yet.</div>
      ) : (
        <>
          <div className="space-y-1">
            {dismissed.map((key) => {
              const entry = EXPLAINERS[key];
              return (
                <div key={key}
                  className="flex items-center gap-2 text-sm border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
                  <span className="flex-1 truncate text-gray-900 dark:text-gray-100">
                    {entry ? entry.title : key}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 hidden sm:inline">{key}</span>
                  <button onClick={() => restore(key)} disabled={busy}
                    className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800">
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-3">
            <button onClick={() => restore('all')} disabled={busy}
              className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg">
              Restore all
            </button>
          </div>
        </>
      )}
    </Card>
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
