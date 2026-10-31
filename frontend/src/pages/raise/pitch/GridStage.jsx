import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { BlockView } from './BlockGrid';
import { ChartBlock } from './ChartTools';
import { overlayStyle } from './imageModel';
import { cardOf } from './presentExportModel';
import { KIT_FAILED, NO_KIT } from './editorModel';
import { areaLabel, askAreaName } from './deckV2Model';
import {
  KEYS_LINE, STAGE_HINT, areaTitle, areasOf, cellAt, keyStep, liveFocus, marquee, moveTo, nudge, pick, selectable, spanOf,
} from './gridSelection';

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
 * One geometry: the blocks, the marquee, the drag ghost and the overlay are
 * all `LAYER` (`absolute inset-0 grid gap-2 p-[3%]` on `TRACKS`), and
 * `cellAt` reads a pointer against the blocks layer's own measured box, its
 * width-based padding and its gutter, so a drop lands where its ghost showed.
 *
 * Nothing here writes: a move is the editor's `onMove`, held until a version
 * is saved like every other edit.
 */

const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono text-[10.5px] text-axal-muted dark:text-gray-400';
/** The Grid's one geometry: a CSS percentage padding is taken from the width on all four sides. */
const LAYER = 'absolute inset-0 grid gap-2 p-[3%]';
const TRACKS = { gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, minmax(0, 1fr))' };
const FRAME = 'absolute inset-0 p-[3%]';
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

/**
 * "Show the Grid": columns, rows, the safe area and an 8-step baseline, on the
 * blocks layer's own geometry (`LAYER`, `FRAME`), so its rows frame the blocks.
 * Decoration only.
 */
function GridOverlay() {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true" data-testid="pitch-editor-grid-overlay">
      <span className={FRAME}><span className="block h-full w-full rounded-[4px] outline outline-1 outline-dashed outline-violet-400/70" /></span>
      <span className={LAYER} style={TRACKS} data-testid="pitch-editor-grid-overlay-cells">
        {Array.from({ length: 72 }, (_, i) => <span key={i} className="rounded-[2px] bg-violet-400/10" />)}
      </span>
      <span className={FRAME}><span className="block h-full w-full" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 7px, rgba(124,58,237,0.12) 7px, rgba(124,58,237,0.12) 8px)' }} /></span>
    </span>
  );
}

/** The gutter the blocks layer really has, in px (`gap-2`, 8 px at the default root size). */
function gutterOf(node) {
  try {
    const css = globalThis.getComputedStyle?.(node);
    const v = parseFloat(css?.rowGap ?? css?.gap);
    return Number.isFinite(v) ? v : 8;
  } catch { return 8; }
}

export default function GridStage({
  card, index, model, colours, ink, theme, kit, charts, readOnly = false,
  selection, focus, onSelection, onMove, onAsk, askOff = null, askLine = null,
}) {
  const areas = useMemo(() => areasOf(card, model), [card, model]);
  const [grid, setGrid] = useState(false);
  const [drag, setDrag] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [refused, setRefused] = useState(null);
  const [box, setBox] = useState(null);
  const face = useRef(null);
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

  useEffect(() => { setRefused(null); setGhost(null); }, [index]);
  // The DOM focus follows the keyboard on the stage; a focus the card changed
  // under (a block now covers the focused range) never pulls it from a field.
  useEffect(() => {
    if (!live) return;
    const node = buttons.current.get(live);
    const active = globalThis.document?.activeElement;
    const box = face.current;
    if (active && active !== node && box && typeof box.contains === 'function' && !box.contains(active)) return;
    node?.focus?.();
  }, [live]);

  const bg = card?.background?.color || theme?.background?.color || colours.bg;
  const bgImage = card?.background?.image_url || theme?.background?.image_url || null;
  const veil = bgImage ? overlayStyle((card?.background?.image_url ? card.background : theme?.background)?.overlay, ink) : null;
  const chosen = (areas || []).filter((a) => selection.includes(a.id));
  // The blocks layer's own box (the face's padding box), its padding and its gutter.
  const rect = () => {
    const n = layer.current || face.current;
    return typeof n?.getBoundingClientRect === 'function' ? n.getBoundingClientRect() : null;
  };
  const cellOf = (e, fallback = null) => cellAt(e?.clientX, e?.clientY, rect(), model, { gap: layer.current ? gutterOf(layer.current) : 0 }) || fallback;

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
      {kit.status === 'ok' && !kit.data?.kit && theme?.kind !== 'neutral_light' && theme?.kind !== 'neutral_dark' ? <div className={MUTED}>{NO_KIT}</div> : null}

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

      <div ref={face}
        className="relative w-full select-none overflow-hidden rounded-[12px] border border-axal-hairline shadow-sm dark:border-gray-700"
        style={{ aspectRatio: '16 / 9', background: bg, color: colours.ink, backgroundImage: bgImage ? `url("${bgImage}")` : undefined, backgroundSize: 'cover' }}
        role={areas ? 'group' : undefined} aria-label={areas ? `Card ${index + 1} on the Grid` : undefined}
        onKeyDown={keys} onKeyUp={keyUp}
        onPointerDown={(e) => { if (e.target === face.current) down(e); }}
        onPointerMove={over} onPointerUp={up} onPointerLeave={() => { if (press.current) up(); }}
        onDragOver={(e) => dragOver(e, null)} onDrop={(e) => drop(e, null)}
        data-testid="pitch-editor-card">
        {veil ? <span className="absolute inset-0" style={{ background: veil }} aria-hidden="true" data-testid="pitch-editor-overlay" /> : null}
        {grid ? <GridOverlay /> : null}
        {areas ? (
          <div ref={layer} className={LAYER} style={TRACKS}
            onPointerDown={(e) => { if (e.target === e.currentTarget) down(e); }} data-testid="pitch-editor-blocks">
            {areas.map((a, i) => {
              const ok = selectable(a);
              const on = selection.includes(a.id);
              const tab = stop === a.id ? 0 : -1;
              const at = { gridColumn: `${a.grid.c1} / ${a.grid.c2 + 1}`, gridRow: `${a.grid.r1} / ${a.grid.r2 + 1}` };
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
                  onClick={(e) => click(e, a)}
                  className={`relative min-h-0 min-w-0 overflow-hidden rounded-[8px] p-1.5 text-left ${on ? 'outline outline-2 outline-violet-500 dark:outline-violet-400' : block ? 'outline outline-1 outline-dashed outline-black/10 dark:outline-white/20' : 'outline outline-1 outline-dashed outline-transparent hover:outline-black/15 dark:hover:outline-white/20'} ${a.id === live ? 'ring-[6px] ring-violet-400/30' : ''} ${ok.ok ? '' : 'cursor-not-allowed opacity-70'}`}
                  style={at}
                  data-testid={block ? `pitch-editor-block-${a.id}` : `pitch-editor-area-${a.id}`}>
                  {block
                    ? <BlockView block={a.block} colours={colours} renderChart={(b) => <ChartBlock block={b} charts={charts} colours={colours} />} />
                    : on ? <span className="font-mono text-[10px]" style={{ color: colours.muted }}>Empty · {areaLabel(a.grid)}</span> : null}
                </button>
              );
            })}
          </div>
        ) : <FieldedCard card={card} index={index} colours={colours} />}
        {box || ghost ? (
          <div className={`pointer-events-none ${LAYER}`} style={TRACKS} aria-hidden="true" data-testid="pitch-editor-drag-layer">
            {box ? <span className="rounded-[6px] border-2 border-dashed border-violet-500 bg-violet-400/10" style={{ gridColumn: `${box.c1} / ${box.c2 + 1}`, gridRow: `${box.r1} / ${box.r2 + 1}` }} data-testid="pitch-editor-marquee" /> : null}
            {ghost ? (
              <span className={`flex items-end rounded-[6px] border-2 border-dashed p-1 font-mono text-[10px] ${ghost.error ? 'border-gray-400 bg-gray-400/15 text-gray-600 dark:text-gray-300' : 'border-violet-500 bg-violet-400/15 text-violet-700 dark:text-violet-300'}`}
                style={{ gridColumn: `${Math.max(1, ghost.grid.c1)} / ${Math.min(13, ghost.grid.c2 + 1)}`, gridRow: `${Math.max(1, ghost.grid.r1)} / ${Math.min(7, ghost.grid.r2 + 1)}` }}>
                {areaLabel(ghost.grid)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {refused ? <span className={MUTED} role="status" data-testid="pitch-editor-drop-refused">{refused}</span> : null}
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
