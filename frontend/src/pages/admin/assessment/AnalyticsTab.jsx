// Task #3 — Read-only analytics for a game: funnel (sessions/completion),
// per-chapter reach, archetype distribution, 8-axis coverage, median latency.
// Pulls GET /api/admin/assessment/games/:slug/analytics.
import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { RefreshCw, AlertTriangle, Users, CheckCircle2, Percent, Timer } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import { skillLabel } from '../../../lib/assessmentMeta';
import { SectionCard } from './forms';

function MetricCard({ icon: Icon, label, value, sub }) {
  return (
    <SectionCard className="p-4">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
        <Icon className="w-4 h-4" /> {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </SectionCard>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: 'rgb(30 41 59)',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontSize: 12,
};

function ChartCard({ title, data, dataKey, labelKey, empty }) {
  return (
    <SectionCard className="p-4">
      <h4 className="font-medium text-slate-800 dark:text-slate-100 mb-3">{title}</h4>
      {data.length ? (
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis type="category" dataKey={labelKey} width={140} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#94a3b81a' }} />
            <Bar dataKey={dataKey} fill="#7c3aed" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">{empty}</div>
      )}
    </SectionCard>
  );
}

export default function AnalyticsTab({ slug, toast }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setErr('');
    try {
      const res = await adminAssessment.analytics(slug);
      setData(res);
    } catch (e) {
      const msg = e?.data?.message || e?.message || 'Failed to load analytics';
      setErr(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) return <div className="text-sm text-slate-500 dark:text-slate-400 px-4 py-10 text-center">Loading analytics…</div>;

  if (err) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
        <button onClick={reload} className="text-sm text-violet-600 dark:text-violet-400 inline-flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const sessions = data.sessions || {};
  const perChapter = (data.per_chapter || []).map((r) => ({
    label: r.chapter_title || r.chapter_slug,
    sessions_reached: r.sessions_reached || 0,
  }));
  const archDist = (data.archetype_distribution || []).map((r) => ({ label: r.slug, count: r.count || 0 }));
  const axisCoverage = Object.entries(data.axis_coverage || {}).map(([axis, n]) => ({
    label: skillLabel(axis),
    count: n || 0,
  }));
  const median = data.median_latency_ms;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={reload}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 inline-flex items-center gap-1 text-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard icon={Users} label="Sessions started" value={sessions.started ?? 0} />
        <MetricCard icon={CheckCircle2} label="Completed" value={sessions.completed ?? 0} />
        <MetricCard icon={Percent} label="Completion" value={`${sessions.completion_rate ?? 0}%`} />
        <MetricCard
          icon={Timer}
          label="Median latency"
          value={median == null ? '—' : `${(median / 1000).toFixed(1)}s`}
          sub={median == null ? 'no answers yet' : `${median} ms`}
        />
      </div>

      <ChartCard
        title="Per-chapter reach (sessions that answered ≥1 item)"
        data={perChapter}
        dataKey="sessions_reached"
        labelKey="label"
        empty="No chapters with responses yet."
      />
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard
          title="Archetype distribution"
          data={archDist}
          dataKey="count"
          labelKey="label"
          empty="No results assigned an archetype yet."
        />
        <ChartCard
          title="Skill-axis coverage"
          data={axisCoverage}
          dataKey="count"
          labelKey="label"
          empty="No scored results yet."
        />
      </div>
    </div>
  );
}
