/**
 * D6202 (#6202) — the support ledger's lifecycle: a due date, promised -> in_progress -> delivered or -> cancelled,
 * an introduction's meeting, and the totals that count them. The real router over node:sqlite, on the ledger's
 * tables as the migrations build them (`_support_ledger_schema.mjs`: 237, D4642, D6202). Every identity is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/support_lifecycle_6202.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import support from '../src/routes/portfolio_support.ts';
import { applySupportLedgerSchema } from './_support_ledger_schema.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MINE = 41;      // the member who recorded the entries
const COLLEAGUE = 46; // a second member with the same book
const OTHER = 42;     // a member whose book is PROJ_B
const PROJ_A = 7;
const PROJ_B = 8;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const runSync = () => {
        const r = db.prepare(sql).run(...b);
        return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      };
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { return runSync(); },
        runSync,
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      const list = x || [];
      db.exec('SAVEPOINT support_batch');
      try {
        const out = list.map((s) => s.runSync());
        db.exec('RELEASE support_batch');
        return out;
      } catch (e) {
        db.exec('ROLLBACK TO support_batch');
        db.exec('RELEASE support_batch');
        throw e;
      }
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT,
      investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT, partner_id INTEGER
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, is_primary_admin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, sector TEXT, stage TEXT,
      status TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER);
    CREATE TABLE investor_dealroom_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, investor_user_id INTEGER,
      deal_id INTEGER, company_id INTEGER
    );
    CREATE TABLE investor_introductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, investor_user_id INTEGER,
      project_id INTEGER, status TEXT, quarter TEXT, company_id INTEGER
    );
    CREATE TABLE watchlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER,
      converted_deal_id INTEGER, company_id INTEGER
    );
    CREATE TABLE portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, fund_id INTEGER,
      project_id INTEGER NOT NULL, round_name TEXT, invested_amount REAL
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  // D6202: the ledger's tables from the real migrations (237, D4642, D6202), not a copy of their DDL.
  applySupportLedgerSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, investor_tier, name) VALUES (?, ?, ?, ?)');
  u.run(MINE, 'investor', 'institutional', 'Mine');
  u.run(COLLEAGUE, 'investor', 'institutional', 'Colleague');
  u.run(OTHER, 'investor', 'institutional', 'Other');

  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)');
  p.run(PROJ_A, 'p-alpha', 'Alpha', 1);
  p.run(PROJ_B, 'p-beta', 'Beta', 2);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(71, 'd-a', PROJ_A);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(72, 'd-b', PROJ_B);
  const m = db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)');
  m.run(MINE, 71);
  m.run(COLLEAGUE, 71); // the same book, so a race between the two is possible
  m.run(OTHER, 72);
  const pos = db.prepare('INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount) VALUES (?, ?, ?, ?)');
  pos.run('pos-a', PROJ_A, 'Seed', 500000);
  pos.run('pos-b', PROJ_B, 'Seed', 400000);

  const e = db.prepare(
    `INSERT INTO portfolio_support_entries (uid, project_id, kind, state, hours, summary, outcome, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  e.run('sup-a', PROJ_A, 'intro', 'promised', null, 'Promised an intro to a buyer at Northwind', null, MINE);
  e.run('sup-done', PROJ_A, 'hiring', 'delivered', 2, 'Sat in on two VP Eng loops', 'Offer accepted', MINE);
  e.run('sup-b', PROJ_B, 'board_prep', 'promised', null, 'The other firm’s work', null, OTHER);
  return db;
}

const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });
async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(db: any, user: number, path: string, init: any = {}) {
  const jwt = await token(user, 'investor');
  return support.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) },
    }),
    env(db),
  );
}
const patch = (db: any, user: number, uid: string, body: unknown) =>
  call(db, user, `/${uid}`, { method: 'PATCH', body: JSON.stringify(body) });
const rowOf = (db: any, uid: string) =>
  db.prepare('SELECT * FROM portfolio_support_entries WHERE uid = ?').get(uid) as any;
const eventsOf = (db: any, uid: string) => db.prepare(
  `SELECT e.* FROM portfolio_support_entry_events e
     JOIN portfolio_support_entries s ON s.id = e.entry_id
    WHERE s.uid = ? ORDER BY e.revision`,
).all(uid) as any[];

const post = (db: any, user: number, body: unknown) => call(db, user, '/', { method: 'POST', body: JSON.stringify(body) });
const count = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM portfolio_support_entries').get() as any).n);
const totals = async (db: any) => ((await (await call(db, MINE, '/')).json()) as any).totals;

test('a promise moves promised -> in_progress -> delivered, each move recorded with its actor', async () => {
  // Mutation checked: 'in_progress' dropped from SUPPORT_STATES → the first move is refused 400.
  const db = freshDb();
  const started = await patch(db, MINE, 'sup-a', { state: 'in_progress', expected_revision: 1 });
  assert.equal(started.status, 200, await started.clone().text());
  assert.equal(rowOf(db, 'sup-a').state, 'in_progress');
  const done = await patch(db, COLLEAGUE, 'sup-a', { state: 'delivered', expected_revision: 2 });
  assert.equal(done.status, 200);
  const row = rowOf(db, 'sup-a');
  assert.equal(row.state, 'delivered');
  assert.ok(row.delivered_at, 'delivering stamps its date');
  assert.deepEqual(eventsOf(db, 'sup-a').map((e) => [e.action, e.from_state, e.to_state, e.actor_user_id]),
    [['in_progress', 'promised', 'in_progress', MINE], ['delivered', 'in_progress', 'delivered', COLLEAGUE]]);
});

test('cancelling stamps its date and is terminal', async () => {
  // Mutation checked: removing 'cancelled' from the terminal rule (OPEN_STATES) lets the delivery below land.
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-a', { state: 'cancelled', expected_revision: 1 });
  assert.equal(res.status, 200);
  const row = rowOf(db, 'sup-a');
  assert.equal(row.state, 'cancelled');
  assert.ok(row.cancelled_at, 'cancelling stamps its own date');
  assert.deepEqual(eventsOf(db, 'sup-a').map((e) => [e.action, e.to_state]), [['cancelled', 'cancelled']]);
  const again = await patch(db, MINE, 'sup-a', { state: 'delivered', expected_revision: 2 });
  assert.equal(again.status, 409);
  assert.equal((await again.json() as any).code, 'state_is_terminal');
  assert.equal(rowOf(db, 'sup-a').state, 'cancelled');
});

test('in progress never moves back to promised', async () => {
  // Mutation checked: dropping the cannot_reopen refusal → 200 and the entry reads promised again.
  const db = freshDb();
  await patch(db, MINE, 'sup-a', { state: 'in_progress', expected_revision: 1 });
  const back = await patch(db, MINE, 'sup-a', { state: 'promised', expected_revision: 2 });
  assert.equal(back.status, 409);
  const body = await back.json() as any;
  assert.equal(body.code, 'cannot_reopen');
  assert.match(body.detail, /cannot move back to promised/);
  assert.equal(rowOf(db, 'sup-a').state, 'in_progress');
  assert.equal(eventsOf(db, 'sup-a').length, 1, 'the refused move wrote no history');
});

test('a lifecycle move on a stale revision is refused and the newer work is handed back', async () => {
  const db = freshDb();
  await patch(db, COLLEAGUE, 'sup-a', { state: 'in_progress', expected_revision: 1 });
  const stale = await patch(db, MINE, 'sup-a', { state: 'cancelled', expected_revision: 1 });
  assert.equal(stale.status, 409);
  const body = await stale.json() as any;
  assert.equal(body.code, 'changed_since_open');
  assert.equal(body.item.state, 'in_progress', 'the colleague\'s move is what comes back');
  assert.equal(rowOf(db, 'sup-a').state, 'in_progress');
});

test('logging: a due date is kept, in progress opens, and cancelled or a malformed date is refused with nothing written', async () => {
  // Mutation checked: lifecycleFields dropping a malformed due_date instead of refusing → 201 with no due date.
  const db = freshDb();
  const ok = await post(db, MINE, { project_uid: 'p-alpha', kind: 'customer', state: 'in_progress', summary: 'Two buyer calls', due_date: '2026-12-01' });
  assert.equal(ok.status, 201, await ok.clone().text());
  const item = (await ok.json() as any).item;
  assert.equal(item.state, 'in_progress');
  assert.equal(item.due_date, '2026-12-01');
  const before = count(db);
  for (const [body, pattern] of [
    [{ project_uid: 'p-alpha', summary: 'Cancelled at birth', state: 'cancelled' }, /cannot be logged as already cancelled/],
    [{ project_uid: 'p-alpha', summary: 'Bad date', due_date: 'next week' }, /due_date must be a date/],
    [{ project_uid: 'p-alpha', summary: 'Not a day', due_date: '2026-02-30' }, /due_date must be a date/],
    [{ project_uid: 'p-alpha', kind: 'hiring', summary: 'A hire with a meeting', meeting_outcome: 'held' }, /Only an introduction records a meeting/],
    [{ project_uid: 'p-alpha', kind: 'intro', summary: 'Odd outcome', meeting_outcome: 'maybe' }, /meeting_outcome must be held or not_held/],
  ] as const) {
    const res = await post(db, MINE, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(String((await res.json() as any).detail), pattern);
  }
  assert.equal(count(db), before, 'no refused body wrote a row');
});

test('an introduction records that its meeting happened, and when; another kind cannot', async () => {
  // Mutation checked: the intro-only rule removed → the hiring entry below records a meeting.
  const db = freshDb();
  const res = await patch(db, MINE, 'sup-a', { meeting_outcome: 'held', meeting_at: '2026-11-10', expected_revision: 1 });
  assert.equal(res.status, 200, await res.clone().text());
  const row = rowOf(db, 'sup-a');
  assert.equal(row.meeting_outcome, 'held');
  assert.equal(row.meeting_at, '2026-11-10');
  assert.equal(row.state, 'promised', 'recording the meeting moves no state');
  const [event] = eventsOf(db, 'sup-a');
  assert.equal(event.action, 'amended');
  assert.deepEqual(JSON.parse(event.changed_json).sort(), ['meeting_at', 'meeting_outcome']);
  const hire = await patch(db, MINE, 'sup-done', { meeting_outcome: 'held' });
  assert.equal(hire.status, 400);
  assert.equal(rowOf(db, 'sup-done').meeting_outcome, null);
});

test('the totals count in progress, cancelled, outstanding, overdue on the Worker\'s date, and each kind', async () => {
  // Mutation checked: the overdue CASE without its open-state test counts the delivered and cancelled entries
  // with a past due date, and this fails.
  const db = freshDb();
  // Past and far-future due dates, so the test does not depend on today's date.
  db.prepare("UPDATE portfolio_support_entries SET due_date = '2000-01-01' WHERE uid = 'sup-a'").run(); // open, past due
  db.prepare("UPDATE portfolio_support_entries SET due_date = '2000-01-01' WHERE uid = 'sup-done'").run(); // delivered, past due
  const e = db.prepare(`INSERT INTO portfolio_support_entries (uid, project_id, kind, state, summary, recorded_by, due_date, meeting_outcome)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  e.run('sup-future', PROJ_A, 'customer', 'in_progress', 'Due later', MINE, '2999-12-31', null);
  e.run('sup-none', PROJ_A, 'customer', 'in_progress', 'No due date', MINE, null, null);
  e.run('sup-cancel', PROJ_A, 'other', 'cancelled', 'Called off', MINE, '2000-01-01', null);
  e.run('sup-intro', PROJ_A, 'intro', 'delivered', 'Intro made', MINE, null, 'held');
  const t = await totals(db);
  assert.equal(t.promised, 1);
  assert.equal(t.in_progress, 2);
  assert.equal(t.cancelled, 1);
  assert.equal(t.delivered, 2);
  assert.equal(t.outstanding, 3, 'promised plus in progress');
  assert.equal(t.overdue, 1, 'only the open entry past its due date; never a delivered, cancelled or undated one');
  assert.match(t.overdue_basis, /Worker's date/);
  assert.deepEqual(t.by_kind.intro, { entries: 2, delivered: 1, outstanding: 1, meetings_held: 1 }, 'Introductions made is counted');
  assert.equal(t.by_kind.customer.outstanding, 2);
  assert.equal(t.by_kind.fundraising.entries, 0, 'a kind with no entries reads 0, not missing');
  // The state filter reaches each new state, and its page total matches.
  const page = await (await call(db, MINE, '/?state=in_progress')).json() as any;
  assert.deepEqual(page.entries.map((x: any) => x.uid).sort(), ['sup-future', 'sup-none']);
  assert.equal(page.page.matching_total, 2);
});

test('existing rows read unchanged: their states stand and the new fields are empty', async () => {
  const db = freshDb();
  const body = await (await call(db, MINE, '/')).json() as any;
  const done = body.entries.find((x: any) => x.uid === 'sup-done');
  assert.equal(done.state, 'delivered');
  for (const field of ['due_date', 'meeting_outcome', 'meeting_at', 'cancelled_at']) assert.equal(done[field], null, field);
  assert.equal(body.totals.overdue, 0, 'no entry has a due date, so none is overdue');
});
