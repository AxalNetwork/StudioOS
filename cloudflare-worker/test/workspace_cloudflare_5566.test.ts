/** D5566: real controller/adapter journeys with fake provider I/O; Docker and hosted evidence are separate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspaceHost, validateWorkspaceOutput, type HostRow, type WorkspaceOutput } from '../../workspace-engine/worker/controller.ts';
import { createCloudflareExecutor } from '../../workspace-engine/worker/executor.ts';
import { specFixture, fakeCapabilities } from './_workspace_fake_5565.ts';
import { type WorkspaceResult, workspaceRefusal } from '../src/services/agents/workspaceSpec.ts';
const value = <T>(r: WorkspaceResult<T>): T => { assert.equal(r.ok, true, JSON.stringify(r)); return (r as any).value; };
const refused = (r: WorkspaceResult<unknown>, code?: string) => { assert.equal(r.ok, false); if (code) assert.equal((r as any).code, code); };
const defer = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function fixture(factory = createWorkspaceHost) {
  const spec = specFixture({ workload_class: 'coding_trusted' }), caps = fakeCapabilities();
  let row: HostRow | null = null, now = 1000, enabled = true, alarm: number | null = null;
  let stopFails = false, startFails = false, ready = true, revoked = false, signed = true, accepted = 0;
  const exit = defer<number>(), output = defer<Uint8Array>();
  let starts = 0, stops = 0, execs = 0, options: any, stdin = '';
  const background: Promise<void>[] = [], audiences: string[] = [], image = 'registry.cloudflare.com/synthetic/coding@' + spec.image_digest;
  const container = { images: { coding: image }, running: false,
    start(o: any) { starts++; options = o; if (startFails) throw Error('quota'); this.running = ready; },
    async destroy() { stops++; if (stopFails) throw Error('stop unknown'); this.running = false; },
    async setInactivityTimeout() {},
    async exec(argv: string[], opts: any) {
      execs++; assert.deepEqual(argv, ['/usr/bin/setpriv', '--no-new-privs', 'node', '/app/run-job.mjs']); assert.equal(opts.user, 'node');
      assert.deepEqual(opts.env, { PATH: '/usr/local/bin:/usr/bin:/bin' });
      return { stdin: new WritableStream({ write(bytes) { stdin += new TextDecoder().decode(bytes); } }),
        stdout: new ReadableStream({ async start(c) { c.enqueue(await output.promise); c.close(); } }), exitCode: exit.promise };
    } };
  const store = { async read() { return structuredClone(row); }, async replace(expected: number | null, next: HostRow) {
    if ((row?.revision ?? null) !== expected) return false; row = structuredClone(next); return true;
  }, async alarm(at: number | null) { alarm = at; } };
  const broker = {
    async admit(ticket: string, audience: string) { audiences.push(audience); if (revoked || ticket !== audience) return workspaceRefusal('grant_refused', 403);
      return { ok: true as const, value: { spec, capabilities: caps, image_ref: image, budget_ref: 'budget-synthetic', materialization: { bundle_b64: 'synthetic', commands: [['node', '--test']] } } }; },
    async accept() { accepted++; assert.equal(container.running, false, 'destroy ack precedes acceptance');
      return { ok: true as const, value: { manifest_ref: 'manifest-synthetic', checkpoint_manifest_ref: null, manifest_sha256: 'c'.repeat(64), signature_verified: signed } }; },
  };
  const deps = { store, container: container as any, broker, enabled: () => enabled, clock: () => now,
    pause: async (ms: number) => { now += ms; await tick(); }, background: (p: Promise<void>) => { background.push(p); } };
  const host = factory(deps);
  const create = () => host.create(spec, 'executor.bootstrap');
  const empty = (): WorkspaceOutput => ({ version: 1, run_id: spec.run_id, execution_generation: 1, base_sha: spec.base_sha, changed: [] });
  return { host, spec, caps, container, deps, broker, create, empty, audiences, row: () => structuredClone(row), alarm: () => alarm,
    stats: () => ({ starts, stops, execs, accepted, options, stdin }), disabled: () => { enabled = false; }, revoke: () => { revoked = true; },
    time: (n: number) => { now = n; }, stopFails: () => { stopFails = true; }, startFails: () => { startFails = true; }, noReady: () => { ready = false; }, unsigned: () => { signed = false; },
    finish: async (data: unknown = empty(), code = 0) => { output.resolve(new TextEncoder().encode(JSON.stringify(data))); exit.resolve(code); await Promise.all(background); },
    restart: () => factory(deps),
  };
}

test('disabled pilot creates no provider resource; current policy, capacity and immutable image are mandatory', async () => {
  const f = fixture(); f.disabled(); refused(await f.create(), 'workspace_preview_disabled'); assert.equal(f.stats().starts, 0);
  for (const patch of [{ workload_class: 'coding_untrusted' }, { cpu: 2 }, { max_duration_s: 601 }, { checkpoint_manifest_ref: 'not-supported-yet' }]) {
    const g = fixture(); refused(await g.host.create(specFixture(patch as any), 'executor.bootstrap')); assert.equal(g.stats().starts, 0);
  }
  const g = fixture(); g.caps.concurrency_max = null; refused(await g.create(), 'capability_denied'); assert.equal(g.stats().starts, 0);
  const h = fixture(); h.container.images.coding = 'registry.cloudflare.com/synthetic/coding@sha256:' + 'd'.repeat(64); refused(await h.create(), 'workspace_image_mismatch');
});

test('concurrent/replayed creates allocate one VM; exact-SHA input, internet off and signed collection follow a stop ack', async () => {
  const f = fixture(); const results = await Promise.all([f.create(), f.create()]);
  assert.ok(results.some(r => r.ok)); const created = value(results.find(r => r.ok)!);
  await tick(); assert.equal(f.stats().starts, 1); assert.equal(f.stats().execs, 1);
  assert.equal(value(await f.create()).ref.execution_id, created.ref.execution_id); assert.equal(f.stats().starts, 1);
  assert.equal(f.stats().options.enableInternet, false); assert.deepEqual(f.stats().options.instance, { vcpu: .5, memoryMib: 512, diskMb: 512 });
  assert.equal(JSON.parse(f.stats().stdin).base_sha, f.spec.base_sha);
  refused(await f.host.collect(created.ref, 'executor.collect'));
  await f.finish(); assert.equal(f.row()!.state, 'finished'); assert.equal(f.stats().accepted, 1); assert.equal(f.alarm(), null);
  assert.equal(value(await f.host.collect(created.ref, 'executor.collect')).manifest_ref, 'manifest-synthetic');
  refused(await f.host.get({ ...created.ref, tenant_id: 99 }, 'executor.status'), 'execution_not_authorized');
  refused(await f.host.get(created.ref, 'executor.cancel'), 'grant_refused');
  f.revoke(); refused(await f.host.collect(created.ref, 'executor.collect'), 'grant_refused');
});

test('cancel still works when admission is off; late output never reaches artifact acceptance', async () => {
  const f = fixture(), created = value(await f.create()); f.disabled();
  assert.equal(value(await f.host.terminate(created.ref, 'executor.cancel')).state, 'cancelled');
  await f.finish(); assert.equal(f.row()!.state, 'cancelled'); assert.equal(f.stats().accepted, 0);
  assert.equal(value(await f.host.cleanup(created.ref, 'executor.cleanup')).cleaned, true);
});

test('unknown stop never publishes or reports cleanup; timeout alarm retries cleanup after provider failure', async () => {
  const f = fixture(); value(await f.create()); f.stopFails(); await f.finish();
  assert.equal(f.row()!.state, 'unknown'); assert.equal(f.row()!.cleaned, false); assert.equal(f.stats().accepted, 0);
  f.time(61000); await f.host.expire(); assert.equal(f.row()!.cleaned, false);
  assert.ok(f.alarm()! > 61000, 'failed destroy must leave a future cleanup alarm');
  refused(await f.host.cleanup(f.row()!.ref, 'executor.cleanup'), 'cleanup_unconfirmed');
});

test('quota/start failure is stopped; a stuck provision and lost execution handle cannot become a second VM', async () => {
  const f = fixture(); f.startFails(); assert.equal(value(await f.create()).state, 'failed'); assert.equal(f.row()!.cleaned, true);
  assert.equal(value(await f.create()).state, 'failed'); assert.equal(f.stats().starts, 1);
  const g = fixture(); g.noReady(); assert.equal(value(await g.create()).failure_code, 'workspace_provision_timeout');
  const h = fixture(), created = value(await h.create()); assert.equal(value(await h.restart().get(created.ref, 'executor.status')).state, 'unknown');
  await h.finish(); assert.equal(h.stats().accepted, 0); assert.equal(h.stats().starts, 1);
});

test('deadline alarm and invalid output/unsigned manifests cannot yield success', async () => {
  const f = fixture(); value(await f.create()); f.time(61000); await f.host.expire(); await f.finish();
  assert.equal(f.row()!.failure_code, 'workspace_timeout'); assert.equal(f.stats().accepted, 0);
  const g = fixture(); value(await g.create()); await g.finish({ ...g.empty(), base_sha: 'a'.repeat(40) });
  assert.equal(g.row()!.state, 'failed'); assert.equal(g.stats().accepted, 0);
  const h = fixture(); h.unsigned(); value(await h.create()); await h.finish(); assert.equal(h.row()!.failure_code, 'signed_manifest_missing');
});

test('trusted-side artifact gate checks scope, content hashes, canonical encoding and duplicates', async () => {
  const f = fixture(), bytes = Buffer.from('synthetic'), sha = await crypto.subtle.digest('SHA-256', bytes);
  const file = { path: 'src/fix.ts', sha256: Buffer.from(sha).toString('hex'), bytes: bytes.toString('base64') };
  const output = { ...f.empty(), changed: [file] }; value(await validateWorkspaceOutput(f.spec, output));
  for (const path of ['../src/a', '.git/config', 'other/secret', 'src/%2e%2e/x', 'src\\x']) refused(await validateWorkspaceOutput(f.spec, { ...output, changed: [{ ...file, path }] }));
  refused(await validateWorkspaceOutput(f.spec, { ...output, changed: [file, file] }));
  refused(await validateWorkspaceOutput(f.spec, { ...output, changed: [{ ...file, sha256: '0'.repeat(64) }] }), 'workspace_artifact_hash_mismatch');
  refused(await validateWorkspaceOutput(f.spec, { ...output, changed: [{ ...file, bytes: file.bytes + '\n' }] }));
  refused(await validateWorkspaceOutput(f.spec, { ...output, changed: [{ ...file, private: 'not accepted' }] }));
  value(await validateWorkspaceOutput(f.spec, { ...output, changed: [{ path: 'src/removed.ts', deleted: true }] }));
});

test('ExecutorAdapter uses fresh purpose-specific grants and rejects forged refs before host lookup', async () => {
  const f = fixture(), seen: string[] = []; let lookups = 0;
  const adapter = createCloudflareExecutor({ enabled: () => true, capabilities: async () => f.caps,
    estimate: async () => ({ ok: true, value: { cost_microusd: 1, measured: false } }),
    ticket: async audience => { seen.push(audience); return { ok: true, value: audience }; }, getByName: () => { lookups++; return f.host; } });
  const created = value(await adapter.create(f.spec)); value(await adapter.get(created.ref)); value(await adapter.terminate(created.ref));
  value(await adapter.cleanup(created.ref)); await f.finish();
  assert.deepEqual(seen, ['executor.bootstrap', 'executor.status', 'executor.cancel', 'executor.cleanup']);
  const before = lookups; refused(await adapter.get({ ...created.ref, tenant_id: 99 }), 'invalid_execution_ref'); assert.equal(lookups, before);
});

test('mutations: default-off, network denial, cancellation fence, trusted scope and stop ack are necessary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-5566-'));
  let source = readFileSync(new URL('../../workspace-engine/worker/controller.ts', import.meta.url), 'utf8');
  for (const name of ['workspaceSpec', 'workspaceSecurity']) source = source.replaceAll(`'../../cloudflare-worker/src/services/agents/${name}'`, JSON.stringify(new URL(`../src/services/agents/${name}.ts`, import.meta.url).href));
  const changes: [string, string, string, (factory: typeof createWorkspaceHost) => Promise<void>][] = [
    ['default-off', 'deps.enabled() !== true || !deps.container', '!deps.container', async factory => { const f = fixture(factory); f.disabled(); refused(await f.create()); }],
    ['internet', 'enableInternet: false', 'enableInternet: true', async factory => { const f = fixture(factory); value(await f.create()); assert.equal(f.stats().options.enableInternet, false); await f.finish(); }],
    ['cancel', "if (!row || row.state !== 'running') return;", 'if (!row) return;', async factory => { const f = fixture(factory); const ref = value(await f.create()).ref; await f.host.terminate(ref, 'executor.cancel'); await f.finish(); assert.equal(f.stats().accepted, 0); }],
    ['stop-ack', 'if (!cleaned) { await write(row,', 'if (false) { await write(row,', async factory => { const f = fixture(factory); value(await f.create()); f.stopFails(); await f.finish(); assert.equal(f.stats().accepted, 0); }],
    ['scope', "|| !spec.scope_paths.some(scope => file.path === scope || file.path.startsWith(scope + '/'))", '', async factory => { const f = fixture(factory); value(await f.create()); await f.finish({ ...f.empty(), changed: [{ path: 'other/file', deleted: true }] }); assert.equal(f.stats().accepted, 0); }],
  ];
  try { for (const [label, before, after, journey] of changes) {
    assert.ok(source.includes(before), label); const file = join(dir, label + '.ts'); writeFileSync(file, source.replaceAll(before, after));
    const broken = (await import(pathToFileURL(file).href)).createWorkspaceHost;
    await assert.rejects(journey(broken), 'must kill ' + label);
  } } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Configuration is part of the refusal boundary; the image workflow runs a compiler check as well.
test('preview configuration has no production broker/credential path or public listener', () => {
  const config = readFileSync(new URL('../../workspace-engine/wrangler.toml', import.meta.url), 'utf8');
  assert.equal((config.match(/WORKSPACE_PILOT = "off"/g) || []).length, 2);
  assert.match(config, /scheduling_policy = "durable_object"/); assert.match(config, /max_instances = 1/);
  assert.doesNotMatch(config, /env\.production|WORKSPACE_BROKER|d1_databases|r2_buckets|secrets/);
  const index = readFileSync(new URL('../../workspace-engine/worker/index.ts', import.meta.url), 'utf8');
  assert.match(index, /#host:/); assert.match(index, /new Response\('Not found', \{ status: 404 \}\)/);
  const workflow = readFileSync(new URL('../../.github/workflows/workspace-image.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /workflow_dispatch|secrets\.|packages: write|docker push|wrangler deploy/);
  for (const step of ['local-synthetic.mjs', 'scan-image.mjs', 'tsc --noEmit']) assert.ok(workflow.includes(step));
});
