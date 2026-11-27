/**
 * D1110 (#2990) — Admin Insights (D893) gaps, mounted on a stubbed `fetch`:
 *   · INS3: every chart mark that is a profile opens that profile's group
 *     lightbox — Who's bars, Growth's stacked parts, its legend, AI spend's bars;
 *     a mark that is no profile (No role) stays a plain mark;
 *   · INS1: "See all countries" opens every country the read counted, where the
 *     block's chart keeps twelve and folds the rest;
 *   · the group read is made with the page's country (the Worker applies it:
 *     cloudflare-worker/test/admin_insights_d893.test.ts).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_insights_d1110.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminInsights from '../src/pages/admin/insights/AdminInsights.jsx';
import { allCountries, buildBlocks, filtersFromSearch, groupKeyOf } from '../src/pages/admin/insights/insightsModel.js';

const h = React.createElement;
const NOW = Date.parse('2026-10-24T09:40:00Z');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const COUNTRIES = ['Canada', 'France', 'Germany', 'Spain', 'Italy', 'Japan', 'Brazil', 'India', 'Kenya', 'Chile', 'Peru', 'Norway', 'Ghana', 'Malta']
  .map((country, i) => ({ country, count: 140 - i * 10 }));
const READ = {
  range: '8w', weeks: WEEKS, current_week: '2026-10-19', last_complete_week: '2026-10-12', as_of: '2026-10-24T09:40:00.000Z',
  scope: { key: 'hq', label: 'HQ-held accounts · axal.vc' },
  filters: { profile: null, country: null, compare: false, group: null },
  kpis: {
    accounts: { available: true, total: 1400, new_30d: 60, deactivated: 4 },
    new_this_week: { available: true, count: 5, last_week: 9 },
    active_last_week: { available: true, week: '2026-10-12', value: 300, week_before: 280 },
    activated: { available: true, rate_pct: 40, cohorts_counted: 2 },
  },
  blocks: {
    who: { available: true, total: 1400, by_profile: [{ profile: 'founder', count: 800 }, { profile: 'investor', count: 580 }, { profile: 'no role', count: 20 }], lps: 3 },
    plan: { available: true, by_tier: [{ tier: 'free', count: 1300 }, { tier: 'pro', count: 100 }], paid: 100, paid_pct: 7.1 },
    growth: { available: true, weeks: WEEKS.map((week, i) => ({ week, total: 10 + i, to_date: i === 7, by_profile: { founder: 6 + i, investor: 4 } })) },
    activity: { available: true, weeks: WEEKS, values: [1, 2, 3, 4, 5, 6, 7, 8], previous: null },
    activation: { available: true, weeks: WEEKS, cohorts: [], steps: {} },
    retention: { available: true, cohorts: [] },
    countries: { available: true, rows: COUNTRIES, not_stated: 70 },
    identity: { available: true, not_started: 1, pending: 0, approved: 0, rejected: 0, other: 0 },
    completeness: { available: true, bands: [], not_recorded: 0 },
    dormant: { available: true, days: 30, count: 3, never_seen: 0, last_month: null, last_month_reason: 'x' },
    tickets: { available: true, open: 0, by_status: {} },
    spend: { available: true, month: '2026-10', usd: 30, calls: 90, by_profile: [{ profile: 'investor', usd: 20, calls: 60 }, { profile: 'founder', usd: 10, calls: 30 }, { profile: 'no account', usd: 0.5, calls: 1 }] },
  },
  definitions: {},
};
const GROUP = (profile, country) => ({
  available: true, profile, count: 12, new_30d: 2, active_last_week: 4, activated_pct: 50, dormant: 1,
  signups_by_week: WEEKS.map((week) => ({ week, count: 1, to_date: false })),
  active_by_week: WEEKS.map((week) => ({ week, count: 1 })),
  by_country: [{ country: country || 'Canada', accounts: 12, new_30d: 2, active_last_week: 4 }],
});
const handle = (url) => {
  const q = new URL(url, 'http://x').searchParams;
  if (!url.includes('/admin/insights')) return response({ detail: 'not stubbed' }, 404);
  const group = q.get('group');
  return response(group ? { ...READ, group: GROUP(group, q.get('country')) } : READ);
};

function Where({ onAt }) { const l = useLocation(); onAt(l.pathname + l.search); return null; }

async function mounted(url) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, now: Date.now };
  const calls = [];
  globalThis.fetch = async (u, options = {}) => { calls.push(String(u)); return handle(String(u)); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Date.now = () => NOW;
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let where = url;
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminInsights), h(Where, { onAt: (x) => { where = x; } }))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const find = (id) => { const n = nodes().find((x) => props(x)['data-testid'] === id); assert.ok(n, `no ${id}`); return n; };
  return {
    calls, where: () => where,
    has: (id) => nodes().some((x) => props(x)['data-testid'] === id),
    ids: () => nodes().map((x) => props(x)['data-testid']).filter(Boolean),
    of: (id) => text(find(id)),
    prop: (id, k) => props(find(id))[k],
    async click(id) { await act(async () => { props(find(id)).onClick(); }); await flush(); },
    async change(id, target) { await act(async () => { props(find(id)).onChange({ target, preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, { fetch: previous.fetch, matchMedia: previous.matchMedia }); Date.now = previous.now; restore(); },
  };
}

const groupReads = (v) => v.calls.filter((u) => u.includes('group='));

test('the model: a profile mark names its group; a mark that is no profile names none', () => {
  // Mutation checked: groupKeyOf passing every key → the No role bar is a button.
  assert.equal(groupKeyOf('founder'), 'founder');
  assert.equal(groupKeyOf('none'), undefined, 'No role and No account open nothing');
  assert.equal(groupKeyOf('lp'), undefined, 'a role the canvas does not name');
  const b = Object.fromEntries(buildBlocks({ insights: { status: 'ready', data: READ }, filters: filtersFromSearch('') }).map((x) => [x.key, x]));
  assert.deepEqual(b.who.chart.rows.map((r) => r.group), ['founder', 'investor', undefined]);
  assert.equal(b.growth.chart.clickable, true);
  assert.deepEqual(b.growth.chart.rows[0].parts.map((p) => p.group), ['founder', 'investor']);
  assert.deepEqual(b.growth.legend.map((l) => l.group), ['founder', 'investor', undefined], 'the to-date swatch opens nothing');
  assert.equal(b.spend.chart.clickable, true);
  assert.deepEqual(b.spend.chart.rows.map((r) => r.group), ['investor', 'founder', undefined]);
});

test('INS3: Who\'s bars, Growth\'s stacked parts, its legend and AI spend\'s bars each open their group', async () => {
  // Mutation checked: Growth not clickable → no stack button; the legend without onSelect → no legend button;
  // spend not clickable → no spend button.
  const v = await mounted('/admin/insights?country=France');
  try {
    assert.ok(!v.has('insights-group'), 'nothing is open yet');
    assert.ok(!v.has('insights-bar-none'), 'No role is a plain bar');
    assert.equal(groupReads(v).length, 0);
    for (const [id, key] of [['insights-bar-founder', 'founder'], ['insights-stack-2-investor', 'investor'], ['insights-legend-founder', 'founder'], ['insights-spend-investor', 'investor']]) {
      await v.click(id);
      assert.match(v.where(), new RegExp(`[?&]group=${key}(&|$)`), `${id} sets ?group=${key}`);
      assert.match(v.where(), /country=France/, 'the page\'s filters stay');
      assert.ok(v.has('insights-group'), `${id} opens the lightbox`);
      assert.match(v.of('insights-group-tiles'), /Active last week4/, 'filled from the group read');
      const last = groupReads(v).at(-1);
      assert.match(last, new RegExp(`group=${key}`));
      assert.match(last, /country=France/, 'the group read carries the page\'s country');
      assert.match(v.of('insights-group-countries'), /France/, 'and draws what the read answered for it');
      await v.click('insights-group-close');
    }
  } finally { await v.close(); }
});

test('INS1: the block keeps twelve countries; "See all countries" lists every one, Not stated, and a search', async () => {
  // Mutation checked: allCountries slicing to twelve → Ghana and Malta are missing; Not stated left out → 15 rows become 14.
  const all = allCountries({ status: 'ready', data: READ });
  assert.equal(all.rows.length, 15);
  assert.equal(all.total, COUNTRIES.reduce((t, r) => t + r.count, 0) + 70);
  assert.deepEqual(all.rows.at(-1), { country: null, count: 70, share: '6%' });
  assert.equal(allCountries({ status: 'error', data: null }), null, 'an unread block lists nothing, never an empty list');
  const v = await mounted('/admin/insights');
  try {
    const block = v.of('insights-block-countries');
    assert.match(block, /Other countries/);
    assert.doesNotMatch(block, /Malta/, 'the chart folds the thirteenth on');
    assert.ok(!v.has('insights-countries-lightbox'));
    await v.click('insights-countries-all');
    const table = v.of('insights-countries-table');
    for (const c of COUNTRIES) assert.match(table, new RegExp(c.country), `${c.country} is listed`);
    assert.match(table, /Not stated/);
    assert.doesNotMatch(table, /Other countries/, 'the full list folds nothing');
    assert.match(v.of('insights-countries-lightbox'), /Every country · 1,120 accounts/);
    await v.change('insights-countries-search', { value: 'mal' });
    assert.equal(v.of('insights-countries-table').replace(/\s+/g, ' ').trim(), 'Accounts by country, every countryCountryAccountsShareMalta101%', 'Malta, 10 accounts, 1%');
    assert.equal(groupReads(v).length, 0, 'the list is the page\'s read, not another');
  } finally { await v.close(); }
});

test('D1308 (#2366, revised canvas): "Account health" heads Identity checks and "Support and AI use" heads Open support tickets', async () => {
  const v = await mounted('/admin/insights');
  try {
    // Mutation checked: drop a BLOCK_HEADS entry → its heading is missing; key it to another block → the order fails.
    assert.equal(v.of('insights-head-identity'), 'Account health');
    assert.equal(v.of('insights-head-tickets'), 'Support and AI use');
    const order = v.ids().filter((id) => /^insights-(head|block)-/.test(id));
    assert.equal(order.indexOf('insights-head-identity') + 1, order.indexOf('insights-block-identity'), 'the heading sits right before its block');
    assert.equal(order.indexOf('insights-head-tickets') + 1, order.indexOf('insights-block-tickets'));
    assert.equal(order.filter((id) => id.startsWith('insights-head-')).length, 2, 'no other block is headed');
  } finally { await v.close(); }
});
