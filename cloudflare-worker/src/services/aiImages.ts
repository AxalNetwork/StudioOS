/**
 * The parts every generated-image press shares: the deck's images (D903) and
 * an article's (D1409). Moved here from `decks/images.ts`, which re-exports
 * them, so the article routes do not import across domains.
 *
 *   · the model, FLUX.1 Schnell, and the formats its bytes may come back in;
 *   · the real-person check, run before any quote or hold (422 `real_person`,
 *     the canvas's words). A name check reads only the names it is given; a
 *     public figure's name with no face word is not caught here (UNVERIFIED:
 *     the prompt's own "no identifiable people" is the backstop);
 *   · the balance for every image asked for, checked before any hold.
 */
import type { Env } from '../types';
import { aiPaused, loadAiBudget } from './aiBudget';
import { limitRefusal } from './aiSpendLimit';
import { budgetRefusalMessage } from './aiRouter';

export const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
export const IMAGE_MODEL_LABEL = 'FLUX.1 Schnell';
/** D1478 (#3721): each draw model's name, so a picked model's quote and image say which model it was. */
export const IMAGE_MODEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  [IMAGE_MODEL]: IMAGE_MODEL_LABEL,
  '@cf/black-forest-labs/flux-2-klein-4b': 'FLUX.2 Klein 4B',
  '@cf/black-forest-labs/flux-2-klein-9b': 'FLUX.2 Klein 9B',
  '@cf/black-forest-labs/flux-2-dev': 'FLUX.2 Dev',
  '@cf/leonardo/lucid-origin': 'Lucid Origin',
  '@cf/leonardo/phoenix-1.0': 'Phoenix 1.0',
});
export const imageModelLabel = (id: string | null | undefined): string | null => (id ? IMAGE_MODEL_LABELS[id] ?? null : null);

/** The bytes one generated image is assumed to need before it exists, for the storage check. */
export const IMAGE_BYTES_ESTIMATE = 1_500_000;
export const MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const REAL_PERSON_MESSAGE = 'Eadwyn does not draw real people. Upload a photo the person agreed to share.';

const FACE = /\b(faces?|facial|portraits?|headshots?|selfies?|mugshots?|likeness(?:es)?|close-?ups? of (?:a|the) (?:man|woman|person|face)|of (?:me|myself|us)|our (?:team|founders?|ceo|cto|staff|employees)|the (?:founders?|co-?founders?|ceo|cto)|co-?founders?)\b/i;

const WORD_CHAR = /[A-Za-z0-9_]/;
const LETTER = /\p{L}/u;
/** One UTF-16 unit each, compared without case exactly as a non-unicode `i` regex does. */
const canon = (ch: string) => {
  const up = ch.toUpperCase();
  // ECMAScript Canonicalize without the u flag: one unit to one unit, and never a non-ASCII unit onto ASCII.
  return up.length !== 1 || (ch.charCodeAt(0) >= 128 && up.charCodeAt(0) < 128) ? ch : up;
};
const sameUnit = (a: string, b: string) => canon(a) === canon(b);
/** Every index where `needle` sits in `hay`, case-insensitively unit by unit when `anyCase`. */
function* indexesOf(hay: string, needle: string, anyCase: boolean): Generator<number> {
  if (!needle) return;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let k = 0;
    while (k < needle.length && (anyCase ? sameUnit(hay[i + k], needle[k]) : hay[i + k] === needle[k])) k += 1;
    if (k === needle.length) yield i;
  }
}
/** `\b` at `at`: a word character on exactly one side (ASCII word characters, as a non-unicode regex reads them). */
const boundary = (s: string, at: number) => WORD_CHAR.test(s[at - 1] ?? '') !== WORD_CHAR.test(s[at] ?? '');
/** The name as a whole word in any case: what `\bname\b` with the `i` flag matched, without building that pattern. */
function wholeWord(text: string, name: string): boolean {
  for (const i of indexesOf(text, name, true)) if (boundary(text, i) && boundary(text, i + name.length)) return true;
  return false;
}
/** The surname, as written, with no letter (any script) touching either end. */
function standalone(text: string, last: string): boolean {
  for (const i of indexesOf(text, last, false)) {
    const before = [...text.slice(Math.max(0, i - 2), i)].pop() ?? '';
    const next = text.codePointAt(i + last.length);
    const after = next === undefined ? '' : String.fromCodePoint(next);
    if (!LETTER.test(before) && !LETTER.test(after)) return true;
  }
  return false;
}

/**
 * Why a description asks for a real person, or null. A full name matches in
 * any case; a surname of three letters or more matches capitalised, as a name
 * is written, so "grace" in a sentence is not read as a member named Grace.
 */
export function personIn(description: string, names: readonly string[]): 'face' | 'name' | null {
  if (FACE.test(description)) return 'face';
  for (const name of names) {
    if (wholeWord(description, name)) return 'name';
    const parts = name.split(/\s+/).filter((p) => p.length >= 3 && /^\p{Lu}/u.test(p));
    const last = parts.length > 1 ? parts[parts.length - 1] : null;
    if (last && standalone(description, last)) return 'name';
  }
  return null;
}

// ── The balance, before the hold ─────────────────────────────────────────────

/**
 * Whether the member's AI tokens cover `quote` micro-USD, checked before any
 * hold (the meeting bot's rule, `checkBotBudget`): paused, held for review,
 * a spend limit, then the day and month allowance plus the top-up balance.
 * Null when they do; otherwise the refusal in the router's words.
 */
export async function balanceRefusal(env: Env, userId: number, quote: number, now = new Date()): Promise<{ code: string; message: string } | null> {
  if (await aiPaused(env, userId)) return { code: 'ai_paused', message: budgetRefusalMessage('ai_paused') };
  const report = await loadAiBudget(env, userId, now);
  if (report.held_for_review.length) return { code: 'budget_review', message: budgetRefusalMessage('budget_review') };
  const limited = await limitRefusal(env, userId, quote, now);
  if (limited) return { code: 'spend_limit', message: budgetRefusalMessage('spend_limit', limited) };
  const day = Math.max(0, report.daily_microusd - report.day_spend_microusd - report.day_reserved_microusd);
  const month = Math.max(0, report.monthly_microusd - report.month_spend_microusd - report.month_reserved_microusd);
  if (quote > Math.min(day, month) + report.balance_microusd) {
    const code = report.daily_capped && day <= month ? 'budget_user_day' : 'budget_user_month';
    return { code, message: budgetRefusalMessage(code) };
  }
  return null;
}

/** An image's bytes are one of the three formats, read from the bytes themselves. */
export function sniffMime(bytes: Uint8Array): typeof MIMES[number] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
export const EXTENSION: Record<typeof MIMES[number], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
