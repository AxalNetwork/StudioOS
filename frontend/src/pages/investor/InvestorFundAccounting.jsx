import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, RefreshCw } from 'lucide-react';
import { WorkerRail } from '../../ui';
import ZoneHeader from '../../workspaces/ZoneHeader';
import { ZonePrimaryScope } from '../../workspaces/ZoneActions';
import { useFundAnalytics, fmtCents, capitalMetric } from '../../lib/fundAnalytics';
import './investorFundLanding.css';
import './investorFundAccounting.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import FundLedgerPanel from './FundLedgerPanel';
import FromMercury from './FromMercury';
import { FundPicker, useManagedFund } from './managedFund';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { LEDGER_LINES_LOCKED, investorZoneFilters } from '../../workspaces/investorZoneFilters';

const amount = (value) => value == null ? null : Number(value);
const money = (value) => value == null || !Number.isFinite(Number(value)) ? 'Not recorded' : fmtCents(value);

/** The sentence a locked view carries, once under the row (the chips carry it as their title). */
export const LOCKED_LINE = `Journal and Fees: ${LEDGER_LINES_LOCKED}.`;
/** The one write on this page, said where the page says what it does. */
export const WRITE_LINE = 'This page writes one thing: accepting a Mercury proposal below posts that entry to this fund’s operational ledger. Everything else here is read.';

/**
 * D6231 (#6231): which views the header row offers for the chosen fund, from
 * the ledger's own access answer. Journal and Fees lock, with their reason,
 * unless the reader is the fund's administrator (or an admin); while the
 * access is unknown or the fund has no readable ledger, they lock too.
 */
export function ledgerLocks(access) {
  return access?.status === 'ready' && access.present && access.canManage ? {} : { journal: LEDGER_LINES_LOCKED, fees: LEDGER_LINES_LOCKED };
}

/**
 * `/funds/ledger`: one fund, chosen as the other Fund zones choose it
 * (D371's `useManagedFund`, `?fund=`), and every block on the page follows it:
 * the capital lines and per-LP capital (the analytics row with that fund's
 * id, never `items[0]`), the operational ledger panel, and Mercury.
 *
 * The header row is the panel's one view control (Summary · Journal · Fees);
 * Audit trail has no read and says so. The page writes one thing, a Mercury
 * proposal's Accept, and its copy says that rather than "no write".
 */
export default function InvestorFundAccounting() {
  const managed = useManagedFund();
  const analytics = useFundAnalytics();
  const fund = managed.fund;
  const [view, setView] = useState('summary');
  const [access, setAccess] = useState({ status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const locks = useMemo(() => ledgerLocks(access), [access]);
  // A new fund starts on its summary, and a view this reader may not open never stays selected.
  useEffect(() => { setView('summary'); setAccess({ status: 'loading' }); }, [fund?.id]);
  useEffect(() => { if (locks[view]) setView('summary'); }, [locks, view]);
  const onAccess = useCallback((next) => setAccess(next), []);
  const refresh = () => { managed.reload(); analytics.reload(); setRefreshKey((n) => n + 1); };

  const row = fund ? analytics.items.find((item) => String(item.id) === String(fund.id)) || null : null;
  const error = analytics.error;
  const loading = managed.loading || analytics.loading;
  const hasSource = Boolean(row);
  const collected = capitalMetric(row, 'collected_cents', error);
  const outstanding = capitalMetric(row, 'outstanding_cents', error);
  const capitalState = error || row?.capital_state === 'unreadable' ? 'Unreadable' : 'Not recorded';
  const values = useMemo(() => {
    const committed = amount(row?.committed_cents);
    const called = amount(row?.called_cents);
    const got = amount(row?.collected_cents);
    const deployed = amount(row?.deployed_cents);
    const distributed = amount(row?.distributed_cents);
    return { committed, called, deployed, distributed, dryPowder: got != null && deployed != null ? got - deployed : null };
  }, [row]);
  const lines = [
    ['Committed capital', values.committed, hasSource ? 'Fund commitment record' : 'Fund analytics unavailable'],
    ['Capital called', values.called, values.called != null ? 'Sum of recorded capital-call lines' : row?.capital_reason || 'No capital-call lines are recorded', capitalState],
    ['Capital collected', collected.value, collected.reason || 'Sum of dated capital-call receipts', collected.state],
    ['Capital outstanding', outstanding.value, outstanding.reason || 'Called less recorded receipts', outstanding.state],
    ['Deployed to portfolio', values.deployed, hasSource ? 'Fund deployment rollup' : 'Fund analytics unavailable'],
    ['Dry powder', values.dryPowder, values.dryPowder != null ? 'Recorded receipts less deployed' : row?.capital_reason || 'Requires collected and deployed records', capitalState],
    ['Distributions to LPs', values.distributed, hasSource ? 'Recorded fund distributions' : 'Fund analytics unavailable'],
  ];
  const lockedAny = Object.keys(locks).length > 0 && access.status === 'ready' && access.present;

  const header = <ZoneHeader family="i6" bucketPath="/funds" activeSlug="ledger" crumb="Accounting" title={<><Calculator size={19} /> Fund accounting</>}
    intro="Capital accounts, fees, expenses and the journal for one fund."
    refresh={<button className="i6-refresh" type="button" onClick={refresh} disabled={loading} aria-label="Refresh fund accounting" data-testid="fund-accounting-refresh"><RefreshCw size={14} className={loading ? 'i6-spin' : ''} /></button>} />;

  // The rail is drawn on every state, the empty and failed ones included.
  const rail = <WorkerRail
    workspace="Fund"
    role="investor"
    className="i6-rail"
    stance={'One fund, read; a Mercury proposal is the only write'}
    note={'Capital lines trace to the register or positions book; ledger lines trace to posted entries. A failed read is never treated as zero.'}
    coverage={['Capital accounts read from the fund record', 'Operational ledger for the chosen fund and period']}
    coverageNote={'Accepting a Mercury proposal posts that one entry; nothing else on this page writes.'}
    unavailable={[
        ['Reconciliation and close', 'This page does not reconcile, close a period or export the journal.'],
      ]}
  />;

  // Three outcomes before any figure, kept apart (D371): the fund list failed,
  // the reader operates no fund, or a fund.
  if (managed.loading && !fund) {
    return <ZonePrimaryScope><div className="i6-fund if3-shell"><main className="i6-main if3-main" data-testid="investor-fund-accounting">{header}<div className="i6-skeleton" aria-busy="true" /></main>{rail}</div></ZonePrimaryScope>;
  }
  if (managed.error || !fund) {
    return <ZonePrimaryScope><div className="i6-fund if3-shell"><main className="i6-main if3-main" data-testid="investor-fund-accounting">{header}
      {managed.error
        ? <div className="i6-load-error if3-unavailable" role="alert" data-testid="status-fund-accounting-unreadable"><AlertCircle size={14} /> <span>Unreadable: your funds could not be read. That is not the same as having none.</span> <button type="button" onClick={managed.reload}>Try again</button></div>
        : <div className="i6-load-error if3-unavailable" data-testid="status-fund-accounting-no-fund"><AlertCircle size={14} /> <span>You are not the general partner of record for any fund, so there is no fund accounting to open.</span></div>}
    </main>{rail}</div></ZonePrimaryScope>;
  }

  return <ZonePrimaryScope><div className="i6-fund if3-shell"><main className="i6-main if3-main" data-testid="investor-fund-accounting">
    {header}
    <FundPicker funds={managed.funds} fund={fund} onSelect={managed.select} />
    <ZoneToolbar role="investor" className="mb-3" filters={investorZoneFilters('funds/ledger', { value: view, onChange: setView, locked: locks })} actions={investorZoneActions('funds/ledger')} />
    {lockedAny && <p className="i6-footnote" data-testid="fund-ledger-locked">{LOCKED_LINE}</p>}
    {error && <div className="i6-load-error if3-unavailable"><AlertCircle size={14} /> <span>Unreadable: capital account data could not be read.</span></div>}
    {!analytics.loading && !error && !hasSource && <div className="i6-load-error if3-unavailable" data-testid="status-fund-accounting-unavailable"><AlertCircle size={14} /> <span>Not recorded: no capital account data is available for {fund.name || 'this fund'}.</span></div>}
    <section className="if3-stats if3-stats--three"><Stat label="Collected" value={collected.value} note={collected.reason || 'Dated capital-call receipts'} state={collected.state} /><Stat label="Deployed" value={hasSource ? values.deployed : null} note="Fund deployment rollup" /><Stat label="Dry powder" value={values.dryPowder} note={values.dryPowder != null ? 'Recorded receipts less deployed' : row?.capital_reason || 'Requires collected and deployed records'} state={capitalState} /></section>
    <FundLedgerPanel key={`ledger-${refreshKey}`} fundId={fund.id} fundName={fund.name || null} view={view} onAccess={onAccess} />
    <section className="i6-card if3-ledger"><header><div><h2>Capital accounts</h2><span>Every supported capital line derives from fund analytics</span></div><span>Read from the fund record</span></header>{analytics.loading ? <div className="i6-skeleton" /> : <table><thead><tr><th>Line</th><th>Amount</th><th>State</th><th>Note</th></tr></thead><tbody>{lines.map(([label, value, note, state]) => <tr key={label}><td>{label}</td><td>{value == null ? state || (error ? 'Unreadable' : 'Not recorded') : money(value)}</td><td><span className={value == null ? 'if3-state unavailable' : 'if3-state recorded'}>{value == null ? state || (error ? 'Unreadable' : 'Not recorded') : 'Recorded'}</span></td><td>{note}</td></tr>)}</tbody></table>}<p className="i6-footnote">The operational ledger above reads posted fees and expenses by fund and period. These capital lines retain their separate recorded sources.</p></section>
    {row?.lp_capital?.length > 0 && <section className="i6-card if3-ledger"><header><div><h2>LP capital</h2><span>Called, collected and outstanding from recorded lines and receipts</span></div></header><table><thead><tr><th>LP</th><th>Called</th><th>Collected</th><th>Outstanding</th><th>Note</th></tr></thead><tbody>{row.lp_capital.map(lp => <tr key={lp.limited_partner_id}><td>{lp.name || `LP #${lp.limited_partner_id}`}</td>{['called_cents', 'collected_cents', 'outstanding_cents'].map(field => { const metric = capitalMetric(lp, field); return <td key={field}>{metric.value == null ? metric.state : money(metric.value)}</td>; })}<td>{lp.capital_reason || 'Recorded receipts; outstanding is called less those receipts'}</td></tr>)}</tbody></table></section>}
    <section className="i6-card if3-boundary" data-testid="fund-accounting-boundary"><header><div><h2>What this page does</h2><span>One write: a Mercury proposal you accept</span></div></header><p>{WRITE_LINE} It does not reconcile, close periods, export a journal, attach a fee note, or change LP capital accounts. Only assigned fund administrators and admins may post to the operational ledger.</p></section>
    {/* D840 (#2349): ledger entries proposed from the administrator's own Mercury; posted only on Accept. */}
    <FromMercury key={`mercury-${fund.id}-${refreshKey}`} section="ledger" fundId={fund.id} />
    <footer className="i6-footnote">Sources are preserved: capital lines trace to the fund record, ledger lines to posted entries. No journal export, reconciliation, close or Eadwyn write runs from this page.</footer>
  </main>{rail}</div></ZonePrimaryScope>;
}

function Stat({ label, value, note, state = 'Not recorded' }) { return <article className="if3-stat"><span>{label}</span><b>{value == null ? state : money(value)}</b><small>{note}</small></article>; }
