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

export function world(o: { engine?: string; autonomy?: string } = {}) {
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
  const caller: ScopeCaller = async (scope, path, body) => {
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
  const runtime: AgentRuntime = doRuntime(env, caller);
  /** Each case's copy of the template is removed as it closes: the disk holds one at a time. */
  const close = () => { const f = db.location(); db.close(); if (f) rmSync(f, { force: true }); };
  return { db, DB, env, kv, queue, workflows, agent, task, storages, storageOf, core, caller, runtime, enqueued, due, deps, close };
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
