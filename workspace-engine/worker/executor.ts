/** D5566: Cloudflare ExecutorAdapter; every private host operation carries a fresh, audience-bound broker ticket. */
import { executorEligibility, trustedWorkspaceSpec, workspaceRefusal, type ExecutionRef, type ExecutorAdapter,
  type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec } from '../../cloudflare-worker/src/services/agents/workspaceSpec';
import type { WorkspaceAudience } from '../../cloudflare-worker/src/services/agents/workspaceSecurity';
import { workspaceExecutionId, type createWorkspaceHost } from './controller';

export type WorkspaceStub = Omit<ReturnType<typeof createWorkspaceHost>, 'expire'>;
export interface ExecutorGateway {
  enabled(): boolean;
  capabilities(): Promise<ExecutorCapabilities>;
  estimate(spec: WorkspaceSpec): Promise<WorkspaceResult<{ cost_microusd: number; measured: boolean }>>;
  ticket(audience: WorkspaceAudience, target: WorkspaceSpec | ExecutionRef): Promise<WorkspaceResult<string>>;
  getByName(name: string): WorkspaceStub;
}

export function validWorkspaceRef(ref: ExecutionRef): boolean {
  return Boolean(ref && ref.provider === 'cloudflare' && /^ws-[a-f0-9]{64}$/.test(ref.execution_id) && Number.isSafeInteger(ref.tenant_id) && ref.tenant_id > 0
    && Number.isSafeInteger(ref.attempt) && ref.attempt > 0 && Number.isSafeInteger(ref.execution_generation) && ref.execution_generation > 0
    && typeof ref.run_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(ref.run_id) && /^[a-z][a-z0-9-]{1,31}$/.test(ref.region));
}
export function createCloudflareExecutor(gateway: ExecutorGateway): ExecutorAdapter {
  const call = async <T>(ref: ExecutionRef, audience: WorkspaceAudience, run: (stub: WorkspaceStub, ticket: string) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> => {
    if (!validWorkspaceRef(ref) || ref.execution_id !== await workspaceExecutionId(ref)) return workspaceRefusal('invalid_execution_ref', 403);
    const grant = await gateway.ticket(audience, ref); if (!grant.ok) return grant;
    return run(gateway.getByName(ref.execution_id), grant.value);
  };
  return {
    capabilities: () => gateway.capabilities(),
    estimate: async input => {
      const parsed = trustedWorkspaceSpec(input); if (!parsed.ok) return parsed;
      if (gateway.enabled() !== true) return workspaceRefusal('workspace_preview_disabled', 403);
      const estimate = await gateway.estimate(parsed.value);
      if (estimate.ok && (!Number.isSafeInteger(estimate.value.cost_microusd) || estimate.value.cost_microusd < 0 || estimate.value.cost_microusd > parsed.value.max_cost_microusd)) return workspaceRefusal('workspace_cost_denied', 403);
      return estimate;
    },
    create: async input => {
      const parsed = trustedWorkspaceSpec(input); if (!parsed.ok) return parsed;
      if (gateway.enabled() !== true) return workspaceRefusal('workspace_preview_disabled', 403);
      const eligibility = executorEligibility(parsed.value, await gateway.capabilities()); if (!eligibility.ok) return eligibility;
      const ticket = await gateway.ticket('executor.bootstrap', parsed.value); if (!ticket.ok) return ticket;
      return gateway.getByName(await workspaceExecutionId(parsed.value)).create(parsed.value, ticket.value);
    },
    get: ref => call(ref, 'executor.status', (stub, ticket) => stub.get(ref, ticket)),
    terminate: ref => call(ref, 'executor.cancel', (stub, ticket) => stub.terminate(ref, ticket)),
    collect: ref => call(ref, 'executor.collect', (stub, ticket) => stub.collect(ref, ticket)),
    cleanup: ref => call(ref, 'executor.cleanup', (stub, ticket) => stub.cleanup(ref, ticket)),
  };
}
