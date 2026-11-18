/**
 * D1419 (#3698) — the investor's module bodies, lifted from
 * `InvestorStudioHome.jsx`'s three grids, over the reads the home already
 * makes (D321's states kept): the dashboard, the lifecycle, positions
 * analytics and calendar events. No read per tile.
 *
 * Each read is loading, could not be read (with Try again), empty, or ready;
 * an administrator's preview withholds every one (SM11). Quick stats keeps
 * its two sources' own states (`StatGroup`), so one failed source does not
 * blank the other.
 *
 * D6129 (#6129): Needs you and Funds are drawn to canvas D6126, and Returns,
 * Thesis fit on live deals and Arrivals join them (`investorHomeModules.jsx`).
 */
import { Link } from 'react-router-dom';
import InvestorQuotaBars from '../../../components/InvestorQuotaBars';
import { Unreadable, Unrecorded } from '../../../ui';
import { Row, StatGroup, number } from '../../investor/investorStudioParts';
import { TILE } from '../studioLayoutModel';
import { COMMITMENT, LP_WORKSPACE, arrivalsOf, fitOf, fundsOf, needsYouRows, returnsOf, shortDay } from '../../investor/investorHomeModel';
import { ArrivalsBody, FitBody, FundsBody, NeedsYouBody, ReturnsBody } from './investorHomeModules';
import { formatRate } from '../../../lib/rate';

const readable = (value) => String(value || '').replace(/[_-]/g, ' ').trim() || 'Not recorded';
const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date) : 'Date not recorded';
};

export function PortfolioRows({ data }) {
  const source = data?.analytics || data || {};
  return (
    <>
      {/* D4619 (#4619): IRR is a fraction from the Worker (0.1 is 10%); a missing one stays Not recorded. */}
      <Row label="IRR" value={formatRate(source.irr)} reason="Needs a dated mark for every position." />
      <Row label="TVPI" value={source.tvpi != null ? `${source.tvpi}×` : null} />
      <Row label="MOIC" value={source.moic != null ? `${source.moic}×` : null} />
    </>
  );
}

/**
 * D6129 (#6129, canvas D6126): Needs you, Funds, Returns, Thesis fit on live
 * deals and Arrivals. Each answers on its own reads: a read still out is
 * loading, a failed one Unreadable with Try again, an answer with nothing in
 * it the module's own empty words. The rules are `investorHomeModel.js`.
 */
function homeV2Tiles({ records, failures, retry, today, dashboard, dashboardUnavailable }) {
  const { fund, deals, updates } = records;
  const needs = needsYouRows(records, failures, today);
  const fundUnreadable = !!failures.fund || (fund != null && !Array.isArray(fund?.lp_holdings));
  const funds = fundUnreadable || fund === undefined ? null : fundsOf(fund, today);
  const asAt = shortDay(today, { year: true });
  const portfolio = records.portfolio;
  const returns = portfolio && typeof portfolio === 'object' ? returnsOf(portfolio) : null;
  const fit = deals && typeof deals === 'object' ? fitOf(deals) : null;
  const dealSummary = dashboard?.proprietary_deal_flow_summary;
  const offered = dashboardUnavailable || dashboard?.source_status?.deals === 'unreadable' ? { state: 'unreadable' }
    : dashboard ? { state: 'ready', count: Number.isFinite(dealSummary?.total) ? dealSummary.total : null, lowerBound: dealSummary?.total_is_lower_bound === true } : null;
  const arrivalsLoading = (updates === undefined && !failures.updates) || (fund === undefined && !failures.fund);
  const arrivals = arrivalsLoading ? null : arrivalsOf({ updates, fund, updatesFailed: !!failures.updates, fundFailed: fundUnreadable });
  const retryArrivals = () => { if (arrivals?.unreadable.includes('Founder updates')) retry('updates'); if (fundUnreadable || fund?.capital_statements_recorded === false) retry('fund'); };
  const count = needs.rows.length;
  return {
    needs_you: !needs.incomplete && !count ? { state: TILE.EMPTY, empty: 'Nothing needs you today. Capital calls, fund notices, signatures and Trust requirements appear here when they need you.' }
      : Object.values(needs.sources).every((s) => s.loading) ? { state: TILE.LOADING }
        : { state: TILE.READY, note: count ? `${count} ${count === 1 ? 'item' : 'items'} · by due date, then date added` : undefined, body: <NeedsYouBody model={needs} onRetry={retry} /> },
    fund_commitment: fundUnreadable ? { state: TILE.UNREADABLE, onRetry: () => retry('fund') }
      : fund === undefined ? { state: TILE.LOADING }
        : funds.unlinked && !funds.rows.length ? { state: TILE.READY, href: LP_WORKSPACE, openLabel: 'Open the LP workspace', body: <p className="ihs-sub">Open the LP workspace to link your commitment.</p> }
          : !funds.rows.length ? { state: TILE.EMPTY, empty: 'You hold no fund commitment on Axal. Commitments you make to an Axal fund appear here with what was called, received and is due.', href: '/funds', openLabel: 'See Axal Fund I' }
            : { state: TILE.READY, note: `${funds.rows.length} ${funds.rows.length === 1 ? 'fund' : 'funds'}`, href: COMMITMENT, openLabel: 'Open my commitments', body: <FundsBody funds={funds} asAt={asAt} onRetry={() => retry('fund')} /> },
    returns: failures.portfolio || (portfolio !== undefined && !returns) ? { state: TILE.UNREADABLE, onRetry: () => retry('portfolio') }
      : portfolio === undefined ? { state: TILE.LOADING }
        : returns.empty ? { state: TILE.EMPTY, empty: 'No position is recorded in your book, so there are no returns to show.', href: '/portfolio/performance', openLabel: 'Open Portfolio' }
          : { state: TILE.READY, href: '/portfolio/performance', openLabel: 'Open Portfolio', body: <ReturnsBody returns={returns} /> },
    thesis_fit: failures.deals || (deals !== undefined && !fit) ? { state: TILE.UNREADABLE, onRetry: () => retry('deals') }
      : deals === undefined ? { state: TILE.LOADING }
        : !fit.rows.length ? { state: TILE.EMPTY, empty: 'No live deal is in your flow, so there is nothing to compare with your thesis.', href: '/deals', openLabel: 'Open Deals' }
          : { state: TILE.READY, note: fit.notSet ? undefined : `${fit.rows.length} of ${fit.live} in your flow`, href: '/deals', openLabel: 'Open Deals', body: <FitBody fit={fit} onRetry={() => retry('deals')} /> },
    arrivals: !arrivals ? { state: TILE.LOADING }
      : arrivals.unreadable.length === 2 && !arrivals.items.length ? { state: TILE.UNREADABLE, onRetry: retryArrivals }
        : { state: TILE.READY, note: arrivals.items.length ? 'Newest first' : undefined, body: <ArrivalsBody arrivals={arrivals} deals={offered} onRetry={retryArrivals} /> },
  };
}

/** Every investor Studio key (the Worker's catalogue, `services/studioModules.ts`); an administrator's preview withholds each. */
export const INVESTOR_KEYS = ['needs_you', 'fund_commitment', 'returns', 'thesis_fit', 'arrivals', 'upcoming_events', 'usage_quota', 'deal_lifecycle', 'quick_stats', 'portfolio_glance'];

/**
 * One spec per investor Studio key. `lifecycle` and the two records are
 * undefined while loading and null (or a `failures` entry) when they failed.
 */
export function investorTiles({
  user, previewing = false, dashboard, dashboardUnavailable = '', lifecycle, records = {}, failures = {},
  stages = [], events = [], eventsCoverage = { state: 'ready', failed: [] }, quick, refreshContext, retryLifecycle, retrySources, retrySource = retrySources,
  today = new Date().toISOString().slice(0, 10),
}) {
  const withheld = { state: TILE.WITHHELD };
  if (previewing) {
    return Object.fromEntries(INVESTOR_KEYS.map((k) => [k, withheld]));
  }
  return {
    ...homeV2Tiles({ records, failures, retry: retrySource, today, dashboard, dashboardUnavailable }),
    usage_quota: { state: TILE.READY, href: '/pricing?for=investor', openLabel: 'Open account', body: <InvestorQuotaBars user={user} compact /> },
    deal_lifecycle: lifecycle === undefined ? { state: TILE.LOADING }
      : lifecycle === null ? { state: TILE.UNREADABLE, onRetry: retryLifecycle }
        : !stages.length ? { state: TILE.EMPTY, empty: 'No lifecycle records yet.', href: '/deals', openLabel: 'Open Deals' }
          : {
            state: TILE.READY,
            href: '/deals',
            openLabel: 'Open Deals',
            body: (
              <>
                <div className="is-funnel">{stages.slice(0, 5).map((stage) => <Link to={stage.href || '/deals'} key={stage.id || stage.label} data-testid={`link-investor-stage-${stage.id || stage.label}`}><b>{number(stage.count) ?? (lifecycle.partial ? <span className="text-red-700 dark:text-red-300" data-testid={`status-investor-stage-${stage.id || stage.label}-unreadable`}>Unreadable</span> : <Unrecorded />)}</b><span>{stage.label || readable(stage.id)}</span></Link>)}</div>
                {lifecycle.partial && <Unreadable what="Some funnel stages" claim="This is not a claim that you have none there." onRetry={retryLifecycle} />}
                <p className="is-card-note">Read-only here — stages move in Deals, never from this surface.</p>
              </>
            ),
          },
    quick_stats: {
      state: TILE.READY,
      href: '/portfolio',
      openLabel: 'Open Portfolio',
      body: (
        <>
          <StatGroup group={quick.dealFlow} what="The deal-flow summary" claim="This is not a claim that no deal is in flow." onRetry={refreshContext} />
          <StatGroup group={quick.lifecycle} what="The deal lifecycle" claim="This is not a claim that you watch nothing." onRetry={retryLifecycle} />
        </>
      ),
    },
    portfolio_glance: records.portfolio === undefined && !failures.portfolio ? { state: TILE.LOADING }
      : failures.portfolio ? { state: TILE.UNREADABLE, onRetry: retrySources }
        : { state: TILE.READY, href: '/portfolio/performance', openLabel: 'Open Portfolio', body: <PortfolioRows data={records.portfolio} /> },
    // D4620: a 200 whose calendar sources failed is not an empty calendar. With nothing to show it is Unreadable; with events it shows them and says the list may be incomplete.
    upcoming_events: records.events === undefined && !failures.events ? { state: TILE.LOADING }
      : failures.events || (!events.length && eventsCoverage.state !== 'ready') ? { state: TILE.UNREADABLE, onRetry: retrySources }
        : !events.length ? { state: TILE.EMPTY, empty: 'No upcoming events recorded.', href: '/calendar', openLabel: 'Open events' }
          : {
            state: TILE.READY,
            note: `${events.length} ${events.length === 1 ? 'event' : 'events'}`,
            href: '/calendar',
            openLabel: 'Open events',
            body: (
              <>
                <div className="is-event-list">{events.map((event, index) => <Link to="/calendar" key={event.id || index} data-testid={`link-investor-event-${event.id || index}`}><b>{event.title || event.name || 'Event title not recorded'}</b><span>{formatDate(event.start_at || event.starts_at || event.date)}</span></Link>)}</div>
                {eventsCoverage.state !== 'ready' && <Unreadable what={`Some calendar sources (${eventsCoverage.failed.map((f) => readable(f.kind)).join(', ')})`} claim="This list may be incomplete." onRetry={retrySources} />}
              </>
            ),
          },
  };
}
