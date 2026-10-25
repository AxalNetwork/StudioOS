/**
 * D1114 (#2994) — Story's "Ask Eadwyn ▾": draft this section, shorten it, or
 * put it in plain words. Pure where it can be: the route reads the section and
 * the positioning, and everything here is a function of what it read.
 *
 * NO FIGURE ENTERS. The founder's own words go to the model with every figure
 * masked as `[figure]`, and the positioning is read as words only, so no
 * number the founder recorded reaches the model (as D911's positioning run).
 *
 * NO FIGURE LEAVES. A sentence of the answer that holds a digit, or the mask,
 * is dropped before it is shown, and the answer says how many were dropped.
 * The store refuses a digit in Eadwyn's wording again when the founder saves
 * (D908), so a figure can only enter as a bound figure.
 *
 * NOTHING IS WRITTEN. The run returns the proposed words. The founder accepts
 * them into the section, and they are saved only by Save version, with
 * Eadwyn as the source; typing over them makes them the founder's.
 */
import { NARRATIVE_SECTIONS } from './store';

export const SECTION_PAGE = 'Founder · Raise · Investor narrative';
/** A hyphen, not a slash: a slash in a founder draft key is a research ZoneDraft surface (D911 §4). */
export const SECTION_OPTION = 'draft:narrative-section';
export const SECTION_MODES = ['draft', 'shorten', 'plain'] as const;
export type SectionMode = typeof SECTION_MODES[number];

const HAS_DIGIT = /[0-9]/;
const MASK = '[figure]';
const FIGURE = /[$£€]?\d[\d,.]*(?:\s?(?:%|(?:k|m|bn|x)\b))?/gi;

/** The founder's words with every figure masked, so none reaches the model. */
export function maskFigures(text: unknown): string {
  return String(text ?? '').replace(FIGURE, MASK).replace(/\s+/g, ' ').trim();
}

export type SectionMaterial = {
  label: string;
  max: number;
  words: string;
  audience: string | null;
  positioning: string[];
};

/** What the model reads, in the order it reads it; null when the section is unknown. */
export function sectionMaterial(sectionKey: string, words: unknown, audience: string | null, positioning: Array<{ label: string; text: unknown }>): SectionMaterial | null {
  const spec = NARRATIVE_SECTIONS.find((s) => s.key === sectionKey);
  if (!spec) return null;
  return {
    label: spec.label,
    max: spec.max,
    words: maskFigures(words),
    audience,
    positioning: positioning.map((p) => [p.label, maskFigures(p.text)] as const).filter(([, t]) => t && t !== MASK).map(([l, t]) => `${l}: ${t}`),
  };
}

/** Shorten and Plain words work on the founder's words; with none there is nothing to work on. */
export const needsWords = (mode: SectionMode, m: SectionMaterial) => mode !== 'draft' && !m.words.replace(/\[figure\]/g, '').trim();

export const SECTION_SYSTEM = 'You are Eadwyn, a writing assistant for a founder\'s investor narrative. You write plain, specific words and never a number. You give no advice. Always return valid JSON.';

const ASK: Record<SectionMode, string> = {
  draft: 'Draft the words for this section of the founder\'s investor narrative from the material below.',
  shorten: 'Shorten the founder\'s words for this section, keeping what they say.',
  plain: 'Rewrite the founder\'s words for this section in plain words a reader outside the field understands, keeping what they say.',
};

/** The prompt. Nothing in it holds a digit but the length limit. */
export function sectionPrompt(mode: SectionMode, m: SectionMaterial): string {
  return `${ASK[mode]}

Section: ${m.label}
Audience: ${m.audience || 'not recorded'}
Positioning:
${m.positioning.length ? m.positioning.map((p) => `- ${p}`).join('\n') : '- not recorded'}
The founder's words now: ${m.words || 'none yet'}

Return ONLY valid JSON of exactly this shape:
{ "text": "<the section's words>" }

Rules:
- Write no numbers, digits, percentages, prices, dates or counts of any kind. Figures are inserted by the founder from their records.
- Where the founder's words show ${MASK}, write around it; never write ${MASK}.
- At most ${m.max} characters.
- Never invent customers, results, partners or funding. Name no person. Give no advice.`;
}

/**
 * The words that may be proposed, and how many sentences were dropped because
 * they held a digit or the mask. Cut at the last word that fits the section.
 */
export function screenSection(parsed: unknown, max: number): { text: string; removed: number } {
  const o = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const raw = typeof o.text === 'string' ? o.text : '';
  let removed = 0;
  const kept: string[] = [];
  for (const sentence of raw.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
    const s = sentence.trim();
    if (!s) continue;
    if (HAS_DIGIT.test(s) || s.includes(MASK)) { removed += 1; continue; }
    kept.push(s);
  }
  let text = kept.join(' ');
  // Cut at the last whole word that fits; a word that ends exactly at the limit stays.
  if (text.length > max) text = text.slice(0, max + 1).replace(/\s+\S*$/, '').slice(0, max).trim();
  return { text, removed };
}
