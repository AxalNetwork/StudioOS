/**
 * #6474: the branch keeper. Real git repositories for the merge; plain data for the plan; the workflow as text.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { attributesFrom, mergeMain } from '../../scripts/landing-bot/keeper-merge.mjs';
import { plan, pushesReserved, reservationName } from '../../scripts/landing-bot/keeper-plan.mjs';
import { assertWorkflow, parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = readFileSync(new URL('.github/workflows/landing-bot-keeper.yml', ROOT), 'utf8');
const ATTRS = '*.psd filter=lfs diff=lfs merge=lfs -text\nREADME.md merge=union\n';

/** A repo with main and a PR branch that diverged; returns { dir, git }. */
function fixture({ base = {}, main = {}, pr = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'keeper-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (files) => { for (const [p, t] of Object.entries(files)) { execFileSync('mkdir', ['-p', join(dir, p, '..')]); writeFileSync(join(dir, p), t); } };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write({ '.gitattributes': ATTRS, ...base }); git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'pr'); write(pr); git('add', '-A'); git('commit', '-qm', 'pr');
  git('checkout', '-q', 'main'); write(main); git('add', '-A'); git('commit', '-qm', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('checkout', '-q', '--detach', 'pr');
  return { dir, git };
}
const table = (...rows) => ['| File | What |', '| --- | --- |', ...rows, ''].join('\n');

test('#6474: a README-only conflict is merged with union and committed as one normal merge', () => {
  const { dir, git } = fixture({
    base: { 'docs-x/README.md': table('| `a.mjs` | A |'), 'src/a.js': 'a\n' },
    main: { 'docs-x/README.md': table('| `a.mjs` | A |', '| `b.mjs` | B, added on main |') },
    pr: { 'docs-x/README.md': table('| `a.mjs` | A |', '| `c.mjs` | C, added on the PR |'), 'src/c.js': 'c\n' },
  });
  const head = git('rev-parse', 'HEAD');
  const r = mergeMain(dir);
  assert.equal(r.outcome, 'merged', JSON.stringify(r));
  assert.deepEqual(r.unioned, ['docs-x/README.md']);
  assert.equal(git('rev-parse', 'HEAD^1'), head, 'a normal merge commit on top of the PR head');
  assert.equal(git('rev-parse', 'HEAD^2'), git('rev-parse', 'origin/main'));
  assert.match(readFileSync(join(dir, 'docs-x/README.md'), 'utf8'), /b\.mjs[\s\S]*c\.mjs|c\.mjs[\s\S]*b\.mjs/);
  assert.match(git('log', '-1', '--format=%B'), /Landing-Bot-Kind: keeper/);
});

test('#6474: a union merge that leaves a duplicate README row is refused, and nothing is left behind', () => {
  const { dir, git } = fixture({
    base: { 'x/README.md': table('| `a.mjs` | A |') },
    main: { 'x/README.md': table('| `a.mjs` | A, as main describes it now |') },
    pr: { 'x/README.md': table('| `a.mjs` | A, as the PR describes it now |') },
  });
  const head = git('rev-parse', 'HEAD');
  const r = mergeMain(dir);
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /duplicate in a README/);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), '');
});

test('#6474: a code conflict is reported, never committed', () => {
  const { dir, git } = fixture({ base: { 'src/a.js': 'one\n' }, main: { 'src/a.js': 'two\n' }, pr: { 'src/a.js': 'three\n' } });
  const head = git('rev-parse', 'HEAD');
  const r = mergeMain(dir);
  assert.deepEqual([r.outcome, r.files], ['conflict', ['src/a.js']]);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), '');
});

test('#6474: a PR that adds `*.ts merge=union` cannot make a code conflict merge', () => {
  const { dir, git } = fixture({
    base: { 'src/a.ts': 'one\n' }, main: { 'src/a.ts': 'two\n' },
    pr: { 'src/a.ts': 'three\n', '.gitattributes': `${ATTRS}*.ts merge=union\n` },
  });
  const head = git('rev-parse', 'HEAD');
  const r = mergeMain(dir);
  assert.notEqual(r.outcome, 'merged');
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.doesNotMatch(attributesFrom(`${ATTRS}*.ts merge=union\n`.replace('*.ts merge=union', '')), /\*\.ts/);
  assert.equal(attributesFrom(ATTRS), '* merge=text\n*.psd merge=lfs\nREADME.md merge=union\n', 'only main\'s merge rules, after a text default');
  // And the plan refuses such a PR before any merge: eligible() rejects a diff touching .gitattributes.
  const r2 = plan([pr({ files: [{ path: '.gitattributes' }, { path: 'src/a.ts' }] })], ctx());
  assert.match(r2.skipped[0].reasons.join(), /\.gitattributes/);
});

test('#6474: a PR already containing main is up to date', () => {
  const { dir, git } = fixture({ base: {}, main: { 'm.txt': 'm\n' }, pr: { 'n.txt': 'n\n' } });
  git('merge', '-q', '--no-edit', 'origin/main');
  assert.equal(mergeMain(dir).outcome, 'up_to_date');
});

// ── The plan ────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-11-16T12:00:00Z');
const BOT = 'axal-landing-bot[bot]';
function pr(over = {}) {
  return {
    number: 101, state: 'open', draft: false, body: 'Closes #9', labels: [], mergeable: 'CONFLICTING', inMergeQueue: false,
    headChangedAt: '2026-11-16T10:00:00Z', handedBackAt: null,
    head: { ref: 'agent/x/9-a', sha: 'b'.repeat(40), repo: { full_name: 'AxalNetwork/StudioOS' } },
    base: { repo: { full_name: 'AxalNetwork/StudioOS' } },
    files: [{ path: 'frontend/src/pages/A.jsx' }],
    commits: [{ sha: 'b'.repeat(40), author: { login: 'someone' }, committer: { login: 'someone' }, commit: { message: 'work', committer: { date: '2026-11-16T10:00:00Z' } } }],
    ...over,
  };
}
const ctx = (over = {}) => ({
  env: { LANDING_BOT_ENABLED: 'true', LANDING_BOT_KEEPER_PER_SWEEP: '3', LANDING_BOT_DAILY_PUSHES: '10' },
  event: 'schedule', repo: 'AxalNetwork/StudioOS', breakers: { open: false, reasons: [] }, botLogin: BOT, now: NOW, pushesToday: [],
  ...over,
});
const botCommit = (i) => ({ sha: `${i}`.repeat(40).slice(0, 40), author: { login: BOT }, committer: { login: BOT }, commit: { message: 'Merge main\n\nLanding-Bot-Kind: keeper', committer: { date: '2026-11-16T11:00:00Z' } } });

test('#6474: a conflicted, quiet, eligible PR is planned', () => {
  const r = plan([pr()], ctx());
  assert.deepEqual(r.act.map((p) => p.number), [101]);
});

test('#6474: queued, recently pushed, fork, bot:off, mode unset, open breaker and a third attempt all do nothing', () => {
  const cases = [
    ['queued', [pr({ inMergeQueue: true })], ctx(), /merge queue/],
    ['queue state unknown', [pr({ inMergeQueue: undefined })], ctx(), /merge queue/],
    ['recently pushed', [pr({ headChangedAt: '2026-11-16T11:50:00Z' })], ctx(), /head changed under 30 minutes/],
    ['fork', [pr({ head: { ref: 'x', sha: 'c'.repeat(40), repo: { full_name: 'someone/StudioOS' } } })], ctx(), /not in this repository/],
    ['bot:off', [pr({ labels: ['bot:off'] })], ctx(), /bot:off/],
    ['mode unset', [pr()], ctx({ env: { LANDING_BOT_KEEPER_PER_SWEEP: '3', LANDING_BOT_DAILY_PUSHES: '10' } }), /mode off/],
    ['breaker open', [pr()], ctx({ breakers: { open: true, reasons: ['main is red'] } }), /breaker is open/],
    ['third attempt', [pr({ commits: [...pr().commits, botCommit(1), botCommit(2)] })], ctx(), /2 keeper attempts/],
    ['only behind', [pr({ mergeable: 'MERGEABLE' })], ctx(), /not conflicting/],
    ['handed back, no push since', [pr({ labels: ['conflict'], handedBackAt: '2026-11-16T11:00:00Z' })], ctx(), /handed back/],
    ['diff unreadable', [pr({ files: null })], ctx(), /diff could not be read/],
  ];
  for (const [name, prs, c, reason] of cases) {
    const r = plan(prs, c);
    assert.deepEqual(r.act, [], name);
    assert.match(r.skipped.map((s) => s.reasons.join('; ')).join(' | '), reason, name);
  }
  // Dispatch mode acts only on the one named PR, by dispatch.
  const d = { env: { LANDING_BOT_ENABLED: 'dispatch', LANDING_BOT_DAILY_PUSHES: '10' } };
  assert.deepEqual(plan([pr()], ctx({ ...d, event: 'workflow_dispatch', dispatchPr: 101 })).act.map((p) => p.number), [101]);
  assert.deepEqual(plan([pr()], ctx({ ...d, event: 'schedule' })).act, []);
  assert.deepEqual(plan([pr({ number: 102 })], ctx({ ...d, event: 'workflow_dispatch', dispatchPr: 101 })).act, []);
});

test('#6474: the per-sweep and daily push caps hold, and an unreadable count allows nothing', () => {
  const many = [1, 2, 3, 4, 5].map((n) => pr({ number: n }));
  assert.equal(plan(many, ctx({ env: { LANDING_BOT_ENABLED: 'true', LANDING_BOT_KEEPER_PER_SWEEP: '2', LANDING_BOT_DAILY_PUSHES: '10' } })).act.length, 2);
  assert.equal(plan(many, ctx({ pushesToday: Array(9).fill({ at: '2026-11-16T01:00:00Z' }) })).act.length, 1);
  assert.equal(plan(many, ctx({ pushesToday: null })).act.length, 0);
  assert.equal(plan(many, ctx({ env: { LANDING_BOT_ENABLED: 'true', LANDING_BOT_DAILY_PUSHES: '10' } })).act.length, 0, 'per-sweep unset is 0');
  const day = '2026-11-16';
  const by = new Map([[11, [{ name: reservationName({ day, runId: 11, attempt: 1, n: 3 }) }]], [12, [{ name: 'other' }]], [13, []]]);
  assert.equal(pushesReserved(by, day).length, 3);
  assert.throws(() => pushesReserved(new Map([[14, [{ name: 'landing-bot-keeper-2026-11-16-99-1-3' }]]]), day), /malformed/);
});

test('#6474: the workflow: no PR trigger, no PR text in a shell line, App token never dispatches, guard passes', () => {
  assert.doesNotMatch(WORKFLOW, /^\s*(?:pull_request|pull_request_target|workflow_run|issue_comment):/m);
  assert.match(WORKFLOW, /^on:\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n[\s\S]*?workflow_dispatch:/m);
  assert.match(WORKFLOW, /concurrency:\n {2}group: studioos-landing-bot-keeper\n {2}cancel-in-progress: false/);
  const { jobs } = parseJobs(WORKFLOW);
  for (const step of jobs.flatMap((j) => j.steps).filter((s) => /\brun:/.test(s))) {
    const script = step.slice(step.indexOf('run:'));
    assert.doesNotMatch(script, /\$\{\{/, 'a run script reads its inputs from env:, never an expression');
  }
  const keep = jobs.find((j) => j.id === 'keep');
  const resolver = jobs.find((j) => j.id === 'resolver');
  assert.equal(keep.environment, 'landing-bot');
  assert.equal(resolver.environment, null);
  assert.doesNotMatch(resolver.lines.join('\n'), /secrets\.|app-token|KEEPER_APP_TOKEN/);
  assert.match(resolver.lines.join('\n'), /permissions:\n {6}actions: write\n {6}contents: read/);
  assert.doesNotMatch(keep.lines.join('\n'), /gh workflow run|dispatches/);
  assert.doesNotMatch(WORKFLOW, /--force|force-with-lease|gh pr merge|enqueue|approve/);
  assertWorkflow(new URL('.github/workflows/landing-bot-keeper.yml', ROOT).pathname);
});

test('#6474: keeper-merge runs every git call with hooks, filters and LFS off', () => {
  const src = readFileSync(new URL('scripts/landing-bot/keeper-merge.mjs', ROOT), 'utf8');
  for (const c of ['core.hooksPath=/dev/null', 'filter.lfs.process=', 'filter.lfs.smudge=', 'diff.external=', 'submodule.recurse=false', 'core.fsmonitor=false']) assert.ok(src.includes(`'${c}'`), c);
  assert.match(src, /GIT_LFS_SKIP_SMUDGE: '1'/);
  const keeper = readFileSync(new URL('scripts/landing-bot/keeper.mjs', ROOT), 'utf8');
  assert.doesNotMatch(keeper, /'--force'|'-f'|force-with-lease/);
  assert.match(keeper, /'--no-verify'/);
  assert.doesNotMatch(keeper, /x-access-token:\$\{token\}@/, 'the token never goes in a URL');
});
