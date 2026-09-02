import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileBarChart, RefreshCw } from 'lucide-react';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { api } from '../../lib/api';
import './investorFundLanding.css';
import './investorFundReporting.css';

const FILTERS = [['all', 'All periods'], ['published', 'Published'], ['drafted', 'Drafted'], ['delivery', 'Delivery']];
const titleCase = (value) => String(value || 'Unrecorded').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const periodOf = (row) => row.period || row.label || row.reporting_period || `Period ${row.id || 'unrecorded'}`;
const statusOf = (row) => String(row.status || (row.issued_at ? 'published' : 'drafted')).toLowerCase();
const date = (value) => value ? String(value).slice(0, 10) : 'Unrecorded';

export default function InvestorFundReporting() {
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setState({ loading: true, rows: [], error: null });
    try {
      const [reports, funds] = await Promise.all([api.lpReportsList(), api.fundsList()]);
      const reportRows = Array.isArray(reports?.items) ? reports.items : [];
      const fundsRows = Array.isArray(funds) ? funds : funds?.items || [];
      let periodRows = [];
      if (fundsRows[0]?.id) {
        const periods = await api.fundsReportPeriods(fundsRows[0].id);
        periodRows = periods?.items || periods?.periods || [];
      }
      const rows = reportRows.length ? reportRows : periodRows;
      setState({ loading: false, rows, error: null });
    } catch (error) {
      setState({ loading: false, rows: [], error: error?.message || 'The reporting archive is unavailable.' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (filter === 'all') return state.rows;
    if (filter === 'delivery') return state.rows.filter((row) => row.delivery_count != null || row.delivered_count != null || row.delivery_status);
    return state.rows.filter((row) => statusOf(row) === filter);
  }, [filter, state.rows]);
  const published = state.rows.filter((row) => statusOf(row) === 'published' || statusOf(row) === 'issued').length;
  const latest = state.rows[0];
  const deliveryKnown = state.rows.some((row) => row.delivery_count != null || row.delivered_count != null || row.delivery_status);

  return <div className="i6-fund if4-shell"><main className="i6-main if4-main" data-testid="investor-fund-reporting"><header className="i6-header"><div><div className="i6-breadcrumb">Fund <span>‹</span> <b>Reporting</b></div><h1><FileBarChart size={19} /> LP reporting</h1><p>Pack builder, archive and per-LP delivery status.</p></div><button type="button" className="if4-refresh" onClick={load} disabled={state.loading} aria-label="Refresh reporting archive"><RefreshCw size={14} className={state.loading ? 'if4-spin' : ''} /></button></header>
    <ZoneNav bucket={bucketForPath('investor', '/funds')} role="investor" activeSlug="reporting" className="my-3" />
    <div className="if4-filters">{FILTERS.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {state.error && <div className="i6-load-error if4-unavailable"><AlertCircle size={14} /> <span>Reporting archive unavailable. No period count, publication state, or delivery claim is being made.</span></div>}
    {!state.loading && !state.error && !state.rows.length && <div className="i6-load-error if4-unavailable" data-testid="status-fund-reporting-unavailable"><AlertCircle size={14} /> <span>No reporting archive is available in this environment. Current pack, period, and per-LP delivery values remain unavailable.</span></div>}
    <section className="if4-stats"><Stat label="Periods" value={state.error || !state.rows.length ? null : state.rows.length} note={state.rows.length ? `${published} published` : 'Archive source unavailable'} /><Stat label="Current pack" value={latest ? periodOf(latest) : null} note={latest ? titleCase(statusOf(latest)) : 'No current pack recorded'} /><Stat label="Delivery" value={deliveryKnown ? 'Recorded' : null} note={deliveryKnown ? 'Per-LP delivery source' : 'Per-LP delivery unavailable'} /><Stat label="Next audited" value={null} note="Audit schedule not recorded" /></section>
    <section className="i6-card if4-archive"><header><div><h2>Report archive</h2><span>{state.loading ? 'Loading source records' : `${visible.length} of ${state.rows.length} records`}</span></div><span>Read-only collection</span></header>{state.loading ? <div className="i6-skeleton" /> : state.error || !state.rows.length ? <div className="i6-empty if4-empty"><AlertCircle size={17} /><div><strong>Report archive is unavailable.</strong><p>Pack contents, publication state, and per-LP delivery cannot be displayed without stored reporting records.</p></div></div> : !visible.length ? <div className="i6-empty">No reporting records match this filter.</div> : <div className="if4-table-wrap"><table><thead><tr><th>Period</th><th>State</th><th>Delivered</th><th>Contents</th></tr></thead><tbody>{visible.map((row) => <tr key={row.uid || row.id || periodOf(row)}><td><strong>{periodOf(row)}</strong><small>{row.issued_at ? `Issued ${date(row.issued_at)}` : 'Source period'}</small></td><td><span className={`if4-pill ${statusOf(row)}`}>{titleCase(statusOf(row))}</span></td><td>{row.delivery_count ?? row.delivered_count ?? row.delivery_status ?? 'Unavailable'}</td><td>{row.narrative || row.contents || row.note || 'Source contents not recorded'}</td></tr>)}</tbody></table></div>}<p className="i6-footnote">A draft is not represented as delivered. This page never builds, publishes, exports, or changes an LP pack.</p></section>
    <section className="i6-card if4-boundary"><header><div><h2>Reporting boundary</h2><span>Source-preserved · no write</span></div></header><p>Pack authoring, publishing, archive export, and delivery logs remain in the existing reporting workspace. Missing per-LP delivery data is not treated as delivery to all LPs.</p></section>
    <footer className="i6-footnote">Fund source-preserved · no pack builder, publish, export, or AI write action from this page.</footer>
  </main><WorkerRail
    workspace="Fund"
    role="investor"
    className="i6-rail"
    stance={"Read-only reporting archive"}
    note={"Issued periods and their delivery state, as recorded. A draft is never represented as delivered."}
    coverage={['Issued periods read from the fund record']}
    coverageNote={'LP pack authoring and publishing live in the reporting workspace.'}
    unavailable={[
        ['Pack authoring', 'Nothing is drafted, published or delivered from this page.'],
      ]}
  /></div>;
}

function Stat({ label, value, note }) { return <article className="if4-stat"><span>{label}</span><b>{value == null ? 'Unavailable' : value}</b><small>{note}</small></article>; }