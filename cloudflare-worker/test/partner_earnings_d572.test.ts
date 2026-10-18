/**
 * D572 (#1183) — partner earnings: a failed payout reopens its commissions,
 * and the fields the earnings screens (D569) showed as "Not recorded".
 *
 * Runs the real routers (`routes/network.ts`, `routes/partnernet.ts`) on
 * node:sqlite. The money tables are the production baseline's own DDL with
 * migration 393 applied on top, so the migration is exercised by every test
 * here, and the batch is the shared one-transaction binding (`_d1_sqlite`).
 *
 * Run alone:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/partner_earnings_d572.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import network from '../src/routes/network.ts';
import partnernet from '../src/routes/partnernet.ts';
import { d1Over } from './_d1_sqlite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const MIG = (name: string) => readFileSync(resolve(SQL, 'migrations', name), 'utf8');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const PLAIN_ADMIN = 2;
const PARTNER = 20;
const OTHER = 21;
const REFERRED = 30;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'activity_logs', 'admin_audit_log', 'referrals', 'commissions', 'payouts', 'commission_rules', 'partner_relationships', 'mi_pro_subscriptions', 'super_admins']) {
    db.exec(ddl(t));
  }
  // The interaction log is post-cutoff: 338 creates it and 343 adds the void columns.
  db.exec(MIG('338_partner_interactions_reminders.sql'));
  db.exec(MIG('343_partner_interaction_void.sql'));
  db.exec(MIG('368_relationship_requests.sql'));
  db.exec(MIG('393_partner_earnings.sql'));
  // D713: payout GETs read stored bank evidence after migration 477.
  for (const migration of ['311_revenue_entries.sql', '400_revenue_stripe_charge_index.sql', '477_mercury_personal.sql']) db.exec(MIG(migration));
  db.exec(MIG('409_payout_destination_and_leaderboard.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'admin@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Pia Plain', 'plain@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  u.run(PARTNER, 'partner', 'Pat Partner', 'partner@example.test');
  u.run(OTHER, 'partner', 'Olu Other', 'other@example.test');
  u.run(REFERRED, 'investor', 'Rae Referred', 'referred@example.test');
  return db;
}

/** Accrued commissions for PARTNER, oldest first; returns their ids. */
function accrue(db: InstanceType<typeof DatabaseSync>, rows: Array<[number, string]>, user = PARTNER): number[] {
  const ins = db.prepare(`INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status, created_at)
                          VALUES (?, ?, ?, 'test', ?, 'accrued', ?)`);
  return rows.map(([cents, cur], i) => Number(ins.run(user, cents, cur, `s${user}-${i}-${cents}-${cur}`, `2026-09-0${i + 1} 10:00:00`).lastInsertRowid));
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function appFor(router: any) {
  const app = new Hono<any>();
  app.route('/', router);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  return app;
}
const NET = appFor(network);
const PNET = appFor(partnernet);

async function call(
  db: InstanceType<typeof DatabaseSync>,
  who: { user: number; role: string },
  path: string,
  init: { method?: string; body?: any } = {},
  { app = NET, DB = d1Over(db) }: { app?: any; DB?: any } = {},
): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${await token(who.user, who.role)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const admin = { user: ADMIN, role: 'admin' };
const plainAdmin = { user: PLAIN_ADMIN, role: 'admin' };
const partner = { user: PARTNER, role: 'partner' };
const statusOf = (db: InstanceType<typeof DatabaseSync>, id: number) =>
  (db.prepare('SELECT status, paid_at FROM commissions WHERE id = ?').get(id) as any);

// --- The defect ------------------------------------------------------------

test('a failed payout puts its commissions back to accrued, records the day, and they can be requested again', async () => {
  const db = freshDb();
  const [a, b] = accrue(db, [[3000, 'USD'], [2000, 'USD']]);

  const req = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 5000, payout_method: 'wire' } });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  assert.deepEqual(req.body.commission_ids, [a, b]);
  assert.equal(statusOf(db, a).status, 'paid');
  assert.deepEqual((db.prepare('SELECT commission_id FROM payout_commissions WHERE payout_id = ? ORDER BY commission_id').all(req.body.id) as any[]).map((r) => r.commission_id), [a, b],
    'the payout records which commissions it claimed');

  const fail = await call(db, admin, `/admin/payouts/${req.body.id}/process`, { method: 'PATCH', body: { action: 'fail', failure_reason: 'Bank rejected' } });
  assert.equal(fail.status, 200, JSON.stringify(fail.body));
  assert.equal(fail.body.commissions_reopened, 2);
  assert.equal(fail.body.unlinked, false);
  for (const id of [a, b]) {
    assert.equal(statusOf(db, id).status, 'accrued', 'a failed payout must give its commissions back');
    assert.equal(statusOf(db, id).paid_at, null);
  }
  const p: any = db.prepare('SELECT status, failed_at, processed_at, failure_reason FROM payouts WHERE id = ?').get(req.body.id);
  assert.equal(p.status, 'failed');
  assert.match(String(p.failed_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'the failure date is recorded');
  assert.ok(p.processed_at, 'the last move is dated');

  const again = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 5000, payout_method: 'wire' } });
  assert.equal(again.status, 200, 'the reopened balance can be requested again');
  // The history keeps both claims.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payout_commissions WHERE commission_id = ?').get(a) as any).n, 2);
});

test('a completed or already failed payout cannot be failed, and reopens nothing', async () => {
  const db = freshDb();
  const [a] = accrue(db, [[1500, 'USD']]);
  const req = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 1500, payout_method: 'crypto' } });
  const done = await call(db, admin, `/admin/payouts/${req.body.id}/process`, { method: 'PATCH', body: { action: 'complete' } });
  assert.equal(done.status, 200);
  const fail = await call(db, admin, `/admin/payouts/${req.body.id}/process`, { method: 'PATCH', body: { action: 'fail' } });
  assert.equal(fail.status, 409);
  assert.equal(fail.body.error, 'payout_not_open');
  assert.equal(statusOf(db, a).status, 'paid', 'a completed payout keeps its commissions paid');

  const db2 = freshDb();
  accrue(db2, [[1500, 'USD']]);
  const r2 = await call(db2, partner, '/payout/request', { method: 'POST', body: { amount_cents: 1500, payout_method: 'crypto' } });
  assert.equal((await call(db2, admin, `/admin/payouts/${r2.body.id}/process`, { method: 'PATCH', body: { action: 'fail' } })).status, 200);
  assert.equal((await call(db2, admin, `/admin/payouts/${r2.body.id}/process`, { method: 'PATCH', body: { action: 'fail' } })).status, 409, 'a payout fails once');
  assert.equal((await call(db2, admin, `/admin/payouts/${r2.body.id}/process`, { method: 'PATCH', body: { action: 'complete' } })).status, 409,
    'completing a failed payout would pay commissions that were given back');
});

test('a commission claimed again by a later payout is not reopened by the earlier one', async () => {
  const db = freshDb();
  const [a] = accrue(db, [[2500, 'USD']]);
  const first = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 2500, payout_method: 'wire' } });
  await call(db, admin, `/admin/payouts/${first.body.id}/process`, { method: 'PATCH', body: { action: 'fail' } });
  const second = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 2500, payout_method: 'wire' } });
  assert.equal(second.status, 200);
  // Put the first payout back in flight, as a racing request would find it.
  db.prepare(`UPDATE payouts SET status = 'processing' WHERE id = ?`).run(first.body.id);
  const late = await call(db, admin, `/admin/payouts/${first.body.id}/process`, { method: 'PATCH', body: { action: 'fail' } });
  assert.equal(late.status, 200);
  assert.equal(late.body.commissions_reopened, 0);
  assert.equal(statusOf(db, a).status, 'paid', 'the later payout keeps the commission it claimed');
});

test('a request that loses a race on one commission claims none of them', async () => {
  const db = freshDb();
  const [a, b] = accrue(db, [[1000, 'USD'], [1000, 'USD']]);
  const base = d1Over(db);
  // Between the route's read and its batch, another payout takes `b`.
  const racing = { ...base, batch: async (stmts: any[]) => { db.prepare(`UPDATE commissions SET status = 'paid' WHERE id = ?`).run(b); return base.batch(stmts); } };
  const res = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 2000, payout_method: 'wire' } }, { DB: racing });
  assert.equal(res.status, 409);
  assert.equal(statusOf(db, a).status, 'accrued', 'a refused request must not mark the rest paid with no payout behind them');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payouts').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payout_commissions').get() as any).n, 0);
});

test('the batch re-checks the currency it read, so a payout never claims another currency', async () => {
  const db = freshDb();
  const [a] = accrue(db, [[1500, 'USD']]);
  const base = d1Over(db);
  // The row the route read as USD is EUR by the time the batch runs.
  const racing = { ...base, batch: async (stmts: any[]) => { db.prepare(`UPDATE commissions SET currency = 'EUR' WHERE id = ?`).run(a); return base.batch(stmts); } };
  const res = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 1500, payout_method: 'wire' } }, { DB: racing });
  assert.equal(res.status, 409);
  assert.equal(statusOf(db, a).status, 'accrued');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payouts').get() as any).n, 0);
});

test('a payout from before migration 393 fails without guessing, and says so', async () => {
  const db = freshDb();
  const [a] = accrue(db, [[4000, 'USD']]);
  db.prepare(`UPDATE commissions SET status = 'paid', paid_at = '2026-08-01 10:00:00' WHERE id = ?`).run(a);
  const legacy = Number(db.prepare(`INSERT INTO payouts (user_id, amount_cents, status, payout_method) VALUES (?, 4000, 'requested', 'wire')`).run(PARTNER).lastInsertRowid);
  const fail = await call(db, admin, `/admin/payouts/${legacy}/process`, { method: 'PATCH', body: { action: 'fail' } });
  assert.equal(fail.status, 200);
  assert.equal(fail.body.unlinked, true);
  assert.equal(fail.body.commissions_reopened, 0);
  assert.equal(statusOf(db, a).status, 'paid', 'no commission is reopened on a guess');
  const mine = await call(db, partner, '/payouts/me');
  assert.equal(mine.body[0].commission_ids, null, 'an unlinked payout reads "not recorded", not an empty list');
});

// --- Currency ---------------------------------------------------------------

test('a payout takes one currency, and balances are per currency', async () => {
  const db = freshDb();
  const [usd, eur] = accrue(db, [[2000, 'USD'], [3000, 'EUR']]);

  const vague = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 2000, payout_method: 'wire' } });
  assert.equal(vague.status, 400);
  assert.equal(vague.body.error, 'currency_required');
  assert.deepEqual(vague.body.currencies, ['EUR', 'USD']);

  const bad = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 2000, payout_method: 'wire', currency: 'dollars' } });
  assert.equal(bad.body.error, 'invalid_currency');

  const tooMuch = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 3000, payout_method: 'wire', currency: 'USD' } });
  assert.equal(tooMuch.status, 400, 'the EUR balance must not fund a USD payout');

  const eurOut = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 3000, payout_method: 'wire', currency: 'eur' } });
  assert.equal(eurOut.status, 200, JSON.stringify(eurOut.body));
  assert.equal(eurOut.body.currency, 'EUR');
  assert.deepEqual(eurOut.body.commission_ids, [eur]);
  assert.equal(statusOf(db, usd).status, 'accrued');

  const me = await call(db, partner, '/commissions/me');
  assert.equal(me.body.mixed_currency, true);
  assert.equal(me.body.balance_cents, null, 'a sum across currencies is not a figure');
  assert.deepEqual(me.body.by_currency, [
    { currency: 'EUR', balance_cents: 0, claimed_cents: 3000, lifetime_cents: 3000 },
    { currency: 'USD', balance_cents: 2000, claimed_cents: 0, lifetime_cents: 2000 },
  ]);
  assert.equal(me.body.commissions.find((c: any) => c.id === eur).payout_id, eurOut.body.id);
});

test('one currency keeps the old totals', async () => {
  const db = freshDb();
  accrue(db, [[1200, 'USD'], [800, 'USD']]);
  const me = await call(db, partner, '/commissions/me');
  assert.equal(me.body.mixed_currency, false);
  assert.equal(me.body.balance_cents, 2000);
  assert.equal(me.body.lifetime_cents, 2000);
  const ok = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 2000, payout_method: 'stripe' } });
  assert.equal(ok.body.currency, 'USD');
});

// --- Processor and dates ---------------------------------------------------------

test('the admin queue names the processor and lists what each payout claimed', async () => {
  const db = freshDb();
  const [a] = accrue(db, [[1000, 'USD']]);
  const req = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 1000, payout_method: 'wire' } });
  const queued = await call(db, admin, '/admin/payouts');
  assert.equal(queued.body[0].processed_by_name, null, 'nobody has moved it yet');
  const moved = await call(db, admin, `/admin/payouts/${req.body.id}/process`, { method: 'PATCH', body: { action: 'process' } });
  assert.equal(moved.status, 200);
  const after = await call(db, admin, '/admin/payouts');
  assert.equal(after.body[0].processed_by, ADMIN);
  assert.equal(after.body[0].processed_by_name, 'Ada Admin');
  assert.ok(after.body[0].processed_at);
  assert.deepEqual(after.body[0].commission_ids, [a]);
  assert.equal((await call(db, admin, `/admin/payouts/${req.body.id}/process`, { method: 'PATCH', body: { action: 'process' } })).status, 409,
    'a payout already in processing is not processed again');
});

// --- Sign-ups ---------------------------------------------------------------------

test('the sign-up list returns each sign-up\'s role', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO referrals (referrer_id, referred_id, referral_code, status) VALUES (?, ?, 'ABC123', 'pending')`).run(PARTNER, REFERRED);
  const list = await call(db, partner, '/referral/list');
  assert.equal(list.status, 200);
  assert.equal(list.body[0].referred_role, 'investor');
});

// --- Commission rules --------------------------------------------------------------

test('an admin edits a commission rule, and the edit is logged with the actor', async () => {
  const db = freshDb();
  await call(db, admin, '/admin/commission-rules'); // seeds the rules
  const denied = await call(db, partner, '/admin/commission-rules/referral_kyc_approved', { method: 'PATCH', body: { amount_cents: 1 } });
  assert.equal(denied.status, 403);

  const edited = await call(db, admin, '/admin/commission-rules/referral_kyc_approved', { method: 'PATCH', body: { amount_cents: 7500, description: 'KYC bonus', active: false } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.amount_cents, 7500);
  assert.equal(edited.body.active, 0);
  assert.equal(edited.body.updated_by, ADMIN);
  assert.equal(edited.body.updated_by_name, 'Ada Admin');
  assert.ok(edited.body.updated_at);

  const audit: any = db.prepare(`SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action = 'commission_rule.updated'`).get();
  assert.equal(audit.admin_user_id, ADMIN);
  const details = JSON.parse(audit.filters_json);
  assert.equal(details.before.amount_cents, 5000);
  assert.equal(details.after.amount_cents, 7500);
  assert.equal(details.after.active, 0);

  const both = await call(db, admin, '/admin/commission-rules/referral_kyc_approved', { method: 'PATCH', body: { percentage_bps: 100 } });
  assert.equal(both.status, 400);
  assert.equal(both.body.error, 'rule_amount_ambiguous', 'a rule pays a flat amount or a share, never both');
  const swap = await call(db, admin, '/admin/commission-rules/referral_kyc_approved', { method: 'PATCH', body: { percentage_bps: 100, amount_cents: null } });
  assert.equal(swap.status, 200);
  assert.equal((await call(db, admin, '/admin/commission-rules/referral_kyc_approved', { method: 'PATCH', body: { percentage_bps: 10001 } })).body.error, 'invalid_share');
  assert.equal((await call(db, admin, '/admin/commission-rules/referral_kyc_approved', { method: 'PATCH', body: { amount_cents: 12.5, percentage_bps: null } })).body.error, 'invalid_amount');
  assert.equal((await call(db, admin, '/admin/commission-rules/nope', { method: 'PATCH', body: { active: true } })).status, 404);
});

// --- Interaction outcome ------------------------------------------------------------

test('an interaction carries an optional outcome', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type) VALUES (?, ?, 'co_investor')`).run(PARTNER, OTHER);
  const pnet = { app: PNET };
  const logged = await call(db, partner, '/relationships/1/interactions', { method: 'POST', body: { note: 'Intro call', outcome: 'Agreed to a second meeting' } }, pnet);
  assert.equal(logged.status, 201, JSON.stringify(logged.body));
  assert.equal(logged.body.item.outcome, 'Agreed to a second meeting');
  const plain = await call(db, partner, '/relationships/1/interactions', { method: 'POST', body: { note: 'Follow-up' } }, pnet);
  assert.equal(plain.body.item.outcome, null, 'no outcome given reads as none, not an empty string');
  const long = await call(db, partner, '/relationships/1/interactions', { method: 'POST', body: { note: 'x', outcome: 'y'.repeat(201) } }, pnet);
  assert.equal(long.status, 400);
  assert.equal(long.body.error, 'outcome_too_long');
  const typed = await call(db, partner, '/relationships/1/interactions', { method: 'POST', body: { note: 'x', outcome: 3 } }, pnet);
  assert.equal(typed.body.error, 'invalid_outcome');
  const log = await call(db, partner, '/relationships/1/interactions', {}, pnet);
  assert.equal(log.body.items.find((i: any) => i.note === 'Intro call').outcome, 'Agreed to a second meeting');
});

// --- Part 2: the Super Admin gate ------------------------------------------------

test('every global commission and payout route is the Super Admin\'s; a plain admin gets 403', async () => {
  const db = freshDb();
  accrue(db, [[1000, 'USD']]);
  const req = await call(db, partner, '/payout/request', { method: 'POST', body: { amount_cents: 1000, payout_method: 'wire' } });
  const routes: Array<[string, { method?: string; body?: any }]> = [
    ['/admin/commissions', {}],
    ['/admin/commission-rules', {}],
    ['/admin/payouts', {}],
    [`/admin/payouts/${req.body.id}/process`, { method: 'PATCH', body: { action: 'process' } }],
    ['/admin/commission-rules/referral_kyc_approved', { method: 'PATCH', body: { active: false } }],
  ];
  for (const [path, init] of routes) {
    assert.equal((await call(db, plainAdmin, path, init)).status, 403, `a plain admin reached ${init.method || 'GET'} ${path}`);
  }
  assert.equal((db.prepare('SELECT status FROM payouts WHERE id = ?').get(req.body.id) as any).status, 'requested', 'a refused admin moved nothing');
  for (const [path, init] of routes) {
    assert.equal((await call(db, admin, path, init)).status, 200, `the Super Admin was refused ${init.method || 'GET'} ${path}`);
  }
});
