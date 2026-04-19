import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Users, Plus, Search, Copy, ChevronRight } from 'lucide-react';
import { UserDetailModal } from './AdminPage';

export default function PartnersPage() {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', specialization: '' });
  const [matchSector, setMatchSector] = useState('');
  const [matches, setMatches] = useState(null);
  // openPartner: row from /partners (now augmented with user_id via LEFT JOIN).
  // We open the shared UserDetailModal when a linked user account exists.
  const [openPartner, setOpenPartner] = useState(null);

  const load = () => {
    setLoading(true);
    api.listPartners().then(setPartners).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async () => {
    try {
      await api.createPartner(form);
      setShowForm(false);
      setForm({ name: '', email: '', company: '', specialization: '' });
      load();
    } catch (e) { alert(e.message); }
  };

  const runMatch = async () => {
    try {
      const res = await api.recommendPartners(matchSector);
      setMatches(res);
    } catch (e) { alert(e.message); }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Partner Ecosystem</h1>
          <p className="text-sm text-gray-600">Matchmaking, deal flow, and referral dashboard</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white">
          <Plus size={14} /> Add Partner
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <div className="grid md:grid-cols-2 gap-4">
            {['name', 'email', 'company', 'specialization'].map(field => (
              <div key={field}>
                <label className="block text-xs text-gray-600 mb-1 capitalize">{field}</label>
                <input type="text" value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} className="px-4 py-2 bg-violet-600 rounded-lg text-sm text-white">Add</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 rounded-lg text-sm text-gray-900">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Search size={14} className="text-violet-600" /> Partner Matchmaking
        </h3>
        <div className="flex gap-3">
          <input type="text" placeholder="Sector (e.g. AI, Blockchain)..." value={matchSector}
            onChange={e => setMatchSector(e.target.value)}
            className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          <button onClick={runMatch} className="px-4 py-2 bg-violet-600 rounded-lg text-sm text-white">Find Matches</button>
        </div>
        {matches && (
          <div className="mt-3 text-sm text-gray-600">
            Found <span className="text-gray-900 font-medium">{matches.count}</span> matching partner(s)
            {matches.matches.map(m => (
              <div key={m.id} className="mt-2 px-3 py-2 bg-gray-100 rounded-lg">
                <span className="text-gray-900">{m.name}</span> — {m.company} ({m.specialization})
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 text-sm">All Partners & Referral Dashboard</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-600 text-sm">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase">
                <th className="text-left px-5 py-3">Partner</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Company</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Specialization</th>
                <th className="text-left px-5 py-3">Referral Code</th>
                <th className="text-left px-5 py-3">Referrals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {partners.map(p => (
                <tr key={p.id} onClick={() => setOpenPartner(p)}
                    className="hover:bg-violet-50/40 cursor-pointer group">
                  <td className="px-5 py-3 text-gray-900">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{p.name}</span>
                      <ChevronRight size={12} className="text-gray-300 group-hover:text-violet-600 transition-colors" />
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{p.email || p.user_email || '—'}</div>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.company || '—'}</td>
                  <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.specialization || '—'}</td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => copyCode(p.referral_code)} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-mono">
                      {p.referral_code} <Copy size={10} />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-gray-900 font-medium">{p.referrals_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openPartner && openPartner.user_id && (
        <UserDetailModal
          userRow={{
            id: openPartner.user_id,
            name: openPartner.name,
            email: openPartner.user_email || openPartner.email,
            role: 'partner',
            is_active: openPartner.user_is_active,
            email_verified: openPartner.user_email_verified,
          }}
          onClose={() => setOpenPartner(null)}
          onImpersonate={() => setOpenPartner(null)}
          onToggleActive={() => setOpenPartner(null)}
        />
      )}
      {openPartner && !openPartner.user_id && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpenPartner(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">{openPartner.name}</h3>
            <p className="text-xs text-gray-500 mt-1">{openPartner.email || '—'}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Company</div><div className="text-gray-900">{openPartner.company || '—'}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Specialization</div><div className="text-gray-900">{openPartner.specialization || '—'}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Referral code</div><div className="text-gray-900 font-mono text-xs">{openPartner.referral_code || '—'}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Referrals</div><div className="text-gray-900">{openPartner.referrals_count ?? 0}</div></div>
            </div>
            <div className="mt-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              No user account is linked to this partner record yet. Once they register and an admin links the accounts, the full registration timeline, KYC, agreements, and activity history will appear here.
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setOpenPartner(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
