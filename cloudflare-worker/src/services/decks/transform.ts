/**
 * D1560 (#3807, deck v2 C12) — AI beyond one card: speaker notes, proofread,
 * "fix this slide", and the translation pipeline, for `POST
 * /api/decks/:id/transform` (`routes/deck_transform.ts`). Pure: the route
 * reads the deck, runs the model and keeps the proposal; this file says what
 * the model is asked and what of its answer may be proposed.
 *
 * WHAT A RUN SEES. Only the words a founder typed: each card's title and its
 * text blocks. A block bound to a record (a `binding`) and a metric tile are
 * the records' and are never sent, so no run can reword a figure. The words
 * go to the model as untrusted data (D1506).
 *
 * WHAT MAY BE PROPOSED. Each answer is checked block by block, and a block
 * that fails is left out with its reason, never placed:
 *   - a sentence that promises a return is dropped (D1546), and a block whose
 *     every sentence did is left out;
 *   - a link or an email address the founder's words did not hold is left out;
 *   - proofread and fix: every digit run in the answer must already be in the
 *     block (no new figure);
 *   - translate: the block keeps the same digits, run for run, in Western
 *     digits (`sameDigits`); a figure dropped, added, reordered into another
 *     number or written in another script fails;
 *   - notes: every digit run must already be on the card; a run with none
 *     names no figure.
 * Nothing is saved: the route keeps one rail proposal, which Accept places.
 *
 * GUARD. `run()` checks input and output with Llama Guard 3, which is
 * trained on eight languages (`GUARD_LANGUAGES`, Meta's model card). A
 * translation into any other language is still run, but the quote and the
 * answer carry `warning`, so the founder reads it before it is shown.
 */
import { withoutGuarantees } from './compliance';
import { LANGUAGES } from './assist';
import { unrecordedLinks, untrustedBlock, withUntrustedRule } from '../ai/untrusted';

export const TRANSFORM_ACTIONS = ['speaker_notes', 'proofread', 'fix_slide', 'translate'] as const;
export type TransformAction = typeof TRANSFORM_ACTIONS[number];

/** Each action's rail option: the AIRail picks its model, the per-job defaults (#3721) apply. */
export const TRANSFORM_OPTIONS: Record<TransformAction, string> = {
  speaker_notes: 'deck:notes', proofread: 'deck:proofread', fix_slide: 'deck:fix-slide', translate: 'deck:translate',
};

/** The languages Llama Guard 3 is trained on (Meta's model card): a translation outside them warns. */
export const GUARD_LANGUAGES = Object.freeze(['English', 'French', 'German', 'Hindi', 'Italian', 'Portuguese', 'Spanish', 'Thai']);

export const TITLE_ID = '__title';
export const TITLE_MAX = 120;
export const BLOCK_MAX = 4000;
export const NOTES_MAX = 900;
export const CARDS_MAX = 40;

export type CardWords = { uid: string | null; index: number; title: string; blocks: Array<{ id: string; text: string }>; notes: string };
export type BlockChange = { id: string; before: string; after: string };
export type CardChange = { card_uid: string | null; index: number; notes?: { before: string; after: string }; blocks?: BlockChange[] };
export type Dropped = { card_uid: string | null; index: number; block: string | null; reason: string };

/** Why a translation into `language` warns, or null when Guard covers it. */
export function languageWarning(language: string | null | undefined): { code: 'guard_language'; message: string } | null {
  if (!language || GUARD_LANGUAGES.includes(language)) return null;
  return {
    code: 'guard_language',
    message: `The safety check is not trained on ${language}, so it may miss harmful words in this translation. Read it before you use it.`,
  };
}

/** Whether `language` may be asked for: the assist list, the one the instruction box offers too. */
export const isLanguage = (language: unknown): language is string => typeof language === 'string' && (LANGUAGES as readonly string[]).includes(language);

const isTextBlock = (b: any) => b && typeof b === 'object' && b.kind === 'text' && !b.binding && typeof b.text === 'string';

/**
 * The words of the deck's cards a run may see: each card's title and its
 * unbound text blocks. `pick` (card uids, or places as strings) narrows it.
 */
export function cardsOf(slides: unknown, pick: readonly string[] | null = null): CardWords[] {
  const list = Array.isArray(slides) ? slides : [];
  const want = pick && pick.length ? new Set(pick.map(String)) : null;
  const out: CardWords[] = [];
  list.forEach((s: any, index) => {
    const uid = typeof s?.uid === 'string' ? s.uid : null;
    if (want && !(uid && want.has(uid)) && !want.has(String(index))) return;
    const blocks = (Array.isArray(s?.blocks) ? s.blocks : []).filter(isTextBlock)
      .map((b: any) => ({ id: String(b.id ?? ''), text: String(b.text).slice(0, BLOCK_MAX) }))
      .filter((b: { id: string; text: string }) => b.id && b.text.trim());
    out.push({ uid, index, title: String(s?.title ?? '').trim().slice(0, TITLE_MAX), blocks, notes: typeof s?.notes === 'string' ? s.notes.trim() : '' });
  });
  return out.slice(0, CARDS_MAX);
}

/** Whether the cards hold any words a run could work on. */
export const hasWords = (cards: CardWords[]) => cards.some((c) => c.title || c.blocks.length);

const SYSTEM = withUntrustedRule([
  'You edit the words on an investor pitch deck.',
  'Never add a number, an amount, a percentage, a date or a count. Keep every figure the text already has exactly as written, in the same digits.',
  'Never promise or guarantee a return. Never add a link or an email address.',
  'Do not invent customers, partners or results. Return only JSON.',
].join(' '));

const ASK: Record<TransformAction, (language?: string) => string> = {
  speaker_notes: () => 'Write speaker notes for each card: what the presenter says aloud in two to four sentences, drawn only from the card\'s own words. Return {"cards":[{"uid":"<card uid>","notes":"..."}]}.',
  proofread: () => 'Proofread each block: fix spelling, grammar and punctuation only, keeping the meaning and the wording otherwise. Return only the blocks you changed: {"cards":[{"uid":"<card uid>","blocks":[{"id":"<block id>","text":"..."}]}]}.',
  fix_slide: () => 'Make this card read clearly to an investor: tighten each block, keep its meaning, keep every figure. Return {"cards":[{"uid":"<card uid>","blocks":[{"id":"<block id>","text":"..."}]}]}.',
  translate: (language) => `Translate each block into ${language}. Keep every number exactly as written, in Western digits. Return {"cards":[{"uid":"<card uid>","blocks":[{"id":"<block id>","text":"..."}]}]}.`,
};

/** What a run is asked: the cards' words as data, the title as block "__title". */
export function transformMessage(action: TransformAction, cards: CardWords[], o: { language?: string } = {}): { system: string; user: string } {
  const data = cards.map((c) => ({
    uid: c.uid ?? String(c.index),
    blocks: [...(c.title ? [{ id: TITLE_ID, text: c.title }] : []), ...c.blocks],
  }));
  return { system: SYSTEM, user: `${ASK[action](o.language)}\n\nCards:\n${untrustedBlock('deck_import', JSON.stringify(data))}` };
}

/** The tokens a run may answer with: the words sent, with room for notes. */
export const maxTokensFor = (action: TransformAction, cards: CardWords[]) => {
  const chars = cards.reduce((n, c) => n + c.title.length + c.blocks.reduce((m, b) => m + b.text.length, 0), 0);
  return Math.min(4000, 200 + (action === 'speaker_notes' ? cards.length * 160 : Math.ceil(chars / 2)));
};

// D1506's digits: every script, so a figure written in another script is a different run.
const DIGIT_RUN = /\p{Nd}+(?:[.,'   ]\p{Nd}+)*/gu;
const runsOf = (t: string) => (String(t).match(DIGIT_RUN) ?? []).map((r) => r.replace(/[^0-9]/g, '') + (/[^\x00-\x7f]/.test(r.replace(/[.,'   ]/g, '')) ? '*' : ''));

/**
 * Whether a translation keeps the same digits as its source block: the same
 * digit runs, in any order, separators aside, each in Western digits.
 */
export function sameDigits(before: string, after: string): boolean {
  const a = runsOf(before).sort();
  const b = runsOf(after).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]) && !b.some((x) => x.endsWith('*'));
}

/** Whether every digit run in `after` is already in `held`: no new figure. */
export function noNewDigits(held: string, after: string): boolean {
  const had = new Set(runsOf(held));
  return runsOf(after).every((r) => had.has(r) && !r.endsWith('*'));
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * What of a run's answer may be proposed, card by card, and what was left
 * out and why. Only cards and blocks the run was given are read.
 */
export function proposalsFrom(action: TransformAction, raw: unknown, cards: CardWords[]): { cards: CardChange[]; dropped: Dropped[] } {
  const answers = Array.isArray((raw as any)?.cards) ? (raw as any).cards : [];
  const changes: CardChange[] = [];
  const dropped: Dropped[] = [];
  for (const card of cards) {
    const key = card.uid ?? String(card.index);
    const answer = answers.find((a: any) => String(a?.uid ?? '') === key);
    if (!answer) continue;
    const ref = { card_uid: card.uid, index: card.index };
    const cardText = [card.title, ...card.blocks.map((b) => b.text), card.notes].join('\n');
    if (action === 'speaker_notes') {
      const { text: after, dropped: promised } = withoutGuarantees(clip(answer.notes, NOTES_MAX));
      if (!after) { dropped.push({ ...ref, block: null, reason: promised ? 'guarantee_language' : 'empty' }); continue; }
      if (unrecordedLinks(after, [cardText]).length) { dropped.push({ ...ref, block: null, reason: 'link_added' }); continue; }
      if (!noNewDigits(cardText, after)) { dropped.push({ ...ref, block: null, reason: 'figure_added' }); continue; }
      changes.push({ ...ref, notes: { before: card.notes, after } });
      continue;
    }
    const sources = new Map<string, string>([...(card.title ? [[TITLE_ID, card.title] as [string, string]] : []), ...card.blocks.map((b) => [b.id, b.text] as [string, string])]);
    const blocks: BlockChange[] = [];
    for (const b of Array.isArray(answer.blocks) ? answer.blocks : []) {
      const id = String(b?.id ?? '');
      const before = sources.get(id);
      if (before == null) continue;
      const { text: after, dropped: promised } = withoutGuarantees(clip(b?.text, id === TITLE_ID ? TITLE_MAX : BLOCK_MAX));
      const block = { ...ref, block: id };
      if (!after) { dropped.push({ ...block, reason: promised ? 'guarantee_language' : 'empty' }); continue; }
      if (after === before) continue;
      if (unrecordedLinks(after, [before]).length) { dropped.push({ ...block, reason: 'link_added' }); continue; }
      const digitsOk = action === 'translate' ? sameDigits(before, after) : noNewDigits(before, after);
      if (!digitsOk) { dropped.push({ ...block, reason: action === 'translate' ? 'figures_changed' : 'figure_added' }); continue; }
      blocks.push({ id, before, after });
    }
    if (blocks.length) changes.push({ ...ref, blocks });
  }
  return { cards: changes, dropped };
}
