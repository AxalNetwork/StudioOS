/**
 * D4819 part 11 (#5922) — a licence's Access section, Licences v2 board L11:
 *
 *   - administrators are listed with their account state (active,
 *     deactivated, no longer an admin, not recorded);
 *   - licensed seats are listed by profile; In use is Not recorded on every
 *     row, in operator words, with no figure made up and no internal id;
 *   - Add administrator and Remove… say what they will do before the reason
 *     is asked for, in the labelled reason dialog;
 *   - an action a terminated (or otherwise incompatible) licence cannot take
 *     is not offered, and the card says why;
 *   - None, Not recorded and Unreadable are three different treatments.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_access_d5922.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { Detail } from '../src/pages/admin/licences/LicenceDetail.jsx';
import {
  NONE, NOT_RECORDED, SEAT_USE_REASON, UNREADABLE,
  accountState, addAdminOffer, adminRoleWord, adminsState, detachLine,
  seatChangeOffer, seatRows,
} from '../src/pages/admin/licenceAccessModel.js';
import { LICENCE_REASONS } from '../src/pages/admin/licenceReasonModel.js';
import { licenceConsequence } from '../src/pages/admin/licenceConsequenceModel.js';

const h = React.createElement;

const LICENCE = {
  uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', legal_entity_name: 'Axal VC France SAS', kind: 'subsidiary',
  status: 'active', territories: ['FR'], seats: { founder: 25, investor: 10, advisor: 0 }, seats_licensed: 35, annual_fee_cents: 10000000, currency: 'EUR',
  starts_on: '2026-03-02', renews_on: '2099-03-01', terms_revision: 4, deployment: null, deployment_available: true,
  domain: null, domain_available: true, sync: null, blockers: [], events: [],
};
const ADMINS = {
  items: [
    { user_id: 11, name: 'C. Martin', email: 'c@example.test', admin_role: 'principal', role: 'admin', is_active: 1 },
    { user_id: 12, name: 'L. Bernard', email: 'l@example.test', admin_role: 'delegate', role: 'admin', is_active: 0 },
    { user_id: 13, name: null, email: 'p@example.test', admin_role: 'delegate', role: 'exploring', is_active: 1 },
  ],
};

// ── the model ───────────────────────────────────────────────────────────────

test('account state comes from the role and the active flag; a missing one is Not recorded', () => {
  assert.deepEqual(accountState({ role: 'admin', is_active: 1 }), { key: 'active', word: 'Active', isAdmin: true });
  assert.equal(accountState({ role: 'Admin', is_active: 0 }).key, 'deactivated');
  assert.equal(accountState({ role: 'admin', is_active: 0 }).isAdmin, true);
  const demoted = accountState({ role: 'exploring', is_active: 1 });
  assert.equal(demoted.key, 'demoted');
  assert.equal(demoted.word, 'No longer an admin');
  assert.equal(demoted.isAdmin, false);
  assert.deepEqual(accountState({ role: null, is_active: 1 }), { key: 'not_recorded', word: NOT_RECORDED, isAdmin: false });
  assert.equal(accountState({ role: 'admin' }).key, 'not_recorded');
  assert.equal(accountState({ role: 'admin' }).isAdmin, true, 'an admin whose active flag is unrecorded can still be removed');
  assert.equal(adminRoleWord('principal'), 'Principal');
  assert.equal(adminRoleWord('delegate'), 'Delegate');
  assert.equal(adminRoleWord(null), NOT_RECORDED);
});

test('None, Not recorded and Unreadable are three different answers', () => {
  assert.equal(adminsState(undefined).state, 'reading');
  assert.deepEqual(adminsState(null), { state: 'unreadable', word: UNREADABLE });
  assert.deepEqual(adminsState([]), { state: 'none', word: NONE });
  assert.deepEqual(adminsState([{}, {}]), { state: 'listed', word: '2 administrators' });
  assert.equal(new Set([NONE, NOT_RECORDED, UNREADABLE]).size, 3);
  // Seats: a recorded 0 is 0; a profile with no row is Not recorded; a payload without a seat map is Unreadable.
  const rows = seatRows(LICENCE);
  assert.deepEqual(rows.map((r) => [r.key, r.licensed, r.licensedState]),
    [['founder', '25', 'value'], ['investor', '10', 'value'], ['advisor', '0', 'value'], ['partner', NOT_RECORDED, 'not_recorded']]);
  for (const r of rows) assert.equal(r.inUse, NOT_RECORDED, `${r.key} in use is never a figure`);
  assert.deepEqual(seatRows({ ...LICENCE, seats: undefined }).map((r) => r.licensedState), ['unreadable', 'unreadable', 'unreadable', 'unreadable']);
  assert.equal(seatRows({ ...LICENCE, seats: {} })[0].licensed, NOT_RECORDED);
});

test('utilisation is said in operator words, with no internal identifier', () => {
  assert.match(SEAT_USE_REASON, /cannot reliably attribute account usage to individual licences/);
  assert.doesNotMatch(SEAT_USE_REASON, /\bU\d+\b/);
});

test('Add administrator is offered on every status the Worker appoints on, and not on a terminated one', () => {
  for (const s of ['draft', 'pending_activation', 'active', 'suspended']) assert.equal(addAdminOffer({ status: s }).offered, true, s);
  const ended = addAdminOffer({ status: 'terminated' });
  assert.equal(ended.offered, false);
  assert.match(ended.why, /terminated licence cannot take an administrator/);
  assert.equal(addAdminOffer({ status: 'archived' }).offered, false, 'a status the Worker does not appoint on is not offered');
  assert.equal(seatChangeOffer({ status: 'active' }).offered, true);
  assert.equal(seatChangeOffer({ status: 'terminated' }).offered, false);
});

test('add and remove state their consequence before the reason, at the Worker\'s ten characters', () => {
  // D4819 part 21 (#5928): add and remove now go through the one consequence sheet (licenceConsequenceModel.js).
  const text = (sheet) => [...sheet.happens, ...sheet.affects].map((r) => `${r.text}. ${r.note || ''}`).join(' ') + ` ${sheet.undo.text}`;
  const add = licenceConsequence('addAdmin', LICENCE, { target: { email: ' new@example.test ', adminRole: 'delegate' } });
  assert.equal(add.reason.min, 10);
  assert.match(text(add), /^new@example\.test becomes a delegate administrator of AXL-FR-001/);
  assert.match(text(add), /admin role and bound to this licence in one step/);
  assert.match(text(add), /remove the administrator, then detach/);
  assert.doesNotMatch(text(add), /suspended/);
  assert.match(text(licenceConsequence('addAdmin', { ...LICENCE, status: 'suspended' }, { target: { email: 'x@y', adminRole: 'principal' } })), /This licence is suspended/);
  assert.equal(licenceConsequence('addAdmin', LICENCE, { target: { email: 'x', adminRole: 'principal', initial: 'From a request.' } }).reason.initial, 'From a request.');
  const remove = licenceConsequence('removeAdmin', LICENCE, { target: ADMINS.items[0] });
  assert.equal(remove.reason.min, LICENCE_REASONS.demoteAdmin.min);
  assert.match(text(remove), /^C\. Martin loses the admin role now\. They can no longer administer AXL-FR-001/);
  assert.match(text(remove), /stays bound to this licence until you detach it/);
  assert.match(detachLine(LICENCE), /^Detach unbinds this account from AXL-FR-001/);
});

// ── the Access section, mounted ─────────────────────────────────────────────

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

function worker({ licence = LICENCE, admins = ADMINS, failAdmins = false } = {}) {
  const calls = [];
  const handle = (url, options = {}) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    const method = options.method || 'GET';
    calls.push([method, p, options.body]);
    if (p === '/admin/licences/lic_fr') return response(licence);
    if (p === '/admin/licences/lic_fr/admins' && method === 'GET') return failAdmins ? response({ error: 'down' }, 500) : response(admins);
    if (p === '/admin/licences/lic_fr/admins' && method === 'POST') return response({ ok: true });
    if (p.startsWith('/admin/users/') && method === 'POST') return response({ ok: true });
    if (p === '/admin/licences/lic_fr/requests') return response({ available: true, total: 0, items: [], branch_readable: true });
    if (p === '/admin/licences/lic_fr/fee-invoices') return response({ invoices: [] });
    return response({ error: 'not_found' }, 404);
  };
  return { handle, calls };
}

async function mount(handle, startTab = 'admins') {
  const restore = installDocument();
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  const container = document.createElement('div'); document.body.appendChild(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  document.getElementById = () => null;
  const tabs = [];
  function Host() {
    const [tab, setTab] = useState(startTab);
    return h(Detail, { uid: 'lic_fr', held: new Map(), tab, onTab: (t) => { tabs.push(t); setTab(t); } });
  }
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, null, h(Host))));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const within = (id, inner) => walk(byId(id)).find((n) => props(n)['data-testid'] === inner);
  return {
    tabs, props, byId, all, nodes, within,
    text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    async click(n) { const p = props(typeof n === 'string' ? byId(n) : n); assert.ok(p.onClick, 'nothing to click'); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async clickNoFlush(n) { const p = props(typeof n === 'string' ? byId(n) : n); act(() => { p.onClick({ preventDefault() {} }); }); await flush(); },
    async change(n, value) { await act(async () => { props(typeof n === 'string' ? byId(n) : n).onChange({ target: { value } }); }); },
    flush,
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('L11 mounted: administrators with account state beside licensed seats by profile, In use Not recorded, no U1', async () => {
  const v = await mount(worker().handle);
  try {
    assert.equal(v.has('licence-requests-panel'), false, 'the side panel steps aside for the section\'s two cards');
    assert.match(v.textOf('licence-admins-count'), /3 administrators/);
    const states = ['licence-admin-11', 'licence-admin-12', 'licence-admin-13']
      .map((id) => v.props(v.within(id, 'licence-admin-account'))['data-state']);
    assert.deepEqual(states, ['active', 'deactivated', 'demoted']);
    assert.match(v.textOf('licence-admin-11'), /C\. Martin.*c@example\.test.*Principal.*Active/);
    assert.match(v.textOf('licence-admin-13'), /p@example\.test.*Delegate.*No longer an admin/);
    // Seats by profile, the ledger's count, never a usage figure.
    assert.match(v.textOf('licence-seat-founder'), /Founder.*25.*Not recorded/);
    assert.match(v.textOf('licence-seat-advisor'), /Advisor.*0.*Not recorded/);
    assert.match(v.textOf('licence-seat-partner'), /Service partner.*Not recorded.*Not recorded/);
    assert.match(v.textOf('licence-seats-foot'), /cannot reliably attribute account usage/);
    assert.doesNotMatch(v.text(), /\bU1\b/, 'no internal identifier reaches the screen');
    await v.click('licence-seats-change');
    assert.deepEqual(v.tabs, ['seats'], 'Change seats opens the Seats tab');
  } finally { await v.close(); }
});

test('Remove… and Detach are offered only where they can work', async () => {
  const v = await mount(worker().handle);
  try {
    assert.ok(Boolean(v.within('licence-admin-11', 'licence-admin-remove')), 'an admin can be removed');
    assert.ok(Boolean(v.within('licence-admin-12', 'licence-admin-remove')), 'a deactivated admin still holds the role, so it can be removed');
    assert.equal(Boolean(v.within('licence-admin-11', 'licence-admin-detach')), false, 'Detach is not offered while the role is held');
    assert.equal(Boolean(v.within('licence-admin-13', 'licence-admin-remove')), false, 'a demoted account is not removed again');
    assert.ok(Boolean(v.within('licence-admin-13', 'licence-admin-detach')), 'a demoted account can be detached');
    assert.match(v.textOf('licence-admin-detach-line'), /Detach unbinds this account from AXL-FR-001/);
  } finally { await v.close(); }
});

test('Remove… says what it will do before the reason, then sends the demote with that reason', async () => {
  const w = worker();
  const v = await mount(w.handle);
  try {
    await v.clickNoFlush(v.within('licence-admin-11', 'licence-admin-remove'));
    assert.ok(v.has('licence-consequence-sheet'), 'the one consequence sheet opens (D4819 part 21)');
    assert.match(v.textOf('licence-consequence-happens'), /C\. Martin loses the admin role now/);
    await v.change('licence-consequence-field', 'Left the French studio in October.');
    await v.click('licence-consequence-confirm');
    const call = w.calls.find(([m, p]) => m === 'POST' && p === '/admin/users/11/demote-admin');
    assert.ok(call, 'the demote is the existing write');
    assert.equal(JSON.parse(call[2]).reason, 'Left the French studio in October.');
  } finally { await v.close(); }
});

test('Add administrator opens the form, states the consequence, and appoints with the reason', async () => {
  const w = worker();
  const v = await mount(w.handle);
  try {
    assert.equal(v.has('licence-admin-form'), false);
    await v.click('licence-admin-add');
    await v.change('licence-admin-email', 'new@example.test');
    await v.clickNoFlush('licence-admin-continue');
    assert.match(v.textOf('licence-consequence-happens'), /new@example\.test becomes a principal administrator of AXL-FR-001/);
    await v.change('licence-consequence-field', 'Runs the French studio from January.');
    await v.click('licence-consequence-confirm');
    const call = w.calls.find(([m, p]) => m === 'POST' && p === '/admin/licences/lic_fr/admins');
    assert.ok(call, 'the appointment is the existing write');
    assert.deepEqual(JSON.parse(call[2]), { email: 'new@example.test', admin_role: 'principal', reason: 'Runs the French studio from January.' });
  } finally { await v.close(); }
});

test('a terminated licence offers neither Add administrator nor Change seats, and says why', async () => {
  const v = await mount(worker({ licence: { ...LICENCE, status: 'terminated' } }).handle);
  try {
    assert.equal(v.has('licence-admin-add'), false);
    assert.match(v.textOf('licence-admin-add-why'), /terminated licence cannot take an administrator/);
    assert.equal(v.has('licence-seats-change'), false);
    assert.match(v.textOf('licence-seats-change-why'), /not changed on a terminated licence/);
  } finally { await v.close(); }
  // The Seats tab itself offers no editor there.
  const s = await mount(worker({ licence: { ...LICENCE, status: 'terminated' } }).handle, 'seats');
  try {
    assert.ok(s.has('licence-seat-editor-closed'));
    assert.equal(s.nodes().some((n) => n.tagName?.toLowerCase() === 'input'), false, 'no seat input on a terminated licence');
  } finally { await s.close(); }
});

test('the three absences render differently: None, Unreadable with Retry, and Not recorded', async () => {
  const none = await mount(worker({ admins: { items: [] } }).handle);
  try {
    assert.equal(none.props(none.byId('licence-admins-none'))['data-absence'], 'none');
    assert.match(none.textOf('licence-admins-none'), /None\. No administrator is named/);
    assert.equal(none.has('licence-admins-unreadable'), false);
    const partnerCells = none.nodes().filter((n) => none.props(n)['data-absence'] === 'not-recorded');
    assert.ok(partnerCells.length >= 5, 'Not recorded is its own treatment, on the seat cells');
  } finally { await none.close(); }
  const w = worker({ failAdmins: true });
  const down = await mount(w.handle);
  try {
    assert.equal(down.has('licence-admins-none'), false, 'a failed read is never None');
    assert.match(down.textOf('licence-admins-unreadable'), /could not be read\. This is not the same as having none/);
    const before = w.calls.filter(([m, p]) => m === 'GET' && p.endsWith('/admins')).length;
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const retry = walk(down.byId('licence-admins-unreadable')).find((n) => n.tagName?.toLowerCase() === 'button');
    assert.ok(Boolean(retry), 'Unreadable offers Retry');
    await down.click(retry);
    assert.ok(w.calls.filter(([m, p]) => m === 'GET' && p.endsWith('/admins')).length > before, 'Retry reads the administrators again');
  } finally { await down.close(); }
});

test('a reason written elsewhere (a delegate request\'s) arrives in the sheet, still editable', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { LicenceConsequenceSheet } = await import('../src/pages/admin/LicenceConsequenceSheet.jsx');
  const sheet = licenceConsequence('addAdmin', LICENCE, { target: { email: 'd@example.test', adminRole: 'delegate', initial: 'Delegate requested by the Administrator.' } });
  const html = renderToStaticMarkup(h(LicenceConsequenceSheet, { sheet, onDone: () => {} }));
  assert.match(html, /<textarea[^>]*>Delegate requested by the Administrator\.<\/textarea>/);
  assert.match(html, /d@example\.test becomes a delegate administrator/);
});
