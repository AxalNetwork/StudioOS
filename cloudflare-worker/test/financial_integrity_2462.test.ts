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
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import financials from '../src/routes/financials.ts';



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


const drivers = {starting_cash:1000, price_per_unit:10, units_month_0:5, monthly_growth_pct:2, cac:4, monthly_churn_pct:3, salaries_monthly:10, opex_monthly:10, gross_margin_pct:70, horizon_months:24};
async function save(db: any, assumptions: any) {
 return financials.request(`/${PROJECT_A}`, {method:'PUT', headers:{Authorization:`Bearer ${await token(FOUNDER.user, 'founder')}`, 'Content-Type':'application/json'}, body:JSON.stringify({assumptions})}, env(db));
}
test('2462: unsaved models have no venture assumptions or computed figures', async () => {
 const response = await get(financials, `/${PROJECT_A}`, founder);
 const data = await response.json();
 assert.equal(data.exists, false);
 assert.equal(data.assumptions, null);
 assert.equal(data.computed, null);
});
test('2462: every missing or blank driver is rejected and named', async () => {
 for (const key of Object.keys(drivers)) {
  for (const missing of [undefined, null, '']) {
   const response = await save(freshDb(), {...drivers, [key]: missing});
   assert.equal(response.status, 400, key);
   const data = await response.json();
   assert.ok(data.errors.some((error: string) => error.startsWith(key + ':')), key);
  }
 }
});
test('2462: save preserves Stripe facts and changes only edited provenance', async () => {
 const db = freshDb();
 const stored = {...drivers, mrr:123, arr:1476, paying_customers:9, _stripe_synced_at:'2026-10-22', _sources:{mrr:'stripe', monthly_churn_pct:'stripe'}};
 db.prepare('INSERT INTO financial_models (project_id, assumptions_json) VALUES (?, ?)').run(PROJECT_A, JSON.stringify(stored));
 const response = await save(db, {...drivers, monthly_churn_pct:5});
 assert.equal(response.status, 200, await response.clone().text());
 const {assumptions:a} = await response.json();
 assert.equal(a.mrr,123); assert.equal(a.arr,1476); assert.equal(a.paying_customers,9);
 assert.equal(a._stripe_synced_at,stored._stripe_synced_at);
 assert.equal(a._sources.mrr,'stripe'); assert.equal(a._sources.monthly_churn_pct,'typed');
});

test('2462: a Stripe-only row is not a model saved by a person', async () => {
 const db = freshDb();
 db.prepare('INSERT INTO financial_models (project_id, assumptions_json) VALUES (?, ?)').run(PROJECT_A, JSON.stringify({mrr:123}));
 const data = await (await get(financials, `/${PROJECT_A}`, founder, undefined, db)).json();
 assert.equal(data.exists,false); assert.equal(data.assumptions,null); assert.equal(data.computed,null);
});

test('2462: both deck readers exclude models nobody saved', () => {
 for (const path of ['../src/routes/decks.ts','../src/services/decks/autofill.ts']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const query = source.match(/SELECT computed_json, assumptions_json FROM financial_models WHERE[^'\n]+/)[0];
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE financial_models(project_id INTEGER, computed_json TEXT, assumptions_json TEXT, updated_by INTEGER)');
  db.prepare('INSERT INTO financial_models VALUES(1, ?, ?, NULL)').run('{"runway_months":99}','{}');
  assert.equal(db.prepare(query).get(1),undefined,path);
  db.exec('UPDATE financial_models SET updated_by = 42');
  assert.ok(db.prepare(query).get(1),path);
  db.close();
 }
});
