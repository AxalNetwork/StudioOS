import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { StatCard, Section, Chip, FilterChips, EmptyState } from './advisor/network/kit';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import { fmtMultiple, fmtRate, Unrecorded } from '../lib/fundAnalytics';
import { fundPerformanceApi } from '../lib/api/fundPerformance.js';
import { titleCase as caseLabel } from '../lib/absence';
const titleCase = (s) => caseLabel(s) || 'Unknown';

const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function PerformanceMetric({ fund, field, label, format = money }) {
  const unavailable = fund.unavailable || {};
  const value = fund[field];
  return <StatCard label={label} value={value == null
    ? <Unrecorded reason={unavailable[field]} />
    : format(value)} hint={value == null ? unavailable[field] : undefined} />;
}

/** D627: I6's fund summary and investment NAV, without unrecorded cash or charts. */
export function FundPerformanceView({ items = [], loading = false, error = null, reload = () => {} }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const statusOptions = useMemo(() => {
    const counts = items.reduce((acc, f) => { const key = f.status || 'unknown'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
    return [{ id: 'all', label: 'All funds', count: items.length }, ...Object.keys(counts).map(key => ({ id: key, label: titleCase(key) || 'Unknown', count: counts[key] }))];
  }, [items]);
  const funds = statusFilter === 'all' ? items : items.filter(f => (f.status || 'unknown') === statusFilter);
  if (loading) return <div className="space-y-4" aria-busy="true" aria-label="Loading fund performance"><Skeleton h={16} w="66%" /><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0,1,2,3].map(i => <Skeleton key={i} h={88} rounded="rounded-xl" />)}</div></div>;
  if (error) return <ErrorState message={`Unreadable: ${error}`} onRetry={reload} />;
  return <div className="space-y-6">
    <p className="text-sm text-gray-600 dark:text-gray-400">Paid-in means capital called. NAV uses the latest recorded position marks and covers investments only; cash, liabilities, fees and carry are excluded. IRR uses dated calls out, paid distributions in, and NAV as the terminal value.</p>
    {items.length > 0 && <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />}
    {items.length === 0 ? <EmptyState>Not recorded: no funds are available for this account.</EmptyState>
      : funds.length === 0 ? <EmptyState>No funds match this filter.</EmptyState>
      : funds.map(fund => <Section key={fund.id} title={fund.name}>
        <div className="flex flex-wrap gap-3 items-center mb-4 text-sm text-gray-600 dark:text-gray-400">
          <Chip tone="gray">{titleCase(fund.status) || 'Unknown'}</Chip>
          <span>{fund.vintage_year == null ? <Unrecorded reason="No vintage year is recorded." /> : `${fund.vintage_year} vintage`}</span>
          <span>As of {fund.as_of}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <PerformanceMetric fund={fund} field="nav_cents" label="NAV · investments only" />
          <PerformanceMetric fund={fund} field="rvpi" label="RVPI" format={fmtMultiple} />
          <PerformanceMetric fund={fund} field="tvpi" label="TVPI" format={fmtMultiple} />
          <PerformanceMetric fund={fund} field="irr" label="IRR · called-capital basis" format={fmtRate} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          <PerformanceMetric fund={fund} field="paid_in_cents" label="Paid-in · capital called" />
          <PerformanceMetric fund={fund} field="distributed_cents" label="Paid distributions" />
          <PerformanceMetric fund={fund} field="dpi" label="DPI" format={fmtMultiple} />
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{fund.nav_basis}</p>
      </Section>)}
  </div>;
}
export default function FundPerformancePage({ embedded = false }) {
  const [state, setState] = useState({ items: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ items: [], loading: true, error: null });
    fundPerformanceApi.list().then(data => {
      if (!Array.isArray(data?.items)) throw new Error('The fund performance response could not be read.');
      if (live) setState({ items: data.items, loading: false, error: null });
    }).catch(error => { if (live) setState({ items: [], loading: false, error: error?.message || 'Fund performance could not be read.' }); });
    return () => { live = false; };
  }, [attempt]);
  const content = <FundPerformanceView {...state} reload={() => setAttempt(n => n + 1)} />;
  if (embedded) return content;
  return <div className="p-6 max-w-7xl mx-auto"><div className="mb-6"><h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><TrendingUp className="w-6 h-6 text-violet-600" />Fund Performance</h1><p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Performance from recorded valuations and fund cash flows.</p></div>{content}</div>;
}
