/**
 * /api/ai — what the AI gateway is doing on the caller's behalf.
 *
 * The gateway itself is `services/aiRouter.ts` and predates this file by a
 * long way. What did not exist was any way for the person spending the money
 * to see it: the only rollup over `ai_usage_logs` is `/api/monitoring/ai-usage`
 * behind `requireAdmin`, so the AI rail's spend meter had to be fed by props.
 *
 * Self-scoped throughout: nothing here reads another account's usage — the org
 * view already exists and is admin-gated (see `aiUsageSelfScope`) — and nothing
 * here can change a cap.
 *
 * It was read-only until `POST /workspace/explain`, and that endpoint is why
 * the workspace rail is allowed to name a model at all. The rule the rail's
 * guards encode is that a surface may quote a model and a price only if it
 * really runs that task; the four registered surfaces earned their card by
 * having a call site, and until this route existed no workspace did. The
 * registration follows the call, never the other way round.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { loadMyAiSpend, loadMyAiSpendForSurface } from '../services/aiSpend';
import { AI_SURFACES } from '../services/aiSurfaces';
import { refuse } from '../util/refusal';
import { ROUTE, PRICE_USD_PER_1M_TOKENS, PRICE_USD_PER_AUDIO_MINUTE, PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET, IMAGE_PRICED_MODELS, run as aiRun, normaliseSurface } from '../services/aiRouter';
import { MODEL_NAMES, RETIRED_MODELS } from '../services/aiCatalog';
import { CATALOGUE, isOffered, modelById } from '../services/ai/catalogue';
import { billingMode, billedUnitPrice, multiplierFor, unitPrice } from '../services/ai/pricing';
import type { PriceUnit } from '../services/ai/catalogue';
import { aiLicenceKey } from '../services/aiBudget';
import { ensureAdminAuditLogTable } from './admin';
import { BRANCH_CODE_RE } from '../util/branch';
import { railCrumbs, railSectionOf, resolveRail, rowOffers, type RailRow } from '../services/ai/railMatrix';
import { railFor, refuseAssistOff } from '../util/railContext';

const ai = new Hono<{ Bindings: Env }>();

/**
 * A page path exactly as the router records one (see `/me/spend`). Every fixed
 * name in `services/aiSurfaces.ts` is such a path — a test there pins it — so
 * this accepts those too without a second list.
 */
export function isSpendSurface(value: unknown): value is string {
  return typeof value === 'string' && normaliseSurface(value) === value;
}

// GET /api/ai/me/spend — the caller's own month-to-date and today figures,
// the caps the router enforces, and their last run.
//
// D552 — `?surface=<name>` narrows the answer to ONE PAGE: that page's month
// and that page's last run, from the caller's own rows only. It filters; it
// never names whose spend is read.
//
// WHICH VALUES (D552 step 3, the A/B/C on #1145 settled as B). A value is
// accepted when it is an app path exactly as the router would record it as a
// surface (`normaliseSurface(v) === v`: a leading slash, the router's
// character set, no trailing slash, nothing trimmed). Every fixed name in
// `services/aiSurfaces.ts` is such a path. The rail records the path of
// whatever page it sits on (D404), on dozens of pages, many of them
// parameterised (`/research/funds/catalog/:id`), so a fixed list of rail pages
// would be a second route table that drifts. Anything else, an empty value
// included, is refused rather than read as "no page" or folded into a path it
// resembles.
ai.get('/me/spend', async (c) => {
  const user = await requireAuth(c);
  const surface = c.req.query('surface');
  if (surface === undefined) {
    const report = await loadMyAiSpend(c.env, user as any, new Date());
    return c.json({ ok: true, ...report });
  }
  if (!isSpendSurface(surface)) {
    return refuse(c, 400, {
      code: 'unknown_surface',
      message: 'That page does not record AI runs, so it has no spend to show.',
      extra: { surfaces: AI_SURFACES },
    });
  }
  const report = await loadMyAiSpendForSurface(c.env, user as any, surface, new Date());
  return c.json({ ok: true, ...report });
});

/**
 * GET /api/ai/pricing — the routing table and the price list, as the router
 * actually holds them.
 *
 * The rail quotes a cost before a run and shows a receipt after it, and
 * `assistCost.js` says in its own header that the two must come from one
 * calculation because "two functions drifting apart is exactly how a user is
 * quoted one price and shown another". The same argument applies one level up:
 * the calculation is shared, but the PRICES were not. The canvases carry
 * hand-written per-1M figures, and nothing tied them to
 * `PRICE_USD_PER_1M_TOKENS`, which is what the receipt is computed from.
 *
 * So the estimate is quoted at whatever the frontend was last told, and the
 * receipt at what the router actually charges. This endpoint removes the
 * second copy: the frontend derives its prices from the same table.
 *
 * Neither the routes nor the prices are secret — Workers AI pricing is
 * published, and the routing table says which open model handles which task.
 * It still requires auth, because it describes internal wiring and there is no
 * reason to serve it anonymously.
 *
 * Static per deploy, so it is cacheable. The figures are Cloudflare's published
 * rates and the rail renders them to a founder, so "roughly right" is not the
 * standard — `cloudflare-worker/test/ai_router_prices.test.mjs` pins them.
 */
ai.get('/pricing', async (c) => {
  const user = await requireAuth(c);
  const routes: Record<string, {
    model: string;
    fallback_chain: string[];
    alternates: string[];
  }> = {};
  for (const [task, entry] of Object.entries(ROUTE)) {
    routes[task] = {
      model: entry.model,
      fallback_chain: entry.fallbackChain ?? [],
      // What a CALLER may pick, primary first. An empty list is the answer for
      // most tasks and for `safety` it is the point: the rail renders a menu
      // from this, so a task with nothing here renders no menu and cannot
      // offer a choice that would be refused.
      alternates: entry.alternates ?? [],
    };
  }
  return c.json({
    ok: true,
    // Per 1M tokens, USD — the unit every model price list and every canvas
    // states, so no conversion happens at the boundary.
    unit: 'usd_per_1m_tokens',
    prices: PRICE_USD_PER_1M_TOKENS,
    // USD per audio minute, for the tasks billed by the minute (`transcribe`).
    // The Worker AI rail draws Whisper's card from this, so its rate is the
    // one the receipt is computed from, never a typed copy.
    audio_prices: PRICE_USD_PER_AUDIO_MINUTE,
    routes,
    // D760: every unit, websocket rates included, at cost and billed for the
    // caller's licence; `billing` says which one a run is settled at.
    billing: billingMode(c.env),
    rates: routerRates(multiplierFor(aiLicenceKey(user))),
  });
});

/**
 * D760 (#2017) — a model's unit prices as the Worker serves them: `cost`, its
 * neuron price (`unitPrice`: neurons × $0.011 / 1000, what Cloudflare bills)
 * as a number, and `billed`, that figure times the licence's multiplier,
 * multiplied exactly (`billedUnitPrice`). The frontend never multiplies. An
 * empty object for a model the catalogue cannot price.
 */
export function unitPrices(id: string, multiplier: number): { cost: Record<string, number>; billed: Record<string, number> } {
  const cost: Record<string, number> = {};
  const billed: Record<string, number> = {};
  for (const unit of Object.keys(modelById(id)?.neurons ?? {}) as PriceUnit[]) {
    const price = unitPrice(id, unit);
    if (price == null) continue;
    cost[unit] = Number(price);
    billed[unit] = billedUnitPrice(price, multiplier);
  }
  return { cost, billed };
}

/** Every model the router's three price views hold, priced in every unit it is billed in. */
export function routerRates(multiplier: number) {
  const ids = new Set([
    ...Object.keys(PRICE_USD_PER_1M_TOKENS),
    ...Object.keys(PRICE_USD_PER_AUDIO_MINUTE),
    ...Object.keys(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET),
    ...IMAGE_PRICED_MODELS,
  ]);
  return Object.fromEntries([...ids].map((id) => [id, unitPrices(id, multiplier)]));
}

/**
 * D641 (#1434) — GET /api/ai/rates: the rate card the Usage page draws.
 *
 * One row per model either of the router's price tables holds, which covers
 * every model `ROUTE` can send work to (a primary, a fallback or an
 * alternate; a test holds that). A token model is priced in and out per
 * million tokens; an audio model per minute. `retired: true` marks a model
 * kept only so past runs keep their cost.
 *
 * The figures are read from `PRICE_USD_PER_1M_TOKENS` and
 * `PRICE_USD_PER_AUDIO_MINUTE` on every request, never copied, so the card
 * cannot quote a price the receipt is not computed from. Any signed-in member.
 *
 * D760 (#2017): each row also carries `cost` and `billed` in every unit the
 * model is billed in, for the caller's licence, and a model priced only over a
 * WebSocket (Flux) has its own row with `per_audio_minute_websocket_usd`.
 */
export function rateCard(licence = '') {
  const multiplier = multiplierFor(licence);
  const row = (id: string) => ({
    id, name: MODEL_NAMES[id] ?? id, ...(RETIRED_MODELS.has(id) ? { retired: true } : {}), ...unitPrices(id, multiplier),
  });
  return [
    ...Object.entries(PRICE_USD_PER_1M_TOKENS).map(([id, p]) => ({
      ...row(id), in_per_1m_usd: p.in, out_per_1m_usd: p.out,
    })),
    ...Object.entries(PRICE_USD_PER_AUDIO_MINUTE).map(([id, perMinute]) => ({
      ...row(id), per_audio_minute_usd: perMinute,
      ...(id in PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET ? { per_audio_minute_websocket_usd: PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[id] } : {}),
    })),
    ...Object.entries(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET).filter(([id]) => !(id in PRICE_USD_PER_AUDIO_MINUTE)).map(([id, perMinute]) => ({
      ...row(id), per_audio_minute_websocket_usd: perMinute,
    })),
    // D766: an image model (Build › Brand's logo, `brand_logo`) is priced by its
    // size and steps (D761 PR 4); its `cost` and `billed` carry each unit.
    ...[...IMAGE_PRICED_MODELS].map((id) => ({ ...row(id), image: true })),
  ];
}

ai.get('/rates', async (c) => {
  const user = await requireAuth(c);
  return c.json({ ok: true, billing: billingMode(c.env), models: rateCard(aiLicenceKey(user)) });
});

/**
 * D760 (#2017) — GET /api/ai/catalogue: the models Workers AI offers today.
 *
 * Offered means status `ga` or `partner`, with a price, past the partner gate
 * (`services/ai/catalogue.ts`). Each model carries its kind, status, paid-only
 * and partner flags, context window, and its unit prices at `cost` and
 * `billed` for the caller's licence (the `admin` licence pays cost). `billing`
 * says which a run is settled at ('cost' until D762); `guard.every_run` is
 * false until D763 runs the guard on every run.
 *
 * Ordered by kind, with the router's safety model last. No groups: the
 * canvas's groups come with D764 or D769. Any signed-in member; no per-user
 * data beyond the caller's own licence.
 */
const KIND_ORDER = [
  'Text Generation', 'Image-to-Text', 'Text Embeddings', 'Text Classification', 'Translation', 'Summarization',
  'Automatic Speech Recognition', 'Text-to-Speech', 'Voice Activity Detection', 'Text-to-Image',
  'Image Classification', 'Object Detection',
];

export function catalogueFor(env: Env, licence: string) {
  const multiplier = multiplierFor(licence);
  const safety = ROUTE.safety.model;
  const rank = (id: string, kind: string) => (id === safety ? KIND_ORDER.length + 1 : (KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length));
  const models = CATALOGUE.filter((m) => isOffered(m, env))
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m.id, a.m.kind) - rank(b.m.id, b.m.kind) || a.i - b.i)
    .map(({ m }) => ({
      id: m.id, name: m.name, kind: m.kind, status: m.status, paid_only: m.paid_only, partner: m.partner,
      context_window: m.context_window, ...unitPrices(m.id, multiplier),
    }));
  return { billing: billingMode(env), guard: { every_run: false }, models };
}

ai.get('/catalogue', async (c) => {
  const user = await requireAuth(c);
  return c.json({ ok: true, ...catalogueFor(c.env, aiLicenceKey(user)) });
});

/**
 * D698 (#1660) — the Eadwyn AI rail's preferences: the assist mode per rail
 * section, and the model picked per section and router task. Before this they
 * lived in one browser's localStorage, so a founder who turned Eadwyn on at a
 * desk found it off on a phone. Migration 465's `ai_rail_preferences` holds
 * them now; localStorage stays the cache.
 *
 * Caller only. Every route calls `requireAuth` first, reads and writes the
 * caller's own rows, and takes no user id from the body or the query. A
 * display preference, like `worker_rail_collapsed`, not a venture write, so no
 * `activity_logs` row is written.
 */
// D764 (#2089): 1,000, so a member can hold a pick and a mode on each of the
// matrix's pages and their options (D720 §6). It was 200 for D698's sections.
export const RAIL_PREFERENCE_CAP = 1000;
const RAIL_SECTION_RE = /^[\p{L}\p{N} &·_-]+$/u;
const RAIL_MODES = new Set(['eadwyn', 'manual']);

/**
 * The rail's `workspace`, decoded, trimmed and lower-cased as the browser keys
 * already are (`railModelChoice.js`, `useAssistMode.js`). Null when it is not
 * 1 to 60 characters of letters, digits, spaces, `&`, `·`, `_` or `-`, so a
 * path segment such as `../x` never becomes a key.
 */
export function railSection(raw: string | undefined): string | null {
  let value = String(raw ?? '');
  try { value = decodeURIComponent(value); } catch { return null; }
  value = value.trim().toLowerCase();
  if (value.length < 1 || value.length > 60) return null;
  return RAIL_SECTION_RE.test(value) ? value : null;
}

/** A task the rail may store a pick for: a ROUTE key with a non-empty `alternates`. */
export function pickableTask(task: string): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(ROUTE, task)) return null;
  const alternates = (ROUTE as Record<string, { alternates?: string[] }>)[task].alternates ?? [];
  return alternates.length ? alternates : null;
}

async function readBody(c: any): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

/**
 * Write one preference row, or clear it when `clear` is set. The cap and the
 * write are one statement: the insert happens only while the member holds
 * fewer than RAIL_PREFERENCE_CAP rows or already holds this key, so two PUTs
 * at once cannot pass the cap, and an update to an existing key always lands.
 * Returns false when the cap refused it.
 */
async function writeRailPreference(
  env: Env,
  userId: number,
  section: string,
  task: string,
  value: { model: string | null; mode: string | null },
  clear: boolean,
): Promise<boolean> {
  if (clear) {
    await env.DB.prepare(
      'DELETE FROM ai_rail_preferences WHERE user_id = ?1 AND section = ?2 AND task = ?3',
    ).bind(userId, section, task).run();
    return true;
  }
  const res = await env.DB.prepare(
    `INSERT INTO ai_rail_preferences (uid, user_id, section, task, model, mode)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
     WHERE (SELECT COUNT(*) FROM ai_rail_preferences WHERE user_id = ?2) < ?7
        OR EXISTS (SELECT 1 FROM ai_rail_preferences WHERE user_id = ?2 AND section = ?3 AND task = ?4)
     ON CONFLICT (user_id, section, task) DO UPDATE SET
       model = excluded.model, mode = excluded.mode, updated_at = datetime('now')`,
  ).bind(crypto.randomUUID(), userId, section, task, value.model, value.mode, RAIL_PREFERENCE_CAP).run();
  return Number(res?.meta?.changes ?? 0) > 0;
}

function refuseCap(c: any) {
  return refuse(c, 409, {
    code: 'too_many_preferences',
    message: `You can keep up to ${RAIL_PREFERENCE_CAP} rail preferences. Clear one to save another.`,
  });
}

function refuseSection(c: any) {
  return refuse(c, 400, {
    code: 'invalid_section',
    message: 'That is not a rail section: use 1 to 60 letters, digits, spaces, &, ·, _ or -.',
  });
}

/** GET /api/ai/rail-preferences — the caller's modes and picks, by section. */
ai.get('/rail-preferences', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare(
    'SELECT section, task, model, mode FROM ai_rail_preferences WHERE user_id = ?1 ORDER BY section, task',
  ).bind(user.id).all<{ section: string; task: string; model: string | null; mode: string | null }>();
  const modes: Record<string, string> = {};
  const models: Record<string, Record<string, string>> = {};
  for (const row of rows.results ?? []) {
    if (row.task === '') {
      if (row.mode) modes[row.section] = row.mode;
    } else if (row.model) {
      (models[row.section] ??= {})[row.task] = row.model;
    }
  }
  return c.json({ ok: true, modes, models });
});

/** PUT /api/ai/rail-preferences/:section — `{ mode: 'eadwyn' | 'manual' | null }`. */
ai.put('/rail-preferences/:section', async (c) => {
  const user = await requireAuth(c);
  const section = railSection(c.req.param('section'));
  if (!section) return refuseSection(c);
  const body = await readBody(c);
  const mode = body.mode;
  if (mode !== null && !(typeof mode === 'string' && RAIL_MODES.has(mode))) {
    return refuse(c, 400, { code: 'invalid_mode', message: 'The mode is "eadwyn", "manual" or null.' });
  }
  const ok = await writeRailPreference(c.env, Number(user.id), section, '', { model: null, mode: mode as string | null }, mode === null);
  if (!ok) return refuseCap(c);
  return c.json({ ok: true, section, mode });
});

/** PUT /api/ai/rail-preferences/:section/:task — `{ model: string | null }`. */
ai.put('/rail-preferences/:section/:task', async (c) => {
  const user = await requireAuth(c);
  const section = railSection(c.req.param('section'));
  if (!section) return refuseSection(c);
  const task = c.req.param('task');
  const alternates = pickableTask(task);
  if (!alternates) {
    return refuse(c, 400, {
      code: 'task_not_pickable',
      message: 'That work has no model to choose, so no pick is stored for it.',
    });
  }
  const body = await readBody(c);
  const model = body.model;
  if (model !== null && !(typeof model === 'string' && alternates.includes(model))) {
    return refuse(c, 400, {
      code: 'model_not_offered',
      message: 'That model is not offered for this work.',
      extra: { alternates },
    });
  }
  const ok = await writeRailPreference(c.env, Number(user.id), section, task, { model: model as string | null, mode: null }, model === null);
  if (!ok) return refuseCap(c);
  return c.json({ ok: true, section, task, model });
});

// ---------------------------------------------------------------------------
// D764 (#2089) — the rail asks the Worker for a page's models.
//
// A page is a matrix row (`services/ai/railMatrix.ts`), keyed in the canvas's
// names, for example "Founder · Build · Prototype / MVP". Keys can hold a `/`,
// so the page travels in the query or the body, never in the path, and it is
// accepted only when the matrix has a row for it: no other string becomes a
// stored section. Picks and the mode reuse migration 465's table (D720 §6):
// `section` is the page key lower-cased, `task` the option key or `page`, and
// the `''` row the page's mode. Caller only, like the routes above.
// ---------------------------------------------------------------------------

/** An option key, `<verb>:<object>` (D720 §5): lower-case letters, digits, `_`, `-` and `/`. */
const RAIL_OPTION_RE = /^[a-z]{1,24}:[a-z0-9_/-]{1,80}$/;

function railOption(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  return typeof raw === 'string' && RAIL_OPTION_RE.test(raw) ? raw : null;
}

function refuseRailPage(c: any, page: unknown) {
  return refuse(c, 404, {
    code: 'unknown_page',
    message: 'The rail has no models for that page.',
    extra: { page: typeof page === 'string' ? page.slice(0, 200) : null },
  });
}

function refuseRailOption(c: any) {
  return refuse(c, 400, {
    code: 'invalid_option',
    message: 'An option key is a verb and an object, such as fill:pain_tag.',
  });
}

/**
 * GET /api/ai/rail?page=<key>[&option=<key>] — the page's models, each with
 * its name, role, line and D760's unit prices (`cost`, and `billed` for the
 * caller's licence, from `unitPrices`; the route computes none); the member's
 * pick and mode for the page; the billing mode; and that Llama Guard checks
 * every run.
 * `options` stays empty until D764 PR 3 adds option rows. A stored pick the
 * row no longer offers is cleared here and reads as no pick.
 */
ai.get('/rail', async (c) => {
  const user = await requireAuth(c);
  const page = c.req.query('page');
  const row = resolveRail(page);
  if (!row) return refuseRailPage(c, page);
  const option = railOption(c.req.query('option'));
  if (option === null) return refuseRailOption(c);
  const section = railSectionOf(row);
  const multiplier = multiplierFor(aiLicenceKey(user));
  const rows = (await c.env.DB.prepare(
    'SELECT task, model, mode FROM ai_rail_preferences WHERE user_id = ?1 AND section = ?2',
  ).bind(user.id, section).all<{ task: string; model: string | null; mode: string | null }>()).results ?? [];
  const stored = (task: string) => rows.find((r) => r.task === task)?.model ?? null;
  let pick: string | null = null;
  for (const task of option ? [option, 'page'] : ['page']) {
    const model = stored(task);
    if (!model) continue;
    if (rowOffers(row, model)) { pick = model; break; }
    await c.env.DB.prepare(
      'DELETE FROM ai_rail_preferences WHERE user_id = ?1 AND section = ?2 AND task = ?3',
    ).bind(user.id, section, task).run();
  }
  return c.json({
    ok: true,
    page: row.pageKey,
    crumbs: option ? [...railCrumbs(row), option] : railCrumbs(row),
    kind: row.kind,
    models: row.models.map((m) => ({
      id: m.id, name: MODEL_NAMES[m.id] ?? modelById(m.id)?.name ?? null, role: m.role, line: m.line, price: unitPrices(m.id, multiplier),
    })),
    options: [],
    pick,
    mode: rows.find((r) => r.task === '')?.mode ?? null,
    billing: billingMode(c.env),
    guard: { model: ROUTE.safety.model, every_run: true },
  });
});

async function railBody(c: any): Promise<{ row: RailRow; body: Record<string, unknown> } | Response> {
  const body = await readBody(c);
  const row = resolveRail(body.page as string);
  if (!row) return refuseRailPage(c, body.page);
  return { row, body };
}

/** PUT /api/ai/rail/pick — `{ page, option?, model: <id> | null }`. The model must be one the page's row offers. */
ai.put('/rail/pick', async (c) => {
  const user = await requireAuth(c);
  const got = await railBody(c);
  if (got instanceof Response) return got;
  const { row, body } = got;
  const option = railOption(body.option);
  if (option === null) return refuseRailOption(c);
  const model = body.model;
  if (model !== null && !(typeof model === 'string' && rowOffers(row, model))) {
    return refuse(c, 400, {
      code: 'model_not_offered',
      message: 'That model is not offered on this page.',
      extra: { models: row.models.map((m) => m.id) },
    });
  }
  const task = option ?? 'page';
  const ok = await writeRailPreference(c.env, Number(user.id), railSectionOf(row), task, { model: model as string | null, mode: null }, model === null);
  if (!ok) return refuseCap(c);
  return c.json({ ok: true, page: row.pageKey, option: option ?? null, model });
});

/** PUT /api/ai/rail/mode — `{ page, mode: 'eadwyn' | 'manual' | null }`, the page's switch. */
ai.put('/rail/mode', async (c) => {
  const user = await requireAuth(c);
  const got = await railBody(c);
  if (got instanceof Response) return got;
  const { row, body } = got;
  const mode = body.mode;
  if (mode !== null && !(typeof mode === 'string' && RAIL_MODES.has(mode))) {
    return refuse(c, 400, { code: 'invalid_mode', message: 'The mode is "eadwyn", "manual" or null.' });
  }
  const ok = await writeRailPreference(c.env, Number(user.id), railSectionOf(row), '', { model: null, mode: mode as string | null }, mode === null);
  if (!ok) return refuseCap(c);
  return c.json({ ok: true, page: row.pageKey, mode });
});

/**
 * What the model is told it is for. Written as a boundary rather than a
 * persona, because everything it is stopped from doing is something the
 * product has been caught doing before.
 *
 * The one rule that matters: it is shown ONLY the lines the rail is already
 * displaying, and it may not go beyond them. A page whose coverage says "3
 * quotes out, 1 decided" cannot support a sentence about win rate, and a model
 * that writes one anyway has produced the same fabricated fact that
 * `NotRecorded`, `Unrecorded` and `ZoneBody` exist across this codebase to
 * prevent — with a currency symbol in front of it and a model's authority
 * behind it.
 */
const WORKSPACE_EXPLAIN_PROMPT = [
  'You read back what a workspace page is currently showing, for the person looking at it.',
  '',
  'You are given the page name and the exact summary lines the page has already',
  'rendered. Those lines are everything you know.',
  '',
  'Rules:',
  '- Never state a fact that is not in the lines you were given. Do not estimate,',
  '  extrapolate, or fill a gap from general knowledge about businesses.',
  '- If the lines do not support a conclusion, say which line is missing instead',
  '  of reaching one anyway. "Nothing here records X" is a useful answer.',
  '- No advice about raising money, investing, taxes, or legal structure.',
  '- Plain sentences. No headings, no bullet lists, no markdown.',
  '- At most four sentences.',
  '',
  'You are drafting a note the person will read and may keep. You are not acting',
  'for them and nothing you write is sent, saved or shared by you.',
].join('\n');

/**
 * POST /api/ai/workspace/explain — read back one workspace zone.
 *
 * Body: { workspace, zone?, coverage: string[] }
 *
 * `coverage` is the SAME array the rail already renders under its Coverage
 * block — counts and labels the page has fetched, e.g. "12 accessible
 * positions". Deliberately not the rows themselves: the rail's coverage lines
 * are already the page's own summary of itself, they carry no personal data,
 * and sending the underlying records would put a client's name into a prompt
 * to satisfy a feature nobody asked for that of.
 */
ai.post('/workspace/explain', async (c) => {
  const user = await requireAuth(c);

  const body = await c.req.json<{
    workspace?: string; zone?: string; coverage?: unknown; model?: string; branch?: string; page?: string;
  }>().catch(() => null);
  const workspace = String(body?.workspace || '').trim().slice(0, 60);
  const zone = String(body?.zone || '').trim().slice(0, 60);
  // Passed through UNVALIDATED and on purpose: `run()` owns the allow-list,
  // and a second copy of it here is a second thing to keep true. The length
  // clamp is not validation, it is a bound on what gets logged if someone
  // posts a megabyte.
  const model = String(body?.model || '').trim().slice(0, 120) || undefined;
  // The app path the rail sits on, recorded as the run's `surface` (D404,
  // migration 319) so the rail can say what THIS page has cost. The router
  // re-validates it (`normaliseSurface`) and records NULL for anything that
  // is not a plain app path; this only bounds the length.
  const page = typeof body?.page === 'string' ? body.page.slice(0, 200) : undefined;
  /**
   * H13 RULE 4 — "anything about a named branch is logged", and D150's refusal
   * of it had a premise D153 removed.
   *
   * D150 declined to log a rail run, with its reason stated: "the rail reads
   * no branch — POST /api/ai/workspace/explain runs over the coverage lines
   * the page already rendered, deliberately not the rows. Logging that as a
   * privileged branch read would write a FALSE audit entry, which is worse
   * than none." That was exactly right while every HQ page read the fan-out or
   * its own ledger: the lines summarised HQ's own screen, and no branch was
   * named in them.
   *
   * D153's overlay makes a page route its reads through ONE branch, so under
   * it those same lines ARE that branch's figures — and a question asked about
   * them is a question about a named branch. The canvas's rule then applies on
   * its own terms: "cross-branch answers write to Security, the same as an
   * impersonation — reading a branch is a privileged act even when it is only
   * a question."
   *
   * So the row is written WHEN AND ONLY WHEN the caller names a branch. An
   * unscoped run still writes nothing, because it is still true that nothing
   * privileged happened — the refusal is narrowed rather than reversed, which
   * is the D111 pattern this repo applies to every reason that half-expires.
   */
  const branchRaw = String(body?.branch || '').trim().toLowerCase();
  const branch = branchRaw && BRANCH_CODE_RE.test(branchRaw) ? branchRaw : '';

  const coverage = (Array.isArray(body?.coverage) ? body!.coverage : [])
    .slice(0, 12)
    .map((line) => String(line).trim().slice(0, 200))
    .filter(Boolean);

  if (!workspace) return c.json({ error: 'workspace is required' }, 400);
  // A page with nothing on it has nothing to read back, and an "explanation"
  // of an empty page is precisely the invented content this endpoint's prompt
  // spends its length forbidding.
  if (coverage.length === 0) {
    return c.json({
      error: 'nothing_to_read',
      message: 'This page has not loaded anything to summarise yet.',
    }, 400);
  }

  const subject = zone ? `${workspace} · ${zone}` : workspace;
  const facts = coverage.map((l) => `- ${l}`).join('\n');

  // The input check is the guard inside `run()` (D763), once, on `facts`.
  // These lines are generated by our own pages, so a block is unlikely, which
  // is the reason to keep checking them rather than to stop: the day a page
  // starts echoing user-entered text into a coverage line, this is what
  // stands between that text and the model.

  // BEFORE THE RUN, NOT AFTER IT. An audit row written only on success would
  // omit exactly the reads an operator most wants to see — the ones that were
  // refused, timed out or blocked — and "what was asked of this branch" is the
  // question the row exists to answer, not "what came back". Best-effort and
  // its own try/catch on the D111 precedent: a failed audit insert must not
  // turn a read into a 500, and the read is reported either way.
  if (branch) {
    try {
      await ensureAdminAuditLogTable(c.env);
      await c.env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
         VALUES (?, 'ai_branch_readback', 'branch', NULL, ?)`,
      ).bind(user.id, JSON.stringify({ branch, workspace, zone, coverage_lines: coverage.length })).run();
    } catch (e) {
      console.error('[ai/workspace/explain] branch audit insert failed', (e as Error).message);
    }
  }

  const r = await aiRun(c.env, {
    task: 'workspace_explain',
    userId: user.id,
    model,
    surface: page,
    // D765: the rail's page and option; the switch is the workspace's.
    rail: railFor(c, { page: workspace, option: 'explain:zone' }),
    systemPrompt: WORKSPACE_EXPLAIN_PROMPT,
    messages: [{ role: 'user', content: `Page: ${subject}\n\nWhat the page is showing:\n${facts}` }],
    maxTokens: 320,
    temperature: 0.2,
    guardText: facts,
    role: user.role,
  });

  if (r.refusal === 'assist_off') return refuseAssistOff(c);
  // D763: a block keeps this route's answer to it, whoever checks.
  if (r.refusal === 'guard_blocked') {
    return c.json({
      error: 'safety_block',
      message: 'That page summary could not be sent for review.',
      category: r.guard?.codes[0]?.toLowerCase() ?? 'unsafe',
    }, 422);
  }

  // `run` never throws — it returns a refusal with a usage row instead — so a
  // budget stop and a model outage both arrive here rather than as a 500, and
  // both keep their reason.
  if (!r.ok) {
    return c.json({
      ok: false,
      refusal: r.refusal ?? null,
      // `model_not_offered` says something the other refusals do not: the
      // request itself was wrong, and re-running it unchanged will fail the
      // same way. The rail reads this and drops the saved choice.
      message: r.refusal === 'model_not_offered'
        ? 'That model is no longer offered for this page. Nothing was run.'
        : r.refusal === 'budget_user_month' || r.refusal === 'budget_user_day'
          ? 'This month\u2019s AI budget is spent. Nothing was run.'
          // D763: the guard withheld the answer, or could not check it; its own words.
          : r.refusal === 'guard_blocked_output' || r.refusal === 'guard_unavailable'
            ? r.error
            : 'The model could not be reached. Nothing was run, and nothing was charged.',
      ...(r.guard?.refusal?.link ? { link: r.guard.refusal.link } : {}),
      usage: { model: r.usage.model, est_cost_usd: 0 },
    }, 503);
  }

  return c.json({
    ok: true,
    text: r.output || '',
    usage: {
      model: r.usage.model,
      est_cost_usd: r.usage.est_cost_usd,
      cached: r.usage.cached,
      fallback_used: r.usage.fallback_used,
      // The token counts the rail's receipt prints. Measured by the provider
      // and already written to `ai_usage_logs`; returning them costs nothing
      // and is the difference between a receipt and an assertion that a run
      // happened.
      prompt_tokens: r.usage.prompt_tokens,
      completion_tokens: r.usage.completion_tokens,
    },
  });
});

export default ai;
