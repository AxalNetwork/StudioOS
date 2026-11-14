// D1138 (#3018, part 4 of #2422) — Account › Companies and projects
// complete: the tabs at their own addresses, each profile's board from part 2's
// reads (D1136), the two in-page dialogs, and the states (CMP1, CMP3, CMP5,
// CMP9–CMP18). Mounted on a stubbed fetch; props are read off `__reactProps$`.
// Every name and figure is made up.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/companies_projects_d1138.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CompaniesProjects from '../src/pages/account/companies/CompaniesProjects.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import {
  answerCopy, canCreate, companiesPathFor, companiesTabFor, companyCards, cyclesLine, engagementRows, fundGroups,
  invitationRows, profileOf, projectGroups, tabCount, tabsFor,
} from '../src/pages/account/companies/companiesModel.js';
import { accountPathFor, accountViewFor } from '../src/pages/account/accountPhone.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const ok = (value) => ({ available: true, value });
const gone = (reason) => ({ available: false, reason });
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// `account_companies.ts` GET /account/companies (D1136).
const SUMMARY = { companies: [
  { uid: 'c7', company_name: 'Harbor Ledger', stage: 'seed', my_role: 'owner', title: 'Managing partner', authority: 'vote', is_primary_admin: true,
    member_count: ok(4), cycles_active: ok(['validate', 'build']), last_opened: ok('2026-10-03T10:00:00Z'), pending_invitations: ok(2),
    counts: { projects: ok(1), funds: ok(1), engagements: ok(3), quotes: ok(0), offers: gone('The offers could not be read') } },
  { uid: 'c8', company_name: 'Bluefern Labs', stage: null, my_role: 'member', title: null, authority: 'work', is_primary_admin: false,
    member_count: gone('The member counts could not be read'), cycles_active: gone('x'), last_opened: ok(null),
    counts: { projects: ok(0), funds: ok(0), engagements: ok(0), quotes: ok(0), offers: ok(0) } },
] };
// The switcher's membership list: it carries the numeric id the funds read uses.
const KNOWN = [{ id: 7, uid: 'c7', company_name: 'Harbor Ledger' }, { id: 8, uid: 'c8', company_name: 'Bluefern Labs' }];
// `account_companies.ts` GET /account/projects.
const PROJECTS = { projects: [
  { id: 1, uid: 'p1', name: 'Ledger app', my_seat: 'owner', company_uid: 'c7', company_name: 'Harbor Ledger', stage: 'mvp', playbook_week: 'week_2', member_count: ok(3), cycles_active: ok(['validate']) },
  { id: 2, uid: 'p2', name: 'Field kit', my_seat: 'owner', company_uid: null, company_name: null, stage: 'idea', playbook_week: null, member_count: ok(1), cycles_active: ok([]) },
  { id: 3, uid: 'p3', name: 'Orbit Freight', my_seat: 'cofounder', company_uid: 'c99', company_name: 'Orbit Co', stage: 'mvp', playbook_week: null, member_count: gone('x'), cycles_active: gone('x') },
] };
// `account_companies.ts` GET /account/invitations.
const INVITES = {
  company: ok([{ uid: 'ci1', company_uid: 'c50', company_name: 'Juniper Grid', role_in_company: 'member', title: null, invited_by_name: 'Ana Example', created_at: '2026-10-20 10:00:00', expires_at: '2026-11-04 10:00:00' }]),
  project: ok([{ id: 41, project_id: 9, project_uid: 'p9', project_name: 'Saltmarsh Energy', role: 'cofounder', invited_by_name: 'Ben Sample', created_at: '2026-10-22 10:00:00', expires_at: null, can_accept: true }]),
};
const FUNDS = { ok: true, items: [
  { id: 11, name: 'Fund I', vintage_year: 2024, status: 'fundraising', company_id: 7, can_manage: true },
  { id: 12, name: 'Angel SPV', vintage_year: 2025, status: 'active', company_id: null, can_manage: false },
] };
const GRANTS = { items: [{ grant_uid: 'g1', project_uid: 'p5', project_name: 'Clinic App', scope_project: true, scope_data_room: true, scope_sessions: false, created_at: '2026-09-02 10:00:00', expires_at: '2027-01-30 10:00:00' }] };

function worker(over = {}) {
  return (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'http://x').pathname;
    const key = `${method} ${path}`;
    if (over[key]) return over[key]();
    if (path === '/api/account/companies') return response(SUMMARY);
    if (path === '/api/account/projects') return response(PROJECTS);
    if (path === '/api/account/invitations') return response(INVITES);
    if (path === '/api/funds') return response(FUNDS);
    if (path === '/api/advisor-grants/shared/list') return response(GRANTS);
    if (path === '/api/company/memberships') return response(KNOWN);
    return response({});
  };
}

async function mount(role, { url = '/account/portfolio', handle = worker(), phone = false, user = null, known = KNOWN, active = { uid: 'c7' } } = {}) {
  const restore = installDocument();
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => { seen.push(`${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`); return handle(String(u), init); };
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const setCompanies = () => {};
  const ctx = { company: active, setCompany: () => {}, companies: known, setCompanies };
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] },
    h(AuthProvider, null, h(ActiveCompanyContext.Provider, { value: ctx }, h(CompaniesProjects, { role }))))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const all = (id) => walk(document.body).filter((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    seen, reads: () => seen.filter((s) => s.startsWith('GET ')), writes: () => seen.filter((s) => !s.startsWith('GET ')),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), count: (id) => all(id).length, prop: (id, k) => props(byId(id))?.[k],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v } }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('each profile\'s tabs, at their own addresses; an Explorer cannot create a company', () => {
  assert.deepEqual(tabsFor(profileOf('founder')), ['companies', 'projects', 'invitations']);
  assert.deepEqual(tabsFor(profileOf('investor')), ['companies', 'funds', 'invitations']);
  assert.deepEqual(tabsFor(profileOf('partner')), ['companies', 'projects', 'invitations']);
  assert.deepEqual(tabsFor(profileOf('advisor')), ['companies', 'engagements', 'invitations']);
  assert.deepEqual(tabsFor(profileOf('exploring')), ['companies', 'invitations']);
  assert.deepEqual([profileOf('admin'), profileOf('admin', true)], ['admin', 'hq']);
  assert.equal(canCreate('explorer'), false);
  assert.equal(canCreate('founder'), true);
  for (const tab of ['companies', 'projects', 'funds', 'engagements', 'invitations']) {
    const path = companiesPathFor(tab);
    assert.equal(companiesTabFor(path), tab);
    assert.equal(accountViewFor({ pathname: path }), 'companies');
    assert.equal(accountPathFor({ section: 'companies', companiesTab: tab }), path);
  }
  assert.equal(companiesPathFor('companies'), '/account/portfolio');
  assert.equal(companiesTabFor('/account/portfolio/nope'), 'companies');
});

test('a card says what each block holds: an unread count or cycle list is never 0 or "none"', () => {
  const [a, b] = companyCards(SUMMARY, { activeUid: 'c7', known: KNOWN });
  assert.deepEqual([a.id, a.name, a.primary, a.authority, a.members, a.invitations, a.cycles, a.lastOpened, a.active, a.stage],
    [7, 'Harbor Ledger', true, 'Vote', '4 members', '2 invitations pending', 'Validate, Build', '3 Oct 2026', true, 'Seed']);
  assert.deepEqual([b.members, b.invitations, b.cycles, b.lastOpened, b.active], ['Members: could not be read', null, 'Cycles: could not be read', 'Not opened yet', false]);
  assert.equal(a.counts.offers, null);
  assert.equal(a.counts.quotes, 0);
  assert.equal(cyclesLine(ok([])), 'No cycle in use');
  assert.equal(companyCards({ companies: [{ uid: 'z', company_name: ' ' }] })[0].name, 'Not recorded');
});

test('ventures: by company, then my ventures in no company, then seats on other companies\' ventures', () => {
  const groups = projectGroups(PROJECTS, SUMMARY.companies);
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.name)]), [
    ['Harbor Ledger', ['Ledger app']], ['Not in a company', ['Field kit']], ['Seats on other ventures', ['Orbit Freight']],
  ]);
  assert.deepEqual([groups[0].rows[0].seat, groups[0].rows[0].members, groups[0].rows[0].week], ['Owner', '3 members', 'week 2']);
  assert.deepEqual([groups[2].rows[0].seat, groups[2].rows[0].members, groups[2].rows[0].cycles], ['Co-founder', 'Members: could not be read', 'Cycles: could not be read']);
});

test('invitations: both kinds, newest first; a failed block is named; an investor cannot take a seat', () => {
  const { rows, failed } = invitationRows(INVITES);
  assert.deepEqual(rows.map((r) => [r.kind, r.title, r.canAccept, r.canDecline]), [
    ['project', 'Saltmarsh Energy · as Co-founder', true, true], ['company', 'Juniper Grid · as Member', true, false],
  ]);
  assert.deepEqual(failed, []);
  const partial = invitationRows({ company: gone('x'), project: ok([{ ...INVITES.project.value[0], can_accept: false }]) });
  assert.deepEqual([partial.failed, partial.rows[0].canAccept], [['Company invitations'], false]);
  assert.match(answerCopy(rows[1], 'accept').body, /does not become your active company/);
  assert.equal(answerCopy(rows[0], 'decline').button, 'Decline');
});

test('funds by the firm that runs them, then a fund with no firm; engagements with what each shares', () => {
  const cards = companyCards(SUMMARY, { activeUid: 'c7', known: KNOWN });
  const groups = fundGroups(FUNDS, cards);
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((f) => [f.name, f.line, f.canManage])]), [
    ['Harbor Ledger', [['Fund I', '2024 · Fundraising', true]]], ['A fund with no firm', [['Angel SPV', '2025 · Active', false]]],
  ]);
  assert.deepEqual(engagementRows(GRANTS).map((r) => [r.name, r.shares, r.since, r.until]), [['Clinic App', ['Project', 'Data room'], '2 Sep 2026', '30 Jan 2027']]);
  assert.deepEqual(tabCount({ status: 'loading' }, null), { kind: 'load' });
  assert.equal(tabCount({ status: 'error' }, null).kind, 'dash');
  assert.deepEqual(tabCount({ status: 'ready' }, 3), { kind: 'num', value: '3' });
});

// ---------------------------------------------------------------- mounted

test('mounted founder (CMP1): the tabs at their addresses, two cards from the summary read, the active one this device\'s', async () => {
  const v = await mount('founder');
  try {
    assert.equal(v.prop('companies-tab-projects', 'href'), '/account/portfolio/projects');
    assert.equal(v.prop('companies-tab-invitations', 'href'), '/account/portfolio/invitations');
    assert.ok(!v.has('companies-tab-funds') && !v.has('companies-tab-engagements'));
    assert.match(v.of('companies-tabs'), /Companies2.*Projects3.*Invitations/s);
    assert.equal(v.count('company-card'), 2);
    assert.equal(v.count('company-active'), 1);
    assert.match(v.of('companies-active-note'), /every page reads on this device/);
    assert.ok(v.has('portfolio-new'), 'D1413 (PF1m): New ▾');
    const members = v.seen.filter((s) => s === 'GET /api/projects');
    assert.deepEqual(members, [], 'the every-project read was made');
    assert.ok(v.reads().includes('GET /api/account/companies') && v.reads().includes('GET /api/account/projects'));
    assert.ok(!v.reads().includes('GET /api/company/memberships'), 'the summary read is the companies read');
  } finally { await v.close(); }
});

test('mounted founder: Projects grouped (CMP3) and Invitations answered in a dialog (CMP5)', async () => {
  let v = await mount('founder', { url: '/account/portfolio/projects' });
  try {
    assert.equal(v.count('project-group'), 3);
    await v.change('projects-search', 'orbit');
    assert.equal(v.count('project-row'), 1);
  } finally { await v.close(); }
  v = await mount('founder', { url: '/account/portfolio/invitations' });
  try {
    assert.match(v.of('invitations-to-you'), /Saltmarsh Energy · as Co-founder.*From Ben Sample.*Juniper Grid · as Member.*expires 4 Nov/s);
    assert.ok(!v.has('invitation-decline-c-ci1'), 'a company invitation offered a decline no route records');
    assert.match(v.of('invitations-sent'), /Harbor Ledger · 2 pending/);
    await v.click('invitation-accept-c-ci1');
    assert.match(v.of('invitation-dialog'), /Join Juniper Grid\?/);
    assert.deepEqual(v.writes(), [], 'a write left before the dialog was confirmed');
    await v.click('invitation-dialog-confirm');
    assert.deepEqual(v.writes(), ['POST /api/company/invitations/ci1/accept']);
    assert.match(v.of('companies-done'), /You joined Juniper Grid/);
    await v.click('invitation-decline-p-41');
    await v.click('invitation-dialog-confirm');
    assert.equal(v.writes()[1], 'POST /api/projects/invitations/41/decline');
  } finally { await v.close(); }
});

test('mounted: a refused answer is said in the dialog in words, and nothing is claimed', async () => {
  const v = await mount('founder', { url: '/account/portfolio/invitations', handle: worker({
    'POST /api/projects/invitations/41/accept': () => response({ error: 'already_answered', message: 'This invitation was already answered.' }, 409),
  }) });
  try {
    await v.click('invitation-accept-p-41');
    await v.click('invitation-dialog-confirm');
    assert.match(v.of('invitation-dialog-refusal'), /answered a moment ago/);
    assert.ok(!v.has('companies-done'));
  } finally { await v.close(); }
});

test('mounted investor (CMP9): Funds, not Projects; each firm\'s funds on its card; no every-project read', async () => {
  let v = await mount('investor');
  try {
    assert.ok(v.has('companies-tab-funds') && !v.has('companies-tab-projects'));
    assert.match(v.of('companies-tabs'), /Funds2/);
    // D1413 (#3696, PF1): the card names the funds its firm runs; Manage is on the Funds tab.
    assert.match(v.of('company-extra'), /Funds: Fund I/);
    // D1413: Portfolio nests your own projects for every profile (`GET /api/account/projects`), never every venture.
    assert.ok(!v.reads().includes('GET /api/projects'));
    assert.match(v.of('portfolio-investor-link'), /Also in your investor Portfolio ›/, 'owner Q1: each Portfolio links to the other');
  } finally { await v.close(); }
  v = await mount('investor', { url: '/account/portfolio/funds' });
  try {
    assert.equal(v.count('fund-group'), 2);
  } finally { await v.close(); }
});

test('mounted Operating Partner (CMP10) and advisor (CMP11): the firm\'s counts, and the founders\' grants', async () => {
  let v = await mount('partner');
  try {
    assert.match(v.of('company-extra'), /3 engagements.*0 quotes.*offers: could not be read/s);
  } finally { await v.close(); }
  v = await mount('advisor', { url: '/account/portfolio/engagements' });
  try {
    assert.match(v.of('engagements-note'), /not yet separated by company/);
    assert.match(v.of('engagements'), /Clinic App.*since 2 Sep 2026 · until 30 Jan 2027.*Project.*Data room.*Open brief/s);
    assert.ok(!v.has('companies-tab-projects'));
  } finally { await v.close(); }
});

test('mounted Explorer (CMP12): no New company, Companies and Invitations only, and why', async () => {
  const v = await mount('exploring', { handle: worker({ 'GET /api/account/companies': () => response({ companies: [] }) }), active: null, known: [] });
  try {
    assert.ok(!v.has('companies-new'), 'an Explorer was offered New company');
    assert.ok(!v.has('companies-none-new'), 'an Explorer\'s empty state offered New company');
    assert.ok(!v.has('companies-tab-projects'));
    assert.match(v.of('companies-explorer-note'), /opens once your profile is set/);
    assert.match(v.of('companies-tabs'), /Invitations2/);
  } finally { await v.close(); }
});

test('mounted admin and Super Admin (CMP13): the reach line; HQ belongs to none', async () => {
  let v = await mount('admin');
  try {
    assert.match(v.of('companies-admin-note'), /reach comes from its licence/);
    assert.equal(v.count('company-card'), 2);
  } finally { await v.close(); }
  v = await mount('admin', { user: { id: 1, role: 'admin', is_super_admin: 1 }, handle: worker({ 'GET /api/account/companies': () => response({ companies: [] }) }), known: [], active: null });
  try {
    assert.match(v.of('companies-none'), /You belong to no company\..*HQ work does not need one/s);
  } finally { await v.close(); }
});

test('states (CMP14–CMP16): empty offers New company; a failed summary is Unreadable and the tab a dash, the rest still reads', async () => {
  let v = await mount('founder', { handle: worker({ 'GET /api/account/companies': () => response({ companies: [] }) }), known: [], active: null });
  try {
    assert.match(v.of('companies-none'), /don’t belong to a company yet/);
    assert.ok(v.has('companies-none-new'));
  } finally { await v.close(); }
  v = await mount('founder', { handle: worker({ 'GET /api/account/companies': () => response({ error: 'companies_unreadable' }, 503) }) });
  try {
    assert.match(v.of('companies-unreadable'), /could not be read\. That is not the same as having none/);
    assert.ok(!v.has('companies-none'));
    assert.match(v.of('companies-tab-companies'), /Companies—/);
    assert.match(v.of('companies-tabs'), /Invitations2/, 'one failed read blanked another tab');
  } finally { await v.close(); }
  v = await mount('founder', { url: '/account/portfolio/invitations', handle: worker({ 'GET /api/account/invitations': () => response({ error: 'x' }, 503) }) });
  try { assert.match(v.of('invitations-unreadable'), /Invitations to you could not be read/); } finally { await v.close(); }
  v = await mount('founder', { handle: () => new Promise(() => {}) });
  try {
    assert.ok(v.has('portfolio-loading'), 'D1413 (PF7b)');
    assert.match(v.of('companies-tabs'), /Companies.*Projects.*Invitations/s);
  } finally { await v.close(); }
});

test('mounted New company: the dialog says what happens, then one create', async () => {
  const v = await mount('founder', { handle: worker({ 'POST /api/company/create': () => response({ id: 9, uid: 'c9', company_name: 'Newco' }) }) });
  try {
    await v.click('portfolio-new');
    await v.click('portfolio-new-company');
    assert.match(v.of('new-company-sheet'), /primary admin.*active company on this device/s);
    assert.equal(v.prop('new-company-confirm', 'disabled'), true, 'an empty name could be created');
    await v.change('new-company-name', '  Newco  ');
    await v.click('new-company-confirm');
    assert.deepEqual(v.writes(), ['POST /api/company/create']);
    assert.match(v.of('companies-done'), /Newco is created and active on this device/);
  } finally { await v.close(); }
});

test('the routes, the guard, and no browser pop-up', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/account/portfolio/:tab" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />`));
  const dir = 'frontend/src/pages/account/companies/';
  const src = ['CompaniesProjects.jsx', 'CompaniesDialogs.jsx', 'companiesModel.js'].map((f) => read(dir + f)).join('\n');
  assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(|\balert\(/);
  assert.doesNotMatch(src, /listProjects\(/, 'the every-project read');
});
