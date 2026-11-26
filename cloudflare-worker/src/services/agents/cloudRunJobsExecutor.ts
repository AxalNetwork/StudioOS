/** D5571 part 2: disabled, unmounted Google Cloud Run Jobs ExecutorAdapter over an injected Cloud Run v2 transport; fails closed on every unverified capability. */
import { executorEligibility, trustedWorkspaceSpec, workspaceRefusal, type ExecutionRef, type ExecutionStatus, type ExecutorAdapter,
  type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec, type WorkspaceState } from './workspaceSpec';

/** The Cloud Run Admin API version the request shapes below were read from. */
export const CLOUD_RUN_API = 'v2';

/**
 * One Cloud Run Admin API call, path relative to `https://run.googleapis.com`. The transport is the privileged broker:
 * it attaches a short-lived, audience-bound token from Workload Identity Federation. This module never sees a
 * credential, and none reaches the container.
 */
export type CloudRunRequest = { method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown };
export type CloudRunResponse = { status: number; body: unknown };
export interface CloudRunTransport { request(req: CloudRunRequest): Promise<CloudRunResponse> }

/** Durable, atomic insert-if-absent, shared by every adapter for this Cloud Run job.
 * `jobs.run` takes no request id, so a start is not idempotent. A reservation never expires or releases: an absent
 * list result cannot prove a start did not land. Retain it for the lifetime of the execution key, across restarts.
 * Recovery uses a new fenced generation. The host must supply a transactional D1/DO implementation before enabling.
 */
export interface CloudRunStartReservations {
  reserve(key: string): Promise<'acquired' | 'pending' | 'refused'>;
  /** Record a definite provider refusal without releasing the single-use key. */
  refuse(key: string): Promise<void>;
}

/**
 * One pre-provisioned Cloud Run job, as an operator configured it. The job pins the image (an execution cannot
 * override it), the per-task CPU and memory, and must declare one task and no provider retries. Every capability
 * defaults to the safe answer: an unset network mode, untrusted-code isolation or checkpoint support is refused.
 */
export type CloudRunJobsConfig = {
  enabled: boolean;
  project_id: string; location: string; job_name: string;
  /** Repository without tag or digest, e.g. `europe-docker.pkg.dev/project/repo/workspace`. */
  registry_repository: string;
  /** Axal region codes this job's location satisfies. */
  regions: string[];
  /** The longest per-execution task timeout an operator allows; the spec's `max_duration_s` is sent as the override. */
  task_timeout_max_s: number;
  /** The job's per-task limits. Cloud Run's writable filesystem is in memory, so memory + disk must fit `memory_mb_max`. */
  cpu_max: number; memory_mb_max: number; disk_mb_max: number; concurrency_max: number;
  /** Modes the job's egress actually enforces (Direct VPC egress, firewall). Empty means none is verified. */
  enforced_network_modes: WorkspaceSpec['network_policy']['mode'][];
  /** True only when an operator has attested hostile-code isolation for this job's execution environment. */
  untrusted_code: boolean;
  checkpoint_restore: boolean;
  /** Integer micro-USD per vCPU-second and per GiB-second, or null when nobody has priced it. */
  rates: { vcpu_second_microusd: number; gib_second_microusd: number } | null;
};

const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const LOCATION = /^[a-z]+-[a-z]+[0-9]{1,2}$/;
const RESOURCE_ID = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
const REPOSITORY = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9-]+)+(\/[a-z0-9._-]+)+$/;

/**
 * The execution's `Completed` condition, mapped onto the D5565 state machine. A key is the condition state, or
 * `state/executionReason` when Cloud Run gives a reason. An unlisted pair is `unknown`, never a guess.
 */
export const CLOUD_RUN_STATUS: Readonly<Record<string, WorkspaceState>> = Object.freeze({
  CONDITION_PENDING: 'provisioning', CONDITION_RECONCILING: 'provisioning',
  'CONDITION_PENDING/CANCELLING': 'cancelling', 'CONDITION_RECONCILING/CANCELLING': 'cancelling',
  CONDITION_SUCCEEDED: 'finished',
  CONDITION_FAILED: 'failed', 'CONDITION_FAILED/NON_ZERO_EXIT_CODE': 'failed', 'CONDITION_FAILED/DELETED': 'failed',
  'CONDITION_FAILED/CANCELLED': 'cancelled',
});
const TERMINAL: readonly WorkspaceState[] = ['finished', 'failed', 'cancelled'];

/** The key every execution carries in an env override, so an ambiguous start can be found again without a second start. */
export const cloudRunExecutionKey = (spec: Pick<WorkspaceSpec, 'tenant_id' | 'run_id' | 'attempt' | 'execution_generation'>) =>
  `${spec.tenant_id}.${spec.run_id}.a${spec.attempt}.g${spec.execution_generation}`;

export function createCloudRunJobsExecutor({ config, transport, starts }: { config: CloudRunJobsConfig; transport: CloudRunTransport; starts: CloudRunStartReservations }): ExecutorAdapter {
  const valid = config && typeof config.enabled === 'boolean' && PROJECT.test(config.project_id) && LOCATION.test(config.location)
    && RESOURCE_ID.test(config.job_name) && REPOSITORY.test(config.registry_repository) && Array.isArray(config.regions)
    && Number.isSafeInteger(config.task_timeout_max_s) && config.task_timeout_max_s > 0 && Number.isSafeInteger(config.concurrency_max);
  if (!starts || typeof starts.reserve !== 'function' || typeof starts.refuse !== 'function') throw new Error('Missing Cloud Run start reservation store');
  if (!valid) throw new Error('Invalid Cloud Run Jobs configuration');
  const jobName = `projects/${config.project_id}/locations/${config.location}/jobs/${config.job_name}`;
  const jobPath = `/${CLOUD_RUN_API}/${jobName}`;
  const off = () => workspaceRefusal('provider_disabled', 503);

  const capabilities: ExecutorCapabilities = Object.freeze({
    provider: 'gcp', revision: `cloud-run-jobs-${CLOUD_RUN_API}`, workload_classes: ['coding_trusted', 'coding_untrusted'],
    digest_pulls: true, shell: true, untrusted_code: config.untrusted_code === true,
    cpu_max: config.cpu_max, memory_mb_max: config.memory_mb_max, disk_mb_max: config.disk_mb_max, duration_s_max: config.task_timeout_max_s,
    enforced_network_modes: [...(config.enforced_network_modes || [])], enforced_regions: [...config.regions],
    gpu: false, interrupt: true, checkpoint_restore: config.checkpoint_restore === true,
    concurrency_max: config.concurrency_max > 0 ? config.concurrency_max : null,
  }) as ExecutorCapabilities;

  /** The google.rpc status name of an error body. Only the enum is read; the provider's message never is. */
  const rpc = (body: unknown): string => { const s = (body as any)?.error?.status; return typeof s === 'string' ? s : ''; };
  /** A Cloud Run error status as a refusal. Provider text is never copied into it. */
  function refusalFor(status: number, body: unknown) {
    if (status === 401 || status === 403) return workspaceRefusal('provider_auth_refused', 403);
    if (status === 429) return workspaceRefusal('provider_quota', 503);
    if (status === 404) return workspaceRefusal('execution_not_found', 409);
    if (status === 409 && rpc(body) === 'ABORTED') return workspaceRefusal('provider_conflict', 409);
    if (status >= 400 && status < 500) return workspaceRefusal('provider_rejected', 422);
    return workspaceRefusal('provider_unavailable', 503);
  }
  /** A transport failure, a timeout or a 5xx: the request may or may not have taken effect. */
  const ambiguous = (status: number) => status === 408 || status === 499 || status >= 500;
  const envOf = (execution: any) => {
    const env = execution?.template?.containers?.[0]?.env;
    return Array.isArray(env) ? Object.fromEntries(env.filter((e: any) => typeof e?.name === 'string').map((e: any) => [e.name, e.value])) : {};
  };
  const idOf = (execution: any): string | null => {
    const name = typeof execution?.name === 'string' ? execution.name : '';
    const id = name.startsWith(`${jobName}/executions/`) ? name.slice(`${jobName}/executions/`.length) : '';
    return RESOURCE_ID.test(id) ? id : null;
  };
  const status = (ref: ExecutionRef, state: WorkspaceState, failure_code?: string): WorkspaceResult<ExecutionStatus> =>
    ({ ok: true, value: { ref, state, ...(failure_code ? { failure_code } : {}) } });

  /** Every execution of this job carrying the key, following nextPageToken inside the same job only. */
  async function findByKey(key: string): Promise<WorkspaceResult<any[]>> {
    const found: any[] = [];
    let token: string | null = '';
    for (let page = 0; token !== null && page < 20; page++) {
      let res: CloudRunResponse;
      const path = `${jobPath}/executions?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
      try { res = await transport.request({ method: 'GET', path }); } catch { return workspaceRefusal('provider_unavailable', 503); }
      if (res.status !== 200) return refusalFor(res.status, res.body);
      const body = res.body as any;
      for (const execution of Array.isArray(body?.executions) ? body.executions : []) {
        if (idOf(execution) && envOf(execution).AXAL_EXECUTION_KEY === key) found.push(execution);
      }
      token = typeof body?.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
    }
    return { ok: true, value: found };
  }

  /** The D5565 state of an execution this ref owns. Another tenant's, generation's or job's execution is refused. */
  function stateOf(execution: any): { state: WorkspaceState; failure_code?: string } {
    const completed = Array.isArray(execution?.conditions) ? execution.conditions.find((c: any) => c?.type === 'Completed') : null;
    const reason = typeof completed?.executionReason === 'string' && completed.executionReason !== 'EXECUTION_REASON_UNDEFINED' ? completed.executionReason : '';
    const state = CLOUD_RUN_STATUS[reason ? `${completed?.state}/${reason}` : String(completed?.state)] ?? 'unknown';
    if (state === 'provisioning' && Number(execution?.runningCount) > 0) return { state: 'running' };
    if (state === 'failed') return { state, failure_code: reason === 'NON_ZERO_EXIT_CODE' ? 'non_zero_exit' : reason === 'DELETED' ? 'deleted' : 'failed' };
    return { state };
  }
  type Located = { status: ExecutionStatus; execution: any | null };
  const read = (ref: ExecutionRef, execution: any, key: string): WorkspaceResult<Located> => {
    const id = idOf(execution);
    if (!id || envOf(execution).AXAL_EXECUTION_KEY !== key) return workspaceRefusal('execution_not_authorized', 403);
    if (!ref.execution_id.startsWith('pending:') && id !== ref.execution_id) return workspaceRefusal('execution_not_authorized', 403);
    const s = stateOf(execution);
    return { ok: true, value: { status: { ref: { ...ref, execution_id: id }, state: s.state, ...(s.failure_code ? { failure_code: s.failure_code } : {}) }, execution } };
  };
  const keyOf = (ref: ExecutionRef) => cloudRunExecutionKey({ tenant_id: ref.tenant_id, run_id: ref.run_id, attempt: ref.attempt, execution_generation: ref.execution_generation });
  const pending = (ref: ExecutionRef, state: WorkspaceState, failure_code: string): WorkspaceResult<Located> =>
    ({ ok: true, value: { status: { ref, state, failure_code }, execution: null } });

  /** Read the ref's execution and prove this ref owns it. `execution` is null when nothing was located. */
  async function locate(ref: ExecutionRef): Promise<WorkspaceResult<Located>> {
    if (!config.enabled) return off();
    if (ref?.provider !== 'gcp' || !config.regions.includes(ref.region)) return workspaceRefusal('execution_not_authorized', 403);
    const key = keyOf(ref);
    if (ref.execution_id === `pending:${key}`) {
      const found = await findByKey(key);
      if (!found.ok) return found;
      if (found.value.length > 1) return workspaceRefusal('duplicate_execution', 409);
      return found.value.length ? read(ref, found.value[0], key) : pending(ref, 'unknown', 'start_ambiguous');
    }
    if (!RESOURCE_ID.test(ref.execution_id)) return workspaceRefusal('execution_not_authorized', 403);
    let res: CloudRunResponse;
    try { res = await transport.request({ method: 'GET', path: `${jobPath}/executions/${ref.execution_id}` }); }
    catch { return pending(ref, 'unknown', 'provider_unreachable'); }
    if (res.status !== 200) return ambiguous(res.status) ? pending(ref, 'unknown', 'provider_unreachable') : refusalFor(res.status, res.body);
    return read(ref, res.body, key);
  }

  /** The job as Cloud Run holds it now: one container pinned to this spec's digest, one task, no provider retry. */
  async function pinnedJob(spec: WorkspaceSpec): Promise<WorkspaceResult<{ etag: string; container: string }>> {
    let res: CloudRunResponse;
    try { res = await transport.request({ method: 'GET', path: jobPath }); } catch { return workspaceRefusal('provider_unavailable', 503); }
    if (res.status !== 200) return res.status === 404 ? workspaceRefusal('provider_rejected', 422) : refusalFor(res.status, res.body);
    const job = res.body as any;
    const containers = job?.template?.template?.containers;
    if (job?.name !== jobName || typeof job?.etag !== 'string' || !job.etag) return workspaceRefusal('provider_rejected', 422);
    if (!Array.isArray(containers) || containers.length !== 1 || typeof containers[0]?.name !== 'string' || !containers[0].name) return workspaceRefusal('capability_denied', 422, 'job_shape');
    if (containers[0].image !== `${config.registry_repository}@${spec.image_digest}`) return workspaceRefusal('capability_denied', 422, 'image_digest');
    // A provider retry would run the same key twice; Axal retries only through a new fenced generation.
    if (job.template.taskCount !== 1 || job.template.template.maxRetries !== 0) return workspaceRefusal('capability_denied', 422, 'job_shape');
    return { ok: true, value: { etag: job.etag, container: containers[0].name } };
  }

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
      // The writable filesystem is held in task memory, so the two together must fit the job's memory limit.
      if (spec.memory_mb + spec.disk_mb > config.memory_mb_max) return workspaceRefusal('capability_denied', 422, 'disk');
      const key = cloudRunExecutionKey(spec);
      const ref: ExecutionRef = { provider: 'gcp', execution_id: `pending:${key}`, tenant_id: spec.tenant_id, run_id: spec.run_id,
        attempt: spec.attempt, execution_generation: spec.execution_generation, region: gate.value.region };
      // A start that already happened for this key is returned, never repeated.
      const prior = await findByKey(key);
      if (!prior.ok) return prior;
      if (prior.value.length > 1) return workspaceRefusal('duplicate_execution', 409);
      if (prior.value.length === 1) { const r = read(ref, prior.value[0], key); return r.ok ? { ok: true, value: r.value.status } : r; }
      // Read the job before reserving: a job that is not pinned to this digest refuses without spending the key.
      const job = await pinnedJob(spec);
      if (!job.ok) return job;
      // Reserve durably before a non-idempotent run. A failed store call may have committed: fail closed.
      const reservationKey = `${jobName}:${key}`;
      let reserved: 'acquired' | 'pending' | 'refused';
      try { reserved = await starts.reserve(reservationKey); }
      catch { return workspaceRefusal('start_reservation_unavailable', 503); }
      if (reserved === 'refused') return workspaceRefusal('start_generation_refused', 409);
      if (reserved !== 'acquired') return status(ref, 'unknown', 'start_ambiguous');
      // The etag makes the run conditional on the job read above, so the digest checked is the digest that runs.
      const body = { etag: job.value.etag, overrides: {
        containerOverrides: [{ name: job.value.container,
          // References only. Grants reach the runner through the D5567 broker, never through the execution.
          env: [{ name: 'AXAL_EXECUTION_KEY', value: key }, { name: 'AXAL_RUN_ID', value: spec.run_id },
            { name: 'AXAL_EXECUTION_GENERATION', value: String(spec.execution_generation) }] }],
        taskCount: 1, timeout: `${spec.max_duration_s}s`,
      } };
      let res: CloudRunResponse;
      try { res = await transport.request({ method: 'POST', path: `${jobPath}:run`, body }); }
      catch { return status(ref, 'unknown', 'start_ambiguous'); }
      if (res.status === 200) {
        // A long-running operation whose metadata is the Execution it created.
        const id = idOf((res.body as any)?.metadata);
        return id ? status({ ...ref, execution_id: id }, 'provisioning') : status(ref, 'unknown', 'start_ambiguous');
      }
      // ALREADY_EXISTS says an execution may be there; a timeout or 5xx may still have started one. All resolve through `get`.
      if (ambiguous(res.status) || (res.status === 409 && rpc(res.body) === 'ALREADY_EXISTS')) return status(ref, 'unknown', 'start_ambiguous');
      if (res.status >= 400 && res.status < 500) {
        try { await starts.refuse(reservationKey); }
        catch { return workspaceRefusal('start_reservation_unavailable', 503); }
      }
      return res.status === 404 ? workspaceRefusal('provider_rejected', 422) : refusalFor(res.status, res.body);
    },

    async get(ref) {
      const found = await locate(ref);
      return found.ok ? { ok: true, value: found.value.status } : found;
    },

    async terminate(ref) {
      const current = await locate(ref);
      if (!current.ok) return current;
      const now = current.value.status;
      if (TERMINAL.includes(now.state) || now.state === 'cancelling') return { ok: true, value: now };
      if (!current.value.execution) return status(now.ref, 'unknown', 'stop_ambiguous');
      let res: CloudRunResponse;
      const cancel = { etag: current.value.execution.etag };
      try { res = await transport.request({ method: 'POST', path: `${jobPath}/executions/${now.ref.execution_id}:cancel`, body: cancel }); }
      catch { return status(now.ref, 'unknown', 'stop_ambiguous'); }
      if (res.status === 200) return status(now.ref, 'cancelling');
      return ambiguous(res.status) ? status(now.ref, 'unknown', 'stop_ambiguous') : refusalFor(res.status, res.body);
    },

    /** Artifacts arrive through the D5565 runner protocol and the D5567 broker; Cloud Run holds none of them. */
    async collect(ref) {
      const current = await adapter.get(ref);
      if (!current.ok) return current;
      if (!TERMINAL.includes(current.value.state)) return workspaceRefusal('execution_not_terminal');
      return { ok: true, value: { manifest_ref: null, checkpoint_manifest_ref: null } };
    },

    /** Deletes exactly the one ended execution this ref owns, conditional on the version just read; never the job. */
    async cleanup(ref) {
      const current = await locate(ref);
      if (!current.ok) return current.code === 'execution_not_found' ? { ok: true, value: { cleaned: true } } : current;
      const execution = current.value.execution;
      if (!execution || !TERMINAL.includes(current.value.status.state)) return workspaceRefusal('cleanup_not_terminal');
      if (typeof execution.etag !== 'string' || !execution.etag) return workspaceRefusal('provider_rejected', 422);
      let res: CloudRunResponse;
      const path = `${jobPath}/executions/${current.value.status.ref.execution_id}?etag=${encodeURIComponent(execution.etag)}`;
      try { res = await transport.request({ method: 'DELETE', path }); }
      catch { return workspaceRefusal('cleanup_ambiguous', 503); }
      if (res.status === 200 || res.status === 404) return { ok: true, value: { cleaned: true } };
      return ambiguous(res.status) ? workspaceRefusal('cleanup_ambiguous', 503) : refusalFor(res.status, res.body);
    },
  };
  return adapter;
}
