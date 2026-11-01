/**
 * D1554 (#3801, deck v2 C6) — Magic Switch, the editor's half.
 *
 * The same reflow as the Worker's `services/decks/reflow.ts`, run on the
 * editor's draft when ⋯ › Slide size changes the aspect: what no longer fits
 * at the new aspect moves into the card's speaker notes, so the draft has no
 * overflow there, and pd3c's notice says how many blocks moved.
 *
 *   - a text block keeps the words that fit, cut at the last word boundary;
 *     the rest goes to the notes. A block that would keep no word leaves the
 *     slide;
 *   - a metric whose figure no longer fits its tile leaves the slide, and its
 *     label and figure go to the notes.
 *
 * The capacity rules mirror `designSystem.ts` (type scale, glyph width,
 * density caps, and D1517's 8 px baseline); `deck_reflow_d1554.test.ts` holds the two equal on every
 * structure. Pure: no React, no network.
 */
import { aspectOf, boxOf } from './gridModel.js';

/** Size and leading per type role, in slide pixels (`designSystem.TYPE_SCALE`). */
export const TYPE_SCALE = Object.freeze({
  display: { size: 104, leading: 1.04 },
  heading: { size: 64, leading: 1.1 },
  subheading: { size: 40, leading: 1.2 },
  paragraph: { size: 32, leading: 1.4 },
  list: { size: 30, leading: 1.45 },
  metric: { size: 72, leading: 1.0 },
  metric_label: { size: 24, leading: 1.3 },
  caption: { size: 22, leading: 1.35 },
  // D1517 (#3769): the cover's kicker.
  kicker: { size: 24, leading: 1.3 },
});
export const GLYPH_EM = 0.52;
/** D1517: every line sits on the 8 px baseline (`designSystem.BASELINE`, `lineHeight`). */
export const BASELINE = 8;
export const lineHeight = (size, leading) => Math.ceil((size * leading) / BASELINE) * BASELINE;
export const DENSITY_MAX = Object.freeze({
  display: 90, heading: 70, subheading: 90, paragraph: 280, list: 320, metric: 10, metric_label: 40, caption: 140, kicker: 40,
});
export const METRIC_VALUE_CHARS = 14;
export const NOTES_MAX = 4000;

export function typeRoleOf(style, layout = null) {
  if (style === 'heading') return layout === 'title' || layout === 'statement' || layout === 'quote' ? 'display' : 'heading';
  if (style === 'list') return 'list';
  return 'paragraph';
}

/** The characters a range holds at a type role and aspect. */
export function textCapacity(g, role, aspect = '16:9') {
  const { w, h } = boxOf(g, aspectOf(aspect));
  const t = TYPE_SCALE[role];
  const lines = Math.max(1, Math.floor(h / lineHeight(t.size, t.leading)));
  const perLine = Math.max(1, Math.floor(w / (t.size * GLYPH_EM)));
  return Math.min(lines * perLine, DENSITY_MAX[role]);
}

export const metricValueChars = (g, aspect = '16:9') =>
  Math.min(METRIC_VALUE_CHARS, Math.floor(boxOf(g, aspectOf(aspect)).w / (TYPE_SCALE.metric.size * GLYPH_EM)));

export const movedHeading = (to) => `Moved from the slide at ${to}:`;

/** The longest start of `text` that fits `max` characters, ending on a word boundary ('' if no word fits). */
export function fitWords(text, max) {
  if (text.length <= max) return text;
  if (max <= 0) return '';
  const cut = text.slice(0, max + 1);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return at > 0 ? text.slice(0, at).trimEnd() : '';
}

/** `{ cards, moved, count }`: the cards at `to`, with what no longer fits in each card's notes. */
export function reflowCards(cards, toIn) {
  const to = aspectOf(toIn);
  const moved = [];
  const out = (Array.isArray(cards) ? cards : []).map((s, i) => {
    if (!s || typeof s !== 'object' || !Array.isArray(s.blocks)) return s;
    const card = i + 1;
    const lines = [];
    const blocks = [];
    for (const b of s.blocks) {
      const g = b?.grid;
      if (!g) { blocks.push(b); continue; }
      if (b.kind === 'text') {
        const text = String(b.text ?? '');
        const cap = textCapacity(g, typeRoleOf(b.style, s.layout ?? null), to);
        if (text.length <= cap) { blocks.push(b); continue; }
        const kept = fitWords(text, cap);
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
    const notes = [was, `${movedHeading(to)}\n${lines.join('\n')}`].filter(Boolean).join('\n\n').slice(0, NOTES_MAX);
    return { ...s, blocks, notes };
  });
  return { cards: out, moved, count: moved.length };
}

/** pd3c's notice: "[N] blocks no longer fit and moved to the speaker notes." */
export const movedNotice = (n) => `${n} ${n === 1 ? 'block no longer fits' : 'blocks no longer fit'} and moved to the speaker notes.`;
