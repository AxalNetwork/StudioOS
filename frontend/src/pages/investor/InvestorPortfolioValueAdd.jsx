import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ClipboardList, RefreshCw } from 'lucide-react';
import './investorPortfolioCanvas.css';
import './investorPortfolioValueAdd.css';

const FILTERS = [['all', 'All'], ['delivered', 'Delivered'], ['outstanding', 'Outstanding'], ['company', 'By company']];

export default function InvestorPortfolioValueAdd() {
  const [filter, setFilter] = useState('all');

  return <div className="i4-shell ip3-shell"><main className="i4-portfolio ip3-value-add" data-testid="investor-portfolio-value-add"><header className="i4-heading"><div><div className="i4-eyebrow">Portfolio / Value-add</div><h1>Value-add desk</h1><p>Support ledger — introductions, hours and outcomes per company.</p></div><button type="button" className="i4-icon-button" onClick={() => window.location.reload()} aria-label="Refresh value-add desk"><RefreshCw size={15} /></button></header>
    <nav className="i4-tabs" aria-label="Portfolio sections"><Link to="/portfolio/positions">Positions</Link><Link to="/portfolio/updates">Updates</Link><Link className="is-active" to="/portfolio/value-add">Value-add</Link></nav>
    <div className="ip3-filters"><div>{FILTERS.map(([id, label]) => <button key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
    <div className="i4-partial" data-testid="status-investor-value-add-unavailable">Support ledger unavailable. This page does not present an empty support history or infer work from introductions, messages, calendar events, or portfolio updates.</div>
    <section className="i4-stats"><Stat label="Delivered" note="No support ledger source" /><Stat label="Hours logged" note="No explicit hours field" /><Stat label="Outstanding" note="No promise state recorded" /><Stat label="No support at all" note="Cannot be determined without the ledger" /></section>
    <section className="i4-card i4-positions ip3-ledger"><div className="i4-section-head"><div><h2>Support ledger</h2><p>{filter === 'all' ? 'Promised entries would remain visible until delivered or withdrawn' : `${FILTERS.find(([id]) => id === filter)?.[1]} records`}</p></div><span>Source unavailable · no write</span></div><div className="i4-empty ip3-empty"><AlertCircle size={18} /><div><strong>Support history is not available.</strong><p>No stored value-add ledger exposes support kind, delivery state, hours, or outcomes for this investor book.</p></div></div><p className="i4-seam-note"><span>Evidence boundary</span> Introductions, board work, hiring help, hours, promises, and downstream outcomes are separate facts. None are claimed here without a dedicated stored record.</p></section>
    <section className="i4-card ip3-unavailable"><div className="i4-section-head"><div><h2>Per-company support</h2><p>Not available from the current data sources</p></div></div><strong>Company-level support summaries are unavailable.</strong><p>IP3 does not count a company as supported or unsupported from the position book alone. Log support, export, per-company views, and narrative generation remain outside this read-only collection.</p></section>
    <footer className="i4-boundary">Investor workspace · no support, outcome, or hours claim is made without a stored ledger record.</footer>
  </main><ValueAddRail /></div>;
}

function Stat({ label, note }) { return <article className="i4-stat ip3-stat"><div><span>{label}</span><b>Unavailable</b><small>{note}</small></div></article>; }
function ValueAddRail() { return <aside className="i4-rail" aria-label="Portfolio assistance"><div className="i4-rail-label">Worker AI · Portfolio</div><section><strong>Read-only support desk</strong><p>This view would summarize recorded support work without changing company records.</p></section><section className="i4-rail-accent"><strong>Advisor fills the blanks</strong><p>No AI support summary or write action is enabled on IP3.</p></section><div className="i4-rail-label">Source coverage</div><section><strong>Support ledger unavailable</strong><p>No dedicated source records delivery state, hours, promises, or outcomes.</p></section><section><ClipboardList size={14} /><strong>Unsupported inference</strong><p>Introductions and calendar activity are not relabelled as value-add work.</p></section><div className="i4-rail-trust"><span>Screened</span> Nothing is logged, exported, or sent from this page.</div></aside>; }