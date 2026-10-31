import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import CardsStrip from './CardsStrip';
import GridStage from './GridStage';
import BlockTools, { SpeakerNotes } from './BlockTools';
import ShareDialog from './ShareDialog';
import ExportDialog from './ExportDialog';
import { BackgroundSheet, BrandKitSheet, CheckSheet, SourcesSheet, StructureSheet, ThemeSheet, VersionsSheet } from './DeckSheets';
import { EDITOR_WAITING, placeTextEdit, saveChip } from './deckV2Model';
import { areaTitle, areasOf, askTarget, liveFocus } from './gridSelection';
import AreaLightbox from './AreaLightbox';
import InstructionBox from './InstructionBox';
import { PitchMovedNotice } from './PitchWorkspaceMoved';
import { presentHref } from './presentExportModel';
import {
  ADDABLE_KINDS, KIND_LABELS, MODEL_FAILED, NOTES_PLACEHOLDER, NO_CARDS,
  NOT_RECORDED, PHONE_NOTE, READ_FAILED, THEME_LABELS,
  addBlock, applyLayout, applyToAll, blockLabel, cardColours, cardTitle, cardsOf, changesOf, firstFree,
  moveCard, placementProblem, removeBlock, saveState, standardSizes, staleCards, updateBlock, withFieldBlocks,
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
  // D1604: the header's toolbar reports the open editor's state and calls back into it.
  const [chrome, setChrome] = useState(null);
  const actionRef = useRef(null);
  // Share and Export need only the version on screen, so the page opens them
  // itself, editor or not; every other ⋯ item is the editor's.
  const [shareDialog, setShareDialog] = useState(null);
  const onAction = useCallback((id) => {
    if (id === 'share' || id === 'export') { if (!readOnly) setShareDialog(id); return; }
    actionRef.current?.(id);
  }, [readOnly]);
  const tools = current?.id ? (
    <DeckToolbar chip={chrome?.chip ?? null} presentTo={presentHref(projectId, current.id)} readOnly={readOnly} phone={phone}
      onAction={onAction} labels={chrome?.labels} waiting={chrome ? null : EDITOR_WAITING} />
  ) : null;
  const overlay = shareDialog === 'share' && projectId != null && current ? (
    <ShareDialog projectId={projectId} deck={current} onClose={() => setShareDialog(null)} onCreated={() => {}} />
  ) : shareDialog === 'export' && current ? (
    <ExportDialog versions={versionList} current={current} onClose={() => setShareDialog(null)} />
  ) : null;
  // A decision in the header re-reads the versions without blanking them, so the
  // open Editor (keyed to the version) keeps its unsaved cards.
  const shell = {
    query: ventureQuery(projectId || requested), title, tools, overlay, heading: deck.status === 'ok' ? title : null,
    ask: { projectId, readOnly, onPlace, versions, onChanged: versions.refresh, editsKey: proposalsTick },
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
        onChrome={setChrome}
        actionRef={actionRef}
      />
    </Shell>
  );
}

function Shell({ children, query, title, ask, tools, heading, overlay = null }) {
  const rail = <WorkerRail workspace="Raise" role="founder" note="The editor reads your deck and its recorded sources. Each Eadwyn run shows its cost first." data-testid="pitch-editor-rail" />;
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

/** A copy of a card with its own block ids kept (ids are per card). */
const copyCard = (c) => JSON.parse(JSON.stringify(c));

function Editor({ project, deck, model, kit, refresh, sources, charts, versions, readOnly, phone, narrow = false, onTitle, onSaved, placeRef, onProposals, onChrome, actionRef }) {
  const [aiOn] = useAssistMode('raise');
  const navigate = useNavigate();
  const [base, setBase] = useState(() => ({ deck, cards: cardsOf(deck), theme: deck.theme ?? null, audience: deck.audience ?? null }));
  const [cards, setCards] = useState(base.cards);
  const [theme, setTheme] = useState(base.theme);
  const [audience, setAudience] = useState(base.audience);
  const [sel, setSel] = useState(0);
  const [pickState, setPickState] = useState(NO_PICK);
  const [askLine, setAskLine] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [compare, setCompare] = useState(null);

  const next = { cards, theme, audience };
  const changes = useMemo(() => changesOf(base, next, model), [base, cards, theme, audience, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = changes.length > 0;
  const stale = useMemo(() => staleCards(refresh.data), [refresh.data]);
  const card = cards[sel] || null;
  const kitData = kit.status === 'ok' ? kit.data?.kit ?? null : null;
  const colours = cardColours(theme, kitData);
  // D903: a background's overlay is in the brand ink, never the dark theme's light text colour.
  const ink = theme?.kind === 'neutral_dark' ? undefined : colours.ink;
  const items = sources.data?.items || [];
  const [images, setImages] = useState([]);
  const loadImages = useCallback(() => {
    if (readOnly) return;
    deckImagesApi.list(base.deck.id).then((r) => setImages(r?.images || []), (e) => reportError('pitch-images:list', e));
  }, [base.deck.id, readOnly]);
  useEffect(() => { loadImages(); }, [loadImages]);

  // The selection on The Grid: ids that left the card (a block removed, a free
  // range filled) drop out of it on their own.
  const areas = useMemo(() => areasOf(card, model), [card, model]);
  const selection = pickState.selection.filter((id) => (areas || []).some((a) => a.id === id));
  const chosen = (areas || []).filter((a) => selection.includes(a.id));
  const one = chosen.length === 1 ? chosen[0] : null;
  // The focus too: a free range a block now covers hands it to that block.
  const focus = liveFocus(areas, pickState.focus);
  const selKey = selection.join('|');
  useEffect(() => { setAskLine(null); }, [selKey, sel]);
  const choose = (i) => { setSel(i); setPickState(NO_PICK); };
  const selectBlock = (id) => setPickState({ selection: id == null ? [] : [String(id)], focus: id == null ? null : String(id) });

  const setCard = (i, c) => setCards((cs) => cs.map((x, j) => (j === i ? c : x)));

  // D1604: a card edit accepted from the header Ask. Checked against the cards
  // on screen first; `commit()` then places it, synchronously, against the
  // cards as they are at that moment and answers `{ error }` or `{ undo }`.
  // The sheet records the decision only after the edit is placed, and undoes
  // the placement when that decision is refused. Held until Save like every
  // other edit.
  const cardsNow = useRef(cards);
  cardsNow.current = cards;
  useEffect(() => {
    if (!placeRef) return undefined;
    placeRef.current = readOnly ? null : (edit) => {
      const place = (cs) => {
        if (edit.kind === 'text') return placeTextEdit(cs, edit);
        const at = cs[edit.card];
        if (!at) return { error: `Card ${edit.card + 1} is no longer in this deck. Discard this proposal.` };
        const grid = firstFree(at, edit.size.cols, edit.size.rows, model);
        if (!grid) return { error: `No free ${edit.size.cols} × ${edit.size.rows} range on card ${edit.card + 1}. Remove a block, then accept.` };
        return addBlock(at, { ...edit.block, grid }, model);
      };
      const check = place(cardsNow.current);
      if (check.error) return { error: check.error };
      return {
        commit: () => {
          const r = place(cardsNow.current);
          if (r.error) return { error: r.error };
          const was = cardsNow.current[edit.card];
          const put = (from, to) => (cs) => cs.map((x, j) => (j === edit.card && x === from ? to : x));
          // The next check (Accept all's next edit) sees this one at once.
          cardsNow.current = put(was, r.card)(cardsNow.current);
          setCards(put(was, r.card));
          setSel(edit.card); setPickState(NO_PICK);
          return {
            // Back to the card as it was, unless something changed it since.
            undo: () => { cardsNow.current = put(r.card, was)(cardsNow.current); setCards(put(r.card, was)); },
          };
        },
      };
    };
    return () => { placeRef.current = null; };
  }, [placeRef, readOnly, model]);
  const move = (from, to) => { setCards((cs) => moveCard(cs, from, to)); setSel(to); setPickState(NO_PICK); };

  const saved = (fresh) => {
    const d = fresh?.deck || fresh;
    const b = { deck: d, cards: cardsOf(d), theme: d.theme ?? null, audience: d.audience ?? null };
    setBase(b); setCards(b.cards); setTheme(b.theme); setAudience(b.audience); setDialog(null); setSheet(null);
    onSaved?.();
  };

  const title = `${String(project?.name || '').trim() || 'Your venture'} · v${base.deck.version ?? '?'}`;
  useEffect(() => { onTitle({ deckId: deck.id, projectId: project?.id, title }); }, [deck.id, project?.id, title, onTitle]);
  const state = saveState({ dirty, savedAt: base.deck.created_at, readOnly, version: base.deck.version });

  // The header's toolbar (`DeckToolbar`, drawn by the page) reads this state and
  // calls back here for Save, Share, Export and the ⋯ items.
  const chip = saveChip({ dirty, readOnly, when: state, version: base.deck.version });
  const appendixLabel = card?.appendix ? 'Not an appendix' : 'Mark as appendix';
  useEffect(() => {
    onChrome?.({ chip, labels: { appendix: appendixLabel, ...(readOnly ? { notes: 'Leave a note' } : {}) } });
  }, [chip.text, chip.title, chip.save, appendixLabel, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onChrome?.(null), [onChrome]);

  const duplicate = (i) => {
    if (!cards[i]) return;
    setCards((cs) => [...cs.slice(0, i + 1), copyCard(cs[i]), ...cs.slice(i + 1)]);
    setSel(i + 1); setPickState(NO_PICK);
  };
  const toggleAppendix = (i) => {
    const c = cards[i];
    if (!c) return;
    const { appendix, ...rest } = c;
    setCard(i, appendix ? rest : { ...c, appendix: true });
  };
  const act = (id) => {
    if (id === 'save') { if (!readOnly && dirty) setDialog({ kind: 'save' }); return; }
    if (id === 'save_named') { if (!readOnly) setDialog({ kind: 'save', named: true }); return; }
    if (id === 'duplicate') { if (!readOnly) duplicate(sel); return; }
    if (id === 'appendix') { if (!readOnly) toggleAppendix(sel); return; }
    if (id === 'notes') { navigate(`/raise/pitch/notes${ventureQuery(project?.id)}`); return; }
    if (['theme', 'brand', 'sources', 'versions', 'check', 'structure', 'background'].includes(id)) setSheet(id);
  };
  if (actionRef) actionRef.current = act;
  const cardAction = (id, i) => {
    if (readOnly) return;
    if (id === 'duplicate') duplicate(i);
    else if (id === 'up' && i > 0) move(i, i - 1);
    else if (id === 'down' && i < cards.length - 1) move(i, i + 1);
    else if (id === 'appendix') toggleAppendix(i);
  };

  // The selection's Ask opens "Generate into N areas" (`AreaLightbox.jsx`) on
  // the areas as they are now; a figure bound to a record says why not.
  const askOff = aiOn ? null : 'AI is paused for your studio.';
  const ask = () => {
    const t = askTarget(areas, selection, { aiOn, items });
    if (!t || t.kind === 'off') return;
    if (t.kind === 'refused') { setAskLine(t.why); return; }
    setAskLine(null);
    setDialog({ kind: 'areas', areas: (areas || []).filter((a) => t.ids.includes(a.id)) });
  };

  const staleMap = useMemo(() => {
    const m = new Map();
    for (const r of Array.isArray(refresh.data?.rows) ? refresh.data.rows : []) if (r.state === 'stale') m.set(r.source_key, r.bound?.as_of || null);
    return m;
  }, [refresh.data]);

  return (
    <>
      {phone ? (
        <PhoneEditor cards={cards} sel={sel} setSel={choose} move={move} card={card} readOnly={readOnly}
          onNotes={(v) => setCard(sel, { ...card, notes: v })} notesMax={model.notes_max}
          deckId={base.deck.id} items={items} aiOn={aiOn} model={model} onPlace={(c) => setCard(sel, c)} onProposals={onProposals} />
      ) : (
        <div className={`grid gap-3 ${narrow ? '' : 'lg:grid-cols-[150px_minmax(0,1fr)]'}`} data-testid="pitch-editor-body">
          <div className="flex min-w-0 flex-col gap-2">
            <CardsStrip cards={cards} sel={sel} stale={stale} readOnly={readOnly} onSelect={choose} move={move}
              onCardAction={cardAction} orientation={narrow ? 'row' : 'column'}
              onAdd={() => {
                const layout = model.layouts.find((l) => l.id === 'statement') || model.layouts[0];
                const fresh = applyLayout({ title: 'New card' }, layout).card;
                setCards((cs) => [...cs, fresh]); setSel(cards.length); setPickState(NO_PICK);
              }} />
            {refresh.status === 'error' ? <ReadFailed text="Which figures have changed could not be read." onRetry={refresh.retry} testId="pitch-editor-refresh-error" /> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {cards.length === 0 ? <div className={`${CARD} p-6 ${MUTED}`}>{NO_CARDS}</div> : (
              <GridStage card={card} index={sel} model={model} colours={colours} ink={ink} theme={theme} kit={kit} charts={charts}
                readOnly={readOnly} selection={selection} focus={focus}
                onSelection={setPickState}
                onMove={(id, grid) => setCard(sel, updateBlock(card, id, { grid }))}
                onAsk={ask} askOff={askOff} askLine={askLine} />
            )}
            {card && !readOnly && chosen.length ? (
              <InstructionBox deckId={base.deck.id} cardIndex={sel} card={card} areas={chosen} items={items} aiOn={aiOn}
                onRemove={(id) => setPickState((p) => ({ selection: p.selection.filter((x) => x !== id), focus: p.focus }))}
                onPlace={(c) => setCard(sel, c)} onProposals={onProposals} />
            ) : null}
            {card && !readOnly && (one || !areas) ? (
              <BlockTools card={card} cardIndex={sel} area={one} model={model} charts={charts} images={images} items={items}
                deckId={base.deck.id}
                onPatch={(patch) => setCard(sel, updateBlock(card, one.block.id, patch))}
                onRemove={() => setDialog({ kind: 'remove-block', id: one.block.id })}
                onChartLibrary={(edit, range) => setDialog({ kind: 'charts', edit: edit || null, range: range || null })}
                onAddBlock={(range, kind) => setDialog({ kind: 'add-block', range: range || null, initial: kind })}
                onImage={(use, replace) => setDialog({ kind: 'image', use, replace: replace || null })}
                onDesign={() => setSheet('structure')}
                onPlace={(c) => setCard(sel, c)}
                onAddCard={(c) => { setCards((cs) => [...cs, c]); setSel(cards.length); setPickState(NO_PICK); }} />
            ) : null}
            {card && (one || !areas) ? (
              <SpeakerNotes card={card} index={sel} readOnly={readOnly} notesMax={model.notes_max} onNotes={(v) => setCard(sel, { ...card, notes: v })} />
            ) : null}
          </div>
        </div>
      )}

      {sheet === 'theme' ? (
        <ThemeSheet model={model} theme={theme} audience={audience} kit={kit} readOnly={readOnly}
          onTheme={setTheme} onAudience={setAudience} onApplyAll={() => setDialog({ kind: 'apply-all' })} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'structure' && card ? (
        <StructureSheet model={model} card={card} index={sel} readOnly={readOnly} onLayout={(layout) => setDialog({ kind: 'layout', layout })} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'background' && card ? (
        <BackgroundSheet card={card} index={sel} readOnly={readOnly} onBackground={(bg) => setCard(sel, { ...card, background: bg })}
          onImage={() => { setSheet(null); setDialog({ kind: 'image', use: 'card' }); }} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'brand' ? <BrandKitSheet projectId={project?.id ?? null} kit={kit} readOnly={readOnly} onClose={() => setSheet(null)} /> : null}
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
            onAddSources={(lines) => { const c = sourcesCard(model, lines); setCards((cs) => [...cs, c]); setSel(cards.length); setPickState(NO_PICK); setSheet(null); }} />
        </SourcesSheet>
      ) : null}
      {sheet === 'check' && base.deck?.id ? (
        <CheckSheet deck={base.deck} projectId={project?.id} readOnly={readOnly} dirty={dirty} onReplaced={saved} onClose={() => setSheet(null)} />
      ) : null}

      {dialog?.kind === 'save' ? (
        <SaveDialog changes={changes} named={Boolean(dialog.named)} initialName={base.deck.title || ''} onClose={() => setDialog(null)} onSaved={saved}
          save={(name) => api.deckUpdate(base.deck.id, { slides: cards, title: name ?? base.deck.title, theme, audience })} />
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
            onConfirm={() => { setCard(sel, r.card); setPickState(NO_PICK); setDialog(null); setSheet(null); }} />
        );
      })() : null}
      {dialog?.kind === 'remove-block' && card ? (
        <ConfirmDialog title="Remove this block?" testId="pitch-editor-remove-dialog"
          lines={[`The ${blockLabel(card.blocks.find((b) => b.id === dialog.id))} leaves card ${sel + 1}.`, 'Nothing is saved until you save a version.']}
          confirm="Remove" onClose={() => setDialog(null)}
          onConfirm={() => { setCard(sel, removeBlock(card, dialog.id)); setPickState(NO_PICK); setDialog(null); }} />
      ) : null}
      {dialog?.kind === 'apply-all' ? (
        <ConfirmDialog title="Apply the theme to every card?" testId="pitch-editor-apply-dialog"
          lines={[`Every card draws on ${THEME_LABELS[theme?.kind || 'brand']}.`, "Each card's own background is cleared.", 'Nothing is saved until you save a version.']}
          confirm="Apply to all" onClose={() => setDialog(null)}
          onConfirm={() => { setCards((cs) => applyToAll(cs)); setDialog(null); }} />
      ) : null}
      {dialog?.kind === 'charts' && card ? (
        <ChartLibrary charts={charts} cards={cards} colours={colours} problem={dialog.problem || null}
          initial={dialog.edit ? (card.blocks || []).find((b) => b.id === dialog.edit) || null : null}
          onClose={() => setDialog(null)}
          onInsert={(body) => {
            if (dialog.edit) { setCard(sel, updateBlock(card, dialog.edit, body)); setDialog(null); return; }
            // The selected empty range when a chart fits it (3 × 2 or more), else 8 × 4 where it fits, else 6 × 3.
            const r0 = dialog.range;
            const inRange = r0 && r0.c2 - r0.c1 >= 2 && r0.r2 - r0.r1 >= 1 && !placementProblem(card, r0, model) ? r0 : null;
            const grid = inRange || firstFree(card, 8, 4, model) || firstFree(card, 6, 3, model);
            const r = grid ? addBlock(card, { ...body, grid }, model) : { error: 'This card has no free 6 × 3 range for a chart. Remove or resize a block first.' };
            if (r.error) { setDialog({ ...dialog, problem: r.error }); return; }
            setCard(sel, r.card); selectBlock(r.card.blocks[r.card.blocks.length - 1].id); setDialog(null);
          }} />
      ) : null}
      {dialog?.kind === 'areas' && card ? (
        <AreaLightbox deckId={base.deck.id} cardIndex={sel} card={card} areas={dialog.areas} model={model} items={items} aiOn={aiOn}
          onPlace={(c) => setCard(sel, c)} onProposals={onProposals} onClose={() => setDialog(null)}
          onDialog={(plan, area) => {
            if (plan.open === 'structure') { setDialog(null); setSheet('structure'); return; }
            setDialog({ kind: 'add-block', range: area.kind === 'free' ? area.grid : null, initial: plan.kind });
          }}
          onImageOptions={(area) => setDialog({ kind: 'image', use: 'content', replace: area.kind === 'block' ? area.block.id : null })} />
      ) : null}
      {dialog?.kind === 'image' && card ? (
        <ImageLightbox deckId={base.deck.id} cardIndex={sel} card={dialog.replace ? removeBlock(card, dialog.replace) : card} theme={theme} model={model}
          items={items} colours={{ ...colours, ink }} initialUse={dialog.use} onClose={() => setDialog(null)}
          onPlace={(placed) => {
            setCard(sel, placed.card); if (placed.theme !== theme) setTheme(placed.theme);
            selectBlock(placed.block?.id ?? null); setDialog(null); loadImages();
          }} />
      ) : null}
      {dialog?.kind === 'add-block' && card ? (
        <AddBlockDialog card={card} model={model} sources={sources} initialKind={dialog.initial} range={dialog.range} onClose={() => setDialog(null)}
          onAdd={(c) => { setCard(sel, c); const last = c.blocks?.[c.blocks.length - 1]; selectBlock(last?.id ?? null); setDialog(null); }} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Add a block (PD8c)
// ---------------------------------------------------------------------------

function AddBlockDialog({ card: given, model, sources, initialKind, range = null, onClose, onAdd }) {
  // #3656: a field-based card is placed against as it will be, its fields' content as blocks.
  const ready = useMemo(() => withFieldBlocks(given, model), [given, model]);
  const card = ready.card || given;
  const [kind, setKind] = useState(ADDABLE_KINDS.includes(initialKind) ? initialKind : 'text');
  const [fields, setFields] = useState({ style: 'paragraph', text: '', ratio: '16:9' });
  const [video, setVideo] = useState(idle);
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
      case 'video': return video.status === 'ok' ? { url: video.data.url, poster_url: video.data.poster_url, title: video.data.title || '', ratio: size.label.startsWith('9:16') ? '9:16' : '16:9' } : null;
      case 'audio': case 'link': return /^https:\/\//.test(fields.url || '') ? { url: fields.url, label: fields.label || '' } : null;
      case 'metric': return source ? {
        label: source.label, value: source.value == null ? null : String(source.value),
        binding: { source_key: source.source_key, record_ref: source.record_ref ?? null, as_of: source.as_of ?? null, grade: source.grade ?? null, snapshot_hash: source.snapshot_hash ?? null },
      } : null;
      default: return null;
    }
  })();
  const missing = !body ? ({
    video: 'Check the link first.', audio: 'Paste an https link.', link: 'Paste an https link.', metric: 'Pick a recorded figure from your sources.',
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
            <textarea className={`${FIELD} min-h-[72px]`} value={fields.text} onChange={(e) => set('text', e.target.value)} aria-label="Text" maxLength={4000} />
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
            <div className="flex gap-2">
              <input className={FIELD} placeholder="Paste a YouTube or Vimeo link" value={fields.url || ''} onChange={(e) => { set('url', e.target.value); setVideo(idle); }} aria-label="Video link" data-testid="pitch-editor-video-url" />
              <button type="button" className={GHOST} onClick={check} disabled={!fields.url || video.status === 'loading'} data-testid="pitch-editor-video-check">{video.status === 'loading' ? 'Checking…' : 'Check link'}</button>
            </div>
            {video.status === 'error' ? <span className="text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid="pitch-editor-video-error">{video.error?.message || 'The link could not be checked.'}</span> : null}
            {video.status === 'ok' ? (
              <span className="flex items-center gap-2" data-testid="pitch-editor-video-ok">
                {video.data.poster_url ? <img src={video.data.poster_url} alt="" className="h-12 w-20 rounded object-cover" /> : null}
                <span className={MUTED}>{video.data.title || 'Untitled video'} · {video.data.provider === 'youtube' ? 'YouTube' : 'Vimeo'}. It plays in present mode, HTML and shared links; PDF and PowerPoint get the poster with the link.</span>
              </span>
            ) : null}
          </div>
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

function PhoneEditor({ cards, sel, setSel, move, card, readOnly, onNotes, notesMax, deckId, items, aiOn, model, onPlace, onProposals }) {
  // pd9k: tap one text area on the card, and the instruction box docks at the bottom.
  const [tapped, setTapped] = useState(null);
  useEffect(() => { setTapped(null); }, [sel]);
  const all = areasOf(card, model) || [];
  const texts = all.filter((a) => a.kind === 'block' && a.block.kind === 'text');
  const docked = texts.find((a) => a.id === tapped) || null;
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
          <textarea className={`${FIELD} min-h-[110px]`} value={card.notes || ''} placeholder={NOTES_PLACEHOLDER} readOnly={readOnly} maxLength={notesMax} onChange={(e) => onNotes(e.target.value)} />
        </label>
      ) : null}
      {card && !readOnly && texts.length ? (
        <div className={`${CARD} flex flex-col gap-1.5 p-3 ${docked ? 'mb-[180px]' : ''}`} data-testid="pitch-editor-phone-areas">
          <span className={EYE}>Ask Eadwyn about an area · card {sel + 1}</span>
          {texts.map((a) => (
            <button key={a.id} type="button" aria-pressed={tapped === a.id}
              className={`flex min-h-[44px] items-center rounded-[9px] border px-3 text-left text-[13px] ${tapped === a.id ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'} ${INK}`}
              onClick={() => setTapped(tapped === a.id ? null : a.id)} data-testid={`pitch-editor-phone-area-${a.id}`}>
              <span className="truncate">{areaTitle(a, all.indexOf(a), all.length)} · {String(a.block.text || '').slice(0, 40)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {docked ? (
        <InstructionBox dock deckId={deckId} cardIndex={sel} card={card} areas={[docked]} items={items} aiOn={aiOn}
          onPlace={onPlace} onProposals={onProposals} onClose={() => setTapped(null)} />
      ) : null}
    </div>
  );
}
