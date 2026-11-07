/**
 * #4567 (D1 scale S1) — the benchmark harness, tiny and deterministic, as CI
 * runs it. The real load runs are `npm run bench:d1` (local) and the owner's
 * hosted preview run (documentation/operations/D1_BENCHMARK.md), never CI.
 *
 *   · a small mixed run of A–E on the actual migrations keeps every
 *     invariant at 0, and every mix does its work;
 *   · each invariant query counts the fault it names (each is broken here on
 *     purpose, in this throwaway database);
 *   · an unrecorded charge is unknown, never 0;
 *   · the control shows the `chargedFor` scan and the candidate index's
 *     plan, and leaves no index behind;
 *   · the schedule is deterministic and its ceilings refuse, never trim;
 *   · fingerprints and the CLI's report hold no value of any row.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/d1_benchmark_4567.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { amplification, benchWorld, fingerprint, invariants, runClosed, runOp, scanControl, schedule, summarise } from './_d1_bench.ts';
import { chargedFor } from '../src/services/agents/agentRun.ts';

afterAll(() => removeMigratedDatabases());
const ROOT = new URL('../../', import.meta.url);

test('#4567: a small mixed run of A–E keeps every invariant at 0, and every mix does its work', async () => {
  const w = benchWorld({ tenants: 4, agentsPerTenant: 2 });
  try {
    const rs = await runClosed(w, schedule({ ops: 60, tenants: 4, seed: 7 }), 4);
    const inv = invariants(w, rs);
    for (const [k, n] of Object.entries(inv)) assert.equal(n, 0, `${k} is 0`);
    assert.equal(rs.filter((r) => r.error).length, 0, 'nothing threw');
    const by = summarise(rs);
    for (const k of ['A', 'B', 'C', 'D', 'E']) assert.ok(by[k]?.ops > 0, `mix ${k} ran`);
    assert.ok(by.C.ok >= 1, 'an agent run went end to end');
    // An end-to-end agent run costs more statements than a bare AI call, which costs more than a read.
    assert.ok(by.C.stmts_per_op > by.B.stmts_per_op && by.B.stmts_per_op > by.A.stmts_per_op, JSON.stringify([by.A.stmts_per_op, by.B.stmts_per_op, by.C.stmts_per_op]));
    // The run's rows exist: a settled hold, the usage rows and the proposal, decided, and the run closed by `after`.
    const n = (sql: string) => Number((w.db.prepare(sql).get() as any).n);
    assert.ok(n("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'settled'") >= 1);
    assert.ok(n("SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE status = 'accepted'") >= 1);
    assert.ok(n("SELECT COUNT(*) AS n FROM agent_task_runs WHERE status = 'done' AND ended_at IS NOT NULL") >= 1);
    // A top-up tenant's runs wrote the ledger's hold, release and spend (D755), so the ledger is under load too.
    assert.ok(n("SELECT COUNT(*) AS n FROM ai_credit_ledger WHERE kind = 'spend'") >= 1, 'the ledger was written');
    // Every statement was metered and attributed to its mix.
    const amp = amplification(w);
    assert.ok(amp.length > 20);
    assert.ok(amp.some((a) => a.kind === 'write' && a.table === 'ai_usage_logs' && (a.indexes ?? 0) >= 1));
  } finally { w.db.close(); }
});

test('#4567: each invariant query counts the fault it names', async () => {
  const w = benchWorld({ tenants: 2 });
  try {
    for (let n = 0; n < 2; n++) await runOp(w, { n, kind: 'C', tenant: n, other: 0 });
    const zero = invariants(w, []);
    for (const [k, v] of Object.entries(zero)) assert.equal(v, 0, `${k} starts at 0`);
    const db = w.db;
    const res = db.prepare("SELECT uid, user_id FROM ai_budget_reservations WHERE status = 'settled' LIMIT 1").get() as any;
    const run = db.prepare('SELECT agent_id, task_id FROM agent_task_runs LIMIT 1').get() as any;
    const faults: [keyof typeof zero, () => unknown][] = [
      ['orphaned_holds', () => db.prepare("INSERT INTO ai_budget_reservations (uid, user_id, day_key, month_key, included_microusd, topup_microusd, expires_at, status) VALUES ('bench-orphan', ?, '2026-11-06', '2026-11', 1, 0, '2026-11-06 00:00:00', 'pending')").run(res.user_id)],
      ['double_settlement', () => { for (const ref of ['bench-s1', 'bench-s2']) db.prepare("INSERT INTO ai_credit_ledger (user_id, kind, delta_microusd, source_ref, reservation_uid, actor) VALUES (?, 'spend', -1, ?, ?, 'bench')").run(res.user_id, ref, res.uid); }],
      // The CHECK refuses it, through the metered binding, as it would refuse a service's write.
      ['negative_balance', () => w.env.DB.prepare('UPDATE ai_topup_accounts SET balance_microusd = balance_microusd - 9007199254740991 WHERE user_id = ?').bind(res.user_id).run().then(() => assert.fail('the CHECK refused nothing'), () => {})],
      ['second_live_run', () => { db.exec('DROP INDEX IF EXISTS idx_agent_task_runs_live'); for (const [u, k] of [['bench-l1', 8], ['bench-l2', 9]] as const) db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, workflow_instance_id) VALUES (?, ?, ?, ?, 'running', ?)").run(u, run.agent_id, run.task_id, k, u); }],
      ['missing_charge', () => db.exec('UPDATE ai_usage_logs SET charged_microusd = NULL WHERE id = (SELECT usage_log_id FROM ai_rail_proposals LIMIT 1)')],
      ['duplicate_proposal', () => { db.exec('DROP INDEX IF EXISTS idx_ai_rail_proposals_run_key'); db.exec("INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, run_key) SELECT 'bench-dup', user_id, rail_page, rail_option, kind, payload_json, run_key FROM ai_rail_proposals LIMIT 1"); }],
    ];
    for (const [name, fault] of faults) {
      try { await fault(); } catch (e) { assert.fail(`${name}: the fault could not be made (${(e as Error).message})`); }
      // Mutation checked: each invariant's query replaced by `SELECT 0 AS n` → its line fails.
      assert.ok(invariants(w, [])[name] >= 1, `${name} is counted`);
    }
    // The operations' own counts are summed.
    const seen = invariants(w, [{ crossTenant: 1, unknownAsZero: 1 } as any]);
    assert.deepEqual([seen.cross_tenant_read, seen.unknown_as_zero], [1, 1]);
  } finally { w.db.close(); }
});

test('#4567: an unrecorded charge is unknown, never 0', async () => {
  const w = benchWorld({ tenants: 1 });
  try {
    const r = await runOp(w, { n: 0, kind: 'C', tenant: 0, other: 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const id = Number((w.db.prepare('SELECT usage_log_id AS id FROM ai_rail_proposals LIMIT 1').get() as any).id);
    assert.equal((await chargedFor(w.env, id)).available, true);
    // One guard row unrecorded makes the whole charge unknown.
    w.db.prepare('UPDATE ai_usage_logs SET charged_microusd = NULL WHERE guard_for = ?').run(id);
    assert.deepEqual(await chargedFor(w.env, id), { available: false });
  } finally { w.db.close(); }
});

test('#4567: the control shows the chargedFor scan and the candidate index, and leaves no index behind', () => {
  const w = benchWorld({ tenants: 1 });
  try {
    const [row] = scanControl(w, [500], 5);
    assert.equal(row.rows, 500);
    assert.match(row.plan, /SCAN ai_usage_logs/, 'today: a scan of the usage table');
    assert.match(row.indexed_plan, /SEARCH ai_usage_logs USING INDEX bench_only_guard_for/, 'with the candidate: a search');
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'bench_only_guard_for'").get() as any).n, 0, 'the candidate is dropped');
    assert.throws(() => scanControl(w, [1_000_001]), /1 to 1,000,000/);
  } finally { w.db.close(); }
});

test('#4567: the schedule is deterministic, and its ceilings refuse, never trim', () => {
  assert.deepEqual(schedule({ ops: 50, tenants: 9, seed: 3 }), schedule({ ops: 50, tenants: 9, seed: 3 }));
  assert.notDeepEqual(schedule({ ops: 50, tenants: 9, seed: 3 }), schedule({ ops: 50, tenants: 9, seed: 4 }));
  const only = schedule({ ops: 100, tenants: 5, mix: { D: 1 } });
  assert.ok(only.every((o) => o.kind === 'D'));
  const hot = schedule({ ops: 400, tenants: 50, hot: 0.5, seed: 1 });
  assert.ok(hot.filter((o) => o.tenant === 0).length > 150, 'half the operations go to the hot tenant');
  assert.throws(() => schedule({ ops: 20_001, tenants: 1 }), /ops must be 1 to 20000/);
  assert.throws(() => schedule({ ops: 1, tenants: 1, mix: { A: 0 } }), /names no operation/);
  assert.throws(() => benchWorld({ tenants: 1001 }), /tenants must be 1 to 1000/);
  assert.throws(() => benchWorld({ tenants: 1, run: 'x' }), /run base/);
});

test('#4567: a fingerprint masks every literal, and the CLI report holds no row value', () => {
  assert.equal(fingerprint("SELECT * FROM t WHERE a = 'syn-x@synthetic.invalid' AND b = 42\n  AND c = ?"), "SELECT * FROM t WHERE a = '?' AND b = N AND c = ?");
  const dir = mkdtempSync(join(tmpdir(), 'bench-4567-'));
  try {
    const out = join(dir, 'report.json');
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
      'scripts/d1-benchmark.mjs', '--tenants', '2', '--ops', '30', '--concurrency', '2', '--out', out], { cwd: ROOT, stdio: 'pipe' });
    const text = readFileSync(out, 'utf8');
    const r = JSON.parse(text);
    assert.equal(r.class, 'simulated');
    assert.equal(r.scales[0].tenants, 2);
    assert.ok(Object.values(r.scales[0].invariants).every((n) => n === 0));
    // No synthetic uid, address, prompt or answer: fingerprints and counts only.
    // Mutation checked: `fingerprint` returning the raw SQL → the masked-literal case above fails.
    for (const bad of [/syn-bench/, /synthetic\.invalid/, /Synthetic (ask|step)/, /A synthetic answer/]) assert.doesNotMatch(text, bad);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
