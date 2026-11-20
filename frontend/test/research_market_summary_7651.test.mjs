/**
 * D7651 (#7651) — the Eadwyn summary of a market reading, to the cent
 * (canvas D7039, board RMP-12 and the rail's "Summaries" line).
 *
 * Held here:
 *   - `summaryView` reads the Worker's two-decimal text back through
 *     `lib/money.js` and writes $99.50 – $99.99 and $4,500.00 – $6,000.00 as
 *     stored; text that disagrees with its cents is Not recorded, never drawn;
 *   - the catalog price sits beside the range on a service line, says Not
 *     recorded when unpriced, and is absent without a service line;
 *   - the page draws loading, Unreadable with Try again, Not recorded and the
 *     line itself, with dark pairs, and an investor never sees it;
 *   - the rail's "Summaries" line quotes the range to the cent once read;
 *   - the client calls the mounted Worker route, and the page uses no `/ 100`.
 *
 * Rendered with react-dom/server (no DOM).
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_market_summary_7651.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { MarketReadingView, SummaryLine } from '../src/pages/research/MarketReading.jsx';
import { railSummaryLine, readingFields, summaryView, SUMMARY_COPY } from '../src/pages/research/marketReadingRead.js';

const h = React.createElement;
const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const words = (html) => renderedText(html.replace(/></g, '> <')).replace(/\s+/g, ' ').trim();
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); // clock-ok: relative

const summary = (o = {}) => ({
  uid: 'rm_1', metric: 'Investor-update edit', scope: 'One update', service_line: false,
  range: { status: 'recorded', low_cents: 9950, high_cents: 9999, low_usd: '99.50', high_usd: '99.99' },
  comparable_count: 7, ran_at: '2026-11-16',
  catalog_price: { status: 'not_applicable', reason: 'Not a catalog service line, so there is no listed price.' },
  line: null, basis: 'stored_reading', ...o,
});
const reading = (o = {}) => ({
  uid: 'rm_1', metric: 'Investor-update edit', offering_uid: null, scope: 'One update',
  range_low_cents: 9950, range_high_cents: 9999, comparable_count: 7, catalog_price_cents: null, ran_at: ago(0), ...o,
});
const page = ({ role = 'partner', item = reading(), ...rest } = {}) => renderToStaticMarkup(h(
  MemoryRouter, { initialEntries: ['/research/markets/rm_1'] },
  h(MarketReadingView, { role, payload: { item, attachments: [], proposals: [] }, form: readingFields(item), ...rest }),
));
const line = (status, view) => renderToStaticMarkup(h(SummaryLine, { status, view }));

test('99.50 – 99.99 and 4500.00 – 6000.00 are written to the cent from the Worker’s text', () => {
  const v = summaryView(summary());
  assert.equal(v.state, 'recorded');
  assert.equal(v.lead, 'Investor-update edit (One update)');
  assert.equal(v.range, '$99.50 – $99.99');
  assert.equal(v.tail, ', from 7 comparables, run 2026-11-16');
  assert.equal(v.catalog, null, 'no catalog price without a service line');

  const big = summaryView(summary({
    metric: 'Seed financial model build', scope: null, service_line: true, comparable_count: 1,
    range: { status: 'recorded', low_cents: 450000, high_cents: 600000, low_usd: '4500.00', high_usd: '6000.00' },
    catalog_price: { status: 'recorded', cents: 450000, usd: '4500.00' },
  }));
  assert.equal(big.lead, 'Seed financial model build');
  assert.equal(big.range, '$4,500.00 – $6,000.00');
  assert.equal(big.tail, ', from 1 comparable, run 2026-11-16');
  assert.deepEqual(big.catalog, { state: 'recorded', text: 'Catalog price $4,500.00' });
});

test('text that disagrees with its cents, or no range, is Not recorded and draws no figure', () => {
  // 99.5 rounded to 100 on the way would be the bug this issue exists for.
  const rounded = summaryView(summary({ range: { status: 'recorded', low_cents: 9950, high_cents: 9999, low_usd: '100.00', high_usd: '100.00' } }));
  assert.equal(rounded.state, 'not_recorded');
  assert.equal(summaryView(summary({ range: { status: 'not_recorded', reason: 'No range.' } })).reason, 'No range.');
  assert.equal(summaryView(null).state, 'not_recorded');
  const unpriced = summaryView(summary({ service_line: true, catalog_price: { status: 'not_recorded', reason: 'x' } }));
  assert.deepEqual(unpriced.catalog, { state: 'not_recorded' });
  const lying = summaryView(summary({ service_line: true, catalog_price: { status: 'recorded', cents: 12000, usd: '120.50' } }));
  assert.deepEqual(lying.catalog, { state: 'not_recorded' }, 'a catalog text that disagrees with its cents is not drawn');
});

test('the line, its catalog price and its basis are drawn as RMP-12 draws them', () => {
  const t = words(line('ready', summaryView(summary({
    service_line: true, catalog_price: { status: 'recorded', cents: 12000, usd: '120.00' },
  }))));
  assert.match(t, /Eadwyn summary of this reading/);
  assert.match(t, /From the stored reading only\. No model is called and nothing is rounded\./);
  assert.match(t, /Investor-update edit \(One update\): \$99\.50 – \$99\.99, from 7 comparables, run 2026-11-16/);
  assert.match(t, /Catalog price \$120\.00 · your offer, beside the range and never added into it\./);
  const unpriced = words(line('ready', summaryView(summary({ service_line: true, catalog_price: { status: 'not_recorded' } }))));
  assert.match(unpriced, /Catalog price Not recorded/);
  assert.doesNotMatch(unpriced, /\$0\.00/);
});

test('loading, Unreadable with Try again and Not recorded each say so, and idle draws nothing', () => {
  assert.equal(line('idle', null), '');
  const loading = line('loading', null);
  assert.match(words(loading), /Reading the summary\./);
  assert.match(loading, /aria-busy="true"/);
  const failed = words(line('unavailable', null));
  assert.match(failed, /The summary could not be read\. This is not a claim that the reading has no range\./);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /\$/);
  const none = words(line('ready', summaryView(summary({ range: { status: 'not_recorded', reason: 'This reading has no range that reads low to high.' } }))));
  assert.match(none, /Not recorded This reading has no range that reads low to high\./);
});

test('every light surface of the summary has its dark pair', () => {
  const html = line('ready', summaryView(summary({ service_line: true, catalog_price: { status: 'recorded', cents: 12000, usd: '120.00' } })));
  assert.match(html, /bg-violet-50 dark:border-violet-900 dark:bg-violet-950\/40/);
  assert.match(html, /text-axal-ink dark:text-gray-100/);
  assert.match(html, /text-\[color:var\(--mr-accent-deep\)\] dark:text-\[color:var\(--mr-accent-dark\)\]/);
  for (const cls of html.match(/class="[^"]*text-axal-muted[^"]*"/g) || []) {
    assert.match(cls, /dark:text-gray-400/, `${cls} has no dark pair`);
  }
  // 390 phone: the line wraps and the range is never split across lines.
  assert.match(html, /break-words/);
  assert.match(html, /whitespace-nowrap font-mono/);
});

test('the reading page draws the summary under the plain words, and an investor never sees it', () => {
  const view = summaryView(summary());
  const html = page({ summary: summary(), summaryStatus: 'ready' });
  assert.ok(view);
  const t = words(html);
  assert.match(t, /What this reading says .* Eadwyn summary of this reading .* Record this reading/);
  assert.match(t, /\$99\.50 – \$99\.99, from 7 comparables/);
  const investor = page({ role: 'investor', summary: summary(), summaryStatus: 'ready' });
  assert.doesNotMatch(investor, /market-reading-summary/);
  assert.match(investor, /This reading is not on your list\./);
});

test('the rail’s Summaries line quotes the range to the cent once it is read', () => {
  assert.equal(railSummaryLine('loading', null), null);
  assert.equal(railSummaryLine('idle', null), null);
  assert.equal(
    railSummaryLine('ready', summaryView(summary())),
    'Summaries: when Eadwyn summarises this reading it quotes $99.50 – $99.99, to the cent.',
  );
  assert.match(railSummaryLine('ready', summaryView(null)), /^Summaries: not recorded\./);
  assert.match(railSummaryLine('unavailable', null), /could not be read/);
  const src = read('frontend/src/pages/research/MarketReading.jsx');
  assert.match(src, /railSummaryLine\(summaryStatus, sumView\)/);
  assert.match(src, /note=\{\[[\s\S]*?railSummary,[\s\S]*?\]\.filter\(Boolean\)\.join\(' '\)\}/);
});

test('the client calls the mounted Worker route, and nothing here divides by 100', () => {
  const client = read('frontend/src/lib/api/researchMarketReadings.js');
  assert.match(client, /request\(`\/research\/market-readings\/\$\{encodeURIComponent\(uid\)\}\/summary`\)/);
  const route = read('cloudflare-worker/src/routes/research_client_prep.ts');
  assert.match(route, /research\.get\('\/market-readings\/:uid\/summary'/);
  const page = read('frontend/src/pages/research/MarketReading.jsx');
  assert.match(page, /researchMarketReadingsApi\.summary\(uid\)/);
  assert.match(page, /if \(hidden\) return;\n    const current = summaryGate\.current\.begin\(\);/, 'an investor must not ask for a summary');
  const lib = read('frontend/src/pages/research/marketReadingRead.js');
  const block = lib.slice(lib.indexOf('D7651 (#7651)'));
  assert.doesNotMatch(block, /\/ ?100\b|Math\.round|toFixed/);
  assert.equal(SUMMARY_COPY.heading, 'Eadwyn summary of this reading');
});
