// D1413 (#3696) — Portfolio: the canvas intake, the overview with projects
// nested (PF1), the company and project pages (PF2, PF3), the create sheets
// (PF4), the switcher (PF5), settings by scope (PF6) and the legal facts
// (PF8). Mounted on a stubbed fetch; props are read off `__reactProps$`.
// The names are the canvas's own samples, used as fixtures only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_d1413.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { readDecision } from './_decisions.mjs';
import { renderedText } from './_renderedText.mjs';
import CompaniesProjects from '../src/pages/account/companies/CompaniesProjects.jsx';
import CompanySettingsTabs, { GeneralCard } from '../src/pages/account/companies/CompanySettingsTabs.jsx';
import PortfolioAddress, { portfolioTarget } from '../src/pages/account/companies/PortfolioAddress.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import * as adapter from '../src/pages/account/companies/portfolioAdapter.js';
import {
  INVESTOR_LINK, LINE, SIDEBAR_LABEL, TITLE, jurisdictionName, legalFacts, legalFormWord, peopleFact, portfolioCard, portfolioProjectFor,
  portfolioSections, slugCheckLine, slugFrom, statusPill, switcherPaths,
} from '../src/pages/account/companies/companiesModel.js';
import { accountPathFor } from '../src/pages/account/accountPhone.js';
import { scopeFor, entryLabels } from '../src/lib/settingsScope.js';
import { getActiveProject, resetActiveProjectForTests, selectProject, setActiveProject } from '../src/lib/activeProject.js';
import { PROJECTS_UNREAD, selectionLabel, switcherProjects } from '../src/ui/CompanySwitcher.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const ok = (value) => ({ available: true, value });
const gone = (reason = 'x could not be read') => ({ available: false, reason });
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ---------------------------------------------------------------- fixtures (the canvas's samples)

const ME = 2;
/** D1136 + D1412: `GET /api/account/companies`. */
const SUMMARY = { companies: [
  { uid: 'nl', company_name: '[Northwind Labs Inc.]', my_role: 'owner', is_primary_admin: true, member_count: ok(8),
    legal: ok({ legal_name: '[Northwind Labs Inc.]', legal_form: 'c_corp', jurisdiction: 'US-DE', incorporation_date: '2026-03-12' }),
    primary_location: ok({ label: 'HQ', kind: 'headquarters', city: 'Lisbon', country: 'PT' }), location_count: ok(3),
    status: ok('active'), formation: ok(null), archived_at: null, counts: { projects: ok(2) } },
  { uid: 'hr', company_name: '[Harbor Robotics GmbH]', my_role: 'member', is_primary_admin: false, member_count: gone(),
    legal: ok({ legal_name: null, legal_form: null, jurisdiction: null, incorporation_date: null }),
    primary_location: ok(null), location_count: ok(0), status: ok('in_formation'), formation: ok({ order_id: 4 }), archived_at: null, counts: { projects: ok(0) } },
] };
const KNOWN = [{ id: 7, uid: 'nl', company_name: '[Northwind Labs Inc.]', my_role: 'owner', is_primary_admin: true }, { id: 8, uid: 'hr', company_name: '[Harbor Robotics GmbH]', my_role: 'member' }];
/** D1136: `GET /api/account/projects`, owned or seated. */
const PROJECTS = { projects: [
  { id: 1, name: '[Atlas Pilot]', my_seat: 'owner', company_id: 7, company_uid: 'nl', company_name: '[Northwind Labs Inc.]', stage: 'mvp', member_count: ok(4) },
  { id: 2, name: '[Lantern]', my_seat: 'owner', company_id: null, company_uid: null, company_name: null, stage: 'validation', member_count: ok(2) },
  { id: 3, name: '[Orbit Freight]', my_seat: 'cofounder', company_id: 99, company_uid: 'c99', company_name: 'Orbit Co', stage: 'mvp', member_count: gone() },
] };
/** D1415 part 2: `GET /api/account/switcher`. */
const SWITCHER = {
  companies: [
    { uid: 'nl', name: '[Northwind Labs Inc.]', slug: 'northwind-labs', path: '/c/northwind-labs', projects: ok([{ id: 1, name: '[Atlas Pilot]', path: '/c/northwind-labs/p/atlas-pilot' }]) },
    { uid: 'hr', name: '[Harbor Robotics GmbH]', slug: null, path: '/c/hr', projects: ok([]) },
  ],
  standalone: ok([{ id: 2, name: '[Lantern]', path: '/p/lantern' }]),
  elsewhere: ok([{ id: 3, name: '[Orbit Freight]', path: '/c/c99/p/3', company_name: 'Orbit Co' }]),
};
const COMPANY = { uid: 'nl', company_name: '[Northwind Labs Inc.]', website: 'northwind.example', logo_url: null, archived_at: null, members: [
  { user_id: ME, name: '[Avery Stone]', email: 'avery@example.test', role_in_company: 'Owner', is_primary_admin: true },
  { user_id: 5, name: '[Jordan Reyes]', email: 'jordan@example.test', role_in_company: 'Admin', is_primary_admin: false },
] };
/** D1415 + D1593: `GET /api/company/:uid/legal`. */
const LEGAL = {
  uid: 'nl', company_name: '[Northwind Labs Inc.]', legal_name: '[Northwind Labs Inc.]', legal_form: 'c_corp', jurisdiction: 'US-DE',
  registration_number: '7712345', incorporation_date: '2026-03-12', registered_agent_name: null, slug: 'northwind-labs', path: '/c/northwind-labs',
  registered_address: ok({ uid: 'l1', kind: 'registered', line1: '251 Little Falls Drive', city: 'Wilmington', region: 'DE', postal_code: '19808', country: 'US' }),
  mailing_address: ok(null), tax_id: ok({ recorded: true, kind: 'ein', last4: '4821' }),
  officers: ok([{ uid: 'o1', name: '[Avery Stone]', office: 'director', title: 'CEO', ceased_on: null }]),
  locations: ok([{ uid: 'l1', kind: 'registered', label: null, city: 'Wilmington', region: 'DE', country: 'US', closed_on: null }, { uid: 'l2', kind: 'headquarters', label: null, city: 'Lisbon', country: 'PT', closed_on: null }]),
  archived: false, can_edit: true,
};
const DOCS = { slots: [
  { kind: 'certificate_of_incorporation', label: 'Certificate of incorporation', document: { uid: 'd1', title: 'Certificate', created_at: '2026-03-12', has_file: true } },
  { kind: 'registered_agent_agreement', label: 'Registered agent agreement', document: null },
], other: ok([]), ventures: ok([]), can_upload: true };

function worker(over = {}) {
  return (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'http://x').pathname;
    const key = `${method} ${path}`;
    if (over[key]) return over[key](init);
    if (path === '/api/account/companies') return response(SUMMARY);
    if (path === '/api/account/projects') return response(PROJECTS);
    if (path === '/api/account/switcher') return response(SWITCHER);
    if (path === '/api/account/invitations') return response({ company: ok([]), project: ok([]) });
    if (key === 'GET /api/company/nl') return response(COMPANY);
    if (key === 'GET /api/company/nl/legal') return response(LEGAL);
    if (key === 'GET /api/company/nl/documents') return response(DOCS);
    if (key === 'GET /api/company/zz') return response({ code: 'not_found' }, 404);
    if (key === 'GET /api/projects/2') return response({ id: 2, name: '[Lantern]', company_id: null, stage: 'validation', sector: 'Climate', created_at: '2026-09-12 10:00:00', hq: null });
    if (key === 'GET /api/projects/2/members') return response({ members: [{ user_id: ME, name: '[Avery Stone]', role: 'owner', email: 'avery@example.test' }], can_manage: true, my_role: 'owner' });
    if (key === 'GET /api/projects/1') return response({ id: 1, name: '[Atlas Pilot]', company_id: 7, stage: 'mvp', sector: null, created_at: '2026-04-03 10:00:00', hq: 'Lisbon, Portugal' });
    if (key === 'GET /api/projects/1/members') return response({ members: [{ user_id: ME, name: '[Avery Stone]', role: 'owner' }], can_manage: true, my_role: 'owner' });
    if (path.startsWith('/api/account/slug-check')) return response({ available: true, reason: null, suggestion: null });
    if (method !== 'GET') return response({ ok: true, id: 9, uid: 'c9', company_name: 'Newco', name: 'Tidewater' });
    return response({});
  };
}

function Where() { const l = useLocation(); return h('i', { 'data-testid': 'where', 'data-path': l.pathname, 'data-search': l.search }); }

async function mount(role, { url = '/account/portfolio', handle = worker(), known = KNOWN, active = { id: 7, uid: 'nl', company_name: '[Northwind Labs Inc.]' }, element = null, path = null } = {}) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: ME, role, name: '[Avery Stone]' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    let body = null;
    try { body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
    seen.push({ call: `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`, body });
    return handle(String(u), init);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const switched = [];
  const created = [];
  const ctx = { company: active, setCompany: (c) => switched.push(c), companies: known, setCompanies: (c) => created.push(c) };
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const page = element || h(CompaniesProjects, { role });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] },
    h(AuthProvider, null, h(ActiveCompanyContext.Provider, { value: ctx },
      h(Routes, null,
        h(Route, { path: path || '/account/portfolio/*', element: h(React.Fragment, null, h(Where), page) }),
        h(Route, { path: '*', element: h(Where) })))))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const all = (id) => walk(document.body).filter((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    seen, switched,
    reads: () => seen.filter((s) => s.call.startsWith('GET ')).map((s) => s.call),
    writes: () => seen.filter((s) => !s.call.startsWith('GET ') && s.call !== 'POST /api/client-error'),
    text: () => textOf(document.body),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), count: (id) => all(id).length, prop: (id, k) => props(byId(id))?.[k],
    path: () => props(byId('where'))?.['data-path'],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v, checked: v } }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ---------------------------------------------------------------- the intake

test('the intake: the four canvases landed with support.js, each grid imports its page by name, and D1413 records them', () => {
  const files = ['Portfolio Account Page.dc.html', 'Portfolio · Boards.dc.html', 'Incorporate Flow Page.dc.html', 'Incorporate · Boards.dc.html'];
  for (const f of files) assert.ok(read(`design/incoming/${f}`).includes('src="./support.js"'), f);
  const pf = read('design/incoming/Portfolio · Boards.dc.html');
  const inc = read('design/incoming/Incorporate · Boards.dc.html');
  assert.match(pf, /dc-import name="Portfolio Account Page"/);
  assert.match(inc, /dc-import name="Incorporate Flow Page"/);
  assert.ok(pf.includes('PF8') && inc.includes('INC7'), 'each grid ends at its last board');
  assert.ok(existsSync('documentation/architecture/decisions/D1413.md'));
  const d = readDecision(1413);
  assert.match(d, /^## D1413 — /);
  for (const issue of ['#3932', '#3713', '#3706', '#3855']) assert.ok(d.includes(issue), `D1413 names ${issue}`);
});

// ---------------------------------------------------------------- the model

test('Portfolio is the section\'s name (owner Q1), and an investor\'s two Portfolios link to each other', () => {
  assert.equal(TITLE, 'Portfolio');
  assert.equal(SIDEBAR_LABEL, 'Portfolio');
  assert.match(LINE, /A company is a legal entity\. A project can stand alone, or sit inside a company\./);
  assert.deepEqual(INVESTOR_LINK, { label: 'Also in your investor Portfolio ›', to: '/portfolio' });
  assert.match(read('frontend/src/pages/investor/InvestorPortfolioCanvas.jsx'), /ACCOUNT_LINK\.label/);
  assert.match(read('frontend/src/ui/SidebarNav.jsx'), /<span className="truncate">Portfolio<\/span>/);
});

test('the cards: D1412\'s legal line, location and status; a missing fact is "none", a failed one "unread", never 0', () => {
  const [nl, hr] = SUMMARY.companies.map((c) => portfolioCard(c));
  assert.deepEqual(nl.jurisdiction, { kind: 'value', text: 'Delaware, United States' });
  assert.deepEqual(nl.entityType, { kind: 'value', text: 'C-Corporation' });
  assert.deepEqual(nl.team, { kind: 'value', text: '8 people' });
  assert.deepEqual(nl.location, { kind: 'value', text: 'Lisbon, Portugal +2' });
  assert.deepEqual(nl.status, { label: 'Active', tone: 'ok' });
  assert.deepEqual(hr.status, { label: 'In formation', tone: 'warn' });
  assert.deepEqual(hr.jurisdiction, { kind: 'none' });
  assert.deepEqual(hr.location, { kind: 'none' });
  assert.deepEqual(hr.team, { kind: 'unread', what: 'Team' }, 'a failed count is never "0 people"');
  assert.deepEqual(peopleFact({ available: true, value: 1 }), { kind: 'value', text: '1 person' });
  assert.equal(statusPill(gone()), null, 'an unread status draws no pill');
  assert.deepEqual(statusPill(ok('active'), '2026-10-01'), { label: 'Archived', tone: 'neutral' });
  assert.equal(jurisdictionName('pt'), 'Portugal');
  assert.equal(jurisdictionName('GB-SCT'), 'Scotland, United Kingdom');
  assert.equal(legalFormWord('ltd'), 'Private limited company');
  assert.equal(slugFrom('Harbor Robotics GmbH'), 'harbor-robotics-gmbh');
  assert.deepEqual(slugCheckLine({ available: true }), { ok: true, text: '✓ Available' });
  assert.match(slugCheckLine({ available: false, reason: 'slug_taken', suggestion: 'ledgerline-2' }).text, /That address is taken\. Try ledgerline-2\./);
});

test('the sections nest projects by company_uid, then standalone, then seats; an unread projects read is unread under each card', () => {
  const s = portfolioSections(SUMMARY, PROJECTS, { switcher: SWITCHER, activeUid: 'nl' });
  assert.deepEqual(s.companies.map((c) => [c.uid, c.path, c.active, c.projects.value.map((p) => [p.id, p.path, p.team])]), [
    ['nl', '/c/northwind-labs', true, [[1, '/c/northwind-labs/p/atlas-pilot', '4']]],
    ['hr', '/c/hr', false, []],
  ]);
  assert.deepEqual(s.standalone.value.map((p) => [p.id, p.path, p.owner]), [[2, '/p/lantern', true]]);
  assert.deepEqual(s.seats.value.map((p) => [p.id, p.companyName, p.teamUnread]), [[3, 'Orbit Co', true]]);
  const unread = portfolioSections(SUMMARY, null);
  assert.ok(unread.companies.every((c) => c.projects.available === false), 'an unread list is not "no projects"');
  assert.equal(switcherPaths(null).size, 0, 'no switcher, no chips: never guessed');
});

test('the legal facts (PF2, PF8): masked tax ID, addresses in one line, officers by name; unread blocks stay unread', () => {
  const f = legalFacts(LEGAL);
  assert.equal(f.taxId.text, '•••• 4821');
  assert.match(f.registeredAddress.text, /251 Little Falls Drive, Wilmington, DE 19808, United States/);
  assert.equal(f.officers.text, '[Avery Stone] · CEO · Director');
  assert.deepEqual(f.registeredAgent, { kind: 'none' });
  assert.deepEqual(f.mailingAddress, { kind: 'none' });
  const broken = legalFacts({ ...LEGAL, tax_id: gone(), officers: gone(), registered_address: gone() });
  assert.deepEqual([broken.taxId.kind, broken.officers.kind, broken.registeredAddress.kind], ['unread', 'unread', 'unread']);
});

// ---------------------------------------------------------------- PF1 mounted

test('PF1 mounted: cards with their projects nested, addresses, standalone with Make it a company, seats; never GET /api/projects', async () => {
  const v = await mount('founder');
  try {
    assert.match(v.of('portfolio-companies-count'), /Companies · 2/);
    assert.equal(v.count('company-card'), 2);
    assert.match(v.of('portfolio-project-1'), /\[Atlas Pilot\].*Project.*\/c\/northwind-labs\/p\/atlas-pilot.*MVP.*Team 4/s);
    assert.match(v.of('company-facts'), /Delaware, United States.*C-Corporation.*8 people.*Lisbon, Portugal \+2/s);
    assert.ok(v.text().includes('In formation'));
    assert.equal(v.prop('standalone-incorporate-2', 'href'), '/incorporate?project=2');
    assert.match(v.of('portfolio-seats'), /\[Orbit Freight\].*in Orbit Co/s);
    assert.ok(!v.reads().includes('GET /api/projects'), 'the every-project read');
    assert.ok(v.reads().includes('GET /api/account/switcher'));
    // Harbor's facts: "Not recorded" (muted) and its team "could not be read", never 0.
    const harbor = v.text().slice(v.text().indexOf('[Harbor Robotics GmbH]'));
    assert.match(harbor, /Not recorded/);
    assert.match(harbor, /Team could not be read/);
    assert.doesNotMatch(harbor.slice(0, 400), /\b0 people\b/);
    assert.match(v.of('portfolio-renamed'), /Companies and projects is now Portfolio, at \/account\/portfolio\./);
  } finally { await v.close(); }
});

test('pf7c2: one projects read failing is said under each company alone, while the cards still draw', async () => {
  const v = await mount('founder', { handle: worker({ 'GET /api/account/projects': () => response({ error: 'x' }, 503) }) });
  try {
    assert.equal(v.count('company-card'), 2);
    assert.equal(v.count('company-projects-unread'), 2);
    assert.match(v.of('company-projects-unread'), /Its projects could not be read\. That is not the same as having none\.Try again/);
    assert.ok(v.has('standalone-unread'));
  } finally { await v.close(); }
});

test('PF1m and PF4b: New ▾ opens Company or Project; New project sends its company in one create; a 402 says the plan', async () => {
  let v = await mount('founder');
  try {
    assert.equal(v.prop('portfolio-new', 'aria-haspopup'), 'menu');
    await v.click('portfolio-new');
    assert.match(v.of('portfolio-new-menu'), /CompanyA legal entity.*ProjectStart before you incorporate, or inside a company/s);
    await v.click('portfolio-new-project');
    await v.change('new-project-name', 'Tidewater');
    await v.change('new-project-pick-nl', true);
    await v.click('new-project-confirm');
    const w = v.writes();
    assert.deepEqual(w.map((x) => x.call), ['POST /api/projects']);
    assert.equal(w[0].body.company_id, 7);
    assert.equal(w[0].body.name, 'Tidewater');
  } finally { await v.close(); }
  v = await mount('founder', { handle: worker({ 'POST /api/projects': () => response({ error: 'tier_required', required: 'growth' }, 402) }) });
  try {
    await v.click('company-add-project-nl');
    await v.change('new-project-name', 'Second');
    await v.click('new-project-confirm');
    assert.match(v.of('new-project-locked'), /Your plan includes one active project/);
  } finally { await v.close(); }
});

test('PF4a: only the name is required (owner Q2); filled legal fields go on the create, then the tax ID and the address', async () => {
  const v = await mount('founder');
  try {
    await v.click('portfolio-new');
    await v.click('portfolio-new-company');
    assert.equal(v.prop('new-company-confirm', 'disabled'), true);
    await v.change('new-company-name', 'Newco');
    assert.equal(v.prop('new-company-confirm', 'disabled'), false, 'the name alone is enough');
    await v.change('new-company-form', 'gmbh');
    await v.change('new-company-tax-id', 'DE123456789');
    await v.click('new-company-confirm');
    const w = v.writes();
    assert.equal(w[0].call, 'POST /api/company/create');
    assert.deepEqual(w[0].body, { legal_form: 'gmbh', slug: 'newco', company_name: 'Newco' });
    assert.equal(w[1].call, 'PUT /api/company/c9/tax-id');
    assert.match(v.of('companies-done'), /Newco is created and active on this device/);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- PF2, PF3

test('PF2: the company page draws each block alone; Legal failing leaves Team and Documents; people by name, never by email', async () => {
  let v = await mount('founder', { url: '/account/portfolio/nl' });
  try {
    assert.match(v.of('company-legal-facts'), /Delaware, United States.*7712345.*•••• 4821.*251 Little Falls Drive.*12 Mar 2026.*\[Avery Stone\] · CEO · Director/s);
    assert.match(v.of('company-locations'), /Registered office.*Wilmington.*Headquarters.*Lisbon, Portugal/s);
    assert.match(v.of('company-document-registered_agent_agreement'), /Registered agent agreementNot recorded.*Upload/s);
    assert.equal(v.prop('company-legal-edit', 'href'), '/account/portfolio/nl/settings/legal');
    assert.doesNotMatch(v.of('company-page'), /@example\.test/, 'people appear by name');
    assert.match(v.of('company-team'), /\[Avery Stone\] · you.*\[Jordan Reyes\]/s);
  } finally { await v.close(); }
  v = await mount('founder', { url: '/account/portfolio/nl', handle: worker({ 'GET /api/company/nl/legal': () => response({ error: 'x' }, 503) }) });
  try {
    assert.match(v.of('company-legal-unread'), /^Legal information could not be read\./);
    assert.match(v.of('company-locations-unread'), /^Locations could not be read\./);
    assert.ok(v.has('company-team') && !v.has('company-team-unread'), 'Team still draws');
    assert.ok(v.has('company-document-certificate_of_incorporation'), 'Documents still draw');
  } finally { await v.close(); }
  v = await mount('founder', { url: '/account/portfolio/zz' });
  try {
    assert.match(v.of('company-not-yours'), /This company is not yours to open\./);
  } finally { await v.close(); }
});

test('PF3: a standalone project offers Make it a company (Incorporate, prefilled) and Move; a linked one names its company', async () => {
  let v = await mount('founder', { url: '/account/portfolio/projects/2' });
  try {
    assert.match(v.of('project-not-a-company'), /Not a company yet.*\[Lantern\] is a standalone project\. It is not a legal entity\./s);
    assert.equal(v.prop('project-make-company', 'href'), '/incorporate?project=2');
    assert.ok(v.has('project-move-under'));
    assert.match(v.of('project-facts'), /\/p\/lantern.*Validation.*Climate.*12 Sep 2026.*LocationNot recorded/s);
    assert.doesNotMatch(v.text(), /Legal/, 'a standalone project has no Legal anywhere');
  } finally { await v.close(); }
  v = await mount('founder', { url: '/account/portfolio/projects/1' });
  try {
    assert.match(v.of('project-linked-company'), /\[Northwind Labs Inc\.\].*Delaware, United States · C-Corporation.*Open company/s);
    assert.equal(v.prop('project-page-settings', 'href'), '/account/portfolio/nl/settings/projects/1');
  } finally { await v.close(); }
  assert.equal(portfolioProjectFor('/account/portfolio/projects/12'), '12');
  assert.equal(accountPathFor({ section: 'companies', projectId: '12' }), '/account/portfolio/projects/12');
});

// ---------------------------------------------------------------- PF6, PF8

test('PF6a: Default currency reads "Coming later" through the seam (#3932), never USD', async () => {
  const out = await adapter.defaultCurrency('nl');
  assert.deepEqual(out, { available: false, reason: 'Coming later', waitsOn: '#3932' });
  const v = await mount('founder', { element: h(GeneralCard, { uid: 'nl', detail: COMPANY, path: '/c/northwind-labs' }) });
  try {
    assert.match(v.of('company-general-facts'), /Default currencyComing later/);
    assert.doesNotMatch(v.text(), /USD/);
    assert.match(v.of('company-general-facts'), /LogoNot recorded/);
  } finally { await v.close(); }
});

test('PF8: Company settings › Legal draws the facts and Edit; a member who is not an editor is told who may change them', async () => {
  let v = await mount('founder', { url: '/account/portfolio/nl/settings/legal', path: '/account/portfolio/:uid/settings/legal', element: h(CompanySettingsTabs, { tab: 'legal' }) });
  try {
    assert.match(v.of('company-legal-tab-facts'), /Registered agentNot recorded.*Mailing addressNot recorded/s);
    await v.click('company-legal-tab-edit');
    assert.ok(v.has('legal-sheet'));
    assert.equal(v.of('legal-tax-masked'), '•••• 4821', 'the tax ID is never shown whole');
    await v.change('legal-agent', '[Axal VC agent partner]');
    await v.click('legal-sheet-save');
    assert.deepEqual(v.writes().map((w) => [w.call, w.body]), [['PUT /api/company/nl/legal', { registered_agent_name: '[Axal VC agent partner]' }]]);
  } finally { await v.close(); }
  v = await mount('founder', {
    url: '/account/portfolio/nl/settings/legal', path: '/account/portfolio/:uid/settings/legal', element: h(CompanySettingsTabs, { tab: 'legal' }),
    handle: worker({ 'GET /api/company/nl/legal': () => response({ ...LEGAL, can_edit: false }) }),
  });
  try {
    assert.ok(!v.has('company-legal-tab-edit'));
    assert.match(v.of('company-legal-read-only'), /Only an admin of \[Northwind Labs Inc\.\] can change this\./);
  } finally { await v.close(); }
});

test('PF6: the scope block — Legal has its address for a company; a standalone project has no Legal; a picked project decides', () => {
  const co = scopeFor({ company: { uid: 'nl', name: 'x' } });
  assert.equal(co.entries[1].children.find((c) => c.key === 'legal').path, '/account/portfolio/nl/settings/legal');
  const solo = scopeFor({ project: { id: 2, name: '[Lantern]', company: null } });
  assert.ok(!JSON.stringify(solo).includes('Legal'));
  assert.deepEqual(entryLabels(solo), ['Team', 'Project settings', 'General']);
  const inCo = scopeFor({ project: { id: 1, name: '[Atlas Pilot]', company: { uid: 'nl', name: 'x' } } });
  assert.equal(inCo.kind, 'company_project');
  assert.ok(read('frontend/src/ui/SidebarNav.jsx').includes('useScopeInView(activeCompany, activeProject)'));
});

// ---------------------------------------------------------------- PF5

test('PF5: the switcher nests projects, keeps the companies when projects fail, and badges the selection', () => {
  const parts = switcherProjects(SWITCHER);
  assert.deepEqual(parts.byCompany.get('nl').map((p) => p.id), [1]);
  assert.deepEqual(parts.standalone.map((p) => p.id), [2]);
  const broken = switcherProjects({ ...SWITCHER, standalone: gone(), companies: [{ ...SWITCHER.companies[0], projects: gone() }] });
  assert.equal(broken.byCompany, null);
  assert.equal(broken.standalone, null, 'a failed block is null, never []');
  assert.equal(PROJECTS_UNREAD, 'Projects could not be read');
  assert.deepEqual(selectionLabel({ company_name: 'NL' }, null, {}), { name: 'NL', type: 'Company', sub: null });
  assert.deepEqual(selectionLabel(null, { id: 2, name: '[Lantern]', company: null }, {}), { name: '[Lantern]', type: 'Project', sub: 'Standalone' });
  assert.equal(selectionLabel(null, { id: 1, name: 'A', company: { uid: 'nl', name: 'NL' } }, {}).sub, 'in NL');
  const src = read('frontend/src/ui/CompanySwitcher.jsx');
  assert.match(src, /data-testid="switcher-projects-unread"/);
  assert.match(src, /Create project/);
});

test('PF5: picking a project makes its company active; a throwing store still switches', () => {
  const restore = installDocument();
  try {
    resetActiveProjectForTests();
    const switched = [];
    selectProject({ id: 1, name: '[Atlas Pilot]', company: { uid: 'nl', name: 'NL' } }, { companies: KNOWN, switchTo: (c) => switched.push(c.uid) });
    assert.deepEqual(switched, ['nl']);
    assert.equal(getActiveProject().id, 1);
    selectProject({ id: 2, name: '[Lantern]', company: null }, { companies: KNOWN, switchTo: (c) => switched.push(c.uid) });
    assert.deepEqual(switched, ['nl'], 'a standalone project leaves the active company');
    localStorage.setItem = () => { throw new Error('blocked'); };
    localStorage.getItem = () => { throw new Error('blocked'); };
    setActiveProject({ id: 3, name: 'X', company: null });
    assert.equal(getActiveProject().id, 3, 'the tab still switches');
    resetActiveProjectForTests();
    assert.equal(getActiveProject(), null, 'a throwing store reads as none, never a crash');
  } finally { restore(); resetActiveProjectForTests(); }
});

// ---------------------------------------------------------------- addresses

test('the canonical addresses resolve under Account; anything not yours reads "This is not yours to open"', async () => {
  assert.equal(portfolioTarget({ company_uid: 'nl', project_id: null }), '/account/portfolio/nl');
  assert.equal(portfolioTarget({ company_uid: 'nl', project_id: 1 }), '/account/portfolio/projects/1');
  assert.equal(portfolioTarget({ company_uid: 'nl', project_id: 1 }, 'general'), '/account/portfolio/nl/settings/projects/1');
  assert.equal(portfolioTarget({ company_uid: null, project_id: 2 }, 'general'), '/projects/2/settings');
  assert.equal(portfolioTarget({ company_uid: 'nl' }, 'legal'), '/account/portfolio/nl/settings/legal');
  let v = await mount('founder', { url: '/c/northwind-labs', path: '/c/*', element: h(PortfolioAddress),
    handle: worker({ 'GET /api/account/resolve': () => response({ kind: 'company', company_uid: 'nl', project_id: null }) }) });
  try {
    assert.equal(v.path(), '/account/portfolio/nl');
    assert.ok(v.seen.some((s) => s.call === 'GET /api/account/resolve'));
  } finally { await v.close(); }
  v = await mount('founder', { url: '/c/someone-else', path: '/c/*', element: h(PortfolioAddress),
    handle: worker({ 'GET /api/account/resolve': () => response({ code: 'not_found' }, 404) }) });
  try {
    assert.match(v.of('portfolio-address-refused'), /This is not yours to open\./);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- house rules in the source

test('house rules: no Fill, no Ask on Account, no every-project read, no lightbox, no client before its route', () => {
  const dir = 'frontend/src/pages/account/companies';
  const files = readdirSync(dir).filter((f) => /\.(jsx?|mjs)$/.test(f));
  const src = files.map((f) => codeOnly(read(`${dir}/${f}`))).join('\n');
  assert.doesNotMatch(src, /\bFill\b/, 'the button is Ask, never Fill');
  assert.doesNotMatch(src, /AskButton|EadwynButton|openEadwynPanel/, 'Account has no Ask (owner Q8)');
  assert.doesNotMatch(src, /listProjects\(/, 'the every-project read');
  assert.ok(!existsSync(`${dir}/CompanyLightbox.jsx`), 'the company page replaced the lightbox (owner Q3)');
  assert.doesNotMatch(src, /CompanyLightbox/);
  // The seam imports only clients that exist; each is drift-checked against a mounted route.
  const seam = read(`${dir}/portfolioAdapter.js`);
  for (const m of seam.matchAll(/from '\.\.\/\.\.\/\.\.\/lib\/api\/([a-zA-Z]+)\.js'/g)) assert.ok(existsSync(`frontend/src/lib/api/${m[1]}.js`), m[1]);
  assert.match(seam, /defaultCurrency = \(\/\* uid \*\/\) => Promise\.resolve\(unavailable\(CURRENCY_LATER, '#3932'\)\)/);
  // A failed read is "[Block] could not be read", alone, with Try again.
  assert.match(read(`${dir}/portfolioUi.jsx`), /\{what\} could not be read\. That is not the same as having none\./);
  // No bank link anywhere (owner Q7).
  assert.doesNotMatch(src, /bank account/i);
});

test('the routes: company settings tabs and the project page beside their siblings in App.jsx; the addresses in their module', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/account/portfolio/:uid/settings/legal', '/account/portfolio/:uid/settings/projects', '/account/portfolio/:uid/settings/projects/:id', '/account/portfolio/projects/:id']) {
    assert.ok(app.includes(`<Route path="${p}"`), p);
  }
  const mod = read('frontend/src/routes/portfolio.jsx');
  assert.match(mod, /<Route path="\/c\/\*"/);
  assert.match(mod, /<Route path="\/p\/\*"/);
  assert.ok(app.includes('{portfolioRoutes(routeTools)}'));
});

test('the rendered overview says "Not recorded" in muted grey, never red', async () => {
  const html = renderToStaticMarkup(h('div', null, h((await import('../src/pages/account/companies/portfolioUi.jsx')).Fact, { fact: { kind: 'none' } })));
  assert.match(html, /<span class="italic text-gray-500 dark:text-gray-400">Not recorded<\/span>/);
  assert.doesNotMatch(html, /red/);
  assert.equal(renderedText(html), 'Not recorded');
});
