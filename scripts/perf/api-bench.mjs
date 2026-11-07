#!/usr/bin/env node
/**
 * #4573 (Performance P1) — the API flows' D1 statement counts and in-process
 * timings, through the whole Worker over the migrated schema with synthetic
 * accounts (cloudflare-worker/test/_perf_harness.ts). No network, no model.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     scripts/perf/api-bench.mjs [--iterations=200] [--json=<file>]
 *
 * READ THE TIMINGS AS RELATIVE ONLY. They are node:sqlite in the same process:
 * no D1 round trip, no isolate start, no network. They rank flows against
 * each other on one machine; they are not production latency. The statement
 * counts are exact and deterministic, and each D1 statement in production is
 * a round trip, which is why the counts are the budgeted number.
 *
 * NOT MEASURED HERE: an isolate's start. Importing `src/index.ts` under the
 * test loader times TypeScript stripping, which Workers never pays. The
 * deployed script's size is the honest proxy, from
 * `cd cloudflare-worker && npx wrangler deploy --dry-run --outdir <dir> --config ../wrangler.toml`
 * (recorded in the baseline report).
 */
import { writeFileSync } from 'node:fs';
import { FLOWS, harness, repeats } from '../../cloudflare-worker/test/_perf_harness.ts';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const iterations = Number(arg('iterations', '200')) || 200;
const pct = (xs, p) => { const s = [...xs].sort((a, z) => a - z); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const r2 = (v) => Math.round(v * 100) / 100;


const h = await harness();
const flows = [];
try {
  for (const flow of FLOWS) {
    await h.request(flow);
    const first = await h.request(flow);
    const ms = [];
    for (let i = 0; i < iterations; i += 1) {
      const r = await h.request(flow, { freshLimits: true });
      if (r.status !== first.status) throw new Error(`${flow.name}: answered ${r.status} in the timing loop, ${first.status} at first`);
      ms.push(r.ms);
    }
    flows.push({
      name: flow.name, path: flow.path, status: first.status,
      statements: { total: first.total, auth: first.auth, telemetry: first.telemetry, route: first.route },
      repeated: repeats(first.statements),
      in_process_ms: { p50: r2(pct(ms, 50)), p95: r2(pct(ms, 95)), p99: r2(pct(ms, 99)) },
    });
  }
} finally { h.close(); }
const report = { iterations, node: process.version, flows };
const json = arg('json', null);
if (json) writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
for (const f of flows) {
  console.log(`${f.name.padEnd(28)} ${String(f.status).padEnd(4)} statements ${String(f.statements.total).padStart(3)} (auth ${f.statements.auth}, telemetry ${f.statements.telemetry}, route ${f.statements.route})  in-process p50 ${f.in_process_ms.p50} p95 ${f.in_process_ms.p95} p99 ${f.in_process_ms.p99} ms`);
}
