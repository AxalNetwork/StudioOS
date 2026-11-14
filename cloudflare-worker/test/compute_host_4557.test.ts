/** D4557: synthetic host lifecycle driven by real Workspace grants; no hosted isolation claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputeHost, type HostRecord, type HostStore } from '../../agent-compute/host.ts';
import { computeBody, computeTarget, hostAdmission, hostResult, type HostResult } from '../src/services/agents/computeHost.ts';
import { createWorkspaceSecurity, type WorkspaceSecurityRun } from '../src/services/agents/workspaceSecurity.ts';
import { specFixture, fakeCapabilities } from './_workspace_fake_5565.ts';

async function world() {
  let now = 1000, nonce = 0, row: HostRecord | null = null;
  const spec = specFixture({ workload_class: 'python', allowed_regions: ['global'], disk_mb: 256, max_duration_s: 60, network_policy: { mode: 'deny' }, artifact_sink_ref: 'a'.repeat(32), idempotency_key: 'a'.repeat(32) });
  const admission = { job_uid: 'a'.repeat(32), spec, sponsor: { member_id: 71, tenant_id: spec.tenant_id, company_id: spec.company_id, project_id: spec.project_id } };
  const flags = { enabled: true, allowed: true, destroyFails: false, starts: 0, destroys: 0, published: 0, armed: 0 };
  const caps = { ...fakeCapabilities(), enforced_regions: ['global'], workload_classes: ['python'] as ['python'], untrusted_code: false };
  const rootKey = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let records = new Map<string, WorkspaceSecurityRun>();
  let serial: Promise<unknown> = Promise.resolve();
  const security = createWorkspaceSecurity({ enabled: () => flags.enabled, halted: () => false, clock: () => now,
    nonce: () => `nonce-${++nonce}`.padEnd(16, 'x'), rootKey,
    store: { async transaction(fn) {
      const next = serial.then(async () => { const copy = structuredClone(records); const value = await fn(copy); records = copy; return value; });
      serial = next.catch(() => {}); return next;
    } },
    authorize: async () => ({ allowed: flags.allowed, revision: 1, approved: false }),
    image: async digest => ({ digest, signature_verified: true, provenance_verified: true, sbom_verified: true, scan_passed: true, revoked: false }),
    provider: async () => ({ capabilities: caps, non_root: true, no_new_privileges: true, immutable_image: true, ephemeral_scratch: true,
      resource_limits: true, host_socket: false, privileged: false, isolation: 'microvm', network_connect_fence: true, metadata_denied: true }),
    object: async () => null, encryptionKey: async () => null, audit: async () => {},
  });
  const store: HostStore = { async transaction(fn) { const chosen = fn(structuredClone(row)); row = chosen.row; return chosen.value; } };
  const data = 'eyJzdW0iOjZ9';
  const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  const result: HostResult = { outcome: 'succeeded', failure_code: null, artifacts: [{ name: 'result.json', bytes: bytes.length, sha256, data }], cpu_ms: 12, wall_ms: 20, peak_rss_bytes: 1000, exit_code: 0 };
  let resolveVm: (value: unknown) => void = () => {};
  let vmAnswer: Promise<unknown> = Promise.resolve(result);
  const deps = { store, security, now: () => now, arm: async (at: number) => { flags.armed = at; },
    vm: { start: () => { flags.starts++; }, ready: async () => {}, run: async () => vmAnswer,
      destroy: async () => { flags.destroys++; if (flags.destroyFails) throw Error('synthetic_stop_failure'); } },
    broker: { manifest: async () => ({ workload: 'python' as const, operation: 'sum', inputs: [] }), input: async () => '',
      complete: async (a: typeof admission, _r: HostResult, token: string) => {
        const permit = await security.redeem(token, computeTarget(a, 'executor.complete')); assert.ok(permit.ok); flags.published++;
      } },
  };
  return { admission, flags, deps, result, security, host: createComputeHost(deps), inspect: () => structuredClone(row),
    time: (at: number) => { now = at; }, delay: () => { vmAnswer = new Promise(resolve => { resolveVm = resolve; }); }, resolve: () => resolveVm(result) };
}

test('dispatch persists before boot; concurrent delivery and a finished replay never allocate a second VM', async () => {
  const w = await world();
  const starts = await Promise.all([w.host.dispatch(w.admission), w.host.dispatch(w.admission)]);
  assert.equal(starts.filter(r => !r.duplicate).length, 1);
  assert.equal(w.flags.starts, 0);
  await w.host.alarm();
  assert.equal(w.flags.starts, 1); assert.equal(w.flags.published, 1); assert.equal(w.inspect()?.state, 'succeeded');
  assert.equal(w.inspect()?.cleanup_required, false);
  await w.host.dispatch(w.admission); await w.host.alarm();
  assert.equal(w.flags.starts, 1); assert.equal(w.flags.published, 1);
});

test('cross-scope, unsupported code, egress and contract changes are refused before boot', async () => {
  const w = await world();
  for (const spec of [{ ...w.admission.spec, allowed_regions: ['weur'] }, { ...w.admission.spec, artifact_sink_ref: 'b'.repeat(32) }, { ...w.admission.spec, idempotency_key: 'b'.repeat(32) }, { ...w.admission.spec, workload_class: 'coding_untrusted' }, { ...w.admission.spec, network_policy: { mode: 'allowlist', destinations: [{ hostname: 'example.com', port: 443 }] } }]) {
    await assert.rejects(w.host.dispatch({ ...w.admission, spec }), /admission_invalid/);
  }
  assert.equal(hostAdmission({ ...w.admission, sponsor: { ...w.admission.sponsor, tenant_id: 999 } }), null);
  await w.host.dispatch(w.admission);
  await assert.rejects(w.host.dispatch({ ...w.admission, spec: { ...w.admission.spec, execution_generation: 2 } }), /conflict/);
  assert.equal(w.flags.starts, 0);
});

test('the shared token authority blocks revoked authorization and disabled admission before VM creation', async () => {
  for (const flag of ['enabled', 'allowed'] as const) {
    const w = await world(); w.flags[flag] = false;
    await w.host.dispatch(w.admission);
    await w.host.alarm().catch(() => {});
    assert.equal(w.flags.starts, 0); assert.equal(w.flags.published, 0);
  }
});

test('cancellation kills a running process and rejects a late completion, including after the switch is off', async () => {
  const w = await world(); w.delay(); await w.host.dispatch(w.admission);
  const alarm = w.host.alarm();
  while (!w.flags.starts) await new Promise(resolve => setImmediate(resolve));
  w.flags.enabled = false; await w.host.cancel(); w.resolve(); await alarm;
  assert.equal(w.inspect()?.state, 'cancelled'); assert.equal(w.inspect()?.cleanup_required, false);
  assert.ok(w.flags.destroys > 0); assert.equal(w.flags.published, 0);
});

test('a failed stop remains unknown and cannot publish; reconstruction confirms cleanup without another boot', async () => {
  const w = await world(); w.flags.destroyFails = true; await w.host.dispatch(w.admission); await w.host.alarm();
  assert.equal(w.inspect()?.state, 'unknown'); assert.equal(w.inspect()?.cleanup_required, true); assert.equal(w.flags.published, 0);
  w.flags.destroyFails = false;
  const rebuilt = createComputeHost(w.deps); await rebuilt.dispatch(w.admission);
  assert.equal(w.flags.starts, 1); assert.equal(w.inspect()?.state, 'failed'); assert.equal(w.inspect()?.cleanup_required, false);
});

test('deadline alarms fence an unstarted job and prevent late allocation', async () => {
  const w = await world(); await w.host.dispatch(w.admission); w.time(w.inspect()!.deadline); await w.host.alarm();
  assert.equal(w.inspect()?.state, 'timed_out'); assert.equal(w.flags.starts, 0); assert.equal(w.flags.published, 0);
});

test('artifact bytes, digest, path, duplicate names and resource telemetry are validated independently', async () => {
  const w = await world(); assert.ok(await hostResult(w.result, 'python'));
  for (const artifact of [{ ...w.result.artifacts[0], name: '../escape.json' }, { ...w.result.artifacts[0], bytes: 0 }, { ...w.result.artifacts[0], sha256: 'f'.repeat(64) }]) {
    assert.equal(await hostResult({ ...w.result, artifacts: [artifact] }, 'python'), null);
  }
  assert.equal(await hostResult({ ...w.result, artifacts: [...w.result.artifacts, ...w.result.artifacts] }, 'python'), null);
  assert.equal(await hostResult({ ...w.result, peak_rss_bytes: 1024 ** 3 }, 'python'), null);
});

test('dishonest or missing Content-Length cannot bypass actual streamed byte caps', async () => {
  assert.equal((await computeBody(new Response('hello'), 5)).length, 5);
  await assert.rejects(computeBody(new Response('sixsix', { headers: { 'content-length': '1' } }), 5), /body_limit/);
  await assert.rejects(computeBody(new Response('x', { headers: { 'content-length': '999' } }), 5), /body_limit/);
});
