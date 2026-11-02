import React, { useEffect, useState } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, BringToFront, Group, Lock, Paintbrush, Plus, SendToBack, Trash2, Ungroup, Unlock,
} from 'lucide-react';
import AddMenu from './AddMenu';
import ImageToolbar from './ImageToolbar';
import { ChartToolbar } from './ChartTools';
import { FIGURE_LINE } from './deckAssistModel';
import { areaLabel } from './deckV2Model';
import { areaKind } from './gridSelection';
import { NOTES_PLACEHOLDER, placementProblem } from './editorModel';
import { pickGroup } from './gridSelection';
import { elementsLibrary } from './deckV2Adapter';
import { ARRANGE_OPS, DECOR_RULE, LAYERS_TITLE, arrange, arrangeState, decorLabel, decorPlan, decorSel, itemsOf } from './arrangeModel';

/**
 * D1604 (#3716, pd3) — the tools that show only while something on the Grid is
 * selected (the owner's rule: contextual tools on a selected card or area).
 * These are the editor's existing controls, moved under the card:
 *
 *   one block     "BODY · C1–7 × R2–6"; Columns, Rows, From column and From
 *                 row (a range that overlaps another block or leaves the Grid
 *                 says so and changes nothing); for text, Heading · Paragraph
 *                 · List and its words; a chart's toolbar (D898 group C); an
 *                 image's toolbar with its Alt text (D903); a bound figure's
 *                 source, which no tool rewrites; Remove block. Eadwyn works
 *                 on the area from its Ask ("Generate into N areas",
 *                 `AreaLightbox.jsx`) and the instruction box, not from here.
 *   one empty     "EMPTY · C1–6 × R1": Add a block here (that range, PD8c),
 *   range         the chart library (PD9b) and D899's Add menu.
 *   a card from   the same, for the whole card: its first block or layout
 *   before D898   turns its fields into blocks (#3656).
 *
 * Several areas show no block tools; SELBAR stands in for them. A reader gets
 * none.
 *
 * D1533 (#3777, pd26): `ArrangeSet`, the Arrange tools, shown only while an
 * area or a decor item is selected (never a permanent toolbar): align left,
 * centre, right, top, middle and bottom; distribute horizontally and
 * vertically; Group; Lock; Bring forward; Send back; Copy style. A tool that
 * cannot run says why on hover; a refusal says why and that nothing changed
 * (never red). `DecorLayers`, "LAYERS · DECOR ONLY": the card's decor, top
 * layer first, each named by the elements library (#3779) when it answers,
 * else by its kind; a row selects that item on the Grid. `SpeakerNotes` is the selected card's own, so it stays with the card.
 * Every change is the editor's, held until a version is saved.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const NUM = 'w-[64px] rounded-[8px] border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const SEG = 'min-h-[32px] px-3 text-[12px] font-bold';

const STYLE_WORDS = { heading: 'Heading', paragraph: 'Paragraph', list: 'List' };

/** The header line: "BODY · C1–7 × R2–6". */
export const toolsTitle = (area) => `${areaKind(area)} · ${areaLabel(area?.grid) || ''}`.toUpperCase();

/** Columns, rows and where it starts; a range that does not fit says why and changes nothing. */
function Span({ card, block, model, onPatch }) {
  const g = block.grid;
  const [draft, setDraft] = useState({ cols: g.c2 - g.c1 + 1, rows: g.r2 - g.r1 + 1, c1: g.c1, r1: g.r1 });
  const [problem, setProblem] = useState(null);
  useEffect(() => { setDraft({ cols: g.c2 - g.c1 + 1, rows: g.r2 - g.r1 + 1, c1: g.c1, r1: g.r1 }); setProblem(null); }, [block.id, g.c1, g.c2, g.r1, g.r2]);
  const change = (k, v) => {
    const n = Math.max(1, Math.round(Number(v) || 1));
    const d = { ...draft, [k]: n };
    setDraft(d);
    const grid = { c1: d.c1, r1: d.r1, c2: d.c1 + d.cols - 1, r2: d.r1 + d.rows - 1 };
    const why = placementProblem(card, grid, model, block.id);
    setProblem(why);
    if (!why) onPatch({ grid });
  };
  const fields = [['Columns', 'cols', model?.grid?.cols ?? 12], ['Rows', 'rows', model?.grid?.rows ?? 6], ['From column', 'c1', model?.grid?.cols ?? 12], ['From row', 'r1', model?.grid?.rows ?? 6]];
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-end gap-2">
        {fields.map(([label, k, max]) => (
          <label key={k} className="flex flex-col gap-0.5"><span className={EYE}>{label}</span>
            <input type="number" className={NUM} min={1} max={max} value={draft[k]} onChange={(e) => change(k, e.target.value)} data-testid={`pitch-tools-${k}`} />
          </label>
        ))}
      </span>
      {problem ? <span className={MUTED} role="status" data-testid="pitch-tools-span-problem">{problem} Nothing changed.</span> : null}
    </span>
  );
}

export function SpeakerNotes({ card, index, readOnly, notesMax, onNotes }) {
  if (!card) return null;
  return (
    <label className={`${CARD} flex flex-col gap-1.5 px-4 py-3`}>
      <span className={EYE}>Speaker notes · card {index + 1}</span>
      <textarea className={`${FIELD} min-h-[72px]`} value={card.notes || ''} placeholder={NOTES_PLACEHOLDER} readOnly={readOnly}
        maxLength={notesMax} onChange={(e) => onNotes(e.target.value)} data-testid="pitch-editor-notes" />
    </label>
  );
}

export default function BlockTools({
  card, cardIndex, area, model, charts, images = [], items = [], deckId,
  onPatch, onRemove, onChartLibrary, onAddBlock, onImage, onDesign, onPlace, onAddCard,
}) {
  const block = area?.kind === 'block' ? area.block : null;
  if (block) {
    return (
      <div className={`${CARD} flex flex-col gap-2.5 p-3`} role="toolbar" aria-label="Block tools" data-testid="pitch-block-tools">
        <div className="flex flex-wrap items-end gap-3">
          <span className={`${EYE} self-center text-axal-violet dark:text-violet-300`} data-testid="pitch-block-tools-title">{toolsTitle(area)}</span>
          <Span card={card} block={block} model={model} onPatch={onPatch} />
          {block.kind === 'text' ? (
            <span className="flex overflow-hidden rounded-[9px] border border-axal-hairline dark:border-gray-700" role="group" aria-label="Text style">
              {(model?.text_styles || ['heading', 'paragraph', 'list']).map((s) => (
                <button key={s} type="button" aria-pressed={(block.style || 'paragraph') === s}
                  className={`${SEG} ${(block.style || 'paragraph') === s ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/40 dark:text-violet-300' : 'bg-white text-axal-ink dark:bg-gray-900 dark:text-gray-100'}`}
                  onClick={() => onPatch({ style: s })} data-testid={`pitch-tools-style-${s}`}>{STYLE_WORDS[s] || s}</button>
              ))}
            </span>
          ) : null}
          <button type="button" className={`${GHOST} ml-auto`} onClick={onRemove} data-testid="pitch-editor-remove-block"><Trash2 size={14} aria-hidden="true" /> Remove block</button>
        </div>
        {block.kind === 'text' ? (
          <textarea className={`${FIELD} min-h-[64px]`} value={block.text || ''} maxLength={4000} aria-label="Words in this block"
            onChange={(e) => onPatch({ text: e.target.value })} data-testid="pitch-tools-text" />
        ) : null}
        {block.kind === 'metric' || block.binding?.source_key ? (
          <span className={MUTED} data-testid="pitch-tools-figure">
            {block.binding?.source_key ? `${block.binding.source_key} · ${block.binding.as_of || 'date not recorded'} · ${block.binding.grade || 'grade not recorded'}. ` : ''}
            {FIGURE_LINE((items.find((i) => i.source_key === block.binding?.source_key) || {}).module)}
          </span>
        ) : null}
        {block.kind === 'chart' ? (
          <ChartToolbar block={block} charts={charts} onPatch={onPatch} onLibrary={() => onChartLibrary(block.id)} onRemove={onRemove} />
        ) : null}
        {block.kind === 'image' ? (
          <ImageToolbar block={block} image={images.find((x) => x.uid === block.image_id) || null} onPatch={onPatch}
            onReplace={() => onImage('content', block.id)} onUpload={() => onImage('content', block.id)} onRegenerate={() => onImage('content', block.id)} onRemove={onRemove} />
        ) : null}
      </div>
    );
  }
  // An empty range, or a card from before the Grid (no area at all).
  const g = area?.grid || null;
  return (
    <div className={`${CARD} flex flex-col gap-2.5 p-3`} role="toolbar" aria-label="Area tools" data-testid="pitch-area-tools">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${EYE} text-axal-violet dark:text-violet-300`}>{g ? toolsTitle(area) : 'THIS CARD'}</span>
        <button type="button" className={GHOST} onClick={() => onAddBlock(g)} data-testid="pitch-editor-add-block"><Plus size={14} aria-hidden="true" /> {g ? 'Add a block here' : 'Add a block'}</button>
        <button type="button" className={GHOST} onClick={() => onChartLibrary(null, g)} data-testid="pitch-editor-chart-library">Chart library</button>
      </div>
      <AddMenu deckId={deckId} cardIndex={cardIndex} card={card} model={model} items={items}
        onBlock={(kind) => onAddBlock(g, kind)} onImage={(use) => onImage(use)} onDesign={onDesign}
        onPlace={onPlace} onAddCard={onAddCard} />
    </div>
  );
}

const ARRANGE_ICONS = {
  'align-left': AlignStartVertical, 'align-centre': AlignCenterVertical, 'align-right': AlignEndVertical,
  'align-top': AlignStartHorizontal, 'align-middle': AlignCenterHorizontal, 'align-bottom': AlignEndHorizontal,
  'distribute-h': AlignHorizontalDistributeCenter, 'distribute-v': AlignVerticalDistributeCenter,
  group: Group, lock: Lock, forward: BringToFront, back: SendToBack, 'copy-style': Paintbrush,
};

/** D1533 (pd26): the Arrange set on the selection. Each press is one edit through `onCard`. */
export function ArrangeSet({ card, selection, aspect = '16:9', model = null, onCard }) {
  const [line, setLine] = useState(null);
  const key = (selection || []).join('|');
  useEffect(() => { setLine(null); }, [key]);
  const items = itemsOf(card, selection, aspect);
  if (!items.length) return null;
  const state = arrangeState(card, selection);
  const grouped = items[0].group && items.every((i) => i.group === items[0].group);
  const locked = items.every((i) => i.pinned);
  const press = (op) => {
    if (!state[op]?.ok) return;
    const r = arrange(card, selection, op, { aspect, model });
    if (r.error) { setLine({ error: true, text: `${r.error} Nothing changed.` }); return; }
    setLine({ error: false, text: r.line });
    if (r.card) onCard(r.card);
  };
  return (
    <div className={`${CARD} flex flex-col gap-2 p-3`} role="toolbar" aria-label="Arrange" data-testid="pitch-arrange-tools">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${EYE} mr-1 text-axal-violet dark:text-violet-300`}>Arrange</span>
        {ARRANGE_OPS.map(({ id, label }) => {
          const Icon = id === 'group' && grouped ? Ungroup : id === 'lock' && locked ? Unlock : ARRANGE_ICONS[id];
          const name = id === 'group' && grouped ? 'Ungroup' : id === 'lock' && locked ? 'Unlock' : label;
          const ok = state[id]?.ok;
          return (
            <button key={id} type="button" aria-label={name} title={ok ? name : `${name}: ${state[id]?.why}`} aria-disabled={ok ? undefined : true}
              onClick={() => press(id)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-axal-hairline max-sm:h-11 max-sm:w-11 dark:border-gray-700 ${ok ? 'bg-white text-axal-ink hover:bg-axal-ground dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800' : 'cursor-not-allowed bg-white text-axal-muted opacity-50 dark:bg-gray-900 dark:text-gray-500'}`}
              data-testid={`pitch-arrange-${id}`}>
              <Icon size={15} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {line ? <span className={line.error ? MUTED : `${MUTED} font-mono text-[11px]`} role="status" data-testid={line.error ? 'pitch-arrange-refused' : 'pitch-arrange-line'}>{line.text}</span> : null}
    </div>
  );
}

/** D1533 (pd26): "LAYERS · DECOR ONLY", top layer first. A row selects its item (Shift adds); a reader only reads. */
export function DecorLayers({ card, selection = [], readOnly = false, onSelection }) {
  const plan = decorPlan(card);
  const [library, setLibrary] = useState(null);
  const has = plan.length > 0;
  useEffect(() => {
    if (!has) return undefined;
    let alive = true;
    elementsLibrary().then((a) => { if (alive) setLibrary(a); }, () => {});
    return () => { alive = false; };
  }, [has]);
  if (!has) return null;
  const rows = [...plan].reverse();
  return (
    <section className={`${CARD} flex flex-col gap-1.5 p-3`} aria-label="Layers" data-testid="pitch-decor-layers">
      <span className={`${EYE} text-axal-violet dark:text-violet-300`}>{LAYERS_TITLE}</span>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((p) => {
          const item = (card.decor || []).find((d) => String(d?.id) === p.id);
          const sel = decorSel(p.id);
          const on = selection.includes(sel);
          return (
            <li key={p.id}>
              <button type="button" aria-pressed={on} disabled={readOnly}
                onClick={(e) => onSelection?.({ selection: pickGroup(selection, null, sel, { shift: Boolean(e?.shiftKey) }, card), focus: null })}
                className={`flex min-h-[36px] w-full items-center gap-2 rounded-[8px] px-2 text-start text-[12.5px] ${on ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/40 dark:text-violet-300' : 'text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800'}`}
                data-testid={`pitch-decor-layer-${p.id}`}>
                <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">{p.layer}</span>
                <span className="min-w-0 flex-1 truncate">{decorLabel(item, library)}</span>
                {p.group ? <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">{`Group ${p.group}`}</span> : null}
                {p.pinned ? <Lock size={12} aria-label="Locked" /> : null}
              </button>
            </li>
          );
        })}
      </ol>
      <span className={MUTED} data-testid="pitch-decor-rule">{DECOR_RULE}</span>
    </section>
  );
}
