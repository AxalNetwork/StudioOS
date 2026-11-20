import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuthSync';
import * as agents from './agentsAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, HonestBlock, MONO, MUTED } from './teamUi.jsx';
import { Comparison, ExtendSkillSheet, History, Marker, ReasonQuote } from './SkillExtension.jsx';
import { actionsFor, bannerWords, compareView, skillHref } from './extensionCompareModel.js';

/**
 * #5964 (D5963, owner Q1 option A) — Team › Skills › Compare with Axal, its own page at
 * `/account/companies/:uid/settings/team/skills/:skillUid/base`.
 *
 * It reads the extension's card (`GET /api/teams/skills/:uid`), its lineage (`GET /api/teams/skills/:uid/base`) and the
 * company's name from the Team library read. Editors see "Edit my draft" and, when Axal has a newer version, "Extend Axal
 * vN again"; members and HQ admins read only (owner Q2 option A). Rebase waits on #5965 and is drawn disabled.
 */

const SECTION = 'rounded-axal-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';

/** The page's states: reading, refused (404), could not be read. */
function PageState({ state, back, onRetry }) {
  if (state === 'loading') return <div aria-busy="true" className={MUTED} data-testid="compare-loading">Reading the comparison…</div>;
  if (state === 'not_found') {
    return (
      <HonestBlock testId="compare-not-found" action={<Link to={back} className={BTN_TEXT}>Back to Team</Link>}>
        There is no such skill. Your company’s editors (Owner, Admin, Founder, primary admin) publish skills.
      </HonestBlock>
    );
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-axal-md border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="compare-unreadable">
      <span><b>The comparison could not be read.</b> Nothing below is a guess. <Link to={back} className="underline">Back to the skill</Link> still works.</span>
      <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} onClick={onRetry} data-testid="compare-retry">Try again</button>
    </div>
  );
}

export default function SkillComparePage() {
  const { uid: companyUid, skillUid } = useParams();
  const navigate = useNavigate();
  const hqAdmin = String(useAuth()?.user?.role || '').toLowerCase() === 'admin';
  const [card, setCard] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [lib, setLib] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setCard(null); setLineage(null);
    agents.skill(skillUid).then((b) => { if (alive) setCard(b); });
    agents.skillBase(skillUid).then((b) => { if (alive) setLineage(b); });
    // The company's name, from the library read the Team tab already uses.
    agents.skillLibrary(companyUid).then((b) => { if (alive) setLib(b); });
    return () => { alive = false; };
  }, [companyUid, skillUid, tick]);
  const back = skillHref(companyUid, skillUid);
  const teamHref = `/account/companies/${encodeURIComponent(companyUid)}/settings/team?tab=skills`;
  const retry = () => setTick((t) => t + 1);

  const companyName = (lib?.available ? lib.value?.company_name : null) || null;
  const crumb = (name) => (
    <nav aria-label="Breadcrumb" className={`${MUTED} flex flex-wrap gap-1`}>
      <Link to={teamHref} className="hover:underline">{companyName ? `${companyName} settings` : 'Settings'} / Team / Skills</Link>
      {name ? <> / <Link to={back} className="hover:underline">{name}</Link></> : null} / <b className="text-axal-ink dark:text-gray-100">Compare with Axal</b>
    </nav>
  );

  let body;
  if (!card || !lineage) body = <PageState state="loading" />;
  // The base read's 404 is the Worker's "There is no such skill" (another company, or a member on an unpublished draft).
  else if (lineage.refused) body = <PageState state="not_found" back={teamHref} />;
  else if (!card.available || !lineage.available || !card.value?.skill) body = <PageState state="unreadable" back={back} onRetry={retry} />;
  else {
    const s = card.value.skill;
    const view = compareView(s, lineage.value.lineage);
    const acts = actionsFor(view, s, { hqAdmin });
    if (view.kind === 'standalone') {
      body = (
        <div className="flex flex-col gap-3" data-testid="compare-standalone">
          <h1 className="m-0 text-[22px] font-extrabold text-axal-ink dark:text-gray-100">{s.name}</h1>
          <span className={MUTED}>{s.scope === 'hq' ? 'From Axal' : 'Your company’s own skill'}{Number.isFinite(s.version) ? ` · v${s.version}` : ''} · {s.status === 'published' ? 'Published' : 'Draft'}</span>
          <HonestBlock action={<Link to={back} className={BTN_TEXT}>Back to the skill</Link>}>This skill is not based on an Axal skill. There is nothing to compare it with.</HonestBlock>
        </div>
      );
    } else {
      const banner = view.kind === 'compare' ? bannerWords(view) : null;
      const mineLabel = view.kind === 'compare' && view.companySide === 'draft' ? 'Your draft · Not published' : `Your v${s.version ?? '?'} · ${s.status === 'published' ? 'Published' : 'Draft'}`;
      body = (
        <div className="flex flex-col gap-4" data-testid="compare-page" data-kind={view.kind}>
          <header className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="m-0 text-[22px] font-extrabold text-axal-ink dark:text-gray-100">{s.name}</h1>
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-axal-ink dark:text-gray-200" data-testid="compare-based-on">
                {view.kind === 'compare'
                  ? <>Based on Axal <b>{view.baseName || 'skill'} v{view.basedOn ?? '?'}</b></>
                  : <>Based on Axal <b>v{view.basedOn ?? '?'}</b> <span className={MUTED}>· Axal’s name could not be read</span></>}
                <span className={`${MONO} rounded-axal-pill border border-axal-hairline px-2 py-0.5 dark:border-gray-700`}>{mineLabel}</span>
                {view.retired ? <span className="rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[12px] text-axal-muted dark:border-gray-700 dark:text-gray-400" data-testid="chip-retired">— Retired by Axal</span> : null}
                {view.suspended ? <span className="rounded-axal-pill border border-amber-300 px-2 py-0.5 text-[12px] text-amber-900 dark:border-amber-700 dark:text-amber-200" data-testid="chip-suspended">❙❙ Suspended by Axal</span> : null}
              </span>
            </div>
            {acts.editor ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="compare-actions">
                <Link to={back} className={BTN_SECONDARY} data-testid="compare-edit-draft">Edit my draft</Link>
                {acts.extendAgain ? (
                  <>
                    <span className="flex flex-col items-start gap-0.5">
                      <button type="button" className={`${BTN_SECONDARY} opacity-60`} aria-disabled="true" aria-describedby="rebase-why" data-testid="compare-rebase">Rebase onto v{acts.extendAgain.version}</button>
                      <span id="rebase-why" className={MUTED}>Not built yet · #5965</span>
                    </span>
                    <button type="button" className={BTN_PRIMARY} aria-disabled={acts.extendAgain.disabled || undefined} aria-describedby={acts.extendAgain.disabled ? 'extend-why' : undefined}
                      onClick={acts.extendAgain.disabled ? undefined : () => setSheet(true)} data-testid="compare-extend-again">
                      Extend Axal v{acts.extendAgain.version} again{acts.extendAgain.disabled ? '' : '…'}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </header>
          {acts.extendAgain?.why ? <p id="extend-why" className="m-0 text-[12.5px] text-amber-900 dark:text-amber-200" data-testid="compare-suspended-why">{acts.extendAgain.why}</p> : null}
          {acts.readOnly === 'hq' ? (
            <div role="note" className="flex flex-col gap-0.5 rounded-axal-md border border-axal-hairline bg-axal-ground/60 px-4 py-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200" data-testid="compare-hq-note">
              <b>Viewing as Axal HQ — read only</b>
              <span>You moderate company skills; you don’t write them. No Extend, Edit or Rebase here.</span>
            </div>
          ) : acts.readOnly === 'member' ? <p className={`m-0 ${MUTED}`} data-testid="compare-member-note">Only your company’s editors can change this skill.</p> : null}
          <ReasonQuote companyName={companyName} reason={view.reason} />
          {view.kind === 'unreadable_base' ? (
            <>
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-axal-md border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="compare-base-unreadable">
                <span className="flex-1"><b>Axal’s version could not be read.</b> So there is no comparison and no update signal. This is not “up to date”. Your own version and history are below.</span>
                <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} onClick={retry}>Try again</button>
              </div>
              <section className={`${SECTION} flex flex-col gap-1 p-4`} data-testid="compare-not-drawn">
                <h2 className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Comparison</h2>
                <p className={`m-0 ${MUTED}`}>Not drawn while Axal’s side can’t be read. Nothing here means “no differences”.</p>
              </section>
            </>
          ) : (
            <>
              {banner.kind === 'update' ? (
                <div role="status" className="flex flex-wrap items-center gap-3 rounded-axal-md border border-axal-lavender-edge bg-axal-lavender px-4 py-3 text-[13px] text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200" data-testid="compare-banner">
                  <span aria-hidden="true" className="font-bold">↑</span>
                  <span className="flex flex-1 flex-col"><b>{banner.head}</b><span>{banner.sub}</span></span>
                  {view.conflicts ? <><Marker k="c" /><span className="font-mono font-bold">{view.conflicts}</span></> : null}
                </div>
              ) : <p className={`m-0 ${MUTED}`} data-testid="compare-banner-quiet">{banner.head}</p>}
              {acts.editor && s.draft_differs ? (
                <p className={`m-0 ${MUTED}`} data-testid="compare-draft-line">Your unpublished draft edits are not in this comparison. <Link to={back} className={BTN_TEXT}>Open my draft</Link></p>
              ) : null}
              <Comparison view={view} card={s} />
            </>
          )}
          <History rows={view.history} />
          {sheet && acts.extendAgain && view.kind === 'compare' ? (
            <ExtendSkillSheet again existingName={s.name}
              base={{ uid: view.baseUid, name: view.baseName, current_version: view.currentVersion, version: acts.extendAgain.version }}
              company={{ uid: companyUid, name: companyName }}
              onClose={() => setSheet(false)}
              onCreated={(made) => { setSheet(false); navigate(made?.uid ? skillHref(companyUid, made.uid) : teamHref); }} />
          ) : null}
        </div>
      );
    }
  }
  const name = card?.available ? card.value?.skill?.name : null;
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-5 sm:px-6" data-testid="skill-compare">
      {crumb(name)}
      {body}
    </div>
  );
}
