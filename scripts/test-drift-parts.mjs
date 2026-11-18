#!/usr/bin/env node
/**
 * D4130 (not a check): cuts `npm run test:drift` into the parts CI runs in
 * parallel, derived from `package.json` — the frontend and worker suites as
 * `--test-shard` shards (`SHARDS`), everything else as `rest`. `--list` prints
 * the parts; `<part>` runs one. `frontend/test/ci_suite_parts_4130.test.mjs`
 * holds the union to the suite and ci.yml's matrix to the parts. Locally, run
 * the whole suite with `npm run test:drift`.
 *
 * D5609 (#5609): test:drift parts derived from package scripts. SHARDS is the
 * only count source. --plan <timings.json> writes suite-plan.json and emits
 * a compact JSON array of names; --without-rest omits rest from that array.
 * <part> --plan-file <path> validates exact-once coverage before executing
 * the current package command with explicit files. No node count sharding.
 * --list prints names only; local npm run test:drift remains unchanged.
 * --plan --equal-weights reads no timings file (D7108 part 2: merge_group).
 *
 * D6464 (#6464): under merge_group only, a node:test command also writes its
 * failed tests (lib/failedTestsReporter.mjs). When it fails and every failed
 * test is on scripts/flaky-tests.json, in a file the queue entry did not
 * change, those files run once more; a pass is written to the job summary as
 * "flaky, retried". Nothing else is ever retried, and never on PRs or pushes.
 */
import { readFileSync, writeFileSync, globSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { planParts, assertExactOnce, newestMainArtifact } from './lib/shardPlan.mjs';
import { buildGenerated } from './build-generated.mjs';
import { retryDecision } from './lib/flakyTests.mjs';

/** How many shards each long test script is cut into. */
export const SHARDS = Object.freeze({
  'test:frontend': 2,
  'test:worker': 6,
});

/** The name of the part that runs every step of test:drift not in SHARDS. */
export const REST = 'rest';

/**
 * D7108 part 2: `--plan --equal-weights` plans with no timings at all. The
 * merge-queue shards use it, so their plan is a pure function of the commit.
 */
export const EQUAL_WEIGHTS = '--equal-weights';

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

/** Whether a part command is one node:test run this file can re-run by file. */
export function isNodeTest(cmd) {
  try { testCommand(cmd); return true; } catch { return false; }
}

/** D6464: the same command, with TAP kept on stdout and failed tests written to `out`. */
export function withFailureReporter(cmd, out, reporter) {
  const { prefix } = testCommand(cmd);
  const at = prefix.length - ' --test '.length;
  return `${cmd.slice(0, at)} --test-reporter=tap --test-reporter-destination=stdout --test-reporter=${quote(reporter)} --test-reporter-destination=${quote(out)}${cmd.slice(at)}`;
}

/** D6464: the reporter's file as [{ file, test }]; unreadable or malformed means none. */
export function readFailures(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      .filter((f) => typeof f?.file === 'string' && typeof f?.test === 'string');
  } catch { return []; }
}

/** D6464: the tracked list; a missing or malformed file is an empty list, so nothing retries. */
export function readFlakyList(root) {
  try {
    const data = JSON.parse(readFileSync(resolve(root, 'scripts/flaky-tests.json'), 'utf8'));
    return Array.isArray(data?.tests) ? data.tests : [];
  } catch { return []; }
}

/** D6464: files the merge-queue entry changed against its base, or null when they cannot be read. */
export function queueChangedFiles(root, env = process.env, run = spawnSync) {
  let base; let head;
  try { ({ base_sha: base, head_sha: head } = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).merge_group || {}); }
  catch { return null; }
  if (!/^[0-9a-f]{40}$/.test(base || '') || !/^[0-9a-f]{40}$/.test(head || '')) return null;
  const diff = () => run('git', ['diff', '--name-only', base, head], { cwd: root, encoding: 'utf8' });
  let r = diff();
  if (r.status !== 0) {
    run('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], { cwd: root, encoding: 'utf8' });
    r = diff();
  }
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
}

/**
 * D6464: after `cmd` failed under merge_group, re-run its failed files once
 * when retryDecision allows it. Returns { status, lines }: status 0 only when
 * the retry ran and passed; `lines` go to the log and the job summary.
 */
export function retryFailed({ cmd, failures, list, changedFiles, event, exec }) {
  const decision = retryDecision({ event, failures, list, changedFiles });
  if (!decision.retry) return { status: 1, lines: [`No retry: ${decision.reason}.`] };
  const again = plannedCommand(cmd, decision.files);
  const status = exec(again);
  const named = failures.map((f) => `- \`${f.file}\` › ${f.test}`);
  return status === 0
    ? { status: 0, lines: ['### Flaky, retried', `These listed flaky tests failed, and their files passed on one retry (\`scripts/flaky-tests.json\`):`, ...named] }
    : { status: status || 1, lines: ['### Flaky retry failed', 'These listed flaky tests failed, and failed again on their one retry:', ...named] };
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
  const identity = (p) => ({ name: p.name, script: p.script });
  if (plan.version !== 1 || JSON.stringify(plan.parts.map(identity)) !== JSON.stringify(expected.map(identity))) throw new Error('plan part names/scripts do not match SHARDS');
  for (const script of Object.keys(SHARDS)) assertExactOnce(plan.parts.filter((p) => p.script === script), suiteFiles(scripts[script], root));
  // Execute commands derived from current package scripts, never artifact command text.
  return expected.map((p) => p.script ? { ...p, commands: [plannedCommand(scripts[p.script], plan.parts.find((q) => q.name === p.name).files)] } : p);
}

/** #5608's artifact keeps metadata outside the per-test timing map. */
export function timingsOf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid timings artifact');
  if (!Object.hasOwn(input, 'tests')) return input;
  if (!input.tests || typeof input.tests !== 'object' || Array.isArray(input.tests)) throw new Error('invalid timing tests');
  return Object.fromEntries(Object.entries(input.tests).map(([file, row]) => [file, row.wallMs]));
}

function main(argv) {
  if (argv[0] === '--main-artifact') {
    const artifacts = JSON.parse(readFileSync(argv[1], 'utf8')).artifacts;
    const commits = JSON.parse(readFileSync(argv[2], 'utf8'));
    if (!Array.isArray(artifacts) || !Array.isArray(commits) ||
        !artifacts.every(row => row && typeof row.name === 'string' && typeof row.created_at === 'string' &&
          typeof row.expired === 'boolean' && Number.isSafeInteger(row.id) && row.id > 0) ||
        !commits.every(row => row && typeof row.sha === 'string' && row.sha.length > 0)) {
      throw new Error('invalid timing artifact or main commit inventory');
    }
    const artifact = newestMainArtifact(artifacts, commits);
    if (artifact) console.log(artifact.id);
    return 0;
  }
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const parts = partsOf(scripts);
  const arg = argv[0];
  if (arg === '--plan') {
    // A missing timings artifact means equal weights; malformed data is a failed plan.
    // D7108 part 2: --equal-weights pins the input to {} and reads no file, so
    // every merge-queue shard computes the same plan from its checkout alone.
    let timings = {};
    if (argv[1] !== EQUAL_WEIGHTS) try {
      const input = JSON.parse(readFileSync(resolve(root, argv[1]), 'utf8'));
      // #5608 emits commit metadata plus per-test wallMs/exitCode.
      timings = timingsOf(input);
    }
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
  // Direct test commands have no npm pretest hook (D5612). Read-only
  // planner modes keep stdout reserved for their machine-readable result.
  const generated = buildGenerated();
  if (generated !== 0) return generated;
  const env = { ...process.env };
  if (env.TEST_TRACE_DIR) {
    const tracer = pathToFileURL(resolve(root, 'scripts/ci/test-tracer.mjs')).href;
    env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${tracer}`].filter(Boolean).join(' ');
    env.TEST_TRACE_ROOT = root;
  }
  const event = env.GITHUB_EVENT_NAME;
  const sh = (command) => spawnSync('sh', ['-c', command], { cwd: root, stdio: 'inherit', env });
  for (const [i, cmd] of part.commands.entries()) {
    const watch = event === 'merge_group' && isNodeTest(cmd);
    const out = resolve(tmpdir(), `failed-tests-${process.pid}-${i}.jsonl`);
    if (watch && existsSync(out)) rmSync(out);
    const run = watch ? withFailureReporter(cmd, out, resolve(root, 'scripts/lib/failedTestsReporter.mjs')) : cmd;
    console.log(`\n> ${run}\n`);
    const r = sh(run);
    if (r.status === 0) continue;
    console.error(`test-drift-parts: "${cmd}" exited ${r.status ?? r.signal}`);
    if (!watch) return r.status || 1;
    const retried = retryFailed({ cmd, failures: readFailures(out), list: readFlakyList(root),
      changedFiles: queueChangedFiles(root, env), event, exec: (command) => { console.log(`\n> ${command}\n`); return sh(command).status; } });
    for (const line of retried.lines) console.log(`test-drift-parts: ${line}`);
    if (env.GITHUB_STEP_SUMMARY && retried.lines[0].startsWith('###')) appendFileSync(env.GITHUB_STEP_SUMMARY, `${retried.lines.join('\n')}\n\n`);
    if (retried.status !== 0) return r.status || 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
