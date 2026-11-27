/** D5566: separate preview-only coding host. No public HTTP API, D1/R2 binding or vendor credential. */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { type ExecutionRef } from '../../cloudflare-worker/src/services/agents/workspaceSpec';
import { createWorkspaceHost, type HostRow, type WorkspaceBroker } from './controller';
import { entryControl, entryCreate, pilotEnabled, unavailableBroker } from './entry';

export interface Env {
  WORKSPACE_PILOT?: string;
  WORKSPACES?: DurableObjectNamespace<CodingWorkspace>;
  // Intentionally absent from the candidate config until the real authorized main-Worker bridge is reviewed.
  WORKSPACE_BROKER?: WorkspaceBroker;
}

export class CodingWorkspace extends DurableObject<Env> {
  #host: ReturnType<typeof createWorkspaceHost>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#host = createWorkspaceHost({
      enabled: () => pilotEnabled(env), container: ctx.container, broker: env.WORKSPACE_BROKER || unavailableBroker,
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
  #env() { return this.env as unknown as Parameters<typeof entryCreate>[0]; }
  create(input: unknown, ticket: string) { return entryCreate(this.#env(), input, ticket); }
  get(ref: ExecutionRef, ticket: string) { return entryControl(this.#env(), 'get', ref, ticket); }
  terminate(ref: ExecutionRef, ticket: string) { return entryControl(this.#env(), 'terminate', ref, ticket); }
  collect(ref: ExecutionRef, ticket: string) { return entryControl(this.#env(), 'collect', ref, ticket); }
  cleanup(ref: ExecutionRef, ticket: string) { return entryControl(this.#env(), 'cleanup', ref, ticket); }
}
