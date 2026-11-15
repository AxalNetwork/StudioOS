/**
 * D5568: tenant/repo-scoped Git cache, private per-attempt worktrees from an exact SHA, atomic checksum-verified
 * checkpoints with generation fencing, restore on the original and an alternate fake executor, retention/GC/export
 * and the metrics report. Synthetic data, in-process fakes, injected clock; no network, Cloudflare, R2 or GitHub.
 *
 * Mutation checks (each applied by hand to the source, the suite run, the source restored; every one fails a test here):
 *   M1 gitCacheKey drops the tenant segment            -> "two tenants never share a cache entry"
 *   M2 checkout skips RepoAccess when the commit is cached (authorize moved after the cache lookup and its result ignored) -> "revoked repo"
 *   M3 the pointer CAS drops its generation check      -> "a writer fenced mid-upload"
 *   M4 putVerified skips the read-back checksum        -> "corrupted upload"
 *   M5 restore skips the per-blob object checksum      -> "tampered blob" (AES-GCM would also refuse; the test pins that the bytes never reach the key provider)
 *   M6 restore skips the manifest region allowlist     -> "wrong region"
 *   M7 executePlan skips its generation/head fence     -> "stale GC plan"
 *   M8 Worktree shares the base map instead of copying -> "10 parallel tasks"
 *   M9 commit accepts a reused token with a different tree -> "idempotency"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitCache, gitCacheKey, isExactSha, type GitCache } from '../src/services/agents/workspaceGitCache.ts';
import { createCheckpointService, NOT_MIGRATED, validateCheckpointManifest, workspaceMetricsReport, type CheckpointPolicy } from '../src/services/agents/workspaceCheckpoint.ts';
import type { WorkspaceResult, WorkspaceSpec } from '../src/services/agents/workspaceSpec.ts';
import { fakeCapabilities, specFixture } from './_workspace_fake_5565.ts';
import { BASE_SHA, fakeAccess, fakeRemote, memoryObjects, memoryPointers, tenantCipher } from './_workspace_git_fake_5568.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string) => { assert.equal(r.ok, false, `expected ${code}`); if (!r.ok) assert.equal(r.code, code); };
const text = (v: string) => new TextEncoder().encode(v);
const read = (bytes: Uint8Array | null) => bytes ? new TextDecoder().decode(bytes) : null;
const spec = (changes: Partial<WorkspaceSpec> = {}) => specFixture({ base_sha: BASE_SHA, allowed_providers: ['cloudflare', 'gcp'], ...changes });
const original = fakeCapabilities(), alternate = { ...fakeCapabilities(), provider: 'gcp' as const, revision: 'synthetic-alt-1', concurrency_max: 20 };

function world(policy: Partial<CheckpointPolicy> = {}) {
  let now = 1_000;
  const clock = () => now;
  const { remote, counters } = fakeRemote(), acl = fakeAccess(), objects = memoryObjects(), pointers = memoryPointers();
  const cf = createGitCache({ provider: 'cloudflare', region: 'weur', remote, access: acl.access, clock });
  const gcp = createGitCache({ provider: 'gcp', region: 'weur', remote, access: acl.access, clock });
  const inner = tenantCipher(), opens = { count: 0 };
  const cipher = { seal: inner.seal, open: (...args: Parameters<typeof inner.open>) => { opens.count++; return inner.open(...args); } };
  const cp = createCheckpointService({ objects: objects.store, pointers, cipher, clock,
    policy: { max_file_bytes: 1 << 20, tenant_quota_bytes: 1 << 24, keep_last: 2, ttl_ms: 10_000, ...policy } });
  return { cf, gcp, cp, objects, pointers, remote: counters, acl, opens, tick: (ms: number) => { now += ms; } };
}
async function started(w: ReturnType<typeof world>, s = spec(), cache: GitCache = w.cf) {
  value(await w.cp.register(s, cache.region));
  return value(await cache.checkout(s));
}

test('exact SHA and cache key: only 40 lowercase hex is a base; the key carries provider, region, tenant and repository', async () => {
  for (const bad of ['main', 'HEAD', 'b'.repeat(39), 'B'.repeat(40), 'g'.repeat(40), ' ' + 'b'.repeat(40), null]) assert.equal(isExactSha(bad), false, String(bad));
  assert.equal(isExactSha('0123456789abcdef0123456789abcdef01234567'), true);
  assert.equal(gitCacheKey('cloudflare', 'weur', 11, 61), 'git-cache/cloudflare/weur/t11/r61');
  assert.notEqual(gitCacheKey('cloudflare', 'weur', 11, 61), gitCacheKey('cloudflare', 'weur', 12, 61));
  for (const args of [['cloudflare', 'WEUR', 11, 61], ['cloudflare', 'weur', 0, 61], ['cloudflare', 'weur', 11, 1.5], ['nowhere', 'weur', 11, 61]] as const) {
    assert.equal(gitCacheKey(args[0] as any, args[1], args[2], args[3]), null);
  }
  const w = world();
  for (const base_sha of ['main', 'B'.repeat(40), 'b'.repeat(39)]) refused(await w.cf.checkout({ ...spec(), base_sha } as WorkspaceSpec), 'invalid_base_sha');
  refused(await validateCheckpointManifest({ base_sha: 'main' }), 'invalid_base_sha');
  assert.equal(w.remote.fetches, 0, 'an invalid SHA never reaches the remote');
});

test('two tenants never share a cache entry for the same repository, and a revoked repo is refused even when cached', async () => {
  const w = world();
  const a = value(await w.cf.checkout(spec())), b = value(await w.cf.checkout(spec({ tenant_id: 12, run_id: 'run-other' })));
  assert.notEqual(a.cache_key, b.cache_key);
  assert.deepEqual(w.cf.inventory().map(e => [e.tenant_id, e.repo_id]).sort(), [[11, 61], [12, 61]]);
  assert.deepEqual([w.cf.stats.cache_misses, w.remote.fetches], [2, 2], 'tenant 12 fetched its own objects; nothing was read from tenant 11');
  assert.equal(w.cf.inventory()[0].bytes, w.cf.inventory()[1].bytes);
  a.release(); b.release();
  value(await w.cf.checkout(spec({ run_id: 'run-cached' })));
  w.acl.revoke(11, 61);
  refused(await w.cf.checkout(spec({ run_id: 'run-after-revoke' })), 'repo_access_revoked');
  assert.equal(w.remote.fetches, 2);
  value(await w.cf.checkout(spec({ tenant_id: 12, run_id: 'run-other-2' })));
});

test('10 parallel tasks from one repo get private worktrees and checkpoints that never overwrite each other', async () => {
  const w = world();
  const specs = Array.from({ length: 10 }, (_, i) => spec({ run_id: `run-par-${i}`, idempotency_key: `run-par-${i}:ws:1` }));
  for (const s of specs) value(await w.cp.register(s, 'weur'));
  const trees = (await Promise.all(specs.map(s => w.cf.checkout(s)))).map(value);
  assert.deepEqual([w.remote.fetches, w.cf.stats.cache_misses, w.cf.stats.cache_hits], [1, 1, 9], 'one verified fetch serves all ten');
  assert.equal(new Set(trees.map(t => t.id)).size, 10); assert.equal(new Set(trees.map(t => t.branch)).size, 10);
  refused(await w.cf.checkout(specs[0]), 'worktree_exists');
  await Promise.all(trees.map(async (t, i) => {
    value(t.write('src/app.ts', text(`export const answer = ${i};\n`)));
    value(t.write(`src/task-${i}.ts`, text(`// task ${i}\n`)));
    if (i % 2) value(t.remove('src/util.ts'));
  }));
  refused(trees[0].write('docs/outside.md', text('x')), 'path_not_allowed');
  refused(trees[0].write('src/../escape', text('x')), 'path_not_allowed');
  const results = await Promise.all(trees.map((t, i) => w.cp.commit({ spec: specs[i], worktree: t, token: `cp-${i}-1`, key_id: 'k1' })));
  results.forEach(r => assert.equal(value(r).sequence, 1));
  for (const [i, t] of trees.entries()) {
    assert.equal(read(t.read('src/app.ts')), `export const answer = ${i};\n`);
    assert.deepEqual(t.paths().filter(p => p.startsWith('src/task-')), [`src/task-${i}.ts`]);
    t.release();
  }
  const fresh = value(await w.cf.checkout(spec({ run_id: 'run-base-check' })));
  assert.equal(read(fresh.read('src/app.ts')), 'export const answer = 1;\n', 'the shared base snapshot is unchanged');
  assert.equal(fresh.paths().length, 4);
  await Promise.all(specs.map(async (s, i) => {
    value(await w.cp.fence(s.tenant_id, s.run_id, 2));
    const next = { ...s, execution_generation: 2 };
    const restored = value(await w.cp.restore({ spec: next, cache: w.gcp, capabilities: alternate, region: 'weur' }));
    assert.equal(read(restored.worktree.read('src/app.ts')), `export const answer = ${i};\n`);
    assert.equal(restored.worktree.read('src/util.ts') === null, i % 2 === 1);
    assert.deepEqual(restored.worktree.paths().filter(p => p.startsWith('src/task-')), [`src/task-${i}.ts`]);
  }));
});

test('an interrupted workspace restores its last acknowledged checkpoint on the original and an alternate adapter', async () => {
  const w = world(), s = spec(), tree = await started(w, s);
  value(tree.write('src/app.ts', text('acknowledged\n')));
  const ack = value(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-1', key_id: 'k1' }));
  value(tree.write('src/app.ts', text('never acknowledged\n'))); value(tree.write('src/extra.ts', text('x\n')));
  w.objects.faults.crashAfterPuts = 1;
  refused(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-2', key_id: 'k1' }), 'checkpoint_upload_interrupted');
  w.objects.faults.crashAfterPuts = Infinity;
  w.pointers.failNext();
  await assert.rejects(w.cp.commit({ spec: s, worktree: tree, token: 'cp-3', key_id: 'k1' }), /pointer store outage/, 'all content uploaded, pointer not advanced');
  assert.equal(w.pointers.inspect().get('11/run-synthetic')!.head!.sequence, ack.sequence);
  value(await w.cp.fence(11, s.run_id, 2));
  const next = { ...s, execution_generation: 2 };
  for (const [cache, caps] of [[w.cf, original], [w.gcp, alternate]] as const) {
    const r = value(await w.cp.restore({ spec: next, cache, capabilities: caps, region: 'weur' }));
    assert.equal(r.sequence, 1); assert.equal(r.manifest_sha256, ack.manifest_sha256);
    assert.equal(read(r.worktree.read('src/app.ts')), 'acknowledged\n');
    assert.equal(r.worktree.read('src/extra.ts'), null);
    assert.equal(r.worktree.provider, caps.provider);
    assert.deepEqual([...r.not_migrated], ['running_processes', 'memory', 'open_sockets', 'local_pids']);
    assert.equal(NOT_MIGRATED, r.not_migrated);
    r.worktree.release();
  }
  assert.equal(w.gcp.stats.cache_misses, 1, 'the alternate rebuilt the checkout from the exact SHA in its own cache');
  const plan = value(await w.cp.retentionPlan(11, s.run_id));
  assert.ok(plan.delete.length > 0 && plan.delete.every(k => k.includes('/g1/cp-2/') || k.includes('/g1/cp-3/')), 'only unacknowledged staged objects of a fenced generation');
  value(await w.cp.executePlan(plan));
  value(await w.cp.restore({ spec: next, cache: w.cf, capabilities: original, region: 'weur' }));
});

test('rejects wrong tenant, wrong region, wrong image, tampered blob or manifest and corrupted upload', async () => {
  const w = world(), s = spec(), tree = await started(w, s);
  value(tree.write('src/app.ts', text('v1\n')));
  const ack = value(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-1', key_id: 'k1' }));
  tree.release(); value(await w.cp.fence(11, s.run_id, 2));
  const next = spec({ execution_generation: 2 });
  refused(await w.cp.restore({ spec: { ...next, tenant_id: 12 }, cache: w.cf, capabilities: original, region: 'weur' }), 'checkpoint_not_found');
  const rows = w.pointers.rows(), forged = structuredClone(rows.get('11/run-synthetic')!); forged.tenant_id = 12; rows.set('12/run-synthetic', forged);
  refused(await w.cp.restore({ spec: { ...next, tenant_id: 12 }, cache: w.cf, capabilities: original, region: 'weur' }), 'tenant_mismatch');
  const wide = spec({ execution_generation: 2, allowed_regions: ['weur', 'wnam'] });
  const wnamCache = createGitCache({ provider: 'cloudflare', region: 'wnam', remote: fakeRemote().remote, access: fakeAccess().access, clock: () => 0 });
  refused(await w.cp.restore({ spec: wide, cache: wnamCache, capabilities: { ...original, enforced_regions: ['weur', 'wnam'] }, region: 'wnam' }), 'region_not_allowed');
  refused(await w.cp.restore({ spec: next, cache: wnamCache, capabilities: { ...original, enforced_regions: ['wnam', 'weur'] }, region: 'wnam' }), 'region_not_allowed');
  refused(await w.cp.restore({ spec: next, cache: w.cf, capabilities: { ...original, enforced_regions: ['wnam'] }, region: 'weur' }), 'capability_denied');
  refused(await w.cp.restore({ spec: next, cache: w.cf, capabilities: { ...original, checkpoint_restore: false }, region: 'weur' }), 'capability_denied');
  refused(await w.cp.restore({ spec: { ...next, image_digest: 'sha256:' + 'c'.repeat(64) }, cache: w.cf, capabilities: original, region: 'weur' }), 'image_digest_mismatch');
  refused(await w.cp.restore({ spec: { ...next, base_sha: '2'.repeat(40) }, cache: w.cf, capabilities: original, region: 'weur' }), 'base_sha_mismatch');
  refused(await w.cp.restore({ spec: { ...next, base_sha: 'main' }, cache: w.cf, capabilities: original, region: 'weur' }), 'invalid_base_sha');
  const blob = [...w.objects.data.keys()].find(k => k.includes('/blobs/'))!;
  const saved = new Uint8Array(w.objects.data.get(blob)!);
  w.objects.tamper(blob);
  const opensBefore = w.opens.count;
  refused(await w.cp.restore({ spec: next, cache: w.cf, capabilities: original, region: 'weur' }), 'checksum_mismatch');
  assert.equal(w.opens.count, opensBefore, 'tampered ciphertext is refused by its object checksum before it reaches the key provider');
  w.objects.data.set(blob, saved);
  const savedManifest = new Uint8Array(w.objects.data.get(ack.manifest_key)!);
  w.objects.tamper(ack.manifest_key);
  refused(await w.cp.restore({ spec: next, cache: w.cf, capabilities: original, region: 'weur' }), 'checksum_mismatch');
  w.objects.data.set(ack.manifest_key, savedManifest);
  const ok = value(await w.cp.restore({ spec: next, cache: w.cf, capabilities: original, region: 'weur' }));
  assert.equal(read(ok.worktree.read('src/app.ts')), 'v1\n');
  value(ok.worktree.write('src/app.ts', text('v2\n')));
  w.objects.faults.corruptNextPut = true;
  refused(await w.cp.commit({ spec: next, worktree: ok.worktree, token: 'cp-2', key_id: 'k1' }), 'checksum_mismatch');
  assert.equal(w.pointers.inspect().get('11/run-synthetic')!.head!.sequence, 1, 'a corrupted upload never advances the pointer');
  const wrongKey = await tenantCipher().open(11, 'k1', 'aad', new Uint8Array(w.objects.data.get(blob)!));
  assert.equal(wrongKey, null, 'another key provider cannot open a tenant blob');
});

test('stale generation: an old writer, a writer fenced mid-upload and a non-increasing fence are refused', async () => {
  const w = world(), s = spec(), tree = await started(w, s);
  value(tree.write('src/app.ts', text('a\n')));
  w.objects.faults.onPut = async key => { if (key.endsWith('manifest.json')) { w.objects.faults.onPut = null; value(await w.cp.fence(11, s.run_id, 2)); } };
  refused(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-1', key_id: 'k1' }), 'stale_generation');
  assert.equal(w.pointers.inspect().get('11/run-synthetic')!.head, null);
  refused(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-1b', key_id: 'k1' }), 'stale_generation');
  refused(await w.cp.fence(11, s.run_id, 2), 'stale_generation');
  refused(await w.cp.fence(11, s.run_id, 1), 'stale_generation');
  refused(await w.cp.restore({ spec: s, cache: w.cf, capabilities: original, region: 'weur' }), 'stale_generation');
  const next = spec({ execution_generation: 2 }), t2 = value(await w.cf.checkout(next));
  refused(await w.cp.commit({ spec: next, worktree: tree, token: 'cp-x', key_id: 'k1' }), 'worktree_not_authorized');
  value(t2.write('src/app.ts', text('b\n')));
  assert.equal(value(await w.cp.commit({ spec: next, worktree: t2, token: 'cp-2', key_id: 'k1' })).sequence, 1);
});

test('idempotency: the same token and tree is a duplicate with no new upload; the same token with another tree conflicts', async () => {
  const w = world(), s = spec(), tree = await started(w, s);
  value(tree.write('src/app.ts', text('a\n')));
  const first = value(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-1', key_id: 'k1' })), puts = w.objects.counts.puts;
  const again = value(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-1', key_id: 'k1' }));
  assert.deepEqual({ ...again, duplicate: false }, first); assert.equal(again.duplicate, true); assert.equal(w.objects.counts.puts, puts);
  value(tree.write('src/app.ts', text('b\n')));
  refused(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-1', key_id: 'k1' }), 'idempotency_conflict');
  refused(await w.cp.commit({ spec: s, worktree: tree, token: '../cp', key_id: 'k1' }), 'invalid_checkpoint_request');
});

test('stale GC plan, quota, retention, explicit delete, export and eviction never touch the head or the customer repo', async () => {
  const w = world({ keep_last: 2, ttl_ms: 5_000 }), s = spec(), tree = await started(w, s);
  const commits = [];
  for (let i = 1; i <= 4; i++) { value(tree.write('src/app.ts', text(`v${i}\n`))); commits.push(value(await w.cp.commit({ spec: s, worktree: tree, token: `cp-${i}`, key_id: 'k1' }))); w.tick(1_000); }
  assert.deepEqual(value(await w.cp.retentionPlan(11, s.run_id)).delete, [], 'within TTL nothing is planned');
  w.tick(10_000);
  const plan = value(await w.cp.retentionPlan(11, s.run_id));
  assert.ok(plan.delete.length > 0 && plan.delete.every(k => /\/g1\/cp-[12]\//.test(k)), 'only the oldest superseded checkpoints');
  value(tree.write('src/app.ts', text('v5\n'))); value(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-5', key_id: 'k1' }));
  refused(await w.cp.executePlan(plan), 'stale_gc');
  assert.equal(w.objects.counts.deletes, 0);
  refused(await w.cp.executePlan({ ...value(await w.cp.retentionPlan(11, s.run_id)), delete: ['tenants/12/workspace-checkpoints/x/g1/t/manifest.json'] }), 'gc_scope_violation');
  value(await w.cp.executePlan(value(await w.cp.retentionPlan(11, s.run_id))));
  assert.ok(w.objects.counts.deletes > 0);
  const exported = value(await w.cp.exportPlan(11, s.run_id, 'weur'));
  assert.ok(exported.egress_bytes > 0 && exported.objects.includes(exported.manifest_key));
  refused(await w.cp.exportPlan(11, s.run_id, 'wnam'), 'region_not_allowed');
  refused(await w.cp.exportPlan(12, s.run_id, 'weur'), 'checkpoint_not_found');
  const small = world({ tenant_quota_bytes: 200 }), st = await started(small, s);
  value(st.write('src/app.ts', text('x'.repeat(500))));
  refused(await small.cp.commit({ spec: s, worktree: st, token: 'cp-q', key_id: 'k1' }), 'checkpoint_quota_exceeded');
  refused(await w.cp.deleteRun(11, s.run_id, 7), 'stale_generation');
  const del = value(await w.cp.deleteRun(11, s.run_id, 1));
  refused(await w.cp.commit({ spec: s, worktree: tree, token: 'cp-6', key_id: 'k1' }), 'checkpoint_deleted');
  value(await w.cp.executePlan(del));
  assert.deepEqual(await w.objects.store.list(`tenants/11/workspace-checkpoints/${s.run_id}/`), []);
  refused(await w.cp.restore({ spec: spec({ execution_generation: 2 }), cache: w.cf, capabilities: original, region: 'weur' }), 'checkpoint_deleted');
  assert.equal(w.remote.pushes, 0, 'nothing pushed, deleted or rewritten on the remote');
  assert.deepEqual(w.cf.evict({ idle_ttl_ms: 0, max_bytes_per_tenant: 0 }), [], 'an entry with an open worktree is kept');
  tree.release();
  assert.deepEqual(w.cf.evict({ idle_ttl_ms: 0, max_bytes_per_tenant: 1 << 30 }), ['git-cache/cloudflare/weur/t11/r61']);
  assert.equal(w.cf.inventory().length, 0);
});

test('metrics report: push count, clone bytes, cache hit %, disk cost and checkpoint size come from the fake adapters', async () => {
  const w = world();
  const specs = Array.from({ length: 4 }, (_, i) => spec({ run_id: `run-m-${i}` }));
  for (const s of specs) value(await w.cp.register(s, 'weur'));
  const trees = (await Promise.all(specs.map(s => w.cf.checkout(s)))).map(value);
  for (const [i, t] of trees.entries()) { value(t.write('src/app.ts', text(`m${i}\n`))); value(await w.cp.commit({ spec: specs[i], worktree: t, token: `cp-${i}`, key_id: 'k1' })); }
  value(await w.cp.fence(11, 'run-m-0', 2));
  value(await w.cp.restore({ spec: { ...specs[0], execution_generation: 2 }, cache: w.gcp, capabilities: alternate, region: 'weur' }));
  const usage = await w.cp.usage(11);
  const report = workspaceMetricsReport({ source: 'local_fake_adapter', github_push_count: w.remote.pushes,
    caches: [w.cf, w.gcp].map(c => ({ stats: c.stats, disk_bytes: c.diskBytes(trees) })), checkpoints: [usage], disk_microusd_per_gb_hour: 100_000_000, hours: 1 });
  assert.equal(report.source, 'local_fake_adapter');
  assert.equal(report.github_push_count, 0);
  assert.equal(report.clone_bytes, w.remote.bytes_served);
  assert.deepEqual([report.cache_hits, report.cache_misses, report.cache_hit_pct], [3, 2, 60]);
  assert.equal(report.checkpoint_count, 4); assert.equal(report.checkpoint_bytes, usage.bytes); assert.ok(report.checkpoint_bytes_max > 0 && report.checkpoint_bytes_max <= usage.bytes);
  assert.ok(report.disk_bytes >= report.clone_bytes);
  assert.equal(report.disk_cost_microusd, Math.round(report.disk_bytes / 1e9 * 100_000_000));
  assert.equal(JSON.stringify(report).includes('src/'), false, 'counts only: no paths or content');
});
