/**
 * D6261 (#6261) — after an investor's intro ask: the founder accepts or
 * declines it, the investor may withdraw it while it is unanswered, and an
 * accepted ask opens the existing Trust Center NDA step. Every status shown is
 * one the Worker writes, and nothing is posted without a click.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_ask_decisions_6261.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { investorAsksApi } from '../src/lib/api/investorAsks.js';
import { ASK_STATUS_LABEL, askStatusLabel, askStatusNote, withdrawnLine } from '../src/lib/investorIntroRequest.js';
import InvestorAskCard from '../src/pages/investor/InvestorAskCard.jsx';
import FounderInvestorAsks from '../src/pages/founder/FounderInvestorAsks.jsx';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const WORKER_STATUSES = JSON.parse(read('../../cloudflare-worker/src/services/introAskDecisions.ts')
  .match(/export const ASK_STATUSES = (\[[^\]]*\]) as const;/)[1].replace(/'/g, '"'));

/** Swap API methods for the length of one test, counting each call. */
function stub(target, methods) {
  const calls = Object.fromEntries(Object.keys(methods).map((k) => [k, []]));
  const saved = {};
  for (const [k, fn] of Object.entries(methods)) {
    saved[k] = target[k];
    target[k] = async (...args) => { calls[k].push(args); return fn(...args); };
  }
  return { calls, restore: () => Object.assign(target, saved) };
}
const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const buttons = (r, pattern) => r.nodes().filter((n) => n.tagName === 'BUTTON' && pattern.test(textOf(n)));
const card = (ask, props = {}) => createElement(InvestorAskCard, { ask, namesUnreadable: false, highlighted: false, age: () => '1d ago', ...props });
const ASK = { uid: 'ask-1', status: 'pending', quarter: '2026Q4', message: 'We back lab tools.', created_at: '2026-11-20 10:00:00', answerable: true, nda_founder_user_id: null, target: { kind: 'founder', name: 'Fay Founder', available: true } };

test('the page labels exactly the statuses the Worker writes, and nothing else as one of them', () => {
  assert.deepEqual(Object.keys(ASK_STATUS_LABEL).sort(), [...WORKER_STATUSES].sort());
  assert.equal(askStatusLabel('withdrawn'), 'Withdrawn');
  assert.equal(askStatusLabel('introduced'), 'Status not recognised');
  assert.equal(askStatusLabel(undefined), 'Status not recognised');
  assert.match(askStatusNote({ status: 'accepted' }), /Nothing is signed and no introduction has been made yet/);
  assert.match(askStatusNote({ status: 'pending', answerable: false }), /No founder account can answer this ask/);
  assert.match(withdrawnLine({ slot_returned: true }), /slot is back/);
  assert.match(withdrawnLine({ slot_returned: false }), /no slot comes back/);
});

test('a pending ask can be withdrawn with one click, which returns the slot and re-reads the list', async () => {
  const s = stub(investorAsksApi, { withdraw: () => ({ ok: true, status: 'withdrawn', slot_returned: true, used: 0, cap: 3, remaining: 3 }) });
  let withdrawn = null;
  const r = await mountContracts(card(ASK, { onWithdrawn: (x) => { withdrawn = x; } }), '/network/introductions');
  try {
    assert.match(r.text(), /Pending/);
    assert.match(r.text(), /Waiting for the founder to accept or decline/);
    assert.equal(s.calls.withdraw.length, 0, 'rendering withdrew the ask');
    assert.equal(buttons(r, /Start the mutual NDA/).length, 0);
    assert.equal(buttons(r, /Withdraw ask/).length, 1);
    await r.click('Withdraw ask');
    await r.flush();
    assert.deepEqual(s.calls.withdraw, [['ask-1']]);
    assert.equal(withdrawn?.remaining, 3);
    assert.match(r.text(), /Withdrawn\. Its slot is back in this quarter’s asks\./);
  } finally { await r.unmount(); s.restore(); }
});

test('a refused withdraw shows the route’s sentence and reports nothing withdrawn', async () => {
  const s = stub(investorAsksApi, { withdraw: () => { throw Object.assign(new Error('x'), { status: 409, data: { error: 'ask_already_answered', message: 'That ask is no longer pending (it is accepted). Reload your list.' } }); } });
  let withdrawn = false;
  const r = await mountContracts(card(ASK, { onWithdrawn: () => { withdrawn = true; } }), '/network/introductions');
  try {
    await r.click('Withdraw ask');
    await r.flush();
    assert.match(r.text(), /no longer pending \(it is accepted\)/);
    assert.equal(withdrawn, false);
  } finally { await r.unmount(); s.restore(); }
});

test('an accepted ask offers the NDA step, started only by the investor’s click', async () => {
  const s = stub(api, { trustIntroRequest: () => ({ status: 'envelope_issued', envelope_uuid: 'env-1' }) });
  const accepted = { ...ASK, status: 'accepted', decided_at: '2026-11-21 09:00:00', nda_founder_user_id: 3 };
  const r = await mountContracts(card(accepted), '/network/introductions');
  try {
    assert.match(r.text(), /Accepted/);
    assert.match(r.text(), /Next is the mutual NDA/);
    assert.equal(buttons(r, /Withdraw/).length, 0, 'an answered ask offered Withdraw');
    assert.equal(buttons(r, /Start the mutual NDA/).length, 1);
    assert.equal(s.calls.trustIntroRequest.length, 0);
    await r.click('Start the mutual NDA');
    await r.flush();
    assert.deepEqual(s.calls.trustIntroRequest, [[3]]);
    assert.match(r.text(), /The mutual NDA was sent for signature\./);
  } finally { await r.unmount(); s.restore(); }
});

test('a declined or withdrawn ask offers no action and says what happened', async () => {
  for (const [status, line] of [['declined', /The founder declined/], ['withdrawn', /You withdrew this ask before it was answered/]]) {
    const r = await mountContracts(card({ ...ASK, status, decided_at: '2026-11-21 09:00:00' }), '/network/introductions');
    try {
      assert.match(r.text(), line);
      assert.match(r.text(), new RegExp(ASK_STATUS_LABEL[status]));
      assert.equal(buttons(r, /./).length, 0, `${status} drew a button`);
    } finally { await r.unmount(); }
  }
});

test('the founder answers a pending ask with one click; an answered one has no buttons', async () => {
  const s = stub(investorAsksApi, {
    received: () => ({ asks: [
      { uid: 'ask-1', investor_name: 'Ian Investor', message: 'We back lab tools.', status: 'pending', created_at: '2026-11-20 10:00:00' },
      { uid: 'ask-2', investor_name: 'Ivy Investor', message: null, status: 'withdrawn', created_at: '2026-11-19 10:00:00', decided_at: '2026-11-19 12:00:00' },
    ] }),
    accept: () => ({ ok: true, status: 'accepted' }),
    decline: () => ({ ok: true, status: 'declined' }),
  });
  const r = await mountContracts(createElement(FounderInvestorAsks), '/network/introductions?intro=ask-1&kind=ask');
  try {
    await r.flush();
    const text = r.text();
    assert.match(text, /Ian Investor/);
    assert.match(text, /We back lab tools\./);
    assert.match(text, /The investor withdrew this ask before you answered/);
    assert.equal(s.calls.accept.length + s.calls.decline.length, 0, 'reading the list answered an ask');
    // Only the pending ask has answers: one Accept and one Decline, not two of each.
    const answers = () => buttons(r, /Accept|Decline/).length;
    assert.equal(answers(), 2);
    await r.click('Accept');
    await r.flush();
    assert.deepEqual(s.calls.accept, [['ask-1']]);
    assert.equal(s.calls.decline.length, 0);
    assert.match(r.text(), /Accepted\. The investor has been told\./);
    assert.equal(answers(), 0, 'an answered ask kept its buttons');
  } finally { await r.unmount(); s.restore(); }
});

test('an unreadable list of asks says so, never that nobody asked', async () => {
  const s = stub(investorAsksApi, { received: () => { throw new Error('503'); } });
  const r = await mountContracts(createElement(FounderInvestorAsks), '/network/introductions');
  try {
    await r.flush();
    assert.match(r.text(), /Investor asks addressed to you are unavailable right now\./);
    assert.doesNotMatch(r.text(), /No investor has asked/);
  } finally { await r.unmount(); s.restore(); }
});

test('the pages no longer say nothing moves an ask, and only a link naming the ask kind opens the Asked view', () => {
  const ws = read('../src/pages/investor/InvestorNetworkWorkspace.jsx');
  assert.doesNotMatch(ws, /nothing moves it yet/);
  assert.match(ws, /deepLink\.kind === 'ask' \? deepLink\.uid : ''/);
  assert.match(ws, /<InvestorAskCard /);
  const founder = read('../src/pages/founder/FounderNetworkIntroductions.jsx');
  assert.match(founder, /<FounderInvestorAsks \/>/);
  assert.doesNotMatch(founder, /does not request, offer, accept, decline/);
});
