/**
 * D6100 (#6100) — Grow's Product improvement and Revenue and traction take
 * D5076's first-use state: one heading, one outcome line, the module's own
 * form button as the single action, and the connector parts folded under
 * "Bring it in from your tools". An unreadable read never shows it. Phone
 * draws the same copy.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_progressive_zero_states_d6100.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import CycleModulePage, { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import { PROGRESSIVE, fewCountLabel, listStage, progressiveFor } from '../src/pages/cycles/progressiveList.js';
import { FORMS } from '../src/pages/cycles/forms.js';

const html = (el, entry) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (s, re) => (s.match(re) || []).length;

const FOLD = 'Bring it in from your tools';
const cols = [{ key: 'kpi', label: 'KPI' }, { key: 'value', label: 'Value' }];
const recs = (n) => ({
  cols, rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, cells: { kpi: `Row ${i + 1}`, value: 1 } })),
  total: n, page: 1, page_size: 25, filters: [{ key: 'status', label: 'Status', options: [{ value: 'open', label: 'Open' }] }], sorts: [{ key: 'theme', label: 'Theme' }],
});
const card = (slug) => ({ key: slug, name: slug, state: 'empty', reason: 'Nothing recorded yet.', charts: [] });
const MODULES = {
  'product-improvement': {
    heading: 'Hear what your customers ask for', action: 'Log feedback', parts: ['From Notion', 'From PostHog'],
  },
  'revenue-and-traction': {
    heading: 'Record the numbers that show traction', action: 'Enter a KPI', parts: ['From Mercury', 'From Google', 'From PostHog'],
  },
};
const addFor = (slug) => FORMS.grow[slug].map((f) => ({ text: f.button, href: `/grow/${slug}/new` }));
const parts = (names) => names.map((n) => h('div', { key: n, 'data-testid': 'grow-part' }, n));

test('both Grow modules are listed, with D5076\'s fold label and the form\'s own button as the action', () => {
  // D6123 adds Grow's four zero-only modules after these two; D6100's two keep all three stages.
  assert.deepEqual(Object.keys(PROGRESSIVE.grow).slice(0, 2), Object.keys(MODULES));
  for (const slug of Object.keys(MODULES)) assert.equal(PROGRESSIVE.grow[slug].zeroOnly, undefined);
  for (const [slug, m] of Object.entries(MODULES)) {
    const c = progressiveFor('grow', slug);
    assert.equal(c.heading, m.heading);
    assert.equal(c.action, m.action);
    assert.equal(c.fold, FOLD);
    assert.ok(c.outcome && !/[!]|\b(unlock|supercharge|seamless)\b/i.test(c.outcome), 'a plain outcome line');
    assert.equal(FORMS.grow[slug][0].button, m.action, 'the single action is the module\'s existing form, unrelabelled');
  }
  assert.equal(progressiveFor('grow', 'distribution'), null, 'the other Grow modules keep the full table');
  assert.equal(progressiveFor('build', 'solution-design').fold, undefined, 'Build keeps D5077\'s Sources label');
  assert.equal(fewCountLabel(recs(1), PROGRESSIVE.grow['product-improvement']), '1 piece of feedback');
  assert.equal(fewCountLabel(recs(3), PROGRESSIVE.grow['revenue-and-traction']), '3 KPIs');
});

for (const [slug, m] of Object.entries(MODULES)) {
  test(`${slug} (desktop) with nothing recorded: one heading, one line, one action, the tools folded`, () => {
    const out = html(h(CycleModulePage, { cycle: 'grow', slug, data: { card: card(slug), records: recs(0) }, add: addFor(slug), query: {} }, parts(m.parts)), `/grow/${slug}`);
    const t = text(out);
    assert.match(out, /data-stage="zero"/);
    assert.equal(count(out, /data-testid="records-zero"/g), 1);
    assert.match(t, new RegExp(m.heading));
    assert.match(out, new RegExp(`data-testid="records-zero-action"[^>]*>${m.action}<`));
    assert.equal(count(out, /data-testid="records-zero-action"/g), 1);
    assert.doesNotMatch(out, /data-testid="records-add"|role="search"|aria-label="Sort"|aria-label="Status"|records-empty/);
    assert.doesNotMatch(t, /No records yet|0 of 0/);
    assert.match(out, new RegExp(`<details[^>]*data-testid="module-sources" data-stage="zero"><summary[^>]*><span>${FOLD}</span>`));
    for (const p of m.parts) assert.match(t, new RegExp(p), `${p} stays reachable inside the fold`);
    assert.ok(out.indexOf('<details') < out.indexOf(m.parts[0]), 'the parts sit inside the closed fold');
  });

  test(`${slug} (phone) uses the same copy`, () => {
    const out = html(h(PhoneModulePage, { cycle: 'grow', slug, data: { card: card(slug), records: recs(0) }, add: addFor(slug), query: {} }, parts(m.parts)), `/grow/${slug}`);
    const t = text(out);
    assert.match(out, /data-stage="zero"/);
    assert.match(t, new RegExp(m.heading));
    assert.match(out, /data-testid="phone-module-outcome"/);
    assert.match(t, new RegExp(PROGRESSIVE.grow[slug].outcome.slice(0, 30)));
    assert.equal(count(out, /data-testid="phone-module-cta"/g), 1);
    assert.match(t, new RegExp(m.action));
    assert.doesNotMatch(out, /phone-module-controls|phone-module-empty|role="search"/);
    assert.match(out, new RegExp(`<span>${FOLD}</span>`));
  });
}

test('an unreadable read never shows the first-use state', () => {
  const slug = 'product-improvement';
  // The adapter's shape for `records_state: 'unreadable'` (adapters/index.js): no total, no rows.
  const dead = { state: 'unreadable', reason: 'Unreadable: feedback could not be read', cols: [], rows: [] };
  assert.equal(listStage(dead), 'many');
  assert.equal(listStage({ ...dead, total: 0 }), 'many', 'even a read that also says 0 is not a measured zero');
  for (const status of ['ready', undefined]) {
    const page = html(h(CycleModulePage, { cycle: 'grow', slug, data: { card: card(slug) }, status: 'ready', records: { ...dead, total: 0 },
      recordsStatus: status === undefined ? 'unreadable' : undefined, recordsMessage: dead.reason, add: addFor(slug), query: {} }, parts(['From Notion'])), `/grow/${slug}`);
    assert.doesNotMatch(page, /records-zero|data-stage="zero"/);
    assert.doesNotMatch(page, new RegExp(FOLD));
    const phone = html(h(PhoneModulePage, { cycle: 'grow', slug, data: { card: card(slug) }, status: 'ready', records: { ...dead, total: 0 },
      recordsStatus: status === undefined ? 'unreadable' : undefined, add: addFor(slug), query: {} }, parts(['From Notion'])), `/grow/${slug}`);
    assert.doesNotMatch(phone, /data-stage="zero"|phone-module-outcome/);
    assert.doesNotMatch(phone, new RegExp(FOLD));
  }
  const table = html(h(RecordsTable, { title: 'Feedback', records: recs(0), status: 'unreadable', message: 'D1 did not answer.', progressive: progressiveFor('grow', slug) }), `/grow/${slug}`);
  assert.doesNotMatch(table, /records-zero/);
  assert.match(text(table), /D1 did not answer/);
  const whole = html(h(CycleModulePage, { cycle: 'grow', slug, data: null, status: 'unreadable', add: addFor(slug), query: {} }), `/grow/${slug}`);
  assert.doesNotMatch(whole, /records-zero|data-stage="zero"/);
});

test('with records, Grow modules leave the first-use state: few keeps the rows, many the full table', () => {
  const few = html(h(CycleModulePage, { cycle: 'grow', slug: 'revenue-and-traction', data: { card: card('revenue-and-traction'), records: recs(2) }, add: addFor('revenue-and-traction'), query: {} }, parts(['From Mercury'])), '/grow/revenue-and-traction');
  assert.match(few, /data-stage="few"/);
  assert.match(text(few), /2 KPIs/);
  assert.doesNotMatch(few, new RegExp(FOLD));
  const many = html(h(CycleModulePage, { cycle: 'grow', slug: 'product-improvement', data: { card: card('product-improvement'), records: recs(12) }, add: addFor('product-improvement'), query: {} }), '/grow/product-improvement');
  assert.match(many, /data-stage="many"/);
  assert.match(many, /role="search"/);
});
