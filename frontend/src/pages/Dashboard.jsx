import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, Zap, Users, DollarSign, Target, TrendingUp, Sparkles, Bell,
  RefreshCw, Loader2, Layers, Briefcase, Store, ArrowRight, ChevronRight, Wallet, Activity
} from 'lucide-react';
import { api } from '../lib/api';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [error, setError] = useState('');

  const load = async (fresh = false) => {
    try {
      setError('');
      const d = await api.getDashboard(fresh);
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setRefreshing(true);
    try { await api.refreshDashboardScores(); } catch {}
    load(true);
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-gray-500 py-20 justify-center">
      <Loader2 className="animate-spin" size={16} /> Loading your dashboard…
    </div>
  );
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded p-4 text-sm">{error}</div>;
  if (!data) return null;

  const { user, quick_stats, proprietary_deal_flow, ai_scored_opportunities, syndication_tools,
    performance_analytics, operator_workspace, notifications, role_view } = data;

  const isPartner = role_view === 'partner' || role_view === 'admin';
  const isOperator = role_view === 'founder' || role_view === 'admin' || (operator_workspace?.assigned_tasks?.length > 0);
  const unreadNotifs = notifications?.length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user.name?.split(' ')[0] || user.email.split('@')[0]}</h1>
            <RoleBadge role={user.role} />
          </div>
          <p className="text-sm text-gray-600">Here's your venture studio at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowNotifs(s => !s)} className="relative p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
              <Bell size={16} className="text-gray-700" />
              {unreadNotifs > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unreadNotifs}</span>}
            </button>
            {showNotifs && <NotifDropdown items={notifications} onClose={() => setShowNotifs(false)} />}
          </div>
          <button onClick={refresh} disabled={refreshing} className="flex items-center gap-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg">
            {refreshing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} Refresh Scores
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={DollarSign} label="This Month" value={`$${(quick_stats.month_earnings_cents / 100).toFixed(2)}`} sub={`Lifetime $${(quick_stats.lifetime_earnings_cents/100).toFixed(0)}`} color="emerald" />
        <Stat icon={Layers} label="Compounding" value={`$${(quick_stats.compound_earnings_cents / 100).toFixed(2)}`} sub={`L1+L2+L3 = ${quick_stats.network_reach}`} color="violet" />
        <Stat icon={Users} label="Syndicates" value={quick_stats.my_syndicates} sub={`${quick_stats.active_syndicates} open in market`} color="blue" />
        <Stat icon={Sparkles} label="AI Score Avg" value={quick_stats.ai_score_avg ?? '—'} sub={quick_stats.ai_score_avg ? 'Across your matches' : 'No scores yet'} color="amber" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Deal Flow + Operator Tasks */}
        <div className="lg:col-span-2 space-y-6">
          <Card title="Proprietary Deal Flow" icon={Target} link="/projects" linkLabel="View pipeline">
            {proprietary_deal_flow.length === 0 ? <Empty text="No active deals." /> : (
              <div className="divide-y divide-gray-100">
                {proprietary_deal_flow.slice(0, 6).map(d => (
                  <Link key={d.id} to={`/projects/${d.id}`} className="flex items-center gap-3 py-3 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">{d.name}</div>
                      <div className="text-xs text-gray-500 truncate">{d.sector || 'Unclassified'} • {d.stage || 'stage'}</div>
                    </div>
                    {d.score != null && <ScorePill score={d.score} />}
                    <StatusBadge status={d.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Performance Analytics */}
          <Card title="Performance Analytics" icon={BarChart3}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <MiniStat label="Pending Payouts" value={`$${(quick_stats.pending_payouts_cents/100).toFixed(2)}`} />
              <MiniStat label="Network Reach" value={quick_stats.network_reach} />
              <MiniStat label="L1 / L2 / L3" value={`${performance_analytics.chain_counts.L1}/${performance_analytics.chain_counts.L2}/${performance_analytics.chain_counts.L3}`} />
              <MiniStat label="Active Syndicates" value={quick_stats.active_syndicates} />
            </div>
            <div className="mb-4">
              <div className="text-xs text-gray-500 mb-2 font-medium">Earnings — Last 30 Days</div>
              <Sparkline series={performance_analytics.earnings_series_30d} />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium text-gray-700 mb-2">Recent Commissions</div>
                {performance_analytics.recent_commissions.length === 0 ? <Empty text="None yet." /> : (
                  <div className="space-y-1">
                    {performance_analytics.recent_commissions.slice(0, 5).map(c => (
                      <div key={c.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-0">
                        <div className="truncate flex-1 text-gray-700">{c.description}</div>
                        <div className="font-bold text-emerald-600 ml-2">+${(c.amount_cents/100).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-gray-700 mb-2">Top Referrers in Your Chain</div>
                {performance_analytics.top_referrers.length === 0 ? <Empty text="None yet." /> : (
                  <div className="space-y-1">
                    {performance_analytics.top_referrers.map(r => (
                      <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-0">
                        <div className="truncate flex-1 text-gray-700">{r.name || r.email}</div>
                        <div className="text-gray-500">{r.downstream} downstream</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {isOperator && operator_workspace?.assigned_tasks?.length > 0 && (
            <Card title="My Studio Ops Tasks" icon={Briefcase} link="/studio-ops" linkLabel="Open Studio Ops">
              <div className="divide-y divide-gray-100">
                {operator_workspace.assigned_tasks.slice(0, 6).map(t => (
                  <div key={t.id} className="py-2 flex items-center gap-3 text-sm">
                    <PriorityDot p={t.priority} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{t.title}</div>
                      <div className="text-xs text-gray-500 truncate">{t.workflow_title} • {t.type}</div>
                    </div>
                    <span className="text-[10px] uppercase text-gray-500">{t.status}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT: AI Matches + Syndication */}
        <div className="space-y-6">
          {isPartner && (
            <Card title="AI-Scored Opportunities" icon={Sparkles} link="/matches" linkLabel="All matches">
              {ai_scored_opportunities.length === 0 ? <Empty text="Set your investor preferences to see AI-scored matches." /> : (
                <div className="space-y-3">
                  {ai_scored_opportunities.slice(0, 5).map(m => (
                    <div key={m.id} className="border border-gray-200 rounded-lg p-3 hover:border-violet-400 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-medium text-sm text-gray-900 truncate">{m.deal_name || `Deal #${m.deal_id}`}</div>
                        <ScorePill score={m.score} />
                      </div>
                      {m.explanation && <div className="text-xs text-gray-600 line-clamp-2">{m.explanation}</div>}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] uppercase text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{m.score_type}</span>
                        {m.deal_id && <Link to={`/projects/${m.deal_id}`} className="text-[10px] text-violet-600 hover:text-violet-700 flex items-center gap-1">View <ArrowRight size={10} /></Link>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card title="Syndication Tools" icon={Users} link="/network-effects" linkLabel="Network Effects">
            <Link to="/network-effects" className="block w-full text-center bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-lg mb-4">+ Create Syndicate</Link>

            {syndication_tools.ai_recommendations?.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-violet-700 mb-2 flex items-center gap-1"><Sparkles size={12} /> Recommended for You</div>
                {syndication_tools.ai_recommendations.slice(0, 3).map(s => (
                  <div key={s.id} className="border border-violet-200 bg-violet-50/50 rounded-lg p-2 mb-2">
                    <div className="flex items-start justify-between gap-2"><div className="font-medium text-xs text-gray-900">{s.name}</div>{s.score != null && <ScorePill score={s.score} small />}</div>
                    <div className="text-[10px] text-gray-600 mt-1 line-clamp-1">{s.description}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs font-medium text-gray-700 mb-2">Open Syndicates ({syndication_tools.open_syndicates.length})</div>
            {syndication_tools.open_syndicates.length === 0 ? <Empty text="None open right now." /> : (
              <div className="space-y-2">
                {syndication_tools.open_syndicates.slice(0, 4).map(s => {
                  const pct = s.target_cents ? Math.min(100, Math.round((s.committed_cents / s.target_cents) * 100)) : 0;
                  return (
                    <Link key={s.id} to="/network-effects" className="block border border-gray-200 rounded-lg p-2 hover:border-violet-400 transition-colors">
                      <div className="font-medium text-xs text-gray-900 truncate">{s.name}</div>
                      <div className="text-[10px] text-gray-500">{s.members} members • ${(s.committed_cents/100).toLocaleString()}{s.target_cents && ` / $${(s.target_cents/100).toLocaleString()}`}</div>
                      {s.target_cents && <div className="bg-gray-100 rounded-full h-1 mt-1 overflow-hidden"><div className="h-full bg-violet-500" style={{width: `${pct}%`}} /></div>}
                    </Link>
                  );
                })}
              </div>
            )}

            {syndication_tools.my_memberships?.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-medium text-gray-700 mb-2">My Commitments</div>
                {syndication_tools.my_memberships.slice(0, 3).map(m => (
                  <div key={m.id} className="text-xs flex justify-between py-1 border-b border-gray-100 last:border-0">
                    <span className="truncate">{m.name}</span>
                    <span className="font-bold text-gray-900 ml-2">${(m.commitment_cents/100).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <QuickLinks role={role_view} />
          <IndependentSubsidiariesWidget />
        </div>
      </div>
    </div>
  );
}

function IndependentSubsidiariesWidget() {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { setSubs(await api.independentSubsidiaries()); } finally { setLoading(false); } })(); }, []);
  if (loading) return null;
  if (!subs.length) return null;
  return (
    <Card title="Independent Subsidiaries" icon={Briefcase} link="/legal-capital" linkLabel="Manage">
      <div className="space-y-2">
        {subs.slice(0, 5).map(s => (
          <div key={s.id} className="border border-emerald-100 bg-emerald-50/40 rounded-lg p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm truncate">{s.subsidiary_name}</div>
              <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded">SCALING</span>
            </div>
            <div className="text-[10px] text-gray-600 mt-0.5">{s.jurisdiction} {s.ein && `• EIN ${s.ein}`}</div>
            {s.equity_allocation_json && Object.keys(s.equity_allocation_json).length > 0 && (
              <div className="text-[10px] text-gray-500 mt-1">Studio: {s.equity_allocation_json.studio_pct}% • Founders: {s.equity_allocation_json.founders_pct}%</div>
            )}
            {s.post_spinout_dashboard_url && (
              <a href={s.post_spinout_dashboard_url} className="text-[10px] text-violet-600 hover:underline">Open dashboard →</a>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Subcomponents ----------

function Card({ title, icon: Icon, link, linkLabel, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Icon size={16} className="text-violet-600" /> {title}</h3>
        {link && <Link to={link} className="text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1">{linkLabel} <ChevronRight size={12} /></Link>}
      </div>
      {children}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, color = 'violet' }) {
  const colors = {
    violet: 'bg-violet-100 text-violet-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    blue: 'bg-blue-100 text-blue-600',
    amber: 'bg-amber-100 text-amber-600',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}><Icon size={14} /></div>
        <span className="text-xs text-gray-600 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-1 truncate">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="text-sm font-bold text-gray-900 truncate">{value}</div>
    </div>
  );
}

function Sparkline({ series }) {
  const data = useMemo(() => {
    const max = Math.max(1, ...series.map(s => s.cents));
    return series.map((s, i) => ({ x: i, y: s.cents, h: (s.cents / max) * 100 }));
  }, [series]);
  const total = series.reduce((a, s) => a + s.cents, 0);
  return (
    <div>
      <div className="flex items-end gap-px h-16 bg-gray-50 rounded p-1">
        {data.map((d, i) => (
          <div key={i} className="flex-1 bg-violet-500 hover:bg-violet-700 rounded-sm transition-colors" style={{ height: `${Math.max(2, d.h)}%` }} title={`${series[i].day}: $${(d.y/100).toFixed(2)}`} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1"><span>30 days ago</span><span>Total: ${(total/100).toFixed(2)}</span><span>Today</span></div>
    </div>
  );
}

function ScorePill({ score, small }) {
  const c = score >= 80 ? 'bg-emerald-100 text-emerald-700' : score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'} font-bold rounded ${c}`}>{Math.round(score)}</span>;
}

function PriorityDot({ p }) {
  const c = p === 'high' ? 'bg-red-500' : p === 'medium' ? 'bg-amber-500' : 'bg-gray-400';
  return <span className={`w-2 h-2 rounded-full ${c} flex-shrink-0`} />;
}

function RoleBadge({ role }) {
  const styles = { admin: 'bg-violet-600 text-white', partner: 'bg-blue-100 text-blue-700', founder: 'bg-emerald-100 text-emerald-700' };
  return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${styles[role] || 'bg-gray-100 text-gray-700'}`}>{role}</span>;
}

function Empty({ text }) { return <div className="text-xs text-gray-500 py-4 text-center">{text}</div>; }

function NotifDropdown({ items, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
        <div className="px-4 py-2 border-b border-gray-200 font-semibold text-sm flex items-center gap-2"><Bell size={14} /> Recent Activity</div>
        {(!items || items.length === 0) ? (
          <div className="text-xs text-gray-500 text-center py-6">No recent activity.</div>
        ) : items.map((n, i) => (
          <div key={i} className="px-4 py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <div className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.kind === 'commission' ? 'bg-emerald-500' : 'bg-violet-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-900 truncate">{n.title}</div>
                <div className="text-[10px] text-gray-500 flex items-center gap-2">
                  <span>{n.kind === 'commission' ? '💰' : '🤝'} {n.kind}</span>
                  {n.amount_cents != null && <span className="font-bold text-emerald-600">+${(n.amount_cents/100).toFixed(2)}</span>}
                  <span>{new Date(n.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function QuickLinks({ role }) {
  const links = [
    { to: '/matches', label: 'AI Matches', icon: Sparkles, roles: ['admin', 'partner'] },
    { to: '/network-effects', label: 'Network Effects', icon: TrendingUp, roles: ['admin', 'partner', 'founder'] },
    { to: '/network', label: 'Referral Network', icon: Users, roles: ['admin', 'partner', 'founder'] },
    { to: '/studio-ops', label: 'Studio Ops', icon: Briefcase, roles: ['admin', 'partner', 'founder'] },
    { to: '/payouts', label: 'Payouts', icon: Wallet, roles: ['admin', 'partner', 'founder'] },
    { to: '/admin', label: 'Admin Panel', icon: Activity, roles: ['admin'] },
  ];
  const filtered = links.filter(l => l.roles.includes(role) || role === 'admin');
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-xs font-semibold text-gray-700 mb-3">Quick Links</div>
      <div className="grid grid-cols-2 gap-2">
        {filtered.map(l => {
          const Icon = l.icon;
          return (
            <Link key={l.to} to={l.to} className="flex items-center gap-2 text-xs text-gray-700 hover:bg-violet-50 hover:text-violet-700 p-2 rounded transition-colors">
              <Icon size={12} /> {l.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Re-exported helpers used by other pages ----------

function StatusBadge({ status }) {
  const styles = {
    intake: 'bg-gray-100 text-gray-700',
    scoring: 'bg-amber-100 text-amber-700',
    tier_1: 'bg-emerald-100 text-emerald-700',
    tier_2: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
    spinout: 'bg-violet-100 text-violet-700',
    active: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-medium ${styles[status] || styles.intake}`}>
      {status?.replace('_', ' ')}
    </span>
  );
}

function WeekBadge({ week }) {
  if (!week || week === 'complete') return week === 'complete' ? <span className="text-[10px] text-emerald-400">Complete</span> : null;
  const num = week.replace('week_', 'W');
  return <span className="text-[10px] text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{num}</span>;
}

export { StatusBadge, WeekBadge };
