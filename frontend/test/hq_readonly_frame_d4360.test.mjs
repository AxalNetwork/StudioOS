/**
 * D4360 (#4360) — the HQ read-only frame on Portfolio (PF7's admin frame) and
 * Incorporate (INC5g), now that #3713's access pill is built.
 *
 * What this file holds the pages to (#4360's "Done when"):
 *   · an admin or HQ viewing a member's company or project sees the pill
 *     ("Read only · HQ access" or "· Studio admin access") and no live write;
 *   · a member sees neither;
 *   · HQ reading an order on Incorporate sees the pill, the timeline and no
 *     "Pay and submit", Add EIN or bank step;
 *   · no reason gate: Portfolio and Incorporate are not D1463's gated records.
 * Every person here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_readonly_frame_d4360.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CompanyPage from '../src/pages/account/companies/CompanyPage.jsx';
import ProjectPage from '../src/pages/account/companies/ProjectPage.jsx';
import IncorporateHqRead, { HQ_READ_LINE, ORDER_NOT_FOUND } from '../src/pages/incorporate/IncorporateHqRead.jsx';
import { ADMIN_LINE, READ_ONLY_LINE, accessViewer, hqReadOnly } from '../src/pages/account/companies/companiesModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const ME = 7;

const COMPANY = (members) => ({ uid: 'co_1', company_name: 'Northwind Labs', archived_at: null, members });
const LEGAL = { path: '/northwind', locations: [], legal_name: 'Northwind Labs Inc.' };
const DOCS = { can_upload: true, documents: [] };
const PROJECT = { id: 42, name: 'Orbit Notes', company_id: null, stage: 'build', sector: 'SaaS' };

function worker({ members = [], projectMembers = { members: [], my_role: null, can_manage: true }, orders = null } = {}) {
  return (url) => {
    const [path] = url.split('?');
    if (path === '/api/company/co_1') return response(COMPANY(members));
    if (path === '/api/company/co_1/legal') return response(LEGAL);
    if (path === '/api/company/co_1/documents') return response(DOCS);
    if (path === '/api/projects/42') return response(PROJECT);
    if (path === '/api/projects/42/members') return response(projectMembers);
    if (path === '/api/admin/incorporations') return orders ? (typeof orders === 'function' ? orders() : response(orders)) : never();
    return never();
  };
}

async function mounted(el, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET') }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, null, el)));
  await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    requests, text: () => text(container),
    has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)),
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; restore(); },
  };
}

const companyPage = (profile) => h(CompanyPage, { uid: 'co_1', meId: ME, profile, active: false, row: null, switchTo() {}, leave() {}, onChanged() {}, onNew() {} });

test('the rule: an admin or HQ with no seat reads read only; a seat, or a member profile, writes as before', () => {
  assert.equal(hqReadOnly('hq', false), true);
  assert.equal(hqReadOnly('admin', false), true);
  assert.equal(hqReadOnly('admin', true), false, 'an admin with a seat is a member there');
  for (const p of ['founder', 'investor', 'advisor', 'partner', 'explorer']) assert.equal(hqReadOnly(p, false), false, p);
  assert.equal(accessViewer('hq'), 'super_admin');
  assert.equal(accessViewer('admin'), 'admin');
  assert.equal(accessViewer('founder'), null);
});

test('HQ reading a member\'s company: the HQ pill and the read-only line, and no write at all', async () => {
  const view = await mounted(companyPage('hq'), worker({ members: [{ user_id: 99, role_in_company: 'owner', is_primary_admin: 1, name: 'Fay Founder' }] }));
  try {
    assert.equal(view.textOf('company-access-pill'), 'Read only · HQ access');
    assert.equal(view.textOf('company-read-only'), `${READ_ONLY_LINE} ${ADMIN_LINE}`);
    for (const id of ['company-page-settings', 'company-page-new-project', 'company-add-project', 'company-documents-upload', 'company-legal-edit', 'company-actions'])
      assert.ok(!view.has(id), `${id} is a write and is not drawn`);
    assert.ok(!view.has('reason-gate'), 'no reason gate: the company page is not a gated record');
  } finally { await view.close(); }
});

test('a studio admin reads "Studio admin access"; an admin with a seat in the company writes as a member', async () => {
  const studio = await mounted(companyPage('admin'), worker({ members: [{ user_id: 99, role_in_company: 'owner', is_primary_admin: 1 }] }));
  try {
    assert.equal(studio.textOf('company-access-pill'), 'Read only · Studio admin access');
  } finally { await studio.close(); }
  const seated = await mounted(companyPage('admin'), worker({ members: [{ user_id: ME, role_in_company: 'owner', is_primary_admin: 1 }] }));
  try {
    assert.ok(!seated.has('company-access-pill'));
    assert.ok(seated.has('company-page-settings') && seated.has('company-documents-upload') && seated.has('company-actions'));
  } finally { await seated.close(); }
});

test('a member sees neither the pill nor the line, and keeps every write', async () => {
  const view = await mounted(companyPage('founder'), worker({ members: [{ user_id: ME, role_in_company: 'owner', is_primary_admin: 1 }] }));
  try {
    assert.ok(!view.has('company-access-pill') && !view.has('company-read-only'));
    for (const id of ['company-page-settings', 'company-page-new-project', 'company-add-project', 'company-documents-upload', 'company-legal-edit', 'company-actions']) assert.ok(view.has(id), id);
  } finally { await view.close(); }
});

test('HQ reading a member\'s project: the pill and the line, no settings, Edit, Make it a company or move', async () => {
  const view = await mounted(h(ProjectPage, { id: 42, profile: 'hq' }), worker({ projectMembers: { members: [{ user_id: 99, name: 'Fay Founder', role: 'owner' }], my_role: null, can_manage: true } }));
  try {
    assert.equal(view.textOf('project-access-pill'), 'Read only · HQ access');
    assert.equal(view.textOf('project-read-only'), `${READ_ONLY_LINE} ${ADMIN_LINE}`);
    for (const id of ['project-page-settings', 'project-edit', 'project-make-company', 'project-move-under']) assert.ok(!view.has(id), id);
  } finally { await view.close(); }
  const owner = await mounted(h(ProjectPage, { id: 42, profile: 'founder' }), worker({ projectMembers: { members: [], my_role: 'owner', can_manage: true } }));
  try {
    assert.ok(!owner.has('project-access-pill') && !owner.has('project-read-only'));
    for (const id of ['project-page-settings', 'project-edit', 'project-make-company', 'project-move-under']) assert.ok(owner.has(id), id);
  } finally { await owner.close(); }
});

test('INC5g: HQ reads one order read only — the pill, the timeline, the line, and no Pay, EIN or bank write', async () => {
  const order = { id: 31, project_id: 42, project_name: 'Orbit Notes', company_name: 'Orbit Notes Inc.', status: 'filed', paid_at: '2026-10-30 10:00:00', packet_document_id: 5, filed_on: '2026-11-02' };
  const view = await mounted(h(IncorporateHqRead, { orderId: '31', viewer: 'super_admin' }), (url) => {
    if (url.startsWith('/api/admin/incorporations')) return response({ orders: [order] });
    if (/\/api\/company-ein\/42/.test(url)) return response({ recorded: false, can_edit: true });
    return never();
  });
  try {
    assert.equal(view.textOf('incorporate-access-pill'), 'Read only · HQ access');
    assert.ok(view.has('incorporation-timeline'));
    assert.equal(view.textOf('timeline-filed').includes('Filed'), true);
    assert.equal(view.textOf('incorporate-hq-line'), `${HQ_READ_LINE} ${ADMIN_LINE}`);
    assert.ok(!view.has('timeline-ein-add'), 'the EIN is not added from HQ\'s read');
    assert.ok(!/Pay and submit/.test(view.text().replace(HQ_READ_LINE, '')), 'no Pay and submit');
    assert.ok(!view.has('bank-step') && !/Open a bank account|Connect Mercury/.test(view.text()), 'no bank step');
    assert.ok(view.requests.every((r) => r.method === 'GET'), 'HQ\'s read writes nothing');
  } finally { await view.close(); }
  const missing = await mounted(h(IncorporateHqRead, { orderId: '99', viewer: 'admin' }), () => response({ orders: [order] }));
  try {
    assert.equal(missing.textOf('incorporate-hq-missing'), ORDER_NOT_FOUND);
    assert.equal(missing.textOf('incorporate-access-pill'), 'Read only · Studio admin access');
  } finally { await missing.close(); }
  const down = await mounted(h(IncorporateHqRead, { orderId: '31', viewer: 'super_admin' }), () => response({ error: 'down' }, 503));
  try {
    assert.match(down.textOf('incorporate-hq-unread'), /could not be read.*Try again/);
  } finally { await down.close(); }
});

test('the wiring: an admin with ?order reads HQ\'s view; a member never does; Lab › Formation opens it', () => {
  const flow = read('pages/incorporate/IncorporateFlow.jsx');
  assert.match(flow, /if \(orderId && \/\^\\d\{1,12\}\$\/\.test\(orderId\) && user\?\.role === 'admin'\) \{\n\s+return <IncorporateHqRead orderId=\{orderId\} viewer=\{isSuperAdminUser\(user\) \? 'super_admin' : 'admin'\} \/>;/);
  assert.match(flow, /return <MemberIncorporateFlow embedded=\{embedded\} \/>;/);
  assert.match(read('pages/admin/lab/LabFormation.jsx'), /to=\{`\/incorporate\?order=\$\{encodeURIComponent\(r\.id\)\}`\}/);
  assert.match(read('pages/account/companies/CompaniesProjects.jsx'), /paths=\{paths\} profile=\{profile\} \/>/, 'the project page is told who is looking');
  for (const f of ['pages/account/companies/CompanyPage.jsx', 'pages/account/companies/ProjectPage.jsx', 'pages/incorporate/IncorporateHqRead.jsx']) {
    assert.doesNotMatch(read(f), /import ReasonGate|<ReasonGate/, `${f}: no second gate`);
  }
});
