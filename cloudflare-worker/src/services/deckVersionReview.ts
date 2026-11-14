/**
 * D900 (#2679, part 6 of #2434) — a review of one studio version of the deck.
 *
 * The reviewer (`routes/deck_reviewer.ts`) reads an upload or pasted text and
 * maps it onto twelve sections, so a point can never say which card it is
 * about. This review reads the version's own cards, numbered as the studio
 * shows them, and every strength, weakness, red flag and fix names one card
 * (PD14). Three rules, each from the issue:
 *
 *   - A score is shown only because the review returned one. A missing or
 *     unreadable score is `null` ("Score not returned"), never a figure made
 *     up here (bug 6, D895).
 *   - Nothing is invented when the run fails. A refusal or an answer with no
 *     readable point stores no review; the route says the run returned none.
 *   - A point naming no card, or a card this version does not have, keeps its
 *     words and points nowhere (`card: null`), never at a guessed card.
 */
import type { Env } from '../types';
import { run as aiRun, type RailContext, type RunResult } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { parseJsonLoose } from './decks/autofill';

/** The four columns PD14 draws, in its order. */
export const REVIEW_COLUMNS = ['strengths', 'weaknesses', 'red_flags', 'fixes'] as const;
export type ReviewColumn = typeof REVIEW_COLUMNS[number];

/** One point of the review: its words and the card it is about (1-based), or null. */
export type CardPoint = { text: string; card: number | null };

/** A version review as stored in `deck_reviews.review_json` (`shape: 'cards'`). */
export type CardReview = {
  shape: 'cards';
  overall_score: number | null;
  summary: string;
  strengths: CardPoint[];
  weaknesses: CardPoint[];
  red_flags: CardPoint[];
  fixes: CardPoint[];
};

/** At most this many points per column, and this many characters per point. */
export const POINTS_MAX = 8;
export const POINT_CHARS = 400;
/** The deck text sent to the model, as the reviewer caps it. */
export const DECK_TEXT_MAX = 16_000;
export const REVIEW_MAX_TOKENS = 1800;

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * One card's words, in the order the card shows them: its title and subtitle,
 * the legacy body and bullets, then each field (a metric grid as "label: value").
 * An image is not text and is skipped.
 */
export function cardText(slide: unknown): string {
  if (!slide || typeof slide !== 'object') return '';
  const s = slide as Record<string, unknown>;
  const lines: string[] = [];
  const push = (v: unknown) => { const t = clean(v); if (t) lines.push(t); };
  push(s.title);
  push(s.subtitle);
  push(s.body);
  if (Array.isArray(s.bullets)) for (const b of s.bullets) { const t = clean(b); if (t) lines.push(`• ${t}`); }
  if (Array.isArray(s.fields)) {
    for (const f of s.fields as Array<Record<string, unknown>>) {
      if (!f || typeof f !== 'object' || f.kind === 'image') continue;
      const v = f.value;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object') {
            const m = item as Record<string, unknown>;
            const label = clean(m.label);
            const value = clean(m.value);
            if (label || value) lines.push(`${label}${label && value ? ': ' : ''}${value}`);
          } else {
            const t = clean(item);
            if (t) lines.push(`• ${t}`);
          }
        }
      } else {
        push(v);
      }
    }
  }
  // A field may repeat the card's title; say each line once.
  return [...new Set(lines)].join('\n');
}

/** The version's text, one "## Card N" block per card, capped as the reviewer caps it. */
export function deckText(slides: unknown[]): string {
  return slides
    .map((s, i) => `## Card ${i + 1}\n${cardText(s) || '(this card has no text)'}`)
    .join('\n\n')
    .slice(0, DECK_TEXT_MAX);
}

/** A card number the model gave, kept only when this version has that card. */
function cardOf(v: unknown, cards: number): number | null {
  const raw = typeof v === 'string' ? v.replace(/^\s*card\s*/i, '') : v;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= cards ? n : null;
}

function points(v: unknown, cards: number): CardPoint[] {
  if (!Array.isArray(v)) return [];
  const out: CardPoint[] = [];
  for (const item of v) {
    const text = clean(typeof item === 'string' ? item : (item as Record<string, unknown> | null)?.text).slice(0, POINT_CHARS);
    if (!text) continue;
    const card = typeof item === 'object' && item ? cardOf((item as Record<string, unknown>).card, cards) : null;
    out.push({ text, card });
    if (out.length >= POINTS_MAX) break;
  }
  return out;
}

/** A score the review returned, 0 to 100, or null. Never computed here. */
export function returnedScore(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.min(100, Math.max(0, Math.round(v)));
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Math.min(100, Math.max(0, Math.round(Number(v))));
  return null;
}

/**
 * The model's answer as a review, or null when it holds no point to show: no
 * summary and nothing in any column is no review at all, and none is stored.
 */
export function normalizeCardReview(raw: unknown, cards: number): CardReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const review: CardReview = {
    shape: 'cards',
    overall_score: returnedScore(r.overall_score),
    summary: clean(r.summary).slice(0, 1200),
    strengths: points(r.strengths, cards),
    weaknesses: points(r.weaknesses, cards),
    red_flags: points(r.red_flags, cards),
    fixes: points(r.fixes ?? r.priority_fixes, cards),
  };
  const any = REVIEW_COLUMNS.some((k) => review[k].length > 0);
  return review.summary || any ? review : null;
}

export const REVIEW_SYSTEM =
  'You are a blunt but constructive seed-stage investor reviewing a founder\'s pitch deck. Be candid, specific and useful: no fluff, no flattery, never rude. ' +
  'The deck is given card by card as "## Card N". Every point you make must name the one card it is about by its number. ' +
  'Respond ONLY with JSON of this shape: {"overall_score": number (0-100), "summary": string, "strengths": [{"text": string, "card": number}], ' +
  '"weaknesses": [{"text": string, "card": number}], "red_flags": [{"text": string, "card": number}], "fixes": [{"text": string, "card": number}]}. ' +
  'Ground every point in the cards\' text. Never invent a figure the cards do not state.';

export type VersionReviewRun = {
  /** The review, or null when the run returned none. */
  review: CardReview | null;
  /** The run as the router answered it (refusal, usage and its log row). */
  result: RunResult | null;
};

/** One review run over a version's cards. Never throws; a failed run returns `review: null`. */
export async function runVersionReview(env: Env, userId: number, slides: unknown[], rail: RailContext): Promise<VersionReviewRun> {
  const text = deckText(slides);
  let result: RunResult | null = null;
  try {
    result = await aiRun(env, {
      task: 'dd_synthesis',
      userId,
      surface: AI_SURFACE.raisePitchReview,
      rail,
      systemPrompt: REVIEW_SYSTEM,
      messages: [{ role: 'user', content: `Pitch deck, ${slides.length} cards:\n\n${text}\n\nReturn the review JSON now.` }],
      maxTokens: REVIEW_MAX_TOKENS,
      temperature: 0.4,
    });
  } catch {
    return { review: null, result: null };
  }
  if (!result.ok || !result.output) return { review: null, result };
  return { review: normalizeCardReview(parseJsonLoose<unknown>(result.output), slides.length), result };
}
