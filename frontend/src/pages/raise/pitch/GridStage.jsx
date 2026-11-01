import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { BlockView } from './BlockGrid';
import { ChartBlock } from './ChartTools';
import { overlayStyle } from './imageModel';
import { SOURCE_NOT_RECORDED, cardOf } from './presentExportModel';
import { KIT_FAILED, NO_KIT, chromeOf } from './editorModel';
import { areaLabel, askAreaName } from './deckV2Model';
import { GRID, aspectOf, baselineShare, frameOf, placeOf, ratioOf } from './gridModel';
import { SourceChip } from './SourcesBoards';
import { ChangedNotice, FigureCard } from './FigureCard';
import { faceOf, isFigure, itemsByKey, staleFigures } from './figuresModel';
import {
  KEYS_LINE, STAGE_HINT, areaTitle, areasOf, cellAt, dividerDelta, dividerReadout, dividersOf, keyStep, liveFocus, marquee,
  moveDivider, moveTo, nudge, pick, selectable, spanOf,
} from './gridSelection';
import { minSizeProblem, moveOverflow, overLine, overflowOf } from './structureModel';

/**
 * D1604 (#3716, pd0, pd3, pd3b, pd11) — the card on The Grid, the editor's
 * centre. It draws through D1112's `BlockView`, the one way the editor,
 * Present and the print page draw a block.
 *
 *   areas      every block's range and every free range the blocks leave
 *              (`gridSelection.areasOf`), each a button named "Area 2 of 4 ·
 *              c1–7 × r2–6 · Chart". Click selects one; Shift-click adds or
 *              takes one away; a marquee dragged across the card selects what
 *              it touches; the keyboard moves, selects, extends, clears and
 *              nudges (`KEYS_LINE`). Locked and hidden areas cannot be
 *              selected, and hovering says why.
 *   overlay    "Show the Grid": the 12 × 6 columns and rows, the safe margins
 *              and the baseline, drawn over the card and never exported.
 *   drag       a block dragged to a free range moves there, its size kept;
 *              a drop on a taken range is refused with the sentence that says
 *              which block is in the way (never red, nothing changes).
 *   Ask        one area: the "Ask" chip above the card ("Ask Eadwyn about
 *              this area"). Two or more: SELBAR, "N areas selected · Ask ·
 *              Clear". What Ask opens is the editor's (`onAsk`).
 *
 * One geometry (D1499, #3749): the face is the deck's slide, 16:9 (1920 ×
 * 1080) or 4:3 (1440 × 1080) from the theme's `aspect`, and the blocks, the
 * free areas, the marquee, the drag ghost and the overlay are each placed
 * with `gridModel.placeOf`, which is `boxOf` (the Worker's `boxOfAt`, the
 * margins 112 / 96 / 88 and the 24 px gutter) as a share of the slide: the
 * fixed stage scaled to fit, never a CSS gap or padding. `cellAt` reads a
 * pointer back onto that same slide, so a drop lands where its ghost showed.
 *
 * Figures (pd6, pd24): a bound tile's face says source · grade through
 * `SourceChip`; the area the pointer or the keyboard is on (else the one
 * selected) shows its hover card under the card (`FigureCard.jsx`); and when
 * a figure's store has moved on, the card says so with Refresh from records
 * (`onRefresh`). None of it is drawn on Present, share or print.
 *
 * Dividers (D1513, #3765, pd12): where two blocks meet edge to edge, a violet
 * divider (role separator) moves the edge between them by whole cells, both
 * blocks resized in one edit (`onCard`). Arrow keys move it one cell; a
 * pointer drags it, snapped to cells, with the readout "7 | 5 → 6 | 6".
 * A move that would break a block's minimum ("A chart needs at least 4 × 3
 * cells.") or overlap another block (`placementProblem`) is refused with its
 * sentence and changes nothing. When a text block then holds fewer words than
 * it has, the stage says "N words over" with Move overflow to notes, one edit.
 *
 * Nothing here writes: a move is the editor's `onMove`, a divider or an
 * overflow its `onCard`, a refresh its `onRefresh`, each held until a version
 * is saved like every other edit.
 */
/** Where a divider's handle sits: the two cells either side of it, over the rows (or columns) both blocks share. */
export function dividerBox(card, div) {
  const a = (card?.blocks || []).find((x) => String(x.id) === div.a)?.grid;
  const b = (card?.blocks || []).find((x) => String(x.id) === div.b)?.grid;
  if (!a || !b) return null;
  return div.axis === 'v'
    ? { c1: a.c2, c2: b.c1, r1: Math.max(a.r1, b.r1), r2: Math.min(a.r2, b.r2) }
    : { c1: Math.max(a.c1, b.c1), c2: Math.min(a.c2, b.c2), r1: a.r2, r2: b.r1 };
}

const DIVIDER_KEYS = Object.freeze({ v: { ArrowLeft: -1, ArrowRight: 1 }, h: { ArrowUp: -1, ArrowDown: 1 } });


const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono text-[10.5px] text-axal-muted dark:text-gray-400';
/** The layer every area is placed in: the face itself; each area carries its own `placeOf` box. */
const LAYER = 'absolute inset-0';
const CHIP = 'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-bold max-sm:min-h-[44px]';

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
          {c.figures.map((f, i) => <span key={i} className="flex flex-col"><b className="text-[16px]">{f.v}</b><span className="text-[11px]" style={{ color: colours.muted }}>{f.k}</span></span>)}
        </div>
      ) : null}
    </div>
  );
}

/** The 72 cells, each one range wide, in reading order. */
const CELLS = Array.from({ length: GRID.cols * GRID.rows }, (_, i) => ({ c1: (i % GRID.cols) + 1, c2: (i % GRID.cols) + 1, r1: Math.floor(i / GRID.cols) + 1, r2: Math.floor(i / GRID.cols) + 1 }));

/**
 * "Show the Grid": the safe area, the 12 × 6 cells and the 8 px baseline,
 * each placed with `placeOf` on the slide, so its cells are the blocks'
 * cells. Decoration only.
 */
function GridOverlay({ aspect }) {
  const frame = frameOf(aspect);
  // The baseline's step as a share of the safe area's height (8 of 896 slide px), one hairline per step.
  const step = (baselineShare(aspect) * 100) / (parseFloat(frame.height) / 100);
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true" data-testid="pitch-editor-grid-overlay">
      <span className="rounded-[4px] outline outline-1 outline-dashed outline-violet-400/70" style={frame} data-testid="pitch-editor-grid-overlay-frame" />
      <span className="absolute inset-0" data-testid="pitch-editor-grid-overlay-cells">
        {CELLS.map((g, i) => <span key={i} className="rounded-[2px] bg-violet-400/10" style={placeOf(g, aspect)} />)}
      </span>
      <span style={{ ...frame, backgroundImage: 'linear-gradient(to bottom, transparent calc(100% - 1px), rgba(124,58,237,0.12) calc(100% - 1px))', backgroundSize: `100% ${step}%` }} data-testid="pitch-editor-grid-overlay-baseline" />
    </span>
  );
}

/**
 * D1500 (pd3, pd3-d): the chrome set once in `theme.chrome` and drawn on every
 * card: the logo corner (top left), Confidential (top right), the footer text
 * (bottom left) and the page number (bottom right). It sits on the slide, so it
 * keeps the brand theme in dark mode too, and it never takes a click.
 */
export function CardChrome({ chrome, pageLabel = null, colours, logo = null }) {
  if (!chrome) return null;
  const tone = { color: colours?.muted };
  const cls = 'pointer-events-none absolute font-mono text-[9.5px] uppercase tracking-wide';
  return (
    <span aria-hidden="true" data-testid="pitch-card-chrome">
      {chrome.logo_corner ? (
        logo
          ? <img src={logo} alt="" className="pointer-events-none absolute left-3 top-2 h-6 max-w-[96px] object-contain" data-testid="pitch-chrome-logo" />
          : <span className={`${cls} left-3 top-2`} style={tone} data-testid="pitch-chrome-logo">Logo</span>
      ) : null}
      {chrome.confidential ? <span className={`${cls} right-3 top-2 font-bold`} style={tone} data-testid="pitch-chrome-confidential">Confidential</span> : null}
      {chrome.footer_text ? <span className={`${cls} bottom-2 left-3 max-w-[70%] truncate normal-case`} style={tone} data-testid="pitch-chrome-footer">{chrome.footer_text}</span> : null}
      {chrome.page_number && pageLabel ? <span className={`${cls} bottom-2 right-3`} style={tone} data-testid="pitch-chrome-page">{pageLabel}</span> : null}
    </span>
  );
}

export default function GridStage({
  card, index, model, colours, ink, theme, kit, charts, readOnly = false,
  selection, focus, onSelection, onMove, onAsk, askOff = null, askLine = null, items = [], onRefresh = null,
  pageLabel = null, onCard = null,
}) {
  const aspect = aspectOf(theme?.aspect);
  const areas = useMemo(() => areasOf(card, model), [card, model]);
  const byKey = useMemo(() => itemsByKey(items), [items]);
  const changed = useMemo(() => staleFigures(card, items, charts), [card, items, charts]);
  const [hover, setHover] = useState(null);
  useEffect(() => { setHover(null); }, [index]);
  const face = (b) => {
    const f = faceOf(b.binding, byKey.get(b.binding?.source_key));
    return f ? <SourceChip item={f} face /> : <span className="font-mono text-[10px]" style={{ color: colours.muted }}>{SOURCE_NOT_RECORDED}</span>;
  };
  const [grid, setGrid] = useState(false);
  const [drag, setDrag] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [refused, setRefused] = useState(null);
  const [box, setBox] = useState(null);
  // Dividers: the one being dragged ({ id, delta, error }), the last readout or refusal, and a text block's overflow.
  const [sliding, setSliding] = useState(null);
  const [divLine, setDivLine] = useState(null);
  const [overflow, setOverflow] = useState(null);
  const faceRef = useRef(null);
  const layer = useRef(null);
  const buttons = useRef(new Map());
  const press = useRef(null);
  const swallow = useRef(false);
  // Space and Enter are handled as keys; the click a browser may send after them is not a second press.
  const keyed = useRef(0);

  // The focus names an area on this card, or falls back to the first one, so
  // there is always exactly one tab stop on the Grid.
  const first = (areas || []).find((x) => selectable(x).ok)?.id ?? null;
  const live = liveFocus(areas, focus);
  const stop = live ?? first;

  useEffect(() => { setRefused(null); setGhost(null); setSliding(null); setDivLine(null); setOverflow(null); }, [index]);
  const dividers = useMemo(() => (areas && onCard && !readOnly ? dividersOf(card) : []), [areas, card, onCard, readOnly]);
  // The DOM focus follows the keyboard on the stage; a focus the card changed
  // under (a block now covers the focused range) never pulls it from a field.
  useEffect(() => {
    if (!live) return;
    const node = buttons.current.get(live);
    const active = globalThis.document?.activeElement;
    const box = faceRef.current;
    if (active && active !== node && box && typeof box.contains === 'function' && !box.contains(active)) return;
    node?.focus?.();
  }, [live]);

  const bg = card?.background?.color || theme?.background?.color || colours.bg;
  const bgImage = card?.background?.image_url || theme?.background?.image_url || null;
  const veil = bgImage ? overlayStyle((card?.background?.image_url ? card.background : theme?.background)?.overlay, ink) : null;
  const chosen = (areas || []).filter((a) => selection.includes(a.id));
  // The blocks layer's own box: the face's padding box, the slide every area is placed on.
  const rect = () => {
    const n = layer.current || faceRef.current;
    return typeof n?.getBoundingClientRect === 'function' ? n.getBoundingClientRect() : null;
  };
  const cellOf = (e, fallback = null) => cellAt(e?.clientX, e?.clientY, rect(), model, { aspect }) || fallback;

  const set = (next) => onSelection?.(next);
  const click = (e, area) => {
    if (swallow.current) { swallow.current = false; return; }
    if (keyed.current && Date.now() - keyed.current < 600) { keyed.current = 0; return; }
    keyed.current = 0;
    const shift = Boolean(e?.shiftKey || e?.metaKey || e?.ctrlKey);
    set({ selection: pick(selection, areas, area.id, { shift }), focus: area.id });
  };
  const keys = (e) => {
    if (!areas) return;
    const step = keyStep({ selection, focus: live }, areas, e.key, { shift: e.shiftKey, alt: e.altKey });
    if (!step) return;
    e.preventDefault?.();
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') keyed.current = Date.now();
    if (step.nudge) {
      if (readOnly) return;
      const r = nudge(card, step.nudge.id, step.nudge.dc, step.nudge.dr, model);
      if (r.error) setRefused(r.error);
      else if (!r.same) { setRefused(null); onMove?.(step.nudge.id, r.grid); }
      return;
    }
    set({ selection: step.selection, focus: step.focus });
  };

  // The marquee: from a press on a free range or the card's margin, across at least one cell.
  // A real press always starts with a pointerdown: the click after it is the
  // user's, never the one a browser sends after Space or Enter.
  const keyUp = (e) => { if (e?.key === 'Enter') keyed.current = 0; };
  const down = (e, area = null) => {
    swallow.current = false;
    keyed.current = 0;
    if (area?.kind === 'block' || e?.button > 0) return;
    const at = cellOf(e);
    if (at) press.current = { from: at, to: at, moved: false };
  };
  const over = (e) => {
    if (!press.current) return;
    const at = cellOf(e);
    if (!at) return;
    const moved = at.c !== press.current.from.c || at.r !== press.current.from.r;
    press.current = { ...press.current, to: at, moved: press.current.moved || moved };
    if (press.current.moved) setBox(spanOf(press.current.from, at));
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    setBox(null);
    if (!p?.moved) return;
    swallow.current = true;
    const ids = marquee(areas, spanOf(p.from, p.to));
    set({ selection: ids, focus: ids[ids.length - 1] ?? live });
  };

  // Drag a block to a free range.
  const dragOver = (e, area) => {
    if (drag == null) return;
    e.preventDefault?.();
    const at = cellOf(e, area ? { c: area.grid.c1, r: area.grid.r1 } : null);
    if (!at) return;
    const r = moveTo(card, drag, at, model);
    const blk = (card.blocks || []).find((b) => String(b.id) === String(drag));
    if (!blk) return;
    const g = r.grid || { c1: at.c, c2: at.c + blk.grid.c2 - blk.grid.c1, r1: at.r, r2: at.r + blk.grid.r2 - blk.grid.r1 };
    setGhost({ grid: g, error: r.error || null });
  };
  const drop = (e, area) => {
    if (drag == null) return;
    e.preventDefault?.();
    const at = cellOf(e, area ? { c: area.grid.c1, r: area.grid.r1 } : null);
    const id = drag;
    setDrag(null); setGhost(null);
    if (!at) return;
    const r = moveTo(card, id, at, model);
    if (r.error) { setRefused(r.error); return; }
    setRefused(null);
    if (!r.same) onMove?.(id, r.grid);
  };

  // A divider moved by `delta` cells: one edit through `onCard`, then the overflow the smaller block now has.
  const slide = (div, delta) => {
    const r = moveDivider(card, div, delta, model, minSizeProblem);
    if (r.error) { setDivLine({ error: true, text: r.error }); return; }
    if (r.same) return;
    setDivLine({ error: false, text: dividerReadout(card, div, delta) });
    const over = overflowOf(r.card, div.a, aspect) || overflowOf(r.card, div.b, aspect);
    setOverflow(over ? { id: over.id, words: over.words } : null);
    onCard?.(r.card);
  };
  const divKeys = (e, div) => {
    const step = DIVIDER_KEYS[div.axis][e.key];
    if (!step) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    slide(div, step);
  };
  const divAt = (e, div) => {
    const at = cellAt(e?.clientX, e?.clientY, rect(), model, { aspect });
    return at ? dividerDelta(div, div.axis === 'v' ? at.c : at.r) : null;
  };
  const divDown = (e, div) => {
    if (e?.button > 0) return;
    e.stopPropagation?.();
    try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch { /* the drag still works without capture */ }
    setSliding({ id: div.id, delta: 0, error: null });
  };
  const divMove = (e, div) => {
    if (sliding?.id !== div.id) return;
    const delta = divAt(e, div);
    if (delta == null || delta === sliding.delta) return;
    const r = moveDivider(card, div, delta, model, minSizeProblem);
    setSliding({ id: div.id, delta, error: r.error || null });
  };
  const divUp = (div) => {
    const s = sliding;
    setSliding(null);
    if (s?.id !== div.id || !s.delta) return;
    slide(div, s.delta);
  };
  const moveOver = () => {
    if (!overflow) return;
    const r = moveOverflow(card, overflow.id, aspect);
    setOverflow(null);
    if (!r.same) { setDivLine(null); onCard?.(r.card); }
  };

  const one = chosen.length === 1 ? chosen[0] : null;
  const many = chosen.length > 1;
  const askButton = (n, testId) => (
    <button type="button" aria-label={askAreaName(n)} aria-disabled={askOff ? true : undefined}
      title={askOff || 'Generate, change or check this area'}
      className={`${CHIP} ${askOff ? 'cursor-not-allowed border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-500' : 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep hover:bg-white dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/40'}`}
      onClick={() => { if (!askOff) onAsk?.(); }} data-testid={testId}>
      <img src="/eadwyn-ai.png" alt="" width="14" height="14" className={askOff ? 'opacity-50 grayscale' : undefined} /> Ask
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="pitch-editor-stage">
      {kit.status === 'error' ? <div className={`${MUTED} text-amber-700 dark:text-amber-300`} role="status">{KIT_FAILED} <button type="button" className="font-bold underline" onClick={kit.retry}>Try again</button></div> : null}
      {kit.status === 'ok' && !kit.data?.kit && (!theme?.kind || theme.kind === 'brand') ? <div className={MUTED}>{NO_KIT}</div> : null}

      <div className="flex min-h-[40px] flex-wrap items-center justify-between gap-2">
        {one && !readOnly ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2" data-testid="pitch-editor-htb">
            {askButton(1, 'pitch-editor-ask-area')}
            <span className={MONO}>{areaTitle(one, areas.indexOf(one), areas.length)}</span>
          </span>
        ) : one ? (
          <span className={MONO} data-testid="pitch-editor-htb">{areaTitle(one, areas.indexOf(one), areas.length)}</span>
        ) : (
          <span className={MUTED} data-testid="pitch-editor-hint">{areas ? STAGE_HINT : 'This card is from before the Grid. Add a block, or pick a Structure in ⋯, to place it on the Grid.'}</span>
        )}
        {areas ? (
          <button type="button" aria-pressed={grid} onClick={() => setGrid((g) => !g)}
            className={`${CHIP} ${grid ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
            data-testid="pitch-editor-grid-toggle">
            <Grid3x3 size={13} aria-hidden="true" /> Show the Grid
          </button>
        ) : null}
      </div>
      {askLine ? <span className={MUTED} role="status" data-testid="pitch-editor-ask-line">{askLine}</span> : null}

      <div ref={faceRef}
        className="relative w-full select-none overflow-hidden rounded-[12px] border border-axal-hairline shadow-sm dark:border-gray-700"
        style={{ aspectRatio: ratioOf(aspect), background: bg, color: colours.ink, backgroundImage: bgImage ? `url("${bgImage}")` : undefined, backgroundSize: 'cover' }}
        role={areas ? 'group' : undefined} aria-label={areas ? `Card ${index + 1} on the Grid` : undefined}
        onKeyDown={keys} onKeyUp={keyUp}
        onPointerDown={(e) => { if (e.target === faceRef.current) down(e); }}
        onPointerMove={over} onPointerUp={up} onPointerLeave={() => { if (press.current) up(); }}
        onDragOver={(e) => dragOver(e, null)} onDrop={(e) => drop(e, null)}
        data-aspect={aspect} data-testid="pitch-editor-card">
        {veil ? <span className="absolute inset-0" style={{ background: veil }} aria-hidden="true" data-testid="pitch-editor-overlay" /> : null}
        {grid ? <GridOverlay aspect={aspect} /> : null}
        {areas ? (
          <div ref={layer} className={LAYER}
            onPointerDown={(e) => { if (e.target === e.currentTarget) down(e); }} data-testid="pitch-editor-blocks">
            {areas.map((a, i) => {
              const ok = selectable(a);
              const on = selection.includes(a.id);
              const tab = stop === a.id ? 0 : -1;
              const at = placeOf(a.grid, aspect);
              const block = a.kind === 'block';
              return (
                <button type="button" key={a.id}
                  ref={(n) => { if (n) buttons.current.set(a.id, n); else buttons.current.delete(a.id); }}
                  tabIndex={tab}
                  aria-label={areaTitle(a, i, areas.length)}
                  aria-pressed={on}
                  aria-disabled={ok.ok ? undefined : true}
                  title={ok.ok ? undefined : ok.why}
                  draggable={block && ok.ok && !readOnly}
                  onDragStart={(e) => { setDrag(a.id); try { e.dataTransfer?.setData?.('text/plain', a.id); } catch { /* the drag still works */ } }}
                  onDragEnd={() => { setDrag(null); setGhost(null); }}
                  onDragOver={(e) => { e.stopPropagation?.(); dragOver(e, a); }}
                  onDrop={(e) => { e.stopPropagation?.(); drop(e, a); }}
                  onPointerDown={(e) => down(e, a)}
                  onPointerEnter={() => setHover(a.id)}
                  onPointerLeave={() => setHover((h) => (h === a.id ? null : h))}
                  onFocus={() => setHover(a.id)}
                  onClick={(e) => click(e, a)}
                  className={`min-h-0 min-w-0 overflow-hidden rounded-[8px] p-1.5 text-left ${on ? 'outline outline-2 outline-violet-500 dark:outline-violet-400' : block ? 'outline outline-1 outline-dashed outline-black/10 dark:outline-white/20' : 'outline outline-1 outline-dashed outline-transparent hover:outline-black/15 dark:hover:outline-white/20'} ${a.id === live ? 'ring-[6px] ring-violet-400/30' : ''} ${ok.ok ? '' : 'cursor-not-allowed opacity-70'}`}
                  style={at}
                  data-testid={block ? `pitch-editor-block-${a.id}` : `pitch-editor-area-${a.id}`}>
                  {block
                    ? <BlockView block={a.block} colours={colours} renderFace={face} renderChart={(b) => <ChartBlock block={b} charts={charts} colours={colours} />} />
                    : on ? <span className="font-mono text-[10px]" style={{ color: colours.muted }}>Empty · {areaLabel(a.grid)}</span> : null}
                </button>
              );
            })}
          </div>
        ) : <FieldedCard card={card} index={index} colours={colours} />}
        {dividers.map((d) => {
          const at = dividerBox(card, d);
          if (!at) return null;
          const v = d.axis === 'v';
          const act = sliding?.id === d.id ? sliding : null;
          const readout = dividerReadout(card, d, act?.delta || 0);
          const a = (card.blocks || []).find((x) => String(x.id) === d.a);
          const b = (card.blocks || []).find((x) => String(x.id) === d.b);
          const size = v ? a.grid.c2 - a.grid.c1 + 1 : a.grid.r2 - a.grid.r1 + 1;
          const total = size + (v ? b.grid.c2 - b.grid.c1 + 1 : b.grid.r2 - b.grid.r1 + 1);
          return (
            <span key={d.id} className="pointer-events-none z-10" style={placeOf(at, aspect)}>
              <span role="separator" tabIndex={0} aria-orientation={v ? 'vertical' : 'horizontal'}
                aria-label={`Divider between ${areaLabel(a.grid)} and ${areaLabel(b.grid)}`}
                aria-valuenow={size} aria-valuemin={1} aria-valuemax={total - 1} aria-valuetext={readout}
                onKeyDown={(e) => divKeys(e, d)}
                onPointerDown={(e) => divDown(e, d)} onPointerMove={(e) => divMove(e, d)}
                onPointerUp={() => divUp(d)} onPointerCancel={() => setSliding(null)}
                className={`group pointer-events-auto absolute flex items-center justify-center outline-none ${v ? 'left-1/2 top-0 h-full w-6 -translate-x-1/2 cursor-col-resize' : 'left-0 top-1/2 h-6 w-full -translate-y-1/2 cursor-row-resize'}`}
                data-testid={`pitch-editor-divider-${d.id}`}>
                <span aria-hidden="true" className={`rounded-full ${act?.error ? 'bg-gray-400' : 'bg-violet-500'} ${act ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'} ${v ? 'h-full w-[3px]' : 'h-[3px] w-full'}`} />
                {act ? (
                  <span className="absolute whitespace-nowrap rounded-full bg-violet-600 px-2 py-0.5 font-mono text-[10px] text-white" data-testid="pitch-editor-divider-readout">
                    {act.error || readout}
                  </span>
                ) : null}
              </span>
            </span>
          );
        })}
        <CardChrome chrome={chromeOf(theme)} pageLabel={pageLabel} colours={colours} logo={kit?.data?.kit?.logo_url || null} />
        {box || ghost ? (
          <div className={`pointer-events-none ${LAYER}`} aria-hidden="true" data-testid="pitch-editor-drag-layer">
            {box ? <span className="rounded-[6px] border-2 border-dashed border-violet-500 bg-violet-400/10" style={placeOf(box, aspect)} data-testid="pitch-editor-marquee" /> : null}
            {ghost ? (
              <span className={`flex items-end rounded-[6px] border-2 border-dashed p-1 font-mono text-[10px] ${ghost.error ? 'border-gray-400 bg-gray-400/15 text-gray-600 dark:text-gray-300' : 'border-violet-500 bg-violet-400/15 text-violet-700 dark:text-violet-300'}`}
                style={placeOf({ c1: Math.max(1, ghost.grid.c1), c2: Math.min(GRID.cols, ghost.grid.c2), r1: Math.max(1, ghost.grid.r1), r2: Math.min(GRID.rows, ghost.grid.r2) }, aspect)}>
                {areaLabel(ghost.grid)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {refused ? <span className={MUTED} role="status" data-testid="pitch-editor-drop-refused">{refused}</span> : null}
      {divLine ? <span className={divLine.error ? MUTED : MONO} role="status" data-testid={divLine.error ? 'pitch-editor-divider-refused' : 'pitch-editor-divider-line'}>{divLine.text}</span> : null}
      {overflow && !readOnly ? (
        <span className={`${MUTED} flex flex-wrap items-center gap-2`} role="status" data-testid="pitch-editor-overflow">
          <span>{overLine(overflow.words)}</span> ·
          <button type="button" className="min-h-[36px] font-bold underline" onClick={moveOver} data-testid="pitch-editor-overflow-move">Move overflow to notes</button>
          <span className={MONO}>One edit</span>
        </span>
      ) : null}
      {(() => {
        const at = (areas || []).find((x) => x.id === hover) || one;
        return at?.kind === 'block' && isFigure(at.block) ? <FigureCard block={at.block} items={items} charts={charts} /> : null;
      })()}
      <ChangedNotice changed={changed} readOnly={readOnly} onRefresh={onRefresh} />
      {many ? (
        <div className="flex flex-wrap items-center gap-3 self-center rounded-full bg-gray-900 px-4 py-1.5 text-[12.5px] text-white shadow-lg dark:bg-gray-100 dark:text-gray-900" role="toolbar" aria-label="Selection" data-testid="pitch-editor-selbar">
          <span className="font-bold">{chosen.length} areas selected</span>
          {!readOnly ? askButton(chosen.length, 'pitch-editor-selbar-ask') : null}
          <button type="button" className="min-h-[36px] font-bold underline" onClick={() => set({ selection: [], focus: live })} data-testid="pitch-editor-selbar-clear">Clear</button>
        </div>
      ) : null}
      {areas ? <span className={MONO}>{KEYS_LINE}</span> : null}
    </div>
  );
}
