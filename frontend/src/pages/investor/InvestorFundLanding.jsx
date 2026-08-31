import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CircleAlert, FileText, LockKeyhole, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtCents, fmtMultiple, fmtRate, useFundAnalytics } from '../../lib/fundAnalytics';
import './investorFundLanding.css';

const titleCase = (value) => String(value || 'unrecorded').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const dollarsToCents = (value) => Math.round((Number(value) || 0) * 100);
const callDollars = (call) => call?.amount_cents != null ? Number(call.amount_cents) / 100 : Number(call?.amount);
const date = (value) => value ? String(value).slice(0, 10) : 'Unrecorded';

function Unrecorded({ children = 'Unrecorded' }) {
  return <span className="i6-unrecorded">{children}</span>;
}

function LockedFund() {
  return (
    <main className="i6-locked" data-testid="investor-fund-locked">
      <section className="i6-locked-preview" aria-hidden="true">
        <div className="i6-locked-lines"><i /><i /><i /><i /></div>
        <div className="i6-locked-grid"><i /><i /><i /></div>
        <div className="i6-locked-block"><i /><i /><i /></div>
      </section>
      <section className="i6-locked-copy">
        <span className="i6-kicker"><LockKeyhole size={12} /> Institutional add-on</span>
        <h1>Run your own fund</h1>
        <p>Fund administration is a separate Institutional workspace: LP registry, capital movements, accounting records, and issued LP packs remain connected to their originating schedule.</p>
        <p className="i6-muted">Access is provisioned by Axal. Your existing investor and LP tools are unchanged.</p>
      </section>
    </main>
  );
}

function FundDetail({ fund }) {
  const [detail, setDetail] = useState({ lps: null, calls: null, periods: null, error: null });
  const load = useCallback(() => {
    if (!fund?.id) return;
    setDetail({ lps: null, calls: null, periods: null, error: null });
    Promise.all([
      api.fundsLpsList(fund.id).then((r) => r?.items || []).catch(() => api.fundsLpPortal().then((r) => (r?.lps || r?.items || []).filter((lp) => String(lp.fund_id) === String(fund.id)))),
      api.capitalCalls().then((r) => (Array.isArray(r) ? r : r?.items || []).filter((call) => String(call.fund_id) === String(fund.id))).catch(() => []),
      api.fundsReportPeriods(fund.id).then((r) => r?.items || r?.periods || []).catch(() => []),
    ]).then(([lps, calls, periods]) => setDetail({ lps, calls, periods, error: null }))
      .catch(() => setDetail({ lps: [], calls: [], periods: [], error: 'Some detail records are unavailable.' }));
  }, [fund?.id]);
  useEffect(() => { load(); }, [load]);

  const unfunded = Math.max(0, Number(fund.committed_cents || 0) - Number(fund.called_cents || 0));
  const lpRows = detail.lps || [];
  return (
    <>
      <section className="i6-summary" id="summary">
        <div>
          <div className="i6-kicker">{fund.name} {fund.vintage_year ? `· ${fund.vintage_year} vintage` : ''}</div>
          <strong className="i6-money" data-testid="text-fund-committed">{fmtCents(fund.committed_cents)}</strong>
          <span className="i6-caption">committed</span>
        </div>
        <dl className="i6-summary-stats">
          <div><dt>Called</dt><dd>{fmtCents(fund.called_cents)}</dd></div>
          <div><dt>Deployed</dt><dd>{fmtCents(fund.deployed_cents)}</dd></div>
          <div><dt>DPI</dt><dd>{fmtMultiple(fund.dpi) || <Unrecorded />}</dd></div>
          <div><dt>RVPI · on NAV</dt><dd><Unrecorded>Unavailable</Unrecorded></dd></div>
        </dl>
        <p>Every recorded amount originates in this fund’s operating record. NAV, RVPI, TVPI, IRR, and expense accruals are unavailable until the underlying records exist.</p>
      </section>

      <div className="i6-grid">
        <section className="i6-card i6-registry" id="lps">
          <header><div><h2>LP registry</h2><span>{fund.lp_count || 0} LPs · record status below</span></div><Link to="/funds/accounting" data-testid="link-fund-accounting"><ArrowUpRight size={15} /></Link></header>
          {detail.lps === null ? <div className="i6-skeleton" /> : lpRows.length === 0 ? <p className="i6-empty">No LP records are available for this fund.</p> : (
            <table><thead><tr><th>LP</th><th className="right">Committed</th><th>KYC / LPA</th></tr></thead><tbody>
              {lpRows.slice(0, 8).map((lp) => <tr key={lp.id}><td>{lp.name || lp.email || `LP #${lp.id}`}</td><td className="right">{fmtCents(dollarsToCents(lp.commitment_amount))}</td><td><span className={lp.lpa_signed ? 'i6-ok' : 'i6-alert'}>{lp.lpa_signed ? 'LPA signed' : 'LPA unsigned'}</span></td></tr>)}
            </tbody></table>
          )}
          <p className="i6-footnote">Each LP record is the source for its commitment and capital-account movements.</p>
        </section>

        <section className="i6-card i6-movements" id="movements">
          <header><div><h2>Capital calls &amp; distributions</h2><span>Recorded notices and payment status</span></div><Link to="/funds/capital-calls" data-testid="link-capital-calls"><ArrowUpRight size={15} /></Link></header>
          <div className="i6-manual"><span>Schedule basis</span><p>Calls can be reviewed in the capital-call ledger. This overview does not draft or send notices.</p><Link to="/funds/capital-calls" data-testid="link-review-call-ledger">Open capital-call ledger</Link></div>
          {detail.calls === null ? <div className="i6-skeleton" /> : detail.calls.length === 0 ? <p className="i6-empty">No capital call notices on record for this fund.</p> : <ul className="i6-call-list">
            {detail.calls.slice(0, 5).map((call) => <li key={call.id}><strong>{fmtCents(Math.round(callDollars(call) * 100))}</strong><span>{date(call.due_date || call.created_at)}</span><em className={`i6-${call.status === 'paid' ? 'ok' : 'alert'}`}>{titleCase(call.status || 'pending')}</em></li>)}
          </ul>}
          <p className="i6-footnote">Distribution execution remains in the detailed fund-administration tool.</p>
        </section>

        <section className="i6-card i6-accounting" id="accounting">
          <header><div><h2>Fund accounting</h2><span>Contracted terms and capital accounts</span></div><Link to="/funds/accounting" data-testid="link-accounting-detail"><ArrowUpRight size={15} /></Link></header>
          <dl className="i6-ledger">
            <div><dt>Commitments</dt><dd>{fmtCents(fund.committed_cents)}</dd></div><div><dt>Contributed</dt><dd>{fmtCents(fund.called_cents)}</dd></div><div><dt>Unfunded</dt><dd>{fmtCents(unfunded)}</dd></div><div><dt>Distributed</dt><dd>{fmtCents(fund.distributed_cents)}</dd></div><div><dt>Management fee</dt><dd>{fmtRate(fund.management_fee) || <Unrecorded />}</dd></div><div><dt>Accrued expenses</dt><dd><Unrecorded>Unavailable</Unrecorded></dd></div>
          </dl>
        </section>

        <section className="i6-card i6-reporting" id="reporting">
          <header><div><h2>LP reporting</h2><span>{detail.periods === null ? 'Checking issued periods' : `${detail.periods.length} period${detail.periods.length === 1 ? '' : 's'} on record`}</span></div><Link to="/lp-reports" data-testid="link-lp-reports"><ArrowUpRight size={15} /></Link></header>
          <div className="i6-manual"><span>Report control</span><p>LP pack authoring and publishing live in the reporting workspace. This landing page never represents a draft as delivered.</p><Link to="/lp-reports" data-testid="link-open-lp-reporting">Open LP reporting</Link></div>
          {detail.periods?.length > 0 && <ul className="i6-periods">{detail.periods.slice(0, 3).map((period) => <li key={period.id || period.period}><FileText size={13} />{period.period || period.label || `Period ${period.id}`}<span>{period.issued_at ? `Issued ${date(period.issued_at)}` : 'Draft'}</span></li>)}</ul>}
        </section>
      </div>
      {detail.error && <p className="i6-load-error"><CircleAlert size={13} />{detail.error}</p>}
    </>
  );
}

function FundRail({ onRefresh, busy }) {
  return <aside className="i6-rail"><div className="i6-rail-title">Worker AI · Fund</div><section><strong>Manual</strong><p>Tables, schedules, and source records work without AI assistance.</p></section><section className="i6-rail-note"><strong>Advisor fills the blanks</strong><p>Unavailable values remain unavailable. No proposed letters, packs, or models are created here.</p></section><section><strong>Traceability rule</strong><p>Open a detailed workspace to review the underlying LP record, notice, or issued period.</p></section><button type="button" onClick={onRefresh} disabled={busy} data-testid="button-refresh-fund-landing"><RefreshCw size={13} className={busy ? 'i6-spin' : ''} /> Refresh records</button></aside>;
}

function EmptyFundDetail() {
  return (
    <>
      <section className="i6-summary i6-summary-empty">
        <div>
          <div className="i6-kicker">No fund record selected</div>
          <strong className="i6-money">Not recorded</strong>
          <span className="i6-caption">committed</span>
        </div>
        <dl className="i6-summary-stats">
          {['Called', 'Deployed', 'DPI', 'RVPI · on NAV'].map((label) => (
            <div key={label}><dt>{label}</dt><dd><Unrecorded /></dd></div>
          ))}
        </dl>
        <p>Create a fund record in fund administration to connect commitments, LP records, capital movements, and reporting periods.</p>
      </section>
      <div className="i6-grid">
        {[
          ['lps', 'LP registry', 'No LP records are available until a fund is recorded.', '/funds/accounting'],
          ['movements', 'Capital calls & distributions', 'No capital movements are available until a fund is recorded.', '/funds/capital-calls'],
          ['accounting', 'Fund accounting', 'No capital accounts or contracted terms are available.', '/funds/accounting'],
          ['reporting', 'LP reporting', 'No issued reporting periods are available.', '/lp-reports'],
        ].map(([id, title, copy, to]) => (
          <section className="i6-card" id={id} key={id}>
            <header>
              <div><h2>{title}</h2><span>Awaiting a fund record</span></div>
              <Link to={to} aria-label={`Open ${title}`}><ArrowUpRight size={15} /></Link>
            </header>
            <p className="i6-empty">{copy}</p>
          </section>
        ))}
      </div>
    </>
  );
}

export default function InvestorFundLanding({ fundUnlocked }) {
  const { items, loading, error, reload } = useFundAnalytics();
  const [fundId, setFundId] = useState('');
  const [detailKey, setDetailKey] = useState(0);
  const active = useMemo(() => items.find((fund) => String(fund.id) === String(fundId)) || items[0], [fundId, items]);
  const refresh = () => {
    reload();
    setDetailKey((value) => value + 1);
  };
  if (!fundUnlocked) return <LockedFund />;
  return <main className="i6-fund" data-testid="investor-fund-landing"><div className="i6-main"><header className="i6-header"><div><h1>Run my fund</h1><p>The GP back office. Every movement is traceable to the fund schedule and LP record that produced it.</p></div><nav aria-label="Fund sections"><a href="#lps">LPs</a><a href="#movements">Calls</a><a href="#accounting">Accounting</a><a href="#reporting">Reporting</a></nav></header>{loading ? <div className="i6-loading"><i /><i /><i /></div> : error ? <div className="i6-error"><CircleAlert size={16} />{error}<button onClick={refresh} type="button">Retry</button></div> : items.length === 0 ? <EmptyFundDetail /> : <><div className="i6-fund-switcher"><label htmlFor="fund-select">Fund record</label><select id="fund-select" value={active?.id || ''} onChange={(event) => setFundId(event.target.value)} data-testid="select-active-fund">{items.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select><span>{titleCase(active.status)}</span></div><FundDetail key={`${active.id}-${detailKey}`} fund={active} /></>}</div><FundRail onRefresh={refresh} busy={loading} /></main>;
}