/**
 * D544 note (#1107; the owner's answer Q2 A on #1102) — feature requests earn
 * no credits. Migration 407 switches off the three `feature_shipped_*` rules
 * that migration 381 seeded, and `grantCredits` then refuses them.
 *
 * The schema is the Perks harness's (the shipped migrations, read off disk),
 * with 407 applied on top, as production gets it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/feature_rules_off_d544.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JWT_SECRET, freshDb, makeD1, FOUNDER, MIG } from './_perks_harness.ts';
import { grantCredits } from '../src/services/creditGrants.ts';

const SYSTEM = { kind: 'system' as const, source: 'test' };
const FEATURE_RULES = ['feature_shipped_high', 'feature_shipped_medium', 'feature_shipped_low'];

function setup() {
  const db = freshDb();
  db.exec(MIG('407_feature_shipped_rules_off.sql'));
  db.exec('CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);');
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, { beforeBatch: null }) };
  return { db, env };
}
const rule = (db: any, k: string) => db.prepare('SELECT credits, usd_value_cents, active FROM credit_reward_rules WHERE key = ?').get(k) as any;

test('the three feature_shipped rules read inactive, with their amounts kept', () => {
  const { db } = setup();
  assert.deepEqual(FEATURE_RULES.map((k) => [k, rule(db, k).active]), FEATURE_RULES.map((k) => [k, 0]));
  assert.deepEqual([rule(db, 'feature_shipped_high').credits, rule(db, 'feature_shipped_medium').credits, rule(db, 'feature_shipped_low').credits], [150, 60, 20]);
});

test('every other rule is untouched', () => {
  const { db } = setup();
  const others = db.prepare(`SELECT key, active FROM credit_reward_rules WHERE key NOT IN (${FEATURE_RULES.map(() => '?').join(', ')})`).all(...FEATURE_RULES) as any[];
  assert.ok(others.length > 10, 'the seeded rules are missing');
  assert.deepEqual(others.filter((r) => r.active !== 1).map((r) => r.key), []);
  assert.equal(rule(db, 'task_approved').active, 1, 'an approved suggested task still earns (Q3 A)');
  assert.equal(rule(db, 'task_approved').credits, 10);
});

test('grantCredits refuses each feature rule with rule_inactive and writes nothing', async () => {
  const { db, env } = setup();
  for (const k of FEATURE_RULES) {
    const out = await grantCredits(env, { userId: FOUNDER, ruleKey: k, sourceRef: `feature:${k}`, actor: SYSTEM });
    assert.equal(out.status, 'refused', k);
    assert.equal((out as any).code, 'rule_inactive', k);
  }
  const n = db.prepare("SELECT COUNT(*) AS n FROM perk_credit_ledger WHERE rule_key LIKE 'feature_shipped_%'").get() as any;
  assert.equal(n.n, 0);
  const ok = await grantCredits(env, { userId: FOUNDER, ruleKey: 'task_approved', sourceRef: 'task:1', actor: SYSTEM });
  assert.equal(ok.status, 'granted', 'the migration switched off more than the feature rules');
});

test('re-running 407 changes nothing', () => {
  const { db } = setup();
  db.exec(MIG('407_feature_shipped_rules_off.sql'));
  assert.deepEqual(FEATURE_RULES.map((k) => rule(db, k).active), [0, 0, 0]);
});
