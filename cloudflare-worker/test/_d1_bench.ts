/**
 * #4567 (D1 scale S1) — the isolated, reproducible D1 contention benchmark.
 *
 * WHAT IT RUNS. The Worker's own services, unmodified, over a throwaway
 * database built from the actual migrations (`_storage_schema.ts`), with
 * foreign keys on as D1 enforces them, seeded with #4566's synthetic-only
 * fixtures (`scripts/lib/agentSyntheticFixtures.mjs`): every row `syn-<run>-`,
 * every person at `synthetic.invalid`. Inference is a deterministic stub
 * (`env.AI`), there is no queue, no Workflow and no network, and nothing here
 * can reach a hosted database: the D1 binding is node:sqlite in this process.
 *
 * WHAT IT MEASURES. Every statement each operation issues, through a metering
 * D1 binding: its SQL fingerprint (placeholders and literals masked, never a
 * bind value), read or write, rows changed, wall time, and whether it ran in a
 * batch. Per fingerprint, the query plan (`EXPLAIN QUERY PLAN`) and the index
 * count of a written table, so read/write and index-write amplification are
 * measured from the code that runs, not inferred from its steps.
 *
 * WHAT IT CANNOT CLAIM. node:sqlite in one process is serial like D1, but its
 * latency is a local file's, not D1's (no network, no Durable Object hop, no
 * replication), and it reports no `rows_read`. Latencies here are RELATIVE:
 * they rank fingerprints and show how a mix degrades as it ramps. They are
 * never a D1 capacity figure. Every report says so (`class: 'simulated'`).
 *
 * MIXES (#4567): A normal user reads, B an AI hold/settle with its usage rows
 * (`aiRouter.run`), C an agent run end to end (admission → running →
 * `agentRun` → waiting decision → accept → done), D proposal reads, E failures
 * and retries (a duplicate idempotency key raced, a provider failure, a
 * replayed agent step, and a cross-tenant attempt).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { migratedDatabase } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { GUARD_MODEL } from './_guard_stub.mjs';
import { __resetForTest, run as aiRun } from '../src/services/aiRouter.ts';
import { loadAiBudget, memberHolds } from '../src/services/aiBudget.ts';
import { agentRun } from '../src/services/agents/agentRun.ts';
import { admitInScope, markRun, moveTask } from '../src/agents/engine.ts';
import { decideRail, listRail } from '../src/services/railProposals.ts';
import { after, type LoopDeps } from '../src/agents/loop.ts';
import { READERS } from '../src/services/agents/reads.ts';
import { seedStatements, SYNTHETIC_DOMAIN, SYNTHETIC_MODULE, SYNTHETIC_OPTION } from '../../scripts/lib/agentSyntheticFixtures.mjs';

export const MIX_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;
export type MixKey = (typeof MIX_KEYS)[number];
export type Mix = Partial<Record<MixKey, number>>;
/** A balanced default: mostly reads, then money, then agents, then failures. */
export const DEFAULT_MIX: Mix = { A: 30, B: 25, C: 20, D: 15, E: 10 };
/** The local ceilings. A request over one is refused, never trimmed. */
export const BENCH_LIMITS = Object.freeze({ tenants: 1000, ops: 20_000, seconds: 600, rate: 1000 });
const RAIL = { page: 'Founder · Build', option: SYNTHETIC_OPTION };
const FAIL_MARK = 'synthetic-provider-failure';

// ── The metering D1 binding ────────────────────────────────────────────────

type OpCtx = { kind: string; stmts: number; reads: number; writes: number; batches: number; stages: Record<string, number> };
/**
 * The execution stage a statement belongs to, by the table it names first.
 * A coarse map, stated so a reader can check it: the reservation tables are
 * the hold and its settlement, `ai_usage_logs` is usage, the plan tables are
 * who may spend, the policy tables are the platform's switches.
 */
export const STAGE_OF_TABLE: Record<string, string> = {
  ai_budget_reservations: 'hold_settle', ai_included_spend: 'hold_settle', ai_topup_accounts: 'hold_settle', ai_credit_ledger: 'hold_settle',
  member_ai_spend_limits: 'hold_settle', member_ai_pauses: 'hold_settle', member_ai_caps: 'hold_settle',
  ai_usage_logs: 'usage',
  users: 'plan', member_subscription_amounts: 'plan', mi_pro_subscriptions: 'plan', account_subscriptions: 'plan', ai_licence_caps: 'plan',
  feature_flags: 'policy', ai_model_policy: 'policy', ai_model_locks: 'policy', ai_agent_policy: 'policy', ai_rail_preferences: 'policy',
  team_allowlists: 'policy', agent_skill_links: 'policy', agent_skill_versions: 'policy', team_rule_versions: 'policy',
  agent_task_runs: 'run', scope_tasks: 'run', scope_task_events: 'run', agent_scope_settings: 'run', team_agents: 'run', team_agent_events: 'run',
  agent_memory_notes: 'run', scope_task_deps: 'run', activity_logs: 'run',
  ai_rail_proposals: 'proposal',
  projects: 'access', company_profiles: 'access', user_company_links: 'access', project_members: 'access',
};
const readTable = (sql: string) => sql.match(/\bFROM\s+(\w+)/i)?.[1] ?? null;
export type FingerprintStat = { fp: string; kind: 'read' | 'write'; n: number; ms: number; changes: number; inBatch: number; ops: Set<string>; sql: string };

const WRITE_RE = /^\s*(?:WITH\b[\s\S]*?\b)?(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const writtenTable = (sql: string) => sql.match(/^\s*(?:WITH\b[\s\S]*?\b)?(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|REPLACE\s+INTO)\s+(\w+)/i)?.[1] ?? null;
/** A statement's fingerprint: whitespace folded, every literal masked. It never holds a bind value. */
export function fingerprint(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/'(?:[^']|'')*'/g, "'?'").replace(/\b\d+\b/g, 'N').trim();
}

export class Meter {
  als = new AsyncLocalStorage<OpCtx>();
  stats = new Map<string, FingerprintStat>();
  /** Writes a CHECK constraint refused, by table: a balance that would go below zero shows here, since the schema never stores one. */
  checkFailures = new Map<string, number>();
  failed(sql: string, e: unknown) {
    if (!/CHECK constraint failed/i.test(String((e as Error)?.message ?? e))) return;
    const table = writtenTable(sql) ?? 'unknown';
    this.checkFailures.set(table, (this.checkFailures.get(table) ?? 0) + 1);
  }
  record(sql: string, ms: number, changes: number, inBatch: boolean) {
    const fp = fingerprint(sql);
    const kind = WRITE_RE.test(sql) ? 'write' : 'read';
    const s = this.stats.get(fp) ?? { fp, kind, n: 0, ms: 0, changes: 0, inBatch: 0, ops: new Set<string>(), sql } as FingerprintStat;
    s.n++; s.ms += ms; s.changes += changes; if (inBatch) s.inBatch++;
    const ctx = this.als.getStore();
    if (ctx) {
      s.ops.add(ctx.kind); ctx.stmts++; if (kind === 'write') ctx.writes++; else ctx.reads++;
      const stage = STAGE_OF_TABLE[(kind === 'write' ? writtenTable(sql) : readTable(sql)) ?? ''] ?? 'other';
      ctx.stages[stage] = (ctx.stages[stage] ?? 0) + 1;
    }
    this.stats.set(fp, s);
  }
  wrap(base: any) {
    const meter = this;
    // node:sqlite runs the statement synchronously inside the call, so the time to the returned promise is the
    // statement's own; awaiting it would add whatever other operations ran in between.
    const timed = async (sql: string, f: () => Promise<any>) => {
      const t = performance.now();
      const p = f();
      const ms = performance.now() - t;
      let r: any;
      try { r = await p; } catch (e) { meter.failed(sql, e); throw e; }
      meter.record(sql, ms, Number(r?.meta?.changes ?? 0), false);
      return r;
    };
    return {
      prepare(sql: string) {
        const st = base.prepare(sql);
        const api: any = {
          bind(...a: unknown[]) { st.bind(...a); return api; },
          all: () => timed(sql, () => st.all()),
          first: (col?: string) => timed(sql, () => st.first(col)),
          run: () => timed(sql, () => st.run()),
          runSync: () => {
            const t = performance.now();
            let r: any;
            try { r = st.runSync(); } catch (e) { meter.failed(sql, e); throw e; }
            meter.record(sql, performance.now() - t, Number(r?.meta?.changes ?? 0), true);
            return r;
          },
        };
        return api;
      },
      async batch(stmts: any[]) { const c = meter.als.getStore(); if (c) c.batches++; return base.batch(stmts); },
      exec: (sql: string) => base.exec(sql),
    };
  }
}

// ── The world ──────────────────────────────────────────────────────────────

export type Tenant = { i: number; userId: number; projectId: number; agents: { id: number; tasks: number }[] };
export type World = { db: any; env: any; meter: Meter; tenants: Tenant[]; run: string; nextTask: number; aiCalls: number };

/** A run id per ten tenants, since #4566's seed caps one id at ten. All share the `syn-` mark. */
const chunkRun = (base: string, c: number) => `${base}${c.toString(36).padStart(4, '0')}`;

export function benchWorld(o: { tenants: number; agentsPerTenant?: number; run?: string }): World {
  const tenants = o.tenants, agents = o.agentsPerTenant ?? 1, base = o.run ?? 'bench';
  if (!Number.isSafeInteger(tenants) || tenants < 1 || tenants > BENCH_LIMITS.tenants) throw new Error(`tenants must be 1 to ${BENCH_LIMITS.tenants}`);
  if (!/^[a-z]{4,8}$/.test(base)) throw new Error('run base must be 4–8 lowercase letters');
  __resetForTest();
  const db = migratedDatabase();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('BEGIN');
  for (let c = 0; c * 10 < tenants; c++) {
    for (const s of seedStatements({ run: chunkRun(base, c), tenants: Math.min(10, tenants - c * 10), agentsPerTenant: agents, tasksPerAgent: 1 })) db.prepare(s.sql).run(...s.args);
  }
  // A paid Founder plan (agents need one) and its allowance, for synthetic people only.
  const mine = `email LIKE 'syn-${base}%@${SYNTHETIC_DOMAIN}'`;
  db.exec(`UPDATE users SET subscription_tier = 'growth', subscription_status = 'active' WHERE ${mine}`);
  db.exec(`INSERT INTO member_subscription_amounts (subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
    SELECT 'sub_syn_' || id, id, 'founder', 20000, 'usd', 'month', 1, 'active' FROM users WHERE ${mine}`);
  // Every fourth tenant has no included allowance, so its runs draw on the top-up balance and the ledger's triggers run (D755).
  db.exec(`INSERT INTO member_ai_caps (user_id, monthly_microusd, set_by) SELECT id, 0, id FROM users WHERE ${mine} AND (id % 4) = 3`);
  db.exec('COMMIT');
  const people = db.prepare(`SELECT u.id AS userId, p.id AS projectId FROM users u JOIN founders f ON f.id = u.founder_id JOIN projects p ON p.founder_id = f.id WHERE u.${mine} ORDER BY u.id`).all() as any[];
  const list: Tenant[] = people.map((p, i) => ({
    i, userId: Number(p.userId), projectId: Number(p.projectId),
    agents: (db.prepare('SELECT id FROM team_agents WHERE project_id = ? ORDER BY id').all(p.projectId) as any[]).map((a) => ({ id: Number(a.id), tasks: 0 })),
  }));
  const meter = new Meter();
  const w: World = { db, meter, tenants: list, run: base, nextTask: 0, aiCalls: 0, env: null };
  const kv = new Map<string, string>();
  w.env = {
    DB: meter.wrap(d1Over(db)), ENVIRONMENT: 'development', JWT_SECRET: 'bench-fixture-only-value',
    // Local only: this env object never leaves the process. Production's switches are untouched (#4566's static check).
    TEAM_AGENTS_ENABLED: 'true', AGENT_ENGINE: 'on',
    RATE_LIMITS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
    // The Workflow's `decision` event runs the loop's real `after` step, as `runTaskLoop` does; the scope object's tracking is a no-op.
    AGENT_TASK: { get: async (id: string) => ({ sendEvent: async (ev: { payload: any }) => { await after(loopDeps(w), id, ev.payload); } }) },
    AI: { run: async (model: string, input: any) => {
      if (model === GUARD_MODEL) return { response: 'safe', usage: { prompt_tokens: 0, completion_tokens: 0 } };
      w.aiCalls++;
      if (JSON.stringify(input ?? '').includes(FAIL_MARK)) throw Object.assign(new Error('synthetic 503'), { status: 503 });
      return { response: 'A synthetic answer.', usage: { prompt_tokens: 40, completion_tokens: 10 } };
    } },
  };
  return w;
}

const loopDeps = (w: World): LoopDeps => ({ env: w.env, agentRun, readers: READERS, runtime: async () => { throw new Error('no runtime in the bench'); }, track: async () => {}, now: () => new Date() } as any);

/** A fresh open task for an agent, with the run's mark, so C never runs dry. */
function freshTask(w: World, t: Tenant, agentId: number): number {
  const uid = `syn-${chunkRun(w.run, 0)}-x-t${t.i}-a${agentId}-k${++w.nextTask}`;
  w.db.prepare(`INSERT INTO scope_tasks (uid, scope_kind, project_id, title, module, option, assignee_kind, assignee_agent_id, status, board_column, created_by_user_id)
    VALUES (?, 'project', ?, 'Synthetic task', ?, ?, 'agent', ?, 'open', 'ready', ?)`).run(uid, t.projectId, SYNTHETIC_MODULE, SYNTHETIC_OPTION, agentId, t.userId);
  return Number((w.db.prepare('SELECT id FROM scope_tasks WHERE uid = ?').get(uid) as any).id);
}

// ── The operations ─────────────────────────────────────────────────────────

export type Outcome = { ok: boolean; code?: string; crossTenant?: number; unknownAsZero?: number; executions?: number };
const agentRow = (w: World, id: number) => w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(id) as any;

/** The charge an ok result reports must be its rows' sum, and unknown when any row is unrecorded. */
function chargeAgrees(w: World, usageLogId: number | null, charged: any): number {
  if (!usageLogId) return 0;
  const r = w.db.prepare('SELECT SUM(charged_microusd) AS s, SUM(charged_microusd IS NULL) AS nulls FROM ai_usage_logs WHERE id = ? OR guard_for = ?').get(usageLogId, usageLogId) as any;
  if (Number(r.nulls) > 0) return charged?.available ? 1 : 0;
  return charged?.available && Number(charged.value_microusd) === Number(r.s) ? 0 : 1;
}

async function opA(w: World, t: Tenant): Promise<Outcome> {
  await loadAiBudget(w.env, t.userId);
  await memberHolds(w.env, t.userId);
  return { ok: true };
}

async function opB(w: World, t: Tenant, n: number, key: string | null = null, fail = false): Promise<Outcome> {
  const r: any = await aiRun(w.env, {
    task: 'rail_numbers', userId: t.userId, text: fail ? `${FAIL_MARK} ${n}` : `Synthetic ask ${n}`, rail: RAIL,
    ...(key ? { idempotencyKey: key, executionId: key.replace(/[^A-Za-z0-9-]/g, '').slice(0, 60) } : {}),
  } as any);
  return { ok: !!r.ok, code: r.ok ? undefined : String(r.refusal ?? 'refused'), executions: 1 };
}

async function opC(w: World, t: Tenant, n: number): Promise<Outcome> {
  const ag = t.agents[n % t.agents.length];
  const taskId = freshTask(w, t, ag.id);
  const scope = { kind: 'project' as const, id: t.projectId };
  const adm: any = await admitInScope(w.env, scope, { agentId: ag.id, taskId, by: t.userId } as any);
  if (!adm.ok) return { ok: false, code: adm.code };
  const uid = adm.run.uid as string;
  await markRun(w.env, uid, 'run', { status: 'done', summary: 'started' }, { status: 'running', started: true });
  const r: any = await agentRun(w.env, { agent: agentRow(w, ag.id), module: SYNTHETIC_MODULE, option: SYNTHETIC_OPTION, prompt: `Synthetic step ${n}.`, taskId, runUid: uid } as any);
  if (!r.ok) {
    await markRun(w.env, uid, 'run', { status: 'refused', summary: String(r.code) }, { status: 'refused', refusal: String(r.code), ended: true });
    await moveTask(w.env, taskId, 'blocked', ['in_progress'], { blockedReason: 'refused' });
    return { ok: false, code: r.code, executions: 1 };
  }
  const unknown = chargeAgrees(w, r.usageLogId, r.charged);
  await moveTask(w.env, taskId, 'waiting_decision', ['in_progress']);
  await markRun(w.env, uid, 'propose', { status: 'waiting', summary: 'proposed' }, { status: 'waiting_decision', usageLogId: r.usageLogId, proposalUid: r.proposal.uid });
  // The accept delivers the decision to the run (`deliverDecision`), whose `after` step closes the task and the run.
  const decided = await decideRail(w.env, t.userId, r.proposal.uid, 'accept');
  const closed = w.db.prepare('SELECT status FROM agent_task_runs WHERE uid = ?').get(uid) as any;
  return { ok: !!decided && closed?.status === 'done', code: closed?.status === 'done' ? undefined : `run_${closed?.status}`, unknownAsZero: unknown, executions: 1 };
}

async function opD(w: World, t: Tenant): Promise<Outcome> {
  const rows = await listRail(w.env, t.userId, { option: SYNTHETIC_OPTION });
  // Every row a member reads is their own: anything else is a cross-tenant read.
  const own = new Set((w.db.prepare('SELECT uid FROM ai_rail_proposals WHERE user_id = ?').all(t.userId) as any[]).map((x) => x.uid));
  return { ok: true, crossTenant: rows.filter((r: any) => !own.has(r.uid)).length };
}

/** E: four failure shapes in turn. */
async function opE(w: World, t: Tenant, n: number, other: Tenant): Promise<Outcome> {
  switch (n % 4) {
    case 0: { // the same idempotency key, raced: one hold, one charge
      const key = `bench:dup-${n}:run`;
      const [a, b] = await Promise.all([opB(w, t, n, key), opB(w, t, n, key)]);
      return { ok: a.ok || b.ok, executions: 2, code: a.ok && b.ok ? undefined : 'step_replayed' };
    }
    case 1: { // the provider fails: the run is refused, and its hold is released (the orphaned-hold invariant)
      const r = await opB(w, t, n, null, true);
      return { ok: !r.ok, code: r.ok ? 'provider_failure_charged' : undefined, executions: 1 };
    }
    case 2: { // a replayed agent step answers its first result and charges nothing more
      const c = await opC(w, t, n);
      const last = w.db.prepare("SELECT uid, task_id FROM agent_task_runs WHERE agent_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1").get(t.agents[n % t.agents.length].id) as any;
      if (!c.ok || !last) return c;
      const again: any = await agentRun(w.env, { agent: agentRow(w, t.agents[n % t.agents.length].id), module: SYNTHETIC_MODULE, option: SYNTHETIC_OPTION, prompt: 'Synthetic replay.', taskId: last.task_id, runUid: last.uid } as any);
      return { ok: !!again.ok && again.replayed === true, code: again.ok ? undefined : again.code, executions: 1 };
    }
    default: { // an agent asked to work another tenant's task is refused before anything is held
      if (other === t) return { ok: true };
      const theirs = freshTask(w, other, other.agents[0].id);
      const r: any = await agentRun(w.env, { agent: agentRow(w, t.agents[0].id), module: SYNTHETIC_MODULE, option: SYNTHETIC_OPTION, prompt: 'Synthetic cross-tenant.', taskId: theirs } as any);
      w.db.prepare("UPDATE scope_tasks SET status = 'blocked', board_column = 'backlog', blocked_reason = 'bench' WHERE id = ?").run(theirs);
      return { ok: !r.ok && r.code === 'task_not_assigned', crossTenant: r.ok ? 1 : 0 };
    }
  }
}

// ── The schedule and the runner ────────────────────────────────────────────

/** mulberry32: the same seed gives the same operations, in the same order. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export type Op = { n: number; kind: MixKey; tenant: number; other: number };
/** `hot` sends that share of operations to tenant 0, for the hotspot and fairness case. */
export function schedule(o: { ops: number; tenants: number; mix?: Mix; seed?: number; hot?: number }): Op[] {
  if (!Number.isSafeInteger(o.ops) || o.ops < 1 || o.ops > BENCH_LIMITS.ops) throw new Error(`ops must be 1 to ${BENCH_LIMITS.ops}`);
  const mix = o.mix ?? DEFAULT_MIX, rnd = prng(o.seed ?? 4567);
  const keys = MIX_KEYS.filter((k) => (mix[k] ?? 0) > 0), total = keys.reduce((s, k) => s + (mix[k] ?? 0), 0);
  if (!keys.length) throw new Error('the mix names no operation');
  const pick = () => { let x = rnd() * total; for (const k of keys) { x -= mix[k] ?? 0; if (x < 0) return k; } return keys[keys.length - 1]; };
  const who = () => (o.hot && rnd() < o.hot ? 0 : Math.floor(rnd() * o.tenants));
  return Array.from({ length: o.ops }, (_, n) => ({ n, kind: pick(), tenant: who(), other: Math.floor(rnd() * o.tenants) }));
}

export type OpResult = { op: Op; ms: number; ok: boolean; code?: string; error?: string; stmts: number; reads: number; writes: number; batches: number; stages: Record<string, number>; crossTenant: number; unknownAsZero: number; executions: number };

export async function runOp(w: World, op: Op): Promise<OpResult> {
  const ctx: OpCtx = { kind: op.kind, stmts: 0, reads: 0, writes: 0, batches: 0, stages: {} };
  const t = w.tenants[op.tenant], other = w.tenants[op.other];
  const start = performance.now();
  let out: Outcome, error: string | undefined;
  try {
    out = await w.meter.als.run(ctx, () => op.kind === 'A' ? opA(w, t) : op.kind === 'B' ? opB(w, t, op.n) : op.kind === 'C' ? opC(w, t, op.n) : op.kind === 'D' ? opD(w, t) : opE(w, t, op.n, other));
  } catch (e) {
    // The error's class only: a message may quote a value.
    error = (e as Error)?.constructor?.name ?? 'Error'; out = { ok: false, code: 'threw' };
  }
  return { op, ms: performance.now() - start, ok: out.ok, code: out.code, error, stmts: ctx.stmts, reads: ctx.reads, writes: ctx.writes, batches: ctx.batches, stages: ctx.stages,
    crossTenant: out.crossTenant ?? 0, unknownAsZero: out.unknownAsZero ?? 0, executions: out.executions ?? 0 };
}

/** Closed loop: `concurrency` operations in flight, in schedule order. Deterministic for a seed. */
export async function runClosed(w: World, ops: Op[], concurrency = 1): Promise<OpResult[]> {
  const out: OpResult[] = new Array(ops.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < ops.length) { const i = next++; out[i] = await runOp(w, ops[i]); }
  }));
  return out;
}

export type StepReport = { rate: number; seconds: number; started: number; completed: number; achieved_ops_s: number; error_rate: number; p50_ms: number; p95_ms: number; p99_ms: number; stopped?: string };

/**
 * Open loop, the ramp: each step starts operations at `rate` a second for
 * `seconds`, whether or not earlier ones finished, so latency includes queueing.
 * It stops at the first step over `maxErrorRate` or `maxP95Ms`, or at `maxOps`.
 * The rates are load steps, never capacity promises.
 */
export async function ramp(w: World, o: { rates: number[]; seconds: number; tenants: number; mix?: Mix; seed?: number; hot?: number; maxOps: number; maxErrorRate: number; maxP95Ms: number }) {
  if (o.seconds * o.rates.length > BENCH_LIMITS.seconds) throw new Error(`a ramp is at most ${BENCH_LIMITS.seconds} s`);
  if (o.rates.some((r) => !(r > 0 && r <= BENCH_LIMITS.rate))) throw new Error(`each rate is 1 to ${BENCH_LIMITS.rate}/s`);
  const steps: StepReport[] = [], all: OpResult[] = [];
  let n = 0, stopped: string | undefined;
  for (const rate of o.rates) {
    const count = Math.max(1, Math.round(rate * o.seconds));
    if (n + count > o.maxOps) { stopped = `max_ops ${o.maxOps}`; break; }
    const ops = schedule({ ops: count, tenants: o.tenants, mix: o.mix, seed: (o.seed ?? 4567) + rate, hot: o.hot }).map((x) => ({ ...x, n: x.n + n }));
    n += count;
    const t0 = performance.now();
    const pending = ops.map((op, i) => new Promise<OpResult>((res) => setTimeout(() => runOp(w, op).then(res), (i * 1000) / rate)));
    const rs = await Promise.all(pending);
    const wall = (performance.now() - t0) / 1000;
    all.push(...rs);
    const lat = rs.map((r) => r.ms);
    const errors = rs.filter((r) => r.error || r.code === 'threw').length;
    const s: StepReport = { rate, seconds: o.seconds, started: rs.length, completed: rs.length - errors, achieved_ops_s: round((rs.length - errors) / wall),
      error_rate: round(errors / rs.length, 4), p50_ms: pct(lat, 50), p95_ms: pct(lat, 95), p99_ms: pct(lat, 99) };
    steps.push(s);
    if (s.error_rate > o.maxErrorRate) { stopped = s.stopped = `error_rate ${s.error_rate} > ${o.maxErrorRate}`; break; }
    if (s.p95_ms > o.maxP95Ms) { stopped = s.stopped = `p95 ${s.p95_ms} ms > ${o.maxP95Ms}`; break; }
  }
  return { steps, results: all, stopped: stopped ?? null };
}

// ── Invariants, amplification, growth ─────────────────────────────────────

/** Every count must be 0. Counted over the whole database after the run, plus what the operations saw. */
export function invariants(w: World, results: OpResult[]) {
  const n = (sql: string) => Number((w.db.prepare(sql).get() as any)?.n ?? 0);
  return {
    // A settled hold without its token is already impossible (the reservations table's CHECK); a second spend is not.
    double_settlement: n("SELECT COUNT(*) AS n FROM (SELECT reservation_uid FROM ai_credit_ledger WHERE kind = 'spend' AND reservation_uid IS NOT NULL GROUP BY reservation_uid HAVING COUNT(*) > 1)"),
    missing_charge: n("SELECT COUNT(*) AS n FROM ai_rail_proposals p JOIN ai_usage_logs u ON u.id = p.usage_log_id WHERE u.charged_microusd IS NULL"),
    orphaned_holds: n("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'pending'"),
    // The schema's CHECKs keep both at 0 or more, so a write that would go below zero is refused: counted from the meter.
    negative_balance: n('SELECT COUNT(*) AS n FROM ai_topup_accounts WHERE balance_microusd < 0') + n('SELECT COUNT(*) AS n FROM ai_included_spend WHERE spend_microusd < 0')
      + (w.meter.checkFailures.get('ai_topup_accounts') ?? 0) + (w.meter.checkFailures.get('ai_included_spend') ?? 0),
    second_live_run: n("SELECT COUNT(*) AS n FROM (SELECT agent_id FROM agent_task_runs WHERE status IN ('admitted', 'running') GROUP BY agent_id HAVING COUNT(*) > 1)"),
    orphaned_runs: n("SELECT COUNT(*) AS n FROM agent_task_runs WHERE status IN ('admitted', 'running', 'waiting_decision')"),
    duplicate_proposal: n('SELECT COUNT(*) AS n FROM (SELECT run_key FROM ai_rail_proposals WHERE run_key IS NOT NULL GROUP BY run_key HAVING COUNT(*) > 1)'),
    duplicate_hold: n('SELECT COUNT(*) AS n FROM (SELECT user_id, idempotency_key FROM ai_budget_reservations WHERE idempotency_key IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1)'),
    cross_tenant_read: results.reduce((s, r) => s + r.crossTenant, 0),
    unknown_as_zero: results.reduce((s, r) => s + r.unknownAsZero, 0),
  };
}

const PLAN_SCAN = /^SCAN (?!CONSTANT)(\w+)(?! VIRTUAL)/;
/** Per fingerprint: count, share, time, plan scans, and a written table's index count (an upper bound on index writes per row). */
export function amplification(w: World) {
  const indexes = (table: string) => Number((w.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").get(table) as any).n);
  const triggers = (table: string) => Number((w.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").get(table) as any).n);
  const total = [...w.meter.stats.values()].reduce((s, x) => s + x.n, 0) || 1;
  return [...w.meter.stats.values()].sort((a, b) => b.ms - a.ms).map((s) => {
    let scans: string[] = [];
    try { scans = (w.db.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).all() as any[]).map((r) => String(r.detail)).filter((d) => PLAN_SCAN.test(d) && !/json_each/.test(d)); } catch { scans = ['plan unreadable']; }
    const table = s.kind === 'write' ? writtenTable(s.sql) : null;
    return { fingerprint: s.fp.slice(0, 160), kind: s.kind, count: s.n, share: round(s.n / total, 4), total_ms: round(s.ms), mean_ms: round(s.ms / s.n, 4),
      rows_changed: s.changes, in_batch: s.inBatch, ops: [...s.ops].sort().join(''), scans,
      ...(table ? { table, indexes: indexes(table), triggers: triggers(table), index_writes_upper: s.changes * indexes(table) } : {}) };
  });
}

/** Database bytes and the hot tables' row counts: before and after give growth per 1,000 executions. */
export function footprint(w: World) {
  const g = (sql: string) => Number(Object.values(w.db.prepare(sql).get() as any)[0]);
  const rows: Record<string, number> = {};
  for (const t of ['ai_usage_logs', 'ai_budget_reservations', 'ai_credit_ledger', 'agent_task_runs', 'scope_tasks', 'ai_rail_proposals', 'team_agent_events', 'scope_task_events']) {
    rows[t] = g(`SELECT COUNT(*) FROM ${t}`);
  }
  return { bytes: g('PRAGMA page_count') * g('PRAGMA page_size'), rows };
}

export function summarise(results: OpResult[]) {
  const by: Record<string, any> = {};
  for (const k of MIX_KEYS) {
    const rs = results.filter((r) => r.op.kind === k);
    if (!rs.length) continue;
    const codes: Record<string, number> = {};
    for (const r of rs) if (!r.ok) codes[r.code ?? r.error ?? 'refused'] = (codes[r.code ?? r.error ?? 'refused'] ?? 0) + 1;
    by[k] = { ops: rs.length, ok: rs.filter((r) => r.ok).length, refusals: codes, errors: rs.filter((r) => r.error).length,
      stmts_per_op: round(avg(rs.map((r) => r.stmts)), 2), reads_per_op: round(avg(rs.map((r) => r.reads)), 2), writes_per_op: round(avg(rs.map((r) => r.writes)), 2),
      batches_per_op: round(avg(rs.map((r) => r.batches)), 2),
      stmts_per_op_by_stage: Object.fromEntries([...new Set(rs.flatMap((r) => Object.keys(r.stages)))].sort().map((k) => [k, round(avg(rs.map((r) => r.stages[k] ?? 0)), 2)])),
      p50_ms: pct(rs.map((r) => r.ms), 50), p95_ms: pct(rs.map((r) => r.ms), 95), p99_ms: pct(rs.map((r) => r.ms), 99) };
  }
  return by;
}

/** Per tenant: operations and p95, so one hot tenant's cost on the others shows. */
export function fairness(results: OpResult[]) {
  const per = new Map<number, number[]>();
  for (const r of results) per.set(r.op.tenant, [...(per.get(r.op.tenant) ?? []), r.ms]);
  const p95s = [...per.values()].map((l) => pct(l, 95));
  const counts = [...per.values()].map((l) => l.length);
  return { tenants_touched: per.size, ops_max: Math.max(...counts), ops_median: pct(counts, 50), p95_ms_max: Math.max(...p95s), p95_ms_median: pct(p95s, 50) };
}

const avg = (l: number[]) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : 0);
export function pct(l: number[], p: number) {
  if (!l.length) return 0;
  const s = [...l].sort((a, b) => a - b);
  return round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)], 3);
}
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// ── The database-only control ──────────────────────────────────────────────

const CHARGED_FOR_SQL = `SELECT SUM(charged_microusd) AS charged, SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded
  FROM ai_usage_logs WHERE id = ? OR guard_for = ?`;

/**
 * The statement `chargedFor` runs (agentRun.ts), timed as `ai_usage_logs`
 * grows with synthetic rows, then again with a candidate index on
 * `guard_for` created IN THIS THROWAWAY DATABASE ONLY. It is evidence for
 * #4568, never a migration: no schema file changes.
 */
export function scanControl(w: World, sizes: number[], reps = 200) {
  const user = w.tenants[0].userId;
  const out: { rows: number; plan: string; mean_ms: number; indexed_plan: string; indexed_mean_ms: number }[] = [];
  const time = (sql: string, id: number) => { const st = w.db.prepare(sql); const t = performance.now(); for (let i = 0; i < reps; i++) st.get(id, id); return round((performance.now() - t) / reps, 4); };
  const plan = (sql: string) => (w.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map((r) => r.detail).join('; ');
  let have = Number((w.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs').get() as any).n);
  for (const size of [...sizes].sort((a, b) => a - b)) {
    if (!Number.isSafeInteger(size) || size < 1 || size > 1_000_000) throw new Error('a control size is 1 to 1,000,000 rows');
    if (size > have) {
      w.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
        INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, guard_for) SELECT ?, 'rail_numbers', 'synthetic', 10, NULL FROM n`).run(size - have, user);
      have = size;
    }
    const probe = Number((w.db.prepare('SELECT MAX(id) AS id FROM ai_usage_logs').get() as any).id);
    w.db.exec('DROP INDEX IF EXISTS bench_only_guard_for');
    const row = { rows: size, plan: plan(CHARGED_FOR_SQL), mean_ms: time(CHARGED_FOR_SQL, probe), indexed_plan: '', indexed_mean_ms: 0 };
    w.db.exec('CREATE INDEX bench_only_guard_for ON ai_usage_logs (guard_for) WHERE guard_for IS NOT NULL');
    row.indexed_plan = plan(CHARGED_FOR_SQL); row.indexed_mean_ms = time(CHARGED_FOR_SQL, probe);
    w.db.exec('DROP INDEX bench_only_guard_for');
    out.push(row);
  }
  return out;
}

// ── D4568: the candidate indexes, with and without ─────────────────────────

/** The two partial indexes migration 202611070806 adds (D4568), by name. */
export const CANDIDATE_INDEX_NAMES = Object.freeze(['idx_ai_usage_logs_guard_for', 'idx_ai_usage_logs_reservation_ref']);
const RESERVATION_SUM_SQL = 'SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM ai_usage_logs WHERE reservation_uid = ?1 AND record_ref = ?2';

/**
 * The candidates' read benefit and write cost on this throwaway database. For
 * each size: the two charge reads' mean time and plan, and the time to insert
 * a burst of usage rows shaped like a run's (one model row with a hold, two
 * guard rows naming it), with the candidates and without them. The burst is
 * timed inside one transaction, so the figure is the indexes' upkeep, not the
 * commit. The indexes are put back as the migration wrote them.
 */
export function indexControl(w: World, sizes: number[], o: { reps?: number; burst?: number } = {}) {
  const reps = o.reps ?? 200, burst = o.burst ?? 3000;
  const ddl = new Map(CANDIDATE_INDEX_NAMES.map((n) => [n, String((w.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(n) as any)?.sql ?? '')]));
  if ([...ddl.values()].some((s) => !s)) throw new Error('the candidate indexes are not in this schema: is migration 202611070806 applied?');
  const user = w.tenants[0].userId;
  const plan = (sql: string) => (w.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map((r) => r.detail).join('; ');
  const time = (sql: string, args: unknown[]) => { const st = w.db.prepare(sql); const t = performance.now(); for (let i = 0; i < reps; i++) st.get(...args); return round((performance.now() - t) / reps, 4); };
  const insertBurst = () => {
    const ins = w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref, guard_for) VALUES (?, 'rail_numbers', 'synthetic', 10, ?, ?, ?)`);
    w.db.exec('BEGIN');
    const t = performance.now();
    for (let i = 0; i < burst; i += 3) {
      const r = ins.run(user, `bench-res-${i}`, `bench-ref-${i}`, null);
      const id = Number(r.lastInsertRowid);
      ins.run(user, null, null, id); ins.run(user, null, null, id);
    }
    const ms = performance.now() - t;
    w.db.exec('ROLLBACK');
    return round(ms / burst, 5);
  };
  const drop = () => { for (const n of CANDIDATE_INDEX_NAMES) w.db.exec(`DROP INDEX IF EXISTS ${n}`); };
  const restore = () => { for (const s of ddl.values()) w.db.exec(s.replace(/^CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ')); };
  let have = Number((w.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs').get() as any).n);
  const out: any[] = [];
  try {
    for (const size of [...sizes].sort((a, b) => a - b)) {
      if (!Number.isSafeInteger(size) || size < 1 || size > 1_000_000) throw new Error('a control size is 1 to 1,000,000 rows');
      if (size > have) {
        // A third are runs under a parent hold; the rest their guard rows, naming earlier ids: the shape the reads meet.
        w.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
          INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref, guard_for)
          SELECT ?, 'rail_numbers', 'synthetic', 10, CASE WHEN i % 3 = 0 THEN 'bench-hold-' || (i / 30) END, CASE WHEN i % 3 = 0 THEN 'bench-step-' || i END,
                 CASE WHEN i % 3 = 0 THEN NULL ELSE i END FROM n`).run(size - have, user);
        have = size;
      }
      const probe = Number((w.db.prepare('SELECT MAX(id) AS id FROM ai_usage_logs WHERE guard_for IS NULL').get() as any).id);
      const step = w.db.prepare('SELECT reservation_uid AS r, record_ref AS f FROM ai_usage_logs WHERE reservation_uid IS NOT NULL ORDER BY id DESC LIMIT 1').get() as any;
      drop();
      const without = { charged_for_plan: plan(CHARGED_FOR_SQL), charged_for_ms: time(CHARGED_FOR_SQL, [probe, probe]),
        reservation_plan: plan(RESERVATION_SUM_SQL), reservation_ms: time(RESERVATION_SUM_SQL, [step.r, step.f]), insert_ms_per_row: insertBurst() };
      restore();
      const withIdx = { charged_for_plan: plan(CHARGED_FOR_SQL), charged_for_ms: time(CHARGED_FOR_SQL, [probe, probe]),
        reservation_plan: plan(RESERVATION_SUM_SQL), reservation_ms: time(RESERVATION_SUM_SQL, [step.r, step.f]), insert_ms_per_row: insertBurst() };
      out.push({ rows: size, without, with: withIdx });
    }
  } finally { restore(); }
  return out;
}

/** Drop the candidates from this world, for a before run of a whole mix. */
export function withoutCandidates(w: World) { for (const n of CANDIDATE_INDEX_NAMES) w.db.exec(`DROP INDEX IF EXISTS ${n}`); return w; }
