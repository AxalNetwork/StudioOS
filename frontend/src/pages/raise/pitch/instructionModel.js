/**
 * D1604 (#3716, pd19, pd20) — what the editor's instruction box can do with
 * the selection, pure. No React, no network.
 *
 *   instructionPlan   the selection → one filled text area (runs on main,
 *                     `deck_assist` action `ask`), several areas (D1527,
 *                     #3795: `deckInstructApi`'s quote and run, D1521), off
 *                     (AI paused), or refused with why (a figure bound to a
 *                     record, an area with no words)
 *   severalBody       the several-area request: the card, the selection, the
 *                     words and 1–3 variants
 *   severalHold       the quote's line: "Holds up to $x · you pay what it
 *                     uses", with how many areas run and how many cannot
 *   labelResults      each area's results named by its chip ("c1–6 × r2–4 ·
 *                     Body"), so a proposal says which area it is for
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
import { areaLabel } from './deckV2Model.js';

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

// ─────────────────────────────────────────────── D1527 (#3795): several areas

/** How many variants an instruction on several areas may ask for (D1521: 1 to 3, each priced). */
export const VARIANT_CHOICES = Object.freeze([1, 2, 3]);
export const SEVERAL_RUNNING = 'Eadwyn is changing the selected areas…';
export const SEVERAL_STILL = 'Still running. The proposals stay in this deck’s proposals; nothing more is charged.';
export const RETRY = 'Retry';
/** pd19: Accept all is one step on the undo history (D1515), whatever it places. */
export const ONE_UNDO = 'Accept all is one undo step.';

/** The body both instruct routes take: the card's place, the selected areas, the words, the variants. */
export function severalBody({ cardIndex, areas = [], instruction, variants = 1 }) {
  const n = VARIANT_CHOICES.includes(Number(variants)) ? Number(variants) : 1;
  return { card: cardIndex, selection: areas.map((a) => ({ area_id: String(a.id ?? a) })), instruction: String(instruction ?? '').trim(), variants: n };
}

/**
 * The quote, as one line: what it holds, how many areas it runs, and how many
 * cannot (each says why below). `aiTokens` formats the hold.
 */
export function severalHold(quote, aiTokens) {
  if (!quote) return 'Reading the cost…';
  const refused = Array.isArray(quote.areas) ? quote.areas.filter((a) => a?.refusal).length : Number(quote.refused) || 0;
  const runs = Array.isArray(quote.areas) ? quote.areas.length - refused : Number(quote.runs) || 0;
  if (runs <= 0) return 'None of the selected areas can run. Nothing is held.';
  const hold = Number.isFinite(quote.hold_microusd) ? `Holds up to ${aiTokens(quote.hold_microusd)} · you pay what it uses` : 'Paid in AI tokens, charged to you when it runs.';
  return [hold, `${runs} ${runs === 1 ? 'area' : 'areas'}`, refused ? `${refused} cannot run` : null].filter(Boolean).join(' · ');
}

/** The quote's per-area refusals, by the area's chip label. */
export function severalRefusals(quote, areas = []) {
  const byId = new Map(areas.map((a) => [String(a.id), a]));
  return (Array.isArray(quote?.areas) ? quote.areas : []).filter((x) => x?.refusal).map((x) => {
    const a = byId.get(String(x.area_id ?? x.key));
    return { key: String(x.area_id ?? x.key), label: a ? areaLabel(a.grid) : String(x.area_id ?? x.key), message: x.refusal?.message || 'This area cannot run.' };
  });
}

/** Results (`areaRunResults`) named by their area's chip and carrying the area, in the selection's order. */
export function labelResults(results, areas = [], kindOf = () => null) {
  const order = new Map(areas.map((a, i) => [String(a.id), i]));
  const name = (key) => {
    const a = areas.find((x) => String(x.id) === String(key));
    return a ? [areaLabel(a.grid), kindOf(a)].filter(Boolean).join(' · ') : String(key);
  };
  // `area` is what `placeResult` places into: the selected area as the editor drew it.
  return (results || []).map((r) => ({ ...r, label: name(r.areaKey), area: areas.find((a) => String(a.id) === String(r.areaKey)) ?? null }))
    .sort((x, y) => (order.get(String(x.areaKey)) ?? 99) - (order.get(String(y.areaKey)) ?? 99));
}

/** Whether a run still has an area generating, so the box reads the batch again. */
export const stillRunning = (proposals) => (proposals || []).some((p) => p?.state === 'running' || !(Array.isArray(p?.variants) && p.variants.length));
