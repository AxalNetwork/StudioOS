/**
 * D5305 (#5305) — HQ › Revenue › Billing exceptions: advisory refunds due,
 * drawn to the `HQ Advisory Refunds` canvas (boards RV16 to RV21).
 *
 * WHAT IS RENDERED. `BillingExceptions` with the advisory read in each state
 * it can be in (loading, answered, empty, never any rows, unreadable, hidden
 * from a viewer who is not a Super Admin), and the "Mark refunded…" sheet
 * mounted and driven: the reason floor, the draft's blanks, the 409, the 503
 * that keeps the reason, the authenticator refusal and the result.
 *
 * WHAT IS READ AS SOURCE. The page reads the list only for a Super Admin, and
 * passes the client module's own resolve to the sheet.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_advisory_refunds_5305.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { BillingExceptions, UNAVAILABLE } from '../src/pages/hq/RevenuePage.jsx';
import { MarkRefundedSheet } from '../src/pages/hq/revenue/AdvisoryRefundsDue.jsx';
import {
  HIDDEN, DRAFT_BLANK, amountOf, draftReason, reasonCheck, refundsDueView, resolveOutcome, withRefundsDue,
} from '../src/pages/hq/revenue/advisoryRefundsModel.js';

const h = React.createElement;
const PAGE = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/RevenuePage.jsx'), 'utf8'));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = (advisoryRefunds) => renderToStaticMarkup(h(MemoryRouter, null, h(BillingExceptions, {
  nowSec: 1_800_000_000, refunds: null, disputes: null, onRetryRefunds() {}, onRetryDisputes() {}, advisoryRefunds,
})));

const OPEN_EUR = { id: 41, booking_uid: 'bk_eur', booking_status: 'cancelled', payment_intent_id: 'pi_eur', amount_cents: 15000, currency: 'eur', created_at: '2026-11-12 08:00:00', resolved_at: null };
const OPEN_GBP = { id: 39, booking_uid: 'bk_gbp', booking_status: 'no_show', payment_intent_id: 'pi_gbp', amount_cents: 9000, currency: 'gbp', created_at: '2026-11-10 08:00:00', resolved_at: null };
const OPEN_NONE = { id: 36, booking_uid: 'bk_none', booking_status: 'cancelled', payment_intent_id: null, amount_cents: null, currency: null, created_at: '2026-11-08 08:00:00', resolved_at: null };
const DONE = { id: 30, booking_uid: 'bk_done', booking_status: 'no_show', payment_intent_id: 'pi_done', amount_cents: 7500, currency: 'eur', created_at: '2026-11-07 08:00:00', resolved_at: '2026-11-13 16:05:09', resolved_by: 801, resolved_by_name: 'Operator A', resolution_reason: 'Refunded in Stripe on 13 Nov, refund re_1.' };
const DONE_NONAME = { ...DONE, id: 29, booking_uid: 'bk_noname', resolved_by_name: null };
const READ = { items: [OPEN_EUR, OPEN_GBP, OPEN_NONE, DONE, DONE_NONAME], open: 3 };

test('D5305: the model splits open from resolved, counts as the route does, and never makes a missing amount 0', () => {
  const v = refundsDueView(READ);
  assert.deepEqual(v.open.map((r) => r.id), [41, 39, 36]);
  assert.deepEqual(v.resolved.map((r) => r.id), [30, 29]);
  assert.deepEqual(v.figure, { state: 'recorded', text: '3' });
  assert.equal(v.oldest, '2026-11-08');
  assert.equal(amountOf(OPEN_NONE), null, 'no amount is Not recorded, never 0');
  assert.equal(amountOf({ amount_cents: 500, currency: null }), null, 'an amount with no currency is not priced in a guessed one');
  assert.match(amountOf(OPEN_EUR), /150\.00/);
  assert.deepEqual(refundsDueView({ items: [], open: 0 }).figure, { state: 'zero', text: '0' });
  assert.equal(refundsDueView(HIDDEN), null);
  assert.equal(refundsDueView(UNAVAILABLE), null);
  const capped = refundsDueView({ items: Array.from({ length: 200 }, (_, i) => ({ ...OPEN_EUR, id: i + 1 })), open: 200 });
  assert.deepEqual(capped.figure, { state: 'incomplete', text: '200+' }, 'a full read of open rows is a floor');
});

test('D5305: a reason is 12 to 500 characters and never sent with a draft blank still in it', () => {
  assert.equal(reasonCheck('Refunded.').ok, false);
  assert.equal(reasonCheck(`  ${'x'.repeat(11)}  `).ok, false, 'trimmed before it is counted');
  assert.equal(reasonCheck('x'.repeat(501)).ok, false);
  assert.deepEqual(reasonCheck('  Refunded in Stripe, re_1.  '), { ok: true, reason: 'Refunded in Stripe, re_1.' });
  const draft = draftReason(OPEN_EUR);
  assert.match(draft, /bk_eur/);
  assert.match(draft, /pi_eur/);
  assert.match(draft, /150\.00/);
  assert.ok(draft.includes(DRAFT_BLANK), 'the refund id and date are left blank');
  assert.equal(reasonCheck(draft).ok, false, 'a draft with its blanks is refused');
  assert.match(reasonCheck(draft).message, /Fill the blanks/);
  assert.doesNotMatch(draftReason(OPEN_NONE), /undefined|null|NaN/);
});

test('D5305: each Worker refusal is its own end of the sheet', () => {
  assert.equal(resolveOutcome({ status: 409, code: 'already_resolved' }), 'already_resolved');
  assert.equal(resolveOutcome({ status: 404, code: 'not_found' }), 'not_found');
  assert.equal(resolveOutcome({ status: 400, code: 'reason_required' }), 'reason');
  assert.equal(resolveOutcome({ status: 403, code: 'step_up_required' }), 'step_up_cancelled');
  assert.equal(resolveOutcome({ status: 403, message: 'TOTP required' }), 'no_authenticator');
  assert.equal(resolveOutcome({ status: 403, message: 'Super admin required' }), 'refused');
  assert.equal(resolveOutcome({ status: 503, code: 'store_unavailable' }), 'not_saved');
  assert.equal(resolveOutcome(new Error('Failed to fetch')), 'unknown', 'no answer is never drawn as nothing changed');
});

test('D5305: Needs attention gains one line only when a row is open, after the critical items', () => {
  const items = [{ key: 'c', severity: 'critical' }, { key: 'w', severity: 'warning' }];
  const out = withRefundsDue(items, READ);
  assert.deepEqual(out.map((a) => a.key), ['c', 'advisory-refunds-due', 'w']);
  assert.equal(out[1].title, '3 advisory refunds due, oldest recorded 2026-11-08');
  assert.equal(out[1].action.href, '#revenue-advisory-refunds');
  assert.equal(withRefundsDue(items, { items: [DONE], open: 0 }), items, 'none open: no line');
  assert.equal(withRefundsDue(items, UNAVAILABLE), items, 'unreadable: no line, and never "0 due"');
  assert.equal(withRefundsDue(items, HIDDEN), items);
});

test('D5305: the block draws open rows, Not recorded for a missing value, and the resolved list with who, when and why', () => {
  const html = render(READ);
  const t = text(html);
  assert.match(t, /Advisory refunds due As of now/);
  assert.match(t, /Advisory refunds due As of now — A point in time; ignores the period\. 3 open · oldest 2026-11-08/, 'the tile');
  assert.match(html, /id="revenue-advisory-refunds"/);
  assert.match(t, /bk_eur/);
  assert.match(t, /Cancelled/);
  assert.match(t, /Missed/);
  assert.match(t, /£90\.00/);
  const openRow = html.match(/<tr data-refund-due="36">[\s\S]*?<\/tr>/)[0];
  assert.match(text(openRow), /Not recorded[\s\S]*Not recorded/, 'no Stripe payment and no amount each say Not recorded');
  assert.doesNotMatch(text(openRow), /[€£$]\s?0|0\.00/, 'never 0 for a missing amount');
  assert.match(t, /Resolved · 2 shown, most recently resolved first/);
  assert.match(t, /2026-11-13 16:05/);
  assert.match(t, /Operator A/);
  assert.match(t, /Refunded in Stripe on 13 Nov, refund re_1\./);
  const noName = html.match(/<tr data-refund-due="29">[\s\S]*?<\/tr>/)[0];
  assert.match(text(noName), /Not recorded/, 'a resolved row with no name says Not recorded');
  assert.match(t, /Marking a row moves no money and calls no provider/);
  assert.doesNotMatch(html, /dashboard\.stripe\.com/, 'the payment id does not link out (owner, option A)');
  assert.doesNotMatch(t, /\bTotal\b|€225\.00/, 'currencies are never added together, and no total row');
});

test('D5305: empty, never any rows, loading, unreadable and hidden are each their own state', () => {
  const empty = text(render({ items: [DONE], open: 0 }));
  assert.match(empty, /No charge on a cancelled or missed booking is owed back\./);
  assert.match(empty, /Resolved · 1 shown/);
  assert.match(empty, /Advisory refunds due As of now — A point in time; ignores the period\. 0 [^.]*Zero/, 'the tile reads 0 with the word Zero');

  const never = text(render({ items: [], open: 0 }));
  assert.match(never, /No charge on a cancelled or missed booking is owed back\./);
  assert.doesNotMatch(never, /Resolved ·/);

  const loading = render(null);
  assert.match(loading, /data-testid="hq-advisory-refunds-loading"/);
  assert.doesNotMatch(text(loading), /No charge on/);

  const failed = text(render(UNAVAILABLE));
  assert.match(failed, /Advisory refunds due could not be read\. This is not a claim that none are owed\./);
  assert.match(failed, /Advisory refunds due As of now — A point in time; ignores the period\. [^.]*Unavailable/);
  assert.match(failed, /never 0 owed/);
  assert.doesNotMatch(failed, /No charge on|0 open/);

  const hidden = render(HIDDEN);
  assert.doesNotMatch(hidden, /Advisory refunds due|revenue-advisory-refunds/, 'another admin sees no block and no tile');
  assert.doesNotMatch(render(undefined), /Advisory refunds due/, 'a host that passes no read draws nothing');
});

test('D5305: the page reads the list only for a Super Admin and hands the sheet the client resolve', () => {
  assert.match(PAGE, /isSuperAdminUser\(user\)/);
  assert.match(PAGE, /if \(!superAdmin\) \{ setAdvisoryRefunds\(HIDDEN\); return; \}/);
  assert.match(PAGE, /adminAdvisoryRefundsDueApi\.list\(\)/);
  assert.match(PAGE, /resolve=\{adminAdvisoryRefundsDueApi\.resolve\}/);
  assert.match(PAGE, /setAdvisoryRefunds\(UNAVAILABLE\)/, 'a failed read is Unavailable, never an empty list');
});

async function mountSheet(props) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(MarkRefundedSheet, { row: OPEN_EUR, operatorName: 'Operator A', onClose() {}, ...props }))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  const click = async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); };
  const type = async (value) => { const n = byId('hq-ard-reason'); assert.ok(n, 'no reason field'); await act(async () => { props_(n).onChange({ target: { value } }); }); await flush(); };
  return {
    click, type, has: (id) => Boolean(byId(id)), text: () => textOf(document.body), propsOf: (id) => props_(byId(id)),
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('D5305: the sheet refuses a short reason and a draft with blanks before anything is sent, then records it', async () => {
  const sent = [];
  let reloaded = 0;
  const s = await mountSheet({
    resolve: async (id, reason) => { sent.push([id, reason]); return { ok: true, id, resolved_at: '2026-11-14 10:42:07', moves_money: false }; },
    onResolved: () => { reloaded += 1; },
  });
  try {
    assert.match(s.text(), /Marking this moves no money\. Make the refund in Stripe first\./);
    await s.click('hq-ard-next');
    await s.type('Refunded.');
    await s.click('hq-ard-next');
    assert.ok(s.has('hq-ard-reason-error'), 'a short reason says so');
    assert.match(s.text(), /Say how this was refunded, in 12 to 500 characters\./);
    await s.click('hq-ard-draft');
    await s.click('hq-ard-next');
    assert.match(s.text(), /Fill the blanks from Stripe/);
    assert.ok(!s.has('hq-ard-submit'), 'still on the reason step');
    await s.type('Refunded in Stripe on 14 Nov, refund re_9.');
    await s.click('hq-ard-next');
    assert.equal(sent.length, 0, 'nothing is sent before Step-up');
    await s.click('hq-ard-submit');
    assert.deepEqual(sent, [[41, 'Refunded in Stripe on 14 Nov, refund re_9.']]);
    assert.equal(reloaded, 1, 'the list is read again');
    assert.match(s.text(), /Marked refunded by Operator A at 2026-11-14 10:42 UTC/);
    assert.match(s.text(), /No money moved/);
    assert.match(s.text(), /Counts it as refunded, not owed/);
  } finally { await s.close(); }
});

test('D5305: a 409 offers Refresh the list; a 503 keeps the reason and tries again; no authenticator says sign in again', async () => {
  const fail = (status, code, message = 'x') => Object.assign(new Error(message), { status, code });
  let refreshed = 0;
  const s409 = await mountSheet({
    resolve: async () => { throw fail(409, 'already_resolved'); }, onRefresh: () => { refreshed += 1; },
    initial: { step: 3, reason: 'Refunded in Stripe, re_1.' },
  });
  try {
    await s409.click('hq-ard-submit');
    assert.match(s409.text(), /Already resolved by someone else\. Nothing was changed\./);
    await s409.click('hq-ard-refresh');
    assert.equal(refreshed, 1);
  } finally { await s409.close(); }

  let calls = 0;
  const s503 = await mountSheet({
    resolve: async () => { calls += 1; if (calls === 1) throw fail(503, 'store_unavailable'); return { resolved_at: '2026-11-14 11:00:00' }; },
    initial: { step: 3, reason: 'Refunded in Stripe, re_2.' },
  });
  try {
    await s503.click('hq-ard-submit');
    assert.match(s503.text(), /Could not be saved with its audit record, so nothing was changed\./);
    assert.equal(s503.propsOf('hq-ard-reason').value, 'Refunded in Stripe, re_2.', 'the reason is kept');
    await s503.click('hq-ard-retry');
    assert.equal(calls, 2);
    assert.match(s503.text(), /Marked refunded by Operator A at 2026-11-14 11:00 UTC/);
  } finally { await s503.close(); }

  const sTotp = await mountSheet({
    resolve: async () => { throw fail(403, undefined, 'TOTP required'); },
    initial: { step: 3, reason: 'Refunded in Stripe, re_3.' },
  });
  try {
    await sTotp.click('hq-ard-submit');
    assert.match(sTotp.text(), /Sign in again with your authenticator to record this\. Nothing was changed\./);
    assert.ok(!sTotp.has('hq-ard-retry'), 'no retry that cannot pass');
  } finally { await sTotp.close(); }
});
