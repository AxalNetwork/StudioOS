/** D5566: separate preview-only coding host. No public HTTP API, D1/R2 binding or vendor credential. */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { workspaceRefusal, trustedWorkspaceSpec, type ExecutionRef } from '../../cloudflare-worker/src/services/agents/workspaceSpec';
import { createWorkspaceHost, workspaceExecutionId, type HostRow, type WorkspaceBroker } from './controller';
import { validWorkspaceRef } from './executor';

export interface Env {
  WORKSPACE_PILOT?: string;
  WORKSPACES?: DurableObjectNamespace<CodingWorkspace>;
  // Intentionally absent from the candidate config until the real authorized main-Worker bridge is reviewed.
  WORKSPACE_BROKER?: WorkspaceBroker;
}
const unavailable: WorkspaceBroker = { admit: async () => workspaceRefusal('workspace_broker_unavailable', 503), accept: async () => workspaceRefusal('workspace_broker_unavailable', 503) };

export class CodingWorkspace extends DurableObject<Env> {
  #host: ReturnType<typeof createWorkspaceHost>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#host = createWorkspaceHost({
      enabled: () => env.WORKSPACE_PILOT === 'preview', container: ctx.container, broker: env.WORKSPACE_BROKER || unavailable,
      clock: () => Date.now(), pause: ms => new Promise(done => setTimeout(done, ms)), background: work => ctx.waitUntil(work),
      store: {
        read: async () => await ctx.storage.get<HostRow>('execution') || null,
        replace: (expected, next) => ctx.storage.transaction(async transaction => {
          const current = await transaction.get<HostRow>('execution');
          if ((current?.revision ?? null) !== expected) return false;
          await transaction.put('execution', next); return true;
        }),
        alarm: at => at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at),
      },
    });
  }
  create(input: unknown, ticket: string) { return this.#host.create(input, ticket); }
  get(ref: ExecutionRef, ticket: string) { return this.#host.get(ref, ticket); }
  terminate(ref: ExecutionRef, ticket: string) { return this.#host.terminate(ref, ticket); }
  collect(ref: ExecutionRef, ticket: string) { return this.#host.collect(ref, ticket); }
  cleanup(ref: ExecutionRef, ticket: string) { return this.#host.cleanup(ref, ticket); }
  alarm() { return this.#host.expire(); }
  fetch() { return new Response('Not found', { status: 404 }); }
}

export default class WorkspaceHost extends WorkerEntrypoint<Env> {
  fetch() { return new Response('Not found', { status: 404 }); }
  async create(input: unknown, ticket: string) {
    if (this.env.WORKSPACE_PILOT !== 'preview' || !this.env.WORKSPACES) return workspaceRefusal('workspace_preview_disabled', 403);
    const parsed = trustedWorkspaceSpec(input); if (!parsed.ok) return parsed;
    return this.env.WORKSPACES.getByName(await workspaceExecutionId(parsed.value)).create(parsed.value, ticket);
  }
  async get(ref: ExecutionRef, ticket: string) {
    if (!this.env.WORKSPACES || !validWorkspaceRef(ref) || ref.execution_id !== await workspaceExecutionId(ref)) return workspaceRefusal('invalid_execution_ref', 403);
    return this.env.WORKSPACES.getByName(ref.execution_id).get(ref, ticket);
  }
  async terminate(ref: ExecutionRef, ticket: string) {
    if (!this.env.WORKSPACES || !validWorkspaceRef(ref) || ref.execution_id !== await workspaceExecutionId(ref)) return workspaceRefusal('invalid_execution_ref', 403);
    return this.env.WORKSPACES.getByName(ref.execution_id).terminate(ref, ticket);
  }
  async collect(ref: ExecutionRef, ticket: string) {
    if (!this.env.WORKSPACES || !validWorkspaceRef(ref) || ref.execution_id !== await workspaceExecutionId(ref)) return workspaceRefusal('invalid_execution_ref', 403);
    return this.env.WORKSPACES.getByName(ref.execution_id).collect(ref, ticket);
  }
  async cleanup(ref: ExecutionRef, ticket: string) {
    if (!this.env.WORKSPACES || !validWorkspaceRef(ref) || ref.execution_id !== await workspaceExecutionId(ref)) return workspaceRefusal('invalid_execution_ref', 403);
    return this.env.WORKSPACES.getByName(ref.execution_id).cleanup(ref, ticket);
  }
}
