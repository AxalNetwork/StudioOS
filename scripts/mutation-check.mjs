#!/usr/bin/env node
/**
 * #6326: mutation-check the assertions a branch adds (AGENTS.md § House rules,
 * **Tests**: "Mutation-check every new assertion both ways"). Used by the
 * `mutation-check` skill (.claude/skills/mutation-check/SKILL.md).
 *
 *   node scripts/mutation-check.mjs list [--base <ref>]
 *       The test files this branch adds or changes (against the merge base
 *       with origin/main, plus uncommitted and untracked files), each with the
 *       command that runs it alone, and the changed code beside them.
 *   node scripts/mutation-check.mjs run --spec <file.json> [--only id,id] [--timeout <ms>] [--json <out.json>]
 *       Runs each named test unmutated (it must pass), then applies each
 *       mutation alone, runs its test (it must fail), restores the file
 *       byte for byte, and finally runs every test again (it must pass).
 *       Prints a table and the summary line for STATUS and the PR.
 *   node scripts/mutation-check.mjs restore
 *       Puts back any file a killed run left mutated, from its backup.
 *
 * The spec is a JSON array of { id?, file, find, replace, test, expect?, equivalent? }.
 * `find` must occur exactly once in `file`. `expect` is part of the name of the
 * test that should fail. `equivalent` is the reason a mutation cannot be
 * caught; it is reported, never hidden.
 *
 * The working tree is never left modified: originals are held in memory and
 * in a backup outside the repository, and restored after every mutation, on
 * error, on Ctrl-C and on exit. It never commits, pushes or touches GitHub.
 * Decisions live in `lib/mutationCheck.mjs`.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyMutation, changedTests, parseSpec, runnerFor, runPassed, sha256, summaryLine,
  tapCounts, testArgv, testCommandLine, verdict,
} from './lib/mutationCheck.mjs';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const JOURNAL_DIR = join(tmpdir(), 'studioos-mutation-check', sha256(ROOT).slice(0, 16));
const JOURNAL = join(JOURNAL_DIR, 'journal.json');

function flag(args, name, fallback = null) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) die(`${name} needs a value`);
  return v;
}
function die(msg, code = 2) { console.error(`mutation-check: ${msg}`); process.exit(code); }
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

// ---------------------------------------------------------------- list
function list(args) {
  const base = flag(args, '--base', 'origin/main');
  let paths;
  try {
    paths = [
      ...git('diff', '--name-only', `${base}...HEAD`),
      ...git('diff', '--name-only', 'HEAD'),
      ...git('ls-files', '--others', '--exclude-standard'),
    ];
  } catch {
    die(`cannot diff against ${base}; run git fetch origin main, or pass --base <ref>`);
  }
  paths = [...new Set(paths)].filter((p) => existsSync(join(ROOT, p)));
  const tests = changedTests(paths);
  const code = paths.filter((p) => !tests.includes(p) && /\.(ts|tsx|mjs|js|jsx)$/.test(p) && !/\.test\./.test(p)).sort();
  console.log(`Changed test files (${tests.length}), each run alone:`);
  for (const t of tests) console.log(`  ${t}\n    ${testCommandLine(t)}`);
  const unknown = paths.filter((p) => /\.test\.(ts|mjs|js)$/.test(p) && !runnerFor(p));
  if (unknown.length) console.log(`No known runner (check its package.json script by hand): ${unknown.join(', ')}`);
  console.log(`\nChanged code the assertions may protect (${code.length}):`);
  for (const c of code) console.log(`  ${c}`);
}

// ---------------------------------------------------------------- restore
function readJournal() {
  try { return JSON.parse(readFileSync(JOURNAL, 'utf8')); } catch { return null; }
}
function restoreFromJournal() {
  const j = readJournal();
  if (!j) { console.log('mutation-check: nothing to restore.'); return; }
  for (const f of j.files) {
    const orig = readFileSync(f.backup);
    if (sha256(orig) !== f.sha) die(`backup of ${f.path} is damaged; restore it with git (git checkout -- ${f.path}) if it was committed`, 1);
    writeFileSync(join(ROOT, f.path), orig);
    console.log(`restored ${f.path}`);
  }
  rmSync(JOURNAL_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------- run
const originals = new Map(); // path → Buffer
let child = null;
let restored = true;

function restoreAll() {
  let ok = true;
  for (const [path, buf] of originals) {
    const abs = join(ROOT, path);
    try {
      if (sha256(readFileSync(abs)) !== sha256(buf)) writeFileSync(abs, buf);
      if (sha256(readFileSync(abs)) !== sha256(buf)) ok = false;
    } catch { ok = false; }
  }
  if (ok) rmSync(JOURNAL_DIR, { recursive: true, force: true });
  else console.error(`mutation-check: a file could not be restored; run node scripts/mutation-check.mjs restore (backups in ${JOURNAL_DIR})`);
  restored = ok;
  return ok;
}

/**
 * Kill the test run and everything it spawned. node --test runs each file in
 * a child of its own, so killing only the runner would orphan that child,
 * still executing the mutated module. The runner is spawned as the leader of
 * its own process group, and the whole group is killed.
 */
function killRun(proc) {
  if (!proc) return;
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
}

function runTest(test, timeoutMs) {
  return new Promise((res) => {
    let output = '';
    let timedOut = false;
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // a parent node --test would otherwise swallow the child's TAP
    child = spawn(process.execPath, testArgv(test), { cwd: ROOT, env, detached: true });
    const proc = child;
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => { timedOut = true; killRun(proc); }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) killRun(proc); // anything left in the group after the runner exits
      child = null;
      res({ code: code ?? 1, timedOut, output });
    });
  });
}

async function run(args) {
  const specPath = flag(args, '--spec');
  if (!specPath) die('run needs --spec <file.json>');
  const timeoutMs = Number(flag(args, '--timeout', '300000'));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) die('--timeout is a number of milliseconds');
  const only = flag(args, '--only');
  const jsonOut = flag(args, '--json');

  let spec;
  try { spec = JSON.parse(readFileSync(resolve(specPath), 'utf8')); } catch (e) { die(`cannot read ${specPath}: ${e.message}`); }
  let { mutations, errors } = parseSpec(spec);
  if (errors.length) die(`the spec is invalid:\n  ${errors.join('\n  ')}`);
  if (only) {
    const want = new Set(only.split(','));
    mutations = mutations.filter((m) => want.has(m.id));
    if (!mutations.length) die(`--only matched no mutation id`);
  }
  if (readJournal()) die(`a previous run left files mutated; run node scripts/mutation-check.mjs restore first`);

  for (const m of mutations) {
    for (const p of [m.file, m.test]) if (!existsSync(join(ROOT, p))) die(`${p} does not exist`);
    if (!originals.has(m.file)) originals.set(m.file, readFileSync(join(ROOT, m.file)));
    const r = applyMutation(originals.get(m.file).toString('utf8'), m);
    if (!r.ok) die(`mutation ${m.id}: ${r.error}`);
  }
  for (const g of ['cloudflare-worker/src/routes/_registry.ts', 'frontend/src/lib/apiModules.generated.js']) {
    if (!existsSync(join(ROOT, g))) console.warn(`mutation-check: ${g} is missing; run node scripts/build-generated.mjs first or tests may fail to load`);
  }

  // Backups outside the repository, so a killed run can be undone.
  mkdirSync(JOURNAL_DIR, { recursive: true });
  const files = [...originals].map(([path, buf], i) => {
    const backup = join(JOURNAL_DIR, `${i}.orig`);
    writeFileSync(backup, buf);
    return { path, backup, sha: sha256(buf) };
  });
  writeFileSync(JOURNAL, JSON.stringify({ root: ROOT, startedAt: new Date().toISOString(), files }, null, 2));
  restored = false;

  const onSignal = (sig) => { killRun(child); restoreAll(); console.error(`mutation-check: stopped by ${sig}; files restored`); process.exit(130); };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, onSignal);
  process.on('exit', () => { if (!restored) restoreAll(); });

  const tests = [...new Set(mutations.map((m) => m.test))];
  const results = [];
  let baselineOk = true;
  let afterOk = true;
  try {
    console.log(`Baseline: ${tests.length} test file(s), unmutated`);
    for (const t of tests) {
      const r = await runTest(t, timeoutMs);
      const c = tapCounts(r.output);
      console.log(`  ${r.code === 0 ? 'pass' : 'FAIL'}  ${t}${c ? `  (${c.pass} pass, ${c.fail} fail)` : ''}`);
      if (r.code !== 0) { baselineOk = false; console.log(r.output.split('\n').slice(-40).join('\n')); }
    }
    if (!baselineOk) throw new Error('a test fails before any mutation; fix it first, a failing baseline catches nothing');

    for (const m of mutations) {
      const orig = originals.get(m.file);
      const mutated = applyMutation(orig.toString('utf8'), m).text;
      writeFileSync(join(ROOT, m.file), mutated);
      let r;
      try { r = await runTest(m.test, timeoutMs); } finally {
        writeFileSync(join(ROOT, m.file), orig);
      }
      if (sha256(readFileSync(join(ROOT, m.file))) !== sha256(orig)) throw new Error(`${m.file} did not restore after ${m.id}`);
      const v = verdict(m, r);
      results.push({ id: m.id, file: m.file, test: m.test, verdict: v, equivalent: m.equivalent, exit: r.code });
      console.log(`  ${v.padEnd(13)} ${m.id}  ${m.file}  →  ${m.test}`);
      if (v === 'wrong_failure') console.log(`    failed, but no failing test name contains "${m.expect}"`);
    }

    console.log(`After restore: ${tests.length} test file(s) again`);
    for (const t of tests) {
      const r = await runTest(t, timeoutMs);
      console.log(`  ${r.code === 0 ? 'pass' : 'FAIL'}  ${t}`);
      if (r.code !== 0) afterOk = false;
    }
  } catch (e) {
    console.error(`mutation-check: ${e.message}`);
    for (const m of mutations.slice(results.length)) results.push({ id: m.id, file: m.file, test: m.test, verdict: 'error' });
  } finally {
    restoreAll();
  }

  const line = summaryLine(results);
  const passed = runPassed(results, baselineOk && afterOk, restored);
  console.log(`\nmutation-check: ${line}`);
  if (!afterOk) console.log('mutation-check: a test failed after the files were restored; something besides the mutations changed');
  if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify({ summary: line, passed, baselineOk, afterOk, restored, results }, null, 2));
  process.exit(passed ? 0 : 1);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'list') list(rest);
else if (cmd === 'run') await run(rest);
else if (cmd === 'restore') restoreFromJournal();
else die('usage: node scripts/mutation-check.mjs list [--base <ref>] | run --spec <file.json> [--only id,id] [--timeout <ms>] [--json <out.json>] | restore');
