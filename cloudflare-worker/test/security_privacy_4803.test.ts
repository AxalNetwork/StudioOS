/**
 * D4803 (#4803, Security v2 slice 3, canvas SE06 Privacy): the Worker half.
 *
 *   · the requests closed in the last 90 days, newest first, against the
 *     real `dsr_requests` schema (migrations 272 and the close-key one): the
 *     outcome, when, who closed it (never an operator for a withdrawal, which
 *     is the subject's own act), the reason, and the subject;
 *   · a request still open, or closed before the window, is not listed;
 *   · past the limit the read says it was cut (`truncated`), never silently;
 *   · an unreadable ledger is `available: false` with its reason, never an
 *     empty history;
 *   · /overview's `dsr` block carries it.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/security_privacy_4803.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DSR_RECENT_DAYS, DSR_RECENT_LIMIT, loadRecentDsrClosures } from '../src/services/dsrRequests.ts';

const NOW = Date.UTC(2026, 10, 9, 12);
const sql = (days: number) => new Date(NOW - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
const migration = (name: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', name), 'utf8');

function d1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(q: string) {
      let b: unknown[] = [];
      const api: any = {
        bind: (...x: unknown[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(q).get(...(b as any[])) ?? null; },
        async all() { return { results: db.prepare(q).all(...(b as any[])) }; },
      };
      return api;
    },
  };
}

function ledger() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, deletion_requested_at TEXT)');
  db.exec(migration('272_dsr_requests.sql'));
  db.exec(migration('202611072219_dsr_close_key.sql'));
  db.exec("INSERT INTO users (id, email, name) VALUES (1, 'founder@lumen.example', 'Ada'), (2, 'lp@fund.example', NULL), (9, 'ops@axal.vc', 'Guillaume L.')");
  const add = db.prepare('INSERT INTO dsr_requests (user_id, requested_at, outcome, closed_at, closed_by_user_id, close_reason) VALUES (?, ?, ?, ?, ?, ?)');
  return { db, env: { DB: d1(db) } as any, add };
}

test('closed requests: newest first, with outcome, who closed it and why; withdrawn names no operator', async () => {
  const { env, add } = ledger();
  add.run(1, sql(40), 'fulfilled', sql(12), 9, 'records purged from D1 and R2, ticket DSR-14');
  add.run(2, sql(20), 'withdrawn', sql(3), 9, null);
  add.run(2, sql(80), 'denied', sql(60), 9, 'retained under an open legal hold');
  add.run(1, sql(200), 'fulfilled', sql(120), 9, 'too old to list');
  add.run(1, sql(2), null, null, null, null);

  const got = await loadRecentDsrClosures(env, DSR_RECENT_DAYS, NOW) as any;
  assert.equal(got.available, true);
  assert.equal(got.window_days, 90);
  assert.equal(got.truncated, false);
  assert.deepEqual(got.rows.map((r: any) => [r.email, r.outcome, r.closed_by]), [
    ['lp@fund.example', 'withdrawn', null],
    ['founder@lumen.example', 'fulfilled', 'ops@axal.vc'],
    ['lp@fund.example', 'denied', 'ops@axal.vc'],
  ], 'wrong rows, order, or a withdrawal credited to an operator');
  assert.equal(got.rows[1].close_reason, 'records purged from D1 and R2, ticket DSR-14');
  assert.equal(got.rows[1].requested_at, sql(40));
  assert.equal(got.rows[0].name, null);
});

test('a subject whose account is gone still lists, with no email rather than a guess', async () => {
  const { db, env, add } = ledger();
  db.exec('PRAGMA foreign_keys = OFF');
  add.run(77, sql(10), 'fulfilled', sql(1), 9, 'account erased by hand, ticket DSR-20');
  const got = await loadRecentDsrClosures(env, DSR_RECENT_DAYS, NOW) as any;
  assert.equal(got.rows.length, 1);
  assert.equal(got.rows[0].email, null);
  assert.equal(got.rows[0].user_id, 77);
});

test('past the limit the read says it was cut', async () => {
  const { env, add } = ledger();
  for (let i = 0; i < DSR_RECENT_LIMIT + 2; i += 1) add.run(1, sql(30), 'denied', sql(1 + (i % 50)), 9, 'retained, legal hold');
  const got = await loadRecentDsrClosures(env, DSR_RECENT_DAYS, NOW) as any;
  assert.equal(got.rows.length, DSR_RECENT_LIMIT);
  assert.equal(got.truncated, true);
});

test('an unreadable ledger is available: false with its reason, never an empty history', async () => {
  const env = { DB: { prepare() { throw new Error('no such table: dsr_requests'); } } } as any;
  const got = await loadRecentDsrClosures(env, DSR_RECENT_DAYS, NOW) as any;
  assert.equal(got.available, false);
  assert.match(got.reason, /not a claim that none were closed/);
  assert.equal('rows' in got, false);
});

test('/overview\'s dsr block carries the history', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_security.ts'), 'utf8');
  assert.match(src, /ledger_reason: ledgerReason[\s\S]{0,300}recent: await loadRecentDsrClosures\(env\),/);
});
