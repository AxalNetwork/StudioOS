import React, { useEffect, useState } from 'react';
import { Sparkles, Target, TrendingUp, Users, Settings, Loader2, Save, RefreshCw, Brain, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';

const SECTORS = ['AI', 'Fintech', 'Climate', 'Health', 'B2B SaaS', 'Consumer', 'Crypto', 'DevTools', 'Marketplaces', 'Hardware'];
const STAGES = ['idea', 'mvp', 'traction_review', 'spinout_ready', 'tier_1', 'tier_2'];
const ROLES = ['Lead Investor', 'Co-Investor', 'Operator', 'Advisor', 'Board Member'];

export default function MatchesPage() {
  const [tab, setTab] = useState('deal-flow');
  const [prefs, setPrefs] = useState(null);
  const [editPrefs, setEditPrefs] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => { (async () => { try { setPrefs(await api.matchPreferences()); } catch {} })(); }, []);

  const savePrefs = async (next) => {
    setSavingPrefs(true);
    try {
      await api.matchPreferencesSave({
        ...next,
        min_check_cents: next.min_check_dollars ? Math.round(parseFloat(next.min_check_dollars) * 100) : null,
        max_check_cents: next.max_check_dollars ? Math.round(parseFloat(next.max_check_dollars) * 100) : null,
      });
      setPrefs(await api.matchPreferences());
      setEditPrefs(false);
    } finally { setSavingPrefs(false); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Sparkles className="text-violet-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Matching Engine</h1>
            <p className="text-sm text-gray-600">Personalized deal flow, co-investment, and referral signals — scored by Cloudflare Workers AI.</p>
          </div>
        </div>
        <button onClick={() => setEditPrefs(true)}
          className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-sm text-gray-700 px-3 py-2 rounded-lg">
          <Settings size={14} /> Investor Preferences
        </button>
      </div>

      {prefs && !prefs.investment_focus?.length && !editPrefs && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-6 text-xs text-amber-800 flex items-center justify-between">
          <span>Set your investment preferences to get high-signal matches.</span>
          <button onClick={() => setEditPrefs(true)} className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1 rounded">Configure</button>
        </div>
      )}

      <div className="border-b border-gray-200 mb-6 flex gap-1">
        {[
          { id: 'deal-flow', label: 'Deal Flow', icon: Target },
          { id: 'co-invest', label: 'Co-Investment', icon: TrendingUp },
          { id: 'referrals', label: 'Referral Quality', icon: Users },
        ].map(t => {
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

      {editPrefs && prefs && (
        <PreferencesModal initial={prefs} onClose={() => setEditPrefs(false)} onSave={savePrefs} saving={savingPrefs} />
      )}
    </div>
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
        <div key={it.project.id} className="bg-white border border-gray-200 rounded-xl p-5 flex gap-5 items-start">
          <div className="flex-shrink-0">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
              i === 0 ? 'bg-amber-400 text-white' : i < 3 ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-700'
            }`}>{i + 1}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="font-semibold text-gray-900 truncate">{it.project.name}</h3>
              <ScorePill score={it.score} />
            </div>
            <div className="text-xs text-gray-500 mb-2">{it.project.sector} • {it.project.stage} • {it.project.status}</div>
            <p className="text-sm text-gray-700 leading-relaxed">{it.explanation}</p>
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
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
                <div className="font-medium text-gray-900">{it.referral.name}</div>
                <div className="text-xs text-gray-500">{it.referral.email}</div>
              </td>
              <td className="px-6 py-3"><Pill v={it.referral.kyc_status || 'not_started'} /></td>
              <td className="px-6 py-3"><Pill v={it.referral.status} /></td>
              <td className="px-6 py-3"><ScorePill score={it.score} /></td>
              <td className="px-6 py-3 text-xs text-gray-700 max-w-md">{it.explanation}</td>
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
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
          <div className="text-xs text-gray-500 mt-0.5">{p.sector || 'Other'} • {p.stage} • {p.status}</div>
        </div>
        <ScorePill score={item.score} />
      </div>
      {p.problem_statement && <p className="text-xs text-gray-700 mt-2 line-clamp-2">{p.problem_statement}</p>}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-start gap-2 text-xs text-gray-700">
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
  return <div className="text-center py-12 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl">{text}</div>;
}

function PreferencesModal({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState({
    investment_focus: initial.investment_focus || [],
    preferred_stages: initial.preferred_stages || [],
    preferred_roles: initial.preferred_roles || [],
    min_check_dollars: initial.min_check_cents ? (initial.min_check_cents / 100).toString() : '',
    max_check_dollars: initial.max_check_cents ? (initial.max_check_cents / 100).toString() : '',
    risk_tolerance: initial.risk_tolerance || 'medium',
    bio: initial.bio || '',
  });
  const toggle = (key, val) => setForm(f => ({
    ...f, [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val]
  }));

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Investor Preferences</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 text-xl">×</button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="text-xs text-gray-700 font-medium block mb-2">Investment Focus (sectors)</label>
            <div className="flex flex-wrap gap-2">
              {SECTORS.map(s => (
                <button key={s} onClick={() => toggle('investment_focus', s)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${form.investment_focus.includes(s) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-700 border-gray-300 hover:border-violet-400'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-700 font-medium block mb-2">Preferred Stages</label>
            <div className="flex flex-wrap gap-2">
              {STAGES.map(s => (
                <button key={s} onClick={() => toggle('preferred_stages', s)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${form.preferred_stages.includes(s) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-700 border-gray-300 hover:border-violet-400'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-700 font-medium block mb-2">Preferred Roles</label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map(s => (
                <button key={s} onClick={() => toggle('preferred_roles', s)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${form.preferred_roles.includes(s) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-700 border-gray-300 hover:border-violet-400'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1">Min Check ($)</label>
              <input type="number" min="0" value={form.min_check_dollars} onChange={e => setForm(f => ({ ...f, min_check_dollars: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-700 font-medium block mb-1">Max Check ($)</label>
              <input type="number" min="0" value={form.max_check_dollars} onChange={e => setForm(f => ({ ...f, max_check_dollars: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-700 font-medium block mb-1">Risk Tolerance</label>
            <div className="relative">
              <select
                value={form.risk_tolerance}
                onChange={e => setForm(f => ({ ...f, risk_tolerance: e.target.value }))}
                className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer"
              >
                <option value="low">Low — proven traction only</option>
                <option value="medium">Medium — balanced</option>
                <option value="high">High — early/contrarian bets</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-700 font-medium block mb-1">Bio / Thesis (optional)</label>
            <textarea rows={3} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              placeholder="What's your investment thesis or area of expertise?"
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-lg">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}
