/**
 * D5568 part 2: the checkpoint pointer store on a real SQLite Durable Object and the R2 adapter on a real Miniflare R2
 * bucket, hosted in a test-only object (no binding in wrangler.toml). Concurrent commits, restart, a D5565 runner
 * generation bump fencing a writer with no fence() call, rollback, the store's own refusals, the fenced delete,
 * retention GC and a cross-tenant row. Synthetic data; the cipher's keys are derived from synthetic labels so a restore
 * survives the restart.
 *
 * Mutation checks (each applied by hand to the source, this file run, the source restored; every one fails a test here):
 *   S1 the pointer store skips raising a row to its runner's generation -> "runner generation bump fences"
 *   S2 the pointer store allows a lowered generation                    -> "regressNoRunner" ("regress" alone is also caught by the runner check)
 *   S3 the pointer store allows a removed row                           -> "removeRow"
 *   S4 mayDelete ignores the head's objects                             -> "deleteHead"
 *   S5 the pointer store skips the runner tenant check                  -> "registerForeign"
 *   S6 the store accepts an async change                                -> "async"
 *   S7 the stores hand the change the stored snapshot instead of a copy -> "runner generation bump fences" (the bump is never written)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
// The Durable Object's instance name in Miniflare and the bucket name (fixture labels, not credentials).
const DO_INSTANCE_NAME = 'checkpoint-5568-test';
const BUCKET_NAME = 'checkpoint-5568-test-bucket';
const root = process.cwd();
const fixture = `
import { DurableCheckpointPointerStore, DurableRunnerStore, POINTER_KEY_PREFIX } from './cloudflare-worker/src/services/agents/workspaceCheckpointStore.ts';
import { createR2CheckpointObjectStore } from './cloudflare-worker/src/services/agents/workspaceCheckpointR2.ts';
import { createCheckpointService } from './cloudflare-worker/src/services/agents/workspaceCheckpoint.ts';
import { createRunnerControl } from './cloudflare-worker/src/services/agents/runnerProtocol.ts';
import { createGitCache, sha256Hex } from './cloudflare-worker/src/services/agents/workspaceGitCache.ts';
import { fakeCapabilities, specFixture } from './cloudflare-worker/test/_workspace_fake_5565.ts';
import { BASE_SHA, fakeAccess, fakeRemote } from './cloudflare-worker/test/_workspace_git_fake_5568.ts';
const text = v => new TextEncoder().encode(v);
const keyFor = async (tenant, id) => crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', text('synthetic-key|' + tenant + '|' + id)), 'AES-GCM', false, ['encrypt', 'decrypt']);
const cipher = {
  async seal(tenant, id, aad, plain) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text(aad) }, await keyFor(tenant, id), plain)); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; },
  async open(tenant, id, aad, sealed) { try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: text(aad) }, await keyFor(tenant, id), sealed.slice(12))); } catch { return null; } },
};
const spec = (changes = {}) => specFixture({ base_sha: BASE_SHA, ...changes });
export class TestCheckpoint {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const { op, args = {}, now = 1000 } = await req.json();
    const pointers = new DurableCheckpointPointerStore(this.state.storage), runners = new DurableRunnerStore(this.state.storage);
    const objects = createR2CheckpointObjectStore({ bucket: this.env.CHECKPOINTS, namespace: 'preview-5568', fence: pointers });
    const cp = createCheckpointService({ objects, pointers, cipher, clock: () => now, policy: { max_file_bytes: 1 << 20, tenant_quota_bytes: 1 << 24, keep_last: 1, ttl_ms: 1 } });
    const runner = createRunnerControl({ store: runners, clock: () => now, policy: { heartbeat_ms: 1000, missed_beat_limit: 2, max_generations: 3, nonce: () => crypto.randomUUID(), authorize: () => true, manifestAllowed: () => true } });
    const cache = createGitCache({ provider: 'cloudflare', region: 'weur', remote: fakeRemote().remote, access: fakeAccess().access, clock: () => now });
    const s = spec({ execution_generation: args.generation ?? 1 });
    const ops = {
      register: async () => [await runner.register(spec()), await cp.register(spec(), 'weur')],
      registerForeign: () => cp.register(spec({ tenant_id: 12 }), 'weur'),
      commit: async () => {
        const tree = await cache.checkout(s); if (!tree.ok) return tree;
        tree.value.write('src/app.ts', text(args.content));
        try { return await cp.commit({ spec: s, worktree: tree.value, token: args.token, key_id: 'k1' }); } finally { tree.value.release(); }
      },
      cancel: () => runner.requestCancel(s.run_id, args.expected),
      head: async () => (await this.state.storage.get(POINTER_KEY_PREFIX + '11/' + s.run_id)),
      restore: async () => {
        const r = await cp.restore({ spec: s, cache, capabilities: fakeCapabilities(), region: 'weur' });
        if (!r.ok) return r;
        const content = new TextDecoder().decode(r.value.worktree.read('src/app.ts')); r.value.worktree.release();
        return { ok: true, value: { sequence: r.value.sequence, content } };
      },
      rollback: async () => { try { await pointers.transaction(rows => { rows.get('11/' + s.run_id).generation = 99; throw new Error('synthetic rollback'); }); } catch {} return pointers.transaction(rows => rows.get('11/' + s.run_id).generation); },
      regress: () => pointers.transaction(rows => { rows.get('11/' + s.run_id).generation = 1; return true; }),
      regressNoRunner: async () => {
        const solo = spec({ run_id: 'run-solo', idempotency_key: 'run-solo:workspace:1' });
        const steps = [await cp.register(solo, 'weur'), await cp.fence(11, 'run-solo', 3)];
        try { await pointers.transaction(rows => { rows.get('11/run-solo').generation = 2; return true; }); steps.push({ lowered: true }); }
        catch (e) { steps.push({ thrown: e.code }); }
        return [...steps, await pointers.transaction(rows => rows.get('11/run-solo').generation)];
      },
      async: () => pointers.transaction(async rows => { rows.get('11/' + s.run_id).generation = 50; return true; }),
      removeRow: () => pointers.transaction(rows => { rows.delete('11/' + s.run_id); return true; }),
      deleteHead: async () => {
        const head = (await this.state.storage.get(POINTER_KEY_PREFIX + '11/' + s.run_id)).head;
        try { await objects.delete(head.manifest_key); return { deleted: true }; }
        catch (e) { return { thrown: e.code, still_there: (await objects.get(head.manifest_key)) !== null }; }
      },
      gc: async () => { const plan = await cp.retentionPlan(11, s.run_id); if (!plan.ok) return plan; return { plan: plan.value.delete, result: await cp.executePlan(plan.value) }; },
      rawWrongSha: async () => { try { await this.env.CHECKPOINTS.put('preview-5568/probe', text('x'), { sha256: 'f'.repeat(64) }); return { stored: true }; } catch { return { stored: (await this.env.CHECKPOINTS.get('preview-5568/probe')) !== null }; } },
      adapterWrongSha: async () => { try { await objects.put('tenants/11/workspace-checkpoints/run-synthetic/g9/probe/manifest.json', text('x'), { sha256: await sha256Hex(text('y')) }); return {}; } catch (e) { return { thrown: e.code }; } },
      list: async () => (await objects.list('tenants/11/workspace-checkpoints/run-synthetic/')).map(o => o.key),
    };
    try { return Response.json(await ops[op]()); } catch (e) { return Response.json({ thrown: e?.code ?? 'error' }); }
  }
}
export default { fetch(req, env) { return env.CHECKPOINT.get(env.CHECKPOINT.idFromName('run-synthetic')).fetch(req); } };`;

async function runtime(persist) {
  const bundled = await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: 'checkpoint-fixture.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ name: 'checkpoint-fixture', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-11-08',
    durableObjects: { CHECKPOINT: { className: 'TestCheckpoint', useSQLite: true, unsafeUniqueKey: DO_INSTANCE_NAME } }, r2Buckets: { CHECKPOINTS: BUCKET_NAME } }), resourcePersistencePath: persist });
  return { close: () => mf.dispose(), call: async (op, args = {}, now = 1000) => {
    const r = await mf.dispatchFetch('https://test', { method: 'POST', body: JSON.stringify({ op, args, now }) });
    assert.equal(r.status, 200, await r.clone().text()); return r.json();
  } };
}
const ok = (r) => { assert.equal(r?.ok, true, JSON.stringify(r)); return r.value; };
const code = (r) => r?.code ?? r?.thrown;

test('durable pointer store and R2 adapter: commit, restart, D5565 generation fence, rollback, refusals, fenced delete and GC', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkpoint-5568-'));
  let r;
  try {
    r = await runtime(dir);
    const [runnerReg, pointerReg] = await r.call('register');
    ok(runnerReg); ok(pointerReg);
    assert.equal(ok(await r.call('commit', { token: 'cp-1', content: 'one\n' })).sequence, 1);
    const racing = await Promise.all([2, 3, 4, 5, 6].map(n => r.call('commit', { token: `cp-${n}`, content: `race ${n}\n` })));
    const won = racing.filter(x => x.ok), lost = racing.filter(x => !x.ok);
    assert.ok(won.length >= 1, 'at least one racer commits');
    for (const x of lost) assert.equal(code(x), 'checkpoint_conflict', 'a racer that lost the head refuses; it never overwrites');
    assert.deepEqual(won.map(x => x.value.sequence).sort(), won.map((_, i) => i + 2), 'one acknowledged checkpoint per sequence');
    const acked = 1 + won.length;

    await r.close(); r = await runtime(dir);
    let head = await r.call('head');
    assert.equal(head.head.sequence, acked, 'the pointer survives a runtime restart'); assert.equal(head.generation, 1);
    const ackedContent = ok(await r.call('restore')).content;
    assert.match(ackedContent, /^(one|race \d)\n$/);

    // runner generation bump fences: D5565 cancel bumps the runner generation; no checkpoint fence() is called.
    assert.equal(ok(await r.call('cancel', { expected: 1 })).execution_generation, 2);
    assert.equal(code(await r.call('commit', { token: 'cp-stale', content: 'stale\n' })), 'stale_generation');
    head = await r.call('head');
    assert.equal(head.generation, 2, 'the pointer took the runner generation in the same storage'); assert.equal(head.head.sequence, acked);
    assert.equal(code(await r.call('restore')), 'stale_generation', 'the old attempt cannot restore either');
    assert.deepEqual(ok(await r.call('restore', { generation: 2 })), { sequence: acked, content: ackedContent }, 'the next attempt restores the last acknowledged checkpoint');

    assert.equal(await r.call('rollback', { generation: 2 }), 2, 'a throwing change rolls back');
    assert.equal(code(await r.call('regress')), 'stale_generation');
    const [soloReg, soloFence, lowered, soloGen] = await r.call('regressNoRunner');
    ok(soloReg); ok(soloFence);
    assert.deepEqual([lowered, soloGen], [{ thrown: 'stale_generation' }, 3], 'with no runner record, a lowered generation is still refused');
    assert.equal(code(await r.call('async')), 'transaction_must_be_synchronous');
    assert.equal(code(await r.call('removeRow')), 'checkpoint_pointer_removed');
    assert.equal(code(await r.call('registerForeign')), 'tenant_mismatch', 'a row for another tenant beside this run is refused');
    assert.equal((await r.call('head')).generation, 2, 'every refusal above left the row unchanged');

    assert.deepEqual(await r.call('deleteHead'), { thrown: 'stale_gc', still_there: true }, 'the acknowledged head is never deleted');
    const listedBefore = await r.call('list');
    const gc = await r.call('gc', {}, 5000);
    ok(gc.result);
    assert.ok(gc.plan.length > 0 && gc.plan.every(k => listedBefore.includes(k)));
    const listedAfter = await r.call('list');
    assert.ok(gc.plan.every(k => !listedAfter.includes(k)), 'planned objects deleted from R2');
    assert.deepEqual(ok(await r.call('restore', { generation: 2 })), { sequence: acked, content: ackedContent }, 'the head still restores after GC');

    assert.deepEqual(await r.call('rawWrongSha'), { stored: false }, 'R2 itself refuses a put whose sha256 does not match');
    assert.deepEqual(await r.call('adapterWrongSha'), { thrown: 'checksum_mismatch' });
  } finally { await r?.close(); rmSync(dir, { recursive: true, force: true }); }
});
