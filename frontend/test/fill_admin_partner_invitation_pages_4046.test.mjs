// #4046 Group B4 — Ask on New invitation's message to the invitee, the pages half.
//   - the model: `SCOPED_FORMS.partnerInvitation` is FILL_FIELDS' one field on
//     partner_invitations; the email, name, what to offer and the terms are said
//     never to be filled;
//   - NewInvitationDialog, mounted against a stubbed fetch: the read names no
//     record and no parent (the Worker names the caller); the message draws a
//     trigger, its label naming its textarea; Ask sends only the message's value,
//     never the invitee's email or name; Accept places the words; Send posts
//     them, then records the placed proposal against the id the 201 names,
//     before the result replaces the form;
//   - with nothing placed, Send records nothing; the hook is off once the
//     result shows.
//
// Booleans, not nodes: a failing assert on a DOM node prints the whole fake tree and never ends.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_admin_partner_invitation_pages_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { NOT_FILLED_HERE, SCOPED_FORMS } from '../src/lib/fillScoped.js';
import { fieldsOf } from '../src/lib/fillFields.js';
import NewInvitationDialog from '../src/pages/admin/partners/NewInvitationDialog.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const PI = SCOPED_FORMS.partnerInvitation;
const ADMIN = { id: 902, role: 'admin', is_super_admin: 0, name: 'Studio admin', email: 'admin@example.com' };

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SHEET = {
  page: PI.page, form: PI.form, project: null, scope: 'owner:902', record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null }],
  fields: [{ field: 'personal_message', label: 'Message to the invitee', table: 'partner_invitations', column: 'personal_message', class: 'composition', sources: ['eadwyn'],
    value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [] }],
  quote: { option: `form:${PI.form}`, state: 'ok', runs: 0, average_microusd: null },
};

/** `routes`: `METHOD /path` → handler(call); the dialog's own reads answer empty. */
async function mounted(routes) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const state = { created: null };
  globalThis.fetch = async (u, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = String(u).split('?');
    const call = { url: String(u), path, method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    if (path === '/api/auth/me') return response(ADMIN);
    const key = Object.keys(routes).find((k) => k === `${method} ${path}`);
    if (key) return routes[key](call, state);
    if (path.startsWith('/api/admin/partners/offers/preview')) return response({ types: [], unknown: [], not_offered: [], offers: [], source: 'worker' });
    if (path.startsWith('/api/admin/partners/invitations/lookup')) return response({ open_invitation: null, member: null });
    if (method === 'GET') return response({});
    throw new Error(`unrouted ${method} ${path}`);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(ADMIN));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/partner-invitations'] },
    h(AuthProvider, null, h(NewInvitationDialog, { reads: { reload() {} }, onClose() {} })))));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  state.has = (id) => !!byId(id);
  return {
    calls, flush, state,
    has: (id) => !!byId(id),
    value: (id) => props(byId(id)).value,
    textOf: (id) => text(byId(id)),
    labelFor: (forId) => walk(container).some((n) => n.tagName?.toLowerCase?.() === 'label' && props(n).htmlFor === forId),
    idOf: (id) => props(byId(id)).id,
    async press(id) { const p = props(byId(id)); assert.equal(typeof p.onClick, 'function', `no ${id} to press`); assert.equal(!!p.disabled, false, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    sheets: () => calls.filter((c) => c.path === '/api/fills/sheet'),
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      localStorage.removeItem?.('user');
      restore();
    },
  };
}

test('the model: the message to the invitee on partner_invitations; the email, name, what to offer and the terms are never filled', () => {
  assert.deepEqual(PI, { page: 'Admin · Community · Partner invitations', form: 'partner-invitation', table: 'partner_invitations' });
  assert.deepEqual(fieldsOf(PI.page, PI.form).map((f) => [f.field, f.label, f.table, f.class]),
    [['personal_message', 'Message to the invitee', 'partner_invitations', 'composition']]);
  assert.equal(NOT_FILLED_HERE['partner-invitation'][0], 'Email, name, what to offer and terms · they are yours to set.');
});

test('New invitation: the read names no record and no parent; the message draws Ask, its label naming its textarea; typing clears it', async () => {
  // Mutation checked: the FillLabel wrapper dropped from the message → no field trigger; htmlFor dropped → labelFor is false.
  const w = await mounted({ 'GET /api/fills/sheet': () => response(SHEET) });
  try {
    const sheets = w.sheets();
    assert.equal(sheets.length, 1);
    assert.match(sheets[0].url, /form=partner-invitation/);
    assert.doesNotMatch(sheets[0].url, /record=|parent=|project=/, 'a new invitation hangs under the caller, named by the Worker');
    assert.equal(w.has('fill-trigger-personal_message'), true);
    assert.equal(w.has('fill-form-trigger'), true, 'the form\'s Ask');
    assert.match(w.textOf('fill-scoped-not-here'), /Email, name, what to offer and terms/);
    assert.equal(w.idOf('partners-new-message'), 'partners-new-message');
    assert.equal(w.labelFor('partners-new-message'), true, 'the label names its textarea');
    await w.change('partners-new-message', { value: 'Typed by me' });
    assert.equal(w.has('fill-trigger-personal_message'), false, 'a typed message draws no trigger');
    assert.equal(w.has('fill-form-trigger'), false);
  } finally { await w.close(); }
});

test('Ask → Accept → Send: the run reads only the message; the invitation is sent with the words, then recorded on the id the 201 names', async () => {
  // Mutations checked: `fill.afterSave` dropped from send() → no record call; `email: typed` added to the hook's
  // values → the run carries the invitee's email. (afterSave moved after setCreated is caught by the wiring test.)
  const sse = `event: done\ndata: ${JSON.stringify({ proposals: [{ uid: 'p-1', field: 'personal_message', value: 'We would like you on our partner bench.' }], dropped: [], charged_microusd: 1200 })}\n\n`;
  let resultShownAtRecord = null;
  const w = await mounted({
    'GET /api/fills/sheet': () => response(SHEET),
    'POST /api/ai/rail/run': () => ({ ok: true, status: 200, headers: new Map(), text: async () => sse, json: async () => ({}) }),
    'POST /api/admin/partners/invitations': () => response({ id: 31, token: 't', link: 'https://app.example.test/partners/onboard?token=t', email_sent: true, allowed_deal_types: ['equity_partnership'], terms: 'standard' }, 201),
    'POST /api/fills/record': (_c, s) => { resultShownAtRecord = s.has('partners-new-result'); return response({ record: 'partner_invitations:31', outcomes: [] }); },
  });
  try {
    await w.change('partners-new-email', { value: 'partner@example.com' });
    await w.change('partners-new-name', { value: 'Pat Partner' });
    await w.press('fill-form-trigger');
    await w.press('fill-sheet-preview');
    const run = w.calls.find((c) => c.path === '/api/ai/rail/run');
    assert.equal(!!run, true, 'the run was asked');
    assert.deepEqual([run.body.option, run.body.page, run.body.record ?? null, run.body.parent ?? null, run.body.project ?? null],
      [`form:${PI.form}`, PI.page, null, null, null], 'the run names no venture, record or parent');
    assert.doesNotMatch(JSON.stringify(run.body), /partner@example\.com|Pat Partner/, 'the invitee\'s email and name never reach the run');
    await w.press('fill-sheet-accept-all');
    assert.equal(w.value('partners-new-message'), 'We would like you on our partner bench.');
    assert.equal(w.calls.some((c) => c.path === '/api/fills/record'), false, 'nothing is recorded before Send');
    await w.change('partners-new-type-equity_partnership-box', {});
    await w.press('partners-new-send');
    const sent = w.calls.find((c) => c.method === 'POST' && c.path === '/api/admin/partners/invitations');
    assert.equal(sent.body.personal_message, 'We would like you on our partner bench.');
    const rec = w.calls.find((c) => c.path === '/api/fills/record');
    assert.equal(!!rec, true, 'Send records the placed proposal');
    assert.deepEqual(rec.body, { page: PI.page, form: PI.form, record: 31, proposals: ['p-1'] });
    assert.equal(resultShownAtRecord, false, 'recorded before the result replaces the form');
    assert.equal(w.has('partners-new-result'), true);
    const reads = w.sheets().length;
    await w.flush();
    assert.equal(w.sheets().length, reads, 'the hook is off once the result shows: no read of a new invitation');
  } finally { await w.close(); }
});

test('Send with nothing placed records nothing', async () => {
  const w = await mounted({
    'GET /api/fills/sheet': () => response(SHEET),
    'POST /api/admin/partners/invitations': () => response({ id: 32, link: 'https://app.example.test/x', email_sent: true }, 201),
  });
  try {
    await w.change('partners-new-email', { value: 'partner@example.com' });
    await w.change('partners-new-message', { value: 'My own words.' });
    await w.change('partners-new-type-equity_partnership-box', {});
    await w.press('partners-new-send');
    assert.equal(w.calls.find((c) => c.path === '/api/admin/partners/invitations' && c.method === 'POST').body.personal_message, 'My own words.');
    assert.equal(w.calls.some((c) => c.path === '/api/fills/record'), false);
    assert.equal(w.has('partners-new-result'), true);
  } finally { await w.close(); }
});

test('the wiring: the record step sits between the 201 and the result; the hook is off once created', () => {
  const dialog = read('pages/admin/partners/NewInvitationDialog.jsx');
  assert.match(dialog, /scope: SCOPED_FORMS\.partnerInvitation, enabled: !created,\n\s+values: \{ personal_message: message \},/);
  assert.match(dialog, /await fill\.afterSave\(reply\?\.id\);\n\s+setCreated\(\{ reply, email: typed \}\);/);
  assert.match(dialog, /<FillLabel fill=\{fill\} name="personal_message" label="Message to the invitee" value=\{message\}>/);
  assert.doesNotMatch(dialog, /name="(recipient_email|recipient_name|allowed_deal_types|terms)/, 'nothing else draws Ask');
});
