/**
 * D1512 (#3764, deck v2 A3) — Generate into areas: one quote, one hold, 1 to 3
 * variants per area, as proposals that nothing places until Accept.
 *
 *   planAreas        each selected area as the steps it runs and their price:
 *                    its element's kind (text, chart, image, records), its
 *                    model (the AIRail's, resolved on the server per element,
 *                    D1503 — the client never sends a model), its gates, and
 *                    its quote lines (pd14)
 *   quoteView        the quote the lightbox draws: per-area lines that sum to
 *                    the area's hold, each row's gates, the total hold and when
 *                    the quote expires (10 minutes)
 *   variantsOf       what an area's finished steps proposed, one variant each,
 *                    labelled by model, seed, cost and seconds, with its own
 *                    error and the free code critique (Fits, Contrast AA,
 *                    Density OK)
 *   expireAreaProposals  A15's daily cleanup: a proposal nobody decided expires
 *
 * VARIANTS ARE SEEDS OF ONE MODEL. Compare mode is gone (the final canvas
 * removed pd16): `variants: n` asks for n seeds of the element's one model.
 * A text variant records its seed and runs at its own temperature; an image
 * variant draws at its own seed pair (`pipelineStep`'s `variant`).
 *
 * WORDS, NEVER FIGURES. A text variant is words: one that names a number the
 * card's own text does not is refused (`wordingProblem`), so a model never
 * writes a figure. Charts take only which recorded series to show, and code
 * builds the block from the records (`chartBlock`). Venture records (team,
 * round terms, use of funds …) run no model at all (`ventureElement`, D1543)
 * and keep their gates. What is not recorded is null with its reason, never 0.
 *
 * ONE HOLD. Every step of every area runs under the run's one parent hold
 * (`admitDeckRun`, D1502): quote = hold = sum of the lines ≥ what settles.
 */
import type { Env } from '../../types';
import type { RunOptions, RunQuote } from '../aiRouter';
import { DENSITY_MAX, boxOf, fitText, textCapacity, type TypeRole } from './designSystem';
import { GRID_COLS, GRID_ROWS, type Grid } from './slideModel';
import { assignCardUids } from './cardUids';
import { GRID_PAGE, lockedOut, type Resolved } from './elementModels';
import { modelLabel, type PlanLine, type RunClass, type StepRow } from './genRuntime';
import { ASSIST_OPTIONS, chartBlock, chartMessage, chartable, textMessage, wordingOf, wordingProblem, type ChartAction } from './assist';
import { parseJsonLoose } from './autofill';
import { isVentureElement, type ElementAnswer, type VentureElement } from './ventureElements';
import { promptOf, type ImageAsk } from './images';
import { pipelineQuote, seedOf, sizeFor } from './pipelines';
import type { DeckArt } from './imageDraw';
import type { SourceItem } from './sources';
import { untrustedBlock, withUntrustedRule } from '../ai/untrusted';
import { voicePreamble } from './prompts/voice';

/** A deck's own aspect (D1554): what a text area's capacity is measured at. */
export type DeckAspect = '16:9' | '4:3';

/** At most this many areas in one run: the lightbox's six, or a whole-deck build (D1502's `deck_build` class). */
export const AREA_LIMIT: Readonly<Record<RunClass, number>> = Object.freeze({ areas: 6, deck_build: 60 });
export const MAX_VARIANTS = 3;
export const QUOTE_TTL_MS = 10 * 60_000;
/** A proposal nobody decided expires with the image proposals it may hold (D1508's 14 days). */
export const PROPOSAL_DAYS = 14;

export const TEXT_ROLE: Readonly<Record<string, TypeRole>> = Object.freeze({
  title: 'heading', kicker: 'kicker', body: 'paragraph', bullets: 'list', callout: 'subheading', caption: 'caption',
});
const TEXT_LABEL: Readonly<Record<string, string>> = Object.freeze({
  title: 'title', kicker: 'kicker', body: 'paragraph', bullets: 'list of short points', callout: 'callout', caption: 'caption',
});
export const CHART_ACTION: Readonly<Record<string, ChartAction>> = Object.freeze({ chart: 'chart', table: 'table', timeline: 'timeline' });
export const IMAGE_STYLE: Readonly<Record<string, 'scene' | 'flat'>> = Object.freeze({ photo: 'scene', illustration: 'flat' });
/** Each variant's temperature: one model, three seeds, three wordings. */
const TEMPERATURES = [0.4, 0.7, 0.9] as const;

export type AreaKind = 'text' | 'chart' | 'image' | 'records';
export function kindOf(element: string): AreaKind | null {
  if (TEXT_ROLE[element]) return 'text';
  if (CHART_ACTION[element]) return 'chart';
  if (IMAGE_STYLE[element]) return 'image';
  if (isVentureElement(element)) return 'records';
  return null;
}

// ---- the request ------------------------------------------------------------

/** The text changes a batch takes for an area that has words (the lightbox's Rewrite, Shorten, Expand). */
export const AREA_TEXT_ACTIONS = ['rewrite', 'shorten', 'expand'] as const;
export type AreaTextAction = (typeof AREA_TEXT_ACTIONS)[number];
export type AreaAsk = { id: string; grid: Grid; element: string; card: string | number | null; action: AreaTextAction };
export type AreasRequest = { card: string | number | null; areas: AreaAsk[]; variants: number; cls: RunClass };
export type Refusal = { refusal: string; message: string };

const AREA_ID = /^[A-Za-z0-9:_.#-]{1,64}$/;
const CARD_UID = /^[A-Za-z0-9_-]{1,40}$/;
const cardKey = (v: unknown): string | number | null =>
  (typeof v === 'string' && CARD_UID.test(v) ? v : Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null);

function gridOf(v: any): Grid | null {
  const g = { c1: Number(v?.c1), c2: Number(v?.c2), r1: Number(v?.r1), r2: Number(v?.r2) };
  if (![g.c1, g.c2, g.r1, g.r2].every(Number.isInteger)) return null;
  return g.c1 >= 1 && g.c1 <= g.c2 && g.c2 <= GRID_COLS && g.r1 >= 1 && g.r1 <= g.r2 && g.r2 <= GRID_ROWS ? g : null;
}

/** The body's areas and variants, or the sentence that refuses it. No model id is read: the server resolves it. */
export function parseRequest(body: any): AreasRequest | Refusal {
  const cls: RunClass = body?.class === 'deck_build' ? 'deck_build' : 'areas';
  const variants = body?.variants == null ? 1 : Number(body.variants);
  if (!Number.isInteger(variants) || variants < 1 || variants > MAX_VARIANTS) return { refusal: 'invalid_variants', message: 'Ask for 1, 2 or 3 variants per area.' };
  const list = Array.isArray(body?.areas) ? body.areas : [];
  if (!list.length) return { refusal: 'no_areas', message: 'Select at least one area.' };
  if (list.length > AREA_LIMIT[cls]) return { refusal: 'too_many_areas', message: `Generate into at most ${AREA_LIMIT[cls]} areas at once.` };
  const card = cardKey(body?.card);
  const areas: AreaAsk[] = [];
  const seen = new Set<string>();
  for (const a of list) {
    const grid = gridOf(a?.grid);
    const id = typeof a?.id === 'string' ? a.id : '';
    const element = typeof a?.element === 'string' ? a.element : '';
    const own = a?.card === undefined ? card : cardKey(a.card);
    if (!AREA_ID.test(id) || !grid || !element) return { refusal: 'invalid_area', message: 'Each area needs its id, its grid range and an element.' };
    if (own == null) return { refusal: 'invalid_card', message: 'Name the card each area is on.' };
    const k = `${own}|${id}`;
    if (seen.has(k)) return { refusal: 'duplicate_area', message: 'An area is selected twice.' };
    seen.add(k);
    const action = a?.action == null ? 'rewrite' : a.action;
    if (!(AREA_TEXT_ACTIONS as readonly string[]).includes(action)) return { refusal: 'invalid_action', message: 'A text area takes Rewrite, Shorten or Expand.' };
    areas.push({ id, grid, element, card: own, action });
  }
  if (cls === 'areas' && new Set(areas.map((a) => String(a.card))).size > 1) return { refusal: 'one_card', message: 'Generate into the areas of one card at a time, or run the whole-deck build.' };
  return { card, areas, variants, cls };
}

// ---- the plan ---------------------------------------------------------------

export type PlanCtx = {
  userId: number; projectId: number; deckId: number;
  /** The deck version's cards as saved. */
  cards: any[];
  aspect: DeckAspect;
  voice?: unknown;
  quote: (o: RunOptions) => Promise<RunQuote>;
  modelFor: (element: string, area: { card: number; area: string }) => Promise<Resolved>;
  venture: (element: VentureElement) => Promise<ElementAnswer>;
  sources: () => Promise<SourceItem[]>;
  art: () => Promise<DeckArt>;
};

export type QuoteLine = { label: string; count: number; per_microusd: number | null; microusd: number; free?: true; included?: true };
export type Gates = { image_check: boolean; plan: 'ok' | 'locked' | null; records: string | null };
export type PlannedArea = {
  key: string; card_uid: string; card_index: number; area_id: string; element: string; kind: AreaKind | null; grid: Grid;
  model: string | null; model_label: string | null; variants: number; gates: Gates;
  refusal: { code: string; message: string } | null;
  lines: PlanLine[]; quote_lines: QuoteLine[]; hold_microusd: number;
  /** What the proposal keeps to read its variants: the block it replaces, the words it starts from, the records it shows. */
  payload: Record<string, unknown>;
};
export type AreasPlan = { cls: RunClass; areas: PlannedArea[]; lines: PlanLine[]; hold_microusd: number };

const textOfBlock = (b: any) => (b?.kind === 'text' ? String(b.text ?? '') : '');
const sameGrid = (a: any, g: Grid) => a && ['c1', 'c2', 'r1', 'r2'].every((k) => Number(a[k]) === (g as any)[k]);
/** The card's own words, which a text variant may draw on and never go beyond. */
const narrativeOf = (card: any) => [String(card?.title ?? ''), ...(Array.isArray(card?.blocks) ? card.blocks.map(textOfBlock) : []), String(card?.notes ?? '')]
  .map((s) => s.trim()).filter(Boolean).join('\n').slice(0, 4000);

/** The image aspect nearest the area's box. */
export function aspectOfGrid(g: Grid): ImageAsk['aspect'] {
  const b = boxOf(g);
  const r = b.w / Math.max(1, b.h);
  const options: Array<[ImageAsk['aspect'], number]> = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4]];
  return options.reduce((best, o) => (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r)) ? o : best))[0];
}

/** A variant's recorded seed: one model, n distinct seeds, the same for the same area every time. */
export const textSeed = (deckId: number, cardUid: string, areaId: string, k: number) => seedOf(String(deckId), cardUid, areaId, k);

function refused(base: Omit<PlannedArea, 'refusal' | 'lines' | 'quote_lines' | 'hold_microusd' | 'payload'>, code: string, message: string): PlannedArea {
  return { ...base, refusal: { code, message }, lines: [], quote_lines: [], hold_microusd: 0, payload: {} };
}

async function planOne(ctx: PlanCtx, ask: AreaAsk, variants: number, uids: Array<Record<string, any>>): Promise<PlannedArea> {
  const index = typeof ask.card === 'string' ? uids.findIndex((c) => c.uid === ask.card) : Number(ask.card);
  const card = index >= 0 ? uids[index] : undefined;
  const kind = kindOf(ask.element);
  const base = {
    key: ask.id, card_uid: card?.uid ?? String(ask.card), card_index: index, area_id: ask.id, element: ask.element, kind, grid: ask.grid,
    model: null as string | null, model_label: null as string | null, variants: kind === 'records' ? 1 : variants,
    gates: { image_check: kind === 'image', plan: null, records: null } as Gates,
  };
  if (!card) return refused(base, 'card_not_found', 'This card is not on the saved version. Save the deck, then generate.');
  if (!kind) return refused(base, 'element_not_generated', 'This element is placed from its own dialog, not generated into an area.');
  const block = (Array.isArray(card.blocks) ? card.blocks : []).find((b: any) => sameGrid(b?.grid, ask.grid)) ?? null;
  const replaces = block?.id != null ? String(block.id) : null;

  if (kind === 'records') {
    const ans = await ctx.venture(ask.element as VentureElement);
    if (!ans.available) {
      base.gates.records = ans.code;
      return refused(base, ans.code, ans.line);
    }
    base.gates.records = 'ok';
    return {
      ...base, refusal: null, lines: [], hold_microusd: 0,
      quote_lines: [{ label: 'Values free · read from your records', count: 1, per_microusd: 0, microusd: 0, free: true }],
      payload: { kind, replaces_block: replaces, record: ans },
    };
  }

  let r: Resolved;
  try { r = await ctx.modelFor(ask.element, { card: index, area: ask.id }); } catch (e: any) {
    // D1509: an element switched off for this member; else the picks could not be read, so nothing runs on a guess.
    if (e && typeof e.element === 'string') return refused(base, 'not_switched_on', String(e.message || 'This element is not switched on yet.'));
    return refused(base, 'picks_unreadable', 'Your model picks for this deck could not be read. Nothing was run.');
  }
  base.model = r.model;
  base.model_label = r.model ? modelLabel(r.model) : null;
  base.gates.plan = lockedOut(r) ? 'locked' : 'ok';
  if (lockedOut(r)) return refused(base, 'role_locked', "Set by Axal VC HQ for this deck's models, on a plan this account is not on. Nothing was run.");
  if (!r.model) return refused(base, 'no_model', 'No model can run this element on your plan. Nothing was run.');
  const rail = { page: GRID_PAGE, option: `grid:${ask.element}` };

  if (kind === 'image') {
    const description = String(card.title ?? '').trim() || narrativeOf(card).split('\n')[0] || '';
    if (description.length < 3) return refused(base, 'nothing_to_draw_from', 'Give this card a title first: the picture is described from its words.');
    const aspect = aspectOfGrid(ask.grid);
    const ask0: ImageAsk = { use: 'content', description: description.slice(0, 300), style: IMAGE_STYLE[ask.element], palette: 'brand', aspect, count: 1, card: index, card_uid: card.uid, points: [] };
    const text = promptOf(ask0);
    const size = sizeFor(r.model, aspect, boxOf(ask.grid));
    const art = await ctx.art();
    const q = await pipelineQuote(
      { userId: ctx.userId, rail, base: text, draw: { task: 'deck_image', userId: ctx.userId, model: r.model, rail } as RunOptions, size, seed: 0, art: art.art },
      { quoteRun: ctx.quote as any },
    );
    if (!q.ok) return refused(base, q.refusal, q.error);
    const lines: PlanLine[] = Array.from({ length: variants }, (_, k) => ({
      card_uid: card.uid, area_id: ask.id, element: ask.element, kind: 'image', task: 'deck_image', model: r.model, quote_microusd: q.hold_microusd,
      input: { text, option: 'deck:image', draw: size ? { width: size.width, height: size.height } : {}, variant: k, store: { card: index, ask: { description: ask0.description, style: ask0.style, aspect, use: 'content' } } },
    }));
    return {
      ...base, refusal: null, lines, hold_microusd: q.hold_microusd * variants,
      quote_lines: q.steps.map((s) => ({ label: s.label, count: variants, per_microusd: s.hold_microusd, microusd: s.hold_microusd * variants })),
      payload: { kind, replaces_block: replaces },
    };
  }

  if (kind === 'chart') {
    const action = CHART_ACTION[ask.element];
    const items = chartable(await ctx.sources()).slice(0, 30);
    if (!items.length) return refused(base, 'not_recorded', 'Nothing is recorded to chart yet. Record the figures first. Nothing was charged.');
    const msg = chartMessage(action, items, String(card.title ?? '').trim());
    const opts = (k: number): RunOptions => ({
      task: 'rail_write', userId: ctx.userId, model: r.model!, rail, systemPrompt: msg.system,
      messages: [{ role: 'user', content: msg.user }], maxTokens: 400, temperature: TEMPERATURES[k],
    } as RunOptions);
    const q = await ctx.quote(opts(0));
    if (!q.ok) return refused(base, q.refusal, q.error);
    const lines: PlanLine[] = Array.from({ length: variants }, (_, k) => ({
      card_uid: card.uid, area_id: ask.id, element: ask.element, kind: 'text', task: 'rail_write', model: r.model, quote_microusd: q.hold_microusd,
      input: { systemPrompt: msg.system, messages: [{ role: 'user', content: msg.user }], maxTokens: 400, temperature: TEMPERATURES[k], option: `deck:${action}`, variant: k, seed: textSeed(ctx.deckId, card.uid, ask.id, k) },
    }));
    return {
      ...base, refusal: null, lines, hold_microusd: q.hold_microusd * variants,
      quote_lines: [
        { label: `${variants} variant${variants === 1 ? '' : 's'} · ${base.model_label}`, count: variants, per_microusd: q.hold_microusd, microusd: q.hold_microusd * variants },
        { label: 'Values free · read from your records', count: 1, per_microusd: 0, microusd: 0, free: true },
      ],
      payload: { kind, action, replaces_block: replaces, items },
    };
  }

  // text: words for the area, rewritten from its block or written from the card's own words.
  const role = TEXT_ROLE[ask.element];
  const limit = Math.max(8, Math.min(textCapacity(ask.grid, role, ctx.aspect).chars, DENSITY_MAX[role]));
  const before = textOfBlock(block).trim();
  const narrative = narrativeOf(card);
  if (!before && !narrative) return refused(base, 'nothing_to_write_from', 'Give this card a title first: the words are written from it.');
  let system: string, user: string;
  if (before) {
    const m = textMessage(ask.action, before, { voice: ctx.voice });
    system = m.system;
    user = `${m.user}\n\nKeep it to at most ${limit} characters.`;
  } else {
    system = withUntrustedRule(`${voicePreamble(ctx.voice)} You write one ${TEXT_LABEL[ask.element]} for a pitch-deck card. Answer with the words only, at most ${limit} characters. Use only what the card's text says: never write a number, a figure or a name it does not contain.`);
    user = `Write the ${TEXT_LABEL[ask.element]} for this card.\n\nCard:\n${untrustedBlock('deck_import', narrative)}`;
  }
  const maxTokens = Math.min(800, Math.ceil(limit / 3) + 40);
  const content = (k: number) => (k ? `${user}\n\n(Variant ${k + 1}: a different wording from the others.)` : user);
  const q = await ctx.quote({ task: 'rail_write', userId: ctx.userId, model: r.model, rail, systemPrompt: system, messages: [{ role: 'user', content: content(MAX_VARIANTS - 1) }], maxTokens, temperature: TEMPERATURES[0] } as RunOptions);
  if (!q.ok) return refused(base, q.refusal, q.error);
  const lines: PlanLine[] = Array.from({ length: variants }, (_, k) => ({
    card_uid: card.uid, area_id: ask.id, element: ask.element, kind: 'text', task: 'rail_write', model: r.model, quote_microusd: q.hold_microusd,
    input: { systemPrompt: system, messages: [{ role: 'user', content: content(k) }], maxTokens, temperature: TEMPERATURES[k], option: before ? ASSIST_OPTIONS[ask.action] : `grid:${ask.element}`, variant: k, seed: textSeed(ctx.deckId, card.uid, ask.id, k) },
  }));
  return {
    ...base, refusal: null, lines, hold_microusd: q.hold_microusd * variants,
    quote_lines: [
      { label: `${variants} variant${variants === 1 ? '' : 's'} · ${base.model_label}`, count: variants, per_microusd: q.hold_microusd, microusd: q.hold_microusd * variants },
      { label: 'Safety check on every text run', count: variants, per_microusd: null, microusd: 0, included: true },
    ],
    payload: { kind, role, limit, grid: ask.grid, action: before ? ask.action : 'rewrite', before: before || null, source: before || narrative, replaces_block: replaces },
  };
}

/** Every selected area as its steps, gates and price. An area that cannot run is refused on its own; the others still run. */
export async function planAreas(ctx: PlanCtx, req: AreasRequest): Promise<AreasPlan> {
  const uids = assignCardUids(Array.isArray(ctx.cards) ? ctx.cards : []);
  const areas: PlannedArea[] = [];
  for (const ask of req.areas) areas.push(await planOne(ctx, ask, req.variants, uids));
  const lines = areas.flatMap((a) => a.lines);
  return { cls: req.cls, areas, lines, hold_microusd: areas.reduce((n, a) => n + a.hold_microusd, 0) };
}

// ---- the quote --------------------------------------------------------------

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** What a quote is for: every line's area, model and price. A plan that differs from it is a different quote. */
export async function planSignature(plan: AreasPlan): Promise<string> {
  const parts = plan.areas.map((a) => [a.card_uid, a.area_id, a.element, a.model, a.refusal?.code ?? null, (a.payload as any)?.action ?? null, a.lines.map((l) => l.quote_microusd)]);
  return (await sha256Hex(JSON.stringify([plan.cls, parts]))).slice(0, 32);
}
/** `<expiry in base 36>.<signature>`: the quote needs no row, and a changed plan or a late Generate is `quote_stale`. */
export async function quoteUidOf(plan: AreasPlan, expiresMs: number): Promise<string> {
  return `${expiresMs.toString(36)}.${await planSignature(plan)}`;
}
export async function quoteHolds(uid: unknown, plan: AreasPlan, now: number): Promise<boolean> {
  if (typeof uid !== 'string' || !/^[0-9a-z]{1,12}\.[0-9a-f]{32}$/.test(uid)) return false;
  const [exp, sig] = uid.split('.');
  return parseInt(exp, 36) > now && sig === await planSignature(plan);
}

const areaView = (a: PlannedArea) => ({
  key: a.key, card_uid: a.card_uid, area_id: a.area_id, element: a.element, kind: a.kind,
  model: a.model, model_label: a.kind === 'records' ? 'No model · free' : a.model_label,
  variants: a.variants, gates: a.gates, refusal: a.refusal, lines: a.quote_lines, hold_microusd: a.hold_microusd,
});

/** What pd4 and pd14 draw: per-area lines summing to its hold, its gates, the total hold and the quote's expiry. */
export async function quoteView(plan: AreasPlan, now: number) {
  const expires = now + QUOTE_TTL_MS;
  return {
    class: plan.cls, quote_uid: await quoteUidOf(plan, expires), expires_at: new Date(expires).toISOString(),
    hold_microusd: plan.hold_microusd, areas: plan.areas.map(areaView),
    runs: plan.areas.filter((a) => !a.refusal).length, refused: plan.areas.filter((a) => a.refusal).length,
  };
}

// ---- the proposals ------------------------------------------------------------

export type ProposalRow = {
  uid: string; deck_id: number; project_id: number; card_uid: string; area_id: string; batch_uid: string | null; mode: string; element: string;
  payload_json: string | null; variants_json: string | null; state: string; outcome: string | null; accepted_variant: number | null;
  replaces_block: string | null; created_by: number; created_at: string; decided_at: string | null; expires_at: string;
};
export type Critique = { fits: boolean | null; contrast_aa: boolean | null; density_ok: boolean | null };
export type Variant = {
  n: number; seed: number | null; model_label: string; cost_microusd: number; seconds: number | null;
  state: 'ready' | 'failed' | 'stopped' | 'waiting' | 'running';
  error: { code: string; message: string } | null;
  payload: Record<string, unknown> | null; critique: Critique | null;
};

const parse = (s: string | null | undefined): any => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };
const secondsOf = (s: StepRow): number | null => {
  if (!s.started_at || !s.ended_at) return null;
  const ms = Date.parse(`${s.ended_at.replace(' ', 'T')}Z`) - Date.parse(`${s.started_at.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null;
};
export const FAILED_LINE = 'This variant failed. You were charged only for what ran.';
export const STOPPED_LINE = 'Stopped before it ran. Nothing was charged for it.';

/**
 * Each variant an area's steps proposed, in variant order. A failed variant
 * carries its own error; the others stay acceptable. `contrastAa` is the
 * deck's ink on its ground (4.5:1), checked once for the deck.
 */
export function variantsOf(payload: any, steps: readonly StepRow[], opts: { aspect: DeckAspect; contrastAa: boolean | null }): Variant[] {
  const mine = steps.slice().sort((a, b) => Number(parse(a.input)?.variant ?? 0) - Number(parse(b.input)?.variant ?? 0));
  return mine.map((s, i) => {
    const input = parse(s.input) ?? {};
    const result = parse(s.result);
    const v: Variant = {
      n: i + 1, seed: Number.isFinite(Number(input.seed)) ? Number(input.seed) : Number.isFinite(Number(result?.seed)) ? Number(result.seed) : null,
      model_label: modelLabel(s.model_used ?? s.model), cost_microusd: Number(s.charged_microusd || 0), seconds: secondsOf(s),
      state: s.state === 'done' ? 'ready' : s.state, error: null, payload: null, critique: null,
    };
    if (s.state === 'failed') { v.error = { code: s.error_code ?? 'step_failed', message: FAILED_LINE }; return v; }
    if (s.state === 'stopped') { v.error = { code: 'stopped', message: STOPPED_LINE }; return v; }
    if (s.state !== 'done') return v;
    const fail = (code: string, message: string) => { v.state = 'failed'; v.error = { code, message }; return v; };
    if (payload?.kind === 'image') {
      const image = result?.image;
      if (!image?.uid) return fail('image_not_stored', 'The image was not stored. You were charged only for what ran.');
      v.payload = { kind: 'image', image };
      return v;
    }
    if (payload?.kind === 'chart') {
      const choice = parseJsonLoose<any>(typeof result?.text === 'string' ? result.text : '');
      const built = chartBlock(payload.action, choice, Array.isArray(payload.items) ? payload.items : []);
      if (!built) return fail('no_recorded_series', 'Eadwyn picked no recorded series to show. Nothing was placed.');
      v.payload = { kind: 'block', block: built.block, title: built.title };
      return v;
    }
    // text
    const words = wordingOf(result?.text, Number(payload?.limit) || 4000);
    if (!words) return fail('empty_wording', 'Eadwyn returned no words. Nothing was placed.');
    const problem = wordingProblem((AREA_TEXT_ACTIONS as readonly string[]).includes(payload?.action) ? payload.action : 'rewrite', String(payload?.source ?? ''), words);
    if (problem) return fail('wording_refused', problem);
    const role: TypeRole = payload?.role ?? 'paragraph';
    const grid = payload?.grid as Grid | undefined;
    v.payload = payload?.before
      ? { kind: 'text', before: payload.before, after: words }
      : { kind: 'block', block: { kind: 'text', text: words, style: role === 'heading' ? 'heading' : role === 'list' ? 'list' : 'body' } };
    v.critique = {
      fits: grid ? fitText(grid, role, words, opts.aspect).fits : null,
      contrast_aa: opts.contrastAa,
      density_ok: words.length <= DENSITY_MAX[role],
    };
    return v;
  });
}

/** A proposal as the lightbox and #3761 read it. */
export function proposalView(row: ProposalRow) {
  const payload = parse(row.payload_json) ?? {};
  return {
    uid: row.uid, card_uid: row.card_uid, area_id: row.area_id, element: row.element, mode: row.mode, kind: payload.kind ?? null,
    batch_uid: row.batch_uid, state: row.state, outcome: row.outcome, accepted_variant: row.accepted_variant,
    replaces_block: row.replaces_block, variants: (parse(row.variants_json) ?? []) as Variant[],
    created_at: row.created_at, decided_at: row.decided_at, expires_at: row.expires_at,
  };
}

/** A records element's one variant: the blocks the venture's records fill, free. */
export function recordsVariant(ans: Extract<ElementAnswer, { available: true }>): Variant {
  return {
    n: 1, seed: null, model_label: 'No model · free', cost_microusd: 0, seconds: null, state: 'ready', error: null,
    payload: { kind: 'blocks', blocks: ans.blocks, bindings: ans.bindings, label: ans.label ?? null }, critique: null,
  };
}

const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
export const expiresAtOf = (now: number) => sqlTime(now + PROPOSAL_DAYS * 86_400_000);

/**
 * Settles every running proposal of a run whose steps have all ended: its
 * variants, and 'ready' (at least one variant to accept) or 'failed'.
 * Idempotent: a settled proposal is not read again.
 */
export async function settleProposals(env: Env, batchUid: string, opts: { aspect: DeckAspect; contrastAa: boolean | null }): Promise<number> {
  const rows = ((await env.DB.prepare(`SELECT * FROM deck_area_proposals WHERE batch_uid = ?1 AND state = 'running'`).bind(batchUid).all<ProposalRow>()).results ?? []) as ProposalRow[];
  if (!rows.length) return 0;
  const steps = ((await env.DB.prepare('SELECT * FROM deck_area_batch_steps WHERE batch_uid = ?1 ORDER BY seq').bind(batchUid).all<StepRow>()).results ?? []) as StepRow[];
  let n = 0;
  for (const row of rows) {
    const mine = steps.filter((s) => s.card_uid === row.card_uid && s.area_id === row.area_id);
    if (!mine.length || mine.some((s) => s.state === 'waiting' || s.state === 'running')) continue;
    const payload = parse(row.payload_json) ?? {};
    const variants = variantsOf(payload, mine, opts);
    const state = variants.some((v) => v.state === 'ready') ? 'ready' : 'failed';
    const r = await env.DB.prepare(`UPDATE deck_area_proposals SET variants_json = ?2, state = ?3 WHERE uid = ?1 AND state = 'running'`)
      .bind(row.uid, JSON.stringify(variants), state).run();
    n += Number(r.meta?.changes ?? 0);
  }
  return n;
}

/** D1512: A15's daily cleanup. A proposal nobody decided expires; its images go with D1508's sweep. */
export async function expireAreaProposals(env: Pick<Env, 'DB'>, now: Date = new Date()): Promise<number> {
  const r = await env.DB.prepare(`UPDATE deck_area_proposals SET state = 'expired', outcome = 'expired', decided_at = ?1
    WHERE state IN ('running', 'ready', 'failed') AND expires_at < ?1`).bind(sqlTime(now.getTime())).run();
  return Number(r.meta?.changes ?? 0);
}
