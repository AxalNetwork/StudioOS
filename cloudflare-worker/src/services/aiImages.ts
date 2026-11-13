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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Why a description asks for a real person, or null. A full name matches in
 * any case; a surname of three letters or more matches capitalised, as a name
 * is written, so "grace" in a sentence is not read as a member named Grace.
 */
export function personIn(description: string, names: readonly string[]): 'face' | 'name' | null {
  if (FACE.test(description)) return 'face';
  for (const name of names) {
    if (new RegExp(`\\b${escape(name)}\\b`, 'i').test(description)) return 'name';
    const parts = name.split(/\s+/).filter((p) => p.length >= 3 && /^\p{Lu}/u.test(p));
    const last = parts.length > 1 ? parts[parts.length - 1] : null;
    if (last && new RegExp(`(^|[^\\p{L}])${escape(last)}(?![\\p{L}])`, 'u').test(description)) return 'name';
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
