// D1134 (#2422) — Account › Companies and projects: the section and its
// address, the companies from the switcher's own read, a founder's ventures
// grouped by company, and what waits.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/companies_projects_d1134.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CompaniesProjects from '../src/pages/account/companies/CompaniesProjects.jsx';
import { TABS, WAITS, companyCards, cyclesLine, projectGroups } from '../src/pages/account/companies/companiesModel.js';
import { PATH_TO_SECTION, accountIndexGroups } from '../src/pages/account/accountPhone.js';
import { setActiveCompanyId } from '../src/lib/api.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// `routes/company.ts` GET /company/memberships.
const MEMBERSHIPS = [
  { id: 7, uid: 'c7', company_name: 'Harbor Ledger', stage: 'seed', my_role: 'Admin', is_primary_admin: true, member_count: 3, cycles_active: ['validate', 'build'], last_opened: '2026-10-03T10:00:00Z' },
  { id: 8, uid: 'c8', company_name: 'Bluefern Labs', stage: '', my_role: 'Member', is_primary_admin: false, member_count: 1, cycles_active: null, last_opened: null },
];
// `routes/projects.ts` GET /projects, a founder's own.
const PROJECTS = [
  { id: 1, name: 'Ledger app', stage: 'mvp', playbook_week: 'week_2', company_id: 7 },
  { id: 2, name: 'Clinic CSV', stage: 'idea', playbook_week: null, company_id: null },
  { id: 3, name: 'Trashed one', stage: 'idea', company_id: 7, deleted_at: '2026-10-20' },
];

function handler(url) {
  if (url.includes('/company/memberships')) return response(MEMBERSHIPS);
  if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
  return response({});
}

async function mounted(role, { phone = false, handle = handler } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/account/companies'] }, h(CompaniesProjects, { role }))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const ids = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  return {
    requests, flush, text: () => text(container), testIds: ids,
    count: (id) => ids().filter((x) => x === id).length,
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async click(id) { const n = nodes().find((x) => props(x)['data-testid'] === id); await act(async () => props(n).onClick?.()); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('the section is second in Account, at /account/companies, with its phone index row', () => {
  const page = read('frontend/src/pages/SettingsPage.jsx');
  const block = page.slice(page.indexOf('const SECTIONS = ['), page.indexOf('];', page.indexOf('const SECTIONS = [')));
  const labels = [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 2), ['Profile and identity', 'Companies and projects']);
  assert.ok(page.includes("{safeActive === 'companies' && <CompaniesProjects role={role} />}"));
  assert.equal(PATH_TO_SECTION.companies, 'companies');
  const rows = accountIndexGroups({ role: 'founder' })[0].rows.map((r) => [r.title, r.to]);
  assert.deepEqual(rows.slice(0, 2), [['Profile and identity', '/account/profile'], ['Companies and projects', '/account/companies']]);
});

test('companies: the switcher\'s read, the active one is "on this device", and an unread cycle list is never "none"', () => {
  const [a, b] = companyCards(MEMBERSHIPS, 7);
  assert.deepEqual([a.name, a.role, a.primary, a.members, a.cycles, a.lastOpened, a.active], ['Harbor Ledger', 'Admin', true, 3, 'Validate, Build', '3 Oct 2026', true]);
  assert.deepEqual([b.active, b.stage, b.cycles, b.lastOpened], [false, null, 'Cycles: could not be read', null]);
  assert.equal(cyclesLine([]), 'No cycle in use');
  assert.equal(companyCards([{ id: 1, company_name: '  ' }])[0].name, 'Not recorded');
  assert.deepEqual(TABS.map((t) => t.id), ['companies', 'projects', 'invitations']);
});

test('a founder\'s ventures by company, then "Not in a company"; a trashed venture is left out', () => {
  const groups = projectGroups(PROJECTS, MEMBERSHIPS);
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.name)]), [['Harbor Ledger', ['Ledger app']], ['Not in a company', ['Clinic CSV']]]);
  assert.equal(groups[0].rows[0].stage, 'MVP');
});

test('mounted: companies draw from the memberships read, with the active mark; Settings edits the active one only', async () => {
  setActiveCompanyId(7);
  const v = await mounted('founder');
  try {
    assert.ok(v.requests.some((u) => u.includes('/company/memberships')));
    assert.equal(v.count('company-card'), 2);
    assert.equal(v.count('company-active'), 1);
    assert.ok(v.text().includes(WAITS.manage.slice(0, 40)));
  } finally { await v.close(); setActiveCompanyId(null); }
});

test('mounted: a founder\'s Projects tab reads their ventures; an investor\'s never calls the every-project read', async () => {
  const f = await mounted('founder');
  try {
    await f.click('companies-tab-projects');
    assert.ok(f.requests.some((u) => /\/api\/projects(\?|$)/.test(u)));
    assert.equal(f.count('project-group'), 2);
    assert.equal(f.count('project-row'), 2);
  } finally { await f.close(); }
  const i = await mounted('investor');
  try {
    await i.click('companies-tab-projects');
    assert.ok(i.testIds().includes('projects-wait'));
    assert.ok(!i.requests.some((u) => /\/api\/projects(\?|$)/.test(u)), 'GET /api/projects answers every project to an investor');
  } finally { await i.close(); }
  const x = await mounted('founder');
  try {
    await x.click('companies-tab-invitations');
    assert.ok(x.testIds().includes('invitations-wait'));
  } finally { await x.close(); }
});

test('a failed read says so, and is never "you belong to none"', async () => {
  const v = await mounted('founder', { handle: (u) => (u.includes('/company/memberships') ? response({ detail: 'boom' }, 500) : handler(u)) });
  try {
    assert.ok(v.testIds().includes('companies-unreadable'));
    assert.ok(!v.testIds().includes('companies-none'));
  } finally { await v.close(); }
});

test('the source writes nothing, and the canvas and decision are in', () => {
  const src = read('frontend/src/pages/account/companies/CompaniesProjects.jsx');
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/);
  assert.doesNotMatch(src, /createCompany|updateCompany|removeCompanyMember|deleteProject|setActiveCompanyId/, 'the integration writes nothing');
  for (const f of ['Companies Projects Page.dc.html', 'Companies and projects · Boards.dc.html']) {
    const s = read(`design/incoming/${f}`);
    assert.ok(s.includes('<script src="./support.js"></script>'), f);
  }
  assert.ok(read('design/incoming/Companies and projects · Boards.dc.html').includes('dc-import name="Companies Projects Page"'));
  assert.ok(read('design/incoming/Companies and projects · Boards.dc.html').includes('CMP19'));
  assert.ok(existsSync('documentation/architecture/decisions/D1134.md'));
});
