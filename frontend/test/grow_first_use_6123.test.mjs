/**
 * #6123 (D6123) — Grow's Talent roles, Partners, Markets and Obligations pages take D5076's first-use state at
 * zero records: one heading, one outcome line, the module's own form button as the one action, and the connector
 * parts folded under "Bring it in from your tools". These four are zero-only: with one record or more the page is
 * the full table, unchanged (no 'few' stage). Phone draws the same copy.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_first_use_6123.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import { PROGRESSIVE, listStage, moduleStage, progressiveFor } from '../src/pages/cycles/progressiveList.js';
import { FORMS } from '../src/pages/cycles/forms.js';

const html = (el, entry) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (s, re) => (s.match(re) || []).length;

const FOLD = 'Bring it in from your tools';
const cols = [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }];
const recs = (n) => ({
  cols, rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, cells: { name: `Row ${i + 1}`, status: 'Open' } })),
  total: n, page: 1, page_size: 25, filters: [{ key: 'status', label: 'Status', options: [{ value: 'open', label: 'Open' }] }], sorts: [{ key: 'name', label: 'Name' }],
});
const card = (slug) => ({ key: slug, name: slug, state: 'empty', reason: 'Nothing recorded yet.', charts: [] });
const MODULES = {
  'team-expansion': 'Open a role',
  'partner-network': 'Add partner',
  'market-expansion': 'Add market',
  'durable-company-building': 'Add obligation',
};
const addFor = (slug) => FORMS.grow[slug].map((f) => ({ text: f.button, href: `/grow/${slug}/new` }));
const parts = [h('div', { key: 'm', 'data-testid': 'grow-part' }, 'From Mercury')];
const page = (Comp, slug, n) => html(h(Comp, { cycle: 'grow', slug, data: { card: card(slug), records: recs(n) }, add: addFor(slug), query: {} }, parts), `/grow/${slug}`);

test('the four modules are listed zero-only, each with its form\'s own button as the action and D5076\'s fold', () => {
  for (const [slug, action] of Object.entries(MODULES)) {
    const c = progressiveFor('grow', slug);
    assert.ok(c, `${slug} has first-use copy`);
    assert.equal(c.zeroOnly, true);
    assert.equal(c.fold, FOLD);
    assert.equal(c.action, action);
    assert.equal(FORMS.grow[slug][0].button, action, 'the action is the existing form, unrelabelled');
    assert.ok(c.heading && c.outcome && !/[!]|\b(unlock|supercharge|seamless)\b/i.test(c.outcome), 'one plain heading and outcome line');
  }
  assert.equal(progressiveFor('grow', 'distribution'), null, 'Distribution keeps the full table');
});

test('moduleStage: zero stays zero, and a zero-only module has no few stage', () => {
  const copy = PROGRESSIVE.grow['market-expansion'];
  assert.equal(moduleStage(recs(0), {}, copy), 'zero');
  assert.equal(listStage(recs(3)), 'few');
  assert.equal(moduleStage(recs(3), {}, copy), 'many', 'one to nine records keep the full table');
  assert.equal(moduleStage(recs(3), {}, PROGRESSIVE.grow['product-improvement']), 'few', 'D6100\'s modules keep their few stage');
  assert.equal(moduleStage({ state: 'unreadable', rows: [], total: 0 }, {}, copy), 'many', 'an unreadable read is never zero');
});

for (const [slug, action] of Object.entries(MODULES)) {
  test(`${slug} (desktop): zero records show one action with the tools folded; one record leaves the table unchanged`, () => {
    const zero = page(CycleModulePage, slug, 0);
    const t = text(zero);
    assert.match(zero, /data-stage="zero"/);
    assert.match(t, new RegExp(PROGRESSIVE.grow[slug].heading));
    assert.equal(count(zero, /data-testid="records-zero-action"/g), 1);
    assert.match(zero, new RegExp(`data-testid="records-zero-action"[^>]*>${action}<`));
    assert.doesNotMatch(zero, /data-testid="records-add"|role="search"|aria-label="Sort"|records-empty/);
    assert.match(zero, new RegExp(`<details[^>]*data-testid="module-sources" data-stage="zero"><summary[^>]*><span>${FOLD}</span>`));
    assert.ok(zero.indexOf('<details') < zero.indexOf('From Mercury'), 'the connector part sits inside the closed fold');

    const one = page(CycleModulePage, slug, 1);
    assert.match(one, /data-testid="cycle-records" data-stage="many"/, 'one record: the full working table');
    assert.match(one, /role="search"/);
    assert.doesNotMatch(one, /records-zero|<span>Bring it in from your tools<\/span>/);
  });

  test(`${slug} (phone): the same first-use copy, and the full list with a record`, () => {
    const zero = page(PhoneModulePage, slug, 0);
    const t = text(zero);
    assert.match(zero, /data-stage="zero"/);
    assert.match(t, new RegExp(PROGRESSIVE.grow[slug].heading));
    assert.match(zero, /data-testid="phone-module-outcome"/);
    assert.equal(count(zero, /data-testid="phone-module-cta"/g), 1);
    assert.match(t, new RegExp(action));
    assert.match(zero, new RegExp(`<span>${FOLD}</span>`));
    const one = page(PhoneModulePage, slug, 1);
    assert.match(one, /data-stage="many"/);
    assert.doesNotMatch(one, /phone-module-outcome/);
  });
}
