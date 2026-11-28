/**
 * D5568 part 2: the R2 checkpoint adapter's contract on an in-memory R2-shaped bucket with fault injection: namespace,
 * key and prefix scope, SHA-256 on put, read-back verify, missing object, corrupted-at-rest read, paginated list and the
 * fenced delete; and the checkpoint service mapping the adapter's refusals. Synthetic data, no network, R2 or Cloudflare.
 *
 * Mutation checks (each applied by hand to the source, this file run, the source restored; every one fails a test here):
 *   R1 put skips the input SHA-256 comparison              -> "put refuses bytes that do not hash to the stated checksum"
 *   R2 put skips the read-back                             -> "read-back"
 *   R3 get skips re-hashing against the recorded checksum  -> "get refuses an object corrupted at rest"
 *   R4 list skips the run-prefix check                     -> "wrong prefix"
 *   R5 delete skips the fence                              -> "fenced delete"
 *   R6 list stops after the first page                     -> "list pages"
 *   R7 the service maps a store refusal on read to 503     -> "service maps"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKPOINT_LIST_PAGE, createR2CheckpointObjectStore, type CheckpointBucket } from '../src/services/agents/workspaceCheckpointR2.ts';
import { CheckpointStoreRefusal, createCheckpointService, type CheckpointObjectStore } from '../src/services/agents/workspaceCheckpoint.ts';
import { sha256Hex, createGitCache } from '../src/services/agents/workspaceGitCache.ts';
import type { WorkspaceResult } from '../src/services/agents/workspaceSpec.ts';
import { fakeCapabilities, specFixture } from './_workspace_fake_5565.ts';
import { BASE_SHA, fakeAccess, fakeRemote, memoryPointers, tenantCipher } from './_workspace_git_fake_5568.ts';

const text = (v: string) => new TextEncoder().encode(v);
const KEY = `tenants/11/workspace-checkpoints/run-synthetic/g1/cp-1/blobs/${'c'.repeat(64)}`;
const MANIFEST = 'tenants/11/workspace-checkpoints/run-synthetic/g1/cp-1/manifest.json';
const PREFIX = 'tenants/11/workspace-checkpoints/run-synthetic/';
const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string) => { assert.equal(r.ok, false, `expected ${code}`); if (!r.ok) assert.equal(r.code, code); };
async function refusal(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof CheckpointStoreRefusal && e.code === code, `expected ${code}`);
}

function fakeBucket() {
  const data = new Map<string, { bytes: Uint8Array; meta: Record<string, string> }>();
  const faults = { dropNextPut: false, nullNextPut: false, corruptOnWrite: false, pageSize: CHECKPOINT_LIST_PAGE, foreignKeyInList: '' };
  const calls = { puts: 0, gets: 0, deletes: 0, lists: 0 };
  const bucket: CheckpointBucket = {
    async put(key, value, options) {
      calls.puts++;
      if (await sha256Hex(value) !== options.sha256) throw new Error('synthetic R2 checksum rejection');
      if (faults.nullNextPut) { faults.nullNextPut = false; return null; }
      if (faults.dropNextPut) { faults.dropNextPut = false; return { key, size: value.length }; }
      const bytes = new Uint8Array(value);
      if (faults.corruptOnWrite) { faults.corruptOnWrite = false; bytes[0] ^= 0xff; }
      data.set(key, { bytes, meta: { ...options.customMetadata } });
      return { key, size: bytes.length };
    },
    async get(key) {
      calls.gets++;
      const o = data.get(key);
      return o ? { size: o.bytes.length, customMetadata: { ...o.meta }, arrayBuffer: async () => o.bytes.slice().buffer } : null;
    },
    async list({ prefix, cursor, limit }) {
      calls.lists++;
      const size = Math.min(limit ?? CHECKPOINT_LIST_PAGE, faults.pageSize);
      const keys = [...data.keys()].filter(k => k.startsWith(prefix)).sort();
      if (faults.foreignKeyInList) keys.push(faults.foreignKeyInList);
      const start = cursor ? Number(cursor) : 0, page = keys.slice(start, start + size);
      const truncated = start + size < keys.length;
      return { objects: page.map(key => ({ key, size: data.get(key)?.bytes.length ?? 0 })), truncated, ...(truncated ? { cursor: String(start + size) } : {}) };
    },
    async delete(key) { calls.deletes++; data.delete(key); },
  };
  return { bucket, data, faults, calls };
}
function adapter(mayDelete: (key: string) => Promise<boolean> = async () => true) {
  const b = fakeBucket(), fenceCalls: string[] = [];
  const store = createR2CheckpointObjectStore({ bucket: b.bucket, namespace: 'preview-5568', fence: { mayDelete: async k => { fenceCalls.push(k); return mayDelete(k); } } });
  return { ...b, store, fenceCalls };
}

test('namespace and key scope: only checkpoint keys under the namespace are reachable', async () => {
  for (const namespace of ['', 'Prod', 'a/b', '1x', 'x'.repeat(33)]) assert.throws(() => createR2CheckpointObjectStore({ bucket: fakeBucket().bucket, namespace, fence: { mayDelete: async () => true } }));
  const a = adapter(), bytes = text('sealed');
  await a.store.put(KEY, bytes, { sha256: await sha256Hex(bytes) });
  assert.deepEqual([...a.data.keys()], ['preview-5568/' + KEY], 'stored under the namespace');
  assert.deepEqual(a.data.get('preview-5568/' + KEY)!.meta, { sha256: await sha256Hex(bytes) });
  for (const bad of ['tenants/0/workspace-checkpoints/run-synthetic/g1/cp-1/manifest.json', 'tenants/11/workspace-checkpoints/run-synthetic/g1/cp-1/../manifest.json',
    'tenants/11/other/run-synthetic/g1/cp-1/manifest.json', 'tenants/11/workspace-checkpoints/run-synthetic/g0/cp-1/manifest.json',
    'tenants/11/workspace-checkpoints/run-synthetic/g1/cp-1/blobs/' + 'C'.repeat(64), '/' + MANIFEST, MANIFEST + 'x', 'git-cache/cloudflare/weur/t11/r61']) {
    await refusal(a.store.put(bad, bytes, { sha256: await sha256Hex(bytes) }), 'checkpoint_key_out_of_scope');
    await refusal(a.store.get(bad), 'checkpoint_key_out_of_scope');
    await refusal(a.store.delete(bad), 'checkpoint_key_out_of_scope');
  }
  assert.equal(a.data.size, 1); assert.equal(a.calls.deletes, 0); assert.deepEqual(a.fenceCalls, [], 'an out-of-scope key never reaches the fence or the bucket');
});

test('put refuses bytes that do not hash to the stated checksum, before any write', async () => {
  const a = adapter(), bytes = text('sealed');
  await refusal(a.store.put(KEY, bytes, { sha256: 'd'.repeat(64) }), 'checksum_mismatch');
  await refusal(a.store.put(KEY, bytes, { sha256: 'not-hex' }), 'checksum_mismatch');
  assert.equal(a.calls.puts, 0); assert.equal(a.data.size, 0);
});

test('read-back: a put the bucket lost, refused or corrupted is refused, never acknowledged', async () => {
  const a = adapter(), bytes = text('sealed'), sha256 = await sha256Hex(bytes);
  a.faults.dropNextPut = true;
  await refusal(a.store.put(KEY, bytes, { sha256 }), 'checkpoint_object_missing');
  a.faults.nullNextPut = true;
  await refusal(a.store.put(KEY, bytes, { sha256 }), 'checkpoint_upload_interrupted');
  a.faults.corruptOnWrite = true;
  await refusal(a.store.put(KEY, bytes, { sha256 }), 'checksum_mismatch');
  await a.store.put(KEY, bytes, { sha256 });
  assert.deepEqual(await a.store.get(KEY), bytes);
});

test('get: an absent object is null; an object corrupted at rest or with no recorded checksum is refused', async () => {
  const a = adapter(), bytes = text('sealed');
  assert.equal(await a.store.get(KEY), null);
  await a.store.put(KEY, bytes, { sha256: await sha256Hex(bytes) });
  a.data.get('preview-5568/' + KEY)!.bytes[2] ^= 1;
  await refusal(a.store.get(KEY), 'checksum_mismatch');
  a.data.set('preview-5568/' + MANIFEST, { bytes: text('{}'), meta: {} });
  await refusal(a.store.get(MANIFEST), 'checksum_mismatch');
});

test('list pages through one run prefix and refuses a wrong prefix or a foreign key', async () => {
  const a = adapter();
  a.faults.pageSize = 2;
  const keys = [];
  for (let i = 0; i < 5; i++) {
    const bytes = text(`blob ${i}`), key = `${PREFIX}g1/cp-1/blobs/${await sha256Hex(bytes)}`;
    keys.push(key); await a.store.put(key, bytes, { sha256: await sha256Hex(bytes) });
  }
  const other = text('other run');
  await a.store.put(`tenants/11/workspace-checkpoints/run-other/g1/cp-1/blobs/${await sha256Hex(other)}`, other, { sha256: await sha256Hex(other) });
  const listed = await a.store.list(PREFIX);
  assert.deepEqual(listed.map(o => o.key), keys.sort(), 'every page, namespace stripped, other run excluded');
  assert.equal(a.calls.lists, 3);
  for (const bad of ['tenants/11/workspace-checkpoints/', 'tenants/11/', '', 'tenants/11/workspace-checkpoints/run-synthetic', 'tenants/x/workspace-checkpoints/run-synthetic/', 'preview-5568/' + PREFIX]) {
    await refusal(a.store.list(bad), 'checkpoint_prefix_out_of_scope');
  }
  a.faults.foreignKeyInList = 'preview-5568/tenants/12/workspace-checkpoints/run-synthetic/g1/cp-1/manifest.json';
  await refusal(a.store.list(PREFIX), 'checkpoint_prefix_out_of_scope');
});

test('fenced delete: the fence is asked for every key and a refused key is never deleted', async () => {
  const a = adapter(async key => !key.endsWith('manifest.json')), bytes = text('sealed'), m = text('{}');
  await a.store.put(KEY, bytes, { sha256: await sha256Hex(bytes) });
  await a.store.put(MANIFEST, m, { sha256: await sha256Hex(m) });
  await refusal(a.store.delete(MANIFEST), 'stale_gc');
  assert.ok(a.data.has('preview-5568/' + MANIFEST)); assert.equal(a.calls.deletes, 0);
  await a.store.delete(KEY);
  assert.equal(a.data.has('preview-5568/' + KEY), false);
  assert.deepEqual(a.fenceCalls, [MANIFEST, KEY]);
});

test('service maps the adapter: commit and restore through it; a corrupted read is checksum_mismatch, a fenced delete is stale_gc', async () => {
  let fenced = false, now = 1000;
  const a = adapter(async () => !fenced), pointers = memoryPointers(), { remote } = fakeRemote(), acl = fakeAccess();
  const objects: CheckpointObjectStore = a.store;
  const cp = createCheckpointService({ objects, pointers, cipher: tenantCipher(), clock: () => now, policy: { max_file_bytes: 1 << 20, tenant_quota_bytes: 1 << 24, keep_last: 1, ttl_ms: 1 } });
  const cache = createGitCache({ provider: 'cloudflare', region: 'weur', remote, access: acl.access, clock: () => 1000 });
  const spec = specFixture({ base_sha: BASE_SHA });
  value(await cp.register(spec, 'weur'));
  const tree = value(await cache.checkout(spec));
  value(tree.write('src/app.ts', text('one\n')));
  value(await cp.commit({ spec, worktree: tree, token: 'cp-1', key_id: 'k1' }));
  value(tree.write('src/app.ts', text('two\n')));
  const second = value(await cp.commit({ spec, worktree: tree, token: 'cp-2', key_id: 'k1' }));
  tree.release();
  const restored = value(await cp.restore({ spec, cache, capabilities: fakeCapabilities(), region: 'weur' }));
  assert.equal(new TextDecoder().decode(restored.worktree.read('src/app.ts')!), 'two\n'); restored.worktree.release();
  a.data.get('preview-5568/' + second.manifest_key)!.bytes[0] ^= 1;
  refused(await cp.restore({ spec, cache, capabilities: fakeCapabilities(), region: 'weur' }), 'checksum_mismatch');
  a.data.get('preview-5568/' + second.manifest_key)!.bytes[0] ^= 1;
  const blob = [...a.data.keys()].find(k => k.includes('/cp-2/blobs/'))!;
  a.data.get(blob)!.bytes[0] ^= 1;
  refused(await cp.restore({ spec, cache, capabilities: fakeCapabilities(), region: 'weur' }), 'checksum_mismatch');
  assert.equal(cache.inventory()[0].open_worktrees, 0, 'a refused restore released its worktree');
  now += 10;
  const plan = value(await cp.retentionPlan(11, spec.run_id));
  assert.ok(plan.delete.length > 0 && plan.delete.every(k => k.includes('/cp-1/')));
  fenced = true;
  refused(await cp.executePlan(plan), 'stale_gc');
  assert.ok(plan.delete.every(k => a.data.has('preview-5568/' + k)), 'nothing deleted past a refused fence');
});
