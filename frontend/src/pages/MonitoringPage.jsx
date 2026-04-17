import React, { useEffect, useMemo, useState } from 'react';
import InfrastructureTab from './InfrastructureTab';
import { Activity, AlertTriangle, RefreshCw, Sparkles, ShieldAlert, Zap, Server, Clock, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import { api } from '../lib/api';

const POLL_MS = 15000;

function formatBucket(s) {
  if (!s) return '';
  return s.slice(11, 16); // HH:MM
}

function HealthBadge({ health }) {
  const map = {
    green: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Healthy' },
    yellow: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Degraded' },
    red: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: 'Critical' },
  };
  const m = map[health] || map.green;
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${m.bg} ${m.text}`}>
      <span className={`w-2 h-2 rounded-full ${m.dot} animate-pulse`}></span>
      System: {m.label}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent = 'violet' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`h-8 w-8 rounded-lg bg-${accent}-100 text-${accent}-700 flex items-center justify-center`}>
          <Icon size={15} />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function ChartPanel({ title, data, dataKey = 'count', color = '#7c3aed', type = 'line' }) {
  const formatted = (data || []).map(d => ({ ...d, t: formatBucket(d.bucket), [dataKey]: Number(d[dataKey]) || 0 }));
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-sm font-semibold text-gray-900 mb-3">{title}</div>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          {type === 'bar' ? (
            <BarChart data={formatted}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={formatted}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      {formatted.length === 0 && (
        <div className="text-center text-xs text-gray-400 mt-2">No data in selected window.</div>
      )}
    </div>
  );
}

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState(null);
  const [rateLimits, setRateLimits] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [errors, setErrors] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [window, setWindow] = useState(60);
  const [tab, setTab] = useState('overview');

  const loadAll = async (minutes = window) => {
    setRefreshing(true);
    setErr('');
    try {
      const [m, rl, e] = await Promise.all([
        api.monitoringMetrics(minutes),
        api.monitoringRateLimits(minutes),
        api.monitoringErrors(20),
      ]);
      setMetrics(m); setRateLimits(rl); setErrors(e);
    } catch (e) {
      setErr(e.message || 'Failed to load metrics');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  const loadAnomalies = async () => {
    try { setAnomalies(await api.monitoringAnomalies()); } catch {}
  };

  useEffect(() => {
    loadAll();
    loadAnomalies();
    const t = setInterval(() => loadAll(), POLL_MS);
    const t2 = setInterval(loadAnomalies, 60000); // anomaly summary every minute
    return () => { clearInterval(t); clearInterval(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  const heatmap = useMemo(() => rateLimits?.heatmap || [], [rateLimits]);
  const blocked = useMemo(() => rateLimits?.blocked || [], [rateLimits]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        <RefreshCw className="animate-spin mr-2" size={18} /> Loading monitoring…
      </div>
    );
  }

  const s = metrics?.summary || {};

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity size={22} className="text-violet-600" /> Monitoring & Observability
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Real-time health, throughput, rate limits and AI-detected anomalies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <HealthBadge health={metrics?.health || 'green'} />
          <select
            value={window}
            onChange={e => setWindow(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900"
          >
            <option value={15}>Last 15 min</option>
            <option value={60}>Last 60 min</option>
            <option value={240}>Last 4 hours</option>
            <option value={1440}>Last 24 hours</option>
          </select>
          <button
            onClick={() => { loadAll(); loadAnomalies(); }}
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

      {/* Tab nav */}
      <div className="border-b border-gray-200 flex gap-1">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'infra', label: 'Infrastructure' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'infra' ? <InfrastructureTab /> : (
      <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Server} label="Total Requests" value={(s.total_requests || 0).toLocaleString()} sub={`Window: ${metrics?.window_minutes}m`} accent="violet" />
        <StatCard icon={Clock} label="Avg Latency" value={`${s.avg_latency_ms || 0}ms`} sub="P50 across all endpoints" accent="blue" />
        <StatCard icon={AlertTriangle} label="5xx Errors" value={s.errors_5xx || 0} sub={`${s.error_rate_pct || 0}% error rate`} accent="red" />
        <StatCard icon={ShieldAlert} label="Rate-Limited" value={s.rate_limited || 0} sub="HTTP 429 responses" accent="amber" />
        <StatCard icon={TrendingUp} label="Spin-Outs" value={(metrics?.spinouts_per_minute || []).reduce((a, b) => a + Number(b.count || 0), 0)} sub="Completed in window" accent="emerald" />
      </div>

      {/* Anomaly panel */}
      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-violet-700" />
          <span className="text-sm font-semibold text-violet-900">AI Anomaly Detection</span>
          {anomalies?.generated_at && (
            <span className="text-xs text-violet-700/70 ml-auto">Updated {new Date(anomalies.generated_at).toLocaleTimeString()}</span>
          )}
        </div>
        <p className="text-sm text-gray-800 whitespace-pre-line">{anomalies?.ai_summary || 'No analysis yet.'}</p>
        {anomalies?.anomalies?.length > 0 && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            {anomalies.anomalies.map((a, i) => (
              <div key={i} className="bg-white/80 border border-violet-200 rounded-lg px-3 py-2 text-xs">
                <div className="font-semibold text-violet-900">{a.type.toUpperCase()} · {a.endpoint}</div>
                <div className="text-gray-700">{a.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartPanel title="Requests / minute" data={metrics?.requests_per_minute} color="#7c3aed" />
        <ChartPanel title="AI calls / minute" data={metrics?.ai_calls_per_minute} color="#2563eb" />
        <ChartPanel title="Spin-outs / minute" data={metrics?.spinouts_per_minute} color="#059669" type="bar" />
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-3">Top endpoints (by hits)</div>
          <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
            {(metrics?.top_endpoints || []).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs border-b border-gray-100 last:border-0 py-1">
                <span className="font-mono text-gray-700 truncate">{r.endpoint}</span>
                <span className="text-gray-500">{r.hits} hits · {Math.round(Number(r.avg_latency) || 0)}ms</span>
              </div>
            ))}
            {!metrics?.top_endpoints?.length && (
              <div className="text-xs text-gray-400 text-center py-4">No data.</div>
            )}
          </div>
        </div>
      </div>

      {/* Rate-limit heatmap */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={15} className="text-amber-600" />
          <span className="text-sm font-semibold text-gray-900">Rate-limit Blocks</span>
          <span className="text-xs text-gray-500 ml-2">Last {rateLimits?.window_minutes}m</span>
        </div>
        {heatmap.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-4">No rate-limit blocks in window.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
            {heatmap.map((h, i) => {
              const intensity = Math.min(1, Number(h.blocks) / 20);
              const bg = `rgba(245, 158, 11, ${0.15 + intensity * 0.6})`;
              return (
                <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2 text-xs border border-amber-200" style={{ background: bg }}>
                  <div>
                    <div className="font-mono text-gray-900">{h.endpoint}</div>
                    <div className="text-[10px] text-gray-600 uppercase tracking-wide">bucket: {h.bucket}</div>
                  </div>
                  <div className="font-bold text-amber-900">{h.blocks}×</div>
                </div>
              );
            })}
          </div>
        )}
        {blocked.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <div className="text-xs font-semibold text-gray-700 mb-2">Recent blocks</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="text-left font-medium py-1">When</th>
                    <th className="text-left font-medium">User</th>
                    <th className="text-left font-medium">Endpoint</th>
                    <th className="text-left font-medium">Bucket</th>
                    <th className="text-right font-medium">Count</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  {blocked.slice(0, 15).map(b => (
                    <tr key={b.id} className="border-t border-gray-100">
                      <td className="py-1.5">{new Date(b.created_at + 'Z').toLocaleTimeString()}</td>
                      <td>{b.email || `user#${b.user_id}` || '—'}</td>
                      <td className="font-mono">{b.endpoint}</td>
                      <td>{b.bucket}</td>
                      <td className="text-right">{b.requests_in_window}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Recent errors */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={15} className="text-red-600" />
          <span className="text-sm font-semibold text-gray-900">Recent Errors</span>
        </div>
        {(errors?.errors || []).length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-4">No errors logged.</div>
        ) : (
          <div className="space-y-2">
            {errors.errors.slice(0, 10).map(e => (
              <div key={e.id} className="border border-red-100 bg-red-50/50 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-red-800">{e.method} {e.endpoint} → {e.status_code}</span>
                  <span className="text-gray-500">{new Date(e.created_at + 'Z').toLocaleString()}</span>
                </div>
                <div className="text-gray-700 mt-1">{e.message}</div>
                {e.stack_snippet && (
                  <pre className="mt-1 text-[10px] text-gray-500 whitespace-pre-wrap font-mono">{e.stack_snippet}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
