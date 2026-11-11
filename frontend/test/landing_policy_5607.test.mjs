import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { changedFiles, classify } from '../../scripts/merge-policy.mjs';

function file(path, status = 'M', patch = '', previousPath) {
  return { path, status, patch, previousPath };
}

function hunk(...lines) {
  return ['@@ -1 +1 @@', ...lines].join('\n');
}

test('landing policy selects the most restrictive tier', () => {
  const docs = file('documentation/operations/guide.md');
  assert.equal(classify([docs, file('frontend/src/components/Button.jsx')]).tier, 'T0');
  assert.equal(classify([file('frontend/test/example.test.mjs', 'A')]).tier, 'T0');
  assert.equal(classify([docs, file('cloudflare-worker/src/routes/example.ts')]).tier, 'T1');
  const migration = classify([docs, file('cloudflare-worker/sql/migrations/001_example.sql')]);
  assert.equal(migration.tier, 'T2');
  assert.match(migration.reasons.join('\n'), /T2: protected path: cloudflare-worker\/sql\//);
  assert.equal(classify([file('unclassified/new.sh')]).tier, 'T2');
  assert.equal(classify([file('cloudflare-worker/src/routes/teamBilling.ts')]).tier, 'T2');
  assert.equal(classify([file('frontend/test/_custom-loader.mjs', 'A')]).tier, 'T2');
  assert.equal(classify([file('documentation/link.md', 'A', 'new file mode 120000')]).tier, 'T2');
  assert.equal(classify([file('documentation/reference.md', 'R100', '', 'scripts/sensitive.mjs')]).tier, 'T2');
  assert.equal(classify([]).tier, 'T2');
});

test('landing policy identifies each test-weakening signal independently', () => {
  const testPath = 'frontend/test/example.test.mjs';
  const cases = [
    [file(testPath, 'D'), /Test deleted or renamed/],
    [file('documentation/example.md', 'R100', '', testPath), /Test deleted or renamed/],
    [file(testPath, 'A', hunk("+test.skip('example', () => {});")), /Test skip, todo or only added/],
    [file(testPath, 'A', hunk("+test.todo('example');")), /Test skip, todo or only added/],
    [file(testPath, 'A', hunk("+test.only('example', () => {});")), /Test skip, todo or only added/],
    [file(testPath, 'M', hunk('-test("works", () => {});')), /Test or assertion count dropped/],
    [file(testPath, 'M', hunk('-assert.equal(got, want);')), /Test or assertion count dropped/],
    [file('scripts/test-drift-parts.mjs', 'M', hunk(' const SHARDS = {', '- tests: 6,', '+ tests: 4,')), /Suite shard declaration changed/],
    [file('documentation/example-baseline.json'), /Test baseline or ledger changed/],
    [file('documentation/example-ledger.json'), /Test baseline or ledger changed/],
    [file('scripts/baselines/example.json'), /Test baseline or ledger changed/],
    [file('frontend/src/components/Button.jsx', 'M', hunk('-setTimeout(run, 10);', '+setTimeout(run, 100);')), /Timeout changed/],
  ];
  for (const [changed, reason] of cases) {
    const result = classify([file('documentation/example.md'), changed]);
    assert.equal(result.tier, 'T2', changed.path);
    assert.match(result.reasons.join('\n'), reason);
  }
  const sameCount = file(testPath, 'M', hunk('-assert.equal(got, first);', '+assert.equal(got, second);'));
  assert.doesNotMatch(classify([sameCount]).reasons.join('\n'), /count dropped/);
});

test('the Git diff adapter keeps previous paths and literal filenames', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'landing-policy-'));
  const previous = process.cwd();
  t.after(() => { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); });
  process.chdir(cwd);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync('scripts');
  mkdirSync('documentation');
  writeFileSync('scripts/risk.mjs', 'export const stable = true;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('mv', 'scripts/risk.mjs', 'documentation/renamed [x].md');
  git('commit', '-qm', 'move');
  const files = changedFiles(base, git('rev-parse', 'HEAD'));
  assert.equal(files[0].previousPath, 'scripts/risk.mjs');
  assert.equal(files[0].path, 'documentation/renamed [x].md');
  assert.equal(classify(files).tier, 'T2');
});

test('shadow workflow checks out and executes the base only with read permission', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/landing-policy.yml', import.meta.url), 'utf8');
  const instructions = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
  assert.match(workflow, /on:\n  pull_request:\n/);
  assert.doesNotMatch(workflow, /paths:|merge_group|pull_request_target/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /git rev-parse FETCH_HEAD\)" == "\$HEAD_SHA"/);
  assert.match(workflow, /node scripts\/merge-policy\.mjs --base "\$BASE_SHA" --head "\$HEAD_SHA"/);
  assert.match(instructions, /gh pr ready/);
  assert.match(instructions, /gh pr merge --auto --squash/);
  assert.match(instructions, /owner lands T2/);
  assert.match(instructions, /PR did not edit\n   `\.github\/workflows\/landing-policy\.yml`/);
});
