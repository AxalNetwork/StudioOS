/**
 * D972 (#2369) — Advisors & Partners at /admin/advisors-partners, the
 * integration of the owner's canvas (AP1–AP14) under the shared admin page
 * header (D936): the address and its two old doors, the tabs whose reads
 * exist, and the Overview and Firms blocks drawn from them, each truthfully.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_advisors_partners_d972.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  AP_DECK_PATH, AP_FIRMS_PATH, AP_PATH, MOVED_NOTICES,
  buildFirms, buildNeeds, buildTiles, endingSoon, pageFailed, tabOf,
} from '../src/pages/admin/advisors/apModel.js';
import AdvisorsPartners from '../src/pages/admin/advisors/AdvisorsPartners.jsx';
import { apOverviewFixture } from './_ap_overview_fixture.mjs';
import ApRedirect from '../src/pages/admin/advisors/ApRedirect.jsx';
import FirmLinksRedirect from '../src/pages/admin/advisors/FirmLinksRedirect.jsx';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';
import { stripFor } from '../src/lib/hqStrips.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (days) => new Date(NOW + days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
const ok = (data) => ({ status: 'ready', data });
const bad = { status: 'error', data: null };

// ---------------------------------------------------------------- fixtures

const ADVISORS = { items: [
  { id: 1, name: 'Ada Placeholder', has_advisor_profile: true },
  { id: 2, name: 'Mara Example', has_advisor_profile: false },
  { id: 3, name: 'Sam Sample', has_advisor_profile: true },
] };
const ASSIGNMENTS = { items: [{ id: 1, ended_at: null }, { id: 2, ended_at: null }, { id: 3, ended_at: '2026-09-30 00:00:00' }] };
const LINKS = {
  accounts: [
    { id: 10, name: 'Teo Sample', partner_id: null },
    { id: 11, name: 'Lio Testwell', partner_id: 100 },
    { id: 12, name: 'Pat Partner', partner_id: 101 },
  ],
  firms: [
    { id: 100, name: 'Example Ventures Ltd', company: 'Example Ventures', accounts: 1 },
    { id: 101, name: 'Sample Growth Partners', company: null, accounts: 1 },
    { id: 102, name: 'Quiet Firm', company: null, accounts: 0 },
  ],
  attached: 2, unattached: 1,
};
const DIRECTORY = { partners: [
  { id: 100, specialization: 'Services', directory_listed: 1, directory_featured: 1 },
  { id: 101, specialization: null, directory_listed: 1, directory_featured: 0 },
  { id: 102, specialization: 'Capital', directory_listed: 0, directory_featured: 0 },
] };
const DEALS = { items: [
  { id: 1, user_id: 11, deal_type: 'services_partnership', expires_at: at(20) },
  { id: 2, user_id: 12, deal_type: 'equity_partnership', expires_at: at(200) },
  { id: 3, user_id: 10, deal_type: 'custom', expires_at: at(5) },
] };
const HOSTS = { counts: { pending: 3, approved: 14, declined: 1, withdrawn: 0, removed: 0 } };
const ROSTER = { profiles: [
  { id: 1, name: 'Ada Placeholder', is_active: 1, photo_url: '/api/public/network/1/photo' },
  { id: 2, name: 'Noor Specimen', is_active: 1, photo_url: null },
  { id: 3, name: 'Hidden Person', is_active: 0, photo_url: null },
] };
const ALL = { advisors: ok(ADVISORS), assignments: ok(ASSIGNMENTS), links: ok(LINKS), directory: ok(DIRECTORY), deals: ok(DEALS), hosts: ok(HOSTS), roster: ok(ROSTER) };
const tile = (tiles, key) => tiles.find((t) => t.key === key);

// ---------------------------------------------------------------- the model

test('the tiles read who holds an account, the firms, the deals, hosts and assignments; the two with no read say so', () => {
  const tiles = buildTiles(ALL, NOW);
  assert.deepEqual(tiles.map((t) => t.key), ['advisors', 'partners', 'firms', 'deals', 'hosts', 'assignments', 'sessions', 'settlements']);
  assert.equal(tile(tiles, 'advisors').value, '3');
  assert.equal(tile(tiles, 'advisors').warn, '1 have no advisor profile yet');
  assert.equal(tile(tiles, 'partners').value, '3');
  assert.equal(tile(tiles, 'partners').warn, '1 not attached to a firm');
  assert.equal(tile(tiles, 'firms').sub, '2 listed in the public directory');
  assert.equal(tile(tiles, 'deals').sub, '2 end within 30 days');
  assert.equal(tile(tiles, 'hosts').value, '14');
  assert.equal(tile(tiles, 'hosts').sub, 'approved · 3 waiting, every host');
  assert.equal(tile(tiles, 'assignments').value, '2');
  for (const k of ['sessions', 'settlements']) {
    assert.equal(tile(tiles, k).state, 'notyet', k);
    assert.equal(tile(tiles, k).value, undefined, `${k} drew a value`);
  }
});

test('a failed read is unreadable, never a zero; a list at its cap says so', () => {
  const tiles = buildTiles({ ...ALL, advisors: bad, links: bad, deals: bad, hosts: bad, assignments: bad }, NOW);
  for (const k of ['advisors', 'partners', 'firms', 'deals', 'hosts', 'assignments']) {
    assert.equal(tile(tiles, k).state, 'unreadable', k);
    assert.equal(tile(tiles, k).value, undefined, k);
  }
  assert.equal(tile(buildTiles({ ...ALL, directory: bad }, NOW), 'firms').sub, 'the directory could not be read');
  const full = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, has_advisor_profile: true })) };
  assert.equal(tile(buildTiles({ ...ALL, advisors: ok(full) }, NOW), 'advisors').value, '500+');
  const deals = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, user_id: 1, expires_at: at(300) })) };
  assert.match(tile(buildTiles({ ...ALL, deals: ok(deals) }, NOW), 'deals').sub, /the newest 200/);
});

test('ending soon is within 30 days from now, never a past date', () => {
  assert.deepEqual(endingSoon(DEALS.items, NOW).map((d) => d.id), [1, 3]);
  assert.deepEqual(endingSoon([{ expires_at: at(-2) }, { expires_at: null }], NOW), []);
});

test('Needs you: each queue that holds something, with the page that decides it; a failed queue says so', () => {
  const n = buildNeeds(ALL, NOW);
  assert.deepEqual(n.rows.map((r) => [r.key, r.to]), [
    ['unattached', AP_FIRMS_PATH],
    ['no-profile', '/admin/held/accounts'],
    ['ending', '/admin/partner-invitations/deals'],
    ['hosts', '/admin/programs/spinout-lab/hosts'],
    ['no-photo', AP_DECK_PATH],
  ]);
  assert.match(n.rows[4].text, /1 person on the deck has no photo/, 'a hidden row was counted');
  const failed = buildNeeds({ ...ALL, links: bad, roster: bad }, NOW);
  assert.deepEqual(failed.unread, ['Partner accounts with no firm', 'Deck cards with no photo']);
  assert.equal(buildNeeds({ ...ALL, hosts: { status: 'loading' } }, NOW).state, 'loading');
});

test('the firms table joins a deal to its firm through the account, and a failed column says so', () => {
  const f = buildFirms(ALL, NOW);
  const byName = Object.fromEntries(f.rows.map((r) => [r.name, r]));
  assert.equal(byName['Example Ventures Ltd'].directory, 'Featured');
  assert.match(byName['Example Ventures Ltd'].deal, /^services_partnership · ends /);
  assert.equal(byName['Example Ventures Ltd'].endingSoon, true);
  assert.equal(byName['Sample Growth Partners'].specialization, 'Not recorded');
  assert.equal(byName['Quiet Firm'].deal, 'No active deal');
  assert.equal(f.unattached, 1);
  const half = buildFirms({ ...ALL, deals: bad, directory: bad }, NOW);
  assert.ok(half.rows.every((r) => r.deal === 'Could not be read' && r.directory === 'Could not be read'));
  assert.equal(buildFirms({ ...ALL, links: bad }, NOW).state, 'unreadable');
});

test('the tabs, the redirects\' targets, the strip on a tab, and the whole-page failure', () => {
  assert.equal(tabOf(AP_PATH), 'overview');
  assert.equal(tabOf(`${AP_PATH}/firms`), 'firms');
  assert.equal(tabOf(`${AP_PATH}/people`), null, 'People is not a tab until its read exists');
  assert.equal(legacyContractsTarget('?tab=network-profiles'), '/admin/advisors-partners/deck?moved=network-profiles');
  assert.equal(stripFor('/admin/advisors-partners/deck'), 'Content', 'the Content strip is lost on a tab');
  assert.equal(stripFor('/admin/persona-segments'), 'Content');
  assert.equal(stripFor('/admin/persona-segments/unclassified'), 'Content');
  assert.equal(stripFor('/admin/advisors-partnersx'), null, 'a sibling path took the strip');
  assert.equal(pageFailed(ALL), false);
  assert.equal(pageFailed(Object.fromEntries(Object.keys(ALL).map((k) => [k, bad]))), true);
});

// ---------------------------------------------------------------- the page, mounted

function worker(fail = [], writes = {}) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    const p = u.pathname;
    if ((init.method || 'GET') === 'POST' && p === '/api/admin/partners/links' && writes.link) return writes.link(init);
    const down = (n) => fail.includes(n);
    const map = {
      '/api/advisors/admin/cohort-assignments/assignable': ['advisors', ADVISORS],
      '/api/advisors/admin/cohort-assignments': ['assignments', ASSIGNMENTS],
      '/api/admin/partners/links': ['links', LINKS],
      '/api/admin/partners/directory': ['directory', DIRECTORY],
      '/api/admin/partners/deals': ['deals', DEALS],
      '/api/admin/lab-hosts': ['hosts', HOSTS],
      '/api/admin/network-profiles': ['roster', ROSTER],
    };
    if (p === '/api/admin/network/overview') {
      if (down('overview')) return json({detail:'down'},503);
      const d=apOverviewFixture();
      if(down('network-deals')) {d.deals={available:false,reason:'Deals could not be read'};d.needs_you.ending_deals={available:false,reason:'Deals could not be read'};}
      return json(d);
    }
    if (map[p]) return down(map[p][0]) ? json({ detail: 'down' }, 503) : json(map[p][1]);
    return json({});
  };
  return seen;
}

async function mount(url, fail, writes) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const seen = worker(fail, writes);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdvisorsPartners))); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen,
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    async change(id, value) {
      const n = byTestId(id); assert.ok(n, `no ${id}`);
      await act(async () => { props(n).onChange({ target: { value } }); });
      for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    },
    async click(id) {
      const n = byTestId(id); assert.ok(n, `no ${id}`);
      await act(async () => { props(n).onClick(); });
      for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    },
    hrefs: () => walk(container).map((n) => props(n)?.href ?? props(n)?.to).filter((x) => typeof x === 'string'),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('mounted Overview: the header, each tile from the D973 summary, Needs you, live charts, and one h1', async () => {
  const m = await mount(AP_PATH);
  try {
    assert.match(m.of('ap-header'), /Community.*Advisors & Partners/s);
    assert.match(m.of('ap-tile-advisors'), /3.*1 have no advisor profile yet/s);
    assert.match(m.of('ap-tile-partners'), /3.*1 not attached to a firm/s);
    assert.match(m.of('ap-tile-hosts'), /14.*3 waiting/s);
    assert.match(m.of('ap-tile-sessions'), /17/);
    assert.match(m.of('ap-needs'), /Synthetic partner has a partner account but no firm.*Attach to firm/s);
    for (const id of ['c1', 'c2', 'c3', 'c4']) assert.ok(m.has(`ap-chart-${id}`));
    assert.equal(m.h1s(), 1);
    assert.ok(!m.has('admin-page-moved'));
  } finally { await m.unmount(); }
});

test('mounted Firms: the table, the unattached strip, and only the three reads it needs', async () => {
  const m = await mount(`${AP_PATH}/firms`);
  try {
    assert.match(m.of('ap-firm-100'), /Example Ventures Ltd.*Services.*services_partnership.*Featured/s);
    assert.match(m.of('ap-firms-unattached'), /no firm: 1/);
    const paths = [...new Set(m.seen.map((s) => s.split('?')[0]))].filter((p) => !p.startsWith('/api/ai')).sort();
    // D1125: the header's tab counts are one read on every tab.
    assert.deepEqual(paths, ['/api/admin/network/tabs', '/api/admin/partners/deals', '/api/admin/partners/directory', '/api/admin/partners/links']);
  } finally { await m.unmount(); }
});

test('D952: attaching an account to a firm is on the Firms tab, asks before it saves, and says the result on the page', async () => {
  let saved = null;
  const m = await mount(`${AP_FIRMS_PATH}?moved=firm-links`, [], {
    link: (o) => { saved = JSON.parse(o.body); return new Response(JSON.stringify({ ok: true, user_id: 10, partner_id: 100, firm_name: 'Example Ventures Ltd' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); },
  });
  try {
    assert.ok(m.of('admin-page-moved').includes(MOVED_NOTICES['firm-links']), 'the moved notice from the old address');
    assert.ok(m.hrefs().includes('#ap-firm-links'), 'the unattached strip points at the section below, not Partner invitations');
    assert.ok(!m.hrefs().includes('/admin/partner-invitations/firm-links'));
    assert.equal(m.of('partners-firm-counts'), '2 attached · 1 not · 3 firms on record');
    await m.change('partners-firm-select-10', '100');
    assert.ok(m.has('partners-firm-confirm'), 'a change asks first');
    assert.match(m.of('partners-firm-confirm'), /Attach Teo Sample to Example Ventures\?/);
    assert.equal(m.seen.filter((s) => s === '/api/admin/partners/links').length >= 1, true);
    assert.equal(saved, null, 'nothing is saved before the confirm');
    await m.click('partners-firm-save');
    assert.deepEqual(saved, { user_id: 10, partner_id: 100 });
    assert.equal(m.of('partners-firm-saved'), 'Attached to Example Ventures Ltd.');
    assert.ok(!m.has('partners-firm-confirm'));
  } finally { await m.unmount(); }
});

test('D952: the old Firm links address keeps its query and hash and lands on the Firms tab with the moved key', async () => {
  const restore = installDocument();
  let landed = null;
  function Spy() { const l = useLocation(); landed = `${l.pathname}${l.search}${l.hash}`; return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/admin/partner-invitations/firm-links?x=1#top'] },
      h(Routes, null,
        h(Route, { path: '/admin/partner-invitations/firm-links', element: h(FirmLinksRedirect) }),
        h(Route, { path: AP_FIRMS_PATH, element: h(Spy) }))));
  });
  await act(async () => root.unmount());
  restore();
  assert.equal(landed, `${AP_FIRMS_PATH}?x=1&moved=firm-links#top`);
});

test('mounted Deck roster: today\'s roster under the header, with one h1 and the moved notice from the old address', async () => {
  const m = await mount(`${AP_DECK_PATH}?moved=network-profiles`);
  try {
    assert.ok(m.has('network-roster'));
    assert.equal(m.h1s(), 1, 'the roster drew its own h1 under the header');
    assert.ok(m.of('admin-page-moved').includes(MOVED_NOTICES['network-profiles']));
    assert.doesNotMatch(m.text(), /Mentor & partner network(?! is now)/, 'the roster\'s old title is drawn');
  } finally { await m.unmount(); }
});

test('mounted: one read failing costs its blocks; every read failing says nothing is a zero', async () => {
  const one = await mount(AP_PATH, ['network-deals']);
  try {
    assert.match(one.of('ap-tile-deals'), /Unreadable/);
    assert.match(one.of('ap-tile-advisors'), /3/, 'another block stopped answering');
    assert.match(one.of('ap-needs'), /DealUnreadable/);
  } finally { await one.unmount(); }
  const all = await mount(AP_PATH, ['overview']);
  try { assert.match(all.of('ap-unreadable'), /Nothing here is a zero/); } finally { await all.unmount(); }
});

test('the old address keeps its query and hash and adds the moved key', async () => {
  const restore = installDocument();
  let landed = null;
  function Spy() { const l = useLocation(); landed = `${l.pathname}${l.search}${l.hash}`; return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/admin/network-profiles?x=1#top'] },
      h(Routes, null,
        h(Route, { path: '/admin/network-profiles', element: h(ApRedirect) }),
        h(Route, { path: AP_DECK_PATH, element: h(Spy) }))));
  });
  await act(async () => root.unmount());
  restore();
  assert.equal(landed, `${AP_DECK_PATH}?x=1&moved=network-profiles#top`);
});

// ---------------------------------------------------------------- the source

test('the routes, the redirects, the row, the strip and the reads the page must never make', () => {
  const app = read('frontend/src/App.jsx');
  for (const sub of ['', '/firms', '/deck']) {
    assert.ok(app.includes(`<Route path="/admin/advisors-partners${sub}" element={guard(['admin'], <AdvisorsPartners />)} />`), sub || 'overview');
  }
  assert.ok(app.includes('<Route path="/admin/network-profiles" element={<ApRedirect />} />'));
  assert.ok(app.includes('<StripLink to="/admin/advisors-partners">Advisors &amp; Partners</StripLink>'));
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/admin\/network-profiles' \}/);
  // D952: Partner invitations' Firm links forwards to the Firms tab, and the redirect is counted.
  assert.ok(app.includes('<Route path="/admin/partner-invitations/firm-links" element={<FirmLinksRedirect />} />'));
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/admin\/partner-invitations\/firm-links' \}, \/\/ D952/);
  // The partner-facing sentences name the new place.
  for (const f of ['frontend/src/pages/partner/kit.jsx', 'frontend/src/pages/partner/PartnerFirmProfileCard.jsx']) {
    const src = read(f);
    assert.match(src, /Advisors &amp;\s+Partners → Firms/, f);
    assert.doesNotMatch(src, /Partners →\s+Firm links/, f);
  }
  // D938 added Directory and Wellbeing after it.
  assert.match(read('frontend/src/sidebarConfig.js'), /'\/admin\/partner-invitations', '\/admin\/advisors-partners'(, '[^']+')*\] \}/);
  const page = read('frontend/src/pages/admin/advisors/AdvisorsPartners.jsx');
  // Nothing is decided here that another page decides (AP "DO NOT DRAW").
  assert.doesNotMatch(page, /setFirmLink|terminateDeal|adminSetPartnerDirectory|adminLabHostDecide|adminImpersonate/);
  // D952's one exception: attaching an account to a firm, in its own file, asking before it saves.
  const attach = read('frontend/src/pages/admin/advisors/FirmLinks.jsx');
  assert.match(attach, /api\.adminPartners\.setFirmLink\(/);
  assert.match(attach, /onChange=\{\(e\) => ask\(a, e\.target\.value\)\}/, 'a select only asks; the save is the confirm\'s button');
  assert.doesNotMatch(attach, /terminateDeal|adminSetPartnerDirectory|adminLabHostDecide|adminImpersonate|window\.confirm|useToast/);
  // The partner directory read carries emails; no email reaches this page.
  assert.doesNotMatch(read('frontend/src/pages/admin/advisors/apModel.js') + page, /\.email\b/);
  assert.match(page, /export default function AdvisorsPartners\(\) \{\s*return \(\s*<AdminBoardFrame workspace="Advisors and partners"/);
});
