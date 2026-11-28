// D9108 (#9108) — Contracts › Closings, one closing (CP14): an Admin opens a
// live line's receipt drawer (CP10), records an Axal entity's Mercury credit
// or a phone-verified transfer as evidence, withdraws a piece with a reason,
// and adds a late line. The line's status comes from the closing's re-read.
//
// Every read and act is stubbed; nothing here reaches a bank. Fixtures are fake.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closing_admin_evidence_9108.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { AdminClosingPage } from '../src/pages/closing/ClosingsPages.jsx';
import { ReceiptDrawer } from '../src/pages/closing/RoomDialogs.jsx';
import { BANK_CONFIRMATION_LINE } from '../src/pages/closing/EvidenceDialogs.jsx';
import {
  RECORDABLE_KINDS, TRANSFER_WORDS, WITHDRAW_REASON_MAX, WITHDRAW_REASON_MIN, addedBy, canRecordKind, centsFromInput, evidenceRows, lineableCommitments,
  mercuryEvidenceBody, prospectIdOf, reasonState, sentNotReceived, transferBody, transferEvidenceBody,
} from '../src/pages/closing/roomModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});
const refuse = (code, message, status) => Object.assign(new Error(message), { code, status });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('only axal_mercury and phone_verified_record may be recorded here, both on the receiving side, mirroring the Worker', () => {
  assert.deepEqual(Object.keys(RECORDABLE_KINDS).sort(), ['axal_mercury', 'phone_verified_record']);
  const worker = read('cloudflare-worker/src/services/closings.ts');
  const side = worker.slice(worker.indexOf('export const EVIDENCE_SIDE'), worker.indexOf('} as const;', worker.indexOf('export const EVIDENCE_SIDE')));
  for (const [kind, s] of Object.entries(RECORDABLE_KINDS)) {
    assert.equal(s, 'receiving', kind);
    assert.match(side, new RegExp(`${kind}: '${s}'`), `${kind} is ${s} on the Worker too`);
  }
  for (const k of ['company_mercury', 'investor_mercury', 'bank_confirmation', 'toString', '']) assert.equal(canRecordKind(k), false, k);
  for (const k of ['axal_mercury', 'phone_verified_record']) assert.equal(canRecordKind(k), true, k);
});

test('the evidence bodies: an Axal credit by its uid, a saved transfer by its uid, nothing else', () => {
  assert.deepEqual(mercuryEvidenceBody({ uid: 'tx_1', amount_cents: 500 }), { kind: 'axal_mercury', source_ref: 'mercury:tx_1' });
  assert.ok(mercuryEvidenceBody({ uid: 'tx_1', amount_cents: -500 }).error, 'a debit is never receipt evidence');
  assert.ok(mercuryEvidenceBody({ uid: 'tx_1', amount_cents: 0 }).error);
  assert.ok(mercuryEvidenceBody({ uid: 'a b', amount_cents: 5 }).error, 'an id outside the Worker’s SOURCE_REF set is refused here');
  assert.ok(mercuryEvidenceBody(null).error);
  assert.deepEqual(transferEvidenceBody({ uid: 't9' }), { kind: 'phone_verified_record', source_ref: 'deal_transfer:t9' });
  assert.equal(transferEvidenceBody({}), null);
  assert.equal(transferEvidenceBody({ uid: 'x'.repeat(65) }), null);
});

test('the transfer body: phone-verified, integer cents, tied to the line, and no date', () => {
  assert.equal(centsFromInput('400,000.00'), 40000000);
  assert.equal(centsFromInput('$1000.5'), 100050);
  assert.equal(centsFromInput(' 12 '), 1200);
  for (const bad of ['', '0', '0.00', '1.234', '-5', 'ten', '1e5']) assert.equal(centsFromInput(bad), null, bad);
  assert.deepEqual(transferBody({ amount: '1,000.50', reference: '  REF-1 ', phone: true, lineUid: 'l1' }),
    { amount_cents: 100050, reference: 'REF-1', phone_verified: true, closing_line_uid: 'l1' });
  assert.equal(transferBody({ amount: '5', reference: '', phone: true, lineUid: 'l1' }).reference, undefined);
  assert.equal(transferBody({ amount: '5', phone: false, lineUid: 'l1' }).error, TRANSFER_WORDS.phoneNeeded);
  assert.equal(transferBody({ amount: 'x', phone: true, lineUid: 'l1' }).error, TRANSFER_WORDS.amount);
  assert.ok(!('date' in transferBody({ amount: '5', phone: true, lineUid: 'l1' })));
});

test('the withdraw reason: 10 to 200 trimmed characters, the Worker’s own bounds, with a live count', () => {
  const worker = read('cloudflare-worker/src/services/closings.ts');
  assert.match(worker, new RegExp(`WITHDRAW_REASON_MIN = ${WITHDRAW_REASON_MIN};`));
  assert.match(worker, new RegExp(`WITHDRAW_REASON_MAX = ${WITHDRAW_REASON_MAX};`));
  assert.equal(reasonState('123456789').ok, false);
  assert.equal(reasonState('123456789').hint, '1 more character needed');
  assert.equal(reasonState('  123456789  ').ok, false, 'trimmed, as the Worker trims');
  assert.equal(reasonState('1234567890').ok, true);
  assert.equal(reasonState('x'.repeat(200)).ok, true);
  assert.equal(reasonState('x'.repeat(201)).ok, false);
  assert.equal(reasonState('x'.repeat(203)).hint, '3 characters too long');
  assert.equal(reasonState('abc').count, '3 / 200');
});

test('which commitments can still take a line: pending or confirmed, with a uid, and no line yet (a withdrawn line included)', () => {
  const commitments = [
    { id: 31, uid: 'c31', status: 'confirmed' },
    { id: 33, uid: 'c33', status: 'pending' },
    { id: 34, uid: 'c34', status: 'confirmed' },
    { id: 35, uid: 'c35', status: 'withdrawn' },
    { id: 36, uid: 'c36', status: 'declined' },
    { id: 37, uid: null, status: 'pending' },
  ];
  const lines = [{ commitment_id: 31, status: 'open' }, { commitment_id: 34, status: 'withdrawn' }, { commitment_id: null, prospect_id: 9 }];
  assert.deepEqual(lineableCommitments(commitments, lines).map((c) => c.uid), ['c33']);
  assert.deepEqual(lineableCommitments(commitments, []).map((c) => c.uid), ['c31', 'c33', 'c34']);
  assert.deepEqual(lineableCommitments(null, null), []);
  assert.equal(prospectIdOf(' 12 '), 12);
  for (const bad of ['', '0', '-1', '1.5', 'abc']) assert.equal(prospectIdOf(bad), null, bad);
});

test('who added a piece is "you" or "another Admin", never a name; sent-only evidence is named', () => {
  assert.equal(addedBy(4, 4), 'Added by you');
  assert.equal(addedBy('4', 4), 'Added by you');
  assert.equal(addedBy(5, 4), 'Added by another Admin');
  assert.equal(addedBy(null, 4), null);
  const rows = evidenceRows([{ uid: 'a', kind: 'axal_mercury', side: 'receiving', recorded_by: 4 }, { uid: 'b', kind: 'investor_mercury', side: 'sending', recorded_by: 9, withdrawn_at: '2026-11-02' }], 4);
  assert.deepEqual(rows.map((r) => [r.uid, r.live, r.by]), [['b', false, 'Added by another Admin'], ['a', true, 'Added by you']]);
  assert.equal(sentNotReceived([{ side: 'sending' }]), true);
  assert.equal(sentNotReceived([{ side: 'sending' }, { side: 'receiving' }]), false);
  assert.equal(sentNotReceived([{ side: 'sending' }, { side: 'receiving', withdrawn_at: '2026-11-02' }]), true, 'a withdrawn receipt no longer counts');
  assert.equal(sentNotReceived([{ side: 'sending', withdrawn_at: '2026-11-02' }]), false);
  assert.equal(sentNotReceived([]), false);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount(element, routes, { url = '/', user = { id: 4, role: 'admin', is_super_admin: 0 } } = {}) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const path = String(u).replace(/^.*\/api/, '').split('?')[0];
    const query = String(u).includes('?') ? String(u).split('?')[1] : '';
    const body = init.body ? JSON.parse(init.body) : null;
    asked.push({ method, path, query, body });
    const hit = routes[`${method} ${path}`] ?? (method === 'GET' ? routes[path] : undefined);
    const value = typeof hit === 'function' ? hit(body) : hit;
    if (value instanceof Error) return response({ message: value.message, code: value.code }, value.status || 500);
    return response(value ?? {}, method === 'POST' ? 201 : 200);
  };
  localStorage.setItem('user', JSON.stringify({ name: 'A', email: 'a@example.com', ...user }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, element))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(el).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id),
    props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : el).replace(/\s+/g, ' ').trim(),
    posts: (path) => asked.filter((a) => a.method === 'POST' && (!path || a.path === path)),
    async click(id) { const p = pr(by(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { p.onClick({ preventDefault() {} }); }); await flush(); },
    /** Press the Retry of the failed read inside `id`. */
    async retry(id) {
      const button = walk(by(id)).find((n) => 'data-state-retry' in pr(n));
      assert.ok(button, `no retry inside ${id}`);
      await act(async () => { pr(button).onClick({ preventDefault() {} }); }); await flush();
    },
    async change(id, value, checked = true) { const p = pr(by(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

const L1 = { uid: 'l1', commitment_id: 31, investor_user_id: 41, investor_name: 'Fund I', route: null, amount_cents: 40000000, currency: 'USD', status: 'open', evidence: [] };
const L2 = { uid: 'l2', commitment_id: 32, investor_user_id: 42, investor_name: 'Northwind Syndicate SPV', route: 'direct', amount_cents: 25000000, currency: 'USD', status: 'sent',
  evidence: [{ uid: 'e2', kind: 'investor_mercury', side: 'sending', recorded_by: 9, created_at: '2026-10-18' }] };
const CLOSING = (over = {}) => ({
  uid: 'c1', deal_id: 7, project_id: 5, round_label: 'Seed', instrument: 'Post-money SAFE', currency: 'USD', status: 'open',
  deadline: '2026-11-30', reach: 'all', total_cents: 65000000, line_count: 2, captable: { state: 'not_ready' }, lines: [L1, L2], events: [], ...over,
});
const RECEIVED_L1 = { ...L1, status: 'received', evidence: [{ uid: 'e9', kind: 'axal_mercury', side: 'receiving', recorded_by: 4, created_at: '2026-11-20' }] };
const BASE = {
  '/closings': { closings: [{ uid: 'c1', deal_id: 7, project_name: 'Acme Robotics', round_label: 'Seed', status: 'open' }] },
  '/legal/esign/staged/line/31': { envelopes: [] },
  '/legal/esign/staged/line/32': { envelopes: [] },
  '/deals': [{ id: 7, founder_user_id: 3, project_name: 'Acme Robotics' }],
  '/fund-admin/access': { acts: [{ act: 'closing.evidence', allowed: true, sentence: null }] },
};
/** The closing read, Received on l1 once evidence has been posted. */
const live = (extra = {}) => {
  const routes = { ...BASE, ...extra };
  routes['/closings/c1'] = () => (routes.__posted ? CLOSING({ lines: [RECEIVED_L1, L2] }) : CLOSING());
  return routes;
};
const at = (routes, user) => mount(h(Routes, null, h(Route, { path: '/admin/contracts/closings/:dealId', element: h(AdminClosingPage) })), routes, { url: '/admin/contracts/closings/7', user });

test('the receipt drawer on the admin page: record actions, no dead-end link, the bank upload off with its reason', async () => {
  const v = await at(live());
  try {
    await v.click('closing-line-receipt-btn-l1');
    assert.ok(v.has('closing-receipt'));
    assert.equal(v.text('closing-receipt-empty'), 'No evidence recorded for this line yet.');
    assert.ok(!v.has('closing-receipt-desk-link'), 'the link back to this page is gone here');
    assert.doesNotMatch(v.text('closing-receipt'), /Record evidence on Contracts › Closings/);
    assert.ok(v.has('closing-receipt-record-mercury') && v.has('closing-receipt-record-transfer'));
    assert.equal(v.props('closing-receipt-upload-bank').disabled, true);
    assert.equal(v.text('closing-receipt-bank-why'), BANK_CONFIRMATION_LINE);
    assert.ok(!v.posts().length, 'opening the drawer writes nothing');
  } finally { await v.close(); }
});

test('Axal Mercury: credits only are read, only axal_mercury is sent, and the line reads Received from the re-read', async () => {
  const routes = live({
    '/admin/mercury/transactions': { ok: true, items: [
      { uid: 'tx1', amount_cents: 40000000, entity_key: 'fund', last_four: '1234', posted_on: '2026-11-19', counterparty_name: 'Fund I LP', match: null },
      { uid: 'tx2', amount_cents: -100, entity_key: 'gp', posted_on: '2026-11-18', match: null },
    ] },
  });
  routes['POST /closings/c1/lines/l1/evidence'] = () => { routes.__posted = true; return { uid: 'e9' }; };
  const v = await at(routes);
  try {
    await v.click('closing-line-receipt-btn-l1');
    await v.click('closing-receipt-record-mercury');
    const q = v.asked.find((a) => a.path === '/admin/mercury/transactions');
    assert.match(q.query, /direction=credit/);
    assert.ok(v.has('closing-evidence-mercury-tx1'));
    assert.ok(!v.has('closing-evidence-mercury-tx2'), 'a debit is never offered');
    assert.equal(v.props('closing-evidence-mercury-record').disabled, true, 'nothing chosen, nothing to record');
    await v.change('closing-evidence-mercury-tx1', '');
    await v.click('closing-evidence-mercury-record');
    const posts = v.posts('/closings/c1/lines/l1/evidence');
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, { kind: 'axal_mercury', source_ref: 'mercury:tx1' });
    for (const a of v.posts()) assert.ok(!['company_mercury', 'investor_mercury'].includes(a.body?.kind), 'never a company or investor Mercury kind');
    assert.ok(!v.has('closing-evidence-mercury-dialog'));
    assert.match(v.text('closing-receipt-status'), /Received/);
    assert.match(v.text('closing-line-status-l1'), /^Received$/);
    assert.equal(v.text('closing-evidence-by-e9'), 'Added by you');
    assert.ok(v.asked.filter((a) => a.path === '/closings/c1').length >= 2, 'the closing is read again after the write');
  } finally { await v.close(); }
});

test('a failed Mercury read blanks only that picker, with a retry; a refusal keeps the dialog open', async () => {
  const routes = live({ '/admin/mercury/transactions': new Error('down') });
  const v = await at(routes);
  try {
    await v.click('closing-line-receipt-btn-l1');
    await v.click('closing-receipt-record-mercury');
    assert.match(v.text('closing-evidence-mercury-dialog'), /could not be read/);
    assert.match(v.text('closing-evidence-mercury-dialog'), /not a claim that no credit arrived/);
    assert.ok(v.has('closing-receipt-status'), 'the drawer behind it still stands');
    routes['/admin/mercury/transactions'] = { ok: true, items: [{ uid: 'tx1', amount_cents: 5, entity_key: 'fund', posted_on: '2026-11-19' }] };
    routes['POST /closings/c1/lines/l1/evidence'] = refuse('line_withdrawn', 'This line is withdrawn, so it takes no evidence.', 409);
    await v.retry('closing-evidence-mercury-dialog');
    await v.change('closing-evidence-mercury-tx1', '');
    await v.click('closing-evidence-mercury-record');
    assert.equal(v.text('closing-evidence-mercury-error'), 'This line is withdrawn, so it takes no evidence.');
    assert.ok(v.has('closing-evidence-mercury-dialog'), 'the dialog stays open on a refusal');
  } finally { await v.close(); }
});

for (const [code, status, message] of [
  ['source_ref_invalid', 400, 'The source names the stored record by its id: mercury:<id>, deal_transfer:<uid> or file:<key>.'],
  ['support_session_refused', 403, 'A support session cannot change a closing.'],
  ['admin_frozen', 423, 'Your admin access is frozen.'],
]) {
  test(`recording evidence: ${code} shows its sentence and keeps the dialog open`, async () => {
    const v = await at(live({
      '/admin/mercury/transactions': { ok: true, items: [{ uid: 'tx1', amount_cents: 5, entity_key: 'fund', posted_on: '2026-11-19' }] },
      'POST /closings/c1/lines/l1/evidence': refuse(code, message, status),
    }));
    try {
      await v.click('closing-line-receipt-btn-l1');
      await v.click('closing-receipt-record-mercury');
      await v.change('closing-evidence-mercury-tx1', '');
      await v.click('closing-evidence-mercury-record');
      assert.equal(v.text('closing-evidence-mercury-error'), message);
      assert.ok(v.has('closing-evidence-mercury-dialog'));
    } finally { await v.close(); }
  });
}

test('Record a transfer: unticked it cannot record and says why; ticked it saves the transfer, then records it', async () => {
  const routes = live({ 'POST /deals/7/transfers': { item: { uid: 't9', amount_cents: 100050, phone_verified: 1 } } });
  routes['POST /closings/c1/lines/l1/evidence'] = () => { routes.__posted = true; return { uid: 'e9' }; };
  const v = await at(routes);
  try {
    await v.click('closing-line-receipt-btn-l1');
    await v.click('closing-receipt-record-transfer');
    assert.ok(!v.has('closing-evidence-transfer-date'), 'the canvas’s Date has nowhere to go');
    await v.change('closing-evidence-transfer-amount', '1,000.50');
    assert.equal(v.props('closing-evidence-transfer-record').disabled, true);
    assert.equal(v.text('closing-evidence-transfer-why'), TRANSFER_WORDS.phoneNeeded);
    await v.change('closing-evidence-transfer-phone', '', true);
    assert.ok(!v.has('closing-evidence-transfer-why'));
    await v.click('closing-evidence-transfer-record');
    assert.deepEqual(v.posts('/deals/7/transfers').map((a) => a.body), [{ amount_cents: 100050, phone_verified: true, closing_line_uid: 'l1' }]);
    assert.deepEqual(v.posts('/closings/c1/lines/l1/evidence').map((a) => a.body), [{ kind: 'phone_verified_record', source_ref: 'deal_transfer:t9' }]);
    assert.ok(!v.has('closing-evidence-transfer-dialog'));
    assert.match(v.text('closing-receipt-status'), /Received/);
  } finally { await v.close(); }
});

test('a transfer saved but not recorded says so, and the retry records it without saving a second transfer', async () => {
  const routes = live({ 'POST /deals/7/transfers': { item: { uid: 't9' } } });
  routes['POST /closings/c1/lines/l1/evidence'] = refuse('transfer_not_found', 'No phone-verified transfer on this deal has that id.', 404);
  const v = await at(routes);
  try {
    await v.click('closing-line-receipt-btn-l1');
    await v.click('closing-receipt-record-transfer');
    await v.change('closing-evidence-transfer-amount', '5');
    await v.change('closing-evidence-transfer-phone', '', true);
    await v.click('closing-evidence-transfer-record');
    assert.equal(v.text('closing-evidence-transfer-saved'), TRANSFER_WORDS.saved);
    assert.equal(v.text('closing-evidence-transfer-error'), 'No phone-verified transfer on this deal has that id.');
    assert.equal(v.text('closing-evidence-transfer-record'), 'Record it on the line again');
    routes['POST /closings/c1/lines/l1/evidence'] = () => { routes.__posted = true; return { uid: 'e9' }; };
    await v.click('closing-evidence-transfer-record');
    assert.equal(v.posts('/deals/7/transfers').length, 1, 'the transfer is saved once');
    assert.equal(v.posts('/closings/c1/lines/l1/evidence').length, 2);
    assert.ok(!v.has('closing-evidence-transfer-dialog'));
  } finally { await v.close(); }
});

for (const [code, status, message] of [
  ['open_conditions_block_transfer', 409, '1 open IC condition on this deal. Resolve it in the commit room before recording a transfer.'],
  ['transfer_gate_unreadable', 503, 'The deal’s IC conditions could not be read, so the transfer was not recorded. Try again in a moment.'],
  ['transfer_firm_required', 400, 'Choose the firm this transfer is recorded for.'],
  ['closing_line_not_found', 404, 'No line of an open closing on this deal has that id. Nothing was recorded.'],
  ['transfer_amount_invalid', 400, 'Record the amount in integer cents — the platform stores money as cents, never a float.'],
  ['admin_records_transfers', 403, 'An Admin records transfers. An Operating Partner ticks the closing checklist. Nothing was recorded.'],
]) {
  test(`the transfer route’s ${code} shows its sentence and keeps the dialog open, with nothing recorded on the line`, async () => {
    const v = await at(live({ 'POST /deals/7/transfers': refuse(code, message, status) }));
    try {
      await v.click('closing-line-receipt-btn-l1');
      await v.click('closing-receipt-record-transfer');
      await v.change('closing-evidence-transfer-amount', '5');
      await v.change('closing-evidence-transfer-phone', '', true);
      await v.click('closing-evidence-transfer-record');
      assert.equal(v.text('closing-evidence-transfer-error'), message);
      assert.ok(v.has('closing-evidence-transfer-dialog'));
      assert.ok(!v.has('closing-evidence-transfer-saved'), 'nothing was saved, so nothing says it was');
      assert.equal(v.posts('/closings/c1/lines/l1/evidence').length, 0);
    } finally { await v.close(); }
  });
}

test('a sent-only line reads Sent, not yet confirmed and says only receiving-side evidence makes it Received; withdraw needs a reason', async () => {
  const routes = live({ 'POST /closings/c1/evidence/e2/withdraw': refuse('evidence_withdrawn', 'This evidence is already withdrawn.', 409) });
  const v = await at(routes);
  try {
    await v.click('closing-line-receipt-btn-l2');
    assert.match(v.text('closing-receipt-status'), /Sent, not yet confirmed/);
    assert.match(v.text('closing-receipt-sent-only'), /Only receiving-side evidence makes it Received/);
    assert.equal(v.text('closing-evidence-by-e2'), 'Added by another Admin', 'never a name');
    await v.click('closing-evidence-withdraw-e2');
    await v.change('closing-evidence-withdraw-reason', 'too short');
    assert.match(v.text('closing-evidence-withdraw-count'), /^9 \/ 200 · 1 more character needed$/);
    assert.equal(v.props('closing-evidence-withdraw-confirm').disabled, true);
    await v.change('closing-evidence-withdraw-reason', '  Matched the wrong wire  ');
    assert.match(v.text('closing-evidence-withdraw-count'), /^22 \/ 200 · Enough$/);
    await v.click('closing-evidence-withdraw-confirm');
    assert.deepEqual(v.posts('/closings/c1/evidence/e2/withdraw').map((a) => a.body), [{ reason: 'Matched the wrong wire' }]);
    assert.equal(v.text('closing-evidence-withdraw-error'), 'This evidence is already withdrawn.');
    assert.ok(v.has('closing-evidence-withdraw-dialog'));
    routes['POST /closings/c1/evidence/e2/withdraw'] = () => { routes['/closings/c1'] = CLOSING({ lines: [L1, { ...L2, status: 'open', evidence: [{ ...L2.evidence[0], withdrawn_at: '2026-11-21T10:00:00Z', withdrawn_reason: 'Matched the wrong wire' }] }] }); return { ok: true }; };
    await v.click('closing-evidence-withdraw-confirm');
    assert.ok(!v.has('closing-evidence-withdraw-dialog'));
    assert.match(v.text('closing-evidence-e2'), /Withdrawn 21 Nov 2026: Matched the wrong wire/);
    assert.ok(!v.has('closing-evidence-withdraw-e2'), 'a withdrawn piece has no Withdraw');
    assert.match(v.text('closing-receipt-status'), /Waiting for money/, 'the status falls back to the read');
  } finally { await v.close(); }
});

test('an Admin the act table refuses sees the act’s sentence instead of live controls', async () => {
  const sentence = 'Your admin access is frozen. Nothing was recorded.';
  const v = await at(live({ '/fund-admin/access': { acts: [{ act: 'closing.evidence', allowed: false, sentence }] } }));
  try {
    await v.click('closing-line-receipt-btn-l2');
    assert.equal(v.text('closing-receipt-refused'), sentence);
    for (const id of ['closing-receipt-record-mercury', 'closing-receipt-record-transfer', 'closing-receipt-upload-bank', 'closing-evidence-withdraw-e2']) assert.ok(!v.has(id), id);
  } finally { await v.close(); }
});

test('Add a line: the live commitments with no line, the Worker’s refusal kept open, then a new row with no route', async () => {
  const routes = live({
    '/deals/7/commitments': [
      { id: 31, uid: 'c31', status: 'confirmed', investor_name: 'Fund I', amount: 400000 },
      { id: 33, uid: 'c33', status: 'pending', investor_name: 'Harbor Ventures', amount: 50000 },
      { id: 35, uid: 'c35', status: 'withdrawn', investor_name: 'Gone', amount: 1 },
    ],
    'POST /closings/c1/lines': refuse('amount_not_recorded', 'This commitment has no amount recorded in cents, so it cannot be a line.', 409),
  });
  const v = await at(routes);
  try {
    await v.click('closing-add-line-btn');
    const options = v.text('closing-add-line-commitment');
    assert.match(options, /Harbor Ventures/);
    assert.doesNotMatch(options, /Fund I|Gone/, 'a commitment with a line, and a dead one, are not offered');
    await v.change('closing-add-line-commitment', 'c33');
    await v.click('closing-add-line-confirm');
    assert.deepEqual(v.posts('/closings/c1/lines').map((a) => a.body), [{ commitment_uid: 'c33' }]);
    assert.equal(v.text('closing-add-line-error'), 'This commitment has no amount recorded in cents, so it cannot be a line.');
    assert.ok(v.has('closing-add-line-dialog'));
    routes['POST /closings/c1/lines'] = refuse('line_exists', 'That commitment or prospect already has a line on this closing.', 409);
    await v.change('closing-add-line-source-prospect', '');
    await v.change('closing-add-line-prospect', '12');
    await v.click('closing-add-line-confirm');
    assert.deepEqual(v.posts('/closings/c1/lines').at(-1).body, { prospect_id: 12 });
    assert.equal(v.text('closing-add-line-error'), 'That commitment or prospect already has a line on this closing.');
    routes['POST /closings/c1/lines'] = () => { routes['/closings/c1'] = CLOSING({ lines: [L1, L2, { uid: 'l3', commitment_id: 33, investor_name: 'Harbor Ventures', route: null, amount_cents: 5000000, currency: 'USD', status: 'open', evidence: [] }] }); return { uid: 'l3' }; };
    await v.click('closing-add-line-confirm');
    assert.ok(!v.has('closing-add-line-dialog'));
    assert.ok(v.has('closing-line-row-l3'));
    assert.match(v.text('closing-line-route-l3'), /No route chosen/);
  } finally { await v.close(); }
});

test('a failed commitments read blanks only the picker, with a retry; a closed closing shows no Add a line', async () => {
  const v = await at(live({ '/deals/7/commitments': new Error('down') }));
  try {
    await v.click('closing-add-line-btn');
    assert.match(v.text('closing-add-line-dialog'), /not a claim that it has none/);
    assert.ok(!v.has('closing-add-line-commitment'));
    await v.change('closing-add-line-source-prospect', '');
    assert.ok(v.has('closing-add-line-prospect'), 'the prospect path still works');
  } finally { await v.close(); }
  const w = await at({ ...BASE, '/closings/c1': CLOSING({ status: 'closed' }) });
  try {
    assert.ok(w.has('closing-detail'));
    assert.ok(!w.has('closing-add-line-btn'));
    assert.ok(!w.has('closing-line-receipt-btn-l1'));
  } finally { await w.close(); }
});

test('in the room an Admin’s drawer keeps its link, which now leads to a page that records evidence', async () => {
  const row = { investor: 'Fund I', amount: '$400,000.00', status: 'Waiting for money', evidence: [] };
  const v = await mount(h(ReceiptDrawer, { row, viewer: 'admin', dealId: 7, onClose() {} }), {});
  try {
    assert.ok(v.has('closing-receipt-desk-link'));
    assert.equal(v.props('closing-receipt-desk-link').href, '/admin/contracts/closings/7');
    assert.ok(!v.has('closing-receipt-record-mercury'), 'the room records nothing itself');
  } finally { await v.close(); }
  const w = await mount(h(ReceiptDrawer, { row, viewer: 'investor', dealId: 7, onClose() {} }), {});
  try {
    assert.ok(!w.has('closing-receipt-desk-link'));
  } finally { await w.close(); }
});

/* ------------------------------------------------------------------ *
 * Source
 * ------------------------------------------------------------------ */

test('the source: the admin page and its dialogs call addEvidence, withdrawEvidence and addLine; no other kind is sent', () => {
  const dialogs = read('frontend/src/pages/closing/EvidenceDialogs.jsx');
  const admin = read('frontend/src/pages/closing/AdminClosing.jsx');
  const drawer = read('frontend/src/pages/closing/RoomDialogs.jsx');
  assert.ok(dialogs.includes('closingsApi.addEvidence('));
  assert.ok(dialogs.includes('closingsApi.withdrawEvidence('));
  assert.ok(dialogs.includes('closingsApi.addLine('));
  assert.ok(dialogs.includes("adminMercuryApi.transactions({ direction: 'credit' })"));
  assert.ok(admin.includes('<AddLineDialog') && admin.includes('<ReceiptDrawer'));
  assert.doesNotMatch(dialogs + admin + drawer, /'(company_mercury|investor_mercury)'/, 'no control sends a company or investor Mercury kind');
  const fn = drawer.slice(drawer.indexOf('export function ReceiptDrawer'), drawer.indexOf('export function PaymentDrawer'));
  assert.match(fn, /viewer === 'admin' && !desk \? <Link/, 'the link shows only in the room, never with the admin page’s acts');
  const client = read('frontend/src/lib/api/closings.js');
  const worker = read('cloudflare-worker/src/routes/closings.ts');
  for (const r of ["r.post('/:uid/lines'", "r.post('/:uid/lines/:lineUid/evidence'", "r.post('/:uid/evidence/:evidenceUid/withdraw'"]) assert.ok(worker.includes(r), r);
  for (const m of ['addLine:', 'addEvidence:', 'withdrawEvidence:']) assert.ok(client.includes(m), m);
});
