/**
 * #4673 (Delivery audit 1/6) — an unsent status report stays the firm's, the
 * client's name comes from the founder profile, and a draft saves only where it
 * was composed. Synthetic records only.
 *
 *   ACCESS     one policy (services/statusReportAccess.ts) for the Delivery
 *              routes and Fill with Eadwyn: the partner reads and writes until
 *              sent; the client founder reads only a sent report.
 *   IDENTITY   `engagements.founder_id` is a founders.id. A user whose id
 *              happens to equal it is someone else; a founder with no account,
 *              or with two, still resolves to its own name.
 *   SAVE       the draft names the engagement and period it was composed for,
 *              and a save whose draft does not match its URL is refused.
 *
 * HARNESS: `partner_delivery_routes.test.ts`'s, with the founder profile given
 * an id no user has (`KESTREL`) on a third engagement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery from '../src/routes/partner_delivery.ts';

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
  const res = await partnerDelivery.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ours = { user: OURS_USER, role: 'partner' };
const theirs = { user: THEIRS_USER, role: 'partner' };

function nowPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

import { statusReportAccess } from '../src/services/statusReportAccess.ts';
import { RECORD_SCOPES } from '../src/services/fills/scopes.ts';

const KESTREL = 700;          // a founders.id that is also, by coincidence, a users.id of someone else
const KESTREL_ENGAGEMENT = 903;
const ROW_SENT = { state: 'sent' };
const ROW_DRAFT = { state: 'draft' };

function world(opts: { accounts?: number } = {}) {
  const db = freshDb();
  db.prepare("INSERT INTO founders (id, name, email) VALUES (?, 'Kestrel Founder', 'kestrel@example.test')").run(KESTREL);
  // A user whose id is the founder profile's id, and who is NOT that founder.
  db.prepare("INSERT INTO users (id, role, partner_id, name, email) VALUES (?, 'investor', NULL, 'Unrelated Person', 'unrelated@example.test')").run(KESTREL);
  db.prepare("INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (503, 'need-3', 12, ?, 'engineering', 'Ledger audit', 'z')").run(KESTREL);
  db.prepare("INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price) VALUES (?, 'e-kestrel', 503, 603, 1, ?, 12, 9000)").run(KESTREL_ENGAGEMENT, KESTREL);
  return db;
}
const reportsOf = async (e: any) => (await call(e, 'GET', '/status-reports', ours)).body;
const save = (e: any, eng: number, period: string, body: any) => call(e, 'PUT', `/engagements/${eng}/status-reports/${period}`, ours, body);

test('one policy: the partner reads and writes until sent; the client reads only a sent report; nobody else reads', () => {
  const engagement = { partner_id: 1, founder_id: KESTREL };
  const partner = { partnerId: 1, founderId: null };
  const client = { partnerId: null, founderId: KESTREL };
  const other = { partnerId: 2, founderId: 999 };
  assert.deepEqual(statusReportAccess(ROW_DRAFT, engagement, partner), { read: true, write: true });
  assert.deepEqual(statusReportAccess(ROW_SENT, engagement, partner), { read: true, write: false }, 'a sent report is frozen');
  assert.deepEqual(statusReportAccess(null, engagement, partner), { read: true, write: true }, 'a new report on its engagement');
  // Mutation checked: drop the sent-state test from the client branch -> the unsent draft reads true and this fails.
  assert.deepEqual(statusReportAccess(ROW_DRAFT, engagement, client), { read: false, write: false }, 'an unsent report is the firm\'s draft');
  assert.deepEqual(statusReportAccess(ROW_SENT, engagement, client), { read: true, write: false });
  assert.deepEqual(statusReportAccess(null, engagement, client), { read: false, write: false }, 'a client never starts one');
  assert.deepEqual(statusReportAccess(ROW_SENT, engagement, other), { read: false, write: false });
  // A user id equal to the founder id is not the founder: only users.founder_id makes someone the client.
  assert.deepEqual(statusReportAccess(ROW_SENT, engagement, { partnerId: null, founderId: null }), { read: false, write: false });
});

test('Fill with Eadwyn reads through the same policy: the client is refused an unsent report and reads a sent one', async () => {
  const scope = RECORD_SCOPES.engagement_status_reports;
  const env: any = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  const clientUser: any = { id: 11, role: 'founder', founder_id: KESTREL };
  const draft = { state: 'draft', engagement_partner_id: 1, engagement_founder_id: KESTREL };
  const sent = { ...draft, state: 'sent' };
  // Mutation checked: restore the old founder-only check in scopes.ts -> the first deepEqual fails.
  assert.deepEqual(await scope.access(env, clientUser, draft as any, null), { read: false, write: false });
  assert.deepEqual(await scope.access(env, clientUser, sent as any, null), { read: true, write: false });
  const unrelated: any = { id: KESTREL, role: 'investor', founder_id: null };
  assert.deepEqual(await scope.access(env, unrelated, sent as any, null), { read: false, write: false }, 'a coincident user id is not the client');
});

test('the client name comes from the founder profile, never from a user who shares its id', async () => {
  const e = env(world());
  const p = nowPeriod();
  assert.equal((await save(e, KESTREL_ENGAGEMENT, p, { engagement_id: KESTREL_ENGAGEMENT, period: p, shipped: 'Ledger read' })).status, 200);
  const row = (await reportsOf(e)).items.find((r: any) => r.engagement_id === KESTREL_ENGAGEMENT);
  // Mutation checked: join users on e.founder_id again -> 'Unrelated Person' and this fails.
  assert.equal(row.founder_name, 'Kestrel Founder');
  const raw = JSON.stringify(await reportsOf(e));
  assert.ok(!raw.includes('Unrelated Person'), 'the unrelated account never appears');
});

test('a founder with no linked account, or with two, still resolves to its own name', async () => {
  const db = world();
  db.prepare("INSERT INTO users (id, role, partner_id, name, email) VALUES (801, 'founder', NULL, 'Kestrel CEO', 'ceo@example.test'), (802, 'founder', NULL, 'Kestrel CTO', 'cto@example.test')").run();
  const e = env(db);
  const p = nowPeriod();
  await save(e, KESTREL_ENGAGEMENT, p, { engagement_id: KESTREL_ENGAGEMENT, period: p, shipped: 'x' });
  assert.equal((await reportsOf(e)).items.find((r: any) => r.engagement_id === KESTREL_ENGAGEMENT).founder_name, 'Kestrel Founder');
  db.prepare('DELETE FROM users WHERE id IN (801, 802)').run();
  assert.equal((await reportsOf(e)).items.find((r: any) => r.engagement_id === KESTREL_ENGAGEMENT).founder_name, 'Kestrel Founder', 'no account at all');
});

test('the composition names its engagement and period, and a save must match them', async () => {
  const db = world();
  const e = env(db);
  const p = nowPeriod();
  const draft = (await call(e, 'GET', `/engagements/${KESTREL_ENGAGEMENT}/report-draft/${p}`, ours)).body;
  assert.deepEqual([draft.engagement_id, draft.period], [KESTREL_ENGAGEMENT, p]);
  // A draft composed for one engagement, saved into another: refused, nothing written.
  // Mutation checked: drop the identity check in the PUT -> 200 and a row on OUR_ENGAGEMENT, and this fails.
  const wrongEngagement = await save(e, OUR_ENGAGEMENT, p, { engagement_id: KESTREL_ENGAGEMENT, period: p, shipped: 'Kestrel words' });
  assert.deepEqual([wrongEngagement.status, wrongEngagement.body.code], [409, 'draft_mismatch']);
  const wrongPeriod = await save(e, KESTREL_ENGAGEMENT, p, { engagement_id: KESTREL_ENGAGEMENT, period: '2020-01', shipped: 'x' });
  assert.equal(wrongPeriod.status, 409);
  const anonymous = await save(e, KESTREL_ENGAGEMENT, p, { shipped: 'x' });
  assert.equal(anonymous.status, 409, 'a save that names no draft is refused too');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_status_reports').get() as any).n, 0, 'nothing was written');
  const ok = await save(e, KESTREL_ENGAGEMENT, p, { engagement_id: KESTREL_ENGAGEMENT, period: p, shipped: 'Kestrel words' });
  assert.equal(ok.status, 200);
});

test('another firm cannot compose or save on this engagement', async () => {
  const e = env(world());
  const p = nowPeriod();
  assert.equal((await call(e, 'GET', `/engagements/${KESTREL_ENGAGEMENT}/report-draft/${p}`, theirs)).status, 404);
  assert.equal((await call(e, 'PUT', `/engagements/${KESTREL_ENGAGEMENT}/status-reports/${p}`, theirs, { engagement_id: KESTREL_ENGAGEMENT, period: p, shipped: 'x' })).status, 404);
});

test('guard: Delivery and Pipeline never join a founder id to a user id', () => {
  for (const f of ['partner_delivery', 'partner_pipeline']) {
    const src = readFileSync(resolve(HERE, `../src/routes/${f}.ts`), 'utf8');
    assert.equal(/JOIN\s+users\s+(\w+)\s+ON\s+\1\.id\s*=\s*\w+\.founder_id/.test(src), false, `${f}.ts joins users on founder_id`);
  }
});
