/**
 * D9032 (#9032) — HQ · Platform's detected incidents notify through the
 * capacity alert episodes (D4559), so nobody has to open the page.
 *
 *   1. Three failed runs in a row of one trigger open one episode and one
 *      notice; a later ok run clears it.
 *   2. One new non-agent dead letter in cf_dlq_mirror opens a warning; DLQ_HIGH
 *      makes it critical; agent-run letters (agents/alerts.ts reports them) and
 *      the backlog already waiting at the first sweep do not count; replaying
 *      the new letters clears it.
 *   3. A webhook refusal streak at WEBHOOK_FAILURE_STREAK opens an episode.
 *   4. A source that cannot be read holds an open episode and opens none.
 *   5. Running the sweep twice sends no second notice.
 *   6. A branch deploy sends none.
 *
 * Real SQLite (node:sqlite through _d1_sqlite.mjs), synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/platform_incident_alerts_9032.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import { sweepPlatformCapacity, SNAPSHOT_KEY } from '../src/services/platformCapacityHistory.ts';
import { DLQ_MARK_KEY, readIncidentSignals } from '../src/services/platformCapacitySignals.ts';
import { CRON_FAILURE_STREAK, DLQ_HIGH, WEBHOOK_FAILURE_STREAK } from '../src/services/platformHealth.ts';
import { STRIPE_WEBHOOK_PATH } from '../src/services/stripeWebhookDeliveries.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATION = readFileSync(join(ROOT, 'cloudflare-worker/sql/migrations/202611072340_platform_capacity_history.sql'), 'utf8');
const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, is_active INTEGER, role TEXT, notification_prefs TEXT);
  CREATE TABLE super_admins (user_id INTEGER);
  CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT, title TEXT, body TEXT,
    link TEXT, meta TEXT, dedupe_key TEXT, UNIQUE (user_id, kind, dedupe_key));
  CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT,
    link TEXT, payload TEXT, channel TEXT, category TEXT);
  CREATE TABLE cron_run_history (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_name TEXT, started_at TEXT, finished_at TEXT, status TEXT);
  CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, endpoint TEXT, status_code INTEGER, created_at TEXT);
  CREATE TABLE dead_letter_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, original_job_id INTEGER, job_type TEXT NOT NULL,
    payload TEXT, last_error TEXT, attempts INTEGER NOT NULL DEFAULT 0, moved_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE cf_dlq_mirror (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, job_type TEXT NOT NULL,
    payload TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
  ${MIGRATION}
`;
const SEED = `
  INSERT INTO users VALUES (1, 1, 'admin', NULL), (3, 1, 'founder', NULL);
  INSERT INTO super_admins VALUES (1);
`;

function memKv() {
  const m = new Map<string, string>();
  let down = false;
  return {
    m, setDown: (v: boolean) => { down = v; },
    get: async (k: string) => { if (down) throw new Error('kv down'); return m.get(k) ?? null; },
    put: async (k: string, v: string) => { if (down) throw new Error('kv down'); m.set(k, v); },
  };
}

/** A real SQLite D1 whose capacity size read answers 1 GB (no capacity episode), and one table can be made unreadable. */
function setup() {
  const db = makeD1(SCHEMA, SEED).DB;
  const broken = new Set<string>();
  const DB = new Proxy(db, {
    get(t, k) {
      if (k !== 'prepare') { const v = (t as any)[k]; return typeof v === 'function' ? v.bind(t) : v; }
      return (sql: string) => {
        if (sql === 'SELECT 1') return { run: async () => ({ meta: { size_after: 1_000_000_000 } }) };
        for (const name of broken) if (sql.includes(name)) throw new Error(`no such table: ${name}`);
        return t.prepare(sql);
      };
    },
  });
  const kv = memKv();
  const env = { DB, RATE_LIMITS: kv } as any;
  return { db, env, kv, broken };
}
const T0 = Date.parse('2026-11-27T10:11:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const CRON = '0 3 * * *';
const cronRun = (db: any, status: string, min: number) => db.prepare(
  `INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status) VALUES (?, ?, ?, ?)`,
).bind(CRON, stamp(at(min)), stamp(at(min)), status).run();
const delivery = (db: any, code: number, min: number) => db.prepare(
  `INSERT INTO activity_logs (action, endpoint, status_code, created_at) VALUES ('request', ?, ?, ?)`,
).bind(STRIPE_WEBHOOK_PATH, code, stamp(at(min))).run();
const mirrorLetter = (db: any, jobType: string) => db.prepare(
  `INSERT INTO cf_dlq_mirror (message_id, job_type, payload, attempts, error) VALUES (?, ?, '{}', 3, 'synthetic')`,
).bind(`msg-${Math.random().toString(16).slice(2)}`, jobType).run();
const legacyLetter = (db: any) => db.prepare(
  `INSERT INTO dead_letter_queue (job_type, payload, last_error, attempts) VALUES ('email_send', '{}', 'synthetic', 5)`,
).run();
const all = async (db: any, sql: string) => ((await db.prepare(sql).all()).results as any[]).map((r) => ({ ...r }));
const episodes = (db: any) => all(db, `SELECT metric_key, severity, state FROM platform_capacity_alerts ORDER BY id`);
const titles = async (db: any) => (await all(db, `SELECT title FROM notifications_inbox ORDER BY id`)).map((r) => r.title);

test('1, 5: three failed runs of one trigger open one episode and one notice; a second sweep sends none; an ok run clears it', async () => {
  // Mutations checked: CRON_STREAK_THRESHOLDS.warning set to CRON_FAILURE_STREAK + 1 (no episode at 3);
  // the streak reduced with Math.min (0, never opens); the sweep evaluating report.metrics only (no episode).
  const { db, env } = setup();
  await cronRun(db, 'ok', -60);
  await cronRun(db, 'failed', -45);
  await cronRun(db, 'failed', -30);
  await sweepPlatformCapacity(env, at(-29));
  assert.deepEqual(await episodes(db), [], `${CRON_FAILURE_STREAK - 1} failures in a row is not yet an episode`);
  await cronRun(db, 'error', -15);
  await sweepPlatformCapacity(env, at(0));
  await sweepPlatformCapacity(env, at(15));
  assert.deepEqual(await episodes(db), [{ metric_key: 'incidents.cron.failure_streak', severity: 'warning', state: 'open' }]);
  assert.deepEqual(await titles(db), ['Warning: Scheduled job failing runs in a row'],
    'one notice, to the Super Admin only, however many sweeps see it');
  await cronRun(db, 'ok', 20);
  await sweepPlatformCapacity(env, at(30));
  await sweepPlatformCapacity(env, at(45));
  assert.deepEqual(await episodes(db), [{ metric_key: 'incidents.cron.failure_streak', severity: 'warning', state: 'cleared' }]);
  assert.deepEqual(await titles(db), ['Warning: Scheduled job failing runs in a row', 'Cleared: Scheduled job failing runs in a row']);
});

test('2, 5: a new non-agent dead letter opens a warning, DLQ_HIGH makes it critical, replaying them clears it', async () => {
  // Mutations checked: the agent_run exclusion dropped (an agent letter opens one); the mark advanced on every
  // sweep (the second sweep clears and notifies); the first sweep reporting the old backlog as measured;
  // NEW_DEAD_LETTER_THRESHOLDS.critical not DLQ_HIGH; the legacy table left out of the count.
  const { db, env, kv } = setup();
  for (let i = 0; i < 4; i += 1) await mirrorLetter(db, 'email_send');
  await legacyLetter(db);
  await sweepPlatformCapacity(env, at(0));
  assert.deepEqual(JSON.parse(kv.m.get(DLQ_MARK_KEY)!), { legacy: 1, mirror: 4 }, 'the first sweep sets the starting point');
  assert.deepEqual(await episodes(db), [], 'the backlog already waiting is the page figure, not a new arrival');

  await mirrorLetter(db, 'agent_run');
  await sweepPlatformCapacity(env, at(15));
  assert.deepEqual(await episodes(db), [], 'agent-run letters are reported by agents/alerts.ts, not here');

  await mirrorLetter(db, 'stripe_fulfilment');
  await sweepPlatformCapacity(env, at(30));
  await sweepPlatformCapacity(env, at(45));
  assert.deepEqual(await episodes(db), [{ metric_key: 'incidents.dlq.new_waiting', severity: 'warning', state: 'open' }]);
  assert.deepEqual(await titles(db), ['Warning: New dead letters waiting'], 'a second sweep sends no second notice');

  for (let i = 0; i < DLQ_HIGH - 2; i += 1) await mirrorLetter(db, 'syndication_push');
  await legacyLetter(db);
  await sweepPlatformCapacity(env, at(60));
  assert.deepEqual(await episodes(db), [{ metric_key: 'incidents.dlq.new_waiting', severity: 'critical', state: 'open' }],
    `${DLQ_HIGH} new letters across both tables is critical, in place`);

  // Replayed or discarded: the new letters leave both tables; the old backlog and the agent letter stay.
  await db.prepare(`DELETE FROM cf_dlq_mirror WHERE id > 4 AND job_type != 'agent_run'`).run();
  await db.prepare(`DELETE FROM dead_letter_queue WHERE id > 1`).run();
  await sweepPlatformCapacity(env, at(75));
  await sweepPlatformCapacity(env, at(90));
  assert.deepEqual((await episodes(db)).map((e) => e.state), ['cleared']);
  assert.deepEqual(await titles(db), ['Warning: New dead letters waiting', 'Critical: New dead letters waiting', 'Cleared: New dead letters waiting']);
  const top = (await db.prepare(`SELECT MAX(id) AS id FROM cf_dlq_mirror`).first()).id;
  assert.deepEqual(JSON.parse(kv.m.get(DLQ_MARK_KEY)!).mirror >= top, true, 'a quiet sweep moves the mark up');
});

test('3: a webhook refusal streak at WEBHOOK_FAILURE_STREAK opens an episode', async () => {
  // Mutations checked: WEBHOOK_STREAK_THRESHOLDS.warning set one higher; the webhook signal left out of readIncidentSignals.
  const { db, env } = setup();
  await delivery(db, 200, -60);
  for (let i = 1; i < WEBHOOK_FAILURE_STREAK; i += 1) await delivery(db, 400, -60 + i);
  await sweepPlatformCapacity(env, at(0));
  assert.deepEqual(await episodes(db), []);
  await delivery(db, 400, -5);
  await sweepPlatformCapacity(env, at(15));
  assert.deepEqual(await episodes(db), [{ metric_key: 'incidents.webhook.refusal_streak', severity: 'warning', state: 'open' }]);
  assert.deepEqual(await titles(db), ['Warning: Stripe webhook deliveries refused in a row']);
});

test('4: a source that cannot be read holds an open episode and opens none', async () => {
  // Mutations checked: an unavailable reading clearing the open episode (evaluateAlerts' outage branch);
  // readCronStreakSignal reporting an unreadable read as a measured 0.
  const { db, env, kv, broken } = setup();
  for (const min of [-40, -30, -20]) await cronRun(db, 'failed', min);
  await sweepPlatformCapacity(env, at(0), { snapshot: true });
  assert.equal((await episodes(db)).length, 1);

  broken.add('cron_run_history');
  broken.add('activity_logs');
  kv.setDown(true);
  await sweepPlatformCapacity(env, at(15), { snapshot: true });
  await sweepPlatformCapacity(env, at(30));
  assert.deepEqual(await episodes(db), [{ metric_key: 'incidents.cron.failure_streak', severity: 'warning', state: 'open' }],
    'the open episode is held, and the unreadable webhook and dead-letter sources open nothing');
  assert.deepEqual(await titles(db), ['Warning: Scheduled job failing runs in a row']);
  const signals = await readIncidentSignals(env, at(30));
  assert.deepEqual(signals.map((s) => [s.key, s.availability, s.value]), [
    ['incidents.cron.failure_streak', 'unavailable', null],
    ['incidents.webhook.refusal_streak', 'unavailable', null],
    ['incidents.dlq.new_waiting', 'unavailable', null],
  ], 'missing is not zero');
  for (const s of signals) assert.ok(!SNAPSHOT_KEY.test(s.key), `${s.key} is not snapshotted`);
});

test('6: a branch deploy sends no notice', async () => {
  const { db, env } = setup();
  for (const min of [-40, -30, -20]) await cronRun(db, 'failed', min);
  await mirrorLetter(db, 'email_send');
  const r = await sweepPlatformCapacity({ ...env, BRANCH_CODE: 'synthetic', DEPLOYMENT_TIER: 'branch' }, at(0));
  assert.equal((r as any).skipped, 'branch');
  assert.deepEqual(await episodes(db), []);
  assert.deepEqual(await titles(db), []);
});
