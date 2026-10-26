import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
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
  DISCARD, DISMISS_BODY, DOOR_LINE, EMPTY_LINE, EMPTY_TITLE, FOUNDING_TEAM_LINE, KEEP, LINE, NOTHING_PENDING, NOT_YOURS, NOT_YOURS_LINE, NO_PLAN,
  PAUSED_BY_YOU, PAUSE_BODY, PLAN_TABS, READ_ONLY_LINE, READ_ONLY_NOTE, RESUME_BODY, SECTIONS, SINCE_FOOT, TITLE, UNPREPARED_LINE, UPDATE_BODY,
  WORDING_TAG, WORD_COST, WORD_LABEL, WORD_LINE, WORD_OPTION, WORD_READS, acceptAllLine, countsLine, isDecided, moduleItems, planCounts, planHref, planScope,
  planSearch, preparedLine, provedCards, sinceLine, ventureSearch, verdictState, wordRefusal, wordingRows, writeRefusal,
} from './buildPlanModel';
import { BriefCard, DoneRow, EditDialog, PlanConfirm, ProposalCard } from './BuildPlanCards';
import PlanProgress from './BuildPlanProgress';
import SendSheet from './BuildPlanSend';
import { NOT_FOUNDER_LINE, NOT_FOUNDER_ROLES, NOT_FOUNDER_TITLE, OP_LINE, OP_PILL, OP_TITLE, sendable } from './buildProgressModel';

/**
 * D1063 (#2426) — Build's plan at `/build/plan` and its Progress tab at
 * `/build/plan/progress`. `CycleRoute` draws it under Build's header and tab
 * row. "What Validate proved" is the Validate overview's own cards; each
 * module's section and Progress say what they wait for (`buildPlanModel.js`).
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

/** The plan's own tabs, a second level under Build's: text with an underline, each a literal link. An Operating Partner has Progress only (VB15). */
export function PlanTabBar({ active, search = '', only = null }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="plan-tabs">
      <nav aria-label="Plan" className="-mb-px flex gap-1 overflow-x-auto">
        {PLAN_TABS.filter((t) => !only || t.id === only).map((t) => (
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
 * The plan's reads, once for the page (D1069): the plan (D1065), Eadwyn's
 * pending wording (D1071; a founder's only, so an admin never asks) and new
 * evidence since the plan (D1067). Only the plan's own read can blank the
 * board; a failed wording or "since" read is its own block.
 */
export function usePlanBoard(projectId, scope = 'venture', { readOnly = false } = {}) {
  const [state, setState] = useState({ status: 'loading', plan: null, wording: null, wordingStatus: 'loading', since: null, sinceStatus: 'loading' });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }));
    const wording = readOnly ? Promise.resolve({ wording: null }) : buildPlanApi.wording(projectId, scope);
    Promise.allSettled([buildPlanApi.read(projectId, scope), wording, buildPlanApi.since(projectId, scope)]).then(([p, w, n]) => {
      if (!alive) return;
      if (p.status === 'rejected') {
        const refused = Number(p.reason?.status) === 404;
        setState({ status: refused ? 'refused' : 'unreadable', plan: null, wording: null, wordingStatus: 'ready', since: null, sinceStatus: 'ready' });
        return;
      }
      setState({
        status: 'ready', plan: p.value,
        wording: w.status === 'fulfilled' ? w.value?.wording || null : null, wordingStatus: w.status === 'fulfilled' ? 'ready' : 'unreadable',
        since: n.status === 'fulfilled' ? n.value : null, sinceStatus: n.status === 'fulfilled' ? 'ready' : 'unreadable',
      });
    });
    return () => { alive = false; };
  }, [projectId, scope, readOnly, reload]);
  const setWording = useCallback((wording) => setState((s) => ({ ...s, wording, wordingStatus: 'ready' })), []);
  const again = useCallback(() => setReload((n) => n + 1), []);
  return { ...state, setWording, reload: again };
}

/**
 * VB5 (D1071): "Word with Eadwyn", its cost and what it reads. A press runs
 * once; the wording is kept only by Keep wording (an item's Save). On the
 * plan (D1069) the page's board is handed in and the item cards carry the
 * wording (`inCards`); standalone, it reads the plan itself and lists the
 * pending items with the wording beside each rule's title.
 */
export function PlanWording({ projectId, scope = 'venture', board = null }) {
  const own = usePlanBoard(board ? null : projectId, scope);
  const b = board || own;
  const inCards = Boolean(board);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const ai = useAiSpend();
  useRailOption(running ? 'draft:build/plan' : null, 'Word with Eadwyn');
  const press = async () => {
    setRunning(true); setRefusal(null);
    try {
      const r = await buildPlanApi.word(projectId, scope, railPressHeaders(WORD_OPTION));
      b.setWording(r?.wording || null);
      ai.reload?.();
    } catch (e) {
      setRefusal(wordRefusal(e));
    } finally { setRunning(false); }
  };
  const act = async (key, run) => {
    setBusy(key); setRefusal(null);
    try { await run(); b.reload(); } catch (e) { setRefusal(wordRefusal(e)); } finally { setBusy(null); }
  };

  if (b.status === 'loading') return <div className="h-[92px] rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-busy="true" data-testid="plan-wording-loading" />;
  if (b.status === 'unreadable' || b.status === 'refused') return <Unreadable what="The plan" claim="This is not a claim that there is nothing to word." onRetry={b.reload} />;
  const plan = b.plan;
  const w = b.wording;
  const rows = wordingRows(plan, w);
  const keepItem = (uid) => act(uid, () => buildPlanApi.edit(uid, undefined, w.uid));
  const discard = (target) => act(target, () => buildPlanApi.discardWording(projectId, w.uid, target, scope));
  const keep = (target) => act(target, () => buildPlanApi.keepWording(projectId, w.uid, target, scope));
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
      {b.wordingStatus === 'unreadable' ? <Unreadable what="Eadwyn’s wording" claim="This is not a claim that there is none." onRetry={b.reload} /> : null}
      {!plan?.plan ? <p className={MUTED} data-testid="plan-wording-no-plan">{NO_PLAN}</p>
        : !rows.length ? <p className={MUTED} data-testid="plan-wording-none">{NOTHING_PENDING}</p> : null}
      {w?.removed ? <p className={MUTED} data-testid="plan-wording-removed">{w.removed === 1 ? 'One worded field held a number, a name or a link, so it was not kept.' : `${w.removed} worded fields held a number, a name or a link, so they were not kept.`}</p> : null}
      {summary && !inCards ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="plan-brief-kept">Brief: {summary}</p> : null}
      {w?.kept?.prompt ? <p className={MUTED} data-testid="plan-prompt-kept">Lovable prompt kept. Sending it to Lovable is part 5.</p> : null}
      {w?.brief && !inCards ? (
        <Wording id="brief" busy={busy === 'brief'} onKeep={() => keep('brief')} onDiscard={() => discard('brief')}>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Brief: {w.brief.summary}</p>
        </Wording>
      ) : null}
      {rows.length && !inCards ? (
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

const NOTE = 'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-[13px] font-semibold leading-[1.5]';
const NOTE_TONE = {
  v: 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-800 dark:bg-violet-900/30 dark:text-gray-100',
  a: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  n: 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
};
function Note({ tone = 'v', testId, children, action = null }) {
  return (
    <div className={`${NOTE} ${NOTE_TONE[tone]}`} data-testid={testId}>
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
      {action}
    </div>
  );
}
const SKEL = 'h-3 rounded-md bg-axal-ground dark:bg-gray-800';

/** VB18: the strip and each module reading, under a header and tabs drawn at once. */
function BoardLoading() {
  return (
    <div className="flex min-w-0 flex-col gap-[14px]" aria-busy="true" data-testid="plan-board-loading">
      {[0, 1, 2].map((n) => (
        <div key={n} className={CARD}>
          <span className="text-[13px] font-semibold text-axal-muted dark:text-gray-400">Reading…</span>
          {['w-[92%]', 'w-[74%]', 'w-[86%]'].map((w) => <span key={w} className={`${SKEL} ${w}`} />)}
        </div>
      ))}
    </div>
  );
}

/** VB1's strip: the Spin-Out Lab pill (VB20b), the Verdict it came from (founders), when it was prepared, and the counts. */
function Strip({ plan, verdict, readOnly, lab, counts, tools }) {
  const v = verdictState(verdict);
  return (
    <section className={`${CARD} !flex-row flex-wrap items-center justify-between !gap-2.5 !py-2.5`} data-testid="plan-strip">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {lab ? <span className="rounded-full border border-axal-lavender-edge bg-axal-lavender px-2.5 py-px text-[11px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300" data-testid="plan-strip-lab">◆ Spin-Out Lab venture</span> : null}
        {!readOnly && v.kind === 'given' ? <span className="rounded-full border border-axal-lavender-edge bg-axal-lavender px-2.5 py-px font-mono text-[11px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300" data-testid="plan-strip-verdict">◆ {v.strip}</span> : null}
        {plan?.plan ? <span className="font-mono text-[11.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="plan-strip-prepared">{preparedLine(plan.plan)}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {plan?.plan ? <span className="font-mono text-[12.5px] font-bold text-axal-ink dark:text-gray-100" data-testid="plan-strip-counts">{countsLine(counts)}</span> : null}
        {tools}
      </div>
    </section>
  );
}

/** One Build module's proposals (VB1), or an accordion of them on a phone (VB21). */
function ModuleSection({ s, plan, words, readOnly, paused, phone, search, open, onToggle, busy, errors, said, onAccept, onEdit, onDismiss, onAcceptAll, onKeep, onDiscardWording, onRetry, briefSlot }) {
  const items = moduleItems(plan, s.slug);
  const pending = items.filter((i) => i.status === 'proposed').length;
  const head = `${s.name} · ${pending} proposed`;
  const body = (
    <div className="grid min-w-0 grid-cols-1 items-start gap-[14px] lg:grid-cols-2">
      {briefSlot}
      {s.slug === 'company-creation' && items.length ? <p className={`${MUTED} lg:col-span-2`}>Proposed because no company is linked to this venture.</p> : null}
      {s.slug === 'operating-systems' && items.length ? <p className={`${MUTED} lg:col-span-2`}>Connect your own tools so what you build comes back linked. Connecting is never done for you.</p> : null}
      {!items.length ? <p className={`${MUTED} lg:col-span-2`} data-testid={`plan-section-none-${s.slug}`}>Your accepted evidence proposes nothing here yet.</p> : null}
      {items.map((i) => (isDecided(i) || i.status === 'discarded'
        ? <div key={i.uid} className="lg:col-span-2"><DoneRow item={i} module={s.slug} search={search} readOnly={readOnly} /></div>
        : <ProposalCard key={i.uid} item={i} phone={phone} readOnly={readOnly} paused={paused} busy={busy === i.uid} error={errors[i.uid] || ''}
          words={i.status === 'proposed' ? words?.[i.uid] || null : null}
          onAccept={() => onAccept(i, s.slug)} onEdit={() => onEdit(i, s.slug)} onDismiss={() => onDismiss(i, s.slug)}
          onKeep={() => onKeep(i)} onDiscard={() => onDiscardWording(i)} onRetry={() => onRetry(i, s.slug)} />))}
      {said ? <p className={`${MUTED} lg:col-span-2`} role="status" data-testid={`plan-section-said-${s.slug}`}>{said}</p> : null}
    </div>
  );
  const all = !readOnly && !paused && pending > 0
    ? <button type="button" className={`${BTN} ${phone ? 'min-h-[44px]' : ''}`} disabled={Boolean(busy)} onClick={() => onAcceptAll(s, pending)} data-testid={`plan-accept-all-${s.slug}`}>Accept all in {s.name}</button>
    : null;
  if (phone) {
    return (
      <section className={`${CARD} !px-3.5 !py-0.5`} data-testid={`plan-section-${s.slug}`}>
        <button type="button" className="flex min-h-[48px] w-full items-center gap-2.5 text-left" aria-expanded={open} onClick={onToggle} data-testid={`plan-section-toggle-${s.slug}`}>
          <span aria-hidden="true" className="text-[16px] text-axal-muted">{open ? '▾' : '›'}</span>
          <span className="flex-1 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{s.name}</span>
          <span className="font-mono text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">{pending} proposed</span>
        </button>
        {open ? <div className="flex flex-col gap-3 pb-3.5">{all}{body}</div> : null}
      </section>
    );
  }
  return (
    <section className="flex min-w-0 flex-col gap-2.5 pt-2" data-testid={`plan-section-${s.slug}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-[16px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{head}</h2>
        {all}
      </div>
      {body}
    </section>
  );
}

/**
 * VB1–VB4, VB13, VB14, VB16–VB21 (D1069): the plan as its founder decides it.
 * Every count is the read's own; a write's refusal is said in its card or its
 * dialog; nothing lands until Accept.
 */
export function PlanBoard({ projectId, scope = 'venture', search = '', readOnly = false, lab = false, phone = false }) {
  const b = usePlanBoard(projectId, scope, { readOnly });
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [said, setSaid] = useState({});
  const [dialog, setDialog] = useState(null);
  const [open, setOpen] = useState(() => new Set([SECTIONS[0].slug]));
  const [empty, setEmpty] = useState(false);
  const [wordBusy, setWordBusy] = useState(null);

  const accept = async (item, slug, edit) => {
    setBusy(item.uid); setErrors((e) => ({ ...e, [item.uid]: '' }));
    try { await buildPlanApi.accept(item.uid, edit || undefined); b.reload(); } catch (e) {
      setErrors((x) => ({ ...x, [item.uid]: writeRefusal(e, slug) }));
    } finally { setBusy(null); }
  };
  const wordAct = async (key, run) => {
    setWordBusy(key);
    try { await run(); b.reload(); } catch (e) { setErrors((x) => ({ ...x, [key]: wordRefusal(e).text })); } finally { setWordBusy(null); }
  };
  const done = () => { setDialog(null); b.reload(); };

  let strip = null, content;
  if (b.status === 'loading') {
    strip = <section className={`${CARD} !py-2.5`} data-testid="plan-strip-reading"><span className="font-mono text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Reading…</span></section>;
    content = <BoardLoading />;
  } else if (b.status === 'unreadable') content = <Unreadable what="The plan" claim="This is not a claim that there is nothing to build." onRetry={b.reload} />;
  else if (b.status === 'ready') {
    const plan = b.plan;
    const v = verdictState(plan?.verdict);
    const status = plan?.plan?.status || null;
    const paused = status === 'paused';
    const counts = planCounts(plan);
    const since = sinceLine(b.since);
    const prepare = () => setDialog({ kind: 'prepare' });
    const notes = [];
    if (readOnly) notes.push(<Note key="ro" tone="v" testId="plan-read-only"><span>{READ_ONLY_LINE}</span><span className="font-medium">{READ_ONLY_NOTE}</span></Note>);
    if (v.kind === 'stop') notes.push(<Note key="stop" tone="n" testId="plan-verdict-stop"><span>‖ {v.line}</span><span className="font-medium">{v.sub}</span></Note>);
    else if (v.kind === 'withheld') {
      notes.push(<Note key="withheld" tone="a" testId="plan-verdict-withheld"
        action={!readOnly && !plan?.plan ? <button type="button" className={BTN} onClick={prepare} data-testid="plan-anyway">Plan anyway</button> : null}>
        <span>! {v.line}</span>
      </Note>);
    }
    if (paused && v.kind !== 'stop') {
      notes.push(<Note key="paused" tone="n" testId="plan-paused"
        action={readOnly ? null : <button type="button" className={BTN} onClick={() => setDialog({ kind: 'resume' })} data-testid="plan-resume">Resume the plan</button>}>
        <span>‖ {PAUSED_BY_YOU}</span>
      </Note>);
    }
    if (since && plan?.plan) {
      notes.push(<Note key="since" tone="v" testId="plan-since"
        action={readOnly || paused ? null : <button type="button" className={BTN} onClick={() => setDialog({ kind: 'update' })} data-testid="plan-since-update">Update the plan</button>}>
        <span>{since}</span><span className="font-medium">{SINCE_FOOT}</span>
      </Note>);
    } else if (b.sinceStatus === 'unreadable' && plan?.plan) {
      notes.push(<Unreadable key="since-down" what="New evidence since the plan" claim="This is not a claim that there is none." onRetry={b.reload} />);
    }
    const toSend = sendable(plan);
    const tools = !readOnly && plan?.plan && v.kind !== 'stop' ? (
      <span className="flex flex-wrap gap-1.5" data-testid="plan-tools">
        {!paused ? <button type="button" className={BTN_P} onClick={() => setDialog({ kind: 'send', items: toSend })} data-testid="plan-send-door">Send to…{toSend.length ? ` · ${toSend.length}` : ''}</button> : null}
        {!paused ? <button type="button" className={BTN} onClick={() => setDialog({ kind: 'update' })} data-testid="plan-update">Update the plan</button> : null}
        {!paused ? <button type="button" className={BTN} onClick={() => setDialog({ kind: 'pause' })} data-testid="plan-pause">Pause the plan</button> : null}
      </span>
    ) : null;
    let sections;
    if (!plan?.plan) {
      // VB17, or a plan not prepared yet (or not preparable: Stop, VB14b).
      sections = empty ? (
        <section className={`${CARD} items-center !py-8 text-center`} data-testid="plan-empty">
          <span aria-hidden="true" className="text-[22px] text-axal-muted">○</span>
          <h2 className={H2}>{EMPTY_TITLE}</h2>
          <p className={MUTED}>{EMPTY_LINE}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to={`/validate/customer-research${ventureSearch(search)}`} className={BTN_P}>Record a session</Link>
            <Link to={`/validate${ventureSearch(search)}`} className={BTN}>Open Validate</Link>
          </div>
        </section>
      ) : v.kind === 'stop' || v.kind === 'withheld' ? null : (
        <section className={CARD} data-testid="plan-unprepared">
          <p className={MUTED}>{UNPREPARED_LINE}</p>
          {!readOnly ? <button type="button" className={`${BTN_P} w-fit`} onClick={prepare} data-testid="plan-prepare">Prepare the plan</button> : null}
        </section>
      );
    } else {
      const briefWords = b.wording?.brief || null;
      sections = SECTIONS.map((sec) => (
        <ModuleSection key={sec.slug} s={sec} plan={plan} words={b.wording?.items} readOnly={readOnly} paused={paused} phone={phone} search={ventureSearch(search)}
          open={open.has(sec.slug)} onToggle={() => setOpen((o) => { const n = new Set(o); if (n.has(sec.slug)) n.delete(sec.slug); else n.add(sec.slug); return n; })}
          busy={busy} errors={errors} said={said[sec.slug]}
          onAccept={(i, slug) => accept(i, slug)} onRetry={(i, slug) => accept(i, slug)}
          onEdit={(i, slug) => setDialog({ kind: 'edit', item: i, slug })}
          onDismiss={(i, slug) => setDialog({ kind: 'dismiss', item: i, slug })}
          onAcceptAll={(m, n) => setDialog({ kind: 'all', module: m, n })}
          onKeep={(i) => wordAct(i.uid, () => buildPlanApi.edit(i.uid, undefined, b.wording.uid))}
          onDiscardWording={(i) => wordAct(i.uid, () => buildPlanApi.discardWording(projectId, b.wording.uid, i.uid, scope))}
          briefSlot={sec.slug === 'solution-design' ? (
            <BriefCard brief={plan.brief} words={briefWords} kept={b.wording?.kept?.brief?.summary || null} readOnly={readOnly} phone={phone} busy={wordBusy === 'brief'}
              onKeep={() => wordAct('brief', () => buildPlanApi.keepWording(projectId, b.wording.uid, 'brief', scope))}
              onDiscard={() => wordAct('brief', () => buildPlanApi.discardWording(projectId, b.wording.uid, 'brief', scope))} />
          ) : null} />
      ));
    }
    content = (
      <div className="flex min-w-0 flex-col gap-[14px]" data-testid="plan-board">
        {notes}
        {!readOnly && plan?.plan && !paused ? <PlanWording projectId={projectId} scope={scope} board={b} /> : null}
        {sections}
        {plan?.plan ? <p className={MUTED} data-testid="plan-founding-team">{FOUNDING_TEAM_LINE}</p> : null}
      </div>
    );
    strip = <Strip plan={plan} verdict={plan?.verdict} readOnly={readOnly} lab={lab} counts={counts} tools={tools} />;
  }

  const dialogs = dialog ? (
    dialog.kind === 'send' ? <SendSheet projectId={projectId} scope={scope} items={dialog.items} onClose={() => setDialog(null)} />
      : dialog.kind === 'edit' ? <EditDialog item={dialog.item} module={dialog.slug} accept={(uid, edit) => buildPlanApi.accept(uid, edit || undefined)} onClose={() => setDialog(null)} onDone={done} />
      : dialog.kind === 'dismiss' ? <PlanConfirm testId="plan-dismiss" title={`Dismiss ${String(dialog.item.payload?.title ?? 'this item')}?`} body={DISMISS_BODY} button="Dismiss" danger slug={dialog.slug}
        run={() => buildPlanApi.dismiss(dialog.item.uid)} onClose={() => setDialog(null)} onDone={done} />
      : dialog.kind === 'all' ? <PlanConfirm testId="plan-accept-all" title={`Accept all in ${dialog.module.name}?`} slug={dialog.module.slug}
        body={`This accepts the ${dialog.n} ${dialog.n === 1 ? 'proposal' : 'proposals'} waiting in ${dialog.module.name}, each with its evidence. Each lands in its own place, and one refused item does not stop the others.`}
        button={`Accept ${dialog.n}`} run={() => buildPlanApi.acceptModule(projectId, dialog.module.slug, scope)}
        onClose={() => setDialog(null)} onDone={(out) => { setSaid((x) => ({ ...x, [dialog.module.slug]: acceptAllLine(out) })); done(); }} />
      : dialog.kind === 'pause' ? <PlanConfirm testId="plan-pause-dialog" title="Pause the plan?" body={PAUSE_BODY} button="Pause the plan"
        run={() => buildPlanApi.pause(projectId, scope)} onClose={() => setDialog(null)} onDone={done} />
      : dialog.kind === 'resume' ? <PlanConfirm testId="plan-resume-dialog" title="Resume the plan?" body={RESUME_BODY} button="Resume the plan"
        run={() => buildPlanApi.resume(projectId, scope)} onClose={() => setDialog(null)} onDone={done} />
      : <PlanConfirm testId="plan-prepare-dialog" title={dialog.kind === 'update' ? 'Update the plan?' : 'Prepare the plan?'}
        body={dialog.kind === 'update' ? UPDATE_BODY : `${UNPREPARED_LINE} Nothing lands until you accept it.`} button={dialog.kind === 'update' ? 'Update the plan' : 'Prepare the plan'}
        run={() => buildPlanApi.prepare(projectId, scope).catch((e) => {
          if ((e?.data?.code || e?.code) === 'no_evidence') { setEmpty(true); return { empty: true }; }
          throw e;
        })} onClose={() => setDialog(null)} onDone={done} />
  ) : null;

  if (b.status === 'refused') {
    return (
      <section className={`${CARD} mx-auto mt-10 w-full max-w-[560px] items-center !py-8 text-center`} data-testid="plan-not-yours">
        <span aria-hidden="true" className="text-[22px] text-axal-muted">⊘</span>
        <h2 className={H2}>{NOT_YOURS}</h2>
        <p className={MUTED}>{NOT_YOURS_LINE}</p>
        <Link to="/" className={BTN_P}>Go to your home</Link>
      </section>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-[14px]" data-testid="plan-body">
      {strip}
      <div className="grid min-w-0 grid-cols-1 items-start gap-[14px] lg:grid-cols-[300px_minmax(0,1fr)]">
        <Proved projectId={projectId} search={ventureSearch(search)} />
        {content}
      </div>
      {dialogs}
    </div>
  );
}

/**
 * VB2a (D1069): on a Verdict record after a given Proceed or Pivot, the
 * venture's founder plans the build from it. The Worker declares the
 * `plan-build` link only then (`services/records/verdict.ts`); this panel
 * draws it in lavender with the plan's own count of what is waiting, read
 * from D1065, or no count when that read fails.
 */
export function PlanFromVerdict({ href }) {
  const q = new URLSearchParams(String(href || '').split('?')[1] || '');
  const project = q.get('project_id');
  const scope = planScope(`?${q}`);
  const [n, setN] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!project) return undefined;
    buildPlanApi.read(project, scope).then((p) => { if (alive) setN(p?.plan ? planCounts(p).proposed : 0); }).catch(() => { if (alive) setN(null); });
    return () => { alive = false; };
  }, [project, scope]);
  const line = n ? `Plan the build from this evidence. ${n} ${n === 1 ? 'proposal is' : 'proposals are'} ready.` : 'Plan the build from this evidence.';
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-axal-lavender-edge bg-axal-lavender px-[18px] py-3.5 dark:border-violet-800 dark:bg-violet-900/30" data-testid="verdict-plan-build">
      <p className="m-0 text-[14px] font-bold leading-[1.45] text-axal-ink dark:text-gray-100">{line}</p>
      <Link to={href} className={BTN_P} data-testid="verdict-plan-build-open">Plan the build</Link>
    </section>
  );
}

/** The Verdict record (D693) with VB2a's panel above it; the link is drawn once, as the panel. */
export function VerdictRecordWithPlan({ read, render }) {
  const actions = Array.isArray(read?.actions) ? read.actions : [];
  const plan = actions.find((a) => a?.key === 'plan-build' && a.href);
  const rest = plan ? { ...read, actions: actions.filter((a) => a !== plan) } : read;
  return (
    <div className="flex min-w-0 flex-col gap-[14px]">
      {plan ? <PlanFromVerdict href={plan.href} /> : null}
      {render(rest)}
    </div>
  );
}

/** VB20a: someone who is not a founder of the venture meets this card, never a silent bounce. */
export function PlanNotFounder() {
  return (
    <section className={`${CARD} mx-auto mt-10 w-full max-w-[560px] items-center !py-8 text-center`} data-testid="plan-not-founder">
      <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-axal-lavender text-[18px] text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300">⊘</span>
      <h2 className={H2}>{NOT_FOUNDER_TITLE}</h2>
      <p className={MUTED}>{NOT_FOUNDER_LINE}</p>
      <Link to="/" className={BTN_P}>Go to your home</Link>
    </section>
  );
}

export default function BuildPlan({ tab = 'plan', projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false, role = null, lab = false }) {
  const s = planSearch(search);
  const scope = planScope(search);
  const readOnly = role === 'admin';
  const partner = role === 'partner';
  // VB20a: a member who is not one of the venture's founders (NOT_FOUNDER_ROLES)
  // reads nothing here. A Spin-Out Lab member is spared: a Lab founder may hold
  // one of those roles (D1064).
  if (NOT_FOUNDER_ROLES.includes(role) && !lab) return <PlanNotFounder />;
  // VB15: an Operating Partner has Progress only.
  if (partner && tab !== 'progress') return <Navigate to={`/build/plan/progress${s}`} replace />;
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <p className={MUTED} aria-busy="true" data-testid="plan-loading">Loading…</p>;
  else if (tab === 'progress') {
    body = <PlanProgress projectId={projectId} scope={scope} search={s} phone={phone} actions={!readOnly && !partner} />;
  } else body = <PlanBoard projectId={projectId} scope={scope} search={s} readOnly={readOnly} lab={lab} phone={phone} />;
  const pill = readOnly
    ? <span className="w-fit rounded-full border border-axal-hairline bg-axal-ground px-2.5 py-px text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400" data-testid="plan-read-only-pill">◉ Read only</span>
    : partner ? <span className="w-fit rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-px text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" data-testid="plan-op-pill">{OP_PILL}</span> : null;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`build-plan-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: 'Build', to: `/build${ventureSearch(s)}` }} title={partner ? OP_TITLE : TITLE} eadwynLabel={`Build · ${partner ? OP_TITLE : TITLE}`} />
        : partner
          ? (
            <header className="flex flex-col gap-1" data-testid="plan-op-header">
              <h1 className="m-0 text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{OP_TITLE}</h1>
              <p className={MUTED}>{OP_LINE}</p>
            </header>
          )
          : <CycleHeader cycle="build" cards={cards} active="plan" action={action} title={TITLE} sub={readOnly ? READ_ONLY_LINE : LINE} search={ventureSearch(s)} />}
      {pill}
      <PlanTabBar active={tab} search={s} only={partner ? 'progress' : null} />
      {body}
    </div>
  );
}
