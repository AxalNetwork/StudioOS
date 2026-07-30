import React, { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { StatCard, Section, Chip, FilterChips, EmptyState } from './advisor/network/kit';
import {
  FUNDS, FUND_SUMMARY, NAV_HISTORY, JCURVE, DEPLOYMENT_PACING,
} from '../data/fundAnalytics';

const fmtM = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtX = (v) => `${Number(v || 0).toFixed(2)}x`;
const fmtPct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;

const STATUS_TONE = {
  Harvesting: 'emerald',
  Active: 'violet',
  Investing: 'blue',
};

const AXIS = { fontSize: 11, fill: '#9ca3af' };

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        {subtitle && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid rgba(148,163,184,0.35)',
  background: 'rgba(17,24,39,0.92)',
  color: '#f9fafb',
};

export default function FundPerformancePage({ embedded = false }) {
  const [statusFilter, setStatusFilter] = useState('all');

  const statusOptions = useMemo(() => {
    const counts = FUNDS.reduce((acc, f) => {
      acc[f.status] = (acc[f.status] || 0) + 1;
      return acc;
    }, {});
    return [
      { id: 'all', label: 'All funds', count: FUNDS.length },
      ...Object.keys(counts).map((s) => ({ id: s, label: s, count: counts[s] })),
    ];
  }, []);

  const funds = useMemo(
    () => (statusFilter === 'all' ? FUNDS : FUNDS.filter((f) => f.status === statusFilter)),
    [statusFilter],
  );

  const content = (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        LP-ready returns across the Axal fund family — blended TVPI, net IRR and the
        classic J-curve, with per-fund detail suitable for quarterly reporting.
      </p>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="AUM" value={fmtM(FUND_SUMMARY.aum)} hint="Net asset value across funds" />
        <StatCard label="Blended TVPI" value={fmtX(FUND_SUMMARY.blendedTVPI)} hint="Total value to paid-in" />
        <StatCard label="Net IRR" value={fmtPct(FUND_SUMMARY.blendedIRR)} hint="Since inception" />
        <StatCard label="DPI" value={fmtX(FUND_SUMMARY.blendedDPI)} hint="Distributions to paid-in" />
        <StatCard label="RVPI" value={fmtX(FUND_SUMMARY.blendedRVPI)} hint="Residual value to paid-in" />
      </div>

      {/* J-curve */}
      <ChartCard
        title="J-curve — cumulative net cashflow"
        subtitle="Contributions early, distributions later; the curve climbs back toward breakeven."
      >
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={JCURVE} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="jcurveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis dataKey="quarter" tick={AXIS} tickLine={false} axisLine={false} interval={1} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtM} width={54} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, n) => [fmtM(v), n === 'cumulative' ? 'Cumulative' : 'Net cashflow']}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone" dataKey="cumulative" name="Cumulative"
              stroke="#7c3aed" strokeWidth={2} fill="url(#jcurveFill)"
            />
            <Line type="monotone" dataKey="netCashflow" name="Net cashflow" stroke="#10b981" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* NAV over time */}
        <ChartCard
          title="NAV over time"
          subtitle="Contributions vs distributions vs net asset value."
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={NAV_HISTORY} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis
                dataKey="date" tick={AXIS} tickLine={false} axisLine={false}
                tickFormatter={(d) => String(d).slice(0, 7)} interval={2}
              />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtM} width={54} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtM(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="nav" name="NAV" stroke="#7c3aed" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="contributions" name="Contributions" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="distributions" name="Distributions" stroke="#10b981" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Deployment pacing */}
        <ChartCard
          title="Capital deployment & pacing"
          subtitle="Deployed capital against the pacing target per period."
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={DEPLOYMENT_PACING} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
              <XAxis dataKey="period" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtM} width={54} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, n) => [fmtM(v), n === 'deployed' ? 'Deployed' : 'Target']}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="deployed" name="Deployed" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              <Bar dataKey="target" name="Target" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Per-fund table */}
      <Section title="Fund-by-fund returns">
        <div className="mb-3">
          <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
        </div>
        {funds.length === 0 ? (
          <EmptyState>No funds match this filter.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Fund</th>
                  <th className="text-left font-medium px-4 py-2.5">Vintage</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="text-right font-medium px-4 py-2.5">Size</th>
                  <th className="text-right font-medium px-4 py-2.5">Called</th>
                  <th className="text-right font-medium px-4 py-2.5">NAV</th>
                  <th className="text-right font-medium px-4 py-2.5">DPI</th>
                  <th className="text-right font-medium px-4 py-2.5">RVPI</th>
                  <th className="text-right font-medium px-4 py-2.5">TVPI</th>
                  <th className="text-right font-medium px-4 py-2.5">Net IRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {funds.map((f) => (
                  <tr key={f.id} className="bg-white dark:bg-gray-900">
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{f.name}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{f.vintage}</td>
                    <td className="px-4 py-2.5">
                      <Chip tone={STATUS_TONE[f.status] || 'gray'}>{f.status}</Chip>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(f.size)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(f.called)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-gray-100">{fmtM(f.nav)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtX(f.dpi)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtX(f.rvpi)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-violet-700 dark:text-violet-300">{fmtX(f.tvpi)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-emerald-700 dark:text-emerald-300">{fmtPct(f.irr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );

  if (embedded) return content;
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-violet-600" /> Fund Performance
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Returns, J-curve and deployment pacing across the Axal fund family.
        </p>
      </div>
      {content}
    </div>
  );
}
