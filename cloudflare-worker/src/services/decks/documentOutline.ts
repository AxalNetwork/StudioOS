/**
 * D1563 (#3810, deck v2 D2) — a pasted, DOCX or PDF document as an outline of
 * New deck's catalogue cards (Start from › Import a document).
 *
 * The document's text comes from `deckExtract.ts` (`extractDeck`, the router's
 * metered conversion) or from a paste. This lives beside it, not in it:
 * `deckExtract.ts` is on the advisor's and the crons' import paths, and the
 * catalogue (`newDeck.ts`) reads the venture's sources, which the member
 * bank-data guard keeps off those paths (`mercury_member_privacy_d752`).
 *
 * Pure: no binding, no fetch, no model.
 */
import { CARD_CATALOGUE, MESSAGE_MAX, OUTLINE_MAX, TITLE_MAX, numberIn, standardOutline, type OutlineRow } from './newDeck';

/** The longest document text read, in characters (the reviewer's own cap, `deckExtract.ts`). */
export const DOCUMENT_TEXT_MAX = 40_000;


/**
 * D1563 (#3810, deck v2 D2): which card of New deck's catalogue a section of
 * a pasted, DOCX or PDF document reads as. Each phrase is matched as whole
 * words (never a pattern built from the text); a heading's match counts three
 * times a body's.
 */
export const CARD_KEYWORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  problem: ['problem', 'pain', 'pain point', 'challenge', 'broken', 'struggle', 'status quo', 'frustration'],
  why_now: ['why now', 'timing', 'tailwind', 'tailwinds', 'inflection', 'the moment'],
  solution: ['solution', 'introducing', 'we built', 'our approach', 'how it works', 'what we do'],
  traction: ['traction', 'growth', 'revenue', 'mrr', 'arr', 'customers', 'retention', 'waitlist', 'paying'],
  validation: ['validation', 'interviews', 'customer interviews', 'pilots', 'pilot', 'letters of intent', 'loi', 'lois', 'evidence'],
  product: ['product', 'features', 'demo', 'platform', 'screenshots', 'roadmap shipped', 'release'],
  market: ['market', 'tam', 'sam', 'som', 'market size', 'opportunity', 'go-to-market', 'go to market', 'gtm', 'distribution'],
  unit_economics: ['unit economics', 'business model', 'pricing', 'ltv', 'cac', 'margin', 'margins', 'burn', 'runway', 'churn', 'financials'],
  team: ['team', 'founders', 'founder', 'ceo', 'cto', 'advisors', 'who we are'],
  round: ['the round', 'raising', 'the ask', 'our ask', 'ask', 'seeking', 'valuation', 'safe', 'investment', 'fundraising'],
  use_of_funds: ['use of funds', 'use of proceeds', 'allocation', 'how we will spend', 'spend'],
  competition: ['competition', 'competitors', 'competitive', 'landscape', 'alternatives', 'moat', 'differentiation'],
  roadmap: ['roadmap', 'milestones', 'next steps', 'plan ahead', 'timeline'],
  cap_table: ['cap table', 'ownership', 'shareholders', 'equity'],
});

export type DocumentOutline = {
  rows: OutlineRow[];
  counts: { sections: number; matched: number; unmatched: number; padded: number; figures_left_out: number };
};

/** A document's sections: split at its headings, else at its blank lines; at most 200, each at most 4,000 characters. */
export function documentSections(markdown: string): string[] {
  const md = String(markdown || '').replace(/\r\n?/g, '\n').slice(0, DOCUMENT_TEXT_MAX).trim();
  if (!md) return [];
  const byHeading = /^#{1,6}\s/m.test(md) ? md.split(/\n(?=#{1,6}\s)/) : md.split(/\n\s*\n/);
  const parts = byHeading.map((x) => x.trim()).filter(Boolean);
  // A heading on a line of its own, then a blank line: one section with the paragraph that follows.
  const merged: string[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    const headingLike = (x: string) => !x.includes('\n') && x.length <= 80 && !/[.!?:;]$/.test(x);
    if (prev != null && headingLike(prev) && !headingLike(p)) merged[merged.length - 1] = `${prev}\n${p}`;
    else merged.push(p);
  }
  return merged.slice(0, 200).map((x) => x.slice(0, 4000));
}

/** The words of a text, lower-cased, one space apart and padded, so a phrase is found only as whole words. */
const wordsOf = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f&-]+/g, ' ').trim()} `;

function cardScore(heading: string, body: string, phrases: readonly string[]): number {
  const h = wordsOf(heading), b = wordsOf(body);
  let score = 0;
  for (const p of phrases) {
    const at = ` ${p} `;
    if (h.includes(at)) score += 3;
    if (b.includes(at)) score += p.includes(' ') ? 2 : 1;
  }
  return score;
}

/** A section: its heading (a markdown heading, or a short first line with no full stop) and its body. */
export function sectionOf(chunk: string): { heading: string; body: string; level: number } {
  const [first, ...rest] = chunk.split('\n');
  const h = /^(#{1,6})\s+(.*)$/.exec(first.trim());
  if (h) return { heading: h[2].replace(/[*_`]/g, '').trim(), body: rest.join('\n').trim(), level: h[1].length };
  const line = first.replace(/[*_`]/g, '').trim();
  if (line.length <= 80 && !/[.!?:;]$/.test(line)) return { heading: line, body: rest.join('\n').trim(), level: 2 };
  return { heading: '', body: chunk.trim(), level: 0 };
}

const clean = (s: string, max: number) => s.replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();

/** The section's first sentence that names no number, to steer its card's headline; null when there is none. */
export function messageOf(body: string): { message: string | null; skipped: number } {
  let skipped = 0;
  const sentences = body.replace(/^\s*[-*+]\s+/gm, '').split(/(?<=[.!?])\s+|\n+/).map((x) => clean(x, 1000)).filter((x) => x.length >= 12);
  for (const s of sentences.slice(0, 8)) {
    if (numberIn(s)) { skipped += 1; continue; }
    if (s.length > MESSAGE_MAX) {
      const cut = s.slice(0, MESSAGE_MAX);
      const at = cut.lastIndexOf(' ');
      return { message: `${(at > 40 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '')}…`, skipped };
    }
    return { message: s, skipped };
  }
  return { message: null, skipped };
}

/**
 * D1563 (#3810): a pasted, DOCX or PDF document as an outline of New deck's
 * catalogue cards. Each section reads as the card its words name most (each
 * card once); its heading becomes the card's title and its first sentence the
 * card's message, unless either names a number, when the catalogue's words
 * stand (figures come from the records, never from a document). The title
 * card comes first; the document's order is kept; a short document is padded
 * to the standard twelve, each card at its place in the standard order.
 *
 * Code only: no model reads the document here. Its words reach a model only
 * as the outline's rows in the build run, inside one untrusted block
 * (`newDeck.buildMessage`).
 */
export function outlineFromDocument(markdown: string): DocumentOutline {
  const chunks = documentSections(markdown);
  const spec = (card: string) => CARD_CATALOGUE.find((c) => c.card === card)!;
  const cards = Object.keys(CARD_KEYWORDS);
  const taken = new Map<string, OutlineRow>();
  const order: string[] = [];
  let figures = 0, unmatched = 0;
  let titleRow: OutlineRow | null = null;
  chunks.forEach((chunk, i) => {
    const sec = sectionOf(chunk);
    const ranked = cards.map((card) => ({ card, score: cardScore(sec.heading, sec.body, CARD_KEYWORDS[card]) }))
      .filter((r) => r.score > 0).sort((a, z) => z.score - a.score);
    const pick = ranked.find((r) => !taken.has(r.card));
    // The document's first heading names the venture or the deck: the title card, when it reads as no other.
    if (i === 0 && (sec.level === 1 || (!sec.body && !ranked.length))) {
      const m = messageOf(sec.body);
      figures += m.skipped;
      const named = numberIn(sec.heading) ? null : clean(sec.heading, TITLE_MAX);
      if (!named && sec.heading) figures += 1;
      titleRow = { card: 'title', title: named || spec('title').title, purpose: spec('title').purpose, ...(m.message ? { message: m.message } : {}) };
      return;
    }
    if (!pick) { if (!ranked.length) unmatched += 1; return; }
    const s = spec(pick.card);
    const named = sec.heading && !numberIn(sec.heading) ? clean(sec.heading, TITLE_MAX) : '';
    if (sec.heading && !named) figures += 1;
    const m = messageOf(sec.body);
    figures += m.skipped;
    taken.set(pick.card, { card: s.card, title: named || s.title, purpose: s.purpose, ...(m.message ? { message: m.message } : {}) });
    order.push(pick.card);
  });
  const matched = order.length + (titleRow ? 1 : 0);
  const rows: OutlineRow[] = [titleRow ?? standardOutline('standard')[0], ...order.map((c) => taken.get(c)!)];
  // Padding: each standard card the document did not name, before the first row that comes after it in the standard order.
  const standard = standardOutline('standard');
  const at = (card: string) => CARD_CATALOGUE.findIndex((c) => c.card === card);
  let padded = 0;
  for (const row of standard) {
    if (rows.some((r) => r.card === row.card)) continue;
    const next = rows.findIndex((r, i) => i > 0 && at(r.card) > at(row.card));
    rows.splice(next < 0 ? rows.length : next, 0, row);
    padded += 1;
  }
  return { rows: rows.slice(0, OUTLINE_MAX), counts: { sections: chunks.length, matched, unmatched, padded, figures_left_out: figures } };
}
