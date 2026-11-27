/**
 * D435 — the founder's Team page: roster, coverage and headcount plan
 * (migration 326), through the real router on real SQLite.
 *
 * FIVE THINGS, PINNED TO THE PROPERTY.
 *
 * 1. THE STORES ARE MIGRATION 326's, applied as written: the test executes
 *    the migration file, so a column the route names and the file lacks fails
 *    here rather than at the deploy's migration step.
 *
 * 2. ECONOMICS FOLLOW D431. `salary_cents` is served to an editor and to the
 *    linked person, and is ABSENT — not null — for another member.
 *
 * 3. THE WRITE GATE IS `canEdit`. A plain member reads the team and cannot
 *    write it: 403 with a refusal body, nothing stored. A non-member gets
 *    nothing at all.
 *
 * 4. VALIDATION IS CLOSED. An unknown type, a non-date, a fractional month
 *    are refused with `invalid_person`, and nothing is written.
 *
 * 5. OFFBOARDING IS A STATUS WITH A DATE, NEVER A DELETE; the composed reads
 *    (cap table by project, a member's pool, the project's co-founder
 *    decision) answer per source and a source the schema lacks is reported
 *    `available: false` with a reason rather than masked as empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import company from '../src/routes/company.ts';
import { validatePerson, validateCoverage, validatePlan, personDto } from '../src/services/companyTeam.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d435-0123456789-abcdef';
const OWNER = 701;
const MEMBER = 702;
const OUTSIDER = 703;
const CO_UID = 'co-uid-d435';
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/326_company_team_roster_coverage_plan.sql'), 'utf8');

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
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function freshDb(opts: { capTable?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER DEFAULT 1,
      jwt_min_iat INTEGER, founder_id INTEGER, partner_id INTEGER, name TEXT, email TEXT);
    CREATE TABLE company_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, company_name TEXT NOT NULL,
      stage TEXT, revenue_range TEXT, employee_count INTEGER, current_products TEXT,
      international_presence TEXT, expansion_goals TEXT, logo_url TEXT, website TEXT,
      linkedin_url TEXT, description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role_in_company TEXT NOT NULL DEFAULT 'Member',
      is_primary_admin INTEGER NOT NULL DEFAULT 0, title TEXT, authority TEXT, carry_bps INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (company_id, user_id));
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, company_id INTEGER, deleted_at TEXT,
      cofounder_decision_meta TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_option_pools (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT,
      shares_authorized REAL, shares_issued REAL, shares_available REAL, source TEXT, updated_at TEXT);
  `);
  if (opts.capTable !== false) {
    db.exec(`CREATE TABLE cap_table_holders (id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT,
      email TEXT, security_type TEXT, shares REAL, ownership_pct REAL, source TEXT, updated_at TEXT);`);
  }
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(OWNER, 'founder', 'Owner Person', 'owner.d435@example.test');
  u.run(MEMBER, 'founder', 'Member Person', 'member.d435@example.test');
  u.run(OUTSIDER, 'founder', 'Outsider', 'outsider.d435@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, ?, 'Halyard')").run(CO_UID);
  db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l1', 1, ?, 'Owner', 1)").run(OWNER);
  db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l2', 1, ?, 'Member', 0)").run(MEMBER);
  return db;
}

async function call(db: any, userId: number, path: string, init: RequestInit = {}) {
  const jwt = await new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await company.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const PERSON = {
  name: 'Dmitri Volkov', email: 'member.d435@example.test', person_type: 'employee', role_title: 'Founding engineer',
  start_date: '2026-05-04', access_level: 'member', salary_cents: 14500000, equity_shares: 240000, equity_kind: 'options',
  vest_start_date: '2026-05-04', cliff_months: 12, vest_months: 48, agreement_status: 'signed', ip_assignment: 'signed', election_83b: 'not_applicable',
};

test('D435: an editor records a person; the row is linked to the member holding that email and the actor is stamped', async () => {
  const db = freshDb();
  const r = await call(db, OWNER, `/company/${CO_UID}/team/people`, { method: 'POST', body: JSON.stringify(PERSON) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user_id, MEMBER, 'matched to the member of THIS company by email');
  assert.equal(r.body.salary_cents, 14500000, 'the editor who wrote it reads it back');
  assert.equal(r.body.created_by, OWNER);
  const row = db.prepare('SELECT * FROM company_people WHERE uid = ?').get(r.body.uid) as any;
  assert.equal(row.status, 'active');
  assert.equal(row.updated_by, OWNER);
  // An email held by an account that is NOT a member of this company links
  // nothing: the roster is not a way to look up who holds which email.
  const stranger = await call(db, OWNER, `/company/${CO_UID}/team/people`, {
    method: 'POST', body: JSON.stringify({ name: 'Someone', person_type: 'advisor', email: 'outsider.d435@example.test' }),
  });
  assert.equal(stranger.status, 201);
  assert.equal(stranger.body.user_id, null, 'a non-member account is never linked');
});

test('D435: economics are served to an editor and to the linked person, and are ABSENT for another member', async () => {
  const db = freshDb();
  const created = await call(db, OWNER, `/company/${CO_UID}/team/people`, { method: 'POST', body: JSON.stringify(PERSON) });
  const other = await call(db, OWNER, `/company/${CO_UID}/team/people`, {
    method: 'POST', body: JSON.stringify({ name: 'Rin Takahashi', person_type: 'contractor', salary_cents: 9600000 }),
  });
  assert.equal(other.status, 201);
  const asOwner = await call(db, OWNER, `/company/${CO_UID}/team`);
  assert.equal(asOwner.status, 200);
  assert.equal(asOwner.body.viewer.editor, true);
  for (const p of asOwner.body.people) assert.ok('salary_cents' in p, 'editor sees every salary');
  const asMember = await call(db, MEMBER, `/company/${CO_UID}/team`);
  assert.equal(asMember.status, 200);
  assert.equal(asMember.body.viewer.editor, false);
  const mine = asMember.body.people.find((p: any) => p.uid === created.body.uid);
  const theirs = asMember.body.people.find((p: any) => p.uid === other.body.uid);
  assert.equal(mine.salary_cents, 14500000, 'the linked person reads their own');
  assert.ok(!('salary_cents' in theirs), 'another person’s salary is absent, not null');
  assert.ok(!('compensation_note' in theirs));
});

test('D435: a member reads and cannot write; a non-member gets neither', async () => {
  const db = freshDb();
  const w = await call(db, MEMBER, `/company/${CO_UID}/team/people`, { method: 'POST', body: JSON.stringify(PERSON) });
  assert.equal(w.status, 403);
  assert.equal(w.body.error, 'not_an_editor');
  assert.match(w.body.message, /Owner, Admin, Founder or the primary admin/);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM company_people').get() as any).c, 0, 'nothing written');
  const cov = await call(db, MEMBER, `/company/${CO_UID}/team/coverage`, { method: 'PUT', body: JSON.stringify({ rows: [{ function_name: 'Finance', state: 'gap' }] }) });
  assert.equal(cov.status, 403);
  const out = await call(db, OUTSIDER, `/company/${CO_UID}/team`);
  assert.equal(out.status, 403);
  assert.equal(out.body.error, 'not_a_member');
});

test('D435: validation is closed — an unknown type, a non-date and a fractional month are refused and nothing is written', async () => {
  const db = freshDb();
  for (const bad of [
    { ...PERSON, person_type: 'kinda-employee' },
    { ...PERSON, start_date: '4 May 2026' },
    { ...PERSON, cliff_months: 12.5 },
    { ...PERSON, election_83b: 'maybe' },
    { ...PERSON, salary_cents: -1 },
    { name: '', person_type: 'employee' },
  ]) {
    const r = await call(db, OWNER, `/company/${CO_UID}/team/people`, { method: 'POST', body: JSON.stringify(bad) });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'invalid_person');
    assert.ok(typeof r.body.message === 'string' && r.body.message.length > 0);
  }
  assert.equal((db.prepare('SELECT COUNT(*) c FROM company_people').get() as any).c, 0);
  // The service alone, for the rules the route composes.
  assert.equal(validatePerson({ name: 'A', person_type: 'advisor', email: 'Not-An-Email' }, true).error, 'email must be an email address');
  assert.equal(validatePerson({ name: 'A', person_type: 'advisor', email: 'X@Example.TEST' }, true).value?.email, 'x@example.test');
  assert.equal(validateCoverage({ rows: [{ function_name: 'Finance', state: 'gap' }, { function_name: 'finance', state: 'thin' }] }).error, 'function finance is listed twice');
  assert.equal(validatePlan({ rows: [{ period_label: 'Q4', target_headcount: 6.5 }] }).error, 'target_headcount must be a whole number');
  assert.ok(!('salary_cents' in personDto({ uid: 'p', salary_cents: 5, created_by: 1 }, false)));
  assert.equal(personDto({ uid: 'p', salary_cents: 5, created_by: 1 }, true).salary_cents, 5);
});

test('D435: offboarding is a status with a date, never a delete; coverage and plan PUTs replace the list and stamp the actor', async () => {
  const db = freshDb();
  const created = await call(db, OWNER, `/company/${CO_UID}/team/people`, { method: 'POST', body: JSON.stringify(PERSON) });
  const off = await call(db, OWNER, `/company/${CO_UID}/team/people/${created.body.uid}`, { method: 'PATCH', body: JSON.stringify({ status: 'offboarded' }) });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.status, 'offboarded');
  assert.ok(off.body.offboarded_at, 'the date is stamped');
  assert.equal((db.prepare('SELECT COUNT(*) c FROM company_people').get() as any).c, 1, 'the record stays');
  const back = await call(db, OWNER, `/company/${CO_UID}/team/people/${created.body.uid}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
  assert.equal(back.body.offboarded_at, null, 'reinstating clears the date');
  const missing = await call(db, OWNER, `/company/${CO_UID}/team/people/no-such-uid`, { method: 'PATCH', body: JSON.stringify({ note: 'x' }) });
  assert.equal(missing.status, 404);

  const cov1 = await call(db, OWNER, `/company/${CO_UID}/team/coverage`, {
    method: 'PUT', body: JSON.stringify({ rows: [{ function_name: 'Engineering', state: 'covered', owner_note: 'CTO' }, { function_name: 'Finance', state: 'gap' }] }),
  });
  assert.equal(cov1.status, 200, JSON.stringify(cov1.body));
  assert.deepEqual(cov1.body.coverage.map((c: any) => [c.function_name, c.state, c.updated_by]), [['Engineering', 'covered', OWNER], ['Finance', 'gap', OWNER]]);
  const cov2 = await call(db, OWNER, `/company/${CO_UID}/team/coverage`, {
    method: 'PUT', body: JSON.stringify({ rows: [{ function_name: 'Finance', state: 'thin', owner_note: 'Fractional CFO' }] }),
  });
  assert.deepEqual(cov2.body.coverage.map((c: any) => [c.function_name, c.state]), [['Finance', 'thin']], 'a function taken off the list is gone');
  const plan = await call(db, OWNER, `/company/${CO_UID}/team/plan`, {
    method: 'PUT', body: JSON.stringify({ rows: [{ period_label: 'Q4 2026', target_headcount: 6 }, { period_label: 'Q1 2027', target_headcount: 9, note: 'post-raise' }] }),
  });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.deepEqual(plan.body.plan.map((q: any) => [q.period_label, q.target_headcount, q.note]), [['Q4 2026', 6, null], ['Q1 2027', 9, 'post-raise']]);
  const badPlan = await call(db, OWNER, `/company/${CO_UID}/team/plan`, { method: 'PUT', body: JSON.stringify({ rows: 'nope' }) });
  assert.equal(badPlan.status, 400);
  assert.equal(badPlan.body.error, 'invalid_plan');
});

test('D435: the composed reads answer per source — holders by project, a member’s pool, the project’s decision — and an unreadable source says so', async () => {
  const db = freshDb();
  db.exec(`INSERT INTO projects (id, name, company_id, cofounder_decision_meta) VALUES (10, 'Halyard app', 1, '{"outcome":"no_cofounder","note":"Settled at two.","decided_at":"2026-08-01"}');
           INSERT INTO projects (id, name, company_id, deleted_at) VALUES (11, 'Deleted one', 1, '2026-01-01');
           INSERT INTO projects (id, name, company_id) VALUES (12, 'Other company', 2);
           INSERT INTO cap_table_holders (project_id, name, email, security_type, shares, ownership_pct) VALUES (10, 'Owner Person', 'OWNER.d435@example.test', 'common', 5400000, 54);
           INSERT INTO cap_table_holders (project_id, name, email, security_type, shares) VALUES (11, 'Ghost', 'ghost@example.test', 'common', 1);
           INSERT INTO cap_table_holders (project_id, name, email, security_type, shares) VALUES (12, 'Stranger', 's@example.test', 'common', 1);
           INSERT INTO cap_table_option_pools (user_id, name, shares_authorized, shares_issued, shares_available, source) VALUES (${MEMBER}, '2026 Plan', 1000000, 240000, 760000, 'carta');
           INSERT INTO cap_table_option_pools (user_id, name, shares_authorized, shares_issued, shares_available, source) VALUES (${OUTSIDER}, 'Not ours', 5, 0, 5, 'carta');`);
  const r = await call(db, OWNER, `/company/${CO_UID}/team`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cap_table.available, true);
  assert.deepEqual(r.body.cap_table.projects.map((p: any) => p.id), [10], 'deleted and foreign projects are not this company’s');
  assert.deepEqual(r.body.cap_table.holders.map((h: any) => [h.project_id, h.email, h.shares]), [[10, 'owner.d435@example.test', 5400000]]);
  assert.equal(r.body.pool.available, true);
  assert.deepEqual(r.body.pool.rows.map((p: any) => [p.name, p.imported_by_user_id, p.shares_available]), [['2026 Plan', MEMBER, 760000]], 'only a member’s import');
  assert.equal(r.body.cofounder.available, true);
  assert.equal(r.body.cofounder.project_name, 'Halyard app');
  assert.equal(r.body.cofounder.meta.outcome, 'no_cofounder');

  // No cap_table_holders table at all, with a project to read holders for:
  // the source is reported, not masked as an empty cap table.
  const bare = freshDb({ capTable: false });
  bare.exec("INSERT INTO projects (id, name, company_id) VALUES (10, 'Halyard app', 1)");
  const b = await call(bare, OWNER, `/company/${CO_UID}/team`);
  assert.equal(b.status, 200);
  assert.equal(b.body.cap_table.available, false);
  assert.match(b.body.cap_table.reason, /could not be read/);
  assert.equal(b.body.cofounder.available, false);
  assert.match(b.body.cofounder.reason, /No project of this company has recorded/);
  assert.deepEqual(b.body.people, []);
});
