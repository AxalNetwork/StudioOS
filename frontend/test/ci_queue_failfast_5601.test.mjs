import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const script = fileURLToPath(new URL('../../scripts/ci/queue-ref-alive.sh', import.meta.url));

test('queue CI checks liveness after checkout, and the suite checks again before testing', () => {
  const jobs = Object.fromEntries(workflow.split(/^  (?=[a-z][\w-]*:\n)/m).slice(1).map(job => [job.split(':')[0], job]));
  const step = /if: github\.event_name == 'merge_group'\n\s+working-directory: .*\n\s+run: bash scripts\/ci\/queue-ref-alive\.sh/g;
  for (const name of ['frontend', 'worker', 'drift', 'suite']) {
    const job = jobs[name];
    const matches = [...job.matchAll(step)];
    assert.equal(matches.length, name === 'suite' ? 2 : 1, name);
    assert.ok(matches[0].index > job.indexOf('actions/checkout'), name);
    assert.ok(matches[0].index < job.indexOf('actions/setup-node'), name);
    // D7108 part 2: the queue's own plan step also calls test-drift-parts.mjs
    // (before the installs); the second check comes before the TEST run line.
    if (name === 'suite') assert.ok(matches[1].index < job.indexOf('node scripts/test-drift-parts.mjs ${{ matrix.part }}'));
    if (name === 'suite') assert.ok(job.indexOf('node scripts/test-drift-parts.mjs ${{ matrix.part }}') > 0);
  }
});

test('queue ref check distinguishes a deleted branch from a failed lookup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'queue-ref-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  const candidate = 'a'.repeat(40);
  const ref = 'refs/heads/gh-readonly-queue/main/pr-1-' + 'b'.repeat(40);
  try {
    git('init', '-q');
    git('init', '-q', '--bare', 'remote.git');
    git('remote', 'add', 'origin', join(dir, 'remote.git'));
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture', '--allow-empty');
    git('push', 'origin', `HEAD:${ref}`);
    const run = () => spawnSync('bash', [script], { cwd: dir, env: { ...process.env, GITHUB_REF: ref, GITHUB_SHA: candidate, GITHUB_EVENT_NAME: 'merge_group',
      GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '3' }, encoding: 'utf8' });
    assert.equal(run().status, 0);
    git('push', 'origin', `:${ref}`);
    const lost = run();
    assert.equal(lost.status, 2);
    assert.ok(lost.stdout.includes('StudioOS queue outcome v1::ref-lost 12 3 ' + candidate + ' ' + ref));
    git('remote', 'set-url', 'origin', join(dir, 'missing.git'));
    const unavailable = run();
    assert.equal(unavailable.status, 0);
    assert.match(unavailable.stdout, /::notice::/);
    assert.doesNotMatch(unavailable.stdout, /StudioOS queue outcome v1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
