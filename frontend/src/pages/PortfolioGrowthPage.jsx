// Investor Portfolio Growth (value-creation) surface. Deterministic demo data
// only (no API). Renders summary stats, a filterable board of growth
// initiatives with progress bars + KPI chips, an introductions section
// (talent/customer/capital), a portfolio-vs-industry growth benchmark chart,
// and a per-initiative SlideOver showing KPIs (current vs target).
import React, { useMemo, useState } from 'react';
import {
  Users, Building2, DollarSign, Boxes, CheckCircle2, AlertTriangle, Clock,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { StatCard, Section, Chip, SlideOver, FilterChips, EmptyState, Field } from './advisor/network/kit';
import {
  GROWTH_INITIATIVES, INTRODUCTIONS, GROWTH_BENCHMARKS,
} from '../data/portfolioAnalytics';

const AXIS = { fontSize: 11, fill: '#94a3b8' };
const GRID = '#e2e8f0';

const TYPE_META = {
  talent: { label: 'Talent', tone: 'violet', icon: Users },
  customer: { label: 'Customer', tone: 'blue', icon: Building2 },
  capital: { label: 'Capital', tone: 'emerald', icon: DollarSign },
  product: { label: 'Product', tone: 'amber', icon: Boxes },
};

const STATUS_META = {
  planned: { label: 'Planned', tone: 'gray' },
  in_progress: { label: 'In progress', tone: 'blue' },
  done: { label: 'Done', tone: 'emerald' },
  blocked: { label: 'Blocked', tone: 'rose' },
};

const INTRO_STATUS_TONE = {
  accepted: 'emerald',
  meeting_set: 'blue',
  in_progress: 'amber',
  declined: 'rose',
};
const INTRO_STATUS_LABEL = {
  accepted: 'Accepted',
  meeting_set: 'Meeting set',
  in_progress: 'In progress',
  declined: 'Declined',
};

function ProgressBar({ value, tone = 'violet' }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const barTone = {
    violet: 'bg-violet-500',
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  }[tone] || 'bg-violet-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full ${barTone}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-gray-600 dark:text-gray-400 w-8 text-right">{v}%</span>
    </div>
  );
}

function fmtKpi(k) {
  const val = typeof k.current === 'number' && !Number.isInteger(k.current) ? k.current.toFixed(1) : k.current;
  const tgt = typeof k.target === 'number' && !Number.isInteger(k.target) ? k.target.toFixed(1) : k.target;
  const u = k.unit || '';
  const prefix = u === '$' ? '$' : '';
  const suffix = u === '$' ? '' : u;
  return { cur: `${prefix}${val}${suffix}`, tgt: `${prefix}${tgt}${suffix}` };
}

export default function PortfolioGrowthPage({ embedded = false }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [introFilter, setIntroFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const initiatives = useMemo(() => {
    return GROWTH_INITIATIVES.filter((i) => {
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      return true;
    });
  }, [typeFilter, statusFilter]);

  const intros = useMemo(() => {
    if (introFilter === 'all') return INTRODUCTIONS;
    return INTRODUCTIONS.filter((i) => i.type === introFilter);
  }, [introFilter]);

  const stats = useMemo(() => {
    const active = GROWTH_INITIATIVES.filter((i) => i.status === 'in_progress' || i.status === 'planned').length;
    const blocked = GROWTH_INITIATIVES.filter((i) => i.status === 'blocked').length;
    const introsMade = INTRODUCTIONS.filter((i) => i.status === 'accepted' || i.status === 'meeting_set').length;
    const avgProgress = Math.round(
      GROWTH_INITIATIVES.reduce((s, i) => s + i.progress, 0) / GROWTH_INITIATIVES.length,
    );
    return { active, blocked, introsMade, avgProgress };
  }, []);

  const selected = GROWTH_INITIATIVES.find((i) => i.id === selectedId) || null;

  const typeOptions = [
    { id: 'all', label: 'All types', count: GROWTH_INITIATIVES.length },
    ...Object.entries(TYPE_META).map(([id, m]) => ({
      id, label: m.label, count: GROWTH_INITIATIVES.filter((i) => i.type === id).length,
    })),
  ];
  const statusOptions = [
    { id: 'all', label: 'All statuses' },
    ...Object.entries(STATUS_META).map(([id, m]) => ({
      id, label: m.label, count: GROWTH_INITIATIVES.filter((i) => i.status === id).length,
    })),
  ];
  const introOptions = [
    { id: 'all', label: 'All', count: INTRODUCTIONS.length },
    { id: 'talent', label: 'Talent', count: INTRODUCTIONS.filter((i) => i.type === 'talent').length },
    { id: 'customer', label: 'Customer', count: INTRODUCTIONS.filter((i) => i.type === 'customer').length },
    { id: 'capital', label: 'Capital', count: INTRODUCTIONS.filter((i) => i.type === 'capital').length },
  ];

  const content = (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active initiatives" value={stats.active} hint="Planned + in progress" />
        <StatCard label="Intros made" value={stats.introsMade} hint="Accepted or meeting set" />
        <StatCard label="Avg progress" value={`${stats.avgProgress}%`} hint="Across all initiatives" />
        <StatCard label="Blocked" value={stats.blocked} hint="Need attention" />
      </div>

      {/* Growth initiatives board */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Value-creation initiatives</h3>
          </div>
          <FilterChips options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
          <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
        </div>

        {initiatives.length === 0 ? (
          <EmptyState>No initiatives match these filters.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {initiatives.map((i) => {
              const tm = TYPE_META[i.type];
              const sm = STATUS_META[i.status];
              const TypeIcon = tm.icon;
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setSelectedId(i.id)}
                  className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30 p-4 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{i.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{i.company} · {i.owner}</div>
                    </div>
                    <Chip tone={sm.tone}>{sm.label}</Chip>
                  </div>
                  <div className="flex items-center gap-2 my-2">
                    <Chip tone={tm.tone}><TypeIcon size={11} /> {tm.label}</Chip>
                    <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                      <Clock size={11} /> Due {i.dueDate}
                    </span>
                  </div>
                  <ProgressBar value={i.progress} tone={sm.tone === 'gray' ? 'violet' : sm.tone} />
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {i.kpis.map((k) => {
                      const f = fmtKpi(k);
                      return (
                        <span key={k.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
                          {k.name}: <span className="tabular-nums text-gray-900 dark:text-gray-100">{f.cur}</span>/<span className="tabular-nums">{f.tgt}</span>
                        </span>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Introductions */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex flex-col gap-3 mb-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Introductions</h3>
          <FilterChips options={introOptions} value={introFilter} onChange={setIntroFilter} />
        </div>
        {intros.length === 0 ? (
          <EmptyState>No introductions of this type yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 dark:border-gray-800">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="py-2 pr-3">Company</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Counterparty</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {intros.map((i) => {
                  const tm = TYPE_META[i.type];
                  const TypeIcon = tm.icon;
                  return (
                    <tr key={i.id}>
                      <td className="py-2.5 pr-3 font-medium text-gray-900 dark:text-gray-100">{i.company}</td>
                      <td className="py-2.5 pr-3"><Chip tone={tm.tone}><TypeIcon size={11} /> {tm.label}</Chip></td>
                      <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">{i.counterparty}</td>
                      <td className="py-2.5 pr-3"><Chip tone={INTRO_STATUS_TONE[i.status]}>{INTRO_STATUS_LABEL[i.status]}</Chip></td>
                      <td className="py-2.5 pr-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">{i.date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Growth benchmarks */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <Section title="Portfolio vs industry growth benchmarks">
          <div className="mt-2" style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={GROWTH_BENCHMARKS} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} opacity={0.4} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="metric" tick={AXIS} tickLine={false} axisLine={false} width={170} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="portfolioMedian" name="Portfolio median" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                <Bar dataKey="industryMedian" name="Industry median" fill="#94a3b8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Per-initiative slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.title}
        subtitle={selected ? `${selected.company} · ${selected.owner}` : ''}
      >
        {selected && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={TYPE_META[selected.type].tone}>{TYPE_META[selected.type].label}</Chip>
              <Chip tone={STATUS_META[selected.status].tone}>{STATUS_META[selected.status].label}</Chip>
              <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                <Clock size={12} /> Due {selected.dueDate}
              </span>
            </div>

            <Section title="Progress">
              <ProgressBar value={selected.progress} tone={STATUS_META[selected.status].tone === 'gray' ? 'violet' : STATUS_META[selected.status].tone} />
            </Section>

            <Section title="KPIs (current vs target)">
              <div className="space-y-3">
                {selected.kpis.map((k) => {
                  const f = fmtKpi(k);
                  const pct = k.target ? Math.max(0, Math.min(100, Math.round((k.current / k.target) * 100))) : 0;
                  const met = k.current >= k.target;
                  return (
                    <div key={k.name} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-sm text-gray-800 dark:text-gray-200">{k.name}</span>
                        <span className="text-sm tabular-nums">
                          <span className={met ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-gray-900 dark:text-gray-100 font-semibold'}>{f.cur}</span>
                          <span className="text-gray-400"> / {f.tgt}</span>
                          {met && <CheckCircle2 size={13} className="inline ml-1 text-emerald-500" />}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className={met ? 'h-full bg-emerald-500' : 'h-full bg-violet-500'} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner">{selected.owner}</Field>
              <Field label="Company">{selected.company}</Field>
            </div>

            {selected.status === 'blocked' && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 p-3">
                <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-rose-700 dark:text-rose-300">This initiative is blocked and past due — escalate with the founder and owner.</p>
              </div>
            )}
          </>
        )}
      </SlideOver>
    </div>
  );

  if (embedded) return content;
  return <div className="p-6 max-w-7xl mx-auto">{content}</div>;
}
