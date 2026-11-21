import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { REQUIRED } from '../../scripts/lib/requiredChecks.mjs';

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
  assert.ok(job('gate').includes("&& 'test:drift (draft fast tier)' || 'test:drift (full suite)'"));
});

// D7108 / D5531: in the merge queue, fast delegates scanner acquisition and the checks that the
// required `scan`, `worker (typecheck)` and `frontend (build)` jobs repeat on
// the same candidate. Every other required step keeps a plain `!cancelled()`,
// so the trusted-base migration and drift checkers still run in the queue.
const QUEUE_SKIPPED = ['scanner_pins', 'scanner_cache', 'install_scanner', 'scan', 'worker_install', 'worker_typecheck', 'frontend_install', 'frontend_build'];
const SCANNER_IFS = {
  scanner_cache: "${{ !cancelled() && github.event_name != 'merge_group' && steps.scanner_pins.outcome == 'success' }}",
  install_scanner: "${{ !cancelled() && github.event_name != 'merge_group' && steps.scanner_pins.outcome == 'success' }}",
  scan: "${{ !cancelled() && github.event_name != 'merge_group' && steps.install_scanner.outcome == 'success' && steps.range.outcome == 'success' }}",
};
const EVERY_EVENT = ['checkout', 'node', 'range', 'trusted', 'migrations', 'generated', 'drift', 'verdict'];
function fastStepIfs(block) {
  const out = {};
  for (const step of block.split(/^ {6}- /m).slice(1)) {
    const id = step.match(/^ {8}id: (\S+)$/m);
    const cond = step.match(/^ {8}if: (.+)$/m);
    if (id) out[id[1]] = cond ? cond[1] : null;
  }
  return out;
}
function assertQueueSkips(block) {
  const ifs = fastStepIfs(block);
  for (const id of QUEUE_SKIPPED) {
    assert.equal(ifs[id], SCANNER_IFS[id] || "${{ !cancelled() && github.event_name != 'merge_group' }}", `${id} keeps queue delegation and acquisition prerequisites`);
  }
  for (const id of EVERY_EVENT) {
    assert.equal(ifs[id], '${{ !cancelled() }}', `${id} runs on every event`);
  }
}

test('D7108: fast preserves merge-queue delegation and scanner prerequisites', () => {
  assertQueueSkips(fast);
  const swap = (id, from, to) => fast.replace(`id: ${id}\n        if: ${from}`, `id: ${id}\n        if: ${to}`);
  const plain = '${{ !cancelled() }}';
  const queue = "${{ !cancelled() && github.event_name != 'merge_group' }}";
  // Mutations that must be caught: a duplicated step left running, a unique
  // trusted-base check skipped in the queue, a step skipped on pull requests.
  assert.throws(() => assertQueueSkips(swap('worker_typecheck', queue, plain)));
  assert.throws(() => assertQueueSkips(swap('migrations', plain, queue)));
  assert.throws(() => assertQueueSkips(swap('drift', plain, queue)));
  assert.throws(() => assertQueueSkips(swap('scan', SCANNER_IFS.scan, "${{ !cancelled() && github.event_name == 'merge_group' }}")));
});

// D7108 (#7108): while fast delegates those repeated checks in the queue, `ci / fast`
// and `landing gate` go green on a candidate whose typecheck, build or secret
// scan fails; only the separate required jobs check those there. So the
// D5606 cutover (making `ci / fast` or `landing gate` required, then deleting
// the duplicate jobs) must first revert the merge_group skips. This fails if
// either half of the cutover happens while any skip is still present.
const gitleaksWorkflow = readFileSync(new URL('../../.github/workflows/gitleaks.yml', import.meta.url), 'utf8');
function jobIn(text, id) {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  if (start < 0) return null;
  const next = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, next < 0 ? undefined : next).join('\n') + '\n';
}
function assertQueueSkipsCovered({ fastBlock, ciText, gitleaksText, required }) {
  const ifs = fastStepIfs(fastBlock);
  const skipped = QUEUE_SKIPPED.filter((id) => /merge_group/.test(ifs[id] ?? ''));
  if (skipped.length === 0) return;
  for (const shadow of ['ci / fast', 'landing gate']) {
    assert.ok(!(shadow in required),
      `${shadow} is required while fast skips ${skipped.join(', ')} under merge_group: revert the D7108 skips first`);
  }
  for (const context of ['worker (typecheck)', 'frontend (build)', 'scan']) {
    assert.ok(context in required, `${context} left the required set while fast skips it in the queue`);
  }
  for (const [text, id, name, commands] of [
    [ciText, 'frontend', 'frontend (build)', ['- run: npm ci', '- run: npm run build']],
    [ciText, 'worker', 'worker (typecheck)', ['- run: npm ci', 'run: npx --no-install tsc --noEmit']],
    [gitleaksText, 'scan', 'scan', ['gitleaks detect']],
  ]) {
    const block = jobIn(text, id);
    assert.ok(block, `the duplicate ${name} job was removed while fast skips it in the queue`);
    assert.match(block, new RegExp(`^    name: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.doesNotMatch(block, /^    if:/m, `${name} must run on every candidate`);
    for (const command of commands) assert.ok(block.includes(command), `${name} still runs ${command}`);
  }
}

test('D7108: the queue skips stay covered by the required jobs until they are reverted', () => {
  const live = { fastBlock: fast, ciText: workflow, gitleaksText: gitleaksWorkflow, required: REQUIRED };
  assertQueueSkipsCovered(live);
  // Mutations that must be caught: either cutover half while the skips remain.
  assert.throws(() => assertQueueSkipsCovered({ ...live, required: { ...REQUIRED, 'landing gate': 'ci.yml' } }));
  assert.throws(() => assertQueueSkipsCovered({ ...live, required: { ...REQUIRED, 'ci / fast': 'ci.yml' } }));
  const { 'worker (typecheck)': _w, ...withoutWorker } = REQUIRED;
  assert.throws(() => assertQueueSkipsCovered({ ...live, required: withoutWorker }));
  assert.throws(() => assertQueueSkipsCovered({ ...live, ciText: workflow.replace('  frontend:\n', '  frontend-old:\n') }));
  assert.throws(() => assertQueueSkipsCovered({ ...live, ciText: workflow.replace('    name: worker (typecheck)\n', "    name: worker (typecheck)\n    if: github.event_name != 'merge_group'\n") }));
  assert.throws(() => assertQueueSkipsCovered({ ...live, gitleaksText: gitleaksWorkflow.replace('  scan:\n', '  scan-old:\n') }));
  // With every skip reverted, the cutover is allowed.
  const reverted = fast.replaceAll(" && github.event_name != 'merge_group'", '');
  assertQueueSkipsCovered({ ...live, fastBlock: reverted, required: { ...REQUIRED, 'landing gate': 'ci.yml' } });
});

const verdict = shell(fast, 'Report required and advisory results');
const verdictDefaults = Object.fromEntries([
  'CHECKOUT', 'NODE', 'INSTALL_SCANNER', 'RANGE', 'SCAN', 'TRUSTED', 'MIGRATIONS',
  'DRIFT', 'WORKER_INSTALL', 'WORKER_TYPECHECK', 'FRONTEND_INSTALL', 'FRONTEND_BUILD',
  'LFS_BASE', 'LFS', 'FRONTEND_AUDIT', 'WORKER_AUDIT', 'PYTHON', 'PIP_TEST', 'PIP_INSTALL',
  'PIP_AUDIT', 'ROUTING_CHECK', 'ROUTING', 'AUTH', 'ROUTING_UPLOAD',
].map((step) => [step, 'success']));
function QUEUE_SKIPPED_OUTCOMES(outcome) {
  return Object.fromEntries(['INSTALL_SCANNER', 'SCAN', 'WORKER_INSTALL', 'WORKER_TYPECHECK', 'FRONTEND_INSTALL', 'FRONTEND_BUILD']
    .map((step) => [step, outcome]));
}

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
  // D7108: the six queue-skipped steps count as passed only under merge_group.
  ['the six duplicated steps skipped in the queue', { EVENT: 'merge_group', ...QUEUE_SKIPPED_OUTCOMES('skipped') }, 'pass', 'pass'],
  ['a failed typecheck in the queue', { EVENT: 'merge_group', ...QUEUE_SKIPPED_OUTCOMES('skipped'), WORKER_TYPECHECK: 'failure' }, 'fail', 'pass'],
  ['a cancelled build in the queue', { EVENT: 'merge_group', ...QUEUE_SKIPPED_OUTCOMES('skipped'), FRONTEND_BUILD: 'cancelled' }, 'fail', 'pass'],
  ['the migration check skipped in the queue', { EVENT: 'merge_group', ...QUEUE_SKIPPED_OUTCOMES('skipped'), MIGRATIONS: 'skipped' }, 'fail', 'pass'],
  ['a missing drift result in the queue', { EVENT: 'merge_group', ...QUEUE_SKIPPED_OUTCOMES('skipped'), DRIFT: '' }, 'fail', 'pass'],
  ['a missing scan result in the queue', { EVENT: 'merge_group', SCAN: '' }, 'fail', 'pass'],
  ['the build skipped on a pull request', { FRONTEND_BUILD: 'skipped' }, 'fail', 'pass'],
  ['gitleaks skipped on a push', { EVENT: 'push', SCAN: 'skipped' }, 'fail', 'pass'],
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
