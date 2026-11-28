/**
 * D9188 (#9188) — investor seat invites and revocations hold the seat cap and
 * the stored count under concurrency, and a revoked address can be invited
 * again.
 *
 * The requests are fired together with Promise.all, and every D1 call yields
 * to the event loop first, as a D1 round trip does, so the requests' reads and
 * writes really interleave (without the yield each request ran to completion
 * before the next one started, and the pre-#9188 code passed). A batch still
 * runs as one transaction, as D1 does, so what keeps the cap and the count is
 * the condition inside each statement, never the order the requests' JS ran in.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/investor_seats_concurrency_9188.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import seats from '../src/routes/investor_seats.ts';
import { INVESTOR_QUOTAS } from '../src/middleware/requireInvestorTier.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const CAP = INVESTOR_QUOTAS.institutional.seats;

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    investor_tier TEXT NOT NULL DEFAULT 'free',
    investor_subscription_status TEXT NOT NULL DEFAULT 'free',
    investor_seat_count INTEGER NOT NULL DEFAULT 0,
    investor_seat_primary_user_id INTEGER
  );`);
  db.prepare(`INSERT INTO users (id, email, name, role, investor_tier, investor_subscription_status) VALUES (1, 'owner@firm.test', 'Owner', 'investor', 'institutional', 'active')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (4, 'seat@firm.test', 'Seat', 'investor')`).run();
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, details TEXT, actor TEXT);`);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/investor-seats', seats as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The real-SQL shim, with a turn of the event loop before every call. */
function yieldingD1(db: DatabaseSync) {
  const d1: any = d1Over(db);
  return {
    ...d1,
    prepare(sql: string) {
      const st = d1.prepare(sql);
      const w: any = {
        bind(...a: unknown[]) { st.bind(...a); return w; },
        all: async () => { await tick(); return st.all(); },
        first: async (col?: string) => { await tick(); return st.first(col); },
        run: async () => { await tick(); return st.run(); },
        runSync: () => st.runSync(),
      };
      return w;
    },
    batch: async (list: unknown[]) => { await tick(); return d1.batch(list); },
  };
}

// Signed once per user, so a Promise.all of calls starts every request at once.
const tokens = new Map<string, Promise<string>>();
function tokenFor(db: DatabaseSync, as: number) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(as) as { role: string }).role;
  const key = `${as}:${role}`;
  if (!tokens.has(key)) {
    tokens.set(key, new SignJWT({ user_id: as, role }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET)));
  }
  return tokens.get(key)!;
}

async function call(db: DatabaseSync, method: string, path: string, as: number, body?: unknown) {
  const tok = await tokenFor(db, as);
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: yieldingD1(db), APP_URL: 'https://axal.vc' } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

const activeRows = (db: DatabaseSync) =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM investor_seats WHERE primary_user_id = 1 AND revoked_at IS NULL').get() as { n: number }).n);
const storedCount = (db: DatabaseSync) =>
  Number((db.prepare('SELECT investor_seat_count AS n FROM users WHERE id = 1').get() as { n: number }).n);
const revokeLogs = (db: DatabaseSync) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'investor_seat_revoked'`).get() as { n: number }).n;
const tokenOf = (link: string) => new URL(link).searchParams.get('token') as string;

test('D9188: parallel invites from an account with no seats stop at the plan cap', async () => {
  assert.equal(CAP, 4);
  const db = freshDb();
  const replies = await Promise.all(
    Array.from({ length: 8 }, (_, i) => call(db, 'POST', '/investor-seats/invite', 1, { email: `colleague${i}@firm.test` })),
  );
  const ok = replies.filter((r) => r.status === 200);
  const refused = replies.filter((r) => r.status !== 200);
  assert.equal(ok.length, CAP, JSON.stringify(replies.map((r) => [r.status, r.body?.error])));
  assert.equal(refused.length, 8 - CAP);
  for (const r of refused) {
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'seat_cap_exceeded');
    assert.equal(r.body.cap, CAP);
    assert.equal(r.body.used, CAP);
  }
  assert.equal(activeRows(db), CAP);
  assert.equal(storedCount(db), CAP);
});

test('D9188: parallel revokes of one seat lower the stored count by exactly one', async () => {
  const db = freshDb();
  for (let i = 0; i < 3; i++) {
    assert.equal((await call(db, 'POST', '/investor-seats/invite', 1, { email: `colleague${i}@firm.test` })).status, 200);
  }
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(invited.status, 200);
  const accepted = await call(db, 'POST', '/investor-seats/accept', 4, { token: tokenOf(invited.body.invite_link) });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(storedCount(db), 4);
  assert.equal(activeRows(db), 4);

  const replies = await Promise.all(
    Array.from({ length: 5 }, () => call(db, 'DELETE', `/investor-seats/${invited.body.id}`, 1)),
  );
  for (const r of replies) assert.equal(r.status, 200, JSON.stringify(r.body));
  // Exactly one request revoked the seat; every other one found it revoked.
  assert.equal(replies.filter((r) => r.body.already_revoked !== true).length, 1);
  assert.equal(revokeLogs(db), 1);
  assert.equal(activeRows(db), 3);
  assert.equal(storedCount(db), 3);
  const seatUser = db.prepare('SELECT investor_tier, investor_seat_primary_user_id FROM users WHERE id = 4').get() as any;
  assert.equal(seatUser.investor_tier, 'free');
  assert.equal(seatUser.investor_seat_primary_user_id, null);
});

test('D9188: invite, revoke, invite the same address answers 200 with a fresh token and one active seat', async () => {
  const db = freshDb();
  const first = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(first.status, 200);
  assert.equal((await call(db, 'DELETE', `/investor-seats/${first.body.id}`, 1)).status, 200);
  assert.equal(activeRows(db), 0);
  assert.equal(storedCount(db), 0);

  const again = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.notEqual(tokenOf(again.body.invite_link), tokenOf(first.body.invite_link));
  const rows = db.prepare(`SELECT revoked_at, accepted_at, invite_token FROM investor_seats WHERE primary_user_id = 1 AND seat_email = 'seat@firm.test'`).all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revoked_at, null);
  assert.equal(rows[0].invite_token, tokenOf(again.body.invite_link));
  assert.equal(activeRows(db), 1);
  assert.equal(storedCount(db), 1);

  // The fresh link works; the old one no longer does.
  assert.equal((await call(db, 'POST', '/investor-seats/accept', 4, { token: tokenOf(first.body.invite_link) })).status, 404);
  assert.equal((await call(db, 'POST', '/investor-seats/accept', 4, { token: tokenOf(again.body.invite_link) })).status, 200);

  // An address that already holds an active seat is told so, not "cap exceeded".
  const dup = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'already_invited');
  assert.equal(activeRows(db), 1);
});

test('D9188: re-inviting a revoked address at the cap is refused and changes nothing', async () => {
  const db = freshDb();
  const revokedOne = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal((await call(db, 'DELETE', `/investor-seats/${revokedOne.body.id}`, 1)).status, 200);
  for (let i = 0; i < CAP; i++) {
    assert.equal((await call(db, 'POST', '/investor-seats/invite', 1, { email: `colleague${i}@firm.test` })).status, 200);
  }
  const reinvite = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(reinvite.status, 409);
  assert.equal(reinvite.body.error, 'seat_cap_exceeded');
  const row = db.prepare(`SELECT revoked_at FROM investor_seats WHERE seat_email = 'seat@firm.test'`).get() as any;
  assert.ok(row.revoked_at);
  assert.equal(activeRows(db), CAP);
  assert.equal(storedCount(db), CAP);
});
