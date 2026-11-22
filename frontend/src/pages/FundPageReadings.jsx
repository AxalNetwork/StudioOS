/** D6254 — independent fund-page performance, GP positions and the LP's own position. */
import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fundPerformanceApi } from '../lib/api/fundPerformance';
import { DataState, Unreadable } from '../ui/Honesty';
import { useRead } from './admin/fundAdmin/useRead';
import { cents, dollars, multiple, rate, dayText } from './admin/fundAdmin/performanceModel';

const missing = reason => <DataState state="not_recorded" reason={reason || 'No figure was returned by this read.'} />;

export async function readPagePerformance(id, reader = fundPerformanceApi.read) {
  const value = await reader(id);
  if (!Number.isSafeInteger(value?.id) || value.id !== Number(id) || !/^\d{4}-\d{2}-\d{2}$/.test(value.as_of || '') || !value.unavailable || typeof value.unavailable !== 'object' || Array.isArray(value.unavailable)
    || !['nav_cents', 'paid_in_cents', 'distributed_cents'].every(k => value[k] === null || (Number.isSafeInteger(value[k]) && value[k] >= 0))
    || !['tvpi', 'dpi', 'irr'].every(k => value[k] === null || (typeof value[k] === 'number' && Number.isFinite(value[k])))) throw Error('Performance unreadable');
  return value;
}
export async function readPagePositions(id, reader = fundPerformanceApi.positions) {
  const result = await reader(id);
  if (result?.fund_id !== Number(id) || !Array.isArray(result?.items) || result.items.some(row => !Number.isSafeInteger(row?.id) || row.id < 1)
    || !/^\d{4}-\d{2}-\d{2}$/.test(result.as_of || '') || !Number.isSafeInteger(result.unmarked) || result.unmarked < 0 || result.unmarked > result.items.length) throw Error('Positions unreadable');
  return result;
}

export function PerformanceBand({ reading }) {
  return <article className="fd-card fd-performance" data-testid="fund-page-performance">
    <h2>Performance · fund level{reading.status === 'ready' ? ` · as of ${dayText(reading.data.as_of)}` : ''}</h2>
    {reading.status === 'loading' && <p aria-busy="true">Reading fund performance…</p>}
    {reading.status === 'unreadable' && <Unreadable what="Fund performance" onRetry={reading.reload} />}
    {reading.status === 'ready' && <>
      <dl className="fd-performance-grid">{[
        ['NAV · USD', 'nav_cents', cents], ['Called · USD', 'paid_in_cents', cents], ['Distributed · USD', 'distributed_cents', cents],
        ['TVPI', 'tvpi', multiple], ['DPI', 'dpi', multiple], ['IRR · called-capital basis', 'irr', rate],
      ].map(([label, key, format]) => <div key={key}><dt>{label}</dt><dd>{format(reading.data[key]) ?? missing(reading.data.unavailable[key])}</dd></div>)}
        <div><dt>Uncalled · USD</dt><dd>{missing('The performance read does not return uncalled capital.')}</dd></div>
      </dl>
      <p className="fd-source">{reading.data.nav_basis || 'NAV covers investments only.'} Source: fund performance read.</p>
    </>}
    <Link to="/funds/performance" className="fd-inline-link">Open fund performance</Link>
  </article>;
}

export function FundPositionsSummary({ reading }) {
  return <article className="fd-card" data-testid="fund-page-positions"><h2>Positions</h2>
    {reading.status === 'loading' && <p aria-busy="true">Reading positions…</p>}
    {reading.status === 'unreadable' && <Unreadable what="Fund positions" onRetry={reading.reload} />}
    {reading.status === 'ready' && <><p><b>{reading.data.items.length}</b> positions · <b>{reading.data.unmarked}</b> unmarked</p><p className="fd-source">Latest marks as of {dayText(reading.data.as_of)}. Source: this fund's positions read. Cost does not replace an unrecorded mark.</p></>}
    <Link to="/funds/performance" className="fd-inline-link">Open Performance</Link>
  </article>;
}

export function LpPosition({ reading, fundId }) {
  const rows = reading.status === 'ready' ? reading.data.lp_holdings.filter(row => Number(row.fund_id) === Number(fundId)) : [];
  return <article className="fd-card" data-testid="fund-page-lp-position"><h2>Your position</h2>
    {reading.status === 'loading' && <p aria-busy="true">Reading your LP position…</p>}
    {reading.status === 'unreadable' && <Unreadable what="Your LP position" onRetry={reading.reload} />}
    {reading.status === 'ready' && (rows.length ? rows.map(row => {
      const perf = reading.data.performance.find(p => Number(p.lp_id) === Number(row.id) && Number(p.fund_id) === Number(fundId));
      return <section key={row.id} className="fd-entry"><h3>{row.name || 'Your LP position'}</h3><dl>
        <div><dt>Commitment · USD</dt><dd>{dollars(row.commitment_amount) ?? missing('Your commitment amount has not been recorded.')}</dd></div>
        <div><dt>Invested · USD</dt><dd>{dollars(row.invested_amount) ?? missing('Your invested amount has not been recorded.')}</dd></div>
        <div><dt>Distributions · USD</dt><dd>{dollars(perf?.distributions_dollars) ?? missing('Your distributions were not returned by the LP performance read.')}</dd></div>
        <div><dt>LPA signed on</dt><dd>{dayText(row.lpa_signed_at) || missing('No LPA signature date is recorded.')}</dd></div>
        <div><dt>Your TVPI</dt><dd>{multiple(perf?.tvpi) ?? missing('The LP performance read has no TVPI for this position.')}</dd></div>
        <div><dt>Your DPI</dt><dd>{multiple(perf?.dpi) ?? missing('The LP performance read has no DPI for this position.')}</dd></div>
      </dl></section>;
    }) : missing('Your LP position was not included in this read.'))}
    <p className="fd-source">Source: your LP portal, filtered to this fund. Fund totals above are not your personal position.</p>
    <Link to="/spinout-lab/investor-workspace" className="fd-inline-link">Your capital statements</Link>
  </article>;
}

/** Permission decides which read exists at all; an LP never requests positions. */
export default function FundPageReadings({ page, children }) {
  const id = page.fund.id;
  const performance = useRead(() => readPagePerformance(id), [id]);
  const positions = useRead(() => readPagePositions(id), [id], { enabled: page.can_manage === true });
  const lp = useRead(async () => {
    const result = await api.fundsLpPortal();
    if (!Array.isArray(result?.lp_holdings) || !Array.isArray(result?.performance)
      || result.lp_holdings.some(row => !row || !Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.fund_id))
      || result.performance.some(row => !row || !Number.isSafeInteger(row.lp_id) || !Number.isSafeInteger(row.fund_id))) throw Error('LP position unreadable');
    return result;
  }, [id], { enabled: page.can_manage === false });
  if (children) return children({ performance, positions, lp });
  return <>
    <PerformanceBand reading={performance} />
    {page.can_manage ? <FundPositionsSummary reading={positions} /> : <>
      <LpPosition reading={lp} fundId={id} />
      <p className="fd-source">Positions remain GP-only. Quarterly history is not available in this view yet; your issued reports remain available below.</p>
    </>}
  </>;
}
