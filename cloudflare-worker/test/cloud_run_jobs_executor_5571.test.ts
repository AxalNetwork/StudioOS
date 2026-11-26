/**
 * #5571 (D5571 part 2): the disabled Google Cloud Run Jobs adapter over a synthetic Cloud Run Admin API v2 endpoint.
 * Every provider answer is a recorded synthetic fixture shaped like the v2 reference (Job, Execution, Operation,
 * google.rpc error). No live Google Cloud project, no credential, no network.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cloud_run_jobs_executor_5571.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_RUN_STATUS, cloudRunExecutionKey, createCloudRunJobsExecutor, type CloudRunJobsConfig, type CloudRunRequest,
  type CloudRunResponse, type CloudRunStartReservations } from '../src/services/agents/cloudRunJobsExecutor.ts';
import type { ExecutionRef, WorkspaceResult } from '../src/services/agents/workspaceSpec.ts';
import { specFixture } from './_workspace_fake_5565.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string, capability?: string) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (!r.ok) { assert.equal(r.code, code); if (capability) assert.equal(r.capability, capability); }
};

const JOB_NAME = 'projects/axal-synthetic/locations/europe-west1/jobs/job-synthetic';
const JOB = `/v2/${JOB_NAME}`;
const REPO = 'europe-docker.pkg.dev/axal-synthetic/workspace/runner';
const config = (patch: Partial<CloudRunJobsConfig> = {}): CloudRunJobsConfig => ({ enabled: true, project_id: 'axal-synthetic',
  location: 'europe-west1', job_name: 'job-synthetic', registry_repository: REPO, regions: ['weur'], task_timeout_max_s: 3600,
  cpu_max: 2, memory_mb_max: 4096, disk_mb_max: 2048, concurrency_max: 5, enforced_network_modes: ['deny'],
  untrusted_code: true, checkpoint_restore: false, rates: null, ...patch });
const gcpSpec = (patch = {}) => specFixture({ allowed_providers: ['gcp'], ...patch });
const DIGEST = gcpSpec().image_digest;

// Recorded synthetic fixtures, shaped like the Cloud Run Admin API v2 reference.
const jobFixture = () => ({ name: JOB_NAME, uid: 'synthetic-job-uid', etag: '"job-etag-1"', launchStage: 'GA',
  template: { taskCount: 1, parallelism: 1, template: { containers: [{ name: 'workspace', image: `${REPO}@${DIGEST}`,
    resources: { limits: { cpu: '2', memory: '4096Mi' } } }], maxRetries: 0, timeout: '600s', executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2' } } });
const executionFixture = (id: string, n: number, overrides: any, timeout: string) => ({ name: `${JOB_NAME}/executions/${id}`,
  uid: `synthetic-execution-uid-${n}`, etag: `"execution-etag-${n}"`, job: 'job-synthetic', taskCount: 1, parallelism: 1,
  runningCount: 0, succeededCount: 0, failedCount: 0, cancelledCount: 0,
  template: { containers: [{ name: 'workspace', image: `${REPO}@${DIGEST}`, env: overrides.containerOverrides[0].env }], maxRetries: 0, timeout },
  conditions: [{ type: 'ResourcesAvailable', state: 'CONDITION_SUCCEEDED' }, { type: 'Completed', state: 'CONDITION_PENDING' }] });
const operationFixture = (metadata: unknown) => ({ name: 'projects/axal-synthetic/locations/europe-west1/operations/synthetic-op',
  metadata: metadata === undefined ? undefined : { '@type': 'type.googleapis.com/google.cloud.run.v2.Execution', ...(metadata as object) }, done: false });
const rpcError = (code: number, status: string) => ({ error: { code, message: 'synthetic provider text', status } });

function reservationStore(): CloudRunStartReservations {
  const keys = new Map<string, 'pending' | 'refused'>();
  return {
    async reserve(key) { const prior = keys.get(key); if (prior) return prior; keys.set(key, 'pending'); return 'acquired'; },
    async refuse(key) { assert.equal(keys.get(key), 'pending'); keys.set(key, 'refused'); },
  };
}
const executor = (args: { config: CloudRunJobsConfig; transport: { request(req: CloudRunRequest): Promise<CloudRunResponse> }; starts?: CloudRunStartReservations }) =>
  createCloudRunJobsExecutor({ ...args, starts: args.starts ?? reservationStore() });

type Fault = number | [number, string] | 'throw' | 'throwAfterStart' | 'noMetadata';
/** A synthetic Cloud Run v2 endpoint for one job. A fault overrides the next answer for that operation. */
function fakeRun({ pageSize = 100 } = {}) {
  const job: any = jobFixture();
  const executions = new Map<string, any>();
  const requests: CloudRunRequest[] = [];
  let n = 0;
  const faults: { run?: Fault; cancel?: Fault; delete?: Fault; get?: Fault; list?: Fault; job?: Fault } = {};
  const take = (op: keyof typeof faults) => { const f = faults[op]; delete faults[op]; return f; };
  const answer = (f: Fault | undefined): CloudRunResponse | null => {
    if (f === 'throw') throw new Error('synthetic network reset');
    if (typeof f === 'number') return { status: f, body: rpcError(f, 'UNKNOWN') };
    if (Array.isArray(f)) return { status: f[0], body: rpcError(f[0], f[1]) };
    return null;
  };
  const escaped = JOB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const transport = {
    async request(req: CloudRunRequest): Promise<CloudRunResponse> {
      requests.push(structuredClone(req));
      const [path, query = ''] = req.path.split('?');
      const params = new URLSearchParams(query);
      if (req.method === 'GET' && path === JOB) return answer(take('job')) ?? { status: 200, body: structuredClone(job) };
      if (req.method === 'POST' && path === `${JOB}:run`) {
        const f = take('run');
        const early = f === 'throwAfterStart' || f === 'noMetadata' ? null : answer(f);
        if (early) return early;
        const body = req.body as any;
        if (body.etag !== job.etag) return { status: 409, body: rpcError(409, 'ABORTED') };
        const id = `job-synthetic-${String(++n).padStart(5, '0')}`;
        executions.set(id, executionFixture(id, n, body.overrides, body.overrides.timeout));
        if (f === 'throwAfterStart') throw new Error('synthetic reset after the run landed');
        return { status: 200, body: operationFixture(f === 'noMetadata' ? undefined : { name: `${JOB_NAME}/executions/${id}` }) };
      }
      if (req.method === 'GET' && path === `${JOB}/executions`) {
        const early = answer(take('list')); if (early) return early;
        const all = [...executions.values()];
        const start = Number(params.get('pageToken') || 0);
        const page = all.slice(start, start + pageSize);
        return { status: 200, body: { executions: structuredClone(page), ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) } };
      }
      const m = path.match(new RegExp(`^${escaped}/executions/([^/:]+)(:cancel)?$`));
      if (m && req.method === 'GET') {
        const early = answer(take('get')); if (early) return early;
        return executions.has(m[1]) ? { status: 200, body: structuredClone(executions.get(m[1])) } : { status: 404, body: rpcError(404, 'NOT_FOUND') };
      }
      if (m && req.method === 'POST' && m[2]) {
        const early = answer(take('cancel')); if (early) return early;
        const e = executions.get(m[1]);
        if (!e) return { status: 404, body: rpcError(404, 'NOT_FOUND') };
        e.conditions[1] = { type: 'Completed', state: 'CONDITION_PENDING', executionReason: 'CANCELLING' };
        return { status: 200, body: operationFixture({ name: e.name }) };
      }
      if (m && req.method === 'DELETE' && !m[2]) {
        const early = answer(take('delete')); if (early) return early;
        const e = executions.get(m[1]);
        if (!e) return { status: 404, body: rpcError(404, 'NOT_FOUND') };
        if (params.get('etag') !== e.etag) return { status: 409, body: rpcError(409, 'ABORTED') };
        executions.delete(m[1]);
        return { status: 200, body: operationFixture({ name: e.name }) };
      }
      return { status: 400, body: rpcError(400, 'INVALID_ARGUMENT') };
    },
  };
  const count = (method: string, suffix: string) => requests.filter(r => r.method === method && r.path.split('?')[0].endsWith(suffix)).length;
  const finish = (id: string, state: string, reason?: string) => { executions.get(id).conditions[1] = { type: 'Completed', state, ...(reason ? { executionReason: reason } : {}) }; };
  return { transport, job, executions, requests, faults, finish, runs: () => count('POST', ':run'), cancels: () => count('POST', ':cancel'),
    deletes: () => requests.filter(r => r.method === 'DELETE') };
}

test('disabled by default: every call refuses before any request leaves', async () => {
  const run = fakeRun(), ex = executor({ config: config({ enabled: false }), transport: run.transport });
  refused(await ex.create(gcpSpec()), 'provider_disabled');
  refused(await ex.estimate(gcpSpec()), 'provider_disabled');
  const ref: ExecutionRef = { provider: 'gcp', execution_id: 'job-synthetic-00001', tenant_id: 11, run_id: 'run-synthetic', attempt: 1, execution_generation: 1, region: 'weur' };
  for (const call of ['get', 'terminate', 'collect', 'cleanup'] as const) refused(await ex[call](ref), 'provider_disabled');
  assert.equal(run.requests.length, 0);
  assert.throws(() => executor({ config: config({ project_id: 'Not_A_Project' }), transport: run.transport }), /Invalid Cloud Run Jobs configuration/);
  assert.throws(() => executor({ config: config({ registry_repository: `${REPO}:latest` }), transport: run.transport }), /Invalid/);
  assert.throws(() => createCloudRunJobsExecutor({ config: config(), transport: run.transport, starts: undefined as any }), /Missing Cloud Run start reservation store/);
});

test('create runs the digest-pinned job once, conditional on its etag, with one task, the spec timeout and references only', async () => {
  const run = fakeRun(), ex = executor({ config: config(), transport: run.transport });
  const spec = gcpSpec();
  const created = value(await ex.create(spec));
  assert.deepEqual([created.state, created.ref.provider, created.ref.region, created.ref.execution_id], ['provisioning', 'gcp', 'weur', 'job-synthetic-00001']);
  const start = run.requests.find(r => r.path.endsWith(':run'))!;
  assert.equal(start.path, `${JOB}:run`);
  const body = start.body as any;
  assert.equal(body.etag, '"job-etag-1"');
  assert.deepEqual([body.overrides.taskCount, body.overrides.timeout], [1, '60s']);
  assert.equal(body.overrides.containerOverrides.length, 1);
  assert.equal(body.overrides.containerOverrides[0].name, 'workspace');
  assert.deepEqual(body.overrides.containerOverrides[0].env, [{ name: 'AXAL_EXECUTION_KEY', value: '11.run-synthetic.a1.g1' },
    { name: 'AXAL_RUN_ID', value: 'run-synthetic' }, { name: 'AXAL_EXECUTION_GENERATION', value: '1' }]);
  assert.ok(!('image' in body.overrides.containerOverrides[0]), 'an execution never names an image; the job pins it');
  assert.doesNotMatch(JSON.stringify(body), /token|secret|password|valueSource/i);
  value(await ex.create(spec));
  assert.equal(run.runs(), 1, 'the same spec again finds the execution instead of running a second');
  assert.equal(cloudRunExecutionKey(spec), '11.run-synthetic.a1.g1');
});

test('a job that is not pinned to the spec digest, has more than one task, or retries is refused before any run', async () => {
  const cases: [(job: any) => void, string][] = [
    [job => { job.template.template.containers[0].image = `${REPO}@sha256:${'c'.repeat(64)}`; }, 'image_digest'],
    [job => { job.template.template.containers[0].image = `${REPO}:latest`; }, 'image_digest'],
    [job => { job.template.taskCount = 2; }, 'job_shape'],
    [job => { job.template.template.maxRetries = 3; }, 'job_shape'],
    [job => { delete job.template.template.maxRetries; }, 'job_shape'],
    [job => { job.template.template.containers.push({ name: 'sidecar', image: `${REPO}@${DIGEST}` }); }, 'job_shape'],
  ];
  for (const [change, capability] of cases) {
    const run = fakeRun(), starts = reservationStore();
    change(run.job);
    refused(await executor({ config: config(), transport: run.transport, starts }).create(gcpSpec()), 'capability_denied', capability);
    assert.equal(run.runs(), 0, capability);
    run.job.template = jobFixture().template;
    assert.equal(value(await executor({ config: config(), transport: run.transport, starts }).create(gcpSpec())).state, 'provisioning', `${capability}: the key was not spent`);
  }
  // The job changed between the read and the run: Cloud Run's etag check refuses it, and the generation is spent.
  const run = fakeRun(), starts = reservationStore();
  const racing = { async request(req: CloudRunRequest) { const res = await run.transport.request(req); if (req.method === 'GET' && req.path === JOB) run.job.etag = '"job-etag-2"'; return res; } };
  refused(await executor({ config: config(), transport: racing, starts }).create(gcpSpec()), 'provider_conflict');
  refused(await executor({ config: config(), transport: racing, starts }).create(gcpSpec()), 'start_generation_refused');
  assert.equal(run.executions.size, 0);
});

test('an unsupported feature fails closed with the capability named, never a best-effort run', async () => {
  const run = fakeRun();
  const cases: [Partial<CloudRunJobsConfig>, object, string][] = [
    [{ untrusted_code: false }, {}, 'hostile_code_isolation'],
    [{ enforced_network_modes: [] }, {}, 'network_policy'],
    [{}, { network_policy: { mode: 'allowlist', destinations: [{ hostname: 'api.example.com', port: 443 }] } }, 'network_policy'],
    [{}, { checkpoint_manifest_ref: 'checkpoint-synthetic' }, 'checkpoint_restore'],
    [{ task_timeout_max_s: 30 }, {}, 'duration'],
    [{ regions: ['enam'] }, {}, 'region'],
    [{ cpu_max: 0.25 }, {}, 'cpu'],
    [{ concurrency_max: 0 }, {}, 'capacity_unverified'],
    [{ memory_mb_max: 1000 }, {}, 'disk'],
  ];
  for (const [patch, specPatch, capability] of cases) {
    refused(await executor({ config: config(patch), transport: run.transport }).create(gcpSpec(specPatch)), 'capability_denied', capability);
  }
  refused(await executor({ config: config(), transport: run.transport }).create(specFixture()), 'capability_denied', 'provider');
  assert.equal(run.requests.length, 0, 'nothing was sent for a refused spec');
  value(await executor({ config: config({ memory_mb_max: 1024 }), transport: run.transport }).create(gcpSpec()));
});

test('an unknown start (dropped connection, timeout, 5xx, ALREADY_EXISTS, no execution named) is located by its key, never run twice', async () => {
  for (const fault of ['throwAfterStart', 'noMetadata'] as const) {
    const run = fakeRun(), ex = executor({ config: config(), transport: run.transport });
    run.faults.run = fault;
    const first = value(await ex.create(gcpSpec()));
    assert.deepEqual([first.state, first.failure_code, first.ref.execution_id], ['unknown', 'start_ambiguous', 'pending:11.run-synthetic.a1.g1']);
    const located = value(await ex.get(first.ref));
    assert.deepEqual([located.state, located.ref.execution_id], ['provisioning', 'job-synthetic-00001']);
    assert.equal(value(await ex.create(gcpSpec())).ref.execution_id, 'job-synthetic-00001');
    assert.equal(run.runs(), 1, `${fault}: the retried create found the execution`);
  }
  for (const fault of ['throw', 408, [504, 'DEADLINE_EXCEEDED'], [503, 'UNAVAILABLE'], [409, 'ALREADY_EXISTS']] as Fault[]) {
    const run = fakeRun(), ex = executor({ config: config(), transport: run.transport });
    run.faults.run = fault;
    const lost = value(await ex.create(gcpSpec()));
    assert.deepEqual([lost.state, lost.failure_code], ['unknown', 'start_ambiguous'], JSON.stringify(fault));
    assert.equal(value(await ex.get(lost.ref)).state, 'unknown', 'an empty list is not proof the start never landed');
    assert.equal(value(await ex.create(gcpSpec())).failure_code, 'start_ambiguous');
    assert.equal(run.runs(), 1, JSON.stringify(fault));
  }
});

test('duplicate starts: two executions with one key are refused, and concurrent adapters share one reservation', async () => {
  const run = fakeRun({ pageSize: 1 });
  const ex = executor({ config: config(), transport: run.transport });
  const ref = value(await ex.create(gcpSpec())).ref;
  // A second execution carrying the same key, found on the list's second page.
  run.executions.set('job-synthetic-99999', { ...structuredClone(run.executions.get(ref.execution_id)), name: `${JOB_NAME}/executions/job-synthetic-99999` });
  refused(await ex.create(gcpSpec()), 'duplicate_execution');
  refused(await ex.get({ ...ref, execution_id: 'pending:11.run-synthetic.a1.g1' }), 'duplicate_execution');
  assert.ok(run.requests.some(r => r.path.includes('pageToken=1')), 'the list was followed past its first page');

  const other = fakeRun(), starts = reservationStore();
  const blind = { async request(req: CloudRunRequest) {
    if (req.method === 'GET' && req.path.startsWith(`${JOB}/executions?`)) return { status: 200, body: { executions: [] } };
    return other.transport.request(req);
  } };
  other.faults.run = 'noMetadata';
  const results = await Promise.all(Array.from({ length: 12 }, () => executor({ config: config(), transport: blind, starts }).create(gcpSpec())));
  assert.ok(results.every(r => r.ok));
  assert.equal(other.runs(), 1);
  value(await executor({ config: config(), transport: blind, starts }).create(gcpSpec({ execution_generation: 2 })));
  assert.equal(other.runs(), 2, 'a new fenced generation has its own reservation');
});

test('a failed reservation sends no run, including a store that committed before losing its reply', async () => {
  const run = fakeRun(), store = reservationStore();
  let fail = true;
  const starts = { async reserve(key: string) { const won = await store.reserve(key); if (fail) { fail = false; throw new Error('lost reply'); } return won; }, refuse: (key: string) => store.refuse(key) };
  refused(await executor({ config: config(), transport: run.transport, starts }).create(gcpSpec()), 'start_reservation_unavailable');
  assert.equal(value(await executor({ config: config(), transport: run.transport, starts }).create(gcpSpec())).failure_code, 'start_ambiguous');
  assert.equal(run.runs(), 0);
});

test('throttling and revoked permission: definite refusals spend the generation; provider text never travels', async () => {
  const run = fakeRun(), starts = reservationStore();
  const args = { config: config(), transport: run.transport, starts };
  const cases: [Fault, string][] = [[[429, 'RESOURCE_EXHAUSTED'], 'provider_quota'], [[403, 'PERMISSION_DENIED'], 'provider_auth_refused'],
    [[401, 'UNAUTHENTICATED'], 'provider_auth_refused'], [[400, 'INVALID_ARGUMENT'], 'provider_rejected'], [[404, 'NOT_FOUND'], 'provider_rejected']];
  let generation = 10;
  for (const [fault, code] of cases) {
    run.faults.run = fault;
    const r = await executor(args).create(gcpSpec({ execution_generation: ++generation }));
    refused(r, code);
    assert.doesNotMatch(JSON.stringify(r), /synthetic provider text/);
    refused(await executor(args).create(gcpSpec({ execution_generation: generation })), 'start_generation_refused');
  }
  assert.equal(run.runs(), cases.length);
  assert.equal(run.executions.size, 0);
  // Throttled or revoked before the run: the list or the job read refuses, nothing is run and no key is spent.
  run.faults.list = [429, 'RESOURCE_EXHAUSTED'];
  refused(await executor(args).create(gcpSpec()), 'provider_quota');
  run.faults.job = [403, 'PERMISSION_DENIED'];
  refused(await executor(args).create(gcpSpec()), 'provider_auth_refused');
  run.faults.job = 'throw';
  refused(await executor(args).create(gcpSpec()), 'provider_unavailable');
  assert.equal(run.runs(), cases.length);
  assert.equal(value(await executor(args).create(gcpSpec())).state, 'provisioning');
  // Reads under revoked permission or throttling refuse; a 5xx or dropped read is unknown, not failed.
  const ref = value(await executor(args).create(gcpSpec())).ref;
  run.faults.get = [403, 'PERMISSION_DENIED'];
  refused(await executor(args).get(ref), 'provider_auth_refused');
  run.faults.get = [429, 'RESOURCE_EXHAUSTED'];
  refused(await executor(args).get(ref), 'provider_quota');
  run.faults.get = [503, 'UNAVAILABLE'];
  assert.deepEqual(value(await executor(args).get(ref)).failure_code, 'provider_unreachable');
  run.faults.get = 'throw';
  assert.equal(value(await executor(args).get(ref)).state, 'unknown');
  run.faults.cancel = [403, 'PERMISSION_DENIED'];
  refused(await executor(args).terminate(ref), 'provider_auth_refused');
});

test('each Completed condition maps to one D5565 state; an unrecognised one is unknown', async () => {
  const run = fakeRun(), ex = executor({ config: config(), transport: run.transport });
  const ref = value(await ex.create(gcpSpec())).ref;
  const cases: [string | undefined, string | undefined, number, string, string?][] = [
    ['CONDITION_PENDING', undefined, 0, 'provisioning'], ['CONDITION_PENDING', undefined, 1, 'running'],
    ['CONDITION_RECONCILING', undefined, 1, 'running'], ['CONDITION_PENDING', 'CANCELLING', 1, 'cancelling'],
    ['CONDITION_SUCCEEDED', undefined, 0, 'finished'], ['CONDITION_SUCCEEDED', 'EXECUTION_REASON_UNDEFINED', 0, 'finished'],
    ['CONDITION_FAILED', 'NON_ZERO_EXIT_CODE', 0, 'failed', 'non_zero_exit'], ['CONDITION_FAILED', 'DELETED', 0, 'failed', 'deleted'],
    ['CONDITION_FAILED', undefined, 0, 'failed', 'failed'], ['CONDITION_FAILED', 'CANCELLED', 0, 'cancelled'],
    ['CONDITION_SUCCEEDED', 'CANCELLED', 0, 'unknown'], ['CONDITION_FAILED', 'SOMETHING_NEW', 0, 'unknown'],
    ['STATE_UNSPECIFIED', undefined, 0, 'unknown'], [undefined, undefined, 1, 'unknown'],
  ];
  for (const [state, reason, runningCount, expected, failure] of cases) {
    const e = run.executions.get(ref.execution_id);
    e.runningCount = runningCount;
    e.conditions = state ? [{ type: 'Completed', state, ...(reason ? { executionReason: reason } : {}) }] : [];
    const got = value(await ex.get(ref));
    assert.deepEqual([got.state, got.failure_code], [expected, failure], `${state}/${reason}/${runningCount}`);
  }
  assert.deepEqual(Object.keys(CLOUD_RUN_STATUS).sort(), ['CONDITION_FAILED', 'CONDITION_FAILED/CANCELLED', 'CONDITION_FAILED/DELETED',
    'CONDITION_FAILED/NON_ZERO_EXIT_CODE', 'CONDITION_PENDING', 'CONDITION_PENDING/CANCELLING', 'CONDITION_RECONCILING',
    'CONDITION_RECONCILING/CANCELLING', 'CONDITION_SUCCEEDED']);
});

test('cancel: sent once with the execution etag, a dropped cancel is ambiguous, an ended run is left alone', async () => {
  const run = fakeRun(), ex = executor({ config: config(), transport: run.transport });
  const ref = value(await ex.create(gcpSpec())).ref;
  run.executions.get(ref.execution_id).runningCount = 1;
  refused(await ex.collect(ref), 'execution_not_terminal');
  run.faults.cancel = 'throw';
  assert.deepEqual([value(await ex.terminate(ref)).state, value(await ex.terminate(ref)).state], ['unknown', 'cancelling']);
  const cancel = run.requests.filter(r => r.path.endsWith(':cancel')).at(-1)!;
  assert.equal(cancel.path, `${JOB}/executions/job-synthetic-00001:cancel`);
  assert.deepEqual(cancel.body, { etag: '"execution-etag-1"' });
  assert.equal(value(await ex.terminate(ref)).state, 'cancelling');
  assert.equal(run.cancels(), 2, 'a cancelling execution is not cancelled again');
  run.finish(ref.execution_id, 'CONDITION_FAILED', 'CANCELLED');
  assert.equal(value(await ex.terminate(ref)).state, 'cancelled');
  assert.equal(run.cancels(), 2, 'an ended execution is never sent a cancel');
  assert.deepEqual(value(await ex.collect(ref)), { manifest_ref: null, checkpoint_manifest_ref: null });
  // An unlocated execution cannot be cancelled yet; once it is visible, the cancel goes out.
  const late = fakeRun();
  let visible = false;
  const transport = { async request(req: CloudRunRequest) {
    if (!visible && req.method === 'GET' && req.path.startsWith(`${JOB}/executions?`)) return { status: 200, body: { executions: [] } };
    return late.transport.request(req);
  } };
  const ex2 = executor({ config: config(), transport });
  late.faults.run = 'noMetadata';
  const pendingRef = value(await ex2.create(gcpSpec())).ref;
  assert.deepEqual(value(await ex2.terminate(pendingRef)).failure_code, 'stop_ambiguous');
  assert.equal(late.cancels(), 0);
  visible = true;
  assert.equal(value(await ex2.terminate(pendingRef)).state, 'cancelling');
  assert.equal(late.cancels(), 1);
});

test('exact owned cleanup: only an ended execution this ref owns is deleted, by its etag, and never the job', async () => {
  const run = fakeRun(), ex = executor({ config: config(), transport: run.transport });
  const ref = value(await ex.create(gcpSpec())).ref;
  const other = value(await ex.create(gcpSpec({ execution_generation: 2 }))).ref;
  refused(await ex.cleanup(ref), 'cleanup_not_terminal');
  run.finish(ref.execution_id, 'CONDITION_SUCCEEDED');
  run.finish(other.execution_id, 'CONDITION_SUCCEEDED');
  // Another tenant's or generation's ref naming this execution cannot delete it.
  refused(await ex.cleanup({ ...ref, tenant_id: ref.tenant_id + 1 }), 'execution_not_authorized');
  refused(await ex.cleanup({ ...other, execution_id: ref.execution_id }), 'execution_not_authorized');
  refused(await ex.cleanup({ ...ref, region: 'enam' }), 'execution_not_authorized');
  refused(await ex.cleanup({ ...ref, execution_id: '../job-synthetic' }), 'execution_not_authorized');
  assert.equal(run.deletes().length, 0);
  // A dropped delete is ambiguous; the retry deletes exactly that execution, conditional on its etag.
  run.faults.delete = 'throw';
  refused(await ex.cleanup(ref), 'cleanup_ambiguous');
  run.faults.delete = [503, 'UNAVAILABLE'];
  refused(await ex.cleanup(ref), 'cleanup_ambiguous');
  run.faults.delete = [403, 'PERMISSION_DENIED'];
  refused(await ex.cleanup(ref), 'provider_auth_refused');
  assert.deepEqual(value(await ex.cleanup(ref)), { cleaned: true });
  assert.deepEqual(run.deletes().map(r => r.path), Array(4).fill(`${JOB}/executions/job-synthetic-00001?etag=%22execution-etag-1%22`));
  assert.ok(!run.executions.has(ref.execution_id));
  assert.ok(run.executions.has(other.execution_id), 'the other generation\'s execution is untouched');
  assert.ok(run.requests.every(r => r.method !== 'DELETE' || r.path.startsWith(`${JOB}/executions/`)), 'the job itself is never deleted');
  // Cleaning again is idempotent and sends no delete for an execution that is gone.
  assert.deepEqual(value(await ex.cleanup(ref)), { cleaned: true });
  assert.equal(run.deletes().length, 4);
  // A version changed after the read is not deleted.
  const changed = { async request(req: CloudRunRequest) {
    if (req.method === 'DELETE') run.executions.get(other.execution_id).etag = '"execution-etag-9"';
    return run.transport.request(req);
  } };
  refused(await executor({ config: config(), transport: changed }).cleanup(other), 'provider_conflict');
  assert.ok(run.executions.has(other.execution_id));
});

test('a ref for another tenant, generation or job cannot read or cancel an execution by naming it', async () => {
  const run = fakeRun(), ex = executor({ config: config(), transport: run.transport });
  const ref = value(await ex.create(gcpSpec())).ref;
  refused(await ex.get({ ...ref, tenant_id: ref.tenant_id + 1 }), 'execution_not_authorized');
  refused(await ex.terminate({ ...ref, execution_generation: ref.execution_generation + 1 }), 'execution_not_authorized');
  refused(await ex.get({ ...ref, provider: 'azure' } as ExecutionRef), 'execution_not_authorized');
  refused(await ex.get({ ...ref, execution_id: 'job-synthetic-00404' }), 'execution_not_found');
  // An execution whose name sits under another job is not this job's, whatever key it carries.
  run.executions.get(ref.execution_id).name = `projects/axal-synthetic/locations/europe-west1/jobs/job-other/executions/${ref.execution_id}`;
  refused(await ex.get(ref), 'execution_not_authorized');
  assert.equal(run.cancels(), 0);
});

test('an estimate needs priced rates: none is a refusal, never 0', async () => {
  const run = fakeRun();
  refused(await executor({ config: config(), transport: run.transport }).estimate(gcpSpec()), 'estimate_unavailable');
  const priced = executor({ config: config({ rates: { vcpu_second_microusd: 24, gib_second_microusd: 3 } }), transport: run.transport });
  // 60 s × (0.5 vCPU × 24 + 0.5 GiB × 3) = 810
  assert.deepEqual(value(await priced.estimate(gcpSpec())), { cost_microusd: 810, measured: false });
  assert.equal(run.requests.length, 0);
});
