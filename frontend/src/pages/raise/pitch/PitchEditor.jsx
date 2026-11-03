import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { deckEditorApi } from '../../../lib/api/deckEditor';
import { deckSourcesApi } from '../../../lib/api/deckSources';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import useAssistMode from '../../../hooks/useAssistMode';
import { Lightbox, WorkerRail, usePhoneWidth } from '../../../ui';
import { BELOW_MD_QUERY } from '../../../ui/phone/usePhoneWidth';
import { SourcesPanel, useDeckSources } from './SourcesBoards';
import { SlideEvidence } from '../../cycles/evidence/EvidencePart';
import { SOURCES_TITLE } from '../../cycles/evidence/moduleEvidence';
import ImageLightbox from './ImageLightbox';
import { deckImagesApi } from '../../../lib/api/deckImages';
import { ChartLibrary } from './ChartTools';
import { asList, currentVersion, isReadOnly, ventureQuery } from './pitchStudioModel';
import { NEW_PATH } from './newDeckModel';
import PitchPage from './PitchPage';
import DeckToolbar from './DeckToolbar';
import useDeckPresence from './useDeckPresence';
import CardsStrip from './CardsStrip';
import { cardStatus, diagrams, media as uploadVideoAdapter } from './deckV2Adapter';
import { withAssignee, withStatus } from './cardStatusModel';
import GridStage from './GridStage';
import BlockTools, { SpeakerNotes } from './BlockTools';
import { ArrangeSet, DecorLayers } from './BlockTools';
import { isDecorOn } from './arrangeModel';
import ShareDialog from './ShareDialog';
import CommentsSheet from './CommentsSheet';
import { editorCardOf } from './reviewTileModel';
import ExportDialog from './ExportDialog';
import TransitionSheet from './TransitionSheet';
import { BackgroundSheet, BrandKitSheet, CheckSheet, RemixSheet, ReplaceImagesSheet, SizeSheet, SourcesSheet, StageSheet, StructureSheet, ThemeSheet, VersionsSheet } from './DeckSheets';
// D1583 (#3830): ⋯ › This deck › Teaser, one-pager or memo.
import DeriveSheet from './DeriveSheet.jsx';
import { EDITOR_WAITING, aiOffState, editIndex, placeTextEdit, saveChip } from './deckV2Model';
import { AiOffBanner } from './DeckAsk';
import { areaTitle, areasOf, askTarget, liveFocus } from './gridSelection';
import AreaLightbox from './AreaLightbox';
import CritiqueDialog from './CritiqueDialog';
import InstructionBox from './InstructionBox';
import { PitchMovedNotice } from './PitchWorkspaceMoved';
import { acceptUpdate, refreshCard } from './figuresModel';
import { deckUpdateReuseApi } from '../../../lib/api/deckUpdateReuse.js';
import { deckRail } from './deckRailGroups';
import { presentHref } from './presentExportModel';
import { aspectOf, withAspect } from './gridModel';
import { reflowCards } from './deckReflow';
import { movedLine } from './structureModel';
import { scriptOfTheme } from './deckLanguage';
import { apply as applyOp, editKey, emptyHistory, findIn, historyCounts, perform, redo as redoStep, undo as undoStep } from './gridOps';
import { createAutosave, clockOf, idbStore, keyOf, restoreOffer } from './deckAutosave';
import { discardDraft as discardDraftAdapter, draft as draftAdapter, saveCard as saveCardAdapter } from './deckV2Adapter';
import { ConflictView, FindReplaceSheet, RestoreBanner, StillCharged, SyncLine } from './EditingParts';
import usePreflight from './usePreflight';
import { FindingStrip, PreflightGate, PreflightMeasure, PreflightPanel } from './PreflightPanel';
import { gateOf, overlayOf, stepOf, workingDeck } from './preflightUiModel';
import PreflightOverlay from './PreflightOverlay';
import {
  ADDABLE_KINDS, BUTTON_LABEL_MAX, KIND_LABELS, MODEL_FAILED, SECTION_MAX, VIDEO_PROVIDER_LABELS, sectionsOf, NOTES_PLACEHOLDER, NO_CARDS,
  NOT_RECORDED, PHONE_NOTE, READ_FAILED, THEME_LABELS,
  addBlock, applyLayout, blockLabel, cardColours, cardTitle, cardsOf, changesOf, firstFree, isDarkTheme,
  placementProblem, removeBlock, saveState, standardSizes, staleCards, updateBlock, withFieldBlocks,
  withNewUid, pageNumberOf, cardIndexByUid, cardUid, newCardUid,
} from './editorModel';

/**
 * D898 (#2676, part 4 of #2434) — the Pitch deck editor at /raise/pitch/edit,
 * rebuilt for Pitch deck studio v2 (D1604, #3716, pd0, pd3, pd11, pd13):
 *
 *   the header   the crumb, the h1 "[Venture] · vN", then `DeckToolbar.jsx`
 *                (the save state, Save version only while there is something
 *                to save, ⋯, ▶ Present, Share ▾) and the deck's Ask, drawn
 *                as soon as the version is known: Present, Share and Export
 *                need only the version, so they stay while the deck or the
 *                model reads or fails (the ⋯ items wait for the editor). Nothing
 *                else: everything else is in ⋯ (`DeckMoreMenu.jsx`), whose
 *                sheets are `DeckSheets.jsx` (Theme, Brand kit, Sources and
 *                coverage, Versions, Check claims, Structure, Background).
 *   the strip    `CardsStrip.jsx`: every card numbered, its thumbnail, a
 *                stale dot, drag or Alt + ↑ / ↓ to reorder, the card's ⋯;
 *                beside the stage from 1024 px, one scrolling row above it
 *                below that (the tablet, pd9l), so the Grid stays central
 *   the stage    `GridStage.jsx`: the card on The Grid, its areas (blocks and
 *                free ranges) selected by click, shift-click, marquee or the
 *                keyboard (`gridSelection.js`), a block dragged to a free
 *                range, the Ask chip on one area and SELBAR on several
 *   the tools    `BlockTools.jsx`, only while one area is selected, with
 *                the card's speaker notes under it; nothing selected or
 *                several areas: no tools and no notes
 *
 * Every change stays on screen until a version is saved: Save version opens a
 * dialog listing what it changes and writes one new version (`PUT
 * /api/decks/:id`). A refused save shows the Worker's sentence. Each read
 * answers alone: a failed one says so with Try again and blanks nothing else.
 * A reader (read-only HQ) reads, presents and writes nothing. On a phone
 * (below 768 px) the editor is notes and order only (PD26 frame 4); a tablet
 * keeps the Grid, the full header and the strip as a row.
 *
 * D899 (#2678): an empty range's tools hold the Add menu (`AddMenu.jsx`).
 * D1604 (plan §4): the selection's Ask opens "Generate into N areas"
 * (`AreaLightbox.jsx`, its proposals in `AreaResults.jsx`), and the
 * instruction box (`InstructionBox.jsx`) under the stage is the one place to
 * type to Eadwyn, scoped to the selection (docked at the bottom on a phone).
 * What they propose is placed on Accept and written by Save like any other
 * change.
 *
 * D898 group C: a chart block is drawn from its bound series
 * (`ChartTools.jsx`, `GET /api/decks/chart-series`); a selected chart shows
 * its toolbar (PD9c) with the Data popover (PD9); the chart library (PD9b)
 * inserts or edits one.
 *
 * D900 (#2679, part 6): ⋯ › Check claims (`CheckPanel.jsx`, PD13) checks this
 * version against the founder's pinned evidence. "Use [X]'s figure" saves a
 * new version, which the editor then opens as it opens a Save.
 *
 * D1515 (#3767, A4c): every edit is an op of `gridOps.js`, recorded in a
 * 100-step history (`editReducer`): Undo and Redo in the header and ⋯, and
 * Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z (a text field keeps its own undo); Cmd/Ctrl+F
 * opens ⋯ › Find and replace. Apply theme, a structure or layout, Move
 * overflow to notes, Slide size and Accept all are one step each; undoing a
 * step that placed a charged run says it is still charged. The working deck
 * autosaves (`deckAutosave.js`): to the device at once, to the version's
 * draft 1.5 s after the last edit (at most 10 s while typing goes on), with
 * the restore banner on open, the offline line and the conflict view.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const PILL_MU = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const idle = { status: 'idle', data: null };
/** Below `lg` (1024 px): the Cards strip is a row above the stage. */
const NARROW_QUERY = '(max-width: 1023px)';
const loading = { status: 'loading', data: null };
const NO_PICK = { selection: [], focus: null };

/**
 * One read. `retry` reads again from a blank (loading) state; `refresh` reads
 * again keeping what is on screen until the answer comes, and keeps it when
 * that read fails, so nothing keyed to the data unmounts (D1604: a decision
 * in the header Ask must not drop the editor's unsaved cards).
 */
function useRead(key, run, deps) {
  const [state, setState] = useState(key == null ? idle : loading);
  const [tick, setTick] = useState(0);
  const quietly = useRef(false);
  useEffect(() => {
    const quiet = quietly.current;
    quietly.current = false;
    if (key == null) { setState(idle); return undefined; }
    let live = true;
    if (!quiet) setState(loading);
    run().then(
      (data) => { if (live) setState({ status: 'ok', data }); },
      (e) => {
        if (live) setState((was) => (quiet && was.status === 'ok' ? was : { status: 'error', data: null, error: e }));
        reportError('pitch-editor:read', e);
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, ...deps]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  const refresh = useCallback(() => { quietly.current = true; setTick((t) => t + 1); }, []);
  return { ...state, retry, refresh };
}

function ReadFailed({ text, onRetry, testId }) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-2.5 p-4`} role="alert" data-testid={testId}>
      <span className={`text-[13px] font-bold ${INK}`}>{text}</span>
      {onRetry ? <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
    </div>
  );
}

const Skeleton = ({ h = 'h-24', testId }) => <div className={`${SKEL} ${h} w-full`} aria-hidden="true" data-testid={testId} />;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function PitchEditor() {
  const { user } = useAuth();
  const readOnly = isReadOnly(user);
  // The phone editor (notes and order) is below 768 px (pd9k). The tablet,
  // 768 to 1023 px, keeps the desktop header and the Grid, with the Cards
  // strip as one row above the stage (pd9l, plan §8).
  const phone = usePhoneWidth(BELOW_MD_QUERY);
  const narrow = usePhoneWidth(NARROW_QUERY);
  const [params, setParams] = useSearchParams();
  const requested = params.get('project_id');
  const [reportedTitle, setReportedTitle] = useState(null);

  const projects = useRead('ventures', () => api.listProjects(), []);
  const list = asList(projects.data, 'items', 'projects');
  const project = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
  const projectId = project?.id ?? null;
  useEffect(() => {
    if (projectId == null || String(projectId) === String(requested)) return;
    setParams((old) => { const n = new URLSearchParams(old); n.set('project_id', String(projectId)); return n; }, { replace: true });
  }, [projectId, requested, setParams]);

  const versions = useRead(projectId, () => api.deckListVersions(projectId), []);
  const versionList = asList(versions.data, 'versions', 'decks');
  const current = currentVersion(versionList);
  const deck = useRead(current?.id ?? null, () => api.deckGet(current.id).then((r) => r?.deck || r), []);
  const model = useRead('model', () => deckEditorApi.model(), []);
  const kit = useRead(projectId, () => deckEditorApi.brandKit(projectId), []);
  const refresh = useRead(current?.id ?? null, () => deckSourcesApi.refresh(current.id), []);
  const sources = useDeckSources(projectId);
  // D898 group C: the dated series a chart plots (PD9–PD9c).
  const charts = useRead(projectId, () => deckEditorApi.chartSeries(projectId), []);

  const title = reportedTitle?.deckId === deck.data?.id && reportedTitle?.projectId === projectId
    ? reportedTitle.title
    : deck.data ? `${String(project?.name || '').trim() || 'Your venture'} · v${deck.data.version ?? '?'}` : 'Your venture';
  // D1604: the header Ask places a waiting card edit through the open editor.
  const placeRef = useRef(null);
  const onPlace = useCallback((edit) => (placeRef.current ? placeRef.current(edit) : { error: 'The deck is still loading. Try again in a moment.' }), []);
  // A card run or a decision in the editor's own bar changes what waits: the header reads it again.
  const [proposalsTick, setProposalsTick] = useState(0);
  const onProposals = useCallback(() => setProposalsTick((t) => t + 1), []);
  // D4210: a fix asked from the preflight panel opens the header Ask, where it waits.
  const [askOpenKey, setAskOpenKey] = useState(0);
  const onOpenAsk = useCallback(() => setAskOpenKey((t) => t + 1), []);
  // D1604: the header's toolbar reports the open editor's state and calls back into it.
  const [chrome, setChrome] = useState(null);
  const actionRef = useRef(null);
  // Share and Export need only the version on screen, so the page opens them
  // itself, editor or not; every other ⋯ item is the editor's.
  const [shareDialog, setShareDialog] = useState(null);
  // D1577 (#3824): the other members on the deck. Null (nothing drawn) until presence is switched on.
  const presence = useDeckPresence(current?.id ?? null, { live: !readOnly && !phone });
  const youId = presence.you?.user_id ?? user?.id ?? null;
  // D1370 (#3661, pf1c/pf1d): with the editor on screen, Share and Export run the preflight first (its gate),
  // which opens the dialog itself when there is nothing to fix or look at.
  const editorOn = Boolean(chrome);
  const onAction = useCallback((id) => {
    if (id === 'share' || id === 'export') {
      if (readOnly) return;
      if (editorOn && actionRef.current) actionRef.current('gate', id);
      else setShareDialog(id);
      return;
    }
    actionRef.current?.(id);
  }, [readOnly, editorOn]);
  const tools = current?.id ? (
    <DeckToolbar chip={chrome?.chip ?? null} presentTo={presentHref(projectId, current.id)} preflight={chrome?.preflight ?? null} readOnly={readOnly} phone={phone}
      onAction={onAction} labels={chrome?.labels} outOfTokens={Boolean(chrome?.outOfTokens)} waiting={chrome ? null : EDITOR_WAITING} history={chrome?.history ?? null}
      editors={presence.editors} youId={youId} />
  ) : null;
  const overlay = shareDialog === 'share' && projectId != null && current ? (
    <ShareDialog projectId={projectId} deck={current} onClose={() => setShareDialog(null)} onCreated={() => {}}
      onReviewCards={(uid) => { setShareDialog(null); actionRef.current?.('review_cards', uid); }} />
  ) : shareDialog === 'export' && current ? (
    <ExportDialog versions={versionList} current={current} onClose={() => setShareDialog(null)} />
  ) : null;
  // A decision in the header re-reads the versions without blanking them, so the
  // open Editor (keyed to the version) keeps its unsaved cards.
  const shell = {
    query: ventureQuery(projectId || requested), title, tools, overlay, heading: deck.status === 'ok' ? title : null, deckId: current?.id ?? null,
    ask: { projectId, readOnly, onPlace, versions, onChanged: versions.refresh, editsKey: proposalsTick, openKey: askOpenKey },
  };

  if (projects.status === 'error') return <Shell {...shell}><ReadFailed text="Your ventures could not be read." onRetry={projects.retry} testId="pitch-editor-ventures-error" /></Shell>;
  if (projects.status === 'ok' && !project) return <Shell {...shell}><div className={`${CARD} p-5 ${MUTED}`}>Start a venture first, then build its deck.</div></Shell>;
  if (versions.status === 'error') return <Shell {...shell}><ReadFailed text="Your deck's versions could not be read." onRetry={versions.retry} testId="pitch-editor-versions-error" /></Shell>;
  if (versions.status === 'ok' && !current) {
    return (
      <Shell {...shell}>
        <div className={`${CARD} flex flex-col items-start gap-3 p-5`} data-testid="pitch-editor-no-deck">
          <span className={`text-[14px] font-extrabold ${INK}`}>No deck yet.</span>
          <span className={MUTED}>Start one from your records or a template, then edit it here.</span>
          <Link className={PRIMARY} to={`${NEW_PATH}${ventureQuery(projectId)}`}>New deck</Link>
        </div>
      </Shell>
    );
  }
  if (deck.status === 'error') return <Shell {...shell}><ReadFailed text={READ_FAILED} onRetry={deck.retry} testId="pitch-editor-deck-error" /></Shell>;
  if (model.status === 'error') return <Shell {...shell}><ReadFailed text={MODEL_FAILED} onRetry={model.retry} testId="pitch-editor-model-error" /></Shell>;
  if (deck.status !== 'ok' || model.status !== 'ok') return <Shell {...shell}><EditorSkeleton /></Shell>;

  return (
    <Shell {...shell}>
      <Editor
        key={deck.data.id}
        presence={presence}
        youId={youId}
        project={project}
        deck={deck.data}
        model={model.data}
        kit={kit}
        refresh={refresh}
        sources={sources}
        charts={charts}
        versions={versionList}
        readOnly={readOnly}
        phone={phone}
        narrow={narrow}
        onTitle={setReportedTitle}
        onSaved={() => versions.retry()}
        placeRef={placeRef}
        onProposals={onProposals}
        onOpenAsk={onOpenAsk}
        onChrome={setChrome}
        actionRef={actionRef}
        onSend={setShareDialog}
      />
    </Shell>
  );
}

function Shell({ children, query, title, ask, tools, heading, overlay = null, deckId = null }) {
  // D1604 (§5): the rail is the element groups' models and the deck's usage.
  const groups = useMemo(() => deckRail(deckId), [deckId]);
  const rail = <WorkerRail workspace="Raise" role="founder" groups={groups} note="The editor reads your deck and its recorded sources. Each Eadwyn run shows its cost first." data-testid="pitch-editor-rail" />;
  return <PitchPage rail={rail} crumb={{ query, trail: title, tools, heading }} ask={ask} testId="pitch-editor"><PitchMovedNotice />{children}{overlay}</PitchPage>;
}

/** PD24: the header at once; the strip and the card as grey skeletons. */
function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="pitch-editor-loading" aria-busy="true">
      <div className="grid gap-3 lg:grid-cols-[150px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h="h-16" />)}</div>
        <div className="flex flex-col gap-3"><Skeleton h="h-8" /><Skeleton h="h-[360px]" /><span className={MUTED}>Reading…</span><Skeleton h="h-20" /></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor, over one version
// ---------------------------------------------------------------------------

/**
 * D1267 (#3290): the "Sources on Axal" card — the statement layout, titled, its
 * first text block a list, one line per figure (figure, source, date), built
 * from the claims' records. It is an ordinary card: kept only on Save.
 */
export function sourcesCard(model, lines) {
  const layout = (model?.layouts || []).find((l) => l.id === 'statement') || (model?.layouts || [])[0] || { id: 'statement', blocks: [] };
  const { card } = applyLayout({ title: SOURCES_TITLE }, layout);
  const text = (card.blocks || []).find((b) => b.kind === 'text');
  return text ? updateBlock(card, text.id, { style: 'list', text: lines.join('\n') }) : { ...card, notes: lines.join('\n') };
}

/**
 * D1515: the working deck and its history. `perform` takes ops (or a function
 * of the deck as it is at that moment, answering ops or null for no change)
 * and records them as one step; `undone` is the step Undo just took back, so
 * the stage can say a charged run stays charged.
 */
export function editReducer(state, action) {
  switch (action.type) {
    case 'perform': {
      const ops = typeof action.ops === 'function' ? action.ops(state.doc) : action.ops;
      if (!ops || (Array.isArray(ops) && !ops.length)) return state;
      const r = perform(state.doc, state.history, ops, action.meta);
      if (r.error) return state;
      return { doc: r.doc, history: r.history, undone: null };
    }
    case 'undo': {
      const u = undoStep(state.doc, state.history);
      return u ? { doc: u.doc, history: u.history, undone: u.step } : state;
    }
    case 'redo': {
      const u = redoStep(state.doc, state.history);
      return u ? { doc: u.doc, history: u.history, undone: null } : state;
    }
    case 'reset': return { doc: action.doc, history: emptyHistory(), undone: null };
    case 'seen': return state.undone ? { ...state, undone: null } : state;
    default: return state;
  }
}

function Editor({ project, deck, model, kit, refresh, sources, charts, versions, readOnly, phone, narrow = false, onTitle, onSaved, placeRef, onProposals, onOpenAsk = null, onChrome, actionRef, onSend = null, presence = null, youId = null }) {
  const [aiOn] = useAssistMode('raise');
  const navigate = useNavigate();
  const [base, setBase] = useState(() => ({ deck, cards: cardsOf(deck), theme: deck.theme ?? null, audience: deck.audience ?? null }));
  // D1515: the working deck lives in one reducer with its 100-step history; every edit below is an op.
  const [ed, dispatch] = useReducer(editReducer, base, (b) => ({ doc: { cards: b.cards, theme: b.theme, audience: b.audience }, history: emptyHistory(), undone: null }));
  const { cards, theme, audience } = ed.doc;
  const edit = useCallback((ops, meta = {}) => dispatch({ type: 'perform', ops, meta: { ...meta, at: Date.now() } }), []);
  /** `next` is the cards, or a function of the cards as they are now; the same cards back record nothing. */
  const setCards = (next, meta) => edit((doc) => {
    const to = typeof next === 'function' ? next(doc.cards) : next;
    return to === doc.cards ? null : { type: 'setCards', cards: to };
  }, meta);
  const setTheme = (t) => edit({ type: 'setTheme', theme: t }, { label: 'Theme' });
  const setAudience = (a) => edit({ type: 'setAudience', audience: a }, { label: 'Audience' });
  // D4271 (#4271): `?card=<n>` (from 1) opens on that card, and `&comments=1` with its comments, as the Review tile links them.
  const [deepLink] = useSearchParams();
  const [sel, setSel] = useState(() => editorCardOf(deepLink.get('card'), cardsOf(deck).length));
  const [pickState, setPickState] = useState(NO_PICK);
  const [askLine, setAskLine] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [sheet, setSheet] = useState(() => (deepLink.get('comments') === '1' && deepLink.get('card') ? 'comments' : null));
  // D1513 (#3765): what the last structure moved to the speaker notes, until the card changes.
  const [structureNote, setStructureNote] = useState(null);
  const [compare, setCompare] = useState(null);
  // PD-9: a run or a quote refused for tokens (a 402) turns Ask off for the
  // session; adding tokens leaves the page, so the next visit starts on.
  const [outOfTokens, setOutOfTokens] = useState(false);
  const onTokens = useCallback(() => setOutOfTokens(true), []);
  const off = aiOffState({ aiOn, outOfTokens });

  const next = { cards, theme, audience };
  const changes = useMemo(() => changesOf(base, next, model), [base, cards, theme, audience, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = changes.length > 0;
  const stale = useMemo(() => staleCards(refresh.data), [refresh.data]);
  const card = cards[sel] || null;
  const kitData = kit.status === 'ok' ? kit.data?.kit ?? null : null;
  // D1370 (#3661): Check before you send, on the deck as it is on screen; a result for another state reads "Out of date".
  const working = useMemo(() => workingDeck(base.deck, cards, theme), [base.deck, cards, theme]);
  const pf = usePreflight({ deck: working, kit: kitData, refresh: refresh.status === 'ok' ? refresh.data : null, readOnly });
  const [gate, setGate] = useState(null);
  const [finding, setFinding] = useState(null);
  const colours = cardColours(theme, kitData);
  // D903: a background's overlay is in the brand ink, never the dark theme's light text colour.
  const ink = isDarkTheme(theme?.kind) ? undefined : colours.ink;
  const items = sources.data?.items || [];
  const [images, setImages] = useState([]);
  // D1579 (#3826): who a card can be assigned to (D1570's people), from the card-status read; null until read.
  const statusRead = useRead(base.deck.id, () => cardStatus(base.deck.id), []);
  const people = statusRead.status === 'ok' && statusRead.data?.available === true && Array.isArray(statusRead.data.value?.people) ? statusRead.data.value.people : null;
  const loadImages = useCallback(() => {
    if (readOnly) return;
    deckImagesApi.list(base.deck.id).then((r) => setImages(r?.images || []), (e) => reportError('pitch-images:list', e));
  }, [base.deck.id, readOnly]);
  useEffect(() => { loadImages(); }, [loadImages]);

  // The selection on The Grid: ids that left the card (a block removed, a free
  // range filled) drop out of it on their own.
  const areas = useMemo(() => areasOf(card, model), [card, model]);
  // D1533: a decor item (`decor:<id>`, from the layers list) stays selected while it is on the card.
  const selection = pickState.selection.filter((id) => (areas || []).some((a) => a.id === id) || isDecorOn(card, id));
  // D1577 (#3824): the area this member is in is theirs (a soft lock) while they edit it; the room says
  // "Wait or ask [Name]" when another member holds it. One area, or none when several or none are picked;
  // a decor item (D1533) is not an area, so picking one claims none.
  const claimArea = selection.length === 1 && (areas || []).some((a) => a.id === selection[0]) ? selection[0] : null;
  const claimCard = card?.uid ?? null;
  const claim = presence?.claim;
  useEffect(() => { if (claim && !readOnly) claim(claimCard, claimArea); }, [claim, claimCard, claimArea, readOnly]);
  const chosen = (areas || []).filter((a) => selection.includes(a.id));
  const one = chosen.length === 1 ? chosen[0] : null;
  // The focus too: a free range a block now covers hands it to that block.
  const focus = liveFocus(areas, pickState.focus);
  const selKey = selection.join('|');
  useEffect(() => { setAskLine(null); }, [selKey, sel]);
  const choose = (i) => { setSel(i); setPickState(NO_PICK); };
  const selectBlock = (id) => setPickState({ selection: id == null ? [] : [String(id)], focus: id == null ? null : String(id) });

  // D1577: each change keeps this member's soft lock on the area (presence?.edit?.()).
  const setCard = (i, c, meta) => { edit((doc) => (doc.cards[i] && doc.cards[i] !== c ? { type: 'setCard', index: i, card: c } : null), meta); presence?.edit?.(); };
  // D1500: a result goes back onto the card it was made for, by its uid,
  // wherever that card sits now; a card with no uid falls back to the selection.
  // D1515: an accepted proposal is `insertProposal`, one step (Accept all's share a group), marked when it was charged.
  const placeCard = (c, meta = {}) => edit((doc) => {
    const uid = cardUid(c);
    const i = uid ? cardIndexByUid(doc.cards, uid) : sel;
    return i >= 0 && i < doc.cards.length && doc.cards[i] !== c ? { type: 'insertProposal', index: i, card: c } : null;
  }, { label: 'Accept', ...meta });

  // D1604: a card edit accepted from the header Ask. Checked against the cards
  // on screen first; `commit()` then places it, synchronously, against the
  // cards as they are at that moment and answers `{ error }` or `{ undo }`.
  // The sheet records the decision only after the edit is placed, and undoes
  // the placement when that decision is refused. Held until Save like every
  // other edit.
  const cardsNow = useRef(cards);
  cardsNow.current = cards;
  const setCardsRef = useRef(setCards);
  setCardsRef.current = setCards;
  useEffect(() => {
    if (!placeRef) return undefined;
    placeRef.current = readOnly ? null : (edit) => {
      const place = (cs) => {
        if (edit.kind === 'text') return placeTextEdit(cs, edit);
        const at = cs[editIndex(cs, edit)];
        if (!at) return { error: `Card ${edit.card + 1} is no longer in this deck. Discard this proposal.` };
        const grid = firstFree(at, edit.size.cols, edit.size.rows, model);
        if (!grid) return { error: `No free ${edit.size.cols} × ${edit.size.rows} range on card ${edit.card + 1}. Remove a block, then accept.` };
        return addBlock(at, { ...edit.block, grid }, model);
      };
      const check = place(cardsNow.current);
      if (check.error) return { error: check.error };
      return {
        commit: (group = null) => {
          const r = place(cardsNow.current);
          if (r.error) return { error: r.error };
          // D1500: the card the edit was made for, by uid, wherever it sits now.
          const where = editIndex(cardsNow.current, edit);
          const was = cardsNow.current[where];
          const put = (from, to) => (cs) => cs.map((x) => (x === from ? to : x));
          // The next check (Accept all's next edit) sees this one at once.
          cardsNow.current = put(was, r.card)(cardsNow.current);
          // D1515: one undo step (Accept all's share `group`), and the run behind it was charged.
          setCardsRef.current(put(was, r.card), { label: 'Accept', charged: true, group });
          setSel(where); setPickState(NO_PICK);
          return {
            // Back to the card as it was, unless something changed it since.
            undo: () => { cardsNow.current = put(r.card, was)(cardsNow.current); setCardsRef.current(put(r.card, was), { label: 'Accept refused' }); },
          };
        },
      };
    };
    return () => { placeRef.current = null; };
  }, [placeRef, readOnly, model]);
  const move = (from, to) => { edit({ type: 'moveCard', from, to }, { label: 'Move card' }); setSel(to); setPickState(NO_PICK); };

  // D1554 (#3801): ⋯ › Slide size reflows the draft; what no longer fits moves
  // to each card's notes (`deckReflow.js`). One Undo, while the sheet is open,
  // puts the cards and the size back as they were.
  // D1515: the size and its reflow are one op (`setDoc`), so one step; the sheet's Undo is the history's.
  const [sizeUndo, setSizeUndo] = useState(null);
  const changeSize = (aspect) => {
    if (aspectOf(theme?.aspect) === aspect) return;
    const r = reflowCards(cards, aspect, scriptOfTheme(theme));
    setSizeUndo(r.count ? { count: r.count } : null);
    edit({ type: 'setDoc', parts: { cards: r.cards, theme: withAspect(theme, aspect) } }, { label: 'Slide size' });
  };
  const undoSize = () => {
    if (!sizeUndo) return;
    dispatch({ type: 'undo' });
    setSizeUndo(null);
  };

  // D1515: the autosave client (`deckAutosave.js`) on D1501's draft routes, through the adapter.
  const autosave = useRef(null);
  const [sync, setSync] = useState(null);
  const [offer, setOffer] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const deckId = base.deck.id;
  useEffect(() => {
    if (readOnly || deckId == null) return undefined;
    const store = idbStore();
    const a = createAutosave({ deckId, save: saveCardAdapter, store, onChange: setSync });
    a.base(cardsOf(deck));
    // Nothing is sent until the restore question, if any, is answered.
    a.hold(true);
    autosave.current = a;
    let live = true;
    const opened = { cards: cardsOf(deck), theme: deck.theme ?? null, audience: deck.audience ?? null };
    Promise.all([store ? store.get(keyOf(deckId)) : null, draftAdapter(deckId)]).then(([local, d]) => {
      if (!live) return;
      const draftRead = d?.available ? d.value : null;
      if (draftRead) a.prime(draftRead.cards);
      const o = restoreOffer({ doc: opened, local, draft: draftRead });
      if (o) setOffer(o); else a.hold(false);
    }, (e) => { reportError('pitch-editor:draft', e); if (live) a.hold(false); });
    const online = () => a.retry();
    // Unsent edits: the browser asks before the tab closes (the device copy keeps them either way).
    const leaving = (e) => { if (a.pending()) { e.preventDefault?.(); e.returnValue = ''; } };
    globalThis.addEventListener?.('online', online);
    globalThis.addEventListener?.('beforeunload', leaving);
    return () => {
      live = false; a.dispose(); autosave.current = null;
      globalThis.removeEventListener?.('online', online);
      globalThis.removeEventListener?.('beforeunload', leaving);
    };
    // The version read once: a new version remounts the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, readOnly]);
  useEffect(() => { autosave.current?.edit(ed.doc); }, [ed.doc]);
  const restore = () => {
    if (!offer) return;
    autosave.current?.revisions(offer.revs);
    autosave.current?.hold(false);
    edit({ type: 'setDoc', parts: offer.doc }, { label: 'Restore unsaved changes' });
    setOffer(null); setPickState(NO_PICK);
  };
  const discardOffer = () => {
    if (!offer) return;
    setRestoring(true);
    discardDraftAdapter(deckId).then(() => autosave.current?.discard(cardsOf(deck))).then(() => {
      setRestoring(false); setOffer(null); autosave.current?.hold(false);
    });
  };
  // pd9q: the card another tab or member saved first.
  const conflict = sync?.conflict ?? null;
  const conflictAt = conflict ? cardIndexByUid(cards, conflict.uid) : -1;
  const keepTheirs = (copy) => {
    const a = autosave.current;
    if (!a || !conflict) return;
    const theirs = a.resolve(copy ? 'copy' : 'theirs');
    if (!theirs) return;
    edit((doc) => {
      const i = cardIndexByUid(doc.cards, conflict.uid);
      if (i < 0) return null;
      const placed = { type: 'setCard', index: i, card: { ...theirs, uid: conflict.uid } };
      return copy ? [placed, { type: 'insertCard', index: i + 1, card: withNewUid(conflict.mine) }] : placed;
    }, { label: copy ? 'Copy mine to a new card' : 'Keep theirs' });
  };

  // D1515: Undo, Redo and Find, from the header, ⋯ and the keyboard.
  const undo = () => dispatch({ type: 'undo' });
  const redo = () => dispatch({ type: 'redo' });
  const counts = historyCounts(ed.history);
  const docNow = useRef(ed.doc);
  docNow.current = ed.doc;
  const findReplace = (q) => {
    const op = { type: 'findReplace', ...q };
    const r = applyOp(docNow.current, op);
    if (r.error) return { error: r.error };
    const count = findIn(docNow.current, q).matches;
    edit(op, { label: 'Find and replace' });
    return { count };
  };
  useEffect(() => {
    if (readOnly || phone) return undefined;
    const onKey = (e) => {
      const k = editKey(e);
      if (!k) return;
      e.preventDefault?.();
      if (k === 'find') setSheet('find');
      else dispatch({ type: k });
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [readOnly, phone]);

  const saved = (fresh) => {
    const d = fresh?.deck || fresh;
    const b = { deck: d, cards: cardsOf(d), theme: d.theme ?? null, audience: d.audience ?? null };
    // D1515: this version's draft and its device copy are no longer needed once it is saved as a version.
    autosave.current?.forget();
    if (base.deck?.id != null) discardDraftAdapter(base.deck.id);
    setBase(b); dispatch({ type: 'reset', doc: { cards: b.cards, theme: b.theme, audience: b.audience } }); setDialog(null); setSheet(null);
    onSaved?.();
  };

  const title = `${String(project?.name || '').trim() || 'Your venture'} · v${base.deck.version ?? '?'}`;
  useEffect(() => { onTitle({ deckId: deck.id, projectId: project?.id, title }); }, [deck.id, project?.id, title, onTitle]);
  const state = saveState({ dirty, savedAt: base.deck.created_at, readOnly, version: base.deck.version });

  // The header's toolbar (`DeckToolbar`, drawn by the page) reads this state and
  // calls back here for Save, Share, Export and the ⋯ items.
  const chip = saveChip({ dirty, readOnly, when: state, version: base.deck.version, sync: sync ? { ...sync, clock: clockOf(sync.at) } : null });
  const appendixLabel = card?.appendix ? 'Not an appendix' : 'Mark as appendix';
  useEffect(() => {
    onChrome?.({ chip, preflight: pf.chip, outOfTokens, history: readOnly ? null : counts, labels: { appendix: appendixLabel, ...(readOnly ? { notes: 'Leave a note' } : {}) } });
  }, [chip.text, chip.title, chip.save, appendixLabel, readOnly, outOfTokens, counts.undo, counts.redo, pf.chip?.text, pf.chip?.tone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onChrome?.(null), [onChrome]);

  // D1500: a duplicate is a new card, with its own uid (`duplicateCard` copies it whole).
  const duplicate = (i) => {
    if (!cards[i]) return;
    edit({ type: 'duplicateCard', index: i, uid: newCardUid() }, { label: 'Duplicate' });
    setSel(i + 1); setPickState(NO_PICK);
  };
  const toggleAppendix = (i) => {
    const c = cards[i];
    if (!c) return;
    edit({ type: 'setFlag', index: i, key: 'appendix', value: c.appendix ? undefined : true }, { label: 'Appendix' });
  };
  const act = (id, arg) => {
    // D1579 (#3826): the pre-share confirm's Review cards: the first card not Done, by its uid.
    if (id === 'review_cards') { const at = cards.findIndex((c) => c?.uid === arg); if (at >= 0) choose(at); return; }
    if (id === 'save') { if (!readOnly && dirty) setDialog({ kind: 'save' }); return; }
    if (id === 'save_named') { if (!readOnly) setDialog({ kind: 'save', named: true }); return; }
    if (id === 'duplicate') { if (!readOnly) duplicate(sel); return; }
    if (id === 'appendix') { if (!readOnly) toggleAppendix(sel); return; }
    if (id === 'notes') { navigate(`/raise/pitch/notes${ventureQuery(project?.id)}`); return; }
    if (id === 'undo') { if (!readOnly) undo(); return; }
    if (id === 'redo') { if (!readOnly) redo(); return; }
    // D1370 (#3661): ⋯ › Before you send › Check before you send, and the toolbar chip. The first open runs it.
    if (id === 'preflight') { setFinding(null); setSheet('preflight'); if (!pf.result && !pf.running) pf.run(); return; }
    // D1370 (pf1c/pf1d): Share and Export from the page: check first, then the gate or the dialog.
    if (id === 'gate') { if (readOnly || (arg !== 'share' && arg !== 'export')) return; setGate(arg); if (!pf.current && !pf.running) pf.run(); return; }
    // D1552 (#3799): ⋯ › Whole deck · uses AI › Fix with critique.
    if (id === 'critique') { if (!readOnly) setDialog({ kind: 'critique' }); return; }
    // D1553 (#3800): ⋯ › This card › Remix this slide, the only way in (pd13).
    // D1561 (#3808): ⋯ › Stage and ⋯ › Reorder for stage open the same stage sheet (pd23).
    if (id === 'stage' || id === 'reorder') { setSheet('stage'); return; }
    if (id === 'replace_images') { if (!readOnly) setSheet('replace_images'); return; }
    if (['theme', 'size', 'brand', 'sources', 'versions', 'check', 'structure', 'background', 'transition', 'remix', 'derive', 'comments', 'find'].includes(id)) setSheet(id);
  };
  if (actionRef) actionRef.current = act;
  const cardAction = (id, i, value) => {
    if (readOnly) return;
    // D1579 (#3826): Set status › and Assign ›, edits held until a version is saved; the save tells a new assignee.
    if (id === 'status' && cards[i]) { setCard(i, withStatus(cards[i], value)); return; }
    if (id === 'assign' && cards[i]) { setCard(i, withAssignee(cards[i], value)); return; }
    if (id === 'duplicate') duplicate(i);
    else if (id === 'up' && i > 0) move(i, i - 1);
    else if (id === 'down' && i < cards.length - 1) move(i, i + 1);
    else if (id === 'appendix') toggleAppendix(i);
    // D1545 (#3788): Hide / Show and Move to section, each through its own in-page dialog, held until a version is saved.
    else if (id === 'hide' && cards[i]) setDialog({ kind: 'hide', index: i });
    else if (id === 'section' && cards[i]) setDialog({ kind: 'section', index: i });
    // D1570 (#3817, pd33): the card's threads, on that card.
    else if (id === 'comments' && cards[i]) { choose(i); setSheet('comments'); }
  };

  // The selection's Ask opens "Generate into N areas" (`AreaLightbox.jsx`) on
  // the areas as they are now; a figure bound to a record says why not.
  const askOff = off?.ask ?? null;
  const ask = () => {
    const t = askTarget(areas, selection, { aiOn, items });
    if (!t || t.kind === 'off') return;
    if (t.kind === 'refused') { setAskLine(t.why); return; }
    setAskLine(null);
    setDialog({ kind: 'areas', areas: (areas || []).filter((a) => t.ids.includes(a.id)) });
  };

  // D1370 (#3661): Show me selects the finding's card and block and leaves the strip over the slide (pf5g).
  const show = (row) => {
    const i = row?.card ?? row?.firstCard;
    if (!Number.isInteger(i) || i < 0 || i >= cards.length) return;
    choose(i);
    if (row.block != null) selectBlock(row.block);
    setSheet(null); setGate(null); setFinding(row.id);
  };
  const stripRows = pf.groups ? [...pf.groups.fix, ...pf.groups.look, ...pf.groups.unchecked] : [];
  const gateView = gate && !pf.running && pf.current ? gateOf(pf.groups, gate) : null;
  useEffect(() => {
    if (!gate || pf.running) return;
    // A check that finished on an older state of the deck runs again on this one.
    if (!pf.current) { pf.run(); return; }
    if (gateView && !gateView.open) { setGate(null); onSend?.(gate); }
  }, [gate, pf.running, pf.current, gateView?.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const staleMap = useMemo(() => {
    const m = new Map();
    for (const r of Array.isArray(refresh.data?.rows) ? refresh.data.rows : []) if (r.state === 'stale') m.set(r.source_key, r.bound?.as_of || null);
    return m;
  }, [refresh.data]);

  return (
    <>
      {!readOnly ? <AiOffBanner state={off} /> : null}
      {finding && !sheet && !gate ? (
        <FindingStrip rows={stripRows} id={finding} onStep={show} onBack={() => { setFinding(null); setSheet('preflight'); }} onClose={() => setFinding(null)} />
      ) : null}
      {/* D1370 (#3661, PF3): the finding drawn on its slide, as it was checked. */}
      {finding && !sheet && !gate && pf.snapshot ? (() => {
        const step = stepOf(stripRows, finding);
        const row = stripRows[step.index];
        const ov = overlayOf(row, { n: step.index + 1, aspect: pf.snapshot.theme?.aspect === '4:3' ? '4:3' : '16:9', current: pf.current });
        return ov ? <PreflightOverlay overlay={ov} card={pf.snapshot.slides?.[ov.card]} theme={pf.snapshot.theme} kit={kitData} /> : null;
      })() : null}
      {phone ? (
        <PhoneEditor cards={cards} sel={sel} setSel={choose} move={move} card={card} readOnly={readOnly}
          onNotes={(v) => edit({ type: 'setFlag', index: sel, key: 'notes', value: v }, { label: 'Notes', coalesce: `notes:${cardUid(card) ?? sel}` })} notesMax={model.notes_max}
          deckId={base.deck.id} items={items} aiOn={aiOn} off={off} onTokens={onTokens} model={model} onPlace={placeCard} onProposals={onProposals} />
      ) : (
        <div className={`grid gap-3 ${narrow ? '' : 'lg:grid-cols-[150px_minmax(0,1fr)]'}`} data-testid="pitch-editor-body">
          <div className="flex min-w-0 flex-col gap-2">
            <CardsStrip theme={theme} cards={cards} sel={sel} stale={stale} readOnly={readOnly} onSelect={choose} move={move}
              onCardAction={cardAction} orientation={narrow ? 'row' : 'column'} people={people}
              onAdd={() => {
                const layout = model.layouts.find((l) => l.id === 'statement') || model.layouts[0];
                const fresh = withNewUid(applyLayout({ title: 'New card' }, layout).card);
                edit({ type: 'insertCard', index: cards.length, card: fresh }, { label: 'New card' }); setSel(cards.length); setPickState(NO_PICK);
              }} />
            {refresh.status === 'error' ? <ReadFailed text="Which figures have changed could not be read." onRetry={refresh.retry} testId="pitch-editor-refresh-error" /> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {/* D1515: the restore question, the offline line, the conflict view and "Still charged", above the stage. */}
            {offer && !readOnly ? <RestoreBanner at={offer.at} busy={restoring} onRestore={restore} onDiscard={discardOffer} /> : null}
            {!readOnly ? <SyncLine sync={sync} /> : null}
            {conflict && conflictAt >= 0 && !readOnly ? (
              <ConflictView conflict={conflict} index={conflictAt} onMine={() => autosave.current?.resolve('mine')}
                onTheirs={() => keepTheirs(false)} onCopy={() => keepTheirs(true)} />
            ) : null}
            {ed.undone?.charged ? <StillCharged onClose={() => dispatch({ type: 'seen' })} /> : null}
            {structureNote ? <span className={MUTED} role="status" data-testid="pitch-editor-structure-note">{structureNote} The speaker notes keep each one.</span> : null}
            {cards.length === 0 ? <div className={`${CARD} p-6 ${MUTED}`}>{NO_CARDS}</div> : (
              <GridStage card={card} index={sel} model={model} colours={colours} ink={ink} theme={theme} kit={kit} charts={charts} pageLabel={pageNumberOf(cards, sel)}
                readOnly={readOnly} selection={selection} focus={focus}
                onSelection={setPickState}
                editors={presence?.editors ?? null} youId={youId} lockLine={presence?.locked ?? null} onPointer={presence?.cursor ?? null}
                // D1515: a drag is one step; a nudge burst on one block is one step (800 ms).
                onMove={(id, grid) => { edit({ type: 'moveArea', index: sel, id, grid }, { label: 'Move block', coalesce: `move:${cardUid(card) ?? sel}:${id}` }); presence?.edit?.(); }}
                // D1513: a divider move (both blocks) and its overflow are each one edit, so one undo step.
                onCard={(next, why) => { setCard(sel, next, { label: why === 'overflow' ? 'Move overflow to notes' : why === 'diagram' ? 'Edit diagram' : 'Move divider' }); setStructureNote(null); }}
                // D1542 (#3780): an edited diagram checked in code (fit, figures); free, nothing saved.
                onDiagramCheck={base.deck?.id != null ? (diagram, grid) => diagrams(base.deck.id, { diagram, grid, card: sel }) : null}
                onDecor={(item) => setCard(sel, { ...card, decor: [...(card.decor || []), item] })}
                onAsk={ask} askOff={askOff} askLine={askLine}
                items={items} onRefresh={() => { const r = refreshCard(card, items, charts); if (r.moved) setCard(sel, r.card, { label: 'Refresh figures' }); }}
                // D1584 (#3831): the latest investor update's figures, proposed; Accept places them like Refresh from records.
                onUpdateDerive={base.deck?.id != null ? () => deckUpdateReuseApi.deriveUpdate(base.deck.id) : null}
                onUpdateAccept={(proposals) => { const r = acceptUpdate(card, proposals, items); if (r.moved) setCard(sel, r.card); }} />
            )}
            {/* D1533 (#3777, pd26): the Arrange set, only while an area or decor item is selected; then the card's decor layers. */}
            {card && !readOnly && selection.length ? (
              <ArrangeSet card={card} selection={selection} aspect={aspectOf(theme?.aspect)} model={model} onCard={(next) => setCard(sel, next)} />
            ) : null}
            {card ? <DecorLayers card={card} selection={selection} readOnly={readOnly} onSelection={setPickState} /> : null}
            {card && !readOnly && chosen.length ? (
              <InstructionBox deckId={base.deck.id} cardIndex={sel} card={card} areas={chosen} items={items} aiOn={aiOn} onTokens={onTokens}
                onRemove={(id) => setPickState((p) => ({ selection: p.selection.filter((x) => x !== id), focus: p.focus }))}
                onPlace={placeCard} onProposals={onProposals} />
            ) : null}
            {card && !readOnly && (one || !areas) ? (
              <BlockTools card={card} cardIndex={sel} area={one} model={model} charts={charts} images={images} items={items}
                deckId={base.deck.id} accent={colours.accent}
                // D1515: typing in one block is one step per 800 ms pause; `paras: null` makes the block plain again.
                onPatch={(patch, how) => {
                  const { paras, ...rest } = patch;
                  const typed = how?.typed === true;
                  edit({ type: 'updateBlock', index: sel, id: one.block.id, patch: paras === null ? rest : patch, ...(paras === null ? { drop: ['paras'] } : {}) },
                    { label: typed ? 'Typing' : 'Block', ...(typed ? { coalesce: `text:${cardUid(card) ?? sel}:${one.block.id}` } : {}) });
                }}
                onRemove={() => setDialog({ kind: 'remove-block', id: one.block.id })}
                onChartLibrary={(edit, range) => setDialog({ kind: 'charts', edit: edit || null, range: range || null })}
                onAddBlock={(range, kind) => setDialog({ kind: 'add-block', range: range || null, initial: kind })}
                onImage={(use, replace) => setDialog({ kind: 'image', use, replace: replace || null })}
                onDesign={() => setSheet('structure')}
                onPlace={placeCard}
                onAddCard={(c) => { edit({ type: 'insertCard', index: cards.length, card: withNewUid(c) }, { label: 'New card' }); setSel(cards.length); setPickState(NO_PICK); }} />
            ) : null}
            {card && (one || !areas) ? (
              <SpeakerNotes card={card} index={sel} readOnly={readOnly} notesMax={model.notes_max}
                onNotes={(v) => edit({ type: 'setFlag', index: sel, key: 'notes', value: v }, { label: 'Notes', coalesce: `notes:${cardUid(card) ?? sel}` })} />
            ) : null}
          </div>
        </div>
      )}

      {sheet === 'theme' ? (
        <ThemeSheet model={model} theme={theme} audience={audience} kit={kit} readOnly={readOnly}
          onTheme={setTheme} onAudience={setAudience} onApplyAll={() => setDialog({ kind: 'apply-all' })} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'find' ? (
        <FindReplaceSheet doc={ed.doc} readOnly={readOnly} onReplace={findReplace} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'size' ? <SizeSheet theme={theme} readOnly={readOnly} onSize={changeSize} moved={sizeUndo?.count ?? 0} onUndo={undoSize}
        onClose={() => { setSizeUndo(null); setSheet(null); }} /> : null}
      {sheet === 'structure' && card ? (
        <StructureSheet model={model} card={card} index={sel} readOnly={readOnly} onLayout={(layout) => setDialog({ kind: 'layout', layout })}
          // D1513 (#3765): a structure is one edit; what has no area is already in the notes.
          onStructure={(r) => { edit({ type: 'setStructure', index: sel, structure: r.card.structure }, { label: 'Structure' }); setPickState(NO_PICK); setSheet(null); setStructureNote(r.count ? `${movedLine(r.count)}.` : null); }}
          onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'background' && card ? (
        <BackgroundSheet card={card} index={sel} readOnly={readOnly} onBackground={(bg) => edit({ type: 'setFlag', index: sel, key: 'background', value: bg }, { label: 'Background' })}
          onImage={() => { setSheet(null); setDialog({ kind: 'image', use: 'card' }); }} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'transition' && card ? (
        <TransitionSheet card={card} index={sel} readOnly={readOnly} onTransition={(t) => edit({ type: 'setFlag', index: sel, key: 'transition', value: t ?? undefined }, { label: 'Transition' })} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'derive' && base.deck?.id ? (
        <DeriveSheet deckId={base.deck.id} version={base.deck.version ?? null} dirty={dirty} readOnly={readOnly} aiOn={aiOn} outOfTokens={outOfTokens}
          onProposed={onProposals} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'brand' ? <BrandKitSheet projectId={project?.id ?? null} deckId={base.deck?.id ?? null} kit={kit} readOnly={readOnly} dirty={dirty} onApplied={saved} onClose={() => setSheet(null)} /> : null}
      {sheet === 'versions' ? (
        <VersionsSheet projectId={project?.id ?? null} versions={versions} readOnly={readOnly} dirty={dirty} phone={phone}
          compare={compare} onCompare={setCompare} onRestored={() => { setCompare(null); setSheet(null); onSaved?.(); }} onClose={() => { setCompare(null); setSheet(null); }} />
      ) : null}
      {sheet === 'sources' ? (
        <SourcesSheet onClose={() => setSheet(null)}>
          {refresh.status === 'error' ? <ReadFailed text="Which figures have changed could not be read." onRetry={refresh.retry} testId="pitch-sheet-refresh-error" /> : null}
          <SourcesPanel items={items} status={sources.status} onRetry={sources.retry} stale={staleMap} />
          {/* D1267 (#3290, VR7): the claims this slide states, and the optional Sources on Axal card. */}
          <SlideEvidence projectId={project?.id} version={base.deck.version} slide={sel + 1} readOnly={readOnly}
            onAddSources={(lines) => { const c = withNewUid(sourcesCard(model, lines)); edit({ type: 'insertCard', index: cards.length, card: c }, { label: 'Sources card' }); setSel(cards.length); setPickState(NO_PICK); setSheet(null); }} />
        </SourcesSheet>
      ) : null}
      {sheet === 'remix' && card && base.deck?.id ? (
        <RemixSheet deckId={base.deck.id} card={card} index={sel} readOnly={readOnly}
          onApply={(next) => {
            // One edit, one undo step: Undo puts the card back as it was, unless something changed it since.
            const i = sel;
            const was = cardsNow.current[i];
            setCards((cs) => cs.map((x, j) => (j === i && x === was ? next : x)), { label: 'Remix' });
            setPickState(NO_PICK);
            return () => setCards((cs) => cs.map((x, j) => (j === i && x === next ? was : x)), { label: 'Remix undone' });
          }}
          onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'comments' && card && base.deck?.id ? (
        <CommentsSheet deckId={base.deck.id} card={card} index={sel} area={chosen.length === 1 ? chosen[0].id : null} admin={readOnly} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'replace_images' && base.deck?.id ? (
        <ReplaceImagesSheet deckId={base.deck.id} readOnly={readOnly} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'stage' && base.deck?.id ? (
        <StageSheet deckId={base.deck.id} readOnly={readOnly} dirty={dirty} onReordered={saved} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'preflight' ? (
        <PreflightPanel pf={pf} version={base.deck.version ?? null} readOnly={readOnly} deckId={aiOn ? base.deck.id : null} tokensOut={outOfTokens}
          onTokens={onTokens} onProposals={onProposals} onOpenAsk={onOpenAsk} onShow={show} onClose={() => setSheet(null)} />
      ) : null}
      {gate && (pf.running || gateView?.open) ? (
        <PreflightGate gate={gateView} progress={pf.running ? pf.progress : null} version={base.deck.version ?? null} dirty={dirty} onShow={show}
          onFix={() => { setGate(null); setSheet('preflight'); }} onAnyway={() => { const k = gate; setGate(null); onSend?.(k); }} onClose={() => setGate(null)} />
      ) : null}
      {pf.running && pf.running.done < pf.running.total ? (
        <PreflightMeasure key={pf.running.done} card={pf.running.snapshot.slides[pf.running.done]} index={pf.running.done} theme={pf.running.snapshot.theme} kit={kitData} onMeasured={pf.onMeasured} />
      ) : null}
      {/* #3661 pf5c: one slide that couldn't be checked, measured again on its own. */}
      {!pf.running && pf.retrying && pf.snapshot ? (
        <PreflightMeasure key={`retry-${pf.retrying.index}`} card={pf.snapshot.slides[pf.retrying.index]} index={pf.retrying.index} theme={pf.snapshot.theme} kit={kitData} onMeasured={pf.onRetried} />
      ) : null}
      {sheet === 'check' && base.deck?.id ? (
        <CheckSheet deck={base.deck} projectId={project?.id} readOnly={readOnly} dirty={dirty} onReplaced={saved}
          onGoToCard={(i) => { if (i >= 0 && i < cards.length) { choose(i); setSheet(null); } }} onClose={() => setSheet(null)} />
      ) : null}

      {dialog?.kind === 'save' ? (
        <SaveDialog changes={changes} named={Boolean(dialog.named)} initialName={base.deck.title || ''} onClose={() => setDialog(null)} onSaved={saved}
          save={(name) => api.deckUpdate(base.deck.id, { slides: cards, title: name ?? base.deck.title, theme, audience })} />
      ) : null}
      {dialog?.kind === 'hide' && cards[dialog.index] ? (() => {
        const i = dialog.index;
        const hidden = cards[i].hidden === true;
        return (
          <ConfirmDialog title={hidden ? `Show card ${i + 1} again?` : `Hide card ${i + 1}?`} testId="pitch-editor-hide-dialog"
            lines={hidden
              ? ['Present, the share link, the PDF and every export include it again.', 'Nothing is saved until you save a version.']
              : ['Present, the share link, the PDF and every export leave it out. It stays here in the editor, dimmed and tagged Hidden.', 'Nothing is saved until you save a version.']}
            confirm={hidden ? 'Show card' : 'Hide card'} onClose={() => setDialog(null)}
            onConfirm={() => { edit({ type: 'hideCard', index: i, hidden: !hidden }, { label: hidden ? 'Show card' : 'Hide card' }); setDialog(null); }} />
        );
      })() : null}
      {dialog?.kind === 'section' && cards[dialog.index] ? (
        <SectionDialog index={dialog.index} current={cards[dialog.index].section || ''} sections={sectionsOf(cards)} onClose={() => setDialog(null)}
          onMove={(name) => { edit({ type: 'setFlag', index: dialog.index, key: 'section', value: name || undefined }, { label: 'Section' }); setDialog(null); }} />
      ) : null}
      {dialog?.kind === 'layout' && card ? (() => {
        const r = applyLayout(card, dialog.layout);
        if (r.error) {
          return <ConfirmDialog title={`The ${dialog.layout.label} layout cannot take card ${sel + 1}`} testId="pitch-editor-layout-dialog"
            lines={[r.error, 'Nothing changed.']} confirm="Close" onClose={() => setDialog(null)} onConfirm={() => setDialog(null)} />;
        }
        return (
          <ConfirmDialog title={`Use the ${dialog.layout.label} layout on card ${sel + 1}?`} testId="pitch-editor-layout-dialog"
            lines={[
              `The card's blocks move to the ${dialog.layout.label} preset; what it already says moves with them, kind by kind.`,
              ...(r.dropped.length ? [`The new layout has no place for: ${r.dropped.map(blockLabel).join(', ')}. ${r.dropped.length === 1 ? 'It leaves' : 'They leave'} the card.`] : []),
              'Nothing is saved until you save a version.',
            ]}
            confirm="Use this layout" onClose={() => setDialog(null)}
            onConfirm={() => { setCard(sel, r.card, { label: 'Layout' }); setPickState(NO_PICK); setDialog(null); setSheet(null); }} />
        );
      })() : null}
      {dialog?.kind === 'remove-block' && card ? (
        <ConfirmDialog title="Remove this block?" testId="pitch-editor-remove-dialog"
          lines={[`The ${blockLabel(card.blocks.find((b) => b.id === dialog.id))} leaves card ${sel + 1}.`, 'Nothing is saved until you save a version.']}
          confirm="Remove" onClose={() => setDialog(null)}
          onConfirm={() => { edit({ type: 'removeBlock', index: sel, id: dialog.id }, { label: 'Remove block' }); setPickState(NO_PICK); setDialog(null); }} />
      ) : null}
      {dialog?.kind === 'apply-all' ? (
        <ConfirmDialog title="Apply the theme to every card?" testId="pitch-editor-apply-dialog"
          lines={[`Every card draws on ${THEME_LABELS[theme?.kind || 'brand']}.`, "Each card's own background is cleared.", 'Nothing is saved until you save a version.']}
          confirm="Apply to all" onClose={() => setDialog(null)}
          onConfirm={() => { edit({ type: 'applyBrand' }, { label: 'Apply theme to all cards' }); setDialog(null); }} />
      ) : null}
      {dialog?.kind === 'charts' && card ? (
        <ChartLibrary charts={charts} cards={cards} colours={colours} problem={dialog.problem || null}
          initial={dialog.edit ? (card.blocks || []).find((b) => b.id === dialog.edit) || null : null}
          onClose={() => setDialog(null)}
          onInsert={(body) => {
            if (dialog.edit) { setCard(sel, updateBlock(card, dialog.edit, body), { label: 'Chart' }); setDialog(null); return; }
            // The selected empty range when a chart fits it (3 × 2 or more), else 8 × 4 where it fits, else 6 × 3.
            const r0 = dialog.range;
            const inRange = r0 && r0.c2 - r0.c1 >= 2 && r0.r2 - r0.r1 >= 1 && !placementProblem(card, r0, model) ? r0 : null;
            const grid = inRange || firstFree(card, 8, 4, model) || firstFree(card, 6, 3, model);
            const r = grid ? addBlock(card, { ...body, grid }, model) : { error: 'This card has no free 6 × 3 range for a chart. Remove or resize a block first.' };
            if (r.error) { setDialog({ ...dialog, problem: r.error }); return; }
            setCard(sel, r.card, { label: 'Chart' }); selectBlock(r.card.blocks[r.card.blocks.length - 1].id); setDialog(null);
          }} />
      ) : null}
      {dialog?.kind === 'critique' ? <CritiqueDialog deckId={base.deck.id} onProposals={onProposals} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'areas' && card ? (
        <AreaLightbox deckId={base.deck.id} cardIndex={sel} card={card} cards={cards} areas={dialog.areas} model={model} items={items} aiOn={aiOn}
          onTokens={onTokens} onPlace={placeCard} onProposals={onProposals} onClose={() => setDialog(null)}
          onDialog={(plan, area) => {
            if (plan.open === 'structure') { setDialog(null); setSheet('structure'); return; }
            // "Add it here": the area's own range; a block that holds it gives way when Add places the new one.
            setDialog({ kind: 'add-block', range: area.grid, replace: area.kind === 'block' ? area.block.id : null, initial: plan.kind, from: plan.from || null });
          }}
          onImageOptions={(area) => setDialog({ kind: 'image', use: 'content', replace: area.kind === 'block' ? area.block.id : null })} />
      ) : null}
      {dialog?.kind === 'image' && card ? (
        <ImageLightbox deckId={base.deck.id} cardIndex={sel} card={dialog.replace ? removeBlock(card, dialog.replace) : card} theme={theme} model={model}
          replacing={dialog.replace ? (card.blocks || []).find((b) => b.id === dialog.replace) || null : null}
          items={items} colours={{ ...colours, ink }} initialUse={dialog.use} onClose={() => setDialog(null)}
          onPlace={(placed) => {
            // One step: the card and, for a card background, the theme it needs.
            edit([{ type: 'setCard', index: sel, card: placed.card }, ...(placed.theme !== theme ? [{ type: 'setTheme', theme: placed.theme }] : [])], { label: 'Image' });
            selectBlock(placed.block?.id ?? null); setDialog(null); loadImages();
          }} />
      ) : null}
      {dialog?.kind === 'add-block' && card ? (
        <AddBlockDialog deckId={deckId} initialFrom={dialog.from} card={dialog.replace ? removeBlock(card, dialog.replace) : card} model={model} sources={sources} initialKind={dialog.initial} range={dialog.range} onClose={() => setDialog(null)}
          onAdd={(c) => { setCard(sel, c, { label: 'Add block' }); const last = c.blocks?.[c.blocks.length - 1]; selectBlock(last?.id ?? null); setDialog(null); }} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Add a block (PD8c)
// ---------------------------------------------------------------------------

function AddBlockDialog({ deckId = null, initialFrom = null, card: given, model, sources, initialKind, range = null, onClose, onAdd }) {
  // #3656: a field-based card is placed against as it will be, its fields' content as blocks.
  const ready = useMemo(() => withFieldBlocks(given, model), [given, model]);
  const card = ready.card || given;
  const [kind, setKind] = useState(ADDABLE_KINDS.includes(initialKind) ? initialKind : 'text');
  const [fields, setFields] = useState({ style: 'paragraph', text: '', ratio: '16:9' });
  const [video, setVideo] = useState(idle);
  // D1545 (#3788): a video is a link to check, or an MP4 uploaded to this deck (`deckV2Adapter.media`).
  const [videoFrom, setVideoFrom] = useState(initialFrom === 'file' && deckId != null ? 'file' : 'link');
  const upload = (file) => {
    if (!file || deckId == null) return;
    setVideo(loading);
    // `through` never throws: an answer is `{ available, value }`, or the Worker's reason. Nothing is added on a refusal.
    uploadVideoAdapter(deckId, file).then((r) => {
      const v = r?.available ? r.value?.video : null;
      setVideo(v ? { status: 'ok', data: { ...v, poster_url: null, title: fields.title || '' } }
        : { status: 'error', data: null, error: { message: r?.reason ? `The video was not added: ${r.reason}` : 'The video could not be uploaded. Nothing was added.' } });
    });
  };
  // D1604: from a selected empty range, that range is the first size and place.
  const own = range ? { label: 'This range', cols: range.c2 - range.c1 + 1, rows: range.r2 - range.r1 + 1 } : null;
  const sizesOf = (k) => (own ? [own, ...standardSizes(k)] : standardSizes(k));
  const sizes = sizesOf(kind);
  const [size, setSize] = useState(sizes[0]);
  const [at, setAt] = useState(() => (own ? { c1: range.c1, r1: range.r1 } : firstFree(card, sizes[0].cols, sizes[0].rows, model)));
  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));

  const pickKind = (k) => {
    setKind(k); setVideo(idle);
    const s = sizesOf(k)[0];
    setSize(s); setAt(own && s === own ? { c1: range.c1, r1: range.r1 } : firstFree(card, s.cols, s.rows, model));
  };
  const pickSize = (s) => { setSize(s); setAt(own && s === own ? { c1: range.c1, r1: range.r1 } : firstFree(card, s.cols, s.rows, model)); };
  const grid = at ? { c1: at.c1, r1: at.r1, c2: at.c1 + size.cols - 1, r2: at.r1 + size.rows - 1 } : null;
  const problem = ready.error || (grid ? placementProblem(card, grid, model) : `No free ${size.cols} × ${size.rows} range on this card. Remove a block or pick a smaller size.`);

  const items = (sources.data?.items || []).filter((i) => i.state === 'recorded');
  const source = items.find((i) => i.source_key === fields.source_key) || null;

  const check = () => {
    setVideo(loading);
    deckEditorApi.videoLink(fields.url || '').then(
      (r) => setVideo({ status: 'ok', data: r }),
      (e) => setVideo({ status: 'error', data: null, error: e }),
    );
  };

  const body = (() => {
    switch (kind) {
      case 'text': return { style: fields.style, text: fields.text };
      case 'graphic': return { graphic: fields.graphic || '', ratio: size.cols === 2 ? '2x2' : '1x1' };
      case 'image': return { image_url: fields.url || null, alt: fields.alt || '', tag: 'photo' };
      case 'video': {
        if (video.status !== 'ok') return null;
        const ratio = size.label.startsWith('9:16') ? '9:16' : '16:9';
        if (video.data.provider === 'mp4') {
          const poster = /^https:\/\//.test(fields.poster || '') ? fields.poster : null;
          return { provider: 'mp4', video_id: video.data.video_id, url: video.data.url, poster_url: poster, title: fields.title || '', ratio, ...(fields.loop ? { loop: true } : {}) };
        }
        return { url: video.data.url, poster_url: video.data.poster_url, title: video.data.title || '', ratio };
      }
      case 'button': {
        const label = (fields.label || '').trim();
        return /^https:\/\//.test(fields.url || '') && label && label.length <= BUTTON_LABEL_MAX ? { url: fields.url, label, style: fields.buttonStyle === 'secondary' ? 'secondary' : 'primary' } : null;
      }
      case 'audio': case 'link': return /^https:\/\//.test(fields.url || '') ? { url: fields.url, label: fields.label || '' } : null;
      case 'metric': return source ? {
        label: source.label, value: source.value == null ? null : String(source.value),
        binding: { source_key: source.source_key, record_ref: source.record_ref ?? null, as_of: source.as_of ?? null, grade: source.grade ?? null, snapshot_hash: source.snapshot_hash ?? null },
      } : null;
      default: return null;
    }
  })();
  const missing = !body ? ({
    video: videoFrom === 'file' ? 'Upload an MP4 first.' : 'Check the link first.',
    button: `Give the button its words (at most ${BUTTON_LABEL_MAX} characters) and an https link.`, audio: 'Paste an https link.', link: 'Paste an https link.', metric: 'Pick a recorded figure from your sources.',
  })[kind] : null;
  const add = () => {
    const r = addBlock(card, { kind, grid, ...body }, model);
    if (!r.error) onAdd(r.card);
  };

  return (
    <Lightbox label="Add a block" title="Add a block" width={620} onClose={onClose} testId="pitch-editor-add-dialog"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <span className={`${MUTED} mr-auto`} data-testid="pitch-editor-add-says">{problem || missing || `Adds a ${size.cols} × ${size.rows} ${KIND_LABELS[kind].toLowerCase()} at column ${grid.c1}, row ${grid.r1}. Nothing is saved until you save a version.`}</span>
          <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={Boolean(problem || missing)} onClick={add} data-testid="pitch-editor-add-run">Add</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Element">
          {ADDABLE_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={k === kind}
              className={`${k === kind ? PILL_VIO : PILL_MU} min-h-[32px]`} onClick={() => pickKind(k)} data-testid={`pitch-editor-kind-${k}`}>{KIND_LABELS[k]}</button>
          ))}
        </div>

        {kind === 'text' ? (
          <>
            <select className={FIELD} value={fields.style} onChange={(e) => set('style', e.target.value)} aria-label="Text style">
              {model.text_styles.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
            <textarea className={`${FIELD} min-h-[72px]`} value={fields.text} spellCheck onChange={(e) => set('text', e.target.value)} aria-label="Text" maxLength={4000} />
          </>
        ) : null}
        {kind === 'graphic' ? <input className={FIELD} placeholder="An icon or a shape, by name" value={fields.graphic || ''} onChange={(e) => set('graphic', e.target.value)} aria-label="Graphic" /> : null}
        {kind === 'image' ? (
          <>
            <input className={FIELD} placeholder="https://… (an image you uploaded)" value={fields.url || ''} onChange={(e) => set('url', e.target.value)} aria-label="Image link" />
            <input className={FIELD} placeholder="Alt text: what the image shows" value={fields.alt || ''} onChange={(e) => set('alt', e.target.value)} aria-label="Alt text" />
          </>
        ) : null}
        {kind === 'video' ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5" role="radiogroup" aria-label="Video from">
              {[['link', 'A link'], ['file', 'Upload an MP4']].map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={videoFrom === k} className={`${videoFrom === k ? PILL_VIO : PILL_MU} min-h-[32px]`}
                  onClick={() => { setVideoFrom(k); setVideo(idle); }} disabled={k === 'file' && deckId == null} data-testid={`pitch-editor-video-from-${k}`}>{label}</button>
              ))}
            </div>
            {videoFrom === 'link' ? (
              <div className="flex gap-2">
                <input className={FIELD} placeholder="Paste a YouTube, Vimeo or Loom link" value={fields.url || ''} onChange={(e) => { set('url', e.target.value); setVideo(idle); }} aria-label="Video link" data-testid="pitch-editor-video-url" />
                <button type="button" className={GHOST} onClick={check} disabled={!fields.url || video.status === 'loading'} data-testid="pitch-editor-video-check">{video.status === 'loading' ? 'Checking…' : 'Check link'}</button>
              </div>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-[11.5px]"><span className={EYE}>MP4 file, at most 50 MB</span>
                  <input type="file" accept="video/mp4" className="text-[12.5px]" onChange={(e) => upload(e.target.files?.[0])} disabled={video.status === 'loading'} data-testid="pitch-editor-video-file" />
                </label>
                <input className={FIELD} placeholder="Title (optional)" value={fields.title || ''} maxLength={200} onChange={(e) => set('title', e.target.value)} aria-label="Video title" />
                <input className={FIELD} placeholder="Poster image: https://… (optional)" value={fields.poster || ''} onChange={(e) => set('poster', e.target.value)} aria-label="Poster image" data-testid="pitch-editor-video-poster" />
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={Boolean(fields.loop)} onChange={(e) => set('loop', e.target.checked)} data-testid="pitch-editor-video-loop" /> Play it on a loop
                </label>
                {video.status === 'loading' ? <span className={MUTED} role="status">Uploading…</span> : null}
              </>
            )}
            {video.status === 'error' ? <span className="text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid="pitch-editor-video-error">{video.error?.message || (videoFrom === 'file' ? 'The video could not be uploaded.' : 'The link could not be checked.')}</span> : null}
            {video.status === 'ok' ? (
              <span className="flex items-center gap-2" data-testid="pitch-editor-video-ok">
                {video.data.poster_url ? <img src={video.data.poster_url} alt="" className="h-12 w-20 rounded object-cover" /> : null}
                <span className={MUTED}>{video.data.title || (video.data.provider === 'mp4' ? 'Uploaded video' : 'Untitled video')} · {VIDEO_PROVIDER_LABELS[video.data.provider] || 'Video'}. It plays in present mode, HTML and shared links; PDF and PowerPoint get the poster with the link.</span>
              </span>
            ) : null}
          </div>
        ) : null}
        {kind === 'button' ? (
          <>
            <input className={FIELD} placeholder="The button's words, e.g. Book a call" value={fields.label || ''} maxLength={BUTTON_LABEL_MAX} onChange={(e) => set('label', e.target.value)} aria-label="Button words" data-testid="pitch-editor-button-label" />
            <input className={FIELD} placeholder="https://… where it opens" value={fields.url || ''} onChange={(e) => set('url', e.target.value)} aria-label="Button link" data-testid="pitch-editor-button-url" />
            <select className={FIELD} value={fields.buttonStyle || 'primary'} onChange={(e) => set('buttonStyle', e.target.value)} aria-label="Button style" data-testid="pitch-editor-button-style">
              <option value="primary">Filled</option>
              <option value="secondary">Outline</option>
            </select>
            <span className={MUTED}>On a shared link each press is counted; PDF and PowerPoint show the words with the link.</span>
          </>
        ) : null}
        {kind === 'audio' || kind === 'link' ? (
          <>
            <input className={FIELD} placeholder="https://…" value={fields.url || ''} onChange={(e) => set('url', e.target.value)} aria-label="Link" />
            <input className={FIELD} placeholder={kind === 'link' ? 'Button label' : 'What the clip is'} value={fields.label || ''} onChange={(e) => set('label', e.target.value)} aria-label="Label" />
          </>
        ) : null}
        {kind === 'metric' ? (
          sources.status === 'error' ? <ReadFailed text="Your sources could not be read." onRetry={sources.retry} /> : (
            <select className={FIELD} value={fields.source_key || ''} onChange={(e) => set('source_key', e.target.value)} aria-label="Figure" data-testid="pitch-editor-metric-source">
              <option value="">Pick a recorded figure</option>
              {items.map((i) => <option key={i.source_key} value={i.source_key}>{i.label} · {i.value ?? NOT_RECORDED} · {i.grade || NOT_RECORDED}</option>)}
            </select>
          )
        ) : null}

        <span className={EYE}>Size and place</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {sizes.map((s) => (
            <button key={s.label} type="button" className={s.label === size.label ? PILL_VIO : PILL_MU} onClick={() => pickSize(s)}>{s.label} · {s.cols} × {s.rows}</button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[['Columns', 'cols', 1, model.grid.cols], ['Rows', 'rows', 1, model.grid.rows]].map(([label, k, min, max]) => (
            <label key={k} className="flex flex-col gap-1 text-[11.5px]"><span className={EYE}>{label}</span>
              <input type="number" className={FIELD} min={min} max={max} value={size[k]}
                onChange={(e) => setSize((s) => ({ ...s, label: 'Custom', [k]: Math.max(min, Math.min(max, Number(e.target.value) || min)) }))} />
            </label>
          ))}
          {[['From column', 'c1', model.grid.cols], ['From row', 'r1', model.grid.rows]].map(([label, k, max]) => (
            <label key={k} className="flex flex-col gap-1 text-[11.5px]"><span className={EYE}>{label}</span>
              <input type="number" className={FIELD} min={1} max={max} value={at?.[k] ?? 1}
                onChange={(e) => setAt((p) => ({ c1: 1, r1: 1, ...(p || {}), [k]: Math.max(1, Math.min(max, Number(e.target.value) || 1)) }))} />
            </label>
          ))}
        </div>
      </div>
    </Lightbox>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function ConfirmDialog({ title, lines, confirm, onConfirm, onClose, testId }) {
  return (
    <Lightbox label={title} title={title} width={520} onClose={onClose} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={onConfirm} data-testid={`${testId}-confirm`}>{confirm}</button>
        </div>
      )}>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">{lines.map((l, i) => <li key={i} className={`text-[13px] ${INK}`}>{l}</li>)}</ul>
    </Lightbox>
  );
}

/** Save says what it changes before it writes, and shows the Worker's sentence when it is refused. */
/** D1545 (#3788): Move to section: one of the deck's sections, a new one, or none. */
function SectionDialog({ index, current, sections, onMove, onClose }) {
  const [pick, setPick] = useState(current || '');
  const [fresh, setFresh] = useState('');
  const name = pick === '__new' ? fresh.trim() : pick;
  const tooLong = name.length > SECTION_MAX;
  const same = name === (current || '');
  const says = pick === '__new' && !name ? 'Name the new section.'
    : tooLong ? `A section name is at most ${SECTION_MAX} characters.`
      : same ? 'That is where the card is now.'
        : name ? `Card ${index + 1} moves to "${name}". Nothing is saved until you save a version.`
          : `Card ${index + 1} leaves its section. Nothing is saved until you save a version.`;
  const off = (pick === '__new' && !name) || tooLong || same;
  return (
    <Lightbox label="Move to section" title={`Move card ${index + 1} to a section`} width={480} onClose={onClose} testId="pitch-editor-section-dialog"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <span className={`${MUTED} mr-auto`} data-testid="pitch-editor-section-says">{says}</span>
          <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={off} onClick={() => onMove(name)} data-testid="pitch-editor-section-run">Move</button>
        </div>
      )}>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Section">
        {[...sections, '__new', ''].map((sec) => (
          <label key={sec || '__none'} className="flex items-center gap-2 text-[13px]">
            <input type="radio" name="section" checked={pick === sec} onChange={() => setPick(sec)} data-testid={`pitch-editor-section-${sec === '__new' ? 'new' : sec ? `pick-${sec}` : 'none'}`} />
            {sec === '__new' ? 'A new section' : sec || 'No section'}
          </label>
        ))}
        {pick === '__new' ? (
          <input className={FIELD} autoFocus placeholder="Section name" value={fresh} maxLength={SECTION_MAX + 20} onChange={(e) => setFresh(e.target.value)} aria-label="New section name" data-testid="pitch-editor-section-name" />
        ) : null}
      </div>
    </Lightbox>
  );
}

function SaveDialog({ changes, save, onSaved, onClose, named = false, initialName = '' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // D1604: ⋯ › Save as a named version… names it (the version's title, as Versions lists it).
  const [name, setName] = useState(initialName);
  const run = () => {
    setBusy(true); setError(null);
    save(named ? (name.trim() || initialName) : undefined).then(
      (r) => { setBusy(false); onSaved(r); },
      (e) => { setBusy(false); setError(e?.message || 'The deck could not be saved.'); reportError('pitch-editor:save', e); },
    );
  };
  return (
    <Lightbox label="Save a new version" title="Save a new version?" width={560} onClose={() => !busy && onClose()} testId="pitch-editor-save-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={run} disabled={busy} data-testid="pitch-editor-save-run">{busy ? 'Saving…' : 'Save version'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2.5">
        <span className={MUTED}>This writes a new version of the deck. The one before stays as it is, and you can restore it.</span>
        {named ? (
          <label className="flex flex-col gap-1"><span className={EYE}>Version name</span>
            <input className={FIELD} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="pitch-editor-save-name" />
          </label>
        ) : null}
        {changes.length ? <ul className="m-0 flex list-disc flex-col gap-1 pl-5" data-testid="pitch-editor-save-changes">{changes.map((c, i) => <li key={i} className={`text-[13px] ${INK}`}>{c}</li>)}</ul>
          : <span className={`text-[13px] ${INK}`} data-testid="pitch-editor-save-changes">No card changes: the deck is saved as it is, under this name.</span>}
        {error ? <span className="text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid="pitch-editor-save-error">{error}</span> : null}
      </div>
    </Lightbox>
  );
}

// ---------------------------------------------------------------------------
// Phone (PD26 frame 4): notes and order, no layout editing
// ---------------------------------------------------------------------------

function PhoneEditor({ cards, sel, setSel, move, card, readOnly, onNotes, notesMax, deckId, items, aiOn, off = null, onTokens, model, onPlace, onProposals }) {
  // pd9k / plan §8: tap one area on the card, then Ask opens "Generate into 1
  // area" as a full-height sheet, with the instruction field at its foot.
  const [tapped, setTapped] = useState(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => { setTapped(null); setAsking(false); }, [sel]);
  const all = areasOf(card, model) || [];
  const area = all.find((a) => a.id === tapped) || null;
  const target = area ? askTarget(all, [area.id], { aiOn, items }) : null;
  const words = area?.kind === 'block' && area.block.kind === 'text';
  const describe = (a) => {
    if (a.kind !== 'block') return 'Empty';
    if (a.block.kind === 'text') return String(a.block.text || '').slice(0, 40) || 'No words yet';
    if (a.block.kind === 'metric') return a.block.label || 'Figure';
    return a.block.kind[0].toUpperCase() + a.block.kind.slice(1);
  };
  return (
    <div className="flex flex-col gap-2.5" data-testid="pitch-editor-phone">
      <span className={MUTED}>{PHONE_NOTE}</span>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {cards.map((c, i) => (
          <li key={i} className={`${CARD} flex min-h-[44px] items-center gap-2 px-3 ${i === sel ? 'border-axal-violet' : ''}`}>
            <button type="button" className={`flex min-h-[44px] flex-1 items-center gap-2 text-left text-[13px] ${INK}`} onClick={() => setSel(i)}>
              <span className="font-mono text-[11px] text-axal-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="truncate">{cardTitle(c, i)}</span>
            </button>
            {!readOnly ? (
              <>
                <button type="button" className="min-h-[44px] min-w-[44px]" aria-label={`Move card ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={16} aria-hidden="true" /></button>
                <button type="button" className="min-h-[44px] min-w-[44px]" aria-label={`Move card ${i + 1} down`} disabled={i === cards.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={16} aria-hidden="true" /></button>
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {card ? (
        <label className={`${CARD} flex flex-col gap-1.5 p-3`}>
          <span className={EYE}>Speaker notes · card {sel + 1}</span>
          <textarea className={`${FIELD} min-h-[110px]`} value={card.notes || ''} placeholder={NOTES_PLACEHOLDER} readOnly={readOnly} maxLength={notesMax} spellCheck onChange={(e) => onNotes(e.target.value)} />
        </label>
      ) : null}
      {card && !readOnly && all.length ? (
        <div className={`${CARD} flex flex-col gap-1.5 p-3`} data-testid="pitch-editor-phone-areas">
          <span className={EYE}>Areas on card {sel + 1}</span>
          {all.map((a) => (
            <button key={a.id} type="button" aria-pressed={tapped === a.id}
              className={`flex min-h-[44px] items-center rounded-[9px] border px-3 text-left text-[13px] ${tapped === a.id ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'} ${INK}`}
              onClick={() => setTapped(tapped === a.id ? null : a.id)} data-testid={`pitch-editor-phone-area-${a.id}`}>
              <span className="truncate">{areaTitle(a, all.indexOf(a), all.length)} · {describe(a)}</span>
            </button>
          ))}
          {area ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="pitch-editor-phone-actions">
              <button type="button" className={`${GHOST} min-h-[44px] min-w-[44px]`} aria-label="Ask Eadwyn about this area"
                disabled={!target || target.kind !== 'areas' || Boolean(off)} onClick={() => setAsking(true)} data-testid="pitch-editor-phone-ask">
                <img src="/eadwyn-ai.png" alt="" aria-hidden="true" className="h-4 w-4 rounded-full" /> Ask
              </button>
              {off ? <span className={MUTED} data-testid="pitch-editor-phone-ask-why">{off.ask}</span> : null}
              {!off && target?.kind === 'refused' ? <span className={MUTED} data-testid="pitch-editor-phone-ask-why">{target.why}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {asking && area && target?.kind === 'areas' ? (
        <AreaLightbox deckId={deckId} cardIndex={sel} card={card} cards={cards} areas={[area]} model={model} items={items} aiOn={aiOn}
          onTokens={onTokens} onPlace={onPlace} onProposals={onProposals} onClose={() => setAsking(false)}
          instruction={words ? (
            <InstructionBox sheet deckId={deckId} cardIndex={sel} card={card} areas={[area]} items={items} aiOn={aiOn} onTokens={onTokens}
              onPlace={onPlace} onProposals={onProposals} />
          ) : null} />
      ) : null}
    </div>
  );
}
