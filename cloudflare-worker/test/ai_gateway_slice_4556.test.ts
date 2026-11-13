/**
 * D4556 (#4556) — one third-party model through AI Gateway (Path A), on the
 * Workers AI binding, metered on D851's ledger, hold and row. The binding is a
 * stub answering `Response`s: no live call is made, no gateway exists, and the
 * guard answers through `_guard_stub.mjs` (it fails closed). Real SQLite with
 * the AI budget migrations (`_ai_budget_fixture.mjs`); member 2 has a $50
 * monthly allowance. Prices and policy are held to `fixtures/ai_gateway_4556.json`,
 * which carries each page and the date it was read.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_gateway_slice_4556.test.ts
 */
import test from 'node:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import assert from 'node:assert/strict';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { GUARD_MODEL, withGuard } from './_guard_stub.mjs';
import {
  ADVISOR_TASKS, GATEWAY_JITTER_MS, GATEWAY_LOG_PAYLOAD_HEADER, GATEWAY_MAX_ATTEMPTS, GATEWAY_RETRY_BUDGET_MS, GATEWAY_RETRY_BASE_MS,
  advisorReach, gatewayConfig, gatewayProviderRows, gatewayQuoteMicro, gatewayRetryDelayMs, runGatewayTextModel,
} from '../src/services/aiProviders.ts';
import {
  CATALOGUE, GATEWAY_TEXT_MODELS, GATEWAY_TEXT_SLUG_VAR, GATEWAY_TEXT_SWITCH, GATEWAY_TEXT_ZDR_VAR, PROVIDER_MODELS,
  gatewayTextEligibility, gatewayTextModelById,
} from '../src/services/ai/catalogue.ts';
import { chatCompletions, chatUsage, logCarriesNoPayload, retryAfterSeconds } from '../src/services/ai/providers/gateway.ts';
import { ROUTE } from '../src/services/aiRouter.ts';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/ai_gateway_4556.json', import.meta.url), 'utf8'));
const MODEL = 'openai/gpt-5-mini';
const SLUG = 'providers-slice';
const ME = 2;
const REQUEST = { system: 'Write three short bullets.', messages: [{ role: 'user' as const, content: 'Sector heat rose in four of six regions this quarter.' }], maxTokens: 400 };

const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const rows = (db: any) => db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all().map((r: any) => ({ ...r }));
const runRows = (db: any) => rows(db).filter((r: any) => r.model !== GUARD_MODEL);
const holds = (db: any) => db.prepare('SELECT * FROM ai_budget_reservations ORDER BY created_at').all().map((r: any) => ({ ...r }));
const units = (r: any) => JSON.parse(r.units_json);

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | 'hang' | { throws: string };
/** A stub binding: each model call takes the next reply (the last repeats); guard calls never reach it. */
function stubAi(replies: Reply[], verdict?: unknown) {
  const calls: { model: string; input: any; options: any }[] = [];
  const ai: any = {
    async run(model: string, input: unknown, options: unknown) {
      calls.push({ model, input, options });
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r === 'hang') return new Promise(() => {});
      if ('throws' in (r as any)) throw new Error((r as any).throws);
      const x = r as Exclude<Reply, 'hang' | { throws: string }>;
      return new Response(x.body === undefined ? null : JSON.stringify(x.body), { status: x.status ?? 200, headers: x.headers ?? {} });
    },
  };
  withGuard(ai, verdict as any);
  return { ai, calls };
}

const answer = (over: Record<string, unknown> = {}, usage: unknown = { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 120 } }) => ({
  status: 200,
  headers: { 'cf-aig-log-id': 'log_test_1' },
  body: {
    id: 'chatcmpl-test', object: 'chat.completion', model: 'gpt-5-mini-2025-08-07',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Heat rose in most regions.', refusal: null } }],
    usage, gatewayMetadata: { keySource: 'Unified' }, ...over,
  },
});

function world(env: Record<string, unknown> = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(migration('510_member_ai_pauses.sql') + migration('525_ai_reservation_idempotency.sql') + migration('632_ai_hold_context.sql'));
  return { db, env: { DB, [GATEWAY_TEXT_SWITCH]: 'on', [GATEWAY_TEXT_SLUG_VAR]: SLUG, [GATEWAY_TEXT_ZDR_VAR]: 'on', CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing', ...env } as any };
}

let runs = 0;
const sleeps: number[] = [];
const deps = (_ai: any, extra: Record<string, unknown> = {}) => ({ attemptTimeoutMs: 1000, timeoutMs: 5000, random: () => 0.5, sleep: async (ms: number) => { sleeps.push(ms); }, ...extra });
const run = (env: any, ai: any, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  runGatewayTextModel({ ...env, AI: ai }, { userId: ME, model: MODEL, task: 'publication', dataClass: 'public', request: REQUEST, executionId: `exec-gw-${++runs}`, ...over } as any, deps(ai, extra) as any);

// ── the row, its price and its policy, from the fixture ───────────────────────

test('D4556: the gateway row carries the model page\'s printed rates, ZDR yes, its page and the date; it is in no other catalogue', () => {
  const m = gatewayTextModelById(MODEL)!;
  const f = FIXTURE.model;
  assert.deepEqual({ ...m.rates }, f.rates_usd_per_1m);
  assert.equal(m.contextTokens, f.context_tokens);
  assert.equal(m.zdr, f.zero_data_retention);
  assert.equal(m.source, f.source);
  assert.equal(m.read, f.read);
  assert.ok(f.example_served_model.startsWith(m.servedModelPrefix));
  for (const k of ['unified_billing', 'logging', 'limits']) {
    assert.match(FIXTURE[k].source, /^https:\/\/developers\.cloudflare\.com\/ai-gateway\//, k);
    assert.equal(FIXTURE[k].read, '2026-11-06', k);
  }
  assert.deepEqual(GATEWAY_TEXT_MODELS.map((x) => x.id), [MODEL]);
  assert.ok(!CATALOGUE.some((c: any) => c.id === MODEL) && !PROVIDER_MODELS.some((p) => p.id === MODEL));
  // Never an alias, a dynamic route or the auto router: Axal picks the model (D4556 §3).
  for (const x of GATEWAY_TEXT_MODELS) assert.ok(!/^(custom|dynamic)\/|^cloudflare\/auto$/.test(x.id), x.id);
  // Text only: nothing is claimed it does not do here.
  assert.deepEqual({ ...m.capabilities }, { text: true, streaming: false, tools: false, structured_output: false, vision: false });
  for (const [task, r] of Object.entries(ROUTE)) assert.equal((r as any).provider, 'workers-ai', task);
});

test('D4556: the workload policy: ZDR not confirmed refuses everything; one task; only public data', () => {
  const m = gatewayTextModelById(MODEL)!;
  assert.equal(gatewayTextEligibility(m, 'publication', 'public'), null);
  // Mutation checked: dropping the ZDR line makes the first two pass.
  assert.equal(gatewayTextEligibility({ ...m, zdr: 'unknown' }, 'publication', 'public'), 'zdr_not_confirmed');
  assert.equal(gatewayTextEligibility({ ...m, zdr: 'no' }, 'publication', 'public'), 'zdr_not_confirmed');
  assert.equal(gatewayTextEligibility(m, 'explain', 'public'), 'task_not_eligible');
  for (const c of ['internal', 'confidential', 'restricted', 'PUBLIC', undefined, null, '']) assert.equal(gatewayTextEligibility(m, 'publication', c), 'data_class_not_approved', String(c));
});

// ── refusals that make no call ────────────────────────────────────────────────

const noCall = (w: any, s: any) => {
  assert.equal(s.calls.length, 0, 'no call to the binding');
  assert.equal(holds(w.db).length, 0, 'nothing held');
};

test('D4556: off unless the switch is exactly "on": no call, no hold, no row', async () => {
  // Mutation checked: a truthy check runs 'true', 'ON' and '1'.
  for (const value of [undefined, '', 'true', 'ON', 'off', '1']) {
    const w = world({ [GATEWAY_TEXT_SWITCH]: value });
    const s = stubAi([answer()]);
    assert.deepEqual(await run(w.env, s.ai), { ok: false, refusal: 'model_not_offered' }, String(value));
    noCall(w, s);
    assert.equal(rows(w.db).length, 0);
  }
  const w = world();
  const s = stubAi([answer()]);
  assert.deepEqual(await run(w.env, s.ai, { model: 'openai/not-a-row' }), { ok: false, refusal: 'model_not_offered' });
  noCall(w, s);
});

test('D4556: missing config is misconfigured, naming what is missing and never a value: no call, no hold, one row', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ [GATEWAY_TEXT_SLUG_VAR]: undefined }, GATEWAY_TEXT_SLUG_VAR],
    [{ [GATEWAY_TEXT_SLUG_VAR]: 'Not A Slug!' }, GATEWAY_TEXT_SLUG_VAR],
    // Mutation checked: without the own-gateway check the Advisor's gateway (and its logging) would carry this traffic.
    [{ [GATEWAY_TEXT_SLUG_VAR]: 'advisor-ongoing' }, `${GATEWAY_TEXT_SLUG_VAR}:own_gateway`],
    [{ [GATEWAY_TEXT_SLUG_VAR]: 'deck-gw', CF_AI_GATEWAY_SLUG_DECK: 'deck-gw' }, `${GATEWAY_TEXT_SLUG_VAR}:own_gateway`],
    [{ [GATEWAY_TEXT_ZDR_VAR]: 'yes' }, GATEWAY_TEXT_ZDR_VAR],
    [{ [GATEWAY_TEXT_ZDR_VAR]: undefined }, GATEWAY_TEXT_ZDR_VAR],
  ];
  for (const [env, missing] of cases) {
    const w = world(env);
    const s = stubAi([answer()]);
    const r = await run(w.env, s.ai);
    assert.deepEqual(r, { ok: false, refusal: 'misconfigured', missing: [missing] }, missing);
    noCall(w, s);
    const [row] = rows(w.db);
    assert.equal(row.refusal, 'misconfigured');
    assert.equal(row.charged_microusd, 0);
    assert.ok(!row.units_json.includes('advisor-ongoing') && !row.units_json.includes('deck-gw'), 'names only, never a value');
  }
  const w = world();
  assert.deepEqual(gatewayConfig(w.env), { ok: false, missing: ['AI'] });
});

test('D4556: an unsupported task kind or an unapproved data class makes no call', async () => {
  for (const task of ['explain', 'rail_chat', 'dd_synthesis', 'paraphrase']) {
    const w = world(); const s = stubAi([answer()]);
    assert.deepEqual(await run(w.env, s.ai, { task }), { ok: false, refusal: 'task_not_eligible' }, task);
    noCall(w, s);
  }
  for (const dataClass of ['internal', 'confidential', 'restricted', 'personal', undefined, 'Public']) {
    const w = world(); const s = stubAi([answer()]);
    // Mutation checked: reading a missing class as public sends it.
    assert.deepEqual(await run(w.env, s.ai, { dataClass }), { ok: false, refusal: 'data_class_not_approved' }, String(dataClass));
    noCall(w, s);
  }
  const w = world(); const s = stubAi([answer()]);
  assert.deepEqual(await run(w.env, s.ai, { request: { ...REQUEST, maxTokens: 200_000 } }), { ok: false, refusal: 'invalid_input' });
  noCall(w, s);
});

test('D4556: the Advisor is never served: its tasks, surfaces and pages are refused before any call', async () => {
  for (const over of [
    { task: 'advisor_explain' }, { task: 'advisor_turn' }, { task: 'onboarding_chat' },
    { surface: '/advisor/explain' }, { railPage: 'Advisor' }, { railOption: 'advisor:turn' },
  ]) {
    const w = world(); const s = stubAi([answer()]);
    // Mutation checked: removing `advisorReach` lets `{ surface: '/advisor/explain' }` with task publication run.
    assert.deepEqual(await run(w.env, s.ai, over), { ok: false, refusal: 'surface_not_eligible' }, JSON.stringify(over));
    noCall(w, s);
  }
  assert.ok(ADVISOR_TASKS.includes('advisor_explain') && ADVISOR_TASKS.includes('advisor_turn'));
  assert.equal(advisorReach({ task: 'publication', surface: '/admin/publications' }), false);
  assert.equal(advisorReach({ task: 'publication', surface: '/advisors/network' }), false, 'the advisors network is not the Advisor');
});

test('D4556: the page\'s AI switch, the hold\'s refusals and the admission seam each refuse with no call', async () => {
  const off = world();
  off.db.exec("CREATE TABLE ai_rail_preferences(uid TEXT, user_id INTEGER, section TEXT, task TEXT, model TEXT, mode TEXT)");
  off.db.prepare("INSERT INTO ai_rail_preferences(uid, user_id, section, task, mode) VALUES ('off', ?, 'publications', '', 'manual')").run(ME);
  let s = stubAi([answer()]);
  assert.deepEqual(await run(off.env, s.ai, { railPage: 'publications' }), { ok: false, refusal: 'assist_off' });
  noCall(off, s);

  const broke = world();
  setFixtureAllowance(broke.db, 0);
  s = stubAi([answer()]);
  assert.deepEqual(await run(broke.env, s.ai), { ok: false, refusal: 'insufficient_tokens' });
  assert.equal(s.calls.length, 0);
  assert.equal(runRows(broke.db)[0].refusal, 'insufficient_tokens');

  for (const admit of [async () => ({ ok: false as const, retryAfterSec: 3 }), async () => { throw new Error('admission store down'); }]) {
    const w = world(); s = stubAi([answer()]);
    const r = await run(w.env, s.ai, {}, { admit });
    assert.equal(r.ok, false);
    assert.equal((r as any).refusal, 'capacity_unavailable');
    noCall(w, s);
  }
  // Admitted: the lease is released once, after the run.
  const w = world(); s = stubAi([answer()]);
  let released = 0;
  const r = await run(w.env, s.ai, {}, { admit: async () => ({ ok: true as const, release: () => { released++; } }) });
  assert.equal(r.ok, true);
  assert.equal(released, 1);
});

// ── the request ───────────────────────────────────────────────────────────────

test('D4556: the call is the model\'s own chat input on the binding, payload logging off, the gateway\'s own retries off', async () => {
  const w = world(); const s = stubAi([answer()]);
  const logged: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try { assert.equal((await run(w.env, s.ai)).ok, true); } finally { Object.assign(console, keep); }
  const [call] = s.calls;
  assert.equal(call.model, MODEL);
  assert.deepEqual(call.input, {
    messages: [{ role: 'system', content: 'Write three short bullets.' }, { role: 'user', content: 'Sector heat rose in four of six regions this quarter.' }],
    max_completion_tokens: 400,
  });
  assert.ok(!('stream' in call.input) && !('temperature' in call.input) && !('input' in call.input));
  // Mutations checked: dropping either line below fails here.
  assert.equal(call.options.gateway.collectLog, false);
  assert.equal(call.options.extraHeaders[GATEWAY_LOG_PAYLOAD_HEADER], 'false');
  assert.equal(GATEWAY_LOG_PAYLOAD_HEADER, 'cf-aig-collect-log-payload');
  assert.equal(call.options.gateway.id, SLUG);
  assert.equal(call.options.gateway.skipCache, true);
  assert.deepEqual(call.options.gateway.retries, { maxAttempts: 1 });
  assert.equal(call.options.returnRawResponse, true);
  assert.ok(call.options.signal instanceof AbortSignal);
  const meta = call.options.gateway.metadata;
  assert.ok(Object.keys(meta).length <= 5, 'Cloudflare takes five metadata entries');
  assert.deepEqual(Object.keys(meta), ['branch', 'account', 'task', 'execution']);
  assert.ok(!JSON.stringify(meta).includes('@'), 'never an email');
  // Nothing logs, or writes to the row, the prompt or the answer.
  assert.ok(!logged.some((l) => l.includes('Sector heat') || l.includes('Heat rose')));
  assert.ok(!JSON.stringify(rows(w.db)).includes('Sector heat') && !JSON.stringify(rows(w.db)).includes('Heat rose'));
});

// ── settlement ────────────────────────────────────────────────────────────────

test('D4556: success settles once from the reported usage at the printed rates; one attributable row', async () => {
  // (1,000 − 200) × $0.25 + 200 × $0.025 + 500 × $2.00, per 1M = $0.001205 = 1,205 micro-USD.
  // Mutation checked: cached tokens also billed at the input rate charges 1,255.
  const w = world(); const s = stubAi([answer()]);
  const r = await run(w.env, s.ai);
  assert.equal(r.ok, true);
  assert.equal((r as any).charged, 1205);
  assert.equal((r as any).usageReported, true);
  assert.equal((r as any).servedModel, 'gpt-5-mini-2025-08-07');
  assert.equal((r as any).gatewayLogId, 'log_test_1');
  const [hold] = holds(w.db);
  assert.equal(holds(w.db).length, 1);
  assert.equal(hold.status, 'settled');
  const [row] = runRows(w.db);
  assert.equal(runRows(w.db).length, 1);
  assert.equal(row.id, (r as any).usageLogId);
  assert.equal(row.model, MODEL);
  assert.equal(row.task, 'publication');
  assert.equal(row.refusal, null);
  assert.equal(row.charged_microusd, 1205);
  assert.equal(row.reservation_uid, hold.uid);
  assert.equal(row.prompt_tokens, 1000);
  assert.equal(row.completion_tokens, 500);
  assert.deepEqual(units(row), {
    provider: 'openai', via: 'ai_gateway', billing: 'unified', pricing_version: 'g1-2026-11-06', data_class: 'public',
    usage_reported: true, tokens_in: 800, tokens_cached: 200, tokens_out: 500, reasoning_tokens: 120,
    served_model: 'gpt-5-mini-2025-08-07', key_source: 'Unified', finish_reason: 'stop', gateway_log_id: 'log_test_1', attempts: 1,
  });
});

test('D4556: missing or unreadable usage is never read as zero: the provider part settles at its quote and the row says so', async () => {
  for (const usage of [null, { completion_tokens: 5 }, { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 11 } }, { prompt_tokens: -1, completion_tokens: 2 }]) {
    const w = world(); const s = stubAi([answer({}, usage)]);
    const r = await run(w.env, s.ai);
    const quote = gatewayQuoteMicro(gatewayTextModelById(MODEL)!, REQUEST, 1);
    assert.equal(r.ok, true, JSON.stringify(usage));
    assert.equal((r as any).usageReported, false);
    // Mutation checked: reporting 0 for missing usage charges nothing here.
    assert.equal((r as any).charged, quote);
    const u = units(runRows(w.db)[0]);
    assert.equal(u.usage_reported, false);
    assert.equal(u.reconcile, 'gateway_log');
    assert.ok(!('tokens_in' in u) && !('tokens_out' in u), 'no invented counts');
  }
  // The reader alone: exact, inclusive cached, reasoning inside the output.
  assert.deepEqual(chatUsage({ prompt_tokens: 30, completion_tokens: 754, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 256 } }),
    { usage: { tokens_in: 30, tokens_cached: 0, tokens_out: 754 }, reasoning: 256 });
  assert.equal(chatUsage({ prompt_tokens: 1.5, completion_tokens: 2 }), null);
});

test('D4556: replay of a finished execution is refused, calls nothing more and charges once', async () => {
  const w = world(); const s = stubAi([answer()]);
  const over = { executionId: 'exec-gw-replay' };
  assert.equal((await run(w.env, s.ai, over)).ok, true);
  assert.deepEqual(await run(w.env, s.ai, over), { ok: false, refusal: 'execution_closed' });
  assert.equal(s.calls.length, 1);
  assert.equal(holds(w.db).length, 1);
  const charged = runRows(w.db).filter((r: any) => r.charged_microusd > 0);
  assert.equal(charged.length, 1, 'one charge');
  assert.equal(runRows(w.db).filter((r: any) => r.refusal == null).length, 1, 'one answered row');
});

// ── failures ──────────────────────────────────────────────────────────────────

const failsWith = async (replies: Reply[], extra: Record<string, unknown> = {}) => {
  const w = world(); const s = stubAi(replies);
  sleeps.length = 0;
  const r = await run(w.env, s.ai, {}, extra) as any;
  return { w, s, r, row: runRows(w.db)[0], hold: holds(w.db)[0] };
};

test('D4556: auth, billing, invalid and server failures are not retried; the hold charges nothing; one row', async () => {
  const cases: Array<[Reply, string, 'none' | 'unknown']> = [
    [{ status: 401, body: { errors: [{ code: 2009, message: 'Credential error' }] } }, 'auth', 'none'],
    [{ status: 403, body: { errors: [{ code: 2049, message: 'Gateway authentication is required to use unified billing.' }] } }, 'auth', 'none'],
    [{ status: 403, body: { errors: [{ code: 2049, message: 'Insufficient balance; add money to your gateway or use BYOK' }] } }, 'billing', 'none'],
    [{ status: 402, body: { errors: [{ code: 2052, message: 'Insufficient balance' }] } }, 'billing', 'none'],
    [{ status: 400, body: { errors: [{ code: 7003, message: 'User Input Error' }] } }, 'invalid', 'none'],
    [{ status: 500, body: null }, 'server', 'unknown'],
    [{ status: 502, body: { errors: [{ code: 7033 }] } }, 'server', 'unknown'],
  ];
  for (const [reply, error, completion] of cases) {
    const { s, r, row, hold } = await failsWith([reply, answer()]);
    assert.equal(s.calls.length, 1, error);
    assert.equal(r.refusal, 'all_models_failed');
    assert.equal(r.error, error);
    assert.equal(r.completion, completion);
    assert.equal(hold.status === 'settled' || hold.status === 'released', true);
    assert.equal(row.charged_microusd, 0, 'nothing charged');
    assert.equal(units(row).error, error);
    assert.equal(units(row).completion, completion);
    if (completion === 'unknown') assert.equal(units(row).reconcile, 'gateway_log');
  }
});

test('D4556: a malformed 2xx is unreadable, completion unknown, not retried, charges nothing', async () => {
  for (const body of [null, { choices: [] }, { choices: [{ message: { content: '' } }] }, { choices: 'x' }]) {
    const { s, r, row } = await failsWith([{ status: 200, body }]);
    assert.equal(s.calls.length, 1);
    assert.equal(r.error, 'server');
    assert.equal(r.completion, 'unknown');
    assert.equal(row.charged_microusd, 0);
  }
});

test('D4556: the model refusing is permanent: provider_refused, its reported usage kept for reconciliation', async () => {
  const refused = answer({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: 'I cannot help with that.' } }] });
  const { s, r, row } = await failsWith([refused]);
  assert.equal(s.calls.length, 1);
  assert.equal(r.refusal, 'provider_refused');
  assert.equal(r.error, 'refused');
  assert.equal(row.charged_microusd, 0);
  assert.equal(units(row).reported_tokens_out, 500);
  const filtered = await failsWith([answer({ choices: [{ index: 0, finish_reason: 'content_filter', message: { role: 'assistant', content: 'x' } }] })]);
  assert.equal(filtered.r.refusal, 'provider_refused');
});

test('D4556: a 429 waits its retry-after plus jitter, retries within the budget, and settles once', async () => {
  const { s, r, w } = await failsWith([{ status: 429, headers: { 'retry-after': '1' }, body: { errors: [{ code: 2018, message: 'Unified billing rate limit exceeded' }] } }, answer()]);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(s.calls.length, 2);
  // 1 s from retry-after, plus half the jitter (random() is 0.5 here).
  assert.deepEqual(sleeps, [1000 + GATEWAY_JITTER_MS / 2]);
  assert.equal(holds(w.db).length, 1, 'one hold for every attempt');
  assert.equal(runRows(w.db).length, 1, 'one row');
  assert.equal(r.charged, 1205);
});

test('D4556: a retry-after beyond the budget ends the run with it; attempts are bounded', async () => {
  const long = await failsWith([{ status: 429, headers: { 'retry-after': '30' }, body: { errors: [{ code: 2018 }] } }]);
  assert.equal(long.s.calls.length, 1);
  assert.equal(long.r.error, 'rate_limited');
  assert.equal(long.r.retryAfterSec, 30);
  assert.deepEqual(sleeps, []);
  // Mutation checked: without the attempt bound this calls until the retry budget runs out.
  const busy = await failsWith([{ status: 429, headers: { 'retry-after': '0' }, body: { errors: [{ code: 2018 }] } }]);
  assert.equal(busy.s.calls.length, GATEWAY_MAX_ATTEMPTS);
  assert.equal(busy.r.error, 'rate_limited');
  assert.equal(busy.row.charged_microusd, 0);
  assert.equal(units(busy.row).attempts, GATEWAY_MAX_ATTEMPTS);
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= GATEWAY_RETRY_BUDGET_MS);
});

test('D4556: an overload (503, 7005) backs off with jitter and retries; a thrown 2018 is a rate limit too', async () => {
  const { s, r } = await failsWith([{ status: 503, body: { errors: [{ code: 7005 }] } }, { status: 503, body: { errors: [{ code: 7005 }] } }, answer()]);
  assert.equal(r.ok, true);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(sleeps, [GATEWAY_RETRY_BASE_MS + GATEWAY_JITTER_MS / 2, 2 * GATEWAY_RETRY_BASE_MS + GATEWAY_JITTER_MS / 2]);
  const thrown = await failsWith([{ throws: 'AiGatewayError: 2018: Unified billing rate limit exceeded for this gateway.' }, answer()]);
  assert.equal(thrown.r.ok, true);
  assert.equal(thrown.s.calls.length, 2);
  // A throw that does not say what happened is unknown completion, never retried.
  const odd = await failsWith([{ throws: 'socket closed' }, answer()]);
  assert.equal(odd.s.calls.length, 1);
  assert.equal(odd.r.error, 'unknown');
  assert.equal(odd.r.completion, 'unknown');
});

test('D4556: a timeout is not "no work done": never retried, nothing charged, the row says completion unknown', async () => {
  const { s, r, row, hold } = await failsWith(['hang', answer()], { attemptTimeoutMs: 20 });
  // Mutation checked: retrying a timeout calls twice and could pay for the work twice.
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].options.signal.aborted, true, 'the call is aborted');
  assert.equal(r.error, 'timeout');
  assert.equal(r.completion, 'unknown');
  assert.ok(hold.status === 'settled' || hold.status === 'released');
  assert.equal(row.charged_microusd, 0);
  assert.equal(units(row).completion, 'unknown');
  assert.equal(units(row).reconcile, 'gateway_log');
  // A 504 from the gateway is the same.
  const gw = await failsWith([{ status: 504, body: null }, answer()]);
  assert.equal(gw.s.calls.length, 1);
  assert.equal(gw.r.error, 'timeout');
  assert.equal(gw.r.completion, 'unknown');
});

test('D4556: an answer from another model, or on another credential, is withheld: terms_mismatch, no fallback', async () => {
  for (const over of [{ model: 'gpt-4o-mini-2024-07-18' }, { model: undefined }, { gatewayMetadata: { keySource: 'BYOK' } }, { gatewayMetadata: undefined }]) {
    const { s, r, row } = await failsWith([answer(over), answer()]);
    // Mutation checked: without the pin these answer ok.
    assert.deepEqual(r, { ok: false, refusal: 'terms_mismatch', attempts: 1 }, JSON.stringify(over));
    assert.equal(s.calls.length, 1, 'never re-sent elsewhere');
    assert.equal(row.refusal, 'terms_mismatch');
    assert.equal(row.charged_microusd, 0);
    assert.equal(units(row).reconcile, 'gateway_log');
  }
});

// ── the guard (D763) ──────────────────────────────────────────────────────────

test('D4556: the guard fails closed on both sides; an unsafe input calls no model', async () => {
  const unsafeInput = (input: any) => (input.messages.length === 1 ? 'unsafe\nS1' : 'safe');
  let w = world(); let s = stubAi([answer()], unsafeInput);
  assert.deepEqual(await run(w.env, s.ai), { ok: false, refusal: 'guard_blocked' });
  assert.equal(s.calls.length, 0);
  assert.equal(runRows(w.db)[0].refusal, 'guard_blocked');
  assert.ok(rows(w.db).some((r: any) => r.model === GUARD_MODEL && r.guard_for === runRows(w.db)[0].id), 'the guard row names the run');

  w = world(); s = stubAi([answer()], 'not a verdict');
  assert.deepEqual(await run(w.env, s.ai), { ok: false, refusal: 'guard_unavailable' });
  assert.equal(s.calls.length, 0);

  const unsafeOutput = (input: any) => (input.messages.length === 2 ? 'unsafe\nS1' : 'safe');
  w = world(); s = stubAi([answer()], unsafeOutput);
  assert.deepEqual(await run(w.env, s.ai), { ok: false, refusal: 'guard_blocked_output' });
  assert.equal(s.calls.length, 1);
  // The model ran and is charged, as run() charges a withheld answer (D763).
  assert.equal(runRows(w.db)[0].charged_microusd, 1205);
});

// ── the pieces alone ──────────────────────────────────────────────────────────

test('D4556: retry-after, the delay and the adapter\'s error kinds', () => {
  assert.equal(retryAfterSeconds(null), null);
  assert.equal(retryAfterSeconds(''), null);
  assert.equal(retryAfterSeconds('2'), 2);
  assert.equal(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT'), null, 'a date is not read as seconds');
  assert.equal(gatewayRetryDelayMs(1, 2, () => 0), 2000);
  assert.equal(gatewayRetryDelayMs(1, null, () => 1), GATEWAY_RETRY_BASE_MS + GATEWAY_JITTER_MS);
  assert.equal(gatewayRetryDelayMs(2, null, () => 0), 2 * GATEWAY_RETRY_BASE_MS);
  const h = (x: Record<string, string>) => (n: string) => x[n] ?? null;
  assert.deepEqual(chatCompletions.read(429, { errors: [{ code: 2018 }] }, h({ 'retry-after': '5', 'cf-aig-log-id': 'L' })),
    { ok: false, error: 'rate_limited', completion: 'none', code: 2018, status: 429, retryAfterSec: 5, logId: 'L', usage: null });
  assert.equal((chatCompletions.read(529, null, h({})) as any).error, 'overloaded');
  assert.equal((chatCompletions.read(408, null, h({})) as any).completion, 'unknown');
});

test('D4556: the payload check reads a gateway log entry: no request or response head', () => {
  assert.equal(logCarriesNoPayload({ request_head: '', response_head: undefined }), true);
  assert.equal(logCarriesNoPayload({}), true);
  assert.equal(logCarriesNoPayload({ request_head: '{"messages":[{"role":"user"', response_head: '' }), false);
  assert.equal(logCarriesNoPayload({ request_head: null, response_head: '{"choices"' }), false);
  assert.equal(logCarriesNoPayload(null), false, 'no entry read is not proof');
});

test('D4556: the admin read says off, missing config or enabled, with names only', () => {
  const [off] = gatewayProviderRows({} as any);
  assert.equal(off.state, 'off');
  assert.equal(off.switch.on, false);
  const [missing] = gatewayProviderRows({ [GATEWAY_TEXT_SWITCH]: 'on' } as any);
  assert.equal(missing.state, 'missing_config');
  assert.deepEqual(missing.config.missing, [GATEWAY_TEXT_SLUG_VAR, GATEWAY_TEXT_ZDR_VAR, 'AI']);
  const [on] = gatewayProviderRows({ [GATEWAY_TEXT_SWITCH]: 'on', [GATEWAY_TEXT_SLUG_VAR]: SLUG, [GATEWAY_TEXT_ZDR_VAR]: 'on', AI: { run() {} } } as any);
  assert.equal(on.state, 'enabled');
  assert.equal(on.zdr, 'yes');
  assert.deepEqual(on.workloads, [{ task: 'publication', data_classes: ['public'] }]);
  assert.ok(!JSON.stringify(on).includes(SLUG), 'the gateway id is not echoed');
});

// ── the Advisor stays on Workers AI ───────────────────────────────────────────

const SRC = resolve(dirname(new URL(import.meta.url).pathname), '../src');
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    const spec = m[1] ?? m[2];
    const base = resolve(dirname(file), spec);
    for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) { out.push(c); break; }
  }
  return out;
}
export function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f) || !f.endsWith('.ts')) continue;
    seen.add(f);
    queue.push(...importsOf(f));
  }
  return seen;
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});
const ADVISOR_ENTRIES = [
  join(SRC, 'routes/advisor.ts'), join(SRC, 'routes/_advisor_cohort_helpers.ts'), join(SRC, 'routes/admin_advisor_audit.ts'),
  ...walk(join(SRC, 'services/advisor')),
];

test('D4556: no module the Advisor loads reaches the provider execution service or its adapters', () => {
  const graph = reachable(ADVISOR_ENTRIES);
  assert.ok(graph.has(join(SRC, 'services/aiRouter.ts')), 'the walk does reach the router, so it is reading imports');
  // Mutation checked: adding `import '../aiProviders';` to services/advisor/rerank.ts fails here, naming the file.
  for (const forbidden of ['services/aiProviders.ts', 'services/ai/providers/index.ts', 'services/ai/providers/gateway.ts', 'services/ai/providers/anthropic.ts']) {
    assert.ok(!graph.has(join(SRC, forbidden)), `${forbidden} is reachable from the Advisor`);
  }
});

test('D4556: the gateway path adds no Anthropic reference to production source (no-anthropic-in-prod)', () => {
  // The guard's own pattern. Its standalone run already fails on main for D851's files; this slice adds no file to that list.
  const PATTERN = /anthropic\.com|claude-[a-z0-9-]+|ANTHROPIC/;
  const before = new Set(['routes/auth.ts', 'routes/dashboard.ts', 'services/ai/catalogue.ts', 'services/ai/providers/anthropic.ts', 'services/aiProviders.ts']);
  const allow = new Set(['routes/assistant.ts', 'types.ts', 'index.ts']);
  const hits = walk(SRC).map((f) => relative(SRC, f)).filter((f) => !allow.has(f) && !readFileSync(join(SRC, f), 'utf8').includes('@anthropic-dev-only')
    && PATTERN.test(readFileSync(join(SRC, f), 'utf8')));
  for (const f of hits) assert.ok(before.has(f), `${f} is a new no-anthropic-in-prod violation`);
  assert.ok(!PATTERN.test(readFileSync(join(SRC, 'services/ai/providers/gateway.ts'), 'utf8')));
});
