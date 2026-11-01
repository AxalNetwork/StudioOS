/**
 * D1504 (#3755, deck v2 A11) — catalogue drift, model terms, unavailability and
 * the deck's AI Gateway.
 *
 *   1. Drift: every routed id is a priced `ga`/`partner` catalogue model doing
 *      its kind of work; removing one from the catalogue fails.
 *   2. Terms: a grandfathered model runs; a model neither grandfathered nor
 *      reviewed is refused `model_terms_unreviewed`; MODEL_TERMS.md lists every
 *      grandfathered and every routed model.
 *   3. Unavailability: "model not found" marks the model in KV for an hour; the
 *      next run skips it without a call and the chain answers, named truly.
 *   4. Gateway: inert while the slug is empty (all three wrangler tables); once
 *      set, a deck run never reads a cache, keeps no log, carries ≤ 5 metadata
 *      entries and is never re-sent un-gatewayed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, isOffered, modelById } from '../src/services/ai/catalogue.ts';
import { driftProblems, routedModels } from '../src/services/ai/routedModels.ts';
import { GRANDFATHERED, REVIEWED, termsCleared, termsOf } from '../src/services/ai/modelTerms.ts';
import { UNAVAILABLE_TTL_S, isUnavailable, markUnavailable, meansUnavailable } from '../src/services/ai/availability.ts';
import { ROUTE, deckGatewayOptionFor, isDeckRun, modelRefusal, modelRefusalWords, run as aiRun, __resetForTest } from '../src/services/aiRouter.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';

const DOC = readFileSync('documentation/architecture/MODEL_TERMS.md', 'utf8');
const TOML = readFileSync('wrangler.toml', 'utf8');

test('1. drift: every routed id is a priced ga/partner model doing its kind of work, and removing one fails', () => {
  const routed = routedModels();
  assert.ok(routed.length >= 50, `the routed set parsed (${routed.length})`);
  assert.deepEqual(driftProblems(), []);
  // Mutation-shaped: the catalogue without one routed id, or with one retired, or unpriced.
  const victim = routed.find((r) => r.where.some((w) => w.startsWith('element:')))!.id;
  assert.match(driftProblems((id) => (id === victim ? null : modelById(id))).join('\n'), new RegExp(`${victim.replace(/[/.]/g, '\\$&')} .* is not in the catalogue`));
  assert.match(driftProblems((id) => (id === victim ? { ...modelById(id)!, status: 'deprecated' } : modelById(id))).join('\n'), /is deprecated, not ga or partner/);
  assert.match(driftProblems((id) => (id === victim ? { ...modelById(id)!, prices: {} } : modelById(id))).join('\n'), /has no price/);
  // Every task's route is in it.
  for (const e of Object.values(ROUTE) as any[]) assert.ok(routed.some((r) => r.id === e.model), e.model);
});

test('2. terms: grandfathered runs, unreviewed is refused, and the register lists every grandfathered and routed model', () => {
  const offeredOnMain = CATALOGUE.filter((m) => isOffered(m, { AI_PARTNER_MODELS: 'on' } as any)).map((m) => m.id);
  assert.deepEqual([...GRANDFATHERED].sort(), offeredOnMain.sort(), 'grandfathered is what main ran when the register began');
  for (const r of routedModels()) assert.ok(GRANDFATHERED.includes(r.id), `${r.id} is routed and grandfathered`);
  assert.deepEqual(Object.keys(REVIEWED), [], 'owner question X: nothing reviewed yet');
  const env = { AI_PARTNER_MODELS: 'on' } as any;
  const m = GRANDFATHERED[0];
  assert.equal(modelRefusal(env, m), null, 'a grandfathered model runs');
  assert.equal(modelRefusal(env, m, () => false), 'model_terms_unreviewed', 'the same model, unreviewed and not grandfathered, does not');
  assert.match(modelRefusalWords(m, 'model_terms_unreviewed'), /waiting on a review of its terms/);
  assert.equal(termsCleared('@cf/synthetic/new-model'), false, 'a model the register does not know is not cleared');
  const t = termsOf(m);
  assert.deepEqual([t.grandfathered, t.licence, t.reviewed_on, t.reviewed_by], [true, null, null, null], 'never guessed');
  for (const id of GRANDFATHERED) assert.ok(DOC.includes(`| \`${id}\` |`), `MODEL_TERMS.md lists ${id}`);
  const docIds = [...DOC.matchAll(/^\| `(@[^`]+)` \|/gm)].map((x) => x[1]);
  assert.deepEqual(docIds.sort(), [...GRANDFATHERED].sort(), 'and nothing else');
  assert.match(DOC, /Not recorded/);
});

function kv() {
  const store = new Map<string, { v: string; ttl?: number }>();
  return { store, async get(k: string) { return store.get(k)?.v ?? null; }, async put(k: string, v: string, o?: { expirationTtl?: number }) { store.set(k, { v, ttl: o?.expirationTtl }); } };
}

test('3. unavailable: not found marks the model for an hour, the next run skips it, and the chain answers', async () => {
  // Mutation checked: callWai not reading isUnavailable → the second run calls the retired model again.
  assert.equal(meansUnavailable({ ok: false, status: 404 }), true);
  assert.equal(meansUnavailable({ ok: false, status: 400, code: 5007 }), true);
  assert.equal(meansUnavailable({ ok: false, status: 403, code: 5035 }), false, 'a plan answer, the model exists');
  assert.equal(meansUnavailable({ ok: false, status: 500, error: 'No such model @cf/x' }), true);
  assert.equal(meansUnavailable({ ok: false, status: 429, code: 3040 }), false, 'capacity is not absence');
  assert.equal(meansUnavailable({ ok: true }), false);
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();
  const RATE_LIMITS = kv();
  const route: any = ROUTE.paraphrase;
  const [primary, sibling] = [route.model, route.fallbackChain[0]];
  const calls: string[] = [];
  const ai = { run: async (model: string) => { calls.push(model); if (model === primary) throw new Error(`No such model ${model}`); return { response: 'answer', usage: { prompt_tokens: 3, completion_tokens: 2 } }; } };
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', AI: withGuard(ai), RATE_LIMITS };
  try {
    const first = await aiRun(env, { task: 'paraphrase', userId: 2, text: 'synthetic words' });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(calls.filter((m) => m !== '@cf/meta/llama-guard-3-8b'), [primary, sibling]);
    assert.deepEqual([first.usage?.model, first.usage?.fallback_used], [sibling, true], 'the model that answered is the one named');
    assert.equal(RATE_LIMITS.store.get(`ai_unavailable:${primary}`)?.ttl, UNAVAILABLE_TTL_S);
    assert.equal(await isUnavailable(env, primary), true);
    calls.length = 0;
    const second = await aiRun(env, { task: 'paraphrase', userId: 2, text: 'synthetic words again' });
    assert.equal(second.ok, true);
    assert.deepEqual(calls.filter((m) => m !== '@cf/meta/llama-guard-3-8b'), [sibling], 'the retired model is skipped without a call');
    // A KV that cannot be read or written skips and marks nothing.
    const broken: any = { RATE_LIMITS: { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } } };
    assert.equal(await isUnavailable(broken, primary), false);
    await markUnavailable(broken, primary, 5007);
  } finally { f.db.close(); }
});

test('4. the deck gateway: inert while empty, and once set no cache, no log, no retry, ≤ 5 metadata entries', () => {
  // Mutation checked: skipCache false → this fails.
  const slugs = [...TOML.matchAll(/^CF_AI_GATEWAY_SLUG_DECK\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
  assert.deepEqual(slugs, ['', '', ''], 'all three wrangler tables, empty until the owner creates the gateway');
  const deck = { task: 'rail_write' as any, rail: { page: 'Founder · Raise · Pitch deck', option: 'deck:rewrite' }, userId: 7 };
  assert.equal(isDeckRun(deck), true);
  assert.equal(isDeckRun({ task: 'deck_image' as any }), true);
  assert.equal(isDeckRun({ task: 'rail_write' as any, rail: { page: 'Founder · Grow', option: 'draft:post' } }), false);
  assert.equal(deckGatewayOptionFor({ CF_AI_GATEWAY_SLUG_DECK: '' } as any, deck), undefined, 'inert while empty');
  assert.equal(deckGatewayOptionFor({} as any, deck), undefined);
  const opt = deckGatewayOptionFor({ CF_AI_GATEWAY_SLUG_DECK: 'deck-runs' } as any, deck)!;
  assert.equal(opt.gateway.id, 'deck-runs');
  assert.equal(opt.gateway.skipCache, true, 'a variant is never served from cache');
  assert.equal(opt.gateway.collectLog, false, 'no prompt or answer in the gateway logs');
  assert.ok(Object.keys(opt.gateway.metadata).length <= 5);
  assert.deepEqual(Object.keys(opt.gateway.metadata), ['branch', 'account', 'task', 'option']);
  assert.equal(deckGatewayOptionFor({ CF_AI_GATEWAY_SLUG_DECK: 'deck-runs' } as any, { task: 'paraphrase' as any }), undefined, 'not a deck run');
  // No deck task caches its answer in the router either.
  for (const task of ['deck_image', 'rail_write', 'rail_edit_image']) assert.equal((ROUTE as any)[task]?.cacheTtlSec, undefined, task);
});
