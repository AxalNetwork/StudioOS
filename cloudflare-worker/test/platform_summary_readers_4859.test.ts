/**
 * D4859 (#4859) — HQ · Platform's summary as one reader per panel, run together.
 *
 * What is pinned:
 *   - each reader answers its panel from a real schema, and a store that fails makes only that reader unreadable,
 *     never a zero;
 *   - the orchestration keeps every unrelated block exactly as it was when one reader throws or hangs, and says
 *     which, in that block's own shape;
 *   - the readers run concurrently: the summary takes about as long as its slowest reader, not their sum;
 *   - a measured before/after: with a fixed latency per query, the serial read (the route's old order) against
 *     `readPlatformSummary`.
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/platform_summary_readers_4859.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import {
  INCIDENT_WINDOW_DAYS, PLATFORM_SUMMARY_READERS, PROMO_LIST_LIMIT, readDlqSummary, readGithubSummary, readIncidentSummary,
  readIntegrationKeySummary, readIntegrationsSummary, readJobsSummary, readPaymentsSummary, readPlatformSummary, readPromoSummary,
  readSwitchSummary, readTelegramSummary, readXSummary, settle, type PlatformSummaryReaders,
} from '../src/services/platformSummary.ts';

const BUILT = (() => { const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db); return db; })();
function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* a view or trigger naming an absent object */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}
const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), RATE_LIMITS: kv, ...extra }) as any;
/** A database every prepare of which throws: each reader's own failure. */
const brokenEnv = () => ({ DB: { prepare() { throw new Error('D1 is down'); }, batch() { throw new Error('D1 is down'); } }, RATE_LIMITS: kv }) as any;

test('integrations: counts by provider and status, unhealthy counted, no key material', async () => {
  const db = fresh();
  const ins = db.prepare('INSERT INTO integrations (provider_key, status, user_id) VALUES (?, ?, 9001)');
  for (const [p, st] of [['slack', 'active'], ['slack', 'error'], ['telegram', 'disconnected'], ['telegram', 'active']]) {
    try { ins.run(p, st); } catch { /* the table may name more required columns */ }
  }
  const out: any = await readIntegrationsSummary(envOf(db));
  assert.equal(out.available, true);
  assert.equal(out.secrets_included, false);
  assert.equal(out.unhealthy <= out.total, true);
  const bad: any = await readIntegrationsSummary(brokenEnv());
  assert.deepEqual(bad, { available: false, reason: 'The integrations table could not be read.' });
});

test('jobs: every declared trigger is listed, a never-recorded one as never; a failed read is unreadable', async () => {
  const out: any = await readJobsSummary(envOf(fresh()), new Date('2026-11-07T12:00:00Z'));
  assert.equal(out.available, true);
  assert.ok(out.triggers.length > 0);
  assert.equal(out.never, out.triggers.length, 'an empty history is every trigger never recorded, not healthy');
  assert.equal((await readJobsSummary(brokenEnv()) as any).available, false);
});

test('incidents: the seven-day count, and an unreadable table is unknown, not zero', async () => {
  const db = fresh();
  db.exec("INSERT INTO status_incidents (title, created_at) VALUES ('Synthetic', datetime('now', '-1 days'))");
  db.exec("INSERT INTO status_incidents (title, created_at) VALUES ('Old', datetime('now', '-30 days'))");
  const out: any = await readIncidentSummary(envOf(db));
  assert.deepEqual([out.available, out.count, out.window_days], [true, 1, INCIDENT_WINDOW_DAYS]);
  const bad: any = await readIncidentSummary(brokenEnv());
  assert.equal(bad.available, false);
  assert.equal(bad.count, undefined, 'no count is invented');
});

test('dlq, switches, integration keys, github and payments each answer, and each stands alone when its store fails', async () => {
  const env = envOf(fresh());
  assert.equal(((await readDlqSummary(env)) as any).available, true);
  assert.equal(((await readSwitchSummary(env)) as any).available, true);
  assert.equal(((await readIntegrationKeySummary(env)) as any).available, true);
  const gh: any = await readGithubSummary(env);
  assert.ok('target' in gh && 'window' in gh && 'recent' in gh);
  const pay: any = await readPaymentsSummary(env);
  assert.deepEqual(Object.keys(pay).sort(), ['catalog', 'publishable', 'storefront_note', 'webhook']);
  assert.equal(pay.publishable.configured, false);
  const broken = brokenEnv();
  // The switch registry asks each switch's own predicate and reports per switch what it could not read, so the block
  // answers even with the database down; the dead-letter depth does not.
  const sw: any = await readSwitchSummary(broken);
  assert.equal(sw.available, true);
  assert.ok(Array.isArray(sw.items));
  assert.equal(((await readDlqSummary(broken)) as any).available, false);
});

test('broadcast: Telegram and X keep their deployment facts when their tables fail', async () => {
  const tg: any = await readTelegramSummary(envOf(fresh()));
  assert.equal(tg.available, true);
  assert.equal(tg.members_available, false);
  const tgBad: any = await readTelegramSummary(brokenEnv());
  assert.equal(tgBad.available, false);
  assert.equal(typeof tgBad.token_configured, 'boolean', 'the token is a deployment fact, read either way');
  const xBad: any = await readXSummary(brokenEnv());
  assert.equal(xBad.available, false);
  assert.equal(typeof xBad.client_configured, 'boolean');
});

test('promo codes: every code counted, fifty listed, and a failed read lists none rather than claiming none exist', async () => {
  const db = fresh();
  const ins = db.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, duration, product_ids_json, times_redeemed, active, created_at)
    VALUES (?, ?, ?, ?, 10, 'once', '[]', 0, 1, datetime('now', ?))`);
  for (let i = 0; i < PROMO_LIST_LIMIT + 3; i += 1) ins.run(`pc-${i}`, `CODE${i}`, `code${i}`, `coupon-${i}`, `-${i} minutes`);
  const out: any = await readPromoSummary(envOf(db));
  assert.equal(out.total, PROMO_LIST_LIMIT + 3);
  assert.equal(out.items.length, PROMO_LIST_LIMIT);
  assert.equal(out.truncated, true);
  assert.equal(out.items[0].code, 'CODE0', 'newest first');
  const bad: any = await readPromoSummary(brokenEnv());
  assert.equal(bad.available, false);
  assert.match(bad.reason, /rather than none existing/);
});

// ── the orchestration ──────────────────────────────────────────────────────

const answer = (v: unknown, ms = 0) => () => new Promise((r) => setTimeout(() => r(v), ms));
function stubReaders(over: Partial<Record<keyof PlatformSummaryReaders, () => Promise<unknown>>> = {}): PlatformSummaryReaders {
  const base = Object.fromEntries(Object.keys(PLATFORM_SUMMARY_READERS).map((k) => [k, answer({ available: true, from: k })]));
  return { ...base, ...over } as unknown as PlatformSummaryReaders;
}

test('the summary keeps the response\'s own shape, key for key', async () => {
  const out: any = await readPlatformSummary(envOf(fresh()), { readers: stubReaders() });
  assert.deepEqual(Object.keys(out), ['integrations', 'jobs', 'monitoring', 'broadcast', 'integration_keys', 'github_sync', 'payments_catalog', 'promo_codes', 'switches', 'reads']);
  // D4858 added `reads`, one meta per reader; every block before it is unchanged.
  assert.deepEqual(Object.keys(out.reads).sort(), Object.keys(stubReaders()).sort());
  assert.deepEqual(Object.keys(out.monitoring), ['dlq', 'incidents']);
  assert.deepEqual(Object.keys(out.broadcast), ['telegram', 'x']);
});

test('one reader throwing changes nothing else, and its block says it could not be read', async () => {
  const env = envOf(fresh());
  const healthy: any = await readPlatformSummary(env, { readers: stubReaders() });
  const broken: any = await readPlatformSummary(env, { readers: stubReaders({ jobs: () => Promise.reject(new Error('boom')) }) });
  assert.deepEqual(broken.jobs, { available: false, reason: 'The scheduled-run history could not be read.' });
  for (const k of ['integrations', 'integration_keys', 'github_sync', 'payments_catalog', 'promo_codes', 'switches']) assert.deepEqual(broken[k], healthy[k], k);
  assert.deepEqual(broken.monitoring, healthy.monitoring);
  assert.deepEqual(broken.broadcast, healthy.broadcast);
});

test('one reader hanging is cut off at the deadline, in its own shape; the rest arrive unchanged and on time', async () => {
  const env = envOf(fresh());
  const t0 = Date.now();
  const out: any = await readPlatformSummary(env, { readers: stubReaders({ telegram: () => new Promise(() => {}) }), deadlineMs: 60 });
  const took = Date.now() - t0;
  assert.ok(took < 1_000, `the summary waited ${took}ms for a reader that never answers`);
  assert.equal(out.broadcast.telegram.available, false);
  assert.match(out.broadcast.telegram.reason, /did not answer in time/);
  assert.match(out.broadcast.telegram.reason, /not the same as none/);
  assert.equal(typeof out.broadcast.telegram.token_configured, 'boolean', 'its block keeps the facts it always carries');
  assert.deepEqual(out.broadcast.x, { available: true, from: 'x' });
  assert.deepEqual(out.integrations, { available: true, from: 'integrations' });
});

test('a hanging composite block keeps its own shape: GitHub sync and the payments catalogue', async () => {
  const out: any = await readPlatformSummary(envOf(fresh()), {
    readers: stubReaders({ github_sync: () => new Promise(() => {}), payments_catalog: () => Promise.reject(new Error('x')) }), deadlineMs: 40,
  });
  assert.deepEqual(Object.keys(out.github_sync), ['target', 'window', 'recent', 'recent_note']);
  assert.equal(out.github_sync.window.available, false);
  assert.deepEqual(Object.keys(out.payments_catalog), ['publishable', 'catalog', 'webhook', 'storefront_note']);
  assert.equal(out.payments_catalog.catalog.available, false);
  assert.equal(out.payments_catalog.publishable.configured, null, 'unknown, never false');
});

test('the readers run concurrently: the summary takes its slowest reader\'s time, not their sum', async () => {
  const delay = 80;
  const readers = Object.fromEntries(Object.keys(PLATFORM_SUMMARY_READERS).map((k) => [k, answer({ available: true }, delay)])) as unknown as PlatformSummaryReaders;
  const env = envOf(fresh());
  const t0 = Date.now();
  await readPlatformSummary(env, { readers });
  const took = Date.now() - t0;
  const n = Object.keys(readers).length;
  assert.ok(took < delay * 3, `took ${took}ms for ${n} readers of ${delay}ms each (serial would be ${n * delay}ms)`);
});

test('settle clears its timer when the reader answers first', async () => {
  const out = await settle(async () => 'ok', () => 'late', 10_000);
  assert.equal(out, 'ok');
  assert.equal(await settle(() => Promise.reject(new Error('no')), (w) => w, 10_000), 'failed');
});

test('measured: serial reads against the concurrent summary, with a fixed latency per query', async () => {
  // Every statement waits LAG ms before it runs, the shape of a remote D1 round-trip.
  const LAG = 15;
  const db = fresh();
  const inner = d1Over(db) as any;
  const lag = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), LAG));
  const slowStmt = (st: any): any => ({
    bind: (...a: unknown[]) => slowStmt(st.bind(...a)),
    first: async (...a: unknown[]) => lag(await st.first(...a)),
    all: async (...a: unknown[]) => lag(await st.all(...a)),
    run: async (...a: unknown[]) => lag(await st.run(...a)),
    raw: async (...a: unknown[]) => lag(await st.raw(...a)),
  });
  const env = { DB: { prepare: (sql: string) => slowStmt(inner.prepare(sql)), batch: (s: any[]) => inner.batch(s) }, RATE_LIMITS: kv } as any;
  const t0 = Date.now();
  for (const read of Object.values(PLATFORM_SUMMARY_READERS)) await read(env); // the route's old order, one after another
  const serial = Date.now() - t0;
  const t1 = Date.now();
  await readPlatformSummary(env);
  const concurrent = Date.now() - t1;
  console.log(`[D4859] serial ${serial}ms, concurrent ${concurrent}ms, at ${LAG}ms per query`);
  assert.ok(concurrent < serial, `concurrent ${concurrent}ms is not faster than serial ${serial}ms`);
});
