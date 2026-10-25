/**
 * D1018 (#2855) — Cap table part 3: the engine's exits, top-up payer,
 * converting set, conversion detail, MFN and the over-100% check (golden,
 * pure); and scenarios from the record with the one reader, on a database
 * built from the baseline and every migration, 573 applied whole.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_scenarios_d1018.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { simulate, validateInputs, type Inputs } from '../src/services/captable.ts';
import { readCapTable, MODEL_SCENARIO_NAME } from '../src/services/capTableToday.ts';
import { capTableCard, loadCap } from '../src/services/raiseCycle.ts';
import { unallocated } from '../src/routes/cycle_build.ts';
import { loadSimSegments } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

function ok(r: ReturnType<typeof simulate>): any {
  assert.ok(!('errors' in r && r.errors), `simulate returned errors: ${JSON.stringify((r as any).errors)}`);
  return r;
}

/** services/captable.ts's golden LEGACY scenario: two founders, a 10% pool, one capped SAFE, one round. */
const LEGACY: Inputs = {
  founders: [{ name: 'Ada', shares: 6_000_000 }, { name: 'Grace', shares: 4_000_000 }],
  option_pool_pct: 10,
  safes: [{ name: 'Angel', amount: 1_000_000, cap: 8_000_000, discount: 0.2 }],
  rounds: [{ name: 'Seed', pre_money: 12_000_000, investment: 3_000_000 }],
};

// ───────────────────────────────────────────────────────────── the engine

test('CT4: each instrument’s conversion detail, the pre-money path, by hand', () => {
  const seed = ok(simulate(LEGACY)).rounds[0];
  // sharesPre 11,111,111 · round price 12M / 11,111,111 = $1.08 · cap price 8M / 11,111,111 = $0.72 ·
  // discount price $1.08 × 0.8 = $0.864 → the cap wins → 1M / 0.72 = 1,388,889 shares of 15,277,778.
  assert.deepEqual(seed.conversions, [{
    name: 'Angel', instrument: 'safe', basis: 'pre_money', mfn: false,
    amount: 1_000_000, accrued_interest: 0, converting_amount: 1_000_000,
    cap_price: 0.72, discount_price: 0.864, round_price: 1.08, binding: 'cap',
    price_per_share: 0.72, shares: 1_388_889, pct_after_round: 9.0909,
  }]);
  assert.equal(seed.shares_post, 15_277_778);
  // The detail agrees with the ledger it describes.
  assert.equal(seed.ledger.find((h: any) => h.holder === 'Angel').shares, seed.conversions[0].shares);
});

test('CT4: the post-money path, and a note’s accrued interest', () => {
  const post = ok(simulate({
    founders: [{ name: 'F', shares: 9_000_000 }],
    safes: [{ name: 'Post', amount: 1_000_000, cap: 10_000_000, basis: 'post_money' }],
    rounds: [{ name: 'A', pre_money: 20_000_000, investment: 5_000_000 }],
  })).rounds[0];
  // f = 1M / 10M = 10% · T = 9M / 0.9 = 10M · cap price 10M / 10M = $1 · round $20M / 9M = $2.222222 · no discount.
  const c = post.conversions[0];
  assert.deepEqual([c.cap_price, c.discount_price, c.round_price, c.binding, c.shares, c.pct_after_round], [1, null, 2.222222, 'cap', 1_000_000, 8.1633]);
  assert.deepEqual(post.post_money_check, { fraction: 0.1, pct: 10, over_100: false });

  const note = ok(simulate({
    founders: [{ name: 'F', shares: 9_000_000 }],
    safes: [{ name: 'Note', amount: 100_000, cap: 10_000_000, instrument: 'note', interest_rate: 0.08, issue_date: '2025-01-01' }],
    rounds: [{ name: 'A', pre_money: 20_000_000, investment: 5_000_000, conversion_date: '2026-01-01' }],
  })).rounds[0].conversions[0];
  // $100,000 at 8% simple for 365 days = $8,000 → $108,000 converts at 10M / 9M = $1.111111 → 97,200 shares.
  assert.deepEqual([note.amount, note.accrued_interest, note.converting_amount, note.cap_price, note.shares], [100_000, 8_000, 108_000, 1.111111, 97_200]);
});

test('CT4: a discount-only SAFE: the discount price wins and there is no cap price', () => {
  const c = ok(simulate({
    founders: [{ name: 'F', shares: 10_000_000 }],
    safes: [{ name: 'Disc', amount: 100_000, discount: 0.2 }],
    rounds: [{ name: 'A', pre_money: 10_000_000, investment: 1_000_000 }],
  })).rounds[0].conversions[0];
  // Round price $1 · discount price $0.80 · 100,000 / 0.8 = 125,000 shares.
  assert.deepEqual([c.cap_price, c.discount_price, c.round_price, c.binding, c.shares], [null, 0.8, 1, 'discount', 125_000]);
});

test('existing scenarios keep their numbers: the D1018 fields are additions', () => {
  const r = ok(simulate({ ...LEGACY, exit_value: 50_000_000 }));
  assert.deepEqual(r.rounds[0].ledger.map((h: any) => [h.holder, h.shares]),
    [['Ada', 6_000_000], ['Grace', 4_000_000], ['Option Pool', 1_111_111], ['Angel', 1_388_889], ['Seed Investors', 2_777_778]]);
  assert.equal(r.rounds[0].top_up, null, 'no pool target, no top-up');
  assert.equal(r.waterfall.exit_value, 50_000_000);
  assert.equal(r.waterfalls, undefined, 'no exit_values, no list');
  assert.deepEqual(r.outstanding_instruments, []);
  assert.equal(r.over_100, false);
});

test('CT6: up to four exit values, one waterfall each', () => {
  const exits = [30_000_000, 100_000_000, 300_000_000, 1_000_000_000];
  const r = ok(simulate({ ...LEGACY, exit_values: exits }));
  assert.deepEqual(r.waterfalls.map((w: any) => [w.exit_value, w.waterfall.exit_value, w.waterfall.totals.total_distributed]), exits.map((e) => [e, e, e]));
  assert.deepEqual(r.waterfall, r.waterfalls[0].waterfall, 'the single waterfall is the first exit');
  // Each exit is its own waterfall, not one rescaled: the founders' payout at $1B is not 1000/30 of theirs at $30M.
  const ada = (i: number) => r.waterfalls[i].waterfall.rows.find((x: any) => x.holder === 'Ada').payout;
  assert.ok(ada(3) > ada(0));
  assert.deepEqual(validateInputs({ ...LEGACY, exit_values: [1, 2, 3, 4, 5] }), ['Up to 4 exit values.']);
  assert.match(validateInputs({ ...LEGACY, exit_values: [1, -2] }).join(), /Each exit value/);
});

test('CT6: who pays for the top-up — pre-money (founders) or post-money (everyone)', () => {
  const run = (payer: 'pre_money' | 'post_money') => ok(simulate({
    founders: [{ name: 'F', shares: 9_000_000 }], option_pool_pct: 10,
    rounds: [{ name: 'S', pre_money: 10_000_000, investment: 2_500_000, post_round_pool_pct: 12, top_up_payer: payer }],
  })).rounds[0];
  const pre = run('pre_money');
  const post = run('post_money');
  const sh = (r: any, h: string) => r.ledger.find((x: any) => x.holder === h);
  // Pre-money: the top-up lands before the price, so the new money buys exactly 20% and the founder carries the pool.
  assert.deepEqual([sh(pre, 'S Investors').shares, sh(pre, 'S Investors').pct, sh(pre, 'F').pct], [2_642_046, 20, 68.129]);
  // Post-money: the price is $10M / 10M = $1, so $2.5M buys 2,500,000; the pool then tops up to 12% of everything, investors included.
  assert.deepEqual([sh(post, 'S Investors').shares, sh(post, 'Option Pool').pct, sh(post, 'S Investors').pct], [2_500_000, 12, 19.1304]);
  assert.deepEqual(post.top_up, { shares: 568_182, payer: 'post_money' });
  assert.ok(sh(post, 'F').pct > sh(pre, 'F').pct, 'the founder carries less when everyone pays');
  assert.match(post.events.join('\n'), /after the new money, so every holder carries it/);
  assert.match(validateInputs({ founders: [{ name: 'F', shares: 1 }], rounds: [{ name: 'S', pre_money: 1, investment: 1, top_up_payer: 'later' as any }] }).join(), /top-up payer/);
});

test('CT6: which instruments convert — one left out stays outstanding, and no exit is invented after the round', () => {
  const r = ok(simulate({
    ...LEGACY, exit_value: 50_000_000,
    safes: [...LEGACY.safes!, { name: 'Later', amount: 500_000, cap: 20_000_000, converts: false }],
  }));
  assert.equal(r.rounds[0].ledger.find((h: any) => h.holder === 'Later'), undefined);
  assert.deepEqual(r.rounds[0].conversions.map((c: any) => c.name), ['Angel']);
  assert.deepEqual(r.outstanding_instruments, ['Later']);
  assert.equal(r.waterfall, null);
  assert.match(r.warnings.join('\n'), /instrument set not to convert is still outstanding/);
  // All convert by default: the Angel's shares are unchanged by the other's presence in the list.
  assert.equal(r.rounds[0].conversions[0].shares, 1_388_889);
});

test('CT4: MFN — each later SAFE with a better cap or no change, never applied', () => {
  const r = ok(simulate({
    founders: [{ name: 'F', shares: 9_000_000 }],
    safes: [
      { name: 'Earlier', amount: 100_000, cap: 5_000_000, issue_date: '2025-12-01' },
      { name: 'Angel', amount: 150_000, cap: 10_000_000, issue_date: '2026-01-01', mfn: true },
      { name: 'Better', amount: 100_000, cap: 8_000_000, issue_date: '2026-02-01' },
      { name: 'Worse', amount: 100_000, cap: 12_000_000, issue_date: '2026-03-01' },
      { name: 'Undated', amount: 100_000, cap: 9_000_000 },
      { name: 'Backdated', amount: 100_000, cap: 4_000_000, issue_date: '2025-11-01' },
    ],
    rounds: [{ name: 'A', pre_money: 20_000_000, investment: 5_000_000 }],
  }));
  assert.deepEqual(r.mfn, [{ name: 'Angel', later: [
    { name: 'Better', cap: 8_000_000, verdict: 'better_cap', ordered_by: 'date' },
    { name: 'Worse', cap: 12_000_000, verdict: 'no_change', ordered_by: 'date' },
    { name: 'Undated', cap: 9_000_000, verdict: 'better_cap', ordered_by: 'listed' },
  ] }]);
  // Backdated is listed after the Angel but signed before it, so it is not later.
  // Never applied: the Angel still converts at its own $10M cap.
  assert.equal(r.rounds[0].conversions.find((c: any) => c.name === 'Angel').cap_price, bankers(10_000_000 / 9_000_000));
  assert.equal(r.rounds[0].conversions.find((c: any) => c.name === 'Angel').mfn, true);
});
const bankers = (x: number) => Math.round(x * 1e6) / 1e6;

test('CT3: post-money caps over 100% answer the figure and a flag, never a waterfall', () => {
  const r = ok(simulate({
    founders: [{ name: 'F', shares: 9_000_000 }],
    safes: [
      { name: 'A', amount: 6_000_000, cap: 10_000_000, basis: 'post_money' },
      { name: 'B', amount: 5_000_000, cap: 10_000_000, basis: 'post_money' },
    ],
    rounds: [{ name: 'S', pre_money: 20_000_000, investment: 5_000_000 }],
    exit_values: [100_000_000],
  }));
  assert.deepEqual(r.post_money_check, { fraction: 1.1, pct: 110, over_100: true });
  assert.equal(r.rounds[0].post_money_check.over_100, true);
  assert.equal(r.over_100, true);
  assert.equal(r.waterfall, null);
  assert.equal(r.waterfalls[0].waterfall, null);
  assert.match(r.warnings.join('\n'), /promise 110% of the company/);
  // Under 100% the same caps answer a waterfall.
  const under = ok(simulate({
    founders: [{ name: 'F', shares: 9_000_000 }],
    safes: [{ name: 'A', amount: 6_000_000, cap: 10_000_000, basis: 'post_money' }],
    rounds: [{ name: 'S', pre_money: 20_000_000, investment: 5_000_000 }], exit_values: [100_000_000],
  }));
  assert.equal(under.over_100, false);
  assert.ok(under.waterfalls[0].waterfall);
});

test('CT4: at an exit before conversion, cash back or common at the cap, whichever pays more', () => {
  const at = (exit: number) => ok(simulate({
    founders: [{ name: 'F', shares: 9_000_000 }],
    safes: [{ name: 'Angel', amount: 150_000, cap: 10_000_000, basis: 'post_money' }],
    exit_value: exit,
  })).waterfall.rows.find((x: any) => x.holder === 'Angel');
  // $5M: 1.5% as converted is $75,000 < $150,000 cash back. $100M: 1.5% is $1.5M > $150,000.
  assert.deepEqual([at(5_000_000).election, at(5_000_000).payout], ['cash_back', 150_000]);
  assert.deepEqual([at(100_000_000).election, at(100_000_000).payout], ['as_converted', 1_500_000]);
});

test('a scenario starts from recorded holders: preferences from what was paid in, never from a missing figure', () => {
  const start = { holders: [
    { name: 'Ada', type: 'common' as const, shares: 8_000 },
    { name: 'Fund', type: 'preferred' as const, shares: 1_000, preference: 2_500 },
    { name: 'Cy', type: 'options' as const, shares: 200 },
  ], pool_shares: 800 };
  const today = ok(simulate({ start }));
  assert.deepEqual(today.founding.map((h: any) => [h.holder, h.type, h.shares]),
    [['Ada', 'founder', 8_000], ['Fund', 'preferred', 1_000], ['Cy', 'options', 200], ['Option Pool', 'option_pool', 800]]);
  assert.deepEqual(today.founder_dilution.map((d: any) => d.founder), ['Ada']);
  const round = { name: 'A', pre_money: 1_000_000, investment: 250_000 };
  // After a round, Fund's $2,500 preference is paid before common at a low exit.
  const low = ok(simulate({ start, rounds: [round], exit_value: 3_000 })).waterfall.rows.find((x: any) => x.holder === 'Fund');
  assert.equal(low.preference, 2_500);
  // A preferred holder whose paid-in amount is not recorded leaves the exit not calculated.
  const unknown = ok(simulate({ start: { ...start, holders: [...start.holders.slice(0, 1), { name: 'Fund', type: 'preferred', shares: 1_000, preference: null }] }, rounds: [round], exit_value: 3_000 }));
  assert.equal(unknown.waterfall, null);
  assert.match(unknown.warnings.join('\n'), /preferred holder’s paid-in amount is not recorded/);
  // Before a round, recorded preferences are not modelled, so no exit is given.
  const pre = ok(simulate({ start, exit_value: 3_000 }));
  assert.equal(pre.waterfall, null);
  assert.match(validateInputs({ start, founders: [{ name: 'X', shares: 1 }] }).join(), /not both/);
  assert.match(validateInputs({ start: { holders: [{ name: 'Cy', type: 'options', shares: 5 }] } }).join(), /holds no shares/);
});

// ───────────────────────────────────────────────────────────── the record

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const RECORD = '573_cap_table_record.sql';
const JWT_SECRET = 'unit-test-jwt-secret-d1018-0123456789';
const ADMIN = 1, INVESTOR = 3, OWNER = 4, COFOUNDER = 5, ADVISOR = 6, OTHER = 9;
const USERS: Array<[number, string, number | null]> = [[1, 'admin', null], [3, 'investor', null], [4, 'founder', 40], [5, 'founder', 50], [6, 'advisor', null], [9, 'founder', 90]];

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x !== RECORD).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  db.exec(readFileSync(resolve(MIGRATIONS, RECORD), 'utf8'));
  return db;
}
const BUILT = built();

function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, founder] of USERS) {
    db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, 'studio')")
      .run(id, `u-${id}`, `person${id}@example.test`, `Person ${id}`, role, founder);
  }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40), (20, 'p-20', 'Other Venture', 90);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (10, ${COFOUNDER}, 'cofounder', 'accepted'), (10, ${ADVISOR}, 'advisor', 'accepted'), (10, ${INVESTOR}, 'cofounder', 'accepted');
    INSERT INTO cap_table_holders (id, user_id, project_id, name) VALUES (101, ${OWNER}, 10, 'Ada Founder');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}

const MODEL: Inputs = {
  founders: [{ name: 'Ada Founder', shares: 8_000 } as any, { name: 'Bo Cofounder', shares: 2_000 }],
  option_pool_pct: 10,
  safes: [{ name: 'Model Angel', amount: 50_000, cap: 5_000_000, discount: 0.2 }],
  rounds: [{ name: 'Seed', pre_money: 3_000_000, investment: 750_000 }],
};
function saveModel(f: any, inputs: Inputs = MODEL) {
  f.db.prepare(`INSERT INTO cap_table_scenarios (uid, owner_user_id, project_id, name, inputs_json, result_json, is_variant, created_at, updated_at)
    VALUES ('model-1', ${OWNER}, 10, 'Our cap table', ?, ?, 0, datetime('now'), datetime('now'))`).run(JSON.stringify(inputs), JSON.stringify(simulate(inputs)));
}

async function record(f: any, body: Record<string, unknown>) {
  const r = await call(f, OWNER, '/record/10/issuances', 'POST', body);
  assert.equal(r.status, 201, r.text);
  return r.body.issuance;
}

/** D1017's worked example, by hand: outstanding 11,100, fully diluted 12,000 (200 options, 700 unallocated). */
async function worked(f: any, opts: { preferredTransfer?: boolean } = {}) {
  const cls = async (body: Record<string, unknown>) => (await call(f, OWNER, '/record/10/classes', 'POST', body)).body.class;
  const common = await cls({ name: 'Common', kind: 'common' });
  const pref = await cls({ name: 'Series A Preferred', kind: 'preferred', price_per_share_micros: 2_500_000 });
  const pool = await cls({ name: '2026 Plan', kind: 'option_pool', authorized_shares: 1000 });
  const day = '2026-01-15';
  await record(f, { kind: 'founding', holder_id: 101, class_uid: common.uid, shares: 8000, issued_on: day });
  await record(f, { kind: 'founding', holder_name: 'Bo Cofounder', class_uid: common.uid, shares: 2000, issued_on: day });
  await record(f, { kind: 'grant', holder_name: 'Cy Engineer', class_uid: pool.uid, shares: 300, issued_on: '2026-02-01' });
  await record(f, { kind: 'exercise', holder_name: 'Cy Engineer', class_uid: common.uid, from_class_uid: pool.uid, shares: 100, issued_on: '2026-03-01' });
  await record(f, { kind: 'priced', holder_name: 'Fund One', class_uid: pref.uid, shares: 1000, price_per_share_micros: 2_500_000, amount_cents: 250_000, issued_on: '2026-04-01' });
  await record(f, { kind: 'transfer', holder_name: 'Di Angel', from_holder_id: 101, class_uid: common.uid, shares: 500, issued_on: '2026-05-01' });
  if (opts.preferredTransfer) {
    // Pref Buyer pays for 200 preferred, then takes 100 more by transfer, whose price is not on the record.
    await record(f, { kind: 'priced', holder_name: 'Pref Buyer', class_uid: pref.uid, shares: 200, price_per_share_micros: 2_500_000, amount_cents: 50_000, issued_on: '2026-05-10' });
    await record(f, { kind: 'transfer', holder_name: 'Pref Buyer', from_holder_name: 'Fund One', class_uid: pref.uid, shares: 100, issued_on: '2026-05-15' });
  }
  const safe = await record(f, { kind: 'safe', holder_name: 'Early Angel', amount_cents: 2_500_000, cap_cents: 500_000_000, basis: 'post_money', discount_bps: 2000, mfn: true, issued_on: '2026-06-01' });
  const note = await record(f, { kind: 'note', holder_name: 'Bridge Lender', amount_cents: 1_000_000, interest_bps: 800, maturity_on: '2027-06-01' });
  return { common, pref, pool, safe, note };
}

test('Today: nothing recorded says so; the model is "Cap table · model" and its rows are offered, never written', async () => {
  const f = fresh();
  saveModel(f);
  const r = await call(f, OWNER, '/scenarios/by-project/10/today');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.today.available, r.body.today.reason], [false, 'nothing_recorded']);
  assert.equal(r.body.today.result, undefined, 'no number without a record');
  assert.deepEqual([r.body.model.name, r.body.model.stored_name, r.body.model.source], [MODEL_SCENARIO_NAME, 'Our cap table', 'model']);
  assert.deepEqual(r.body.offer.rows, [
    { kind: 'founding', holder_name: 'Ada Founder', shares: 8000, source: 'typed', note: 'From the model "Cap table · model".' },
    { kind: 'founding', holder_name: 'Bo Cofounder', shares: 2000, source: 'typed', note: 'From the model "Cap table · model".' },
    { kind: 'safe', holder_name: 'Model Angel', amount_cents: 5_000_000, source: 'typed', cap_cents: 500_000_000, discount_bps: 2000, basis: 'pre_money', note: 'From the model "Cap table · model".' },
  ]);
  assert.match(r.body.offer.pool_note, /10% option pool is a class/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cap_table_issuances').get().n, 0, 'reading offers writes nothing');
  // An offered row goes through part 2's proposals: a co-founder's waits for the owner, and is no longer offered.
  const proposed = await call(f, COFOUNDER, '/record/10/proposals', 'POST', r.body.offer.rows[2]);
  assert.equal(proposed.status, 201, proposed.text);
  assert.equal(proposed.body.issuance.status, 'proposed');
  const again = await call(f, OWNER, '/scenarios/by-project/10/today');
  assert.deepEqual(again.body.offer.rows.map((x: any) => x.holder_name), ['Ada Founder', 'Bo Cofounder']);
  // Gates: the venture's read gate.
  assert.equal((await call(f, ADVISOR, '/scenarios/by-project/10/today')).status, 200);
  assert.equal((await call(f, INVESTOR, '/scenarios/by-project/10/today')).status, 403);
  assert.equal((await call(f, OTHER, '/scenarios/by-project/10/today')).status, 403);
  assert.equal((await call(f, OWNER, '/scenarios/by-project/x/today')).status, 400);
});

test('Today from the record: holders by class kind, the unallocated pool, instruments, and what cannot be modelled', async () => {
  const f = fresh();
  saveModel(f);
  const { safe, note } = await worked(f);
  const r = await call(f, OWNER, '/scenarios/by-project/10/today');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.today.available, true);
  const start = r.body.today.inputs.start;
  assert.deepEqual(start.holders.map((h: any) => [h.name, h.type, h.shares, h.preference]).sort(), [
    ['Ada Founder', 'common', 7500, undefined], ['Bo Cofounder', 'common', 2000, undefined], ['Cy Engineer', 'common', 100, undefined],
    ['Cy Engineer', 'options', 200, undefined], ['Di Angel', 'common', 500, undefined], ['Fund One', 'preferred', 1000, 2500],
  ].sort());
  assert.equal(start.pool_shares, 700);
  // Today's total is the record's fully diluted count: 11,100 outstanding + 200 options + 700 unallocated.
  assert.equal(r.body.today.result.totals.shares_outstanding, 12_000);
  assert.deepEqual(r.body.today.inputs.safes, [{ name: 'Early Angel', amount: 25_000, cap: 5_000_000, discount: 0.2, basis: 'post_money', instrument: 'safe', issue_date: '2026-06-01', mfn: true }]);
  assert.deepEqual(r.body.today.not_modelled.map((x: any) => [x.uid, x.reason]), [[note.uid, 'basis_not_recorded']]);
  assert.match(r.body.today.not_modelled[0].sentence, /pre-money or post-money is not recorded/);
  assert.ok(r.body.today.result.mfn.find((m: any) => m.name === 'Early Angel'));
  assert.equal(safe.terms.mfn, true);
  // The model's founders are now on record, so only its SAFE is still offered.
  assert.deepEqual(r.body.offer.rows.map((x: any) => x.holder_name), ['Model Angel']);
  assert.deepEqual(r.body.assumptions.length, 3);
});

test('a preferred holder whose shares did not all come from a priced issuance has no recorded preference', async () => {
  const f = fresh();
  await worked(f, { preferredTransfer: true });
  const r = await call(f, OWNER, '/scenarios/by-project/10/today');
  const pref = (n: string) => r.body.today.inputs.start.holders.find((h: any) => h.name === n && h.type === 'preferred');
  assert.deepEqual([pref('Pref Buyer').shares, pref('Pref Buyer').preference], [300, null], 'what was paid for 200 is not the preference on 300');
  assert.equal(pref('Fund One').preference, 2500, 'the holder who paid keeps what they paid');
  // After a round, the unknown preference leaves the exit not calculated.
  const s = await call(f, OWNER, '/scenarios/by-project/10/simulate', 'POST', { rounds: [{ name: 'Seed', pre_money: 10_000_000, investment: 2_500_000 }], exit_values: [30_000_000], converting: [] });
  assert.equal(s.body.result.waterfalls[0].waterfall, null);
});

test('a scenario from Today: rounds with their top-up payer, up to four exits, the instruments that convert', async () => {
  const f = fresh();
  assert.equal((await call(f, OWNER, '/scenarios/by-project/10/simulate', 'POST', { rounds: [] })).status, 409, 'nothing recorded');
  await worked(f);
  const round = { name: 'Seed', pre_money: 10_000_000, investment: 2_500_000, post_round_pool_pct: 12, top_up_payer: 'post_money' };
  const r = await call(f, ADVISOR, '/scenarios/by-project/10/simulate', 'POST', { rounds: [round], exit_values: [30_000_000, 100_000_000, 300_000_000, 1_000_000_000] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.source, 'record');
  const seed = r.body.result.rounds[0];
  assert.equal(seed.shares_pre, 12_000, 'the round starts from the record’s fully diluted count');
  assert.deepEqual(seed.top_up.payer, 'post_money');
  assert.deepEqual(seed.conversions.map((c: any) => c.name), ['Early Angel']);
  assert.equal(r.body.result.waterfalls.length, 4);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cap_table_scenarios').get().n, 0, 'a simulation saves nothing');
  // Converting none: the SAFE stays outstanding, and no exit is invented after the round.
  const none = await call(f, OWNER, '/scenarios/by-project/10/simulate', 'POST', { rounds: [round], exit_values: [30_000_000], converting: [] });
  assert.deepEqual(none.body.result.outstanding_instruments, ['Early Angel']);
  assert.equal(none.body.result.waterfalls[0].waterfall, null);
  const unknown = await call(f, OWNER, '/scenarios/by-project/10/simulate', 'POST', { rounds: [round], converting: ['Nobody'] });
  assert.deepEqual([unknown.status, unknown.body.code], [400, 'unknown_instrument']);
  assert.equal((await call(f, OWNER, '/scenarios/by-project/10/simulate', 'POST', { rounds: [round], converting: 'Early Angel' })).status, 400);
  assert.equal((await call(f, OWNER, '/scenarios/by-project/10/simulate', 'POST', { rounds: [round], exit_values: [1, 2, 3, 4, 5] })).status, 400);
  assert.equal((await call(f, INVESTOR, '/scenarios/by-project/10/simulate', 'POST', { rounds: [round] })).status, 403);
});

test('one reader: the record when it holds shares, else the model marked Modelled, for the Raise card, Build and the deck', async () => {
  const f = fresh();
  assert.equal((await readCapTable(f.env, 10)).source, 'none');
  saveModel(f);
  const modelled = await readCapTable(f.env, 10);
  assert.deepEqual([modelled.source, modelled.modelled], ['model', true]);
  // On the model, everything reads as it did.
  const ctx = { env: f.env, projectId: 10, today: '2026-10-25' };
  assert.deepEqual((await capTableCard(ctx)).series[0].rows.map((x: any) => x.label), ['Before', 'After Seed']);
  assert.equal(await unallocated(f.env, { id: 10 } as any, null), 90, '100 less the model’s 10% pool');
  assert.equal((await loadSimSegments(f.env, 10)).source, 'model');

  await worked(f);
  const rec = await readCapTable(f.env, 10);
  assert.deepEqual([rec.source, rec.modelled], ['record', false]);
  // The Raise card: Today on record, the model's round run from Today and marked Modelled.
  const card = await capTableCard(ctx);
  assert.deepEqual(card.series[0].rows.map((x: any) => x.label), ['Today', 'After Seed · Modelled']);
  const cap = await loadCap(ctx);
  assert.equal(cap.source, 'record');
  const ada = cap.rows.find((x) => x.holder === 'Ada Founder')!;
  assert.deepEqual([ada.id, ada.before], ['h-101', 62.5], '7,500 of 12,000, named the way the record names it');
  assert.equal(cap.rows.find((x) => x.type === 'option_pool')!.id, 'pool');
  assert.equal(cap.rows.find((x) => x.type === 'options')!.group, 'Option pool');
  // Build: the pool's share of the fully diluted count, 200 options + 700 unallocated of 12,000 = 7.5%.
  assert.equal(await unallocated(f.env, { id: 10 } as any, null), 92.5);
  // The deck: today's ownership from the record.
  const deck = await loadSimSegments(f.env, 10);
  assert.equal(deck.source, 'record');
  assert.deepEqual(deck.segments[0], ['Ada Founder', 62.5]);
});

test('a record that cannot be read is a failure, never a fall back to the model', async () => {
  const f = fresh();
  saveModel(f);
  await worked(f);
  const db = f.env.DB;
  f.env.DB = { ...db, prepare(sql: string) { return db.prepare(sql.includes('FROM cap_table_issuances i') ? 'SELECT * FROM missing_d1018' : sql); } };
  await assert.rejects(readCapTable(f.env, 10), /missing_d1018/);
  assert.equal((await call(f, OWNER, '/scenarios/by-project/10/today')).status, 500);
});
