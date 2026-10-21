/**
 * D752 (#1989): "Match to my Mercury" on committed raise prospects and on deal
 * commitments, reusing #1848's match screen.
 *   · only the founder sees the doors: the deal's own founder on its
 *     commitments, a founder on Capital relationships;
 *   · an investor's view of a commitment shows its status only;
 *   · withdraw needs a reason of 10 characters;
 *   · the screen says amounts are USD and that the counterparty is not checked;
 *   · the credit import prints the `raise_receipt` refusal and the "This may be
 *     an investment" hint;
 *   · #1848's targets keep their words (mercury_match_screens_d713 stays green).
 * Names, amounts and ids are invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_raise_match_d752.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import { MercuryMatchView, RAISE_MATCH_NOTE, RAISE_TARGETS, UNMATCHABLE_TEXT, WITHDRAW_REASON_MIN, unmatchableText } from '../src/components/MercuryMatch.jsx';
import RaiseReceiptMatches, { RAISE_PANEL_LEAD, RaiseReceiptsView, raiseTargetsOf } from '../src/components/RaiseReceiptMatches.jsx';
import { MercuryCreditImportView } from '../src/components/spinout/MercuryCreditImport.jsx';
import { CommitmentsTab, COMMITMENT_MATCH_STATUSES, isDealFounder } from '../src/pages/DealRoomPage.jsx';
import { FITS_RAISE_TARGET, FITS_RAISE_TARGET_NOTE, mercuryCreditReason } from '../src/lib/revenueLedger.js';
import { USE_WORDS } from '../src/pages/account/mercuryModel.js';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const noop = new Proxy({}, { get: () => () => {} });

const TX = '33333333-3333-4333-8333-333333333333';
const LINE = { transaction_id: TX, posted_on: '2026-10-02', amount_cents: 25000000, last_four: '0042', counterparty_name: 'Example Holdings Trust' };
const item = (id, over = {}) => ({
  target_kind: 'raise_prospect', target_id: id, label: `Investor ${id} · Venture`, state: 'committed', amount_cents: 25000000,
  direction: 'credit', window: { from: '2026-09-01', to: '2026-10-19' }, matchable: true, unmatchable: null, candidates: [LINE], ...over,
});
const MATCH = { uid: 'm-1', target_id: 8, state: 'confirmed', posted_on: '2026-10-02', last_four: '0042' };
const READ = { target_kind: 'raise_prospect', items: [item(7), item(8, { candidates: [] }), item(9, { matchable: false, unmatchable: 'amount_not_whole_cents', amount_cents: 0, candidates: [] })], matches: [MATCH], lines_read: 4, capped: false };
const view = (target, read, extra = {}) => ssr(h(MercuryMatchView, { target, state: { read, busy: false, err: '', reason: '', ...extra }, on: noop }));

// ─────────────────────────────────────────────────────────── who sees the doors

test('the deal\'s founder only: an investor, an admin, a partner or another founder is never offered the match', () => {
  const deal = { id: 3, project_founder_id: 41 };
  assert.equal(isDealFounder('founder', { founder_id: 41 }, deal), true);
  assert.equal(isDealFounder('founder', { founder_id: '41' }, { project_founder_id: 41 }), true);
  assert.equal(isDealFounder('founder', { founder_id: 42 }, deal), false, 'another founder');
  for (const role of ['investor', 'admin', 'partner', null]) assert.equal(isDealFounder(role, { founder_id: 41 }, deal), false, String(role));
  assert.equal(isDealFounder('founder', { founder_id: null }, { project_founder_id: null }), false, 'two missing ids are not a match');
  assert.equal(isDealFounder('founder', {}, deal), false);
  assert.equal(isDealFounder('founder', { founder_id: 41 }, {}), false);
  assert.deepEqual([...COMMITMENT_MATCH_STATUSES], ['pending', 'confirmed']);
});

test('Capital relationships: the panel is drawn for a founder only, with the Mercury logo, and reads nothing until pressed', () => {
  for (const role of ['investor', 'admin', 'partner', null]) assert.equal(ssr(h(RaiseReceiptMatches, { role, api: noop })), '', String(role));
  const html = ssr(h(RaiseReceiptMatches, { role: 'founder', api: noop }));
  assert.match(html, /data-brand="mark"[\s\S]*data-provider="mercury"/);
  assert.match(html, /data-testid="raise-match-open"[^>]*>Match to my Mercury</);
  assert.ok(text(html).includes(RAISE_PANEL_LEAD));
  assert.doesNotMatch(html, /raise-match-list|raise-match-loading/);
});

async function commitments(rows, founderMatch) {
  const was = api.dealCommitments;
  api.dealCommitments = async () => rows;
  try {
    const v = await mountContracts(h(CommitmentsTab, { dealId: 3, founderMatch }), '/deals/3');
    try { await v.flush(); await v.flush(); return { text: v.text(), buttons: v.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => v.props(n)['data-testid']) }; }
    finally { await v.unmount(); }
  } finally { api.dealCommitments = was; }
}
const ROWS = [
  { id: 11, investor_name: 'Investor A', amount: 250000, status: 'pending' },
  { id: 12, investor_name: 'Investor B', amount: 100000, status: 'confirmed' },
  { id: 13, investor_name: 'Investor C', amount: 50000, status: 'rejected' },
];

test('the deal room: an investor\'s view of a commitment shows the status only', async () => {
  const seen = await commitments(ROWS, false);
  assert.match(seen.text, /pending/);
  assert.match(seen.text, /confirmed/);
  assert.doesNotMatch(seen.text, /Mercury|Received|••/);
  assert.deepEqual(seen.buttons, []);
});

test('the deal room: the founder gets the door on a pending commitment, and on a confirmed one to withdraw, never on another', async () => {
  const seen = await commitments(ROWS, true);
  assert.deepEqual(seen.buttons, ['mercury-match-open-commitment-11', 'mercury-match-open-commitment-12']);
  assert.match(seen.text, /Match to my Mercury/);
  assert.match(seen.text, /Change the Mercury match/);
});

test('the deal room passes the founder test, and keeps the commitments read unchanged', () => {
  const src = codeOnly(readFileSync('frontend/src/pages/DealRoomPage.jsx', 'utf8'));
  // The tab also carries D752 #1890's admin proof props; only the founder test is pinned here.
  assert.match(src, /<CommitmentsTab [^>]*dealId=\{deal\.id\}[^>]* founderMatch=\{isDealFounder\(role, user, deal\)\} \/>/);
  assert.match(src, /\{founderMatch && COMMITMENT_MATCH_STATUSES\.includes\(c\.status\) && \(/);
  assert.match(src, /api\.dealCommitments\(dealId\)\.then\(setItems\)/);
});

// ─────────────────────────────────────────────────────────── the match screen for raise targets

test('withdraw asks for a reason of at least 10 characters', () => {
  assert.equal(WITHDRAW_REASON_MIN, 10);
  const ok = { status: 'ok', item: item(8), match: MATCH };
  assert.match(view('raise', ok, { reason: '123456789' }), /disabled=""[^>]*data-testid="mercury-match-withdraw-button"/);
  assert.match(view('raise', ok, { reason: '  12345678  ' }), /disabled=""[^>]*data-testid="mercury-match-withdraw-button"/, 'trimmed');
  assert.doesNotMatch(view('raise', ok, { reason: '1234567890' }), /disabled=""[^>]*data-testid="mercury-match-withdraw-button"/);
  assert.match(view('commitment', ok, { reason: '1234567890' }), /Withdraw it only if that line does not pay this commitment\./);
});

test('a raise target: amounts are USD, the counterparty is shown and not checked, and the line can be confirmed', () => {
  const html = view('raise', { status: 'ok', item: item(7), match: null });
  assert.ok(text(html).includes(RAISE_MATCH_NOTE));
  assert.match(RAISE_MATCH_NOTE, /US dollars/);
  assert.match(RAISE_MATCH_NOTE, /shown but not checked/);
  assert.ok(text(html).includes('Example Holdings Trust'), 'the counterparty is shown');
  assert.match(html, new RegExp(`data-testid="mercury-confirm-${TX}"`));
  assert.ok(text(view('commitment', { status: 'ok', item: item(7), match: null })).includes(RAISE_MATCH_NOTE));
  assert.deepEqual([...RAISE_TARGETS], ['raise', 'commitment']);
  const empty = text(view('raise', { status: 'ok', item: item(8, { candidates: [] }), match: null }));
  assert.match(empty, /No credit in your Mercury account fits this commitment yet\./);
  assert.doesNotMatch(empty, /counterparty must/, 'the counterparty is never a condition for a raise target');
  assert.match(text(view('raise', { status: 'ok', item: null, match: null })), /no longer committed or pending/);
});

test('a target the Worker lists as not matchable says why and offers no line', () => {
  const html = view('raise', { status: 'ok', item: item(9, { matchable: false, unmatchable: 'amount_missing', candidates: [LINE] }), match: null });
  assert.ok(text(html).includes(UNMATCHABLE_TEXT.amount_missing));
  assert.doesNotMatch(html, /mercury-confirm-/);
  assert.equal(unmatchableText('amount_not_whole_cents'), UNMATCHABLE_TEXT.amount_not_whole_cents);
  assert.match(unmatchableText('toString'), /cannot be matched/, 'a prototype key is not a reason');
});

test('#1848\'s targets keep their words: no USD note, the counterparty still a condition, the invoice sentence', () => {
  const inv = text(view('invoice', { status: 'ok', item: item(7, { target_kind: 'engagement_invoice', candidates: [] }), match: null }));
  assert.doesNotMatch(inv, /US dollars\. The counterparty/);
  assert.match(inv, /No line in your Mercury account fits this invoice yet\. The amount, the dates and the counterparty must all fit\./);
  assert.match(text(view('payout', { status: 'ok', item: null, match: null })), /This payout is not open to a match: it is not yours, not issued, or not in US dollars\./);
  assert.match(view('settlement', { status: 'ok', item: item(7, { matchable: false, unmatchable: 'amount_missing' }), match: null }), /data-testid="mercury-match-candidates"/, 'the not-matchable branch is the raise targets\' only');
});

// ─────────────────────────────────────────────────────────── the Capital relationships panel

test('the panel lists each committed prospect with its own match and says when there is none', () => {
  const ts = raiseTargetsOf(READ);
  assert.deepEqual(ts.map((t) => [t.id, t.label, t.amount, !!t.item, t.match?.uid ?? null]), [
    [7, 'Investor 7 · Venture', '$250,000', true, null], [8, 'Investor 8 · Venture', '$250,000', true, 'm-1'], [9, 'Investor 9 · Venture', '$0', true, null],
  ]);
  const html = ssr(h(RaiseReceiptsView, { read: { status: 'ok', data: READ }, busy: null, err: null, reasons: {}, on: noop }));
  assert.equal(html.split(RAISE_MATCH_NOTE.replace(/'/g, '&#x27;')).length - 1, 1, 'the USD note with the one prospect that offers lines');
  assert.match(html, /data-testid="raise-match-7"[\s\S]*mercury-confirm-/);
  assert.match(html, /data-testid="raise-match-8"[\s\S]*mercury-match-withdraw/);
  assert.ok(text(html).includes(UNMATCHABLE_TEXT.amount_not_whole_cents));
  const none = ssr(h(RaiseReceiptsView, { read: { status: 'ok', data: { items: [], matches: [] } }, busy: null, err: null, reasons: {}, on: noop }));
  assert.match(none, /No prospect in your raise pipeline is at Committed/);
  const down = text(ssr(h(RaiseReceiptsView, { read: { status: 'failed', outcome: { kind: 'unreadable' } }, busy: null, err: null, reasons: {}, on: noop })));
  assert.match(down, /This is not a claim that no line pays this commitment\./);
});

test('mounted: one read on press; confirm names the raise target and line; withdraw sends the trimmed reason; the module re-reads', async () => {
  const calls = [];
  let changed = 0;
  const fake = {
    matches: async (t) => { calls.push(['matches', t]); return READ; },
    confirm: async (b) => { calls.push(['confirm', b]); return { ok: true }; },
    withdraw: async (uid, reason) => { calls.push(['withdraw', uid, reason]); return { ok: true }; },
  };
  const v = await mountContracts(h(RaiseReceiptMatches, { role: 'founder', api: fake, onChanged: () => { changed += 1; } }), '/raise/capital-relationships');
  const byId = (id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
  try {
    assert.deepEqual(calls, [], 'nothing is read before the press');
    await v.click('Match to my Mercury');
    await v.flush();
    assert.deepEqual(calls, [['matches', 'raise']]);
    await act(async () => { v.props(byId(`mercury-confirm-${TX}`)).onClick(); });
    await v.flush();
    assert.deepEqual(calls[1], ['confirm', { target_kind: 'raise', target_id: 7, transaction_id: TX }]);
    assert.deepEqual(calls[2], ['matches', 'raise'], 'the panel re-reads after a write');
    assert.equal(changed, 1);
    await act(async () => { v.props(byId('mercury-match-reason')).onChange({ target: { value: '  Wrong wire, see bank  ' } }); });
    await act(async () => { v.props(byId('mercury-match-withdraw-button')).onClick(); });
    await v.flush();
    assert.deepEqual(calls[3], ['withdraw', 'm-1', 'Wrong wire, see bank']);
    assert.equal(changed, 2);
  } finally { await v.unmount(); }
});

test('mounted: a refusal is printed under its own prospect', async () => {
  const fake = {
    matches: async () => READ,
    confirm: async () => { throw Object.assign(new Error('That line does not settle this: the amount, date, counterparty or account does not fit.'), { status: 409, code: 'not_matchable' }); },
    withdraw: async () => ({}),
  };
  const v = await mountContracts(h(RaiseReceiptMatches, { role: 'founder', api: fake }), '/raise/capital-relationships');
  try {
    await v.click('Match to my Mercury');
    await v.flush();
    const node = v.nodes().find((n) => v.props(n)?.['data-testid'] === `mercury-confirm-${TX}`);
    await act(async () => { v.props(node).onClick(); });
    await v.flush();
    assert.equal(v.text().split('That line does not settle this').length - 1, 1, 'under prospect 7 only, not under 8\'s withdraw');
  } finally { await v.unmount(); }
});

test('Capital relationships draws the panel under the Calls history, with the viewer\'s role and the module\'s re-read', () => {
  const src = codeOnly(readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8'));
  assert.match(src, /'capital-relationships': \(data, ctx\) => \(\s*<>\s*<CallsHistory calls=\{data\?\.parts\?\.calls\} \/>\s*<RaiseReceiptMatches role=\{ctx\.role\} onChanged=\{ctx\.reload\} \/>/);
  assert.match(src, /openDialog, role: user\?\.role \?\? null \}\)/);
});

// ─────────────────────────────────────────────────────────── the credit import and the words

test('the credit import prints the raise_receipt refusal and the "This may be an investment" hint, which never blocks', () => {
  assert.equal(mercuryCreditReason('raise_receipt'), 'Matched as an investor\'s wire to your raise, so it is not revenue');
  assert.equal(FITS_RAISE_TARGET, 'This may be an investment');
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const credits = [
    { transaction_id: A, posted_on: '2026-10-01', amount_cents: 25000000, last_four: '0042', counterparty_name: 'Example Holdings Trust', importable: true, reason: null, fits_raise_target: true },
    { transaction_id: TX, posted_on: '2026-10-02', amount_cents: 25000000, last_four: '0042', counterparty_name: 'Investor Bank', importable: false, reason: 'raise_receipt', fits_raise_target: false },
    { transaction_id: B, posted_on: '2026-10-03', amount_cents: 1200, last_four: '0042', counterparty_name: 'Customer Co', importable: true, reason: null },
  ];
  const html = ssr(h(MercuryCreditImportView, { state: { read: { status: 'ok', data: { credits, window: { from: '2026-09-01', to: '2026-10-19' }, capped: false } }, picks: {}, busy: false, err: '', result: null }, on: noop }));
  assert.match(html, new RegExp(`data-testid="mercury-raise-hint-${A}"`));
  assert.ok(text(html).includes(`${FITS_RAISE_TARGET}. ${FITS_RAISE_TARGET_NOTE}`));
  assert.match(html, new RegExp(`data-testid="mercury-pick-${A}"`), 'the hinted credit can still be picked');
  assert.doesNotMatch(html, new RegExp(`mercury-raise-hint-${TX}`));
  assert.doesNotMatch(html, new RegExp(`mercury-raise-hint-${B}`), 'no hint when the Worker sent none');
  assert.match(html, new RegExp(`data-testid="mercury-reason-${TX}"[^>]*>Matched as an investor&#x27;s wire to your raise, so it is not revenue<`));
  assert.doesNotMatch(html, /reason not recognised/);
});

test('the words: the founder\'s raise_receipts use, and no advice words', () => {
  assert.match(USE_WORDS.raise_receipts, /investor's wire/);
  assert.doesNotMatch([RAISE_MATCH_NOTE, RAISE_PANEL_LEAD, FITS_RAISE_TARGET_NOTE, ...Object.values(UNMATCHABLE_TEXT)].join(' '), /advis|advice|recommend|fiduciar/i);
});
