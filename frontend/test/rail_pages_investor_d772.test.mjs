/**
 * D772 (#2098), one section per PR — each investor board reaches its page key
 * from D768's map, draws one rail, and names each option of
 * `lib/railOptions/investor.js` while the member has it open. Providers are
 * mounted in-process; nothing reaches the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_pages_investor_d772.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { pageKeyFor } from '../src/lib/railPages.js';
import { INVESTOR_RAIL_OPTIONS } from '../src/lib/railOptions/investor.js';
import { RailPageProvider, useRailPage } from '../src/ui/railCrumbs.js';
import { api } from '../src/lib/api.js';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';

const h = React.createElement;
const read = (f) => readFileSync(`frontend/src/${f}`, 'utf8');
const rowsOf = (section) => INVESTOR_RAIL_OPTIONS.filter((o) => o.page === `Investor · ${section}` || o.page.startsWith(`Investor · ${section} · `));

/** Each draft row's band in its file carries the row's key as `railOption`, beside the row's surface. */
function assertBandsNamed(rows) {
  for (const o of rows.filter((r) => r.handler === 'draft')) {
    // Each `<ZoneDraft … />` opening tag, found by plain string search (no regex is built from data).
    const src = read(o.source.file);
    const bands = src.split('<ZoneDraft').slice(1).map((rest) => rest.slice(0, rest.indexOf('>')));
    const band = bands.find((b) => b.includes(o.source.match));
    assert.ok(band, `${o.page}: no band ${o.source.match}`);
    assert.ok(band.includes(`railOption="${o.key}"`), `${o.page}: the band does not name ${o.key}`);
  }
}

// ------------------------------------------------------------------ Deals (I1–I5)

const DEALS = [['/deals', 'Investor · Deals'], ['/deals/pipeline', 'Investor · Deals · Pipeline'], ['/deals/screening', 'Investor · Deals · Screening'],
  ['/deals/commit', 'Investor · Deals · Commit'], ['/deals/closing', 'Investor · Deals · Closing']];

test('Deals: each board\'s route answers its page key for an investor', () => {
  for (const [route, key] of DEALS) assert.equal(pageKeyFor(route, 'investor'), key, route);
  for (const o of rowsOf('Deals')) assert.ok(DEALS.some(([, k]) => k === o.page), `${o.page} is a Deals board`);
});

test('Deals: the five boards draw exactly one rail, the routes\' shell\'s', () => {
  const routes = read('workspaces/investor/InvestorDealsRoutes.jsx');
  assert.equal((routes.match(/<WorkerRail\b/g) || []).length, 1);
  assert.match(routes, /<WorkspaceShell\b[\s\S]*?rail=\{\(\s*<WorkerRail\b/);
  for (const f of ['PipelineZone', 'ScreeningZone', 'CommitZone', 'ClosingZone']) {
    assert.doesNotMatch(read(`pages/investor/deals/${f}.jsx`), /<WorkerRail\b|<RailFrame\b/, `${f} draws a second rail`);
  }
});

test('Deals: every option of the section names itself on its band', () => {
  const rows = rowsOf('Deals');
  assert.deepEqual(rows.map((o) => o.key), ['draft:stale-deal-notes', 'draft:screening-memo', 'draft:ic-memo', 'draft:closing-cover-note']);
  assertBandsNamed(rows);
});

// ------------------------------------------------------------------ the band names its option only while it is open

function Probe({ seen }) {
  const page = useRailPage();
  seen.push({ page: page?.page ?? null, option: page?.option ?? null });
  return null;
}

test('a band names its option while a draft runs or waits for Accept, and clears it once accepted or discarded', async () => {
  const saved = { ...api.research };
  let stored = [];
  let release;
  api.research.zoneDrafts = async () => ({ items: stored });
  api.research.zoneDraftRun = () => new Promise((r) => { release = () => { stored = [{ uid: 'd1', body: 'Memo', accepted: false }]; r({ item: stored[0] }); }; });
  api.research.zoneDraftAccept = async () => { stored = [{ ...stored[0], accepted: true }]; return { item: stored[0] }; };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const seen = [];
  const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const button = (text) => walk(container).find((n) => n.tagName?.toLowerCase() === 'button' && (n.textContent || '').includes(text));
  const tree = (railOption) => h(MemoryRouter, { initialEntries: ['/deals/screening'] },
    h(RailPageProvider, { role: 'investor' }, h(ZoneDraft, { surface: 'deals/screening', label: 'Draft · screening memo', run: 'Draft the memo', railOption }), h(Probe, { seen })));
  try {
    await act(async () => { root.render(tree('draft:screening-memo')); });
    await settle();
    assert.equal(seen.at(-1).page, 'Investor · Deals · Screening');
    assert.equal(seen.at(-1).option, null, 'a closed band names nothing');
    await act(async () => { props(button('Draft the memo')).onClick(); });
    await settle();
    assert.deepEqual(seen.at(-1).option, { key: 'draft:screening-memo', label: 'Draft the memo' }, 'running');
    await act(async () => { release(); });
    await settle();
    assert.deepEqual(seen.at(-1).option, { key: 'draft:screening-memo', label: 'Draft the memo' }, 'waiting for Accept');
    await act(async () => { await props(button('Accept draft')).onClick(); });
    await settle();
    assert.equal(seen.at(-1).option, null, 'accepted, the rail is the page\'s again');
    // A band with no railOption names nothing, even with a draft waiting.
    stored = [{ uid: 'd2', body: 'Memo', accepted: false }];
    await act(async () => { root.render(tree(null)); });
    await settle();
    assert.equal(seen.at(-1).option, null);
  } finally {
    await act(async () => root.unmount());
    restore();
    Object.assign(api.research, saved);
  }
});
