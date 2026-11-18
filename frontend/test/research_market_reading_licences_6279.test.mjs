/**
 * #6279 — the Market reading page and the "Record a reading" form, per licence.
 *
 * Proposals are the quotes a partner profile owns, so a founder or an investor
 * reads none. Their page draws no Proposal tile, pill or card and says in one
 * line what a reading is for them; partner and advisor keep the attachment
 * card. The form offers a Service line picker only when the caller has service
 * lines, and the draft pill is named in plain words.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_market_reading_licences_6279.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { MarketReadingView } from '../src/pages/research/MarketReading.jsx';
import { Readings, readingForm } from '../src/pages/research/MarketDirectoryZone.jsx';
import { OWN_RECORD_LINE, attachesNowhere, readingFields } from '../src/pages/research/marketReadingRead.js';

const h = React.createElement;
// The page ages a reading against today, so run dates are counted back from it.
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); // clock-ok: relative
const reading = (o = {}) => ({
  uid: 'rm_4k2',
  metric: 'Design system build',
  offering_uid: null,
  scope: 'Design & product services',
  range_low_cents: 3_800_000,
  range_high_cents: 6_200_000,
  comparable_count: 11,
  catalog_price_cents: null,
  ran_at: ago(24),
  ...o,
});
const QUOTES = [{ id: 7, status: 'sent', proposal_name: 'Website rebuild' }];

const routed = (el, path) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
function page({ role, item = reading(), attachments = [], proposals = [] }) {
  return routed(h(MarketReadingView, {
    role, payload: { item, attachments, proposals }, form: readingFields(item),
  }), '/research/markets/rm_4k2');
}
const words = (html) => renderedText(html.replace(/></g, '> <')).replace(/\s+/g, ' ').trim();
const PARTNER_ONLY = /partner profile|quote/i;

// D7174: an investor reads no pricing readings (D6273 Q2, RS-17; D7039 RMP-11,
// the owner's answer A). Whatever the payload holds, the page says the reading
// is not on their list and draws no figure, tile or form.
test('investor: the reading page draws no reading, only "not on your list"', () => {
  for (const days of [24, 130]) {
    const html = page({ role: 'investor', item: reading({ ran_at: ago(days) }), proposals: QUOTES });
    const text = words(html);
    assert.match(text, /This reading is not on your list\. Readings are private to whoever recorded them\./);
    assert.doesNotMatch(text, /\$38,000|Comparable range|Record this reading|Design system build|Draft, not saved/);
    assert.ok(!html.includes('data-testid="market-reading-tiles"'));
    assert.ok(!html.includes('<input'), 'an investor is offered a form');
  }
});

for (const role of ['founder']) {
  test(`${role}: no proposal card, tile or pill, and one line says what a reading is`, () => {
    for (const days of [24, 42, 130]) {
      const html = page({ role, item: reading({ ran_at: ago(days) }) });
      const text = words(html);
      assert.doesNotMatch(text, PARTNER_ONLY, `${role} at ${days} d reads a partner sentence`);
      assert.ok(!html.includes('data-testid="market-reading-attachment"'), `${role} at ${days} d draws the Proposal attachment card`);
      assert.doesNotMatch(text, /Proposal attachment|No proposal|Attachable|Re-run before attaching|onto any proposal|still attachable/);
      assert.match(text, /Both are kept with the reading\./);
      assert.ok(!html.includes('>Proposal</div>'), `${role} at ${days} d draws the Proposal tile`);
      assert.ok(text.includes(OWN_RECORD_LINE[role]), `${role} at ${days} d does not say what a reading is`);
      assert.doesNotMatch(text, /ZONEDRAFT/);
      assert.match(text, /Draft, not saved/);
    }
    // Stale, the fresh-reading control is still offered beside that line.
    const stale = words(page({ role, item: reading({ ran_at: ago(130) }) }));
    assert.match(stale, /Record a fresh reading/);
    // A founder or investor read that does carry a proposal keeps the card.
    const carried = page({ role, proposals: QUOTES });
    assert.ok(carried.includes('data-testid="market-reading-attachment"'));
    assert.ok(!carried.includes('data-testid="market-reading-own-record"'));
  });
}

for (const role of ['partner', 'advisor']) {
  test(`${role}: the attachment card, tile and pill are unchanged`, () => {
    const none = page({ role });
    assert.ok(none.includes('data-testid="market-reading-attachment"'));
    assert.ok(!none.includes('data-testid="market-reading-own-record"'));
    assert.ok(none.includes('>Proposal</div>'), 'the Proposal tile is gone');
    const text = words(none);
    assert.match(text, /No proposal on this account\. A reading attaches to a quote your partner profile owns\./);
    assert.match(text, /No proposal to attach to/);
    assert.match(text, /Both travel onto any proposal\./);
    assert.match(text, /Draft, not saved/);
    assert.doesNotMatch(text, /ZONEDRAFT/);
    for (const line of Object.values(OWN_RECORD_LINE)) assert.ok(!text.includes(line));
    assert.match(words(page({ role, proposals: QUOTES })), /Attach to a proposal/);
  });
}

test('attachesNowhere is founder and investor with nothing on the payload', () => {
  assert.equal(attachesNowhere('investor', {}), true);
  assert.equal(attachesNowhere('founder', { proposals: [], attachments: [] }), true);
  assert.equal(attachesNowhere('investor', { proposals: QUOTES }), false);
  assert.equal(attachesNowhere('founder', { attachments: [{ uid: 'a' }] }), false);
  assert.equal(attachesNowhere('partner', {}), false);
  assert.equal(attachesNowhere('advisor', {}), false);
});

test('"Record a reading" offers a Service line picker only when the caller has service lines', () => {
  const form = readingForm(null, '2026-11-15');
  const record = { form, opened: 0, busy: false, note: null, onOpen() {}, onChange() {}, onCancel() {}, onSave() {} };
  const open = (items) => routed(h(Readings, { readings: { status: 'ready', data: { items } }, record }), '/research/markets');
  // An investor's readings name no catalog offering: free text only.
  const none = open([{ uid: 'rm_1', metric: 'Design system build', offering_uid: null, ran_at: ago(10) }]);
  assert.ok(!none.includes('aria-label="Service line"'), 'a caller with no service lines is offered the picker');
  assert.ok(none.includes('aria-label="What it prices"'));
  assert.ok(!open([]).includes('aria-label="Service line"'));
  // A partner's reading of a catalog line keeps the picker.
  const lines = open([{ uid: 'rm_2', metric: 'Brand refresh', offering_uid: 'o-brand', ran_at: ago(10) }]);
  assert.ok(lines.includes('aria-label="Service line"'));
  assert.match(lines, /<option value="o-brand">Brand refresh<\/option>/);
});
