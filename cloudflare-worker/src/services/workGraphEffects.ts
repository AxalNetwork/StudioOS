/**
 * D5581 part 3 (#5581, WorkGraph under the #5577 epic) — the bounded WorkGraph effect outbox in D1
 * (`work_graph_effects`): what follows a WorkGraph write (a re-render of an invalidated output, a notice, an export)
 * is recorded as one row per effect, unique per (tenant, company, idempotency key), and applied later by a drain.
 * Decision: `documentation/architecture/decisions/D5581-p3.md`.
 *
 * EXACTLY-ONCE EFFECTS, NOT EXACTLY-ONCE DELIVERY. A delivery may come twice, late, or after a worker died; nothing
 * here claims otherwise. What holds is that an effect is APPLIED at most once by its key:
 *   - a delivery claims the row first (a conditional UPDATE with a fresh claim token and a lapse time), so two
 *     deliveries never run one effect together, and a lapsed claim (a dead worker) can be taken over;
 *   - D1 statements a handler returns commit in ONE batch with the `applied` mark, and that batch aborts (a NOT NULL
 *     audit column fed by `changes()`) unless this delivery still holds the claim, so they land once or not at all;
 *   - `applied` and `dead` are terminal (trigger), so a second delivery after success does nothing;
 *   - a handler with an effect outside D1 receives the idempotency key and must make its write conditional on it.
 *
 * BOUNDED. At most `maxPendingPerTenant` pending or claimed effects per tenant (`queue_full`, held inside the insert);
 * a drain takes at most `drainMax`. A failure backs off exponentially; after `maxAttempts` the effect is `dead`
 * (the dead-letter state), kept for a person to read. Every outcome is a `work_graph_integrity_events` row.
 *
 * WHY NOT A CLOUDFLARE QUEUE. `JOB_QUEUE` and `AGENT_QUEUE` deliver at least once and are consumed in `index.ts`'s
 * `queue()` (a frozen hub, D5615); neither has a per-tenant cap or an idempotency key per effect. A queue message can
 * later carry an effect id to `deliverEffect` with no change here.
 */
import type { Env } from '../types';
import { sha256Hex, type Actor, type Scope, type ValidationContext } from './workGraphContracts';
import { Spend, WORK_GRAPH_BLOB_DEPS, actorOk, outOfScope, type BlobCost, type BlobRefusal } from './workGraphBlobs';

export const WORK_GRAPH_EFFECT_LIMITS = Object.freeze({
  maxPendingPerTenant: 1_000,
  maxAttempts: 5,
  baseBackoffMs: 30_000,
  maxBackoffMs: 60 * 60_000,
  /** How long a delivery holds its claim before another may take the effect over. */
  claimMs: 2 * 60_000,
  drainMax: 50,
  maxPayloadChars: 2_000,
});
export type WorkGraphEffectLimits = typeof WORK_GRAPH_EFFECT_LIMITS;

/** The claim token source, swappable in tests. The clock is `WORK_GRAPH_BLOB_DEPS.now`. */
export const WORK_GRAPH_EFFECT_DEPS = { newToken: (): string => crypto.randomUUID() };

export type EffectRefusalCode = 'malformed' | 'wrong_tenant' | 'queue_full' | 'idempotency_conflict' | 'not_found';
export type EffectRefusal = BlobRefusal<EffectRefusalCode>;

/** Ids, numbers and flags only: an effect names what to act on, never content. */
export type EffectPayload = Record<string, string | number | boolean | null>;

export interface EnqueueEffectInput {
  scope: Scope;
  assetUid?: string | null;
  kind: string;
  idempotencyKey: string;
  payload: EffectPayload;
  actor: Actor;
}
export type EnqueueEffectResult = { ok: true; effectId: number; replayed: boolean; cost: BlobCost } | EffectRefusal;

const KIND = /^[a-z_]{1,40}$/;
const keyOk = (k: unknown): k is string => typeof k === 'string' && k.length >= 1 && k.length <= 200;

function payloadOk(p: unknown, max: number): p is EffectPayload {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (k.length > 40) return false;
    if (!(v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 200))) return false;
  }
  return JSON.stringify(p).length <= max;
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

function effectAudit(env: Pick<Env, 'DB'>, e: {
  tenantId: number; companyId: number; assetUid: string | null; effectId: number | null; action: string;
  outcome: 'applied' | 'refused' | 'flagged'; refusalCode?: string | null; actor?: Actor | null; detail?: Record<string, unknown> | null; d1: number; at: string;
}): D1PreparedStatement {
  const a = e.actor ?? null;
  return env.DB.prepare(
    `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, effect_id, action, outcome, refusal_code,
       actor_kind, actor_user_id, agent_run_id, detail_json, d1_statements, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(e.tenantId, e.companyId, e.assetUid, e.effectId, e.action, e.outcome, e.refusalCode ?? null,
    a ? a.kind : 'system', a ? (a.kind === 'person' ? a.userId : a.onBehalfOfUserId) : null, a && a.kind === 'agent' ? a.agentRunId : null,
    e.detail ? JSON.stringify(e.detail) : null, e.d1, e.at);
}

/** Record an effect to apply later. A retry with the same key and payload returns the first effect. */
export async function enqueueEffect(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: EnqueueEffectInput, limits: WorkGraphEffectLimits = WORK_GRAPH_EFFECT_LIMITS,
): Promise<EnqueueEffectResult> {
  const s = new Spend(env);
  if (!input?.scope || !keyOk(input.idempotencyKey) || typeof input.kind !== 'string' || !KIND.test(input.kind)
    || !actorOk(input.actor) || !payloadOk(input.payload, limits.maxPayloadChars)
    || (input.assetUid != null && (typeof input.assetUid !== 'string' || input.assetUid.length > 80))) {
    return s.refuse('malformed', [], null);
  }
  const { tenantId, companyId } = input.scope;
  const base = { tenantId, companyId, assetUid: input.assetUid ?? null, actor: input.actor, action: 'effect_refused' };
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !Number.isSafeInteger(companyId) || companyId <= 0) return s.refuse('malformed', [], null);
  if (outOfScope(ctx, input.scope, 'restricted')) return s.refuse('wrong_tenant', [], base);

  const hash = await sha256Hex(new TextEncoder().encode(canonical({ kind: input.kind, asset: input.assetUid ?? null, payload: input.payload })));
  const now = WORK_GRAPH_BLOB_DEPS.now();
  const at = now.toISOString();
  const payload = canonical(input.payload);
  const res = await s.batch([
    env.DB.prepare(
      `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json,
         max_attempts, next_attempt_ms, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM work_graph_effects WHERE tenant_id = ? AND state IN ('pending', 'claimed')) < ?
       ON CONFLICT (tenant_id, company_id, idempotency_key) DO NOTHING`,
    ).bind(tenantId, companyId, input.assetUid ?? null, input.kind, input.idempotencyKey, hash, payload,
      limits.maxAttempts, now.getTime(), at, tenantId, limits.maxPendingPerTenant),
    env.DB.prepare(
      `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, effect_id, action, outcome, actor_kind,
         actor_user_id, agent_run_id, d1_statements, created_at)
       SELECT ?, ?, ?, last_insert_rowid(), 'effect_enqueued', 'applied', ?, ?, ?, ?, ? WHERE changes() > 0`,
    ).bind(tenantId, companyId, input.assetUid ?? null, input.actor.kind,
      input.actor.kind === 'person' ? input.actor.userId : input.actor.onBehalfOfUserId,
      input.actor.kind === 'agent' ? input.actor.agentRunId : null, s.cost.d1Statements + 2, at),
  ]);
  const prior = await s.first<{ id: number; request_hash: string }>(env.DB.prepare(
    'SELECT id, request_hash FROM work_graph_effects WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(tenantId, companyId, input.idempotencyKey));
  if (Number(res[0]?.meta?.changes ?? 0) > 0) return { ok: true, effectId: Number(prior?.id), replayed: false, cost: { ...s.cost } };
  if (!prior) return s.refuse('queue_full', [String(limits.maxPendingPerTenant)], base);
  if (prior.request_hash !== hash) return s.refuse('idempotency_conflict', [String(prior.id)], { ...base, effectId: prior.id });
  return { ok: true, effectId: prior.id, replayed: true, cost: { ...s.cost } };
}

export interface EffectContext {
  id: number; scope: Pick<Scope, 'tenantId' | 'companyId'>; assetUid: string | null; kind: string;
  idempotencyKey: string; payload: EffectPayload; attempt: number;
}
/**
 * Applies one effect. D1 statements it returns commit with the `applied` mark, once. Anything it does outside D1 must
 * be keyed on `idempotencyKey`. Throwing (optionally with a `code` of `[a-z_]` letters) schedules a retry.
 */
export type EffectHandler = (effect: EffectContext, env: Pick<Env, 'DB'>) => Promise<D1PreparedStatement[] | void>;

export type DeliveryStatus = 'applied' | 'already_applied' | 'retry' | 'dead' | 'busy' | 'not_due' | 'not_found';
export interface DeliveryResult { effectId: number; status: DeliveryStatus; attempts?: number; nextAttemptMs?: number; cost: BlobCost }

interface EffectRow {
  id: number; tenant_id: number; company_id: number; asset_uid: string | null; effect_kind: string; idempotency_key: string;
  payload_json: string; state: string; attempts: number; max_attempts: number; next_attempt_ms: number; claimed_until_ms: number | null;
}

export function backoffMs(attempts: number, limits: WorkGraphEffectLimits = WORK_GRAPH_EFFECT_LIMITS): number {
  return Math.min(limits.maxBackoffMs, limits.baseBackoffMs * 2 ** Math.max(0, attempts - 1));
}

const errorCode = (e: unknown): string => {
  const c = (e as { code?: unknown })?.code;
  return typeof c === 'string' && /^[a-z_]{1,60}$/.test(c) ? c : 'handler_error';
};

/**
 * One delivery of one effect: what a queue consumer or the drain does with an effect id. Safe to call twice, late or
 * concurrently: only the delivery holding the claim applies it, and an applied effect is never applied again.
 */
export async function deliverEffect(
  env: Pick<Env, 'DB'>, handlers: Readonly<Record<string, EffectHandler>>, effectId: number,
  limits: WorkGraphEffectLimits = WORK_GRAPH_EFFECT_LIMITS,
): Promise<DeliveryResult> {
  const s = new Spend(env);
  const done = (status: DeliveryStatus, extra: Partial<DeliveryResult> = {}): DeliveryResult => ({ effectId, status, ...extra, cost: { ...s.cost } });
  if (!Number.isSafeInteger(effectId) || effectId <= 0) return done('not_found');
  const row = await s.first<EffectRow>(env.DB.prepare(
    `SELECT id, tenant_id, company_id, asset_uid, effect_kind, idempotency_key, payload_json, state, attempts, max_attempts,
            next_attempt_ms, claimed_until_ms FROM work_graph_effects WHERE id = ?`,
  ).bind(effectId));
  if (!row) return done('not_found');
  if (row.state === 'applied') return done('already_applied', { attempts: row.attempts });
  if (row.state === 'dead') return done('dead', { attempts: row.attempts });
  const now = WORK_GRAPH_BLOB_DEPS.now();
  const t = now.getTime();
  if (row.state === 'claimed' && Number(row.claimed_until_ms) > t) return done('busy', { attempts: row.attempts });
  if (row.state === 'pending' && row.next_attempt_ms > t) return done('not_due', { attempts: row.attempts, nextAttemptMs: row.next_attempt_ms });

  const token = WORK_GRAPH_EFFECT_DEPS.newToken();
  const claim = await s.run(env.DB.prepare(
    `UPDATE work_graph_effects SET state = 'claimed', claim_token = ?, claimed_until_ms = ?, attempts = attempts + 1
      WHERE id = ? AND ((state = 'pending' AND next_attempt_ms <= ?) OR (state = 'claimed' AND claimed_until_ms <= ?))`,
  ).bind(token, t + limits.claimMs, effectId, t, t));
  if (!Number(claim.meta?.changes ?? 0)) return done('busy');
  const attempt = row.attempts + 1;
  const at = now.toISOString();
  const ev = { tenantId: row.tenant_id, companyId: row.company_id, assetUid: row.asset_uid, effectId, at };

  let statements: D1PreparedStatement[] = [];
  let failure: string | null = null;
  const handler = handlers[row.effect_kind];
  if (!handler) failure = 'no_handler';
  else {
    try {
      statements = (await handler({
        id: effectId, scope: { tenantId: row.tenant_id, companyId: row.company_id }, assetUid: row.asset_uid, kind: row.effect_kind,
        idempotencyKey: row.idempotency_key, payload: JSON.parse(row.payload_json) as EffectPayload, attempt,
      }, env)) ?? [];
    } catch (e) {
      failure = errorCode(e);
    }
  }

  if (failure === null) {
    try {
      await s.batch([
        env.DB.prepare(
          `UPDATE work_graph_effects SET state = 'applied', applied_at = ?, claim_token = NULL, claimed_until_ms = NULL, last_error_code = NULL
            WHERE id = ? AND state = 'claimed' AND claim_token = ?`,
        ).bind(at, effectId, token),
        // Aborts the whole batch (outcome is NOT NULL) unless the mark above changed the row: a delivery that lost
        // its claim commits none of the handler's statements.
        env.DB.prepare(
          `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, effect_id, action, outcome, actor_kind,
             detail_json, d1_statements, created_at)
           VALUES (?, ?, ?, ?, 'effect_applied', CASE WHEN changes() > 0 THEN 'applied' END, 'system', ?, ?, ?)`,
        ).bind(row.tenant_id, row.company_id, row.asset_uid, effectId, JSON.stringify({ attempt, statements: statements.length }),
          s.cost.d1Statements + 2 + statements.length, at),
        ...statements,
      ]);
      return done('applied', { attempts: attempt });
    } catch {
      // Lost the claim (it lapsed and another delivery took over), or a handler statement failed: nothing committed.
      const again = await s.first<{ state: string; claim_token: string | null }>(env.DB.prepare(
        'SELECT state, claim_token FROM work_graph_effects WHERE id = ?',
      ).bind(effectId));
      if (again?.state === 'applied') return done('already_applied', { attempts: attempt });
      if (again?.claim_token !== token) return done('busy', { attempts: attempt });
      failure = 'statement_failed';
    }
  }

  const dead = attempt >= row.max_attempts;
  const next = t + backoffMs(attempt, limits);
  await s.batch([
    dead
      ? env.DB.prepare(
        `UPDATE work_graph_effects SET state = 'dead', claim_token = NULL, claimed_until_ms = NULL, last_error_code = ?
          WHERE id = ? AND state = 'claimed' AND claim_token = ?`,
      ).bind(failure, effectId, token)
      : env.DB.prepare(
        `UPDATE work_graph_effects SET state = 'pending', claim_token = NULL, claimed_until_ms = NULL, next_attempt_ms = ?, last_error_code = ?
          WHERE id = ? AND state = 'claimed' AND claim_token = ?`,
      ).bind(next, failure, effectId, token),
    effectAudit(env, { ...ev, action: dead ? 'effect_dead' : 'effect_retry', outcome: 'flagged', detail: { attempt, error: failure, ...(dead ? {} : { next_attempt_ms: next }) }, d1: s.cost.d1Statements + 2 }),
  ]);
  return dead ? done('dead', { attempts: attempt }) : done('retry', { attempts: attempt, nextAttemptMs: next });
}

/** Deliver what is due (pending past its backoff, or claimed with a lapsed claim), oldest first, at most `drainMax`. */
export async function drainEffects(
  env: Pick<Env, 'DB'>, handlers: Readonly<Record<string, EffectHandler>>, opts: { limit?: number } = {},
  limits: WorkGraphEffectLimits = WORK_GRAPH_EFFECT_LIMITS,
): Promise<{ results: DeliveryResult[]; cost: BlobCost }> {
  const s = new Spend(env);
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? limits.drainMax)), limits.drainMax);
  const t = WORK_GRAPH_BLOB_DEPS.now().getTime();
  const due = await s.all<{ id: number }>(env.DB.prepare(
    `SELECT id FROM work_graph_effects
      WHERE (state = 'pending' AND next_attempt_ms <= ?) OR (state = 'claimed' AND claimed_until_ms <= ?)
      ORDER BY next_attempt_ms, id LIMIT ?`,
  ).bind(t, t, limit));
  const results: DeliveryResult[] = [];
  for (const d of due) {
    const r = await deliverEffect(env, handlers, d.id, limits);
    results.push(r);
    for (const k of ['d1Statements', 'd1Batches', 'r2ClassA', 'r2ClassB'] as const) s.cost[k] += r.cost[k];
  }
  return { results, cost: { ...s.cost } };
}

/** An effect's state, by its key, for its own tenant and company only. */
export async function effectStatus(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: { scope: Scope; idempotencyKey: string },
): Promise<{ ok: true; effectId: number; state: string; attempts: number; lastErrorCode: string | null; cost: BlobCost } | EffectRefusal> {
  const s = new Spend(env);
  if (!input?.scope || !keyOk(input.idempotencyKey)) return s.refuse('malformed', [], null);
  if (outOfScope(ctx, input.scope, 'restricted')) {
    return s.refuse('wrong_tenant', [], { tenantId: input.scope.tenantId, companyId: input.scope.companyId, action: 'effect_refused', system: true });
  }
  const r = await s.first<{ id: number; state: string; attempts: number; last_error_code: string | null }>(env.DB.prepare(
    'SELECT id, state, attempts, last_error_code FROM work_graph_effects WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(input.scope.tenantId, input.scope.companyId, input.idempotencyKey));
  if (!r) return s.refuse('not_found', [], null);
  return { ok: true, effectId: r.id, state: r.state, attempts: r.attempts, lastErrorCode: r.last_error_code, cost: { ...s.cost } };
}
