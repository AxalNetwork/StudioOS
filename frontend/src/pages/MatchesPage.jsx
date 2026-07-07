import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Target, TrendingUp, Users, Settings, Loader2, RefreshCw, Brain, ChevronDown, Building2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';

export default function MatchesPage() {
  const { role } = useAuth();
  const [tab, setTab] = useState('deal-flow');
  const [profile, setProfile] = useState(null);

  const isFounder = String(role || '').toLowerCase() === 'founder';

  // Investor thesis is now the canonical investor-profile store, edited from
  // Settings → Privacy → "My thesis". We only read it here to nudge investors
  // who haven't set any sectors yet.
  useEffect(() => {
    if (isFounder) return;
    (async () => {
      try { setProfile((await api.getInvestorProfile())?.profile || null); }
      catch { /* soft — the nudge just won't render */ }
    })();
  }, [isFounder]);
  const tabs = [
    { id: 'deal-flow', label: 'Deal Flow', icon: Target, investorOnly: true },
    { id: 'co-invest', label: 'Co-Investment', icon: TrendingUp, investorOnly: true },
    { id: 'referrals', label: 'Referral Quality', icon: Users, investorOnly: true },
    { id: 'investor-match', label: 'Investor Match', icon: Building2, founderOnly: true },
  ].filter(t => {
    if (t.investorOnly && isFounder) return false;
    if (t.founderOnly && !isFounder) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Sparkles className="text-violet-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">AI Matching Engine</h1>
            <p className="text-sm text-gray-600">Personalized deal flow, co-investment, and referral signals — scored by Cloudflare Workers AI.</p>
          </div>
        </div>
        {!isFounder && (
          <Link to="/settings/privacy"
            className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-sm text-gray-700 px-3 py-2 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
            <Settings size={14} /> My thesis
          </Link>
        )}
      </div>

      {profile && !isFounder && !profile.sectors?.length && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-6 text-xs text-amber-800 flex items-center justify-between">
          <span>Set your investment thesis to get high-signal matches.</span>
          <Link to="/settings/privacy" className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1 rounded">Configure</Link>
        </div>
      )}

      <div className="border-b border-gray-200 mb-6 flex gap-1 dark:border-gray-800">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'deal-flow' && <DealFlow />}
      {tab === 'co-invest' && <CoInvest />}
      {tab === 'referrals' && <ReferralScores />}
      {tab === 'investor-match' && <InvestorMatch />}
    </div>
  );
}

function InvestorMatch() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list = (await api.listProjects()) || [];
        const safe = Array.isArray(list) ? list : (list?.projects || []);
        setProjects(safe);
        if (safe.length === 1) setProjectId(safe[0].id);
      } catch {}
    })();
  }, []);

  const run = async () => {
    if (!projectId) return;
    setLoading(true); setError(''); setData(null);
    try { setData(await api.matchInvestors(projectId)); }
    catch (e) { setError(e.message || 'Failed to match'); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <select value={projectId || ''} onChange={e => setProjectId(Number(e.target.value))}
            className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100">
            <option value="">Select a startup to match</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sector || 'Other'})</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
        <button onClick={run} disabled={!projectId || loading}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {loading ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
          {loading ? 'Matching…' : 'Run Match'}
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</div>}

      {data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {data.ranked?.length || 0} ranked • {data.excluded?.length || 0} excluded • {data.total_investors} total investors
            </p>
            <button onClick={run} className="text-xs text-violet-600 hover:underline flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
          </div>

          {data.ranked?.length > 0 && (
            <div className="space-y-3">
              {data.ranked.map((it, i) => (
                <div key={it.user_id} className="bg-white border border-gray-200 rounded-xl p-5 flex gap-5 items-start dark:bg-gray-900 dark:border-gray-800">
                  <div className="flex-shrink-0">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                      i === 0 ? 'bg-amber-400 text-white' : i < 3 ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-700'
                    }`}>{i + 1}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{it.name}</h3>
                      <ScorePill score={it.match_score} />
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      {it.thesis?.sectors?.join(', ') || 'No sectors'} • {it.thesis?.stages?.join(', ') || 'No stages'} • {it.thesis?.ticket_band || 'No ticket band'}
                    </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <BreakdownPill label="Thesis" value={it.breakdown?.thesis_fit} weight={0.45} />
                      <BreakdownPill label="Traction" value={it.breakdown?.traction_fit} weight={0.20} />
                      <BreakdownPill label="Values" value={it.breakdown?.values_alignment} weight={0.20} />
                      <BreakdownPill label="Network" value={it.breakdown?.network_warmth} weight={0.15} />
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed dark:text-gray-400">
                      {it.reasons?.slice(0, 4).join(' • ')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.excluded?.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
              <h4 className="text-xs font-semibold text-gray-700 mb-2 dark:text-gray-300">Excluded ({data.excluded.length})</h4>
              <div className="space-y-2">
                {data.excluded.slice(0, 5).map(ex => (
                  <div key={ex.user_id} className="text-xs text-gray-500 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-300" />
                    {ex.name} — <span className="text-red-600">{ex.reason}</span>
                  </div>
                ))}
                {data.excluded.length > 5 && (
                  <div className="text-xs text-gray-400">…and {data.excluded.length - 5} more</div>
                )}
              </div>
            </div>
          )}

          {!data.ranked?.length && !data.excluded?.length && (
            <Empty text="No investors available for matching right now." />
          )}
        </div>
      )}
    </div>
  );
}

function BreakdownPill({ label, value, weight }) {
  return (
    <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded dark:bg-gray-800 dark:text-gray-400">
      {label} {Math.round(value || 0)} × {weight}
    </span>
  );
}

function DealFlow() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await api.matchDealFlow()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <Loading text="Scoring deal flow…" />;
  if (error) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>;
  if (!data?.items?.length) return <Empty text="No deals available yet. Once founders submit projects, your matches will appear here." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">{data.items.length} deals scored • LLM budget remaining this request: {data.llm_budget_remaining}</p>
        <button onClick={load} className="text-xs text-violet-600 hover:underline flex items-center gap-1"><RefreshCw size={12} /> Refresh</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.items.map(it => <DealCard key={it.project.id} item={it} />)}
      </div>
    </div>
  );
}

function CoInvest() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try { setData(await api.matchCoInvest()); }
      catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Loading text="Finding co-investment opportunities…" />;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data?.items?.length) return <Empty text="No active co-investment opportunities right now." />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 mb-3">Top {data.items.length} of {data.total} active deals, ranked for you.</p>
      {data.items.map((it, i) => (
        <div key={it.project.id} className="bg-white border border-gray-200 rounded-xl p-5 flex gap-5 items-start dark:bg-gray-900 dark:border-gray-800">
          <div className="flex-shrink-0">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
              i === 0 ? 'bg-amber-400 text-white' : i < 3 ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-700'
            }`}>{i + 1}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{it.project.name}</h3>
              <ScorePill score={it.score} />
            </div>
            <div className="text-xs text-gray-500 mb-2">{it.project.sector} • {it.project.stage} • {it.project.status}</div>
            <p className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">{it.explanation}</p>
            {it.project.funding_needed && (
              <div className="text-xs text-gray-500 mt-2">Funding needed: ${Number(it.project.funding_needed).toLocaleString()}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReferralScores() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try { setData(await api.matchReferralScores()); }
      catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Loading text="Scoring your referrals…" />;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data?.items?.length) return <Empty text="No referrals yet. Share your link from the Refer & Earn page." />;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs text-gray-600">
            <th className="px-6 py-3 font-medium">Referral</th>
            <th className="px-6 py-3 font-medium">KYC</th>
            <th className="px-6 py-3 font-medium">Status</th>
            <th className="px-6 py-3 font-medium">Quality Score</th>
            <th className="px-6 py-3 font-medium">AI Insight</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.items.map(it => (
            <tr key={it.referral.id}>
              <td className="px-6 py-3">
                <div className="font-medium text-gray-900 dark:text-gray-100">{it.referral.name}</div>
                <div className="text-xs text-gray-500">{it.referral.email}</div>
              </td>
              <td className="px-6 py-3"><Pill v={it.referral.kyc_status || 'not_started'} /></td>
              <td className="px-6 py-3"><Pill v={it.referral.status} /></td>
              <td className="px-6 py-3"><ScorePill score={it.score} /></td>
              <td className="px-6 py-3 text-xs text-gray-700 max-w-md dark:text-gray-300">{it.explanation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealCard({ item }) {
  const p = item.project;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate dark:text-gray-100">{p.name}</h3>
          <div className="text-xs text-gray-500 mt-0.5">{p.sector || 'Other'} • {p.stage} • {p.status}</div>
        </div>
        <ScorePill score={item.score} />
      </div>
      {p.problem_statement && <p className="text-xs text-gray-700 mt-2 line-clamp-2 dark:text-gray-300">{p.problem_statement}</p>}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
          <Brain size={12} className="text-violet-500 flex-shrink-0 mt-0.5" />
          <span className="leading-relaxed">{item.explanation}</span>
        </div>
        <div className="text-[10px] text-gray-400 mt-2">{item.cached ? 'Cached' : 'Fresh'} • {item.model || 'rule-based'}</div>
      </div>
    </div>
  );
}

function ScorePill({ score }) {
  const color = score >= 80 ? 'bg-emerald-100 text-emerald-700' : score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-bold px-2 py-1 rounded ${color}`}>{Math.round(score)}</span>;
}
function Pill({ v }) {
  const colors = { approved: 'bg-emerald-100 text-emerald-700', converted: 'bg-violet-100 text-violet-700', pending: 'bg-amber-100 text-amber-700', rejected: 'bg-red-100 text-red-700', not_started: 'bg-gray-100 text-gray-600' };
  return <span className={`text-[11px] px-2 py-1 rounded ${colors[v] || 'bg-gray-100 text-gray-600'}`}>{(v || '').replace('_', ' ')}</span>;
}
function Loading({ text }) {
  return <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center"><Loader2 className="animate-spin" size={16} /> {text}</div>;
}
function Empty({ text }) {
  return <div className="text-center py-12 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl dark:border-gray-800">{text}</div>;
}
