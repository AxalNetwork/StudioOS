/**
 * Build queue #120 — cap-table share redaction tests.
 *
 * These are confidentiality tests, not formatting tests. A cap table
 * sent to the wrong audience leaks salaries-by-proxy (option grants),
 * valuations, and every investor's position. The assertions below are
 * written as "this string must not appear anywhere in the serialised
 * payload", because that is the property that actually matters — a
 * field can leak through a nested object a shape-based assertion would
 * happily walk past.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captableShare.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  redactForAudience,
  summariseLedger,
  aggregatePool,
  isShareAudience,
  SHARE_AUDIENCES,
  AUDIENCE_SCOPE,
} from '../src/services/captableShare.ts';

const LEDGER = [
  { holder: 'Ada', type: 'founder', shares: 6_000_000, pct: 40 },
  { holder: 'Grace', type: 'founder', shares: 4_000_000, pct: 26.6667 },
  { holder: 'Angel', type: 'safe', shares: 1_400_000, pct: 9.3333 },
  { holder: 'Seed Investors', type: 'preferred', shares: 2_600_000, pct: 17.3333 },
  { holder: 'Employee: R. Hopper', type: 'option_pool', shares: 600_000, pct: 4 },
  { holder: 'Employee: K. Johnson', type: 'option_pool', shares: 400_000, pct: 2.6667 },
];

const RESULT = {
  founding: [
    { holder: 'Ada', type: 'founder', shares: 6_000_000, pct: 54 },
    { holder: 'Employee: R. Hopper', type: 'option_pool', shares: 600_000, pct: 5.4 },
  ],
  rounds: [{
    name: 'Seed',
    pre_money: 12_000_000,
    post_money: 15_000_000,
    investment: 3_000_000,
    price_per_share: 1.08,
    shares_pre: 11_111_111,
    shares_post: 15_277_778,
    ledger: LEDGER,
    events: ["SAFE 'Angel' converted: 1,400,000 shares @ $0.7200 (binding: cap)"],
    round_meta: { investor_label: 'Seed Investors', investment: 3_000_000, safe_preferences: { Angel: 1_000_000 } },
  }],
  waterfall: { exit_value: 50_000_000, rows: [], totals: { preference_paid: 0, common_pool: 0, total_distributed: 0 } },
  totals: { shares_outstanding: 15_277_778, rounds_completed: 1 },
};

const json = (v: unknown) => JSON.stringify(v);

// ---------- summary audience ----------

test('summary shows group percentages and nothing else', () => {
  const out = redactForAudience(RESULT, 'summary', 'Seed plan');
  assert.equal(out.audience, 'summary');
  assert.ok(out.summary && out.summary.length > 0);
  assert.equal(out.founding, undefined, 'no per-holder founding table');
  assert.equal(out.rounds, undefined, 'no round detail');
  assert.equal(out.waterfall, undefined);
  assert.equal(out.totals, undefined);
});

test('summary leaks no individual name, share count, or valuation', () => {
  const s = json(redactForAudience(RESULT, 'summary', 'Seed plan'));
  for (const name of ['Ada', 'Grace', 'Angel', 'R. Hopper', 'K. Johnson', 'Seed Investors']) {
    assert.ok(!s.includes(name), `summary payload must not contain '${name}'`);
  }
  for (const n of ['6000000', '15277778', '12000000', '1.08']) {
    assert.ok(!s.includes(n), `summary payload must not contain the figure ${n}`);
  }
});

test('summary group percentages are correct and sum to 100', () => {
  const rows = summariseLedger(LEDGER);
  const founders = rows.find(r => r.group === 'Founders')!;
  const investors = rows.find(r => r.group === 'Investors')!;
  const pool = rows.find(r => r.group === 'Option pool')!;
  // 10M / 15M founders, 4M / 15M investors, 1M / 15M pool.
  assert.ok(Math.abs(founders.pct - 66.6667) < 0.001);
  assert.ok(Math.abs(investors.pct - 26.6667) < 0.001);
  assert.ok(Math.abs(pool.pct - 6.6667) < 0.001);
  const total = rows.reduce((s, r) => s + r.pct, 0);
  assert.ok(Math.abs(total - 100) < 0.01);
});

test('summariseLedger folds every option grant into one pool row', () => {
  const rows = summariseLedger(LEDGER);
  assert.equal(rows.filter(r => r.group === 'Option pool').length, 1);
});

test('summariseLedger is safe on an empty ledger', () => {
  assert.deepEqual(summariseLedger([]), []);
});

// ---------- investor audience ----------

test('investor gets full round economics', () => {
  const out = redactForAudience(RESULT, 'investor', 'Seed plan');
  assert.equal(out.rounds!.length, 1);
  const r = out.rounds![0] as any;
  assert.equal(r.pre_money, 12_000_000);
  assert.equal(r.price_per_share, 1.08);
  assert.equal(r.shares_post, 15_277_778);
  assert.ok(out.waterfall, 'an investor needs the preference stack');
});

test('investor sees investors and founders by name, but not employee grants', () => {
  const out = redactForAudience(RESULT, 'investor', 'Seed plan');
  const s = json(out);
  assert.ok(s.includes('Ada'), 'founders are visible to an investor');
  assert.ok(s.includes('Seed Investors'));
  assert.ok(s.includes('Angel'));
  assert.ok(!s.includes('R. Hopper'), 'individual option grants must not leak');
  assert.ok(!s.includes('K. Johnson'));
});

test('investor still sees the pool SIZE, since it dilutes them', () => {
  const out = redactForAudience(RESULT, 'investor', 'Seed plan');
  const ledger = (out.rounds![0] as any).ledger as Array<{ holder: string; type: string; shares: number }>;
  const pool = ledger.filter(h => h.type === 'option_pool');
  assert.equal(pool.length, 1, 'exactly one aggregated pool row');
  assert.equal(pool[0].shares, 1_000_000, '600k + 400k');
  assert.equal(pool[0].holder, 'Option Pool');
});

test('investor does not receive the free-text event narration', () => {
  const r = redactForAudience(RESULT, 'investor', 'Seed plan').rounds![0] as any;
  assert.equal(r.events, undefined, 'events can name individuals; owner-only');
});

test('the founding table is aggregated for an investor too', () => {
  const out = redactForAudience(RESULT, 'investor', 'Seed plan');
  assert.ok(!json(out.founding).includes('R. Hopper'));
});

// ---------- full audience ----------

test('full returns everything including per-holder rows and events', () => {
  const out = redactForAudience(RESULT, 'full', 'Seed plan');
  const s = json(out);
  assert.ok(s.includes('R. Hopper'), 'full audience sees individual grants');
  assert.ok(s.includes('K. Johnson'));
  assert.ok((out.rounds![0] as any).events, 'full audience sees the narration');
  assert.equal(out.totals!.shares_outstanding, 15_277_778);
});

test('redaction copies rather than mutating the source result', () => {
  const before = json(RESULT);
  redactForAudience(RESULT, 'summary', 'x');
  redactForAudience(RESULT, 'investor', 'x');
  redactForAudience(RESULT, 'full', 'x');
  assert.equal(json(RESULT), before, 'the caller\'s object must be untouched');
});

// ---------- guards ----------

test('every audience states what it withholds', () => {
  for (const a of SHARE_AUDIENCES) {
    const out = redactForAudience(RESULT, a, 'Seed plan');
    assert.ok(out.disclosure.length > 20, `${a} must carry a disclosure line`);
    assert.equal(out.scenario_name, 'Seed plan');
    assert.equal(out.rounds_completed, 1);
  }
});

test('AUDIENCE_SCOPE documents each audience for the share UI', () => {
  for (const a of SHARE_AUDIENCES) {
    assert.ok(AUDIENCE_SCOPE[a].sees.length > 0, `${a} needs a 'can see' list`);
  }
  assert.ok(AUDIENCE_SCOPE.summary.hidden.length > 0);
  assert.equal(AUDIENCE_SCOPE.full.hidden.length, 0, 'full hides nothing, by definition');
});

test('isShareAudience rejects anything not on the list', () => {
  assert.equal(isShareAudience('summary'), true);
  assert.equal(isShareAudience('investor'), true);
  assert.equal(isShareAudience('full'), true);
  assert.equal(isShareAudience('owner'), false);
  assert.equal(isShareAudience(''), false);
  assert.equal(isShareAudience(null), false);
  assert.equal(isShareAudience(undefined), false);
  assert.equal(isShareAudience({ toString: () => 'full' }), false, 'no object coercion');
});

test('a null or empty result degrades safely for every audience', () => {
  for (const a of SHARE_AUDIENCES) {
    const out = redactForAudience(null, a, 'Empty');
    assert.equal(out.rounds_completed, 0);
    assert.ok(out.disclosure);
  }
  const summary = redactForAudience({}, 'summary', 'Empty');
  assert.deepEqual(summary.summary, []);
});

test('aggregatePool leaves a ledger with no pool untouched', () => {
  const noPool = [{ holder: 'Ada', type: 'founder', shares: 100, pct: 100 }];
  assert.deepEqual(aggregatePool(noPool), noPool);
});
