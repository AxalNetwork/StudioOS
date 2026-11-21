// D4297 (#4297, D4289 P8) — `/influencers`, the public Influencer program page
// (IN8). D6975 (#6975): it is the programme's presentation, drawn with the program
// presentation kit (`pages/programs/kit.jsx`, boards PGF01 to PGF03): the name, the
// purpose (#6993's sentence), "By application", Download PDF and Print; the availability
// panel with where the visitor stands and the one Apply; then the five sections of
// `pages/programs/content/influencer.js`. `/programs/influencer` resolves here.
//
// Two reads, as before. The tiers (GET /api/influencer/tiers, public) give the panel's earn
// line and section 3's table; they are never typed, and a failed read shows no number. The
// member's standing (GET /api/influencer/me, signed in) decides the panel and whether Apply is
// offered. Signed out, Apply registers for the program and comes back to the sheet
// (`/register?program=influencer&next=/influencers?apply=1`); signed in, it opens the sheet.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuthSync';
import { setSuppressAuthRedirect } from '../../lib/api';
import { influencerProgramApi } from '../../lib/api/influencerProgram';
import { ProgramPanel, ProgramPresentation } from '../programs/kit';
import { programFor } from '../programs/registry';
import CONTENT, { SIGN_IN_TO_APPLY } from '../programs/content/influencer.js';
import ApplySheet, { ApplicationStatus } from './ApplySheet';
import {
  REGISTER_TO_APPLY, SECTION_PATH, STRATEGIC_NOTE, TIERS_UNREAD, hasStrategicTier, rateLine, standing, tierRows,
} from './influencerPublicModel';

const SIGNED_IN_APPLY = '/influencers?apply=1';

function useRead(load, on = true) {
  const [read, setRead] = useState({ status: on ? 'loading' : 'off', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) { setRead({ status: 'off', data: null }); return undefined; }
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    load().then((data) => { if (live) setRead({ status: 'ready', data }); }, (e) => { if (live) setRead({ status: 'error', data: null, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, tick]);
  return [read, () => setTick((t) => t + 1)];
}

/** Section 3's tier table from the read (PGF01, PGF02F): every value the read's, a failed read no number. */
export function tierBlocks(tiers) {
  if (tiers.status === 'error') {
    return [{ type: 'card', title: 'What each tier earns · ⊘ Unavailable', text: `${TIERS_UNREAD} No rate or period is shown until the read succeeds.` }];
  }
  if (tiers.status !== 'ready') return [{ type: 'card', title: 'What each tier earns', text: 'Reading the tiers…' }];
  const list = Array.isArray(tiers.data?.tiers) ? tiers.data.tiers : [];
  return [
    { type: 'card', title: 'What each tier earns · read live', block: { type: 'terms', items: tierRows(list).map((t) => [t.label, `${t.rate} · ${t.duration} · ${t.who}`]) } },
    { type: 'aside', label: 'HQ sets the rates.', text: `Signed terms keep their own until they are replaced.${hasStrategicTier(list) ? ` ${STRATEGIC_NOTE}` : ''}` },
  ];
}

/**
 * The page's content for where the visitor stands: section 3 carries the live tier table, and
 * Next step offers Apply only to someone who may apply (signed out, or signed in with nothing
 * open), never beside an open application or a membership. Pure, for the tests.
 */
export function contentFor({ signedIn, state, tiers }) {
  const sections = CONTENT.sections.map((s) => (s.blocks.some((b) => b.live === 'tiers')
    ? { ...s, blocks: s.blocks.flatMap((b) => (b.live === 'tiers' ? tierBlocks(tiers) : [b])) }
    : s));
  const canApply = !signedIn || state?.kind === 'none';
  const actions = CONTENT.next.actions
    .filter((a) => a.id !== 'apply' || canApply)
    .map((a) => (a.id === 'apply' && signedIn ? { ...a, to: SIGNED_IN_APPLY, note: 'The application opens here: three short steps.' } : a));
  return { ...CONTENT, sections, next: { ...CONTENT.next, actions } };
}

/** PGF02A to PGF02F: the availability panel for where the visitor stands, with the one Apply. */
export function InfluencerPanel({ program, signedIn, me, state, tiers, onApply, onAddDetails }) {
  const earn = rateLine(tiers);
  let body;
  let action = null;
  if (signedIn && me.status === 'error') {
    body = <p className="pgs-coh-msg" data-testid="influencers-me-unread">Your application could not be read just now. That is not the same as having none.</p>;
  } else if (state && ['review', 'more', 'declined'].includes(state.kind)) {
    body = <div className="pgs-coh"><div className="pgs-coh-k">Your application</div><ApplicationStatus state={state} onAddDetails={onAddDetails} /></div>;
  } else if (state?.kind === 'admitted') {
    body = (
      <div className="pgs-coh" data-testid="influencers-membership">
        <div className="pgs-coh-k">Your membership</div>
        <dl>
          <div className="pgs-coh-r"><dt>Tier</dt><dd>{state.tier}</dd></div>
          <div className="pgs-coh-r"><dt>Handle</dt><dd>{state.handle ? `@${state.handle}` : '—'}</dd></div>
        </dl>
      </div>
    );
    action = <Link to={SECTION_PATH} className="ax-btn ax-btn-lg ax-btn-bright" data-testid="influencers-open-section">Open your Influencer section →</Link>;
  } else {
    body = (
      <div className="pgs-coh" data-testid="influencers-how">
        <div className="pgs-coh-k">How it works</div>
        <dl>
          <div className="pgs-coh-r"><dt>To join</dt><dd>Apply · three short steps</dd></div>
          <div className="pgs-coh-r"><dt>Decided by</dt><dd>Axal HQ</dd></div>
          <div className="pgs-coh-r"><dt>What earns</dt><dd>Qualifying software subscriptions</dd></div>
          <div className="pgs-coh-r"><dt>For how long</dt><dd>The period your tier sets</dd></div>
        </dl>
      </div>
    );
    if (!signedIn) {
      action = (
        <>
          <Link to={REGISTER_TO_APPLY} className="ax-btn ax-btn-lg ax-btn-bright" data-testid="influencers-apply">Apply</Link>
          <p className="pgs-panel-fine">Already a member? <Link to={SIGN_IN_TO_APPLY} className="pgs-panel-link" data-testid="influencers-signin">Sign in</Link></p>
        </>
      );
    } else if (state?.kind === 'none') {
      action = <button type="button" className="ax-btn ax-btn-lg ax-btn-bright" onClick={onApply} data-testid="influencers-apply">Apply</button>;
    }
  }
  return (
    <ProgramPanel program={program} action={action}>
      {body}
      {earn && (!state || state.kind === 'none') ? (
        <p className="pgs-coh-msg">
          {tiers.status === 'error' ? <span aria-hidden="true">⊘ </span> : null}
          <span data-testid="influencers-rate-line">{earn}</span>
        </p>
      ) : null}
    </ProgramPanel>
  );
}

export default function InfluencersPage() {
  const program = programFor('influencer');
  const user = useAuth()?.user ?? null;
  const { search, key } = useLocation();
  const [tiers] = useRead(() => influencerProgramApi.tiers());
  const [me, reloadMe] = useRead(() => influencerProgramApi.me(), Boolean(user));
  const [open, setOpen] = useState(false);

  // A public page: an anonymous visitor's background 401s must not bounce it to /login.
  useLayoutEffect(() => { setSuppressAuthRedirect(true); return () => setSuppressAuthRedirect(false); }, []);

  const state = me.status === 'ready' ? standing(me.data) : null;
  // `?apply=1` (back from registering, or Next step's Apply signed in) opens the sheet once per
  // visit to the address, when the member can apply.
  const openedFor = useRef(null);
  useEffect(() => {
    if (openedFor.current === key || new URLSearchParams(search).get('apply') !== '1' || state?.kind !== 'none') return;
    openedFor.current = key;
    setOpen(true);
  }, [search, key, state?.kind]);

  const panel = (
    <InfluencerPanel program={program} signedIn={Boolean(user)} me={me} state={state} tiers={tiers}
      onApply={() => setOpen(true)} onAddDetails={() => setOpen(true)} />
  );

  return (
    <>
      <ProgramPresentation program={program} content={contentFor({ signedIn: Boolean(user), state, tiers })} panel={panel} testId="influencers-presentation" />
      {open && me.status === 'ready' ? (
        <ApplySheet consentVersion={me.data?.consent_version || null} answers={state?.kind === 'more' ? state.answers : null}
          onClose={() => setOpen(false)} onSent={() => { setOpen(false); reloadMe(); }} />
      ) : null}
    </>
  );
}
