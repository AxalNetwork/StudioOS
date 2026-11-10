/**
 * D5370 (#5370) — Platform health detects meeting-bot start failures and branch health, and `not_detected` holds
 * only reasons that are true.
 *
 * Pinned:
 *   - the meeting bot: a latest failed start is medium; a streak or a failed readiness preflight is high; a start
 *     that works clears it; a failed check and a report that never arrived are different incidents (D4857);
 *     queued runs and old runs do not count; one incident per key;
 *   - missing is unknown, never healthy: no table, no D5153 columns, or no block at all;
 *   - the bot off, or a branch, is "not detected" with that reason, and never unknown;
 *   - branches: the last stored check (D452) said not ok is medium; unchecked for a day, or never, is a low note
 *     that does not lower the state; a fresh ok check is nothing; the summary never fans out;
 *   - the stale "not deployed" sentence is gone from the code and the docs;
 *   - the summary end to end, and every new runbook anchor and console link resolves.
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/platform_health_5370.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import {
  BRANCH_CHECK_STALE_HOURS, buildHealth, NOT_DETECTED, readBranchHealth, REMEDIATION, type HealthInput,
} from '../src/services/platformHealth.ts';
import { BOT_START_FAILURE_STREAK, BOT_START_READ, readMeetingBotHealth, startOutcome } from '../src/services/meetingBotHealth.ts';
import { readPlatformSummary } from '../src/services/platformSummary.ts';

const NOW = new Date('2026-11-10T12:00:00Z');
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const BUILT = (() => { const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db); return db; })();
function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* a view or trigger naming an absent object */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}
const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } }; };
const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), RATE_LIMITS: kv(), MEETING_BOT: 'canary', ...extra }) as any;

let seq = 0;
/** One run, `minutesAgo` before NOW. */
function bot(db: DatabaseSync, minutesAgo: number, f: { status: string; failure_code?: string | null; code?: string | null; stage?: string | null; callback?: boolean }) {
  seq += 1;
  const at = NOW.getTime() - minutesAgo * 60_000;
  db.prepare(`INSERT INTO meeting_bots (uid, user_id, project_id, session_id, platform, meeting_url_enc, status, failure_code, scheduled_at,
    limit_minutes, cost_per_minute_microusd, rate_per_minute_microusd, created_at, runtime_stage, runtime_error_code, runtime_callback_seen_at)
    VALUES (?, 1, 1, ?, 'google_meet', '', ?, ?, ?, 30, 1, 1, ?, ?, ?, ?)`)
    .run(`bot_${String(seq).padStart(4, '0')}`, seq, f.status, f.failure_code ?? null, at, at, f.stage ?? null, f.code ?? null, f.callback ? at + 1000 : null);
}
const checkFail = (code = 'runtime_refused', stage = 'runtime_command_accepted') => ({ status: 'failed', failure_code: 'runtime_unavailable', code, stage });
const unreported = { status: 'failed', failure_code: 'runtime_unavailable', stage: 'dispatch_accepted' };
const started = { status: 'done', stage: 'runtime_command_accepted', callback: true };

/** Healthy everywhere else; each test sets the two D5370 signals. */
const base = (over: Partial<HealthInput>): HealthInput => ({
  jobs: { available: true, triggers: [] },
  cron: { available: true, streaks: [] },
  dlq: { available: true, total: 0 },
  webhook: { available: true, consecutive_failures: 0, streak_at_least: false, streak_started_at: null, last_delivery_at: '2026-11-10 11:00:00', last_success_at: '2026-11-10 11:00:00', last_failure_at: null },
  telemetry: { status: 'healthy', binding_present: true, read_configured: true, answered: true, last_event_at: '2026-11-10 11:59:00', events_in_window: 9, window_hours: 24, last_successful_read_at: NOW.toISOString(), checked_at: NOW.toISOString(), coverage: 'c', reason: null },
  published: { available: true, count: 0, window_days: 30 },
  meeting_bot: { available: true, applies: true, outcomes_read: 0, window_hours: 168, latest: null, consecutive_failures: 0, streak_at_least: false, streak_started_at: null },
  branches: { available: true, applies: true, branches: [] },
  stripe_configured: true,
  now: NOW,
  ...over,
});
const healthOf = async (db: DatabaseSync, extra: Record<string, unknown> = {}) => buildHealth(base({ meeting_bot: await readMeetingBotHealth(envOf(db, extra), NOW) }));
const pairs = (h: ReturnType<typeof buildHealth>) => h.detected.map((i) => [i.key, i.severity]);

// ── the meeting bot ───────────────────────────────────────────────────────

test('meeting bot: the latest failed start is medium, a streak is high, and a start that works clears it', async () => {
  const db = fresh();
  bot(db, 300, started);
  bot(db, 200, checkFail());
  let h = await healthOf(db);
  assert.deepEqual([h.state, pairs(h)], ['degraded', [['meeting_bot:start_failed', 'medium']]]);
  assert.match(h.detected[0].detail, /runtime_refused at runtime_command_accepted/);
  assert.equal(h.detected[0].since, new Date(NOW.getTime() - 200 * 60_000).toISOString());
  assert.equal(h.detected[0].remediation.surface?.href, '/admin/platform/meeting-bots');

  for (let k = 1; k < BOT_START_FAILURE_STREAK; k += 1) bot(db, 200 - k * 10, checkFail());
  h = await healthOf(db);
  assert.equal(BOT_START_FAILURE_STREAK, 3);
  assert.deepEqual(pairs(h), [['meeting_bot:start_failed', 'high']]);
  assert.match(h.detected[0].title, /3 times in a row/);
  assert.equal(h.detected[0].since, new Date(NOW.getTime() - 200 * 60_000).toISOString(), 'since the first failure of the streak');

  bot(db, 10, started);
  h = await healthOf(db);
  assert.deepEqual([h.state, h.detected], ['healthy', []], 'recovery clears it');
});

test('meeting bot: a failed readiness preflight is high on its first failure', async () => {
  for (const code of ['runtime_no_answer', 'runtime_process_exited', 'runtime_health_failed']) {
    const db = fresh();
    bot(db, 60, checkFail(code, 'runtime_health_ready'));
    const h = await healthOf(db);
    assert.deepEqual(pairs(h), [['meeting_bot:start_failed', 'high']], code);
    assert.match(h.detected[0].title, /readiness preflight failed/);
  }
  const db = fresh();
  bot(db, 60, checkFail('image_unavailable', 'image_resolved'));
  assert.deepEqual(pairs(await healthOf(db)), [['meeting_bot:start_failed', 'medium']], 'not every code is the preflight');
});

test('meeting bot: a report that never arrived is its own incident, not a failed check (D4857)', async () => {
  const db = fresh();
  bot(db, 60, unreported);
  let h = await healthOf(db);
  assert.deepEqual(pairs(h), [['meeting_bot:unreported', 'medium']]);
  assert.match(h.detected[0].detail, /missing report, not a failed check/);
  // A heartbeat timeout with no callback is the same; one after a callback is a provider-side failure, not a start failure.
  assert.equal(startOutcome({ status: 'failed', failure_code: 'heartbeat_timeout', runtime_stage: null, runtime_error_code: null, runtime_callback_seen_at: null, created_at: 0 }), 'unreported');
  assert.equal(startOutcome({ status: 'failed', failure_code: 'runtime_failed', runtime_stage: 'provider_starting', runtime_error_code: null, runtime_callback_seen_at: 5, created_at: 0 }), 'started');
  // Mixed kinds count toward one streak; the newest kind names the incident.
  bot(db, 50, checkFail());
  bot(db, 40, unreported);
  h = await healthOf(db);
  assert.deepEqual(pairs(h), [['meeting_bot:unreported', 'high']]);
  assert.match(h.detected[0].title, /3 times in a row/);
});

test('meeting bot: queued and early-stopped runs have no outcome; old runs do not count; a full window of failures says "at least"', async () => {
  const db = fresh();
  bot(db, 60, checkFail());
  bot(db, 30, { status: 'queued' });
  bot(db, 20, { status: 'stopped' });
  let m: any = await readMeetingBotHealth(envOf(db), NOW);
  assert.deepEqual([m.outcomes_read, m.latest.outcome, m.consecutive_failures], [1, 'check_failed', 1]);

  const old = fresh();
  bot(old, 8 * 24 * 60, checkFail());
  m = await readMeetingBotHealth(envOf(old), NOW);
  assert.deepEqual([m.outcomes_read, m.latest], [0, null]);
  assert.deepEqual((await healthOf(old)).detected, [], 'a failure older than the window says nothing about now');

  const many = fresh();
  for (let k = 0; k < BOT_START_READ + 2; k += 1) bot(many, 100 - k, checkFail());
  m = await readMeetingBotHealth(envOf(many), NOW);
  assert.deepEqual([m.outcomes_read, m.consecutive_failures, m.streak_at_least], [BOT_START_READ, BOT_START_READ, true]);
  assert.match((await healthOf(many)).detected[0].title, new RegExp(`at least ${BOT_START_READ} times`));
});

test('meeting bot: missing data is unknown, never healthy', async () => {
  const noCols = fresh();
  noCols.exec('ALTER TABLE meeting_bots DROP COLUMN runtime_callback_seen_at');
  let m: any = await readMeetingBotHealth(envOf(noCols), NOW);
  assert.equal(m.available, false);
  assert.match(m.reason, /202611090953/);
  let h = buildHealth(base({ meeting_bot: m }));
  assert.equal(h.state, 'unknown');
  assert.deepEqual(h.unknown.map((u) => u.signal), ['Meeting bot starts']);

  const noTable = fresh();
  noTable.exec('DROP TABLE meeting_bots');
  m = await readMeetingBotHealth(envOf(noTable), NOW);
  assert.deepEqual([m.available, buildHealth(base({ meeting_bot: m })).state], [false, 'unknown']);

  h = buildHealth(base({ meeting_bot: undefined }));
  assert.equal(h.state, 'unknown', 'no block at all is unknown');
});

test('meeting bot: switched off, or on a branch, is not detected with its reason, and never unknown', async () => {
  const db = fresh();
  bot(db, 60, checkFail());
  for (const extra of [{ MEETING_BOT: 'off' }, { MEETING_BOT: undefined }, { BRANCH_CODE: 'acme' }]) {
    const m: any = await readMeetingBotHealth(envOf(db, extra), NOW);
    assert.deepEqual([m.available, m.applies], [true, false], JSON.stringify(extra));
    const h = buildHealth(base({ meeting_bot: m }));
    assert.deepEqual([h.state, h.detected, h.unknown], ['healthy', [], []]);
    assert.ok(h.not_detected.some((n) => n.signal === 'Meeting bot starts' && n.reason === m.reason));
  }
  const on = buildHealth(base({}));
  assert.ok(!on.not_detected.some((n) => n.signal === 'Meeting bot starts'), 'a bot that applies is not listed as not detected');
});

// ── branches ──────────────────────────────────────────────────────────────

function branch(db: DatabaseSync, code: string, status: string, at: string | null, ok: number | null) {
  db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status, last_health_at, last_health_ok, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-01 00:00:00')`).run(`lic_${code}`, code, `${code}.example`, `w-${code}`, `d-${code}`, status, at, ok);
}

test('branches: a not-ok last check is medium; unchecked is a low note; a fresh ok is nothing; non-live states are skipped', async () => {
  const db = fresh();
  branch(db, 'alpha', 'linked', '2026-11-10 11:00:00', 1);
  branch(db, 'beta', 'linked', '2026-11-10 11:00:00', 0);
  branch(db, 'gamma', 'hostname_active', '2026-11-08 11:00:00', 1);
  branch(db, 'delta', 'worker_live', null, null);
  branch(db, 'eps', 'requested', null, null);
  const b: any = await readBranchHealth(envOf(db));
  assert.deepEqual(b.branches.map((x: any) => x.code), ['alpha', 'beta', 'delta', 'gamma'], 'only live states, in code order');
  const h = buildHealth(base({ branches: b }));
  assert.deepEqual(pairs(h), [['branch:beta', 'medium'], ['branch:delta', 'low'], ['branch:gamma', 'low']]);
  assert.equal(h.state, 'degraded');
  assert.match(h.detected.find((i) => i.key === 'branch:gamma')!.title, new RegExp(`${BRANCH_CHECK_STALE_HOURS} hours`));
  assert.match(h.detected.find((i) => i.key === 'branch:delta')!.title, /never answered/);
  // Low notes alone do not lower the state.
  const onlyStale = buildHealth(base({ branches: { available: true, applies: true, branches: b.branches.filter((x: any) => x.code !== 'beta') } }));
  assert.equal(onlyStale.state, 'healthy');
  // Recovery: a fresh ok check clears it.
  const fixed = buildHealth(base({ branches: { available: true, applies: true, branches: [{ ...b.branches[1], last_health_ok: 1, last_health_at: '2026-11-10 11:59:00' }] } }));
  assert.deepEqual(fixed.detected, []);
});

test('branches: an unreadable registry is unknown; on a branch it is not detected', async () => {
  const db = fresh();
  db.exec('DROP TABLE licence_deployments');
  const b: any = await readBranchHealth(envOf(db));
  assert.equal(b.available, false);
  const h = buildHealth(base({ branches: b }));
  assert.deepEqual([h.state, h.unknown.map((u) => u.signal)], ['unknown', ['Branch health']]);
  const onBranch: any = await readBranchHealth(envOf(fresh(), { BRANCH_CODE: 'acme' }));
  assert.deepEqual([onBranch.available, onBranch.applies], [true, false]);
  assert.ok(buildHealth(base({ branches: onBranch })).not_detected.some((n) => n.signal === 'Branch health'));
});

// ── what is not detected, docs and links ──────────────────────────────────

test('not_detected holds only true reasons: no "not deployed" sentence anywhere', () => {
  assert.ok(!JSON.stringify(NOT_DETECTED).includes('not deployed'));
  assert.ok(!NOT_DETECTED.some((n) => /Branch/.test(n.signal)), 'branch health is read now');
  assert.doesNotMatch(read('cloudflare-worker/src/services/platformHealth.ts'), /meeting bot[^.]*not deployed/i);
  assert.doesNotMatch(read('documentation/operations/PLATFORM_OBSERVABILITY.md'), /It is not deployed yet \(D886\)/);
  assert.doesNotMatch(read('CLAUDE.md'), /`meeting-bot\/`[^\n]*not deployed yet/);
  assert.doesNotMatch(read('meeting-bot/README.md'), /^\*\*Not deployed yet\.\*\*/m);
});

test('the new incidents link to a runbook section that exists and to a mounted console', () => {
  const doc = read('documentation/operations/PLATFORM_OBSERVABILITY.md');
  const anchors = new Set([...doc.matchAll(/^#{2,4} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')));
  const app = read('frontend/src/App.jsx');
  for (const kind of ['meeting_bot', 'branch'] as const) {
    const r = REMEDIATION[kind];
    assert.ok(anchors.has(r.runbook.doc.split('#')[1]), kind);
    assert.ok(app.includes(`path="${r.surface.href}"`), kind);
  }
});

// ── the summary ───────────────────────────────────────────────────────────

test('the summary end to end: a failed bot start and an unhealthy branch reach health.detected, with their reads', async () => {
  const db = fresh();
  bot(db, Math.round((Date.now() - NOW.getTime()) / -60_000) + 5, checkFail('runtime_health_failed', 'runtime_health_ready'));
  branch(db, 'beta', 'linked', new Date().toISOString().replace('T', ' ').slice(0, 19), 0);
  let fanned = false;
  const out: any = await readPlatformSummary(envOf(db, { BRANCHES: new Proxy({}, { get() { fanned = true; return undefined; } }) }), {});
  const keys = out.health.detected.map((i: any) => i.key);
  assert.ok(keys.includes('meeting_bot:start_failed'), keys.join());
  assert.ok(keys.includes('branch:beta'), keys.join());
  assert.equal(out.reads.meeting_bot_health.status, 'ready');
  assert.equal(out.reads.branch_health.status, 'ready');
  assert.equal(fanned, false, 'the summary never asks a branch');
  assert.ok(!JSON.stringify(out.health).includes('meeting_url'));
});

test('the summary: a reader that throws becomes unknown, not healthy', async () => {
  const db = fresh();
  const { PLATFORM_SUMMARY_READERS } = await import('../src/services/platformSummary.ts');
  const out: any = await readPlatformSummary(envOf(db), { readers: { ...PLATFORM_SUMMARY_READERS, meeting_bot_health: async () => { throw new Error('boom'); } } });
  assert.ok(out.health.unknown.some((u: any) => u.signal === 'Meeting bot starts'));
  assert.notEqual(out.health.state, 'healthy');
});
