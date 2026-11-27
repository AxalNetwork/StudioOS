/**
 * D4569 (#4569) — the synthetic topology proof of concept for options A (one
 * D1) and D (balance-home partitions keyed by the payer, with a directory).
 * It tests the design in `documentation/architecture/decisions/D4569.md`
 * over `_topology_model_4569.mjs`, on in-memory node:sqlite only: no
 * production database, binding, Queue, model call or network.
 *
 *   · 1, 10 and 1,000 tenants in A and D, with a hot member taking half of
 *     the runs and a member working across several companies;
 *   · a scope move, a mid-month sponsor change across partitions, a member
 *     move with a stale directory cache and a payment credit during it;
 *   · a settlement batch that fails part-way, one that commits but answers
 *     with an error, a settlement that never answers (hold expiry), a
 *     partition outage, a core outage, a follower outage after settlement,
 *     a duplicate relay delivery and concurrent same-key retries;
 *   · after each, the financial invariants: no double charge, no overdraw,
 *     one usage attribution per idempotent execution, balances keyed by the
 *     payer (the sponsor), unknown never read as zero;
 *   · and every guard the invariants rest on, switched off one at a time,
 *     caught by `checkInvariants` (the mutation checks).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/d1_topology_4569.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeSponsor, checkInvariants, companyReport, createTopology, credit, executeRun, expectedFrom,
  expireHolds, moveMember, moveScope, relay, seed, worker,
} from './_topology_model_4569.mjs';

const COST = 30;
const HOLD = 50;
const BALANCE = 1_000_000_000;
const CROSS = 1;                       // the member who works in several companies
const founder = (i) => 1000 + i;

/**
 * A synthetic world: tenant i is company i with one founder who sponsors its
 * agents (tenant 0 has eight, the rest two), plus the cross-company member,
 * who belongs to the first min(5, tenants) companies and sponsors one agent
 * in each. `sponsor` and `payerByKey` are the test's own record of who must
 * pay, independent of the model.
 */
function world(option, { tenants, partitions = 16, guards = {}, keepEmpty = false } = {}) {
  const t = createTopology({ option, partitions, guards });
  const members = [{ id: CROSS, balance: BALANCE }];
  const memberships = [];
  const agents = [];
  const agentsOf = [];
  for (let i = 0; i < tenants; i += 1) {
    members.push({ id: founder(i), balance: BALANCE });
    memberships.push([founder(i), i]);
    const n = i === 0 ? 8 : 2;
    agentsOf[i] = Array.from({ length: n }, (_, j) => 10000 + i * 10 + j);
    for (const id of agentsOf[i]) agents.push({ id, companyId: i, sponsor: founder(i) });
  }
  const crossCompanies = Math.min(5, tenants);
  const crossAgents = [];
  for (let k = 0; k < crossCompanies; k += 1) {
    memberships.push([CROSS, k]);
    crossAgents.push(9000 + k);
    agents.push({ id: 9000 + k, companyId: k, sponsor: CROSS });
  }
  const homes = keepEmpty ? partitions - 1 : partitions;
  seed(t, { members, memberships, agents, homeOf: (id) => id % homes });
  const sponsor = new Map(agents.map((a) => [a.id, a.sponsor]));
  const payerByKey = new Map();
  const job = (key, agentId, actorUserId, extra = {}) => {
    payerByKey.set(key, sponsor.get(agentId));
    return { key, agentId, actorUserId, cost: COST, hold: HOLD, ...extra };
  };
  const payerOf = (_agentId, execKey) => payerByKey.get(execKey) ?? payerByKey.get(execKey.split('#')[0]);
  return { t, agentsOf, crossAgents, sponsor, payerByKey, job, payerOf };
}

async function runAll(t, jobs, width = 8) {
  const out = [];
  for (let i = 0; i < jobs.length; i += width) out.push(...await Promise.all(jobs.slice(i, i + width).map((j) => executeRun(t, j))));
  return out;
}

/** The scale mix: two runs per tenant, as many again from tenant 0's founder (the hot member), interleaved. */
function scaleJobs(w, tenants) {
  const normal = [];
  for (let i = 0; i < tenants; i += 1) for (let r = 0; r < 2; r += 1) normal.push(w.job(`t${i}r${r}`, w.agentsOf[i][r], founder(i)));
  const hot = normal.map((_, k) => w.job(`hot${k}`, w.agentsOf[0][2 + (k % 6)], founder(0)));   // agents 2-7, never the two its normal runs use
  const mixed = [];
  for (let k = 0; k < normal.length; k += 1) mixed.push(hot[k], normal[k]);
  return mixed;
}

function share(moneyByHome) {
  const total = moneyByHome.reduce((s, n) => s + n, 0);
  return { total, max: Math.max(...moneyByHome) / total, used: moneyByHome.filter((n) => n > 0).length };
}

for (const option of ['A', 'D']) {
  for (const tenants of [1, 10, 1000]) {
    test(`${option}, ${tenants} tenant(s): a hot member, cross-company work, every invariant holds`, async (tt) => {
      const w = world(option, { tenants });
      w.t.resetStats();
      const results = await runAll(w.t, scaleJobs(w, tenants));
      assert.equal(results.filter((r) => r.status !== 'settled').length, 0, JSON.stringify(results.find((r) => r.status !== 'settled')));
      const stats = w.t.stats();
      // The cross-company member: runs their own agents in every company, and runs a founder's agent, which the founder pays.
      const cross = [];
      for (const [k, agentId] of w.crossAgents.entries()) cross.push(w.job(`x-own-${k}`, agentId, CROSS));
      cross.push(w.job('x-founder', w.agentsOf[0][0], CROSS));
      const crossResults = await runAll(w.t, cross, 1);
      assert.ok(crossResults.every((r) => r.status === 'settled'));
      assert.equal(crossResults.at(-1).payer, founder(0), 'a run of a founder\'s agent is charged to its sponsor, not to the member who started it');
      assert.equal(new Set(crossResults.slice(0, -1).map((r) => r.partition)).size, 1, 'one member, several companies, one balance home');
      if (tenants >= 10) {
        const outsider = await executeRun(w.t, w.job('x-outside', w.agentsOf[9][0], CROSS));
        assert.deepEqual([outsider.status, outsider.reason], ['refused', 'forbidden'], 'no cross-tenant run');
      }
      w.t.resetStats();
      await relay(w.t);
      const relayed = w.t.stats();
      assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([...results, ...crossResults], w.payerOf) }), []);
      const s = share(stats.moneyByHome);
      const runs = results.length;
      if (option === 'A') assert.equal(s.used, 1);
      else assert.ok(s.max >= 0.5, 'the hot member\'s home carries at least its share: one member is one primary (§6.2)');
      tt.diagnostic(`option ${option} tenants ${tenants}: runs ${runs}, statements/run ${(stats.statements / runs).toFixed(2)}, round trips/run ${(stats.roundTrips / runs).toFixed(2)}, money statements/run ${(s.total / runs).toFixed(2)}, relay round trips/run ${(relayed.roundTrips / (runs + crossResults.length)).toFixed(2)}, homes used ${s.used}, busiest home share ${(s.max * 100).toFixed(1)}%`);
    });
  }
}

test('D: the hot member moved to a home of its own; a stale cache is refused at the old home and settles once at the new', async (tt) => {
  const w = world('D', { tenants: 100, keepEmpty: true });
  const stale = worker();
  const first = await executeRun(w.t, { ...w.job('pre', w.agentsOf[0][0], founder(0)), w: stale });
  assert.equal(first.status, 'settled');
  const before = await runAll(w.t, scaleJobs(w, 100));
  const moved = await moveMember(w.t, founder(0), 15);
  assert.equal(moved.status, 'moved');
  w.t.resetStats();
  const after = await runAll(w.t, scaleJobs(w, 100).map((j) => ({ ...j, key: `${j.key}-after` })).map((j) => { w.payerByKey.set(j.key, w.sponsor.get(j.agentId)); return j; }));
  const viaStale = await executeRun(w.t, { ...w.job('stale-cache', w.agentsOf[0][1], founder(0)), w: stale });
  assert.equal(viaStale.status, 'settled');
  assert.equal(viaStale.partition, 15, 'the stale cache was refused by the old home\'s marker and reread the directory');
  await relay(w.t);
  assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([first, ...before, ...after, viaStale], w.payerOf) }), []);
  const homes = w.t.stats().moneyByHome;
  const others = homes.slice(0, 15);
  const otherShare = Math.max(...others) / homes.reduce((s, n) => s + n, 0);
  assert.ok(homes[15] / homes.reduce((s, n) => s + n, 0) >= 0.5);
  assert.ok(otherShare < 0.1, `after the move no other home carries more than a tenth (${otherShare})`);
  tt.diagnostic(`after the move: hot home share ${(homes[15] * 100 / homes.reduce((s, n) => s + n, 0)).toFixed(1)}%, busiest other home ${(otherShare * 100).toFixed(1)}%`);
});

test('D: a payment credit during a move is refused while frozen, then applied once at the new home', async () => {
  const w = world('D', { tenants: 10 });
  const m = founder(3);
  const P = w.t.homes[m % 16];
  P.db.prepare("UPDATE poc_home_markers SET state = 'frozen' WHERE user_id = ?").run(m);
  assert.equal((await credit(w.t, { userId: m, ref: 'evt-1', amount: 500 })).status, 'retry_later');
  P.db.prepare("UPDATE poc_home_markers SET state = 'active' WHERE user_id = ?").run(m);
  assert.equal((await moveMember(w.t, m, (m % 16) + 1)).status, 'moved');
  assert.equal((await credit(w.t, { userId: m, ref: 'evt-1', amount: 500 })).status, 'credited');
  assert.equal((await credit(w.t, { userId: m, ref: 'evt-1', amount: 500 })).status, 'duplicate');
  const bal = w.t.homes[(m % 16) + 1].db.prepare('SELECT balance FROM poc_accounts WHERE user_id = ?').get(m).balance;
  assert.equal(Number(bal), BALANCE + 500);
  assert.deepEqual(checkInvariants(w.t), []);
});

test('D: a move waits for pending holds, and a (partition, id) reference goes stale where a uid does not', async () => {
  const w = world('D', { tenants: 40 });
  const m = founder(5);
  const from = m % 16;
  // Other members on the same home first, so the moved member's usage ids are not 1..k.
  const others = [];
  for (let i = 0; i < 40; i += 1) if (founder(i) % 16 === from && founder(i) !== m) others.push(await executeRun(w.t, w.job(`o${i}`, w.agentsOf[i][0], founder(i))));
  const done = await executeRun(w.t, w.job('m-done', w.agentsOf[5][0], m));
  w.t.homes[from].inject({ tag: 'settle', kind: 'fail-mid', at: 2, times: 3 });
  const stuck = await executeRun(w.t, w.job('m-stuck', w.agentsOf[5][1], m));
  assert.equal(stuck.reason, 'settlement_unanswered');
  assert.equal((await moveMember(w.t, m, 0)).status, 'waiting_for_holds');
  assert.equal(await expireHolds(w.t, m), 1);
  await relay(w.t);
  const legacy = w.t.homes[from].db.prepare('SELECT usage_ref, legacy_ref FROM poc_outbox WHERE user_id = ? AND usage_ref IS NOT NULL').all(m);
  const to = from === 0 ? 1 : 0;
  assert.equal((await moveMember(w.t, m, to)).status, 'moved');
  const Q = w.t.homes[to].db;
  for (const l of legacy) {
    const byUid = Q.prepare('SELECT id FROM poc_usage WHERE uid = ?').get(l.usage_ref);
    assert.ok(byUid, 'the uid reference still resolves at the new home');
    assert.notEqual(`p${to}:${byUid.id}`, l.legacy_ref, 'a (partition, id) reference no longer names the row');
  }
  assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([...others, done], w.payerOf) }), []);
});

test('scope move: the agent changes company, the payer and its home do not', async () => {
  for (const option of ['A', 'D']) {
    const w = world(option, { tenants: 10 });
    const agentId = w.agentsOf[2][0];
    const before = await executeRun(w.t, w.job('s1', agentId, founder(2)));
    w.t.core.db.prepare('INSERT INTO poc_memberships (user_id, company_id) VALUES (?, ?)').run(founder(2), 7);
    await moveScope(w.t, agentId, 7);
    const after = await executeRun(w.t, w.job('s2', agentId, founder(2)));
    assert.equal(after.payer, before.payer);
    assert.equal(after.partition, before.partition);
    assert.equal((await companyReport(w.t, 7)).total, COST, 'the new company reports the run made after the move');
    await relay(w.t);
    assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([before, after], w.payerOf) }), []);
  }
});

test('D: a mid-month sponsor change across partitions; the cap sums both homes, and an unreadable home refuses', async () => {
  const w = world('D', { tenants: 10 });
  const agentId = w.agentsOf[1][0];
  w.t.core.db.prepare('UPDATE poc_agents SET cap = ? WHERE id = ?').run(100, agentId);
  const a1 = await executeRun(w.t, w.job('c1', agentId, founder(1)));
  const a2 = await executeRun(w.t, w.job('c2', agentId, founder(1)));
  const newSponsor = founder(2);
  assert.notEqual(newSponsor % 16, founder(1) % 16);
  await changeSponsor(w.t, agentId, newSponsor);
  w.sponsor.set(agentId, newSponsor);
  const refused = await executeRun(w.t, w.job('c3', agentId, founder(1)));
  assert.deepEqual([refused.status, refused.reason], ['refused', 'agent_cap'], '60 spent + 50 held > 100, counted across both homes');
  w.t.homes[founder(1) % 16].down = true;
  const blind = await executeRun(w.t, { ...w.job('c4', agentId, founder(1)), hold: 10 });
  assert.equal(blind.reason, 'agent_spend_unreadable', 'an unreadable home is unknown spend, never 0');
  w.t.homes[founder(1) % 16].down = false;
  const ok = await executeRun(w.t, { ...w.job('c5', agentId, founder(1)), hold: 30 });
  assert.equal(ok.payer, newSponsor);
  await relay(w.t);
  assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([a1, a2, ok], w.payerOf) }), []);
});

for (const option of ['A', 'D']) {
  test(`${option}: a settlement that fails part-way rolls back whole and the retry settles once`, async () => {
    const w = world(option, { tenants: 10 });
    const m = founder(4);
    w.t.homes[option === 'A' ? 0 : m % 16].inject({ tag: 'settle', kind: 'fail-mid', at: 3 });
    const r = await executeRun(w.t, w.job('f1', w.agentsOf[4][0], m));
    assert.equal(r.status, 'settled');
    await relay(w.t);
    assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([r], w.payerOf) }), []);
  });

  test(`${option}: a settlement that commits but answers with an error is not charged twice`, async () => {
    const w = world(option, { tenants: 10 });
    const m = founder(4);
    const home = w.t.homes[option === 'A' ? 0 : m % 16];
    home.inject({ tag: 'settle', kind: 'commit-then-throw' });
    const r = await executeRun(w.t, w.job('l1', w.agentsOf[4][0], m));
    assert.equal(r.status, 'settled');
    if (option === 'D') assert.equal(Number(home.db.prepare('SELECT COUNT(*) AS n FROM poc_outbox WHERE source_key = ?').get('l1').n), 1);
    await relay(w.t);
    assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([r], w.payerOf) }), []);
  });

  test(`${option}: a settlement that never answers stays held, then the expiry releases it`, async () => {
    const w = world(option, { tenants: 10 });
    const m = founder(4);
    const home = w.t.homes[option === 'A' ? 0 : m % 16];
    home.inject({ tag: 'settle', kind: 'fail-mid', at: 1, times: 3 });
    const r = await executeRun(w.t, w.job('n1', w.agentsOf[4][0], m));
    assert.equal(r.reason, 'settlement_unanswered');
    assert.equal(Number(home.db.prepare('SELECT balance FROM poc_accounts WHERE user_id = ?').get(m).balance), BALANCE - HOLD, 'held, not charged');
    assert.equal(await expireHolds(w.t, m), 1);
    assert.equal(Number(home.db.prepare('SELECT balance FROM poc_accounts WHERE user_id = ?').get(m).balance), BALANCE);
    assert.deepEqual(checkInvariants(w.t), []);
  });

  test(`${option}: concurrent same-key retries make one hold, one charge, one usage row`, async () => {
    const w = world(option, { tenants: 10 });
    const m = founder(6);
    const j = w.job('same', w.agentsOf[6][0], m);
    const results = await Promise.all(Array.from({ length: 5 }, () => executeRun(w.t, j)));
    assert.ok(results.every((r) => r.status === 'settled'));
    const home = w.t.homes[option === 'A' ? 0 : m % 16].db;
    assert.equal(Number(home.prepare('SELECT COUNT(*) AS n FROM poc_reservations WHERE execution_key = ?').get('same').n), 1);
    assert.equal(Number(home.prepare('SELECT balance FROM poc_accounts WHERE user_id = ?').get(m).balance), BALANCE - COST);
    await relay(w.t);
    assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom(results, w.payerOf) }), []);
  });

  test(`${option}: an unkeyed retry is two executions and two charges (why Rule 1 needs a key)`, async () => {
    const w = world(option, { tenants: 10 });
    const m = founder(6);
    const j = { ...w.job('unkeyed', w.agentsOf[6][0], m), idempotent: false };
    const r1 = await executeRun(w.t, j);
    const r2 = await executeRun(w.t, j);
    assert.notEqual(r1.execKey, r2.execKey);
    const home = w.t.homes[option === 'A' ? 0 : m % 16].db;
    assert.equal(Number(home.prepare('SELECT balance FROM poc_accounts WHERE user_id = ?').get(m).balance), BALANCE - 2 * COST);
    await relay(w.t);
    assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([r1, r2], w.payerOf) }), []);
  });
}

test('outage: in D one partition stops only its members; in A the one database stops everyone', async () => {
  const d = world('D', { tenants: 32 });
  const down = founder(0) % 16;
  d.t.homes[down].down = true;
  const jobs = [];
  for (let i = 0; i < 32; i += 1) jobs.push(d.job(`o${i}`, d.agentsOf[i][0], founder(i)));
  const results = await runAll(d.t, jobs);
  for (const [i, r] of results.entries()) {
    if (founder(i) % 16 === down) assert.ok(['agent_spend_unreadable', 'budget_unreadable'].includes(r.reason), r.reason);
    else assert.equal(r.status, 'settled');
  }
  const report = await companyReport(d.t, 0);
  assert.equal(report.total, null, 'a report that needs the down home is unknown, never 0');
  d.t.homes[down].down = false;
  await relay(d.t);
  assert.deepEqual(checkInvariants(d.t, { expected: expectedFrom(results, d.payerOf) }), []);

  const a = world('A', { tenants: 32 });
  a.t.core.down = true;
  const aResults = await runAll(a.t, jobs.map((j) => ({ ...j })));
  assert.ok(aResults.every((r) => r.reason === 'core_unavailable'));
  a.t.core.down = false;
  assert.deepEqual(checkInvariants(a.t), []);
});

test('D: core down after settlement: money is final, the outbox waits and reads as pending, the relay closes the run', async () => {
  const w = world('D', { tenants: 10 });
  w.t.core.inject({ tag: 'finish', kind: 'unavailable' });
  const r = await executeRun(w.t, w.job('fd', w.agentsOf[3][0], founder(3)));
  assert.equal(r.status, 'settled');
  w.t.core.down = true;
  const blocked = await relay(w.t);
  assert.equal(blocked.pending, 1, 'the follower write failed, so the outbox row stays undelivered');
  w.t.core.down = false;
  const pendingNow = checkInvariants(w.t, { expected: expectedFrom([r], w.payerOf) });
  assert.ok(pendingNow.some((v) => v.startsWith('outbox:')), 'an undelivered fact is reported as pending, not absent');
  w.t.homes[r.partition].inject({ tag: 'relay-mark', kind: 'unavailable' });
  await relay(w.t);                         // applied, then the mark failed: a replay follows
  const replay = await relay(w.t);
  assert.equal(replay.mismatches, 0, 'the duplicate delivery changed nothing');
  assert.equal(w.t.core.db.prepare('SELECT status FROM poc_runs WHERE uid = ?').get('run:fd').status, 'done');
  assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([r], w.payerOf) }), []);
});

test('D: a conflicting delivery is a mismatch, never an overwrite', async () => {
  const w = world('D', { tenants: 10 });
  const r = await executeRun(w.t, w.job('cf', w.agentsOf[3][0], founder(3)));
  await relay(w.t);
  w.t.homes[r.partition].db.prepare("INSERT INTO poc_outbox (user_id, target_uid, source_key, usage_ref) VALUES (?, 'run:cf', 'bogus', 'use:bogus')").run(founder(3));
  const out = await relay(w.t);
  assert.equal(out.mismatches, 1);
  assert.equal(w.t.core.db.prepare('SELECT usage_ref FROM poc_runs WHERE uid = ?').get('run:cf').usage_ref, 'use:cf');
  assert.deepEqual(checkInvariants(w.t, { expected: expectedFrom([r], w.payerOf) }), []);
});

/**
 * The mutation checks: each guard switched off, the scenario it protects
 * replayed, and `checkInvariants` must name the fault. A guard whose removal
 * nothing notices would be a guard the PoC never tested.
 */
const MUTATIONS = [
  ['idempotency', 'double_settlement', async (w) => {
    const j = w.job('mut', w.agentsOf[6][0], founder(6));
    return Promise.all(Array.from({ length: 3 }, () => executeRun(w.t, j)));
  }],
  ['settleCas', 'ledger', async (w) => {
    const j = w.job('mut', w.agentsOf[6][0], founder(6));
    return Promise.all(Array.from({ length: 3 }, () => executeRun(w.t, j)));
  }],
  ['attribution', 'attribution', async (w) => {
    const j = w.job('mut', w.agentsOf[6][0], founder(6));
    return Promise.all(Array.from({ length: 3 }, () => executeRun(w.t, j)));
  }],
  ['balance', 'overdraw', async (w) => {
    w.t.homes[w.t.option === 'A' ? 0 : founder(6) % 16].db.prepare('UPDATE poc_accounts SET balance = 20 WHERE user_id = ?').run(founder(6));
    w.t.homes[w.t.option === 'A' ? 0 : founder(6) % 16].db.prepare("INSERT INTO poc_ledger (user_id, kind, delta, source_ref) VALUES (?, 'hold', ?, 'test-drain')").run(founder(6), 20 - BALANCE);
    return [await executeRun(w.t, w.job('mut', w.agentsOf[6][0], founder(6)))];
  }],
  ['payerKeyed', 'payer', async (w) => [await executeRun(w.t, w.job('mut', w.agentsOf[0][0], CROSS))]],
  ['marker', 'write_after_move', async (w) => {
    const stale = worker();
    const r1 = await executeRun(w.t, { ...w.job('mut0', w.agentsOf[6][0], founder(6)), w: stale });
    await moveMember(w.t, founder(6), (founder(6) % 16) + 1);
    return [r1, await executeRun(w.t, { ...w.job('mut', w.agentsOf[6][1], founder(6)), w: stale })];
  }, 'D'],
  ['capAllPartitions', 'cap', async (w) => {
    const agentId = w.agentsOf[1][0];
    w.t.core.db.prepare('UPDATE poc_agents SET cap = ? WHERE id = ?').run(65, agentId);
    const out = [await executeRun(w.t, { ...w.job('mut0', agentId, founder(1)), hold: 30 }), await executeRun(w.t, { ...w.job('mut1', agentId, founder(1)), hold: 30 })];
    await changeSponsor(w.t, agentId, founder(2));
    w.sponsor.set(agentId, founder(2));
    out.push(await executeRun(w.t, { ...w.job('mut', agentId, founder(1)), hold: 30 }));   // 60 spent + 30 > 65 only when both homes are summed
    return out;
  }, 'D'],
  ['relayApplyFirst', 'missing_ref', async (w) => {
    const r = await executeRun(w.t, w.job('mut', w.agentsOf[3][0], founder(3)));
    w.t.core.db.prepare("UPDATE poc_runs SET status = 'done' WHERE uid = 'run:mut'").run();
    w.t.core.inject({ tag: 'relay-apply', kind: 'unavailable' });
    await relay(w.t);
    return [r];
  }, 'D'],
  ['relayConditional', 'dangling_ref', async (w) => {
    const r = await executeRun(w.t, w.job('mut', w.agentsOf[3][0], founder(3)));
    await relay(w.t);
    w.t.homes[r.partition].db.prepare("INSERT INTO poc_outbox (user_id, target_uid, source_key, usage_ref) VALUES (?, 'run:mut', 'bogus', 'use:bogus')").run(founder(3));
    return [r];
  }, 'D'],
];

for (const [guard, expectedViolation, scenario, only] of MUTATIONS) {
  for (const option of only ? [only] : ['A', 'D']) {
    test(`mutation: ${option} without the ${guard} guard, the checker reports ${expectedViolation}`, async () => {
      for (const guards of [{}, { [guard]: false }]) {
        const w = world(option, { tenants: 10, guards });
        const results = await scenario(w);
        await relay(w.t);
        const found = checkInvariants(w.t, { expected: expectedFrom(results, w.payerOf) });
        if (guards[guard] === false) assert.ok(found.some((v) => v.startsWith(`${expectedViolation}:`)), `${guard} off: ${JSON.stringify(found)}`);
        else assert.deepEqual(found, [], `${guard} on: the same scenario is clean`);
      }
    });
  }
}

/**
 * The checker on its own: each check is made to fire alone by editing one row
 * of a clean world directly, so no check is only ever covered by another.
 */
const TAMPER = [
  ['double_settlement', (h, m) => h.prepare("INSERT INTO poc_reservations (uid, user_id, execution_key, agent_id, held, hold_token, status, settlement_uid, charged) VALUES ('res:extra', ?, 'k1', 10060, 50, 'x', 'settled', 'extra', 0)").run(m)],
  ['overcharge', (h) => h.prepare("UPDATE poc_reservations SET charged = charged + 1 WHERE execution_key = 'k1'").run()],
  ['attribution', (h) => h.prepare("DELETE FROM poc_usage WHERE execution_key = 'k1'").run()],
  ['missing_charge', (h) => h.prepare("UPDATE poc_reservations SET status = 'refunded' WHERE execution_key = 'k1'").run()],
  ['usage_payer', (h) => h.prepare("INSERT INTO poc_usage (uid, execution_key, user_id, agent_id, company_id, reservation_uid, charged, month) SELECT 'use:other', 'other', user_id, agent_id, company_id, reservation_uid, 0, month FROM poc_usage WHERE execution_key = 'k1'").run()],
  ['overdraw', (h, m) => { h.prepare('UPDATE poc_accounts SET balance = -1 WHERE user_id = ?').run(m); }, { balance: false }],   // the CHECK would refuse the edit itself
  ['ledger', (h, m) => h.prepare('UPDATE poc_accounts SET balance = balance + 1 WHERE user_id = ?').run(m)],
  ['markers', (_h, m, w) => w.t.homes[(m % 16) + 1].db.prepare("INSERT INTO poc_home_markers (user_id, version, state) VALUES (?, 1, 'active')").run(m)],
  ['directory', (_h, m, w) => w.t.core.db.prepare('UPDATE poc_directory SET version = 9 WHERE user_id = ?').run(m)],
  ['single_flight', (_h, _m, w) => { w.t.core.db.exec('DROP INDEX poc_runs_live'); w.t.core.db.prepare("INSERT INTO poc_runs (uid, agent_id, company_id, payer_user_id, actor_user_id, status) VALUES ('a', 1, 1, 1, 1, 'live'), ('b', 1, 1, 1, 1, 'live')").run(); }],
];

for (const [label, tamper, guards = {}] of TAMPER) {
  test(`checker: ${label} is reported on its own`, async () => {
    const w = world('D', { tenants: 10, guards });
    const m = founder(6);
    const r = await executeRun(w.t, w.job('k1', w.agentsOf[6][0], m));
    await relay(w.t);
    const expected = expectedFrom([r], w.payerOf);
    assert.deepEqual(checkInvariants(w.t, { expected }), []);
    tamper(w.t.homes[m % 16].db, m, w);
    const found = checkInvariants(w.t, { expected });
    assert.ok(found.some((v) => v.startsWith(`${label}:`)), JSON.stringify(found));
  });
}
