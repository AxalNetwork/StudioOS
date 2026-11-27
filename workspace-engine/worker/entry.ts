/** D5566: the private entrypoint's gate, kept free of `cloudflare:workers` so contract tests reach it; refusals precede any Durable Object lookup. */
import { workspaceRefusal, trustedWorkspaceSpec, type ExecutionRef, type WorkspaceResult } from '../../cloudflare-worker/src/services/agents/workspaceSpec';
import { workspaceExecutionId, type WorkspaceBroker } from './controller';
import { validWorkspaceRef, type WorkspaceStub } from './executor';

export type EntryEnv = {
  WORKSPACE_PILOT?: string;
  WORKSPACES?: { getByName(name: string): WorkspaceStub };
};

/** Only the literal "preview" admits new work. Any other value, a typo included, leaves the pilot off. */
export const pilotEnabled = (env: Pick<EntryEnv, 'WORKSPACE_PILOT'>): boolean => env.WORKSPACE_PILOT === 'preview';

/** Used while no reviewed broker service is bound: every admission and acceptance is refused, never allowed. */
export const unavailableBroker: WorkspaceBroker = {
  admit: async () => workspaceRefusal('workspace_broker_unavailable', 503),
  accept: async () => workspaceRefusal('workspace_broker_unavailable', 503),
};

/** New admission: pilot flag first, then the strict spec, then the one Durable Object named by tenant/run/attempt/generation. */
export async function entryCreate(env: EntryEnv, input: unknown, ticket: string): Promise<WorkspaceResult<unknown>> {
  if (!pilotEnabled(env) || !env.WORKSPACES) return workspaceRefusal('workspace_preview_disabled', 403);
  const parsed = trustedWorkspaceSpec(input); if (!parsed.ok) return parsed;
  return env.WORKSPACES.getByName(await workspaceExecutionId(parsed.value)).create(parsed.value, ticket);
}

/**
 * Status, cancel, collect and cleanup on an existing execution. These stay reachable when the pilot flag is off, so a
 * disabled pilot can still be stopped and cleaned; the host re-checks the audience-bound ticket before acting.
 */
export async function entryControl<K extends 'get' | 'terminate' | 'collect' | 'cleanup'>(env: EntryEnv, method: K, ref: ExecutionRef, ticket: string):
  Promise<Awaited<ReturnType<WorkspaceStub[K]>> | ReturnType<typeof workspaceRefusal>> {
  if (!env.WORKSPACES || !validWorkspaceRef(ref) || ref.execution_id !== await workspaceExecutionId(ref)) return workspaceRefusal('invalid_execution_ref', 403);
  const stub = env.WORKSPACES.getByName(ref.execution_id);
  return await (stub[method] as (ref: ExecutionRef, ticket: string) => ReturnType<WorkspaceStub[K]>)(ref, ticket);
}
