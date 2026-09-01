import { useMemo, useState } from 'react';
import { AlertCircle, Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFundAnalytics, fmtCents, fmtRate } from '../../lib/fundAnalytics';
import './investorFundLanding.css';
import './investorFundAccounting.css';

const FILTERS = [['summary', 'Summary'], ['journal', 'Journal'], ['fees', 'Fees'], ['audit', 'Audit trail']];
const amount = (value) => value == null ? null : Number(value);
const money = (value) => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : fmtCents(value);

export default function InvestorFundAccounting() {
  const { items, loading, error, unavailable } = useFundAnalytics();
  const [filter, setFilter] = useState('summary');
  const fund = items[0] || null;
  const hasSource = Boolean(fund);
  const values = useMemo(() => {
    const committed = amount(fund?.committed_cents);
    const called = amount(fund?.called_cents);
    const deployed = amount(fund?.deployed_cents);
    const distributed = amount(fund?.distributed_cents);
    return { committed, called, deployed, distributed, dryPowder: called != null && deployed != null ? called - deployed : null };
  }, [fund]);
  const lines = [
    ['Committed capital', values.committed, hasSource ? 'Fund commitment record' : 'Fund analytics unavailable'],
    ['Capital called', values.called, hasSource ? 'Recorded capital account' : 'Fund analytics unavailable'],
    ['Capital collected', values.called, hasSource ? 'Collected amount is not separately recorded' : 'Fund analytics unavailable'],
    ['Deployed to portfolio', values.deployed, hasSource ? 'Fund deployment rollup' : 'Fund analytics unavailable'],
    ['Dry powder', values.dryPowder, values.dryPowder != null ? 'Called less deployed' : 'Requires called and deployed records'],
    ['Management fee accrued', null, unavailable.fee_accrual || 'Fee accruals by period are not recorded'],
    ['Fee drawn to date', null, 'Fee draw ledger is not recorded'],
    ['Distributions to LPs', values.distributed, hasSource ? 'Recorded fund distributions' : 'Fund analytics unavailable'],
  ];
  const unsupported = filter !== 'summary';

  return <div className="i6-fund if3-shell"><main className="i6-main if3-main" data-testid="investor-fund-accounting"><header className="i6-header"><div><div className="i6-breadcrumb">Fund <span>‹</span> <b>Accounting</b></div><h1><Calculator size={19} /> Fund accounting</h1><p>NAV, fees, expenses, journal and audit trail.</p></div></header>
    <nav className="if3-zones" aria-label="Fund sections"><Link to="/fund/lps">LPs</Link><Link to="/fund/calls">Calls</Link><Link className="is-active" to="/fund/accounting">Accounting</Link><Link to="/fund/reporting">Reporting</Link></nav>
    <div className="if3-filters">{FILTERS.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {error && <div className="i6-load-error if3-unavailable"><AlertCircle size={14} /> <span>Fund accounting source unavailable. No accounting totals are being treated as zero.</span></div>}
    {!loading && !error && !hasSource && <div className="i6-load-error if3-unavailable" data-testid="status-fund-accounting-unavailable"><AlertCircle size={14} /> <span>No fund accounting record is available in this environment. Committed, called, deployed, distributed, NAV, and fee values remain unavailable.</span></div>}
    <section className="if3-stats"><Stat label="Collected" value={hasSource ? values.called : null} note="Not the same as called when a separate receipt ledger exists" /><Stat label="Deployed" value={hasSource ? values.deployed : null} note="Fund deployment rollup" /><Stat label="Dry powder" value={values.dryPowder} note="Collected less deployed when both records exist" /><Stat label="Fee accrued" value={null} note={unavailable.fee_accrual || 'Accrual ledger unavailable'} /></section>
    <section className="i6-card if3-ledger"><header><div><h2>Ledger</h2><span>{unsupported ? `${FILTERS.find(([id]) => id === filter)?.[1]} source unavailable` : 'Every supported line derives from fund analytics'}</span></div><span>Read-only collection</span></header>{loading ? <div className="i6-skeleton" /> : unsupported ? <div className="i6-empty if3-empty"><AlertCircle size={17} /><div><strong>{FILTERS.find(([id]) => id === filter)?.[1]} is unavailable.</strong><p>The current data contract does not return journal entries, fee movements, or audit-trail rows for this fund.</p></div></div> : <table><thead><tr><th>Line</th><th>Amount</th><th>State</th><th>Note</th></tr></thead><tbody>{lines.map(([label, value, note]) => <tr key={label}><td>{label}</td><td>{money(value)}</td><td><span className={value == null ? 'if3-state unavailable' : 'if3-state recorded'}>{value == null ? 'Unavailable' : 'Recorded'}</span></td><td>{note}</td></tr>)}</tbody></table>}<p className="i6-footnote">No expense section is shown: an absent expense ledger does not mean expenses were zero. NAV, RVPI, TVPI, IRR, and period accruals remain unavailable until their underlying records exist.</p></section>
    <section className="i6-card if3-boundary"><header><div><h2>Accounting boundary</h2><span>Source-preserved · no write</span></div></header><p>IF3 does not reconcile, close periods, export a journal, attach a fee note, or change LP capital accounts. Open the existing Fund Ops accounting workspace for authorized operations.</p></section>
    <footer className="i6-footnote">Fund source-preserved · no journal export, reconcile, close, or AI write action from this page.</footer>
  </main><aside className="i6-rail"><div className="i6-rail-title">Worker AI · Fund</div><section><strong>Inherited from Fund</strong><p>Mode and model are set on the workspace. The accounting source remains the authority.</p></section><section className="i6-rail-note"><strong>Advisor fills the blanks</strong><p>Missing ledger lines stay unavailable. No fee note or journal is generated.</p></section><section><strong>Traceability rule</strong><p>Every supported amount links back to fund analytics or an explicit distribution record.</p></section><div className="i6-rail-trust"><span>Screened</span> Read-only collection · no export or reconcile action.</div></aside></div>;
}

function Stat({ label, value, note }) { return <article className="if3-stat"><span>{label}</span><b>{money(value)}</b><small>{note}</small></article>; }