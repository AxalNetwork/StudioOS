/**
 * D4612 — Research links open only where their reader is admitted, a
 * company profile's "See all" keeps its filter, and the fund directory keeps
 * its search, filters, sort and page in the address.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { RESEARCH_ACCESS, canOpenResearch } from '../src/lib/researchAccess.js';
import { researchLinks } from '../src/pages/research/researchLinks.js';
import { SectorProfileView } from '../src/pages/research/SectorProfile.jsx';
import { Funds } from '../src/pages/research/CompanyProfile.jsx';
import FundDirectory from '../src/pages/research/FundDirectory.jsx';
import { EMPTY_QUERY, directoryHref, queryFromSearch, searchFromQuery } from '../src/pages/research/fundDirectoryRead.js';
import { researchFundsApi } from '../src/lib/api/researchFunds.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/** The roles App.jsx admits to one Research path, read off its own guard. */
function admitted(path) {
  const m = APP.match(new RegExp(`path="${path.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{guard\\(labRoles\\(\\[([^\\]]*)\\]\\)`));
  assert.ok(m, `no guarded route for ${path}`);
  return m[1].split(',').map((r) => r.trim().replace(/'/g, '')).sort();
}

test('the access table is App.jsx\'s own admissions, area by area', () => {
  // Mutation checked: widen `funds` to advisors here → this fails against App.jsx.
  for (const [area, path] of [
    ['markets', '/research/markets/sector/:slug'], ['geographies', '/research/geographies/:code'],
    ['companies', '/research/companies/company/:uid'], ['funds', '/research/funds/catalog/:id'],
    ['library', '/research/library'], ['diligence', '/research/diligence/:grantUid'],
    ['benchmarking', '/research/benchmarking/:uid'], ['clientPrep', '/research/client-prep'],
  ]) assert.deepEqual([...RESEARCH_ACCESS[area]].sort(), admitted(path), area);
});

test('each ordinary role is offered exactly the profiles it is admitted to; Lab and admin are their own case', () => {
  const table = Object.fromEntries(['founder', 'investor', 'advisor', 'partner'].map((role) => [role, researchLinks({ role }, role)]));
  assert.deepEqual(table, {
    founder: { companies: true, funds: true },
    investor: { companies: false, funds: false },
    advisor: { companies: true, funds: false },
    partner: { companies: false, funds: false },
  });
  assert.deepEqual(researchLinks({ role: 'investor', spinout_lab_active: 1 }, 'investor'), { companies: true, funds: true }, 'an active Lab admits every role');
  assert.deepEqual(researchLinks({ role: 'admin' }, 'founder'), { companies: true, funds: true });
  assert.equal(canOpenResearch('nowhere', { role: 'admin' }), false);
});

const SECTOR = {
  slug: 'fintech', name: 'Fintech', company_count: 1, fund_count: 1, submarkets: [], countries: [], signals: [],
  companies: [{ uid: 'c1', name: 'Acme Pay', country: 'FR' }], funds: [{ uid: 'f1', name: 'North Fund', hq: 'Paris' }],
};

test('a sector page drawn for an investor names companies and funds without linking them; for a founder it links', () => {
  const investor = html(h(SectorProfileView, { data: SECTOR, links: researchLinks({ role: 'investor' }, 'investor') }));
  // Mutation checked: drop the `links.companies` branch → the investor gets the company link.
  assert.doesNotMatch(investor, /href="\/research\/companies\/company\/c1"/);
  assert.doesNotMatch(investor, /href="\/research\/funds\/catalog\/f1"/);
  assert.match(investor, /Acme Pay/);
  const founder = html(h(SectorProfileView, { data: SECTOR, links: researchLinks({ role: 'founder' }, 'founder') }));
  assert.match(founder, /href="\/research\/companies\/company\/c1"/);
  assert.match(founder, /href="\/research\/funds\/catalog\/f1"/);
});

// The country page's own founder/investor link case is `research_markets_pages_d533.test.mjs`'s,
// now drawn from the same rule (`researchLinks`).

const read = (total, items) => ({ loading: false, error: null, data: { total, items } });

test('a company profile\'s fund lists: an advisor sees names and no way into Funds; a founder\'s See all keeps the filter', () => {
  const tracked = { slug: 'fintech', name: 'Fintech', country_code: 'FR' };
  const lists = { focusRead: read(12, [{ uid: 'f1', name: 'North Fund' }]), hqRead: read(40, [{ uid: 'f2', name: 'Paris Fund' }]) };
  const advisor = html(h(Funds, { tracked, ...lists, country: 'France', links: researchLinks({ role: 'advisor' }, 'advisor') }));
  assert.doesNotMatch(advisor, /href="\/research\/funds/);
  assert.match(advisor, /North Fund/);
  const founder = html(h(Funds, { tracked, ...lists, country: 'France', links: researchLinks({ role: 'founder' }, 'founder') }));
  // Mutation checked: the bare `/research/funds?view=directory` → the focus and the HQ are lost.
  assert.match(founder, /href="\/research\/funds\?view=directory&amp;focus=fintech"[^>]*>See all 12 in Funds/);
  assert.match(founder, /href="\/research\/funds\?view=directory&amp;hq_country=FR"[^>]*>See all 40 in Funds/);
});

test('the address round-trips every directory field and leaves other parameters alone', () => {
  const q = { ...EMPTY_QUERY, q: 'climate', hq_country: 'FR', focus: 'fintech', size_band: 'large', vintage: '2020', eif: true, eifo: false, sort: 'size', limit: 50, offset: 100 };
  const params = searchFromQuery(q, 'view=directory&other=1');
  assert.equal(params.get('view'), 'directory');
  assert.equal(params.get('other'), '1');
  assert.deepEqual(queryFromSearch(params), q);
  assert.equal(searchFromQuery(EMPTY_QUERY, 'view=directory').toString(), 'view=directory', 'defaults are not written');
  assert.deepEqual(queryFromSearch(new URLSearchParams('limit=9999&offset=-4&eif=yes')), { ...EMPTY_QUERY }, 'a bad value falls back to the default');
  assert.equal(directoryHref({ focus: 'fintech' }), '/research/funds?view=directory&focus=fintech');
});

test('the directory opens on the address\'s filter, writes changes back, and the filter survives a profile visit and Back', async () => {
  const real = researchFundsApi.list;
  const calls = [];
  researchFundsApi.list = async (params) => { calls.push(params); return { items: [{ uid: 'f1', name: 'North Fund' }], total: 12, coverage: { total: 2616 }, facets: null }; };
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let at; let go;
  function Probe() { at = useLocation(); go = useNavigate(); return null; }
  const ui = await mountContracts(h(React.Fragment, null, h(Probe), h(Routes, null,
    h(Route, { path: '/research/funds', element: h(FundDirectory) }),
    h(Route, { path: '/research/funds/catalog/:id', element: h('p', null, 'profile') }))), '/research/funds?view=directory&focus=fintech', { id: 1, role: 'founder' });
  try {
    await ui.flush();
    // Mutation checked: start from EMPTY_QUERY again → the first read has no focus.
    assert.equal(calls[0].focus, 'fintech', 'a direct link opens on its filter');
    assert.equal(calls[0].offset, 0);
    // A sort change is written to the address.
    const sort = ui.nodes().find((n) => n.tagName === 'SELECT' && ui.props(n)?.id === 'fd-sort');
    assert.ok(sort, 'the sort control');
    // Mutation checked: no write-back → the address keeps no sort.
    await act(async () => ui.props(sort).onChange({ target: { value: 'size' } }));
    await ui.flush();
    assert.equal(new URLSearchParams(at.search).get('sort'), 'size');
    assert.equal(new URLSearchParams(at.search).get('focus'), 'fintech');
    await act(async () => go('/research/funds/catalog/f1'));
    await ui.flush();
    await act(async () => go(-1));
    await ui.flush();
    assert.equal(new URLSearchParams(at.search).get('focus'), 'fintech', 'Back returns to the filtered directory');
    assert.equal(calls.at(-1).focus, 'fintech', 'and reads it again with the filter');
  } finally {
    await ui.unmount(); globalThis.matchMedia = oldMedia; researchFundsApi.list = real;
  }
});
