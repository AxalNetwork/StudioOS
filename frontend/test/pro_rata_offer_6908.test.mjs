/**
 * D6908 part 2 (#6908): the Pro rata row's live round and the investor's own offer on Ownership & rights, and the
 * founder's offer inputs on the round manager's Pro-rata panel.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pro_rata_offer_6908.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import OwnershipRights from '../src/pages/portfolio/OwnershipRights.jsx';
import { RIGHT_TYPES } from '../src/pages/portfolio/rightsModel.js';
import {
  NO_LIVE_ROUND, OFFER_NOT_RECORDED, PRO_RATA_SHAPE, ROUND_UNREADABLE, offerInputValue, offerMoney, offerPatch, proRataAction, respondByPatch,
} from '../src/pages/portfolio/proRataOfferModel.js';

const h = React.createElement;
const ok = (value) => ({ state: 'ok', value });
const ROUND = { uid: 'r1', name: 'Series A', close_date: '2026-12-15', href: '/deals/41', href_not_recorded: null };
const OFFER = { amount_cents: 31000000, currency: 'USD', respond_by: '2026-11-30', state: 'offered', taking_cents: null, responded_at: null };

// ── The model ───────────────────────────────────────────────────────────────────────────────────────────────

test('model: a live round with an offer reads the canvas line and links the round', () => {
  assert.deepEqual(proRataAction(ok({ live_round: ROUND, offer: OFFER, offer_not_recorded: null })), {
    kind: 'round', line: 'Series A is live · offer to you: up to $310,000 · respond by 30 Nov 2026', href: '/deals/41', hrefNote: null, offerRecorded: true,
  });
  const noDay = proRataAction(ok({ live_round: ROUND, offer: { ...OFFER, respond_by: null } }));
  assert.equal(noDay.line, 'Series A is live · offer to you: up to $310,000');
});

test('model: a live round with no recorded offer reads Offer not recorded and still links the round; nothing is computed', () => {
  const a = proRataAction(ok({ live_round: ROUND, offer: null, offer_not_recorded: OFFER_NOT_RECORDED }));
  assert.deepEqual([a.kind, a.line, a.href, a.offerRecorded], ['round', 'Series A is live · Offer not recorded', '/deals/41', false]);
  // A row with no amount is not an offer, even with a day to respond by.
  const empty = proRataAction(ok({ live_round: ROUND, offer: { ...OFFER, amount_cents: null } }));
  assert.equal(empty.line, 'Series A is live · Offer not recorded');
});

test('model: no live round reads no action; a round with no deal page says why; an unreadable read is not none', () => {
  assert.deepEqual(proRataAction(ok({ live_round: null, offer: null })), { kind: 'none', line: NO_LIVE_ROUND });
  const noPage = proRataAction(ok({ live_round: { ...ROUND, href: null, href_not_recorded: 'This round has no deal page on Axal.' }, offer: null }));
  assert.deepEqual([noPage.href, noPage.hrefNote], [null, 'This round has no deal page on Axal.']);
  assert.equal(proRataAction(ok({ live_round: { ...ROUND, href: 'https://elsewhere.example/x' }, offer: null })).href, null, 'only an address on this app is linked');
  assert.deepEqual(proRataAction({ state: 'unreadable' }), { kind: 'unreadable', line: ROUND_UNREADABLE });
  assert.deepEqual(proRataAction({ state: 'loading' }), { kind: 'loading' });
  assert.equal(PRO_RATA_SHAPE({ live_round: null, offer: null }), true);
  assert.equal(PRO_RATA_SHAPE({}), false);
});

test('model: money in the offer’s currency, cents only when recorded', () => {
  assert.equal(offerMoney(31000000, 'USD'), '$310,000');
  assert.equal(offerMoney(12345, 'EUR'), '€123.45');
  assert.equal(offerMoney(0, 'USD'), null);
  assert.equal(offerMoney(null, 'USD'), null);
});

test('model: the founder’s inputs — unchanged sends nothing, blank clears, a bad value is refused before sending', () => {
  assert.equal(offerInputValue(31000000), '310000');
  assert.equal(offerInputValue(null), '');
  assert.equal(offerPatch('310000', 31000000), null);
  assert.deepEqual(offerPatch('250000', 31000000), { offer_amount: 250000 });
  assert.deepEqual(offerPatch('', 31000000), { offer_amount: null });
  assert.equal(offerPatch('', null), null);
  assert.ok(offerPatch('-5', null).problem);
  assert.ok(offerPatch('abc', null).problem);
  assert.equal(respondByPatch('2026-11-30', '2026-11-30'), null);
  assert.deepEqual(respondByPatch('2026-12-01', '2026-11-30'), { respond_by: '2026-12-01' });
  assert.deepEqual(respondByPatch('', '2026-11-30'), { respond_by: null });
  assert.ok(respondByPatch('30/11/2026', null).problem);
});

// ── The section ─────────────────────────────────────────────────────────────────────────────────────────────

const none = (type) => ({ type, recorded: false });
const PRO_RATA = { uid: 'g1', type: 'pro_rata', recorded: true, document_title: 'Investors’ Rights Agreement', clause: '§2.1', terms: 'Buy up to your share', signed_on: '2026-03-31', recorded_at: '2026-04-01T10:00:00Z' };
const RIGHTS = { scope: 'own_rights', project: { uid: 'p-abc', name: 'Acme' }, rights: RIGHT_TYPES.map((t) => (t === 'pro_rata' ? PRO_RATA : none(t))), requests: [] };
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mount(routes) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, opts = {}) => {
    const key = `${opts.method || 'GET'} ${String(u).replace(/^.*\/api/, '')}`;
    const out = typeof routes[key] === 'function' ? await routes[key]() : routes[key];
    if (out && out.__status) return response({ error: out.code, message: 'refused' }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(OwnershipRights, {
    uid: 'p-abc', position: { total_invested: 1, rounds: 1, latest_ownership_pct: 6.2 }, route: 'syndicate', duties: { state: 'ok', count: 1 }, reportsHref: '/x',
  }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    has: (id) => !!by(id), props: (id) => pr(by(id)), text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    click: async (id) => { await act(async () => { pr(by(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

test('section: the Pro rata row reads the live round and the investor’s own offer, with Open the round →', async () => {
  const v = await mount({ 'GET /portfolio-rights/p-abc': RIGHTS, 'GET /portfolio-pro-rata/p-abc': { project_uid: 'p-abc', live_round: ROUND, offer: OFFER, offer_not_recorded: null } });
  try {
    assert.match(v.text('rights-row-pro_rata'), /Series A is live · offer to you: up to \$310,000 · respond by 30 Nov 2026/);
    assert.equal(v.props('rights-pro-rata-open-round').href, '/deals/41');
    assert.equal(v.has('rights-pro-rata-round'), true);
    assert.equal(v.text('rights-row-board_seat').includes('Series A'), false, 'only the Pro rata row reads the round');
  } finally { await v.close(); }
});

test('section: no live round reads No live round; a failed round read says so with Retry and the rights stand', async () => {
  const quiet = await mount({ 'GET /portfolio-rights/p-abc': RIGHTS, 'GET /portfolio-pro-rata/p-abc': { project_uid: 'p-abc', live_round: null, offer: null } });
  try {
    assert.equal(quiet.text('rights-pro-rata-no-round'), NO_LIVE_ROUND);
    assert.equal(quiet.has('rights-pro-rata-open-round'), false);
  } finally { await quiet.close(); }
  let calls = 0;
  const v = await mount({
    'GET /portfolio-rights/p-abc': RIGHTS,
    'GET /portfolio-pro-rata/p-abc': () => (++calls === 1 ? { __status: 503, code: 'unavailable' } : { project_uid: 'p-abc', live_round: ROUND, offer: null, offer_not_recorded: OFFER_NOT_RECORDED }),
  });
  try {
    assert.match(v.text('rights-pro-rata-round-unreadable'), /could not be read/);
    assert.equal(v.has('rights-table'), true, 'the rights still read');
    await v.click('button-retry-pro-rata');
    assert.match(v.text('rights-pro-rata-offer'), /Series A is live · Offer not recorded/);
    assert.equal(v.props('rights-pro-rata-open-round').href, '/deals/41', 'Offer not recorded still links the round');
  } finally { await v.close(); }
});

test('the round manager’s Pro-rata panel records the offer and the respond-by day through the model', () => {
  const src = readFileSync(new URL('../src/pages/raise/RoundClosesPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ offerInputValue, offerPatch, respondByPatch \} from '\.\.\/portfolio\/proRataOfferModel'/);
  assert.match(src, /data-testid=\{`pro-rata-offer-\$\{h\.uid\}`\}/);
  assert.match(src, /data-testid=\{`pro-rata-respond-by-\$\{h\.uid\}`\}/);
  assert.match(src, /const b = offerPatch\(e\.target\.value, h\.offer_cents, h\.currency\);/);
  assert.match(src, /const b = respondByPatch\(e\.target\.value, h\.respond_by\);/);
  // The Worker fields these send are the ones PUT /api/contacts/raise-pro-rata/:id reads.
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/contacts.ts', import.meta.url), 'utf8');
  assert.match(worker, /const offer = offerCents\(body\.offer_amount\);/);
  assert.match(worker, /body\.respond_by !== undefined \? ymd\(body\.respond_by\)/);
});

test('section: a read that answers in the wrong shape is unreadable, never "No live round"', async () => {
  const v = await mount({ 'GET /portfolio-rights/p-abc': RIGHTS, 'GET /portfolio-pro-rata/p-abc': { detail: 'something else' } });
  try {
    assert.equal(v.has('rights-pro-rata-round-unreadable'), true);
    assert.equal(v.has('rights-pro-rata-no-round'), false);
  } finally { await v.close(); }
});
