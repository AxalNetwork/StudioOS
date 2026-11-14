/**
 * D4819 part 4 (#5927) — Licences v2 board L17: one consequence sheet for a
 * licence's lifecycle actions, and the header's More menu.
 *
 *   - every sheet answers the four questions as headings;
 *   - terminate states territory release, administrator deprovisioning, the
 *     branch, the records kept and that it cannot be undone; suspend states
 *     that the licence still holds its countries;
 *   - a reason is required where the write records one, and a write that
 *     records none says so rather than asking;
 *   - More offers only the actions the licence's state allows;
 *   - the sheet traps focus, Escape closes it and returns focus to "⋯",
 *     Cancel writes nothing, and no browser prompt or confirm is used.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_consequence_sheet_d5927.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { Detail } from '../src/pages/admin/licences/LicenceDetail.jsx';
import { LicenceConsequenceSheet } from '../src/pages/admin/LicenceConsequenceSheet.jsx';
import { LIFECYCLE_ACTIONS, licenceConsequence, lifecycleActionsFor } from '../src/pages/admin/licenceConsequenceModel.js';
import { LICENCE_REASONS } from '../src/pages/admin/licenceReasonModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const h = React.createElement;

const LICENCE = {
  uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', legal_entity_name: 'Axal VC France SAS', kind: 'subsidiary',
  status: 'active', territories: ['FR'], seats: { founder: 25 }, seats_licensed: 25,
  annual_fee_cents: 10000000, currency: 'EUR', term_years: 3, starts_on: '2026-03-02', renews_on: '2099-03-01',
  terms_revision: 4, status_note: null, deployment: { hostname: 'fr.axal.vc', status: 'linked' }, deployment_available: true,
  domain: null, domain_available: true, sync: null, blockers: [], events: [],
};
const ADMINS = { items: [{ user_id: 1, name: 'C. Martin' }, { user_id: 2, name: 'L. Bernard' }, { user_id: 3, name: 'A. Roy' }] };
const INVOICES = { invoices: [{ uid: 'i1', status: 'issued', outstanding_cents: 9000000 }] };
const sheetText = (spec) => renderedText(renderToStaticMarkup(h(LicenceConsequenceSheet, { sheet: spec, onDone: () => {} })));

// ── the model ───────────────────────────────────────────────────────────────

test('More offers only what the licence state allows, mirroring the Worker state machine', () => {
  assert.deepEqual(lifecycleActionsFor({ status: 'draft', blockers: [] }), ['activate', 'renew', 'terminate']);
  assert.deepEqual(lifecycleActionsFor({ status: 'draft', blockers: ['No territory'] }), ['renew', 'terminate'], 'a blocked draft is not offered Activate');
  assert.deepEqual(lifecycleActionsFor({ status: 'pending_activation', blockers: [] }), ['activate', 'renew', 'terminate']);
  assert.deepEqual(lifecycleActionsFor({ status: 'active', blockers: [] }), ['renew', 'suspend', 'terminate']);
  assert.deepEqual(lifecycleActionsFor({ status: 'suspended', blockers: [] }), ['reinstate', 'renew', 'terminate']);
  assert.deepEqual(lifecycleActionsFor({ status: 'terminated' }), [], 'terminated is terminal');
  assert.deepEqual(lifecycleActionsFor({ status: 'something_new' }), [], 'an unknown state is offered nothing');
  // The same FROM table as services/licenceTransitions.ts.
  const worker = read('cloudflare-worker/src/services/licenceTransitions.ts');
  for (const [verb, from] of Object.entries({ activate: "['draft', 'pending_activation']", suspend: "['active']", reinstate: "['suspended']" })) {
    assert.ok(worker.includes(`${verb}: ${from}`), `${verb} starts from ${from} in the Worker`);
  }
});

test('every action has a sheet that answers the four questions, in order', () => {
  for (const action of LIFECYCLE_ACTIONS) {
    const spec = licenceConsequence(action, LICENCE, { admins: ADMINS, invoices: INVOICES });
    assert.ok(spec, action);
    const html = renderToStaticMarkup(h(LicenceConsequenceSheet, { sheet: spec, onDone: () => {} }));
    const heads = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1].replace(/<!-- -->/g, ''));
    assert.deepEqual(heads, ['1 · What will happen', '2 · What else it affects', '3 · Reason recorded', '4 · Can it be undone?'], action);
    assert.match(html, /role="dialog"/);
  }
  assert.equal(licenceConsequence('delete', LICENCE), null, 'no sheet for an action that does not exist');
});

test('terminate states release, deprovisioning, the branch, the records kept, and that it cannot be undone', () => {
  const spec = licenceConsequence('terminate', { ...LICENCE, territories: ['FR', 'BE'] }, { admins: ADMINS, invoices: INVOICES });
  const t = sheetText(spec);
  assert.match(t, /All 2 countries \(FR, BE\) are released for another licence/);
  assert.match(t, /Terminating releases every country this licence holds, permanently\./);
  assert.match(t, /Its administrators lose their access/);
  assert.match(t, /3 administrators Each is demoted, detached and deactivated; a Super Admin is skipped, with the reason\./);
  assert.match(t, /The branch is sent the terminated state, and its administrators are unbound there/);
  assert.match(t, /The branch at fr\.axal\.vc\./);
  assert.match(t, /Its agreements, fee invoices and history are kept/);
  assert.match(t, /1 open fee invoice stays open\./);
  assert.match(t, /This cannot be undone\./);
  assert.equal(spec.undo.reversible, false);
  assert.equal(spec.tone, 'danger');
  // Only terminate is destructive.
  for (const a of LIFECYCLE_ACTIONS.filter((x) => x !== 'terminate')) {
    assert.notEqual(licenceConsequence(a, LICENCE).tone, 'danger', a);
    assert.equal(licenceConsequence(a, LICENCE).undo.reversible, true, a);
  }
});

test('a read that failed or has not answered is said, never counted as none', () => {
  const failed = sheetText(licenceConsequence('terminate', LICENCE, { admins: false, invoices: false }));
  assert.match(failed, /How many administrators it has could not be read\./);
  assert.match(failed, /Its fee invoices could not be read\./);
  const reading = sheetText(licenceConsequence('terminate', LICENCE, {}));
  assert.match(reading, /Still reading how many administrators it has\./);
  assert.doesNotMatch(reading, /0 administrators/);
  const noBranch = sheetText(licenceConsequence('suspend', { ...LICENCE, deployment_available: false }, { admins: ADMINS }));
  assert.match(noBranch, /Which branch it deploys to could not be read\./);
});

test('suspend states that the licence still holds its countries, and how it is undone', () => {
  const t = sheetText(licenceConsequence('suspend', LICENCE, { admins: ADMINS }));
  assert.match(t, /It still holds FR/);
  assert.match(t, /A suspended licence still holds its countries, so no other licence can be issued over them\. Releasing them is a termination, not a suspension\./);
  assert.match(t, /Reinstate makes it active again/);
});

test('a reason is required where the write records one; elsewhere the sheet says none is recorded', () => {
  for (const a of ['suspend', 'terminate']) {
    const spec = licenceConsequence(a, LICENCE);
    assert.equal(spec.reason.min, 1, a);
    const html = renderToStaticMarkup(h(LicenceConsequenceSheet, { sheet: spec, onDone: () => {} }));
    assert.match(html, /<textarea/, a);
    assert.match(html, /data-testid="licence-consequence-confirm" disabled=""/, `${a} cannot be confirmed before a reason`);
  }
  for (const a of ['activate', 'reinstate', 'renew']) {
    const spec = licenceConsequence(a, LICENCE);
    assert.equal(spec.reason.min, null, a);
    const html = renderToStaticMarkup(h(LicenceConsequenceSheet, { sheet: spec, onDone: () => {} }));
    assert.doesNotMatch(html, /<textarea/, a);
    assert.match(renderedText(html), /No reason is recorded\./, a);
    assert.doesNotMatch(html, /data-testid="licence-consequence-confirm" disabled=""/, a);
  }
  // The Worker takes no note on these three, so none is sent.
  const worker = read('cloudflare-worker/src/routes/admin_licences_lifecycle.ts');
  assert.match(worker, /a suspension must record why/);
  assert.match(worker, /a termination must record why/);
  // The rule sentences left the reason dialog.
  assert.equal(LICENCE_REASONS.suspendLicence, undefined);
  assert.equal(LICENCE_REASONS.terminateLicence, undefined);
});

// ── mounted ─────────────────────────────────────────────────────────────────

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};

async function mount(licence = LICENCE) {
  const restore = installDocument('', { focus: true });
  const keydown = [];
  document.addEventListener = (type, fn) => { if (type === 'keydown') keydown.push(fn); };
  document.removeEventListener = (type, fn) => { const at = keydown.indexOf(fn); if (at >= 0) keydown.splice(at, 1); };
  document.querySelectorAll = () => [];
  // The fake DOM has no selectors; the sheet's focus handling needs two: its
  // focusable controls, and the modal dialogs inside it.
  const make = document.createElement.bind(document);
  const FOCUS_TAGS = ['BUTTON', 'TEXTAREA', 'INPUT', 'SELECT', 'A'];
  document.createElement = (tag) => {
    const n = make(tag);
    n.querySelectorAll = (sel) => walk(n).slice(1).filter((x) => (String(sel).includes('aria-modal')
      ? String(props(x)['aria-modal']) === 'true'
      : FOCUS_TAGS.includes(x.tagName) && !props(x).disabled && props(x).tabIndex !== -1));
    n.querySelector = (sel) => n.querySelectorAll(sel)[0] || null;
    return n;
  };
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, options = {}) => {
    const p = new URL(String(u), 'http://x').pathname.replace(/^\/api/, '');
    calls.push({ method: options.method || 'GET', path: p, body: options.body ? JSON.parse(options.body) : null });
    if (p === '/admin/licences/lic_fr' && (options.method || 'GET') === 'GET') return response(licence);
    if (p === '/admin/licences/lic_fr/admins') return response(ADMINS);
    if (p === '/admin/licences/lic_fr/fee-invoices') return response(INVOICES);
    if ((options.method || 'GET') === 'POST') return response({ ok: true });
    return response({ error: 'not_found' }, 404);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const nodes = () => walk(container);
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, null, h(Detail, { uid: 'lic_fr', held: new Map(), tab: 'overview', onTab: () => {} }))));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    calls, byId, props, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)),
    writes: () => calls.filter((c) => c.method === 'POST' && c.path.startsWith('/admin/licences/')),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `nothing to click: ${id}`); // Not awaited: an action's handler waits on the sheet it opens.
      await act(async () => { p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async escape() { await act(async () => { for (const fn of [...keydown]) fn({ key: 'Escape', defaultPrevented: false, preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('mounted: the four header buttons are gone; More offers Renew, Suspend and Terminate on an active licence', async () => {
  const v = await mount();
  try {
    assert.ok(v.has('licence-more'), 'More is drawn in the identity header');
    assert.ok(v.textOf('licence-identity').includes('Axal VC France'));
    assert.equal(v.has('licence-action-suspend'), false, 'the menu is closed until opened');
    assert.doesNotMatch(v.textOf('licence-identity'), /\b(Suspend|Terminate|Renew|Reinstate)\b/, 'no lifecycle button outside More');
    await v.click('licence-more');
    assert.deepEqual(['activate', 'reinstate', 'renew', 'suspend', 'terminate'].filter((a) => v.has(`licence-action-${a}`)), ['renew', 'suspend', 'terminate']);
    assert.equal(v.has('licence-activate'), false, 'an active licence has no Activate button');
  } finally { await v.close(); }
});

test('mounted: Suspend opens the sheet; Cancel writes nothing; a reason is required, then sent', async () => {
  const v = await mount();
  try {
    await v.click('licence-more');
    await v.click('licence-action-suspend');
    assert.ok(v.has('licence-consequence-sheet'), 'the sheet opened');
    assert.match(v.textOf('licence-consequence-sheet'), /Suspend Axal VC France/);
    assert.equal(v.props(v.byId('licence-consequence-confirm')).disabled, true, 'no reason yet');
    await v.click('licence-consequence-cancel');
    assert.equal(v.has('licence-consequence-sheet'), false);
    assert.deepEqual(v.writes(), [], 'Cancel wrote nothing');

    await v.click('licence-more');
    await v.click('licence-action-suspend');
    await v.type('licence-consequence-field', '   ');
    assert.equal(v.props(v.byId('licence-consequence-confirm')).disabled, true, 'blank is not a reason');
    await v.type('licence-consequence-field', '  Fee unpaid since October.  ');
    assert.equal(v.props(v.byId('licence-consequence-confirm')).disabled, false);
    await v.click('licence-consequence-confirm');
    const [write] = v.writes();
    assert.equal(write.path, '/admin/licences/lic_fr/suspend');
    assert.equal(write.body.note, 'Fee unpaid since October.');
    assert.equal(v.has('licence-consequence-sheet'), false);
  } finally { await v.close(); }
});

test('mounted: Escape closes the sheet, writes nothing and returns focus to More', async () => {
  const v = await mount();
  try {
    const more = v.byId('licence-more');
    more.focus();
    await v.click('licence-more');
    await v.click('licence-action-terminate');
    assert.ok(v.has('licence-consequence-sheet'));
    // assert.ok, not equal: a failed equal would print the whole fake DOM.
    assert.ok(document.activeElement === v.byId('licence-consequence-field'), 'focus moved into the sheet, to the reason');
    await v.escape();
    assert.equal(v.has('licence-consequence-sheet'), false, 'Escape closed it');
    assert.deepEqual(v.writes(), []);
    assert.ok(document.activeElement === more, 'focus returned to the control that opened it');
  } finally { await v.close(); }
});

test('mounted: Reinstate on a suspended licence asks no reason and sends none', async () => {
  const v = await mount({ ...LICENCE, status: 'suspended', status_note: 'Fee unpaid.' });
  try {
    assert.match(v.textOf('licence-identity') + v.textOf('licence-consequence-sheet'), /Axal VC France/);
    await v.click('licence-more');
    assert.ok(v.has('licence-action-reinstate'));
    assert.equal(v.has('licence-action-suspend'), false, 'a suspended licence is not offered Suspend');
    await v.click('licence-action-reinstate');
    assert.equal(v.has('licence-consequence-field'), false);
    assert.match(v.textOf('licence-consequence-reason'), /No reason is recorded\./);
    await v.click('licence-consequence-confirm');
    assert.deepEqual(v.writes().map((w) => w.path), ['/admin/licences/lic_fr/reinstate']);
  } finally { await v.close(); }
});

test('mounted: a terminated licence offers no action at all', async () => {
  const v = await mount({ ...LICENCE, status: 'terminated' });
  try {
    assert.equal(v.has('licence-more'), false);
    assert.equal(v.has('licence-activate'), false);
  } finally { await v.close(); }
});

test('mounted: a draft with no blockers activates through the sheet', async () => {
  const v = await mount({ ...LICENCE, status: 'draft' });
  try {
    await v.click('licence-activate');
    assert.match(v.textOf('licence-consequence-sheet'), /Activate Axal VC France/);
    await v.click('licence-consequence-confirm');
    assert.deepEqual(v.writes().map((w) => w.path), ['/admin/licences/lic_fr/activate']);
  } finally { await v.close(); }
});

test('no browser prompt or confirm, and the sheet is the shared ui/Sheet', () => {
  for (const f of ['frontend/src/pages/admin/LicenceConsequenceSheet.jsx', 'frontend/src/pages/admin/licences/LicenceDetail.jsx']) {
    assert.doesNotMatch(read(f), /window\.(prompt|confirm)\(|\bconfirm\(/, f);
  }
  assert.match(read('frontend/src/pages/admin/LicenceConsequenceSheet.jsx'), /import Sheet from '\.\.\/\.\.\/ui\/Sheet'/);
  // Record a request stays the studio's lane; HQ's header does not draw it.
  assert.doesNotMatch(read('frontend/src/pages/admin/licences/LicenceIdentity.jsx').replace(/\/\*[\s\S]*?\*\//g, ''), /Record a request/);
});
