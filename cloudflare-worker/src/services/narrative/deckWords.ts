/**
 * D6069 (#6069) — the words a saved pitch deck version gives a new narrative
 * version ("Start from: Pitch deck vN's words", NAR11).
 *
 * BY CARD TITLE, INTO THE DECK KEYS. A narrative section with a deck key keeps
 * its words in the version's own `spinout_deck_overrides` row (D908,
 * `store.ts`). A card gives words to the key its title names. The first card
 * that matches wins, and appendix cards are skipped:
 *   Cover (else the first card), its subtitle → cover.thesis (the one-liner)
 *   Problem…                          → problem.framing
 *   Market…                           → market.assumptions
 *   Traction…                         → traction.takeaway
 *   Competition / Competitive…        → competitive.whitespace
 *   (The) ask / raise / round         → ask.title
 *   Closing / Contact / Thank you     → deal.closingLine
 * A card's words are its body, else its bullets (one per line), else its
 * first paragraph or quote field. A card whose title names no key gives
 * nothing, and no words are made up: an unmatched section stays empty.
 *
 * Read only. The deck is never written: starting from it changes no card.
 */
import type { Env } from '../../types';

/** Each deck key and the longest words it takes (the section limits of `store.ts`, One-liner's of New version). */
export const DECK_WORD_KEYS: ReadonlyArray<{ key: string; max: number; title: (t: string) => boolean }> = Object.freeze([
  { key: 'problem.framing', max: 600, title: (t: string) => t === 'problem' || t.startsWith('problem ') },
  { key: 'market.assumptions', max: 600, title: (t: string) => t.startsWith('market') },
  { key: 'traction.takeaway', max: 600, title: (t: string) => t.startsWith('traction') },
  { key: 'competitive.whitespace', max: 600, title: (t: string) => t.startsWith('compet') },
  { key: 'ask.title', max: 300, title: (t: string) => t === 'ask' || t.startsWith('ask ') || t === 'raise' || t === 'round' },
  { key: 'deal.closingLine', max: 600, title: (t: string) => t.startsWith('closing') || t === 'contact' || t === 'thank you' || t === 'thanks' },
]);
const COVER = { key: 'cover.thesis', max: 500 };

/** Lower case, punctuation to spaces, single spaces, no leading "the ". */
export function titleKey(title: unknown): string {
  return String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s);
const textOf = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A card's words: its body, else its bullets, else its first paragraph or quote field; null when it has none. */
export function cardWords(card: any): string | null {
  const body = textOf(card?.body);
  if (body) return body;
  const bullets = Array.isArray(card?.bullets) ? card.bullets.map(textOf).filter(Boolean) : [];
  if (bullets.length) return bullets.join('\n');
  const fields = Array.isArray(card?.fields) ? card.fields : [];
  const field = fields.find((f: any) => (f?.kind === 'paragraph' || f?.kind === 'quote') && textOf(f?.value));
  return field ? textOf(field.value) : null;
}

/** Deck key → words, from one deck version's slides. Keys with no matching card are absent. */
export function deckWords(slides: unknown): Map<string, string> {
  const cards = (Array.isArray(slides) ? slides : []).filter((s: any) => s && typeof s === 'object' && !s.appendix);
  const out = new Map<string, string>();
  const cover = cards.find((s: any) => titleKey(s.title) === 'cover') ?? cards[0];
  const thesis = textOf(cover?.subtitle);
  if (thesis) out.set(COVER.key, clip(thesis, COVER.max));
  for (const spec of DECK_WORD_KEYS) {
    const card = cards.find((s: any) => spec.title(titleKey(s.title)));
    const words = card ? cardWords(card) : null;
    if (words) out.set(spec.key, clip(words, spec.max));
  }
  return out;
}

/** The slides of this venture's pitch deck version N (its newest row), or null when the venture has no such version. */
export async function deckVersionSlides(env: Env, projectId: number, version: number): Promise<unknown[] | null> {
  const row = await env.DB.prepare(
    'SELECT slides FROM pitch_decks WHERE project_id = ? AND version = ? ORDER BY id DESC LIMIT 1',
  ).bind(projectId, version).first<{ slides: string | null }>();
  if (!row) return null;
  try { const s = JSON.parse(row.slides || '[]'); return Array.isArray(s) ? s : []; } catch { return []; }
}
