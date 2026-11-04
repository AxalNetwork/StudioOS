/**
 * D1558 (#3805, deck v2 C10) — the narrative coach and the "deck ready to
 * send" readiness item. Pure: the route (`routes/cycle_raise.ts`) reads the
 * narrative version and the venture's current deck; this file says what is
 * ready, what the coach is asked and what of its answer is kept.
 *
 * READY TO SEND. Computed from the current deck's cards, free, no model. A
 * row names one area of one card that still blocks sending: a card with no
 * title, an empty text area, placeholder text, an image area with no image,
 * or a figure no record backs (an unbound text area or metric tile that
 * states an amount or a percentage). Every row links into the editor at its
 * card (by uid, else its place) and its Grid area (a c–r range): the editor
 * opens that card and selects that area.
 *
 * THE COACH. One metered run under `review:narrative-coach`. It reads the
 * version's sections and the deck's cards with every figure masked, and
 * answers findings, each with a proposal: never a conversation. A finding is
 * kept only when its section is one of the narrative's, its card (when it
 * names one) is on the deck and its area on that card, and neither its
 * message nor its proposal holds a figure, a link or a promise of a return.
 * Anything else is counted in `dropped` with its reason. Nothing is written.
 */
import { maskFigures, SECTION_PAGE } from './sectionDraft';
import { NARRATIVE_SECTIONS } from './store';
import { withoutGuarantees } from '../decks/compliance';
import { unrecordedLinks, untrustedBlock, withUntrustedRule } from '../ai/untrusted';

export const COACH_PAGE = SECTION_PAGE;
export const COACH_OPTION = 'review:narrative-coach';
export const EDITOR_PATH = '/raise/pitch/edit';
export const COACH_KINDS = ['missing', 'unclear', 'contradicts', 'order'] as const;
export type CoachKind = typeof COACH_KINDS[number];
export const FINDINGS_MAX = 12;
export const ROWS_MAX = 50;

export type Grid = { c1: number; c2: number; r1: number; r2: number };
export type Area = Grid & { id: string };

const validGrid = (g: any): g is Grid => !!g && [g.c1, g.c2, g.r1, g.r2].every(Number.isInteger) && g.c2 >= g.c1 && g.r2 >= g.r1;

/** A Grid area in the editor's link: `c3-7r2-4`. */
export const areaParam = (g: Grid) => `c${g.c1}-${g.c2}r${g.r1}-${g.r2}`;

/** The editor at one card (its uid, else its place from 1) and, when given, one of its areas. */
export function editorHref(projectId: number, card: { uid: string | null; index: number }, area: Grid | null): string {
  const q = new URLSearchParams({ project_id: String(projectId), card: card.uid || String(card.index + 1) });
  if (area) q.set('area', areaParam(area));
  return `${EDITOR_PATH}?${q.toString()}`;
}

// ─────────────────────────────────────────────────────────── ready to send

export const READY_KINDS = ['untitled', 'empty_area', 'placeholder', 'image_missing', 'figure_unsourced'] as const;
export type ReadyKind = typeof READY_KINDS[number];
export type ReadyRow = {
  key: string; kind: ReadyKind; label: string;
  card_uid: string | null; card_index: number; card_title: string; area: Area | null; href: string;
};

const PLACEHOLDER = /\[[^\]\n]{1,60}\]|lorem ipsum|\bTODO\b|\bTBD\b|\bXXX+\b/i;
/** An amount or a percentage: what a reader takes as a claim. A bare count ("two founders", "3 regions") is not. */
const CLAIMED_FIGURE = /[$£€]\s?\d|\d[\d,.]*\s?(?:%|percent\b|[kKmMbB]\b|bn\b|million\b|billion\b|thousand\b)/;

const cardTitle = (s: any, i: number) => (typeof s?.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 120) : `Card ${i + 1}`);

/** What still blocks sending the deck, area by area. */
export function deckReadyRows(slides: unknown, projectId: number): ReadyRow[] {
  const list = Array.isArray(slides) ? slides : [];
  const rows: ReadyRow[] = [];
  list.forEach((s: any, index) => {
    const uid = typeof s?.uid === 'string' && s.uid ? s.uid : null;
    const title = cardTitle(s, index);
    const n = index + 1;
    const blocks = (Array.isArray(s?.blocks) ? s.blocks : []).filter((b: any) => b && typeof b === 'object' && validGrid(b.grid));
    const push = (kind: ReadyKind, label: string, b: any | null) => {
      const area: Area | null = b ? { id: String(b.id ?? ''), c1: b.grid.c1, c2: b.grid.c2, r1: b.grid.r1, r2: b.grid.r2 } : null;
      rows.push({ key: `${kind}:${uid ?? index}:${area?.id ?? ''}`, kind, label, card_uid: uid, card_index: index, card_title: title, area, href: editorHref(projectId, { uid, index }, area) });
    };
    if (!(typeof s?.title === 'string' && s.title.trim())) {
      const heading = blocks.find((b: any) => b.kind === 'text' && b.style === 'heading') ?? null;
      push('untitled', `Card ${n} has no title.`, heading);
    }
    for (const b of blocks) {
      if (b.kind === 'text') {
        const text = typeof b.text === 'string' ? b.text.trim() : '';
        if (!text) push('empty_area', `Card ${n} · ${title}: an area is empty.`, b);
        else if (PLACEHOLDER.test(text)) push('placeholder', `Card ${n} · ${title}: an area still holds placeholder text.`, b);
        else if (!b.binding && CLAIMED_FIGURE.test(text)) push('figure_unsourced', `Card ${n} · ${title}: a figure has no source. Link it to a record.`, b);
      } else if (b.kind === 'image') {
        if (!(typeof b.image_url === 'string' && b.image_url)) push('image_missing', `Card ${n} · ${title}: an image area has no image.`, b);
      } else if (b.kind === 'metric') {
        const value = b.value == null ? '' : String(b.value).trim();
        if (value && !b.binding) push('figure_unsourced', `Card ${n} · ${title}: a figure has no source. Link it to a record.`, b);
      }
    }
  });
  return rows.slice(0, ROWS_MAX);
}

/** The item: no deck, ready, or the rows that block it. */
export function deckReady(deck: { id: number; version: number; slides: unknown } | null, projectId: number) {
  if (!deck) return { state: 'no_deck' as const, deck_id: null, version: null, rows: [] as ReadyRow[], label: 'There is no deck yet. Build one first.' };
  const rows = deckReadyRows(deck.slides, projectId);
  return {
    state: rows.length ? 'not_ready' as const : 'ready' as const,
    deck_id: deck.id, version: deck.version, rows,
    label: rows.length ? `Deck ready to send · ${rows.length} to fix` : 'Deck ready to send',
  };
}

// ─────────────────────────────────────────────────────────── the coach

export type CoachCard = { key: string; n: number; uid: string | null; index: number; title: string; areas: Array<Area & { kind: string; text: string }> };

/** The deck's cards as the coach reads them: titles and each area's words, every figure masked. */
export function coachCards(slides: unknown): CoachCard[] {
  return (Array.isArray(slides) ? slides : []).slice(0, 40).map((s: any, index) => {
    const uid = typeof s?.uid === 'string' && s.uid ? s.uid : null;
    const areas = (Array.isArray(s?.blocks) ? s.blocks : [])
      .filter((b: any) => b && typeof b === 'object' && validGrid(b.grid) && b.id != null)
      .map((b: any) => ({
        id: String(b.id), c1: b.grid.c1, c2: b.grid.c2, r1: b.grid.r1, r2: b.grid.r2, kind: String(b.kind ?? ''),
        text: b.kind === 'text' && typeof b.text === 'string' ? maskFigures(b.text).slice(0, 600) : b.kind === 'metric' ? maskFigures(String(b.label ?? '')) : '',
      }));
    return { key: uid ?? String(index + 1), n: index + 1, uid, index, title: maskFigures(cardTitle(s, index)), areas };
  });
}

export const COACH_SYSTEM = withUntrustedRule([
  'You are Eadwyn, coaching a founder on how their pitch deck tells their investor narrative.',
  'You return findings, each with one concrete proposal in plain words. You never chat, ask questions or give investment advice.',
  'Never write a number, an amount, a percentage, a date or a count. Never add a link. Never promise a return. Return only JSON.',
].join(' '));

/** What the coach is asked: the sections and the cards as data, every figure masked. */
export function coachPrompt(sections: Array<{ key: string; label: string; body: string | null }>, cards: CoachCard[]): string {
  const data = {
    sections: sections.map((s) => ({ key: s.key, label: s.label, words: maskFigures(s.body ?? '').slice(0, 1200) })),
    cards: cards.map((c) => ({ card: c.key, title: c.title, areas: c.areas.map((a) => ({ area: a.id, kind: a.kind, words: a.text })) })),
  };
  return [
    'Compare the narrative with the deck. For each place the deck does not tell the narrative well, write one finding:',
    `{"findings":[{"section":"<section key>","card":"<card key or null>","area":"<area id or null>","kind":"${COACH_KINDS.join('|')}","message":"...","proposal":"..."}]}`,
    'missing: the narrative says it and no card does (card null). unclear: a card says it weakly. contradicts: a card says something else. order: the card is out of the narrative\'s order.',
    `At most ${FINDINGS_MAX} findings, the most important first.`,
    '',
    untrustedBlock('record_text', JSON.stringify(data)),
  ].join('\n');
}

export type Finding = {
  key: string; section: string; section_label: string; kind: CoachKind; message: string; proposal: string | null;
  card_uid: string | null; card_index: number | null; card_title: string | null; area: Area | null; href: string | null;
};
export type Dropped = { section: string | null; card: string | null; reason: string };

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const HAS_FIGURE = /[0-9]|\[figure\]/i;

/** What of the coach's answer is kept, finding by finding, and what was dropped and why. */
export function coachFindings(raw: unknown, cards: CoachCard[], projectId: number): { findings: Finding[]; dropped: Dropped[] } {
  const answers = Array.isArray((raw as any)?.findings) ? (raw as any).findings : [];
  const findings: Finding[] = [];
  const dropped: Dropped[] = [];
  const sections = new Map(NARRATIVE_SECTIONS.map((s) => [s.key, s.label]));
  for (const a of answers.slice(0, FINDINGS_MAX * 2)) {
    const section = typeof a?.section === 'string' ? a.section : '';
    const cardKey = a?.card == null || a.card === '' || a.card === 'null' ? null : String(a.card);
    const ref = { section: section || null, card: cardKey };
    if (!sections.has(section)) { dropped.push({ ...ref, reason: 'unknown_section' }); continue; }
    const kind = (COACH_KINDS as readonly string[]).includes(a?.kind) ? a.kind as CoachKind : null;
    if (!kind) { dropped.push({ ...ref, reason: 'unknown_kind' }); continue; }
    const card = cardKey == null ? null : cards.find((c) => c.key === cardKey) ?? null;
    if (cardKey != null && !card) { dropped.push({ ...ref, reason: 'card_not_on_deck' }); continue; }
    if (kind !== 'missing' && !card) { dropped.push({ ...ref, reason: 'no_card' }); continue; }
    const areaId = a?.area == null || a.area === '' || a.area === 'null' ? null : String(a.area);
    const area = areaId == null || !card ? null : card.areas.find((x) => x.id === areaId) ?? null;
    if (areaId != null && card && !area) { dropped.push({ ...ref, reason: 'area_not_on_card' }); continue; }
    const message = withoutGuarantees(clip(a?.message, 400)).text;
    const proposal = withoutGuarantees(clip(a?.proposal, 600)).text;
    if (!message) { dropped.push({ ...ref, reason: 'empty' }); continue; }
    if (HAS_FIGURE.test(message) || HAS_FIGURE.test(proposal)) { dropped.push({ ...ref, reason: 'figure' }); continue; }
    if (unrecordedLinks(`${message} ${proposal}`, []).length) { dropped.push({ ...ref, reason: 'link_added' }); continue; }
    const grid: Area | null = area ? { id: area.id, c1: area.c1, c2: area.c2, r1: area.r1, r2: area.r2 } : null;
    findings.push({
      key: `${section}:${kind}:${card?.key ?? '-'}:${grid?.id ?? '-'}`,
      section, section_label: sections.get(section)!, kind, message, proposal: proposal || null,
      card_uid: card?.uid ?? null, card_index: card ? card.index : null, card_title: card ? card.title : null, area: grid,
      href: card ? editorHref(projectId, { uid: card.uid, index: card.index }, grid) : null,
    });
    if (findings.length >= FINDINGS_MAX) break;
  }
  return { findings, dropped };
}
