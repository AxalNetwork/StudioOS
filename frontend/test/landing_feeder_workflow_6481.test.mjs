import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertWorkflow } from '../../scripts/landing-bot/workflowGuard.mjs';

const path = '.github/workflows/landing-feeder.yml';
const yaml = readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('only main schedule and named dispatch can enter the protected job', () => {
  assert.deepEqual([...yaml.split('permissions: {}')[0].matchAll(/^  ([a-z_]+):$/gm)].map(m => m[1]), ['schedule', 'workflow_dispatch']);
  assert.match(yaml, /github\.ref == 'refs\/heads\/main'/);
  assert.match(yaml, /github\.run_attempt == 1/);
  assert.match(yaml, /environment: landing-bot/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.match(yaml, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(yaml, /persist-credentials: false/);
  assertWorkflow(path);
});

test('a successful reservation precedes token creation and the only queue-writing step', () => {
  const stages = ['Select eligible PRs', 'Reserve daily queue slots', 'Get queue installation token', 'Recheck and queue each selected commit'];
  const positions = stages.map(name => yaml.indexOf('- name: ' + name));
  assert.ok(positions.every((pos, index) => pos >= 0 && (!index || pos > positions[index - 1])));
  assert.equal([...yaml.matchAll(/if: steps\.plan\.outputs\.slots != '0'/g)].length, 2);
  assert.equal([...yaml.matchAll(/steps\.app\.outputs\.token/g)].length, 1);
  assert.match(yaml, /if-no-files-found: error/);
  assert.doesNotMatch(yaml, /continue-on-error: true|always\(\)|pull-requests: write\s*\n\s+actions:/);
});
