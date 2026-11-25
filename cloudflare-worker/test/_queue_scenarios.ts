/**
 * D8533 (#8533) — the queue consumer scenario harness: four ways an
 * at-least-once delivery goes wrong, run against ONE message, each ending in
 * one business outcome and a status a person can see.
 *
 *   duplicate     the same message is delivered twice;
 *   interrupted   the consumer dies right after a durable write (each point
 *                 the spec names), and the platform delivers the message again;
 *   exhausted     every delivery fails until the retries run out, and the
 *                 message reaches the dead-letter consumer;
 *   replay        the dead-lettered message goes back through the normal
 *                 recovery path (for the job queue, `POST /api/infra/dlq/:id/retry`).
 *
 * WHAT THE HARNESS PLAYS. The Cloudflare Queues platform, as wrangler.toml
 * configures it: a delivery that acks (explicitly, or by returning) is done; a
 * delivery that calls `retry()`, throws, or dies is delivered again with
 * `attempts + 1` (after the delay it asked for, through `spec.elapse`); after
 * `maxRetries` retries the message goes to the dead-letter queue's consumer,
 * which is itself retried the same way. Nothing reaches a real queue.
 *
 * WHAT "DIES" MEANS. `h.d1(binding)` wraps the world's D1. Interrupting after a
 * write lets that write land (a `batch` counts as one write, as D1 commits it
 * as one) and then kills the isolate: every later statement throws, `ack()` and
 * `retry()` reach nobody, and a fake external service the spec builds must
 * refuse work while `h.dead` is true (a dead isolate sends no email). The next
 * delivery runs in a new isolate.
 *
 * HOW TO USE IT (#8516 and #8525 reuse it for their consumers):
 *
 *   import { queueScenarioTests, jobQueue } from './_queue_scenarios.ts';
 *   queueScenarioTests({
 *     name: 'my consumer', ...jobQueue,      // or your own queue, consumers, maxRetries
 *     async setup(h) { … return { env, db, body }; },   // env.DB = h.d1(…), env.JOB_QUEUE = h.queue
 *     outcomes: (w) => …,                    // how many times the business effect happened
 *     status: (w) => …,                      // the status a person sees, as one string
 *     deadLetters: jobQueue.deadLetters,     // rows the dead-letter consumer left for this message
     duplicatesRecorded: jobQueue.duplicatesRecorded, // optional: the redelivery was seen as a duplicate
 *     expect: { done: '…', deadLettered: '…' },
 *     interruptions: [{ label: 'the delivery claim', after: (sql) => /…/.test(sql) }],
 *     breakIt(w, h) { … }, heal(w, h) { … }, // make every delivery fail, then stop that
 *     replay: replayJobQueueDeadLetter,      // or your queue's recovery path
 *     elapse: jobQueue.elapse,               // what a delayed retry's wait does to the world
 *   });
 *
 * It registers one `node:test` test per scenario (one per interruption point).
 * The `run*` functions are exported for a test that wants the result instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

/** The isolate died: thrown by every statement after the interruption point. */
export class IsolateDied extends Error {
  constructor() { super('isolate died (D8533 harness)'); this.name = 'IsolateDied'; }
}

const WRITE = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b|^\s*WITH\b[\s\S]*\b(?:INSERT|UPDATE|DELETE)\b/i;
/** True for a statement that writes rows (DDL is not a durable business write). */
export const isWrite = (sql: string) => WRITE.test(sql);

type SqlMatch = (sql: string) => boolean;

export interface Harness {
  /** Wrap a D1 binding so the harness can interrupt after a write and fail writes on demand. */
  d1(inner: any): any;
  /** A queue producer binding: whatever the code under test sends lands in `sent`. */
  readonly queue: { send(body: unknown, opts?: unknown): Promise<void>; sendBatch(msgs: Array<{ body: unknown }>): Promise<void> };
  /** Every body sent to `queue`, oldest first. */
  readonly sent: unknown[];
  /** Remove and return what was sent since the last call. */
  take(): unknown[];
  /** True while the simulated isolate is dead. A fake external service must refuse work then. */
  readonly dead: boolean;
  /** Make every write `match` accepts throw before it runs (null stops it). */
  failWrites(match: SqlMatch | null): void;
}

export interface Delivery {
  queue: string;
  attempts: number;
  result: 'ack' | 'retry' | 'threw' | 'died';
  delaySeconds?: number;
  error?: string;
}

export interface QueueWorld { env: any; body: unknown; [k: string]: unknown }

export interface QueueConsumerSpec<W extends QueueWorld = QueueWorld> {
  name: string;
  /** The queue the consumer reads, and its dead-letter queue (names as wrangler.toml has them). */
  queue: string;
  dlqQueue: string;
  consumer: (batch: any, env: any, ctx: any) => Promise<void>;
  dlqConsumer: (batch: any, env: any, ctx: any) => Promise<void>;
  /** `max_retries` of the consumer in wrangler.toml: a message is delivered at most maxRetries + 1 times. */
  maxRetries: number;
  /** A fresh world with ONE message, already produced by the real producer where there is one. */
  setup(h: Harness): Promise<W>;
  /** How many times the business effect happened (one, or zero after exhaustion). */
  outcomes(w: W): number | Promise<number>;
  /** The status a person sees, as one string. */
  status(w: W): string | Promise<string>;
  /** How many dead-letter records the dead-letter consumer left for this message. */
  deadLetters(w: W): number | Promise<number>;
  /**
   * How many deliveries the consumer recorded as a duplicate (the status of the
   * second delivery). When given, the duplicate scenario requires exactly one:
   * a handler whose own state happens to absorb a re-run does not stand in for
   * the dedupe.
   */
  duplicatesRecorded?(w: W): number | Promise<number>;
  expect: { done: string; deadLettered: string };
  /** The durable writes to interrupt after. Default: the consumer's first write of any kind. */
  interruptions?: Array<{ label: string; after: SqlMatch }>;
  /** Make every delivery fail; `heal` stops that before the replay. */
  breakIt(w: W, h: Harness): void | Promise<void>;
  heal(w: W, h: Harness): void | Promise<void>;
  /** Send the dead-lettered message back through the normal recovery path; the new message lands in `h.queue`. */
  replay(w: W, h: Harness): Promise<void>;
  /** A delayed retry's wait (the seconds `retry({ delaySeconds })` asked for), applied to the world. */
  elapse?(w: W, seconds: number): void | Promise<void>;
}

export interface ScenarioResult {
  deliveries: Delivery[];
  outcomes: number;
  status: string;
  deadLetters: number;
}

/** A fixed message timestamp: the harness never reads the wall clock. */
const MESSAGE_TIME = Date.parse('2026-11-25T09:00:00Z');

class Platform implements Harness {
  sent: unknown[] = [];
  dead = false;
  private interruptAfter: SqlMatch | null = null;
  private failing: SqlMatch | null = null;
  private seq = 0;

  readonly queue = {
    send: async (body: unknown) => { this.guard(); this.sent.push(body); },
    sendBatch: async (msgs: Array<{ body: unknown }>) => { this.guard(); for (const m of msgs) this.sent.push(m.body); },
  };

  take() { return this.sent.splice(0, this.sent.length); }
  failWrites(match: SqlMatch | null) { this.failing = match; }
  arm(after: SqlMatch) { this.interruptAfter = after; }
  revive() { this.dead = false; }
  nextId() { this.seq += 1; return `msg-${this.seq}`; }

  private guard() { if (this.dead) throw new IsolateDied(); }
  /** Before a statement: a dead isolate runs nothing, and an injected failure refuses its writes. */
  private before(sqls: string[]) {
    this.guard();
    if (this.failing && sqls.some((s) => isWrite(s) && this.failing!(s))) throw new Error('D1_ERROR: injected write failure (D8533 harness)');
  }
  /** After a statement has landed: the armed interruption kills the isolate. */
  private after(sqls: string[]) {
    if (this.interruptAfter && sqls.some((s) => isWrite(s) && this.interruptAfter!(s))) {
      this.interruptAfter = null;
      this.dead = true;
    }
  }

  d1(inner: any): any {
    const p = this;
    const wrap = (sql: string, stmt: any): any => {
      const api: any = {
        __inner: stmt, __sql: sql,
        bind(...a: unknown[]) { return wrap(sql, stmt.bind(...a)); },
        async run() { p.before([sql]); const r = await stmt.run(); p.after([sql]); return r; },
        async all() { p.before([sql]); const r = await stmt.all(); p.after([sql]); return r; },
        async first(col?: string) { p.before([sql]); const r = await stmt.first(col); p.after([sql]); return r; },
        async raw(...a: unknown[]) { p.before([sql]); const r = await stmt.raw(...a); p.after([sql]); return r; },
      };
      return api;
    };
    return new Proxy(inner, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => wrap(sql, target.prepare(sql));
        if (key === 'batch') {
          return async (stmts: any[]) => {
            const sqls = stmts.map((s) => String(s?.__sql ?? ''));
            p.before(sqls);
            const r = await target.batch(stmts.map((s) => s?.__inner ?? s));
            p.after(sqls);
            return r;
          };
        }
        if (key === 'exec') return async (sql: string) => { p.before([sql]); return target.exec(sql); };
        return Reflect.get(target, key);
      },
    });
  }
}

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { warn, error, info } = console;
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; console.info = info; }
};

/** One delivery of one message, as the platform makes it. */
async function deliverOnce(p: Platform, queue: string, consumer: QueueConsumerSpec['consumer'], env: any, body: unknown, attempts: number, id: string): Promise<Delivery> {
  let state: 'none' | 'ack' | 'retry' = 'none';
  let delaySeconds: number | undefined;
  const message = {
    id, body, attempts, timestamp: new Date(MESSAGE_TIME),
    ack() { if (!p.dead) state = 'ack'; },
    retry(o?: { delaySeconds?: number }) { if (!p.dead) { state = 'retry'; delaySeconds = o?.delaySeconds; } },
  };
  const batch = {
    queue, messages: [message],
    ackAll() { message.ack(); },
    retryAll(o?: { delaySeconds?: number }) { message.retry(o); },
  };
  let error: unknown = null;
  await quietly(async () => {
    try { await consumer(batch, env, { waitUntil() {}, passThroughOnException() {} }); } catch (e) { error = e; }
  });
  if (p.dead) return { queue, attempts, result: 'died' };
  if (error) return { queue, attempts, result: 'threw', error: String((error as Error)?.message ?? error) };
  if (state === 'retry') return { queue, attempts, result: 'retry', delaySeconds };
  return { queue, attempts, result: 'ack' }; // an explicit ack, or a clean return (implicit ack)
}

/**
 * Deliver one message until the platform is done with it: acked, or dead-lettered
 * after `maxRetries` retries (then delivered to the dead-letter consumer the same way).
 */
export async function settle<W extends QueueWorld>(spec: QueueConsumerSpec<W>, w: W, p: Platform, body: unknown, log: Delivery[], queue = spec.queue): Promise<'acked' | 'dead-lettered'> {
  const consumer = queue === spec.dlqQueue ? spec.dlqConsumer : spec.consumer;
  const id = p.nextId();
  for (let attempts = 1; ; attempts += 1) {
    const d = await deliverOnce(p, queue, consumer, w.env, body, attempts, id);
    log.push(d);
    p.revive(); // the next delivery runs in a new isolate
    if (d.result === 'ack') return 'acked';
    if (attempts > spec.maxRetries) {
      if (queue === spec.dlqQueue) throw new Error(`${spec.name}: the dead-letter consumer never acked the message`);
      await settle(spec, w, p, body, log, spec.dlqQueue);
      return 'dead-lettered';
    }
    if (d.delaySeconds && spec.elapse) await spec.elapse(w, d.delaySeconds);
  }
}

async function observe<W extends QueueWorld>(spec: QueueConsumerSpec<W>, w: W, deliveries: Delivery[]): Promise<ScenarioResult> {
  return { deliveries, outcomes: await spec.outcomes(w), status: await spec.status(w), deadLetters: await spec.deadLetters(w) };
}

const trace = (r: ScenarioResult) => JSON.stringify(r.deliveries);

function expectDone<W extends QueueWorld>(spec: QueueConsumerSpec<W>, r: ScenarioResult, what: string) {
  assert.equal(r.outcomes, 1, `${spec.name} — ${what}: the business effect happened ${r.outcomes} times, not once (${trace(r)})`);
  assert.equal(r.status, spec.expect.done, `${spec.name} — ${what}: the visible status (${trace(r)})`);
  assert.equal(r.deadLetters, 0, `${spec.name} — ${what}: no dead letter is left behind (${trace(r)})`);
}

/** The same message twice: one outcome, the done status, and the second delivery acked. */
export async function runDuplicate<W extends QueueWorld>(spec: QueueConsumerSpec<W>): Promise<ScenarioResult> {
  const p = new Platform();
  const w = await spec.setup(p);
  const log: Delivery[] = [];
  assert.equal(await settle(spec, w, p, w.body, log), 'acked', `${spec.name}: the first delivery is acked`);
  assert.equal(await settle(spec, w, p, structuredClone(w.body), log), 'acked', `${spec.name}: the duplicate is acked`);
  const r = await observe(spec, w, log);
  expectDone(spec, r, 'duplicate');
  if (spec.duplicatesRecorded) {
    assert.equal(await spec.duplicatesRecorded(w), 1, `${spec.name} — duplicate: the second delivery is recorded as a duplicate, not run again`);
  }
  return r;
}

/** The consumer dies right after `after`'s write; the redelivery finishes the job exactly once. */
export async function runInterrupted<W extends QueueWorld>(spec: QueueConsumerSpec<W>, point: { label: string; after: SqlMatch }): Promise<ScenarioResult> {
  const p = new Platform();
  const w = await spec.setup(p);
  const log: Delivery[] = [];
  p.arm(point.after);
  const settled = await settle(spec, w, p, w.body, log);
  assert.equal(log[0]?.result, 'died', `${spec.name}: the first delivery never reached "${point.label}" (${JSON.stringify(log)})`);
  assert.equal(settled, 'acked', `${spec.name} — interrupted after ${point.label}: a redelivery finishes it (${JSON.stringify(log)})`);
  const r = await observe(spec, w, log);
  expectDone(spec, r, `interrupted after ${point.label}`);
  return r;
}

/** Every delivery fails: no outcome, the dead-lettered status, and one dead letter. */
export async function runExhausted<W extends QueueWorld>(spec: QueueConsumerSpec<W>): Promise<{ result: ScenarioResult; world: W; platform: Harness }> {
  const p = new Platform();
  const w = await spec.setup(p);
  const log: Delivery[] = [];
  await spec.breakIt(w, p);
  assert.equal(await settle(spec, w, p, w.body, log), 'dead-lettered', `${spec.name}: an always-failing message is dead-lettered`);
  const tries = log.filter((d) => d.queue === spec.queue).length;
  assert.equal(tries, spec.maxRetries + 1, `${spec.name}: delivered once plus max_retries (${spec.maxRetries}) times`);
  const r = await observe(spec, w, log);
  assert.equal(r.outcomes, 0, `${spec.name} — exhausted: no half-done business effect (${trace(r)})`);
  assert.equal(r.status, spec.expect.deadLettered, `${spec.name} — exhausted: the visible status (${trace(r)})`);
  assert.equal(r.deadLetters, 1, `${spec.name} — exhausted: one dead letter, visible to an admin (${trace(r)})`);
  return { result: r, world: w, platform: p };
}

/** The dead-lettered message through the recovery path: one outcome, the done status, the dead letter gone. */
export async function runReplay<W extends QueueWorld>(spec: QueueConsumerSpec<W>): Promise<ScenarioResult> {
  const { world: w, platform } = await runExhausted(spec);
  const p = platform as Platform;
  await spec.heal(w, p);
  p.take();
  await spec.replay(w, p);
  const replayed = p.take();
  assert.equal(replayed.length, 1, `${spec.name}: the recovery path sends the message once`);
  const log: Delivery[] = [];
  assert.equal(await settle(spec, w, p, replayed[0], log), 'acked', `${spec.name}: the replayed message is acked`);
  const r = await observe(spec, w, log);
  expectDone(spec, r, 'replay');
  return r;
}

/** Register the four scenarios (one interrupted test per interruption point) as node:test tests. */
export function queueScenarioTests<W extends QueueWorld>(spec: QueueConsumerSpec<W>): void {
  const points = spec.interruptions?.length ? spec.interruptions : [{ label: 'its first durable write', after: () => true }];
  test(`${spec.name}: a duplicate delivery ends in one outcome (${spec.expect.done})`, async () => { await runDuplicate(spec); });
  for (const point of points) {
    test(`${spec.name}: interrupted after ${point.label}, the retry ends in one outcome (${spec.expect.done})`, async () => { await runInterrupted(spec, point); });
  }
  test(`${spec.name}: exhausted retries end in the dead letter with no outcome (${spec.expect.deadLettered})`, async () => { await runExhausted(spec); });
  test(`${spec.name}: the replayed dead letter ends in one outcome (${spec.expect.done})`, async () => { await runReplay(spec); });
}

/* ------------------------------------------------------------------ *
 * The application job queue (`studioos-job-queue`), as wrangler.toml  *
 * declares it. Pass these into a spec for a job-queue consumer.       *
 * ------------------------------------------------------------------ */

/** A real SQLite handle beside the wrapped binding, for the spec's own reads. */
type SqliteHandle = { prepare(sql: string): { get(...a: unknown[]): any; run(...a: unknown[]): any } };

export const JOB_QUEUE_NAME = 'studioos-job-queue';
export const JOB_QUEUE_DLQ_NAME = 'studioos-job-queue-dlq';

export const jobQueue = {
  queue: JOB_QUEUE_NAME,
  dlqQueue: JOB_QUEUE_DLQ_NAME,
  /** `max_retries = 3` on `studioos-job-queue` in wrangler.toml. */
  maxRetries: 3,
  /** Dead letters the job queue's DLQ consumer mirrored for this world's job type. */
  deadLetters(w: QueueWorld & { db: SqliteHandle }): number {
    const jobType = (w.body as { job_type?: string })?.job_type;
    return Number(w.db.prepare('SELECT COUNT(*) AS n FROM cf_dlq_mirror WHERE job_type = ?').get(jobType).n);
  },
  /** Deliveries `queueConsumer` metered as `duplicate` for this world's job type (system_metrics). */
  duplicatesRecorded(w: QueueWorld & { db: SqliteHandle }): number {
    const jobType = (w.body as { job_type?: string })?.job_type;
    return Number(w.db.prepare(`SELECT COUNT(*) AS n FROM system_metrics WHERE metric_name = 'job'
      AND json_extract(labels, '$.job_type') = ? AND json_extract(labels, '$.status') = 'duplicate'`).get(jobType).n);
  },
  /** A delayed retry's wait: every delivery claim is that much older. */
  elapse(w: QueueWorld & { db: SqliteHandle }, seconds: number): void {
    w.db.prepare("UPDATE job_idempotency SET first_seen_at = datetime(first_seen_at, ?)").run(`-${Math.ceil(seconds)} seconds`);
  },
};

/** The job queue's delivery claim (`job_idempotency`), the consumer's first durable write. */
export const DELIVERY_CLAIM = { label: 'the delivery claim', after: (sql: string) => /INSERT OR IGNORE INTO job_idempotency/i.test(sql) };

export const HARNESS_JWT_SECRET = 'd8533-queue-harness-secret-0123456789abcdef';
export const HARNESS_ADMIN_ID = 9001;

/**
 * The job queue's recovery path: an admin's `POST /api/infra/dlq/:id/retry?source=cf`,
 * through the real router. The world's env needs `JWT_SECRET: HARNESS_JWT_SECRET`
 * and an active admin user `HARNESS_ADMIN_ID` (see `seedHarnessAdmin`).
 */
export async function replayJobQueueDeadLetter(w: QueueWorld & { db: SqliteHandle }): Promise<void> {
  const jobType = (w.body as { job_type?: string })?.job_type;
  const row = w.db.prepare('SELECT id FROM cf_dlq_mirror WHERE job_type = ? ORDER BY id DESC LIMIT 1').get(jobType);
  assert.ok(row, `no dead letter to replay for ${jobType}`);
  const { default: infra } = await import('../src/routes/infra.ts');
  const jwt = await new SignJWT({ user_id: HARNESS_ADMIN_ID, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(Math.floor(MESSAGE_TIME / 1000)).setExpirationTime('100y')
    .sign(new TextEncoder().encode(HARNESS_JWT_SECRET));
  const res = await quietly(() => infra.fetch(
    new Request(`http://x/dlq/${row.id}/retry?source=cf`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } }),
    w.env,
  ));
  assert.equal(res.status, 200, `the DLQ retry route answered ${res.status}: ${await res.clone().text()}`);
}

/** The admin `replayJobQueueDeadLetter` signs in as. */
export function seedHarnessAdmin(db: { exec(sql: string): void }): void {
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES (${HARNESS_ADMIN_ID}, 'admin', 'Queue Harness Admin', 'harness-admin@example.test', 1)`);
}
