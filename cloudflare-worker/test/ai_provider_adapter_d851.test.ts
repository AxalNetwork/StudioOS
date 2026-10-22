/**
 * D851 (#2474) — a model provider's own API (pattern C), metered on the one AI
 * token ledger. Anthropic's adapter against a stubbed `fetch`: no live call is
 * made and no key is real. Real SQLite with the AI budget migrations
 * (`_ai_budget_fixture.mjs`); member 2 has a $50 monthly allowance.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_provider_adapter_d851.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { runProviderModel, providerQuoteMicro, PROVIDER_KEY_SECRET } from '../src/services/aiProviders.ts';
import { CATALOGUE, PROVIDER_MODELS, PROVIDER_PRICING_VERSION, providerModelById } from '../src/services/ai/catalogue.ts';
import { anthropic, ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION } from '../src/services/ai/providers/anthropic.ts';
import { ROUTE } from '../src/services/aiRouter.ts';
import { usdRatesBilledMicro } from '../src/services/ai/pricing.ts';

const KEY = 'test-platform-key-not-real-0001';
const MODEL = 'anthropic/claude-sonnet-5-5';
const ME = 2;
const REQUEST = { system: 'Be brief.', messages: [{ role: 'user' as const, content: 'Summarise the call in one line.' }], maxTokens: 2000 };

function world(env: Record<string, unknown> = {}) {
  const { DB, db } = aiBudgetFixture();
  return { db, env: { DB, AI_PROVIDER_ANTHROPIC: 'on', [PROVIDER_KEY_SECRET.anthropic]: KEY, ...env } as any };
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; throws?: boolean };
function stubFetch(reply: Reply) {
  const calls: { url: string; init: any }[] = [];
  const fetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    if (reply.throws) throw new TypeError('network down');
    const h = new Headers(reply.headers ?? {});
    return { status: reply.status ?? 200, headers: h, json: async () => reply.body } as any;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const answered = (usage: unknown) => ({
  status: 200,
  headers: { 'request-id': 'req_test_1' },
  body: { id: 'msg_test', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'They reconcile ' }, { type: 'text', text: 'by hand.' }], usage },
});
const USAGE = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 };

const rows = (db: any) => db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all().map((r: any) => ({ ...r }));
const holds = (db: any) => db.prepare('SELECT * FROM ai_budget_reservations ORDER BY created_at').all().map((r: any) => ({ ...r }));
const run = (env: any, fetch: typeof globalThis.fetch) =>
  runProviderModel(env, { userId: ME, model: MODEL, task: 'explain', request: REQUEST }, { fetch, timeoutMs: 1000 });

// ── the inventory ─────────────────────────────────────────────────────────────

test('D851: the Anthropic row carries Anthropic\'s printed rates, its page and the date, and is not in Cloudflare\'s catalogue', () => {
  const m = providerModelById(MODEL)!;
  assert.deepEqual({ ...m.rates }, { tokens_in: '2', tokens_cache_write: '2.50', tokens_cached: '0.10', tokens_out: '10' });
  assert.equal(m.apiModel, 'claude-sonnet-5-5');
  assert.match(m.source, /^https:\/\/platform\.claude\.com\//);
  assert.equal(m.read, '2026-10-21');
  assert.deepEqual(PROVIDER_MODELS.map((x) => x.id), [MODEL]);
  assert.ok(!CATALOGUE.some((c) => PROVIDER_MODELS.some((p) => p.id === c.id)), 'the Workers AI catalogue is unchanged');
  // No task is routed to a provider: the adapter is reached only through runProviderModel.
  for (const [task, r] of Object.entries(ROUTE)) assert.equal(r.provider, 'workers-ai', task);
});

// ── off behind its switch ─────────────────────────────────────────────────────

test('D851: off unless AI_PROVIDER_ANTHROPIC is exactly "on": no hold, no call, no row', async () => {
  // Mutation checked: a truthy check ('true', 'ON') would run here.
  for (const value of [undefined, '', 'true', 'ON', 'off', '1']) {
    const w = world({ AI_PROVIDER_ANTHROPIC: value });
    const f = stubFetch(answered(USAGE));
    const r = await run(w.env, f.fetch);
    assert.deepEqual(r, { ok: false, refusal: 'model_not_offered' }, String(value));
    assert.equal(f.calls.length, 0);
    assert.equal(holds(w.db).length, 0);
    assert.equal(rows(w.db).length, 0);
  }
  const unknown = world();
  assert.deepEqual(await runProviderModel(unknown.env, { userId: ME, model: 'anthropic/not-a-model', task: 'explain', request: REQUEST }, stubFetch(answered(USAGE))),
    { ok: false, refusal: 'model_not_offered' });
});

test('D851: on, but with no platform key, it is misconfigured: no hold, no call, one row charging nothing', async () => {
  const w = world({ [PROVIDER_KEY_SECRET.anthropic]: undefined });
  const f = stubFetch(answered(USAGE));
  assert.deepEqual(await run(w.env, f.fetch), { ok: false, refusal: 'misconfigured' });
  assert.equal(f.calls.length, 0);
  assert.equal(holds(w.db).length, 0);
  const [row] = rows(w.db);
  assert.equal(row.refusal, 'misconfigured');
  assert.equal(row.charged_microusd, 0);
});

test('D851: the page\'s AI switch refuses before the hold, as run() does', async () => {
  const w = world();
  w.db.exec("CREATE TABLE ai_rail_preferences(uid TEXT, user_id INTEGER, section TEXT, task TEXT, model TEXT, mode TEXT)");
  w.db.prepare("INSERT INTO ai_rail_preferences(uid, user_id, section, task, mode) VALUES ('off', ?, 'validate', '', 'manual')").run(ME);
  const f = stubFetch(answered(USAGE));
  const r = await runProviderModel(w.env, { userId: ME, model: MODEL, task: 'explain', request: REQUEST, railPage: 'Validate' }, { fetch: f.fetch });
  assert.deepEqual(r, { ok: false, refusal: 'assist_off' });
  assert.equal(f.calls.length, 0);
  assert.equal(holds(w.db).length, 0);
});

// ── the request ───────────────────────────────────────────────────────────────

test('D851: the request is Anthropic\'s Messages API; the key travels in x-api-key only', async () => {
  const w = world();
  const f = stubFetch(answered(USAGE));
  const logged: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try { assert.equal((await run(w.env, f.fetch)).ok, true); } finally { Object.assign(console, keep); }
  const [call] = f.calls;
  assert.equal(call.url, ANTHROPIC_MESSAGES_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['x-api-key'], KEY);
  assert.equal(call.init.headers['anthropic-version'], ANTHROPIC_VERSION);
  assert.deepEqual(JSON.parse(call.init.body), { model: 'claude-sonnet-5-5', max_tokens: 2000, system: 'Be brief.', messages: [{ role: 'user', content: 'Summarise the call in one line.' }] });
  assert.ok(!call.init.body.includes(KEY), 'the key is not in the body');
  // Mutation checked: logging the request or writing it to the row puts the key here.
  assert.ok(!logged.some((l) => l.includes(KEY)), 'the key is never logged');
  assert.ok(!JSON.stringify(rows(w.db)).includes(KEY), 'the key is never written to the usage row');
  assert.ok(!JSON.stringify(rows(w.db)).includes('Summarise the call'), 'nor the prompt');
});

// ── settlement from the reported usage ───────────────────────────────────────

test('D851: it settles from the reported usage at Anthropic\'s rates, at cost while billing is on cost', async () => {
  // 1,000 × $2 + 200 × $2.50 + 300 × $0.10 + 500 × $10, per 1M = $0.007530 = 7,530 micro-USD.
  // Mutations checked: the cache write billed at the input rate (7,330), cache reads at the input
  // rate (8,130), and input_tokens taken to include the cached ones (7,030 after subtracting).
  const w = world();
  const r = await run(w.env, stubFetch(answered(USAGE)).fetch);
  assert.ok(r.ok);
  assert.equal(r.output, 'They reconcile by hand.');
  assert.equal(r.charged, 7530);
  assert.equal(r.usageReported, true);
  const [hold] = holds(w.db);
  assert.equal(hold.status, 'settled');
  assert.equal(hold.actual_included_microusd + hold.actual_topup_microusd, 7530);
  const [row] = rows(w.db);
  assert.equal(row.charged_microusd, 7530);
  assert.equal(row.reservation_uid, hold.uid);
  assert.equal(row.model, MODEL);
  assert.equal(row.prompt_tokens, 1500, 'all input: uncached, cache writes and cache reads');
  assert.equal(row.completion_tokens, 500);
  assert.equal(row.refusal, null);
  assert.deepEqual(JSON.parse(row.units_json), {
    provider: 'anthropic', pricing_version: PROVIDER_PRICING_VERSION, usage_reported: true,
    tokens_in: 1000, tokens_cache_write: 200, tokens_cached: 300, tokens_out: 500,
  });
});

test('D851: with billing charged, a member pays the reported cost times the markup, rounded up once; the admin licence pays cost', async () => {
  // 7,530 × 1.25 = 9,412.5 → 9,413. Mutation checked: settling at cost ignores the multiplier.
  const w = world({ AI_BILLING: 'charged' });
  const r = await run(w.env, stubFetch(answered(USAGE)).fetch);
  assert.ok(r.ok);
  assert.equal(r.charged, 9413);
  const admin = world({ AI_BILLING: 'charged' });
  const a = await runProviderModel(admin.env, { userId: 1, model: MODEL, task: 'explain', request: REQUEST }, stubFetch(answered(USAGE)));
  assert.ok(a.ok);
  assert.equal(a.charged, 7530);
});

test('D851: a response with no readable usage settles at the policy\'s quote and says so, with the pricing version', async () => {
  // Mutation checked: missing usage read as zero settles at 0.
  for (const usage of [undefined, null, {}, { input_tokens: 10 }, { input_tokens: -1, output_tokens: 3 }, { input_tokens: 1.5, output_tokens: 3 }]) {
    const w = world();
    const r = await run(w.env, stubFetch(answered(usage)).fetch);
    assert.ok(r.ok, JSON.stringify(usage));
    const quote = providerQuoteMicro(providerModelById(MODEL)!, REQUEST, 1);
    assert.ok(quote > 0);
    assert.equal(r.charged, quote, JSON.stringify(usage));
    assert.equal(r.usageReported, false);
    const [row] = rows(w.db);
    assert.equal(row.charged_microusd, quote);
    assert.deepEqual(JSON.parse(row.units_json), { provider: 'anthropic', pricing_version: PROVIDER_PRICING_VERSION, usage_reported: false });
  }
});

test('D851: a provider price is exact decimals, rounded up once per run, never per unit', () => {
  // One token of each: 2 + 2.50 + 0.10 + 10 = 14.6 micro-USD → 15. Rounding each unit up would make 16.
  const rates = providerModelById(MODEL)!.rates;
  const one = { tokens_in: 1, tokens_cache_write: 1, tokens_cached: 1, tokens_out: 1 };
  assert.equal(usdRatesBilledMicro(rates, one, 1), 15);
  assert.equal(usdRatesBilledMicro(rates, one, 1.25), 19, '14.6 × 1.25 = 18.25 → 19');
  assert.throws(() => usdRatesBilledMicro(rates, { tokens_audio: 3 }, 1), /provider_unpriced/, 'a counted unit with no rate is refused, not free');
});

test('D851: the hold covers the input at the dearest input rate and every output token allowed', () => {
  // 'Be brief.' + the message = 40 characters → 14 tokens at 3 a token; 2,000 out.
  // At the cache-write rate: 14 × 2.50 + 2,000 × 10 = 20,035 micro-USD. At the input rate it would be 20,028.
  const m = providerModelById(MODEL)!;
  assert.equal(providerQuoteMicro(m, REQUEST, 1), 20035);
  assert.equal(providerQuoteMicro(m, REQUEST, 1.25), Math.ceil(20035 * 1.25));
});

test('D851: reported usage beyond the hold goes to a Super Admin\'s review, and the row records the charge as not known yet', async () => {
  // As run() does (D640): settleAiReservation marks the hold 'review' and throws; charged is NULL, never the quote.
  const w = world();
  const big = { input_tokens: 9000, output_tokens: 5000 }; // $0.068 against a $0.020035 hold
  const r = await run(w.env, stubFetch(answered(big)).fetch);
  assert.ok(r.ok);
  assert.equal(r.charged, null);
  assert.equal(holds(w.db)[0].status, 'review');
  assert.equal(holds(w.db)[0].recorded_cost_microusd, 68000);
  assert.equal(rows(w.db)[0].charged_microusd, null);
});

// ── errors ────────────────────────────────────────────────────────────────────

test('D851: a provider failure releases the hold and charges nothing, with the kind of failure', async () => {
  const cases: Array<[Reply, string, number | null]> = [
    [{ status: 429, headers: { 'retry-after': '7' }, body: { type: 'error', error: { type: 'rate_limit_error', message: 'x' } } }, 'rate_limited', 7],
    [{ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'x', details: { error_code: 'enforced_spend_limit_reached' } } } }, 'spend_limit', null],
    [{ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'x' } } }, 'overloaded', null],
    [{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'x' } } }, 'auth', null],
    [{ status: 402, body: { type: 'error', error: { type: 'billing_error', message: 'x' } } }, 'billing', null],
    [{ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'x' } } }, 'invalid', null],
    [{ status: 500, body: null }, 'server', null],
    [{ status: 200, body: { type: 'message' } }, 'server', null],
    [{ throws: true }, 'server', null],
  ];
  for (const [reply, kind, retry] of cases) {
    const w = world();
    const r = await run(w.env, stubFetch(reply).fetch);
    assert.deepEqual(r, { ok: false, refusal: 'all_models_failed', error: kind, retryAfterSec: retry }, JSON.stringify(reply));
    const [hold] = holds(w.db);
    // Mutation checked: settling a failure at the quote charges it.
    assert.equal(hold.status, 'refunded', kind);
    const [row] = rows(w.db);
    assert.equal(row.charged_microusd, 0, kind);
    assert.equal(row.refusal, 'all_models_failed');
    assert.equal(JSON.parse(row.units_json).error, kind);
  }
});

test('D851: a member with nothing left to hold is refused before any call', async () => {
  const w = world();
  setFixtureAllowance(w.db, 0);
  const f = stubFetch(answered(USAGE));
  const r = await run(w.env, f.fetch);
  assert.equal(r.ok, false);
  assert.notEqual((r as any).refusal, 'all_models_failed');
  assert.equal(f.calls.length, 0, 'no call without a hold');
});

test('D851: the adapter reads Anthropic\'s answer as the study records it', () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  const ok = anthropic.read(200, { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'A' }, { type: 'tool_use' }, { type: 'text', text: 'B' }], usage: { input_tokens: 5, output_tokens: 2 } }, h({ 'request-id': 'r1' }));
  assert.deepEqual(ok, { ok: true, output: 'AB', usage: { tokens_in: 5, tokens_cache_write: 0, tokens_cached: 0, tokens_out: 2 }, requestId: 'r1' });
  const bad = anthropic.read(429, { error: { details: { error_code: 'other' } } }, h({ 'retry-after': 'soon' }));
  assert.deepEqual(bad, { ok: false, error: 'rate_limited', status: 429, retryAfterSec: null, requestId: null });
});
