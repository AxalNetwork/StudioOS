/**
 * D1118 (#2998) — PI4's "Adjust terms", the owner's A: only the Super Admin
 * sets an invitation's own terms in New invitation, and sending them is the
 * approval. They apply to Deal-sourcing revenue share and Custom only; an
 * Admin's invitation goes with the standard terms, said in one sentence. The
 * invitation's record says which terms it carries. Fixtures are invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_partner_invitations_d1118.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import NewInvitationDialog from '../src/pages/admin/partners/NewInvitationDialog.jsx';
import {
  TERMS_ADMIN, TERMS_TYPES, refusalText, termsApply, termsInput, termsLine,
} from '../src/pages/admin/partners/partnersDeskModel.js';
import { offerCard } from '../src/pages/admin/partners/invitationsModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };
const ADMIN = { id: 902, role: 'admin', is_super_admin: 0, name: 'Studio admin', email: 'admin@example.com' };
const OPEN = { open: true, pct: '12.5', days: '180', months: '18', note: '  Introductions in writing.  ' };

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

test('termsInput: closed or not applicable is the standard terms; open, every figure is required and bounded', () => {
  assert.deepEqual(termsInput({ ...OPEN, open: false }, ['custom']), { state: 'standard' });
  assert.deepEqual(termsInput(OPEN, ['equity_partnership']), { state: 'standard' });
  assert.deepEqual(termsInput(OPEN, ['deal_sourcing_revshare']), { state: 'own', terms: { revshare_pct: 12.5, attribution_window_days: 180, term_months: 18, note: 'Introductions in writing.' } });
  assert.equal(termsInput({ ...OPEN, note: '' }, ['custom']).terms.note, null);
  for (const [change, field] of [
    [{ pct: '' }, 'pct'], [{ pct: '0' }, 'pct'], [{ pct: '50.01' }, 'pct'], [{ pct: '12.345' }, 'pct'], [{ pct: 'ten' }, 'pct'],
    [{ days: '' }, 'days'], [{ days: '29' }, 'days'], [{ days: '1096' }, 'days'], [{ days: '90.5' }, 'days'],
    [{ months: '' }, 'months'], [{ months: '0' }, 'months'], [{ months: '61' }, 'months'], [{ note: 'x'.repeat(501) }, 'note'],
  ]) {
    const r = termsInput({ ...OPEN, ...change }, ['custom']);
    assert.equal(r.state, 'invalid', JSON.stringify(change)); assert.equal(r.field, field, JSON.stringify(change));
  }
  for (const edge of [{ pct: '0.01', days: '30', months: '1' }, { pct: '50', days: '1095', months: '60' }]) assert.equal(termsInput({ ...OPEN, ...edge }, ['custom']).state, 'own');
  assert.deepEqual(TERMS_TYPES, ['deal_sourcing_revshare', 'custom']);
  assert.equal(termsApply(['services_partnership', 'custom']), true);
  assert.equal(termsApply(['capital_partnership']), false);
});

test('termsLine: the record says the invitation’s own terms and who set them, the standard terms, or that they could not be read', () => {
  const own = termsLine({ state: 'own', revshare_pct: '12.5', attribution_window_days: 1095, term_months: 18, note: 'In writing.', set_by_name: 'HQ', set_at: '2026-10-26T16:00:00Z' });
  assert.equal(own.text, 'Own terms: 12.5% revenue share · 1,095-day attribution window · 18 months');
  assert.match(own.by, /^Set by HQ on /);
  assert.equal(own.note, 'In writing.');
  assert.equal(termsLine({ state: 'own', revshare_pct: '5', attribution_window_days: 30, term_months: 1, note: null, set_by_name: null, set_at: null }).by, 'Set by the Super Admin');
  assert.deepEqual(termsLine({ state: 'standard' }), { state: 'standard', text: 'Standard terms.' });
  assert.equal(termsLine(undefined).state, 'standard');
  assert.equal(termsLine({ state: 'unreadable' }).state, 'unreadable');
  assert.match(termsLine({ state: 'unreadable' }).text, /could not be read, so no offer is made/);
});

test('refusals: a terms refusal and the Super Admin gate show the Worker’s sentence', () => {
  const err = (code, message, status = 400) => Object.assign(new Error(message), { status, code });
  assert.equal(refusalText(err('terms_window_invalid', 'Enter an attribution window of 30 to 1,095 days.'), 'create'), 'Enter an attribution window of 30 to 1,095 days.');
  assert.equal(refusalText(err('super_admin_required', 'Only the Super Admin sets an invitation’s own terms.', 403), 'create'), 'Only the Super Admin sets an invitation’s own terms.');
  assert.equal(refusalText(err('terms_not_applicable', ''), 'create'), 'The terms could not be saved. Check each field.');
  assert.equal(refusalText(err(null, 'Valid recipient_email required'), 'create'), 'Enter a valid email address.');
});

test('offer cards name the revenue-share terms in words', () => {
  const card = offerCard({ deal_type: 'deal_sourcing_revshare', label: 'Deal Sourcing Revenue Share', term_months: 18,
    terms: { founder_revshare_pct: '12.5% of Axal fees', lp_revshare_pct: '10%', attribution_window_days: 180, terms_note: 'In writing.' } });
  assert.deepEqual(card.terms.map((t) => t.label), ['Founder deals', 'LP capital', 'Attribution window (days)', 'Terms note']);
  assert.equal(card.term, '18 months');
});

async function mounted(user) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    const url = String(u);
    requests.push({ url, method: String(options.method || 'GET'), body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/auth/me')) return response(user);
    if (url.startsWith('/api/admin/partners/offers/preview')) return response({ types: [], unknown: [], not_offered: [], offers: [], source: 'worker' });
    if (url.startsWith('/api/admin/partners/invitations/lookup')) return response({ open_invitation: null, member: null });
    if (url === '/api/admin/partners/invitations' && options.method === 'POST') return response({ id: 31, link: 'https://app.example.test/partners/onboard?token=t', email_sent: true, terms: 'own' }, 201);
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: ['/admin/partner-invitations'] },
    h(AuthProvider, null, h(NewInvitationDialog, { reads: { reload() {} }, onClose() {} })))));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {} };
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id}`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async tick(id) { await act(async () => { props(byId(id)).onChange({ target: {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('mounted: the Super Admin opens Adjust terms for Custom; a blank figure stops Send; the terms reach the Worker', async () => {
  const view = await mounted(SUPER);
  try {
    await view.change('partners-new-email', 'partner@example.com');
    assert.ok(!view.has('partners-new-terms'), 'nothing to adjust before a type it applies to');
    await view.tick('partners-new-type-equity_partnership-box');
    assert.ok(!view.has('partners-new-terms'), 'equity keeps the standard terms');
    await view.tick('partners-new-type-custom-box');
    assert.ok(view.has('partners-new-terms'));
    assert.ok(!view.has('partners-new-terms-fields'), 'closed until opened');
    await view.click('partners-new-terms-toggle');
    assert.ok(view.has('partners-new-terms-fields'));
    assert.equal(view.props('partners-new-send').disabled, true, 'open with blanks: nothing is read as 0');
    assert.match(view.textOf('partners-new-terms-invalid'), /revenue share/);
    await view.change('partners-new-terms-pct', '12.5');
    await view.change('partners-new-terms-days', '180');
    await view.change('partners-new-terms-months', '18');
    await view.change('partners-new-terms-note', 'Introductions in writing.');
    assert.ok(!view.has('partners-new-terms-invalid'));
    await view.click('partners-new-send');
    const sent = view.requests.find((r) => r.method === 'POST');
    assert.deepEqual(sent.body.terms, { revshare_pct: 12.5, attribution_window_days: 180, term_months: 18, note: 'Introductions in writing.' });
    assert.deepEqual(sent.body.allowed_deal_types, ['equity_partnership', 'custom']);
  } finally { await view.close(); }
});

test('mounted: closed again, the Super Admin’s invitation goes with the standard terms and sends no terms', async () => {
  const view = await mounted(SUPER);
  try {
    await view.change('partners-new-email', 'partner@example.com');
    await view.tick('partners-new-type-deal_sourcing_revshare-box');
    await view.click('partners-new-terms-toggle');
    await view.change('partners-new-terms-pct', '99');
    await view.click('partners-new-terms-toggle');
    await view.click('partners-new-send');
    assert.ok(!('terms' in view.requests.find((r) => r.method === 'POST').body));
  } finally { await view.close(); }
});

test('mounted: an Admin sees one sentence, no fields, and sends the standard terms', async () => {
  const view = await mounted(ADMIN);
  try {
    await view.change('partners-new-email', 'partner@example.com');
    await view.tick('partners-new-type-deal_sourcing_revshare-box');
    assert.equal(view.textOf('partners-new-terms-admin'), TERMS_ADMIN);
    assert.ok(!view.has('partners-new-terms') && !view.has('partners-new-terms-toggle'));
    await view.click('partners-new-send');
    assert.ok(!('terms' in view.requests.find((r) => r.method === 'POST').body));
  } finally { await view.close(); }
});

test('sources: the record draws the terms line, and the dialog asks the signed-in user, never a prop, whether it may adjust', () => {
  const dialog = read('frontend/src/pages/admin/partners/NewInvitationDialog.jsx');
  assert.match(dialog, /isSuperAdminUser\(useAuth\(\)\?\.user\)/);
  assert.doesNotMatch(dialog, /window\.(alert|confirm|prompt)\(/);
  const record = read('frontend/src/pages/admin/partners/InvitationRecord.jsx');
  assert.match(record, /data-testid="partners-invitation-terms"/);
  assert.match(record, /termsLine\(inv\.terms\)/);
});
