/**
 * D9034 (#9034) — the job queue's dead letters, once each and never quietly lost.
 *
 *   mirror once    a dead letter delivered again (an earlier delivery died after
 *                  its mirror row landed) leaves one `cf_dlq_mirror` row, with
 *                  the message's idempotency key.
 *   never quiet    a mirror that fails is retried after a delay; on the final
 *                  attempt the consumer writes one `error_logs` row (job type
 *                  and message id, no payload) and acks.
 *   replay once    two concurrent `POST /api/infra/dlq/:id/retry` for one row
 *                  enqueue once; the other answers 409. An enqueue that throws
 *                  puts the row back. Replay and delete each write one audit row.
 *
 * Real SQLite (the migrated schema through `_schema_once.mjs`), the real router,
 * a fake queue producer. Nothing reaches a real queue.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/job_dlq_once_9034.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { dlqConsumer, JOB_DLQ_FINAL_ATTEMPT, JOB_DLQ_RETRY_SECONDS } from '../src/queue-consumer.ts';
import infra, { dlqReplayKey } from '../src/routes/infra.ts';

/** Made per run, so no key-shaped literal sits in the file (gitleaks). */
const SECRET = randomBytes(32).toString('hex');
const ADMIN = 9101;
const OTHER_ADMIN = 9102;
const LOG_ID = 7;

const quiet = async <T>(fn: () => Promise<T>) => {
  const { warn, error, info } = console;
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; console.info = info; }
};

function database() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES
      (${ADMIN}, 'admin', 'Dee Admin', 'dee-admin@example.test', 1),
      (${OTHER_ADMIN}, 'admin', 'Lee Admin', 'lee-admin@example.test', 1);
    INSERT INTO email_send_log (id, to_addr, template_key, status) VALUES (${LOG_ID}, 'fay@example.test', 'auth_verify_email', 'failed');`);
  return db;
}

const one = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const count = (db: DatabaseSync, sql: string, ...a: any[]) => Number(one(db, sql, ...a).n);

/**
 * A D1 binding over `db` that can die after a write matching `dieAfter` lands:
 * every later statement throws, as in a stopped isolate. `failing` makes each
 * write it matches throw before it runs (a D1 outage).
 */
function binding(db: DatabaseSync, opts: { dieAfter?: RegExp; failing?: RegExp } = {}) {
  const inner: any = d1Over(db);
  const state = { dead: false };
  const wrap = (sql: string, stmt: any): any => ({
    bind: (...a: unknown[]) => wrap(sql, stmt.bind(...a)),
    async run() { before(sql); const r = await stmt.run(); after(sql); return r; },
    async all() { before(sql); return stmt.all(); },
    async first(col?: string) { before(sql); return stmt.first(col); },
  });
  const before = (sql: string) => {
    if (state.dead) throw new Error('isolate died');
    if (opts.failing && opts.failing.test(sql)) throw new Error('D1_ERROR: injected outage');
  };
  const after = (sql: string) => { if (opts.dieAfter && opts.dieAfter.test(sql)) state.dead = true; };
  return { state, DB: { prepare: (sql: string) => wrap(sql, inner.prepare(sql)), batch: (s: any[]) => inner.batch(s) } };
}

/** One delivery of one dead letter; what the consumer told the platform. */
async function deliver(env: any, body: unknown, attempts: number, id = 'msg-dlq-1', dead?: { dead: boolean }) {
  let result: 'none' | 'ack' | 'retry' = 'none';
  let delaySeconds: number | undefined;
  const message = {
    id, body, attempts, timestamp: new Date('2026-11-27T09:00:00Z'),
    ack() { if (!dead?.dead) result = 'ack'; },
    retry(o?: { delaySeconds?: number }) { if (!dead?.dead) { result = 'retry'; delaySeconds = o?.delaySeconds; } },
  };
  await quiet(() => dlqConsumer({ queue: 'studioos-job-queue-dlq', messages: [message] } as any, env, {} as any));
  return { result, delaySeconds };
}

const EMAIL_BODY = { job_type: 'email_send', payload: { log_id: LOG_ID, secret_marker: 'payload-not-logged' }, idempotency_key: 'idem-email-1' };

/* ------------------------------------------------------------------ *
 * The consumer.                                                        *
 * ------------------------------------------------------------------ */

test('a dead letter redelivered after its mirror row landed leaves one row, with its idempotency key', async () => {
  const db = database();
  // Delivery 1 dies right after the mirror INSERT: the email mark and the ack never happen.
  const first = binding(db, { dieAfter: /INTO cf_dlq_mirror/i });
  const d1 = await deliver({ DB: first.DB }, EMAIL_BODY, 1, 'msg-dlq-1', first.state);
  assert.equal(d1.result, 'none', 'the first delivery died before it acked');
  assert.equal(one(db, 'SELECT status FROM email_send_log WHERE id = ?', LOG_ID).status, 'failed');

  // Delivery 2 (same message id) finishes.
  const d2 = await deliver({ DB: binding(db).DB }, EMAIL_BODY, 2);
  assert.equal(d2.result, 'ack');
  const rows = db.prepare('SELECT message_id, job_type, idempotency_key FROM cf_dlq_mirror').all().map((r: any) => ({ ...r }));
  assert.deepEqual(rows, [{ message_id: 'msg-dlq-1', job_type: 'email_send', idempotency_key: 'idem-email-1' }]);
  assert.equal(one(db, 'SELECT status FROM email_send_log WHERE id = ?', LOG_ID).status, 'dlq');
});

test('a mirror that fails before the final attempt is retried after a delay and logs nothing yet', async () => {
  const db = database();
  const down = binding(db, { failing: /INTO cf_dlq_mirror/i });
  for (let attempts = 1; attempts < JOB_DLQ_FINAL_ATTEMPT; attempts += 1) {
    const d = await deliver({ DB: down.DB }, EMAIL_BODY, attempts);
    assert.deepEqual(d, { result: 'retry', delaySeconds: JOB_DLQ_RETRY_SECONDS }, `attempt ${attempts}`);
  }
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM error_logs'), 0);
  // D1 is back on the next delivery: the row lands once and the message is acked.
  const d = await deliver({ DB: binding(db).DB }, EMAIL_BODY, JOB_DLQ_FINAL_ATTEMPT);
  assert.equal(d.result, 'ack');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cf_dlq_mirror'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM error_logs'), 0);
});

test('a mirror that fails on the final attempt writes one error_logs row, without the payload, and acks', async () => {
  const db = database();
  const down = binding(db, { failing: /INTO cf_dlq_mirror/i });
  const d = await deliver({ DB: down.DB }, EMAIL_BODY, JOB_DLQ_FINAL_ATTEMPT, 'msg-dlq-lost');
  assert.equal(d.result, 'ack', 'the final attempt gives up explicitly');
  const rows = db.prepare(`SELECT level, source, details FROM error_logs`).all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].level, 'ERROR');
  assert.equal(rows[0].source, 'dlq-consumer');
  const details = JSON.parse(rows[0].details);
  assert.equal(details.job_type, 'email_send');
  assert.equal(details.message_id, 'msg-dlq-lost');
  assert.doesNotMatch(rows[0].details, /payload-not-logged/, 'the payload is never logged');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cf_dlq_mirror'), 0);
});

test('wrangler.toml gives every job DLQ consumer the delay and retry count the consumer is written for', () => {
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const blocks = toml.split(/\n(?=\[\[)/).filter((b) => /^\[\[(?:env\.\w+\.)?queues\.consumers\]\]/.test(b) && /\nqueue\s*=\s*"studioos-job-queue(?:-preview)?-dlq"/.test(b));
  assert.equal(blocks.length, 3, 'top level, production and preview');
  for (const b of blocks) {
    assert.match(b, new RegExp(`\\nretry_delay\\s*=\\s*${JOB_DLQ_RETRY_SECONDS}\\s*\\n`), b);
    assert.match(b, new RegExp(`\\nmax_retries\\s*=\\s*${JOB_DLQ_FINAL_ATTEMPT}\\s*\\n`), b);
    assert.doesNotMatch(b, /dead_letter_queue/, 'the DLQ has no DLQ of its own; the final attempt is the record');
  }
});

/* ------------------------------------------------------------------ *
 * The migration.                                                       *
 * ------------------------------------------------------------------ */

test('the migration keeps the first row per message, then holds message_id unique', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE cf_dlq_mirror (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, job_type TEXT NOT NULL,
    payload TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO cf_dlq_mirror (id, message_id, job_type) VALUES (1, 'a', 'email_send'), (2, 'b', 'x'), (3, 'a', 'email_send'), (4, 'a', 'email_send');`);
  db.exec(readFileSync(new URL('../sql/migrations/202611272117_9034_cf_dlq_mirror_once.sql', import.meta.url), 'utf8'));
  assert.deepEqual(db.prepare('SELECT id, message_id, idempotency_key FROM cf_dlq_mirror ORDER BY id').all().map((r: any) => ({ ...r })),
    [{ id: 1, message_id: 'a', idempotency_key: null }, { id: 2, message_id: 'b', idempotency_key: null }]);
  assert.throws(() => db.exec(`INSERT INTO cf_dlq_mirror (message_id, job_type) VALUES ('a', 'email_send')`), /UNIQUE/);
});

test('the fresh schema and the runtime bootstrap declare the same unique index', () => {
  const db = database();
  const idx = one(db, `SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'idx_cf_dlq_message'`);
  assert.match(String(idx?.sql), /UNIQUE INDEX[\s\S]*cf_dlq_mirror\s*\(\s*message_id\s*\)/i);
  const infraSrc = readFileSync(new URL('../src/routes/infra.ts', import.meta.url), 'utf8');
  assert.match(infraSrc, /CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_dlq_message ON cf_dlq_mirror\(message_id\)/);
});

/* ------------------------------------------------------------------ *
 * The replay and the discard.                                          *
 * ------------------------------------------------------------------ */

async function bearer(userId: number) {
  return `Bearer ${await new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))}`;
}

/**
 * D1 over `db`, where the replay's read of the row waits until `readers`
 * requests have read it: both clicks have seen the row before either claims it,
 * the interleaving that double-enqueued before D9034.
 */
function bothReadFirst(db: DatabaseSync, readers: number) {
  const inner: any = d1Over(db);
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const wrap = (sql: string, stmt: any): any => ({
    bind: (...a: unknown[]) => wrap(sql, stmt.bind(...a)),
    run: () => stmt.run(),
    all: () => stmt.all(),
    async first(col?: string) {
      const r = await stmt.first(col);
      if (/^\s*SELECT id, (?:message_id|original_job_id), job_type/i.test(sql)) {
        arrived += 1;
        if (arrived >= readers) open();
        await gate;
      }
      return r;
    },
  });
  return new Proxy(inner, { get: (t, k) => (k === 'prepare' ? (sql: string) => wrap(sql, t.prepare(sql)) : Reflect.get(t, k)) });
}

function routeEnv(db: DatabaseSync, opts: { sendFails?: boolean; readers?: number } = {}) {
  const sent: any[] = [];
  const env: any = {
    DB: opts.readers ? bothReadFirst(db, opts.readers) : d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', USE_CF_QUEUE: 'true',
    JOB_QUEUE: {
      async send(body: unknown) { await Promise.resolve(); if (opts.sendFails) throw new Error('queue down'); sent.push(body); },
      async sendBatch() { throw new Error('unused'); },
    },
  };
  return { env, sent };
}

const call = (env: any, method: string, path: string, user: number) => quiet(async () =>
  infra.fetch(new Request(`http://x${path}`, { method, headers: { Authorization: await bearer(user) } }), env));

function seedDeadLetter(db: DatabaseSync, key: string | null = 'idem-email-1') {
  db.prepare(`INSERT INTO cf_dlq_mirror (message_id, job_type, payload, attempts, error, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('msg-dlq-9', 'email_send', JSON.stringify({ log_id: LOG_ID }), 4, 'CF DLQ message', key);
  return Number(one(db, `SELECT id FROM cf_dlq_mirror WHERE message_id = 'msg-dlq-9'`).id);
}

const audits = (db: DatabaseSync, action: string) => db.prepare(
  `SELECT user_id, details FROM activity_logs WHERE action = ?`).all(action).map((r: any) => ({ user_id: r.user_id, details: JSON.parse(r.details) }));

test('two concurrent replays of one dead letter enqueue it once; the other answers 409', async () => {
  const db = database();
  const id = seedDeadLetter(db);
  const { env, sent } = routeEnv(db, { readers: 2 });
  const [a, b] = await Promise.all([
    call(env, 'POST', `/dlq/${id}/retry?source=cf`, ADMIN),
    call(env, 'POST', `/dlq/${id}/retry?source=cf`, OTHER_ADMIN),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const refused = a.status === 409 ? a : b;
  assert.equal((await refused.json() as any).error, 'dlq_item_already_claimed');
  assert.equal(sent.length, 1, 'one enqueue');
  assert.equal(sent[0].job_type, 'email_send');
  assert.deepEqual(sent[0].payload, { log_id: LOG_ID });
  assert.equal(sent[0].idempotency_key, `idem-email-1:dlq-replay:cf-${id}`, 'the stored key is the stem');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cf_dlq_mirror'), 0);
  const rows = audits(db, 'dlq_replayed');
  assert.equal(rows.length, 1, 'one audit row for the one replay');
  assert.deepEqual({ ...rows[0].details, transport: undefined }, { source: 'cf', dlq_id: id, job_type: 'email_send', transport: undefined });
  assert.ok([ADMIN, OTHER_ADMIN].includes(rows[0].user_id));
  assert.doesNotMatch(JSON.stringify(rows), /log_id/, 'the audit row carries no payload');
});

test('a replay whose enqueue throws puts the dead letter back unchanged and audits nothing', async () => {
  const db = database();
  const id = seedDeadLetter(db);
  const before = { ...one(db, 'SELECT * FROM cf_dlq_mirror WHERE id = ?', id) };
  const { env, sent } = routeEnv(db, { sendFails: true });
  const res = await call(env, 'POST', `/dlq/${id}/retry?source=cf`, ADMIN);
  assert.equal(res.status, 502);
  assert.equal((await res.json() as any).error, 'dlq_replay_enqueue_failed');
  assert.equal(sent.length, 0);
  assert.deepEqual({ ...one(db, 'SELECT * FROM cf_dlq_mirror WHERE id = ?', id) }, before);
  assert.equal(audits(db, 'dlq_replayed').length, 0);
});

test('a d1 dead letter replays once too, keyed by its row', async () => {
  const db = database();
  db.prepare(`INSERT INTO dead_letter_queue (job_type, payload, last_error, attempts) VALUES ('email_send', ?, 'boom', 3)`).run(JSON.stringify({ log_id: LOG_ID }));
  const id = Number(one(db, 'SELECT id FROM dead_letter_queue').id);
  const { env, sent } = routeEnv(db, { readers: 2 });
  const [a, b] = await Promise.all([
    call(env, 'POST', `/dlq/${id}/retry?source=d1`, ADMIN),
    call(env, 'POST', `/dlq/${id}/retry?source=d1`, ADMIN),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotency_key, `dlq-d1-${id}:dlq-replay:d1-${id}`);
  assert.equal(audits(db, 'dlq_replayed').length, 1);
});

test('deleting a dead letter writes one audit row with the actor, source, row and job type', async () => {
  const db = database();
  const id = seedDeadLetter(db);
  const { env } = routeEnv(db);
  const res = await call(env, 'DELETE', `/dlq/${id}?source=cf`, ADMIN);
  assert.equal(res.status, 200);
  assert.deepEqual(audits(db, 'dlq_deleted'), [{ user_id: ADMIN, details: { source: 'cf', dlq_id: id, job_type: 'email_send' } }]);
  const again = await call(env, 'DELETE', `/dlq/${id}?source=cf`, ADMIN);
  assert.equal(again.status, 404);
  assert.equal(audits(db, 'dlq_deleted').length, 1, 'a delete that found nothing audits nothing');
});

test('the replay key drops an earlier replay suffix, so a re-dead-lettered replay does not grow its key', () => {
  assert.equal(dlqReplayKey('cf', 12, 'k1'), 'k1:dlq-replay:cf-12');
  assert.equal(dlqReplayKey('cf', 15, 'k1:dlq-replay:cf-12'), 'k1:dlq-replay:cf-15');
  assert.equal(dlqReplayKey('cf', 15, null), 'dlq-cf-15:dlq-replay:cf-15');
  assert.equal(dlqReplayKey('d1', 3, ''), 'dlq-d1-3:dlq-replay:d1-3');
});
