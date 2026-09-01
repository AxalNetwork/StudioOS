/**
 * Stage 1 of company scoping: the Founder Validate surfaces in progress.ts.
 *
 * The change under test is one function. `loadProject` now selects
 * `projects.company_id` and returns null when the row is outside the caller's
 * active company — but ONLY on the ownership path. Every handler in the file
 * already reads `if (!project) return 404`, so a project in another company
 * behaves exactly as a `companyScope` query would: it is not there.
 *
 * These drive the REAL router against a real in-memory SQLite (node:sqlite
 * behind the same tiny D1 adapter stripe_import_route.test.ts uses), with a
 * real `user_company_links` table — so `resolveActiveCompany`'s membership
 * check runs unmocked and a forged header is proven to change nothing.
 *
 * The test that matters most is the partner one. `companyScope(partner, 5)`
 * is `1=0`, because a partner has no founder_id; progress.ts's `isPrivileged`
 * admits partners to every project regardless. A conversion that narrowed the
 * privileged path would have passed every founder-side test here and silently
 * cut partner access to all 31 endpoints. So the partner case is pinned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import progress from '../src/routes/progress.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

const FOUNDER = { user: 42, founder_id: 99 };
const PARTNER = { user: 43 };
const ADMIN = { user: 44 };
const COMPANY_A = 3;      // holds the project
const COMPANY_B = 5;      // the founder's other company
const AGENCY = 77;        // the partner's own firm — never a projects.company_id
const PROJECT = 7;        // company_id = COMPANY_A
const UNASSIGNED = 8;     // company_id = NULL
const INTERVIEW = 100;    // on PROJECT

function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let binds: any[] = [];
      const api: any = {
        bind: (...a: any[]) => { binds = coerce(a); return api; },
        async first() { return db.prepare(sql).get(...binds) ?? null; },
        async all() { return { results: db.prepare(sql).all(...binds) }; },
        async run() {
          const r = db.prepare(sql).run(...binds);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { return stmts; },
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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      spinout_lab_active INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER, company_id INTEGER
    );
    -- The membership table resolveActiveCompany verifies the header against.
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
    -- Every column INTERVIEW_SELECT names, so the lazy column-ensure helpers
    -- find nothing to add.
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      interviewee_name TEXT, interviewee_role TEXT, interview_date TEXT,
      notes TEXT, hypotheses_json TEXT, pains_json TEXT, featured INTEGER DEFAULT 0,
      validation_rating INTEGER, validation_comment TEXT, icp_fit TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)').run(FOUNDER.user, 'founder', FOUNDER.founder_id);
  db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)').run(PARTNER.user, 'partner', null);
  db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)').run(ADMIN.user, 'admin', null);
  db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, ?, ?, ?)').run(PROJECT, 'In A', FOUNDER.founder_id, COMPANY_A);
  db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, ?, ?, ?)').run(UNASSIGNED, 'Unassigned', FOUNDER.founder_id, null);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY_A, FOUNDER.user);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY_B, FOUNDER.user);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(AGENCY, PARTNER.user);
  db.prepare('INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (?, ?, ?)').run(INTERVIEW, PROJECT, 'Original');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function env(db: InstanceType<typeof DatabaseSync>): any {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

/** GET the interviews list as `who`, optionally claiming a company. */
async function listInterviews(db: any, who: { user: number; role: string }, company?: number | string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  return progress.request(`/discovery/${PROJECT}`, { headers }, env(db));
}

const founder = { user: FOUNDER.user, role: 'founder' };
const partner = { user: PARTNER.user, role: 'partner' };
const admin = { user: ADMIN.user, role: 'admin' };

// ---------- the founder's own view narrows to the active company ----------

test('founder: the project is visible under the company that holds it', async () => {
  const res = await listInterviews(freshDb(), founder, COMPANY_A);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.project_id, PROJECT);
  assert.deepEqual(body.interviews.map((i: any) => i.interviewee_name), ['Original']);
});

test('founder: the same project is NOT FOUND under their other company', async () => {
  // 404, not 403. The project is the caller's own; it is just not in the
  // workspace they have selected. This is the status a companyScope query
  // would produce, because the row simply would not come back.
  const res = await listInterviews(freshDb(), founder, COMPANY_B);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { detail: 'Project not found' });
});

test('founder: no company selected means every project they own', async () => {
  // The single-company case and the moment before the switcher is touched.
  // Returning 404 here would blank the app for every existing user.
  const res = await listInterviews(freshDb(), founder);
  assert.equal(res.status, 200);
});

test('founder: a forged company id is dropped, not honoured — it neither widens nor narrows', async () => {
  // 999 is a company the founder does not belong to. resolveActiveCompany
  // returns null for a claim membership does not back, which reads as "no
  // company selected", so the project is visible. Had the raw header reached
  // the predicate instead, this would be a 404 — the forged value narrowing a
  // view it was never entitled to name.
  const res = await listInterviews(freshDb(), founder, 999);
  assert.equal(res.status, 200);
  // And a claim that is not even a number.
  const junk = await listInterviews(freshDb(), founder, 'abc');
  assert.equal(junk.status, 200);
});

test('founder: an unassigned project stays visible under every company', async () => {
  // company_id IS NULL is a real state — migration 189 invents nothing for a
  // founder without a primary company — and it is not another company's data.
  const headers = { Authorization: `Bearer ${await token(founder.user, founder.role)}`, 'X-Company-Id': String(COMPANY_B) };
  const res = await progress.request(`/discovery/${UNASSIGNED}`, { headers }, env(freshDb()));
  assert.equal(res.status, 200);
});

// ---------- the privileged path is untouched: THE TRAP ----------

test('partner: their own firm as the active company does not hide any project', async () => {
  // projects.company_id is the FOUNDER's company; a partner's active company
  // is their agency, an id that column never carries. isPrivileged admits
  // partners to every project, and this pins that company narrowing cannot
  // undo it. Under a naive companyScope conversion this is a 404 for every
  // project a partner has ever been able to read.
  const res = await listInterviews(freshDb(), partner, AGENCY);
  assert.equal(res.status, 200, 'a partner must not be narrowed by a column that never names their firm');
});

test('admin: unscoped, whatever company is claimed', async () => {
  for (const claim of [undefined, COMPANY_A, COMPANY_B, 999]) {
    const res = await listInterviews(freshDb(), admin, claim as any);
    assert.equal(res.status, 200, `admin with claim=${claim}`);
  }
});

// ---------- writes go through the same gate ----------

test('founder: a write under the wrong company is refused and changes nothing', async () => {
  const db = freshDb();
  const headers = {
    Authorization: `Bearer ${await token(founder.user, founder.role)}`,
    'Content-Type': 'application/json',
    'X-Company-Id': String(COMPANY_B),
  };
  const res = await progress.request(`/discovery/interview/${INTERVIEW}`, {
    method: 'PUT', headers, body: JSON.stringify({ interviewee_name: 'Tampered' }),
  }, env(db));
  assert.equal(res.status, 404);
  const row = db.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?').get(INTERVIEW) as any;
  assert.equal(row.interviewee_name, 'Original', 'a refused write must leave the row untouched');
});

test('founder: the same write under the right company succeeds', async () => {
  // The guard must refuse the wrong workspace, not writing. This is the case
  // that fails if loadProject is ever tightened past what companyScope says.
  const db = freshDb();
  const headers = {
    Authorization: `Bearer ${await token(founder.user, founder.role)}`,
    'Content-Type': 'application/json',
    'X-Company-Id': String(COMPANY_A),
  };
  const res = await progress.request(`/discovery/interview/${INTERVIEW}`, {
    method: 'PUT', headers, body: JSON.stringify({ interviewee_name: 'Edited' }),
  }, env(db));
  assert.equal(res.status, 200, await res.text());
  const row = db.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?').get(INTERVIEW) as any;
  assert.equal(row.interviewee_name, 'Edited');
});
