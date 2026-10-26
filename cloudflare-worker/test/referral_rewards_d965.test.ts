/**
 * D965 (#2798) — Programs part 12: referral rewards paid in perk credits.
 *
 * The review, the rewards read and the member overview run through their
 * real router on node:sqlite, over the Perks harness (migrations 186–381)
 * with migration 566's rules read off disk. `grantCredits` runs for real.
 * The copy half of 566 is applied to a database built from the baseline and
 * every migration before it, as production builds it.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/referral_rewards_d965.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { freshDb, makeD1, JWT_SECRET, ADMIN, FOUNDER, PARTNER, MIG } from './_perks_harness.ts';
import { ensureAdminAuditLogTable } from '../src/routes/admin.ts';
import refer from '../src/routes/refer_earn.ts';
import { ledgerSource } from '../src/routes/perks.ts';
import { ruleKind } from '../src/routes/admin_credit_rules.ts';
import { ruleReason } from '../src/services/creditGrants.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { ensureReferralSubmissionsSchema, rewardLine, REFERRAL_REWARD_RULES } from '../src/services/referralSubmissions.ts';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const M566 = MIG('566_referral_reward_rules.sql');
const SUPER = 30;
const ROLES: Record<number, string> = { [SUPER]: 'admin', [ADMIN]: 'admin', [FOUNDER]: 'founder', [PARTNER]: 'partner' };

async function tok(id: number) {
  return new SignJWT({ user_id: id, role: ROLES[id] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};

async function harness({ rules = true } = {}) {
  const db = freshDb();
  db.exec("ALTER TABLE users ADD COLUMN referral_code TEXT; ALTER TABLE users ADD COLUMN legacy_referral_code TEXT; UPDATE users SET referral_code='ref_' || id");
  db.exec('CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT)');
  db.prepare(`INSERT INTO users (id, role, email, referral_code) VALUES (?, 'admin', 'super@example.test', 'ref_super')`).run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  // 566's rules; its copy half needs part 1's tables, which this harness lacks.
  if (rules) for (const stmt of splitStatements(M566)) if (/^\s*INSERT/i.test(stmt)) db.exec(stmt);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, { beforeBatch: null }) };
  await ensureReferralSubmissionsSchema(env);
  await ensureAdminAuditLogTable(env);
  const app = new Hono().route('/refer', refer);
  app.onError((e, c) => mapError(c as any, e));
  const call = async (path: string, method = 'GET', data?: any, who = ADMIN) => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${await tok(who)}`, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const referral = (uid: string, status: string, category = 'startup', referrer = FOUNDER) => {
    db.prepare(`INSERT INTO referral_submissions (uid, referrer_user_id, category, referred_name, status) VALUES (?, ?, ?, 'Test Referral', ?)`).run(uid, referrer, category, status);
  };
  const move = (uid: string, status: string, who = ADMIN) => call(`/refer/admin/submissions/${uid}`, 'PATCH', { status }, who);
  const ledger = (userId = FOUNDER) => db.prepare('SELECT id, delta, kind, source_ref, rule_key FROM perk_credit_ledger WHERE user_id = ? ORDER BY id').all(userId).map((x: any) => ({ ...x }));
  const statusOf = (uid: string) => (db.prepare('SELECT status FROM referral_submissions WHERE uid = ?').get(uid) as any).status;
  return { db, env, call, referral, move, ledger, statusOf };
}

test('migration 566 seeds O-CRD A at US$1 a credit, and the credit rules read them as rewards', async () => {
  const h = await harness();
  try {
    const rows = h.db.prepare(`SELECT key, credits, usd_value_cents, active FROM credit_reward_rules WHERE substr(key, 1, 9) = 'referral:' ORDER BY key`).all().map((x: any) => ({ ...x }));
    assert.deepEqual(rows, [
      { key: 'referral:customer_onboarded', credits: 50, usd_value_cents: 5000, active: 1 },
      { key: 'referral:startup_accepted', credits: 100, usd_value_cents: 10000, active: 1 },
      { key: 'referral:startup_formed', credits: 400, usd_value_cents: 40000, active: 1 },
    ]);
    assert.deepEqual(REFERRAL_REWARD_RULES.map((r) => r.key).sort(), rows.map((r: any) => r.key));
    for (const r of rows) assert.equal(ruleKind(r.key), 'reward');
    assert.equal(ruleReason('referral:startup_accepted'), 'A startup you referred was accepted');
    assert.equal(ruleReason('referral:startup_formed'), 'A startup you referred formed its company');
    assert.equal(ruleReason('referral:customer_onboarded'), 'A platform user you referred was onboarded');
    assert.equal(ledgerSource('referral:abc:referral:startup_accepted'), 'Referral reward');
  } finally { h.db.close(); }
});

test('a move into a paying status grants once, before the move; a retry pays nothing more', async () => {
  const h = await harness();
  try {
    h.referral('s1', 'in_conversation');
    const accepted = await quiet(() => h.move('s1', 'converted'));
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.status, 'converted');
    const first = h.ledger();
    assert.equal(first.length, 1);
    assert.deepEqual(first[0], { id: first[0].id, delta: 100, kind: 'grant', source_ref: 'referral:s1:referral:startup_accepted', rule_key: 'referral:startup_accepted' });
    assert.deepEqual(accepted.body.reward, { rule_key: 'referral:startup_accepted', paid: true, credits: 100, ledger_id: first[0].id });
    const audit = h.db.prepare(`SELECT admin_user_id, action FROM admin_audit_log WHERE action = 'credit_grant'`).all();
    assert.equal(audit.length, 1); assert.equal((audit[0] as any).admin_user_id, ADMIN);

    // A move that pays no rule answers reward: null and writes nothing.
    const eligible = await quiet(() => h.move('s1', 'reward_eligible'));
    assert.equal(eligible.body.reward, null);
    assert.equal(h.ledger().length, 1);

    const formed = await quiet(() => h.move('s1', 'reward_issued'));
    assert.equal(formed.body.reward.credits, 400);
    assert.deepEqual(h.ledger().map((l: any) => l.rule_key), ['referral:startup_accepted', 'referral:startup_formed']);

    // A retry after a move that failed: the grant landed, the move did not.
    h.referral('s2', 'in_conversation');
    const hooks = (h.env.DB as any);
    const batch = hooks.batch;
    hooks.batch = async () => { throw new Error('D1 went away'); };
    const failed = await quiet(() => h.move('s2', 'converted'));
    assert.ok(failed.status >= 400, 'the failed move is refused');
    assert.equal(h.statusOf('s2'), 'in_conversation');
    hooks.batch = batch;
    const retry = await quiet(() => h.move('s2', 'converted'));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.reward.paid, true);
    assert.equal(retry.body.reward.credits, 100);
    assert.equal(h.ledger().filter((l: any) => l.source_ref === 'referral:s2:referral:startup_accepted').length, 1, 'paid once');
  } finally { h.db.close(); }
});

test('a platform user pays at Reward issued only, and strategic pays no rule', async () => {
  const h = await harness();
  try {
    h.referral('c1', 'in_conversation', 'customer');
    assert.equal((await quiet(() => h.move('c1', 'converted'))).body.reward, null);
    await quiet(() => h.move('c1', 'reward_eligible'));
    const onboarded = await quiet(() => h.move('c1', 'reward_issued'));
    assert.deepEqual({ ...onboarded.body.reward, ledger_id: 0 }, { rule_key: 'referral:customer_onboarded', paid: true, credits: 50, ledger_id: 0 });
    h.referral('x1', 'reward_eligible', 'strategic');
    assert.equal((await quiet(() => h.move('x1', 'reward_issued'))).body.reward, null);
    assert.deepEqual(h.ledger().map((l: any) => l.delta), [50]);
  } finally { h.db.close(); }
});

test('a rule that is off lets the move through and pays nothing', async () => {
  const h = await harness();
  try {
    h.db.prepare(`UPDATE credit_reward_rules SET active = 0 WHERE key = 'referral:startup_accepted'`).run();
    h.referral('s1', 'in_conversation');
    const r = await quiet(() => h.move('s1', 'converted'));
    assert.equal(r.status, 200);
    assert.equal(h.statusOf('s1'), 'converted');
    assert.deepEqual(r.body.reward, { rule_key: 'referral:startup_accepted', paid: false, code: 'rule_inactive' });
    assert.equal(h.ledger().length, 0);
  } finally { h.db.close(); }
});

test('O-CRD A: a partner referrer is not paid, and the referral still moves', async () => {
  const h = await harness();
  try {
    h.referral('p1', 'in_conversation', 'startup', PARTNER);
    const r = await quiet(() => h.move('p1', 'converted'));
    assert.equal(r.status, 200);
    assert.equal(h.statusOf('p1'), 'converted');
    assert.deepEqual(r.body.reward, { rule_key: 'referral:startup_accepted', paid: false, code: 'not_eligible' });
    assert.equal(h.ledger(PARTNER).length, 0);
  } finally { h.db.close(); }
});

test('any other refusal refuses the move with reward_not_paid, and writes nothing', async () => {
  const h = await harness({ rules: false });
  try {
    h.referral('s1', 'in_conversation');
    const r = await quiet(() => h.move('s1', 'converted'));
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'reward_not_paid');
    assert.match(r.body.error.message, /rule_unknown/);
    assert.equal(h.statusOf('s1'), 'in_conversation');
    assert.equal(h.ledger().length, 0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM referral_submission_events').get().n, 0);
  } finally { h.db.close(); }
});

test('the rewards read: rules for every admin, paid for a Super Admin only, revoked grants not counted', async () => {
  const h = await harness();
  try {
    h.referral('s1', 'in_conversation');
    h.referral('s2', 'reward_eligible', 'customer');
    await quiet(() => h.move('s1', 'converted'));
    await quiet(() => h.move('s2', 'reward_issued'));
    h.referral('s3', 'in_conversation');
    await quiet(() => h.move('s3', 'converted'));
    // s3's grant is revoked by a Super Admin.
    const s3 = h.db.prepare(`SELECT id FROM perk_credit_ledger WHERE source_ref = 'referral:s3:referral:startup_accepted'`).get() as any;
    h.db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref) VALUES (?, -100, 'admin_adjust', ?)`).run(FOUNDER, `revoke:${s3.id}`);
    // A non-referral grant is not counted.
    h.db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, rule_key) VALUES (?, 150, 'grant', 'ticket:1', 'bug_high')`).run(FOUNDER);

    const admin = await h.call('/refer/admin/rewards');
    assert.equal(admin.status, 200);
    assert.equal(admin.body.paid, null);
    assert.deepEqual(admin.body.rules.map((r: any) => [r.key, r.category, r.pays_at, r.credits, r.active]), [
      ['referral:startup_accepted', 'startup', 'converted', 100, true],
      ['referral:startup_formed', 'startup', 'reward_issued', 400, true],
      ['referral:customer_onboarded', 'customer', 'reward_issued', 50, true],
    ]);
    const hq = await h.call('/refer/admin/rewards', 'GET', undefined, SUPER);
    assert.deepEqual(hq.body.paid, {
      grants: 2, credits: 150,
      by_rule: {
        'referral:startup_accepted': { grants: 1, credits: 100 },
        'referral:startup_formed': { grants: 0, credits: 0 },
        'referral:customer_onboarded': { grants: 1, credits: 50 },
      },
    });
    assert.equal((await h.call('/refer/admin/rewards', 'GET', undefined, FOUNDER)).status, 403);
    const broken = await harness();
    broken.db.exec('DROP TABLE perk_credit_ledger');
    const fail = await quiet(() => broken.call('/refer/admin/rewards', 'GET', undefined, SUPER));
    assert.ok(fail.status >= 500, 'a failed read is a 5xx, never zeros');
    broken.db.close();
  } finally { h.db.close(); }
});

test('the member overview promises only the rules that are on, and none when the read fails', async () => {
  const h = await harness();
  try {
    const on = await h.call('/refer/overview', 'GET', undefined, FOUNDER);
    const cat = (b: any, k: string) => b.categories.find((c: any) => c.key === k);
    assert.equal(cat(on.body, 'startup').reward, '100 perk credits on acceptance, and 400 perk credits on formation.');
    assert.deepEqual(cat(on.body, 'startup').rewards.map((r: any) => [r.rule_key, r.credits, r.pays_at]),
      [['referral:startup_accepted', 100, 'converted'], ['referral:startup_formed', 400, 'reward_issued']]);
    assert.equal(cat(on.body, 'customer').reward, '50 perk credits once onboarded.');
    assert.equal(cat(on.body, 'strategic').reward, 'Invite-only economics, negotiated case by case.');
    assert.deepEqual(cat(on.body, 'strategic').rewards, []);

    h.db.prepare(`UPDATE credit_reward_rules SET active = 0 WHERE key = 'referral:customer_onboarded'`).run();
    h.db.prepare(`UPDATE credit_reward_rules SET credits = 120, usd_value_cents = 12000 WHERE key = 'referral:startup_accepted'`).run();
    const off = await h.call('/refer/overview', 'GET', undefined, FOUNDER);
    assert.equal(cat(off.body, 'customer').reward, 'No perk credits are paid for this kind of referral now.');
    assert.deepEqual(cat(off.body, 'customer').rewards, []);
    assert.match(cat(off.body, 'startup').reward, /^120 perk credits on acceptance/);

    h.db.exec('DROP TABLE credit_reward_rules');
    const unread = await quiet(() => h.call('/refer/overview', 'GET', undefined, FOUNDER));
    assert.equal(unread.status, 200);
    assert.equal(cat(unread.body, 'startup').rewards, null);
    assert.doesNotMatch(cat(unread.body, 'startup').reward, /credits? on/);
    assert.equal(rewardLine('startup', []), 'No perk credits are paid for this kind of referral now.');
  } finally { h.db.close(); }
});

// ---- the copy half of 566, on the production build --------------------------

function beforeM566(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 566)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}

test('566 applies whole after 560, replaces the seed copy, and never an HQ edit; it re-runs cleanly', () => {
  const db = beforeM566();
  const body = (v: number) => (db.prepare(`SELECT body FROM program_playbook_sections WHERE program_key = 'refer-and-earn' AND section_key = 'rewards' AND version = ?`).get(v) as any).body;
  const purpose = () => (db.prepare(`SELECT purpose FROM programs WHERE key = 'refer-and-earn'`).get() as any).purpose;
  assert.match(body(1), /^No referral pays perk credits\./);
  // HQ edited the draft; version 1 still holds the seed.
  db.prepare(`UPDATE program_playbook_sections SET body = 'HQ wrote this.' WHERE program_key = 'refer-and-earn' AND section_key = 'rewards' AND version = 0`).run();
  db.exec(M566);
  assert.equal(body(0), 'HQ wrote this.');
  assert.doesNotMatch(body(1), /No referral pays perk credits/);
  assert.match(body(1), /Converted \(on acceptance\).*Reward issued \(on formation\)/);
  assert.match(body(1), /Partner referrers are not paid perk credits\./);
  assert.match(body(1), /introduction credits are not perk credits/);
  assert.doesNotMatch(body(1), /\d+ (perk )?credits/, 'no amount is written into the copy');
  assert.match(purpose(), /earn perk credits/);
  assert.match(purpose(), /introduction credit\.$/);
  const keys = () => db.prepare(`SELECT COUNT(*) AS n FROM credit_reward_rules WHERE substr(key, 1, 9) = 'referral:'`).get() as any;
  assert.equal(keys().n, 3);
  db.prepare(`UPDATE credit_reward_rules SET credits = 120 WHERE key = 'referral:startup_accepted'`).run();
  db.exec(M566);
  assert.equal(keys().n, 3);
  assert.equal((db.prepare(`SELECT credits FROM credit_reward_rules WHERE key = 'referral:startup_accepted'`).get() as any).credits, 120, 'a re-run never resets an edit');
  db.close();
});
