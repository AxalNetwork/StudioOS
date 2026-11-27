/** D5566: real controller/adapter journeys with fake provider I/O; Docker and hosted evidence are separate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspaceHost, validateWorkspaceOutput, workspaceExecutionId, type HostRow, type WorkspaceOutput } from '../../workspace-engine/worker/controller.ts';
import { createCloudflareExecutor } from '../../workspace-engine/worker/executor.ts';
import { entryControl, entryCreate, pilotEnabled, unavailableBroker } from '../../workspace-engine/worker/entry.ts';
import { specFixture, fakeCapabilities } from './_workspace_fake_5565.ts';
import { type ExecutionRef, type WorkspaceResult, workspaceRefusal } from '../src/services/agents/workspaceSpec.ts';
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
    const g = fixture(); refused(await g.host.create(specFixture({ workload_class: 'coding_trusted', ...patch } as any), 'executor.bootstrap')); assert.equal(g.stats().starts, 0);
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
  assert.match(config, /scheduling_policy = "durable_object"/); // Wrangler refuses max_instances on Durable Object-managed containers (D5566 part 2): concurrency is capped by capabilities and admission.
  assert.doesNotMatch(config, /max_instances/);
  assert.doesNotMatch(config, /env\.production|WORKSPACE_BROKER|d1_databases|r2_buckets|secrets/);
  const index = readFileSync(new URL('../../workspace-engine/worker/index.ts', import.meta.url), 'utf8');
  assert.match(index, /#host:/); assert.match(index, /new Response\('Not found', \{ status: 404 \}\)/);
  const workflow = readFileSync(new URL('../../.github/workflows/workspace-image.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /workflow_dispatch|secrets\.|packages: write|docker push|wrangler (secret|containers|versions|delete|d1|r2)/);
  for (const line of workflow.split('\n').filter(l => /wrangler deploy/.test(l))) assert.match(line, /--dry-run --containers-rollout none/, line);
  for (const step of ['local-synthetic.mjs', 'scan-image.mjs', 'tsc --noEmit', '--env preview --dry-run --containers-rollout none']) assert.ok(workflow.includes(step));
});

// D5566 part 2: the auth and refusal paths of the private entrypoint, the broker answers and the adapter, plus the image floor.
const namespace = () => { const names: string[] = []; const calls: string[] = [];
  const stub = new Proxy({}, { get: (_t, method: string) => async () => { calls.push(method); return { ok: true, value: method }; } }) as any;
  return { names, calls, ns: { getByName: (name: string) => { names.push(name); return stub; } } }; };

test('entrypoint: only pilot "preview" with a namespace admits; refusals happen before any Durable Object lookup', async () => {
  const spec = specFixture({ workload_class: 'coding_trusted' });
  for (const WORKSPACE_PILOT of [undefined, 'off', 'Preview', 'preview ', 'on', 'true']) {
    const n = namespace(); refused(await entryCreate({ WORKSPACE_PILOT, WORKSPACES: n.ns }, spec, 'executor.bootstrap'), 'workspace_preview_disabled');
    assert.equal(n.names.length, 0, String(WORKSPACE_PILOT));
  }
  refused(await entryCreate({ WORKSPACE_PILOT: 'preview' }, spec, 'executor.bootstrap'), 'workspace_preview_disabled');
  const n = namespace(); refused(await entryCreate({ WORKSPACE_PILOT: 'preview', WORKSPACES: n.ns }, { ...spec, cpu: 'all' }, 'executor.bootstrap'));
  assert.equal(n.names.length, 0);
  value(await entryCreate({ WORKSPACE_PILOT: 'preview', WORKSPACES: n.ns }, spec, 'executor.bootstrap'));
  assert.deepEqual(n.names, [await workspaceExecutionId(spec)]); assert.deepEqual(n.calls, ['create']);
  assert.equal(pilotEnabled({ WORKSPACE_PILOT: 'preview' }), true); assert.equal(pilotEnabled({ WORKSPACE_PILOT: 'off' }), false);
});

test('entrypoint: stop, status and cleanup stay reachable with the pilot off; forged or foreign refs never reach a host', async () => {
  const spec = specFixture({ workload_class: 'coding_trusted' });
  const ref: ExecutionRef = { provider: 'cloudflare', execution_id: await workspaceExecutionId(spec), tenant_id: spec.tenant_id, run_id: spec.run_id,
    attempt: spec.attempt, execution_generation: spec.execution_generation, region: 'weur' };
  for (const method of ['get', 'terminate', 'collect', 'cleanup'] as const) {
    const n = namespace(); assert.equal(value(await entryControl({ WORKSPACE_PILOT: 'off', WORKSPACES: n.ns }, method, ref, 't') as any), method);
    assert.deepEqual(n.names, [ref.execution_id]);
  }
  const forged: ExecutionRef[] = [{ ...ref, tenant_id: 12 }, { ...ref, execution_generation: 2 }, { ...ref, run_id: 'run-other' }, { ...ref, provider: 'aws' },
    { ...ref, execution_id: 'ws-' + 'f'.repeat(64) }, { ...ref, region: 'WEUR' }, { ...ref, tenant_id: 0 }, null as any];
  for (const bad of forged) {
    const n = namespace(); refused(await entryControl({ WORKSPACE_PILOT: 'preview', WORKSPACES: n.ns }, 'terminate', bad, 't') as any, 'invalid_execution_ref');
    assert.equal(n.names.length, 0, JSON.stringify(bad));
  }
  refused(await entryControl({ WORKSPACE_PILOT: 'preview' }, 'cleanup', ref, 't') as any, 'invalid_execution_ref');
});

test('an unbound broker refuses admission and acceptance with 503, and the host starts nothing', async () => {
  const spec = specFixture({ workload_class: 'coding_trusted' });
  const empty = { version: 1 as const, run_id: spec.run_id, execution_generation: 1, base_sha: spec.base_sha, changed: [] };
  for (const answer of [await unavailableBroker.admit('t', 'executor.bootstrap', spec), await unavailableBroker.accept(spec, empty)]) {
    refused(answer, 'workspace_broker_unavailable'); assert.equal((answer as any).status, 503);
  }
  const f = fixture(), host = createWorkspaceHost({ ...f.deps, broker: unavailableBroker });
  refused(await host.create(f.spec, 'executor.bootstrap'), 'workspace_broker_unavailable');
  assert.equal(f.stats().starts, 0); assert.equal(f.row(), null);
});

test('broker answers that do not match the request are refused before any VM is started', async () => {
  const cases: [string, (a: any) => any][] = [
    ['workspace_admission_denied', a => ({ ...a, spec: { ...a.spec, run_id: 'run-other' } })],
    ['workspace_admission_denied', a => ({ ...a, spec: { ...a.spec, tenant_id: a.spec.tenant_id + 1 } })],
    ['workspace_admission_denied', a => ({ ...a, budget_ref: '' })],
    ['workspace_admission_denied', a => ({ ...a, budget_ref: 'budget with spaces' })],
    ['workspace_image_mismatch', a => ({ ...a, image_ref: 'docker.io/synthetic/coding@' + a.spec.image_digest })],
    ['workspace_image_mismatch', a => ({ ...a, image_ref: 'registry.cloudflare.com/synthetic/coding:latest' })],
    ['workspace_materialization_unavailable', a => ({ ...a, materialization: undefined })],
    ['capability_denied', a => ({ ...a, capabilities: { ...a.capabilities, workload_classes: ['coding_untrusted'] } })],
  ];
  for (const [code, change] of cases) {
    const f = fixture(), host = createWorkspaceHost({ ...f.deps, broker: { ...f.broker, admit: async (t: string, aud: any) => {
      const a = await f.broker.admit(t, aud); return a.ok ? { ok: true as const, value: change(a.value) } : a; } } });
    refused(await host.create(f.spec, 'executor.bootstrap'), code); assert.equal(f.stats().starts, 0, code); assert.equal(f.row(), null, code);
  }
});

test('a second spec on the same execution conflicts; replays and duplicate collection accept the artifact once', async () => {
  const f = fixture(); let current = f.spec;
  const host = createWorkspaceHost({ ...f.deps, broker: { ...f.broker, admit: async (t: string, aud: any) => {
    const a = await f.broker.admit(t, aud); return a.ok ? { ok: true as const, value: { ...a.value, spec: current } } : a; } } });
  const created = value(await host.create(f.spec, 'executor.bootstrap')); await tick();
  current = specFixture({ workload_class: 'coding_trusted', scope_paths: ['src'] });
  refused(await host.create(current, 'executor.bootstrap'), 'workspace_idempotency_conflict'); current = f.spec;
  refused(await host.cleanup(created.ref, 'executor.cleanup'), 'workspace_cleanup_requires_stop'); assert.equal(f.stats().stops, 0);
  await f.finish();
  for (let i = 0; i < 3; i++) { value(await host.create(f.spec, 'executor.bootstrap')); value(await host.collect(created.ref, 'executor.collect')); }
  assert.equal(f.stats().starts, 1); assert.equal(f.stats().accepted, 1);
});

test('control calls need the matching audience and the persisted spec', async () => {
  const f = fixture(), created = value(await f.create()); await tick();
  refused(await f.host.terminate(created.ref, 'executor.status'), 'grant_refused');
  refused(await f.host.cleanup(created.ref, 'executor.cancel'), 'grant_refused');
  refused(await f.host.collect(created.ref, 'executor.bootstrap'), 'grant_refused');
  assert.equal(f.stats().stops, 0); assert.equal(f.row()!.state, 'running');
  const other = createWorkspaceHost({ ...f.deps, broker: { ...f.broker, admit: async (t: string, aud: any) => {
    const a = await f.broker.admit(t, aud); return a.ok ? { ok: true as const, value: { ...a.value, spec: specFixture({ workload_class: 'coding_trusted', task_id: 52 }) } } : a; } } });
  refused(await other.terminate(created.ref, 'executor.cancel'), 'execution_not_authorized'); assert.equal(f.row()!.state, 'running');
  await f.finish();
});

test('adapter: disabled, over-budget, ineligible and unticketed calls mint nothing and look up no host', async () => {
  const f = fixture(); let enabled = false, cost = 1, lookups = 0, ticketOk = true; const seen: string[] = [];
  const caps = { ...f.caps };
  const adapter = createCloudflareExecutor({ enabled: () => enabled, capabilities: async () => caps,
    estimate: async () => ({ ok: true, value: { cost_microusd: cost, measured: true } }),
    ticket: async audience => { seen.push(audience); return ticketOk ? { ok: true, value: audience } : workspaceRefusal('grant_refused', 403); },
    getByName: () => { lookups++; return f.host; } });
  refused(await adapter.estimate(f.spec), 'workspace_preview_disabled'); refused(await adapter.create(f.spec), 'workspace_preview_disabled');
  enabled = true;
  for (const c of [f.spec.max_cost_microusd + 1, -1, 1.5, Number.NaN]) { cost = c; refused(await adapter.estimate(f.spec), 'workspace_cost_denied'); }
  cost = f.spec.max_cost_microusd; value(await adapter.estimate(f.spec));
  caps.enforced_regions = ['enam']; refused(await adapter.create(f.spec)); caps.enforced_regions = ['weur'];
  ticketOk = false; refused(await adapter.create(f.spec), 'grant_refused');
  assert.deepEqual(seen, ['executor.bootstrap']); assert.equal(lookups, 0); assert.equal(f.stats().starts, 0);
});

test('image contract: digest-pinned base, Git floored at the scan fix, unprivileged entry, no socket or credential', () => {
  const docker = readFileSync(new URL('../../workspace-engine/container/Dockerfile', import.meta.url), 'utf8');
  const from = docker.match(/^FROM .+$/gm) || []; assert.equal(from.length, 1); assert.match(from[0], /^FROM alpine:3\.\d+@sha256:[a-f0-9]{64}$/);
  const floor = docker.match(/'git>=\d+\.\d+\.\d+-r\d+'/g) || []; assert.equal(floor.length, 1, 'one floor, on the apk add line'); assert.match(docker, /apk add --no-cache [^\n]*'git>=/);
  for (const found of floor) {
    const [major, minor, patch] = found.match(/(\d+)\.(\d+)\.(\d+)-r\d+/)!.slice(1).map(Number);
    assert.ok(major > 2 || (major === 2 && (minor > 54 || (minor === 54 && patch >= 1))), found);
  }
  assert.doesNotMatch(docker, /apk add[^\n]*\sgit(?!>=)\b/, 'an unversioned git would accept the vulnerable package');
  assert.match(docker, /^USER node$/m); assert.match(docker, /^ENTRYPOINT \["\/usr\/bin\/setpriv", "--no-new-privs", "node", "\/app\/idle\.mjs"\]$/m);
  assert.match(docker, /^COPY --chmod=0444 idle\.mjs run-job\.mjs \/app\/$/m); assert.equal((docker.match(/^(COPY|ADD) /gm) || []).length, 1);
  assert.doesNotMatch(docker, /docker\.sock|--privileged|\bsudo\b|setcap|^ARG |^EXPOSE /m);
  assert.doesNotMatch(docker, /^ENV[^\n]*(TOKEN|SECRET|KEY|PASSWORD|CLOUDFLARE|AWS_|GITHUB)/m);
  const config = readFileSync(new URL('../../workspace-engine/wrangler.toml', import.meta.url), 'utf8');
  assert.equal((config.match(/^workers_dev = false$/gm) || []).length, 2); assert.equal((config.match(/^preview_urls = false$/gm) || []).length, 2);
  assert.doesNotMatch(config, /^\s*(routes|route|\[\[routes\]\]|\[\[services\]\]|\[\[env\.preview\.services\]\]|custom_domain)\b/m);
  const workflow = readFileSync(new URL('../../.github/workflows/workspace-image.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^permissions:\n {2}contents: read\n(?! )/m); assert.match(workflow, /node scripts\/build-generated\.mjs/);
});
