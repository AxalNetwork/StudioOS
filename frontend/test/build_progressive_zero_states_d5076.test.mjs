/**
 * D5076 (#5076) — Build's six module pages draw by how much is recorded:
 * zero → one guided first action; few → rows with minimal controls; many
 * (from 10, or while searching) → search, filters, sort and pages. Desktop
 * and phone follow the same stages; other cycles keep D661's full table.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_progressive_zero_states_d5076.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import CycleModulePage, { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import { LIST_CONTROLS_FROM, PROGRESSIVE, dominantAdd, fewCountLabel, listStage, progressiveFor } from '../src/pages/cycles/progressiveList.js';
import { FORMS } from '../src/pages/cycles/forms.js';

const html = (el, entry = '/build/solution-design') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (s, re) => (s.match(re) || []).length;

const SIX = ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'];
const cols = [{ key: 'name', label: 'Feature' }, { key: 'state', label: 'State' }];
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, cells: { name: `Feature ${i + 1}`, state: 'Planned' } }));
const recs = (n, extra = {}) => ({
  cols, rows: rowsOf(Math.min(n, 25)), total: n, page: 1, page_size: 25,
  filters: [{ key: 'linked', label: 'Linked', options: [{ value: 'pain', label: 'Pain linked' }] }],
  sorts: [{ key: 'updated', label: 'Updated' }],
  ...extra,
});
const ADD = [{ text: 'Add feature', href: '/build/solution-design/new' }];
const card = (next = { text: 'Add feature', href: '/build/solution-design?add=1' }) => ({
  key: 'solution-design', name: 'Solution design', state: 'empty', reason: 'No features recorded yet.', next, charts: [],
});
const module = (n, extra) => ({ card: card(), records: recs(n, extra) });
const action = { label: 'Connect a tool', href: '/build/connect' };

test('the stages: zero only on a measured 0, controls from LIST_CONTROLS_FROM, a search always keeps them', () => {
  assert.equal(LIST_CONTROLS_FROM, 10);
  assert.equal(listStage(recs(0)), 'zero');
  assert.equal(listStage(recs(1)), 'few');
  assert.equal(listStage(recs(LIST_CONTROLS_FROM - 1)), 'few');
  assert.equal(listStage(recs(LIST_CONTROLS_FROM)), 'many');
  assert.equal(listStage(recs(0), { q: 'x' }), 'many', 'an empty search result keeps the search so it can be cleared');
  assert.equal(listStage(recs(3), { filter: { linked: 'pain' } }), 'many');
  assert.equal(listStage({ cols, rows: [] }), 'many', 'no total and no rows is not a measured zero');
  assert.equal(listStage(null), 'many', 'an absent read is never zero');
  assert.equal(listStage({ cols, rows: rowsOf(2) }), 'few', 'no total: judged by the rows sent');
  assert.equal(fewCountLabel(recs(1), PROGRESSIVE.build['solution-design']), '1 feature');
  assert.equal(fewCountLabel(recs(3), PROGRESSIVE.build['solution-design']), '3 features');
});

test('the six Build modules, and only they, are progressive; each has one dominant action and a founder outcome', () => {
  assert.deepEqual(Object.keys(PROGRESSIVE.build), SIX);
  for (const slug of SIX) {
    const c = progressiveFor('build', slug);
    assert.ok(c.heading && c.outcome && c.action && c.one && c.many, slug);
    assert.doesNotMatch(`${c.heading} ${c.outcome} ${c.action}`, /advisor|advice|recommend|fiduciary/i, `${slug}: Eadwyn's voice`);
    assert.ok(FORMS.build?.[slug]?.length >= 1, `${slug}: the dominant action relabels an existing Add (no new write)`);
  }
  assert.equal(progressiveFor('validate', 'solution-design'), null);
  assert.equal(progressiveFor('build', 'toString'), null);
  assert.equal(progressiveFor('constructor', 'x'), null);
  const add = dominantAdd(ADD, null, progressiveFor('build', 'solution-design'));
  assert.deepEqual(add, { text: 'Add your first feature', href: '/build/solution-design/new' }, 'same href, new label');
});

test('zero (desktop): one first action, no search, filters, sort, column header, "0 of 0" or second Add', () => {
  const out = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: module(0), add: ADD, action, query: {} }));
  const t = text(out);
  assert.match(out, /data-stage="zero"/);
  assert.match(t, /Design the solution from what you validated/);
  assert.match(t, /Name the features that answer the pains/);
  assert.equal(count(out, /data-testid="records-zero-action"/g), 1);
  assert.match(out, /href="\/build\/solution-design\/new"[^>]*>Add your first feature</);
  assert.doesNotMatch(out, /role="search"|aria-label="Sort"|aria-label="Linked"|role="columnheader"/);
  assert.doesNotMatch(t, /0 of 0|No records yet/);
  assert.doesNotMatch(t, /Add feature/, 'the card\'s "Add feature ›" and the table\'s Add give way to the one first action');
  assert.doesNotMatch(out, /data-testid="cycle-action"/, 'the header\'s Connect a tool gives way too');
  const other = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: { card: card({ text: 'Open the pains', href: '/validate/pains' }), records: recs(0) }, add: ADD, action, query: {} }));
  assert.doesNotMatch(text(other), /Open the pains/, 'at zero no other step competes with the first action');
});

test('zero (desktop): connector parts move into a closed Sources region below the first action', () => {
  const out = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: module(0), add: ADD, action, query: {} },
    h('div', { 'data-testid': 'build-part-github' }, 'From GitHub')));
  assert.match(out, /<details[^>]*data-testid="module-sources"/);
  assert.doesNotMatch(out, /<details[^>]* open/);
  assert.ok(out.indexOf('records-zero-action') < out.indexOf('module-sources'), 'the first action comes first');
  assert.ok(out.indexOf('module-sources') < out.indexOf('build-part-github'), 'the part sits inside Sources');
});

test('zero (desktop): another form\'s Add stays, as a subordinate link under the one first action', () => {
  const out = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: module(0), add: [...ADD, { text: 'Add risk', href: '/build/solution-design/new?form=risk' }], action, query: {} }));
  assert.equal(count(out, /data-testid="records-zero-action"/g), 1);
  assert.match(out, /data-testid="records-zero-secondary-add"[^>]*>Add risk</);
  assert.doesNotMatch(out, /data-testid="records-add"/);
});

test('few (desktop): rows with one Add and a plain count; no search, filters, sort or pages', () => {
  const out = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: module(3), add: [...ADD, { text: 'Import features', href: '/x' }], action, query: {} },
    h('div', { 'data-testid': 'build-part-github' }, 'From GitHub')));
  const t = text(out);
  assert.match(out, /data-stage="few"/);
  assert.match(t, /Feature 1 .*Feature 3/);
  assert.match(t, /3 features/);
  assert.doesNotMatch(t, /1–3 of 3/);
  assert.equal(count(out, /data-testid="records-add"/g), 2, 'each form\'s Add once: Add feature and Import features');
  assert.equal(count(text(out), /Add feature/g), 1, 'the card\'s "Add feature ›" is the table\'s Add, drawn once');
  assert.doesNotMatch(out, /role="search"|aria-label="Sort"|aria-label="Linked"|aria-label="Pages"/);
  assert.doesNotMatch(out, /module-sources/, 'parts draw in place once there is work');
  assert.match(out, /data-testid="cycle-action"/);
});

test('many (desktop): from 10 records, search, filters, sort, range and pages return', () => {
  const out = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: module(30), add: ADD, action, query: {} }));
  assert.match(out, /data-stage="many"/);
  assert.match(out, /role="search"/);
  assert.match(out, /aria-label="Sort"/);
  assert.match(out, /aria-label="Linked"/);
  assert.match(out, /aria-label="Pages"/);
  assert.match(text(out), /1–25 of 30/);
});

test('an unreadable records read stays Unreadable on a progressive module, never a zero state', () => {
  const out = html(h(RecordsTable, { title: 'Features', records: recs(0), status: 'unreadable', message: 'D1 did not answer.', progressive: progressiveFor('build', 'solution-design') }));
  assert.doesNotMatch(out, /records-zero/);
  assert.match(text(out), /could not be read|D1 did not answer/i);
  const page = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: { card: card() }, status: 'ready', records: recs(0), recordsStatus: 'unreadable', add: ADD, action, query: {} }));
  assert.doesNotMatch(page, /records-zero|module-sources/);
  assert.match(page, /data-testid="cycle-action"/);
});

test('other cycles keep D661\'s full table at zero', () => {
  const out = html(h(CycleModulePage, { cycle: 'validate', slug: 'experiments', data: { card: card(), records: recs(0) }, add: ADD, query: {} }), '/validate/experiments');
  assert.doesNotMatch(out, /records-zero|data-stage/);
  assert.match(out, /role="search"/);
  assert.match(text(out), /No records yet/);
});

test('phone follows the same stages', () => {
  const zero = html(h(PhoneModulePage, { cycle: 'build', slug: 'prototype-mvp', data: module(0), add: [{ text: 'Add must-have', href: '/build/prototype-mvp/new' }], query: {} },
    h('div', { 'data-testid': 'build-part-github' }, 'From GitHub')), '/build/prototype-mvp');
  const zt = text(zero);
  assert.match(zero, /data-stage="zero"/);
  assert.match(zt, /Decide what the first version must do/);
  assert.match(zt, /List the few must-haves/);
  assert.equal(count(zero, /data-testid="phone-module-cta"/g), 1);
  assert.match(zero, /href="\/build\/prototype-mvp\/new"[^>]*>Add your first must-have</);
  assert.doesNotMatch(zero, /phone-module-controls|phone-module-empty|phone-module-records|role="search"/);
  assert.doesNotMatch(zt, /0 of 0|Add feature ›/);
  assert.match(zero, /data-testid="module-sources"/);

  const few = html(h(PhoneModulePage, { cycle: 'build', slug: 'prototype-mvp', data: module(4), add: [{ text: 'Add must-have', href: '/build/prototype-mvp/new' }], query: {} }), '/build/prototype-mvp');
  assert.match(few, /data-stage="few"/);
  assert.doesNotMatch(few, /phone-module-controls|phone-module-pages/);
  assert.match(text(few), /4 must-haves/);

  const many = html(h(PhoneModulePage, { cycle: 'build', slug: 'prototype-mvp', data: module(40), add: [{ text: 'Add must-have', href: '/build/prototype-mvp/new' }], query: {} }), '/build/prototype-mvp');
  assert.match(many, /data-stage="many"/);
  assert.match(many, /phone-module-controls/);
  assert.match(many, /phone-module-pages/);
});
