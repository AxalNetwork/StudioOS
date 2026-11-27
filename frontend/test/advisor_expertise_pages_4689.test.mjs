/**
 * #4689 (Expertise P2) — the Expertise zones read their lists a page at a
 * time, keep every row reachable, and show whole-list figures.
 *
 *   · Visibility: 101 links, "Show more" reaches link 101 and its own
 *     requests; "Booked without a link" is drawn once; a failed next page
 *     keeps what was read and says so.
 *   · The board's summaries read `counts` / `requests`, never the page.
 *   · The paged-list helpers merge rows once and stop at the last page.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_expertise_pages_4689.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, sourceModule, mutationCheck } from './_form_d695.mjs';
import { appendRows, nextOffset, showingLine } from '../src/pages/advisor/expertise/pages.js';
import advisorExpertiseBoard from '../src/workspaces/boards/advisorExpertise.js';

const ZONE = 'pages/advisor/expertise/VisibilityZone.jsx';
const zone = readFileSync(new URL(`../src/${ZONE}`, import.meta.url), 'utf8');
// The zone as it ships, with its api import swapped for a controllable stub.
const source = zone.replace(/^import \{ api \} from '..\/..\/..\/lib\/api';\n/m,
  'export const control = { calls: [], fail: false, page2: null };\n'
  + 'const api = { async getMyAdvisorVisibility(days, page) { control.calls.push([days, page?.offset ?? 0]); return page?.offset ? (control.fail ? { surfaces: null, links: null } : control.page2) : control.page1; } };\n');
assert.notEqual(source, zone, 'the api import was swapped');

const link = (i, requests = 0) => ({ key: `link:l-${i}`, kind: 'booking_link', name: `/b/link-${i}`, audience: 'public', is_active: true, requests, by_status: requests ? { confirmed: requests } : {}, views: null });
const noLink = { key: 'no_link', kind: 'no_link', name: 'Booked without a link', requests: 1, by_status: { confirmed: 1 }, views: null, note: 'These bookings name no link.' };
const base = { window: { days: 30 }, requests: { total: 4, by_status: { confirmed: 4 } }, writing: { published: 0, opens: 0, opens_note: '', requests: null, requests_note: '' }, views_note: 'v', engagements_note: 'e' };
const page1 = { ...base, surfaces: [...Array.from({ length: 100 }, (_, i) => link(i + 1, i === 0 ? 1 : 0)), noLink], links: { offset: 0, limit: 100, total: 101, next_offset: 100 } };
const page2 = { ...base, surfaces: [link(101, 2), noLink], links: { offset: 100, limit: 100, total: 101, next_offset: null } };

async function showMore(module) {
  module.control.page1 = page1; module.control.page2 = page2; module.control.fail = false; module.control.calls = [];
  const f = await mountForm(h(module.default));
  try {
    await f.flush();
    const first = f.text();
    assert.ok(first.includes('Showing 100 of 101'), 'the zone says rows remain');
    assert.ok(!first.includes('/b/link-101'));
    assert.ok(first.includes('4 requests in the last 30 days, across every link'), 'the total is every link\'s');
    await f.click('Show more');
    await f.flush();
    const after = f.text();
    assert.ok(after.includes('/b/link-101'), 'link 101 is reachable');
    assert.ok(after.includes('2 requests'), 'with its own requests');
    assert.equal(after.split('Booked without a link').length - 1, 1, '"Booked without a link" once');
    assert.ok(after.lastIndexOf('Booked without a link') > after.indexOf('/b/link-101'), 'and last');
    assert.ok(!after.includes('Showing 100 of 101') && !after.includes('Show more'), 'every link read: no more line');
    assert.deepEqual(module.control.calls, [[30, 0], [30, 100]]);
  } finally { await f.unmount(); }
}

async function failedMore(module) {
  module.control.page1 = page1; module.control.fail = true; module.control.calls = [];
  const f = await mountForm(h(module.default));
  try {
    await f.flush();
    await f.click('Show more');
    await f.flush();
    const after = f.text();
    assert.ok(after.includes('The next links could not be read. Try again.'), 'a failed next page says so');
    assert.ok(after.includes('/b/link-100') && after.includes('Showing 100 of 101'), 'and keeps the rows read');
    assert.ok(!after.includes('could not be read ·'), 'the whole block is not marked unreadable');
  } finally { await f.unmount(); }
}

test('Visibility: Show more reaches link 101 with its own requests; no link once, last', async () => {
  await mutationCheck(source, ZONE, showMore, [
    ["return [...list.filter((s) => s.kind !== 'no_link'), ...list.filter((s) => s.kind === 'no_link')];", 'return list;'],
    ['<VisibilityView data={data} onRetry={load} more={list} />', '<VisibilityView data={data} onRetry={load} />'],
    ['return `${n} ${n === 1', 'return null; `${n} ${n === 1'],
    ["key: 'surfaces', pageKey: 'links', rowKey: 'key', counts: isLink,", "key: 'surfaces', pageKey: 'links', rowKey: 'key',"],
  ]);
});

test('Visibility: a failed next page keeps the links read and says so, never "no links"', async () => {
  await mutationCheck(source, ZONE, failedMore, [
    ["if (!Array.isArray(res?.surfaces)) throw new Error('The next links could not be read. Try again.');", ''],
  ]);
});

test('the board summarises the whole list, not the page that came back', () => {
  const board = advisorExpertiseBoard('advisor', {});
  const section = (slug) => board.sections.find((s) => s.slug === slug);
  // One row came back of each list; the counts are the whole list's.
  const services = { items: [{ title: 'A', is_active: true }], page: { offset: 0, limit: 200, total: 201, next_offset: 200 }, counts: { total: 201, live: 150, draft: 51 } };
  assert.equal(section('services').summary(services), '150 live');
  assert.equal(section('services').total(services), 201);
  const proof = { items: [{ title: 'A', status: 'self_stated' }], page: { total: 201 }, counts: { attested: 1, self_stated: 200 } };
  assert.equal(section('proof').summary(proof), '1 confirmed · 200 self-stated');
  const thinking = { items: [{ title: 'A', status: 'draft' }], page: { total: 101 }, counts: { published: 91 } };
  assert.equal(section('thinking').summary(thinking), '91 published');
  assert.equal(section('thinking').total(thinking), 101);
  const visibility = { surfaces: [link(1, 1), noLink], links: { total: 101 }, requests: { total: 4 } };
  assert.equal(section('visibility').summary(visibility), '4 requests');
  assert.equal(section('visibility').total(visibility), 101);
  // An answer with no counts shows no figure, never one counted off the page.
  assert.equal(section('services').summary({ items: [{ is_active: true }] }), null);
  assert.match(section('thinking').footnote(), /each time the piece was opened here/);
  assert.doesNotMatch(section('thinking').footnote(), /counts people who opened/);
});

test('paged-list helpers: rows merge once, the line goes once every row is read', () => {
  assert.deepEqual(appendRows([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(appendRows([{ key: 'a' }], [{ key: 'a' }, { key: 'b' }], 'key').map((r) => r.key), ['a', 'b']);
  assert.equal(nextOffset({ next_offset: 100 }), 100);
  assert.equal(nextOffset({ next_offset: null }), null);
  assert.equal(showingLine(100, { total: 101, next_offset: 100 }), 'Showing 100 of 101');
  assert.equal(showingLine(101, { total: 101, next_offset: null }), null);
});

test('the zones say opens, never people, and read their lists by page', () => {
  const thinking = readFileSync(new URL('../src/pages/advisor/expertise/ThinkingZone.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(thinking, /how many people opened/);
  assert.match(thinking, /how many times it was opened here/);
  for (const page of ['ServicesZone.jsx', 'ProofZone.jsx', 'ThinkingZone.jsx', 'VisibilityZone.jsx']) {
    const src = readFileSync(new URL(`../src/pages/advisor/expertise/${page}`, import.meta.url), 'utf8');
    assert.match(src, /usePagedList\(/, `${page} reads by page`);
    assert.match(src, /<MoreRows /, `${page} offers the next page`);
  }
});

// Imported so a broken module fails here too, not only in the zone tests.
await sourceModule(source, ZONE);
