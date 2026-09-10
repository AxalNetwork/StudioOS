import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight,
  Loader2, RefreshCw, ThumbsDown, ThumbsUp,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import ZoneToolbar from '../../workspaces/ZoneToolbar';

/**
 * WHAT THIS FILE STOPPED DOING, AND WHERE THAT KNOWLEDGE WENT.
 *
 * It used to shape every deal for four decision panels — a stage ladder, an SLA
 * band, a money format, an assigned flag, a pass flag. ID1-ID4 gave each panel
 * its own artboard under `pages/investor/deals/`, and ID4 removed the last
 * consumer: the deals array is now read for its LENGTH alone, once for the
 * error gate and once for the rail's coverage line. Computing eight fields
 * nobody reads is not free and is not honest, so the shaping is gone.
 *
 * None of it lived only here, and the version that survives is the better one:
 *
 *   the stage ladder  -> `dealStage` in `lib/dealFlow.js`. ID1 extracted it so
 *                        four zones could not disagree about where a deal is,
 *                        AND it fixed the defect the ladder here carried:
 *                        `rejected` had no branch, so a passed deal fell
 *                        through to Commit or Diligence and was counted as
 *                        live. `dealStage` returns null for it.
 *   the SLA band      -> `slaBand`, same module, against the canvas's own
 *                        presets, so "sat too long" means one thing product-wide.
 *   the money format  -> `dealMoney` / `dealMoneyExact`, same module.
 *   assigned / passed -> `lead_partner_id` and `status === 'rejected'`, read
 *                        directly by the zone that filters on them.
 *
 * `frontend/test/investor_deals_id1.test.mjs` drives `dealStage` with real rows,
 * so the ladder is tested as behaviour where it lives rather than described here.
 */


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
        ? dealsResult.value : [],
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

  // NO PANELS LEFT, SO NO GROUPING. `funnel` and `grouped` existed to feed the
  // four decision panels; ID4 took the last of them, and the deals array is now
  // read for its LENGTH alone — once for the error gate, once for the rail's
  // coverage line. `check-unused-imports` catches the imports that died with
  // them; it does not see plain locals (task #156), so these went by hand.
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
        {/* AND THE LAST ONE WENT WITH ID4. `/deals/closing` is
            `pages/investor/deals/ClosingZone.jsx` now. What stood here was
            three hard-coded rows — a tick and two circles — that read the same
            on every deal at closing, one of which said wire confirmation was
            "Not recorded here". ID4 reads the signature envelopes instead and
            says where the record actually stops.

            All four decision panels are gone. This file now draws only what no
            artboard does: the deal-invitation queue above. */}
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
