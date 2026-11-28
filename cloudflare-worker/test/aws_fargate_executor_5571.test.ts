/**
 * #5571 (D5571 part 3): the disabled AWS ECS/Fargate adapter over a synthetic ECS JSON 1.1 endpoint. Every provider
 * answer is a recorded synthetic fixture shaped like the ECS API reference (RunTask, DescribeTasks, ListTasks, StopTask,
 * DescribeTaskDefinition, `__type` errors). The signer is a fake that records what it was asked to sign. No live AWS
 * account, no credential, no network.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/aws_fargate_executor_5571.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AWS_FARGATE_STATUS, ECS_API, awsExecutionKey, awsStartTokens, createAwsFargateExecutor, type AwsFargateConfig,
  type AwsFetch, type AwsRequestSigner, type AwsSignableRequest, type AwsStartReservations } from '../src/services/agents/awsFargateExecutor.ts';
import type { ExecutionRef, WorkspaceResult } from '../src/services/agents/workspaceSpec.ts';
import { specFixture } from './_workspace_fake_5565.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string, capability?: string) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (!r.ok) { assert.equal(r.code, code); if (capability) assert.equal(r.capability, capability); }
};

const ACCOUNT = '000000000000';
const CLUSTER = `arn:aws:ecs:eu-west-1:${ACCOUNT}:cluster/axal-synthetic`;
const TASK_DEF = `arn:aws:ecs:eu-west-1:${ACCOUNT}:task-definition/workspace-synthetic:7`;
const TASK_PREFIX = `arn:aws:ecs:eu-west-1:${ACCOUNT}:task/axal-synthetic/`;
const REPO = `${ACCOUNT}.dkr.ecr.eu-west-1.amazonaws.com/workspace`;
const ENDPOINT = 'https://ecs.eu-west-1.amazonaws.com/';
const KEY = '11.run-synthetic.a1.g1';
const config = (patch: Partial<AwsFargateConfig> = {}): AwsFargateConfig => ({ enabled: true, aws_region: 'eu-west-1', cluster_arn: CLUSTER,
  task_definition_arn: TASK_DEF, platform_version: '1.4.0', registry_repository: REPO, subnets: ['subnet-0123456789abcdef0'],
  security_groups: ['sg-0123456789abcdef0'], regions: ['weur'], task_timeout_max_s: 3600, cpu_max: 1, memory_mb_max: 2048, disk_mb_max: 20480,
  concurrency_max: 5, enforced_network_modes: ['deny'], untrusted_code: true, checkpoint_restore: false, rates: null, ...patch });
const awsSpec = (patch = {}) => specFixture({ allowed_providers: ['aws'], ...patch });
const DIGEST = awsSpec().image_digest;
const T0 = 1_800_000_000_000;

// Recorded synthetic fixtures, shaped like the ECS API reference.
const taskDefinitionFixture = () => ({ taskDefinitionArn: TASK_DEF, family: 'workspace-synthetic', revision: 7, status: 'ACTIVE',
  networkMode: 'awsvpc', requiresCompatibilities: ['FARGATE'], cpu: '1024', memory: '2048', ephemeralStorage: { sizeInGiB: 21 },
  executionRoleArn: `arn:aws:iam::${ACCOUNT}:role/synthetic-execution`,
  containerDefinitions: [{ name: 'workspace', image: `${REPO}@${DIGEST}`, essential: true, logConfiguration: { logDriver: 'awslogs' } }] });
const awsError = (type: string) => ({ __type: `com.amazonaws.ecs#${type}`, message: 'synthetic provider text' });

function reservationStore(): AwsStartReservations {
  const keys = new Map<string, 'pending' | 'refused'>();
  return {
    async reserve(key) { const prior = keys.get(key); if (prior) return prior; keys.set(key, 'pending'); return 'acquired'; },
    async refuse(key) { assert.equal(keys.get(key), 'pending'); keys.set(key, 'refused'); },
  };
}
/** A fake broker signer: records every request it signs and returns a synthetic signature header set. */
function fakeSigner() {
  const signed: AwsSignableRequest[] = [];
  let refuse = false;
  const signer: AwsRequestSigner = { async sign(req) {
    if (refuse) throw new Error('synthetic federation refused');
    signed.push(structuredClone(req));
    return { ...req.headers, authorization: 'AWS4-HMAC-SHA256 Credential=SYNTHETIC/20260101/eu-west-1/ecs/aws4_request, SignedHeaders=content-type;x-amz-target, Signature=00',
      'x-amz-date': '20260101T000000Z', 'x-amz-security-token': 'synthetic-session' };
  } };
  return { signer, signed, refuseNext: (v: boolean) => { refuse = v; } };
}

type Fault = number | [number, string] | 'throw' | 'throwAfterStart' | 'capacity' | 'badJson';
type Op = 'RunTask' | 'DescribeTasks' | 'ListTasks' | 'StopTask' | 'DescribeTaskDefinition';
/** A synthetic ECS endpoint for one cluster. A fault overrides the next answer for that operation; `faults[op]` may hold a list. */
function fakeEcs({ pageSize = 100 } = {}) {
  let clock = T0;
  const taskDefinition: any = taskDefinitionFixture();
  const tasks = new Map<string, any>();
  const tokens = new Map<string, { params: string; arns: string[] }>();
  const requests: { op: Op; body: any; headers: Record<string, string> }[] = [];
  const faults: Partial<Record<Op, Fault[]>> = {};
  const fault = (op: Op, ...f: Fault[]) => { faults[op] = f; };
  const take = (op: Op) => faults[op]?.shift();
  let n = 0;
  const answer = (f: Fault | undefined) => {
    if (f === 'throw') throw new Error('synthetic network reset');
    if (typeof f === 'number') return { status: f, body: f >= 500 ? awsError('ServerException') : awsError('ClientException') };
    if (Array.isArray(f)) return { status: f[0], body: awsError(f[1]) };
    return null;
  };
  const handle = (op: Op, body: any): { status: number; body: unknown } => {
    if (op === 'DescribeTaskDefinition') {
      if (body.taskDefinition !== TASK_DEF) return { status: 400, body: awsError('ClientException') };
      return { status: 200, body: { taskDefinition: structuredClone(taskDefinition) } };
    }
    if (op === 'RunTask') {
      const { clientToken, ...params } = body;
      const prior = tokens.get(clientToken);
      if (prior) {
        if (prior.params !== JSON.stringify(params)) return { status: 400, body: { ...awsError('ConflictException'), resourceIds: prior.arns } };
        return { status: 200, body: { tasks: prior.arns.map(a => structuredClone(tasks.get(a))), failures: [] } };
      }
      const id = (++n).toString(16).padStart(32, '0');
      const arn = `${TASK_PREFIX}${id}`;
      tasks.set(arn, { taskArn: arn, clusterArn: body.cluster, taskDefinitionArn: body.taskDefinition, launchType: 'FARGATE',
        platformVersion: body.platformVersion, startedBy: body.startedBy, group: 'family:workspace-synthetic', createdAt: clock / 1000,
        desiredStatus: 'RUNNING', lastStatus: 'PROVISIONING', cpu: '1024', memory: '2048', overrides: structuredClone(body.overrides),
        tags: structuredClone(body.tags), containers: [{ name: 'workspace', image: `${REPO}@${DIGEST}`, lastStatus: 'PENDING', taskArn: arn }], version: 1 });
      tokens.set(clientToken, { params: JSON.stringify(params), arns: [arn] });
      return { status: 200, body: { tasks: [structuredClone(tasks.get(arn))], failures: [] } };
    }
    if (op === 'ListTasks') {
      const all = [...tasks.values()].filter(t => t.clusterArn === body.cluster && t.startedBy === body.startedBy && t.desiredStatus === body.desiredStatus).map(t => t.taskArn);
      const start = Number(body.nextToken || 0);
      return { status: 200, body: { taskArns: all.slice(start, start + pageSize), ...(start + pageSize < all.length ? { nextToken: String(start + pageSize) } : {}) } };
    }
    if (op === 'DescribeTasks') {
      const found = body.tasks.filter((a: string) => tasks.has(a));
      return { status: 200, body: { tasks: found.map((a: string) => { const t = structuredClone(tasks.get(a)); delete t.tags; return t; }),
        failures: body.tasks.filter((a: string) => !tasks.has(a)).map((arn: string) => ({ arn, reason: 'MISSING' })) } };
    }
    if (op === 'StopTask') {
      const t = tasks.get(body.task);
      if (!t) return { status: 400, body: awsError('InvalidParameterException') };
      if (t.lastStatus !== 'STOPPED') Object.assign(t, { desiredStatus: 'STOPPED', lastStatus: 'STOPPING', stopCode: 'UserInitiated', stoppingAt: clock / 1000, stoppedReason: body.reason });
      t.tags = [];
      return { status: 200, body: { task: structuredClone(t) } };
    }
    return { status: 400, body: awsError('UnknownOperationException') };
  };
  const fetch: AwsFetch = async (url, init) => {
    assert.equal(url, ENDPOINT);
    assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 /, 'every request leaves signed');
    const op = init.headers['x-amz-target'].slice(`${ECS_API}.`.length) as Op;
    const body = JSON.parse(init.body);
    requests.push({ op, body: structuredClone(body), headers: { ...init.headers } });
    const f = take(op);
    const early = f === 'throwAfterStart' || f === 'capacity' || f === 'badJson' ? null : answer(f);
    const res = early ?? (f === 'capacity' ? { status: 200, body: { tasks: [], failures: [{ reason: 'Capacity is unavailable at this time.', detail: 'synthetic provider text' }] } } : handle(op, body));
    if (f === 'throwAfterStart') throw new Error('synthetic reset after the task was placed');
    return { status: res.status, async json() { if (f === 'badJson') throw new Error('truncated'); return structuredClone(res.body); } };
  };
  const arnOf = (id: string) => `${TASK_PREFIX}${id}`;
  const finish = (id: string, patch: object) => Object.assign(tasks.get(arnOf(id)), { desiredStatus: 'STOPPED', ...patch });
  const count = (op: Op) => requests.filter(r => r.op === op).length;
  return { fetch, tasks, taskDefinition, requests, fault, finish, arnOf, count, starts: () => count('RunTask'),
    tick: (seconds: number) => { clock += seconds * 1000; }, now: () => clock };
}
type Ecs = ReturnType<typeof fakeEcs>;
const executor = (ecs: Ecs, patch: Partial<AwsFargateConfig> = {}, extra: { starts?: AwsStartReservations; signer?: AwsRequestSigner; fetch?: AwsFetch } = {}) =>
  createAwsFargateExecutor({ config: config(patch), signer: extra.signer ?? fakeSigner().signer, fetch: extra.fetch ?? ecs.fetch,
    starts: extra.starts ?? reservationStore(), now: ecs.now });

test('disabled by default: every call refuses before any request leaves, and config is validated', async () => {
  const ecs = fakeEcs(), s = fakeSigner();
  const ex = executor(ecs, { enabled: false }, { signer: s.signer });
  refused(await ex.create(awsSpec()), 'provider_disabled');
  refused(await ex.estimate(awsSpec()), 'provider_disabled');
  const ref: ExecutionRef = { provider: 'aws', execution_id: '1'.padStart(32, '0'), tenant_id: 11, run_id: 'run-synthetic', attempt: 1, execution_generation: 1, region: 'weur' };
  for (const call of ['get', 'terminate', 'collect', 'cleanup'] as const) refused(await ex[call](ref), 'provider_disabled');
  assert.equal(ecs.requests.length + s.signed.length, 0);
  const bad: Partial<AwsFargateConfig>[] = [{ aws_region: 'EU-WEST-1' }, { task_definition_arn: TASK_DEF.replace(':7', '') },
    { task_definition_arn: TASK_DEF.replace('eu-west-1', 'us-east-1') }, { task_definition_arn: TASK_DEF.replace(ACCOUNT, '111111111111') },
    { cluster_arn: CLUSTER.replace('arn:aws:', 'arn:aws-us-gov:') }, { platform_version: 'LATEST' }, { registry_repository: `${REPO}:latest` },
    { subnets: [] }, { subnets: ['subnet-xyz'] }, { security_groups: [] }, { task_timeout_max_s: 0 }];
  for (const patch of bad) assert.throws(() => executor(ecs, patch), /Invalid AWS Fargate configuration/, JSON.stringify(patch));
  assert.throws(() => createAwsFargateExecutor({ config: config(), signer: s.signer, fetch: ecs.fetch, starts: undefined as any, now: ecs.now }), /Missing AWS start reservation store/);
  assert.throws(() => createAwsFargateExecutor({ config: config(), signer: undefined as any, fetch: ecs.fetch, starts: reservationStore(), now: ecs.now }), /Missing AWS signer/);
  assert.throws(() => createAwsFargateExecutor({ config: config(), signer: s.signer, fetch: ecs.fetch, starts: reservationStore(), now: undefined as any }), /Missing AWS clock/);
});

test('create runs the digest-pinned revision once on Fargate, private awsvpc, idempotency token, attribution tags and references only', async () => {
  const ecs = fakeEcs(), s = fakeSigner();
  const ex = executor(ecs, {}, { signer: s.signer });
  const spec = awsSpec();
  const created = value(await ex.create(spec));
  assert.deepEqual([created.state, created.ref.provider, created.ref.region, created.ref.execution_id], ['provisioning', 'aws', 'weur', '1'.padStart(32, '0')]);
  const run = ecs.requests.find(r => r.op === 'RunTask')!;
  const { clientToken, startedBy } = await awsStartTokens(CLUSTER, KEY);
  assert.match(clientToken, /^[0-9a-f]{64}$/);
  assert.match(startedBy, /^[A-Za-z0-9/_-]{1,128}$/);
  assert.deepEqual(run.body, {
    cluster: CLUSTER, taskDefinition: TASK_DEF, count: 1, launchType: 'FARGATE', platformVersion: '1.4.0', clientToken, startedBy,
    enableExecuteCommand: false, propagateTags: 'NONE',
    networkConfiguration: { awsvpcConfiguration: { subnets: ['subnet-0123456789abcdef0'], securityGroups: ['sg-0123456789abcdef0'], assignPublicIp: 'DISABLED' } },
    overrides: { containerOverrides: [{ name: 'workspace', environment: [{ name: 'AXAL_EXECUTION_KEY', value: KEY },
      { name: 'AXAL_RUN_ID', value: 'run-synthetic' }, { name: 'AXAL_EXECUTION_GENERATION', value: '1' }, { name: 'AXAL_MAX_DURATION_S', value: '60' }] }] },
    tags: [{ key: 'axal:tenant', value: '11' }, { key: 'axal:run', value: 'run-synthetic' }, { key: 'axal:attempt', value: '1' }, { key: 'axal:generation', value: '1' }],
  });
  assert.doesNotMatch(JSON.stringify(run.body), /secret|password|taskRoleArn|executionRoleArn|image/i);
  assert.ok(Buffer.byteLength(JSON.stringify(run.body.overrides)) < 8192, 'overrides fit the 8192-character limit');
  // Every call went through the injected signer, for service ecs in the configured region, and was sent as signed.
  assert.equal(s.signed.length, ecs.requests.length);
  assert.ok(s.signed.every(r => r.service === 'ecs' && r.region === 'eu-west-1' && r.url === ENDPOINT && r.method === 'POST'));
  assert.deepEqual(s.signed.map(r => r.headers['x-amz-target']), ecs.requests.map(r => r.headers['x-amz-target']));
  assert.deepEqual(s.signed.map(r => r.body), ecs.requests.map(r => JSON.stringify(r.body)));
  value(await ex.create(spec));
  assert.equal(ecs.starts(), 1, 'the same spec again finds the task instead of starting a second');
  assert.equal(awsExecutionKey(spec), KEY);
});

test('a signer that refuses or returns no signature sends nothing and spends no key', async () => {
  const ecs = fakeEcs(), s = fakeSigner(), starts = reservationStore();
  s.refuseNext(true);
  refused(await executor(ecs, {}, { signer: s.signer, starts }).create(awsSpec()), 'provider_auth_unavailable');
  const unsigned: AwsRequestSigner = { async sign(req) { return { ...req.headers }; } };
  refused(await executor(ecs, {}, { signer: unsigned, starts }).create(awsSpec()), 'provider_auth_unavailable');
  const retargeted: AwsRequestSigner = { async sign(req) { return { ...req.headers, authorization: 'AWS4-HMAC-SHA256 x', 'x-amz-target': `${ECS_API}.StopTask` }; } };
  refused(await executor(ecs, {}, { signer: retargeted, starts }).create(awsSpec()), 'provider_auth_unavailable');
  assert.equal(ecs.requests.length, 0);
  // Signing fails only at RunTask: the lookups went out, the start did not, and the key is still unspent.
  let signs = 0;
  const lateRefusal: AwsRequestSigner = { async sign(req) { if (req.headers['x-amz-target'].endsWith('.RunTask') && signs++ === 0) throw new Error('refused'); return s.signer.sign(req); } };
  s.refuseNext(false);
  refused(await executor(ecs, {}, { signer: lateRefusal, starts }).create(awsSpec()), 'provider_auth_unavailable');
  assert.equal(ecs.starts(), 0);
  assert.equal(value(await executor(ecs, {}, { signer: lateRefusal, starts }).create(awsSpec())).state, 'provisioning');
});

test('a revision not pinned to the digest, with a task role, secrets, the wrong shape or too small is refused before any start', async () => {
  const cases: [(td: any) => void, string, object?][] = [
    [td => { td.containerDefinitions[0].image = `${REPO}@sha256:${'c'.repeat(64)}`; }, 'image_digest'],
    [td => { td.containerDefinitions[0].image = `${REPO}:latest`; }, 'image_digest'],
    [td => { td.containerDefinitions.push({ name: 'sidecar', image: `${REPO}@${DIGEST}` }); }, 'task_shape'],
    [td => { td.containerDefinitions[0].essential = false; }, 'task_shape'],
    [td => { td.networkMode = 'bridge'; }, 'task_shape'],
    [td => { td.requiresCompatibilities = ['EC2']; }, 'task_shape'],
    [td => { td.taskRoleArn = `arn:aws:iam::${ACCOUNT}:role/synthetic-task`; }, 'credentials'],
    [td => { td.containerDefinitions[0].secrets = [{ name: 'TOKEN', valueFrom: 'arn:synthetic' }]; }, 'credentials'],
    [td => { td.containerDefinitions[0].environmentFiles = [{ type: 's3', value: 'arn:synthetic' }]; }, 'credentials'],
    [td => { td.cpu = '256'; }, 'cpu'],
    [td => { td.memory = '256'; }, 'memory'],
    [() => {}, 'disk', { disk_mb: 21 * 1024 + 1 }],
    // Without ephemeralStorage a Fargate task gets the default 20 GiB.
    [td => { delete td.ephemeralStorage; }, 'disk', { disk_mb: 20 * 1024 + 1 }],
  ];
  for (const [change, capability, specPatch] of cases) {
    const ecs = fakeEcs(), starts = reservationStore();
    change(ecs.taskDefinition);
    refused(await executor(ecs, { disk_mb_max: 40960 }, { starts }).create(awsSpec(specPatch)), 'capability_denied', capability);
    assert.equal(ecs.starts(), 0, capability);
    for (const k of Object.keys(ecs.taskDefinition)) delete ecs.taskDefinition[k];
    Object.assign(ecs.taskDefinition, taskDefinitionFixture());
    assert.equal(value(await executor(ecs, { disk_mb_max: 40960 }, { starts }).create(awsSpec())).state, 'provisioning', `${capability}: the key was not spent`);
  }
  // A deregistered revision, or one ECS describes under another ARN, is not run.
  for (const change of [(td: any) => { td.status = 'INACTIVE'; }, (td: any) => { td.taskDefinitionArn = TASK_DEF.replace(':7', ':8'); }]) {
    const ecs = fakeEcs();
    change(ecs.taskDefinition);
    refused(await executor(ecs).create(awsSpec()), 'provider_rejected');
    assert.equal(ecs.starts(), 0);
  }
});

test('an unsupported feature fails closed with the capability named, never a best-effort run', async () => {
  const ecs = fakeEcs();
  const cases: [Partial<AwsFargateConfig>, object, string][] = [
    [{ untrusted_code: false }, {}, 'hostile_code_isolation'],
    [{ enforced_network_modes: [] }, {}, 'network_policy'],
    [{}, { network_policy: { mode: 'allowlist', destinations: [{ hostname: 'api.example.com', port: 443 }] } }, 'network_policy'],
    [{}, { checkpoint_manifest_ref: 'checkpoint-synthetic' }, 'checkpoint_restore'],
    [{ task_timeout_max_s: 30 }, {}, 'duration'],
    [{ regions: ['enam'] }, {}, 'region'],
    [{ cpu_max: 0.25 }, {}, 'cpu'],
    [{ memory_mb_max: 256 }, {}, 'memory'],
    [{ disk_mb_max: 100 }, {}, 'disk'],
    [{ concurrency_max: 0 }, {}, 'capacity_unverified'],
  ];
  for (const [patch, specPatch, capability] of cases) {
    refused(await executor(ecs, patch).create(awsSpec(specPatch)), 'capability_denied', capability);
  }
  refused(await executor(ecs).create(specFixture()), 'capability_denied', 'provider');
  refused(await executor(ecs).create({ ...awsSpec(), image_digest: 'latest' } as any), 'invalid_workspace_spec');
  assert.equal(ecs.requests.length, 0, 'nothing was sent for a refused spec');
  assert.equal((await executor(ecs).capabilities()).gpu, false);
});

test('an ambiguous RunTask is resent once with the same client token and lands once; a lost resend is located later by key', async () => {
  // The first answer is lost after the task was placed; the identical resend returns the original task.
  for (const fault of ['throwAfterStart', 'badJson', [500, 'ServerException'], [503, 'ServiceUnavailable'], 408, [400, 'RequestTimeoutException']] as Fault[]) {
    const ecs = fakeEcs(), ex = executor(ecs);
    ecs.fault('RunTask', fault);
    const created = value(await ex.create(awsSpec()));
    assert.deepEqual([created.state, created.ref.execution_id], ['provisioning', '1'.padStart(32, '0')], JSON.stringify(fault));
    const runs = ecs.requests.filter(r => r.op === 'RunTask');
    assert.equal(runs.length, 2, JSON.stringify(fault));
    assert.deepEqual(runs[0].body, runs[1].body, 'the resend is byte-for-byte the same request, token included');
    assert.equal(ecs.tasks.size, 1, `${JSON.stringify(fault)}: one task, never two`);
  }
  // Both sends lost after placement: unknown, then located by startedBy and the key, never started again.
  for (const faults of [['throwAfterStart', 'throwAfterStart'], ['throw', 'throw'], [[503, 'ServiceUnavailable'], 'throwAfterStart']] as Fault[][]) {
    const ecs = fakeEcs(), ex = executor(ecs);
    ecs.fault('RunTask', ...faults);
    const lost = value(await ex.create(awsSpec()));
    assert.deepEqual([lost.state, lost.failure_code, lost.ref.execution_id], ['unknown', 'start_ambiguous', `pending:${KEY}`]);
    const located = value(await ex.get(lost.ref));
    if (ecs.tasks.size) {
      assert.deepEqual([located.state, located.ref.execution_id], ['provisioning', '1'.padStart(32, '0')]);
    } else {
      assert.deepEqual([located.state, located.failure_code], ['unknown', 'start_ambiguous'], 'an empty list is not proof the start never landed');
    }
    assert.equal(value(await ex.create(awsSpec())).state, ecs.tasks.size ? 'provisioning' : 'unknown');
    assert.equal(ecs.starts(), 2, `${JSON.stringify(faults)}: the late retry is never sent, the token may have expired`);
    assert.ok(ecs.tasks.size <= 1);
  }
  // ECS says the token belongs to a different request: located by key, never started under a new token.
  const ecs = fakeEcs(), ex = executor(ecs);
  ecs.fault('RunTask', [400, 'ConflictException']);
  assert.equal(value(await ex.create(awsSpec())).failure_code, 'start_ambiguous');
  assert.equal(ecs.starts(), 1);
  // A 200 that placed a task this key does not own is not trusted.
  const odd = fakeEcs();
  const lying: AwsFetch = async (url, init) => { const res = await odd.fetch(url, init); if (!init.headers['x-amz-target'].endsWith('.RunTask')) return res;
    const body: any = await res.json(); body.tasks[0].startedBy = 'someone-else'; return { status: 200, json: async () => body }; };
  assert.equal(value(await executor(odd, {}, { fetch: lying }).create(awsSpec())).failure_code, 'start_ambiguous');
});

test('duplicate starts: two tasks with one key are refused, list pages are followed, and concurrent adapters share one reservation', async () => {
  const ecs = fakeEcs({ pageSize: 1 }), ex = executor(ecs);
  const ref = value(await ex.create(awsSpec())).ref;
  const twin = '9'.repeat(32);
  ecs.tasks.set(ecs.arnOf(twin), { ...structuredClone(ecs.tasks.get(ecs.arnOf(ref.execution_id))), taskArn: ecs.arnOf(twin) });
  refused(await ex.create(awsSpec()), 'duplicate_execution');
  refused(await ex.get({ ...ref, execution_id: `pending:${KEY}` }), 'duplicate_execution');
  assert.ok(ecs.requests.some(r => r.op === 'ListTasks' && r.body.nextToken === '1'), 'the list was followed past its first page');
  assert.ok(ecs.requests.filter(r => r.op === 'ListTasks').every(r => Object.keys(r.body).sort().join() === ['cluster', 'desiredStatus', 'maxResults', 'startedBy', ...(r.body.nextToken ? ['nextToken'] : [])].sort().join()));
  // A stopped task is still found: ListTasks is asked for both desired statuses.
  const stopped = fakeEcs(), ex2 = executor(stopped);
  const sref = value(await ex2.create(awsSpec())).ref;
  stopped.finish(sref.execution_id, { lastStatus: 'STOPPED', stopCode: 'EssentialContainerExited', containers: [{ name: 'workspace', exitCode: 0 }] });
  assert.equal(value(await ex2.create(awsSpec())).state, 'finished');
  assert.equal(stopped.starts(), 1);

  const other = fakeEcs(), starts = reservationStore();
  const blind: AwsFetch = async (url, init) => init.headers['x-amz-target'].endsWith('.ListTasks') ? { status: 200, json: async () => ({ taskArns: [] }) } : other.fetch(url, init);
  other.fault('RunTask', 'throwAfterStart', 'throwAfterStart');
  const results = await Promise.all(Array.from({ length: 12 }, () => executor(other, {}, { starts, fetch: blind }).create(awsSpec())));
  assert.ok(results.every(r => r.ok));
  assert.equal(other.tasks.size, 1);
  value(await executor(other, {}, { starts, fetch: blind }).create(awsSpec({ execution_generation: 2 })));
  assert.equal(other.tasks.size, 2, 'a new fenced generation has its own reservation and token');
});

test('a failed reservation sends no start, including a store that committed before losing its reply', async () => {
  const ecs = fakeEcs(), store = reservationStore();
  let fail = true;
  const starts = { async reserve(key: string) { const won = await store.reserve(key); if (fail) { fail = false; throw new Error('lost reply'); } return won; }, refuse: (key: string) => store.refuse(key) };
  refused(await executor(ecs, {}, { starts }).create(awsSpec()), 'start_reservation_unavailable');
  assert.equal(value(await executor(ecs, {}, { starts }).create(awsSpec())).failure_code, 'start_ambiguous');
  assert.equal(ecs.starts(), 0);
});

test('throttling, capacity and revoked permission: definite refusals spend the generation; provider text never travels', async () => {
  const ecs = fakeEcs(), starts = reservationStore();
  const ex = () => executor(ecs, {}, { starts });
  const cases: [Fault, string][] = [[[400, 'ThrottlingException'], 'provider_quota'], ['capacity', 'provider_capacity'],
    [[400, 'AccessDeniedException'], 'provider_auth_refused'], [[403, 'AccessDeniedException'], 'provider_auth_refused'],
    [[403, 'ExpiredTokenException'], 'provider_auth_refused'], [[403, 'UnrecognizedClientException'], 'provider_auth_refused'],
    [[400, 'InvalidParameterException'], 'provider_rejected'], [[400, 'ClusterNotFoundException'], 'provider_rejected'],
    [[400, 'PlatformUnknownException'], 'provider_rejected'], [[400, 'UnsupportedFeatureException'], 'provider_rejected']];
  let generation = 10;
  for (const [fault, code] of cases) {
    ecs.fault('RunTask', fault);
    const r = await ex().create(awsSpec({ execution_generation: ++generation }));
    refused(r, code);
    assert.doesNotMatch(JSON.stringify(r), /synthetic provider text|Capacity is unavailable/);
    refused(await ex().create(awsSpec({ execution_generation: generation })), 'start_generation_refused');
  }
  assert.equal(ecs.starts(), cases.length, 'a definite refusal is never resent');
  assert.equal(ecs.tasks.size, 0);
  // Throttled or revoked before the start: the list or the revision read refuses, nothing starts and no key is spent.
  ecs.fault('ListTasks', [400, 'ThrottlingException']);
  refused(await ex().create(awsSpec()), 'provider_quota');
  ecs.fault('DescribeTaskDefinition', [400, 'AccessDeniedException']);
  refused(await ex().create(awsSpec()), 'provider_auth_refused');
  ecs.fault('DescribeTaskDefinition', 'throw');
  refused(await ex().create(awsSpec()), 'provider_unavailable');
  ecs.fault('DescribeTasks', [500, 'ServerException']);
  ecs.tasks.set(ecs.arnOf('f'.repeat(32)), { taskArn: ecs.arnOf('f'.repeat(32)), clusterArn: CLUSTER, startedBy: (await awsStartTokens(CLUSTER, KEY)).startedBy, desiredStatus: 'RUNNING' });
  refused(await ex().create(awsSpec()), 'provider_unavailable');
  ecs.tasks.delete(ecs.arnOf('f'.repeat(32)));
  assert.equal(ecs.starts(), cases.length);
  assert.equal(value(await ex().create(awsSpec())).state, 'provisioning');
  // Reads under revoked permission or throttling refuse; a 5xx or dropped read is unknown, not failed.
  const ref = value(await ex().create(awsSpec())).ref;
  ecs.fault('DescribeTasks', [400, 'AccessDeniedException']);
  refused(await ex().get(ref), 'provider_auth_refused');
  ecs.fault('DescribeTasks', [400, 'ThrottlingException']);
  refused(await ex().get(ref), 'provider_quota');
  ecs.fault('DescribeTasks', [503, 'ServiceUnavailable']);
  assert.equal(value(await ex().get(ref)).failure_code, 'provider_unreachable');
  ecs.fault('DescribeTasks', 'throw');
  assert.equal(value(await ex().get(ref)).state, 'unknown');
  ecs.fault('StopTask', [400, 'AccessDeniedException']);
  refused(await ex().terminate(ref), 'provider_auth_refused');
});

test('each lastStatus and stopCode maps to one D5565 state; an unrecognised one is unknown', async () => {
  const ecs = fakeEcs(), ex = executor(ecs);
  const ref = value(await ex.create(awsSpec())).ref;
  const T = T0 / 1000;
  const cases: [object, string, string?][] = [
    [{ lastStatus: 'PROVISIONING' }, 'provisioning'], [{ lastStatus: 'PENDING' }, 'provisioning'], [{ lastStatus: 'ACTIVATING' }, 'provisioning'],
    [{ lastStatus: 'RUNNING', startedAt: T + 5 }, 'running'],
    [{ lastStatus: 'DEACTIVATING', startedAt: T + 5 }, 'running'], [{ lastStatus: 'STOPPING', startedAt: T + 5 }, 'running'],
    [{ lastStatus: 'DEPROVISIONING' }, 'provisioning'],
    [{ lastStatus: 'STOPPING', stopCode: 'UserInitiated', startedAt: T + 5 }, 'cancelling'], [{ lastStatus: 'DEPROVISIONING', stopCode: 'UserInitiated' }, 'cancelling'],
    [{ lastStatus: 'STOPPED', stopCode: 'UserInitiated', stoppingAt: T + 10 }, 'cancelled'],
    [{ lastStatus: 'STOPPED', stopCode: 'UserInitiated', stoppingAt: T + 60 }, 'cancelled', 'deadline_exceeded'],
    [{ lastStatus: 'STOPPED', stopCode: 'EssentialContainerExited', containers: [{ name: 'workspace', exitCode: 0 }] }, 'finished'],
    [{ lastStatus: 'DELETED', stopCode: 'EssentialContainerExited', containers: [{ name: 'workspace', exitCode: 0 }] }, 'finished'],
    [{ lastStatus: 'STOPPED', stopCode: 'EssentialContainerExited', containers: [{ name: 'workspace', exitCode: 137 }] }, 'failed', 'non_zero_exit'],
    [{ lastStatus: 'STOPPED', stopCode: 'EssentialContainerExited', containers: [{ name: 'workspace' }] }, 'failed', 'failed'],
    [{ lastStatus: 'STOPPED', stopCode: 'TaskFailedToStart' }, 'failed', 'start_failed'],
    [{ lastStatus: 'STOPPED', stopCode: 'SpotInterruption' }, 'failed', 'interrupted'],
    [{ lastStatus: 'STOPPED', stopCode: 'TerminationNotice' }, 'failed', 'interrupted'],
    [{ lastStatus: 'STOPPED', stopCode: 'ServiceSchedulerInitiated' }, 'unknown'], [{ lastStatus: 'STOPPED' }, 'unknown'],
    [{ lastStatus: 'SOMETHING_NEW' }, 'unknown'], [{ lastStatus: undefined }, 'unknown'],
  ];
  const base = structuredClone(ecs.tasks.get(ecs.arnOf(ref.execution_id)));
  for (const [patch, expected, failure] of cases) {
    ecs.tasks.set(ecs.arnOf(ref.execution_id), { ...structuredClone(base), ...patch });
    const got = value(await ex.get(ref));
    assert.deepEqual([got.state, got.failure_code], [expected, failure], JSON.stringify(patch));
  }
  assert.deepEqual(Object.keys(AWS_FARGATE_STATUS).sort(), ['ACTIVATING', 'PENDING', 'PROVISIONING', 'RUNNING', 'STOPPED/EssentialContainerExited',
    'STOPPED/SpotInterruption', 'STOPPED/TaskFailedToStart', 'STOPPED/TerminationNotice', 'STOPPED/UserInitiated']);
  assert.equal(ecs.count('StopTask'), 0, 'no read inside the deadline stopped anything');
});

test('timeout: Fargate has none, so a read past the deadline stops the task once and reports why', async () => {
  const ecs = fakeEcs(), ex = executor(ecs);
  const ref = value(await ex.create(awsSpec())).ref;
  Object.assign(ecs.tasks.get(ecs.arnOf(ref.execution_id)), { lastStatus: 'RUNNING', startedAt: T0 / 1000 + 5 });
  ecs.tick(59);
  assert.equal(value(await ex.get(ref)).state, 'running');
  assert.equal(ecs.count('StopTask'), 0);
  ecs.tick(1);
  ecs.fault('StopTask', 'throw');
  assert.deepEqual([value(await ex.get(ref)).state, value(await ex.get(ref)).failure_code], ['unknown', 'deadline_exceeded']);
  const stops = ecs.requests.filter(r => r.op === 'StopTask');
  assert.deepEqual(stops.at(-1)!.body, { cluster: CLUSTER, task: ecs.arnOf(ref.execution_id), reason: 'axal: deadline' });
  assert.equal(value(await ex.get(ref)).state, 'cancelling');
  assert.equal(ecs.count('StopTask'), 2, 'a cancelling task is not stopped again');
  ecs.finish(ref.execution_id, { lastStatus: 'STOPPED' });
  assert.deepEqual([value(await ex.get(ref)).state, value(await ex.get(ref)).failure_code], ['cancelled', 'deadline_exceeded']);
  // A task whose duration cannot be read is not reported as healthy.
  const ecs2 = fakeEcs(), ex2 = executor(ecs2);
  const ref2 = value(await ex2.create(awsSpec())).ref;
  delete ecs2.tasks.get(ecs2.arnOf(ref2.execution_id)).createdAt;
  assert.deepEqual([value(await ex2.get(ref2)).state, value(await ex2.get(ref2)).failure_code], ['unknown', 'deadline_unverifiable']);
  assert.equal(ecs2.count('StopTask'), 0);
});

test('cancel: StopTask once, a dropped stop is ambiguous and repeated safely, an ended task is left alone', async () => {
  const ecs = fakeEcs(), ex = executor(ecs);
  const ref = value(await ex.create(awsSpec())).ref;
  Object.assign(ecs.tasks.get(ecs.arnOf(ref.execution_id)), { lastStatus: 'RUNNING', startedAt: T0 / 1000 + 5 });
  refused(await ex.collect(ref), 'execution_not_terminal');
  ecs.fault('StopTask', 'throwAfterStart');
  assert.deepEqual(value(await ex.terminate(ref)).failure_code, 'stop_ambiguous');
  assert.equal(value(await ex.terminate(ref)).state, 'cancelling', 'the stop had landed; the retry reads it and sends nothing');
  assert.equal(ecs.count('StopTask'), 1);
  const ecs2 = fakeEcs(), ex2 = executor(ecs2);
  const ref2 = value(await ex2.create(awsSpec())).ref;
  ecs2.fault('StopTask', [503, 'ServiceUnavailable']);
  assert.deepEqual(value(await ex2.terminate(ref2)).failure_code, 'stop_ambiguous');
  assert.equal(value(await ex2.terminate(ref2)).state, 'cancelling');
  assert.deepEqual(ecs2.requests.filter(r => r.op === 'StopTask').at(-1)!.body, { cluster: CLUSTER, task: ecs2.arnOf(ref2.execution_id), reason: 'axal: cancelled' });
  ecs2.finish(ref2.execution_id, { lastStatus: 'STOPPED' });
  assert.equal(value(await ex2.terminate(ref2)).state, 'cancelled');
  assert.equal(ecs2.count('StopTask'), 2, 'an ended task is never sent a stop');
  assert.deepEqual(value(await ex2.collect(ref2)), { manifest_ref: null, checkpoint_manifest_ref: null });
  // An unlocated task cannot be stopped yet; once it is visible, the stop goes out.
  const late = fakeEcs();
  let visible = false;
  const hidden: AwsFetch = async (url, init) => !visible && init.headers['x-amz-target'].endsWith('.ListTasks') ? { status: 200, json: async () => ({ taskArns: [] }) } : late.fetch(url, init);
  const ex3 = executor(late, {}, { fetch: hidden });
  late.fault('RunTask', 'throwAfterStart', 'throwAfterStart');
  const pendingRef = value(await ex3.create(awsSpec())).ref;
  assert.equal(value(await ex3.terminate(pendingRef)).failure_code, 'stop_ambiguous');
  assert.equal(late.count('StopTask'), 0);
  visible = true;
  assert.equal(value(await ex3.terminate(pendingRef)).state, 'cancelling');
  assert.equal(late.count('StopTask'), 1);
});

test('exact owned cleanup: only an ended task this ref owns counts, nothing is deleted, an expired record is clean', async () => {
  const ecs = fakeEcs(), ex = executor(ecs);
  const ref = value(await ex.create(awsSpec())).ref;
  const other = value(await ex.create(awsSpec({ execution_generation: 2 }))).ref;
  refused(await ex.cleanup(ref), 'cleanup_not_terminal');
  ecs.finish(ref.execution_id, { lastStatus: 'STOPPED', stopCode: 'EssentialContainerExited', containers: [{ name: 'workspace', exitCode: 0 }] });
  ecs.finish(other.execution_id, { lastStatus: 'STOPPED', stopCode: 'EssentialContainerExited', containers: [{ name: 'workspace', exitCode: 0 }] });
  refused(await ex.cleanup({ ...ref, tenant_id: ref.tenant_id + 1 }), 'execution_not_authorized');
  refused(await ex.cleanup({ ...other, execution_id: ref.execution_id }), 'execution_not_authorized');
  refused(await ex.cleanup({ ...ref, region: 'enam' }), 'execution_not_authorized');
  refused(await ex.cleanup({ ...ref, execution_id: `../${ref.execution_id}` }), 'execution_not_authorized');
  ecs.fault('DescribeTasks', 'throw');
  refused(await ex.cleanup(ref), 'cleanup_not_terminal');
  // Only a MISSING failure is an absence; any other describe failure proves nothing and cleans nothing.
  const vague: AwsFetch = async (url, init) => init.headers['x-amz-target'].endsWith('.DescribeTasks')
    ? { status: 200, json: async () => ({ tasks: [], failures: [{ arn: ecs.arnOf(ref.execution_id), reason: 'INTERNAL' }] }) } : ecs.fetch(url, init);
  refused(await executor(ecs, {}, { fetch: vague }).cleanup(ref), 'cleanup_not_terminal');
  assert.equal(value(await executor(ecs, {}, { fetch: vague }).get(ref)).failure_code, 'provider_unreachable');
  assert.deepEqual(value(await ex.cleanup(ref)), { cleaned: true });
  // ECS expires a stopped task's record on its own; cleaning again is idempotent.
  ecs.tasks.delete(ecs.arnOf(ref.execution_id));
  assert.deepEqual(value(await ex.cleanup(ref)), { cleaned: true });
  assert.ok(ecs.tasks.has(ecs.arnOf(other.execution_id)), 'the other generation\'s task is untouched');
  assert.deepEqual([...new Set(ecs.requests.map(r => r.op))].sort(), ['DescribeTaskDefinition', 'DescribeTasks', 'ListTasks', 'RunTask'],
    'cleanup never stops, deregisters or deletes anything');
});

test('a ref for another tenant, generation, cluster or task definition cannot read or stop a task by naming it', async () => {
  const ecs = fakeEcs(), ex = executor(ecs);
  const ref = value(await ex.create(awsSpec())).ref;
  refused(await ex.get({ ...ref, tenant_id: ref.tenant_id + 1 }), 'execution_not_authorized');
  refused(await ex.terminate({ ...ref, execution_generation: ref.execution_generation + 1 }), 'execution_not_authorized');
  refused(await ex.get({ ...ref, provider: 'gcp' } as ExecutionRef), 'execution_not_authorized');
  refused(await ex.get({ ...ref, execution_id: 'e'.repeat(32) }), 'execution_not_found');
  const task = ecs.tasks.get(ecs.arnOf(ref.execution_id));
  for (const [field, foreign] of [['taskDefinitionArn', TASK_DEF.replace(':7', ':6')], ['clusterArn', CLUSTER.replace('axal-synthetic', 'other')],
    ['startedBy', 'axal-other'], ['taskArn', `${TASK_PREFIX.replace('axal-synthetic', 'other')}${ref.execution_id}`]] as const) {
    const original = task[field];
    task[field] = foreign;
    refused(await ex.get(ref), 'execution_not_authorized');
    task[field] = original;
  }
  task.overrides.containerOverrides[0].environment[0].value = '12.run-synthetic.a1.g1';
  refused(await ex.get(ref), 'execution_not_authorized');
  task.overrides.containerOverrides[0].environment[0].value = KEY;
  // ECS answering a describe for one id with another task this key owns is not taken as that id.
  const twin = '7'.repeat(32);
  ecs.tasks.set(ecs.arnOf(twin), { ...structuredClone(task), taskArn: ecs.arnOf(twin) });
  const swapped: AwsFetch = async (url, init) => {
    if (!init.headers['x-amz-target'].endsWith('.DescribeTasks')) return ecs.fetch(url, init);
    return ecs.fetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), tasks: [ecs.arnOf(twin)] }) });
  };
  refused(await executor(ecs, {}, { fetch: swapped }).get(ref), 'execution_not_authorized');
  assert.equal(ecs.count('StopTask'), 0);
});

test('an estimate needs priced rates: none is a refusal, never 0; Fargate bills the revision size for at least a minute', async () => {
  const ecs = fakeEcs();
  refused(await executor(ecs).estimate(awsSpec()), 'estimate_unavailable');
  const priced = executor(ecs, { rates: { vcpu_second_microusd: 12, gib_second_microusd: 2 } });
  // max(60, 60) s × (1 vCPU × 12 + 2 GiB × 2) = 960
  assert.deepEqual(value(await priced.estimate(awsSpec())), { cost_microusd: 960, measured: false });
  // A 10-second spec still bills a minute.
  assert.deepEqual(value(await priced.estimate(awsSpec({ max_duration_s: 10 }))), { cost_microusd: 960, measured: false });
  assert.equal(ecs.requests.length, 0);
});
