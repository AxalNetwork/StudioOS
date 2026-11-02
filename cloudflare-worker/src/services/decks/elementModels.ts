/**
 * D1503 (#3754, deck v2 A10) — a model route per grid element, from the one
 * catalogue. Pure: no binding, no network, no model call.
 *
 * WHERE THE MODELS COME FROM. Nothing here names a model. Each element's job
 * is `DECK_ELEMENT_JOBS` in `services/ai/modelUseCases.ts` (#3934, #3721's
 * per-job plan), and that job's Default, Alternative and Deeper, and its All
 * models list, are `selectorFor(job, fits)` over the plan's rows; every id in
 * those rows is a `catalogue.ts` id (D760). A second list here would drift,
 * so `test/deck_element_models_d1503.test.ts` fails on any model id literal
 * in this file.
 *
 *   ELEMENTS           every element of the lightbox's picker, with its group
 *                      and its job (null for one placed with no model)
 *   ELEMENT_ROUTES     per routed element: { task, kind, job, chain, plan_min,
 *                      maxTokens, timeoutClass, pipeline, requirements }
 *   (OUTPUT_RULES, `inputRefusal` and `outputProblems` live beside it in
 *   `elementOutputRules.ts`, since they read `newDeck.ts`; this file stays
 *   free of it so `railMatrix.ts` can import it without a cycle.)
 *   choicesFor         the element's ≤ 3 suggested and the rest, as #3741's
 *                      rail answers them
 *   resolveElementModel  the 9 levels, each candidate through `isOffered`,
 *                      the plan policy (`offerable`, MODEL_LOCKS) and plan_min;
 *                      HQ's lock wins over every other level (D1549)
 *   PRESETS, presetModelFor   D1549 (#3796): Fast, Balanced and Best, each
 *                      the element's job's own preset row in #3721's plan
 *   sizeFor, estimateDeck, expected_ms   the units a run is sized at, the
 *                      deck's estimate line by line, and the time it plans for
 *   gridOptionRows     the `grid:<element>` rail rows `railMatrix.ts` answers
 */
import { DECK_ELEMENT_JOBS, MODEL_LOCKS, jobStep, lockLabel, offerable, selectorFor, type Lock, type UseJob, type UseKind } from '../ai/modelUseCases';
import { isOffered, modelById, type CatalogueSwitches } from '../ai/catalogue';
import { fitsRailKind } from '../ai/moduleConnections';
import { billedMicro, type RunUnits } from '../ai/pricing';
import { TIMEOUT_MS, drawRequest, imageUnits, type TimeoutClass } from '../ai/shapes';

// ---------------------------------------------------------------------------
// The elements
// ---------------------------------------------------------------------------

export type ElementGroup = keyof typeof DECK_ELEMENT_JOBS & string;
export type ElementDef = { id: string; group: string; job: string | null };

/** Every element of `deckV2Model.ELEMENT_GROUPS`, in its order, with the job #3934 names for it. */
export const ELEMENTS: readonly ElementDef[] = Object.freeze(
  Object.entries(DECK_ELEMENT_JOBS).flatMap(([group, g]) => Object.entries(g.items).map(([id, job]) => Object.freeze({ id, group, job }))),
);
export const ELEMENT_GROUPS: readonly string[] = Object.freeze(Object.keys(DECK_ELEMENT_JOBS));
/** D1549: each group's name as the AIRail prints it (`deckRailGroups.js`), for the HQ table and a lock's refusal. */
export const GROUP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  text: 'Text', images: 'Images', graphics: 'Graphics', data: 'Data', diagrams: 'Diagrams', venture: 'Venture records', media: 'Media',
});
const BY_ID = new Map(ELEMENTS.map((e) => [e.id, e]));
export const elementOf = (id: string): ElementDef | null => BY_ID.get(id) ?? null;

/** What a lightbox line says for an element that runs no model (pd14). */
export const FREE_LINE = 'No model · free';

/** The router task each job kind runs on (`aiRouter.ROUTE`). */
const TASK_OF: Partial<Record<UseKind, string>> = { write: 'rail_write', draw: 'deck_image', edit_image: 'rail_edit_image' };
/** The rail option a run of that kind is recorded against today. */
const OPTION_OF: Partial<Record<UseKind, string>> = { write: 'deck:rewrite', draw: 'deck:image' };

/** How an element's words or picture are shaped, which sizes its run and bounds its output. */
export type Shape = 'line' | 'paragraph' | 'list' | 'notes' | 'data' | 'diagram' | 'venture' | 'image' | 'edit';
export const SHAPE_OF: Readonly<Record<string, Shape>> = Object.freeze({
  title: 'line', kicker: 'line', caption: 'line', callout: 'line',
  body: 'paragraph', team_bios: 'paragraph', speaker_notes: 'notes', bullets: 'list',
  chart: 'data', table: 'data', timeline: 'data', market_size: 'data', projections: 'data', competition: 'data',
  typed_table: 'data', market_chart: 'data', projection_chart: 'data', positioning: 'diagram',
  flow: 'diagram', cycle: 'diagram', matrix: 'diagram', funnel: 'diagram', hierarchy: 'diagram', hub: 'diagram',
  use_of_funds: 'venture', round_terms: 'venture', interview_quote: 'venture', cap_table: 'venture',
  photo: 'image', illustration: 'image', edit_vary: 'edit', remove_bg: 'edit', upscale: 'edit',
});

/** Output tokens per run, and the words the model reads besides the records, per shape. */
const TOKENS: Readonly<Record<Shape, { out: number | null; in: number | null }>> = Object.freeze({
  line: { out: 80, in: 600 }, paragraph: { out: 400, in: 1200 }, list: { out: 300, in: 1200 }, notes: { out: 600, in: 1500 },
  data: { out: 900, in: 2000 }, diagram: { out: 700, in: 1500 }, venture: { out: 700, in: 2000 }, image: { out: null, in: null }, edit: { out: null, in: null },
});

export type Requirement = 'records' | 'source_image' | 'brand_colours';
const REQUIREMENTS: Readonly<Record<Shape, readonly Requirement[]>> = Object.freeze({
  line: [], paragraph: [], list: [], notes: [], data: ['records'], diagram: ['records'], venture: ['records'],
  image: ['brand_colours'], edit: ['source_image'],
});

export type PipelineStep = { job: string; step: number; kind: UseKind; model: string };
export type ElementRoute = {
  /** The router task the element's run is charged to. */
  task: string;
  /** The rail option the run records today (`ai_usage_logs.rail_option`), or null when its press is not on main yet. */
  option: string | null;
  kind: UseKind;
  /** The #3721 job (`modelUseCases.JOBS`) whose Default, Alternative and Deeper the element offers. */
  job: string;
  /** Who else the run may fall back to after its primary: the job's other suggestions; none for an image. */
  chain: readonly string[];
  /** The lowest plan any of the element's models runs on (`MODEL_LOCKS`). */
  plan_min: Lock;
  maxTokens: number | null;
  timeoutClass: TimeoutClass;
  /** Fixed steps after the run (the real-person check, the screen and alt text after a draw). */
  pipeline: readonly PipelineStep[];
  requirements: readonly Requirement[];
};

const PLAN_RANK: Readonly<Record<Lock, number>> = Object.freeze({ all: 0, lowest_paid: 1, top_paid: 2, hidden: 99 });
export const planRankOf = (lock: string | null | undefined): number => PLAN_RANK[(lock ?? 'all') as Lock] ?? 99;
const lockOf = (id: string): Lock => (MODEL_LOCKS[id] ?? 'all') as Lock;

/** The element's job row, or null when it runs no model, or its job is a fixed check (an upload's screen) or not in the plan. */
function jobOf(e: ElementDef | null): UseJob | null {
  if (!e?.job) return null;
  const j = jobStep(e.job, 0);
  return j && !j.fixed && TASK_OF[j.kind] && SHAPE_OF[e.id] ? j : null;
}

/** A model the element's run can do (its kind's shape) and that a rail may list (not hidden, not on Legal's hold). */
const fitsElement = (kind: UseKind) => (id: string) => fitsRailKind(kind, id) && offerable(id) && modelById(id) != null;

function routeOf(e: ElementDef, j: UseJob): ElementRoute {
  const shape = SHAPE_OF[e.id];
  const { models, more } = selectorFor(j, fitsElement(j.kind));
  const ids = [...models.map((m) => m.id), ...more.map((m) => m.id)];
  const image = j.kind === 'draw' || j.kind === 'edit_image';
  const pipeline: PipelineStep[] = [];
  if (j.kind === 'draw') {
    for (let s = 0; s < 3; s++) { const p = jobStep('DK6', s); if (p) pipeline.push({ job: p.id, step: p.step, kind: p.kind, model: p.default }); }
  }
  return Object.freeze({
    task: TASK_OF[j.kind]!,
    option: OPTION_OF[j.kind] ?? null,
    kind: j.kind,
    job: j.id,
    chain: Object.freeze(image ? [] : models.slice(1).map((m) => m.id)),
    plan_min: (ids.length ? ids.map(lockOf).sort((a, b) => PLAN_RANK[a] - PLAN_RANK[b])[0] : 'hidden') as Lock,
    maxTokens: TOKENS[shape].out,
    timeoutClass: image ? 'image' : 'chat',
    pipeline: Object.freeze(pipeline),
    requirements: REQUIREMENTS[shape],
  });
}

/** Every element that runs a model, keyed by element id. */
export const ELEMENT_ROUTES: Readonly<Record<string, ElementRoute>> = Object.freeze(Object.fromEntries(
  ELEMENTS.flatMap((e) => { const j = jobOf(e); return j ? [[e.id, routeOf(e, j)]] : []; }),
));
export const ROUTED_ELEMENTS: readonly string[] = Object.freeze(Object.keys(ELEMENT_ROUTES));
export const isRouted = (id: string): boolean => Object.prototype.hasOwnProperty.call(ELEMENT_ROUTES, id);
/** A group's routed elements, in picker order; its first is the group's lead, whose list the rail block shows. */
export const groupElements = (group: string): string[] => ELEMENTS.filter((e) => e.group === group && isRouted(e.id)).map((e) => e.id);

// ---------------------------------------------------------------------------
// The choices: ≤ 3 suggested, the rest under All models
// ---------------------------------------------------------------------------

export type Card = { id: string; role: string; line: string; lock: string | null };
export type Choice = { id: string; line: string; lock: string | null };

/**
 * The element's choices as the rail shows them (#3741): at most three
 * suggested, Default, Alternative and Deeper by position, then every other
 * model the job or its kind lists under `more`, each once, none twice.
 */
export function choicesFor(element: string): { suggested: Card[]; more: Choice[] } {
  const e = elementOf(element);
  const j = jobOf(e);
  if (!e || !j) return { suggested: [], more: [] };
  const { models, more } = selectorFor(j, fitsElement(j.kind));
  return {
    suggested: models.slice(0, 3).map((m) => ({ id: m.id, role: m.role, line: m.line, lock: lockLabel(m.id) })),
    more: [...models.slice(3), ...more].map((m) => ({ id: m.id, line: m.line, lock: lockLabel(m.id) })),
  };
}

const choiceIds = (element: string): string[] => { const c = choicesFor(element); return [...c.suggested, ...c.more].map((m) => m.id); };

// ---------------------------------------------------------------------------
// resolveElementModel — the 8 levels
// ---------------------------------------------------------------------------

export type PickScope = 'org' | 'area' | 'deck' | 'member';
/** One `deck_model_picks` row (migration 717). */
export type PickRow = { scope: PickScope; scope_id: string; key: string; model: string; locked: number | boolean; plan_min?: string | null; set_by?: number | null };

/** The levels, highest first. D1549 (#3796) adds `deck_preset`, the deck's Fast, Balanced or Best, below its own picks. */
export const LEVELS = ['org_lock', 'area', 'deck_element', 'deck_group', 'deck_preset', 'member_element', 'member_group', 'org_default', 'default'] as const;
export type Level = (typeof LEVELS)[number];

/** HQ's scope id: the one org that sets defaults and locks today. */
export const ORG_HQ = 'hq';

// ---------------------------------------------------------------------------
// D1549 (#3796, deck v2 C1) — presets per element group
// ---------------------------------------------------------------------------

/**
 * The presets a deck can hold. Custom is not stored: it is the deck's own
 * group and element picks, with no preset under them. Each preset names no
 * model here: an element runs its job's own `presets` row in #3721's plan
 * (`modelUseCases.JOBS`), and only when that model is one of the element's
 * choices, so a group's preset is its elements' rows, through the same
 * routing as every pick.
 */
export const PRESETS = ['fast', 'balanced', 'best'] as const;
export type Preset = (typeof PRESETS)[number];
export const PRESET_LABELS: Readonly<Record<Preset | 'custom', string>> = Object.freeze({ fast: 'Fast', balanced: 'Balanced', best: 'Best', custom: 'Custom' });
/** The key the deck's preset is stored under, scope 'deck': its `model` holds the preset's name, never a model id, and no run reads it as one. */
export const PRESET_KEY = 'preset';
export const isPreset = (v: unknown): v is Preset => typeof v === 'string' && (PRESETS as readonly string[]).includes(v);

/** The model `preset` runs `element` on: its job's preset row, when the element offers it; else null (the levels below decide). */
export function presetModelFor(element: string, preset: Preset): string | null {
  const j = jobOf(elementOf(element));
  const id = j?.presets?.[preset] ?? null;
  return id && choiceIds(element).includes(id) ? id : null;
}
export const groupKey = (group: string): string => `group:${group}`;
/** An area's scope id: the venture's deck, the card's index and the area's id. */
export const areaScopeId = (deck: string, card: number, area: string): string => `${deck}/${card}/${area}`;

export type ResolveInput = {
  element: string;
  /** Every pick row that could apply: HQ's, the deck's, the area's and the member's. */
  rows: readonly PickRow[];
  /** The deck's scope id (the venture's project id) and the member's (their user id). */
  deck: string | null;
  member: string | null;
  area?: { card: number; area: string } | null;
  /** The caller's plan, as `MODEL_LOCKS` ranks it (0 every plan, 1 paid, 2 top paid). */
  planRank: number;
  env: CatalogueSwitches;
};

export type Resolved = {
  element: string;
  model: string | null;
  source: Level | 'none';
  locked: boolean;
  set_by: number | null;
  /** Rows that named a model the catalogue no longer offers for this element: read as none, cleared by the caller. */
  stale: PickRow[];
  /** A pick the caller's plan cannot run, skipped (never cleared), with the plan it needs. */
  plan_blocked: Array<{ level: Level; model: string; plan: string | null }>;
  /** "A model retired · Using <model>" when a stale pick was dropped; null otherwise. */
  notice: string | null;
};

/**
 * D1549: HQ locked the element to a model the caller's plan cannot run. The
 * lock still wins, so nothing runs: `model` is null and the run refuses.
 */
export const lockedOut = (r: Resolved): boolean => r.locked && !r.model;

/** Why a model cannot be the element's: stale (gone from the catalogue or the element's list) or the caller's plan. */
function refusalOf(element: string, model: string, row: PickRow | null, input: ResolveInput, viaGroup: boolean): 'stale' | 'plan' | 'n/a' | null {
  const m = modelById(model);
  if (!m || !isOffered(m, input.env) || !offerable(model)) return 'stale';
  if (!choiceIds(element).includes(model)) return viaGroup ? 'n/a' : 'stale';
  const need = Math.max(planRankOf(lockOf(model)), planRankOf(row?.plan_min ?? 'all'));
  if (need > input.planRank) return 'plan';
  return null;
}

const modelName = (id: string | null): string => (id ? modelById(id)?.name ?? id.split('/').pop() ?? id : 'no model');

/**
 * The model an element runs on, from the 9 levels in order: HQ's lock, the
 * area's override, the deck's element pick, the deck's group pick, the deck's
 * preset (D1549), the member's element pick, the member's group pick, HQ's
 * default, and the row default (the job's first suggestion the caller can
 * run).
 *
 * HQ'S LOCK WINS OVER EVERY OTHER LEVEL (D1549). When HQ locked the element
 * or its group, the levels a member sets (area, deck, preset, member) are not
 * read at all: the lock's model runs; or, when the caller's plan cannot run
 * it, nothing does (`lockedOut`); or, when the lock's model is retired or
 * not one the element offers, HQ's default and then the row default decide.
 * Each candidate
 * must be in the catalogue and offered (`isOffered`), allowed by policy
 * (`offerable`: not hidden, not on Legal's hold), one of the element's own
 * choices, and on the caller's plan (`plan_min`). A stale pick reads as none
 * and is returned in `stale` for the caller to clear; a pick the plan cannot
 * run is skipped and kept.
 */
export function resolveElementModel(input: ResolveInput): Resolved {
  const { element } = input;
  const e = elementOf(element);
  const out: Resolved = { element, model: null, source: 'none', locked: false, set_by: null, stale: [], plan_blocked: [], notice: null };
  if (!e || !isRouted(element)) return out;
  const g = groupKey(e.group);
  const find = (scope: PickScope, id: string | null, keys: string[], locked?: boolean): PickRow | null => {
    if (id == null) return null;
    for (const key of keys) {
      const r = input.rows.find((x) => x.scope === scope && x.scope_id === id && x.key === key && (locked === undefined || Boolean(Number(x.locked)) === locked));
      if (r) return r;
    }
    return null;
  };
  const lock = find('org', ORG_HQ, [element, g], true);
  const presetRow = lock ? null : find('deck', input.deck, [PRESET_KEY]);
  const presetModel = presetRow && isPreset(presetRow.model) ? presetModelFor(element, presetRow.model) : null;
  // A lock leaves only HQ's own levels below it: no member-set level is read.
  const memberSet: Array<[Level, PickRow | null, boolean]> = lock ? [] : [
    ['area', input.area && input.deck != null ? find('area', areaScopeId(input.deck, input.area.card, input.area.area), [element]) : null, false],
    ['deck_element', find('deck', input.deck, [element]), false],
    ['deck_group', find('deck', input.deck, [g]), true],
    ['deck_preset', presetRow && presetModel ? { ...presetRow, model: presetModel } : null, true],
    ['member_element', find('member', input.member, [element]), false],
    ['member_group', find('member', input.member, [g]), true],
  ];
  const candidates: Array<[Level, PickRow | null, boolean]> = [
    ['org_lock', lock, false],
    ...memberSet,
    ['org_default', find('org', ORG_HQ, [element, g], false), false],
  ];
  let dropped = false;
  for (const [level, row, viaGroup] of candidates) {
    if (!row) continue;
    const why = refusalOf(element, row.model, row, input, viaGroup || row.key === g);
    // A preset's model the catalogue does not offer now is skipped: the stored row is the preset's name, never cleared as a stale pick.
    if (why === 'stale' && level === 'deck_preset') continue;
    if (why === 'stale') { out.stale.push(row); dropped = true; continue; }
    if (why === 'plan' && level === 'org_lock') {
      // The lock wins even here: nothing runs, rather than a model HQ locked out.
      out.plan_blocked.push({ level, model: row.model, plan: lockLabel(row.model) });
      Object.assign(out, { source: level, locked: true, set_by: row.set_by ?? null });
      return out;
    }
    if (why === 'plan') { out.plan_blocked.push({ level, model: row.model, plan: lockLabel(row.model) }); continue; }
    if (why === 'n/a') continue;
    Object.assign(out, { model: row.model, source: level, locked: level === 'org_lock', set_by: row.set_by ?? null });
    break;
  }
  if (!out.model) {
    const first = choiceIds(element).find((id) => refusalOf(element, id, null, input, false) == null) ?? null;
    if (first) Object.assign(out, { model: first, source: 'default' });
  }
  if (dropped) out.notice = `A model retired · Using ${modelName(out.model)}`;
  return out;
}

/** The one level whose row a member may not change: HQ's lock on the element, its group, or (for a group key) any of its elements. */
export function lockFor(rows: readonly PickRow[], key: string): PickRow | null {
  const locked = rows.filter((r) => r.scope === 'org' && r.scope_id === ORG_HQ && Boolean(Number(r.locked)));
  if (key.startsWith('group:')) {
    const group = key.slice(6);
    return locked.find((r) => r.key === key || ELEMENTS.some((e) => e.group === group && e.id === r.key)) ?? null;
  }
  const e = elementOf(key);
  return locked.find((r) => r.key === key || (e && r.key === groupKey(e.group))) ?? null;
}

/** A key a pick may be stored under: a routed element, or a group with at least one. */
export function pickKeyOk(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key.startsWith('group:')) return groupElements(key.slice(6)).length > 0;
  return isRouted(key);
}

/** Whether a pick under `key` can name `model`: one of the element's choices, or of at least one of the group's elements. */
export function keyOffers(key: string, model: string): boolean {
  const ids = key.startsWith('group:') ? groupElements(key.slice(6)) : [key];
  return ids.some((id) => choiceIds(id).includes(model));
}

// ---------------------------------------------------------------------------
// Size, estimate and time
// ---------------------------------------------------------------------------

/** The units one run of the element is sized at on `model`: its words in and out, or the picture's tiles and steps. Null when it cannot be sized. */
export function sizeFor(element: string, model: string): RunUnits | null {
  const r = ELEMENT_ROUTES[element];
  if (!r) return null;
  const t = TOKENS[SHAPE_OF[element]];
  if (r.timeoutClass === 'image') {
    const req = drawRequest(model, '', {});
    return req ? (imageUnits(model, req.sent.width, req.sent.height, req.sent.steps) as RunUnits) : null;
  }
  return t.in == null || t.out == null ? null : { tokens_in: t.in, tokens_out: t.out };
}

export type EstimateLine = { element: string; count: number; model: string | null; free: boolean; per_microusd: number | null; microusd: number | null };
export type Estimate = { lines: EstimateLine[]; total_microusd: number | null };

/**
 * The deck's estimate, one quote line per element: how many it places, the
 * model each runs on, and what that costs at the caller's multiplier. A free
 * element's line is free (it runs no model); a line that cannot be priced is
 * null, and so is the total, never 0.
 */
export function estimateDeck(counts: Readonly<Record<string, number>>, models: Readonly<Record<string, string | null>>, multiplier: number): Estimate {
  const lines: EstimateLine[] = [];
  for (const [element, raw] of Object.entries(counts)) {
    const count = Number.isInteger(raw) && raw > 0 ? raw : 0;
    if (!count || !elementOf(element)) continue;
    if (!isRouted(element)) { lines.push({ element, count, model: null, free: true, per_microusd: 0, microusd: 0 }); continue; }
    const model = models[element] ?? null;
    let per: number | null = null;
    try { const u = model ? sizeFor(element, model) : null; per = u ? billedMicro(model!, u, multiplier) : null; } catch { per = null; }
    lines.push({ element, count, model, free: false, per_microusd: per, microusd: per == null ? null : per * count });
  }
  const total = lines.some((l) => l.microusd == null) ? null : lines.reduce((s, l) => s + (l.microusd as number), 0);
  return { lines, total_microusd: total };
}

/**
 * The time a build plans for one of the element's runs: its class's
 * per-attempt limit (`shapes.TIMEOUT_MS`), once for the run and once for each
 * fixed step after it. A budget, not a measurement; null for a free element.
 */
export function expected_ms(element: string): number | null {
  const r = ELEMENT_ROUTES[element];
  if (!r) return null;
  return TIMEOUT_MS[r.timeoutClass] + r.pipeline.length * TIMEOUT_MS.chat;
}

// ---------------------------------------------------------------------------
// The rail's grid rows
// ---------------------------------------------------------------------------

/** The rail page whose `grid:<element>` rows these are. */
export const GRID_PAGE = 'Founder · Raise · Pitch deck';
export const gridOption = (element: string): string => `grid:${element}`;

/**
 * One rail option row per routed element, generated from the job tables:
 * `{ pageKey, optionKey: 'grid:<element>', kind, routeTask, models (≤ 3),
 * more }`. Each row's kind is its job's, one `RAIL_KINDS` already has, so no
 * kind is added.
 */
export function gridOptionRows(): Array<{ pageKey: string; optionKey: string; optionLabel: string; kind: string; handler: string; routeTask: string; models: Array<{ id: string; role: string; line: string }>; more: Array<{ id: string; line: string }> }> {
  return ROUTED_ELEMENTS.map((id) => {
    const r = ELEMENT_ROUTES[id];
    const c = choicesFor(id);
    return {
      pageKey: GRID_PAGE, optionKey: gridOption(id), optionLabel: id, kind: r.kind, handler: 'draft', routeTask: r.task,
      models: c.suggested.map(({ id: m, role, line }) => ({ id: m, role, line })), more: c.more.map(({ id: m, line }) => ({ id: m, line })),
    };
  });
}
