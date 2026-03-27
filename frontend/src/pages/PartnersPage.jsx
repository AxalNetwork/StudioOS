import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Users, Plus, Search, Copy } from 'lucide-react';

export default function PartnersPage() {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', specialization: '' });
  const [matchSector, setMatchSector] = useState('');
  const [matches, setMatches] = useState(null);

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
          <h1 className="text-2xl font-bold text-white mb-1">Partner Ecosystem</h1>
          <p className="text-sm text-gray-400">Matchmaking, deal flow, and referral dashboard</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white">
          <Plus size={14} /> Add Partner
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <div className="grid md:grid-cols-2 gap-4">
            {['name', 'email', 'company', 'specialization'].map(field => (
              <div key={field}>
                <label className="block text-xs text-gray-400 mb-1 capitalize">{field}</label>
                <input type="text" value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} className="px-4 py-2 bg-violet-600 rounded-lg text-sm text-white">Add</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-700 rounded-lg text-sm text-white">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Search size={14} className="text-violet-400" /> Partner Matchmaking
        </h3>
        <div className="flex gap-3">
          <input type="text" placeholder="Sector (e.g. AI, Blockchain)..." value={matchSector}
            onChange={e => setMatchSector(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          <button onClick={runMatch} className="px-4 py-2 bg-violet-600 rounded-lg text-sm text-white">Find Matches</button>
        </div>
        {matches && (
          <div className="mt-3 text-sm text-gray-400">
            Found <span className="text-white font-medium">{matches.count}</span> matching partner(s)
            {matches.matches.map(m => (
              <div key={m.id} className="mt-2 px-3 py-2 bg-gray-800 rounded-lg">
                <span className="text-white">{m.name}</span> — {m.company} ({m.specialization})
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="font-semibold text-white text-sm">All Partners & Referral Dashboard</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
                <th className="text-left px-5 py-3">Partner</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Company</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Specialization</th>
                <th className="text-left px-5 py-3">Referral Code</th>
                <th className="text-left px-5 py-3">Referrals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {partners.map(p => (
                <tr key={p.id} className="hover:bg-gray-800/50">
                  <td className="px-5 py-3 text-white">{p.name}</td>
                  <td className="px-5 py-3 hidden md:table-cell text-gray-400">{p.company || '—'}</td>
                  <td className="px-5 py-3 hidden md:table-cell text-gray-400">{p.specialization || '—'}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => copyCode(p.referral_code)} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 font-mono">
                      {p.referral_code} <Copy size={10} />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-white font-medium">{p.referrals_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
