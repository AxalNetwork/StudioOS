/**
 * The AI quota gate, over a real ledger.
 *
 * Three routers carried a private copy of this check and the copies disagreed
 * about the only case that mattered. legalcap caught a read failure and
 * returned "under the limit"; pipeline and networkfx did not catch it at all.
 * Since the table they all counted (`shared_services_log`) did not exist until
 * migration 177, in production the limiter was either absent or fatal.
 *
 * The property under test is the one that was inverted: a gate that cannot
 * read its own ledger must not answer "under the limit". It says 503 —
 * "I can't tell" — which is what `middleware/rateLimit.ts` already does for
 * its failClosed buckets. A limiter that opens on its own outage is not a
 * limiter, it is an announcement of how to bypass one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import { aiQuotaGate, recordSharedServiceAction, AI_CALLS_PER_HOUR } from '../src/services/aiQuota.ts';
import { WORKFLOW_SCHEMA_DDL } from '../src/services/workflowSchema.ts';

// The real ledger, with the two tables its foreign keys point at. node:sqlite
// enforces FKs, so a fixture without them would let rows in that production
// would reject — and the actor column is the one the whole check turns on.
const LEDGER = [
  `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`,
  ...WORKFLOW_SCHEMA_DDL.filter((s) => /\bworkflows\b/.test(s)),
  ...WORKFLOW_SCHEMA_DDL.filter((s) => /shared_services_log/.test(s)),
].join(';\n');

function env(schema = LEDGER) {
  const { DB, db } = makeD1(schema);
  // The "unreadable ledger" cases deliberately pass a schema with none of
  // these tables — that is the state the gate has to survive.
  if (/CREATE TABLE users\b/.test(schema)) {
    for (const id of [1, 2]) db.prepare(`INSERT INTO users (id) VALUES (?)`).run(id);
  }
  return { env: { DB } as any, db };
}

/** n calls by `user`, `agoMinutes` in the past, of the given kind. */
function seed(db: any, user: number, n: number, agoMinutes = 1, action = 'ai_call') {
  for (let i = 0; i < n; i += 1) {
    db.prepare(
      `INSERT INTO shared_services_log (action_type, performed_by, created_at)
       VALUES (?, ?, datetime('now', ?))`,
    ).run(action, user, `-${agoMinutes} minutes`);
  }
}

test('under the limit passes and reports the count', async () => {
  const { env: e, db } = env();
  seed(db, 1, 3);
  const gate = await aiQuotaGate(e, 1);
  assert.equal(gate.ok, true);
  assert.equal((gate as any).used, 3);
});

test('at the limit is 429, not 500 and not a pass', async () => {
  const { env: e, db } = env();
  seed(db, 1, AI_CALLS_PER_HOUR);
  const gate = await aiQuotaGate(e, 1);
  assert.equal(gate.ok, false);
  assert.equal((gate as any).status, 429);
});

test('an unreadable ledger is 503 — it must never read as "under the limit"', async () => {
  // No shared_services_log at all: exactly the production state before
  // migration 177, and the case legalcap answered `true` to.
  const { env: e } = env('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
  const gate = await aiQuotaGate(e, 1);
  assert.equal(gate.ok, false, 'a gate that cannot count must not let the call through');
  assert.equal((gate as any).status, 503, 'and must not claim the caller is over their quota either');
});

test('the window is the trailing hour', async () => {
  const { env: e, db } = env();
  seed(db, 1, AI_CALLS_PER_HOUR, 61);          // spent, but yesterday's news
  const gate = await aiQuotaGate(e, 1);
  assert.equal(gate.ok, true, 'calls older than an hour must fall out of the window');
  assert.equal((gate as any).used, 0);
});

test("one caller's usage cannot exhaust another's quota", async () => {
  const { env: e, db } = env();
  seed(db, 2, AI_CALLS_PER_HOUR);
  const gate = await aiQuotaGate(e, 1);
  assert.equal(gate.ok, true);
  assert.equal((gate as any).used, 0);
});

test('only model calls count against the model-call quota', async () => {
  const { env: e, db } = env();
  seed(db, 1, AI_CALLS_PER_HOUR, 1, 'dashboard_view_admin');
  const gate = await aiQuotaGate(e, 1);
  assert.equal(gate.ok, true, 'an audit row is not a model call');
});

test('a route-specific escape hatch reaches the caller', async () => {
  const { env: e, db } = env();
  seed(db, 1, AI_CALLS_PER_HOUR);
  const gate = await aiQuotaGate(e, 1, { note: 'Pass an explicit allocation to override.' });
  assert.equal(gate.ok, false);
  assert.match((gate as any).error, /explicit allocation/);
});

test('a lower limit is honoured', async () => {
  const { env: e, db } = env();
  seed(db, 1, 5);
  assert.equal((await aiQuotaGate(e, 1, { limit: 5 })).ok, false);
  assert.equal((await aiQuotaGate(e, 1, { limit: 6 })).ok, true);
});

test('recording a call is best-effort — a broken ledger never fails the caller', async () => {
  const { env: e } = env('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
  await recordSharedServiceAction(e, 'ai_call', 1, { kind: 'x' });   // must not throw
});

test('a recorded call counts against the next check', async () => {
  const { env: e } = env();
  for (let i = 0; i < 4; i += 1) await recordSharedServiceAction(e, 'ai_call', 1, { kind: 'x' });
  const gate = await aiQuotaGate(e, 1, { limit: 4 });
  assert.equal(gate.ok, false, 'the meter and the ledger have to be the same ledger');
});
