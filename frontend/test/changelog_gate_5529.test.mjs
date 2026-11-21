import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../../scripts/changelog-gate.mjs', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'changelog-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'stacked');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'config', 'commit.gpgsign', 'false');
  function commit(file, contents) {
    writeFileSync(join(root, file), contents);
    git(root, 'add', '--', file);
    git(root, 'commit', '-qm', file);
    return git(root, 'rev-parse', 'HEAD');
  }

  commit('CHANGELOG.md', 'original\n');
  const base = commit('stacked.txt', 'base\n');
  git(root, 'switch', '-qc', 'feature');
  const unchanged = commit('feature.txt', 'feature\n');
  const edited = commit('CHANGELOG.md', 'feature changelog\n');
  return { root, base, unchanged, edited, commit };
}

function gate(cwd, base, head, labelled = false) {
  return spawnSync(process.execPath, [script], {
    cwd, encoding: 'utf8',
    env: { ...process.env, CHANGELOG_BASE_SHA: base, CHANGELOG_HEAD_SHA: head, CHANGELOG_LABEL: String(labelled) },
  });
}

test('uses the event head with complete history and an unavailable remote', t => {
  const { root, base, unchanged, edited } = fixture(t);
  git(root, 'remote', 'add', 'origin', join(root, 'unreachable'));
  const clean = gate(root, base, unchanged);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /does not touch/);
  const refused = gate(root, base, edited);
  assert.equal(refused.status, 1, refused.stderr);
  assert.ok(refused.stderr.includes(`git restore --source=${base}`), refused.stderr);
  const allowed = gate(root, base, edited, true);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /carries the/);
});

test('a moved or deleted stacked base cannot change the earlier verdict', t => {
  const { root, base, unchanged, edited, commit } = fixture(t);
  git(root, 'remote', 'add', 'origin', root);
  git(root, 'switch', '-q', 'stacked');
  // Advance the branch beyond the PR, including its edit and another changelog change.
  git(root, 'merge', '--ff-only', edited);
  commit('CHANGELOG.md', 'later change\n');
  assert.equal(gate(root, base, edited).status, 1);
  assert.equal(gate(root, base, unchanged).status, 0);
  git(root, 'switch', '-q', 'feature');
  git(root, 'branch', '-D', 'stacked');
  assert.equal(gate(root, base, edited).status, 1);
  assert.equal(gate(root, base, unchanged).status, 0);
});

test('recovers exact event commits and common ancestry from a shallow checkout', t => {
  const { root, base, edited, commit } = fixture(t);
  git(root, 'switch', '-q', 'stacked');
  const divergedBase = commit('stacked.txt', 'new base\n');
  const checkout = join(root, 'shallow');
  git(root, 'clone', '-q', '--depth', '1', '--branch', 'feature', pathToFileURL(root).href, checkout);
  assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'true');
  const verdict = gate(checkout, divergedBase, edited);
  assert.equal(verdict.status, 1, verdict.stderr);
  assert.ok(verdict.stderr.includes(`git restore --source=${base}`), verdict.stderr);
  assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'false');
});

test('unknown history returns exit 2 even with the changelog label', t => {
  const { root, edited } = fixture(t);
  git(root, 'remote', 'add', 'origin', join(root, 'unreachable'));
  const verdict = gate(root, 'a'.repeat(40), edited, true);
  assert.equal(verdict.status, 2);
  assert.match(verdict.stderr, /exact PR event commits from origin in one bounded fetch/);
  const invalid = gate(root, 'refs/heads/stacked', edited);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /full PR event commit SHAs/);
});

test('workflow supplies exact event SHAs and checks out full history', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/changelog-gate.yml', import.meta.url), 'utf8');
  assert.match(workflow, /fetch-depth: 0/);
  for (const side of ['base', 'head']) {
    const binding = `CHANGELOG_${side.toUpperCase()}_SHA: ` + '$' + `{{ github.event.pull_request.${side}.sha }}`;
    assert.ok(workflow.includes(binding), binding);
  }
});
