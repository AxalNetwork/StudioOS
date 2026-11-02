/**
 * #3852 (E0 of #3742, under D1528) — the `sdk` runtime: `ScopeAgent`, an
 * Agents SDK `Agent` per scope (named `project:{id}` or `company:{id}`),
 * behind the same seam as `do`. An EVALUATION: `AGENT_RUNTIME` stays `do`
 * and `runtime.ts` falls back to `do` until a person switches it (the
 * runbook documentation/operations/AGENT_RUNTIME_SWITCH.md).
 *
 * THE ONLY FILE THAT IMPORTS `agents` (`agent_runtime_contract.test.ts`
 * fails on any other import), and the package is pinned to an exact version
 * in `package.json`; an upgrade is its own PR. The class is thin: what it
 * does is `sdkScope.ts`'s `SdkScopeCore`, over this Agent's `state`,
 * `schedule()` and `runWorkflow()`, so the tests drive the same core with a
 * fake of that slice.
 *
 * The three rules (`agents_sdk_rules_3852.test.ts`):
 *   1. No model call but through `run()`: this class calls no model, and
 *      imports no SDK harness, chat agent or model provider.
 *   2. No SDK tool: nothing is imported from the package but `Agent` and
 *      `getAgentByName`; no method is `@callable`; the Agent answers no
 *      request and accepts no connection (`onRequest` 404, `onConnect`
 *      closes), so nothing outside the Worker reaches it.
 *   3. No approval but the approvals queue: it never calls `approveWorkflow`,
 *      `rejectWorkflow` or `waitForApproval`; a decision reaches a waiting run
 *      only through `deliverDecision`, from `POST /queue/:uid/decide`.
 */
import { Agent, getAgentByName, type Connection } from 'agents';
import type { Env } from '../types';
import { scopeOf } from './doRuntime';
import { scopeName, type AgentRuntime, type ScopeRef } from './runtime';
import {
  DUTY_CALLBACK, EMPTY_STATE, RUN_WORKFLOW, SDK_DEPS, SdkScopeCore, dispatchSdk, sdkRuntimeOver,
  type DutyPayload, type SdkHost, type SdkSchedule, type SdkScopeState,
} from './sdkScope';
import type { ScopeCaller, ScopeDeps } from './doRuntime';

/** The binding `ScopeAgent` is reached by, in all three wrangler tables. */
export const SDK_BINDING = 'AGENT_SCOPE_SDK';

export class ScopeAgent extends Agent<Env, SdkScopeState> {
  initialState: SdkScopeState = { ...EMPTY_STATE, live: [] };
  /** D1's side (`DO_DEPS`, shared with `do`). A smoke test on workerd swaps it for fakes. */
  protected deps: ScopeDeps = SDK_DEPS;

  private core(): SdkScopeCore {
    const self = this;
    const host: SdkHost = {
      readState: () => self.state,
      setState: (s) => self.setState(s),
      schedule: (when, callback, payload) => self.schedule(when, callback as keyof ScopeAgent, payload),
      cancelSchedule: (id) => self.cancelSchedule(id),
      listSchedules: async () => (await self.listSchedules()) as SdkSchedule[],
      // The SDK guesses the Agent's binding from the class name (`ScopeAgent` → `SCOPE_AGENT`), which is not ours: name it.
      runWorkflow: (name, params, options) => self.runWorkflow(name as typeof RUN_WORKFLOW, params, { ...options, agentBinding: SDK_BINDING }),
    };
    return new SdkScopeCore(host, this.env, this.deps);
  }

  /** The one RPC method: a path and its body, the `do` object's protocol. One request at a time. */
  async call(path: string, body: Record<string, unknown>): Promise<unknown> {
    const scope = scopeOf(this.name);
    if (!scope) return { error: 'invalid_scope' };
    return this.ctx.blockConcurrencyWhile(() => dispatchSdk(this.core(), scope, path, body));
  }

  /** A duty's schedule is due (`DUTY_CALLBACK`). */
  async dutyDue(payload: DutyPayload) {
    const scope = scopeOf(this.name);
    if (scope) await this.core().dutyDue(scope, payload);
  }

  /** Nothing outside the Worker reaches this Agent: no HTTP, no socket. */
  onRequest(): Response { return new Response('Not found', { status: 404 }); }
  onConnect(connection: Connection) { connection.close(1008, 'not_accepted'); }
}

// The callback name the core schedules is this class's method.
const _callbackIsAMethod: typeof DUTY_CALLBACK extends keyof ScopeAgent ? true : never = true;
void _callbackIsAMethod;

/** POST to the scope's Agent over RPC. Null when the binding is absent. */
export function sdkBindingCaller(env: Env): ScopeCaller | null {
  const ns = env.AGENT_SCOPE_SDK;
  if (!ns) return null;
  return async (scope: ScopeRef, path, body) => {
    const stub = await getAgentByName(ns as unknown as DurableObjectNamespace<ScopeAgent>, scopeName(scope));
    return (stub as unknown as { call(p: string, b: Record<string, unknown>): Promise<unknown> }).call(path, body);
  };
}

/** The `sdk` runtime over the `AGENT_SCOPE_SDK` binding. */
export function sdkRuntime(env: Env): AgentRuntime {
  return sdkRuntimeOver(env, sdkBindingCaller(env));
}
