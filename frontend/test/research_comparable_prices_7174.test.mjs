/**
 * D7174 (#7174) — Research › Markets › Comparable prices, to its canvas
 * (`design/incoming/Research Markets Comparable Prices Page.dc.html`, D7039,
 * boards RMP-00 to RMP-14): every amount kept to the cent from the form to
 * the detail, a correction under each field, the saved detail's notice, the
 * plain words, a failed save that keeps the inputs, and the phone keyboard.
 *
 * Rendered with react-dom/server (no DOM). Run dates are counted back from today.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_comparable_prices_7174.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { MarketReadingView, NO_ANSWER, RECORDED, saveFailure } from '../src/pages/research/MarketReading.jsx';
import { RecordReading, submitReading } from '../src/pages/research/MarketDirectoryZone.jsx';
import {
  dollarsToCents,
  plainWords,
  readingFields,
  readingSubmission,
  recordedLine,
  runDayLabel,
  usd,
} from '../src/pages/research/marketReadingRead.js';

const h = React.createElement;
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); // clock-ok: relative
const reading = (o = {}) => ({
  uid: 'rm_1', metric: 'Investor-update edit', offering_uid: 'off_1', scope: 'One update',
  range_low_cents: 9950, range_high_cents: 9999, comparable_count: 7, catalog_price_cents: 12000, ran_at: ago(0), ...o,
});
const routed = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/research/markets/rm_1'] }, el));
const page = ({ item = reading(), role = 'partner', ...rest } = {}) => routed(h(MarketReadingView, {
  role, payload: { item, attachments: [], proposals: [] }, form: rest.form || readingFields(item), ...rest,
}));
const words = (html) => renderedText(html.replace(/></g, '> <')).replace(/\s+/g, ' ').trim();

test('cents round-trip: 99.50 and 99.99 typed, 9950 and 9999 sent, 99.50 and 99.99 reopened', () => {
  assert.equal(dollarsToCents('99.50').cents, 9950);
  assert.equal(dollarsToCents('99.99').cents, 9999);
  assert.equal(dollarsToCents('0').cents, 0, 'a true zero is a value');
  const fields = readingFields(reading());
  assert.equal(fields.low, '99.50');
  assert.equal(fields.high, '99.99');
  const sent = readingSubmission(reading(), fields).body;
  assert.equal(sent.range_low_cents, 9950);
  assert.equal(sent.range_high_cents, 9999);
  assert.equal(readingFields(reading({ range_low_cents: 450000 })).low, '4500.00');
  assert.equal(usd(450000), '$4,500.00');
  assert.equal(usd(0), '$0.00');
  assert.equal(usd(null), null);
  assert.equal(recordedLine(reading({ ran_at: '2026-11-16' })), '$99.50 – $99.99 from 7 comparables, run 2026-11-16.');
  assert.equal(runDayLabel('2026-11-16'), 'Mon 16 Nov 2026');
});

test('the detail draws the range, the form and the catalog price to the cent, apart', () => {
  const html = page();
  const t = words(html);
  assert.match(t, /Comparable range \$99\.50 – \$99\.99 from 7 comparables · both ends to the cent/);
  assert.match(html, /<input aria-label="Low \(USD\)"[^>]*inputMode="decimal"[^>]*value="99\.50"/);
  assert.match(html, /<input aria-label="High \(USD\)"[^>]*inputMode="decimal"[^>]*value="99\.99"/);
  assert.match(t, /Catalog price · your offer \$120\.00/);
  assert.match(t, /Service line: yes, from your catalog/);
  // Not a catalog line: Not applicable, never $0.
  assert.match(words(page({ item: reading({ offering_uid: null, catalog_price_cents: null }) })),
    /Catalog price · your offer Not applicable Not a catalog service line/);
});

test('the reading is said in plain words: age, sample and what a count is not', () => {
  const t = words(page({ item: reading({ comparable_count: 5, ran_at: ago(138) }) }));
  assert.match(t, /What this reading says .*Age\. You ran it on .*, 138 days ago\. That is past 90 days, so it is stale/);
  assert.match(t, /Sample\. 5 comparable engagements\. Fewer than 6 is a thin base/);
  assert.match(t, /What it is not\. A count is not a list of named engagements, and it does not show demand for this work\./);
  assert.match(plainWords({ ranAt: ago(0), days: 0, band: 'current', comparableCount: 7 }).age, /, today\. Readings start ageing after 30 days/);
  assert.doesNotMatch(plainWords({ ranAt: ago(40), days: 40, band: 'ageing', comparableCount: 7, ownRecord: true }).age, /attachable/);
});

test('each correction sits under its field, tied by aria-describedby, and the inputs stay as typed', () => {
  const form = { ...readingFields(reading()), low: '99.505', high: '', n: '0', ran_at: '' };
  const { errors } = readingSubmission(reading(), form);
  const html = page({ form, errors });
  assert.match(html, /<input aria-label="Low \(USD\)"[^>]*aria-invalid="true"[^>]*aria-describedby="mr-low-error"[^>]*value="99\.505"/);
  assert.match(html, /id="mr-low-error"[^>]*>.*Use dollars and cents: two digits after the point at most\. 99\.505 is not rounded for you\./);
  assert.match(html, /id="mr-high-error"[^>]*>.*Enter the high\. A range needs both ends\./);
  assert.match(html, /id="mr-n-error"[^>]*>.*a whole number, 1 or more\. Refused if 0\./);
  assert.match(html, /id="mr-ran_at-error"[^>]*>.*A reading needs the date you ran it\./);
  // No errors, no describedby.
  assert.doesNotMatch(page(), /aria-describedby="mr-/);
});

test('a failed save keeps the inputs and says why; a stored reading opens with its notice', () => {
  const form = readingFields(reading());
  const failed = page({ form, fail: NO_ANSWER });
  assert.match(words(failed), /This reading was not saved\.\s?StudioOS did not answer, so nothing was recorded\. Your entries are still here, to the cent\./);
  assert.match(failed, /value="99\.50"/);
  assert.equal(saveFailure(new Error('network')), NO_ANSWER);
  assert.equal(saveFailure(Object.assign(new Error('x'), { status: 404, code: 'not_found' })),
    'That service line is not in your catalog, so nothing was saved.');
  const ok = words(page({ notice: { ok: true, title: RECORDED.opened, text: recordedLine(reading({ ran_at: '2026-11-16' })) } }));
  assert.match(ok, /✓ Recorded\. This is the reading as stored\.\s?\$99\.50 – \$99\.99 from 7 comparables, run 2026-11-16\./);
  // Saving locks the fields; the button says so.
  const busy = page({ busy: true });
  assert.match(busy, /<input aria-label="Low \(USD\)"[^>]*readOnly=""/);
  assert.match(words(busy), /Recording…/);
  // A save arriving from the list announces the stored reading; the page's own save the new record.
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/research/MarketReading.jsx'), 'utf8'));
  assert.match(src, /arrived = useRef\(Boolean\(location\.state\?\.recorded\)\)/);
  assert.match(src, /if \(arrived\.current\) \{\s*arrived\.current = false;\s*setNotice\(\{ ok: true, focus: true, title: RECORDED\.opened, text: recordedLine\(full\.item\) \}\);/);
  assert.match(src, /title: RECORDED\.fresh, text: recordedLine\(saved\?\.item \|\| \{\}\)/);
});

test('a fresh reading is titled so, blanks the dollars, and the record button is held above the phone keyboard', () => {
  const t = words(page({ fresh: true, form: { ...readingFields(reading()), low: '', high: '' } }));
  assert.match(t, /Record a fresh reading Keeps what it prices, the scope and the count you last used\./);
  const html = page();
  const btn = /<button type="submit" class="([^"]*)"/.exec(html)[1];
  for (const token of ['max-xl:sticky', 'max-xl:bottom-2', 'max-xl:min-h-[48px]']) assert.ok(btn.split(/\s+/).includes(token), token);
});

test('the directory form takes a scope, a correction under each field, and keeps a failed save on screen', () => {
  const form = { offering_uid: '', metric: '', scope: 'One update', low: '99.50', high: '', n: '7', ran_at: '2026-11-16' };
  const errors = { metric: 'Name what the range prices.', high: 'Enter the high. A range needs both ends.' };
  const html = renderToStaticMarkup(h(RecordReading, { form, errors, note: { ok: false, text: NO_ANSWER }, onChange() {}, onCancel() {}, onSave() {} }));
  assert.match(html, /<input aria-label="Scope"[^>]*value="One update"/);
  assert.match(html, /aria-describedby="rr-high-error"/);
  assert.match(words(html), /Enter the high\. A range needs both ends\./);
  assert.match(words(html), /This reading was not saved\.\s?StudioOS did not answer/);
  assert.match(html, /value="99\.50"/);
  assert.match(html, /<input aria-label="Low \(USD\)"[^>]*inputMode="decimal"/);
});

test('a save on the list opens the stored reading with its notice; no answer keeps the form with the reason', async () => {
  const went = [];
  const form = { offering_uid: '', metric: 'Intro call', scope: '', low: '99.50', high: '99.99', n: '7', ran_at: '2026-11-16' };
  const sent = [];
  const ok = await submitReading(form, { create: async (b) => { sent.push(b); return { item: { uid: 'r9' } }; }, go: (to, opts) => went.push([to, opts]) });
  assert.deepEqual(went, [['/research/markets/r9', { state: { recorded: true } }]]);
  assert.equal(ok.opened, '/research/markets/r9');
  assert.equal(sent[0].range_low_cents, 9950);
  assert.equal(sent[0].range_high_cents, 9999);
  const lost = await submitReading(form, { create: async () => { throw new Error('Failed to fetch'); }, go: () => went.push('x') });
  assert.deepEqual(lost, { ok: false, text: NO_ANSWER, failed: true });
  assert.equal(went.length, 1);
});
