/**
 * D5377 (#5377) — Capital relationships: Match, Activity and Commitments keep their filters, sort and page in the
 * address, and Pipeline its open Passed column. A reload from the address makes the same read; Back restores the
 * filter set before; a value the tab does not allow reads as its default and is never sent; a filter change goes
 * back to the first page; a venture switch clears them; one tab's filters never ride onto another tab's link.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_url_filters_5377.test.mjs
 */
import './_cycleSteps.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CapRelMatch from '../src/pages/raise/caprel/CapRelMatch.jsx';
import CapRelActivity from '../src/pages/raise/caprel/CapRelActivity.jsx';
import CapRelCommitments from '../src/pages/raise/caprel/CapRelCommitments.jsx';
import CapRelPipeline from '../src/pages/raise/caprel/CapRelPipeline.jsx';
import { TABS, tabHref } from '../src/pages/raise/caprel/capRelModel.js';
import {
  ACTIVITY_FILTERS, COMMITMENT_FILTERS, MATCH_FILTERS, PIPELINE_FILTERS, changeFilters, clearFilters, readFilters, writeFilters,
} from '../src/pages/raise/caprel/capRelUrlFilters.js';

globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const tick = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });

/* ------------------------------------------------------------------ fixtures */

const MATCH = {
  items: [{ uid: 'f-1', name: 'Fund V', hq: 'Germany', sector_focus: 'Robotics', fund_size_cents: null, size_currency: null, fit: { code: 'fits', label: 'Fits' }, warm_paths: [], in_pipeline: null }],
  total: 312, limit: 25, offset: 0,
  facets: { focus: [{ value: 'robotics', label: 'Robotics', count: 40 }], hq_country: [{ value: 'DE', label: 'Germany', count: 20 }], size_band: [{ value: 'lt25', label: 'Under €25M', count: 9 }] },
  verified_investors: { count: 0 },
};
const ACTIVITY = (page = 1) => ({
  items: [{ id: 9, at: '2026-10-21 09:12:00', who: 'Fixture Founder', what: 'Investor edited', investor: { prospect_id: 41, name: 'Bluefern Capital' }, source: 'typed', source_label: 'Typed' }],
  total: 80, page, page_size: 25,
  kinds: [{ value: 'steps', label: 'Steps and next steps' }, { value: 'eadwyn', label: 'Eadwyn' }],
});
const WORDS = { status: { signed: 'Signed', soft: 'Soft', not_recorded: 'Status not recorded' }, source: { typed: 'Typed' } };
const line = (key, status, counted) => ({ key, source: 'typed', source_label: 'Typed', status, status_label: WORDS.status[status], counted, cents: 100000, currency: 'USD', on: '2026-10-17' });
const COMMITMENTS = {
  currency: 'USD', round: { name: 'Seed', target_cents: 1000000, currency: 'USD' },
  totals: { counted_cents: 100000, by_status: {} },
  investors: [
    { key: 'p:1', prospect_id: 1, name: 'Fund K', chosen: line('a', 'signed', true), lines: [line('a', 'signed', true)] },
    { key: 'p:2', prospect_id: 2, name: 'Northwind Angels', chosen: line('b', 'soft', false), lines: [line('b', 'soft', false)] },
  ],
  sources: {}, words: WORDS, basis: '',
};
const PROSPECTS = [
  { id: 41, name: 'Ada', firm: 'Bluefern Capital', stage: 'contacted' },
  { id: 42, name: 'Bo', firm: 'Harbor Seed', stage: 'passed' },
];

function handle(url) {
  if (/capital-relationships\/match/.test(url)) return response(MATCH);
  if (/capital-relationships\/activity/.test(url)) return response(ACTIVITY(Number(/[?&]page=(\d+)/.exec(url)?.[1] || 1)));
  if (/capital-relationships\/commitments/.test(url)) return response(COMMITMENTS);
  if (/raise-closes/.test(url)) return response({ round: null, closes: [] });
  if (/raise-pro-rata/.test(url)) return response({ items: [] });
  if (/raise-prospects/.test(url)) return response({ items: PROSPECTS });
  return response({});
}

/* ------------------------------------------------------------------ mount */

const where = { location: null, navigate: null };
function Probe() {
  where.location = useLocation();
  where.navigate = useNavigate();
  return null;
}

async function mount(Tab, url, projectId = 3) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const reads = [];
  globalThis.fetch = async (u, o = {}) => { if (!o.method || o.method === 'GET') reads.push(String(u).replace(/^.*\/api/, '')); return handle(String(u), o); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const tree = (pid) => h(MemoryRouter, { initialEntries: [url] }, h(Probe), h(Tab, { projectId: pid, search: `?project_id=${pid}` }));
  await act(async () => root.render(tree(projectId)));
  await tick();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  return {
    reads,
    last: (re) => reads.filter((u) => re.test(u)).at(-1),
    search: () => where.location.search,
    entries: () => where.location.key,
    rows: (id) => all(id).map(text),
    prop: (id, k) => props(by(id))[k],
    async change(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value, checked: value } }); }); await tick(); },
    async submit(id, value) {
      const n = by(id); assert.ok(n, `no ${id}`);
      await act(async () => { props(n).onChange({ target: { value } }); });
      await act(async () => { props(n.parentNode).onSubmit({ preventDefault() {} }); });
      await tick();
    },
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {} }); }); await tick(); },
    async back() { await act(async () => { where.navigate(-1); }); await tick(); },
    async venture(pid) { await act(async () => root.render(tree(pid))); await tick(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/** Mount, act, then mount again from the address it ended on: a reload. */
async function reloadFrom(Tab, v) {
  const url = `/raise/capital-relationships/x${v.search()}`;
  await v.close();
  return mount(Tab, url);
}

/* ------------------------------------------------------------------ the model */

test('an address value the tab does not allow reads as its default', () => {
  assert.deepEqual(readFilters(MATCH_FILTERS, '?fit=bogus&sort=drop&offset=7&hq_country=de&focus=Not%20A%20Slug&size_band=huge&warm=yes'),
    { q: '', hq_country: '', focus: '', size_band: '', fit: '', warm: false, sort: 'name', offset: 0 });
  assert.deepEqual(readFilters(MATCH_FILTERS, '?fit=fits&sort=-size&offset=50&hq_country=DE&focus=robotics&size_band=500%2B&warm=1&q=%20deep%20'),
    { q: 'deep', hq_country: 'DE', focus: 'robotics', size_band: '500+', fit: 'fits', warm: true, sort: '-size', offset: 50 });
  assert.deepEqual(readFilters(ACTIVITY_FILTERS, '?kind=drop&investor=0&page=-2'), { q: '', kind: '', investor: '', page: 1 });
  assert.deepEqual(readFilters(ACTIVITY_FILTERS, '?kind=eadwyn&investor=41&page=3'), { q: '', kind: 'eadwyn', investor: '41', page: 3 });
  assert.deepEqual(readFilters(COMMITMENT_FILTERS, '?status=everything'), { q: '', status: '' });
  assert.deepEqual(readFilters(COMMITMENT_FILTERS, '?status=not_recorded'), { q: '', status: 'not_recorded' });
  assert.deepEqual(readFilters(PIPELINE_FILTERS, '?passed=true'), { passed: false });
  assert.equal(readFilters(MATCH_FILTERS, `?q=${'x'.repeat(300)}`).q.length, 100, 'a search is cut to the length the Worker reads');
});

test('a default stays out of the address; every key the tab does not own is kept', () => {
  assert.equal(writeFilters(MATCH_FILTERS, '?project_id=3&moved=1&fit=bogus', { sort: 'name', offset: 0, warm: false, fit: 'fits' }).toString(), 'project_id=3&moved=1&fit=fits');
  assert.equal(writeFilters(ACTIVITY_FILTERS, '?project_id=3', { page: 1, kind: '' }).toString(), 'project_id=3');
  assert.equal(clearFilters(MATCH_FILTERS, '?project_id=4&fit=fits&offset=25&view=list').toString(), 'project_id=4&view=list');
});

test('a filter change resets the page or offset; a page change keeps the filters', () => {
  assert.equal(changeFilters(MATCH_FILTERS, '?project_id=3&fit=fits&offset=50', { fit: 'outside' }).toString(), 'project_id=3&fit=outside');
  assert.equal(changeFilters(MATCH_FILTERS, '?project_id=3&fit=fits', { offset: 25 }).toString(), 'project_id=3&fit=fits&offset=25');
  assert.equal(changeFilters(ACTIVITY_FILTERS, '?project_id=3&page=4', { kind: 'steps' }).toString(), 'project_id=3&kind=steps');
  assert.equal(changeFilters(ACTIVITY_FILTERS, '?project_id=3&page=4', { kind: '' }).toString(), 'project_id=3&page=4', 'no change, no reset');
});

test('a tab link keeps the venture only, so one tab\'s filters never ride onto another tab', () => {
  const here = '?project_id=3&fit=fits&offset=25&kind=steps&status=soft&passed=1&q=deep';
  for (const t of TABS) assert.equal(tabHref(t, here).split('?')[1], 'project_id=3', t.id);
});

/* ------------------------------------------------------------------ Match */

test('Match: the filters are a read; a reload from the address makes the same read; Back restores the set before', async () => {
  let v = await mount(CapRelMatch, '/raise/capital-relationships/match?project_id=3');
  const first = v.last(/match\?/);
  assert.match(first, /match\?project=3&sort=name&limit=25&offset=0$/);
  await v.change('caprel-match-filter-fit', 'fits');
  await v.change('caprel-match-sort', '-size');
  await v.click('caprel-match-next');
  assert.equal(v.search(), '?project_id=3&fit=fits&sort=-size&offset=25');
  const read = v.last(/match\?/);
  assert.match(read, /match\?project=3&fit=fits&sort=-size&limit=25&offset=25$/);
  v = await reloadFrom(CapRelMatch, v);
  try {
    assert.equal(v.reads.filter((u) => /match\?/.test(u)).length, 1, 'one read on reload');
    assert.equal(v.last(/match\?/), read, 'the same read');
    assert.equal(v.prop('caprel-match-filter-fit', 'value'), 'fits');
    assert.equal(v.prop('caprel-match-sort', 'value'), '-size');
  } finally { await v.close(); }

  const b = await mount(CapRelMatch, '/raise/capital-relationships/match?project_id=3&fit=fits');
  try {
    await b.change('caprel-match-filter-fit', 'outside');
    assert.match(b.last(/match\?/), /fit=outside/);
    await b.back();
    assert.equal(b.search(), '?project_id=3&fit=fits');
    assert.match(b.last(/match\?/), /match\?project=3&fit=fits&sort=name&limit=25&offset=0$/, 'Back reads the set before');
    assert.equal(b.prop('caprel-match-filter-fit', 'value'), 'fits');
  } finally { await b.close(); }
});

test('Match: a filter change sends the page back to the first; a search replaces the entry; an invalid address value is never sent', async () => {
  const v = await mount(CapRelMatch, '/raise/capital-relationships/match?project_id=3&fit=bogus&sort=evil&hq_country=de&offset=50');
  try {
    assert.match(v.last(/match\?/), /match\?project=3&sort=name&limit=25&offset=50$/, 'bad values read as the default; the valid offset is kept');
    assert.ok(!v.reads.some((u) => /bogus|evil|hq_country/.test(u)), 'never sent to the Worker');
    await v.change('caprel-match-warm', true);
    assert.equal(v.search(), '?project_id=3&warm=1', 'the offset is reset, and the bad values are dropped with it');
    assert.match(v.last(/match\?/), /match\?project=3&warm=1&sort=name&limit=25&offset=0$/);
    await v.submit('caprel-match-search', 'deep tech');
    assert.equal(v.search(), '?project_id=3&warm=1&q=deep+tech');
    await v.back();
    assert.equal(v.search(), '?project_id=3&fit=bogus&sort=evil&hq_country=de&offset=50', 'the search replaced the warm entry, it did not push one');
  } finally { await v.close(); }
});

test('Match: a venture switch clears the filters, and no read for the new venture carries the old one\'s', async () => {
  const v = await mount(CapRelMatch, '/raise/capital-relationships/match?project_id=3&fit=fits&offset=25');
  try {
    await v.venture(4);
    assert.equal(v.search(), '?project_id=3', 'the filters are gone');
    const four = v.reads.filter((u) => /match\?project=4/.test(u));
    assert.ok(four.length >= 1);
    assert.ok(four.every((u) => /match\?project=4&sort=name&limit=25&offset=0$/.test(u)), four.join('\n'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ Activity */

test('Activity: kind, investor and page are a read; a reload makes the same read; Back restores; a filter resets the page', async () => {
  let v = await mount(CapRelActivity, '/raise/capital-relationships/activity?project_id=3');
  await v.change('caprel-activity-kind', 'steps');
  await v.change('caprel-activity-investor', '41');
  await v.click('caprel-activity-next');
  assert.equal(v.search(), '?project_id=3&kind=steps&investor=41&page=2');
  const read = v.last(/activity\?/);
  assert.match(read, /activity\?project=3&kind=steps&investor=41&page=2$/);
  await v.change('caprel-activity-kind', 'eadwyn');
  assert.equal(v.search(), '?project_id=3&kind=eadwyn&investor=41', 'a filter change goes back to page 1');
  await v.back();
  assert.equal(v.last(/activity\?/), read, 'Back reads the set before');
  v = await reloadFrom(CapRelActivity, v);
  try {
    assert.equal(v.reads.filter((u) => /activity\?/.test(u)).length, 1);
    assert.equal(v.last(/activity\?/), read, 'the same read');
    assert.equal(v.prop('caprel-activity-kind', 'value'), 'steps');
  } finally { await v.close(); }
});

test('Activity: an invalid kind, investor or page reads as the default; a venture switch clears them', async () => {
  const v = await mount(CapRelActivity, '/raise/capital-relationships/activity?project_id=3&kind=drop&investor=x1&page=0');
  try {
    assert.match(v.last(/activity\?/), /activity\?project=3$/);
    await v.venture(4);
    assert.equal(v.search(), '?project_id=3');
    assert.ok(v.reads.filter((u) => /project=4/.test(u)).every((u) => /activity\?project=4$/.test(u)));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ Commitments */

test('Commitments: the status and search are the address\'s; reload and Back restore the same rows; typing replaces the entry', async () => {
  let v = await mount(CapRelCommitments, '/raise/capital-relationships/commitments?project_id=3');
  assert.equal(v.rows('caprel-commit-row').length, 2);
  await v.change('caprel-commit-status', 'soft');
  assert.equal(v.search(), '?project_id=3&status=soft');
  assert.equal(v.rows('caprel-commit-row').length, 1);
  await v.change('caprel-commit-search', 'N');
  await v.change('caprel-commit-search', 'No');
  assert.equal(v.search(), '?project_id=3&status=soft&q=No');
  await v.back();
  assert.equal(v.search(), '?project_id=3', 'two keystrokes replaced the status entry, so one Back is before it');
  assert.equal(v.rows('caprel-commit-row').length, 2);
  await v.close();

  v = await mount(CapRelCommitments, '/raise/capital-relationships/commitments?project_id=3&status=soft&q=north');
  try {
    assert.deepEqual(v.rows('caprel-commit-row').map((t) => t.split(' ').slice(0, 2).join(' ')), ['Investor Northwind']);
    assert.equal(v.prop('caprel-commit-search', 'value'), 'north');
    assert.equal(v.prop('caprel-commit-status', 'value'), 'soft');
    await v.venture(4);
    assert.equal(v.search(), '?project_id=3');
  } finally { await v.close(); }

  const bad = await mount(CapRelCommitments, '/raise/capital-relationships/commitments?project_id=3&status=everything');
  try { assert.equal(bad.rows('caprel-commit-row').length, 2, 'an unknown status is no filter'); } finally { await bad.close(); }
});

/* ------------------------------------------------------------------ Pipeline */

test('Pipeline: the open Passed column is the address\'s, and a venture switch closes it', async () => {
  const v = await mount(CapRelPipeline, '/raise/capital-relationships/pipeline?project_id=3&passed=1');
  try {
    assert.equal(v.prop('caprel-passed-toggle', 'aria-expanded'), true);
    await v.click('caprel-passed-toggle');
    assert.equal(v.search(), '?project_id=3');
    await v.click('caprel-passed-toggle');
    assert.equal(v.search(), '?project_id=3&passed=1');
    await v.venture(4);
    assert.equal(v.search(), '?project_id=3');
  } finally { await v.close(); }
});
