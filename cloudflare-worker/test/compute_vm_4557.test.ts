/** D4557: running-image provenance, offline native API options, bounded readiness and confirmed termination. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContainerVm, type VmControl } from '../../agent-compute/vm.ts';

function fixture(policy = 'default') {
  let now = 0, observed: { image: string } | null = { image: 'registry.example/synthetic@sha256:' + 'a'.repeat(64) };
  const calls: unknown[] = [], digest = 'sha256:' + 'a'.repeat(64);
  let healthy = true;
  const control: VmControl = { start: options => { calls.push(options); }, namedImage: () => observed?.image,
    inspect: async () => observed, monitor: () => new Promise(() => {}),
    fetch: async request => request.url.endsWith('/health') ? Response.json({ ready: healthy }, { status: healthy ? 200 : 503 }) : Response.json({ accepted: true }),
    destroy: async () => { observed = null; },
  };
  const vm = createContainerVm(control, { schedulingPolicy: policy, instance: 'basic', now: () => now, pause: async () => { now += 30000; } });
  return { vm, calls, digest, control, image: (value: string) => { observed = { image: value }; }, health: (value: boolean) => { healthy = value; } };
}

test('default scheduling keeps egress off and checks the actual digest before accepting readiness', async () => {
  const f = fixture(); f.vm.start(f.digest); await f.vm.ready(new AbortController().signal);
  assert.deepEqual(f.calls, [{ enableInternet: false }]);
  await f.vm.destroy(); assert.equal(await f.control.inspect(), null);
});
test('an empty or different running image is ineligible even when its health endpoint says ready', async () => {
  for (const image of ['', 'registry.example/synthetic@sha256:' + 'b'.repeat(64)]) {
    const f = fixture(); f.vm.start(f.digest); f.image(image);
    await assert.rejects(f.vm.ready(new AbortController().signal), /image_unverified/);
  }
});
test('the newer policy is supported only when explicitly selected with the pinned named image', async () => {
  const f = fixture('durable_object'); f.vm.start(f.digest); await f.vm.ready(new AbortController().signal);
  assert.deepEqual(f.calls, [{ image: 'registry.example/synthetic@' + f.digest, instance: 'basic', enableInternet: false }]);
  const unknown = fixture('unconfirmed'); assert.throws(() => unknown.vm.start(unknown.digest), /scheduling_unconfirmed/);
});
test('readiness has a deadline; a stop that leaves a running instance is not acknowledged', async () => {
  const f = fixture(); f.health(false); f.vm.start(f.digest);
  await assert.rejects(f.vm.ready(new AbortController().signal), /not_ready/);
  f.control.destroy = async () => {};
  await assert.rejects(f.vm.destroy(), /cleanup_unconfirmed/);
});
