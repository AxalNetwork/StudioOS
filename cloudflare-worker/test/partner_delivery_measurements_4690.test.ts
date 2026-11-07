/**
 * #4690 — Delivery audit 3/6: the measurements.
 *
 * Six claims, each with a regression that fails when the rule it pins is broken
 * (see the mutation list in documentation/architecture/decisions/D4690.md):
 *
 *   1. CAPACITY TIME BASIS — hours are logged per MONTH, a cap is stated per
 *      WEEK; the comparison scales the cap to the days in the month.
 *   2. THE SHARED RETAINER RULE — one active-retainer predicate and one
 *      cadence normalisation, called by Delivery AND Pipeline.
 *   3. MONTHLY AND QUARTERLY UTILISATION agree between the two pages.
 *   4. BOARD RECURRING REVENUE is the recorded recurring amount, not the quote.
 *   5. READ TRACKING — missing instrumentation is never a finding.
 *   6. SEAT STATE comes from the collection of seats, identically on Board,
 *      Health and Capacity.
 *
 * HARNESS as `partner_delivery_routes.test.ts`: the real routers over real
 * in-memory SQLite built from the migration files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery from '../src/routes/partner_delivery.ts';
import partnerPipeline from '../src/routes/partner_pipeline.ts';
import {
  cadenceMonths, currentMonthlyCents, daysInPeriod, isRetainerActive, monthlyAmountCents,
  periodCapHours, periodMonths, readTrackingFor, retainerPeriodFor, retainerProjection, seatStateFor,
} from '../src/routes/_partner_workspace_helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS_USER = 60;
const OUR_STAFF = 61;      // partner_id 1, can hold a seat
const THEIRS_USER = 62;
const THEIR_STAFF = 63;    // partner_id 2, cannot
const FOUNDER_USER = 64;
const OUR_ENGAGEMENT = 901;
const THEIR_ENGAGEMENT = 902;

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
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    -- #4673: an engagement's founder_id is a FOUNDER PROFILE (founders.id), and the client's name is
    -- read from it. These fixtures keep the founder's id equal to the user's (FOUNDER_USER) on purpose;
    -- partner_delivery_report_access_4673.test.ts proves the two apart.
    CREATE TABLE founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL, email TEXT
    );
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, rfp_id INTEGER, partner_id INTEGER NOT NULL,
      price REAL NOT NULL, timeline_weeks INTEGER, deliverables TEXT NOT NULL,
      notes TEXT, status TEXT NOT NULL DEFAULT 'submitted', decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (need_id, partner_id)
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(migration('208_partner_delivery_stores'));
  // APPLIED, NOT MIRRORED. The two capacity stores are read by `/capacity` and
  // written by its two `PUT`s, so the harness runs their migration files for
  // the same reason it runs 208's: a hand-copied DDL that drifts from the file
  // makes every assertion below true of a schema production does not have.
  db.exec(migration('230_partner_capacity'));
  db.exec(migration('231_partner_internal_hours'));
  db.exec(migration('232_partner_engagement_health'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(OUR_STAFF, 'partner', 1, 'Sam', 'sam@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(THEIR_STAFF, 'partner', 2, 'Robin', 'robin@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER_USER, 'Fran', 'fran@example.com');

  const p = db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'Ours', 'ours@example.com');
  p.run(2, 'p-2', 'Theirs', 'theirs@example.com');

  const n = db.prepare(
    'INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(501, 'need-1', 9, FOUNDER_USER, 'engineering', 'Payments migration', 'x');
  n.run(502, 'need-2', 9, FOUNDER_USER, 'design', 'Brand refresh', 'y');

  const e = db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENGAGEMENT, 'e-ours', 501, 601, 1, FOUNDER_USER, 9, 42000);
  e.run(THEIR_ENGAGEMENT, 'e-theirs', 502, 602, 2, FOUNDER_USER, 9, 15000);

  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
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
  const router = path.startsWith('/pipeline') ? partnerPipeline : partnerDelivery;
  const res = await router.request(path.replace(/^\/pipeline/, ''), init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ours = { user: OURS_USER, role: 'partner' };
const theirs = { user: THEIRS_USER, role: 'partner' };
const fran = { user: FOUNDER_USER, role: 'founder' };


const d = (iso: string) => new Date(iso);
const nowPeriod = () => {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`;
};
// Independently of the helper under test.
const nowQuarter = () => {
  const n = new Date();
  return `${n.getUTCFullYear()}-Q${Math.floor(n.getUTCMonth() / 3) + 1}`;
};
const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

function retainer(
  db: InstanceType<typeof DatabaseSync>, engagementId: number,
  o: { cadence?: string; amount?: number | null; hours?: number | null; ended?: string | null; shape?: string } = {},
): number {
  const r = db.prepare(
    `INSERT INTO partner_retainers (uid, engagement_id, shape, cadence, amount_cents, retained_hours, ended_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(`ret-${engagementId}`, engagementId, o.shape ?? 'retainer', o.cadence ?? 'monthly',
    o.amount === undefined ? null : o.amount, o.hours === undefined ? null : o.hours, o.ended ?? null);
  return Number(r.lastInsertRowid);
}
const usage = (db: InstanceType<typeof DatabaseSync>, retainerId: number, period: string, hours: number) =>
  db.prepare('INSERT INTO retainer_usage (retainer_id, period, hours_used) VALUES (?,?,?)').run(retainerId, period, hours);
function secondEngagement(db: InstanceType<typeof DatabaseSync>, id: number, price = 9000) {
  db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(id, `e-ours-${id}`, 502, 700 + id, 1, FOUNDER_USER, 9, price);
}

// ---------------------------------------------------------------------------
// 1. Capacity: matching periods and units
// ---------------------------------------------------------------------------

test('retainer periods follow the cadence, and the boundaries agree with their labels', () => {
  // Month: the last second of a month and the first of the next.
  assert.equal(retainerPeriodFor('monthly', d('2026-12-31T23:59:59Z')), '2026-12');
  assert.equal(retainerPeriodFor('monthly', d('2027-01-01T00:00:00Z')), '2027-01');
  // Quarter: Q1 ends 31 March, Q2 starts 1 April; Q4 rolls into the next year's Q1.
  assert.equal(retainerPeriodFor('quarterly', d('2026-03-31T23:59:59Z')), '2026-Q1');
  assert.equal(retainerPeriodFor('quarterly', d('2026-04-01T00:00:00Z')), '2026-Q2');
  assert.equal(retainerPeriodFor('quarterly', d('2026-12-31T23:59:59Z')), '2026-Q4');
  assert.equal(retainerPeriodFor('quarterly', d('2027-01-01T00:00:00Z')), '2027-Q1');
  assert.deepEqual(periodMonths('2026-Q4'), ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(periodMonths('2027-01'), ['2027-01']);
  assert.deepEqual(periodMonths('nonsense'), []);
});

test('a weekly cap is scaled to the days of the month the hours cover', () => {
  assert.equal(daysInPeriod('2026-02'), 28);
  assert.equal(daysInPeriod('2028-02'), 29, 'a leap February');
  assert.equal(daysInPeriod('2026-12'), 31);
  assert.equal(daysInPeriod('2026-04'), 30);
  assert.equal(daysInPeriod('2026-13'), null);
  assert.equal(periodCapHours(40, '2026-02'), 160);
  assert.equal(periodCapHours(40, '2028-02'), 165.71);
  assert.equal(periodCapHours(40, '2026-12'), 177.14);
  assert.equal(periodCapHours(null, '2026-12'), null, 'no cap is not a zero cap');
  assert.equal(periodCapHours(40, 'bad'), null);
});

test('monthly hours are compared with the weekly cap over the SAME period, not with the weekly number', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', '/capacity/cap', ours, { weekly_hours: 40 });
  // 170 h: over February's 160 h and under December's 177.14 h. Compared
  // directly with 40 it would be over in both.
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/2026-02`, ours, { hours: 170 });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/hours/${OUR_STAFF}/2026-12`, ours, { hours: 170 });

  const feb = (await call(e, 'GET', '/capacity?period=2026-02', ours)).body;
  assert.equal(feb.cap_hours, 40, 'the stated weekly cap is still returned as stated');
  assert.equal(feb.cap_unit, 'hours_per_week');
  assert.equal(feb.hours_unit, 'hours_per_month');
  assert.equal(feb.period_days, 28);
  assert.equal(feb.period_cap_hours, 160);
  assert.equal(feb.people[0].period_cap_hours, 160);
  assert.equal(feb.people[0].over_committed, true);
  assert.equal(feb.over_committed_count, 1);

  const dec = (await call(e, 'GET', '/capacity?period=2026-12', ours)).body;
  assert.equal(dec.period_cap_hours, 177.14);
  assert.equal(dec.people[0].over_committed, false, 'monthly hours were compared with a weekly number');
  assert.equal(dec.over_committed_count, 0);
});

test('a capacity period that is not a month is refused, not compared with the wrong cap', async () => {
  const e = env(freshDb());
  for (const bad of ['2026-Q1', '2026-13', 'this-week', '2026-1']) {
    const r = await call(e, 'GET', `/capacity?period=${bad}`, ours);
    assert.equal(r.status, 400, `${bad} was accepted`);
  }
});

test('the board counts a quarterly retainer\'s hours over its quarter, against hours sold for the quarter', async () => {
  const db = freshDb();
  const e = env(db);
  retainer(db, OUR_ENGAGEMENT, { cadence: 'quarterly', amount: 900000, hours: 120, shape: 'embedded_seat' });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF, scope: 'Board' });
  const q = nowQuarter();
  const y = q.slice(0, 4);
  const first = (Number(q.slice(-1)) - 1) * 3 + 1;
  const h = db.prepare('INSERT INTO engagement_hours (engagement_id, person_user_id, period, hours) VALUES (?,?,?,?)');
  [10, 20, 30].forEach((n, i) => h.run(OUR_ENGAGEMENT, OUR_STAFF, `${y}-${String(first + i).padStart(2, '0')}`, n));
  // A neighbouring quarter must not leak in.
  h.run(OUR_ENGAGEMENT, OUR_STAFF, `${Number(y) - 1}-12`, 99);

  const row = (await call(e, 'GET', '/board', ours)).body.items[0];
  assert.equal(row.hours_period, q);
  assert.equal(row.hours_this_period, 60, 'a quarter of hours was not counted against a quarter of retained hours');
  assert.equal(row.hours_cap, 120);
});

// ---------------------------------------------------------------------------
// 2. The shared retainer rule (helper level)
// ---------------------------------------------------------------------------

test('cadence normalisation: monthly as is, quarterly over three, longer cadences by their months, unknown is null', () => {
  assert.equal(cadenceMonths('monthly'), 1);
  assert.equal(cadenceMonths('quarterly'), 3);
  assert.equal(cadenceMonths('annual'), 12);
  assert.equal(cadenceMonths('fortnightly'), null);
  assert.equal(monthlyAmountCents({ cadence: 'monthly', amount_cents: 800000 }), 800000);
  assert.equal(monthlyAmountCents({ cadence: 'quarterly', amount_cents: 900000 }), 300000);
  assert.equal(monthlyAmountCents({ cadence: 'annual', amount_cents: 1200000 }), 100000);
  assert.equal(monthlyAmountCents({ cadence: 'quarterly', amount_cents: 1000000 }), 333333, 'rounded to a cent');
  assert.equal(monthlyAmountCents({ cadence: 'fortnightly', amount_cents: 5 }), null, 'an unknown cadence is not guessed');
  assert.equal(monthlyAmountCents({ cadence: 'monthly', amount_cents: null }), null, 'no amount is not zero');
  assert.equal(monthlyAmountCents(null), null);
});

test('the active-retainer predicate: ended retainers are not current', () => {
  const now = d('2026-11-07T12:00:00Z');
  assert.equal(isRetainerActive({ ended_at: null }, now), true);
  assert.equal(isRetainerActive({ ended_at: '' }, now), true);
  assert.equal(isRetainerActive({ ended_at: '2026-10-31' }, now), false);
  assert.equal(isRetainerActive({ ended_at: '2026-11-07T11:59:59Z' }, now), false);
  assert.equal(isRetainerActive({ ended_at: '2026-12-31' }, now), true, 'a scheduled end is still active today');
  assert.equal(isRetainerActive({ ended_at: 'soon' }, now), false, 'an unreadable end date does not keep money on the books');
  assert.equal(isRetainerActive(null, now), false);
  assert.equal(currentMonthlyCents({ cadence: 'quarterly', amount_cents: 900000, ended_at: '2026-10-31' }, now), null);
  assert.equal(currentMonthlyCents({ cadence: 'quarterly', amount_cents: 900000, ended_at: null }, now), 300000);
});

test('the projection carries cadence, period, usage, retained hours, amount and monthly normalisation', () => {
  const now = d('2026-11-07T12:00:00Z');
  const p = retainerProjection(
    { retainer_id: 7, cadence: 'quarterly', amount_cents: 900000, retained_hours: 120, ended_at: null },
    [{ period: '2026-Q4', hours_used: 30 }, { period: '2026-11', hours_used: 99 }],
    now,
  );
  assert.equal(p.current_period, '2026-Q4');
  assert.equal(p.utilisation_pct, 25, 'the monthly decoy row was used for a quarterly retainer');
  assert.equal(p.hours_used, 30);
  assert.equal(p.retained_hours, 120);
  assert.equal(p.retainer!.cadence, 'quarterly');
  assert.equal(p.retainer!.monthly_amount_cents, 300000);
  assert.equal(p.retainer!.current_monthly_cents, 300000);
  assert.equal(p.retainer!.active, true);
  assert.equal(p.usage.length, 2);
  // No retainer at all is not a retainer with nothing in it.
  const none = retainerProjection(null, [], now);
  assert.equal(none.retainer, null);
  assert.equal(none.utilisation_pct, null);
});

// ---------------------------------------------------------------------------
// 3. Delivery and Pipeline agree
// ---------------------------------------------------------------------------

test('monthly and quarterly retainers show the SAME utilisation in Delivery and Pipeline', async () => {
  const db = freshDb();
  const e = env(db);
  secondEngagement(db, 903);
  const monthly = retainer(db, OUR_ENGAGEMENT, { cadence: 'monthly', amount: 800000, hours: 40 });
  const quarterly = retainer(db, 903, { cadence: 'quarterly', amount: 900000, hours: 120 });
  usage(db, monthly, nowPeriod(), 30);
  usage(db, quarterly, nowQuarter(), 30);
  // A row labelled with the current MONTH on the quarterly retainer: not its period.
  usage(db, quarterly, nowPeriod(), 90);

  const pipe = (await call(e, 'GET', '/pipeline/retainers', ours)).body;
  const health = (await call(e, 'GET', '/health', ours)).body;
  for (const [eng, pct, period] of [[OUR_ENGAGEMENT, 75, nowPeriod()], [903, 25, nowQuarter()]] as const) {
    const p = pipe.items.find((x: any) => x.engagement_id === eng);
    const h = health.items.find((x: any) => x.engagement_id === eng);
    assert.equal(p.utilisation_pct, pct, `pipeline ${eng}`);
    assert.equal(h.utilisation_pct, p.utilisation_pct, `delivery disagrees with pipeline for ${eng}`);
    assert.equal(h.hours_used, p.hours_used);
    assert.equal(h.retained_hours, p.retained_hours);
    assert.equal(p.current_period, period);
    assert.equal(h.retainer_period, period);
  }
  // And the board reads the same figure into its health.
  const board = (await call(e, 'GET', '/board', ours)).body;
  assert.equal(board.items.find((x: any) => x.engagement_id === 903).health, 'at_risk', '25% used is under 60%');
});

test('pipeline normalises a quarterly retainer to a month and an ended one is not counted (#4690)', async () => {
  const db = freshDb();
  const e = env(db);
  secondEngagement(db, 903);
  secondEngagement(db, 904);
  retainer(db, OUR_ENGAGEMENT, { cadence: 'monthly', amount: 800000, hours: 40 });
  retainer(db, 903, { cadence: 'quarterly', amount: 900000, hours: 120 });
  retainer(db, 904, { cadence: 'monthly', amount: 5000000, hours: 10, ended: past(30) });

  const r = (await call(e, 'GET', '/pipeline/retainers', ours)).body;
  assert.equal(r.mrr_cents, 800000 + 300000, 'quarterly was not divided by three, or an ended retainer was summed');
  assert.equal(r.retainer_count, 3);
  assert.equal(r.active_retainer_count, 2);
  const ended = r.items.find((x: any) => x.engagement_id === 904);
  assert.equal(ended.retainer.active, false);
  assert.equal(ended.retainer.current_monthly_cents, null);
  assert.equal(ended.retainer.monthly_amount_cents, 5000000, 'the recorded amount is still shown');
  assert.equal(ended.utilisation_pct, null);
  assert.match(ended.utilisation_note, /ended/);
});

test('an engagement whose only retainer ended has no recurring total, and says why', async () => {
  const db = freshDb();
  const e = env(db);
  retainer(db, OUR_ENGAGEMENT, { cadence: 'monthly', amount: 800000, ended: past(1) });
  const r = (await call(e, 'GET', '/pipeline/retainers', ours)).body;
  assert.equal(r.mrr_cents, null, 'an ended retainer is not recurring revenue');
  assert.match(r.mrr_note, /ended/i);
});

test('an ended retainer produces no utilisation finding in Delivery', async () => {
  const db = freshDb();
  const e = env(db);
  const id = retainer(db, OUR_ENGAGEMENT, { cadence: 'monthly', hours: 100, ended: past(40) });
  usage(db, id, nowPeriod(), 10);
  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.utilisation_pct, null);
  assert.equal(row.retainer_active, false);
  assert.ok(!row.health_reasons.some((x: string) => /retained hours/.test(x)), 'an ended retainer rated its engagement');
  assert.equal(row.health, null, 'an ended retainer alone is nothing current to rate — and certainly not at risk');
});

// ---------------------------------------------------------------------------
// 4. Board recurring revenue is the recurring contract, not the quote
// ---------------------------------------------------------------------------

async function grant(e: any, engagementId: number, scope: string | null = 'Board') {
  const r = await call(e, 'POST', `/engagements/${engagementId}/seats`, ours, { holder_user_id: OUR_STAFF, scope });
  assert.equal(r.status, 200);
  return r.body.id as number;
}

test('Embedded / month is the recorded recurring amount normalised to a month — never the quote value', async () => {
  const db = freshDb();
  const e = env(db);
  secondEngagement(db, 903, 77000);
  secondEngagement(db, 904, 66000);
  retainer(db, OUR_ENGAGEMENT, { cadence: 'quarterly', amount: 900000, hours: 120 }); // 42000 quote
  retainer(db, 903, { cadence: 'monthly', amount: 800000 });                         // 77000 quote
  retainer(db, 904, { cadence: 'monthly', amount: 4000000, ended: past(5) });         // ended
  for (const id of [OUR_ENGAGEMENT, 903, 904]) await grant(e, id);

  const b = (await call(e, 'GET', '/board', ours)).body;
  assert.equal(b.embedded_monthly_cents, 300000 + 800000);
  assert.equal(b.embedded_monthly, 11000, 'recurring revenue used the one-off quote values');
  assert.equal(b.embedded_unpriced_count, 1, 'the ended retainer is counted as not in the total');
  assert.match(b.embedded_monthly_note, /no active recurring amount/);
  const quarterly = b.items.find((x: any) => x.engagement_id === OUR_ENGAGEMENT);
  assert.equal(quarterly.price, 42000, 'the accepted engagement value is kept, separately');
  assert.equal(quarterly.recurring_monthly_cents, 300000);
  assert.equal(b.items.find((x: any) => x.engagement_id === 904).recurring_monthly_cents, null);
});

test('an embedded engagement with no recorded recurring amount is Not recorded, not its quote', async () => {
  const db = freshDb();
  const e = env(db);
  await grant(e, OUR_ENGAGEMENT);
  const b = (await call(e, 'GET', '/board', ours)).body;
  assert.equal(b.embedded_monthly, null);
  assert.equal(b.embedded_monthly_cents, null);
  assert.match(b.embedded_monthly_note, /not recorded/i);
  assert.equal(b.items[0].price, 42000);
});

// ---------------------------------------------------------------------------
// 5. Read tracking
// ---------------------------------------------------------------------------

test('read tracking: available only when the build is instrumented or an open exists', () => {
  assert.equal(readTrackingFor([{ opened_at: null }]).available, false);
  assert.equal(readTrackingFor([]).available, false);
  assert.equal(readTrackingFor([{ opened_at: '2026-11-01' }]).available, true);
  assert.equal(readTrackingFor([], true).available, true);
  assert.match(readTrackingFor([]).reason!, /^Not recorded/);
});

test('missing instrumentation cannot produce a "client did not read it" finding anywhere', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Spec', sent_at: past(20) });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Plan', sent_at: past(3) });

  const list = (await call(e, 'GET', '/deliverables', ours)).body;
  assert.equal(list.read_tracking.available, false);
  assert.equal(list.unopened_count, null);
  assert.deepEqual(list.items.map((x: any) => x.read_state), ['not_recorded', 'not_recorded']);
  assert.deepEqual(list.items.map((x: any) => x.is_unopened), [null, null]);

  const health = (await call(e, 'GET', '/health', ours)).body;
  assert.equal(health.read_tracking.available, false);
  const row = health.items[0];
  assert.equal(row.deliverables_unopened, null);
  assert.equal(row.deliverables_sent, 2);
  assert.notEqual(row.health, 'at_risk');
  assert.ok(row.health_reasons.every((x: string) => !/opened|read/i.test(x)));
  assert.equal(row.health_unavailable_inputs.length, 1);
  assert.match(row.health_unavailable_inputs[0].reason, /^Not recorded/);

  const board = (await call(e, 'GET', '/board', ours)).body;
  assert.notEqual(board.items[0].health, 'at_risk');
  assert.equal(board.needs_attention, 0);

  // The report draft going to the client does not say "not opened" either.
  const draft = (await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/report-draft/${nowPeriod()}`, ours)).body;
  for (const x of draft.shipped_from_log) assert.equal(x.opened, null);
});

test('once opens are observable, an unopened deliverable is a finding again', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Spec', sent_at: past(20) });
  const seen = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Seen', sent_at: past(9) });
  // The client's surface would write this; the test stands in for it.
  db.prepare('UPDATE engagement_deliverables SET opened_at = ? WHERE id = ?').run(past(8), seen.body.id);

  const list = (await call(e, 'GET', '/deliverables', ours)).body;
  assert.equal(list.read_tracking.available, true);
  assert.equal(list.unopened_count, 1);
  const byTitle = Object.fromEntries(list.items.map((x: any) => [x.title, x.read_state]));
  assert.deepEqual(byTitle, { Spec: 'unopened', Seen: 'opened' });

  const row = (await call(e, 'GET', '/health', ours)).body.items[0];
  assert.equal(row.deliverables_unopened, 1);
  assert.equal(row.health, 'at_risk');
  assert.ok(row.health_reasons.some((x: string) => /sent and not opened/.test(x)));
  assert.deepEqual(row.health_unavailable_inputs, []);
});

// ---------------------------------------------------------------------------
// 6. Seat state: one definition from the collection
// ---------------------------------------------------------------------------

test('seatStateFor: multiple, partial, complete, empty-scope, regranted and no seats', () => {
  const seat = (id: number, granted: string, revoked: string | null, scope: string | null = 'Board') =>
    ({ id, granted_at: granted, revoked_at: revoked, scope });
  // PARTIAL REVOCATION where the NEWEST row is the revoked one: reading only
  // that row says revoked, and the engagement still has an open seat.
  const partial = [seat(1, '2026-01-01', null), seat(2, '2026-03-01', '2026-04-01')];
  for (const order of [partial, [...partial].reverse()]) {
    const s = seatStateFor(order);
    assert.equal(s.state, 'active');
    assert.equal(s.mode, 'embedded');
    assert.equal(s.has_active_seats, true);
    assert.equal(s.active_count, 1);
    assert.equal(s.revoked_count, 1);
    assert.equal(s.revoked_at, null);
    assert.equal(s.lead!.id, 1);
  }
  // COMPLETE REVOCATION: still embedded (the board keeps it, struck through).
  const all = seatStateFor([seat(1, '2026-01-01', '2026-02-01'), seat(2, '2026-03-01', '2026-04-01')]);
  assert.equal(all.state, 'revoked');
  assert.equal(all.mode, 'embedded');
  assert.equal(all.has_active_seats, false);
  assert.equal(all.revoked_at, '2026-04-01', 'when the newest seat ended');
  // REGRANT after revocation: active again, with the old row kept on record.
  const regrant = seatStateFor([seat(1, '2026-01-01', '2026-02-01'), seat(2, '2026-05-01', null)]);
  assert.equal(regrant.state, 'active');
  assert.equal(regrant.revoked_count, 1);
  // EMPTY OPTIONAL SCOPE is still a seat.
  const bare = seatStateFor([seat(1, '2026-01-01', null, null)]);
  assert.equal(bare.mode, 'embedded');
  assert.equal(bare.state, 'active');
  // NO SEATS: a project.
  const none = seatStateFor([]);
  assert.equal(none.mode, 'project');
  assert.equal(none.state, 'none');
  assert.equal(none.lead, null);
});

/** Everything the three surfaces say about one engagement's seats. */
async function surfaces(e: any, engagementId: number) {
  const board = (await call(e, 'GET', '/board', ours)).body.items.find((x: any) => x.engagement_id === engagementId);
  const health = (await call(e, 'GET', '/health', ours)).body.items.find((x: any) => x.engagement_id === engagementId);
  const cap = (await call(e, 'GET', '/capacity', ours)).body.engagements.find((x: any) => x.engagement_id === engagementId);
  return { board, health, cap };
}
function assertAgree(s: any, want: { mode: string; state: string; active: number; revoked: number }, label: string) {
  for (const [name, row] of [['board', s.board], ['health', s.health]] as const) {
    assert.equal(row.mode, want.mode, `${label}: ${name} mode`);
    assert.equal(row.seat_state, want.state, `${label}: ${name} state`);
    assert.equal(row.active_seat_count, want.active, `${label}: ${name} active`);
    assert.equal(row.revoked_seat_count, want.revoked, `${label}: ${name} revoked`);
  }
  assert.ok(s.cap, `${label}: capacity does not list the engagement`);
  assert.equal(s.cap.mode, want.mode, `${label}: capacity mode`);
  assert.equal(s.cap.seat_state, want.state, `${label}: capacity state`);
  assert.equal(s.cap.has_active_seats, want.active > 0, `${label}: capacity has_active_seats`);
  assert.equal(s.cap.active_seat_count, want.active, `${label}: capacity active`);
  assert.equal(s.cap.revoked_seat_count, want.revoked, `${label}: capacity revoked`);
}

test('Board, Health and Capacity agree through grant, partial revoke, full revoke and regrant', async () => {
  const db = freshDb();
  const e = env(db);
  db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)')
    .run(65, 'partner', 1, 'Pat', 'pat@example.com');

  assertAgree(
    { board: (await call(e, 'GET', '/board', ours)).body.items[0], health: (await call(e, 'GET', '/health', ours)).body.items[0], cap: { mode: 'project', seat_state: 'none', has_active_seats: false, active_seat_count: 0, revoked_seat_count: 0 } },
    { mode: 'project', state: 'none', active: 0, revoked: 0 }, 'no seats');

  // Two holders; the NEWER seat (Pat's) is the one revoked first.
  const older = await grant(e, OUR_ENGAGEMENT, null);          // empty optional scope
  const newer = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: 65, scope: 'KPIs' })).body.id;
  db.prepare('UPDATE engagement_seats SET granted_at = ? WHERE id = ?').run('2026-01-01T00:00:00Z', older);
  db.prepare('UPDATE engagement_seats SET granted_at = ? WHERE id = ?').run('2026-03-01T00:00:00Z', newer);
  assertAgree(await surfaces(e, OUR_ENGAGEMENT), { mode: 'embedded', state: 'active', active: 2, revoked: 0 }, 'two seats');

  await call(e, 'POST', `/seats/${newer}/revoke`, ours);
  const partial = await surfaces(e, OUR_ENGAGEMENT);
  assertAgree(partial, { mode: 'embedded', state: 'active', active: 1, revoked: 1 }, 'partial revocation');
  assert.equal(partial.board.seat_revoked_at, null, 'the board struck through a live engagement');
  assert.equal(partial.health.seat_revoked_at, null);
  assert.equal(partial.board.grant, null, 'the lead is the open seat (empty scope), not the newest revoked one');
  assert.equal(partial.health.seat_scope, null);
  assert.equal(partial.health.mode, 'embedded', 'an empty-scope seat made the engagement a project');

  await call(e, 'POST', `/seats/${older}/revoke`, ours);
  const full = await surfaces(e, OUR_ENGAGEMENT);
  assertAgree(full, { mode: 'embedded', state: 'revoked', active: 0, revoked: 2 }, 'complete revocation');
  assert.ok(full.board.seat_revoked_at);
  assert.equal(full.board.seat_revoked_at, full.health.seat_revoked_at, 'board and health name different revocation times');

  await grant(e, OUR_ENGAGEMENT, 'Regranted');
  assertAgree(await surfaces(e, OUR_ENGAGEMENT), { mode: 'embedded', state: 'active', active: 1, revoked: 2 }, 'regrant');

  const board = (await call(e, 'GET', '/board', ours)).body;
  assert.equal(board.revoked_seats, 2, 'the strip counts seat rows, like Capacity');
  assert.equal(board.fully_revoked_engagements, 0);
});

test('a revoked engagement is out of the live totals; retainer cadence has no bearing on seat state', async () => {
  const db = freshDb();
  const e = env(db);
  secondEngagement(db, 903);
  secondEngagement(db, 904);
  retainer(db, OUR_ENGAGEMENT, { cadence: 'monthly', amount: 800000 });
  retainer(db, 903, { cadence: 'quarterly', amount: 900000 });
  retainer(db, 904, { cadence: 'monthly', amount: 800000, ended: past(2) });
  const seats: Record<number, number> = {};
  for (const id of [OUR_ENGAGEMENT, 903, 904]) seats[id] = await grant(e, id);
  for (const id of [OUR_ENGAGEMENT, 903, 904]) {
    assertAgree(await surfaces(e, id), { mode: 'embedded', state: 'active', active: 1, revoked: 0 }, `retainer ${id}`);
  }
  await call(e, 'POST', `/seats/${seats[903]}/revoke`, ours);
  const b = (await call(e, 'GET', '/board', ours)).body;
  assert.equal(b.embedded_monthly_cents, 800000, 'a fully revoked quarterly engagement still counted as recurring');
  assert.equal(b.fully_revoked_engagements, 1);
  assertAgree(await surfaces(e, 903), { mode: 'embedded', state: 'revoked', active: 0, revoked: 1 }, 'revoked quarterly');
});
