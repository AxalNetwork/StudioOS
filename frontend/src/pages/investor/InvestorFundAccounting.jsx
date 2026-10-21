import { useMemo } from 'react';
import { AlertCircle, Calculator } from 'lucide-react';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { useFundAnalytics, fmtCents, capitalMetric } from '../../lib/fundAnalytics';
import './investorFundLanding.css';
import './investorFundAccounting.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import FundLedgerPanel from './FundLedgerPanel';
import FromMercury from './FromMercury';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';

const amount = (value) => value == null ? null : Number(value);
const money = (value) => value == null || !Number.isFinite(Number(value)) ? 'Not recorded' : fmtCents(value);

// The one ledger view the fund analytics contract can produce, named here so
// the chip in the header row and the table below are one fact rather than two
// strings. A constant and not state because there is nothing to switch to —
// the header row names Journal, Fees and Audit trail and says why. It is the
// same shape `/build/this-week` uses for the single live chip in its row.
const VIEW = 'summary';

/**
 * `const unsupported = filter !== 'summary'` was three dead filters in one line.
 *
 * Journal, Fees and Audit trail were chips you could press, and pressing one
 * replaced the ledger with a panel explaining that the data contract does not
 * return those rows. That is the right sentence in the wrong place: the reader
 * had to spend a click to be told the filter could not run, and the empty table
 * they saw first read as an answer about this fund. The sentence now sits in
 * the header row where the canvas draws the filter, so it is read instead of
 * discovered, and `Summary` — which is real, and is every line below — stops
 * being one of four equals and becomes the only view there is.
 */
export default function InvestorFundAccounting() {
  const { items, loading, error } = useFundAnalytics();
  const fund = items[0] || null;
  const hasSource = Boolean(fund);
  const collected = capitalMetric(fund, 'collected_cents', error);
  const outstanding = capitalMetric(fund, 'outstanding_cents', error);
  const capitalState = error || fund?.capital_state === 'unreadable' ? 'Unreadable' : 'Not recorded';
  const values = useMemo(() => {
    const committed = amount(fund?.committed_cents);
    const called = amount(fund?.called_cents);
    const collected = amount(fund?.collected_cents);
    const deployed = amount(fund?.deployed_cents);
    const distributed = amount(fund?.distributed_cents);
    return { committed, called, deployed, distributed, dryPowder: collected != null && deployed != null ? collected - deployed : null };
  }, [fund]);
  const lines = [
    ['Committed capital', values.committed, hasSource ? 'Fund commitment record' : 'Fund analytics unavailable'],
    ['Capital called', values.called, values.called != null ? 'Sum of recorded capital-call lines' : fund?.capital_reason || 'No capital-call lines are recorded', capitalState],
    ['Capital collected', collected.value, collected.reason || 'Sum of dated capital-call receipts', collected.state],
    ['Capital outstanding', outstanding.value, outstanding.reason || 'Called less recorded receipts', outstanding.state],
    ['Deployed to portfolio', values.deployed, hasSource ? 'Fund deployment rollup' : 'Fund analytics unavailable'],
    ['Dry powder', values.dryPowder, values.dryPowder != null ? 'Recorded receipts less deployed' : fund?.capital_reason || 'Requires collected and deployed records', capitalState],
    ['Distributions to LPs', values.distributed, hasSource ? 'Recorded fund distributions' : 'Fund analytics unavailable'],
  ];
  return <div className="i6-fund if3-shell"><main className="i6-main if3-main" data-testid="investor-fund-accounting"><header className="i6-header"><div><div className="i6-breadcrumb">Fund <span>‹</span> <b>Accounting</b></div><h1><Calculator size={19} /> Fund accounting</h1><p>NAV, fees, expenses, journal and audit trail.</p></div></header>
    <ZoneNav bucket={bucketForPath('investor', '/funds')} role="investor" activeSlug="ledger" className="my-3" />
    <ZoneToolbar role="investor" className="mb-3" filters={investorZoneFilters('funds/ledger', { value: VIEW })} actions={investorZoneActions('funds/ledger')} />
    {error && <div className="i6-load-error if3-unavailable"><AlertCircle size={14} /> <span>Unreadable: capital account data could not be read.</span></div>}
    {!loading && !error && !hasSource && <div className="i6-load-error if3-unavailable" data-testid="status-fund-accounting-unavailable"><AlertCircle size={14} /> <span>Not recorded: no capital account data is available.</span></div>}
    <section className="if3-stats"><Stat label="Collected" value={collected.value} note={collected.reason || "Dated capital-call receipts"} state={collected.state} /><Stat label="Deployed" value={hasSource ? values.deployed : null} note="Fund deployment rollup" /><Stat label="Dry powder" value={values.dryPowder} note={values.dryPowder != null ? "Recorded receipts less deployed" : fund?.capital_reason || "Requires collected and deployed records"} state={capitalState} /></section>
    <FundLedgerPanel />
    <section className="i6-card if3-ledger"><header><div><h2>Capital accounts</h2><span>Every supported capital line derives from fund analytics</span></div><span>Read-only collection</span></header>{loading ? <div className="i6-skeleton" /> : <table><thead><tr><th>Line</th><th>Amount</th><th>State</th><th>Note</th></tr></thead><tbody>{lines.map(([label, value, note, state]) => <tr key={label}><td>{label}</td><td>{value == null ? state || (error ? 'Unreadable' : 'Not recorded') : money(value)}</td><td><span className={value == null ? 'if3-state unavailable' : 'if3-state recorded'}>{value == null ? state || (error ? 'Unreadable' : 'Not recorded') : 'Recorded'}</span></td><td>{note}</td></tr>)}</tbody></table>}<p className="i6-footnote">The operational ledger above reads posted fees and expenses by fund and period. These capital lines retain their separate recorded sources.</p></section>
    {fund?.lp_capital?.length > 0 && <section className="i6-card if3-ledger"><header><div><h2>LP capital</h2><span>Called, collected and outstanding from recorded lines and receipts</span></div></header><table><thead><tr><th>LP</th><th>Called</th><th>Collected</th><th>Outstanding</th><th>Note</th></tr></thead><tbody>{fund.lp_capital.map(lp => <tr key={lp.limited_partner_id}><td>{lp.name || `LP #${lp.limited_partner_id}`}</td>{['called_cents', 'collected_cents', 'outstanding_cents'].map(field => { const metric = capitalMetric(lp, field); return <td key={field}>{metric.value == null ? metric.state : money(metric.value)}</td>; })}<td>{lp.capital_reason || 'Recorded receipts; outstanding is called less those receipts'}</td></tr>)}</tbody></table></section>}
    <section className="i6-card if3-boundary"><header><div><h2>Accounting boundary</h2><span>Source-preserved · no write</span></div></header><p>IF3 does not reconcile, close periods, export a journal, attach a fee note, or change LP capital accounts. Only assigned fund administrators and admins may post to the operational ledger.</p></section>
    {/* D840 (#2349): ledger entries proposed from the administrator's own Mercury; posted only on Accept. */}
    <FromMercury section="ledger" fundId={fund?.id ?? null} />
    <footer className="i6-footnote">Fund source-preserved · no journal export, reconcile, close, or AI write action from this page.</footer>
  </main><WorkerRail
    workspace="Fund"
    role="investor"
    className="i6-rail"
    stance={"Read-only ledger view"}
    note={"Capital lines trace to the register or positions book; ledger lines trace to posted entries. A failed read is never treated as zero."}
    coverage={['Capital accounts read from the fund record']}
    coverageNote={'The operational ledger reads posted entries and their reconciliation marks; this page is read-only.'}
    unavailable={[
        ['Reconciliation and close', 'This page records; it does not post, close or export.'],
      ]}
  /></div>;
}

function Stat({ label, value, note, state = 'Not recorded' }) { return <article className="if3-stat"><span>{label}</span><b>{value == null ? state : money(value)}</b><small>{note}</small></article>; }