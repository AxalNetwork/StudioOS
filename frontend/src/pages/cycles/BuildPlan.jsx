import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../lib/api/cycles';
import { buildPlanApi } from '../../lib/api/buildPlan';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import { railPressHeaders } from '../../lib/railPage';
import useAiSpend from '../../hooks/useAiSpend';
import { useRailOption } from '../../ui/railCrumbs';
import RunEstimate from '../../workspaces/RunEstimate';
import { Unreadable } from '../../ui';
import { adaptOverview } from './adapters';
import { CycleCard, CycleHeader } from './CycleOverview';
import { CycleBar } from './PhoneModulePage';
import {
  DISCARD, DOOR_LINE, FOUNDING_TEAM_LINE, KEEP, LINE, NOTHING_PENDING, NOT_YET, NO_PLAN, PLAN_TABS, PLAN_WAIT, PROGRESS_WAIT, SECTIONS, TITLE,
  WORDING_TAG, WORD_COST, WORD_LABEL, WORD_LINE, WORD_OPTION, WORD_READS, planHref, planSearch, provedCards, wordRefusal, wordingRows,
} from './buildPlanModel';

/**
 * D1063 (#2426) — Build's plan at `/build/plan` and its Progress tab at
 * `/build/plan/progress`. `CycleRoute` draws it under Build's header and tab
 * row. "What Validate proved" is the Validate overview's own cards; each
 * module's section and Progress say what they wait for (`buildPlanModel.js`).
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

/** The plan's own tabs, a second level under Build's: text with an underline, each a literal link. */
export function PlanTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="plan-tabs">
      <nav aria-label="Plan" className="-mb-px flex gap-1 overflow-x-auto">
        {PLAN_TABS.map((t) => (
          <Link key={t.id} to={planHref(t.id, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`plan-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The Build overview's door to the plan (VB2's right panel). */
export function BuildPlanDoor({ search = '' }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-axal-lavender-edge bg-axal-lavender px-[18px] py-3 dark:border-violet-800 dark:bg-violet-900/30" data-testid="build-plan-door">
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{DOOR_LINE}</p>
      <Link to={`/build/plan${planSearch(search)}`} className={LINK}>Open the plan</Link>
    </section>
  );
}

/** "What Validate proved": the Validate overview's cards for the four modules the plan rests on. */
function Proved({ projectId, search }) {
  const [state, setState] = useState({ status: 'loading', cards: [] });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', cards: [] });
    cyclesApi.overview('validate', projectId)
      .then((data) => { if (alive) setState({ status: 'ready', cards: provedCards(adaptOverview('validate', data)) }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', cards: [] }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return (
    <aside className="flex min-w-0 flex-col gap-3" aria-label="What Validate proved" data-testid="plan-proved">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">What Validate proved</span>
      {state.status === 'unreadable'
        ? <Unreadable what="Validate" claim="This is not a claim that nothing was proved." onRetry={() => setReload((n) => n + 1)} />
        : state.status === 'loading'
          ? <div className="h-[92px] rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-busy="true" data-testid="plan-proved-loading" />
          : state.cards.map((c) => <CycleCard key={c.slug} cycle="validate" card={c} search={search} />)}
    </aside>
  );
}

const LAVENDER = 'flex min-w-0 flex-col gap-1.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2.5 dark:border-violet-800 dark:bg-violet-900/30';
const TAG = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-violet-deep dark:text-violet-300';
const BTN = 'rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN_P = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';

/** Eadwyn's wording of one thing, in lavender, with Keep and Discard. */
function Wording({ id, rule, children, onKeep, onDiscard, busy }) {
  return (
    <div className={LAVENDER} data-testid={`plan-wording-${id}`}>
      <span className={TAG}>{WORDING_TAG}</span>
      {children}
      {rule ? <p className={MUTED} data-testid={`plan-wording-rule-${id}`}>Rule’s title: {rule}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_P} disabled={busy} onClick={onKeep} data-testid={`plan-wording-keep-${id}`}>{KEEP}</button>
        <button type="button" className={BTN} disabled={busy} onClick={onDiscard} data-testid={`plan-wording-discard-${id}`}>{DISCARD}</button>
      </div>
    </div>
  );
}

/**
 * VB5 (D1071): the brief and the pending items with Eadwyn's wording beside
 * each rule's title. Part 6's item cards fold this in when they land. A press
 * runs once; the wording is kept only by Keep wording (an item's Save).
 */
export function PlanWording({ projectId }) {
  const [state, setState] = useState({ status: 'loading', plan: null, wording: null });
  const [reload, setReload] = useState(0);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const ai = useAiSpend();
  useRailOption(running ? 'draft:build/plan' : null, 'Word with Eadwyn');
  useEffect(() => {
    let alive = true;
    Promise.all([buildPlanApi.read(projectId), buildPlanApi.wording(projectId)])
      .then(([plan, w]) => { if (alive) setState({ status: 'ready', plan, wording: w?.wording || null }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', plan: null, wording: null }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  const press = async () => {
    setRunning(true); setRefusal(null);
    try {
      const r = await buildPlanApi.word(projectId, 'venture', railPressHeaders(WORD_OPTION));
      setState((s) => ({ ...s, wording: r?.wording || null }));
      ai.reload?.();
    } catch (e) {
      setRefusal(wordRefusal(e));
    } finally { setRunning(false); }
  };
  const act = useCallback(async (key, run) => {
    setBusy(key); setRefusal(null);
    try { await run(); setReload((n) => n + 1); } catch (e) { setRefusal(wordRefusal(e)); } finally { setBusy(null); }
  }, []);

  if (state.status === 'loading') return <div className="h-[92px] rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-busy="true" data-testid="plan-wording-loading" />;
  if (state.status === 'unreadable') return <Unreadable what="The plan" claim="This is not a claim that there is nothing to word." onRetry={() => setReload((n) => n + 1)} />;
  const { plan, wording } = state;
  const rows = wordingRows(plan, wording);
  const w = wording;
  const keepItem = (uid) => act(uid, () => buildPlanApi.edit(uid, undefined, w.uid));
  const discard = (target) => act(target, () => buildPlanApi.discardWording(projectId, w.uid, target));
  const keep = (target) => act(target, () => buildPlanApi.keepWording(projectId, w.uid, target));
  const summary = w?.kept?.brief?.summary;
  return (
    <section className={CARD} aria-label="Word the plan" data-testid="plan-wording">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className={H2}>{WORD_LABEL}</h2>
          <p className={MUTED}>{WORD_LINE}</p>
        </div>
        {plan?.plan && rows.length
          ? <button type="button" className={BTN_P} disabled={running} onClick={press} data-testid="plan-word">{running ? 'Wording…' : WORD_LABEL}</button>
          : null}
      </div>
      {plan?.plan && rows.length ? <RunEstimate ai={ai} task="rail_write" shared="other rail drafts" testId="plan-word-estimate" /> : null}
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Reads</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{WORD_READS}</dd>
        <dt className="font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Cost</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{WORD_COST}</dd>
      </dl>
      {refusal ? (
        <div role="alert" className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-800" data-testid={`plan-word-refused-${refusal.kind}`}>
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{refusal.text}</p>
          {refusal.sub ? <p className={MUTED}>{refusal.sub}</p> : null}
          {refusal.kind === 'tokens' ? <Link to={ADD_TOKENS_PATH} className={LINK} data-testid="plan-word-topup">Top up AI tokens</Link> : null}
        </div>
      ) : null}
      {!plan?.plan ? <p className={MUTED} data-testid="plan-wording-no-plan">{NO_PLAN}</p>
        : !rows.length ? <p className={MUTED} data-testid="plan-wording-none">{NOTHING_PENDING}</p> : null}
      {w?.removed ? <p className={MUTED} data-testid="plan-wording-removed">{w.removed === 1 ? 'One worded field held a number, a name or a link, so it was not kept.' : `${w.removed} worded fields held a number, a name or a link, so they were not kept.`}</p> : null}
      {summary ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="plan-brief-kept">Brief: {summary}</p> : null}
      {w?.kept?.prompt ? <p className={MUTED} data-testid="plan-prompt-kept">Lovable prompt kept. Sending it to Lovable is part 5.</p> : null}
      {w?.brief ? (
        <Wording id="brief" busy={busy === 'brief'} onKeep={() => keep('brief')} onDiscard={() => discard('brief')}>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Brief: {w.brief.summary}</p>
        </Wording>
      ) : null}
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="plan-wording-items">
          {rows.map((r) => (
            <li key={r.uid} className="flex min-w-0 flex-col gap-1.5" data-testid={`plan-wording-item-${r.uid}`}>
              <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{r.module}</span>
              {r.words ? (
                <Wording id={r.uid} rule={r.title} busy={busy === r.uid} onKeep={() => keepItem(r.uid)} onDiscard={() => discard(r.uid)}>
                  {r.words.title ? <p className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{r.words.title}</p> : null}
                  {r.words.description ? <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100">{r.words.description}</p> : null}
                </Wording>
              ) : <p className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{r.title}</p>}
            </li>
          ))}
        </ul>
      ) : null}
      {w?.lovable_prompt ? (
        <Wording id="prompt" busy={busy === 'prompt'} onKeep={() => keep('prompt')} onDiscard={() => discard('prompt')}>
          <p className="m-0 whitespace-pre-wrap font-mono text-[12px] text-axal-ink dark:text-gray-100">{w.lovable_prompt}</p>
        </Wording>
      ) : null}
    </section>
  );
}

function Section({ s }) {
  return (
    <section className={CARD} data-testid={`plan-section-${s.slug}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>{s.name}</h2>
        <span className={PILL}>{NOT_YET}</span>
      </div>
      <p className={MUTED}>Proposes {s.kinds}.</p>
    </section>
  );
}

export default function BuildPlan({ tab = 'plan', projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const s = planSearch(search);
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <p className={MUTED} aria-busy="true" data-testid="plan-loading">Loading…</p>;
  else if (tab === 'progress') {
    body = (
      <section className={CARD} data-testid="plan-progress">
        <h2 className={H2}>Plan items by stage</h2>
        <span className={PILL}>{NOT_YET}</span>
        <p className={MUTED}>{PROGRESS_WAIT}</p>
      </section>
    );
  } else {
    body = (
      <div className="grid min-w-0 grid-cols-1 items-start gap-[14px] lg:grid-cols-[300px_minmax(0,1fr)]" data-testid="plan-body">
        <Proved projectId={projectId} search={s} />
        <div className="flex min-w-0 flex-col gap-[14px]">
          <p className={MUTED} data-testid="plan-wait">{PLAN_WAIT}</p>
          <PlanWording projectId={projectId} />
          {SECTIONS.map((sec) => <Section key={sec.slug} s={sec} />)}
          <p className={MUTED} data-testid="plan-founding-team">{FOUNDING_TEAM_LINE}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`build-plan-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: 'Build', to: `/build${s}` }} title={TITLE} eadwynLabel={`Build · ${TITLE}`} />
        : <CycleHeader cycle="build" cards={cards} active="plan" action={action} title={TITLE} sub={LINE} search={s} />}
      <PlanTabBar active={tab} search={s} />
      {body}
    </div>
  );
}
