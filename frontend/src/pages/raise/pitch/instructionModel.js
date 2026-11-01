/**
 * D1604 (#3716, pd19, pd20) — what the editor's instruction box can do with
 * the selection, pure. No React, no network.
 *
 *   instructionPlan   the selection → one filled text area (runs on main,
 *                     `deck_assist` action `ask`), several areas (the
 *                     adapter's `instruct`, #3773 / #3795), off (AI paused),
 *                     or refused with why (a figure bound to a record, an
 *                     area with no words)
 *   instructionField  the typed words: whether they name a figure, which is
 *                     refused before any quote (the Worker's own word list)
 *   typedChange       v1's Change tone and Translate, now typed (plan §0):
 *                     words that are only a tone ("warmer", "more formal")
 *                     or only a language ("in French", "translate to
 *                     German") run the Worker's own `tone` or `translate`
 *                     under deck:tone or deck:translate; anything else is
 *                     an instruction, `ask` under deck:rewrite
 *
 * Typed instructions live only here, scoped to the selection: New deck has no
 * prompt field, and neither the header's Ask nor the AIRail takes text.
 */

import { LANGUAGES, TONES, blockRefusal } from './deckAssistModel.js';
import { numberIn } from './newDeckModel.js';

/** An instruction is a rewrite with the founder's words (D899): one rail option. */
export const ASK_OPTION = 'deck:rewrite';
export const FIGURE_REFUSAL = 'Figures come from your records. Pick a recorded figure instead. Nothing was charged.';
export const INSTRUCTION_OFF = 'AI is paused for your studio. Typed instructions wait until it is back on.';
export const NOT_WORDS = 'Instructions change an area’s words. Select a text area that has words, or press Ask to generate into this one.';

/** The rail option each typed change is charged to (the Worker's `ASSIST_OPTIONS`). */
export const TYPED_OPTIONS = Object.freeze({ ask: ASK_OPTION, tone: 'deck:tone', translate: 'deck:translate' });

/** The words that name each of the Worker's tones, alone or with "more" or "tone". */
const TONE_WORDS = Object.freeze({
  confident: ['confident', 'more confident', 'bolder'],
  plain: ['plain', 'plainer', 'simpler', 'more plain', 'plain english'],
  warm: ['warm', 'warmer', 'more warm', 'friendlier'],
  formal: ['formal', 'more formal'],
});
const TONE_KEYS = new Set(TONES.map(([k]) => k));

/**
 * What typed words run as: `{ action: 'tone', tone }`, `{ action:
 * 'translate', language }`, or `{ action: 'ask' }`. Only words that are
 * nothing but a tone or a language take the fixed action, so "warmer and
 * shorter" stays an instruction.
 */
export function typedChange(text) {
  const w = String(text ?? '').trim().toLowerCase().replace(/[.!]+$/, '')
    .replace(/^(?:please\s+)?(?:make\s+(?:it|this)\s+)?/, '').replace(/\s+(?:tone|please)$/, '').replace(/\s+/g, ' ').trim();
  for (const [tone, words] of Object.entries(TONE_WORDS)) {
    if (TONE_KEYS.has(tone) && (words.includes(w) || w === `in a ${tone}` || w === `a ${tone}`)) return { action: 'tone', tone };
  }
  const lang = /^(?:translate(?:\s+(?:it|this))?\s+(?:in|into|to)\s+|in\s+)(.+)$/.exec(w)?.[1]?.trim();
  if (lang) {
    const language = LANGUAGES.find((l) => l.toLowerCase() === lang || l.toLowerCase().replace(/\s*\(.*\)$/, '') === lang);
    if (language) return { action: 'translate', language };
  }
  return { action: 'ask' };
}

/** The field's label and placeholder for N selected areas. */
export const placeholderFor = (n) => (n > 1 ? `Tell Eadwyn what to change in these ${n} areas` : 'Tell Eadwyn what to change in this area');

export function instructionPlan(areas, { aiOn = true, items = [] } = {}) {
  const list = Array.isArray(areas) ? areas : [];
  const placeholder = placeholderFor(list.length);
  if (!list.length) return { kind: 'none', placeholder };
  if (!aiOn) return { kind: 'off', placeholder };
  if (list.length > 1) return { kind: 'several', placeholder };
  const block = list[0].kind === 'block' ? list[0].block : null;
  if (!block || block.kind !== 'text' || block.binding?.source_key) {
    const bound = block && (block.kind === 'metric' || block.binding?.source_key);
    return { kind: 'refused', why: bound ? blockRefusal(block, items) : NOT_WORDS, placeholder };
  }
  const why = blockRefusal(block, items);
  if (why) return { kind: 'refused', why: NOT_WORDS, placeholder };
  return { kind: 'one', block, placeholder };
}

/** The typed words, as Send reads them: trimmed, and the figure they name, if any. */
export function instructionField(text) {
  const words = String(text ?? '').trim();
  return { words, figure: numberIn(words) };
}
