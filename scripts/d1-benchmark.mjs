#!/usr/bin/env node
/**
 * #4567 — the local D1 contention benchmark (harness: `cloudflare-worker/test/_d1_bench.ts`).
 *
 *   npm run bench:d1 -- --tenants 1,10,100,1000 --ops 400 --concurrency 8 --out bench.json
 *   npm run bench:d1 -- --tenants 100 --ramp 1,5,10,25,50,100 --seconds 5 --max-p95-ms 2000
 *   npm run bench:d1 -- --tenants 10 --hot 0.5 --mix A=0,B=50,C=50 --control 1000,10000,100000
 *
 * LOCAL AND SIMULATED. It drives the Worker's own services over a throwaway
 * node:sqlite database built from the actual migrations, seeded with #4566's
 * synthetic fixtures, with inference stubbed. It cannot reach a hosted
 * database, a queue, a Workflow or a model. Latencies are a local file's, so
 * they are relative, never a D1 figure; the report says `class: "simulated"`.
 * The hosted run is the owner's (documentation/operations/D1_BENCHMARK.md).
 *
 * It writes aggregates only: counts, rates, durations, SQL fingerprints with
 * every literal masked, query plans. Never a bind value, a prompt or a row.
 * It exits 1 when any invariant is not 0 (double settlement, missing charge,
 * negative balance, second live run, cross-tenant read, unknown as zero, an
 * orphaned hold or run, a duplicate hold or proposal).
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  BENCH_LIMITS, DEFAULT_MIX, MIX_KEYS, amplification, benchWorld, fairness, footprint, invariants, ramp, runClosed, scanControl, schedule, summarise,
} from '../cloudflare-worker/test/_d1_bench.ts';

const args = process.argv.slice(2);
const value = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const list = (n, d) => String(value(n, d)).split(',').filter(Boolean).map(Number);
const die = (m) => { console.error(`✗ d1-benchmark: ${m}`); process.exit(2); };

const tenantsList = list('--tenants', '1,10,100');
const ops = Number(value('--ops', '200'));
const concurrency = Number(value('--concurrency', '4'));
const seed = Number(value('--seed', '4567'));
const hot = value('--hot') == null ? 0 : Number(value('--hot'));
const agents = Number(value('--agents', '2'));
const rampRates = value('--ramp') ? list('--ramp') : null;
const seconds = Number(value('--seconds', '5'));
const maxOps = Number(value('--max-ops', String(BENCH_LIMITS.ops)));
const maxErrorRate = Number(value('--max-error-rate', '0.01'));
const maxP95Ms = Number(value('--max-p95-ms', '2000'));
const control = value('--control') ? list('--control') : [];
const out = value('--out');
let mix = DEFAULT_MIX;
if (value('--mix')) {
  mix = {};
  for (const part of value('--mix').split(',')) {
    const [k, v] = part.split('=');
    if (!MIX_KEYS.includes(k) || !(Number(v) >= 0)) die(`--mix takes A..E=weight, not ${JSON.stringify(part)}`);
    mix[k] = Number(v);
  }
}
if (tenantsList.some((t) => !Number.isSafeInteger(t) || t < 1 || t > BENCH_LIMITS.tenants)) die(`each --tenants value is 1 to ${BENCH_LIMITS.tenants}`);
if (!(concurrency >= 1 && concurrency <= 64)) die('--concurrency is 1 to 64');
if (!(agents >= 1 && agents <= 3)) die('--agents is 1 to 3 (one per role)');
if (!(hot >= 0 && hot < 1)) die('--hot is a share from 0 to below 1');

const commit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })();
const sqlite = new DatabaseSync(':memory:').prepare('SELECT sqlite_version() AS v').get().v;
const report = {
  class: 'simulated',
  note: 'Local node:sqlite over the actual migrations, synthetic fixtures, stubbed inference. Latencies are relative, never a D1 capacity figure.',
  issue: 4567, taken_at: new Date().toISOString(), commit, node: process.version, sqlite,
  options: { tenants: tenantsList, ops, concurrency, seed, hot, agents, mix, ramp: rampRates, seconds, maxOps, maxErrorRate, maxP95Ms, control },
  scales: [], control: null,
};
let bad = 0;
for (const tenants of tenantsList) {
  const w = benchWorld({ tenants, agentsPerTenant: agents });
  const before = footprint(w);
  const t0 = performance.now();
  let results, steps = null, stopped = null;
  if (rampRates) ({ results, steps, stopped } = await ramp(w, { rates: rampRates, seconds, tenants, mix, seed, hot, maxOps, maxErrorRate, maxP95Ms }));
  else results = await runClosed(w, schedule({ ops, tenants, mix, seed, hot }), concurrency);
  const wall = (performance.now() - t0) / 1000;
  const after = footprint(w);
  const inv = invariants(w, results);
  const executions = results.reduce((s, r) => s + r.executions, 0);
  const growth = executions ? Math.round(((after.bytes - before.bytes) / executions) * 1000) : null;
  const rows = Object.fromEntries(Object.keys(after.rows).map((k) => [k, after.rows[k] - before.rows[k]]));
  const amp = amplification(w);
  report.scales.push({
    tenants, agents_per_tenant: agents, ops: results.length, executions, wall_s: Math.round(wall * 100) / 100,
    completed_ops_s: Math.round((results.filter((r) => !r.error).length / wall) * 100) / 100,
    statements: amp.reduce((s, a) => s + a.count, 0), seeded_bytes: before.bytes,
    // The share of wall time spent inside SQL: near 1 means the database is the bottleneck, low means the services' own work is.
    sql_time_share: Math.round((amp.reduce((s, a) => s + a.total_ms, 0) / (wall * 1000)) * 1000) / 1000,
    bytes_per_1k_executions: growth, rows_added: rows, by_mix: summarise(results), fairness: fairness(results), invariants: inv,
    ramp: steps, stopped,
    hot_fingerprints: amp.slice(0, 25),
    scans: amp.filter((a) => a.scans.length).map((a) => ({ fingerprint: a.fingerprint, count: a.count, ops: a.ops, scans: a.scans })),
  });
  bad += Object.values(inv).reduce((s, n) => s + n, 0);
  if (tenants === tenantsList[tenantsList.length - 1] && control.length) report.control = scanControl(w, control);
  w.db.close();
  console.log(`· ${tenants} tenants: ${results.length} ops, ${executions} executions, invariants ${Object.values(inv).every((n) => n === 0) ? 'all 0' : JSON.stringify(inv)}`);
}
if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (bad) { console.error('✗ d1-benchmark: an invariant is not 0'); process.exit(1); }
console.log(`✓ d1-benchmark: every invariant is 0${out ? `; wrote ${out}` : ''}`);
