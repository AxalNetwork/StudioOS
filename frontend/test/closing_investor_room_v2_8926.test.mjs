// D8926 (#8926) — the investor's closing room built to the #6188 v2 canvas
// (`design/incoming/Deals v2 Terms and Closing Room Page.dc.html`, DE35 to
// DE41): the header, the seven steps with the one that is now, the line card,
// the paper with who signs next, the deadline, the firm's committee
// conditions, the two sides of the evidence, the one primary action by step,
// the payment sheet's change notice and Mask now, after Closed, no closing
// opened yet, the states, and the phone. The earlier behaviour keeps its own
// files (closing_room_d1218, closing_investor_room_6199, closing_sign_actions_6197).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closing_investor_room_v2_8926.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ClosingRoom from '../src/pages/closing/ClosingRoom.jsx';
import { roomLines, stepStrip } from '../src/pages/closing/roomModel.js';
import {
  ROOM_WORDS, accountChange, commitmentFacts, conditionsView, evidenceSides, investorNow, investorStepText, lineChip, paperView, phoneStep, roomChip, roomSub, roomTitle, routeLine,
} from '../src/pages/closing/investorRoomModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});

/* ------------------------------------------------------------------ *
 * Fixtures: one investor's own line on a sample company's seed round
 * ------------------------------------------------------------------ */

const stage = (position, role, state, extra = {}) => ({ position, role, name: null, state, sent_at: '2026-11-08', signed_at: null, ...extra });
const MY_TURN = [{ uid: 's1', title: 'SAFE', complete: false, countersign: false, voided: false,
  stages: [stage(1, 'investor', 'sent', { name: 'Sample Ventures' }), stage(2, 'company', 'waiting', { name: 'Founder A' }), stage(3, 'axal', 'waiting')] }];
const SIGNED = [{ uid: 's1', title: 'SAFE', complete: true, countersign: false, voided: false,
  stages: [stage(1, 'investor', 'signed', { signed_at: '2026-11-14' }), stage(2, 'company', 'signed', { signed_at: '2026-11-14' })] }];
const MINE = { uid: 'l2', commitment_id: 12, prospect_id: null, investor_name: 'Sample Ventures', route: 'direct', amount_cents: 10000000, currency: 'USD', status: 'open', vehicle_ref: null, evidence: [] };
const PART = { project_uid: 'proj-sample', conditions: { waiting_on_you: [{ line_uid: 'l2', step: 'sign' }], rest: { your_lines: 0, other_lines: 2, round: 1 }, rest_count: 3 }, summary: [], reporting: { state: 'not_closed', duties: [] } };
const CLOSING = (over = {}) => ({
  uid: 'c7', deal_id: 7, project_id: 5, round_label: 'Seed', instrument: 'SAFE', currency: 'USD', status: 'open', deadline: '2026-12-20', created_at: '2026-11-08 10:00:00',
  reach: 'own', total_cents: 72000000, line_count: 4, captable: { state: 'not_ready', decided_at: null }, lines: [MINE], events: null, closed_at: null, for_investor: PART, ...over,
});
const ENTRY = { uid: 'c7', deal_id: 7, project_id: 5, project_name: 'Sample Robotics', round_label: 'Seed', instrument: 'SAFE', status: 'open', reach: 'own' };
const CONDITIONS = { items: [
  { uid: 'k1', deal_id: 7, decision_title: 'Sample Ventures · decision of 10 Nov 2026', body: 'Confirm the option pool top-up is inside the cap', status: 'open', created_at: '2026-11-10 09:00:00', resolved_at: null },
  { uid: 'k2', deal_id: 7, decision_title: 'Sample Ventures · decision of 10 Nov 2026', body: 'Reference calls with two pilot customers', status: 'met', created_at: '2026-11-10', resolved_at: '2026-11-12 12:00:00' },
  { uid: 'k3', deal_id: 7, decision_title: 'Sample Ventures · decision of 10 Nov 2026', body: 'Information rights side letter', status: 'waived', created_at: '2026-11-10', resolved_at: '2026-11-12' },
  { uid: 'k9', deal_id: 9, decision_title: 'Another deal', body: 'Not this deal', status: 'open', created_at: '2026-11-01', resolved_at: null },
] };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the header: the closing’s chip, the title with its round, and the line under it', () => {
  // Mutation checked: Closed without its day; "round" doubled on a label that already ends in it; the opened day dropped.
  assert.deepEqual(roomChip(CLOSING()), { kind: 'open', glyph: null, text: 'Closing · Open' });
  assert.equal(roomChip(CLOSING({ status: 'closed', closed_at: '2026-12-04T10:00:00Z' })).text, 'Closed 4 Dec 2026');
  assert.equal(roomChip(CLOSING({ status: 'cancelled' })).text, 'Cancelled');
  assert.equal(roomChip({ status: 'other' }).text, 'Status not recorded');
  assert.equal(roomTitle('Sample Robotics', 'Seed'), 'Sample Robotics · Seed round');
  assert.equal(roomTitle('Sample Robotics', 'Seed round'), 'Sample Robotics · Seed round');
  assert.equal(roomTitle('Sample Robotics', null), 'Sample Robotics · Closing');
  assert.equal(roomSub(CLOSING(), 'SAFE'), 'SAFE · round $720,000.00 · opened by the studio on 8 Nov 2026 · your line only');
  assert.equal(roomSub(CLOSING({ created_at: null, total_cents: null }), null), 'opened by the studio · your line only', 'no guessed day, no zero total');
});

test('the one primary action by step (DE35b): sign on the investor’s turn, pay once signed, the bank’s wait once Sent', () => {
  // Mutation checked: sign offered when another party signs next; pay offered on a Sent line; the wait given an action of its own.
  const at = (line, papers) => {
    const c = CLOSING({ lines: [line] });
    const [row] = roomLines(c, papers, 'investor');
    return investorNow(c, stepStrip(c, papers), row, 'SAFE');
  };
  const sign = at(MINE, { l2: MY_TURN });
  assert.deepEqual([sign.key, sign.lead, sign.text, sign.action], ['sign', 'Sign is now.', 'Your signature is next on your SAFE.', 'sign']);
  const companyTurn = [{ ...MY_TURN[0], stages: [stage(1, 'company', 'sent'), stage(2, 'investor', 'waiting')] }];
  assert.equal(at(MINE, { l2: companyTurn }).action, null, 'another party signs next: no primary for the investor');
  const pay = at(MINE, { l2: SIGNED });
  assert.deepEqual([pay.key, pay.lead, pay.action], ['pay', 'Pay is now.', 'pay']);
  const sent = at({ ...MINE, status: 'sent' }, { l2: SIGNED });
  assert.deepEqual([sent.key, sent.lead, sent.action], ['receipt', 'Receipt is now.', 'wait']);
  const c = CLOSING({ status: 'closed', closed_at: '2026-12-04' });
  assert.deepEqual(investorNow(c, [], null, null), { key: 'closed', lead: 'Closed on 4 Dec 2026.', text: '', action: null });
  assert.equal(investorNow(CLOSING({ status: 'cancelled' }), [], null, null).text, ROOM_WORDS.cancelled);
  assert.equal(investorNow(CLOSING(), [], null, null).text, ROOM_WORDS.withdrawnLine, 'no live line of theirs: withdrawn, nothing owed');
});

test('the steps in the investor’s words, and the phone’s one line', () => {
  const steps = [{ name: 'Paper', state: 'done', text: 'Done' }, { name: 'Sign', state: 'now', text: '1 line not signed' }, { name: 'Route', state: 'next', text: '1 line without a route' }];
  assert.equal(investorStepText(steps[1], { key: 'sign' }, 1), 'Your signature is next');
  assert.equal(investorStepText(steps[2], { key: 'sign' }, 1), 'Your line without a route');
  assert.equal(investorStepText(steps[2], { key: 'sign' }, 2), '1 line without a route', 'two lines of theirs keep the count');
  assert.equal(phoneStep(steps), 'Step 2 of 3 · Sign');
  assert.equal(phoneStep([{ name: 'Paper', state: 'done' }, { name: 'Reporting', state: 'done' }]), 'Step 2 of 2 · Reporting');
  assert.equal(phoneStep([{ name: 'Paper', state: 'unread', text: 'Reading…' }]), 'Steps · Reading…');
});

test('the paper: signers in order, who signs next, and honest when unread or absent', () => {
  // Mutation checked: nextWho "you" dropped; the signed count counted Waiting; a failed read drawn as no paper.
  const v = paperView(MINE, MY_TURN, 'Sample Ventures');
  assert.equal(v.title, 'SAFE · Sample Ventures');
  assert.deepEqual(v.signers.map((s) => [s.position, s.who, s.state]), [[1, 'Sample Ventures', 'Your turn'], [2, 'Founder A', 'Waiting'], [3, 'Axal countersign', 'Waiting']]);
  assert.equal(v.signedOf, '0 of 3 signed');
  assert.equal(v.nextWho, 'you');
  assert.equal(v.yourTurn, true);
  const done = paperView(MINE, SIGNED, null);
  assert.deepEqual([done.signedOf, done.complete, done.nextWho], ['2 of 2 signed', true, null]);
  assert.equal(paperView(MINE, null).state, 'unreadable');
  assert.equal(paperView(MINE, undefined).state, 'reading');
  assert.equal(paperView(MINE, []).state, 'none');
  assert.equal(paperView({ ...MINE, commitment_id: null }, SIGNED).state, 'none');
});

test('the committee conditions: this deal’s only, counted, each with its day; every read state kept apart', () => {
  // Mutation checked: the deal filter dropped (k9 shows); a missing list drawn as none; a 403 drawn as unreadable.
  const v = conditionsView({ status: 'ok', data: CONDITIONS }, 7);
  assert.equal(v.state, 'ok');
  assert.deepEqual(v.rows.map((r) => [r.uid, r.word, r.since]), [['k1', 'Open', 'Open since 10 Nov 2026'], ['k2', 'Met', 'Met 12 Nov 2026'], ['k3', 'Waived', 'Waived 12 Nov 2026']]);
  assert.equal(v.counts, '1 open · 1 met · 1 waived');
  assert.equal(v.title, 'Sample Ventures · decision of 10 Nov 2026');
  assert.equal(conditionsView({ status: 'ok', data: { items: [] } }, 7).state, 'none');
  assert.equal(conditionsView({ status: 'ok', data: {} }, 7).state, 'unreadable', 'no list is a failed read, never none');
  assert.equal(conditionsView({ status: 'error', error: { status: 503 } }, 7).state, 'unreadable');
  assert.equal(conditionsView({ status: 'error', error: { status: 403 } }, 7).state, 'refused');
  assert.equal(conditionsView({ status: 'loading' }, 7).state, 'reading');
});

test('the evidence: the receiving side and the sending side kept apart; withdrawn evidence left out; a declaration is the sending side', () => {
  // Mutation checked: sending evidence counted on the receiving side; withdrawn evidence kept; the declaration ignored.
  const line = { evidence: [
    { uid: 'e1', kind: 'investor_mercury', side: 'sending', created_at: '2026-11-14 10:00:00' },
    { uid: 'e2', kind: 'company_mercury', side: 'receiving', created_at: '2026-11-20', withdrawn_at: '2026-11-21', withdrawn_reason: 'wrong line' },
  ] };
  const s = evidenceSides(line, null);
  assert.deepEqual(s.receiving, { state: 'none' }, 'withdrawn receiving evidence does not make the line Received');
  assert.deepEqual(s.sending, { state: 'ok', words: 'Matched in the investor’s Mercury', at: '14 Nov 2026' });
  const r = evidenceSides({ evidence: [{ uid: 'e3', kind: 'company_mercury', side: 'receiving', created_at: '2026-12-02' }] }, null);
  assert.deepEqual([r.receiving.state, r.receiving.at, r.sending.state], ['ok', '2 Dec 2026', 'none']);
  const d = evidenceSides({ evidence: [] }, { amount: '$100,000.00', sentOn: '2026-11-14' });
  assert.deepEqual(d.sending, { state: 'ok', words: 'You recorded that you sent $100,000.00', at: '14 Nov 2026' });
  assert.equal(d.receiving.state, 'none');
});

test('the line chip, the route line, the commitment before a closing, and the account change notice', () => {
  assert.deepEqual(['open', 'sent', 'received', 'withdrawn', 'x'].map((s) => lineChip(s).word), ['Open', 'Sent', 'Received', 'Withdrawn', 'Not recorded']);
  assert.equal(routeLine('direct'), 'Direct · set by the studio');
  assert.equal(routeLine(null), null);
  assert.deepEqual(commitmentFacts([{ amount: 100000, status: 'pending', investor_name: 'Sample Ventures', created_at: '2026-11-04' }]),
    { amount: '$100,000', word: 'Pending', heldFor: 'Sample Ventures', recorded: '4 Nov 2026', more: 0 });
  assert.equal(commitmentFacts([{ amount: 5, status: 'withdrawn' }]), null, 'a withdrawn commitment is no commitment');
  assert.equal(commitmentFacts(null), null);
  assert.equal(commitmentFacts([{ amount: null, status: 'confirmed' }]).amount, null, 'no amount stays null, never 0');
  // Mutation checked: the first account (revision 1) announced as a change.
  assert.equal(accountChange({ revision: 1, created_at: '2026-11-13' }), null);
  assert.equal(accountChange({ revision: 2, created_at: '2026-11-13T09:00:00Z' }).title, 'The company changed its receiving account on 13 Nov 2026.');
  assert.equal(accountChange({}), null);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount({ routes = {}, phone = false } = {}) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const asked = [];
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    asked.push(`${opts.method || 'GET'} ${path}`);
    const hit = routes[path.split('?')[0]];
    if (hit instanceof Error) return response({ detail: hit.message }, Number(hit.status) || 500);
    return response(hit ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'investor', name: 'U' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(MemoryRouter, null, h(ClosingRoom, { dealId: 7, role: 'investor', deal: { id: 7, project_name: 'Sample Robotics', instrument: 'SAFE' } }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(document.body);
  const by = (id) => all().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    primaries: () => all().filter((n) => ['BUTTON', 'A'].includes(String(n.tagName).toUpperCase()) && /\bbg-axal-violet\b/.test(pr(n).className || '')).map((n) => pr(n)['data-testid']),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { fetch: prev.fetch, matchMedia: prev.matchMedia });
      localStorage.removeItem('user'); restore();
    },
  };
}

const err = (status, message = 'down') => Object.assign(new Error(message), { status });
const ROUTES = (closing, envelopes, over = {}) => ({
  '/closings': { closings: [ENTRY] },
  '/closings/c7': closing,
  '/legal/esign/staged/line/12': { envelopes },
  '/mercury/investor/proposals': { proposals: [] },
  '/ic/conditions': CONDITIONS,
  ...over,
});

test('mounted DE35, Sign is now: the header, the steps, the line, the paper with Review and sign as the one primary, the deadline, the conditions and the evidence', async () => {
  // Mutation checked: a second primary (the pay band) drawn while Sign is now; another deal's condition drawn; aria-current dropped.
  const v = await mount({ routes: ROUTES(CLOSING(), MY_TURN) });
  try {
    assert.match(v.text('closing-head'), /^‹ Back to the deal Your closing room Sample Robotics · Seed round Closing · Open SAFE · round \$720,000\.00 · opened by the studio on 8 Nov 2026 · your line only$/);
    assert.equal(v.props('closing-back').href, '/deals/7');
    assert.equal(v.props('closing-step-2')['aria-current'], 'step');
    assert.match(v.text('closing-step-2'), /Sign Now · Your signature is next/);
    assert.equal(v.props('closing-step-1')['data-state'], 'done');
    assert.match(v.text('closing-why'), /^Sign is now\. Your signature is next on your SAFE\. Nothing on this page moves money\.$/);
    assert.match(v.text('closing-your-line'), /Your line ○ Open \$100,000\.00 Route Direct · set by the studio Held for Sample Ventures/);
    assert.match(v.text('closing-your-signers'), /Sample Ventures The investor · you Your turn.*Founder A The company Waiting.*Axal countersign Super Admin Waiting/);
    assert.match(v.text('closing-your-paper'), /Sent · awaiting signature 0 of 3 signed/, 'the lifecycle pill carries the signed count');
    assert.equal(v.text('closing-review-sign'), 'Review and sign');
    assert.deepEqual(v.primaries(), ['closing-review-sign'], 'one primary action');
    assert.ok(!v.has('closing-see-instructions') && !v.has('closing-action'), 'no pay band before the paper is signed');
    assert.match(v.text('closing-your-deadline'), /^Deadline 20 Dec 2026 (in \d+ days?|\d+ days? past) Set by the studio on this closing\.$/);
    assert.match(v.text('closing-conditions-counts'), /^1 open · 1 met · 1 waived$/);
    assert.match(v.text('closing-condition-k1'), /Confirm the option pool top-up is inside the cap ○ Open Open since 10 Nov 2026/);
    assert.ok(!v.has('closing-condition-k9'), 'a condition on another deal is not this room’s');
    assert.match(v.text('closing-evidence-receiving'), /Receiving side · the company’s bank None Nothing recorded by the company’s bank yet\./);
    assert.match(v.text('closing-evidence-sending'), /Sending side · you None/);
    await v.click('closing-review-sign');
    assert.ok(v.has('closing-sign'), 'Review and sign opens the signing order');
  } finally { await v.close(); }
});

test('mounted DE35b, Pay is now: See payment instructions is the one primary; the paper offers its signed copy; the sheet says when the account changed and masks on demand', async () => {
  // Mutation checked: the change notice drawn for the first account; Mask now left the number shown.
  const ACCOUNT = { uid: 'a1', revision: 2, created_at: '2026-11-13T09:00:00Z', payee_name: 'Sample Robotics, Inc.', bank_name: 'First Bank', account_number: '••••3392', routing_number: '021000021', swift_code: null, currency: 'USD', payment_reference: 'SAMPLE-SEED' };
  const routes = ROUTES(CLOSING(), SIGNED, {
    '/closings/company-receiving-accounts/5': { recorded: true, account: ACCOUNT },
    '/deals/7/commitments': [{ id: 12, uid: 'k-12' }],
    '/closings/company-receiving-accounts/5/reveal': { account: { ...ACCOUNT, account_number: '000020483392' }, expires_in_seconds: 30 },
  });
  const v = await mount({ routes });
  try {
    assert.match(v.text('closing-why'), /^Pay is now\. Your line is signed; it is not sent yet\./);
    assert.deepEqual(v.primaries(), ['closing-see-instructions']);
    assert.equal(v.text('closing-review-sign'), 'Open the signed paper');
    assert.match(v.text('closing-action'), /Pay from your own bank\. Before you do, read the instructions and the warning\./);
    await v.click('closing-see-instructions');
    assert.match(v.text('closing-pay'), /Your line · \$100,000\.00 · Direct/);
    assert.match(v.text('closing-pay-changed'), /^The company changed its receiving account on 13 Nov 2026\. Call the company on a number you already hold before you pay\./);
    await v.click('closing-pay-reveal');
    await v.click('closing-pay-reveal-confirm');
    assert.equal(v.text('closing-pay-full'), '000020483392');
    await v.click('closing-pay-mask');
    assert.ok(!v.has('closing-pay-full'), 'Mask now masks it again');
    assert.match(v.text('closing-pay-account'), /••••3392/);
  } finally { await v.close(); }
  const first = await mount({ routes: ROUTES(CLOSING(), SIGNED, { '/closings/company-receiving-accounts/5': { recorded: true, account: { ...ACCOUNT, revision: 1 } } }) });
  try {
    await first.click('closing-see-instructions');
    assert.ok(!first.has('closing-pay-changed'), 'the first account is not a change');
  } finally { await first.close(); }
});

test('mounted DE36c, Sent: the wait for the company’s bank is a status, disabled with its reason; the sending side shows the investor’s match', async () => {
  // Mutation checked: the wait drawn as a live button; the sending evidence drawn on the receiving side.
  const sent = CLOSING({ lines: [{ ...MINE, status: 'sent', evidence: [{ uid: 'e1', kind: 'investor_mercury', side: 'sending', created_at: '2026-11-14' }] }] });
  const v = await mount({ routes: ROUTES(sent, SIGNED) });
  try {
    assert.match(v.text('closing-why'), /^Receipt is now\. You said you sent it\. The company’s bank has not confirmed it yet\./);
    assert.equal(v.props('closing-waiting-bank')['aria-disabled'], 'true');
    assert.match(v.text('closing-action'), /No action: the company’s bank confirms receipt\. Waiting for the company’s bank/);
    assert.match(v.text('closing-your-line-chip'), /↗ Sent/);
    assert.match(v.text('closing-evidence-sending'), /Matched in the investor’s Mercury ↗ Recorded 14 Nov 2026 Your word: it makes your line Sent, not Received\./);
    assert.match(v.text('closing-evidence-receiving'), /None/);
  } finally { await v.close(); }
});

test('mounted DE39: the conditions read failing costs that block alone; a refused read says Refused; the rest of the room still shows', async () => {
  const v = await mount({ routes: ROUTES(CLOSING(), MY_TURN, { '/ic/conditions': err(503) }) });
  try {
    assert.match(v.text('closing-conditions'), /Unavailable Your firm’s committee conditions could not be read\. The rest of the closing room still shows\. Retry/);
    assert.ok(v.has('closing-your-line') && v.has('closing-your-paper') && v.has('closing-evidence-sides'));
  } finally { await v.close(); }
  const r = await mount({ routes: ROUTES(CLOSING(), MY_TURN, { '/ic/conditions': err(403, 'Forbidden') }) });
  try { assert.match(r.text('closing-conditions'), /Refused/); assert.doesNotMatch(r.text('closing-conditions'), /could not be read/); } finally { await r.close(); }
  const none = await mount({ routes: ROUTES(CLOSING(), MY_TURN, { '/ic/conditions': { items: [] } }) });
  try { assert.match(none.text('closing-conditions-none'), /No committee condition is recorded/); } finally { await none.close(); }
});

test('mounted DE39: a withdrawn line owes nothing, and a cancelled closing says so in its chip and sentence', async () => {
  const w = await mount({ routes: ROUTES(CLOSING({ lines: [{ ...MINE, status: 'withdrawn' }] }), MY_TURN) });
  try {
    assert.match(w.text('closing-your-line-chip'), /✕ Withdrawn/);
    assert.match(w.text('closing-your-withdrawn'), /Nothing is owed on it\./);
    assert.deepEqual(w.primaries(), [], 'nothing to do on a withdrawn line');
  } finally { await w.close(); }
  const c = await mount({ routes: ROUTES(CLOSING({ status: 'cancelled' }), MY_TURN) });
  try {
    assert.match(c.text('closing-status'), /✕ Cancelled/);
    assert.match(c.text('closing-why'), /Cancelled\. The studio cancelled this closing\. No line will be received on it\./);
    assert.ok(!c.has('closing-your-deadline'), 'no deadline on a cancelled closing');
  } finally { await c.close(); }
});

test('mounted DE37, after Closed: the chip with its day, every step done, the receipt day, what you hold, and Open in Portfolio as the one primary', async () => {
  // Mutation checked: the receipt day left out of the sentence; the cap-table card drawn after Closed.
  const closed = CLOSING({
    status: 'closed', closed_at: '2026-12-04T10:00:00Z', captable: { state: 'accepted', decided_at: '2026-12-03' },
    lines: [{ ...MINE, status: 'received', evidence: [{ uid: 'e3', kind: 'company_mercury', side: 'receiving', created_at: '2026-12-02' }] }],
    for_investor: { ...PART, summary: [{ line_uid: 'l2', amount_cents: 10000000, currency: 'USD', signed_at: '2026-11-14', received_at: '2026-12-02', signed_copy: { envelope_id: 55 } }], reporting: { state: 'ok', duties: [] } },
  });
  const v = await mount({ routes: ROUTES(closed, SIGNED) });
  try {
    assert.match(v.text('closing-status'), /✓ Closed 4 Dec 2026/);
    for (let i = 1; i <= 7; i += 1) assert.equal(v.props(`closing-step-${i}`)['data-state'], 'done', `step ${i}`);
    assert.match(v.text('closing-why'), /^Closed on 4 Dec 2026\. Your line was received on the company’s side on 2 Dec 2026\./);
    assert.match(v.text('closing-your-summary'), /What you hold Instrument SAFE/);
    assert.match(v.text('closing-evidence-receiving'), /Matched in the company’s Mercury ✓ Recorded 2 Dec 2026 The only side that makes your line Received\./);
    assert.deepEqual(v.primaries(), ['closing-portfolio-link']);
    assert.ok(!v.has('closing-captable') && !v.has('closing-conditions'), 'the open closing’s blocks are gone');
  } finally { await v.close(); }
});

test('mounted DE38: before a closing is opened, the investor’s own commitment and Back to Investment; with none, Refused; a failed record read says so', async () => {
  // Mutation checked: the round's lines drawn for the investor; no commitment drawn as an empty dl; a failed read drawn as Not opened.
  const routes = (over) => ({ '/closings': { closings: [] }, '/deals/7/commitments': [{ id: 12, amount: 100000, status: 'pending', investor_name: 'Sample Ventures', created_at: '2026-11-04' }], ...over });
  const v = await mount({ routes: routes() });
  try {
    assert.match(v.text('closing-head'), /Sample Robotics · Closing Not opened SAFE · your line only/);
    assert.match(v.text('closing-not-opened'), /The studio has not opened the closing for this deal yet\. When it does, your paper, your line and the steps to Closed appear here\./);
    assert.match(v.text('closing-commitment'), /^Your commitment \$100,000 ◔ Pending Held for Sample Ventures Recorded 4 Nov 2026$/);
    assert.equal(v.props('closing-back-investment').href, '/deals/7/commitment');
    assert.deepEqual(v.primaries(), ['closing-back-investment']);
    assert.ok(!v.asked.some((a) => /closing-checklist|transfers/.test(a)), 'no read of the round');
  } finally { await v.close(); }
  const none = await mount({ routes: routes({ '/deals/7/commitments': [] }) });
  try {
    assert.match(none.text('closing-no-commitment'), /Refused · no commitment You have no commitment on this deal\./);
    assert.ok(!none.has('closing-back-investment'));
  } finally { await none.close(); }
  const failed = await mount({ routes: routes({ '/closings': err(503) }) });
  try {
    assert.match(failed.text('closing-record-unread'), /This closing could not be read\. That is not the same as there being nothing to close\. Try again Your commitment \$100,000/);
    assert.ok(!failed.has('closing-record-none'));
  } finally { await failed.close(); }
});

test('mounted DE40a, phone: the step card, the paper without its own button, the one primary in the sticky foot, and the conditions and evidence as rows to open', async () => {
  // Mutation checked: the paper’s Review and sign kept on the phone beside the sticky one; the fold open by default.
  const v = await mount({ phone: true, routes: ROUTES(CLOSING(), MY_TURN) });
  try {
    assert.match(v.text('closing-steps'), /^Step 2 of 7 · Sign Your signature is next on your SAFE\.$/);
    assert.match(v.text('closing-sticky'), /Who signs next: you Review and sign/);
    assert.deepEqual(v.primaries(), ['closing-review-sign'], 'one Review and sign, in the sticky foot');
    assert.match(v.props('closing-review-sign').className, /min-h-\[48px\] w-full/);
    assert.equal(v.props('closing-conditions-toggle')['aria-expanded'], false);
    assert.match(v.text('closing-conditions-toggle'), /Committee conditions 1 open/);
    assert.ok(!v.has('closing-condition-k1'));
    await v.click('closing-conditions-toggle');
    assert.ok(v.has('closing-condition-k1'), 'the row opens the conditions');
    assert.match(v.text('closing-evidence-sides-toggle'), /Evidence None yet/);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the conditions read is mounted, light classes carry their dark pair, the decision file and the route-map row', () => {
  assert.match(read('cloudflare-worker/src/routes/ic.ts'), /r\.get\('\/conditions'/);
  assert.match(read('frontend/src/lib/api.js'), /icConditions: \(status\) => request\(`\/ic\/conditions/);
  for (const f of ['InvestorRoom.jsx', 'roomShared.jsx']) {
    const src = read(`frontend/src/pages/closing/${f}`);
    for (const m of src.matchAll(/className=\{?[`"]([^`"]+)[`"]/g)) {
      if (/\bbg-white\b/.test(m[1])) assert.match(m[1], /dark:bg-/, m[1]);
      if (/\bborder-gray-(100|200|300)\b/.test(m[1])) assert.match(m[1], /dark:border-/, m[1]);
      if (/\btext-(gray|red|amber|violet)-[5-9]00\b/.test(m[1])) assert.match(m[1], /dark:text-/, m[1]);
    }
    assert.doesNotMatch(src, /\b(window\.)?(confirm|alert|prompt)\(/, 'never a browser pop-up');
  }
  assert.match(read('frontend/src/pages/closing/RecordRoom.jsx'), /viewer === 'investor' \? <InvestorRoom /);
  assert.match(read('documentation/architecture/decisions/D8926.md'), /^## D8926 — .+ \(#8926\)/m);
  const row = read('documentation/architecture/route-map/canvases/part-1/0180-closing-room.md');
  assert.match(row, /Deals v2 Terms and Closing Room canvas landed 2026-11-14 \(D6188, #6188\), built \(D8926, #8926\)/);
});
