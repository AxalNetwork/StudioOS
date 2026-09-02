/**
 * Company scoping: GET /api/pipeline/active — the Build desk's deal list.
 *
 * This endpoint feeds `api.pipelineActive()`, which the founder Build desk
 * uses for its board. It narrowed on `founder_id` but not on `company_id`,
 * so a founder who switched company in the sidebar still saw every project
 * they owned — the switcher visibly did nothing on that surface.
 *
 * Only the founder branch narrows. The admin branch is an oversight view of
 * every project; the partner/investor branch is a marketplace of non-rejected
 * deals. Both are intentionally left whole.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import pipeline from '../src/routes/pipeline.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = { user: 50, founder_id: 150 };
const ADMIN = 44;
const CO_A = 21;
const CO_B = 22;

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
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, sector TEXT, stage TEXT, status TEXT,
      founder_id INTEGER, company_id INTEGER, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    CREATE TABLE project_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      stage_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT
    );
    CREATE TABLE mvp_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      traction_score REAL, key_metrics TEXT, snapshot_date TEXT
    );
    CREATE TABLE decision_gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      status TEXT, ai_recommendation TEXT, final_decision TEXT, created_at TEXT
    );
    CREATE TABLE score_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      total_score REAL, tier TEXT, is_sandbox INTEGER DEFAULT 0,
      admin_review_status TEXT, integrity_hash TEXT, integrity_version INTEGER,
      created_at TEXT
    );
    CREATE TABLE mi_pro_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, status TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id, 'f@example.com');
  u.run(ADMIN, 'admin', null, 'a@example.com');
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?,?)');
  l.run(CO_A, FOUNDER.user);
  l.run(CO_B, FOUNDER.user);
  const p = db.prepare('INSERT INTO projects (id, name, sector, stage, status, founder_id, company_id) VALUES (?,?,?,?,?,?,?)');
  p.run(1, 'Alpha', 'saas', 'idea', 'active', FOUNDER.founder_id, CO_A);
  p.run(2, 'Beta', 'fintech', 'idea', 'active', FOUNDER.founder_id, CO_B);
  p.run(3, 'Gamma', 'health', 'idea', 'active', FOUNDER.founder_id, null);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, userId: number, role: string, companyId?: number) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(userId, role)}`,
  };
  if (companyId !== undefined) headers['X-Company-Id'] = String(companyId);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
  const res = await pipeline.request('/active', { headers }, env);
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}

test('founder sees only the active company\'s projects', async () => {
  const db = freshDb();
  const { status, body } = await call(db, FOUNDER.user, 'founder', CO_A);
  assert.equal(status, 200);
  const names = body.map((r: any) => r.name).sort();
  assert.deepEqual(names, ['Alpha', 'Gamma']); // CO_A + unassigned
});

test('founder with no company selected sees all owned projects', async () => {
  const db = freshDb();
  const { status, body } = await call(db, FOUNDER.user, 'founder');
  assert.equal(status, 200);
  const names = body.map((r: any) => r.name).sort();
  assert.deepEqual(names, ['Alpha', 'Beta', 'Gamma']);
});

test('admin branch is not narrowed by company', async () => {
  const db = freshDb();
  const { status, body } = await call(db, ADMIN, 'admin', CO_A);
  assert.equal(status, 200);
  const names = body.map((r: any) => r.name).sort();
  assert.deepEqual(names, ['Alpha', 'Beta', 'Gamma']);
});

test('forged company id is ignored', async () => {
  const db = freshDb();
  const { status, body } = await call(db, FOUNDER.user, 'founder', 999);
  assert.equal(status, 200);
  const names = body.map((r: any) => r.name).sort();
  assert.deepEqual(names, ['Alpha', 'Beta', 'Gamma']); // falls back to all owned
});
