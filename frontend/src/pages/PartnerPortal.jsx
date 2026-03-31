import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Handshake, DollarSign, CheckCircle, Clock, TrendingUp, PieChart, Users } from 'lucide-react';

const statusColors = {
  applied: 'bg-blue-100 text-blue-700',
  scored: 'bg-yellow-100 text-yellow-700',
  active: 'bg-green-100 text-green-700',
  funded: 'bg-violet-100 text-violet-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function PartnerPortal() {
  const [deals, setDeals] = useState([]);
  const [calls, setCalls] = useState([]);
  const [partners, setPartners] = useState([]);
  const [investors, setInvestors] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [selectedLP, setSelectedLP] = useState(null);
  const [tab, setTab] = useState('deals');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [d, c, p, inv, port] = await Promise.all([
        api.listDeals(),
        api.listCapitalCalls(),
        api.listPartners(),
        api.listInvestors(),
        api.portfolio(),
      ]);
      setDeals(d);
      setCalls(c);
      setPartners(p);
      setInvestors(inv);
      setPortfolio(port);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const acceptCall = async (callId) => {
    try {
      await api.payCapitalCall(callId);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const selectLP = async (id) => {
    try {
      const detail = await api.getInvestor(id);
      setSelectedLP(detail);
    } catch (e) {
      console.error(e);
    }
  };

  const totalCommitted = investors.reduce((s, i) => s + (i.committed_capital || 0), 0);
  const totalCalled = investors.reduce((s, i) => s + (i.called_capital || 0), 0);
  const pendingCalls = calls.filter(c => c.status === 'pending').length;

  if (loading) return <div className="text-gray-600 text-center py-20">Loading...</div>;

  const tabs = [
    { id: 'deals', label: 'Deals', icon: Handshake, count: deals.length },
    { id: 'calls', label: 'Capital Calls', icon: DollarSign, count: calls.length },
    { id: 'investors', label: 'LP Investors', icon: Users, count: investors.length },
    { id: 'portfolio', label: 'Portfolio', icon: PieChart, count: portfolio?.total_projects || 0 },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Partner / Investor Portal</h1>
      <p className="text-gray-600 mb-6">Deal flow, capital calls, LP investors, and portfolio performance</p>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Handshake} label="Active Deals" value={deals.length} color="text-violet-600" />
        <StatCard icon={DollarSign} label="Total Committed" value={`$${(totalCommitted / 1e6).toFixed(1)}M`} color="text-emerald-600" />
        <StatCard icon={TrendingUp} label="Capital Called" value={`$${(totalCalled / 1e6).toFixed(1)}M`} color="text-blue-600" />
        <StatCard icon={Clock} label="Pending Calls" value={pendingCalls} color="text-amber-600" />
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-violet-600 text-white' : 'bg-gray-50 text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}>
            <t.icon size={14} className="inline mr-2" />{t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === 'deals' && (
        <div className="space-y-3">
          {deals.length === 0 ? (
            <EmptyState message="No deals in the pipeline yet" />
          ) : (
            deals.map(deal => (
              <div key={deal.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-gray-900 font-medium">{deal.project_name || `Project #${deal.project_id}`}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[deal.status] || 'bg-gray-200 text-gray-600'}`}>
                      {deal.status?.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {deal.project_sector && <span className="mr-4">Sector: {deal.project_sector}</span>}
                    {deal.partner_name && <span className="mr-4">Partner: {deal.partner_name}</span>}
                    {deal.amount && <span>Amount: ${deal.amount.toLocaleString()}</span>}
                  </div>
                  {deal.notes && <p className="text-xs text-gray-500 mt-1">{deal.notes}</p>}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(deal.created_at).toLocaleDateString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'calls' && (
        <div className="space-y-3">
          {calls.length === 0 ? (
            <EmptyState message="No capital calls yet" />
          ) : (
            calls.map(call => (
              <div key={call.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${call.status === 'paid' ? 'bg-green-100' : 'bg-amber-100'}`}>
                  {call.status === 'paid' ? <CheckCircle size={20} className="text-green-600" /> : <Clock size={20} className="text-amber-600" />}
                </div>
                <div className="flex-1">
                  <div className="text-gray-900 font-medium">${call.amount?.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">
                    {call.due_date && <span className="mr-4">Due: {call.due_date}</span>}
                    <span className={call.status === 'paid' ? 'text-green-600' : 'text-amber-600'}>
                      {call.status?.toUpperCase()}
                    </span>
                  </div>
                </div>
                {call.status === 'pending' && (
                  <button onClick={() => acceptCall(call.id)} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                    <CheckCircle size={14} /> Accept
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'investors' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">LP Investors</h3>
              </div>
              {investors.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">No investors registered yet.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {investors.map(inv => (
                    <div key={inv.id} className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => selectLP(inv.id)}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{inv.name}</div>
                          <div className="text-xs text-gray-500">{inv.email} {inv.fund_name ? `| ${inv.fund_name}` : ''}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-emerald-600">${inv.committed_capital?.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-500">Called: ${inv.called_capital?.toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
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
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">{selectedLP.name}</h3>
                <div className="space-y-2 text-xs mb-4">
                  <div className="flex justify-between"><span className="text-gray-500">Committed</span><span className="text-gray-900">${selectedLP.committed_capital?.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Called</span><span className="text-gray-900">${selectedLP.called_capital?.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Remaining</span><span className="text-emerald-600">${((selectedLP.committed_capital || 0) - (selectedLP.called_capital || 0)).toLocaleString()}</span></div>
                  {selectedLP.fund_name && <div className="flex justify-between"><span className="text-gray-500">Fund</span><span className="text-gray-900">{selectedLP.fund_name}</span></div>}
                </div>
                {selectedLP.capital_calls?.length > 0 && (
                  <>
                    <h4 className="text-xs font-semibold text-gray-600 mb-2">Capital Calls</h4>
                    <div className="space-y-2">
                      {selectedLP.capital_calls.map(c => (
                        <div key={c.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-xs">
                          <span className="text-gray-900">${c.amount?.toLocaleString()}</span>
                          <span className={`px-2 py-0.5 rounded-full ${
                            c.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>{c.status}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl p-5 text-center">
                <p className="text-sm text-gray-500">Select an LP to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'portfolio' && portfolio && (
        <>
          {portfolio.projects?.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">Live Portfolio Performance</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-2 text-gray-600 font-medium text-xs">Company</th>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium text-xs">Sector</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium text-xs">Status</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium text-xs">Score</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium text-xs">Week</th>
                    <th className="text-right px-4 py-2 text-gray-600 font-medium text-xs">Revenue</th>
                    <th className="text-right px-4 py-2 text-gray-600 font-medium text-xs">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.projects.map(p => (
                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900 font-medium">{p.name}</td>
                      <td className="px-4 py-2 text-gray-700 text-xs">{p.sector || '—'}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          p.status === 'spinout' ? 'bg-emerald-100 text-emerald-700' :
                          p.status === 'tier_1' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-200 text-gray-700'
                        }`}>{p.status?.replace('_', ' ').toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2 text-center text-sm">
                        <span className={p.score >= 85 ? 'text-emerald-600' : p.score >= 70 ? 'text-blue-600' : 'text-gray-600'}>
                          {p.score || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-600">{p.playbook_week?.replace('_', ' ') || '—'}</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">{p.revenue ? `$${p.revenue.toLocaleString()}` : '—'}</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700">{p.users || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No portfolio companies yet" />
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
      {message}
    </div>
  );
}
