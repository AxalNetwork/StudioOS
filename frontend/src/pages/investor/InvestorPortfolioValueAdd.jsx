import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { AlertCircle } from 'lucide-react';
import './investorPortfolioCanvas.css';
import './investorPortfolioValueAdd.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';

/**
 * FOUR LIVE CHIPS OVER A PAGE THAT MAKES NO `api.*` CALL AT ALL.
 *
 * `All / Delivered / Outstanding / By company` were pressable, and pressing one
 * changed a caption above a hard-coded empty state — so "Outstanding" answered
 * "nothing is outstanding for this book" when the truth is that no support
 * ledger exists to have an outstanding entry in. The panel below has always
 * said so; the chips let a reader reach the wrong conclusion first.
 *
 * The refresh control went with them. It called `setFilter('all')` — its own
 * label said "Reset value-add filters" — and with no filters left to reset it
 * would have been a button that does nothing, which is the same defect wearing
 * a different icon. There is no source to re-read: that is the whole point of
 * this page.
 */
export default function InvestorPortfolioValueAdd() {
  return <div className="i4-shell ip3-shell"><main className="i4-portfolio ip3-value-add" data-testid="investor-portfolio-value-add"><header className="i4-heading"><div><div className="i4-eyebrow">Portfolio / Value-add</div><h1>Value-add desk</h1><p>Support ledger — introductions, hours and outcomes per company.</p></div></header>
    <ZoneNav bucket={bucketForPath('investor', '/portfolio')} role="investor" className="my-3" />
    <ZoneToolbar role="investor" className="mb-3" filters={investorZoneFilters('portfolio/value-add')} actions={investorZoneActions('portfolio/value-add')} />
    <div className="i4-partial" data-testid="status-investor-value-add-unavailable">Support ledger unavailable. This page does not present an empty support history or infer work from introductions, messages, calendar events, or portfolio updates.</div>
    <section className="i4-stats"><Stat label="Delivered" note="No support ledger source" /><Stat label="Hours logged" note="No explicit hours field" /><Stat label="Outstanding" note="No promise state recorded" /><Stat label="No support at all" note="Cannot be determined without the ledger" /></section>
    <section className="i4-card i4-positions ip3-ledger"><div className="i4-section-head"><div><h2>Support ledger</h2><p>Promised entries would remain visible until delivered or withdrawn</p></div><span>Source unavailable · no write</span></div><div className="i4-empty ip3-empty"><AlertCircle size={18} /><div><strong>Support history is not available.</strong><p>No stored value-add ledger exposes support kind, delivery state, hours, or outcomes for this investor book.</p></div></div><p className="i4-seam-note"><span>Evidence boundary</span> Introductions, board work, hiring help, hours, promises, and downstream outcomes are separate facts. None are claimed here without a dedicated stored record.</p></section>
    <section className="i4-card ip3-unavailable"><div className="i4-section-head"><div><h2>Per-company support</h2><p>Not available from the current data sources</p></div></div><strong>Company-level support summaries are unavailable.</strong><p>IP3 does not count a company as supported or unsupported from the position book alone. Log support, export, per-company views, and narrative generation remain outside this read-only collection.</p></section>
    <footer className="i4-boundary">Investor workspace · no support, outcome, or hours claim is made without a stored ledger record.</footer>
  </main><ValueAddRail /></div>;
}

function Stat({ label, note }) { return <article className="i4-stat ip3-stat"><div><span>{label}</span><b>Unavailable</b><small>{note}</small></div></article>; }
function ValueAddRail() {
  return (
    <WorkerRail
      workspace="Portfolio"
      role="investor"
      className="i4-rail"
      stance="Read-only support desk"
      note="This view would summarize recorded support work without changing company records. Introductions and calendar activity are never relabelled as value-add work."
      coverage={['Support ledger unavailable']}
      coverageNote="No dedicated source records delivery state, hours, promises or outcomes."
      unavailable={[
        ['Inferred support', 'A company is not counted as supported or unsupported from the position book alone.'],
        ['Logging and export', 'Nothing is logged, exported or sent from this page.'],
      ]}
    />
  );
}
