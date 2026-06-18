import React, { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../lib/log';
import { api } from '../lib/api';
import { Shield, Users, UserCheck, UserX, LogIn, ChevronDown, Briefcase, MessageSquare, X, Check, ShieldCheck, Clock, XCircle, CheckCircle2, FileText, Send, Download, Ban, Search, RefreshCw, Sparkles, Loader2, ShieldAlert, KeyRound, Trash2, AlertTriangle, Heart, Eye, EyeOff, BadgeCheck, Ticket, Plus, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PERSONAS as PERSONA_TAXONOMY } from '../lib/personas';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';
import { useWebSocket } from '../hooks/useWebSocket';
import TrustScoreBadge from '../components/TrustScoreBadge';
// Task #1 — embedded as a tab inside Admin Console so admins land on
// the network roster via /admin?tab=network-profiles. The standalone
// /admin/network-profiles route stays wired for direct deep-links.
import AdminNetworkProfiles from './admin/AdminNetworkProfiles';
import AdminTemplates from './admin/AdminTemplates';
import AdminForms from './admin/AdminForms';

// Task #16 — per-row trust score column on the admin Users table.
// Task #40 — accepts a pre-fetched `data` prop populated by the parent's
// single batch call (POST /api/trust/score/batch); falls back to the
// per-user GET /api/trust/score/:userId only if the parent didn't
// provide one (e.g. a row whose batch entry failed). Renders an em-dash
// placeholder while the batch is in flight to keep the row height stable.
function UserTrustCell({ userId, data }) {
  const [fallback, setFallback] = useState(null);
  useEffect(() => {
    if (data || !userId) return;
    let cancelled = false;
    api.trustScore(userId)
      .then(d => { if (!cancelled) setFallback(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, data]);
  const eff = data || fallback;
  if (!eff) return <span className="text-xs text-gray-400">—</span>;
  return <TrustScoreBadge size="sm" score={eff.score} missing={eff.missing} label={false} />;
}

const ROLE_BADGES = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
  investor: 'bg-amber-100 text-amber-700',
  mentor: 'bg-sky-100 text-sky-700',
};

function RoleDropdown({ user, onRoleChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const OPTIONS = [
    { value: 'founder', label: 'Founder' },
    { value: 'partner', label: 'Partner' },
    { value: 'investor', label: 'Investor' },
  ];
  const currentLabel = OPTIONS.find(o => o.value === user.role)?.label ?? user.role;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={`Change role for ${user.name || user.email}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Click to change this user's role"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border border-transparent hover:border-current hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-1 transition-all cursor-pointer ${ROLE_BADGES[user.role] || 'bg-gray-100 text-gray-700'}`}
      >
        {currentLabel}
        <ChevronDown size={11} className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Select role"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 min-w-[120px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 overflow-hidden"
        >
          {OPTIONS.map(opt => (
            <li
              key={opt.value}
              role="option"
              aria-selected={user.role === opt.value}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onRoleChange(user, opt.value); }}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none transition-colors ${
                user.role === opt.value
                  ? `${ROLE_BADGES[opt.value] || 'bg-gray-100 text-gray-700'} font-semibold`
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium'
              }`}
            >
              <span className="w-[11px] shrink-0">
                {user.role === opt.value && <Check size={11} />}
              </span>
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_BADGES = {
  pending: 'bg-amber-100 text-amber-700',
  verified: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

// KYC pill colors for the admin user table. `not_started` and an empty/null
// value are treated the same — no submission yet.
const KYC_BADGES = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
  not_started: 'bg-gray-100 text-gray-600',
};
const KYC_LABELS = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected',
  not_started: 'Not started',
};

const AGREEMENT_OPTIONS = [
  { value: '', label: '— Select agreement —' },
  { group: 'Investors', options: [
    { value: 'Subscription Booklet & LPA', label: 'Subscription Booklet & LPA (LP)' },
    { value: 'SPV Joinder Agreement', label: 'SPV Joinder Agreement (Syndicate)' },
    { value: 'Co-Investment Side Letter', label: 'Co-Investment Side Letter' },
    { value: 'Strategic Side Letter / Focused SPV', label: 'Strategic Side Letter / Focused SPV (Sector LP)' },
  ]},
  { group: 'Founders — New Venture (Spin-Out)', options: [
    { value: 'Founder Collaboration Agreement', label: 'Founder Collaboration Agreement' },
    { value: 'Spin-Out Subsidiary SPA + IP Transfer', label: 'Spin-Out Subsidiary SPA (Founder)' },
  ]},
  { group: 'Founders — Strategic Scale (Existing Company)', options: [
    { value: 'Strategic Scale Partnership Agreement', label: 'Strategic Scale Partnership Agreement' },
    { value: 'Technology Integration / JV Agreement', label: 'Technology Integration / JV (StudioOS AI)' },
    { value: 'Referral / Agency Agreement', label: 'Referral / Agency Agreement (Distribution / GTM)' },
    { value: 'M&A Advisory Mandate', label: 'M&A Advisory Mandate' },
  ]},
  { group: 'Operators & Service Partners', options: [
    { value: 'Venture Share Agreement (FAST)', label: 'Venture Share Agreement / FAST (Advisor)' },
    { value: 'MSA + Equity-for-Services', label: 'MSA + Equity-for-Services (Operating Partner)' },
    { value: 'Engagement Letter (Spin-Out Package)', label: 'Engagement Letter (Legal Counsel)' },
    { value: 'White-Label Service Agreement', label: 'White-Label Service Agreement (Technical Partner)' },
  ]},
  { group: 'Liquidity', options: [
    { value: 'Secondary Purchase Agreement', label: 'Secondary Purchase Agreement (Liquidity)' },
  ]},
];

const TRACK_BADGES = {
  'Spin-Out (New)': 'bg-blue-100 text-blue-700',
  'Strategic Scale (Existing)': 'bg-indigo-100 text-indigo-700',
};

export default function AdminPage({ onImpersonate }) {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  // Task #40 — batched trust-score map keyed by user_id, populated by a
  // single POST /api/trust/score/batch after each users-list refresh.
  // Replaces the previous per-row GET /trust/score/:userId fan-out.
  const [trustScores, setTrustScores] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [kycQueue, setKycQueue] = useState([]);
  const [kycFilter, setKycFilter] = useState('pending');
  const [kycDetail, setKycDetail] = useState(null);
  const [kycRejectReason, setKycRejectReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [openProfile, setOpenProfile] = useState(null);
  const [openUser, setOpenUser] = useState(null);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadKyc(kycFilter); }, [kycFilter]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [u, p] = await Promise.all([
        api.adminListUsers(),
        api.adminListProfiles().catch(() => []),
      ]);
      setUsers(u);
      setProfiles(p);
      // Task #40 — fan-in trust scores in one call. Best-effort: if it
      // fails (network blip, 403 mid-role-change), each row's
      // UserTrustCell falls back to the per-user GET.
      const ids = (u || []).map(row => row.id).filter(Boolean);
      if (ids.length > 0) {
        try {
          const res = await api.trustScoreBatch(ids);
          const map = {};
          for (const s of (res?.scores || [])) map[s.user_id] = s;
          setTrustScores(map);
        } catch (e) {
          reportError('AdminPage:trustScoreBatch', e);
        }
      } else {
        setTrustScores({});
      }
    } catch (e) {
      reportError('AdminPage:loadAdminData', e);
    } finally { setLoading(false); }
  };

  const loadKyc = async (status) => {
    try {
      const q = await api.kycAdminQueue(status);
      setKycQueue(q);
    } catch (e) {
      reportError('AdminPage:loadKycQueue', e);
      setKycQueue([]);
    }
  };

  const approveKyc = async (userId) => {
    try {
      await api.kycAdminApprove(userId);
      setKycDetail(null);
      loadKyc(kycFilter);
    } catch (e) { alert(e.message); }
  };

  const rejectKyc = async (userId) => {
    if (!kycRejectReason || kycRejectReason.trim().length < 5) { alert('Reason must be at least 5 characters.'); return; }
    try {
      await api.kycAdminReject(userId, kycRejectReason.trim());
      setKycDetail(null);
      setKycRejectReason('');
      loadKyc(kycFilter);
    } catch (e) { alert(e.message); }
  };

  const handleImpersonate = async (userId) => {
    try {
      const res = await api.adminImpersonate(userId);
      if (onImpersonate) onImpersonate(res.token, res.user);
    } catch (e) { alert(e.message); }
  };
  const handleToggleActive = async (userId) => {
    try { await api.adminToggleActive(userId); loadAll(); } catch (e) { alert(e.message); }
  };
  const handleGrantFullAccess = async (user) => {
    const ok = window.confirm(
      `Grant ${user.name || user.email} full access without requiring KYC?\n\n` +
      `This marks their KYC status as approved, lets them out of the verification gate, ` +
      `and is logged in their activity history. Use this only when you've verified their ` +
      `identity through another channel.`
    );
    if (!ok) return;
    try { await api.kycAdminApprove(user.id); loadAll(); }
    catch (e) { alert(e.message || 'Failed to grant access'); }
  };
  const handleGrantLimitedAccess = async (user) => {
    const ok = window.confirm(
      `Grant ${user.name || user.email} limited access?\n\n` +
      `They will be able to log in and browse the platform without completing KYC, ` +
      `BUT they will NOT be able to sign any legal agreements (subscription docs, SPA, ` +
      `side letters, etc.) until they complete full KYC verification.`
    );
    if (!ok) return;
    try { await api.adminSetAccessLevel(user.id, 'limited'); loadAll(); }
    catch (e) { alert(e.message || 'Failed to grant limited access'); }
  };
  const handleRevokeLimitedAccess = async (user) => {
    const ok = window.confirm(
      `Revoke limited access from ${user.name || user.email}?\n\n` +
      `They will be redirected back to the KYC verification flow on next page load.`
    );
    if (!ok) return;
    try { await api.adminSetAccessLevel(user.id, null); loadAll(); }
    catch (e) { alert(e.message || 'Failed to revoke limited access'); }
  };
  const handleRoleChange = async (user, newRole) => {
    if (newRole === user.role) return;
    const labels = { admin: 'Admin', founder: 'Founder', partner: 'Partner', investor: 'Investor' };
    const ok = window.confirm(
      `Change ${user.name || user.email}'s role from ${labels[user.role] || user.role} ` +
      `to ${labels[newRole] || newRole}?\n\nThis takes effect immediately and is logged in their activity history.`
    );
    if (!ok) return;
    try { await api.adminUpdateRole(user.id, newRole); loadAll(); } catch (e) { alert(e.message); }
  };

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter);
  const counts = {
    all: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    founder: users.filter(u => u.role === 'founder').length,
    partner: users.filter(u => u.role === 'partner').length,
    investor: users.filter(u => u.role === 'investor').length,
  };
  const pendingProfiles = profiles.filter(p => p.admin_status === 'pending').length;

  if (loading) return <div className="text-gray-600 text-center py-20">Loading admin console...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Shield size={24} className="text-violet-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Admin Console</h1>
      </div>
      <p className="text-gray-600 mb-6">Manage users, roles, and partner profiles</p>

      <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-800" data-testid="admin-page">
        <button data-testid="admin-tab-users" onClick={() => setTab('users')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'users' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Users size={14} className="inline mr-1.5" /> Users
        </button>
        <button data-testid="admin-tab-profiles" onClick={() => setTab('profiles')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'profiles' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Briefcase size={14} className="inline mr-1.5" /> Partner Profiles
          {pendingProfiles > 0 && (
            <span className="ml-2 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">{pendingProfiles} pending</span>
          )}
        </button>
        <button data-testid="admin-tab-kyc" onClick={() => setTab('kyc')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'kyc' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <ShieldCheck size={14} className="inline mr-1.5" /> KYC Queue
          {kycFilter === 'pending' && kycQueue.length > 0 && (
            <span className="ml-2 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">{kycQueue.length} pending</span>
          )}
        </button>
        <button data-testid="admin-tab-legal" onClick={() => setTab('legal')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'legal' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <FileText size={14} className="inline mr-1.5" /> Legal
        </button>
        <button data-testid="admin-tab-personas" onClick={() => setTab('personas')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'personas' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Sparkles size={14} className="inline mr-1.5" /> Personas
        </button>
        <button data-testid="admin-tab-directory" onClick={() => setTab('directory')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'directory' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Sparkles size={14} className="inline mr-1.5" /> Directory
        </button>
        <button data-testid="admin-tab-integration-keys" onClick={() => setTab('integration-keys')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'integration-keys' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <KeyRound size={14} className="inline mr-1.5" /> Integration Keys
        </button>
        <button data-testid="admin-tab-promos" onClick={() => setTab('promos')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'promos' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Ticket size={14} className="inline mr-1.5" /> Promo Codes
        </button>
        <button data-testid="admin-tab-billing" onClick={() => setTab('billing')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'billing' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <CreditCard size={14} className="inline mr-1.5" /> Billing
        </button>
        <button data-testid="admin-tab-wellbeing" onClick={() => setTab('wellbeing')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'wellbeing' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Heart size={14} className="inline mr-1.5" /> Wellbeing
        </button>
        <button data-testid="admin-tab-network-profiles" onClick={() => setTab('network-profiles')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'network-profiles' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Users size={14} className="inline mr-1.5" /> Mentors & Partners
        </button>
      </div>

      {tab === 'network-profiles' && (
        <div data-testid="admin-network-profiles-panel"><AdminNetworkProfiles /></div>
      )}

      {tab === 'legal' && <div data-testid="admin-legal-panel"><LegalPanel /></div>}
      {tab === 'personas' && <PersonasPanel />}
      {tab === 'directory' && <div data-testid="admin-directory-panel"><DirectoryPanel /></div>}
      {tab === 'integration-keys' && <div data-testid="admin-integration-keys-panel"><IntegrationKeysPanel /></div>}
      {tab === 'promos' && <div data-testid="admin-promos-panel"><PromoCodesPanel /></div>}
      {tab === 'billing' && <div data-testid="admin-billing-panel"><BillingPanel /></div>}
      {tab === 'wellbeing' && <div data-testid="admin-wellbeing-panel"><WellbeingExpertsPanel /></div>}

      {tab === 'users' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {Object.entries(counts).map(([role, count]) => (
              <button key={role} onClick={() => setFilter(role)}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  filter === role ? 'bg-violet-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-700 hover:border-violet-300'
                }`}>
                <div className="text-lg font-bold">{count}</div>
                <div className="capitalize">{role === 'all' ? 'All Users' : `${role}s`}</div>
              </button>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No users found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Name</th>
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Email</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Verified</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">KYC</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs" title="Required legal obligations satisfied">Trust</th>
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Joined</th>
                      <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr key={u.id} onClick={() => setOpenUser(u)}
                        className="border-b border-gray-100 hover:bg-violet-50/40 cursor-pointer">
                        <td className="px-4 py-3 text-gray-900 font-medium dark:text-gray-100">{u.name}</td>
                        <td className="px-4 py-3 text-gray-600">{u.email}</td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {u.role === 'admin' ? (
                            // Admin role is intentionally read-only in the UI. The PATCH
                            // /users/:id/role endpoint also refuses to promote into or
                            // demote out of `admin` — those changes must be made
                            // directly against the Cloudflare D1 database via SQL.
                            <span
                              title="Admin role can only be changed via direct database SQL (security policy)"
                              className={`inline-block text-xs font-semibold px-3 py-1 rounded-full ${ROLE_BADGES.admin || 'bg-violet-100 text-violet-700'}`}
                            >
                              Admin
                            </span>
                          ) : (
                            // Admin promotion intentionally not offered — see span branch above.
                            <RoleDropdown user={u} onRoleChange={handleRoleChange} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {u.email_verified ? <UserCheck size={16} className="text-green-500 mx-auto" /> : <UserX size={16} className="text-gray-400 mx-auto" />}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const k = u.kyc_status || 'not_started';
                            // Limited-access takes visual precedence ONLY when the user is
                            // not already approved — once they're approved, KYC trumps everything.
                            const isLimited = u.access_level === 'limited' && k !== 'approved';
                            if (isLimited) {
                              return (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700"
                                  title="Browse-only access. Cannot sign legal agreements until KYC is complete.">
                                  <ShieldCheck size={11} />
                                  Limited
                                </span>
                              );
                            }
                            return (
                              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${KYC_BADGES[k] || KYC_BADGES.not_started}`}>
                                <ShieldCheck size={11} />
                                {KYC_LABELS[k] || k}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <UserTrustCell userId={u.id} data={trustScores[u.id]} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end flex-wrap">
                            {/* Admins always have access; only show "Grant Full Access" for
                                non-admin users whose KYC isn't already approved. */}
                            {u.role !== 'admin' && u.kyc_status !== 'approved' && (
                              <button onClick={() => handleGrantFullAccess(u)}
                                className="px-2.5 py-1.5 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                title="Mark KYC approved without requiring submission">
                                <ShieldCheck size={12} /> Grant Access
                              </button>
                            )}
                            {/* Limited access: browse-only without KYC, no signing.
                                Only meaningful for non-admins not yet approved. */}
                            {u.role !== 'admin' && u.kyc_status !== 'approved' && u.access_level !== 'limited' && (
                              <button onClick={() => handleGrantLimitedAccess(u)}
                                className="px-2.5 py-1.5 text-xs bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                title="Allow login & browsing without KYC. Signing remains blocked.">
                                <ShieldCheck size={12} /> Grant Limited
                              </button>
                            )}
                            {u.role !== 'admin' && u.access_level === 'limited' && u.kyc_status !== 'approved' && (
                              <button onClick={() => handleRevokeLimitedAccess(u)}
                                className="px-2.5 py-1.5 text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                title="Remove limited access. User will be redirected to KYC.">
                                Revoke Limited
                              </button>
                            )}
                            <button onClick={() => handleImpersonate(u.id)}
                              className="px-2.5 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                              title="Login as this user">
                              <LogIn size={12} /> View As
                            </button>
                            <button onClick={() => handleToggleActive(u.id)}
                              className={`px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                                u.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'
                              }`}>
                              {u.is_active ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'profiles' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 dark:border-gray-800">
            <Briefcase size={16} className="text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Partner Profiles</h3>
            <span className="text-xs text-gray-500 ml-auto">{profiles.length} profiles</span>
          </div>

          {profiles.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No profiles captured yet. New users will appear here after completing the onboarding chatbot.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">User</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Persona</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Legal Entity</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Agreement</th>
                    <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                    <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map(p => (
                    <tr key={p.email} className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer" onClick={() => setOpenProfile(p)}>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 font-medium dark:text-gray-100">{p.user_name || '—'}</div>
                        <div className="text-xs text-gray-500">{p.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-700 dark:text-gray-300">{p.persona || <span className="text-gray-400">—</span>}</div>
                        {p.persona === 'Founder' && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.founder_track && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TRACK_BADGES[p.founder_track] || 'bg-gray-100 text-gray-600'}`}>
                                {p.founder_track}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              p.company_established === 1 ? 'bg-emerald-100 text-emerald-700'
                              : p.company_established === 0 ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-500'
                            }`}>
                              {p.company_established === 1 ? 'Incorporated' : p.company_established === 0 ? 'Not incorporated' : 'Formation unknown'}
                            </span>
                            {p.partnership_goal && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                                {p.partnership_goal}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.legal_entity_name || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs dark:text-gray-300">{p.agreement_type || <span className="text-gray-400">— not assigned —</span>}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGES[p.admin_status] || 'bg-gray-100 text-gray-700'}`}>
                          {p.admin_status || 'pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); setOpenProfile(p); }}
                          className="px-2.5 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium transition-colors">
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'kyc' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
            <ShieldCheck size={16} className="text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">KYC / AML Queue</h3>
            <div className="ml-auto flex gap-1">
              {['pending', 'approved', 'rejected', 'not_started'].map(s => (
                <button key={s} onClick={() => setKycFilter(s)}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium ${kycFilter === s ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          {kycQueue.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No submissions in <strong>{kycFilter.replace('_', ' ')}</strong> status.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">User</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Provider</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Submitted</th>
                    <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {kycQueue.map(k => (
                    <tr key={k.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{k.name}</div>
                        <div className="text-xs text-gray-500">{k.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGES[k.role] || 'bg-gray-100 text-gray-700'}`}>{k.role}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{k.kyc_provider || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{k.submitted_at ? new Date(k.submitted_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => { setKycDetail(k); setKycRejectReason(''); }}
                          className="px-2.5 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium transition-colors">
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {kycDetail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setKycDetail(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl dark:bg-gray-900" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3 sticky top-0 bg-white dark:border-gray-800 dark:bg-gray-900">
              <ShieldCheck size={18} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">KYC Review — {kycDetail.name}</h3>
              <button onClick={() => setKycDetail(null)} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <KV label="Email" value={kycDetail.email} />
                <KV label="Role" value={kycDetail.role} />
                <KV label="Status" value={kycDetail.kyc_status} />
                <KV label="Provider" value={kycDetail.kyc_provider || '—'} />
                <KV label="Submitted" value={kycDetail.submitted_at ? new Date(kycDetail.submitted_at).toLocaleString() : '—'} />
                <KV label="Reviewed" value={kycDetail.reviewed_at ? new Date(kycDetail.reviewed_at).toLocaleString() : '—'} />
              </div>
              {kycDetail.kyc_data && (
                <div className="border-t border-gray-100 pt-4">
                  <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide dark:text-gray-300">Submitted Information</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <KV label="Legal Name" value={`${kycDetail.kyc_data.legal_first_name || ''} ${kycDetail.kyc_data.legal_last_name || ''}`.trim()} />
                    <KV label="Date of Birth" value={kycDetail.kyc_data.date_of_birth} />
                    <KV label="Nationality" value={kycDetail.kyc_data.nationality || '—'} />
                    <KV label="Country" value={kycDetail.kyc_data.country} />
                    <KV label="Address" value={[kycDetail.kyc_data.address_line1, kycDetail.kyc_data.address_line2, kycDetail.kyc_data.city, kycDetail.kyc_data.state_region, kycDetail.kyc_data.postal_code].filter(Boolean).join(', ')} />
                    <KV label="Phone" value={kycDetail.kyc_data.phone || '—'} />
                    <KV label="ID Type" value={kycDetail.kyc_data.id_type} />
                    <KV label="ID Number" value={kycDetail.kyc_data.id_number} />
                    <KV label="Document Uploaded" value={kycDetail.kyc_data.document_uploaded ? `Yes (${kycDetail.kyc_data.document_storage || 'unknown'})` : 'No'} />
                    <KV label="PEP Disclosed" value={kycDetail.kyc_data.pep_self_disclosed ? 'Yes' : 'No'} />
                  </div>
                  {kycDetail.kyc_data.document_uploaded && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          // Bearer auth: must fetch via authenticated API call,
                          // build a blob URL, and open that. A plain anchor link
                          // can't carry the Authorization header.
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/kyc/admin/${kycDetail.id}/document`, {
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (!res.ok) {
                              const msg = await res.text().catch(() => '');
                              alert(`Failed to load document (${res.status}): ${msg}`);
                              return;
                            }
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const w = window.open(url, '_blank', 'noopener,noreferrer');
                            // Revoke after the new tab has had time to load.
                            setTimeout(() => URL.revokeObjectURL(url), 60_000);
                            if (!w) alert('Pop-up blocked. Allow pop-ups for axal.vc and try again.');
                          } catch (e) {
                            alert(`Failed to load document: ${e?.message || e}`);
                          }
                        }}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-axal-blue hover:text-axal-blue/80 underline"
                      >
                        View ID Document &rarr;
                      </button>
                      <p className="text-[10px] text-gray-500 mt-1">Opens in a new tab. Every access is audit-logged.</p>
                    </div>
                  )}
                  {kycDetail.kyc_data.provider_result && (
                    <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs">
                      <div className="font-semibold text-gray-700 mb-1 dark:text-gray-300">Automated Provider Result: <span className="font-mono">{kycDetail.kyc_data.provider_result.result}</span></div>
                      <pre className="text-gray-600 whitespace-pre-wrap text-[11px]">{JSON.stringify(kycDetail.kyc_data.provider_result.checks, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
              {kycDetail.rejection_reason && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  <strong>Previous rejection:</strong> {kycDetail.rejection_reason}
                </div>
              )}
              {(kycDetail.kyc_status === 'pending' || kycDetail.kyc_status === 'rejected') && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <textarea value={kycRejectReason} onChange={e => setKycRejectReason(e.target.value)}
                    rows={2} placeholder="Rejection reason (required if rejecting; min 5 chars)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 outline-none dark:border-gray-700" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => rejectKyc(kycDetail.id)}
                      className="px-3 py-2 text-sm bg-red-50 text-red-700 hover:bg-red-100 rounded-lg font-medium flex items-center gap-1.5">
                      <XCircle size={14} /> Reject
                    </button>
                    <button onClick={() => approveKyc(kycDetail.id)}
                      className="px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium flex items-center gap-1.5">
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {openProfile && (
        <ProfileReviewModal
          profile={openProfile}
          onClose={() => setOpenProfile(null)}
          onSaved={() => { setOpenProfile(null); loadAll(); }}
        />
      )}

      {openUser && (
        <UserDetailModal
          userRow={openUser}
          onClose={() => setOpenUser(null)}
          onImpersonate={() => { handleImpersonate(openUser.id); setOpenUser(null); }}
          onToggleActive={() => { handleToggleActive(openUser.id); setOpenUser(null); }}
        />
      )}
    </div>
  );
}

export function UserDetailModal({ userRow, onClose, onImpersonate, onToggleActive }) {
  useEscapeClose(onClose);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('profile');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  // T19 — toast lifecycle now handled by useToast (cleans up on unmount).
  const { toast, showToast: setToastSafe } = useToast(3000);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.adminUserProfile(userRow.id);
        if (!alive) return;
        setData(res);
        setNotes(res.user.admin_notes || '');
      } catch (e) {
        if (alive) setErr(e.message || 'Failed to load profile');
      }
    })();
    return () => { alive = false; };
  }, [userRow.id]);

  const flash = (kind, msg) => setToastSafe({ kind, msg });

  const saveNotes = async () => {
    setSaving(true);
    try {
      await api.adminUpdateNotes(userRow.id, notes);
      flash('ok', 'Notes saved');
    } catch (e) { flash('err', e.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const resend = async () => {
    if (!confirm(`Resend verification email to ${userRow.email}?`)) return;
    setResending(true);
    try {
      const r = await api.adminResendVerification(userRow.id);
      flash('ok', r.already_verified ? 'User is already verified' : 'Verification email sent');
    } catch (e) { flash('err', e.message || 'Failed to send'); }
    finally { setResending(false); }
  };

  const u = data?.user || userRow;
  const stats = data?.stats || {};
  const activity = data?.activity || [];
  const tickets = data?.tickets || [];
  const integrations = data?.integrations || [];
  const kyc = data?.kyc || {};

  // Task #1 (DB) — Onboarding + Ongoing Conversation tabs both fetch
  // through the dedicated, audited transcript endpoints. The Ongoing
  // tab uses a left-rail conversation list + right-pane drilldown,
  // search/date filters, CSV export, and per-message sparkle indicators
  // for messages that triggered a domain write (advisor_answers row).
  const [onboardingDetail, setOnboardingDetail] = useState(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [advisorList, setAdvisorList] = useState([]);
  const [advisorListLoading, setAdvisorListLoading] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState(null);
  const [convDetail, setConvDetail] = useState(null);
  const [convDetailLoading, setConvDetailLoading] = useState(false);
  const [advisorSearch, setAdvisorSearch] = useState('');
  const [advisorSince, setAdvisorSince] = useState('');
  const [advisorUntil, setAdvisorUntil] = useState('');

  useEffect(() => {
    if (tab !== 'onboarding') return;
    let alive = true;
    setOnboardingLoading(true);
    (async () => {
      try {
        const res = await api.adminUserOnboardingConversation(userRow.id);
        if (alive) setOnboardingDetail(res);
      } catch (e) {
        if (alive) flash('err', e.message || 'Failed to load onboarding transcript');
      } finally {
        if (alive) setOnboardingLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userRow.id]);

  useEffect(() => {
    if (tab !== 'advisor') return;
    let alive = true;
    setAdvisorListLoading(true);
    (async () => {
      try {
        const res = await api.adminUserAdvisorConversations(userRow.id, {
          q: advisorSearch || undefined,
          since: advisorSince || undefined,
          until: advisorUntil || undefined,
          limit: 100,
        });
        if (!alive) return;
        const list = res?.conversations || [];
        setAdvisorList(list);
        if (list.length && !list.find(c => c.id === selectedConvId)) {
          setSelectedConvId(list[0].id);
        }
      } catch (e) {
        if (alive) flash('err', e.message || 'Failed to load conversations');
      } finally {
        if (alive) setAdvisorListLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userRow.id, advisorSearch, advisorSince, advisorUntil]);

  useEffect(() => {
    if (tab !== 'advisor' || !selectedConvId) { setConvDetail(null); return; }
    let alive = true;
    setConvDetailLoading(true);
    (async () => {
      try {
        const res = await api.adminUserAdvisorConversation(userRow.id, selectedConvId);
        if (alive) setConvDetail(res);
      } catch (e) {
        if (alive) flash('err', e.message || 'Failed to load transcript');
      } finally {
        if (alive) setConvDetailLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userRow.id, selectedConvId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{u.name}</h3>
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${ROLE_BADGES[u.role] || 'bg-gray-100 text-gray-700'}`}>{u.role}</span>
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
              {u.email_verified ? (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700">Verified</span>
              ) : (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">Unverified</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">{u.email} · joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {toast && (
          <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-xs ${toast.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{toast.msg}</div>
        )}

        <div className="px-6 pt-3 border-b border-gray-200 flex gap-1 overflow-x-auto dark:border-gray-800">
          {['profile', 'registration', 'onboarding', 'advisor', 'kyc', 'agreements', 'activity', 'notes'].map(t => {
            // Task #11 — onboarding tab now reads from the user's first
            // advisor conversation; the new 'advisor' tab reads from their
            // most-recent. Fall back to the legacy `data.onboarding` shape
            // for safety so a stale worker response still renders something.
            const onboardingMsgs = data?.onboarding_conversation?.messages || data?.onboarding || [];
            const ongoingMsgs = data?.ongoing_conversation?.messages || [];
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px capitalize whitespace-nowrap transition-colors ${tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
                {t === 'kyc' ? 'KYC & Verification' :
                 t === 'registration' ? `Registration${(data?.timeline?.length ?? 0) ? ` · ${data.timeline.length}` : ''}` :
                 t === 'agreements' ? `Agreements${(data?.agreements?.length ?? 0) ? ` · ${data.agreements.length}` : ''}` :
                 t === 'onboarding' ? `Onboarding${onboardingMsgs.length ? ` · ${onboardingMsgs.length}` : ''}` :
                 t === 'advisor' ? `Ongoing Conversation${ongoingMsgs.length ? ` · ${ongoingMsgs.length}` : ''}` :
                 t === 'activity' ? `Activity${(data?.activity?.length ?? 0) ? ` · ${data.activity.length}` : ''}` :
                 t}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {err && <div className="text-sm text-red-600 mb-4">{err}</div>}
          {!data && !err && <div className="text-sm text-gray-500">Loading…</div>}

          {data && tab === 'profile' && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Name" value={u.name} />
              <Field label="Email" value={u.email} />
              <Field label="Role" value={u.role} />
              <Field label="UID" value={u.uid} mono />
              <Field label="Founder ID" value={u.founder_public_id || (u.founder_id ? `#${u.founder_id}` : '—')} mono={!!u.founder_public_id} />
              <Field label="Partner ID" value={u.partner_public_id || (u.partner_id ? `#${u.partner_id}` : '—')} mono={!!u.partner_public_id} />
              <Field label="Joined" value={u.created_at ? new Date(u.created_at).toLocaleString() : '—'} />
              <Field label="Last active" value={u.last_active_at ? new Date(u.last_active_at).toLocaleString() : '—'} />
              <div className="col-span-2 grid grid-cols-4 gap-3 mt-2">
                <Stat label="Activity events" value={stats.activity_count ?? 0} />
                <Stat label="Tickets" value={stats.ticket_count ?? 0} />
                <Stat label="Integrations" value={stats.integration_count ?? 0} />
                <Stat label="Agreements" value={stats.agreement_count ?? 0} />
              </div>
              {(data.founder || data.partner) && (
                <div className="col-span-2 mt-3 bg-violet-50 border border-violet-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-violet-700 mb-2">
                    {data.founder ? 'Founder profile' : 'Partner profile'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-800 dark:text-gray-200">
                    {data.founder && (
                      <>
                        {data.founder.domain_expertise && <Field label="Expertise" value={data.founder.domain_expertise} />}
                        {data.founder.experience_years != null && <Field label="Experience" value={`${data.founder.experience_years} yrs`} />}
                        {data.founder.linkedin_url && (
                          <div className="col-span-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">LinkedIn</div>
                            <a href={data.founder.linkedin_url} target="_blank" rel="noreferrer"
                              className="text-violet-700 hover:underline break-all">{data.founder.linkedin_url}</a>
                          </div>
                        )}
                        {data.founder.bio && (
                          <div className="col-span-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Bio</div>
                            <div className="text-gray-800 whitespace-pre-wrap dark:text-gray-200">{data.founder.bio}</div>
                          </div>
                        )}
                      </>
                    )}
                    {data.partner && (
                      <>
                        {data.partner.company && <Field label="Company" value={data.partner.company} />}
                        {data.partner.specialization && <Field label="Specialization" value={data.partner.specialization} />}
                        {data.partner.status && <Field label="Status" value={data.partner.status} />}
                      </>
                    )}
                  </div>
                </div>
              )}
              {integrations.length > 0 && (
                <div className="col-span-2 mt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2 dark:text-gray-300">Connected integrations</div>
                  <div className="space-y-1.5">
                    {integrations.map(i => (
                      <div key={i.uid} className="flex items-center justify-between text-xs bg-gray-50 px-3 py-2 rounded-lg">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{i.display_name || i.provider_name}</span>
                        <span className="text-gray-500">{i.status} · {i.last_synced_at ? new Date(i.last_synced_at).toLocaleString() : 'never synced'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {data && tab === 'registration' && (
            <div className="space-y-2">
              {(data.timeline || []).length === 0 && <div className="text-sm text-gray-500">No registration events recorded.</div>}
              {(data.timeline || []).map((ev, i) => (
                <div key={`${ev.kind}-${ev.ts}-${i}`} className="flex gap-3 text-xs">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-violet-500 mt-1.5" />
                    {i < (data.timeline.length - 1) && <div className="w-px flex-1 bg-gray-200 mt-1" />}
                  </div>
                  <div className="flex-1 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 capitalize dark:text-gray-100">{ev.label}</span>
                      <span className="text-gray-500 whitespace-nowrap">{ev.ts ? new Date(ev.ts).toLocaleString() : ''}</span>
                    </div>
                    {ev.detail && <div className="text-gray-600 mt-0.5">{ev.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data && tab === 'agreements' && (
            <div className="space-y-2">
              {(data.agreements || []).length === 0 && <div className="text-sm text-gray-500">No eSign agreements yet.</div>}
              {(data.agreements || []).map(ag => (
                <div key={`${ag.envelope_id}-${ag.recipient_id || 'na'}`} className="border border-gray-200 rounded-lg p-3 text-xs dark:border-gray-800">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{ag.document_title || ag.document_type || 'Agreement'}</div>
                      <div className="text-gray-500 mt-0.5">
                        {ag.role_in_envelope === 'creator' ? 'Sent by user' : 'Recipient'}
                        {ag.recipient_email ? ` · ${ag.recipient_email}` : ''}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide text-[10px] ${
                      (ag.recipient_status || ag.envelope_status) === 'signed' || (ag.recipient_status || ag.envelope_status) === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                      (ag.recipient_status || ag.envelope_status) === 'pending' || (ag.recipient_status || ag.envelope_status) === 'sent' ? 'bg-amber-100 text-amber-700' :
                      (ag.recipient_status || ag.envelope_status) === 'declined' || (ag.recipient_status || ag.envelope_status) === 'expired' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {ag.recipient_status || ag.envelope_status || 'unknown'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-gray-600">
                    <div>Created: {ag.created_at ? new Date(ag.created_at).toLocaleString() : '—'}</div>
                    <div>Signed: {ag.recipient_signed_at || ag.signed_at ? new Date(ag.recipient_signed_at || ag.signed_at).toLocaleString() : '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'onboarding' && (() => {
            // Task #1 (DB) — Onboarding tab fetches via the dedicated
            // /api/admin/users/:id/conversations/onboarding endpoint so
            // every view is recorded in admin_profile_audit +
            // admin_audit_log. Worker returns summary + completion_pct
            // pre-computed; no client-side derivation.
            if (onboardingLoading && !onboardingDetail) {
              return <div className="text-xs text-gray-500 p-4">Loading onboarding transcript…</div>;
            }
            const msgs = onboardingDetail?.messages || [];
            const conv = onboardingDetail?.conversation || null;
            const completionPct = onboardingDetail?.completion_pct ?? 0;
            const summary = onboardingDetail?.summary || null;
            // Task #34 — distinguish "user never started onboarding"
            // from "user opened the chatbot but never answered". Backend
            // returns one of: 'never_completed' | 'in_progress' | null.
            const emptyReason = onboardingDetail?.empty_reason || null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={14} className="text-gray-600" />
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Onboarding Conversation</h4>
                  {conv && (
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-violet-50 text-violet-700">
                      {conv.persona} · {conv.state}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-gray-500">
                    {msgs.length} message{msgs.length === 1 ? '' : 's'} · {completionPct}% complete
                  </span>
                </div>
                {summary && (
                  <div className="mb-2 text-[11px] text-gray-600 bg-violet-50 border border-violet-100 rounded-lg p-2">
                    <span className="font-semibold text-violet-800">Summary:</span> {summary}
                  </div>
                )}
                {msgs.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-500 dark:border-gray-800">
                    {emptyReason === 'in_progress' ? (
                      <>
                        <div className="font-semibold text-gray-700 mb-1 dark:text-gray-300">Onboarding in progress</div>
                        This user has opened the Personal Advisor onboarding session but hasn’t answered any questions yet. The transcript will populate as soon as they respond to the first prompt.
                      </>
                    ) : (
                      <>
                        <div className="font-semibold text-gray-700 mb-1 dark:text-gray-300">Never completed onboarding</div>
                        This user has not started the Personal Advisor onboarding chatbot. Conversations sync here once they answer their first question.
                      </>
                    )}
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-[60vh] overflow-y-auto space-y-2 dark:border-gray-800">
                    {msgs.map((m, i) => (
                      <ChatBubble key={i} m={m} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {data && tab === 'advisor' && (
            <div className="flex gap-3 h-[65vh]">
              {/* LEFT RAIL — conversation list with search + date filters + CSV */}
              <div className="w-64 shrink-0 border border-gray-200 rounded-lg bg-white flex flex-col dark:border-gray-800 dark:bg-gray-900">
                <div className="p-2 border-b border-gray-200 space-y-2 dark:border-gray-800">
                  <input
                    type="search"
                    value={advisorSearch}
                    onChange={(e) => setAdvisorSearch(e.target.value)}
                    placeholder="Search persona / state / model"
                    className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded dark:border-gray-700"
                  />
                  <div className="flex gap-1">
                    <input
                      type="date"
                      value={advisorSince}
                      onChange={(e) => setAdvisorSince(e.target.value)}
                      title="From"
                      className="flex-1 text-[11px] px-1.5 py-1 border border-gray-300 rounded dark:border-gray-700"
                    />
                    <input
                      type="date"
                      value={advisorUntil}
                      onChange={(e) => setAdvisorUntil(e.target.value)}
                      title="To"
                      className="flex-1 text-[11px] px-1.5 py-1 border border-gray-300 rounded dark:border-gray-700"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.adminUserAdvisorTranscriptExport(userRow.id, {
                          from: advisorSince || undefined,
                          to: advisorUntil || undefined,
                        });
                      } catch (e) {
                        flash('error', e.message || 'CSV export failed');
                      }
                    }}
                    className="block w-full text-center text-[11px] px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded font-medium text-gray-700 dark:text-gray-300"
                  >
                    Download CSV
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {advisorListLoading && (
                    <div className="p-3 text-[11px] text-gray-500">Loading…</div>
                  )}
                  {!advisorListLoading && advisorList.length === 0 && (
                    <div className="p-3 text-[11px] text-gray-500">No conversations.</div>
                  )}
                  {advisorList.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedConvId(c.id)}
                      className={`w-full text-left px-2.5 py-2 border-b border-gray-100 text-[11px] hover:bg-gray-50 ${selectedConvId === c.id ? 'bg-violet-50' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-gray-900 truncate dark:text-gray-100">{c.persona || '—'}</span>
                        {(c.write_count ?? 0) > 0 && (
                          <span title={`${c.write_count} writes`} className="text-amber-500">✦</span>
                        )}
                      </div>
                      <div className="text-gray-600 truncate">{c.state || '—'} · {c.completion_pct ?? 0}%</div>
                      <div className="text-gray-400 mt-0.5">{c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}</div>
                      {c.last_model && (
                        <div className="text-gray-400 truncate">{c.last_model}{c.last_latency_ms ? ` · ${c.last_latency_ms}ms` : ''}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* RIGHT PANE — selected conversation transcript */}
              <div className="flex-1 min-w-0 border border-gray-200 rounded-lg bg-gray-50 flex flex-col dark:border-gray-800">
                {!selectedConvId && (
                  <div className="p-4 text-xs text-gray-500">Select a conversation from the list.</div>
                )}
                {selectedConvId && convDetailLoading && (
                  <div className="p-4 text-xs text-gray-500">Loading transcript…</div>
                )}
                {selectedConvId && convDetail && (() => {
                  const c = convDetail.conversation;
                  const msgs = convDetail.messages || [];
                  return (
                    <>
                      <div className="p-3 border-b border-gray-200 bg-white text-xs dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{c?.persona || '—'}</span>
                          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-violet-50 text-violet-700">{c?.state || '—'}</span>
                          <span className="text-gray-500">{convDetail.completion_pct ?? 0}% complete · {msgs.length} msg</span>
                        </div>
                        {convDetail.summary && (
                          <div className="mt-1.5 text-[11px] text-gray-700 bg-violet-50 border border-violet-100 rounded px-2 py-1.5 dark:text-gray-300">
                            <span className="font-semibold text-violet-800">Summary:</span> {convDetail.summary}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {msgs.map((m, i) => <ChatBubble key={i} m={m} />)}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {data && tab === 'kyc' && (
            <div className="space-y-3 text-sm">
              <Field label="KYC status" value={kyc.status || 'unknown'} />
              <Field label="Email verified" value={u.email_verified ? 'Yes' : 'No'} />
              <Field label="TOTP enabled" value={kyc.totp_enabled ? 'Yes (required at login)' : 'No'} />
              <Field label="ID document uploaded" value={kyc.id_uploaded ? 'Yes' : 'No'} />
              <div className="pt-2">
                <button onClick={resend} disabled={resending || u.email_verified}
                  className="px-3 py-2 text-xs bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:bg-gray-300">
                  {resending ? 'Sending…' : u.email_verified ? 'Already verified' : 'Resend verification email'}
                </button>
              </div>
            </div>
          )}

          {data && tab === 'activity' && (
            <div className="space-y-2">
              {activity.length === 0 && <div className="text-sm text-gray-500">No activity recorded.</div>}
              {activity.map(a => (
                <div key={a.id} className="text-xs border border-gray-200 rounded-lg p-2.5 dark:border-gray-800">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{a.action}</span>
                    <span className="text-gray-500">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                  </div>
                  {a.details && <div className="text-gray-600 mt-1">{a.details}</div>}
                </div>
              ))}
              {tickets.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-gray-700 mt-4 mb-2 dark:text-gray-300">Recent tickets</div>
                  {tickets.map(t => (
                    <div key={t.id} className="text-xs border border-gray-200 rounded-lg p-2.5 flex items-center justify-between dark:border-gray-800">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{t.title}</span>
                      <span className="text-gray-500">{t.status} · {t.priority}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {data && tab === 'notes' && (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Admin notes (visible only to admins)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={8}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
                placeholder="Internal notes about this user…" />
              <div className="flex gap-2">
                <button onClick={saveNotes} disabled={saving}
                  className="px-3 py-2 text-xs bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:bg-gray-300">
                  {saving ? 'Saving…' : 'Save notes'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between dark:border-gray-800">
          <div className="flex gap-2">
            <button onClick={onImpersonate}
              className="px-3 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium flex items-center gap-1">
              <LogIn size={12} /> View As
            </button>
            <button onClick={onToggleActive}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${u.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
              {u.is_active ? 'Disable account' : 'Enable account'}
            </button>
          </div>
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Close</button>
        </div>
      </div>
    </div>
  );
}

// Task #1 (DB) — shared chat-bubble renderer for the Onboarding +
// Ongoing Conversation tabs. Surfaces the per-message metadata that
// the worker now returns: model, latency_ms, tokens, and a sparkle
// indicator when the assistant turn triggered a domain write
// (advisor_answers row landed in a real table).
function ChatBubble({ m }) {
  const wrote = m.written_to;
  const wroteOk = wrote && (wrote.status === 'ok' || wrote.status === 'success' || wrote.table);
  return (
    <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] text-xs px-3 py-2 rounded-lg whitespace-pre-wrap ${
        m.role === 'user'
          ? 'bg-violet-600 text-white'
          : m.role === 'system'
          ? 'bg-amber-50 border border-amber-200 text-amber-800'
          : m.role === 'tool'
          ? 'bg-blue-50 border border-blue-200 text-blue-800'
          : 'bg-white border border-gray-200 text-gray-800'
      }`}>
        <div className="flex items-start gap-1.5">
          {wroteOk && (
            <span title={`Wrote to ${wrote.table || ''}${wrote.column ? `.${wrote.column}` : ''}`}
                  className="text-amber-500 shrink-0">✦</span>
          )}
          <div className="flex-1 min-w-0">{m.content}</div>
        </div>
        {(m.ts || m.model || m.latency_ms != null || m.tokens != null) && (
          <div className={`mt-1 text-[10px] ${m.role === 'user' ? 'text-violet-100' : 'text-gray-400'}`}>
            {m.ts ? new Date(m.ts).toLocaleString() : ''}
            {m.question_id ? ` · ${m.question_id}` : ''}
            {m.model ? ` · ${m.model}` : ''}
            {m.latency_ms != null ? ` · ${m.latency_ms}ms` : ''}
            {m.tokens != null ? ` · ${m.tokens}t` : ''}
            {wroteOk && wrote.table ? ` · → ${wrote.table}${wrote.column ? `.${wrote.column}` : ''}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className={`text-gray-900 ${mono ? 'font-mono text-xs' : ''} mt-0.5 break-all`}>{value || '—'}</div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
      <div className="text-2xl font-bold text-violet-700">{value}</div>
      <div className="text-[11px] text-gray-600 mt-0.5">{label}</div>
    </div>
  );
}

function ProfileReviewModal({ profile, onClose, onSaved }) {
  useEscapeClose(onClose);
  const [agreement, setAgreement] = useState(profile.agreement_type || '');
  const [notes, setNotes] = useState(profile.admin_notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Persisted transcript from D1 — used as the initial render. New messages
  // streamed in via the OnboardingChat Durable Object are appended below.
  const initialChat = (() => {
    try { return JSON.parse(profile.chat_history || '[]'); } catch { return []; }
  })();
  const [liveChat, setLiveChat] = useState(initialChat);
  // Unified dedupe key — must match between persisted seed and live DO frames
  // (architect review caught the prior `seed:` vs `do:` schema split that
  // caused duplicates when the DO replayed `recent` on hello).
  // Use full content (not first 64 chars) to avoid collapsing distinct
  // messages with the same prefix; bucket by ts when present so retried
  // sends with identical text don't collapse either.
  const msgKey = (m) => `${m.ts || ''}:${m.role}:${m.content || ''}`;
  const seenKeysRef = useRef(new Set(initialChat.map(msgKey)));
  // Subscribe to the founder's onboarding chat room. profile.user_id is
  // the foreign key to users.id; admins are authorized server-side to
  // view any user's room.
  const wsPath = profile.user_id ? `/api/onboarding/ws/${profile.user_id}` : null;
  const { status: wsStatus } = useWebSocket(wsPath, {
    enabled: !!profile.user_id,
    onMessage: (msg) => {
      if (!msg) return;
      // The DO sends { type:'hello', recent:[...] } on connect, then
      // { type:'chat_message', message:{role,content,ts} } per new turn.
      if (msg.type === 'hello' && Array.isArray(msg.recent)) {
        const fresh = msg.recent.filter(m => {
          const key = msgKey(m);
          if (seenKeysRef.current.has(key)) return false;
          seenKeysRef.current.add(key);
          return true;
        });
        if (fresh.length) setLiveChat(curr => [...curr, ...fresh]);
      } else if (msg.type === 'chat_message' && msg.message) {
        const m = msg.message;
        const key = msgKey(m);
        if (seenKeysRef.current.has(key)) return;
        seenKeysRef.current.add(key);
        setLiveChat(curr => [...curr, m]);
      }
    },
  });
  const chatMessages = liveChat;
  let extracted = {};
  try { extracted = JSON.parse(profile.extracted_data || '{}'); } catch {}

  const [esignFlash, setEsignFlash] = useState(null);
  const [viaDocusign, setViaDocusign] = useState(false);
  // Real availability check — DocuSign is a Studio-tier provider AND
  // requires an active connected integration on the calling admin's
  // account. We hit `/api/integrations` once on mount and look for a
  // `provider_key === 'docusign'` row with `status === 'active'`. The
  // backend `/esign/send` is the source of truth (Studio 402 + 412
  // when not connected) — this UI gate just prevents the admin from
  // selecting a doomed option.
  const [docusignAvailable, setDocusignAvailable] = useState(false);
  const [docusignReason, setDocusignReason] = useState('checking');
  useEffect(() => {
    let alive = true;
    api.integrationsList()
      .then((rows) => {
        if (!alive) return;
        const list = Array.isArray(rows) ? rows : (rows?.integrations || rows?.items || []);
        const ds = list.find((r) => (r.provider_key || r.provider) === 'docusign' && r.status === 'active');
        setDocusignAvailable(!!ds);
        setDocusignReason(ds ? 'ok' : 'not_connected');
      })
      .catch(() => { if (alive) { setDocusignAvailable(false); setDocusignReason('error'); } });
    return () => { alive = false; };
  }, []);
  // If DocuSign is unavailable, force the toggle off so we never POST
  // provider='docusign' against a backend that will 412.
  useEffect(() => {
    if (!docusignAvailable && viaDocusign) setViaDocusign(false);
  }, [docusignAvailable, viaDocusign]);
  const submit = async (status) => {
    setSaving(true);
    setError('');
    try {
      const res = await api.adminVerifyProfile(profile.email, {
        agreement_type: agreement,
        admin_notes: notes,
        status,
        provider: viaDocusign && docusignAvailable ? 'docusign' : 'native',
      });
      if (res?.esign?.envelope_id) {
        setEsignFlash({
          envelopeId: res.esign.envelope_id,
          emailSent: !!res.esign.email_sent,
          signingUrl: res.esign.signing_url,
          provider: res.esign.provider || 'native',
        });
        setTimeout(() => onSaved(), 2200);
      } else {
        onSaved();
      }
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between dark:border-gray-800">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{profile.user_name || profile.email}</h3>
            <p className="text-xs text-gray-500">{profile.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Persona (AI extracted)</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.persona || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Entity Type</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.entity_type || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Legal Entity Name</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.legal_entity_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">EIN / Tax ID</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.ein || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Signatory</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.signatory_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Title</div>
              <div className="text-gray-900 font-medium dark:text-gray-100">{profile.signatory_title || '—'}</div>
            </div>
          </div>

          {profile.persona === 'Founder' && (
            <div className={`rounded-lg p-3 border ${
              profile.founder_track === 'Strategic Scale (Existing)' ? 'bg-indigo-50 border-indigo-300'
              : profile.founder_track === 'Spin-Out (New)' ? 'bg-blue-50 border-blue-300'
              : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Founder Track</div>
                {profile.founder_track && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${TRACK_BADGES[profile.founder_track] || 'bg-gray-100 text-gray-600'}`}>
                    {profile.founder_track}
                  </span>
                )}
              </div>

              {profile.founder_track === 'Strategic Scale (Existing)' ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500">Current Stage</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.current_stage || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Partnership Goal</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.partnership_goal || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Existing Jurisdiction</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.existing_jurisdiction || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Product Strategy</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.product_strategy || '—'}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-gray-500">Existing Investors / Cap Table</div>
                    <div className="text-gray-900 font-medium dark:text-gray-100">{profile.existing_investors || '—'}</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className={`text-sm font-medium ${
                    profile.company_established === 0 ? 'text-amber-800'
                    : profile.company_established === 1 ? 'text-emerald-800'
                    : 'text-gray-600'
                  }`}>
                    {profile.company_established === 1
                      ? 'Company already incorporated'
                      : profile.company_established === 0
                      ? 'Not yet incorporated — Axal VC will handle formation'
                      : 'Formation status not answered'}
                  </div>
                  {profile.existing_jurisdiction && (
                    <div className="text-xs text-gray-600 mt-1">Preferred jurisdiction: <span className="font-medium text-gray-900 dark:text-gray-100">{profile.existing_jurisdiction}</span></div>
                  )}
                  {profile.company_established === 0 && (
                    <p className="text-xs text-amber-700 mt-2">This founder has not yet incorporated. The Axal VC 30-Day Spin-Out Engine will handle formation as part of their Closing Binder.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {extracted.summary && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
              <div className="text-xs text-violet-700 font-semibold mb-1">AI Summary</div>
              <div className="text-sm text-violet-900">{extracted.summary}</div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={14} className="text-gray-600" />
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Onboarding Conversation</h4>
              {profile.user_id && (
                <span className={`ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  wsStatus === 'open' ? 'bg-emerald-100 text-emerald-700'
                  : wsStatus === 'connecting' ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'open' ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                  {wsStatus === 'open' ? 'live' : wsStatus === 'connecting' ? 'connecting' : 'offline'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto space-y-2 dark:border-gray-800">
              {chatMessages.length === 0 ? (
                <div className="text-xs text-gray-500">No transcript available.</div>
              ) : chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] text-xs px-3 py-2 rounded-lg whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
                  }`}>{m.content}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4 space-y-3 dark:border-gray-800">
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1 dark:text-gray-300">Propose Closing Binder / Agreement</label>
              <div className="relative">
                <select value={agreement} onChange={(e) => setAgreement(e.target.value)}
                  className="w-full appearance-none bg-white border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100">
                  {AGREEMENT_OPTIONS.map((opt, i) => (
                    opt.group ? (
                      <optgroup key={opt.group} label={opt.group}>
                        {opt.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                    ) : (
                      <option key={opt.value || `placeholder-${i}`} value={opt.value}>{opt.label}</option>
                    )
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1 dark:text-gray-300">Admin Notes (internal)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Any context for the legal engine or follow-up..."
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none resize-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100" />
            </div>
            {/* Task #2 — DocuSign provider picker. Renders for Studio-tier
                admins (or impersonating super-admins) when an active
                DocuSign integration is connected; on non-Studio plans we
                show an upsell row instead. */}
            {docusignAvailable ? (
              <label className="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer dark:text-gray-300">
                <input type="checkbox" checked={viaDocusign} onChange={(e) => setViaDocusign(e.target.checked)}
                  className="mt-0.5 accent-amber-600" />
                <span>
                  <span className="font-semibold text-amber-900">Send via DocuSign</span>
                  <span className="block text-amber-800 mt-0.5">
                    Routes the envelope through the connected DocuSign account. The signer receives the agreement directly from DocuSign; signed PDFs are pulled back into Axal VC automatically.
                  </span>
                </span>
              </label>
            ) : (
              <div className="flex items-start gap-2 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 dark:border-gray-800">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Send via DocuSign</span>
                <span className="ml-auto text-gray-500">
                  {docusignReason === 'checking' ? 'Checking…'
                    : docusignReason === 'not_connected' ? <>Not connected — <a href="/integrations" className="underline">connect DocuSign</a></>
                    : 'Unavailable'}
                </span>
              </div>
            )}
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            {esignFlash && (
              <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 space-y-1">
                <div className="font-semibold text-emerald-800 flex items-center gap-1.5">
                  <Check size={12} />
                  {esignFlash.provider === 'docusign'
                    ? <>DocuSign envelope sent (#{esignFlash.envelopeId})</>
                    : <>eSignature envelope #{esignFlash.envelopeId} created</>}
                </div>
                <div className="text-emerald-700">
                  {esignFlash.provider === 'docusign'
                    ? <>DocuSign emailed the agreement directly to <span className="font-mono">{profile.email}</span>. Status updates flow back into Axal VC automatically.</>
                    : esignFlash.emailSent
                      ? <>Email sent from <span className="font-mono">deal@axal.vc</span> to <span className="font-mono">{profile.email}</span>.</>
                      : <>Envelope created — email delivery did not confirm. Share this link manually:</>}
                </div>
                {esignFlash.provider !== 'docusign' && !esignFlash.emailSent && esignFlash.signingUrl && (
                  <a href={esignFlash.signingUrl} target="_blank" rel="noreferrer" className="text-violet-700 underline break-all">
                    {esignFlash.signingUrl}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-2 dark:border-gray-800">
          <button onClick={() => submit('rejected')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50 transition-colors">
            Reject
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors dark:text-gray-300">Cancel</button>
            <button onClick={() => submit('verified')} disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1.5">
              <Check size={14} /> {saving ? 'Saving...' : 'Verify & Assign Agreement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-gray-900 break-words dark:text-gray-100">{value || '—'}</div>
    </div>
  );
}

// ===== Admin Contracts Management ======================================
const STATUS_PILL = {
  draft:     { label: 'DRAFT',     cls: 'bg-gray-100 text-gray-700' },
  generated: { label: 'GENERATED', cls: 'bg-sky-100 text-sky-700' },
  sent:      { label: 'PENDING',   cls: 'bg-amber-100 text-amber-700' },
  signed:    { label: 'SIGNED',    cls: 'bg-emerald-100 text-emerald-700' },
  void:      { label: 'VOID',      cls: 'bg-slate-200 text-slate-600' },
};

function StatusPill({ status }) {
  const s = STATUS_PILL[status] || STATUS_PILL.draft;
  return (
    <span className={`text-[10px] font-bold tracking-wide px-2.5 py-1 rounded-full ${s.cls}`}>{s.label}</span>
  );
}

function fmtDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// Task #5 (Z) — Friendly labels for the 15 new doc_types W/X/Y emit.
// Used as a fallback if the backend omits `doc_type_label`. Must stay
// in sync with `TEMPLATES` in cloudflare-worker/src/routes/admin_contracts.ts.
const NEW_DOC_TYPE_LABELS = {
  investor_nda_axal: 'Investor NDA (Axal VC)',
  mentor_nda_axal: 'Mentor NDA (Axal VC)',
  mentor_engagement_disclaimer: 'Mentor Engagement Disclaimer',
  partner_nda_nonsolicit: 'Partner NDA + Non-Solicit',
  partner_equity: 'Partner Equity Deal',
  partner_services: 'Partner Services Agreement',
  partner_revshare: 'Partner Revenue-Share Deal',
  partner_capital: 'Partner Capital Deal',
  partner_custom: 'Partner Custom Deal',
  finders_fee_intro_agreement: "Finder's Fee / Intro Agreement",
  nda_3way_founder_investor_axal: '3-Way NDA (Founder ↔ Investor ↔ Axal VC)',
  ip_background_schedule: 'IP Background Schedule',
  data_access_acknowledgment_admin: 'Data Access Acknowledgment (Admin)',
  investor_subscription_pro: 'Investor Subscription — Pro',
  investor_subscription_inst: 'Investor Subscription — Institutional',
};
const PARTY_ROLE_OPTIONS = [
  ['', 'All parties'],
  ['founder', 'Founder'],
  ['investor', 'Investor'],
  ['mentor', 'Mentor'],
  ['partner', 'Partner'],
  ['axal', 'Axal VC'],
];

export function LegalPanel() {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [pairwise, setPairwise] = useState([]);
  const [partnerDeals, setPartnerDeals] = useState([]);
  const [partnerDealsNote, setPartnerDealsNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState('all'); // all | pending | signed | voided | pairwise | partner | templates | forms | incorporation
  const [q, setQ] = useState('');
  const [docType, setDocType] = useState('');
  const [providerFilter, setProviderFilter] = useState(''); // '' | 'native' | 'docusign'
  const [partyRole, setPartyRole] = useState(''); // '' | founder | investor | mentor | partner | axal
  const [pwStatus, setPwStatus] = useState(''); // pairwise NDA status filter
  const [pwIntermediary, setPwIntermediary] = useState(''); // pairwise NDA relation/intermediary filter
  const [pdDealType, setPdDealType] = useState(''); // partner deal_type filter
  const [openContract, setOpenContract] = useState(null);
  const [showNewEnvelope, setShowNewEnvelope] = useState(false);
  const [openTplUsage, setOpenTplUsage] = useState(null); // { docType, fallback } — Task #8 usage chip

  const statusFilter = sub === 'pending' ? 'sent' : sub === 'signed' ? 'signed' : sub === 'voided' ? 'void' : '';
  const isListSub = sub === 'all' || sub === 'pending' || sub === 'signed' || sub === 'voided';

  const reload = async () => {
    setLoading(true);
    try {
      // Task #8 — the Templates sub-tab now self-loads from the store via
      // <AdminTemplates>, so it is no longer fetched here.
      const [s, list, , pw, pd] = await Promise.all([
        api.adminContractStats().catch(() => null),
        isListSub ? api.adminListContracts({ status: statusFilter, doc_type: docType, provider: providerFilter, party_role: partyRole, q, limit: 200 }) : Promise.resolve({ items: [] }),
        Promise.resolve(null),
        sub === 'pairwise' ? api.adminListPairwiseNdas({ status: pwStatus, intermediary: pwIntermediary }).catch(() => ({ items: [] })) : Promise.resolve(null),
        sub === 'partner' ? api.adminListPartnerDeals({ deal_type: pdDealType }).catch(() => ({ items: [], note: 'Failed to load.' })) : Promise.resolve(null),
      ]);
      setStats(s);
      setItems(list?.items || []);
      if (pw) setPairwise(pw.items || []);
      if (pd) { setPartnerDeals(pd.items || []); setPartnerDealsNote(pd.note || ''); }
    } catch (e) {
      reportError('AdminPage:loadContracts', e);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [sub, statusFilter, docType, providerFilter, partyRole, pwStatus, pwIntermediary, pdDealType]);

  const onSearch = (e) => { e.preventDefault(); reload(); };

  const docTypeOptions = Array.from(new Set([
    ...(stats?.by_type || []).map(t => t.type),
  ])).sort();

  return (
    <div>
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <KpiTile label="Total"               value={stats?.total ?? '—'} />
        <KpiTile label="Pending Signature"   value={stats?.pending_signature ?? '—'} accent="amber" />
        <KpiTile label="Signed"              value={stats?.by_status?.signed ?? '—'} accent="emerald" />
        <KpiTile label="Avg Days to Sign"    value={stats?.avg_days_to_sign ?? '—'} />
        <KpiTile label="Signed Last 30d"     value={stats?.signed_last_30d ?? '—'} />
      </div>

      {/* Task #2 — Admin "All Contracts" reads from BOTH the legacy
          `documents` table AND the modern `esign_envelopes` table. The
          banner below explains the union view; rows are tagged with their
          source in `ContractRow` so admins can see which backing store
          a row came from while the migration is in flight. */}
      <div className="bg-violet-50 border border-violet-200 text-violet-900 text-xs rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
        <FileText size={14} className="mt-0.5 flex-shrink-0 text-violet-600" />
        <div>
          <span className="font-semibold">Unified contracts view.</span> This list shows agreements from both the legacy
          documents store and the e-sign envelope store (the system used for new sends). Resend, void, and download
          actions are dispatched to the correct backing store automatically.
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          ['all',           'All Contracts'],
          ['pending',       'Sent / Pending'],
          ['signed',        'Signed'],
          ['voided',        'Voided'],
          ['pairwise',      'Pairwise NDAs'],
          ['partner',       'Partner Deals'],
          ['templates',     'Templates'],
          ['forms',         'Forms'],
          ['incorporation', 'Incorporation'],
        ].map(([k, label]) => (
          <button key={k} data-testid={`legal-sub-${k}`} onClick={() => setSub(k)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${sub === k ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-violet-300'}`}>
            {label}
          </button>
        ))}
        <button onClick={() => setShowNewEnvelope(true)} className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1">
          <Send size={12} /> New envelope
        </button>
        <button onClick={reload} className="text-xs text-gray-500 hover:text-violet-600 flex items-center gap-1">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Filters (only on the contract-list sub-tabs) */}
      {isListSub && (
        <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search title, recipient, project, template…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 dark:border-gray-800" />
          </div>
          <select value={docType} onChange={e => setDocType(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white dark:border-gray-800 dark:bg-gray-900">
            <option value="">All types</option>
            {docTypeOptions.map(t => <option key={t} value={t}>{NEW_DOC_TYPE_LABELS[t] || t}</option>)}
          </select>
          {/* Task #5 (Z) — party-role filter chip set. */}
          <select value={partyRole} onChange={e => setPartyRole(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white dark:border-gray-800 dark:bg-gray-900"
            title="Filter by which party the contract touches">
            {PARTY_ROLE_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
          {/* Task #2 — provider filter chip. Lets admins separate
              DocuSign-routed envelopes from in-house ones at a glance. */}
          <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden text-xs dark:border-gray-800 dark:bg-gray-900">
            {[['', 'All'], ['native', 'Native'], ['docusign', 'DocuSign']].map(([k, lbl]) => (
              <button
                key={k || 'all'}
                type="button"
                onClick={() => setProviderFilter(k)}
                className={`px-3 py-2 font-medium border-l first:border-l-0 border-gray-200 ${providerFilter === k ? 'bg-violet-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <button type="submit" className="px-3 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium">Search</button>
        </form>
      )}

      {loading ? (
        <div className="text-center text-gray-500 py-12 text-sm">Loading…</div>
      ) : sub === 'templates' ? (
        <AdminTemplates onOpenUsage={(docType, fallback) => setOpenTplUsage({ docType, fallback })} />
      ) : sub === 'pairwise' ? (
        <PairwiseNdasTable rows={pairwise} statusFilter={pwStatus} onStatusFilter={setPwStatus}
          intermediaryFilter={pwIntermediary} onIntermediaryFilter={setPwIntermediary}
          onOpen={(uid) => uid && setOpenContract({ uid })} />
      ) : sub === 'partner' ? (
        <PartnerDealsTable rows={partnerDeals} note={partnerDealsNote} dealTypeFilter={pdDealType} onDealTypeFilter={setPdDealType} />
      ) : sub === 'forms' ? (
        <AdminForms />
      ) : sub === 'incorporation' ? (
        <div data-testid="legal-incorporation-placeholder" className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          Incorporation packets will appear here soon.
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          {sub === 'pending' && 'No contracts are currently awaiting signature. New sends will appear here within a few seconds.'}
          {sub === 'signed' && 'No signed contracts yet. Once a recipient completes signing, the contract will appear here with its signed-at timestamp.'}
          {sub === 'voided' && 'No voided contracts. When you void a sent contract its row appears here with the recorded reason.'}
          {sub === 'all' && 'No contracts found. Send your first agreement from the Profiles tab to get started.'}
          {sub !== 'pending' && sub !== 'signed' && sub !== 'voided' && sub !== 'all' && 'No contracts found for this filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(c => <ContractRow key={c.uid} c={c} onOpen={() => setOpenContract(c)} />)}
        </div>
      )}

      {openContract && (
        sub === 'signed' && openContract.source === 'esign' ? (
          <SignedDocLightbox
            uid={openContract.uid}
            onClose={() => setOpenContract(null)}
            onChanged={(opts) => {
              if (!opts || !opts.keepOpen) setOpenContract(null);
              reload();
            }}
          />
        ) : (
          <ContractDetailModal
            uid={openContract.uid}
            onClose={() => setOpenContract(null)}
            onChanged={(opts) => {
              if (!opts || !opts.keepOpen) setOpenContract(null);
              reload();
            }}
          />
        )
      )}

      {showNewEnvelope && (
        <NewEnvelopeWizard onClose={() => setShowNewEnvelope(false)} onSent={() => { setShowNewEnvelope(false); reload(); }} />
      )}

      {openTplUsage && (
        <TemplateUsageModal
          docType={openTplUsage.docType}
          fallback={openTplUsage.fallback}
          onClose={() => setOpenTplUsage(null)}
        />
      )}
    </div>
  );
}

// Task #5 (Z) — Pairwise NDAs tab. Lists every founder ↔ investor NDA
// pair from `pairwise_ndas`, joined to user emails on both sides.
// Clicking the envelope link opens the existing ContractDetailModal.
function PairwiseNdasTable({ rows, statusFilter, onStatusFilter, intermediaryFilter, onIntermediaryFilter, onOpen }) {
  const STATUS_OPTIONS = [
    ['', 'All statuses'],
    ['pending', 'Pending'],
    ['partially_signed', 'Partially signed'],
    ['active', 'Active'],
    ['expired', 'Expired'],
    ['revoked', 'Revoked'],
  ];
  const RELATION_OPTIONS = [
    ['', 'All relations'],
    ['axal', 'Via Axal VC'],
    ['direct', 'Direct'],
    ['partner', 'Via Partner'],
  ];
  const filterBar = (
    <div className="flex items-center gap-2 mb-2">
      <select value={statusFilter} onChange={e => onStatusFilter(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white dark:border-gray-800 dark:bg-gray-900">
        {STATUS_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
      </select>
      <select value={intermediaryFilter} onChange={e => onIntermediaryFilter(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white dark:border-gray-800 dark:bg-gray-900"
        title="Filter by intermediary / relation type">
        {RELATION_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
      </select>
    </div>
  );
  if (!rows || rows.length === 0) {
    return (
      <div>
        {filterBar}
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          No pairwise NDAs on record yet. Investor intro requests create a pair here once the founder accepts.
        </div>
      </div>
    );
  }
  const STATUS_PILLS = {
    pending: 'bg-amber-100 text-amber-700',
    partially_signed: 'bg-amber-100 text-amber-700',
    active: 'bg-emerald-100 text-emerald-700',
    expired: 'bg-gray-100 text-gray-600',
    revoked: 'bg-red-100 text-red-700',
  };
  return (
    <div>
      {filterBar}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Founder</th>
            <th className="text-left px-4 py-2.5 font-medium">Investor</th>
            <th className="text-center px-4 py-2.5 font-medium">Status</th>
            <th className="text-left px-4 py-2.5 font-medium">Valid Until</th>
            <th className="text-left px-4 py-2.5 font-medium">Last Activity</th>
            <th className="text-right px-4 py-2.5 font-medium">Envelope</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-3"><div className="text-gray-900 dark:text-gray-100">{r.party_a_name || '—'}</div><div className="text-xs text-gray-500">{r.party_a_email || `user #${r.party_a_user_id}`}</div></td>
              <td className="px-4 py-3"><div className="text-gray-900 dark:text-gray-100">{r.party_b_name || '—'}</div><div className="text-xs text-gray-500">{r.party_b_email || `user #${r.party_b_user_id}`}</div></td>
              <td className="px-4 py-3 text-center">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILLS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">{fmtDate(r.valid_until) || '—'}</td>
              <td className="px-4 py-3 text-xs text-gray-600">{fmtDate(r.updated_at)}</td>
              <td className="px-4 py-3 text-right">
                {r.envelope_uuid ? (
                  <button onClick={() => onOpen(r.envelope_uuid)} className="text-xs text-violet-700 hover:text-violet-900 font-medium">Open contract</button>
                ) : <span className="text-xs text-gray-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Task #5 (Z) — Partner Deals tab. The X-1 backend creates `partner_deals`
// rows; this surface lists them. Until X-1 lands the backend returns
// {items:[], note:"..."} which we render as a friendly empty state.
function PartnerDealsTable({ rows, note, dealTypeFilter, onDealTypeFilter }) {
  const DEAL_TYPE_OPTIONS = [
    ['', 'All deal types'],
    ['equity', 'Equity'],
    ['services', 'Services'],
    ['revshare', 'Rev-share'],
    ['capital', 'Capital'],
    ['custom', 'Custom'],
  ];
  const filterBar = (
    <div className="flex items-center gap-2 mb-2">
      <select value={dealTypeFilter} onChange={e => onDealTypeFilter(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white dark:border-gray-800 dark:bg-gray-900">
        {DEAL_TYPE_OPTIONS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
      </select>
    </div>
  );
  if (!rows || rows.length === 0) {
    return (
      <div>
        {filterBar}
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
          No partner deals on record yet.
          {note && <div className="mt-2 text-[11px] text-gray-400">{note}</div>}
        </div>
      </div>
    );
  }
  return (
    <div>
      {filterBar}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Partner</th>
            <th className="text-left px-4 py-2.5 font-medium">Deal Type</th>
            <th className="text-center px-4 py-2.5 font-medium">Term</th>
            <th className="text-left px-4 py-2.5 font-medium">Granted Tiers</th>
            <th className="text-center px-4 py-2.5 font-medium">Redemptions</th>
            <th className="text-center px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-3"><div className="text-gray-900 dark:text-gray-100">{r.partner_name || '—'}</div><div className="text-xs text-gray-500">{r.partner_email}</div></td>
              <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.deal_type}</td>
              <td className="px-4 py-3 text-center text-gray-600">{r.term_months ? `${r.term_months}mo` : '—'}</td>
              <td className="px-4 py-3 text-xs text-gray-600">{r.granted_tiers || '—'}</td>
              <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{r.redemption_count ?? 0}</td>
              <td className="px-4 py-3 text-center"><span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:text-gray-300">{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Task #5 (Z) — Admin "Create envelope" wizard.
// Picks one of the legal templates from /admin/contracts/templates/legal,
// collects recipient + (optional) deal_id, and POSTs to the existing
// /api/legal/esign/send route which mints + emails the envelope.
function NewEnvelopeWizard({ onClose, onSent }) {
  useEscapeClose(onClose);
  const [templates, setTemplates] = useState([]);
  const [docType, setDocType] = useState('');
  // Task #5 (Z) — full create flow per spec: support N recipients
  // (one row per pair of email + optional name) + a merge-field
  // editor. Each row is sent as its own envelope to /api/legal/esign/send
  // since the route is single-recipient today.
  const [recipients, setRecipients] = useState([{ email: '', name: '' }]);
  const [mergeFieldsRaw, setMergeFieldsRaw] = useState('');
  const [dealId, setDealId] = useState('');
  const [provider, setProvider] = useState('native');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(null);
  // Templates endpoint is worker-only (`/admin/contracts/templates/legal`).
  // The dev FastAPI backend doesn't host it, so the catalog fetch 404s
  // there. We track that case separately so the modal shows a calm
  // "unavailable in this environment" message rather than a scary
  // "Not found" red banner above an empty dropdown.
  const [templatesUnavailable, setTemplatesUnavailable] = useState(false);

  useEffect(() => {
    api.adminListLegalTemplates()
      .then(r => { setTemplates(r.items || []); if (r.items?.[0]) setDocType(r.items[0].doc_type); })
      .catch(e => {
        if (e?.status === 404) {
          setTemplatesUnavailable(true);
        } else {
          setErr(e.message);
        }
      });
  }, []);

  const updateRecipient = (idx, patch) => {
    setRecipients(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };
  const addRecipient = () => setRecipients(rs => [...rs, { email: '', name: '' }]);
  const removeRecipient = (idx) => setRecipients(rs => rs.length === 1 ? rs : rs.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!docType) { setErr('Template is required.'); return; }
    const cleaned = recipients
      .map(r => ({ email: r.email.trim().toLowerCase(), name: r.name.trim() }))
      .filter(r => r.email);
    if (cleaned.length === 0) { setErr('At least one recipient email is required.'); return; }
    let mergeFields;
    if (mergeFieldsRaw.trim()) {
      try { mergeFields = JSON.parse(mergeFieldsRaw); }
      catch { setErr('Merge fields must be valid JSON (e.g. {"company_name":"Axal VC"}).'); return; }
    }
    setBusy(true);
    setProgress({ done: 0, total: cleaned.length });
    try {
      for (let i = 0; i < cleaned.length; i++) {
        const r = cleaned[i];
        await api.adminSendEnvelope({
          document_type: docType,
          recipient_email: r.email,
          recipient_name: r.name || undefined,
          deal_id: dealId ? Number(dealId) : undefined,
          merge_fields: mergeFields,
          provider,
        });
        setProgress({ done: i + 1, total: cleaned.length });
      }
      onSent();
    } catch (ex) {
      setErr(`After ${progress?.done ?? 0}/${cleaned.length} envelopes: ${ex.message}`);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col dark:bg-gray-900">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between dark:border-gray-800">
          <div className="flex items-center gap-2"><Send size={16} className="text-emerald-600" /><h3 className="font-semibold text-gray-900 dark:text-gray-100">New envelope (admin)</h3></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-3 overflow-y-auto">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{err}</div>}
          {templatesUnavailable && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2 rounded">
              The legal template catalog isn't available in this environment. Envelope creation runs against the production worker — try again from the deployed app.
            </div>
          )}
          {progress && busy && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs p-2 rounded">Sending… {progress.done} / {progress.total}</div>}
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Template</span>
            <select value={docType} onChange={e => setDocType(e.target.value)} required
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white dark:border-gray-800 dark:bg-gray-900">
              {templates.length === 0 && (
                <option value="">{templatesUnavailable ? 'Unavailable in this environment' : 'Loading…'}</option>
              )}
              {templates.map(t => <option key={t.key} value={t.doc_type}>{t.title}</option>)}
            </select>
          </label>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Recipients ({recipients.length})</span>
              <button type="button" onClick={addRecipient} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium">+ Add recipient</button>
            </div>
            <div className="space-y-2">
              {recipients.map((r, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input type="email" required={idx === 0} value={r.email} onChange={e => updateRecipient(idx, { email: e.target.value })}
                    placeholder="recipient@example.com"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
                  <input value={r.name} onChange={e => updateRecipient(idx, { name: e.target.value })}
                    placeholder="Name (optional)"
                    className="w-40 px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
                  {recipients.length > 1 && (
                    <button type="button" onClick={() => removeRecipient(idx)} className="text-gray-400 hover:text-red-600" title="Remove"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">Each recipient receives their own envelope with the same template.</p>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Merge fields (optional, JSON)</span>
            <textarea value={mergeFieldsRaw} onChange={e => setMergeFieldsRaw(e.target.value)} rows={3}
              placeholder='{"company_name":"Acme Inc","effective_date":"2026-05-10"}'
              className="mt-1 w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg dark:border-gray-800" />
            <span className="text-[10px] text-gray-500">Forwarded to the e-sign send route as <code>merge_fields</code> for template substitution.</span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Linked deal_id (optional)</span>
            <input type="number" value={dealId} onChange={e => setDealId(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Provider</span>
            <select value={provider} onChange={e => setProvider(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white dark:border-gray-800 dark:bg-gray-900">
              <option value="native">Native (in-app signing)</option>
              <option value="docusign">DocuSign (Studio tier)</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-800">Cancel</button>
            <button type="submit" disabled={busy} className="px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg flex items-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send {recipients.filter(r => r.email).length || 0} envelope(s)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function KpiTile({ label, value, accent }) {
  const accentCls = accent === 'amber' ? 'text-amber-700'
                  : accent === 'emerald' ? 'text-emerald-700'
                  : 'text-gray-900';
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${accentCls}`}>{value}</div>
    </div>
  );
}

function ContractRow({ c, onOpen }) {
  return (
    <button onClick={onOpen}
      className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-violet-300 hover:shadow-sm transition-all dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 truncate dark:text-gray-100">{c.title}</div>
          <div className="text-xs text-gray-600 mt-0.5">
            Recipient · <span className="text-gray-800 dark:text-gray-200">{c.recipient_email || '—'}</span>
            {c.project_name && <> · Project · <span className="text-gray-800 dark:text-gray-200">{c.project_name}</span></>}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-gray-500 mt-1.5">
            <span>Created: {fmtDate(c.created_at) || '—'}</span>
            <span>Signed: {fmtDate(c.signed_at) || '—'}</span>
            {c.days_to_sign != null && <span>Days to sign: <span className="text-gray-700 font-medium dark:text-gray-300">{c.days_to_sign}</span></span>}
          </div>
          {/* Task #45 — surface the recorded void reason directly on the row
              so admins scanning the Voided sub-tab don't have to open the
              detail modal for each row. Truncated to 60 chars with the full
              text in a hover tooltip; full text also still appears in the
              detail modal (Task #19). */}
          {c.status === 'void' && c.void_reason && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11px]" title={c.void_reason}>
              <Ban size={11} className="text-red-600 mt-0.5 flex-shrink-0" />
              <span className="text-red-700 font-medium">Reason:</span>
              <span className="text-red-900 truncate">
                {c.void_reason.length > 60 ? `${c.void_reason.slice(0, 60)}…` : c.void_reason}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {c.source === 'esign' && c.provider !== 'docusign' && (
            <span title="Stored in esign_envelopes (modern e-sign flow)"
              className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
              eSign
            </span>
          )}
          {c.provider === 'docusign' && (
            <span title="Routed through DocuSign — recipient signs in DocuSign's UI."
              className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
              DocuSign
            </span>
          )}
          <StatusPill status={c.status} />
        </div>
      </div>
    </button>
  );
}

// Detail modal for a single template card. Lists every contract/envelope
// that has used this template across the 4-source union, with a small
// stats header (total/sent/signed/voided/avg-days-to-sign). Each row is
// clickable and opens the existing ContractDetailModal so admins can
// drill all the way through (resend / void / download / share-link)
// without leaving the modal stack.
function TemplateUsageModal({ docType, fallback, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [openContract, setOpenContract] = useState(null);
  // Modal-stack guard: when the inner ContractDetailModal is mounted,
  // backdrop clicks and Escape must close ONLY the inner modal, not
  // collapse the entire stack. Both events bubble to window/document
  // (Escape) and to the outer overlay div (click), so we no-op the
  // outer close handler whenever a child modal is open.
  useEscapeClose(openContract ? () => {} : onClose);

  const reload = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api.adminContractTemplateUsage(docType, { limit: 200 });
      setData(r);
    } catch (e) {
      setErr(e.message || 'Failed to load template usage.');
      reportError('TemplateUsageModal:load', e);
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docType]);

  const tpl = data?.template || { title: fallback?.title, layer_label: fallback?.layer_label, doc_type: docType, key: docType };
  const stats = data?.stats;
  const items = data?.items || [];

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={() => { if (!openContract) onClose(); }}>
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[88vh] overflow-hidden flex flex-col dark:bg-gray-900">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={16} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{tpl.title}</h3>
              <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                {stats ? `${stats.total} use${stats.total === 1 ? '' : 's'}` : '…'}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {tpl.layer_label}
              <span className="font-mono text-gray-400 ml-2">{tpl.doc_type}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{err}</div>}

          {/* Stats header */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <StatBox label="Pending" value={stats.pending_signature} accent="amber" />
              <StatBox label="Signed" value={stats.by_status.signed} accent="emerald" />
              <StatBox label="Voided" value={stats.by_status.void} accent="rose" />
              <StatBox label="Signed (30d)" value={stats.signed_last_30d} accent="violet" />
              <StatBox label="Avg days to sign" value={stats.avg_days_to_sign ?? '—'} accent="slate" />
            </div>
          )}

          {/* Usage list */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Envelopes using this template
              {stats?.last_used_at && (
                <span className="ml-2 normal-case font-normal text-gray-400">
                  · last used {fmtDate(stats.last_used_at)}
                </span>
              )}
            </div>
            {loading ? (
              <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">Loading…</div>
            ) : items.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-800">
                This template hasn't been used yet. Send your first envelope from the Profiles tab.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-xl dark:border-gray-800">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Recipient</th>
                      <th className="text-left px-3 py-2 font-medium">Project</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Sent</th>
                      <th className="text-left px-3 py-2 font-medium">Signed</th>
                      <th className="text-left px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map(c => (
                      <tr key={c.uid} className="hover:bg-violet-50/40 cursor-pointer" onClick={() => setOpenContract(c)}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 truncate max-w-[200px] dark:text-gray-100" title={c.recipient_email || '—'}>
                            {c.recipient_email || c.signed_by || '—'}
                          </div>
                          {c.title && c.title !== c.recipient_email && (
                            <div className="text-[10px] text-gray-500 truncate max-w-[200px]" title={c.title}>{c.title}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 truncate max-w-[160px]">{c.project_name || '—'}</td>
                        <td className="px-3 py-2"><StatusPill status={c.status} /></td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(c.created_at) || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {c.signed_at ? (
                            <span title={c.signed_by || ''}>
                              {fmtDate(c.signed_at)}
                              {c.signed_by && <div className="text-[10px] text-gray-500 truncate max-w-[140px]">by {c.signed_by}</div>}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-mono">{c.source}</span>
                          {c.provider === 'docusign' && (
                            <span className="ml-1 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">DocuSign</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="text-violet-700 hover:text-violet-900 font-medium">Open →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {openContract && (
        <ContractDetailModal
          uid={openContract.uid}
          onClose={() => setOpenContract(null)}
          onChanged={(opts) => {
            reload();
            if (!opts || !opts.keepOpen) setOpenContract(null);
          }}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, accent = 'slate' }) {
  const colors = {
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-800',
    violet: 'bg-violet-50 border-violet-200 text-violet-800',
    slate: 'bg-gray-50 border-gray-200 text-gray-800',
  }[accent] || 'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div className={`border rounded-lg px-3 py-2 ${colors}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-75">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}

function ContractDetailModal({ uid, onClose, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Task #5 (Z) — void now requires a recorded reason; the modal opens
  // a small confirmation sheet to capture it before the API call.
  const [showVoidReason, setShowVoidReason] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.adminGetContract(uid);
        if (!cancelled) setDoc(d);
      } catch (e) { if (!cancelled) setErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const doResend = async () => {
    if (!confirm('Resend this contract to the recipient?')) return;
    setBusy(true); setErr('');
    try { await api.adminResendContract(uid); onChanged(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const submitVoid = async () => {
    if (voidReason.trim().length < 5) { setErr('Reason must be at least 5 characters.'); return; }
    setBusy(true); setErr('');
    try {
      // Task #19 — keep the modal open after voiding so the recorded
      // reason is surfaced inline. The list behind it still refreshes
      // so the row's status pill flips to VOID immediately.
      await api.adminVoidContractWithReason(uid, voidReason.trim());
      const refreshed = await api.adminGetContract(uid).catch(() => null);
      if (refreshed) setDoc(refreshed);
      setShowVoidReason(false);
      setVoidReason('');
      setBusy(false);
      if (typeof onChanged === 'function') onChanged({ keepOpen: true });
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const doDownload = () => {
    const url = api.adminDownloadContractUrl(uid);
    const token = localStorage.getItem('token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob().then(b => ({ b, ct: r.headers.get('Content-Disposition') })))
      .then(({ b, ct }) => {
        const m = (ct || '').match(/filename="([^"]+)"/);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = m ? m[1] : `contract_${uid.slice(0, 8)}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      })
      .catch(e => setErr(e.message));
  };
  const doShareLink = async () => {
    setErr('');
    try {
      const { url, expires_in } = await api.adminIssueContractShareLink(uid, 600);
      const fullUrl = window.location.origin + url;
      try { await navigator.clipboard.writeText(fullUrl); } catch {}
      alert(`Share link copied to clipboard.\nValid for ${Math.round(expires_in / 60)} minutes:\n\n${fullUrl}`);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col dark:bg-gray-900">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={16} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{doc?.title || 'Contract'}</h3>
              {doc && <StatusPill status={doc.status} />}
            </div>
            <div className="text-xs text-gray-500">
              {doc?.doc_type_label || NEW_DOC_TYPE_LABELS[doc?.doc_type] || doc?.doc_type}
              {doc?.template_name ? ` · ${doc.template_name}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{err}</div>}
          {!doc ? (
            <div className="text-center text-gray-500 text-sm py-8">Loading…</div>
          ) : (
            <>
              {/* Task #19 — surface the recorded void reason whenever the
                  contract is in a void state. Server reads the latest
                  `contract_voided` entry from activity_logs, so this also
                  shows for contracts voided in earlier sessions. */}
              {doc.status === 'void' && doc.void_reason && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1">
                    <Ban size={11} /> Voided{doc.voided_at ? ` · ${fmtDate(doc.voided_at)}` : ''}
                  </div>
                  <div className="text-xs text-red-900 whitespace-pre-wrap break-words">{doc.void_reason}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Recipient"   value={doc.recipient_email} />
                <Field label="Project"     value={doc.project_name} />
                <Field label="Signed by"   value={doc.signed_by} />
                <Field label="Signed at"   value={fmtDate(doc.signed_at)} />
                <Field label="Created"     value={fmtDate(doc.created_at)} />
                <Field label="Days to sign" value={doc.days_to_sign != null ? String(doc.days_to_sign) : '—'} />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Content</div>
                {/* Security #8: body is no longer inlined. Use the
                    Download button in the footer (which streams via the
                    short-lived signed URL) to view the file. */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-[11px] text-gray-500 dark:border-gray-800">
                  Body lives in object storage. Use <span className="font-semibold text-gray-700 dark:text-gray-300">Download</span> below to retrieve it via a short-lived link.
                  {doc.file_size != null && <span className="block mt-1 text-gray-400">{(doc.file_size / 1024).toFixed(1)} KB · sha256 admin-only</span>}
                </div>
              </div>
            </>
          )}
        </div>

        {doc && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex flex-wrap gap-2 justify-end dark:border-gray-800">
            {/* Task #3 — pairwise NDAs and partner deals are union rows
                with no signed-PDF artefact and no single recipient/
                signing token. The backend returns deterministic 4xx for
                download/resend/void on those sources, so we hide those
                buttons here to avoid a confusing toast-on-click. */}
            {(!doc.source || doc.source === 'documents' || doc.source === 'esign') && (
              <>
                <button onClick={doDownload} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:border-violet-300 flex items-center gap-1.5 dark:bg-gray-900 dark:border-gray-800">
                  <Download size={13} /> Download
                </button>
                <button onClick={doShareLink} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:border-violet-300 flex items-center gap-1.5 dark:bg-gray-900 dark:border-gray-800" title="Generates a 10-minute signed link">
                  <Send size={13} /> Share link
                </button>
              </>
            )}
            {(doc.source === 'pairwise_nda' || doc.source === 'partner_deal') && (
              <div className="text-[11px] text-gray-500 italic mr-auto">
                {doc.source === 'pairwise_nda'
                  ? 'Pairwise NDA pair — manage from the Pairwise NDAs tab.'
                  : 'Partner deal — manage from the Partner Deals tab.'}
              </div>
            )}
            {/* Task #5 (Z) — Open in DD deep-link. Surfaces only when the
                worker has linked the envelope to dd_findings (column on
                migration 026). */}
            {doc.dd_case_uid && (
              <a href={`/admin/due-diligence/${doc.dd_case_uid}`}
                 className="px-3 py-2 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1.5"
                 title={`${doc.dd_findings_count || 0} related finding(s)`}>
                <ShieldAlert size={13} /> Open in DD ({doc.dd_findings_count || 0})
              </a>
            )}
            {/* Task #5 (Z) v2 — gate resend on the backend-supplied
                `can_resend` flag (which uses the raw envelope status,
                so partially-signed envelopes correctly do NOT show
                the button even though they collapse to `sent` in the
                unified status field). */}
            {doc.can_resend && (
              <button onClick={doResend} disabled={busy} className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:border-violet-300 flex items-center gap-1.5 dark:bg-gray-900 dark:border-gray-800">
                <Send size={13} /> Resend
              </button>
            )}
            {doc.status !== 'signed' && doc.status !== 'void' && doc.status !== 'completed'
              && doc.source !== 'pairwise_nda' && doc.source !== 'partner_deal' && (
              <button onClick={() => setShowVoidReason(true)} disabled={busy} className="px-3 py-2 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-1.5">
                <Ban size={13} /> Void
              </button>
            )}
          </div>
        )}
        {showVoidReason && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 dark:bg-gray-900">
              <div className="flex items-center gap-2 mb-3">
                <Ban size={16} className="text-red-600" />
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">Void contract</h4>
              </div>
              <p className="text-xs text-gray-600 mb-3">
                Voiding is irreversible — the recipient's signing link will stop working.
                Please record the reason for audit (≥ 5 characters). It will be written
                to <code className="text-[10px] bg-gray-100 px-1 rounded">activity_logs</code>
                and mirrored into <code className="text-[10px] bg-gray-100 px-1 rounded">dd_audit_log</code>
                if this contract is linked to a due-diligence finding.
              </p>
              <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)}
                rows={3} placeholder="e.g. Recipient never returned signature; new envelope sent under amended terms."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800" />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => { setShowVoidReason(false); setVoidReason(''); setErr(''); }}
                  className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-800">Cancel</button>
                <button onClick={submitVoid} disabled={busy || voidReason.trim().length < 5}
                  className="px-3 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg flex items-center gap-1.5">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Void contract
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Task #14 — Full-screen lightbox for signed eSign documents. PDF preview
// in an iframe + metadata/audit sidebar + "Forward to legal partner" action.
// Only opens from the Signed sub-tab when the source is 'esign'.
function SignedDocLightbox({ uid, onClose, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [forwards, setForwards] = useState([]);
  const [showForward, setShowForward] = useState(false);
  const [fwEmails, setFwEmails] = useState('');
  const [fwMessage, setFwMessage] = useState('');
  const [fwIncludeAudit, setFwIncludeAudit] = useState(true);
  const [fwBusy, setFwBusy] = useState(false);
  const [fwErr, setFwErr] = useState('');
  const { toast, showToast } = useToast(3000);
  const pdfUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.adminGetContract(uid);
        if (cancelled) return;
        setDoc(d);
        if (d?.id && d?.source === 'esign') {
          const blob = await api.adminDownloadEsignDocumentBlob(d.id);
          if (!cancelled) {
            const url = URL.createObjectURL(blob);
            pdfUrlRef.current = url;
            setPdfUrl(url);
          }
        }
      } catch (e) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => {
      cancelled = true;
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, [uid]);

  useEffect(() => {
    if (!doc || !doc.id || doc.source !== 'esign') return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.adminGetForwardLog(doc.id);
        if (!cancelled) setForwards(r.forwards || []);
      } catch (e) { if (!cancelled) reportError(e, 'forward-log'); }
    })();
    return () => { cancelled = true; };
  }, [doc]);

  const submitForward = async () => {
    const recipients = fwEmails.split(/[,\s]+/).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
    if (!recipients.length) { setFwErr('Enter at least one valid email address.'); return; }
    setFwBusy(true); setFwErr('');
    try {
      const r = await api.adminForwardContract(doc.id, {
        recipients,
        message: fwMessage.trim() || undefined,
        include_audit_page: fwIncludeAudit,
      });
      const failed = (r.results || []).filter(x => !x.ok);
      if (failed.length) {
        setFwErr(`${failed.length} of ${r.results.length} emails failed: ${failed.map(x => `${x.email} (${x.error})`).join(', ')}`);
      } else {
        showToast({ kind: 'ok', msg: `Forwarded to ${r.results.length} recipient(s).` });
        setShowForward(false);
        setFwEmails('');
        setFwMessage('');
        setFwIncludeAudit(true);
        const log = await api.adminGetForwardLog(doc.id);
        setForwards(log.forwards || []);
      }
    } catch (e) { setFwErr(e.message || 'Forward failed'); }
    finally { setFwBusy(false); }
  };

  useEscapeClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2" onClick={onClose}>
      {toast}
      <div onClick={e => e.stopPropagation()} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[96vw] h-[96vh] overflow-hidden flex flex-col dark:bg-gray-900">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-start justify-between gap-3 dark:border-gray-800 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={16} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{doc?.title || 'Signed Document'}</h3>
              {doc && <StatusPill status={doc.status} />}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {doc?.doc_type_label || NEW_DOC_TYPE_LABELS[doc?.doc_type] || doc?.doc_type}
              {doc?.template_name ? ` · ${doc.template_name}` : ''}
              {doc?.provider === 'docusign' && <span className="ml-1 text-amber-600 font-medium">(DocuSign)</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForward(true)}
              className="px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-lg flex items-center gap-1.5">
              <Send size={12} /> Forward
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>

        {/* Body: PDF + sidebar */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* PDF preview */}
          <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-950">
            {loading ? (
              <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">Loading PDF…</div>
            ) : err ? (
              <div className="h-full flex items-center justify-center text-red-500 text-sm px-6">{err}</div>
            ) : pdfUrl ? (
              <iframe src={pdfUrl} className="w-full h-full border-0" title="Signed PDF preview" />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">No PDF available.</div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-80 border-l border-gray-200 overflow-y-auto dark:border-gray-800 flex-shrink-0 bg-white dark:bg-gray-900">
            <div className="p-4 space-y-4">
              {doc && (
                <>
                  <div className="space-y-3">
                    <Field label="Recipient" value={doc.recipient_email} />
                    <Field label="Signed by" value={doc.signed_by} />
                    <Field label="Signed at" value={fmtDate(doc.signed_at)} />
                    <Field label="Days to sign" value={doc.days_to_sign != null ? String(doc.days_to_sign) : '—'} />
                    <Field label="Project" value={doc.project_name} />
                    <Field label="Created" value={fmtDate(doc.created_at)} />
                  </div>

                  {/* Forward log */}
                  {forwards.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Forward log</div>
                      <div className="space-y-2">
                        {forwards.map(f => (
                          <div key={f.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] dark:bg-gray-800 dark:border-gray-700">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-gray-700 font-medium dark:text-gray-300">{f.forwarded_to}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${f.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                {f.status}
                              </span>
                            </div>
                            <div className="text-gray-400 dark:text-gray-500 mt-0.5">{fmtDate(f.forwarded_at)}</div>
                            {f.include_audit_page === 0 && <div className="text-gray-500 dark:text-gray-400 mt-0.5">Audit page omitted</div>}
                            {f.message && <div className="text-gray-500 dark:text-gray-400 mt-0.5 italic truncate">&ldquo;{f.message}&rdquo;</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Forward sub-modal */}
        {showForward && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-10">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 dark:bg-gray-900">
              <div className="flex items-center gap-2 mb-3">
                <Send size={16} className="text-violet-600" />
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">Forward to legal partner</h4>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                The signed PDF will be emailed as an attachment. You can include a short note and choose whether to include the audit page.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Recipient emails (comma or space separated)</label>
                  <textarea
                    value={fwEmails}
                    onChange={e => setFwEmails(e.target.value)}
                    rows={2}
                    placeholder="partner@firm.com, counsel@firm.com"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Optional note</label>
                  <textarea
                    value={fwMessage}
                    onChange={e => setFwMessage(e.target.value)}
                    rows={2}
                    placeholder="Please review and advise on the governing-law clause."
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg dark:border-gray-800"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="fw-audit"
                    type="checkbox"
                    checked={fwIncludeAudit}
                    onChange={e => setFwIncludeAudit(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-700"
                  />
                  <label htmlFor="fw-audit" className="text-xs text-gray-700 dark:text-gray-300">Include audit/signature page</label>
                </div>
                {fwErr && <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{fwErr}</div>}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { setShowForward(false); setFwErr(''); }}
                  className="px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-800">Cancel</button>
                <button onClick={submitForward} disabled={fwBusy}
                  className="px-3 py-2 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-1.5">
                  {fwBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Task #7 — Integration Keys panel (admin-managed OAuth client_id /
// client_secret per provider). Sits alongside the existing tabs so a
// non-engineer admin can stand up Slack / HubSpot / Salesforce /
// DocuSign without redeploying the worker.
// ──────────────────────────────────────────────────────────────────

const PROVIDER_LABELS = {
  slack: 'Slack',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  docusign: 'DocuSign',
  linkedin: 'LinkedIn',
  calendly: 'Calendly',
  stripe: 'Stripe',
  carta: 'Carta',
  crunchbase: 'Crunchbase',
  affinity: 'Affinity',
  telegram: 'Telegram',
};
const PROVIDER_HINTS = {
  slack: 'Get Client ID + Client Secret from api.slack.com → your app → Basic Information.',
  hubspot: 'Get Client ID + Client Secret from your HubSpot Developer App → Auth tab.',
  salesforce: 'Get Consumer Key + Consumer Secret from Setup → App Manager → your Connected App.',
  docusign: 'Get Integration Key + Secret Key from DocuSign Admin → Apps and Keys.',
  linkedin: 'Get Client ID + Client Secret from linkedin.com/developers → your app → Auth tab.',
  calendly: 'Get Client ID + Client Secret from calendly.com → Integrations → OAuth applications.',
  stripe: 'Connect Client ID is the ca_… from Stripe Dashboard → Connect → Settings. Secret Key is the sk_live_… (or sk_test_…) from API keys.',
  carta: 'Get Client ID + Client Secret from your Carta Developer Portal app.',
  crunchbase: 'API key — paste a label (e.g. "default") into Client ID and the user_key into Secret. Provision the key at data.crunchbase.com.',
  affinity: 'API key — put your team subdomain (e.g. "acme") into Client ID and the Affinity API key into Secret. Generate at affinity.co → Settings → API.',
  telegram: 'Bot token — put the bot username (e.g. "axalvc_bot") into Client ID and the BotFather token into Secret. Get the token from @BotFather on Telegram.',
};
const PROVIDER_ENV_NAMES = {
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  hubspot: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
  salesforce: ['SF_CLIENT_ID', 'SF_CLIENT_SECRET'],
  docusign: ['DOCUSIGN_CLIENT_ID', 'DOCUSIGN_CLIENT_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  calendly: ['CALENDLY_CLIENT_ID', 'CALENDLY_CLIENT_SECRET'],
  stripe: ['STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY'],
  carta: ['CARTA_CLIENT_ID', 'CARTA_CLIENT_SECRET'],
  crunchbase: ['CRUNCHBASE_USER_KEY_ID', 'CRUNCHBASE_API_KEY'],
  affinity: ['AFFINITY_TEAM_DOMAIN', 'AFFINITY_API_KEY'],
  telegram: ['TELEGRAM_BOT_USERNAME', 'TELEGRAM_BOT_TOKEN'],
};

// Admin-managed Service Provider Directory approval (Task #53).
// Lists every partner with their current listed/featured flags and
// lets the admin flip either one. Featuring without listing is
// auto-corrected server-side because the public /directory route
// hides any row where listed=0.
function DirectoryPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const { toast, showToast } = useToast(3000);

  const load = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const r = await api.adminListDirectoryPartners(query);
      setRows(r.partners || []);
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to load partners' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (partner, patch) => {
    setBusyId(partner.id);
    try {
      const r = await api.adminSetPartnerDirectory(partner.id, patch);
      setRows((prev) => prev.map((p) => p.id === partner.id ? {
        ...p,
        directory_listed:   r.partner.listed   ? 1 : 0,
        directory_featured: r.partner.featured ? 1 : 0,
      } : p));
      const which = 'listed' in patch ? (r.partner.listed ? 'Approved for directory' : 'Removed from directory')
                                      : (r.partner.featured ? 'Featured' : 'Unfeatured');
      showToast({ kind: 'ok', msg: `${partner.name}: ${which}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const approvedCount = rows.filter(r => r.directory_listed).length;
  const featuredCount = rows.filter(r => r.directory_featured).length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Sparkles size={16} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Service Provider Directory</h3>
        <span className="text-xs text-gray-500">
          {approvedCount} approved · {featuredCount} featured · {rows.length} total
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search" value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(q); }}
              placeholder="Search name / company / email"
              className="pl-7 pr-2 py-1 text-xs border border-gray-300 rounded-md w-60 dark:border-gray-700"
            />
          </div>
          <button onClick={() => load(q)}
            className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 inline-flex items-center gap-1 dark:text-gray-300">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
        <strong>Approved</strong> partners appear on the public <code>/directory</code> page.
        <strong className="ml-2">Featured</strong> partners are promoted above standard rows
        (featured implies approved).
      </div>
      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm inline-flex items-center justify-center gap-2 w-full">
          <Loader2 size={14} className="animate-spin" /> Loading partners…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">No partners found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Partner</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Specialization</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Approved</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Featured</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const isListed = !!p.directory_listed;
                const isFeatured = !!p.directory_featured;
                const busy = busyId === p.id;
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                      <div className="text-xs text-gray-500">{p.company || '—'} · {p.email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs dark:text-gray-300">{p.specialization || <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isListed
                        ? <CheckCircle2 size={16} className="text-emerald-600 inline" />
                        : <XCircle size={16} className="text-gray-300 inline" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isFeatured
                        ? <Sparkles size={14} className="text-amber-500 inline" />
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => toggle(p, { listed: !isListed })}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            isListed
                              ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}>
                          {isListed ? 'Remove' : 'Approve'}
                        </button>
                        <button
                          disabled={busy || (!isListed && !isFeatured)}
                          title={!isListed ? 'Approve the partner first' : ''}
                          onClick={() => toggle(p, { featured: !isFeatured })}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-40 ${
                            isFeatured
                              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}>
                          {isFeatured ? 'Unfeature' : 'Feature'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-3 py-2 rounded-lg text-sm shadow-lg ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  );
}

// Task #9 — Promo Codes admin panel. Lists the D1 mirror and creates Stripe
// Coupons + Promotion Codes (percent / fixed; free-trial-days descoped). Each
// mutation hits a TOTP + step-up-gated endpoint; the global `request` helper
// auto-handles the 403 `step_up_required` challenge, so no extra wiring here.
// Task #11 — Billing admin: refunds (per-product policy + referral commission
// clawback), dispute evidence, and customer LTV. Each action is step-up gated
// server-side; the api `request` helper transparently handles the challenge.
function BillingPanel() {
  const { toast, showToast } = useToast(4000);
  const inputCls = 'rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 w-full';
  const cardCls = 'bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800';
  const headerCls = 'px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800';

  // --- Refund state ---
  const [refForm, setRefForm] = useState({ target: '', amount: '', reason: '', target_user_id: '', override: false });
  const [refBusy, setRefBusy] = useState(false);
  const [refResult, setRefResult] = useState(null);
  const setRef = (k, v) => setRefForm((f) => ({ ...f, [k]: v }));

  const issueRefund = async (e) => {
    e.preventDefault();
    if (refBusy) return;
    const target = refForm.target.trim();
    if (!target) { showToast({ kind: 'err', msg: 'Enter a PaymentIntent (pi_…) or Charge (ch_…) id' }); return; }
    setRefBusy(true);
    setRefResult(null);
    try {
      const body = {};
      if (target.startsWith('ch_')) body.charge = target; else body.payment_intent = target;
      if (refForm.amount) body.amount = Math.round(Number(refForm.amount) * 100);
      if (refForm.reason) body.reason = refForm.reason;
      if (refForm.target_user_id) body.target_user_id = Number(refForm.target_user_id);
      if (refForm.override) body.override_policy = true;
      const r = await api.adminBillingRefund(body);
      setRefResult(r);
      const claw = r.clawback?.outcome;
      const clawMsg = claw && claw !== 'no_commission' ? ` · clawback: ${claw}` : '';
      showToast({ kind: 'ok', msg: `Refund ${r.refund?.status || 'ok'}${clawMsg}` });
    } catch (err) {
      // Surface the structured policy block so the admin knows to override.
      const data = err?.data || {};
      if (data.code === 'refund_policy_blocked') {
        setRefResult({ blocked: true, ...data });
        showToast({ kind: 'err', msg: `Blocked by policy (${data.reason || data.kind}). Tick override to force.` });
      } else {
        showToast({ kind: 'err', msg: err.message || 'Refund failed' });
      }
    } finally {
      setRefBusy(false);
    }
  };

  // --- Disputes state ---
  const [disputes, setDisputes] = useState([]);
  const [dispLoading, setDispLoading] = useState(false);
  const [selDispute, setSelDispute] = useState(null);
  const [evidence, setEvidence] = useState({ uncategorized_text: '', product_description: '', customer_communication: '', refund_policy_disclosure: '', receipt: '' });
  const [evBusy, setEvBusy] = useState(false);
  const setEv = (k, v) => setEvidence((s) => ({ ...s, [k]: v }));

  const loadDisputes = useCallback(async () => {
    setDispLoading(true);
    try {
      const r = await api.adminBillingListDisputes(25);
      setDisputes(r.disputes || []);
    } catch (err) {
      showToast({ kind: 'err', msg: err.message || 'Failed to load disputes' });
    } finally {
      setDispLoading(false);
    }
  }, [showToast]);

  const submitEvidence = async (doSubmit) => {
    if (!selDispute || evBusy) return;
    const payload = {};
    Object.entries(evidence).forEach(([k, v]) => { if (v && String(v).trim()) payload[k] = String(v).trim(); });
    if (Object.keys(payload).length === 0) { showToast({ kind: 'err', msg: 'Add at least one evidence field' }); return; }
    if (doSubmit && !window.confirm('Submit evidence to Stripe? After submission it can no longer be edited.')) return;
    setEvBusy(true);
    try {
      const r = await api.adminBillingSubmitEvidence(selDispute.id, { evidence: payload, submit: doSubmit });
      showToast({ kind: 'ok', msg: doSubmit ? 'Evidence submitted' : 'Evidence saved (draft)' });
      setSelDispute(r.dispute || selDispute);
      loadDisputes();
    } catch (err) {
      showToast({ kind: 'err', msg: err.message || 'Evidence update failed' });
    } finally {
      setEvBusy(false);
    }
  };

  // --- LTV state ---
  const [ltvUserId, setLtvUserId] = useState('');
  const [ltvBusy, setLtvBusy] = useState(false);
  const [ltv, setLtv] = useState(null);

  const lookupLtv = async (e) => {
    e.preventDefault();
    if (ltvBusy) return;
    const uid = Number(ltvUserId);
    if (!Number.isInteger(uid) || uid <= 0) { showToast({ kind: 'err', msg: 'Enter a numeric user id' }); return; }
    setLtvBusy(true);
    setLtv(null);
    try {
      const r = await api.adminBillingLTV(uid);
      setLtv(r);
    } catch (err) {
      showToast({ kind: 'err', msg: err.message || 'LTV lookup failed' });
    } finally {
      setLtvBusy(false);
    }
  };

  const fmtMoney = (cents, cur = 'usd') => `${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(cur).toUpperCase()}`;
  const fmtDate = (unixSec) => unixSec ? new Date(unixSec * 1000).toLocaleDateString() : '—';

  return (
    <div className="space-y-6">
      {toast}

      {/* Refund */}
      <div className={cardCls}>
        <div className={headerCls}>
          <RefreshCw size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Issue Refund</h3>
          <span className="text-xs text-gray-500">Reverses the referral commission automatically</span>
        </div>
        <form onSubmit={issueRefund} className="p-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">
            PaymentIntent or Charge id
            <input className={inputCls} placeholder="pi_… or ch_…" value={refForm.target} onChange={(e) => setRef('target', e.target.value)} data-testid="refund-target" />
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Amount (leave blank for full)
            <input className={inputCls} type="number" step="0.01" min="0" placeholder="e.g. 49.00" value={refForm.amount} onChange={(e) => setRef('amount', e.target.value)} data-testid="refund-amount" />
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Reason
            <select className={inputCls} value={refForm.reason} onChange={(e) => setRef('reason', e.target.value)}>
              <option value="">—</option>
              <option value="requested_by_customer">Requested by customer</option>
              <option value="duplicate">Duplicate</option>
              <option value="fraudulent">Fraudulent</option>
            </select>
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Target user id (optional, for audit)
            <input className={inputCls} type="number" min="1" placeholder="123" value={refForm.target_user_id} onChange={(e) => setRef('target_user_id', e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 sm:col-span-2">
            <input type="checkbox" checked={refForm.override} onChange={(e) => setRef('override', e.target.checked)} data-testid="refund-override" />
            Override product refund policy (force a blocked refund — recorded in audit)
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={refBusy}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm rounded-md inline-flex items-center gap-1.5" data-testid="refund-submit">
              {refBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Issue refund
            </button>
          </div>
        </form>
        {refResult && (
          <div className="px-4 pb-4 text-xs">
            {refResult.blocked ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300">
                <AlertTriangle size={12} className="inline mr-1" /> Blocked by policy: <strong>{refResult.reason}</strong> ({refResult.kind}). Tick override to force.
              </div>
            ) : (
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 space-y-1">
                <div>Refund <strong>{refResult.refund?.status}</strong> · {fmtMoney(refResult.refund?.amount, refResult.refund?.currency)} · {refResult.refund?.id}</div>
                <div>Policy: {refResult.policy?.kind}{refResult.policy?.overridden ? ' (overridden)' : ''}{refResult.policy?.note ? ` — ${refResult.policy.note}` : ''}</div>
                <div>Commission clawback: <strong>{refResult.clawback?.outcome}</strong>{refResult.clawback?.reversed_amount_cents != null ? ` (${fmtMoney(refResult.clawback.reversed_amount_cents)})` : ''}{refResult.clawback?.detail ? ` — ${refResult.clawback.detail}` : ''}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disputes */}
      <div className={cardCls}>
        <div className={headerCls}>
          <ShieldAlert size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Disputes</h3>
          <div className="ml-auto">
            <button onClick={loadDisputes} disabled={dispLoading}
              className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 inline-flex items-center gap-1 dark:bg-gray-800 dark:text-gray-300" data-testid="disputes-refresh">
              {dispLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Load disputes
            </button>
          </div>
        </div>
        <div className="p-4 grid gap-4 md:grid-cols-2">
          <div>
            {disputes.length === 0 ? (
              <p className="text-xs text-gray-500">No disputes loaded. Click “Load disputes”.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-xs">
                {disputes.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => { setSelDispute(d); }}
                      className={`w-full text-left py-2 px-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded ${selDispute?.id === d.id ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{fmtMoney(d.amount, d.currency)}</span>
                        <span className="text-gray-500">{d.status}</span>
                      </div>
                      <div className="text-gray-500">{d.reason} · due {fmtDate(d.due_by)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            {selDispute ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  <strong className="text-gray-900 dark:text-gray-100">{selDispute.id}</strong> · {selDispute.status} · {selDispute.reason}
                </div>
                {['uncategorized_text', 'product_description', 'customer_communication', 'refund_policy_disclosure', 'receipt'].map((f) => (
                  <label key={f} className="block text-[11px] text-gray-600 dark:text-gray-400">
                    {f === 'receipt' ? 'receipt (Stripe file id file_…)' : f}
                    {f === 'receipt' ? (
                      <input className={inputCls} value={evidence[f]} onChange={(e) => setEv(f, e.target.value)} placeholder="file_…" />
                    ) : (
                      <textarea className={`${inputCls} min-h-[48px]`} value={evidence[f]} onChange={(e) => setEv(f, e.target.value)} />
                    )}
                  </label>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={() => submitEvidence(false)} disabled={evBusy}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 text-xs rounded-md dark:bg-gray-800 dark:text-gray-200">Save draft</button>
                  <button onClick={() => submitEvidence(true)} disabled={evBusy}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs rounded-md inline-flex items-center gap-1.5">
                    {evBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Submit to Stripe
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Select a dispute to add evidence.</p>
            )}
          </div>
        </div>
      </div>

      {/* LTV */}
      <div className={cardCls}>
        <div className={headerCls}>
          <CreditCard size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer Lifetime Value</h3>
        </div>
        <form onSubmit={lookupLtv} className="p-4 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600 dark:text-gray-400">
            User id
            <input className={inputCls} type="number" min="1" placeholder="123" value={ltvUserId} onChange={(e) => setLtvUserId(e.target.value)} data-testid="ltv-user-id" />
          </label>
          <button type="submit" disabled={ltvBusy}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm rounded-md inline-flex items-center gap-1.5" data-testid="ltv-submit">
            {ltvBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Look up
          </button>
        </form>
        {ltv && (
          <div className="px-4 pb-4 text-xs space-y-3">
            <div className="text-gray-700 dark:text-gray-300">
              {ltv.user?.email || `user #${ltv.user?.id}`}{ltv.note === 'no_stripe_customer' ? ' — no Stripe customer on file' : ''}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 dark:bg-gray-800 dark:border-gray-700">
                <div className="text-gray-500">Net LTV</div>
                <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(ltv.ltv?.net_cents, ltv.ltv?.currency)}</div>
              </div>
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 dark:bg-gray-800 dark:border-gray-700">
                <div className="text-gray-500">Gross paid</div>
                <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(ltv.ltv?.gross_cents, ltv.ltv?.currency)}</div>
              </div>
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 dark:bg-gray-800 dark:border-gray-700">
                <div className="text-gray-500">Refunded</div>
                <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(ltv.ltv?.refunded_cents, ltv.ltv?.currency)}</div>
              </div>
            </div>
            <div className="text-gray-500">{ltv.ltv?.charge_count || 0} charges across {ltv.customer_ids?.length || 0} Stripe customer(s)</div>
            {ltv.mixed_currency && (
              <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300">
                <AlertTriangle size={12} className="inline mr-1" /> Multiple currencies — totals above are for {String(ltv.ltv?.currency).toUpperCase()} only.
                <div className="mt-1 space-x-2">
                  {ltv.by_currency?.map((b) => (
                    <span key={b.currency}>{fmtMoney(b.net_cents, b.currency)} ({b.charge_count})</span>
                  ))}
                </div>
              </div>
            )}
            {ltv.charges?.length > 0 && (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {ltv.charges.map((ch) => (
                  <li key={ch.id} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-gray-700 dark:text-gray-300 truncate">{fmtDate(ch.created)} · {ch.description || ch.id}</span>
                    <span className="text-gray-900 dark:text-gray-100">{fmtMoney(ch.amount - ch.amount_refunded, ch.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PromoCodesPanel() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const { toast, showToast } = useToast(3000);

  const EMPTY_FORM = {
    code: '', type: 'percent', percent_off: '', amount_off: '', currency: 'usd',
    duration: 'once', duration_in_months: '', max_redemptions: '', expires_at: '', product_ids: [],
  };
  const [form, setForm] = useState(EMPTY_FORM);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.adminListPromos();
      setRows(r.promos || []);
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to load promo codes' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.catalogProducts().then((r) => setProducts(r.products || [])).catch(() => {});
  }, []);

  const toggleProduct = (id) => setForm((f) => ({
    ...f,
    product_ids: f.product_ids.includes(id)
      ? f.product_ids.filter((x) => x !== id)
      : [...f.product_ids, id],
  }));

  const create = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const body = {
        code: form.code.trim(),
        type: form.type,
        duration: form.duration,
        product_ids: form.product_ids,
      };
      if (form.type === 'percent') {
        body.percent_off = Number(form.percent_off);
      } else {
        body.amount_off = Number(form.amount_off);
        body.currency = form.currency.trim().toLowerCase();
      }
      if (form.duration === 'repeating') body.duration_in_months = Number(form.duration_in_months);
      if (form.max_redemptions) body.max_redemptions = Number(form.max_redemptions);
      if (form.expires_at) body.expires_at = form.expires_at;
      const r = await api.adminCreatePromo(body);
      showToast({ kind: 'ok', msg: `Created ${r.code || form.code}` });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Create failed' });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (promo) => {
    setBusyId(promo.id);
    try {
      const r = await api.adminSetPromoActive(promo.id, !promo.active);
      setRows((prev) => prev.map((p) => (p.id === promo.id ? { ...p, active: r.active } : p)));
      showToast({ kind: 'ok', msg: `${promo.code} ${r.active ? 'activated' : 'deactivated'}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (promo) => {
    if (!window.confirm(`Delete promo ${promo.code}? This deactivates it and deletes the backing coupon — it can never be redeemed again.`)) return;
    setBusyId(promo.id);
    try {
      await api.adminDeletePromo(promo.id);
      setRows((prev) => prev.map((p) => (p.id === promo.id ? { ...p, active: false } : p)));
      showToast({ kind: 'ok', msg: `${promo.code} deleted` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Delete failed' });
    } finally {
      setBusyId(null);
    }
  };

  const productName = (id) => products.find((p) => p.id === id)?.name || id;
  const discountLabel = (p) => (
    p.percent_off != null ? `${p.percent_off}% off`
      : p.amount_off != null ? `${(p.amount_off / 100).toFixed(2)} ${(p.currency || '').toUpperCase()} off`
        : '—'
  );

  const activeCount = rows.filter((r) => r.active).length;
  const inputCls = 'rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500';

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Ticket size={16} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Promo Codes</h3>
        <span className="text-xs text-gray-500">{activeCount} active · {rows.length} total</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load}
            className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 inline-flex items-center gap-1 dark:bg-gray-800 dark:text-gray-300">
            <RefreshCw size={11} /> Refresh
          </button>
          <button onClick={() => setShowCreate((v) => !v)}
            className="text-xs px-2.5 py-1 bg-violet-600 hover:bg-violet-700 rounded-md text-white inline-flex items-center gap-1">
            {showCreate ? <X size={11} /> : <Plus size={11} />} {showCreate ? 'Cancel' : 'New code'}
          </button>
        </div>
      </div>

      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
        Codes proxy native Stripe Coupons + Promotion Codes. Restrict a code to specific products via the
        allow-list (leave empty to allow all). 100%-off codes (and sub-minimum totals) complete as free orders.
      </div>

      {showCreate && (
        <form onSubmit={create} className="px-4 py-4 border-b border-gray-200 dark:border-gray-800 space-y-3 bg-gray-50/40 dark:bg-gray-800/20" data-testid="promo-create-form">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Code
              <input required value={form.code} onChange={(e) => setField('code', e.target.value.toUpperCase())}
                placeholder="LAUNCH20" autoCapitalize="characters" className={inputCls} data-testid="promo-code-input" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Type
              <select value={form.type} onChange={(e) => setField('type', e.target.value)} className={inputCls}>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </label>
            {form.type === 'percent' ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                Percent off (1–100)
                <input required type="number" min="1" max="100" step="1" value={form.percent_off}
                  onChange={(e) => setField('percent_off', e.target.value)} placeholder="20" className={inputCls} />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                  Amount off (minor units, e.g. cents)
                  <input required type="number" min="1" step="1" value={form.amount_off}
                    onChange={(e) => setField('amount_off', e.target.value)} placeholder="500" className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                  Currency
                  <input required value={form.currency} onChange={(e) => setField('currency', e.target.value)}
                    placeholder="usd" maxLength={3} className={inputCls} />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Duration (subscriptions)
              <select value={form.duration} onChange={(e) => setField('duration', e.target.value)} className={inputCls}>
                <option value="once">Once (first invoice)</option>
                <option value="forever">Forever</option>
                <option value="repeating">Repeating (N months)</option>
              </select>
            </label>
            {form.duration === 'repeating' && (
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                Duration in months
                <input required type="number" min="1" step="1" value={form.duration_in_months}
                  onChange={(e) => setField('duration_in_months', e.target.value)} placeholder="3" className={inputCls} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Max redemptions (optional)
              <input type="number" min="1" step="1" value={form.max_redemptions}
                onChange={(e) => setField('max_redemptions', e.target.value)} placeholder="Unlimited" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Expires at (optional)
              <input type="date" value={form.expires_at} onChange={(e) => setField('expires_at', e.target.value)} className={inputCls} />
            </label>
          </div>

          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
            Eligible products <span className="font-normal text-gray-400">(none selected = all products)</span>
            <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {products.length === 0 ? (
                <div className="px-3 py-2 text-gray-400">No catalog products found.</div>
              ) : products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <input type="checkbox" checked={form.product_ids.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                  <span className="text-gray-800 dark:text-gray-200 font-normal">{p.name}</span>
                  <span className="text-gray-400 font-normal">· {p.kind || 'product'}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={creating}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create code
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm inline-flex items-center justify-center gap-2 w-full">
          <Loader2 size={14} className="animate-spin" /> Loading promo codes…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">No promo codes yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/40">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Code</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Discount</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Products</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Redeemed</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Expires</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const busy = busyId === p.id;
                const limit = p.max_redemptions != null ? `/${p.max_redemptions}` : '';
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50 dark:border-gray-800 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">{p.code}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{discountLabel(p)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-[18rem]">
                      {(!p.product_ids || p.product_ids.length === 0)
                        ? <span className="text-gray-400">All products</span>
                        : p.product_ids.map(productName).join(', ')}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{p.times_redeemed ?? 0}{limit}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button disabled={busy} onClick={() => toggleActive(p)}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            p.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}>
                          {p.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button disabled={busy} onClick={() => remove(p)}
                          className="px-2 py-1 text-xs rounded-md font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-50 inline-flex items-center gap-1">
                          <Trash2 size={11} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 px-3 py-2 rounded-lg text-sm shadow-lg ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  );
}

function WellbeingExpertsPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | hidden | unverified | verified
  const { toast, showToast } = useToast(3000);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Admins receive every active expert (verified + unverified + hidden)
      // from this endpoint — see routes/wellbeing.ts.
      const r = await api.wellbeingExperts({ limit: 50 });
      setRows(r.matches || []);
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to load experts' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const toggleHide = async (expert) => {
    setBusyId(expert.uid);
    try {
      const next = !expert.hidden;
      const r = await api.wellbeingAdminHide(expert.uid, next);
      setRows((prev) => prev.map((e) => e.uid === expert.uid ? { ...e, hidden: !!r.hidden } : e));
      showToast({ kind: 'ok', msg: `${expert.name}: ${r.hidden ? 'Hidden from directory' : 'Restored to directory'}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleVerify = async (expert) => {
    setBusyId(expert.uid);
    try {
      const next = !expert.verified;
      const r = await api.wellbeingAdminVerify(expert.uid, next);
      setRows((prev) => prev.map((e) => e.uid === expert.uid ? { ...e, verified: !!r.verified } : e));
      showToast({ kind: 'ok', msg: `${expert.name}: ${r.verified ? 'Verified' : 'Verification removed'}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const verifiedCount = rows.filter((r) => r.verified).length;
  const hiddenCount = rows.filter((r) => r.hidden).length;

  const needle = q.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (filter === 'hidden' && !r.hidden) return false;
    if (filter === 'unverified' && r.verified) return false;
    if (filter === 'verified' && !r.verified) return false;
    if (!needle) return true;
    return (r.name || '').toLowerCase().includes(needle)
      || (r.headline || '').toLowerCase().includes(needle)
      || (r.uid || '').toLowerCase().includes(needle);
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Heart size={16} className="text-rose-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Wellbeing Experts</h3>
        <span className="text-xs text-gray-500">
          {verifiedCount} verified · {hiddenCount} hidden · {rows.length} total
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="admin-wellbeing-filter"
          >
            <option value="all">All</option>
            <option value="unverified">Unverified</option>
            <option value="verified">Verified</option>
            <option value="hidden">Hidden</option>
          </select>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search" value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / headline"
              className="pl-7 pr-2 py-1 text-xs border border-gray-300 rounded-md w-56 dark:border-gray-700"
            />
          </div>
          <button onClick={load}
            className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 inline-flex items-center gap-1 dark:text-gray-300">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
        Hidden experts are removed from the public directory. Only <strong>verified</strong> experts with profile
        completion ≥ 70% appear to founders.
      </div>
      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm inline-flex items-center justify-center gap-2 w-full">
          <Loader2 size={14} className="animate-spin" /> Loading experts…
        </div>
      ) : visible.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">No experts match the current filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Expert</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Categories</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Completion</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Rating</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Verified</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Hidden</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const busy = busyId === e.uid;
                const cats = Array.isArray(e.categories) ? e.categories : [];
                return (
                  <tr key={e.uid} className="border-b border-gray-100 hover:bg-gray-50/50" data-testid={`admin-wellbeing-row-${e.uid}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{e.name}</div>
                      <div className="text-xs text-gray-500">{e.headline || <span className="text-gray-400">—</span>}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs dark:text-gray-300">
                      {cats.length ? cats.slice(0, 3).join(', ') : <span className="text-gray-400">—</span>}
                      {cats.length > 3 && <span className="text-gray-400"> +{cats.length - 3}</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-700 dark:text-gray-300">
                      {Math.round(e.profile_completion_pct || 0)}%
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-700 dark:text-gray-300">
                      {e.rating_count
                        ? <>{(e.rating_avg || 0).toFixed(1)} <span className="text-gray-400">({e.rating_count})</span></>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.verified
                        ? <BadgeCheck size={16} className="text-emerald-600 inline" />
                        : <XCircle size={16} className="text-gray-300 inline" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.hidden
                        ? <EyeOff size={16} className="text-rose-600 inline" />
                        : <Eye size={16} className="text-gray-300 inline" />}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => toggleVerify(e)}
                          data-testid={`admin-wellbeing-verify-${e.uid}`}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            e.verified
                              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}>
                          {e.verified ? 'Unverify' : 'Verify'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => toggleHide(e)}
                          data-testid={`admin-wellbeing-hide-${e.uid}`}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            e.hidden
                              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                          }`}>
                          {e.hidden ? 'Unhide' : 'Hide'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-3 py-2 rounded-lg text-sm shadow-lg ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  );
}

function IntegrationKeysPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null); // Task #3 — provider_key currently being tested
  const { toast, showToast } = useToast(3500);

  // Task #3 — Dry-run probe of provider OAuth credentials.
  const onTest = async (provider) => {
    setTesting(provider);
    try {
      const r = await api.adminTestIntegrationKeys(provider);
      const label = PROVIDER_LABELS[provider] || provider;
      if (r.ok) {
        showToast({ kind: 'ok', msg: `${label}: ${r.detail || 'Credentials accepted.'}` });
      } else if (!r.reachable) {
        showToast({ kind: 'err', msg: `${label}: provider unreachable (network/timeout).` });
      } else {
        showToast({ kind: 'err', msg: `${label}: ${r.detail || 'Credentials rejected.'}` });
      }
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Test failed' });
    } finally { setTesting(null); }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.adminListIntegrationKeys();
      setRows(r.providers || []);
    } catch (e) {
      reportError(e, { where: 'IntegrationKeysPanel.refresh' });
      showToast({ kind: 'err', msg: e.message || 'Failed to load' });
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const onDelete = async (provider) => {
    const row = rows.find(r => r.provider_key === provider);
    if (row?.source === 'env') {
      showToast({ kind: 'err', msg: 'This provider is configured via env vars — remove the secret with `wrangler secret delete` instead.' });
      return;
    }
    const n = row?.active_integrations || 0;
    const msg = n > 0
      ? `Remove ${PROVIDER_LABELS[provider]} keys?\n\nThis will disconnect ${n} active user integration${n === 1 ? '' : 's'}. Affected users will need to reconnect once new keys are configured.`
      : `Remove ${PROVIDER_LABELS[provider]} keys?`;
    if (!confirm(msg)) return;
    try {
      const r = await api.adminDeleteIntegrationKeys(provider);
      showToast({ kind: 'ok', msg: r.disconnected_users
        ? `Removed — ${r.disconnected_users} user integration${r.disconnected_users === 1 ? '' : 's'} disconnected.`
        : 'Keys removed.' });
      refresh();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to remove' });
    }
  };

  return (
    <div data-density-target>
      {toast && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${toast.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {toast.msg}
        </div>
      )}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-5 flex gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 dark:text-amber-100">
          <div className="font-semibold mb-1">OAuth client credentials are sensitive.</div>
          <div className="text-amber-800 dark:text-amber-200">
            Worker env vars always take precedence over keys configured here. Removing keys forcibly disconnects every active user integration for that provider — they'll need to reconnect once new keys are saved.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading providers…
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => {
            const label = PROVIDER_LABELS[row.provider_key] || row.provider_key;
            const envNames = PROVIDER_ENV_NAMES[row.provider_key] || [];
            const sourceBadge = row.source === 'env'
              ? { text: 'env vars', cls: 'bg-blue-100 text-blue-700' }
              : row.source === 'db'
                ? { text: 'admin-managed', cls: 'bg-emerald-100 text-emerald-700' }
                : { text: 'not configured', cls: 'bg-gray-100 text-gray-700' };
            return (
              <div key={row.provider_key} data-card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{label}</h3>
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${sourceBadge.cls}`}>{sourceBadge.text}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {row.active_integrations} active user integration{row.active_integrations === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
                {row.has_keys && row.client_id_preview && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 font-mono break-all">
                    Client ID: {row.client_id_preview}
                  </div>
                )}
                {row.source === 'db' && row.updated_at && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
                    Last rotated {new Date(row.updated_at).toLocaleString()}
                  </div>
                )}
                {row.source === 'env' && (
                  <div className="text-[11px] text-blue-700 dark:text-blue-300 mb-3">
                    Configured via worker secret{envNames.length === 2 ? 's' : ''}: <code>{envNames.join('</code> + <code>')}</code>. Admin UI cannot edit env-var configs.
                  </div>
                )}
                {row.source === 'unconfigured' && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">{PROVIDER_HINTS[row.provider_key]}</div>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setEditing({ provider: row.provider_key, mode: row.source === 'db' ? 'rotate' : 'configure' })}
                    disabled={row.source === 'env'}
                    title={row.source === 'env' ? 'Configured via env var — edit the worker secret instead' : ''}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                    {row.source === 'db' ? 'Rotate keys' : 'Configure'}
                  </button>
                  {/* Task #3 — Test button: dry-runs a provider auth call. */}
                  <button
                    onClick={() => onTest(row.provider_key)}
                    disabled={!row.has_keys || testing === row.provider_key}
                    title={row.has_keys ? 'Probe the provider with the configured credentials' : 'Configure keys first'}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/70 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
                    {testing === row.provider_key ? <Loader2 size={12} className="animate-spin" /> : null}
                    Test
                  </button>
                  {row.source === 'db' && (
                    <button
                      onClick={() => onDelete(row.provider_key)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 inline-flex items-center gap-1.5">
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <IntegrationKeysEditModal
          provider={editing.provider}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast({ kind: 'ok', msg: editing.mode === 'rotate' ? 'Secret rotated.' : 'Keys saved.' }); }}
          onError={(msg) => showToast({ kind: 'err', msg })}
        />
      )}
    </div>
  );
}

function IntegrationKeysEditModal({ provider, mode = 'configure', onClose, onSaved, onError }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  useEscapeClose(onClose);
  const label = PROVIDER_LABELS[provider] || provider;
  // Task #3 — rotate-mode only collects a new client_secret and calls
  // POST /:provider/rotate (client_id stays the same). configure-mode
  // is the original PUT flow used to first set up a provider.
  const isRotate = mode === 'rotate';

  const submit = async (e) => {
    e?.preventDefault?.();
    if (isRotate) {
      if (!clientSecret.trim()) {
        onError('A new Client Secret is required.');
        return;
      }
    } else if (!clientId.trim() || !clientSecret.trim()) {
      onError('Both Client ID and Client Secret are required.');
      return;
    }
    setSaving(true);
    try {
      if (isRotate) {
        await api.adminRotateIntegrationKeys(provider, clientSecret.trim());
      } else {
        await api.adminSetIntegrationKeys(provider, clientId.trim(), clientSecret.trim());
      }
      onSaved();
    } catch (e) {
      onError(e.message || (isRotate ? 'Failed to rotate' : 'Failed to save'));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{isRotate ? `Rotate ${label} secret` : `${label} OAuth keys`}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
          {isRotate
            ? 'Paste the new client secret issued by the provider. The Client ID stays the same — only the secret is rotated in place.'
            : PROVIDER_HINTS[provider]}
        </p>
        {!isRotate && (
          <>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Client ID</label>
            <input
              autoFocus
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 mb-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono"
              placeholder="e.g. 1234567890.0987654321" />
          </>
        )}
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{isRotate ? 'New Client Secret' : 'Client Secret'}</label>
        <input
          autoFocus={isRotate}
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          className="w-full px-3 py-2 mb-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono"
          placeholder="••••••••••••••••" />
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">
          Encrypted at rest. Only the secret hash is ever logged.
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200">
            Cancel
          </button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 inline-flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isRotate ? 'Rotate secret' : 'Save keys'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PersonasPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try { const r = await api.listPersonasAdmin(); setRows(r.users || []); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const retag = async (userId, personaId) => {
    if (!personaId) return;
    setSavingId(userId);
    try {
      await api.retagPersonaAdmin(userId, personaId);
      await load();
    } catch (e) {
      alert(e.message || 'Re-tag failed');
    } finally { setSavingId(null); }
  };

  const filtered = rows.filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (r.email || '').toLowerCase().includes(f) || (r.name || '').toLowerCase().includes(f);
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Sparkles size={16} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">User Personas</h3>
        <div className="ml-auto flex items-center gap-2">
          {/* T21 — Enter in the search input now triggers a Refresh. */}
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex items-center gap-2">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name or email"
              className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-md w-56 focus:outline-none focus:border-violet-400 dark:border-gray-800" />
            <button type="submit" className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 flex items-center gap-1 dark:text-gray-300">
              <RefreshCw size={12} /> Refresh
            </button>
          </form>
        </div>
      </div>
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">No users.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">User</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Current Persona</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Source</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Re-tag</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.user_id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.name || '—'}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGES[r.role] || 'bg-gray-100 text-gray-700'}`}>{r.role}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
                    {r.persona_id
                      ? (PERSONA_TAXONOMY.find((p) => p.id === r.persona_id)?.label || r.persona_id)
                      : <span className="text-gray-400 italic">— not set —</span>}
                    {r.confidence != null && r.persona_id && (
                      <span className="ml-2 text-[10px] text-gray-500">conf {(Number(r.confidence) * 100).toFixed(0)}%</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {r.source || '—'}
                    {Number(r.manual_override) === 1 && <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">override</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <select disabled={savingId === r.user_id} defaultValue=""
                      onChange={(e) => retag(r.user_id, e.target.value)}
                      className="text-xs px-2 py-1.5 border border-gray-200 rounded-md bg-white dark:border-gray-800 dark:bg-gray-900">
                      <option value="">{savingId === r.user_id ? 'Saving…' : 'Re-tag as…'}</option>
                      {PERSONA_TAXONOMY.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
