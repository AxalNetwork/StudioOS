/**
 * D1546 (#3790, deck v2 B14) — the deck's compliance labels, in one place.
 *
 * OWNER DECISION T IS OPEN. Until it is answered the interim rule holds: the
 * forward-looking footnote is on, the Confidential footer is on, and the
 * wording is a placeholder to be replaced by counsel's. Every default and
 * every sentence below lives in this file, so the answer is a one-line change.
 *
 * WHAT A CARD CARRIES, in every format the Worker renders (the HTML file,
 * the .odp file, the editable PowerPoint behind Google Slides) and in the
 * share and present reads:
 *   - a projection's forward-looking footnote, when the card shows one: a
 *     binding graded Projected or a `raise.projection_*` slot (D1520), or a
 *     chart with a point after today (the editor's `projectionOf`);
 *   - "Proposed, subject to counsel" beside round terms (pre-money,
 *     post-money, dilution, the instrument) that counsel has not approved;
 *   - "Confidential" in the card's chrome, unless the deck turns it off.
 *
 * GUARANTEE LANGUAGE. A deck may not promise a return. `guaranteeHits` finds
 * the phrases a generated or assisted sentence may not carry, by fixed
 * patterns; `withoutGuarantees` drops each sentence that carries one before
 * the text is proposed. This is the free code block, separate from the
 * charged "Check wording" (#3808).
 *
 * Pure: no database, no model.
 */
import { bindingsOf } from './sources';
import { PROJECTION_FOOTNOTE, PROJECTION_LABEL } from './recordSources';

/** Owner decision T, interim: both on. A deck may turn Confidential off; the footnote stays on while `compliance_fls` is. */
export const COMPLIANCE_DEFAULTS = Object.freeze({ compliance_fls: true, confidential: true });
export const FLS_FOOTNOTE = PROJECTION_FOOTNOTE;
export const FLS_LABEL = PROJECTION_LABEL;
export const ROUND_TERMS_NOTE = 'Round terms: Proposed, subject to counsel.';
export const ROUND_TERMS_LABEL = 'Proposed, subject to counsel';
export const CONFIDENTIAL = 'Confidential';

export type Compliance = { compliance_fls: boolean; confidential: boolean };

/** The deck's settings from its theme: a flag is off only when the theme says `false`. */
export function complianceOf(theme: unknown): Compliance {
  const t = theme && typeof theme === 'object' ? theme as Record<string, unknown> : {};
  return {
    compliance_fls: t.compliance_fls === false ? false : COMPLIANCE_DEFAULTS.compliance_fls,
    confidential: t.confidential === false ? false : COMPLIANCE_DEFAULTS.confidential,
  };
}

const ROUND_TERM_KEYS = new Set(['raise.pre_money', 'raise.post_money', 'raise.dilution_pct', 'raise.round_terms']);
const monthOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null);

/** Does this card show a projection: a Projected binding, a projection slot, or a chart point after today. */
export function cardHasProjection(slide: unknown, today: string): boolean {
  const s = slide as any;
  if (bindingsOf([s]).some(({ binding }) => binding.grade === 'Projected' || binding.source_key.startsWith('raise.projection_'))) return true;
  const now = monthOf(today);
  for (const b of Array.isArray(s?.blocks) ? s.blocks : []) {
    if (b?.kind !== 'chart' || !Array.isArray(b.series) || !now) continue;
    if (b.series.some((sr: any) => (Array.isArray(sr?.points) ? sr.points : []).some((p: any) => { const m = monthOf(p?.x); return m != null && m > now; }))) return true;
  }
  return false;
}

/** Does this card show round terms counsel has not approved (`Reviewed` is counsel's approval, D1520). */
export function cardHasProposedTerms(slide: unknown): boolean {
  return bindingsOf([slide]).some(({ binding }) => ROUND_TERM_KEYS.has(binding.source_key) && binding.grade !== 'Reviewed');
}

/** The lines under one card, in order. */
export function slideFootnotes(slide: unknown, c: Compliance, today: string): string[] {
  const out: string[] = [];
  if (c.compliance_fls && cardHasProjection(slide, today)) out.push(FLS_FOOTNOTE);
  if (cardHasProposedTerms(slide)) out.push(ROUND_TERMS_NOTE);
  return out;
}

/** What every format draws for a deck: Confidential, and each card's footnotes. */
export type DeckCompliance = { confidential: boolean; footnotes: string[][] };
export function deckCompliance(slides: unknown, theme: unknown, today = new Date().toISOString().slice(0, 10)): DeckCompliance {
  const c = complianceOf(theme);
  const list = Array.isArray(slides) ? slides : [];
  return { confidential: c.confidential, footnotes: list.map((s) => slideFootnotes(s, c, today)) };
}

// ─────────────────────────────────────────────────────────────── guarantee language

/** The phrases no deck sentence may carry: a promised return, or a claim of no risk. Fixed patterns, never a model. */
export const GUARANTEE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bguarantee(?:d|s)?\s+(?:a\s+|an\s+|your\s+)?(?:return|returns|profit|profits|income|gains?|exit|outcome|growth|payout)/i,
  /\b(?:return|returns|profit|profits|gains?)\s+(?:are|is)\s+guaranteed\b/i,
  /\bguaranteed\s+(?:\d+(?:\.\d+)?\s*(?:%|x)|to\s+(?:grow|return|double|triple|10x|exit))/i,
  /\b(?:risk[- ]free|no[- ]risk|zero[- ]risk|without\s+(?:any\s+)?risk)\b/i,
  /\b(?:can(?:no|'|’)t|cannot|won(?:'|’)t)\s+lose\b/i,
  /\b(?:sure|certain|assured)\s+(?:thing|bet|return|returns|profit|win)\b/i,
  /\bwill\s+(?:certainly|definitely|surely)\s+(?:return|grow|double|triple|10x|exit|be\s+profitable)/i,
  /\b(?:you|investors?)\s+will\s+(?:make|earn|get)\s+(?:a\s+)?\d+(?:\.\d+)?\s*(?:x|%)/i,
];

/** The guarantee phrases a text carries, as written. */
export function guaranteeHits(text: unknown): string[] {
  const t = String(text ?? '');
  const out: string[] = [];
  for (const p of GUARANTEE_PATTERNS) { const m = p.exec(t); if (m) out.push(m[0]); }
  return out;
}

/** The text without any sentence that carries guarantee language; the count of sentences dropped. */
export function withoutGuarantees(text: string): { text: string; dropped: number } {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [text];
  let dropped = 0;
  const kept = sentences.filter((s) => { const hit = guaranteeHits(s).length > 0; if (hit) dropped += 1; return !hit; });
  return { text: dropped ? kept.join('').replace(/[ \t]+\n/g, '\n').trim() : text, dropped };
}

/**
 * Every string in a generated or assisted value with guarantee language
 * removed, keys and shape kept; `dropped` counts the sentences taken out.
 */
export function blockGuarantees<T>(value: T): { value: T; dropped: number } {
  let dropped = 0;
  const walk = (v: any, depth: number): any => {
    if (depth > 8) return v;
    if (typeof v === 'string') { const r = withoutGuarantees(v); dropped += r.dropped; return r.text; }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, KEEP_KEYS.has(k) ? x : walk(x, depth + 1)]));
    return v;
  };
  const out = walk(value, 0) as T;
  return { value: out, dropped };
}
/** Keys that are never prose: ids, kinds, URLs, bindings, grids. */
const KEEP_KEYS = new Set(['id', 'kind', 'key', 'uid', 'grid', 'binding', 'image_url', 'image_id', 'url', 'poster_url', 'chart_type', 'layout', 'structure', 'areas', 'source', 'tag', 'fit', 'crop']);
