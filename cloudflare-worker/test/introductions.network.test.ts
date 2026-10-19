/**
 * Network Introductions — service tests (services/introductions.ts).
 *
 * Exercises the REAL service against an in-memory SQLite database wrapped in
 * the same minimal D1 adapter the bestFit tests use. Asserts the business
 * rules the spec requires:
 *
 *   1. Credit math: balance = current-month allowance + purchased + referral;
 *      allowance does NOT roll over across months.
 *   2. Spend priority: allowance → referral-earned → purchased.
 *   3. Monthly allowance: free vs paid plan caps; grant is idempotent (one
 *      row per month no matter how often the state is read).
 *   4. Referral credits: +1 per valid referred signup, idempotent per
 *      referral row (no double counting).
 *   5. Purchase fulfilment: idempotent on the PaymentIntent id (a Stripe
 *      webhook retry can never double-credit); INTRO_PACKS carries the
 *      spec'd 10 / 100 / 1000 packages.
 *   6. Pair scoring: shared values, complementary skills, archetype
 *      compatibility, jurisdiction, specialization overlap, and relationship
 *      proximity all move the composite score + populate the breakdown.
 *   7. Proposition generation: consent-gated pool, self excluded, reciprocal
 *      mirror row created for the counterpart, no duplicates on re-run.
 *
 * Run via the strip-types loader (see package.json test:drift).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  INTRO_PACKS,
  isIntroPackKey,
  monthlyAllowanceFor,
  currentMonthKey,
  deriveCreditState,
  pickSpendBucket,
  getIntroCreditState,
  grantPurchasedIntroCredits,
  scoreIntroPair,
  sharedValueDimensions,
  generateIntroPropositions,
  type IntroPairSide,
} from '../src/services/introductions.ts';
import type { Env } from '../src/types';

// ---------------------------------------------------------------------------
// In-memory D1 adapter (same shape as bestFit.matches.test.ts).
// ---------------------------------------------------------------------------
function makeEnv(): { env: Env; raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT,
      role TEXT NOT NULL DEFAULT 'founder', is_active INTEGER DEFAULT 1,
      email_verified INTEGER DEFAULT 0,
      country TEXT, nationality TEXT, tax_residency_country TEXT,
      founder_id INTEGER, partner_id INTEGER, investor_id INTEGER,
      display_name TEXT, notification_prefs TEXT);
    CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, matching_opt_in INTEGER DEFAULT 0);
    CREATE TABLE referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL UNIQUE, referral_code TEXT,
      status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE partners (id INTEGER PRIMARY KEY, specialization TEXT);
    CREATE TABLE founders (id INTEGER PRIMARY KEY, domain_expertise TEXT);
    CREATE TABLE investors (id INTEGER PRIMARY KEY, sector_focus TEXT);
    CREATE TABLE profile_archetypes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, persona TEXT,
      archetype_slug TEXT, archetype_label TEXT, computed_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE assessment_results (
      user_id INTEGER, archetype_slug TEXT, archetype_label TEXT,
      updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE user_personas (
      user_id INTEGER, persona_id TEXT, is_primary INTEGER DEFAULT 1);
    CREATE TABLE follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT, follower_user_id INTEGER,
      entity_type TEXT, entity_id INTEGER);
    CREATE TABLE skill_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE);
    CREATE TABLE skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, category_slug TEXT);
    CREATE TABLE value_dimensions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE);
    CREATE TABLE user_values (user_id INTEGER, dimension_id INTEGER, score REAL,
      confidence REAL, PRIMARY KEY (user_id, dimension_id));
    CREATE TABLE user_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
      skill_id INTEGER, self_level INTEGER);
    -- Pre-created because services/notify.ts caches its ensureInbox() flag at
    -- module level; an earlier test's env would otherwise leave this table
    -- missing here (same reason ensureIntroNetworkSchema keys on the DB).
    CREATE TABLE notifications_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT,
      title TEXT, body TEXT, link TEXT, payload TEXT, channel TEXT,
      category TEXT, severity TEXT, cta_url TEXT, template_key TEXT,
      read_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  `);
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      // node:sqlite binds bare positional args to placeholder OCCURRENCES, not
      // placeholder NUMBERS, so a reused `?1` (D1 supports it) under-binds and
      // throws "column index out of range". Expand numbered placeholders into
      // plain `?` per occurrence and duplicate the bound values to match.
      const expand = () => {
        if (!/\?\d+/.test(sql)) return { sql, args: bound };
        const args: unknown[] = [];
        const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => {
          args.push(bound[Number(n) - 1]);
          return '?';
        });
        return { sql: rewritten, args };
      };
      const stmt = {
        bind(...vals: unknown[]) { bound = vals; return stmt; },
        async run() {
          const { sql: q, args } = expand();
          const info = db.prepare(q).run(...(args as any[]));
          return { success: true, meta: { changes: Number(info.changes) } } as any;
        },
        async first<T = any>() { const { sql: q, args } = expand(); return (db.prepare(q).get(...(args as any[])) ?? null) as T | null; },
        async all<T = any>() { const { sql: q, args } = expand(); return { results: db.prepare(q).all(...(args as any[])) as T[] } as any; },
      };
      return stmt;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 } as any; },
    async batch(stmts: any[]) {
      const out = [] as any[];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return { env: { DB } as unknown as Env, raw: db };
}

const AXES = ['product', 'engineering', 'gtm_sales'];
const DIMS = ['founder_mission_vs_profit', 'founder_speed_vs_quality', 'founder_risk_appetite'];

function seedTaxonomies(db: DatabaseSync) {
  for (const slug of AXES) {
    db.prepare(`INSERT INTO skill_categories (slug) VALUES (?)`).run(slug);
    db.prepare(`INSERT INTO skills (slug, category_slug) VALUES (?, ?)`).run(`${slug}_rep`, slug);
  }
  for (const slug of DIMS) db.prepare(`INSERT INTO value_dimensions (slug) VALUES (?)`).run(slug);
}

function seedVectors(db: DatabaseSync, userId: number, skillLevel: number, valueScore: number) {
  for (const slug of AXES) {
    const skillId = (db.prepare(`SELECT id FROM skills WHERE slug = ?`).get(`${slug}_rep`) as any).id;
    db.prepare(`INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, ?, ?)`)
      .run(userId, skillId, skillLevel);
  }
  for (const slug of DIMS) {
    const dimId = (db.prepare(`SELECT id FROM value_dimensions WHERE slug = ?`).get(slug) as any).id;
    db.prepare(`INSERT INTO user_values (user_id, dimension_id, score, confidence) VALUES (?, ?, ?, 0.9)`)
      .run(userId, dimId, valueScore);
  }
}

// ---------------------------------------------------------------------------
// 1–2. Pure credit math.
// ---------------------------------------------------------------------------
test('deriveCreditState sums the three buckets and never rolls allowance over', () => {
  const s = deriveCreditState(10, '2026-07', {
    allowanceMonth: 7,       // this month's grant minus this month's allowance spends
    purchased: 12,
    referral: 2,
    purchasedGranted: 20,
    referralGranted: 5,
    spentThisMonth: 3,
  });
  assert.equal(s.balance, 7 + 12 + 2);
  assert.equal(s.monthly_allowance, 10);
  assert.equal(s.used_this_month, 3);
  assert.equal(s.purchased_total, 20);
  assert.equal(s.referral_total, 5);
  // A stale month with unspent allowance contributes zero (no rollover):
  const stale = deriveCreditState(10, '2026-08', {
    allowanceMonth: 0, purchased: 0, referral: 0,
    purchasedGranted: 0, referralGranted: 0, spentThisMonth: 0,
  });
  assert.equal(stale.balance, 0);
});

test('pickSpendBucket spends allowance, then referral, then purchased', () => {
  const base = {
    month: '2026-07', monthly_allowance: 3, used_this_month: 0,
    purchased_total: 0, referral_total: 0,
  };
  assert.equal(pickSpendBucket({ ...base, allowance_remaining: 1, referral_remaining: 1, purchased_remaining: 1, balance: 3 }), 'allowance');
  assert.equal(pickSpendBucket({ ...base, allowance_remaining: 0, referral_remaining: 1, purchased_remaining: 1, balance: 2 }), 'referral');
  assert.equal(pickSpendBucket({ ...base, allowance_remaining: 0, referral_remaining: 0, purchased_remaining: 1, balance: 1 }), 'purchased');
});

test('monthlyAllowanceFor gives free and paid tiers a monthly allowance', () => {
  assert.equal(monthlyAllowanceFor({ role: 'founder', subscription_tier: 'free' }), 3);
  assert.equal(monthlyAllowanceFor({ role: 'founder', subscription_tier: 'growth' }), 10);
  assert.equal(monthlyAllowanceFor({ role: 'founder', subscription_tier: 'studio' }), 25);
  assert.equal(monthlyAllowanceFor({ role: 'partner' }), 3);
  assert.equal(monthlyAllowanceFor({ role: 'advisor' }), 3);
  assert.equal(monthlyAllowanceFor({ role: 'investor', investor_tier: 'professional' }), 10);
  assert.equal(monthlyAllowanceFor({ role: 'investor', investor_tier: 'institutional' }), 25);
  // Lapsed investor subscription drops to the free allowance.
  assert.equal(monthlyAllowanceFor({
    role: 'investor', investor_tier: 'institutional', investor_subscription_status: 'past_due',
  }), 3);
  assert.match(currentMonthKey(new Date('2026-07-11T00:00:00Z')), /^2026-07$/);
});

// ---------------------------------------------------------------------------
// 3–5. Ledger behaviour against the real schema.
// ---------------------------------------------------------------------------
test('getIntroCreditState grants the monthly allowance exactly once', async () => {
  const { env, raw } = makeEnv();
  raw.prepare(`INSERT INTO users (id, uid, name, role) VALUES (1, 'u1', 'A', 'founder')`).run();
  const user = { id: 1, role: 'founder', subscription_tier: 'free' };
  const first = await getIntroCreditState(env, user as any);
  assert.equal(first.balance, 3);
  const second = await getIntroCreditState(env, user as any);
  assert.equal(second.balance, 3); // idempotent — still one grant row
  const rows = raw.prepare(`SELECT COUNT(*) AS n FROM intro_credit_ledger WHERE kind = 'monthly_grant'`).get() as any;
  assert.equal(rows.n, 1);
});

test('referral credits accrue once per valid referred user', async () => {
  const { env, raw } = makeEnv();
  raw.prepare(`INSERT INTO users (id, uid, name, role) VALUES (1, 'u1', 'Referrer', 'partner')`).run();
  raw.prepare(`INSERT INTO users (id, uid, name, role, email_verified) VALUES (2, 'u2', 'Joined', 'founder', 1)`).run();
  raw.prepare(`INSERT INTO users (id, uid, name, role, email_verified) VALUES (3, 'u3', 'Unverified', 'founder', 0)`).run();
  raw.prepare(`INSERT INTO referrals (referrer_id, referred_id, status) VALUES (1, 2, 'pending')`).run();
  raw.prepare(`INSERT INTO referrals (referrer_id, referred_id, status) VALUES (1, 3, 'pending')`).run();
  const user = { id: 1, role: 'partner' };
  const s1 = await getIntroCreditState(env, user as any);
  assert.equal(s1.referral_remaining, 1);   // only the verified signup counts
  const s2 = await getIntroCreditState(env, user as any);
  assert.equal(s2.referral_remaining, 1);   // no double counting on re-read
  assert.equal(s2.balance, 3 + 1);
});

test('purchase fulfilment is idempotent on the PaymentIntent id and packs match spec', async () => {
  const { env, raw } = makeEnv();
  raw.prepare(`INSERT INTO users (id, uid, name, role) VALUES (1, 'u1', 'Buyer', 'investor')`).run();
  assert.deepEqual(
    Object.values(INTRO_PACKS).map((p) => p.credits).sort((a, b) => a - b),
    [10, 100, 1000],
  );
  assert.ok(isIntroPackKey('intro_100'));
  assert.ok(!isIntroPackKey('intro_50'));

  const first = await grantPurchasedIntroCredits(env, { userId: 1, credits: 100, paymentIntentId: 'pi_test_1', pack: 'intro_100' });
  const retry = await grantPurchasedIntroCredits(env, { userId: 1, credits: 100, paymentIntentId: 'pi_test_1', pack: 'intro_100' });
  assert.equal(first, true);
  assert.equal(retry, false); // webhook retry no-ops
  const state = await getIntroCreditState(env, { id: 1, role: 'investor' } as any);
  assert.equal(state.purchased_remaining, 100);
  assert.equal(state.purchased_total, 100);
});

// ---------------------------------------------------------------------------
// 6. Pair scoring.
// ---------------------------------------------------------------------------
function side(over: Partial<IntroPairSide['facts']>, vectors: IntroPairSide['vectors']): IntroPairSide {
  return {
    vectors,
    facts: {
      userId: 0, country: null, specializations: [], archetypeSlug: null,
      archetypeLabel: null, personaId: null, personaLabel: null, role: null,
      ...over,
    },
  };
}

test('scoreIntroPair rewards every matching dimension and explains why', () => {
  const values = {
    founder_mission_vs_profit: { score: 2, confidence: 0.9 },
    founder_risk_appetite: { score: 1.5, confidence: 0.8 },
  };
  const viewer = side(
    { country: 'Portugal', specializations: ['Fintech', 'Payments'], archetypeSlug: 'visionary', archetypeLabel: 'Visionary' },
    { values, skills: { product: 1, engineering: 1 } },
  );
  const candidate = side(
    { country: 'Portugal', specializations: ['Fintech infrastructure'], archetypeSlug: 'operator', archetypeLabel: 'Operator' },
    { values, skills: { product: 5, engineering: 4 } },
  );
  const b = scoreIntroPair(viewer, candidate, { viewerFollows: true, followsViewer: false });

  assert.ok(b.components.values > 0, 'shared values should score');
  assert.ok(b.components.skills > 0, 'complementary skills should score');
  assert.equal(b.components.archetype, 15, 'different archetypes take the full weight');
  assert.equal(b.components.jurisdiction, 15, 'same country takes the full weight');
  assert.ok(b.components.specialization > 0, 'token overlap (fintech) should score');
  assert.equal(b.components.proximity, 5);
  assert.equal(b.relationship_context, 'You follow them');
  assert.ok(b.score > 50 && b.score <= 100);
  assert.ok(b.reasons.length >= 4, 'each dimension contributes a reason');
  assert.deepEqual(b.jurisdiction, { viewer: 'Portugal', candidate: 'Portugal', match: true });
  assert.ok(b.shared_values.length >= 2);
});

test('scoreIntroPair scores an empty pairing at zero', () => {
  const empty = side({}, { values: {}, skills: {} });
  const b = scoreIntroPair(empty, empty, { viewerFollows: false, followsViewer: false });
  assert.equal(b.score, 0);
  assert.equal(b.relationship_context, null);
});

test('sharedValueDimensions requires same-direction conviction on both sides', () => {
  const a = {
    d1: { score: 2, confidence: 0.9 },
    d2: { score: -2, confidence: 0.9 },
    d3: { score: 0.5, confidence: 0.9 },
  };
  const b = {
    d1: { score: 1, confidence: 0.9 },   // shared
    d2: { score: 2, confidence: 0.9 },   // opposed
    d3: { score: 0.5, confidence: 0.9 }, // too weak
  };
  assert.deepEqual(sharedValueDimensions(a, b), ['d1']);
});

// ---------------------------------------------------------------------------
// 7. Generation: consent gate, mirrors, idempotency.
// ---------------------------------------------------------------------------
test('generateIntroPropositions proposes consent-gated matches with reciprocal mirrors, no dupes', async () => {
  const { env, raw } = makeEnv();
  seedTaxonomies(raw);
  const addUser = (id: number, role: string, optIn: boolean, country: string) => {
    raw.prepare(`INSERT INTO users (id, uid, name, role, country) VALUES (?, ?, ?, ?, ?)`)
      .run(id, `u${id}`, `User ${id}`, role, country);
    raw.prepare(`INSERT INTO user_settings (user_id, matching_opt_in) VALUES (?, ?)`)
      .run(id, optIn ? 1 : 0);
  };
  addUser(1, 'founder', true, 'Portugal');   // viewer
  addUser(2, 'investor', true, 'Portugal');  // opted-in candidate
  addUser(3, 'partner', false, 'Portugal');  // opted OUT — must never surface
  seedVectors(raw, 1, 1, 2);
  seedVectors(raw, 2, 5, 2); // strong complement + aligned values
  seedVectors(raw, 3, 5, 2);

  const viewer = { id: 1, role: 'founder' };
  const created = await generateIntroPropositions(env, viewer as any, { max: 5 });
  assert.equal(created, 1, 'only the opted-in candidate is proposed');

  const mine = raw.prepare(
    `SELECT user_id, target_user_id, status, source, score, breakdown_json
       FROM intro_propositions ORDER BY user_id`,
  ).all() as any[];
  assert.equal(mine.length, 2, 'viewer row + reciprocal mirror');
  const viewerRow = mine.find((r) => r.user_id === 1)!;
  const mirrorRow = mine.find((r) => r.user_id === 2)!;
  assert.equal(viewerRow.target_user_id, 2);
  assert.equal(viewerRow.source, 'matching');
  assert.equal(mirrorRow.target_user_id, 1);
  assert.equal(mirrorRow.source, 'reciprocal');
  assert.equal(viewerRow.status, 'pending');
  assert.ok(viewerRow.score >= 20);
  const breakdown = JSON.parse(viewerRow.breakdown_json);
  assert.ok(Array.isArray(breakdown.reasons) && breakdown.reasons.length > 0);
  assert.equal(breakdown.jurisdiction.match, true);

  // Re-run: the pair has been seen in both directions → nothing new.
  const again = await generateIntroPropositions(env, viewer as any, { max: 5 });
  assert.equal(again, 0);
  const total = raw.prepare(`SELECT COUNT(*) AS n FROM intro_propositions`).get() as any;
  assert.equal(total.n, 2);

  // The counterpart got the deep-linked notification for the mirror row.
  const notes = raw.prepare(
    `SELECT user_id, type, link FROM notifications_inbox`,
  ).all() as any[];
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user_id, 2);
  assert.equal(notes[0].type, 'intro_proposition_received');
  assert.match(String(notes[0].link), /\/network\?tab=introductions&intro=/);
});

// ---------------------------------------------------------------------------
// D755 (#1915). Introduction packs are no longer sold. Nothing offers one, the
// intent route answers 410 before any Stripe call, and an intent minted before
// the switch still grants through the webhook.
// ---------------------------------------------------------------------------
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import introductionsRoute from '../src/routes/introductions.ts';
import paymentsRoute from '../src/routes/payments.ts';
import billingRoute from '../src/routes/billing.ts';
import { INTRO_PACKS_ON_SALE } from '../src/services/introductions.ts';

const D755_SECRET = ['d755', 'intro', 'packs', 'fixture'].join('-');
const D755_WEBHOOK = ['d755', 'webhook', 'fixture'].join('-');

function d755Env() {
  const { env, raw } = makeEnv();
  raw.exec('ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER');
  raw.prepare(`INSERT INTO users (id, uid, name, email, role) VALUES (1, 'u1', 'Ivy Investor', 'ivy@example.test', 'investor')`).run();
  Object.assign(env as any, { JWT_SECRET: D755_SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: D755_WEBHOOK });
  const app = new Hono<any>();
  app.route('/api/introductions', introductionsRoute);
  app.route('/api/payments', paymentsRoute);
  async function call(method: string, path: string, body?: unknown) {
    const jwt = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(D755_SECRET));
    const res = await app.request(path, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  return { env, raw, call };
}

/** Fails the test if anything reaches Stripe (or anywhere). */
async function withoutNetwork<T>(fn: () => Promise<T>): Promise<{ out: T; calls: number }> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error('fetch must not be called'); }) as typeof fetch;
  try { return { out: await fn(), calls }; } finally { globalThis.fetch = real; }
}

test('D755 an Introduction pack is no longer sold: the intent is 410 before Stripe, /packs is empty, /credits has no buy path', async () => {
  assert.equal(INTRO_PACKS_ON_SALE, false);
  const f = d755Env();
  const { out: intent, calls } = await withoutNetwork(() => f.call('POST', '/api/payments/intro-credits/intent', { pack: 'intro_10' }));
  assert.equal(intent.status, 410);
  assert.equal(intent.body.error, 'intro_packs_retired');
  assert.equal(intent.body.message, 'Introduction packs are no longer sold.');
  assert.equal(calls, 0, 'nothing reached Stripe');
  // Answered before any Stripe step: with no Stripe key at all it is still the 410, not stripe_not_configured.
  delete (f.env as any).STRIPE_SECRET_KEY;
  const unconfigured = await f.call('POST', '/api/payments/intro-credits/intent', { pack: 'intro_10' });
  assert.equal(unconfigured.status, 410);
  assert.equal(unconfigured.body.error, 'intro_packs_retired');

  const packs = await f.call('GET', '/api/introductions/packs');
  assert.equal(packs.status, 200);
  assert.deepEqual(packs.body, { packs: [], on_sale: false });

  const credits = await f.call('GET', '/api/introductions/credits');
  assert.equal(credits.status, 200);
  assert.ok(!('buy_path' in credits.body), 'no buy path');
  assert.equal(credits.body.refer_path, '/account/referrals', 'Refer & earn stays');
});

test('D755 out of credits, the 402 offers no pack and no buy path, only referrals', async () => {
  const f = d755Env();
  const state = await getIntroCreditState(f.env, { id: 1, role: 'investor' } as any);
  const spend = f.raw.prepare(`INSERT INTO intro_credit_ledger (user_id, delta, bucket, kind, source_ref, note) VALUES (1, -1, 'allowance', 'spend', ?, 'fixture')`);
  for (let i = 0; i < state.balance; i++) spend.run(`fixture-spend-${i}`);
  assert.equal((await getIntroCreditState(f.env, { id: 1, role: 'investor' } as any)).balance, 0);
  f.raw.prepare(`INSERT INTO users (id, uid, name, role) VALUES (2, 'u2', 'Target', 'founder')`).run();
  f.raw.prepare(`INSERT INTO intro_propositions (uid, user_id, target_user_id, status) VALUES ('prop-d755', 1, 2, 'pending')`).run();
  const res = await f.call('POST', '/api/introductions/propositions/prop-d755/accept');
  assert.equal(res.status, 402);
  assert.equal(res.body.code, 'intro_credits_exhausted');
  assert.ok(!('packs' in res.body), 'no packs');
  assert.ok(!('buy_path' in res.body), 'no buy path');
  assert.equal(res.body.refer_path, '/account/referrals');
});

test('D755 an introduction PaymentIntent minted before the switch still grants its credits through the webhook', async () => {
  const f = d755Env();
  const pi = {
    id: 'pi_before_switch', object: 'payment_intent', status: 'succeeded', amount: 39_900, amount_received: 39_900, currency: 'usd',
    metadata: { kind: 'intro_credits', user_id: '1', pack: 'intro_100', credits: '100' },
  };
  const body = JSON.stringify({ id: 'evt_before_switch', type: 'payment_intent.succeeded', data: { object: pi } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(D755_WEBHOOK), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))))
    .map((n) => n.toString(16).padStart(2, '0')).join('');
  const { out: res } = await withoutNetwork(() => billingRoute.request('/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body,
  }, f.env));
  assert.equal(res.status, 200, await res.text());
  const state = await getIntroCreditState(f.env, { id: 1, role: 'investor' } as any);
  assert.equal(state.purchased_remaining, 100, 'the purchased bucket is credited');
  assert.equal(state.purchased_total, 100);
});
