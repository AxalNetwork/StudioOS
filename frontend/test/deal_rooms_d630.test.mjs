/**
 * D630 (#1388) — the deal-room screens of the Ops canvas, each rendered from
 * its real component in its states:
 *   dr-pipeline / dr-header — join and leave with the quota; a join refused
 *     by a full quota names the plan that raises it;
 *   dr-invites — every invited investor and how they answered;
 *   dr-transfers — every wire, and "Record a transfer" refused by open
 *     conditions as a sentence;
 *   sp-references — every check, with recording, transcript and summary
 *     reading "Not available yet";
 *   sy-close — a syndicate closes only from its confirmation.
 *
 * The Worker side (the quota read, the actor on every write, the syndicate
 * filter and close refusals) is `cloudflare-worker/test/deal_rooms_d630.test.ts`.
 */
// Stored times are UTC without a zone ('YYYY-MM-DD HH:MM:SS'). Running the
// file in another zone is what proves they are read as UTC, not local time.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  JOIN_NOTE, quotaLine, quotaFullLine, transferRefusal, amountToCents, centsMoney,
  REFERENCE_STATUS, NOT_AVAILABLE_YET, SYNDICATE_CLOSE_CONFIRM,
} from '../src/components/deals/dealRoomCopy.js';
import { QuotaLine, JoinLeaveButton } from '../src/components/deals/DealRoomJoin.jsx';
import { DealRoomsList } from '../src/components/deals/DealRoomsPanel.jsx';
import { InvitationsList } from '../src/components/deals/DealInvitationsTab.jsx';
import { TransfersView } from '../src/components/deals/DealTransfersTab.jsx';
import { ReferencesView, editableStatuses } from '../src/components/deals/DealReferencesTab.jsx';
import { SyndicateDrawer } from '../src/components/deals/DealSyndicates.jsx';
import { dealRoomTabs } from '../src/pages/DealRoomPage.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));

const QUOTA_OK = { used: 3, cap: 5, unlimited: false, full: false, tier: 'professional', upgrade_to: 'institutional', upgrade_cap: null, member_deal_ids: [1] };
const QUOTA_FULL_FREE = { used: 1, cap: 1, unlimited: false, full: true, tier: 'free', upgrade_to: 'professional', upgrade_cap: 5, member_deal_ids: [1] };
const QUOTA_FULL_PRO = { ...QUOTA_OK, used: 5, full: true };
const QUOTA_UNLIMITED = { used: 12, cap: null, unlimited: true, full: false, tier: 'institutional', upgrade_to: null, upgrade_cap: null, member_deal_ids: [] };
const ok = (quota) => ({ loading: false, error: false, quota });

const DEALS = [
  { id: 1, project_name: 'Acme', project_sector: 'Logistics', status: 'active', target_raise: 1500000, is_member: 1 },
  { id: 2, project_name: 'Birch', project_sector: 'Fintech', status: 'scored', target_raise: null, is_member: 0 },
  { id: 3, project_name: 'Passed Co', status: 'rejected', is_member: 0 },
];

// ── dr-pipeline / dr-header ────────────────────────────────────────────────

test('the quota reads used against cap, Unlimited without one, and never a zero when unreadable', () => {
  assert.equal(quotaLine(QUOTA_OK), '3 of 5 deal rooms');
  assert.equal(quotaLine({ ...QUOTA_OK, used: 0, cap: 1 }), '0 of 1 deal room');
  assert.equal(quotaLine(QUOTA_UNLIMITED), 'Unlimited deal rooms');
  assert.equal(quotaLine(null), null);
  assert.match(text(h(QuotaLine, { state: ok(QUOTA_OK) })), /^3 of 5 deal rooms$/);
  const unread = text(h(QuotaLine, { state: { loading: false, error: true, quota: null }, onRetry: () => {} }));
  assert.match(unread, /^Unreadable\. Your deal-room quota could not be read just now\. Try again$/);
  assert.doesNotMatch(unread, /\b0\b/);
});

test('a join refused by a full quota says so inline and names the plan that raises it', () => {
  assert.equal(quotaFullLine(QUOTA_FULL_FREE),
    'Your Free plan is full: you are in 1 of 1 deal room. Leave one, or change plan. Professional raises this to 5. Institutional is unlimited.');
  assert.equal(quotaFullLine(QUOTA_FULL_PRO),
    'Your Professional plan is full: you are in 5 of 5 deal rooms. Leave one, or change plan. Institutional is unlimited.');
  assert.equal(quotaFullLine(QUOTA_UNLIMITED), null);
  assert.equal(quotaFullLine({ ...QUOTA_FULL_FREE, upgrade_cap: null }),
    'Your Free plan is full: you are in 1 of 1 deal room. Leave one, or change plan.', 'no cap is typed when the server names none');

  const markup = html(h(JoinLeaveButton, { dealId: 2, member: false, quotaState: ok(QUOTA_FULL_PRO) }));
  assert.match(markup, /<button[^>]*disabled=""[^>]*data-testid="dr-join"/, 'the join is refused before it is pressed');
  assert.match(renderedText(markup), /Join deal room\s*Your Professional plan is full: you are in 5 of 5 deal rooms\. Leave one, or change plan\. Institutional is unlimited\./);
  // A member can always leave, full or not.
  const leave = html(h(JoinLeaveButton, { dealId: 1, member: true, quotaState: ok(QUOTA_FULL_PRO) }));
  assert.match(leave, /data-testid="dr-leave"/);
  assert.doesNotMatch(leave, /disabled=""|dr-quota-full/);
  // With room left, nothing is said.
  assert.doesNotMatch(html(h(JoinLeaveButton, { dealId: 2, member: false, quotaState: ok(QUOTA_OK) })), /disabled=""|dr-quota-full/);
});

test('dr-pipeline: each live deal with Join or Leave, the quota, and what joining does', () => {
  const markup = html(h(DealRoomsList, { dealsState: { loading: false, error: false, deals: DEALS }, quotaState: ok(QUOTA_OK) }));
  const t = renderedText(markup);
  assert.match(t, /3 of 5 deal rooms/);
  assert.ok(t.includes(JOIN_NOTE), 'the join note is drawn');
  assert.match(JOIN_NOTE, /It does not open the room’s documents; only an invited or committed investor reads them\./);
  assert.equal((markup.match(/data-testid="dr-pipeline-row"/g) || []).length, 2, 'a passed deal is not offered');
  assert.match(t, /Acme\s*Diligence\s*Member\s*Logistics\s*·\s*\$1,500,000\s*Leave/);
  assert.match(t, /Birch\s*Screening\s*Fintech\s*·\s*Round size: the company has not recorded one\.\s*Join deal room/);

  const full = renderedText(html(h(DealRoomsList, { dealsState: { loading: false, error: false, deals: DEALS }, quotaState: ok(QUOTA_FULL_PRO) })));
  assert.match(full, /Birch[\s\S]*Join deal room\s*Your Professional plan is full/);
});

test('dr-pipeline states: loading, empty, and an unreadable list that is never an empty one', () => {
  const st = (dealsState) => text(h(DealRoomsList, { dealsState, quotaState: ok(QUOTA_OK), onRetryDeals: () => {} }));
  assert.match(st({ loading: true, error: false, deals: null }), /Loading the pipeline…/);
  assert.match(st({ loading: false, error: false, deals: [] }), /No deal is open to join yet\./);
  const unread = st({ loading: false, error: true, deals: null });
  assert.match(unread, /Unreadable\. The pipeline could not be read just now\. Try again/);
  assert.doesNotMatch(unread, /No deal is open to join yet/);
});

// ── dr-invites ─────────────────────────────────────────────────────────────

test('dr-invites: name, email, status, the message, the email asked for, invited and answered', () => {
  const rows = [
    { id: 1, investor_name: 'Ines Invited', investor_email: 'ines@example.test', status: 'invited', message: 'Worth a look', email_opt_in: 1, created_at: '2026-10-12 09:41:00', responded_at: null },
    { id: 2, investor_name: 'Ivo Interested', investor_email: 'ivo@example.test', status: 'interested', message: null, email_opt_in: 0, created_at: '2026-10-12 09:41:00', responded_at: '2026-10-14 10:00:00' },
    { id: 3, investor_name: 'Pam Passed', investor_email: 'pam@example.test', status: 'passed', message: 'x', email_opt_in: 0, created_at: '2026-10-12 09:41:00', responded_at: '2026-10-15 11:30:00' },
  ];
  const t = text(h(InvitationsList, { state: { loading: false, error: false, rows }, onInvite: () => {} }));
  assert.match(t, /Ines Invited\s*Invited\s*ines@example\.test\s*“Worth a look”\s*Email\s*Email requested\s*Invited\s*12 Oct 2026, 09:41\s*Answered\s*Not recorded: this investor has not answered yet\./);
  assert.match(t, /Ivo Interested\s*Interested[\s\S]*No message was written\.\s*Email\s*No email[\s\S]*Answered\s*14 Oct 2026, 10:00/);
  assert.match(t, /Pam Passed\s*Passed/);
  assert.match(t, /^Invite an investor/);
  const unread = text(h(InvitationsList, { state: { loading: false, error: true, rows: null }, onRetry: () => {} }));
  assert.match(unread, /^Unreadable\. Invitations could not be read just now\. Try again$/);
  assert.match(text(h(InvitationsList, { state: { loading: false, error: false, rows: [] } })), /Nobody has been invited into this room yet\./);
});

// ── dr-transfers ───────────────────────────────────────────────────────────

const WIRES = [
  { uid: 'a', amount_cents: 5000000, reference: 'WIRE-1', phone_verified: 1, note: 'First tranche', recorded_by: 9, recorded_by_name: 'Ada Admin', recorded_at: '2026-10-12T09:41:00Z', company_id: 501, company_name: 'Alder Ventures' },
  { uid: 'b', amount_cents: 2500050, reference: null, phone_verified: 0, note: null, recorded_by: 9, recorded_by_name: 'Ada Admin', recorded_at: '2026-10-12T09:42:00Z', company_id: null, company_name: null },
];

test('dr-transfers: each wire with its amount, reference, verification, recorder, time and firm', () => {
  const t = text(h(TransfersView, { dealId: 1, state: { loading: false, error: false, rows: WIRES }, canRecord: true }));
  assert.match(t, /\$50,000\.00\s*Phone-verified\s*WIRE-1\s*First tranche\s*Recorded by\s*Ada Admin\s*When\s*12 Oct 2026, 09:41\s*Firm\s*Alder Ventures/);
  assert.match(t, /\$25,000\.50\s*Not verified\s*No reference recorded[\s\S]*Firm\s*Not recorded: the transfer was recorded without a firm\./);
  assert.match(t, /^\s*Record a transfer/);
  // A firm recorded without a stored name is still a firm, never "Not recorded".
  const unnamed = text(h(TransfersView, { dealId: 1, state: { loading: false, error: false, rows: [{ ...WIRES[0], uid: 'c', company_id: 502, company_name: null }] } }));
  assert.match(unnamed, /Firm\s*Firm #502$/);
  // Someone who may not record is offered no button, in the empty state either.
  assert.doesNotMatch(text(h(TransfersView, { dealId: 1, state: { loading: false, error: false, rows: [] }, canRecord: false })), /Record a transfer|true/);
  assert.match(text(h(TransfersView, { dealId: 1, state: { loading: false, error: false, rows: [] }, canRecord: true })), /No wire has been recorded for this round\.\s*Record a transfer$/);
  // A partner who may not record sees no button.
  assert.doesNotMatch(text(h(TransfersView, { dealId: 1, state: { loading: false, error: false, rows: WIRES }, canRecord: false })), /Record a transfer/);
});

test('dr-transfers: a transfer refused by open conditions reads as a sentence, and so does every other refusal', () => {
  const open = transferRefusal({ code: 'open_conditions_block_transfer', data: { open_conditions: 2 }, message: 'x' });
  assert.equal(open.title, '2 open conditions');
  assert.equal(transferRefusal({ code: 'open_conditions_block_transfer', data: { open_conditions: 1 } }).title, '1 open condition');
  assert.equal(transferRefusal({ code: 'open_conditions_block_transfer', data: {} }).title, 'An open condition you cannot see');
  assert.equal(transferRefusal({ code: 'open_conditions_block_transfer', data: { open_conditions: 0 } }).title, 'An open condition you cannot see');
  assert.equal(transferRefusal({ code: 'transfer_gate_unreadable' }).title, 'The closing check could not be read');
  assert.equal(transferRefusal({ code: 'transfer_amount_invalid' }).title, 'Invalid amount');
  assert.equal(transferRefusal({ code: 'transfer_firm_required' }).title, 'No firm given');
  for (const code of ['open_conditions_block_transfer', 'transfer_gate_unreadable', 'transfer_amount_invalid', 'transfer_firm_required']) {
    assert.match(transferRefusal({ code }).body, /Nothing was recorded\.$/, code);
  }

  const markup = html(h(TransfersView, {
    dealId: 1, state: { loading: false, error: false, rows: [] }, canRecord: true, initialFormOpen: true, initialRefusal: open,
  }));
  const t = renderedText(markup);
  assert.match(t, /Record a transfer[\s\S]*2 open conditions\s*A transfer cannot be recorded while closing conditions are open\. Resolve them in the commit room\. Nothing was recorded\./);
  assert.match(markup, /border-amber-300[^"]*" role="alert" data-testid="dr-refusal"/, 'open conditions are a warning, not an error');
  assert.match(t, /No wire has been recorded for this round\./);
});

test('dr-transfers: the amount is cents, and a bad amount is refused before it is sent', () => {
  assert.equal(amountToCents('50,000'), 5000000);
  assert.equal(amountToCents('12500.5'), 1250050);
  assert.equal(amountToCents('0.01'), 1);
  for (const bad of ['', '0', '-5', '1.234', 'abc', '0.00']) assert.ok(Number.isNaN(amountToCents(bad)), bad);
  assert.equal(centsMoney(1250050), '$12,500.50');
  const code = codeOnly(read('components/deals/DealTransfersTab.jsx'));
  assert.match(code, /if \(!Number\.isFinite\(cents\)\) \{ setRefusal\(transferRefusal\(\{ code: 'transfer_amount_invalid' \}\)\); return; \}/);
  assert.match(code, /amount_cents: cents,/);
  const unread = text(h(TransfersView, { dealId: 1, state: { loading: false, error: true, rows: null }, onRetry: () => {} }));
  assert.match(unread, /^Unreadable\. Transfers could not be read just now\. Try again$/);
});

// ── sp-references ──────────────────────────────────────────────────────────

const REFS = [
  { id: 1, reference_name: 'Rita Reference', reference_email: 'rita@example.test', reference_role: 'CTO', relationship: 'Former manager', scheduled_at: '2026-10-14T15:00:00Z', consent_given: true, consent_given_at: '2026-10-12T09:00:00Z', status: 'scheduled', notes: 'Asked about hiring' },
  { id: 2, reference_name: 'Rob Recorded', reference_email: null, reference_role: null, relationship: null, scheduled_at: null, consent_given: false, consent_given_at: null, status: 'recorded', notes: null },
];

test('sp-references: each check, and its recording, transcript and summary read "Not available yet"', () => {
  const markup = html(h(ReferencesView, { dealId: 1, state: { loading: false, error: false, rows: REFS } }));
  const t = renderedText(markup);
  assert.match(t, /Rita Reference\s*Scheduled\s*rita@example\.test · CTO · Former manager\s*Asked about hiring\s*Scheduled\s*14 Oct 2026, 15:00\s*Consent\s*Given 12 Oct 2026, 09:00\s*Recording\s*Not available yet\s*Transcript\s*Not available yet\s*Summary\s*Not available yet/);
  assert.match(t, /Rob Recorded\s*Recorded\s*No email, role or relationship recorded\s*Scheduled\s*Not recorded: no time has been set\.\s*Consent\s*Not recorded: consent is not yet given\./);
  assert.equal((markup.match(new RegExp(`>${NOT_AVAILABLE_YET}<`, 'g')) || []).length, 6, 'three per check');
  assert.match(t, /Schedule a reference/);
  assert.match(t, /Record consent/, 'consent can be recorded where it is missing');
  assert.equal((t.match(/Record consent/g) || []).length, 1);
  assert.equal((t.match(/Delete/g) || []).length, 2);
  // No control that can only fail: the Worker 501s all three.
  const code = codeOnly(read('components/deals/DealReferencesTab.jsx'));
  assert.doesNotMatch(code, /uploadReferenceRecording|transcribeReference|summarizeReference|getReferenceRecordingUrl/);
  assert.equal(REFERENCE_STATUS.summarized, 'Summarised');
});

test('sp-references: an edit cannot claim a recording that cannot exist', () => {
  assert.deepEqual(editableStatuses('scheduled'), ['scheduled', 'cancelled']);
  assert.deepEqual(editableStatuses('recorded'), ['recorded', 'scheduled', 'cancelled'], 'a row already there keeps its status');
  assert.deepEqual(editableStatuses(undefined), ['scheduled', 'cancelled']);
});

test('sp-references states', () => {
  assert.match(text(h(ReferencesView, { dealId: 1, state: { loading: false, error: false, rows: [] } })), /No reference has been scheduled\.\s*Schedule a reference/);
  const unread = text(h(ReferencesView, { dealId: 1, state: { loading: false, error: true, rows: null }, onRetry: () => {} }));
  assert.match(unread, /Unreadable\. References could not be read just now\. Try again$/);
  assert.doesNotMatch(unread, /No reference has been scheduled/);
  assert.match(text(h(ReferencesView, { dealId: 1, state: { loading: true, error: false, rows: null } })), /Loading references…/);
});

// ── sy-close ───────────────────────────────────────────────────────────────

const SYN = {
  id: 7, name: 'Alpha syndicate', status: 'funded', target_cents: 50000000, committed_cents: 50000000, member_count: 2, created_by: 5, creator_name: 'Cy Creator',
  members: [{ id: 1, user_id: 8, name: 'Mo Member', commitment_cents: 30000000 }, { id: 2, user_id: 9, name: 'Mia Member', commitment_cents: 20000000 }],
};
const drawer = (props) => html(h(SyndicateDrawer, { state: { loading: false, error: false, syndicate: SYN }, onClose: () => {}, ...props }));

test('sy-close: Open, Funded, Closed, with the current step marked', () => {
  const markup = drawer({ canClose: true });
  assert.match(renderedText(markup), /Open\s*→\s*Funded\s*→\s*Closed/);
  assert.match(markup, /aria-current="step">Funded</);
  assert.equal((markup.match(/aria-current="step"/g) || []).length, 1);
  assert.match(renderedText(markup), /Target\s*\$500,000\.00\s*Committed\s*\$500,000\.00\s*Members\s*2\s*Creator\s*Cy Creator/);
  assert.match(renderedText(drawer({ canClose: false, state: { loading: false, error: false, syndicate: { ...SYN, target_cents: null } } })),
    /Target\s*Not recorded: no target has been set for this syndicate\./);
});

test('sy-close: a syndicate closes only after its confirmation, which says members are not notified', () => {
  const before = drawer({ canClose: true });
  assert.match(before, /data-testid="dr-syndicate-close"/);
  assert.doesNotMatch(before, /dr-syndicate-confirm|Members are not notified/, 'the first press only asks');
  const asking = drawer({ canClose: true, initialConfirming: true });
  assert.match(renderedText(asking), /Close this syndicate\?\s*Its status becomes Closed\. Members are not notified\. Only the creator or an admin can do this\.\s*Keep it open\s*Yes, close it/);
  assert.equal(SYNDICATE_CLOSE_CONFIRM.title, 'Close this syndicate?');
  // The close call is made in one place, and only the confirmation's button reaches it.
  const code = codeOnly(read('components/deals/DealSyndicates.jsx'));
  assert.equal((code.match(/api\.networkFxCloseSyndicate\(/g) || []).length, 1);
  const fn = code.slice(code.indexOf('const confirmClose = async'), code.indexOf('return (', code.indexOf('const confirmClose = async')));
  assert.match(fn, /api\.networkFxCloseSyndicate\(s\.id\)/);
  assert.equal((code.match(/onClick=\{confirmClose\}/g) || []).length, 1);
  assert.match(code, /onClick=\{confirmClose\} disabled=\{busy\} className=\{BTN\.danger\} data-testid="dr-syndicate-confirm-close"/);
  assert.match(code, /onClick=\{\(\) => setConfirming\(true\)\} className=\{BTN\.danger\} data-testid="dr-syndicate-close"/);
  // Neither a stranger nor a closed syndicate is offered the button.
  assert.doesNotMatch(drawer({ canClose: false }), /dr-syndicate-close/);
  assert.doesNotMatch(drawer({ canClose: true, state: { loading: false, error: false, syndicate: { ...SYN, status: 'closed' } } }), /dr-syndicate-close/);
});

// ── where each screen lives ────────────────────────────────────────────────

test('the deal room adds Invitations (admin), Transfers (admin, partner) and References (admin, investor)', () => {
  assert.deepEqual(dealRoomTabs('admin'), ['Overview', 'Documents', 'Commitments', 'Activity', 'Invitations', 'Transfers', 'References']);
  assert.deepEqual(dealRoomTabs('partner'), ['Overview', 'Documents', 'Commitments', 'Activity', 'Transfers']);
  assert.deepEqual(dealRoomTabs('investor'), ['Overview', 'Documents', 'Commitments', 'Activity', 'References']);
  assert.deepEqual(dealRoomTabs('founder'), ['Overview', 'Documents', 'Commitments', 'Activity']);
  const page = codeOnly(read('pages/DealRoomPage.jsx'));
  assert.match(page, /\{isInvestor && <DealRoomMembership dealId=\{deal\.id\} \/>\}/, 'the header carries Join and Leave for an investor');
  assert.match(page, /<DealSyndicates projectId=\{deal\.project_id\} user=\{user\} \/>/);
  assert.match(page, /<DealTransfersTab dealId=\{deal\.id\} canRecord=\{isAdmin \|\| role === 'partner'\} \/>/);
  const routes = codeOnly(read('workspaces/investor/InvestorDealsRoutes.jsx'));
  assert.match(routes, /<DealRoomsPanel \/>/, '/deals carries the deal rooms to join');
});
