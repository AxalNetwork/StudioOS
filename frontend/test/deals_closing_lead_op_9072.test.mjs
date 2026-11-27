/**
 * D9072 (#9072, D6158 Q1 = A) — `/deals/closing` opens to the round's lead
 * Operating Partner, and the page agrees with the Worker
 * (`closingWorkspaceRefusal`, cloudflare-worker/test/deal_closing_lead_op_9072.test.ts):
 *
 *   · the route guard admits admin, partner and investor, and no other role;
 *   · a partner's list is the rounds they lead; an admin's and an investor's
 *     lists are as served;
 *   · a partner opening a round they do not lead, or a round with no lead,
 *     meets the refusal and no workspace; the answer waits while the list is
 *     read, and a failed read is Unavailable, never a refusal;
 *   · in the workspace the lead edits the checklist, records no transfer,
 *     closes nothing, and reads no closing record, which says so rather than
 *     "No closing record is open"; the investor's and the admin's views are
 *     unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  CLOSING_ROLES, NOT_YOUR_CLOSING, NO_LED_ROUND, CLOSING_RECORD_NOT_READ,
  leadsRound, closingDealsFor, closingSeat,
} from '../src/pages/investor/deals/closingSeatModel.js';
import ClosingWorkspace from '../src/pages/investor/deals/ClosingWorkspace.jsx';

const read = (rel) => readFileSync(rel, 'utf8');
const APP = codeOnly(read('frontend/src/App.jsx'));
const ZONE = codeOnly(read('frontend/src/pages/investor/deals/ClosingZone.jsx'));
const ROUTES = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));

const LEAD = { id: 20, role: 'partner' };
const OTHER = { id: 21, role: 'partner' };
const ADMIN = { id: 1, role: 'admin' };
const INVESTOR = { id: 42, role: 'investor' };
const DEALS = [
  { id: 71, lead_partner_id: 20, project_name: 'Fixture One' },
  { id: 72, lead_partner_id: 21, project_name: 'Fixture Two' },
  { id: 73, lead_partner_id: null, project_name: 'Fixture Three' },
];

test('the /deals/closing route guard admits admin, partner and investor, as the model says', () => {
  const m = /<Route path="\/deals\/closing" element=\{guard\((\[[^\]]*\])/.exec(APP);
  assert.ok(m, 'the /deals/closing route is guarded');
  const roles = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual([...roles].sort(), [...CLOSING_ROLES].sort());
  assert.ok(roles.includes('partner'), 'an Operating Partner reaches the route');
  for (const role of ['founder', 'advisor', 'exploring']) assert.ok(!roles.includes(role), `${role} is not admitted`);
});

test('a partner reaches Closing from the Deals section nav', () => {
  assert.match(ROUTES, /role==='partner'\?<nav[^]*?to="\/deals\/commit">Commit<\/Link>[^]*?to="\/deals\/closing"[^>]*>Closing<\/Link><\/nav>/);
});

test('leadsRound: only the partner named as lead, never a round with no lead', () => {
  assert.equal(leadsRound(LEAD, DEALS[0]), true);
  assert.equal(leadsRound(LEAD, { lead_partner_id: '20' }), true, 'an id read as text still matches');
  assert.equal(leadsRound(OTHER, DEALS[0]), false);
  assert.equal(leadsRound(LEAD, DEALS[2]), false, 'a round with no lead is led by no one');
  assert.equal(leadsRound({ role: 'partner' }, { lead_partner_id: null }), false, 'no id never matches no lead');
  assert.equal(leadsRound({ id: 0, role: 'partner' }, { lead_partner_id: 0 }), false);
});

test('a partner’s list is the rounds they lead; the admin’s and the investor’s are as served', () => {
  assert.deepEqual(closingDealsFor(LEAD, DEALS).map((d) => d.id), [71]);
  assert.deepEqual(closingDealsFor(OTHER, DEALS).map((d) => d.id), [72]);
  assert.deepEqual(closingDealsFor({ id: 99, role: 'partner' }, DEALS), []);
  assert.equal(closingDealsFor(ADMIN, DEALS), DEALS);
  assert.equal(closingDealsFor(INVESTOR, DEALS), DEALS);
  assert.equal(closingDealsFor(LEAD, null), null, 'a list not yet read stays unread');
});

test('closingSeat: the lead is admitted, any other partner refused, and the answer waits for the list', () => {
  assert.equal(closingSeat(LEAD, DEALS[0]), 'lead');
  assert.equal(closingSeat(OTHER, DEALS[0]), 'refused', 'the lead of another round is refused');
  assert.equal(closingSeat(LEAD, DEALS[2]), 'refused', 'nobody leads this round');
  assert.equal(closingSeat(LEAD, null), 'refused', 'a round missing from the partner’s list is not theirs');
  assert.equal(closingSeat(LEAD, undefined), 'pending', 'while the list is read');
  assert.equal(closingSeat(ADMIN, null), 'admin');
  assert.equal(closingSeat(INVESTOR, null), 'investor', 'the investor is not narrowed here');
  assert.equal(closingSeat({ id: 5, role: 'founder' }, DEALS[0]), 'refused');
});

test('the zone narrows a partner’s list and refuses a round they do not lead', () => {
  assert.match(ZONE, /setDeals\(closingDealsFor\(seatUser, /, 'the list read is narrowed for a partner');
  assert.match(ZONE, /const seat = closingSeat\(seatUser, deals === null \? undefined : deal\);/);
  assert.match(ZONE, /seatRole === 'partner' && deals === UNAVAILABLE[^]*?data-testid="closing-seat-unavailable"/, 'a failed read is Unavailable for a partner');
  assert.match(ZONE, /if \(seat === 'pending'\) return/);
  assert.match(ZONE, /if \(seat === 'refused'\) \{[^]*?data-testid="closing-seat-refused"[^]*?\{NOT_YOUR_CLOSING\}/);
  // The refusal comes before the workspace is drawn.
  assert.ok(ZONE.indexOf("seat === 'refused'") < ZONE.indexOf('<ClosingWorkspace'), 'no workspace is drawn for a refused partner');
  assert.match(ZONE, /body=\{seatRole === 'partner' \? NO_LED_ROUND : EMPTY_BODY\}/);
  assert.match(NOT_YOUR_CLOSING, /lead Operating Partner or an Admin/);
  assert.match(NO_LED_ROUND, /You lead no round at closing/);
});

const render = (user) => renderToStaticMarkup(h(MemoryRouter, null, h(ClosingWorkspace, {
  dealId: 71, deal: DEALS[0], user, onBack: () => {}, onRecordTransfer: () => {},
})));

test('the lead’s workspace: no closing record read, and it says so rather than "none is open"', () => {
  const html = render(LEAD);
  assert.match(html, /data-testid="closing-workspace"/);
  assert.match(html, /data-testid="close-rules-not-read"/);
  assert.ok(html.includes(CLOSING_RECORD_NOT_READ), 'the stated limit is drawn');
  assert.match(html, /data-testid="closing-record-not-read"/);
  assert.doesNotMatch(html, /No closing record is open on this deal/);
  assert.doesNotMatch(html, /close-rules-loading/);
  assert.doesNotMatch(html, /read only/, 'the lead is not read-only');
  assert.match(html, /data-testid="closing-tab-audit"/, 'the lead keeps the Audit tab (D6866: not for investors)');
});

test('the investor’s and the admin’s workspaces are unchanged', () => {
  const inv = render(INVESTOR);
  assert.match(inv, /Closing workspace · read only/);
  assert.doesNotMatch(inv, /closing-tab-audit/);
  assert.doesNotMatch(inv, /close-rules/);
  assert.doesNotMatch(inv, /closing-record-not-read/);
  const admin = render(ADMIN);
  assert.match(admin, /data-testid="close-rules-loading"/, 'the admin reads the closing record');
  assert.doesNotMatch(admin, /close-rules-not-read|closing-record-not-read/);
});

test('the workspace asks for no closing record as the lead, and reads it for everyone else', () => {
  const WS = codeOnly(read('frontend/src/pages/investor/deals/ClosingWorkspace.jsx'));
  assert.match(WS, /const lead = role === 'partner';/);
  assert.match(WS, /if \(lead\) put\('closing', ok\(null\)\);\s*else closingsApi\.list\(\)/);
  assert.match(WS, /const canEditChecklist = isAdmin \|\| lead;/, 'the lead edits the checklist');
  assert.match(WS, /if \(isAdmin\) dealStaffApi\.transferGate/, 'only an Admin reads the transfer gate, so the lead records no transfer');
});
