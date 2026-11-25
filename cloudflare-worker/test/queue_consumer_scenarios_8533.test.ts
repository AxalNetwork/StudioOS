/**
 * D8533 (#8533) — the application job queue's consumers under at-least-once
 * delivery: a duplicate, an interruption after a durable write, exhausted
 * retries and a replay each end in one business outcome and a visible status.
 * The four scenarios are `_queue_scenarios.ts`; this file gives them two
 * consumers, both behind `queueConsumer` / `dlqConsumer` in `src/queue-consumer.ts`:
 *
 *   payment fulfillment   `incorporation_packet_start`, produced by the Stripe
 *                         webhook's paid recorder (`recordPaidIncorporation`):
 *                         the paid order moves to packet_processing and its
 *                         formation case to preparing, once.
 *   notifications         `email_send`, produced by `send()`: the email goes to
 *                         the provider once and its `email_send_log` row reads
 *                         `sent` (`dlq` while it sits in the dead letter).
 *
 * Each consumer is interrupted at two points: the delivery claim (the
 * consumer's first durable write) and its own business write.
 *
 * Real SQLite (the migrated schema through `_schema_once.mjs`); the Gmail API
 * is an in-memory fake. Nothing reaches a real queue.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/queue_consumer_scenarios_8533.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  DELIVERY_CLAIM, HARNESS_JWT_SECRET, jobQueue, queueScenarioTests, replayJobQueueDeadLetter, runExhausted, seedHarnessAdmin,
  type Harness, type QueueConsumerSpec, type QueueWorld,
} from './_queue_scenarios.ts';
import { queueConsumer, dlqConsumer } from '../src/queue-consumer.ts';
import { recordPaidIncorporation } from '../src/services/incorporations.ts';
import { send } from '../src/services/email/send.ts';

const FOUNDER = 10;
const quiet = async <T>(fn: () => Promise<T>) => {
  const { warn, error, info } = console;
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; console.info = info; }
};

function database() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  seedHarnessAdmin(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES (${FOUNDER}, 'founder', 'Fay', 'fay@example.test', 1);
    INSERT INTO projects (id, name) VALUES (1, 'Acme');`);
  return db;
}

const one = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;

/* ------------------------------------------------------------------ *
 * Payment fulfillment: incorporation_packet_start.                     *
 * ------------------------------------------------------------------ */

type FulfilmentWorld = QueueWorld & { db: DatabaseSync; incorporationId: number };
const ORDER = 20;

const fulfilmentState = (w: FulfilmentWorld) => one(w.db,
  `SELECT i.status AS status, c.stage AS stage, c.id AS case_id FROM incorporations i
     JOIN formation_case_orders o ON o.incorporation_id = i.id JOIN formation_cases c ON c.id = o.case_id WHERE i.id = ?`, w.incorporationId);

queueScenarioTests<FulfilmentWorld>({
  name: 'payment fulfillment (incorporation_packet_start)',
  ...jobQueue,
  consumer: queueConsumer,
  dlqConsumer,
  async setup(h: Harness) {
    const db = database();
    db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status)
      VALUES (?, ?, 1, 'us_de_ccorp', 'Acme Inc', 50000, 'pending_payment')`).run(ORDER, FOUNDER);
    const env: any = { DB: h.d1(d1Over(db)), USE_CF_QUEUE: 'true', JOB_QUEUE: h.queue, JWT_SECRET: HARNESS_JWT_SECRET, ENVIRONMENT: 'development' };
    // The Stripe webhook's paid recorder produces the message, as production does.
    await quiet(() => recordPaidIncorporation(env, { id: 'cs_8533', metadata: { incorporation_id: String(ORDER) }, payment_status: 'paid', amount_total: 50000, currency: 'usd' }));
    const [body] = h.take();
    return { env, db, body, incorporationId: ORDER };
  },
  outcomes: (w) => Number(one(w.db,
    `SELECT COUNT(*) AS n FROM formation_case_events WHERE case_id = ? AND kind = 'stage_change' AND to_stage = 'preparing'`,
    fulfilmentState(w).case_id).n),
  status: (w) => { const s = fulfilmentState(w); return `order=${s.status} case=${s.stage}`; },
  deadLetters: jobQueue.deadLetters,
  duplicatesRecorded: jobQueue.duplicatesRecorded,
  expect: { done: 'order=packet_processing case=preparing', deadLettered: 'order=paid case=paid' },
  interruptions: [
    DELIVERY_CLAIM,
    { label: 'the stage change', after: (sql) => /INSERT INTO formation_case_events/i.test(sql) },
  ],
  breakIt: (_w, h) => h.failWrites((sql) => /formation_case/i.test(sql)),
  heal: (_w, h) => h.failWrites(null),
  replay: replayJobQueueDeadLetter,
  elapse: jobQueue.elapse,
});

/* ------------------------------------------------------------------ *
 * Notifications: email_send.                                           *
 * ------------------------------------------------------------------ */

type EmailWorld = QueueWorld & { db: DatabaseSync; logId: number; gmail: { accepted: number; down: boolean } };

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

/** The Gmail API: a token, then a send it accepts unless `down`. A dead isolate reaches neither. */
function fakeGmail(h: Harness, gmail: EmailWorld['gmail']): typeof fetch {
  return (async (input: any) => {
    if (h.dead) throw new Error('isolate died before the request left');
    const url = String(input?.url ?? input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok' });
    if (url.startsWith('https://gmail.googleapis.com/')) {
      if (gmail.down) return Response.json({ error: 'backendError' }, { status: 503 });
      gmail.accepted += 1;
      return Response.json({ id: `gm-${gmail.accepted}` });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

const emailSpec: QueueConsumerSpec<EmailWorld> = {
  name: 'notifications (email_send)',
  ...jobQueue,
  consumer: queueConsumer,
  dlqConsumer,
  async setup(h: Harness) {
    const db = database();
    const gmail = { accepted: 0, down: false };
    globalThis.fetch = fakeGmail(h, gmail);
    const env: any = {
      DB: h.d1(d1Over(db)), USE_CF_QUEUE: 'true', JOB_QUEUE: h.queue, JWT_SECRET: HARNESS_JWT_SECRET, ENVIRONMENT: 'development',
      GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh',
    };
    const r = await quiet(() => send(env, 'auth_verify_email', 'fay@example.test', { name: 'Fay', verify_url: 'https://axal.vc/verify?t=1' }, { userId: FOUNDER, skipMirror: true }));
    const [body] = h.take();
    return { env, db, body, logId: Number(r.log_id), gmail };
  },
  outcomes: (w) => w.gmail.accepted,
  status: (w) => String(one(w.db, 'SELECT status FROM email_send_log WHERE id = ?', w.logId).status),
  deadLetters: jobQueue.deadLetters,
  duplicatesRecorded: jobQueue.duplicatesRecorded,
  expect: { done: 'sent', deadLettered: 'dlq' },
  interruptions: [
    DELIVERY_CLAIM,
    { label: 'the sent mark', after: (sql) => /UPDATE email_send_log SET status='sent'/i.test(sql) },
  ],
  breakIt: (w) => { w.gmail.down = true; },
  heal: (w) => { w.gmail.down = false; },
  replay: replayJobQueueDeadLetter,
  elapse: jobQueue.elapse,
};
queueScenarioTests(emailSpec);

test('notifications (email_send): every delivery before the dead letter tried the provider', async () => {
  // A failed delivery releases its claim, so the retry runs the job again rather
  // than waiting out the lease (each try is one `attempts` on the log row).
  const { world } = await runExhausted(emailSpec);
  const row = one(world.db, 'SELECT status, attempts, last_error FROM email_send_log WHERE id = ?', world.logId);
  assert.deepEqual({ ...row }, { status: 'dlq', attempts: jobQueue.maxRetries + 1, last_error: 'gmail_send_failed' });
});
