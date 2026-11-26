/**
 * D5586 part 2 (#5586): the audited swarm admission hosted in a real SQLite Durable Object (#5570's Miniflare
 * harness, `workspace_admission_store_5570.test.mjs`) with a real D1 holding `swarm_admission_events`. It round-trips
 * request, settle and a venture's snapshot through the object, copies the audit to D1 after each change, survives a
 * runtime restart, and after a D1 failure keeps the entries in the object's storage until the next call copies them.
 *
 *   node --test cloudflare-worker/test/swarm_audit_do_5586_p2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// The Durable Object's instance label in Miniflare (a fixture label).
const DO_LABEL = 'swarm-audit-5586';
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
import { DurableWorkspaceAdmissionStore } from './cloudflare-worker/src/services/agents/workspaceAdmissionStore.ts';
import { createAdmissionControl } from './cloudflare-worker/src/services/agents/workspaceAdmission.ts';
import { createAuditedSwarmAdmission } from './cloudflare-worker/src/services/agents/swarmAudit.ts';
const fail = { batch: 0 };
export class TestSwarm {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const { op, args = [], now = 1000 } = await req.json();
    if (op === 'failD1') { fail.batch = args[0]; return Response.json(true); }
    const store = new DurableWorkspaceAdmissionStore(this.state.storage);
    const db = { prepare: s => this.env.DB.prepare(s), batch: st => { if (fail.batch > 0) { fail.batch--; return Promise.reject(new Error('D1 down')); } return this.env.DB.batch(st); } };
    const admission = createAdmissionControl({ store, clock: () => now, limits: { halted: false, lease_ms: 60000, per_tenant_running: 5, per_tenant_waiting: 10,
      max_waiting: 10, per_provider_running: { cloudflare: 5 }, per_region_running: { 'cloudflare:weur': 5 } },
      observe: async () => ({ state: 'unknown', measured_microusd: 'unavailable' }) });
    const flushes = [];
    const swarm = createAuditedSwarmAdmission({ store, clock: () => now, admission, db, onFlush: r => flushes.push(r) });
    if (op === 'raw') return Response.json(await store.transaction(s => s.swarm ?? null));
    const value = await swarm[op](...args);
    return Response.json({ value, flushes });
  }
}
export default { fetch(req, env) { return env.SWARM.get(env.SWARM.idFromName('shared-quotas')).fetch(req); } };`,
  resolveDir: root, sourcefile: 'swarm-audit-fixture.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ name: 'swarm-audit-fixture', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-11-08',
    durableObjects: { SWARM: { className: 'TestSwarm', useSQLite: true, unsafeUniqueKey: DO_LABEL } }, d1Databases: { DB: 'swarm-audit-db' } }), resourcePersistencePath: persist });
  const DB = await mf.getD1Database('DB');
  return {
    DB,
    close: () => mf.dispose(),
    call: async (op, args = [], now = 1000) => {
      const r = await mf.dispatchFetch('https://test', { method: 'POST', body: JSON.stringify({ op, args, now }) });
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    },
  };
}

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const policy = (tenant_id, company_id) => ({ tenant_id, company_id, halted: false, max_concurrent: 4, max_waiting: 10,
  modalities: { document: { max_concurrent: 4, providers: ['cloudflare'], models: [MODEL] }, code: { max_concurrent: 2, providers: ['cloudflare'], models: [MODEL] } },
  render_budget_microusd: 1_000_000, storage_quota_bytes: 1_000_000 });
const facts = { agent: 'active', head_revision_uid: null, storage_used_bytes: 0 };
const request = (ticket_uid, tenant_id, company_id, modality = 'document') => ({ ticket_uid, tenant_id, company_id, team_id: null, agent_id: 9, modality,
  provider: 'cloudflare', model: MODEL, region: 'weur', asset_uid: `asset_${ticket_uid}`, base_revision_uid: null,
  reserve_microusd: 100, ceiling_microusd: 500, storage_bytes: 10 });
const rows = async (DB) => (await DB.prepare('SELECT tenant_id, company_id, seq, ticket_uid, action, outcome, code, charged_microusd, measured FROM swarm_admission_events ORDER BY seq').all()).results;

test('the audited swarm round-trips request, settle and a venture snapshot through a real SQLite Durable Object and D1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-audit-5586-'));
  let r;
  try {
    r = await runtime(dir);
    for (const s of statements(MIGRATION)) await r.DB.prepare(s).run();
    const a = await r.call('request', [request('run_7a', 7, 70), policy(7, 70), facts], 1000);
    assert.equal(a.value.ok, true, JSON.stringify(a));
    assert.equal(a.value.value.state, 'admitted');
    const c = await r.call('request', [request('run_7c', 7, 70, 'code'), policy(7, 70), facts], 1001);
    assert.equal(c.value.value.lease.ok, true, 'a code ticket takes #5570 lease in the same object');
    const other = await r.call('request', [request('run_8a', 8, 80), policy(7, 70), facts], 1002);
    assert.equal(other.value.code, 'wrong_tenant');
    assert.deepEqual([...a.flushes, ...c.flushes, ...other.flushes].map(f => f.ok), [true, true, true]);

    // D1 goes down: the settlement still bills once and its entry waits in the object's storage, across a restart.
    await r.call('failD1', [1]);
    const settled = await r.call('settle', ['run_7a', 42], 1003);
    assert.deepEqual(settled.value, { ok: true, value: { charged_microusd: 42, measured: true, first: true } });
    assert.equal(settled.flushes[0].code, 'audit_store_unavailable');
    assert.equal((await rows(r.DB)).length, 3);
    await r.close();
    r = await runtime(dir);
    const kept = await r.call('raw');
    assert.equal(kept.audit_flushed_seq, 3);
    assert.deepEqual(kept.audit.map(e => e.seq), [1, 2, 3, 4]);
    const replay = await r.call('settle', ['run_7a', 99], 1004);
    assert.deepEqual(replay.value.value, { charged_microusd: 42, measured: true, first: false });
    assert.deepEqual(replay.flushes[0], { ok: true, written: 1, replayed: 0, gap: null, flushed_seq: 4 });
    assert.deepEqual(await rows(r.DB), [
      { tenant_id: 7, company_id: 70, seq: 1, ticket_uid: 'run_7a', action: 'request', outcome: 'applied', code: null, charged_microusd: null, measured: null },
      { tenant_id: 7, company_id: 70, seq: 2, ticket_uid: 'run_7c', action: 'request', outcome: 'applied', code: null, charged_microusd: null, measured: null },
      { tenant_id: 8, company_id: 80, seq: 3, ticket_uid: 'run_8a', action: 'request', outcome: 'refused', code: 'wrong_tenant', charged_microusd: null, measured: null },
      { tenant_id: 7, company_id: 70, seq: 4, ticket_uid: 'run_7a', action: 'settle', outcome: 'applied', code: null, charged_microusd: 42, measured: 1 },
    ]);
    await assert.rejects(r.DB.prepare('DELETE FROM swarm_admission_events').run(), /append-only/);

    const seven = (await r.call('snapshotFor', [{ tenant_id: 7, company_id: 70 }])).value;
    assert.deepEqual(Object.keys(seven.tickets).sort(), ['run_7a', 'run_7c']);
    assert.equal(seven.tickets.run_7a.state, 'settled');
    assert.deepEqual(seven.audit.map(e => e.seq), [1, 2, 4]);
    const eight = (await r.call('snapshotFor', [{ tenant_id: 8, company_id: 80 }])).value;
    assert.deepEqual(Object.keys(eight.tickets), []);
    assert.deepEqual(eight.audit.map(e => [e.ticket_uid, e.code]), [['run_8a', 'wrong_tenant']]);
  } finally {
    await r?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
