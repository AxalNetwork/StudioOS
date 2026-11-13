/**
 * D1561 (#3808, deck v2 C13) — the ⋯ menu's whole-deck actions: Reorder for
 * stage, Check wording, and the areas Replace all images draws.
 *
 *   reorderForStage   the deck's cards in the stage plan's order (D1522), pure.
 *                     A card the plan does not know moves with the known card
 *                     before it, so a founder's own card stays where they put
 *                     it relative to its neighbour; two cards of one kind keep
 *                     their order. Every card is kept, none is added.
 *   wording*          the charged "Check wording" pass of pd25: unsupported or
 *                     guarantee language, quoted from the card. A finding is
 *                     shown only when its quote is on that card word for word,
 *                     and it holds no number the card does not hold.
 *   replaceAreasOf    every image area of the deck, with its aspect and a
 *                     description that holds no figure. Replace all images
 *                     quotes and draws exactly these, under one hold.
 */
import { cardOfSlide } from '../narrative/arcs';
import { untrustedBlock, withUntrustedRule } from '../ai/untrusted';
import { areasOf, boxOfAt } from './structures';

// ─────────────────────────────────────────────────────────── reorder for stage

export type Reordered = { slides: unknown[]; moved: number; from: number[] };

/**
 * The cards in `order`'s sequence (catalogue keys, title first). Returns the
 * new list, the old index of each new place (`from`) and how many cards sit
 * at a new index. Pure.
 */
export function reorderForStage(slides: unknown[], order: readonly string[], kindOf: (s: any) => string | null = cardOfSlide): Reordered {
  const list = Array.isArray(slides) ? slides : [];
  const rank = new Map(order.map((k, i) => [k, i]));
  // Groups: each known card heads a group; an unknown card joins the group before it.
  // Unknown cards before any known card form a leading group that stays first.
  type Group = { rank: number; seq: number; members: number[] };
  const groups: Group[] = [];
  list.forEach((s, i) => {
    const k = kindOf(s);
    const r = k != null && rank.has(k) ? rank.get(k)! : null;
    if (r == null) {
      if (groups.length) groups[groups.length - 1].members.push(i);
      else groups.push({ rank: -1, seq: 0, members: [i] });
      return;
    }
    groups.push({ rank: r, seq: groups.length, members: [i] });
  });
  const sorted = [...groups].sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  const from = sorted.flatMap((g) => g.members);
  return { slides: from.map((i) => list[i]), moved: from.filter((old, at) => old !== at).length, from };
}

// ─────────────────────────────────────────────────────────── check wording

export const WORDING_OPTION = 'deck:wording';
export const WORDING_KINDS = ['unsupported', 'guarantee'] as const;
export type WordingKind = typeof WORDING_KINDS[number];
export const WORDING_LABEL: Record<WordingKind, string> = { unsupported: 'Unsupported', guarantee: 'Guarantee language' };
export const WORDING_MAX = 12;
const QUOTE_MAX = 200;
const WHY_MAX = 240;

export type WordingCard = { uid: string | null; index: number; title: string; text: string[] };
export type WordingFinding = { key: string; kind: WordingKind; label: string; card_uid: string | null; card_index: number; quote: string; message: string; action: 'Go to card' };

const textOf = (b: any): string[] => {
  const out: string[] = [];
  if (typeof b?.text === 'string') out.push(b.text);
  if (typeof b?.label === 'string') out.push(b.label);
  if (Array.isArray(b?.items)) for (const x of b.items) if (typeof x === 'string') out.push(x); else if (typeof x?.text === 'string') out.push(x.text);
  return out;
};

/** Every card's words as the wording pass reads them: the title, the v1 fields and every block's text. */
export function wordingCards(slides: unknown): WordingCard[] {
  const list = Array.isArray(slides) ? slides : [];
  return list.slice(0, 40).map((s: any, index) => {
    const parts = [s?.subtitle, s?.body, ...(Array.isArray(s?.bullets) ? s.bullets : [])].filter((x): x is string => typeof x === 'string');
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) parts.push(...textOf(b));
    return {
      uid: typeof s?.uid === 'string' ? s.uid : null,
      index,
      title: String(s?.title ?? '').trim().slice(0, 160),
      text: parts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).map((t) => t.slice(0, 1200)),
    };
  });
}

export const WORDING_SYSTEM = withUntrustedRule([
  'You check the wording of an investor pitch deck before it is sent.',
  'Name only two kinds of wording: "guarantee" (a promise of a result, a return or an outcome, such as "guaranteed", "risk-free", "will 10x", "certain to") and "unsupported" (a superlative or a claim stated as fact with nothing on the card behind it, such as "the only", "the best", "the leading", "everyone needs").',
  'Each finding quotes the words exactly as they appear on the card, names the card by its uid, and says in one sentence why an investor would question them.',
  'Do not judge the figures; they are checked elsewhere. Never write a number that is not in the quote.',
  'Return only JSON.',
].join(' '));

export function wordingMessage(cards: WordingCard[]): string {
  const data = cards.map((c) => ({ uid: c.uid ?? String(c.index), title: c.title, text: c.text }));
  return [
    `Cards:\n${untrustedBlock('deck_import', JSON.stringify(data))}`,
    `Return at most ${WORDING_MAX} findings: {"findings":[{"card":"<card uid>","kind":"guarantee|unsupported","quote":"<the exact words>","why":"..."}]}. Return {"findings":[]} when the wording is sound.`,
  ].join('\n');
}

const DIGITS = /\p{Nd}+(?:[.,]\p{Nd}+)*/gu;
const runs = (t: string) => (String(t).match(DIGITS) ?? []).map((r) => r.replace(/[^\p{Nd}]/gu, ''));
const norm = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The findings that may be shown: a known kind, a card of the deck, a quote on
 * that card word for word, a reason within the limit, and no number that is
 * not in the quote. Each that fails is counted, never shown.
 */
export function wordingFindings(raw: unknown, cards: WordingCard[]): { findings: WordingFinding[]; dropped: number } {
  const list = Array.isArray((raw as any)?.findings) ? (raw as any).findings : [];
  const findings: WordingFinding[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const f of list.slice(0, WORDING_MAX * 2)) {
    const kind = String(f?.kind ?? '') as WordingKind;
    const quote = typeof f?.quote === 'string' ? f.quote.replace(/\s+/g, ' ').trim() : '';
    const why = typeof f?.why === 'string' ? f.why.replace(/\s+/g, ' ').trim() : '';
    const card = cards.find((c) => (c.uid ?? String(c.index)) === String(f?.card ?? ''));
    if (!(WORDING_KINDS as readonly string[]).includes(kind) || !card || !quote || quote.length > QUOTE_MAX || !why || why.length > WHY_MAX) { dropped += 1; continue; }
    if (!norm([card.title, ...card.text].join('\n')).includes(norm(quote))) { dropped += 1; continue; }
    const held = new Set(runs(quote));
    if (runs(why).some((r) => !held.has(r))) { dropped += 1; continue; }
    const key = `${card.index}:${norm(quote)}`;
    if (seen.has(key)) { dropped += 1; continue; }
    if (findings.length >= WORDING_MAX) { dropped += 1; continue; }
    seen.add(key);
    findings.push({ key: `wording:${findings.length}`, kind, label: WORDING_LABEL[kind], card_uid: card.uid, card_index: card.index, quote, message: why, action: 'Go to card' });
  }
  findings.sort((a, b) => a.card_index - b.card_index);
  return { findings, dropped };
}

// ─────────────────────────────────────────────────────────── replace all images

export const REPLACE_MAX_AREAS = 24;
const IMAGE_ASPECTS: Array<{ id: '16:9' | '4:3' | '1:1' | '3:4'; r: number }> = [
  { id: '16:9', r: 16 / 9 }, { id: '4:3', r: 4 / 3 }, { id: '1:1', r: 1 }, { id: '3:4', r: 3 / 4 },
];

export type ReplaceArea = { card: number; card_uid: string | null; block: string; area: string | null; aspect: '16:9' | '4:3' | '1:1' | '3:4'; description: string };

/** Words a description may carry: no digits or currency signs, so no figure reaches an image prompt. */
const wordsOnly = (t: unknown) => String(t ?? '').replace(/[\p{Nd}%$€£¥]/gu, '').replace(/\s+/g, ' ').trim();

/**
 * Every image area of the deck, in card order: each `image` block on each
 * card, with the area of the card's grid it fills (`areasOf`), the aspect
 * nearest its box, and a description from its own alt text, else the card's
 * heading. Pure; at most `REPLACE_MAX_AREAS`.
 */
export function replaceAreasOf(slides: unknown, slideAspect: '16:9' | '4:3' = '16:9'): ReplaceArea[] {
  const out: ReplaceArea[] = [];
  (Array.isArray(slides) ? slides : []).forEach((s: any, card) => {
    const blocks = Array.isArray(s?.blocks) ? s.blocks : [];
    const { areas } = areasOf(s);
    const heading = wordsOnly(blocks.find((b: any) => b?.kind === 'text' && b.style === 'heading')?.text || s?.title || '');
    for (const b of blocks) {
      if (b?.kind !== 'image' || !b.grid || out.length >= REPLACE_MAX_AREAS) continue;
      const g = b.grid;
      const area = areas.find((x) => x.c1 <= g.c1 && x.c2 >= g.c2 && x.r1 <= g.r1 && x.r2 >= g.r2)?.id ?? null;
      const box = boxOfAt({ c1: g.c1, c2: g.c2, r1: g.r1, r2: g.r2 }, slideAspect);
      const ratio = box.h > 0 ? box.w / box.h : 16 / 9;
      const aspect = IMAGE_ASPECTS.reduce((best, x) => (Math.abs(Math.log(x.r / ratio)) < Math.abs(Math.log(best.r / ratio)) ? x : best)).id;
      const alt = wordsOnly(b.alt);
      const description = (alt || (heading ? `An illustration for: ${heading}` : 'An illustration for this card')).slice(0, 400);
      out.push({ card, card_uid: typeof s?.uid === 'string' ? s.uid : null, block: String(b.id ?? ''), area, aspect, description });
    }
  });
  return out;
}
