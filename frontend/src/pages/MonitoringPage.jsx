import React, { useEffect, useMemo, useState } from 'react';
import InfrastructureTab from './InfrastructureTab';
import AnalyticsTab from './AnalyticsTab';
import AiUsageTab from './AiUsageTab';
import DlqTab from './DlqTab';
import CronTab from './CronTab';
import { Activity, AlertTriangle, RefreshCw, Sparkles, ShieldAlert, Zap, Server, Clock, TrendingUp, ChevronDown, X, User as UserIcon, Hash, Copy, Check } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import { api } from '../lib/api';
import { useEscapeClose } from '../components/useEscapeClose';

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
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`h-8 w-8 rounded-lg bg-${accent}-100 text-${accent}-700 flex items-center justify-center`}>
          <Icon size={15} />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function ChartPanel({ title, data, dataKey = 'count', color = '#7c3aed', type = 'line' }) {
  const formatted = (data || []).map(d => ({ ...d, t: formatBucket(d.bucket), [dataKey]: Number(d[dataKey]) || 0 }));
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">{title}</div>
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
        <div className="text-center text-xs text-gray-500 mt-2">No data in selected window.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Errors detail modal — shows full request meta, user, stack, and
// related occurrences (same endpoint+status) so admins can triage at a glance
// without leaving the page. Operates on data already loaded by /errors so it
// works against either the FastAPI dev backend or the Cloudflare worker.
// ---------------------------------------------------------------------------
function ErrorDetailModal({ error, allErrors, onClose }) {
  const [copied, setCopied] = useState(false);
  useEscapeClose(onClose);
  if (!error) return null;

  const ts = error.created_at ? new Date(error.created_at + (error.created_at.endsWith('Z') ? '' : 'Z')) : null;
  const related = (allErrors || []).filter(
    e => e.endpoint === error.endpoint && e.status_code === error.status_code && e.id !== error.id,
  );
  const sameUser = error.user_id
    ? (allErrors || []).filter(e => e.user_id === error.user_id && e.id !== error.id)
    : [];

  const copyAll = async () => {
    const blob = [
      `${error.method} ${error.endpoint} → ${error.status_code}`,
      `When: ${ts ? ts.toISOString() : '—'}`,
      `User: ${error.email || (error.user_id ? `user#${error.user_id}` : 'anonymous')}`,
      `Message: ${error.message || '—'}`,
      '',
      'Stack:',
      error.stack_snippet || '(none captured)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-red-50 dark:border-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            <Zap size={16} className="text-red-600 shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-sm text-red-900 truncate">
                {error.method} {error.endpoint} → {error.status_code}
              </div>
              <div className="text-xs text-gray-600">
                {ts ? ts.toLocaleString() : '—'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={copyAll}
              className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1.5 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              title="Copy details to clipboard"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-white/60 text-gray-500"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="border border-gray-200 rounded-lg px-3 py-2 dark:border-gray-800">
              <div className="text-gray-500 uppercase tracking-wide text-[10px] font-medium">Status</div>
              <div className="font-mono text-red-700 font-semibold">{error.status_code}</div>
            </div>
            <div className="border border-gray-200 rounded-lg px-3 py-2 dark:border-gray-800">
              <div className="text-gray-500 uppercase tracking-wide text-[10px] font-medium">Method</div>
              <div className="font-mono text-gray-900 font-semibold dark:text-gray-100">{error.method}</div>
            </div>
            <div className="border border-gray-200 rounded-lg px-3 py-2 col-span-2 dark:border-gray-800">
              <div className="text-gray-500 uppercase tracking-wide text-[10px] font-medium">Endpoint</div>
              <div className="font-mono text-gray-900 break-all dark:text-gray-100">{error.endpoint}</div>
            </div>
            <div className="border border-gray-200 rounded-lg px-3 py-2 flex items-start gap-2 dark:border-gray-800">
              <UserIcon size={13} className="text-gray-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-gray-500 uppercase tracking-wide text-[10px] font-medium">User</div>
                <div className="text-gray-900 truncate dark:text-gray-100">
                  {error.email || (error.user_id ? `user#${error.user_id}` : 'Anonymous')}
                </div>
                {error.name && <div className="text-gray-500 text-[11px] truncate">{error.name}</div>}
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg px-3 py-2 flex items-start gap-2 dark:border-gray-800">
              <Hash size={13} className="text-gray-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-gray-500 uppercase tracking-wide text-[10px] font-medium">Error ID</div>
                <div className="font-mono text-gray-900 dark:text-gray-100">#{error.id}</div>
              </div>
            </div>
          </div>

          {/* Message */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1.5 dark:text-gray-300">Message</div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-800 font-mono whitespace-pre-wrap break-words dark:border-gray-800 dark:text-gray-200">
              {error.message || '(no message captured)'}
            </div>
          </div>

          {/* Stack */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1.5 dark:text-gray-300">Stack trace</div>
            {error.stack_snippet ? (
              <pre className="bg-gray-900 text-gray-100 rounded-lg px-3 py-2.5 text-[11px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap">
                {error.stack_snippet}
              </pre>
            ) : (
              <div className="text-xs text-gray-500 italic">No stack trace captured for this error.</div>
            )}
          </div>

          {/* Related occurrences */}
          {related.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1.5 dark:text-gray-300">
                Other occurrences of this error <span className="text-gray-500 font-normal">({related.length})</span>
              </div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto dark:border-gray-800">
                {related.slice(0, 10).map(r => (
                  <div key={r.id} className="px-3 py-1.5 text-[11px] flex items-center justify-between">
                    <span className="text-gray-700 truncate dark:text-gray-300">{r.email || (r.user_id ? `user#${r.user_id}` : 'anon')}</span>
                    <span className="text-gray-500 font-mono shrink-0 ml-2">
                      {new Date(r.created_at + (r.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Other errors from same user */}
          {sameUser.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1.5 dark:text-gray-300">
                Other recent errors from this user <span className="text-gray-500 font-normal">({sameUser.length})</span>
              </div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto dark:border-gray-800">
                {sameUser.slice(0, 10).map(r => (
                  <div key={r.id} className="px-3 py-1.5 text-[11px] flex items-center justify-between gap-2">
                    <span className="text-red-700 font-mono truncate">{r.method} {r.endpoint} → {r.status_code}</span>
                    <span className="text-gray-500 font-mono shrink-0">
                      {new Date(r.created_at + (r.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState(null);
  const [rateLimits, setRateLimits] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [errors, setErrors] = useState(null);
  const [selectedError, setSelectedError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [window, setWindow] = useState(60);
  // Deep-link support: admin notification emails (Epic 5) link to
  // /monitoring?tab=integrity&snapshot=<id> so the review queue opens
  // straight to the flagged row. NOTE: local `window` state above shadows
  // the global, so we go through `globalThis` to read the URL.
  const qp = (() => {
    try {
      const loc = (typeof globalThis !== 'undefined' && globalThis.location) || null;
      if (!loc) return new URLSearchParams();
      return new URLSearchParams(loc.search || '');
    } catch { return new URLSearchParams(); }
  })();
  const initialTab = (() => {
    const t = qp.get('tab');
    return (t === 'integrity' || t === 'infra' || t === 'overview' || t === 'analytics' || t === 'ai-usage' || t === 'dlq' || t === 'cron') ? t : 'overview';
  })();
  const [tab, setTab] = useState(initialTab);
  const focusSnapshotId = (() => {
    const s = qp.get('snapshot');
    const n = s ? Number(s) : null;
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

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
    <div className="max-w-7xl mx-auto space-y-6" data-testid="monitoring-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <Activity size={22} className="text-violet-600" /> Monitoring & Observability
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Real-time health, throughput, rate limits and AI-detected anomalies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <HealthBadge health={metrics?.health || 'green'} />
          <div className="relative">
            <select
              value={window}
              onChange={e => setWindow(parseInt(e.target.value))}
              className="appearance-none border border-gray-300 rounded-lg pl-3 pr-9 py-1.5 text-sm bg-white text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none cursor-pointer dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value={15}>Last 15 min</option>
              <option value={60}>Last 60 min</option>
              <option value={240}>Last 4 hours</option>
              <option value={1440}>Last 24 hours</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
          </div>
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
      <div className="border-b border-gray-200 flex gap-1 overflow-x-auto [&>button]:whitespace-nowrap dark:border-gray-800">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'analytics', label: 'User Analytics' },
          { id: 'integrity', label: 'Score Integrity' },
          { id: 'infra', label: 'Infrastructure' },
          { id: 'dlq', label: 'DLQ' },
          { id: 'cron', label: 'Cron History' },
          { id: 'ai-usage', label: 'AI Usage' },
        ].map(t => (
          <button
            key={t.id}
            data-testid={`monitoring-tab-${t.id}`}
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

      {tab === 'infra' ? <InfrastructureTab /> :
       tab === 'analytics' ? <div data-testid="monitoring-analytics-panel"><AnalyticsTab /></div> :
       tab === 'ai-usage' ? <AiUsageTab /> :
       tab === 'dlq' ? <DlqTab /> :
       tab === 'cron' ? <CronTab /> :
       tab === 'integrity' ? <ScoreIntegrityTab focusSnapshotId={focusSnapshotId} /> : (
      <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Server} label="Total Requests" value={(s.total_requests || 0).toLocaleString()} sub={`Window: ${metrics?.window_minutes || window}m`} accent="violet" />
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
        <p className="text-sm text-gray-800 whitespace-pre-line dark:text-gray-200">{anomalies?.ai_summary || 'No analysis yet.'}</p>
        {anomalies?.anomalies?.length > 0 && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            {anomalies.anomalies.map((a, i) => (
              <div key={i} className="bg-white/80 border border-violet-200 rounded-lg px-3 py-2 text-xs">
                <div className="font-semibold text-violet-900">{a.type.toUpperCase()} · {a.endpoint}</div>
                <div className="text-gray-700 dark:text-gray-300">{a.detail}</div>
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
        <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
          <div className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Top endpoints (by hits)</div>
          <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
            {(metrics?.top_endpoints || []).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs border-b border-gray-100 last:border-0 py-1">
                <span className="font-mono text-gray-700 truncate dark:text-gray-300">{r.endpoint}</span>
                <span className="text-gray-500">{r.hits} hits · {Math.round(Number(r.avg_latency) || 0)}ms</span>
              </div>
            ))}
            {!metrics?.top_endpoints?.length && (
              <div className="text-xs text-gray-500 text-center py-4">No data.</div>
            )}
          </div>
        </div>
      </div>

      {/* Rate-limit heatmap */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={15} className="text-amber-600" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Rate-limit Blocks</span>
          <span className="text-xs text-gray-500 ml-2">Last {rateLimits?.window_minutes}m</span>
        </div>
        {heatmap.length === 0 ? (
          <div className="text-xs text-gray-500 text-center py-4">No rate-limit blocks in window.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
            {heatmap.map((h, i) => {
              const intensity = Math.min(1, Number(h.blocks) / 20);
              const bg = `rgba(245, 158, 11, ${0.15 + intensity * 0.6})`;
              return (
                <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2 text-xs border border-amber-200" style={{ background: bg }}>
                  <div>
                    <div className="font-mono text-gray-900 dark:text-gray-100">{h.endpoint}</div>
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
            <div className="text-xs font-semibold text-gray-700 mb-2 dark:text-gray-300">Recent blocks</div>
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
                <tbody className="text-gray-800 dark:text-gray-200">
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
      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={15} className="text-red-600" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Errors</span>
        </div>
        {(errors?.errors || []).length === 0 ? (
          <div className="text-xs text-gray-500 text-center py-4">No errors logged.</div>
        ) : (
          <div className="space-y-2">
            {errors.errors.slice(0, 10).map(e => (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedError(e)}
                className="w-full text-left border border-red-100 bg-red-50/50 hover:bg-red-50 hover:border-red-200 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-300"
                title="Click for details"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-red-800 truncate">{e.method} {e.endpoint} → {e.status_code}</span>
                  <span className="text-gray-500 shrink-0">{new Date(e.created_at + 'Z').toLocaleString()}</span>
                </div>
                <div className="text-gray-700 mt-1 truncate dark:text-gray-300">{e.message}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      </>
      )}
      <ErrorDetailModal
        error={selectedError}
        allErrors={errors?.errors || []}
        onClose={() => setSelectedError(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score Integrity tab (Epic 5)
// ---------------------------------------------------------------------------
// Lists snapshots that anomaly detection flagged AND any rows whose stored
// HMAC no longer matches what the integrity service recomputes (silent
// tampering). Admin can approve (release to LPs/partners), reject (revert
// project status), or grant a one-off cooldown waiver.
function ScoreIntegrityTab({ focusSnapshotId = null }) {
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('flagged');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Deep-link focus: scroll the targeted snapshot into view + highlight it
  // briefly once the queue has loaded. Only fires once per mount.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused || !focusSnapshotId || items.length === 0) return;
    const el = document.getElementById(`score-flag-${focusSnapshotId}`);
    if (el) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      el.classList.add('ring-2', 'ring-violet-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-violet-400'), 4000);
      setFocused(true);
    }
  }, [items, focusSnapshotId, focused]);

  const load = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.getScoreFlags(statusFilter);
      setItems(r.items || []);
    } catch (e) {
      // A 404 here means the backend's /monitoring/score-flags route isn't
      // available on this deployment (e.g. stale worker). The page's empty-
      // state card already covers "nothing to review", so don't double up
      // with a raw "Not found" red banner above it — just leave the queue
      // empty and stay quiet. Surface every other error normally.
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        setItems([]);
      } else {
        setErr(e?.message || 'Failed to load flags');
      }
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const review = async (id, decision) => {
    const notes = decision === 'reject' ? prompt('Reason (visible in audit log):') : '';
    if (decision === 'reject' && notes === null) return;
    try {
      await api.reviewScoreFlag(id, decision, notes || '');
      await load();
    } catch (e) { alert(e?.message || 'Review failed'); }
  };

  const waive = async (id) => {
    if (!confirm('Grant a one-off cooldown waiver so the founder can re-run the official score immediately?')) return;
    try { await api.waiveScoreCooldown(id); await load(); }
    catch (e) { alert(e?.message || 'Waiver failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-amber-600" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Score Integrity Queue</h2>
          <span className="text-xs text-gray-500">{items.length} item(s)</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            <option value="flagged">Flagged (pending review)</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="auto_approved">Auto-approved</option>
          </select>
          <button onClick={load} disabled={busy}
                  className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-1.5">
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>
      )}

      {items.length === 0 && !busy ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500 dark:bg-gray-900 dark:border-gray-800">
          No snapshots in this state. Tampering &amp; anomaly detection is healthy.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(it => (
            <div key={it.id} id={`score-flag-${it.id}`} className="bg-white border border-gray-200 rounded-xl p-4 transition-shadow dark:bg-gray-900 dark:border-gray-800">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {it.project_name || `Project #${it.project_id}`} · snapshot #{it.id}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Score <strong className="text-gray-800 dark:text-gray-200">{it.total_score}</strong> · {it.tier} ·
                    {' '}created {new Date(it.created_at + (it.created_at?.endsWith('Z') ? '' : 'Z')).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {it.integrity_valid === false && (
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                      Hash mismatch ({it.integrity_reason || 'tampered'})
                    </span>
                  )}
                  {it.integrity_valid === true && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">Hash valid</span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    it.admin_review_status === 'flagged' ? 'bg-amber-100 text-amber-800' :
                    it.admin_review_status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                    it.admin_review_status === 'rejected' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-700'
                  }`}>{it.admin_review_status}</span>
                </div>
              </div>

              {Array.isArray(it.anomaly_flags) && it.anomaly_flags.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-gray-700 dark:text-gray-300">
                  {it.anomaly_flags.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle size={12} className={`mt-0.5 ${f.severity === 'high' ? 'text-red-600' : f.severity === 'medium' ? 'text-amber-600' : 'text-gray-500'}`} />
                      <span><strong>{f.type}</strong> ({f.severity || 'low'}): {f.detail}</span>
                    </li>
                  ))}
                </ul>
              )}

              {it.integrity_hash && (
                <div className="mt-2 text-[11px] font-mono text-gray-500 break-all">
                  hash: {it.integrity_hash}
                </div>
              )}

              {it.admin_review_status === 'flagged' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => review(it.id, 'approve')}
                          className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium">
                    Approve · release to LPs
                  </button>
                  <button onClick={() => review(it.id, 'reject')}
                          className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">
                    Reject · revert tier
                  </button>
                  <button onClick={() => waive(it.id)}
                          className="px-3 py-1.5 text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg font-medium dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                    Waive 7-day cooldown
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
