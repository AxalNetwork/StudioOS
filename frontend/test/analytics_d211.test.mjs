/**
 * D211 — what the review of D210 found on the two Analytics pages, pinned.
 *
 * Each block below is a claim D210's pages made that was not true, or a state
 * they drew as another state:
 *
 *  - A FAILED READ WAS DRAWN AS "NOT RECORDED". The server now marks a read that
 *    failed `unreadable`, and the pages draw Unreadable — with a retry where a
 *    retry can answer it — while a store this Worker cannot reach keeps "Not
 *    recorded" and offers no retry, because trying again cannot change it.
 *  - THE LEGEND NAMED THE WRONG WEEK'S REASON, and the chart's foot named none
 *    of the others. Every blank point's reason is now said once, keyed by what
 *    it is; the legend prints a reason only beside a figure that is missing.
 *  - A COUNT NOBODY COULD READ BECAME "0 failed". A week gate's tally holding
 *    an unreadable count says so, on S15 and on S4, and never adds up a zero.
 *  - THE MEDIAN LOST ITS CAPTION when the branch's own log could not be read,
 *    and the branch's own figure beside it was not read by the median's rule.
 *  - THE REVENUE RATE'S ABSENCE WAS THE PAGE'S OWN SENTENCE, false for a branch
 *    whose licence copy had not arrived. It is the server's now.
 *  - THE RAIL SAID "COULD NOT BE READ" for a payload that answered with nothing
 *    to read back, and a ninth branch drew in the first branch's colour.
 *  - HQ's overlay read `backlog` as a number; it is `{ count, oldest_at }`.
 *  - `hover:bg-axal-ground` flashed a light ground in dark mode — latent inside
 *    the app shell (see the last test), visible outside it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  UNAVAILABLE as HQ_UNAVAILABLE, coloursRepeat, hqCoverageNote, SeriesLegend, ActiveAccountsCard, HqKpis,
} from '../src/pages/hq/HqAnalyticsPage.jsx';
import {
  UNAVAILABLE as BRANCH_UNAVAILABLE, branchCoverageNote, BranchKpis, BranchChartCard, MedianNote,
  ApprovalAgeList, gateSentence, gatesSub, WeekGates, RevenueCard,
} from '../src/pages/branch/BranchAnalytics.jsx';
import { KpiTile } from '../src/components/AnalyticsParts.jsx';
import {
  statusesByWeek, tallyReadable, weekOutcome, cycleEnded,
} from '../src/lib/cohortTimeline.js';
import { branchCodeFromHost } from '../src/lib/branchHost.js';
import {
  ANALYTICS_RANGES, weekAxis, weeklyKpi, GAP_ORDER, GAP_SENTENCES, gapNotes, ACTIVE_ACCOUNT_BASIS,
} from '../../cloudflare-worker/src/services/activeAccounts.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const html = (el, props) => renderToStaticMarkup(createElement(el, props));

/** The markup from the element carrying `attr` to the first `close` after it. */
function slice(markup, attr, close) {
  const at = markup.indexOf(attr);
  assert.ok(at >= 0, `missing ${attr}`);
  const open = markup.lastIndexOf('<', at);
  const end = markup.indexOf(close, at);
  assert.ok(end > at, `no ${close} after ${attr}`);
  return markup.slice(open, end + close.length);
}
/** Every value of `name="…"`, in order. */
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
/** What a KPI tile's figure reads: its value slot alone. */
function kpiValue(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `missing ${id}`);
  const value = markup.indexOf('text-xl', at);
  return renderedText(markup.slice(markup.lastIndexOf('<', value), markup.indexOf('</span>', value) + '</span>'.length));
}
/** The state a card or row declares on its own opening tag. */
function stateOf(markup, attr) {
  const at = markup.indexOf(attr);
  assert.ok(at >= 0, `missing ${attr}`);
  const tag = markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at));
  const m = / data-state="([a-z_]+)"/.exec(tag);
  return m ? m[1] : null;
}
/** Whether any button in `markup` reads Retry — the offer, not the word in a sentence. */
function hasRetry(markup) {
  let at = markup.indexOf('<button');
  while (at >= 0) {
    const end = markup.indexOf('</button>', at);
    if (end < 0) return false;
    if (renderedText(markup.slice(at, end)).includes('Retry')) return true;
    at = markup.indexOf('<button', end);
  }
  return false;
}

// ── The worker's weeks, and a branch payload in the shape its route sends ──

const axis = weekAxis('2026-09-23T12:00:00Z', ANALYTICS_RANGES['8w']);
const VALUES = [null, 2, 3, 4, 5, 6, 7, 2];
const GAPS = ['before_series', null, null, null, null, null, null, null];
const BRANCH_ACTIVE = {
  available: true,
  values: VALUES,
  gaps: GAPS,
  gap_notes: gapNotes([GAPS]),
  first_day: '2026-08-11',
  first_week: '2026-08-10',
  kpi: weeklyKpi(axis, [{ values: VALUES, gaps: GAPS, first_week: '2026-08-10' }]),
};
const BENCHMARK = {
  available: true, metric: 'active_accounts_week', week: axis.last_complete, median_value: 9,
  n_branches: 3, pushed_at: '2026-09-21 06:00:00', own_value: 7,
};
function branchPayload(over = {}) {
  return {
    branch: 'fr',
    range: '8w',
    weeks: axis.weeks,
    current_week: axis.current,
    last_complete_week: axis.last_complete,
    basis: ACTIVE_ACCOUNT_BASIS,
    source: 'This branch\'s own request log (activity_logs).',
    active_accounts: BRANCH_ACTIVE,
    seats: { available: true, used: 12, licensed: 40, basis: 'Seats used counts accounts by role.' },
    activation: { available: false, reason: 'No activation step is recorded as an event on this branch.' },
    decision_age: {
      queue: 'referrals', window_days: 30, available: true, median_hours: 30.5, n: 3,
      hq: { available: false, reason: 'HQ publishes no median of this.' },
    },
    approval_age: [],
    revenue: { available: true, period: '2026-09', share_bps: 3500, keeps_bps: 6500, streams: [] },
    benchmark: BENCHMARK,
    footer: 'Everything here is read from this branch\'s own database.',
    ...over,
  };
}

/** An HQ line in the route's shape; `gaps` defaults to none. */
function line(code, values, extra = {}) {
  return {
    code, label: `Line ${code}`, kind: 'branch', status: 'active', suspended_at: null,
    values, gaps: values.map(() => null), first_day: null, first_week: null, ...extra,
  };
}
function hqPayload(active, over = {}) {
  return {
    range: '8w', weeks: axis.weeks, current_week: axis.current, last_complete_week: axis.last_complete,
    basis: ACTIVE_ACCOUNT_BASIS, registry: { readable: true, count: 1 }, active_accounts: active,
    not_recorded: [], foot: 'Aggregates, never records.', ...over,
  };
}

// ── A failed read is Unreadable; an unreachable store is Not recorded ──────

test('a KPI tile draws three states, and a failed read reads Unreadable, not Not recorded', () => {
  const recorded = html(KpiTile, { label: 'L', value: 7, testId: 't' });
  assert.equal(stateOf(recorded, 'data-testid="t"'), 'recorded');
  assert.equal(kpiValue(recorded, 't'), '7');

  const nothing = html(KpiTile, { label: 'L', value: null, reason: 'Nothing is kept for this.', testId: 't' });
  assert.equal(stateOf(nothing, 'data-testid="t"'), 'not_recorded');
  assert.equal(kpiValue(nothing, 't'), 'Not recorded');

  const failed = html(KpiTile, { label: 'L', value: null, reason: 'The store answered 503.', unreadable: true, testId: 't' });
  assert.equal(stateOf(failed, 'data-testid="t"'), 'unreadable');
  assert.equal(kpiValue(failed, 't'), 'Unreadable');
  assert.ok(failed.includes('title="The store answered 503."'), 'the reason rides on the figure');

  // A value of 0 is a figure, and `unreadable` cannot turn a figure into an absence.
  const zero = html(KpiTile, { label: 'L', value: 0, unreadable: true, testId: 't' });
  assert.equal(stateOf(zero, 'data-testid="t"'), 'recorded');
  assert.equal(kpiValue(zero, 't'), '0');
});

test('H15 · a failed metrics read is Unreadable with a retry; a store this Worker cannot reach offers none', () => {
  const failed = html(ActiveAccountsCard, {
    data: hqPayload({ available: false, unreadable: true, reason: 'The SQL API answered 503.' }),
    onRetry() {},
  });
  assert.equal(stateOf(failed, 'data-testid="h15-active-unavailable"'), 'unreadable');
  assert.ok(renderedText(failed).includes('The metrics store could not be read.'));
  assert.ok(renderedText(failed).includes('The SQL API answered 503.'), 'the server\'s reason is printed');
  assert.ok(hasRetry(failed), 'trying again can answer a failed read');

  const unreachable = html(ActiveAccountsCard, {
    data: hqPayload({ available: false, reason: 'This Worker has no Analytics Engine read credential.' }),
    onRetry() {},
  });
  assert.equal(stateOf(unreachable, 'data-testid="h15-active-unavailable"'), 'not_recorded');
  assert.ok(!hasRetry(unreachable), 'retrying cannot give a Worker a credential, so none is offered');
  assert.match(renderedText(unreachable), /Not recorded/);
  assert.doesNotMatch(renderedText(unreachable), /could not be read/, 'an unreachable store is not a failed read');

  const kpis = html(HqKpis, {
    data: hqPayload({ available: false, unreadable: true, reason: 'The SQL API answered 503.' }),
  });
  assert.equal(stateOf(kpis, 'data-testid="h15-kpi-active"'), 'unreadable');
  assert.equal(kpiValue(kpis, 'h15-kpi-active'), 'Unreadable');
});

test('S15 · a failed log read is Unreadable with a retry, and the median keeps its caption beside it', () => {
  const reason = 'This branch\'s request log could not be read, so these are not counts of zero: disk I/O error.';
  const markup = html(BranchChartCard, {
    data: branchPayload({ active_accounts: { available: false, unreadable: true, reason } }), onRetry() {},
  });
  assert.equal(stateOf(markup, 'data-testid="s15-active-unavailable"'), 'unreadable');
  assert.ok(hasRetry(markup));
  assert.ok(renderedText(markup).includes(reason));
  assert.doesNotMatch(markup, /data-testid="s15-plot/, 'no line is drawn over an unread log');
  const note = renderedText(slice(markup, 'data-testid="s15-median-note"', '</p>'));
  assert.ok(note.includes('9 across 3 branches'), 'HQ\'s pushed median is readable on its own and is still stated');

  const kpis = html(BranchKpis, {
    data: branchPayload({
      active_accounts: { available: false, unreadable: true, reason },
      seats: { available: false, unreadable: true, used: null, licensed: null, reason: 'The account table could not be read.' },
      decision_age: {
        queue: 'referrals', window_days: 30, available: false, unreadable: true, median_hours: null, n: 0,
        reason: 'The referral log could not be read: no such table.',
        hq: { available: false, reason: 'HQ publishes no median of this.' },
      },
    }),
  });
  for (const id of ['s15-kpi-active', 's15-kpi-seats', 's15-kpi-decision-age']) {
    assert.equal(stateOf(kpis, `data-testid="${id}"`), 'unreadable', id);
    assert.equal(kpiValue(kpis, id), 'Unreadable', id);
  }
  assert.doesNotMatch(renderedText(kpis), /None decided/, 'an unread log is not a month with no decision');
});

test('S15 · the branch\'s own figure beside the median: recorded, not a whole week, or unreadable', () => {
  const own = (bm) => slice(html(MedianNote, { benchmark: { ...BENCHMARK, ...bm } }), 'data-testid="s15-median-own"', '</span>');
  assert.equal(stateOf(own({}), 'data-testid="s15-median-own"'), 'recorded');
  assert.equal(renderedText(own({})), 'You, that week: 7.');

  const partial = 'This branch began logging on 2026-09-16, inside that week, so its count is not a whole week\'s.';
  const inside = own({ own_value: null, own_reason: partial });
  assert.equal(stateOf(inside, 'data-testid="s15-median-own"'), 'not_recorded');
  assert.equal(renderedText(inside), partial, 'the median\'s own rule, in the server\'s words');

  const unread = own({ own_value: null, own_unreadable: true, own_reason: 'The request log could not be read.' });
  assert.equal(stateOf(unread, 'data-testid="s15-median-own"'), 'unreadable');
  assert.equal(renderedText(unread), 'You, that week: unreadable. The request log could not be read.');

  const withheld = html(MedianNote, { benchmark: { available: false, reason: 'HQ has published no median yet.' } });
  assert.equal(stateOf(withheld, 'data-testid="s15-median-absent"'), 'not_published');
  const unreadCopy = html(MedianNote, { benchmark: { available: false, unreadable: true, reason: 'branch_benchmarks is missing.' } });
  assert.equal(stateOf(unreadCopy, 'data-testid="s15-median-absent"'), 'unreadable');
});

test('S15 · an approval queue whose log failed reads Unreadable; one that keeps no decision reads Not recorded', () => {
  const markup = html(ApprovalAgeList, {
    rows: [
      { key: 'referrals', label: 'Referrals', window_days: 30, available: false, unreadable: true,
        median_hours: null, n: 0, reason: 'The referral log could not be read: no such table.' },
      { key: 'lp_applications', label: 'LP applications', available: false,
        reason: '`reviewed_at` is rewritten on every status change.' },
    ],
  });
  const row = (key) => slice(markup, `data-queue="${key}"`, '</li>');
  assert.deepEqual(attrs(row('referrals'), 'data-state'), ['unreadable']);
  assert.match(renderedText(row('referrals')), /Unreadable/);
  assert.doesNotMatch(renderedText(row('referrals')), /none decided/);
  assert.deepEqual(attrs(row('lp_applications'), 'data-state'), ['not_recorded']);
  assert.match(renderedText(row('lp_applications')), /Not recorded/);
});

test('S15 · revenue: a summary that failed is Unreadable with a retry; a missing rate says why in the server\'s words', () => {
  const failed = html(RevenueCard, {
    revenue: { available: false, unreadable: true, reason: 'The revenue summary could not be built: timeout.' }, onRetry() {},
  });
  assert.equal(stateOf(failed, 'data-testid="s15-revenue"'), 'unreadable');
  assert.ok(hasRetry(failed));
  assert.ok(renderedText(failed).includes('This is not a claim that this branch earned nothing.'));

  const notPushed = 'HQ has not pushed this branch its licence copy yet, so its revenue share is not known here.';
  const rateless = html(RevenueCard, {
    revenue: { available: true, period: '2026-09', share_bps: null, keeps_bps: null, share_reason: notPushed, streams: [] },
  });
  assert.equal(renderedText(slice(rateless, 'data-testid="s15-revenue-share-reason"', '</span>')), notPushed);
  assert.match(renderedText(slice(rateless, 'data-testid="s15-revenue-share"', '</p>')), /^Not recorded/);
  assert.doesNotMatch(renderedText(rateless), /carries no revenue share/, 'D210\'s own sentence is gone');
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/branch/BranchAnalytics.jsx')), /carries no revenue share/);
});

// ── Every blank point's reason, said once; the legend only beside a gap ────

test('H15 · the foot names every reason a point is blank, once each, keyed and in the server\'s order', () => {
  const kinds = [...GAP_ORDER];
  const series = [line('a', Array(8).fill(null), { gaps: [...kinds, ...kinds] })];
  const markup = html(ActiveAccountsCard, {
    data: hqPayload({
      available: true, series, gap_notes: gapNotes(series.map((s) => s.gaps)), kpi: weeklyKpi(axis, series),
      complete: false, row_cap: 12000, sampled: false,
    }),
  });
  assert.deepEqual(attrs(markup, 'data-gap'), kinds, 'one note per reason, in GAP_ORDER, however many weeks it blanks');
  for (const g of kinds) {
    const note = renderedText(slice(markup, `data-gap="${g}"`, '</p>'));
    assert.ok(note.startsWith(GAP_SENTENCES[g]), `${g} prints its own sentence`);
  }
  assert.ok(renderedText(slice(markup, 'data-gap="cap"', '</p>')).endsWith('The cap is 12000 rows.'));
  assert.equal(count(renderedText(markup), 'The cap is'), 1, 'the cap\'s size is printed on its own note only');
});

test('H15 · the legend prints a gap\'s reason beside a missing figure, and never beside a number', () => {
  const series = [
    line('full', [1, 2, 3, 4, 5, 6, 7, 1], { gap_reason: GAP_SENTENCES.cap }),
    line('empty', Array(8).fill(null), { gaps: Array(8).fill('no_rows'), gap_reason: GAP_SENTENCES.no_rows }),
    line('silent', [1, 2, 3, 4, 5, 6, null, 1]),
  ];
  const markup = html(SeriesLegend, { series, weeks: axis.weeks });
  const row = (code) => slice(markup, `data-series="${code}"`, '</li>');
  assert.doesNotMatch(row('full'), /h15-legend-gap/, 'a reason beside a number would read as the number\'s caveat');
  assert.match(renderedText(row('full')), /Line full\s*7/);
  assert.ok(renderedText(slice(row('empty'), 'data-testid="h15-legend-gap"', '</p>')).includes(GAP_SENTENCES.no_rows));
  assert.match(renderedText(row('silent')), /Not recorded/, 'a missing figure is never drawn as nothing');
  assert.doesNotMatch(row('silent'), /h15-legend-gap/, 'and no empty reason paragraph is drawn for it');
});

test('H15 · a ninth branch shares a colour with the first, and the page says so; HQ\'s own line does not count', () => {
  const branches = (n) => Array.from({ length: n }, (_, i) => line(`b${i}`, [1, 1, 1, 1, 1, 1, 1, 1]));
  const hq = line('hq', [1, 1, 1, 1, 1, 1, 1, 1], { kind: 'hq' });
  assert.equal(coloursRepeat([hq, ...branches(8)]), false, 'eight branches fit the palette');
  assert.equal(coloursRepeat([hq, ...branches(9)]), true);
  assert.equal(coloursRepeat(null), false);

  const card = (series) => html(ActiveAccountsCard, {
    data: hqPayload({ available: true, series, gap_notes: [], kpi: weeklyKpi(axis, series), complete: true, row_cap: 1 }),
  });
  assert.doesNotMatch(card([hq, ...branches(8)]), /h15-colours-repeat/);
  assert.ok(renderedText(slice(card([hq, ...branches(9)]), 'data-testid="h15-colours-repeat"', '</p>'))
    .includes('read each line’s figure from its legend row'));
});

// ── The rail's sentence when there is nothing to read back ─────────────────

test('the rail says why there is nothing to read back — reading, failed, or answered with nothing', () => {
  assert.equal(hqCoverageNote(null, ['a line']), undefined, 'lines to read back need no note');
  assert.match(hqCoverageNote(null, []), /Reading the analytics/);
  assert.match(hqCoverageNote(HQ_UNAVAILABLE, []), /could not be read/);
  const answered = hqCoverageNote(hqPayload({ available: false, reason: 'x' }), []);
  assert.match(answered, /answered/);
  assert.doesNotMatch(answered, /could not be read/, 'a payload that answered is not a read that failed');

  assert.equal(branchCoverageNote(null, ['a line']), undefined);
  assert.match(branchCoverageNote(null, []), /Reading this territory/);
  assert.match(branchCoverageNote(BRANCH_UNAVAILABLE, []), /did not complete.*not a claim that nobody is active/);
  const branchAnswered = branchCoverageNote(branchPayload(), []);
  assert.match(branchAnswered, /answered/);
  assert.doesNotMatch(branchAnswered, /did not complete/);
});

// ── The pages wire what the cards and the rail can do ───────────────────────

test('each page hands its reload to every card that offers a retry, and its rail note to the helper that says why', () => {
  // The cards and the note are rendered above with their props passed in, so
  // those tests cannot see a PAGE that stops passing them. Each page loads in
  // an effect, which a static render never runs, so the wiring is read as
  // code: a card drawn with no `onRetry` shows a failed read nobody can retry
  // short of reloading the page, and a hand-written rail note is how D210
  // came to say "could not be read" about a payload that answered.
  const pages = [
    ['frontend/src/pages/hq/HqAnalyticsPage.jsx', ['ActiveAccountsCard'], 'hqCoverageNote'],
    ['frontend/src/pages/branch/BranchAnalytics.jsx', ['BranchChartCard', 'RevenueCard'], 'branchCoverageNote'],
  ];
  for (const [file, cards, note] of pages) {
    const code = codeOnly(read(file));
    assert.ok(code.includes('const retry = () => setAttempt((n) => n + 1);'), `${file}: retry bumps attempt`);
    assert.ok(code.includes('}, [range, attempt]);'), `${file}: the load re-runs when attempt changes`);
    for (const card of cards) {
      assert.equal(count(code, `<${card} `), 1, `${file}: ${card} is mounted once`);
      const at = code.indexOf(`<${card} `);
      const tag = code.slice(at, code.indexOf('/>', at));
      assert.ok(tag.includes('onRetry={retry}'), `${file}: ${card} is drawn with no retry`);
    }
    assert.equal(count(code, 'coverageNote='), 1, `${file}: one rail note`);
    assert.ok(code.includes(`coverageNote={${note}(data, coverage)}`), `${file}: the rail note is ${note}'s`);
  }
});

// ── Week gates: a count nobody could read is never "0 failed" ───────────────

test('cohortTimeline · a count that is not a count is null, and a tally holding one is not readable', () => {
  const byWeek = statusesByWeek([
    { week_number: 1, status: 'passed', n: 7 },
    { week_number: 1, status: 'failed', n: null },
    { week_number: 2, status: 'passed', n: '3' },
    { week_number: 2, status: 'grace', n: '' },
    { week_number: 3, status: 'passed', n: 2.5 },
    { week_number: 3, status: 'failed', n: -1 },
    { week_number: 3, status: 'grace', n: 'x' },
    { week_number: 'x', status: 'passed', n: 1 },
  ]);
  assert.deepEqual(byWeek.get(1), { passed: 7, failed: null }, 'an unread count is null, not 0');
  assert.deepEqual(byWeek.get(2), { passed: 3, grace: null });
  assert.deepEqual(byWeek.get(3), { passed: null, failed: null, grace: null });
  assert.equal(byWeek.size, 3, 'a row with no week is dropped, not filed under a week');
  assert.equal(tallyReadable(byWeek.get(1)), false);
  assert.equal(tallyReadable({ passed: 3, failed: 0 }), true, 'a measured zero is readable');
  assert.equal(tallyReadable({}), true);
  assert.equal(tallyReadable(undefined), true);
});

test('cohortTimeline · a due week whose tally holds an unread count is unreadable, never counted', () => {
  const now = '2026-09-23T12:00:00.000Z';
  const due = { week_number: 1, deadline_at: '2026-09-08 04:00:00' };
  assert.deepEqual(weekOutcome(due, { passed: 7, failed: null }, now), { state: 'unreadable', what: 'tally' });
  assert.equal(weekOutcome(due, { passed: 7, failed: 2 }, now).state, 'counted');
  assert.deepEqual(weekOutcome(due, {}, now), { state: 'no_outcome' });
  // A deadline still ahead is not yet due, whatever its tally holds.
  assert.equal(weekOutcome({ week_number: 4, deadline_at: '2026-09-29 04:00:00' }, { passed: null }, now).state, 'not_yet_due');
  assert.deepEqual(weekOutcome({ week_number: 1, deadline_at: 'soon' }, {}, now), { state: 'unreadable', what: 'deadline' });

  assert.equal(gateSentence({ state: 'unreadable', what: 'tally' }), 'its outcome could not be read');
  assert.equal(gateSentence({ state: 'unreadable', what: 'deadline' }), 'its deadline could not be read');
  assert.equal(gateSentence({ state: 'counted', counts: { passed: 7, failed: 0, grace: null, pending: null } }), '7 passed · 0 failed');
});

test('cohortTimeline · whether a cycle has ended is the server\'s clock against its end, in UTC', () => {
  const now = '2026-09-23T12:00:00.000Z';
  assert.equal(cycleEnded({ end_at: '2026-09-01 04:00:00' }, now), true);
  assert.equal(cycleEnded({ end_at: '2026-10-01 04:00:00' }, now), false);
  assert.equal(cycleEnded({ end_at: '2026-09-23 12:00:00' }, now), true, 'a cycle ending now has ended');
  assert.equal(cycleEnded({ end_at: null }, now), null, 'an unreadable end is not a cycle still running');
  assert.equal(cycleEnded({ end_at: '2026-10-01 04:00:00' }, 'not a time'), null);

  assert.equal(gatesSub(null, null), 'from the cohort timeline');
  assert.match(gatesSub({}, true), /which has ended/);
  assert.match(gatesSub({}, false), /the cycle under way/);
  assert.match(gatesSub({}, null), /the most recent cycle to start/);
  assert.doesNotMatch(gatesSub({}, true), /under way/, 'D210 called an ended cycle "under way"');
});

test('S15 · the gates of an ended cycle say it ended, and an unread count reads as unread', () => {
  const timeline = {
    server_time: '2026-10-09T12:00:00.000Z',
    cycles: [{
      id: 1, year: 2026, month: 9, start_at: '2026-09-01 04:00:00', end_at: '2026-10-01 04:00:00',
      participant_count: 9,
      status_counts: [
        { week_number: 1, status: 'passed', n: 7 }, { week_number: 1, status: 'failed', n: null },
        { week_number: 2, status: 'passed', n: 5 },
      ],
      windows: [1, 2, 3, 4].map((w) => ({ week_number: w, deadline_at: `2026-09-${String(1 + 7 * w).padStart(2, '0')} 04:00:00` })),
    }],
  };
  const markup = html(WeekGates, { timeline, onRetry() {} });
  assert.deepEqual(attrs(markup, 'data-state'), ['unreadable', 'counted', 'no_outcome', 'no_outcome']);
  assert.match(renderedText(markup), /its outcome could not be read/);
  assert.doesNotMatch(renderedText(markup), /0 failed/, 'an unread count is never added up as nothing');
  assert.match(markup, /data-testid="s15-gates-ended"/);
  assert.match(renderedText(markup), /the most recent cycle, which has ended/);
});

test('S4 · a week whose tally holds an unread count says so, and never lists it as counts', () => {
  const src = codeOnly(read('frontend/src/pages/branch/BranchPrograms.jsx'));
  assert.ok(src.includes("import { cycleLabel, statusesByWeek, tallyReadable } from '../../lib/cohortTimeline';"));
  const unread = src.indexOf('counts && !tallyReadable(counts) && (');
  const listed = src.indexOf('counts && tallyReadable(counts) && (');
  assert.ok(unread > 0 && listed > unread, 'the unread tally is its own branch, ahead of the listed one');
  const unreadBlock = src.slice(unread, listed);
  assert.ok(unreadBlock.includes('data-testid="branch-programs-week-unreadable"'));
  assert.ok(unreadBlock.includes('its outcome could not be read'));
  assert.ok(!unreadBlock.includes('Object.entries(counts)'), 'an unread tally is not listed');
});

// ── A superseded timeline answer is dropped ────────────────────────────────

test('S15 · only the newest timeline read may write, and leaving the page retires every read in flight', () => {
  const src = codeOnly(read('frontend/src/pages/branch/BranchAnalytics.jsx'));
  const at = src.indexOf('const loadTimeline = useCallback(');
  assert.ok(at > 0, 'the timeline has its own loader');
  const body = src.slice(at, src.indexOf('}, []);', at));
  assert.ok(body.includes('timelineRun.current += 1;'), 'each load takes a new number');
  assert.ok(body.includes('const run = timelineRun.current;'));
  assert.ok(body.includes('if (run === timelineRun.current) setTimeline(t);'), 'an answer lands only if it is the newest');
  assert.ok(body.includes('if (run !== timelineRun.current) return;'), 'a superseded failure is dropped too');
  assert.equal(count(body, 'setTimeline(t)'), 1);
  const effect = src.slice(src.indexOf('loadTimeline();', at + body.length) - 40, src.indexOf('}, [loadTimeline]);') + 20);
  assert.ok(effect.includes('return () => { timelineRun.current += 1; };'), 'unmounting retires the read in flight');
});

// ── HQ's overlay reads the backlog's count ─────────────────────────────────

test('HQ\'s branch overlay reads the backlog\'s count, which is what the branch sends', () => {
  const ops = read('cloudflare-worker/src/rpc/branchOps.ts');
  assert.ok(ops.includes('backlog: { count: number; oldest_at: string | null } | null;'),
    'BranchOverview.backlog is an object, which is why the overlay must read its count');
  const src = codeOnly(read('frontend/src/pages/hq/HqBranchOverlay.jsx'));
  assert.equal(count(src, 'num(live.backlog)'), 0, 'num() of the object is null, which read as "answered without a backlog"');
  assert.equal(count(src, 'num(live.backlog?.count)'), 2, 'the rail line and the tile both read the count');
});

// ── `hq` is nobody's branch host ───────────────────────────────────────────

test('hq.axal.vc is not a branch host: `hq` is HQ\'s own code in the metrics store', () => {
  assert.equal(branchCodeFromHost('hq.axal.vc'), null);
  assert.equal(branchCodeFromHost('fr.axal.vc'), 'fr');
  assert.equal(branchCodeFromHost('hq-north.axal.vc'), 'hq-north', 'only the bare code is reserved');
});

// ── A light hover on a dark ground ─────────────────────────────────────────

/**
 * Every `hover:bg-axal-ground` in the SPA carries a `dark:hover:bg-` pair, and
 * every `hover:text-axal-ink` a `dark:hover:text-` pair, in the same class
 * expression — the string, or the `+`-joined strings of one const.
 *
 * LATENT INSIDE THE APP SHELL, VISIBLE OUTSIDE IT (measured in Chromium against
 * the built CSS, D211). `index.css`'s dark skin is unlayered and Tailwind v4's
 * utilities are layered, so inside `[data-app-main]` the skin outranks both
 * hover utilities and neither shows. Outside it — and the day the skin moves
 * into a layer below the utilities — an unpaired one paints the light ground
 * over a dark button, or the dark ink over a dark ground. The window runs from
 * the previous `;` `{` or `<` to the next `;` `>` or `}`, which bounds a JSX
 * attribute, a template branch, and a multi-line `const` alike.
 */
const LIGHT_HOVERS = [
  // [the light-theme hover, the pair it needs, how many the scan must still see]
  ['hover:bg-axal-ground', 'dark:hover:bg-', 11],
  ['hover:text-axal-ink', 'dark:hover:text-', 7],
];
test('every light-theme hover carries a dark hover in the same class expression', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(e.name)) files.push(p);
    }
  };
  walk(resolve(root, 'frontend/src'));
  for (const [needle, pair, floor] of LIGHT_HOVERS) {
    let seen = 0;
    const bare = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      let at = src.indexOf(needle);
      while (at >= 0) {
        if (src.slice(at - 5, at) !== 'dark:') {
          seen += 1;
          const from = Math.max(src.lastIndexOf(';', at), src.lastIndexOf('{', at), src.lastIndexOf('<', at));
          const ends = [src.indexOf(';', at), src.indexOf('>', at), src.indexOf('}', at)].filter((i) => i > 0);
          const span = src.slice(from, Math.min(...ends));
          if (!span.includes(pair)) bare.push(`${f.slice(root.length + 1)} @${src.slice(0, at).split('\n').length}`);
        }
        at = src.indexOf(needle, at + 1);
      }
    }
    assert.ok(seen >= floor, `the scan found ${seen} ${needle}; it must still see the ${floor} D211 paired`);
    assert.deepEqual(bare, [], `a ${needle} with no ${pair} pair`);
  }
});
