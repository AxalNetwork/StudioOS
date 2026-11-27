/**
 * D1588 (#3835, deck v2 F9) — the deck and raise tools Eadwyn and an MCP
 * client reach deck work through. Every one of them reads, or PROPOSES:
 *
 *   readOutline      the current deck version's cards and areas, each area
 *                    named by its block range on the 12 × 6 grid
 *   proposeArea      new words for one text area: one `ai_rail_proposals` row
 *                    on a `deck:*` option (DECK_ASK_OPTIONS), record
 *                    `deck:<id>`, the payload a card's Rewrite leaves, so the
 *                    deck's Ask lists it in "Waiting for you"
 *   proposeVariant   a variant of the whole deck (new words in several areas,
 *                    and or a new card order): one `pitch_deck_proposals` row,
 *                    the one DeckAsk offers with Keep and Discard. One already
 *                    waiting is never replaced: it is the founder's to decide
 *   prospectBrief    D1585's meeting brief, as it is (`services/prospectBrief.ts`)
 *   qaPrep           the questions an investor meeting is likely to raise, from
 *                    the objections the venture logged, theirs first, with the
 *                    founder's recorded answers. No model runs
 *   draftFollowUp    a follow-up email the caller wrote, kept as a draft in
 *                    Email (`mail_drafts`, D1341). Nothing is sent
 *
 * NOTHING HERE SAVES A CHANGE. No deck version, card, prospect or email is
 * written or sent: each write tool leaves a proposal or a draft, and the
 * founder's own press (Accept, Keep, Send) is the only way it lands.
 *
 * A TYPED FIGURE IS REFUSED (plan §4.3). Words that name a number (`numberIn`,
 * the rule the deck editor and the new-deck prompt use) are refused with
 * `figure_in_text`, because a deck's figures come from records, never from a
 * proposal. The follow-up draft is held to the same rule.
 *
 * WHO. Only the venture's own people: its founder and co-founder editors
 * (`canWritePitchDeck`). An admin or an advisor is refused here even where a
 * wider read would let them see the deck (D1191, D895).
 *
 * This module must not reach member bank data (D752's guard reads every MCP
 * tool's imports), so it imports neither `newDeck.ts`, `assist.ts` nor
 * `routes/decks.ts`, all of which reach the deck sources. The figure rule lives
 * in `numbers.ts`; the rail page is restated (`DECK_PAGE`) and a test holds it
 * equal to `assist.ts`'s `ASSIST_PAGE`.
 */
import type { Env, User } from '../../types';
import { GRID_COLS, GRID_ROWS, gridOf, sanitizeBlocks, type Grid } from './slideModel';
import { hydrateSlides } from './cardBlobs';
import { assignCardUids } from './cardUids';
import { numberIn } from './numbers';
import { proposeRail } from '../railProposals';
import { prospectBrief, type ProspectBrief } from '../prospectBrief';
import { readObjections } from '../narrative/objections';
import { canWritePitchDeck } from '../../routes/_founder_validate_helpers';

/** The rail page a card edit is filed under: `assist.ts`'s ASSIST_PAGE (a test holds them equal). */
export const DECK_PAGE = 'Founder · Raise · Pitch deck';

/** The card actions an area proposal may name; each is a `deck:<action>` option DeckAsk lists. */
export const AREA_ACTIONS = ['rewrite', 'shorten', 'expand', 'tone'] as const;
export type AreaAction = typeof AREA_ACTIONS[number];

export const TEXT_MAX = 4000;
export const VARIANT_EDITS_MAX = 20;
export const SUBJECT_MAX = 200;
export const BODY_MAX = 6000;
export const QA_MAX = 12;
/** What `area_text` shows of a text area in the outline; the whole text is the block's. */
export const OUTLINE_TEXT_MAX = 400;
export const QA_BASIS = 'Read from the objections you logged on Capital relationships and the answers you recorded. No model ran.';
/** Where the founder finds what a write tool left. */
export const WAITING_ON_DECK = 'Waiting for you, on the deck’s Ask in Pitch deck.';
export const WAITING_IN_EMAIL = 'A draft in Email, for you to edit and send. Nothing was sent.';

/** A refusal a tool answers with: an HTTP-like status, a stable code and the sentence. */
export class DeckToolError extends Error {
  status: number;
  code: string;
  sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(sentence); this.status = status; this.code = code; this.sentence = sentence;
  }
}

export const DECK_TOOL_WORDS = Object.freeze({
  not_owned: 'Only the venture’s founders use deck and raise tools.',
  no_deck: 'This venture has no deck yet. Make one in Pitch deck first.',
  deck_not_found: 'That deck is not one of this venture’s.',
  card_not_found: 'That card is not in this deck. Read the outline again.',
  area_invalid: `An area is a block range on the ${GRID_COLS} × ${GRID_ROWS} grid: 1 ≤ c1 ≤ c2 ≤ ${GRID_COLS} and 1 ≤ r1 ≤ r2 ≤ ${GRID_ROWS}.`,
  area_empty: 'That area holds no text. Name the block range of a text area from the outline.',
  area_ambiguous: 'That area holds more than one text block. Name one block’s range from the outline.',
  text_required: 'Write the words to propose.',
  text_too_long: `Proposed words are at most ${TEXT_MAX} characters.`,
  figure_in_text: 'Figures come from your records, never from a proposal. Take the figure out; the deck reads figures from their records.',
  no_change: 'Those are the words the area already holds.',
  proposal_waiting: 'A deck proposal is already waiting. Keep or discard it in Pitch deck first.',
  order_invalid: 'The order must name every card of the deck once.',
  nothing_proposed: 'Propose new words for an area, or a new order.',
  prospect_not_found: 'That investor is not one of this venture’s.',
  draft_required: 'Write a subject and a body.',
});
type Code = keyof typeof DECK_TOOL_WORDS;
const no = (status: number, code: Code): DeckToolError => new DeckToolError(status, code, DECK_TOOL_WORDS[code]);

const UID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const inside = (b: Grid, a: Grid) => b.c1 >= a.c1 && b.c2 <= a.c2 && b.r1 >= a.r1 && b.r2 <= a.r2;
/**
 * The URL guard `sanitizeBlocks` takes. Nothing here fetches, stores or answers
 * a URL (the outline names an area's kind and range, never its link), so an
 * image or video area is kept as an area rather than dropped for its link.
 */
const AS_IS = (u: string | null | undefined) => (typeof u === 'string' ? u : null);

type Venture = { id: number; founder_id: number | null };

/** The venture, when the caller is one of its own people; refused otherwise. */
export async function ownVenture(env: Env, user: User, projectId: number): Promise<Venture> {
  const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<Venture>();
  if (!p || !canWritePitchDeck(p, user)) throw no(403, 'not_owned');
  return p;
}

type DeckRow = { id: number; project_id: number; version: number | null; title: string | null; slides: string | null; card_hashes?: string | null };

/** The venture's current deck version, or the named one when it is this venture's. */
async function deckOf(env: Env, projectId: number, deckId?: number | null): Promise<DeckRow & { cards: any[] }> {
  const row = deckId != null
    ? await env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ? AND project_id = ?').bind(deckId, projectId).first<DeckRow>()
    : await env.DB.prepare('SELECT * FROM pitch_decks WHERE project_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1').bind(projectId).first<DeckRow>();
  if (!row) throw no(404, deckId != null ? 'deck_not_found' : 'no_deck');
  const full = await hydrateSlides(env, row);
  let cards: any[] = [];
  try { const v = JSON.parse(String(full.slides || '[]')); cards = Array.isArray(v) ? v : []; } catch { cards = []; }
  return { ...full, cards: assignCardUids(cards) };
}

/** A card named by its uid, or by its 1-based number. */
function cardAt(cards: any[], ref: unknown): number {
  const at = typeof ref === 'string' && UID_RE.test(ref) ? cards.findIndex((c) => c?.uid === ref)
    : Number.isInteger(ref) && (ref as number) >= 1 ? (ref as number) - 1 : -1;
  if (at < 0 || at >= cards.length) throw no(404, 'card_not_found');
  return at;
}

/** The card's blocks as the editor would keep them (`sanitizeBlocks`): overlapping or malformed ones dropped. */
const blocksOf = (card: any) => sanitizeBlocks(card?.blocks, AS_IS);

/** The one text block inside `area` on the card. */
function textBlockIn(card: any, rawArea: unknown): { block: any; area: Grid } {
  const area = gridOf(rawArea);
  if (!area) throw no(422, 'area_invalid');
  const hits = blocksOf(card).filter((b) => b.kind === 'text' && inside(b.grid, area));
  if (!hits.length) throw no(422, 'area_empty');
  if (hits.length > 1) throw no(422, 'area_ambiguous');
  return { block: hits[0], area };
}

/** The proposed words, trimmed; refused when empty, too long or naming a figure. */
export function proposedWords(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw no(422, 'text_required');
  if (text.length > TEXT_MAX) throw no(422, 'text_too_long');
  if (numberIn(text)) throw no(422, 'figure_in_text');
  return text;
}

/** One area edit, checked: the card, its one text block, the new words, and that they survive `sanitizeBlocks`. */
function areaEdit(cards: any[], e: { card: unknown; area: unknown; text: unknown }) {
  const at = cardAt(cards, e.card);
  const { block, area } = textBlockIn(cards[at], e.area);
  const after = proposedWords(e.text);
  const before = String(block.text ?? '');
  if (after === before) throw no(422, 'no_change');
  const kept = sanitizeBlocks([{ ...block, paras: undefined, text: after }], AS_IS)[0];
  if (!kept || kept.text !== after) throw no(422, 'text_too_long');
  return { at, card_uid: String(cards[at].uid), block_id: String(block.id), area, before, after };
}

// ─────────────────────────────────────────────────────────── decks.read_outline

/** The first heading's words on a card, else its section, else its old title. */
function cardTitle(card: any): string | null {
  const heading = blocksOf(card).find((b) => b.kind === 'text' && b.style === 'heading');
  const t = String(heading?.text ?? card?.section ?? card?.title ?? '').trim();
  return t ? t.slice(0, 160) : null;
}

export async function readOutline(env: Env, projectId: number, deckId?: number | null) {
  const d = await deckOf(env, projectId, deckId);
  const waiting = await env.DB.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals WHERE project_id = ?').bind(projectId).first<{ n: number }>()
    .catch(() => null);
  return {
    deck: { id: Number(d.id), version: d.version ?? null, title: d.title ?? null },
    grid: { cols: GRID_COLS, rows: GRID_ROWS },
    cards: d.cards.map((card, i) => ({
      card: i + 1,
      uid: card.uid,
      title: cardTitle(card),
      hidden: card?.hidden === true,
      areas: blocksOf(card).map((b) => ({
        block_id: b.id, kind: b.kind, grid: b.grid,
        ...(b.kind === 'text' ? { style: b.style ?? null, text: String(b.text ?? '').slice(0, OUTLINE_TEXT_MAX) } : {}),
        bound: !!b.binding,
      })),
    })),
    deck_proposal_waiting: waiting ? Number(waiting.n) > 0 : null,
  };
}

// ─────────────────────────────────────────────────────────── decks.propose_area

export async function proposeArea(env: Env, userId: number, projectId: number, a: {
  deck?: number | null; card: unknown; area: unknown; text: unknown; action?: AreaAction | null; tool?: string; model?: string | null;
}) {
  const d = await deckOf(env, projectId, a.deck);
  const action: AreaAction = a.action && (AREA_ACTIONS as readonly string[]).includes(a.action) ? a.action : 'rewrite';
  const e = areaEdit(d.cards, a);
  const row = await proposeRail(env, {
    userId, page: DECK_PAGE, option: `deck:${action}`, record: `deck:${Number(d.id)}`, kind: 'proposal',
    payload: {
      deck_id: Number(d.id), card: e.at, card_uid: e.card_uid, block_id: e.block_id, area: e.area,
      action, before: e.before, after: e.after, source: 'tool', tool: a.tool ?? 'decks.propose_area',
    },
    model: a.model ?? null,
  });
  return {
    proposal: {
      kind: 'card_edit', uid: row.uid, status: row.status, option: `deck:${action}`, deck_id: Number(d.id),
      card: e.at + 1, card_uid: e.card_uid, block_id: e.block_id, area: e.area, before: e.before, after: e.after,
    },
    saved: false,
    where: WAITING_ON_DECK,
  };
}

// ─────────────────────────────────────────────────────────── decks.propose_variant

export async function proposeVariant(env: Env, userId: number, projectId: number, a: {
  deck?: number | null; edits?: Array<{ card: unknown; area: unknown; text: unknown }> | null; order?: unknown[] | null; title?: string | null;
}) {
  const d = await deckOf(env, projectId, a.deck);
  const open = await env.DB.prepare('SELECT id FROM pitch_deck_proposals WHERE project_id = ? LIMIT 1').bind(projectId).first<{ id: number }>();
  if (open) throw no(409, 'proposal_waiting');
  const edits = (a.edits ?? []).slice(0, VARIANT_EDITS_MAX).map((e) => areaEdit(d.cards, e));
  let cards = d.cards.map((card, i) => {
    const mine = edits.filter((e) => e.at === i);
    if (!mine.length) return card;
    const byId = new Map(mine.map((e) => [e.block_id, e.after]));
    // `text` is the plain copy; rich runs of a replaced block are dropped so the new words are what shows.
    return { ...card, blocks: (card.blocks || []).map((b: any) => (byId.has(String(b?.id)) ? { ...b, paras: undefined, text: byId.get(String(b.id)) } : b)) };
  });
  let reordered = false;
  if (a.order != null) {
    const at = a.order.map((ref) => { try { return cardAt(d.cards, ref); } catch { return -1; } });
    if (at.length !== cards.length || at.some((i) => i < 0) || new Set(at).size !== at.length) throw no(422, 'order_invalid');
    reordered = at.some((i, k) => i !== k);
    cards = at.map((i) => cards[i]);
  }
  if (!edits.length && !reordered) throw no(422, 'nothing_proposed');
  const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim().slice(0, 120) : (d.title || 'Pitch deck');
  if (numberIn(title)) throw no(422, 'figure_in_text');
  const res = await env.DB.prepare(
    `INSERT INTO pitch_deck_proposals (project_id, base_deck_id, slides, title, method_id, created_by)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).bind(projectId, Number(d.id), JSON.stringify(cards), title, userId || null).run();
  return {
    proposal: {
      kind: 'deck_version', id: Number((res as any)?.meta?.last_row_id || 0), base_deck_id: Number(d.id), title,
      edits: edits.map((e) => ({ card: e.at + 1, card_uid: e.card_uid, block_id: e.block_id, before: e.before, after: e.after })),
      reordered, order: reordered ? cards.map((c) => c.uid) : null,
    },
    saved: false,
    where: WAITING_ON_DECK,
  };
}

// ─────────────────────────────────────────────────────────── raise.*

export async function readProspectBrief(env: Env, projectId: number, prospectId: number, eventId?: number | null): Promise<ProspectBrief> {
  const brief = await prospectBrief(env, projectId, prospectId, { eventId: eventId ?? null });
  if (!brief) throw no(404, 'prospect_not_found');
  return brief;
}

async function prospectOf(env: Env, projectId: number, prospectId: number): Promise<{ id: number; name: string | null }> {
  const p = await env.DB.prepare('SELECT id, name FROM raise_prospects WHERE id = ? AND project_id = ?').bind(prospectId, projectId).first<{ id: number; name: string | null }>();
  if (!p) throw no(404, 'prospect_not_found');
  return p;
}

/**
 * The questions to prepare for: every objection the venture logged, the ones
 * this investor raised first (by how often they said it), then the rest by how
 * many investors raised them, each with the founder's recorded answer or null.
 */
export async function qaPrep(env: Env, projectId: number, prospectId?: number | null) {
  if (prospectId != null) await prospectOf(env, projectId, prospectId);
  const read = await readObjections(env, projectId, prospectId ?? null);
  const items = [...read.items].sort((a, b) =>
    Number(b.of_prospect ?? 0) - Number(a.of_prospect ?? 0) || b.prospects - a.prospects || b.count - a.count || a.text.localeCompare(b.text));
  const questions = items.slice(0, QA_MAX).map((x) => ({
    question: x.text,
    raised_by_them: prospectId != null ? Number(x.of_prospect ?? 0) > 0 : null,
    times_raised: x.count,
    investors: x.prospects,
    answer: x.answer ?? null,
  }));
  return {
    questions,
    unanswered: questions.filter((q) => !q.answer).length,
    capped: read.capped || items.length > QA_MAX,
    answers: read.answers,
    basis: QA_BASIS,
  };
}

/** A follow-up the caller wrote, kept as the caller's draft in Email for that investor. Never sent. */
export async function draftFollowUp(env: Env, userId: number, projectId: number, a: { prospect: number; subject: unknown; body: unknown }) {
  const p = await prospectOf(env, projectId, a.prospect);
  const subject = typeof a.subject === 'string' ? a.subject.trim() : '';
  const body = typeof a.body === 'string' ? a.body.trim() : '';
  if (!subject || !body) throw no(422, 'draft_required');
  if (subject.length > SUBJECT_MAX || body.length > BODY_MAX) throw no(422, 'text_too_long');
  if (numberIn(subject) || numberIn(body)) throw no(422, 'figure_in_text');
  const uid = crypto.randomUUID();
  const length = body.length <= 600 ? 'short' : body.length <= 1800 ? 'medium' : 'long';
  await env.DB.prepare(
    `INSERT INTO mail_drafts (uid, user_id, person_ref, intent, tone, length, refs_json, blocks_json, subject, body)
     VALUES (?, ?, ?, 'follow_up', 'warm', ?, '[]', '[]', ?, ?)`,
  ).bind(uid, userId, `prospect:${p.id}`, length, subject, body).run();
  return {
    proposal: { kind: 'mail_draft', uid, person: `prospect:${p.id}`, investor: p.name ?? null, subject },
    saved: false,
    sent: false,
    where: WAITING_IN_EMAIL,
  };
}
