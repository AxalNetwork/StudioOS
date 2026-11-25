// D8068 (#8068): the identity chain's parser, held to AGENTS.md § "Identity trailers", and the
// check run end to end on fixture git repositories: a chained commit passes, a commit without
// trailers fails, and provenance.json is written either way.
//
//   node --test scripts/ci/agent-provenance.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CUTOVER, LEGACY_SESSION, MAX_COMMITS, TRAILERS, branchIssue, checkCommit, checkRange, classifyPr, gitResolvePr, main, parseTrailers, renderShadow, shadowMain, shadowRows, shown,
} from './agent-provenance.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** AGENTS.md's "### Identity trailers" section, up to the next heading of its level or above. */
function section() {
  const md = read('AGENTS.md');
  const from = md.indexOf('\n### Identity trailers\n');
  assert.ok(from >= 0, 'AGENTS.md has no "### Identity trailers" section');
  const rest = md.slice(from + 1);
  const next = rest.slice(1).search(/\n#{1,3} /);
  return { md, from, text: next === -1 ? rest : rest.slice(0, next + 2) };
}

/** The section's table: one row per trailer, in order. */
function documentedRows(text) {
  return [...text.matchAll(/^\| `([A-Za-z-]+)` \| (.+?) \| `([^`]+)` \|$/gm)].map(([, key, value, example]) => ({ key, value, example }));
}

const CHAIN = 'Agent-Slot: S08\nAgent-Task: #8068\nAgent-Run: manual\nAgent-Session: https://claude.ai/code/session_01Fixture';
const commit = (message, extra = {}) => ({ sha: 'a'.repeat(40), parents: ['b'.repeat(40)], committedAt: '2026-11-21T12:00:00Z', message, ...extra });

test('AGENTS.md documents exactly the trailers the parser requires, in order, and each example passes', () => {
  const { text } = section();
  const rows = documentedRows(text);
  assert.deepEqual(rows.map((r) => r.key), Object.keys(TRAILERS), 'the table and TRAILERS name the same keys in the same order');
  for (const { key, example } of rows) assert.equal(TRAILERS[key](example), true, `${key}: the documented example ${example} is refused`);
  // The fenced example is a whole trailer block the check accepts as written.
  const fence = /```text\n([\s\S]*?)\n```/.exec(text)?.[1];
  assert.ok(fence, 'the section carries a fenced example block');
  const row = checkCommit(commit(`docs: an example\n\n${fence}\n`));
  assert.deepEqual(row.problems, [], `the documented block is refused: ${row.problems.join('; ')}`);
  assert.equal(row.slot, rows[0].example);
});

test('AGENTS.md states the cutover, the legacy trailer and the local command the script really takes', () => {
  const { text } = section();
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(flat.includes(`dated before \`${CUTOVER}\` may give \`${LEGACY_SESSION}\` in place of \`Agent-Session\``), 'the cutover sentence names the script\'s CUTOVER and LEGACY_SESSION');
  assert.match(flat, /`node scripts\/ci\/agent-provenance\.mjs --base origin\/main --head HEAD`/);
  assert.match(flat, /exactly once/);
  assert.match(flat, /`agent-provenance\.yml`/);
});

test('the boundaries the table states are the ones the parser draws', () => {
  const { text } = section();
  const rows = Object.fromEntries(documentedRows(text).map((r) => [r.key, r.value]));
  assert.match(rows['Agent-Slot'], /`S01` to `S99`/);
  const slot = TRAILERS['Agent-Slot'];
  for (const ok of ['S01', 'S08', 'S37', 'S99']) assert.equal(slot(ok), true, ok);
  for (const bad of ['S00', 'S1', 'S100', 's08', 'S08 ', 'SS08', '08']) assert.equal(slot(bad), false, bad);
  assert.match(rows['Agent-Task'], /`#` and the issue number/);
  const task = TRAILERS['Agent-Task'];
  for (const ok of ['#1', '#8068']) assert.equal(task(ok), true, ok);
  for (const bad of ['8068', '#0', '#08068', '#x', '# 8068', 'AxalNetwork/StudioOS#8068']) assert.equal(task(bad), false, bad);
  assert.match(rows['Agent-Run'], /the CI run id, or `manual`/);
  const run = TRAILERS['Agent-Run'];
  for (const ok of ['manual', '1', '19674512345']) assert.equal(run(ok), true, ok);
  for (const bad of ['Manual', 'MANUAL', '0', '-1', 'run-1', '1.5', '']) assert.equal(run(bad), false, bad);
  assert.match(rows['Agent-Session'], /`https:\/\/` URL/);
  const session = TRAILERS['Agent-Session'];
  for (const ok of ['https://claude.ai/code/session_01Ke8rdS1xCWZESNZHhhUiDX', 'https://example.org']) assert.equal(session(ok), true, ok);
  for (const bad of ['http://claude.ai/code/session_x', 'https://user:pw@claude.ai/x', 'https://localhost/x', 'claude.ai/code/x',
    'https://claude.ai/a b', 'https://claude.ai/x?token=1', `https://claude.ai/${'x'.repeat(200)}`]) assert.equal(session(bad), false, bad);
});

test('the trailer block is the last paragraph, never the subject, and only when every line is a trailer', () => {
  assert.deepEqual([...parseTrailers(`fix: a\n\nbody\n\n${CHAIN}\n`).keys()], Object.keys(TRAILERS));
  assert.equal(parseTrailers(CHAIN).size, 0, 'a one-paragraph message is a subject, not a trailer block');
  assert.equal(parseTrailers(`fix: a\n\n${CHAIN}\nand some prose\n`).size, 0, 'a prose line spoils the block');
  assert.equal(parseTrailers(`fix: a\n\n${CHAIN}\n\nlater prose\n`).size, 0, 'trailers above the last paragraph do not count');
  assert.equal(parseTrailers(`fix: a\r\n\r\n${CHAIN.replace(/\n/g, '\r\n')}\r\n`).size, 4, 'CRLF messages read the same');
  assert.deepEqual(parseTrailers('fix: a\n\nAgent-Slot: S08\nAgent-Slot: S09').get('Agent-Slot'), ['S08', 'S09']);
});

test('a commit passes with the full chain, and each missing, repeated or malformed trailer fails it', () => {
  const good = checkCommit(commit(`fix: a\n\n${CHAIN}\nCo-Authored-By: Example <a@example.invalid>`));
  assert.deepEqual(good.problems, []);
  assert.deepEqual([good.slot, good.task, good.run, good.sessionTrailer], ['S08', '#8068', 'manual', 'Agent-Session']);
  assert.deepEqual(checkCommit(commit('fix: no trailers at all')).problems, Object.keys(TRAILERS).map((k) => `missing ${k}`));
  for (const key of Object.keys(TRAILERS)) {
    const without = CHAIN.split('\n').filter((l) => !l.startsWith(`${key}:`)).join('\n');
    assert.deepEqual(checkCommit(commit(`fix: a\n\n${without}`)).problems, [`missing ${key}`], key);
    const twice = `${CHAIN}\n${CHAIN.split('\n').find((l) => l.startsWith(`${key}:`))}`;
    assert.deepEqual(checkCommit(commit(`fix: a\n\n${twice}`)).problems, [`${key} given 2 times`], key);
  }
  assert.deepEqual(checkCommit(commit(`fix: a\n\n${CHAIN.replace('S08', 'S8')}`)).problems, ['Agent-Slot "S8" is malformed']);
  assert.deepEqual(checkCommit(commit(`fix: a\n\n${CHAIN.replace('Agent-Slot', 'agent-slot')}`)).problems,
    ['missing Agent-Slot'], 'keys are spelt as shown');
});

test(`${LEGACY_SESSION} stands in for Agent-Session only before the cutover`, () => {
  const legacy = CHAIN.replace('Agent-Session', LEGACY_SESSION);
  const before = checkCommit(commit(`fix: a\n\n${legacy}`, { committedAt: '2026-11-30T23:59:59Z' }));
  assert.deepEqual(before.problems, []);
  assert.equal(before.sessionTrailer, LEGACY_SESSION);
  assert.deepEqual(checkCommit(commit(`fix: a\n\n${legacy}`, { committedAt: CUTOVER })).problems,
    [`${LEGACY_SESSION} is accepted as Agent-Session only before ${CUTOVER}`]);
  assert.deepEqual(checkCommit(commit(`fix: a\n\n${legacy}`, { committedAt: 'not a date' })).problems.length, 1, 'an unreadable date is not before anything');
  // Both given: Agent-Session is the one read.
  const both = checkCommit(commit(`fix: a\n\n${CHAIN}\n${LEGACY_SESSION}: https://claude.ai/code/other`, { committedAt: CUTOVER }));
  assert.deepEqual(both.problems, []);
  assert.equal(both.session, 'https://claude.ai/code/session_01Fixture');
});

test('only a merge that adds nothing of its own is exempt', () => {
  const parents = ['b'.repeat(40), 'c'.repeat(40)];
  assert.equal(checkCommit(commit('Merge main', { parents, cleanMerge: true })).exempt, true);
  assert.deepEqual(checkCommit(commit('Merge main', { parents, cleanMerge: false })).problems.length, 4);
  assert.equal(checkCommit(commit('fix: a', { cleanMerge: true })).exempt, false, 'a single-parent commit is never a merge');
});

test('a range names one slot and one task, the branch\'s issue, and skips branches outside agent/**', () => {
  const ok = commit(`fix: a\n\n${CHAIN}`);
  assert.equal(checkRange({ commits: [ok], branch: 'agent/claude/8068-identity-chain' }).verdict, 'pass');
  assert.equal(checkRange({ commits: [ok] }).verdict, 'pass', 'with no branch the range is always checked');
  const skipped = checkRange({ commits: [commit('fix: none')], branch: 'claude/beautiful-pasteur-3mghp7-8068' });
  assert.equal(skipped.verdict, 'skipped');
  assert.deepEqual(skipped.commits, []);
  assert.equal(checkRange({ commits: [ok], branch: 'agent/' }).verdict, 'skipped', 'agent/ alone names no branch');
  const wrongTask = checkRange({ commits: [ok], branch: 'agent/claude/8061-apps' });
  assert.equal(wrongTask.verdict, 'fail');
  assert.deepEqual(wrongTask.problems, ['the branch names #8061 but the commits name #8068']);
  const other = commit(`fix: b\n\n${CHAIN.replace('S08', 'S21').replace('#8068', '#6476')}`, { sha: 'd'.repeat(40) });
  assert.deepEqual(checkRange({ commits: [ok, other] }).problems, ['the range names 2 slots: S08, S21', 'the range names 2 tasks: #8068, #6476']);
  assert.deepEqual(checkRange({ commits: [] }).problems, ['the range adds no commits']);
  assert.equal(checkRange({ commits: Array.from({ length: MAX_COMMITS + 1 }, () => ok) }).verdict, 'fail');
  assert.equal(checkRange({ commits: Array.from({ length: MAX_COMMITS }, () => ok) }).verdict, 'pass');
  const merges = checkRange({ commits: [commit('Merge', { parents: ['b'.repeat(40), 'c'.repeat(40)], cleanMerge: true })] });
  assert.equal(merges.verdict, 'fail', 'a range of clean merges alone carries no chain');
  assert.equal(branchIssue('agent/codex/6476-x'), '6476');
  assert.equal(branchIssue('agent/codex/x-6476'), null);
});

test('a value from a commit message is printed as inert text', () => {
  assert.equal(shown('::error::x\n'), '"::error::x?"');
  assert.equal(shown('x'.repeat(100)).length, 82);
  const row = checkCommit(commit('fix: a\n\nAgent-Slot: ::set-env name=X::1\nAgent-Task: #1\nAgent-Run: manual\nAgent-Session: https://e.org'));
  assert.deepEqual(row.problems, ['Agent-Slot "::set-env name=X::1" is malformed']);
});

/** A fixture repository: `main` with one commit, and helpers to commit with a fixed clock. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-provenance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-11-21T12:00:00Z', GIT_COMMITTER_DATE: '2026-11-21T12:00:00Z',
    GIT_CONFIG_NOSYSTEM: '1', HOME: dir };
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...a], { cwd: dir, env, encoding: 'utf8' }).trim();
  let n = 0;
  const put = (message) => {
    writeFileSync(join(dir, `f${n++}.txt`), `${n}\n`);
    git('add', '.');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet');
  put('main: first');
  git('checkout', '--quiet', '-b', 'agent/claude/8068-identity-chain');
  return { dir, git, put };
}

const run = (dir, argv) => {
  const lines = [];
  const status = main(argv, { cwd: dir, log: (l) => lines.push(l) });
  return { status, lines };
};

test('end to end: a chained branch passes and provenance.json names its slot, task, run, session and commits', (t) => {
  const { dir, put } = fixture(t);
  const sha = put(`feat: one\n\n${CHAIN}\nCo-Authored-By: Example <a@example.invalid>`);
  const out = join(dir, 'provenance.json');
  const { status, lines } = run(dir, ['--base', 'main', '--head', 'HEAD', '--branch', 'agent/claude/8068-identity-chain', '--out', out]);
  assert.equal(status, 0, lines.join('\n'));
  assert.equal(lines.at(-1), `agent-provenance: verdict=pass head=${sha} commits=1 source=local`);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual({ verdict: doc.verdict, slot: doc.slot, task: doc.task, runs: doc.runs, sessions: doc.sessions, shas: doc.commits.map((c) => c.sha) },
    { verdict: 'pass', slot: 'S08', task: '#8068', runs: ['manual'], sessions: ['https://claude.ai/code/session_01Fixture'], shas: [sha] });
});

test('end to end: a fixture commit without trailers fails the check, by sha, and the artifact still records it', (t) => {
  const { dir, put } = fixture(t);
  put(`feat: one\n\n${CHAIN}`);
  const bare = put('feat: two, with no trailers');
  const out = join(dir, 'provenance.json');
  const { status, lines } = run(dir, ['--base', 'main', '--head', 'HEAD', '--branch', 'agent/claude/8068-identity-chain', '--out', out, '--source', 'base']);
  assert.equal(status, 1);
  assert.ok(lines.includes(`agent-provenance: ${bare.slice(0, 12)} FAIL missing Agent-Slot; missing Agent-Task; missing Agent-Run; missing Agent-Session`), lines.join('\n'));
  assert.equal(lines.at(-1), `agent-provenance: verdict=fail head=${bare} commits=2 source=base`);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(doc.verdict, 'fail');
  assert.deepEqual(doc.commits.map((c) => [c.sha, c.problems.length]), [[doc.commits[0].sha, 0], [bare, 4]]);
});

test('end to end: a clean merge from main is exempt, a merge with its own content is not', (t) => {
  const { dir, git, put } = fixture(t);
  put(`feat: one\n\n${CHAIN}`);
  git('checkout', '--quiet', 'main');
  put('main: second');
  git('checkout', '--quiet', 'agent/claude/8068-identity-chain');
  git('merge', '--quiet', '--no-edit', 'main');
  let r = run(dir, ['--base', 'main', '--head', 'HEAD']);
  assert.equal(r.status, 0, r.lines.join('\n'));
  assert.match(r.lines.join('\n'), /clean merge, exempt/);
  writeFileSync(join(dir, 'evil.txt'), 'added in the merge\n');
  git('add', 'evil.txt');
  git('commit', '--quiet', '--amend', '--no-edit');
  r = run(dir, ['--base', 'main', '--head', 'HEAD']);
  assert.equal(r.status, 1, 'a merge that adds a file must carry the chain');
});

test('end to end: a branch outside agent/** is skipped without reading git, and still writes the artifact', (t) => {
  const { dir, put } = fixture(t);
  put('feat: no trailers');
  const out = join(dir, 'provenance.json');
  const r = run(dir, ['--base', 'main', '--head', 'HEAD', '--branch', 'claude/beautiful-pasteur-3mghp7-8068', '--out', out]);
  assert.equal(r.status, 0);
  assert.match(r.lines.at(-1), /^agent-provenance: verdict=skipped /);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).verdict, 'skipped');
});

test('usage and git errors exit 2 and write no artifact', (t) => {
  const { dir } = fixture(t);
  assert.equal(run(dir, ['--base', 'main']).status, 2);
  assert.equal(run(dir, ['--base', '--upload-pack=x', '--head', 'HEAD']).status, 2, 'an option-looking revision is refused');
  assert.equal(run(dir, ['--base', 'main', '--head', 'HEAD', '--source', 'elsewhere']).status, 2);
  assert.equal(run(dir, ['--base', 'main', '--head', 'nope']).status, 2);
  assert.equal(existsSync(join(dir, 'provenance.json')), false);
});

test('the workflow is advisory, runs on pull_request and merge_group, judges agent/** with the base copy, and keeps the artifact', () => {
  const wf = read('.github/workflows/agent-provenance.yml');
  assert.match(wf, /^on:\n {2}pull_request:\n[\s\S]*^ {2}merge_group:\n/m);
  assert.match(wf, /^ {4}name: provenance$/m);
  assert.match(wf, /^ {4}continue-on-error: true$/m, 'advisory until the owner makes it required (D8068)');
  assert.match(wf, /^permissions:\n {2}contents: read\n {2}pull-requests: read\n/m);
  assert.match(wf, /git show "\$BASE_SHA:scripts\/ci\/agent-provenance\.mjs"/, 'the check that judges a branch comes from its base');
  assert.match(wf, /node "\$RUNNER_TEMP\/agent-provenance\.mjs" --base "\$RANGE_BASE" --head "\$RANGE_HEAD" --branch "\$BRANCH" --out "\$RUNNER_TEMP\/provenance\.json" --source "\$SOURCE"/);
  assert.match(wf, /name: provenance\n {10}path: \$\{\{ runner\.temp \}\}\/provenance\.json/);
  // The branch name is outsider text: it reaches the script through env only, never inside run:.
  assert.match(wf, /^ {10}PR_HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}$/m);
  assert.equal((wf.match(/github\.(?:head_ref|event\.pull_request\.head\.ref)/g) || []).length, 1);
});

// ---- D8517 (#8517): the shadow report ------------------------------------------------------

/**
 * A fixture release range: `main` carries the previous deploy, then three squash commits that name
 * pull requests 11 (full chain), 12 (a partial chain) and 13 (no trailers: a human). Each pull
 * request's head lives on a local branch pr-N, and the stubbed fetch points FETCH_HEAD at it, so no
 * network and no GitHub API is touched.
 */
function releaseFixture(t, { legacyOn11 = false } = {}) {
  const { dir, git, put } = fixture(t);
  git('checkout', '--quiet', 'main');
  const previous = git('rev-parse', 'HEAD');
  const heads = {
    11: `feat: eleven\n\n${legacyOn11 ? CHAIN.replace('Agent-Session', LEGACY_SESSION) : CHAIN}`,
    12: 'feat: twelve\n\nAgent-Slot: S09\nAgent-Task: #8012',
    13: 'fix: thirteen, by a person',
  };
  for (const n of [11, 12, 13]) {
    git('checkout', '--quiet', '-b', `pr-${n}`, 'main');
    put(heads[n]);
    git('checkout', '--quiet', 'main');
    put(`squash of ${n} (#${n})`); // GitHub's squash carries no trailers of its own
  }
  const candidate = git('rev-parse', 'HEAD');
  const resolvePr = (n, sha) => {
    const fetchRef = (num) => git('fetch', '--quiet', '.', `pr-${num}`);
    return gitResolvePr({ cwd: dir, fetchRef })(n, sha);
  };
  return { dir, previous, candidate, resolvePr };
}

const shadow = (f, extra = []) => {
  const lines = [];
  const status = shadowMain(['--shadow', '--candidate', f.candidate, '--previous', f.previous, ...extra],
    { cwd: f.dir, log: (l) => lines.push(l), resolvePr: f.resolvePr, summaryFile: '' });
  return { status, text: lines.join('\n') };
};

test('shadow: a range with one passing, one failing and one human pull request prints three rows', (t) => {
  const f = releaseFixture(t);
  const { status, text } = shadow(f);
  assert.equal(status, 0);
  const rows = text.split('\n').filter((l) => /^\| #\d+ /.test(l));
  assert.equal(rows.length, 3, text);
  assert.match(rows[0], /^\| #11 \| S08 \| #8068 \| pass \| Agent-Session \| - \|$/);
  assert.match(rows[1], /^\| #12 \| S09 \| #8012 \| fail \| none \| .*missing Agent-Run/);
  assert.match(rows[2], /^\| #13 \| - \| - \| human \| - \| - \|$/);
  assert.match(text, /pass 1, fail 1, human 1, unavailable 0\./);
  assert.match(text, /this report never fails the release/);
});

test('shadow: the row says which session trailer form each commit used', (t) => {
  const { text } = shadow(releaseFixture(t, { legacyOn11: true }));
  assert.match(text, /^\| #11 \| S08 \| #8068 \| pass \| Claude-Session \| - \|$/m);
  // After the cutover the legacy form is a failure, and the row says so.
  const late = classifyPr({ number: 5, commits: [commit(`fix: a\n\n${CHAIN.replace('Agent-Session', LEGACY_SESSION)}`, { committedAt: CUTOVER })] });
  assert.equal(late.status, 'fail');
  assert.match(late.problems.join(';'), /accepted as Agent-Session only before/);
  const mixed = classifyPr({ number: 6, commits: [commit(`a\n\n${CHAIN}`), commit(`b\n\n${CHAIN.replace('Agent-Session', LEGACY_SESSION)}`, { sha: 'c'.repeat(40) })] });
  assert.deepEqual(mixed.forms, ['Agent-Session', 'Claude-Session']);
});

test('shadow: an unreadable pull request, a direct push and an unreadable range are printed as such, never thrown', (t) => {
  const rows = shadowRows({
    changes: [{ sha: 'a'.repeat(40), subject: 'feat: x (#7)' }, { sha: 'b'.repeat(40), subject: 'direct push, no number' },
      { sha: 'c'.repeat(40), subject: 'Merge pull request #9 from o/agent/x' }],
    resolvePr: (n) => { if (n === 7) throw new Error('fetch failed\nsecond line'); return []; },
  });
  assert.deepEqual(rows.map((r) => [r.pr, r.status]), [[7, 'unavailable'], [null, 'no-pr'], [9, 'unavailable']]);
  assert.match(rows[0].problems[0], /not readable \("fetch failed"\)/);
  const md = renderShadow({ candidate: 'a'.repeat(40), previous: '', rows });
  assert.match(md, /previous production deploy not found/);
  assert.match(md, /unavailable 3\./);
  const { dir } = fixture(t);
  const lines = [];
  assert.equal(shadowMain(['--shadow', '--candidate', 'nope'], { cwd: dir, log: (l) => lines.push(l) }), 0);
  assert.match(lines.join('\n'), /shadow report unavailable/);
  assert.equal(shadowMain(['--shadow', '--bogus', 'x'], { cwd: dir, log: () => {} }), 0);
});

test('shadow: a value from a commit message cannot break out of a summary table cell', () => {
  const row = classifyPr({ number: 1, commits: [commit('fix\n\nAgent-Slot: a|b`<x>\nAgent-Task: #1\nAgent-Run: manual\nAgent-Session: https://e.org')] });
  const md = renderShadow({ candidate: 'a'.repeat(40), previous: 'b'.repeat(40), rows: [{ sha: 'a', ...row }] });
  const line = md.split('\n').find((l) => l.startsWith('| #1 '));
  assert.equal(line.split('|').length, 8, line);
  assert.doesNotMatch(line, /[`<>]/);
});

test('shadow: the summary file receives the report, and the CLI exits 0 even when the range is unreadable', (t) => {
  const f = releaseFixture(t);
  const out = join(f.dir, 'summary.md');
  shadow(f, ['--summary', out]);
  assert.match(readFileSync(out, 'utf8'), /### Agent provenance \(shadow mode\)/);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./agent-provenance.mjs', import.meta.url)), '--shadow', '--candidate', 'deadbeef'],
    { cwd: f.dir, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /shadow report unavailable/);
});
