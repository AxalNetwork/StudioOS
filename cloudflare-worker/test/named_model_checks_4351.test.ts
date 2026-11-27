/**
 * #4351 (D4351) — a model the caller names on a rail page meets the plan-lock
 * and input-fit checks `textChoice` applies to its own picks.
 *
 *   1. A plan-locked named model is refused with `plan_locked`, in words that
 *      say what to do, before any hold or model call; never another model.
 *   2. A named model whose window is too small for the input is refused
 *      (`invalid_input`) before any hold, naming the model.
 *   3. A named model that passes both checks runs unchanged.
 * Synthetic records only; the model and the guard are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/named_model_checks_4351.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest, railTextJob, run } from '../src/services/aiRouter.ts';
import { railRows } from '../src/services/ai/railMatrix.ts';
import { MODEL_LOCKS } from '../src/services/ai/modelUseCases.ts';
import { modelById } from '../src/services/ai/catalogue.ts';
import { namedModelCheck } from '../src/services/ai/textJobs.ts';

const MEMBER = 4;

/** A text page whose list offers `want`, and that model. */
function pageOffering(want: (id: string) => boolean): { page: string; model: string; job: string } {
  for (const r of railRows() as any[]) {
    const job = railTextJob(r.pageKey, null)?.job;
    if (!job) continue;
    const m = [...(r.models || []), ...(r.more || [])].find((x: any) => want(x.id));
    if (m) return { page: r.pageKey, model: m.id, job };
  }
  throw new Error('no page offers such a model');
}

function world({ free = false } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(MEMBER, 5_000_000);
  if (free) f.db.prepare('DELETE FROM member_subscription_amounts WHERE user_id = ?').run(MEMBER);
  const calls: string[] = [];
  const AI: any = withGuard({ run: async (model: string) => { calls.push(model); return { response: 'A written line.', usage: { prompt_tokens: 50, completion_tokens: 10 } }; } });
  const holds = () => (f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n;
  return { f, env: { DB: f.DB, ENVIRONMENT: 'development', AI_PARTNER_MODELS: 'on', AI } as any, calls, holds };
}
const ran = (calls: string[]) => calls.filter((m) => !/llama-guard/.test(m));

test('1. a plan-locked named model is refused with its code, before any hold, and no other model runs', async () => {
  // Mutation checked: the #4351 block removed → the locked model runs (ok) for a free member.
  const { page, model } = pageOffering((id) => MODEL_LOCKS[id] === 'lowest_paid');
  const w = world({ free: true });
  try {
    const r = await run(w.env, { task: 'rail_write', userId: MEMBER, model, messages: [{ role: 'user', content: 'Draft the line.' }], rail: { page, option: null, record: null } });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.refusal, 'plan_locked');
    assert.match(String(r.error), /Pick another model, or change your plan\./);
    assert.deepEqual(ran(w.calls), [], 'never falls back to another model');
    assert.equal(w.holds(), 0, 'nothing is held');
  } finally { w.f.db.close(); }
});

test('1. a model locked to the top plan is refused for every member, as textChoice refuses it as a pick', async () => {
  const { page, model } = pageOffering((id) => MODEL_LOCKS[id] === 'top_paid');
  const w = world();
  try {
    const r = await run(w.env, { task: 'rail_write', userId: MEMBER, model, messages: [{ role: 'user', content: 'Draft the line.' }], rail: { page, option: null, record: null } });
    assert.equal(r.refusal, 'plan_locked', JSON.stringify(r));
    assert.deepEqual(ran(w.calls), []);
  } finally { w.f.db.close(); }
});

test('2. a named model whose window is too small for the input is refused before any hold, naming the model', async () => {
  // Mutation checked: namedModelCheck not reading the window → the run is held and the model called.
  const { page, model } = pageOffering((id) => (MODEL_LOCKS[id] ?? 'all') === 'all' && (modelById(id)?.context_window ?? Infinity) <= 32_000);
  const window = modelById(model)!.context_window!;
  const w = world();
  try {
    const long = 'word '.repeat(window * 2);
    const r = await run(w.env, { task: 'rail_write', userId: MEMBER, model, messages: [{ role: 'user', content: long }], rail: { page, option: null, record: null } });
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
    assert.equal(r.refusal, 'invalid_input');
    assert.match(String(r.error), new RegExp(`too long for ${modelById(model)!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(String(r.error), /Or pick another model\.$/);
    assert.deepEqual(ran(w.calls), []);
    assert.equal(w.holds(), 0, 'refused before any hold');
  } finally { w.f.db.close(); }
});

test('3. a named model that passes both checks runs unchanged', async () => {
  const { page, model } = pageOffering((id) => MODEL_LOCKS[id] === 'lowest_paid');
  const w = world();
  try {
    const r = await run(w.env, { task: 'rail_write', userId: MEMBER, model, messages: [{ role: 'user', content: 'Draft the line.' }], rail: { page, option: null, record: null } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(ran(w.calls), [model], 'the named model, and only it');
  } finally { w.f.db.close(); }
});

test('the check itself: null when the model may run; the refusal names why and what to do', () => {
  const { job, model } = pageOffering((id) => MODEL_LOCKS[id] === 'lowest_paid');
  const ctx = (tier: 'free' | 'paid', inputTokens = 100) => ({ switches: { AI_PARTNER_MODELS: 'on' } as any, tier, inputTokens, outputTokens: 512 });
  assert.equal(namedModelCheck(job, model, ctx('paid')), null);
  assert.equal(namedModelCheck(job, model, ctx('free'))?.code, 'plan_locked');
  const w = modelById(model)?.context_window;
  if (w) assert.equal(namedModelCheck(job, model, ctx('paid', w))?.code, 'input_too_long');
  const router = readFileSync(new URL('../src/services/aiRouter.ts', import.meta.url), 'utf8');
  assert.match(router, /if \(opts\.model && textShaped && !textJobId && railText\?\.job\) \{/);
});
