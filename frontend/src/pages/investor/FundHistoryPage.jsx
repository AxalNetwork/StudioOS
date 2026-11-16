/**
 * #6234 (D6234) — IF5, a fund's quarterly history at `/funds/history?fund=<id>`:
 * the chart behind the overview at full width (issued periods only), every
 * period as a row INCLUDING drafts with its snapshot figures, the gap list,
 * and Export series (CSV). A child of Overview, not a fifth zone. The route
 * is registered in `frontend/src/routes/fundHistory.jsx`.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Download, RefreshCw } from 'lucide-react';
import { Unreadable } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { downloadCsv, stamp } from '../../lib/csvExport';
import { FundPicker, useManagedFund } from './managedFund';
import { fundZoneHref } from './investorFundLandingModel';
import FundQuarterChart from './FundQuarterChart';
import { GapList, NotRecorded, Tiles, useReportPeriods } from './FundOverviewParts';
import { CSV_HEADER, NOT_RECORDED, chartGroups, historyCsvRows, historyRows, money, packGaps, zoneHref } from './fundOverviewModel';
import './investorFundLanding.css';
import './fundOverview.css';

function Cell({ fig, testid }) {
  return fig.cents == null
    ? <span className="fo-nr" title={fig.reason || undefined} data-testid={testid}>{NOT_RECORDED}<span className="sr-only">: {fig.reason}</span></span>
    : <span data-testid={testid}>{money(fig.cents)}</span>;
}

/** The history tiles (IF5): issued count, latest issued period, dry powder at it, and sectors (no snapshot carries them). */
export function historyTiles(rows) {
  const issued = rows.filter((r) => r.status === 'issued');
  const latest = issued[0] || null;
  return [
    { key: 'issued', label: 'Issued periods', value: String(issued.length), basis: 'a count, not a gap' },
    latest
      ? { key: 'latest', label: 'Latest period', value: latest.label, basis: latest.issuedOn ? `issued ${latest.issuedOn}` : 'issued' }
      : { key: 'latest', label: 'Latest period', cents: null, reason: 'Nothing is issued yet.', basis: 'latest issued period' },
    { key: 'dry', label: 'Dry powder at latest', cents: latest ? latest.dry.cents : null, reason: latest ? latest.dry.reason : 'Needs an issued snapshot.', basis: 'collected less deployed' },
    { key: 'sectors', label: 'Sectors in latest', cents: null, reason: 'No snapshot carries a sector breakdown.', basis: 'sector mix' },
  ];
}

export function HistoryBody({ fund, periods, onRetry, today }) {
  const now = useMemo(() => today || new Date(), [today]);
  const list = Array.isArray(periods) ? periods : null;
  const rows = useMemo(() => (list ? historyRows(list) : []), [list]);
  const groups = useMemo(() => (list ? chartGroups(list) : []), [list]);
  const gaps = useMemo(() => packGaps({ fundId: fund?.id, periods: list, today: now }), [fund?.id, list, now]);
  const exportSeries = () => downloadCsv(`fund-${fund?.id}-quarterly-history-${rows.length}-periods-${stamp(now)}.csv`, CSV_HEADER, historyCsvRows(rows));

  if (periods === 'unreadable') {
    return (
      <section className="fo-card" data-testid="history-unreadable">
        <Unreadable what="The reporting archive" claim="This is not a claim that no period exists." onRetry={onRetry} />
      </section>
    );
  }
  if (periods === null) return <div className="fo-loading" data-testid="history-loading"><i /><i /><i /></div>;
  return (
    <>
      <Tiles tiles={historyTiles(rows)} testPrefix="history-tile" />
      <section className="fo-card" data-testid="history-chart">
        <header>
          <h2>Fund size by issued quarter · full series</h2>
          <span>Only issued snapshots plot. A draft is in the table below and never on the chart.</span>
        </header>
        {groups.length
          ? <FundQuarterChart groups={groups} height={240} />
          : <p className="fo-empty" data-testid="text-history-chart-empty">No issued quarterly snapshot. Not recorded is not $0 committed and not $0 deployed.</p>}
      </section>
      <section className="fo-card" data-testid="history-table">
        <header>
          <h2>Snapshots</h2>
          <span>{rows.length} period{rows.length === 1 ? '' : 's'} · drafts appear here and nowhere on the chart</span>
          <button type="button" className="fo-btn" onClick={exportSeries} disabled={!rows.length} data-testid="button-export-series"><Download size={13} /> Export series (CSV)</button>
        </header>
        {rows.length === 0
          ? <p className="fo-empty" data-testid="text-history-empty">No reporting period is recorded for this fund. <Link to={zoneHref('reporting', fund?.id)}>Open Reporting</Link></p>
          : (
            <>
              <div className="fo-table-wrap fo-desktop">
                <table className="fo-table">
                  <thead>
                    <tr>{['Period', 'State', 'Committed', 'Called', 'Collected', 'Deployed', 'Dry powder', 'NAV'].map((h, i) => <th key={h} scope="col" className={i > 1 ? 'fo-num' : ''}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id ?? r.label} className={r.status === 'draft' ? 'fo-draft' : ''} data-testid={`history-row-${r.id}`} data-status={r.status}>
                        <td><Link to={`/funds/${encodeURIComponent(String(fund?.id))}/reporting/${encodeURIComponent(String(r.id))}`}><b>{r.label}</b></Link><small>{r.periodStart && r.periodEnd ? `${r.periodStart} to ${r.periodEnd}` : ''}</small></td>
                        <td><span className={`fo-pill ${r.status}`}>{r.status === 'issued' ? 'Issued' : 'Draft'}</span><small>{r.issuedOn ? `on ${r.issuedOn}` : 'not issued'}</small></td>
                        {['committed', 'called', 'collected', 'deployed'].map((k) => <td key={k} className="fo-num"><Cell fig={r.figures[k]} testid={`history-${r.id}-${k}`} /></td>)}
                        <td className="fo-num"><Cell fig={r.dry} testid={`history-${r.id}-dry`} /></td>
                        <td className="fo-num"><Cell fig={r.figures.nav} testid={`history-${r.id}-nav`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="fo-cards fo-phone" aria-label="Snapshots">
                {rows.map((r) => (
                  <li key={r.id ?? r.label} className={r.status === 'draft' ? 'fo-draft' : ''}>
                    <div className="fo-card-head"><b>{r.label}</b><span className={`fo-pill ${r.status}`}>{r.status === 'issued' ? `Issued ${r.issuedOn || ''}`.trim() : 'Draft'}</span></div>
                    <dl>
                      {[['Committed', r.figures.committed], ['Called', r.figures.called], ['Collected', r.figures.collected], ['Deployed', r.figures.deployed], ['Dry powder', r.dry], ['NAV', r.figures.nav]].map(([k, f]) => (
                        <div key={k}><dt>{k}</dt><dd>{f.cents == null ? <NotRecorded reason={f.reason} /> : money(f.cents)}</dd></div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
      </section>
      <GapList gaps={gaps} onRetry={onRetry} />
    </>
  );
}

export default function FundHistoryPage({ today }) {
  const managed = useManagedFund();
  const { periods, reload } = useReportPeriods(managed.fund?.id);
  const bucket = bucketForPath('investor', '/funds');
  const fundId = managed.fund?.id;
  return (
    <main className="fo-page" data-testid="fund-history-page">
      <header className="fo-page-head">
        <div className="fo-crumb"><Link to={fundZoneHref('/funds', fundId)} data-testid="link-history-overview">Fund ‹ Overview</Link> ‹ <b>Quarterly history</b></div>
        <div className="fo-head-row">
          <div>
            <h1>Quarterly history</h1>
            <p>Every issued snapshot, the drafts that are not on the chart, and what is still absent.</p>
          </div>
          <button type="button" className="fo-btn" onClick={() => (managed.error ? managed.reload() : reload())} aria-label="Refresh quarterly history" data-testid="button-refresh-history"><RefreshCw size={13} /></button>
        </div>
        {bucket ? <ZoneNav bucket={bucket} role="investor" activeSlug={null} className="mt-3" carry={fundId != null ? { fund: fundId } : null} /> : null}
      </header>
      <FundPicker funds={managed.funds} fund={managed.fund} onSelect={managed.select} />
      {managed.loading
        ? <div className="fo-loading" data-testid="history-loading"><i /><i /><i /></div>
        : managed.error
          ? <div className="fo-card" role="alert"><p className="fo-error"><CircleAlert size={14} /> The fund list could not be read. This is not a claim that you run no fund. <button type="button" className="fo-link-btn" onClick={managed.reload}>Try again</button></p></div>
          : !managed.fund
            ? <section className="fo-card" data-testid="history-no-fund"><p className="fo-empty">No fund names you as its general partner, so there is no history to show. <Link to="/funds">Back to Fund overview</Link></p></section>
            : <HistoryBody fund={managed.fund} periods={periods} onRetry={reload} today={today} />}
    </main>
  );
}
