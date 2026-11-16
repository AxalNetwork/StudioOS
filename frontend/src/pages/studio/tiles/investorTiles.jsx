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
import { Unreadable, Unrecorded } from '../../../ui';
import { Row, StatGroup, number } from '../../investor/investorStudioParts';
import { TILE } from '../studioLayoutModel';
import { waitingOn } from '../../../lib/trustCenter';
import { requirementLabel } from '../../trust/memberTrustModel';
import { commitmentsByFund } from '../../../lib/lpCommitmentModel';
import { canSignBooklet } from '../../../lib/bookletSigning';
import { formatMinor } from '../../../lib/money.js';
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

const LP_WORKSPACE = '/spinout-lab/investor-workspace';
const COMMITMENT = LP_WORKSPACE + '#my-commitment';
const BOOKLET = LP_WORKSPACE + '#subscription-booklet';
const moneyCents = cents => formatMinor(cents, 'USD', { locale: 'en-US' });

function ActionSource({ label, loading, unreadable, onRetry, children }) {
  if (unreadable) return <Unreadable what={label} onRetry={onRetry} />;
  if (loading) return <p role="status">Reading {label.toLowerCase()}…</p>;
  return children;
}

function commitmentTiles(records, failures, retry) {
  const { fund, notices, trust, booklet } = records;
  const sourceState = {
    fund: { unreadable: !!failures.fund || (fund !== undefined && !Array.isArray(fund?.lp_holdings)), loading: fund === undefined },
    notices: { unreadable: !!failures.notices || (notices !== undefined && !Array.isArray(notices?.notices)), loading: notices === undefined },
    trust: { unreadable: !!failures.trust || (trust !== undefined && !Array.isArray(trust?.obligations)), loading: trust === undefined },
    booklet: { unreadable: !!failures.booklet || (booklet != null && (!['open', 'submitted', 'withdrawn'].includes(booklet.status) || booklet.status === 'submitted' && !booklet.signing?.state)), loading: booklet === undefined },
  };
  const holdings = sourceState.fund.unreadable ? [] : commitmentsByFund(fund);
  const callsUnreadable = holdings.some(row => !row.calls_known);
  const unlinked = !sourceState.fund.unreadable && fund?.unlinked_commitment === true;
  const rows = { fund: [], notices: [], booklet: [], trust: [] };
  if (unlinked) rows.fund.push({ key: 'link-lp', label: 'Open the LP workspace to link your commitment', to: LP_WORKSPACE });
  const seenCalls = new Set();
  for (const holding of holdings) {
    if (!holding.lpa_signed) rows.fund.push({ key: `lpa-${holding.lp_id}`, label: 'Sign the LPA' + (holding.fund_name ? ` · ${holding.fund_name}` : ''), to: COMMITMENT });
    for (const call of holding.calls) {
      if (call.limited_partner_id != null && call.limited_partner_id !== holding.lp_id) continue;
      if (seenCalls.has(call.id) || call.status === 'paid' || !(call.outstanding_cents > 0)) continue;
      seenCalls.add(call.id);
      const notice = notices?.notices?.find?.(item => !item.superseded && item.type === 'capital_call_notice' && item.fund_id === holding.fund_id && item.limited_partner_id === holding.lp_id && String(item.call_number) === String(call.call_number));
      const label = call.due_date ? `Capital call ${call.state === 'overdue' ? 'overdue' : 'due'} · ${call.due_date}` : 'Capital call outstanding · due date not recorded';
      rows.fund.push({ key: `call-${call.id}`, label, to: notice ? LP_WORKSPACE + '#my-notices' : COMMITMENT });
    }
  }
  if (!sourceState.booklet.unreadable) {
    if (booklet?.status === 'open') rows.booklet.push({ key: 'booklet', label: 'Submit the subscription booklet', to: BOOKLET });
    else if (canSignBooklet(booklet) || booklet?.signing?.state === 'sent') rows.booklet.push({ key: 'booklet', label: 'Sign the subscription booklet', to: BOOKLET });
  }
  if (!sourceState.trust.unreadable) {
    for (const obligation of trust?.obligations || []) {
      if (Number(obligation.required) === 1 && waitingOn(obligation.status) === 'you' && obligation.obligation_key) {
        rows.trust.push({ key: obligation.obligation_key, label: requirementLabel(obligation), to: '/trust/me?requirement=' + encodeURIComponent(obligation.obligation_key) });
      }
    }
  }
  const incomplete = callsUnreadable || Object.values(sourceState).some(source => source.loading || source.unreadable);
  const any = Object.values(rows).some(items => items.length);
  const links = (key) => rows[key].map(item => <li key={item.key}><Link className="underline" to={item.to}>{item.label}</Link></li>);
  return {
    fund_commitment: sourceState.fund.unreadable ? { state: TILE.UNREADABLE, onRetry: () => retry('fund') }
      : sourceState.fund.loading ? { state: TILE.LOADING }
      : unlinked && !holdings.length ? { state: TILE.READY, href: LP_WORKSPACE, body: <p>Open the LP workspace to link your commitment.</p> }
      : !holdings.length ? { state: TILE.EMPTY, empty: 'No commitment is recorded.', href: COMMITMENT, openLabel: 'Open My commitment' }
      : { state: TILE.READY, href: COMMITMENT, openLabel: 'Open My commitment', body: <>
          {unlinked && <p><Link to={LP_WORKSPACE}>Open the LP workspace to link the rest of your commitments.</Link></p>}
          {callsUnreadable && <Unreadable what="Capital calls" onRetry={() => retry('fund')} />}
          {holdings.map(row => <section key={row.lp_id}>
            {row.fund_name && <h4>{row.fund_name}</h4>}
            <Row label="Committed" value={moneyCents(row.commitment_cents)} />
            <Row label="Called" value={moneyCents(row.called_cents)} state={row.calls_known ? undefined : 'unreadable'} />
            <Row label="Due" value={moneyCents(row.due_cents)} state={row.calls_known ? undefined : 'unreadable'} />
            <Row label="Uncalled" value={moneyCents(row.uncalled_cents)} state={row.calls_known ? undefined : 'unreadable'} />
            <Row label="Next call due" value={row.next_due ?? (row.calls_known && !row.due_cents ? 'None scheduled' : null)} state={row.calls_known ? undefined : 'unreadable'} />
          </section>)}
        </> },
    needs_you: !incomplete && !any ? { state: TILE.EMPTY, empty: 'Nothing needs your attention right now.' }
      : { state: TILE.READY, body: <>
          {any && <ul className="space-y-1">{Object.keys(rows).flatMap(links)}</ul>}
          {Object.entries({ fund: 'Fund records', notices: 'Fund notices', booklet: 'Subscription booklet', trust: 'Trust requirements' }).map(([key, label]) =>
            <ActionSource key={key} label={label} {...sourceState[key]} onRetry={() => retry(key)} />
          )}
          {callsUnreadable && <Unreadable what="Capital calls" onRetry={() => retry('fund')} />}
        </> },
  };
}

/**
 * One spec per investor Studio key. `lifecycle` and the two records are
 * undefined while loading and null (or a `failures` entry) when they failed.
 */
export function investorTiles({
  user, previewing = false, lifecycle, records = {}, failures = {},
  stages = [], events = [], eventsCoverage = { state: 'ready', failed: [] }, quick, refreshContext, retryLifecycle, retrySources, retrySource = retrySources,
}) {
  const withheld = { state: TILE.WITHHELD };
  if (previewing) {
    return Object.fromEntries(['usage_quota', 'deal_lifecycle', 'quick_stats', 'portfolio_glance', 'upcoming_events', 'fund_commitment', 'needs_you'].map((k) => [k, withheld]));
  }
  return {
    ...commitmentTiles(records, failures, retrySource),
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
