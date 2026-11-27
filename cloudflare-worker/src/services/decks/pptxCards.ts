/**
 * D1563 (#3810, deck v2 D2) — a .pptx deck as editable cards.
 *
 * Each slide becomes one card. Each shape that holds words becomes one text
 * block on The Grid's whole cells, through D11's shared parser
 * (`pptxTemplate.readPptxSlides` and `areaOn`); no second .pptx reader exists.
 * A box whose edges sit within `SNAP_TOLERANCE` of the lines snaps to them;
 * one between lines takes the nearer lines, and is counted as moved. A box
 * that would share a cell with a block already placed is nudged below it or
 * beside it; when neither fits, its words join the text block under it as
 * more lines (counted as merged). Words that would land on the title go to
 * the card's notes, so nothing is lost, and are counted as not placed.
 *
 * The counts are the import's own: how many characters the deck holds and how
 * many landed in an editable block (#3810's ≥ 90% target). Pictures, charts
 * and tables carry no words here; a table's words are one text block.
 *
 * No model runs, nothing is charged, and no slide text is logged. The words
 * are the founder's own file, kept as written: a figure in them is the
 * founder's, shown as text, never bound to a record.
 *
 * Pure: no binding, no fetch.
 */
import { NOTES_MAX } from './slideModel';
import { areaOn, areasOverlap, type ImportedSlide, type TemplateArea, type TextBox } from './pptxTemplate';

export const TITLE_TYPES = new Set(['title', 'ctrTitle']);
export const BLOCK_TEXT_MAX = 4000;
export const CARD_TITLE_MAX = 120;

export type ImportCounts = {
  slides: number;
  cards: number;
  text_chars: number;
  placed_chars: number;
  /** Share of the deck's characters in an editable block, 0–1; null when the deck holds no words. */
  placed_share: number | null;
  moved: number;
  /** Shapes whose words joined the text block under them. */
  merged: number;
  not_placed: number;
  left_out_slides: number;
};

type Grid = { c1: number; c2: number; r1: number; r2: number };

/** A box nudged clear of the areas already placed: below the one it meets, else beside it; null when neither fits. */
function clearOf(a: Grid, taken: Grid[]): Grid | null {
  const hit = taken.find((t) => areasOverlap(a, t));
  if (!hit) return a;
  const below = { ...a, r1: hit.r2 + 1 };
  if (below.r1 <= below.r2 && !taken.some((t) => areasOverlap(below, t))) return below;
  const beside = { ...a, c1: hit.c2 + 1 };
  if (beside.c1 <= beside.c2 && !taken.some((t) => areasOverlap(beside, t))) return beside;
  return null;
}

const chars = (s: string) => s.replace(/\s+/g, '').length;
const readingOrder = (a: TextBox, z: TextBox) => ((a.y || 0) - (z.y || 0)) || ((a.x || 0) - (z.x || 0));

/** One slide as a card: its words in text blocks on whole cells, its title from the title placeholder. */
export function cardOfSlide(slide: ImportedSlide, size: { cx: number; cy: number }): { card: any; text: number; placed: number; moved: number; notPlaced: number; merged: number } {
  const words = slide.shapes.filter((s) => s.text);
  const titleShape = words.find((s) => TITLE_TYPES.has(s.type));
  const blocks: any[] = [];
  const taken: Grid[] = [];
  const left: string[] = [];
  let text = 0, placed = 0, moved = 0, notPlaced = 0, merged = 0;
  // The title first, so the body moves around it, never the other way.
  const order = [...words].sort((a, z) => (Number(z === titleShape) - Number(a === titleShape)) || readingOrder(a, z));
  for (const s of order) {
    const n = chars(s.text);
    text += n;
    const sized = [s.x, s.y, s.w, s.h].every(Number.isFinite) && s.w > 0 && s.h > 0;
    let area: TemplateArea | null = null;
    if (sized) {
      const snapped = areaOn(s, size);
      const got = typeof snapped === 'string' ? areaOn(s, size, true) : snapped;
      if (typeof got !== 'string') {
        if (typeof snapped === 'string') moved += 1;
        area = got;
      }
    }
    const grid = area ? clearOf({ c1: area.c1, c2: area.c2, r1: area.r1, r2: area.r2 }, taken) : null;
    if (!grid) {
      // Words over a block already placed join it, as more lines of the same text; never the title's.
      const host = area ? blocks.find((b) => b.style !== 'heading' && areasOverlap(b.grid, area!)) : undefined;
      if (host && host.text.length + s.text.length < BLOCK_TEXT_MAX) {
        host.text = `${host.text}\n${s.text}`;
        if (host.style === 'paragraph') host.style = 'list';
        placed += n;
        merged += 1;
        continue;
      }
      left.push(s.text);
      notPlaced += 1;
      continue;
    }
    if (area && (grid.r1 !== area.r1 || grid.c1 !== area.c1)) moved += 1;
    taken.push(grid);
    const heading = s === titleShape;
    blocks.push({
      id: `b${blocks.length + 1}`, kind: 'text', grid,
      style: heading ? 'heading' : s.paras > 1 ? 'list' : 'paragraph',
      text: heading ? s.text.replace(/\n/g, ' ') : s.text.slice(0, BLOCK_TEXT_MAX),
    });
    placed += n;
  }
  const title = (titleShape?.text.replace(/\n/g, ' ') || words[0]?.text.split('\n')[0] || `Slide ${slide.n}`).slice(0, CARD_TITLE_MAX);
  const notes = left.length ? `Not placed on the grid:\n${left.join('\n\n')}`.slice(0, NOTES_MAX) : null;
  return {
    card: {
      title, subtitle: null, body: '', bullets: [], image_url: null, spec_id: 'import:pptx',
      blocks: blocks.sort((a, z) => (a.grid.r1 - z.grid.r1) || (a.grid.c1 - z.grid.c1)).map((b, i) => ({ ...b, id: `b${i + 1}` })),
      ...(notes ? { notes } : {}),
    },
    text, placed, moved, notPlaced, merged,
  };
}

/** Every slide as a card, in the deck's order, with the import's counts. */
export function cardsOfSlides(read: { cx: number; cy: number; slides: ImportedSlide[]; found: number }): { cards: any[]; counts: ImportCounts } {
  const size = { cx: read.cx, cy: read.cy };
  const cards: any[] = [];
  let text = 0, placed = 0, moved = 0, notPlaced = 0, merged = 0;
  for (const s of read.slides) {
    const r = cardOfSlide(s, size);
    cards.push(r.card);
    text += r.text; placed += r.placed; moved += r.moved; notPlaced += r.notPlaced; merged += r.merged;
  }
  return {
    cards,
    counts: {
      slides: read.found, cards: cards.length, text_chars: text, placed_chars: placed,
      placed_share: text ? Math.round((placed / text) * 1000) / 1000 : null,
      moved, merged, not_placed: notPlaced, left_out_slides: Math.max(0, read.found - read.slides.length),
    },
  };
}
