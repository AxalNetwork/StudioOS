/**
 * `/api/ic` — one firm's committee is not another's, on every endpoint.
 *
 * WHAT THIS GUARDS. Until migration 219 and `icDecisionScope`, `/api/ic` had no
 * caller predicate at all: the list ran `WHERE 1=1`, the detail read matched on
 * the uid alone, and the vote endpoint looked a decision up the same way before
 * writing into its tally. Every account holding the IC licence — admin, partner,
 * or a professional-tier investor — could therefore read every other firm's
 * memo, proposed terms and each member's vote with its written rationale, and
 * could cast a vote into a committee it had nothing to do with.
 *
 * EVERY ENDPOINT, NOT A REPRESENTATIVE ONE. A scoping test that checks the list
 * and calls it done is how the vote endpoint stayed the most open of the five:
 * it was the one nobody thought of as a read. So the outsider matrix below
 * covers all five, and `every endpoint under /api/ic is in the outsider matrix`
 * reads the router's own route table and fails if a sixth is added without a
 * row here. That assertion is the one that keeps this file honest a year from
 * now; the five below only prove today.
 *
 * REAL SQLITE, NOT A TEXT-MATCHING STUB, for the reason `_d1_sqlite.mjs` gives
 * at length: a stub taught which strings to expect cannot tell a correct
 * predicate from an incorrect one, so it would assert that the query LOOKS a
 * certain way — the one property nobody cares about. Here the route's real SQL
 * with its real binds decides which rows come back, and a scoping regression
 * fails because the wrong rows arrive.
 *
 * 404 AND NOT 403 on a row outside the scope. The predicate lives in the WHERE
 * clause, so "no such decision" and "not yours" are the same code path — there
 * is no branch to forget, and a non-owner cannot confirm the row exists.
 * `requireOwnEngagement` and `requireOwnQuote` answer the same way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import ic from '../src/routes/ic.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const CO_A = 11;            // Firm A
const CO_B = 22;            // Firm B — the outsider's firm
const AUTHOR = 41;          // investor at Firm A; wrote the decision
const COLLEAGUE = 42;       // investor at Firm A; never touched it
const OUTSIDER = 43;        // investor at Firm B
const PARTNER_OUT = 44;     // partner at Firm B — a different licence, same answer
const ADMIN = 45;
const LONER = 46;           // investor with no company link at all
const PROJ = 7;
const DEAL = 71;

const DEC_A = 'dec-firm-a';       // Firm A's decision
const DEC_LONER = 'dec-loner';    // authored with no company: author + voters only

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
    CREATE TABLE deal_memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, problem TEXT,
      solution TEXT, why_now TEXT, key_insight TEXT, risks TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE dd_cases (
      id INTEGER PRIMARY KEY, uid TEXT, subject_label TEXT, status TEXT
    );
    -- Migration 123 plus the company_id column migration 219 adds.
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
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, investor_tier) VALUES (?, ?, ?)');
  u.run(AUTHOR, 'investor', 'institutional');
  u.run(COLLEAGUE, 'investor', 'institutional');
  u.run(OUTSIDER, 'investor', 'institutional');
  u.run(PARTNER_OUT, 'partner', null);
  u.run(ADMIN, 'admin', null);
  u.run(LONER, 'investor', 'institutional');

  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id, is_primary_admin) VALUES (?, ?, 1)');
  l.run(CO_A, AUTHOR); l.run(CO_A, COLLEAGUE);
  l.run(CO_B, OUTSIDER); l.run(CO_B, PARTNER_OUT);

  db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)')
    .run(PROJ, 'p-alpha', 'Alpha', 1);
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(DEAL, 'd-alpha', PROJ);

  const d = db.prepare(
    `INSERT INTO ic_decisions (uid, project_id, title, memo, status, created_by, company_id)
     VALUES (?, ?, ?, ?, 'voting', ?, ?)`,
  );
  d.run(DEC_A, PROJ, 'Alpha — IC review', 'Firm A memo', AUTHOR, CO_A);
  d.run(DEC_LONER, null, 'Unaffiliated review', 'no firm', LONER, null);

  db.prepare('INSERT INTO ic_votes (ic_decision_id, user_id, vote, rationale) VALUES ((SELECT id FROM ic_decisions WHERE uid = ?), ?, ?, ?)')
    .run(DEC_A, AUTHOR, 'yes', 'conviction on the team');
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
const outsider = { user: OUTSIDER, role: 'investor' };
const partnerOut = { user: PARTNER_OUT, role: 'partner' };
const admin = { user: ADMIN, role: 'admin' };
const loner = { user: LONER, role: 'investor' };

/** One request against a fresh database, so no test can see another's writes. */
async function call(
  who: Who,
  path: string,
  init: { method?: string; body?: any; company?: number } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  if (init.company !== undefined) headers['X-Company-Id'] = String(init.company);
  const res = await ic.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

const uids = (body: any) => (body?.items || []).map((d: any) => d.uid).sort();

// ---------------------------------------------------------------------------
// The five endpoints, each refused to a firm that has nothing to do with the row
// ---------------------------------------------------------------------------

/**
 * Every request an outsider can make, with the answer it must get.
 *
 * `POST /` is here as the endpoint that CANNOT be refused — anyone with the
 * licence may open their own decision — and its row is the one the next
 * assertion proves lands in the caller's own firm and not in A's docket. Its
 * presence is what makes the coverage check below meaningful: the matrix
 * asserts what each endpoint does, not merely that it says no.
 */
const OUTSIDER_MATRIX: Array<{
  route: string; method: string; path: string; expect: number; why: string;
  body?: any;
}> = [
  {
    route: '/', method: 'GET', path: '/', expect: 200,
    why: 'the list answers 200 with an EMPTY page, not another firm\'s docket',
  },
  {
    route: '/', method: 'POST', path: '/', expect: 201, body: { title: 'B — own review' },
    why: 'creating your own decision is the one write an outsider may always do',
  },
  {
    route: '/:uid', method: 'GET', path: `/${DEC_A}`, expect: 404,
    why: 'the memo, the terms and every vote rationale hang off this read',
  },
  {
    route: '/:uid', method: 'PUT', path: `/${DEC_A}`, expect: 404, body: { memo: 'rewritten' },
    why: 'a non-owner must not learn the row exists, so 404 before the 403',
  },
  {
    route: '/:uid/vote', method: 'POST', path: `/${DEC_A}/vote`, expect: 404,
    body: { vote: 'no', rationale: 'from outside the firm' },
    why: 'the write that was open longest — a vote into another committee\'s tally',
  },
  {
    route: '/commit-room', method: 'GET', path: '/commit-room', expect: 200,
    why: 'the widest read in the file — every decision WITH its votes and every '
      + 'rationale, in one response, so an unscoped version leaks more than /:uid does',
  },
];

for (const row of OUTSIDER_MATRIX) {
  test(`outsider · ${row.method} ${row.route} → ${row.expect} — ${row.why}`, async () => {
    const r = await call(outsider, row.path, { method: row.method, body: row.body });
    assert.equal(r.status, row.expect);
    if (row.method === 'GET' && row.path === '/') {
      assert.deepEqual(uids(r.body), [], 'the list must be empty for a firm with no decisions');
    }
    // 200 IS NOT THE ASSERTION FOR THIS ONE. `/commit-room` answers every
    // caller who holds the licence — there is no uid to 404 on — so the refusal
    // has to be read out of the BODY: no decision, no vote and no rationale
    // belonging to firm A may appear in it. An unscoped version would return
    // 200 here too, and only this check would notice.
    if (row.path === '/commit-room') {
      assert.deepEqual((r.body?.decisions?.rows || []).map((d: any) => d.uid), [],
        'another firm\'s decision reached the commit room');
      assert.equal(r.body?.current, null, 'another firm\'s decision was named as current');
      assert.equal(r.body?.rationale?.total, 0, 'another firm\'s votes were counted');
      const blob = JSON.stringify(r.body);
      assert.ok(!blob.includes(DEC_A), 'firm A\'s decision uid is in the response');
      assert.ok(!blob.includes('Firm A memo'), 'firm A\'s memo is in the response');
    }
  });

  test(`outsider on a second licence · ${row.method} ${row.route} → ${row.expect}`, async () => {
    // A partner holds the IC licence too. The refusal is a property of the ROW,
    // not of the role, so it must not change with the caller's licence.
    const r = await call(partnerOut, row.path, { method: row.method, body: row.body });
    assert.equal(r.status, row.expect);
  });
}

test('every endpoint under /api/ic is in the outsider matrix', () => {
  // Read from the router itself. A seventh endpoint added to ic.ts without a row
  // above fails here rather than shipping unasserted — which is exactly how the
  // vote endpoint came to be the least-guarded of the five, and exactly what
  // caught `GET /commit-room` on the day it was written.
  const declared = new Set(
    (ic as any).routes
      .filter((r: any) => r.method !== 'ALL')
      .map((r: any) => `${r.method} ${r.path}`),
  );
  const covered = new Set(OUTSIDER_MATRIX.map((r) => `${r.method} ${r.route}`));
  assert.deepEqual(
    [...declared].filter((k) => !covered.has(k as string)).sort(), [],
    'an /api/ic endpoint has no outsider assertion',
  );
  assert.equal(covered.size, 6, 'the matrix itself must not shrink silently');
});

// ---------------------------------------------------------------------------
// The three ways to be entitled, each proved to grant what it claims
// ---------------------------------------------------------------------------

test('the author reads their own decision on every read path', async () => {
  const list = await call(author, '/');
  assert.equal(list.status, 200);
  assert.deepEqual(uids(list.body), [DEC_A]);
  const one = await call(author, `/${DEC_A}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.memo, 'Firm A memo');
  assert.equal(one.body.votes.length, 1, 'the votes come with the detail read');
});

test('a colleague at the same firm sees it and can vote — a committee needs more than its author', async () => {
  // The failure this pins is the plausible wrong fix: scoping to `created_by`
  // alone would pass every outsider assertion above and quietly break the
  // feature, because nobody but the author could ever vote.
  const list = await call(colleague, '/');
  assert.deepEqual(uids(list.body), [DEC_A]);

  const db = freshDb();
  const voted = await call(colleague, `/${DEC_A}/vote`, { method: 'POST', body: { vote: 'no' } }, db);
  assert.equal(voted.status, 200);
  assert.deepEqual(voted.body.tally, { yes: 1, no: 1, abstain: 0 });
});

test('a colleague may read and vote but not rewrite — 403 inside the firm, 404 outside it', async () => {
  // The two refusals are different answers to different questions and both must
  // keep working. Outside the firm the row does not exist (404, asserted in the
  // matrix above); inside it, it exists and is somebody else's to edit (403).
  // Collapsing either into the other loses a real distinction — and dropping
  // the authorship branch entirely would let any colleague overwrite the memo.
  const r = await call(colleague, `/${DEC_A}`, { method: 'PUT', body: { memo: 'rewritten' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.detail, 'Forbidden');

  const own = await call(author, `/${DEC_A}`, { method: 'PUT', body: { memo: 'revised by its author' } });
  assert.equal(own.status, 200);
  assert.equal(own.body.memo, 'revised by its author');
});

test('a member who voted keeps their access even with no company link', async () => {
  // The third branch. LONER has no `user_company_links` row at all, so only
  // authorship and the vote record can reach a row — and DEC_LONER carries a
  // NULL company, which must never widen to everyone.
  const mine = await call(loner, '/');
  assert.deepEqual(uids(mine.body), [DEC_LONER], 'author of a company-less decision still sees it');

  const db = freshDb();
  db.prepare('INSERT INTO ic_votes (ic_decision_id, user_id, vote) VALUES ((SELECT id FROM ic_decisions WHERE uid = ?), ?, ?)')
    .run(DEC_A, LONER, 'abstain');
  const after = await call(loner, `/${DEC_A}`, {}, db);
  assert.equal(after.status, 200, 'having voted is itself a claim on the row');
});

test('a NULL company is not a public company', async () => {
  // Everywhere else in tenancyScope a NULL company_id widens — an unassigned
  // project stays visible under every company, because ownership has already
  // been decided by an outer predicate. Here the company IS the ownership key,
  // so the same reading would hand every unassigned decision to every licence
  // holder. DEC_LONER must be invisible to a firm that had no part in it.
  const seen = await call(outsider, '/');
  assert.deepEqual(uids(seen.body), []);
  const direct = await call(outsider, `/${DEC_LONER}`);
  assert.equal(direct.status, 404);
  const colleagueView = await call(colleague, '/');
  assert.deepEqual(uids(colleagueView.body), [DEC_A], 'not even a firm member sees the company-less row');
});

test('admin is unscoped, as everywhere else in tenancyScope', async () => {
  const list = await call(admin, '/');
  assert.deepEqual(uids(list.body), [DEC_A, DEC_LONER].sort());
  assert.equal((await call(admin, `/${DEC_A}`)).status, 200);
  assert.equal((await call(admin, `/${DEC_LONER}`)).status, 200);
});

// ---------------------------------------------------------------------------
// Creation: where the firm on the row comes from
// ---------------------------------------------------------------------------

test('a new decision is filed under the creator\'s verified active company', async () => {
  const db = freshDb();
  const made = await call(outsider, '/', { method: 'POST', body: { title: 'B review' }, company: CO_B }, db);
  assert.equal(made.status, 201);
  const row = db.prepare('SELECT company_id FROM ic_decisions WHERE uid = ?').get(made.body.uid) as any;
  assert.equal(Number(row.company_id), CO_B);

  // And their colleague at B can now see it, which is the whole point of the column.
  const theirs = await call({ user: PARTNER_OUT, role: 'partner' }, '/', { company: CO_B }, db);
  assert.deepEqual(uids(theirs.body), ['B review'].map(() => made.body.uid));
});

test('a forged company header files the row under nobody, never under the claimed firm', async () => {
  // `activeCompanyFor` verifies the header against `user_company_links`, so a
  // claim on a firm the caller does not belong to resolves to null. The row must
  // land company-less — author-and-voters only — rather than in Firm A's docket.
  const db = freshDb();
  const made = await call(outsider, '/', { method: 'POST', body: { title: 'planted' }, company: CO_A }, db);
  assert.equal(made.status, 201);
  const row = db.prepare('SELECT company_id FROM ic_decisions WHERE uid = ?').get(made.body.uid) as any;
  assert.equal(row.company_id, null, 'a rejected claim must not be written');

  const firmA = await call(author, '/', {}, db);
  assert.deepEqual(uids(firmA.body), [DEC_A], 'the planted row never reaches Firm A');
});

test('deal_id must name a deal that exists', async () => {
  // The one foreign key on this row that nothing checked, and the vote handler
  // copies it straight into decision_journal_entries.deal_id.
  const ok = await call(outsider, '/', { method: 'POST', body: { title: 'ok', deal_id: DEAL } });
  assert.equal(ok.status, 201);
  const bad = await call(outsider, '/', { method: 'POST', body: { title: 'bad', deal_id: 99999 } });
  assert.equal(bad.status, 404);
  assert.equal(bad.body.detail, 'Deal not found');
});

// ---------------------------------------------------------------------------
// The licence gate is not the scope
// ---------------------------------------------------------------------------

test('a role without the IC licence is still refused with 403, not 404', async () => {
  // `canUseIc` and `icDecisionScope` answer different questions and must both
  // keep answering: 403 says "this surface is not yours", 404 says "this row is
  // not yours". Collapsing either into the other loses a real distinction.
  const db = freshDb();
  db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(90, 'founder');
  const r = await call({ user: 90, role: 'founder' }, '/', {}, db);
  assert.equal(r.status, 403);
  assert.equal(r.body.detail, 'Forbidden');
});
