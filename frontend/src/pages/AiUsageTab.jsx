import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { RefreshCw, AlertTriangle, Sparkles, Zap, Clock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';

function fmtUsd(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}
function fmtPct(n) { return `${((Number(n) || 0) * 100).toFixed(1)}%`; }

// Static accent map — Tailwind purges classes it can't see at build time,
// so dynamic strings like `bg-${accent}-100` would be stripped from the
// production CSS. This keeps every utility literally present in source.
const ACCENT_CLASSES = {
  violet:  'bg-violet-100 text-violet-700',
  amber:   'bg-amber-100 text-amber-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  red:     'bg-red-100 text-red-700',
};

function StatCard({ icon: Icon, label, value, sub, accent = 'violet' }) {
  const accentCls = ACCENT_CLASSES[accent] || ACCENT_CLASSES.violet;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`h-8 w-8 rounded-lg ${accentCls} flex items-center justify-center`}>
          <Icon size={15} />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

// Task #4 (CG) — classify a `task` row from ai_usage_logs into a
// surface label so admins can filter advisor traffic separately from
// the onboarding chatbot. Pure client-side: the report endpoint
// already groups by `task` (see services/aiRouter.ts::loadAiUsageReport).
function surfaceOf(taskName) {
  const t = String(taskName || '');
  if (t.startsWith('advisor_')) return 'advisor';
  if (t.startsWith('onboarding_') || t === 'role_detect' || t === 'tool_call') return 'onboarding';
  return 'other';
}

export default function AiUsageTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  // Task #4 (CG) — Surface filter: 'all' | 'advisor' | 'onboarding' | 'other'.
  // Filters the per-task & per-model tables and the headline stat cards
  // client-side. by_day stays at the un-filtered window because the
  // server doesn't break by_day down by task (would need a new column
  // in the report payload — out of scope for CG).
  const [surface, setSurface] = useState('all');

  const load = async (d = days) => {
    setRefreshing(true);
    setErr('');
    try {
      const r = await api.monitoringAiUsage(d);
      setData(r);
    } catch (e) {
      setErr(e.message || 'Failed to load AI usage');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(days); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        <RefreshCw className="animate-spin mr-2" size={18} /> Loading AI usage…
      </div>
    );
  }

  // Apply the Surface filter to per-task / per-model rows. When
  // surface === 'all' we pass through unchanged so the headline card
  // numbers still match the overall window when nothing is filtered.
  const allTasks = data?.by_task || [];
  const filteredTasks = surface === 'all'
    ? allTasks
    : allTasks.filter(t => surfaceOf(t.task) === surface);
  // Per-model can't be filtered by task (the row is keyed on model),
  // so when a surface filter is active we hide rows whose model wasn't
  // touched by any task in the filtered set.
  const allModels = data?.by_model || [];
  const filteredModels = surface === 'all'
    ? allModels
    // We don't have a task→model breakdown in the report payload, so
    // for advisor/onboarding/other we fall back to a name-prefix
    // heuristic: advisor uses @cf/meta llamas; onboarding shares the
    // same models, so we conservatively show all @cf/* under either
    // and leave Anthropic models visible only under 'other' unless
    // surface='advisor' AND any advisor task was found (advisor uses
    // claude as last-resort fallback).
    : allModels.filter(m => {
        if (surface === 'advisor') return true; // advisor may use any model in fallback
        if (surface === 'onboarding') return String(m.model).startsWith('@cf/');
        return !String(m.model).startsWith('@cf/');
      });
  // Recompute headline stats from the filtered task set so the cards
  // reflect what the operator actually selected.
  const filteredCalls = filteredTasks.reduce((s, t) => s + (Number(t.calls) || 0), 0);
  const filteredSpend = filteredTasks.reduce((s, t) => s + (Number(t.total_cost_usd) || 0), 0);
  const filteredFallbackRate = filteredCalls > 0
    ? filteredTasks.reduce((s, t) => s + (Number(t.fallback_rate) || 0) * (Number(t.calls) || 0), 0) / filteredCalls
    : 0;
  const headlineCalls   = surface === 'all' ? (data?.total_calls || 0) : filteredCalls;
  const headlineSpend   = surface === 'all' ? (data?.total_cost_usd || 0) : filteredSpend;
  const headlineFb      = surface === 'all' ? (data?.fallback_rate || 0) : filteredFallbackRate;

  return (
    <div className="space-y-6" data-testid="monitoring-ai-usage-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Sparkles size={18} className="text-violet-600" /> AI Router Usage
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={surface}
            onChange={e => setSurface(e.target.value)}
            data-testid="ai-usage-surface-filter"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none"
            aria-label="Filter by AI surface"
          >
            <option value="all">All surfaces</option>
            <option value="advisor">Advisor only</option>
            <option value="onboarding">Onboarding only</option>
            <option value="other">Other</option>
          </select>
          <select
            value={days}
            onChange={e => setDays(parseInt(e.target.value, 10))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={() => load(days)}
            disabled={refreshing}
            className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Sparkles} label={surface === 'all' ? 'Total spend' : `${surface} spend`} value={fmtUsd(headlineSpend)} sub={`${headlineCalls} calls`} />
        <StatCard icon={Zap} label="Fallback rate" value={fmtPct(headlineFb)} sub="primary→sibling" accent="amber" />
        <StatCard icon={Clock} label="Cache hit rate" value={fmtPct(data?.cache_hit_rate)} sub="embed/explain/sentiment" accent="emerald" />
        <StatCard icon={AlertTriangle} label="Refusals" value={(data?.refusals || []).reduce((s, r) => s + r.count, 0)} sub="budget / kill / fail" accent="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-3">Spend per day (USD)</div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={(data?.by_day || []).map(d => ({ day: d.day.slice(5), cost: Number(d.total_cost_usd) || 0 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={v => fmtUsd(v)} />
                <Bar dataKey="cost" fill="#7c3aed" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-3">Calls per day</div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={(data?.by_day || []).map(d => ({ day: d.day.slice(5), calls: Number(d.calls) || 0 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="calls" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">Per-task breakdown</div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Task</th>
              <th className="text-right px-4 py-2">Calls</th>
              <th className="text-right px-4 py-2">Spend</th>
              <th className="text-right px-4 py-2">p50 latency</th>
              <th className="text-right px-4 py-2">p95 latency</th>
              <th className="text-right px-4 py-2">Fallback</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map(t => (
              <tr key={t.task} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono text-gray-900">{t.task}</td>
                <td className="px-4 py-2 text-right">{t.calls}</td>
                <td className="px-4 py-2 text-right">{fmtUsd(t.total_cost_usd)}</td>
                <td className="px-4 py-2 text-right">{Math.round(t.p50_latency_ms)} ms</td>
                <td className="px-4 py-2 text-right">{Math.round(t.p95_latency_ms)} ms</td>
                <td className="px-4 py-2 text-right">{fmtPct(t.fallback_rate)}</td>
              </tr>
            ))}
            {filteredTasks.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No AI calls in this window{surface !== 'all' ? ` for surface "${surface}"` : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">Per-model breakdown</div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Model</th>
              <th className="text-right px-4 py-2">Calls</th>
              <th className="text-right px-4 py-2">Spend</th>
              <th className="text-right px-4 py-2">Used as fallback</th>
            </tr>
          </thead>
          <tbody>
            {filteredModels.map(m => (
              <tr key={m.model} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono text-gray-900">{m.model}</td>
                <td className="px-4 py-2 text-right">{m.calls}</td>
                <td className="px-4 py-2 text-right">{fmtUsd(m.total_cost_usd)}</td>
                <td className="px-4 py-2 text-right">{m.fallback_count}</td>
              </tr>
            ))}
            {filteredModels.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No model invocations in this window{surface !== 'all' ? ` for surface "${surface}"` : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data?.safety && data.safety.evaluated > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-3">Guardrail safety (llama-guard)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Sparkles} label="Evaluated" value={data.safety.evaluated} sub="task=safety calls" />
            <StatCard icon={Sparkles} label="Safe" value={data.safety.safe_count} accent="emerald" />
            <StatCard icon={AlertTriangle} label="Unsafe" value={data.safety.unsafe_count} accent="red" />
            <StatCard icon={Zap} label="Safe rate" value={fmtPct(data.safety.safe_rate)} accent="emerald" />
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">Top 10 users by spend</div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">User</th>
              <th className="text-right px-4 py-2">Calls</th>
              <th className="text-right px-4 py-2">Spend</th>
            </tr>
          </thead>
          <tbody>
            {(data?.top_users || []).map((u, i) => (
              <tr key={`${u.user_id ?? 'anon'}-${i}`} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono text-gray-900">{u.user_id == null ? 'system' : `user#${u.user_id}`}</td>
                <td className="px-4 py-2 text-right">{u.calls}</td>
                <td className="px-4 py-2 text-right">{fmtUsd(u.total_cost_usd)}</td>
              </tr>
            ))}
            {(data?.top_users || []).length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No spend recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(data?.refusals || []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-2">Refusals</div>
          <div className="flex flex-wrap gap-2">
            {(data?.refusals || []).map(r => (
              <span key={r.refusal} className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                {r.refusal} · {r.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
