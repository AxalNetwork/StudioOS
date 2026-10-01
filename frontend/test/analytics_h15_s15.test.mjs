/**
 * D210 — HQ's Analytics page (H15) and a branch's (S15), rendered from payloads
 * the Worker's own arithmetic built.
 *
 * WHY THE FIXTURES COME FROM THE WORKER. Both pages draw weeks, a KPI and gaps
 * that `cloudflare-worker/src/services/activeAccounts.ts` decides: which Monday
 * a week starts on, which week is the last complete one, and when a four-week
 * delta may be drawn at all. A hand-written axis or KPI here would be a second
 * copy of those rules, free to drift from the first, so every fixture below is
 * `weekAxis()` and `weeklyKpi()` run for real. What this file adds is what only
 * a render can see: that each page draws what it was given, that a missing
 * week is never drawn as a zero or bridged over, and that each stated absence
 * carries the server's own sentence.
 *
 * What it pins:
 *  - The range pills carry the worker's own keys, in its order.
 *  - The geometry: a null week is never plotted and never bridged; only the
 *    current week's point is hollow; the y axis starts at zero; the median rule
 *    sits at its true value on the line's own scale.
 *  - H15: a suspended branch's line is dashed and continues; the legend states
 *    a missing figure with its reason; an unread store draws no line at all;
 *    the rail's four absences are exactly the server's four; the view-as note
 *    appears only under the overlay.
 *  - S15: the median caption names its week, n and computed time; a withheld
 *    median draws no rule; the age bands switch at a day and at two; the week
 *    gates read "not yet due" for a deadline still ahead and "no outcome
 *    recorded" for a passed one with nothing judged; revenue states the rate
 *    and every stream's reason.
 *  - A SQL-format deadline reads as UTC whatever zone the reader is in.
 *  - No figure falls back to zero, no page uses a word the product does not,
 *    and no account identifier reaches either page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import ViewAsBranchContext from '../src/contexts/ViewAsBranchContext.js';
import HqAnalyticsPage, {
  UNAVAILABLE as HQ_UNAVAILABLE, seriesColor, isSuspended, seriesFlag, notRecordedReason,
  hqAnalyticsCoverage, SeriesLegend, ActiveAccountsCard, HqKpis,
} from '../src/pages/hq/HqAnalyticsPage.jsx';
import BranchAnalytics, {
  UNAVAILABLE as BRANCH_UNAVAILABLE, ageTone, pushedLabel, BranchKpis, BranchChartCard, ApprovalAgeList,
  WeekGates, RevenueCard,
} from '../src/pages/branch/BranchAnalytics.jsx';
import WeeklyLineChart from '../src/components/WeeklyLineChart.jsx';
import { RANGE_PILLS, rangeLabel, signed } from '../src/components/AnalyticsParts.jsx';
import { weeklyChartGeometry, weekLabel } from '../src/lib/weeklyChart.js';
import { inZone, dateInZone } from '../src/lib/zoneTime.js';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import {
  ANALYTICS_RANGES, weekAxis, weeklyKpi, GAP_SENTENCES, ACTIVE_ACCOUNT_BASIS,
  foldDailyActives, seriesValues, gapNotes,
} from '../../cloudflare-worker/src/services/activeAccounts.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const html = (el, props) => renderToStaticMarkup(createElement(el, props));

/**
 * The markup of the element carrying `attr`, from its opening tag to the first
 * `close` after it. Bounded, so an assertion about one element cannot be
 * satisfied by a neighbour's markup further down the page.
 */
function slice(markup, attr, close) {
  const at = markup.indexOf(attr);
  assert.ok(at >= 0, `missing ${attr}`);
  const open = markup.lastIndexOf('<', at);
  const end = markup.indexOf(close, at);
  assert.ok(end > at, `no ${close} after ${attr}`);
  return markup.slice(open, end + close.length);
}
/** Every value of `name="…"` in order. */
function attrs(markup, name) {
  const out = [];
  const needle = `${name}="`;
  let at = markup.indexOf(needle);
  while (at >= 0) {
    const start = at + needle.length;
    const end = markup.indexOf('"', start);
    out.push(markup.slice(start, end));
    at = markup.indexOf(needle, end);
  }
  return out;
}
const count = (hay, needle) => hay.split(needle).length - 1;
/**
 * What a KPI tile's figure reads — its value slot alone, not its label, delta
 * or note. The notes say "Not recorded" and name weeks in digits, so a match
 * over the whole tile passes whether or not the figure itself is right.
 */
function kpiValue(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `missing ${id}`);
  const value = markup.indexOf('text-xl', at);
  const next = markup.indexOf('data-testid=', at + 1);
  assert.ok(value > at && (next < 0 || value < next), `${id} has no figure slot of its own`);
  return renderedText(markup.slice(markup.lastIndexOf('<', value), markup.indexOf('</span>', value) + '</span>'.length));
}

// ── The fixtures, built by the worker's own functions ──────────────────────

const NOW = '2026-09-23T12:00:00Z';
const axis = weekAxis(NOW, ANALYTICS_RANGES['8w']);

/** `monday` plus `k` days, as `YYYY-MM-DD`. */
function dayAfter(monday, k) {
  const t = new Date(`${monday}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + k);
  return t.toISOString().slice(0, 10);
}

/**
 * HQ's lines, declared as the accounts each week holds, and `since` — the day
 * of the line's first recorded request inside the window. HQ's own line and
 * Iberia's begin on the window's first day, which is the store's earliest row
 * too, so the read cannot see where they began (their `first_week` is null);
 * France and the unregistered code begin inside the window, where it can.
 */
const HQ_LINES = [
  { code: 'hq', label: 'HQ-held', kind: 'hq', status: null, suspended_at: null,
    since: axis.weeks[0], counts: [5, 6, 7, 8, 9, 10, 11, 4] },
  { code: 'fr', label: 'Axal VC France', kind: 'branch', status: 'active', suspended_at: null,
    since: '2026-08-11', counts: [null, 2, 3, 4, 5, 6, 7, 2] },
  { code: 'es', label: 'Axal VC Iberia', kind: 'branch', status: 'suspended', suspended_at: '2026-09-01 10:00:00',
    since: axis.weeks[0], counts: [2, 2, 3, 3, 4, 4, 5, 1] },
  { code: 'de', label: 'Axal VC DACH', kind: 'branch', status: 'active', suspended_at: null,
    since: null, counts: [null, null, null, null, null, null, null, null] },
  { code: 'xx', label: 'xx', kind: 'unregistered', status: null, suspended_at: null,
    since: '2026-09-08', counts: [null, null, null, null, null, 2, 3, 1],
    note: 'The metrics store recorded this code and the deployment registry has no row for it.' },
];

/**
 * One Analytics Engine row per account per day — the shape HQ's reader folds.
 * An anonymous row (`uid` 0) dates each line's first request; the counted
 * accounts sign in on each week's Tuesday.
 */
const AE_ROWS = HQ_LINES.flatMap((l) => [
  ...(l.since ? [{ day: l.since, branch: l.code, uid: 0, n: 1, weight: 1 }] : []),
  ...l.counts.flatMap((c, k) => Array.from({ length: c ?? 0 }, (_, u) => (
    { day: dayAfter(axis.weeks[k], 1), branch: l.code, uid: u + 1, n: 1, weight: 1 }))),
]);

/**
 * `active_accounts` as `GET /api/admin/hq/analytics` assembles it: each line
 * from `seriesValues`, its last complete week's gap sentence as `gap_reason`
 * (and none when that week has a figure), the chart's foot from `gapNotes`,
 * the KPI from `weeklyKpi`. `capDay` is where a read that stopped at its row
 * cap stopped.
 */
function hqActive({ capDay = null } = {}) {
  const fold = foldDailyActives(AE_ROWS, axis);
  const last = axis.weeks.length - 2;
  const series = HQ_LINES.map(({ since, counts, ...line }) => {
    const v = seriesValues(fold, axis, line.code, capDay);
    const lastGap = v.gaps[last];
    return {
      ...line,
      values: v.values,
      gaps: v.gaps,
      ...(lastGap ? { gap_reason: GAP_SENTENCES[lastGap] } : {}),
      first_day: v.first_day,
      first_week: v.first_week,
    };
  });
  return {
    available: true,
    as_of: '2026-09-23T12:00:00.000Z',
    series,
    gap_notes: gapNotes(series.map((s) => s.gaps)),
    kpi: weeklyKpi(axis, series),
    complete: capDay === null,
    row_cap: 50000,
    store_first_day: fold.floorDay,
    sampled: fold.sampled,
  };
}
const HQ_SERIES = hqActive().series;

/**
 * The server's four absences, read out of the route that sends them. The list
 * is a module constant there, not an export, and importing the route would
 * pull the whole Worker in — so its keys and labels are read as text, and this
 * file holds only a reason per key that it can recognise when it is printed.
 */
const ADMIN_HQ = read('cloudflare-worker/src/routes/admin_hq.ts');
const NR_SOURCE = (() => {
  const start = ADMIN_HQ.indexOf('const HQ_ANALYTICS_NOT_RECORDED = [');
  assert.ok(start >= 0, 'admin_hq.ts no longer declares HQ_ANALYTICS_NOT_RECORDED');
  const end = ADMIN_HQ.indexOf('] as const;', start);
  assert.ok(end > start, 'HQ_ANALYTICS_NOT_RECORDED has no end');
  return ADMIN_HQ.slice(start, end);
})();
const SERVER_NR = [...NR_SOURCE.matchAll(/key: '([a-z_]+)',\s*label: '([^']+)'/g)]
  .map(([, key, label]) => ({ key, label, reason: `Reason for ${key}, as the server wrote it.` }));

function hqPayload(over = {}) {
  return {
    range: '8w',
    weeks: axis.weeks,
    current_week: axis.current,
    last_complete_week: axis.last_complete,
    as_of: '2026-09-23T12:00:00.000Z',
    basis: ACTIVE_ACCOUNT_BASIS,
    source: 'Analytics Engine: one row per metered request from every Worker, read here as counts.',
    registry: { readable: true, count: 3 },
    active_accounts: hqActive(),
    not_recorded: SERVER_NR,
    foot: 'Aggregates, never records.',
    ...over,
  };
}

/**
 * The branch's own line, as `loadBranchWeeklyActives` returns it for a log
 * whose first request was on 2026-08-11: the week before is blank because the
 * branch was not logging, and every week from its first on is a measurement.
 * The branch's read always knows its first week — its log has no retention.
 */
const BRANCH_VALUES = [null, 2, 3, 4, 5, 6, 7, 2];
const BRANCH_GAPS = ['before_series', null, null, null, null, null, null, null];
const BRANCH_STREAMS = [
  { stream: 'subscriptions', available: false, reason: 'No subscription on this branch reports a gross yet.' },
  { stream: 'licence_fees', available: false, reason: 'Licence fees are HQ’s ledger, not this branch’s.' },
];
/**
 * `active_accounts` as `GET /api/branch/analytics` assembles it from the
 * reader's values, gaps and first day: the last complete week's gap sentence
 * as `gap_reason`, the foot from `gapNotes`, the KPI from `weeklyKpi`.
 */
function branchActive(values, gaps, firstDay) {
  const firstWeek = firstDay ? dayAfter(firstDay, -((new Date(`${firstDay}T00:00:00Z`).getUTCDay() + 6) % 7)) : null;
  const lastGap = gaps[axis.weeks.length - 2];
  return {
    available: true,
    values,
    gaps,
    ...(lastGap ? { gap_reason: GAP_SENTENCES[lastGap] } : {}),
    gap_notes: gapNotes([gaps]),
    first_day: firstDay,
    first_week: firstWeek,
    kpi: weeklyKpi(axis, [{ values, gaps, first_week: firstWeek }]),
  };
}
function branchPayload(over = {}) {
  return {
    branch: 'fr',
    range: '8w',
    weeks: axis.weeks,
    current_week: axis.current,
    last_complete_week: axis.last_complete,
    as_of: '2026-09-23T12:00:00.000Z',
    basis: ACTIVE_ACCOUNT_BASIS,
    source: 'This branch\'s own request log (activity_logs).',
    active_accounts: branchActive(BRANCH_VALUES, BRANCH_GAPS, '2026-08-11'),
    seats: { available: true, used: 12, licensed: 40, basis: 'Seats used counts accounts by role.' },
    activation: { available: false, reason: 'No activation step is recorded as an event on this branch.' },
    decision_age: {
      queue: 'referrals', window_days: 30, available: true, median_hours: 30.5, n: 3,
      hq: { available: false, reason: 'HQ publishes no median of this, so there is nothing to set it against.' },
    },
    approval_age: [
      { key: 'lp_applications', label: 'LP applications', available: false,
        reason: '`reviewed_at` is rewritten on every status change.' },
      { key: 'cohort_applications', label: 'Cohort applications', available: false,
        reason: '`decided_at` is overwritten when an application is decided again.' },
      { key: 'referrals', label: 'Referrals', window_days: 30, available: true, median_hours: 30.5, n: 3 },
      { key: 'content_to_hq', label: 'Content to HQ', window_days: 30, available: true, median_hours: 50, n: 1,
        clock: 'HQ\'s: the answer is stamped where it is decided.' },
    ],
    revenue: {
      available: true, period: '2026-09', share_bps: 3500, keeps_bps: 6500, streams: BRANCH_STREAMS,
      note: 'A programme fee is not charged in the product, and a perk is a discount, not income.',
    },
    benchmark: {
      available: true, metric: 'active_accounts_week', week: axis.last_complete, median_value: 9,
      n_branches: 3, pushed_at: '2026-09-21 06:00:00', own_value: 7,
    },
    footer: 'Everything here is read from this branch\'s own database, plus the one median HQ pushed.',
    ...over,
  };
}

/**
 * Two cycles, newest first, as `GET /api/admin/cohort/timeline` sends them:
 * October's is materialised ahead and has not started; September's has, and
 * its four deadlines straddle the server's clock. Stamps are in the SQL format
 * the cohort tables write — UTC with no zone written down.
 */
const TIMELINE = {
  server_time: '2026-09-23T12:00:00.000Z',
  cycles: [
    { id: 2, year: 2026, month: 10, start_at: '2026-10-01 04:00:00', end_at: '2026-11-01 04:00:00',
      participant_count: 0, status_counts: [],
      windows: [1, 2, 3, 4].map((w) => ({ week_number: w, deadline_at: `2026-10-${String(1 + 7 * w).padStart(2, '0')} 04:00:00` })) },
    { id: 1, year: 2026, month: 9, start_at: '2026-09-01 04:00:00', end_at: '2026-10-01 04:00:00',
      participant_count: 9,
      status_counts: [
        { week_number: 1, status: 'passed', n: 7 }, { week_number: 1, status: 'failed', n: 2 },
        { week_number: 2, status: 'passed', n: 5 }, { week_number: 2, status: 'grace', n: 1 },
      ],
      // Out of order on purpose: the card sorts by week, it does not trust the payload's order.
      windows: [
        { week_number: 3, deadline_at: '2026-09-22 04:00:00' },
        { week_number: 1, deadline_at: '2026-09-08 04:00:00' },
        { week_number: 4, deadline_at: '2026-09-29 04:00:00' },
        { week_number: 2, deadline_at: '2026-09-15 04:00:00' },
      ] },
  ],
};

// ── The worker's vocabulary ────────────────────────────────────────────────

test('the range pills carry the worker\'s own keys, in its order', () => {
  assert.deepEqual(RANGE_PILLS.map((p) => p.key), Object.keys(ANALYTICS_RANGES));
  assert.equal(rangeLabel('quarter'), 'Quarter');
  assert.equal(rangeLabel('fortnight'), null, 'a key the worker does not know has no label');
  assert.equal(signed(4), '+4');
  assert.equal(signed(-2), '−2');
  assert.equal(signed(0), '±0');
  assert.equal(signed(null), null, 'no delta is not a delta of nothing');
});

test('the fixtures are the worker\'s own weeks: eight Mondays, the newest the current one', () => {
  assert.equal(axis.weeks.length, 8);
  assert.equal(axis.current, '2026-09-21');
  assert.equal(axis.last_complete, '2026-09-14');
  assert.equal(weekLabel(axis.last_complete), '14 Sep');

  // The fold gives back every week the lines declare, so each fixture means what it says.
  assert.deepEqual(HQ_SERIES.map((s) => s.values), HQ_LINES.map((l) => l.counts));
  const by = Object.fromEntries(HQ_SERIES.map((s) => [s.code, s]));
  assert.equal(by.fr.first_week, '2026-08-10', 'France began inside the window, where the read can see it');
  assert.equal(by.hq.first_week, null, 'HQ\'s line reaches the store\'s first row, so where it began is not known');
  assert.deepEqual(by.de.gaps, Array(8).fill('no_rows'));
  assert.equal(by.de.gap_reason, GAP_SENTENCES.no_rows, 'a line blank in its last complete week carries that week\'s sentence');
  assert.equal(by.fr.gap_reason, undefined, 'a line with a figure that week carries none');
  assert.equal(by.xx.gap_reason, undefined);
});

// ── The geometry ───────────────────────────────────────────────────────────

test('a null week is never plotted and never bridged', () => {
  const lone = weeklyChartGeometry({ weeks: ['a', 'b', 'c'], series: [{ key: 's', values: [1, null, 2] }] }).series[0];
  assert.equal(lone.lines.length, 0, 'two weeks either side of a gap are not a line');
  assert.deepEqual(lone.dots.map((d) => d.i), [0], 'the lone first week is a dot');
  assert.equal(lone.last.value, 2);

  const geo = weeklyChartGeometry({ weeks: ['a', 'b', 'c', 'd', 'e'], series: [{ key: 's', values: [1, 2, null, 3, 4] }] });
  const s = geo.series[0];
  assert.equal(s.lines.length, 2, 'the line breaks at the gap into two runs');
  const gapX = String(Number(((4 + (2 / 4) * (534 - 4 - 8))).toFixed(1)));
  for (const line of s.lines) {
    assert.equal(line.split(' ').length, 2, 'each run holds its own two weeks and no more');
    assert.ok(!line.split(' ').some((pt) => pt.startsWith(`${gapX},`)), 'no point sits on the missing week');
  }
  assert.equal(s.dots.length, 0);
});

test('only the current week\'s point is drawn as a count so far', () => {
  const ends = weeklyChartGeometry({ weeks: ['a', 'b', 'c', 'd'], series: [{ key: 's', values: [1, 2, 3, 4] }] });
  assert.equal(ends.series[0].last.partial, true, 'the newest week has not ended');
  const early = weeklyChartGeometry({ weeks: ['a', 'b', 'c', 'd'], series: [{ key: 's', values: [1, 2, 3, null] }] });
  assert.equal(early.series[0].last.partial, false, 'a line that stops before this week ends on a finished week');
});

test('the y axis starts at zero, and the median sits at its true value on the line\'s scale', () => {
  const geo = weeklyChartGeometry({ weeks: ['a', 'b', 'c'], series: [{ key: 's', values: [40, 42, 44] }] });
  assert.equal(geo.ticks[0].value, 0, 'a count axis begins at nobody');
  assert.equal(geo.ticks[0].y, geo.plot.bottom);

  const withMedian = weeklyChartGeometry({ weeks: ['a', 'b', 'c'], series: [{ key: 's', values: [2, 3, 4] }], median: 20 });
  const reference = weeklyChartGeometry({ weeks: ['a', 'b', 'c'], series: [{ key: 's', values: [20, 20, 20] }] });
  assert.ok(withMedian.yMax >= 20, 'the scale widens to hold the median');
  assert.equal(withMedian.median.y, reference.series[0].last.y, 'the rule is where a line at that value would be');

  const without = weeklyChartGeometry({ weeks: ['a', 'b', 'c'], series: [{ key: 's', values: [2, 3, 4] }], median: null });
  const plain = weeklyChartGeometry({ weeks: ['a', 'b', 'c'], series: [{ key: 's', values: [2, 3, 4] }] });
  assert.equal(without.median, null, 'no median draws no rule');
  assert.equal(without.yMax, plain.yMax, 'and changes nothing about the scale');
});

// ── The chart component ────────────────────────────────────────────────────

test('the chart dashes the line it is told to, hollows the current week, and draws a median only when given one', () => {
  const series = [
    { key: 'es', values: [2, 2, 3, 3], dashed: true, colorClass: 'text-amber-700 dark:text-amber-300' },
    { key: 'fr', values: [1, 2, 3, 4], dashed: false, colorClass: 'text-sky-700 dark:text-sky-300' },
  ];
  const markup = html(WeeklyLineChart, { weeks: ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'], series, testId: 't' });
  const es = slice(markup, 'data-series="es"', '</g>');
  const fr = slice(markup, 'data-series="fr"', '</g>');
  assert.match(es, /data-dashed="true"/);
  assert.match(es, /stroke-dasharray="5 4"/);
  assert.match(fr, /data-dashed="false"/);
  assert.doesNotMatch(fr, /stroke-dasharray/);
  assert.match(fr, /data-partial="true"/);
  assert.match(slice(fr, 'data-partial="true"', '</circle>'), /fill="none"/, 'the week so far is hollow');
  assert.doesNotMatch(markup, /data-testid="t-median"/, 'no median was given, so none is drawn');

  const withMedian = html(WeeklyLineChart, { weeks: ['a', 'b'], series: [{ key: 's', values: [1, 2] }], median: 3, testId: 't' });
  assert.match(withMedian, /data-testid="t-median"/);

  const empty = html(WeeklyLineChart, {
    weeks: ['a', 'b'], series: [{ key: 's', values: [null, null] }], emptyNote: 'Nothing recorded here.', testId: 't',
  });
  assert.match(empty, /data-testid="t-empty"/);
  assert.doesNotMatch(empty, /<polyline|<circle/, 'an empty chart draws no mark at all — not a line along the axis');
});

// ── H15 ────────────────────────────────────────────────────────────────────

test('H15 · a suspended branch is flagged and dashed; its line continues', () => {
  const [hq, fr, es, , xx] = HQ_SERIES;
  assert.equal(isSuspended(es), true);
  assert.equal(isSuspended(fr), false);
  assert.equal(seriesFlag(es), 'suspended since 2026-09-01');
  assert.equal(seriesFlag({ status: 'suspended' }), 'suspended', 'a suspension with no date still says so');
  assert.equal(seriesFlag(xx), 'unregistered');
  assert.equal(seriesFlag(fr), null);
  assert.notEqual(seriesColor(hq, 0), seriesColor(fr, 1), 'HQ\'s own line wears its own colour');

  const markup = html(ActiveAccountsCard, { data: hqPayload() });
  assert.match(slice(markup, 'data-series="es"', '</g>'), /data-dashed="true"/);
  assert.match(slice(markup, 'data-series="fr"', '</g>'), /data-dashed="false"/);
  assert.match(slice(markup, 'data-series="hq"', '</g>'), /data-dashed="false"/);
  // Iberia's line runs to the current week: suspension freezes writes, not sign-ins.
  assert.match(slice(markup, 'data-series="es"', '</g>'), /data-partial="true"/);
});

test('H15 · a line with no figure that week says why, in the server\'s words — never a zero', () => {
  const markup = html(SeriesLegend, { series: HQ_SERIES, weeks: axis.weeks });
  const de = renderedText(slice(markup, 'data-series="de"', '</li>'));
  assert.match(de, /Not recorded/);
  assert.ok(de.includes(GAP_SENTENCES.no_rows), 'the gap reason is printed, not left in a tooltip');
  assert.doesNotMatch(de, /Axal VC DACH\s*0/, 'no line is drawn at nobody');
  const fr = renderedText(slice(markup, 'data-series="fr"', '</li>'));
  assert.match(fr, /Axal VC France\s*7/, 'the legend figure is the last complete week\'s');
  const xx = renderedText(slice(markup, 'data-series="xx"', '</li>'));
  assert.match(xx, /unregistered/);
  assert.ok(xx.includes('the deployment registry has no row for it'));

  const chart = html(ActiveAccountsCard, { data: hqPayload() });
  const deLine = slice(chart, 'data-series="de"', '</g>');
  assert.doesNotMatch(deLine, /<polyline|<circle/, 'a branch with no rows draws nothing, not a line at zero');
});

test('H15 · an unread metrics store draws no line and says why', () => {
  const reason = 'The metrics store could not be read: the SQL API answered 503.';
  const markup = html(ActiveAccountsCard, { data: hqPayload({ active_accounts: { available: false, reason } }) });
  assert.match(markup, /data-testid="h15-active-unavailable"/);
  assert.ok(renderedText(markup).includes(reason));
  assert.doesNotMatch(markup, /data-testid="h15-plot/, 'no chart is drawn over an unread store');
  assert.doesNotMatch(markup, /data-testid="h15-legend"/);
});

test('H15 · the chart\'s notes appear exactly when the read calls for them', () => {
  const plain = html(ActiveAccountsCard, { data: hqPayload() });
  assert.match(plain, /data-testid="h15-partial-week"/);
  assert.doesNotMatch(plain, /data-testid="h15-sampled"|data-testid="h15-registry-unreadable"/);
  assert.deepEqual(attrs(plain, 'data-gap'), ['no_rows', 'before_series'],
    'every reason a point is blank, said once each, in the server\'s order');
  for (const n of hqPayload().active_accounts.gap_notes) {
    assert.ok(renderedText(slice(plain, `data-gap="${n.gap}"`, '</p>')).includes(n.sentence), `${n.gap} is printed`);
  }

  const noisy = html(ActiveAccountsCard, {
    data: hqPayload({
      active_accounts: {
        ...hqActive({ capDay: axis.weeks[1] }), sampled: true, sampled_note: 'Sampled, so each count is a floor.',
      },
      registry: { readable: false, reason: 'The deployment registry could not be read.' },
    }),
  });
  assert.match(noisy, /data-testid="h15-sampled"/);
  assert.equal(attrs(noisy, 'data-gap')[0], 'cap', 'the cap is named first: it is why the oldest weeks are blank');
  const cap = renderedText(slice(noisy, 'data-gap="cap"', '</p>'));
  assert.ok(cap.includes(GAP_SENTENCES.cap));
  assert.ok(cap.includes('The cap is 50000 rows.'), 'the cap\'s size rides on its own note');
  assert.equal(count(renderedText(noisy), GAP_SENTENCES.cap), 1, 'a capped read is described once');
  assert.doesNotMatch(noisy, /h15-capped/, 'D210\'s separate cap paragraph is not drawn beside the note');
  assert.match(noisy, /data-testid="h15-registry-unreadable"/);
});

test('H15 · the KPI row: one figure with its week and its lines, three absences with the server\'s reasons', () => {
  const data = hqPayload();
  const kpi = data.active_accounts.kpi;
  assert.equal(kpi.value, 26, 'hq 11 + fr 7 + es 5 + xx 3 for the week of 14 Sep');
  assert.equal(kpi.delta, null, 'xx was not recorded four weeks earlier, so the populations differ');
  const markup = html(HqKpis, { data });
  const active = renderedText(slice(markup, 'data-testid="h15-kpi-active"', 'lines recorded'));
  assert.equal(kpiValue(markup, 'h15-kpi-active'), '26');
  assert.match(active, /Week of 14 Sep · 4 of 5 lines recorded/);
  assert.match(markup, /data-testid="h15-kpi-delta-reason"/, 'the missing delta says why');
  for (const [key, id] of [['activation', 'activation'], ['approval_age', 'approval-age'], ['token_spend', 'token-spend']]) {
    const tile = slice(markup, `data-testid="h15-kpi-${id}"`, 'below.');
    assert.ok(tile.includes(`title="Reason for ${key}, as the server wrote it."`), `${key}'s reason rides on its figure`);
    assert.equal(kpiValue(markup, `h15-kpi-${id}`), 'Not recorded', `${key}'s figure itself reads Not recorded`);
    assert.equal(attrs(tile, 'data-state')[0], 'not_recorded');
  }

  const comparable = HQ_SERIES.filter((s) => s.code !== 'xx');
  const stable = hqPayload({
    active_accounts: { ...data.active_accounts, series: comparable, kpi: weeklyKpi(axis, comparable) },
  });
  const delta = renderedText(html(HqKpis, { data: stable }));
  assert.match(delta, /\+10 vs 17 Aug/, 'the same lines four weeks apart carry a delta');
  assert.doesNotMatch(html(HqKpis, { data: stable }), /h15-kpi-delta-reason/);

  const unread = html(HqKpis, { data: hqPayload({ active_accounts: { available: false, reason: 'Store unread.' } }) });
  assert.match(slice(unread, 'data-testid="h15-kpi-active"', '</div></div>'), /title="Store unread\."/);
});

test('H15 · what the rail reads back is only what loaded; a failed read gives no line', () => {
  assert.deepEqual(hqAnalyticsCoverage(null), []);
  assert.deepEqual(hqAnalyticsCoverage(HQ_UNAVAILABLE), []);
  const lines = hqAnalyticsCoverage(hqPayload());
  assert.ok(lines.includes('Active accounts, week of 2026-09-14: 26 across 4 of 5 lines'));
  assert.ok(lines.includes('5 lines drawn over 8 weeks'));
  assert.ok(lines.includes('3 branches in the registry'));
  const unreadRegistry = hqAnalyticsCoverage(hqPayload({ registry: { readable: false, reason: 'x' } }));
  assert.ok(!unreadRegistry.some((l) => l.includes('in the registry')), 'an unread registry is not counted');
});

test('H15 · the rail\'s four absences are exactly the four the server names', () => {
  assert.equal(SERVER_NR.length, 4, 'admin_hq.ts names four absences');
  const PAGE = codeOnly(read('frontend/src/pages/hq/HqAnalyticsPage.jsx'));
  assert.equal(count(PAGE, 'unavailable={['), 1, 'the rail\'s absences are one literal array, not a variable');
  const at = PAGE.indexOf('unavailable={[');
  const literal = PAGE.slice(at, PAGE.indexOf(']}', at));
  const keys = [...literal.matchAll(/notRecordedReason\(data, '([a-z_]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), SERVER_NR.map((n) => n.key).sort());

  assert.equal(notRecordedReason(hqPayload(), 'token_spend'), 'Reason for token_spend, as the server wrote it.');
  assert.match(notRecordedReason(null, 'activation'), /Reading/);
  assert.match(notRecordedReason(HQ_UNAVAILABLE, 'activation'), /could not be read/);
});

test('H15 · under the view-as overlay the page says it is not narrowed; without it, says nothing', () => {
  const page = (branch) => renderToStaticMarkup(createElement(MemoryRouter, null, branch
    ? createElement(ViewAsBranchContext.Provider, { value: { branch, setBranch() {} } }, createElement(HqAnalyticsPage))
    : createElement(HqAnalyticsPage)));
  const under = page('fr');
  assert.match(under, /data-testid="hq-analytics-page"/);
  assert.match(under, /data-testid="hq-analytics-view-as"/);
  assert.ok(renderedText(under).includes('Viewing as fr does not narrow this page'));
  assert.match(renderedText(under), /Reading the analytics/);
  assert.doesNotMatch(page(null), /hq-analytics-view-as/);
});

// ── S15 ────────────────────────────────────────────────────────────────────

test('S15 · the median rule names its week, its n and when HQ computed it', () => {
  assert.equal(pushedLabel('2026-09-21 06:00:00'), '2026-09-21 06:00 UTC', 'a SQL stamp is UTC');
  assert.equal(pushedLabel('2026-09-21T06:00:00.000Z'), '2026-09-21 06:00 UTC');
  assert.equal(pushedLabel('not a time'), null);

  const markup = html(BranchChartCard, { data: branchPayload() });
  assert.match(markup, /data-testid="s15-plot-median"/, 'the rule is drawn');
  const note = renderedText(slice(markup, 'data-testid="s15-median-note"', '</p>'));
  assert.ok(note.includes('the week of 14 Sep'));
  assert.ok(note.includes('9 across 3 branches'));
  assert.ok(note.includes('computed 2026-09-21 06:00 UTC'));
  assert.ok(note.includes('not a median of every week'));
  assert.ok(note.includes('You, that week: 7.'));
  assert.deepEqual(attrs(markup, 'data-gap'), ['before_series'], 'the week before the log began is the only blank');
  assert.ok(renderedText(slice(markup, 'data-gap="before_series"', '</p>')).includes(GAP_SENTENCES.before_series),
    'the gap before the log began is said');
  assert.match(markup, /data-testid="s15-source"/);
});

test('S15 · a withheld median draws no rule, and a missing own figure says why', () => {
  const withheld = 'HQ has published no median of active accounts yet.';
  const markup = html(BranchChartCard, { data: branchPayload({ benchmark: { available: false, reason: withheld } }) });
  assert.doesNotMatch(markup, /s15-plot-median/, 'a withheld median is not a rule at zero');
  assert.ok(renderedText(slice(markup, 'data-testid="s15-median-absent"', '</p>')).includes(withheld));

  const own = 'This branch has no recorded value for the week of 2026-09-14 on this chart.';
  const bm = { ...branchPayload().benchmark, own_value: null, own_reason: own };
  const ownless = html(BranchChartCard, { data: branchPayload({ benchmark: bm }) });
  assert.ok(renderedText(slice(ownless, 'data-testid="s15-median-own"', '</span>')).includes(own));

  const unread = html(BranchChartCard, {
    data: branchPayload({ active_accounts: { available: false, reason: 'The request log could not be read.' } }),
  });
  assert.match(unread, /data-testid="s15-active-unavailable"/);
  assert.doesNotMatch(unread, /data-testid="s15-plot/);
});

test('S15 · the approval-age bands switch above a day and above two', () => {
  assert.equal(ageTone(24), null);
  assert.equal(ageTone(24.1), 'slow');
  assert.equal(ageTone(48), 'slow');
  assert.equal(ageTone(48.1), 'late');
  assert.equal(ageTone(Number.NaN), null);
  assert.equal(ageTone('30'), null, 'a string is not an age');
  assert.equal(ageTone(null), null);

  const rows = [...branchPayload().approval_age, {
    key: 'quick', label: 'Quick', window_days: 30, available: true, median_hours: 10, n: 2,
  }, {
    key: 'idle', label: 'Idle', window_days: 30, available: true, median_hours: null, n: 0,
    reason: 'Nothing was decided in the last 30 days.',
  }];
  const markup = html(ApprovalAgeList, { rows });
  const tone = (key) => attrs(slice(markup, `data-queue="${key}"`, '</li>'), 'data-tone');
  assert.deepEqual(tone('referrals'), ['slow']);
  assert.deepEqual(tone('content_to_hq'), ['late']);
  assert.deepEqual(tone('quick'), ['on_time']);
  assert.deepEqual(tone('idle'), [], 'no median, no band');
  assert.match(renderedText(slice(markup, 'data-queue="idle"', '</li>')), /none decided/);
  for (const key of ['lp_applications', 'cohort_applications']) {
    const row = renderedText(slice(markup, `data-queue="${key}"`, '</li>'));
    assert.match(row, /Not recorded/);
    assert.ok(row.includes(rows.find((r) => r.key === key).reason), `${key}'s reason is printed`);
  }
  assert.ok(renderedText(slice(markup, 'data-testid="s15-age-clock"', '</p>'))
    .includes('The clock is HQ\'s: the answer is stamped where it is decided.'));
  assert.match(renderedText(slice(markup, 'data-queue="content_to_hq"', '</li>')), /over 1 decision in the last 30 days/);
});

test('S15 · the week gates read the server\'s clock: counted, counted, no outcome, not yet due', () => {
  const markup = html(WeekGates, { timeline: TIMELINE, onRetry() {} });
  assert.deepEqual(attrs(markup, 'data-state'), ['counted', 'counted', 'no_outcome', 'not_yet_due']);
  const gates = renderedText(markup);
  assert.match(gates, /September 2026 · 9 participants today/, 'the started cycle, not next month\'s');
  // Midnight in New York, which is 04:00 UTC. The month is matched as either
  // spelling because ICU's en-GB data changed "Sep" to "Sept" between releases,
  // and the runner's ICU is not what this test is about.
  assert.match(gates, /Week 1closes 8 Sept?, 00:00/, 'the deadline is the programme\'s, in its own zone');
  assert.match(gates, /7 passed · 2 failed/);
  assert.match(gates, /5 passed · 1 in grace/);
  assert.match(gates, /no outcome recorded/);
  assert.match(gates, /not yet due/);
  assert.match(gates, /America\/New_York/);
  assert.match(gates, /Counts, never a rate/);

  const unread = renderedText(html(WeekGates, { timeline: BRANCH_UNAVAILABLE, onRetry() {} }));
  assert.match(unread, /the cohort timeline could not be read\. This is not a claim that no week has an outcome\./);
  assert.match(unread, /Retry/);

  const future = { server_time: TIMELINE.server_time, cycles: [TIMELINE.cycles[0]] };
  assert.match(html(WeekGates, { timeline: future, onRetry() {} }), /data-testid="s15-gates-none"/);
  assert.match(renderedText(html(WeekGates, { timeline: null, onRetry() {} })), /Reading the cohort timeline/);
});

test('S15 · revenue states the rate and every stream\'s reason, and never an amount it lacks', () => {
  const markup = html(RevenueCard, { revenue: branchPayload().revenue });
  assert.ok(renderedText(slice(markup, 'data-testid="s15-revenue-share"', '</p>'))
    .includes('HQ’s share 35% · you keep 65%'));
  for (const s of BRANCH_STREAMS) {
    const row = renderedText(slice(markup, `data-stream="${s.stream}"`, '</li>'));
    assert.match(row, /Not recorded/);
    assert.ok(row.includes(s.reason));
  }
  assert.match(renderedText(markup), /Subscriptions/);
  assert.doesNotMatch(renderedText(markup), /€|EUR/, 'no stream reported an amount, so none is drawn');

  const unread = html(RevenueCard, { revenue: { available: false, reason: 'The revenue summary could not be built.' } });
  assert.match(unread, /data-testid="s15-revenue"/);
  assert.ok(renderedText(unread).includes('The revenue summary could not be built.'));
});

test('S15 · the KPI row: the week and its delta, a stated no-decision, and seats as a pair', () => {
  const markup = html(BranchKpis, { data: branchPayload() });
  const active = renderedText(slice(markup, 'data-testid="s15-kpi-active"', 'Week of 14 Sep'));
  assert.equal(kpiValue(markup, 's15-kpi-active'), '7');
  assert.match(active, /\+4 vs 17 Aug/);
  assert.match(renderedText(slice(markup, 'data-testid="s15-kpi-decision-age"', 'Against HQ')), /30\.5h/);
  assert.ok(renderedText(slice(markup, 'data-testid="s15-kpi-decision-hq"', '</span>'))
    .includes('HQ publishes no median of this'));
  assert.match(renderedText(slice(markup, 'data-testid="s15-kpi-seats"', 'by role.')), /12 of 40/);

  const none = branchPayload({
    decision_age: { ...branchPayload().decision_age, median_hours: null, n: 0,
      reason: 'No referral was decided in the last 30 days.' },
  });
  const noneText = renderedText(html(BranchKpis, { data: none }));
  assert.match(noneText, /None decided/);
  assert.match(noneText, /No referral was decided in the last 30 days\./);

  // The compare week falls in the gap before the log began, so the delta is refused with its reason.
  const late = [null, null, null, 4, 5, 6, 7, 2];
  const lateGaps = ['before_series', 'before_series', 'before_series', null, null, null, null, null];
  const gapped = branchPayload({ active_accounts: branchActive(late, lateGaps, '2026-08-25') });
  const gappedMarkup = html(BranchKpis, { data: gapped });
  assert.match(gappedMarkup, /data-testid="s15-kpi-delta-reason"/);
  assert.doesNotMatch(renderedText(gappedMarkup), / vs 17 Aug/, 'no delta across the gap');
});

test('S15 · the page frames itself in the branch rail and links back to Insights', () => {
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(BranchAnalytics, { user: { role: 'admin', branch: { code: 'fr', name: 'Axal VC France' } } })));
  assert.match(markup, /data-testid="branch-analytics-page"/);
  assert.match(markup, /href="\/branch\/insights"/);
  const words = renderedText(markup);
  assert.match(words, /Reading this territory’s analytics/);
  assert.match(words, /Reading the cohort timeline/, 'the timeline is its own read with its own state');
});

// ── Time ───────────────────────────────────────────────────────────────────

test('a SQL-format deadline is read as UTC whatever zone the reader is in', () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Kolkata';
    // HQ's computed-at stamp is SQL format too; read as local it would be 5h30 early.
    assert.equal(pushedLabel('2026-09-21 06:00:00'), '2026-09-21 06:00 UTC');
    assert.equal(inZone('2026-10-05 04:00:00', 'UTC'), '5 Oct, 04:00');
    assert.equal(inZone('2026-10-05 04:00:00', 'UTC'), inZone('2026-10-05T04:00:00Z', 'UTC'));
    // A cycle's first day, two hours into it in UTC: read as Kolkata time it
    // would be the evening before, and the calendar would print September.
    assert.equal(dateInZone('2026-10-01 02:00:00', 'UTC'), '1 Oct 2026');
    assert.equal(dateInZone('2026-10-01 02:00:00', 'UTC'), dateInZone('2026-10-01T02:00:00Z', 'UTC'));
    assert.match(renderedText(html(WeekGates, { timeline: TIMELINE, onRetry() {} })), /Week 1closes 8 Sept?, 00:00/);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

// ── Reach ──────────────────────────────────────────────────────────────────

test('both pages are routed, linked from where their canvases say, and lit under their own rows', () => {
  const APP = codeOnly(read('frontend/src/App.jsx'));
  assert.ok(APP.includes(`<Route path="/admin/analytics" element={guard(['admin'], hqOnly(<HqAnalyticsPage />))} />`));
  assert.ok(APP.includes(`<Route path="/branch/insights/analytics" element={guard(['admin'], <BranchAnalytics user={user} />)} />`));
  assert.ok(codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx')).includes('<Link to="/admin/analytics"'));
  assert.match(codeOnly(read('frontend/src/pages/branch/BranchInsights.jsx')), /<Link\s+to="\/branch\/insights\/analytics"/);

  const row = (group, to) => SIDEBAR_GROUPS[group].flatMap((g) => g.items).find((i) => i.to === to);
  assert.ok(row('super_admin', '/hq').match.includes('/admin/analytics'), 'H15 lights HQ Home');
  assert.ok(row('branch_admin', '/branch/insights').match.includes('/branch/insights'), 'S15 lights Insights');
});

// ── Honesty and voice ──────────────────────────────────────────────────────

const PAGES = [
  'frontend/src/pages/hq/HqAnalyticsPage.jsx',
  'frontend/src/pages/branch/BranchAnalytics.jsx',
  'frontend/src/components/AnalyticsParts.jsx',
  'frontend/src/components/WeeklyLineChart.jsx',
  'frontend/src/lib/weeklyChart.js',
  'frontend/src/lib/cohortTimeline.js',
];

test('no figure falls back to zero anywhere on either page', () => {
  for (const f of PAGES) {
    assert.doesNotMatch(codeOnly(read(f)), /(?:\|\||\?\?)\s*0(?![\d.])/, `${f} falls back to zero`);
  }
});

test('neither page uses a word the product does not, in its source or its render', () => {
  const OFF = /\badvi[cs]\w*|\brecommend\w*|\bfiduciar\w*/i;
  for (const f of PAGES) assert.doesNotMatch(read(f), OFF, f);
  const renders = [
    html(HqKpis, { data: hqPayload() }), html(ActiveAccountsCard, { data: hqPayload() }),
    html(BranchKpis, { data: branchPayload() }), html(BranchChartCard, { data: branchPayload() }),
    html(ApprovalAgeList, { rows: branchPayload().approval_age }), html(WeekGates, { timeline: TIMELINE, onRetry() {} }),
    html(RevenueCard, { revenue: branchPayload().revenue }),
  ];
  for (const r of renders) assert.doesNotMatch(renderedText(r), OFF);
});

test('no account identifier reaches either page', () => {
  for (const f of PAGES.slice(0, 2)) {
    const src = codeOnly(read(f));
    assert.doesNotMatch(src, /\.email\b/, `${f} reads an email`);
    assert.doesNotMatch(src, /\buser_id\b/, `${f} reads a user id`);
  }
});
