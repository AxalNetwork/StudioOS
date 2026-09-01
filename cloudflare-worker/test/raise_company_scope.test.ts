/**
 * Company scoping, stage 2: the Founder Raise surfaces that carry their own
 * `loadProject` — financials.ts, compliance.ts, captable.ts.
 *
 * Same mechanism as stage 1 (progress.ts): the narrowed loader returns null
 * for a project outside the caller's active company, and every direct call
 * site already turns null into 404. Same harness too — the real routers
 * against a real in-memory SQLite with a real `user_company_links` table, so
 * `resolveActiveCompany` runs unmocked.
 *
 * What is NEW in this stage, and what these tests exist to pin:
 *
 *   1. The exemption set is WIDER than progress.ts's. compliance's
 *      `isPrivilegedReader` and captable's `canReadProject` both admit
 *      INVESTORS to any project. An investor's active company is their fund;
 *      `projects.company_id` can never equal it. The stage-1 trap (partner)
 *      has an investor twin here, and both are pinned.
 *
 *   2. compliance's `GET /events` without a project_id inlines its own
 *      ownership query. "All my events" has to mean "in this company", or the
 *      per-project views narrow and the overview does not.
 *
 *   3. captable's scenario gates admit a scenario's OWNER before they look at
 *      the project, so a null from the narrowed loader would let a founder
 *      reach a bound scenario with its project hidden — a cross-company leak.
 *      `projectForScenario` closes it with an explicit 404. (Appended below.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import financials from '../src/routes/financials.ts';
import compliance from '../src/routes/compliance.ts';
import captable from '../src/routes/captable.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = { user: 42, founder_id: 99 };
const PARTNER = { user: 43 };
const INVESTOR = { user: 45 };
const ADMIN = { user: 44 };
const COMPANY_A = 3;      // holds PROJECT_A
const COMPANY_B = 5;      // holds PROJECT_B — the founder's other company
const AGENCY = 77;        // the partner's own firm
const FUND = 88;          // the investor's own firm
const PROJECT_A = 7;
const PROJECT_B = 9;

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
      spinout_lab_active INTEGER, subscription_tier TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER,
      company_id INTEGER, entity_id INTEGER
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
    -- financials: the lazy schema-ensure PRAGMAs this and ALTERs what is
    -- missing, which node:sqlite supports, so the stripe test's shape is enough.
    CREATE TABLE financial_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      assumptions_json TEXT, name TEXT, inputs_json TEXT, updated_at TEXT
    );
    CREATE TABLE compliance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, project_id INTEGER NOT NULL,
      entity_id INTEGER, jurisdiction TEXT, event_type TEXT, title TEXT, description TEXT,
      due_date TEXT NOT NULL, completion_status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT, completed_by_user_id INTEGER, recurrence TEXT DEFAULT 'none',
      source TEXT DEFAULT 'manual', reminders_sent_json TEXT DEFAULT '[]',
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE cap_table_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL, project_id INTEGER, name TEXT,
      inputs_json TEXT, result_json TEXT, computed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_variant INTEGER DEFAULT 0
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id);
  u.run(PARTNER.user, 'partner', null);
  u.run(INVESTOR.user, 'investor', null);
  u.run(ADMIN.user, 'admin', null);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, ?, ?, ?)');
  p.run(PROJECT_A, 'In A', FOUNDER.founder_id, COMPANY_A);
  p.run(PROJECT_B, 'In B', FOUNDER.founder_id, COMPANY_B);
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)');
  l.run(COMPANY_A, FOUNDER.user); l.run(COMPANY_B, FOUNDER.user);
  l.run(AGENCY, PARTNER.user); l.run(FUND, INVESTOR.user);
  const e = db.prepare("INSERT INTO compliance_events (uid, project_id, title, due_date) VALUES (?, ?, ?, '2030-01-01')");
  e.run('ev-a', PROJECT_A, 'Annual filing (A)');
  e.run('ev-b', PROJECT_B, 'Annual filing (B)');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

type Who = { user: number; role: string };
const founder: Who = { user: FOUNDER.user, role: 'founder' };
const partner: Who = { user: PARTNER.user, role: 'partner' };
const investor: Who = { user: INVESTOR.user, role: 'investor' };
const admin: Who = { user: ADMIN.user, role: 'admin' };

async function get(router: any, path: string, who: Who, company?: number | string, db = freshDb()) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  return router.request(path, { headers }, env(db));
}

// ---------- financials: the progress.ts shape, verbatim ----------

test('financials: founder sees the project under its company, 404 under the other', async () => {
  assert.equal((await get(financials, `/${PROJECT_A}`, founder, COMPANY_A)).status, 200);
  const other = await get(financials, `/${PROJECT_A}`, founder, COMPANY_B);
  assert.equal(other.status, 404);
  assert.deepEqual(await other.json(), { detail: 'Project not found' });
});

test('financials: no company, forged company, admin — none of them narrow', async () => {
  assert.equal((await get(financials, `/${PROJECT_A}`, founder)).status, 200, 'no company selected');
  assert.equal((await get(financials, `/${PROJECT_A}`, founder, 999)).status, 200, 'forged id dropped');
  assert.equal((await get(financials, `/${PROJECT_A}`, admin, COMPANY_B)).status, 200, 'admin unscoped');
});

test('financials: THE TRAP — a partner under their own agency still reads every project', async () => {
  assert.equal((await get(financials, `/${PROJECT_A}`, partner, AGENCY)).status, 200);
});

// ---------- compliance: the exemption follows the READ privilege ----------

test('compliance: per-project view narrows to the active company', async () => {
  assert.equal((await get(compliance, `/events?project_id=${PROJECT_A}`, founder, COMPANY_A)).status, 200);
  assert.equal((await get(compliance, `/events?project_id=${PROJECT_A}`, founder, COMPANY_B)).status, 404);
});

test('compliance: THE TRAP, investor edition — isPrivilegedReader admits investors, so their fund must not hide projects', async () => {
  // `isPrivilegedReader` is admin|partner|INVESTOR. An investor's active
  // company is their fund, an id projects.company_id never carries. Under a
  // naive conversion this is a 404 for every project an investor can read.
  assert.equal((await get(compliance, `/events?project_id=${PROJECT_A}`, investor, FUND)).status, 200);
  assert.equal((await get(compliance, `/events?project_id=${PROJECT_A}`, partner, AGENCY)).status, 200);
});

test('compliance: "all my events" means all my events IN THIS COMPANY', async () => {
  // The founder branch of GET /events inlined its own `WHERE founder_id = ?`
  // and would have listed both companies' events under either. It now filters
  // with the same predicate loadProject uses.
  const underA = (await (await get(compliance, '/events', founder, COMPANY_A)).json()) as any;
  assert.deepEqual(underA.events.map((e: any) => e.title), ['Annual filing (A)']);
  const underB = (await (await get(compliance, '/events', founder, COMPANY_B)).json()) as any;
  assert.deepEqual(underB.events.map((e: any) => e.title), ['Annual filing (B)']);
  // And with no company selected, everything they own — the pre-switcher case.
  const all = (await (await get(compliance, '/events', founder)).json()) as any;
  assert.deepEqual(all.events.map((e: any) => e.title).sort(), ['Annual filing (A)', 'Annual filing (B)']);
});

// ---------- captable: the direct loader, and canReadProject admits investors ----------

test('captable: by-project and compare narrow to the active company', async () => {
  for (const path of [`/scenarios/by-project/${PROJECT_A}`, `/scenarios/by-project/${PROJECT_A}/compare`]) {
    assert.equal((await get(captable, path, founder, COMPANY_A)).status, 200, `${path} under A`);
    assert.equal((await get(captable, path, founder, COMPANY_B)).status, 404, `${path} under B`);
  }
});

test('captable: THE TRAP — canReadProject admits partner AND investor; neither may be narrowed', async () => {
  const path = `/scenarios/by-project/${PROJECT_A}/compare`;
  assert.equal((await get(captable, path, partner, AGENCY)).status, 200);
  assert.equal((await get(captable, path, investor, FUND)).status, 200);
});

// ---------- the leak the stage-1 pattern would NOT have closed ----------

/** A scenario owned by `owner`, bound to `projectId`. */
function seedScenario(db: any, uid: string, ownerUserId: number, projectId: number | null) {
  db.prepare(
    `INSERT INTO cap_table_scenarios (uid, owner_user_id, project_id, name, inputs_json, result_json)
     VALUES (?, ?, ?, ?, '{}', '{}')`,
  ).run(uid, ownerUserId, projectId, `Scenario ${uid}`);
}

test('captable: a scenario bound to an out-of-company project is not readable by its owner', async () => {
  // THE LEAK. `canReadScenario` admits the scenario's OWNER before it ever
  // looks at the project. If the narrowed loader had simply returned null
  // here — the stage-1 pattern — the founder would still reach this scenario
  // through the owner path while its project is hidden, and the response
  // would report the binding as absent. `projectForScenario` makes the
  // out-of-company case a 404 instead: the same answer the project gives.
  const db = freshDb();
  seedScenario(db, 'sc-b', FOUNDER.user, PROJECT_B);
  const res = await get(captable, '/scenarios/sc-b', founder, COMPANY_A, db);
  assert.equal(res.status, 404, 'the owner path must not bypass company scoping');
  assert.deepEqual(await res.json(), { detail: 'Scenario not found' });
});

test('captable: the same scenario is readable under the company that holds its project', async () => {
  // The guard must hide the wrong workspace, not the scenario.
  const db = freshDb();
  seedScenario(db, 'sc-b', FOUNDER.user, PROJECT_B);
  const res = await get(captable, '/scenarios/sc-b', founder, COMPANY_B, db);
  assert.equal(res.status, 200, await res.text());
});

test('captable: an UNBOUND scenario is unaffected by the active company', async () => {
  // project_id IS NULL means the scenario is private to its owner and has no
  // company at all. Narrowing it would delete a surface rather than scope it.
  const db = freshDb();
  seedScenario(db, 'sc-free', FOUNDER.user, null);
  for (const claim of [undefined, COMPANY_A, COMPANY_B]) {
    const res = await get(captable, '/scenarios/sc-free', founder, claim as any, db);
    assert.equal(res.status, 200, `unbound scenario with claim=${claim}`);
  }
});

test('captable: a bound scenario whose project row is GONE still falls through to the owner path', async () => {
  // Unchanged behaviour, pinned so the new 404 cannot swallow it. A deleted
  // project is not "another company's data" — it is no data — and the owner
  // has always been able to read their orphaned scenario.
  const db = freshDb();
  seedScenario(db, 'sc-orphan', FOUNDER.user, 4242);   // no such project row
  const res = await get(captable, '/scenarios/sc-orphan', founder, COMPANY_A, db);
  assert.equal(res.status, 200, 'an orphaned scenario is still its owner\'s');
});
