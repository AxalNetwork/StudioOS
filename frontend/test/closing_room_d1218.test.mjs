// D1218 (#3215, part 5 of #2424) — the room complete (CP1, CP2, CP4, CP9–CP12,
// CP16–CP20), read from the closings store (D1215), D1216's staged paper,
// D1058's reporting desk and the investor's own Mercury proposals (D1217).
// An investor never sees another investor's line; no amount is drawn as 0;
// every change opens an in-page dialog; one failed block never blanks the room.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closing_room_d1218.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ClosingRoom from '../src/pages/closing/ClosingRoom.jsx';
import {
  NO_ACCESS, ROOM_FAILED, ROOM_WAITS, canEnter, captableView, dayOf, dutyRows, evidenceRows, matchesFor, needsYou, nextOnLine, paperPhrase,
  roomLines, roomTiles, signingRows, stepStrip,
} from '../src/pages/closing/roomModel.js';
import { CaptableDialog, PAY_WARNING } from '../src/pages/closing/RoomDialogs.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/* ------------------------------------------------------------------ *
 * Fixtures: one closing with four lines, as the founder reads it
 * ------------------------------------------------------------------ */

const stage = (position, role, state, extra = {}) => ({ position, role, name: extra.name ?? null, state, sent_at: extra.sent_at ?? null, signed_at: extra.signed_at ?? null });
const SIGNED = [{ uid: 's1', title: 'SAFE', complete: true, countersign: false, voided: false, stages: [stage(1, 'company', 'signed', { signed_at: '2026-10-09 10:00:00' }), stage(2, 'investor', 'signed', { signed_at: '2026-10-09 12:00:00' })] }];
const COMPANY_TURN = [{ uid: 's2', title: 'SAFE', complete: false, countersign: false, voided: false, stages: [stage(1, 'company', 'sent', { name: 'Ada Founder', sent_at: '2026-10-17 09:00:00' }), stage(2, 'investor', 'waiting', { name: 'Harbor Ventures' })] }];
const AXAL_WAIT = [{ uid: 's3', title: 'SAFE', complete: false, countersign: true, voided: false, stages: [stage(1, 'company', 'signed', { signed_at: '2026-10-15' }), stage(2, 'investor', 'signed', { signed_at: '2026-10-15' }), stage(3, 'axal', 'awaiting_release')] }];

const L1 = { uid: 'l1', commitment_id: 11, prospect_id: null, investor_name: 'Nora Angel', route: 'direct', amount_cents: 25000000, currency: 'USD', status: 'received', vehicle_ref: null, evidence: [
  { uid: 'e1', kind: 'investor_mercury', side: 'sending', created_at: '2026-10-14 17:20:00' },
  { uid: 'e2', kind: 'company_mercury', side: 'receiving', created_at: '2026-10-15 14:02:00' },
] };
const L2 = { uid: 'l2', commitment_id: 12, prospect_id: null, investor_name: 'Harbor Ventures', route: 'third_party_fund', amount_cents: 30000000, currency: 'USD', status: 'open', vehicle_ref: 'Harbor Ventures III', evidence: [] };
const L3 = { uid: 'l3', commitment_id: 13, prospect_id: null, investor_name: 'Fund I', route: 'axal_fund', amount_cents: null, currency: 'USD', status: 'open', vehicle_ref: 'fund:1', evidence: [] };
const L4 = { uid: 'l4', commitment_id: null, prospect_id: 4, investor_name: 'A prospect', route: null, amount_cents: 10000000, currency: 'USD', status: 'open', vehicle_ref: null, evidence: [] };
const CLOSING = (over = {}) => ({
  uid: 'c7', deal_id: 7, project_id: 5, round_label: 'Seed', instrument: 'Post-money SAFE', currency: 'USD', status: 'open', deadline: '2026-11-30',
  reach: 'all', total_cents: 65000000, line_count: 4, captable: { state: 'not_ready', decided_at: null }, lines: [L1, L2, L3, L4], events: [], closed_at: null, ...over,
});
const PAPERS = { l1: SIGNED, l2: COMPANY_TURN, l3: AXAL_WAIT };
const ENTRY = { uid: 'c7', deal_id: 7, project_id: 5, project_name: 'Acme Robotics', round_label: 'Seed', instrument: 'Post-money SAFE', status: 'open' };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('who acts next on each line, read from its route, paper, money and the cap-table proposal', () => {
  const c = CLOSING();
  const names = { company: 'Acme Robotics' };
  assert.deepEqual(nextOnLine(L2, COMPANY_TURN, c, 'founder', names), { text: 'Your turn: sign', you: true });
  assert.deepEqual(nextOnLine(L2, COMPANY_TURN, c, 'investor', names), { text: 'Waiting on Acme Robotics to sign', you: false });
  assert.equal(nextOnLine(L3, AXAL_WAIT, c, 'founder', names).text, 'Waiting on the Super Admin to countersign');
  assert.equal(nextOnLine(L4, undefined, c, 'founder', names).text, 'Waiting on the studio team to set the route');
  assert.equal(nextOnLine({ ...L4, route: 'direct' }, undefined, c, 'founder', names).text, 'Waiting on the studio team: a prospect line has no paper here');
  assert.equal(nextOnLine(L2, null, c, 'founder', names).text, 'The paper could not be read', 'a failed read is said, never guessed');
  assert.equal(nextOnLine(L2, [], c, 'founder', names).text, 'Waiting on the studio team to prepare the paper');
  assert.deepEqual(nextOnLine({ ...L2, status: 'open' }, SIGNED, c, 'investor', names), { text: 'Your turn: send the payment', you: true });
  assert.equal(nextOnLine({ ...L2, status: 'open' }, SIGNED, c, 'founder', names).text, 'Waiting on Harbor Ventures to send the payment');
  assert.equal(nextOnLine({ ...L2, status: 'sent' }, SIGNED, c, 'founder', names).text, 'Waiting on the studio team to confirm receipt');
  const proposed = CLOSING({ captable: { state: 'proposed' } });
  assert.deepEqual(nextOnLine(L1, SIGNED, proposed, 'founder', names), { text: 'Your turn: decide the cap table change', you: true });
  assert.equal(nextOnLine(L1, SIGNED, proposed, 'investor', names).text, 'Waiting on Acme Robotics to decide the cap table change');
  assert.equal(nextOnLine(L1, SIGNED, c, 'founder', names).text, 'Done');
  assert.equal(paperPhrase(L3, [{ ...AXAL_WAIT[0], complete: true }]), 'Countersigned');
  assert.equal(paperPhrase(L2, [{ ...SIGNED[0], voided: true }]), 'No paper sent', 'a void envelope is not the paper');
});

test('the strip and the tiles: Received sums received lines only, no amount is drawn as 0, and a failed paper read is never done', () => {
  const c = CLOSING();
  const steps = stepStrip(c, PAPERS);
  assert.deepEqual(steps.map((s) => s.state), ['now', 'next', 'next', 'next', 'next', 'next', 'next']);
  assert.equal(steps[0].text, '1 line without paper', 'the prospect line has no paper');
  assert.equal(steps[2].text, '1 line without a route');
  const t = roomTiles(c, PAPERS, new Date('2026-10-21T00:00:00Z'));
  assert.equal(t.committed, '$650,000.00');
  assert.equal(t.received, '$250,000.00', 'only the received line');
  assert.equal(t.receivedOf, '1 of 4 lines');
  assert.equal(t.signed, '1 of 4');
  assert.equal(t.deadline, '30 Nov 2026');
  assert.equal(t.left, 'in 40 days');
  const rows = roomLines(c, PAPERS, 'founder', { company: 'Acme Robotics' });
  assert.equal(rows.find((r) => r.uid === 'l3').amount, null, 'a missing amount is null, drawn Not recorded, never $0.00');
  const failed = { ...PAPERS, l2: null };
  assert.equal(roomTiles(c, failed).signed, null);
  assert.equal(roomTiles(c, failed).signedRead, 'failed');
  assert.deepEqual(stepStrip(c, failed).slice(0, 2).map((s) => [s.state, s.text]), [['unread', 'Not read here'], ['unread', 'Not read here']]);
  assert.equal(stepStrip(c, { l1: SIGNED }).at(0).text, 'Reading…', 'a read still running is Reading, not failed');
  assert.equal(roomTiles(c, { l1: SIGNED }).signedRead, 'reading');
  const done = CLOSING({ status: 'closed', closed_at: '2026-11-02T10:00:00Z', captable: { state: 'accepted', decided_at: '2026-11-01' }, lines: [{ ...L1 }] });
  assert.deepEqual(stepStrip(done, { l1: SIGNED }).map((s) => s.text), ['Done', 'Done', 'Done', 'Done', 'Done', 'Accepted', 'Closed 2 Nov 2026']);
  assert.ok(stepStrip(CLOSING({ lines: [] }), {}).every((s, i) => i > 4 || s.text === 'No line yet'));
});

test('needs you, the signing order, the evidence newest first, and the cap-table decision', () => {
  const rows = roomLines(CLOSING({ captable: { state: 'proposed' } }), PAPERS, 'founder', { company: 'Acme Robotics' });
  assert.deepEqual(needsYou(rows, CLOSING({ captable: { state: 'proposed' } }), 'founder').map((n) => n.key), ['l2', 'captable']);
  assert.deepEqual(needsYou(rows, CLOSING({ captable: { state: 'proposed', } , status: 'closed' }), 'founder').map((n) => n.key), ['l2']);
  const order = signingRows(COMPANY_TURN[0], 'founder');
  assert.deepEqual(order.map((r) => [r.position, r.state, r.yourTurn]), [[1, 'Your turn', true], [2, 'Waiting', false]]);
  assert.equal(order[0].role, 'The company · you');
  assert.equal(signingRows(SIGNED[0], 'founder')[0].yourTurn, false, 'a stage already signed is never the viewer’s turn');
  assert.deepEqual(signingRows(COMPANY_TURN[0], 'investor').map((r) => r.state), ['Sent for signature', 'Waiting']);
  assert.deepEqual(signingRows(AXAL_WAIT[0], 'investor').map((r) => r.state), ['Signed 15 Oct 2026', 'Signed 15 Oct 2026', 'Waiting for the Super Admin']);
  const ev = evidenceRows([...L1.evidence, { uid: 'e3', kind: 'bank_confirmation', side: 'receiving', created_at: '2026-10-16', withdrawn_at: '2026-10-17', withdrawn_reason: 'Wrong file attached' }]);
  assert.deepEqual(ev.map((e) => e.key), ['e3', 'e2', 'e1']);
  assert.deepEqual(ev.map((e) => e.side), ['Receiving side', 'Receiving side', 'Sending side']);
  assert.equal(ev[0].withdrawn, 'Withdrawn 17 Oct 2026: Wrong file attached');
  assert.equal(ev[2].words, 'Matched in the investor’s Mercury');
  assert.equal(captableView(CLOSING({ captable: { state: 'proposed' } }), 'founder').canDecide, true);
  for (const who of ['investor', 'admin']) assert.equal(captableView(CLOSING({ captable: { state: 'proposed' } }), who).canDecide, false, who);
  assert.equal(captableView(CLOSING({ captable: { state: 'proposed' }, status: 'closed' }), 'founder').canDecide, false);
  assert.equal(captableView(CLOSING(), 'founder').state, 'not_ready');
  assert.equal(dayOf('2026-10-09 10:00:00'), '9 Oct 2026');
  assert.equal(dayOf('soon'), null);
});

test('reporting keeps this closing’s lines; matches keep the investor’s own proposed ones; the room’s roles', () => {
  const desk = { duties: [
    { uid: 'd1', closing_line_uid: 'l1', title: 'Quarterly update', holder: { name: 'Nora Angel' }, source: { document: 'the side letter', clause: '3', signed: true }, defaulted: [] },
    { uid: 'd2', closing_line_uid: 'l2', title: 'Quarterly update', holder: { name: 'Harbor Ventures' }, source: {}, defaulted: ['due_days'] },
    { uid: 'd3', closing_line_uid: 'other', title: 'Monthly update', holder: { name: 'Someone else' }, source: {} },
    { uid: 'd4', closing_line_uid: null, title: 'Annual', source: {} },
  ] };
  const rows = dutyRows(desk, ['l1', 'l2']);
  assert.deepEqual(rows.map((r) => r.uid), ['d1', 'd2']);
  assert.equal(rows[0].from, 'From the side letter, clause 3');
  assert.equal(rows[1].defaulted, true);
  assert.equal(rows[1].from, 'Source not recorded');
  const props = [
    { uid: 'p1', state: 'proposed', target_kind: 'deal_commitment', target_id: 11, amount_cents: 25000000, posted_on: '2026-10-14', account_last_four: '7710' },
    { uid: 'p2', state: 'accepted', target_kind: 'deal_commitment', target_id: 11, amount_cents: 1 },
    { uid: 'p3', state: 'proposed', target_kind: 'deal_commitment', target_id: 99, amount_cents: 1 },
    { uid: 'p4', state: 'proposed', target_kind: 'capital_call', target_id: 11, amount_cents: 1 },
  ];
  assert.deepEqual(matchesFor(props, [L1]), [{ uid: 'p1', cents: 25000000, postedOn: '14 Oct 2026', lastFour: '7710' }]);
  assert.deepEqual(matchesFor(props, [{ ...L1, status: 'withdrawn' }]), [], 'a withdrawn line takes no match');
  assert.deepEqual(['founder', 'investor', 'admin', 'partner', 'explorer', 'advisor', undefined].map(canEnter), [true, true, true, true, false, false, false]);
  for (const [k, w] of Object.entries(ROOM_WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount({ role = 'founder', routes = {}, phone = false, deal = { id: 7, project_name: 'Acme Robotics', instrument: 'SAFE' } } = {}) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const asked = [];
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method });
    const hit = routes[`${method} ${path.split('?')[0]}`] ?? routes[path.split('?')[0]];
    const out = typeof hit === 'function' ? await hit(path, opts) : hit;
    if (out instanceof Error) return response({ detail: out.message }, Number(out.status) || 500);
    if (out && out.__pending) return new Promise(() => {});
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role, name: 'U' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, null, h(ClosingRoom, { dealId: 7, role, deal }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(document.body);
  const by = (id) => all().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    writes: () => asked.filter((a) => a.method !== 'GET'),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    clickText: async (label) => {
      const n = all().find((x) => String(x.tagName).toUpperCase() === 'BUTTON' && txt(x).replace(/\s+/g, ' ').trim() === label);
      assert.ok(n, `no button ${label}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush();
    },
    flush,
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, prev); localStorage.removeItem('user'); restore(); },
  };
}

const err = (status, message = 'down') => Object.assign(new Error(message), { status });
const FOUNDER_ROUTES = (over = {}) => ({
  '/closings': { closings: [ENTRY] },
  '/closings/c7': CLOSING(),
  '/legal/esign/staged/line/11': { envelopes: SIGNED },
  '/legal/esign/staged/line/12': { envelopes: COMPANY_TURN },
  '/legal/esign/staged/line/13': { envelopes: AXAL_WAIT },
  ...over,
});

test('mounted CP1: the founder’s room from the store — strip, tiles, lines with route, paper, money and next, and what needs them', async () => {
  const v = await mount({ routes: FOUNDER_ROUTES({ '/closings/c7': CLOSING({ captable: { state: 'not_ready' } }) }) });
  try {
    assert.match(v.text('closing-head'), /Raise › Capital relationships › Closing.*Closing · Acme Robotics Seed.*Post-money SAFE/);
    assert.equal(v.props('closing-step-1')['data-state'], 'now');
    assert.match(v.text('closing-tile-committed'), /\$650,000\.00.*4 lines/);
    assert.match(v.text('closing-tile-signed'), /1 of 4/);
    assert.match(v.text('closing-tile-received'), /\$250,000\.00.*1 of 4 lines/);
    assert.match(v.text('closing-line-l1'), /Nora Angel.*Direct.*\$250,000\.00.*Signed.*Received.*Done/);
    assert.match(v.text('closing-line-l2'), /Harbor Ventures.*Third-party fund.*\$300,000\.00.*Paper sent.*Waiting for money.*Your turn: sign/);
    assert.match(v.text('closing-line-l3'), /Fund I.*Axal VC fund.*Not recorded.*Waiting for Axal’s countersign.*Super Admin/);
    assert.doesNotMatch(v.text('closing-line-l3'), /\$0\.00/, 'a missing amount is never a zero');
    assert.match(v.text('closing-line-l4'), /A prospect.*No route set.*No paper for a prospect line/);
    assert.ok(!v.asked.some((a) => a.path.startsWith('/legal/esign/staged/line/null')), 'a prospect line reads no paper');
    assert.deepEqual(v.asked.filter((a) => a.path.startsWith('/legal/esign/staged/line/')).map((a) => a.path).sort(), ['/legal/esign/staged/line/11', '/legal/esign/staged/line/12', '/legal/esign/staged/line/13']);
    assert.match(v.text('closing-needs-you'), /Harbor Ventures: Your turn: sign/);
    assert.match(v.text('closing-account'), /Not read here yet.*#3214/);
    assert.match(v.text('closing-reporting'), /start when the closing is marked Closed/);
    assert.ok(!v.asked.some((a) => a.path.startsWith('/reporting')), 'no reporting read before Closed');
    assert.deepEqual(v.writes(), [], 'reading the room writes nothing');
  } finally { await v.close(); }
});

test('mounted CP4: Review and sign shows the order and whose turn it is, and the clause summary waits', async () => {
  const v = await mount({ routes: FOUNDER_ROUTES() });
  try {
    await v.click('closing-line-paper-l2');
    assert.ok(v.has('closing-sign'));
    assert.equal(v.props('closing-sign').role, 'dialog', 'D1317: Review and sign opens as the shared Sheet');
    assert.ok(v.props('closing-sign')['aria-labelledby']);
    assert.equal(v.props('closing-sign')['data-width'], 560);
    assert.match(v.text('closing-signer-1'), /Ada Founder.*The company · you.*Your turn/);
    assert.match(v.text('closing-signer-2'), /Harbor Ventures.*The investor.*Waiting/);
    assert.match(v.text('closing-sign-yours'), /sent to you on 17 Oct 2026.*e-sign page/);
    assert.match(v.text('closing-sign-clause'), /Not read here yet.*never gives advice/);
    assert.deepEqual(v.writes(), []);
  } finally { await v.close(); }
});

test('mounted CP10: the receipt drawer lists the evidence newest first, with its side, and an empty line says so', async () => {
  const v = await mount({ routes: FOUNDER_ROUTES() });
  try {
    await v.click('closing-line-money-l1');
    assert.match(v.text('closing-receipt-status'), /Received/);
    assert.match(v.text('closing-evidence-e2'), /Matched in the company’s Mercury.*15 Oct 2026.*Receiving side/);
    assert.match(v.text('closing-evidence-e1'), /Matched in the investor’s Mercury.*Sending side/);
    assert.equal(v.props('closing-receipt').role, 'dialog', 'D1317: the receipt opens as the shared Sheet');
    assert.ok(v.props('closing-receipt')['aria-labelledby']);
    assert.equal(v.props('closing-receipt')['data-width'], 560);
    const t = v.text('closing-receipt');
    assert.ok(t.indexOf('company’s Mercury 15 Oct') < t.indexOf('investor’s Mercury 14 Oct'), 'newest first');
  } finally { await v.close(); }
  const w = await mount({ routes: FOUNDER_ROUTES() });
  try { await w.click('closing-line-money-l2'); assert.match(w.text('closing-receipt-empty'), /No evidence recorded for this line yet\./); } finally { await w.close(); }
});

test('mounted CP11: the founder decides the cap-table change in a dialog, and nothing is written before the press', async () => {
  const posted = [];
  const routes = FOUNDER_ROUTES({
    '/closings/c7': CLOSING({ captable: { state: 'proposed' } }),
    'POST /closings/c7/captable/accept': (p) => { posted.push(p); return { ok: true }; },
    'POST /closings/c7/captable/dismiss': (p) => { posted.push(p); return { ok: true }; },
  });
  const v = await mount({ routes });
  try {
    assert.match(v.text('closing-needs-you'), /Decide the cap table change/);
    await v.click('closing-captable-open');
    assert.equal(v.props('closing-captable-dialog').role, 'dialog', 'D1317: the cap-table proposal opens as the shared Sheet');
    assert.ok(v.props('closing-captable-dialog')['aria-labelledby']);
    assert.equal(v.props('closing-captable-dialog')['data-width'], 640);
    assert.match(v.text('closing-captable-dialog'), /Add Nora Angel to the cap table\?.*Nora Angel · Post-money SAFE · \$250,000\.00/);
    assert.match(v.text('closing-captable-modelled'), /Not read here yet|before and after/);
    assert.deepEqual(v.writes(), [], 'opening the dialog writes nothing');
    await v.click('closing-captable-accept');
    assert.deepEqual(posted, ['/closings/c7/captable/accept']);
  } finally { await v.close(); }
  const refused = await mount({ routes: { ...routes, 'POST /closings/c7/captable/accept': () => err(409, 'The cap-table proposal is already decided.') } });
  try {
    await refused.click('closing-captable-open');
    await refused.click('closing-captable-accept');
    assert.match(refused.text('closing-captable-error'), /already decided/, 'a refusal is drawn as its own sentence');
  } finally { await refused.close(); }
  const investor = await mount({ role: 'investor', routes: { ...routes, '/closings': { closings: [{ ...ENTRY, reach: 'own' }] }, '/closings/c7': CLOSING({ reach: 'own', captable: { state: 'proposed' }, lines: [L1] }), '/mercury/investor/proposals': { proposals: [] } } });
  try {
    assert.match(investor.text('closing-captable'), /The founder decides the cap-table change\./);
    assert.ok(!investor.has('closing-captable-open'), 'only the founder decides');
  } finally { await investor.close(); }
});

test('mounted CP11: the dialog itself offers no decision to a viewer who cannot decide', async () => {
  const restore = installDocument();
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const c = CLOSING({ captable: { state: 'proposed' } });
  await act(async () => root.render(h(MemoryRouter, null, h(CaptableDialog, { closing: c, view: captableView(c, 'admin'), rows: roomLines(c, PAPERS, 'admin'), instrument: 'SAFE', onClose() {}, onDone() {} }))));
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const ids = walk(document.body).map((n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.['data-testid']).filter(Boolean);
  try {
    assert.ok(ids.includes('closing-captable-dialog'));
    assert.ok(!ids.includes('closing-captable-accept') && !ids.includes('closing-captable-dismiss'), 'no accept or dismiss for an Admin');
  } finally { await act(async () => root.unmount()); restore(); }
});

const INVESTOR_ROUTES = (over = {}) => ({
  '/closings': { closings: [{ ...ENTRY, reach: 'own' }] },
  '/closings/c7': CLOSING({ reach: 'own', lines: [{ ...L2, status: 'open' }] }),
  '/legal/esign/staged/line/12': { envelopes: SIGNED },
  '/mercury/investor/proposals': { proposals: [{ uid: 'p1', state: 'proposed', target_kind: 'deal_commitment', target_id: 12, amount_cents: 30000000, posted_on: '2026-10-14', account_last_four: '7710' }] },
  ...over,
});

test('mounted CP2: an investor sees their own line and the round’s total, never another investor’s line', async () => {
  const v = await mount({ role: 'investor', routes: INVESTOR_ROUTES() });
  try {
    assert.match(v.text('closing-head'), /Deals › Acme Robotics › Closing/);
    assert.match(v.text('closing-your-line'), /Your line · Third-party fund/);
    assert.match(v.text('closing-your-amount'), /\$300,000\.00/);
    assert.match(v.text('closing-your-paper'), /Signed/);
    assert.match(v.text('closing-your-money'), /Waiting for money/);
    assert.match(v.text('closing-round'), /Round: \$650,000\.00 committed.*Other investors in the round are not shown to you\./);
    for (const name of ['Nora Angel', 'Fund I', 'A prospect']) assert.ok(!v.text().includes(name), `${name} never shows to this investor`);
    for (const id of ['closing-tiles', 'closing-lines', 'closing-needs-you', 'closing-account']) assert.ok(!v.has(id), id);
    assert.ok(!v.asked.some((a) => /commitments|closing-checklist|transfers|reporting/.test(a.path)), 'no read of other lines, the checklist, the transfers or the desk');
    assert.match(v.text('closing-sent-word'), /accept a match from your Mercury/);
  } finally { await v.close(); }
});

test('mounted CP9: payment instructions open with the warning first, and say they are not read here yet', async () => {
  const v = await mount({ role: 'investor', routes: INVESTOR_ROUTES() });
  try {
    await v.click('closing-see-instructions');
    assert.equal(v.props('closing-pay').role, 'dialog', 'D1317: the payment instructions opens as the shared Sheet');
    assert.ok(v.props('closing-pay')['aria-labelledby']);
    assert.equal(v.props('closing-pay')['data-width'], 520);
    const t = v.text('closing-pay');
    assert.ok(t.indexOf(PAY_WARNING('Acme Robotics')) >= 0 && t.indexOf(PAY_WARNING('Acme Robotics')) < t.indexOf('Not read here yet'), 'the warning comes first');
    assert.match(v.text('closing-pay-wait'), /not mounted yet \(#3214\).*Nothing here tells you where to pay/);
    assert.doesNotMatch(t, /\d{6,}/, 'no account number is drawn');
    assert.deepEqual(v.writes(), []);
  } finally { await v.close(); }
});

test('mounted CP2, CP20: a match from the investor’s Mercury is accepted in a dialog, and records Sent, never Received', async () => {
  const posted = [];
  const v = await mount({ role: 'investor', routes: INVESTOR_ROUTES({ 'POST /mercury/investor/proposals/p1/accept': (p) => { posted.push(p); return { ok: true }; } }) });
  try {
    assert.match(v.text('closing-match-p1'), /A payment of \$300,000\.00 on 14 Oct 2026 from ••••7710 fits this commitment\./);
    await v.click('closing-match-open-p1');
    assert.match(v.text('closing-match-dialog'), /Sent, not yet confirmed.*Received when Acme Robotics ?’s bank confirms it/);
    assert.deepEqual(v.writes(), []);
    await v.click('closing-match-accept');
    assert.deepEqual(posted, ['/mercury/investor/proposals/p1/accept']);
  } finally { await v.close(); }
});

test('mounted CP18: one failed block never blanks the room', async () => {
  const paper = await mount({ routes: FOUNDER_ROUTES({ '/legal/esign/staged/line/12': err(503) }) });
  try {
    assert.match(paper.text('closing-line-l2'), /Could not be read.*The paper could not be read/);
    assert.match(paper.text('closing-tile-signed'), /Not recorded/);
    assert.ok(paper.has('closing-papers-failed'));
    assert.match(paper.text('closing-line-l1'), /Signed.*Received/, 'the other lines still draw');
  } finally { await paper.close(); }
  const merc = await mount({ role: 'investor', routes: INVESTOR_ROUTES({ '/mercury/investor/proposals': err(503) }) });
  try {
    assert.match(merc.text('closing-mercury'), /Your Mercury could not be read.*never shown as zero/);
    assert.ok(merc.has('closing-your-line'), 'the line still draws');
  } finally { await merc.close(); }
  const room = await mount({ routes: FOUNDER_ROUTES({ '/closings/c7': err(503) }) });
  try {
    assert.match(room.text('closing-room-failed'), new RegExp(`${ROOM_FAILED.title}.*${ROOM_FAILED.claim}.*Try again`));
  } finally { await room.close(); }
  const list = await mount({ routes: { '/closings': err(503), '/deals/7/commitments': [], '/deals/7/closing-checklist': { checklist: null } } });
  try {
    assert.match(list.text('closing-record-unread'), /closing record could not be read/);
    assert.ok(list.has('closing-lines'), 'the deal’s room still draws');
  } finally { await list.close(); }
});

test('mounted CP12: after Closed, the founder’s reporting duties for this closing’s lines', async () => {
  const closed = CLOSING({ status: 'closed', closed_at: '2026-11-02T10:00:00Z', captable: { state: 'accepted', decided_at: '2026-11-01' } });
  const desk = { duties: [
    { uid: 'd1', closing_line_uid: 'l1', title: 'Quarterly update', holder: { name: 'Nora Angel' }, source: { document: 'the side letter', clause: '3' }, defaulted: [] },
    { uid: 'd2', closing_line_uid: 'l2', title: 'Quarterly update', holder: { name: 'Harbor Ventures' }, source: {}, defaulted: ['due_days'] },
    { uid: 'd9', closing_line_uid: 'zz', title: 'Monthly update', holder: { name: 'Another round' }, source: {} },
  ] };
  const v = await mount({ routes: FOUNDER_ROUTES({ '/closings/c7': closed, '/reporting/desk': desk }) });
  try {
    assert.ok(v.asked.some((a) => a.path === '/reporting/desk?project=5'));
    assert.match(v.text('closing-duty-d1'), /Nora Angel.*Quarterly update.*From the side letter, clause 3/);
    assert.match(v.text('closing-duty-d2'), /Default, not in the paper/);
    assert.ok(!v.has('closing-duty-d9'), 'another closing’s duty is not this one');
    assert.equal(v.props('closing-step-7')['data-state'], 'done');
  } finally { await v.close(); }
  const failed = await mount({ routes: FOUNDER_ROUTES({ '/closings/c7': closed, '/reporting/desk': err(503) }) });
  try { assert.match(failed.text('closing-reporting'), /could not be read.*not a claim that there are none/); } finally { await failed.close(); }
});

test('mounted CP16, CP17: a room with no lines says so; while it reads, the header and the steps draw at once', async () => {
  const empty = await mount({ routes: FOUNDER_ROUTES({ '/closings/c7': CLOSING({ lines: [], total_cents: 0, line_count: 0 }) }) });
  try {
    assert.match(empty.text('closing-lines'), /No commitment on this deal yet\..*Lines appear here when an investor commits in the deal room\./);
  } finally { await empty.close(); }
  const loading = await mount({ routes: FOUNDER_ROUTES({ '/closings/c7': { __pending: true } }) });
  try {
    assert.match(loading.text('closing-head'), /Closing · Acme Robotics Seed/);
    assert.ok(loading.has('closing-steps') && loading.has('closing-room-loading'));
  } finally { await loading.close(); }
  const none = await mount({ routes: { '/closings': { closings: [] }, '/deals/7/commitments': [], '/deals/7/closing-checklist': { checklist: null } } });
  try { assert.match(none.text('closing-record-none'), /has not opened this deal’s closing yet/); } finally { await none.close(); }
});

test('mounted CP19: an Explorer or Advisor meets the card and no read is made; another investor’s closing reads as not theirs; an Operating Partner reads only', async () => {
  for (const role of ['explorer', 'advisor']) {
    const v = await mount({ role, routes: FOUNDER_ROUTES() });
    try {
      assert.match(v.text('closing-no-access'), new RegExp(NO_ACCESS.role));
      assert.equal(v.asked.length, 0, `${role}: no read`);
    } finally { await v.close(); }
  }
  const other = await mount({ role: 'investor', routes: { '/closings': { closings: [{ ...ENTRY, reach: 'own' }] }, '/closings/c7': err(404, 'No closing here.') } });
  try { assert.match(other.text('closing-no-access'), new RegExp(NO_ACCESS.line)); } finally { await other.close(); }
  const partner = await mount({ role: 'partner', routes: { '/deals/7/commitments': { total: 1 }, '/deals/7/closing-checklist': { checklist: null }, '/deals/7/transfers': { items: [] } } });
  try {
    assert.match(partner.text('closing-partner-note'), /Read only.*Money steps are the studio team’s/);
    assert.ok(!partner.asked.some((a) => a.path.startsWith('/closings')), 'an Operating Partner reads no closing record');
  } finally { await partner.close(); }
});

test('mounted CP20: on a phone, the investor’s room is one column, the step is one line, and actions run the full width', async () => {
  const v = await mount({ role: 'investor', phone: true, routes: INVESTOR_ROUTES() });
  try {
    assert.match(v.text('closing-steps'), /^Step 4 of 7 · Pay · 1 line not sent$/);
    assert.match(v.props('closing-review-sign').className, /w-full/);
    assert.match(v.props('closing-see-instructions').className, /min-h-\[48px\] w-full/);
    assert.match(v.props('closing-match-open-p1').className, /w-full/);
  } finally { await v.close(); }
  const f = await mount({ phone: true, routes: FOUNDER_ROUTES() });
  try {
    assert.ok(f.has('closing-line-card-l2') && !f.has('closing-line-l2'), 'a card per line, not the table');
  } finally { await f.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: no browser pop-up, every read is a mounted route, light classes carry their dark pair, and the docs', () => {
  const files = ['ClosingRoom.jsx', 'RecordRoom.jsx', 'RoomDialogs.jsx', 'roomModel.js'].map((f) => read(`frontend/src/pages/closing/${f}`));
  for (const src of files) assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(|\b(confirm|alert|prompt)\(/, 'never a browser pop-up');
  const worker = read('cloudflare-worker/src/index.ts');
  assert.match(worker, /app\.route\('\/api\/closings', closings\)/);
  assert.match(worker, /app\.route\('\/api\/reporting', reporting\)/);
  assert.match(read('cloudflare-worker/src/routes/esign.ts'), /esign\.get\('\/staged\/line\/:commitmentId'/);
  assert.match(read('cloudflare-worker/src/routes/mercury_investor.ts'), /app\.post\('\/proposals\/:uid\/accept'/);
  assert.doesNotMatch(worker, /company_receiving_accounts/, 'the receiving-account route is still unmounted, so the room says so (D1218 §4)');
  for (const src of files.slice(0, 3)) {
    for (const m of src.matchAll(/className="([^"]+)"/g)) {
      const c = m[1];
      if (/\bbg-white\b/.test(c)) assert.match(c, /dark:bg-/, c);
      if (/\bborder-gray-(100|200|300)\b/.test(c)) assert.match(c, /dark:border-/, c);
    }
  }
  const doc = read('documentation/architecture/decisions/D1218.md');
  assert.match(doc, /UNVERIFIED/);
  assert.match(read('frontend/src/pages/closing/README.md'), /RecordRoom\.jsx/);
});
