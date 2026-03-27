import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DollarSign, TrendingUp, Users, Plus } from 'lucide-react';

export default function CapitalPage() {
  const [portfolio, setPortfolio] = useState(null);
  const [investors, setInvestors] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCallForm, setShowCallForm] = useState(false);
  const [callForm, setCallForm] = useState({ lp_investor_id: '', amount: '', due_date: '' });

  const load = () => {
    setLoading(true);
    Promise.all([api.portfolio(), api.listInvestors(), api.listCapitalCalls()])
      .then(([p, i, c]) => { setPortfolio(p); setInvestors(i); setCalls(c); })
      .catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createCall = async () => {
    try {
      await api.createCapitalCall({
        ...callForm,
        lp_investor_id: parseInt(callForm.lp_investor_id),
        amount: parseFloat(callForm.amount),
      });
      setShowCallForm(false);
      load();
    } catch (e) { alert(e.message); }
  };

  const payCall = async (id) => {
    try {
      await api.payCapitalCall(id);
      load();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <div className="text-gray-400 text-center py-20">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Capital & Investment Ops</h1>
          <p className="text-sm text-gray-400">Portfolio performance, LP management, and capital calls</p>
        </div>
        <button onClick={() => setShowCallForm(!showCallForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white">
          <Plus size={14} /> Capital Call
        </button>
      </div>

      {showCallForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">LP Investor</label>
              <select value={callForm.lp_investor_id} onChange={e => setCallForm(f => ({ ...f, lp_investor_id: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="">Select investor</option>
                {investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Amount (USD)</label>
              <input type="number" value={callForm.amount} onChange={e => setCallForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Due Date</label>
              <input type="date" value={callForm.due_date} onChange={e => setCallForm(f => ({ ...f, due_date: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={createCall} className="px-4 py-2 bg-violet-600 rounded-lg text-sm text-white">Create Call</button>
            <button onClick={() => setShowCallForm(false)} className="px-4 py-2 bg-gray-700 rounded-lg text-sm text-white">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={16} className="text-emerald-400" />
            <span className="text-xs text-gray-400 uppercase">Total Committed</span>
          </div>
          <div className="text-2xl font-bold text-white">
            ${((portfolio?.fund_metrics?.total_committed || 0) / 1e6).toFixed(1)}M
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-blue-400" />
            <span className="text-xs text-gray-400 uppercase">Total Called</span>
          </div>
          <div className="text-2xl font-bold text-white">
            ${((portfolio?.fund_metrics?.total_called || 0) / 1e6).toFixed(1)}M
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-violet-400" />
            <span className="text-xs text-gray-400 uppercase">Portfolio Companies</span>
          </div>
          <div className="text-2xl font-bold text-white">{portfolio?.total_projects || 0}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h3 className="font-semibold text-white text-sm">Portfolio Projects</h3>
          </div>
          <div className="divide-y divide-gray-800">
            {portfolio?.projects?.length === 0 && (
              <div className="p-6 text-center text-gray-500 text-sm">No portfolio projects yet</div>
            )}
            {portfolio?.projects?.map(p => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-white">{p.name}</div>
                  <div className="text-xs text-gray-500">{p.sector}</div>
                </div>
                <div className="text-right">
                  {p.score && (
                    <div className={`text-sm font-bold ${
                      p.tier === 'TIER_1' ? 'text-emerald-400' :
                      p.tier === 'TIER_2' ? 'text-blue-400' : 'text-gray-400'
                    }`}>{p.score}</div>
                  )}
                  <div className="text-[10px] text-gray-500 capitalize">{p.status?.replace('_', ' ')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h3 className="font-semibold text-white text-sm">LP Investors</h3>
          </div>
          <div className="divide-y divide-gray-800">
            {investors.map(i => (
              <div key={i.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-white">{i.name}</div>
                  <div className="text-xs text-gray-500">{i.fund_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-white">${(i.committed_capital / 1e6).toFixed(1)}M</div>
                  <div className="text-[10px] text-gray-500">committed</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="font-semibold text-white text-sm">Capital Calls</h3>
        </div>
        {calls.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">No capital calls yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase">
                <th className="text-left px-5 py-3">Investor</th>
                <th className="text-left px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Due</th>
                <th className="text-left px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {calls.map(c => {
                const inv = investors.find(i => i.id === c.lp_investor_id);
                return (
                  <tr key={c.id}>
                    <td className="px-5 py-3 text-white">{inv?.name || `LP #${c.lp_investor_id}`}</td>
                    <td className="px-5 py-3 text-white">${c.amount.toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        c.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">{c.due_date || '—'}</td>
                    <td className="px-5 py-3">
                      {c.status === 'pending' && (
                        <button onClick={() => payCall(c.id)} className="text-xs text-emerald-400 hover:text-emerald-300">Mark Paid</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
