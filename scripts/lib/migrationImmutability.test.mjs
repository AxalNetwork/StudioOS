/**
 * An applied migration is never edited, deleted or renamed
 * (migrationImmutability.mjs, and the CLI beside it: ../migration-immutability-gate.mjs).
 *
 * The guard exists because eight migrations production had already applied
 * were edited after the fact, and the runner only warned (D269). Every test
 * here is a way the gate could pass while that happens again, or fail on a
 * change that is allowed:
 *
 *   · an edit, a deletion, a rename or a type change reported as allowed
 *   · a rename that leaves the folder, or enters it, missed because only one
 *     end was checked
 *   · a README beside the migrations, or a file in a subfolder the runner
 *     never reads, refused as if it were a migration
 *   · `migrations_old/` matched because the prefix lost its trailing slash
 *   · a status letter the rule does not know passed rather than refused
 *   · a quoted path (git's default for a non-ASCII byte) read as outside the
 *     folder — which is why the CLI asks for -z, and why -z has its own parser
 *   · a base that does not resolve, or a base name that is an option, read
 *     as "nothing changed"
 *   · a push to main with no usable before-commit quietly judged as a pull
 *     request, where `origin/main...HEAD` is empty and so always passes — six
 *     of the eight drifts arrived by direct push, so this is the case that
 *     matters most
 *
 * The last block runs the real CLI against a real repository with a bare
 * origin, because every one of those failures is in the git plumbing as much
 * as in the rule.
 *
 * Run with:
 *   node --test scripts/lib/migrationImmutability.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DIFF_FILTER,
  MIGRATIONS_DIR,
  findViolations,
  formatViolations,
  isMigrationPath,
  parseNameStatus,
  parseNameStatusZ,
  resolveBase,
} from './migrationImmutability.mjs';

const M = MIGRATIONS_DIR;
const judge = (text) => findViolations(parseNameStatus(text));

// ── the rule ─────────────────────────────────────────────────────────────

test('an edited, deleted, renamed or retyped migration is refused, each with its own reason', () => {
  const cases = [
    ['M', `M\t${M}039_project_cascade.sql`, /edited/],
    ['D', `D\t${M}039_project_cascade.sql`, /deleted/],
    ['R', `R100\t${M}039_project_cascade.sql\t${M}039_project_cascade_v2.sql`, /renamed.*run again as new/],
    ['T', `T\t${M}039_project_cascade.sql`, /changed type/],
  ];
  for (const [letter, line, reason] of cases) {
    const v = judge(line);
    assert.equal(v.length, 1, `${letter} must be a violation`);
    assert.match(v[0].rule, reason, `${letter} must carry its own sentence`);
  }
});

test('an added or copied migration is allowed: every existing file stays byte-identical', () => {
  assert.deepEqual(judge(`A\t${M}293_new_thing.sql`), []);
  assert.deepEqual(judge(`C075\t${M}039_project_cascade.sql\t${M}294_copy.sql`), []);
});

test('a rename counts when EITHER end is a migration', () => {
  const out = judge(`R100\t${M}039_project_cascade.sql\tcloudflare-worker/sql/historical/039_project_cascade.sql`);
  assert.equal(out.length, 1, 'moving a migration out of the folder removes it from every fresh build');
  const into = judge(`R095\tcloudflare-worker/sql/scratch.sql\t${M}039_project_cascade.sql`);
  assert.equal(into.length, 1, 'moving a file in over an applied name is a rename of that migration');
  assert.match(into[0].path, /scratch\.sql -> .*039_project_cascade\.sql/);
});

test('only the files the runner reads are covered: a README or a subfolder is not a migration', () => {
  assert.deepEqual(judge(`M\t${M}README.md`), [], 'the folder README is prose, not a migration');
  assert.deepEqual(judge(`M\t${M}archive/001_old.sql`), [], 'listMigrationFiles never reads a subfolder');
  assert.deepEqual(judge(`M\t${M}.sql`), [], 'a file named only ".sql" has no name');
  assert.equal(judge(`M\t${M}001_baseline.sql`).length, 1);
});

test('the prefix keeps its trailing slash: migrations_old/ is not the migrations folder', () => {
  assert.ok(MIGRATIONS_DIR.endsWith('/'), 'without the slash, migrations_old/ would match');
  assert.equal(isMigrationPath('cloudflare-worker/sql/migrations_old/001_x.sql'), false);
  assert.deepEqual(judge('M\tcloudflare-worker/sql/migrations_old/001_x.sql'), []);
  assert.equal(isMigrationPath(`${M}001_x.sql`), true);
});

test('a change outside the folder is ignored, and an empty diff passes', () => {
  assert.deepEqual(judge('M\tcloudflare-worker/src/index.ts\nD\tfrontend/src/App.jsx'), []);
  assert.deepEqual(judge(''), []);
  assert.deepEqual(judge('\n\n'), []);
});

test('a status letter the rule does not know is refused, never passed', () => {
  const v = judge(`X\t${M}039_project_cascade.sql`);
  assert.equal(v.length, 1);
  assert.match(v[0].rule, /does not recognise.*refuses/);
  assert.equal(judge(`U\t${M}039_project_cascade.sql`).length, 1, 'an unmerged path is not an allowed change');
});

test('the filter asks git for every change that alters an existing file, and for no addition', () => {
  for (const letter of ['M', 'D', 'R', 'T']) {
    assert.ok(DIFF_FILTER.includes(letter), `--diff-filter must ask for ${letter}`);
  }
  assert.ok(!DIFF_FILTER.includes('A'), 'an addition is the one permitted change and is not asked for');
});

// ── the -z form the CLI actually reads ───────────────────────────────────

test('the -z parser reads paths verbatim, including a name git would otherwise quote', () => {
  const odd = `${M}039_café.sql`;
  const stream = `M\0${odd}\0R100\0${M}001_a.sql\0${M}001_b.sql\0A\0${M}293_new.sql\0`;
  const entries = parseNameStatusZ(stream);
  assert.deepEqual(entries.map((e) => e.status), ['M', 'R100', 'A']);
  assert.deepEqual(entries[0].paths, [odd], 'a non-ASCII name arrives unquoted');
  assert.deepEqual(entries[1].paths, [`${M}001_a.sql`, `${M}001_b.sql`]);
  const v = findViolations(entries);
  assert.equal(v.length, 2, 'the edit and the rename, not the addition');
  assert.match(v[0].path, /café\.sql$/);
});

test('a quoted path, which is what git prints without -z, would not be seen as a migration', () => {
  // This is the reason the CLI passes -z: the leading quote defeats the prefix.
  assert.equal(isMigrationPath(`"${M}039_caf\\303\\251.sql"`), false);
});

test('the -z parser refuses a stream that ends mid-record rather than judging a partial list', () => {
  assert.throws(() => parseNameStatusZ(`R100\0${M}001_a.sql\0`), /ended mid-record/);
  assert.throws(() => parseNameStatusZ('M\0'), /ended mid-record/);
  assert.deepEqual(parseNameStatusZ(''), []);
});

// ── the base ─────────────────────────────────────────────────────────────

test('the base is the pull request base, and main when none is given', () => {
  const main = { ok: true, mode: 'branch', branch: 'main', remoteRef: 'origin/main' };
  assert.deepEqual(resolveBase({ GITHUB_BASE_REF: 'main' }), main);
  assert.deepEqual(resolveBase({}), main);
  assert.deepEqual(resolveBase({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }), main);
  assert.deepEqual(resolveBase({ GITHUB_BASE_REF: '  ' }).branch, 'main');
  assert.equal(resolveBase({ GITHUB_BASE_REF: 'release/2026-10' }).remoteRef, 'origin/release/2026-10');
});

const SHA_A = 'a'.repeat(40);

test('a push to main is judged against the commit main pointed at before it', () => {
  assert.deepEqual(
    resolveBase({ GITHUB_EVENT_NAME: 'push', MIGRATION_GATE_BEFORE: SHA_A }),
    { ok: true, mode: 'push', sha: SHA_A, remoteRef: SHA_A },
  );
  // Surrounding space and upper case are tolerated; the value handed to git is canonical.
  const loud = resolveBase({ GITHUB_EVENT_NAME: 'push', MIGRATION_GATE_BEFORE: ` ${'B'.repeat(40)} ` });
  assert.equal(loud.sha, 'b'.repeat(40));
  // The event decides the mode, not which variable happens to be set: a push
  // ignores GITHUB_BASE_REF, and a pull request ignores MIGRATION_GATE_BEFORE.
  assert.equal(resolveBase({ GITHUB_EVENT_NAME: 'push', MIGRATION_GATE_BEFORE: SHA_A, GITHUB_BASE_REF: 'main' }).mode, 'push');
  assert.equal(resolveBase({ GITHUB_EVENT_NAME: 'pull_request', MIGRATION_GATE_BEFORE: SHA_A }).mode, 'branch');
});

test('a push with no usable before-commit is refused, never downgraded to a pass over nothing', () => {
  // On main, origin/main...HEAD is empty, so falling back to branch mode would
  // pass every push. Each of these must refuse instead.
  const bad = [undefined, '', '0'.repeat(40), 'abc123', 'g'.repeat(40), `${SHA_A}0`, '--upload-pack=touch'];
  for (const before of bad) {
    const env = { GITHUB_EVENT_NAME: 'push', GITHUB_BASE_REF: 'main' };
    if (before !== undefined) env.MIGRATION_GATE_BEFORE = before;
    const r = resolveBase(env);
    assert.equal(r.ok, false, `${JSON.stringify(before)} must be refused`);
    assert.match(r.reason, /a push needs MIGRATION_GATE_BEFORE/);
  }
});

test('a base name that is an option, a range or has a space is refused, not handed to git', () => {
  for (const bad of ['--upload-pack=touch', '-x', 'main..evil', 'has space', 'semi;colon', 'a$b']) {
    const r = resolveBase({ GITHUB_BASE_REF: bad });
    assert.equal(r.ok, false, `${bad} must be refused`);
    assert.match(r.reason, /not a plain branch name/);
  }
});

test('the report names each file, its rule, and that there is no bypass', () => {
  const text = formatViolations(judge(`M\t${M}039_project_cascade.sql`), 'origin/main');
  assert.match(text, /1 applied migration changed against origin\/main/);
  assert.match(text, /039_project_cascade\.sql/);
  assert.match(text, /NEW file/);
  assert.match(text, /no bypass flag \(D269\)/);
  assert.doesNotMatch(text, /already on main/, 'a pull request has not landed yet');
});

test('on a push the report says the edit is already on main and has to be reverted', () => {
  const text = formatViolations(judge(`M\t${M}039_project_cascade.sql`), SHA_A, { onMain: true });
  assert.ok(text.includes(`changed against ${SHA_A}.`), text);
  assert.match(text, /already on main: revert the edit in a new commit/);
  assert.match(text, /no bypass flag \(D269\)/);
});

// ── the workflow that runs it ────────────────────────────────────────────
//
// Read as text, the way frontend/test/pr_preview.test.mjs reads its workflow:
// each property below is one a tidy-up could silently undo.

const WORKFLOW = readFileSync(resolve(process.cwd(), '.github/workflows/migration-immutability.yml'), 'utf8');
const CI = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
// The YAML without its comment lines, so the header that explains a rule can
// never be what satisfies (or trips) the assertion about that rule.
const WF_CODE = WORKFLOW.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('workflow: it runs on pull requests AND on pushes to main', () => {
  assert.match(WF_CODE, /\n  pull_request:\n    branches: \[main\]\n/, 'the PR half');
  assert.match(WF_CODE, /\n  push:\n    branches: \[main\]\n/, 'the push half — six of the eight drifts came by direct push');
});

test('workflow: a push run is never cancelled by the next push, a PR run may be', () => {
  const block = WF_CODE.slice(WF_CODE.indexOf('\nconcurrency:'), WF_CODE.indexOf('\njobs:'));
  assert.ok(block.length > 0, 'the workflow declares its concurrency');
  assert.doesNotMatch(block, /cancel-in-progress:\s*true\b/, 'an unconditional cancel skips a cancelled push range for good');
  assert.match(block, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(block, /github\.sha/, 'each push is its own group, so two pushes never share one');
});

test('workflow: full history, the gate script, and the before-commit only on a push', () => {
  assert.match(WF_CODE, /fetch-depth: 0/, 'a depth-1 clone has no merge base to diff from');
  assert.match(WF_CODE, /run: node scripts\/migration-immutability-gate\.mjs\n/);
  assert.match(WF_CODE, /MIGRATION_GATE_BEFORE: \$\{\{ github\.event_name == 'push' && github\.event\.before \|\| '' \}\}/);
  for (const line of WF_CODE.split('\n').filter((l) => /^\s*run:/.test(l))) {
    assert.doesNotMatch(line, /\$\{\{/, `no expression is substituted into shell text: ${line.trim()}`);
  }
});

test('workflow: its action pins are the ones ci.yml uses', () => {
  const uses = WF_CODE.match(/uses: \S+@\S+ # v\d+/g) || [];
  assert.equal(uses.length, 2, 'checkout and setup-node');
  for (const u of uses) assert.ok(CI.includes(u), `${u} must match ci.yml's pin`);
});

// ── the CLI, against a real repository ───────────────────────────────────

const CLI = resolve(process.cwd(), 'scripts/migration-immutability-gate.mjs');

// Isolated from whatever the machine's git config says: no global hooks, no
// signing, a fixed identity. The CLI inherits the same environment.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function repoWithBase() {
  const root = mkdtempSync(join(tmpdir(), 'mig-immut-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', work);
  mkdirSync(join(work, M), { recursive: true });
  writeFileSync(join(work, M, '001_first.sql'), 'CREATE TABLE a (id INTEGER);\n');
  writeFileSync(join(work, M, '002_second.sql'), 'CREATE TABLE b (id INTEGER);\n');
  writeFileSync(join(work, M, 'README.md'), 'Migrations.\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feature');
  return { root, work };
}

function commitAll(work, message) {
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', message);
}

// The event is set explicitly on every run. GIT_ENV inherits process.env, and
// on a push to main CI runs this very suite with GITHUB_EVENT_NAME=push: a
// helper that left it inherited would put every branch-mode test into push
// mode on exactly the run that matters most.
function runGate(work, base = 'main') {
  const env = { ...GIT_ENV, GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: base };
  delete env.MIGRATION_GATE_BEFORE;
  const r = spawnSync(process.execPath, [CLI], { cwd: work, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function runPushGate(work, before) {
  const env = { ...GIT_ENV, GITHUB_EVENT_NAME: 'push', MIGRATION_GATE_BEFORE: before, GITHUB_BASE_REF: '' };
  const r = spawnSync(process.execPath, [CLI], { cwd: work, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('CLI: an edit to a migration on the base fails, naming the file', () => {
  const { root, work } = repoWithBase();
  try {
    writeFileSync(join(work, M, '001_first.sql'), 'CREATE TABLE a (id INTEGER, note TEXT);\n');
    commitAll(work, 'edit an applied migration');
    const r = runGate(work);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /001_first\.sql/);
    assert.match(r.out, /edited/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a rename of a migration on the base fails as a rename', () => {
  const { root, work } = repoWithBase();
  try {
    renameSync(join(work, M, '002_second.sql'), join(work, M, '002_second_renamed.sql'));
    commitAll(work, 'rename an applied migration');
    const r = runGate(work);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /002_second\.sql -> .*002_second_renamed\.sql/);
    assert.match(r.out, /renamed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: an edit to a migration whose name git would quote still fails', () => {
  // Without -z, git prints this path quoted and escaped, the quote defeats the
  // folder prefix, and the edit reads as outside the rule. The parser test
  // above cannot see that: only the real diff does.
  const { root, work } = repoWithBase();
  try {
    git(work, 'checkout', '-q', 'main');
    writeFileSync(join(work, M, '003_café.sql'), 'CREATE TABLE c (id INTEGER);\n');
    commitAll(work, 'a migration with a non-ASCII name');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', 'feature');
    git(work, 'reset', '-q', '--hard', 'main');
    writeFileSync(join(work, M, '003_café.sql'), 'CREATE TABLE c (id INTEGER, note TEXT);\n');
    commitAll(work, 'edit it');
    const r = runGate(work);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /003_café\.sql/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a new migration, and an edit to the folder README, pass', () => {
  const { root, work } = repoWithBase();
  try {
    writeFileSync(join(work, M, '003_third.sql'), 'CREATE TABLE c (id INTEGER);\n');
    writeFileSync(join(work, M, 'README.md'), 'Migrations, and a note.\n');
    commitAll(work, 'add a migration');
    const r = runGate(work);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /none of the 2 migrations on origin\/main/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a base that does not exist fails with its own sentence, never as a pass', () => {
  const { root, work } = repoWithBase();
  try {
    const r = runGate(work, 'no-such-branch');
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /could not fetch the base branch 'no-such-branch'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a base name that is an option is refused before git sees it', () => {
  const { root, work } = repoWithBase();
  try {
    const r = runGate(work, '--upload-pack=touch');
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not a plain branch name/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a base holding no migration fails — a check over nothing is not a pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'mig-immut-'));
  try {
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    git(root, 'init', '--bare', '-q', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', work);
    writeFileSync(join(work, 'README.md'), 'No migrations here.\n');
    commitAll(work, 'base');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '-q', 'origin', 'main');
    const r = runGate(work);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /holds no migration .* would pass over nothing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a push that edits a migration already on main fails, and says it is on main', () => {
  // The shape of 1563f0aa8: six applied migrations edited in one commit pushed
  // straight to main. There is no pull request, so only push mode can see it.
  const { root, work } = repoWithBase();
  try {
    git(work, 'checkout', '-q', 'main');
    const before = git(work, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(work, M, '002_second.sql'), '-- a comment, the commonest drift\nCREATE TABLE b (id INTEGER);\n');
    commitAll(work, 'edit an applied migration on main');
    const r = runPushGate(work, before);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /002_second\.sql/);
    assert.match(r.out, /already on main: revert the edit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a push that only adds a migration passes against its own before-commit', () => {
  const { root, work } = repoWithBase();
  try {
    git(work, 'checkout', '-q', 'main');
    const before = git(work, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(work, M, '003_third.sql'), 'CREATE TABLE c (id INTEGER);\n');
    commitAll(work, 'add a migration on main');
    const r = runPushGate(work, before);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes(`none of the 2 migrations on ${before} was edited`), r.out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a push with no before-commit fails with its own sentence', () => {
  const { root, work } = repoWithBase();
  try {
    git(work, 'checkout', '-q', 'main');
    for (const before of ['', '0'.repeat(40)]) {
      const r = runPushGate(work, before);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /a push needs MIGRATION_GATE_BEFORE/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a before-commit that is neither here nor on origin fails, never passes', () => {
  // A force-push can leave main's previous tip unreachable; that is a failure.
  const { root, work } = repoWithBase();
  try {
    git(work, 'checkout', '-q', 'main');
    const r = runPushGate(work, 'c'.repeat(40));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /is not in this checkout and could not be fetched/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
