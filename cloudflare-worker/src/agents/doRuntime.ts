/**
 * D1528 (#3847, E3 of #3742) — the `do` runtime: one plain SQLite Durable
 * Object per scope, class `AgentScope`, named `project:{id}` or
 * `company:{id}` (immutable ids), plus the `AgentTaskWorkflow` per run.
 *
 * THE OBJECT NEVER CALLS A MODEL. It is the scope's single writer:
 *   - admission, one at a time (`blockConcurrencyWhile`): one live run per
 *     agent, at most `max_parallel_runs` per scope, at most 5 proposals
 *     waiting; the checks and the row are `engine.ts`'s `admitInScope`;
 *   - schedule timers on alarms (the `MeetingBotRun` pattern): a duty's next
 *     firing is a storage key, the alarm is the earliest one, and a timer is
 *     deleted before it fires, so it fires once and survives eviction;
 *   - a hibernatable live-status socket (the `PipelineRoom` pattern): `/ws`
 *     accepts, and every change sends the status to each socket.
 * Its state is a cache of D1: `rebuild` restores it from D1 alone.
 *
 * `ScopeCore` holds the behaviour over a storage interface and injected deps,
 * so `node --test` drives it with fakes; `AgentScope` is the thin class the
 * runtime needs (the `rpc/index.ts` reasoning).
 */
import type { Env } from '../types';
import { doNamespace } from '../util/doNamespace';
import {
  admitInScope, dutiesInScope, openRunsInScope, openRunsOf, putScopeSettings, scopeSettings, type RunRow,
} from './engine';
import {
  scopeName, type Admission, type AgentRuntime, type DutyTimer, type LiveRun, type RunHandle, type ScopeRef, type ScopeStatus, type Trigger,
} from './runtime';
import { enqueueAgentRun } from './agentQueue';

/** The slice of `DurableObjectStorage` the object uses. */
export interface ScopeStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  list<T>(opts: { prefix: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export type DutyEntry = DutyTimer & { agentId?: number | null };

export type ScopeDeps = {
  admitRow(env: Env, scope: ScopeRef, t: Trigger): Promise<Admission>;
  enqueue(env: Env, runUid: string): Promise<void>;
  /** A duty's timer fired. E5 turns it into a task; E3 records the claim only. */
  dutyDue(env: Env, scope: ScopeRef, dutyId: number, at: number): Promise<void>;
  restore(env: Env, scope: ScopeRef): Promise<{ live: LiveRun[]; duties: DutyEntry[]; paused: boolean }>;
  pauseScope(env: Env, scope: ScopeRef): Promise<void>;
  /** End one run's Workflow instance and mark its row cancelled, if it still has one. */
  terminate(env: Env, runUid: string): Promise<void>;
  now(): number;
};

const LIVE = 'live:';
const DUTY = 'duty:';

export class ScopeCore {
  private storage: ScopeStorage;
  private env: Env;
  private deps: ScopeDeps;
  constructor(storage: ScopeStorage, env: Env, deps: ScopeDeps) {
    this.storage = storage; this.env = env; this.deps = deps;
  }

  private async live(): Promise<LiveRun[]> {
    return [...(await this.storage.list<LiveRun>({ prefix: LIVE })).values()];
  }

  private async duties(): Promise<DutyEntry[]> {
    return [...(await this.storage.list<DutyEntry>({ prefix: DUTY })).values()].sort((a, b) => a.at - b.at);
  }

  private async rearm() {
    const next = (await this.duties())[0];
    if (next) await this.storage.setAlarm(next.at);
    else await this.storage.deleteAlarm();
  }

  async status(scope: ScopeRef): Promise<ScopeStatus> {
    return {
      scope: scopeName(scope),
      halted: !!(await this.storage.get<boolean>('halted')),
      live: await this.live(),
      schedules: (await this.duties()).map(({ dutyId, at }) => ({ dutyId, at })),
      updated_at: this.deps.now(),
    };
  }

  async admit(scope: ScopeRef, t: Trigger): Promise<Admission> {
    if (await this.storage.get<boolean>('halted')) {
      return { ok: false, status: 403, code: 'scope_paused', message: 'Agents are paused on this team. An editor can resume them.' };
    }
    // D1 decides duplicates (the live-run check and the single-flight index), never this cache:
    // a live entry the object failed to clear must not hold an agent forever.
    const a = await this.deps.admitRow(this.env, scope, t);
    if (!a.ok) return a;
    await this.storage.put(`${LIVE}${a.run.uid}`, { run_uid: a.run.uid, agent_id: t.agentId, task_id: t.taskId, status: 'admitted' } satisfies LiveRun);
    try {
      await this.deps.enqueue(this.env, a.run.uid);
    } catch {
      // The row stays `admitted`; the sweep sends it again. A code, never the error's text.
      console.warn('[agents] enqueue_failed');
    }
    return a;
  }

  /** A run's status changed; an ended run leaves the live view. */
  async track(run: LiveRun) {
    if (['admitted', 'running', 'waiting_decision'].includes(run.status)) await this.storage.put(`${LIVE}${run.run_uid}`, run);
    else await this.storage.delete(`${LIVE}${run.run_uid}`);
  }

  async schedule(d: DutyEntry) {
    if (!Number.isSafeInteger(d.dutyId) || !Number.isFinite(d.at)) return;
    await this.storage.put(`${DUTY}${d.dutyId}`, { dutyId: d.dutyId, at: d.at, agentId: d.agentId ?? null } satisfies DutyEntry);
    await this.rearm();
  }

  async cancelSchedule(dutyId: number) {
    await this.storage.delete(`${DUTY}${dutyId}`);
    await this.rearm();
  }

  /** Each due timer is deleted before it fires: once, even if the firing throws. */
  async alarm(scope: ScopeRef) {
    const now = this.deps.now();
    for (const d of await this.duties()) {
      if (d.at > now) break;
      await this.storage.delete(`${DUTY}${d.dutyId}`);
      try { await this.deps.dutyDue(this.env, scope, d.dutyId, d.at); } catch { console.warn('[agents] duty_due_failed'); }
    }
    await this.rearm();
  }

  /** Halt this scope: nothing more is admitted from this request on, and D1 holds the pause. */
  async halt(scope: ScopeRef) {
    await this.storage.put('halted', true);
    await this.deps.pauseScope(this.env, scope);
  }

  /** Forget everything and restore it from D1. */
  async rebuild(scope: ScopeRef): Promise<ScopeStatus> {
    const r = await this.deps.restore(this.env, scope);
    await this.storage.deleteAll();
    for (const l of r.live) await this.storage.put(`${LIVE}${l.run_uid}`, l);
    for (const d of r.duties) await this.storage.put(`${DUTY}${d.dutyId}`, d);
    if (r.paused) await this.storage.put('halted', true);
    await this.rearm();
    return this.status(scope);
  }

  /**
   * The product amendment. With an agent: its runs end and its timers go; with
   * none (the scope is deleted): every run ends and the object is emptied. An
   * object left holding nothing is emptied too.
   */
  async erase(agentId: number | null) {
    for (const l of await this.live()) {
      if (agentId != null && l.agent_id !== agentId) continue;
      try { await this.deps.terminate(this.env, l.run_uid); } catch { console.warn('[agents] terminate_failed'); }
      await this.storage.delete(`${LIVE}${l.run_uid}`);
    }
    for (const d of await this.duties()) {
      if (agentId != null && d.agentId !== agentId) continue;
      await this.storage.delete(`${DUTY}${d.dutyId}`);
    }
    if (agentId == null || (!(await this.live()).length && !(await this.duties()).length && !(await this.storage.get('halted')))) {
      await this.storage.deleteAll();
      await this.storage.deleteAlarm();
    } else {
      await this.rearm();
    }
  }
}

// ── Production deps ─────────────────────────────────────────────────────────

const liveOf = (r: RunRow): LiveRun => ({ run_uid: r.uid, agent_id: r.agent_id, task_id: r.task_id, status: r.status });

/** End a run's instance and its row. A gone instance or row is not an error. */
export async function terminateRun(env: Env, runUid: string, refusal: 'erased' | 'cancelled_by_person' = 'erased') {
  try {
    const inst = await env.AGENT_TASK?.get(runUid);
    await inst?.terminate();
  } catch { /* already complete, errored or never created */ }
  try {
    await env.DB.prepare(
      "UPDATE agent_task_runs SET status = 'cancelled', refusal = ?, ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND status IN ('admitted', 'running', 'waiting_decision')",
    ).bind(refusal, runUid).run();
  } catch { /* the row went with its scope */ }
}

export const DO_DEPS: ScopeDeps = {
  admitRow: admitInScope,
  enqueue: enqueueAgentRun,
  async dutyDue(env, _scope, dutyId, at) {
    // Claim before act (the growDaily / reportingDuties precedent). E5 (#3849) creates the task.
    const due = new Date(at).toISOString().slice(0, 19).replace('T', ' ');
    await env.DB.prepare(
      `UPDATE agent_duties SET last_claimed_at = CURRENT_TIMESTAMP, last_outcome = 'due', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND next_due_at <= ? AND status = 'active'`,
    ).bind(dutyId, due).run();
  },
  async restore(env, scope) {
    const live = (await openRunsInScope(env, scope)).map(liveOf);
    const duties = (await dutiesInScope(env, scope))
      .map((d) => ({ dutyId: d.id, at: Date.parse(`${d.next_due_at.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(d.next_due_at) ? '' : 'Z'}`) }))
      .filter((d) => Number.isFinite(d.at));
    return { live, duties, paused: (await scopeSettings(env, scope)).engine_paused };
  },
  async pauseScope(env, scope) { await putScopeSettings(env, scope, { paused: true }, null); },
  terminate: terminateRun,
  now: () => Date.now(),
};

type Socketed = { getWebSockets(): WebSocket[]; acceptWebSocket(ws: WebSocket): void };

/** The Durable Object. Each request names its scope; one admission at a time. */
export class AgentScope implements DurableObject {
  private core: ScopeCore;
  private state: DurableObjectState;
  constructor(state: DurableObjectState, env: Env, deps: ScopeDeps = DO_DEPS) {
    this.state = state;
    this.core = new ScopeCore(state.storage as unknown as ScopeStorage, env, deps);
  }

  private broadcast(status: ScopeStatus) {
    const frame = JSON.stringify({ type: 'agent_status', status });
    for (const ws of (this.state as unknown as Socketed).getWebSockets()) {
      try { ws.send(frame); } catch { /* closing; webSocketClose cleans up */ }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === '/ws') {
      if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected websocket upgrade', { status: 426 });
      const pair = new WebSocketPair();
      (this.state as unknown as Socketed).acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return this.state.blockConcurrencyWhile(async () => {
      let body: any;
      try { body = await req.json(); } catch { return json({ error: 'invalid' }, 400); }
      const scope = scopeOf(body?.scope);
      if (!scope) return json({ error: 'invalid_scope' }, 400);
      await this.state.storage.put('scope', scopeName(scope));
      let out: unknown;
      switch (path) {
        case '/admit': out = await this.core.admit(scope, body.trigger as Trigger); break;
        case '/track': await this.core.track(body.run as LiveRun); out = { ok: true }; break;
        case '/schedule': await this.core.schedule(body.duty as DutyEntry); out = { ok: true }; break;
        case '/cancel-schedule': await this.core.cancelSchedule(Number(body.dutyId)); out = { ok: true }; break;
        case '/status': return json(await this.core.status(scope));
        case '/halt': await this.core.halt(scope); out = { ok: true }; break;
        case '/rebuild': out = await this.core.rebuild(scope); break;
        case '/erase': await this.core.erase(body.agentId == null ? null : Number(body.agentId)); return json({ ok: true });
        default: return json({ error: 'not_found' }, 404);
      }
      this.broadcast(await this.core.status(scope));
      return json(out);
    });
  }

  async alarm() {
    const name = await this.state.storage.get<string>('scope');
    const scope = scopeOf(name);
    if (!scope) return;
    await this.core.alarm(scope);
    this.broadcast(await this.core.status(scope));
  }

  async webSocketMessage(ws: WebSocket) {
    const scope = scopeOf(await this.state.storage.get<string>('scope'));
    if (scope) ws.send(JSON.stringify({ type: 'agent_status', status: await this.core.status(scope) }));
  }

  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* already closed */ }
  }
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

/** `project:12`, `company:3`, or `{ kind, id }`; anything else is null. */
export function scopeOf(v: unknown): ScopeRef | null {
  if (typeof v === 'string') {
    const m = /^(company|project):([1-9][0-9]{0,15})$/.exec(v);
    return m ? { kind: m[1] as ScopeRef['kind'], id: Number(m[2]) } : null;
  }
  if (v && typeof v === 'object') {
    const o = v as { kind?: unknown; id?: unknown };
    if ((o.kind === 'company' || o.kind === 'project') && Number.isSafeInteger(o.id) && Number(o.id) > 0) return { kind: o.kind, id: Number(o.id) };
  }
  return null;
}

// ── The runtime over the binding ────────────────────────────────────────────

export type ScopeCaller = (scope: ScopeRef, path: string, body: Record<string, unknown>) => Promise<any>;

/** POST to the scope's object. Null when the binding is absent. */
export function bindingCaller(env: Env): ScopeCaller | null {
  if (!env.AGENT_SCOPE) return null;
  return async (scope, path, body) => {
    const ns = doNamespace(env, env.AGENT_SCOPE!);
    const stub = ns.get(ns.idFromName(scopeName(scope)));
    const r = await stub.fetch(new Request(`https://agent-scope${path}`, { method: 'POST', body: JSON.stringify({ ...body, scope }) }));
    return r.json();
  };
}

const unavailable = { ok: false as const, status: 503, code: 'engine_unavailable', message: 'The agent engine is not set up here yet.' };

/** The `do` runtime. `call` is the object; tests pass one over `ScopeCore`. */
export function doRuntime(env: Env, call: ScopeCaller | null = bindingCaller(env)): AgentRuntime {
  return {
    name: 'do',
    async admit(scope, trigger) { return call ? call(scope, '/admit', { trigger }) : unavailable; },
    async schedule(scope, duty) { if (call) await call(scope, '/schedule', { duty }); },
    async cancelSchedule(scope, dutyId) { if (call) await call(scope, '/cancel-schedule', { dutyId }); },
    async startRun(_scope, runUid): Promise<RunHandle> {
      if (!env.AGENT_TASK) return { runUid, started: false };
      try {
        await env.AGENT_TASK.create({ id: runUid, params: { run_uid: runUid } });
        return { runUid, started: true };
      } catch {
        // An instance with this id exists: a redelivery. Nothing more starts.
        return { runUid, started: false };
      }
    },
    async status(scope) { return call ? call(scope, '/status', {}) : { scope: scopeName(scope), halted: false, live: [], schedules: [], updated_at: Date.now() }; },
    async halt(scope, reason) {
      if (scope === 'all') {
        await env.RATE_LIMITS.put('agents:halt', reason.slice(0, 64) || 'halt');
        return;
      }
      if (call) await call(scope, '/halt', { reason: reason.slice(0, 64) });
      else await putScopeSettings(env, scope, { paused: true }, null);
    },
    async rebuild(scope) { return call ? call(scope, '/rebuild', {}) : { scope: scopeName(scope), halted: false, live: [], schedules: [], updated_at: Date.now() }; },
    async erase(scope, agentId) {
      if (call) { await call(scope, '/erase', { agentId }); return; }
      // No object: the instances still end. With no Workflow binding there are none.
      if (!env.AGENT_TASK) return;
      const runs = agentId != null ? await openRunsOf(env, agentId) : await openRunsInScope(env, scope);
      for (const r of runs) await terminateRun(env, r.uid);
    },
  };
}

/** Tell the scope's object a run moved, so the live view follows. Best effort. */
export async function trackRun(env: Env, scope: ScopeRef, run: RunRow | LiveRun, call: ScopeCaller | null = bindingCaller(env)) {
  if (!call) return;
  const live = 'uid' in run ? liveOf(run) : run;
  try { await call(scope, '/track', { run: live }); } catch { console.warn('[agents] track_failed'); }
}

