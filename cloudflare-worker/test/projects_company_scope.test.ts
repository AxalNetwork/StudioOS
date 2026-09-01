/**
 * Company scoping, stage 4: GET /api/projects — the project picker itself.
 *
 * This is the handler that makes the switcher visibly do something. Every
 * founder surface renders a project picker from `api.listProjects()`, so
 * narrowing it is what turns "the company selects a profile" into "the company
 * selects a workspace".
 *
 * It is also the one place the ownership/membership distinction bites. The
 * founder branch is a UNION:
 *
 *     projects I own            (founder_id = mine)
 *   OR projects I am a member of (accepted co-founder / advisor)
 *
 * A member project belongs to ANOTHER founder, so its `company_id` is that
 * founder's company — an id mine can never equal. Narrowing the whole WHERE
 * would erase every project a co-founder works on the moment they select one of
 * their own companies, and they could not fix it by switching, because they are
 * not a member of the owning founder's company at all. So only the ownership
 * arm carries the company clause. These tests pin both halves: owned projects
 * narrow, member projects do not.
 *
 * Harness matches stages 1-3: the real router against real in-memory SQLite
 * with a real `user_company_links` table, so `resolveActiveCompany` runs
 * unmocked and a forged header is refused by the code prod uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import projects from '../src/routes/projects.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = { user: 42, founder_id: 99 };
const OTHER = { user: 50, founder_id: 150 };   // owns the project FOUNDER joined
const PARTNER = { user: 43 };
const ADMIN = { user: 44 };
const COMPANY_A = 3;
const COMPANY_B = 5;      // the founder's OTHER company
const OTHER_CO = 61;      // the other founder's company — FOUNDER is not a member
const AGENCY = 77;
const OWNED_A = 7;
const OWNED_B = 9;
const OWNED_NONE = 11;    // no company_id — unassigned
const MEMBER_OF = 13;     // owned by OTHER, in OTHER_CO, FOUNDER is a member

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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      spinout_lab_active INTEGER, subscription_tier TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER,
      company_id INTEGER, status TEXT, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    -- The shape ensureProjectMembershipSchema would create, verbatim. A table
    -- that merely resembles it blocks its CREATE TABLE IF NOT EXISTS and then
    -- fails one of its three index statements.
    CREATE TABLE project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'cofounder',
      status TEXT NOT NULL DEFAULT 'accepted',
      source TEXT, invitation_id INTEGER, cofounder_connection_id INTEGER,
      added_by_user_id INTEGER, accepted_at TEXT, removed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id);
  u.run(OTHER.user, 'founder', OTHER.founder_id);
  u.run(PARTNER.user, 'partner', null);
  u.run(ADMIN.user, 'admin', null);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, ?, ?, ?)');
  p.run(OWNED_A, 'Owned in A', FOUNDER.founder_id, COMPANY_A);
  p.run(OWNED_B, 'Owned in B', FOUNDER.founder_id, COMPANY_B);
  p.run(OWNED_NONE, 'Owned unassigned', FOUNDER.founder_id, null);
  p.run(MEMBER_OF, 'Someone else, joined', OTHER.founder_id, OTHER_CO);
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)');
  l.run(COMPANY_A, FOUNDER.user); l.run(COMPANY_B, FOUNDER.user);
  l.run(OTHER_CO, OTHER.user); l.run(AGENCY, PARTNER.user);
  db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')")
    .run(MEMBER_OF, FOUNDER.user);
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

async function list(who: Who, company?: number | string): Promise<number[]> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const res = await projects.request('/', { headers }, env(freshDb()));
  assert.equal(res.status, 200);
  return ((await res.json()) as any[]).map((p) => p.id).sort((a, b) => a - b);
}

test('owned projects narrow to the active company', async () => {
  assert.deepEqual(await list(founder, COMPANY_A), [OWNED_A, OWNED_NONE, MEMBER_OF]);
  assert.deepEqual(await list(founder, COMPANY_B), [OWNED_B, OWNED_NONE, MEMBER_OF]);
});

test('THE TRAP — a project you joined survives switching to your own company', async () => {
  // MEMBER_OF belongs to another founder and sits in OTHER_CO, a company this
  // caller is not a member of. If the company clause were applied to the whole
  // union instead of the ownership arm, this project would vanish under every
  // company the caller can select, with no way to reach it again.
  for (const co of [COMPANY_A, COMPANY_B, undefined, 999]) {
    assert.ok((await list(founder, co)).includes(MEMBER_OF),
      `membership must survive company=${co}`);
  }
});

test('an unassigned project stays visible under every company', async () => {
  for (const co of [COMPANY_A, COMPANY_B, undefined]) {
    assert.ok((await list(founder, co)).includes(OWNED_NONE), `company=${co}`);
  }
});

test('no company selected, and a forged one, both list every owned project', async () => {
  const all = [OWNED_A, OWNED_B, OWNED_NONE, MEMBER_OF];
  assert.deepEqual(await list(founder), all, 'no company selected');
  assert.deepEqual(await list(founder, 999), all, 'a company the caller is not a member of');
  assert.deepEqual(await list(founder, 'not-a-number'), all, 'unparseable');
});

test('privileged roles are unscoped — they never owned a company_id to match', async () => {
  const all = [OWNED_A, OWNED_B, OWNED_NONE, MEMBER_OF];
  assert.deepEqual(await list(admin, COMPANY_A), all, 'admin');
  assert.deepEqual(await list(partner, AGENCY), all, "partner, under their own agency");
});
