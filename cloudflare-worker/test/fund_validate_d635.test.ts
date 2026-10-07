/**
 * D635 — a venture decision is kept, interview evidence is written on the
 * row, and a claim's pain link can be removed. Real SQLite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import founderValidate from '../src/routes/founder_validate.ts';
import { ensurePainGroupsSchema } from '../src/services/painGroups.ts';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 501;
const FOUNDER_ID = 77;
const PARTNER = 503;
const PROJECT = 9001;

function table(name: string, tableName: string): string {
  const src = readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
  const at = src.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`);
  assert.ok(at >= 0, `${tableName} left migration ${name}`);
  return src.slice(at, src.indexOf(');', at) + 2);
}

function fresh() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER NOT NULL, name TEXT);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, interviewee_name TEXT,
      interviewee_company TEXT, icp_fit TEXT, quote_consent INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, details TEXT, actor TEXT,
      user_id INTEGER, project_id INTEGER);
  `);
  db.exec(table('211_founder_validate_evidence', 'validation_decisions'));
  db.exec(table('211_founder_validate_evidence', 'hypotheses'));
  db.exec(table('211_founder_validate_evidence', 'hypothesis_pain_links'));
  db.prepare('INSERT INTO users (id, role, founder_id, email, name) VALUES (?,?,?,?,?)')
    .run(FOUNDER, 'founder', FOUNDER_ID, 'f@example.com', 'Founder');
  db.prepare('INSERT INTO users (id, role, email, name) VALUES (?,?,?,?)')
    .run(PARTNER, 'partner', 'p@example.com', 'Partner');
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)').run(PROJECT, FOUNDER_ID, 'Ours');
  return db;
}

function d1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
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

async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, who: number, role: string, method: string, path: string, body?: unknown) {
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1(db) } as any;
  await ensurePainGroupsSchema(env);
  const res = await founderValidate.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${await token(who, role)}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('a second decision keeps the first, and a partner cannot read either', async () => {
  const db = fresh();
  const first = await call(db, FOUNDER, 'founder', 'POST', `/decision/${PROJECT}`, { decision: 'proceed', reasoning: 'ship it' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await call(db, FOUNDER, 'founder', 'POST', `/decision/${PROJECT}`, { decision: 'pivot', reasoning: 'narrow it' });
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const got = await call(db, FOUNDER, 'founder', 'GET', `/decision/${PROJECT}`);
  assert.equal(got.status, 200, JSON.stringify(got.body));
  assert.equal(got.body.current.decision, 'pivot');
  assert.equal(got.body.history.length, 2);
  const kept = got.body.history.find((row: any) => row.decision === 'proceed');
  assert.ok(kept?.superseded_at, 'the first decision was overwritten');
  const logged = db.prepare(`SELECT action, user_id FROM activity_logs WHERE action = 'validation_decision_recorded'`).all();
  assert.equal(logged.length, 2);
  assert.equal((logged[0] as any).user_id, FOUNDER);

  const partner = await call(db, PARTNER, 'partner', 'GET', `/decision/${PROJECT}`);
  assert.equal(partner.status, 403);
  assert.equal(JSON.stringify(partner.body).includes('ship it'), false);
  assert.equal(JSON.stringify(partner.body).includes('narrow it'), false);
});

test('interview evidence is stored as sent, and Not recorded stays null', async () => {
  const db = fresh();
  db.prepare(`INSERT INTO discovery_interviews (project_id, interviewee_name) VALUES (?, ?)`).run(PROJECT, 'Ada');
  const id = (db.prepare('SELECT id FROM discovery_interviews').get() as any).id;
  const patched = await call(db, FOUNDER, 'founder', 'PATCH', `/interviews/${id}/evidence`, {
    icp_fit: 'strong', quote_consent: false, interviewee_company: 'Acme',
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const row = db.prepare('SELECT icp_fit, quote_consent, interviewee_company FROM discovery_interviews WHERE id = ?').get(id) as any;
  assert.equal(row.icp_fit, 'strong');
  assert.equal(row.quote_consent, 0);
  assert.equal(row.interviewee_company, 'Acme');
  const cleared = await call(db, FOUNDER, 'founder', 'PATCH', `/interviews/${id}/evidence`, { icp_fit: null });
  assert.equal(cleared.status, 200);
  const again = db.prepare('SELECT icp_fit FROM discovery_interviews WHERE id = ?').get(id) as any;
  assert.equal(again.icp_fit, null);
  const logs = db.prepare(`SELECT user_id FROM activity_logs WHERE action = 'interview_evidence_updated'`).all();
  assert.equal(logs.length, 2);
});

test('unlinking a pain theme removes that link and records the actor', async () => {
  const db = fresh();
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1(db) } as any;
  await ensurePainGroupsSchema(env);
  db.prepare(`INSERT INTO hypotheses (project_id, code, claim) VALUES (?, 'H1', 'Buyers pay')`).run(PROJECT);
  const hyp = (db.prepare('SELECT id FROM hypotheses').get() as any).id;
  db.prepare(`INSERT INTO pain_groups (project_id, title) VALUES (?, 'Price')`).run(PROJECT);
  const group = (db.prepare('SELECT id FROM pain_groups').get() as any).id;
  db.prepare(`INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, ?, 'supports')`).run(hyp, group);
  const link = (db.prepare('SELECT id FROM hypothesis_pain_links').get() as any).id;

  const gone = await call(db, FOUNDER, 'founder', 'DELETE', `/links/${link}`);
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hypothesis_pain_links').get() as any).n, 0);
  const logs = db.prepare(`SELECT user_id FROM activity_logs WHERE action = 'hypothesis_pain_unlinked'`).all();
  assert.equal((logs[0] as any).user_id, FOUNDER);
});
