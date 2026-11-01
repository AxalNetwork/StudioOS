/**
 * D1419 (#3698) — the investor's six module bodies, lifted from
 * `InvestorStudioHome.jsx`'s three grids, over the reads the home already
 * makes (D321's states kept): the dashboard, the lifecycle, positions
 * analytics and calendar events. No read per tile.
 *
 * Each read is loading, could not be read (with Try again), empty, or ready;
 * an administrator's preview withholds every one (SM11). Quick stats keeps
 * its two sources' own states (`StatGroup`), so one failed source does not
 * blank the other.
 */
import { Link } from 'react-router-dom';
import InvestorQuotaBars from '../../../components/InvestorQuotaBars';
import { Unrecorded } from '../../../ui';
import { Row, StatGroup, number } from '../../investor/investorStudioParts';
import { TILE } from '../studioLayoutModel';

const readable = (value) => String(value || '').replace(/[_-]/g, ' ').trim() || 'Not recorded';
const score = (item) => number(item?.score ?? item?.ai_score ?? item?.match_score);
const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date) : 'Date not recorded';
};

export function Opportunity({ item, index }) {
  const id = item.deal_id || item.id;
  const value = score(item);
  return (
    <div className="is-opportunity" data-testid={`row-investor-opportunity-${id || index}`}>
      <span className="is-score">{value == null ? <Unrecorded reason="No match score is recorded for this deal.">Unscored</Unrecorded> : Math.round(value)}</span>
      <div>
        <b>{item.deal_name || item.name || 'Confidential deal'}</b>
        <p>{[item.sector, item.stage, item.source].filter(Boolean).map(readable).join(' · ') || 'Details not recorded'}</p>
        <nav><Link to={id ? `/projects/${id}` : '/deals'} data-testid={`link-investor-open-deal-${id || index}`}>Open</Link><Link to="/deals" data-testid={`link-investor-request-intro-${id || index}`}>Request intro</Link></nav>
      </div>
    </div>
  );
}

export function PortfolioRows({ data }) {
  const source = data?.analytics || data || {};
  return (
    <>
      <Row label="IRR" value={source.irr != null ? `${source.irr}%` : null} reason="Needs a dated mark for every position." />
      <Row label="TVPI" value={source.tvpi != null ? `${source.tvpi}×` : null} />
      <Row label="MOIC" value={source.moic != null ? `${source.moic}×` : null} />
    </>
  );
}

/**
 * One spec per investor Studio key. `lifecycle` and the two records are
 * undefined while loading and null (or a `failures` entry) when they failed.
 */
export function investorTiles({
  user, previewing = false, dashboard, dashboardUnavailable = '', lifecycle, records = {}, failures = {},
  opportunities = [], stages = [], events = [], quick, refreshContext, retryLifecycle, retrySources,
}) {
  const withheld = { state: TILE.WITHHELD };
  if (previewing) {
    return Object.fromEntries(['usage_quota', 'deal_lifecycle', 'scored_opportunities', 'quick_stats', 'portfolio_glance', 'upcoming_events'].map((k) => [k, withheld]));
  }
  return {
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
                <div className="is-funnel">{stages.slice(0, 5).map((stage) => <Link to={stage.href || '/deals'} key={stage.id || stage.label} data-testid={`link-investor-stage-${stage.id || stage.label}`}><b>{number(stage.count) ?? <Unrecorded />}</b><span>{stage.label || readable(stage.id)}</span></Link>)}</div>
                <p className="is-card-note">Read-only here — stages move in Deals, never from this surface.</p>
              </>
            ),
          },
    scored_opportunities: dashboardUnavailable ? { state: TILE.UNREADABLE, onRetry: refreshContext }
      : !dashboard ? { state: TILE.LOADING }
        : !opportunities.length ? { state: TILE.EMPTY, empty: 'No scored opportunities are recorded against your thesis.', href: '/deals', openLabel: 'Open deal flow' }
          : {
            state: TILE.READY,
            note: `${opportunities.length} scored`,
            href: '/deals',
            openLabel: 'Open deal flow',
            body: (
              <>
                <div className="is-opportunity-list">{opportunities.map((item, index) => <Opportunity key={item.id || item.deal_id || index} item={item} index={index} />)}</div>
                <p className="is-card-note">Scores are match signals against your thesis answers — Eadwyn proposes; it never places a deal.</p>
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
    upcoming_events: records.events === undefined && !failures.events ? { state: TILE.LOADING }
      : failures.events ? { state: TILE.UNREADABLE, onRetry: retrySources }
        : !events.length ? { state: TILE.EMPTY, empty: 'No upcoming events recorded.', href: '/calendar', openLabel: 'Open events' }
          : {
            state: TILE.READY,
            note: `${events.length} ${events.length === 1 ? 'event' : 'events'}`,
            href: '/calendar',
            openLabel: 'Open events',
            body: <div className="is-event-list">{events.map((event, index) => <Link to="/calendar" key={event.id || index} data-testid={`link-investor-event-${event.id || index}`}><b>{event.title || event.name || 'Event title not recorded'}</b><span>{formatDate(event.start_at || event.starts_at || event.date)}</span></Link>)}</div>,
          },
  };
}
