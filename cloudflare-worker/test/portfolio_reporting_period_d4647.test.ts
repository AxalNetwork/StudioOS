/**
 * D4647 (#4647) — which reporting period a Portfolio default means.
 *
 * The quarter-end export's default was
 *
 *   Math.floor((now.getMonth() - 1) / 3) * 3   →  new Date(y, m, 0)  →  toISOString()
 *
 * which is wrong twice. `getMonth()` is zero-based, so in the first month of
 * any quarter — January, April, July, October — `(0 - 1) / 3` floors to -1 and
 * the default landed a WHOLE QUARTER early: in April it exported 31 December
 * rather than 31 March. And `new Date(y, m, 0)` is local midnight, which
 * `toISOString()` converts to UTC, so in every zone east of UTC the exported
 * date was the day before the quarter end. Neither error is visible on the
 * sheet: the figures are simply a different quarter's.
 *
 * `frontend/src/lib/reportingPeriod.js` now holds the rule — the last
 * COMPLETED quarter, on a civil date — and this file pins it, month by month
 * across a leap year and two year boundaries, to the two places the Worker
 * applies the same rule: `services/portfolioMetrics.ts`'s `completedPeriod`
 * (the Portfolio default, #5323) for WHICH quarter, and
 * `services/fundReportBuild.ts`'s `lastClosedQuarter` (a fund's quarterly
 * pack) for that quarter's last day. So the page cannot drift from either.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_reporting_period_d4647.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { lastClosedQuarter, quarterPeriod as workerQuarter, isClosed } from '../src/services/fundReportBuild.ts';
import { completedPeriod } from '../src/services/portfolioMetrics.ts';
import {
  civilToday, isCompleted, lastCompletedQuarter, lastCompletedQuarterEnd, quarterNumber, quarterPeriod,
} from '../../frontend/src/lib/reportingPeriod.js';

const ROOT = process.cwd();
/** Every month of a leap year and the two years around it: 36 civil dates. */
const MONTHS = [2025, 2026, 2027].flatMap(y => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}-15`));

test('the page and the Worker agree on the last completed quarter, every month of three years', () => {
  for (const day of MONTHS) {
    const page = lastCompletedQuarter(day);
    const worker = lastClosedQuarter(day);
    assert.deepEqual([page.label, page.start, page.end], [worker.label, worker.start, worker.end], day);
  }
});

test('the page picks the same quarter as the Portfolio Worker’s own completed-period default', () => {
  // `completedPeriod` answers `YYYY-Qn`; the page answers a period whose
  // `year` and `quarter` must name the same one, every month of three years.
  for (const day of MONTHS) {
    const page = lastCompletedQuarter(day);
    assert.equal(`${page.year}-Q${page.quarter}`, completedPeriod('quarterly', day), day);
  }
});

test('the quarter before January is the previous year’s fourth, not this year’s', () => {
  assert.deepEqual(lastCompletedQuarter('2026-01-01'), { label: 'Q4 2025', quarter: 4, year: 2025, start: '2025-10-01', end: '2025-12-31' });
  assert.deepEqual(lastCompletedQuarter('2026-01-31'), { label: 'Q4 2025', quarter: 4, year: 2025, start: '2025-10-01', end: '2025-12-31' });
});

test('the first month of a quarter reports that quarter’s predecessor, not the one before it', () => {
  // This is the whole-quarter error: the old arithmetic answered the quarter
  // before the right one in exactly these four months.
  assert.deepEqual([
    lastCompletedQuarterEnd('2026-01-09'), lastCompletedQuarterEnd('2026-04-09'),
    lastCompletedQuarterEnd('2026-07-09'), lastCompletedQuarterEnd('2026-10-09'),
  ], ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']);
  // The second and third months of each quarter answer the same thing.
  for (const [a, b, c] of [['2026-04-09', '2026-05-09', '2026-06-09'], ['2026-10-09', '2026-11-09', '2026-12-09']]) {
    assert.equal(lastCompletedQuarterEnd(a), lastCompletedQuarterEnd(b), `${a} vs ${b}`);
    assert.equal(lastCompletedQuarterEnd(b), lastCompletedQuarterEnd(c), `${b} vs ${c}`);
  }
});

test('a quarter’s end is the real last day of its last month, leap February included', () => {
  assert.equal(quarterPeriod(1, 2024).end, '2024-03-31');
  assert.equal(quarterPeriod(1, 2024).start, '2024-01-01');
  assert.equal(quarterPeriod(4, 2026).end, '2026-12-31');
  assert.equal(quarterPeriod(2, 2026).end, '2026-06-30');
  // February is never a quarter end, but the day count is the calendar's.
  assert.equal(quarterPeriod(1, 2024).start.slice(0, 7), '2024-01');
  for (const [q, y] of [[0, 2026], [5, 2026], [1, NaN]] as Array<[number, number]>) assert.equal(quarterPeriod(q, y), null, `${q} ${y}`);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => quarterNumber(`2026-${String(m).padStart(2, '0')}-01`)),
    [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
});

test('the date is a calendar day in the reader’s zone, not an instant converted to UTC', () => {
  // 1 April in Auckland is still 31 March in UTC. The old default read the
  // zone's local midnight and then printed its UTC instant, so it answered
  // the day before the quarter end for every reader east of UTC.
  const instant = new Date('2026-03-31T12:00:00Z');
  assert.equal(civilToday('Pacific/Auckland', instant), '2026-04-01');
  assert.equal(civilToday('UTC', instant), '2026-03-31');
  assert.equal(civilToday('America/Los_Angeles', instant), '2026-03-31');
  // So the default differs by a quarter across the date line on that instant,
  // and each answer is right for its own reader.
  assert.equal(lastCompletedQuarterEnd(civilToday('Pacific/Auckland', instant)), '2026-03-31');
  assert.equal(lastCompletedQuarterEnd(civilToday('UTC', instant)), '2025-12-31');
  // An unknown zone answers in UTC rather than throwing.
  assert.equal(civilToday('Not/AZone', instant), '2026-03-31');
});

test('a completed period is one whose last day is past, by the same test the Worker uses', () => {
  const period = lastCompletedQuarter('2026-11-09');
  assert.equal(isCompleted(period, '2026-11-09'), true);
  assert.equal(isCompleted(period, period.end), false, 'the last day itself is not yet past');
  assert.equal(isCompleted(workerQuarter('Q3 2026'), '2026-11-09'), isClosed(workerQuarter('Q3 2026')!, '2026-11-09'));
  assert.equal(isCompleted(null, '2026-11-09'), false);
});

// ── Mutation and restoration ────────────────────────────────────────────────

/**
 * Each guarded line is broken on disk and this file re-run in a child process
 * filtered to the tests that must then fail; the source is restored in a
 * `finally`. The page's module is imported by the test and by the SPA, so a
 * real import of the mutated file is what exercises it.
 */
const SELF = new URL(import.meta.url).pathname;
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  return env;
}
const run = (pattern: string) => spawnSync(process.execPath,
  ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    '--test', '--test-name-pattern', pattern, SELF],
  { cwd: resolve(ROOT), encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, env: { ...childEnv(), D4647_SKIP_MUTATIONS: '1' } });

const PAGE = 'frontend/src/lib/reportingPeriod.js';
const CHECKS = [
  { name: 'the quarter before January belongs to the previous year', file: PAGE,
    before: '  return q === 1 ? quarterPeriod(4, year - 1) : quarterPeriod(q - 1, year);',
    after: '  return quarterPeriod(q === 1 ? 4 : q - 1, year);', pattern: 'previous year' },
  { name: 'the default is the quarter before this one, not two before', file: PAGE,
    before: '  const q = quarterNumber(today);', after: '  const q = quarterNumber(today) - 1;',
    pattern: 'that quarter’s predecessor' },
  { name: 'the page agrees with the Portfolio Worker on which quarter', file: PAGE,
    before: '  return q === 1 ? quarterPeriod(4, year - 1) : quarterPeriod(q - 1, year);',
    after: '  return quarterPeriod(q, year);', pattern: 'Portfolio Worker’s own' },
  { name: 'the quarter number is one-based on the month', file: PAGE,
    before: '  return Math.floor((month - 1) / 3) + 1;', after: '  return Math.floor(month / 3) + 1;',
    pattern: 'last day of its last month' },
  { name: 'the end is the month’s real last day', file: PAGE,
    before: "  return { label: `Q${q} ${y}`, quarter: q, year: y, start: `${y}-${pad(firstMonth)}-01`, end: `${y}-${pad(lastMonth)}-${pad(lastDay(y, lastMonth))}` };",
    after: "  return { label: `Q${q} ${y}`, quarter: q, year: y, start: `${y}-${pad(firstMonth)}-01`, end: `${y}-${pad(lastMonth)}-30` };",
    pattern: 'last day of its last month' },
  { name: 'the date is read in the given zone', file: PAGE,
    before: "      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })",
    after: "      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })",
    pattern: 'reader’s zone' },
  { name: 'a period is completed only once its last day is past', file: PAGE,
    before: "export const isCompleted = (period, today) => !!period && period.end < String(today);",
    after: "export const isCompleted = (period, today) => !!period && period.end <= String(today);",
    pattern: 'last day is past' },
];

if (!process.env.D4647_SKIP_MUTATIONS) {
  test('every check’s tests pass against the source before any mutation', () => {
    for (const pattern of new Set(CHECKS.map(c => c.pattern))) {
      const r = run(pattern);
      assert.equal(r.status, 0, `${pattern} did not pass unmutated: ${(r.stdout ?? '').slice(-1500)}`);
      assert.match(r.stdout ?? '', /# fail 0/, pattern);
      assert.doesNotMatch(r.stdout ?? '', /# pass 0\n/, `${pattern} matched no test`);
    }
  });

  for (const check of CHECKS) test(`Mutation and restoration: ${check.name}`, () => {
    const file = resolve(ROOT, check.file);
    const original = readFileSync(file, 'utf8');
    assert.ok(original.includes(check.before), `mutation_target_missing: ${check.name}`);
    assert.equal(original.split(check.before).length - 1, 1, `mutation target is not unique: ${check.name}`);
    let result;
    try {
      writeFileSync(file, original.replace(check.before, check.after));
      result = run(check.pattern);
    } finally { writeFileSync(file, original); }
    assert.notEqual(result.status, 0, `the mutation went unnoticed by "${check.pattern}": ${(result.stdout ?? '').slice(-1500)}`);
    assert.equal(readFileSync(file, 'utf8'), original, 'the source was not restored');
  });
}
