// D6200 (#6200, DL13): the deal page's syndicates panel lists the open
// syndicates an invitation to this exact deal shows, counted and never named,
// and Join opens an in-page dialog whose second step says what a pledge does.
// The Worker side (the exact-invitation and count-only guards) is held by
// cloudflare-worker/test/deal_rooms_d630.test.ts ("D6200: deal invitations
// gate count-only syndicate discovery and pledges").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import DealSyndicates, {
  SyndicateDrawer, SyndicateJoinDialog, SYNDICATE_JOIN, joinableSyndicates, syndicateLine, pledgeCheck, joinRefusal, memberCountLine,
} from '../src/components/deals/DealSyndicates.jsx';
import { dealSyndicatesApi } from '../src/lib/api/dealSyndicates.js';
import { api } from '../src/lib/api.js';
import { SYNDICATES_LINE } from '../src/pages/deal/dealWorkModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const OPEN = { id: 31, name: 'Synthetic open syndicate', creator_name: 'Synthetic Lead', status: 'open', target_cents: 40000000, min_commitment_cents: 1000000, members: 5, is_member: 0, is_lead: 0 };
const MINE = { id: 12, name: 'Synthetic own syndicate', creator_name: 'Synthetic Lead', status: 'funded', committed_cents: 18000000, members: 9 };

function stub(obj, key, fn) { const was = obj[key]; obj[key] = fn; return () => { obj[key] = was; }; }

test('joinable rows are the open, invited ones the investor neither leads nor belongs to', () => {
  const rows = joinableSyndicates([MINE], [
    OPEN,
    { ...OPEN, id: 12 },
    { ...OPEN, id: 32, is_member: 1 },
    { ...OPEN, id: 33, is_lead: 1 },
    { ...OPEN, id: 34, status: 'funded' },
  ]);
  assert.deepEqual(rows.map((r) => r.id), [31]);
  assert.equal(rows[0].joinable, true);
  assert.deepEqual(joinableSyndicates([], []), []);
  assert.deepEqual(joinableSyndicates(null, null), []);
});

test('a joinable row carries the lead, the count and the minimum, never a committed total', () => {
  const line = syndicateLine({ ...OPEN, joinable: true, committed_cents: 26000000 });
  assert.equal(line, 'Lead Synthetic Lead · 5 members · Minimum $10,000.00 · You are not in this syndicate');
  assert.doesNotMatch(line, /260,000|committed/);
  assert.equal(syndicateLine({ ...MINE, joinable: false }), 'Lead Synthetic Lead · $180,000.00 committed · 9 members');
  assert.equal(syndicateLine({ ...OPEN, members: 1, min_commitment_cents: 0, creator_name: null, joinable: true }), '1 member · You are not in this syndicate');
});

test('the pledge is whole cents at or above the minimum, or a sentence', () => {
  assert.deepEqual(pledgeCheck('25,000', 1000000), { cents: 2500000 });
  assert.deepEqual(pledgeCheck('$10000.50', 1000000), { cents: 1000050 });
  assert.deepEqual(pledgeCheck('10000', 1000000), { cents: 1000000 });
  assert.match(pledgeCheck('9999.99', 1000000).error, /^The minimum for this syndicate is \$10,000\.00\. Nothing was recorded\.$/);
  assert.match(pledgeCheck('', 0).error, /Enter an amount in dollars/);
  assert.match(pledgeCheck('12.345', 0).error, /Enter an amount in dollars/);
  assert.match(pledgeCheck('-5', 0).error, /Enter an amount in dollars/);
  assert.match(pledgeCheck('0', 0).error, /above zero/);
  assert.deepEqual(pledgeCheck('1', 0), { cents: 100 });
});

test('every refusal is a sentence that says nothing was recorded', () => {
  const cases = [
    [{ status: 403, message: 'KYC required' }, /identity check must be approved.*Nothing was recorded\./],
    [{ status: 404, message: 'This syndicate is not available for this deal.' }, /not open to you on this deal\. Nothing was recorded\./],
    [{ status: 409, message: 'Already joined this syndicate' }, /already in this syndicate\. Nothing changed\./],
    [{ status: 409, message: 'The syndicate is no longer open to you. Nothing was recorded.' }, /no longer open to you\. Nothing was recorded\./],
    [{ status: 400, message: 'Commitment is below the syndicate minimum.' }, /below this syndicate’s minimum\. Nothing was recorded\./],
    [{ status: 400, message: 'Syndicate is not open' }, /no longer open\. Nothing was recorded\./],
    [{ status: 400, message: 'Cannot join your own syndicate' }, /You lead this syndicate/],
    [{ status: 500, message: 'boom' }, /^Your pledge did not save\. Nothing was recorded\. Try again\.$/],
    [new Error('Network down'), /^Your pledge did not save\./],
  ];
  for (const [e, re] of cases) assert.match(joinRefusal(e), re, JSON.stringify(e));
  assert.doesNotMatch(joinRefusal({ status: 500, message: 'SQLITE_ERROR syndicate_members' }), /SQLITE/);
});

test('DL13: the lightbox shows the public facts, counts members and offers Join', () => {
  const text = renderedText(html(h(SyndicateJoinDialog, { syndicate: OPEN, dealId: 7, onClose: () => {} })));
  assert.match(text, /Synthetic open syndicate/);
  assert.match(text, /Lead\s*Synthetic Lead\s*Target\s*\$400,000\.00\s*Minimum\s*\$10,000\.00\s*Members\s*5\s*Counted, not named/);
  assert.match(text, /You are not in this syndicate\.\s*Only the lead sees members by name\. Members see the count\./);
  assert.match(text, /Close\s*Join this syndicate/);
  assert.doesNotMatch(text, /Join and pledge|Your pledge/, 'the first press only shows the facts');
  const missing = renderedText(html(h(SyndicateJoinDialog, { syndicate: { ...OPEN, target_cents: null, min_commitment_cents: 0 }, dealId: 7, onClose: () => {} })));
  assert.match(missing, /Target\s*Not recorded: no target has been set for this syndicate\./);
  assert.match(missing, /Minimum\s*No minimum is recorded for this syndicate\./);
});

test('DL13: the join step says what a pledge records before anything is sent', () => {
  const markup = html(h(SyndicateJoinDialog, { syndicate: OPEN, dealId: 7, onClose: () => {}, initialStep: 'pledge' }));
  const text = renderedText(markup);
  assert.match(text, /Join Synthetic open syndicate\?/);
  assert.match(text, /Joining records your pledge to this syndicate, for this deal\. It moves no money and does not mark the syndicate funded\. The lead sees your name and amount; other members see only the count\./);
  assert.match(text, /Your pledge · USD\s*Minimum \$10,000\.00\./);
  assert.match(text, /Back\s*Join and pledge/);
  assert.doesNotMatch(text, /You are not in this syndicate|Counted, not named/, 'the pledge step replaces the facts');
  assert.match(markup, /min-h-\[44px\]/);
  assert.equal(SYNDICATE_JOIN.does.includes('moves no money'), true);
});

test('the join call is made in one place, only from the join step, bound to the deal', () => {
  const code = codeOnly(read('components/deals/DealSyndicates.jsx'));
  assert.equal((code.match(/dealSyndicatesApi\.join\(/g) || []).length, 1);
  const fn = code.slice(code.indexOf('const confirmJoin = async'), code.indexOf('const footer ='));
  assert.match(fn, /pledgeCheck\(amount, s\.min_commitment_cents\)/);
  assert.match(fn, /dealSyndicatesApi\.join\(s\.id, \{ commitmentCents: checked\.cents, dealId \}\)/);
  assert.equal((code.match(/onClick=\{confirmJoin\}/g) || []).length, 1);
  const mod = readFileSync(new URL('../src/lib/api/dealSyndicates.js', import.meta.url), 'utf8');
  assert.match(mod, /request\(`\/networkfx\/syndicates\?deal_id=\$\{encodeURIComponent\(dealId\)\}`\)/);
  assert.match(mod, /JSON\.stringify\(\{ commitment_cents: commitmentCents, deal_id: dealId \}\)/);
  // The deal page passes its deal; the legacy deal room keeps its own list.
  assert.match(codeOnly(read('pages/deal/DealWorkTabs.jsx')), /<DealSyndicates projectId=\{deal\.project_id\} dealId=\{deal\.id\} user=\{user\} \/>/);
  assert.match(SYNDICATES_LINE, /counted, never named; only a syndicate’s lead sees names/);
  assert.doesNotMatch(SYNDICATES_LINE, /is not listed/);
});

test('a member reads the count, never names; the lead and the older read still list names', () => {
  const base = { id: 12, name: 'Synthetic own syndicate', status: 'open', target_cents: 100000, committed_cents: 50000, member_count: 3, created_by: 5 };
  const member = renderedText(html(h(SyndicateDrawer, { state: { loading: false, error: false, syndicate: { ...base, members: [], show_member_names: false } }, onClose: () => {} })));
  assert.match(member, /3 members\. Others are counted, not named; only the lead sees members by name\./);
  assert.doesNotMatch(member, /No member has committed yet/);
  const lead = renderedText(html(h(SyndicateDrawer, { state: { loading: false, error: false, syndicate: { ...base, show_member_names: true, members: [{ id: 1, user_id: 8, name: 'Synthetic Member', commitment_cents: 50000 }] } }, onClose: () => {} })));
  assert.match(lead, /Synthetic Member\s*\$500\.00/);
  assert.doesNotMatch(lead, /counted, not named/);
  assert.equal(memberCountLine(1), '1 member. Others are counted, not named; only the lead sees members by name.');
  assert.equal(memberCountLine(null), '0 members. Others are counted, not named; only the lead sees members by name.');
});

test('the panel lists an invited open syndicate, joins it from the dialog and re-reads both lists', async () => {
  const calls = [];
  let own = [MINE];
  const undo = [
    stub(api, 'networkFxProjectSyndicates', async (id) => { calls.push(['own', id]); return own; }),
    stub(dealSyndicatesApi, 'open', async (id) => { calls.push(['open', id]); return [OPEN, { ...OPEN, id: 12 }]; }),
    stub(dealSyndicatesApi, 'join', async (id, body) => { calls.push(['join', id, body]); own = [MINE, { ...OPEN, members: 6 }]; return { ok: true }; }),
  ];
  const view = await mountContracts(h(DealSyndicates, { projectId: 10, dealId: 7 }));
  try {
    await view.flush();
    assert.deepEqual(calls.slice(0, 2).sort(), [['open', 7], ['own', 10]]);
    const text = view.text();
    assert.match(text, /Synthetic own syndicate/);
    assert.match(text, /Synthetic open syndicate/);
    assert.equal((text.match(/Synthetic own syndicate/g) || []).length, 1, 'a syndicate already in the own list is not listed twice');
    // Two rows, two Open buttons; the second belongs to the invited row.
    const openButtons = view.nodes().filter((n) => n.tagName === 'BUTTON' && view.props(n)?.children === 'Open');
    assert.equal(openButtons.length, 2);
    await act(async () => { view.props(openButtons[1]).onClick({ stopPropagation() {} }); });
    assert.match(view.text(), /Counted, not named/);
    await view.click('Join this syndicate');
    assert.match(view.text(), /It moves no money/);
    await view.fill('Your pledge', '9000');
    await view.click('Join and pledge');
    assert.match(view.text(), /The minimum for this syndicate is \$10,000\.00\. Nothing was recorded\./);
    assert.equal(calls.filter((c) => c[0] === 'join').length, 0, 'a pledge below the minimum is never sent');
    await view.fill('Your pledge', '20,000');
    await view.click('Join and pledge');
    await view.flush();
    assert.deepEqual(calls.find((c) => c[0] === 'join'), ['join', 31, { commitmentCents: 2000000, dealId: 7 }]);
    assert.match(view.text(), /You are in Synthetic open syndicate\. Your pledge of \$20,000\.00 is recorded\. No money has moved\./);
    const before = calls.length;
    await view.click('Done');
    await view.flush();
    assert.deepEqual(calls.slice(before).map((c) => c[0]).sort(), ['open', 'own']);
  } finally { await view.unmount(); undo.forEach((u) => u()); }
});

test('a refused join stays in the dialog as a sentence', async () => {
  const undo = [
    stub(api, 'networkFxProjectSyndicates', async () => []),
    stub(dealSyndicatesApi, 'open', async () => [OPEN]),
    stub(dealSyndicatesApi, 'join', async () => { const e = new Error('This syndicate is not available for this deal.'); e.status = 404; throw e; }),
  ];
  const view = await mountContracts(h(SyndicateJoinDialog, { syndicate: OPEN, dealId: 7, onClose: () => {}, initialStep: 'pledge' }));
  try {
    await view.fill('Your pledge', '15000');
    await view.click('Join and pledge');
    await view.flush();
    assert.match(view.text(), /This syndicate is not open to you on this deal\. Nothing was recorded\./);
    assert.doesNotMatch(view.text(), /You are in/);
  } finally { await view.unmount(); undo.forEach((u) => u()); }
});

test('a non-invited investor sees only their own syndicates, and an unreadable discovery says so', async () => {
  let undo = [
    stub(api, 'networkFxProjectSyndicates', async () => []),
    stub(dealSyndicatesApi, 'open', async () => []),
  ];
  let view = await mountContracts(h(DealSyndicates, { projectId: 10, dealId: 7 }));
  try {
    await view.flush();
    assert.match(view.text(), /No syndicate is linked to this company\./);
    assert.doesNotMatch(view.text(), /Join this syndicate|Counted, not named/);
  } finally { await view.unmount(); undo.forEach((u) => u()); }

  undo = [
    stub(api, 'networkFxProjectSyndicates', async () => [MINE]),
    stub(dealSyndicatesApi, 'open', async () => { throw new Error('down'); }),
  ];
  view = await mountContracts(h(DealSyndicates, { projectId: 10, dealId: 7 }));
  try {
    await view.flush();
    assert.match(view.text(), /Synthetic own syndicate/);
    assert.match(view.text(), /The open syndicates on this deal could not be read just now\. That is not a claim that there are none\./);
    assert.doesNotMatch(view.text(), /No syndicate is linked/);
  } finally { await view.unmount(); undo.forEach((u) => u()); }

  // Without a deal (the deal room), no discovery read is made.
  let opened = 0;
  undo = [stub(api, 'networkFxProjectSyndicates', async () => [MINE]), stub(dealSyndicatesApi, 'open', async () => { opened += 1; return [OPEN]; })];
  view = await mountContracts(h(DealSyndicates, { projectId: 10 }));
  try {
    await view.flush();
    assert.equal(opened, 0);
    assert.doesNotMatch(view.text(), /Synthetic open syndicate/);
  } finally { await view.unmount(); undo.forEach((u) => u()); }
});
