/**
 * D1554 (#3801, deck v2 C6) — Magic Switch: 16:9 ↔ 4:3, with no overflow.
 *
 * 4:3 keeps the 12 × 6 grid and its margins (D1499 §1), so every block keeps
 * its cells. What changes is width: a 4:3 cell is narrower, so a line holds
 * fewer characters and a metric tile a shorter figure. `reflowSlides` moves
 * what no longer fits at the target aspect into the card's speaker notes, so
 * its result has zero `fitProblems` there for anything the aspect decides:
 *
 *   - a text block keeps the words that fit, cut at the last word boundary;
 *     the rest goes to the notes. A block that would keep no word leaves the
 *     slide, and all its text goes to the notes;
 *   - a metric whose figure no longer fits its tile leaves the slide, and its
 *     label and figure go to the notes.
 *
 * Nothing else depends on the aspect (a chart's limits count series and
 * points, a diagram's its columns, a tile's height its rows), so nothing
 * else moves. Going to 16:9 moves nothing: every range is wider there.
 *
 * Pure: no binding. `frontend/src/pages/raise/pitch/deckReflow.js` mirrors it
 * for the editor's draft, with a parity test (`deck_reflow_d1554.test.ts`).
 */
import { fitProblems, fitText, metricValueChars, textCapacity, typeRoleOf } from './designSystem';
import { NOTES_MAX, type Grid } from './slideModel';
import { ASPECTS, STRUCTURES, aspectOf, boxOfAt, type Aspect } from './structures';

/** What moved from one block: the card (1-based), the block id, how, and the text that went to the notes. */
export type Moved = { card: number; block: string; kind: 'trimmed' | 'removed'; text: string };
export type Reflow = { from: Aspect; to: Aspect; slides: any[]; moved: Moved[]; count: number };

/** The line every moved passage is filed under in the notes. */
export const MOVED_HEADING = (to: Aspect) => `Moved from the slide at ${to}:`;

/** The longest start of `text` that fits `max` characters, ending on a word boundary ('' if no word fits). */
export function fitWords(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 0) return '';
  const cut = text.slice(0, max + 1);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return at > 0 ? text.slice(0, at).trimEnd() : '';
}

/**
 * The deck's cards at `to`, with what no longer fits moved to each card's
 * notes. `from` is the aspect the slides were made at (for the record only).
 * `count` is the number of blocks that moved, in whole or in part: the "[N]"
 * of "[N] blocks no longer fit and moved to the speaker notes."
 */
export function reflowSlides(slides: unknown, toIn: unknown, fromIn: unknown = '16:9'): Reflow {
  const to = aspectOf(toIn);
  const from = aspectOf(fromIn);
  const moved: Moved[] = [];
  const out = (Array.isArray(slides) ? slides : []).map((s: any, i: number) => {
    if (!s || typeof s !== 'object' || !Array.isArray(s.blocks)) return s;
    const card = i + 1;
    const lines: string[] = [];
    const blocks: any[] = [];
    for (const b of s.blocks) {
      const g = b?.grid as Grid | undefined;
      if (!g) { blocks.push(b); continue; }
      if (b.kind === 'text') {
        const text = String(b.text ?? '');
        const role = typeRoleOf(b.style, s.layout ?? null);
        const cap = textCapacity(g, role, to).chars;
        // D1511: kept text must also pass D1517's wrapped fit (`fitText`), the check `fitProblems` makes;
        // a word-wrapped line can hold fewer characters than the count, so drop words until it fits.
        if (text.length <= cap && fitText(g, role, text, to).fits) { blocks.push(b); continue; }
        let kept = fitWords(text, cap);
        while (kept && !fitText(g, role, kept, to).fits) kept = fitWords(kept, kept.length - 1);
        const rest = text.slice(kept.length).trim();
        if (kept) {
          blocks.push({ ...b, text: kept });
          moved.push({ card, block: String(b.id ?? '?'), kind: 'trimmed', text: rest });
        } else {
          moved.push({ card, block: String(b.id ?? '?'), kind: 'removed', text: text.trim() });
        }
        lines.push(kept ? rest : text.trim());
        continue;
      }
      if (b.kind === 'metric') {
        const value = String(b.value ?? '');
        if (value.length <= metricValueChars(g, to)) { blocks.push(b); continue; }
        const text = [String(b.label ?? '').trim(), value].filter(Boolean).join(': ');
        moved.push({ card, block: String(b.id ?? '?'), kind: 'removed', text });
        lines.push(text);
        continue;
      }
      blocks.push(b);
    }
    if (!lines.length) return s;
    const was = typeof s.notes === 'string' ? s.notes.trimEnd() : '';
    const notes = [was, `${MOVED_HEADING(to)}\n${lines.join('\n')}`].filter(Boolean).join('\n\n').slice(0, NOTES_MAX);
    return { ...s, blocks, notes };
  });
  return { from, to, slides: out, moved, count: moved.length };
}

/** Whether a deck's slides have nothing the aspect makes overflow (text and figures). */
export const fitsAt = (slides: unknown, aspect: unknown) =>
  fitProblems(slides, aspect).filter((p) => p.kind === 'overflow' || p.kind === 'value_too_long').length === 0;

/**
 * The reflow map of each structure: every area's box at both aspects, and how
 * much of its width 4:3 keeps. Rows and heights never change; only widths do.
 */
export function reflowMap() {
  return STRUCTURES.map((s) => ({
    id: s.id,
    areas: s.areas.map((a) => {
      const boxes = Object.fromEntries(ASPECTS.map((k) => [k, boxOfAt(a, k)])) as Record<Aspect, ReturnType<typeof boxOfAt>>;
      return { id: a.id, boxes, width_kept: Math.round((boxes['4:3'].w / boxes['16:9'].w) * 1000) / 1000 };
    }),
  }));
}
