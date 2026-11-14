/** D5571: disabled, unmounted Azure Container Apps Jobs ExecutorAdapter over an injected ARM transport; fails closed on every unverified capability. */
import { executorEligibility, trustedWorkspaceSpec, workspaceRefusal, type ExecutionRef, type ExecutionStatus, type ExecutorAdapter,
  type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec, type WorkspaceState } from './workspaceSpec';

/** The ARM API version the request shapes below were read from (Microsoft.App, 2026-07-01). */
export const AZURE_JOBS_API_VERSION = '2026-07-01';

/**
 * One Azure Resource Manager call. The transport is the privileged broker: it attaches a short-lived token from
 * workload identity federation. This module never sees a credential, and none reaches the container.
 */
export type ArmRequest = { method: 'GET' | 'POST'; path: string; body?: unknown };
export type ArmResponse = { status: number; body: unknown };
export interface ArmTransport { request(req: ArmRequest): Promise<ArmResponse> }

/**
 * One pre-provisioned manual-trigger job, as an operator configured it. Every capability defaults to the safe
 * answer: an unset network mode, untrusted-code isolation or checkpoint support is refused, never assumed.
 */
export type AzureJobsConfig = {
  enabled: boolean;
  subscription_id: string; resource_group: string; job_name: string;
  /** Repository without tag or digest, e.g. `example.azurecr.io/workspace`. The spec's digest is appended. */
  registry_repository: string;
  /** Axal region codes this job's environment satisfies. */
  regions: string[];
  /** The job's configured replicaTimeout. A spec asking for longer is refused: Azure sets it per job, not per execution. */
  replica_timeout_s: number;
  cpu_max: number; memory_mb_max: number; disk_mb_max: number; concurrency_max: number;
  /** Modes the environment's network actually enforces (VNet, firewall). Empty means none is verified. */
  enforced_network_modes: WorkspaceSpec['network_policy']['mode'][];
  /** True only when an operator has attested hostile-code isolation for this environment. */
  untrusted_code: boolean;
  checkpoint_restore: boolean;
  /** Integer micro-USD per vCPU-second and per GiB-second, or null when nobody has priced it. */
  rates: { vcpu_second_microusd: number; gib_second_microusd: number } | null;
};

const SAFE_NAME = /^[-\w.()]{1,260}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPOSITORY = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9-]+)+(\/[a-z0-9._-]+)+$/;

/** Azure's execution states, mapped onto the D5565 state machine. Anything else is `unknown`, never a guess. */
export const AZURE_STATUS: Readonly<Record<string, WorkspaceState>> = Object.freeze({
  Processing: 'provisioning', Running: 'running', Succeeded: 'finished',
  Failed: 'failed', Degraded: 'failed', Stopped: 'cancelled', Unknown: 'unknown',
});
const TERMINAL: readonly WorkspaceState[] = ['finished', 'failed', 'cancelled'];

/** The key every execution carries in a plain env var, so an ambiguous start can be found again without a second start. */
export const executionKey = (spec: Pick<WorkspaceSpec, 'tenant_id' | 'run_id' | 'attempt' | 'execution_generation'>) =>
  `${spec.tenant_id}.${spec.run_id}.a${spec.attempt}.g${spec.execution_generation}`;

export function createAzureJobsExecutor({ config, transport }: { config: AzureJobsConfig; transport: ArmTransport }): ExecutorAdapter {
  const valid = config && typeof config.enabled === 'boolean' && UUID.test(config.subscription_id) && SAFE_NAME.test(config.resource_group)
    && SAFE_NAME.test(config.job_name) && REPOSITORY.test(config.registry_repository) && Array.isArray(config.regions)
    && Number.isSafeInteger(config.replica_timeout_s) && config.replica_timeout_s > 0 && Number.isSafeInteger(config.concurrency_max);
  if (!valid) throw new Error('Invalid Azure Jobs configuration');
  const jobPath = `/subscriptions/${config.subscription_id}/resourceGroups/${config.resource_group}/providers/Microsoft.App/jobs/${config.job_name}`;
  const q = `?api-version=${AZURE_JOBS_API_VERSION}`;
  const off = () => workspaceRefusal('provider_disabled', 503);

  const capabilities: ExecutorCapabilities = Object.freeze({
    provider: 'azure', revision: `aca-jobs-${AZURE_JOBS_API_VERSION}`, workload_classes: ['coding_trusted', 'coding_untrusted'],
    digest_pulls: true, shell: true, untrusted_code: config.untrusted_code === true,
    cpu_max: config.cpu_max, memory_mb_max: config.memory_mb_max, disk_mb_max: config.disk_mb_max, duration_s_max: config.replica_timeout_s,
    enforced_network_modes: [...(config.enforced_network_modes || [])], enforced_regions: [...config.regions],
    gpu: false, interrupt: true, checkpoint_restore: config.checkpoint_restore === true,
    concurrency_max: config.concurrency_max > 0 ? config.concurrency_max : null,
  }) as ExecutorCapabilities;

  /** An Azure error status as a refusal. Provider text is never copied into it. */
  function refusalFor(status: number) {
    if (status === 401 || status === 403) return workspaceRefusal('provider_auth_refused', 403);
    if (status === 409 || status === 429) return workspaceRefusal('provider_quota', 503);
    if (status === 404) return workspaceRefusal('execution_not_found', 409);
    if (status >= 400 && status < 500) return workspaceRefusal('provider_rejected', 422);
    return workspaceRefusal('provider_unavailable', 503);
  }
  const envOf = (execution: any) => {
    const env = execution?.properties?.template?.containers?.[0]?.env;
    return Array.isArray(env) ? Object.fromEntries(env.filter((e: any) => typeof e?.name === 'string').map((e: any) => [e.name, e.value])) : {};
  };
  const status = (ref: ExecutionRef, state: WorkspaceState, failure_code?: string): WorkspaceResult<ExecutionStatus> =>
    ({ ok: true, value: { ref, state, ...(failure_code ? { failure_code } : {}) } });

  /** Every execution of the job carrying this key, following nextLink inside the same job only. */
  async function findByKey(key: string): Promise<WorkspaceResult<any[]>> {
    const found: any[] = [];
    let path: string | null = `${jobPath}/executions${q}`;
    for (let page = 0; path && page < 20; page++) {
      let res: ArmResponse;
      try { res = await transport.request({ method: 'GET', path }); } catch { return workspaceRefusal('provider_unavailable', 503); }
      if (res.status !== 200) return refusalFor(res.status);
      const body = res.body as any;
      for (const execution of Array.isArray(body?.value) ? body.value : []) if (envOf(execution).AXAL_EXECUTION_KEY === key) found.push(execution);
      const next = typeof body?.nextLink === 'string' ? body.nextLink : null;
      path = next && next.startsWith(`https://management.azure.com${jobPath}/executions`) ? next.slice('https://management.azure.com'.length) : null;
    }
    return { ok: true, value: found };
  }
  const read = (ref: ExecutionRef, execution: any, key: string): WorkspaceResult<ExecutionStatus> => {
    // Another tenant's or another generation's execution is not this ref's, whatever its name.
    if (envOf(execution).AXAL_EXECUTION_KEY !== key) return workspaceRefusal('execution_not_authorized', 403);
    const raw = execution?.properties?.status;
    const state = AZURE_STATUS[raw] ?? 'unknown';
    return status({ ...ref, execution_id: String(execution.name) }, state, state === 'failed' ? (raw === 'Degraded' ? 'degraded' : 'failed') : undefined);
  };
  const keyOf = (ref: ExecutionRef) => executionKey({ tenant_id: ref.tenant_id, run_id: ref.run_id, attempt: ref.attempt, execution_generation: ref.execution_generation });

  const adapter: ExecutorAdapter = {
    async capabilities() { return structuredClone(capabilities) as ExecutorCapabilities; },

    async estimate(spec) {
      if (!config.enabled) return off();
      const gate = executorEligibility(spec, capabilities);
      if (!gate.ok) return gate;
      // No rates is no estimate: refused, never 0.
      if (!config.rates || !Number.isSafeInteger(config.rates.vcpu_second_microusd) || !Number.isSafeInteger(config.rates.gib_second_microusd)) return workspaceRefusal('estimate_unavailable', 422);
      const cost = Math.ceil(spec.max_duration_s * (spec.cpu * config.rates.vcpu_second_microusd + (spec.memory_mb / 1024) * config.rates.gib_second_microusd));
      return { ok: true, value: { cost_microusd: cost, measured: false } };
    },

    async create(input) {
      if (!config.enabled) return off();
      const parsed = trustedWorkspaceSpec(input);
      if (!parsed.ok) return parsed;
      const spec = parsed.value;
      const gate = executorEligibility(spec, capabilities);
      if (!gate.ok) return gate;
      const key = executionKey(spec);
      const ref: ExecutionRef = { provider: 'azure', execution_id: `pending:${key}`, tenant_id: spec.tenant_id, run_id: spec.run_id,
        attempt: spec.attempt, execution_generation: spec.execution_generation, region: gate.value.region };
      // A start that already happened for this key is returned, never repeated: Azure's start is not idempotent.
      const prior = await findByKey(key);
      if (!prior.ok) return prior;
      if (prior.value.length > 1) return workspaceRefusal('duplicate_execution', 409);
      if (prior.value.length === 1) return read(ref, prior.value[0], key);
      const body = { containers: [{
        name: 'workspace', image: `${config.registry_repository}@${spec.image_digest}`,
        resources: { cpu: spec.cpu, memory: `${spec.memory_mb}Mi`, ephemeralStorage: `${spec.disk_mb}Mi` },
        // References only. Grants reach the runner through the D5567 broker, never through the job template.
        env: [{ name: 'AXAL_EXECUTION_KEY', value: key }, { name: 'AXAL_RUN_ID', value: spec.run_id },
          { name: 'AXAL_EXECUTION_GENERATION', value: String(spec.execution_generation) }],
      }] };
      let res: ArmResponse;
      try { res = await transport.request({ method: 'POST', path: `${jobPath}/start${q}`, body }); }
      catch { return status(ref, 'unknown', 'start_ambiguous'); }
      if (res.status === 200 && typeof (res.body as any)?.name === 'string' && SAFE_NAME.test((res.body as any).name)) {
        return status({ ...ref, execution_id: (res.body as any).name }, 'provisioning');
      }
      // 202 names no execution yet, and a 5xx may still have started one: both are ambiguous, resolved by `get`.
      if (res.status === 202 || res.status >= 500) return status(ref, 'unknown', 'start_ambiguous');
      return refusalFor(res.status);
    },

    async get(ref) {
      if (!config.enabled) return off();
      if (ref?.provider !== 'azure' || !config.regions.includes(ref.region)) return workspaceRefusal('execution_not_authorized', 403);
      const key = keyOf(ref);
      if (ref.execution_id === `pending:${key}`) {
        const found = await findByKey(key);
        if (!found.ok) return found;
        if (found.value.length > 1) return workspaceRefusal('duplicate_execution', 409);
        return found.value.length ? read(ref, found.value[0], key) : status(ref, 'unknown', 'start_ambiguous');
      }
      if (!SAFE_NAME.test(ref.execution_id)) return workspaceRefusal('execution_not_authorized', 403);
      let res: ArmResponse;
      try { res = await transport.request({ method: 'GET', path: `${jobPath}/executions/${ref.execution_id}${q}` }); }
      catch { return status(ref, 'unknown', 'provider_unreachable'); }
      if (res.status !== 200) return res.status >= 500 ? status(ref, 'unknown', 'provider_unreachable') : refusalFor(res.status);
      return read(ref, res.body, key);
    },

    async terminate(ref) {
      const current = await adapter.get(ref);
      if (!current.ok) return current;
      if (TERMINAL.includes(current.value.state)) return current;
      if (current.value.ref.execution_id.startsWith('pending:')) return workspaceRefusal('execution_not_located', 409);
      let res: ArmResponse;
      try { res = await transport.request({ method: 'POST', path: `${jobPath}/executions/${current.value.ref.execution_id}/stop${q}` }); }
      catch { return status(current.value.ref, 'unknown', 'stop_ambiguous'); }
      if (res.status === 200 || res.status === 202) return status(current.value.ref, 'cancelling');
      return res.status >= 500 ? status(current.value.ref, 'unknown', 'stop_ambiguous') : refusalFor(res.status);
    },

    /** Artifacts arrive through the D5565 runner protocol and the D5567 broker; Azure holds none of them. */
    async collect(ref) {
      const current = await adapter.get(ref);
      if (!current.ok) return current;
      if (!TERMINAL.includes(current.value.state)) return workspaceRefusal('execution_not_terminal');
      return { ok: true, value: { manifest_ref: null, checkpoint_manifest_ref: null } };
    },

    /** Azure keeps execution history under the job's retention; there is nothing per execution to delete once it ended. */
    async cleanup(ref) {
      const current = await adapter.get(ref);
      if (!current.ok) return current;
      if (!TERMINAL.includes(current.value.state)) return workspaceRefusal('cleanup_not_terminal');
      return { ok: true, value: { cleaned: true } };
    },
  };
  return adapter;
}
