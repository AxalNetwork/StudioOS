import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import './investorFundLanding.css';
import './investorFundLPs.css';

const titleCase = (value) => String(value || 'Unrecorded').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const cents = (value) => value == null || value === '' ? null : Number(value);
const lpCommitment = (lp) => lp?.commitment_cents != null ? cents(lp.commitment_cents) / 100 : lp?.commitment_amount != null ? Number(lp.commitment_amount) : null;
const lpPaid = (lp) => lp?.paid_cents != null ? cents(lp.paid_cents) / 100 : lp?.invested_amount != null ? Number(lp.invested_amount) : null;
const money = (value) => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const date = (value) => value ? String(value).slice(0, 10) : 'Unrecorded';

export default function InvestorFundLPs() {
  const [state, setState] = useState({ loading: true, fund: null, rows: null, error: null });
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setState({ loading: true, fund: null, rows: null, error: null });
    try {
      const funds = await api.fundsList();
      const items = Array.isArray(funds) ? funds : funds?.items || [];
      if (!items.length) {
        setState({ loading: false, fund: null, rows: null, error: 'No accessible fund record is available in this environment.' });
        return;
      }
      const fund = items[0];
      const result = await api.fundsLpsList(fund.id);
      setState({ loading: false, fund, rows: result?.items || [], error: null });
    } catch (error) {
      setState({ loading: false, fund: null, rows: null, error: error?.message || 'The LP register is unavailable for this fund.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = state.rows || [];
  const types = useMemo(() => [...new Set(rows.map((row) => row.type || row.entity_type).filter(Boolean))], [rows]);
  const visible = filter === 'all' ? rows : filter === 'behind' ? rows.filter((row) => {
    const commitment = lpCommitment(row);
    const paid = lpPaid(row);
    return commitment != null && paid != null && paid < commitment;
  }) : filter === 'kyc' ? rows.filter((row) => ['pending', 'in_review', 'unverified'].includes(String(row.kyc_status || row.kyc || '').toLowerCase())) : rows.filter((row) => (row.type || row.entity_type || '').toLowerCase() === filter);
  const totalCommitted = rows.reduce((sum, row) => sum + (lpCommitment(row) || 0), 0);
  const largest = rows.reduce((max, row) => Math.max(max, lpCommitment(row) || 0), 0);
  const kycOutstanding = rows.filter((row) => ['pending', 'in_review', 'unverified'].includes(String(row.kyc_status || row.kyc || '').toLowerCase())).length;

  return <div className="i6-fund ip1-fund-shell"><main className="i6-main ip1-fund-main" data-testid="investor-fund-lps"><header className="i6-header"><div><div className="i6-breadcrumb">Fund <span>‹</span> <b>LPs</b></div><h1>LP registry</h1><p>Registry, KYC state, documents and comms log.</p></div><button className="i6-refresh" type="button" onClick={load} disabled={state.loading} aria-label="Refresh LP register"><RefreshCw size={14} className={state.loading ? 'i6-spin' : ''} /></button></header>
    <nav className="i6-zones" aria-label="Fund sections"><Link className="is-active" to="/funds/lps">LPs</Link><Link to="/funds/calls">Calls</Link><Link to="/funds/ledger">Accounting</Link><Link to="/funds/reporting">Reporting</Link></nav>
    <div className="i6-filters">{[['all', 'All LPs'], ['behind', 'Behind'], ['kyc', 'KYC pending'], ...types.map((type) => [type.toLowerCase(), titleCase(type)])].map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {state.error && <div className="i6-load-error ip1-fund-unavailable" data-testid="status-fund-lps-unavailable"><AlertCircle size={14} /> <span>LP registry unavailable. No LP count, commitment, payment, KYC, or delinquency claim is being made. <small>{state.error}</small></span></div>}
    <section className="i6-summary ip1-fund-summary"><div><div className="i6-kicker">{state.fund?.name || 'Fund record unavailable'}</div><strong className="i6-money">{state.error ? 'Unavailable' : money(totalCommitted)}</strong><span className="i6-caption">committed</span></div><dl className="i6-summary-stats"><div><dt>LPs</dt><dd>{state.error ? 'Unavailable' : rows.length}</dd></div><div><dt>Largest position</dt><dd>{state.error ? 'Unavailable' : money(largest)}</dd></div><div><dt>KYC outstanding</dt><dd>{state.error ? 'Unavailable' : kycOutstanding}</dd></div></dl><p>Figures appear only when a fund record and its authorized LP register are available. Share of fund is computed from returned commitment rows.</p></section>
    <section className="i6-card i6-registry ip1-fund-registry"><header><div><h2>LP register</h2><span>{state.error ? 'Register source unavailable' : `${visible.length} of ${rows.length} records`}</span></div><span>Read-only collection</span></header>{state.loading ? <div className="i6-skeleton" /> : state.error ? <div className="i6-empty"><AlertCircle size={16} /> The detailed LP register cannot be displayed without an accessible fund source.</div> : rows.length === 0 ? <div className="i6-empty">No LP records are available for this fund.</div> : visible.length === 0 ? <div className="i6-empty">No LP records match this filter.</div> : <div className="ip1-fund-table-wrap"><table><thead><tr><th>LP</th><th>Type</th><th>Commitment</th><th>Share</th><th>Paid to date</th><th>State</th><th>KYC</th></tr></thead><tbody>{visible.map((lp) => { const commitment = lpCommitment(lp); const paid = lpPaid(lp); const status = lp.status || (commitment != null && paid != null && paid >= commitment ? 'Paid' : 'Unrecorded'); const kyc = lp.kyc_status || lp.kyc || 'Unrecorded'; return <tr key={lp.id || lp.uid || lp.email}><td><strong>{lp.name || lp.email || `LP #${lp.id}`}</strong><small>{lp.joined_at ? `Joined ${date(lp.joined_at)}` : 'Name source preserved'}</small></td><td>{lp.type || lp.entity_type || 'Unrecorded'}</td><td>{money(commitment)}</td><td>{commitment && totalCommitted ? `${((commitment / totalCommitted) * 100).toFixed(1)}%` : 'Unavailable'}</td><td>{money(paid)}</td><td><span className={`ip1-fund-pill ${String(status).toLowerCase()}`}>{titleCase(status)}</span></td><td><span className={`ip1-fund-pill ${String(kyc).toLowerCase()}`}>{titleCase(kyc)}</span></td></tr>; })}</tbody></table></div>}<p className="i6-footnote">This collection does not add LPs, export the register, send communications, or change KYC/LPA records.</p></section>
    <footer className="i6-footnote ip1-fund-boundary">Fund source-preserved · no write actions from this page.</footer>
  </main><aside className="i6-rail"><div className="i6-rail-title">Worker AI · Fund</div><section><strong>Inherited from Fund</strong><p>Mode and model are set on the workspace. This page keeps the LP register tied to its source rows.</p></section><section className="i6-rail-note"><strong>Advisor fills the blanks</strong><p>Missing fund or KYC fields remain unavailable; no letters, calls, or records are generated.</p></section><section><strong>Registry boundary</strong><p>Only an authorized fund register can support commitment, paid-to-date, share, or KYC figures.</p></section><div className="i6-rail-trust"><span>Screened</span> Read-only collection · no send or export action.</div></aside></div>;
}