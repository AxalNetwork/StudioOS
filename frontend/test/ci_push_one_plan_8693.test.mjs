/**
 * D8693 (#8693): one plan per run. On a push to main the `plan` job's `suite-plan` artifact is what the capacity
 * pilot submits (`planDigest`), what the trusted planner checks and what a delegated Worker shard runs; the hosted
 * `suite` parts each write their own plan. A delegated `worker-N-of-6` stands in for the hosted part of the same
 * name, so the two must hold the same files, or one run tests some files twice and others not at all.
 *
 * This file runs the two commands ci.yml actually carries, on this commit, and follows the plan through every
 * consumer: submission, planner, executor, hosted part.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, validatePlan, suiteFiles, SHARDS, REST } from '../../scripts/test-drift-parts.mjs';
import { capacitySubmission } from '../../scripts/ci/capacity-submission.mjs';
import { plannerSubmission } from '../../scripts/ci/capacity-planner.mjs';
import { verifiedPlan } from '../../scripts/ci/runner-execution.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO = 'AxalNetwork/StudioOS';
const SOURCE = 'a'.repeat(40), EXEC = 'b'.repeat(40);
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const WORKERS = Array.from({ length: SHARDS['test:worker'] }, (_, i) => `worker-${i + 1}-of-${SHARDS['test:worker']}`);

/** The text of one top-level job of ci.yml, from its key to the next job's key. */
const job = (name) => {
  const at = ci.indexOf(`\n  ${name}:\n`);
  assert.ok(at > 0, `ci.yml has a ${name} job`);
  const rest = ci.slice(at + 1);
  const end = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return end < 0 ? rest : rest.slice(0, end + 1);
};
/** The planner command a job's step runs, exactly as ci.yml writes it inside `$( ... )`. */
const plannerCommand = (text) => {
  const found = [...text.matchAll(/\$\((node scripts\/test-drift-parts\.mjs --plan[^)]*)\)/g)].map((m) => m[1]);
  assert.equal(found.length, 1, `one planner command in ${JSON.stringify(found)}`);
  return found[0];
};

/** A scratch checkout of this commit: the planner script copied (it writes suite-plan.json beside itself), the rest linked. */
function scratchCheckout(t) {
  const dir = mkdtempSync(join(tmpdir(), 'one-plan-8693-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  for (const file of ['test-drift-parts.mjs', 'build-generated.mjs']) copyFileSync(join(ROOT, 'scripts', file), join(dir, 'scripts', file));
  cpSync(join(ROOT, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  for (const folder of ['frontend', 'cloudflare-worker']) symlinkSync(join(ROOT, folder), join(dir, folder));
  // A main timing artifact as download-test-timings.sh would leave it, skewed so a timing-weighted plan packs
  // differently: a job whose command read timings would then write a different plan from the equal-weight one.
  writeFileSync(join(dir, 'test-timings.json'), JSON.stringify(skewedTimings()));
  return dir;
}
const skewedTimings = () => Object.fromEntries(suiteFiles(scripts['test:worker'], ROOT).slice(0, 3).map((f) => [f, 1e9]));
/** Run a ci.yml planner command the way its step does, and return the suite-plan.json bytes it wrote. */
function runPlanner(dir, command) {
  rmSync(join(dir, 'suite-plan.json'), { force: true });
  const run = spawnSync('bash', ['-e', '-c', command], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(run.status, 0, run.stderr);
  return readFileSync(join(dir, 'suite-plan.json'), 'utf8');
}

/** Each part's files and the commands it executes, as `test-drift-parts.mjs <part> --plan-file` reads them. */
const partsFrom = (bytes) => {
  const plan = JSON.parse(bytes), executed = validatePlan(plan, scripts, ROOT);
  return new Map(plan.parts.map((p) => [p.name, { files: p.files ?? null, commands: executed.find((e) => e.name === p.name).commands }]));
};

function pushSubmission(planFile) {
  const run = { id: 12, run_attempt: 1, workflow_id: 7, path: '.github/workflows/ci.yml', head_sha: SOURCE, event: 'push', head_branch: 'main',
    repository: { full_name: REPO, id: 1 }, head_repository: { full_name: REPO, id: 1 } };
  return capacitySubmission({ CI_CAPACITY_ENABLED: 'true', GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: SOURCE, CI_CAPACITY_EXECUTOR_SHA: EXEC, CAPACITY_PLAN_ARTIFACT_ID: '45',
    CAPACITY_PLAN_FILE: planFile }, async (method, path) => {
    assert.equal(`${method} ${path}`, `GET /repos/${REPO}/actions/runs/12`);
    return run;
  });
}
const plannerEnv = (dir, submission, planFile) => {
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, '{}');
  return { CAPACITY_SUBMISSION: JSON.stringify(submission), GITHUB_REPOSITORY: REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_RUN_ID: '12',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: SOURCE, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', CAPACITY_EXECUTOR_SHA: EXEC,
    CAPACITY_SOURCE_ROOT: ROOT, CAPACITY_PLAN_FILE: planFile };
};
const digest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

test('D8693 on one commit, each delegated worker-N-of-6 runs the files of the hosted part of the same name', async (t) => {
  const dir = scratchCheckout(t);
  // What the push run writes: the `plan` job's artifact and, separately, each hosted suite part's own plan.
  const artifact = runPlanner(dir, plannerCommand(job('plan')));
  const hosted = runPlanner(dir, plannerCommand(job('suite')));
  assert.equal(artifact, hosted, 'the plan job and the suite parts write the same plan bytes');

  // The capacity submission's planDigest names those bytes.
  const planFile = join(dir, 'artifact-suite-plan.json');
  writeFileSync(planFile, artifact);
  const submission = await pushSubmission(planFile);
  assert.equal(submission.planDigest, digest(hosted));
  assert.deepEqual(submission.shards, WORKERS);

  // The trusted planner rebuilds the plan from the candidate and submits exactly those bytes.
  const planned = plannerSubmission(plannerEnv(dir, submission, planFile));
  assert.equal(planned.plan, hosted, 'the planner submits the hosted plan');

  // The executor admits a delegated shard only on the submitted bytes; on a push it reads the parent's artifact,
  // in the queue it rebuilds them from the checkout. Either way, part for part, it runs what the hosted part runs.
  const hostedParts = partsFrom(hosted);
  for (const part of WORKERS) {
    for (const event of ['push', 'merge_group']) {
      const delegated = verifiedPlan({ event, part, expectedDigest: submission.planDigest, artifactBytes: planned.plan, scripts, sourceRoot: ROOT });
      const mine = partsFrom(delegated.toString('utf8')).get(part), theirs = hostedParts.get(part);
      assert.ok(theirs.files.length > 0, `${part} is not empty`);
      assert.deepEqual(mine.files, theirs.files, `${part} (${event}) files`);
      assert.deepEqual(mine.commands, theirs.commands, `${part} (${event}) commands`);
    }
  }

  // And the union of all parts is every test file exactly once.
  const seen = new Map();
  for (const [, part] of hostedParts) for (const file of part.files ?? []) seen.set(file, (seen.get(file) ?? 0) + 1);
  const every = Object.keys(SHARDS).flatMap((script) => suiteFiles(scripts[script], ROOT));
  assert.equal(new Set(every).size, every.length, 'no file is in two sharded suites');
  assert.deepEqual([...seen.keys()].sort(), [...every].sort(), 'every sharded test file is planned');
  assert.deepEqual([...seen].filter(([, n]) => n !== 1), [], 'and planned once');
  const steps = scripts['test:drift'].split(' && ').map((s) => s.trim());
  assert.deepEqual([...hostedParts.get(REST).commands, ...Object.keys(SHARDS).map((s) => `npm run ${s}`)].sort(), [...steps].sort(),
    'rest runs every other step of test:drift');
});

test('D8693 the planner refuses a push artifact that is not the equal-weight plan, even with a matching digest', async (t) => {
  const dir = scratchCheckout(t);
  const equal = JSON.stringify(buildPlan(scripts, {}, ROOT), null, 2) + '\n';
  // A timing-weighted plan of the same commit: valid and exact-once on its own, but a different packing.
  const weighted = JSON.stringify(buildPlan(scripts, skewedTimings(), ROOT), null, 2) + '\n';
  assert.notEqual(weighted, equal, 'the fixture weights change the packing');
  assert.equal(validatePlan(JSON.parse(weighted), scripts, ROOT).length, JSON.parse(weighted).parts.length, 'the weighted plan is itself exact-once');
  const planFile = join(dir, 'weighted-suite-plan.json');
  writeFileSync(planFile, weighted);
  const submission = await pushSubmission(planFile);
  assert.equal(submission.planDigest, digest(weighted));
  assert.throws(() => plannerSubmission(plannerEnv(dir, submission, planFile)), /planner_plan_not_equal_weight/);
  writeFileSync(planFile, equal);
  assert.equal(plannerSubmission(plannerEnv(dir, { ...submission, planDigest: digest(equal) }, planFile)).plan, equal);
});

test('D8693 ci.yml writes the equal-weight plan in both jobs and downloads no timings', () => {
  for (const name of ['plan', 'suite']) assert.equal(plannerCommand(job(name)), 'node scripts/test-drift-parts.mjs --plan --equal-weights', name);
  assert.doesNotMatch(job('plan'), /download-test-timings|test-timings\.json/);
});
