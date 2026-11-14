/**
 * D5581 part 2 (#5581): WorkGraph leases — the `WorkGraphLease` Durable Object and `services/workGraphLeases.ts`.
 *
 * The object is the real class over a storage map that outlives its instance, so `crash(name)` (an eviction, a
 * crash or a deploy) builds a new instance over the same storage, the way the platform does. The audit runs on a
 * real SQLite database built from the migration file itself. The clock is mocked (`mock.timers`, Date only).
 *
 * Mutations checked (each applied alone, the file run, then reverted; the tests that turned red):
 *   - the next fence `state.fence + 1` → `1`: 3, 4, 5, 7, 12.
 *   - the object's `storage.put` removed (a crash forgets everything): 1–7 and 10–13.
 *   - `whole` no longer covers every unit, or the segment's `sectionId` rule removed: 6.
 *   - `sameHolder` always true: 2, 3, 7, 10.
 *   - the service's `sameTenant` check removed, the object's key-of-the-body check removed, or the object's
 *     bound-key check removed: 8 (each one alone).
 *   - `leasesOn` always true: 9, 13.
 *   - assertFence's capability check forced true: 10.  Its unit match removed: 7, 10.
 *   - the object's `serial` chain removed: 11 (two winners).
 *   - expiry never seen (`expiresAt <= now - 1e9`): 2, 4, 5, 7, 12, 13.
 *   - the TTL ceiling removed: 1.
 *   - the expiry rows dropped from the audit: 12, 13.  The UPDATE trigger made a no-op: 12.
 *   - `cost.storageWrites += 1` removed: 13.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { WorkGraphLease } from '../src/durable-objects/work-graph-lease.ts';
import {
  LEASE_STATE_KEY, LEASE_TTL_MAX_MS, LEASE_TTL_MIN_MS, acquireLease, assertFence, leaseKey, releaseLease, renewLease,
  unitsOverlap, type LeaseHolder, type LeaseResource, type WriteCapability,
} from '../src/services/workGraphLeases.ts';
import { BINDINGS } from '../src/services/topology.ts';
import { parseToml } from '../../scripts/lib/branchConfig.mjs';
import { missingFromProduction } from '../../scripts/check-wrangler-binding-parity.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const MIGRATION = 'cloudflare-worker/sql/migrations/202611140122_5581_work_graph_lease_events.sql';

// ── fakes ────────────────────────────────────────────────────────────────────

function leaseNamespace(envFlag = 'on') {
  const stores = new Map<string, Map<string, unknown>>();
  const alarms = new Map<string, number | null>();
  const instances = new Map<string, WorkGraphLease>();
  const storageFor = (name: string) => {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return {
      get: async (k: string) => (m!.has(k) ? structuredClone(m!.get(k)) : undefined),
      put: async (k: string, v: unknown) => { m!.set(k, structuredClone(v)); },
      setAlarm: async (at: number) => { alarms.set(name, at); },
      deleteAlarm: async () => { alarms.set(name, null); },
    };
  };
  const env = { WORK_GRAPH_LEASES: envFlag } as any;
  const instance = (name: string) => {
    let o = instances.get(name);
    if (!o) { o = new WorkGraphLease({ id: { name }, storage: storageFor(name) } as any, env); instances.set(name, o); }
    return o;
  };
  const ns: any = {
    idFromName: (name: string) => ({ name, toString: () => name }),
    get: (id: { name: string }) => ({ fetch: async (url: string, init?: RequestInit) => instance(id.name).fetch(new Request(url, init)) }),
  };
  return {
    ns, stores, alarms, env, instance,
    crash: (name?: string) => { if (name) instances.delete(name); else instances.clear(); },
    stored: (name: string) => stores.get(name)?.get(LEASE_STATE_KEY) as any,
  };
}

function auditDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  return { db, DB: d1Over(db) };
}

function setup(flag = 'on') {
  const leases = leaseNamespace();
  const { db, DB } = auditDb();
  const env = { WORK_GRAPH_LEASES: flag, WORK_GRAPH_LEASE: leases.ns, DB } as any;
  return { leases, db, env };
}

const SCOPE = { tenantId: 1, companyId: 10, projectId: null };
const caller = { scope: SCOPE };
const alice: LeaseHolder = { actorKind: 'person', userId: 7 };
const bob: LeaseHolder = { actorKind: 'person', userId: 8 };
const agent: LeaseHolder = { actorKind: 'agent', agentRunId: 'run_abc' };
const res = (unit: LeaseResource['unit'], assetId = 'asset-1', scope = SCOPE): LeaseResource => ({ scope, assetId, unit });
const whole = res({ kind: 'whole', id: 'all' });
const secA = res({ kind: 'section', id: 'A' });
const secB = res({ kind: 'section', id: 'B' });
const KEY = leaseKey(SCOPE, 'asset-1');
const capFor = (holder: LeaseHolder, scope = SCOPE): WriteCapability => ({ checked: true, scope, holder });
const T0 = 1_800_000_000_000;
const clock = (t: any) => t.mock.timers.enable({ apis: ['Date'], now: T0 });
const events = (db: DatabaseSync) => db.prepare('SELECT action, fence, refusal_code, actor_user_id, agent_run_id, unit_kind, unit_id, do_calls, storage_reads, storage_writes FROM work_graph_lease_events ORDER BY id').all() as any[];

// ── tests ────────────────────────────────────────────────────────────────────

test('1. acquire grants a fence; a second holder is busy (ids only, and when it ends); a bad TTL is refused', async (t) => {
  clock(t);
  const { env } = setup();
  const a = await acquireLease(env, caller, secA, alice, 30_000);
  assert.equal(a.status, 'granted');
  assert.equal((a as any).fence, 1);
  assert.equal((a as any).expiresAt, T0 + 30_000);
  assert.equal(a.authorizes, false);
  const b = await acquireLease(env, caller, secA, bob, 30_000);
  assert.equal(b.status, 'busy');
  assert.deepEqual((b as any).heldBy, { actorKind: 'person', userId: 7 });
  assert.equal((b as any).expiresAt, T0 + 30_000);
  assert.deepEqual(Object.keys((b as any).heldBy).sort(), ['actorKind', 'userId'], 'ids only');
  for (const ttl of [LEASE_TTL_MIN_MS - 1, LEASE_TTL_MAX_MS + 1, 1.5e4 + 0.5]) {
    const r = await acquireLease(env, caller, secB, bob, ttl);
    assert.deepEqual([r.status, (r as any).code], ['refused', 'invalid_ttl'], String(ttl));
  }
  assert.equal((await acquireLease(env, caller, secB, bob, LEASE_TTL_MIN_MS)).status, 'granted');
});

test('2. renew: only the holder, only before expiry', async (t) => {
  clock(t);
  const { env } = setup();
  const a: any = await acquireLease(env, caller, secA, alice, 10_000);
  const byBob: any = await renewLease(env, caller, secA, a.fence, bob, 10_000);
  assert.deepEqual([byBob.status, byBob.code], ['refused', 'not_holder']);
  const byAgent: any = await renewLease(env, caller, secA, a.fence, agent, 10_000);
  assert.deepEqual([byAgent.status, byAgent.code], ['refused', 'not_holder']);
  t.mock.timers.tick(9_000);
  const ok: any = await renewLease(env, caller, secA, a.fence, alice, 10_000);
  assert.deepEqual([ok.status, ok.fence, ok.expiresAt], ['renewed', a.fence, T0 + 19_000]);
  t.mock.timers.tick(10_000);
  const late: any = await renewLease(env, caller, secA, a.fence, alice, 10_000);
  assert.deepEqual([late.status, late.code], ['refused', 'expired']);
});

test('3. release: only the holder; then the unit is free and the next fence is higher', async (t) => {
  clock(t);
  const { env } = setup();
  const a: any = await acquireLease(env, caller, secA, alice, 10_000);
  const byBob: any = await releaseLease(env, caller, secA, a.fence, bob);
  assert.deepEqual([byBob.status, byBob.code], ['refused', 'not_holder']);
  assert.equal((await acquireLease(env, caller, secA, bob, 10_000)).status, 'busy');
  const rel: any = await releaseLease(env, caller, secA, a.fence, alice);
  assert.deepEqual([rel.status, rel.fence], ['released', a.fence]);
  const again: any = await releaseLease(env, caller, secA, a.fence, alice);
  assert.deepEqual([again.status, again.code], ['refused', 'expired']);
  const b: any = await acquireLease(env, caller, secA, bob, 10_000);
  assert.equal(b.status, 'granted');
  assert.ok(b.fence > a.fence);
});

test('4. expiry: lazily on the next call and by the alarm; reacquiring gets a strictly higher fence', async (t) => {
  clock(t);
  const { env, leases } = setup();
  const a: any = await acquireLease(env, caller, secA, alice, 5_000);
  assert.equal(leases.alarms.get(KEY), T0 + 5_000, 'the alarm is set to the earliest expiry');
  t.mock.timers.tick(5_000);
  const b: any = await acquireLease(env, caller, secA, bob, 5_000);
  assert.equal(b.status, 'granted');
  assert.ok(b.fence > a.fence, `${b.fence} > ${a.fence}`);
  // The alarm path: expire with no call in between, then the next call hands the expiry to the audit.
  t.mock.timers.tick(5_000);
  await leases.instance(KEY).alarm();
  assert.equal(leases.stored(KEY).leases.length, 0);
  assert.equal(leases.stored(KEY).expired.length, 1);
  const c: any = await acquireLease(env, caller, secB, alice, 5_000);
  assert.ok(c.fence > b.fence);
  assert.equal(leases.stored(KEY).expired.length, 0, 'handed over once');
});

test('5. forced crash: a new instance over the same storage honours the unexpired lease and never reissues a lower fence', async (t) => {
  clock(t);
  const { env, leases } = setup();
  const fences: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r: any = await acquireLease(env, caller, secA, alice, 5_000);
    fences.push(r.fence);
    await releaseLease(env, caller, secA, r.fence, alice);
  }
  const held: any = await acquireLease(env, caller, secA, alice, 60_000);
  leases.crash(KEY);
  const busy: any = await acquireLease(env, caller, secA, bob, 5_000);
  assert.equal(busy.status, 'busy', 'the unexpired lease survives the crash');
  assert.equal((await assertFence(env, { caller, resource: secA, fence: held.fence, holder: alice, capability: capFor(alice) })).ok, true);
  t.mock.timers.tick(60_000);
  leases.crash();
  const next: any = await acquireLease(env, caller, secA, bob, 5_000);
  assert.equal(next.status, 'granted');
  assert.ok(next.fence > Math.max(...fences, held.fence), `${next.fence} after ${[...fences, held.fence]}`);
  assert.equal(leases.stored(KEY).fence, next.fence, 'the counter is in storage');
});

test('6. overlap: whole conflicts with a section; a section with its own segments; disjoint sections do not', async (t) => {
  clock(t);
  const { env } = setup();
  assert.equal((await acquireLease(env, caller, secA, alice, 10_000)).status, 'granted');
  assert.equal((await acquireLease(env, caller, secB, bob, 10_000)).status, 'granted', 'disjoint sections');
  assert.equal((await acquireLease(env, caller, whole, agent, 10_000)).status, 'busy', 'whole vs section');
  const segInA = res({ kind: 'segment', id: 's1', sectionId: 'A' });
  const segLoose = res({ kind: 'segment', id: 's2' });
  assert.equal((await acquireLease(env, caller, segInA, agent, 10_000)).status, 'busy', 'segment inside a held section');
  assert.equal((await acquireLease(env, caller, segLoose, agent, 10_000)).status, 'granted');
  assert.equal((await acquireLease(env, caller, res({ kind: 'segment', id: 's2' }), bob, 10_000)).status, 'busy', 'the same segment');
  // Another asset is another object: no conflict.
  assert.equal((await acquireLease(env, caller, res({ kind: 'whole', id: 'all' }, 'asset-2'), bob, 10_000)).status, 'granted');
  // The rule itself, both directions.
  assert.equal(unitsOverlap({ kind: 'section', id: 'A' }, { kind: 'whole', id: 'x' }), true);
  assert.equal(unitsOverlap({ kind: 'segment', id: 's', sectionId: 'B' }, { kind: 'section', id: 'A' }), false);
});

test('7. assertFence: a stale fence (expired, released or superseded), another unit or another holder is refused', async (t) => {
  clock(t);
  const { env } = setup();
  const a: any = await acquireLease(env, caller, secA, alice, 5_000);
  const cap = capFor(alice);
  assert.equal((await assertFence(env, { caller, resource: secA, fence: a.fence, holder: alice, capability: cap })).ok, true);
  const otherUnit: any = await assertFence(env, { caller, resource: secB, fence: a.fence, holder: alice, capability: cap });
  assert.deepEqual([otherUnit.ok, otherUnit.code], [false, 'stale_fence']);
  const otherHolder: any = await assertFence(env, { caller, resource: secA, fence: a.fence, holder: bob, capability: capFor(bob) });
  assert.deepEqual([otherHolder.ok, otherHolder.code], [false, 'not_holder']);
  t.mock.timers.tick(5_000);
  const b: any = await acquireLease(env, caller, secA, bob, 5_000);
  const stale: any = await assertFence(env, { caller, resource: secA, fence: a.fence, holder: alice, capability: cap });
  assert.deepEqual([stale.ok, stale.code], [false, 'stale_fence'], 'a write from the old holder after its lease expired');
  const future: any = await assertFence(env, { caller, resource: secA, fence: b.fence + 5, holder: bob, capability: capFor(bob) });
  assert.deepEqual([future.ok, future.code], [false, 'unknown_fence']);
  assert.equal((await assertFence(env, { caller, resource: secA, fence: b.fence, holder: bob, capability: capFor(bob) })).ok, true);
});

test('8. wrong tenant: the service refuses another tenant\'s caller; the object refuses a key routed to it that is not its own', async (t) => {
  clock(t);
  const { env, leases, db } = setup();
  const other = { scope: { tenantId: 2, companyId: 10, projectId: null } };
  const r: any = await acquireLease(env, other, secA, alice, 10_000);
  assert.deepEqual([r.status, r.code, r.cost.doCalls], ['refused', 'wrong_tenant', 0]);
  const otherCompany = { scope: { tenantId: 1, companyId: 11, projectId: null } };
  assert.equal(((await acquireLease(env, otherCompany, secA, alice, 10_000)) as any).code, 'wrong_tenant');
  assert.equal(events(db).at(-1).refusal_code, 'wrong_tenant', 'the refusal is audited');
  // Straight at the object: tenant 2's key sent to tenant 1's object, and a key that is not the body's own.
  await acquireLease(env, caller, secA, alice, 10_000);
  const send = (body: unknown) => leases.ns.get(leases.ns.idFromName(KEY)).fetch('https://x/op', { method: 'POST', body: JSON.stringify(body) }).then((x: Response) => x.json());
  const op = { op: 'acquire', unit: { kind: 'section', id: 'B' }, holder: bob, ttlMs: 10_000 };
  const scope2 = { tenantId: 2, companyId: 10, projectId: null };
  assert.equal((await send({ key: leaseKey(scope2, 'asset-1'), scope: scope2, assetId: 'asset-1', op })).outcome.code, 'wrong_tenant');
  assert.equal((await send({ key: KEY, scope: scope2, assetId: 'asset-1', op })).outcome.code, 'wrong_tenant');
  // An object named nothing by the platform still answers for one key only: the first it was bound to.
  const anon = new WorkGraphLease({ storage: { get: async () => ({ v: 1, key: KEY, fence: 3, leases: [], expired: [] }), put: async () => {} } } as any, { WORK_GRAPH_LEASES: 'on' } as any);
  const reply: any = await (await anon.fetch(new Request('https://x/op', { method: 'POST', body: JSON.stringify({ key: leaseKey(scope2, 'asset-1'), scope: scope2, assetId: 'asset-1', op }) }))).json();
  assert.equal(reply.outcome.code, 'wrong_tenant');
});

test('9. flag off (the default): the service and the object refuse, and nothing is stored', async (t) => {
  clock(t);
  for (const flag of [undefined, 'off', 'true', 'ON']) {
    const { env, leases, db } = setup();
    if (flag === undefined) delete env.WORK_GRAPH_LEASES; else env.WORK_GRAPH_LEASES = flag;
    const r: any = await acquireLease(env, caller, secA, alice, 10_000);
    assert.deepEqual([r.status, r.code, r.cost.doCalls], ['refused', 'flag_off', 0], String(flag));
    assert.equal(leases.stores.size, 0);
    assert.equal(events(db)[0].refusal_code, 'flag_off');
  }
  const off = leaseNamespace('off');
  const reply: any = await off.ns.get(off.ns.idFromName(KEY)).fetch('https://x/op', { method: 'POST', body: JSON.stringify({ key: KEY, scope: SCOPE, assetId: 'asset-1', op: { op: 'acquire', unit: secA.unit, holder: alice, ttlMs: 10_000 } }) }).then((x: Response) => x.json());
  assert.equal(reply.outcome.code, 'flag_off');
  assert.equal(off.stored(KEY), undefined, 'nothing stored');
  // wrangler.toml: off in all three tables.
  const { sections } = parseToml(readFileSync('wrangler.toml', 'utf8'));
  for (const prefix of ['', 'env.production.', 'env.preview.']) {
    const vars = sections.find((x: any) => x.name === `${prefix}vars`);
    assert.equal(vars.kv.get('WORK_GRAPH_LEASES'), '"off"', prefix || 'top');
  }
});

test('10. a lease is not authorization: assertFence refuses a live fence without a capability, and a capability without a fence', async (t) => {
  clock(t);
  const { env } = setup();
  const a: any = await acquireLease(env, caller, secA, alice, 10_000);
  assert.equal(a.authorizes, false, 'acquire grants nothing');
  for (const capability of [null, undefined, { checked: false, scope: SCOPE, holder: alice } as any, capFor(bob), capFor(alice, { tenantId: 9, companyId: 10, projectId: null })]) {
    const r: any = await assertFence(env, { caller, resource: secA, fence: a.fence, holder: alice, capability });
    assert.deepEqual([r.ok, r.code, r.cost.doCalls], [false, 'no_capability', 0], JSON.stringify(capability));
  }
  const noLease: any = await assertFence(env, { caller, resource: secB, fence: a.fence, holder: alice, capability: capFor(alice) });
  assert.equal(noLease.ok, false, 'a capability without the unit\'s lease');
  const both: any = await assertFence(env, { caller, resource: secA, fence: a.fence, holder: alice, capability: capFor(alice) });
  assert.deepEqual([both.ok, both.authorizes], [true, false], 'even then the lease authorizes nothing; the capability did');
  // Acquire takes no capability: coordination is independent of authorization.
  assert.equal(acquireLease.length, 5);
});

test('11. concurrent acquires of one unit: exactly one winner', async (t) => {
  clock(t);
  const { env } = setup();
  const holders: LeaseHolder[] = Array.from({ length: 8 }, (_, i) => ({ actorKind: 'person', userId: 100 + i }));
  const out: any[] = await Promise.all(holders.map((h) => acquireLease(env, caller, secA, h, 10_000)));
  assert.equal(out.filter((r) => r.status === 'granted').length, 1);
  assert.equal(out.filter((r) => r.status === 'busy').length, 7);
});

test('12. the audit: every outcome is a row, with ids only, and the table is append-only', async (t) => {
  clock(t);
  const { env, db } = setup();
  const a: any = await acquireLease(env, caller, secA, alice, 5_000);
  await acquireLease(env, caller, secA, agent, 5_000);
  await renewLease(env, caller, secA, a.fence, alice, 5_000);
  t.mock.timers.tick(5_000);
  const b: any = await acquireLease(env, caller, secA, agent, 5_000);
  await releaseLease(env, caller, secA, b.fence, agent);
  await renewLease(env, caller, secA, b.fence, agent, 5_000);
  const rows = events(db);
  assert.deepEqual(rows.map((r) => [r.action, r.fence, r.refusal_code]), [
    ['acquire', 1, null], ['busy', null, 'busy'], ['renew', 1, null],
    ['expire', 1, null], ['acquire', 2, null], ['release', 2, null], ['refuse', 2, 'expired'],
  ]);
  assert.deepEqual([rows[0].actor_user_id, rows[0].agent_run_id], [7, null]);
  assert.deepEqual([rows[4].actor_user_id, rows[4].agent_run_id], [null, 'run_abc']);
  assert.equal(rows.every((r) => r.unit_kind === 'section' && r.unit_id === 'A'), true);
  assert.throws(() => db.exec('UPDATE work_graph_lease_events SET fence = 9'), /append-only/);
  assert.throws(() => db.exec('DELETE FROM work_graph_lease_events'), /append-only/);
  // No DB: the lease still answers, and says it was not audited.
  const noDb = setup(); delete noDb.env.DB;
  const r: any = await acquireLease(noDb.env, caller, secA, alice, 5_000);
  assert.deepEqual([r.status, r.audited], ['granted', false]);
});

test('13. cost telemetry: each result counts its Durable Object call, storage reads and writes, and audit statements', async (t) => {
  clock(t);
  const { env, db } = setup();
  const a: any = await acquireLease(env, caller, secA, alice, 5_000);
  assert.deepEqual(a.cost, { doCalls: 1, storageReads: 1, storageWrites: 1, alarmWrites: 1, d1Statements: 1 });
  const busy: any = await acquireLease(env, caller, secA, bob, 5_000);
  assert.deepEqual(busy.cost, { doCalls: 1, storageReads: 1, storageWrites: 0, alarmWrites: 0, d1Statements: 1 });
  const check: any = await assertFence(env, { caller, resource: secA, fence: a.fence, holder: alice, capability: capFor(alice) });
  assert.deepEqual(check.cost, { doCalls: 1, storageReads: 1, storageWrites: 0, alarmWrites: 0, d1Statements: 1 });
  t.mock.timers.tick(5_000);
  const after: any = await acquireLease(env, caller, secA, bob, 5_000);
  assert.deepEqual(after.cost, { doCalls: 1, storageReads: 1, storageWrites: 1, alarmWrites: 1, d1Statements: 2 }, 'the expiry row and the acquire row');
  const row = events(db)[0];
  assert.deepEqual([row.do_calls, row.storage_reads, row.storage_writes], [1, 1, 1]);
  const off: any = await acquireLease({ ...env, WORK_GRAPH_LEASES: 'off' }, caller, secA, alice, 5_000);
  assert.deepEqual([off.cost.doCalls, off.cost.storageReads], [0, 0]);
});

test('14. wiring: WORK_GRAPH_LEASE and v8-work-graph-lease in all three tables, the topology, and the class export', () => {
  const { sections } = parseToml(readFileSync('wrangler.toml', 'utf8'));
  const unq = (v: string | undefined) => (v === undefined ? undefined : JSON.parse(v));
  for (const prefix of ['', 'env.production.', 'env.preview.']) {
    const dos = sections.filter((x: any) => x.name === `${prefix}durable_objects.bindings` && unq(x.kv.get('name')) === 'WORK_GRAPH_LEASE');
    assert.deepEqual(dos.map((x: any) => unq(x.kv.get('class_name'))), ['WorkGraphLease'], prefix || 'top');
    const tags = sections.filter((x: any) => x.name === `${prefix}migrations`).map((x: any) => [unq(x.kv.get('tag')), x.kv.get('new_sqlite_classes')]);
    const v7 = tags.findIndex(([tag]) => tag === 'v7-deck-remote');
    assert.deepEqual(tags.slice(v7 + 1, v7 + 2), [['v8-work-graph-lease', '["WorkGraphLease"]']], `${prefix || 'top'}: append-only, after v7`);
  }
  assert.deepEqual(missingFromProduction(), []);
  assert.ok((BINDINGS as any[]).some((b) => b.name === 'WORK_GRAPH_LEASE' && b.hq === 'WorkGraphLease'));
  assert.match(readFileSync('cloudflare-worker/src/index.ts', 'utf8'), /^export \{ WorkGraphLease \} from '\.\/durable-objects\/work-graph-lease';$/m);
});
