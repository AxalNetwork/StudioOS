/**
 * The caller's own AI spend meter — over real rows, with a movable clock.
 *
 * Two properties carry the weight here.
 *
 * 1. SELF-SCOPED. `ai_usage_logs` holds every user's calls. The org rollup is
 *    admin-gated elsewhere; this read must never widen, admin included, for the
 *    same reason /lp-portal must not: an operator's own spend meter showing the
 *    organisation's spend is not oversight, it is a wrong number.
 *
 * 2. "NO RECORD" IS NOT "$0". A user who has made no calls has spent zero, and
 *    that is a fact worth showing. A table that cannot be read is an absence of
 *    knowledge, and drawing an empty meter from it asserts something false. The
 *    two cases are distinguished by `recorded`, and tested separately.
 *
 * The clock is injected because the period boundary is the whole question. A
 * test that cannot move the clock can only assert the shape of the answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import { loadMyAiSpend, SPEND_CAP_DEFAULTS, SPEND_CAP_VARS } from '../src/services/aiSpend.ts';
import { aiUsageSelfScope, ALL_ROWS, NO_ROWS } from '../src/services/tenancyScope.ts';

const SCHEMA = `
CREATE TABLE ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL NOT NULL DEFAULT 0,
  safety_score REAL,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  refusal TEXT,
  created_at TEXT NOT NULL
);
`;

/** Rows spanning two months, three users, and one unattributed call. */
const SEED = `
INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, cached, fallback_used, refusal, created_at) VALUES
  (7,    'advisor_turn', 'llama-3.3-70b', 0.0100, 0, 0, NULL,             '2026-08-01 09:00:00'),
  (7,    'advisor_turn', 'llama-3.3-70b', 0.0200, 0, 1, NULL,             '2026-08-27 10:00:00'),
  (7,    'embed',        'bge-base',      0.0005, 1, 0, NULL,             '2026-08-27 11:00:00'),
  (7,    'advisor_turn', 'llama-3.1-8b',  0.0000, 0, 0, 'budget_user_day','2026-07-30 09:00:00'),
  (9,    'publication',  'llama-3.3-70b', 5.0000, 0, 0, NULL,             '2026-08-27 10:30:00'),
  (NULL, 'safety',       'llama-guard',   0.0300, 0, 0, NULL,             '2026-08-27 10:45:00');
`;

const AT = new Date('2026-08-27T12:00:00Z');
const env = (extra: Record<string, unknown> = {}) => {
  const { DB, db } = makeD1(SCHEMA, SEED);
  return { env: { DB, ...extra } as any, db };
};

// ---------- the scope ----------

test('the AI usage scope is a self-view with no unscoped escape', () => {
  const admin = aiUsageSelfScope({ id: 1, role: 'admin', email: 'ops@axal.vc' });
  assert.notEqual(admin.sql, ALL_ROWS.sql, 'an admin meter must show the admin, not the org');
  assert.deepEqual(admin.binds, [1]);
  for (const actor of [null, undefined, {}, { id: 0 }, { id: -1 }, { role: 'admin' }] as any[]) {
    assert.equal(aiUsageSelfScope(actor).sql, NO_ROWS.sql,
      `${JSON.stringify(actor)} must see no usage rows`);
  }
  assert.match(aiUsageSelfScope({ id: 3 }, 'x').sql, /x\.user_id/);
});

// ---------- what the meter reports ----------

test('month-to-date sums only the caller’s own rows in the current month', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.equal(r.recorded, true);
  assert.equal(r.month.key, '2026-08');
  // 0.0100 + 0.0200 + 0.0005 — July excluded, user 9 excluded, NULL excluded.
  assert.equal(Number(r.month.spend_usd!.toFixed(4)), 0.0305);
  assert.equal(r.month.calls, 3);
});

test('an unattributed row is billed to nobody', async () => {
  // user_id IS NULL on calls made outside a session. `= ?` never matches NULL,
  // so the $0.03 safety call belongs to no one's meter — not to whoever looks.
  const { env: e } = env();
  for (const id of [7, 9]) {
    const r = await loadMyAiSpend(e, { id, role: 'investor' }, AT);
    assert.ok(!r.by_task.some((t) => t.task === 'safety'), `user ${id} must not be billed the orphan row`);
  }
});

test('two users get disjoint meters', async () => {
  const { env: e } = env();
  const a = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  const b = await loadMyAiSpend(e, { id: 9, role: 'investor' }, AT);
  assert.equal(Number(a.month.spend_usd!.toFixed(4)), 0.0305);
  assert.equal(Number(b.month.spend_usd!.toFixed(4)), 5.0000);
});

test('an admin sees their own spend, not the organisation’s', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 1, role: 'admin', email: 'ops@axal.vc' }, AT);
  assert.equal(r.month.spend_usd, 0, 'no rows for this account is a real zero');
  assert.equal(r.recorded, true);
  assert.notEqual(r.month.spend_usd, 5.0305, 'must not be the sum of everyone');
});

test('today is a narrower window than the month, on the same rows', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.equal(r.today.key, '2026-08-27');
  // The 1 Aug call falls out; 0.0200 + 0.0005 remain.
  assert.equal(Number(r.today.spend_usd!.toFixed(4)), 0.0205);
  assert.equal(r.today.calls, 2);
  assert.ok(r.today.spend_usd! < r.month.spend_usd!);
});

test('moving the clock to the next month empties the meter without touching the rows', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, new Date('2026-09-01T00:00:00Z'));
  assert.equal(r.month.key, '2026-09');
  assert.equal(r.month.spend_usd, 0, 'a new period starts at a real zero');
  assert.equal(r.recorded, true, 'and the platform still knows that');
});

// ---------- recorded vs zero ----------

test('an unreadable usage table reports "no record", never $0', async () => {
  // The distinction the fund surfaces already make: an absent fact is not a
  // zero fact. A meter drawn from a failed read would state a spend the
  // platform cannot vouch for.
  const { DB } = makeD1('CREATE TABLE unrelated (id INTEGER);');
  const r = await loadMyAiSpend({ DB } as any, { id: 7, role: 'investor' }, AT);
  assert.equal(r.recorded, false);
  assert.equal(r.month.spend_usd, null);
  assert.equal(r.today.spend_usd, null);
  assert.equal(r.last_run, null);
  assert.deepEqual(r.by_task, []);
});

test('a user with no calls reports a real zero, not "no record"', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 4242, role: 'investor' }, AT);
  assert.equal(r.recorded, true);
  assert.equal(r.month.spend_usd, 0);
  assert.equal(r.last_run, null, 'no calls means no last run');
});

// ---------- the last run and the task breakdown ----------

test('the last run is the caller’s own most recent call, with its receipt', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.equal(r.last_run?.task, 'embed');
  assert.equal(r.last_run?.cost_usd, 0.0005);
  assert.equal(r.last_run?.cached, true, 'a cached run is labelled as one');
  assert.equal(r.last_run?.at, '2026-08-27 11:00:00');
});

test('a refusal is reported rather than hidden', async () => {
  // The July row is a budget refusal. A meter that silently drops refusals
  // would show a user a clean history of the month they spent hitting a cap.
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, new Date('2026-07-31T00:00:00Z'));
  assert.equal(r.last_run?.refusal, 'budget_user_day');
  assert.equal(r.last_run?.cost_usd, 0);
});

test('the task breakdown covers the month and sums to the month total', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.deepEqual(r.by_task.map((t) => t.task), ['advisor_turn', 'embed'], 'ordered by spend');
  const total = r.by_task.reduce((s, t) => s + t.spend_usd, 0);
  assert.equal(Number(total.toFixed(4)), Number(r.month.spend_usd!.toFixed(4)),
    'a breakdown that does not add up to its own total is worse than none');
});

// ---------- caps ----------

test('the caps come from the env vars the router enforces, with its defaults', async () => {
  const { env: e } = env();
  const d = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.equal(d.month.cap_usd, SPEND_CAP_DEFAULTS.month);
  assert.equal(d.today.cap_usd, SPEND_CAP_DEFAULTS.day);

  const { env: e2 } = env({ [SPEND_CAP_VARS.month]: '250', [SPEND_CAP_VARS.day]: '12' });
  const o = await loadMyAiSpend(e2, { id: 7, role: 'investor' }, AT);
  assert.equal(o.month.cap_usd, 250);
  assert.equal(o.today.cap_usd, 12);
});

test('a nonsense cap falls back to the default rather than to zero', async () => {
  // A zero cap would make the meter read "over plan" for every user at once.
  for (const bad of ['', 'abc', '0', '-5', 'NaN']) {
    const { env: e } = env({ [SPEND_CAP_VARS.month]: bad });
    const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
    assert.equal(r.month.cap_usd, SPEND_CAP_DEFAULTS.month, `cap ${JSON.stringify(bad)}`);
  }
});

// ---------- the enforcement counter is reported separately ----------

test('the KV counter is reported alongside the log sum, not merged into it', async () => {
  // They can legitimately disagree: aiRouter's own note says KV has no atomic
  // increment and may undercount, and the keys carry a TTL. Showing one number
  // would mean either a meter that disagrees with what refuses the next call,
  // or an enforcement counter presented as an invoice.
  const store = new Map<string, string>([
    ['ai_spend:7:2026-08', '0.9999'],
    ['ai_spend:7:2026-08-27', '0.5000'],
  ]);
  const { env: e } = env({ AI_SPEND: { get: async (k: string) => store.get(k) ?? null } });
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.equal(r.month.enforced_usd, 0.9999);
  assert.equal(r.today.enforced_usd, 0.5);
  assert.equal(Number(r.month.spend_usd!.toFixed(4)), 0.0305, 'the log sum is untouched by KV');
});

test('an absent KV counter is null, not zero', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.equal(r.month.enforced_usd, null, 'no store means no reading, not a reading of zero');
});

test('a KV read that throws does not fail the meter', async () => {
  const { env: e } = env({ AI_SPEND: { get: async () => { throw new Error('kv down'); } } });
  const r = await loadMyAiSpend(e, { id: 7, role: 'investor' }, AT);
  assert.equal(r.month.enforced_usd, null);
  assert.equal(Number(r.month.spend_usd!.toFixed(4)), 0.0305, 'the durable figure still stands');
});

test('a denied actor reads nobody’s meter', async () => {
  const { env: e } = env();
  const r = await loadMyAiSpend(e, {} as any, AT);
  assert.equal(r.month.spend_usd, 0, 'the 1=0 scope matches no rows');
  assert.equal(r.month.enforced_usd, null, 'and no KV key is constructed for a missing id');
});

// ---------- the meter must not draw a cap the router does not enforce ----------

test('the meter reads the same cap names and defaults as the router', () => {
  // aiSpend.ts re-declares the caps rather than importing budgetCaps(), which
  // aiRouter keeps private. That is a copy, and a copy that drifts would show
  // a user a $50 ceiling while the router refuses them at $10. The claim in
  // aiSpend's comment is only true while this test holds it.
  const routerSrc = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/services/aiRouter.ts'), 'utf8');
  assert.match(routerSrc, /USER_DAY_USD:\s*5\b/, 'router day default');
  assert.match(routerSrc, /USER_MONTH_USD:\s*50\b/, 'router month default');
  assert.equal(SPEND_CAP_DEFAULTS.day, 5);
  assert.equal(SPEND_CAP_DEFAULTS.month, 50);
  assert.match(routerSrc, new RegExp(`\\b${SPEND_CAP_VARS.day}\\b`), 'router reads the day var');
  assert.match(routerSrc, new RegExp(`\\b${SPEND_CAP_VARS.month}\\b`), 'router reads the month var');
});

test('the org rollup stays admin-gated — this endpoint did not open it up', () => {
  const monitoringSrc = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/monitoring.ts'), 'utf8');
  const at = monitoringSrc.indexOf("monitoring.get('/ai-usage'");
  assert.notEqual(at, -1, 'the org rollup must still exist');
  assert.match(monitoringSrc.slice(at, at + 300), /requireAdmin\s*\(/,
    'the every-user view stays admin-only; /api/ai/me/spend is the self-view');
});

test('the self endpoint requires auth and never takes a user id from the request', () => {
  // A `?user_id=` on a spend endpoint is the whole IDOR class in one query
  // param. The route reads the authenticated caller and nothing else.
  const routeSrc = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/ai.ts'), 'utf8');
  assert.match(routeSrc, /requireAuth\s*\(/);
  assert.doesNotMatch(routeSrc, /req\.query\(|req\.param\(/,
    'the caller must not be able to name whose spend they read');
});

// ---------- the pricing endpoint ----------

test('the pricing endpoint serves the router’s own table, not a second copy', () => {
  // assistCost.js's header already argues that the estimate and the receipt
  // must come from one calculation, because "two functions drifting apart is
  // exactly how a user is quoted one price and shown another". The same is
  // true one level up: the calculation was shared but the PRICES were not.
  const routeSrc = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/ai.ts'), 'utf8');
  assert.match(routeSrc, /PRICE_USD_PER_1M_TOKENS/, 'prices come from aiRouter');
  assert.match(routeSrc, /\bROUTE\b/, 'and so does the task → model map');
  // No hand-written figures in the route file — that would be the second copy
  // this endpoint exists to remove.
  const body = routeSrc.slice(routeSrc.indexOf("ai.get('/pricing'"));
  assert.doesNotMatch(body, /\bin:\s*0\.\d|\bout:\s*0\.\d/,
    'the route must not restate any price literal');
});

test('the pricing endpoint requires auth and exposes no per-user data', () => {
  const routeSrc = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/ai.ts'), 'utf8');
  const body = routeSrc.slice(routeSrc.indexOf("ai.get('/pricing'"));
  assert.match(body, /requireAuth\s*\(/);
  assert.doesNotMatch(body, /ai_usage_logs|user_id|loadMyAiSpend/,
    'a static table must not reach into anyone’s usage');
});

test('every routed task class has a price, or the estimate is unknown not free', () => {
  // A model in ROUTE with no entry in PRICE_USD_PER_1M_TOKENS makes
  // priceForTask() return null, and the rail must then decline to quote. This
  // asserts the frontend helper refuses rather than defaulting to zero.
  const hookSrc = readFileSync(
    resolve(process.cwd(), 'frontend/src/hooks/useAiSpend.js'), 'utf8');
  assert.match(hookSrc, /if \(!model\) return null/);
  assert.match(hookSrc, /if \(!p \|\| typeof p\.in !== 'number' \|\| typeof p\.out !== 'number'\) return null/,
    'an unpriced model yields null, never 0');
});

test('the hook keeps "no record" distinguishable from "$0" at the boundary', () => {
  const hookSrc = readFileSync(
    resolve(process.cwd(), 'frontend/src/hooks/useAiSpend.js'), 'utf8');
  // A failed fetch must leave `spend` null rather than substituting an
  // empty-looking object, or the component cannot tell the two apart.
  assert.match(hookSrc, /if \(s && !s\.__err\) setSpend\(s\); else setError/);
  assert.doesNotMatch(hookSrc, /setSpend\(\{\s*\}\)|setSpend\(\{ *spend_usd: *0/,
    'a failure must not be turned into a zero reading');
});
