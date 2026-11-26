// D5614: fixture strings prove clock detection, exemptions, ratchets and shallow-base reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanSource, entriesOf, parseAllowlist, compareAllowlist, compareGrowth, needsBaseCheck, readMainAllowlist, readBaseAllowlist, scanTree, main as clockMain } from '../../scripts/check-test-clock.mjs';
const scan = (s) => scanSource(s, 'frontend/test/fixture.test.mjs');

test('date flags real reads with exact line numbers, including bare Date calls', () => {
  for (const expression of ['Date.now()', 'new Date()', 'Date()', 'Date(0)', 'new Date']) {
    assert.deepEqual(scan(`\nconst x = ${expression};`), [{ rule: 'date', path: 'frontend/test/fixture.test.mjs', line: 2 }]);
  }
  assert.deepEqual(scan('new Date(0); new Date(value); Date.parse("2026-01-01");'), []);
});

test('comments, strings, regexes and template text do not count as calls or timer mocks', () => {
  assert.deepEqual(scan('// Date.now()\n/* new Date() */\nconst x = "Date.now()"; const y = /new Date\\(\\)/; const z = `new Date()`;'), []);
  assert.equal(scan('const fixture = "mock.timers.enable({apis:[\'Date\']})"; Date.now();')[0].rule, 'date');
  assert.equal(scan('const x = `${Date.now()}`;')[0].rule, 'date');
});

test('actual mock.timers exemptions apply per API across multiline calls', () => {
  assert.deepEqual(scan("t.mock.timers.enable({\n apis: ['Date'], now: 0\n}); Date.now(); new Date();"), []);
  assert.deepEqual(scan("mock.timers.enable({apis:['setTimeout']}); await new Promise(r=>setTimeout(r,10));"), []);
  assert.equal(scan("mock.timers.enable({apis:['Date']}); await new Promise(r=>setTimeout(r,10));")[0].rule, 'sleep');
  assert.equal(scan("mock.timers.enable({apis:['setTimeout']}); Date.now();")[0].rule, 'date');
});

test('awaited fixed sleeps, promise timer aliases and constants are flagged; dynamic delays are not', () => {
  for (const src of ['await new Promise(r => setTimeout(r, 10));', 'const DELAY=10; await new Promise(r => setTimeout(r,DELAY));', "import {setTimeout as delay} from 'node:timers/promises'; await delay(5);", "import * as timers from 'node:timers/promises'; await timers.setTimeout(5);", 'await new Promise(r=>setTimeout(r,0));']) assert.equal(scan(src)[0].rule, 'sleep', src);
  assert.deepEqual(scan('await new Promise(r=>setTimeout(r, milliseconds)); setTimeout(callback, 10);'), []);
  assert.deepEqual(scan('await Promise.resolve(() => setTimeout(callback, 10));'), []);
  assert.deepEqual(scan('while (elapsed < deadline) { await new Promise(r=>setTimeout(r,10)); }'), []);
});

test('only the four exact same-line opt-out reasons pass; unknown reasons fail even with a ledger', () => {
  for (const reason of ['relative', 'deadline', 'unique-id', 'duration']) assert.deepEqual(scan(`Date.now(); // clock-ok: ${reason}`), []);
  assert.equal(scan('// clock-ok: relative\nDate.now();')[0].rule, 'date');
  const findings = scan('Date.now(); // clock-ok: anything');
  assert.ok(compareAllowlist(findings, entriesOf(findings)).some((p) => p.includes('[opt-out]')));
});

test('new offenders, clean entries and missing-file entries fail; a matching entry passes', () => {
  const findings = scan('Date.now();');
  assert.match(compareAllowlist(findings, [])[0], /fixture\.test\.mjs:1 \[date\]/);
  assert.deepEqual(compareAllowlist(findings, ['date frontend/test/fixture.test.mjs']), []);
  assert.match(compareAllowlist([], ['date frontend/test/fixture.test.mjs'])[0], /stale or missing-file/);
  assert.match(compareAllowlist([], ['sleep frontend/test/gone.test.mjs'])[0], /gone\.test\.mjs/);
});

test('allowlist is sorted and unique; growth fails, shrink passes', () => {
  const first = 'date frontend/test/a.test.mjs';const second = 'sleep frontend/test/b.test.mjs';
  assert.deepEqual(parseAllowlist(`${first}\n${second}\n`), [first, second]);
  for (const text of [`${second}\n${first}`, `${first}\n${first}`, 'wrong path']) assert.throws(() => parseAllowlist(text));
  assert.equal(compareGrowth([first, second], [first]).length, 1);
  assert.deepEqual(compareGrowth([first], [first, second]), []);
});

test('PR and merge_group both compare main; only main pushes are exempt', () => {
  for (const flags of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }, { CI: 'false', GITHUB_ACTIONS: 'true' }]) {
    for (const GITHUB_EVENT_NAME of ['pull_request', 'merge_group', 'workflow_dispatch']) assert.equal(needsBaseCheck({ ...flags, GITHUB_EVENT_NAME, GITHUB_REF: 'refs/heads/main' }), true);
    assert.equal(needsBaseCheck({ ...flags, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' }), false);
  }
  assert.equal(needsBaseCheck({ CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' }), false);
  assert.equal(needsBaseCheck({ CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/other' }), true);
  assert.equal(needsBaseCheck({}), false);
});

test('a shallow checkout fetches main; a missing main list fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'clock-base-'));
  const git = (cwd, args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' });assert.equal(r.status, 0, r.stderr);return r.stdout; };
  try {
    const seed = join(root, 'seed');const remote = join(root, 'remote.git');const checkout = join(root, 'checkout');
    mkdirSync(seed);git(root, ['init', '--bare', '--initial-branch=main', remote]);git(seed, ['init', '--initial-branch=main']);
    mkdirSync(join(seed, 'scripts'));writeFileSync(join(seed, 'scripts/test-clock-allowlist.txt'), 'date frontend/test/a.test.mjs\n');
    mkdirSync(join(seed, 'frontend/test'), { recursive: true });writeFileSync(join(seed, 'frontend/test/a.test.mjs'), 'Date.now();');
    writeFileSync(join(seed, 'package.json'), JSON.stringify({ scripts: Object.fromEntries(['test:frontend','test:worker','test:meeting-bot','test:retention'].map((key) => [key, "node --test 'frontend/test/*.test.mjs'"])) }));
    git(seed, ['add', '.']);
    const commit = () => git(seed, ['-c','user.name=Clock Fixture','-c','user.email=clock@example.invalid','commit','-m','fixture']);
    commit();git(seed, ['remote','add','origin',remote]);git(seed, ['push','origin','main']);
    git(root, ['clone','--depth=1',`file://${remote}`,checkout]);
    assert.equal(git(checkout, ['rev-parse','--is-shallow-repository']).trim(), 'true');
    assert.deepEqual(readMainAllowlist(checkout), ['date frontend/test/a.test.mjs']);
    for (const event of ['pull_request', 'merge_group']) {
      assert.equal(clockMain(checkout, { CI: 'true', GITHUB_EVENT_NAME: event }), 0);
      assert.equal(clockMain(checkout, { CI: 'false', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: event }), 0);
    }
    writeFileSync(join(checkout, 'frontend/test/b.test.mjs'), 'Date.now();');
    writeFileSync(join(checkout, 'scripts/test-clock-allowlist.txt'), 'date frontend/test/a.test.mjs\ndate frontend/test/b.test.mjs\n');
    for (const event of ['pull_request', 'merge_group']) {
      assert.equal(clockMain(checkout, { CI: 'true', GITHUB_EVENT_NAME: event }), 1);
      assert.equal(clockMain(checkout, { CI: 'false', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: event }), 1);
    }
    rmSync(join(checkout, 'frontend/test/b.test.mjs'));
    writeFileSync(join(checkout, 'scripts/test-clock-allowlist.txt'), 'date frontend/test/a.test.mjs\n');
    git(seed, ['rm','scripts/test-clock-allowlist.txt']);commit();git(seed, ['push','origin','main']);
    assert.throws(() => readMainAllowlist(checkout), /cannot read origin\/main allowlist/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// #8779: main removes a line after a pull request's merge commit was built. The tree still holds it, the fresh main
// does not, and growth was measured against main: every in-flight run failed on a line it never added.
test('growth is measured against the tree\'s own base, so main shrinking under a pull request is not growth', () => {
  const root = mkdtempSync(join(tmpdir(), 'clock-race-'));
  const git = (cwd, args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' });assert.equal(r.status, 0, r.stderr);return r.stdout; };
  const id = ['-c', 'user.name=Clock Fixture', '-c', 'user.email=clock@example.invalid'];
  try {
    const seed = join(root, 'seed');const remote = join(root, 'remote.git');const checkout = join(root, 'checkout');
    mkdirSync(seed);git(root, ['init', '--bare', '--initial-branch=main', remote]);git(seed, ['init', '--initial-branch=main']);
    mkdirSync(join(seed, 'scripts'));mkdirSync(join(seed, 'frontend/test'), { recursive: true });
    writeFileSync(join(seed, 'package.json'), JSON.stringify({ scripts: Object.fromEntries(['test:frontend','test:worker','test:meeting-bot','test:retention'].map((key) => [key, "node --test 'frontend/test/*.test.mjs'"])) }));
    writeFileSync(join(seed, 'frontend/test/a.test.mjs'), 'Date.now();');writeFileSync(join(seed, 'frontend/test/b.test.mjs'), 'Date.now();');
    writeFileSync(join(seed, 'scripts/test-clock-allowlist.txt'), 'date frontend/test/a.test.mjs\ndate frontend/test/b.test.mjs\n');
    git(seed, ['add', '.']);git(seed, [...id, 'commit', '-m', 'base']);const base = git(seed, ['rev-parse', 'HEAD']).trim();
    // The pull request: a change of its own, built on the base.
    git(seed, ['checkout', '-b', 'pr']);writeFileSync(join(seed, 'README.md'), 'pr\n');git(seed, ['add', '.']);git(seed, [...id, 'commit', '-m', 'pr']);
    // GitHub's merge commit for the run: base first, the pull request second.
    git(seed, ['checkout', '-b', 'merge', base]);git(seed, [...id, 'merge', '--no-ff', '--no-edit', 'pr']);
    // Main moves on: b's clock read is fixed and its line removed.
    git(seed, ['checkout', 'main']);writeFileSync(join(seed, 'frontend/test/b.test.mjs'), 'export {};');
    writeFileSync(join(seed, 'scripts/test-clock-allowlist.txt'), 'date frontend/test/a.test.mjs\n');git(seed, ['add', '.']);git(seed, [...id, 'commit', '-m', 'shrink']);
    git(seed, ['remote', 'add', 'origin', remote]);git(seed, ['push', 'origin', 'main', 'merge', 'pr']);
    git(root, ['clone', '--depth=1', '--branch=merge', `file://${remote}`, checkout]);
    // Measured against main the run fails; against its own base it passes.
    assert.deepEqual(compareGrowth(parseAllowlist(git(checkout, ['show', 'HEAD:scripts/test-clock-allowlist.txt'])), readMainAllowlist(checkout)),
      ['allowlist growth is forbidden: date frontend/test/b.test.mjs']);
    assert.equal(readBaseAllowlist(checkout, { GITHUB_EVENT_NAME: 'pull_request' }).base, base);
    assert.equal(clockMain(checkout, { CI: 'true', GITHUB_EVENT_NAME: 'pull_request' }), 0);
    // A line the pull request adds is still growth.
    writeFileSync(join(checkout, 'frontend/test/c.test.mjs'), 'Date.now();');
    writeFileSync(join(checkout, 'scripts/test-clock-allowlist.txt'), 'date frontend/test/a.test.mjs\ndate frontend/test/b.test.mjs\ndate frontend/test/c.test.mjs\n');
    assert.equal(clockMain(checkout, { CI: 'true', GITHUB_EVENT_NAME: 'pull_request' }), 1);
    // Only pull-request and queue runs have a base of their own; any other event is measured against main.
    assert.equal(readBaseAllowlist(checkout, { GITHUB_EVENT_NAME: 'workflow_dispatch' }), null);
    // A single-parent pull request checkout (its head, not GitHub's merge) has no base to trust: main is used.
    const head = join(root, 'head');git(root, ['clone', '--depth=1', '--branch=pr', `file://${remote}`, head]);
    assert.equal(readBaseAllowlist(head, { GITHUB_EVENT_NAME: 'pull_request' }), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('adjacent CommonJS, JSX and typed module helpers are scanned with the suite', () => {
  const root = mkdtempSync(join(tmpdir(), 'clock-helper-'));
  try {
    mkdirSync(join(root, 'frontend/test'), { recursive: true });
    writeFileSync(join(root, 'frontend/test/a.test.mjs'), 'export {};');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: Object.fromEntries(['test:frontend','test:worker','test:meeting-bot','test:retention'].map((key) => [key, "node --test 'frontend/test/*.test.mjs'"])) }));
    const helpers = {
      '_clock.cjs': 'module.exports = Date.now();',
      '_view.jsx': 'export default () => <span>{Date.now()}</span>;',
      '_module.mts': 'export const stamp: number = Date.now();',
      '_common.cts': 'const stamp: number = Date.now(); module.exports = stamp;',
    };
    for (const [file, source] of Object.entries(helpers)) writeFileSync(join(root, 'frontend/test', file), source);
    assert.deepEqual(entriesOf(scanTree(root)), Object.keys(helpers).map((file) => `date frontend/test/${file}`).sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
