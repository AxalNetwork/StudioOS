/**
 * D8432 (#8432): what a clean merge can still break, read from the merged tree.
 *
 * The scanner has no YAML parser behind it, so the second test holds it to the real one: every workflow file in
 * the repository, and a copy of each with one line doubled, must give the same number of duplicate keys. The git
 * cases run real git in a temporary repository with a local `origin`; nothing reaches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { blocksQueue, duplicateYamlKeys, mergeSkew, skewFor } from './queueSkew.mjs';

const at = source => duplicateYamlKeys(source).map(hit => `${hit.line}:${hit.column} ${hit.key}`);

test('a key given twice in one block mapping is found, and only there', () => {
  assert.deepEqual(at('jobs:\n  a:\n    runs-on: x\n    permissions:\n      contents: read\n    permissions:\n      contents: read\n'), ['6:5 permissions']);
  // The same key in sibling mappings, in separate sequence entries and at another depth is not a duplicate.
  assert.deepEqual(at('jobs:\n  a:\n    name: x\n  b:\n    name: y\nname: z\n'), []);
  assert.deepEqual(at('steps:\n  - name: a\n    run: x\n  - name: b\n    run: y\n'), []);
  assert.deepEqual(at('steps:\n  - name: a\n    name: b\n  - - name: c\n    - name: d\n'), ['3:5 name']);
  assert.deepEqual(at('a: 1\nb: 2\na: 3\na: 4\n'), ['3:1 a', '4:1 a']);
  // An empty first value still counts: the parser reports this one on the first key's line.
  assert.deepEqual(at('on:\non:\n  push:\n'), ['2:1 on']);
  assert.deepEqual(at('"on": 1\n\'on\': 2\non: 3\n'), ['2:1 on', '3:1 on']);
});

test('text that only looks like a key is skipped: block scalars, comments, quotes and flow collections', () => {
  assert.deepEqual(at('run: |\n  name: a\n  name: a\nname: b\n'), []);
  assert.deepEqual(at('- run: >-\n    key: 1\n    key: 1\n  key: 2\n'), []);
  assert.deepEqual(at('a: 1\n# a: 2\n  # a: 3\nb: 2 # a: 4\n'), []);
  assert.deepEqual(at('a: "first line\n  a: still the string\n  end"\nb: 1\n'), []);
  assert.deepEqual(at("a: 'it''s\n  a: quoted'\nb: 1\n"), []);
  // Inside an open quote, lines that repeat a key are text. Without the quote they are a real duplicate.
  assert.deepEqual(at('k:\n  a: "x\n    b: 1\n    b: 2"\n  c: 1\n'), []);
  assert.deepEqual(at('k:\n  a:\n    b: 1\n    b: 2\n  c: 1\n'), ['4:5 b']);
  assert.deepEqual(at('- - name: a\n  - name: b\n- name: c\n  name: d\n'), ['4:3 name']);
  assert.deepEqual(at('with: { a: 1, a: 2 }\nif: ${{ a == b }}\nurl: https://example.test/a: b\n'), []);
  assert.deepEqual(at('---\na: 1\n...\n'), []);
  assert.deepEqual(at('a:\r\n  b: 1\r\n  b: 2\r\n'), ['3:3 b']);
  assert.deepEqual(at(''), []);
});

test('the scanner and the real parser count the same duplicates in every workflow, and in each with a line doubled', () => {
  const directory = new URL('../../.github/workflows/', import.meta.url);
  let files = 0, variants = 0, withDuplicate = 0;
  for (const name of readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).sort()) {
    const source = readFileSync(new URL(name, directory), 'utf8'), lines = source.split('\n');
    files++;
    assert.deepEqual(at(source), [], `${name} as committed`);
    for (let i = files % 4; i < lines.length; i += 4) {
      if (!lines[i].trim()) continue;
      const doubled = [...lines.slice(0, i + 1), lines[i], ...lines.slice(i + 1)].join('\n');
      const errors = parseDocument(doubled).errors;
      if (errors.some(error => error.code !== 'DUPLICATE_KEY')) continue;
      variants++;
      if (errors.length) withDuplicate++;
      assert.equal(duplicateYamlKeys(doubled).length, errors.length, `${name} with line ${i + 1} doubled: ${lines[i]}`);
    }
  }
  assert.ok(files >= 60 && variants > 1500 && withDuplicate > 800, `${files} files, ${variants} variants, ${withDuplicate} with a duplicate`);
});

/** A repository with a local bare `origin`, a workflow on `main`, and a helper to commit a branch from any commit. */
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'queue-skew-')), origin = join(root, 'origin.git'), work = join(root, 'work');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args, cwd = work) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  mkdirSync(origin); git(['init', '--bare', '--initial-branch=main', '.'], origin);
  mkdirSync(join(work, '.github/workflows'), { recursive: true });
  git(['init', '--initial-branch=main', '.']); git(['remote', 'add', 'origin', origin]);
  const commit = (branch, from, files, message) => {
    if (from) git(['checkout', '--quiet', '-B', branch, from]); else git(['checkout', '--quiet', '-B', branch]);
    for (const [path, text] of Object.entries(files)) writeFileSync(join(work, path), text);
    git(['add', '-A']); git(['commit', '--quiet', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  return { work, git, commit };
}
const WORKFLOW = ['on: push', 'jobs:', '  analyze:', '    name: analyze', '    needs: [scope]', '    if: always()', '    runs-on: ubuntu-latest', '    timeout-minutes: 60', '    steps:', '      - run: test', ''].join('\n');
const withTop = WORKFLOW.replace('  analyze:\n', '  analyze:\n    permissions:\n      contents: read\n');
const withLower = WORKFLOW.replace('    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n');

test('two valid changes that merge without a conflict into a doubled key are reported with file, line and key', t => {
  const { work, commit } = repository(t);
  const start = commit('main', null, { '.github/workflows/codeql.yml': WORKFLOW, 'README.md': 'a\n' }, 'start');
  const base = commit('main', start, { '.github/workflows/codeql.yml': withLower }, 'main moves the permission to the job');
  const head = commit('pr', start, { '.github/workflows/codeql.yml': withTop }, 'the PR does the same, higher up');
  assert.deepEqual(at(withTop), []); assert.deepEqual(at(withLower), []);
  const skew = mergeSkew(base, head, { cwd: work });
  assert.deepEqual(skew, { status: 'breaks', problems: ['.github/workflows/codeql.yml:10:5 key permissions is given twice'] });
  assert.equal(blocksQueue(skew), true);
  // The same head against the commit it was cut from is clean, and so is a PR that leaves workflows alone.
  assert.deepEqual(mergeSkew(start, head, { cwd: work }), { status: 'clean', problems: [] });
  const docs = commit('docs', start, { 'README.md': 'b\n' }, 'docs only');
  assert.deepEqual(mergeSkew(base, docs, { cwd: work }), { status: 'clean', problems: [] });
  assert.equal(blocksQueue({ status: 'clean', problems: [] }), false);
  assert.equal(blocksQueue({ status: 'not checked', problems: [] }), false);
  assert.equal(blocksQueue(undefined), false);
});

test('a conflict is a conflict, a doubled key already on the base is the base\'s, and git failing is not checked', t => {
  const { work, commit } = repository(t);
  const start = commit('main', null, { '.github/workflows/ci.yml': WORKFLOW, 'README.md': 'a\n' }, 'start');
  const ours = commit('main', start, { 'README.md': 'main\n' }, 'main edits the line');
  const theirs = commit('pr', start, { 'README.md': 'pr\n' }, 'the PR edits it too');
  assert.deepEqual(mergeSkew(ours, theirs, { cwd: work }), { status: 'conflict', problems: [] });
  assert.equal(blocksQueue({ status: 'conflict', problems: [] }), true);

  const doubled = WORKFLOW.replace('    name: analyze\n', '    name: analyze\n    name: again\n');
  const broken = commit('main', start, { '.github/workflows/ci.yml': doubled }, 'the base already has the key twice');
  const touches = commit('pr2', start, { '.github/workflows/ci.yml': WORKFLOW.replace('timeout-minutes: 60', 'timeout-minutes: 30') }, 'the PR changes another line');
  assert.deepEqual(mergeSkew(broken, touches, { cwd: work }), { status: 'clean', problems: [] });

  const unknown = { status: 'not checked', problems: [] };
  assert.deepEqual(mergeSkew(ours, 'f'.repeat(40), { cwd: work }), unknown);
  assert.deepEqual(mergeSkew('main', theirs, { cwd: work }), unknown);
  assert.deepEqual(mergeSkew(ours, theirs, { cwd: work, spawn: () => ({ error: new Error('timeout') }) }), unknown);
  const noDiff = (cmd, args, opts) => (args[0] === 'diff-tree' ? { status: 128, stdout: '' } : spawnSync(cmd, args, opts));
  assert.deepEqual(mergeSkew(start, touches, { cwd: work, spawn: noDiff }), unknown);
});

test('the list\'s check fetches the head as data, and answers only for the head GitHub named', t => {
  const { work, git, commit } = repository(t);
  const start = commit('main', null, { '.github/workflows/codeql.yml': WORKFLOW, 'README.md': 'a\n' }, 'start');
  const base = commit('main', start, { '.github/workflows/codeql.yml': withLower }, 'main');
  git(['push', '--quiet', 'origin', 'main']); git(['fetch', '--quiet', 'origin']);
  const head = commit('pr', start, { '.github/workflows/codeql.yml': withTop }, 'pr');
  git(['push', '--quiet', 'origin', `${head}:refs/pull/7/head`]);
  git(['checkout', '--quiet', 'main']); git(['branch', '--quiet', '-D', 'pr']);
  const pr = { number: 7, head: { sha: head }, base: { ref: 'main' } };
  assert.equal(git(['rev-parse', 'origin/main']), base);
  assert.deepEqual(skewFor(pr, { cwd: work }), { status: 'breaks', problems: ['.github/workflows/codeql.yml:10:5 key permissions is given twice'] });
  assert.equal(git(['rev-parse', 'HEAD']), base, 'nothing was checked out');
  assert.equal(git(['status', '--porcelain']), '', 'and the working tree is untouched');
  const unknown = { status: 'not checked', problems: [] };
  assert.deepEqual(skewFor({ ...pr, head: { sha: start } }, { cwd: work }), unknown, 'the fetched head is not the one named');
  assert.deepEqual(skewFor({ ...pr, number: 8 }, { cwd: work }), unknown, 'no such pull ref');
  assert.deepEqual(skewFor({ ...pr, base: { ref: 'release' } }, { cwd: work }), unknown, 'no such base');
  for (const bad of [{ ...pr, number: 0 }, { ...pr, number: '7' }, { ...pr, head: { sha: 'abc' } }, { ...pr, base: { ref: '../main' } }, { ...pr, base: { ref: 'a..b' } }, {}, null]) {
    const calls = [];
    assert.deepEqual(skewFor(bad, { cwd: work, spawn: (...a) => { calls.push(a); return { status: 1 }; } }), unknown);
    assert.equal(calls.length, 0, `git is not run for ${JSON.stringify(bad)}`);
  }
});
