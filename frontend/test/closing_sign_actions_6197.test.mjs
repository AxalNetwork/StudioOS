// D6197 (#6197) — in the closing room's Review and sign, the viewer's own link
// again ("Send me the link again", by email, never shown) while their stage is
// out to them, and their executed copy once every stage has signed; on the
// Documents tab's Deal paper card, the same "Send me the link again" when an
// envelope waits on the viewer. A viewer who is not a party gets neither.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closing_sign_actions_6197.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { SignDrawer } from '../src/pages/closing/RoomDialogs.jsx';
import DealPaperRow from '../src/pages/deal/DealPaper.jsx';
import { SIGN_WORDS, signActions } from '../src/pages/closing/roomModel.js';
import { PAPER_WORDS } from '../src/pages/deal/dealWorkModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
  blob: async () => ({ size: 3, type: 'application/pdf' }),
});

const stage = (position, role, state, signed_at = null) => ({ position, role, name: null, state, sent_at: '2026-10-10', signed_at });
const OUT_TO_INVESTOR = {
  uid: 's1', title: 'SAFE', complete: false, voided: false,
  stages: [stage(1, 'company', 'signed', '2026-10-09'), stage(2, 'investor', 'sent')],
  you: { position: 2, role: 'investor', state: 'sent', envelope_id: 61 },
};
const EXECUTED = {
  uid: 's1', title: 'SAFE', complete: true, voided: false,
  stages: [stage(1, 'company', 'signed', '2026-10-09'), stage(2, 'investor', 'signed', '2026-10-11')],
  you: { position: 2, role: 'investor', state: 'signed', envelope_id: 61 },
};
/** An admin reads the paper but signs no stage: the Worker gives `you: null`. */
const NOT_A_PARTY = { ...OUT_TO_INVESTOR, you: null };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('signActions: resend while the viewer’s own stage is out to them, download once every stage signed, neither for a non-party', () => {
  // Mutation checked: resend offered on a waiting stage; download before the whole paper is signed; a non-party given either.
  assert.deepEqual(signActions(OUT_TO_INVESTOR), { resend: 61, download: null });
  assert.deepEqual(signActions(EXECUTED), { resend: null, download: 61 });
  assert.deepEqual(signActions(NOT_A_PARTY), { resend: null, download: null });
  assert.deepEqual(signActions({ ...OUT_TO_INVESTOR, you: { ...OUT_TO_INVESTOR.you, state: 'waiting', envelope_id: null } }), { resend: null, download: null });
  assert.deepEqual(signActions({ ...EXECUTED, complete: false }), { resend: null, download: null }, 'my stage signed, the paper not yet executed');
  assert.deepEqual(signActions({ ...OUT_TO_INVESTOR, voided: true }), { resend: null, download: null });
  assert.deepEqual(signActions({ ...OUT_TO_INVESTOR, you: { ...OUT_TO_INVESTOR.you, envelope_id: '../x' } }), { resend: null, download: null }, 'only an id the routes take');
  assert.deepEqual(signActions(null), { resend: null, download: null });
  assert.match(SIGN_WORDS.download, /executed/);
  assert.doesNotMatch(SIGN_WORDS.download, /signed copy/);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount(tree, { routes = {}, user = { id: 3, role: 'investor', name: 'Ivy', email: 'ivy@example.test' } } = {}) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL, matchMedia: globalThis.matchMedia };
  const asked = [];
  const saved = [];
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  URL.createObjectURL = () => 'blob:closing';
  URL.revokeObjectURL = () => {};
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    if (String(tag).toLowerCase() === 'a') Object.assign(n, { click() { saved.push(n.download); }, remove() {} });
    return n;
  };
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = String(opts.method || 'GET').toUpperCase();
    asked.push(`${method} ${path}`);
    const hit = routes[`${method} ${path.split('?')[0]}`];
    if (hit && hit.status >= 400) return response(hit.body, hit.status);
    return response(hit ?? {});
  };
  localStorage.setItem('user', JSON.stringify(user));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(MemoryRouter, null, h(AuthProvider, null, tree))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, saved, has: (id) => !!by(id),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { fetch: prev.fetch, matchMedia: prev.matchMedia });
      URL.createObjectURL = prev.create; URL.revokeObjectURL = prev.revoke;
      localStorage.removeItem('user'); restore();
    },
  };
}

const drawer = (envelope, viewer = 'investor') =>
  h(SignDrawer, { row: { uid: 'l2', investor: 'Harbor Ventures' }, envelope, failed: false, viewer, company: 'Acme Robotics', onClose() {} });

test('mounted: the investor whose turn it is asks for the link again; the room says it was sent and never shows a link', async () => {
  // Mutation checked: the resend posted to /remind; the success line drawn before the Worker answered; a link drawn.
  const v = await mount(drawer(OUT_TO_INVESTOR), { routes: { 'POST /legal/esign/61/resend': { resent: true, link_renewed: false, expires_at: '2026-11-25T00:00:00Z' } } });
  try {
    assert.match(v.text('closing-sign-resend'), new RegExp(SIGN_WORDS.resend));
    assert.match(v.text('closing-sign-paper'), /e-sign page the link opens/);
    assert.ok(!v.has('closing-sign-download'), 'nothing to download before the paper is executed');
    assert.ok(!v.has('closing-sign-resent'));
    await v.click('closing-sign-resend');
    assert.deepEqual(v.asked.filter((a) => a.startsWith('POST')), ['POST /legal/esign/61/resend']);
    assert.match(v.text('closing-sign-resent'), /Sent again/);
    assert.doesNotMatch(v.text(), /\/esign\/|https?:/, 'no signing URL in the room');
  } finally { await v.close(); }
});

test('mounted: the Worker’s refusal is drawn as its own sentence', async () => {
  const v = await mount(drawer(OUT_TO_INVESTOR), {
    routes: { 'POST /legal/esign/61/resend': { status: 429, body: { error: 'resend_too_soon', message: 'Your signing link was sent again in the last hour.' } } },
  });
  try {
    await v.click('closing-sign-resend');
    assert.equal(v.text('closing-sign-resend-refused'), 'Your signing link was sent again in the last hour.');
    assert.ok(!v.has('closing-sign-resent'));
  } finally { await v.close(); }
});

test('mounted: once executed, the viewer downloads their executed copy through the Worker', async () => {
  // Mutation checked: the download read from another envelope; offered while a stage is unsigned.
  const v = await mount(drawer(EXECUTED));
  try {
    assert.ok(!v.has('closing-sign-resend'), 'nothing to resend once signed');
    assert.match(v.text('closing-sign-download'), /Download the executed copy/);
    await v.click('closing-sign-download');
    assert.ok(v.asked.includes('GET /legal/esign/61/document'));
    assert.deepEqual(v.saved, ['axal-signed-61.pdf']);
  } finally { await v.close(); }
  const f = await mount(drawer(EXECUTED), { routes: { 'GET /legal/esign/61/document': { status: 404, body: { error: 'envelope_not_found', message: 'No envelope here.' } } } });
  try {
    await f.click('closing-sign-download');
    assert.deepEqual(f.saved, []);
    assert.equal(f.text('closing-sign-download-refused'), 'No envelope here.');
  } finally { await f.close(); }
});

test('mounted: a reader who is not a party sees the order and neither action, and asks the Worker for nothing', async () => {
  const v = await mount(drawer(NOT_A_PARTY, 'admin'), { user: { id: 1, role: 'admin', name: 'Ada', email: 'ada@example.test' } });
  try {
    assert.ok(v.has('closing-sign-order'));
    for (const id of ['closing-sign-actions', 'closing-sign-resend', 'closing-sign-download']) assert.ok(!v.has(id), id);
    assert.deepEqual(v.asked.filter((a) => a.includes('/legal/esign')), [], 'no e-sign call for a non-party');
  } finally { await v.close(); }
  const done = await mount(drawer({ ...EXECUTED, you: null }, 'founder'), { user: { id: 2, role: 'founder', name: 'Fay', email: 'fay@example.test' } });
  try {
    assert.ok(!done.has('closing-sign-download'), 'no copy for a reader who signed no stage');
  } finally { await done.close(); }
});

/* ------------------------------------------------------------------ *
 * The Deal paper card (Documents tab)
 * ------------------------------------------------------------------ */

const OPEN_ROW = { id: 32, title: 'Side letter', state: 'Partly signed', tone: 'wait', signed: '1 of 2 signed', action: 'sign' };
const DETAIL = (status) => ({ id: 32, status: 'partially_signed', recipients: [
  { recipient_email: 'fay@example.test', status: 'signed', signed_at: '2026-11-03' },
  { recipient_email: 'Ivy@Example.test', status },
] });

test('mounted, Deal paper: an envelope waiting on the viewer offers the link again; the refusal is the Worker’s', async () => {
  // Mutation checked: offered to a viewer who already signed; the resend sent to another envelope.
  const v = await mount(h(DealPaperRow, { row: OPEN_ROW }), { routes: {
    'GET /legal/esign/32': DETAIL('pending'),
    'POST /legal/esign/32/resend': { status: 429, body: { error: 'resend_too_soon', message: 'Your signing link was sent again in the last hour.' } },
  } });
  try {
    assert.match(v.text('deal-paper-resend'), new RegExp(PAPER_WORDS.resend));
    await v.click('deal-paper-resend');
    assert.ok(v.asked.includes('POST /legal/esign/32/resend'));
    assert.equal(v.text('deal-paper-resend-refused'), 'Your signing link was sent again in the last hour.');
  } finally { await v.close(); }
  const ok = await mount(h(DealPaperRow, { row: OPEN_ROW }), { routes: { 'GET /legal/esign/32': DETAIL('pending'), 'POST /legal/esign/32/resend': { resent: true } } });
  try {
    await ok.click('deal-paper-resend');
    assert.match(ok.text('deal-paper-resent'), /Sent again/);
  } finally { await ok.close(); }
});

test('mounted, Deal paper: a signer who already signed, and a viewer who is not a signer, get no resend', async () => {
  const signed = await mount(h(DealPaperRow, { row: OPEN_ROW }), { routes: { 'GET /legal/esign/32': DETAIL('signed') } });
  try { assert.ok(!signed.has('deal-paper-resend')); } finally { await signed.close(); }
  const other = await mount(h(DealPaperRow, { row: OPEN_ROW }), {
    routes: { 'GET /legal/esign/32': DETAIL('pending') }, user: { id: 9, role: 'investor', name: 'Olu', email: 'olu@example.test' },
  });
  try {
    assert.ok(!other.has('deal-paper-resend'));
    assert.match(other.text('deal-paper-sign'), /not a signer/);
  } finally { await other.close(); }
});

test('Deal paper: a fully signed envelope says executed', async () => {
  const v = await mount(h(DealPaperRow, { row: { ...OPEN_ROW, state: 'Fully signed', tone: 'done', action: 'download' } }));
  try { assert.equal(v.text('deal-paper-download'), 'Download the executed copy'); } finally { await v.close(); }
});
