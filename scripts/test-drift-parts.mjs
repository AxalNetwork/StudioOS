#!/usr/bin/env node
/**
 * D4130 (#4130): `npm run test:drift` cut into parts that CI runs in parallel.
 *
 * The suite took 74 minutes as one job on one runner (main at c8c362cd17,
 * 2026-11-02). Almost all of it was the frontend and worker test suites; the
 * guards, types and lint took under 2 minutes. CI now runs this script once
 * per part, in a matrix, and the job named `test:drift (full suite)` passes
 * only when every part passed.
 *
 * The parts are DERIVED from package.json's `test:drift`, never typed here, so
 * a step added to the suite lands in a part without anyone remembering:
 *   - each script named in SHARDS becomes N parts, the same command with
 *     `--test-shard=i/N` after `--test` (node's own sharding: every test file
 *     runs in exactly one shard);
 *   - every other step of `test:drift` runs, in order, in the part `rest`.
 * frontend/test/ci_suite_parts_4130.test.mjs proves the union is exactly the
 * suite, and that ci.yml's matrix lists exactly these parts.
 *
 * Usage:
 *   node scripts/test-drift-parts.mjs --list     the part names, one per line
 *   node scripts/test-drift-parts.mjs <part>     run one part; exits non-zero
 *                                                on the first failing step
 * Locally, `npm run test:drift` is still the whole suite in one go.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** How many shards each long test script is cut into. */
export const SHARDS = Object.freeze({
  'test:frontend': 2,
  'test:worker': 6,
});

/** The name of the part that runs every step of test:drift not in SHARDS. */
export const REST = 'rest';

const SHARD_NAME = (script, i, n) => `${script.replace(/^test:/, '')}-${i}-of-${n}`;

/** `cmd` with node's shard flag after its `--test`. Refuses anything it cannot cut safely. */
export function shardCommand(cmd, i, n) {
  if (/&&|\|\||;/.test(cmd)) throw new Error(`cannot shard a compound command: ${cmd}`);
  if (/--test-shard/.test(cmd)) throw new Error(`already sharded: ${cmd}`);
  const marks = cmd.split(' ').filter((w) => w === '--test').length;
  if (marks !== 1) throw new Error(`expected exactly one --test in: ${cmd}`);
  return cmd.replace(' --test ', ` --test --test-shard=${i}/${n} `);
}

/**
 * The parts, in order: [{ name, commands }]. `scripts` is package.json's
 * `scripts` object.
 */
export function partsOf(scripts, shards = SHARDS) {
  const drift = scripts['test:drift'];
  if (typeof drift !== 'string' || !drift.trim()) throw new Error('package.json has no test:drift script');
  const steps = drift.split(' && ').map((s) => s.trim());
  const parts = [];
  const rest = [];
  const seen = new Set();
  for (const step of steps) {
    const m = /^npm run (\S+)$/.exec(step);
    const n = m && shards[m[1]];
    if (!n) { rest.push(step); continue; }
    if (seen.has(m[1])) throw new Error(`test:drift runs ${m[1]} twice`);
    seen.add(m[1]);
    const cmd = scripts[m[1]];
    if (typeof cmd !== 'string') throw new Error(`test:drift names ${m[1]}, which package.json does not define`);
    for (let i = 1; i <= n; i++) parts.push({ name: SHARD_NAME(m[1], i, n), commands: [shardCommand(cmd, i, n)] });
  }
  for (const name of Object.keys(shards)) {
    if (!seen.has(name)) throw new Error(`SHARDS names ${name}, which test:drift does not run`);
  }
  if (rest.length) parts.push({ name: REST, commands: rest });
  return parts;
}

function main(argv) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const parts = partsOf(scripts);
  const arg = argv[0];
  if (arg === '--list') {
    for (const p of parts) console.log(p.name);
    return 0;
  }
  const part = parts.find((p) => p.name === arg);
  if (!part) {
    console.error(`test-drift-parts: unknown part "${arg}". Parts: ${parts.map((p) => p.name).join(', ')}`);
    return 2;
  }
  for (const cmd of part.commands) {
    console.log(`\n> ${cmd}\n`);
    const r = spawnSync('sh', ['-c', cmd], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`test-drift-parts: "${cmd}" exited ${r.status ?? r.signal}`);
      return r.status || 1;
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
