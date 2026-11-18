/**
 * #4843 part 3 (D4843-p3) — Offers · Catalog redrawn to board OF-02 of the Offers v2 canvas: a
 * professional service catalogue. Each row carries the service and its category, the engagement
 * model, the price with its basis, the listing state (Draft = no price yet, Live, Unlisted), the
 * requests where recorded, and one row action (Edit) with the rest behind ⋯. A listing switch
 * (All, Live, Draft, Unlisted) counts the whole page; the footnote says a price is not revenue.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/offers_catalog_of02_4843.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountZone, stubApi } from './_offers_4688.mjs';
import { MineTab, catalogState } from '../src/pages/ServiceCatalogPage.jsx';
import {
  CATALOG_FOOT, LISTING_STATES, inListing, listingCounts, priceBasis, requestsLine,
} from '../src/pages/partner/offers/catalogModel.js';

const svc = (over = {}) => ({
  id: 1, title: 'Go-to-market sprint', category: 'gtm', engagement_model: 'fixed', price_cents: 4800000,
  is_active: 1, summary: 'A six-week sprint.', requests: { requested: 3, pending: 1, booked: 2 }, ...over,
});
const ROWS = [
  svc(),
  svc({ id: 2, title: 'Fractional CFO', category: 'fractional_cfo', engagement_model: 'retainer', price_cents: 650000, requests: { requested: 1 } }),
  svc({ id: 3, title: 'Data-room preparation', category: 'legal', price_cents: null, is_active: 1, requests: { requested: 0 } }),
  svc({ id: 4, title: 'Pitch rehearsal day', category: 'design', engagement_model: 'seat', price_cents: 240050, is_active: 0, requests: undefined }),
];

// ------------------------------------------------------------------ the model

test('the price reads with its basis, and a missing price is no figure', () => {
  assert.equal(priceBasis(svc()), '$48,000 fixed');
  assert.equal(priceBasis(svc({ engagement_model: 'retainer', price_cents: 650000 })), '$6,500 / month');
  assert.equal(priceBasis(svc({ engagement_model: 'seat', price_cents: 240050 })), '$2,400.50 / month', 'cents kept when the amount has them');
  assert.equal(priceBasis(svc({ engagement_model: null, price_cents: 100 })), '$1');
  assert.equal(priceBasis(svc({ price_cents: null })), null);
  assert.equal(priceBasis(svc({ price_cents: 'abc' })), null, 'an unreadable amount is no figure');
});

test('requests are counted where recorded, and a row without counts is no zero', () => {
  assert.equal(requestsLine(svc()), '3 requests');
  assert.equal(requestsLine(svc({ requests: { requested: 1 } })), '1 request');
  assert.equal(requestsLine(svc({ requests: { requested: 0 } })), '0 requests', 'the count is a join: zero is real');
  assert.equal(requestsLine(svc({ requests: undefined })), null);
});

test('the listing switch counts each state, over the rows it is given', () => {
  assert.deepEqual(LISTING_STATES, ['Live', 'Draft', 'Unlisted']);
  assert.deepEqual(listingCounts(ROWS, catalogState), { All: 4, Live: 2, Draft: 1, Unlisted: 1 });
  assert.deepEqual(listingCounts(null, catalogState), { All: 0, Live: 0, Draft: 0, Unlisted: 0 });
  assert.deepEqual(listingCounts([{}], () => 'All'), { All: 1, Live: 0, Draft: 0, Unlisted: 0 }, 'All is the total, never a state');
  assert.deepEqual(ROWS.filter(inListing('Draft', catalogState)).map((o) => o.id), [3]);
  assert.equal(ROWS.filter(inListing('All', catalogState)).length, 4);
});

// ------------------------------------------------------------------ mounted

async function mounted(rows = ROWS) {
  const calls = [];
  const restore = stubApi({
    listServiceOfferings: async () => ({ items: rows.map((o) => ({ ...o })), page: 1, page_size: 50, total: rows.length }),
    updateServiceOffering: async (id, body) => { calls.push(['update', id, body]); return {}; },
  });
  const v = await mountZone(() => h(MineTab, { user: { role: 'partner' }, role: 'partner' }));
  await v.flush();
  return { v, restore, calls };
}
const byId = (v, id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);

test('mounted: the catalogue’s columns, its states and one row action', async () => {
  const { v, restore } = await mounted();
  try {
    assert.match(v.text(), /The services your firm sells through Axal\./);
    assert.match(v.textIn('catalog-row-1'), /Go-to-market sprint.*GTM.*Fixed.*\$48,000 fixed.*Live.*3 requests.*Edit/s);
    assert.match(v.textIn('catalog-row-2'), /Fractional CFO.*Retainer.*\$6,500 \/ month.*Live.*1 request/s);
    assert.match(v.textIn('catalog-row-3'), /Data-room preparation.*No price yet.*Draft.*0 requests/s);
    assert.match(v.textIn('catalog-row-4'), /Pitch rehearsal day.*Unlisted.*Not recorded/s, 'a row without counts reads Not recorded');
    assert.equal(v.textIn('catalog-foot'), CATALOG_FOOT);
    assert.equal(CATALOG_FOOT, 'Price is today’s listed price, not revenue earned. Draft means no price has been set yet.');
    assert.doesNotMatch(v.text(), /Reads through to Pipeline|Highest price|Retainer price|Prices stored as integers/);
    // One visible action per row; the rest behind ⋯.
    assert.equal(byId(v, 'catalog-menu-1'), undefined);
    await act(async () => { v.props(byId(v, 'catalog-more-1')).onClick(); });
    assert.match(v.textIn('catalog-menu-1'), /Unlist.*Delete/s, 'Delete sits apart from Edit');
    assert.equal(v.props(byId(v, 'catalog-more-1'))['aria-expanded'], true);
  } finally { await v.unmount(); restore(); }
});

test('mounted: the listing switch narrows the rows and keeps its whole-page counts', async () => {
  const { v, restore } = await mounted();
  try {
    assert.equal(v.textIn('catalog-listing-Live'), 'Live 2');
    assert.equal(v.props(byId(v, 'catalog-listing-All'))['aria-checked'], true);
    await act(async () => { v.props(byId(v, 'catalog-listing-Draft')).onClick(); });
    assert.ok(byId(v, 'catalog-row-3') && !byId(v, 'catalog-row-1'), 'only the draft is listed');
    assert.equal(v.textIn('catalog-listing-Live'), 'Live 2', 'the counts do not follow the narrowing');
    assert.equal(v.props(byId(v, 'catalog-listing-Draft'))['aria-checked'], true);
  } finally { await v.unmount(); restore(); }
});

test('mounted: Unlist from the menu writes the listing flag', async () => {
  const { v, restore, calls } = await mounted();
  try {
    await act(async () => { v.props(byId(v, 'catalog-more-1')).onClick(); });
    const items = v.nodes().filter((n) => n.tagName === 'BUTTON' && v.props(n)?.role === 'menuitem');
    // The desk table and the phone cards each draw the row (CSS shows one), so the menu is drawn twice.
    assert.equal(items.length, 4);
    assert.match(v.textIn('catalog-menu-1'), /^Unlist/, 'the first item is Unlist');
    const unlist = items[0];
    await act(async () => { await v.props(unlist).onClick(); });
    assert.deepEqual(calls[0], ['update', 1, { is_active: false }]);
    assert.equal(byId(v, 'catalog-menu-1'), undefined, 'the menu closes');
    // An unlisted service offers List, not Unlist.
    await act(async () => { v.props(byId(v, 'catalog-more-4')).onClick(); });
    assert.match(v.textIn('catalog-menu-4'), /^List/);
  } finally { await v.unmount(); restore(); }
});

test('mounted: a phone reads the same rows as cards, with 44px targets', async () => {
  const { v, restore } = await mounted();
  try {
    assert.match(v.props(byId(v, 'catalog-cards')).className, /sm:hidden/);
    assert.match(v.textIn('catalog-card-2'), /Fractional CFO.*Live.*Retainer · \$6,500 \/ month.*1 request/s);
    assert.match(v.props(byId(v, 'catalog-edit-2')).className, /max-sm:min-h-\[44px\]/);
    assert.match(v.props(byId(v, 'catalog-more-2')).className, /max-sm:h-11 max-sm:w-11/);
    const table = v.nodes().find((n) => n.tagName === 'TABLE');
    assert.match(v.props(table).className, /hidden[^]*sm:table/);
  } finally { await v.unmount(); restore(); }
});

test('the part file names the board, the states and the departures', () => {
  const f = 'documentation/architecture/decisions/D4843-p3.md';
  assert.ok(existsSync(f));
  const d = readFileSync(f, 'utf8');
  assert.match(d, /^## D4843 part 3 — .*\(#4843\)$/m);
  for (const s of ['OF-02', 'OF-02b', 'No price yet', 'Unlisted', '90 days', 'Not recorded']) assert.ok(d.includes(s), s);
});
