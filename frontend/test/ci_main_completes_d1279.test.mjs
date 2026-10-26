// D1279 — main's CI run finishes for every commit. One concurrency group per
// ref with cancel-in-progress let each merge cancel the run before it, so a
// broken main was never reported and every PR found it by failing on it.
//
// Run with:
//   node --test frontend/test/ci_main_completes_d1279.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CODE = readFileSync('.github/workflows/ci.yml', 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('a push to main is never cancelled and is its own group; a PR run may be cancelled', () => {
  assert.match(CODE, /\n  push:\n    branches: \[main\]\n/);
  const block = CODE.slice(CODE.indexOf('\nconcurrency:'), CODE.indexOf('\njobs:'));
  assert.ok(block.length > 0, 'ci.yml declares its concurrency');
  assert.doesNotMatch(block, /cancel-in-progress:\s*true\b/, 'an unconditional cancel means main never finishes');
  assert.match(block, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(block, /group: ci-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.sha \}\}/, 'one group per main commit');
});
