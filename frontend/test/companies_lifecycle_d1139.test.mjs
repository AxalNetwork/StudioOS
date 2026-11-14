// D1139 (#3019, part 5 of #2422) — Account › Companies and projects: the
// company lightbox at `/account/portfolio/<uid>` (CMP2), the venture lightbox
// (CMP4, CMP4b) and the lifecycle dialogs (CMP6–CMP8). Each dialog says what
// it changes before it changes it; Leave is refused for the only primary
// admin with the reason; a Lab-locked venture shows the Worker's reason.
// Mounted on a stubbed fetch; props are read off `__reactProps$`. Every name
// and figure is made up.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/companies_lifecycle_d1139.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CompaniesProjects from '../src/pages/account/companies/CompaniesProjects.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import {
  LIFECYCLE, TRASH_DAYS, companiesTabFor, companyPathFor, companyPowers, companyUidFor, isLastPrimaryAdmin, nameClash,
  projectGroups, trashUntil, ventureTeam,
} from '../src/pages/account/companies/companiesModel.js';
import { accountPathFor, accountViewFor } from '../src/pages/account/accountPhone.js';

const h = React.createElement;
const ok = (value) => ({ available: true, value });
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ME = 2;
const SUMMARY = { companies: [
  { uid: 'c7', company_name: 'Harbor Ledger', stage: 'seed', my_role: 'owner', is_primary_admin: true,
    member_count: ok(2), cycles_active: ok(['validate']), last_opened: ok('2026-10-03T10:00:00Z'), pending_invitations: ok(1), counts: { projects: ok(1) } },
  { uid: 'c8', company_name: 'Bluefern Labs', stage: null, my_role: 'member', is_primary_admin: false,
    member_count: ok(3), cycles_active: ok([]), last_opened: ok(null), counts: { projects: ok(0) } },
] };
const KNOWN = [{ id: 7, uid: 'c7', company_name: 'Harbor Ledger' }, { id: 8, uid: 'c8', company_name: 'Bluefern Labs' }];
const PROJECTS = { projects: [
  { id: 1, uid: 'p1', name: 'Ledger app', my_seat: 'owner', company_id: 7, company_uid: 'c7', company_name: 'Harbor Ledger', stage: 'mvp', playbook_week: 'week_2', member_count: ok(2), cycles_active: ok(['validate']) },
  { id: 2, uid: 'p2', name: 'Field kit', my_seat: 'owner', company_id: null, company_uid: null, company_name: null, stage: 'idea', playbook_week: null, member_count: ok(1), cycles_active: ok([]) },
  { id: 3, uid: 'p3', name: 'Orbit Freight', my_seat: 'cofounder', company_id: 99, company_uid: 'c99', company_name: 'Orbit Co', stage: 'mvp', playbook_week: null, member_count: ok(2), cycles_active: ok([]) },
] };
// `company.ts` detailDto: c7 has me as its only primary admin; c8 has me as a member.
const C7 = { uid: 'c7', company_name: 'Harbor Ledger', stage: 'seed', website: 'harbor.example', created_at: '2026-01-12 09:00:00', archived_at: null, members: [
  { user_id: ME, name: 'Sam Example', role_in_company: 'Owner', is_primary_admin: true, title: null, authority: 'VOTE', joined_at: '2026-01-12 09:00:00' },
  { user_id: 5, name: 'Ana Example', role_in_company: 'Admin', is_primary_admin: false, title: 'Associate', authority: 'FLAG', joined_at: '2026-02-01 09:00:00' },
] };
const C8 = { uid: 'c8', company_name: 'Bluefern Labs', stage: null, website: null, created_at: null, archived_at: null, members: [
  { user_id: ME, name: 'Sam Example', role_in_company: 'Member', is_primary_admin: false },
  { user_id: 6, name: 'Lee Sample', role_in_company: 'Owner', is_primary_admin: true },
] };
const C7_INVITES = { invitations: [
  { uid: 'i1', email: 'kim@example.test', role_in_company: 'Member', status: 'pending', email_sent: false, created_at: '2026-10-20 10:00:00', expires_at: '2026-11-03 10:00:00' },
  { uid: 'i2', email: 'old@example.test', role_in_company: 'Member', status: 'accepted', email_sent: true, created_at: '2026-09-01 10:00:00', expires_at: '2026-09-15 10:00:00' },
] };
// `projects.ts` GET /projects/:id/members: the owner's view of p1, Lab-locked.
const P1_TEAM = { members: [
  { id: 1, user_id: ME, role: 'owner', source: 'owner_seed', accepted_at: '2026-03-01 09:00:00', name: 'Sam Example' },
  { id: 2, user_id: 9, role: 'cofounder', source: 'invitation', accepted_at: '2026-04-01 09:00:00', name: 'Ira Sample' },
], invitations: [{ id: 31, role: 'advisor', invitee_email: 'adv@example.test', created_at: '2026-10-01 10:00:00' }],
can_manage: true, my_role: 'owner', locked: true, unlock_week: 4,
gate_reason: 'Co-founder and advisor invites unlock in Week 4 of the Spin-Out Lab. Keep going — you\'re in Week 2.' };
const P3_TEAM = { members: [
  { id: 5, user_id: 11, role: 'owner', name: 'Orla Owner' },
  { id: 6, user_id: ME, role: 'cofounder', source: 'invitation', accepted_at: '2026-05-01 09:00:00', name: 'Sam Example' },
], invitations: [], can_manage: false, my_role: 'cofounder', locked: false, unlock_week: 4 };

function worker(over = {}) {
  return (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'http://x').pathname;
    const key = `${method} ${path}`;
    if (over[key]) return over[key](init);
    if (path === '/api/account/companies') return response(SUMMARY);
    if (path === '/api/account/projects') return response(PROJECTS);
    if (path === '/api/account/invitations') return response({ company: ok([]), project: ok([]) });
    if (path === '/api/company/memberships') return response(KNOWN);
    if (key === 'GET /api/company/c7') return response(C7);
    if (key === 'GET /api/company/c8') return response(C8);
    if (key === 'GET /api/company/c7/invitations') return response(C7_INVITES);
    if (key === 'GET /api/company/team-vocabulary') return response({ ladder: [{ title: 'Analyst' }, { title: 'Associate' }], functions: [{ name: 'Operating Partner' }] });
    if (key === 'GET /api/projects/1/members') return response(P1_TEAM);
    if (key === 'GET /api/projects/3/members') return response(P3_TEAM);
    if (key === 'POST /api/company/c7/leave') return response({ code: 'last_primary_admin', detail: 'Assign another primary admin before leaving this company.' }, 409);
    if (method !== 'GET') return response({ ok: true });
    return response({});
  };
}

function Where() { const l = useLocation(); return h('i', { 'data-testid': 'where', 'data-path': l.pathname }); }

async function mount(role, { url = '/account/portfolio', handle = worker(), known = KNOWN, active = { id: 7, uid: 'c7' } } = {}) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: ME, role, name: 'Sam Example' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    seen.push({ call: `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`, body: init.body ? JSON.parse(init.body) : null });
    return handle(String(u), init);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const switched = [];
  const ctx = { company: active, setCompany: (c) => switched.push(c), companies: known, setCompanies: () => {} };
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] },
    h(AuthProvider, null, h(ActiveCompanyContext.Provider, { value: ctx },
      h(Routes, null, h(Route, { path: '/account/portfolio/:tab?', element: h(React.Fragment, null, h(Where), h(CompaniesProjects, { role })) })))))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const all = (id) => walk(document.body).filter((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    switched,
    // A refusal is reported to `/api/client-error`; that is the log, not a change.
    writes: () => seen.filter((s) => !s.call.startsWith('GET ') && s.call !== 'POST /api/client-error'),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), count: (id) => all(id).length, prop: (id, k) => props(byId(id))?.[k],
    path: () => props(byId('where'))['data-path'],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v, checked: v } }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('a company uid is its own address, kept by the canonicalising path; a tab is never read as a uid', () => {
  assert.equal(companyUidFor('/account/portfolio/c7'), 'c7');
  assert.equal(companyUidFor('/account/portfolio/c7/'), 'c7');
  for (const tab of ['projects', 'funds', 'engagements', 'invitations', 'Projects']) assert.equal(companyUidFor(`/account/portfolio/${tab}`), null, tab);
  assert.equal(companyUidFor('/account/portfolio'), null);
  assert.equal(companyUidFor('/account/portfolio/a/b'), null);
  assert.equal(companyPathFor('c7'), '/account/portfolio/c7');
  assert.equal(accountViewFor({ pathname: '/account/portfolio/c7' }), 'companies');
  assert.equal(companiesTabFor('/account/portfolio/c7'), 'companies', 'the lightbox opens over Companies');
  assert.equal(accountPathFor({ section: 'companies', companiesTab: 'companies', companyUid: 'c7' }), '/account/portfolio/c7');
  assert.equal(accountPathFor({ section: 'companies', companiesTab: 'projects' }), '/account/portfolio/projects');
});

test('each lifecycle dialog says what it changes, and the destructive ones are marked', () => {
  const said = (c) => `${c.title} ${c.body.join(' ')} ${c.foot || ''}`;
  assert.match(said(LIFECYCLE.rename('Harbor Ledger')), /Everyone in Harbor Ledger sees the new name/);
  assert.match(said(LIFECYCLE.makeActive('Bluefern Labs')), /show Bluefern Labs’s work on this device\. Nothing else changes/);
  assert.match(said(LIFECYCLE.invite('Harbor Ledger')), /link that works for 14 days.*join only when they accept/);
  assert.match(said(LIFECYCLE.transferAdmin('Harbor Ledger', 'Ana Example')), /Ana Example takes over members and the lifecycle actions\. This is recorded/);
  assert.match(said(LIFECYCLE.archive('Harbor Ledger')), /leaves the switcher for every member.*ventures, deals and files are kept.*Deleting a company is not self-serve/s);
  assert.match(said(LIFECYCLE.leave('Harbor Ledger')), /lose access to its workspaces.*must invite you back/);
  assert.match(said(LIFECYCLE.leaveRefused('Harbor Ledger')), /You are the only primary admin of Harbor Ledger\. Transfer it first/);
  assert.match(said(LIFECYCLE.move('Field kit', true)), /shows only under that company\. Today it shows under every company/);
  assert.doesNotMatch(said(LIFECYCLE.move('Ledger app', false)), /Today it shows under every company/);
  assert.match(said(LIFECYCLE.transferVenture('Ledger app', 'Ira Sample')), /Ira Sample becomes the owner\. You stay on as Co-founder\. Only a founder account can own a venture/);
  assert.match(said(LIFECYCLE.leaveVenture('Orbit Freight', 'Co-founder')), /You lose your Co-founder seat\. The owner can invite you again/);
  assert.match(said(LIFECYCLE.trash('Ledger app', '25 Nov 2026')), /hidden at once and deleted for good after 30 days.*until 25 Nov 2026/);
  assert.deepEqual(['archive', 'leave', 'leaveVenture', 'trash'].map((k) => LIFECYCLE[k]('X', 'Y').danger), [true, true, true, true]);
  assert.deepEqual([LIFECYCLE.leave('X').cancel, LIFECYCLE.leaveRefused('X').cancel, LIFECYCLE.leaveRefused('X').button], ['Stay', 'Back', 'Transfer primary admin']);
  assert.equal(TRASH_DAYS, 30);
  assert.equal(trashUntil(new Date('2026-10-26T12:00:00Z')), '25 Nov 2026');
});

test('who may do what in a company is the Worker\'s rule; the Lab lock is the Worker\'s sentence', () => {
  const mine = companyPowers(C7, ME);
  assert.deepEqual([mine.primary, mine.editor, mine.onlyPrimary, mine.others.map((m) => m.user_id)], [true, true, true, [5]]);
  const shared = companyPowers({ members: [...C7.members.slice(0, 1), { ...C7.members[1], is_primary_admin: true }] }, ME);
  assert.equal(shared.onlyPrimary, false, 'two primary admins: either may leave');
  const member = companyPowers(C8, ME);
  assert.deepEqual([member.primary, member.editor, member.member], [false, false, true]);
  assert.equal(companyPowers({ members: [{ user_id: ME, role_in_company: 'Founder' }] }, ME).editor, true);
  assert.equal(ventureTeam(P1_TEAM, ME).lock, P1_TEAM.gate_reason);
  assert.equal(ventureTeam({ ...P1_TEAM, locked: false }, ME).lock, null);
  assert.deepEqual(ventureTeam(P1_TEAM, ME).cofounders.map((m) => m.name), ['Ira Sample']);
  assert.equal(isLastPrimaryAdmin({ code: 'last_primary_admin' }), true);
  assert.equal(isLastPrimaryAdmin({ code: 'other' }), false);
  assert.equal(nameClash('  harbor LEDGER ', SUMMARY.companies), 'Harbor Ledger');
  assert.equal(nameClash('Harbor Ledger Two', SUMMARY.companies), null);
  assert.equal(projectGroups(PROJECTS, SUMMARY.companies)[0].rows[0].companyUid, 'c7');
});

// ---------------------------------------------------------------- CMP2

test('mounted CMP2, a page since D1413: /account/portfolio/<uid> is the company page (owner Q3), with the lightbox\'s acts and people by name', async () => {
  const v = await mount('founder', { url: '/account/portfolio/c7' });
  try {
    assert.ok(v.has('company-page'), 'D1413 (#3696, PF2): the company page replaced the lightbox');
    assert.ok(!v.has('company-lightbox'), 'the D1139 lightbox is gone');
    assert.equal(v.prop('company-back', 'href'), '/account/portfolio');
    assert.match(v.of('company-page-name'), /Harbor Ledger/);
    assert.match(v.of('company-team'), /Sam Example · you.*Primary admin.*Ana Example.*Admin/s);
    assert.doesNotMatch(v.of('company-page'), /kim@example\.test/, 'people appear by name, never by email');
    assert.match(v.of('company-page-projects'), /Ledger app/);
    for (const id of ['company-rename', 'company-invite', 'company-transfer', 'company-archive', 'company-leave', 'company-open-studio']) assert.ok(v.has(id), id);
    assert.ok(!v.has('company-make-active'), 'it is already active');
  } finally { await v.close(); }
});

test('mounted CMP2 as a plain member: Make active and Leave only; no invitations read', async () => {
  const v = await mount('founder', { url: '/account/portfolio/c8' });
  try {
    assert.ok(v.has('company-make-active') && v.has('company-leave'));
    for (const id of ['company-rename', 'company-invite', 'company-transfer', 'company-archive']) assert.ok(!v.has(id), id);
    await v.click('company-make-active');
    assert.match(v.of('make-active-dialog-says'), /show Bluefern Labs’s work on this device\. Nothing else changes/);
    assert.deepEqual(v.switched, [], 'nothing switched before the confirm');
    await v.click('make-active-dialog-confirm');
    assert.deepEqual(v.switched.map((c) => c.uid), ['c8']);
    assert.match(v.of('companies-done'), /Bluefern Labs is your active company on this device/);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- CMP7

test('Leave is refused for the only primary admin, with the reason, before anything is sent; Transfer primary admin opens from it', async () => {
  const v = await mount('founder', { url: '/account/portfolio/c7' });
  try {
    await v.click('company-leave');
    assert.ok(!v.has('leave-dialog'));
    assert.match(v.of('leave-refused-dialog-says'), /You are the only primary admin of Harbor Ledger\. Transfer it first/);
    assert.deepEqual(v.writes(), [], 'no leave was attempted');
    await v.click('leave-refused-dialog-confirm');
    assert.ok(v.has('transfer-admin-dialog'));
    assert.ok(!v.has('transfer-admin-dialog-confirm') || v.prop('transfer-admin-dialog-confirm', 'disabled'), 'nobody picked yet');
    await v.change('transfer-admin-people-5', true);
    assert.match(v.of('transfer-admin-dialog-says'), /Ana Example takes over members and the lifecycle actions/);
    assert.match(v.of('transfer-admin-after'), /no longer a primary admin/);
    await v.change('transfer-admin-keep', true);
    assert.match(v.of('transfer-admin-after'), /You both stay primary admins/);
    await v.click('transfer-admin-dialog-confirm');
    assert.deepEqual(v.writes(), [{ call: 'POST /api/company/c7/transfer', body: { user_id: 5, demote: false } }]);
    assert.match(v.of('companies-done'), /Ana Example is now a primary admin of Harbor Ledger/);
  } finally { await v.close(); }
});

test('when the page cannot tell, the Worker\'s last_primary_admin refusal turns Leave into the refusal with its reason', async () => {
  // The read shows a second primary admin; the Worker knows better.
  const two = { ...C7, members: [C7.members[0], { ...C7.members[1], is_primary_admin: true }] };
  const v = await mount('founder', { url: '/account/portfolio/c7', handle: worker({ 'GET /api/company/c7': () => response(two) }) });
  try {
    await v.click('company-leave');
    assert.match(v.of('leave-dialog-says'), /lose access to its workspaces/);
    await v.click('leave-dialog-confirm');
    assert.deepEqual(v.writes().map((w) => w.call), ['POST /api/company/c7/leave']);
    assert.ok(!v.has('leave-dialog'));
    assert.match(v.of('leave-refused-dialog-says'), /only primary admin of Harbor Ledger/);
  } finally { await v.close(); }
});

test('Archive says what happens and what is kept, then posts; a member\'s Leave posts and closes', async () => {
  let v = await mount('founder', { url: '/account/portfolio/c7' });
  try {
    await v.click('company-archive');
    assert.match(v.of('archive-dialog'), /leaves the switcher for every member.*kept.*Deleting a company is not self-serve/s);
    await v.click('archive-dialog-cancel');
    assert.deepEqual(v.writes(), [], 'Cancel changes nothing');
    await v.click('company-archive');
    await v.click('archive-dialog-confirm');
    assert.deepEqual(v.writes().map((w) => w.call), ['POST /api/company/c7/archive']);
    assert.match(v.of('companies-done'), /Harbor Ledger is archived/);
  } finally { await v.close(); }
  v = await mount('founder', { url: '/account/portfolio/c8' });
  try {
    await v.click('company-leave');
    await v.click('leave-dialog-confirm');
    assert.deepEqual(v.writes().map((w) => w.call), ['POST /api/company/c8/leave']);
    assert.ok(!v.has('company-page'), 'leaving returns to Portfolio');
    assert.equal(v.path(), '/account/portfolio');
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- CMP6

test('Rename sends the new name; Invite sends its fields and, when the email does not send, hands over the link', async () => {
  const v = await mount('founder', {
    url: '/account/portfolio/c7',
    handle: worker({ 'POST /api/company/c7/invitations': () => response({ ok: true, email_sent: false, accept_path: '/company/invitations/accept?token=t0k' }) }),
  });
  try {
    await v.click('company-rename');
    assert.match(v.of('rename-dialog-says'), /Everyone in Harbor Ledger sees the new name/);
    assert.ok(v.prop('rename-dialog-confirm', 'disabled'), 'the same name changes nothing');
    await v.change('rename-name', 'Harbor Ledger Group');
    await v.click('rename-dialog-confirm');
    assert.deepEqual(v.writes(), [{ call: 'PATCH /api/company/c7', body: { company_name: 'Harbor Ledger Group' } }]);

    await v.click('company-invite');
    assert.match(v.of('invite-dialog-says'), /14 days/);
    assert.match(v.of('invite-title'), /Analyst.*Associate.*Operating Partner/s);
    await v.change('invite-email', 'new@example.test');
    await v.change('invite-role', 'Admin');
    await v.change('invite-title', 'Associate');
    await v.click('invite-authority-FLAG');
    await v.click('invite-dialog-confirm');
    assert.deepEqual(v.writes()[1], { call: 'POST /api/company/c7/invitations', body: { email: 'new@example.test', role_in_company: 'Admin', title: 'Associate', authority: 'FLAG' } });
    assert.match(v.of('invite-fallback'), /The email did not send\. Copy this link and send it yourself/);
    assert.match(v.prop('invite-fallback-link', 'value'), /\/company\/invitations\/accept\?token=t0k$/);
  } finally { await v.close(); }
});

test('New company says the clash under the field and sends nothing', async () => {
  const v = await mount('founder');
  try {
    // D1413 (#3696, PF1m, PF4a): "New ▾" opens Company or Project; Company is a Sheet.
    await v.click('portfolio-new');
    await v.click('portfolio-new-company');
    await v.change('new-company-name', 'harbor ledger');
    assert.match(v.of('new-company-clash'), /You already have a company called Harbor Ledger\./);
    assert.ok(v.prop('new-company-confirm', 'disabled'));
    await v.change('new-company-name', 'Saltmarsh');
    assert.ok(!v.has('new-company-clash'));
    assert.ok(!v.prop('new-company-confirm', 'disabled'));
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- CMP4, CMP8

test('mounted CMP4 as owner: a Lab-locked venture shows the Worker\'s reason in place of its invitations; Move, Transfer and Trash each say first', async () => {
  const v = await mount('founder', { url: '/account/portfolio/projects' });
  try {
    await v.click('project-open-1');
    assert.ok(v.has('venture-lightbox'));
    assert.equal(v.prop('venture-lightbox', 'role'), 'dialog', 'D1317: the venture is the shared Sheet');
    assert.ok(v.prop('venture-lightbox', 'aria-labelledby'));
    assert.equal(v.prop('venture-lightbox', 'data-width'), 720);
    assert.match(v.of('venture-facts'), /MVP.*Lab week 2 of 4.*Validate/s);
    assert.match(v.of('venture-lab-lock'), /Co-founder and advisor invites unlock in Week 4 of the Spin-Out Lab\. Keep going — you're in Week 2\./);
    assert.ok(!v.has('venture-invitation') && !v.has('venture-invite'), 'no invitations while locked');
    assert.match(v.of('venture-team'), /Sam Example · you.*Ira Sample.*Co-founder.*Only the owner can remove/s);
    assert.ok(v.has('venture-remove-9') && !v.has('venture-leave'));

    await v.click('venture-move');
    assert.match(v.of('move-dialog-says'), /It then shows only under that company\./);
    await v.change('move-companies-none', true);
    await v.click('move-dialog-confirm');
    assert.deepEqual(v.writes(), [{ call: 'POST /api/projects/1/move', body: { company_id: null } }]);
    assert.match(v.of('companies-done'), /Ledger app is now in no company/);

    await v.click('project-open-1');
    await v.click('venture-transfer');
    await v.change('transfer-venture-people-9', true);
    assert.match(v.of('transfer-venture-dialog-says'), /Ira Sample becomes the owner\. You stay on as Co-founder/);
    await v.click('transfer-venture-dialog-confirm');
    assert.deepEqual(v.writes()[1], { call: 'POST /api/projects/1/transfer', body: { user_id: 9 } });

    await v.click('venture-trash');
    assert.match(v.of('trash-dialog-says'), new RegExp(`deleted for good after 30 days.*until ${trashUntil()}`, 's'));
    await v.click('trash-dialog-confirm');
    assert.equal(v.writes()[2].call, 'DELETE /api/projects/1');
    assert.ok(!v.has('venture-lightbox'));
  } finally { await v.close(); }
});

test('CMP4b: past the lock, the invitations list with Revoke; a venture in no company moves into one', async () => {
  const open = { ...P1_TEAM, locked: false, gate_reason: null };
  const v = await mount('founder', { url: '/account/portfolio/projects', handle: worker({ 'GET /api/projects/2/members': () => response(open) }) });
  try {
    await v.click('project-open-2');
    assert.ok(!v.has('venture-lab-lock'));
    assert.match(v.of('venture-invitation'), /adv@example\.test · Advisor/);
    assert.ok(v.has('venture-invite'));
    await v.click('venture-revoke-31');
    await v.click('revoke-dialog-confirm');
    assert.equal(v.writes()[0].call, 'POST /api/projects/2/invitations/31/revoke');
    await v.click('venture-move');
    assert.match(v.of('move-dialog-says'), /Today it shows under every company/);
    await v.change('move-companies-8', true);
    await v.click('move-dialog-confirm');
    assert.deepEqual(v.writes()[1], { call: 'POST /api/projects/2/move', body: { company_id: 8 } });
  } finally { await v.close(); }
});

test('CMP4 as a co-founder: Leave venture only, saying the seat lost; no Move, Transfer, Trash or Remove', async () => {
  const v = await mount('founder', { url: '/account/portfolio/projects' });
  try {
    await v.click('project-open-3');
    for (const id of ['venture-move', 'venture-transfer', 'venture-trash', 'venture-remove-11', 'venture-invitations']) assert.ok(!v.has(id), id);
    await v.click('venture-leave');
    assert.match(v.of('leave-venture-dialog-says'), /You lose your Co-founder seat\. The owner can invite you again/);
    await v.click('leave-venture-dialog-confirm');
    assert.deepEqual(v.writes().map((w) => w.call), [`DELETE /api/projects/3/members/${ME}`]);
  } finally { await v.close(); }
});

test('a refused move is said inside its dialog, and the dialog stays', async () => {
  const v = await mount('founder', {
    url: '/account/portfolio/projects',
    handle: worker({ 'POST /api/projects/1/move': () => response({ detail: 'That company is archived. Restore it before you move a venture to it.', code: 'archived' }, 409) }),
  });
  try {
    await v.click('project-open-1');
    await v.click('venture-move');
    await v.change('move-companies-8', true);
    await v.click('move-dialog-confirm');
    assert.match(v.of('move-dialog-refusal'), /That company is archived\. Restore it before you move a venture to it\./);
    assert.ok(v.has('move-dialog'));
  } finally { await v.close(); }
});
