/**
 * D786 (#2211) part 1 — `GET /api/public/ai/models`, the Pricing page's
 * Models tab: every model the router offers, at the price a member pays,
 * with only public fields, cached, rate limited and with no D1.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/public_ai_models_d786.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import publicRoutes from '../src/routes/public.ts';
import { publicModels, NEW_MODEL_IDS, UNIT_WORDS } from '../src/services/ai/publicModels.ts';
import { catalogueFor } from '../src/routes/ai.ts';
import { CATALOGUE, modelById } from '../src/services/ai/catalogue.ts';
import { AI_MARKUP, billedUnitPrice, unitPrice } from '../src/services/ai/pricing.ts';
import { railOptionRows, railRows } from '../src/services/ai/railMatrix.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FIELDS = ['billed', 'id', 'is_new', 'kind', 'name', 'paid_only', 'pages', 'unit_words'];

async function get(env: Record<string, unknown> = {}) {
  // No DB: the read must not touch D1.
  const res = await publicRoutes.request('/ai/models', {}, env as any);
  return { res, body: await res.json() as any };
}

test('anyone reads it: 200 with no session, and every model carries exactly the public fields', async () => {
  const { res, body } = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['models', 'ok']);
  assert.ok(body.models.length > 20, `${body.models.length} models`);
  for (const m of body.models) assert.deepEqual(Object.keys(m).sort(), [...FIELDS].sort(), m.id);
  // Every key at every depth: a page name such as "Operating Partner · Home" is a value, not a field.
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
  };
  walk(body);
  for (const internal of ['cost', 'neurons', 'licence', 'multiplier', 'status', 'partner', 'fallback_chain', 'alternates', 'docs_url', 'context_window', 'capabilities', 'markup', 'prices']) {
    assert.equal(keys.has(internal), false, `an internal field leaked: ${internal}`);
  }
});

test('the models are the ones the router offers, priced as a member pays (cost × AI_MARKUP), with the words for each unit', async () => {
  const { body } = await get();
  const member = catalogueFor({} as any, 'member').models;
  assert.deepEqual(body.models.map((m: any) => m.id), member.map((m: any) => m.id).sort((a: string, b: string) =>
    CATALOGUE.findIndex((c) => c.id === a) - CATALOGUE.findIndex((c) => c.id === b)), 'the same offered set, in the catalogue\'s order');
  for (const m of body.models) {
    const cat = modelById(m.id)!;
    assert.equal(m.name, cat.name);
    assert.equal(m.kind, cat.kind);
    assert.equal(m.paid_only, cat.paid_only);
    for (const [unit, usd] of Object.entries(m.billed)) {
      const cost = unitPrice(m.id, unit as any)!;
      assert.equal(usd, billedUnitPrice(cost, AI_MARKUP), `${m.id} ${unit}`);
      assert.ok((usd as number) > Number(cost), `${m.id} ${unit} is billed above cost`);
      assert.equal(m.unit_words[unit], UNIT_WORDS[unit as keyof typeof UNIT_WORDS]);
    }
    assert.deepEqual(Object.keys(m.unit_words).sort(), Object.keys(m.billed).sort());
  }
  // The 70B, as every rail row's default text model, is priced per 1M tokens in and out.
  const llama = body.models.find((m: any) => m.id === '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.deepEqual(Object.keys(llama.billed).sort(), ['tokens_in', 'tokens_out']);
  assert.equal(llama.unit_words.tokens_in, 'per 1M input tokens');
});

test('the owner\'s switches decide what is offered: partner models only while AI_PARTNER_MODELS is on', async () => {
  const off = (await get()).body.models.map((m: any) => m.id);
  const on = (await get({ AI_PARTNER_MODELS: 'on' })).body.models.map((m: any) => m.id);
  assert.ok(on.length > off.length, 'the partner gate opens more models');
  assert.ok(on.includes('@cf/deepgram/aura-2-es') && !off.includes('@cf/deepgram/aura-2-es'));
});

test('pages are the matrix\'s canvas page names that name each model; New and Paid-only are flagged', async () => {
  const { body } = await get({ AI_PARTNER_MODELS: 'on' });
  const want = new Map<string, Set<string>>();
  for (const row of [...railRows(), ...railOptionRows()]) for (const m of row.models) {
    if (!want.has(m.id)) want.set(m.id, new Set());
    want.get(m.id)!.add(row.pageKey);
  }
  for (const m of body.models) assert.deepEqual(new Set(m.pages), want.get(m.id) ?? new Set(), m.id);
  assert.ok(body.models.some((m: any) => m.pages.length > 0), 'some model is used on a page');
  assert.ok(body.models.some((m: any) => m.is_new), 'a New model is flagged');
  for (const m of body.models) assert.equal(m.is_new, NEW_MODEL_IDS.has(m.id));
  // The Worker's New list is the rail's: twelve display names, twelve catalogue ids, each a real model.
  const rail = read('../frontend/src/ui/railModels.js');
  const names = rail.slice(rail.indexOf('export const NEW_MODELS = new Set(['), rail.indexOf(']);', rail.indexOf('export const NEW_MODELS'))).match(/'[^']+'/g) ?? [];
  assert.equal(NEW_MODEL_IDS.size, names.length);
  for (const id of NEW_MODEL_IDS) assert.ok(modelById(id), id);
});

test('cached at the edge for five minutes, rate limited per IP, and served without the schema bootstrap', async () => {
  const { res } = await get();
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=300');
  const limits = read('src/middleware/rateLimit.ts');
  assert.match(limits, /name: 'public_ai_models',\s+limit: 60,\s+windowSec: 60,\s+test: \(p, m\) => m === 'GET' && p === '\/api\/public\/ai\/models',\s+scope: 'ip',/);
  assert.match(read('src/index.ts'), /'\/api\/public\/ai\/models',/);
  // The service's model list equals the route's.
  assert.deepEqual(publicModels({}).map((m) => m.id), (await get()).body.models.map((m: any) => m.id));
});
