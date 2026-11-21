/**
 * D6004 (#6004) — Validate's Problem discovery, Customer research and Ideal
 * customer profile draw by how much is recorded, as Build's six do (D5076):
 * zero → one guided first action; few (1–9) → rows and one Add; many (from 10,
 * or while searching) → the full table. A total the read does not carry is
 * never a zero. The module's parts (the stat strips) sit under the first
 * action in the closed Sources region at zero.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_progressive_zero_states_d6004.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import { PROGRESSIVE, dominantAdd, fewCountLabel, listStage, progressiveFor } from '../src/pages/cycles/progressiveList.js';
import { FORMS } from '../src/pages/cycles/forms.js';
import validate from '../src/pages/cycles/defs/validate.jsx';

const html = (el, entry) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (s, re) => (s.match(re) || []).length;

const THREE = ['problem-discovery', 'customer-research', 'ideal-customer-profile'];
const cols = [{ key: 'name', label: 'Name' }, { key: 'state', label: 'State' }];
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, cells: { name: `Row ${i + 1}`, state: 'Open' } }));
const recs = (n, extra = {}) => ({
  cols, rows: rowsOf(Math.min(n, 25)), total: n, page: 1, page_size: 25,
  filters: [{ key: 'status', label: 'Status', options: [{ value: 'open', label: 'Open' }] }],
  sorts: [{ key: 'updated', label: 'Updated' }],
  ...extra,
});
const card = (slug, next = null) => ({ key: slug, name: slug, state: 'empty', reason: 'Nothing recorded yet.', next, charts: [] });
// The cycle's header action, as `defs/validate.jsx` hands it.
const opened = [];
const open = () => opened.push('record');
const action = validate.action('?project=7', open);
// Customer research's Add is the def's Record a session (a lightbox through onOpen); the other two are FORMS.validate's.
const addFor = (slug) => (slug === 'customer-research'
  ? validate.add.get('customer-research')('?project=7', open)
  : FORMS.validate[slug].map((f) => ({ text: f.button, href: `/validate/${slug}/new?project_id=7` })));
const page = (slug, n, extra = {}, children) => html(h(CycleModulePage, {
  cycle: 'validate', slug, data: { card: card(slug, { text: addFor(slug)[0]?.text || addFor(slug).text, href: `/validate/${slug}?add=1` }), records: recs(n, extra.records) },
  add: addFor(slug), action, query: extra.query || {},
}, children), `/validate/${slug}`);
const strip = h('div', { 'data-testid': 'validate-interviews-strip' }, 'Interviews logged');

test('the three Validate modules are progressive, each relabelling its existing Add', () => {
  assert.deepEqual(Object.keys(PROGRESSIVE.validate), THREE);
  for (const slug of THREE) {
    const c = progressiveFor('validate', slug);
    assert.ok(c.heading && c.outcome && c.action && c.one && c.many, slug);
    assert.doesNotMatch(`${c.heading} ${c.outcome} ${c.action}`, /advisor|advice|recommend|fiduciary/i, `${slug}: Eadwyn's voice`);
  }
  assert.ok(FORMS.validate['problem-discovery'].length && FORMS.validate['ideal-customer-profile'].length);
  assert.equal(progressiveFor('validate', 'experiments'), null, 'the other Validate modules keep D661\'s table');
  assert.equal(progressiveFor('validate', 'verdict'), null);
  // Record a session keeps its href and its onOpen; only the label changes.
  const first = dominantAdd(addFor('customer-research'), null, progressiveFor('validate', 'customer-research'));
  assert.equal(first.text, 'Record your first session');
  assert.equal(first.href, '/validate/record?project=7');
  assert.equal(first.onOpen, open);
  assert.equal(fewCountLabel(recs(1), progressiveFor('validate', 'customer-research')), '1 interview');
  assert.equal(fewCountLabel(recs(4), progressiveFor('validate', 'ideal-customer-profile')), '4 segments');
});

test('zero (desktop): one heading, one sentence, one primary action; no list controls, header, count or second Add', () => {
  for (const slug of THREE) {
    const copy = progressiveFor('validate', slug);
    const out = page(slug, 0);
    const t = text(out);
    assert.match(out, /data-stage="zero"/, slug);
    assert.equal(count(out, /<h3/g), 1, `${slug}: one heading`);
    assert.ok(t.includes(copy.heading) && t.includes(copy.outcome), slug);
    assert.equal(count(out, /data-testid="records-zero-action"/g), 1, slug);
    assert.ok(t.includes(copy.action), slug);
    assert.doesNotMatch(out, /role="search"|aria-label="Sort"|aria-label="Status"|role="columnheader"|data-testid="records-add"|data-testid="cycle-action"/, slug);
    assert.doesNotMatch(t, /0 of 0|No records yet/, slug);
  }
});

test('zero (desktop): Customer research\'s first action opens the record lightbox over the page', () => {
  const out = page('customer-research', 0);
  const link = out.match(/<a [^>]*data-testid="records-zero-action"[^>]*>Record your first session</)?.[0] || '';
  assert.match(link, /href="\/validate\/record\?project=7"/, 'the same href as Record a session');
  assert.match(link, /aria-haspopup="dialog"/, 'a plain click opens the lightbox through onOpen');
  assert.doesNotMatch(text(out), /Record a session/, 'the header\'s and the card\'s Record a session give way');
});

test('zero (desktop): the stat strip sits under the first action, in the closed Sources region', () => {
  const out = page('customer-research', 0, {}, strip);
  assert.match(out, /<details[^>]*data-testid="module-sources"/);
  assert.doesNotMatch(out, /<details[^>]* open/);
  assert.ok(out.indexOf('records-zero-action') < out.indexOf('module-sources'));
  assert.ok(out.indexOf('module-sources') < out.indexOf('validate-interviews-strip'));
});

test('few (desktop): rows and one Add, a plain count, no list controls; the strip draws in place', () => {
  for (const slug of THREE) {
    const out = page(slug, 3, {}, strip);
    assert.match(out, /data-stage="few"/, slug);
    assert.match(text(out), /Row 1 .*Row 3/, slug);
    assert.ok(text(out).includes(`3 ${progressiveFor('validate', slug).many}`), slug);
    assert.doesNotMatch(out, /role="search"|aria-label="Sort"|aria-label="Status"|aria-label="Pages"|module-sources/, slug);
    assert.match(out, /validate-interviews-strip/, slug);
    assert.equal(count(out, /data-testid="records-add"/g), 1, `${slug}: one Add`);
  }
  // Record a session is the table's Add and the header's action: drawn once.
  assert.equal(count(text(page('customer-research', 3)), /Record a session/g), 1);
  // A different header action stays.
  assert.match(page('problem-discovery', 3), /data-testid="cycle-action"/);
});

test('many (desktop): from 10, or while searching, the full table', () => {
  for (const slug of THREE) {
    const out = page(slug, 10);
    assert.match(out, /data-stage="many"/, slug);
    assert.match(out, /role="search"/, slug);
    assert.match(out, /aria-label="Sort"/, slug);
  }
  const searched = page('ideal-customer-profile', 0, { query: { q: 'smb' } });
  assert.match(searched, /data-stage="many"/);
  assert.match(searched, /role="search"/);
});

test('a total the read does not carry is never treated as zero', () => {
  assert.equal(listStage({ cols, rows: [] }), 'many');
  const out = page('problem-discovery', 0, { records: { total: undefined } });
  assert.doesNotMatch(out, /records-zero|data-stage="zero"/);
  assert.match(text(out), /Not recorded|No records yet/);
  const unread = html(h(CycleModulePage, { cycle: 'validate', slug: 'customer-research', data: { card: card('customer-research') }, records: recs(0),
    recordsStatus: 'unreadable', add: addFor('customer-research'), action, query: {} }), '/validate/customer-research');
  assert.doesNotMatch(unread, /records-zero|module-sources/);
});

test('phone follows the same stages, with Record a session as its one CTA', () => {
  const zero = html(h(PhoneModulePage, { cycle: 'validate', slug: 'customer-research', data: { card: card('customer-research'), records: recs(0) },
    add: addFor('customer-research'), query: {} }, strip), '/validate/customer-research');
  const zt = text(zero);
  assert.match(zero, /data-stage="zero"/);
  assert.ok(zt.includes(PROGRESSIVE.validate['customer-research'].heading));
  assert.equal(count(zero, /data-testid="phone-module-cta"/g), 1);
  assert.match(zero, /href="\/validate\/record\?project=7"[^>]*>Record your first session</);
  assert.doesNotMatch(zero, /phone-module-controls|phone-module-empty|phone-module-records|role="search"/);
  assert.ok(zero.indexOf('module-sources') < zero.indexOf('validate-interviews-strip'));

  const few = html(h(PhoneModulePage, { cycle: 'validate', slug: 'ideal-customer-profile', data: { card: card('ideal-customer-profile'), records: recs(2) },
    add: addFor('ideal-customer-profile'), query: {} }), '/validate/ideal-customer-profile');
  assert.match(few, /data-stage="few"/);
  assert.doesNotMatch(few, /phone-module-controls/);
  assert.match(text(few), /2 segments/);
});
