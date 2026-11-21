/**
 * D7651 part 2 (#7651) — the Eadwyn summary of all of your readings, under the
 * readings card's CSV export on `/research/markets` (canvas D7039, RMP-12).
 *
 * Held here:
 *   - `readingsSummaryView` writes each line from the Worker's two-decimal text
 *     ($99.50 – $99.99, $4,500.00 – $6,000.00) and the Worker's counts; a line
 *     whose text disagrees with its cents is Not recorded, never drawn;
 *   - `ReadingsSummary` draws loading, Unavailable with Try again, No readings
 *     recorded and the lines, with dark pairs and an unbroken range at 390;
 *   - the readings card draws it under the CSV export and above the rows, and
 *     only when it is given one; an investor's zone never asks;
 *   - the client calls the mounted Worker route, and nothing divides by 100.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_readings_summary_7651.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import ReadingsSummary from '../src/pages/research/ReadingsSummary.jsx';
import { Readings } from '../src/pages/research/MarketDirectoryZone.jsx';
import { READINGS_SUMMARY_COPY, readingsSummaryView } from '../src/pages/research/marketReadingRead.js';

const h = React.createElement;
const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const words = (html) => renderedText(html.replace(/></g, '> <')).replace(/\s+/g, ' ').trim();

const line = (o = {}) => ({
  uid: 'rm_1', metric: 'Investor-update edit · per update', scope: 'One investor update', service_line: false,
  range: { status: 'recorded', low_cents: 9950, high_cents: 9999, low_usd: '99.50', high_usd: '99.99' },
  comparable_count: 7, ran_at: '2026-11-16',
  catalog_price: { status: 'not_applicable', reason: 'x' }, line: null, basis: 'stored_reading',
  age_days: 3, age: 'current', ...o,
});
const big = line({
  uid: 'rm_2', metric: 'Seed financial model build', scope: null, service_line: true, comparable_count: 12, ran_at: '2026-09-02',
  range: { status: 'recorded', low_cents: 450000, high_cents: 600000, low_usd: '4500.00', high_usd: '6000.00' },
  catalog_price: { status: 'recorded', cents: 450000, usd: '4500.00' }, age_days: 78, age: 'ageing',
});
const summary = (o = {}) => ({
  readings: 3, lines: [line(), big], age: { current: 1, ageing: 1, stale: 0, undated: 0 },
  newest_ran_at: '2026-11-16', basis: 'stored_readings', ...o,
});
const block = (read) => renderToStaticMarkup(h(ReadingsSummary, { read }));
const ready = (s) => ({ status: 'ready', data: { summary: s }, reload: () => {} });

test('each line is written to the cent from the Worker’s text, under the Worker’s counts', () => {
  const v = readingsSummaryView(summary());
  assert.equal(v.state, 'recorded');
  assert.equal(v.facts, '3 readings stored, 2 summarised below · 1 current, 1 ageing, 0 stale · newest run 2026-11-16');
  assert.equal(v.lines[0].range, '$99.50 – $99.99');
  assert.equal(v.lines[0].lead, 'Investor-update edit · per update (One investor update)');
  assert.equal(v.lines[0].tail, ', from 7 comparables, run 2026-11-16');
  assert.equal(v.lines[1].range, '$4,500.00 – $6,000.00');
  assert.equal(v.lines[1].age, 'ageing');
  const one = readingsSummaryView(summary({ readings: 1, lines: [line()], age: { current: 0, ageing: 0, stale: 1, undated: 2 }, newest_ran_at: null }));
  assert.equal(one.facts, '1 reading stored, 1 summarised below · 0 current, 0 ageing, 1 stale, 2 undated');
});

test('a line whose text disagrees with its cents is Not recorded; no lines is none; no summary is not recorded', () => {
  // 99.50 rounded to 100.00 on the way is the defect this issue exists for.
  const lying = summary({
    lines: [line({ range: { status: 'recorded', low_cents: 9950, high_cents: 9999, low_usd: '100.00', high_usd: '100.00' } })],
  });
  const rounded = readingsSummaryView(lying);
  assert.equal(rounded.lines[0].state, 'not_recorded');
  assert.equal(rounded.lines[0].metric, 'Investor-update edit · per update');
  const t = words(block(ready(lying)));
  assert.match(t, /Investor-update edit · per update: Not recorded/);
  assert.doesNotMatch(t, /\$100/);
  assert.deepEqual(readingsSummaryView(summary({ readings: 0, lines: [] })), { state: 'none' });
  assert.deepEqual(readingsSummaryView(null), { state: 'not_recorded' });
  assert.deepEqual(readingsSummaryView({ lines: [line()] }), { state: 'not_recorded' }, 'no counts, no summary');
});

test('the block draws the heading, its basis, the counts and each line as RMP-12 draws it', () => {
  const t = words(block(ready(summary())));
  assert.match(t, /Eadwyn summary of your readings/);
  assert.match(t, /From your stored readings only\. No model is called and nothing is rounded\./);
  assert.match(t, /3 readings stored, 2 summarised below · 1 current, 1 ageing, 0 stale · newest run 2026-11-16/);
  assert.match(t, /Investor-update edit · per update \(One investor update\): \$99\.50 – \$99\.99, from 7 comparables, run 2026-11-16 · current/);
  assert.match(t, /Seed financial model build: \$4,500\.00 – \$6,000\.00, from 12 comparables, run 2026-09-02 · ageing/);
});

test('loading, Unavailable with Try again and No readings recorded each say so', () => {
  const loading = block({ status: 'loading', data: null });
  assert.match(words(loading), /Reading the summary of your readings\./);
  assert.match(loading, /aria-busy="true"/);
  // A reload keeps the last summary on screen rather than blanking it.
  assert.match(words(block({ status: 'loading', data: { summary: summary() } })), /\$99\.50 – \$99\.99/);
  for (const status of ['unreadable', 'not_found']) {
    const failed = words(block({ status, data: null, reload: () => {} }));
    assert.match(failed, /The summary of your readings/);
    assert.match(failed, /This is not a sign you have none\./);
    assert.match(failed, /Try again/);
    assert.doesNotMatch(failed, /\$/);
  }
  const none = block(ready(summary({ readings: 0, lines: [], newest_ran_at: null })));
  assert.match(words(none), /No readings recorded, so there is nothing to summarise\./);
  assert.doesNotMatch(words(none), /\$|0 stale/);
});

test('every light surface has its dark pair, and the range never splits at 390', () => {
  const html = block(ready(summary({ lines: [line({ age: 'stale' }), big] })));
  assert.match(html, /border-violet-200 bg-violet-50 px-3 py-2.5 dark:border-violet-900 dark:bg-violet-950\/40/);
  assert.match(html, /text-violet-800 dark:text-violet-300/);
  assert.match(html, /text-axal-ink dark:text-gray-100/);
  assert.match(html, /text-red-700 dark:text-red-300/);
  assert.match(html, /text-amber-800 dark:text-amber-300/);
  for (const cls of html.match(/class="[^"]*text-axal-muted[^"]*"/g) || []) {
    assert.match(cls, /dark:text-gray-400/, `${cls} has no dark pair`);
  }
  assert.match(html, /break-words/);
  assert.equal((html.match(/whitespace-nowrap font-mono/g) || []).length, 2, 'each range is held on one line');
});

test('the readings card draws it under the CSV export and above the rows, only when given one', () => {
  const items = [{ uid: 'rm_1', offering_uid: null, metric: 'Retainer', range_low_cents: 9950, range_high_cents: 9999, comparable_count: 7, ran_at: '2026-11-16', scope: null }];
  const card = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(Readings, { readings: { status: 'ready', data: { items } }, ...props })));
  const html = card({ summary: ready(summary()) });
  const exp = html.indexOf('Export CSV');
  const sum = html.indexOf('data-testid="markets-readings-summary"');
  const table = html.indexOf('data-testid="readings-table"');
  assert.ok(exp > 0 && sum > exp && table > sum, 'the summary sits between the CSV export and the rows');
  assert.ok(!card({}).includes('markets-readings-summary'), 'no summary without one');
});

test('the zone asks the mounted Worker route, never for an investor, re-reads after a save, and divides nothing by 100', () => {
  const client = read('frontend/src/lib/api/researchMarketReadings.js');
  assert.match(client, /all: \(\) => request\('\/research\/market-readings\/summary'\)/);
  const route = read('cloudflare-worker/src/routes/research_client_prep.ts');
  assert.match(route, /research\.get\('\/market-readings\/summary'/);
  const zone = read('frontend/src/pages/research/MarketDirectoryZone.jsx');
  assert.match(zone, /useRead\(\(\) => \(showReadings \? researchMarketReadingsApi\.all\(\) : Promise\.resolve\(null\)\), role\)/);
  assert.match(zone, /reloadReadings\(\);\n\s*reloadReadingsSummary\(\);/);
  assert.match(zone, /summary=\{\{ \.\.\.readingsSummary, reload: reloadReadingsSummary \}\}/);
  const lib = read('frontend/src/pages/research/marketReadingRead.js');
  const fn = lib.slice(lib.indexOf('D7651 part 2'));
  assert.doesNotMatch(fn, /\/ ?100\b|Math\.round|toFixed/);
  assert.doesNotMatch(read('frontend/src/pages/research/ReadingsSummary.jsx'), /\/ ?100\b|Math\.round|toFixed/);
  assert.equal(READINGS_SUMMARY_COPY.heading, 'Eadwyn summary of your readings');
});
