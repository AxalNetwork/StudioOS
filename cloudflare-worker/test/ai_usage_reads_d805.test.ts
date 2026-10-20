// D805 (#2243) — the Usage console's two missing reads: cost by kind with
// "no output recorded" on `GET /api/ai-budget/cost` (and its CSV), and today's
// token-pack orders on `GET /api/ai-budget/limit`, counted by the same
// function the purchase check refuses with. Real SQLite with migrations 419,
// 430, 486, 493 and 505 (`_ai_budget_fixture.mjs`). Each case names the
// mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_usage_reads_d805.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import { KIND_GROUP, KIND_GROUPS, costCsv, kindGroupOf, memberCost, pricedPerOutputToken } from '../src/services/aiCost.ts';
import { TOKEN_PACK_LIMITS, packOrdersToday, recentPackOrders } from '../src/services/aiCredits.ts';
import { CATALOGUE } from '../src/services/ai/catalogue.ts';

const ME = 2;
const OTHER = 3;
const NOW = new Date('2026-10-20T12:00:00Z');
const TEXT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GUARD = '@cf/meta/llama-guard-3-8b';
const SPEECH_IN = '@cf/openai/whisper-large-v3-turbo';
const SPEECH_OUT = '@cf/deepgram/aura-1';
const IMAGE_OUT = '@cf/black-forest-labs/flux-1-schnell';
const IMAGE_IN = '@cf/llava-hf/llava-1.5-7b-hf';
const EMBED = '@cf/baai/bge-base-en-v1.5';
const DETECT = '@cf/facebook/detr-resnet-50';
const UNKNOWN = '@cf/nowhere/not-in-the-catalogue';

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/ai-budget', budgetRoute);
  return a;
}

function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd805-fixture-only-secret', ENVIRONMENT: 'development' } as any;
  const insertRun = f.db.prepare(`INSERT INTO ai_usage_logs(user_id,task,model,created_at,prompt_tokens,completion_tokens,est_cost_usd,
      charged_microusd,units_json,refusal,cached,guard_for) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const run = (o: { model: string; at?: string; in?: number; out?: number; cost?: number; charged?: number | null;
    refusal?: string | null; cached?: boolean; guardFor?: number | null; user?: number }) =>
    Number(insertRun.run(o.user ?? ME, 'paraphrase', o.model, o.at ?? '2026-10-12 10:00:00', o.in ?? 0, o.out ?? 0, o.cost ?? 0,
      o.charged === undefined ? 0 : o.charged, null, o.refusal ?? null, o.cached ? 1 : 0, o.guardFor ?? null).lastInsertRowid);
  let n = 0;
  /** One pack order, `hoursAgo` before now, as `ai_topup_purchases` records it. */
  const order = (hoursAgo: number, user = ME, credited = true) => {
    n += 1;
    f.db.prepare(`INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,
        credited_at,created_at) VALUES(?,?,?,?,?,?,'usd',?,datetime('now', ?))`)
      .run(`pi_d805_${n}`, `MRD-d805-${n}`, user, 'price_pack25', 25_000_000, 2500, credited ? '2026-10-20 00:00:00' : null, `-${hoursAgo} hours`);
  };
  return { f, env, run, order };
}

async function call(w: any, path: string, user: number) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) };
}

// 1 ───────────────────────────────────────────────────────────────────────────
// Mutations: a kind missing from KIND_GROUP; Image-to-Text placed under tokens.
test('KIND_GROUP places every catalogue kind, on the canvas\'s four lines', () => {
  const kinds = [...new Set(CATALOGUE.map((m) => m.kind))];
  for (const k of kinds) assert.ok(KIND_GROUP[k], `the catalogue kind "${k}" has no cost line`);
  assert.deepEqual(KIND_GROUPS, ['tokens', 'audio_speech', 'image', 'other']);
  for (const g of Object.values(KIND_GROUP)) assert.ok(KIND_GROUPS.includes(g));
  assert.deepEqual([TEXT, EMBED, GUARD].map(kindGroupOf), ['tokens', 'tokens', 'tokens']);
  assert.deepEqual([SPEECH_IN, SPEECH_OUT].map(kindGroupOf), ['audio_speech', 'audio_speech']);
  assert.deepEqual([IMAGE_OUT, IMAGE_IN].map(kindGroupOf), ['image', 'image']);
  assert.deepEqual([DETECT, UNKNOWN].map(kindGroupOf), ['other', 'other']);
});

// 2 ───────────────────────────────────────────────────────────────────────────
// Mutations: an unknown model dropped from by_kind; other_models left empty;
// a guard row counted under the run's model rather than its own.
test('runs on text, speech and image models land in their kinds; an unknown model lands in other and is named', async () => {
  const w = world();
  const id = w.run({ model: TEXT, in: 100, out: 40, cost: 0.0001, charged: 125 });
  w.run({ model: GUARD, in: 120, out: 2, cost: 0.00002, charged: 25, guardFor: id });
  w.run({ model: SPEECH_IN, cost: 0.001, charged: 1250 });
  w.run({ model: SPEECH_OUT, cost: 0.0002, charged: 250 });
  w.run({ model: IMAGE_OUT, cost: 0.003, charged: 3750 });
  w.run({ model: DETECT, cost: 0.00001, charged: 12 });
  w.run({ model: UNKNOWN, cost: 0.004, charged: 5000 });
  w.run({ model: UNKNOWN, user: OTHER, cost: 9, charged: 9_000_000 });
  const r = await memberCost(w.env, ME, 'mtd', 'model', NOW);
  assert.deepEqual(r.totals.by_kind, {
    tokens: { cost_usd: 0.00012, charged_microusd: 150 },
    audio_speech: { cost_usd: 0.0012, charged_microusd: 1500 },
    image: { cost_usd: 0.003, charged_microusd: 3750 },
    other: { cost_usd: 0.00401, charged_microusd: 5012 },
  });
  assert.deepEqual(r.totals.other_models, [DETECT, UNKNOWN].sort(), 'every model in other is named, the unknown one too');
  const sum = Object.values(r.totals.by_kind).reduce((a, k) => a + (k.charged_microusd ?? 0), 0);
  assert.equal(sum, r.totals.charged_microusd, 'the kinds add up to the total: nothing dropped');
  assert.ok(r.models.some((m) => m.model === UNKNOWN), 'the unknown model is still a model row');
});

// 3 ───────────────────────────────────────────────────────────────────────────
// Mutations: cached rows counted; refused rows counted; models with no output
// price counted; only NULL counted (the column is NOT NULL DEFAULT 0).
test('output_not_recorded counts only runs on an output-token-priced model with no output count', async () => {
  assert.equal(pricedPerOutputToken(TEXT), true);
  assert.equal(pricedPerOutputToken(EMBED), false, 'embeddings price input only');
  assert.equal(pricedPerOutputToken(SPEECH_IN), false, 'priced by the minute');
  assert.equal(pricedPerOutputToken(IMAGE_OUT), false, 'priced by the image');
  assert.equal(pricedPerOutputToken(UNKNOWN), false);
  const w = world();
  w.run({ model: TEXT, in: 500, out: 0, charged: 150 }); // a streamed reply that recorded no output: counted
  w.run({ model: TEXT, in: 500, out: 0, charged: 150 }); // and another
  w.run({ model: TEXT, in: 500, out: 80, charged: 300 }); // recorded its output
  w.run({ model: TEXT, in: 500, out: 0, cached: true }); // a cached answer
  w.run({ model: TEXT, in: 500, out: 0, refusal: 'budget_user_month' }); // refused
  w.run({ model: EMBED, in: 500, out: 0, charged: 30 }); // no output tokens to record
  w.run({ model: SPEECH_IN, out: 0, charged: 1250 }); // priced by the minute
  w.run({ model: UNKNOWN, out: 0, charged: 1 }); // no known price
  w.run({ model: TEXT, user: OTHER, in: 9, out: 0, charged: 9 }); // another member
  const r = await memberCost(w.env, ME, 'mtd', 'model', NOW);
  assert.equal(r.totals.output_not_recorded, 2);
  assert.equal(r.totals.refused, 1);
});

// 4 ───────────────────────────────────────────────────────────────────────────
// Mutations: the kind column dropped; the kind written as the catalogue kind.
test('the CSV has the kind beside the model', async () => {
  const w = world();
  w.run({ model: TEXT, at: '2026-10-03 09:00:00', in: 10, out: 4, cost: 0.00001, charged: 12 });
  w.run({ model: IMAGE_OUT, at: '2026-10-03 10:00:00', cost: 0.003, charged: 3750 });
  w.run({ model: UNKNOWN, at: '2026-10-04 10:00:00', cost: 0.001, charged: 1250 });
  const lines = costCsv(await memberCost(w.env, ME, 'mtd', 'model', NOW)).trimEnd().split('\r\n');
  assert.equal(lines[0], 'day,model,name,kind,runs,input_tokens,output_tokens,cost_usd,charged_microusd');
  const kindOf = (model: string) => lines.find((l) => l.includes(`,${model},`))!.split(',').at(-6);
  assert.equal(kindOf(TEXT), 'tokens');
  assert.equal(kindOf(IMAGE_OUT), 'image');
  assert.equal(kindOf(UNKNOWN), 'other');
});

// 5 ───────────────────────────────────────────────────────────────────────────
// Mutations: the window widened to 48 hours; the user condition dropped;
// `resets_at` from the newest order rather than the oldest.
test('today\'s pack orders: the rolling window, the member\'s own orders, and when the count next drops', async () => {
  const w = world();
  assert.deepEqual(await packOrdersToday(w.env, ME), { today: 0, per_day: 5, window_hours: 24, resets_at: null });
  w.order(25); // outside the window
  w.order(20);
  w.order(3, ME, false); // pending: not yet credited
  w.order(1);
  w.order(2, OTHER); // another member's
  const p = await packOrdersToday(w.env, ME);
  assert.equal(p.today, 3);
  assert.equal(p.per_day, TOKEN_PACK_LIMITS.ordersPerDay);
  const oldest = w.f.db.prepare("SELECT MIN(created_at) AS t FROM ai_topup_purchases WHERE user_id = 2 AND created_at > datetime('now','-24 hours')").get().t;
  assert.equal(p.resets_at, new Date(Date.parse(`${oldest.replace(' ', 'T')}Z`) + 24 * 3_600_000).toISOString(), 'the oldest order in the window, plus 24 hours');
  const recent = await recentPackOrders(w.env, ME);
  assert.equal(recent.n, 3);
  assert.equal(recent.pending, 25_000_000, 'only the uncredited order is pending');
  assert.equal((await recentPackOrders(w.env, ME, 'MRD-d805-4')).n, 2, 'an order being refreshed is not counted against itself');
  assert.equal((await packOrdersToday(w.env, OTHER)).today, 1);
});

// 6 ───────────────────────────────────────────────────────────────────────────
// Mutations: the check given its own copy of the query; the read counting
// differently from the check.
test('the purchase check and the read count with one function, so the read shows what the check refuses at', async () => {
  const src = readFileSync(new URL('../src/services/aiCredits.ts', import.meta.url), 'utf8');
  const quote = src.slice(src.indexOf('export async function tokenPackQuote('), src.indexOf('\n}\n', src.indexOf('export async function tokenPackQuote(')));
  assert.match(quote, /const recent = await recentPackOrders\(env, userId, opts\.excludeOrderRef \?\? ''\);/);
  assert.match(quote, /if \(recent\.n >= TOKEN_PACK_LIMITS\.ordersPerDay\) return \{ error: 'token_pack_daily_limit' \};/);
  assert.doesNotMatch(quote, /FROM ai_topup_purchases/, 'the check has no copy of the count');
  assert.equal(src.match(/FROM ai_topup_purchases WHERE user_id = \? AND order_ref <> \?/g)?.length, 1, 'the count is written once');
  const read = src.slice(src.indexOf('export async function packOrdersToday('), src.indexOf('\n}\n', src.indexOf('export async function packOrdersToday(')));
  assert.match(read, /await recentPackOrders\(env, userId\)/);
  const w = world();
  for (let i = 0; i < TOKEN_PACK_LIMITS.ordersPerDay - 1; i += 1) w.order(i + 1);
  assert.equal((await packOrdersToday(w.env, ME)).today, 4, 'one order still allowed');
  w.order(0.5);
  const p = await packOrdersToday(w.env, ME);
  assert.ok(p.today >= p.per_day, 'at the count the check refuses at, the read says so');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the routes serve both reads', async () => {
  const w = world();
  w.order(1);
  w.order(2);
  const limit = await call(w, '/api/ai-budget/limit', ME);
  assert.equal(limit.status, 200);
  assert.equal(limit.body.pack_orders.today, 2);
  assert.equal(limit.body.pack_orders.per_day, 5);
  assert.match(String(limit.body.pack_orders.resets_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  w.run({ model: TEXT, at: `${new Date().toISOString().slice(0, 10)} 00:00:01`, in: 9, out: 0, charged: 10 });
  const cost = await call(w, '/api/ai-budget/cost', ME);
  assert.equal(cost.status, 200);
  assert.deepEqual(Object.keys(cost.body.totals.by_kind), ['tokens', 'audio_speech', 'image', 'other']);
  assert.equal(cost.body.totals.output_not_recorded, 1);
  assert.deepEqual(cost.body.totals.other_models, []);
});
