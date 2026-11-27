/**
 * D4854 (#4854) — HQ · Platform's health: telemetry as a signal, detected incidents, published incidents apart.
 *
 * What is pinned (the issue's acceptance, one test or more each):
 *   - missing telemetry (not configured, or not answering) is an incident and degrades the state; it is never
 *     healthy and never zero; a good read is remembered so an outage says when telemetry last worked;
 *   - a run of refused Stripe webhook deliveries is an incident (high, then critical), and clears on the next 2xx;
 *   - repeated cron failures raise severity; a recovered trigger clears;
 *   - one incident per key however the signals overlap (deduplication), and the same signals give the same list;
 *   - freshness: `since` from the signal's own rows, `observed_at` the read; stale telemetry is its own incident;
 *   - detected and published incidents are separate, and published never moves the state;
 *   - every incident links to a runbook section that exists and, where one exists, a mounted console.
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/platform_health_4854.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import {
  buildHealth, CRON_FAILURE_STREAK, detectIncidents, DLQ_HIGH, healthStateOf, readCronStreaks, readTelemetryHealth,
  readWebhookHealth, REMEDIATION, TELEMETRY_LAST_OK_KEY, WEBHOOK_FAILURE_CRITICAL, WEBHOOK_FAILURE_STREAK, WEBHOOK_SILENCE_HOURS, type HealthInput,
} from '../src/services/platformHealth.ts';
import { readPlatformSummary } from '../src/services/platformSummary.ts';
import { STRIPE_WEBHOOK_PATH } from '../src/services/stripeWebhookDeliveries.ts';

const NOW = new Date('2026-11-07T12:00:00Z');
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const BUILT = (() => { const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db); return db; })();
function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* a view or trigger naming an absent object */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}
function memKv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}
const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), RATE_LIMITS: memKv(), ...extra }) as any;

const delivery = (db: DatabaseSync, code: number | null, at: string) => db.prepare(
  `INSERT INTO activity_logs (action, endpoint, status_code, created_at) VALUES ('request', ?, ?, ?)`,
).run(STRIPE_WEBHOOK_PATH, code, at);
const run = (db: DatabaseSync, expr: string, status: string, at: string) => db.prepare(
  `INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status) VALUES (?, ?, ?, ?)`,
).run(expr, at, at, status);

/** A fully healthy input; each test changes one signal. */
const healthy = (over: Partial<HealthInput> = {}): HealthInput => ({
  jobs: { available: true, triggers: [{ name: 'cleanup', trigger_name: '0 3 * * *', state: 'ok', expected_at: null, last_started_at: '2026-11-07 03:00:00', error: null }] },
  cron: { available: true, streaks: [{ trigger_name: '0 3 * * *', consecutive_failures: 0, first_failed_at: null, last_ok_at: '2026-11-07 03:00:00' }] },
  dlq: { available: true, total: 0 },
  webhook: { available: true, consecutive_failures: 0, streak_at_least: false, streak_started_at: null, last_delivery_at: '2026-11-07 11:00:00', last_success_at: '2026-11-07 11:00:00', last_failure_at: null },
  telemetry: { status: 'healthy', binding_present: true, read_configured: true, answered: true, last_event_at: '2026-11-07 11:59:00', events_in_window: 900, window_hours: 24, last_successful_read_at: NOW.toISOString(), checked_at: NOW.toISOString(), coverage: 'c', reason: null },
  published: { available: true, count: 0, window_days: 30 },
  meeting_bot: { available: true, applies: true, outcomes_read: 1, window_hours: 168, latest: { outcome: 'started', code: null, stage: 'runtime_command_accepted', failure_code: null, at: '2026-11-07T10:00:00.000Z' }, consecutive_failures: 0, streak_at_least: false, streak_started_at: null },
  branches: { available: true, applies: true, branches: [] },
  stripe_configured: true,
  now: NOW,
  ...over,
});

// ── telemetry ─────────────────────────────────────────────────────────────

test('telemetry not configured is an incident, degrades the state, and is never zero traffic', async () => {
  const t = await readTelemetryHealth(envOf(fresh(), { ANALYTICS: {} }), NOW);
  assert.equal(t.status, 'not_configured');
  assert.equal(t.events_in_window, null, 'unknown, not zero');
  assert.equal(t.binding_present, true);
  const h = buildHealth(healthy({ telemetry: t }));
  assert.equal(h.state, 'degraded');
  assert.deepEqual(h.detected.map((i) => [i.key, i.severity]), [['telemetry:unavailable', 'high']]);
  // No telemetry block at all is not healthy either.
  assert.equal(buildHealth(healthy({ telemetry: null })).state, 'degraded');
});

test('telemetry: an answer is healthy or stale by its last event; a failed read remembers the last good one', async () => {
  const db = fresh();
  const env = envOf(db, { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_AE_API_TOKEN: 'tok', ANALYTICS: {} });
  const realFetch = globalThis.fetch;
  let answer: () => Response = () => new Response(JSON.stringify({ data: [{ last_at: '2026-11-07 11:58:00', n: '42' }] }), { status: 200 });
  const bodies: string[] = [];
  globalThis.fetch = (async (_u: string, init: any) => { bodies.push(String(init?.body)); return answer(); }) as any;
  try {
    const ok = await readTelemetryHealth(env, NOW);
    assert.deepEqual([ok.status, ok.last_event_at, ok.events_in_window, ok.reason], ['healthy', '2026-11-07 11:58:00', 42, null]);
    assert.match(bodies[0], /blob1 LIKE '\/%'/, 'only HTTP rows are counted');
    assert.equal(env.RATE_LIMITS.m.get(TELEMETRY_LAST_OK_KEY), NOW.toISOString(), 'a good read is remembered');

    answer = () => new Response(JSON.stringify({ data: [{ last_at: '2026-11-07 10:30:00', n: 5 }] }), { status: 200 });
    const stale = await readTelemetryHealth(env, NOW);
    assert.equal(stale.status, 'stale');
    const hs = buildHealth(healthy({ telemetry: stale }));
    assert.deepEqual(hs.detected.map((i) => [i.key, i.severity, i.since]), [['telemetry:stale', 'medium', '2026-11-07 10:30:00']]);

    answer = () => new Response(JSON.stringify({ data: [{ last_at: '1970-01-01 00:00:00', n: 0 }] }), { status: 200 });
    const empty = await readTelemetryHealth(env, NOW);
    assert.deepEqual([empty.status, empty.last_event_at, empty.events_in_window], ['stale', null, 0], 'no rows is stale, and the epoch is not an event');

    answer = () => new Response('nope', { status: 500 });
    const later = new Date(NOW.getTime() + 600_000);
    const down = await readTelemetryHealth(env, later);
    assert.deepEqual([down.status, down.answered, down.last_successful_read_at], ['unavailable', false, NOW.toISOString()]);
    const hd = buildHealth(healthy({ telemetry: down, now: later }));
    assert.equal(hd.state, 'degraded');
    assert.equal(hd.detected[0].since, NOW.toISOString(), 'the outage runs from the last good read');
    assert.match(hd.detected[0].detail, /Last successful read 2026-11-07T12:00/);

    answer = () => new Response(JSON.stringify({ errors: [] }), { status: 200 });
    assert.equal((await readTelemetryHealth(env, later)).status, 'unavailable', 'a 200 with no data is a failure, not an empty store');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── Stripe webhook ────────────────────────────────────────────────────────

test('a run of refused webhook deliveries is an incident, critical when long, and clears on the next 2xx', async () => {
  const db = fresh();
  const env = envOf(db);
  delivery(db, 200, '2026-11-07 08:00:00');
  delivery(db, 400, '2026-11-07 09:00:00');
  delivery(db, 400, '2026-11-07 09:10:00');
  let w: any = await readWebhookHealth(env);
  assert.equal(w.consecutive_failures, 2);
  assert.deepEqual(buildHealth(healthy({ webhook: w })).detected, [], 'below the streak is not yet an incident');

  delivery(db, 500, '2026-11-07 09:20:00');
  w = await readWebhookHealth(env);
  assert.deepEqual([w.consecutive_failures, w.streak_started_at, w.last_success_at, w.last_failure_at], [3, '2026-11-07 09:00:00', '2026-11-07 08:00:00', '2026-11-07 09:20:00']);
  let h = buildHealth(healthy({ webhook: w }));
  assert.equal(h.state, 'degraded');
  assert.deepEqual(h.detected.map((i) => [i.key, i.severity, i.since]), [['webhook:failures', 'high', '2026-11-07 09:00:00']]);
  assert.equal(h.detected[0].remediation.surface?.href, '/admin/platform/payments/stripe');

  for (let k = 0; k < WEBHOOK_FAILURE_CRITICAL - WEBHOOK_FAILURE_STREAK; k += 1) delivery(db, 400, `2026-11-07 10:${String(k).padStart(2, '0')}:00`);
  h = buildHealth(healthy({ webhook: await readWebhookHealth(env) }));
  assert.deepEqual([h.state, h.detected[0].severity], ['critical', 'critical']);

  delivery(db, null, '2026-11-07 11:00:00');
  assert.equal((await readWebhookHealth(env) as any).consecutive_failures, 0, 'a delivery with no recorded status is not a refusal');
  delivery(db, 200, '2026-11-07 11:30:00');
  h = buildHealth(healthy({ webhook: await readWebhookHealth(env) }));
  assert.deepEqual([h.state, h.detected], ['healthy', []], 'recovery clears it');
});

test('webhook silence is a low note only while Stripe is configured, and does not degrade the state', () => {
  const quiet = { available: true as const, consecutive_failures: 0, streak_at_least: false, streak_started_at: null, last_delivery_at: '2026-11-01 00:00:00', last_success_at: '2026-11-01 00:00:00', last_failure_at: null };
  const h = buildHealth(healthy({ webhook: quiet }));
  assert.deepEqual(h.detected.map((i) => [i.key, i.severity]), [['webhook:silence', 'low']]);
  assert.equal(h.state, 'healthy');
  assert.deepEqual(buildHealth(healthy({ webhook: quiet, stripe_configured: false })).detected, []);
  const never = buildHealth(healthy({ webhook: { ...quiet, last_delivery_at: null } }));
  assert.match(never.detected[0].title, /ever been logged/);
  // #4860 Q4 = B: the threshold is 24 h, as the overview's. Thirty hours silent is noted; twenty is not.
  assert.equal(WEBHOOK_SILENCE_HOURS, 24);
  const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  assert.deepEqual(buildHealth(healthy({ webhook: { ...quiet, last_delivery_at: at(30) } })).detected.map((i) => i.key), ['webhook:silence']);
  assert.deepEqual(buildHealth(healthy({ webhook: { ...quiet, last_delivery_at: at(20) } })).detected, []);
});

// ── cron ──────────────────────────────────────────────────────────────────

test('cron: a failure is medium, a repeated one high, a missed run high, and a recovered trigger clears', async () => {
  const db = fresh();
  const env = envOf(db);
  for (const [st, at] of [['ok', '2026-11-04 03:00:00'], ['error', '2026-11-05 03:00:00'], ['failed', '2026-11-06 03:00:00'], ['partial', '2026-11-07 03:00:00']] as const) run(db, '0 3 * * *', st, at);
  const c: any = await readCronStreaks(env, NOW);
  const s = c.streaks.find((x: any) => x.trigger_name === '0 3 * * *');
  assert.deepEqual([s.consecutive_failures, s.first_failed_at, s.last_ok_at], [3, '2026-11-05 03:00:00', '2026-11-04 03:00:00']);
  const jobs = { available: true, triggers: [{ name: 'cleanup', trigger_name: '0 3 * * *', state: 'failed', expected_at: null, last_started_at: '2026-11-07 03:00:00', error: 'boom' }] };
  let h = buildHealth(healthy({ jobs, cron: c }));
  assert.equal(CRON_FAILURE_STREAK, 3);
  assert.deepEqual(h.detected.map((i) => [i.key, i.severity, i.since]), [['cron:0 3 * * *', 'high', '2026-11-05 03:00:00']]);
  assert.match(h.detected[0].title, /3 runs in a row/);
  // One failure is medium.
  h = buildHealth(healthy({ jobs, cron: { available: true, streaks: [{ ...s, consecutive_failures: 1 }] } }));
  assert.equal(h.detected[0].severity, 'medium');
  // A missed run.
  h = buildHealth(healthy({ jobs: { available: true, triggers: [{ ...jobs.triggers[0], state: 'stale', expected_at: '2026-11-07 03:00:00' }] } }));
  assert.deepEqual(h.detected.map((i) => [i.severity, i.since]), [['high', '2026-11-07 03:00:00']]);
  // Recovered.
  run(db, '0 3 * * *', 'ok', '2026-11-07 03:30:00');
  const after: any = await readCronStreaks(env, NOW);
  assert.equal(after.streaks.find((x: any) => x.trigger_name === '0 3 * * *').consecutive_failures, 0);
  assert.deepEqual(buildHealth(healthy({ jobs: { available: true, triggers: [{ ...jobs.triggers[0], state: 'ok' }] }, cron: after })).detected, []);
});

// ── dead letters, unknowns, dedup, published ─────────────────────────────

test('dead letters: none is nothing, some is medium, many is high; an unreadable backlog is unknown', () => {
  assert.deepEqual(buildHealth(healthy({ dlq: { available: true, total: 0 } })).detected, []);
  assert.equal(buildHealth(healthy({ dlq: { available: true, total: 4 } })).detected[0].severity, 'medium');
  assert.equal(buildHealth(healthy({ dlq: { available: true, total: DLQ_HIGH } })).detected[0].severity, 'high');
  const h = buildHealth(healthy({ dlq: { available: false, reason: 'DLQ down.' } }));
  assert.deepEqual([h.state, h.unknown], ['unknown', [{ signal: 'Dead letters', reason: 'DLQ down.' }]], 'unknown, never healthy');
});

test('an unreadable signal makes the state unknown, but never hides a detected incident', () => {
  const h = buildHealth(healthy({ jobs: { available: false, reason: 'No history.' }, dlq: { available: true, total: 5 } }));
  assert.equal(h.state, 'degraded', 'degraded outranks unknown');
  assert.deepEqual(h.unknown.map((u) => u.signal), ['Scheduled jobs']);
  assert.equal(buildHealth(healthy({ webhook: { available: false, reason: 'log down' } })).state, 'unknown');
  assert.equal(healthStateOf([], []), 'healthy');
});

test('deduplication: one incident per key, the more severe kept; the same signals give the same list', () => {
  const input = healthy({
    jobs: { available: true, triggers: [
      // The more severe first: a later, milder entry under the same key must not replace it.
      { name: 'cleanup', trigger_name: '0 3 * * *', state: 'stale', expected_at: '2026-11-07 03:00:00', last_started_at: null, error: null },
      { name: 'cleanup', trigger_name: '0 3 * * *', state: 'failed', expected_at: null, last_started_at: '2026-11-07 03:00:00', error: null },
    ] },
    dlq: { available: true, total: 3 },
  });
  const a = detectIncidents(input);
  assert.deepEqual(a.incidents.map((i) => [i.key, i.severity, i.title]), [['cron:0 3 * * *', 'high', 'cleanup did not run when expected'], ['dlq:backlog', 'medium', '3 dead letters are waiting']]);
  assert.deepEqual(detectIncidents(input), a, 'derived, so a reload is the same incident, not a second one');
  const keys = a.incidents.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('published incidents are kept apart, labelled manual, and never move the state', () => {
  const h = buildHealth(healthy({ published: { available: true, count: 4, window_days: 30 } }));
  assert.deepEqual([h.state, h.detected], ['healthy', []]);
  assert.deepEqual([h.published.available, (h.published as any).count, h.published.manual], [true, 4, true]);
  const gone = buildHealth(healthy({ published: { available: false, reason: 'table gone' } }));
  assert.deepEqual([gone.published.available, (gone.published as any).reason, gone.state], [false, 'table gone', 'healthy']);
  assert.ok(h.not_detected.some((n) => /diagnostics/.test(n.signal)), 'what is not detected here is said');
});

test('every incident links to a runbook section that exists, and every console link is a mounted route', () => {
  const doc = read('documentation/operations/PLATFORM_OBSERVABILITY.md');
  const anchors = new Set([...doc.matchAll(/^#{2,4} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')));
  const app = read('frontend/src/App.jsx');
  for (const [kind, r] of Object.entries(REMEDIATION)) {
    const [path, anchor] = r.runbook.doc.split('#');
    assert.equal(path, 'documentation/operations/PLATFORM_OBSERVABILITY.md', kind);
    assert.ok(anchors.has(anchor), `${kind}: no heading for #${anchor}`);
    if (r.surface) assert.ok(app.includes(`path="${r.surface.href}"`), `${kind}: ${r.surface.href} is not a mounted route`);
  }
});

// ── the summary ───────────────────────────────────────────────────────────

test('the summary carries health; with no telemetry read here it is degraded, not healthy', async () => {
  const db = fresh();
  const out: any = await readPlatformSummary(envOf(db), {});
  assert.ok(['degraded', 'critical'].includes(out.health.state), out.health.state);
  assert.ok(out.health.detected.some((i: any) => i.key === 'telemetry:unavailable'));
  assert.equal(out.reads.telemetry.status, 'unavailable');
  assert.ok(!JSON.stringify(out.health).includes('tok'), 'no credential reaches the response');
  assert.equal(out.health.published.manual, true);
  assert.equal(out.monitoring.incidents.available, true, 'the published count still rides where it did');
});
