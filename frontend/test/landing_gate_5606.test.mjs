import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

function job(id) {
  const heading = `  ${id}:`;
  const lines = workflow.split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `missing ${id} job`);
  const next = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, next < 0 ? undefined : next).join('\n') + '\n';
}

function shell(block, step) {
  const stepBlocks = block.split(/^ {6}- /m);
  const source = stepBlocks.find((entry) => entry.startsWith(`name: ${step}\n`));
  assert.ok(source, `missing ${step} step`);
  const run = source.match(/^ {8}run: \|\n((?:^ {10}.*\n)+)/m);
  assert.ok(run, `missing script for ${step}`);
  return run[1].replace(/^ {10}/gm, '');
}

const fast = job('fast');
const landing = job('landing');

test('fast runs the guards before installing dependencies on a single full-history checkout', () => {
  assert.match(fast, /^    name: ci \/ fast$/m);
  assert.doesNotMatch(fast, /^    if:/m);
  assert.doesNotMatch(fast, /continue-on-error:/);
  assert.equal([...fast.matchAll(/actions\/checkout@/g)].length, 1);
  assert.match(fast, /^          fetch-depth: 0\n          filter: blob:none$/m);
  for (const step of fast.split(/^ {6}- /m).slice(1)) {
    assert.match(step, /^ {8}if: \$\{\{ !cancelled\(\)/m);
  }
  const firstInstall = fast.indexOf('- run: npm ci');
  assert.ok(firstInstall > 0);
  for (const guard of ['Run gitleaks', 'No migration on the base', 'Run LFS size gate', 'Run drift checker']) {
    const index = fast.indexOf(`- name: ${guard}`);
    assert.ok(index > 0 && index < firstInstall, `${guard} runs before npm ci`);
  }
  for (const id of ['audit-frontend', 'audit-worker', 'audit-python', 'routing-docs', 'lfs-gate']) {
    assert.ok(!workflow.split('\n').includes(`  ${id}:`), `${id} was folded into fast`);
  }
  assert.match(job('gate'), /^    name: ['"]?test:drift \(full suite\)['"]?$/m);
});

const verdict = shell(fast, 'Report required and advisory results');
const verdictDefaults = Object.fromEntries([
  'CHECKOUT', 'NODE', 'INSTALL_SCANNER', 'RANGE', 'SCAN', 'TRUSTED', 'MIGRATIONS',
  'DRIFT', 'WORKER_INSTALL', 'WORKER_TYPECHECK', 'FRONTEND_INSTALL', 'FRONTEND_BUILD',
  'LFS_BASE', 'LFS', 'FRONTEND_AUDIT', 'WORKER_AUDIT', 'PYTHON', 'PIP_TEST', 'PIP_INSTALL',
  'PIP_AUDIT', 'ROUTING_CHECK', 'ROUTING', 'AUTH', 'ROUTING_UPLOAD',
].map((step) => [step, 'success']));

for (const [label, overrides, required, advisory] of [
  ['all checks passed', {}, 'pass', 'pass'],
  ['failed migration', { MIGRATIONS: 'failure' }, 'fail', 'pass'],
  ['missing drift result', { DRIFT: '' }, 'fail', 'pass'],
  ['failed audit', { WORKER_AUDIT: 'failure' }, 'pass', 'fail'],
  ['failed PyPI retry fixtures', { PIP_TEST: 'failure' }, 'pass', 'fail'],
  ['failed LFS guard', { LFS: 'failure' }, 'pass', 'fail'],
  ['LFS skipped on a push', { EVENT: 'push', LFS_BASE: 'skipped', LFS: 'skipped' }, 'pass', 'pass'],
  ['advisory checks skipped in the queue', {
    EVENT: 'merge_group', LFS_BASE: 'skipped', LFS: 'skipped', WORKER_AUDIT: 'skipped',
  }, 'pass', 'pass'],
]) {
  test(`fast verdict with ${label}`, () => {
    const temp = mkdtempSync(join(tmpdir(), 'landing-gate-5606-'));
    try {
      const output = join(temp, 'outputs');
      const env = { ...process.env, ...verdictDefaults, EVENT: 'pull_request', ...overrides, GITHUB_OUTPUT: output };
      const result = spawnSync('/bin/bash', ['-ec', verdict], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), `required=${required}\nadvisory=${advisory}\n`);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}

test('landing always evaluates the fast verdict and suite result', () => {
  assert.match(landing, /^    name: landing gate$/m);
  assert.match(landing, /^    needs: \[verified, fast, suite\]$/m);
  assert.match(landing, /^    if: always\(\)$/m);
  assert.ok(landing.includes('REQUIRED: ${{ needs.fast.outputs.required }}'));
  assert.ok(landing.includes('SUITE: ${{ needs.suite.result }}'));
  assert.ok(landing.includes('VERIFIED_RUN: ${{ needs.verified.outputs.run }}'));
});

const gate = shell(landing, 'Required fast checks and full suite passed');
for (const [label, overrides, status] of [
  ['successful suite', {}, 0],
  ['verified exact-SHA queue run on a push', { EVENT: 'push', VERIFIED_RUN: '123', SUITE: 'skipped' }, 0],
  ['failed fast verdict', { REQUIRED: 'fail' }, 1],
  ['missing fast verdict', { REQUIRED: '' }, 1],
  ['failed suite', { SUITE: 'failure' }, 1],
  ['cancelled suite', { SUITE: 'cancelled' }, 1],
  ['skipped suite on an unverified push', { EVENT: 'push', SUITE: 'skipped' }, 1],
  ['skipped suite in the queue', { EVENT: 'merge_group', VERIFIED_RUN: '123', SUITE: 'skipped' }, 1],
]) {
  test(`landing verdict with ${label}`, () => {
    const env = { ...process.env, EVENT: 'pull_request', VERIFIED_RUN: '', SUITE: 'success', REQUIRED: 'pass', ...overrides };
    const result = spawnSync('/bin/bash', ['-ec', gate], { env, encoding: 'utf8' });
    assert.equal(result.status, status, result.stdout + result.stderr);
  });
}
