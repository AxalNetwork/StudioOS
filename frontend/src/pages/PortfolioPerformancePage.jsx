// Investor Portfolio Performance surface. Deterministic demo data only (no API).
// Renders blended summary cards, an aggregated valuation-history area chart, a
// sortable company table, a vintage-cohort bar chart, a benchmarks comparison,
// and a per-company SlideOver with a mini valuation chart + markup timeline.
import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, ArrowUpRight, ChevronDown } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { StatCard, Section, Chip, SlideOver, FilterChips, EmptyState, Field } from './advisor/network/kit';
import {
  COMPANIES, PORTFOLIO_SUMMARY, COHORTS, BENCHMARKS,
} from '../data/portfolioAnalytics';

const fmtMoney = (v) => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
};
const fmtMoneyFull = (v) => (v == null ? '—' : `$${Number(v).toLocaleString()}`);
const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '' : ''}${v.toFixed(1)}%`);
const fmtMoic = (v) => (v == null ? '—' : `${v.toFixed(2)}x`);

const STATUS_TONE = { active: 'emerald', exited: 'blue', written_off: 'rose' };
const STATUS_LABEL = { active: 'Active', exited: 'Exited', written_off: 'Written off' };

const AXIS = { fontSize: 11, fill: '#94a3b8' };
const GRID = '#e2e8f0';

// Aggregate valuation across the whole portfolio per calendar date. Different
// companies report on different quarter-ends, so we forward-fill each company's
// last-known valuation onto the union of dates.
function aggregatePortfolioValuation(companies) {
  const dates = Array.from(
    new Set(companies.flatMap((c) => c.valuationHistory.map((p) => p.date))),
  ).sort();
  const invested = companies.reduce((s, c) => s + c.invested, 0);
  return dates.map((date) => {
    let total = 0;
    for (const c of companies) {
      const applicable = c.valuationHistory.filter((p) => p.date <= date);
      if (applicable.length) total += applicable[applicable.length - 1].valuation;
    }
    return { date, valuation: total, invested };
  });
}

function SortHeader({ label, field, sort, setSort, align = 'left' }) {
  const active = sort.field === field;
  return (
    <button
      type="button"
      onClick={() => setSort({ field, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${
        align === 'right' ? 'justify-end w-full' : ''
      } ${active ? 'text-violet-600 dark:text-violet-300' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
    >
      {label}
      {active && <ChevronDown className={`w-3 h-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
    </button>
  );
}

export default function PortfolioPerformancePage({ embedded = false }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState({ field: 'currentValue', dir: 'desc' });
  const [selectedId, setSelectedId] = useState(null);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return COMPANIES;
    return COMPANIES.filter((c) => c.status === statusFilter);
  }, [statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const get = (x) => {
        switch (sort.field) {
          case 'name': return x.name.toLowerCase();
          case 'invested': return x.invested;
          case 'currentValue': return x.currentValue;
          case 'moic': return x.moic;
          case 'irr': return x.irr;
          case 'ownershipPct': return x.ownershipPct;
          default: return x.currentValue;
        }
      };
      const A = get(a), B = get(b);
      if (A < B) return sort.dir === 'asc' ? -1 : 1;
      if (A > B) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sort]);

  const aggregate = useMemo(() => aggregatePortfolioValuation(COMPANIES), []);
  const selected = COMPANIES.find((c) => c.id === selectedId) || null;

  const statusOptions = [
    { id: 'all', label: 'All', count: COMPANIES.length },
    { id: 'active', label: 'Active', count: COMPANIES.filter((c) => c.status === 'active').length },
    { id: 'exited', label: 'Exited', count: COMPANIES.filter((c) => c.status === 'exited').length },
    { id: 'written_off', label: 'Written off', count: COMPANIES.filter((c) => c.status === 'written_off').length },
  ];

  const content = (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total value" value={fmtMoney(PORTFOLIO_SUMMARY.totalValue)} hint={`Invested ${fmtMoney(PORTFOLIO_SUMMARY.totalInvested)}`} />
        <StatCard label="Blended MOIC" value={fmtMoic(PORTFOLIO_SUMMARY.blendedMOIC)} hint="Multiple on invested capital" />
        <StatCard label="Blended IRR" value={fmtPct(PORTFOLIO_SUMMARY.blendedIRR)} hint="Net internal rate of return" />
        <StatCard label="TVPI" value={`${PORTFOLIO_SUMMARY.tvpi.toFixed(2)}x`} hint="Total value / paid-in" />
        <StatCard label="DPI" value={`${PORTFOLIO_SUMMARY.dpi.toFixed(2)}x`} hint="Distributions / paid-in" />
      </div>

      {/* Aggregated valuation history */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <Section title="Portfolio valuation over time">
          <div className="mt-2" style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={aggregate} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="valFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} opacity={0.4} />
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtMoney} width={54} />
                <Tooltip
                  formatter={(v, n) => [fmtMoneyFull(v), n === 'valuation' ? 'Fair value' : 'Invested']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="valuation" name="Fair value" stroke="#8b5cf6" strokeWidth={2} fill="url(#valFill)" />
                <Line type="monotone" dataKey="invested" name="Invested" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Company table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Companies</h3>
          <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
        </div>
        {sorted.length === 0 ? (
          <div className="p-6"><EmptyState>No companies match this filter.</EmptyState></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-4 py-2.5 text-left"><SortHeader label="Company" field="name" sort={sort} setSort={setSort} /></th>
                  <th className="px-4 py-2.5 text-right"><SortHeader label="Invested" field="invested" sort={sort} setSort={setSort} align="right" /></th>
                  <th className="px-4 py-2.5 text-right"><SortHeader label="Current value" field="currentValue" sort={sort} setSort={setSort} align="right" /></th>
                  <th className="px-4 py-2.5 text-right"><SortHeader label="MOIC" field="moic" sort={sort} setSort={setSort} align="right" /></th>
                  <th className="px-4 py-2.5 text-right"><SortHeader label="IRR" field="irr" sort={sort} setSort={setSort} align="right" /></th>
                  <th className="px-4 py-2.5 text-right"><SortHeader label="Ownership" field="ownershipPct" sort={sort} setSort={setSort} align="right" /></th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {sorted.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                        <Chip tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Chip>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{c.sector} · {c.stage} · {c.vintage}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtMoney(c.invested)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100 font-medium">{fmtMoney(c.currentValue)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={c.moic >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{fmtMoic(c.moic)}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={`inline-flex items-center gap-0.5 ${c.irr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {c.irr >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {fmtPct(c.irr)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{c.ownershipPct.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right">
                      <ArrowUpRight size={14} className="text-gray-400 inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cohort + benchmark charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <Section title="Vintage cohort comparison">
            <div className="mt-2" style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={COHORTS} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} opacity={0.4} vertical={false} />
                  <XAxis dataKey="vintage" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis yAxisId="left" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}x`} width={38} />
                  <YAxis yAxisId="right" orientation="right" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={40} />
                  <Tooltip
                    formatter={(v, n) => (n === 'moic' ? [`${v.toFixed(2)}x`, 'MOIC'] : [`${v.toFixed(1)}%`, 'IRR'])}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="moic" name="MOIC" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="irr" name="IRR" fill="#34d399" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <Section title="IRR vs benchmarks">
            <div className="mt-2" style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={BENCHMARKS} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} opacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={140} />
                  <Tooltip
                    formatter={(v) => [`${v.toFixed(1)}%`, 'IRR']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="irr" name="IRR" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>
      </div>

      {/* Per-company slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.name}
        subtitle={selected ? `${selected.sector} · ${selected.stage} · Vintage ${selected.vintage}` : ''}
      >
        {selected && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Invested" value={fmtMoney(selected.invested)} />
              <StatCard label="Current value" value={fmtMoney(selected.currentValue)} />
              <StatCard label="MOIC" value={fmtMoic(selected.moic)} />
              <StatCard label="IRR" value={fmtPct(selected.irr)} />
            </div>

            <Section title="Valuation history">
              <div className="mt-2" style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={selected.valuationHistory} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="miniFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} opacity={0.4} />
                    <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={20} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtMoney} width={50} />
                    <Tooltip formatter={(v) => [fmtMoneyFull(v), 'Valuation']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Area type="monotone" dataKey="valuation" stroke="#8b5cf6" strokeWidth={2} fill="url(#miniFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Mark-up timeline">
              <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-1 space-y-4">
                {selected.valuationHistory.map((p, i) => (
                  <li key={p.date + i} className="ml-4">
                    <span className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full bg-violet-500 border-2 border-white dark:border-gray-950" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{p.date}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoneyFull(p.valuation)}</span>
                    </div>
                    {p.markup && <div className="text-xs text-violet-600 dark:text-violet-300 mt-0.5">{p.markup}</div>}
                  </li>
                ))}
              </ol>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Ownership">{selected.ownershipPct.toFixed(1)}%</Field>
              <Field label="Status">{STATUS_LABEL[selected.status]}</Field>
            </div>
          </>
        )}
      </SlideOver>
    </div>
  );

  if (embedded) return content;
  return <div className="p-6 max-w-7xl mx-auto">{content}</div>;
}
