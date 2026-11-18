/**
 * D7169 (#7169) — Research › Fund dossier quarterly reports (boards FND-Q0 to
 * FND-Q11, D7034): quarters at their own position with gaps, one look per
 * metric state, keep / replace / clear with a changed-fields-only body, the
 * conflict merge, and the panel's states as rendered markup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  carriedValues, changeSet, changeTitle, conflictRows, draftFrom, fieldState, fmtMultiple, fmtPercent, fmtUsd, lastClosedQuarter,
  parseInput, periodLabel, periodRange, quarterTimeline, rebaseDraft, resolvedBody, saveLabel, savedSentence, serverFieldErrors,
} from '../src/pages/research/fundReportsModel.js';

const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { researchFundReportsApi } = await import('../src/lib/api/researchFundReports.js');
const { HistoryTable, MetricValue } = await import('../src/pages/research/FundReportsPanel.jsx');
const { default: FundReportsChart, pointWords } = await import('../src/pages/research/FundReportsChart.jsx');
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const Q2 = {
  uid: 'r6', period: '2026-Q2', report_date: '2026-07-14', fund_size_cents: null, nav_cents: 10_000_000,
  quarterly_return_bps: null, net_irr_bps: 940, tvpi_bps: 140, source_url: 'https://example.com/q2.pdf',
  report_url: null, notes: 'NAV from the letter.', updated_at: '2026-11-12T09:10:00.000Z',
};
const set = (draft, key, next) => ({ fields: { ...draft.fields, [key]: { ...draft.fields[key], ...next } } });

test('quarters sit at their own position: a missing quarter is a gap, from the first report to the latest (FND-Q6)', () => {
  const t = quarterTimeline([{ uid: 'b', period: '2025-Q3' }, { uid: 'a', period: '2025-Q1' }, { uid: 'c', period: '2026-Q1' }]);
  assert.deepEqual(t.map((q) => [q.period, q.report?.uid ?? null]), [
    ['2025-Q1', 'a'], ['2025-Q2', null], ['2025-Q3', 'b'], ['2025-Q4', null], ['2026-Q1', 'c'],
  ]);
  assert.deepEqual(quarterTimeline([]), []);
  assert.equal(periodLabel('2026-Q2'), '2026 Q2');
  assert.equal(periodRange('2026-Q2'), '1 Apr – 30 Jun 2026');
  assert.equal(lastClosedQuarter(new Date(Date.UTC(2026, 0, 5))), '2025-Q4');
  assert.equal(lastClosedQuarter(new Date(Date.UTC(2026, 10, 18))), '2026-Q3');
});

test('one look per meaning: one-decimal percents with a true minus, TVPI as ×, US$ (FND-Q5)', () => {
  assert.equal(fmtPercent(420), '4.2%');
  assert.equal(fmtPercent(0), '0.0%');
  assert.equal(fmtPercent(-210), '−2.1%');
  assert.equal(fmtMultiple(140), '1.4×');
  assert.equal(fmtMultiple(118), '1.18×');
  assert.equal(fmtUsd(10_000_000), 'US$100,000');
  assert.equal(fmtPercent(null), null);
  const zero = renderToStaticMarkup(h(MetricValue, { field: 'quarterly_return_bps', value: 0, zeroTag: true }));
  assert.match(zero, /0\.0%/); assert.match(zero, /measured 0/);
  assert.match(renderToStaticMarkup(h(MetricValue, { field: 'tvpi_bps', value: null })), /Not recorded/);
  assert.doesNotMatch(read('pages/research/FundReportsPanel.jsx'), /bpsPercent/, 'TVPI no longer reads "1.4%x"');
});

test('typed values are read exactly, and a bad one names its fix and keeps what was typed (FND-Q7)', () => {
  assert.deepEqual(parseInput('nav_cents', '100,000'), { value: 10_000_000 });
  assert.deepEqual(parseInput('nav_cents', 'US$102,500'), { value: 10_250_000 });
  assert.equal(parseInput('nav_cents', '100k').error, 'Enter whole US dollars, like 100000. You typed “100k”.');
  assert.deepEqual(parseInput('quarterly_return_bps', '−2.1'), { value: -210 });
  assert.deepEqual(parseInput('quarterly_return_bps', '0'), { value: 0 });
  assert.match(parseInput('quarterly_return_bps', '4,2 %').error, /full stop/);
  assert.match(parseInput('tvpi_bps', '140%').error, /TVPI is a multiple\. Type 1\.4 for 1\.4×/);
  assert.deepEqual(parseInput('tvpi_bps', '1.4'), { value: 140 });
  assert.deepEqual(parseInput('net_irr_bps', ''), { value: null });
  assert.ok(parseInput('source_url', 'example.com').error);
});

test('adding a 4.2% return sends one field and keeps the other six (FND-Q3, FND-Q4)', () => {
  const draft = set(draftFrom(Q2), 'quarterly_return_bps', { text: '4.2' });
  const cs = changeSet(draft, Q2);
  assert.deepEqual(cs.body, { quarterly_return_bps: 420 });
  assert.deepEqual(cs.changes.map((c) => [c.key, c.state]), [['quarterly_return_bps', 'new']]);
  assert.equal(cs.errors.length, 0);
  assert.equal(saveLabel(cs.changes.length), 'Save 1 change');
  assert.equal(changeTitle(cs.changes), '1 change will be saved');
  assert.equal(savedSentence('2026-Q2', cs.changes), 'Saved. 2026 Q2 updated: quarterly return 4.2%. Other values unchanged.');
  assert.deepEqual(changeSet(draftFrom(Q2), Q2).body, {}, 'an untouched edit sends nothing');
});

test('keep, replace and clear are three intents; blank is not a command (FND-Q4)', () => {
  let d = set(draftFrom(Q2), 'nav_cents', { text: '102,500' });
  d = set(d, 'tvpi_bps', { text: '', clear: true });
  d = set(d, 'net_irr_bps', { text: '' });
  const cs = changeSet(d, Q2);
  assert.deepEqual(cs.body, { nav_cents: 10_250_000, tvpi_bps: null });
  assert.equal(changeTitle(cs.changes), '1 replacement and 1 clear will be saved');
  const blank = fieldState('net_irr_bps', d.fields.net_irr_bps, Q2);
  assert.equal(blank.state, 'kept'); assert.equal(blank.blank, true); assert.equal(blank.value, 940);
  assert.equal(fieldState('fund_size_cents', { text: '', clear: true }, Q2).state, 'kept', 'clearing what was never recorded is no change');
});

test('a new quarter carries the period and every typed value, and needs a source', () => {
  let d = draftFrom(null);
  assert.equal(changeSet(d, null, { period: '2026-Q3' }).errors[0].key, 'source_url');
  d = set(set(d, 'source_url', { text: 'https://example.com/q3' }), 'nav_cents', { text: '96000' });
  assert.deepEqual(changeSet(d, null, { period: '2026-Q3' }).body, { source_url: 'https://example.com/q3', nav_cents: 9_600_000, period: '2026-Q3' });
  assert.deepEqual(carriedValues(set(draftFrom(null), 'quarterly_return_bps', { text: '4.2' }), Q2), [{ key: 'quarterly_return_bps', text: '4.2' }]);
});

test('a conflict merges what one side changed and asks about what both changed (FND-Q7)', () => {
  const theirs = { ...Q2, nav_cents: 10_100_000, updated_at: '2026-11-16T14:30:00.000Z' };
  const mine = { quarterly_return_bps: 420, nav_cents: 10_250_000 };
  const rows = conflictRows(Q2, mine, theirs);
  const kinds = Object.fromEntries(rows.map((r) => [r.key, r.kind]));
  assert.equal(kinds.quarterly_return_bps, 'mine');
  assert.equal(kinds.nav_cents, 'conflict');
  assert.equal(kinds.net_irr_bps, 'same');
  assert.deepEqual(resolvedBody(rows), { quarterly_return_bps: 420, nav_cents: 10_250_000 });
  assert.deepEqual(resolvedBody(rows, { nav_cents: 'theirs' }), { quarterly_return_bps: 420 });
  const theirsOnly = conflictRows(Q2, { quarterly_return_bps: 420 }, theirs);
  assert.equal(theirsOnly.find((r) => r.key === 'nav_cents').kind, 'theirs');
  const rebased = rebaseDraft(theirs, { quarterly_return_bps: 420 });
  assert.deepEqual(changeSet(rebased, theirs).body, { quarterly_return_bps: 420 });
  assert.deepEqual(serverFieldErrors({ errors: [{ field: 'nav_cents', detail: 'No.' }] }), { nav_cents: 'No.' });
});

test('the history lists a gap as a "No report" row with Add, and each report with Edit and Delete', () => {
  const timeline = quarterTimeline([{ ...Q2, uid: 'a', period: '2025-Q1', quarterly_return_bps: 180 }, { ...Q2, uid: 'c', period: '2025-Q3', quarterly_return_bps: -210 }]);
  const html = renderToStaticMarkup(h(HistoryTable, { timeline, onEdit() {}, onDelete() {}, onAdd() {} }));
  assert.match(html, /No report for this quarter/);
  assert.match(html, /aria-label="Add a report for 2025 Q2"/);
  assert.match(html, /aria-label="Edit 2025 Q3 report"/);
  assert.match(html, /aria-label="Delete 2025 Q1 report"/);
  assert.match(html, /−2\.1%/);
  assert.match(html, /1\.4×/);
  assert.match(html, /opens in a new tab/);
});

test('the chart never joins across a gap and names every quarter, gaps included (FND-Q6, FND-Q9)', () => {
  const timeline = quarterTimeline([{ ...Q2, period: '2025-Q1', quarterly_return_bps: 180 }, { ...Q2, period: '2025-Q3', quarterly_return_bps: -210 }, { ...Q2, period: '2025-Q4', quarterly_return_bps: 0 }]);
  const html = renderToStaticMarkup(h(FundReportsChart, { timeline, metric: 'quarterly_return_bps' }));
  assert.equal((html.match(/<line[^>]*stroke-violet-600/g) || []).length, 1, 'only Q3–Q4 are joined; Q1 and Q3 are not');
  assert.match(html, />No report</);
  assert.match(html, /2025 Q2, no report/);
  assert.equal(pointWords(timeline[3], 'quarterly_return_bps'), '2025 Q4, 0.0 percent, measured');
  assert.equal(pointWords(timeline[2], 'quarterly_return_bps'), '2025 Q3, minus 2.1 percent');
});

test('the client: create-only POST, PATCH with If-Match, owner routes under /research/funds/:uid/reports', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push([String(url), init]); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    await researchFundReportsApi.update('f 1', 'r6', { quarterly_return_bps: 420 }, '2026-11-12T09:10:00.000Z');
    await researchFundReportsApi.create('f1', { period: '2026-Q3' });
  } finally { globalThis.fetch = realFetch; }
  assert.match(calls[0][0], /\/research\/funds\/f%201\/reports\/r6$/);
  assert.equal(calls[0][1].method, 'PATCH');
  assert.equal(calls[0][1].headers['If-Match'], '"2026-11-12T09:10:00.000Z"');
  assert.equal(calls[0][1].body, '{"quarterly_return_bps":420}');
  assert.equal(calls[1][1].method, 'POST');
});

test('the panel draws three separate states and holds Add quarter while the list is unknown (FND-Q1)', () => {
  const panel = read('pages/research/FundReportsPanel.jsx');
  assert.match(panel, /No quarterly reports yet/);
  assert.match(panel, /Quarterly reports could not be read\./);
  assert.match(panel, /This is not a claim that none exist\./);
  assert.match(panel, /aria-disabled=\{ready \? undefined : 'true'\}/);
  assert.match(panel, /Keep report/);
  assert.doesNotMatch(panel, /Atlas AI/);
  const sheet = read('pages/research/FundReportSheet.jsx');
  assert.match(sheet, /already has a report\./);
  assert.match(sheet, /Nothing was saved; your entries are kept\./);
  assert.match(sheet, /Save with these choices/);
  assert.match(sheet, /sessionStorage/);
});
