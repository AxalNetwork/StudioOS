/**
 * D760 (#2017) — every Workers AI model in one catalogue, priced exactly in
 * each unit Cloudflare bills, with the 25% margin as one constant behind a
 * billing switch left on cost.
 *
 * The fixture (`fixtures/workers_ai_catalogue.json`) is what was read from
 * Cloudflare's models page and pricing page on 2026-10-19, each row with its
 * source URLs. `services/ai/catalogue.ts` is the runtime copy, and the first
 * case holds the two equal: a price that moves is changed in both, on purpose.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_catalogue_d760.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOGUE, CATALOGUE_READ, isOffered, isPriced, partnerGated, refusalFor, defaultDemoted, modelById,
} from '../src/services/ai/catalogue.ts';
import { AI_MARKUP, billingMode, multiplierFor, costMicro, billedMicro, billedUnitPrice, unitPrice, USD_PER_NEURON } from '../src/services/ai/pricing.ts';
import {
  run, ROUTE, __resetForTest, estimateCostUsd, modelRefusal,
  PRICE_USD_PER_1M_TOKENS, PRICE_USD_PER_AUDIO_MINUTE, PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET,
} from '../src/services/aiRouter.ts';
import ai, { rateCard } from '../src/routes/ai.ts';
import { createJWT } from '../src/auth.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/workers_ai_catalogue.json'), 'utf8'));
const GATE_ON = { AI_PARTNER_MODELS: 'on' };
const GATE_OFF = {};

// ── the catalogue is what was read ───────────────────────────────────────────

test('the catalogue matches the fixture: every id, status and raw price string', () => {
  assert.equal(FIXTURE.read_on, CATALOGUE_READ.read_on);
  assert.equal(FIXTURE.pricing_page.last_updated, CATALOGUE_READ.pricing_page_updated);
  assert.deepEqual(CATALOGUE.map((m) => m.id), FIXTURE.models.map((m) => m.id), 'the same models, in the same order');
  for (const want of FIXTURE.models) {
    const got = modelById(want.id);
    for (const key of ['name', 'kind', 'capabilities', 'context_window', 'status', 'paid_only', 'partner', 'prices', 'neurons', 'docs_url']) {
      assert.deepEqual(got[key], want[key], `${want.id}: ${key}`);
    }
    // Every price is a decimal string exactly as printed, never a number.
    for (const [unit, raw] of Object.entries(got.prices)) {
      assert.equal(typeof raw, 'string', `${want.id} ${unit}`);
      assert.match(raw, /^\d+(\.\d+)?$/, `${want.id} ${unit}`);
      assert.ok(unit in FIXTURE.units, `${want.id} is priced in ${unit}, a unit the fixture does not name`);
    }
    // Every row cites where it was read.
    assert.ok(want.sources.length >= 1 && want.sources.every((u) => u.startsWith('https://developers.cloudflare.com/')), want.id);
    if (isPriced(got)) assert.ok(want.sources.includes(FIXTURE.pricing_page.url), `${want.id} is priced but cites no pricing page`);
  }
  // The pricing page's paid-only note, and nothing else, sets paid_only.
  assert.deepEqual(CATALOGUE.filter((m) => m.paid_only).map((m) => m.id).sort(), [...FIXTURE.paid_only_note.models].sort());
  // The counts as read on the day (recorded in D760.md).
  assert.equal(CATALOGUE.length, 92);
  assert.equal(CATALOGUE.filter(isPriced).length, 68);
});

// ── offered ──────────────────────────────────────────────────────────────────

test('offered means status ga or partner, with a price; an unpriced GA model never is', () => {
  for (const m of CATALOGUE) {
    const want = (m.status === 'ga' || m.status === 'partner') && isPriced(m);
    assert.equal(isOffered(m, GATE_ON), want, m.id);
  }
  const unpricedGa = CATALOGUE.filter((m) => m.status === 'ga' && !isPriced(m)).map((m) => m.id);
  assert.deepEqual(unpricedGa, ['@cf/lykon/dreamshaper-8-lcm', '@cf/google/embeddinggemma-300m', '@cf/meta/llama-3.1-8b-instruct-fast']);
  for (const id of unpricedGa) assert.equal(isOffered(modelById(id), GATE_ON), false, id);
  // A priced model that is retired is not offered: its row stays for past runs.
  assert.equal(isOffered(modelById('@cf/meta/llama-3.1-8b-instruct'), GATE_ON), false);
  assert.equal(CATALOGUE.filter((m) => isOffered(m, GATE_ON)).length, 60);
  assert.equal(CATALOGUE.filter((m) => isOffered(m, GATE_OFF)).length, 52);
});

test('the partner gate: new partner models only with AI_PARTNER_MODELS on; Nova-3 and Flux always', () => {
  const gated = CATALOGUE.filter(partnerGated).map((m) => m.id).sort();
  assert.deepEqual(gated, [
    '@cf/black-forest-labs/flux-2-dev', '@cf/black-forest-labs/flux-2-klein-4b', '@cf/black-forest-labs/flux-2-klein-9b',
    '@cf/deepgram/aura-1', '@cf/deepgram/aura-2-en', '@cf/deepgram/aura-2-es',
    '@cf/leonardo/lucid-origin', '@cf/leonardo/phoenix-1.0',
  ]);
  for (const id of gated) {
    assert.equal(isOffered(modelById(id), GATE_OFF), false, `${id} offered with the gate off`);
    assert.equal(isOffered(modelById(id), { AI_PARTNER_MODELS: 'yes' }), false, `${id} offered on a value other than 'on'`);
    assert.equal(isOffered(modelById(id), GATE_ON), true, `${id} not offered with the gate on`);
  }
  for (const id of ['@cf/deepgram/nova-3', '@cf/deepgram/flux']) {
    assert.equal(modelById(id).partner, true, id);
    assert.equal(isOffered(modelById(id), GATE_OFF), true, `${id} is gated, and it already runs (D657, D658)`);
  }
});

test('defaultDemoted follows AI_PAID_MODELS', () => {
  assert.equal(defaultDemoted({}), true);
  assert.equal(defaultDemoted({ AI_PAID_MODELS: 'off' }), true);
  assert.equal(defaultDemoted({ AI_PAID_MODELS: 'on' }), false);
});

// ── the margin is written once ───────────────────────────────────────────────

test('AI_MARKUP is defined in exactly one source file, and no price is multiplied by a literal 1.25', () => {
  const roots = ['../src', '../../frontend/src'];
  const definers = [];
  const multipliers = [];
  // A price, cost, rate or fee multiplied by 1.25, either way round.
  const PRICE_TIMES = /\b\w*(price|cost|rate|usd|fee|micro|billed|per_1m)\w*\b[^\n;]*\*\s*1\.25\b|\b1\.25\s*\*\s*[^\n;]*\b\w*(price|cost|rate|usd|fee|micro|billed|per_1m)\w*\b/i;
  const walk = (rel) => {
    for (const e of readdirSync(resolve(__dirname, rel), { withFileTypes: true })) {
      if (e.isDirectory()) { walk(join(rel, e.name)); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) continue;
      const p = join(rel, e.name);
      const src = readFileSync(resolve(__dirname, p), 'utf8');
      if (/\bAI_MARKUP\s*=\s*[\d.]/.test(src)) definers.push(p);
      for (const line of src.split('\n')) if (PRICE_TIMES.test(line)) multipliers.push(`${p}: ${line.trim()}`);
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(definers, ['../src/services/ai/pricing.ts']);
  assert.deepEqual(multipliers, []);
  assert.equal(AI_MARKUP, 1.25);
  // The comment names its source.
  const pricing = readFileSync(resolve(__dirname, '../src/services/ai/pricing.ts'), 'utf8');
  assert.match(pricing, /owner's canvas AIRail · every page, rail_logic\.js:74 usd\(\); D720 \(#1874\) §3\s*\*\/\s*export const AI_MARKUP = 1\.25;/);
  // And nothing charges it yet.
  assert.equal(billingMode({ AI_BILLING: 'billed' }), 'cost');
  assert.equal(multiplierFor('admin'), 1);
  assert.equal(multiplierFor('founder:studio'), AI_MARKUP);
});

// ── neurons are what is billed ───────────────────────────────────────────────

const PRICING_MD = readFileSync(resolve(__dirname, '../../design/incoming/airail-every-page-data/cloudflare-pricing-2026-10-15.md'), 'utf8');
/** The md's row for a model: the WebSocket row for a websocket unit, else the plain one. */
function mdRow(id, unit) {
  const ws = unit === 'audio_minutes_websocket';
  return PRICING_MD.split('\n').find((l) => l.startsWith(`| \`${id}\``) && /\(WebSocket\)/.test(l.split('|')[1]) === ws);
}

test('every priced row carries the neuron figure Cloudflare prints, and its price is neurons × $0.000011', () => {
  assert.equal(USD_PER_NEURON, '0.000011', '$0.011 per 1,000 neurons');
  let rows = 0;
  for (const m of CATALOGUE) {
    const priced = Object.keys(m.prices);
    if (!priced.length) { assert.equal(m.neurons, undefined, `${m.id} has neurons but no price`); continue; }
    assert.deepEqual(Object.keys(m.neurons ?? {}).sort(), priced.sort(), `${m.id}: a neuron figure for every priced unit`);
    for (const [unit, n] of Object.entries(m.neurons)) {
      assert.match(n, /^\d+(\.\d+)?$/, `${m.id} ${unit}`);
      const row = mdRow(m.id, unit);
      assert.ok(row, `${m.id} (${unit}) has no row in S1's pricing copy`);
      const figures = row.replace(/(\d),(\d)/g, '$1$2').match(/(?<![$\d.])\d+(\.\d+)?(?![\d.])/g) ?? [];
      assert.ok(figures.includes(n), `${m.id} ${unit}: ${n} neurons is not printed on its row`);
      // The price served is the exact product, not the page's rounded dollar column.
      assert.ok(Math.abs(Number(unitPrice(m.id, unit)) - Number(n) * 0.000011) < 1e-15, `${m.id} ${unit}`);
      // And the dollar column is that product rounded: within half its last printed digit.
      const printed = m.prices[unit];
      const half = 0.5 * 10 ** -((printed.split('.')[1] ?? '').length);
      assert.ok(Math.abs(Number(printed) - Number(n) * 0.000011) <= half + 1e-15 || m.id === '@cf/pipecat-ai/smart-turn-v2',
        `${m.id} ${unit}: $${printed} is not ${n} neurons rounded`);
    }
    rows += 1;
  }
  assert.equal(rows, 68);
  // Smart Turn v2 is the one row whose two columns disagree: 0.51 neurons is
  // $0.00000561, where the dollar column prints $0.00033795. It is priced from
  // the neurons, as every row is (D760.md).
  assert.equal(unitPrice('@cf/pipecat-ai/smart-turn-v2', 'audio_minutes'), '0.00000561');
  assert.equal(unitPrice('@cf/no/such-model', 'tokens_in'), null);
  assert.equal(unitPrice('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'tiles'), null);
});

// ── exact decimals ───────────────────────────────────────────────────────────

test('exact decimals: a run rounds up once, and 0.293348 × 1.25 is served as 0.366685', () => {
  // FLUX.1 Schnell: 0.0000528 per tile is 52.8 micro-USD. Five tiles are 264.0
  // micro-USD; rounding each tile up first would make it 265.
  assert.equal(costMicro('@cf/black-forest-labs/flux-1-schnell', { tiles: 5 }), 264);
  assert.equal(costMicro('@cf/black-forest-labs/flux-1-schnell', { tiles: 1 }), 53);
  // Tiles and steps sum before rounding: 4 × 52.8 + 4 × 105.6 = 633.6 → 634.
  assert.equal(costMicro('@cf/black-forest-labs/flux-1-schnell', { tiles: 4, steps: 4 }), 634);
  // Billed rounds once over the multiplied total, not cost rounded then multiplied:
  // 5 tiles × 1.25 = 330.0, where ceil(264) × 1.25 = 330 too, so use one tile:
  // 52.8 × 1.25 = 66.0 exactly, where ceil(52.8) × 1.25 = 66.25 → 67.
  assert.equal(billedMicro('@cf/black-forest-labs/flux-1-schnell', { tiles: 1 }, AI_MARKUP), 66);
  assert.equal(billedMicro('@cf/black-forest-labs/flux-1-schnell', { tiles: 1 }, 1), 53);

  // The 70b's input is 26,668 neurons per 1M tokens: 0.293348, billed 0.366685.
  assert.equal(unitPrice('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'tokens_in'), '0.293348');
  assert.equal(billedUnitPrice('0.293348', 1.25), 0.366685);
  assert.equal(billedUnitPrice('0.293', 1.25), 0.36625);
  assert.notEqual(parseFloat('0.293') * 1.25, 0.36625, 'the float product is why this multiplies exactly');
  // The canvas's display formula, `Number(x.toPrecision(4))`, gives 0.3662 on
  // its own float product of the rounded dollar column. On the exact figure
  // from the same dollar column it gives 0.3663, and on the neuron figure the
  // Worker serves, 0.3667 (recorded in D760.md for D769's price strings).
  assert.equal(Number((0.293 * 1.25).toPrecision(4)), 0.3662);
  assert.equal(Number(billedUnitPrice('0.293', 1.25).toPrecision(4)), 0.3663);
  assert.equal(billedUnitPrice('0.0000528', 1.25), 0.000066);
  assert.equal(billedUnitPrice('0.293', 1), 0.293);
  assert.equal(Number(billedUnitPrice('0.293348', 1.25).toPrecision(4)), 0.3667);

  // Tokens per million, characters per thousand, images per million.
  assert.equal(costMicro('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { tokens_in: 1000, tokens_out: 500 }), 1420);
  // Aura 1 is 1,363.64 neurons per 1k characters: 0.01500004 USD, so 2,000
  // characters are 30.00008 micro-USD over a thousand, rounded up once: 30001.
  assert.equal(costMicro('@cf/deepgram/aura-1', { characters: 2000 }), 30001);
  assert.equal(costMicro('@cf/microsoft/resnet-50', { images: 1 }), 3);
  assert.equal(costMicro('@cf/deepgram/nova-3', { audio_minutes_websocket: 2 }), 18400);
});

test('cached input is billed at its own rate, and only where the model prints one', () => {
  // GLM-5.3: 127,273 neurons in and 23,636 cached per 1M, so 600k at 1.400003
  // + 400k cached at 0.259996 = 0.9440002 USD, rounded up once: 944001 micro.
  assert.equal(costMicro('@cf/zai-org/glm-5.3', { tokens_in: 1_000_000, tokens_cached: 400_000 }), 944001);
  // No cached tokens reported: every input token at the input rate.
  assert.equal(costMicro('@cf/zai-org/glm-5.3', { tokens_in: 1_000_000 }), 1400003);
  // A model with no cached rate bills cached tokens at the input rate.
  assert.equal(costMicro('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { tokens_in: 1_000_000, tokens_cached: 400_000 }), 293348);
  // The router's estimate does the same (V4 Flash: 40,000 in, 1,273 cached).
  const flash = '@cf/deepseek-ai/deepseek-v4-flash-0731';
  assert.ok(Math.abs(estimateCostUsd(flash, 1_000_000, 0, 0, 500_000) - (0.5 * 0.44 + 0.5 * 0.014003)) < 1e-12);
  assert.ok(Math.abs(estimateCostUsd(flash, 1_000_000, 0) - 0.44) < 1e-12);
});

test('a unit the model is not priced in, or a model with no price, is refused rather than free', () => {
  assert.throws(() => costMicro('@cf/lykon/dreamshaper-8-lcm', { tiles: 1 }), /model_unpriced/);
  assert.throws(() => costMicro('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { tiles: 1 }), /model_unpriced/);
  assert.throws(() => costMicro('@cf/no/such-model', { tokens_in: 1 }), /model_unpriced/);
  assert.throws(() => estimateCostUsd('@cf/lykon/dreamshaper-8-lcm', 10, 10), /model_unpriced/);
});

// ── one source of prices ─────────────────────────────────────────────────────

test('the router\'s price tables are views of the catalogue', () => {
  for (const [id, p] of Object.entries(PRICE_USD_PER_1M_TOKENS)) {
    assert.deepEqual(p, { in: Number(unitPrice(id, 'tokens_in')), out: Number(unitPrice(id, 'tokens_out') ?? '0') }, id);
  }
  for (const [id, perMinute] of Object.entries(PRICE_USD_PER_AUDIO_MINUTE)) {
    assert.equal(perMinute, Number(unitPrice(id, 'audio_minutes')), id);
  }
  for (const [id, perMinute] of Object.entries(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET)) {
    assert.equal(perMinute, Number(unitPrice(id, 'audio_minutes_websocket')), id);
  }
  // BGE Base EN v1.5 moved to its published price: 6,058 neurons per 1M tokens.
  assert.equal(PRICE_USD_PER_1M_TOKENS['@cf/baai/bge-base-en-v1.5'].in, 0.066638);
});

test('every model ROUTE can reach is priced and offered with no owner switch set', () => {
  const routed = new Set();
  for (const e of Object.values(ROUTE)) {
    routed.add(e.model);
    for (const m of e.fallbackChain ?? []) routed.add(m);
    for (const m of e.alternates ?? []) routed.add(m);
  }
  for (const id of routed) assert.equal(modelRefusal({}, id), null, `${id} would be refused`);
});

// ── refusals ─────────────────────────────────────────────────────────────────

function routerEnv(ai) {
  return { AI: ai, DB: aiBudgetFixture().DB };
}
/** A Workers AI stub that records the models called; D763's guard answers safe and is not recorded. */
function makeAI() {
  const calls = [];
  return withGuard({ calls, async run(model) { calls.push(model); return { response: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1 } }; } });
}

/** Run `tool_call` with its fallback chain swapped for one model, then put it back. */
async function runWithFallback(model, env) {
  const saved = ROUTE.tool_call.fallbackChain;
  ROUTE.tool_call.fallbackChain = [model];
  try {
    __resetForTest();
    return await run(env, { task: 'tool_call', userId: 0, messages: [{ role: 'user', content: 'hi' }] });
  } finally {
    ROUTE.tool_call.fallbackChain = saved;
  }
}

test('refusals: model_unpriced, and model_not_offered for a beta model', async () => {
  assert.equal(refusalFor('@cf/lykon/dreamshaper-8-lcm', GATE_OFF), 'model_unpriced');
  assert.equal(refusalFor('@cf/no/such-model', GATE_OFF), 'model_unpriced');
  assert.equal(refusalFor('@cf/llava-hf/llava-1.5-7b-hf', GATE_OFF), 'model_not_offered');
  assert.equal(refusalFor('@cf/meta/llama-3.1-8b-instruct', GATE_OFF), 'model_not_offered');
  assert.equal(refusalFor('@cf/deepgram/aura-1', GATE_OFF), 'model_not_offered');
  assert.equal(refusalFor('@cf/deepgram/aura-1', GATE_ON), null);
  // Offered by the catalogue, but in none of the router's price views: unpriced here.
  // (D857 priced m2m100 for translate_segment; bge-m3 is still in no view.)
  assert.equal(modelRefusal(GATE_ON, '@cf/baai/bge-m3'), 'model_unpriced');
  // D761 PR 3 put Aura in the router's character view, so with the gate on it may run.
  assert.equal(modelRefusal(GATE_ON, '@cf/deepgram/aura-1'), null);

  for (const [model, want] of [
    ['@cf/lykon/dreamshaper-8-lcm', 'model_unpriced'],
    ['@cf/llava-hf/llava-1.5-7b-hf', 'model_not_offered'],
  ]) {
    const aiStub = makeAI();
    const r = await runWithFallback(model, routerEnv(aiStub));
    assert.equal(r.ok, false, model);
    assert.equal(r.refusal, want, model);
    assert.equal(r.usage.est_cost_usd, 0);
    assert.deepEqual(aiStub.calls, [], `${model}: no model is called once one in the chain is refused`);
  }
  // The same chain with a priced, offered fallback runs.
  const aiStub = makeAI();
  const ok = await runWithFallback('@cf/meta/llama-3.1-8b-instruct-fp8', routerEnv(aiStub));
  assert.equal(ok.ok, true);
  assert.deepEqual(aiStub.calls, ['@cf/qwen/qwen2.5-coder-32b-instruct']);
});

// ── the reads ────────────────────────────────────────────────────────────────

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
function routeEnv(userId, role, extra = {}) {
  const stub = (q) => {
    const api = {
      bind: () => api,
      first: async () => (/FROM user_sessions/i.test(q) ? { revoked_at: null, step_up_due_at: null } : null),
      all: async () => ({
        results: /FROM\s+users/i.test(q) ? [{ id: userId, email: `u${userId}@example.test`, role, is_active: 1, name: 'U' }] : [],
      }),
      run: async () => ({ meta: { changes: 0 } }),
    };
    return api;
  };
  return { JWT_SECRET, DB: { prepare: stub, exec: async () => ({ count: 0, duration: 0 }) }, ...extra };
}
async function get(path, userId, role, extra) {
  const env = routeEnv(userId, role, extra);
  const token = await createJWT(env, userId, `u${userId}@example.test`, role, undefined, `jti-${userId}-${path}`);
  const res = await ai.request(path, { headers: { authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() };
}

test('/catalogue serves the offered models, cost and billed, ordered by kind with the safety model last', async () => {
  const { status, body } = await get('/catalogue', 41, 'founder');
  assert.equal(status, 200);
  assert.equal(body.billing, 'cost');
  assert.deepEqual(body.guard, { every_run: false });
  assert.equal(body.models.length, 52, 'the gate is off, so the eight new partner models are not offered');
  assert.equal(body.models.at(-1).id, ROUTE.safety.model, 'Safety is last');
  assert.ok(!body.models.some((m) => m.id === '@cf/deepgram/aura-1'));
  const kinds = body.models.slice(0, -1).map((m) => m.kind);
  assert.equal(kinds[0], 'Text Generation');
  for (let i = 1; i < kinds.length; i += 1) {
    if (kinds[i] !== kinds[i - 1]) assert.ok(!kinds.slice(0, i - 1).includes(kinds[i]), `${kinds[i]} appears in two runs`);
  }
  const m = body.models.find((x) => x.id === '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.deepEqual(Object.keys(m).sort(), ['billed', 'context_window', 'cost', 'id', 'kind', 'name', 'paid_only', 'partner', 'status'].sort());
  assert.deepEqual(m.cost, { tokens_in: 0.293348, tokens_out: 2.252855 });
  assert.deepEqual(m.billed, { tokens_in: 0.366685, tokens_out: billedUnitPrice('2.252855', 1.25) });
  assert.equal(m.context_window, 24000);
  const v4 = body.models.find((x) => x.id === '@cf/deepseek-ai/deepseek-v4-flash-0731');
  assert.equal(v4.paid_only, true);
  assert.equal(v4.cost.tokens_cached, 0.014003);

  const on = await get('/catalogue', 41, 'founder', GATE_ON);
  assert.equal(on.body.models.length, 60);
  assert.ok(on.body.models.some((x) => x.id === '@cf/deepgram/aura-1'));
});

test('the admin licence gets cost on /catalogue, /pricing and /rates', async () => {
  const cat = await get('/catalogue', 7, 'admin');
  for (const m of cat.body.models) assert.deepEqual(m.billed, m.cost, m.id);
  const pricing = await get('/pricing', 7, 'admin');
  for (const [id, r] of Object.entries(pricing.body.rates)) assert.deepEqual(r.billed, r.cost, id);
  const rates = await get('/rates', 7, 'admin');
  for (const m of rates.body.models) assert.deepEqual(m.billed, m.cost, m.id);
});

test('/pricing and /rates answer cost and billed in every unit, websocket rates included', async () => {
  const pricing = await get('/pricing', 41, 'founder');
  assert.equal(pricing.status, 200);
  assert.equal(pricing.body.billing, 'cost');
  // The fields the rail already reads are unchanged.
  assert.deepEqual(pricing.body.prices, JSON.parse(JSON.stringify(PRICE_USD_PER_1M_TOKENS)));
  assert.deepEqual(pricing.body.audio_prices, PRICE_USD_PER_AUDIO_MINUTE);
  const nova = pricing.body.rates['@cf/deepgram/nova-3'];
  assert.deepEqual(nova.cost, { audio_minutes: 0.00520003, audio_minutes_websocket: 0.00919996 });
  assert.deepEqual(nova.billed, { audio_minutes: billedUnitPrice('0.00520003', 1.25), audio_minutes_websocket: billedUnitPrice('0.00919996', 1.25) });
  assert.deepEqual(pricing.body.rates['@cf/deepgram/flux'].cost, { audio_minutes_websocket: 0.0077 });
  assert.deepEqual(pricing.body.rates['@cf/meta/llama-3.3-70b-instruct-fp8-fast'].billed, { tokens_in: 0.366685, tokens_out: billedUnitPrice('2.252855', 1.25) });

  const rates = await get('/rates', 41, 'founder');
  assert.equal(rates.status, 200);
  assert.equal(rates.body.billing, 'cost');
  assert.deepEqual(rates.body.models, JSON.parse(JSON.stringify(rateCard('founder:free'))));
  const flux = rates.body.models.find((m) => m.id === '@cf/deepgram/flux');
  assert.equal(flux.per_audio_minute_websocket_usd, 0.0077);
  assert.deepEqual(flux.billed, { audio_minutes_websocket: billedUnitPrice('0.0077', 1.25) });
  assert.equal(rates.body.models.find((m) => m.id === '@cf/deepgram/nova-3').per_audio_minute_websocket_usd, 0.00919996);
  for (const m of rates.body.models) {
    assert.ok(Object.keys(m.cost).length > 0 && Object.keys(m.billed).length === Object.keys(m.cost).length, m.id);
  }
});

test('the reads need a session', async () => {
  for (const path of ['/catalogue', '/pricing', '/rates']) {
    const res = await ai.request(path, {}, routeEnv(41, 'founder'));
    assert.notEqual(res.status, 200, path);
  }
});
