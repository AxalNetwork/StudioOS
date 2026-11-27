/**
 * D8526 (#8526) — a selected company is never authorization.
 *
 * Three accounts:
 *   A  owns two companies, Northwind (1) and Southwind (2), each holding a venture (10, 20).
 *   B  is a member of Northwind and holds a co-founder seat on venture 10.
 *   C  has no access to anything here.
 *
 * Four target route classes on venture 10, each a route in the company-scope
 * inventory:
 *   read settings   GET  /api/captable/record/10
 *   write settings  POST /api/captable/record/10/proposals   (an allowed write fails validation: 400)
 *   export          GET  /api/captable/record/10/export.csv
 *   download        POST /api/data-room/p-10/files/f-10/download
 *
 * After each event below, the very next request is checked against the grants as they now stand:
 *   - B's seat is revoked;
 *   - Northwind is archived;
 *   - venture 10 is moved to Southwind;
 *   - a header names another company (forged or stale).
 *
 * The rules each check holds:
 *   - **A header never widens access.** Whatever `X-Company-Id` a caller sends (none, their own company, a stale
 *     one, another account's, garbage), the answer is never more permissive than the answer with no header. For
 *     B and C, who own no company here, it is the same answer.
 *   - **A revoked seat is refused** on all four classes, even when B still belongs to the venture's company and
 *     sends it as the selection.
 *   - **C is refused throughout,** and C's refusal for venture 10 is exactly the refusal for a venture that does
 *     not exist, so it never reveals whether the resource exists.
 *
 * The full migrated schema, built once per run (`_schema_once.mjs`). Every person and company is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import dataRoom from '../src/routes/data_room.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { openSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d8526-0123456789-abcdef';
const A = 1, B = 2, C = 3;
const NORTH = 1, SOUTH = 2;

const app = new Hono();
app.route('/api/captable', captable);
app.route('/api/data-room', dataRoom);

function fixture() {
  const db = openSchema();
  const u = db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  u.run(A, 'u-a', 'ada@example.test', 'Ada Made-up', 'founder', 100, 'studio');
  u.run(B, 'u-b', 'ben@example.test', 'Ben Made-up', 'founder', 200, 'studio');
  u.run(C, 'u-c', 'cy@example.test', 'Cy Made-up', 'founder', 300, 'studio');
  db.exec(`
    INSERT INTO company_profiles (id, uid, company_name) VALUES (${NORTH}, 'co-north', 'Northwind'), (${SOUTH}, 'co-south', 'Southwind');
    INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES
      ('l-1', ${NORTH}, ${A}, 'Owner', 1), ('l-2', ${SOUTH}, ${A}, 'Owner', 1), ('l-3', ${NORTH}, ${B}, 'Member', 0);
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES
      (10, 'p-10', 'Made-up venture', 100, ${NORTH}), (20, 'p-20', 'Other made-up venture', 100, ${SOUTH});
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (10, ${A}, 'owner', 'accepted'), (10, ${B}, 'cofounder', 'accepted');
    INSERT INTO data_room_files (id, uid, project_id, name, r2_key, visibility) VALUES (1, 'f-10', 10, 'Made-up plan.pdf', 'data-room/p-10/plan.pdf', 'open');
  `);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: { put: async () => {}, delete: async () => {}, get: async () => null } };
  return { db, env };
}

type Class = 'read' | 'write' | 'export' | 'download';
const CLASSES: Class[] = ['read', 'write', 'export', 'download'];
const ROUTES: Record<Class, (p: { id: number; uid: string; file: string }) => [string, string, unknown?]> = {
  read: (p) => ['GET', `/api/captable/record/${p.id}`],
  write: (p) => ['POST', `/api/captable/record/${p.id}/proposals`, {}],
  export: (p) => ['GET', `/api/captable/record/${p.id}/export.csv`],
  download: (p) => ['POST', `/api/data-room/${p.uid}/files/${p.file}/download`],
};
const V10 = { id: 10, uid: 'p-10', file: 'f-10' };
const MISSING = { id: 99, uid: 'p-99', file: 'f-99' };

async function call(env: any, who: number, cls: Class, header: string | null, p = V10) {
  const [method, path, body] = ROUTES[cls](p);
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (header != null) headers['X-Company-Id'] = header;
  const res = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: res.status, text: await res.text() };
}

/** Granted: the read, export or download answered, or the write got past the gate to validation. */
const granted = (cls: Class, status: number) => status === 200 || (cls === 'write' && status === 400);
const refused = (status: number) => status === 403 || status === 404;

/** Every header a caller might send: none, each company, a missing one and garbage. */
const HEADERS = [null, String(NORTH), String(SOUTH), '999', 'abc', `${NORTH} OR 1=1`];

/** The header rules for one caller after one event: never wider than no header; for B and C, identical. */
async function headerNeverWidens(env: any, who: number, label: string) {
  const out: Record<string, Record<string, number>> = {};
  for (const cls of CLASSES) {
    const plain = await call(env, who, cls, null);
    out[cls] = {};
    for (const h of HEADERS) {
      const r = await call(env, who, cls, h);
      out[cls][String(h)] = r.status;
      if (granted(cls, r.status)) assert.ok(granted(cls, plain.status), `${label}: ${cls} with X-Company-Id ${h} granted what no header refuses (${r.status} vs ${plain.status})`);
      if (who !== A) assert.equal(r.status, plain.status, `${label}: ${cls} with X-Company-Id ${h} answered ${r.status}, without it ${plain.status}`);
    }
  }
  return out;
}

/** C is refused on every class, with exactly the refusal a venture that does not exist gets. */
async function cRefusedBlind(env: any, label: string) {
  for (const cls of CLASSES) {
    for (const h of [null, String(NORTH)]) {
      const real = await call(env, C, cls, h);
      const none = await call(env, C, cls, h, MISSING);
      assert.ok(refused(real.status), `${label}: C ${cls} answered ${real.status}`);
      assert.deepEqual(real, none, `${label}: C's refusal for venture 10 differs from a missing venture's, so it reveals it exists`);
    }
  }
}

test('before any change: A and B hold their grants, a header never widens them, and C is refused blind', async () => {
  const { db, env } = fixture();
  try {
    for (const cls of CLASSES) assert.ok(granted(cls, (await call(env, A, cls, null)).status), `A ${cls}`);
    // A co-founder reads, exports and downloads, and may propose (D5074): every class is granted.
    for (const cls of CLASSES) assert.ok(granted(cls, (await call(env, B, cls, null)).status), `B ${cls}`);
    await headerNeverWidens(env, A, 'baseline');
    await headerNeverWidens(env, B, 'baseline');
    await cRefusedBlind(env, 'baseline');
  } finally { db.close(); }
});

test('B\'s seat is revoked: the very next request is refused on every class, whatever company B selects', async () => {
  const { db, env } = fixture();
  try {
    for (const cls of CLASSES) assert.ok(granted(cls, (await call(env, B, cls, String(NORTH))).status), `B ${cls} before`);
    db.prepare("UPDATE project_members SET status = 'removed' WHERE project_id = 10 AND user_id = ?").run(B);
    for (const cls of CLASSES) {
      for (const h of HEADERS) {
        const r = await call(env, B, cls, h);
        assert.ok(refused(r.status), `B ${cls} with X-Company-Id ${h} after the revoke answered ${r.status}`);
      }
    }
    await headerNeverWidens(env, B, 'revoked');
    await cRefusedBlind(env, 'revoked');
  } finally { db.close(); }
});

test('Northwind is archived: no selection of it changes anything, and C stays refused', async () => {
  const { db, env } = fixture();
  try {
    db.prepare("UPDATE company_profiles SET archived_at = datetime('now') WHERE id = ?").run(NORTH);
    await headerNeverWidens(env, A, 'archived');
    await headerNeverWidens(env, B, 'archived');
    await cRefusedBlind(env, 'archived');
  } finally { db.close(); }
});

test('venture 10 is moved to Southwind: a stale Northwind selection neither keeps nor widens access', async () => {
  const { db, env } = fixture();
  try {
    db.prepare('UPDATE projects SET company_id = ? WHERE id = 10').run(SOUTH);
    // A, its owner, with the stale selection: narrowed to Northwind, which no longer holds it. Never wider.
    await headerNeverWidens(env, A, 'moved');
    for (const cls of CLASSES) {
      assert.ok(refused((await call(env, A, cls, String(NORTH))).status), `A ${cls} with the stale Northwind selection`);
      assert.ok(granted(cls, (await call(env, A, cls, String(SOUTH))).status), `A ${cls} with Southwind selected`);
      assert.ok(granted(cls, (await call(env, A, cls, null)).status), `A ${cls} with no selection`);
    }
    // B keeps the seat, which the move does not touch, and B's Northwind selection changes nothing.
    for (const cls of CLASSES) assert.ok(granted(cls, (await call(env, B, cls, String(NORTH))).status), `B ${cls} after the move`);
    await headerNeverWidens(env, B, 'moved');
    await cRefusedBlind(env, 'moved');
  } finally { db.close(); }
});

test('a header naming another company: C forging Northwind, B naming Southwind, A naming a company that does not hold the venture', async () => {
  const { db, env } = fixture();
  try {
    // C belongs to no company: a forged Northwind is ignored, and C stays refused blind.
    await cRefusedBlind(env, 'forged');
    // C joins Southwind only. Naming Southwind is now a verified selection, and still grants nothing on venture 10.
    db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l-4', ?, ?, 'Member', 0)").run(SOUTH, C);
    await headerNeverWidens(env, C, 'C in Southwind');
    for (const cls of CLASSES) assert.ok(refused((await call(env, C, cls, String(SOUTH))).status), `C ${cls} with Southwind selected`);
    // C joins Northwind too, the venture's own company, with no seat on it: a member's selection is still not a grant.
    db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l-5', ?, ?, 'Member', 0)").run(NORTH, C);
    for (const cls of CLASSES) assert.ok(refused((await call(env, C, cls, String(NORTH))).status), `C ${cls} with Northwind selected`);
    await headerNeverWidens(env, B, 'forged');
    await headerNeverWidens(env, A, 'forged');
  } finally { db.close(); }
});
