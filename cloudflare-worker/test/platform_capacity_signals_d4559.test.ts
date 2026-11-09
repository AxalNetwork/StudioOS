/**
 * D4559 (#4559) part 3 — the signals other issues record, in the capacity read,
 * the daily snapshot and the alert episodes. The rules held here:
 *
 *   1. Each signal carries its source, window, unit, scope, sampling and the
 *      time its source last produced the record used.
 *   2. #4592: the eligible count and age are trusted only from a sweep that
 *      scanned; a sweep that did not scan is `not_running`, never a zero. The
 *      admission counts are the sweep's own (a real zero is 0).
 *   3. #4593: repairs owed and the age of the oldest still owed; a sweep that
 *      settled everything it found owes nothing.
 *   4. #4558: the age of the last passing restore drill; a failed or absent
 *      drill is `not_verified` and critical, never an age.
 *   5. A source that throws, hangs, never recorded or went stale is
 *      `unavailable` with `value: null`, never 0, and keeps the read from `ok`.
 *   6. Alerts: `not_running` neither opens nor clears; `not_verified` opens;
 *      a measured recovery clears. The snapshot stores the new keys only.
 *   7. The sweep itself labels whether it scanned (real schema, real sweep).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/platform_capacity_signals_d4559.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  readAgentSweepSignals, readRestoreSignal, sqlUtc, SWEEP_SCAN_CAP, REPAIR_CAP,
  ELIGIBLE_AGE_THRESHOLDS, RESTORE_AGE_THRESHOLDS, SIGNALS_NOT_READ_HERE,
} from '../src/services/platformCapacitySignals.ts';
import { readPlatformCapacity, type Metric } from '../src/services/platformCapacity.ts';
import { evaluateAlerts, snapshotRows, sweepPlatformCapacity, SNAPSHOT_KEY } from '../src/services/platformCapacityHistory.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NOW = new Date('2026-11-09T12:00:00Z');
const TS = '2026-11-09 11:56:00'; // four minutes before NOW, as the sweep writes it

type Row = { id: number; timestamp: string; metric_name: string; value: number | null; labels: string };
/** A `system_metrics` stand-in answering exactly the two statements the reader makes. */
function metricsDb(rows: Row[], opts: { throws?: boolean; hang?: boolean } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          const guard = async <T>(f: () => T): Promise<T> => {
            if (opts.throws) throw new Error('D1_ERROR: no such table: system_metrics');
            if (opts.hang) return new Promise<T>(() => {});
            return f();
          };
          return {
            first: () => guard(() => {
              const hit = rows.filter((r) => r.metric_name === args[0]).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
              return hit ? { timestamp: hit.timestamp } : null;
            }),
            all: () => guard(() => {
              const prefix = sql.includes("'agent_sweep_") ? 'agent_sweep_' : 'agent_repair_';
              return { results: rows.filter((r) => r.timestamp === args[0] && r.metric_name.startsWith(prefix)).sort((a, b) => b.id - a.id) };
            }),
          };
        },
      };
    },
  };
}
let nextId = 1;
const sweepBatch = (ts: string, v: Partial<Record<string, number>>, labels: Record<string, unknown> | null) =>
  Object.entries({ candidates_examined: 0, eligible: 0, admitted: 0, refused: 0, resent: 0, ...v }).map(([k, value]) => ({
    id: nextId++, timestamp: ts, metric_name: `agent_sweep_${k}`, value: value as number,
    labels: labels === null ? '{}' : JSON.stringify({ cadence_minutes: 5, cursor_reset: false, ...labels }),
  }));
const repairBatch = (ts: string, v: Record<string, number>) =>
  Object.entries(v).map(([k, value]) => ({ id: nextId++, timestamp: ts, metric_name: `agent_repair_${k}`, value, labels: '{}' }));
const on = (rows: Row[], opts = {}) => ({ TEAM_AGENTS_ENABLED: 'true', DB: metricsDb(rows, opts) }) as any;
const by = (ms: Metric[]) => Object.fromEntries(ms.map((m) => [m.key, m]));

// 1, 2 ────────────────────────────────────────────────────────────────────────
test('#4592: a scanning sweep gives eligible work, its age and the admission counts, each with its provenance', async () => {
  // Mutations checked: the age level not computed from the thresholds; last_success_at left null; the scanned label ignored.
  const rows = [
    ...sweepBatch(TS, { eligible: 3, candidates_examined: 3, admitted: 2, refused: 1, oldest_eligible_age_seconds: 4_000 }, { scanned: true }),
    ...repairBatch(TS, { pending: 0, repaired: 0, ambiguous: 0 }),
  ];
  const m = by(await readAgentSweepSignals(on(rows), NOW));
  assert.deepEqual(['eligible', 'examined', 'admitted', 'refused', 'resent'].map((k) => m[`agents.sweep.${k}`].value), [3, 3, 2, 1, 0],
    'a resent count of 0 is a measured zero, recorded by the sweep');
  const age = m['agents.sweep.oldest_eligible_age_seconds'];
  assert.equal(age.value, 4_000);
  assert.equal(age.level, 'warning', 'over an hour is the proposed warning');
  assert.deepEqual(age.thresholds, ELIGIBLE_AGE_THRESHOLDS);
  for (const s of Object.values(m)) {
    assert.equal(s.scope, 'deployment');
    assert.match(s.source, /system_metrics agent_(sweep|repair)_\*/);
    assert.ok(s.window && s.sampling, `${s.key} states its window and sampling`);
    assert.equal(s.last_success_at, '2026-11-09T11:56:00.000Z');
    assert.ok(['count', 'seconds'].includes(s.unit));
  }
  assert.equal(SWEEP_SCAN_CAP, 120);
});

test('#4592: a sweep that did not scan says so; it is not zero eligible work', async () => {
  // Mutations checked: scanned:false read as a measured 0; an unlabelled batch trusted.
  const notScanned = by(await readAgentSweepSignals(on([...sweepBatch(TS, {}, { scanned: false }), ...repairBatch(TS, { pending: 0, ambiguous: 0 })]), NOW));
  assert.equal(notScanned['agents.sweep.eligible'].availability, 'not_running');
  assert.equal(notScanned['agents.sweep.eligible'].value, null);
  assert.equal(notScanned['agents.sweep.oldest_eligible_age_seconds'].availability, 'not_running');
  assert.equal(notScanned['agents.sweep.admitted'].value, 0, 'nothing admitted is a real zero');
  assert.equal(notScanned['agents.sweep.admitted'].availability, 'measured');

  const unlabelled = by(await readAgentSweepSignals(on(sweepBatch(TS, {}, null)), NOW));
  assert.equal(unlabelled['agents.sweep.eligible'].availability, 'unavailable', 'a batch from before the label is not evidence');
  assert.equal(unlabelled['agents.sweep.eligible'].level, 'unknown');

  const empty = by(await readAgentSweepSignals(on(sweepBatch(TS, { eligible: 0 }, { scanned: true })), NOW));
  assert.equal(empty['agents.sweep.eligible'].value, 0);
  assert.equal(empty['agents.sweep.oldest_eligible_age_seconds'].availability, 'none_waiting');
  assert.equal(empty['agents.sweep.oldest_eligible_age_seconds'].level, 'ok');

  const noAge = by(await readAgentSweepSignals(on(sweepBatch(TS, { eligible: 2 }, { scanned: true })), NOW));
  assert.equal(noAge['agents.sweep.oldest_eligible_age_seconds'].availability, 'unavailable', 'eligible work without an age has no age, not 0');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('#4593: repairs owed, and the oldest still owed after the sweep', async () => {
  // Mutations checked: a fully settled sweep reporting its found age; the cap ignored.
  const read = async (v: Record<string, number>) => by(await readAgentSweepSignals(on([...sweepBatch(TS, {}, { scanned: true }), ...repairBatch(TS, v)]), NOW));
  let m = await read({ pending: 0, repaired: 0, ambiguous: 0 });
  assert.equal(m['agents.repair.pending'].value, 0);
  assert.equal(m['agents.repair.oldest_age_seconds'].availability, 'none_waiting');
  m = await read({ pending: 2, repaired: 2, ambiguous: 0, oldest_age_seconds: 9_000 });
  assert.equal(m['agents.repair.oldest_age_seconds'].availability, 'none_waiting', 'everything found was repaired or settled');
  m = await read({ pending: 2, repaired: 1, ambiguous: 1, oldest_age_seconds: 7_200 });
  assert.deepEqual([m['agents.repair.unresolved'].value, m['agents.repair.oldest_age_seconds'].value, m['agents.repair.oldest_age_seconds'].level], [1, 7_200, 'warning']);
  m = await read({ pending: REPAIR_CAP, repaired: REPAIR_CAP, ambiguous: 0, oldest_age_seconds: 30_000 });
  assert.equal(m['agents.repair.oldest_age_seconds'].level, 'critical', 'a full batch may leave more behind, so its age stands');
  m = await read({ pending: 1, ambiguous: 1 });
  assert.equal(m['agents.repair.oldest_age_seconds'].availability, 'unavailable');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('agent signals: a failing, hanging, silent or stale source is unavailable, never 0; agents off is not_running', async () => {
  // Mutations checked: the staleness window removed; a thrown read returning zeros; the TEAM_AGENTS_ENABLED check dropped.
  const good = [...sweepBatch(TS, { eligible: 1, oldest_eligible_age_seconds: 10 }, { scanned: true }), ...repairBatch(TS, { pending: 0, ambiguous: 0 })];
  const cases: Array<[string, any, RegExp]> = [
    ['throws', on(good, { throws: true }), /could not be read/],
    ['hangs', on(good, { hang: true }), /did not answer in time/],
    ['never recorded', on([]), /never recorded/],
    ['no binding', { TEAM_AGENTS_ENABLED: 'true' }, /DB binding/],
  ];
  for (const [name, env, reason] of cases) {
    const ms = await readAgentSweepSignals(env, NOW, 20);
    assert.equal(ms.length, 9, name);
    for (const s of ms) {
      assert.equal(s.value, null, `${name}: ${s.key}`);
      assert.equal(s.availability, 'unavailable');
      assert.equal(s.level, 'unknown');
      assert.match(s.reason!, reason);
      assert.doesNotMatch(s.reason!, /no such table|D1_ERROR/, 'the driver text does not leave');
    }
  }
  const stale = await readAgentSweepSignals(on(good), new Date(Date.parse('2026-11-09T11:56:00Z') + 21 * 60_000));
  for (const s of stale) {
    assert.equal(s.availability, 'unavailable');
    assert.equal(s.last_success_at, '2026-11-09T11:56:00.000Z', 'a stale reading still says when the source last recorded');
  }
  const off = await readAgentSweepSignals({ TEAM_AGENTS_ENABLED: 'false', DB: metricsDb(good) } as any, NOW);
  assert.ok(off.every((s) => s.availability === 'not_running' && s.value === null && s.level === 'ok'));
  assert.equal(sqlUtc('2026-11-09 11:56:00'), '2026-11-09T11:56:00.000Z');
  assert.equal(sqlUtc('yesterday'), null);
});

// 4 ───────────────────────────────────────────────────────────────────────────
const DRILL = { schema_version: 1, outcome: 'passed', exit_code: 0, backup_key: 'd1/studioos-db/backup-2026-11-01.sql', step: 'teardown' };
const bucket = (marker: unknown, throws = false) => ({
  get: async (k: string) => {
    if (throws) throw new Error('R2 internal error with a secret path');
    return k === 'drill-d1.json' && marker !== null ? { json: async () => marker } : null;
  },
});
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

test('#4558: the last verified restore is the age of a passing drill; a failed or absent drill is not verified and critical', async () => {
  // Mutations checked: a failed drill given its age; never_run read as ok; the 32-day warning moved.
  const read = (marker: unknown, extra: Record<string, unknown> = {}) => readRestoreSignal({ BACKUPS: bucket(marker), ...extra } as any, NOW);
  const fresh = await read({ ...DRILL, at: daysAgo(3) });
  assert.deepEqual([fresh.availability, fresh.value, fresh.level, fresh.unit, fresh.last_success_at], ['measured', 3 * 86_400, 'ok', 'seconds', daysAgo(3)]);
  assert.ok(fresh.window && fresh.sampling && /drill-d1\.json/.test(fresh.source));
  assert.equal((await read({ ...DRILL, at: daysAgo(31) })).level, 'ok');
  assert.equal((await read({ ...DRILL, at: daysAgo(33) })).level, 'warning');
  assert.equal((await read({ ...DRILL, at: daysAgo(65) })).level, 'critical');
  assert.equal(RESTORE_AGE_THRESHOLDS.warning, 32 * 86_400);

  const failed = await read({ ...DRILL, outcome: 'failed', exit_code: 2, step: 'import', at: daysAgo(8) });
  assert.deepEqual([failed.availability, failed.value, failed.level], ['not_verified', null, 'critical']);
  assert.match(failed.reason!, /failed at step import/);
  const never = await read(null);
  assert.deepEqual([never.availability, never.value, never.level], ['not_verified', null, 'critical']);

  for (const [name, s] of [
    ['bucket throws', await readRestoreSignal({ BACKUPS: bucket(null, true) } as any, NOW)],
    ['no binding', await readRestoreSignal({} as any, NOW)],
    ['invalid marker', await read({ ...DRILL, outcome: 'maybe', at: daysAgo(1) })],
    ['hangs', await readRestoreSignal({ BACKUPS: { get: () => new Promise(() => {}) } } as any, NOW, 20)],
  ] as Array<[string, Metric]>) {
    assert.deepEqual([s.availability, s.value, s.level], ['unavailable', null, 'unknown'], name);
    assert.doesNotMatch(s.reason!, /secret|internal error/, name);
  }
  const branch = await read({ ...DRILL, at: daysAgo(1) }, { BRANCH_CODE: 'acme', DEPLOYMENT_TIER: 'branch' });
  assert.equal(branch.availability, 'not_running', 'the drill covers the HQ database only');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('alerts and snapshot: not_running neither opens nor clears; not_verified opens; a passing drill clears it', () => {
  // Mutations checked: not_running treated as a measured ok (clears); a new key left out of SNAPSHOT_KEY.
  const base = { label: 'x', source: 's', unit: 'seconds' as const, scope: 'deployment' as const, thresholds: RESTORE_AGE_THRESHOLDS };
  const off: Metric = { ...base, key: 'agents.sweep.oldest_eligible_age_seconds', value: null, availability: 'not_running', reason: 'off', level: 'ok', thresholds: ELIGIBLE_AGE_THRESHOLDS };
  const held = [{ id: 4, metric_key: off.key, severity: 'warning' as const, muted_until: null }];
  assert.deepEqual(evaluateAlerts(held, [off], {}, NOW), [{ kind: 'touch', id: 4, key: off.key, value: null }], 'turning agents off is not a recovery');
  assert.deepEqual(evaluateAlerts([], [off], { [off.key]: NOW.toISOString() }, NOW), [], 'and opens no freshness gap');

  const failed: Metric = { ...base, key: 'dr.restore.last_verified_age_seconds', value: null, availability: 'not_verified', reason: 'failed', level: 'critical' };
  assert.deepEqual(evaluateAlerts([], [failed], {}, NOW), [{ kind: 'open', key: failed.key, severity: 'critical', value: null }]);
  const open = [{ id: 5, metric_key: failed.key, severity: 'critical' as const, muted_until: null }];
  assert.deepEqual(evaluateAlerts(open, [failed], {}, NOW).map((a) => a.kind), ['touch']);
  const passed: Metric = { ...failed, value: 86_400, availability: 'measured', reason: null, level: 'ok' };
  assert.deepEqual(evaluateAlerts(open, [passed], {}, NOW).map((a) => a.kind), ['clear']);

  for (const k of ['agents.sweep.eligible', 'agents.sweep.examined', 'agents.sweep.admitted', 'agents.sweep.refused', 'agents.sweep.resent',
    'agents.sweep.oldest_eligible_age_seconds', 'agents.repair.pending', 'agents.repair.unresolved', 'agents.repair.oldest_age_seconds',
    'dr.restore.last_verified_age_seconds']) assert.ok(SNAPSHOT_KEY.test(k), k);
  assert.ok(!SNAPSHOT_KEY.test('agents.sweep.eligible.acme'));
  const rows = snapshotRows({ observed_at: NOW.toISOString(), scope: 'hq', metrics: [off, failed, passed] });
  assert.deepEqual(rows.map((r) => [r.value, r.availability, r.level]), [[null, 'not_running', 'ok'], [null, 'not_verified', 'critical'], [86_400, 'measured', 'ok']]);
});

test('the whole read carries the part 3 signals, lists what it does not read, and leaks nothing', async () => {
  // Mutations checked: a skipped issue dropped from not_read_here; a failed drill not raising the overall level.
  const env: any = {
    DB: { prepare: (sql: string) => sql === 'SELECT 1' ? { run: async () => ({ meta: { size_after: 1_000_000 } }) } : metricsDb([]).prepare(sql) },
    JOB_QUEUE: { metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }) },
    AGENT_QUEUE: { metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }) },
    BACKUPS: bucket({ ...DRILL, outcome: 'failed', exit_code: 2, at: daysAgo(8) }),
  };
  const r = await readPlatformCapacity(env, NOW);
  assert.equal(r.level, 'critical', 'a failed restore drill raises the platform');
  const keys = r.metrics.map((m) => m.key);
  assert.ok(keys.includes('agents.sweep.eligible') && keys.includes('agents.repair.pending') && keys.includes('dr.restore.last_verified_age_seconds'));
  for (const k of ['agents.halt_acknowledgement', 'd1.runtime_ddl_attempts', 'auth.monitor_state', 'ai.gateway_quota_retries']) {
    assert.ok(r.not_read_here.some((n: any) => n.key === k), k);
  }
  assert.equal(SIGNALS_NOT_READ_HERE.length, 4);
  const text = JSON.stringify(r.metrics);
  for (const forbidden of [/@/, /user_id|company_id|tenant_id|agent_id|task_id|email/i, /SELECT/, /token|secret|password/i]) assert.doesNotMatch(text, forbidden);
  const svc = readFileSync(join(ROOT, 'cloudflare-worker/src/services/platformCapacitySignals.ts'), 'utf8');
  assert.doesNotMatch(svc, /fetch\(|api\.cloudflare\.com|api\.github\.com/, 'bindings only');
});

test('the sweep opens one critical episode for a failed drill and clears it when a drill passes', async () => {
  // Mutations checked: not_verified given level unknown (never opens).
  const MIGRATION = readFileSync(join(ROOT, 'cloudflare-worker/sql/migrations/202611072340_platform_capacity_history.sql'), 'utf8');
  const db = makeD1(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, is_active INTEGER, role TEXT, notification_prefs TEXT);
    CREATE TABLE super_admins (user_id INTEGER);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT, title TEXT, body TEXT, link TEXT, meta TEXT, dedupe_key TEXT, UNIQUE (user_id, kind, dedupe_key));
    CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, payload TEXT, channel TEXT, category TEXT);
    ${MIGRATION}
  `, `INSERT INTO users VALUES (1, 1, 'admin', NULL); INSERT INTO super_admins VALUES (1);`).DB;
  let marker: any = { ...DRILL, outcome: 'failed', exit_code: 2, at: daysAgo(8) };
  const env: any = { DB: db, BACKUPS: { get: async () => ({ json: async () => marker }) } };
  await sweepPlatformCapacity(env, NOW);
  await sweepPlatformCapacity(env, new Date(NOW.getTime() + 900_000));
  const rows = async () => (await db.prepare(`SELECT metric_key, severity, state FROM platform_capacity_alerts WHERE metric_key LIKE 'dr.%'`).all()).results.map((r: any) => ({ ...r }));
  assert.deepEqual(await rows(), [{ metric_key: 'dr.restore.last_verified_age_seconds', severity: 'critical', state: 'open' }]);
  marker = { ...DRILL, at: daysAgo(0.5) };
  await sweepPlatformCapacity(env, new Date(NOW.getTime() + 1_800_000));
  assert.equal((await rows())[0].state, 'cleared');
  const titles = (await db.prepare(`SELECT title FROM notifications_inbox ORDER BY id`).all()).results.map((r: any) => r.title);
  assert.deepEqual(titles, ['Critical: Last verified restore age', 'Cleared: Last verified restore age']);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the real sweep labels whether it scanned, and the read trusts eligible work only from a scan', async () => {
  // Mutations checked: `stats.scanned = true` removed (the scan reads as not_running); the label dropped from the row.
  const { world, AGENT } = await import('./_agent_engine_fixture.ts');
  const { removeMigratedDatabases } = await import('./_storage_schema.ts');
  const { sweepAgents } = await import('../src/agents/sweep.ts');
  const worlds: Array<{ close: () => void }> = [];
  try {
    const now = new Date();
    const off = world({ engine: 'off' });
    worlds.push(off);
    await sweepAgents(off.env, now);
    const labels = (off.db.prepare("SELECT labels FROM system_metrics WHERE metric_name = 'agent_sweep_eligible'").get() as any).labels;
    assert.equal(JSON.parse(labels).scanned, false);
    let m = by(await readAgentSweepSignals(off.env, now));
    assert.equal(m['agents.sweep.eligible'].availability, 'not_running', 'the engine off: no scan, so no eligible count');
    assert.equal(m['agents.sweep.admitted'].value, 0);
    assert.equal(m['agents.repair.oldest_age_seconds'].availability, 'none_waiting');

    const live = world({ autonomy: 'self_start' });
    worlds.push(live);
    live.agent(AGENT);
    live.task(100, AGENT);
    await sweepAgents(live.env, now, { enqueue: async () => {}, runtime: async () => live.runtime });
    m = by(await readAgentSweepSignals(live.env, now));
    assert.equal(m['agents.sweep.eligible'].availability, 'measured');
    assert.equal(m['agents.sweep.eligible'].value, 1);
    assert.equal(m['agents.sweep.admitted'].value, 1);
    assert.equal(m['agents.sweep.oldest_eligible_age_seconds'].availability, 'measured');
    const stored = JSON.stringify(live.db.prepare("SELECT labels FROM system_metrics WHERE metric_name LIKE 'agent_%'").all());
    assert.doesNotMatch(stored, /Kestrel|Acme|Task 100|@/, 'no tenant, task or member in the telemetry');
  } finally { for (const w of worlds) w.close(); removeMigratedDatabases(); }
});
