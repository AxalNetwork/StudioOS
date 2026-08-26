import React, { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { StatCard, Section, Chip, FilterChips, EmptyState } from './advisor/network/kit';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import InfoStrip from '../components/InfoStrip';
import {
  useFundAnalytics, fmtCents, fmtMultiple, Unrecorded,
} from '../lib/fundAnalytics';

/**
 * Fund Performance — /funds/performance, a tab of FundOpsWorkspace.
 *
 * This page used to render four invented funds with invented NAV, IRR, TVPI
 * and RVPI, plus a J-curve, a NAV-over-time series and a deployment-pacing
 * chart built from the same fixture. All three charts are gone rather than
 * re-pointed, because none of them has a source:
 *
 *   J-curve            needs dated cumulative net cashflow. A per-fund capital
 *                      call is recorded as a notice job, not a dated receipt.
 *   NAV over time      needs a NAV. There is no fund-level valuation mark.
 *   Deployment pacing  vc_funds.deployed_capital is one scalar with no history,
 *                      and the "target" series was invented outright.
 *
 * A chart is a stronger claim than a number — it asserts a shape over time —
 * so drawing one from data that does not exist is the worst version of the
 * problem, not a softer one. What survives is what D1 can answer, and the
 * strip at the top says plainly what is missing and what would fill it.
 */

const STATUS_TONE = {
  harvesting: 'emerald',
  active: 'violet',
  investing: 'blue',
  fundraising: 'blue',
  closed: 'gray',
  wound_down: 'gray',
};

const titleCase = (s) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown';

export default function FundPerformancePage({ embedded = false }) {
  const { items, totals, unavailable, loading, error, reload } = useFundAnalytics();
  const [statusFilter, setStatusFilter] = useState('all');

  const statusOptions = useMemo(() => {
    const counts = items.reduce((acc, f) => {
      const k = f.status || 'unknown';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    return [
      { id: 'all', label: 'All funds', count: items.length },
      ...Object.keys(counts).map((s) => ({ id: s, label: titleCase(s), count: counts[s] })),
    ];
  }, [items]);

  const funds = useMemo(
    () => (statusFilter === 'all' ? items : items.filter((f) => (f.status || 'unknown') === statusFilter)),
    [items, statusFilter],
  );

  let content;
  if (loading) {
    content = (
      <div className="space-y-4" aria-busy="true">
        <Skeleton h={16} w="66%" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={88} rounded="rounded-xl" />)}
        </div>
        <Skeleton.Table rows={4} cols={6} />
      </div>
    );
  } else if (error) {
    content = <ErrorState message={error} onRetry={reload} />;
  } else {
    const blendedDpi = fmtMultiple(totals?.dpi);
    content = (
      <div className="space-y-6">
        <InfoStrip
          variant="info"
          storageKey="funds-performance-basis"
          title="What these figures are, and what is missing"
          body={
            'Committed, called, deployed and distributed come from D1 rows. DPI is '
            + 'distributions over called capital. NAV, RVPI, TVPI and net IRR read '
            + '"Not recorded" because nothing in the schema supports them yet: there '
            + 'are no fund-level valuation marks, and capital calls are stored as '
            + 'notices rather than dated cash receipts. Hover any "Not recorded" '
            + 'cell for the specific reason.'
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard
            label="Committed"
            value={fmtCents(totals?.committed_cents)}
            hint={`${totals?.fund_count || 0} fund${totals?.fund_count === 1 ? '' : 's'}, ${totals?.lp_count || 0} LP${totals?.lp_count === 1 ? '' : 's'}`}
          />
          <StatCard label="Called" value={fmtCents(totals?.called_cents)} hint="Paid in by LPs to date" />
          <StatCard label="Deployed" value={fmtCents(totals?.deployed_cents)} hint="Invested into portfolio" />
          <StatCard label="Distributed" value={fmtCents(totals?.distributed_cents)} hint="Paid distributions" />
          <StatCard
            label="Blended DPI"
            value={blendedDpi || <Unrecorded reason="No capital has been called yet, so there is nothing to divide by." />}
            hint="Family distributions ÷ family called"
          />
        </div>

        {/* The four the schema cannot answer, kept visible rather than dropped:
            an LP should see that TVPI is tracked and unavailable, not wonder
            whether anyone measures it. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['NAV', 'nav_cents'],
            ['RVPI', 'rvpi'],
            ['TVPI', 'tvpi'],
            ['Net IRR', 'irr'],
          ].map(([label, key]) => (
            <StatCard key={key} label={label} value={<Unrecorded reason={unavailable[key]} />} hint={unavailable[key]} />
          ))}
        </div>

        <Section title="Fund-by-fund">
          {items.length > 0 && (
            <div className="mb-3">
              <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
            </div>
          )}
          {items.length === 0 ? (
            <EmptyState>
              No funds are recorded yet. A fund appears here once it exists in fund administration.
            </EmptyState>
          ) : funds.length === 0 ? (
            <EmptyState>No funds match this filter.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Fund</th>
                    <th className="text-left font-medium px-4 py-2.5">Vintage</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                    <th className="text-right font-medium px-4 py-2.5">LPs</th>
                    <th className="text-right font-medium px-4 py-2.5">Committed</th>
                    <th className="text-right font-medium px-4 py-2.5">Called</th>
                    <th className="text-right font-medium px-4 py-2.5">Deployed</th>
                    <th className="text-right font-medium px-4 py-2.5">Distributed</th>
                    <th className="text-right font-medium px-4 py-2.5">DPI</th>
                    <th className="text-right font-medium px-4 py-2.5">TVPI</th>
                    <th className="text-right font-medium px-4 py-2.5">Net IRR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {funds.map((f) => {
                    const dpi = fmtMultiple(f.dpi);
                    return (
                      <tr key={f.id} className="bg-white dark:bg-gray-900">
                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{f.name}</td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                          {f.vintage_year ?? <Unrecorded reason="No vintage year is set on this fund." />}
                        </td>
                        <td className="px-4 py-2.5">
                          <Chip tone={STATUS_TONE[f.status] || 'gray'}>{titleCase(f.status)}</Chip>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{f.lp_count}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtCents(f.committed_cents)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtCents(f.called_cents)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtCents(f.deployed_cents)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtCents(f.distributed_cents)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-gray-100">
                          {dpi || <Unrecorded reason="Nothing has been called for this fund yet." />}
                        </td>
                        <td className="px-4 py-2.5 text-right"><Unrecorded reason={unavailable.tvpi} /></td>
                        <td className="px-4 py-2.5 text-right"><Unrecorded reason={unavailable.irr} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    );
  }

  if (embedded) return content;
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-violet-600" /> Fund Performance
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Committed, called, deployed and distributed capital across the fund family.
        </p>
      </div>
      {content}
    </div>
  );
}
