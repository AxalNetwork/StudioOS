/**
 * D5586 part 2 (#5586): the swarm audit copied to D1's append-only `swarm_admission_events` — the table refuses
 * UPDATE, DELETE and an unknown code, the copy is replay-safe by `seq`, a D1 failure loses nothing and admits nothing,
 * dropped entries become a recorded gap, and every read is one venture's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/swarm_audit_5586_p2.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { SWARM_AUDIT_MAX, swarmOf } from '../src/services/agents/swarmAdmission.ts';
import { SWARM_AUDIT_ACTIONS, SWARM_AUDIT_CODES, SWARM_AUDIT_OUTCOMES, createAuditedSwarmAdmission, flushSwarmAudit,
  readSwarmAdmissionEvents, scopedSwarmState, type FlushResult } from '../src/services/agents/swarmAudit.ts';
import { V7, V8, facts, ok, policy, refused, request, swarmWorld } from './_swarm_world_5586.ts';

const migration = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
// The table's current definition: D5585-p15 rebuilt it with the render approval codes. The schema applies both files
// in order, as a deploy does; the vocabulary is read from the rebuild, the table's definition now.
const SQL = migration('202611260840_5585_swarm_admission_events_render_codes.sql');
const SCHEMA = migration('202611252031_5586_swarm_admission_events.sql') + SQL;
const SOURCE = readFileSync(new URL('../src/services/agents/swarmAdmission.ts', import.meta.url), 'utf8');
const CTX7 = { scope: { tenantId: 7, companyId: 70, projectId: null } };
const SCOPE7 = { tenantId: 7, companyId: 70, projectId: null };
const SCOPE8 = { tenantId: 8, companyId: 80, projectId: null };

function d1() {
  const { DB, db } = makeD1(SCHEMA);
  const fail = { batch: 0 };
  const wrapped = { prepare: (s: string) => DB.prepare(s), batch: async (st: unknown[]) => { if (fail.batch > 0) { fail.batch--; throw new Error('D1 down'); } return DB.batch(st); } };
  const rows = () => db.prepare('SELECT * FROM swarm_admission_events ORDER BY seq').all() as Record<string, unknown>[];
  return { DB: wrapped as any, raw: DB, db, fail, rows };
}
function audited(patch = {}) {
  const w = swarmWorld(patch);
  const store = d1();
  const flushes: FlushResult[] = [];
  const swarm = createAuditedSwarmAdmission({ store: w.store, clock: () => w.clock.now, admission: w.admission, halted: () => w.kill.on, db: store.DB, onFlush: r => flushes.push(r) });
  return { ...w, d: store, audited: swarm, flushes };
}
const row = (patch: Record<string, unknown> = {}) => ({ tenant_id: 7, company_id: 70, seq: 1, at: 1, ticket_uid: 'run_x', action: 'request', outcome: 'applied',
  code: null, charged_microusd: null, measured: null, gap_to_seq: null, ...patch });
const insert = (db: any, r: Record<string, unknown>) => db.prepare(`INSERT INTO swarm_admission_events (${Object.keys(r).join(', ')}) VALUES (${Object.keys(r).map(() => '?').join(', ')})`).run(...Object.values(r));

test('the table is append-only and accepts only the audit vocabulary', () => {
  const { db } = d1();
  insert(db, row());
  assert.throws(() => db.prepare('UPDATE swarm_admission_events SET code = ? WHERE seq = 1').run('stale_revision'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM swarm_admission_events').run(), /append-only/);
  assert.throws(() => insert(db, row()), /UNIQUE|PRIMARY/, 'the same (tenant, company, seq) lands once');
  insert(db, row({ tenant_id: 8, company_id: 80 }));
  for (const code of SWARM_AUDIT_CODES.filter(c => c !== 'audit_dropped')) insert(db, row({ seq: 10 + SWARM_AUDIT_CODES.indexOf(code), outcome: 'refused', code }));
  assert.throws(() => insert(db, row({ seq: 50, outcome: 'refused', code: 'made_up' })), /CHECK/);
  assert.throws(() => insert(db, row({ seq: 51, outcome: 'refused' })), /CHECK/, 'a refusal names its code');
  assert.throws(() => insert(db, row({ seq: 52, action: 'nudge' })), /CHECK/);
  assert.throws(() => insert(db, row({ seq: 53, outcome: 'maybe' })), /CHECK/);
  assert.throws(() => insert(db, row({ seq: 54, action: 'settle' })), /CHECK/, 'a settlement carries its bill');
  assert.throws(() => insert(db, row({ seq: 55, charged_microusd: 5, measured: 1 })), /CHECK/, 'only a settlement carries a bill');
  insert(db, row({ seq: 56, action: 'settle', charged_microusd: 5, measured: 0 }));
  assert.throws(() => insert(db, row({ seq: 57, tenant_id: 0, company_id: 0 })), /CHECK/, 'only a gap row has no venture');
  assert.throws(() => insert(db, row({ seq: 58, action: 'audit_gap', outcome: 'dropped', code: 'audit_dropped', gap_to_seq: 60 })), /CHECK/, 'a gap row has no venture');
  assert.throws(() => insert(db, row({ seq: 58, ticket_uid: null, action: 'audit_gap', outcome: 'dropped', code: 'audit_dropped', gap_to_seq: 60 })), /CHECK/, 'a gap row with no ticket still has no venture');
  assert.throws(() => insert(db, row({ seq: 59, tenant_id: 0, company_id: 0, ticket_uid: null, action: 'audit_gap', outcome: 'dropped', code: 'audit_dropped', gap_to_seq: 58 })), /CHECK/);
  insert(db, row({ seq: 61, tenant_id: 0, company_id: 0, ticket_uid: null, action: 'audit_gap', outcome: 'dropped', code: 'audit_dropped', gap_to_seq: 61 }));
});

test('the CHECK lists are swarmAdmission.ts\'s vocabulary', () => {
  const written = new Set([...SOURCE.matchAll(/no\('([a-z_]+)'/g), ...SOURCE.matchAll(/reasons\.push\('([a-z_]+)'\)/g), ...SOURCE.matchAll(/'revoke', 'applied', '([a-z_]+)'/g)].map(m => m[1]));
  for (const c of ['budget_unverified', 'budget_exhausted', 'storage_unverified', 'storage_quota_exhausted']) assert.ok(SOURCE.includes(`refuse('${c}'`), c);
  for (const c of written) assert.ok((SWARM_AUDIT_CODES as readonly string[]).includes(c), `${c} is missing from SWARM_AUDIT_CODES`);
  const CHECK_LISTS = {
    code: /code TEXT[^,]*?IN \(([^)]*)\)/s,
    action: /action TEXT[^,]*?IN \(([^)]*)\)/s,
    outcome: /outcome TEXT[^,]*?IN \(([^)]*)\)/s,
  } as const;
  const listed = (col: keyof typeof CHECK_LISTS) => [...(SQL.match(CHECK_LISTS[col])?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual(listed('code'), [...SWARM_AUDIT_CODES]);
  assert.deepEqual(listed('action'), [...SWARM_AUDIT_ACTIONS]);
  assert.deepEqual(listed('outcome'), [...SWARM_AUDIT_OUTCOMES]);
  const type = SOURCE.match(/SwarmAuditAction = ([^;]+);/)![1];
  assert.deepEqual([...type.matchAll(/'([a-z_]+)'/g)].map(m => m[1]), SWARM_AUDIT_ACTIONS.filter(a => a !== 'audit_gap'));
});

test('every change is copied by seq, once, refusals and bills included; a replay writes nothing', async () => {
  const w = audited();
  const p = policy(V7);
  const a = ok(await w.audited.request(request(V7, 'document', { ticket_uid: 'run_doc_1' }), p, facts()));
  assert.equal(a.state, 'admitted');
  refused(await w.audited.request(request(V7, 'document', { ticket_uid: 'run_doc_2' }), p, facts({ head_revision_uid: 'other' })), 'stale_revision');
  ok(await w.audited.settle('run_doc_1', 321));
  const rows = w.d.rows();
  assert.deepEqual(rows.map(r => [r.seq, r.action, r.outcome, r.code, r.charged_microusd, r.measured, r.ticket_uid]), [
    [1, 'request', 'applied', null, null, null, 'run_doc_1'],
    [2, 'request', 'refused', 'stale_revision', null, null, 'run_doc_2'],
    [3, 'settle', 'applied', null, 321, 1, 'run_doc_1'],
  ]);
  assert.ok(rows.every(r => r.tenant_id === 7 && r.company_id === 70));
  assert.deepEqual(w.flushes.map(f => f.ok && f.written), [1, 1, 1]);
  assert.equal(swarmOf(w.store.peek()).audit_flushed_seq, 3);
  // A crash after the D1 write and before the watermark moved: the next copy replays the same rows and writes none.
  await w.store.transaction(s => { swarmOf(s).audit_flushed_seq = 0; });
  const again = await flushSwarmAudit(w.store, w.d.DB);
  assert.deepEqual(again, { ok: true, written: 0, replayed: 3, gap: null, flushed_seq: 3 });
  assert.equal(w.d.rows().length, 3);
  // Two copies racing over the same entries both land them once.
  ok(await w.swarm.request(request(V7, 'document', { ticket_uid: 'run_doc_3' }), p, facts()));
  const both = await Promise.all([flushSwarmAudit(w.store, w.d.DB), flushSwarmAudit(w.store, w.d.DB)]);
  assert.ok(both.every(b => b.ok));
  assert.equal(w.d.rows().length, 4);
  assert.equal(swarmOf(w.store.peek()).audit_flushed_seq, 4);
  // A slow copy that finishes after a faster one never lowers the watermark.
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let entered!: () => void;
  const inBatch = new Promise<void>(r => { entered = r; });
  const slow = { prepare: (q: string) => w.d.DB.prepare(q), batch: async (st: unknown[]) => { entered(); await gate; return w.d.DB.batch(st); } };
  ok(await w.swarm.request(request(V7, 'document', { ticket_uid: 'run_doc_4' }), p, facts()));
  const late = flushSwarmAudit(w.store, slow as any);
  await inBatch;
  ok(await w.swarm.request(request(V7, 'document', { ticket_uid: 'run_doc_5' }), p, facts()));
  assert.equal((await flushSwarmAudit(w.store, w.d.DB)).flushed_seq, 6);
  release();
  assert.deepEqual(await late, { ok: true, written: 0, replayed: 1, gap: null, flushed_seq: 6 }, 'it does not step back and copy seq 6 again');
  assert.equal(swarmOf(w.store.peek()).audit_flushed_seq, 6);
});

test('a row that disagrees with its entry stops the copy below it', async () => {
  const w = audited();
  insert(w.d.db, row({ seq: 2, ticket_uid: 'someone_else' }));
  ok(await w.swarm.request(request(V7, 'document', { ticket_uid: 'run_a' }), policy(V7), facts()));
  ok(await w.swarm.request(request(V7, 'document', { ticket_uid: 'run_b' }), policy(V7), facts()));
  ok(await w.swarm.request(request(V7, 'document', { ticket_uid: 'run_c' }), policy(V7), facts()));
  const r = await flushSwarmAudit(w.store, w.d.DB);
  assert.deepEqual(r, { ok: false, code: 'audit_conflict', flushed_seq: 1, seq: 2 });
  assert.equal(swarmOf(w.store.peek()).audit_flushed_seq, 1);
  assert.equal((await flushSwarmAudit(w.store, w.d.DB)).ok, false, 'it never skips the disagreeing entry');
});

test('a D1 failure loses nothing and admits nothing; the next call copies what was left', async () => {
  const w = audited();
  const p = policy(V7, { max_concurrent: 1 });
  w.d.fail.batch = 2;
  const first = ok(await w.audited.request(request(V7, 'document', { ticket_uid: 'run_1' }), p, facts()));
  const second = ok(await w.audited.request(request(V7, 'document', { ticket_uid: 'run_2' }), p, facts()));
  assert.equal(first.state, 'admitted');
  assert.equal(second.state, 'waiting', 'a failed copy does not change what admission decided');
  assert.deepEqual(w.flushes.map(f => f.ok ? 'ok' : f.code), ['audit_store_unavailable', 'audit_store_unavailable']);
  assert.equal(w.d.rows().length, 0);
  const sw = swarmOf(w.store.peek());
  assert.equal(sw.audit.length, 2, 'the entries stay in state');
  assert.equal(sw.audit_flushed_seq ?? 0, 0);
  assert.deepEqual(Object.values(sw.tickets).map(t => t.state), ['admitted', 'waiting']);
  ok(await w.audited.settle('run_1', 10));
  assert.deepEqual(w.d.rows().map(r => r.seq), [1, 2, 3]);
  assert.equal(swarmOf(w.store.peek()).audit_flushed_seq, 3);
});

test('entries the bounded state dropped before the copy become one recorded gap', async () => {
  const w = audited();
  await w.store.transaction(s => {
    const sw = swarmOf(s);
    sw.last_now = 5;
    for (let i = 1; i <= SWARM_AUDIT_MAX + 30; i++) sw.audit.push({ seq: i, at: 5, ticket_uid: `run_${i}`, ...V7, action: 'request', outcome: 'refused', code: 'no_capacity' });
    sw.audit_seq = SWARM_AUDIT_MAX + 30;
    sw.audit.splice(0, 30);
    sw.audit_dropped = 30;
  });
  const r = await flushSwarmAudit(w.store, w.d.DB);
  assert.ok(r.ok);
  assert.deepEqual(r.gap, { from_seq: 1, to_seq: 30 });
  assert.equal(r.written, SWARM_AUDIT_MAX + 1);
  const rows = w.d.rows();
  assert.deepEqual([rows[0].action, rows[0].seq, rows[0].gap_to_seq, rows[0].tenant_id], ['audit_gap', 1, 30, 0]);
  assert.equal(rows[1].seq, 31);
  assert.equal(rows.length, SWARM_AUDIT_MAX + 1);
  assert.equal(r.flushed_seq, SWARM_AUDIT_MAX + 30);
  const replay = await flushSwarmAudit(w.store, w.d.DB);
  assert.deepEqual(replay, { ok: true, written: 0, replayed: 0, gap: null, flushed_seq: SWARM_AUDIT_MAX + 30 });
});

test('a venture reads only its own tickets, refusals and copied rows', async () => {
  const w = audited();
  ok(await w.audited.request(request(V7, 'document', { ticket_uid: 'run_7a' }), policy(V7), facts()));
  refused(await w.audited.request(request(V8, 'document', { ticket_uid: 'run_8a' }), policy(V8), facts({ agent: 'revoked' })), 'agent_revoked');
  ok(await w.audited.request(request(V8, 'code', { ticket_uid: 'run_8b' }), policy(V8), facts()));
  refused(await w.audited.request(request(V7, 'document', { ticket_uid: 'run_7b' }), policy(V8), facts()), 'wrong_tenant');
  const mine = await w.audited.snapshotFor(V7);
  assert.deepEqual(Object.keys(mine.tickets), ['run_7a']);
  assert.deepEqual(mine.audit.map(e => [e.ticket_uid, e.code]), [['run_7a', null], ['run_7b', 'wrong_tenant']]);
  const theirs = await w.audited.snapshotFor(V8);
  assert.deepEqual(Object.keys(theirs.tickets), ['run_8b']);
  assert.deepEqual(theirs.audit.map(e => [e.ticket_uid, e.code]), [['run_8a', 'agent_revoked'], ['run_8b', null]]);
  assert.equal(scopedSwarmState(swarmOf(w.store.peek()), { tenant_id: 7, company_id: 80 }).audit.length, 0, 'tenant and company together');
  insert(w.d.db, row({ company_id: 71, seq: 999, ticket_uid: 'run_7a' }));
  const env = { DB: w.d.raw };
  const seven = await readSwarmAdmissionEvents(env as any, CTX7, SCOPE7);
  assert.ok(seven.ok);
  assert.deepEqual(seven.events.map(e => e.ticket_uid), ['run_7a', 'run_7b']);
  const some = await readSwarmAdmissionEvents(env as any, CTX7, SCOPE7, { ticket_uids: ['run_7b', 'run_8a'] });
  assert.ok(some.ok);
  assert.deepEqual(some.events.map(e => [e.ticket_uid, e.code]), [['run_7b', 'wrong_tenant']]);
  let statements = 0;
  const counted = { DB: { prepare: (s: string) => { statements++; return w.d.raw.prepare(s); } } };
  assert.deepEqual(await readSwarmAdmissionEvents(counted as any, CTX7, SCOPE8), { ok: false, code: 'wrong_tenant' });
  assert.equal(statements, 0, 'refused before any statement');
  assert.deepEqual(await readSwarmAdmissionEvents(counted as any, CTX7, { tenantId: 0, companyId: 70, projectId: null }), { ok: false, code: 'malformed' });
  const down = { DB: { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('D1 down'); } }) }) } };
  assert.deepEqual(await readSwarmAdmissionEvents(down as any, CTX7, SCOPE7), { ok: false, code: 'unavailable' });
});
