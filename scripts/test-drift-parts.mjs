#!/usr/bin/env node
/**
 * D5609 (#5609): test:drift parts derived from package scripts. SHARDS is the
 * only count source. --plan <timings.json> writes suite-plan.json and emits
 * a compact JSON array of names; --without-rest omits rest from that array.
 * <part> --plan-file <path> validates exact-once coverage before executing
 * the current package command with explicit files. No node count sharding.
 * --list prints names only; local npm run test:drift remains unchanged.
 */
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { planParts, assertExactOnce } from './lib/shardPlan.mjs';

/** How many shards each long test script is cut into. */
export const SHARDS = Object.freeze({
  'test:frontend': 2,
  'test:worker': 6,
});

/** The name of the part that runs every step of test:drift not in SHARDS. */
export const REST = 'rest';

const SHARD_NAME = (script, i, n) => `${script.replace(/^test:/, '')}-${i}-of-${n}`;

/** Separate the node invocation from its test patterns; refuse compound commands. */
export function testCommand(cmd) {
  if (/&&|\|\||;/.test(cmd)) throw new Error(`cannot shard a compound command: ${cmd}`);
  if (/--test-shard/.test(cmd)) throw new Error(`already sharded: ${cmd}`);
  const marks = cmd.split(' ').filter((w) => w === '--test').length;
  if (marks !== 1) throw new Error(`expected exactly one --test in: ${cmd}`);
  const at = cmd.indexOf(' --test ');
  if (at < 0) throw new Error(`expected test files in: ${cmd}`);
  const patterns = cmd.slice(at + 8).match(/'[^']*'|"[^"]*"|\S+/g) || [];
  if (!patterns.length) throw new Error('no test files');
  return { prefix: cmd.slice(0, at + 8), patterns: patterns.map((s) => s.replace(/^['"]|['"]$/g, '')) };
}

export function suiteFiles(cmd, root = process.cwd()) {
  return [...new Set(testCommand(cmd).patterns.flatMap((p) => [...globSync(p, { cwd: root })]))].sort();
}

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;

export function plannedCommand(cmd, files) {
  if (!files.length) throw new Error('empty planned part');
  for (const file of files) if (!/^[\w./-]+\.test\.(?:mjs|ts)$/.test(file) || file.split('/').includes('..')) throw new Error(`unsafe test path: ${file}`);
  return testCommand(cmd).prefix + files.map(quote).join(' ');
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
    testCommand(cmd);
    for (let i = 1; i <= n; i++) parts.push({ name: SHARD_NAME(m[1], i, n), script: m[1], commands: [cmd] });
  }
  for (const name of Object.keys(shards)) {
    if (!seen.has(name)) throw new Error(`SHARDS names ${name}, which test:drift does not run`);
  }
  if (rest.length) parts.push({ name: REST, commands: rest });
  return parts;
}

export function buildPlan(scripts, timings = {}, root = process.cwd(), shards = SHARDS) {
  const parts = partsOf(scripts, shards);
  for (const [script, count] of Object.entries(shards)) {
    const files = suiteFiles(scripts[script], root);
    if (files.length < count) throw new Error(`${script}: fewer files than parts`);
    const packed = planParts({ files, timings, parts: count });
    parts.filter((p) => p.script === script).forEach((p, i) => Object.assign(p, packed[i], { commands: [plannedCommand(scripts[script], packed[i].files)] }));
  }
  return { version: 1, parts };
}

export function validatePlan(plan, scripts, root = process.cwd()) {
  const expected = partsOf(scripts);
  if (plan.version !== 1 || JSON.stringify(plan.parts.map((p) => p.name)) !== JSON.stringify(expected.map((p) => p.name))) throw new Error('plan part names do not match SHARDS');
  for (const script of Object.keys(SHARDS)) assertExactOnce(plan.parts.filter((p) => p.script === script), suiteFiles(scripts[script], root));
  // Execute commands derived from current package scripts, never artifact command text.
  return expected.map((p) => p.script ? { ...p, commands: [plannedCommand(scripts[p.script], plan.parts.find((q) => q.name === p.name).files)] } : p);
}

function main(argv) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const parts = partsOf(scripts);
  const arg = argv[0];
  if (arg === '--plan') {
    // A missing timings artifact means equal weights; malformed data is a failed plan.
    let timings = {};
    try { timings = JSON.parse(readFileSync(resolve(root, argv[1]), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const plan = buildPlan(scripts, timings, root);
    writeFileSync(resolve(root, 'suite-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify(plan.parts.filter((p) => !argv.includes('--without-rest') || p.name !== REST).map((p) => p.name)));
    return 0;
  }
  if (arg === '--list') {
    for (const p of parts) console.log(p.name);
    return 0;
  }
  const index = argv.indexOf('--plan-file');
  if (index < 0 || !argv[index + 1]) throw new Error('a part requires --plan-file <path>');
  const planned = validatePlan(JSON.parse(readFileSync(resolve(root, argv[index + 1]), 'utf8')), scripts, root);
  const part = planned.find((p) => p.name === arg);
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
