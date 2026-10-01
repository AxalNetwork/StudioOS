/**
 * The Investor Studio's stat rows and their states. A source whose read failed
 * draws one Unreadable line in place of its rows, never rows that read "Not
 * recorded", and a source still loading draws a loader, never a zero (D321).
 *
 * Kept apart from InvestorStudioHome.jsx so a Node test can render them: the
 * home mounts PersonalAdvisor, whose imports reach Worker modules.
 */
import { Loader2 } from 'lucide-react';
import { Unreadable, Unrecorded } from '../../ui';

// Number(null) is 0, so null and '' are checked first: an absent figure stays absent.
export const number = (value) => (value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

// Quick stats reads two sources: the dashboard payload (deal flow, match
// average) and the investor lifecycle (watching, deal rooms). Each is in one of
// four states, and a failed read is never shown as an absent value.
export function quickStats({ previewing, dashboard, dashboardUnavailable, lifecycle, dealCount }) {
  const dealFlowRows = [['Deals in flow', dealCount], ['Avg AI match', number(dashboard?.quick_stats?.ai_score_avg), 'No match average is recorded yet.']];
  const counts = lifecycle?.counts || {};
  const lifecycleRows = [['Watching', number(counts.watching), 'The lifecycle returned no watchlist count.'], ['Active deal rooms', number(counts.dealrooms), 'The lifecycle returned no deal-room count.']];
  const state = (failed, pending) => (previewing ? 'withheld' : failed ? 'unreadable' : pending ? 'loading' : 'ready');
  return {
    dealFlow: { state: state(Boolean(dashboardUnavailable), !dashboard), rows: dealFlowRows },
    lifecycle: { state: state(lifecycle === null, lifecycle === undefined), rows: lifecycleRows },
  };
}

export function Loading() { return <div className="is-loading" data-testid="status-investor-loading"><Loader2 size={15} className="animate-spin" />Loading live records…</div>; }
export function Row({ label, value, reason }) { return <div className="is-row" data-testid={`row-investor-stat-${label.toLowerCase().replaceAll(' ', '-')}`}><span>{label}</span><b>{value === null || value === undefined ? <Unrecorded reason={reason} /> : value}</b></div>; }
// One source's rows under one state. A group whose read failed draws a single
// Unreadable line in place of its rows; it never draws them as not recorded.
export function StatGroup({ group, what, claim, onRetry }) {
  if (group.state === 'withheld') return group.rows.map(([label]) => <Row key={label} label={label} value="Withheld in preview" />);
  if (group.state === 'loading') return <Loading />;
  if (group.state === 'unreadable') return <Unreadable what={what} claim={claim} onRetry={onRetry} />;
  return group.rows.map(([label, value, reason]) => <Row key={label} label={label} value={value} reason={reason} />);
}
