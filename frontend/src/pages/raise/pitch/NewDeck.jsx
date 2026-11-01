import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, GripVertical, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { newDeckApi } from '../../../lib/api/newDeck';
import { reportError } from '../../../lib/log';
import { railPressHeaders } from '../../../lib/railPage';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, WorkerRail } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import PitchPage from './PitchPage';
import BuildProgress, { BuildAnnouncer } from './BuildProgress';
import OneClickBuild, { FreshnessLines, ProposalReview } from './OneClickBuild';
import { CoverageMeter, SourcesStep, useDeckSources } from './SourcesBoards';
import { EDIT_PATH, READ_ONLY, STUDIO_PATH, asList, isReadOnly, ventureQuery } from './pitchStudioModel';
import {
  NOT_ON_STUDIOOS, NO_ROUND, PROPOSED_BY_EADWYN, ROUND_LINK, addRow, aiTokens, buildSentence, chipsFor, editRow, estimateLine,
  fastBrief, moveRow, outlineSentence, refusalOf, removeRow, roundLine, rowWarning, startOptions,
} from './newDeckModel';
import { ONE_CLICK_LINE, ONE_CLICK_TITLE, audienceLabel, buildingLine } from './oneClickModel';
import { templateStartLine, templateSentence } from './templatesModel';
import { availability } from './deckV2Adapter';
import { HOLD, LATER } from './deckV2Model';
import { markRecommended } from './studioActionsModel';
import { deckRail } from './deckRailGroups';

/**
 * D897 (#2677, part 3 of #2434), rebuilt by D1604 (#3716, pd2, plan §11 step
 * 14) — New deck at /raise/pitch/new, on one page:
 *
 *   Generate from my data   the one-click (`OneClickBuild.jsx`) at the top,
 *                           with the coverage the sources read gives, building
 *                           with this page's audience, length and sources.
 *   Audience and stage      the stage from the venture's records (#3877's
 *                           `inferred`, with its reason), its chips greyed
 *                           "Coming later" until the stage plan (#3774); the
 *                           seven audiences and the lengths, preset from that
 *                           brief (never a literal of the client's); the
 *                           active round; Start from blank, a past version or
 *                           a template.
 *   Sources                 every record with its checkbox, value, source,
 *                           grade and as-of date (`SourcesStep`, D896); an
 *                           unticked record is on no card. The connectors'
 *                           freshness with Sync now (#3877).
 *   Outline                 the length's standard outline, free, at once; each
 *                           row with its why line, its records, drag and Move
 *                           up / down; Regenerate outline runs Eadwyn (cost
 *                           first); Reorder for stage waits on #3808.
 *
 * There is no prompt field: typed instructions live only in the editor, scoped
 * to the Grid selection (owner rule). Build deck shows its cost first, then
 * lands on the review shared with the one-click (`ProposalReview`), where
 * nothing is saved before Accept. A template start is the editor's own fill
 * (`apply-method`) and lands on the same review. `?proposal=<id>` reopens a
 * proposal: its cards on the review, or an outline still to build here.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50 dark:disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const LAV = 'rounded-[12px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/30';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const SMALL = 'text-[11.5px] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const PILL_OK = `${PILL} border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`;
const PILL_MU = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
const INPUT = 'w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const H2 = `m-0 text-[15px] font-extrabold ${INK}`;

const RAIL = { outline: 'deck:outline', build: 'deck:build', template: 'form:deck-template' };

/** pd2's stage chips, in order; the inferred stage (#3877) is the one pressed. */
export const STAGES = Object.freeze([
  { id: 'pre_seed', label: 'Pre-seed' }, { id: 'seed', label: 'Seed' }, { id: 'series_a', label: 'Series A' }, { id: 'later', label: 'Series B+' },
]);

/** The outline a length starts from: the context read's standard rows, never a list of the client's. */
const standardRows = (ctx, length) => (Array.isArray(ctx?.standard?.[length]) ? ctx.standard[length].filter((r) => r && typeof r === 'object' && r.card) : []);

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

  const railGroups = useMemo(() => deckRail(null), []);
  const rail = <WorkerRail workspace="Raise" role="founder" groups={railGroups} note="New deck fills every figure from your records. Eadwyn writes the outline and the wording; each run shows its cost first." data-testid="pitch-new-rail" />;

  let body;
  if (readOnly) body = <Notice text={READ_ONLY} q={q} testId="pitch-new-readonly" />;
  else if (projects.status === 'error') body = <Failed text="Your ventures could not be read." onRetry={projects.retry} />;
  else if (projects.status === 'loading') body = <div className="h-60 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" data-testid="pitch-new-loading" />;
  else if (!projectId) body = <Notice text="No venture to build a deck for yet." q="" testId="pitch-new-no-venture" />;
  else body = <Flow key={projectId} projectId={projectId} q={q} navigate={navigate} params={params} setParams={setParams} />;

  return (
    <PitchPage rail={rail} crumb={{ query: q, trail: 'New deck' }} ask={{ projectId, readOnly }} testId="pitch-new">
      <div className="flex flex-col gap-5 pb-24 lg:pb-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className={`m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] ${INK}`}>New deck</h1>
          </div>
        </header>
        {body}
      </div>
    </PitchPage>
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

/** The dialog every run opens: what it does and holds, then Confirm or Cancel; a build shows its progress while it runs. */
function Confirm({ title, sentence, action, hold = null, busy, progress = null, announce = null, onConfirm, onClose }) {
  return (
    <Lightbox label={title} title={title} width={540} onClose={() => !busy && onClose()} testId="pitch-new-dialog"
      footer={busy && progress ? null : (
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={onConfirm} disabled={busy} data-testid="pitch-new-confirm">{busy ? 'Working…' : action}</button>
        </div>
      )}>
      {/* The build's live region, mounted empty with the dialog and filled when the build starts. */}
      {announce != null ? <BuildAnnouncer text={busy ? announce : ''} testId="pitch-new-announce" /> : null}
      {busy && progress ? progress : (
        <div className="flex flex-col gap-2">
          <p className={`m-0 ${MUTED}`}>{sentence}</p>
          {hold ? <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-new-dialog-hold">{hold}</span> : null}
        </div>
      )}
    </Lightbox>
  );
}

function Flow({ projectId, q, navigate, params, setParams }) {
  const context = useRead(() => newDeckApi.context(projectId), [projectId]);
  const sources = useDeckSources(projectId);
  const versions = useRead(() => api.deckListVersions(projectId), [projectId]);
  const methods = useRead(() => api.deckMethods(), []);
  // D898 group E: the recommended template, once the builder's banner. A failed read marks nothing.
  const recommended = useRead(() => api.deckRecommend(projectId), [projectId]);
  const [proposal, setProposal] = useState(null);
  const [built, setBuilt] = useState(null);
  const items = useMemo(() => sources.data?.items || [], [sources.data]);
  const versionList = asList(versions.data, 'versions', 'decks');

  // Reopen a proposal (?proposal=<id>): its cards on the review, or its outline on the page.
  const wanted = params.get('proposal');
  useEffect(() => {
    const p = versions.data?.proposal;
    if (!wanted || !p || String(p.id) !== String(wanted) || proposal) return;
    setProposal(p);
  }, [wanted, versions.data, proposal]);

  // A build or a template fill lands on the review, and the address names it so a reload reopens it.
  const landed = useCallback((r) => {
    if (r?.deck) { navigate(`${EDIT_PATH}${q}`); return; }
    if (!r?.proposal) return;
    setProposal(r.proposal); setBuilt(r.progress || r.cost ? r : null);
    setParams((old) => { const next = new URLSearchParams(old); next.set('proposal', String(r.proposal.id)); return next; }, { replace: true });
  }, [navigate, q, setParams]);

  if (context.status === 'error') return <Failed text="New deck could not be read." onRetry={context.retry} />;
  if (context.status !== 'ok') return <div className="h-60 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" />;
  const ctx = context.data;

  if (wanted && !proposal) {
    if (versions.status === 'error') return <Failed text="This proposal could not be read." onRetry={versions.retry} />;
    if (versions.status !== 'ok') return <div className="h-60 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" data-testid="pitch-new-reading-proposal" />;
    return <Notice text="This proposal is no longer open: it was kept or discarded." q={q} testId="pitch-new-proposal-gone" />;
  }

  if (proposal && Array.isArray(proposal.slides) && proposal.slides.length) {
    const o = proposal.outline || {};
    return (
      <div className="flex flex-col gap-4" data-testid="pitch-new-review">
        <ProposalReview key={proposal.id} projectId={projectId} q={q} proposal={proposal} items={items} versions={versionList} built={built}
          audience={o.audience ? audienceLabel(o.audience, ctx) : null} />
      </div>
    );
  }

  return (
    <OnePage ctx={ctx} projectId={projectId} q={q} sources={sources} items={items} versions={versionList} methods={methods} recommended={recommended}
      outlineProposal={proposal} onLanded={landed} />
  );
}

function OnePage({ ctx, projectId, q, sources, items, versions, methods, recommended, outlineProposal, onLanded }) {
  // The brief the context read gives (#3877's inferred, else the fast path): the page starts from it.
  const initial = useMemo(() => fastBrief(ctx), [ctx]);
  const o = outlineProposal?.outline || null;
  const [audience, setAudience] = useState(o?.audience || initial?.audience || null);
  const [length, setLength] = useState(o?.length || initial?.length || ctx.lengths?.[0]?.id || null);
  const [start, setStart] = useState({ kind: 'blank', id: 'blank' });
  const [chosen, setChosen] = useState(null);
  const [rows, setRows] = useState(() => (Array.isArray(o?.rows) && o.rows.length ? o.rows : standardRows(ctx, o?.length || initial?.length || ctx.lengths?.[0]?.id)));
  const [touched, setTouched] = useState(Boolean(o?.rows?.length));
  const [proposedBy, setProposedBy] = useState(o?.proposed_by || null);
  const [reason, setReason] = useState(null);
  const [outlineId, setOutlineId] = useState(outlineProposal?.id ?? null);
  const [quote, setQuote] = useState({ outline: null, build: null });
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [drag, setDrag] = useState(null);
  const [running, setRunning] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  // D768: the rail names the option while its run is in flight.
  useRailOption(running === 'outline' ? 'deck:outline' : null, 'Regenerate outline');
  useRailOption(running === 'build' ? 'deck:build' : null, 'Build deck');
  useRailOption(running === 'template' ? 'form:deck-template' : null, 'Use this template');

  const label = audienceLabel(audience, ctx);
  const recordedKeys = useMemo(() => items.filter((it) => it.state === 'recorded' && !it.optional).map((it) => it.source_key), [items]);
  const exclude = useMemo(() => (chosen ? recordedKeys.filter((k) => !chosen.includes(k)) : []), [chosen, recordedKeys]);
  const excludedSet = useMemo(() => new Set(exclude), [exclude]);
  const onChosen = useCallback((keys) => setChosen(keys), []);
  const pickLength = (id) => { setLength(id); if (!touched) setRows(standardRows(ctx, id)); };
  const change = (next) => { setRows(next); setTouched(true); };

  const body = (extra = {}) => ({ project_id: projectId, audience, length, round_ref: ctx?.round?.uid ?? null, ...extra });

  // A quote is a read: it answers what the next run would hold, and runs nothing.
  const refreshQuote = useCallback(async (which, extra = {}) => {
    if (!audience || !length) return;
    try {
      const qt = await newDeckApi.quote({ project_id: projectId, step: which, audience, length, ...extra });
      setQuote((old) => ({ ...old, [which]: qt }));
    } catch (e) {
      setQuote((old) => ({ ...old, [which]: null }));
      if (e?.code === 'figure_in_prompt') setRefusal(refusalOf(e));
    }
  }, [projectId, audience, length]);

  useEffect(() => { refreshQuote('outline'); }, [refreshQuote]);
  useEffect(() => {
    if (rows.length) refreshQuote('build', { outline: rows, exclude });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshQuote, rows, exclude.join(',')]);

  const run = async (fn, option = null) => {
    setBusy(true); setRefusal(null); setRunning(option); setStartedAt(option === 'build' ? Date.now() : null);
    try { await fn(); setDialog(null); } catch (e) { setRefusal(refusalOf(e)); setDialog(null); reportError('pitch-new:write', e); } finally { setBusy(false); setRunning(null); setStartedAt(null); }
  };

  const proposeOutline = () => run(async () => {
    const r = await newDeckApi.outline(body({ start: start.kind === 'version' ? { kind: 'version', deck_id: start.id } : { kind: 'blank' } }), railPressHeaders(RAIL.outline));
    setOutlineId(r.proposal?.id ?? null); setRows(r.outline.rows); setTouched(true); setProposedBy(r.outline.proposed_by); setReason(r.outline.reason || null);
  }, 'outline');

  const buildDeck = () => run(async () => {
    const r = await newDeckApi.build(body({ proposal_id: outlineId ?? undefined, outline: rows, exclude }), railPressHeaders(RAIL.build));
    onLanded(r);
  }, 'build');

  const applyTemplate = () => run(async () => {
    const r = await api.deckApplyMethod(projectId, start.id, railPressHeaders(RAIL.template));
    onLanded(r);
  }, 'template');

  const options = markRecommended(startOptions(versions, methods.data?.methods || []), recommended.data);
  const standard = standardRows(ctx, length);
  const estimate = estimateLine(quote.build, ctx.averages?.build);
  const warning = rowWarning(rows);
  const stagePlan = availability('stagePlan');
  const reorder = availability('deckActions');
  const inferredStage = ctx.inferred?.stage || null;
  const templateStart = start.kind === 'template';

  return (
    <div className="flex flex-col gap-4" data-testid="pitch-new-page">
      <OneClickBuild projectId={projectId} q="" ctx={ctx} as="section" testId="pitch-new-fast" title={ONE_CLICK_TITLE} line={ONE_CLICK_LINE}
        brief={audience && length ? { audience, length, label, cards: standard.length || null, why: null, round_ref: ctx?.round?.uid ?? null } : null} exclude={exclude} onBuilt={onLanded}>
        {sources.status !== 'idle' ? (
          <div className="max-w-[420px]" data-testid="pitch-new-fast-coverage">
            <CoverageMeter coverage={sources.data?.coverage} status={sources.status} size="S" onRetry={sources.retry} />
          </div>
        ) : null}
      </OneClickBuild>
      <Refusal refusal={refusal} />

      <section className={`${CARD} flex flex-col gap-3 p-4`} aria-labelledby="pitch-new-audience-title" data-testid="pitch-new-audience">
        <h2 id="pitch-new-audience-title" className={H2}>Audience and stage</h2>
        {ctx.inferred?.why ? <span className={SMALL} data-testid="pitch-new-inferred">From your records: {ctx.inferred.why}</span> : null}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Stage" title={stagePlan?.reason} data-testid="pitch-new-stage">
          <span className="w-[70px] text-[12px] font-bold text-axal-muted dark:text-gray-400">Stage</span>
          {STAGES.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === inferredStage} aria-disabled="true" onClick={(e) => e.preventDefault()}
              className={`min-h-[30px] rounded-full border px-2.5 text-[11.5px] font-semibold ${s.id === inferredStage ? 'border-axal-violet text-axal-violet dark:border-violet-400 dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-500'}`}>
              {s.label}
            </button>
          ))}
          {stagePlan && stagePlan.available !== true ? <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500">{LATER}</span> : null}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Audience">
          {ctx.audiences.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={a.id === audience} onClick={() => setAudience(a.id)}
              className={`flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2.5 text-left ${a.id === audience ? 'border-axal-violet bg-axal-lavender dark:border-violet-400 dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}
              data-testid={`pitch-new-audience-${a.id}`}>
              <span className={`text-[13px] font-bold ${INK}`}>{a.label}</span>
              <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{a.line}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2" aria-label="Round" data-testid="pitch-new-round">
            <span className={`text-[13px] font-bold ${INK}`}>Round</span>
            {ctx.round ? (
              <>
                <span className={`font-mono text-[12.5px] ${INK}`}>{roundLine(ctx.round)}</span>
                {ctx.round.reviewed ? <span className={PILL_OK}>Reviewed · counsel approved</span> : <span className={PILL_MU}>Stated · not reviewed by counsel</span>}
              </>
            ) : (
              <>
                <span className={MUTED}>{NO_ROUND}</span>
                <Link to={ROUND_LINK.path} className={LINK}>{ROUND_LINK.text}</Link>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className={`text-[13px] font-bold ${INK}`}>Length</span>
            <div className="flex gap-1 rounded-[9px] bg-axal-ground p-1 dark:bg-gray-800" role="radiogroup" aria-label="Length">
              {ctx.lengths.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={l.id === length} onClick={() => pickLength(l.id)}
                  className={`flex-1 rounded-[7px] px-2 py-1.5 text-[12px] font-bold ${l.id === length ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-900 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}
                  data-testid={`pitch-new-length-${l.id}`}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2" aria-label="Start from">
          <span className={`text-[13px] font-bold ${INK}`}>Start from</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {options.map((op) => {
              const on = op.kind === start.kind && String(op.id) === String(start.id);
              return (
                <button key={`${op.kind}:${op.id}`} type="button" disabled={op.locked} aria-pressed={on} onClick={() => setStart({ kind: op.kind, id: op.id })}
                  className={`flex aspect-[16/10] flex-col justify-between gap-1 rounded-[8px] border p-2 text-left text-[11.5px] font-semibold ${on ? 'border-axal-violet dark:border-violet-400' : 'border-axal-hairline dark:border-gray-700'} ${INK}`}>
                  <span>{op.label}</span>
                  {op.recommended ? <span className={PILL_VIO} data-testid="pitch-new-recommended">Recommended</span> : null}
                  {op.locked ? <span className={PILL_MU}>Plan</span> : null}
                </button>
              );
            })}
          </div>
          {options.filter((op) => op.recommended && op.reason).map((o) => (
            <span key={o.id} className={MUTED} data-testid="pitch-new-recommended-reason">Recommended: {o.label}. {o.reason}</span>
          ))}
          {templateStart ? (
            <span className="flex flex-wrap items-center gap-3">
              <span className={MUTED} data-testid="pitch-new-template-line">{templateStartLine(start.id)}</span>
              <button type="button" className={PRIMARY} data-testid="pitch-new-use-template"
                onClick={() => setDialog({ title: 'Use this template', action: 'Use template', sentence: templateSentence(start.id), go: applyTemplate })}>
                Use this template
              </button>
            </span>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2.5" aria-labelledby="pitch-new-sources-title" data-testid="pitch-new-sources">
        <h2 id="pitch-new-sources-title" className={H2}>Sources</h2>
        <FreshnessLines ctx={ctx} testId="pitch-new-fresh" />
        <SourcesStep items={items} coverage={sources.data?.coverage} status={sources.status} onRetry={sources.retry} onChange={onChosen} />
      </section>

      <section className={`${LAV} flex flex-col gap-3 p-4`} aria-labelledby="pitch-new-outline-title" data-testid="pitch-new-outline">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <h2 id="pitch-new-outline-title" className={H2}>Outline</h2>
            <span className={PILL_VIO}>{proposedBy === 'Eadwyn' ? PROPOSED_BY_EADWYN : 'Standard outline'}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <select className={`${INPUT} w-auto`} aria-label="Add slide" value="" onChange={(e) => change(addRow(rows, e.target.value, ctx.cards))}>
              <option value="">+ Add slide</option>
              {ctx.cards.map((c) => <option key={c.card} value={c.card}>{c.title}</option>)}
            </select>
            <span className="flex items-center gap-1.5" title={reorder?.reason}>
              <button type="button" className={`${GHOST} text-axal-muted dark:text-gray-500`} aria-disabled="true" onClick={(e) => e.preventDefault()} data-testid="pitch-new-reorder">Reorder for stage</button>
              {reorder && reorder.available !== true ? <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500">{LATER}</span> : null}
            </span>
            <button type="button" className={GHOST} disabled={!audience || !length} data-testid="pitch-new-regenerate"
              onClick={() => setDialog({ title: 'Regenerate outline', action: quote.outline?.ai ? `Regenerate · ${aiTokens(quote.outline.hold_microusd)}` : 'Regenerate', sentence: outlineSentence(quote.outline, proposedBy === 'Eadwyn'), hold: quote.outline?.ai ? HOLD(aiTokens(quote.outline.hold_microusd)) : null, go: proposeOutline })}>
              Regenerate outline{quote.outline?.ai ? ` · ${aiTokens(quote.outline.hold_microusd)}` : ''}
            </button>
          </span>
        </div>
        {reason ? <span className={MUTED}>{reason}</span> : null}
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((r, i) => {
            const why = String(r.message || r.purpose || '').trim();
            return (
              <li key={`${r.card}-${i}`} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag != null) change(moveRow(rows, drag, i)); setDrag(null); }}
                className={`${CARD} grid grid-cols-[20px_28px_minmax(0,1fr)] items-start gap-2 p-2.5 sm:grid-cols-[20px_28px_minmax(0,1fr)_auto]`} data-testid={`pitch-new-row-${i}`}>
                <GripVertical size={16} className="mt-1.5 text-axal-muted dark:text-gray-500" aria-hidden="true" />
                <span className="mt-1.5 font-mono text-[12px] text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span>
                <div className="flex min-w-0 flex-col gap-1">
                  <input className={INPUT} aria-label={`Title of card ${i + 1}`} value={r.title} maxLength={80} onChange={(e) => change(editRow(rows, i, { title: e.target.value }))} />
                  {why ? <span className={SMALL} data-testid={`pitch-new-why-${i}`}>{why}</span> : null}
                  <span className="flex flex-wrap gap-1">
                    {chipsFor(r, ctx.cards, items, excludedSet).map((c) => (
                      <span key={c.key} className={c.recorded ? PILL_VIO : PILL_MU}>{c.label}{c.recorded ? '' : ` · ${NOT_ON_STUDIOOS}`}</span>
                    ))}
                  </span>
                </div>
                <span className="col-start-3 flex gap-1 sm:col-start-auto">
                  <button type="button" className={GHOST} aria-label={`Move card ${i + 1} up`} disabled={i === 0} onClick={() => change(moveRow(rows, i, i - 1))}><ArrowUp size={14} aria-hidden="true" /></button>
                  <button type="button" className={GHOST} aria-label={`Move card ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => change(moveRow(rows, i, i + 1))}><ArrowDown size={14} aria-hidden="true" /></button>
                  <button type="button" className={`${GHOST} text-axal-destructive dark:text-red-400`} onClick={() => change(removeRow(rows, i))}>Delete</button>
                </span>
              </li>
            );
          })}
        </ol>
        {!rows.length ? <span className={MUTED}>No card in the outline. Add a slide, or pick a length.</span> : null}
        {warning ? <span role="alert" className="text-[12px] font-semibold text-axal-violet dark:text-violet-300">{warning}</span> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {estimate ? <span className={MUTED} data-testid="pitch-new-estimate">{estimate}</span> : null}
          <button type="button" className={PRIMARY} disabled={!rows.length || Boolean(warning) || !audience || !length || templateStart} data-testid="pitch-new-build"
            onClick={() => setDialog({ title: 'Build deck', action: 'Build deck', sentence: buildSentence(quote.build, rows.length), hold: quote.build?.ai ? HOLD(aiTokens(quote.build.hold_microusd)) : null, go: buildDeck, build: true })}>
            Build deck
          </button>
        </div>
      </section>

      {dialog ? (
        <Confirm {...dialog} busy={busy} onConfirm={dialog.go} onClose={() => setDialog(null)}
          progress={dialog.build ? <BuildProgress cards={rows.length} titles={rows.map((r) => r.title)} startedAt={startedAt} /> : null}
          announce={dialog.build ? buildingLine(rows.length) : null} />
      ) : null}
    </div>
  );
}
