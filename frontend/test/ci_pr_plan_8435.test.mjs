/**
 * D8435 (#8435): the suite waits for no job. On a pull request its nine parts used to be created only after
 * `suite plan` had found a runner and finished (15 minutes at the 90th percentile under load). Each part now
 * writes the exact-once plan itself, on every event, as the merge queue already did.
 *
 * That is safe only if every part of a run writes the same plan, so this file pins: the plan is a pure function
 * of the commit; the matrix needs nothing from another job and matches the tier rule; and the `plan` job is
 * still there for the things that read it (the full-suite gate, the capacity pilot's submission on push).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { buildPlan, partsOf } from '../../scripts/test-drift-parts.mjs';
import { tierFor } from '../../scripts/lib/prTier.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const ci = parse(read('.github/workflows/ci.yml'));
const suite = ci.jobs.suite;

test('the suite needs no plan job, and reads nothing a plan job writes', () => {
  // D8626: `capacity-route` is the only other need. It is a merge-queue job skipped before it starts unless queue
  // routing is on, so a pull request or a push never waits for it; a queue candidate waits only when it is routed.
  assert.deepEqual(suite.needs, ['verified', 'capacity-route']);
  assert.match(ci.jobs['capacity-route'].if, /^\$\{\{ !cancelled\(\) && github\.event_name == 'merge_group' && .*vars\.CI_CAPACITY_QUEUE_ROUTING == 'true'/);
  assert.match(ci.jobs.route.if, /^\$\{\{ github\.event_name == 'merge_group' && .*vars\.CI_CAPACITY_QUEUE_ROUTING == 'true' \}\}$/);
  const text = JSON.stringify(suite);
  assert.doesNotMatch(text, /needs\.plan/);
  assert.equal(suite.steps.filter((step) => step.with?.name === 'suite-plan').length, 0, 'no step downloads the plan artifact');
  const planStep = suite.steps.findIndex((step) => step.name === 'Exact-once plan from this commit');
  assert.ok(planStep > 0);
  assert.equal(suite.steps[planStep].if, undefined, 'it runs on every event');
  assert.match(suite.steps[planStep].run, /node scripts\/test-drift-parts\.mjs --plan --equal-weights/);
  const runs = suite.steps.findIndex((step) => String(step.run ?? '').includes('--plan-file suite-plan.json'));
  assert.ok(runs > planStep, 'the part runs from the plan this job wrote');
});

test('the matrix is a literal that follows the tier rule on every event', () => {
  const full = JSON.stringify(partsOf(pkg.scripts).map((part) => part.name));
  assert.equal(suite.strategy.matrix.part,
    `\${{ fromJSON(github.event_name == 'pull_request' && github.event.pull_request.draft && '["rest"]' || '${full}') }}`);
  // prTier.mjs is the rule: a draft pull request runs `rest`, and a null list means the full tier.
  assert.deepEqual(tierFor({ event: 'pull_request', draft: true }).parts, ['rest']);
  for (const facts of [{ event: 'pull_request', draft: false }, { event: 'push' }, { event: 'merge_group' }, { event: 'workflow_dispatch' }]) {
    assert.equal(tierFor(facts).parts, null, JSON.stringify(facts));
  }
  assert.ok(JSON.parse(full).includes('rest'), 'the draft tier is one of the planned parts');
});

test('every part of a run writes the same plan: it depends on the commit and on nothing else', () => {
  const here = JSON.stringify(buildPlan(pkg.scripts, {}, ROOT));
  assert.equal(JSON.stringify(buildPlan(pkg.scripts, {}, ROOT)), here, 'twice in one process');
  // Another process, another directory, another clock zone and locale: a second runner.
  const elsewhere = mkdtempSync(join(tmpdir(), 'plan-8435-'));
  try {
    const script = `
      import { readFileSync } from 'node:fs';
      import { buildPlan } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts/test-drift-parts.mjs')).href)};
      const pkg = JSON.parse(readFileSync(${JSON.stringify(join(ROOT, 'package.json'))}, 'utf8'));
      process.stdout.write(JSON.stringify(buildPlan(pkg.scripts, {}, ${JSON.stringify(ROOT)})));
    `;
    for (const env of [{ TZ: 'Asia/Tokyo', LC_ALL: 'C' }, { TZ: 'America/Los_Angeles', LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' }]) {
      const other = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: elsewhere, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, maxBuffer: 64 * 1024 * 1024 });
      assert.equal(other.status, 0, other.stderr);
      assert.equal(other.stdout, here, JSON.stringify(env));
    }
  } finally { rmSync(elsewhere, { recursive: true, force: true }); }
  // Exact-once: every planned file is in exactly one part.
  const plan = JSON.parse(here), seen = new Map();
  for (const part of plan.parts) for (const file of part.files ?? []) seen.set(file, (seen.get(file) ?? 0) + 1);
  assert.ok(seen.size > 1000, `${seen.size} files planned`);
  assert.deepEqual([...seen].filter(([, count]) => count !== 1), []);
});

test('the plan job is still there for what reads it, and the full-suite gate is unchanged', () => {
  const plan = ci.jobs.plan;
  assert.equal(plan.needs, 'verified');
  assert.ok(plan.steps.some((step) => step.with?.name === 'suite-plan' && String(step.uses).startsWith('actions/upload-artifact@')), 'the artifact the capacity pilot reads');
  assert.ok(plan.steps.some((step) => step.id === 'capacity'), 'the pilot submission step');
  // D8626: the gate also reads `capacity-route`, only to refuse a routed candidate when main does not require
  // ci-capacity/full-suite. Its pass rule for every other run is the one below, unchanged.
  assert.deepEqual(ci.jobs.gate.needs, ['verified', 'plan', 'capacity-route', 'suite']);
  assert.equal(ci.jobs['capacity-submit'].needs, 'plan');
});
