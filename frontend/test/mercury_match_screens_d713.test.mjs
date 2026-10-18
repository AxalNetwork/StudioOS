/**
 * D713 (#1778 PR C, F29b to F29e): the member's "Match to my Mercury" on an
 * invoice, a payout and a settlement, and the Admin's settlements desk.
 *   · nothing reads the member's bank until they press Match;
 *   · each place has its empty, Not recorded and Unreadable states;
 *   · Issue and Void are drawn only for the Super Admin, so a plain Admin
 *     never reaches the routes that answer `super_admin_required`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_match_screens_d713.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { mercuryPersonalApi } from '../src/lib/api/mercuryPersonal.js';
import { partnerSettlementsApi } from '../src/lib/api/partnerSettlements.js';
import MercuryMatch, { MercuryMatchView, matchTargetOf, receivedLine } from '../src/components/MercuryMatch.jsx';
import { SettlementsList, PayoutHistory } from '../src/pages/partner/earnings/PartnerEarnings.jsx';
import SettlementsDesk, { SettlementRows } from '../src/pages/admin/contracts/SettlementsDesk.jsx';
import { memberDirection, settlementDraft, settlementKindLabel, settlementStateLabel } from '../src/lib/partnerSettlements.js';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = new Proxy({}, { get: () => () => {} });
const T = '33333333-3333-4333-8333-333333333333';
const LINE = { transaction_id: T, posted_on: '2026-10-03', amount_cents: 250000, last_four: '0042', counterparty_name: 'Acme Corp' };
const ITEM = { target_kind: 'engagement_invoice', target_id: 5, label: 'INV-5', state: 'issued', amount_cents: 250000, direction: 'credit', window: { from: '2026-10-01', to: '2027-03-30' }, candidates: [LINE] };
const MATCH = { uid: 'm-1', target_kind: 'engagement_invoice', target_id: 9, state: 'confirmed', posted_on: '2026-09-20', last_four: '0042', amount_cents: 1000 };
const matchView = (read, extra = {}) => ssr(h(MercuryMatchView, { target: 'invoice', state: { read, busy: false, err: '', reason: '', ...extra }, on: noop }));

test('matchTargetOf finds this target\'s item and its confirmed match, by id', () => {
  const data = { items: [ITEM], matches: [MATCH, { ...MATCH, uid: 'm-2', target_id: 5, state: 'withdrawn' }] };
  assert.deepEqual(matchTargetOf(data, 5), { item: ITEM, match: null }, 'a withdrawn match is not a match');
  assert.deepEqual(matchTargetOf(data, '9'), { item: null, match: MATCH });
  assert.deepEqual(matchTargetOf(null, 5), { item: null, match: null });
});

test('receivedLine: the day, and the last four only when given', () => {
  assert.equal(receivedLine({ posted_on: '2026-10-03', last_four: '0042' }), 'Received 2026-10-03 on ••0042');
  assert.equal(receivedLine({ posted_on: '2026-10-03', last_four: null }), 'Received 2026-10-03');
  assert.equal(receivedLine(null), null);
  assert.equal(receivedLine({ last_four: '0042' }), null, 'no day is no match');
});

test('the match panel\'s states', () => {
  assert.match(matchView({ status: 'loading' }), /data-testid="mercury-match-loading"/);
  const none = matchView({ status: 'failed', outcome: { kind: 'not_recorded', reason: 'Connect your own Mercury account first, with a Read Only token.' } });
  assert.match(none, /data-testid="mercury-match-not-recorded"/);
  assert.match(none, /Not recorded/);
  assert.match(matchView({ status: 'failed', outcome: { kind: 'refused', reason: 'HQ only.' } }), /role="alert" data-testid="mercury-match-refused">HQ only\.</);
  const bad = matchView({ status: 'failed', outcome: { kind: 'unreadable' } });
  assert.match(bad, /Your Mercury account could not be read\. This is not a claim that no line pays this invoice\./);
  assert.match(matchView({ status: 'ok', item: null, match: null }), /data-testid="mercury-match-not-open"/);
  assert.match(matchView({ status: 'ok', item: { ...ITEM, candidates: [] }, match: null }), /data-testid="mercury-match-empty"[^>]*>No line in your Mercury account fits this invoice yet/);
  const list = matchView({ status: 'ok', item: ITEM, match: null });
  assert.match(list, new RegExp(`data-testid="mercury-confirm-${T}"[^>]*>This line pays it<`));
  assert.match(list, /\$2,500/);
  assert.match(list, /A credit to your account/);
  assert.match(matchView({ status: 'ok', item: { ...ITEM, direction: 'debit' }, match: null }), /A payment out of your account/);
});

test('withdraw waits for a reason of ten characters', () => {
  const short = matchView({ status: 'ok', item: null, match: MATCH }, { reason: 'too short' });
  assert.match(short, /disabled=""[^>]*data-testid="mercury-match-withdraw-button"/);
  assert.match(short, /Matched to the line posted 2026-09-20 on ••0042/);
  const long = matchView({ status: 'ok', item: null, match: MATCH }, { reason: 'Wrong line, paid twice' });
  assert.doesNotMatch(long, /disabled=""[^>]*data-testid="mercury-match-withdraw-button"/);
});

async function withMercury(matches, run) {
  const saved = { ...mercuryPersonalApi };
  const calls = [];
  mercuryPersonalApi.matches = async (...a) => { calls.push(['matches', ...a]); return matches(); };
  mercuryPersonalApi.confirm = async (...a) => { calls.push(['confirm', ...a]); return { ok: true }; };
  mercuryPersonalApi.withdraw = async (...a) => { calls.push(['withdraw', ...a]); return { ok: true }; };
  try { return await run(calls); } finally { Object.assign(mercuryPersonalApi, saved); }
}

test('mounted: nothing is read until Match, then the confirm names the target and the line', async () => {
  await withMercury(() => ({ items: [ITEM], matches: [] }), async (calls) => {
    let changed = 0;
    const v = await mountContracts(h(MercuryMatch, { target: 'invoice', targetId: 5, matched: null, onChanged: () => { changed += 1; } }), '/needs');
    try {
      await v.flush();
      assert.deepEqual(calls, [], 'no bank read before the member asks');
      assert.doesNotMatch(v.text(), /Reading your Mercury|could not be read/, 'the panel stays closed until Match');
      await v.click('Match to my Mercury');
      await v.flush();
      assert.deepEqual(calls, [['matches', 'invoice']]);
      assert.match(v.text(), /Acme Corp/);
      await v.click('This line pays it');
      await v.flush();
      assert.deepEqual(calls[1], ['confirm', { target_kind: 'invoice', target_id: 5, transaction_id: T }]);
      assert.equal(changed, 1);
    } finally { await v.unmount(); }
  });
});

test('mounted: a failed read is Unreadable, never "no line fits"', async () => {
  await withMercury(() => { throw Object.assign(new Error('down'), { status: 502, code: 'mercury_unreadable' }); }, async () => {
    const v = await mountContracts(h(MercuryMatch, { target: 'payout', targetId: 3, matched: null }), '/partner/earnings');
    try {
      await v.click('Match to my Mercury');
      await v.flush();
      assert.match(v.text(), /Your Mercury account could not be read/);
      assert.doesNotMatch(v.text(), /No line in your Mercury account fits/);
    } finally { await v.unmount(); }
  });
});

test('the invoice: the day for both sides, the last four for the partner only, Match for the partner', () => {
  const src = readFileSync('frontend/src/pages/NeedsBoardPage.jsx', 'utf8');
  const doc = src.slice(src.indexOf('function InvoiceDocument('), src.indexOf('function EngagementDetailModal('));
  assert.match(doc, /receivedLine\(\{ posted_on: inv\.bank_matched_on, last_four: isPartner \? inv\.bank_last_four : null \}\)/);
  assert.match(doc, /Not matched to a bank line/);
  assert.match(doc, /\{isPartner && \(inv\.status === 'issued' \|\| inv\.status === 'paid'\) && \(\s*<div className="mt-2">\s*<MercuryMatch target="invoice" targetId=\{inv\.id\}/);
});

test('payouts: Received from bank_match, Match on every payout that has not failed', () => {
  const rows = [
    { id: 1, status: 'requested', amount_cents: 1000, currency: 'usd', created_at: '2026-10-01', bank_match: { posted_on: '2026-10-04', last_four: '0042' } },
    { id: 2, status: 'completed', amount_cents: 1000, currency: 'usd', created_at: '2026-10-01', bank_match: null },
    { id: 3, status: 'failed', amount_cents: 1000, currency: 'usd', created_at: '2026-10-01', bank_match: null },
  ];
  const html = ssr(h(PayoutHistory, { state: 'ready', rows, onRetry: () => {}, onMatched: () => {} }));
  assert.match(html, /data-testid="text-payout-received-1"[^]*?Received 2026-10-04 on ••0042/);
  assert.match(html, /data-testid="text-payout-received-2"[^]*?Not matched to a bank line/);
  assert.doesNotMatch(html, /text-payout-received-3/, 'a failed payout is never matched');
  assert.match(html, /data-testid="mercury-match-open-payout-1"[^>]*>Change the Mercury match</);
  assert.match(html, /data-testid="mercury-match-open-payout-2"[^>]*>Match to my Mercury</);
  assert.doesNotMatch(ssr(h(PayoutHistory, { state: 'ready', rows, onRetry: () => {} })), /mercury-match-open/, 'without onMatched there is no Match');
});

test('the member\'s settlements: states, words, and Match on issued and matched only', () => {
  assert.match(ssr(h(SettlementsList, { state: 'loading', rows: [] })), /panel-settlements/);
  assert.match(ssr(h(SettlementsList, { state: 'unreadable', rows: [] })), /Your partner-deal settlements could not be read\. This is not a claim that none was issued to you\./);
  assert.match(ssr(h(SettlementsList, { state: 'ready', rows: [] })), /data-testid="empty-settlements"[^>]*>No settlement under a partner deal has been issued to you\.</);
  const rows = [
    { id: 1, uid: 'a', kind: 'revenue_share', direction: 'to_member', amount_cents: 50000, due_on: '2026-11-01', state: 'issued' },
    { id: 2, uid: 'b', kind: 'capital', direction: 'from_member', amount_cents: 70000, due_on: '2026-11-02', state: 'matched' },
    { id: 3, uid: 'c', kind: 'other', direction: 'to_member', amount_cents: 1000, due_on: null, state: 'void', void_reason: 'Entered twice' },
  ];
  const html = ssr(h(SettlementsList, { state: 'ready', rows, onMatched: () => {} }));
  assert.match(html, /Revenue share · Owed to you/);
  assert.match(html, /Capital · Owed by you/);
  assert.match(html, /data-testid="mercury-match-open-settlement-1"[^>]*>Match to my Mercury</);
  assert.match(html, /data-testid="mercury-match-open-settlement-2"[^>]*>Change the Mercury match</);
  assert.doesNotMatch(html, /mercury-match-open-settlement-3/);
  assert.match(html, /data-testid="text-settlement-void-c"[^>]*>Voided: Entered twice</);
  assert.match(html, /Due date not recorded/);
});

test('settlement words: every Worker key, and an unknown one said as unknown', () => {
  assert.equal(settlementKindLabel('equity_for_services'), 'Equity for services');
  assert.equal(settlementKindLabel('loan'), 'Unknown kind');
  assert.equal(settlementStateLabel('matched'), 'Matched');
  assert.equal(settlementStateLabel('toString'), 'Unknown state');
  assert.equal(memberDirection('from_member'), 'Owed by you');
  assert.equal(memberDirection('sideways'), 'Unknown direction');
});

test('a draft is checked before it is sent, as the Worker checks it', () => {
  const ok = { partner_deal_id: 4, kind: 'capital', direction: 'to_member', amount: '1,200.50', due_on: '2026-12-01', memo: ' Q4 ' };
  assert.deepEqual(settlementDraft(ok).body, { partner_deal_id: 4, kind: 'capital', direction: 'to_member', amount_cents: 120050, due_on: '2026-12-01', memo: 'Q4' });
  assert.match(settlementDraft({ ...ok, amount: '0' }).error, /positive amount/);
  assert.match(settlementDraft({ ...ok, amount: '1.005' }).error, /positive amount/);
  assert.match(settlementDraft({ ...ok, kind: 'loan' }).error, /kind/);
  assert.match(settlementDraft({ ...ok, due_on: '' }).error, /due date/);
  assert.match(settlementDraft({ ...ok, memo: 'acct 12345678' }).error, /eight digits/);
  assert.equal(settlementDraft({ ...ok, memo: '' }).body.memo, null);
});

const DESK_ROWS = [
  { id: 1, uid: 'd1', kind: 'capital', direction: 'to_member', amount_cents: 1000, due_on: '2026-12-01', state: 'draft' },
  { id: 2, uid: 'i2', kind: 'capital', direction: 'from_member', amount_cents: 2000, due_on: '2026-12-02', state: 'issued', issued_at: '2026-10-01 10:00:00' },
];

test('the desk\'s rows: Issue and Void for the Super Admin only; edit and delete on drafts only', () => {
  const admin = ssr(h(SettlementRows, { rows: DESK_ROWS, superAdmin: false, busy: false, ...noop }));
  assert.match(admin, /data-testid="settlement-edit-d1"/);
  assert.match(admin, /data-testid="settlement-delete-d1"/);
  assert.doesNotMatch(admin, /settlement-edit-i2|settlement-delete-i2/);
  assert.doesNotMatch(admin, /settlement-issue-|settlement-void-/);
  const sup = ssr(h(SettlementRows, { rows: DESK_ROWS, superAdmin: true, busy: false, ...noop }));
  assert.match(sup, /data-testid="settlement-issue-d1"/);
  assert.doesNotMatch(sup, /settlement-issue-i2/);
  assert.match(sup, /data-testid="settlement-void-i2"/);
  assert.doesNotMatch(sup, /settlement-void-d1/);
  assert.match(ssr(h(SettlementRows, { rows: [], superAdmin: true, ...noop })), /data-testid="settlements-empty"/);
});

async function withSettlements(list, run) {
  const saved = { ...partnerSettlementsApi };
  const calls = [];
  for (const k of Object.keys(saved)) partnerSettlementsApi[k] = async (...a) => { calls.push([k, ...a]); return {}; };
  partnerSettlementsApi.list = async (...a) => { calls.push(['list', ...a]); return list(); };
  try { return await run(calls); } finally { Object.assign(partnerSettlementsApi, saved); }
}
const DEAL = { id: 4, status: 'active', partner_name: 'Pat Partner' };

test('mounted desk, plain Admin: drafts and deletes, and is never offered Issue or Void', async () => {
  await withSettlements(() => DESK_ROWS, async (calls) => {
    const v = await mountContracts(h(SettlementsDesk, { deal: DEAL, superAdmin: false, onClose: () => {} }));
    try {
      await v.flush();
      assert.deepEqual(calls, [['list', { deal: 4 }]]);
      assert.match(v.text(), /Issuing and voiding are the Super Admin’s/);
      await assert.rejects(v.click('Issue'), /Missing button/);
      await assert.rejects(v.click('Void'), /Missing button/);
      await v.fill('Kind', 'revenue_share');
      await v.fill('Direction', 'to_member');
      await v.fill('Amount (USD)', '300');
      await v.fill('Due', '2026-12-31');
      await v.click('Save as draft');
      await v.flush();
      assert.deepEqual(calls.find((c) => c[0] === 'create'), ['create', { partner_deal_id: 4, kind: 'revenue_share', direction: 'to_member', amount_cents: 30000, due_on: '2026-12-31', memo: null }]);
      await v.click('Delete draft');
      await v.flush();
      assert.deepEqual(calls.find((c) => c[0] === 'remove'), ['remove', 'd1']);
      assert.ok(!calls.some((c) => c[0] === 'issue' || c[0] === 'void'));
    } finally { await v.unmount(); }
  });
});

test('mounted desk, Super Admin: Issue sends the uid; Void needs a reason', async () => {
  await withSettlements(() => DESK_ROWS, async (calls) => {
    const v = await mountContracts(h(SettlementsDesk, { deal: DEAL, superAdmin: true, onClose: () => {} }));
    try {
      await v.flush();
      assert.doesNotMatch(v.text(), /Issuing and voiding are the Super Admin’s/);
      await v.click('Issue');
      await v.flush();
      assert.deepEqual(calls.find((c) => c[0] === 'issue'), ['issue', 'd1']);
      await v.click('Void');
      await assert.rejects(v.click('Void settlement'), /Disabled button/);
      await v.fill('Why void this settlement?', 'Drafted against the wrong deal');
      await v.click('Void settlement');
      await v.flush();
      assert.deepEqual(calls.find((c) => c[0] === 'void'), ['void', 'i2', 'Drafted against the wrong deal']);
    } finally { await v.unmount(); }
  });
});

test('mounted desk: an unreadable list says so; an inactive deal takes no draft', async () => {
  await withSettlements(() => { throw new Error('down'); }, async () => {
    const v = await mountContracts(h(SettlementsDesk, { deal: { ...DEAL, status: 'ended' }, superAdmin: true, onClose: () => {} }));
    try {
      await v.flush();
      assert.match(v.text(), /Unreadable\. Settlements could not be read\./);
      assert.match(v.text(), /drafted only under an active deal; this one is ended/);
      await assert.rejects(v.click('Save as draft'), /Missing button/);
    } finally { await v.unmount(); }
  });
});

test('inactive deals offer draft deletion and issued-row voiding, with no dead Edit or Issue actions', async () => {
  await withSettlements(() => DESK_ROWS, async (calls) => {
    for (const status of ['terminated', 'expired']) {
      const v = await mountContracts(h(SettlementsDesk, { deal: { ...DEAL, status }, superAdmin: true, onClose: () => {} }));
      try {
        await v.flush();
        await assert.rejects(v.click('Edit'), /Missing button/);
        await assert.rejects(v.click('Issue'), /Missing button/);
        await assert.rejects(v.click('Save as draft'), /Missing button/);
        await v.click('Delete draft');
        await v.flush();
        assert.deepEqual(calls.filter((c) => c[0] === 'remove').at(-1), ['remove', 'd1']);
        await v.click('Void');
        assert.match(v.text(), /Why void this settlement/);
      } finally { await v.unmount(); }
    }
  });
});

test('a failed deletion stays visible when the deal becomes inactive during an edit', async () => {
  await withSettlements(() => DESK_ROWS, async () => {
    partnerSettlementsApi.remove = async () => { throw new Error('Deletion was refused'); };
    function ChangingDeal() {
      const [active, setActive] = React.useState(true);
      return h(React.Fragment, null,
        h('button', { onClick: () => setActive(false) }, 'End deal'),
        h(SettlementsDesk, { deal: { ...DEAL, status: active ? 'active' : 'terminated' }, superAdmin: true, onClose: () => {} }));
    }
    const v = await mountContracts(h(ChangingDeal));
    try {
      await v.flush();
      await v.click('Edit');
      assert.match(v.text(), /Edit draft/);
      await v.click('End deal');
      await assert.rejects(v.click('Save draft'), /Missing button/);
      await v.click('Delete draft');
      await v.flush();
      assert.match(v.text(), /Deletion was refused/);
      assert.ok(v.nodes().some((n) => v.props(n)?.role === 'alert' && n.textContent === 'Deletion was refused'));
    } finally { await v.unmount(); }
  });
});

test('Contracts › Partner deals opens the desk, and passes who is Super Admin', () => {
  const desk = readFileSync('frontend/src/pages/admin/contracts/ContractsDesk.jsx', 'utf8');
  assert.match(desk, /<RelatedLists key=\{tab\} kind=\{tab\} onOpen=\{setSelected\} superAdmin=\{superAdmin\} \/>/);
  const lists = readFileSync('frontend/src/pages/admin/contracts/RelatedLists.jsx', 'utf8');
  assert.match(lists, /onClick=\{\(\) => setSettling\(row\)\} data-testid=\{`partner-deal-settlements-\$\{row\.id\}`\}>Settlements</);
  assert.match(lists, /<SettlementsDesk deal=\{settling\} superAdmin=\{superAdmin\}/);
});
