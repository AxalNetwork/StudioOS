/**
 * D9046 (#9046, part of #4675) — HQ's close as `fulfilled` runs the platform's own erasure for the account
 * (`eraseAccountAgents`, D1530) before it records the outcome, and stays open when that step fails.
 *
 * The close runs against a real node:sqlite database built from migration 272 and the close-key migration, as
 * dsr_close_d168 does, beside the agent tables `eraseAccountAgents` writes, narrowed to the columns it touches.
 * The engine is off and no run is open, so the runtime half is never reached; the D1 half is what is asserted.
 * Sample data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dsr_close_erasure_9046.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDsrRequest, openDsrRequest } from '../src/services/dsrRequests';
import { eraseAccountAgents } from '../src/agents/erasure';
import { readAdminSecurity } from './_admin_security_source.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION = read('cloudflare-worker/sql/migrations/272_dsr_requests.sql');
const KEYS_MIGRATION = read('cloudflare-worker/sql/migrations/202611072219_dsr_close_key.sql');
const SUBJECT = 1, HQ = 2, OTHER = 3;
const STAMP = '2026-11-02 09:15:00';

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // Sequential: the close's `changes() > 0` conditions read the statement before them.
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function world() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, deletion_requested_at TEXT)`);
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
             created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL,
             viewed_user_id INTEGER, filters_json TEXT, exported_at TEXT DEFAULT (datetime('now')))`);
  db.exec(MIGRATION); db.exec(KEYS_MIGRATION);
  // The agent stores eraseAccountAgents reads and writes, narrowed to its columns.
  db.exec(`CREATE TABLE team_agents (id INTEGER PRIMARY KEY, sponsor_user_id INTEGER, scope_kind TEXT, company_id INTEGER, project_id INTEGER)`);
  db.exec(`CREATE TABLE agent_memory_notes (id INTEGER PRIMARY KEY, agent_id INTEGER, created_by_user_id INTEGER, body TEXT)`);
  db.exec(`CREATE TABLE agent_task_runs (id INTEGER PRIMARY KEY, agent_id INTEGER, status TEXT)`);
  db.exec(`CREATE TABLE agent_duties (id INTEGER PRIMARY KEY, agent_id INTEGER, status TEXT, updated_at TEXT)`);
  db.exec(`CREATE TABLE scope_tasks (id INTEGER PRIMARY KEY, assignee_kind TEXT, assignee_agent_id INTEGER, status TEXT,
             board_column TEXT, close_reason TEXT, updated_at TEXT)`);
  db.exec(`CREATE TABLE agent_compute_requests (uid TEXT PRIMARY KEY, task_id INTEGER, requested_by_user_id INTEGER)`);
  db.exec(`CREATE TABLE agent_compute_jobs (uid TEXT PRIMARY KEY, agent_id INTEGER, run_uid TEXT)`);
  db.exec(`CREATE TABLE agent_compute_executions (request_uid TEXT, job_uid TEXT)`);
  db.exec(`INSERT INTO users (id, email, name) VALUES (1, 'subject@example.com', 'Sample Subject'), (2, 'hq@example.com', 'Sample HQ'),
             (3, 'other@example.com', 'Another Sample')`);
  db.exec(`INSERT INTO team_agents (id, sponsor_user_id, scope_kind, project_id) VALUES (10, 1, 'project', 5), (11, 3, 'project', 6)`);
  db.exec(`INSERT INTO agent_memory_notes (agent_id, created_by_user_id, body) VALUES
             (10, 1, 'Synthetic note A'), (10, 1, 'Synthetic note B'), (11, 3, 'Another member''s note')`);
  db.exec(`INSERT INTO agent_task_runs (agent_id, status) VALUES (10, 'done'), (11, 'done')`);
  db.exec(`INSERT INTO scope_tasks (id, assignee_kind, assignee_agent_id, status) VALUES (100, 'agent', 10, 'open'), (101, 'agent', 11, 'open')`);
  const env: any = { DB: makeD1(db) };
  return { db, env };
}

async function asks(w: ReturnType<typeof world>, id = SUBJECT) {
  w.db.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?').run(STAMP, id);
  await openDsrRequest(w.env, id);
}
let seq = 0;
function close(w: ReturnType<typeof world>, outcome: 'fulfilled' | 'denied', erase: () => Promise<void>, over: Record<string, unknown> = {}) {
  const open = w.db.prepare('SELECT id FROM dsr_requests WHERE user_id = ? AND outcome IS NULL').get(SUBJECT) as any;
  seq += 1;
  return closeDsrRequest(w.env, {
    userId: SUBJECT, actorUserId: HQ, actorEmail: 'hq@example.com', outcome, reason: 'Synthetic reason for the close',
    requestedAt: STAMP, requestId: open?.id ?? null, closeKey: `test-close-key-9046-${String(seq).padStart(4, '0')}`, erase, ...over,
  });
}
const notesOf = (w: ReturnType<typeof world>, agent: number) => Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_memory_notes WHERE agent_id = ?').get(agent) as any).n);
const ledger = (w: ReturnType<typeof world>) => w.db.prepare('SELECT outcome FROM dsr_requests WHERE user_id = ?').all(SUBJECT).map((r: any) => r.outcome);
const flag = (w: ReturnType<typeof world>) => (w.db.prepare('SELECT deletion_requested_at AS t FROM users WHERE id = ?').get(SUBJECT) as any).t;

test('a close as fulfilled erases the account’s agent data, then records the outcome', async () => {
  const w = world();
  await asks(w);
  // Mutation checked: the erase call dropped from closeDsrRequest → the subject's notes remain.
  const res = await close(w, 'fulfilled', () => eraseAccountAgents(w.env, SUBJECT));
  assert.equal(res.status, 'closed');
  assert.equal(notesOf(w, 10), 0, 'the subject’s agent memory notes are gone');
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = 10').get() as any).n), 0, 'run summaries gone');
  assert.equal((w.db.prepare('SELECT status FROM scope_tasks WHERE id = 100').get() as any).status, 'cancelled', 'queued task cancelled');
  assert.equal(notesOf(w, 11), 1, 'another member’s agent is untouched');
  assert.equal((w.db.prepare('SELECT status FROM scope_tasks WHERE id = 101').get() as any).status, 'open');
  assert.deepEqual(ledger(w), ['fulfilled']);
  assert.equal(flag(w), null, 'the clock stopped');
});

test('a failed erasure records nothing: the request stays open, the flag is unchanged, and a retry closes it', async () => {
  const w = world();
  await asks(w);
  const res = await close(w, 'fulfilled', async () => { throw new Error('synthetic erasure failure'); });
  // Mutation checked: the catch returning nothing (falling through to the batch) → the ledger reads fulfilled.
  assert.equal(res.status, 'erasure_failed');
  assert.deepEqual(ledger(w), [null], 'the ledger row is still open');
  assert.equal(flag(w), STAMP, 'users.deletion_requested_at is unchanged');
  assert.equal(Number((w.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'dsr_request_closed'").get() as any).n), 0, 'no audit row for an act that did not happen');
  const again = await close(w, 'fulfilled', () => eraseAccountAgents(w.env, SUBJECT));
  assert.equal(again.status, 'closed');
  assert.equal(notesOf(w, 10), 0);
});

test('a close as denied erases nothing; a stale review erases nothing; a replay does not erase again', async () => {
  let w = world();
  await asks(w);
  let calls = 0;
  const counted = async () => { calls += 1; await eraseAccountAgents(w.env, SUBJECT); };
  // Mutation checked: the outcome check dropped → a denial erases.
  assert.equal((await close(w, 'denied', counted)).status, 'closed');
  assert.equal(calls, 0, 'a denial runs no erasure');
  assert.equal(notesOf(w, 10), 2);

  w = world();
  await asks(w);
  calls = 0;
  // The operator reviewed an older request: the subject withdrew and asked again since.
  // Mutation checked: reviewedRequestIsOpen answering true → the stale close erases before it is refused.
  const stale = await close(w, 'fulfilled', counted, { requestedAt: '2026-10-01 08:00:00' });
  assert.equal(stale.status, 'stale');
  assert.equal(calls, 0, 'an erasure never runs on a review the close then refuses');
  assert.equal(notesOf(w, 10), 2);
  // The named ledger row is not the open one.
  const wrongRow = await close(w, 'fulfilled', counted, { requestId: 9999 });
  assert.notEqual(wrongRow.status, 'closed');
  assert.equal(calls, 0);

  // A request from before migration 272: the flag is set and the ledger holds no row yet, so only the flag and
  // the named row can tell the review is stale.
  w = world();
  w.db.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?').run(STAMP, SUBJECT);
  calls = 0;
  // Mutation checked: the flag condition dropped → a review of an older stamp erases.
  assert.equal((await close(w, 'fulfilled', counted, { requestedAt: '2026-10-01 08:00:00' })).status, 'stale');
  // Mutation checked: the named-row condition dropped → a close naming a row that does not exist erases.
  assert.notEqual((await close(w, 'fulfilled', counted, { requestId: 9999 })).status, 'closed');
  assert.equal(calls, 0);
  assert.equal(notesOf(w, 10), 2);

  const ok = await close(w, 'fulfilled', counted, { closeKey: 'test-close-key-9046-replay' });
  assert.equal(ok.status, 'closed');
  assert.equal(calls, 1);
  const replay = await close(w, 'fulfilled', counted, { closeKey: 'test-close-key-9046-replay' });
  assert.equal(replay.status, 'closed');
  assert.equal((replay as any).replayed, true);
  assert.equal(calls, 1, 'a retry of a recorded close does not erase again');
});

test('wiring: the HQ close passes the account’s erasure, and a failed step is the refusal erasure_step_failed (503)', () => {
  const src = readAdminSecurity();
  const at = src.indexOf("r.post('/dsr/:userId/close'");
  const handler = src.slice(at, src.indexOf('\nexport default', at));
  // Mutation checked: the erase line dropped from the route → this fails.
  assert.match(handler, /erase: \(\) => eraseAccountAgents\(c\.env, uid\)/);
  assert.match(handler, /result\.status === 'erasure_failed'[\s\S]{0,400}code: 'erasure_step_failed',\s*\}, 503\)/);
  assert.match(handler, /Nothing was recorded\./);
});
