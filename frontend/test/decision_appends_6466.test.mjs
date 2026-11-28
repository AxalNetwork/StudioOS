/**
 * From frontend/test/README.md (moved by #6472): D6466: temp git repos where an appended section,
 * an over-threshold addendum, an existing part file and an old decision fail with the D5615
 * instruction; typo, link and heading-rename fixes, new `D<n>.md` and `D<n>-p<k>.md`, the shallow
 * PR merge checkout and this branch pass; no base exits 2.
 */
import { guardChain } from '../../scripts/lib/guardCatalog.mjs';
/**
 * D6466 (#6466): `scripts/check-decision-appends.mjs` fails a change that
 * appends a section to a decision file already on its base, and tells the
 * author to write `D<n>-p<k>.md` (D5615).
 *
 * The guard's run under `test:guards` only proves today's branch is clean.
 * These tests build small git repositories under the OS temp directory (no
 * network: the "remote" is a local path) and run the real script in them, so
 * every rule, the shallow pull-request checkout CI uses, and the "could not
 * check" exit are exercised against diffs that are wrong on purpose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { MAX_NET_LINES, findAppends, sectionHeadings } from '../../scripts/check-decision-appends.mjs';
import { headerComment, indexMode } from '../../scripts/lib/folderFiles.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/check-decision-appends.mjs');
const DIR = 'documentation/architecture/decisions';

// The fixtures must not inherit the CI run's own event: a PR run sets
// GITHUB_EVENT_NAME=pull_request, which would send every fixture down the
// merge-commit path.
const cleanEnv = (extra = {}) => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(GITHUB_|DECISION_APPEND_)/.test(k)) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', ...extra };
};

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const body = (n, title) => [
  `## D${n} — ${title} (#${n})`,
  '',
  '- **Status:** built.',
  '- **Why:** the fixture needs a reason.',
  '',
  '### What changed',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of the record, with a [link](https://example.invalid/${i}).`),
  '',
  '### Verification',
  '',
  '- the fixture test.',
  '',
].join('\n');

const temps = [];
test.after(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

/** A repo whose `main` holds four decisions, checked out on `feature`. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'decision-appends-6466-'));
  temps.push(root);
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, DIR), { recursive: true });
  writeFileSync(join(root, DIR, 'D4838.md'), body(4838, 'Studio packages'));
  writeFileSync(join(root, DIR, 'D4811.md'), body(4811, 'Many parts'));
  writeFileSync(join(root, DIR, 'D4811-p21.md'), body(4811, 'Many parts').replace('## D4811 —', '## D4811 part 21 —'));
  writeFileSync(join(root, DIR, 'D4811-p24.md'), body(4811, 'Many parts').replace('## D4811 —', '## D4811 part 24 —'));
  writeFileSync(join(root, DIR, 'D1234.md'), body(1234, 'An old one').replace(' (#1234)', ''));
  writeFileSync(join(root, DIR, 'README.md'), '# decisions\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'feature');
  return root;
}

const file = (root, name) => join(root, DIR, name);
const read = (root, name) => readFileSync(file(root, name), 'utf8');
const append = (root, name, text) => writeFileSync(file(root, name), read(root, name) + text);
const commit = (root, msg = 'change') => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', msg);
};
const run = (cwd, extra = { DECISION_APPEND_BASE: 'main' }) => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, env: cleanEnv(extra), encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const lines = (n, word = 'Added') => Array.from({ length: n }, (_, i) => `${word} line ${i + 1}.`).join('\n') + '\n';

test('appending a section to an existing D<n>.md fails, with the D5615 instruction', () => {
  const root = fixture();
  append(root, 'D4838.md', '\n### Built, PP12\n\nThe package shipped.\n');
  commit(root);
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /D4838\.md is already on the base/);
  assert.match(out, /1 new section heading \("### Built, PP12"\)/);
  assert.match(out, /D4838-p<k>\.md/);
  assert.match(out, /## D4838 part <k> — <title> \(#4838\)/);
  assert.match(out, /\(D5615\)/);
  assert.match(out, /git diff [0-9a-f]{10} -- documentation\/architecture\/decisions\/D4838\.md/);
});

test('a second-level section counts too', () => {
  const root = fixture();
  append(root, 'D4838.md', '\n## Built\n\nx\n');
  commit(root);
  assert.equal(run(root).code, 1);
});

test('an unheaded addendum longer than the threshold fails; one at the threshold passes', () => {
  const over = fixture();
  append(over, 'D4838.md', lines(MAX_NET_LINES + 1));
  commit(over);
  const r = run(over);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`${MAX_NET_LINES + 1} more lines \\(at most ${MAX_NET_LINES}`));

  const at = fixture();
  append(at, 'D4838.md', lines(MAX_NET_LINES));
  commit(at);
  assert.equal(run(at).code, 0, run(at).out);
});

test('the threshold is net growth: a rewritten paragraph of the same length passes', () => {
  const root = fixture();
  const text = read(root, 'D4838.md').replace(/^Line (\d+) of the record/gm, 'Line $1 of the corrected record');
  writeFileSync(file(root, 'D4838.md'), text + lines(3));
  commit(root);
  const { code, out } = run(root);
  assert.equal(code, 0, out);
});

test('a typo fix and a link fix pass', () => {
  const root = fixture();
  writeFileSync(file(root, 'D4838.md'), read(root, 'D4838.md').replace('needs a reason', 'needs a raeson').replace('example.invalid/3', 'example.invalid/three'));
  commit(root);
  const { code, out } = run(root);
  assert.equal(code, 0, out);
  assert.match(out, /✓ decision-appends: .*1 of the 5 decision files already there changed/);
});

test('a heading renamed (a typo in it) is not a new section', () => {
  const root = fixture();
  writeFileSync(file(root, 'D4838.md'), read(root, 'D4838.md').replace('### Verification', '### Verifcation'));
  commit(root);
  assert.equal(run(root).code, 0);
});

test('a heading inside fenced code is not a section', () => {
  const root = fixture();
  append(root, 'D4838.md', '```\n### quoted\n```\n');
  commit(root);
  assert.equal(run(root).code, 0, run(root).out);
});

test('a new D<n>-p<k>.md passes, however long', () => {
  const root = fixture();
  writeFileSync(file(root, 'D4838-p2.md'), body(4838, 'Studio packages').replace('## D4838 —', '## D4838 part 2 —') + lines(40));
  commit(root);
  const { code, out } = run(root);
  assert.equal(code, 0, out);
  assert.match(out, /0 of the 5 decision files already there changed/);
});

test('a new D<n>.md passes', () => {
  const root = fixture();
  writeFileSync(file(root, 'D6466.md'), body(6466, 'The guard') + lines(40));
  commit(root);
  assert.equal(run(root).code, 0);
});

test('an existing part file is held to the same rule, and the message names the parts taken', () => {
  const root = fixture();
  append(root, 'D4811-p21.md', '\n### Built, later\n\nx\n');
  commit(root);
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /D4811-p21\.md is already on the base/);
  assert.match(out, /taken: 21, 24; the next free number is 25/);
});

test('a decision below D4000 is pointed at the author\'s own decision file, not a part file', () => {
  const root = fixture();
  append(root, 'D1234.md', '\n### Later\n\nx\n');
  commit(root);
  const { code, out } = run(root);
  assert.equal(code, 1, out);
  assert.match(out, /D1234 predates issue-numbered decisions/);
  assert.match(out, /D<issue>\.md, citing D1234/);
  assert.doesNotMatch(out, /D1234-p<k>/);
});

test('an uncommitted append is caught on a local run', () => {
  const root = fixture();
  append(root, 'D4838.md', '\n### Not yet committed\n');
  assert.equal(run(root).code, 1);
});

test('edits on the base branch after the change branched are not this change\'s', () => {
  const root = fixture();
  git(root, 'checkout', '-q', 'main');
  // main drops a section after the branch point; against main's tip the
  // branch's untouched copy would read as adding it back.
  writeFileSync(file(root, 'D4838.md'), read(root, 'D4838.md').replace(/### Verification[\s\S]*$/, ''));
  commit(root, 'main moves');
  git(root, 'checkout', '-q', 'feature');
  writeFileSync(file(root, 'D6466.md'), body(6466, 'The guard'));
  commit(root);
  assert.equal(run(root).code, 0, run(root).out);
});

test('no resolvable base is a failure that says so, never a pass', () => {
  const root = fixture();
  const { code, out } = run(root, { DECISION_APPEND_BASE: 'origin/nowhere' });
  assert.equal(code, 2, out);
  assert.match(out, /could not check: origin\/nowhere does not resolve/);
  assert.doesNotMatch(out, /✓/);
});

test('a base with no decision files is a failure, not a pass over nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-appends-6466-'));
  temps.push(root);
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'x.txt'), 'x\n');
  commit(root, 'base');
  const { code, out } = run(root);
  assert.equal(code, 2, out);
  assert.match(out, /holds no decision file/);
});

test('a push says it skipped and exits 0', () => {
  const root = fixture();
  append(root, 'D4838.md', '\n### Pushed\n');
  commit(root);
  const { code, out } = run(root, { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' });
  assert.equal(code, 0, out);
  assert.match(out, /skipped, not checked: a push to main is not a pull request/);
});

/**
 * CI's `suite` job checks out GitHub's merge commit at depth 1. Rebuild that:
 * an "origin" with `main`, the PR branch, and a merge of the two; a shallow
 * clone of the merge; the guard run as a pull_request event, so it must fetch
 * the merge's first parent itself.
 */
function shallowPullRequest(change) {
  const origin = fixture();
  change(origin);
  commit(origin);
  git(origin, 'checkout', '-q', 'main');
  writeFileSync(join(origin, 'other.txt'), 'main moved on\n');
  commit(origin, 'main moves');
  git(origin, 'checkout', '-q', '-b', 'pull-merge');
  git(origin, 'merge', '-q', '--no-ff', '-m', 'Merge feature into main', 'feature');
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const clone = mkdtempSync(join(tmpdir(), 'decision-appends-6466-clone-'));
  temps.push(clone);
  git(tmpdir(), 'clone', '-q', '--depth=1', '--branch', 'pull-merge', `file://${origin}`, clone);
  assert.equal(git(clone, 'rev-parse', '--is-shallow-repository').trim(), 'true');
  return run(clone, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', GITHUB_ACTIONS: 'true' });
}

test('in a shallow pull-request merge checkout, an append still fails', () => {
  const { code, out } = shallowPullRequest((root) => append(root, 'D4838.md', '\n### Built, PP13\n\nx\n'));
  assert.equal(code, 1, out);
  assert.match(out, /D4838\.md is already on the base/);
});

test('in a shallow pull-request merge checkout, a new part file passes against the merge\'s first parent', () => {
  const { code, out } = shallowPullRequest((root) => writeFileSync(file(root, 'D4838-p2.md'), body(4838, 'x').replace('## D4838 —', '## D4838 part 2 —')));
  assert.equal(code, 0, out);
  assert.match(out, /first parent of the PR merge commit/);
});

test('the rule, without git: headings outside fences, net growth, unrelated names ignored', () => {
  assert.deepEqual(sectionHeadings('## a\n```\n### b\n```\n### c\n#### d\n'), ['## a', '### c']);
  const before = body(4838, 't');
  assert.equal(findAppends([{ name: 'D4838.md', before, after: before.replace('reason', 'raeson') }]).length, 0);
  assert.equal(findAppends([{ name: 'D4838.md', before, after: `${before}### x\n` }]).length, 1);
  assert.equal(findAppends([{ name: 'README.md', before, after: `${before}### x\n` }]).length, 0);
});

test('the branch that introduces the guard passes', () => {
  // The real repository, in whatever context this suite runs: a local branch
  // against origin/main, or CI's own pull-request checkout.
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ decision-appends|skipped, not checked/);
});

test('the guard runs in test:guards, beside check-decision-ids, and is documented', () => {
  const chain = guardChain.split(' && ');
  assert.ok(chain.includes('node scripts/check-decision-appends.mjs'), 'the guard is not in test:guards, so nothing runs it on a PR');
  // #6470: scripts/README.md's list is generated from each script's header comment, which opens with the decision.
  assert.equal(indexMode(readFileSync(resolve(process.cwd(), 'scripts/README.md'), 'utf8')), 'generated');
  assert.match(headerComment('check-decision-appends.mjs', readFileSync(resolve(process.cwd(), 'scripts/check-decision-appends.mjs'), 'utf8')), /^D6466/);
});
