/**
 * `.github/workflows/copilot-setup-steps.yml` must stay the environment the
 * suite actually runs in. GitHub runs its one job before every Copilot
 * coding-agent session, and a session whose dependencies differ from CI's is a
 * session whose "the suite passed" means nothing.
 *
 * WHAT IT MIRRORS, stated because the obvious reading is wrong: the job in
 * ci.yml that runs `npm run test:drift`. That job is keyed `gate`. The job
 * keyed `drift` is the api ↔ worker check, and it installs nothing — a guard
 * that compared against it by name would compare against an empty list. So
 * the job is found by what it RUNS, not by its key, and the comparison is
 * derived from it rather than typed here: the pins, the node version and the
 * install order are read out of ci.yml on every run.
 *
 * The failures it exists for:
 *   1. the job is renamed — GitHub ignores any job not named
 *      `copilot-setup-steps`, so Copilot silently starts with no
 *      node_modules;
 *   2. an action is re-pinned in one file and not the other;
 *   3. the node version moves in one file and not the other;
 *   4. an install is dropped or reordered;
 *   5. a job-level key GitHub does not honour here is relied on (an `env:`
 *      would be read in CI and ignored for Copilot — the worst kind of
 *      divergence, because this workflow's own CI run would pass).
 *
 * Counterpart guards: semgrep_workflow.test.mjs and pr_preview.test.mjs, which
 * read a workflow as text the same way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const at = (p) => readFileSync(resolve(root, p), 'utf8');

const SETUP = '.github/workflows/copilot-setup-steps.yml';
const CI = '.github/workflows/ci.yml';
const JOB = 'copilot-setup-steps';

/** Keys GitHub honours on the copilot-setup-steps job; anything else is ignored for Copilot. */
const HONOURED_JOB_KEYS = ['runs-on', 'permissions', 'steps', 'timeout-minutes', 'container', 'services', 'snapshot'];

const isComment = (line) => line.trimStart().startsWith('#');

/**
 * A workflow's jobs, keyed by job id, each as its non-comment lines.
 *
 * Comment lines are dropped rather than kept: ci.yml's comments name the very
 * things these assertions compare (`npm run test:drift` appears in prose), and
 * a whole-text scan would be satisfied by the prose.
 */
function jobsOf(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  assert.ok(start >= 0, 'a workflow with no top-level `jobs:`');
  const jobs = new Map();
  let cur = null;
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith(' ') && !isComment(line)) break; // next top-level key
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) {
      cur = [];
      jobs.set(key[1], cur);
      continue;
    }
    if (cur && line.trim() && !isComment(line)) cur.push(line);
  }
  return jobs;
}

/** The job's own 4-space keys (`runs-on`, `steps`, …). */
const jobKeys = (jobLines) =>
  jobLines.map((l) => /^ {4}([A-Za-z0-9_-]+):/.exec(l)?.[1]).filter(Boolean);

/** A trailing ` # comment` stripped from a YAML scalar line. */
const bare = (value) => {
  const hash = value.indexOf(' #');
  return (hash >= 0 ? value.slice(0, hash) : value).trim();
};

/** The value of `key:` on a line, or undefined. Literal scan — no regex built from data. */
function valueOf(line, key) {
  const t = line.trim().replace(/^- /, '');
  const prefix = `${key}:`;
  return t.startsWith(prefix) ? bare(t.slice(prefix.length)) : undefined;
}

/** The job's steps: { uses?, run?, workingDirectory?, nodeVersion? } in order. */
function stepsOf(jobLines) {
  const at = jobLines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  assert.ok(at >= 0, 'a job with no `steps:`');
  const steps = [];
  for (const line of jobLines.slice(at + 1)) {
    if (/^ {0,4}\S/.test(line)) break; // a job-level key ends the steps list
    if (/^ {6}- /.test(line)) steps.push({});
    const step = steps[steps.length - 1];
    if (!step) continue;
    const uses = valueOf(line, 'uses');
    if (uses !== undefined) step.uses = uses;
    const run = valueOf(line, 'run');
    if (run !== undefined) step.run = run;
    const wd = valueOf(line, 'working-directory');
    if (wd !== undefined) step.workingDirectory = wd;
    const nv = valueOf(line, 'node-version');
    if (nv !== undefined) step.nodeVersion = nv;
  }
  return steps;
}

/** `actions/checkout@<sha>` → `actions/checkout`. */
const actionOf = (uses) => uses.slice(0, uses.indexOf('@'));

/** A step that installs dependencies: its command starts with `npm ci` or `npm install`. */
const isInstall = (step) => typeof step.run === 'string' && (step.run.startsWith('npm ci') || step.run.startsWith('npm install'));

/** An install as the pair that decides what it installs: where, and how. */
const installOf = (step) => ({ where: step.workingDirectory || '(root)', run: step.run });

const setupJobs = jobsOf(at(SETUP));
const ciJobs = jobsOf(at(CI));

/** The ci.yml job that runs the suite, found by what it runs rather than by its key. */
function suiteJob() {
  const runners = [...ciJobs].filter(([, lines]) =>
    stepsOf(lines).some((s) => s.run === 'npm run test:drift'),
  );
  assert.equal(
    runners.length,
    1,
    `exactly one ci.yml job must run \`npm run test:drift\`; found ${runners.map(([k]) => k).join(', ') || 'none'} — the setup steps mirror that job, so without exactly one there is nothing to compare against`,
  );
  return { key: runners[0][0], steps: stepsOf(runners[0][1]) };
}

test('the workflow has one job, named exactly copilot-setup-steps', () => {
  assert.deepEqual(
    [...setupJobs.keys()],
    [JOB],
    `GitHub runs only a job named \`${JOB}\` before a Copilot session; any other name is ignored, and Copilot starts with no node_modules`,
  );
});

test('the job relies on no key GitHub ignores for Copilot, and stays under its 59-minute cap', () => {
  const lines = setupJobs.get(JOB);
  const keys = jobKeys(lines);
  const ignored = keys.filter((k) => !HONOURED_JOB_KEYS.includes(k));
  assert.deepEqual(
    ignored,
    [],
    `${ignored.join(', ')} would apply in this workflow's own CI run and be ignored for Copilot, so CI would pass on an environment Copilot never gets`,
  );
  const timeout = lines.map((l) => valueOf(l, 'timeout-minutes')).find((v) => v !== undefined);
  assert.ok(timeout !== undefined, 'set a timeout — an install that hangs should fail, not hold the session');
  assert.ok(Number(timeout) >= 1 && Number(timeout) <= 59, `timeout-minutes is ${timeout}; GitHub caps this job at 59`);
});

test('every action the suite job uses is pinned to the same SHA here, and every pin is a full SHA', () => {
  const suite = suiteJob();
  const suiteUses = suite.steps.map((s) => s.uses).filter(Boolean);
  const setupUses = stepsOf(setupJobs.get(JOB)).map((s) => s.uses).filter(Boolean);
  // A floor, so the comparison cannot pass on two empty lists if the parser
  // stops finding `uses:` lines.
  assert.deepEqual(
    suiteUses.map(actionOf),
    ['actions/checkout', 'actions/setup-node'],
    `ci.yml's ${suite.key} job no longer uses exactly checkout then setup-node — re-read it before trusting this comparison`,
  );
  for (const want of suiteUses) {
    const got = setupUses.find((u) => actionOf(u) === actionOf(want));
    assert.equal(got, want, `${actionOf(want)} is pinned differently here than in ci.yml's ${suite.key} job`);
  }
  for (const uses of setupUses) {
    const sha = uses.slice(uses.indexOf('@') + 1);
    assert.ok(/^[0-9a-f]{40}$/.test(sha), `${uses} is not pinned to a full commit SHA (.github/workflows/README.md, pinning policy)`);
  }
});

test('node is the version the suite job runs on', () => {
  const suite = suiteJob();
  const want = suite.steps.map((s) => s.nodeVersion).filter(Boolean);
  const got = stepsOf(setupJobs.get(JOB)).map((s) => s.nodeVersion).filter(Boolean);
  assert.equal(want.length, 1, `ci.yml's ${suite.key} job should set node-version exactly once`);
  // Compared, not typed: when CI moves off '22' this follows it, and a
  // literal here would be the one place still saying '22'.
  assert.deepEqual(got, want, `node-version here must equal ci.yml's ${suite.key} job (${want[0]})`);
});

test('the three installs run in the order the suite job runs them', () => {
  const suite = suiteJob();
  const want = suite.steps.filter(isInstall).map(installOf);
  const got = stepsOf(setupJobs.get(JOB)).filter(isInstall).map(installOf);
  // A floor: the frontend, the worker and the root each need their own tree.
  assert.deepEqual(
    want.map((i) => i.where),
    ['frontend', 'cloudflare-worker', '(root)'],
    `ci.yml's ${suite.key} job no longer installs frontend, cloudflare-worker and the root in that order — re-read it before trusting this comparison`,
  );
  assert.deepEqual(got, want, `the installs here must match ci.yml's ${suite.key} job, same directories, same commands, same order`);
});

test('it runs on dispatch, and on a push or PR only when this file changes', () => {
  const src = at(SETUP);
  const lines = src.split('\n').filter((l) => !isComment(l));
  const on = lines.findIndex((l) => l === 'on:');
  assert.ok(on >= 0, 'a block `on:`');
  const block = [];
  for (const line of lines.slice(on + 1)) {
    if (line && !line.startsWith(' ')) break;
    if (line.trim()) block.push(line);
  }
  const triggers = block.map((l) => /^ {2}([a-z_]+):/.exec(l)?.[1]).filter(Boolean);
  assert.deepEqual(triggers, ['workflow_dispatch', 'push', 'pull_request']);
  const paths = block.filter((l) => /^ {6}- /.test(l)).map((l) => l.trim().slice(2));
  assert.deepEqual(
    paths,
    [SETUP, SETUP],
    'push and pull_request must each be limited to this file — otherwise every PR pays for three npm installs it does not need',
  );
});

test('the steps only read', () => {
  const src = at(SETUP);
  const code = src.split('\n').filter((l) => !isComment(l));
  const perms = code.filter((l) => /^\s*permissions:\s*$/.test(l));
  assert.equal(perms.length, 2, 'permissions are declared at the workflow and at the job, as every workflow here does');
  for (let i = 0; i < code.length; i++) {
    if (!/^\s*permissions:\s*$/.test(code[i])) continue;
    assert.equal(code[i + 1].trim(), 'contents: read', 'contents: read, and nothing broader');
    const next = code[i + 2] ?? '';
    const indent = (s) => s.length - s.trimStart().length;
    assert.ok(indent(next) <= indent(code[i]), `a second permission after contents: read — ${next.trim()}`);
  }
  assert.doesNotMatch(code.join('\n'), /:\s*write\b/, 'no write permission — Copilot is given its own token for its own work');
});

test('the instructions file points at CLAUDE.md and never pipes the suite', () => {
  const file = '.github/copilot-instructions.md';
  assert.ok(existsSync(resolve(root, file)), `${file} is what Copilot reads for this repository`);
  const text = at(file);
  assert.ok(text.includes('`CLAUDE.md`'), 'the first thing it says is to read CLAUDE.md, which wins where anything disagrees');
  const suiteLines = text.split('\n').filter((l) => l.includes('npm run test:drift'));
  assert.ok(suiteLines.length > 0, 'it gives the command that runs the suite');
  for (const line of suiteLines) {
    // The exit-code trap: `npm run test:drift | tail` reports tail's status.
    assert.ok(!line.includes(' | '), `the suite command must not be piped: ${line.trim()}`);
    assert.ok(line.includes('echo EXIT=$?'), `the suite command must print its own exit code: ${line.trim()}`);
  }
});

test('the workflows README has a row for it', () => {
  const readme = at('.github/workflows/README.md');
  const row = readme.split('\n').find((l) => l.startsWith('| `copilot-setup-steps.yml` |'));
  assert.ok(row, '.github/workflows/README.md asks for a row for every workflow added');
});
