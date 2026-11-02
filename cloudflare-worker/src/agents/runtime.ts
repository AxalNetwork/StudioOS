/**
 * D1528 (#3847, E3 of #3742) — THE SEAM. Everything outside `src/agents/`
 * reaches the agent runtime through `agentRuntime(env)` and the
 * `AgentRuntime` interface below, never through a Durable Object or a
 * Workflow binding directly, so the runtime behind it can be switched
 * (`AGENT_RUNTIME`, the runbook `documentation/operations/AGENT_RUNTIME_SWITCH.md`).
 *
 *   do   `doRuntime.ts`: one `AgentScope` Durable Object per scope plus the
 *        `AgentTaskWorkflow`. The only runtime built; the default.
 *   sdk  `sdkRuntime.ts`: NOT BUILT (E0 evaluates it). Asking for it falls
 *        back to `do`, loudly, rather than running nothing.
 *
 * Only `sdkRuntime.ts` may import the `agents` package; a test fails on any
 * other import of it.
 *
 * Also here: the engine's state as every caller reads it, so the kill switch
 * is written once.
 *   AGENT_ENGINE   off | paused | canary | on (var; anything else is `off`).
 *                  `paused` stops admissions only; a run already admitted
 *                  carries on to its proposal.
 *   agents:halt    KV (`RATE_LIMITS`): set, every run ends at its next step
 *                  and nothing is admitted. Read at every step.
 *   agents:paused  KV: the platform circuit breaker. A gateway limit sets it;
 *                  while set the engine reads `paused`. Cleared by a person.
 */
import type { Env } from '../types';

export type ScopeKind = 'company' | 'project';
/** A scope by its immutable id, never a name. */
export type ScopeRef = { kind: ScopeKind; id: number };
export const scopeName = (s: ScopeRef) => `${s.kind}:${s.id}`;

export type EngineMode = 'off' | 'paused' | 'canary' | 'on';
export const ENGINE_MODES: readonly EngineMode[] = ['off', 'paused', 'canary', 'on'];
export type Autonomy = 'manual' | 'self_start';
export type RuntimeName = 'do' | 'sdk';

export const HALT_KEY = 'agents:halt';
export const BREAKER_KEY = 'agents:paused';
/** At most this many runs of one agent a UTC day (`daily_limit`). */
export const DAILY_LIMIT = 20;
/** At most this many proposals waiting in one scope (`queue_full` at the sixth). */
export const OPEN_PROPOSALS_MAX = 5;

/** What admits a run: a person's start, the sweep, a decided run's `after`, a duty. */
export type Trigger = { agentId: number; taskId: number; by: number | null; source: 'person' | 'sweep' | 'after' | 'duty' };
export type Refusal = { ok: false; status: number; code: string; message: string };
export type Admission = { ok: true; run: { uid: string; attempt: number } } | Refusal;
/** A duty's next firing, as an epoch millisecond. */
export type DutyTimer = { dutyId: number; at: number };
export type RunHandle = { runUid: string; started: boolean };
export type LiveRun = { run_uid: string; agent_id: number; task_id: number; status: string };
export type ScopeStatus = { scope: string; halted: boolean; live: LiveRun[]; schedules: DutyTimer[]; updated_at: number };

export interface AgentRuntime {
  readonly name: RuntimeName;
  /** Single writer per scope; refuses duplicates. */
  admit(scope: ScopeRef, trigger: Trigger): Promise<Admission>;
  schedule(scope: ScopeRef, duty: DutyTimer): Promise<void>;
  cancelSchedule(scope: ScopeRef, dutyId: number): Promise<void>;
  /** Starts the Workflow instance; a second start of one run is a no-op. */
  startRun(scope: ScopeRef, runUid: string): Promise<RunHandle>;
  /** The live board feed. */
  status(scope: ScopeRef): Promise<ScopeStatus>;
  halt(scope: ScopeRef | 'all', reason: string): Promise<void>;
  /** Restores schedules and status from D1. E7's admin route calls it. */
  rebuild(scope: ScopeRef): Promise<ScopeStatus>;
  /** The product amendment: an agent removed, a scope deleted, an account deleted. */
  erase(scope: ScopeRef, agentId: number | null): Promise<void>;
}

/** The var as a mode: anything unknown is `off`. */
export function engineVar(env: Pick<Env, 'AGENT_ENGINE'>): EngineMode {
  const v = String(env.AGENT_ENGINE ?? '').trim();
  return (ENGINE_MODES as readonly string[]).includes(v) ? (v as EngineMode) : 'off';
}

/** The mode in force: the var, lowered to `paused` while the circuit breaker is set. A breaker that cannot be read counts as set. */
export async function engineMode(env: Pick<Env, 'AGENT_ENGINE' | 'RATE_LIMITS'>): Promise<EngineMode> {
  const v = engineVar(env);
  if (v === 'off' || v === 'paused') return v;
  try {
    return (await env.RATE_LIMITS.get(BREAKER_KEY)) ? 'paused' : v;
  } catch {
    return 'paused';
  }
}

/** True when the halt key is set. A key that cannot be read counts as set: a halt must never be missed. */
export async function haltedAll(env: Pick<Env, 'RATE_LIMITS'>): Promise<boolean> {
  try {
    return !!(await env.RATE_LIMITS.get(HALT_KEY));
  } catch {
    return true;
  }
}

/** `manual` unless the var says exactly `self_start`. */
export const autonomy = (env: Pick<Env, 'AGENT_AUTONOMY'>): Autonomy => (env.AGENT_AUTONOMY === 'self_start' ? 'self_start' : 'manual');

/** `do` unless the var names another runtime that exists. Only `do` exists. */
export const runtimeName = (env: Pick<Env, 'AGENT_RUNTIME'>): RuntimeName => (env.AGENT_RUNTIME === 'sdk' ? 'sdk' : 'do');

/** The runtime behind the seam. `sdk` is not built, so it falls back to `do`. */
export async function agentRuntime(env: Env): Promise<AgentRuntime> {
  if (runtimeName(env) === 'sdk') console.warn('[agents] AGENT_RUNTIME=sdk is not built; using do');
  const { doRuntime } = await import('./doRuntime');
  return doRuntime(env);
}
