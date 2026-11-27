/**
 * #6473: the landing bot's model runner. Stub providers stand in for Claude,
 * Codex and Gemini; the workflow is read as text.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HARD, parseTask, safeRef } from '../../scripts/landing-bot/model/task.mjs';
import { createWorkspace } from '../../scripts/landing-bot/model/workspace.mjs';
import { CapError, providerOrder, runRound } from '../../scripts/landing-bot/model/loop.mjs';
import { checkChanges, checkPatch, hasConflictMarkers } from '../../scripts/landing-bot/model/patch.mjs';
import { editMain } from '../../scripts/landing-bot/model/edit.mjs';
import { scrubbedEnv, verifyMain } from '../../scripts/landing-bot/model/verify.mjs';
import { makeProviders, NAMES } from '../../scripts/landing-bot/model/providers.mjs';
// #8506: the run every edit and verify call in this file belongs to, and the controller commit it ran.
const IDENT = { repository: 'AxalNetwork/StudioOS', run_id: '7001', run_attempt: '1' };
const CTRL = 'c'.repeat(40);
import { parseJobs, assertWorkflow } from '../../scripts/landing-bot/workflowGuard.mjs';

const ROOT = new URL('../../', import.meta.url);
const WF = (n) => new URL(`.github/workflows/${n}`, ROOT);
const read = (u) => readFileSync(u, 'utf8');
const SHA = 'a'.repeat(40);
const KEY = 'sk-ant-FIXTURE0123456789abcdefghij';

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lbm-'));
  for (const [p, text] of Object.entries({ 'frontend/src/pages/sum.js': 'export const sum = (a, b) => a - b;\n', 'README.md': '# x\n', ...files })) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}
const taskOf = (over = {}) => parseTask({
  version: 1, instructions: 'Fix sum.', allowed_files: ['frontend/src/pages/sum.js'],
  verify: [['node', '-e', '0']], data: { 'ci-log.txt': 'expected 3, got -1' }, max_turns: 6, max_minutes: 5, ...over,
}).task;

/** A stub provider: `script(call)` does what a model would through the tools. */
const stub = (name, script) => {
  const p = { name, model: `${name}-stub`, available: true, calls: 0,
    async run({ call }) { p.calls += 1; return script(call); } };
  return p;
};
const fix = (call) => { call.turn(); call.tool('replace_in_file', { path: 'frontend/src/pages/sum.js', old_text: 'a - b', new_text: 'a + b' }); call.turn(); return { stop: 'done' }; };
const quota = () => { const e = new Error('quota'); e.status = 429; e.code = 'insufficient_quota'; throw e; };

test('#6473: a quota, rate-limit, auth or 5xx error falls to the next provider, with the edits discarded', async () => {
  for (const status of [401, 403, 429, 500, 529]) {
    const ws = createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] });
    const claude = stub('claude', (call) => { call.turn(); call.tool('write_file', { path: 'frontend/src/pages/sum.js', content: 'half done' }); const e = new Error('x'); e.status = status; throw e; });
    const codex = stub('codex', fix);
    const r = await runRound({ task: taskOf(), workspace: ws, providers: { claude, codex } });
    assert.equal(r.outcome, 'patched', String(status));
    assert.equal(r.provider, 'codex');
    assert.equal(ws.changes()[0].after, 'export const sum = (a, b) => a + b;\n', 'claude\'s half edit was thrown away');
  }
  const ws = createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] });
  const r = await runRound({ task: taskOf(), workspace: ws, providers: { claude: stub('claude', quota), codex: stub('codex', quota), gemini: stub('gemini', fix) } });
  assert.deepEqual([r.provider, r.attempts.map((a) => a.result)], ['gemini', ['billing', 'not_configured', 'not_configured', 'billing', 'done']]);
});

test('#6473: a wrong fix, no fix, or a non-availability error does not move to the next provider', async () => {
  const wrong = stub('claude', (call) => { call.turn(); call.tool('write_file', { path: 'frontend/src/pages/sum.js', content: 'export const sum = () => 0;\n' }); return { stop: 'done' }; });
  const codex = stub('codex', fix);
  let r = await runRound({ task: taskOf(), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), providers: { claude: wrong, codex } });
  assert.deepEqual([r.outcome, r.provider, codex.calls], ['patched', 'claude', 0]);
  r = await runRound({ task: taskOf(), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), providers: { claude: stub('claude', (c) => { c.turn(); return { stop: 'done' }; }), codex } });
  assert.deepEqual([r.outcome, codex.calls], ['no_patch', 0]);
  const bad = stub('claude', () => { const e = new Error('bad request'); e.status = 400; throw e; });
  r = await runRound({ task: taskOf(), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), providers: { claude: bad, codex } });
  assert.deepEqual([r.outcome, codex.calls], ['no_patch', 0]);
  assert.match(r.reason, /failed: unknown/);
});

test('#6473: an unconfigured provider is skipped, and LANDING_BOT_PROVIDERS sets the order', async () => {
  assert.deepEqual(providerOrder(''), ['claude', 'claude-2', 'claude-3', 'codex', 'gemini']);
  assert.deepEqual(providerOrder('gemini, claude, nope, gemini'), ['gemini', 'claude']);
  const p = makeProviders({});
  assert.deepEqual(Object.values(p).map((x) => x.available), [false, false, false, false, false]);
  assert.equal(makeProviders({ ANTHROPIC_API_KEY: 'k' }).claude.available, true);
  assert.equal(makeProviders({ GEMINI_API_KEY: 'k' }).gemini.available, false, 'Gemini also needs a model');
  assert.equal(makeProviders({ ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_01AbCdEfGh', ANTHROPIC_ORGANIZATION_ID: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b' }).claude.available, true, 'federation needs no key');
  assert.deepEqual([NAMES.claude.secret, NAMES.codex.secret, NAMES.gemini.secret], ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']);
  const r = await runRound({ task: taskOf(), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), providers: { claude: { ...stub('claude', fix), available: false }, codex: stub('codex', fix) } });
  assert.deepEqual(r.attempts.map((a) => a.result), ['not_configured', 'not_configured', 'not_configured', 'done']);
});

test('#6473: the caps stop a run: turns, minutes, and HARD clamps what a caller asks for', async () => {
  // Bounded, so a missing cap fails the test instead of hanging it.
  const forever = stub('claude', (call) => { for (let i = 0; i < 200; i++) { call.turn(); call.tool('read_file', { path: 'README.md' }); } return { stop: 'done' }; });
  const codex = stub('codex', fix);
  let r = await runRound({ task: taskOf({ max_turns: 4 }), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), providers: { claude: forever, codex } });
  assert.deepEqual([r.outcome, r.turns, codex.calls], ['no_patch', 4, 0]);
  assert.match(r.reason, /cap reached: turns/);
  let t = 0;
  r = await runRound({ task: taskOf(), now: () => (t += 60_000), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), providers: { claude: forever } });
  assert.match(r.reason, /cap reached: minutes/);
  const big = taskOf({ max_turns: 10_000, max_minutes: 999, max_rounds: 50 });
  assert.deepEqual([big.max_turns, big.max_minutes, big.max_rounds], [HARD.turns, HARD.minutes, HARD.rounds]);
  assert.ok(new CapError('turns') instanceof Error);
});

test('#6473: the model cannot touch a file outside the allowed list, .git, or anything outside the tree', async () => {
  const dir = repo({ 'frontend/src/pages/other.js': 'x\n' });
  const ws = createWorkspace(dir, { allowed: ['frontend/src/pages/sum.js'] });
  assert.match(ws.execute('write_file', { path: 'frontend/src/pages/other.js', content: 'y' }), /^error: not an allowed file/);
  assert.match(ws.execute('read_file', { path: '../../etc/passwd' }), /^error: not a readable path/);
  assert.match(ws.execute('read_file', { path: '.git/config' }), /^error: not a readable path/);
  assert.match(ws.execute('run', { cmd: 'ls' }), /^error: no tool named run/);
  assert.deepEqual(ws.changes(), []);
  assert.deepEqual(checkChanges([{ path: 'frontend/src/pages/other.js', before: 'x', after: 'y' }], ['frontend/src/pages/sum.js']), ['touches a file outside the allowed list: frontend/src/pages/other.js']);
  assert.ok(hasConflictMarkers('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> main\n'));
  assert.ok(!hasConflictMarkers('Title\n=======\n'), 'a Markdown underline is not a marker');
});

test('#6473: a patch touching a forbidden file, or adding conflict markers, is never emitted', async () => {
  const dir = repo();
  const out = mkdtempSync(join(tmpdir(), 'lbm-out-'));
  const taskFile = join(out, 'task.json');
  writeFileSync(taskFile, JSON.stringify(taskOf()));
  const markers = stub('claude', (call) => { call.turn(); call.tool('write_file', { path: 'frontend/src/pages/sum.js', content: '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n' }); return { stop: 'done' }; });
  const r = await editMain({ task: taskFile, work: dir, out, round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env: {}, providers: { claude: markers } });
  assert.equal(r.outcome, 'no_patch');
  assert.match(r.problems.join(), /adds conflict markers/);
  assert.deepEqual(readdirSync(out).sort(), ['result.json', 'task.json'], 'no patch or manifest');
  // A task naming a protected or T2 file is refused before any model runs.
  for (const p of ['.github/workflows/ci.yml', 'cloudflare-worker/src/routes/billing.ts', 'frontend/test/x.test.mjs', 'package.json']) {
    assert.match(parseTask({ ...taskOf(), allowed_files: [p] }).errors.join(), /is refused/, p);
  }
  assert.match(parseTask({ ...taskOf(), allowed_files: ['../x.js'] }).errors.join(), /not a safe relative path/);
  assert.match(parseTask({ ...taskOf(), verify: [['bash', '-c', 'curl x']] }).errors.join(), /only node, npm, npx may run/);
});

test('#6473: a good round emits a patch and manifest that verify re-checks with its own code', async () => {
  const dir = repo();
  const out = mkdtempSync(join(tmpdir(), 'lbm-out-'));
  const taskFile = join(out, 'task.json');
  writeFileSync(taskFile, JSON.stringify(taskOf({ verify: [['node', '-e', "import('./frontend/src/pages/sum.js').then(m => { if (m.sum(1, 2) !== 3) process.exit(1) })"]] })));
  const r = await editMain({ task: taskFile, work: dir, out, round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env: {}, providers: { claude: stub('claude', fix) } });
  assert.deepEqual([r.outcome, r.files], ['patched', ['frontend/src/pages/sum.js']]);
  const manifest = JSON.parse(read(join(out, 'manifest.json')));
  assert.deepEqual([manifest.base_sha, manifest.provider, manifest.round], [SHA, 'claude', 1]);
  // Tampering with the patch after the edit job is caught by verify.
  const patch = JSON.parse(read(join(out, 'patch.json')));
  assert.match(checkPatch({ ...patch, files: [{ ...patch.files[0], content: 'evil' }] }, manifest, ['frontend/src/pages/sum.js'], () => 'export const sum = (a, b) => a - b;\n').join(), /does not match the manifest/);
  assert.match(checkPatch(patch, manifest, ['frontend/src/pages/sum.js'], () => 'changed since').join(), /not the file the patch was made from/);
  const v = verifyMain({ task: taskFile, work: dir, patch: out, out: join(out, 'v'), round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env: process.env });
  assert.equal(v.passed, true);
});

test('#6473: a failed verify yields no patch, and its output feeds the next round as data', async () => {
  const dir = repo();
  const out = mkdtempSync(join(tmpdir(), 'lbm-out-'));
  const taskFile = join(out, 'task.json');
  writeFileSync(taskFile, JSON.stringify(taskOf({ verify: [['node', '-e', 'console.log("still red"); process.exit(1)']] })));
  await editMain({ task: taskFile, work: dir, out, round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env: {}, providers: { claude: stub('claude', fix) } });
  const v = verifyMain({ task: taskFile, work: dir, patch: out, out: join(out, 'v'), round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env: process.env });
  assert.equal(v.passed, false);
  assert.match(v.failure_text, /still red/);
  // Round 2 sees the failure as the data file verify-failure.txt, from the original checkout.
  let seen = null;
  const reader = stub('claude', (call) => { call.turn(); seen = call.tool('read_data', { name: 'verify-failure.txt' }); return { stop: 'done' }; });
  const out2 = join(out, 'r2');
  const r2 = await editMain({ task: taskFile, work: repo(), out: out2, round: '2', base: SHA, controller: CTRL, feedback: join(out, 'v', 'verify.json') }, { identity: IDENT, env: {}, providers: { claude: reader } });
  assert.match(seen, /still red/);
  assert.equal(r2.outcome, 'no_patch');
  const result = read(WF('landing-bot-model.yml'));
  assert.match(result, /if \[ "\$\{!v\}" = passed \]; then round=\$i; fi/, 'only a round whose verify passed is published');
});

test('#6473: a test that prints its environment shows no key in any log or artifact', async () => {
  const dir = repo({ 'print-env.mjs': 'console.log(JSON.stringify(process.env)); process.exit(1);\n' });
  const out = mkdtempSync(join(tmpdir(), 'lbm-out-'));
  const taskFile = join(out, 'task.json');
  writeFileSync(taskFile, JSON.stringify(taskOf({ verify: [['node', 'print-env.mjs']] })));
  const env = { ...process.env, ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: KEY, GEMINI_API_KEY: KEY, GITHUB_TOKEN: `ghs_${'FIXTURE'.repeat(4)}`, ACTIONS_RUNTIME_TOKEN: 'rt-FIXTURE' };
  await editMain({ task: taskFile, work: dir, out, round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env, providers: { claude: stub('claude', fix) } });
  const v = verifyMain({ task: taskFile, work: dir, patch: out, out: join(out, 'v'), round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env });
  assert.equal(v.passed, false);
  assert.match(v.failure_text, /"CI":"true"/, 'the command did print its environment');
  const grep = spawnSync('grep', ['-r', '-l', '-e', 'FIXTURE', out], { encoding: 'utf8' });
  assert.equal(grep.status, 1, `a key reached an artifact: ${grep.stdout}`);
  assert.doesNotMatch(v.failure_text, /FIXTURE/);
  assert.deepEqual(Object.keys(scrubbedEnv(env)).filter((k) => /KEY|TOKEN|SECRET/i.test(k)), []);
});

test('#6473: the edit side can run nothing: no child_process in the modules the keyed job loads', () => {
  for (const f of ['edit.mjs', 'loop.mjs', 'workspace.mjs', 'patch.mjs', 'providers.mjs', 'task.mjs', 'prepare.mjs']) {
    assert.doesNotMatch(read(new URL(`scripts/landing-bot/model/${f}`, ROOT)), /child_process|\bexec(?:File)?Sync\b|\bspawn\b/, f);
  }
  assert.ok(safeRef('agent/claude/6473-x') && !safeRef('--upload-pack=x') && !safeRef('a..b') && !safeRef('${{ x }}'));
});

test('#6473: the workflow: edit has no write permission and runs only the pinned runner; verify has no secret or environment', () => {
  const round = read(WF('landing-bot-model-round.yml'));
  const { jobs } = parseJobs(round);
  const edit = jobs.find((j) => j.id === 'edit');
  const verify = jobs.find((j) => j.id === 'verify');
  assert.equal(edit.environment, 'repair');
  const editBody = edit.lines.join('\n');
  const perms = /^ {4}permissions:\n((?: {6}.*\n|\s*#.*\n)+)/m.exec(`${editBody}\n`)[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(perms, ['contents: read', 'id-token: write'], 'no write permission beyond the OIDC token');
  assert.doesNotMatch(editBody, /create-github-app-token|github\.token|secrets\.GITHUB_TOKEN|LANDING_BOT_APP_/);
  const runs = edit.steps.filter((s) => /\brun:/.test(s)).map((s) => s.slice(s.indexOf('run:')));
  for (const r of runs) {
    assert.doesNotMatch(r, /npm (?:run|test|install|exec)|npx|node (?!runner\/scripts\/landing-bot\/model\/|-e )|\bwork\/[\w./-]+\.(?:m?js|sh|ts)\b|bash work|sh work/, r);
  }
  assert.match(runs.join('\n'), /npm ci --prefix runner\/scripts\/landing-bot\/model --ignore-scripts/);
  // #8506: the runner is the controller commit the caller resolved once, never a branch name.
  assert.match(editBody, /ref: \$\{\{ inputs\.controller \}\}\n {10}path: runner/);
  assert.equal(verify.environment, null);
  assert.doesNotMatch(verify.lines.join('\n'), /secrets\.|vars\.|id-token|environment:|: write\b/);
  assert.match(verify.lines.join('\n'), /permissions:\n {6}contents: read/);
  assert.doesNotMatch(round.split('jobs:')[0], /secrets\./);
  assertWorkflow(WF('landing-bot-model-round.yml').pathname);
  assertWorkflow(WF('landing-bot-model.yml').pathname);
  assert.doesNotMatch(read(WF('landing-bot-model.yml')), /secrets\.|environment:/, 'the outer workflow holds no secret');
});

test('#6473: no workflow but the runner\'s round names the repair environment', () => {
  const dir = new URL('.github/workflows/', ROOT);
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const names = parseJobs(read(new URL(f, dir))).jobs.map((j) => j.environment);
    if (f === 'landing-bot-model-round.yml') assert.deepEqual(names, ['repair', null]);
    else assert.ok(!names.includes('repair') && !/environment:\s*\n?\s*(?:name:\s*)?['"]?repair\b/.test(read(new URL(f, dir))), f);
  }
});

test('#6473: verify refuses an allowed file that became a symbolic link, and reads nothing through it', async () => {
  // Mutation checked: opening without O_NOFOLLOW reads the link's target and this test fails.
  const dir = repo();
  const out = mkdtempSync(join(tmpdir(), 'lbm-out-'));
  const taskFile = join(out, 'task.json');
  writeFileSync(taskFile, JSON.stringify(taskOf({ verify: [['node', '-e', '0']] })));
  const r = await editMain({ task: taskFile, work: dir, out, round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env: {}, providers: { claude: stub('claude', fix) } });
  assert.equal(r.outcome, 'patched');
  // The file the patch was made from is swapped for a link to the same text after the edit job.
  const target = join(dir, 'frontend/src/pages/sum.js');
  renameSync(target, join(dir, 'moved.js'));
  symlinkSync(join(dir, 'moved.js'), target);
  const v = verifyMain({ task: taskFile, work: dir, patch: out, out: join(out, 'v'), round: '1', base: SHA, controller: CTRL }, { identity: IDENT, env: process.env });
  assert.equal(v.passed, false);
  assert.ok(v.problems.includes('frontend/src/pages/sum.js is a symbolic link'), JSON.stringify(v.problems));
});

test('audit P1: the review loop\'s Claude accounts in order, each its own key, and the manifest names the account', async () => {
  const p = makeProviders({ ANTHROPIC_API_KEY_2: 'k2', ANTHROPIC_API_KEY_3: 'k3' });
  assert.deepEqual(['claude', 'claude-2', 'claude-3'].map((n) => [n, p[n].available]), [['claude', false], ['claude-2', true], ['claude-3', true]]);
  assert.deepEqual([NAMES['claude-2'].secret, NAMES['claude-3'].secret], ['ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3']);
  // Federation is the primary's only: the variables do not make account 2 available.
  assert.equal(makeProviders({ ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_01AbCdEfGh', ANTHROPIC_ORGANIZATION_ID: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b' })['claude-2'].available, false);
  // Primary out of credit, account 2 unavailable, account 3 answers: the round reports claude-3.
  const credit = () => { const e = new Error('billing'); e.kind = 'billing'; throw e; };
  const order = providerOrder('');
  const r = await runRound({ task: taskOf(), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), order,
    providers: { claude: stub('claude', credit), 'claude-2': { ...stub('claude-2', fix), available: false }, 'claude-3': stub('claude-3', fix), codex: stub('codex', fix) } });
  assert.deepEqual([r.outcome, r.provider], ['patched', 'claude-3']);
  assert.deepEqual(r.attempts.map((a) => [a.provider, a.result]), [['claude', 'billing'], ['claude-2', 'not_configured'], ['claude-3', 'done']]);
  // All three Claude accounts out of credit: Codex answers.
  const all = await runRound({ task: taskOf(), workspace: createWorkspace(repo(), { allowed: ['frontend/src/pages/sum.js'] }), order,
    providers: { claude: stub('claude', credit), 'claude-2': stub('claude-2', credit), 'claude-3': stub('claude-3', credit), codex: stub('codex', fix) } });
  assert.equal(all.provider, 'codex');
});

test('audit P1: the round job hands the numbered Claude keys to the edit step only', () => {
  const round = read(WF('landing-bot-model-round.yml'));
  assert.match(round, /ANTHROPIC_API_KEY_2: \$\{\{ secrets\.ANTHROPIC_API_KEY_2 \}\}/);
  assert.match(round, /ANTHROPIC_API_KEY_3: \$\{\{ secrets\.ANTHROPIC_API_KEY_3 \}\}/);
  const verify = round.slice(round.indexOf('\n  verify:'));
  assert.doesNotMatch(verify, /secrets\./, 'verify holds no secret');
});
