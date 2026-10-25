import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { deckEditorApi } from '../../../lib/api/deckEditor';
import { deckSourcesApi } from '../../../lib/api/deckSources';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, usePhoneWidth } from '../../../ui';
import { SourcesPanel, useDeckSources } from './SourcesBoards';
import AddMenu from './AddMenu';
import CardAssistBar from './CardAssistBar';
import { asList, currentVersion, isReadOnly, ventureQuery } from './pitchStudioModel';
import { cardOf, presentHref } from './presentExportModel';
import {
  ADDABLE_KINDS, AUDIENCE_LABELS, CALLOUTS, KIND_LABELS, KIT_FAILED, MODEL_FAILED, NOTES_PLACEHOLDER, NO_CARDS, NO_KIT,
  NOT_RECORDED, PHONE_NOTE, READ_FAILED, THEME_LABELS,
  addBlock, applyLayout, applyToAll, blockLabel, cardColours, cardTitle, cardsOf, changesOf, firstFree, firstRunSeen,
  keyMove, markFirstRunSeen, moveCard, placementProblem, removeBlock, saveState, standardSizes, staleCards, tileValue, updateBlock,
} from './editorModel';

/**
 * D898 (#2676, part 4 of #2434) — the Pitch deck editor at /raise/pitch/edit,
 * built to the canvas's PD1, PD1b, PD8, PD8b, PD8c and PD24–PD27.
 *
 *   the bar      the venture, the audience, "Saved · …", Present and Save
 *   the rail     every card, numbered, with a stale dot; drag or Up and Down
 *                (arrow keys on a focused card) to reorder; + Add card
 *   the card     the selected card on the venture's brand kit, its blocks on
 *                the 12 × 6 grid; a fielded card from before D898 is drawn
 *                as present mode draws it
 *   the notes    the selected card's speaker notes
 *   the panel    Sources (D896's panel), Design (PD8: layouts, the card's
 *                background, the theme, the audience, Apply to all) and Notes
 *                (the thread from the venture's admins, D905)
 *
 * Every change stays on screen until Save, which opens a dialog listing what
 * it changes and writes one new version (`PUT /api/decks/:id`). A refused save
 * shows the Worker's sentence. Each read answers alone: a failed one says so
 * with Try again and blanks nothing else. An admin reads; nothing is written.
 * On a phone the editor is notes and order only (PD26 frame 4).
 *
 * D899 (#2678): under the card, the Add menu (`AddMenu.jsx`, PD7, with PD9d's
 * `ConnectorLightbox.jsx`) and, on a selected text block, Eadwyn's bar
 * (`CardAssistBar.jsx`). What they propose is placed here on Accept and
 * written by Save like any other change.
 *
 * The Check tab (part 6) is not drawn here: it waits for its own store.
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
const loading = { status: 'loading', data: null };

function useRead(key, run, deps) {
  const [state, setState] = useState(key == null ? idle : loading);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (key == null) { setState(idle); return undefined; }
    let live = true;
    setState(loading);
    run().then(
      (data) => { if (live) setState({ status: 'ok', data }); },
      (e) => { if (live) setState({ status: 'error', data: null, error: e }); reportError('pitch-editor:read', e); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, ...deps]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, retry };
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
  const phone = usePhoneWidth();
  const [params, setParams] = useSearchParams();
  const requested = params.get('project_id');

  const projects = useRead('ventures', () => api.listProjects(), []);
  const list = asList(projects.data, 'items', 'projects');
  const project = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
  const projectId = project?.id ?? null;
  useEffect(() => {
    if (projectId == null || String(projectId) === String(requested)) return;
    setParams((old) => { const n = new URLSearchParams(old); n.set('project_id', String(projectId)); return n; }, { replace: true });
  }, [projectId, requested, setParams]);

  const versions = useRead(projectId, () => api.deckListVersions(projectId), []);
  const current = currentVersion(asList(versions.data, 'versions', 'decks'));
  const deck = useRead(current?.id ?? null, () => api.deckGet(current.id).then((r) => r?.deck || r), []);
  const model = useRead('model', () => deckEditorApi.model(), []);
  const kit = useRead(projectId, () => deckEditorApi.brandKit(projectId), []);
  const refresh = useRead(current?.id ?? null, () => deckSourcesApi.refresh(current.id), []);
  const sources = useDeckSources(projectId);

  if (projects.status === 'error') return <Shell><ReadFailed text="Your ventures could not be read." onRetry={projects.retry} testId="pitch-editor-ventures-error" /></Shell>;
  if (projects.status === 'ok' && !project) return <Shell><div className={`${CARD} p-5 ${MUTED}`}>Start a venture first, then build its deck.</div></Shell>;
  if (versions.status === 'error') return <Shell><ReadFailed text="Your deck's versions could not be read." onRetry={versions.retry} testId="pitch-editor-versions-error" /></Shell>;
  if (versions.status === 'ok' && !current) {
    return (
      <Shell>
        <div className={`${CARD} flex flex-col items-start gap-3 p-5`} data-testid="pitch-editor-no-deck">
          <span className={`text-[14px] font-extrabold ${INK}`}>No deck yet.</span>
          <span className={MUTED}>Start one from a template, then edit it here.</span>
          <Link className={PRIMARY} to={`/raise/pitch/builder${ventureQuery(projectId)}`}>Open the template builder</Link>
        </div>
      </Shell>
    );
  }
  if (deck.status === 'error') return <Shell><ReadFailed text={READ_FAILED} onRetry={deck.retry} testId="pitch-editor-deck-error" /></Shell>;
  if (model.status === 'error') return <Shell><ReadFailed text={MODEL_FAILED} onRetry={model.retry} testId="pitch-editor-model-error" /></Shell>;
  if (deck.status !== 'ok' || model.status !== 'ok') return <Shell><EditorSkeleton /></Shell>;

  return (
    <Shell>
      <Editor
        key={deck.data.id}
        project={project}
        deck={deck.data}
        model={model.data}
        kit={kit}
        refresh={refresh}
        sources={sources}
        readOnly={readOnly}
        phone={phone}
        onSaved={() => versions.retry()}
      />
    </Shell>
  );
}

function Shell({ children }) {
  return <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-4" data-testid="pitch-editor">{children}</div>;
}

/** PD24: the header at once; the rail, the card and the panel as grey skeletons. */
function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="pitch-editor-loading" aria-busy="true">
      <Skeleton h="h-12" />
      <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h="h-10" />)}</div>
        <div className="flex flex-col gap-3"><Skeleton h="h-[360px]" /><span className={MUTED}>Reading…</span><Skeleton h="h-20" /></div>
        <div className="flex flex-col gap-2"><Skeleton h="h-8" />{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h="h-12" />)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor, over one version
// ---------------------------------------------------------------------------

function Editor({ project, deck, model, kit, refresh, sources, readOnly, phone, onSaved }) {
  const [base, setBase] = useState(() => ({ deck, cards: cardsOf(deck), theme: deck.theme ?? null, audience: deck.audience ?? null }));
  const [cards, setCards] = useState(base.cards);
  const [theme, setTheme] = useState(base.theme);
  const [audience, setAudience] = useState(base.audience);
  const [sel, setSel] = useState(0);
  const [selBlock, setSelBlock] = useState(null);
  const [panel, setPanel] = useState('sources');
  const [dialog, setDialog] = useState(null);
  const [firstRun, setFirstRun] = useState(() => !readOnly && !firstRunSeen());

  const next = { cards, theme, audience };
  const changes = useMemo(() => changesOf(base, next, model), [base, cards, theme, audience, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = changes.length > 0;
  const stale = useMemo(() => staleCards(refresh.data), [refresh.data]);
  const card = cards[sel] || null;
  const kitData = kit.status === 'ok' ? kit.data?.kit ?? null : null;
  const colours = cardColours(theme, kitData);

  const setCard = (i, c) => setCards((cs) => cs.map((x, j) => (j === i ? c : x)));
  const move = (from, to) => { setCards((cs) => moveCard(cs, from, to)); setSel(to); setSelBlock(null); };

  const saved = (fresh) => {
    const d = fresh?.deck || fresh;
    const b = { deck: d, cards: cardsOf(d), theme: d.theme ?? null, audience: d.audience ?? null };
    setBase(b); setCards(b.cards); setTheme(b.theme); setAudience(b.audience); setDialog(null);
    onSaved?.();
  };

  const title = `${String(project?.name || '').trim() || 'Your venture'} · v${base.deck.version ?? '?'}`;
  const state = saveState({ dirty, savedAt: base.deck.created_at, readOnly, version: base.deck.version });

  return (
    <>
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3`} data-testid="pitch-editor-bar">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`truncate text-[15px] font-extrabold ${INK}`}>{title}</span>
          <span className={PILL_VIO} data-testid="pitch-editor-audience">{AUDIENCE_LABELS[audience] || `Audience ${NOT_RECORDED.toLowerCase()}`}</span>
          <span className={`text-[12px] ${dirty ? 'font-bold text-amber-700 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="pitch-editor-save-state">{state}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className={GHOST} to={presentHref(project?.id, base.deck.id)}>Present</Link>
          {readOnly
            ? <Link className={GHOST} to={`/raise/pitch/notes${ventureQuery(project?.id)}`}>Leave a note</Link>
            : <button type="button" className={PRIMARY} disabled={!dirty} onClick={() => setDialog({ kind: 'save' })} data-testid="pitch-editor-save">Save</button>}
        </div>
      </div>

      {firstRun && !phone ? (
        <div className="grid gap-2.5 rounded-[12px] border border-axal-lavender-edge bg-axal-lavender p-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] dark:border-violet-800 dark:bg-violet-950/40" data-testid="pitch-editor-callouts">
          {CALLOUTS.map((k) => (
            <div key={k.n} className="flex gap-2">
              <span className="font-mono text-[12px] font-bold text-axal-violet dark:text-violet-300">{k.n}</span>
              <span className="flex flex-col"><b className={`text-[12.5px] ${INK}`}>{k.t}</b><span className={MUTED}>{k.d}</span></span>
            </div>
          ))}
          <button type="button" className={GHOST} onClick={() => { markFirstRunSeen(); setFirstRun(false); }}>Got it</button>
        </div>
      ) : null}

      {phone ? (
        <PhoneEditor cards={cards} sel={sel} setSel={setSel} move={move} card={card} readOnly={readOnly}
          onNotes={(v) => setCard(sel, { ...card, notes: v })} notesMax={model.notes_max} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[210px_minmax(0,1fr)_330px]">
          <Rail cards={cards} sel={sel} stale={stale} readOnly={readOnly}
            onSelect={(i) => { setSel(i); setSelBlock(null); }} move={move}
            onAdd={() => {
              const layout = model.layouts.find((l) => l.id === 'statement') || model.layouts[0];
              const fresh = applyLayout({ title: 'New card' }, layout).card;
              setCards((cs) => [...cs, fresh]); setSel(cards.length);
            }} />
          <div className="flex min-w-0 flex-col gap-3">
            {cards.length === 0 ? <div className={`${CARD} p-6 ${MUTED}`}>{NO_CARDS}</div> : (
              <CenterCard card={card} index={sel} colours={colours} theme={theme} kit={kit} selBlock={selBlock} readOnly={readOnly}
                onSelectBlock={setSelBlock}
                onRemoveBlock={(id) => setDialog({ kind: 'remove-block', id })}
                onAddBlock={() => setDialog({ kind: 'add-block' })} />
            )}
            {card && !readOnly ? (
              <>
                <AddMenu deckId={base.deck.id} cardIndex={sel} card={card} model={model} items={sources.data?.items || []}
                  onBlock={(kind) => setDialog({ kind: 'add-block', initial: kind })}
                  onDesign={() => setPanel('design')}
                  onPlace={(c) => setCard(sel, c)}
                  onAddCard={(c) => { setCards((cs) => [...cs, c]); setSel(cards.length); setSelBlock(null); }} />
                <CardAssistBar deckId={base.deck.id} cardIndex={sel} items={sources.data?.items || []}
                  block={(card.blocks || []).find((b) => b.id === selBlock) || null}
                  onPlace={(id, text) => setCard(sel, updateBlock(card, id, { text }))} />
              </>
            ) : null}
            {card ? (
              <label className={`${CARD} flex flex-col gap-1.5 px-4 py-3`}>
                <span className={EYE}>Speaker notes</span>
                <textarea className={`${FIELD} min-h-[72px]`} value={card.notes || ''} placeholder={NOTES_PLACEHOLDER} readOnly={readOnly}
                  maxLength={model.notes_max} onChange={(e) => setCard(sel, { ...card, notes: e.target.value })} data-testid="pitch-editor-notes" />
              </label>
            ) : null}
          </div>
          <RightPanel panel={panel} setPanel={setPanel} project={project} sources={sources} refresh={refresh} kit={kit}
            model={model} card={card} theme={theme} audience={audience} readOnly={readOnly}
            onLayout={(layout) => setDialog({ kind: 'layout', layout })}
            onBackground={(bg) => setCard(sel, { ...card, background: bg })}
            onTheme={setTheme} onAudience={setAudience}
            onApplyAll={() => setDialog({ kind: 'apply-all' })} />
        </div>
      )}

      {dialog?.kind === 'save' ? (
        <SaveDialog changes={changes} onClose={() => setDialog(null)} onSaved={saved}
          save={() => api.deckUpdate(base.deck.id, { slides: cards, title: base.deck.title, theme, audience })} />
      ) : null}
      {dialog?.kind === 'layout' && card ? (() => {
        const r = applyLayout(card, dialog.layout);
        return (
          <ConfirmDialog title={`Use the ${dialog.layout.label} layout on card ${sel + 1}?`} testId="pitch-editor-layout-dialog"
            lines={[
              `The card's blocks move to the ${dialog.layout.label} preset; what it already says moves with them, kind by kind.`,
              ...(r.dropped.length ? [`The new layout has no place for: ${r.dropped.map(blockLabel).join(', ')}. ${r.dropped.length === 1 ? 'It leaves' : 'They leave'} the card.`] : []),
              'Nothing is saved until you press Save.',
            ]}
            confirm="Use this layout" onClose={() => setDialog(null)}
            onConfirm={() => { setCard(sel, r.card); setSelBlock(null); setDialog(null); }} />
        );
      })() : null}
      {dialog?.kind === 'remove-block' && card ? (
        <ConfirmDialog title="Remove this block?" testId="pitch-editor-remove-dialog"
          lines={[`The ${blockLabel(card.blocks.find((b) => b.id === dialog.id))} leaves card ${sel + 1}.`, 'Nothing is saved until you press Save.']}
          confirm="Remove" onClose={() => setDialog(null)}
          onConfirm={() => { setCard(sel, removeBlock(card, dialog.id)); setSelBlock(null); setDialog(null); }} />
      ) : null}
      {dialog?.kind === 'apply-all' ? (
        <ConfirmDialog title="Apply the theme to every card?" testId="pitch-editor-apply-dialog"
          lines={[`Every card draws on ${THEME_LABELS[theme?.kind || 'brand']}.`, "Each card's own background is cleared.", 'Nothing is saved until you press Save.']}
          confirm="Apply to all" onClose={() => setDialog(null)}
          onConfirm={() => { setCards((cs) => applyToAll(cs)); setDialog(null); }} />
      ) : null}
      {dialog?.kind === 'add-block' && card ? (
        <AddBlockDialog card={card} model={model} sources={sources} initialKind={dialog.initial} onClose={() => setDialog(null)}
          onAdd={(c) => { setCard(sel, c); setDialog(null); }} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The rail (PD1)
// ---------------------------------------------------------------------------

function Rail({ cards, sel, stale, readOnly, onSelect, move, onAdd }) {
  const [drag, setDrag] = useState(null);
  return (
    <nav className={`${CARD} flex flex-col gap-1 p-2`} aria-label="Cards" data-testid="pitch-editor-rail">
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {cards.map((c, i) => (
          <li key={i}
            draggable={!readOnly}
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { if (drag != null) e.preventDefault(); }}
            onDrop={() => { if (drag != null && drag !== i) move(drag, i); setDrag(null); }}>
            <button type="button"
              className={`flex min-h-[40px] w-full items-center gap-2 rounded-[9px] px-2 text-left text-[12.5px] ${i === sel ? 'bg-axal-lavender font-bold text-axal-violet dark:bg-violet-950/40 dark:text-violet-300' : `${INK} hover:bg-axal-ground dark:hover:bg-gray-800`}`}
              aria-current={i === sel ? 'true' : undefined}
              aria-keyshortcuts={readOnly ? undefined : 'ArrowUp ArrowDown'}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => {
                if (readOnly) return;
                const to = keyMove(e.key, i, cards.length);
                if (to != null && (e.altKey || e.metaKey)) { e.preventDefault(); move(i, to); }
              }}
              data-testid={`pitch-editor-rail-${i}`}>
              {!readOnly ? <span className="cursor-grab text-axal-muted" aria-hidden="true">⋮⋮</span> : null}
              <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 truncate">{cardTitle(c, i)}</span>
              {stale.has(i) ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="A figure on this card has changed in its store" data-testid={`pitch-editor-stale-${i}`} /> : null}
            </button>
          </li>
        ))}
      </ol>
      {!readOnly ? (
        <>
          <span className={`${MUTED} px-2 text-[11px]`}>Drag to reorder, or Alt + ↑ / ↓ on a card.</span>
          <button type="button" className={`${GHOST} mt-1`} onClick={onAdd} data-testid="pitch-editor-add-card"><Plus size={14} aria-hidden="true" /> Add card</button>
        </>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// The centre card (PD1, PD8b)
// ---------------------------------------------------------------------------

function CenterCard({ card, index, colours, theme, kit, selBlock, readOnly, onSelectBlock, onRemoveBlock, onAddBlock }) {
  const blocks = Array.isArray(card?.blocks) ? card.blocks : null;
  const bg = card?.background?.color || theme?.background?.color || colours.bg;
  const bgImage = card?.background?.image_url || theme?.background?.image_url || null;
  return (
    <div className="flex flex-col gap-2">
      {kit.status === 'error' ? <div className={`${MUTED} text-amber-700 dark:text-amber-300`} role="status">{KIT_FAILED} <button type="button" className="font-bold underline" onClick={kit.retry}>Try again</button></div> : null}
      {kit.status === 'ok' && !kit.data?.kit && theme?.kind !== 'neutral_light' && theme?.kind !== 'neutral_dark' ? <div className={MUTED}>{NO_KIT}</div> : null}
      <div className="relative w-full overflow-hidden rounded-[12px] border border-axal-hairline shadow-sm dark:border-gray-700"
        style={{ aspectRatio: '16 / 9', background: bg, color: colours.ink, backgroundImage: bgImage ? `url("${bgImage}")` : undefined, backgroundSize: 'cover' }}
        data-testid="pitch-editor-card">
        {blocks && blocks.length ? (
          <div className="absolute inset-0 grid gap-2 p-[3%]" style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, minmax(0, 1fr))' }}>
            {blocks.map((b) => (
              <button type="button" key={b.id}
                className={`relative min-h-0 min-w-0 overflow-hidden rounded-[8px] p-1.5 text-left ${selBlock === b.id ? 'outline outline-2 outline-violet-500' : 'outline outline-1 outline-dashed outline-black/10'}`}
                style={{ gridColumn: `${b.grid.c1} / ${b.grid.c2 + 1}`, gridRow: `${b.grid.r1} / ${b.grid.r2 + 1}` }}
                onClick={() => onSelectBlock(b.id)} aria-label={blockLabel(b)} data-testid={`pitch-editor-block-${b.id}`}>
                <BlockView block={b} colours={colours} />
              </button>
            ))}
          </div>
        ) : <FieldedCard card={card} index={index} colours={colours} />}
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={GHOST} onClick={onAddBlock} data-testid="pitch-editor-add-block"><Plus size={14} aria-hidden="true" /> Add a block</button>
          {selBlock ? <button type="button" className={GHOST} onClick={() => onRemoveBlock(selBlock)} data-testid="pitch-editor-remove-block"><Trash2 size={14} aria-hidden="true" /> Remove block</button> : null}
          <span className={`${MUTED} text-[11px]`}>12 × 6 grid. A block's size is the range it covers, columns by rows.</span>
        </div>
      ) : null}
    </div>
  );
}

/** A card saved before D898 has fields, not blocks: drawn as present mode draws it. */
function FieldedCard({ card, index, colours }) {
  const c = cardOf(card, index);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 overflow-hidden p-[5%]">
      <span className="font-mono text-[11px] font-bold" style={{ color: colours.accent }}>{c.n} · {c.title}</span>
      {c.sub ? <span className="text-[20px] font-extrabold leading-tight">{c.sub}</span> : null}
      {c.lines.map((l, i) => <span key={i} className="text-[13px]">{l}</span>)}
      {c.bullets.length ? <ul className="m-0 list-disc pl-5 text-[13px]">{c.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
      {c.figures.length ? (
        <div className="grid grid-cols-3 gap-2">
          {c.figures.map((f, i) => <span key={i} className="flex flex-col"><b className="text-[16px]">{f.value}</b><span className="text-[11px]" style={{ color: colours.muted }}>{f.label}</span></span>)}
        </div>
      ) : null}
    </div>
  );
}

function BlockView({ block: b, colours }) {
  if (b.kind === 'text') {
    if (!String(b.text || '').trim()) return <span className="text-[11px] italic" style={{ color: colours.muted }}>Text · empty</span>;
    if (b.style === 'heading') return <span className="text-[20px] font-extrabold leading-tight">{b.text}</span>;
    if (b.style === 'list') return <ul className="m-0 list-disc pl-4 text-[12px]">{String(b.text).split('\n').filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}</ul>;
    return <span className="text-[12.5px] leading-snug">{b.text}</span>;
  }
  if (b.kind === 'metric') {
    const v = tileValue(b);
    return (
      <span className="flex h-full flex-col justify-center">
        <span className="text-[10.5px] font-bold uppercase" style={{ color: colours.muted }}>{b.label || 'Metric'}</span>
        <span className={v === NOT_RECORDED ? 'text-[11.5px] italic' : 'text-[20px] font-extrabold'}>{v}</span>
        {b.binding ? <span className="text-[10px]" style={{ color: colours.muted }}>{b.binding.source_key} · {b.binding.as_of || 'date not recorded'} · {b.binding.grade || NOT_RECORDED}</span> : null}
      </span>
    );
  }
  if (b.kind === 'image') return b.image_url ? <img src={b.image_url} alt={b.alt || ''} className="h-full w-full rounded object-cover" /> : <span className="text-[11px] italic">Image · none chosen</span>;
  if (b.kind === 'video') {
    return (
      <span className="relative flex h-full w-full items-center justify-center rounded bg-black/80 text-white">
        {b.poster_url ? <img src={b.poster_url} alt="" className="absolute inset-0 h-full w-full rounded object-cover opacity-80" /> : null}
        <span className="relative text-[18px]" aria-hidden="true">▶</span>
        <span className="absolute bottom-1 left-1 right-1 truncate text-[10px]">{b.title || b.provider}</span>
      </span>
    );
  }
  if (b.kind === 'audio') return <span className="flex items-center gap-1 text-[11.5px]"><span aria-hidden="true">▶</span>{b.label || 'Audio clip'}</span>;
  if (b.kind === 'link') return <span className="inline-flex rounded-[8px] px-2 py-1 text-[12px] font-bold text-white" style={{ background: colours.accent }}>{b.label || 'Open'}</span>;
  if (b.kind === 'graphic') return <span className="text-[11px]" style={{ color: colours.muted }}>Graphic · {b.graphic || 'none chosen'}</span>;
  if (b.kind === 'chart') {
    return (
      <span className="flex h-full flex-col gap-1 text-[11px]">
        <b>{b.chart_type} chart</b>
        {(b.series || []).map((s, i) => <span key={i} style={{ color: colours.muted }}>{s.label || s.binding?.source_key || 'Series'}{s.points ? ' · Typed' : ''}</span>)}
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// The right panel (PD1, PD8)
// ---------------------------------------------------------------------------

const PANELS = [['sources', 'Sources'], ['design', 'Design'], ['notes', 'Notes']];

function RightPanel({ panel, setPanel, project, sources, refresh, kit, model, card, theme, audience, readOnly, onLayout, onBackground, onTheme, onAudience, onApplyAll }) {
  const staleMap = useMemo(() => {
    const m = new Map();
    for (const r of Array.isArray(refresh.data?.rows) ? refresh.data.rows : []) if (r.state === 'stale') m.set(r.source_key, r.bound?.as_of || null);
    return m;
  }, [refresh.data]);
  return (
    <aside className={`${CARD} flex min-w-0 flex-col`} data-testid="pitch-editor-panel">
      <div className="flex border-b border-axal-hairline dark:border-gray-700" role="tablist">
        {PANELS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={panel === id}
            className={`min-h-[40px] flex-1 text-[12.5px] font-bold ${panel === id ? 'border-b-2 border-axal-violet text-axal-violet dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}
            onClick={() => setPanel(id)} data-testid={`pitch-editor-tab-${id}`}>{label}</button>
        ))}
      </div>
      <div className="flex flex-col gap-3 overflow-auto p-3">
        {panel === 'sources' ? (
          <>
            {refresh.status === 'error' ? <ReadFailed text="Which figures have changed could not be read." onRetry={refresh.retry} testId="pitch-editor-refresh-error" /> : null}
            <SourcesPanel items={sources.data?.items || []} status={sources.status} onRetry={sources.retry} stale={staleMap} />
          </>
        ) : null}
        {panel === 'design' ? (
          <DesignTab model={model} card={card} theme={theme} audience={audience} kit={kit} readOnly={readOnly}
            onLayout={onLayout} onBackground={onBackground} onTheme={onTheme} onAudience={onAudience} onApplyAll={onApplyAll} />
        ) : null}
        {panel === 'notes' ? (
          <div className="flex flex-col gap-2">
            <span className={MUTED}>Notes from your venture's admins live in the Notes tab, with the card each one is about.</span>
            <Link className={GHOST} to={`/raise/pitch/notes${ventureQuery(project?.id)}`}>Open the notes</Link>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function DesignTab({ model, card, theme, audience, kit, readOnly, onLayout, onBackground, onTheme, onAudience, onApplyAll }) {
  const kitData = kit.status === 'ok' ? kit.data?.kit : null;
  return (
    <div className="flex flex-col gap-3" data-testid="pitch-editor-design">
      <span className={EYE}>Layouts · one click</span>
      <div className="grid grid-cols-3 gap-1.5">
        {model.layouts.map((l) => (
          <button key={l.id} type="button" disabled={readOnly || !card}
            className={`flex aspect-[16/10] items-center justify-center rounded-[7px] border p-1 text-center text-[10px] font-semibold leading-tight ${card?.layout === l.id ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:bg-violet-950/40 dark:text-violet-300' : `border-axal-hairline ${INK} dark:border-gray-700`}`}
            onClick={() => onLayout(l)} data-testid={`pitch-editor-layout-${l.id}`}>{l.label}</button>
        ))}
      </div>

      <span className={EYE}>Background · this card</span>
      <div className="flex items-center gap-2">
        <input type="color" aria-label="Card background colour" disabled={readOnly || !card}
          value={card?.background?.color || '#ffffff'} onChange={(e) => onBackground({ color: e.target.value, image_url: null })} />
        <span className={MUTED}>{card?.background?.color || card?.background?.image_url ? 'Its own background' : 'None: the theme shows'}</span>
        {card?.background && !readOnly ? <button type="button" className="text-[12px] font-bold text-axal-violet underline" onClick={() => onBackground(null)}>Clear</button> : null}
      </div>

      <span className={EYE}>Theme</span>
      {kit.status === 'loading' ? <Skeleton h="h-16" /> : null}
      {kit.status === 'error' ? <ReadFailed text="Your brand kit could not be read." onRetry={kit.retry} testId="pitch-editor-kit-error" /> : null}
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Theme">
        {model.themes.map((k) => (
          <label key={k} className={`flex min-h-[40px] cursor-pointer items-center gap-2 rounded-[9px] border px-3 text-[12.5px] ${(theme?.kind || 'brand') === k ? 'border-axal-violet' : 'border-axal-hairline dark:border-gray-700'} ${INK}`}>
            <input type="radio" name="theme" checked={(theme?.kind || 'brand') === k} disabled={readOnly}
              onChange={() => onTheme(k === 'brand' && !theme?.background ? null : { kind: k, background: theme?.background ?? null })} />
            <span className="flex flex-col">
              <span className="font-bold">{THEME_LABELS[k]}{k === 'brand' && kitData?.name ? ` · ${kitData.name}` : ''}</span>
              {k === 'brand' && kitData ? (
                <span className={MUTED}>
                  {[kitData.palette?.ink, kitData.palette?.accent, kitData.palette?.bg].filter(Boolean).join(' · ') || 'No palette recorded'}
                  {kitData.fonts ? ` · ${kitData.fonts}` : ''}
                  {kitData.voice?.length ? ` · ${kitData.voice.join(', ')}` : ''}
                </span>
              ) : null}
              {k === 'brand' && kit.status === 'ok' && !kitData ? <span className={MUTED}>{NO_KIT}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {!readOnly ? <button type="button" className={GHOST} onClick={onApplyAll} data-testid="pitch-editor-apply-all">Apply to all cards</button> : null}

      <span className={EYE}>Audience</span>
      <select className={FIELD} value={audience || ''} disabled={readOnly} onChange={(e) => onAudience(e.target.value || null)} data-testid="pitch-editor-audience-select">
        <option value="">{NOT_RECORDED}</option>
        {model.audiences.map((a) => <option key={a} value={a}>{AUDIENCE_LABELS[a] || a}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add a block (PD8c)
// ---------------------------------------------------------------------------

function AddBlockDialog({ card, model, sources, initialKind, onClose, onAdd }) {
  const [kind, setKind] = useState(ADDABLE_KINDS.includes(initialKind) ? initialKind : 'text');
  const [fields, setFields] = useState({ style: 'paragraph', text: '', ratio: '16:9' });
  const [video, setVideo] = useState(idle);
  const sizes = standardSizes(kind);
  const [size, setSize] = useState(sizes[0]);
  const [at, setAt] = useState(() => firstFree(card, sizes[0].cols, sizes[0].rows, model));
  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));

  const pickKind = (k) => {
    setKind(k); setVideo(idle);
    const s = standardSizes(k)[0];
    setSize(s); setAt(firstFree(card, s.cols, s.rows, model));
  };
  const pickSize = (s) => { setSize(s); setAt(firstFree(card, s.cols, s.rows, model)); };
  const grid = at ? { c1: at.c1, r1: at.r1, c2: at.c1 + size.cols - 1, r2: at.r1 + size.rows - 1 } : null;
  const problem = grid ? placementProblem(card, grid, model) : `No free ${size.cols} × ${size.rows} range on this card. Remove a block or pick a smaller size.`;

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
          <span className={`${MUTED} mr-auto`} data-testid="pitch-editor-add-says">{problem || missing || `Adds a ${size.cols} × ${size.rows} ${KIND_LABELS[kind].toLowerCase()} at column ${grid.c1}, row ${grid.r1}. Nothing is saved until you press Save.`}</span>
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
function SaveDialog({ changes, save, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = () => {
    setBusy(true); setError(null);
    save().then(
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
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5" data-testid="pitch-editor-save-changes">{changes.map((c, i) => <li key={i} className={`text-[13px] ${INK}`}>{c}</li>)}</ul>
        {error ? <span className="text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid="pitch-editor-save-error">{error}</span> : null}
      </div>
    </Lightbox>
  );
}

// ---------------------------------------------------------------------------
// Phone (PD26 frame 4): notes and order, no layout editing
// ---------------------------------------------------------------------------

function PhoneEditor({ cards, sel, setSel, move, card, readOnly, onNotes, notesMax }) {
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
    </div>
  );
}
