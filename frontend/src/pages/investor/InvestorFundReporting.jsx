import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileBarChart, Plus, RefreshCw } from 'lucide-react';
import { WorkerRail, Unreadable } from '../../ui';
import ZoneHeader from '../../workspaces/ZoneHeader';
import { ZonePrimaryScope } from '../../workspaces/ZoneActions';
import { api } from '../../lib/api';
import './investorFundLanding.css';
import './investorFundReporting.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';
import { titleCase as caseLabel } from '../../lib/absence';
import { useManagedFund, FundPicker } from './managedFund';
import FromMercury from './FromMercury';

/*
 * #6230: this page is the selected fund's reporting periods, and nothing else.
 *
 * It used to read `api.lpReportsList()` with no fund and show those rows
 * whenever there were any, so one visible LP report anywhere replaced the
 * selected fund's periods. The LP report list is not on this page any more:
 * the owner removed LP Reporting as a surface (2026-10-20), and
 * `fund_report_periods` is the store the period editor writes.
 *
 * A period's `status` is `draft` or `issued` (migration 163). The chips used to
 * select `published` and `drafted`, which no period carries, so both matched
 * nothing. They select the stored words now.
 *
 * "Can manage" is not decided here. `useManagedFund` keeps only funds the
 * Worker marks `can_manage`, the same test `requireFundGp` runs, and the Worker
 * answers every read and write on its own.
 */

const titleCase = (value) => caseLabel(value) || 'Unrecorded';
export const periodOf = (row) => row?.period || `Period ${row?.id ?? 'unrecorded'}`;
/** The stored status, lowercased. Only a row with no status falls back to `issued_at`. */
export function statusOf(row) {
  const stored = String(row?.status ?? '').trim().toLowerCase();
  if (stored) return stored;
  return row?.issued_at ? 'issued' : 'draft';
}
/** The chip keys, and the rows each selects. `all` is every row. */
export function periodsFor(filter, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (filter === 'issued' || filter === 'draft') return list.filter((row) => statusOf(row) === filter);
  return list;
}
export function periodCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { all: list.length, issued: periodsFor('issued', list).length, draft: periodsFor('draft', list).length };
}
export const periodPath = (fundId, row) => `/funds/${fundId}/reporting/${row.id}`;
export const newPeriodPath = (fundId) => `/funds/${fundId}/reporting/new`;
const date = (value) => value ? String(value).slice(0, 10) : null;
const span = (row) => (date(row.period_start) && date(row.period_end) ? `${date(row.period_start)} to ${date(row.period_end)}` : 'Dates not set');

function hasNarrative(narrative) {
  return Object.values(narrative).some((part) => (Array.isArray(part) ? part.length > 0 : part != null && part !== ''));
}
export function ReportContents({ row }) {
  if (row.narrative && typeof row.narrative === 'object') return <>{hasNarrative(row.narrative) ? 'Recorded narrative' : 'No narrative written yet'}</>;
  return <>{row.narrative || row.contents || row.note || 'Source contents not recorded'}</>;
}

export const NO_FUND_REASON = 'A reporting period is drafted and issued by the fund’s general partner of record. You do not operate a fund here, so there is no period to open and none to start.';

function NewPeriodLink({ fundId }) {
  return <Link className="if4-new" data-testid="link-new-reporting-period" to={newPeriodPath(fundId)}><Plus size={13} /> New reporting period</Link>;
}

/**
 * The archive card. Pure over its props so the four states can be rendered in
 * a test: loading, Unreadable, no fund to operate, and the periods.
 */
export function ReportingArchive({ loading, error, fund, rows, filter, onRetry }) {
  const visible = periodsFor(filter, rows);
  const count = rows.length;
  let body;
  if (loading) body = <div className="i6-skeleton" aria-busy="true" />;
  else if (error) {
    body = <div className="if4-unreadable" data-testid="status-fund-reporting-unreadable"><strong>Unreadable</strong>
      <Unreadable what="This fund’s reporting periods" claim="This is not a claim that the fund has no period." onRetry={onRetry} /></div>;
  } else if (!fund) {
    body = <div className="if4-empty" data-testid="status-no-managed-fund"><div><strong>No fund to report on</strong><p>{NO_FUND_REASON}</p></div></div>;
  } else if (!count) {
    body = <div className="if4-empty" data-testid="status-fund-reporting-empty"><div><strong>No reporting period yet</strong>
      <p>{fund.name || 'This fund'} has no reporting period. Start one: it stays a draft until you issue it.</p><NewPeriodLink fundId={fund.id} /></div></div>;
  } else if (!visible.length) {
    body = <div className="if4-empty"><div><strong>No period matches this filter.</strong></div></div>;
  } else {
    body = <div className="if4-table-wrap"><table><thead><tr><th>Period</th><th>State</th><th>Issued</th><th>Contents</th></tr></thead><tbody>
      {visible.map((row) => <tr key={row.id ?? periodOf(row)} data-testid="row-reporting-period">
        <td><Link className="if4-period-link" to={periodPath(fund.id, row)}>{periodOf(row)}</Link><small>{span(row)}</small></td>
        <td><span className={`if4-pill ${statusOf(row)}`}>{titleCase(statusOf(row))}</span></td>
        <td>{date(row.issued_at) || 'Not issued'}</td>
        <td><ReportContents row={row} /></td></tr>)}
    </tbody></table></div>;
  }
  const subtitle = loading ? 'Loading the fund’s periods' : error || !fund ? 'No count is shown' : `${visible.length} of ${count} periods`;
  return <section className="i6-card if4-archive" data-testid="fund-reporting-archive"><header><div><h2>Reporting periods</h2><span>{subtitle}</span></div>
    {fund && !loading && !error && count > 0 && <NewPeriodLink fundId={fund.id} />}</header>{body}
    <p className="i6-footnote">A draft is not shown as issued, and an issued period is not shown as delivered to each LP.</p></section>;
}

export default function InvestorFundReporting() {
  // D371: the periods are read for a fund the caller operates (`can_manage`,
  // `?fund=`), not `items[0]` of a list that also carries LP-only funds.
  const managed = useManagedFund();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (managed.loading) { setState({ loading: true, rows: [], error: null }); return; }
    if (managed.error) { setState({ loading: false, rows: [], error: managed.error }); return; }
    if (!managed.fund?.id) { setState({ loading: false, rows: [], error: null }); return; }
    setState({ loading: true, rows: [], error: null });
    try {
      const periods = await api.fundsReportPeriods(managed.fund.id);
      const rows = periods?.items || periods?.periods;
      if (!Array.isArray(rows)) throw new Error('The reporting periods came back in a shape this page cannot read.');
      setState({ loading: false, rows, error: null });
    } catch (error) {
      setState({ loading: false, rows: [], error: error?.message || 'The reporting periods could not be read.' });
    }
  }, [managed.loading, managed.error, managed.fund]);
  useEffect(() => { load(); }, [load]);
  const refresh = () => (managed.error ? managed.reload() : load());

  const fund = managed.fund;
  const visible = useMemo(() => periodsFor(filter, state.rows), [filter, state.rows]);
  const counts = useMemo(() => periodCounts(state.rows), [state.rows]);
  const readable = !state.loading && !state.error && !!fund;
  const latest = readable ? state.rows[0] : null;
  // The handler is supplied only for a fund the member operates; without one the
  // action is absent and the archive card says why.
  const newPeriod = useMemo(() => (fund ? () => navigate(newPeriodPath(fund.id)) : null), [fund, navigate]);

  return <ZonePrimaryScope><div className="i6-fund if4-shell"><main className="i6-main if4-main" data-testid="investor-fund-reporting">
    <ZoneHeader family="i6" bucketPath="/funds" activeSlug="reporting" crumb="Reporting" title={<><FileBarChart size={19} /> LP reporting</>} intro="The fund’s reporting periods: open one to edit its draft or read what was issued, or start a new one."
      refresh={<button type="button" className="if4-refresh" onClick={refresh} disabled={state.loading} aria-label="Refresh reporting periods"><RefreshCw size={14} className={state.loading ? 'if4-spin' : ''} /></button>} />
    <FundPicker funds={managed.funds} fund={fund} onSelect={managed.select} />
    <ZoneToolbar
      role="investor"
      className="mb-3"
      filters={investorZoneFilters('funds/reporting', { value: filter, onChange: setFilter, counts: readable ? counts : {} })}
      actions={investorZoneActions('funds/reporting', {
        handlers: { newPeriod },
        view: { scope: fund?.name, header: ['Period', 'State', 'Start', 'End', 'Issued'], rows: readable ? visible : [], cells: (r) => [periodOf(r), statusOf(r), date(r.period_start), date(r.period_end), date(r.issued_at)] },
      })}
    />
    <section className="if4-stats"><Stat label="Periods" value={readable ? counts.all : null} note={readable ? `${counts.issued} issued · ${counts.draft} draft` : 'Not read'} /><Stat label="Latest period" value={latest ? periodOf(latest) : null} note={latest ? titleCase(statusOf(latest)) : readable ? 'No period yet' : 'Not read'} /><Stat label="Delivery" value={null} note="Delivery to each LP is not tracked" /><Stat label="Next audited" value={null} note="Audit schedule not recorded" /></section>
    <ReportingArchive loading={managed.loading || state.loading} error={managed.error || state.error} fund={fund} rows={state.rows} filter={filter} onRetry={refresh} />
    <section className="i6-card if4-boundary"><header><div><h2>Reporting boundary</h2><span>What you can do here</span></div></header><p>Start a period, or open one to edit its draft and issue it. Issuing cannot be undone: a change after that is a separate correcting period, and the original stays issued. An admin saves drafts here and issues from the reporting queue. Issuing records when a period was issued, not which LP received it, so this page makes no per-LP delivery claim.</p></section>
    {/* D840 (#2349): month-end cash from the GP's own Mercury, and its statement attached on Accept. */}
    <FromMercury section="reporting" fundId={managed.fund?.id ?? null} />
    <footer className="i6-footnote">Periods are drafted and issued in their editor; this list reads them.</footer>
  </main><WorkerRail
    workspace="Fund"
    role="investor"
    className="i6-rail"
    stance={"Reporting periods"}
    note={"Draft a period, then issue it from its editor. A draft is never represented as issued or delivered."}
    coverage={['Reporting periods read from the fund record']}
    coverageNote={'Each period opens in its editor, where a draft is saved or issued.'}
    unavailable={[
        ['Per-LP delivery', 'Issuing records when a period was issued, not which LP received it.'],
      ]}
  /></div></ZonePrimaryScope>;
}

function Stat({ label, value, note }) { return <article className="if4-stat"><span>{label}</span><b>{value == null ? 'Unavailable' : value}</b><small>{note}</small></article>; }
