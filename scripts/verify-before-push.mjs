#!/usr/bin/env node
/**
 * #6326: the local checks before a push, for the `verify-before-push` skill,
 * in steps that each finish inside one session.
 *
 *   plan    [--base REF] [--full] [--files a,b]        print the steps for this change, in order
 *   run     [--base REF] [--full] [--files a,b]
 *           [--only id,id | --from id] [--log-dir DIR] [--timeout-min N] [--stop-on-fail]
 *                                                      run them; one log per step, exit codes kept
 *   summary [--log-dir DIR]                            the results so far, and a STATUS tests: line
 *
 * The changed files are `git diff <merge-base of --base, default origin/main>`
 * plus uncommitted and untracked files. The order mirrors ci.yml: generated
 * modules, the root build, test:guards and the static checks, ci / fast's
 * migration and LFS gates, the tests that import a changed file, then the
 * test:drift parts (scripts/test-drift-parts.mjs).
 * Which steps a change needs is advisory (D5610); `--full` runs what
 * `npm run test:drift` runs. Each step runs in its own process group and is
 * killed at its timeout. Results accumulate in <log-dir>/summary.json, keyed
 * to the working tree, so steps run across several calls add up and a result
 * from an older tree shows as STALE. Reads git and runs local commands only:
 * it never pushes, merges or calls GitHub. The rules live in
 * `lib/verifyBeforePush.mjs`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, readSync, fstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planSteps, chooseSteps, affectedTests, envFailures, caseCollisions, preflightNotes,
  mergeResults, renderSummary, testsLine,
} from './lib/verifyBeforePush.mjs';
import { partsOf } from './test-drift-parts.mjs';
import { testFiles, importGraph } from './select-tests.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node scripts/verify-before-push.mjs plan|run|summary [--base REF] [--full] [--files a,b] [--only id,id | --from id] [--log-dir DIR] [--timeout-min N] [--stop-on-fail]';

const git = (args, opts = {}) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim().slice(0, 200)}`);
  return r.stdout;
};

function argOf(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`--${name} needs a value`);
  return v;
}

function changedFiles(base) {
  const mb = git(['merge-base', base, 'HEAD']).trim();
  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  return [...new Set([
    ...lines(git(['diff', '--name-only', `${mb}...HEAD`])),
    ...lines(git(['diff', '--name-only', 'HEAD'])),
    ...lines(git(['ls-files', '--others', '--exclude-standard'])),
  ])].sort();
}

/** The working tree's identity: HEAD, the uncommitted diff and the untracked files. */
function treeId() {
  const h = createHash('sha256');
  h.update(git(['rev-parse', 'HEAD']));
  h.update(git(['diff', 'HEAD', '--binary']));
  for (const f of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
    h.update(f);
    try { h.update(readFileSync(join(ROOT, f))); } catch { /* removed meanwhile */ }
  }
  return h.digest('hex').slice(0, 16);
}

function caseInsensitiveFs() {
  // package.json is tracked at the root; its upper-case name exists only on a case-insensitive file system.
  return existsSync(join(ROOT, 'PACKAGE.JSON'));
}

function preflight(logDir) {
  const missingModules = ['node_modules', 'frontend/node_modules', 'cloudflare-worker/node_modules'].filter((d) => !existsSync(join(ROOT, d)));
  const insensitive = caseInsensitiveFs();
  const collisions = insensitive ? caseCollisions(git(['ls-files']).split('\n').filter(Boolean)) : [];
  const rel = relative(ROOT, logDir);
  return preflightNotes({ nodeMajor: Number(process.versions.node.split('.')[0]), missingModules, caseInsensitive: insensitive, collisions, logDirInRepo: !rel.startsWith('..') && !rel.startsWith('/') });
}

function buildPlan(argv) {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const full = argv.includes('--full');
  const files = argOf(argv, 'files');
  const base = argOf(argv, 'base') || 'origin/main';
  if (!/^[\w./-]+$/.test(base)) throw new Error('--base must be a ref name');
  const changed = files ? files.split(',').map((s) => s.trim()).filter(Boolean) : changedFiles(base);
  let affected = [];
  if (!full && changed.length) {
    const tests = testFiles();
    affected = affectedTests(changed, tests, importGraph(tests));
  }
  return { changed, ...planSteps({ changed, scripts, parts: partsOf(scripts), affected, full, base }) };
}

function tail(path, bytes = 64 * 1024) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}

function runOne(step, logDir, timeoutMin) {
  const log = join(logDir, `${step.id}.log`);
  const cmd = step.cmd.replaceAll('<log-dir>', logDir);
  const fd = openSync(log, 'w');
  writeFileSync(fd, `> ${cmd}\n\n`);
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn('sh', ['-c', cmd], { cwd: ROOT, stdio: ['ignore', fd, fd], detached: true });
    let timedOut = false;
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 10_000).unref(); }, timeoutMin * 60_000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      closeSync(fd);
      const seconds = Math.round((Date.now() - started) / 1000);
      const status = timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail';
      const env = status === 'fail' ? envFailures(tail(log)) : [];
      done({ id: step.id, status, exit: code ?? signal, seconds, log, env, at: new Date().toISOString() });
    });
  });
}

/** The suite-plan step: write test-drift-parts' equal-weight plan into the log dir, never the repo root. */
function writeSuitePlan(logDir) {
  const started = Date.now();
  const target = join(ROOT, 'suite-plan.json');
  const had = existsSync(target) ? readFileSync(target) : null;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/test-drift-parts.mjs'), '--plan', join(logDir, 'no-timings.json')], { cwd: ROOT, encoding: 'utf8' });
  const log = join(logDir, 'suite-plan.log');
  writeFileSync(log, `${r.stdout || ''}${r.stderr || ''}`);
  if (r.status === 0 && existsSync(target)) {
    renameSync(target, join(logDir, 'suite-plan.json'));
    if (had) writeFileSync(target, had);
  }
  return { id: 'suite-plan', status: r.status === 0 ? 'pass' : 'fail', exit: r.status, seconds: Math.round((Date.now() - started) / 1000), log, env: [], at: new Date().toISOString() };
}

const readSummary = (logDir) => { try { return JSON.parse(readFileSync(join(logDir, 'summary.json'), 'utf8')); } catch { return { results: {}, order: [], skipped: [] }; } };
/** The plan's step ids that should have a result: its order without the skipped steps. */
const planned = (s) => (s.order || []).filter((id) => !(s.skipped || []).includes(id));

async function main(argv) {
  const cmd = argv[0];
  if (!['plan', 'run', 'summary'].includes(cmd)) { console.error(USAGE); return 2; }
  const logDir = resolve(argOf(argv, 'log-dir') || join(tmpdir(), 'verify-before-push'));
  if (cmd === 'summary') {
    const s = readSummary(logDir);
    const tree = treeId();
    for (const r of Object.values(s.results)) r.stale = r.tree !== tree;
    console.log(renderSummary(s.results, s.order) || '(no results yet)');
    console.log(`\n${testsLine(s.results, planned(s))}`);
    return 0;
  }
  for (const n of preflight(logDir)) console.log(`note: ${n}`);
  const plan = buildPlan(argv);
  console.log(`changed: ${plan.changed.length} file(s); areas: ${plan.areas.join(', ') || 'none'}`);
  if (cmd === 'plan') {
    const shown = (s) => (s.cmd && s.cmd.length > 240 ? `${s.cmd.slice(0, 240)} … (${s.files.length} files)` : s.cmd ?? '-');
    for (const s of plan.steps) console.log(`${s.id.padEnd(22)} ${s.kind.padEnd(8)} ${String(s.timeoutMin).padStart(2)}m  ${shown(s)}\n${' '.repeat(36)}${s.why}`);
    return 0;
  }
  const timeoutArg = argOf(argv, 'timeout-min');
  const timeoutOverride = timeoutArg === null ? null : Number(timeoutArg);
  if (timeoutOverride !== null && !(timeoutOverride > 0)) throw new Error('--timeout-min must be a positive number');
  const { chosen, unknown } = chooseSteps(plan.steps, { only: argOf(argv, 'only'), from: argOf(argv, 'from') });
  if (unknown.length) { console.error(`unknown step(s): ${unknown.join(', ')}. Steps: ${plan.steps.map((s) => s.id).join(', ')}`); return 2; }
  mkdirSync(logDir, { recursive: true });
  const tree = treeId();
  const results = [];
  const save = () => {
    const prev = readSummary(logDir);
    writeFileSync(join(logDir, 'summary.json'), `${JSON.stringify({ tree, order: plan.steps.map((s) => s.id), skipped: plan.steps.filter((s) => s.kind === 'skipped').map((s) => s.id), results: mergeResults(prev.results, results, tree) }, null, 2)}\n`);
  };
  for (const step of chosen) {
    if (step.kind === 'skipped') { results.push({ id: step.id, status: 'skipped', exit: null, seconds: 0, log: step.why, env: [] }); save(); continue; }
    process.stdout.write(`${step.id} … `);
    const r = step.kind === 'plan' ? writeSuitePlan(logDir) : await runOne(step, logDir, timeoutOverride ?? step.timeoutMin);
    results.push(r);
    save();
    console.log(`${r.status} (exit ${r.exit}, ${r.seconds}s) ${r.log}`);
    for (const e of r.env) console.log(`  env:${e.code}: ${e.note}`);
    const fatal = r.status !== 'pass' && (step.kind === 'setup' || step.kind === 'plan');
    if (fatal || (r.status !== 'pass' && argv.includes('--stop-on-fail'))) { console.log(fatal ? `stopping: ${step.id} is needed by every later step` : 'stopping: --stop-on-fail'); break; }
  }
  const s = readSummary(logDir);
  console.log(`\n${renderSummary(s.results, s.order)}\n\n${testsLine(s.results, planned(s))}`);
  return results.every((r) => r.status === 'pass' || r.status === 'skipped') ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`verify-before-push: ${e.message}`); process.exit(2); });
}
