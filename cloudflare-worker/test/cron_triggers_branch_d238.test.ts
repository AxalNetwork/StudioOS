/**
 * D238 — a branch is graded against its own crons, not HQ's six.
 *
 * `GET /api/infra/cron-history` read the newest row for every expression in
 * CRON_TRIGGERS. A branch only ever fires BRANCH_CRONS (the queue drain and
 * the nightly cleanup), so on a branch the other four read "never fired" for
 * ever. The route now asks `triggersFor(env)`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/cron_triggers_branch_d238.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import infra from '../src/routes/infra.ts';
import { BRANCH_CRONS, CRON_TRIGGERS, triggersFor } from '../src/util/cronHistory.ts';
import { BRANCH_CRONS as GENERATOR_BRANCH_CRONS } from '../../scripts/lib/branchConfig.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;

const app = new Hono<any>();
app.route('/', infra);
app.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message)];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

function env(branch?: string) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
    jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`);
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'admin', 'Ada', 'ada@axal.example')").run(ADMIN);
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...(branch ? { BRANCH_CODE: branch } : {}) } as any;
}

async function history(e: any) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/cron-history', { headers: { Authorization: `Bearer ${token}` } }, e);
  assert.equal(res.status, 200);
  return res.json() as Promise<any>;
}

test('the worker\'s BRANCH_CRONS is the generator\'s, exactly', () => {
  assert.deepEqual([...BRANCH_CRONS], [...GENERATOR_BRANCH_CRONS],
    'the worker grades a branch against a list the generator does not write into its triggers');
});

test('HQ is graded against all of CRON_TRIGGERS', async () => {
  const body = await history(env());
  assert.deepEqual(body.triggers.map((t: any) => t.expr), CRON_TRIGGERS.map((t) => t.expr));
});

test('a branch is graded against its own two crons, and nothing it never fires', async () => {
  const body = await history(env('fr'));
  assert.deepEqual(body.triggers.map((t: any) => t.expr).sort(), [...GENERATOR_BRANCH_CRONS].sort());
  for (const t of body.triggers) {
    assert.ok(GENERATOR_BRANCH_CRONS.includes(t.expr), `a branch is graded against ${t.expr}, which it never fires`);
  }
});

test('triggersFor keeps the display names and picks by deployment', () => {
  assert.equal(triggersFor({} as any), CRON_TRIGGERS);
  const branch = triggersFor({ BRANCH_CODE: 'fr' } as any);
  assert.deepEqual(branch.map((t) => t.name), ['scheduled', 'cleanup']);
});
