import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StatCard, Section, Chip, FilterChips, EmptyState } from './advisor/network/kit';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import { fmtMultiple, fmtRate, Unrecorded } from '../lib/fundAnalytics';
import { fundPerformanceApi } from '../lib/api/fundPerformance.js';
import { titleCase as caseLabel } from '../lib/absence';
import FundPerformanceShell from './investor/FundPerformanceShell';
import { api } from '../lib/api';
import { useActiveCompany } from '../contexts/ActiveCompanyContext';
import { useRead } from './admin/fundAdmin/useRead';
import FundPerformanceDetail from './investor/FundPerformanceDetail';
import { Unreadable } from '../ui/Honesty';
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
export function FundPerformanceView({ items = [], loading = false, error = null, reload = () => {}, audience = { status: 'loading' } }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [focusTick, setFocusTick] = useState(0);
  const detailRef = useRef(null);
  useEffect(() => { if (selectedId == null && items.length) setSelectedId(items[0].id); }, [items, selectedId]);
  useEffect(() => {
    if (focusTick > 0) {
      detailRef.current?.focus?.();
      detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    }
  }, [focusTick]);
  const statusOptions = useMemo(() => {
    const counts = items.reduce((acc, f) => { const key = f.status || 'unknown'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
    return [{ id: 'all', label: 'All funds', count: items.length }, ...Object.keys(counts).map(key => ({ id: key, label: titleCase(key) || 'Unknown', count: counts[key] }))];
  }, [items]);
  const funds = statusFilter === 'all' ? items : items.filter(f => (f.status || 'unknown') === statusFilter);
  const selected = selectedId == null ? funds[0] : funds.find(f => String(f.id) === String(selectedId));
  const canManage = audience.status === 'ready' && audience.data.items.some(f => String(f.id) === String(selected?.id) && f.can_manage === true);
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
          <button type="button" className="min-h-11 underline" aria-pressed={selected?.id === fund.id} aria-controls="fund-performance-selected-detail" onClick={() => { setSelectedId(fund.id); setFocusTick(n => n + 1); }}>Show detail</button>
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
    {!selected && selectedId != null && funds.length > 0 && <p role="status">{items.some(f => String(f.id) === String(selectedId)) ? 'The selected fund is hidden by this filter. Change the filter or choose a visible fund.' : 'The selected fund is not in the current read. Choose a fund listed above.'}</p>}
    {selected && <section id="fund-performance-selected-detail" ref={detailRef} tabIndex={-1} aria-label="Selected fund detail" className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
      {audience.status === 'loading' && <p aria-busy="true">Checking access to fund detail…</p>}
      {audience.status === 'unreadable' && <Unreadable what="Fund detail access" onRetry={audience.reload} />}
      {audience.status === 'ready' && <FundPerformanceDetail key={selected.id} fund={selected} canManage={canManage} />}
    </section>}
  </div>;
}
/** #6245 (owner: C): the page; its Fund chrome is `investor/FundPerformanceShell.jsx`. */
export default function FundPerformancePage({ fundUnlocked = false, locked = false }) {
  const { company } = useActiveCompany();
  const scope = company?.id ?? null;
  return <FundPerformanceReader key={`${scope}:${locked}`} scope={scope} fundUnlocked={fundUnlocked} locked={locked} />;
}
// Company/licence changes remount; Refresh binds every result to a new read generation without replacing the chrome.
function FundPerformanceReader({ scope, fundUnlocked, locked }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ items: [], loading: !locked, error: null, generation: 0 });
  useEffect(() => {
    if (locked) return undefined;
    let live = true;
    setState({ items: [], loading: true, error: null, generation: attempt });
    fundPerformanceApi.list().then(data => {
      if (!Array.isArray(data?.items) || data.items.some(f => !Number.isSafeInteger(f?.id) || f.id < 1 || typeof f.name !== 'string')) throw new Error('The fund performance response could not be read.');
      if (live) setState({ items: data.items, loading: false, error: null, generation: attempt });
    }).catch(error => { if (live) setState({ items: [], loading: false, error: error?.message || 'Fund performance could not be read.', generation: attempt }); });
    return () => { live = false; };
  }, [attempt, locked, scope]);
  const audience = useRead(async () => {
    const result = await api.fundsList();
    if (!Array.isArray(result?.items) || result.items.some(f => !Number.isSafeInteger(f?.id) || f.id < 1 || typeof f.can_manage !== 'boolean')) throw new Error('Fund access could not be read.');
    return { items: result.items, permissionAttempt: attempt };
  }, [scope, attempt], { enabled: !locked });
  const visible = state.generation === attempt ? state : { items: [], loading: true, error: null };
  const currentAudience = audience.status === 'ready' && audience.data?.permissionAttempt !== attempt ? { ...audience, status: 'loading', data: null } : audience;
  const reload = () => setAttempt(n => n + 1);
  return <FundPerformanceShell fundUnlocked={fundUnlocked} locked={locked} state={visible} reload={reload}>
    <FundPerformanceView key={scope} {...visible} reload={reload} audience={currentAudience} />
  </FundPerformanceShell>;
}
