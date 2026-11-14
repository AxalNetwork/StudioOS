/**
 * #5571 (D5571): the disabled Azure Container Apps Jobs adapter over a synthetic ARM transport whose response shapes
 * follow the Microsoft.App 2026-07-01 reference. No live Azure account, no credential.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/azure_jobs_executor_5571.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AZURE_STATUS, createAzureJobsExecutor, executionKey, type ArmRequest, type ArmResponse, type AzureJobsConfig } from '../src/services/agents/azureJobsExecutor.ts';
import type { ExecutionRef, WorkspaceResult } from '../src/services/agents/workspaceSpec.ts';
import { specFixture } from './_workspace_fake_5565.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string, capability?: string) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (!r.ok) { assert.equal(r.code, code); if (capability) assert.equal(r.capability, capability); }
};

const SUB = '00000000-0000-4000-8000-000000000001';
const JOB = `/subscriptions/${SUB}/resourceGroups/rg-synthetic/providers/Microsoft.App/jobs/job-synthetic`;
const config = (patch: Partial<AzureJobsConfig> = {}): AzureJobsConfig => ({ enabled: true, subscription_id: SUB,
  resource_group: 'rg-synthetic', job_name: 'job-synthetic', registry_repository: 'synthetic.azurecr.io/workspace',
  regions: ['weur'], replica_timeout_s: 600, cpu_max: 2, memory_mb_max: 4096, disk_mb_max: 4096, concurrency_max: 5,
  enforced_network_modes: ['deny'], untrusted_code: true, checkpoint_restore: false, rates: null, ...patch });
const azureSpec = (patch = {}) => specFixture({ allowed_providers: ['azure'], ...patch });

/** A synthetic ARM endpoint for one job. `next` overrides the following start/stop answer. */
function fakeArm() {
  const executions = new Map<string, any>();
  const requests: ArmRequest[] = [];
  let n = 0;
  const faults: { start?: 'ambiguous202' | 'throw' | 'throwAfterStart' | number; stop?: number | 'throw'; get?: number } = {};
  const transport = {
    async request(req: ArmRequest): Promise<ArmResponse> {
      requests.push(structuredClone(req));
      const path = req.path.split('?')[0];
      assert.ok(req.path.endsWith('?api-version=2026-07-01') || req.path.includes('api-version=2026-07-01'), req.path);
      if (req.method === 'POST' && path === `${JOB}/start`) {
        const f = faults.start; delete faults.start;
        if (typeof f === 'number') return { status: f, body: { error: { code: 'Synthetic', message: 'synthetic provider text' } } };
        if (f === 'throw') throw new Error('synthetic network reset');
        const name = `job-synthetic-${++n}`;
        executions.set(name, { name, id: `${JOB}/executions/${name}`, properties: { status: 'Processing', template: (req.body as any) } });
        if (f === 'throwAfterStart') throw new Error('synthetic reset after the start landed');
        return f === 'ambiguous202' ? { status: 202, body: null } : { status: 200, body: { name, id: `${JOB}/executions/${name}` } };
      }
      if (req.method === 'GET' && path === `${JOB}/executions`) return { status: 200, body: { value: [...executions.values()] } };
      const m = path.match(new RegExp(`^${JOB.replace(/[.()]/g, '\\$&')}/executions/([^/]+)(/stop)?$`));
      if (m && req.method === 'GET') {
        if (faults.get) { const s = faults.get; delete faults.get; return { status: s, body: null }; }
        return executions.has(m[1]) ? { status: 200, body: executions.get(m[1]) } : { status: 404, body: null };
      }
      if (m && req.method === 'POST' && m[2]) {
        const f = faults.stop; delete faults.stop;
        if (f === 'throw') throw new Error('synthetic reset');
        if (typeof f === 'number') return { status: f, body: null };
        executions.get(m[1]).properties.status = 'Stopped';
        return { status: 202, body: null };
      }
      return { status: 400, body: null };
    },
  };
  return { transport, executions, requests, faults, starts: () => requests.filter(r => r.method === 'POST' && r.path.includes('/start')).length };
}

test('disabled by default: every call refuses before any request leaves', async () => {
  const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config({ enabled: false }), transport: arm.transport });
  refused(await ex.create(azureSpec()), 'provider_disabled');
  refused(await ex.estimate(azureSpec()), 'provider_disabled');
  assert.equal(arm.requests.length, 0);
  assert.throws(() => createAzureJobsExecutor({ config: config({ subscription_id: 'not-a-uuid' }), transport: arm.transport }), /Invalid Azure Jobs configuration/);
  assert.throws(() => createAzureJobsExecutor({ config: config({ registry_repository: 'repo:latest' }), transport: arm.transport }), /Invalid/);
});

test('create starts one execution pinned to the image digest, with references and no secret in the template', async () => {
  const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config(), transport: arm.transport });
  const spec = azureSpec();
  const created = value(await ex.create(spec));
  assert.deepEqual([created.state, created.ref.provider, created.ref.region, created.ref.execution_id], ['provisioning', 'azure', 'weur', 'job-synthetic-1']);
  const start = arm.requests.find(r => r.path.startsWith(`${JOB}/start`))!;
  assert.equal(start.path, `${JOB}/start?api-version=2026-07-01`);
  const container = (start.body as any).containers[0];
  assert.equal(container.image, `synthetic.azurecr.io/workspace@${spec.image_digest}`);
  assert.deepEqual(container.resources, { cpu: 0.5, memory: '512Mi', ephemeralStorage: '512Mi' });
  assert.deepEqual(container.env.map((e: any) => e.name), ['AXAL_EXECUTION_KEY', 'AXAL_RUN_ID', 'AXAL_EXECUTION_GENERATION']);
  assert.ok(container.env.every((e: any) => !('secretRef' in e)), 'no secret reference');
  assert.doesNotMatch(JSON.stringify(start.body), /token|secret|password|key=/i);
  // The same spec again finds the execution it started instead of starting a second.
  value(await ex.create(spec));
  assert.equal(arm.starts(), 1);
});

test('an unsupported feature fails closed with the capability named, never a best-effort run', async () => {
  const arm = fakeArm();
  const cases: [Partial<AzureJobsConfig>, object, string][] = [
    [{ untrusted_code: false }, {}, 'hostile_code_isolation'],
    [{ enforced_network_modes: [] }, {}, 'network_policy'],
    [{}, { network_policy: { mode: 'allowlist', destinations: [{ hostname: 'api.example.com', port: 443 }] } }, 'network_policy'],
    [{}, { checkpoint_manifest_ref: 'checkpoint-synthetic' }, 'checkpoint_restore'],
    [{ replica_timeout_s: 30 }, {}, 'duration'],
    [{ regions: ['enam'] }, {}, 'region'],
    [{ cpu_max: 0.25 }, {}, 'cpu'],
    [{ concurrency_max: 0 }, {}, 'capacity_unverified'],
  ];
  for (const [patch, specPatch, capability] of cases) {
    const ex = createAzureJobsExecutor({ config: config(patch), transport: arm.transport });
    refused(await ex.create(azureSpec(specPatch)), 'capability_denied', capability);
  }
  refused(await createAzureJobsExecutor({ config: config(), transport: arm.transport }).create(specFixture()), 'capability_denied', 'provider');
  assert.equal(arm.requests.length, 0, 'nothing was sent for a refused spec');
});

test('an ambiguous start (202 or a dropped connection) is unknown, then located by its key; a retry never starts twice', async () => {
  for (const fault of ['ambiguous202', 'throwAfterStart'] as const) {
    const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config(), transport: arm.transport });
    arm.faults.start = fault;
    const first = value(await ex.create(azureSpec()));
    assert.deepEqual([first.state, first.failure_code, first.ref.execution_id.startsWith('pending:')], ['unknown', 'start_ambiguous', true]);
    const located = value(await ex.get(first.ref));
    assert.deepEqual([located.state, located.ref.execution_id], ['provisioning', 'job-synthetic-1']);
    value(await ex.create(azureSpec()));
    assert.equal(arm.starts(), 1, `${fault}: retried create found the execution`);
  }
  // A start that never landed stays unknown until a retry starts it once.
  const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config(), transport: arm.transport });
  arm.faults.start = 'throw';
  const lost = value(await ex.create(azureSpec()));
  assert.equal(value(await ex.get(lost.ref)).state, 'unknown');
  assert.equal(value(await ex.create(azureSpec())).state, 'provisioning');
  assert.equal(arm.starts(), 2);
  assert.equal(arm.executions.size, 1);
});

test('each Azure status maps to one D5565 state; an unrecognised one is unknown', async () => {
  const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config(), transport: arm.transport });
  const ref = value(await ex.create(azureSpec())).ref;
  const expected: Record<string, string> = { Processing: 'provisioning', Running: 'running', Succeeded: 'finished', Failed: 'failed',
    Degraded: 'failed', Stopped: 'cancelled', Unknown: 'unknown', SomethingNew: 'unknown' };
  for (const [azure, state] of Object.entries(expected)) {
    arm.executions.get(ref.execution_id).properties.status = azure;
    assert.equal(value(await ex.get(ref)).state, state, azure);
  }
  assert.deepEqual(Object.keys(AZURE_STATUS).sort(), ['Degraded', 'Failed', 'Processing', 'Running', 'Stopped', 'Succeeded', 'Unknown']);
});

test('cancel and terminal calls: stop is sent once, a finished run is left alone, cleanup waits for the end', async () => {
  const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config(), transport: arm.transport });
  const ref = value(await ex.create(azureSpec())).ref;
  arm.executions.get(ref.execution_id).properties.status = 'Running';
  refused(await ex.cleanup(ref), 'cleanup_not_terminal');
  refused(await ex.collect(ref), 'execution_not_terminal');
  assert.equal(value(await ex.terminate(ref)).state, 'cancelling');
  assert.equal(value(await ex.get(ref)).state, 'cancelled');
  const stops = arm.requests.filter(r => r.path.includes('/stop')).length;
  assert.equal(value(await ex.terminate(ref)).state, 'cancelled', 'already terminal');
  assert.equal(arm.requests.filter(r => r.path.includes('/stop')).length, stops, 'no second stop');
  assert.deepEqual(value(await ex.cleanup(ref)), { cleaned: true });
  assert.deepEqual(value(await ex.collect(ref)), { manifest_ref: null, checkpoint_manifest_ref: null });
  // A dropped stop is ambiguous, not cancelled.
  const other = fakeArm(), ex2 = createAzureJobsExecutor({ config: config(), transport: other.transport });
  const r2 = value(await ex2.create(azureSpec())).ref;
  other.faults.stop = 'throw';
  assert.deepEqual([value(await ex2.terminate(r2)).state, value(await ex2.terminate(r2)).state], ['unknown', 'cancelling']);
});

test('quota, revoked identity, a missing execution and cross-region refs are refused; provider text never travels', async () => {
  const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config(), transport: arm.transport });
  for (const [status, code] of [[429, 'provider_quota'], [409, 'provider_quota'], [401, 'provider_auth_refused'], [403, 'provider_auth_refused'], [400, 'provider_rejected']] as const) {
    arm.faults.start = status;
    const r = await ex.create(azureSpec());
    refused(r, code);
    assert.doesNotMatch(JSON.stringify(r), /synthetic provider text/);
  }
  const ref = value(await ex.create(azureSpec())).ref;
  arm.faults.get = 403;
  refused(await ex.get(ref), 'provider_auth_refused');
  arm.faults.get = 503;
  assert.equal(value(await ex.get(ref)).state, 'unknown', 'a 5xx read is unknown, not failed');
  refused(await ex.get({ ...ref, execution_id: 'job-synthetic-404' }), 'execution_not_found');
  refused(await ex.get({ ...ref, region: 'enam' }), 'execution_not_authorized');
  refused(await ex.get({ ...ref, provider: 'gcp' } as ExecutionRef), 'execution_not_authorized');
});

test('a ref for another tenant or generation cannot read or stop an execution by naming it', async () => {
  const arm = fakeArm(), ex = createAzureJobsExecutor({ config: config(), transport: arm.transport });
  const ref = value(await ex.create(azureSpec())).ref;
  refused(await ex.get({ ...ref, tenant_id: ref.tenant_id + 1 }), 'execution_not_authorized');
  refused(await ex.terminate({ ...ref, execution_generation: ref.execution_generation + 1 }), 'execution_not_authorized');
  assert.equal(arm.requests.filter(r => r.path.includes('/stop')).length, 0);
  assert.equal(executionKey(azureSpec()), '11.run-synthetic.a1.g1');
});

test('an estimate needs priced rates: none is a refusal, never 0', async () => {
  const arm = fakeArm();
  refused(await createAzureJobsExecutor({ config: config(), transport: arm.transport }).estimate(azureSpec()), 'estimate_unavailable');
  const priced = createAzureJobsExecutor({ config: config({ rates: { vcpu_second_microusd: 24, gib_second_microusd: 3 } }), transport: arm.transport });
  // 60 s × (0.5 vCPU × 24 + 0.5 GiB × 3) = 810
  assert.deepEqual(value(await priced.estimate(azureSpec())), { cost_microusd: 810, measured: false });
});
