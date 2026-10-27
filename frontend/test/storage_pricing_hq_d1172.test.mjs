/**
 * D1172 (#3085) — Storage on Pricing (STG18–STG19) and HQ › Platform ›
 * Storage (STG20). Every allowance below comes from the Worker's own
 * catalogue (`storagePlans.ts`, `planCatalogue.ts`); no byte count is typed
 * here but the unit's own checks.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/storage_pricing_hq_d1172.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import PlatformStoragePage from '../src/pages/hq/PlatformStoragePage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { api } from '../src/lib/api.js';
import { PLAN_CARDS, STORAGE_COMPARE } from '../src/lib/sitePricing.js';
import { allowanceText, lpStorageLine, storageGroup } from '../src/lib/pricingModel.js';
import { kindColumns, planRows, stateBars, tiles } from '../src/pages/hq/platformStorageModel.js';
import { hqLine, hqLinks } from '../src/pages/hq/hqNoticeModel.js';
import { STORAGE_PLANS, STORAGE_TIERS, storageFields } from '../../cloudflare-worker/src/services/storagePlans.ts';
import { publicCatalogue } from '../../cloudflare-worker/src/services/planCatalogue.ts';

const GB = 1024 ** 3;
/** The public read as the Worker builds it: one plans row per free plan, Investor Plus and LP Access, and the whole catalogue. */
const READ = {
  plans: ['founder:free', 'investor:free', 'advisor:free', 'partner:free', 'other', 'lp_access', 'investor:plus']
    .map((key) => ({ family: key.split(':')[0], licence_key: key, free: key !== 'investor:plus', prices: [], monthly: null, yearly: null, ...storageFields(key) })),
  packs: [],
  catalogue: publicCatalogue(),
};
const expected = (spec) => {
  if (!spec.storage) return 'Negotiated';
  const p = STORAGE_PLANS[spec.storage];
  return allowanceText(p.allowance_bytes) ?? p.allowance_reason;
};
const expectedBest = (spec) => {
  if (!spec.storage) return 'Negotiated';
  const p = STORAGE_PLANS[spec.storage];
  return p.best_suited ?? p.best_suited_reason;
};

test('the unit: binary, as the catalogue counts it (1 GB = 1,024 MB)', () => {
  assert.equal(allowanceText(GB), '1 GB');
  assert.equal(allowanceText(512 * 1024 ** 2), '512 MB');
  assert.equal(allowanceText(1e9), '953.7 MB', 'a decimal gigabyte is not a GB here');
  assert.equal(allowanceText(null), null);
  assert.equal(allowanceText(-1), null);
});

test('Pricing’s Storage group equals the public read on every tab; Best suited for on Founder and Investor only', () => {
  for (const [tab, specs] of Object.entries(PLAN_CARDS)) {
    for (const read of [READ, { plans: [], catalogue: READ.catalogue }]) {
      const [group, rows, meta] = storageGroup(read, specs, tab, STORAGE_COMPARE);
      assert.deepEqual([group, meta], ['Storage', { fresh: true }]);
      assert.deepEqual(rows[0], ['Storage', ...specs.map(expected)], `${tab} storage`);
      if (['founder', 'investor'].includes(tab)) assert.deepEqual(rows[1], ['Best suited for', ...specs.map(expectedBest)], `${tab} best`);
      else assert.equal(rows.length, 1, `${tab} has no Best suited for row`);
    }
  }
  // Each card names a catalogue plan, or is a firm with none.
  for (const spec of Object.values(PLAN_CARDS).flat()) assert.ok(spec.storage ? Object.hasOwn(STORAGE_PLANS, spec.storage) : spec.custom, spec.name);
  // A read without the figure says so, never a zero.
  const [, blank] = storageGroup({ plans: [] }, PLAN_CARDS.founder, 'founder', STORAGE_COMPARE);
  assert.deepEqual(blank[0], ['Storage', 'Not recorded', 'Not recorded', 'Not recorded']);
  assert.equal(lpStorageLine({ plans: [] }, STORAGE_COMPARE), null);
  assert.deepEqual(lpStorageLine(READ, STORAGE_COMPARE), { text: `${allowanceText(STORAGE_PLANS.lp_access.allowance_bytes)} personal storage.`, note: 'Fund documents are excluded.' });
  // No figure lives in the copy.
  assert.doesNotMatch(readFileSync(new URL('../src/lib/sitePricing.js', import.meta.url), 'utf8'), /\b\d+\s?(GB|MB|TB)\b/);
});

// ------------------------------------------------------------------ rendered

const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byTest = (root, id) => walk(root).filter((n) => props(n)['data-testid'] === id);
const cls = (n, c) => (props(n).className || '').split(' ').includes(c);

async function mount(element) {
  const restore = installDocument();
  // As pricing_tab_comparisons.test.mjs: no geometry here; tab scrolling is browser-only.
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => { const node = createElement(tag); node.querySelector = () => null; return node; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(element));
  await act(async () => {});
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}

test('rendered: the Investor table ends with Storage and its New pill, and the LP band carries its storage line', async () => {
  const original = { ...publicPricingApi };
  publicPricingApi.plansAndPacks = async () => READ;
  publicPricingApi.aiModels = async () => ({ models: [] });
  const page = await mount(React.createElement(MemoryRouter, { initialEntries: ['/pricing?for=investor'] }, React.createElement(PricingBody, { user: null })));
  try {
    const desk = walk(page.container).find((n) => cls(n, 'axp-desk'));
    const groups = walk(desk).filter((n) => cls(n, 'axp-group')).map(text);
    assert.equal(groups.at(-1), 'StorageNew', 'Storage is the last group, marked New');
    const row = byTest(desk, 'pricing-storage-row')[0];
    assert.deepEqual(row.childNodes.slice(1).map(text), PLAN_CARDS.investor.map(expected));
    const best = byTest(desk, 'pricing-storage-best')[0];
    assert.deepEqual(best.childNodes.slice(1).map(text), PLAN_CARDS.investor.map(expectedBest));
    assert.ok(best.childNodes.slice(1).every((n) => cls(n, 'axp-cell-words')), 'Best suited for is set in words');
    const lp = byTest(page.container, 'pricing-lp-storage')[0];
    assert.equal(text(lp), `${allowanceText(STORAGE_PLANS.lp_access.allowance_bytes)} personal storage.NewFund documents are excluded.`);
    // The phone's one-plan table ends with the Storage group too.
    const phone = walk(page.container).find((n) => cls(n, 'axp-phone'));
    assert.equal(walk(phone).filter((n) => cls(n, 'axp-group')).map(text).at(-1), 'StorageNew');
  } finally {
    await page.done();
    Object.assign(publicPricingApi, original);
  }
});

/** HQ's read as D1170's route answers it, its allowances from the catalogue. */
function hqBody({ complete = true } = {}) {
  const state = (o) => ({ ok: 0, near_80: 0, near_95: 0, full: 0, over: 0, no_allowance: 0, not_measured: 0, ...o });
  const kinds = (bytes) => ['data_room', 'documents', 'recordings', 'decks_exports', 'brand', 'other'].map((key, i) => ({ key, measured_bytes: i === 0 ? bytes : 0 }));
  const figures = {
    free: { members: 3, with: 2, bytes: 3000, median: 1000, states: state({ ok: 2, near_80: 1 }) },
    usd_20: { members: 2, with: 2, bytes: 9000, median: 4500, states: state({ near_95: 1, over: 1 }) },
    usd_50: { members: 0, with: 0, bytes: 0, median: null, states: state({}) },
    usd_100: { members: 1, with: 1, bytes: 500, median: 500, states: state({ full: 1 }) },
    usd_150: { members: 0, with: 0, bytes: 0, median: null, states: state({}) },
    lp_access: { members: 1, with: 0, bytes: 0, median: 0, states: state({ ok: 1 }) },
    negotiated: { members: 1, with: 1, bytes: 700, median: 700, states: state({ not_measured: 1 }) },
  };
  return {
    complete, unreadable_areas: complete ? [] : ['message_attachments'], reason: complete ? null : 'Some stored files could not be read, so no member’s total is complete.',
    totals: { members: 10, members_with_files: 6, files: 9, measured_bytes: 13200, unknown_size_files: 4, complete },
    by_tier_reason: complete ? null : 'Some stored files could not be read, so no member’s total is complete.',
    by_tier: STORAGE_TIERS.map((t) => {
      const f = figures[t.key];
      const plan = STORAGE_PLANS[t.plans[0]];
      return {
        tier: t.key, label: t.label, plan_keys: t.plans, plan_names: t.plans, allowance_bytes: plan.allowance_bytes, allowance_reason: plan.allowance_reason,
        members: f.members, members_with_files: f.with,
        measured_bytes: complete ? f.bytes : null, median_bytes: complete ? f.median : null,
        by_kind: complete ? kinds(f.bytes) : null, by_state: complete ? f.states : null,
        // A field the page must never draw.
        name: 'Leaky Person',
      };
    }),
  };
}

test('HQ’s model: tiles, rows sorted by use, a negotiated plan not measured, an empty plan with no median', () => {
  const body = hqBody();
  const t = Object.fromEntries(tiles(body).map((x) => [x.key, x]));
  assert.deepEqual([t.stored.value, t.members.value, t.near.value, t.full.value, t.over.value, t.unknown.value], ['12.9 KB', '6', '2', '1', '1', '4 files']);
  assert.equal(t.stored.note, 'across 6 members with files');
  const rows = planRows(body);
  assert.deepEqual(rows.map((r) => r.key), ['usd_20', 'free', 'negotiated', 'usd_100', 'usd_50', 'usd_150', 'lp_access']);
  assert.deepEqual(planRows(body, 'plan').map((r) => r.key), STORAGE_TIERS.map((x) => x.key));
  const neg = rows.find((r) => r.key === 'negotiated');
  assert.deepEqual([neg.allowance, neg.near.text, neg.full.text, neg.over.text], ['Negotiated', '—', '—', '—']);
  const plus = rows.find((r) => r.key === 'usd_50');
  assert.deepEqual([plus.used.text, plus.median.text, plus.median.why], ['0 B', '—', 'No members on this plan']);
  assert.equal(rows.find((r) => r.key === 'usd_20').allowance, allowanceText(STORAGE_PLANS['founder:growth'].allowance_bytes));
  assert.equal(stateBars(body).find((b) => b.key === 'negotiated').note, '1 member · not measured: the allowance is negotiated');
  assert.equal(kindColumns(body).find((c) => c.key === 'usd_20').total, 9000);
});

test('HQ’s model says what it could not read: an area unreadable blanks bytes and states, never a zero', () => {
  const body = hqBody({ complete: false });
  const t = Object.fromEntries(tiles(body).map((x) => [x.key, x]));
  assert.equal(t.stored.value, 'at least 12.9 KB');
  assert.deepEqual([t.near.value, t.full.value, t.over.value], [null, null, null]);
  assert.match(t.full.reason, /no member’s total is complete/);
  assert.equal(planRows(body)[0].used.text, null);
  assert.deepEqual([kindColumns(body), stateBars(body)], [null, null]);
  assert.equal(planRows({ by_tier: null }), null);
});

test('rendered HQ page: totals, both charts and the table; no member or file is named; a failed read offers Retry', async () => {
  const original = api.hqPlatformStorage;
  api.hqPlatformStorage = async () => hqBody();
  let page = await mount(React.createElement(MemoryRouter, null, React.createElement(PlatformStoragePage)));
  try {
    const all = text(page.container);
    assert.match(all, /Storage.*HQ only.*How much members store, by plan and by kind\. Totals only\./);
    assert.equal(byTest(page.container, 'hq-storage-tiles')[0].childNodes.length, 6);
    assert.equal(byTest(page.container, 'hq-storage-kind-chart').length, 1);
    assert.equal(byTest(page.container, 'hq-storage-state-chart').length, 1);
    assert.match(all, /Totals only\. A member’s files are theirs; HQ sees sums\. No member or file is named here\./);
    assert.doesNotMatch(all, /Leaky Person/);
    assert.equal(walk(page.container).filter((n) => props(n)['data-tier']).length, STORAGE_TIERS.length * 2, 'one bar and one row per tier');
  } finally { await page.done(); }
  api.hqPlatformStorage = async () => { throw new Error('nope'); };
  page = await mount(React.createElement(MemoryRouter, null, React.createElement(PlatformStoragePage)));
  try {
    assert.match(text(page.container), /Platform storage/);
    assert.ok(walk(page.container).some((n) => n.tagName === 'BUTTON' && /Retry/.test(text(n))));
    assert.equal(byTest(page.container, 'hq-storage-tiles').length, 0);
  } finally {
    await page.done();
    api.hqPlatformStorage = original;
  }
});

test('the route is HQ-only, on the Platform strip after AI usage; a studio admin reads STG14a’s card', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<Route path="\/admin\/platform\/storage" element=\{guard\(\['admin'\], hqOnly\(<HqPlatformStoragePage \/>\)\)\} \/>/);
  assert.match(app, /AI usage<\/StripLink>\s*<StripLink to="\/admin\/platform\/storage">Storage<\/StripLink>/);
  assert.match(hqLine('/admin/platform/storage'), /^Platform storage is for HQ\. Studio admins see their own storage in Account\./);
  assert.deepEqual(hqLinks('/admin/platform/storage')[0], { label: 'Your own storage', href: '/account/usage/storage', primary: true });
  assert.doesNotMatch(hqLine('/admin/platform/ai-usage'), /storage/);
});
