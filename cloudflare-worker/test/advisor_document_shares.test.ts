/**
 * Task #104 — the writer `advisor_client_document_shares` never had.
 *
 * THE TASK NAMED THE WRONG TABLE. It reads "give migration 218's grant table a
 * writer", but `advisor_client_grants` has had one since #82: an `INSERT … ON
 * CONFLICT DO UPDATE` and a revoke, driven by `AdvisorGrantSection`. Migration
 * 218 ships THREE tables, and the two with gaps were the other two —
 * `advisor_client_document_shares` (a reader, no writer) and
 * `advisor_client_access_log` (a writer, no reader).
 *
 * That first gap was written down in three places and fixed in none:
 * `routes/research.ts` ("That table has a READER … and no WRITER"), DECISIONS
 * D50 ("A founder still cannot push a document to an advisor"), and
 * `LibraryZone`, which renders the consequence to the user.
 *
 * THE CONDITIONS ARE NOT ARBITRARY — THE READER DICTATES THEM. The brief joins
 * `s.advisor_user_id = ? AND s.status = 'active' AND d.owner_user_id IN (SELECT
 * id FROM users WHERE founder_id = ?)`. A row that misses any part of that can
 * never be read, so writing one would show the founder a document as shared
 * that the advisor cannot see. The grant requirement is the one the reader does
 * NOT enforce and the writer must: the brief is reached through the grant, so a
 * share without one is invisible to everybody.
 *
 * Real SQLite rather than a stub, for the reason `_d1_sqlite.mjs` gives: the
 * route's own query with its own binds decides which rows come back, so a
 * scoping regression fails because the wrong rows appear, not because a
 * substring moved. Every assertion below is about rows, not about text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import grants from '../src/routes/advisor_grants.ts';

const app = new Hono<any>();
app.route('/', grants);
app.onError((err: any, c) => {
  const status = ({ Unauthorized: 401 } as Record<string, 401>)[String(err?.message || '')];
  if (status) return c.json({ detail: err.message }, status);
  throw err;
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1;      // owns founder record 100 and project 'p-live'
const ADVISOR = 2;      // holds an active grant
const UNGRANTED = 3;    // an advisor with no grant on this project
const NOT_ADVISOR = 4;  // an investor, so every read would re-check and refuse
const OTHER_FOUNDER = 5;
const COFOUNDER = 6;   // a second account on founder record 100

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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT, sector TEXT,
      stage TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE research_documents (
      id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, title TEXT, kind TEXT,
      index_state TEXT, owner_user_id INTEGER, created_at TEXT
    );
    CREATE TABLE advisor_client_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER NOT NULL, advisor_user_id INTEGER NOT NULL,
      granted_by_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT, scope_project INTEGER NOT NULL DEFAULT 1,
      scope_data_room INTEGER NOT NULL DEFAULT 0, scope_sessions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (project_id, advisor_user_id)
    );
    CREATE TABLE advisor_client_document_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      document_id INTEGER NOT NULL, advisor_user_id INTEGER NOT NULL,
      shared_by_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (document_id, advisor_user_id)
    );
    CREATE TABLE advisor_client_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      advisor_user_id INTEGER NOT NULL, action TEXT NOT NULL, document_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role_in_company TEXT, is_primary_admin INTEGER DEFAULT 0
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 100, 'Fran', 'fran@example.com');
  u.run(ADVISOR, 'advisor', null, 'Avery', 'avery@example.com');
  u.run(UNGRANTED, 'advisor', null, 'Ungranted', 'ungranted@example.com');
  u.run(NOT_ADVISOR, 'investor', null, 'Ivan', 'ivan@example.com');
  u.run(OTHER_FOUNDER, 'founder', 200, 'Otto', 'otto@example.com');
  u.run(COFOUNDER, 'founder', 100, 'Cody', 'cody@example.com');

  const proj = db.prepare('INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?,?,?,?,?)');
  proj.run(7, 'p-live', 'Livewire', 100, null);
  // A project the OTHER founder legitimately owns. This is what makes the
  // cross-tenant revoke test possible: the attacker passes a projectUid they
  // really do own, so `ownedProject` lets them through and only the share's own
  // ownership clause stands between them and someone else's row.
  proj.run(8, 'p-other', 'Otherwise', 200, null);

  const d = db.prepare('INSERT INTO research_documents (id, uid, title, kind, owner_user_id, created_at) VALUES (?,?,?,?,?,?)');
  d.run(11, 'doc-mine', 'Teardown', 'note', FOUNDER, '2026-09-01');
  // Someone else's document, with a perfectly valid uid. The writer must refuse
  // it, and the reason is the brief's own join rather than politeness.
  d.run(12, 'doc-theirs', 'Not yours', 'note', OTHER_FOUNDER, '2026-09-01');

  db.prepare(
    `INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, status)
     VALUES (?,?,?,?,'active')`,
  ).run('g-1', 7, ADVISOR, FOUNDER);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string } | null, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await token(who.user, who.role)}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await app.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const founder = { user: FOUNDER, role: 'founder' };
const rows = (db: any) => db.prepare('SELECT * FROM advisor_client_document_shares').all();

test('a founder can share their own document with a granted advisor', async () => {
  const db = freshDb();
  const r = await call(env(db), 'POST', '/p-live/documents', founder,
    { email: 'avery@example.com', document_uid: 'doc-mine' });

  assert.equal(r.status, 201);
  const all = rows(db);
  assert.equal(all.length, 1, 'exactly one share row');
  assert.equal(all[0].document_id, 11);
  assert.equal(all[0].advisor_user_id, ADVISOR);
  assert.equal(all[0].shared_by_user_id, FOUNDER);
  assert.equal(all[0].status, 'active');
});

test('the row it writes is one the brief can actually read', async () => {
  // The point of the whole task. A share that does not satisfy the reader's
  // join is worse than no share: the founder sees it listed and the advisor
  // sees nothing. This runs the brief's own predicate against the written row.
  const db = freshDb();
  await call(env(db), 'POST', '/p-live/documents', founder,
    { email: 'avery@example.com', document_uid: 'doc-mine' });

  const visible = db.prepare(
    `SELECT d.uid FROM advisor_client_document_shares s
       JOIN research_documents d ON d.id = s.document_id
      WHERE s.advisor_user_id = ? AND s.status = 'active'
        AND d.owner_user_id IN (SELECT id FROM users WHERE founder_id = ?)`,
  ).all(ADVISOR, 100);
  assert.deepEqual(visible.map((r: any) => r.uid), ['doc-mine']);
});

test("a document the founder does not own is refused, whatever its uid", async () => {
  const db = freshDb();
  const r = await call(env(db), 'POST', '/p-live/documents', founder,
    { email: 'avery@example.com', document_uid: 'doc-theirs' });
  assert.equal(r.status, 404);
  assert.equal(rows(db).length, 0);
});

test('an advisor with no grant on this project is refused', async () => {
  // The condition the reader cannot enforce: the brief is reached THROUGH the
  // grant, so this row would be written and then be unreadable forever.
  const db = freshDb();
  const r = await call(env(db), 'POST', '/p-live/documents', founder,
    { email: 'ungranted@example.com', document_uid: 'doc-mine' });
  assert.equal(r.status, 400);
  assert.match(String(r.body?.detail), /no live grant/i);
  assert.equal(rows(db).length, 0);
});

test('a revoked grant is not a grant', async () => {
  const db = freshDb();
  db.prepare("UPDATE advisor_client_grants SET status = 'revoked' WHERE uid = 'g-1'").run();
  const r = await call(env(db), 'POST', '/p-live/documents', founder,
    { email: 'avery@example.com', document_uid: 'doc-mine' });
  assert.equal(r.status, 400);
  assert.equal(rows(db).length, 0);
});

test('an expired grant is not a grant either', async () => {
  const db = freshDb();
  db.prepare("UPDATE advisor_client_grants SET expires_at = '2020-01-01' WHERE uid = 'g-1'").run();
  const r = await call(env(db), 'POST', '/p-live/documents', founder,
    { email: 'avery@example.com', document_uid: 'doc-mine' });
  assert.equal(r.status, 400);
  assert.equal(rows(db).length, 0);
});

test('an account that is not an advisor now is refused', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, status) VALUES (?,?,?,?,?)')
    .run('g-2', 7, NOT_ADVISOR, FOUNDER, 'active');
  const r = await call(env(db), 'POST', '/p-live/documents', founder,
    { email: 'ivan@example.com', document_uid: 'doc-mine' });
  assert.equal(r.status, 400);
  assert.match(String(r.body?.detail), /not an advisor/i);
  assert.equal(rows(db).length, 0);
});

test("another founder cannot share into someone else's project", async () => {
  const db = freshDb();
  const r = await call(env(db), 'POST', '/p-live/documents',
    { user: OTHER_FOUNDER, role: 'founder' }, { email: 'avery@example.com', document_uid: 'doc-mine' });
  assert.equal(r.status, 404, 'not 403 — not yours and not found are the same answer');
  assert.equal(rows(db).length, 0);
});

test('sharing the same document twice updates rather than duplicating', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });
  await call(e, 'DELETE', `/p-live/documents/${rows(db)[0].uid}`, founder);
  assert.equal(rows(db)[0].status, 'revoked');

  const again = await call(e, 'POST', '/p-live/documents', founder,
    { email: 'avery@example.com', document_uid: 'doc-mine' });
  assert.equal(again.status, 201);
  const all = rows(db);
  assert.equal(all.length, 1, 'the UNIQUE(document_id, advisor_user_id) pair stays one row');
  assert.equal(all[0].status, 'active', 're-sharing revives the row');
});

test('revoke is a state, never a delete', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });
  const uid = rows(db)[0].uid;
  const r = await call(e, 'DELETE', `/p-live/documents/${uid}`, founder);

  assert.equal(r.status, 200);
  const all = rows(db);
  assert.equal(all.length, 1, 'the row survives — the access log points at it');
  assert.equal(all[0].status, 'revoked');
});

test('a revoked share stops being readable by the brief', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });
  await call(e, 'DELETE', `/p-live/documents/${rows(db)[0].uid}`, founder);

  const visible = db.prepare(
    `SELECT d.uid FROM advisor_client_document_shares s
       JOIN research_documents d ON d.id = s.document_id
      WHERE s.advisor_user_id = ? AND s.status = 'active'`,
  ).all(ADVISOR);
  assert.deepEqual(visible, []);
});

test('another founder cannot revoke a share they did not make', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });
  const uid = rows(db)[0].uid;
  const r = await call(e, 'DELETE', `/p-live/documents/${uid}`, { user: OTHER_FOUNDER, role: 'founder' });
  assert.equal(r.status, 404);
  assert.equal(rows(db)[0].status, 'active', 'the share is untouched');
});

test('the list shows only this founder\'s live shares, and flags a demoted advisor', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });

  let r = (await call(e, 'GET', '/p-live/documents', founder)).body;
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].document_uid, 'doc-mine');
  assert.equal(r.items[0].advisor_is_advisor, true);

  // Same surfacing the grant list does: the share is inert once the role is
  // gone, and the founder should see that rather than believe it is being read.
  db.prepare("UPDATE users SET role = 'founder' WHERE id = ?").run(ADVISOR);
  r = (await call(e, 'GET', '/p-live/documents', founder)).body;
  assert.equal(r.items[0].advisor_is_advisor, false);
});

test('the access log finally has a reader', async () => {
  // It had an INSERT since #82 and nothing that read it, so the founder-facing
  // record migration 218 describes did not exist.
  const db = freshDb();
  db.prepare("INSERT INTO advisor_client_access_log (project_id, advisor_user_id, action) VALUES (?,?,'open_brief')")
    .run(7, ADVISOR);
  const r = (await call(env(db), 'GET', '/p-live/access-log', founder)).body;
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].action, 'open_brief');
  assert.equal(r.items[0].advisor_email, 'avery@example.com');
});

test("another founder cannot read this project's access log", async () => {
  const db = freshDb();
  db.prepare("INSERT INTO advisor_client_access_log (project_id, advisor_user_id, action) VALUES (?,?,'open_brief')")
    .run(7, ADVISOR);
  const r = await call(env(db), 'GET', '/p-live/access-log', { user: OTHER_FOUNDER, role: 'founder' });
  assert.equal(r.status, 404);
});

test('no search namespace is widened, D37 still holds', () => {
  // Adding `research_doc` to `ALL_ENTITY_TYPES` would publish every user's
  // private documents to every other user's global search box, "in one line
  // that looks exactly like following the existing pattern". The new writer is
  // exactly where that shortcut would look reasonable.
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
  const routes = strip(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/advisor_grants.ts'), 'utf8'));
  const search = strip(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/search.ts'), 'utf8'));
  assert.doesNotMatch(routes, /searchSemantic|ALL_ENTITY_TYPES|researchNamespace/);
  assert.doesNotMatch(search, /advisor_client_document_shares/);
});

test('a co-founder on the same record can see and revoke the share', async () => {
  // Found by mutation, twice over. Scoping the list and the revoke to
  // `shared_by_user_id = user.id` passed everything, because the only caller
  // who could reach that clause was already refused by `ownedProject` — so the
  // clause was untested AND wrong: a founder record can be held by more than
  // one account, and the grant revoke beside it is project-scoped.
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });

  const cofounder = { user: COFOUNDER, role: 'founder' };
  const seen = (await call(e, 'GET', '/p-live/documents', cofounder)).body;
  assert.equal(seen.items.length, 1, 'a co-founder sees the record\'s shares');

  const r = await call(e, 'DELETE', `/p-live/documents/${rows(db)[0].uid}`, cofounder);
  assert.equal(r.status, 200);
  assert.equal(rows(db)[0].status, 'revoked');
});

test('a revoked share disappears from the founder\'s list', async () => {
  // The list filters on `status = 'active'`; dropping that filter passed every
  // other test here, because none of them ever listed after a revoke.
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });
  assert.equal((await call(e, 'GET', '/p-live/documents', founder)).body.items.length, 1);

  await call(e, 'DELETE', `/p-live/documents/${rows(db)[0].uid}`, founder);
  const after = (await call(e, 'GET', '/p-live/documents', founder)).body;
  assert.deepEqual(after.items, [], 'a revoked share is not a live share');
  assert.equal(rows(db).length, 1, 'and the row is still there — revoke is a state');
});

test('a founder cannot revoke a stranger\'s share by naming their OWN project', async () => {
  // FOUND BY MUTATION, AND IT IS THE ONE THAT MATTERS. Dropping the ownership
  // clause from the revoke entirely — `WHERE uid = ?` — passed every test here,
  // because every existing case was refused earlier by `ownedProject`.
  //
  // It is refused there only when the attacker names someone else's project.
  // Name your OWN project and a stranger's share uid, and `ownedProject`
  // happily lets you through: the share table has no project_id, so the
  // share's own clause is the ONLY thing standing between one tenant and
  // another tenant's row.
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/p-live/documents', founder, { email: 'avery@example.com', document_uid: 'doc-mine' });
  const victim = rows(db)[0].uid;

  const r = await call(e, 'DELETE', `/p-other/documents/${victim}`, { user: OTHER_FOUNDER, role: 'founder' });

  assert.equal(r.status, 404);
  assert.equal(rows(db)[0].status, 'active', "another tenant's share is untouched");
});
