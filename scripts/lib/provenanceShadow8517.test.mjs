// D8517 (#8517): the release's provenance report is SHADOW MODE. These tests pin the one admission step
// that runs it: it sits in the admission job, widens no permission, reads no secret beyond the job's own
// token, and cannot fail the job, both by its text (continue-on-error, exit 0) and by running its script
// with every command it calls broken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const source = readFileSync(join(ROOT, '.github/workflows/cloudflare-worker-deploy.yml'), 'utf8');
const admission = source.split('\n  admission:\n')[1].split('\n  deploy:\n')[0];
const steps = admission.split('\n    steps:\n')[1].split(/\n(?=      - )/);
const NAME = 'Report commit provenance (shadow)';
const step = steps.find((s) => s.includes(`name: ${NAME}\n`));

test('the shadow step is one step of the admission job, ahead of the candidate wait', () => {
  assert.ok(step, 'the admission job has the step');
  assert.equal(source.split(`name: ${NAME}`).length, 2, 'it appears once in the workflow');
  const at = (frag) => steps.findIndex((s) => s.includes(frag));
  assert.ok(at(NAME) < at('name: Wait for all six required checks'));
  assert.match(step, /node scripts\/ci\/agent-provenance\.mjs --shadow --candidate "\$GITHUB_SHA" --previous "\$previous"/);
});

test('the step widens no access: the job keeps contents and actions read, and the step reads only its own token', () => {
  assert.match(admission, /\n    permissions:\n      contents: read\n      actions: read\n    steps:/);
  assert.doesNotMatch(admission, /^ {6}(?:\w+-?\w*): write$|pull-requests:|id-token:/m);
  assert.doesNotMatch(step, /secrets\./);
  assert.deepEqual([...step.matchAll(/^ {10}([A-Z_]+): (.+)$/gm)].map((m) => [m[1], m[2]]),
    [['GH_TOKEN', '${{ github.token }}'], ['REPO', '${{ github.repository }}']]);
  assert.doesNotMatch(step, /environment:/);
});

test('the step cannot fail the job: continue-on-error, a bounded time, `|| true` on every command and a closing exit 0', () => {
  assert.match(step, /^ {8}continue-on-error: true$/m);
  assert.match(step, /^ {8}timeout-minutes: 5$/m);
  assert.doesNotMatch(step, /^ {8}if:/m, 'it runs on every candidate');
  const script = step.split('        run: |\n')[1].split('\n').map((l) => l.replace(/^ {10}/, ''));
  assert.equal(script.filter(Boolean).at(-1), 'exit 0');
  for (const l of script.filter((x) => /^(?:node|git fetch|previous=\$\(gh)/.test(x))) assert.match(l, /\|\| true\)?$/, l);
});

test('run for real with gh, git and node all broken, the step script still exits 0', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-step-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const tool of ['gh', 'git', 'node']) {
    writeFileSync(join(dir, tool), '#!/bin/sh\necho "$0 broken" >&2\nexit 1\n');
    chmodSync(join(dir, tool), 0o755);
  }
  const script = step.split('        run: |\n')[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const r = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', script], { encoding: 'utf8', cwd: dir,
    env: { PATH: `${dir}:/usr/bin:/bin`, GH_TOKEN: 'fixture-not-a-token', REPO: 'example/example', GITHUB_SHA: 'a'.repeat(40) } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /node broken/, 'the broken node really ran');
});
