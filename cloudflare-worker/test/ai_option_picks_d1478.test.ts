/**
 * D1478 (#3721) Part B — an image option's and a transcription option's pick
 * is the model the run uses. `deck:image` and `draft:logo` run `deck_image` and
 * `brand_logo`; the `transcribe:*` options run `transcribe`. The run and the
 * quote both read, in order: the caller's model when the option offers it,
 * else the member's stored pick, else the route's default. A pick the partner
 * gate shuts reads as none, and an image is never redrawn on another model.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_option_picks_d1478.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run, quoteRun, ROUTE, __resetForTest } from '../src/services/aiRouter.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SCHNELL = '@cf/black-forest-labs/flux-1-schnell';
const KLEIN = '@cf/black-forest-labs/flux-2-klein-4b';
const DECK = { page: 'Founder · Raise · Pitch deck', option: 'deck:image' };
const LOGO = { page: 'Founder · Grow · Distribution', option: 'draft:logo' };
const SESSION = { page: 'Founder · Validate · Customer research', option: 'transcribe:session' };

function fixture(switches: Record<string, string>, fail: string[] = []) {
  const f = aiBudgetFixture();
  f.db.exec(readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8'));
  const calls: string[] = [];
  const env: any = {
    DB: f.DB, ENVIRONMENT: 'development', ...switches,
    AI: withGuard({ run: async (id: string, input: any) => {
      calls.push(id);
      if (fail.includes(id)) throw new Error('upstream 500');
      if (input?.audio) return { text: 'Hello.', words: [], transcription_info: { language: 'en', duration: 30 } };
      return { image: PNG };
    } }),
  };
  const pick = (page: string, option: string, model: string) => f.db.prepare(
    'INSERT INTO ai_rail_preferences(uid, user_id, section, task, model) VALUES (?, 2, ?, ?, ?)',
  ).run(crypto.randomUUID(), page.toLowerCase(), option, model);
  return { ...f, env, calls, pick };
}
test.afterEach(() => __resetForTest());

const draw = (task: 'deck_image' | 'brand_logo', rail: { page: string; option: string }, model?: string) =>
  ({ task, userId: 2, text: 'A calm desk at month end', draw: {}, rail, ...(model ? { model } : {}) }) as any;

test('both image jobs offer the draw models, FLUX.1 Schnell first, with no fallback chain', () => {
  for (const task of ['deck_image', 'brand_logo'] as const) {
    assert.equal(ROUTE[task].model, SCHNELL);
    assert.equal(ROUTE[task].alternates?.[0], SCHNELL);
    assert.equal(ROUTE[task].alternates?.length, 6);
    assert.deepEqual(ROUTE[task].fallbackChain ?? [], [], `${task}: no image is redrawn on another model`);
  }
});

test('a stored FLUX.2 Klein 4B pick is what the run and the quote use, with the partner gate on', async () => {
  for (const [task, rail] of [['deck_image', DECK], ['brand_logo', LOGO]] as const) {
    const f = fixture({ AI_PARTNER_MODELS: 'on' });
    try {
      f.pick(rail.page, rail.option, KLEIN);
      const q = await quoteRun(f.env, draw(task, rail));
      assert.equal(q.ok && q.model, KLEIN, `${task}: the quote prices the pick`);
      const r = await run(f.env, draw(task, rail));
      assert.equal(r.ok, true, `${task}: ${r.error}`);
      assert.deepEqual(f.calls, [KLEIN], `${task}: the pick is the model called`);
    } finally { f.db.close(); }
  }
});

test('with the partner gate shut, a stale Klein pick reads as none and FLUX.1 Schnell runs', async () => {
  const f = fixture({});
  try {
    f.pick(DECK.page, DECK.option, KLEIN);
    const q = await quoteRun(f.env, draw('deck_image', DECK));
    assert.equal(q.ok && q.model, SCHNELL);
    const r = await run(f.env, draw('deck_image', DECK));
    assert.equal(r.ok, true, String(r.error));
    assert.deepEqual(f.calls, [SCHNELL]);
    // A caller asking for the gated model by name is refused, not silently swapped.
    const asked = await run(f.env, draw('deck_image', DECK, KLEIN));
    assert.equal(asked.ok, false);
    assert.equal(asked.refusal, 'model_not_offered');
  } finally { f.db.close(); }
});

test('a vision model asked for on an image option is refused with model_not_offered', async () => {
  const f = fixture({ AI_PARTNER_MODELS: 'on' });
  try {
    for (const id of ['@cf/google/gemma-4-26b-a4b-it', '@cf/moondream/moondream3.1-9B-A2B']) {
      const r = await run(f.env, draw('deck_image', DECK, id));
      assert.equal(r.refusal, 'model_not_offered', id);
      const q = await quoteRun(f.env, draw('brand_logo', LOGO, id));
      assert.equal(q.ok, false, id);
    }
    assert.deepEqual(f.calls, [], 'nothing was drawn');
  } finally { f.db.close(); }
});

test('a failed image is not redrawn on another model', async () => {
  const f = fixture({ AI_PARTNER_MODELS: 'on' }, [KLEIN]);
  try {
    f.pick(DECK.page, DECK.option, KLEIN);
    const r = await run(f.env, draw('deck_image', DECK));
    assert.equal(r.ok, false);
    assert.deepEqual(f.calls, [KLEIN], 'one attempt, on the pick');
  } finally { f.db.close(); }
});

test('a transcription option\'s pick reaches the run, and a chat model on it is refused', async () => {
  const f = fixture({});
  try {
    const audio = { task: 'transcribe', userId: 2, audio: new Uint8Array(4000), audioMinutes: 0.5, rail: SESSION } as any;
    f.pick(SESSION.page, SESSION.option, '@cf/openai/whisper');
    const r = await run(f.env, audio);
    assert.equal(r.ok, true, String(r.error));
    assert.equal(f.calls[0], '@cf/openai/whisper', 'the stored pick transcribes');
    const chat = await run(f.env, { ...audio, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
    assert.equal(chat.refusal, 'model_not_offered');
    // A session's own final model, which the caller passes, still wins over the pick.
    f.calls.length = 0;
    const own = await run(f.env, { ...audio, model: '@cf/deepgram/nova-3' });
    assert.equal(own.ok, true, String(own.error));
    assert.equal(f.calls[0], '@cf/deepgram/nova-3');
  } finally { f.db.close(); }
});
