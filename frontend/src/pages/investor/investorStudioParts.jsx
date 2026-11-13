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
//
// D4620 (#4620): a source can also answer 200 with ONE of its reads failed
// (`source_status` on the dashboard, `sources` on the lifecycle). The rows that
// depend on that read are Unreadable, the others keep their figures, and
// nothing is drawn as 0. `dealCount` is the ELIGIBLE total the worker counted
// (`proprietary_deal_flow_summary.total`), never the length of the preview, and
// null when it could not be counted; `dealCountIsLowerBound` marks a floor.
export function quickStats({ previewing, dashboard, dashboardUnavailable, lifecycle, dealCount, dealCountIsLowerBound = false }) {
  const dashboardFailed = (label) => dashboard?.source_status?.[label] === 'unreadable';
  const lifecycleFailed = (label) => lifecycle?.sources?.[label] === 'unreadable';
  const total = number(dealCount);
  const dealFlowRows = [
    ['Deals in flow', total === null ? null : (dealCountIsLowerBound ? `${total}+` : total), 'No deal-flow total is recorded.', dashboardFailed('deals') ? 'unreadable' : undefined],
    // D4623 part 2: the average is of the same historical match scores the score module labels (D4623): it is
    // marked Historical, and a member with none reads Not recorded, never 0 and never a promise of one to come.
    ['Avg AI match', number(dashboard?.quick_stats?.ai_score_avg), 'No historical match score is recorded for you. The matching engine that wrote them is retired.', dashboardFailed('scoresMine') ? 'unreadable' : undefined, { historical: true }],
  ];
  const counts = lifecycle?.counts || {};
  const lifecycleRows = [
    ['Watching', number(counts.watching), 'The lifecycle returned no watchlist count.', lifecycleFailed('inv:watching') ? 'unreadable' : undefined],
    ['Active deal rooms', number(counts.dealrooms), 'The lifecycle returned no deal-room count.', lifecycleFailed('inv:dealrooms') ? 'unreadable' : undefined],
  ];
  const state = (failed, pending) => (previewing ? 'withheld' : failed ? 'unreadable' : pending ? 'loading' : 'ready');
  return {
    dealFlow: { state: state(Boolean(dashboardUnavailable), !dashboard), rows: dealFlowRows },
    lifecycle: { state: state(lifecycle === null, lifecycle === undefined), rows: lifecycleRows },
  };
}

export function Loading() { return <div className="is-loading" data-testid="status-investor-loading"><Loader2 size={15} className="animate-spin" />Loading live records…</div>; }
// `state` 'unreadable' (D4620): this one figure's read failed. It says so, in the red the group's own Unreadable line uses; it is not Not recorded and not 0.
// `historical` (D4623 part 2): a recorded figure from a retired source says so, as the score rows do ("Historical · ").
export function Row({ label, value, reason, state, historical = false }) {
  const slug = label.toLowerCase().replaceAll(' ', '-');
  const body = state === 'unreadable'
    ? <span className="text-red-700 dark:text-red-300" data-testid={`status-investor-stat-${slug}-unreadable`}>Could not be read</span>
    : value === null || value === undefined ? <Unrecorded reason={reason} />
      : historical ? <><span className="font-normal" data-testid={`text-investor-stat-${slug}-historical`}>Historical · </span>{value}</> : value;
  return <div className="is-row" data-testid={`row-investor-stat-${slug}`}><span>{label}</span><b>{body}</b></div>;
}
// One source's rows under one state. A group whose read failed draws a single
// Unreadable line in place of its rows; it never draws them as not recorded.
export function StatGroup({ group, what, claim, onRetry }) {
  if (group.state === 'withheld') return group.rows.map(([label]) => <Row key={label} label={label} value="Withheld in preview" />);
  if (group.state === 'loading') return <Loading />;
  if (group.state === 'unreadable') return <Unreadable what={what} claim={claim} onRetry={onRetry} />;
  const rows = group.rows.map(([label, value, reason, rowState, flags]) => <Row key={label} label={label} value={value} reason={reason} state={rowState} historical={flags?.historical === true} />);
  // D4620: a figure whose read failed gets one Retry for the source, under the figures that did load.
  if (group.rows.some((row) => row[3] === 'unreadable')) return [...rows, <Unreadable key="unreadable" what="Some of these figures" claim="This is not a claim that they are zero." onRetry={onRetry} />];
  return rows;
}
