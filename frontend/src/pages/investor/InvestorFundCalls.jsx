import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import './investorFundLanding.css';
import './investorFundCalls.css';

const filters = [['call3', 'Call 3'], ['all', 'All calls'], ['outstanding', 'Outstanding'], ['notices', 'Notices']];

export default function InvestorFundCalls() {
  const [filter, setFilter] = useState('call3');
  return <div className="i6-fund if2-shell"><main className="i6-main if2-main" data-testid="investor-fund-calls"><header className="i6-header"><div><div className="i6-breadcrumb">Fund <span>‹</span> <b>Calls</b></div><h1>Capital calls</h1><p>Schedule builder, letters, wire tracking and delinquency.</p></div></header>
    <nav className="if2-zones" aria-label="Fund sections"><Link to="/funds/lps">LPs</Link><Link className="is-active" to="/funds/calls">Calls</Link><Link to="/funds/ledger">Accounting</Link><Link to="/funds/reporting">Reporting</Link></nav>
    <div className="if2-filters">{filters.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="i6-load-error if2-unavailable" data-testid="status-fund-calls-unavailable"><AlertCircle size={14} /><span>Fund-scoped call ledger unavailable. No call total, LP obligation, receipt, or delinquency claim is being made.</span></div>
    <section className="if2-stats"><Stat label="Called to date" note="Fund call source unavailable" /><Stat label="Collected" note="Receipt ledger unavailable" /><Stat label="Outstanding" note="Cannot determine without LP rows" /><Stat label="Current call" note="No fund call schedule recorded" /></section>
    <section className="i6-card if2-ledger"><header><div><h2>Call ledger</h2><span>{filters.find(([id]) => id === filter)?.[1]} · source unavailable</span></div><span>Read-only collection</span></header><div className="i6-empty if2-empty"><AlertCircle size={17} /><div><strong>No fund-scoped call schedule is available.</strong><p>The current call records are not linked to a specific VC fund register, so this page cannot safely show amounts, owed/received values, LP states, ages, or notices.</p></div></div><p className="i6-footnote">A personal LP portal is not substituted for this full ledger. Global legal-capital calls are not merged into a fund view without an explicit fund relationship.</p></section>
    <section className="i6-card if2-boundary-card"><header><div><h2>Delinquency and notices</h2><span>Unavailable until the source is fund-scoped</span></div></header><p>IF2 does not draft reminders, send notices, export wires, or infer delinquency from missing personal records. Every figure must trace back to the fund call schedule and its LP register.</p></section>
    <footer className="i6-footnote">Fund source-preserved · no call, notice, wire, or AI write action from this page.</footer>
  </main><aside className="i6-rail"><div className="i6-rail-title">Worker AI · Fund</div><section><strong>Inherited from Fund</strong><p>Mode and model are set on the workspace. Source records remain the authority for every call figure.</p></section><section className="i6-rail-note"><strong>Advisor fills the blanks</strong><p>Unavailable values stay unavailable. No reminder letters or notices are generated.</p></section><section><strong>Traceability rule</strong><p>Fund-wide calls need a fund relationship, LP obligation, receipt, and notice record before they can appear here.</p></section><div className="i6-rail-trust"><span>Screened</span> Read-only collection · no send or export action.</div></aside></div>;
}

function Stat({ label, note }) { return <article className="if2-stat"><span>{label}</span><b>Unavailable</b><small>{note}</small></article>; }