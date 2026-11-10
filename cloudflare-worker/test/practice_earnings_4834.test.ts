/**
 * #4834 (D4834) — the Practice v2 Earnings ledger (PX-07).
 *
 * Runs the MOUNTED advisors router against real SQLite with the money
 * migrations read from their files. Under test:
 *
 *   · `lines`: one record per booking in the window, each with its OWN stored
 *     rate and fee (a later rate change and a billing-state change move
 *     neither), collected only when collected, and an unpriced line with no
 *     figure invented for it;
 *   · a line priced before rates were stamped carries no rate, and is counted
 *     (`unfrozen`) rather than given today's;
 *   · `paid_out_count`, so a "Paid out" figure is drawn only over paid rows;
 *   · the population is the caller's own window, never another advisor's;
 *   · a calendar month is a storable note key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const JWT_SECRET = 'test-secret-for-practice-earnings-4834';

const ADVISOR_USER = 90;
const OTHER_ADVISOR_USER = 91;
const CLIENT_A = 92;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER, stripe_customer_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE advisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER UNIQUE,
      display_name TEXT NOT NULL, email TEXT, bio TEXT,
      expertise_json TEXT NOT NULL DEFAULT '[]', sectors_json TEXT NOT NULL DEFAULT '[]',
      linkedin_url TEXT, hourly_rate_usd INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, slot_id INTEGER, founder_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', topic TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, meeting_url TEXT, notes TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN amount_cents INTEGER;`);
  db.exec(`ALTER TABLE advisor_bookings ADD COLUMN billing_state TEXT NOT NULL DEFAULT 'unpriced';`);
  db.exec(migration('241_advisor_money_model'));
  db.exec(migration('242_advisor_quarter_notes'));
  db.exec(migration('202611070915_advisory_refunds_due'));
  db.exec(`CREATE TABLE IF NOT EXISTS advisor_engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
    advisor_id INTEGER NOT NULL, founder_user_id INTEGER, client_name TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT 'signed', shape TEXT NOT NULL DEFAULT 'retainer',
    amount_cents INTEGER);`);

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(CLIENT_A, 'founder', null, 'Meridian Labs', 'm@example.com');
  const a = db.prepare('INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)');
  a.run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  a.run(2, 'adv-2', OTHER_ADVISOR_USER, 'Grace', 'grace@example.com');
  return db;
}

function booking(db: InstanceType<typeof DatabaseSync>, uid: string, advisorId: number, opts: {
  createdAt?: string; status?: string; slotStarts?: string;
} = {}): number {
  let slotId: number | null = null;
  if (opts.slotStarts) {
    slotId = Number(db.prepare(
      'INSERT INTO advisor_office_hour_slots (uid, advisor_id, starts_at, ends_at) VALUES (?,?,?,?)',
    ).run(`s-${uid}`, advisorId, opts.slotStarts, opts.slotStarts).lastInsertRowid);
  }
  const r = db.prepare(
    `INSERT INTO advisor_bookings (uid, advisor_id, slot_id, founder_user_id, status, topic, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uid, advisorId, slotId, CLIENT_A, opts.status ?? 'completed', `Topic ${uid}`,
    opts.createdAt ?? '2026-11-03T10:00:00.000Z');
  return Number(r.lastInsertRowid);
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(e: any, method: string, path: string, who: { user: number; role: string }, body?: any) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await advisors.request(path, init, e, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };
const grace = { user: OTHER_ADVISOR_USER, role: 'advisor' };
const NOV = '/me/ledger?from=2026-11-01T00:00:00.000Z&until=2026-12-01T00:00:00.000Z';
const setRate = (db: any, bps: string) =>
  db.prepare('UPDATE platform_settings SET value = ? WHERE key = ?').run(bps, 'advisor_take_rate_bps');
const price = (db: any, id: number, over: Record<string, any> = {}) =>
  call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000, ...over });

test('each line carries its own stored rate and fee; a later rate and a billing change move neither', async () => {
  const db = freshDb();
  const id = booking(db, 'b1', 1, { slotStarts: '2026-11-04T14:00:00.000Z' });
  assert.equal((await price(db, id)).status, 200);
  setRate(db, '1200');
  assert.equal((await call(env(db), 'PATCH', `/me/bookings/${id}/billing`, ada, { billing_state: 'collected' })).status, 200);

  const r = await call(env(db), 'GET', NOV, ada);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const L = r.body.lines;
  assert.equal(L.read, true);
  assert.equal(L.listed, 1);
  assert.equal(L.complete, true);
  const [line] = L.items;
  assert.equal(line.amount_cents, 30_000);
  assert.equal(line.billing_state, 'collected');
  assert.equal(line.collected_cents, 30_000, 'a collected line records its whole price as collected');
  assert.equal(line.take_rate_bps, 1500, 'the rate fixed when it was priced, not today’s 12%');
  assert.equal(line.platform_fee_cents, 4_500);
  assert.equal(line.net_cents, 25_500);
  assert.equal(line.session_at, '2026-11-04T14:00:00.000Z');
  assert.equal(line.client_name, 'Meridian Labs');
  assert.equal(L.unfrozen, 0);
});

test('an unpriced line and a billed line carry no invented figure', async () => {
  const db = freshDb();
  booking(db, 'unpriced', 1, { createdAt: '2026-11-02T10:00:00.000Z' });
  const billed = booking(db, 'billed', 1, { createdAt: '2026-11-03T10:00:00.000Z' });
  await price(db, billed);
  const { body } = await call(env(db), 'GET', NOV, ada);
  const byTopic = Object.fromEntries(body.lines.items.map((l: any) => [l.topic, l]));
  const u = byTopic['Topic unpriced'];
  assert.equal(u.billing_state, 'unpriced');
  for (const k of ['amount_cents', 'collected_cents', 'take_rate_bps', 'platform_fee_cents', 'net_cents']) {
    assert.equal(u[k], null, `unpriced ${k} is absent, not 0`);
  }
  const b = byTopic['Topic billed'];
  assert.equal(b.billing_state, 'billed');
  assert.equal(b.collected_cents, null, 'billed is not collected');
  assert.equal(b.platform_fee_cents, 4_500);
  // Newest first.
  assert.deepEqual(body.lines.items.map((l: any) => l.topic), ['Topic billed', 'Topic unpriced']);
});

test('a line priced before rates were stamped has no rate of its own and is counted, not given today’s', async () => {
  const db = freshDb();
  const id = booking(db, 'legacy', 1);
  db.prepare("UPDATE advisor_bookings SET amount_cents = 20000, billing_state = 'billed', take_rate_bps = NULL, platform_cut_cents = NULL WHERE id = ?").run(id);
  const { body } = await call(env(db), 'GET', NOV, ada);
  const [line] = body.lines.items;
  assert.equal(line.amount_cents, 20_000);
  assert.equal(line.take_rate_bps, null);
  assert.equal(line.platform_fee_cents, null);
  assert.equal(line.net_cents, null, 'no net without a recorded fee');
  assert.equal(body.lines.unfrozen, 1);
});

test('the lines are the caller’s own window: other periods, other advisors and uncollected cancellations stay out', async () => {
  const db = freshDb();
  booking(db, 'mine', 1);
  booking(db, 'october', 1, { createdAt: '2026-10-30T10:00:00.000Z' });
  booking(db, 'cancelled', 1, { status: 'cancelled' });
  booking(db, 'grace', 2);
  const { body } = await call(env(db), 'GET', NOV, ada);
  assert.deepEqual(body.lines.items.map((l: any) => l.topic), ['Topic mine']);
  assert.equal(body.lines.total, body.totals.sessions, 'the list and the totals count one population');
  const g = await call(env(db), 'GET', NOV, grace);
  assert.deepEqual(g.body.lines.items.map((l: any) => l.topic), ['Topic grace']);
});

test('paid_out_count counts paid payouts in the window only; none recorded is 0, not a card', async () => {
  const db = freshDb();
  let r = await call(env(db), 'GET', NOV, ada);
  assert.equal(r.body.states.paid_out_count, 0);
  const p = db.prepare('INSERT INTO advisor_payouts (uid, advisor_id, amount_cents, state, scheduled_for, paid_at) VALUES (?,?,?,?,?,?)');
  p.run('p1', 1, 243_000, 'paid', null, '2026-11-01T09:00:00.000Z');
  p.run('p2', 1, 100_000, 'scheduled', '2026-12-01', null);
  p.run('p3', 2, 999_000, 'paid', null, '2026-11-02T09:00:00.000Z');
  r = await call(env(db), 'GET', NOV, ada);
  assert.equal(r.body.states.paid_out_count, 1, 'scheduled and another advisor’s payouts are not counted');
  assert.equal(r.body.states.paid_out_cents, 243_000);
});

test('a capped record list sums the rest in one row, so the records add to the totals', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO advisor_bookings (uid, advisor_id, founder_user_id, status, topic, created_at, amount_cents, billing_state, take_rate_bps, platform_cut_cents)
     VALUES (?, 1, ?, 'completed', ?, ?, 1000, 'billed', 1000, 100)`);
  for (let i = 0; i < 203; i += 1) {
    ins.run(`b${i}`, CLIENT_A, `T${i}`, `2026-11-0${1 + (i % 9)}T10:${String(i % 60).padStart(2, '0')}:00.000Z`);
  }
  const { body } = await call(env(db), 'GET', NOV, ada);
  const L = body.lines;
  assert.equal(L.listed, 200);
  assert.equal(L.total, 203);
  assert.equal(L.complete, false);
  assert.deepEqual(L.other, { records: 3, gross_cents: 3000, fee_cents: 300, net_cents: 2700 });
  const listedGross = L.items.reduce((a: number, l: any) => a + l.amount_cents, 0);
  assert.equal(listedGross + L.other.gross_cents, body.totals.gross_cents);
  const complete = await call(env(freshDb()), 'GET', NOV, ada);
  assert.equal(complete.body.lines.other, null, 'a complete list has no summed row');
});

test('a calendar month is a note key; a month that does not exist is not', async () => {
  const db = freshDb();
  const ok = await call(env(db), 'PUT', '/me/period-notes/2026-11', ada, { body: 'Chase Northstar on 18 Nov.', period_key: '2026-11' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const back = await call(env(db), 'GET', '/me/period-notes/2026-11', ada);
  assert.equal(back.body.note.body, 'Chase Northstar on 18 Nov.');
  for (const bad of ['2026-13', '2026-00', '2026-1', '2026-11-03']) {
    const w = await call(env(db), 'PUT', `/me/period-notes/${bad}`, ada, { body: 'x' });
    assert.equal(w.status, 400, `PUT ${bad} → ${w.status}`);
  }
});
