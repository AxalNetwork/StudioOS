/**
 * D231 and D234 — HQ's decision vocabulary, the dead branch filter, the SLA
 * clock on every kind, and a list that says when it was cut.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/escalation_contracts_d231.test.ts
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
import {
  recordEscalation, listEscalations, ESCALATION_STATUSES, ESCALATION_KINDS, SLA_HOURS,
} from '../src/rpc/hqOps.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const MIG_259 = read('cloudflare-worker/sql/migrations/259_hq_escalations.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7;

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
  db.exec(MIG_259);
  db.exec(read('cloudflare-worker/sql/migrations/261_branch_escalations.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/288_escalation_delivery.sql'));
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
    .run(HOLDER, 'admin', 'Sue Hart', 'sue@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name) VALUES (?,?,?,?,?)`)
    .run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  db.prepare('INSERT INTO territory_licences (uid) VALUES (?)').run('lic_fr');
  return db;
}

async function token() {
  return new SignJWT({ user_id: HOLDER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function appFor(env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.route('/api/admin', adminEscalations);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));
  return async (path: string, init: RequestInit = {}) => {
    const res = await app.request(`/api/admin${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

function ledger(db: InstanceType<typeof DatabaseSync>, uid: string) {
  return db.prepare('SELECT status, answer, answered_at FROM hq_escalations WHERE uid = ?').get(uid);
}

test('every escalation kind has SLA hours', () => {
  for (const kind of ESCALATION_KINDS) {
    assert.equal(typeof SLA_HOURS[kind], 'number', `${kind} has no SLA hours`);
    assert.ok(SLA_HOURS[kind] > 0, `${kind} has no clock`);
  }
});

test('PATCH status withdrawn is refused and the row is unchanged', async () => {
  const db = hqDb();
  let pushes = 0;
  const call = appFor({
    DB: makeD1(db), JWT_SECRET,
    BRANCH_FR: { async applyEscalationAnswer() { pushes += 1; return { ok: true }; } },
  });
  const { uid } = await recordEscalation({ DB: makeD1(db) } as any, 'fr', { kind: 'content', subject: 'A post' });
  const before = ledger(db, uid);
  const r = await call(`/escalations/${uid}`, {
    method: 'PATCH', body: JSON.stringify({ answer: 'Taking it back.', status: 'withdrawn' }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad_status');
  assert.deepEqual(ledger(db, uid), before);
  assert.equal(pushes, 0);
});

test('answered and declined still record', async () => {
  const db = hqDb();
  const call = appFor({ DB: makeD1(db), JWT_SECRET });
  const a = await recordEscalation({ DB: makeD1(db) } as any, 'fr', { kind: 'other', subject: 'One' });
  const d = await recordEscalation({ DB: makeD1(db) } as any, 'fr', { kind: 'other', subject: 'Two' });
  const ar = await call(`/escalations/${a.uid}`, { method: 'PATCH', body: JSON.stringify({ answer: 'Yes.', status: 'answered' }) });
  const dr = await call(`/escalations/${d.uid}`, { method: 'PATCH', body: JSON.stringify({ answer: 'No.', status: 'declined' }) });
  assert.equal(ar.status, 200);
  assert.equal(dr.status, 200);
});

test('GET ?status=withdrawn is still the table vocabulary', async () => {
  const db = hqDb();
  const call = appFor({ DB: makeD1(db), JWT_SECRET });
  const r = await call('/escalations?status=withdrawn');
  assert.equal(r.status, 200);
  assert.equal(r.body.complete, true);
  assert.deepEqual(r.body.statuses, [...ESCALATION_STATUSES]);
});

test('a list one past the ceiling is incomplete and does not return the extra row', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db) } as any;
  await recordEscalation(env, 'fr', { kind: 'content', subject: 'First' });
  await recordEscalation(env, 'fr', { kind: 'content', subject: 'Second' });
  const listed = await listEscalations(env, { limit: 1 });
  assert.equal(listed.complete, false);
  assert.equal(listed.items.length, 1);
  const call = appFor({ DB: makeD1(db), JWT_SECRET });
  const r = await call('/escalations?kind=content');
  assert.equal(r.body.complete, true);
  assert.equal(r.body.items.length, 2);
});

test('listEscalations declares no filter key its statements do not bind', () => {
  const src = read('cloudflare-worker/src/rpc/hqOps.ts');
  const start = src.indexOf('export async function listEscalations(');
  assert.equal(src.indexOf('export async function listEscalations(', start + 1), -1);
  const fn = src.slice(start);
  const typeAt = fn.indexOf('filter: {');
  const type = fn.slice(typeAt, fn.indexOf('}', typeAt) + 1);
  assert.equal(type.includes('branch_code'), false);
  const keys: string[] = [];
  const scan = /([a-z_]+)\?:/g;
  let found: RegExpExecArray | null;
  while ((found = scan.exec(type))) keys.push(found[1]);
  assert.deepEqual(keys, ['status', 'kind', 'limit']);
  for (const key of keys) assert.ok(fn.includes('filter.' + key), `filter.${key} is declared and never read`);
});
