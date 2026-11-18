/**
 * D6143 (#6143) — an IC decision's voting roster, and the condition owner.
 *
 * `ic_decision_voters` (migration 202611180056_6143) holds who may vote on a
 * decision. The author picks the voters, from the firm's Investor licence
 * holders (owner answer Q4 A, D6153-p2). This file proves the issue's
 * acceptance:
 *
 *   · scope: another firm cannot read or edit a roster, or be put on one;
 *   · arithmetic: a recusal leaves the denominator, an abstention stays in it;
 *   · legacy decisions: no roster reads eligible null with a reason, never 0,
 *     and anyone who may see the decision still votes;
 *   · owners: a condition's owner round-trips;
 *   · enforcement: where a roster exists, a member off it is refused a vote.
 *
 * The schema is the real one: the baseline plus every migration, this one
 * included (`_schema_once.mjs`). The D1 stub's batch runs its statements in
 * one SQLite transaction, as D1 does. Every name below is invented; addresses
 * are on synthetic.invalid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import ic, { rosterSummary } from '../src/routes/ic.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const AUTHOR = 10;
const COLLEAGUE = 11;
const ADMIN = 12;
const PARTNER = 13;   // in the firm, holds the Partner licence only
const MEMBER_C = 14;
const MEMBER_D = 15;
const MEMBER_E = 16;
const OUTSIDER = 30;  // an investor at another firm
const FIRM = 21;
const OTHER_FIRM = 22;
const DEC = 'dec-6143-a';
const LEGACY = 'dec-6143-legacy';
const NO_FIRM = 'dec-6143-nofirm';

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
        runSync() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
        async run() { return api.runSync(); },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // As D1: the statements run in order inside one transaction, all or none.
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(AUTHOR, 'investor', 'Ann Author', 'ann@synthetic.invalid');
  u.run(COLLEAGUE, 'investor', 'Col Colleague', 'col@synthetic.invalid');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@synthetic.invalid');
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@synthetic.invalid');
  u.run(MEMBER_C, 'investor', 'Cy Member', 'cy@synthetic.invalid');
  u.run(MEMBER_D, 'investor', 'Di Member', 'di@synthetic.invalid');
  u.run(MEMBER_E, 'investor', 'Ed Member', 'ed@synthetic.invalid');
  u.run(OUTSIDER, 'investor', 'Oz Outsider', 'oz@synthetic.invalid');
  const link = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)');
  for (const id of [AUTHOR, COLLEAGUE, PARTNER, MEMBER_C, MEMBER_D, MEMBER_E]) link.run(`ucl-${id}`, FIRM, id);
  link.run(`ucl-${OUTSIDER}`, OTHER_FIRM, OUTSIDER);
  const dec = db.prepare(
    `INSERT INTO ic_decisions (uid, title, status, created_by, company_id, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
  );
  dec.run(LEGACY, 'Legacy decision', AUTHOR, FIRM, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z');
  dec.run(DEC, 'Rostered decision', AUTHOR, FIRM, '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z');
  dec.run(NO_FIRM, 'No-firm decision', AUTHOR, null, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

type Who = { user: number; role: string };
const author: Who = { user: AUTHOR, role: 'investor' };
const colleague: Who = { user: COLLEAGUE, role: 'investor' };
const admin: Who = { user: ADMIN, role: 'admin' };
const outsider: Who = { user: OUTSIDER, role: 'investor' };
const as = (id: number): Who => ({ user: id, role: 'investor' });

async function call(
  db: InstanceType<typeof DatabaseSync>, who: Who, path: string,
  init: { method?: string; body?: any; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await ic.request(path, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${await token(who.user, who.role)}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  return { status: res.status, body: await res.json().catch(() => null) };
}
const vote = (db: any, who: Who, uid: string, v: string) =>
  call(db, who, `/${uid}/vote`, { method: 'POST', body: { vote: v, rationale: `Reason for ${v}` } });
const rosterRows = (db: any, uid: string) => db.prepare(
  `SELECT dv.user_id FROM ic_decision_voters dv JOIN ic_decisions d ON d.id = dv.ic_decision_id
    WHERE d.uid = ? ORDER BY dv.user_id`,
).all(uid).map((r: any) => Number(r.user_id));
const roomRow = (body: any, uid: string) => body?.decisions?.rows?.find((r: any) => r.uid === uid);

// ── Migration ──────────────────────────────────────────────────────────────

test('the migration creates ic_decision_voters with the pair unique and added_at defaulted', () => {
  const db = freshDb();
  const cols = Object.fromEntries((db.prepare('PRAGMA table_info(ic_decision_voters)').all() as any[])
    .map((c) => [c.name, { notnull: c.notnull, dflt: c.dflt_value }]));
  assert.deepEqual(Object.keys(cols).sort(), ['added_at', 'added_by', 'ic_decision_id', 'id', 'user_id']);
  assert.equal(cols.ic_decision_id.notnull, 1);
  assert.equal(cols.user_id.notnull, 1);
  assert.equal(cols.added_by.notnull, 1);
  assert.match(String(cols.added_at.dflt), /datetime\('now'\)/);
  const ins = db.prepare('INSERT INTO ic_decision_voters (ic_decision_id, user_id, added_by) VALUES (1, ?, ?)');
  ins.run(AUTHOR, AUTHOR);
  assert.throws(() => ins.run(AUTHOR, ADMIN), /UNIQUE/);
  // The condition owner the issue names came with D6156; nothing re-adds it.
  const condCols = (db.prepare('PRAGMA table_info(ic_conditions)').all() as any[]).map((c) => c.name);
  assert.ok(condCols.includes('owner_user_id') && condCols.includes('owner_label'));
});

// ── Legacy decisions ───────────────────────────────────────────────────────

test('a decision with no roster reads eligible null with a reason, never 0, from both reads', async () => {
  const db = freshDb();
  const detail = await call(db, author, `/${LEGACY}`);
  assert.equal(detail.status, 200);
  const r = detail.body.roster;
  assert.equal(r.available, false);
  for (const k of ['eligible', 'voted', 'recused', 'to_vote', 'counted', 'not_voted']) {
    assert.equal(r[k], null, `${k} must be null without a roster, not ${JSON.stringify(r[k])}`);
  }
  assert.match(String(r.reason), /No voting roster is set/);
  const room = await call(db, author, '/commit-room');
  assert.equal(room.status, 200);
  const row = roomRow(room.body, LEGACY);
  assert.ok(row, 'the legacy decision is in the commit room');
  assert.equal(row.roster.available, false);
  assert.equal(row.roster.eligible, null);
  assert.match(String(row.roster.reason), /No voting roster is set/);
});

test('legacy decisions keep working: with no roster, anyone who may see the decision votes', async () => {
  const db = freshDb();
  const v = await vote(db, colleague, LEGACY, 'yes');
  assert.equal(v.status, 200);
  assert.equal(v.body.tally.yes, 1);
});

// ── Arithmetic ─────────────────────────────────────────────────────────────

test('rosterSummary: a recusal leaves the denominator, an abstention stays in it', () => {
  const voters = [AUTHOR, COLLEAGUE, MEMBER_C, MEMBER_D].map((id) => ({ user_id: id, name: `N${id}`, added_by: AUTHOR, added_at: 't' }));
  const s = rosterSummary(voters, [
    { user_id: AUTHOR, vote: 'yes' },
    { user_id: COLLEAGUE, vote: 'abstain' },
    { user_id: MEMBER_C, vote: 'recused' },
  ]);
  assert.equal(s.eligible, 4);
  assert.equal(s.voted, 2, 'an abstention is a vote cast');
  assert.equal(s.recused, 1);
  assert.equal(s.to_vote, 1);
  assert.equal(s.counted, 3, 'the denominator is eligible less recused, abstention included');
  assert.deepEqual(s.not_voted, [{ user_id: MEMBER_D, name: `N${MEMBER_D}` }]);
  assert.equal(s.off_roster, 0);
});

test('a rostered decision returns eligible, voted, recused, to vote and the not-voted names from /:uid and /commit-room', async () => {
  const db = freshDb();
  const set = await call(db, author, `/${DEC}/roster`, {
    method: 'PUT', body: { user_ids: [AUTHOR, COLLEAGUE, MEMBER_C, MEMBER_D, MEMBER_E] },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await vote(db, author, DEC, 'yes')).status, 200);
  assert.equal((await vote(db, colleague, DEC, 'abstain')).status, 200);
  assert.equal((await vote(db, as(MEMBER_C), DEC, 'recused')).status, 200);
  assert.equal((await vote(db, as(MEMBER_D), DEC, 'no')).status, 200);

  const detail = await call(db, colleague, `/${DEC}`);
  assert.equal(detail.status, 200);
  const room = await call(db, colleague, '/commit-room');
  for (const r of [detail.body.roster, roomRow(room.body, DEC).roster]) {
    assert.equal(r.available, true);
    assert.equal(r.eligible, 5);
    assert.equal(r.voted, 3, 'yes, abstain and no are votes cast');
    assert.equal(r.recused, 1);
    assert.equal(r.to_vote, 1);
    assert.equal(r.counted, 4, 'a recusal leaves the denominator, an abstention stays');
    assert.deepEqual(r.not_voted, [{ user_id: MEMBER_E, name: 'Ed Member' }]);
    assert.equal(r.members.length, 5);
  }
});

// ── Roster enforcement ─────────────────────────────────────────────────────

test('where a roster exists, a member off it is refused a vote and a recusal, and nothing is written', async () => {
  const db = freshDb();
  assert.equal((await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [AUTHOR] } })).status, 200);
  for (const v of ['yes', 'recused']) {
    const r = await vote(db, colleague, DEC, v);
    assert.equal(r.status, 403);
    assert.equal(r.body?.error, 'not_on_roster');
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ic_votes').get() as any).n, 0);
  const ok = await vote(db, author, DEC, 'yes');
  assert.equal(ok.status, 200);
});

test('a roster may be picked when opening the decision', async () => {
  const db = freshDb();
  const r = await call(db, author, '/', {
    method: 'POST', body: { title: 'Opened with voters', voter_user_ids: [AUTHOR, MEMBER_C] },
    headers: { 'X-Company-Id': String(FIRM) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.roster.eligible, 2);
  assert.deepEqual(rosterRows(db, r.body.uid), [AUTHOR, MEMBER_C]);
  const refused = await vote(db, colleague, r.body.uid, 'yes');
  assert.equal(refused.status, 403);
});

test('only the firm’s Investor licence holders go on a roster, and a voter stays on it', async () => {
  const db = freshDb();
  const partner = await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [AUTHOR, PARTNER] } });
  assert.equal(partner.status, 400);
  assert.equal(partner.body?.error, 'roster_voter_not_eligible');
  assert.deepEqual(partner.body?.user_ids, [PARTNER]);
  assert.equal((await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [] } })).body?.error, 'roster_invalid');
  const noFirm = await call(db, author, `/${NO_FIRM}/roster`, { method: 'PUT', body: { user_ids: [AUTHOR] } });
  assert.equal(noFirm.status, 409);
  assert.equal(noFirm.body?.error, 'roster_needs_firm');
  // A refused open writes no decision.
  const before = (db.prepare('SELECT COUNT(*) AS n FROM ic_decisions').get() as any).n;
  const open = await call(db, author, '/', {
    method: 'POST', body: { title: 'Refused', voter_user_ids: [PARTNER] }, headers: { 'X-Company-Id': String(FIRM) },
  });
  assert.equal(open.body?.error, 'roster_voter_not_eligible');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ic_decisions').get() as any).n, before);

  assert.equal((await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [AUTHOR, COLLEAGUE] } })).status, 200);
  assert.equal((await vote(db, colleague, DEC, 'no')).status, 200);
  const drop = await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [AUTHOR] } });
  assert.equal(drop.status, 409);
  assert.equal(drop.body?.error, 'roster_omits_voter');
  assert.deepEqual(rosterRows(db, DEC), [AUTHOR, COLLEAGUE]);
  // Editing swaps members in and out, keeping the voter.
  const edit = await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [COLLEAGUE, MEMBER_D] } });
  assert.equal(edit.status, 200);
  assert.deepEqual(rosterRows(db, DEC), [COLLEAGUE, MEMBER_D]);
});

test('only the author or an Admin sets the roster; a colleague reads it without the candidates', async () => {
  const db = freshDb();
  const r = await call(db, colleague, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [COLLEAGUE] } });
  assert.equal(r.status, 403);
  assert.deepEqual(rosterRows(db, DEC), []);
  const read = await call(db, colleague, `/${DEC}/roster`);
  assert.equal(read.status, 200);
  assert.equal(read.body.may_edit, false);
  assert.equal(read.body.candidates, null);
  const mine = await call(db, author, `/${DEC}/roster`);
  assert.deepEqual(mine.body.candidates.map((m: any) => m.user_id).sort(), [AUTHOR, COLLEAGUE, MEMBER_C, MEMBER_D, MEMBER_E]);
  const byAdmin = await call(db, admin, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [MEMBER_C] } });
  assert.equal(byAdmin.status, 200);
  assert.deepEqual(rosterRows(db, DEC), [MEMBER_C]);
});

// ── Scope ──────────────────────────────────────────────────────────────────

test('another firm cannot read or edit a roster, or be put on one', async () => {
  const db = freshDb();
  assert.equal((await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [AUTHOR] } })).status, 200);
  const read = await call(db, outsider, `/${DEC}/roster`);
  assert.equal(read.status, 404);
  assert.equal(read.body?.roster, undefined);
  const edit = await call(db, outsider, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [OUTSIDER] } });
  assert.equal(edit.status, 404);
  assert.deepEqual(rosterRows(db, DEC), [AUTHOR]);
  const room = await call(db, outsider, '/commit-room');
  assert.equal(roomRow(room.body, DEC), undefined);
  // And the author cannot put another firm's investor on the roster.
  const inject = await call(db, author, `/${DEC}/roster`, { method: 'PUT', body: { user_ids: [AUTHOR, OUTSIDER] } });
  assert.equal(inject.status, 400);
  assert.equal(inject.body?.error, 'roster_voter_not_eligible');
  assert.deepEqual(rosterRows(db, DEC), [AUTHOR]);
});

// ── Condition owner ────────────────────────────────────────────────────────

test('a condition’s owner round-trips through create, /:uid and /commit-room', async () => {
  const db = freshDb();
  const add = await call(db, colleague, `/${DEC}/conditions`, {
    method: 'POST', body: { body: 'Board seat confirmed', owner_user_id: MEMBER_C, owner_label: 'Founder' },
  });
  assert.equal(add.status, 201);
  assert.equal(add.body.item.owner_user_id, MEMBER_C);
  assert.equal(add.body.item.owner_label, 'Founder');
  const detail = await call(db, author, `/${DEC}`);
  const cond = detail.body.conditions[0];
  assert.equal(cond.owner_user_id, MEMBER_C);
  assert.equal(cond.owner_name, 'Cy Member');
  assert.equal(cond.owner_label, 'Founder');
  const room = await call(db, author, '/commit-room');
  const rc = room.body.conditions.rows.find((r: any) => r.decision_uid === DEC);
  assert.equal(rc.owner_user_id, MEMBER_C);
  assert.equal(rc.owner_label, 'Founder');
});
