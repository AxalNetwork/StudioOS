/**
 * D8067 (#8067): one privileged-path list, read by every gate. The list is merge-control's PRIVILEGED_PATHS; T2,
 * the landing bot's PROTECTED, the generated CODEOWNERS block, the `pr:privileged` label and the ruleset's
 * file-path condition all come from it. The old two lists are pinned here as they stood, so the new one is
 * shown to cover every path either covered (no gate loses a path).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PRIVILEGED, PRIVILEGED_PATHS, classify, globRegExp, isPrivileged, privilegedFiles } from '../../merge-control/src/lib/classify.mjs';
import * as viaPolicy from '../../scripts/merge-policy.mjs';
import { PROTECTED, pathGuard } from '../../scripts/landing-bot/rules.mjs';
import { CODEOWNERS_BEGIN, CODEOWNERS_END, codeownersBlock, codeownersBlockIn, rulesetPaths, withCodeownersBlock } from '../../scripts/lib/privilegedPaths.mjs';
import { main } from '../../scripts/check-privileged-paths.mjs';

const root = new URL('../../', import.meta.url);
const at = (p) => readFileSync(new URL(p, root), 'utf8');

// The two lists as they stood before D8067: merge-control's SENSITIVE (the path half of T2) and rules.mjs PROTECTED.
const OLD_SENSITIVE = /(?:^|\/)(?:\.github|scripts|merge-control|attached_assets)(?:\/|$)|^cloudflare-worker\/(?:sql|src\/middleware)\/|(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|CODEOWNERS|package[^/]*\.json|wrangler[^/]*\.toml|[^/]*(?:lockfile|\.lock(?:\.json)?|[-_.]lock\.(?:json|yaml|yml)))(?:$|\/)/i;
const OLD_PROTECTED = [
  /^\.github\//, /^cloudflare-worker\/sql\//, /^scripts\/ci\//, /^merge-control\//, /(?:^|\/)package\.json$/,
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|[^/]*\.lock)$/,
  /(?:^|\/)wrangler[^/]*\.toml$/, /(?:^|\/)\.gitattributes$/, /^AGENTS\.md$/, /^CLAUDE\.md$/, /(?:^|\/)CODEOWNERS$/,
];

const SYNTHETIC = [
  '.github/workflows/ci.yml', 'docs/.github/x', 'frontend/scripts/build.mjs', 'scripts', 'Scripts/X.mjs', 'merge-control/src/index.ts',
  'attached_assets/a.pdf', 'cloudflare-worker/sql/migrations/1_x.sql', 'cloudflare-worker/src/middleware/auth.ts', 'AGENTS.md',
  'docs/AGENTS.md', 'AGENTS.md/notes.md', 'agents.md', 'CLAUDE.md', '.github/CODEOWNERS', 'CODEOWNERS', 'package.json',
  'frontend/package-lock.json', 'package.extra.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'Gemfile.lock', 'deno.lock.json', 'x/poetry_lock.yaml', 'x/a-lock.yml', 'x/a.lock.yml', 'Cargo.lockfile', 'wrangler.toml',
  'wrangler.merge-control.toml', 'meeting-bot/wrangler.toml', '.gitattributes', 'docs/.gitattributes',
];
const tracked = () => execFileSync('git', ['ls-files'], { cwd: new URL('.', root), encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter(Boolean);

test('the new list covers every path the old SENSITIVE or the old PROTECTED covered, tracked or synthetic', () => {
  const paths = [...new Set([...tracked(), ...SYNTHETIC])];
  const lost = paths.filter((p) => (OLD_SENSITIVE.test(p) || OLD_PROTECTED.some((re) => re.test(p))) && !isPrivileged(p));
  assert.deepEqual(lost, []);
  // Measured on 2026-11-21: of the tracked files, the list adds only `.gitattributes` to T2's path half (D6679's
  // measure stays honest). A new privileged file elsewhere is fine; this pins the list's reach over today's tree.
  const added = tracked().filter((p) => isPrivileged(p) && !OLD_SENSITIVE.test(p));
  assert.ok(added.every((p) => /(?:^|\/)\.gitattributes$/.test(p)), `newly privileged: ${added.join(', ')}`);
});

test('ordinary product paths stay outside the list', () => {
  for (const p of ['frontend/src/pages/a.jsx', 'cloudflare-worker/src/routes/deals.ts', 'documentation/x.md', 'frontend/test/a.test.mjs',
    'cloudflare-worker/src/services/lockout.ts', 'docs/github.md', 'frontend/src/lib/packages.js']) {
    assert.equal(isPrivileged(p), false, p);
  }
});

test('globRegExp: ** crosses folders, * stays in one name, and a name covers a folder of that name', () => {
  assert.ok(globRegExp('**/AGENTS.md').test('a/b/AGENTS.md'));
  assert.ok(globRegExp('**/AGENTS.md').test('AGENTS.md/x'));
  assert.ok(!globRegExp('**/AGENTS.md').test('XAGENTS.md'));
  assert.ok(globRegExp('cloudflare-worker/sql/**').test('cloudflare-worker/sql/a/b.sql'));
  assert.ok(!globRegExp('cloudflare-worker/sql/**').test('x/cloudflare-worker/sql/a.sql'), 'an anchored glob stays at the root');
  assert.ok(!globRegExp('cloudflare-worker/sql/**').test('cloudflare-worker/sql'), 'the folder itself is not a file in it');
  assert.ok(globRegExp('**/package*.json').test('package-lock.json'));
  assert.ok(!globRegExp('**/package*.json').test('a/package/x.json'), '* never crosses a folder');
  assert.ok(!globRegExp('**/*.lock').test('a.lockfilex'));
  assert.equal(isPrivileged(''), true, 'an unreadable path is privileged');
  assert.equal(isPrivileged(null), true);
});

test('T2, the landing bot and merge-policy.mjs read the one list', () => {
  assert.equal(PROTECTED, PRIVILEGED);
  assert.equal(viaPolicy.PRIVILEGED, PRIVILEGED);
  assert.equal(viaPolicy.PRIVILEGED_PATHS, PRIVILEGED_PATHS);
  assert.ok(PRIVILEGED_PATHS.every(({ glob, why }) => typeof glob === 'string' && glob && typeof why === 'string' && why.length > 8));
  assert.equal(new Set(PRIVILEGED_PATHS.map(({ glob }) => glob)).size, PRIVILEGED_PATHS.length, 'no glob twice');
  // Mutation checked: dropping an entry loses its paths in the first test; T2 is the list's verdict.
  assert.equal(classify([{ path: '.gitattributes', status: 'M' }]).tier, 'T2');
  assert.match(classify([{ path: 'frontend/scripts/x.mjs', status: 'A' }]).reasons.join('\n'), /protected path/);
  assert.equal(classify([{ path: 'frontend/src/pages/a.jsx', status: 'M' }]).tier, 'T1');
  assert.equal(pathGuard([{ path: 'docs/.gitattributes' }]).refused[0].reason, 'protected path');
  assert.equal(pathGuard([{ path: 'frontend/src/pages/a.jsx' }]).ok, true);
  // The rules file keeps no second copy.
  assert.doesNotMatch(at('scripts/landing-bot/rules.mjs'), /PROTECTED = Object\.freeze\(\[/);
  assert.doesNotMatch(at('merge-control/src/lib/classify.mjs'), /^\s*import\b/m, 'the classifier stays import-free for its Worker');
});

test('privilegedFiles names changed privileged paths, a rename\'s old path included, sorted', () => {
  assert.deepEqual(privilegedFiles([
    { path: 'frontend/src/a.jsx' }, { path: 'scripts/x.mjs' }, { path: 'docs/n.md', previousPath: 'AGENTS.md' }, { path: 'scripts/x.mjs' },
  ]), ['AGENTS.md', 'scripts/x.mjs']);
  assert.deepEqual(privilegedFiles([{ path: 'frontend/src/a.jsx' }]), []);
  assert.deepEqual(privilegedFiles(null), []);
});

test('CODEOWNERS holds the generated block, last, and a drift fails the check', () => {
  const text = at('.github/CODEOWNERS');
  assert.equal(codeownersBlockIn(text), codeownersBlock());
  assert.ok(text.trimEnd().endsWith(CODEOWNERS_END), 'the block is last, so it wins over earlier lines');
  assert.ok(text.indexOf(CODEOWNERS_BEGIN) > text.indexOf('\n*'), 'and comes after the default owner');
  for (const { glob } of PRIVILEGED_PATHS) assert.ok(codeownersBlock().includes(glob), glob);
  const out = []; const err = [];
  const run = (t) => main(['--check'], { read: () => t, out: (s) => out.push(s), err: (s) => err.push(s) });
  assert.equal(run(text), 0);
  assert.equal(run(text.replace('**/scripts ', '**/scriptz ')), 1, 'an edited line');
  assert.equal(run(text.replace(CODEOWNERS_BEGIN, '# gone')), 1, 'a missing block');
  assert.equal(withCodeownersBlock(text), text, '--write leaves a current file as it is');
  assert.equal(codeownersBlockIn(withCodeownersBlock('* @o\n')), codeownersBlock(), '--write appends a missing block');
});

test('the ruleset condition lists every glob, and a name also as a folder', () => {
  const paths = rulesetPaths();
  for (const { glob } of PRIVILEGED_PATHS) assert.ok(paths.includes(glob), glob);
  assert.ok(paths.includes('**/AGENTS.md/**'));
  assert.ok(paths.includes('**/scripts/**'));
  assert.ok(!paths.includes('cloudflare-worker/sql/**/**'));
  const out = [];
  assert.equal(main(['--json'], { out: (s) => out.push(s) }), 0);
  assert.deepEqual(JSON.parse(out.join('\n')), paths);
  assert.equal(main(['--nope'], { err: () => {} }), 2);
});

test('pr:privileged is declared, and set by a job that runs no repository code', () => {
  assert.match(at('.github/labels.yml'), /- name: "pr:privileged"\n  color: "[0-9A-F]{6}"\n  description: "[^"]+"/);
  const wf = at('.github/workflows/landing-policy.yml');
  assert.match(wf, /^permissions:\n  contents: read\n/m, 'the workflow stays read-only by default');
  assert.doesNotMatch(wf, /pull_request_target|workflow_run/);
  const label = wf.slice(wf.indexOf('\n  label:\n'));
  assert.ok(label.length > 20, 'the label job exists');
  assert.match(label, /permissions:\n      pull-requests: write\n/);
  assert.doesNotMatch(label, /actions\/checkout|node |npm |contents: write/, 'no checkout and no repository code');
  assert.match(label, /head\.repo\.full_name == github\.repository/, 'a fork is skipped');
  assert.match(label, /--add-label 'pr:privileged'/);
  assert.match(label, /--remove-label 'pr:privileged'/);
  // Before labels-sync has created the label on main, the job warns and passes rather than failing the PR.
  assert.match(label, /gh api "repos\/\$GH_REPO\/labels\/pr%3Aprivileged" --silent[\s\S]*::warning::[\s\S]*exit 0\n[\s\S]*has=\$\(gh pr view/);
  const policy = wf.slice(0, wf.indexOf('\n  label:\n'));
  assert.match(policy, /privileged=true\n/, 'unreadable is privileged');
  assert.match(policy, /r\.privileged\.length === 0 \? 0 : 1/, 'false only on a classification that names none');
  assert.match(at('scripts/merge-policy.mjs'), /privileged: privilegedFiles\(files\)/);
});
