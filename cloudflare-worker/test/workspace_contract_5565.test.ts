/** D5565: strict broker specs, fake adapter contract, atomic pull leases and injected-clock fencing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunnerControl, deterministicLimits, workspaceArtifactPrefix, type RunnerCall } from '../src/services/agents/runnerProtocol.ts';
import { executorEligibility, executionTransition, trustedWorkspaceSpec, workspacePath, type WorkspaceResult } from '../src/services/agents/workspaceSpec.ts';
import { actorFixture, fakeCapabilities, fakeExecutor, memoryRunnerStore, specFixture } from './_workspace_fake_5565.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string) => { assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, code); };

test('a versioned broker spec is immutable and no client may replace a scope, grant, image, location or budget field', () => {
  const spec = value(trustedWorkspaceSpec(specFixture()));
  assert.ok(Object.isFrozen(spec) && Object.isFrozen(spec.scope_paths) && Object.isFrozen(spec.network_policy));
  for (const key of Object.keys(spec)) refused(trustedWorkspaceSpec(spec, { [key]: spec[key as keyof typeof spec] }), 'untrusted_workspace_override');
  for (const extra of [{ env: { CLOUD_TOKEN: 'synthetic' } }, { privileged: true }, { version: 2 }, { image_digest: 'image:latest' }, { base_sha: 'main' }]) {
    refused(trustedWorkspaceSpec({ ...spec, ...extra }), 'invalid_workspace_spec');
  }
  for (const path of ['../secret', '/tmp/secret', 'src/../other', 'src//a', '.git/config', 'src\\other', 'src/%2e%2e', 'C:/x', 'src/\0x', 'src/**']) assert.equal(workspacePath(path), false, path);
  for (const path of ['src', 'src/index.ts', '.github/workflows']) assert.equal(workspacePath(path), true, path);
  assert.equal(deterministicLimits.python.wall_ms, 120000);
  refused(trustedWorkspaceSpec({ ...spec, workload_class: 'python', max_duration_s: 121 }), 'invalid_workspace_spec');
});

test('provider eligibility refuses unsupported policy instead of degrading containment, capacity or residency', () => {
  const spec = specFixture(), caps = fakeCapabilities();
  assert.equal(value(executorEligibility(spec, caps)).region, 'weur');
  for (const [patch, capability] of [
    [{ provider: 'aws' }, 'provider'], [{ digest_pulls: false }, 'image_digest'], [{ interrupt: false }, 'cancel'], [{ shell: false }, 'shell'],
    [{ untrusted_code: false }, 'hostile_code_isolation'], [{ cpu_max: 0.1 }, 'cpu'], [{ memory_mb_max: 128 }, 'memory'],
    [{ disk_mb_max: 128 }, 'disk'], [{ duration_s_max: 10 }, 'duration'], [{ enforced_network_modes: [] }, 'network_policy'],
    [{ enforced_regions: ['wnam'] }, 'region'], [{ concurrency_max: null }, 'capacity_unverified'], [{ workload_classes: [] }, 'workload_class'],
  ] as const) {
    const denied = executorEligibility(spec, { ...caps, ...patch } as any);
    refused(denied, 'capability_denied'); if (!denied.ok) assert.equal(denied.capability, capability);
  }
  refused(executorEligibility(spec, null as any), 'capability_denied');
  refused(executorEligibility(specFixture({ checkpoint_manifest_ref: 'checkpoint-synthetic' }), { ...caps, checkpoint_restore: false }), 'capability_denied');
});

function runnerFixture(factory = createRunnerControl) {
  let now = 0, nonce = 0, revoked = false;
  const store = memoryRunnerStore(), spec = specFixture(), identity = actorFixture(spec);
  const control = factory({ store, clock: () => now, policy: { heartbeat_ms: 1000, missed_beat_limit: 3, max_generations: 3,
    nonce: () => `lease-${++nonce}`, authorize: () => !revoked,
    manifestAllowed: (s, ref) => ref === `manifest-${s.run_id}-g${s.execution_generation}` } });
  const lease = async (generation = 1, request_nonce = `request-${generation}`, actor = identity) => value(await control.lease({ run_id: spec.run_id, execution_generation: generation, request_nonce, identity: actor }));
  const call = (lease_id: string, generation = 1): RunnerCall => ({ run_id: spec.run_id, execution_generation: generation, lease_id, identity });
  return { store, spec, identity, control, lease, call, time: (n: number) => { now = n; }, revoke: () => { revoked = true; } };
}

test('one concurrent lease wins; request and heartbeat replays are refused without widening identity', async () => {
  const f = runnerFixture(); value(await f.control.register(f.spec));
  const leases = await Promise.all([f.control.lease({ run_id: f.spec.run_id, execution_generation: 1, request_nonce: 'one', identity: f.identity }),
    f.control.lease({ run_id: f.spec.run_id, execution_generation: 1, request_nonce: 'one', identity: f.identity })]);
  assert.equal(leases.filter(r => r.ok).length, 1); refused(leases.find(r => !r.ok)!, 'lease_replay');
  const lease = value(leases.find(r => r.ok)!); const call = f.call(lease.lease_id);
  value(await f.control.heartbeat({ ...call, sequence: 1 })); refused(await f.control.heartbeat({ ...call, sequence: 1 }), 'heartbeat_replay');
  refused(await f.control.uploadFence({ ...call, identity: { ...f.identity, tenant_id: 999 } }), 'runner_not_authorized');
  refused(await f.control.uploadFence({ ...call, identity: { ...f.identity, project_id: 999 } }), 'runner_not_authorized');
  refused(await f.control.uploadFence({ ...call, identity: { ...f.identity, runner_id: 'different' } }), 'lease_not_live');
  assert.match(value(await f.control.uploadFence(call)).prefix, /^tenants\/11\/agent-compute\/project\/31\/run-synthetic\/workspace\/g1\/$/);
});

test('N missed beats reaps exactly at its boundary; old completion and upload stay fenced after requeue', async () => {
  const f = runnerFixture(); value(await f.control.register(f.spec)); const old = await f.lease();
  f.time(2000); assert.deepEqual(await f.control.reap(), [], 'not one beat early');
  f.time(2999); assert.deepEqual(await f.control.reap(), []);
  f.time(3000); assert.deepEqual(await f.control.reap(), [{ run_id: f.spec.run_id, execution_generation: 2, state: 'queued' }]);
  assert.equal(f.store.inspect().get(f.spec.run_id)!.lease, null, 'no live lease survives reaping');
  refused(await f.control.complete({ ...f.call(old.lease_id), manifest_ref: 'manifest-run-synthetic-g1' }), 'stale_generation');
  refused(await f.control.uploadFence(f.call(old.lease_id)), 'stale_generation');
  refused(await f.control.lease({ run_id: f.spec.run_id, execution_generation: 2, request_nonce: 'request-2', identity: f.identity }), 'cleanup_unconfirmed');
  value(await f.control.acknowledgeCleanup(f.spec.run_id, 2)); const next = await f.lease(2);
  assert.equal(next.spec.execution_generation, 2);
  refused(await f.control.uploadFence(f.call(old.lease_id)), 'stale_generation');
  value(await f.control.uploadFence(f.call(next.lease_id, 2)));
});

test('heartbeat renewal, kill/stall, timeout and clock regression are deterministic without wall-clock waits', async () => {
  const f = runnerFixture(); value(await f.control.register(f.spec)); const lease = await f.lease();
  f.time(2000); value(await f.control.heartbeat({ ...f.call(lease.lease_id), sequence: 1 }));
  f.time(3000); assert.deepEqual(await f.control.reap(), []);
  f.time(1000); refused(await f.control.heartbeat({ ...f.call(lease.lease_id), sequence: 2 }), 'clock_regressed');
  f.time(5000); assert.equal((await f.control.reap())[0].execution_generation, 2);
  value(await f.control.acknowledgeCleanup(f.spec.run_id, 2)); const next = await f.lease(2);
  f.time(60000); refused(await f.control.complete({ ...f.call(next.lease_id, 2), manifest_ref: 'manifest-run-synthetic-g2' }), 'lease_expired');
  assert.equal((await f.control.reap())[0].state, 'failed', 'the run deadline spans retries');
});

test('completion is idempotent for its original run/generation/runner/manifest only; terminal output cannot arrive out of order', async () => {
  const f = runnerFixture(); value(await f.control.register(f.spec)); const lease = await f.lease();
  const complete = { ...f.call(lease.lease_id), manifest_ref: 'manifest-run-synthetic-g1' };
  assert.equal(value(await f.control.complete(complete)).duplicate, false);
  assert.equal(value(await f.control.complete(complete)).duplicate, true);
  refused(await f.control.complete({ ...complete, lease_id: 'forged' }), 'completion_conflict');
  refused(await f.control.complete({ ...complete, manifest_ref: 'another-run-manifest' }), 'manifest_not_authorized');
  refused(await f.control.complete({ ...complete, identity: { ...f.identity, company_id: 999 } }), 'runner_not_authorized');
  refused(await f.control.uploadFence(complete), 'lease_not_live');
  refused(await f.control.requestCancel(f.spec.run_id, 1), 'run_terminal');
  assert.equal(executionTransition('finished', 'running'), false);
  assert.equal(executionTransition('cancelling', 'finished'), false);
});

test('revocation and cancellation refuse late output; heartbeat tells the runner to stop and cleanup is explicit', async () => {
  const f = runnerFixture(); value(await f.control.register(f.spec)); const lease = await f.lease();
  const c = f.call(lease.lease_id);
  f.revoke(); const beat = await f.control.heartbeat({ ...c, sequence: 1 });
  refused(beat, 'runner_not_authorized'); assert.equal((beat as any).cancel, true);
  refused(await f.control.complete({ ...c, manifest_ref: 'manifest-run-synthetic-g1' }), 'runner_not_authorized');
  value(await f.control.requestCancel(f.spec.run_id, 1));
  assert.equal(f.store.inspect().get(f.spec.run_id)!.lease, null);
  value(await f.control.acknowledgeCleanup(f.spec.run_id, 2));
  assert.equal(f.store.inspect().get(f.spec.run_id)!.state, 'cancelled');
});

test('fake ExecutorAdapter implements replay, scope refusal, terminal collection, timeout and ambiguous cleanup', async () => {
  let now = 0; const f = fakeExecutor(() => now), spec = specFixture();
  const estimate = value(await f.adapter.estimate(spec)); assert.equal(estimate.measured, false);
  const created = value(await f.adapter.create(spec));
  assert.deepEqual(value(await f.adapter.create(spec)), created); assert.equal(f.stats.physical_creates, 1);
  refused(await f.adapter.create(specFixture({ artifact_sink_ref: 'changed' })), 'idempotency_conflict');
  refused(await f.adapter.get({ ...created.ref, tenant_id: 999 }), 'execution_not_authorized');
  refused(await f.adapter.create(specFixture({ allowed_regions: ['wnam'] })), 'capability_denied');
  value(f.start(created.ref)); refused(await f.adapter.collect(created.ref), 'artifacts_unavailable');
  value(f.finish(created.ref)); assert.equal(value(await f.adapter.collect(created.ref)).manifest_ref, 'manifest-synthetic');
  assert.equal(value(await f.adapter.cleanup(created.ref)).cleaned, true);
  const second = value(await f.adapter.create(specFixture({ run_id: 'second-run', idempotency_key: 'second' })));
  value(f.start(second.ref)); f.kill(second.ref);
  assert.equal(value(await f.adapter.get(second.ref)).state, 'unknown');
  refused(await f.adapter.cleanup(second.ref), 'cleanup_unconfirmed');
  f.confirmStopped(second.ref); value(await f.adapter.cleanup(second.ref));
  const third = value(await f.adapter.create(specFixture({ run_id: 'third-run', idempotency_key: 'third' })));
  now = 60000; assert.equal(value(await f.adapter.get(third.ref)).failure_code, 'timeout');
  const cancelled = value(await f.adapter.create(specFixture({ run_id: 'fourth-run', idempotency_key: 'fourth' })));
  assert.equal(value(await f.adapter.terminate(cancelled.ref)).state, 'cancelled');
  value(await f.adapter.cleanup(cancelled.ref));
});

test('artifact namespaces are tenant/run/generation bounded and do not modify the v1 compute prefix', () => {
  const spec = specFixture(); const prefix = workspaceArtifactPrefix(spec);
  assert.notEqual(prefix, workspaceArtifactPrefix(specFixture({ tenant_id: 12 })));
  assert.notEqual(prefix, workspaceArtifactPrefix(specFixture({ execution_generation: 2 })));
  assert.equal(prefix, 'tenants/11/agent-compute/project/31/run-synthetic/workspace/g1/');
});

test('mutations: stale generations, an early reaper, replay, revocation and cleanup must lose real lease journeys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'runner-5565-'));
  let source = readFileSync(new URL('../src/services/agents/runnerProtocol.ts', import.meta.url), 'utf8');
  source = source.replace("'./compute'", JSON.stringify(new URL('../src/services/agents/compute.ts', import.meta.url).href))
    .replace("'./workspaceSpec'", JSON.stringify(new URL('../src/services/agents/workspaceSpec.ts', import.meta.url).href));
  const changes: [string, string, string, (factory: typeof createRunnerControl) => Promise<void>][] = [
    ['generation fence', "if (call.execution_generation !== r.generation) return refuse('stale_generation');", '', async factory => {
      const f = runnerFixture(factory); value(await f.control.register(f.spec)); await f.lease(); f.time(3000); await f.control.reap();
      value(await f.control.acknowledgeCleanup(f.spec.run_id, 2)); const next = await f.lease(2);
      assert.equal((await f.control.uploadFence(f.call(next.lease_id, 1))).ok, false, 'mixed old generation must never upload');
    }],
    ['one beat early', 'now < r.lease.last_heartbeat + policy.heartbeat_ms * policy.missed_beat_limit', 'now < r.lease.last_heartbeat + policy.heartbeat_ms * (policy.missed_beat_limit - 1)', async factory => {
      const f = runnerFixture(factory); value(await f.control.register(f.spec)); await f.lease(); f.time(2000);
      assert.deepEqual(await f.control.reap(), []);
    }],
    ['cleanup bypass', "if (r.cleanup_required) return refuse('cleanup_unconfirmed', 503);", '', async factory => {
      const f = runnerFixture(factory); value(await f.control.register(f.spec)); await f.lease(); f.time(3000); await f.control.reap();
      assert.equal((await f.control.lease({ run_id: f.spec.run_id, execution_generation: 2, request_nonce: 'next', identity: f.identity })).ok, false);
    }],
    ['revocation ignored', '&& safeName(actor.runner_id) && policy.authorize(actor, r.spec)', '&& safeName(actor.runner_id)', async factory => {
      const f = runnerFixture(factory); value(await f.control.register(f.spec)); const lease = await f.lease(); f.revoke();
      assert.equal((await f.control.uploadFence(f.call(lease.lease_id))).ok, false);
    }],
    ['heartbeat replay', 'call.sequence <= lease.sequence', 'call.sequence < lease.sequence', async factory => {
      const f = runnerFixture(factory); value(await f.control.register(f.spec)); const lease = await f.lease();
      value(await f.control.heartbeat({ ...f.call(lease.lease_id), sequence: 1 }));
      assert.equal((await f.control.heartbeat({ ...f.call(lease.lease_id), sequence: 1 })).ok, false);
    }],
  ];
  try {
    for (const [label, before, after, journey] of changes) {
      assert.ok(source.includes(before), label + ' target exists');
      const file = join(dir, label.replaceAll(' ', '-') + '.ts');
      writeFileSync(file, source.replaceAll(before, after));
      const broken = (await import(pathToFileURL(file).href)).createRunnerControl as typeof createRunnerControl;
      await assert.rejects(journey(broken), 'must kill ' + label);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
