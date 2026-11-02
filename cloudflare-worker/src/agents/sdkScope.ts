/**
 * #3852 (E0 of #3742, under D1528) — the `sdk` runtime's behaviour, without
 * the `agents` package. `sdkRuntime.ts` is the one file that imports the
 * package: its `ScopeAgent extends Agent` hands this core the slice of the
 * Agent it uses (`SdkHost`), the way `AgentScope` hands `ScopeCore` its
 * storage. So `node --test` drives the same core over a fake of that slice,
 * and the runtime contract suite (`agent_runtime_contract.test.ts`) runs
 * every case on `sdk` as it does on `do`.
 *
 * What the SDK carries here, and what it does not:
 *   - state: the Agent's own `state` (`setState` persists it and pushes it
 *     to any connected client, which is the live status); it holds
 *     `halted` and the live runs. Like the `do` object's storage, it is a
 *     cache of D1: `rebuild` restores it from D1 alone.
 *   - duties: one `schedule(Date, 'dutyDue', payload)` per duty. The SDK
 *     deletes a one-shot schedule after its callback; the callback never
 *     throws, so a duty fires once. The payload keeps the exact millisecond
 *     (the SDK's own `time` is whole seconds).
 *   - a run: `runWorkflow('AGENT_TASK', ...)` over the same
 *     `AgentTaskWorkflow` as `do`, with the run uid as the instance id, so a
 *     second start is refused by Workflows and a decision reaches it the
 *     same way (`deliverDecision`, only from the approvals queue).
 *   - admission: D1 decides it (`admitInScope`), one at a time
 *     (`blockConcurrencyWhile` in the Agent).
 * It never calls a model, never uses an SDK tool, and never resolves an
 * approval: the three rules, each a test (`agents_sdk_rules_3852.test.ts`).
 */
import type { Env } from '../types';
import { openRunsInScope, openRunsOf, putScopeSettings } from './engine';
import { DO_DEPS, terminateRun, type DutyEntry, type ScopeCaller, type ScopeDeps } from './doRuntime';
import {
  scopeName, type Admission, type AgentRuntime, type LiveRun, type RunHandle, type ScopeRef, type ScopeStatus, type Trigger,
} from './runtime';

/** The Workflow binding a run starts on: the same one `do` uses. */
export const RUN_WORKFLOW = 'AGENT_TASK';
/** The Agent method a duty's schedule calls. */
export const DUTY_CALLBACK = 'dutyDue';

export type SdkScopeState = { halted: boolean; live: LiveRun[] };
export const EMPTY_STATE: SdkScopeState = Object.freeze({ halted: false, live: [] }) as SdkScopeState;

export type DutyPayload = { dutyId: number; agentId: number | null; at: number };
/** The fields of the SDK's `Schedule` this core reads. */
export type SdkSchedule = { id: string; callback: string; payload: unknown };

/** The slice of the SDK's `Agent` the core uses. `ScopeAgent` passes itself. */
export interface SdkHost {
  readState(): SdkScopeState;
  setState(s: SdkScopeState): void;
  schedule(when: Date, callback: typeof DUTY_CALLBACK, payload: DutyPayload): Promise<{ id: string }>;
  cancelSchedule(id: string): Promise<boolean>;
  listSchedules(): Promise<SdkSchedule[]>;
  /** Resolves to the instance id; throws when an instance with that id exists. */
  runWorkflow(name: typeof RUN_WORKFLOW, params: { run_uid: string }, options: { id: string }): Promise<string>;
}

const isDuty = (s: SdkSchedule): s is SdkSchedule & { payload: DutyPayload } => {
  const p = s.payload as Partial<DutyPayload> | null;
  return s.callback === DUTY_CALLBACK && !!p && Number.isSafeInteger(p.dutyId) && Number.isFinite(p.at);
};

export class SdkScopeCore {
  private host: SdkHost;
  private env: Env;
  private deps: ScopeDeps;
  constructor(host: SdkHost, env: Env, deps: ScopeDeps) {
    this.host = host; this.env = env; this.deps = deps;
  }

  private state(): SdkScopeState {
    const s = this.host.readState();
    return { halted: !!s?.halted, live: Array.isArray(s?.live) ? s.live : [] };
  }

  private put(patch: Partial<SdkScopeState>) {
    this.host.setState({ ...this.state(), ...patch });
  }

  private async duties() {
    return (await this.host.listSchedules()).filter(isDuty).sort((a, b) => a.payload.at - b.payload.at);
  }

  async status(scope: ScopeRef): Promise<ScopeStatus> {
    const s = this.state();
    return {
      scope: scopeName(scope),
      halted: s.halted,
      live: s.live,
      schedules: (await this.duties()).map((d) => ({ dutyId: d.payload.dutyId, at: d.payload.at })),
      updated_at: this.deps.now(),
    };
  }

  async admit(scope: ScopeRef, t: Trigger): Promise<Admission> {
    if (this.state().halted) {
      return { ok: false, status: 403, code: 'scope_paused', message: 'Agents are paused on this team. An editor can resume them.' };
    }
    // D1 decides duplicates, never this cache (as in `do`).
    const a = await this.deps.admitRow(this.env, scope, t);
    if (!a.ok) return a;
    await this.track({ run_uid: a.run.uid, agent_id: t.agentId, task_id: t.taskId, status: 'admitted' });
    try {
      await this.deps.enqueue(this.env, a.run.uid);
    } catch {
      console.warn('[agents] enqueue_failed');
    }
    return a;
  }

  async track(run: LiveRun) {
    const rest = this.state().live.filter((l) => l.run_uid !== run.run_uid);
    const open = ['admitted', 'running', 'waiting_decision'].includes(run.status);
    this.put({ live: open ? [...rest, run] : rest });
  }

  async schedule(d: DutyEntry) {
    if (!Number.isSafeInteger(d.dutyId) || !Number.isFinite(d.at)) return;
    await this.cancelSchedule(d.dutyId);
    await this.host.schedule(new Date(d.at), DUTY_CALLBACK, { dutyId: d.dutyId, agentId: d.agentId ?? null, at: d.at });
  }

  async cancelSchedule(dutyId: number) {
    for (const s of await this.duties()) if (s.payload.dutyId === dutyId) await this.host.cancelSchedule(s.id);
  }

  /** The SDK calls this when a duty's schedule is due. It never throws, so the SDK deletes the schedule: once. */
  async dutyDue(scope: ScopeRef, payload: DutyPayload) {
    try { await this.deps.dutyDue(this.env, scope, payload.dutyId, payload.at); } catch { console.warn('[agents] duty_due_failed'); }
  }

  async halt(scope: ScopeRef) {
    this.put({ halted: true });
    await this.deps.pauseScope(this.env, scope);
  }

  async rebuild(scope: ScopeRef): Promise<ScopeStatus> {
    const r = await this.deps.restore(this.env, scope);
    for (const s of await this.duties()) await this.host.cancelSchedule(s.id);
    this.host.setState({ halted: r.paused, live: r.live });
    for (const d of r.duties) await this.schedule(d);
    return this.status(scope);
  }

  async erase(agentId: number | null) {
    for (const l of this.state().live) {
      if (agentId != null && l.agent_id !== agentId) continue;
      try { await this.deps.terminate(this.env, l.run_uid); } catch { console.warn('[agents] terminate_failed'); }
      await this.track({ ...l, status: 'cancelled' });
    }
    for (const s of await this.duties()) {
      if (agentId != null && s.payload.agentId !== agentId) continue;
      await this.host.cancelSchedule(s.id);
    }
    if (agentId == null) this.host.setState({ ...EMPTY_STATE, live: [] });
  }

  /** Starts the run's `AgentTaskWorkflow` instance through the SDK; a second start is a no-op. */
  async startRun(runUid: string): Promise<RunHandle> {
    if (!this.env.AGENT_TASK) return { runUid, started: false };
    try {
      await this.host.runWorkflow(RUN_WORKFLOW, { run_uid: runUid }, { id: runUid });
      return { runUid, started: true };
    } catch {
      return { runUid, started: false };
    }
  }
}

/** One request to the scope's Agent, by path: the same protocol as the `do` object, plus `/start`. */
export async function dispatchSdk(core: SdkScopeCore, scope: ScopeRef, path: string, body: Record<string, any>): Promise<unknown> {
  switch (path) {
    case '/admit': return core.admit(scope, body.trigger as Trigger);
    case '/track': await core.track(body.run as LiveRun); return { ok: true };
    case '/schedule': await core.schedule(body.duty as DutyEntry); return { ok: true };
    case '/cancel-schedule': await core.cancelSchedule(Number(body.dutyId)); return { ok: true };
    case '/status': return core.status(scope);
    case '/halt': await core.halt(scope); return { ok: true };
    case '/rebuild': return core.rebuild(scope);
    case '/erase': await core.erase(body.agentId == null ? null : Number(body.agentId)); return { ok: true };
    case '/start': return core.startRun(String(body.runUid));
    default: return { error: 'not_found' };
  }
}

/** The production deps: the same as `do`'s, so both runtimes admit, restore and erase by the same D1 rules. */
export const SDK_DEPS: ScopeDeps = DO_DEPS;

const unavailable = { ok: false as const, status: 503, code: 'engine_unavailable', message: 'The agent engine is not set up here yet.' };
const emptyStatus = (scope: ScopeRef): ScopeStatus => ({ scope: scopeName(scope), halted: false, live: [], schedules: [], updated_at: Date.now() });

/** The `sdk` runtime over a caller. `sdkRuntime.ts` passes one over the Agent binding; tests pass one over `SdkScopeCore`. */
export function sdkRuntimeOver(env: Env, call: ScopeCaller | null): AgentRuntime {
  return {
    name: 'sdk',
    async admit(scope, trigger) { return call ? call(scope, '/admit', { trigger }) : unavailable; },
    async schedule(scope, duty) { if (call) await call(scope, '/schedule', { duty }); },
    async cancelSchedule(scope, dutyId) { if (call) await call(scope, '/cancel-schedule', { dutyId }); },
    async startRun(scope, runUid) { return call ? call(scope, '/start', { runUid }) : { runUid, started: false }; },
    async status(scope) { return call ? call(scope, '/status', {}) : emptyStatus(scope); },
    async halt(scope, reason) {
      if (scope === 'all') {
        await env.RATE_LIMITS.put('agents:halt', reason.slice(0, 64) || 'halt');
        return;
      }
      if (call) await call(scope, '/halt', { reason: reason.slice(0, 64) });
      else await putScopeSettings(env, scope, { paused: true }, null);
    },
    async rebuild(scope) { return call ? call(scope, '/rebuild', {}) : emptyStatus(scope); },
    async erase(scope, agentId) {
      if (call) { await call(scope, '/erase', { agentId }); return; }
      if (!env.AGENT_TASK) return;
      const runs = agentId != null ? await openRunsOf(env, agentId) : await openRunsInScope(env, scope);
      for (const r of runs) await terminateRun(env, r.uid);
    },
  };
}
