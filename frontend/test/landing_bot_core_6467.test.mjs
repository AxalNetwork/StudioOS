// #6467: the landing bot's shared rules (scripts/landing-bot/rules.mjs) and the workflow test helper
// (scripts/landing-bot/workflowGuard.mjs). Pure functions; nothing here reaches GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KINDS, MAX_ATTEMPTS, QUIET_MINUTES, BREAKER_ALERTS, LABELS, STICKY_MARKER, PROTECTED, dispatchable,
  mode, triggerAllowed, breakers, eligible, verdictFor, attempts, budget, pathGuard, giveUp, owningSlot, order,
  stickyComment, renderSticky, count,
} from '../../scripts/landing-bot/rules.mjs';
import { checkWorkflow, assertWorkflow, parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';

const REPO = 'AxalNetwork/StudioOS';
const BOT = 'axal-landing-bot[bot]';
const NOW = Date.parse('2026-11-15T12:00:00Z');
const green = [{ event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: '2026-11-15T11:00:00Z' }];
const closed = { open: false, reasons: [] };
const pr = (over = {}) => ({
  number: 7001, state: 'open', draft: false, labels: [], body: 'Closes #6467',
  head: { ref: 'agent/claude/7001-x', repo: { full_name: REPO } }, base: { repo: { full_name: REPO } }, ...over,
});
const ctx = (over = {}) => ({ env: { LANDING_BOT_ENABLED: 'true' }, repo: REPO, files: [{ path: 'frontend/src/pages/X.jsx' }], breakers: closed, kind: 'keeper', now: NOW, ...over });

test('mode: unset or anything but true/dispatch is off; dispatch acts only on one named PR', () => {
  assert.equal(mode({}), 'off');
  assert.equal(mode(), 'off');
  for (const v of ['', 'TRUE', '1', 'yes', 'false', ' true']) assert.equal(mode({ LANDING_BOT_ENABLED: v }), 'off', v);
  assert.equal(mode({ LANDING_BOT_ENABLED: 'true' }), 'all');
  assert.equal(mode({ LANDING_BOT_ENABLED: 'dispatch' }), 'dispatch');
  const d = { LANDING_BOT_ENABLED: 'dispatch' };
  assert.equal(triggerAllowed(d, { event: 'workflow_dispatch', dispatchPr: 7001, prNumber: 7001 }), true);
  assert.equal(triggerAllowed(d, { event: 'workflow_dispatch', dispatchPr: 7002, prNumber: 7001 }), false);
  assert.equal(triggerAllowed(d, { event: 'pull_request', dispatchPr: 7001, prNumber: 7001 }), false);
  assert.equal(triggerAllowed({}, { event: 'workflow_dispatch', dispatchPr: 7001, prNumber: 7001 }), false);
});

test('eligible: an ordinary PR in this repo passes; every refusal names its reason', () => {
  assert.deepEqual(eligible(pr(), ctx()), { ok: true, reasons: [] });
  const refused = (p, c, re) => { const r = eligible(p, c); assert.equal(r.ok, false); assert.ok(r.reasons.some((x) => re.test(x)), r.reasons.join(' | ')); };
  refused(pr(), ctx({ env: {} }), /mode off/);
  refused(pr({ head: { ref: 'feature', repo: { full_name: 'someone/StudioOS' } } }), ctx(), /not in this repository/);
  refused(pr({ labels: [{ name: 'bot:off' }] }), ctx(), /bot:off/);
  refused(pr({ labels: ['bot:off'] }), ctx(), /bot:off/);
  refused(pr({ state: 'closed' }), ctx(), /not open/);
  refused(pr({ head: { ref: 'repair/main-1', repo: { full_name: REPO } } }), ctx(), /repair\//);
  refused(pr(), ctx({ files: [{ path: 'frontend/.gitattributes' }] }), /\.gitattributes/);
  refused(pr(), ctx({ files: [{ path: 'x.txt', previousPath: '.gitattributes' }] }), /\.gitattributes/);
  refused(pr(), ctx({ files: null }), /diff could not be read/);
  refused(pr(), ctx({ breakers: { open: true } }), /breaker/);
  refused(pr(), ctx({ breakers: undefined }), /breaker/);
  refused(pr(), ctx({ kind: 'nope' }), /unknown kind/);
  refused(pr(), ctx({ kind: 'red-pr', lastPushAt: NOW - 10 * 60_000 }), /30 minutes/);
  assert.equal(eligible(pr(), ctx({ kind: 'red-pr', lastPushAt: NOW - 31 * 60_000 })).ok, true);
  refused(pr(), ctx({ kind: 'red-pr' }), /30 minutes/);
});

test('breakers: main red is read from the newest completed push run, not an alert issue', () => {
  const base = { env: {}, mainRuns: green, openAlertTitles: [], queuedRuns: [] };
  assert.equal(breakers('keeper', base).open, false);
  const red = [{ ...green[0], conclusion: 'failure', created_at: '2026-11-15T11:30:00Z' }, ...green];
  assert.match(breakers('keeper', { ...base, mainRuns: red }).reasons.join(), /main is red/);
  const recovered = [{ ...green[0], created_at: '2026-11-15T11:45:00Z' }, ...red];
  assert.equal(breakers('keeper', { ...base, mainRuns: recovered }).open, false, 'newest wins');
  const running = [{ ...green[0], status: 'in_progress', conclusion: null, created_at: '2026-11-15T11:59:00Z' }, ...green];
  assert.equal(breakers('keeper', { ...base, mainRuns: running }).open, false, 'an unfinished run is not read');
  const prRun = [{ ...green[0], event: 'pull_request', conclusion: 'failure', created_at: '2026-11-15T11:59:00Z' }, ...green];
  assert.equal(breakers('keeper', { ...base, mainRuns: prRun }).open, false, 'only push runs on main');
  assert.equal(breakers('keeper', { ...base, mainRuns: null }).open, true, 'unreadable is open');
  assert.equal(breakers('keeper', { ...base, mainRuns: [] }).open, true, 'no run is open');
});

test('breakers: the alert titles repairPolicy.ts uses, the stalled queue among them; unreadable alerts are open', () => {
  const base = { env: {}, mainRuns: green, openAlertTitles: [], queuedRuns: [] };
  for (const t of BREAKER_ALERTS) assert.equal(breakers('conflict', { ...base, openAlertTitles: [t] }).open, true, t);
  assert.equal(breakers('conflict', { ...base, openAlertTitles: ['[alert] something else'] }).open, false);
  assert.equal(breakers('conflict', { ...base, openAlertTitles: null }).open, true);
  assert.equal(breakers('nope', base).open, true);
});

test('breakers: a bulk kind counts fresh queued runs against LANDING_BOT_MAX_QUEUED_RUNS; unset is 0', () => {
  const runs = (n, at = '2026-11-15T11:00:00Z') => Array.from({ length: n }, () => ({ created_at: at }));
  const base = { mainRuns: green, openAlertTitles: [], queuedRuns: runs(3) };
  assert.equal(breakers('refresh', { ...base, env: {} }).open, true, 'unset cap: closed');
  assert.equal(breakers('refresh', { ...base, env: { LANDING_BOT_MAX_QUEUED_RUNS: '3' } }).open, false);
  assert.equal(breakers('refresh', { ...base, env: { LANDING_BOT_MAX_QUEUED_RUNS: '2' } }).open, true);
  const env = { LANDING_BOT_MAX_QUEUED_RUNS: '2', QUEUE_ALERT_IGNORE_BEFORE: '2026-11-15T10:00:00Z' };
  const mixed = [...runs(2), ...runs(5, '2026-11-15T09:00:00Z')];
  assert.equal(breakers('refresh', { ...base, env, queuedRuns: mixed }).open, false, 'stale queued runs are ignored');
  assert.equal(breakers('refresh', { ...base, env, queuedRuns: null }).open, true);
  assert.equal(breakers('keeper', { ...base, env: {}, queuedRuns: runs(500) }).open, false, 'not a bulk kind');
});

test('verdictFor wraps ciClassify: infra, inherited, own and unknown', () => {
  const jobs = (...names) => names.map((name) => ({ name, conclusion: 'failure', steps: [{ name: 'Run tests', conclusion: 'failure' }] }));
  assert.equal(verdictFor({ jobs: [{ name: 'suite (rest)', conclusion: 'failure', steps: [{ name: 'Set up job', conclusion: 'failure' }] }], main: null }), 'infra_failure');
  assert.equal(verdictFor({ jobs: jobs('suite (rest)'), main: { conclusion: 'failure', jobs: jobs('suite (rest)') } }), 'inherited_main_failure');
  assert.equal(verdictFor({ jobs: jobs('suite (rest)'), main: { conclusion: 'success', jobs: [] } }), 'pr_failure');
  assert.equal(verdictFor({ jobs: jobs('suite (rest)'), main: null }), 'main_health_unknown');
  assert.equal(verdictFor({}), 'pr_failure', 'no failed part: read its own log');
});

const session = (sha, date = '2026-11-15T08:00:00Z') => ({ sha, author: { login: 'guillaumelauzier' }, committer: { login: 'guillaumelauzier' }, commit: { message: 'work', committer: { date } } });
const bot = (sha, kind, date = '2026-11-15T09:00:00Z') => ({ sha, author: { login: BOT }, committer: { login: 'web-flow' }, commit: { message: `Update branch\n\nLanding-Bot-Kind: ${kind}`, committer: { date } } });
const run = (kind, head_sha, extra = {}) => ({ kind, pr: 7001, head_sha, status: 'completed', created_at: '2026-11-15T09:00:00Z', ...extra });

test('attempts: at most 2 per kind; a head changed by a bot commit stays in the same series', () => {
  const data = (commits, runs) => ({ botLogin: BOT, now: NOW, commits, runs });
  assert.equal(attempts(pr(), 'keeper', data([session('a')], [])).allowed, true);
  assert.equal(attempts(pr(), 'keeper', data([session('a')], [run('keeper', 'a')])).allowed, true);
  // The first attempt's commit moved the head to b; its run on b is the second attempt in the same series.
  const two = attempts(pr(), 'keeper', data([session('a'), bot('b', 'keeper')], [run('keeper', 'a'), run('keeper', 'b')]));
  assert.equal(two.used, 2);
  assert.equal(two.allowed, false);
  // Bot commits alone still count when their runs are missing.
  assert.equal(attempts(pr(), 'keeper', data([session('a'), bot('b', 'keeper'), bot('c', 'keeper')], [])).allowed, false);
  // A commit with the App as committer is still the bot's.
  const asCommitter = { ...session('b'), committer: { login: BOT } };
  assert.equal(attempts(pr(), 'keeper', data([session('a'), asCommitter], [run('keeper', 'a'), run('keeper', 'b')])).allowed, false);
  // Kinds are counted apart.
  assert.equal(attempts(pr(), 'conflict', data([session('a'), bot('b', 'keeper')], [run('keeper', 'a'), run('keeper', 'b')])).allowed, true);
});

test('attempts: the limit is for the PR\'s whole life, so a session commit does not restart it; comments are never read', () => {
  const runs = [run('keeper', 'a'), run('keeper', 'b')];
  const commits = [session('a'), bot('b', 'keeper'), session('c')];
  // Owner, 2026-11-15 (#6467 B): the session pushed c, and the keeper still has had its two attempts.
  const after = attempts(pr(), 'keeper', { botLogin: BOT, now: NOW, commits, runs });
  assert.equal(after.allowed, false, 'a session commit does not reset the count');
  assert.equal(after.used, 2);
  // Runs on older heads still count, and so do runs on a head the session pushed later.
  assert.equal(attempts(pr(), 'keeper', { botLogin: BOT, now: NOW, commits: [session('a'), session('c')], runs: [run('keeper', 'a'), run('keeper', 'c')] }).allowed, false);
  // Another PR's runs are not this PR's.
  assert.equal(attempts(pr(), 'keeper', { botLogin: BOT, now: NOW, commits: [session('a')], runs: [run('keeper', 'a', { pr: 7002 }), run('keeper', 'b', { pr: 7002 })] }).allowed, true);
  // A forged or deleted sticky comment is not an input: passing comments changes nothing.
  const forged = { botLogin: BOT, now: NOW, commits: [session('a'), bot('b', 'keeper')], runs, comments: [{ user: { login: 'someone' }, body: `${STICKY_MARKER}\nattempts: 0` }] };
  assert.equal(attempts(pr(), 'keeper', forged).allowed, false);
  assert.equal(attempts(pr(), 'keeper', { ...forged, comments: [] }).allowed, false);
  // Unreadable records refuse.
  assert.equal(attempts(pr(), 'keeper', { botLogin: BOT, now: NOW, commits: null, runs }).allowed, false);
  assert.equal(attempts(pr(), 'keeper', { now: NOW, commits, runs }).allowed, false);
});

test('attempts: across kinds at most 4 bot commits and 2 model runs per PR in 24 hours', () => {
  const commits = [session('s'), bot('b1', 'keeper'), bot('b2', 'refresh'), bot('b3', 'conflict'), bot('b4', 'red-pr')];
  const r = attempts(pr(), 'conflict', { botLogin: BOT, now: NOW, commits, runs: [] });
  assert.equal(r.allowed, false);
  assert.ok(r.reasons.some((x) => /4 bot commits/.test(x)));
  const old = commits.map((c, i) => (i ? { ...c, commit: { ...c.commit, committer: { date: '2026-11-13T09:00:00Z' } } } : c));
  assert.equal(attempts(pr(), 'conflict', { botLogin: BOT, now: NOW, commits: old, runs: [] }).allowed, true, 'older than 24 hours');
  const modelRuns = [run('conflict', 'x', { modelCalls: 1 }), run('red-pr', 'y', { modelCalls: 3 })];
  const m = attempts(pr(), 'red-pr', { botLogin: BOT, now: NOW, commits: [session('s')], runs: modelRuns });
  assert.equal(m.allowed, false);
  assert.ok(m.reasons.some((x) => /2 model runs/.test(x)));
  assert.equal(attempts(pr(), 'keeper', { botLogin: BOT, now: NOW, commits: [session('s')], runs: modelRuns }).allowed, true, 'keeper calls no model');
  const unknownCalls = [run('conflict', 'x'), run('conflict', 'y')];
  assert.equal(attempts(pr(), 'red-pr', { botLogin: BOT, now: NOW, commits: [session('s')], runs: unknownCalls }).allowed, false, 'a model kind with no count is a model run');
});

test('attempts: main repair counts by fingerprint; five red main commits allow at most 2 model runs', () => {
  const fp = 'suite (worker-1-of-6)/billing_d5299 refunds';
  const runs = [];
  let allowed = 0;
  for (let i = 0; i < 5; i++) {
    const r = attempts(null, 'main-repair', { botLogin: BOT, now: NOW, runs, fingerprint: fp });
    if (r.allowed) { allowed++; runs.push({ kind: 'main-repair', status: 'completed', fingerprint: fp, head_sha: `m${i}`, modelCalls: 1 }); }
  }
  assert.equal(allowed, 2);
  assert.equal(attempts(null, 'main-repair', { botLogin: BOT, now: NOW, runs, fingerprint: 'other/test' }).allowed, true, 'another fingerprint has its own count');
  assert.equal(attempts(null, 'main-repair', { botLogin: BOT, now: NOW, runs, fingerprint: '' }).allowed, false);
});

test('budget: unset caps allow nothing; over budget is refused; only the kind\'s own caps apply', () => {
  const usage = (n) => ({ now: NOW, modelCalls: Array.from({ length: n }, () => ({ at: '2026-11-15T01:00:00Z' })), pushes: [], requeues: [] });
  assert.equal(budget('conflict', {}, usage(0)).allowed, false, 'no variables: nothing');
  const env = { LANDING_BOT_DAILY_MODEL_RUNS: '3', LANDING_BOT_DAILY_PUSHES: '10', LANDING_BOT_DAILY_REQUEUES: '5' };
  assert.equal(budget('conflict', env, usage(2)).allowed, true);
  const over = budget('conflict', env, usage(3));
  assert.equal(over.allowed, false);
  assert.match(over.reasons.join(), /LANDING_BOT_DAILY_MODEL_RUNS: 3 of 3/);
  assert.equal(budget('keeper', env, usage(99)).allowed, true, 'keeper uses no model');
  assert.equal(budget('ejection', { LANDING_BOT_DAILY_REQUEUES: '1' }, usage(0)).allowed, true);
  assert.equal(budget('ejection', { LANDING_BOT_DAILY_REQUEUES: '1' }, { ...usage(0), requeues: [{ at: '2026-11-15T02:00:00Z' }] }).allowed, false);
  assert.equal(budget('conflict', env, { ...usage(3), modelCalls: Array.from({ length: 3 }, () => ({ at: '2026-11-14T23:00:00Z' })) }).allowed, true, 'yesterday does not count');
  assert.equal(budget('conflict', env, { now: NOW, modelCalls: null, pushes: [] }).allowed, false, 'unreadable use');
  assert.equal(count('-1'), 0); assert.equal(count('2.5'), 0); assert.equal(count(' 4 '), 4);
});

test('pathGuard: each protected path is refused, and so is anything merge-policy rates T2', () => {
  const each = ['.github/workflows/ci.yml', 'cloudflare-worker/sql/migrations/202611150000_x.sql', 'scripts/ci/no-anthropic-in-prod.mjs',
    'merge-control/src/lib/repairPolicy.ts', 'package.json', 'frontend/package.json', 'package-lock.json', 'pnpm-lock.yaml',
    'wrangler.toml', 'wrangler.branch.fr.toml', '.gitattributes', 'docs/.gitattributes', 'AGENTS.md', 'CLAUDE.md', '.github/CODEOWNERS'];
  for (const p of each) assert.equal(pathGuard([{ path: p }]).ok, false, p);
  assert.equal(pathGuard([{ path: 'frontend/test/zone_actions.test.mjs' }]).ok, false, 'an existing test is T2');
  assert.match(pathGuard([{ path: 'frontend/test/zone_actions.test.mjs' }]).refused[0].reason, /merge-policy/);
  assert.equal(pathGuard([{ path: 'cloudflare-worker/src/routes/billing.ts' }]).ok, false, 'a sensitive name is T2');
  assert.equal(pathGuard([{ path: 'frontend/src/pages/cycles/ValidateSections.jsx' }]).ok, true);
  assert.equal(pathGuard([{ path: 'documentation/x.md' }, { path: 'frontend/src/pages/a.jsx' }]).ok, true);
  assert.equal(pathGuard([{ path: 'frontend/src/pages/a.jsx', previousPath: 'AGENTS.md', status: 'R100' }]).ok, false, 'a rename\'s old path counts');
  assert.equal(pathGuard([]).ok, false);
  assert.equal(pathGuard(null).ok, false);
  assert.equal(pathGuard([{ path: '' }]).ok, false);
  assert.ok(PROTECTED.length >= 11);
});

test('giveUp: one label and one comment naming cause, test or files, the command and the owning slot', () => {
  const issue = { number: 6467, labels: [{ name: 'task' }, { name: 'slot:S23' }] };
  const g = giveUp(pr(), 'two conflict attempts did not resolve it', { test: 'frontend/test/zone_actions.test.mjs', reproduce: 'npm run test:frontend', issue });
  assert.equal(g.label, LABELS.needsSession);
  assert.equal(g.slot, 'S23');
  assert.match(g.body, /Cause: two conflict attempts did not resolve it/);
  assert.match(g.body, /Test: `frontend\/test\/zone_actions\.test\.mjs`/);
  assert.match(g.body, /Reproduce: `npm run test:frontend`/);
  assert.match(g.body, /Owning slot: S23 \(from #6467\)/);
  const nothing = giveUp(pr({ body: 'no issue here' }), 'budget', { files: ['a.js'] });
  assert.match(nothing.body, /Owning slot: Not recorded/);
  assert.match(nothing.body, /Files: `a\.js`/);
  assert.match(nothing.body, /Reproduce: Not recorded/);
  assert.equal(owningSlot('Part of #10', { number: 10, labels: ['slot:S04'] }), 'S04');
  assert.equal(owningSlot('Closes #10', { number: 11, labels: ['slot:S04'] }), null, 'the issue must be the one the body names');
});

test('order: the owner\'s queued PRs, then ready, then draft', () => {
  const got = order([{ number: 5, draft: true }, { number: 3 }, { number: 9, ownerQueued: true }, { number: 1, draft: true }, { number: 2 }]);
  assert.deepEqual(got.map((p) => p.number), [9, 2, 3, 1, 5]);
});

test('dispatchable is a fixed list of bot workflow files, one per kind', () => {
  assert.ok(Object.isFrozen(dispatchable));
  assert.equal(dispatchable.length, Object.keys(KINDS).length);
  for (const kind of Object.keys(KINDS)) {
    const file = kind === 'feeder' ? 'landing-feeder' : `landing-bot-${kind}`;
    assert.ok(dispatchable.includes(`.github/workflows/${file}.yml`));
  }
});

test('the sticky comment is display only and trusted only from the App', () => {
  const body = renderSticky(['Branch updated.']);
  assert.ok(body.startsWith(STICKY_MARKER));
  const mine = { user: { login: BOT, type: 'Bot' }, body };
  assert.equal(stickyComment([{ user: { login: 'someone', type: 'User' }, body }, mine], BOT), mine);
  assert.equal(stickyComment([{ user: { login: BOT, type: 'User' }, body }], BOT), null, 'a user named like the App is not the App');
  assert.equal(stickyComment([{ user: { login: 'someone', type: 'User' }, body }], BOT), null);
  assert.equal(stickyComment([mine], undefined), null);
});

test('the shared limits equal merge-control/src/lib/repairPolicy.ts', () => {
  const src = readFileSync(new URL('../../merge-control/src/lib/repairPolicy.ts', import.meta.url), 'utf8');
  assert.equal(Number(/\bMAX_ATTEMPTS\s*=\s*(\d+)/.exec(src)[1]), MAX_ATTEMPTS);
  assert.equal(Number(/\bQUIET_MINUTES\s*=\s*(\d+)/.exec(src)[1]), QUIET_MINUTES);
  const set = /BREAKER_ALERTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src)[1];
  assert.deepEqual([...set.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), [...BREAKER_ALERTS].sort());
});

test('the labels exist in .github/labels.yml', () => {
  const yml = readFileSync(new URL('../../.github/labels.yml', import.meta.url), 'utf8');
  for (const name of Object.values(LABELS)) assert.ok(yml.includes(`- name: "${name}"\n`), name);
});

// ---- the workflow test helper ----

const wf = (jobs, top = '') => `name: x\non: workflow_dispatch\n${top}jobs:\n${jobs}`;

test('workflow guard: a clean bot workflow passes', () => {
  const text = wf([
    '  act:',
    '    runs-on: ubuntu-latest',
    '    environment: landing-bot',
    '    steps:',
    '      - id: app',
    '        uses: actions/create-github-app-token@v2',
    '        with:',
    '          app-id: ${{ secrets.LANDING_BOT_APP_ID }}',
    '          private-key: ${{ secrets.LANDING_BOT_APP_PRIVATE_KEY }}',
    '      - name: dispatch',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '        run: gh workflow run landing-bot-conflict.yml -f pr=1',
    '',
  ].join('\n'));
  assert.deepEqual(checkWorkflow(text), []);
  assert.equal(parseJobs(text).jobs[0].environment, 'landing-bot');
});

test('workflow guard: the App token passed to a dispatch call fails', () => {
  const viaStep = wf([
    '  act:',
    '    environment: landing-bot',
    '    steps:',
    '      - id: app',
    '        uses: actions/create-github-app-token@v2',
    '      - run: gh workflow run landing-bot-conflict.yml',
    '        env:',
    '          GH_TOKEN: ${{ steps.app.outputs.token }}',
    '',
  ].join('\n'));
  assert.ok(checkWorkflow(viaStep).some((p) => /App token/.test(p)));
  const viaSecret = wf([
    '  act:',
    '    environment: repair',
    '    steps:',
    '      - uses: actions/github-script@v7',
    '        with:',
    '          github-token: ${{ secrets.LANDING_BOT_APP_TOKEN }}',
    "          script: await github.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: 'landing-bot-keeper.yml', ref: 'main' })",
    '',
  ].join('\n'));
  assert.ok(checkWorkflow(viaSecret).some((p) => /App token/.test(p)));
});

test('workflow guard: a dispatch outside dispatchable, or one it cannot name, fails', () => {
  const other = wf(['  act:', '    environment: landing-bot', '    steps:', '      - run: gh workflow run ci.yml', ''].join('\n'));
  assert.ok(checkWorkflow(other).some((p) => /ci\.yml, which is not in dispatchable/.test(p)));
  const api = wf(['  act:', '    environment: landing-bot', '    steps:', '      - run: gh api -X POST repos/o/r/actions/workflows/deploy.yml/dispatches', ''].join('\n'));
  assert.ok(checkWorkflow(api).some((p) => /deploy\.yml/.test(p)));
  const expr = wf(['  act:', '    environment: landing-bot', '    steps:', '      - run: gh workflow run ${{ inputs.which }}', ''].join('\n'));
  assert.ok(checkWorkflow(expr).some((p) => /cannot be read/.test(p)));
});

test('workflow guard: App or model secrets outside the landing-bot and repair environments fail', () => {
  const noEnv = wf(['  act:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo', '        env:', '          K: ${{ secrets.ANTHROPIC_API_KEY }}', ''].join('\n'));
  assert.ok(checkWorkflow(noEnv).some((p) => /ANTHROPIC_API_KEY outside/.test(p)));
  const wrongEnv = wf(['  act:', '    environment:', '      name: production', '    steps:', '      - run: echo ${{ secrets.LANDING_BOT_APP_ID }}', ''].join('\n'));
  assert.ok(checkWorkflow(wrongEnv).some((p) => /LANDING_BOT_APP_ID outside.*production/.test(p)));
  const topLevel = wf(['  act:', '    environment: repair', '    steps:', '      - run: echo', ''].join('\n'), 'env:\n  K: ${{ secrets.OPENAI_API_KEY }}\n');
  assert.ok(checkWorkflow(topLevel).some((p) => /OPENAI_API_KEY is named outside a job/.test(p)));
  const fine = wf(['  act:', '    environment:', '      name: repair', '    steps:', '      - run: echo ${{ secrets.ANTHROPIC_API_KEY }}', ''].join('\n'));
  assert.deepEqual(checkWorkflow(fine), []);
});

test('workflow guard: assertWorkflow reads the file and throws with every problem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lb-'));
  const bad = join(dir, 'bad.yml');
  writeFileSync(bad, wf(['  act:', '    steps:', '      - run: gh workflow run ci.yml', '        env:', '          K: ${{ secrets.ANTHROPIC_API_KEY }}', ''].join('\n')));
  assert.throws(() => assertWorkflow(bad), (e) => /not in dispatchable/.test(e.message) && /ANTHROPIC_API_KEY/.test(e.message));
  const good = join(dir, 'good.yml');
  writeFileSync(good, wf(['  act:', '    steps:', '      - run: echo hi', ''].join('\n')));
  assert.equal(assertWorkflow(good), true);
});
