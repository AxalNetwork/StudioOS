/**
 * Company scoping, stage 3: the last two founder surfaces —
 * crunchbase.ts and contacts.ts (the Raise pipeline).
 *
 * Stages 1 and 2 narrowed project LOADERS. These two are the reason the
 * rollout was staged rather than done in one sweep, because neither is that
 * shape:
 *
 *   1. crunchbase's `loadProjectForWrite` exempts ADMIN ONLY. progress.ts and
 *      financials.ts exempt admin+partner; compliance.ts and captable.ts also
 *      exempt investor. Copying a sibling file's set into this gate would have
 *      handed partners a write path they have never had. The exemption is read
 *      from each file's own predicate, and this test pins that a partner is
 *      still refused here while being exempt two files over.
 *
 *   2. contacts' `ownedProjectScope` is not a loader at all — it returns the
 *      `'all' | number[]` id list that twenty-one handlers filter by. Narrowing
 *      the array branch scopes all of them at once, and `'all'` (admin) stays
 *      unscoped exactly as `companyScope` leaves admin unscoped.
 *
 * Harness matches stages 1 and 2: the real routers against a real in-memory
 * SQLite with a real `user_company_links` table, so `resolveActiveCompany`
 * runs unmocked and a forged header is rejected by the same code prod uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import crunchbase from '../src/routes/crunchbase.ts';
import contacts from '../src/routes/contacts.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = { user: 42, founder_id: 99 };
const PARTNER = { user: 43 };
const ADMIN = { user: 44 };
const COMPANY_A = 3;      // holds PROJECT_A
const COMPANY_B = 5;      // the founder's OTHER company, holds PROJECT_B
const AGENCY = 77;        // the partner's own firm
const PROJECT_A = 7;
const PROJECT_B = 9;
const PROJECT_NONE = 11;  // no company_id — "unassigned", visible everywhere

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
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, founder_id INTEGER,
      company_id INTEGER, deleted_at TEXT,
      crunchbase_uuid TEXT, crunchbase_data_json TEXT
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
    -- The shape contacts.ts ensureSchema would create, verbatim. It runs
    -- CREATE TABLE IF NOT EXISTS and then CREATE INDEX ... ON
    -- raise_prospects(contact_id): a fixture table missing that column skips
    -- the create, fails the index, and every handler answers 400 through
    -- mapError before any assertion is reached.
    CREATE TABLE raise_prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER NOT NULL, contact_id INTEGER,
      name TEXT, email TEXT, firm TEXT,
      stage TEXT NOT NULL DEFAULT 'to_contact', notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, subscription_tier) VALUES (?, ?, ?, ?)');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id, 'studio');
  u.run(PARTNER.user, 'partner', null, null);
  u.run(ADMIN.user, 'admin', null, null);
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, ?, ?)');
  p.run(PROJECT_A, 'uid-a', 'In A', FOUNDER.founder_id, COMPANY_A);
  p.run(PROJECT_B, 'uid-b', 'In B', FOUNDER.founder_id, COMPANY_B);
  p.run(PROJECT_NONE, 'uid-n', 'Unassigned', FOUNDER.founder_id, null);
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)');
  l.run(COMPANY_A, FOUNDER.user); l.run(COMPANY_B, FOUNDER.user); l.run(AGENCY, PARTNER.user);
  const pr = db.prepare('INSERT INTO raise_prospects (uid, project_id, name, stage) VALUES (?, ?, ?, ?)');
  pr.run('pr-a', PROJECT_A, 'Prospect in A', 'contacted');
  pr.run('pr-b', PROJECT_B, 'Prospect in B', 'contacted');
  pr.run('pr-n', PROJECT_NONE, 'Prospect unassigned', 'contacted');
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
const admin: Who = { user: ADMIN.user, role: 'admin' };

async function get(router: any, path: string, who: Who, company?: number | string, db = freshDb()) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  return router.request(path, { headers }, env(db));
}

// ---------------------------------------------------------------------------
// crunchbase — the gate that exempts ADMIN ONLY
//
// /competitors is the handler to drive: past the gate it reads the project's
// crunchbase_uuid, finds none, and answers 412 without touching the network.
// So 404 means the gate refused and 412 means it allowed — a clean split with
// no external call and nothing stubbed.
// ---------------------------------------------------------------------------

test('crunchbase: founder reaches the project under its company, 404 under the other', async () => {
  const ok = await get(crunchbase, `/projects/${PROJECT_A}/competitors`, founder, COMPANY_A);
  assert.equal(ok.status, 412, 'past the gate: no crunchbase_uuid applied yet');
  const other = await get(crunchbase, `/projects/${PROJECT_A}/competitors`, founder, COMPANY_B);
  assert.equal(other.status, 404);
  assert.deepEqual(await other.json(), { error: 'not_found_or_forbidden' });
});

test('crunchbase: no company selected and a forged company both leave the founder unnarrowed', async () => {
  assert.equal((await get(crunchbase, `/projects/${PROJECT_A}/competitors`, founder)).status, 412,
    'no company selected means every project you own');
  assert.equal((await get(crunchbase, `/projects/${PROJECT_A}/competitors`, founder, 999)).status, 412,
    'a company the caller is not a member of resolves to null, never to access');
});

test('crunchbase: an unassigned project stays reachable under every company', async () => {
  for (const co of [COMPANY_A, COMPANY_B, undefined]) {
    assert.equal((await get(crunchbase, `/projects/${PROJECT_NONE}/competitors`, founder, co)).status, 412,
      `company_id IS NULL must stay visible (company=${co})`);
  }
});

test('crunchbase: admin is unscoped, and a partner is STILL refused', async () => {
  assert.equal((await get(crunchbase, `/projects/${PROJECT_B}/competitors`, admin, COMPANY_A)).status, 412,
    'admin is the only exemption this gate has ever had');
  // The stage-1/2 trap inverted. A partner IS exempt from company narrowing in
  // progress/financials/compliance/captable, and must NOT become exempt here:
  // this gate is admin-or-owner, so a partner was refused before this change
  // and must still be refused after it. Widening the exemption to match a
  // sibling file would have been a silent privilege escalation.
  assert.equal((await get(crunchbase, `/projects/${PROJECT_A}/competitors`, partner, AGENCY)).status, 404,
    'a partner has no write path here, with or without company scoping');
});

// ---------------------------------------------------------------------------
// contacts — the id LIST, not a loader
// ---------------------------------------------------------------------------

const uids = async (res: Response) => ((await res.json()) as any).items.map((i: any) => i.uid).sort();

test('contacts: the raise pipeline lists only the active company\'s prospects', async () => {
  const inA = await get(contacts, '/raise-prospects', founder, COMPANY_A);
  assert.equal(inA.status, 200);
  // 'pr-n' rides along under every company because its project is unassigned.
  assert.deepEqual(await uids(inA), ['pr-a', 'pr-n']);

  const inB = await get(contacts, '/raise-prospects', founder, COMPANY_B);
  assert.deepEqual(await uids(inB), ['pr-b', 'pr-n'], 'the other company shows its own, never A\'s');
});

test('contacts: no company selected still lists every project the founder owns', async () => {
  // The single-company case, and the case before the switcher is ever touched.
  // Returning nothing here would blank the pipeline for every existing user.
  assert.deepEqual(await uids(await get(contacts, '/raise-prospects', founder)), ['pr-a', 'pr-b', 'pr-n']);
});

test('contacts: a forged company id narrows nothing and widens nothing', async () => {
  // 999 is a real-looking id the founder is not a member of. resolveActiveCompany
  // checks it against user_company_links and yields null, so the answer must be
  // identical to sending no header at all.
  assert.deepEqual(await uids(await get(contacts, '/raise-prospects', founder, 999)),
    ['pr-a', 'pr-b', 'pr-n']);
  assert.deepEqual(await uids(await get(contacts, '/raise-prospects', founder, 'not-a-number')),
    ['pr-a', 'pr-b', 'pr-n']);
});

test('contacts: admin stays unscoped — the \'all\' branch is never narrowed', async () => {
  assert.deepEqual(await uids(await get(contacts, '/raise-prospects', admin, COMPANY_A)),
    ['pr-a', 'pr-b', 'pr-n'], "admin's 'all' must not become a company filter");
});
