/**
 * #8506 (D8506): one repair attempt runs ONE controller revision. `prepare` resolves it once; every round's edit and
 * verify check out that commit, never a branch name; the patch carries a record (model/record.mjs) that verify and
 * the caller's publish step check against their own inputs. The publish-side tests (a moved head, a record from
 * another controller or attempt) are in landing_bot_conflict_6475.test.mjs, beside the resolver's apply fixtures.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseTask } from '../../scripts/landing-bot/model/task.mjs';
import { manifestFor, patchFor } from '../../scripts/landing-bot/model/patch.mjs';
import { checkRecord, identityFrom, publishRecordProblems, recordFor } from '../../scripts/landing-bot/model/record.mjs';
import { verifyMain } from '../../scripts/landing-bot/model/verify.mjs';
import { editMain } from '../../scripts/landing-bot/model/edit.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (n) => readFileSync(new URL(`.github/workflows/${n}`, ROOT), 'utf8');

const FILE = 'frontend/src/pages/sum.js';
const BEFORE = 'export const sum = (a, b) => a - b;\n';
const AFTER = 'export const sum = (a, b) => a + b;\n';
const HEAD = 'a'.repeat(40);
const CTRL = 'c'.repeat(40);
const IDENT = { repository: 'AxalNetwork/StudioOS', run_id: '9001', run_attempt: '1' };
const TASK = { version: 1, instructions: 'fix sum', allowed_files: [FILE], verify: [['node', '-e', '0']], pr: 42 };

/** Every `actions/checkout` step in a workflow, with its `ref:` value and `path:`. */
function checkouts(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    if (!/uses: actions\/checkout@/.test(l)) return;
    const indent = l.search(/\S/);
    const step = [];
    for (let j = i + 1; j < lines.length; j++) {
      const k = lines[j];
      if (k.trim() && k.search(/\S/) <= indent && /^\s*-\s/.test(k)) break;
      if (k.trim() && k.search(/\S/) < indent) break;
      step.push(k);
    }
    const body = step.join('\n');
    out.push({ ref: /^\s*ref:\s*(.+)$/m.exec(body)?.[1].trim() ?? null, path: /^\s*path:\s*(.+)$/m.exec(body)?.[1].trim() ?? null });
  });
  return out;
}

test('#8506: no controller checkout in the model runner uses a branch name; all use the one resolved commit', () => {
  // Mutation checked: putting `ref: main` back on any runner checkout fails here.
  const outer = read('landing-bot-model.yml');
  const round = read('landing-bot-model-round.yml');
  const runners = [...checkouts(outer), ...checkouts(round)].filter((c) => c.path === 'runner');
  assert.equal(runners.length, 3, 'prepare, edit and verify each check out the controller');
  for (const c of runners) assert.match(c.ref ?? '', /^\$\{\{ (?:steps\.controller\.outputs\.sha|inputs\.controller) \}\}$/, `runner checkout ref ${c.ref}`);
  // Every checkout in both files is an expression: a literal ref (a branch or tag name) is refused outright.
  for (const c of [...checkouts(outer), ...checkouts(round)]) assert.match(c.ref ?? '', /^\$\{\{ .+ \}\}$/, `checkout ref ${c.ref}`);
  // prepare resolves it once, before its own checkout, and hands the same output to every round and to the caller.
  assert.ok(outer.indexOf('id: controller') < outer.indexOf('ref: ${{ steps.controller.outputs.sha }}'));
  assert.equal(outer.match(/controller: \$\{\{ needs\.prepare\.outputs\.controller \}\}/g)?.length, 3);
  assert.match(outer, /controller:\n\s+description: [^\n]+\n\s+value: \$\{\{ jobs\.prepare\.outputs\.controller \}\}/);
  assert.match(round, /controller:\n\s+description: [^\n]+\n\s+type: string\n\s+required: true/);
  // Edit and verify both pass it to their scripts, with the round and head verify needs to check the record.
  assert.equal(round.match(/--controller "\$CONTROLLER_SHA"/g)?.length, 2);
  assert.match(round, /verify\.mjs [^\n]*\\\n\s+--round "\$ROUND" --base "\$BASE_SHA" --controller "\$CONTROLLER_SHA"/);
  // The record travels with the published patch.
  assert.match(outer, /patch\/record\.json/);
});

test('#8506: each caller\'s publish step runs github.sha and receives the runner\'s controller to compare', () => {
  for (const [file, job] of [['landing-bot-conflict.yml', 'resolve'], ['landing-bot-main-repair.yml', 'repair'], ['landing-bot-red-pr.yml', 'repair']]) {
    const text = read(file);
    assert.match(text, new RegExp(`CONTROLLER_SHA: \\$\\{\\{ needs\\.${job}\\.outputs\\.controller \\}\\}`), file);
    const apply = text.slice(text.indexOf('\n  apply:'));
    for (const c of checkouts(apply)) assert.equal(c.ref, '${{ github.sha }}', `${file} apply checkout`);
  }
  assert.match(read('landing-bot-main-repair.yml'), /MODEL_HEAD_SHA: \$\{\{ needs\.repair\.outputs\.head \}\}/);
  assert.match(read('landing-bot-red-pr.yml'), /MODEL_HEAD_SHA: \$\{\{ needs\.repair\.outputs\.head \}\}/);
});

/** A checkout with FILE, a task, and the patch folder the edit job would write; `over` changes the record. */
function attempt({ over = {}, tamper = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lb-8506-'));
  const work = join(dir, 'work');
  mkdirSync(join(work, 'frontend/src/pages'), { recursive: true });
  writeFileSync(join(work, FILE), BEFORE);
  writeFileSync(join(dir, 'task.json'), JSON.stringify(parseTask(TASK).task));
  const changes = [{ path: FILE, before: BEFORE, after: AFTER }];
  const patchText = `${JSON.stringify(patchFor({ baseSha: HEAD, changes }), null, 2)}\n`;
  mkdirSync(join(dir, 'patch'));
  writeFileSync(join(dir, 'patch', 'patch.json'), tamper ? tamper(patchText) : patchText);
  writeFileSync(join(dir, 'patch', 'manifest.json'), JSON.stringify(manifestFor({ baseSha: HEAD, round: 1, result: { provider: 'claude' }, changes })));
  const record = recordFor({ identity: IDENT, task: parseTask(TASK).task, controller: CTRL, head: HEAD, round: 1, patchText });
  writeFileSync(join(dir, 'patch', 'record.json'), JSON.stringify({ ...record, ...over }));
  return { dir, work };
}
const verify = ({ dir, work }, { controller = CTRL, head = HEAD, round = '1', identity = IDENT } = {}) =>
  verifyMain({ task: join(dir, 'task.json'), work, patch: join(dir, 'patch'), out: join(dir, 'v'), round, base: head, controller }, { env: process.env, identity });

test('#8506: verify passes a patch whose record matches its own inputs', () => {
  const a = attempt();
  const v = verify(a);
  assert.equal(v.passed, true, JSON.stringify(v));
  assert.equal(readFileSync(join(a.work, FILE), 'utf8'), AFTER);
});

test('#8506: verify refuses another controller revision, another head, changed patch bytes and a second attempt\'s patch', () => {
  // Mutation checked: each case below passes if its field is dropped from checkRecord's comparison.
  const cases = [
    ['made by another controller', attempt(), { controller: 'd'.repeat(40) }, /another controller revision \(controller_sha\)/],
    ['made from another head', attempt({ over: { head_sha: 'b'.repeat(40) } }), {}, /another head \(head_sha\)/],
    ['patch bytes changed after the edit', attempt({ tamper: (t) => t.replace('a + b', 'a + b ') }), {}, /other patch bytes than the ones it names \(patch_sha256\)/],
    ['patch of the first attempt, verified by the second', attempt(), { identity: { ...IDENT, run_attempt: '2' } }, /another attempt of this run \(run_attempt\)/],
    ['patch of another run', attempt(), { identity: { ...IDENT, run_id: '9002' } }, /another run \(run_id\)/],
    ['patch of another round', attempt(), { round: '2' }, /another round \(round\)/],
    ['patch for another pull request', attempt({ over: { pr: 43 } }), {}, /another pull request \(pr\)/],
    ['patch for another task', attempt({ over: { task_sha256: '0'.repeat(64) } }), {}, /another task \(task_sha256\)/],
    ['no record at all', attempt({ over: { version: 2 } }), {}, /no record, or a malformed one/],
  ];
  for (const [name, a, inputs, problem] of cases) {
    const v = verify(a, inputs);
    assert.equal(v.passed, false, name);
    assert.match(v.problems.join('\n'), problem, name);
    // Refused before anything is applied or run.
    assert.equal(readFileSync(join(a.work, FILE), 'utf8'), BEFORE, `${name}: nothing applied`);
  }
});

test('#8506: a run whose identity cannot be read writes no record and checks none', () => {
  assert.deepEqual(identityFrom({ GITHUB_REPOSITORY: 'AxalNetwork/StudioOS', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '3' }),
    { repository: 'AxalNetwork/StudioOS', run_id: '12', run_attempt: '3' });
  assert.deepEqual(identityFrom({ GITHUB_RUN_ID: '12; rm', GITHUB_RUN_ATTEMPT: '0' }), { repository: null, run_id: null, run_attempt: null });
  const p = checkRecord({ version: 1 }, { identity: identityFrom({}), task: parseTask(TASK).task, controller: 'main', head: HEAD, patchText: '' });
  assert.match(p.join('\n'), /cannot check the record: the repository is unknown/);
  assert.match(p.join('\n'), /controller revision is not a full commit SHA/);
});

test('#8506: the publish step refuses a patch unless it runs the controller the patch names', () => {
  const task = parseTask(TASK).task;
  const patchText = '{}';
  const record = recordFor({ identity: IDENT, task, controller: CTRL, head: HEAD, round: 1, patchText });
  const env = { GITHUB_REPOSITORY: IDENT.repository, GITHUB_RUN_ID: IDENT.run_id, GITHUB_RUN_ATTEMPT: IDENT.run_attempt, GITHUB_SHA: CTRL, CONTROLLER_SHA: CTRL };
  assert.deepEqual(publishRecordProblems({ env, task, head: HEAD, patchText, record }), []);
  // Mutation checked: dropping the GITHUB_SHA comparison lets the first case through.
  assert.match(publishRecordProblems({ env: { ...env, GITHUB_SHA: 'e'.repeat(40) }, task, head: HEAD, patchText, record }).join(), /does not run the controller revision/);
  assert.match(publishRecordProblems({ env: { ...env, GITHUB_SHA: 'e'.repeat(40), CONTROLLER_SHA: 'e'.repeat(40) }, task, head: HEAD, patchText, record }).join(), /another controller revision/);
  assert.match(publishRecordProblems({ env: { ...env, CONTROLLER_SHA: '' }, task, head: HEAD, patchText, record }).join(), /does not run the controller revision/);
  assert.match(publishRecordProblems({ env, task, head: 'b'.repeat(40), patchText, record }).join(), /another head/);
});

test('#8506: the edit job calls no model when it could not write the record', async () => {
  // Mutation checked: removing the identity check in editMain lets the provider run.
  for (const [name, identity, controller] of [
    ['no run attempt', { ...IDENT, run_attempt: null }, CTRL],
    ['no repository', { ...IDENT, repository: null }, CTRL],
    ['a branch name for the controller', IDENT, 'main'],
  ]) {
    const a = attempt();
    let calls = 0;
    const provider = { name: 'claude', available: () => true, async turn() { calls += 1; throw new Error('must not run'); } };
    const r = await editMain({ task: join(a.dir, 'task.json'), work: a.work, out: join(a.dir, 'e'), round: '1', base: HEAD, controller }, { env: {}, identity, providers: { claude: provider } });
    assert.deepEqual([r.outcome, r.reason, calls], ['no_patch', 'the run cannot be recorded', 0], name);
  }
});
