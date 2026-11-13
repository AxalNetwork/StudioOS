/**
 * D572 part 3b (#1183, migration 409) — where a payout is sent (the owner's
 * Q1 = A: a label and the last 4 characters), and the partner leaderboard by
 * metric and period, with the change against a stored earlier standing.
 *
 * Real SQLite: the baseline tables, 393 and 409, and the routes themselves.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/partner_earnings_3b_d572.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import network, { readPayoutDestination } from '../src/routes/network.ts';
import partnernet from '../src/routes/partnernet.ts';
import {
  CHANGE_DAYS, BOARD_LIMIT, changeOf, comparisonFor, dateKey, liveRanking, quarterOf, rankRows, writeLeaderboardSnapshots,
} from '../src/services/partnerLeaderboard.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const MIG = (name: string) => readFileSync(resolve(SQL, 'migrations', name), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const PARTNER = 20;
const DAY = 86_400_000;

function freshDb(opts: { m409?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'activity_logs', 'referrals', 'commissions', 'payouts', 'commission_rules', 'super_admins', 'user_settings', 'partner_relationships']) db.exec(ddl(t));
  db.exec(MIG('338_partner_interactions_reminders.sql'));
  db.exec(MIG('343_partner_interaction_void.sql'));
  db.exec(MIG('368_relationship_requests.sql'));
  db.exec(MIG('393_partner_earnings.sql'));
  // D713: payout GETs read stored bank evidence after migration 477.
  for (const migration of ['311_revenue_entries.sql', '400_revenue_stripe_charge_index.sql', '477_mercury_personal.sql']) db.exec(MIG(migration));
  if (opts.m409 !== false) exec(db, MIG('409_payout_destination_and_leaderboard.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, network_score) VALUES (?, ?, ?, ?, ?)');
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', 40);
  u.run(21, 'founder', 'Fay Founder', 'fay@example.test', 70);
  u.run(22, 'investor', 'Ivo Investor', 'ivo@example.test', 40);
  u.run(23, 'partner', 'Hid Hidden', 'hid@example.test', 90);
  u.run(24, 'partner', 'Zed Zero', 'zed@example.test', 0);
  db.prepare('INSERT INTO user_settings (user_id, show_in_directory) VALUES (23, 0)').run();
  return db;
}

async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
function appFor(router: any) {
  const app = new Hono<any>();
  app.route('/', router);
  return app;
}
const NET = appFor(network);
const PNET = appFor(partnernet);
async function call(db: InstanceType<typeof DatabaseSync>, app: any, user: number, path: string, body?: unknown) {
  const res = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await token(user, 'partner')}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

// ─────────────────────────────────────────────────────── the destination ──

test('the destination rule: both or neither, a short plain label, exactly 4 letters or digits', () => {
  assert.deepEqual(readPayoutDestination(undefined, undefined), { label: null, last4: null });
  assert.deepEqual(readPayoutDestination('  ', ''), { label: null, last4: null });
  assert.deepEqual(readPayoutDestination(' Main account ', 'ab12'), { label: 'Main account', last4: 'AB12' });
  const code = (l: unknown, f: unknown) => (readPayoutDestination(l, f) as any).error?.code;
  assert.equal(code('Main account', ''), 'destination_incomplete');
  assert.equal(code('', '1234'), 'destination_incomplete');
  assert.equal(code('x'.repeat(61), '1234'), 'invalid_destination_label');
  assert.deepEqual(readPayoutDestination('x'.repeat(60), '1234'), { label: 'x'.repeat(60), last4: '1234' });
  assert.equal(code('Main\u0007account', '1234'), 'invalid_destination_label');
  for (const bad of ['123', '12345', '12-4', 'DE89 3704 0044 0532 0130 00', '12 4']) assert.equal(code('Main', bad), 'invalid_destination_last4', bad);
});

test('a payout request stores the label and last 4, and nothing more; both lists return them', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status) VALUES (?, 5000, 'USD', 'test', 's1', 'accrued')`).run(PARTNER);
  const r = await call(db, NET, PARTNER, '/payout/request', {
    amount_cents: 5000, payout_method: 'wire', destination_label: 'Main business account', destination_last4: '4821',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.destination_label, 'Main business account');
  assert.equal(r.body.destination_last4, '4821');
  const row = db.prepare('SELECT destination_label, destination_last4, payout_details FROM payouts').get() as any;
  assert.deepEqual({ ...row }, { destination_label: 'Main business account', destination_last4: '4821', payout_details: null });
  const mine = await call(db, NET, PARTNER, '/payouts/me');
  assert.equal(mine.body[0].destination_last4, '4821');
});

test('a bad destination is refused before anything is claimed; none at all is still allowed', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status) VALUES (?, 5000, 'USD', 'test', 's1', 'accrued')`).run(PARTNER);
  const bad = await call(db, NET, PARTNER, '/payout/request', { amount_cents: 5000, payout_method: 'wire', destination_label: 'Main', destination_last4: '12345' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_destination_last4');
  assert.equal((db.prepare(`SELECT status FROM commissions`).get() as any).status, 'accrued', 'a refused request claimed a commission');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payouts').get() as any).n, 0);
  const none = await call(db, NET, PARTNER, '/payout/request', { amount_cents: 5000, payout_method: 'wire' });
  assert.equal(none.status, 200);
  assert.equal(none.body.destination_label, null);
});

// ─────────────────────────────────────────────────────── the leaderboard ──

test('ranking: values above zero, highest first, equal values share a rank and the next skips', () => {
  const ranked = rankRows([
    { user_id: 5, role: 'a', value: 3 }, { user_id: 2, role: 'b', value: 9 }, { user_id: 7, role: 'c', value: 3 },
    { user_id: 1, role: 'd', value: 1 }, { user_id: 9, role: 'e', value: 0 },
  ]);
  assert.deepEqual(ranked.map((r) => [r.user_id, r.rank]), [[2, 1], [5, 2], [7, 2], [1, 4]]);
});

test('the score board: the stored score, hidden members left out, no id or name sent', async () => {
  const db = freshDb();
  const { status, body } = await call(db, PNET, PARTNER, '/leaderboard/board?metric=score&period=all');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.rows.map((r: any) => [r.rank, r.role, r.value, r.is_viewer]),
    [[1, 'founder', 70, false], [2, 'partner', 40, true], [2, 'investor', 40, false]]);
  assert.equal(body.total_ranked, 3, 'the hidden member and the zero are not ranked');
  assert.deepEqual(body.viewer, { ranked: true, rank: 2, role: 'partner', value: 40, change: null, is_viewer: true });
  assert.doesNotMatch(JSON.stringify(body), /Pat|Fay|Ivo|Hid|example\.test|"user_id"|"id"/, 'a member was identified');
  assert.equal(body.compare.available, false);
  assert.match(body.compare.reason, /No standing from at least 7 days ago/);
});

test('referrals and commissions are counts, by period; reversed commissions are not counted', async () => {
  const db = freshDb();
  const now = Date.now();
  const q = quarterOf(now);
  const inQ = new Date(q.startMs + 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  const beforeQ = new Date(q.startMs - 5 * DAY).toISOString().replace('T', ' ').slice(0, 19);
  const ref = db.prepare(`INSERT INTO referrals (referrer_id, referred_id, referral_code, created_at) VALUES (?, ?, 'x', ?)`);
  ref.run(PARTNER, 100, inQ); ref.run(PARTNER, 101, beforeQ); ref.run(21, 102, inQ); ref.run(21, 103, inQ);
  const com = db.prepare(`INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status, created_at) VALUES (?, ?, ?, 't', ?, ?, ?)`);
  com.run(PARTNER, 999999, 'USD', 'c1', 'paid', inQ);
  com.run(PARTNER, 10, 'EUR', 'c2', 'accrued', inQ);
  com.run(21, 50, 'USD', 'c3', 'reversed', inQ);
  com.run(21, 50, 'USD', 'c4', 'accrued', beforeQ);

  const allRefs = await call(db, PNET, PARTNER, '/leaderboard/board?metric=referrals&period=all');
  assert.deepEqual(allRefs.body.rows.map((r: any) => [r.role, r.value, r.rank]), [['partner', 2, 1], ['founder', 2, 1]]);
  const qRefs = await call(db, PNET, PARTNER, '/leaderboard/board?metric=referrals&period=quarter');
  assert.equal(qRefs.body.period_key, q.key);
  assert.deepEqual(qRefs.body.rows.map((r: any) => [r.role, r.value]), [['founder', 2], ['partner', 1]]);

  const allCom = await call(db, PNET, PARTNER, '/leaderboard/board?metric=commissions&period=all');
  assert.deepEqual(allCom.body.rows.map((r: any) => [r.role, r.value]), [['partner', 2], ['founder', 1]],
    'a count, whatever the amounts and currencies, and the reversed one is left out');
  assert.doesNotMatch(JSON.stringify(allCom.body), /999999/, 'an amount reached the board');
  const qCom = await call(db, PNET, PARTNER, '/leaderboard/board?metric=commissions&period=quarter');
  assert.deepEqual(qCom.body.rows.map((r: any) => [r.role, r.value]), [['partner', 2]]);
});

test('bad metric or period is refused, and the score has no quarter', async () => {
  const db = freshDb();
  assert.equal((await call(db, PNET, PARTNER, '/leaderboard/board?metric=introductions')).body.error, 'bad_metric');
  assert.equal((await call(db, PNET, PARTNER, '/leaderboard/board?metric=score&period=year')).body.error, 'bad_period');
  const q = await call(db, PNET, PARTNER, '/leaderboard/board?metric=score&period=quarter');
  assert.equal(q.status, 400);
  assert.equal(q.body.error, 'period_not_for_metric');
});

test('a viewer not on the board is told why: nothing counted, or hidden from the directory', async () => {
  const db = freshDb();
  const zero = await call(db, PNET, 24, '/leaderboard/board?metric=score&period=all');
  assert.equal(zero.body.viewer.ranked, false);
  assert.match(zero.body.viewer.reason, /nothing counted/);
  const hidden = await call(db, PNET, 23, '/leaderboard/board?metric=score&period=all');
  assert.equal(hidden.body.viewer.ranked, false);
  assert.match(hidden.body.viewer.reason, /chose not to appear in the directory/);
});

test('snapshots are written once a day for every board, and the change reads a standing at least a week old', async () => {
  const db = freshDb();
  const now = Date.now();
  const old = now - (CHANGE_DAYS + 1) * DAY;
  const first = await writeLeaderboardSnapshots({ DB: d1Over(db) } as any, old);
  assert.deepEqual(first.failed, []);
  assert.equal(first.written, 3, 'the score board: three members ranked');
  assert.equal((await writeLeaderboardSnapshots({ DB: d1Over(db) } as any, old)).written, 0, 'the same day twice writes nothing');
  // Since then: the investor overtakes, and a new member arrives.
  db.prepare('UPDATE users SET network_score = 80 WHERE id = 22').run();
  db.prepare(`INSERT INTO users (id, role, name, email, network_score) VALUES (25, 'advisor', 'New', 'new@example.test', 10)`).run();
  // A newer snapshot inside the week is not the one compared with.
  await writeLeaderboardSnapshots({ DB: d1Over(db) } as any, now - DAY);
  const { body } = await call(db, PNET, PARTNER, '/leaderboard/board?metric=score&period=all');
  assert.deepEqual(body.compare, { available: true, date: dateKey(old), days: CHANGE_DAYS });
  assert.deepEqual(body.rows.map((r: any) => [r.role, r.rank, r.change]),
    [['investor', 1, 1], ['founder', 2, -1], ['partner', 3, -1], ['advisor', 4, 'new']]);
});

test('a quarter compares only within itself, and an unreadable store says so', async () => {
  const db = freshDb();
  const now = Date.now();
  const lastQuarter = quarterOf(now).startMs - 3 * DAY;
  db.prepare(`INSERT INTO referrals (referrer_id, referred_id, referral_code, created_at) VALUES (?, 300, 'x', ?)`)
    .run(PARTNER, new Date(lastQuarter).toISOString().replace('T', ' ').slice(0, 19));
  await writeLeaderboardSnapshots({ DB: d1Over(db) } as any, lastQuarter);
  const cmp = await comparisonFor({ DB: d1Over(db) } as any, 'referrals', 'quarter', now);
  assert.equal(cmp.available, false, 'last quarter\'s standing was compared with this one');
  assert.match((cmp as any).reason, /compares only within the quarter/);
  const all = await comparisonFor({ DB: d1Over(db) } as any, 'referrals', 'all', now);
  assert.equal(all.available, true);
  assert.equal(changeOf(PARTNER, 1, all), 0);
  const bare = freshDb({ m409: false });
  const unread = await comparisonFor({ DB: d1Over(bare) } as any, 'score', 'all', now);
  assert.equal((unread as any).unreadable, true);
  assert.match((unread as any).reason, /migration 409/);
  const board = await call(bare, PNET, PARTNER, '/leaderboard/board?metric=score&period=all');
  assert.equal(board.status, 200, 'the board still reads without its history');
  assert.equal(board.body.compare.unreadable, true);
  assert.equal(board.body.rows[0].change, null);
});

test('the board lists at most 25, and the viewer\'s own standing wherever it falls', async () => {
  const db = freshDb();
  const u = db.prepare(`INSERT INTO users (id, role, name, email, network_score) VALUES (?, 'partner', 'n', ?, ?)`);
  for (let i = 0; i < 30; i++) u.run(1000 + i, `p${i}@example.test`, 500 - i);
  const { body } = await call(db, PNET, PARTNER, '/leaderboard/board?metric=score&period=all');
  assert.equal(body.rows.length, BOARD_LIMIT);
  assert.equal(body.total_ranked, 33);
  assert.equal(body.viewer.rank, 32, 'the viewer is ranked outside the listed 25');
  assert.ok(!body.rows.some((r: any) => r.is_viewer));
  const live = await liveRanking({ DB: d1Over(db) } as any, 'score', 'all', Date.now());
  assert.equal(live.length, 33);
});
