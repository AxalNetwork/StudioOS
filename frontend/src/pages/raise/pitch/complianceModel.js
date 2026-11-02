/**
 * D1546 (#3790, deck v2 B14) — the card's compliance lines, as the reader
 * pages draw them (the print page the PDF and PowerPoint photograph, the
 * share page, Present).
 *
 * The Worker's `services/decks/compliance.ts` is the rule: the share and
 * print reads carry its answer as `deck.compliance`, and `chromeOf` uses it.
 * Present reads the founder's own deck, which carries no answer, so this file
 * mirrors the rule from the slides and the theme. The words are the
 * Worker's, held equal by `deck_compliance_d1546` (owner decision T is open:
 * they are placeholders, replaced in both places at once).
 *
 * A chart that BlockGrid already labels as a projection (`projectionOf`)
 * keeps BlockGrid's note, so the card is not given the footnote twice.
 */
import { projectionOf } from './figuresModel';

export const CONFIDENTIAL = 'Confidential';
export const FLS_FOOTNOTE = 'Forward-looking projection from the venture’s own model. It is not a result and may not be achieved.';
export const ROUND_TERMS_NOTE = 'Round terms: Proposed, subject to counsel.';
const ROUND_TERM_KEYS = new Set(['raise.pre_money', 'raise.post_money', 'raise.dilution_pct', 'raise.round_terms']);

const bindings = (slide) => {
  const out = [];
  const ok = (b) => b && typeof b === 'object' && typeof b.source_key === 'string' && b.source_key;
  if (ok(slide?.binding)) out.push(slide.binding);
  for (const f of Array.isArray(slide?.fields) ? slide.fields : []) if (ok(f?.binding)) out.push(f.binding);
  for (const b of Array.isArray(slide?.blocks) ? slide.blocks : []) {
    if (ok(b?.binding)) out.push(b.binding);
    for (const s of Array.isArray(b?.series) ? b.series : []) if (ok(s?.binding)) out.push(s.binding);
  }
  return out;
};
const chartProjected = (slide, today) => (Array.isArray(slide?.blocks) ? slide.blocks : []).some((b) => projectionOf(b, today));

/** The deck's settings: on unless the theme turns a flag off. */
export const settingsOf = (theme) => ({ compliance_fls: theme?.compliance_fls !== false, confidential: theme?.confidential !== false });

/** The mirror: one card's lines, from its slide and the deck's theme. */
export function cardLines(slide, theme, today = new Date().toISOString().slice(0, 10)) {
  const c = settingsOf(theme);
  const bs = bindings(slide);
  const lines = [];
  if (c.compliance_fls && (bs.some((b) => b.grade === 'Projected' || b.source_key.startsWith('raise.projection_')) || chartProjected(slide, today))) lines.push(FLS_FOOTNOTE);
  if (bs.some((b) => ROUND_TERM_KEYS.has(b.source_key) && b.grade !== 'Reviewed')) lines.push(ROUND_TERMS_NOTE);
  return lines;
}

/** What a reader page draws on card `i`: the Worker's answer when the read carries it, else the mirror. */
export function chromeOf(deck, i, today = new Date().toISOString().slice(0, 10)) {
  const slide = deck?.slides?.[i];
  const given = deck?.compliance && Array.isArray(deck.compliance.footnotes);
  const lines = given ? (deck.compliance.footnotes[i] || []) : cardLines(slide, deck?.theme, today);
  const confidential = given ? deck.compliance.confidential === true : settingsOf(deck?.theme).confidential;
  // BlockGrid labels a projected chart itself (PROJECTION_NOTE); the card does not repeat the footnote.
  const shown = chartProjected(slide, today) ? lines.filter((l) => l !== FLS_FOOTNOTE) : lines;
  return { confidential, lines: shown };
}

const isDefault = (t) => t && t.kind === 'brand' && !t.background && Object.keys(t).every((k) => k === 'kind' || k === 'background');

/** The theme with Confidential on or off; a theme that is only the brand default again is null, as the editor keeps it. */
export function withConfidential(theme, on) {
  const { confidential: _drop, ...rest } = theme || { kind: 'brand', background: null };
  const next = on ? rest : { kind: 'brand', background: null, ...rest, confidential: false };
  return isDefault(next) ? null : next;
}

/** A new theme picked in the sheet keeps the deck's compliance settings (a flag turned off stays off). */
export function keepSettings(next, prev) {
  const off = {};
  if (prev?.confidential === false) off.confidential = false;
  if (prev?.compliance_fls === false) off.compliance_fls = false;
  // D1571 (#3818): the deck's language is a setting too, kept across a theme change.
  if (typeof prev?.lang === 'string') off.lang = prev.lang;
  if (prev?.dir === 'rtl' || prev?.dir === 'ltr') off.dir = prev.dir;
  if (!Object.keys(off).length) return next;
  return { kind: 'brand', background: null, ...(next || {}), ...off };
}
export const CONFIDENTIAL_HELP = 'In the corner of every card: Present, share links and every export.';
