/**
 * D1528 (#3847, E3 of #3742) — the agent engine's world for its tests: the
 * real migrated schema (`_storage_schema.ts`, so migrations 712, 727, 728 and
 * 762 are all in), a KV, the scope objects as `ScopeCore`s over in-memory
 * storage, a fake Workflow binding, a fake queue, a Workflow step harness
 * that memoises by step name the way Workflows do, and a fake `agentRun`
 * that keeps E2's promise (one hold per run key; a retry after a lost write
 * is `step_lost`). Every row is made up.
 */
import { rmSync } from 'node:fs';
import { migratedDatabase } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { DO_DEPS, ScopeCore, doRuntime, scopeOf, type ScopeCaller, type ScopeStorage } from '../src/agents/doRuntime.ts';
import { admitInScope } from '../src/agents/engine.ts';
import { READERS } from '../src/services/agents/reads.ts';
import type { LoopDeps, StepLike, Decision } from '../src/agents/loop.ts';
import type { AgentRuntime } from '../src/agents/runtime.ts';
import { SdkScopeCore, dispatchSdk, sdkRuntimeOver, type DutyPayload, type SdkHost, type SdkSchedule, type SdkScopeState } from '../src/agents/sdkScope.ts';

export const ADMIN = 1, SPONSOR = 10, STRANGER = 12, MEMBER = 11;
export const PROJECT = 7, COMPANY = 1;
export const AGENT = 50;
export const MODULE = 'product-roadmap', OPTION = 'draft:build/plan';
export const hex = (n: number, p = 'a') => `${p}${n.toString(16)}`.padStart(32, '0');

export class MemStorage implements ScopeStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(k: string) { return this.map.get(k) as T | undefined; }
  async put(k: string, v: unknown) { this.map.set(k, structuredClone(v)); }
  async delete(k: string) { return this.map.delete(k); }
  async deleteAll() { this.map.clear(); }
  async list<T>(o: { prefix: string }) { return new Map([...this.map].filter(([k]) => k.startsWith(o.prefix)) as [string, T][]); }
  async getAlarm() { return this.alarm; }
  async setAlarm(at: number) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
}

/**
 * #3852 — a fake of the slice of the Agents SDK `Agent` the `sdk` runtime uses,
 * keeping the SDK's semantics: `setState` persists a copy; a schedule's `time`
 * is whole seconds; the alarm runs each due schedule's callback and then
 * deletes the one-shot row; `runWorkflow` creates the instance first (a second
 * create with the same id throws) and then tracks it.
 */
export class FakeSdkHost implements SdkHost {
  state: SdkScopeState = { halted: false, live: [] };
  rows = new Map<string, SdkSchedule & { time: number }>();
  tracked = new Set<string>();
  private seq = 0;
  private env: any;
  constructor(env: any) { this.env = env; }
  readState() { return structuredClone(this.state); }
  setState(s: SdkScopeState) { this.state = structuredClone(s); }
  async schedule(when: Date, callback: 'dutyDue', payload: DutyPayload) {
    const id = `sch-${++this.seq}`;
    this.rows.set(id, { id, callback, payload: structuredClone(payload), time: Math.floor(when.getTime() / 1000) });
    return { id };
  }
  async cancelSchedule(id: string) { return this.rows.delete(id); }
  async listSchedules() { return [...this.rows.values()].map((r) => structuredClone(r)); }
  async runWorkflow(name: 'AGENT_TASK', params: { run_uid: string }, o: { id: string }) {
    const inst = await this.env[name].create({ id: o.id, params: { ...params, __agentName: 'scope', __workflowName: name } });
    if (this.tracked.has(inst.id)) throw new Error(`Workflow with ID "${inst.id}" is already being tracked`);
    this.tracked.add(inst.id);
    return inst.id as string;
  }
  /** The earliest schedule, in ms, as the SDK sets the object's alarm. */
  get alarm(): number | null {
    const t = [...this.rows.values()].map((r) => r.time * 1000);
    return t.length ? Math.min(...t) : null;
  }
  /** The SDK's alarm: each due row's callback, then the row goes. */
  async fire(now: number, callback: (payload: DutyPayload) => Promise<void>) {
    for (const r of [...this.rows.values()].sort((a, b) => a.time - b.time)) {
      if (r.time * 1000 > now) continue;
      await callback(r.payload as DutyPayload);
      this.rows.delete(r.id);
    }
  }
}

export function memKv() {
  const m = new Map<string, string>();
  return {
    m,
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}

/** A fake Workflow binding: one instance per id, events and terminations recorded. */
export function fakeWorkflows() {
  const instances = new Map<string, { params: unknown; events: unknown[]; terminated: boolean }>();
  return {
    instances,
    async create(o: { id: string; params: unknown }) {
      if (instances.has(o.id)) throw new Error('instance.already_exists');
      instances.set(o.id, { params: o.params, events: [], terminated: false });
      return { id: o.id };
    },
    async get(id: string) {
      const i = instances.get(id);
      if (!i) throw new Error('instance.not_found');
      return {
        id,
        async sendEvent(e: unknown) { i.events.push(e); },
        async terminate() { if (i.terminated) throw new Error('already'); i.terminated = true; },
        async status() { return { status: i.terminated ? 'terminated' : 'waiting' }; },
      };
    },
  };
}

export function world(o: { engine?: string; autonomy?: string; runtime?: 'do' | 'sdk' } = {}) {
  const db = migratedDatabase();
  const DB = d1Over(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, founder_id, is_active) VALUES
      (${ADMIN}, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', NULL, 1),
      (${SPONSOR}, 'u-sponsor', 'sponsor@example.test', 'Sam Sponsor', 'founder', 100, 1),
      (${MEMBER}, 'u-member', 'member@example.test', 'Max Member', 'founder', 101, 1),
      (${STRANGER}, 'u-stranger', 'stranger@example.test', 'Stu Stranger', 'founder', 102, 1);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (${COMPANY}, 'co-1', 'Acme');
    INSERT INTO projects (id, uid, name, founder_id, company_id, description)
      VALUES (${PROJECT}, 'p7', 'Kestrel', 100, ${COMPANY}, 'Kestrel builds drones.');
  `);
  const queue: unknown[] = [];
  const kv = memKv();
  const workflows = fakeWorkflows();
  const env: any = {
    DB, RATE_LIMITS: kv, AGENT_TASK: workflows,
    AGENT_QUEUE: { async send(m: unknown) { queue.push(m); } },
    AGENT_ENGINE: o.engine ?? 'on', TEAM_AGENTS_ENABLED: 'true', AGENT_AUTONOMY: o.autonomy ?? 'manual',
    JWT_SECRET: 'd1528-fixture-only-secret', ENVIRONMENT: 'development',
  };
  const agent = (id: number, role = 'ceo', extra: { scope?: 'project' | 'company'; sponsor?: number; status?: string } = {}) => {
    const company = extra.scope === 'company';
    db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, project_id, role_key, first_name, model_id, sponsor_user_id, monthly_cap_microusd, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', ?, 5000000, ?, ?)`)
      .run(id, hex(id, 'b'), company ? 'company' : 'project', company ? COMPANY : null, company ? null : PROJECT, role, `Agent${id}`,
        extra.sponsor ?? SPONSOR, extra.sponsor ?? SPONSOR, extra.status ?? 'active');
    return id;
  };
  const task = (id: number, agentId: number, extra: { status?: string; board?: string | null; scope?: 'project' | 'company'; contextProject?: number | null; title?: string } = {}) => {
    const company = extra.scope === 'company';
    db.prepare(`INSERT INTO scope_tasks (id, uid, scope_kind, company_id, project_id, title, module, option, context_project_id,
        assignee_kind, assignee_agent_id, status, board_column, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?, ?)`)
      .run(id, hex(id, 'c'), company ? 'company' : 'project', company ? COMPANY : null, company ? null : PROJECT, extra.title ?? `Task ${id}`,
        MODULE, OPTION, extra.contextProject ?? null, agentId, extra.status ?? 'open', company ? null : (extra.board === undefined ? 'ready' : extra.board), SPONSOR);
    return id;
  };

  // The scope objects: one ScopeCore per scope name over its own storage.
  const storages = new Map<string, MemStorage>();
  const enqueued: string[] = [];
  const due: number[] = [];
  const deps = {
    ...DO_DEPS,
    admitRow: admitInScope,
    enqueue: async (_e: any, uid: string) => { enqueued.push(uid); await env.AGENT_QUEUE.send({ job_type: 'agent_run', payload: { run_uid: uid } }); },
    dutyDue: async (_e: any, _s: any, dutyId: number) => { due.push(dutyId); },
    now: () => Date.now(),
  };
  const storageOf = (name: string) => { if (!storages.has(name)) storages.set(name, new MemStorage()); return storages.get(name)!; };
  const core = (name: string) => new ScopeCore(storageOf(name), env, deps);
  // #3852: the `sdk` runtime's Agents, one fake host per scope name, each request a fresh core (an evicted Agent).
  const hosts = new Map<string, FakeSdkHost>();
  const hostOf = (name: string) => { if (!hosts.has(name)) hosts.set(name, new FakeSdkHost(env)); return hosts.get(name)!; };
  const sdkCore = (name: string) => new SdkScopeCore(hostOf(name), env, deps);
  const sdkCaller: ScopeCaller = async (scope, path, body) => dispatchSdk(sdkCore(`${scope.kind}:${scope.id}`), scope, path, body);
  const doCaller: ScopeCaller = async (scope, path, body) => {
    const name = `${scope.kind}:${scope.id}`;
    const c = core(name);
    const s = scopeOf(name)!;
    switch (path) {
      case '/admit': return c.admit(s, body.trigger as any);
      case '/track': await c.track(body.run as any); return { ok: true };
      case '/schedule': await c.schedule(body.duty as any); return { ok: true };
      case '/cancel-schedule': await c.cancelSchedule(Number(body.dutyId)); return { ok: true };
      case '/status': return c.status(s);
      case '/halt': await c.halt(s); return { ok: true };
      case '/rebuild': return c.rebuild(s);
      case '/erase': await c.erase(body.agentId == null ? null : Number(body.agentId)); return { ok: true };
      default: throw new Error(path);
    }
  };
  if (o.runtime === 'sdk') env.AGENT_RUNTIME = 'sdk';
  /** The runtime in force follows `env.AGENT_RUNTIME`, so a test can switch it mid-run (the runbook's rehearsal). */
  const caller: ScopeCaller = (scope, path, body) => (env.AGENT_RUNTIME === 'sdk' ? sdkCaller : doCaller)(scope, path, body);
  const runtimeFor = (name: 'do' | 'sdk'): AgentRuntime => (name === 'sdk' ? sdkRuntimeOver(env, sdkCaller) : doRuntime(env, doCaller));
  const runtime: AgentRuntime = runtimeFor(o.runtime ?? 'do');
  /** Each case's copy of the template is removed as it closes: the disk holds one at a time. */
  const close = () => { const f = db.location(); db.close(); if (f) rmSync(f, { force: true }); };
  return { db, DB, env, kv, queue, workflows, agent, task, storages, storageOf, core, hosts, hostOf, sdkCore, caller, runtime, runtimeFor, enqueued, due, deps, close };
}
export type World = ReturnType<typeof world>;

/** A fake agentRun keeping E2's promise. `charges` counts holds taken. */
export function fakeAgentRun(w: World, mode: { refuse?: { status: number; code: string }; loseOnce?: boolean } = {}) {
  const holds = new Set<string>();
  const prompts: string[] = [];
  const state = { charges: 0, calls: 0, mode, prompts };
  const fn: LoopDeps['agentRun'] = async (_env, input) => {
    state.calls += 1;
    prompts.push(input.prompt);
    const runKey = `agent:${input.runUid}`;
    const done = w.db.prepare('SELECT uid FROM ai_rail_proposals WHERE run_key = ?').get(runKey) as { uid: string } | undefined;
    if (done) return { ok: true, proposal: { uid: done.uid } as any, charged: { available: false }, usageLogId: null, runKey, replayed: true };
    if (state.mode.refuse) return { ok: false, status: state.mode.refuse.status, code: state.mode.refuse.code, message: 'refused' };
    if (holds.has(`${runKey}:run`)) {
      return { ok: false, status: 409, code: 'step_lost', message: 'lost', holdStatus: 'settled', runKey } as any;
    }
    holds.add(`${runKey}:run`);
    state.charges += 1;
    if (state.mode.loseOnce) { state.mode.loseOnce = false; throw new Error('the worker died after the hold'); }
    const uid = `prop-${input.runUid}`;
    w.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, agent_id, task_id, run_key)
      VALUES (?, ?, 'Founder · Build', ?, 'draft', '{"text":"a draft"}', ?, ?, ?)`).run(uid, SPONSOR, input.option, input.agent.id, input.taskId ?? null, runKey);
    return { ok: true, proposal: { uid } as any, charged: { available: false }, usageLogId: null, runKey, replayed: false };
  };
  return { fn, state };
}

export function loopDeps(w: World, agentRun: LoopDeps['agentRun'], readers = READERS): LoopDeps {
  return {
    env: w.env, agentRun, readers,
    runtime: async () => w.runtime,
    track: async (scope, run) => { await w.caller(scope, '/track', { run: { run_uid: run.uid, agent_id: run.agent_id, task_id: run.task_id, status: run.status } }); },
    now: () => new Date(),
  };
}

class Crash extends Error {}

/**
 * A Workflow step harness: `do` memoises by name across replays of `run()`,
 * retries a throw up to 3 times, and can crash once after a step ran but
 * before its result was saved (the case a replay must not repeat).
 */
export function harness() {
  const saved = new Map<string, unknown>();
  const executed: string[] = [];
  const opts: { crashBeforeSave?: string; decision?: Decision | 'timeout'; beforeStep?: (name: string) => Promise<void> | void } = {};
  const step: StepLike = {
    async do<T>(name: string, _cfg: unknown, fn: () => Promise<T>): Promise<T> {
      if (saved.has(name)) return saved.get(name) as T;
      if (opts.beforeStep) await opts.beforeStep(name);
      for (let attempt = 1; ; attempt += 1) {
        executed.push(name);
        try {
          const v = await fn();
          if (opts.crashBeforeSave === name) { opts.crashBeforeSave = undefined; throw new Crash('crash'); }
          saved.set(name, v);
          return v;
        } catch (e) {
          if (e instanceof Crash || attempt > 3) throw e;
        }
      }
    },
    async waitForEvent<T>(): Promise<{ payload: T }> {
      if (!opts.decision || opts.decision === 'timeout') throw new Error('WorkflowTimeoutError');
      return { payload: opts.decision as T };
    },
  };
  return { step, saved, executed, opts, isCrash: (e: unknown) => e instanceof Crash };
}
