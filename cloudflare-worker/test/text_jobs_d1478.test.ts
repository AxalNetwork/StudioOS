/**
 * D1478 §3937 part 1 — the text routes plan §4.2 named wrong, held as a route
 * table: tool calls on glm-4.7-flash (fix 1), the snippet paraphrase on the 8B
 * fp8 (fix 5), no queue job on the 8B (fix 14, IN4 to IN7), and qwen3.8-27b's
 * documented reasoning control (fix 16). Synthetic records only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/text_jobs_d1478.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest, ROUTE } from '../src/services/aiRouter.ts';
import { REASONING_CONTROLS } from '../src/services/ai/shapes.ts';
import { aiGenerateLPA } from '../ai-workers/lpa.ts';
import { aiTractionReview } from '../ai-workers/traction.ts';

const EIGHT_B = /llama-3\.1-8b/;
const GLM_FLASH = '@cf/zai-org/glm-4.7-flash';
const GPT_OSS = '@cf/openai/gpt-oss-120b';
const GRANITE = '@cf/ibm-granite/granite-4.0-h-micro';

test('fix 1: tool calls run glm-4.7-flash, which carries the function-calling badge; qwen-coder is no longer on the route', () => {
  assert.equal(ROUTE.tool_call.model, GLM_FLASH);
  assert.ok(!JSON.stringify(ROUTE.tool_call).includes('qwen2.5-coder'));
});

test('fix 5 (MI1): the snippet paraphrase runs the 8B fp8 first, the 70B only as its fallback', () => {
  assert.equal(ROUTE.paraphrase.model, '@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.deepEqual(ROUTE.paraphrase.fallbackChain, ['@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
});

test('fix 14: no system_job route runs on the 8B; AD3 (ops_summary) is the one system job left there', () => {
  for (const task of ['system_job', 'system_legal', 'system_review'] as const) {
    const r = ROUTE[task];
    assert.doesNotMatch(r.model, EIGHT_B, `${task} Default`);
    for (const m of r.fallbackChain ?? []) assert.doesNotMatch(m, EIGHT_B, `${task} fallback ${m}`);
  }
  assert.equal(ROUTE.system_job.model, GPT_OSS, 'IN5 valuation and equity: Numbers');
  assert.equal(ROUTE.system_legal.model, GPT_OSS, 'IN6 LPA: Legal');
  assert.equal(ROUTE.system_review.model, GRANITE, 'IN7 traction: Numbers');
  assert.match(ROUTE.ops_summary.model, EIGHT_B, 'AD3 keeps the 8B fp8, as the plan fixed it');
});

function world(reply: string) {
  __resetForTest();
  const f = aiBudgetFixture();
  const seen: string[] = [];
  const AI = withGuard({ run: async (model: string) => { seen.push(model); return { response: reply, usage: { prompt_tokens: 120, completion_tokens: 60 } }; } });
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', AI };
  const tasks = () => (f.db.prepare("SELECT task, model, user_id FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[]);
  return { f, env, seen, tasks };
}

test('the LPA job runs on system_legal and the traction job on system_review, each a system call (userId 0)', async () => {
  const lpa = world('ARTICLE I. ' + 'The partnership is formed under the laws of Delaware. '.repeat(6));
  try {
    const text = await aiGenerateLPA(lpa.env, { fund_name: 'Synthetic Fund I', fund_size_cents: 10_000_000_00, carried_interest: 0.2, management_fee: 0.02 });
    assert.match(text, /^ARTICLE I\./, 'the job still keeps the model\'s draft');
    assert.deepEqual(lpa.seen, [GPT_OSS]);
    assert.deepEqual(lpa.tasks().map((r) => [r.task, r.model, r.user_id]), [['system_legal', GPT_OSS, 0]]);
  } finally { lpa.f.db.close(); }

  const tr = world('{"momentum":7,"trend":"up","summary":"MRR rose three months running."}');
  try {
    const out = await aiTractionReview(tr.env, { project_id: 1, snapshots: [{ metric_name: 'mrr', value: 1200, captured_at: '2026-10-01' }, { metric_name: 'mrr', value: 1500, captured_at: '2026-11-01' }] });
    assert.equal(out.momentum, 7);
    assert.deepEqual(tr.seen, [GRANITE]);
    assert.deepEqual(tr.tasks().map((r) => [r.task, r.user_id]), [['system_review', 0]]);
  } finally { tr.f.db.close(); }
});

test('every queue job names a route; none is left to default without saying so', () => {
  const read = (f: string) => readFileSync(new URL(`../ai-workers/${f}.ts`, import.meta.url), 'utf8');
  assert.match(read('lpa'), /task: 'system_legal'/);
  assert.match(read('traction'), /task: 'system_review'/);
  for (const job of ['equity', 'scoring', 'valuation']) assert.doesNotMatch(read(job), /task: 'system_(legal|review)'/, `${job} stays on system_job (Numbers)`);
});

test('fix 16: qwen3.8-27b takes reasoning_effort, as its model page documents (low, medium, xhigh)', () => {
  assert.deepEqual(REASONING_CONTROLS['@cf/qwen/qwen3.8-27b'], { via: 'reasoning_effort' });
});
