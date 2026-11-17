// Merge-queue audit of 2026-11-17, the S21 P0 findings: the ejection handler's green-check evidence, its flake class
// and group-run match, and the model round's call-site permissions. Each test is one acceptance line of the audit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGitHubReader } from '../../scripts/landing-bot/feeder-github.mjs';
import { classify, decide, groupRunFor, REQUEUE_CLASSES } from '../../scripts/landing-bot/ejection-rules.mjs';

const repo = 'AxalNetwork/StudioOS';
const number = 42;
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const ACTIONS = 15368;
const REQUIRED = ['test:drift (full suite)', 'worker (typecheck)', 'frontend (build)', 'api ↔ worker drift', 'applied migrations unchanged', 'scan'];
const asResponse = (data) => new Response(JSON.stringify(data), { status: 200 });
const run = (name, i, over = {}) => ({ name, id: 500 + i, app: { id: ACTIONS }, head_sha: head, status: 'completed', conclusion: 'success', ...over });

/** A reader over a fake GitHub: main requires REQUIRED from GitHub Actions; `checks` are this head's check runs. */
function world({ checks = REQUIRED.map((n, i) => run(n, i)), pageSize = 100, pullHead = head, fullRun = {} } = {}) {
  const fullCheck = checks.find((c) => c.name === 'test:drift (full suite)');
  const reader = createGitHubReader({
    repo, token: 'fixture',
    fetchImpl: async (url) => {
      const u = new URL(url);
      const path = u.pathname.replace(`/repos/${repo}`, '');
      if (path === '/pulls/42') return asResponse({ number, head: { sha: pullHead }, base: { ref: 'main' } });
      if (path === '/rules/branches/main') {
        return asResponse([{ type: 'merge_queue' }, { type: 'required_status_checks', parameters: { required_status_checks: REQUIRED.map((context) => ({ context, integration_id: ACTIONS })) } }]);
      }
      if (path === `/commits/${pullHead}/check-runs`) {
        const page = Number(u.searchParams.get('page'));
        const rows = checks.slice((page - 1) * pageSize, page * pageSize);
        // A short page ends the list; a full page asks for the next one.
        return asResponse({ check_runs: rows.length === pageSize ? [...rows, ...Array(100 - pageSize).fill(null).map((_, k) => run(`filler ${page}.${k}`, 900 + k))] : rows, total_count: checks.length + (pageSize < 100 ? 999 : 0) });
      }
      if (fullCheck && path === `/actions/jobs/${fullCheck.id}`) return asResponse({ ...fullCheck, run_id: 102 });
      if (path === '/actions/runs/102') {
        return asResponse({ id: 102, event: 'pull_request', path: '.github/workflows/ci.yml', head_sha: head, repository: { full_name: repo }, pull_requests: [{ number, head: { sha: head }, base: { ref: 'main', sha: base } }], ...fullRun });
      }
      throw new Error(`unknown fixture path ${path}`);
    },
  });
  return reader;
}

test('audit P0: the six required checks, from GitHub Actions, success on this head, and a trusted full suite: green', async () => {
  const ev = await world().readHeadEvidence(number, head);
  assert.equal(ev.ok, true, ev.detail);
  assert.equal(ev.fullSuitePassed, true);
});

test('audit P0: a missing, skipped, neutral, wrong-source or pending required check is not green', async () => {
  const cases = [
    ['missing', REQUIRED.slice(1).map((n, i) => run(n, i + 1)).concat(run('test:drift (full suite)', 0)).filter((c) => c.name !== 'scan'), /missing: scan/],
    ['skipped', REQUIRED.map((n, i) => run(n, i, n === 'worker (typecheck)' ? { conclusion: 'skipped' } : {})), /not success: worker \(typecheck\) \(skipped\)/],
    ['neutral', REQUIRED.map((n, i) => run(n, i, n === 'scan' ? { conclusion: 'neutral' } : {})), /not success: scan \(neutral\)/],
    ['wrong source', REQUIRED.map((n, i) => run(n, i, n === 'frontend (build)' ? { app: { id: 999 } } : {})), /missing: frontend \(build\)/],
    ['pending', REQUIRED.map((n, i) => run(n, i, n === 'api ↔ worker drift' ? { status: 'in_progress', conclusion: null } : {})), /pending: api ↔ worker drift/],
  ];
  for (const [what, checks, why] of cases) {
    const ev = await world({ checks }).readHeadEvidence(number, head);
    assert.equal(ev.ok, false, what);
    assert.match(ev.detail, why, what);
  }
});

test('audit P0: one unrelated success cannot qualify a PR for re-queue', async () => {
  // The old rule: a nonempty page where every check is success, neutral or skipped. One unrelated green run passed it.
  const ev = await world({ checks: [run('preview deploy', 1)] }).readHeadEvidence(number, head);
  assert.equal(ev.ok, false);
  assert.match(ev.detail, /missing: test:drift \(full suite\), worker \(typecheck\)/);
  assert.match(ev.detail, /no trusted full-suite run/);
});

test('audit P0: check runs are read across pages', async () => {
  // The required runs sit after a full first page of unrelated ones.
  const checks = [...Array(100).fill(null).map((_, k) => run(`other ${k}`, 1000 + k)), ...REQUIRED.map((n, i) => run(n, i))];
  const ev = await world({ checks }).readHeadEvidence(number, head);
  assert.equal(ev.ok, true, ev.detail);
});

test('audit P0: a moved head, a full suite from another workflow or PR, is not evidence', async () => {
  const moved = await world({ pullHead: 'c'.repeat(40) }).readHeadEvidence(number, head);
  assert.deepEqual([moved.ok, moved.detail], [false, 'the head moved since it was read']);
  for (const fullRun of [{ path: '.github/workflows/other.yml' }, { event: 'push' }, { pull_requests: [{ number: 7, head: { sha: head }, base: { ref: 'main', sha: base } }] }]) {
    const ev = await world({ fullRun }).readHeadEvidence(number, head);
    assert.equal(ev.ok, false, JSON.stringify(fullRun));
    assert.match(ev.detail, /no trusted full-suite run/);
  }
});

test('audit P0: green alone and on main but red in the group is incompatible, surfaced and never re-queued', () => {
  const k = classify({ reason: 'FAILED_CHECKS', queueRun: { conclusion: 'failure', jobs: [{ name: 'suite (worker-3-of-6)', conclusion: 'failure' }] }, headRun: { conclusion: 'success' }, main: { conclusion: 'success' }, failedTests: [], flaky: [] });
  assert.equal(k.class, 'incompatible');
  assert.ok(!REQUEUE_CLASSES.includes('incompatible'));
  const d = decide({ klass: k.class, consent: { valid: true }, checksGreenOnHead: true, headUnchangedSinceChecks: true });
  assert.equal(d.action, 'label');
  assert.match(d.reasons.join(), /compare it with the entry ahead/);
  // A flake still needs every failing test named and on the flaky list.
  assert.equal(classify({ reason: 'FAILED_CHECKS', queueRun: { conclusion: 'failure', jobs: [] }, main: { conclusion: 'success' }, failedTests: [{ file: 'a', test: 't' }, { file: 'b', test: 'u' }], flaky: [{ file: 'a', test: 't' }] }).class, 'own-failure');
});

test('audit P0: the group run is matched by its exact queue branch and the entry window, never by a substring', () => {
  const pr = { number: 12, added: [{ at: '2026-11-17T10:00:00Z' }] };
  const removal = { at: '2026-11-17T11:00:00Z' };
  const r = (n, at, over = {}) => ({ event: 'merge_group', head_branch: `gh-readonly-queue/main/pr-${n}-${base}`, created_at: at, ...over });
  assert.equal(groupRunFor([r(12, '2026-11-17T10:10:00Z')], pr, removal)?.created_at, '2026-11-17T10:10:00Z');
  assert.equal(groupRunFor([r(123, '2026-11-17T10:10:00Z'), r(112, '2026-11-17T10:10:00Z')], pr, removal), null, 'pr-123 and pr-112 are not pr-12');
  assert.equal(groupRunFor([r(12, '2026-11-17T09:00:00Z')], pr, removal), null, 'a run before this entry is an earlier attempt');
  assert.equal(groupRunFor([r(12, '2026-11-17T11:30:00Z')], pr, removal), null, 'a run after the removal is a later one');
  assert.equal(groupRunFor([r(12, '2026-11-17T10:10:00Z'), r(12, '2026-11-17T10:20:00Z')], pr, removal), null, 'two candidates are no evidence');
  assert.equal(groupRunFor([r(12, '2026-11-17T10:10:00Z', { event: 'pull_request' })], pr, removal), null);
  assert.equal(groupRunFor([r(12, '2026-11-17T10:10:00Z', { head_branch: `x/gh-readonly-queue/main/pr-12-${base}` })], pr, removal), null);
});

test('audit P0: each model round call grants the permissions the round\'s edit job requests', () => {
  const caller = readFileSync(new URL('../../.github/workflows/landing-bot-model.yml', import.meta.url), 'utf8');
  for (const n of [1, 2, 3]) {
    const block = caller.slice(caller.indexOf(`  round${n}:\n`), caller.indexOf('    uses: ./.github/workflows/landing-bot-model-round.yml', caller.indexOf(`  round${n}:\n`)));
    assert.match(block, /\n {4}permissions:\n {6}contents: read\n {6}id-token: write\n/, `round${n}`);
  }
  const round = readFileSync(new URL('../../.github/workflows/landing-bot-model-round.yml', import.meta.url), 'utf8');
  assert.match(round, /^permissions: \{\}/m);
  assert.match(round, /environment: repair\n[\s\S]*?permissions:\n {6}contents: read\n[\s\S]*?id-token: write/);
  // The resolver's call into the model runner grants the same two, and no more.
  const conflict = readFileSync(new URL('../../.github/workflows/landing-bot-conflict.yml', import.meta.url), 'utf8');
  assert.match(conflict, /  resolve:\n[\s\S]*?permissions:\n {6}contents: read\n {6}id-token: write\n {4}uses: \.\/\.github\/workflows\/landing-bot-model\.yml/);
});

// Owner answers of 2026-11-17 to the audit's P1s.
import { budget } from '../../scripts/landing-bot/rules.mjs';
import { consent } from '../../scripts/landing-bot/ejection-rules.mjs';
import { repairStatus } from '../../scripts/landing-bot/feeder-github.mjs';

test('owner: the daily model cap counts runs, whatever rounds or accounts a run used', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const env = { LANDING_BOT_DAILY_MODEL_RUNS: '1', LANDING_BOT_DAILY_PUSHES: '5' };
  // One earlier run today, however many provider calls it made: the second run is refused.
  assert.equal(budget('conflict', env, { now, modelRuns: [], pushes: [] }).allowed, true);
  const second = budget('conflict', env, { now, modelRuns: [{ at: '2026-11-17T09:00:00Z' }], pushes: [] });
  assert.equal(second.allowed, false);
  assert.match(second.reasons.join(), /LANDING_BOT_DAILY_MODEL_RUNS: 1 of 1 used today/);
  // The resolver reserves one entry per run, never one per call.
  const src = readFileSync(new URL('../../scripts/landing-bot/resolve-rules.mjs', import.meta.url), 'utf8');
  assert.match(src, /budget\(KIND, env, \{ now, modelRuns: ctx\.reserved/);
});

test('owner: the landing App\'s own queue entry is consent; another bot\'s is not', () => {
  const bot = 'axal-landing[bot]';
  const pr = (actor) => ({ added: [{ at: '2026-11-17T10:00:00Z', actor }], removed: [], commits: [], autoMerge: null });
  const own = consent(pr({ login: bot, type: 'Bot' }), { botLogin: bot });
  assert.deepEqual([own.valid, own.source], [true, 'app-queued']);
  assert.equal(consent(pr({ login: 'dependabot[bot]', type: 'Bot' }), { botLogin: bot }).valid, false);
  assert.equal(consent(pr({ login: bot, type: 'Bot' }), {}).valid, false, 'no App login configured: no App consent');
  // A model edit after the App's entry still voids it.
  const edited = { ...pr({ login: bot, type: 'Bot' }), commits: [{ sha: 'c'.repeat(40), parents: [{}], author: { login: bot }, committer: { login: bot }, commit: { message: 'fix\n\nLanding-Bot-Kind: conflict', committer: { date: '2026-11-17T11:00:00Z' } } }] };
  assert.equal(consent(edited, { botLogin: bot }).valid, false);
});

test('owner: the keeper\'s no-model merge by the App does not make a PR model-repaired', () => {
  const bot = 'axal-landing[bot]';
  const user = { login: 'dev', id: 1, type: 'User' };
  const app = { login: bot, id: 2, type: 'Bot' };
  const keeperMerge = { sha: 'd'.repeat(40), parents: [{}, {}], author: app, committer: app, commit: { message: 'Merge main into this branch (landing bot)\n\nLanding-Bot-Kind: keeper' } };
  const own = { sha: 'e'.repeat(40), parents: [{}], author: user, committer: user, commit: { message: 'Fix' } };
  assert.equal(repairStatus([own, keeperMerge], { botLogin: bot }), false);
  assert.equal(repairStatus([own, keeperMerge]), null, 'no App login: uncertain, refused');
  assert.equal(repairStatus([own, { ...keeperMerge, author: { ...app, login: 'other[bot]' }, committer: { ...app, login: 'other[bot]' } }], { botLogin: bot }), null, 'another bot\'s keeper trailer is not trusted');
  assert.equal(repairStatus([own, { ...keeperMerge, parents: [{}] }], { botLogin: bot }), null, 'not a merge');
  assert.equal(repairStatus([own, { ...keeperMerge, commit: { message: 'x\n\nLanding-Bot-Kind: scan-fix' } }], { botLogin: bot }), true, 'a model scan fix is a model repair');
});
