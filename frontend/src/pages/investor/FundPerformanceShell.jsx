/**
 * #6245 (owner: C): one page for an LP's read of the funds they are in and a GP's read of the funds they run.
 * It draws its own Fund chrome: the crumb, the h1, the rail and, for an Institutional reader, the Fund zone row.
 * An LP without the Institutional tier gets no zone row; those GP zones would only show it the locked notice.
 */
import { RefreshCw, TrendingUp } from 'lucide-react';
import { WorkerRail } from '../../ui';
import ZoneHeader from '../../workspaces/ZoneHeader';
import { ZonePrimaryScope } from '../../workspaces/ZoneActions';
import './investorFundLanding.css';
import './investorFundReporting.css';

export function FundPerformanceLocked() {
  return <section className="i6-card" role="status" data-testid="fund-performance-locked">
    <h2>Fund performance is not available on this account</h2>
    <p className="i6-footnote">It reads the funds you hold an LP record in, and the funds you run as GP of record, with the Investor licence. Your other workspaces are unchanged.</p>
  </section>;
}
export default function FundPerformanceShell({ fundUnlocked = false, locked = false, state, reload = () => {}, children = null }) {
  const count = state.items.length;
  return <ZonePrimaryScope><main className="i6-fund if4-shell" data-testid="fund-performance-page"><div className="i6-main if4-main">
    <ZoneHeader family="i6" bucketPath="/funds" activeSlug={null} crumb="Performance" nav={fundUnlocked && !locked}
      title={<><TrendingUp size={19} /> Fund performance</>}
      intro="The funds you are an LP in and the funds you run: NAV, paid-in, distributions and returns from recorded valuations and cash flows."
      refresh={locked ? null : <button type="button" className="if4-refresh" onClick={reload} disabled={state.loading} aria-label="Refresh fund performance"><RefreshCw size={14} className={state.loading ? 'if4-spin' : ''} /></button>} />
    <div className="mt-4">{locked ? <FundPerformanceLocked /> : children}</div>
  </div><WorkerRail
    workspace="Fund"
    role="investor"
    className="i6-rail"
    stance="Read-only performance"
    note="Figures come from recorded position marks and fund cash flows. A missing figure says why; nothing is estimated."
    coverage={locked ? [] : [state.loading ? 'Reading fund performance' : state.error ? 'Fund performance unreadable' : `${count} fund${count === 1 ? '' : 's'} readable`]}
    coverageNote="An LP reads the funds they hold an LP record in; a GP of record reads the funds they run."
    unavailable={[['Modelling', 'No projection, forecast or scenario is drawn on this page.']]}
  /></main></ZonePrimaryScope>;
}
