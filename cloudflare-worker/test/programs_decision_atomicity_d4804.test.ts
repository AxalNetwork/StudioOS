/**
 * D4804 (#4804, Programs audit 1/7) — a rejected or losing decision leaves every
 * decision-dependent financial record unchanged.
 *
 *   1. Referral partner terms: a stale draft edit that loses to submit or approve
 *      returns 409 and changes neither the terms nor any commission trigger. The
 *      competing decision lands between the edit's read and its batch (the batch
 *      hook), so only the edit's own guards can stop it.
 *   2. Refer & Earn: a conversion that loses to a rejection issues no acceptance
 *      reward and writes no history. A conversion that wins writes one decision,
 *      one reward and one history row. A request that loses to an identical one
 *      pays nothing a second time. A batch that fails leaves no reward and says
 *      so in a sentence, with no database text.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/programs_decision_atomicity_d4804.test.ts
 *
 * Every person and amount is made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import partnersRoute from '../src/routes/admin_referral_partners.ts';
import { todayUtc } from '../src/services/referralPartnerTerms.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { freshDb, makeD1, JWT_SECRET, ADMIN, FOUNDER, MIG, type Hook } from './_perks_harness.ts';
import { ensureAdminAuditLogTable } from '../src/routes/admin.ts';
import refer from '../src/routes/refer_earn.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { ensureReferralSubmissionsSchema } from '../src/services/referralSubmissions.ts';
import { splitStatements } from './_baseline.mjs';

const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};
const DB_TEXT = /constraint|SQLITE|UNIQUE|FOREIGN KEY|NOT NULL|D1_ERROR/i;

// ── 1. Referral partner terms ─────────────────────────────────────────────

const SUPER = 1, ADMIN_P = 2, PIA = 10;
const TODAY = todayUtc();
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function partnerFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified, referral_code) VALUES (?, ?, ?, ?, 1, 1, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', null);
  u.run(ADMIN_P, 'admin', 'Pat Plain', 'pat@example.test', null);
  u.run(PIA, 'partner', 'Pia Partner', 'pia@example.test', 'PIA001');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN_P]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  db.prepare("INSERT INTO referral_partners (id, user_id, segment, added_by, added_at) VALUES (1, ?, 'event_organisers', ?, '2026-09-01 10:00:00')").run(PIA, SUPER);
  return db;
}

const partnerApp = new Hono<any>();
partnerApp.route('/api/admin/referral-partners', partnersRoute);
partnerApp.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (m === 'Admin required' || m === 'Super admin required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

/** The D1 binding, with a competing write that lands just before the first batch. */
function racing(db: DatabaseSync, race: (() => void) | null) {
  const d1: any = d1Over(db);
  let pending = race;
  return { ...d1, prepare: d1.prepare.bind(d1), batch: async (x: any[]) => { if (pending) { const r = pending; pending = null; r(); } return d1.batch(x); } };
}
async function callTerms(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, race: (() => void) | null = null) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return quiet(async () => {
    const res = await withThrownResponses(() => partnerApp.request(`/api/admin/referral-partners${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: racing(db, race) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  });
}
const FLAT = [{ rule_key: 'referral_kyc_approved', amount_cents: 12000 }];
const NEW_TRIGGERS = [{ rule_key: 'subscription_invoice', percentage_bps: 500 }];
const draft = () => ({ user_id: PIA, starts_on: YESTERDAY, ends_on: null, currency: 'USD', triggers: FLAT, contract_slug: 'finders-fee', note: 'first' });
const updatedAudits = (db: DatabaseSync) => {
  try { return Number((db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'referral_terms.updated'").get() as any).n); } catch { return 0; }
};
const termsRow = (db: DatabaseSync, uid: string) => ({ ...(db.prepare(
  `SELECT status, starts_on, ends_on, cap_per_intro_cents, overall_cap_cents, currency, sectors, contract_slug, note, updated_at
     FROM referral_partner_terms WHERE uid = ?`).get(uid) as any) });
const triggersOf = (db: DatabaseSync, uid: string) => db.prepare(
  `SELECT g.rule_key, g.amount_cents, g.percentage_bps FROM referral_partner_term_triggers g
     JOIN referral_partner_terms t ON t.id = g.terms_id WHERE t.uid = ? ORDER BY g.rule_key`).all(uid).map((r: any) => ({ ...r }));

for (const [name, to, setup] of [
  ['submit', 'submitted', (db: DatabaseSync, uid: string) => db.prepare("UPDATE referral_partner_terms SET status = 'submitted', submitted_at = datetime('now') WHERE uid = ?").run(uid)],
  ['approve', 'approved', (db: DatabaseSync, uid: string) => db.prepare("UPDATE referral_partner_terms SET status = 'approved', submitted_at = datetime('now'), approved_by = ?, approved_at = datetime('now') WHERE uid = ?").run(SUPER, uid)],
] as const) {
  test(`1. a stale draft edit that loses to ${name} returns 409 and changes neither the terms nor any commission trigger`, async () => {
    const db = partnerFixture();
    const made = await callTerms(db, ADMIN_P, 'POST', '/terms', draft());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const uid = made.body.uid as string;
    const before = { row: termsRow(db, uid), triggers: triggersOf(db, uid) };
    assert.deepEqual(before.triggers, [{ rule_key: 'referral_kyc_approved', amount_cents: 12000, percentage_bps: null }]);

    // The edit has read a draft; the competing decision lands before its batch.
    const stale = await callTerms(db, ADMIN_P, 'PATCH', `/terms/${uid}`,
      { note: 'late edit', cap_per_intro_cents: 99000, triggers: NEW_TRIGGERS }, () => setup(db, uid));
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.error, 'terms_not_draft');
    assert.doesNotMatch(JSON.stringify(stale.body), DB_TEXT, 'a sentence, never database text');

    const after = { row: termsRow(db, uid), triggers: triggersOf(db, uid) };
    assert.equal(after.row.status, to, 'the competing decision stands');
    assert.deepEqual(after.triggers, before.triggers, 'every commission trigger is as the decision saw it');
    assert.deepEqual({ ...after.row, status: before.row.status, updated_at: before.row.updated_at }, before.row, 'and so are the terms');
    assert.equal(updatedAudits(db), 0, 'no edit is recorded');
    db.close();
  });
}

test('1b. an edit that wins replaces the terms and every trigger together, and an edit with no competitor still works', async () => {
  const db = partnerFixture();
  const uid = (await callTerms(db, ADMIN_P, 'POST', '/terms', draft())).body.uid as string;
  const won = await callTerms(db, ADMIN_P, 'PATCH', `/terms/${uid}`, { note: 'second', triggers: NEW_TRIGGERS });
  assert.equal(won.status, 200, JSON.stringify(won.body));
  assert.equal(termsRow(db, uid).note, 'second');
  assert.deepEqual(triggersOf(db, uid), [{ rule_key: 'subscription_invoice', amount_cents: null, percentage_bps: 500 }], 'one set, replaced whole');
  // Two edits in turn: the last one stands, with its own triggers and nobody else's.
  const again = await callTerms(db, ADMIN_P, 'PATCH', `/terms/${uid}`, { note: 'third', triggers: FLAT });
  assert.equal(again.status, 200);
  assert.deepEqual(triggersOf(db, uid), [{ rule_key: 'referral_kyc_approved', amount_cents: 12000, percentage_bps: null }]);
  assert.equal(termsRow(db, uid).note, 'third');
  db.close();
});

// ── 2. Refer & Earn ───────────────────────────────────────────────────────

async function tok(id: number) {
  return new SignJWT({ user_id: id, role: id === FOUNDER ? 'founder' : 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function referHarness() {
  const db = freshDb();
  db.exec("ALTER TABLE users ADD COLUMN referral_code TEXT; ALTER TABLE users ADD COLUMN legacy_referral_code TEXT; UPDATE users SET referral_code='ref_' || id");
  db.exec('CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT)');
  for (const stmt of splitStatements(MIG('566_referral_reward_rules.sql'))) if (/^\s*INSERT/i.test(stmt)) db.exec(stmt);
  const hooks: { beforeBatch: Hook } = { beforeBatch: null };
  const d1: any = makeD1(db, hooks);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1 };
  await ensureReferralSubmissionsSchema(env);
  await ensureAdminAuditLogTable(env);
  const app = new Hono().route('/refer', refer);
  app.onError((e, c) => mapError(c as any, e));
  const move = async (uid: string, status: string) => quiet(async () => {
    const res = await app.request(`/refer/admin/submissions/${uid}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${await tok(ADMIN)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  });
  const referral = (uid: string, status: string) => {
    db.prepare(`INSERT INTO referral_submissions (uid, referrer_user_id, category, referred_name, status) VALUES (?, ?, 'startup', 'Test Referral', ?)`).run(uid, FOUNDER, status);
  };
  const sub = (uid: string) => db.prepare('SELECT id, status FROM referral_submissions WHERE uid = ?').get(uid) as any;
  const ledger = () => db.prepare(`SELECT id, delta, source_ref FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' ORDER BY id`).all(FOUNDER).map((x: any) => ({ ...x }));
  const events = (uid: string) => db.prepare('SELECT label, status FROM referral_submission_events WHERE submission_id = ? ORDER BY id').all(sub(uid).id).map((x: any) => ({ ...x }));
  const audit = () => Number((db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'credit_grant'").get() as any).n);
  return { db, d1, hooks, move, referral, sub, ledger, events, audit };
}

test('2a. a conversion that loses to a rejection issues no acceptance reward and writes no history', async () => {
  const h = await referHarness();
  try {
    h.referral('r1', 'in_conversation');
    const eventsBefore = h.events('r1');
    // The rejection commits after the conversion has read the referral and planned its reward.
    h.hooks.beforeBatch = (db) => { db.prepare("UPDATE referral_submissions SET status = 'rejected' WHERE uid = 'r1'").run(); };
    const lost = await h.move('r1', 'converted');
    assert.equal(lost.status, 409, JSON.stringify(lost.body));
    assert.equal(lost.body.error.code, 'bad_transition');
    assert.match(lost.body.error.message, /moved from in_conversation to rejected/);
    assert.doesNotMatch(JSON.stringify(lost.body), DB_TEXT);
    assert.equal(h.sub('r1').status, 'rejected', 'the rejection stands');
    assert.deepEqual(h.ledger(), [], 'no acceptance credits');
    assert.deepEqual(h.events('r1'), eventsBefore, 'no history row for the decision that lost');
    assert.equal(h.audit(), 0, 'no grant is audited or announced');
  } finally { h.db.close(); }
});

test('2b. a conversion that wins writes one decision, one reward and one history row; a retry changes nothing', async () => {
  const h = await referHarness();
  try {
    h.referral('r2', 'in_conversation');
    const won = await h.move('r2', 'converted');
    assert.equal(won.status, 200, JSON.stringify(won.body));
    assert.equal(h.sub('r2').status, 'converted');
    const ledger = h.ledger();
    assert.equal(ledger.length, 1);
    assert.deepEqual([ledger[0].delta, ledger[0].source_ref], [100, 'referral:r2:referral:startup_accepted']);
    assert.deepEqual(won.body.reward, { rule_key: 'referral:startup_accepted', paid: true, credits: 100, ledger_id: ledger[0].id });
    assert.equal(h.events('r2').filter((e) => e.status === 'converted').length, 1, 'one history row');
    assert.equal(h.audit(), 1, 'one audit line, after the commit');

    // The same request again: the referral is already converted, so it is an annotation. Nothing is written twice.
    const retry = await h.move('r2', 'converted');
    assert.equal(retry.status, 200);
    assert.equal(h.ledger().length, 1);
    assert.equal(h.events('r2').filter((e) => e.status === 'converted').length, 1);
  } finally { h.db.close(); }
});

test('2c. a request that loses to an identical one pays and records nothing a second time', async () => {
  const h = await referHarness();
  try {
    h.referral('r3', 'in_conversation');
    // The first of two identical requests commits whole just before ours.
    h.hooks.beforeBatch = (db) => {
      const id = (db.prepare("SELECT id FROM referral_submissions WHERE uid = 'r3'").get() as any).id;
      db.prepare("UPDATE referral_submissions SET status = 'converted' WHERE uid = 'r3'").run();
      db.prepare("INSERT INTO referral_submission_events (submission_id, label, status, actor_user_id) VALUES (?, 'Converted', 'converted', ?)").run(id, ADMIN);
      db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, created_at, rule_key)
                  VALUES (?, 100, 'grant', 'referral:r3:referral:startup_accepted', 'A startup you referred was accepted', datetime('now'), 'referral:startup_accepted')`).run(FOUNDER);
    };
    const second = await h.move('r3', 'converted');
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(h.ledger().length, 1, 'still the one reward');
    assert.equal(h.events('r3').filter((e) => e.status === 'converted').length, 1, 'still the one history row');
  } finally { h.db.close(); }
});

test('2d. a batch that fails leaves no reward, and says so in a sentence', async () => {
  const h = await referHarness();
  try {
    h.referral('r4', 'in_conversation');
    const batch = h.d1.batch;
    h.d1.batch = async () => { throw new Error('D1_ERROR: UNIQUE constraint failed: perk_credit_ledger.source_ref'); };
    const failed = await h.move('r4', 'converted');
    h.d1.batch = batch;
    assert.equal(failed.status, 503, JSON.stringify(failed.body));
    assert.equal(failed.body.error.code, 'decision_not_saved');
    assert.match(failed.body.error.message, /Nothing was changed/);
    assert.doesNotMatch(JSON.stringify(failed.body), DB_TEXT, 'no raw constraint text reaches the UI');
    assert.equal(h.sub('r4').status, 'in_conversation');
    assert.deepEqual(h.ledger(), []);
    const retry = await h.move('r4', 'converted');
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(h.ledger().length, 1, 'the retry pays once');
  } finally { h.db.close(); }
});
