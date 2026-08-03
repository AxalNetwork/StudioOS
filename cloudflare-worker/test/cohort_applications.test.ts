/**
 * Cohort Application Deadlines — pure-core unit tests.
 *
 * Covers the spec's mandated cases:
 *   • Close deadline = 7 days before the 1st at 23:59:59 America/New_York,
 *     DST-correct in both directions (March spring-forward, November
 *     fall-back cohorts).
 *   • Late submissions targeting a closed cycle are rejected with the next
 *     eligible cycle attached; untargeted submissions auto-land in the
 *     earliest open cycle (skipping the closed one during review windows).
 *   • Low-capacity rollover decision: below-minimum postpones unless
 *     force_proceed is set; empty cycles never postpone.
 *   • Idempotent notifications: the ledger's UNIQUE claim means a re-run
 *     of the same (user, cycle, type) never sends twice.
 *
 * Run with the strip-types loader (same as test:drift's ts group):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cohort_applications.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationWindowFor,
  resolveApplicationTarget,
  capacityDecision,
  nextYearMonth,
  monthLabel,
  notifyOnce,
} from '../src/services/cohortApplications.ts';

const HOUR = 3600_000;

// ---------------------------------------------------------------------------
// Deadline math — 7 days before the 1st, 23:59:59 ET, DST-correct
// ---------------------------------------------------------------------------

test('August 2026 window: closes July 25 23:59:59 EDT (03:59:59Z next day)', () => {
  const w = applicationWindowFor(2026, 8);
  // Opens July 1 00:00 EDT → 04:00 UTC.
  assert.equal(w.openMs, Date.UTC(2026, 6, 1, 4));
  // Closes July 25 23:59:59 EDT (UTC-4) → July 26 03:59:59 UTC.
  assert.equal(w.closeMs, Date.UTC(2026, 6, 26, 3, 59, 59));
  // Cohort starts Aug 1 00:00 EDT → 04:00 UTC.
  assert.equal(w.startMs, Date.UTC(2026, 7, 1, 4));
});

test('March 2026 cohort (EST close): Feb 22 23:59:59 EST → 04:59:59Z next day', () => {
  const w = applicationWindowFor(2026, 3);
  // Feb 22 is deep EST (UTC-5) — spring-forward is Mar 8, after the close.
  assert.equal(w.closeMs, Date.UTC(2026, 1, 23, 4, 59, 59));
  // Start Mar 1 00:00 EST → 05:00 UTC.
  assert.equal(w.startMs, Date.UTC(2026, 2, 1, 5));
});

test('November 2026 cohort (EDT close, EST later): Oct 25 23:59:59 EDT → 03:59:59Z', () => {
  const w = applicationWindowFor(2026, 11);
  // Oct 25 is still EDT (fall-back is Nov 1) → UTC-4.
  assert.equal(w.closeMs, Date.UTC(2026, 9, 26, 3, 59, 59));
  // Start Nov 1 00:00 EDT → 04:00 UTC.
  assert.equal(w.startMs, Date.UTC(2026, 10, 1, 4));
});

test('January cohort window opens Dec 1 of the previous year (month underflow)', () => {
  const w = applicationWindowFor(2027, 1);
  // Dec 1 2026 00:00 EST → 05:00 UTC.
  assert.equal(w.openMs, Date.UTC(2026, 11, 1, 5));
  // Close Dec 25 2026 23:59:59 EST → Dec 26 04:59:59 UTC.
  assert.equal(w.closeMs, Date.UTC(2026, 11, 26, 4, 59, 59));
});

// ---------------------------------------------------------------------------
// Target resolution — late submissions hard-blocked
// ---------------------------------------------------------------------------

test('one second before close: targeted submission accepted', () => {
  const close = applicationWindowFor(2026, 8).closeMs;
  const t = resolveApplicationTarget(close - 1000, { year: 2026, month: 8 });
  assert.equal(t.ok, true);
});

test('at/after close: targeted submission rejected with next eligible cycle', () => {
  const close = applicationWindowFor(2026, 8).closeMs;
  const t = resolveApplicationTarget(close, { year: 2026, month: 8 });
  assert.equal(t.ok, false);
  if (!t.ok) {
    assert.deepEqual(t.closed, { year: 2026, month: 8 });
    assert.equal(t.next.year, 2026);
    assert.equal(t.next.month, 9);
  }
});

test('untargeted submission during the review window lands in the month after next', () => {
  // July 28 2026 12:00 UTC — after the Aug close (Jul 26 03:59:59Z),
  // before Aug 1. Next eligible cohort is September.
  const t = resolveApplicationTarget(Date.UTC(2026, 6, 28, 12));
  assert.equal(t.ok, true);
  if (t.ok) {
    assert.equal(t.year, 2026);
    assert.equal(t.month, 9);
  }
});

test('untargeted submission mid-month lands in next month while its window is open', () => {
  // July 10 2026 — August window still open.
  const t = resolveApplicationTarget(Date.UTC(2026, 6, 10, 12));
  assert.equal(t.ok, true);
  if (t.ok) assert.equal(t.month, 8);
});

test('December → January year rollover', () => {
  // Dec 28 2026 (after Dec 25 close for January 2027? no — close for Jan
  // 2027 is Dec 25): applying Dec 28 targets February 2027.
  const t = resolveApplicationTarget(Date.UTC(2026, 11, 28, 12));
  assert.equal(t.ok, true);
  if (t.ok) {
    assert.equal(t.year, 2027);
    assert.equal(t.month, 2);
  }
  assert.deepEqual(nextYearMonth(2026, 12), { year: 2027, month: 1 });
});

test('monthLabel renders human-readable cohort names', () => {
  assert.equal(monthLabel(2026, 8), 'August 2026');
  assert.equal(monthLabel(2027, 1), 'January 2027');
});

// ---------------------------------------------------------------------------
// Capacity decision
// ---------------------------------------------------------------------------

test('capacityDecision: below minimum postpones', () => {
  assert.equal(capacityDecision(2, 5, 4, false), 'postpone');
});

test('capacityDecision: at/above minimum proceeds', () => {
  assert.equal(capacityDecision(4, 6, 4, false), 'proceed');
  assert.equal(capacityDecision(7, 7, 4, false), 'proceed');
});

test('capacityDecision: force_proceed overrides the minimum', () => {
  assert.equal(capacityDecision(1, 3, 4, true), 'proceed');
});

test('capacityDecision: an empty cycle never postpones (nothing to combine)', () => {
  assert.equal(capacityDecision(0, 0, 4, false), 'proceed');
});

// ---------------------------------------------------------------------------
// Fake D1 — UNIQUE-dedupes the notification ledger so idempotency is
// observable; records every prepared statement + bindings.
// ---------------------------------------------------------------------------

type Call = { sql: string; binds: unknown[] };

function fakeEnv() {
  const calls: Call[] = [];
  const ledgerKeys = new Set<string>();
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            return {
              async run() {
                calls.push({ sql, binds });
                if (sql.includes('INSERT OR IGNORE INTO cohort_app_notification_ledger')) {
                  const key = binds.join('|');
                  if (ledgerKeys.has(key)) return { meta: { changes: 0 } };
                  ledgerKeys.add(key);
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() { calls.push({ sql, binds }); return null; },
              async all() { calls.push({ sql, binds }); return { results: [] }; },
            };
          },
          async run() { calls.push({ sql, binds: [] }); return { meta: { changes: 1 } }; },
          async first() { calls.push({ sql, binds: [] }); return null; },
          async all() { calls.push({ sql, binds: [] }); return { results: [] }; },
        };
      },
    },
  };
  return { env: env as never, calls };
}

test('notifyOnce sends exactly once per (user, cycle, type) — re-runs are no-ops', async () => {
  const { env } = fakeEnv();
  const args = { userId: 7, cycleId: 3, notifType: 'workspace_live', title: 't', body: 'b' };
  const first = await notifyOnce(env, args);
  const second = await notifyOnce(env, args);
  const otherType = await notifyOnce(env, { ...args, notifType: 'cohorts_combined' });
  const otherUser = await notifyOnce(env, { ...args, userId: 8 });
  assert.equal(first, true);
  assert.equal(second, false); // idempotent re-run
  assert.equal(otherType, true);
  assert.equal(otherUser, true);
});
