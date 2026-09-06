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
import ZoneActions from '../../workspaces/ZoneActions';
import { investorZoneActions } from '../../workspaces/investorZoneActions';

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
    raw: deal,
  };
}

function Empty({ children }) {
  return <div className="investor-deals-empty">{children}</div>;
}

function SectionHeading({ id, title, detail, actions }) {
  // The Deals bucket's four zones are four SECTIONS of this one page — the
  // router scrolls to `#deals-<slug>` rather than mounting four components — so
  // each zone's action row belongs to its own heading. One row after the
  // ZoneNav would claim to act on whichever section the reader happened to be
  // looking at.
  return (
    <div className="investor-deals-section-head" id={id}>
      <h2>{title}</h2>
      {detail && <span>{detail}</span>}
      {actions?.length ? <ZoneActions className="basis-full" items={actions} /> : null}
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
export default function InvestorDealsWorkspace({ embedded = false }) {
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

  const grouped = useMemo(
    () => Object.fromEntries(STAGES.map((stage) => [stage.id, deals.filter((deal) => deal.stage === stage.id)])),
    [deals],
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

        <section className="investor-deals-card">
          <SectionHeading id="deals-pipeline" title="Pipeline" detail={`${deals.length} live deal${deals.length === 1 ? '' : 's'}`} actions={investorZoneActions('deals/pipeline', { view: { header: ['Deal', 'Stage', 'Sector', 'Target', 'Committed'], rows: deals, cells: (d) => [d.name, d.stage, d.sector, d.target, d.committed] } })} />
          <div className="investor-pipeline-grid">
            {STAGES.map((stage) => (
              <div className="investor-pipeline-column" key={stage.id}>
                <div><span>{stage.label}</span><b>{grouped[stage.id].length}</b></div>
                <div>
                  {grouped[stage.id].length
                    ? grouped[stage.id].map((deal) => <DealCard key={`${deal.id}:${deal.name}`} deal={deal} onOpen={(id) => navigate(`/deals/${id}`)} />)
                    : <Empty>No deals</Empty>}
                </div>
              </div>
            ))}
          </div>
          <p className="investor-deals-note">Pipeline labels translate the existing deal stages for this workspace; no backend stage or record is changed.</p>
        </section>

        <div className="investor-deals-decisions">
          <section className="investor-deals-card investor-screening">
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
          </section>

          <div className="investor-deals-stack">
            <section className="investor-deals-card">
              <SectionHeading id="deals-commit" title="Commit room" detail={commit?.name} actions={investorZoneActions('deals/commit')} />
              {commit ? (
                <dl className="investor-facts compact">
                  <div><dt>Deal status</dt><dd>{commit.raw.status || 'Not recorded'}</dd></div>
                  <div><dt>Total committed to deal</dt><dd>{commit.committed || 'Not recorded'}</dd></div>
                  <div><dt>Target</dt><dd>{commit.target || 'Not recorded'}</dd></div>
                </dl>
              ) : <Empty>No deals are currently at commit.</Empty>}
            </section>
            <section className="investor-deals-card">
              <SectionHeading id="deals-closing" title="Closing" detail={closing?.name} actions={investorZoneActions('deals/closing')} />
              {closing ? (
                <div className="investor-closing-list">
                  <div><CheckCircle2 size={14} /> Deal reached closing <span>Recorded</span></div>
                  <div><Circle size={14} /> Signatures and documents <span>Check deal room</span></div>
                  <div><Circle size={14} /> Wire confirmation <span>Not recorded here</span></div>
                  <button type="button" onClick={() => navigate(`/deals/${closing.id}`)}>Open closing details</button>
                </div>
              ) : <Empty>No deals are currently closing.</Empty>}
            </section>
          </div>
        </div>
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
