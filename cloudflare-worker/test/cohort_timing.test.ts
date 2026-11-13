/**
 * Cohort Timing & Gating — pure-core unit tests.
 *
 * Covers the spec's mandated cases:
 *   • DST boundaries: March (spring forward) and November (fall back) —
 *     week boundaries stay at midnight America/New_York wall clock, so
 *     their UTC instants shift between 05:00Z (EST) and 04:00Z (EDT).
 *   • A founder completing the last deliverable at the exact deadline
 *     second passes (cutoff is INCLUSIVE).
 *   • A founder with one incomplete deliverable fails, with the missing
 *     key reported.
 *   • requiredAny semantics (week 3): any one of the alternatives counts.
 *   • Idempotent job re-runs: claimJobRun claims exactly once per
 *     idempotency key.
 *   • Admin overrides log to stage_transition_log with triggered_by='admin'
 *     and the required reason.
 *
 * Run with the strip-types loader (same as test:drift's ts group):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cohort_timing.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockedByPriorWeek,
  tzOffsetMs,
  wallClockToUtcMs,
  cycleWeekWindows,
  delawareYearMonth,
  evaluateWeekOutcome,
  sqliteUtcToMs,
  claimJobRun,
  applyWeekDecision,
} from '../src/services/cohortTiming.ts';

const HOUR = 3600_000;

// ---------------------------------------------------------------------------
// Calendar math — DST correctness
// ---------------------------------------------------------------------------

test('tzOffsetMs: EST is -5h, EDT is -4h', () => {
  // Jan 15 2026 12:00 UTC — deep EST.
  assert.equal(tzOffsetMs(Date.UTC(2026, 0, 15, 12), 'America/New_York'), -5 * HOUR);
  // Jul 15 2026 12:00 UTC — deep EDT.
  assert.equal(tzOffsetMs(Date.UTC(2026, 6, 15, 12), 'America/New_York'), -4 * HOUR);
});

test('March 2026 cohort (spring forward Mar 8): week boundaries track wall-clock midnight', () => {
  const w = cycleWeekWindows(2026, 3);
  assert.equal(w.length, 4);
  // Week 1 unlock: Mar 1 00:00 EST → 05:00 UTC.
  assert.equal(w[0].unlockMs, Date.UTC(2026, 2, 1, 5));
  // Week 2 unlock: Mar 8 00:00 — DST flips at 2am local, so midnight is
  // still EST → 05:00 UTC. The transition happens INSIDE week 2.
  assert.equal(w[1].unlockMs, Date.UTC(2026, 2, 8, 5));
  assert.equal(w[0].deadlineMs, w[1].unlockMs); // contiguous windows
  // Week 3 unlock: Mar 15 00:00 EDT → 04:00 UTC (week 2 was 167 real hours).
  assert.equal(w[2].unlockMs, Date.UTC(2026, 2, 15, 4));
  assert.equal(w[1].deadlineMs - w[1].unlockMs, 167 * HOUR);
  // Week 4 deadline: Mar 29 00:00 EDT → 04:00 UTC.
  assert.equal(w[3].deadlineMs, Date.UTC(2026, 2, 29, 4));
});

test('November 2026 cohort (fall back Nov 1): week 1 gains an hour', () => {
  const w = cycleWeekWindows(2026, 11);
  // Nov 1 00:00 is still EDT (clocks fall back at 2am) → 04:00 UTC.
  assert.equal(w[0].unlockMs, Date.UTC(2026, 10, 1, 4));
  // Nov 8 00:00 EST → 05:00 UTC; week 1 spans 169 real hours.
  assert.equal(w[1].unlockMs, Date.UTC(2026, 10, 8, 5));
  assert.equal(w[0].deadlineMs - w[0].unlockMs, 169 * HOUR);
  // Remaining weeks are plain 168h EST weeks.
  assert.equal(w[2].unlockMs - w[1].unlockMs, 168 * HOUR);
});

test('wallClockToUtcMs handles day overflow (cycle end = day 29 of February)', () => {
  // Feb 2026 has 28 days: "Feb 29" === Mar 1 00:00 EST.
  assert.equal(wallClockToUtcMs(2026, 2, 29), wallClockToUtcMs(2026, 3, 1));
  const feb = cycleWeekWindows(2026, 2);
  assert.equal(feb[3].deadlineMs, Date.UTC(2026, 2, 1, 5)); // Mar 1 00:00 EST
});

test('delawareYearMonth picks the ET-local month at UTC month boundaries', () => {
  // Mar 1 2026 03:00 UTC is still Feb 28 22:00 EST.
  assert.deepEqual(delawareYearMonth(Date.UTC(2026, 2, 1, 3)), { year: 2026, month: 2 });
  assert.deepEqual(delawareYearMonth(Date.UTC(2026, 2, 1, 6)), { year: 2026, month: 3 });
});

test('sqliteUtcToMs parses D1 timestamps as UTC', () => {
  assert.equal(sqliteUtcToMs('2026-03-08 05:00:00'), Date.UTC(2026, 2, 8, 5));
  assert.equal(sqliteUtcToMs(null), null);
  assert.equal(sqliteUtcToMs('garbage'), null);
});

// ---------------------------------------------------------------------------
// Pass/fail decisions
// ---------------------------------------------------------------------------

const WEEK1_ALL = [
  'project_created',
  'customer_interview_logged_1',
  'customer_interview_logged_2',
  'customer_interview_logged_3',
];

test('completing the final deliverable at the exact deadline second PASSES', () => {
  const cutoff = Date.UTC(2026, 2, 8, 5); // week 1 deadline
  const completed = WEEK1_ALL.map((key, i) => ({
    key,
    // Last one lands exactly at the cutoff instant.
    completed_at_ms: i === WEEK1_ALL.length - 1 ? cutoff : cutoff - (i + 1) * HOUR,
  }));
  const r = evaluateWeekOutcome(1, completed, cutoff);
  assert.equal(r.passed, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.doneCount, r.requiredCount);
});

test('a deliverable one millisecond AFTER the deadline does not count', () => {
  const cutoff = Date.UTC(2026, 2, 8, 5);
  const completed = WEEK1_ALL.map((key, i) => ({
    key,
    completed_at_ms: i === 0 ? cutoff + 1 : cutoff - HOUR,
  }));
  const r = evaluateWeekOutcome(1, completed, cutoff);
  assert.equal(r.passed, false);
  assert.deepEqual(r.missing, ['project_created']);
});

test('one incomplete deliverable fails the week and is reported missing', () => {
  const cutoff = Date.UTC(2026, 2, 8, 5);
  const completed = WEEK1_ALL.slice(0, 3).map((key) => ({ key, completed_at_ms: cutoff - HOUR }));
  const r = evaluateWeekOutcome(1, completed, cutoff);
  assert.equal(r.passed, false);
  assert.deepEqual(r.missing, ['customer_interview_logged_3']);
  assert.equal(r.doneCount, 3);
  assert.equal(r.requiredCount, 4);
  // Snapshot covers every gating deliverable, done or not.
  assert.equal(r.snapshot.length, 4);
  assert.equal(r.snapshot.find((s) => s.key === 'customer_interview_logged_3')!.completed, false);
});

test('week 3 requiredAny: one alternative suffices; none fails', () => {
  const cutoff = Date.UTC(2026, 2, 22, 4);
  const base = [{ key: 'scoring_run_completed', completed_at_ms: cutoff - HOUR }];
  const withAny = evaluateWeekOutcome(3, [...base, { key: 'cofounder_request_sent', completed_at_ms: cutoff - HOUR }], cutoff);
  assert.equal(withAny.passed, true);
  const withoutAny = evaluateWeekOutcome(3, base, cutoff);
  assert.equal(withoutAny.passed, false);
  assert.equal(withoutAny.missing.length, 1);
  assert.match(withoutAny.missing[0], /^any_of:/);
});

// ---------------------------------------------------------------------------
// Freeze halts the pipeline — regression for the cascading-failure flaw
// ---------------------------------------------------------------------------

test('a failed week 2 BLOCKS the week 3/4 decisions (no cascading auto-fails)', () => {
  const statuses = [
    { week: 1, status: 'passed' },
    { week: 2, status: 'failed' },
  ];
  assert.equal(blockedByPriorWeek(statuses, 3), true);
  assert.equal(blockedByPriorWeek(statuses, 4), true);
  // The failed week itself may still be re-decided (grace finalize, override).
  assert.equal(blockedByPriorWeek(statuses, 2), false);
});

test('an active grace window on week 2 also blocks later weeks', () => {
  const statuses = [{ week: 2, status: 'grace' }];
  assert.equal(blockedByPriorWeek(statuses, 3), true);
});

test('admin force-pass of the failed week UNFREEZES later evaluation', () => {
  // After the override flips week 2 to passed, week 3 evaluates normally.
  const statuses = [
    { week: 1, status: 'passed' },
    { week: 2, status: 'passed' }, // was 'failed', admin force-passed
  ];
  assert.equal(blockedByPriorWeek(statuses, 3), false);
  assert.equal(blockedByPriorWeek(statuses, 4), false);
});

test('no prior rows (clean founder) never blocks', () => {
  assert.equal(blockedByPriorWeek([], 1), false);
  assert.equal(blockedByPriorWeek([{ week: 3, status: 'failed' }], 2), false); // later week never blocks an earlier one
});

// ---------------------------------------------------------------------------
// Fake D1 — records every prepared statement + bindings; UNIQUE-dedupes
// scheduled_jobs_audit inserts so idempotency is observable.
// ---------------------------------------------------------------------------

type Call = { sql: string; binds: unknown[] };

function fakeEnv() {
  const calls: Call[] = [];
  const auditKeys = new Set<string>();
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            return {
              async run() {
                calls.push({ sql, binds });
                if (sql.includes('INSERT OR IGNORE INTO scheduled_jobs_audit')) {
                  const key = String(binds[3]);
                  if (auditKeys.has(key)) return { meta: { changes: 0 } };
                  auditKeys.add(key);
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() { calls.push({ sql, binds }); return null; },
              async all() { calls.push({ sql, binds }); return { results: [] }; },
            };
          },
          async run() { calls.push({ sql, binds: [] }); return { meta: { changes: 1 } }; },
        };
      },
    },
  };
  return { env: env as never, calls };
}

test('claimJobRun is idempotent — a re-run of the same job is a no-op', async () => {
  const { env } = fakeEnv();
  const first = await claimJobRun(env, 'week_deadline', 12, 2, 'week_deadline:12:2');
  const second = await claimJobRun(env, 'week_deadline', 12, 2, 'week_deadline:12:2');
  const other = await claimJobRun(env, 'week_deadline', 12, 3, 'week_deadline:12:3');
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(other, true);
});

test('admin override logs stage_transition_log with triggered_by=admin + reason', async () => {
  const { env, calls } = fakeEnv();
  await applyWeekDecision(env, {
    userId: 7, cycleId: 12, week: 2,
    toStatus: 'passed', fromStatus: 'failed',
    reason: 'Deliverables verified manually on a call',
    triggeredBy: 'admin', adminUserId: 3,
  });
  const upsert = calls.find((c) => c.sql.includes('INSERT INTO company_week_status'));
  assert.ok(upsert, 'company_week_status upsert issued');
  assert.equal(upsert!.binds[8], 'admin:3'); // decided_by
  const log = calls.find((c) => c.sql.includes('INSERT INTO stage_transition_log'));
  assert.ok(log, 'stage_transition_log insert issued');
  const [userId, cycleId, week, fromStatus, toStatus, reason, triggeredBy, adminId] = log!.binds;
  assert.equal(userId, 7);
  assert.equal(cycleId, 12);
  assert.equal(week, 2);
  assert.equal(fromStatus, 'failed');
  assert.equal(toStatus, 'passed');
  assert.equal(reason, 'Deliverables verified manually on a call');
  assert.equal(triggeredBy, 'admin');
  assert.equal(adminId, 3);
});

test('scheduler decisions log triggered_by=scheduler with decided_by=system', async () => {
  const { env, calls } = fakeEnv();
  await applyWeekDecision(env, {
    userId: 9, cycleId: 12, week: 1,
    toStatus: 'failed', fromStatus: 'pending',
    doneCount: 3, requiredCount: 4,
    reason: 'missing: customer_interview_logged_3',
    triggeredBy: 'scheduler',
  });
  const upsert = calls.find((c) => c.sql.includes('INSERT INTO company_week_status'));
  assert.equal(upsert!.binds[8], 'system');
  const log = calls.find((c) => c.sql.includes('INSERT INTO stage_transition_log'));
  assert.equal(log!.binds[6], 'scheduler');
});
