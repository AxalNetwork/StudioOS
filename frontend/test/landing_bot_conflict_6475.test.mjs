/**
 * #6475: the conflict resolver. Real git repositories for the merge and the push decision; stub model providers for
 * the runner in merge mode; plain data for the rules; the workflow as text.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sidesOf, stageMain, stageMerge } from '../../scripts/landing-bot/model/stage.mjs';
import { editMain } from '../../scripts/landing-bot/model/edit.mjs';
import { verifyMain } from '../../scripts/landing-bot/model/verify.mjs';
import { parseTask } from '../../scripts/landing-bot/model/task.mjs';
import {
  addedLines, afterStage, checkResolution, checkResolvedFile, conflictLines, gate, namesModule, reservedToday, testsFor, verifyCommands,
} from '../../scripts/landing-bot/resolve-rules.mjs';
import { applyStage, output, runsOf } from '../../scripts/landing-bot/resolve.mjs';
import { gitIn } from '../../scripts/landing-bot/keeper-merge.mjs';
import { assertWorkflow, parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';
// #8506: the run every edit and verify call in this file belongs to, and the controller commit it ran.
const IDENT = { repository: 'AxalNetwork/StudioOS', run_id: '7001', run_attempt: '1' };
const CTRL = 'c'.repeat(40);
import { pathGuard, STICKY_MARKER } from '../../scripts/landing-bot/rules.mjs';

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = readFileSync(new URL('.github/workflows/landing-bot-conflict.yml', ROOT), 'utf8');
const KEEPER = readFileSync(new URL('.github/workflows/landing-bot-keeper.yml', ROOT), 'utf8');
const FILE = 'frontend/src/pages/validate.js';
const BASE = 'export const fields = {\n  name: 1,\n};\n';
const PR = 'export const fields = {\n  name: 1,\n  stage: 2,\n};\n';
const MAIN = 'export const fields = {\n  name: 1,\n  owner: 3,\n};\n';
const BOTH = 'export const fields = {\n  name: 1,\n  stage: 2,\n  owner: 3,\n};\n';

/** A repo with main and a PR branch that both edited FILE at the same line; HEAD is the PR head. */
function fixture({ base = { [FILE]: BASE }, main = { [FILE]: MAIN }, pr = { [FILE]: PR }, remove = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resolver-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (files) => { for (const [p, t] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), t); } };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write({ '.gitattributes': 'README.md merge=union\n', ...base }); git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'pr'); write(pr); for (const p of remove) git('rm', '-q', p); git('add', '-A'); git('commit', '-qm', 'pr');
  git('checkout', '-q', 'main'); write(main); git('add', '-A'); git('commit', '-qm', 'main (#9001)');
  const mainSha = git('rev-parse', 'main');
  git('checkout', '-q', '--detach', 'pr');
  return { dir, git, mainSha, head: git('rev-parse', 'HEAD') };
}

test('#6475: the merge is staged with markers, the same in every job, and a one-sided conflict is refused', () => {
  const f = fixture();
  const st = stageMerge(f.dir, { mainSha: f.mainSha, headSha: f.head });
  assert.equal(st.ok, true, JSON.stringify(st));
  assert.deepEqual(st.conflicted, [FILE]);
  const marked = readFileSync(join(f.dir, FILE), 'utf8');
  assert.match(marked, /^<{7} HEAD\n {2}stage: 2,\n={7}\n {2}owner: 3,\n>{7} [0-9a-f]{40}\n/m);
  assert.equal(conflictLines(marked), 2);
  assert.deepEqual(sidesOf(f.dir, FILE), { base: BASE, ours: PR, theirs: MAIN });
  // A second staging of the same two commits gives byte-identical markers: the hash re-check depends on it.
  const g = fixture();
  stageMerge(g.dir, { mainSha: g.mainSha, headSha: g.head });
  assert.equal(readFileSync(join(g.dir, FILE), 'utf8').replace(/[0-9a-f]{40}/, ''), marked.replace(/[0-9a-f]{40}/, ''));
  // The wrong head, and a conflict where one side deleted the file, are refused before any model call.
  assert.match(stageMerge(fixture().dir, { mainSha: f.mainSha, headSha: 'f'.repeat(40) }).reason, /not the expected head/);
  const d = fixture({ pr: {}, remove: [FILE] });
  const del = stageMerge(d.dir, { mainSha: d.mainSha, headSha: d.head });
  assert.equal(del.ok, false);
  assert.match(del.reason, /deleted or renamed/);
  const clean = fixture({ main: { 'frontend/src/pages/other.js': 'x\n' } });
  assert.match(stageMerge(clean.dir, { mainSha: clean.mainSha }).reason, /without a conflict/);
});

test('#6475: a resolution keeps every line both sides added, or it is refused', () => {
  const f = { path: FILE, base: BASE, ours: PR, theirs: MAIN };
  assert.deepEqual(addedLines(BASE, PR), ['stage: 2,']);
  assert.deepEqual(checkResolvedFile({ ...f, result: BOTH }), []);
  assert.deepEqual(checkResolvedFile({ ...f, result: 'export const fields = {\n  name: 1,\n  owner: 3,\n  stage: 2,\n};\n' }), [], 'either order');
  // Keeping only one side.
  assert.match(checkResolvedFile({ ...f, result: PR }).join(), /line\(s\) main added are missing/);
  assert.match(checkResolvedFile({ ...f, result: MAIN }).join(), /line\(s\) the PR added are missing/);
  // Leaving the markers.
  assert.match(checkResolvedFile({ ...f, result: `${BOTH}<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> m\n` }).join(), /conflict markers are left/);
  // Deleting the file.
  assert.match(checkResolvedFile({ ...f, result: null }).join(), /deletes the file/);
});

test('#6475: a resolution that drops a test or an assertion, or adds a skip, is refused', () => {
  const base = "test('a', () => {\n  assert.equal(a(), 1);\n});\n";
  const ours = `${base}test('b', () => {\n  assert.equal(b(), 2);\n});\n`;
  const theirs = `${base}test('c', () => {\n  assert.equal(c(), 3);\n});\n`;
  const both = `${base}test('b', () => {\n  assert.equal(b(), 2);\n});\ntest('c', () => {\n  assert.equal(c(), 3);\n});\n`;
  const f = { path: 'frontend/src/lib/cases.js', base, ours, theirs };
  assert.deepEqual(checkResolvedFile({ ...f, result: both }), []);
  // An assertion removed: its added line is missing.
  assert.match(checkResolvedFile({ ...f, result: both.replace('  assert.equal(c(), 3);\n', '') }).join(), /main added are missing/);
  // Both sides added the same one-line test in different places: keeping it once leaves every line present, but
  // drops a test. The count catches it.
  const smoke = { path: f.path, base: "test('a', a);\n", ours: "test('smoke', smoke);\ntest('a', a);\n", theirs: "test('a', a);\ntest('smoke', smoke);\n" };
  assert.deepEqual(checkResolvedFile({ ...smoke, result: "test('smoke', smoke);\ntest('a', a);\ntest('smoke', smoke);\n" }), []);
  assert.match(checkResolvedFile({ ...smoke, result: "test('smoke', smoke);\ntest('a', a);\n" }).join(), /2 test calls, fewer than the 3/);
  assert.match(checkResolvedFile({ ...f, result: both.replace("test('c'", "test.skip('c'") }).join(), /adds a skip, only or todo/);
  assert.match(checkResolvedFile({ ...f, result: both.replace("test('c', () => {", "test('c', { skip: true }, () => {") }).join(), /adds a skip, only or todo/);
});

test('#6475: only the conflicted files: one more, or one fewer, is refused', () => {
  const ok = { path: FILE, base: BASE, ours: PR, theirs: MAIN, result: BOTH };
  assert.deepEqual(checkResolution([ok], [FILE]), []);
  assert.match(checkResolution([ok, { ...ok, path: 'frontend/src/pages/other.js' }], [FILE]).join(), /other\.js is not a conflicted file/);
  assert.match(checkResolution([], [FILE]).join(), /left unresolved/);
});

test('#6475: a conflicted test, a protected file or an oversized conflict is refused before any model call', () => {
  const env = { LANDING_BOT_MAX_CONFLICT_FILES: '3', LANDING_BOT_MAX_CONFLICT_LINES: '40' };
  const stage = (files) => ({ ok: true, conflicted: files });
  assert.equal(pathGuard([{ path: FILE }]).ok, true, 'the fixture file is one a bot may write');
  assert.deepEqual(afterStage({ env, stage: stage([FILE]), sizes: { [FILE]: 2 } }), { decision: 'resolve', reasons: [], files: [FILE] });
  for (const p of ['frontend/test/landing_bot_keeper_6474.test.mjs', '.github/workflows/ci.yml', 'cloudflare-worker/sql/migrations/1.sql', 'package-lock.json']) {
    const d = afterStage({ env, stage: stage([p]), sizes: { [p]: 1 } });
    assert.equal(d.decision, 'handback', p);
  }
  assert.match(afterStage({ env, stage: stage([FILE, 'frontend/src/pages/b.js', 'frontend/src/pages/c.js', 'frontend/src/pages/d.js']), sizes: {} }).reasons.join(), /4 conflicted files, above LANDING_BOT_MAX_CONFLICT_FILES \(3\)/);
  assert.match(afterStage({ env, stage: stage([FILE]), sizes: { [FILE]: 41 } }).reasons.join(), /41 conflicted lines/);
  // Unset caps are 0: closed by default.
  assert.equal(afterStage({ env: {}, stage: stage([FILE]), sizes: { [FILE]: 1 } }).decision, 'handback');
  assert.equal(afterStage({ env, stage: { ok: false, reason: 'one side deleted or renamed a conflicted file' } }).decision, 'handback');
});

const NOW = Date.parse('2026-11-17T12:00:00Z');
const REPO = 'AxalNetwork/StudioOS';
const prOf = (over = {}) => ({
  number: 77, state: 'open', draft: false, body: 'Closes #66', title: 'Add a field', labels: [{ name: 'conflict' }],
  head: { ref: 'agent/x/66-field', sha: 'a'.repeat(40), repo: { full_name: REPO } }, base: { repo: { full_name: REPO } },
  files: [{ path: FILE }], commits: [], ...over,
});
const gateCtx = (over = {}) => ({
  env: { LANDING_BOT_ENABLED: 'true', LANDING_BOT_DAILY_MODEL_RUNS: '5', LANDING_BOT_DAILY_PUSHES: '5' },
  event: 'workflow_dispatch', dispatchPr: 77, repo: REPO, breakers: { open: false, reasons: [] }, botLogin: 'landing-bot[bot]', now: NOW,
  runs: [], reserved: [], ...over,
});

test('#6475: the third attempt and an exhausted budget hand back; the bot off, bot:off or a breaker stop quietly', () => {
  assert.equal(gate(prOf(), gateCtx()).decision, 'resolve');
  const two = [{ kind: 'conflict', pr: 77, status: 'completed', created_at: '2026-11-10T00:00:00Z' }, { kind: 'conflict', pr: 77, status: 'completed', created_at: '2026-11-11T00:00:00Z' }];
  const third = gate(prOf(), gateCtx({ runs: two }));
  assert.deepEqual([third.decision, /2 conflict attempts/.test(third.reasons.join())], ['handback', true]);
  const over = gate(prOf(), gateCtx({ reserved: Array.from({ length: 5 }, () => ({ at: '2026-11-17T01:00:00Z' })) }));
  assert.equal(over.decision, 'handback');
  assert.match(over.reasons.join(), /LANDING_BOT_DAILY_MODEL_RUNS: 5 of 5 used today/);
  assert.equal(gate(prOf(), gateCtx({ reserved: null })).decision, 'handback', 'an unreadable budget refuses');
  for (const [ctx, pr] of [
    [gateCtx({ env: {} }), prOf()],
    [gateCtx(), prOf({ labels: [{ name: 'bot:off' }] })],
    [gateCtx({ breakers: { open: true, reasons: ['main is red'] } }), prOf()],
  ]) assert.equal(gate(pr, ctx).decision, 'skip');
  // Attempts are counted from the run names, which a session cannot rewrite.
  assert.deepEqual(runsOf([{ id: 1, display_title: 'Conflict resolver for #77', status: 'completed', created_at: 'x' }, { id: 2, display_title: 'Conflict resolver for #77' }, { id: 3, display_title: 'other' }], 2),
    [{ kind: 'conflict', pr: 77, status: 'completed', created_at: 'x' }]);
  assert.deepEqual(reservedToday(new Map([[9, [{ name: 'landing-bot-conflict-2026-11-17-9-1' }, { name: 'landing-bot-conflict-2026-11-16-9-1' }]]]), '2026-11-17').length, 1);
});

test('#6475: verify runs the installs, a typecheck or build for the side touched, and the tests that import the file', () => {
  const tests = testsFor([FILE, 'cloudflare-worker/src/routes/cycle_validate.ts'], {
    'frontend/test/validate_page.test.mjs': "import { fields } from '../src/pages/validate.js';",
    'frontend/test/other.test.mjs': "import x from '../src/pages/other.js';",
    'cloudflare-worker/test/cycle_validate_123.test.ts': "import r from '../src/routes/cycle_validate.ts';",
    'frontend/test/_loader.mjs': "'/validate.js'",
  });
  assert.deepEqual(tests, { worker: ['cloudflare-worker/test/cycle_validate_123.test.ts'], frontend: ['frontend/test/validate_page.test.mjs'] });
  const cmds = verifyCommands([FILE, 'cloudflare-worker/src/routes/cycle_validate.ts'], tests);
  assert.equal(cmds.length, 6);
  assert.deepEqual(cmds.slice(3, 5), [['npm', 'run', 'test:types'], ['npm', 'run', 'build']]);
  for (const c of cmds) assert.ok(['node', 'npm', 'npx'].includes(c[0]));
});

test('#6475: a test names a module only as a quoted specifier, and a file name never becomes a pattern', () => {
  assert.equal(namesModule("import x from '../src/pages/validate.js';", 'validate'), true);
  assert.equal(namesModule('import x from "validate";', 'validate'), true);
  assert.equal(namesModule("import x from '../src/pages/validate.test.js';", 'validate'), false, 'a longer name is another module');
  assert.equal(namesModule("import x from '../src/pages/prevalidate.js';", 'validate'), false);
  assert.equal(namesModule("validate.js'", 'validate'), false, 'no opening quote or slash at the start of the text');
  assert.equal(namesModule("import x from '../a/(a+)+$.js';", '(a+)+$'), true, 'regex characters in a stem are plain text');
  assert.equal(namesModule('x', ''), false);
});

/** A stub provider that does what a model would through the runner's tools. */
const stub = (script) => ({ name: 'claude', model: 'claude-stub', available: true, async run({ call }) { call.turn(); script(call); return { stop: 'done' }; } });

test('#6475: the runner in merge mode edits and verifies the conflicted tree, and refuses a patch that leaves markers', async () => {
  const f = fixture();
  const out = mkdtempSync(join(tmpdir(), 'resolver-out-'));
  const taskOf = (over = {}) => ({ version: 1, instructions: 'Resolve', allowed_files: [FILE], verify: [['node', '-e', `const t=require('fs').readFileSync('${FILE}','utf8'); if(!t.includes('stage')||!t.includes('owner')) process.exit(1)`]], merge_sha: f.mainSha, head_sha: f.head, ...over });
  assert.equal(parseTask(taskOf()).task.merge_sha, f.mainSha);
  assert.match(parseTask(taskOf({ merge_sha: 'main' })).errors.join(), /merge_sha is not a full commit SHA/);
  assert.match(parseTask(taskOf({ merge_sha: undefined })).errors.join(), /head_sha is read only in merge mode/);

  writeFileSync(join(out, 'task.json'), JSON.stringify(taskOf()));
  const lazy = stub((call) => call.tool('replace_in_file', { path: FILE, old_text: '  stage: 2,\n', new_text: '  stage: 2, // kept\n' }));
  // Without the stage report, merge mode refuses before any model call.
  let calls = 0;
  const counting = stub(() => { calls += 1; });
  const r0 = await editMain({ task: join(out, 'task.json'), work: f.dir, out: join(out, 'z'), round: '1', base: f.head, controller: CTRL }, { identity: IDENT, env: {}, providers: { claude: counting } });
  assert.deepEqual([r0.outcome, calls], ['no_patch', 0]);
  assert.match(r0.reason, /the merge was not staged/);
  // The stage step, in its own process in the workflow, writes the report the edit checks.
  stageMain({ task: join(out, 'task.json'), work: f.dir, out: join(out, 'stage-f.json') });
  const r1 = await editMain({ task: join(out, 'task.json'), work: f.dir, out: join(out, 'a'), round: '1', base: f.head, controller: CTRL, stage: join(out, 'stage-f.json') }, { identity: IDENT, env: {}, providers: { claude: lazy } });
  assert.equal(r1.outcome, 'no_patch');
  assert.match(r1.problems.join(), /leaves conflict markers/);

  const g = fixture();
  writeFileSync(join(out, 'task2.json'), JSON.stringify({ ...taskOf(), merge_sha: g.mainSha, head_sha: g.head }));
  const good = stub((call) => call.tool('write_file', { path: FILE, content: BOTH }));
  stageMain({ task: join(out, 'task2.json'), work: g.dir, out: join(out, 'stage-g.json') });
  const r2 = await editMain({ task: join(out, 'task2.json'), work: g.dir, out: join(out, 'b'), round: '1', base: g.head, controller: CTRL, stage: join(out, 'stage-g.json') }, { identity: IDENT, env: {}, providers: { claude: good } });
  assert.deepEqual([r2.outcome, r2.files], ['patched', [FILE]]);
  // Verify stages the same merge in a fresh checkout, re-checks the before-hash, applies the patch and runs.
  const h = fixture();
  execFileSync('git', ['checkout', '-q', '--detach', h.head], { cwd: h.dir });
  const sameMain = JSON.parse(readFileSync(join(out, 'task2.json'), 'utf8'));
  writeFileSync(join(out, 'task3.json'), JSON.stringify({ ...sameMain, merge_sha: h.mainSha, head_sha: h.head }));
  const patch = JSON.parse(readFileSync(join(out, 'b', 'patch.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(out, 'b', 'manifest.json'), 'utf8'));
  const relabel = (s) => s.replaceAll(g.head, h.head);
  mkdirSync(join(out, 'c'), { recursive: true });
  writeFileSync(join(out, 'c', 'patch.json'), relabel(JSON.stringify(patch)));
  // #8506: the record the edit job would have written for this head, run and controller.
  const { recordFor } = await import('../../scripts/landing-bot/model/record.mjs');
  const relabelled = relabel(JSON.stringify(patch));
  writeFileSync(join(out, 'c', 'record.json'), JSON.stringify(recordFor({ identity: IDENT, task: parseTask(readFileSync(join(out, 'task3.json'), 'utf8')).task, controller: CTRL, head: h.head, round: 1, patchText: relabelled })));
  // The before-hash covers the marker line naming main's SHA, so the fixture's own main must match: recompute it.
  const { sha256 } = await import('../../scripts/landing-bot/model/workspace.mjs');
  stageMain({ task: join(out, 'task3.json'), work: h.dir, out: join(out, 'stage-h.json') });
  const before = readFileSync(join(h.dir, FILE), 'utf8');
  writeFileSync(join(out, 'c', 'manifest.json'), relabel(JSON.stringify({ ...manifest, files: manifest.files.map((x) => ({ ...x, before_sha256: sha256(before) })) })));
  const v = verifyMain({ task: join(out, 'task3.json'), work: h.dir, patch: join(out, 'c'), out: join(out, 'v'), stage: join(out, 'stage-h.json'), round: '1', base: h.head, controller: CTRL }, { identity: IDENT, env: process.env });
  assert.equal(v.passed, true, JSON.stringify(v));
  // A stage report of another merge is refused.
  writeFileSync(join(out, 'stage-bad.json'), JSON.stringify({ ok: true, head: h.head, main: 'e'.repeat(40), conflicted: [FILE] }));
  const bad = verifyMain({ task: join(out, 'task3.json'), work: h.dir, patch: join(out, 'c'), out: join(out, 'v2'), stage: join(out, 'stage-bad.json'), round: '1', base: h.head, controller: CTRL }, { identity: IDENT, env: process.env });
  assert.match(bad.problems.join(), /another main commit/);
  // The keyed job's modules still start no process: staging is its own step, never imported by edit.mjs.
  for (const m of ['edit.mjs', 'task.mjs', 'patch.mjs']) assert.doesNotMatch(readFileSync(new URL(`scripts/landing-bot/model/${m}`, ROOT), 'utf8'), /from '\.\/stage\.mjs'|child_process/, m);
});

/** Fakes for the apply job: GitHub reads, the App's writes, and a push that records its call. */
function apiFakes({ pr, heads = [] }) {
  const writes = [];
  const gh = {
    async get(path) {
      if (path === `pulls/${pr.number}`) return { ...pr, head: { ...pr.head, sha: heads.length ? heads.shift() : pr.head.sha } };
      if (path.startsWith('actions/workflows/ci.yml/runs')) return { workflow_runs: [{ event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: '2026-11-17T10:00:00Z' }] };
      if (path.startsWith('issues?state=open')) return [];
      if (path.startsWith('issues/66')) return { number: 66, labels: [{ name: 'slot:S21' }] };
      throw new Error(`unexpected read ${path}`);
    },
    // #8555 (D8555): the stack read answers "not in a stack" for the planned head; landing_bot_native_stacks_8555 covers members.
    graph: async (_q, v) => ({ nameWithOwner: REPO, pullRequest: { number: v.number, headRefOid: pr.head.sha, isDraft: false, isInMergeQueue: false, autoMergeRequest: null, stack: null, stackEntry: null } }),
  };
  const app = {
    async get(path) { if (/\/comments/.test(path)) return []; throw new Error(`unexpected app read ${path}`); },
    async post(path, body) { writes.push(['post', path, body]); return {}; },
    async patch(path, body) { writes.push(['patch', path, body]); return {}; },
    async del(path) { writes.push(['del', path]); return null; },
  };
  return { gh, app, writes };
}

/** The apply job's inputs on disk: the plan, and the model runner's patch for the fixture's merge. */
function applyInputs(f, { content = BOTH, extra = [], decision = 'resolve', reasons = [], record = {} } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'resolver-apply-'));
  mkdirSync(join(tmp, 'plan')); mkdirSync(join(tmp, 'patch'));
  const plan = { pr: 77, head: f.head, ref: 'agent/x/66-field', main: f.mainSha, files: [FILE], decision, reasons, day: '2026-11-17',
    task: { version: 1, instructions: 'resolve', allowed_files: [FILE], verify: [['node', '-e', '0']], merge_sha: f.mainSha, head_sha: f.head, pr: 77 } };
  writeFileSync(join(tmp, 'plan', 'plan.json'), JSON.stringify(plan));
  return { tmp, plan, write: async () => {
    const { sha256 } = await import('../../scripts/landing-bot/model/workspace.mjs');
    const probe = fixture();
    stageMerge(probe.dir, { mainSha: probe.mainSha, headSha: probe.head });
    const before = readFileSync(join(probe.dir, FILE), 'utf8').replace(probe.mainSha, f.mainSha);
    const files = [{ path: FILE, content }, ...extra];
    const patchText = JSON.stringify({ version: 1, base_sha: f.head, files });
    writeFileSync(join(tmp, 'patch', 'patch.json'), patchText);
    // #8506: the record this run's edit job would have written; `record` overrides a field to test a refusal.
    const { recordFor } = await import('../../scripts/landing-bot/model/record.mjs');
    writeFileSync(join(tmp, 'patch', 'record.json'), JSON.stringify({ ...recordFor({ identity: IDENT, task: parseTask(plan.task).task, controller: CTRL, head: f.head, round: 1, patchText }), ...record }));
    writeFileSync(join(tmp, 'patch', 'manifest.json'), JSON.stringify({ version: 1, base_sha: f.head, round: 1, provider: 'claude', model: 'claude-stub',
      files: files.map((x) => ({ path: x.path, before_sha256: x.path === FILE ? sha256(before) : null, after_sha256: sha256(x.content) })) }));
  } };
}
const envFor = (tmp, over = {}) => ({ GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: IDENT.run_id, GITHUB_RUN_ATTEMPT: IDENT.run_attempt, GITHUB_SHA: CTRL, CONTROLLER_SHA: CTRL, RUNNER_TEMP: tmp, PLAN_DIR: join(tmp, 'plan'), PATCH_DIR: join(tmp, 'patch'),
  MODEL_OUTCOME: 'passed', LANDING_BOT_ENABLED: 'true', LANDING_BOT_LOGIN: 'landing-bot[bot]', RESOLVER_APP_TOKEN: 'test-token', ...over });
/** The apply job's clone, from the fixture instead of GitHub. */
const cloneFrom = (f) => (_url, headSha, root) => {
  const dir = mkdtempSync(join(root, 'clone-'));
  execFileSync('git', ['clone', '-q', f.dir, dir]);
  execFileSync('git', ['checkout', '-q', '--detach', headSha], { cwd: dir });
  // The same git the apply job's `cloneFor` hands over: the bot's identity and the safe config. A
  // plain `git` here leaned on the runner's global identity, which CI does not have, so `git merge`
  // refused before it reached the conflict and the three apply tests failed there only.
  return { dir, git: gitIn(dir), main: f.mainSha };
};

test('#6475: apply pushes one normal merge commit of the planned head and main, labelled and described', async () => {
  const f = fixture();
  const inputs = applyInputs(f);
  await inputs.write();
  const { gh, app, writes } = apiFakes({ pr: prOf({ head: { ...prOf().head, sha: f.head } }) });
  let pushed = null;
  const r = await applyStage(envFor(inputs.tmp), { gh, app, clone: cloneFrom(f), pushImpl: (dir, repo, token, ref) => {
    pushed = { ref, parents: execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim().split(' ').slice(1),
      file: readFileSync(join(dir, FILE), 'utf8'), message: execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' }) };
    return true;
  } });
  assert.equal(r.outcome, 'pushed', JSON.stringify(r));
  assert.deepEqual(pushed.parents, [f.head, f.mainSha]);
  assert.equal(pushed.ref, 'agent/x/66-field');
  assert.equal(pushed.file, BOTH);
  assert.match(pushed.message, /Landing-Bot-Kind: conflict\nLanding-Bot-Provider: claude/);
  assert.deepEqual(writes.map((w) => w.slice(0, 2)), [['del', 'issues/77/labels/conflict'], ['post', 'issues/77/labels'], ['post', 'issues/77/comments']]);
  assert.deepEqual(writes[1][2], { labels: ['bot:resolved'] });
  assert.ok(writes[2][2].body.startsWith(STICKY_MARKER));
  assert.match(writes[2][2].body, /```diff[\s\S]*\+ {2}owner: 3,/);
  assert.match(writes[2][2].body, /owner lands a model-resolved pull request/);
});

test('#6475/#8506: a head that moved after verification means no push and a definitive hand-back', async () => {
  const f = fixture();
  const inputs = applyInputs(f);
  await inputs.write();
  // The first read is the job's own; the second, just before staging, sees the moved head.
  const { gh, app, writes } = apiFakes({ pr: prOf({ head: { ...prOf().head, sha: f.head } }), heads: [f.head, 'b'.repeat(40)] });
  let pushes = 0;
  const r = await applyStage(envFor(inputs.tmp), { gh, app, clone: cloneFrom(f), pushImpl: () => { pushes += 1; return true; } });
  // #8506: no longer a quiet skip. The verified merge is not the one a push would make: one label, one comment.
  assert.deepEqual([r.outcome, pushes], ['handed_back', 0]);
  assert.match(r.cause, /head moved after the resolution was verified/);
  assert.deepEqual(writes.map((w) => w.slice(0, 2)), [['post', 'issues/77/labels'], ['post', 'issues/77/comments']]);
  // Moved after the commit, just before the push: still no push.
  const g = fixture();
  const late = applyInputs(g);
  await late.write();
  const fk = apiFakes({ pr: prOf({ head: { ...prOf().head, sha: g.head } }), heads: [g.head, g.head, 'c'.repeat(40)] });
  const r2 = await applyStage(envFor(late.tmp), { gh: fk.gh, app: fk.app, clone: cloneFrom(g), pushImpl: () => { pushes += 1; return true; } });
  assert.deepEqual([r2.outcome, pushes], ['handed_back', 0]);
});

test('#6475: apply hands back, with one label and one comment, a one-sided, extra-file or failed resolution', async () => {
  for (const [name, opts, env, cause] of [
    ['one side', { content: PR }, {}, /main added are missing/],
    ['extra file', { extra: [{ path: 'frontend/src/pages/other.js', content: 'x\n' }] }, {}, /not name|outside the allowed list|not a conflicted file/],
    ['model failed', {}, { MODEL_OUTCOME: 'no_patch' }, /the model could not resolve/],
    ['plan refused', { decision: 'handback', reasons: ['2 conflict attempts on this pull request, the most is 2'] }, {}, /2 conflict attempts/],
  ]) {
    const f = fixture();
    const inputs = applyInputs(f, opts);
    await inputs.write();
    const { gh, app, writes } = apiFakes({ pr: prOf({ head: { ...prOf().head, sha: f.head } }) });
    let pushes = 0;
    const r = await applyStage(envFor(inputs.tmp, env), { gh, app, clone: cloneFrom(f), pushImpl: () => { pushes += 1; return true; } });
    assert.equal(r.outcome, 'handed_back', name);
    assert.match(r.cause, cause, name);
    assert.equal(pushes, 0, name);
    assert.deepEqual(writes.map((w) => w.slice(0, 2)), [['post', 'issues/77/labels'], ['post', 'issues/77/comments']], name);
    assert.deepEqual(writes[0][2], { labels: ['needs-session'] });
    assert.match(writes[1][2].body, /Owning slot: S21 \(from #66\)/);
  }
});

test('#6475: the workflow: resolve has no write, apply has no model secret, no PR trigger, and the keeper dispatches it', () => {
  assertWorkflow('.github/workflows/landing-bot-conflict.yml');
  const { top, jobs } = parseJobs(WORKFLOW);
  assert.doesNotMatch(top, /pull_request/);
  assert.match(top, /workflow_dispatch:/);
  const job = (id) => jobs.find((j) => j.id === id);
  const resolve = job('resolve').lines.join('\n');
  assert.match(resolve, /uses: \.\/\.github\/workflows\/landing-bot-model\.yml/);
  assert.doesNotMatch(resolve, /: write/.source === '' ? /x/ : /(?:contents|pull-requests|issues|actions): write/);
  assert.doesNotMatch(resolve, /secrets/);
  const apply = job('apply').lines.join('\n');
  assert.doesNotMatch(apply, /ANTHROPIC|OPENAI|GEMINI|LANDING_BOT_MODEL/);
  assert.equal(job('apply').environment, 'landing-bot');
  assert.doesNotMatch(job('plan').lines.join('\n'), /permission-(?:contents|pull-requests|issues): write/, 'the plan token reads metadata only');
  for (const j of jobs) for (const s of j.steps) assert.doesNotMatch(s.split('\n').filter((l) => /^\s*run:/.test(l) || /^\s{8,}\S/.test(l) && !/:\s/.test(l)).join('\n'), /\$\{\{/, `job ${j.id}: no expression inside a run script`);
  assert.match(KEEPER, /gh workflow run landing-bot-conflict\.yml/);
});

// Mutation checked: the value written raw (fails); the key check dropped (fails).
test('#6475: an output value from the API is one line, so it cannot add a second output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-output-'));
  const file = join(dir, 'out');
  writeFileSync(file, '');
  const before = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = file;
  try {
    output('ref', 'agent/x\ndecision=resolve');
    assert.equal(readFileSync(file, 'utf8'), 'ref=agent/x decision=resolve\n');
    assert.throws(() => output('ref\nx', 'y'), /bad output name/);
  } finally {
    if (before === undefined) delete process.env.GITHUB_OUTPUT; else process.env.GITHUB_OUTPUT = before;
  }
});

test('#8506: apply refuses, and hands back without pushing, a patch from another attempt, controller or head', async () => {
  // Mutation checked: removing the publishRecordProblems call from applyStage lets each case push.
  for (const [name, opts, env, cause] of [
    ['a second attempt reusing the first attempt\'s patch', {}, { GITHUB_RUN_ATTEMPT: '2' }, /another attempt of this run/],
    ['the publish step runs another controller', {}, { GITHUB_SHA: 'e'.repeat(40) }, /does not run the controller revision/],
    ['a record naming another head', { record: { head_sha: 'b'.repeat(40) } }, {}, /another head/],
    ['no record', { record: { version: 0 } }, {}, /no record, or a malformed one/],
  ]) {
    const f = fixture();
    const inputs = applyInputs(f, opts);
    await inputs.write();
    const { gh, app, writes } = apiFakes({ pr: prOf({ head: { ...prOf().head, sha: f.head } }) });
    let pushes = 0;
    const r = await applyStage(envFor(inputs.tmp, env), { gh, app, clone: cloneFrom(f), pushImpl: () => { pushes += 1; return true; } });
    assert.equal(r.outcome, 'handed_back', name);
    assert.match(r.cause, cause, name);
    assert.equal(pushes, 0, name);
    assert.deepEqual(writes.map((w) => w.slice(0, 2)), [['post', 'issues/77/labels'], ['post', 'issues/77/comments']], name);
  }
});
