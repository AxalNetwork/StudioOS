/**
 * D4268 (#4268, D4254 P2a) — the Script tab's script, card by card. Pure: the
 * route (`routes/deck_script.ts`) reads the deck and the last rehearsal, runs
 * the model and keeps the proposal; this file says what each card's run is
 * asked and what of its answer may be placed.
 *
 * THE TARGET. The pitch length (2, 3 or 5 minutes, Rehearse's choices) is
 * split across the deck's cards in whole seconds, the first cards taking the
 * leftover seconds: the same split as Rehearse and Present (`cardBudgetsMs`,
 * D1580/D1581), so the Script tab, Rehearse and Present never disagree on a
 * card's budget. A card's word target is its budget times the pace: the words
 * a minute of the founder's latest rehearsal, or 150 when there is none.
 *
 * WHAT A RUN SEES. The card's title and unbound text blocks (`cardsOf`, as
 * D1560), and, read only, the figures the card shows: each metric tile's
 * label and value, and each bound block's text. The script may say those
 * figures and no other: "The script uses only the figures on each card."
 *
 * WHAT MAY BE PLACED. A card's draft fails, and is never placed, when it
 * names a digit run that is not on its card (`figure_added`), adds a link the
 * card does not hold (`link_added`), or is empty once a sentence promising a
 * return is dropped (D1546). Its run then costs nothing.
 */
import { withoutGuarantees } from './compliance';
import { NOTES_MAX } from './slideModel';
import { PITCH_SECONDS } from './rehearsal';
import { noNewDigits, type CardWords } from './transform';
import { unrecordedLinks, untrustedBlock, withUntrustedRule } from '../ai/untrusted';

export const SCRIPT_LENGTHS = PITCH_SECONDS;
export type ScriptLength = (typeof SCRIPT_LENGTHS)[number];
export const DEFAULT_LENGTH: ScriptLength = 180;

/** The audiences the toolbar offers, and what each tells the run. */
export const SCRIPT_AUDIENCES = Object.freeze({
  investor_meeting: 'an investor meeting: a partner across the table who can interrupt with questions',
  demo_day: 'a demo day stage: a room of investors hearing many pitches back to back',
  partner: 'a partner meeting: the whole partnership deciding whether to invest',
} as const);
export type ScriptAudience = keyof typeof SCRIPT_AUDIENCES;

/** The tones the toolbar offers, and what each tells the run. */
export const SCRIPT_TONES = Object.freeze({
  clear: 'plain and direct, short sentences',
  warm: 'warm and personal, as if talking to one person',
  bold: 'confident and energetic, without overclaiming',
} as const);
export type ScriptTone = keyof typeof SCRIPT_TONES;

/** The pace when the founder has no rehearsal yet, in words a minute. */
export const DEFAULT_WPM = 150;
/** A rehearsal's pace is used only inside this range; outside it the reading is not trusted. */
export const WPM_MIN = 80;
export const WPM_MAX = 220;

export const isLength = (v: unknown): v is ScriptLength => (SCRIPT_LENGTHS as readonly number[]).includes(Number(v));
export const isAudience = (v: unknown): v is ScriptAudience => typeof v === 'string' && Object.hasOwn(SCRIPT_AUDIENCES, v);
export const isTone = (v: unknown): v is ScriptTone => typeof v === 'string' && Object.hasOwn(SCRIPT_TONES, v);

/** The pitch length split across `cardCount` cards in whole seconds; the first cards take the leftover seconds. */
export function cardBudgetsS(lengthS: number, cardCount: number): number[] {
  const n = Math.max(0, Math.floor(Number(cardCount) || 0));
  if (!n) return [];
  const base = Math.floor(lengthS / n);
  const extra = lengthS - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** A card's word target: its budget at the pace, at least one word. */
export const wordTarget = (budgetS: number, wpm: number) => Math.max(1, Math.round((budgetS * wpm) / 60));

/** The words in a text, as the Script tab counts them. */
export const wordsOf = (text: unknown) => (typeof text === 'string' ? text.trim().split(/\s+/).filter(Boolean).length : 0);

/**
 * The pace a rehearsal report gives, or null: its `totals.wpm` when it is a
 * whole number in [WPM_MIN, WPM_MAX].
 */
export function paceOf(reportJson: unknown): number | null {
  let report: any = reportJson;
  if (typeof reportJson === 'string') { try { report = JSON.parse(reportJson); } catch { return null; } }
  const wpm = Number(report?.totals?.wpm);
  return Number.isFinite(wpm) && wpm >= WPM_MIN && wpm <= WPM_MAX ? Math.round(wpm) : null;
}

/** The figures a card shows, read only: each metric tile's label and value, and each bound block's text. */
export function figuresOf(slide: unknown): string[] {
  const blocks = Array.isArray((slide as any)?.blocks) ? (slide as any).blocks : [];
  const out: string[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.kind === 'metric') {
      const line = [b.label, b.value].filter((x) => typeof x === 'string' || typeof x === 'number').map(String).join(': ').trim();
      if (line) out.push(line.slice(0, 200));
    } else if (b.kind === 'text' && b.binding && typeof b.text === 'string' && b.text.trim()) {
      out.push(b.text.trim().slice(0, 400));
    }
  }
  return out.slice(0, 12);
}

export type ScriptCard = CardWords & { figures: string[]; budget_s: number; target_words: number };

const SYSTEM = withUntrustedRule([
  'You write what a founder says aloud while one card of their pitch deck is on screen.',
  'Use only the card\'s own words and the figures listed for it. Never add a number, an amount, a percentage, a date or a count that the card does not show.',
  'Never promise or guarantee a return. Never add a link or an email address. Do not invent customers, partners or results.',
  'Write spoken sentences, not bullet points. Return only JSON.',
].join(' '));

/** What one card's run is asked: its words and figures as data, the target, the audience and the tone. */
export function scriptMessage(card: ScriptCard, o: { audience: ScriptAudience; tone: ScriptTone }): { system: string; user: string } {
  const data = { title: card.title, words: card.blocks.map((b) => b.text), figures: card.figures };
  const ask = [
    `Write the script for this card in about ${card.target_words} words (it has ${card.budget_s} seconds).`,
    `The pitch is for ${SCRIPT_AUDIENCES[o.audience]}. The tone is ${SCRIPT_TONES[o.tone]}.`,
    'Return {"notes":"..."}.',
  ].join(' ');
  return { system: SYSTEM, user: `${ask}\n\nCard:\n${untrustedBlock('deck_import', JSON.stringify(data))}` };
}

/** The tokens one card's run may answer with: about two a word, with room for the JSON. */
export const scriptMaxTokens = (card: ScriptCard) => Math.min(2000, 80 + card.target_words * 2);

export type ScriptOutcome = { ok: true; notes: string; words: number } | { ok: false; reason: 'empty' | 'guarantee_language' | 'link_added' | 'figure_added' };

/** What of one card's answer may be placed, or why it fails. */
export function scriptFrom(raw: unknown, card: ScriptCard): ScriptOutcome {
  const text = typeof (raw as any)?.notes === 'string' ? (raw as any).notes.trim().slice(0, NOTES_MAX) : '';
  const { text: notes, dropped } = withoutGuarantees(text);
  if (!notes) return { ok: false, reason: dropped ? 'guarantee_language' : 'empty' };
  const held = [card.title, ...card.blocks.map((b) => b.text), ...card.figures].join('\n');
  if (unrecordedLinks(notes, [held]).length) return { ok: false, reason: 'link_added' };
  if (!noNewDigits(held, notes)) return { ok: false, reason: 'figure_added' };
  return { ok: true, notes, words: wordsOf(notes) };
}
