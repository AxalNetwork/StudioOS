import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Circle, Database,
  Loader2, RefreshCw, ThumbsDown, ThumbsUp,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { slaBand } from '../../lib/dealFlow';

const STAGES = [
  { id: 'sourcing', label: 'Sourcing' },
  { id: 'screening', label: 'Screening' },
  { id: 'diligence', label: 'Diligence' },
  { id: 'commit', label: 'Commit' },
  { id: 'closing', label: 'Closing' },
];

const money = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `$${Math.round(number / 1_000)}K`;
  return `$${number.toLocaleString()}`;
};

/**
 * THE THREE FIELDS THE PIPELINE FILTERS READ, NAMED WHERE THE DEAL IS SHAPED.
 *
 * The canvas asks this board for `Unassigned`, `Stale` and `Passed`, and the
 * easy answer was that none of them is stored. All three are:
 *
 *   `assigned` — `deals.lead_partner_id`, which the list query already selects
 *                alongside `lead_partner_name`.
 *   `stale`    — `days_in_stage`, computed and returned on every row by the
 *                worker's `enrichDeal`. The threshold is not chosen here:
 *                `slaBand` bands it against the canvas's own SLA presets, so
 *                "sat too long" means one thing across the product. An unknown
 *                age bands to 'ok' rather than red, which is `slaBand`'s own
 *                call — it will not invent urgency the data does not support.
 *   `passed`   — `status === 'rejected'`, which is how the worker records a
 *                pass (`PASSED_STATUS`, written by `POST /api/deals/:id/pass`
 *                with a reason from a CHECKed enum).
 *
 * A PASSED DEAL HAS NO STAGE, and pretending otherwise was already a defect.
 * The `stage` ladder below has no branch for `rejected`, so a passed deal fell
 * through to Commit or Diligence and sat in the funnel as though it were still
 * live — counted in "N live deals" in the section header. It is excluded from
 * the funnel now and reachable through its own filter, where it is shown as a
 * list with its recorded reason rather than as a card under a stage it is not
 * in.
 */
function normalizeDeal(deal) {
  const committed = Number(deal.capital_committed) || 0;
  const stage = deal.status === 'applied'
    ? 'sourcing'
    : deal.status === 'scored'
      ? 'screening'
      : deal.status === 'funded'
        ? 'closing'
        : committed > 0
          ? 'commit'
          : 'diligence';
  return {
    id: deal.id,
    name: deal.project_name || `Deal #${deal.id}`,
    sector: deal.project_sector || null,
    stage,
    source: deal.project_id ? 'Founder-sourced round' : 'Permissioned shared deal',
    target: money(deal.target_raise),
    committed: money(committed),
    assigned: Boolean(deal.lead_partner_id),
    stale: slaBand(deal.days_in_stage) === 'red',
    passed: deal.status === 'rejected',
    passReason: deal.pass_reason || null,
    raw: deal,
  };
}

function Empty({ children }) {
  return <div className="investor-deals-empty">{children}</div>;
}

function SectionHeading({ id, title, detail, filters = [], actions = [] }) {
  // Each zone's row belongs to its own heading. On `/deals/<slug>` the page
  // renders exactly one of these sections, so the row is unambiguous; on the
  // `/deals` root all four stack and each row sits with the section it acts on.
  //
  // `ZoneToolbar` rather than a bare `ZoneActions`: it draws the canvas's own
  // rule under the row and puts the ops half at `ml-auto`, which is the shape
  // every `Pages · …` artboard uses. A section with neither half renders
  // nothing at all, exactly as before.
  return (
    <div className="investor-deals-section-head" id={id}>
      <h2>{title}</h2>
      {detail && <span>{detail}</span>}
      <ZoneToolbar role="investor" className="basis-full" filters={filters} actions={actions} />
    </div>
  );
}

function DealCard({ deal, onOpen }) {
  return (
    <button type="button" className="investor-deal-card" onClick={() => onOpen(deal.id)}>
      <strong>{deal.name}</strong>
      {(deal.sector || deal.target) && <span>{[deal.sector, deal.target].filter(Boolean).join(' · ')}</span>}
      <small><i />{deal.source}</small>
    </button>
  );
}

// `embedded` is set by InvestorDealsRoutes on /deals/{pipeline,screening,
// commit,closing}, where WorkspaceShell is already drawing the heading, the
// zone row and the rail. Without it the page draws a second h1, a second pill
// row and a second rail inside the first — the doubled chrome the user saw.
/**
 * `zone`: which single section this render is for, or null for the bucket root.
 *
 * The four stages are four zone ROUTES, and until now all four rendered the
 * same page and differed only in what `InvestorDealsRoutes` scrolled to. This
 * is the narrowing `InvestorNetworkWorkspace` already does — one component, one
 * `load()`, one set of derivations, one section per route — and it is not a
 * split: every section still derives from the same `api.listDeals` call, so
 * `/deals` stacks all four as the overview and nothing is fetched twice.
 *
 * `known` guards against a slug this page has no section for: an unrecognised
 * zone shows everything rather than nothing, because a blank page is the worse
 * failure and the shell above has already decided the route is legitimate.
 */
export default function InvestorDealsWorkspace({ embedded = false, zone = null }) {
  const known = zone === 'pipeline' || zone === 'screening' || zone === 'commit' || zone === 'closing';
  const shows = (section) => !known || zone === section;
  const navigate = useNavigate();
  const [state, setState] = useState({ deals: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [invitationError, setInvitationError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setInvitationError(false);
    const [dealsResult, invitationsResult] = await Promise.allSettled([
      api.listDeals(undefined, 'mine'),
      api.myDealInvitations(),
    ]);
    if (dealsResult.status === 'rejected') {
      setError('Deal data could not be loaded. Your access has not changed.');
      setLoading(false);
      return;
    }
    setInvitationError(invitationsResult.status === 'rejected');
    setState({
      deals: dealsResult.status === 'fulfilled' && Array.isArray(dealsResult.value)
        ? dealsResult.value.map(normalizeDeal) : [],
      invitations: invitationsResult.status === 'fulfilled' && Array.isArray(invitationsResult.value)
        ? invitationsResult.value : [],
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = 'Deals — axal';
    load().catch((cause) => {
      reportError('InvestorDealsWorkspace:load', cause);
      setError('Deal data could not be loaded. Your access has not changed.');
      setLoading(false);
    });
  }, [load]);

  const deals = state.deals;
  const bucket = bucketForPath('investor', '/deals');

  // The funnel is the deals still in it. Everything the four sections derive —
  // the stage columns, the screening desk, the commit and closing panels — now
  // reads from `funnel`, so a deal the fund has passed on stops appearing as
  // the deal on the desk.
  const funnel = useMemo(() => deals.filter((deal) => !deal.passed), [deals]);
  const grouped = useMemo(
    () => Object.fromEntries(STAGES.map((stage) => [stage.id, funnel.filter((deal) => deal.stage === stage.id)])),
    [funnel],
  );
  const screeningRows = [...grouped.screening, ...grouped.diligence];
  const screening = screeningRows[0] || null;
  const commit = grouped.commit[0] || null;
  const closing = grouped.closing[0] || null;
  const invited = state.invitations.filter((item) => item.status === 'invited');

  const respond = async (invitation, response) => {
    try {
      await api.respondDealInvitation(invitation.deal_id, response);
      setState((current) => ({
        ...current,
        invitations: current.invitations.filter((item) => item.id !== invitation.id),
      }));
    } catch (cause) {
      reportError('InvestorDealsWorkspace:respond', cause);
      setError('The invitation response was not saved. Please try again.');
    }
  };

  if (loading) {
    return <div className="investor-deals-status"><Loader2 className="animate-spin" size={18} /> Loading your deals…</div>;
  }

  if (error && deals.length === 0) {
    return (
      <div className="investor-deals-status investor-deals-error">
        <AlertTriangle size={18} /><span>{error}</span>
        <button type="button" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }

  return (
    <div className="investor-deals-layout" data-testid="investor-deals-i3">
      <div className="investor-deals-main">
        {!embedded && <header className="investor-deals-hero">
          <h1 data-testid="heading-investor-deals">Find and close investments</h1>
          <p>One board, five stages. Each deal remains governed by its existing ownership and permissions.</p>
          {/* Four real links. These were `<a href="#deals-pipeline">` and three
              more: anchors that scrolled the page rather than opening the
              stage routes they name. ZoneNav takes its targets from the shell
              config, so a label can no longer drift from its route. */}
          <ZoneNav bucket={bucket} role="investor" activeSlug={null} className="mt-2.5" />
        </header>}

        {error && <div className="investor-deals-inline-error"><AlertTriangle size={13} />{error}</div>}

        {invited.length > 0 && (
          <section className="investor-deals-card investor-invitations">
            <SectionHeading title="Deal invitations" detail={`${invited.length} awaiting your response`} />
            {invited.map((invitation) => (
              <div className="investor-invitation-row" key={invitation.id}>
                <div><strong>{invitation.project_name || `Deal #${invitation.deal_id}`}</strong>{invitation.message && <span>{invitation.message}</span>}</div>
                <div>
                  <button type="button" onClick={() => navigate(`/deals/${invitation.deal_id}`)}>View</button>
                  <button type="button" onClick={() => respond(invitation, 'interested')}><ThumbsUp size={12} /> Interested</button>
                  <button type="button" onClick={() => respond(invitation, 'passed')}><ThumbsDown size={12} /> Pass</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* THE PIPELINE SECTION MOVED, IT DID NOT GO AWAY. Canvas ID1 draws
            `/deals/pipeline` as a full composition — a four-up strip, a
            six-column instrument with an SLA band per row, the note, and the
            AI band — and `pages/investor/deals/PipelineZone.jsx` is that page.
            `InvestorDealsRoutes` sends the slug there.

            Keeping the card here as well would have mounted the SAME zone row
            twice, which is what `profile_zone_actions.test.mjs` caught: two
            files declaring `deals/pipeline` means two chip rows and two export
            buttons for one route, and whichever rendered second would have
            been the one nobody maintained. */}
        {(shows('screening') || shows('commit') || shows('closing')) && <div className="investor-deals-decisions">
          {shows('screening') && <section className="investor-deals-card investor-screening">
            <SectionHeading id="deals-screening" title="Screening desk" detail={screening?.name} actions={investorZoneActions('deals/screening', { view: { header: ['Deal', 'Stage', 'Sector', 'Target', 'Committed'], rows: screeningRows, cells: (d) => [d.name, d.stage, d.sector, d.target, d.committed] } })} />
            {screening ? (
              <>
                <div className="investor-provenance"><Database size={13} /><strong>{screening.source}</strong><span>Only fields shared with you are shown.</span></div>
                <dl className="investor-facts">
                  <div><dt>Stage</dt><dd>{STAGES.find((stage) => stage.id === screening.stage)?.label}</dd></div>
                  <div><dt>Sector</dt><dd>{screening.sector || 'Not recorded'}</dd></div>
                  <div><dt>Target</dt><dd>{screening.target || 'Not recorded'}</dd></div>
                </dl>
                <button type="button" className="investor-primary-action" onClick={() => navigate(`/deals/${screening.id}`)}>
                  Open deal room <ArrowUpRight size={14} />
                </button>
              </>
            ) : <Empty>No deals are currently in screening or diligence.</Empty>}
          </section>}

          {(shows('commit') || shows('closing')) && <div className="investor-deals-stack">
            {shows('commit') && <section className="investor-deals-card">
              <SectionHeading id="deals-commit" title="Commit room" detail={commit?.name} actions={investorZoneActions('deals/commit')} />
              {commit ? (
                <dl className="investor-facts compact">
                  <div><dt>Deal status</dt><dd>{commit.raw.status || 'Not recorded'}</dd></div>
                  <div><dt>Total committed to deal</dt><dd>{commit.committed || 'Not recorded'}</dd></div>
                  <div><dt>Target</dt><dd>{commit.target || 'Not recorded'}</dd></div>
                </dl>
              ) : <Empty>No deals are currently at commit.</Empty>}
            </section>}
            {shows('closing') && <section className="investor-deals-card">
              <SectionHeading id="deals-closing" title="Closing" detail={closing?.name} actions={investorZoneActions('deals/closing')} />
              {closing ? (
                <div className="investor-closing-list">
                  <div><CheckCircle2 size={14} /> Deal reached closing <span>Recorded</span></div>
                  <div><Circle size={14} /> Signatures and documents <span>Check deal room</span></div>
                  <div><Circle size={14} /> Wire confirmation <span>Not recorded here</span></div>
                  <button type="button" onClick={() => navigate(`/deals/${closing.id}`)}>Open closing details</button>
                </div>
              ) : <Empty>No deals are currently closing.</Empty>}
            </section>}
          </div>}
        </div>}
      </div>

      {!embedded && (
        <WorkerRail
          workspace="Deals"
          role="investor"
          className="investor-ai-rail"
          stance="Manual workspace"
          note="Your pipeline, deal rooms, votes and invitations work without AI. Scores and recommendations appear only when they exist in the live deal record. This view never invents a memo, cost, model, or result."
          coverage={[
            `${deals.length} deal${deals.length === 1 ? '' : 's'} readable`,
            invitationError ? 'Invitations unavailable' : `${invited.length} invitation${invited.length === 1 ? '' : 's'} awaiting you`,
          ]}
          coverageNote="Founder-sourced and shared objects retain their provenance. Existing server access controls remain authoritative."
          unavailable={[
            ['Memos and scoring runs', 'Nothing on this page drafts a memo or produces a score. Open a deal card for its documents, commitments, activity and invitation actions.'],
            // A failed invitations read is named rather than folded into the
            // count above it — deals can be current while invitations are not.
            ...(invitationError
              ? [['Invitations', 'Deals are current, but invitations could not be loaded.']]
              : []),
          ]}
          action={invitationError
            ? <button type="button" onClick={load} data-testid="button-retry-invitations">Retry invitations</button>
            : <Link to="/raise/data-room" data-testid="link-rail-data-rooms">Open shared data rooms <ArrowUpRight size={13} /></Link>}
        />
      )}
    </div>
  );
}
