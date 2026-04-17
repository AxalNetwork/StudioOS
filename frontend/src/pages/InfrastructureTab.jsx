import React, { useEffect, useMemo, useState } from 'react';
import { Cpu, Database, RefreshCw, Play, Trash2, AlertOctagon, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../lib/api';

const POLL_MS = 10000;

function StatusPill({ status }) {
  const map = {
    pending: 'bg-gray-100 text-gray-700',
    processing: 'bg-blue-100 text-blue-800',
    completed: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
}

function MiniCard({ label, value, sub, icon: Icon, accent = 'violet' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</span>
        {Icon && <Icon size={14} className={`text-${accent}-600`} />}
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function InfrastructureTab() {
  const [queue, setQueue] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [dlq, setDLQ] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const [q, m, d] = await Promise.all([api.infraQueue(), api.infraMetrics(60), api.infraDLQ()]);
      setQueue(q); setMetrics(m); setDLQ(d);
    } catch (e) { setErr(e.message || 'Failed to load infra'); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const runDrain = async () => {
    setBusy(true);
    try { await api.infraProcess(25); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const runCleanup = async () => {
    if (!confirm('Purge completed/failed jobs older than 7 days and DLQ older than 30?')) return;
    setBusy(true);
    try { await api.infraCleanup(); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const byStatus = useMemo(() => {
    const m = { pending: 0, processing: 0, completed: 0, failed: 0 };
    (queue?.by_status || []).forEach(r => { m[r.status] = r.n; });
    return m;
  }, [queue]);

  // Pivot job_per_min into a time-series for chart
  const series = useMemo(() => {
    const buckets = {};
    (metrics?.jobs_per_min || []).forEach(r => {
      buckets[r.bucket] = buckets[r.bucket] || { bucket: r.bucket, completed: 0, failed: 0 };
      buckets[r.bucket][r.status] = r.n;
    });
    return Object.values(buckets).sort((a, b) => a.bucket.localeCompare(b.bucket));
  }, [metrics]);

  return (
    <div className="space-y-6">
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={runDrain} disabled={busy}
          className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-1.5">
          <Play size={13} /> Drain queue now
        </button>
        <button onClick={load} disabled={busy}
          className="px-3 py-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center gap-1.5">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={runCleanup} disabled={busy}
          className="px-3 py-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center gap-1.5 ml-auto">
          <Trash2 size={13} /> Cleanup old jobs
        </button>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniCard label="Pending" value={byStatus.pending} icon={Database} accent="gray" />
        <MiniCard label="Processing" value={byStatus.processing} icon={Cpu} accent="blue" sub={`In flight: ${metrics?.in_flight ?? 0}`} />
        <MiniCard label="Completed" value={byStatus.completed} icon={Activity} accent="emerald" sub="all-time" />
        <MiniCard label="Failed" value={byStatus.failed} icon={AlertOctagon} accent="red" sub={`DLQ 7d: ${queue?.dlq_7d ?? 0}`} />
        <MiniCard label="Active Projects" value={metrics?.projects_active ?? 0} accent="violet" sub={`AI calls 5m: ${metrics?.ai_calls_5m ?? 0}`} />
      </div>

      {/* Throughput chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">Jobs processed / minute (last 60m)</div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} tickFormatter={t => t.slice(11, 16)} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="completed" stroke="#059669" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="failed" stroke="#dc2626" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Job-type breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-sm font-semibold text-gray-900 mb-3">Last 24h by job type</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody className="text-gray-800">
              {(queue?.by_type || []).map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 font-mono">{r.job_type}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="text-right">{r.n}</td>
                </tr>
              ))}
              {!queue?.by_type?.length && (
                <tr><td colSpan={3} className="text-center py-4 text-gray-400">No jobs yet — try Drain queue or enqueue from an action.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent jobs */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-sm font-semibold text-gray-900 mb-3">Recent jobs</div>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-100 sticky top-0 bg-white">
              <tr>
                <th className="text-left py-2 font-medium">ID</th>
                <th className="text-left font-medium">Type</th>
                <th className="text-left font-medium">Status</th>
                <th className="text-right font-medium">Attempts</th>
                <th className="text-left font-medium">Created</th>
                <th className="text-left font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="text-gray-800">
              {(queue?.recent || []).map(j => (
                <tr key={j.id} className="border-b border-gray-50">
                  <td className="py-1.5 font-mono text-gray-500">#{j.id}</td>
                  <td className="font-mono">{j.job_type}</td>
                  <td><StatusPill status={j.status} /></td>
                  <td className="text-right">{j.attempts}</td>
                  <td className="text-gray-500">{new Date(j.created_at + 'Z').toLocaleTimeString()}</td>
                  <td className="text-red-700 font-mono truncate max-w-[300px]" title={j.error || ''}>{j.error || ''}</td>
                </tr>
              ))}
              {!queue?.recent?.length && (
                <tr><td colSpan={6} className="text-center py-4 text-gray-400">No jobs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dead letter */}
      {(dlq?.items || []).length > 0 && (
        <div className="bg-white border border-red-200 rounded-xl p-5">
          <div className="text-sm font-semibold text-red-900 mb-3 flex items-center gap-2">
            <AlertOctagon size={14} /> Dead-letter queue ({dlq.items.length})
          </div>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {dlq.items.slice(0, 25).map(d => (
              <div key={d.id} className="border border-red-100 bg-red-50/50 rounded-lg px-3 py-2 text-xs">
                <div className="flex justify-between">
                  <span className="font-mono text-red-800">{d.job_type} (orig #{d.original_job_id})</span>
                  <span className="text-gray-500">{new Date(d.moved_at + 'Z').toLocaleString()}</span>
                </div>
                <div className="text-gray-700 mt-1">{d.last_error}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
