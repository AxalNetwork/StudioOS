/**
 * D574 — a Wellbeing read that FAILED is not an EMPTY one.
 *
 * `GET /api/wellbeing/checkins`, `/resources`, `/experts` and `/aggregate`
 * caught every failure and answered 200 with an empty list (the pulse with
 * its small-cohort shape), so the screens said "nothing yet" and the admin
 * pulse "Fewer than 5" when nothing had been read. Each now answers 503 with
 * its code, and the raw error never reaches the body.
 *
 * The real router runs on node:sqlite with a `users` table for the auth
 * check; every statement that touches a Wellbeing table throws, as a D1
 * outage or a missing table would.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import wellbeing from '../src/routes/wellbeing.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1, ADMIN = 2;
const SECRET_TEXT = 'D1_ERROR: disk I/O failure at page 77';

function env(fail: boolean) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`);
  db.prepare(`INSERT INTO users (id, role, email) VALUES (?, 'founder', 'f@example.test'), (?, 'admin', 'a@example.test')`).run(FOUNDER, ADMIN);
  const real: any = d1Over(db);
  const DB = fail ? {
    ...real,
    prepare(sql: string) {
      if (/wellbeing_|\bexperts\b|expert_/i.test(sql)) throw new Error(SECRET_TEXT);
      return real.prepare(sql);
    },
    batch: real.batch?.bind(real),
    exec: real.exec?.bind(real),
  } : real;
  return { JWT_SECRET, ENVIRONMENT: 'development', DB } as any;
}

async function get(path: string, who: number, role: string, e: any) {
  const tok = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await wellbeing.request(path, { headers: { Authorization: `Bearer ${tok}` } }, e);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, er = console.error, i = console.info;
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = er; console.info = i; }
};

const CASES: Array<[string, number, string, string]> = [
  ['/checkins', FOUNDER, 'founder', 'checkins_unreadable'],
  ['/resources', FOUNDER, 'founder', 'resources_unreadable'],
  ['/experts', FOUNDER, 'founder', 'experts_unreadable'],
  ['/aggregate?days=30', ADMIN, 'admin', 'aggregate_unreadable'],
];

test('each failed read answers 503 with its code, never an empty 200', async () => {
  for (const [path, who, role, code] of CASES) {
    const r = await quiet(() => get(path, who, role, env(true)));
    assert.equal(r.status, 503, `${path} answered ${r.status}`);
    assert.equal(r.body.error, code, path);
    assert.match(r.body.message, /could not be read\. This is not a claim/, path);
    assert.ok(!JSON.stringify(r.body).includes('disk I/O'), `${path} leaked the raw error`);
    for (const k of ['checkins', 'resources', 'matches', 'cohort_size', 'insufficient_data']) {
      assert.ok(!(k in r.body), `${path} still answered the empty shape (${k})`);
    }
  }
});

test('the reads that work still answer 200 with their shapes', async () => {
  const e = env(false);
  const checkins = await quiet(() => get('/checkins', FOUNDER, 'founder', e));
  assert.equal(checkins.status, 200);
  assert.ok(Array.isArray(checkins.body.checkins));
  const resources = await quiet(() => get('/resources', FOUNDER, 'founder', e));
  assert.equal(resources.status, 200);
  assert.ok(Array.isArray(resources.body.resources));
  const agg = await quiet(() => get('/aggregate?days=30', ADMIN, 'admin', e));
  assert.equal(agg.status, 200);
  assert.equal(agg.body.insufficient_data, true, 'an empty cohort is still the small-cohort shape, when it was read');
});
