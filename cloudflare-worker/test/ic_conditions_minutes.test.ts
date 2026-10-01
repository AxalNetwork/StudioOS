/**
 * D461 — IC conditions, a recused vote, and meeting minutes.
 *
 * Three stores the ID3 artboard draws that the IC record did not hold:
 *
 *   RECUSAL. `ic_votes.vote` carries no CHECK, so `recused` joins the
 *   vocabulary at the vote endpoint — with the declaration required as its
 *   rationale. The tally counts recusals BESIDE the denominator, never in
 *   it, and the decision-journal auto-draft excludes a recusal (it is not a
 *   decision), removing the old vote's shadow draft when it carries nothing
 *   hand-written.
 *
 *   CONDITIONS. `ic_conditions` (migration 334): one row per condition on a
 *   decision, open | met | waived. Anyone who may see the decision may add
 *   one; the decision's author or an admin resolves one.
 *
 *   MINUTES. Three columns on `ic_meetings`: the text, who recorded it, when.
 *   The organiser or an admin writes them; the commit room reads them through
 *   the meeting linked to the current decision's deal.
 *
 * Harness matches ic_company_scope.test.ts: the real router against in-memory
 * SQLite with a signed JWT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import ic from '../src/routes/ic.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const AUTHOR = 10;
const COLLEAGUE = 11;
const ADMIN = 12;
const CO = 21;
const PROJ = 7;
const DEAL = 71;
const DEC = 'dec-alpha';
const MTG = 'mtg-alpha';

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
    async batch(x: any[]) { return x; },
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
      user_id INTEGER NOT NULL, is_primary_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, sector TEXT, stage TEXT,
      status TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER);
    CREATE TABLE ic_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER, deal_id INTEGER, title TEXT NOT NULL, memo TEXT,
      terms_json TEXT, status TEXT NOT NULL DEFAULT 'draft', decision TEXT,
      outcome TEXT, created_by INTEGER, decided_at TEXT, dd_case_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      company_id INTEGER
    );
    CREATE TABLE ic_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ic_decision_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, vote TEXT NOT NULL, rationale TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ic_decision_id, user_id)
    );
    CREATE TABLE decision_journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, owner_user_id INTEGER,
      project_id INTEGER, deal_id INTEGER, ic_decision_id INTEGER,
      decision TEXT, conviction TEXT, thesis TEXT, outcome_status TEXT,
      decided_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE ic_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      ic_decision_id INTEGER NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT, resolved_by INTEGER
    );
    CREATE TABLE ic_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, agenda TEXT, start_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 60, deal_id INTEGER,
      organizer_user_id INTEGER NOT NULL, location_kind TEXT NOT NULL DEFAULT 'video',
      location_uri TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
      cancelled_at TEXT, cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      minutes TEXT, minutes_recorded_by INTEGER, minutes_recorded_at TEXT
    );
    CREATE TABLE ic_meeting_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, rsvp TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(meeting_id, user_id)
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(AUTHOR, 'investor', 'Ann Author');
  u.run(COLLEAGUE, 'investor', 'Col Colleague');
  u.run(ADMIN, 'admin', 'Ada Admin');
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(CO, AUTHOR);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(CO, COLLEAGUE);
  db.prepare('INSERT INTO projects (id, uid, name) VALUES (?, ?, ?)').run(PROJ, 'p-alpha', 'Alpha');
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(DEAL, 'd-alpha', PROJ);
  db.prepare(
    `INSERT INTO ic_decisions (uid, project_id, deal_id, title, status, created_by, company_id)
     VALUES (?, ?, ?, ?, 'voting', ?, ?)`,
  ).run(DEC, PROJ, DEAL, 'Alpha — IC review', AUTHOR, CO);
  db.prepare(
    `INSERT INTO ic_meetings (uid, title, start_at, deal_id, organizer_user_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(MTG, 'Alpha IC', '2026-09-20 15:00', DEAL, AUTHOR);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

type Who = { user: number; role: string };
const author = { user: AUTHOR, role: 'investor' };
const colleague = { user: COLLEAGUE, role: 'investor' };

async function call(
  who: Who,
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await ic.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

// ── Recusal ────────────────────────────────────────────────────────────────

test('a recusal without its declaration is refused with the code, not a tally entry', async () => {
  const r = await call(colleague, `/${DEC}/vote`, { method: 'POST', body: { vote: 'recused' } });
  assert.equal(r.status, 400);
  assert.equal(r.body?.error, 'recusal_requires_declaration');
  assert.match(String(r.body?.message || ''), /conflict/);
  // And nothing was written: no vote, no tally entry.
  const tally = r.db.prepare('SELECT COUNT(*) AS n FROM ic_votes').get() as any;
  assert.equal(tally.n, 0);
});

test('a recused vote is counted beside the denominator, never in it', async () => {
  const db = freshDb();
  await call(author, `/${DEC}/vote`, { method: 'POST', body: { vote: 'yes', rationale: 'team' } }, db);
  await call(colleague, `/${DEC}/vote`, { method: 'POST', body: { vote: 'recused', rationale: 'angel in the company' } }, db);
  const detail = await call(author, `/${DEC}`, {}, db);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.tally, { yes: 1, no: 0, abstain: 0, recused: 1 },
    'the recusal leaves the yes/no/abstain denominator and is reported beside it');
  const recused = detail.body.votes.find((v: any) => v.vote === 'recused');
  assert.equal(recused.rationale, 'angel in the company', 'the declaration travels with the vote');
});

test('the journal excludes a recusal, and drops the old vote’s shadow draft', async () => {
  const db = freshDb();
  // Vote yes first: the auto-draft lands with the fallback thesis.
  await call(author, `/${DEC}/vote`, { method: 'POST', body: { vote: 'yes' } }, db);
  let rows = db.prepare('SELECT decision, thesis FROM decision_journal_entries').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'invest');
  // Recuse: the draft was the old vote's shadow and carries nothing
  // hand-written, so it goes rather than keep claiming `invest`.
  await call(author, `/${DEC}/vote`, { method: 'POST', body: { vote: 'recused', rationale: 'declared conflict' } }, db);
  rows = db.prepare('SELECT decision, thesis FROM decision_journal_entries').all() as any[];
  assert.equal(rows.length, 0, 'a recusal must not leave a journal row claiming a decision');
});

test('a recusal keeps the voter’s own words and re-marks the draft other', async () => {
  const db = freshDb();
  // A rationale long enough becomes the draft's thesis — the voter's words.
  await call(author, `/${DEC}/vote`, { method: 'POST', body: { vote: 'yes', rationale: 'my written conviction' } }, db);
  await call(author, `/${DEC}/vote`, { method: 'POST', body: { vote: 'recused', rationale: 'declared conflict' } }, db);
  const rows = db.prepare('SELECT decision, thesis FROM decision_journal_entries').all() as any[];
  assert.equal(rows.length, 1, 'the voter’s own words are kept');
  assert.equal(rows[0].decision, 'other', 'but the ledger stops claiming invest');
  assert.equal(rows[0].thesis, 'my written conviction');
});

// ── Conditions ─────────────────────────────────────────────────────────────

test('a condition is added by anyone who may see the decision, and listed in scope', async () => {
  const db = freshDb();
  const added = await call(colleague, `/${DEC}/conditions`, { method: 'POST', body: { body: 'IP chain of title' } }, db);
  assert.equal(added.status, 201);
  assert.equal(added.body?.item?.status, 'open');
  assert.equal(added.body?.item?.created_by_name, 'Col Colleague');

  const list = await call(author, '/conditions?status=open', {}, db);
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].body, 'IP chain of title');
  assert.equal(list.body.items[0].deal_id, DEAL, 'the condition carries the deal it could block');
  assert.equal(list.body.items[0].decision_title, 'Alpha — IC review');
});

test('a condition needs its text', async () => {
  const r = await call(author, `/${DEC}/conditions`, { method: 'POST', body: { body: '  ' } });
  assert.equal(r.status, 400);
  assert.equal(r.body?.error, 'condition_body_required');
});

test('resolving is the author’s or an admin’s act, and stamps who and when', async () => {
  const db = freshDb();
  const added = await call(colleague, `/${DEC}/conditions`, { method: 'POST', body: { body: 'IP chain of title' } }, db);
  const uid = added.body.item.uid;

  // The colleague who PROPOSED it may not resolve it.
  const denied = await call(colleague, `/conditions/${uid}`, { method: 'PATCH', body: { status: 'met' } }, db);
  assert.equal(denied.status, 403);

  const done = await call(author, `/conditions/${uid}`, { method: 'PATCH', body: { status: 'met' } }, db);
  assert.equal(done.status, 200);
  assert.equal(done.body.item.status, 'met');
  assert.equal(done.body.item.resolved_by_name, 'Ann Author');
  assert.ok(done.body.item.resolved_at, 'the resolution is stamped');

  // An invalid state is a refusal, not a write.
  const bad = await call(author, `/conditions/${uid}`, { method: 'PATCH', body: { status: 'done' } }, db);
  assert.equal(bad.status, 400);
  assert.equal(bad.body?.error, 'condition_status_invalid');
});

test('the commit room reports conditions and the recusal count from the record', async () => {
  const db = freshDb();
  await call(colleague, `/${DEC}/conditions`, { method: 'POST', body: { body: 'IP chain of title' } }, db);
  await call(colleague, `/${DEC}/vote`, { method: 'POST', body: { vote: 'recused', rationale: 'angel in the company' } }, db);
  const room = await call(author, '/commit-room', {}, db);
  assert.equal(room.status, 200);
  assert.equal(room.body.conditions.available, true);
  assert.equal(room.body.conditions.rows.length, 1);
  assert.equal(room.body.conditions.rows[0].body, 'IP chain of title');
  assert.equal(room.body.recusal.available, true);
  assert.equal(room.body.recusal.recused, 1);
  assert.equal(room.body.current.conditions.open, 1, 'the current decision carries its open count');
});

// ── Minutes ────────────────────────────────────────────────────────────────

test('minutes are written by the organiser or an admin, and read in the commit room', async () => {
  const db = freshDb();
  // A colleague who did not organise the meeting may not write its minutes.
  const denied = await call(colleague, `/meetings/${MTG}/minutes`, { method: 'PATCH', body: { minutes: 'the room concluded…' } }, db);
  assert.equal(denied.status, 403);

  const written = await call(author, `/meetings/${MTG}/minutes`, {
    method: 'PATCH',
    body: { minutes: 'Approved with one condition: IP chain of title.' },
  }, db);
  assert.equal(written.status, 200);
  assert.equal(written.body.item.minutes_recorded_by_name, 'Ann Author');

  const room = await call(colleague, '/commit-room', {}, db);
  assert.equal(room.body.minutes.available, true);
  assert.equal(room.body.minutes.recorded, true);
  assert.match(room.body.minutes.minutes, /IP chain of title/);
  assert.equal(room.body.minutes.may_record, false, 'a reader who is not the organiser may not rewrite them');
});

test('an unrecorded minutes state is reported, not an absent store', async () => {
  const room = await call(author, '/commit-room');
  assert.equal(room.body.minutes.available, true, 'the meeting is linked, so the store answers');
  assert.equal(room.body.minutes.recorded, false, 'no minutes are recorded yet — a state, not a gap');
});
