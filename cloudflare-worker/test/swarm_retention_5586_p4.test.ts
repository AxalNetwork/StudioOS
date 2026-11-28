/**
 * D5586 part 4 (#5586): bounded retention of the coordinator's swarm state. Only terminal tickets past the age are
 * retired, in bounded batches, oldest first; a retired uid is never admitted or billed again; the budget and a render
 * approval keep what was spent; the tombstones are bounded and their eviction counted; only audit entries D1 already
 * holds are compacted, and the cap's `audit_dropped` is not inflated by them; a second run retires nothing; a venture's
 * snapshot carries only its own part. The real `WorkspaceAdmission` class answers `/retire` and still treats a retired
 * uid as the swarm's, over an in-memory Durable Object storage (Miniflare's workerd here is older than the
 * compatibility date, so the binding round-trip stays with `workspace_admission_do_5586_p3.test.mjs`).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/swarm_retention_5586_p4.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetCommitted, renderApprovalCommitted, swarmOf, ventureKey, SWARM_AUDIT_MAX } from '../src/services/agents/swarmAdmission.ts';
import { SWARM_RETENTION_BATCH, SWARM_RETENTION_MAX_BATCHES, SWARM_RETENTION_MS, SWARM_RETIRED_MAX, retireSwarmAdmission } from '../src/services/agents/swarmRetention.ts';
import { flushSwarmAudit, scopedSwarmState } from '../src/services/agents/swarmAudit.ts';
import { WorkspaceAdmission } from '../src/durable-objects/workspace-admission.ts';
import { WORKSPACE_ADMISSION_OBJECT, runSwarmRetention } from '../src/services/agents/workspaceAdmissionClient.ts';
import { V7, V8, facts, ok, policy, refused, request, swarmWorld } from './_swarm_world_5586.ts';

const DAY = 86_400_000;
const P7 = policy(V7), P8 = policy(V8);

/** A world with tickets of every terminal kind, aged `age` ms by the end. */
async function world() {
  const w = swarmWorld();
  const tick = (ms: number) => { w.clock.now += ms; };
  const settledDoc = request(V7, 'document');
  ok(await w.swarm.request(settledDoc, P7, facts()));
  tick(1000);
  ok(await w.swarm.settle(settledDoc.ticket_uid, 1200));
  const settledCode = request(V7, 'code');
  ok(await w.swarm.request(settledCode, P7, facts()));
  const [g] = await w.admission.admit();
  ok(await w.swarm.settle(settledCode.ticket_uid, 700, g.generation));
  const withdrawn = request(V7, 'document', { reserve_microusd: 10 });
  const full = policy(V7, { max_concurrent: 0 });
  ok(await w.swarm.request(withdrawn, full, facts()));
  ok(await w.swarm.withdraw(withdrawn.ticket_uid, V7));
  const render = request(V7, 'brand_image');
  ok(await w.swarm.request(render, P7, facts()));
  ok(await w.swarm.settle(render.ticket_uid, 900));
  const other = request(V8, 'document');
  ok(await w.swarm.request(other, P8, facts()));
  ok(await w.swarm.settle(other.ticket_uid, 300));
  const running = request(V7, 'document');
  ok(await w.swarm.request(running, P7, facts()));
  const waiting = request(V7, 'document');
  ok(await w.swarm.request(waiting, policy(V7, { max_concurrent: 1 }), facts()));
  return { w, tick, settledDoc, settledCode, withdrawn, render, other, running, waiting };
}
const sw = async (w: ReturnType<typeof swarmWorld>) => swarmOf(w.store.peek());

test('only terminal tickets past the age retire; live, waiting and young ones stay; a lease-lane ticket takes its released slot', async () => {
  const x = await world();
  const young = await retireSwarmAdmission(x.w.store, () => x.w.clock.now + SWARM_RETENTION_MS - 10_000);
  assert.deepEqual(ok(young as any), { tickets: 0, slots: 0, audit: 0, evicted: 0, more: false, batches: 1,
    now: x.w.clock.now + SWARM_RETENTION_MS - 10_000, cutoff: x.w.clock.now - 10_000 });
  const before = await sw(x.w);
  assert.equal(Object.keys(before.tickets).length, 7);
  assert.equal(x.w.store.peek().slots[x.settledCode.ticket_uid].state, 'released');

  const r = ok(await retireSwarmAdmission(x.w.store, () => x.w.clock.now + SWARM_RETENTION_MS) as any);
  assert.deepEqual([r.tickets, r.slots, r.evicted, r.more], [5, 1, 0, false]);
  const after = await sw(x.w);
  assert.deepEqual(Object.keys(after.tickets).sort(), [x.running.ticket_uid, x.waiting.ticket_uid].sort(), 'live and waiting tickets stay');
  assert.equal(x.w.store.peek().slots[x.settledCode.ticket_uid], undefined, 'the released slot goes with its ticket');
  assert.deepEqual(after.retired!.uids[x.settledDoc.ticket_uid], { venture: 't7:c70', state: 'settled', charged_microusd: 1200, measured: true, ended_at: before.tickets[x.settledDoc.ticket_uid].settled_at });
  assert.deepEqual(after.retired!.uids[x.withdrawn.ticket_uid], { venture: 't7:c70', state: 'withdrawn', charged_microusd: null, measured: null, ended_at: before.tickets[x.withdrawn.ticket_uid].ended_at });
  assert.equal(typeof before.tickets[x.withdrawn.ticket_uid].ended_at, 'number', 'a withdrawal records when it ended');
  assert.deepEqual(after.retired!.tickets, { 't7:c70': 4, 't8:c80': 1 });
  assert.deepEqual(after.retired!.charged, { 't7:c70': 1200 + 700 + 900, 't8:c80': 300 });
  assert.deepEqual(after.retired!.order, [x.settledDoc, x.settledCode, x.withdrawn, x.render, x.other].map(t => t.ticket_uid), 'oldest first');
});

test('a ticket whose #5570 lease still holds a slot is never retired', async () => {
  const w = swarmWorld();
  const t = request(V7, 'code');
  ok(await w.swarm.request(t, P7, facts()));
  await w.admission.admit();
  // Force the ticket terminal while its lease is still admitted: retention must keep both.
  await w.store.transaction(s => { const x = swarmOf(s).tickets[t.ticket_uid]; x.state = 'settled'; x.settled_at = 0; x.charged_microusd = 1; x.measured = true; });
  assert.equal(w.store.peek().slots[t.ticket_uid].state, 'admitted');
  const r = ok(await retireSwarmAdmission(w.store, () => w.clock.now + SWARM_RETENTION_MS) as any);
  assert.equal(r.tickets, 0);
  assert.ok((await sw(w)).tickets[t.ticket_uid]);
});

test('bounded: at most `batch` per transaction and `maxBatches` per call, oldest first; a further call finishes; then nothing is due', async () => {
  const x = await world();
  const at = () => x.w.clock.now + SWARM_RETENTION_MS;
  const t0 = x.w.store.transactions;
  const a = ok(await retireSwarmAdmission(x.w.store, at, { batch: 2, maxBatches: 1 }) as any);
  assert.deepEqual([a.tickets, a.batches, a.more], [2, 1, true]);
  assert.equal(x.w.store.transactions - t0, 1, 'one transaction');
  assert.deepEqual((await sw(x.w)).retired!.order, [x.settledDoc.ticket_uid, x.settledCode.ticket_uid]);
  const b = ok(await retireSwarmAdmission(x.w.store, at, { batch: 2, maxBatches: 5 }) as any);
  assert.deepEqual([b.tickets, b.batches, b.more], [3, 2, false]);
  const snap = JSON.stringify(x.w.store.peek());
  const c = ok(await retireSwarmAdmission(x.w.store, at) as any);
  assert.deepEqual([c.tickets, c.slots, c.audit, c.batches, c.more], [0, 0, 0, 1, false], 'idempotent: a second run retires nothing');
  assert.equal(JSON.stringify(x.w.store.peek()), snap, 'and changes nothing');
  assert.deepEqual([SWARM_RETENTION_MS, SWARM_RETENTION_BATCH, SWARM_RETENTION_MAX_BATCHES, SWARM_RETIRED_MAX], [30 * DAY, 200, 10, 5000]);
});

test('a retired uid is never admitted or billed again; settle repeats the first bill; withdraw answers its venture only', async () => {
  const x = await world();
  const late = x.w.clock.now + SWARM_RETENTION_MS;
  ok(await retireSwarmAdmission(x.w.store, () => late));
  x.w.clock.now = late + 1;
  refused(await x.w.swarm.request(x.settledDoc, P7, facts()), 'ticket_retired');
  refused(await x.w.swarm.request(x.withdrawn, P7, facts()), 'ticket_retired');
  assert.deepEqual(ok(await x.w.swarm.settle(x.settledDoc.ticket_uid, 99_999)), { charged_microusd: 1200, measured: true, first: false });
  assert.deepEqual(ok(await x.w.swarm.settle(x.settledCode.ticket_uid, 99_999, 1)), { charged_microusd: 700, measured: true, first: false }, 'a lease-lane repeat needs no lease');
  refused(await x.w.swarm.settle(x.withdrawn.ticket_uid, 5), 'not_admitted');
  assert.deepEqual(ok(await x.w.swarm.withdraw(x.withdrawn.ticket_uid, V7)), { state: 'withdrawn' });
  refused(await x.w.swarm.withdraw(x.withdrawn.ticket_uid, V8), 'ticket_not_found');
  refused(await x.w.swarm.withdraw(x.other.ticket_uid, V7), 'ticket_not_found');
  const s = await sw(x.w);
  assert.equal(Object.keys(s.tickets).length, 2, 'no ticket was re-created');
  assert.equal(s.audit.filter(e => e.ticket_uid === x.settledDoc.ticket_uid && e.action === 'settle').length, 1, 'billed once');
});

test('the budget and a render approval keep what retired tickets spent', async () => {
  const x = await world();
  const s0 = await sw(x.w);
  const k7 = ventureKey(V7);
  const spent = budgetCommitted(s0, k7), renderSpent = renderApprovalCommitted(s0, x.render);
  assert.equal(spent, 1200 + 700 + 900 + 1000, 'settled charges plus the live reserve');
  ok(await retireSwarmAdmission(x.w.store, () => x.w.clock.now + SWARM_RETENTION_MS));
  const s1 = await sw(x.w);
  assert.equal(budgetCommitted(s1, k7), spent);
  assert.equal(renderApprovalCommitted(s1, x.render), renderSpent);
  assert.equal(renderSpent, 900);
  assert.equal(budgetCommitted(s1, ventureKey(V8)), 300);
  // The budget is still exhausted where it was: a request the full budget refuses before retention is refused after.
  x.w.clock.now += SWARM_RETENTION_MS;
  const tight = policy(V7, { render_budget_microusd: spent + 500 });
  refused(await x.w.swarm.request(request(V7, 'document', { reserve_microusd: 600 }), tight, facts()), 'budget_exhausted');
  ok(await x.w.swarm.request(request(V7, 'document', { reserve_microusd: 400 }), tight, facts()));
});

test('the tombstones are bounded and every eviction is counted', async () => {
  const x = await world();
  const r = ok(await retireSwarmAdmission(x.w.store, () => x.w.clock.now + SWARM_RETENTION_MS, { retiredMax: 2 }) as any);
  assert.deepEqual([r.tickets, r.evicted], [5, 3]);
  const s = await sw(x.w);
  assert.deepEqual(s.retired!.order, [x.render.ticket_uid, x.other.ticket_uid]);
  assert.deepEqual(Object.keys(s.retired!.uids).sort(), [x.render.ticket_uid, x.other.ticket_uid].sort());
  assert.equal(s.retired!.dropped, 3);
  assert.deepEqual(s.retired!.charged, { 't7:c70': 2800, 't8:c80': 300 }, 'the carried charge outlives the tombstone');
});

test('only audit entries D1 holds are compacted; the cap does not count them as dropped; the next copy finds no gap', async () => {
  const x = await world();
  const all = (await sw(x.w)).audit.length;
  const late = () => x.w.clock.now + SWARM_RETENTION_MS;
  assert.equal(ok(await retireSwarmAdmission(x.w.store, late) as any).audit, 0, 'nothing copied, nothing compacted');
  await x.w.store.transaction(s => { swarmOf(s).audit_flushed_seq = 4; });
  const r = ok(await retireSwarmAdmission(x.w.store, late) as any);
  assert.equal(r.audit, 4);
  const s = await sw(x.w);
  assert.deepEqual([s.audit.length, s.audit[0].seq, s.retired!.audit_compacted, s.audit_dropped], [all - 4, 5, 4, 0]);
  // Fill past the cap: only what the cap removes is dropped.
  await x.w.store.transaction(st => {
    const q = swarmOf(st);
    for (let i = q.audit.length; i < SWARM_AUDIT_MAX; i++) q.audit.push({ ...q.audit[0], seq: ++q.audit_seq });
  });
  x.w.clock.now = late() + 1;
  refused(await x.w.swarm.request(request(V7, 'document'), { ...P7, halted: true }, facts()), 'swarm_halted');
  refused(await x.w.swarm.request(request(V7, 'document'), { ...P7, halted: true }, facts()), 'swarm_halted');
  const s2 = await sw(x.w);
  assert.equal(s2.audit.length, SWARM_AUDIT_MAX);
  assert.equal(s2.audit_dropped, 2, 'the two entries over the cap, not the four compacted ones');
  // Flush from watermark 4: the first kept entry is 7 (5 and 6 were dropped by the cap), so the gap is exactly [5, 6].
  const db = { prepare: () => ({ bind: () => ({}) }), batch: async (st: unknown[]) => st.map(() => ({ results: [{}] })) } as any;
  const f = await flushSwarmAudit(x.w.store, db);
  assert.ok(f.ok);
  assert.deepEqual((f as any).gap, { from_seq: 5, to_seq: 6 });
});

test('a clock behind the last decision retires nothing; a bad option is refused', async () => {
  const x = await world();
  const before = JSON.stringify(x.w.store.peek());
  refused(await retireSwarmAdmission(x.w.store, () => x.w.clock.now - 1) as any, 'clock_regressed');
  refused(await retireSwarmAdmission(x.w.store, () => x.w.clock.now, { batch: 0 }) as any, 'invalid_retention');
  refused(await retireSwarmAdmission(x.w.store, () => -1) as any, 'invalid_retention');
  assert.equal(JSON.stringify(x.w.store.peek()), before);
});

test('a venture\'s snapshot carries only its own part of what retention compacted', async () => {
  const x = await world();
  ok(await retireSwarmAdmission(x.w.store, () => x.w.clock.now + SWARM_RETENTION_MS));
  const all = await sw(x.w);
  const mine = scopedSwarmState(all, V8);
  assert.deepEqual(Object.keys(mine.retired!.uids), [x.other.ticket_uid]);
  assert.deepEqual(mine.retired!.order, [x.other.ticket_uid]);
  assert.deepEqual([mine.retired!.tickets, mine.retired!.charged, mine.retired!.render], [{ 't8:c80': 1 }, { 't8:c80': 300 }, {}]);
  const seven = scopedSwarmState(all, V7);
  assert.deepEqual(Object.keys(seven.retired!.render), [`t7:c70|${x.render.asset_uid}||brand_image`]);
  assert.ok(!JSON.stringify(mine).includes('t7:c70'), 'nothing of another venture');
  // A venture whose key is a prefix of another's sees none of it.
  assert.deepEqual(scopedSwarmState(all, { tenant_id: 7, company_id: 7 }).retired!.render, {});
});

// ---- the coordinator class, over an in-memory Durable Object storage ------------------------------------------------
function storage() {
  let data = new Map<string, unknown>();
  let chain: Promise<unknown> = Promise.resolve();
  return {
    transaction<T>(fn: (txn: { get: (k: string) => Promise<unknown>; put: (k: string, v: unknown) => Promise<void> }) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const copy = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
        const out = await fn({ get: async k => structuredClone(copy.get(k)), put: async (k, v) => { copy.set(k, structuredClone(v)); } });
        data = copy;
        return out;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
class TestAdmission extends WorkspaceAdmission {
  static now = 1_000_000;
  protected clock() { return TestAdmission.now; }
}
function coordinator() {
  const obj = new TestAdmission({ id: { name: WORKSPACE_ADMISSION_OBJECT }, storage: storage() } as any, {} as any);
  const op = async (caller: typeof V7, o: string, args: unknown[]) => (await obj.fetch(new Request('https://x/op', { method: 'POST',
    body: JSON.stringify({ op: o, caller: { tenantId: caller.tenant_id, companyId: caller.company_id }, args }) }))).json() as Promise<any>;
  return { obj, op, ns: { idFromName: (n: string) => ({ name: n }), get: () => ({ fetch: (u: string, i: RequestInit) => obj.fetch(new Request(u, i)) }) } };
}

test('the coordinator answers /retire, and a retired uid stays the swarm\'s and its venture\'s', async () => {
  TestAdmission.now = 1_000_000;
  const c = coordinator();
  const t = request(V7, 'document');
  assert.equal((await c.op(V7, 'swarm.request', [t, P7, facts()])).value.state, 'admitted');
  assert.equal((await c.op(V7, 'swarm.settle', [t.ticket_uid, 250])).value.charged_microusd, 250);
  const young = await runSwarmRetention({ WORKSPACE_ADMISSION: c.ns } as any);
  assert.equal(ok(young as any).tickets, 0);
  TestAdmission.now += SWARM_RETENTION_MS;
  const r = await runSwarmRetention({ WORKSPACE_ADMISSION: c.ns } as any);
  assert.equal(ok(r as any).tickets, 1);
  assert.equal(ok(await runSwarmRetention({ WORKSPACE_ADMISSION: c.ns } as any) as any).tickets, 0, 'idempotent');
  assert.deepEqual((await c.op(V7, 'swarm.settle', [t.ticket_uid, 1])).value, { charged_microusd: 250, measured: true, first: false });
  assert.equal((await c.op(V8, 'swarm.settle', [t.ticket_uid, 1])).code, 'ticket_not_found', 'another venture\'s retired ticket does not exist');
  assert.equal((await c.op(V7, 'admission.request', [{ run_uid: t.ticket_uid, tenant_id: 7, agent_id: 1, provider: 'cloudflare', region: 'weur', compute_reserve_microusd: 1 }])).code,
    'swarm_ticket', 'the uid stays the swarm\'s');
  assert.equal((await c.op(V7, 'swarm.request', [t, P7, facts()])).code, 'ticket_retired');
  const snap = (await c.op(V8, 'swarm.snapshotFor', [V8])).value;
  assert.deepEqual(snap.retired.uids, {}, 'another venture\'s snapshot holds none of it');
  // The path takes no caller: a GET, another path or another name is refused.
  assert.equal((await c.obj.fetch(new Request('https://x/retire'))).status, 404);
  const stranger = new TestAdmission({ id: { name: 'other' }, storage: storage() } as any, {} as any);
  assert.equal((await (await stranger.fetch(new Request('https://x/retire', { method: 'POST' }))).json() as any).code, 'wrong_coordinator');
  refused(await runSwarmRetention({} as any) as any, 'admission_unbound');
  refused(await runSwarmRetention({ WORKSPACE_ADMISSION: { idFromName: () => ({}), get: () => ({ fetch: async () => { throw new Error('down'); } }) } } as any) as any, 'admission_unavailable');
});
