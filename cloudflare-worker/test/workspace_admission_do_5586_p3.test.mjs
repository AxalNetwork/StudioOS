/**
 * D5586 part 3 (#5586): the `WorkspaceAdmission` Durable Object reached through its binding by the typed client
 * (`workspaceAdmissionClient.ts`), on #5570's real SQLite Durable Object harness in Miniflare with a real D1 holding
 * `swarm_admission_events`. It round-trips #5570's admission and the swarm through the binding, survives a restart,
 * refuses another venture's arguments before any stub call and another venture's uids in the object, answers
 * `admission_unbound` without a binding, and still copies the swarm audit to D1.
 *
 *   node --test cloudflare-worker/test/workspace_admission_do_5586_p3.test.mjs
 *
 * From cloudflare-worker/test/README.md (moved by #6472):
 * `workspace_admission_do_5586_p3.test.mjs` reaches the real `WorkspaceAdmission` class through
 * its binding with the typed client (Miniflare, real D1): #5570 admission and the swarm round-trip
 * across a restart, another venture refused before any stub call and inside the object,
 * `admission_unbound` without a binding, the audit still copied to D1 (D5586 part 3).
 * `workspace_admission_client_5586_p3.test.ts` covers the client without a runtime and the
 * wrangler.toml wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Instance labels in Miniflare (fixture labels).
const DO_LABEL = 'workspace-admission-5586-p3';
const root = process.cwd();
// The table as D5586-p2 created it, then D5585-p15's rebuild with the render approval codes, applied in order on D1.
const MIGRATION = ['202611252031_5586_swarm_admission_events.sql', '202611260840_5585_swarm_admission_events_render_codes.sql']
  .map((f) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8')).join('\n');

/** The migration's statements, one per `prepare`: a trigger ends at its `END;`, anything else at a line ending `;`. */
function statements(sql) {
  const out = [];
  let cur = [];
  for (const line of sql.split('\n')) {
    if (/^\s*--/.test(line) || !line.trim()) continue;
    cur.push(line);
    const body = cur.join('\n');
    if (/^CREATE TRIGGER/i.test(body) ? /^END;\s*$/.test(line) : /;\s*$/.test(line)) { out.push(body); cur = []; }
  }
  return out;
}

async function runtime(persist) {
  const bundled = await build({ stdin: { contents: `
import { WorkspaceAdmission } from './cloudflare-worker/src/durable-objects/workspace-admission.ts';
import { workspaceAdmissionClient, swarmSnapshotFor, WORKSPACE_ADMISSION_OBJECT } from './cloudflare-worker/src/services/agents/workspaceAdmissionClient.ts';
export { WorkspaceAdmission };
/** The real class with caps, since no broker record holds them yet. */
export class CappedWorkspaceAdmission extends WorkspaceAdmission {
  limits() { return { halted: false, lease_ms: 60000, per_tenant_running: 5, per_tenant_waiting: 10, max_waiting: 10,
    per_provider_running: { cloudflare: 5 }, per_region_running: { 'cloudflare:weur': 5 } }; }
}
export default { async fetch(req, env) {
  const { fn, caller, args = [], bind = 'CAPPED', raw, name } = await req.json();
  const ns = env[bind];
  if (raw) return ns.get(ns.idFromName(name ?? WORKSPACE_ADMISSION_OBJECT)).fetch('https://x/op', { method: 'POST', body: JSON.stringify(raw) });
  const stubCalls = { n: 0 };
  const counted = bind === 'NONE' ? undefined : { idFromName: n => ns.idFromName(n), get: id => { const s = ns.get(id); return { fetch: (...a) => { stubCalls.n++; return s.fetch(...a); } }; } };
  const e = { WORKSPACE_ADMISSION: counted };
  const value = fn === 'swarmSnapshotFor' ? await swarmSnapshotFor(e, caller)
    : await (([g, m]) => workspaceAdmissionClient(e, caller)[g][m](...args))(fn.split('.'));
  return Response.json({ value, stubCalls: stubCalls.n });
} };`,
  resolveDir: root, sourcefile: 'workspace-admission-fixture.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ name: 'workspace-admission-fixture', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-11-08',
    durableObjects: {
      CAPPED: { className: 'CappedWorkspaceAdmission', useSQLite: true, unsafeUniqueKey: `${DO_LABEL}-capped` },
      REAL: { className: 'WorkspaceAdmission', useSQLite: true, unsafeUniqueKey: `${DO_LABEL}-real` },
    }, d1Databases: { DB: 'workspace-admission-db' } }), resourcePersistencePath: persist });
  const DB = await mf.getD1Database('DB');
  const post = async (body) => {
    const r = await mf.dispatchFetch('https://test', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  return {
    DB, close: () => mf.dispose(), raw: (raw, name) => post({ raw, name }),
    call: (fn, caller, args = [], bind = 'CAPPED') => post({ fn, caller, args, bind }),
  };
}

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SEVEN = { tenantId: 7, companyId: 70 }, EIGHT = { tenantId: 8, companyId: 80 };
const v7 = { tenant_id: 7, company_id: 70 };
const policy = (tenant_id, company_id) => ({ tenant_id, company_id, halted: false, max_concurrent: 4, max_waiting: 10,
  modalities: { document: { max_concurrent: 4, providers: ['cloudflare'], models: [MODEL] }, code: { max_concurrent: 2, providers: ['cloudflare'], models: [MODEL] } },
  render_budget_microusd: 1_000_000, storage_quota_bytes: 1_000_000 });
const facts = { agent: 'active', head_revision_uid: null, storage_used_bytes: 0 };
const ticket = (ticket_uid, tenant_id, company_id, modality = 'document') => ({ ticket_uid, tenant_id, company_id, team_id: null, agent_id: 9, modality,
  provider: 'cloudflare', model: MODEL, region: 'weur', asset_uid: `asset_${ticket_uid}`, base_revision_uid: null,
  reserve_microusd: 100, ceiling_microusd: 500, storage_bytes: 10 });
const run = (run_uid, tenant_id) => ({ run_uid, tenant_id, agent_id: 9, provider: 'cloudflare', region: 'weur', compute_reserve_microusd: 50 });
const rows = async (DB) => (await DB.prepare('SELECT tenant_id, company_id, seq, ticket_uid, action, outcome, code, charged_microusd FROM swarm_admission_events ORDER BY seq').all()).results;

async function withRuntime(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-admission-5586-'));
  const box = { r: null };
  try {
    box.r = await runtime(dir);
    for (const s of statements(MIGRATION)) await box.r.DB.prepare(s).run();
    await fn(box, dir);
  } finally {
    await box.r?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the client round-trips #5570 admission and the swarm through the binding, across a restart, and the audit reaches D1', () => withRuntime(async (box, dir) => {
  let { r } = box;
  const doc = await r.call('swarm.request', SEVEN, [ticket('run_7a', 7, 70), policy(7, 70), facts]);
  assert.deepEqual([doc.stubCalls, doc.value.ok, doc.value.value?.state], [1, true, 'admitted'], JSON.stringify(doc));
  const code = await r.call('swarm.request', SEVEN, [ticket('run_7c', 7, 70, 'code'), policy(7, 70), facts]);
  assert.equal(code.value.value.lease.ok, true, 'a code ticket takes #5570 lease in the same object');

  const lease = await r.call('admission.request', SEVEN, [run('run_7r', 7)]);
  assert.deepEqual(lease.value, { ok: true, value: { state: 'admitted', generation: 1, lease_expires_at: lease.value.value.lease_expires_at, compute_reserve_microusd: 50, duplicate: false } });
  assert.equal(typeof lease.value.value.lease_expires_at, 'number');
  const again = await r.call('admission.request', SEVEN, [run('run_7r', 7)]);
  assert.deepEqual([again.value.value.state, again.value.value.generation, again.value.value.duplicate], ['admitted', 1, true]);
  assert.equal((await r.call('admission.settle', SEVEN, ['run_7r', 2, 9])).value.code, 'stale_generation');
  assert.deepEqual((await r.call('admission.settle', SEVEN, ['run_7r', 1, 17])).value, { ok: true, value: { charged_microusd: 17, measured: true, first: true } });
  assert.equal((await r.call('admission.settle', SEVEN, ['run_7c', 0, 1])).value.code, 'swarm_ticket', 'a swarm lease settles through the swarm');
  assert.equal((await r.call('admission.request', SEVEN, [run('run_7c', 7)])).value.code, 'swarm_ticket', 'a swarm ticket\'s uid is not a #5570 run');

  // Restart: everything above is in the object's storage.
  await r.close();
  r = box.r = await runtime(dir);
  assert.deepEqual((await r.call('admission.settle', SEVEN, ['run_7r', 1, 99])).value.value, { charged_microusd: 17, measured: true, first: false });
  assert.deepEqual((await r.call('swarm.settle', SEVEN, ['run_7a', 42])).value, { ok: true, value: { charged_microusd: 42, measured: true, first: true } });
  const waiting = await r.call('admission.request', SEVEN, [run('run_7w', 7)]);
  assert.deepEqual((await r.call('admission.withdraw', SEVEN, ['run_7w', waiting.value.value.generation])).value, { ok: true, value: { state: 'reconciling' } },
    'an admitted run that is cancelled reconciles and keeps its slot; nothing is billed');
  const revoked = await r.call('swarm.revoke', SEVEN, [v7, 9]);
  assert.deepEqual(revoked.value, { ok: true, value: { withdrawn: [], still_running: ['run_7c'] } });
  assert.deepEqual((await r.call('swarm.promote', SEVEN, [{ 't7:c70': { policy: policy(7, 70), storage_used_bytes: 0 } }])).value, { ok: true, value: [] });

  const snap = await r.call('swarmSnapshotFor', SEVEN);
  assert.equal(snap.value.ok, true);
  assert.deepEqual(Object.keys(snap.value.value.tickets).sort(), ['run_7a', 'run_7c']);
  assert.equal(snap.value.value.tickets.run_7a.state, 'settled');
  assert.deepEqual(snap.value.value.audit.map(e => [e.seq, e.action]), [[1, 'request'], [2, 'request'], [3, 'settle']]);
  assert.deepEqual(await rows(r.DB), [
    { tenant_id: 7, company_id: 70, seq: 1, ticket_uid: 'run_7a', action: 'request', outcome: 'applied', code: null, charged_microusd: null },
    { tenant_id: 7, company_id: 70, seq: 2, ticket_uid: 'run_7c', action: 'request', outcome: 'applied', code: null, charged_microusd: null },
    { tenant_id: 7, company_id: 70, seq: 3, ticket_uid: 'run_7a', action: 'settle', outcome: 'applied', code: null, charged_microusd: 42 },
  ], 'the audit copy still flushes to D1 through the bound object');
}));

test('another venture is refused: its arguments before any stub call, its uids inside the object', () => withRuntime(async ({ r }) => {
  await r.call('swarm.request', SEVEN, [ticket('run_7a', 7, 70), policy(7, 70), facts]);
  await r.call('admission.request', SEVEN, [run('run_7r', 7)]);
  const key7 = { 't7:c70': { policy: policy(7, 70), storage_used_bytes: 0 } };
  for (const [fn, args] of [
    ['swarm.snapshotFor', [v7]], ['swarm.request', [ticket('run_8x', 7, 70), policy(7, 70), facts]],
    ['swarm.request', [ticket('run_8x', 8, 80), policy(7, 70), facts]], ['admission.request', [run('run_8r', 7)]],
    ['swarm.withdraw', ['run_7a', v7]], ['swarm.revoke', [v7, 9]], ['swarm.promote', [key7]],
  ]) {
    const out = await r.call(fn, EIGHT, args);
    assert.deepEqual([out.stubCalls, out.value.ok, out.value.code, out.value.status], [0, false, 'wrong_tenant', 403], `${fn} ${JSON.stringify(args)}`);
  }
  // Keyed only by a uid: the object refuses another venture's lease or ticket as if it did not exist.
  for (const [fn, args, code] of [['swarm.settle', ['run_7a', 1], 'ticket_not_found'], ['admission.settle', ['run_7r', 1, 1], 'lease_not_found'],
    ['admission.withdraw', ['run_7r', 1], 'lease_not_found']]) {
    const out = await r.call(fn, EIGHT, args);
    assert.deepEqual([out.stubCalls, out.value.code, out.value.status], [1, code, 403], fn);
  }
  // The object applies the venture check itself, and answers only to its one name.
  assert.equal((await r.raw({ op: 'swarm.snapshotFor', caller: EIGHT, args: [v7] })).code, 'wrong_tenant');
  assert.equal((await r.raw({ op: 'swarm.snapshotFor', caller: EIGHT, args: [{ tenant_id: 8, company_id: 80 }] }, 'tenant-8')).code, 'wrong_coordinator');
  const eight = await r.call('swarmSnapshotFor', EIGHT);
  assert.deepEqual([Object.keys(eight.value.value.tickets), eight.value.value.audit], [[], []], 'nothing of venture 7');
  const seven = await r.call('swarmSnapshotFor', SEVEN);
  assert.deepEqual(Object.keys(seven.value.value.tickets), ['run_7a'], 'venture 7 untouched by the refused calls');
}));

test('without a binding every call answers admission_unbound; the real class admits no compute lease without caps', () => withRuntime(async ({ r }) => {
  for (const [fn, args] of [['admission.request', [run('run_7r', 7)]], ['admission.settle', ['run_7r', 1, 1]], ['admission.withdraw', ['run_7r', 1]],
    ['swarm.request', [ticket('run_7a', 7, 70), policy(7, 70), facts]], ['swarm.promote', [{}]], ['swarm.settle', ['run_7a', 1]],
    ['swarm.withdraw', ['run_7a', v7]], ['swarm.revoke', [v7, 9]], ['swarm.snapshotFor', [v7]], ['swarmSnapshotFor', []]]) {
    const out = await r.call(fn, SEVEN, args, 'NONE');
    assert.deepEqual(out.value, { ok: false, status: 503, code: 'admission_unbound', message: out.value.message, reasons: ['admission_unbound'] }, fn);
  }
  const real = await r.call('admission.request', SEVEN, [run('run_7r', 7)], 'REAL');
  assert.deepEqual([real.value.ok, real.value.value.state, real.value.value.generation], [true, 'waiting', 0]);
}));
