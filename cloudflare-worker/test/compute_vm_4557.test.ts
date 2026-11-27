/** D4557: running-image provenance, offline native API options, bounded readiness and confirmed termination. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContainerVm, PYTHON_COMPUTE_INSTANCE, type ComputeInstance, type VmControl } from '../../agent-compute/vm.ts';

function fixture(policy = 'durable_object', instance: ComputeInstance = PYTHON_COMPUTE_INSTANCE) {
  let now = 0, observed: { image: string } | null = { image: 'registry.example/synthetic@sha256:' + 'a'.repeat(64) };
  const calls: unknown[] = [], digest = 'sha256:' + 'a'.repeat(64);
  let healthy = true;
  const control: VmControl = { start: options => { calls.push(options); }, namedImage: () => observed?.image,
    inspect: async () => observed, monitor: () => new Promise(() => {}),
    fetch: async request => request.url.endsWith('/health') ? Response.json({ ready: healthy }, { status: healthy ? 200 : 503 }) : Response.json({ accepted: true }),
    destroy: async () => { observed = null; },
  };
  const vm = createContainerVm(control, { schedulingPolicy: policy, instance, now: () => now, pause: async () => { now += 30000; } });
  return { vm, calls, digest, control, image: (value: string) => { observed = { image: value }; }, health: (value: boolean) => { healthy = value; } };
}

test('approved scheduling keeps egress off after retiring default scheduling, preserves resource ceilings and checks readiness', async () => {
  const f = fixture(); f.vm.start(f.digest); await f.vm.ready(new AbortController().signal);
  assert.deepEqual(f.calls, [{ image: 'registry.example/synthetic@' + f.digest, instance: { vcpu: 0.25, memoryMib: 1024, diskMb: 4000 }, enableInternet: false }]);
  await f.vm.destroy(); assert.equal(await f.control.inspect(), null);
});
test('an empty or different running image is ineligible even when its health endpoint says ready', async () => {
  for (const image of ['', 'registry.example/synthetic@sha256:' + 'b'.repeat(64)]) {
    const f = fixture(); f.vm.start(f.digest); f.image(image);
    await assert.rejects(f.vm.ready(new AbortController().signal), /image_unverified/);
  }
});
test('the newer policy and pinned named image are required for either resource profile', async () => {
  const f = fixture('durable_object', 'standard-1'); f.vm.start(f.digest); await f.vm.ready(new AbortController().signal);
  assert.deepEqual(f.calls, [{ image: 'registry.example/synthetic@' + f.digest, instance: 'standard-1', enableInternet: false }]);
  for (const policy of ['default', 'unconfirmed', '']) {
    const unknown = fixture(policy); assert.throws(() => unknown.vm.start(unknown.digest), /scheduling_unconfirmed/);
    assert.deepEqual(unknown.calls, []);
  }
  for (const image of ['', 'registry.example/synthetic@sha256:' + 'b'.repeat(64)]) {
    const bad = fixture(); bad.image(image);
    assert.throws(() => bad.vm.start(bad.digest), /image_unverified/);
    assert.deepEqual(bad.calls, []);
  }
});
test('readiness has a deadline; a stop that leaves a running instance is not acknowledged', async () => {
  const f = fixture(); f.health(false); f.vm.start(f.digest);
  await assert.rejects(f.vm.ready(new AbortController().signal), /not_ready/);
  f.control.destroy = async () => {};
  await assert.rejects(f.vm.destroy(), /cleanup_unconfirmed/);
});
