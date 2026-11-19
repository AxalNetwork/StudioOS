/**
 * D6151 (#6151) — `/deals/rooms` built to the Deals v2 addendum boards DE19 to DE24 (canvas D6141):
 * the row's columns from four reads, the allowance line, Request an invitation as Review → Result,
 * Add to my deal flow, and each refusal naming the room. Every venture here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_rooms_6151.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  EMPTY_VIEW, actionRefusal, allowanceView, flowIndex, fullSentence, invitationsIndex, isLive, roomRow, savingLine, shortDay,
} from '../src/components/deals/dealRoomsModel.js';
import { DealRoomsList } from '../src/components/deals/DealRoomsPanel.jsx';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { mountContracts } from './_contracts_dom.mjs';

const ready = (data) => ({ loading: false, error: false, data });
const failed = { loading: false, error: true, data: null };
const side = (inv = ready([]), flow = ready({ items: [] })) => ({ invitations: invitationsIndex(inv), flow: flowIndex(flow) });
const DEAL = { id: 7, project_name: 'Example Orchard', project_sector: 'Agritech', status: 'active', currency: 'USD', target_raise: 2000000, instrument: 'safe', capital_committed: 1200000, can_read: false, is_member: 0 };

// Mutation checked: an unread invitations read drawn as "Not invited" (fails); the newest invitation not kept (fails);
// a member's row without "Invitation requested" (fails); the flow stage ignored (fails); an unread flow drawn as
// "Not in my deal flow" (fails); the instrument not named (fails); the confirmed total dropped (fails).
test('DE19: each column from its own read; a side read that failed is Unreadable, never "Not invited"', () => {
  const r = roomRow(DEAL, side());
  assert.deepEqual([r.company, r.process.text, r.round.ask, r.round.instrument, r.round.confirmed, r.invitation.text, r.access],
    ['Active', 'Not in my deal flow', '$2,000,000', 'SAFE', '$1,200,000', 'Not invited', 'refused']);
  const invited = roomRow(DEAL, side(ready([
    { deal_id: 7, status: 'interested', created_at: '2026-10-20 09:00:00', responded_at: '2026-11-03 10:00:00' },
    { deal_id: 7, status: 'invited', created_at: '2026-10-01 09:00:00' },
  ]), ready({ items: [{ deal_id: 7, stage: 'diligence' }] })));
  assert.deepEqual([invited.invitation.text, invited.invitation.day, invited.process.text], ['Interested', '3 Nov', 'Diligence']);
  const asked = roomRow({ ...DEAL, is_member: 1 }, side());
  assert.deepEqual([asked.invitation.text, asked.invitation.note], ['Invitation requested', 'No date in the list']);
  const blind = roomRow(DEAL, side(failed, failed));
  assert.deepEqual([blind.invitation.kind, blind.process.kind], ['unreadable', 'unreadable']);
  const bare = roomRow({ ...DEAL, target_raise: null, amount: null, instrument: null }, side());
  assert.deepEqual([bare.round.ask, bare.round.instrument], [null, null], 'words on screen, never 0 or a blank');
  assert.equal(roomRow({ ...DEAL, target_raise: null, amount: 500000 }, side()).round.ask, '$500,000', 'the ask falls back to the amount');
  assert.equal(isLive({ status: 'rejected' }), false);
  assert.equal(isLive({ status: 'scored' }), true);
  assert.equal(shortDay('nonsense'), null);
});

// Mutation checked: the full line without the next plan (fails); Professional not saying Institutional is unlimited
// (fails); an unread quota drawn as 0 (fails); this firm's count dropped (fails); Unlimited with a cap (fails).
test('DE20: the allowance names the plan, counts every firm, and a full one names the next plan', () => {
  const within = allowanceView({ loading: false, error: false, quota: { used: 3, cap: 5, unlimited: false, full: false, tier: 'professional', member_deal_ids: [1, 2] } });
  assert.deepEqual([within.kind, within.lead, within.plan, within.text, within.pct], ['within', '3 of 5 rooms used', 'Professional plan', 'Counted across all your firms · 2 under this firm', 60]);
  const plus = { used: 2, cap: 2, full: true, tier: 'plus', upgrade_to: 'professional', upgrade_cap: 5 };
  assert.equal(fullSentence(plus), 'You are in 2 of 2 rooms on the Plus plan. Leave a room, or move to Professional for 5.');
  assert.equal(fullSentence({ used: 5, cap: 5, full: true, tier: 'professional', upgrade_to: 'institutional', upgrade_cap: null }),
    'You are in 5 of 5 rooms on the Professional plan. Leave a room, or move to Institutional. Institutional is unlimited.');
  assert.equal(allowanceView({ quota: plus }).kind, 'full');
  const unlimited = allowanceView({ quota: { used: 7, unlimited: true, tier: 'institutional' } });
  assert.deepEqual([unlimited.lead, unlimited.plan, unlimited.text], ['Unlimited rooms', 'Institutional plan', '7 rooms in use, all your firms']);
  const unread = allowanceView({ loading: false, error: true, quota: null });
  assert.deepEqual([unread.kind, unread.lead, unread.text], ['unreadable', 'Room allowance could not be read.', 'Requesting still checks it.']);
  assert.equal(allowanceView({ loading: true, quota: null }).kind, 'loading');
});

// Mutation checked: a 402 read as a plain failure (fails); the 409 not naming the other firm (fails); an
// already-in-flow add read as a failure (fails); a failure that does not name the room (fails).
test('DE22: each refusal and failure names the room, and the row keeps its state', () => {
  const q = { used: 5, cap: 5, full: true, tier: 'professional', upgrade_to: 'institutional' };
  const full = actionRefusal('request', 'Example Orchard', { status: 402, code: 'quota_dealrooms_exhausted' }, q);
  assert.equal(full.title, 'Your request for Example Orchard was not recorded: your allowance filled meanwhile.');
  assert.match(full.body, /Institutional is unlimited\.$/);
  assert.equal(full.action, 'plans');
  assert.equal(actionRefusal('request', 'X', { status: 409, code: 'room_requested_for_other_firm' }).title,
    'This room was requested under another firm. Leave it from that firm before requesting it here.');
  assert.equal(actionRefusal('add', 'X', { status: 409, code: 'already_in_flow' }).title, 'This deal is already in your deal flow.');
  assert.equal(actionRefusal('request', 'Example Orchard', { status: 500 }).title, 'Your invitation request for Example Orchard could not be recorded. Nothing changed.');
  assert.equal(actionRefusal('leave', 'Example Harbor', { status: 500 }).title, 'You could not leave the Example Harbor room. You are still in it.');
  assert.equal(actionRefusal('add', 'Example Fern', { status: 500 }).title, 'Example Fern could not be added to your deal flow.');
  assert.deepEqual([savingLine('request', 'A'), savingLine('leave', 'A'), savingLine('add', 'A')], ['Requesting A…', 'Leaving the A room…', 'Adding A to your deal flow…']);
});

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const QUOTA = { loading: false, error: false, quota: { used: 1, cap: 5, unlimited: false, full: false, tier: 'professional', member_deal_ids: [] } };
const list = (props = {}) => html(h(DealRoomsList, { dealsState: { loading: false, error: false, deals: [DEAL] }, quotaState: QUOTA, ...props }));

// Mutation checked: the empty boards' actions dropped (fails); a 403 drawn as unreadable (fails); the side-read
// banner dropped (fails); the ◇ columns drawn (fails).
test('DE19, DE21, DE22: the table, the views\' empty boards, the licence refusal and an unread side read', () => {
  const out = list();
  assert.match(out, /Round · confirmed in this round, all investors/);
  assert.doesNotMatch(out, />NDA<|My commitment|Changed since/i, 'the three ◇ columns are not drawn (owner answer A)');
  assert.match(out, /\$1,200,000 confirmed/);
  assert.match(out, /1 live deal · Rejected deals are not listed/);
  const none = (filter) => list({ dealsState: { loading: false, error: false, deals: [] }, initialFilter: filter });
  assert.match(none('all'), new RegExp(`${EMPTY_VIEW.all.text}[\\s\\S]*href="/deals"[^>]*>Go to Deal flow<`));
  assert.match(none('open'), /No deal is open to you yet\.[\s\S]*data-testid="dr-empty-all"[^>]*>Show all live deals</);
  const refused = list({ dealsState: { loading: false, error: true, deals: null, status: 403 } });
  assert.match(refused, /data-testid="dr-no-licence"[\s\S]*Deal rooms are for investors\.[\s\S]*An admin can grant the Investor licence\./);
  assert.doesNotMatch(refused, /dr-unreadable|dr-quota|dr-filters/);
  const sideUnread = list({ invitesState: failed });
  assert.match(sideUnread, /data-testid="dr-side-unreadable"[\s\S]*Invitations could not be read\./);
  assert.match(sideUnread, /! Unreadable/);
  assert.doesNotMatch(sideUnread.split('data-testid="dr-pipeline-row"')[1].split('</tr>')[0], /Not invited/);
});

const by = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const press = async (v, id) => { const n = by(v, id)[0]; assert.ok(n, `missing ${id}`); await act(async () => { await v.props(n).onClick({ stopPropagation() {} }); }); };

// Mutation checked: writing before the review is confirmed (fails); the result not naming the room (fails);
// a 402 that does not re-read the allowance (fails).
test('DE20: Request an invitation is Review → Result, and a 402 re-reads the allowance and names the next plan', async () => {
  const original = api.dealroomJoin; const calls = []; let rereads = 0;
  api.dealroomJoin = async (id) => { calls.push(id); return { ok: true }; };
  const v = await mountContracts(h(DealRoomsList, {
    dealsState: { loading: false, error: false, deals: [DEAL] }, quotaState: QUOTA, onChanged: async () => { rereads += 1; },
  }));
  try {
    await press(v, 'dr-join');
    assert.deepEqual(calls, [], 'nothing is written before the review is confirmed');
    assert.match(v.text(), /Request an invitation to Example Orchard\?[\s\S]*Nobody is notified automatically\. It does not grant access to the deal or diligence\./);
    await press(v, 'dr-request-confirm');
    assert.deepEqual(calls, [7]);
    assert.match(v.text(), /Your invitation request for Example Orchard is recorded\. Access starts after an invitation or commitment\./);
    assert.equal(rereads, 1);
    api.dealroomJoin = async () => { const e = new Error('full'); e.status = 402; e.code = 'quota_dealrooms_exhausted'; throw e; };
    await press(v, 'dr-join');
    await press(v, 'dr-request-confirm');
    assert.match(v.text(), /Your request for Example Orchard was not recorded: your allowance filled meanwhile\./);
    assert.equal(rereads, 2, 'the 402 re-reads the allowance');
  } finally { await v.unmount(); api.dealroomJoin = original; }
});

// Mutation checked: Add posting another deal (fails); "Added to Sourcing" not said (fails); a failed add not
// naming the room (fails); Retry not re-adding (fails).
test('DE20, DE22: Add to my deal flow from More lands in Sourcing; a failed add names the room and retries', async () => {
  const original = dealFlowApi.add; const calls = [];
  dealFlowApi.add = async (body) => { calls.push(body); const e = new Error('x'); e.status = 500; throw e; };
  const v = await mountContracts(h(DealRoomsList, {
    dealsState: { loading: false, error: false, deals: [DEAL] }, quotaState: QUOTA, onChanged: async () => {},
  }));
  try {
    await press(v, 'dr-more');
    await press(v, 'dr-add-flow');
    assert.deepEqual(calls, [{ deal_id: 7 }]);
    assert.match(v.text(), /Example Orchard could not be added to your deal flow\./);
    dealFlowApi.add = async (body) => { calls.push(body); return { deal_id: 7, stage: 'sourcing' }; };
    await press(v, 'dr-row-retry');
    assert.deepEqual(calls, [{ deal_id: 7 }, { deal_id: 7 }]);
    assert.match(v.text(), /Added to Sourcing/);
  } finally { await v.unmount(); dealFlowApi.add = original; }
});

// Mutation checked: a full allowance opening the review (fails); the full message not naming the next plan (fails).
test('DE20: with the allowance full, Request stays on the row and opens the full message, never the review', async () => {
  const original = api.dealroomJoin; const calls = [];
  api.dealroomJoin = async (id) => { calls.push(id); return { ok: true }; };
  const full = { loading: false, error: false, quota: { used: 2, cap: 2, full: true, unlimited: false, tier: 'plus', upgrade_to: 'professional', upgrade_cap: 5, member_deal_ids: [] } };
  const v = await mountContracts(h(DealRoomsList, { dealsState: { loading: false, error: false, deals: [DEAL] }, quotaState: full, onChanged: async () => {} }));
  try {
    await press(v, 'dr-join');
    assert.equal(by(v, 'dr-request-dialog').length, 0, 'no review opens');
    assert.deepEqual(calls, []);
    assert.ok(by(v, 'dr-row-refusal').length > 0, 'the full message is on the row');
    assert.match(v.text(), /Allowance full\s*You are in 2 of 2 rooms on the Plus plan\. Leave a room, or move to Professional for 5\.\s*See plans/);
  } finally { await v.unmount(); api.dealroomJoin = original; }
});
