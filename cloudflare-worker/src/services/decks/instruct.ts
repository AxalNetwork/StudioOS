/**
 * D1521 (#3773, deck v2 A22) — the selection-scoped instruction contract: one
 * instruction (or one action) on up to six areas of a card, run as one batch
 * under one quote, one hold and one Idempotency-Key, answered as one proposal
 * per area that nothing places until Accept.
 *
 *   parseInstruct   the body: `selection: [{card_uid?, area_id, instruction?}]`
 *                   (≤ 6), a whole-selection `instruction` or `action`
 *                   (shorten, expand, rewrite, more_visual), `variants` 1–3 or
 *                   `mode: 'compare'`. An instruction that names a figure is
 *                   refused here, before anything is quoted or held.
 *   planInstruct    each selected area as the text steps it runs and their
 *                   price, on #3764's plan shapes (`PlannedArea`), so the
 *                   quote, admission, proposals, settling and Accept are the
 *                   areas routes' own
 *
 * SELECTION ONLY. A proposal is made for each selected area and for nothing
 * else; the deck row is never written. An area resolves to the saved card's
 * text block with that id; anything else (an empty area, a figure tile, a
 * chart, a picture) is refused on its own with its sentence.
 *
 * THE INSTRUCTION IS DATA. It reaches the model only inside `untrustedBlock()`
 * (`textMessage('ask')`), every text run passes the safety guard, and what
 * comes back is words: a wording that names a number the area's own text does
 * not is refused when the proposal settles (`wordingProblem`).
 *
 * COMPARE IS SEEDS. The final canvas removed Compare models (pd16, D1512), so
 * `mode: 'compare'` asks for three variants of the area's one model (owner
 * question O, S1's pick (a): the founder pays for every variant).
 */
import type { RunOptions } from '../aiRouter';
import { DENSITY_MAX, textCapacity, type TypeRole } from './designSystem';
import type { Grid } from './slideModel';
import { assignCardUids } from './cardUids';
import { GRID_PAGE, lockedOut, type Resolved } from './elementModels';
import { modelLabel, type PlanLine } from './genRuntime';
import { ASSIST_OPTIONS, INSTRUCTION_MAX, textMessage, type TextAction } from './assist';
import { numberIn } from './newDeck';
import { MAX_VARIANTS, TEMPERATURES, textSeed, type AreasPlan, type Gates, type PlanCtx, type PlannedArea, type Refusal } from './areas';

export const SELECTION_LIMIT = 6;
export const INSTRUCT_ACTIONS = ['shorten', 'expand', 'rewrite', 'more_visual'] as const;
export type InstructAction = (typeof INSTRUCT_ACTIONS)[number];
/** What the `action` column records: the founder's own words, or one of the actions. */
export type InstructKind = 'instruction' | InstructAction;
/** The sentence InstructionBox already draws for a figure (`instructionModel.js`), so the two never disagree. */
export const FIGURE_REFUSAL = 'Figures come from your records. Pick a recorded figure instead. Nothing was charged.';
/** More visual: the same words, laid out to be read at a glance. Our own words, still passed as data. */
export const MORE_VISUAL = 'Make this easier to take in at a glance: shorter lines, a short list where it reads as one, the key point first. Say nothing new.';

export type InstructEntry = { card: string | number; area_id: string; instruction: string | null };
export type InstructRequest = { selection: InstructEntry[]; instruction: string | null; action: InstructAction | null; variants: number };

const AREA_ID = /^[A-Za-z0-9:_.#-]{1,64}$/;
const CARD_UID = /^[A-Za-z0-9_-]{1,40}$/;
const cardKey = (v: unknown): string | number | null =>
  (typeof v === 'string' && CARD_UID.test(v) ? v : Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null);

/** Words, trimmed, or null; too long is refused by the caller. */
const wordsOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The body, or the sentence that refuses it. `names_figure` is the one
 * refusal the route answers with 422: the request is well formed, and nothing
 * was charged.
 */
export function parseInstruct(body: any): InstructRequest | Refusal {
  const compare = body?.mode === 'compare';
  const variants = compare ? MAX_VARIANTS : body?.variants == null ? 1 : Number(body.variants);
  if (!Number.isInteger(variants) || variants < 1 || variants > MAX_VARIANTS) return { refusal: 'invalid_variants', message: 'Ask for 1, 2 or 3 variants per area.' };
  const instruction = wordsOf(body?.instruction);
  const action = body?.action == null ? null : body.action;
  if (action != null && !(INSTRUCT_ACTIONS as readonly string[]).includes(action)) return { refusal: 'invalid_action', message: 'An instruction takes Shorten, Expand, Rewrite or More visual.' };
  if (instruction && action) return { refusal: 'one_change', message: 'Send words or an action, not both.' };
  const list = Array.isArray(body?.selection) ? body.selection : [];
  if (!list.length) return { refusal: 'no_selection', message: 'Select at least one area.' };
  if (list.length > SELECTION_LIMIT) return { refusal: 'too_many_areas', message: `An instruction acts on at most ${SELECTION_LIMIT} areas at once.` };
  const card = cardKey(body?.card);
  const selection: InstructEntry[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const own = e?.card_uid === undefined ? card : cardKey(e.card_uid);
    const id = typeof e?.area_id === 'string' ? e.area_id : '';
    if (!AREA_ID.test(id)) return { refusal: 'invalid_area', message: 'Each selected area needs its id.' };
    if (own == null) return { refusal: 'invalid_card', message: 'Name the card each area is on.' };
    const k = `${own}|${id}`;
    if (seen.has(k)) return { refusal: 'duplicate_area', message: 'An area is selected twice.' };
    seen.add(k);
    const own_words = wordsOf(e?.instruction);
    if (own_words && action) return { refusal: 'one_change', message: 'Send words or an action, not both.' };
    selection.push({ card: own, area_id: id, instruction: own_words });
  }
  if (new Set(selection.map((e) => String(e.card))).size > 1) return { refusal: 'one_card', message: 'An instruction acts on the areas of one card at a time.' };
  const all = [instruction, ...selection.map((e) => e.instruction)].filter((w): w is string => !!w);
  if (all.some((w) => w.length > INSTRUCTION_MAX)) return { refusal: 'instruction_too_long', message: `Keep the instruction to ${INSTRUCTION_MAX} characters.` };
  if (!action && selection.some((e) => !(e.instruction ?? instruction))) return { refusal: 'no_instruction', message: 'Tell Eadwyn what to change, or pick an action.' };
  // Before any quote: a figure in the founder's words is never a model's to write.
  if (all.some((w) => numberIn(w) != null)) return { refusal: 'names_figure', message: FIGURE_REFUSAL };
  return { selection, instruction, action, variants };
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A text block's element, for its model pick (the AIRail's, resolved on the server). */
export function elementOfBlock(b: any): 'title' | 'bullets' | 'body' {
  return b?.style === 'heading' ? 'title' : b?.style === 'list' ? 'bullets' : 'body';
}
const ROLE: Readonly<Record<'title' | 'bullets' | 'body', TypeRole>> = Object.freeze({ title: 'heading', bullets: 'list', body: 'paragraph' });

function gridOf(v: any): Grid | null {
  const g = { c1: Number(v?.c1), c2: Number(v?.c2), r1: Number(v?.r1), r2: Number(v?.r2) };
  return [g.c1, g.c2, g.r1, g.r2].every(Number.isInteger) ? g : null;
}

/** What one area's change is: the words it runs (null for an action), its kind, the text action, and the rail option it runs under. */
function changeOf(req: InstructRequest, e: InstructEntry): { words: string | null; kind: InstructKind; ask: TextAction; option: string } {
  const words = e.instruction ?? req.instruction;
  if (words) return { words, kind: 'instruction', ask: 'ask', option: ASSIST_OPTIONS.ask };
  const a = req.action!;
  if (a === 'more_visual') return { words: null, kind: a, ask: 'ask', option: ASSIST_OPTIONS.ask };
  return { words: null, kind: a, ask: a, option: ASSIST_OPTIONS[a] };
}

async function planOne(ctx: PlanCtx, req: InstructRequest, e: InstructEntry, uids: Array<Record<string, any>>): Promise<PlannedArea> {
  const index = typeof e.card === 'string' ? uids.findIndex((c) => c.uid === e.card) : Number(e.card);
  const card = index >= 0 ? uids[index] : undefined;
  const block = card ? (Array.isArray(card.blocks) ? card.blocks : []).find((b: any) => b?.id != null && String(b.id) === e.area_id) ?? null : null;
  const element = block?.kind === 'text' ? elementOfBlock(block) : 'body';
  const grid = gridOf(block?.grid) ?? { c1: 1, c2: 12, r1: 1, r2: 1 };
  const base = {
    key: e.area_id, card_uid: card?.uid ?? String(e.card), card_index: index, area_id: e.area_id, element, kind: 'text' as const, grid,
    model: null as string | null, model_label: null as string | null, variants: req.variants,
    gates: { image_check: false, plan: null, records: null } as Gates,
  };
  const refused = (code: string, message: string): PlannedArea => ({ ...base, refusal: { code, message }, lines: [], quote_lines: [], hold_microusd: 0, payload: {} });
  if (!card) return refused('card_not_found', 'This card is not on the saved version. Save the deck, then send.');
  if (!block) return refused('area_not_found', 'This area is not on the saved version of the card. Save the deck, then send.');
  const before = block.kind === 'text' ? String(block.text ?? '').trim() : '';
  if (block.kind !== 'text' || block.binding) return refused('not_text', 'An instruction changes words. This area holds a figure, a chart or a picture, which change from their own tools.');
  if (!before) return refused('no_text', 'This area has no words to change yet. Use Generate into areas to write them.');

  let r: Resolved;
  try { r = await ctx.modelFor(element, { card: index, area: e.area_id }); } catch (err: any) {
    if (err && typeof err.element === 'string') return refused('not_switched_on', String(err.message || 'This element is not switched on yet.'));
    return refused('picks_unreadable', 'Your model picks for this deck could not be read. Nothing was run.');
  }
  base.model = r.model;
  base.model_label = r.model ? modelLabel(r.model) : null;
  base.gates.plan = lockedOut(r) ? 'locked' : 'ok';
  if (lockedOut(r)) return refused('role_locked', "Set by Axal VC HQ for this deck's models, on a plan this account is not on. Nothing was run.");
  if (!r.model) return refused('no_model', 'No model can run this element on your plan. Nothing was run.');

  const change = changeOf(req, e);
  const role = ROLE[element];
  const limit = Math.max(8, Math.min(textCapacity(grid, role, ctx.aspect).chars, DENSITY_MAX[role]));
  const m = textMessage(change.ask, before, { voice: ctx.voice, instruction: change.kind === 'more_visual' ? MORE_VISUAL : change.words ?? undefined });
  const user = `${m.user}\n\nKeep it to at most ${limit} characters.`;
  const maxTokens = Math.min(800, Math.ceil(limit / 3) + 40);
  const content = (k: number) => (k ? `${user}\n\n(Variant ${k + 1}: a different wording from the others.)` : user);
  const rail = { page: GRID_PAGE, option: change.option };
  const q = await ctx.quote({ task: 'rail_write', userId: ctx.userId, model: r.model, rail, systemPrompt: m.system, messages: [{ role: 'user', content: content(MAX_VARIANTS - 1) }], maxTokens, temperature: TEMPERATURES[0] } as RunOptions);
  if (!q.ok) return refused(q.refusal, q.error);
  const lines: PlanLine[] = Array.from({ length: req.variants }, (_, k) => ({
    card_uid: card.uid, area_id: e.area_id, element, kind: 'text', task: 'rail_write', model: r.model, quote_microusd: q.hold_microusd,
    input: { systemPrompt: m.system, messages: [{ role: 'user', content: content(k) }], maxTokens, temperature: TEMPERATURES[k], option: change.option, variant: k, seed: textSeed(ctx.deckId, card.uid, e.area_id, k) },
  }));
  const sha = await sha256Hex(change.words ?? change.kind);
  return {
    ...base, refusal: null, lines, hold_microusd: q.hold_microusd * req.variants,
    quote_lines: [
      { label: `${req.variants} variant${req.variants === 1 ? '' : 's'} · ${base.model_label}`, count: req.variants, per_microusd: q.hold_microusd, microusd: q.hold_microusd * req.variants },
      { label: 'Safety check on every text run', count: req.variants, per_microusd: null, microusd: 0, included: true },
    ],
    // `action` is the text action the settled wording is checked against (`wordingProblem`): an instruction is a rewrite.
    payload: { kind: 'text', role, limit, grid, action: change.ask === 'ask' ? 'rewrite' : change.ask, before, source: before, replaces_block: String(block.id), instruct: change.kind, instruction_sha256: sha },
  };
}

/** Every selected area as its steps and price. An area that cannot run is refused on its own; the others still run. Never more than the selection. */
export async function planInstruct(ctx: PlanCtx, req: InstructRequest): Promise<AreasPlan> {
  const uids = assignCardUids(Array.isArray(ctx.cards) ? ctx.cards : []);
  const areas: PlannedArea[] = [];
  for (const e of req.selection) areas.push(await planOne(ctx, req, e, uids));
  const lines = areas.flatMap((a) => a.lines);
  return { cls: 'areas', areas, lines, hold_microusd: areas.reduce((n, a) => n + a.hold_microusd, 0) };
}

/** What every proposal of the run records: the selection as resolved, so a reader sees what the instruction was scoped to. */
export const selectionJson = (plan: AreasPlan) => JSON.stringify(plan.areas.map((a) => ({ card_uid: a.card_uid, area_id: a.area_id })));
