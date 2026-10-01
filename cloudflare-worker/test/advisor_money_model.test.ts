/**
 * Migration 241 — the advisory take rate, the cut it stamps, the payout
 * account that gates charging, and the year totals.
 *
 * WHAT THESE TESTS ARE FOR. Five things here can be quietly wrong in ways no
 * rendering reveals, and each of them is money:
 *
 *   * THE CUT MUST RECONCILE. `gross − cut = net`, per line and in every
 *     total, in integer cents. A total computed as the rate applied to the
 *     gross total instead of as the sum of the line cuts differs by up to a
 *     cent per line — and a table whose rows do not add to its total is the
 *     most corrosive thing a ledger can do. D4 states the rule itself.
 *   * THE CUT MUST NEVER EXCEED THE STATED RATE. `floor`, not `round`: a
 *     rounded cut can come out at 15.0002% of a gross that divides badly, and
 *     a fee the terms do not describe is a fee somebody can dispute.
 *   * A PAST QUARTER MUST NOT MOVE WHEN AN OPERATOR CHANGES THE RATE. The rate
 *     is stamped per line precisely so the setting is safe to change, and an
 *     implementation that recomputed from the live setting would restate a
 *     reconciled quarter every time someone touched the admin form.
 *   * ABSENT IS NOT ZERO, AGAIN. A booking with no price has no cut, and a
 *     cut of NULL is "not computed" — rendering either as 0 asserts a free
 *     session (D56/D68).
 *   * NOTHING MAY CLAIM A CHARGE. Advisory settlement is off, every money
 *     response says so in `settlement`, and the flag that would turn it on is
 *     read through `util/paymentMode.ts` rather than a second, looser test.
 *
 * The database is REAL (`node:sqlite`, the dialect D1 speaks) and the schema
 * is the migration file read verbatim. If 241 stops parsing, these stop
 * running rather than passing against a stale hand-written copy.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_money_model.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import advisors from '../src/routes/advisors.ts';
import {
  DEFAULT_TAKE_RATE_BPS, MAX_TAKE_RATE_BPS, cutCents, derivePayoutState,
  settlementMode, splitLine, takeRate, totalLines,
} from '../src/services/advisorMoney.ts';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const JWT_SECRET = 'test-secret-for-advisor-money-model';

const ADVISOR_USER = 90;
const OTHER_ADVISOR_USER = 91;
const CLIENT_A = 92;
const CLIENT_B = 93;

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
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, advisor_id INTEGER,
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
    -- advisor_bookings as it really exists (sql/historical/t13_t14_t15.sql),
    -- plus 205's two columns, which is the shape 241 ALTERs.
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
  // 242 — the period note D4's AI band files on Accept. Same fixture,
  // because the note is keyed to the same windows the ledger answers for
  // and a test that could not read one could not check the other.
  db.exec(migration('242_advisor_quarter_notes'));
  db.exec(`CREATE TABLE IF NOT EXISTS advisor_engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
    advisor_id INTEGER NOT NULL, founder_user_id INTEGER, client_name TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT 'signed', shape TEXT NOT NULL DEFAULT 'retainer',
    amount_cents INTEGER);`);

  const u = db.prepare('INSERT INTO users (id, role, advisor_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADVISOR_USER, 'advisor', 1, 'Ada', 'ada@example.com');
  u.run(OTHER_ADVISOR_USER, 'advisor', 2, 'Grace', 'grace@example.com');
  u.run(CLIENT_A, 'founder', null, 'Meridian Labs', 'm@example.com');
  u.run(CLIENT_B, 'founder', null, 'Halverton', 'h@example.com');

  const a = db.prepare(
    'INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?,?,?,?,?)');
  a.run(1, 'adv-1', ADVISOR_USER, 'Ada', 'ada@example.com');
  a.run(2, 'adv-2', OTHER_ADVISOR_USER, 'Grace', 'grace@example.com');
  return db;
}

/** Insert a booking and return its id, so tests can price it through the route. */
function booking(
  db: InstanceType<typeof DatabaseSync>,
  uid: string, advisorId: number, clientId: number | null, createdAt?: string,
): number {
  const r = db.prepare(
    `INSERT INTO advisor_bookings (uid, advisor_id, founder_user_id, status, topic, created_at)
     VALUES (?, ?, ?, 'completed', ?, ?)`,
  ).run(uid, advisorId, clientId, uid, createdAt ?? '2026-08-01T10:00:00.000Z');
  return Number(r.lastInsertRowid);
}

function env(db: InstanceType<typeof DatabaseSync>, extra: Record<string, any> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...extra };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  // Hono's `c.executionCtx` getter THROWS when absent, so the stub is not
  // optional: without it a deferred-hook guard becomes a 500 in tests only.
  const res = await advisors.request(path, init, e, {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ada = { user: ADVISOR_USER, role: 'advisor' };
const grace = { user: OTHER_ADVISOR_USER, role: 'advisor' };

// ── The arithmetic, before any route touches it ────────────────────────────

test('the cut never exceeds the stated rate, at any gross and any rate', async () => {
  // THE FLOOR/ROUND DECISION, checked exhaustively rather than at a handful
  // of convenient values. `round` fails this: 33333 cents at 1500 bps rounds
  // to 5000, which is 15.0002% of gross.
  let violations = 0;
  let worstResidue = 0;
  for (let gross = 0; gross <= 500_00; gross += 13) {
    for (const bps of [0, 1, 250, 1200, 1500, 3333, 5000]) {
      const cut = cutCents(gross, bps)!;
      // Never above the stated rate: cut/gross <= bps/10000, cross-multiplied
      // so the comparison itself is exact integer arithmetic.
      if (cut * 10_000 > gross * bps) violations++;
      // And never more than a cent below it, or the rate would be fiction.
      const residue = gross * bps - cut * 10_000;
      if (residue >= 10_000) violations++;
      if (residue > worstResidue) worstResidue = residue;
    }
  }
  assert.equal(violations, 0);
  assert.ok(worstResidue < 10_000, `residue reached ${worstResidue}`);
  // The specific case `round` gets wrong, named so a future change to `round`
  // fails with an explanation rather than a count.
  assert.equal(cutCents(33_333, 1500), 4_999, 'floor, not round');
});

test('gross minus cut equals net, per line, with no residue', () => {
  for (const gross of [0, 1, 99, 100, 30_000, 33_333, 450_000]) {
    const s = splitLine(gross, 1500);
    assert.equal(s.gross_cents! - s.cut_cents! , s.net_cents!, `line ${gross}`);
    assert.equal(s.gross_cents, gross);
  }
});

test('an absent price has no cut and no net — never a zero', () => {
  assert.equal(cutCents(null, 1500), null);
  assert.equal(cutCents(undefined, 1500), null);
  assert.deepEqual(splitLine(null, 1500), { gross_cents: null, cut_cents: null, net_cents: null });
  // A price of ZERO is a real price and keeps a real (zero) cut, because an
  // advisor may genuinely mean free — 205's distinction, carried forward.
  assert.deepEqual(splitLine(0, 1500), { gross_cents: 0, cut_cents: 0, net_cents: 0 });
  // Nonsense is absent, not zero: a negative gross is a corrupt row, and
  // reporting a cut over it would launder the corruption into a figure.
  assert.equal(cutCents(-1, 1500), null);
  assert.equal(cutCents(Number.NaN, 1500), null);
});

test('a total is the sum of the line cuts, not the rate applied to the gross total', () => {
  // Three lines chosen so the two arithmetics genuinely differ: each loses a
  // fraction of a cent to floor, and the gross total does not.
  const lines = [{ amount_cents: 3_333 }, { amount_cents: 3_333 }, { amount_cents: 3_333 }];
  const t = totalLines(lines, 1500);
  assert.equal(t.gross_cents, 9_999);
  assert.equal(t.cut_cents, 499 * 3, 'each line floors to 499');
  assert.equal(t.net_cents, 9_999 - 1_497);
  // The wrong arithmetic, named, so the difference is on the record.
  assert.notEqual(t.cut_cents, Math.floor((9_999 * 1500) / 10_000));
  assert.equal(t.gross_cents - t.cut_cents, t.net_cents, 'the total still reconciles');
});

test('a line keeps the rate it was stamped with when the setting moves', () => {
  const lines = [
    { amount_cents: 30_000, take_rate_bps: 1500 },  // priced under the old rate
    { amount_cents: 30_000, take_rate_bps: null },  // recorded before 241
  ];
  // The operator has since dropped the rate to 12%.
  const t = totalLines(lines, 1200);
  assert.equal(t.cut_cents, 4_500 + 3_600,
    'the stamped line stays at 15%, the unstamped one uses the current rate');
  assert.equal(t.priced, 2);
  assert.equal(t.unpriced, 0);
});

test('unpriced lines are counted, never folded into the totals', () => {
  const t = totalLines(
    [{ amount_cents: 30_000 }, { amount_cents: null }, { amount_cents: null }],
    1500,
  );
  assert.equal(t.gross_cents, 30_000);
  assert.equal(t.priced, 1);
  assert.equal(t.unpriced, 2, 'reported, so a total cannot be read as complete');
});

// ── The rate itself ────────────────────────────────────────────────────────

test('the seeded rate is read from the setting and says where it came from', async () => {
  const db = freshDb();
  const r = await takeRate(env(db) as any);
  assert.equal(r.bps, 1500);
  assert.equal(r.source, 'setting', 'the migration seeded it, so it is not the fallback');
  assert.equal(r.bps, DEFAULT_TAKE_RATE_BPS,
    'the seed and the fallback must agree, or a fresh database charges a different rate');
});

test('an unreadable setting falls back and SAYS it fell back', async () => {
  const db = freshDb();
  db.exec('DROP TABLE platform_settings');
  const r = await takeRate(env(db) as any);
  assert.equal(r.bps, DEFAULT_TAKE_RATE_BPS);
  // The distinction that matters: a page can tell a stored decision from a
  // default, which four identical numbers cannot.
  assert.equal(r.source, 'default');
});

test('a corrupt or out-of-range setting is refused rather than used', async () => {
  // THE EMPTY STRING IS THE ONE THAT MATTERED, and this test found it: every
  // other value here was already refused, while `Number('')` is 0 — so a
  // blank row became a 0% take rate reported as a deliberate SETTING. The
  // platform charging nothing, on the strength of a column somebody emptied.
  // `takeRate` now parses a non-empty digit string rather than coercing.
  for (const bad of ['not a number', '-1', String(MAX_TAKE_RATE_BPS + 1), '15.5', '', '   ', '+1500', '1e3']) {
    const db = freshDb();
    db.prepare('UPDATE platform_settings SET value = ? WHERE key = ?')
      .run(bad, 'advisor_take_rate_bps');
    const r = await takeRate(env(db) as any);
    assert.equal(r.bps, DEFAULT_TAKE_RATE_BPS, `value ${JSON.stringify(bad)} was used`);
    assert.equal(r.source, 'default', `value ${JSON.stringify(bad)} was reported as a setting`);
  }

  // AND THE OTHER DIRECTION, because "refuse anything unusual" is the easy
  // over-correction. Surrounding whitespace is what `trim()` is for, and a
  // rate an operator really set must not fall back to the default because a
  // form submitted a trailing space.
  for (const good of ['1500', ' 1500', '1500 ', '\n1200\t', '0', String(MAX_TAKE_RATE_BPS)]) {
    const db = freshDb();
    db.prepare('UPDATE platform_settings SET value = ? WHERE key = ?')
      .run(good, 'advisor_take_rate_bps');
    const r = await takeRate(env(db) as any);
    assert.equal(r.source, 'setting', `value ${JSON.stringify(good)} was refused`);
    assert.equal(r.bps, Number(good.trim()), `value ${JSON.stringify(good)} parsed wrong`);
  }
});

// ── The per-line stamp ─────────────────────────────────────────────────────

test('pricing a session stamps the cut and the rate, server-side', async () => {
  const db = freshDb();
  const e = env(db);
  const id = booking(db, 'b1', 1, CLIENT_A);
  const r = await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.amount_cents, 30_000);
  assert.equal(r.body.platform_cut_cents, 4_500);
  assert.equal(r.body.take_rate_bps, 1500);
  assert.equal(r.body.net_cents, 25_500);
  assert.equal(r.body.amount_cents - r.body.platform_cut_cents, r.body.net_cents);

  // And in the row, not only in the response — a figure that exists for one
  // request is not a record.
  const row = db.prepare('SELECT platform_cut_cents, take_rate_bps FROM advisor_bookings WHERE id = ?')
    .get(id) as any;
  assert.equal(row.platform_cut_cents, 4_500);
  assert.equal(row.take_rate_bps, 1500);
});

test('clearing a price clears the cut and the rate with it', async () => {
  const db = freshDb();
  const e = env(db);
  const id = booking(db, 'b1', 1, CLIENT_A);
  await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000 });
  const r = await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada,
    { amount_cents: null, billing_state: 'unpriced' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.amount_cents, null);
  // A stale cut left behind would be a figure with nothing under it.
  assert.equal(r.body.platform_cut_cents, null);
  assert.equal(r.body.take_rate_bps, null);
  assert.equal(r.body.net_cents, null);
});

test('a line priced under the old rate does not move when the rate changes', async () => {
  const db = freshDb();
  const e = env(db);
  const id = booking(db, 'b1', 1, CLIENT_A);
  await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000 });

  // An operator drops the rate.
  db.prepare('UPDATE platform_settings SET value = ? WHERE key = ?').run('1200', 'advisor_take_rate_bps');

  const ledger = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(ledger.status, 200, JSON.stringify(ledger.body));
  assert.equal(ledger.body.totals.cut_cents, 4_500,
    'the already-priced line keeps 15% — a reconciled quarter must not restate');
  assert.equal(ledger.body.take_rate.bps, 1200, 'while the CURRENT rate is the new one');

  // A line priced after the change takes the new rate, so the setting is not
  // merely ignored.
  const id2 = booking(db, 'b2', 1, CLIENT_A);
  const priced = await call(e, 'PATCH', `/me/bookings/${id2}/billing`, ada, { amount_cents: 30_000 });
  assert.equal(priced.body.take_rate_bps, 1200);
  assert.equal(priced.body.platform_cut_cents, 3_600);
});

// ── The ledger ─────────────────────────────────────────────────────────────

test('the ledger groups by client and every row reconciles with the total', async () => {
  const db = freshDb();
  const e = env(db);
  const ids = [
    booking(db, 'b1', 1, CLIENT_A), booking(db, 'b2', 1, CLIENT_A),
    booking(db, 'b3', 1, CLIENT_B),
  ];
  await call(e, 'PATCH', `/me/bookings/${ids[0]}/billing`, ada, { amount_cents: 30_000 });
  await call(e, 'PATCH', `/me/bookings/${ids[1]}/billing`, ada, { amount_cents: 30_000 });
  await call(e, 'PATCH', `/me/bookings/${ids[2]}/billing`, ada, { amount_cents: 10_000 });

  const r = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.clients.length, 2);
  // Sorted by gross, so the first row is the client that carries the practice.
  assert.equal(r.body.clients[0].client_name, 'Meridian Labs');
  assert.equal(r.body.clients[0].gross_cents, 60_000);
  assert.equal(r.body.clients[0].cut_cents, 9_000);
  assert.equal(r.body.clients[0].net_cents, 51_000);

  // EVERY row reconciles, and the rows sum to the total.
  let g = 0; let cut = 0;
  for (const row of r.body.clients) {
    assert.equal(row.gross_cents - row.cut_cents, row.net_cents, row.client_name);
    g += row.gross_cents; cut += row.cut_cents;
  }
  assert.equal(g, r.body.totals.gross_cents);
  assert.equal(cut, r.body.totals.cut_cents);
  assert.equal(r.body.totals.gross_cents - r.body.totals.cut_cents, r.body.totals.net_cents);
});

test('the ledger reports unpriced sessions rather than shrinking quietly', async () => {
  const db = freshDb();
  const e = env(db);
  const id = booking(db, 'b1', 1, CLIENT_A);
  booking(db, 'b2', 1, CLIENT_A);          // never priced
  await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000 });

  const r = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(r.body.totals.sessions, 2);
  assert.equal(r.body.totals.priced_sessions, 1);
  assert.equal(r.body.totals.unpriced_sessions, 1);
  assert.equal(r.body.clients[0].unpriced_sessions, 1, 'and per client, so the reader sees which');
});

test('concentration is null over an empty quarter, never nought per cent', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.gross_cents, 0);
  // 0% reads as "well spread", which is the opposite of what no revenue means.
  assert.equal(r.body.concentration, null);
});

test('concentration is null when there ARE clients but no gross to concentrate', async () => {
  // THE CASE THE EMPTY-QUARTER TEST ABOVE CANNOT REACH, and a mutation found
  // it: with no bookings at all the guard short-circuits on `top` being
  // undefined, so `gross_cents > 0` and `>= 0` behave identically and the
  // real division-by-zero goes unchecked. Here there are two clients and
  // four sessions, none of them priced — `top` exists and gross is 0, which
  // is exactly when `>= 0` divides by zero and ships `pct: NaN` (JSON: null)
  // inside a concentration object that looks like an answer.
  const db = freshDb();
  const e = env(db);
  booking(db, 'b1', 1, CLIENT_A);
  booking(db, 'b2', 1, CLIENT_A);
  booking(db, 'b3', 1, CLIENT_B);
  booking(db, 'b4', 1, CLIENT_B);

  const r = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(r.status, 200);
  assert.equal(r.body.clients.length, 2, 'the clients are on the page');
  assert.equal(r.body.totals.gross_cents, 0, 'and none of it is priced');
  assert.equal(r.body.totals.unpriced_sessions, 4);
  assert.equal(r.body.concentration, null,
    'a share of nothing is a question with no answer, not a number');

  // A priced zero is the same arithmetic and must answer the same way: an
  // advisor who worked four free sessions has no concentration either.
  for (const uid of ['b1', 'b2', 'b3', 'b4']) {
    const id = (db.prepare('SELECT id FROM advisor_bookings WHERE uid = ?').get(uid) as any).id;
    await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 0 });
  }
  const free = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(free.body.totals.gross_cents, 0);
  assert.equal(free.body.totals.priced_sessions, 4, 'zero is a price someone meant');
  assert.equal(free.body.concentration, null);
});

test('the ledger window is a half-open interval on the booking date', async () => {
  const db = freshDb();
  const e = env(db);
  const inQ = booking(db, 'b1', 1, CLIENT_A, '2026-08-15T00:00:00.000Z');
  const after = booking(db, 'b2', 1, CLIENT_A, '2026-10-01T00:00:00.000Z');
  await call(e, 'PATCH', `/me/bookings/${inQ}/billing`, ada, { amount_cents: 30_000 });
  await call(e, 'PATCH', `/me/bookings/${after}/billing`, ada, { amount_cents: 99_000 });

  const q3 = await call(e, 'GET',
    '/me/ledger?from=2026-07-01T00:00:00.000Z&until=2026-10-01T00:00:00.000Z', ada);
  assert.equal(q3.body.totals.gross_cents, 30_000,
    'the row exactly on `until` is excluded — half-open, so quarters cannot double-count');
  assert.equal(q3.body.totals.sessions, 1);
});

test('one advisor cannot see another advisor’s ledger', async () => {
  const db = freshDb();
  const e = env(db);
  const id = booking(db, 'b1', 1, CLIENT_A);
  await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000 });
  const r = await call(e, 'GET', '/me/ledger', grace);
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.gross_cents, 0);
  assert.equal(r.body.clients.length, 0);
});

// ── The payout account ─────────────────────────────────────────────────────

test('an advisor who never started a payout account still gets a state and a gate', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/me/payout-account', ada);
  assert.equal(r.status, 200);
  assert.equal(r.body.started, false);
  // Not yet asked is not refused.
  assert.equal(r.body.state, 'pending');
  assert.match(r.body.gate, /held uncharged until verification clears/);
  assert.equal(r.body.last_checked_at, null, 'null means never asked');
});

test('the payout state is derived from what the provider said, blocked winning', () => {
  assert.equal(derivePayoutState(null), 'pending');
  assert.equal(derivePayoutState({ charges_enabled: 0, payouts_enabled: 0 }), 'pending');
  assert.equal(derivePayoutState({ charges_enabled: 1, payouts_enabled: 0 }), 'pending',
    'charging without payouts is not verified — the money would have nowhere to land');
  assert.equal(derivePayoutState({ charges_enabled: 1, payouts_enabled: 1 }), 'verified');
  assert.equal(
    derivePayoutState({ charges_enabled: 1, payouts_enabled: 1, blocked_reason: 'review' }),
    'blocked', 'a block outranks every capability flag');
});

test('the payout account never returns the provider account id', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO advisor_payout_accounts (uid, advisor_id, provider_account_id, charges_enabled, payouts_enabled, state)
     VALUES ('pa1', 1, 'acct_SECRET', 1, 1, 'verified')`).run();
  const r = await call(env(db), 'GET', '/me/payout-account', ada);
  assert.equal(r.body.state, 'verified');
  assert.match(r.body.gate, /bookable and chargeable/);
  assert.equal(JSON.stringify(r.body).includes('acct_SECRET'), false,
    'nothing on the page needs the account id, so it does not leave the worker');
});

test('payout history is the advisor’s own, newest first, with both kinds of time', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO advisor_payouts (uid, advisor_id, amount_cents, state, scheduled_for, paid_at)
     VALUES (?, ?, ?, ?, ?, ?)`);
  ins.run('p1', 1, 4_590, 'paid', null, '2026-08-22T12:00:00.000Z');
  ins.run('p2', 1, 9_945, 'scheduled', '2026-09-01', null);
  ins.run('p3', 2, 1_000, 'paid', null, '2026-08-25T12:00:00.000Z');

  const r = await call(env(db), 'GET', '/me/payouts', ada);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2, "another advisor's payout is not in this list");
  // A scheduled row is future-tense and carries a CALENDAR DAY; a paid one
  // carries the INSTANT it settled. Kept apart so a page cannot format one as
  // the other and move "Sep 1" for readers west of Greenwich.
  const scheduled = r.body.items.find((i: any) => i.state === 'scheduled');
  assert.equal(scheduled.scheduled_for, '2026-09-01');
  assert.equal(scheduled.paid_at, null);
  const paid = r.body.items.find((i: any) => i.state === 'paid');
  assert.equal(paid.scheduled_for, null);
  assert.ok(paid.paid_at.includes('T'), 'an instant, not a day');
});

// ── The tax summary ────────────────────────────────────────────────────────

test('the tax summary totals one calendar year and says it is not a tax form', async () => {
  const db = freshDb();
  const e = env(db);
  const inYear = booking(db, 'b1', 1, CLIENT_A, '2026-03-02T00:00:00.000Z');
  const lastYear = booking(db, 'b2', 1, CLIENT_A, '2025-12-31T23:59:59.000Z');
  const nextYear = booking(db, 'b3', 1, CLIENT_B, '2027-01-01T00:00:00.000Z');
  for (const id of [inYear, lastYear, nextYear]) {
    await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000 });
  }
  const r = await call(e, 'GET', '/me/tax-summary?year=2026', ada);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.year, 2026);
  assert.equal(r.body.sessions, 1, 'both boundary rows are outside the year');
  assert.equal(r.body.gross_cents, 30_000);
  assert.equal(r.body.platform_cut_cents, 4_500);
  assert.equal(r.body.net_cents, 25_500);
  assert.equal(r.body.gross_cents - r.body.platform_cut_cents, r.body.net_cents);
  assert.equal(r.body.clients, 1);

  // THE WORDING IS PART OF THE PAYLOAD, so no surface can render the number
  // without it and a future CSV export inherits it.
  assert.equal(r.body.document.is_tax_form, false);
  assert.match(r.body.document.note, /not an IRS Form 1099/);
  assert.match(r.body.document.note, /not tax advice/);
  assert.match(r.body.basis, /Calendar year in UTC/);
});

test('a nonsense year falls back to the current one rather than answering 400', async () => {
  const e = env(freshDb());
  for (const y of ['banana', '0', '99999', '']) {
    const r = await call(e, 'GET', `/me/tax-summary?year=${y}`, ada);
    assert.equal(r.status, 200, `year=${y}`);
    assert.ok(r.body.year >= 2026, `year=${y} produced ${r.body.year}`);
  }
});

// ── Nothing claims a charge ────────────────────────────────────────────────

test('every money response says settlement is none while charging is off', async () => {
  const db = freshDb();
  const e = env(db);
  const id = booking(db, 'b1', 1, CLIENT_A);
  await call(e, 'PATCH', `/me/bookings/${id}/billing`, ada, { amount_cents: 30_000 });
  for (const path of ['/me/earnings', '/me/ledger', '/me/payout-account', '/me/payouts', '/me/tax-summary']) {
    const r = await call(e, 'GET', path, ada);
    assert.equal(r.status, 200, path);
    assert.equal(r.body.settlement, 'none', `${path} did not say settlement is none`);
  }
});

test('settlement needs the flag AND a key, and production decides live from test', () => {
  const base: any = { DB: null };
  assert.equal(settlementMode(base), 'none', 'nothing set');
  assert.equal(settlementMode({ ...base, STRIPE_SECRET_KEY: 'sk_test_x' }), 'none',
    'a key alone must not turn charging on — that is how a dev key charges a client');
  assert.equal(settlementMode({ ...base, ADVISOR_CHARGING_ENABLED: '1' }), 'none',
    'the flag alone must not either — a flag with no key would fail silently');
  assert.equal(
    settlementMode({ ...base, ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' }),
    'test', 'both, outside production');
  assert.equal(
    settlementMode({
      ...base, ADVISOR_CHARGING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_live_x',
      ENVIRONMENT: 'production',
    }),
    'live', 'both, in production');
  // The flag is read as exactly '1'. Anything else is off, so a half-set
  // variable ('true', 'yes', '') cannot switch on charging by accident.
  for (const v of ['true', 'yes', 'on', '0', '']) {
    assert.equal(
      settlementMode({ ...base, ADVISOR_CHARGING_ENABLED: v, STRIPE_SECRET_KEY: 'sk_test_x' }),
      'none', `ADVISOR_CHARGING_ENABLED=${JSON.stringify(v)} turned charging on`);
  }
});

test('migration 241 keeps the state vocabulary the payout ledger needs', () => {
  // The mirror of the settlement ban, and it exists because the ban alone can
  // be satisfied by DELETING the state the service leg is being built toward
  // — after which the guard passes over a schema that can no longer record a
  // payment at all. Read from the CHECK clause, not the file, so the
  // migration's own comments cannot satisfy it.
  const sql = migration('241_advisor_money_model');
  const check = sql.match(/CHECK\s*\(\s*state\s+IN\s*\(([^)]*)\)/g) || [];
  const all = check.join(' ');
  for (const s of ['pending', 'verified', 'blocked', 'scheduled', 'paid', 'failed', 'reversed']) {
    assert.ok(all.includes(`'${s}'`), `241 no longer admits the state '${s}'`);
  }
});

// ── 242 · the period note ──────────────────────────────────────────────────

test('a period nobody has written about answers 200 with no note', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/me/period-notes/2026-Q3', ada);
  // NOT A 404. Not having written one is the ordinary case and the card
  // renders it; a 404 would make the page treat a normal state as a failure.
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { period_key: '2026-Q3', note: null });
});

test('only the four shapes of period key are storable', async () => {
  const e = env(freshDb());
  for (const bad of ['2026-Q5', 'Q3-2026', '26-Q3', 'everything', '2026-q3', '../etc', '']) {
    const g = await call(e, 'GET', `/me/period-notes/${encodeURIComponent(bad)}`, ada);
    assert.ok(g.status === 400 || g.status === 404, `GET ${JSON.stringify(bad)} → ${g.status}`);
    const w = await call(e, 'PUT', `/me/period-notes/${encodeURIComponent(bad)}`, ada, { body: 'x' });
    assert.ok(w.status === 400 || w.status === 404, `PUT ${JSON.stringify(bad)} → ${w.status}`);
  }
  // And the four that ARE keys, so the validator is not simply strict.
  for (const good of ['2026-Q1', '2026-Q4', '2026', 'all']) {
    const w = await call(e, 'PUT', `/me/period-notes/${good}`, ada, { body: 'a real note' });
    assert.equal(w.status, 200, `PUT ${good} → ${w.status}`);
  }
});

test('a note is one per period and the second write replaces the first', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', '/me/period-notes/2026-Q3', ada, { body: 'first', source: 'ai' });
  const second = await call(e, 'PUT', '/me/period-notes/2026-Q3', ada, { body: 'second', source: 'edited' });
  assert.equal(second.body.note.body, 'second');
  assert.equal(second.body.note.source, 'edited');
  const rows = db.prepare('SELECT COUNT(*) n FROM advisor_period_notes').get() as any;
  assert.equal(rows.n, 1, 'the unique index is what makes this one note, not a pile');
});

test('the figures a note was written against are stored with it', async () => {
  // A narrative reads "gross is $18,450"; if a session is priced afterwards
  // the table moves and the sentence does not. Without the stamp the page can
  // only show two numbers and no reason.
  const e = env(freshDb());
  const w = await call(e, 'PUT', '/me/period-notes/2026-Q3', ada, {
    body: 'Gross is up on Q2.', source: 'ai',
    figures: { gross_cents: 18_450_00, cut_cents: 2_767_50, net_cents: 15_682_50 },
  });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(w.body.note.figures.gross_cents, 18_450_00);
  const g = await call(e, 'GET', '/me/period-notes/2026-Q3', ada);
  assert.equal(g.body.note.figures.net_cents, 15_682_50, 'and it survives the round trip');
});

test('an empty note is refused BY THE ROUTE, not by the column', async () => {
  // THE STATUS ALONE CANNOT TELL THE TWO APART, and a mutation proved it:
  // deleting the route's own check left this green, because `body TEXT NOT
  // NULL` then rejects the insert and `mapError` maps a constraint failure to
  // the same 400. The test was reading the DATABASE's refusal and crediting
  // the route. PR4a's audience check had the identical fault, where SQLite's
  // CHECK error text contained the word the assertion matched.
  //
  // So: the route's own phrasing, which the database never produces, and no
  // row written either way.
  const db = freshDb();
  const e = env(db);
  for (const body of ['', '   ', null, undefined]) {
    const w = await call(e, 'PUT', '/me/period-notes/2026-Q3', ada, { body });
    assert.equal(w.status, 400, `body ${JSON.stringify(body)} was accepted`);
    assert.match(String(w.body?.detail || ''), /A note needs some text/,
      `body ${JSON.stringify(body)} was refused by the column, not by the route`);
  }
  const n = db.prepare('SELECT COUNT(*) n FROM advisor_period_notes').get() as any;
  assert.equal(n.n, 0, 'nothing was written');
});

test('discarding is idempotent, so a second click is not an error', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', '/me/period-notes/2026-Q3', ada, { body: 'a note' });
  const first = await call(e, 'DELETE', '/me/period-notes/2026-Q3', ada);
  assert.equal(first.status, 200);
  assert.equal(first.body.note, null);
  const second = await call(e, 'DELETE', '/me/period-notes/2026-Q3', ada);
  assert.equal(second.status, 200, 'Discard must not fail on a note that is already gone');
});

test('a note is the advisor’s own and another advisor cannot read it', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', '/me/period-notes/2026-Q3', ada, { body: 'my private read of the quarter' });
  const theirs = await call(e, 'GET', '/me/period-notes/2026-Q3', grace);
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.note, null, "another advisor's note is not visible, and not an error either");
});

test('an unknown source falls back to advisor rather than crediting the model', async () => {
  const e = env(freshDb());
  const w = await call(e, 'PUT', '/me/period-notes/2026-Q3', ada, { body: 'x', source: 'magic' });
  assert.equal(w.body.note.source, 'advisor',
    'over-crediting a model is the failure that matters here, so the fallback is the human');
});

// ── The retainer column, from the engagement rather than the booking ───────

test('a retainer comes from the engagement, and only from a retainer-shaped one', async () => {
  const db = freshDb();
  const e = env(db);
  const ins = db.prepare(
    `INSERT INTO advisor_engagements (uid, advisor_id, founder_user_id, client_name, lane, shape, amount_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  ins.run('e1', 1, CLIENT_A, 'Meridian Labs', 'signed', 'retainer', 13_500_00);
  ins.run('e2', 1, CLIENT_B, 'Halverton', 'signed', 'sprint', 9_000_00);
  ins.run('e3', 1, null, 'Verwood', 'signed', 'equity', null);

  const r = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.clients.map((c: any) => [c.client_name, c]));
  assert.equal(by['Meridian Labs'].retainer_cents, 13_500_00);
  // A SPRINT'S AMOUNT IS NOT A RETAINER. Putting it in a column headed
  // "Retainer" would mislabel it, so the column is absent rather than wrong.
  assert.equal(by.Halverton.retainer_cents, null);
  assert.equal(by.Halverton.engagement_shape, 'sprint');
  // An equity engagement has no cents at all, which 238 calls the ordinary
  // case — and it still gets a ROW, because a client who bills no cash is
  // exactly the one a cash table would otherwise hide.
  assert.equal(by.Verwood.retainer_cents, null);
  assert.equal(by.Verwood.engagement_shape, 'equity');
  assert.equal(r.body.equity_clients, 1);
});

test('a client with a contract and no priced session still appears', async () => {
  const db = freshDb();
  const e = env(db);
  db.prepare(
    `INSERT INTO advisor_engagements (uid, advisor_id, founder_user_id, client_name, lane, shape, amount_cents)
     VALUES ('e1', 1, ?, 'Meridian Labs', 'signed', 'retainer', 900000)`).run(CLIENT_A);
  const r = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(r.body.clients.length, 1, 'an INNER-shaped join would have dropped this row');
  assert.equal(r.body.clients[0].sessions, 0);
  assert.equal(r.body.clients[0].retainer_cents, 900000);
  // And it does not invent session money for them.
  assert.equal(r.body.totals.gross_cents, 0);
});

test('a drafting engagement is not a client yet', async () => {
  const db = freshDb();
  const e = env(db);
  db.prepare(
    `INSERT INTO advisor_engagements (uid, advisor_id, founder_user_id, client_name, lane, shape, amount_cents)
     VALUES ('e1', 1, ?, 'Nobody', 'drafting', 'retainer', 900000)`).run(CLIENT_A);
  const r = await call(e, 'GET', '/me/ledger', ada);
  assert.equal(r.body.clients.length, 0,
    'a contract nobody has sent is not revenue and not a row');
});
