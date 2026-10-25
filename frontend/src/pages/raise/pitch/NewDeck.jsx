import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, GripVertical, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { newDeckApi } from '../../../lib/api/newDeck';
import { reportError } from '../../../lib/log';
import { railPressHeaders } from '../../../lib/railPage';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, RailFrame, WorkerRail } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import { SourcesStep, useDeckSources } from './SourcesBoards';
import { EDIT_PATH, READ_ONLY, STUDIO_PATH, asList, isReadOnly, ventureQuery } from './pitchStudioModel';
import {
  DISCARD_SENTENCE, NOT_ON_STUDIOOS, NO_ROUND, PAID_LINE, PROMPT_HINT, PROPOSAL_LINE, PROPOSED_BY_EADWYN, ROUND_LINK, STEPS,
  TITLES_ONLY_LINE, addRow, aiTokens, buildSentence, chipsFor, costRows, editRow, estimateLine, keepAllSentence, keepSentence,
  moveRow, outlineSentence, progressRows, promptWarning, proposalCards, refusalOf, removeRow, roundLine, rowWarning,
  saveSentence, startOptions,
} from './newDeckModel';

/**
 * D897 (#2677, part 3 of #2434) — New deck at /raise/pitch/new, built to the
 * "Pitch Deck Studio" canvas:
 *
 *   PD3  step 1  Audience and round: the seven audiences, the active round with
 *                its Reviewed chip, the three lengths, the optional prompt, and
 *                Start from blank, a past version or a template.
 *   PD4  step 2  Sources and coverage (`SourcesStep`, D896): an unticked record
 *                is on no card.
 *   PD5  step 3  The outline Eadwyn proposes: edit, reorder, delete, add;
 *                Regenerate and Build deck show their cost first.
 *   PD6  step 4  Building, then the proposal: what each card was filled from,
 *                what the run cost, and Keep / Keep all / Save card by card.
 *
 * Every write opens a dialog that says what it changes. A figure comes only
 * from a read; the prompt is never a source, and a prompt that states one is
 * refused by the Worker with the module that records it. A template start is
 * the editor's own fill (`apply-method`); its proposal is kept here the same way.
 * `?proposal=<id>` reopens a proposal (PD2's fast path lands on step 4).
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const LAV = 'rounded-[12px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/30';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const PILL_OK = `${PILL} border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`;
const PILL_MU = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
const INPUT = 'w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const RAIL = { outline: 'deck:outline', build: 'deck:build', template: 'form:deck-template' };

/** One read into its state, ignoring an answer that arrives after the page moved on. */
function useRead(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(load).then(
      (data) => { if (live) setState({ status: 'ok', data }); },
      (e) => { if (live) setState({ status: 'error', data: null, error: e }); reportError('pitch-new:read', e); },
    );
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

export default function NewDeck() {
  const { user } = useAuth() || {};
  const readOnly = isReadOnly(user);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = params.get('project_id');
  const projects = useRead(() => api.listProjects(), []);
  const list = asList(projects.data, 'items', 'projects');
  const project = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
  const projectId = project?.id ?? null;
  const q = ventureQuery(projectId || requested);

  useEffect(() => {
    if (projectId == null || String(projectId) === String(requested)) return;
    setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(projectId)); return next; }, { replace: true });
  }, [projectId, requested, setParams]);

  const rail = <WorkerRail workspace="Raise" role="founder" note="New deck fills every figure from your records. Eadwyn writes the outline and the wording; each run shows its cost first." data-testid="pitch-new-rail" />;

  let body;
  if (readOnly) body = <Notice text={READ_ONLY} q={q} testId="pitch-new-readonly" />;
  else if (projects.status === 'error') body = <Failed text="Your ventures could not be read." onRetry={projects.retry} />;
  else if (projects.status === 'loading') body = <div className="h-60 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" data-testid="pitch-new-loading" />;
  else if (!projectId) body = <Notice text="No venture to build a deck for yet." q="" testId="pitch-new-no-venture" />;
  else body = <Flow key={projectId} projectId={projectId} q={q} navigate={navigate} params={params} setParams={setParams} />;

  return (
    <RailFrame rail={rail} data-testid="pitch-new">
      <div className="flex flex-col gap-5 pb-24 lg:pb-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Link to={`${STUDIO_PATH}${q}`} className={LINK}>‹ Pitch deck studio</Link>
            <h1 className={`m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] ${INK}`}>New deck</h1>
          </div>
        </header>
        {body}
      </div>
    </RailFrame>
  );
}

function Notice({ text, q, testId }) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-3 p-6`} data-testid={testId}>
      <span className={`text-[14px] font-bold ${INK}`}>{text}</span>
      <Link to={`${STUDIO_PATH}${q}`} className={LINK}>Back to the studio ›</Link>
    </div>
  );
}

function Failed({ text, onRetry }) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} role="alert">
      <span className={`text-[13.5px] font-bold ${INK}`}>{text}</span>
      {onRetry ? <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
    </div>
  );
}

function Refusal({ refusal }) {
  if (!refusal) return null;
  return (
    <div role="alert" className={`${LAV} flex flex-col gap-1.5 px-3.5 py-2.5`} data-testid="pitch-new-refusal">
      <span className={`text-[12.5px] font-semibold ${INK}`}>{refusal.message}</span>
      <span className="flex flex-wrap gap-3">
        {refusal.link ? <Link to={refusal.link.href} className={LINK}>{refusal.link.text}</Link> : null}
        {refusal.topUp ? <a href={refusal.topUp.href} className={LINK}>{refusal.topUp.text}</a> : null}
      </span>
    </div>
  );
}

/** The dialog every write opens: what it changes, then Confirm or Cancel. */
function Confirm({ title, sentence, action, busy, onConfirm, onClose }) {
  return (
    <Lightbox label={title} title={title} width={520} onClose={() => !busy && onClose()} testId="pitch-new-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={onConfirm} disabled={busy} data-testid="pitch-new-confirm">{busy ? 'Working…' : action}</button>
        </div>
      )}>
      <p className={`m-0 ${MUTED}`}>{sentence}</p>
    </Lightbox>
  );
}

function Flow({ projectId, q, navigate, params, setParams }) {
  const context = useRead(() => newDeckApi.context(projectId), [projectId]);
  const sources = useDeckSources(projectId);
  const versions = useRead(() => api.deckListVersions(projectId), [projectId]);
  const methods = useRead(() => api.deckMethods(), []);

  const [step, setStep] = useState(1);
  const [audience, setAudience] = useState('seed_fund');
  const [length, setLength] = useState('standard');
  const [prompt, setPrompt] = useState('');
  const [start, setStart] = useState({ kind: 'blank', id: 'blank' });
  const [chosen, setChosen] = useState(null);
  const [rows, setRows] = useState([]);
  const [proposedBy, setProposedBy] = useState(null);
  const [reason, setReason] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [built, setBuilt] = useState(null);
  const [quote, setQuote] = useState({ outline: null, build: null });
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [drag, setDrag] = useState(null);
  const [running, setRunning] = useState(null);
  // D768: the rail names the option while its run is in flight.
  useRailOption(running === 'outline' ? 'deck:outline' : null, 'Regenerate outline');
  useRailOption(running === 'build' ? 'deck:build' : null, 'Build deck');
  useRailOption(running === 'template' ? 'form:deck-template' : null, 'Use this template');

  const ctx = context.data;
  const items = useMemo(() => sources.data?.items || [], [sources.data]);
  const audienceLabel = ctx?.audiences?.find((a) => a.id === audience)?.label || null;
  const recordedKeys = useMemo(() => items.filter((it) => it.state === 'recorded' && !it.optional).map((it) => it.source_key), [items]);
  const exclude = useMemo(() => (chosen ? recordedKeys.filter((k) => !chosen.includes(k)) : []), [chosen, recordedKeys]);
  const excludedSet = useMemo(() => new Set(exclude), [exclude]);
  const onChosen = useCallback((keys) => setChosen(keys), []);

  // Reopen a proposal (?proposal=<id>): its outline, its cards and what is kept.
  const wanted = params.get('proposal');
  useEffect(() => {
    const p = versions.data?.proposal;
    if (!wanted || !p || String(p.id) !== String(wanted) || proposal) return;
    setProposal(p);
    const o = p.outline || {};
    if (o.audience) setAudience(o.audience);
    if (o.length) setLength(o.length);
    if (typeof o.prompt === 'string') setPrompt(o.prompt);
    if (Array.isArray(o.rows)) setRows(o.rows);
    setProposedBy(o.proposed_by || null);
    setStep(p.slides?.length ? 4 : 3);
  }, [wanted, versions.data, proposal]);

  const body = (extra = {}) => ({ project_id: projectId, audience, length, prompt, round_ref: ctx?.round?.uid ?? null, ...extra });

  // A quote is a read: it answers what the next run would hold, and runs nothing.
  const refreshQuote = useCallback(async (which, extra = {}) => {
    try {
      const qt = await newDeckApi.quote({ project_id: projectId, step: which, audience, length, prompt, ...extra });
      setQuote((old) => ({ ...old, [which]: qt }));
    } catch (e) {
      setQuote((old) => ({ ...old, [which]: null }));
      if (e?.code === 'figure_in_prompt') setRefusal(refusalOf(e));
    }
  }, [projectId, audience, length, prompt]);

  useEffect(() => { if (step === 2) refreshQuote('outline'); }, [step, refreshQuote]);
  useEffect(() => {
    if (step === 3 && rows.length) refreshQuote('build', { outline: rows, exclude });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, rows, exclude.join(',')]);

  const run = async (fn, option = null) => {
    setBusy(true); setRefusal(null); setRunning(option);
    try { await fn(); setDialog(null); } catch (e) { setRefusal(refusalOf(e)); setDialog(null); reportError('pitch-new:write', e); } finally { setBusy(false); setRunning(null); }
  };

  const proposeOutline = () => run(async () => {
    const r = await newDeckApi.outline(body({ start: start.kind === 'version' ? { kind: 'version', deck_id: start.id } : { kind: 'blank' } }), railPressHeaders(RAIL.outline));
    setProposal(r.proposal); setRows(r.outline.rows); setProposedBy(r.outline.proposed_by); setReason(r.outline.reason || null);
    setStep(3);
  }, 'outline');

  const buildDeck = () => run(async () => {
    setStep(4); setBuilt({ building: true });
    const r = await newDeckApi.build(body({ proposal_id: proposal?.id ?? undefined, outline: rows, exclude }), railPressHeaders(RAIL.build));
    setProposal(r.proposal); setBuilt(r);
    setParams((old) => { const next = new URLSearchParams(old); next.set('proposal', String(r.proposal.id)); return next; }, { replace: true });
  }, 'build');

  const applyTemplate = () => run(async () => {
    const r = await api.deckApplyMethod(projectId, start.id, railPressHeaders(RAIL.template));
    if (r?.deck) { navigate(`${EDIT_PATH}${q}`); return; }
    setProposal(r?.proposal || null); setBuilt({ template: true }); setStep(4);
  }, 'template');

  const keep = (body2) => run(async () => {
    const r = await newDeckApi.keepSlides(proposal.id, body2);
    if (r.deck) { navigate(`${STUDIO_PATH}${q}`); return; }
    setProposal(r.proposal);
  });

  const discard = () => run(async () => {
    await api.deckDiscardProposal(proposal.id);
    navigate(`${STUDIO_PATH}${q}`);
  });

  if (context.status === 'error') return <Failed text="New deck could not be read." onRetry={context.retry} />;
  if (context.status !== 'ok') return <div className="h-60 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" />;

  return (
    <div className="flex flex-col gap-4" data-testid={`pitch-new-step-${step}`}>
      <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Steps">
        {STEPS.map((t, i) => (
          <li key={t} aria-current={i + 1 === step ? 'step' : undefined}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${i + 1 === step ? 'bg-axal-violet text-white' : i + 1 < step ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/40 dark:text-violet-300' : 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400'}`}>
            {i + 1} {t}
          </li>
        ))}
      </ol>
      <Refusal refusal={refusal} />

      {step === 1 ? (
        <StepAudience ctx={ctx} audience={audience} setAudience={setAudience} length={length} setLength={setLength}
          prompt={prompt} setPrompt={setPrompt} start={start} setStart={setStart}
          options={startOptions(asList(versions.data, 'versions', 'decks'), methods.data?.methods || [])}
          onContinue={() => (start.kind === 'template'
            ? setDialog({ title: 'Use this template', action: 'Use template', sentence: 'Eadwyn fills the template from your records as a proposal beside your current version. Nothing is a version until you keep cards and save.', go: applyTemplate })
            : setStep(2))} />
      ) : null}

      {step === 2 ? (
        <>
          <SourcesStep items={items} coverage={sources.data?.coverage} status={sources.status} onRetry={sources.retry} onChange={onChosen}
            onContinue={() => setDialog({ title: 'Propose an outline', action: quote.outline?.ai ? `Propose · ${aiTokens(quote.outline.hold_microusd)}` : 'Propose', sentence: outlineSentence(quote.outline, false), go: proposeOutline })} />
          <div><button type="button" className={GHOST} onClick={() => setStep(1)}>Back</button></div>
        </>
      ) : null}

      {step === 3 ? (
        <StepOutline ctx={ctx} items={items} excluded={excludedSet} rows={rows} setRows={setRows} proposedBy={proposedBy} reason={reason}
          quote={quote} drag={drag} setDrag={setDrag}
          onRegenerate={() => setDialog({ title: 'Regenerate outline', action: quote.outline?.ai ? `Regenerate · ${aiTokens(quote.outline.hold_microusd)}` : 'Regenerate', sentence: outlineSentence(quote.outline, true), go: proposeOutline })}
          onBuild={() => setDialog({ title: 'Build deck', action: 'Build deck', sentence: buildSentence(quote.build, rows.length), go: buildDeck })}
          onBack={() => setStep(2)} />
      ) : null}

      {step === 4 ? (
        <StepBuild built={built} proposal={proposal} items={items} quote={quote.build} audienceLabel={audienceLabel}
          onKeep={(card) => setDialog({ title: 'Keep this card', action: 'Keep', sentence: keepSentence(card), go: () => keep({ indexes: [card.index] }) })}
          onKeepAll={(count) => setDialog({ title: 'Keep all', action: `Keep all (${count})`, sentence: keepAllSentence(count), go: () => keep({ all: true }) })}
          onSave={(kept, total) => setDialog({ title: 'Save as a version', action: 'Save', sentence: saveSentence(kept, total, audienceLabel), go: () => keep({ save: true }) })}
          onDiscard={() => setDialog({ title: 'Discard this proposal', action: 'Discard', sentence: DISCARD_SENTENCE, go: discard })} />
      ) : null}

      {dialog ? <Confirm {...dialog} busy={busy} onConfirm={dialog.go} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function StepAudience({ ctx, audience, setAudience, length, setLength, prompt, setPrompt, start, setStart, options, onContinue }) {
  const warning = promptWarning(prompt);
  const round = ctx.round;
  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3.5">
        <section className={`${CARD} flex flex-col gap-2.5 p-4`} aria-label="Audience">
          <span className={`text-[14px] font-extrabold ${INK}`}>Audience</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Audience">
            {ctx.audiences.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={a.id === audience} onClick={() => setAudience(a.id)}
                className={`flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2.5 text-left ${a.id === audience ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}
                data-testid={`pitch-new-audience-${a.id}`}>
                <span className={`text-[13px] font-bold ${INK}`}>{a.label}</span>
                <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{a.line}</span>
              </button>
            ))}
          </div>
        </section>
        <section className={`${CARD} flex flex-col gap-2.5 p-4`} aria-label="Start from">
          <span className={`text-[14px] font-extrabold ${INK}`}>Start from</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {options.map((o) => {
              const on = o.kind === start.kind && String(o.id) === String(start.id);
              return (
                <button key={`${o.kind}:${o.id}`} type="button" disabled={o.locked} aria-pressed={on} onClick={() => setStart({ kind: o.kind, id: o.id })}
                  className={`flex aspect-[16/10] flex-col justify-between gap-1 rounded-[8px] border p-2 text-left text-[11.5px] font-semibold ${on ? 'border-axal-violet' : 'border-axal-hairline dark:border-gray-700'} ${INK}`}>
                  <span>{o.label}</span>
                  {o.locked ? <span className={PILL_MU}>Plan</span> : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <div className="flex flex-col gap-3.5">
        <section className={`${CARD} flex flex-col gap-2 p-4`} aria-label="Round" data-testid="pitch-new-round">
          <span className={`text-[14px] font-extrabold ${INK}`}>Round</span>
          {round ? (
            <>
              <span className={`font-mono text-[12.5px] ${INK}`}>{roundLine(round)}</span>
              {round.reviewed ? <span className={PILL_OK}>Reviewed · counsel approved</span> : <span className={PILL_MU}>Stated · not reviewed by counsel</span>}
            </>
          ) : (
            <>
              <span className={MUTED}>{NO_ROUND}</span>
              <Link to={ROUND_LINK.path} className={LINK}>{ROUND_LINK.text}</Link>
            </>
          )}
        </section>
        <section className={`${CARD} flex flex-col gap-2 p-4`} aria-label="Length">
          <span className={`text-[14px] font-extrabold ${INK}`}>Length</span>
          <div className="flex gap-1 rounded-[9px] bg-axal-ground p-1 dark:bg-gray-800" role="radiogroup" aria-label="Length">
            {ctx.lengths.map((l) => (
              <button key={l.id} type="button" role="radio" aria-checked={l.id === length} onClick={() => setLength(l.id)}
                className={`flex-1 rounded-[7px] px-2 py-1.5 text-[12px] font-bold ${l.id === length ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-900 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>
                {l.label}
              </button>
            ))}
          </div>
        </section>
        <section className={`${CARD} flex flex-col gap-2 p-4`} aria-label="Optional prompt">
          <label htmlFor="pitch-new-prompt" className={`text-[14px] font-extrabold ${INK}`}>Optional prompt</label>
          <textarea id="pitch-new-prompt" className={`${INPUT} min-h-[84px]`} maxLength={ctx.prompt_max} placeholder={PROMPT_HINT} value={prompt} onChange={(e) => setPrompt(e.target.value)} data-testid="pitch-new-prompt" />
          {warning ? <span role="alert" className="text-[12px] font-semibold text-axal-violet dark:text-violet-300" data-testid="pitch-new-prompt-warning">{warning}</span> : null}
        </section>
        <button type="button" className={PRIMARY} onClick={onContinue} disabled={Boolean(warning)} data-testid="pitch-new-continue">
          {start.kind === 'template' ? 'Fill this template' : 'Continue to sources'}
        </button>
      </div>
    </div>
  );
}

function StepOutline({ ctx, items, excluded, rows, setRows, proposedBy, reason, quote, drag, setDrag, onRegenerate, onBuild, onBack }) {
  const [adding, setAdding] = useState('');
  const warning = rowWarning(rows);
  const estimate = estimateLine(quote.build, ctx.averages?.build);
  return (
    <section className={`${LAV} flex flex-col gap-3 p-4`} aria-label="Outline" data-testid="pitch-new-outline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className={`text-[14px] font-extrabold ${INK}`}>Outline</span>
          <span className={PILL_VIO}>{proposedBy === 'Eadwyn' ? PROPOSED_BY_EADWYN : 'Standard outline'}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          <select className={`${INPUT} w-auto`} aria-label="Add slide" value={adding} onChange={(e) => { setRows(addRow(rows, e.target.value, ctx.cards)); setAdding(''); }}>
            <option value="">+ Add slide</option>
            {ctx.cards.map((c) => <option key={c.card} value={c.card}>{c.title}</option>)}
          </select>
          <button type="button" className={GHOST} onClick={onRegenerate} data-testid="pitch-new-regenerate">
            Regenerate outline{quote.outline?.ai ? ` · ${aiTokens(quote.outline.hold_microusd)}` : ''}
          </button>
        </span>
      </div>
      {reason ? <span className={MUTED}>{reason}</span> : null}
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((r, i) => (
          <li key={`${r.card}-${i}`} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag != null) setRows(moveRow(rows, drag, i)); setDrag(null); }}
            className={`${CARD} grid grid-cols-[20px_28px_minmax(0,1fr)] items-start gap-2 p-2.5 sm:grid-cols-[20px_28px_minmax(0,1fr)_minmax(0,1.3fr)_auto]`} data-testid={`pitch-new-row-${i}`}>
            <GripVertical size={16} className="mt-1.5 text-axal-muted" aria-hidden="true" />
            <span className="mt-1.5 font-mono text-[12px] text-axal-muted">{String(i + 1).padStart(2, '0')}</span>
            <input className={INPUT} aria-label={`Title of card ${i + 1}`} value={r.title} maxLength={80} onChange={(e) => setRows(editRow(rows, i, { title: e.target.value }))} />
            <div className="col-start-3 flex flex-col gap-1 sm:col-start-auto">
              <input className={INPUT} aria-label={`What card ${i + 1} shows`} value={r.purpose} maxLength={200} onChange={(e) => setRows(editRow(rows, i, { purpose: e.target.value }))} />
              <span className="flex flex-wrap gap-1">
                {chipsFor(r, ctx.cards, items, excluded).map((c) => (
                  <span key={c.key} className={c.recorded ? PILL_VIO : PILL_MU}>{c.label}{c.recorded ? '' : ` · ${NOT_ON_STUDIOOS}`}</span>
                ))}
              </span>
            </div>
            <span className="col-start-3 flex gap-1 sm:col-start-auto">
              <button type="button" className={GHOST} aria-label={`Move card ${i + 1} up`} disabled={i === 0} onClick={() => setRows(moveRow(rows, i, i - 1))}><ArrowUp size={14} aria-hidden="true" /></button>
              <button type="button" className={GHOST} aria-label={`Move card ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => setRows(moveRow(rows, i, i + 1))}><ArrowDown size={14} aria-hidden="true" /></button>
              <button type="button" className={`${GHOST} text-axal-destructive`} onClick={() => setRows(removeRow(rows, i))}>Delete</button>
            </span>
          </li>
        ))}
      </ol>
      {warning ? <span role="alert" className="text-[12px] font-semibold text-axal-violet dark:text-violet-300">{warning}</span> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={GHOST} onClick={onBack}>Back</button>
        <span className="flex flex-wrap items-center gap-3">
          {estimate ? <span className={MUTED} data-testid="pitch-new-estimate">{estimate}</span> : null}
          <button type="button" className={PRIMARY} onClick={onBuild} disabled={!rows.length || Boolean(warning)} data-testid="pitch-new-build">Build deck</button>
        </span>
      </div>
    </section>
  );
}

function StepBuild({ built, proposal, items, quote, audienceLabel, onKeep, onKeepAll, onSave, onDiscard }) {
  const cards = proposalCards(proposal, items);
  const keptCount = cards.filter((c) => c.kept).length;
  const [hidden, setHidden] = useState(() => new Set());
  if (built?.building && !proposal?.slides?.length) {
    return (
      <section className={`${CARD} flex flex-col gap-2 p-4`} aria-busy="true" data-testid="pitch-new-building">
        <span className={`text-[14px] font-extrabold ${INK}`}>Building your deck</span>
        <span className={MUTED}>Filling every figure from your records, then Eadwyn writes the words{quote?.ai ? `, up to ${aiTokens(quote.hold_microusd)}` : ''}.</span>
        <span className={MUTED}>{PAID_LINE}</span>
      </section>
    );
  }
  if (!cards.length) return <Failed text="This proposal has no cards yet." />;
  const worded = built?.wording?.by === 'Eadwyn' || (!built && cards.some((c) => c.headline && c.headline !== c.title));
  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      {built?.progress ? (
        <section className={`${CARD} flex flex-col gap-2 p-4`} aria-label="Building" data-testid="pitch-new-progress">
          <span className={`text-[14px] font-extrabold ${INK}`}>Built {built.progress.length} cards</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {progressRows(built.progress).map((p) => (
              <li key={p.n} className="flex justify-between gap-2 text-[12px]">
                <span className={INK}><span className="font-mono text-axal-muted">{p.n}</span> {p.title}</span>
                <span className="flex gap-1.5"><span className={PILL_OK}>{p.status}</span><span className={PILL_MU}>{p.words}</span></span>
              </li>
            ))}
          </ul>
          {built.wording?.reason ? <span className={MUTED}>{built.wording.reason}</span> : null}
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-axal-hairline pt-2 text-[12px] dark:border-gray-700">
            {costRows(built.cost, quote).map((r) => <React.Fragment key={r.label}><dt className="text-axal-muted dark:text-gray-400">{r.label}</dt><dd className={`m-0 font-mono ${INK}`}>{r.value}</dd></React.Fragment>)}
          </dl>
          <span className={MUTED}>{PAID_LINE}</span>
        </section>
      ) : null}
      <section className={`${LAV} flex flex-col gap-3 p-4`} aria-label="Proposal" data-testid="pitch-new-proposal">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-[12.5px] ${INK}`}><b>{worded ? 'Proposed by Eadwyn.' : 'Built from your records.'}</b> {worded ? PROPOSAL_LINE : TITLES_ONLY_LINE}{audienceLabel ? ` For ${audienceLabel}.` : ''}</span>
          <span className="flex flex-wrap gap-1.5">
            <button type="button" className={PRIMARY} onClick={() => onKeepAll(cards.length)} data-testid="pitch-new-keep-all">Keep all ({cards.length})</button>
            <button type="button" className={GHOST} onClick={onDiscard} data-testid="pitch-new-discard">Discard</button>
            <button type="button" className={PRIMARY} onClick={() => onSave(keptCount, cards.length)} disabled={!keptCount} data-testid="pitch-new-save">Save as version ({keptCount})</button>
          </span>
        </div>
        <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {cards.filter((c) => !hidden.has(c.index)).map((c) => (
            <li key={c.index} className={`${CARD} flex flex-col gap-1.5 p-3`} data-testid={`pitch-new-card-${c.index}`}>
              <span className="font-mono text-[11px] text-axal-muted">{c.n} · {c.title}</span>
              <span className={`text-[13.5px] font-bold leading-snug ${INK}`}>{c.headline || c.title}</span>
              {c.body ? <span className={MUTED}>{c.body}</span> : null}
              {c.figures.length ? (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {c.figures.map((fg) => (
                    <li key={fg.key || fg.label} className="flex flex-wrap justify-between gap-2 text-[11.5px]">
                      <span className="text-axal-muted dark:text-gray-400">{fg.label}</span>
                      {fg.value != null ? <span className={`font-mono ${INK}`}>{fg.value} <span className="text-axal-muted">· {fg.grade}</span></span> : (
                        <span className="rounded-[4px] border border-dashed border-axal-muted px-1.5 font-mono text-[10.5px] text-axal-muted dark:border-gray-500 dark:text-gray-400">
                          {NOT_ON_STUDIOOS}{fg.href ? <> · <Link to={fg.href} className={LINK}>Add it in {fg.module} ›</Link></> : null}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              <span className="mt-auto flex gap-1.5">
                {c.kept ? <span className={PILL_OK}>Kept</span> : (
                  <>
                    <button type="button" className={PRIMARY} onClick={() => onKeep(c)} data-testid={`pitch-new-keep-${c.index}`}>Keep</button>
                    <button type="button" className={GHOST} onClick={() => setHidden((s) => new Set([...s, c.index]))}>Discard</button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
