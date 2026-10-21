// #2343 — one brand page. `/grow/brand` forwards to the builder at `/build/brand`,
// so the builder must open on the venture the old address named and must show
// what Grow's Brand page read: every stored page with its status, views,
// page-linked leads and rate, the All / Live / Draft / Leads chips, and the
// best-converting read. This mounts the real page with the API stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import BrandBuilderPage from '../src/pages/BrandBuilderPage.jsx';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

async function mount(url) {
  const original = { ...api };
  const asked = { landing: [], pages: [], waitlist: [] };
  api.listProjects = async () => [{ id: 1, name: 'Harbour' }, { id: 2, name: 'Second' }];
  api.brandGetLanding = async (id) => { asked.landing.push(id); return { name: 'Landing', template: 'minimal', audience: 'customer' }; };
  api.brandListWaitlist = async (id) => { asked.waitlist.push(id); return { signups: [
    { id: 1, email: 'a@example.com', landing_page_id: 11 },
    { id: 2, email: 'b@example.com', landing_page_id: 11 },
    { id: 3, email: 'c@example.com', landing_page_id: null },
  ] }; };
  api.brandListPages = async (id) => { asked.pages.push(id); return { pages: [
    { id: 11, page_slug: 'pilot', published: 1, views_count: 40, audience: 'customer' },
    { id: 12, page_slug: 'investors', published: 0, views_count: 5, audience: 'investor' },
  ] }; };
  api.brandGetPreviewUrl = async () => ({});
  api.brandListTemplates = async () => ({ templates: [] });
  api.myAiSpend = api.aiPricing = async () => null;
  const m = await mountContracts(React.createElement(BrandBuilderPage), url);
  for (let i = 0; i < 5; i++) await m.flush();
  return { ...m, asked, async close() { await m.unmount(); Object.assign(api, original); } };
}

test('the builder opens on the venture `?project_id=` names, as Grow\'s page did', async () => {
  const m = await mount('/build/brand?project_id=2');
  try {
    assert.ok(m.asked.landing.includes(2) && !m.asked.landing.includes(1), 'the builder ignored ?project_id=');
    assert.deepEqual([...new Set(m.asked.pages)], [2], 'the pages read ran for another venture');
  } finally { await m.close(); }
});

test('the builder shows every stored page, its leads and rate, and the four chips filter them', async () => {
  const m = await mount('/build/brand');
  try {
    const text = m.text();
    assert.match(text, /Pages and what they produced/);
    assert.match(text, /\/pilot/);
    assert.match(text, /\/investors/);
    assert.match(text, /5\.0% of stored views/, 'the page-linked rate (2 leads / 40 views) is gone');
    assert.match(text, /Best converting\/pilot/, 'the best-converting read is gone');
    assert.match(text, /Leads captured3/);
    // The table alone: the best-converting stat above it also names /pilot.
    const table = () => { const t = m.text(); return t.slice(t.indexOf('Pages and what they produced'), t.indexOf('Read the brand honestly')); };
    assert.deepEqual([table().includes('/pilot'), table().includes('/investors')], [true, true]);
    await m.click('Live');
    assert.deepEqual([table().includes('/pilot'), table().includes('/investors')], [true, false], 'Live does not filter to published pages');
    await m.click('Draft');
    assert.deepEqual([table().includes('/pilot'), table().includes('/investors')], [false, true], 'Draft does not filter to unpublished pages');
    await m.click('Leads');
    assert.deepEqual([table().includes('/pilot'), table().includes('/investors')], [true, false], 'Leads does not filter to pages with leads');
    assert.match(m.text(), /Export leads/, 'the leads export is gone');
  } finally { await m.close(); }
});
