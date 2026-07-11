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
      const stmt = {
        bind(...vals: unknown[]) { bound = vals; return stmt; },
        async run() {
          const info = db.prepare(sql).run(...(bound as any[]));
          return { success: true, meta: { changes: Number(info.changes) } } as any;
        },
        async first<T = any>() { return (db.prepare(sql).get(...(bound as any[])) ?? null) as T | null; },
        async all<T = any>() { return { results: db.prepare(sql).all(...(bound as any[])) as T[] } as any; },
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
