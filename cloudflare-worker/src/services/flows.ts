/**
 * D853 (#2476) — multi-connector flows on JOB_QUEUE: recipes, durable runs,
 * per-step holds, safe retries.
 *
 * A RECIPE is a code constant: trigger → read → map → proposal → (the
 * founder's accept) → publish → result back. A RUN is one execution of a
 * recipe for one member and, where it has one, one of their companies. Its
 * state is in D1 (migration 526); each step is one queue message.
 *
 * ONE STEP, ONE HOLD. A step attempt holds and settles its own AI tokens
 * through `meteredCall` (D844), under the run's one execution id, with the
 * key `flow:<run>:<step>:<attempt>`. The step writes its output to its row
 * INSIDE the metered run, before the hold settles, so every crash lands on a
 * row that says what to do and no path charges twice:
 *
 *   crash before the output is written   the hold (if any) is pending; the
 *                                        redelivery re-runs the step under
 *                                        the same key and takes no new hold.
 *   crash after it, before settlement    the row is `ran`; the redelivery
 *                                        settles the pending hold at the
 *                                        recorded cost and moves on.
 *   crash after settlement               the row is `ran`, the hold settled;
 *                                        the redelivery only moves on.
 *
 * A DUPLICATE MESSAGE IS A NO-OP. A step runs only after a conditional lease
 * (`pending`, or `running` past its lease) on its row; a second delivery finds
 * nothing to lease. A delivery that finds the step still leased asks to be
 * redelivered after the lease, which is how a crashed step resumes.
 *
 * RETRIES. A failed attempt's hold is released (never charged) and the next
 * attempt is a new row with a new key, after 30 s and then 120 s; three
 * attempts at most. A refusal at the hold (not enough AI tokens, the member's
 * monthly limit, a pause, a charge in review) and a scope refusal fail the run
 * at once: retrying them would not change the answer.
 *
 * NOTHING IS PUBLISHED WITHOUT AN ACCEPT. A proposal step stops the run at
 * `waiting_accept`; only `acceptFlow` by the run's own member queues the step
 * after it, and `assertRecipe` refuses a recipe whose publish step does not
 * come after a proposal.
 *
 * CANCEL releases every pending hold of the run and closes its open steps. A
 * step already running finds its row closed when it tries to record its
 * output, and its hold, already released, is never charged.
 *
 * SCOPE, AT EVERY STEP. Before each step the runner re-reads the member (an
 * ended account, a deletion request or a "sign out everywhere" after the run
 * began ends the run), re-checks write access to the company (`canWrite`) and
 * re-checks that the step's connection is the member's own and active. The
 * run is the server's: step input and step output never change its member,
 * company, recipe or prices.
 *
 * NO SECRETS. An error is stored as a class from `ERROR_CLASSES`, never as a
 * message, and no log line carries an output, an input or a key.
 *
 * Prices come from `FLOW_POLICY`: the metering policy (D844) plus the demo
 * recipe's stub steps. The real recipes (#2426 PIPE-BUILD, #2430 PIPE-RAISE,
 * #2400 publish) add their prices to `METERING_POLICY` when they ship.
 */
import type { Env, User } from '../types';
import { settleAiReservation } from './aiBudget';
import {
  METERING_POLICY, MeteredRunStopped, MeteringRefused, holdKey, meteredCall, quoteFor,
  type Meter, type MeteringPolicy,
} from './metering';
import { cfQueueEnabled } from './queue';
import { loadUser } from '../mcp/grants';
import { canWrite } from '../routes/_founder_validate_helpers';

export const FLOW_STEP_JOB = 'connector_flow_step';
export const MAX_ATTEMPTS = 3;
/** Seconds before attempt 2 and attempt 3. */
export const RETRY_DELAYS_SECONDS = [30, 120] as const;
export const LEASE_MS = 60_000;
export const STEP_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 64 * 1024;
const INPUT_LIMIT = 16 * 1024;

export type FlowStatus = 'queued' | 'running' | 'waiting_accept' | 'done' | 'failed' | 'cancelled';
export type StepKind = 'trigger' | 'read' | 'map' | 'proposal' | 'publish' | 'result';

/** Every class a step or run can fail with. Never a message. */
export const ERROR_CLASSES = [
  'forbidden', 'insufficient_tokens', 'monthly_limit', 'ai_paused', 'budget_review',
  'timeout', 'error', 'permanent', 'cancelled', 'queue',
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export interface FlowStepContext {
  env: Env;
  runUid: string;
  userId: number;
  companyId: number | null;
  input: unknown;
  /** The outputs of the run's finished steps, by step key. */
  outputs: Record<string, unknown>;
  /** This attempt's key. A step that calls a provider passes it on, so the provider dedupes too. */
  idempotencyKey: string;
  /** Reports the provider's own cost, when it reports one (D844). */
  meter: Meter;
}

export interface RecipeStep {
  key: string;
  kind: StepKind;
  /** The metering operation that prices the step (`FLOW_POLICY`). */
  operation: string;
  /** The provider the step calls, if any; the member's connection to it is re-checked before the step. */
  connector?: string;
  run(ctx: FlowStepContext): Promise<unknown>;
}

export interface Recipe {
  key: string;
  version: number;
  steps: readonly RecipeStep[];
}
export type RecipeBook = Record<string, Recipe>;

/** A step's own failure. `retryable: false` fails the run at once. */
export class FlowStepError extends Error {
  errorClass: 'error' | 'timeout' | 'permanent';
  retryable: boolean;
  constructor(errorClass: 'error' | 'timeout' | 'permanent', retryable = errorClass !== 'permanent') {
    super(`Flow step failed: ${errorClass}`);
    this.errorClass = errorClass;
    this.retryable = retryable;
  }
}

/** A refusal before anything runs: the code is what the caller reads. */
export class FlowRefused extends Error {
  code: string;
  constructor(code: string) { super(`Flow refused: ${code}`); this.code = code; }
}

/** The step's row was closed (a cancel) while it ran. */
class FlowClosed extends Error {}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const RUN_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A recipe the runner will run: well-formed keys, priced steps, and no publish before a proposal. */
export function assertRecipe(recipe: Recipe, policy: MeteringPolicy = FLOW_POLICY): Recipe {
  if (!recipe || !/^[a-z][a-z0-9_.]{0,59}$/.test(recipe.key) || !Number.isInteger(recipe.version) || recipe.version < 1) {
    throw new Error('Flow recipe unreadable');
  }
  if (!recipe.steps.length) throw new Error('Flow recipe has no steps');
  const seen = new Set<string>();
  let proposed = false;
  for (const step of recipe.steps) {
    if (!KEY.test(step.key) || seen.has(step.key)) throw new Error('Flow recipe step key unreadable');
    seen.add(step.key);
    quoteFor(step.operation, 1, policy); // throws for an operation the policy does not price
    if (step.kind === 'proposal') proposed = true;
    if (step.kind === 'publish' && !proposed) throw new Error('Flow recipe publishes before a proposal');
  }
  return recipe;
}

const DEMO_READ = 'flow.demo.read';
const DEMO_MAP = 'flow.demo.map';
const DEMO_PROPOSAL = 'flow.demo.proposal';
const DEMO_PUBLISH = 'flow.demo.publish';
const DEMO_FREE = 'flow.demo.free';

/** The metering policy, plus the demo recipe's stub steps. */
export const FLOW_POLICY: MeteringPolicy = Object.freeze({
  version: METERING_POLICY.version,
  operations: Object.freeze({
    ...METERING_POLICY.operations,
    [DEMO_FREE]: { price_microusd: 0, unit: 'call' },
    [DEMO_READ]: { price_microusd: 0, unit: 'call' },
    [DEMO_MAP]: { price_microusd: 300_000, unit: 'call' },
    [DEMO_PROPOSAL]: { price_microusd: 0, unit: 'call' },
    [DEMO_PUBLISH]: { price_microusd: 200_000, unit: 'call' },
  }),
}) as MeteringPolicy;

/**
 * The one demo recipe, on stubs: nothing leaves the Worker. It stands for
 * Validate → Build → Vercel → back. No route starts it; the real recipes
 * come with #2426 and #2430.
 */
export const DEMO_RECIPE: Recipe = Object.freeze({
  key: 'demo.stub_round_trip',
  version: 1,
  steps: Object.freeze([
    { key: 'trigger', kind: 'trigger', operation: DEMO_FREE, run: async (ctx) => ({ received: ctx.input ?? null }) },
    { key: 'read', kind: 'read', operation: DEMO_READ, connector: 'github',
      run: async () => ({ items: [{ id: 'stub-1', title: 'First stub item' }, { id: 'stub-2', title: 'Second stub item' }] }) },
    { key: 'map', kind: 'map', operation: DEMO_MAP,
      run: async (ctx) => {
        const items = ((ctx.outputs.read as { items?: Array<{ id: string; title: string }> } | undefined)?.items) ?? [];
        return { pages: items.map((i) => ({ slug: i.id, heading: i.title })) };
      } },
    { key: 'proposal', kind: 'proposal', operation: DEMO_PROPOSAL,
      run: async (ctx) => ({ proposal: { pages: ((ctx.outputs.map as { pages?: unknown[] } | undefined)?.pages ?? []).length } }) },
    { key: 'publish', kind: 'publish', operation: DEMO_PUBLISH, connector: 'github',
      run: async (ctx) => ({ published: true, ref: ctx.idempotencyKey }) },
    { key: 'result', kind: 'result', operation: DEMO_FREE,
      run: async (ctx) => ({ done: true, published: (ctx.outputs.publish as { published?: boolean } | undefined)?.published === true }) },
  ] as RecipeStep[]),
});

export const RECIPES: RecipeBook = Object.freeze({ [DEMO_RECIPE.key]: assertRecipe(DEMO_RECIPE) });

function recipeFor(key: string, book: RecipeBook = RECIPES): Recipe {
  const r = Object.prototype.hasOwnProperty.call(book, key) ? book[key] : null;
  if (!r) throw new FlowRefused('unknown_recipe');
  return assertRecipe(r);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface RunRow {
  uid: string; user_id: number; company_id: number | null; recipe_key: string; recipe_version: number;
  status: FlowStatus; execution_id: string; current_step: string | null; input_json: string | null; created_at: string;
}
interface StepRow {
  id: number; run_uid: string; step_key: string; attempt: number; status: 'pending' | 'running' | 'ran' | 'done';
  outcome: string | null; idempotency_key: string; quote_microusd: number | null; cost_microusd: number | null;
  lease_until: string | null;
}

/** The step attempt's key; its hold is `holdKey(execution id, this)`. */
export const stepKey = (runUid: string, step: string, attempt: number) => `flow:${runUid}:${step}:${attempt}`;

const loadRun = (env: Env, uid: string) =>
  env.DB.prepare('SELECT uid, user_id, company_id, recipe_key, recipe_version, status, execution_id, current_step, input_json, created_at FROM connector_flow_runs WHERE uid = ?')
    .bind(uid).first<RunRow>();
const loadStep = (env: Env, runUid: string, step: string, attempt: number) =>
  env.DB.prepare(`SELECT id, run_uid, step_key, attempt, status, outcome, idempotency_key, quote_microusd, cost_microusd, lease_until FROM connector_flow_steps WHERE run_uid = ? AND step_key = ? AND attempt = ?`)
    .bind(runUid, step, attempt).first<StepRow>();
const loadStepById = (env: Env, id: number) =>
  env.DB.prepare(`SELECT id, run_uid, step_key, attempt, status, outcome, idempotency_key, quote_microusd, cost_microusd, lease_until FROM connector_flow_steps WHERE id = ?`).bind(id).first<StepRow>();

const insertStep = (env: Env, runUid: string, step: string, attempt: number, at: string) =>
  env.DB.prepare(`INSERT OR IGNORE INTO connector_flow_steps(run_uid, step_key, attempt, status, idempotency_key, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?)`).bind(runUid, step, attempt, stepKey(runUid, step, attempt), at);

async function priorOutputs(env: Env, runUid: string): Promise<Record<string, unknown>> {
  const r = await env.DB.prepare("SELECT step_key, output_json FROM connector_flow_steps WHERE run_uid = ? AND outcome = 'ok' ORDER BY id")
    .bind(runUid).all<{ step_key: string; output_json: string | null }>();
  const out: Record<string, unknown> = {};
  for (const row of r.results || []) out[row.step_key] = row.output_json == null ? null : JSON.parse(row.output_json);
  return out;
}

function encodeOutput(value: unknown): string {
  const json = JSON.stringify(value === undefined ? null : value);
  if (json == null || json.length > OUTPUT_LIMIT) throw new FlowStepError('permanent');
  return json;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface FlowStepMessage { run_uid: string; step_key: string; attempt: number }

/** One step on JOB_QUEUE. Flows need the Cloudflare queue: without it they fail closed. */
async function sendStep(env: Env, msg: FlowStepMessage, delaySeconds?: number) {
  if (!cfQueueEnabled(env)) throw new FlowRefused('queue');
  await env.JOB_QUEUE!.send(
    { job_type: FLOW_STEP_JOB, payload: msg, idempotency_key: stepKey(msg.run_uid, msg.step_key, msg.attempt) },
    delaySeconds ? { delaySeconds } : undefined,
  );
}

function readMessage(raw: unknown): FlowStepMessage | null {
  const m = raw as Partial<FlowStepMessage> | null;
  if (!m || typeof m !== 'object') return null;
  if (typeof m.run_uid !== 'string' || !RUN_UID.test(m.run_uid)) return null;
  if (typeof m.step_key !== 'string' || !KEY.test(m.step_key)) return null;
  if (!Number.isInteger(m.attempt) || (m.attempt as number) < 1 || (m.attempt as number) > MAX_ATTEMPTS) return null;
  return { run_uid: m.run_uid, step_key: m.step_key, attempt: m.attempt as number };
}

/** What the consumer does with the message. `note` says why, for tests and metrics; it is never shown. */
export type FlowDisposition = { kind: 'ack'; note: string } | { kind: 'retry'; delaySeconds: number; note: string };
const ack = (note: string): FlowDisposition => ({ kind: 'ack', note });
const later = (delaySeconds: number, note: string): FlowDisposition => ({ kind: 'retry', delaySeconds: Math.max(1, Math.ceil(delaySeconds)), note });

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** The member, the company and the connections, re-read. Any miss is `forbidden`. */
async function checkScope(env: Env, run: Pick<RunRow, 'user_id' | 'company_id' | 'created_at'>, connectors: string[]) {
  const user = await loadUser(env, Number(run.user_id));
  if (!user || user.is_active === 0 || user.deletion_requested_at) throw new FlowRefused('forbidden');
  const began = Math.floor(Date.parse(run.created_at) / 1000);
  if (user.jwt_min_iat != null && !(Number(user.jwt_min_iat) <= began)) throw new FlowRefused('forbidden');
  if (run.company_id != null) {
    const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
      .bind(run.company_id).first<{ id: number; founder_id: number | null }>();
    if (!p || !canWrite(p, user as unknown as User)) throw new FlowRefused('forbidden');
  }
  for (const provider of connectors) {
    const c = await env.DB.prepare("SELECT 1 AS ok FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active'")
      .bind(run.user_id, provider).first<{ ok: number }>();
    if (!c) throw new FlowRefused('forbidden');
  }
  return user;
}

// ---------------------------------------------------------------------------
// Starting, accepting, cancelling
// ---------------------------------------------------------------------------

export interface FlowOptions { now?: Date; recipes?: RecipeBook }

/** Start a run: scope checked, the run and its first step written, the first step queued. */
export async function startFlow(env: Env, input: { userId: number; companyId?: number | null; recipeKey: string; input?: unknown }, opts: FlowOptions = {}) {
  const now = opts.now ?? new Date();
  const recipe = recipeFor(input.recipeKey, opts.recipes);
  const company = input.companyId == null ? null : Number(input.companyId);
  if (company != null && (!Number.isInteger(company) || company <= 0)) throw new FlowRefused('invalid_company');
  const inputJson = JSON.stringify(input.input === undefined ? null : input.input);
  if (inputJson == null || inputJson.length > INPUT_LIMIT) throw new FlowRefused('invalid_input');
  const at = now.toISOString();
  const connectors = [...new Set(recipe.steps.map((s) => s.connector).filter((c): c is string => !!c))];
  await checkScope(env, { user_id: input.userId, company_id: company, created_at: at }, connectors);
  const uid = crypto.randomUUID();
  const first = recipe.steps[0].key;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO connector_flow_runs(uid, user_id, company_id, recipe_key, recipe_version, status, execution_id, current_step, input_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`).bind(uid, input.userId, company, recipe.key, recipe.version, `flow-${uid}`, first, inputJson, at, at),
    insertStep(env, uid, first, 1, at),
  ]);
  try {
    await sendStep(env, { run_uid: uid, step_key: first, attempt: 1 });
  } catch (e) {
    await closeRun(env, uid, 'failed', 'queue', at, ['queued']);
    throw e;
  }
  return { uid, status: 'queued' as FlowStatus, execution_id: `flow-${uid}` };
}

/** The founder accepts a proposal: the step after it is queued. Only the run's own member, only at `waiting_accept`. */
export async function acceptFlow(env: Env, userId: number, runUid: string, opts: FlowOptions = {}) {
  const now = opts.now ?? new Date();
  const run = await loadRun(env, runUid);
  if (!run || Number(run.user_id) !== Number(userId)) throw new FlowRefused('not_found');
  if (run.status !== 'waiting_accept') throw new FlowRefused('not_waiting');
  const recipe = recipeFor(run.recipe_key, opts.recipes);
  const at = now.toISOString();
  const idx = recipe.steps.findIndex((s) => s.key === run.current_step);
  const next = idx >= 0 ? recipe.steps[idx + 1] : undefined;
  if (!next) throw new FlowRefused('not_waiting');
  const [moved] = await env.DB.batch([
    env.DB.prepare(`UPDATE connector_flow_runs SET status = 'queued', accepted_at = ?, current_step = ?, updated_at = ?
      WHERE uid = ? AND status = 'waiting_accept'`).bind(at, next.key, at, run.uid),
    env.DB.prepare(`INSERT OR IGNORE INTO connector_flow_steps(run_uid, step_key, attempt, status, idempotency_key, created_at)
      SELECT ?, ?, 1, 'pending', ?, ? WHERE EXISTS (SELECT 1 FROM connector_flow_runs WHERE uid = ? AND status = 'queued' AND accepted_at = ?)`)
      .bind(run.uid, next.key, stepKey(run.uid, next.key, 1), at, run.uid, at),
  ]);
  if (!moved.meta?.changes) throw new FlowRefused('not_waiting');
  await sendStep(env, { run_uid: run.uid, step_key: next.key, attempt: 1 });
  return { uid: run.uid, status: 'queued' as FlowStatus };
}

const likePrefix = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Cancel a run: its open steps close and every pending hold it took is
 * released, never charged. Only the run's own member. A finished run answers
 * with its status and changes nothing.
 */
export async function cancelFlow(env: Env, userId: number, runUid: string, opts: FlowOptions = {}) {
  const now = opts.now ?? new Date();
  const run = await loadRun(env, runUid);
  if (!run || Number(run.user_id) !== Number(userId)) throw new FlowRefused('not_found');
  if (run.status === 'done' || run.status === 'failed') return { uid: run.uid, status: run.status, released: 0 };
  const at = now.toISOString();
  if (run.status !== 'cancelled') await closeRun(env, run.uid, 'cancelled', 'cancelled', at, ['queued', 'running', 'waiting_accept']);
  // A cancelled run still releases what an earlier cancel could not; a hold left pending also expires in five minutes.
  const holds = await env.DB.prepare(`SELECT uid FROM ai_budget_reservations
    WHERE user_id = ? AND status = 'pending' AND idempotency_key LIKE ? ESCAPE '\\'`)
    .bind(run.user_id, `${likePrefix(holdKey(run.execution_id, ''))}%`).all<{ uid: string }>();
  let released = 0;
  for (const h of holds.results || []) {
    try {
      await settleAiReservation(env, { uid: h.uid, userId: run.user_id }, 0, true);
      released += 1;
    } catch {
      console.warn('[flows] cancel could not release a hold', { recipe: run.recipe_key });
    }
  }
  return { uid: run.uid, status: 'cancelled' as FlowStatus, released };
}

/** The run closed, with its open steps; `from` is the statuses it may close from. */
async function closeRun(env: Env, runUid: string, status: 'failed' | 'cancelled', errorClass: ErrorClass, at: string, from: FlowStatus[]) {
  const stepOutcome = status === 'cancelled' ? 'cancelled' : 'failed';
  await env.DB.batch([
    env.DB.prepare(`UPDATE connector_flow_runs SET status = ?, error_class = ?, finished_at = ?, updated_at = ?
      WHERE uid = ? AND status IN (?, ?, ?)`).bind(status, errorClass, at, at, runUid, from[0], from[1] ?? from[0], from[2] ?? from[0]),
    env.DB.prepare(`UPDATE connector_flow_steps SET status = 'done', outcome = ?, error_class = ?, finished_at = ?, lease_until = NULL
      WHERE run_uid = ? AND status IN ('pending', 'running', 'ran')`).bind(stepOutcome, errorClass, at, runUid),
  ]);
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** Re-queue the run's pending steps: a message lost after its row was written is sent again. Each is a no-op if it already ran. */
async function resendPending(env: Env, run: RunRow) {
  if (run.status !== 'queued' && run.status !== 'running') return;
  const r = await env.DB.prepare("SELECT step_key, attempt FROM connector_flow_steps WHERE run_uid = ? AND status = 'pending'")
    .bind(run.uid).all<{ step_key: string; attempt: number }>();
  for (const s of r.results || []) await sendStep(env, { run_uid: run.uid, step_key: s.step_key, attempt: s.attempt });
}

/**
 * Run one step attempt, from its queue message. Never throws for a step's own
 * failure: the answer says whether to ack the message or have it delivered
 * again. It throws only when D1 or the queue cannot be read or written, and
 * the consumer then has the message retried.
 */
export async function runFlowStep(env: Env, raw: unknown, opts: FlowOptions = {}): Promise<FlowDisposition> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const msg = readMessage(raw);
  if (!msg) return ack('unreadable');
  const run = await loadRun(env, msg.run_uid);
  if (!run) return ack('stale');
  let recipe: Recipe;
  try { recipe = recipeFor(run.recipe_key, opts.recipes); } catch { recipe = null as unknown as Recipe; }
  if (!recipe || recipe.version !== Number(run.recipe_version)) {
    await closeRun(env, run.uid, 'failed', 'permanent', at, ['queued', 'running']);
    return ack('recipe_gone');
  }
  const step = recipe.steps.find((s) => s.key === msg.step_key);
  const row = await loadStep(env, msg.run_uid, msg.step_key, msg.attempt);
  if (!step || !row) return ack('stale');
  if (row.status === 'ran') return finishRan(env, recipe, run, step, row, now, opts);
  if (row.status === 'done') { await resendPending(env, run); return ack('duplicate'); }
  if (run.status !== 'queued' && run.status !== 'running') return ack('stale');

  // The lease: only one delivery runs the step.
  const leased = await env.DB.prepare(`UPDATE connector_flow_steps SET status = 'running', lease_until = ?, started_at = COALESCE(started_at, ?)
    WHERE id = ? AND (status = 'pending' OR (status = 'running' AND lease_until < ?))`)
    .bind(new Date(now.getTime() + LEASE_MS).toISOString(), at, row.id, at).run();
  if (!leased.meta?.changes) {
    const cur = await loadStepById(env, row.id);
    if (cur?.status === 'running' && cur.lease_until) return later((Date.parse(cur.lease_until) - now.getTime()) / 1000, 'leased');
    return ack('duplicate');
  }
  const started = await env.DB.prepare(`UPDATE connector_flow_runs SET status = 'running', current_step = ?, updated_at = ?
    WHERE uid = ? AND status IN ('queued', 'running')`).bind(step.key, at, run.uid).run();
  if (!started.meta?.changes) return ack('stale');

  try {
    await checkScope(env, run, step.connector ? [step.connector] : []);
  } catch (e) {
    if (e instanceof FlowRefused) return failRun(env, run, row, 'forbidden', at);
    throw e;
  }
  const quote = quoteFor(step.operation, 1, FLOW_POLICY);
  const outputs = await priorOutputs(env, run.uid);
  const input = run.input_json == null ? null : JSON.parse(run.input_json);

  let usage: { reservation_uid: string | null; charged_microusd: number | null };
  try {
    ({ usage } = await meteredCall(env, {
      userId: run.user_id, executionId: run.execution_id, operation: step.operation, component: row.idempotency_key,
      quoteMicrousd: quote, pricingVersion: FLOW_POLICY.version, timeoutMs: STEP_TIMEOUT_MS, now,
    }, async (meter) => {
      let reported: number | null = null;
      const tracked: Meter = { reportCost(n: number) { meter.reportCost(n); reported = n; } };
      const value = await step.run({
        env, runUid: run.uid, userId: run.user_id, companyId: run.company_id, input, outputs,
        idempotencyKey: row.idempotency_key, meter: tracked,
      });
      // Recorded before the hold settles: a crash from here on resumes in `finishRan`.
      const wrote = await env.DB.prepare(`UPDATE connector_flow_steps SET status = 'ran', output_json = ?, quote_microusd = ?, cost_microusd = ?
        WHERE id = ? AND status = 'running'`).bind(encodeOutput(value), quote, reported ?? quote, row.id).run();
      if (!wrote.meta?.changes) throw new FlowClosed('Flow step closed while it ran');
      return value;
    }));
  } catch (e) {
    const cur = await loadStepById(env, row.id);
    // The work is recorded and only its settlement failed: the redelivery settles it.
    if (cur?.status === 'ran') return later(5, 'settle_pending');
    if (e instanceof FlowClosed || cur?.status === 'done') return ack('closed');
    if (e instanceof MeteringRefused) {
      // The attempt's hold already finished (released after a crash): this attempt is spent; the next takes a new key.
      if (e.code === 'execution_closed') return retryOrFail(env, run, row, 'error', now);
      return failRun(env, run, row, refusalClass(e.code), at);
    }
    if (e instanceof FlowStepError) {
      return e.retryable ? retryOrFail(env, run, row, e.errorClass, now) : failRun(env, run, row, e.errorClass, at);
    }
    if (e instanceof MeteredRunStopped) return retryOrFail(env, run, row, e.reason === 'timeout' ? 'timeout' : 'cancelled', now);
    console.warn('[flows] step failed', { recipe: run.recipe_key, step: step.key, attempt: row.attempt });
    return retryOrFail(env, run, row, 'error', now);
  }
  return finish(env, recipe, run, step, row, usage.reservation_uid, usage.charged_microusd, at);
}

const REFUSAL_CLASSES: Record<string, ErrorClass> = {
  insufficient_tokens: 'insufficient_tokens', monthly_limit: 'monthly_limit', ai_paused: 'ai_paused', budget_review: 'budget_review',
};
const refusalClass = (code: string): ErrorClass => REFUSAL_CLASSES[code] ?? 'insufficient_tokens';

/** The work ran and is recorded: settle its hold if still pending, then move on. */
async function finishRan(env: Env, recipe: Recipe, run: RunRow, step: RecipeStep, row: StepRow, now: Date, _opts: FlowOptions): Promise<FlowDisposition> {
  const at = now.toISOString();
  if (run.status !== 'running' && run.status !== 'queued') return ack('stale');
  const hold = await holdOf(env, run, row);
  let charged: number | null = 0;
  if (hold) {
    if (hold.status === 'pending') {
      try {
        await settleAiReservation(env, { uid: hold.uid, userId: run.user_id }, Number(row.cost_microusd ?? row.quote_microusd ?? 0));
      } catch (e) {
        if (!/exceeds reservation/.test(String((e as Error)?.message))) throw e;
      }
    }
    // Settled: what it charged. In review: unknown. Refunded (expired, or released by a cancel): a known 0.
    const settled = await holdOf(env, run, row);
    charged = settled?.status === 'settled' ? settled.charged : settled?.status === 'review' ? null : 0;
  }
  return finish(env, recipe, run, step, row, hold?.uid ?? null, charged, at);
}

async function holdOf(env: Env, run: RunRow, row: StepRow) {
  return env.DB.prepare(`SELECT uid, status, COALESCE(actual_included_microusd, 0) + COALESCE(actual_topup_microusd, 0) AS charged
    FROM ai_budget_reservations WHERE user_id = ? AND idempotency_key = ?`)
    .bind(run.user_id, holdKey(run.execution_id, row.idempotency_key)).first<{ uid: string; status: string; charged: number }>();
}

/** The step done: the next step queued, the run at `waiting_accept` after a proposal, or the run done. */
async function finish(env: Env, recipe: Recipe, run: RunRow, step: RecipeStep, row: StepRow, reservationUid: string | null, charged: number | null, at: string): Promise<FlowDisposition> {
  const idx = recipe.steps.indexOf(step);
  const next = recipe.steps[idx + 1];
  const stmts = [
    env.DB.prepare(`UPDATE connector_flow_steps SET status = 'done', outcome = 'ok', reservation_uid = ?, charged_microusd = ?, finished_at = ?, lease_until = NULL
      WHERE id = ? AND status = 'ran'`).bind(reservationUid, charged, at, row.id),
  ];
  if (step.kind === 'proposal' && next) {
    stmts.push(env.DB.prepare(`UPDATE connector_flow_runs SET status = 'waiting_accept', updated_at = ? WHERE uid = ? AND status = 'running' AND EXISTS (SELECT 1 FROM connector_flow_steps WHERE id = ? AND outcome = 'ok')`)
      .bind(at, run.uid, row.id));
  } else if (next) {
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO connector_flow_steps(run_uid, step_key, attempt, status, idempotency_key, created_at)
      SELECT ?, ?, 1, 'pending', ?, ? WHERE EXISTS (SELECT 1 FROM connector_flow_steps WHERE id = ? AND outcome = 'ok') AND EXISTS (SELECT 1 FROM connector_flow_runs WHERE uid = ? AND status = 'running')`)
      .bind(run.uid, next.key, stepKey(run.uid, next.key, 1), at, row.id, run.uid));
    stmts.push(env.DB.prepare(`UPDATE connector_flow_runs SET current_step = ?, updated_at = ? WHERE uid = ? AND status = 'running' AND EXISTS (SELECT 1 FROM connector_flow_steps WHERE id = ? AND outcome = 'ok')`)
      .bind(next.key, at, run.uid, row.id));
  } else {
    stmts.push(env.DB.prepare(`UPDATE connector_flow_runs SET status = 'done', result_json = (SELECT output_json FROM connector_flow_steps WHERE id = ?),
      finished_at = ?, updated_at = ? WHERE uid = ? AND status = 'running' AND EXISTS (SELECT 1 FROM connector_flow_steps WHERE id = ? AND outcome = 'ok')`).bind(row.id, at, at, run.uid, row.id));
  }
  const [closed] = await env.DB.batch(stmts);
  if (!closed.meta?.changes) return ack('closed');
  if (step.kind === 'proposal' && next) return ack('waiting_accept');
  if (!next) return ack('finished');
  await sendStep(env, { run_uid: run.uid, step_key: next.key, attempt: 1 });
  return ack('next');
}

/** The run failed at this step. The step's hold, if any, was already released by `meteredCall`. */
async function failRun(env: Env, run: RunRow, row: StepRow, errorClass: ErrorClass, at: string): Promise<FlowDisposition> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE connector_flow_steps SET status = 'done', outcome = 'failed', error_class = ?, finished_at = ?, lease_until = NULL
      WHERE id = ? AND status IN ('pending', 'running')`).bind(errorClass, at, row.id),
    env.DB.prepare(`UPDATE connector_flow_runs SET status = 'failed', error_class = ?, finished_at = ?, updated_at = ?
      WHERE uid = ? AND status IN ('queued', 'running')`).bind(errorClass, at, at, run.uid),
  ]);
  return ack('failed');
}

/** This attempt failed: the next one is queued with backoff, or the run fails after the last. */
async function retryOrFail(env: Env, run: RunRow, row: StepRow, errorClass: ErrorClass, now: Date): Promise<FlowDisposition> {
  const at = now.toISOString();
  if (row.attempt >= MAX_ATTEMPTS) return failRun(env, run, row, errorClass, at);
  const nextAttempt = row.attempt + 1;
  const [closed] = await env.DB.batch([
    env.DB.prepare(`UPDATE connector_flow_steps SET status = 'done', outcome = 'failed', error_class = ?, finished_at = ?, lease_until = NULL
      WHERE id = ? AND status IN ('pending', 'running')`).bind(errorClass, at, row.id),
    env.DB.prepare(`INSERT OR IGNORE INTO connector_flow_steps(run_uid, step_key, attempt, status, idempotency_key, created_at)
      SELECT ?, ?, ?, 'pending', ?, ? WHERE EXISTS (SELECT 1 FROM connector_flow_runs WHERE uid = ? AND status = 'running')`)
      .bind(run.uid, row.step_key, nextAttempt, stepKey(run.uid, row.step_key, nextAttempt), at, run.uid),
  ]);
  if (!closed.meta?.changes) return ack('closed');
  await sendStep(env, { run_uid: run.uid, step_key: row.step_key, attempt: nextAttempt }, RETRY_DELAYS_SECONDS[row.attempt - 1]);
  return ack('retrying');
}
