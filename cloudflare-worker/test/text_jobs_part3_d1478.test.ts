/**
 * #3937 (D1478 task 3, part 3): the remaining text-job callers through
 * `textChoice`.
 *
 *  · every single-purpose text task the router runs names its job
 *    (`TASK_TEXT_JOBS`); a rail press on a page the matrix lists keeps its
 *    page's row, and a job a caller names (`textJob`) always applies;
 *  · ST3 (`tool_call`) runs its ladder now that the router's fallback tests no
 *    longer use it as their sample;
 *  · the six tasks whose job's Default is another model are named, both ends,
 *    in `TASK_MODEL_MOVES`; none reaches a model the router does not run;
 *  · the scope jobs still unrouted are pinned, each a rail press (the page's
 *    own row in `railMatrix.json` decides its models) or an agent's run.
 * Synthetic records only; Workers AI is a stub.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/text_jobs_part3_d1478.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { ROUTE, __resetForTest, run } from '../src/services/aiRouter.ts';
import { TASK_MODEL_MOVES, TASK_TEXT_JOBS, textChoice, textJob } from '../src/services/ai/textJobs.ts';
import { FORM_TEXT_JOBS } from '../src/services/fills/fields.ts';

const ON = { AI_PARTNER_MODELS: 'on' } as any;
const GLM_FLASH = '@cf/zai-org/glm-4.7-flash';
const QWEN30 = '@cf/qwen/qwen3-30b-a3b-fp8';
const LLAMA70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const OSS120 = '@cf/openai/gpt-oss-120b';
const short = { switches: ON, tier: 'free' as const, inputTokens: 1_000, outputTokens: 500 };

/** Plan §6 PR 3's scope list. */
const SCOPE = ('ST1 ST2 ST3 ST4 ON1 ON2 VA5 VA6 VA11 VA12 VA13 VA15 VA16 BU1 BU2 BU3 BU4 BU5 BU6 BU8 DK1 DK2 DK3 DK7 DK8 DK9 DK12 DK13 '
  + 'RA1 RA2 RA6 RA7 RA8 RA10 RA12 IN1 IN3 IN5 IN6 IN7 IN8 IN11 IN13 GR1 GR2 GR5 GR10 GR12 GR13 GR16 NE2 RE3 RE5 RE6 '
  + 'CA1 CA2 CA4 EV1 EV5 EV8 AR1 AR2 AR3 LE5 LE6 LE7 EM1 EM3 EM4 AG1 AG4 AG5 AG7 AG8 AD1 AD2 AD4 MI1').split(' ');

function world(fail: string[] = []) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(4, 5_000_000);
  const calls: string[] = [];
  const AI: any = withGuard({
    run: async (model: string) => {
      calls.push(model);
      if (fail.includes(model)) throw new Error(`${model} 503`);
      return { response: 'Done.', usage: { prompt_tokens: 50, completion_tokens: 10 } };
    },
  });
  return { f, env: { DB: f.DB, ENVIRONMENT: 'development', AI } as any, ran: () => calls.filter((m) => !/llama-guard/.test(m)) };
}

test('every mapped task names a text job of the scope, and each runs that job\'s Default first', () => {
  for (const [task, job] of Object.entries(TASK_TEXT_JOBS)) {
    assert.ok(textJob(job), `${task}: ${job} is a text job`);
    assert.ok(ROUTE[task], `${task} is a route task`);
    const c = textChoice(job, short);
    assert.ok(c.ok, `${task} → ${job}`);
    assert.equal(c.model, textJob(job)!.default, `${task} → ${job}: the job's Default`);
  }
});

test('the moves: six tasks start on their job\'s Default, a model the router already runs; the rest keep theirs', () => {
  // Mutation checked: a mapped task whose Default differs from its route, left out of TASK_MODEL_MOVES (the part-2 test is red too).
  assert.deepEqual(Object.keys(TASK_MODEL_MOVES).sort(),
    ['advisor_explain', 'competitor_scan', 'dd_synthesis', 'market_sizing_inputs', 'onboarding_chat', 'validate_draft_hypotheses']);
  const router = readFileSync(new URL('../src/services/aiRouter.ts', import.meta.url), 'utf8');
  for (const [task, { from, to }] of Object.entries(TASK_MODEL_MOVES)) {
    assert.equal(ROUTE[task].model, from, `${task}: the route row is unchanged`);
    assert.ok(router.includes(`'${to}'`) || to === LLAMA70, `${task}: ${to} already runs on a route`);
  }
});

test('through run(): ST3 runs glm-4.7-flash, then its ladder (qwen3-30b), not the route\'s 70B', async () => {
  // Mutation checked: tool_call unmapped (the route's chain: the 70B second).
  assert.equal(TASK_TEXT_JOBS.tool_call, 'ST3');
  const w = world([GLM_FLASH]);
  try {
    const r: any = await run(w.env, { task: 'tool_call', userId: 4, messages: [{ role: 'user', content: 'Pick a tool.' }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(w.ran(), [GLM_FLASH, QWEN30]);
  } finally { w.f.db.close(); }
});

test('through run(): an onboarding turn runs ON1 (glm-4.7-flash); a deck review runs DK8 (gpt-oss-120b)', async () => {
  for (const [task, first] of [['onboarding_chat', GLM_FLASH], ['dd_synthesis', OSS120], ['workspace_explain', LLAMA70], ['mail_draft', LLAMA70]] as const) {
    const w = world();
    try {
      const r: any = await run(w.env, { task, userId: 4, messages: [{ role: 'user', content: 'Go.' }] });
      assert.equal(r.ok, true, `${task}: ${JSON.stringify(r)}`);
      assert.equal(w.ran()[0], first, task);
    } finally { w.f.db.close(); }
  }
});

test('a task\'s job yields to a rail press\'s page row; a job the caller names always applies', async () => {
  // Mutation checked: the page-row check dropped (Readiness's PMF explain runs ST2's 70B instead of its row's gpt-oss-120b).
  const rail = { page: 'Founder · Raise · Fundraising readiness', option: 'draft:raise/pmf-explain', record: null };
  const pressed = world();
  try {
    const r: any = await run(pressed.env, { task: 'workspace_explain', userId: 4, rail, messages: [{ role: 'user', content: 'Explain.' }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(pressed.ran()[0], OSS120, 'the page row\'s Default');
  } finally { pressed.f.db.close(); }
  const named = world();
  try {
    const r: any = await run(named.env, { task: 'workspace_explain', textJob: 'ST2', userId: 4, rail, messages: [{ role: 'user', content: 'Explain.' }] });
    assert.equal(r.ok, true);
    assert.equal(named.ran()[0], LLAMA70, 'a named job wins over the row');
  } finally { named.f.db.close(); }
});

test('the scope: what is routed through textChoice, and the rest pinned (rail presses and agents keep their own rows)', () => {
  const routed = new Set([...Object.values(TASK_TEXT_JOBS), ...Object.values(FORM_TEXT_JOBS)]);
  assert.deepEqual(SCOPE.filter((j) => routed.has(j)),
    ['ST2', 'ST3', 'ST4', 'ON1', 'VA5', 'VA11', 'VA12', 'VA13', 'VA15', 'BU4', 'DK8', 'IN1', 'IN5', 'IN6', 'IN11', 'GR1', 'GR2', 'EV1', 'EM1', 'AD1', 'MI1']);
  // The scope's jobs that read images write no text first: they are the vision task's, not textChoice's.
  assert.deepEqual(SCOPE.filter((j) => !textJob(j)), ['BU6', 'DK7', 'DK9', 'IN8', 'RE5']);
});
