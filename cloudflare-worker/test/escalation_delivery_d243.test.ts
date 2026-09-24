/**
 * D243 — a raise key so a retry is the same escalation, and a resend of the
 * stored decision.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/escalation_delivery_d243.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminEscalations from '../src/routes/admin_escalations.ts';
import branchEscalationRoutes from '../src/routes/branch_escalations.ts';
import { recordEscalation } from '../src/rpc/hqOps.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

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
  };
}

function hqDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
    jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`);
  db.exec(`CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live', rpc_secret_hash TEXT);
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL DEFAULT 'subsidiary' CHECK (kind IN ('subsidiary', 'white_label')));`);
  db.exec(read('cloudflare-worker/sql/migrations/259_hq_escalations.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/261_branch_escalations.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/288_escalation_delivery.sql'));
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(7, 'admin', 'Sue Hart', 'sue@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(7);
  db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name) VALUES (?,?,?,?,?)`)
    .run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  db.prepare('INSERT INTO territory_licences (uid) VALUES (?)').run('lic_fr');
  return db;
}

function branchDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
    jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.exec('CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT, pushed_at TEXT);');
  db.exec(read('cloudflare-worker/sql/migrations/259_hq_escalations.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/261_branch_escalations.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/288_escalation_delivery.sql'));
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(7, 'admin', 'Sue Hart', 'sue@axal.example');
  db.prepare('INSERT INTO branch_licence (id, status, pushed_at) VALUES (1,?,?)').run('suspended', '2026-09-15T00:00:00Z');
  return db;
}

async function token() {
  return new SignJWT({ user_id: 7, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

test('the same raise key records one escalation', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db) } as any;
  const item = { kind: 'other', subject: 'A question', raise_key: 'raise_key_one' };
  const first = await recordEscalation(env, 'fr', item);
  const second = await recordEscalation(env, 'fr', item);
  assert.equal(second.uid, first.uid);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hq_escalations').get() as any).n, 1);
});

test('a suspended branch retries its own undelivered row with the same key', async () => {
  const db = branchDb();
  const seen: any[] = [];
  const app = new Hono<any>();
  app.route('/api/branch', branchEscalationRoutes);
  const env = {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr',
    HQ: {
      async escalate(code: string, item: any) {
        seen.push({ code, item });
        if (seen.length === 1) throw new Error('binding unreachable');
        return { uid: 'esc_same', due_at: '2026-09-20T00:00:00Z', status: 'open' };
      },
    },
  };
  const call = async (path: string, init: RequestInit) => {
    const res = await app.request(`/api/branch${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const raised = await call('/escalations', {
    method: 'POST', body: JSON.stringify({ kind: 'other', subject: 'Please look' }),
  });
  assert.equal(raised.status, 201);
  assert.equal(raised.body.status, 'undelivered');
  const key = (db.prepare('SELECT raise_key FROM branch_escalations WHERE id = ?').get(raised.body.id) as any).raise_key;
  assert.equal(seen[0].item.raise_key, key);

  const retry = await call(`/escalations/${raised.body.id}/retry`, { method: 'POST', body: '{}' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.hq_uid, 'esc_same');
  assert.equal(retry.body.status, 'open');
  assert.equal(seen[1].item.raise_key, key);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM branch_escalations').get() as any).n, 1);
});

test('the retry route is not suspension-gated', () => {
  const src = read('cloudflare-worker/src/routes/branch_escalations.ts');
  const at = src.indexOf("r.post('/escalations/:id/retry'");
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf('export default', at));
  assert.equal(body.includes('requireBranchNotSuspended'), false);
});

test('send again pushes the stored answer and ignores a new one', async () => {
  const db = hqDb();
  const seen: any[] = [];
  db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, answer, answered_by_name, answered_at)
     VALUES ('esc_1', 'fr', 'other', 'A question', 'answered', 'The stored decision', 'Sue Hart', '2026-09-20T00:00:00Z')`,
  ).run();
  const app = new Hono<any>();
  app.route('/api/admin', adminEscalations);
  const env = {
    DB: makeD1(db), JWT_SECRET,
    BRANCH_FR: { async applyEscalationAnswer(a: any) { seen.push(a); return { ok: true }; } },
  };
  const res = await app.request('/api/admin/escalations/esc_1/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ answer: 'A different decision', status: 'declined' }),
  }, env);
  const body = await res.json() as any;
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].answer, 'The stored decision');
  assert.equal(seen[0].status, 'answered');
  assert.equal(body.answer, 'The stored decision');
  const row = db.prepare('SELECT answer, status, push_ok FROM hq_escalations WHERE uid = ?').get('esc_1') as any;
  assert.equal(row.answer, 'The stored decision');
  assert.equal(row.status, 'answered');
  assert.equal(row.push_ok, 1);
});

test('send again with no stored decision is refused and pushes nothing', async () => {
  const db = hqDb();
  const seen: any[] = [];
  db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status)
     VALUES ('esc_open', 'fr', 'other', 'Still open', 'open')`,
  ).run();
  const app = new Hono<any>();
  app.route('/api/admin', adminEscalations);
  const env = {
    DB: makeD1(db), JWT_SECRET,
    BRANCH_FR: { async applyEscalationAnswer(a: any) { seen.push(a); return { ok: true }; } },
  };
  const res = await app.request('/api/admin/escalations/esc_open/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
  }, env);
  const body = await res.json() as any;
  assert.equal(res.status, 400);
  assert.equal(body.error, 'no_decision');
  assert.equal(seen.length, 0);
  const row = db.prepare('SELECT answer, push_ok FROM hq_escalations WHERE uid = ?').get('esc_open') as any;
  assert.equal(row.answer, null);
  assert.equal(row.push_ok, null);
});
