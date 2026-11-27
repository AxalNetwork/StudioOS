/**
 * #6477: main repair. Plain data for the decision (no network), real git repositories for the patch and the revert,
 * stub GitHub clients for the apply job, and the workflow as text.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BRANCH_PREFIX, applyStage, argvOf, claimStage, planStage, checkRepairPatch, decide, findRepairIssue, fingerprintArtifact, fingerprintOf,
  firstRedRun, mentionsIssue, newestMainRun, policyProblems, prBody, reservations, revertProblems, takenBy, verifyFor,
} from '../../scripts/landing-bot/mainRepair.mjs';
import { gitIn } from '../../scripts/landing-bot/keeper-merge.mjs';
import { manifestFor, patchFor } from '../../scripts/landing-bot/model/patch.mjs';
import { assertWorkflow, parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';
import { recordFor } from '../../scripts/landing-bot/model/record.mjs';
import { parseTask } from '../../scripts/landing-bot/model/task.mjs';
import { STICKY_MARKER } from '../../scripts/landing-bot/rules.mjs';

// The stages write job outputs and a summary when these are set; a test run inside Actions must not add to its own.
delete process.env.GITHUB_OUTPUT;
delete process.env.GITHUB_STEP_SUMMARY;

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW_PATH = '.github/workflows/landing-bot-main-repair.yml';
const WORKFLOW = readFileSync(new URL(WORKFLOW_PATH, ROOT), 'utf8');
const MODULE = readFileSync(new URL('scripts/landing-bot/mainRepair.mjs', ROOT), 'utf8');
const REPO = 'AxalNetwork/StudioOS';
const NOW = Date.parse('2026-11-18T12:00:00Z');
const BOT = 'landing-bot[bot]';
const ENV = { LANDING_BOT_ENABLED: 'true', LANDING_BOT_DAILY_MODEL_RUNS: '10', LANDING_BOT_DAILY_PUSHES: '3' };
const SRC = 'frontend/src/pages/validate.js';
const TEST_FILE = 'frontend/test/validate.test.mjs';

const run = (id, conclusion, minute, extra = {}) => ({
  id, event: 'push', head_branch: 'main', head_repository: { full_name: REPO }, status: 'completed', conclusion,
  created_at: `2026-11-18T10:${String(minute).padStart(2, '0')}:00Z`, head_sha: String(id).padStart(40, 'a'), ...extra,
});
const RED_JOBS = [{ name: 'suite (frontend-1-of-2)', conclusion: 'failure', steps: [{ name: 'Run the suite part', conclusion: 'failure' }] }];
const INFRA_JOBS = [{ name: 'suite (frontend-1-of-2)', conclusion: 'failure', steps: [{ name: 'Set up job', conclusion: 'failure' }] }];
const ISSUE = { number: 900, state: 'open', title: '[alert] main is red', user: { login: 'github-actions[bot]' }, labels: [{ name: 'ci' }, { name: 'state:ready' }] };
const VERIFY = verifyFor([{ reproduce: `node --import ./frontend/test/_deck-loader.mjs --test ${TEST_FILE}` }]);
const FP = fingerprintOf([{ job: 'suite (frontend-1-of-2)', kind: 'test', file: TEST_FILE, what: 'validates a stage' }]);

/** A red main nobody owns yet, every cap open: the one case that reaches the model. */
const ctx = (over = {}) => ({
  env: ENV, event: 'schedule', repo: REPO, runs: [run(2, 'failure', 20), run(1, 'success', 10)], jobs: RED_JOBS, alerts: ['[alert] main is red'],
  issue: ISSUE, claim: null, openPrs: [], attemptRuns: [], modelRunsToday: [], repairPrsToday: [], fingerprint: FP,
  allowed: [SRC], verify: VERIFY, botLogin: BOT, now: NOW, ...over,
});

test('#6477: the trigger gate: only a completed push run of CI on main from this repository counts', () => {
  assert.equal(decide(ctx()).decision, 'repair');
  const fork = run(9, 'failure', 50, { head_repository: { full_name: 'someone/StudioOS' } });
  const pr = run(8, 'failure', 51, { event: 'pull_request' });
  const branch = run(7, 'failure', 52, { head_branch: 'agent/x/1-y' });
  const running = run(6, 'failure', 53, { status: 'in_progress' });
  assert.equal(newestMainRun([fork, pr, branch, running, run(1, 'success', 10)], REPO).id, 1, 'none of them is main\'s push run');
  assert.equal(decide(ctx({ runs: [fork, pr, branch, run(1, 'success', 10)] })).decision, 'skip');
  assert.equal(decide(ctx({ runs: null })).decision, 'skip', 'unreadable runs: nothing');
  assert.equal(decide(ctx({ env: {} })).decision, 'skip', 'off by default');
  assert.equal(decide(ctx({ env: { ...ENV, LANDING_BOT_ENABLED: 'dispatch' } })).decision, 'skip', 'dispatch mode: a schedule does not act');
  assert.equal(decide(ctx({ env: { ...ENV, LANDING_BOT_ENABLED: 'dispatch' }, event: 'workflow_dispatch' })).decision, 'repair');
  assert.equal(decide(ctx({ runs: [run(3, 'cancelled', 30), run(1, 'success', 10)] })).decision, 'skip');
});

test('#6477: a green push after the red one creates no repair', () => {
  const r = decide(ctx({ runs: [run(3, 'success', 30), run(2, 'failure', 20), run(1, 'success', 10)] }));
  assert.deepEqual([r.decision, r.reasons], ['skip', ['main is green: its newest completed push run passed']]);
});

test('#6477: an infrastructure verdict creates no repair', () => {
  const r = decide(ctx({ jobs: INFRA_JOBS }));
  assert.equal(r.decision, 'skip');
  assert.match(r.reasons.join(), /infrastructure/);
  assert.equal(decide(ctx({ jobs: null })).decision, 'skip', 'unreadable jobs: nothing');
  assert.equal(decide(ctx({ alerts: [...ctx().alerts, '[alert] the Actions queue is backed up'] })).decision, 'skip', 'a backed-up queue stops it');
  assert.equal(decide(ctx({ alerts: ['[alert] main is red', '[alert] merge queue stalled'] })).decision, 'repair', 'the red-main alerts do not');
});

test('#6477: a session\'s claim, in-progress label, linked PR or repair PR means one comment and no bot PR', () => {
  const held = { sha: 'c'.repeat(40), claim: { version: 1, issue: 900, slot: 'S07', agent: 'claude', session: 's', at: '2026-11-18T11:00:00Z', ttlHours: 24 } };
  const expired = { ...held, claim: { ...held.claim, at: '2026-11-10T11:00:00Z' } };
  const sessionPr = { number: 5001, body: 'Fixes #900\n\nRepairs main.', labels: [], head: { ref: 'agent/claude-s07/900-fix-main' } };
  const labelled = { number: 5002, body: 'A repair.', labels: [{ name: 'main-repair' }], head: { ref: 'agent/claude-s07/x' } };
  for (const [name, over, why] of [
    ['live claim', { claim: held }, /claimed by claude \(S07\)/],
    ['expired claim, still held', { claim: expired }, /claimed/],
    ['state:in-progress', { issue: { ...ISSUE, labels: [{ name: 'state:in-progress' }] } }, /state:in-progress/],
    ['handed to a session', { issue: { ...ISSUE, labels: [{ name: 'needs-session' }] } }, /needs-session/],
    ['linked open PR', { openPrs: [sessionPr] }, /PR #5001 is linked to #900/],
    ['any open main-repair PR', { openPrs: [labelled] }, /repair PR #5002 is open/],
  ]) {
    const r = decide(ctx(over));
    assert.equal(r.decision, 'comment', name);
    assert.match(r.reasons.join(), why, name);
  }
  // An unreadable claim or PR list stops quietly rather than guessing.
  assert.equal(decide(ctx({ claim: 'unreadable' })).decision, 'skip');
  assert.equal(decide(ctx({ openPrs: null })).decision, 'skip');
  // An unrelated PR, or one that only mentions the number in passing, is not a repair.
  assert.deepEqual(takenBy({ issue: ISSUE, claim: null, openPrs: [{ number: 1, body: 'See #900 for context.', labels: [], head: { ref: 'agent/x/1-y' } }] }), []);
  assert.equal(mentionsIssue('Part of #900', 900), true);
  assert.equal(mentionsIssue('Fixes #9001', 900), false);
});

test('#6477: a second red push with the bot\'s repair PR open creates none', async () => {
  const botPr = { number: 6000, body: 'Part of #900', labels: [{ name: 'main-repair' }], head: { ref: `${BRANCH_PREFIX}${'a'.repeat(10)}` } };
  const r = decide(ctx({ runs: [run(3, 'failure', 30), run(2, 'failure', 20), run(1, 'success', 10)], openPrs: [botPr] }));
  assert.equal(r.decision, 'comment');
  // And the apply job re-reads: a repair PR that appeared after the plan stops it before any push.
  const f = fixture();
  const io = await inputs({ decision: 'revert', reasons: ['no model'], firstRed: { head_sha: f.red, complete: true } });
  const fakes = apiFakes({ mainSha: f.red, openPrs: [botPr] });
  let pushes = 0;
  const out = await applyStage(io.env, { gh: fakes.gh, app: fakes.app, clone: cloneFrom(f), pushImpl: () => { pushes += 1; return true; }, claim: fakes.claim });
  assert.deepEqual([out.outcome, pushes], ['skipped', 0]);
  assert.match(out.why, /PR #6000 already repairs it/);
  assert.ok(!fakes.writes.some((w) => w[1] === 'pulls'), 'no PR opened');
  assert.deepEqual(fakes.claims.map((c) => c.command), ['release'], 'the claim is released');
});

test('#6477: main turning green between plan and apply opens nothing', async () => {
  const f = fixture();
  const io = await inputs({ decision: 'revert', reasons: ['no model'], firstRed: { head_sha: f.red, complete: true } });
  const fakes = apiFakes({ mainSha: f.red, runs: [run(3, 'success', 30), run(2, 'failure', 20)] });
  let pushes = 0;
  const out = await applyStage(io.env, { gh: fakes.gh, app: fakes.app, clone: cloneFrom(f), pushImpl: () => { pushes += 1; return true; }, claim: fakes.claim });
  assert.deepEqual([out.outcome, pushes], ['skipped', 0]);
});

test('#6477: five red commits with one fingerprint allow at most 2 model runs', () => {
  const store = [];
  let modelRuns = 0;
  const decisions = [];
  const runs = [run(1, 'success', 1)];
  for (let i = 0; i < 5; i++) {
    runs.unshift(run(10 + i, 'failure', 10 + i));
    const d = decide(ctx({ runs, attemptRuns: reservations(store, { exceptRunId: 100 + i, fingerprint: FP }) }));
    decisions.push(d.decision);
    if (d.decision === 'repair') {
      modelRuns += 1;
      // The workflow uploads this reservation before the model is called.
      store.push({ id: i, name: fingerprintArtifact(FP), created_at: '2026-11-18T10:00:00Z', workflow_run: { id: 100 + i } });
    }
  }
  assert.equal(modelRuns, 2);
  assert.deepEqual(decisions, ['repair', 'repair', 'revert', 'revert', 'revert'], 'after two, a plain revert is proposed instead');
  // A different failure has its own count; the current run's own reservation is never counted against it.
  assert.equal(decide(ctx({ runs, fingerprint: 'other|test|x|y', attemptRuns: [] })).decision, 'repair');
  assert.equal(reservations(store, { exceptRunId: 100, fingerprint: FP }).length, 1);
  assert.equal(decide(ctx({ attemptRuns: null })).decision, 'revert', 'an unreadable record never allows a model run');
  // The daily caps: no model runs left means a revert; no repair PRs left means a comment only.
  assert.equal(decide(ctx({ env: { ...ENV, LANDING_BOT_DAILY_MODEL_RUNS: '' } })).decision, 'revert');
  assert.equal(decide(ctx({ repairPrsToday: [{ at: '2026-11-18T01:00:00Z' }, { at: '2026-11-18T02:00:00Z' }, { at: '2026-11-18T03:00:00Z' }] })).decision, 'comment');
  assert.equal(decide(ctx({ env: { ...ENV, LANDING_BOT_DAILY_PUSHES: '' } })).decision, 'comment', 'unset is 0');
});

test('#6477: a patch that deletes or loosens the failing test, or edits a guard, baseline or allowlist, is refused', () => {
  const before = { [SRC]: 'export const a = 2;\n', [TEST_FILE]: "test('validates a stage', () => { assert.equal(a, 1); });\n", 'scripts/check-unused-imports.mjs': 'x\n', 'scripts/api-drift-baseline.json': '{}\n', 'scripts/test-clock-allowlist.txt': 'a\n' };
  const readBefore = (p) => before[p] ?? null;
  const make = (files) => {
    const changes = files.map(([path, after]) => ({ path, before: readBefore(path), after }));
    return { patch: patchFor({ baseSha: 'b'.repeat(40), changes }), manifest: manifestFor({ baseSha: 'b'.repeat(40), round: 1, result: { provider: 'claude', model: 'm', turns: 1, attempts: [] }, changes }) };
  };
  const check = (files, allowed = files.map((f) => f[0])) => checkRepairPatch({ ...make(files), allowed, readBefore, failingTests: [TEST_FILE] }).join('\n');
  assert.equal(check([[SRC, 'export const a = 1;\n']]), '', 'a fix in the code passes');
  // Loosening the failing test: even when a hostile manifest lists it as allowed.
  const loosened = check([[TEST_FILE, "test('validates a stage', () => {});\n"]]);
  assert.match(loosened, /changes an existing test/);
  assert.match(loosened, /touches the failing test/);
  // Deleting it: an emptied file, or a deletion, is refused.
  assert.match(check([[TEST_FILE, '']]), /empties the file|touches the failing test/);
  assert.match(checkRepairPatch({ ...make([[SRC, 'x\n']]), patch: { version: 1, base_sha: 'b'.repeat(40), files: [{ path: TEST_FILE, content: null }] }, allowed: [TEST_FILE], readBefore, failingTests: [TEST_FILE] }).join(), /not a path and text|touches the failing test|existing test/);
  assert.match(check([['scripts/check-unused-imports.mjs', 'y\n']]), /guard script/);
  assert.match(check([['scripts/api-drift-baseline.json', '{"a":1}\n']]), /baseline/);
  assert.match(check([['scripts/test-clock-allowlist.txt', 'b\n']]), /allowlist/);
  assert.match(check([['.github/workflows/ci.yml', 'x\n']]), /protected path/);
  assert.match(check([[SRC, 'export const a = 1;\n']], []), /outside the allowed list/, 'only the planned files');
  // merge-policy.mjs on the committed diff: a timeout raised, or an assertion removed, is T2.
  assert.match(policyProblems([{ path: SRC, status: 'M', patch: '@@ -1 +1 @@\n-const timeoutMs = 10;\n+const timeoutMs = 999;\n' }]).join(), /T2/);
  assert.deepEqual(policyProblems([{ path: SRC, status: 'M', patch: '@@ -1 +1 @@\n-export const a = 2;\n+export const a = 1;\n' }]), []);
});

test('#6477: a revert containing a migration, a protected path, a merge commit or a conflict is refused', () => {
  assert.deepEqual(revertProblems({ parents: 1, applied: true, files: [SRC] }), []);
  assert.match(revertProblems({ parents: 1, applied: true, files: [SRC, 'cloudflare-worker/sql/migrations/202611180000_6477_x.sql'] }).join(), /contains a migration/);
  assert.match(revertProblems({ parents: 1, applied: true, files: ['backend/app/models/migrations.py'] }).join(), /contains a migration/);
  assert.match(revertProblems({ parents: 1, applied: true, files: ['.github/workflows/ci.yml'] }).join(), /protected path/);
  assert.match(revertProblems({ parents: 2, applied: true, files: [SRC] }).join(), /merge commit/);
  assert.match(revertProblems({ parents: 1, applied: false, files: [] }).join(), /does not apply cleanly/);
});

// ------------------------------------------------------------------ the apply job on real git

/** main: base, then the first red commit (#5001). */
function fixture({ red = { [SRC]: 'export const a = 2;\n' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'main-repair-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (files) => { for (const [p, t] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), t); } };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write({ [SRC]: 'export const a = 1;\n', [TEST_FILE]: "test('validates a stage', () => {});\n" }); git('add', '-A'); git('commit', '-qm', 'base');
  write(red); git('add', '-A'); git('commit', '-qm', 'Break validate (#5001)');
  return { dir, red: git('rev-parse', 'HEAD') };
}
const cloneFrom = (f) => (url, sha, root) => {
  const dir = mkdtempSync(join(root, 'clone-'));
  execFileSync('git', ['clone', '-q', f.dir, dir]);
  execFileSync('git', ['checkout', '-q', '--detach', sha], { cwd: dir });
  return { dir, git: gitIn(dir), main: sha };
};
// #8506: the model runner's controller commit and the task a repair plan carries into the patch's record.
const CONTROLLER = 'c'.repeat(40);
const REPAIR_TASK = { version: 1, instructions: 'fix main', allowed_files: [SRC], verify: [['node', '-e', '0']] };
async function inputs(plan, patchFiles = null) {
  const tmp = mkdtempSync(join(tmpdir(), 'main-repair-io-'));
  const planDir = join(tmp, 'plan');
  const patchDir = join(tmp, 'patch');
  mkdirSync(planDir); mkdirSync(patchDir);
  writeFileSync(join(planDir, 'plan.json'), JSON.stringify({
    repo: REPO, issue: 900, run: { id: 2, head_sha: 'a'.repeat(40) }, allowed: [SRC], failingTests: [TEST_FILE],
    task: REPAIR_TASK,
    rows: [{ job: 'suite (frontend-1-of-2)', kind: 'test', file: TEST_FILE, what: 'validates a stage @someone', reproduce: `node --test ${TEST_FILE}` }], ...plan,
  }));
  if (patchFiles) {
    const changes = patchFiles.map(([path, before, after]) => ({ path, before, after }));
    const patchText = JSON.stringify(patchFor({ baseSha: plan.base, changes }));
    writeFileSync(join(patchDir, 'patch.json'), patchText);
    // #8506: the record this run's edit job would have written for main at plan.base.
    writeFileSync(join(patchDir, 'record.json'), JSON.stringify({ ...recordFor({ identity: { repository: REPO, run_id: '4242', run_attempt: '1' }, task: parseTask(plan.task ?? REPAIR_TASK).task, controller: CONTROLLER, head: plan.base, round: 1, patchText }), ...(plan.record ?? {}) }));
    writeFileSync(join(patchDir, 'manifest.json'), JSON.stringify(manifestFor({ baseSha: plan.base, round: 1, result: { provider: 'claude', model: 'claude-opus-5-5', turns: 3, attempts: [] }, changes })));
  }
  return { env: { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: CONTROLLER, CONTROLLER_SHA: CONTROLLER, MODEL_HEAD_SHA: plan.base, RUNNER_TEMP: tmp, PLAN_DIR: planDir, PATCH_DIR: patchDir, LANDING_BOT_ENABLED: 'true', LANDING_BOT_LOGIN: BOT, MAIN_REPAIR_APP_TOKEN: 't', MODEL_OUTCOME: patchFiles ? 'passed' : '' } };
}
function apiFakes({ mainSha, runs = [run(2, 'failure', 20), run(1, 'success', 10)], openPrs = [] }) {
  const writes = [];
  const claims = [];
  const notFound = () => Object.assign(new Error('GitHub GET failed (HTTP 404)'), { status: 404 });
  const gh = {
    get: async (p) => {
      if (p.startsWith('actions/workflows/ci.yml/runs')) return { workflow_runs: runs };
      if (p.startsWith('pulls?state=open')) return openPrs;
      if (p === 'git/ref/heads/main') return { object: { sha: mainSha } };
      if (p.startsWith(`git/ref/heads/${BRANCH_PREFIX}`)) throw notFound();
      throw new Error(`unexpected GET ${p}`);
    },
  };
  const app = {
    get: async (p) => { if (p.startsWith('issues/900/comments')) return []; throw new Error(`unexpected app GET ${p}`); },
    post: async (p, b) => { writes.push(['post', p, b]); return p === 'pulls' ? { number: 7777 } : {}; },
    patch: async (p, b) => { writes.push(['patch', p, b]); return {}; },
    put: async (p, b) => { writes.push(['put', p, b]); return {}; },
    del: async (p) => { writes.push(['del', p]); return null; },
  };
  const claim = async (o) => { claims.push(o); return 0; };
  return { gh, app, claim, writes, claims };
}

test('#6477: apply opens ONE PR on its own repair/ branch, labelled main-repair, linked, naming the suspected commit', async () => {
  const f = fixture();
  const io = await inputs({ decision: 'repair', base: f.red, firstRed: { head_sha: f.red, complete: true, pr: 5001 } },
    [[SRC, 'export const a = 2;\n', 'export const a = 1;\n']]);
  const fakes = apiFakes({ mainSha: f.red });
  let pushed = null;
  const out = await applyStage(io.env, { gh: fakes.gh, app: fakes.app, clone: cloneFrom(f), claim: fakes.claim, pushImpl: (dir, repo, token, ref) => {
    pushed = { ref, file: readFileSync(join(dir, SRC), 'utf8'), message: execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' }),
      parent: execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: dir, encoding: 'utf8' }).trim() };
    return true;
  } });
  assert.equal(out.outcome, 'opened', JSON.stringify(out));
  assert.equal(pushed.ref, `${BRANCH_PREFIX}${f.red.slice(0, 10)}`, 'its own repair/ branch, never main');
  assert.equal(pushed.parent, f.red);
  assert.equal(pushed.file, 'export const a = 1;\n');
  assert.match(pushed.message, /Landing-Bot-Kind: main-repair\nLanding-Bot-Provider: claude/);
  const prs = fakes.writes.filter((w) => w[1] === 'pulls');
  assert.equal(prs.length, 1, 'exactly one PR');
  assert.equal(prs[0][2].base, 'main');
  assert.match(prs[0][2].body, /^Part of #900/);
  assert.ok(prs[0][2].body.includes(`Suspected commit: \`${f.red}\` (#5001)`));
  assert.match(prs[0][2].body, /owner lands this PR/);
  assert.match(prs[0][2].body, /@​someone/, 'log text never notifies anyone');
  assert.deepEqual(fakes.writes.find((w) => w[1] === 'issues/7777/labels')[2], { labels: ['main-repair'] });
  const comment = fakes.writes.find((w) => w[1] === 'issues/900/comments');
  assert.ok(comment[2].body.startsWith(STICKY_MARKER));
  assert.match(comment[2].body, /#7777/);
  // Never queued, never merged, never auto-merge.
  assert.ok(!fakes.writes.some((w) => /merge|queue|auto/i.test(w[1])), JSON.stringify(fakes.writes.map((w) => w[1])));
  assert.deepEqual(fakes.claims.map((c) => [c.command, c.issue, c.session]), [['release', 900, 'main-repair-4242']]);
});

test('#6477: a refused patch falls back to a plain revert of the first red commit', async () => {
  const f = fixture();
  const io = await inputs({ decision: 'repair', base: f.red, firstRed: { head_sha: f.red, complete: true, pr: 5001 } },
    [[TEST_FILE, "test('validates a stage', () => {});\n", '// skipped\n']]);
  const fakes = apiFakes({ mainSha: f.red });
  let pushed = null;
  const out = await applyStage(io.env, { gh: fakes.gh, app: fakes.app, clone: cloneFrom(f), claim: fakes.claim, pushImpl: (dir, repo, token, ref) => {
    pushed = { ref, file: readFileSync(join(dir, SRC), 'utf8'), test: readFileSync(join(dir, TEST_FILE), 'utf8'), message: execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' }) };
    return true;
  } });
  assert.deepEqual([out.outcome, out.how], ['opened', 'revert']);
  assert.equal(pushed.file, 'export const a = 1;\n', 'the red commit is reverted');
  assert.equal(pushed.test, "test('validates a stage', () => {});\n", 'the test is untouched');
  assert.match(pushed.message, new RegExp(`This reverts commit ${f.red}`));
  assert.match(fakes.writes.find((w) => w[1] === 'pulls')[2].body, /plain revert/);
});

test('#6477: a revert that contains a migration hands the issue back: comment, claim released, needs-session', async () => {
  const f = fixture({ red: { [SRC]: 'export const a = 2;\n', 'cloudflare-worker/sql/migrations/202611180000_6477_x.sql': 'ALTER TABLE x ADD y;\n' } });
  const io = await inputs({ decision: 'revert', reasons: ['2 attempts on the fingerprint, the most is 2'], firstRed: { head_sha: f.red, complete: true } });
  const fakes = apiFakes({ mainSha: f.red });
  let pushes = 0;
  const out = await applyStage(io.env, { gh: fakes.gh, app: fakes.app, clone: cloneFrom(f), claim: fakes.claim, pushImpl: () => { pushes += 1; return true; } });
  assert.equal(out.outcome, 'handed_back');
  assert.match(out.cause, /contains a migration/);
  assert.equal(pushes, 0);
  assert.ok(!fakes.writes.some((w) => w[1] === 'pulls'));
  assert.deepEqual(fakes.writes.find((w) => w[1] === 'issues/900/labels')[2], { labels: ['needs-session'] });
  assert.deepEqual(fakes.claims.map((c) => c.command), ['release']);
});

test('#6477: the repair issue is the trusted main-red alert, else D6387\'s CI-on-main issue', () => {
  const spoof = { ...ISSUE, number: 1, user: { login: 'someone' } };
  const ci = { number: 950, state: 'open', title: '[Actions] .github/workflows/ci.yml failure on main', user: { login: 'github-actions[bot]' }, labels: [{ name: 'workflow-failure' }] };
  assert.equal(findRepairIssue([spoof, ci, ISSUE]).number, 900);
  assert.equal(findRepairIssue([spoof, ci]).number, 950);
  assert.equal(findRepairIssue([spoof]), null);
  assert.equal(findRepairIssue([{ ...ISSUE, user: { login: 'guillaumelauzier' }, title: '[alert] main is red: guard at abc' }]).number, 900);
});

test('#6477: the first red push, the fingerprint and the verify commands', () => {
  const runs = [run(4, 'failure', 40), run(3, 'cancelled', 30), run(2, 'failure', 20), run(1, 'success', 10)];
  assert.deepEqual([firstRedRun(runs, REPO).run.id, firstRedRun(runs, REPO).complete], [2, true]);
  assert.equal(firstRedRun(runs.slice(0, 3), REPO).complete, false, 'no green run read: the streak may start earlier');
  assert.equal(firstRedRun([run(1, 'success', 1)], REPO), null);
  // The suite part a test lands in does not change its fingerprint.
  assert.equal(fingerprintOf([{ job: 'suite (frontend-2-of-2)', kind: 'test', file: TEST_FILE, what: 'validates a stage' }]), FP);
  assert.deepEqual(VERIFY.slice(3), [['npm', 'run', 'test:types'], ['node', '--import', './frontend/test/_deck-loader.mjs', '--test', TEST_FILE]]);
  assert.equal(VERIFY.length, 5);
  assert.deepEqual(argvOf("npx --no-install eslint --no-warn-ignored 'frontend/src/a b.js'"), ['npx', '--no-install', 'eslint', '--no-warn-ignored', 'frontend/src/a b.js']);
  for (const bad of ['node a.mjs && curl x', 'node $(id)', 'bash -c x', 'node a.mjs; rm -rf /', 'node `x`', 'node a | b']) assert.equal(argvOf(bad), null, bad);
  assert.equal(verifyFor([{ reproduce: 'bash x.sh' }]), null);
  assert.equal(decide(ctx({ verify: null })).decision, 'revert', 'no failing command to verify with: no model');
  assert.equal(decide(ctx({ allowed: [] })).decision, 'revert', 'no file the bot may edit: no model');
  assert.match(prBody({ issue: 900, firstRed: { head_sha: 'f'.repeat(40) }, run: { id: 2 }, repo: REPO, rows: [] }, { how: 'revert' }), /Part of #900[\s\S]*Suspected commit: `f{40}`/);
});

test('#6477: the workflow: trigger gate, a model job with no write, an apply job with no model secret, C1\'s guard passes', () => {
  assertWorkflow(WORKFLOW_PATH);
  const { top, jobs } = parseJobs(WORKFLOW);
  const job = (id) => jobs.find((j) => j.id === id);
  const text = (id) => job(id).lines.join('\n');
  // The trigger: no workflow_run (WF-4) and no pull_request; a sweep and a dispatch, one at a time.
  assert.doesNotMatch(top, /^\s*(?:workflow_run|pull_request|pull_request_target|issue_comment|push):/m);
  assert.match(top, /schedule:/);
  assert.match(top, /workflow_dispatch:/);
  assert.match(top, /concurrency:\n\s+group: main-repair\n\s+cancel-in-progress: false/);
  assert.match(top, /^permissions: \{\}$/m);
  // The gate: this repository, main's own copy, the bot switched on; then a push to main from this repository in code.
  assert.match(text('plan'), /github\.repository == 'AxalNetwork\/StudioOS' && github\.ref == 'refs\/heads\/main'/);
  assert.match(text('plan'), /vars\.LANDING_BOT_ENABLED == 'true'/);
  assert.match(MODULE, /r\.event === 'push' && r\.head_branch === 'main' && r\.head_repository\?\.full_name === repo/);
  // The model job: the runner, no GitHub write, no secret.
  assert.match(text('repair'), /uses: \.\/\.github\/workflows\/landing-bot-model\.yml/);
  assert.match(text('repair'), /ref: main/);
  assert.doesNotMatch(text('repair'), /(?:contents|pull-requests|issues|actions|checks|statuses|packages|deployments): write/);
  assert.doesNotMatch(text('repair'), /secrets/);
  assert.doesNotMatch(text('plan'), /permission-(?:contents|pull-requests|issues): write/, 'the plan token reads metadata only');
  // The apply job: the App token, no model key, main's scripts only, never the patch's code.
  assert.equal(job('apply').environment, 'landing-bot');
  assert.equal(job('claim').environment, 'landing-bot');
  assert.doesNotMatch(text('apply'), /ANTHROPIC|OPENAI|GEMINI|LANDING_BOT_MODEL/);
  assert.match(text('apply'), /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(text('apply'), /npm (?:ci|install|run)|node (?!scripts\/landing-bot\/mainRepair\.mjs)/);
  for (const j of jobs) for (const s of j.steps) assert.doesNotMatch(s.split('\n').filter((l) => /^\s*run:/.test(l)).join('\n'), /\$\{\{/, `job ${j.id}: no expression inside a run script`);
  // It never queues or merges, and never writes a workflow file.
  for (const src of [WORKFLOW, MODULE]) {
    assert.doesNotMatch(src, /enqueuePullRequest|\/merge['"`]|auto_merge|gh pr merge|--auto\b|enablePullRequestAutoMerge/);
  }
  assert.match(MODULE, /const branch = `\$\{BRANCH_PREFIX\}/);
});

// ------------------------------------------------------------------ the plan and claim jobs, with stub reads

const LOG = [
  '2026-11-18T10:21:00.0000000Z ##[group]Run node scripts/test-drift-parts.mjs frontend-1-of-2',
  'not ok 4 - validates a stage',
  '  ---',
  "  location: '/home/runner/work/StudioOS/StudioOS/frontend/test/validate.test.mjs:3:1'",
  "  failureType: 'testCodeFailure'",
  "  error: 'Expected values to be strictly equal'",
  '  ...',
  '##[error]Process completed with exit code 1.',
].join('\n');

function planFakes({ openPrs = [], claimRef = null, runs = [run(2, 'failure', 20), run(1, 'success', 10)], artifacts = [] } = {}) {
  const reads = [];
  const red = runs[0].head_sha;
  const gh = {
    get: async (p) => {
      reads.push(p);
      if (p.startsWith('actions/workflows/ci.yml/runs')) return { workflow_runs: runs };
      if (p.startsWith(`actions/runs/${runs[0].id}/jobs`)) return { jobs: RED_JOBS.map((j) => ({ ...j, id: 11 })) };
      if (p.startsWith('issues?state=open')) return [ISSUE];
      if (p === 'git/ref/heads/claim/900') { if (claimRef) return { object: { sha: 'c'.repeat(40) } }; throw Object.assign(new Error('404'), { status: 404 }); }
      if (p === `git/commits/${'c'.repeat(40)}`) return { message: JSON.stringify(claimRef) };
      if (p.startsWith('pulls?state=open')) return openPrs;
      if (p === `commits/${red}`) return { sha: red, commit: { message: 'Break validate (#5001)' }, parents: [{}], files: [{ filename: SRC, status: 'modified' }] };
      if (p.startsWith('actions/artifacts?name=')) return { artifacts };
      if (p.startsWith('pulls?state=all')) return [];
      throw new Error(`unexpected GET ${p}`);
    },
  };
  return { gh, reads };
}
const planEnv = () => ({ ...ENV, GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'schedule', RUNNER_TEMP: mkdtempSync(join(tmpdir(), 'main-repair-plan-')), LANDING_BOT_LOGIN: BOT });

test('#6477: plan triages the red run into a model task on main: the failing test, its command and the typecheck', async () => {
  const { gh } = planFakes();
  const plan = await planStage(planEnv(), { gh, now: NOW, logs: async () => LOG, root: new URL('.', ROOT).pathname });
  assert.equal(plan.decision, 'repair', JSON.stringify(plan.reasons));
  assert.equal(plan.issue, 900);
  assert.deepEqual(plan.task.allowed_files, [SRC]);
  assert.deepEqual(plan.task.verify.slice(3), [['npm', 'run', 'test:types'], ['node', '--import', './frontend/test/_deck-loader.mjs', '--test', TEST_FILE]]);
  assert.equal(plan.fingerprint, FP);
  assert.deepEqual(plan.failingTests, [TEST_FILE]);
  assert.deepEqual([plan.firstRed.head_sha, plan.firstRed.complete, plan.firstRed.pr], [run(2, 'failure', 20).head_sha, true, 5001]);
  assert.match(plan.task.data['failure.txt'], /validates a stage/);
});

test('#6477: plan reads nothing more on a green main, and comments when a session holds the claim', async () => {
  const green = planFakes({ runs: [run(3, 'success', 30), run(2, 'failure', 20)] });
  assert.equal((await planStage(planEnv(), { gh: green.gh, now: NOW, logs: async () => LOG })).decision, 'skip');
  assert.deepEqual(green.reads.map((p) => p.split('?')[0]), ['actions/workflows/ci.yml/runs'], 'only the run list');
  const held = planFakes({ claimRef: { version: 1, issue: 900, slot: 'S07', agent: 'claude', session: 's', at: '2026-11-18T11:00:00Z', ttlHours: 24 } });
  const plan = await planStage(planEnv(), { gh: held.gh, now: NOW, logs: async () => LOG });
  assert.equal(plan.decision, 'comment');
  assert.match(plan.reasons.join(), /claimed by claude \(S07\)/);
  assert.ok(!held.reads.some((p) => p.startsWith('actions/artifacts')), 'no budget read for a repair it will not make');
});

test('#6477: claim posts the one diagnosis comment and stops, or claims the issue before any model call', async () => {
  const stage = async (plan, code = 0) => {
    const tmp = mkdtempSync(join(tmpdir(), 'main-repair-claim-'));
    writeFileSync(join(tmp, 'plan.json'), JSON.stringify({ repo: REPO, issue: 900, run: { id: 2, head_sha: 'a'.repeat(40) }, rows: [], ...plan }));
    const fakes = apiFakes({ mainSha: 'a'.repeat(40) });
    const calls = [];
    const r = await claimStage({ GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '4242', LANDING_BOT_ENABLED: 'true', LANDING_BOT_LOGIN: BOT, PLAN_DIR: tmp }, {
      app: fakes.app, claim: async (o) => { calls.push(o); return code; },
    });
    return { r, calls, writes: fakes.writes };
  };
  const taken = await stage({ decision: 'comment', reasons: ['repair PR #5002 is open'] });
  assert.deepEqual([taken.r.go, taken.calls.length], [false, 0]);
  assert.deepEqual(taken.writes.map((w) => w.slice(0, 2)), [['post', 'issues/900/comments']], 'one comment, no label, no claim');
  assert.match(taken.writes[0][2].body, /no second repair/);
  const go = await stage({ decision: 'repair', reasons: [] });
  assert.equal(go.r.go, true);
  assert.deepEqual(go.calls.map((c) => [c.command, c.issue, c.slot, c.agent, c.session]), [['claim', 900, 'bot', 'landing-bot', 'main-repair-4242']]);
  assert.deepEqual(go.writes.find((w) => w[1] === 'issues/900/labels')[2], { labels: ['state:in-progress'] });
  const lost = await stage({ decision: 'repair', reasons: [] }, 3);
  assert.equal(lost.r.go, false, 'someone claimed it first: the bot steps aside');
  assert.ok(!lost.writes.some((w) => w[1] === 'issues/900/labels'));
  assert.equal((await stage({ decision: 'skip', reasons: [] })).r.go, false);
});

test('#8506: a good patch whose record names another attempt or controller is refused, and main repair falls back to the revert', async () => {
  // Mutation checked: removing publishRecordProblems from mainRepair's apply opens the model's patch instead.
  for (const [name, plan, env] of [
    ['a second attempt reusing the first attempt\'s patch', { record: { run_attempt: '1' } }, { GITHUB_RUN_ATTEMPT: '2' }],
    ['the publish step runs another controller', {}, { GITHUB_SHA: 'e'.repeat(40) }],
    ['a record naming another edited main', { record: { head_sha: 'b'.repeat(40) } }, {}],
  ]) {
    const f = fixture();
    const io = await inputs({ decision: 'repair', base: f.red, firstRed: { head_sha: f.red, complete: true, pr: 5001 }, ...plan },
      [[SRC, 'export const a = 2;\n', 'export const a = 1;\n']]);
    const fakes = apiFakes({ mainSha: f.red });
    const out = await applyStage({ ...io.env, ...env }, { gh: fakes.gh, app: fakes.app, clone: cloneFrom(f), claim: fakes.claim, pushImpl: () => true });
    assert.deepEqual([out.outcome, out.how], ['opened', 'revert'], name);
  }
});
