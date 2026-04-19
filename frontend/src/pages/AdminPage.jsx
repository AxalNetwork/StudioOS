import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Shield, Users, UserCheck, UserX, LogIn, ChevronDown, Briefcase, MessageSquare, X, Check, ShieldCheck, Clock, XCircle, CheckCircle2 } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';

const ROLE_BADGES = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
};

const STATUS_BADGES = {
  pending: 'bg-amber-100 text-amber-700',
  verified: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
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
    } catch (e) {
      console.error('Failed to load admin data:', e);
    } finally { setLoading(false); }
  };

  const loadKyc = async (status) => {
    try {
      const q = await api.kycAdminQueue(status);
      setKycQueue(q);
    } catch (e) {
      console.error('Failed to load KYC queue:', e);
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
  const handleRoleChange = async (userId, newRole) => {
    try { await api.adminUpdateRole(userId, newRole); loadAll(); } catch (e) { alert(e.message); }
  };

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter);
  const counts = {
    all: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    founder: users.filter(u => u.role === 'founder').length,
    partner: users.filter(u => u.role === 'partner').length,
  };
  const pendingProfiles = profiles.filter(p => p.admin_status === 'pending').length;

  if (loading) return <div className="text-gray-600 text-center py-20">Loading admin console...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Shield size={24} className="text-violet-600" />
        <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
      </div>
      <p className="text-gray-600 mb-6">Manage users, roles, and partner profiles</p>

      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button onClick={() => setTab('users')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'users' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Users size={14} className="inline mr-1.5" /> Users
        </button>
        <button onClick={() => setTab('profiles')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'profiles' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <Briefcase size={14} className="inline mr-1.5" /> Partner Profiles
          {pendingProfiles > 0 && (
            <span className="ml-2 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">{pendingProfiles} pending</span>
          )}
        </button>
        <button onClick={() => setTab('kyc')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'kyc' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          <ShieldCheck size={14} className="inline mr-1.5" /> KYC Queue
          {kycFilter === 'pending' && kycQueue.length > 0 && (
            <span className="ml-2 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">{kycQueue.length} pending</span>
          )}
        </button>
      </div>

      {tab === 'users' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {Object.entries(counts).map(([role, count]) => (
              <button key={role} onClick={() => setFilter(role)}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  filter === role ? 'bg-violet-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-700 hover:border-violet-300'
                }`}>
                <div className="text-lg font-bold">{count}</div>
                <div className="capitalize">{role === 'all' ? 'All Users' : role === 'partner' ? 'Partners / Investors' : `${role}s`}</div>
              </button>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No users found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Name</th>
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Email</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Verified</th>
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Joined</th>
                      <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr key={u.id} onClick={() => setOpenUser(u)}
                        className="border-b border-gray-100 hover:bg-violet-50/40 cursor-pointer">
                        <td className="px-4 py-3 text-gray-900 font-medium">{u.name}</td>
                        <td className="px-4 py-3 text-gray-600">{u.email}</td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="relative inline-block">
                            <select value={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)}
                              className={`appearance-none text-xs font-medium px-3 py-1 pr-6 rounded-full cursor-pointer border-0 ${ROLE_BADGES[u.role] || 'bg-gray-100 text-gray-700'}`}>
                              <option value="admin">Admin</option>
                              <option value="founder">Founder</option>
                              <option value="partner">Partner</option>
                            </select>
                            <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {u.email_verified ? <UserCheck size={16} className="text-green-500 mx-auto" /> : <UserX size={16} className="text-gray-400 mx-auto" />}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
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
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
            <Briefcase size={16} className="text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900">Partner Profiles</h3>
            <span className="text-xs text-gray-500 ml-auto">{profiles.length} profiles</span>
          </div>

          {profiles.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No profiles captured yet. New users will appear here after completing the onboarding chatbot.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
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
                        <div className="text-gray-900 font-medium">{p.user_name || '—'}</div>
                        <div className="text-xs text-gray-500">{p.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-700">{p.persona || <span className="text-gray-400">—</span>}</div>
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
                      <td className="px-4 py-3 text-gray-700">{p.legal_entity_name || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{p.agreement_type || <span className="text-gray-400">— not assigned —</span>}</td>
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
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap">
            <ShieldCheck size={16} className="text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900">KYC / AML Queue</h3>
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
                  <tr className="border-b border-gray-200 bg-gray-50">
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
                        <div className="font-medium text-gray-900">{k.name}</div>
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
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3 sticky top-0 bg-white">
              <ShieldCheck size={18} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900">KYC Review — {kycDetail.name}</h3>
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
                  <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Submitted Information</h4>
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
                      <div className="font-semibold text-gray-700 mb-1">Automated Provider Result: <span className="font-mono">{kycDetail.kyc_data.provider_result.result}</span></div>
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
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 outline-none" />
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
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('profile');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [toast, setToast] = useState(null);
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

  const flash = (kind, msg) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  };

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

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900">{u.name}</h3>
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

        <div className="px-6 pt-3 border-b border-gray-200 flex gap-1 overflow-x-auto">
          {['profile', 'registration', 'kyc', 'agreements', 'activity', 'notes'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px capitalize whitespace-nowrap transition-colors ${tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
              {t === 'kyc' ? 'KYC & Verification' :
               t === 'registration' ? `Registration${(data?.timeline?.length ?? 0) ? ` · ${data.timeline.length}` : ''}` :
               t === 'agreements' ? `Agreements${(data?.agreements?.length ?? 0) ? ` · ${data.agreements.length}` : ''}` :
               t === 'activity' ? `Activity${(data?.activity?.length ?? 0) ? ` · ${data.activity.length}` : ''}` :
               t}
            </button>
          ))}
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
              <Field label="Founder ID" value={u.founder_id ?? '—'} />
              <Field label="Partner ID" value={u.partner_id ?? '—'} />
              <Field label="Joined" value={u.created_at ? new Date(u.created_at).toLocaleString() : '—'} />
              <Field label="Last active" value={u.last_active_at ? new Date(u.last_active_at).toLocaleString() : '—'} />
              <div className="col-span-2 grid grid-cols-3 gap-3 mt-2">
                <Stat label="Activity events" value={stats.activity_count ?? 0} />
                <Stat label="Tickets" value={stats.ticket_count ?? 0} />
                <Stat label="Integrations" value={stats.integration_count ?? 0} />
              </div>
              {integrations.length > 0 && (
                <div className="col-span-2 mt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Connected integrations</div>
                  <div className="space-y-1.5">
                    {integrations.map(i => (
                      <div key={i.uid} className="flex items-center justify-between text-xs bg-gray-50 px-3 py-2 rounded-lg">
                        <span className="font-medium text-gray-900">{i.display_name || i.provider_name}</span>
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
                      <span className="font-semibold text-gray-900 capitalize">{ev.label}</span>
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
                <div key={`${ag.envelope_id}-${ag.recipient_id || 'na'}`} className="border border-gray-200 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-900">{ag.document_title || ag.document_type || 'Agreement'}</div>
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
                <div key={a.id} className="text-xs border border-gray-200 rounded-lg p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">{a.action}</span>
                    <span className="text-gray-500">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                  </div>
                  {a.details && <div className="text-gray-600 mt-1">{a.details}</div>}
                </div>
              ))}
              {tickets.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-gray-700 mt-4 mb-2">Recent tickets</div>
                  {tickets.map(t => (
                    <div key={t.id} className="text-xs border border-gray-200 rounded-lg p-2.5 flex items-center justify-between">
                      <span className="font-medium text-gray-900">{t.title}</span>
                      <span className="text-gray-500">{t.status} · {t.priority}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {data && tab === 'notes' && (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-700">Admin notes (visible only to admins)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={8}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
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

        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
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
  const submit = async (status) => {
    setSaving(true);
    setError('');
    try {
      const res = await api.adminVerifyProfile(profile.email, { agreement_type: agreement, admin_notes: notes, status });
      if (res?.esign?.envelope_id) {
        setEsignFlash({
          envelopeId: res.esign.envelope_id,
          emailSent: !!res.esign.email_sent,
          signingUrl: res.esign.signing_url,
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
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{profile.user_name || profile.email}</h3>
            <p className="text-xs text-gray-500">{profile.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Persona (AI extracted)</div>
              <div className="text-gray-900 font-medium">{profile.persona || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Entity Type</div>
              <div className="text-gray-900 font-medium">{profile.entity_type || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Legal Entity Name</div>
              <div className="text-gray-900 font-medium">{profile.legal_entity_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">EIN / Tax ID</div>
              <div className="text-gray-900 font-medium">{profile.ein || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Signatory</div>
              <div className="text-gray-900 font-medium">{profile.signatory_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Title</div>
              <div className="text-gray-900 font-medium">{profile.signatory_title || '—'}</div>
            </div>
          </div>

          {profile.persona === 'Founder' && (
            <div className={`rounded-lg p-3 border ${
              profile.founder_track === 'Strategic Scale (Existing)' ? 'bg-indigo-50 border-indigo-300'
              : profile.founder_track === 'Spin-Out (New)' ? 'bg-blue-50 border-blue-300'
              : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-700">Founder Track</div>
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
                    <div className="text-gray-900 font-medium">{profile.current_stage || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Partnership Goal</div>
                    <div className="text-gray-900 font-medium">{profile.partnership_goal || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Existing Jurisdiction</div>
                    <div className="text-gray-900 font-medium">{profile.existing_jurisdiction || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Product Strategy</div>
                    <div className="text-gray-900 font-medium">{profile.product_strategy || '—'}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-gray-500">Existing Investors / Cap Table</div>
                    <div className="text-gray-900 font-medium">{profile.existing_investors || '—'}</div>
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
                      ? 'Not yet incorporated — Axal will handle formation'
                      : 'Formation status not answered'}
                  </div>
                  {profile.existing_jurisdiction && (
                    <div className="text-xs text-gray-600 mt-1">Preferred jurisdiction: <span className="font-medium text-gray-900">{profile.existing_jurisdiction}</span></div>
                  )}
                  {profile.company_established === 0 && (
                    <p className="text-xs text-amber-700 mt-2">This founder has not yet incorporated. The Axal 30-Day Spin-Out Engine will handle formation as part of their Closing Binder.</p>
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
              <h4 className="text-sm font-semibold text-gray-900">Onboarding Conversation</h4>
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
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
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

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1">Propose Closing Binder / Agreement</label>
              <div className="relative">
                <select value={agreement} onChange={(e) => setAgreement(e.target.value)}
                  className="w-full appearance-none bg-white border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer">
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
              <label className="text-xs text-gray-700 font-medium block mb-1">Admin Notes (internal)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Any context for the legal engine or follow-up..."
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none resize-none" />
            </div>
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            {esignFlash && (
              <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 space-y-1">
                <div className="font-semibold text-emerald-800 flex items-center gap-1.5">
                  <Check size={12} /> eSignature envelope #{esignFlash.envelopeId} created
                </div>
                <div className="text-emerald-700">
                  {esignFlash.emailSent
                    ? <>Email sent from <span className="font-mono">deal@axal.vc</span> to <span className="font-mono">{profile.email}</span>.</>
                    : <>Envelope created — email delivery did not confirm. Share this link manually:</>}
                </div>
                {!esignFlash.emailSent && esignFlash.signingUrl && (
                  <a href={esignFlash.signingUrl} target="_blank" rel="noreferrer" className="text-violet-700 underline break-all">
                    {esignFlash.signingUrl}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-2">
          <button onClick={() => submit('rejected')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50 transition-colors">
            Reject
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
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
      <div className="text-sm text-gray-900 break-words">{value || '—'}</div>
    </div>
  );
}
