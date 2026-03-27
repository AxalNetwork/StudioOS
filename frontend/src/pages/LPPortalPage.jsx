import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, Clock, CheckCircle, AlertCircle, PieChart } from 'lucide-react';
import { api } from '../lib/api';

export default function LPPortalPage() {
  const [investors, setInvestors] = useState([]);
  const [calls, setCalls] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [selectedLP, setSelectedLP] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.listInvestors(),
      api.listCapitalCalls(),
      api.portfolio(),
    ]).then(([inv, c, p]) => {
      setInvestors(inv);
      setCalls(c);
      setPortfolio(p);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const selectLP = async (id) => {
    try {
      const detail = await api.getInvestor(id);
      setSelectedLP(detail);
    } catch (e) { alert(e.message); }
  };

  const totalCommitted = investors.reduce((s, i) => s + (i.committed_capital || 0), 0);
  const totalCalled = investors.reduce((s, i) => s + (i.called_capital || 0), 0);
  const pendingCalls = calls.filter(c => c.status === 'pending').length;
  const paidCalls = calls.filter(c => c.status === 'paid').length;

  if (loading) return <div className="text-gray-400 text-center py-20">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">LP Investor Portal</h1>
      <p className="text-sm text-gray-400 mb-6">Portfolio performance, capital calls, and returns tracking</p>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={DollarSign} label="Total Committed" value={`$${(totalCommitted / 1e6).toFixed(1)}M`} color="text-emerald-400" />
        <StatCard icon={TrendingUp} label="Capital Called" value={`$${(totalCalled / 1e6).toFixed(1)}M`} color="text-blue-400" />
        <StatCard icon={Clock} label="Pending Calls" value={pendingCalls} color="text-yellow-400" />
        <StatCard icon={PieChart} label="Portfolio Cos" value={portfolio?.total_projects || 0} color="text-violet-400" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-white">LP Investors</h3>
            </div>
            {investors.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No investors registered yet.</div>
            ) : (
              <div className="divide-y divide-gray-800/50">
                {investors.map(inv => (
                  <div key={inv.id} className="px-4 py-3 hover:bg-gray-800/30 cursor-pointer transition-colors"
                    onClick={() => selectLP(inv.id)}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-white">{inv.name}</div>
                        <div className="text-xs text-gray-500">{inv.email} {inv.fund_name ? `| ${inv.fund_name}` : ''}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-emerald-400">${inv.committed_capital?.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-500">Called: ${inv.called_capital?.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="mt-2 w-full bg-gray-800 rounded-full h-1.5">
                      <div className="bg-emerald-500 rounded-full h-1.5"
                        style={{ width: `${inv.committed_capital > 0 ? (inv.called_capital / inv.committed_capital * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          {selectedLP ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-3">{selectedLP.name}</h3>
              <div className="space-y-2 text-xs mb-4">
                <div className="flex justify-between"><span className="text-gray-500">Committed</span><span className="text-white">${selectedLP.committed_capital?.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Called</span><span className="text-white">${selectedLP.called_capital?.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Remaining</span><span className="text-emerald-400">${((selectedLP.committed_capital || 0) - (selectedLP.called_capital || 0)).toLocaleString()}</span></div>
                {selectedLP.fund_name && <div className="flex justify-between"><span className="text-gray-500">Fund</span><span className="text-white">{selectedLP.fund_name}</span></div>}
              </div>
              {selectedLP.capital_calls?.length > 0 && (
                <>
                  <h4 className="text-xs font-semibold text-gray-400 mb-2">Capital Calls</h4>
                  <div className="space-y-2">
                    {selectedLP.capital_calls.map(c => (
                      <div key={c.id} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg text-xs">
                        <span className="text-white">${c.amount?.toLocaleString()}</span>
                        <span className={`px-2 py-0.5 rounded-full ${
                          c.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'
                        }`}>{c.status}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-center">
              <p className="text-sm text-gray-500">Select an LP to view details</p>
            </div>
          )}
        </div>
      </div>

      {portfolio && portfolio.projects?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white">Live Portfolio Performance</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-2 text-gray-400 font-medium text-xs">Company</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium text-xs">Sector</th>
                <th className="text-center px-4 py-2 text-gray-400 font-medium text-xs">Status</th>
                <th className="text-center px-4 py-2 text-gray-400 font-medium text-xs">Score</th>
                <th className="text-center px-4 py-2 text-gray-400 font-medium text-xs">Week</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium text-xs">Revenue</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium text-xs">Users</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.projects.map(p => (
                <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2 text-white font-medium">{p.name}</td>
                  <td className="px-4 py-2 text-gray-300 text-xs">{p.sector || '—'}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      p.status === 'spinout' ? 'bg-emerald-500/20 text-emerald-400' :
                      p.status === 'tier_1' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-700 text-gray-300'
                    }`}>{p.status?.replace('_', ' ').toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-2 text-center text-sm">
                    <span className={p.score >= 85 ? 'text-emerald-400' : p.score >= 70 ? 'text-blue-400' : 'text-gray-400'}>
                      {p.score || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center text-xs text-gray-400">{p.playbook_week?.replace('_', ' ') || '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-300">{p.revenue ? `$${p.revenue.toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-300">{p.users || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
