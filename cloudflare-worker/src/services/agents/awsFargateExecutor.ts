/** D5571 part 3: disabled, unmounted AWS ECS/Fargate RunTask ExecutorAdapter over an injected SigV4 signer and fetch; fails closed on every unverified capability. */
import { executorEligibility, trustedWorkspaceSpec, workspaceRefusal, type ExecutionRef, type ExecutionStatus, type ExecutorAdapter,
  type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec, type WorkspaceState } from './workspaceSpec';

/** The Amazon ECS JSON 1.1 API version the request shapes below were read from. */
export const ECS_API = 'AmazonEC2ContainerServiceV20141113';
export type EcsOperation = 'RunTask' | 'DescribeTasks' | 'ListTasks' | 'StopTask' | 'DescribeTaskDefinition';

/**
 * The request the injected signer signs. The signer is the privileged broker's federated-identity seam: it holds
 * short-lived, role-scoped credentials obtained by web-identity federation (never a long-lived key), signs with
 * SigV4 for service `ecs` in `region`, and returns the complete header set to send. This module never sees a
 * credential, and none reaches the task: the task definition may carry no task role and no secrets.
 */
export type AwsSignableRequest = { method: 'POST'; url: string; region: string; service: 'ecs'; headers: Record<string, string>; body: string };
export interface AwsRequestSigner { sign(req: AwsSignableRequest): Promise<Record<string, string>> }
/** The subset of `fetch` the adapter uses. Injected, so nothing here can reach AWS unless the host wires it. */
export type AwsFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * Durable, atomic insert-if-absent, shared by every adapter for this cluster and task definition.
 * RunTask's `clientToken` is idempotent only for 24 hours or the task's lifetime plus one hour, whichever is shorter,
 * so it covers an immediate retry, not a late one. A reservation never expires or releases: an empty list cannot
 * prove a start did not land. Recovery uses a new fenced generation. The host must supply a transactional D1/DO
 * implementation before enabling.
 */
export interface AwsStartReservations {
  reserve(key: string): Promise<'acquired' | 'pending' | 'refused'>;
  /** Record a definite provider refusal without releasing the single-use key. */
  refuse(key: string): Promise<void>;
}

/**
 * One pre-provisioned ECS cluster and one registered task definition revision, as an operator configured them. The
 * revision is immutable and pins the image by digest, the task CPU, memory and ephemeral storage; `create` reads it
 * and refuses it unless it has that shape. Every capability defaults to the safe answer.
 */
export type AwsFargateConfig = {
  enabled: boolean;
  /** AWS region code, e.g. `eu-west-1`; the cluster and task definition must live in it. */
  aws_region: string;
  cluster_arn: string;
  /** A task definition ARN with an explicit revision (`family:N`), never the latest. */
  task_definition_arn: string;
  /** A pinned Fargate platform version, e.g. `1.4.0`; `LATEST` is refused. */
  platform_version: string;
  /** Repository without tag or digest, e.g. `123456789012.dkr.ecr.eu-west-1.amazonaws.com/workspace`. */
  registry_repository: string;
  /** awsvpc networking: private subnets and security groups only; a public IP is never assigned. */
  subnets: string[]; security_groups: string[];
  /** Axal region codes this AWS region satisfies. */
  regions: string[];
  /** The longest run an operator allows. Fargate has no task timeout: the adapter enforces it by StopTask. */
  task_timeout_max_s: number;
  /** The task definition's size: the spec must fit it, and Fargate bills it. */
  cpu_max: number; memory_mb_max: number; disk_mb_max: number; concurrency_max: number;
  /** Modes the security groups, routes and egress firewall actually enforce. Empty means none is verified. */
  enforced_network_modes: WorkspaceSpec['network_policy']['mode'][];
  /** True only when an operator has attested hostile-code isolation for this cluster's Fargate tasks. */
  untrusted_code: boolean;
  checkpoint_restore: boolean;
  /** Integer micro-USD per vCPU-second and per GiB-second, or null when nobody has priced it. */
  rates: { vcpu_second_microusd: number; gib_second_microusd: number } | null;
};

/** Commercial-partition regions only (`arn:aws:`); GovCloud and China use other partitions and are refused. */
const AWS_REGION = /^[a-z]{2}-[a-z]+-\d$/;
const ACCOUNT = '\\d{12}';
const NAME = '[A-Za-z][A-Za-z0-9_-]{0,254}';
const SUBNET = /^subnet-[0-9a-f]{8,17}$/;
const SECURITY_GROUP = /^sg-[0-9a-f]{8,17}$/;
const PLATFORM = /^\d+\.\d+\.\d+$/;
const REPOSITORY = /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(\/[a-z0-9._-]+)+$/;
const TASK_ID = /^[a-f0-9]{32}$/;
/** Fargate's default ephemeral storage when a task definition does not set one. */
const FARGATE_DEFAULT_EPHEMERAL_GIB = 20;
/** Fargate bills at least one minute per task. */
const FARGATE_MIN_BILLED_S = 60;

/** A stopped task's `stopCode`, mapped onto the D5565 state machine. An unlisted code is `unknown`, never a guess. */
export const AWS_FARGATE_STATUS: Readonly<Record<string, WorkspaceState>> = Object.freeze({
  PROVISIONING: 'provisioning', PENDING: 'provisioning', ACTIVATING: 'provisioning', RUNNING: 'running',
  'STOPPED/UserInitiated': 'cancelled', 'STOPPED/EssentialContainerExited': 'finished',
  'STOPPED/TaskFailedToStart': 'failed', 'STOPPED/SpotInterruption': 'failed', 'STOPPED/TerminationNotice': 'failed',
});
/** States a task passes through on its way to STOPPED, whatever stopped it. */
const WINDING_DOWN = ['DEACTIVATING', 'STOPPING', 'DEPROVISIONING'];
const TERMINAL: readonly WorkspaceState[] = ['finished', 'failed', 'cancelled'];

/** The key every task carries in an environment override, so an ambiguous start can be found again without a second start. */
export const awsExecutionKey = (spec: Pick<WorkspaceSpec, 'tenant_id' | 'run_id' | 'attempt' | 'execution_generation'>) =>
  `${spec.tenant_id}.${spec.run_id}.a${spec.attempt}.g${spec.execution_generation}`;

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
/** `clientToken` (64 printable ASCII at most) and `startedBy` (128 of `[A-Za-z0-9/_-]` at most) are derived from the key. */
export async function awsStartTokens(clusterArn: string, key: string): Promise<{ clientToken: string; startedBy: string }> {
  const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${clusterArn}\n${key}`)));
  return { clientToken: digest, startedBy: `axal-${digest}` };
}

export function createAwsFargateExecutor({ config, signer, fetch, starts, now }: {
  config: AwsFargateConfig; signer: AwsRequestSigner; fetch: AwsFetch; starts: AwsStartReservations; now: () => number;
}): ExecutorAdapter {
  const region = config?.aws_region;
  const arnIn = (kind: string) => new RegExp(`^arn:aws:ecs:${region}:${ACCOUNT}:${kind}$`);
  const valid = config && typeof config.enabled === 'boolean' && AWS_REGION.test(region)
    && arnIn(`cluster/${NAME}`).test(config.cluster_arn) && arnIn(`task-definition/${NAME}:[1-9]\\d{0,8}`).test(config.task_definition_arn)
    && PLATFORM.test(config.platform_version) && REPOSITORY.test(config.registry_repository)
    && Array.isArray(config.subnets) && config.subnets.length > 0 && config.subnets.length <= 16 && config.subnets.every(s => SUBNET.test(s))
    && Array.isArray(config.security_groups) && config.security_groups.length > 0 && config.security_groups.length <= 5 && config.security_groups.every(s => SECURITY_GROUP.test(s))
    && Array.isArray(config.regions) && Number.isSafeInteger(config.task_timeout_max_s) && config.task_timeout_max_s > 0
    && Number.isSafeInteger(config.concurrency_max);
  if (!starts || typeof starts.reserve !== 'function' || typeof starts.refuse !== 'function') throw new Error('Missing AWS start reservation store');
  if (!signer || typeof signer.sign !== 'function' || typeof fetch !== 'function') throw new Error('Missing AWS signer or fetch');
  if (typeof now !== 'function') throw new Error('Missing AWS clock');
  if (!valid) throw new Error('Invalid AWS Fargate configuration');
  // Both ARNs are in the same account: the cluster's account owns the tasks.
  if (config.cluster_arn.split(':')[4] !== config.task_definition_arn.split(':')[4]) throw new Error('Invalid AWS Fargate configuration');
  const clusterName = config.cluster_arn.slice(config.cluster_arn.indexOf(':cluster/') + ':cluster/'.length);
  const taskArnPrefix = `${config.cluster_arn.slice(0, config.cluster_arn.indexOf(':cluster/'))}:task/${clusterName}/`;
  const endpoint = `https://ecs.${region}.amazonaws.com/`;
  const off = () => workspaceRefusal('provider_disabled', 503);

  const capabilities: ExecutorCapabilities = Object.freeze({
    provider: 'aws', revision: `ecs-fargate-${ECS_API}`, workload_classes: ['coding_trusted', 'coding_untrusted'],
    digest_pulls: true, shell: true, untrusted_code: config.untrusted_code === true,
    cpu_max: config.cpu_max, memory_mb_max: config.memory_mb_max, disk_mb_max: config.disk_mb_max, duration_s_max: config.task_timeout_max_s,
    enforced_network_modes: [...(config.enforced_network_modes || [])], enforced_regions: [...config.regions],
    gpu: false, interrupt: true, checkpoint_restore: config.checkpoint_restore === true,
    concurrency_max: config.concurrency_max > 0 ? config.concurrency_max : null,
  }) as ExecutorCapabilities;

  type Answer = { kind: 'answer'; status: number; body: any } | { kind: 'unsent' } | { kind: 'lost' };
  type Signed = { headers: Record<string, string>; body: string };
  /** Sign one ECS call. Null when the signer refused, or returned headers that do not carry a signature for this operation. */
  async function sign(op: EcsOperation, payload: unknown): Promise<Signed | null> {
    const body = JSON.stringify(payload);
    const headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `${ECS_API}.${op}` };
    let signed: Record<string, string>;
    try { signed = await signer.sign({ method: 'POST', url: endpoint, region, service: 'ecs', headers: { ...headers }, body }); }
    catch { return null; }
    const lower: Record<string, string> = Object.fromEntries(Object.entries(signed && typeof signed === 'object' ? signed : {})
      .filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.toLowerCase(), v]));
    if (!lower.authorization || lower['x-amz-target'] !== headers['x-amz-target'] || lower['content-type'] !== headers['content-type']) return null;
    return { headers: lower, body };
  }
  /** Send a signed call. `lost`: it may have reached AWS and the answer did not come back, or came back unreadable. */
  async function send(req: Signed): Promise<Answer> {
    let res: { status: number; json(): Promise<unknown> };
    try { res = await fetch(endpoint, { method: 'POST', headers: { ...req.headers }, body: req.body }); } catch { return { kind: 'lost' }; }
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { if (res.status === 200) return { kind: 'lost' }; }
    return { kind: 'answer', status: res.status, body: parsed };
  }
  /** `unsent`: the signer refused, so nothing left. */
  async function call(op: EcsOperation, payload: unknown): Promise<Answer> {
    const req = await sign(op, payload);
    return req ? send(req) : { kind: 'unsent' };
  }

  /** The error shape name of a JSON 1.1 error body (`__type`), without its namespace. Provider text is never read. */
  const errorType = (body: unknown): string => {
    const t = (body as any)?.__type;
    return typeof t === 'string' ? t.slice(t.lastIndexOf('#') + 1) : '';
  };
  const AUTH = ['AccessDeniedException', 'ExpiredTokenException', 'UnrecognizedClientException', 'IncompleteSignature', 'NotAuthorized', 'InvalidClientTokenId', 'OptInRequired'];
  /** A definite ECS error as a refusal. Provider text is never copied into it. */
  function refusalFor(status: number, body: unknown) {
    const type = errorType(body);
    if (AUTH.includes(type) || status === 401 || status === 403) return workspaceRefusal('provider_auth_refused', 403);
    if (type === 'ThrottlingException' || type === 'LimitExceededException' || status === 429) return workspaceRefusal('provider_quota', 503);
    if (status >= 400 && status < 500) return workspaceRefusal('provider_rejected', 422);
    return workspaceRefusal('provider_unavailable', 503);
  }
  /** A timeout or a server error: the request may or may not have taken effect. */
  const ambiguous = (a: Answer) => a.kind === 'lost' || (a.kind === 'answer' && (a.status === 408 || a.status >= 500
    || ['RequestTimeoutException', 'RequestAbortedException'].includes(errorType(a.body))));
  const unreachable = (a: Answer) => a.kind === 'unsent' ? workspaceRefusal('provider_auth_unavailable', 503) : workspaceRefusal('provider_unavailable', 503);
  const envOf = (task: any): Record<string, unknown> => {
    const env = Array.isArray(task?.overrides?.containerOverrides) && task.overrides.containerOverrides.length === 1 ? task.overrides.containerOverrides[0]?.environment : null;
    return Array.isArray(env) ? Object.fromEntries(env.filter((e: any) => typeof e?.name === 'string').map((e: any) => [e.name, e.value])) : {};
  };
  const idOf = (task: any): string | null => {
    const arn = typeof task?.taskArn === 'string' ? task.taskArn : '';
    const id = arn.startsWith(taskArnPrefix) ? arn.slice(taskArnPrefix.length) : '';
    return TASK_ID.test(id) ? id : null;
  };
  const status = (ref: ExecutionRef, state: WorkspaceState, failure_code?: string): WorkspaceResult<ExecutionStatus> =>
    ({ ok: true, value: { ref, state, ...(failure_code ? { failure_code } : {}) } });
  const keyOf = (ref: ExecutionRef) => awsExecutionKey({ tenant_id: ref.tenant_id, run_id: ref.run_id, attempt: ref.attempt, execution_generation: ref.execution_generation });

  /** A task is this key's only when every part of its identity matches: cluster, task definition, startedBy and env key. */
  const owns = (task: any, key: string, startedBy: string) => Boolean(idOf(task)) && task.clusterArn === config.cluster_arn
    && task.taskDefinitionArn === config.task_definition_arn && task.startedBy === startedBy && envOf(task).AXAL_EXECUTION_KEY === key;

  /** DescribeTasks for up to 100 ARNs. `missing` lists the ones ECS no longer knows (stopped tasks expire after an hour or more). */
  async function describe(arns: string[]): Promise<WorkspaceResult<{ tasks: any[]; missing: string[] }> | { ok: 'lost' }> {
    const a = await call('DescribeTasks', { cluster: config.cluster_arn, tasks: arns });
    if (a.kind !== 'answer') return a.kind === 'lost' ? { ok: 'lost' } : unreachable(a);
    if (a.status !== 200) return ambiguous(a) ? { ok: 'lost' } : refusalFor(a.status, a.body);
    const failures = Array.isArray(a.body?.failures) ? a.body.failures : [];
    // Only MISSING is a definite absence; any other failure reason is not proof of anything.
    if (failures.some((f: any) => f?.reason !== 'MISSING')) return { ok: 'lost' };
    return { ok: true, value: { tasks: Array.isArray(a.body?.tasks) ? a.body.tasks : [], missing: failures.map((f: any) => String(f?.arn)) } };
  }

  /** Every task in this cluster started with this key's `startedBy`, running or recently stopped, that the key owns. */
  async function findByKey(key: string): Promise<WorkspaceResult<any[]>> {
    const { startedBy } = await awsStartTokens(config.cluster_arn, key);
    const arns = new Set<string>();
    // ListTasks filters on one desired status at a time, and startedBy must be its only other filter.
    for (const desiredStatus of ['RUNNING', 'STOPPED']) {
      let token: string | null = '';
      for (let page = 0; token !== null && page < 20; page++) {
        const a = await call('ListTasks', { cluster: config.cluster_arn, startedBy, desiredStatus, maxResults: 100, ...(token ? { nextToken: token } : {}) });
        if (a.kind !== 'answer') return unreachable(a);
        if (a.status !== 200) return ambiguous(a) ? workspaceRefusal('provider_unavailable', 503) : refusalFor(a.status, a.body);
        for (const arn of Array.isArray(a.body?.taskArns) ? a.body.taskArns : []) if (typeof arn === 'string' && arn.startsWith(taskArnPrefix)) arns.add(arn);
        token = typeof a.body?.nextToken === 'string' && a.body.nextToken ? a.body.nextToken : null;
      }
    }
    const found: any[] = [];
    const all = [...arns];
    for (let i = 0; i < all.length; i += 100) {
      const d = await describe(all.slice(i, i + 100));
      if (d.ok === 'lost') return workspaceRefusal('provider_unavailable', 503);
      if (!d.ok) return d;
      for (const task of d.value.tasks) if (owns(task, key, startedBy)) found.push(task);
    }
    return { ok: true, value: found };
  }

  /** When an owned task must be stopped by: its creation plus the spec's duration it carries. Null when unreadable. */
  const deadlineOf = (task: any): number | null => {
    const created = Number(task?.createdAt), limit = Number(envOf(task).AXAL_MAX_DURATION_S);
    return Number.isFinite(created) && Number.isSafeInteger(limit) && limit > 0 && limit <= config.task_timeout_max_s ? created + limit : null;
  };

  /** The D5565 state of an owned task. */
  function stateOf(task: any): { state: WorkspaceState; failure_code?: string } {
    const last = String(task?.lastStatus), code = typeof task?.stopCode === 'string' ? task.stopCode : '';
    if (WINDING_DOWN.includes(last)) {
      if (code === 'UserInitiated') return { state: 'cancelling' };
      // A task that ends on its own passes through these too; it stays running until ECS says how it stopped.
      return { state: Number.isFinite(Number(task?.startedAt)) ? 'running' : 'provisioning' };
    }
    const state = AWS_FARGATE_STATUS[last === 'STOPPED' || last === 'DELETED' ? `STOPPED/${code}` : last] ?? 'unknown';
    if (state === 'cancelled') {
      const deadline = deadlineOf(task), stopping = Number(task?.stoppingAt);
      return deadline !== null && Number.isFinite(stopping) && stopping >= deadline ? { state, failure_code: 'deadline_exceeded' } : { state };
    }
    if (state === 'finished') {
      // The one essential container's exit code decides; an unreadable one is not a success.
      const containers = Array.isArray(task?.containers) ? task.containers : [];
      const exit = containers.length === 1 ? containers[0]?.exitCode : undefined;
      if (exit === 0) return { state };
      return { state: 'failed', failure_code: Number.isSafeInteger(exit) ? 'non_zero_exit' : 'failed' };
    }
    if (state === 'failed') return { state, failure_code: code === 'TaskFailedToStart' ? 'start_failed' : 'interrupted' };
    return { state };
  }

  type Located = { status: ExecutionStatus; task: any | null };
  const pending = (ref: ExecutionRef, state: WorkspaceState, failure_code: string): WorkspaceResult<Located> =>
    ({ ok: true, value: { status: { ref, state, failure_code }, task: null } });
  const read = async (ref: ExecutionRef, task: any, key: string): Promise<WorkspaceResult<Located>> => {
    const { startedBy } = await awsStartTokens(config.cluster_arn, key);
    const id = idOf(task);
    if (!id || !owns(task, key, startedBy)) return workspaceRefusal('execution_not_authorized', 403);
    if (!ref.execution_id.startsWith('pending:') && id !== ref.execution_id) return workspaceRefusal('execution_not_authorized', 403);
    const s = stateOf(task);
    return { ok: true, value: { status: { ref: { ...ref, execution_id: id }, state: s.state, ...(s.failure_code ? { failure_code: s.failure_code } : {}) }, task } };
  };

  /** Read the ref's task and prove this ref owns it. `task` is null when nothing was located. */
  async function locate(ref: ExecutionRef): Promise<WorkspaceResult<Located>> {
    if (!config.enabled) return off();
    if (ref?.provider !== 'aws' || !config.regions.includes(ref.region)) return workspaceRefusal('execution_not_authorized', 403);
    const key = keyOf(ref);
    if (ref.execution_id === `pending:${key}`) {
      const found = await findByKey(key);
      if (!found.ok) return found;
      if (found.value.length > 1) return workspaceRefusal('duplicate_execution', 409);
      return found.value.length ? read(ref, found.value[0], key) : pending(ref, 'unknown', 'start_ambiguous');
    }
    if (!TASK_ID.test(ref.execution_id)) return workspaceRefusal('execution_not_authorized', 403);
    const d = await describe([`${taskArnPrefix}${ref.execution_id}`]);
    if (d.ok === 'lost') return pending(ref, 'unknown', 'provider_unreachable');
    if (!d.ok) return d;
    if (d.value.tasks.length !== 1) return d.value.missing.length ? workspaceRefusal('execution_not_found', 409) : pending(ref, 'unknown', 'provider_unreachable');
    return read(ref, d.value.tasks[0], key);
  }

  /** StopTask for an owned task. StopTask is safe to repeat; a lost answer is `stop_ambiguous`. */
  async function stop(ref: ExecutionRef, reason: 'cancelled' | 'deadline', failure_code?: string): Promise<WorkspaceResult<ExecutionStatus>> {
    const a = await call('StopTask', { cluster: config.cluster_arn, task: `${taskArnPrefix}${ref.execution_id}`, reason: `axal: ${reason}` });
    if (a.kind === 'unsent') return unreachable(a);
    if (ambiguous(a)) return status(ref, 'unknown', 'stop_ambiguous');
    if (a.kind === 'answer' && a.status === 200) return status(ref, 'cancelling', failure_code);
    return a.kind === 'answer' ? refusalFor(a.status, a.body) : status(ref, 'unknown', 'stop_ambiguous');
  }

  /** The registered revision as ECS holds it: one essential container pinned to this spec's digest, no task role, no secrets. */
  async function pinnedTaskDefinition(spec: WorkspaceSpec): Promise<WorkspaceResult<{ container: string }>> {
    const a = await call('DescribeTaskDefinition', { taskDefinition: config.task_definition_arn });
    if (a.kind !== 'answer') return unreachable(a);
    if (a.status !== 200) return ambiguous(a) ? workspaceRefusal('provider_unavailable', 503) : refusalFor(a.status, a.body);
    const td = a.body?.taskDefinition;
    if (td?.taskDefinitionArn !== config.task_definition_arn || td?.status !== 'ACTIVE') return workspaceRefusal('provider_rejected', 422);
    const containers = td.containerDefinitions;
    if (!Array.isArray(containers) || containers.length !== 1 || typeof containers[0]?.name !== 'string' || !containers[0].name
      || containers[0].essential === false) return workspaceRefusal('capability_denied', 422, 'task_shape');
    const c = containers[0];
    if (c.image !== `${config.registry_repository}@${spec.image_digest}`) return workspaceRefusal('capability_denied', 422, 'image_digest');
    if (td.networkMode !== 'awsvpc' || !Array.isArray(td.requiresCompatibilities) || !td.requiresCompatibilities.includes('FARGATE')) return workspaceRefusal('capability_denied', 422, 'task_shape');
    // A task role hands the container AWS credentials; secrets and env files put values in it. None is allowed.
    if (td.taskRoleArn || (Array.isArray(c.secrets) && c.secrets.length) || (Array.isArray(c.environmentFiles) && c.environmentFiles.length)) return workspaceRefusal('capability_denied', 422, 'credentials');
    // The revision's size is what the task gets; the spec must fit inside it.
    const cpu = Number(td.cpu) / 1024, memory = Number(td.memory);
    const disk = (Number.isSafeInteger(td.ephemeralStorage?.sizeInGiB) ? td.ephemeralStorage.sizeInGiB : FARGATE_DEFAULT_EPHEMERAL_GIB) * 1024;
    if (!(cpu >= spec.cpu)) return workspaceRefusal('capability_denied', 422, 'cpu');
    if (!(memory >= spec.memory_mb)) return workspaceRefusal('capability_denied', 422, 'memory');
    if (!(disk >= spec.disk_mb)) return workspaceRefusal('capability_denied', 422, 'disk');
    return { ok: true, value: { container: c.name } };
  }

  const adapter: ExecutorAdapter = {
    async capabilities() { return structuredClone(capabilities) as ExecutorCapabilities; },

    async estimate(spec) {
      if (!config.enabled) return off();
      const gate = executorEligibility(spec, capabilities);
      if (!gate.ok) return gate;
      // No rates is no estimate: refused, never 0.
      if (!config.rates || !Number.isSafeInteger(config.rates.vcpu_second_microusd) || !Number.isSafeInteger(config.rates.gib_second_microusd)) return workspaceRefusal('estimate_unavailable', 422);
      // Fargate bills the task definition's size, not the spec's request, for at least a minute.
      const seconds = Math.max(FARGATE_MIN_BILLED_S, spec.max_duration_s);
      const cost = Math.ceil(seconds * (config.cpu_max * config.rates.vcpu_second_microusd + (config.memory_mb_max / 1024) * config.rates.gib_second_microusd));
      return { ok: true, value: { cost_microusd: cost, measured: false } };
    },

    async create(input) {
      if (!config.enabled) return off();
      const parsed = trustedWorkspaceSpec(input);
      if (!parsed.ok) return parsed;
      const spec = parsed.value;
      const gate = executorEligibility(spec, capabilities);
      if (!gate.ok) return gate;
      const key = awsExecutionKey(spec);
      const ref: ExecutionRef = { provider: 'aws', execution_id: `pending:${key}`, tenant_id: spec.tenant_id, run_id: spec.run_id,
        attempt: spec.attempt, execution_generation: spec.execution_generation, region: gate.value.region };
      // A start that already happened for this key is returned, never repeated.
      const prior = await findByKey(key);
      if (!prior.ok) return prior;
      if (prior.value.length > 1) return workspaceRefusal('duplicate_execution', 409);
      if (prior.value.length === 1) { const r = await read(ref, prior.value[0], key); return r.ok ? { ok: true, value: r.value.status } : r; }
      // Read the revision before reserving: one that is not pinned to this digest refuses without spending the key.
      const td = await pinnedTaskDefinition(spec);
      if (!td.ok) return td;
      const { clientToken, startedBy } = await awsStartTokens(config.cluster_arn, key);
      const body = {
        cluster: config.cluster_arn, taskDefinition: config.task_definition_arn, count: 1, launchType: 'FARGATE',
        platformVersion: config.platform_version, clientToken, startedBy, enableExecuteCommand: false, propagateTags: 'NONE',
        networkConfiguration: { awsvpcConfiguration: { subnets: [...config.subnets], securityGroups: [...config.security_groups], assignPublicIp: 'DISABLED' } },
        // References only. Grants reach the runner through the D5567 broker, never through the task.
        overrides: { containerOverrides: [{ name: td.value.container, environment: [
          { name: 'AXAL_EXECUTION_KEY', value: key }, { name: 'AXAL_RUN_ID', value: spec.run_id },
          { name: 'AXAL_EXECUTION_GENERATION', value: String(spec.execution_generation) },
          { name: 'AXAL_MAX_DURATION_S', value: String(spec.max_duration_s) }] }] },
        // Attribution for cost allocation. ECS deletes a task's tags when it is stopped, so ownership never reads them.
        tags: [{ key: 'axal:tenant', value: String(spec.tenant_id) }, { key: 'axal:run', value: spec.run_id },
          { key: 'axal:attempt', value: String(spec.attempt) }, { key: 'axal:generation', value: String(spec.execution_generation) }],
      };
      // Sign before reserving: a signer that refuses sends nothing and spends no key.
      const signed = await sign('RunTask', body);
      if (!signed) return workspaceRefusal('provider_auth_unavailable', 503);
      // Reserve durably before the start. A failed store call may have committed: fail closed.
      const reservationKey = `${config.cluster_arn}:${key}`;
      let reserved: 'acquired' | 'pending' | 'refused';
      try { reserved = await starts.reserve(reservationKey); }
      catch { return workspaceRefusal('start_reservation_unavailable', 503); }
      if (reserved === 'refused') return workspaceRefusal('start_generation_refused', 409);
      // An earlier start may be older than the client token's TTL, so it is located, never sent again.
      if (reserved !== 'acquired') return status(ref, 'unknown', 'start_ambiguous');
      const spend = async (): Promise<WorkspaceResult<never> | null> => {
        try { await starts.refuse(reservationKey); return null; }
        catch { return workspaceRefusal('start_reservation_unavailable', 503); }
      };
      let a = await send(signed);
      // Seconds later the client token is certainly live (24 h, or the task's life plus an hour, whichever is shorter),
      // so one identical resend returns the original start, never a second one.
      if (ambiguous(a)) { const again = await sign('RunTask', body); a = again ? await send(again) : { kind: 'lost' }; }
      if (a.kind !== 'answer' || ambiguous(a)) return status(ref, 'unknown', 'start_ambiguous');
      if (a.status === 200) {
        const tasks = Array.isArray(a.body?.tasks) ? a.body.tasks : [];
        const failures = Array.isArray(a.body?.failures) ? a.body.failures : [];
        if (tasks.length === 1 && !failures.length) {
          const r = await read(ref, tasks[0], key);
          return r.ok ? { ok: true, value: r.value.status } : status(ref, 'unknown', 'start_ambiguous');
        }
        // Placed nothing and said why: a definite capacity refusal. Anything else is not proof either way.
        if (!tasks.length && failures.length) return (await spend()) ?? workspaceRefusal('provider_capacity', 503);
        return status(ref, 'unknown', 'start_ambiguous');
      }
      // The token is already bound to another request's tasks: locate by key, never start again.
      if (errorType(a.body) === 'ConflictException') return status(ref, 'unknown', 'start_ambiguous');
      if (a.status >= 400 && a.status < 500) { const spent = await spend(); if (spent) return spent; }
      return refusalFor(a.status, a.body);
    },

    async get(ref) {
      const found = await locate(ref);
      if (!found.ok) return found;
      const { status: now_, task } = found.value;
      // Fargate has no task timeout. A task still going past its deadline is stopped here, on the reconciler's read.
      if (task && !TERMINAL.includes(now_.state) && now_.state !== 'cancelling' && now_.state !== 'unknown') {
        const deadline = deadlineOf(task);
        if (deadline === null) return status(now_.ref, 'unknown', 'deadline_unverifiable');
        if (now() / 1000 >= deadline) return stop(now_.ref, 'deadline', 'deadline_exceeded');
      }
      return { ok: true, value: now_ };
    },

    async terminate(ref) {
      const current = await locate(ref);
      if (!current.ok) return current;
      const now_ = current.value.status;
      if (TERMINAL.includes(now_.state) || now_.state === 'cancelling') return { ok: true, value: now_ };
      if (!current.value.task) return status(now_.ref, 'unknown', 'stop_ambiguous');
      return stop(now_.ref, 'cancelled');
    },

    /** Artifacts arrive through the D5565 runner protocol and the D5567 broker; ECS holds none of them. */
    async collect(ref) {
      const current = await locate(ref);
      if (!current.ok) return current;
      if (!TERMINAL.includes(current.value.status.state)) return workspaceRefusal('execution_not_terminal');
      return { ok: true, value: { manifest_ref: null, checkpoint_manifest_ref: null } };
    },

    /**
     * ECS has no per-task delete: a stopped task's ENI is released by ECS and the task record expires on its own. So
     * cleanup proves the one task this ref owns has ended, and deletes nothing: never the task definition, the
     * cluster, or another task.
     */
    async cleanup(ref) {
      const current = await locate(ref);
      if (!current.ok) return current.code === 'execution_not_found' ? { ok: true, value: { cleaned: true } } : current;
      if (!current.value.task || !TERMINAL.includes(current.value.status.state)) return workspaceRefusal('cleanup_not_terminal');
      return { ok: true, value: { cleaned: true } };
    },
  };
  return adapter;
}
