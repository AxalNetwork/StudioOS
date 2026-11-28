/**
 * #9055 — every workflow job has a time limit and every workflow has top-level permissions.
 *
 *   · each job that runs steps (every job without `uses:`; a reusable-workflow call takes its
 *     limits from the called workflow's own jobs) declares `timeout-minutes`, as a positive number
 *     or a `${{ … }}` expression, so a hung job cannot hold a runner for GitHub's 360-minute default;
 *   · each workflow file declares `permissions:` at the top level (`{}` when its jobs grant their own),
 *     so a job that forgets its own block does not inherit the repository's default token scope.
 *
 *   node --test frontend/test/workflow_job_limits.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';

const DIR = new URL('../../.github/workflows/', import.meta.url);
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const DOC = Object.fromEntries(FILES.map((f) => [f, parse(readFileSync(new URL(f, DIR), 'utf8'))]));

/** A usable limit: a positive number, or an expression GitHub evaluates at run time. */
export function validTimeout(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return typeof value === 'string' && /^\$\{\{[\s\S]+\}\}$/.test(value.trim());
}

/** `file › job` for every step-running job without a usable `timeout-minutes`. */
export function jobsWithoutTimeout(docs) {
  const out = [];
  for (const [file, doc] of Object.entries(docs)) {
    for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
      if (job && typeof job === 'object' && 'uses' in job) continue;
      if (!validTimeout(job?.['timeout-minutes'])) out.push(`${file} › ${name}`);
    }
  }
  return out;
}

/** Every workflow file without a top-level `permissions:` key. */
export function workflowsWithoutPermissions(docs) {
  return Object.entries(docs)
    .filter(([, doc]) => !doc || typeof doc !== 'object' || !Object.hasOwn(doc, 'permissions'))
    .map(([file]) => file);
}

test('the workflow folder parses and holds jobs to check', () => {
  assert.ok(FILES.length > 50, `expected the full workflow set, found ${FILES.length}`);
  for (const f of FILES) assert.ok(DOC[f]?.jobs && Object.keys(DOC[f].jobs).length, `${f} has no jobs`);
});

test('every job that runs steps declares timeout-minutes', () => {
  assert.deepEqual(jobsWithoutTimeout(DOC), [],
    'add `timeout-minutes:` to each job named (#9055); GitHub would otherwise allow 360 minutes');
});

test('every workflow declares top-level permissions', () => {
  assert.deepEqual(workflowsWithoutPermissions(DOC), [],
    'add `permissions: {}` (or the narrow scopes it needs) at the top of each workflow named (#9055)');
});

test('the four jobs #9055 bounded keep the limits it chose, and deck-visual keeps permissions: {}', () => {
  assert.equal(DOC['backup-d1.yml'].jobs.backup['timeout-minutes'], 60);
  assert.equal(DOC['beta-readiness-reaudit.yml'].jobs['open-tracking-issue']['timeout-minutes'], 10);
  assert.equal(DOC['lfs-budget.yml'].jobs.budget['timeout-minutes'], 10);
  assert.equal(DOC['runner-benchmark.yml'].jobs.plan['timeout-minutes'], 5);
  assert.deepEqual(DOC['deck-visual.yml'].permissions, {});
});

test('the checks catch what they guard (synthetic workflows)', () => {
  const docs = {
    'a.yml': { permissions: {}, jobs: { ok: { 'timeout-minutes': 5 }, expr: { 'timeout-minutes': '${{ inputs.limit }}' }, call: { uses: './.github/workflows/b.yml' } } },
    'b.yml': { jobs: { none: { 'runs-on': 'ubuntu-latest' }, zero: { 'timeout-minutes': 0 }, text: { 'timeout-minutes': 'ten' } } },
  };
  assert.deepEqual(jobsWithoutTimeout(docs), ['b.yml › none', 'b.yml › zero', 'b.yml › text']);
  assert.deepEqual(workflowsWithoutPermissions(docs), ['b.yml']);
});
