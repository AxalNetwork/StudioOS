import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Shield, Users, UserCheck, UserX, LogIn, ChevronDown, Briefcase, MessageSquare, X, Check } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [openProfile, setOpenProfile] = useState(null);

  useEffect(() => { loadAll(); }, []);

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
            <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
              <Users size={16} className="text-gray-600" />
              <h3 className="text-sm font-semibold text-gray-900">User Management</h3>
              <span className="text-xs text-gray-500 ml-auto">{filtered.length} users</span>
            </div>

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
                      <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-gray-900 font-medium">{u.name}</td>
                        <td className="px-4 py-3 text-gray-600">{u.email}</td>
                        <td className="px-4 py-3 text-center">
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
                        <td className="px-4 py-3 text-right">
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

      {openProfile && (
        <ProfileReviewModal
          profile={openProfile}
          onClose={() => setOpenProfile(null)}
          onSaved={() => { setOpenProfile(null); loadAll(); }}
        />
      )}
    </div>
  );
}

function ProfileReviewModal({ profile, onClose, onSaved }) {
  const [agreement, setAgreement] = useState(profile.agreement_type || '');
  const [notes, setNotes] = useState(profile.admin_notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  let chatMessages = [];
  try { chatMessages = JSON.parse(profile.chat_history || '[]'); } catch {}
  let extracted = {};
  try { extracted = JSON.parse(profile.extracted_data || '{}'); } catch {}

  const submit = async (status) => {
    setSaving(true);
    setError('');
    try {
      await api.adminVerifyProfile(profile.email, { agreement_type: agreement, admin_notes: notes, status });
      onSaved();
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
              <select value={agreement} onChange={(e) => setAgreement(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none">
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
            </div>
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1">Admin Notes (internal)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Any context for the legal engine or follow-up..."
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none resize-none" />
            </div>
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
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
