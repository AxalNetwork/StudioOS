/**
 * D452 — GET /admin/deployments persists last_version from branch health.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminDeployments from '../src/routes/admin_deployments.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;

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
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
      d1_jurisdiction TEXT, location_hint TEXT, residency_requested TEXT, residency_granted TEXT,
      status TEXT NOT NULL DEFAULT 'requested', status_note TEXT, rpc_secret_hash TEXT,
      provision_run_id TEXT, requested_by_user_id INTEGER,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')), live_at TEXT,
      last_health_at TEXT, last_health_ok INTEGER, last_version TEXT, updated_at TEXT);
  `);
  db.prepare('INSERT INTO users (id, role, email) VALUES (?,?,?)').run(ADMIN, 'admin', 'a@x.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (?, ?, 'totp', 'totp')`,
  ).run(ADMIN, `totp-${ADMIN}`);
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES ('lic_fr','fr','fr.axal.vc','studioos-fr','studioos-fr','worker_live')`,
  ).run();
  return db;
}

const app = new Hono<any>();
app.route('/api/admin', adminDeployments);
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  return c.json({ detail: msg }, 403);
});

async function token() {
  return new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

test('a successful health read writes last_version on the deployment row', async () => {
  const db = freshDb();
  const env: any = {
    DB: makeD1(db),
    JWT_SECRET,
    ENVIRONMENT: 'development',
    GITHUB_REPO_OWNER: 'o',
    GITHUB_REPO_NAME: 'r',
    BRANCH_FR: {
      health: async () => ({
        ok: true,
        db_ok: true,
        licence_status: 'active',
        licence_pushed_at: null,
        deploy_version: 'abc123def',
        branch: 'fr',
        as_of: '2026-09-27T10:00:00.000Z',
      }),
    },
  };
  const res = await app.request('/api/admin/deployments', {
    headers: { Authorization: `Bearer ${await token()}` },
  }, env);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => null)));
  const body = await res.json() as any;
  assert.equal(body.registry_available, true);
  assert.equal(body.deployments.length, 1);
  assert.equal(body.deployments[0].live_state, 'ok');
  assert.equal(body.deployments[0].live.deploy_version, 'abc123def');

  const row = db.prepare('SELECT last_version, last_health_ok FROM licence_deployments WHERE code = ?')
    .get('fr') as any;
  assert.equal(row.last_version, 'abc123def');
  assert.equal(row.last_health_ok, 1);
  assert.equal(body.deployments[0].version_display, 'abc123def');
});

test('live deploy_version wins over a stale last_version in the payload', async () => {
  const db = freshDb();
  db.prepare('UPDATE licence_deployments SET last_version = ? WHERE code = ?').run('stale-sha', 'fr');
  const env: any = {
    DB: makeD1(db),
    JWT_SECRET,
    ENVIRONMENT: 'development',
    GITHUB_REPO_OWNER: 'o',
    GITHUB_REPO_NAME: 'r',
    BRANCH_FR: {
      health: async () => ({
        ok: true,
        db_ok: true,
        licence_status: 'active',
        licence_pushed_at: null,
        deploy_version: 'live-sha',
        branch: 'fr',
        as_of: '2026-09-27T10:00:00.000Z',
      }),
    },
  };
  const res = await app.request('/api/admin/deployments', {
    headers: { Authorization: `Bearer ${await token()}` },
  }, env);
  const body = await res.json() as any;
  assert.equal(body.deployments[0].version_display, 'live-sha');
  const row = db.prepare('SELECT last_version FROM licence_deployments WHERE code = ?').get('fr') as any;
  assert.equal(row.last_version, 'live-sha');
});

test('a null deploy_version from the branch does not erase a stored last_version', async () => {
  const db = freshDb();
  db.prepare('UPDATE licence_deployments SET last_version = ? WHERE code = ?').run('kept-sha', 'fr');
  const env: any = {
    DB: makeD1(db),
    JWT_SECRET,
    ENVIRONMENT: 'development',
    GITHUB_REPO_OWNER: 'o',
    GITHUB_REPO_NAME: 'r',
    BRANCH_FR: {
      health: async () => ({
        ok: true,
        db_ok: true,
        licence_status: 'active',
        licence_pushed_at: null,
        deploy_version: null,
        branch: 'fr',
        as_of: '2026-09-27T10:00:00.000Z',
      }),
    },
  };
  await app.request('/api/admin/deployments', {
    headers: { Authorization: `Bearer ${await token()}` },
  }, env);
  const row = db.prepare('SELECT last_version FROM licence_deployments WHERE code = ?').get('fr') as any;
  assert.equal(row.last_version, 'kept-sha');
});
