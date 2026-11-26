/**
 * D8082 (#8082): run the admin drift check's fixtures in the normal frontend suite, and hold
 * the workflow to its shape: the job holding the read token has no write permission, the job
 * holding the issue write has no secret, and neither can change a setting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import '../../scripts/ops/check-github-admin.test.mjs';

const { parse } = createRequire(new URL('../../cloudflare-worker/package.json', import.meta.url))('yaml');
const source = readFileSync(new URL('../../.github/workflows/admin-drift.yml', import.meta.url), 'utf8');
const workflow = parse(source);

test('admin-drift.yml runs weekly and on dispatch only, from main', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(workflow.on.schedule.length, 1);
  assert.match(workflow.on.schedule[0].cron, /^\d+ \d+ \* \* [0-6]$/, 'once a week');
  assert.deepEqual(workflow.permissions, { 'contents': 'read' });
  assert.match(workflow.jobs.check.if, /github\.ref == 'refs\/heads\/main'/);
});

test('the reading job holds the read-only token in production-monitoring (D8754) and no write permission', () => {
  const check = workflow.jobs.check;
  assert.deepEqual(check.environment, { name: 'production-monitoring', deployment: false });
  assert.deepEqual(check.permissions, { contents: 'read' });
  const text = JSON.stringify(check);
  assert.deepEqual([...text.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]), ['ADMIN_DRIFT_READ_TOKEN']);
  assert.doesNotMatch(text, /github\.token|GH_TOKEN|--file-issues/);
});

test('the filing job writes issues only, with no secret and no environment', () => {
  const file = workflow.jobs.file;
  assert.deepEqual(file.permissions, { contents: 'read', issues: 'write' });
  assert.equal(file.environment, undefined);
  const text = JSON.stringify(file);
  assert.doesNotMatch(text, /secrets\./);
  assert.match(text, /--file-issues/);
  assert.deepEqual(file.needs, 'check');
});

test('no step can change a setting: no gh api write, no curl, only the check script', () => {
  const runs = Object.values(workflow.jobs).flatMap(job => job.steps.map(step => step.run).filter(Boolean)).join('\n');
  assert.doesNotMatch(runs, /\bgh\b|\bcurl\b|-X\s*(PUT|PATCH|POST|DELETE)/);
  assert.deepEqual([...runs.matchAll(/node (\S+)/g)].map(m => m[1]), ['scripts/ops/check-github-admin.mjs', 'scripts/ops/check-github-admin.mjs']);
});
