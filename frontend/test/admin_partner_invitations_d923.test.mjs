/**
 * D923 (#2370) — Partner invitations at /admin/partner-invitations/*,
 * integrated from the owner's "Partner invitations" canvas (PI1–PI12) and
 * wired to the reads that already exist.
 *
 * What this file holds the desk to:
 *   · Guard I: the stored status in the canvas's words, Lapsed with its dots
 *     kept, a stored `expired` read as signed-after-lapse, the repair after a
 *     resend, and the resent flag;
 *   · Guard L: a list at its cap says what it covers ("200+", "within the
 *     newest 200", "of the first 500"), never a total;
 *   · Guard F: a sum over the redemptions fan-out is exact only when the deal
 *     set is complete, every call answered and each returned its whole count;
 *   · the tier and term rules, the agreement-ready rule, the dialogs' words,
 *     the Resend sentence by stage, and one-sentence refusals;
 *   · the addresses, the redirect and every wiring place D923 §1 names;
 *   · mounted against a stubbed Worker: a failed read is Unreadable and never
 *     "No invitations yet", counts at the cap, the create result stays until
 *     Done, Terminate waits for a reason. (Firm links moved to Advisors &
 *     Partners › Firms with D952; its mounted test is in admin_advisors_partners_d972.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import PartnerInvitations from '../src/pages/admin/PartnerInvitations.jsx';
import { parseStamp as uiParseStamp } from '../src/ui/parseStamp.js';
import {
  AGREEMENT_BANNER, AGREEMENT_LAPSE_WARNING, CAPS, COMMUNITY_PATH, DEAL_NOT_ACTIVE, DEAL_STATE_KEYS, EMPTY_TITLE, FIRMS_TAB_PATH, FOUNDER_NO_PLAN,
  FROZEN, INVITATION_CLOSED, LINE, MOVED_LINE, MOVED_PATH, NOT_IN_READ, NOT_READ_YET, STORED_EXPIRED_WORD, TABS, TITLE, TRY_AGAIN, TYPE_FULL,
  WITHIN_DEALS, WITHIN_INVITATIONS, agreementReady, allTimeRedemptions, cameFromOldAddress, countClosing30, countLast90, countOpenWindows,
  createdLines, day, daysLeft, daysUsed, ddFor, dealFromSearch, dealState, dealTypeWord, dealsCount, dotsLabel, duplicateCheck, expiresCell,
  fanFigure, fanOut, filterInvitations, firmCounts, invitationRow, isCompleteEmail, isFirstUse, isLapsed, memberCheck, noMatchLine, obligationsLine,
  offeredTypes, pageOf, parseStamp, rangeText, redemptionDealSet, redemptionRow, refusalText, resendCopy, resentAt, revokeCopy, revokeVariant,
  revokedLine, routeFor, signingLink, stageOf, tabCounts, tabPath, terminateCopy, terminateReady, termText, tiersText, toggleType, windowOf,
  withoutMoved,
} from '../src/pages/admin/partners/partnersDeskModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 86_400_000;
const d1 = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const isoAt = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends
 * ------------------------------------------------------------------ */

// GET /api/admin/partners/invitations — one row. Created 4 days ago and
// never resent: create sets `expires_at` to now + 14 days a moment before the
// insert stamps `created_at` in whole seconds.
const inv = (id, o = {}, now = NOW) => {
  const { createdMs = now - 4 * DAY, ...rest } = o;
  return {
    id, token: `tok${id}`, recipient_email: `p${id}@example.com`, recipient_name: `Partner ${id}`, allowed_deal_types: ['services_partnership'],
    status: 'sent', expires_at: isoAt(createdMs + 14 * DAY + 400), created_at: d1(createdMs), viewed_at: null, signed_at: null,
    resulting_user_id: null, resulting_deal_id: null, envelope_id: null, revoked_at: null, invited_by_name: 'Admin A',
    link: `https://axal.vc/partners/onboard?token=tok${id}`, is_expired: false, ...rest,
  };
};
// GET /api/admin/partners/deals?status= — one row.
const deal = (id, o = {}) => ({
  id, invitation_id: null, user_id: 500 + id, deal_type: 'services_partnership',
  proposal: { deal_type: 'services_partnership', label: 'Services Partnership', summary: 'Operating-partner engagement.', terms: { rate: 'Negotiated per SOW' } },
  granted_tier_founder: 'founder_pro', granted_tier_investor: null, term_months: 12, referral_code: `PART-${id}`, envelope_id: 900 + id, status: 'active',
  activated_at: '2026-07-04 10:00:00', expires_at: '2027-06-29T10:00:00.000Z', terminated_at: null, termination_reason: null, created_at: '2026-06-30 09:00:00',
  partner_email: `d${id}@example.com`, partner_name: `Dana ${id}`, redemptions_count: 0, ...o,
});
// GET /api/admin/partners/deals/:id/redemptions — one item.
const redemption = (id, redeemedMs, o = {}) => ({
  id, redeemed_at: d1(redeemedMs), granted_tier_founder: 'founder_pro', granted_tier_investor: null, granted_until: '2027-06-29T10:00:00.000Z',
  attribution_kind: 'referral', user_id: 700 + id, redeemer_name: `Member ${id}`, redeemer_email: `m${id}@example.com`, revshare_window_remaining_days: null, ...o,
});
const ready = (data) => ({ status: 'ready', data, error: null });
const failed = (error = { status: 503 }) => ({ status: 'error', data: null, error });
const loading = () => ({ status: 'loading', data: null, error: null });
const lists = (o = {}) => Object.fromEntries(DEAL_STATE_KEYS.map((k) => [k, o[k] ?? ready([])]));
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the addresses: four tabs, one address per invitation and per deal, the old address moved, and Firm links gone to the Firms tab', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [
    ['Overview', '/admin/partner-invitations'], ['Invitations', '/admin/partner-invitations/invitations'],
    ['Deals', '/admin/partner-invitations/deals'], ['Referrals', '/admin/partner-invitations/referrals'],
  ]);
  assert.deepEqual(routeFor('/admin/partner-invitations'), { tab: 'overview', record: null });
  assert.deepEqual(routeFor('/admin/partner-invitations/'), { tab: 'overview', record: null });
  assert.deepEqual(routeFor('/admin/partner-invitations/invitations/12'), { tab: 'invitations', record: { kind: 'invitation', id: '12' } });
  assert.deepEqual(routeFor('/admin/partner-invitations/deals/41'), { tab: 'deals', record: { kind: 'deal', id: '41' } });
  assert.deepEqual(routeFor('/admin/partner-invitations/referrals'), { tab: 'referrals', record: null });
  // D952: the desk no longer draws Firm links; App.jsx forwards its address to the Firms tab.
  assert.equal(FIRMS_TAB_PATH, '/admin/advisors-partners/firms');
  assert.equal(tabPath('firm-links'), '/admin/partner-invitations', 'an unknown tab is Overview');
  assert.equal(tabPath('deals'), '/admin/partner-invitations/deals');
  assert.equal(MOVED_PATH, '/admin/partner-invitations?moved=partners');
  assert.equal(cameFromOldAddress('?moved=partners'), true);
  assert.equal(cameFromOldAddress('?moved=held-insights'), false);
  assert.equal(withoutMoved('?moved=partners&deal=4'), '?deal=4');
  assert.equal(dealFromSearch('?deal=7'), '7');
  assert.equal(dealFromSearch('?deal=x'), null);
  assert.equal(COMMUNITY_PATH, '/admin/community', 'the crumb links Community\'s own address (D930), not the redirect');
  assert.equal(TITLE, 'Partner invitations');
  assert.equal(LINE, 'Bring operating partners in, see where each invitee stands, and keep their deals healthy.');
  assert.equal(MOVED_LINE, 'Partner invitations has a new address. Update your bookmark.');
});

test('Guard I: R1\'s stored status in the canvas\'s words, with the dots\' text label', () => {
  const words = { sent: 'Sent', viewed: 'Opened', profiled: 'Profile done', proposed: 'Offers shown', selected: 'Offer chosen', finalized: 'Agreement out', signed: 'Signed', revoked: 'Revoked' };
  for (const [stored, word] of Object.entries(words)) {
    const s = stageOf(inv(1, { status: stored, envelope_id: stored === 'finalized' ? 77 : null }), { proposed: ready([]), now: NOW });
    assert.equal(s.word, word, stored);
  }
  assert.equal(dotsLabel(stageOf(inv(1, { status: 'selected' }), { proposed: ready([]), now: NOW })), 'Step 5 of 7: Offer chosen');
  assert.equal(stageOf(inv(1, { status: 'revoked' }), { now: NOW }).step, null, 'revoke overwrites the stage, so Revoked draws no dots');
  const late = stageOf(inv(1, { status: 'expired', is_expired: true }), { now: NOW });
  assert.equal(late.word, 'Signed after the link lapsed · deal voided');
  assert.equal(late.word, STORED_EXPIRED_WORD);
  assert.equal(late.closed, true);
  assert.equal(late.lapsed, false, 'a stored expired is not Lapsed');
  assert.equal(stageOf(inv(1, { status: 'archived' }), { now: NOW }).word, 'Stage not recognised', 'a raw stored word never shows');
});

test('Guard I: Lapsed keeps the dots at the stage reached, and its Expires cell says what a signature now would do', () => {
  const mara = inv(2, { recipient_name: 'Mara Example', status: 'selected', createdMs: NOW - 30 * DAY, is_expired: true });
  const s = stageOf(mara, { proposed: ready([]), now: NOW });
  assert.equal(s.word, 'Lapsed');
  assert.equal(s.lapsed, true);
  assert.equal(s.step, 5, 'the dots stay at Offer chosen, as the canvas draws Mara');
  assert.equal(dotsLabel(s), 'Step 5 of 7: Offer chosen, link lapsed');
  assert.deepEqual(expiresCell(mara, s), { text: 'Lapsed 8 Oct 2026', tone: 'amber', warn: null });
  const out = inv(3, { status: 'finalized', envelope_id: 77, createdMs: NOW - 30 * DAY, is_expired: true });
  assert.equal(expiresCell(out, stageOf(out, { now: NOW })).warn, AGREEMENT_LAPSE_WARNING);
  assert.equal(AGREEMENT_LAPSE_WARNING, 'A signature now would be voided. Resend renews the link.');
  for (const status of ['signed', 'revoked', 'expired']) {
    assert.equal(isLapsed(inv(4, { status, is_expired: true }), NOW), false, `${status} is closed, never Lapsed`);
    assert.equal(expiresCell(inv(4, { status }), stageOf(inv(4, { status }), { now: NOW })).text, 'Closed');
  }
  assert.equal(isLapsed(inv(5, { is_expired: undefined, expires_at: isoAt(NOW - DAY) }), NOW), true, 'with no flag, the stamp decides');
});

test('Guard I: after a resend the page repairs the stage — envelope_id proves Agreement out, a proposed deal lifts to Offer chosen, an unreadable list says "Stage may lag"', () => {
  const resent = (o) => inv(9, { status: 'sent', createdMs: NOW - 20 * DAY, expires_at: isoAt(NOW + 10 * DAY), ...o });
  const out = stageOf(resent({ envelope_id: 77 }), { proposed: failed(), now: NOW });
  assert.equal(out.word, 'Agreement out');
  assert.equal(out.repaired, true);
  assert.equal(out.mayLag, false, 'R1 proves Agreement out with no cap');
  const chosen = stageOf(resent(), { proposed: ready([deal(3, { status: 'proposed', invitation_id: 9 })]), now: NOW });
  assert.equal(chosen.word, 'Offer chosen');
  assert.equal(chosen.step, 5);
  const lag = stageOf(resent(), { proposed: failed(), now: NOW });
  assert.equal(lag.word, 'Sent');
  assert.equal(lag.mayLag, true, 'the deals could not be read');
  assert.equal(stageOf(resent(), { proposed: ready(many(CAPS.deals, (i) => deal(i, { status: 'proposed', invitation_id: 1000 + i }))), now: NOW }).mayLag, true, 'the proposed list is at its cap');
  assert.equal(stageOf(resent(), { proposed: ready([deal(3, { status: 'proposed', invitation_id: 8 })]), now: NOW }).mayLag, false, 'below the cap the absence is real');
  assert.equal(stageOf(inv(9), { proposed: failed(), now: NOW }).mayLag, false, 'a row never resent cannot lag');
  assert.equal(stageOf(resent({ status: 'signed', envelope_id: 77 }), { now: NOW }).word, 'Signed');
});

test('the resent flag: expires_at less 14 days later than created_at, and every D1 stamp read as UTC', () => {
  assert.equal(resentAt(inv(1, { createdMs: Date.parse('2026-10-01T09:00:00Z') })), null, 'create\'s own moment apart is not a resend');
  const r = inv(1, { createdMs: Date.parse('2026-10-01T09:00:00Z'), expires_at: '2026-10-30T12:00:00.000Z' });
  assert.equal(resentAt(r), Date.parse('2026-10-16T12:00:00Z'));
  const row = invitationRow(r, { proposed: ready([]), now: NOW });
  assert.equal(row.sent, '1 Oct 2026');
  assert.equal(row.resent, '16 Oct 2026');
  assert.equal(invitationRow(inv(1), { proposed: ready([]), now: NOW }).resent, null);
  // Read in a zone far from UTC, so a stamp parsed as local time could not pass by luck.
  const zone = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  try {
    assert.equal(parseStamp('2026-10-01 23:30:00'), Date.parse('2026-10-01T23:30:00Z'), 'a zone-less D1 stamp is UTC');
    assert.equal(day('2026-10-01 23:30:00'), '1 Oct 2026');
  } finally {
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
  assert.equal(parseStamp('2026-10-30T12:00:00.000Z'), Date.parse('2026-10-30T12:00:00Z'));
  assert.equal(parseStamp(null), null);
  assert.equal(parseStamp, uiParseStamp, 'the desk reads the one parseStamp in ui/');
});

test('Guard L: a list at its cap says what it covers, never a total', () => {
  const full = ready(many(CAPS.invitations, (i) => inv(i)));
  const some = ready(many(37, (i) => inv(i)));
  assert.equal(tabCounts({ invitations: full, deals: lists(), contracts: failed(), needs: null }).invitations.text, '200+');
  assert.equal(tabCounts({ invitations: some, deals: lists(), contracts: failed(), needs: null }).invitations.text, '37');
  assert.equal(WITHIN_INVITATIONS, 'Within the newest 200 by first send');
  // Deals: R5's total is exact; the six lists' sum is a floor at a cap, and nothing when one failed.
  assert.deepEqual(dealsCount(ready({ items: [], total: 312, complete: true }), lists()), { text: '312', title: 'Every deal, in every state' });
  assert.deepEqual(dealsCount(failed(), lists({ active: ready(many(200, (i) => deal(i))), proposed: ready([deal(901, { status: 'proposed' })]) })), { text: '201+', title: WITHIN_DEALS });
  assert.equal(dealsCount(failed(), lists({ voided: failed() })), null, 'a failed list gives no count rather than a smaller one');
  assert.equal(rangeText(pageOf(many(200, (i) => i), 1), WITHIN_INVITATIONS), '1–25 of 200 · within the newest 200 by first send');
  assert.equal(rangeText(pageOf(many(30, (i) => i), 2)), '26–30 of 30');
  assert.equal(noMatchLine('zz', false), 'No invitation matches ‘zz’.');
  assert.equal(noMatchLine('zz', true), 'None of the newest 200 match ‘zz’.');
  // Firm links, DD and the member check, each at its own cap.
  const accounts = many(CAPS.links, (i) => ({ id: i, email: `a${i}@x.co`, partner_id: i <= 18 ? null : 4 }));
  assert.equal(firmCounts({ accounts, firms: [{ id: 4 }] }).cover, 'Counted over the first 500 partner accounts.');
  assert.equal(firmCounts({ accounts: accounts.slice(0, 20), firms: [{ id: 4 }] }).text, '2 attached · 18 not · 1 firms on record');

  assert.equal(ddFor(deal(1), ready(many(CAPS.cases, (i) => ({ subject_id: 9000 + i, status: 'open' })))).text, NOT_IN_READ);
  assert.equal(ddFor(deal(1), ready([])).text, 'No case on record');
  assert.equal(memberCheck(ready(many(CAPS.users, (i) => ({ email: `x${i}@lio.co`, role: 'founder' }))), 'lio.co@lio.co').state, 'failed', 'a full page of matches cannot prove "not a member"');
});

test('Guard F: a sum over the fan-out is exact only when the set is complete, every call answered, and each returned its whole count', () => {
  const contracts = ready({ items: [{ id: 1, redemption_count: 2 }, { id: 2, redemption_count: 0 }, { id: 3, redemption_count: 1 }], total: 3, complete: true });
  const set = redemptionDealSet(contracts, lists());
  assert.deepEqual(set.deals, [{ id: '1', count: 2 }, { id: '3', count: 1 }], 'from R5, the deals with redemptions');
  assert.equal(set.complete, true);
  const answer = (items, o = {}) => ready({ deal: { id: 1, deal_type: 'services_partnership', status: 'active', ...o }, items });
  const calls = new Map([['1', answer([redemption(1, NOW - 10 * DAY), redemption(2, NOW - 100 * DAY)])], ['3', answer([redemption(3, NOW - 5 * DAY)])]]);
  assert.deepEqual(fanFigure(fanOut(set, calls), countLast90(NOW)), { state: 'ready', n: 2, value: '2' });
  // (2) a call failed: never a smaller number, even when it holds rows from an earlier read.
  const broken = new Map([...calls, ['3', { status: 'error', data: { items: [] }, error: { status: 503 } }]]);
  assert.deepEqual(fanFigure(fanOut(set, broken), countLast90(NOW)), { state: 'unreadable', figure: 'Could not be read for 1 of 2 deals', reason: '1 of 2 deals did not answer, so no partial sum is drawn.' });
  assert.equal(fanFigure(fanOut(set, new Map([['1', calls.get('1')]])), countLast90(NOW)).state, 'loading');
  // (3) a deal's redeemers stop at 500.
  const big = redemptionDealSet(ready({ items: [{ id: 1, redemption_count: 640 }], total: 1, complete: true }), lists());
  const capped = fanFigure(fanOut(big, new Map([['1', answer(many(500, (i) => redemption(i, NOW - DAY)))]])), countLast90(NOW));
  assert.deepEqual(capped, { state: 'ready', n: 500, value: '500+', sub: 'Counted over the first 500 redemptions of 1 deal.', exact: false });
  // (1) the deal set came from lists at their cap: not complete.
  const fromLists = redemptionDealSet(failed(), lists({ active: ready(many(200, (i) => deal(i, { redemptions_count: i === 1 ? 1 : 0 }))) }));
  assert.equal(fromLists.complete, false);
  assert.deepEqual(fanFigure(fanOut(fromLists, new Map([['1', answer([redemption(1, NOW - DAY)])]])), countLast90(NOW)).sub, `${WITHIN_DEALS}.`);
  assert.equal(redemptionDealSet(failed(), lists({ terminated: failed() })).state, 'unreadable', 'a list that can hold redemptions failed');
  assert.equal(redemptionDealSet(failed(), lists({ voided: failed() })).state, 'ready', 'a voided deal never redeemed, so its list does not matter');
  assert.equal(redemptionDealSet(loading(), lists()).state, 'loading');
  // A sum with nothing to cover is a real 0.
  assert.deepEqual(fanFigure(fanOut(redemptionDealSet(ready({ items: [], total: 0, complete: true }), lists()), new Map()), countLast90(NOW)), { state: 'ready', n: 0, value: '0' });
  // All time: R5 first, the three lists under Guard L as the fallback.
  assert.equal(allTimeRedemptions(contracts, lists()).value, '3');
  assert.equal(allTimeRedemptions(failed(), lists({ active: ready([deal(1, { redemptions_count: 4 })]), expired: ready([deal(2, { status: 'expired', redemptions_count: 2 })]) })).value, '6');
  assert.equal(allTimeRedemptions(failed(), lists({ active: ready(many(200, (i) => deal(i, { redemptions_count: 1 }))) })).value, '200+');
  assert.equal(allTimeRedemptions(failed(), lists({ expired: failed() })).state, 'unreadable');
  assert.equal(allTimeRedemptions(failed(), lists({ active: ready([deal(1, { redemptions_count: null })]) })).state, 'unreadable', 'a count that is not a number is never read as 0');
});

test('a rev-share window counts as open only while its deal is active (O-WIN), and an ended deal\'s grant says so', () => {
  const rs = (left, status = 'active') => ({ ...redemption(1, NOW - DAY, { attribution_kind: 'deal_sourcing_revshare', revshare_window_remaining_days: left }), deal: { deal_type: 'deal_sourcing_revshare', status } });
  assert.deepEqual(windowOf(rs(12)), { key: 'open', days: 12, text: '12 days left' });
  assert.equal(windowOf(rs(1)).text, '1 day left');
  assert.equal(windowOf(rs(0)).text, 'Closed');
  assert.equal(windowOf(rs(40, 'terminated')).text, 'Deal ended');
  assert.equal(windowOf({ ...redemption(2, NOW), deal: { deal_type: 'services_partnership', status: 'active' } }).text, 'No window');
  const items = [rs(12), rs(45), rs(0), rs(20, 'terminated')];
  assert.equal(countOpenWindows(items), 2);
  assert.equal(countClosing30(items), 1);
  const ended = redemptionRow({ ...redemption(3, NOW - DAY), dealId: '7', deal: { id: 7, status: 'terminated', partner_name: 'Dana 7', referral_code: 'PART-7' } }, [deal(7, { status: 'terminated', terminated_at: '2026-10-01 08:00:00' })]);
  assert.equal(ended.grantedUntil, 'Ended with the deal 1 Oct 2026');
  assert.equal(ended.role, NOT_READ_YET);
  assert.equal(ended.tiers, FOUNDER_NO_PLAN);
});

test('tiers: the stored investor tier is drawn, and "Founder Pro" never is', () => {
  assert.equal(tiersText('founder_pro', 'professional'), 'Investor Professional · Founder grant: no plan');
  assert.equal(tiersText('founder_pro', 'institutional'), 'Investor Institutional · Founder grant: no plan');
  assert.equal(tiersText('founder_pro', null), 'Founder grant: no plan');
  assert.equal(tiersText('studio', null), 'Founder Studio', 'a real founder plan is a plan');
  assert.equal(tiersText(null, null), 'No tier granted');
  for (const t of [tiersText('founder_pro', 'professional'), tiersText('founder_pro', null)]) assert.doesNotMatch(t, /Founder Pro|founder_pro/);
});

test('term: the stored start and end, never an end from months, and never negative days', () => {
  assert.equal(termText(deal(1)), '4 Jul 2026 – 29 Jun 2027');
  assert.equal(termText(deal(1, { status: 'proposed', activated_at: null, expires_at: null })), 'Starts on signing');
  assert.equal(termText(deal(1, { status: 'voided', activated_at: null })), 'Never started');
  assert.deepEqual(daysLeft(deal(1, { expires_at: isoAt(NOW + 20 * DAY) }), NOW), { text: '20 days', days: 20, tone: 'amber' });
  assert.deepEqual(daysLeft(deal(1, { expires_at: isoAt(NOW + 30 * DAY) }), NOW).tone, 'amber', 'amber at 30 or under');
  assert.deepEqual(daysLeft(deal(1, { expires_at: isoAt(NOW + 45 * DAY) }), NOW), { text: '45 days', days: 45, tone: null });
  const past = daysLeft(deal(1, { expires_at: isoAt(NOW - 3 * DAY) }), NOW);
  assert.equal(past.text, 'Term ended, not yet closed');
  assert.doesNotMatch(past.text, /-\d/);
  assert.equal(daysLeft(deal(1, { status: 'terminated', terminated_at: '2026-10-01 08:00:00' }), NOW).text, 'Ended 1 Oct 2026');
  assert.equal(daysLeft(deal(1, { status: 'expired', expires_at: '2026-09-30T10:00:00.000Z' }), NOW).text, 'Ended 30 Sep 2026');
  assert.equal(daysLeft(deal(1, { status: 'awaiting_signature' }), NOW).text, 'Starts on signing');
  const used = daysUsed(deal(1), NOW);
  assert.equal(used.total, 360, 'the stored end less the stored start: 12 months is 360 days here');
  assert.equal(used.used, 112);
});

test('the agreement-ready rule: R8 refuses, or it lists a field finalize leaves empty; R8 failing any other way says nothing', () => {
  assert.equal(agreementReady(loading()).state, 'loading');
  assert.deepEqual(agreementReady(failed({ status: 409, code: 'template_has_no_body' })), { state: 'not_ready', why: 'template_has_no_body' });
  assert.equal(agreementReady(failed({ status: 503, code: 'template_unreadable' })).state, 'not_ready');
  assert.equal(agreementReady(failed({ status: 500 })).state, 'unknown');
  assert.equal(agreementReady(failed({ status: 423, code: 'recovery_cool_off_active' })).state, 'unknown', 'a paused read is not a verdict');
  const five = ['partner_name', 'partner_email', 'effective_date', 'deal_type', 'term_months'].map((key) => ({ key, filled_by: key === 'effective_date' ? 'send' : 'sender' }));
  assert.deepEqual(agreementReady(ready({ fields: [...five, { key: 'recipient_name', filled_by: 'send' }] })), { state: 'ready' });
  assert.deepEqual(agreementReady(ready({ fields: [...five, { key: 'scope', filled_by: 'sender' }] })), { state: 'not_ready', why: 'fields', fields: ['scope'] });
  assert.deepEqual(agreementReady(ready({ fields: [...five, { key: 'counterparty.company', filled_by: 'send' }] })).fields, ['counterparty.company'], 'this flow never fills a counterparty field');
  assert.equal(agreementReady(ready({})).state, 'unknown');
  assert.equal(AGREEMENT_BANNER, 'The Partner Services agreement is not ready. Invitees who choose an offer cannot sign until it is completed in Contracts.');
});

test('Resend says the renewed date, then one line by stage; at Agreement out it reads the signing link', () => {
  const env = (until) => ready({ id: 77, status: 'sent', created_at: '2026-10-20 10:00:00', recipients: [{ status: 'pending', token_expires_at: until }] });
  const copy = (o, envelope = loading()) => resendCopy(inv(1, { recipient_name: 'Mara Example', ...o }), stageOf(inv(1, o), { proposed: ready([]), now: NOW }), envelope, NOW);
  assert.equal(copy({}).title, 'Resend the invitation to Mara Example?');
  assert.deepEqual(copy({}).lines, ['The link gets a new 14 days, until 7 Nov 2026.']);
  assert.equal(copy({ status: 'selected' }).lines[1], 'Mara Example’s chosen offer is kept.');
  for (const status of ['profiled', 'proposed']) assert.equal(copy({ status }).lines[1], 'Their answers are kept. The stage shown here goes back to Sent until they continue.', status);
  assert.equal(copy({ status: 'finalized', envelope_id: 77 }, env('2026-10-28T10:00:00.000Z')).lines[1], 'The agreement already sent stays open to signature until 28 Oct 2026.');
  const expired = copy({ status: 'finalized', envelope_id: 77 }, env('2026-10-20T10:00:00.000Z'));
  assert.equal(expired.lines[1], 'The signing link expired on 20 Oct 2026. Resending does not renew it. The original sender can send a reminder from the envelope page.');
  assert.equal(expired.expiredSigning, true);
  assert.equal(copy({ status: 'finalized', envelope_id: 77 }, failed()).lines[1], 'Whether the agreement’s signing link is still open could not be read.');
  // A future token date does not make a signed or voided envelope's link live.
  const closed = (status) => ready({ id: 77, status, created_at: '2026-10-20 10:00:00', recipients: [{ status: 'pending', token_expires_at: '2026-10-28T10:00:00.000Z' }] });
  assert.equal(copy({ status: 'finalized', envelope_id: 77 }, closed('completed')).lines[1], 'The agreement already sent is signed. Resending does not change it.');
  for (const status of ['voided', 'declined']) {
    assert.equal(copy({ status: 'finalized', envelope_id: 77 }, closed(status)).lines[1], 'The agreement already sent was voided. Resending does not send a new one.', status);
  }
  assert.equal(copy({ status: 'finalized', envelope_id: 77 }, closed('draft')).lines[1], 'The agreement already sent is not out for signature. Resending does not change it.');
  assert.equal(copy({ status: 'finalized', envelope_id: 77 }, closed('partially_signed')).lines[1], 'The agreement already sent stays open to signature until 28 Oct 2026.');
  assert.deepEqual(['completed', 'voided', 'draft'].map((s) => signingLink(closed(s), NOW).state), ['signed', 'voided', 'other']);
  assert.equal(resendCopy(inv(1, { recipient_name: null }), stageOf(inv(1), { now: NOW }), loading(), NOW).title, 'Resend the invitation to p1@example.com?');
  assert.doesNotMatch(JSON.stringify(copy({ status: 'selected' })), /Her progress|Delivered/);
});

test('Revoke picks its variant and shows voided counts only above zero; Terminate says what the Worker does', () => {
  assert.equal(revokeVariant(inv(1, { envelope_id: 77 }), lists()), 'long');
  assert.equal(revokeVariant(inv(1), lists({ proposed: ready([deal(3, { status: 'proposed', invitation_id: 1 })]) })), 'long');
  assert.equal(revokeVariant(inv(1), lists({ awaiting_signature: failed() })), 'long', 'unsure: the long one');
  assert.equal(revokeVariant(inv(1), lists({ proposed: ready(many(200, (i) => deal(i, { status: 'proposed', invitation_id: 1000 + i }))) })), 'long');
  assert.equal(revokeVariant(inv(1), lists()), 'short');
  assert.deepEqual(revokeCopy(inv(1, { recipient_name: 'Teo Sample' }), 'long'), { title: 'Revoke Teo Sample’s invitation?', body: 'The link stops working. The chosen offer, and any agreement out for signature, are voided. This cannot be undone.' });
  assert.equal(revokeCopy(inv(1), 'short').body, 'The link stops working. This cannot be undone.');
  assert.equal(revokedLine({ ok: true, voided_deals: 0, voided_envelopes: 0 }), 'Invitation revoked.', 'a zero is never read as "nothing was voided"');
  assert.equal(revokedLine({ ok: true, voided_deals: 1, voided_envelopes: 2 }), 'Invitation revoked. 1 deal voided. 2 agreements voided.');
  const lio = deal(7, { partner_name: 'Lio Testwell', redemptions_count: 12 });
  assert.deepEqual(terminateCopy(lio), {
    title: 'Terminate the Services partnership with Lio Testwell?',
    lines: [
      'The tiers this deal granted Lio Testwell end now, where they are still the deal’s grant.',
      '12 members registered with Lio Testwell’s code. Those still on the grant it gave lose it.',
      'This cannot be undone.',
    ],
  });
  assert.equal(terminateCopy({ ...lio, redemptions_count: 0 }).lines[1], 'No member registered with Lio Testwell’s code.');
  assert.equal(terminateCopy({ ...lio, deal_type: 'custom' }).title, 'Terminate the custom deal with Lio Testwell?');
  assert.doesNotMatch(JSON.stringify(terminateCopy(lio)), /unless he pays|Founder Pro|will lose/);
  assert.equal(terminateReady('   '), false);
  assert.equal(terminateReady('Breach'), true);
});

test('refusals are one sentence: the 409s in PI10b\'s words, a frozen admin\'s 423', () => {
  assert.equal(refusalText({ status: 409 }, 'invitation'), INVITATION_CLOSED);
  assert.equal(INVITATION_CLOSED, 'This invitation is already signed or revoked.');
  assert.equal(refusalText({ status: 409 }, 'deal'), DEAL_NOT_ACTIVE);
  assert.equal(DEAL_NOT_ACTIVE, 'This deal is no longer active, so it cannot be terminated.');
  assert.equal(refusalText({ status: 423, code: 'admin_frozen' }, 'deal'), FROZEN);
  assert.equal(FROZEN, 'Changes are refused while HQ has paused your admin access. Reading still works.');
  assert.equal(refusalText({ status: 400, message: 'Valid recipient_email required' }, 'create'), 'Enter a valid email address.');
  assert.equal(refusalText({ status: 400, message: 'allowed_deal_types must include at least one valid type' }, 'create'), 'Pick at least one deal type.');
  assert.equal(refusalText({ status: 500 }), TRY_AGAIN);
});

test('Offered: the first three stored types; any other is "Not offered to the invitee"; an empty list could not be read; no raw word shows', () => {
  assert.deepEqual(offeredTypes({ allowed_deal_types: ['equity_partnership', 'services_partnership', 'custom', 'capital_partnership'] }),
    { unreadable: false, shown: ['equity_partnership', 'services_partnership', 'custom'], others: ['capital_partnership'] });
  assert.deepEqual(offeredTypes({ allowed_deal_types: ['equity_partnership', 'equity_partnership', 'services_partnership', 'capital_partnership'] }),
    { unreadable: false, shown: ['equity_partnership', 'services_partnership'], others: ['capital_partnership'] }, 'buildProposals offers the first three stored, duplicates included');
  assert.equal(offeredTypes({ allowed_deal_types: [] }).unreadable, true, 'create refuses zero types, so an empty list is the parse fallback');
  assert.equal(dealTypeWord('deal_sourcing_revshare'), 'Deal-sourcing revenue share');
  assert.equal(dealState('awaiting_signature').word, 'Awaiting signature');
  assert.equal(dealState('proposed').word, 'Offer chosen, not sent');
  assert.equal(dealState('expired').word, 'Term over');
  assert.equal(dealState('weird').word, 'Another state');
});

test('the invitations toolbar: name or email, stage chips with Lapsed, and the canvas\'s sorts, over the loaded rows', () => {
  const rows = [
    inv(1, { recipient_name: 'Mara Example', status: 'selected', createdMs: NOW - 30 * DAY, is_expired: true }),
    inv(2, { recipient_name: 'Teo Sample', status: 'viewed', createdMs: NOW - 2 * DAY }),
    inv(3, { recipient_name: null, recipient_email: 'hello@example.com', status: 'revoked', createdMs: NOW - 9 * DAY }),
  ].map((i) => ({ inv: i, row: invitationRow(i, { proposed: ready([]), now: NOW }) }));
  const ids = (o) => filterInvitations(rows, { now: NOW, ...o }).map((r) => r.row.id);
  assert.deepEqual(ids({}), [2, 3, 1], 'newest first send');
  assert.deepEqual(ids({ q: 'teo' }), [2], 'by name');
  assert.deepEqual(ids({ q: 'hello@' }), [3], 'by email');
  assert.deepEqual(ids({ q: 'no name' }), [], 'the placeholder is not searched as a name');
  assert.deepEqual(ids({ stages: ['lapsed'] }), [1]);
  assert.deepEqual(ids({ stages: ['selected'] }), [], 'a lapsed row answers to Lapsed, as its pill says');
  assert.deepEqual(ids({ stages: ['viewed', 'revoked'] }), [2, 3]);
  assert.deepEqual(ids({ sort: 'oldest-open' }), [1, 2, 3], 'open (lapsed included) oldest first, closed last');
  assert.deepEqual(ids({ sort: 'name' }), [1, 3, 2], 'Mara Example, No name given, Teo Sample');
  assert.deepEqual(ids({ sentWithin: '7' }), [2]);
  assert.equal(rows[2].row.name, 'No name given');
});

test('New invitation: three types at most, and checks that say when they could not check', () => {
  assert.deepEqual(toggleType(['a', 'b'], 'c'), ['a', 'b', 'c']);
  assert.deepEqual(toggleType(['a', 'b', 'c'], 'd'), ['a', 'b', 'c'], 'O-CAP: a fourth is not added');
  assert.deepEqual(toggleType(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.equal(TYPE_FULL, 'Three are picked; clear one to choose this.');
  const open = inv(4, { recipient_email: 'lio@example.com', createdMs: Date.parse('2026-10-01T09:00:00Z') });
  assert.deepEqual(duplicateCheck(ready([open]), 'LIO@example.com '), { state: 'found', inv: open, text: 'An open invitation to this address exists, sent 1 Oct 2026. Open it instead?' });
  assert.equal(duplicateCheck(ready([{ ...open, status: 'signed' }]), 'lio@example.com').state, 'clear');
  assert.equal(duplicateCheck(ready([{ ...open, recipient_email: 'xlio@example.com' }]), 'lio@example.com').state, 'clear', 'R1\'s email filter is a substring; the check is exact');
  assert.deepEqual(duplicateCheck(failed(), 'lio@example.com'), { state: 'failed', text: 'Could not check for an open invitation.' });
  assert.deepEqual(memberCheck(ready([{ email: 'lio@example.com', role: 'founder' }]), 'lio@example.com'), { state: 'found', text: 'This address belongs to a member (Founder). Signing keeps their role.' });
  assert.deepEqual(memberCheck(failed(), 'lio@example.com'), { state: 'failed', text: 'Could not check whether this address belongs to a member.' });
  assert.equal(memberCheck(ready([]), 'lio@example.com').state, 'clear');
  assert.deepEqual(createdLines({ email_sent: true }, 'lio@example.com'), { sent: 'Invitation sent to lio@example.com.', notSent: null });
  assert.deepEqual(createdLines({ email_sent: false }, 'lio@example.com'), { sent: null, notSent: 'The email was not sent. Copy the link and send it yourself.' });
  assert.equal(createdLines({}, 'x').sent, null, 'only when the Worker reports the email went');
  assert.equal(isCompleteEmail('lio@example.com'), true);
  assert.equal(isCompleteEmail('lio@example.c'), false);
});

// D929: Needs you reads part 4's overview read now; its rows are held in admin_partners_overview_d929.test.mjs.

test('first use is a read that holds no invitation, never a failed read (the tiles are D929\'s, on the overview read)', () => {
  assert.equal(isFirstUse(ready([])), true);
  assert.equal(isFirstUse(failed()), false, 'a failed read is never first use');
});

test('one deal: obligations read "No obligations recorded" with none required, never "None outstanding"', () => {
  const scores = (o) => ready({ scores: [{ user_id: 507, score: 50, ...o }] });
  assert.equal(obligationsLine(scores({ missing: [], required_total: 0 }), 507).text, 'No obligations recorded');
  assert.equal(obligationsLine(scores({ missing: ['kyb_v1', 'kyc_v1'], required_total: 4 }), 507).text, 'Outstanding: KYB, KYC');
  assert.equal(obligationsLine(failed(), 507).text, 'Could not be read');
  assert.equal(obligationsLine(ready({ scores: [] }), 507).text, 'Could not be read', 'no row for the member is not "none"');
  assert.doesNotMatch(obligationsLine(scores({ missing: [], required_total: 0 }), 507).text, /None outstanding/);
});

/* ------------------------------------------------------------------ *
 * Wiring and the source
 * ------------------------------------------------------------------ */

const DESK_FILES = ['frontend/src/pages/admin/PartnerInvitations.jsx',
  ...readdirSync(resolve(root, 'frontend/src/pages/admin/partners')).filter((f) => /\.jsx?$/.test(f)).map((f) => `frontend/src/pages/admin/partners/${f}`)];

test('the routes: each address under today\'s guard at App.jsx\'s six-space indent, static paths before :id, and the old address an inline Navigate', () => {
  const app = read('frontend/src/App.jsx');
  const paths = ['/admin/partner-invitations', '/admin/partner-invitations/invitations', '/admin/partner-invitations/invitations/:id',
    '/admin/partner-invitations/deals', '/admin/partner-invitations/deals/:id', '/admin/partner-invitations/referrals'];
  const lines = paths.map((p) => `\n      <Route path="${p}" element={guard(['admin'], <AdminPartnerInvitations />)} />`);
  for (const l of lines) assert.ok(app.includes(l), l.trim());
  assert.equal((app.match(/<AdminPartnerInvitations \/>/g) || []).length, 6);
  // D952: the old Firm links address forwards to Advisors & Partners › Firms, unguarded like every redirect.
  assert.ok(app.includes('\n      <Route path="/admin/partner-invitations/firm-links" element={<FirmLinksRedirect />} />'));
  assert.ok(app.indexOf(lines[1]) < app.indexOf(lines[2]) && app.indexOf(lines[3]) < app.indexOf(lines[4]), 'static paths before :id');
  assert.ok(app.includes('\n      <Route path="/admin/partners" element={<Navigate to="/admin/partner-invitations?moved=partners" replace />} />'));
  assert.doesNotMatch(codeOnly(app).split('\n').filter((l) => l.includes('partner-invitations')).join('\n'), /hqOnly\(/, 'no hqOnly');
});

test('the page keeps its frame and today\'s rail note, its crumb and its literal tab doors', () => {
  const page = read('frontend/src/pages/admin/PartnerInvitations.jsx');
  assert.match(page, /export default function PartnerInvitations\(\) \{\s*return \(\s*<AdminBoardFrame workspace="Partner invitations" note="Eadwyn reads the invitations listed here\. An invitation goes out only when you send it\." data-testid="admin-board-partner-invitations">/);
  assert.equal((page.match(/<AdminBoardFrame\b/g) || []).length, 1);
  const doors = [...page.matchAll(/<DeskTab to="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(doors, TABS.map((t) => t.path), 'the strip and TABS list the same four doors');
  assert.match(page, /<DeskTab to="\/admin\/partner-invitations" end /, 'Overview is lit only on its own address');
  assert.match(page, /<Link to="\/admin\/community" className=\{CRUMB_LINK\}>Community<\/Link> › Partner invitations/);
  assert.doesNotMatch(page, /to="\/admin\/held\/community"|scope-chip/, 'the crumb links Community itself, not its redirect, and there is no scope chip');
  // D952: Overview's Firms row opens the Firms tab, written out; nothing here links the old address.
  assert.match(read('frontend/src/pages/admin/partners/PartnersOverview.jsx'), /<Link to="\/admin\/advisors-partners\/firms"/);
  assert.doesNotMatch(read('frontend/src/pages/admin/partners/PartnersOverview.jsx') + page, /to="\/admin\/partner-invitations\/firm-links"/);
});

test('every wiring place D923 §1 names follows the page', () => {
  const sidebar = read('frontend/src/sidebarConfig.js');
  // Later pages may follow it in the list (D972 added /admin/advisors-partners).
  assert.match(sidebar, /label: 'Community', match: \['\/admin\/events', '\/admin\/jobs', '\/admin\/circles', '\/admin\/partner-invitations'(, '[^']+')*\]/);
  assert.doesNotMatch(sidebar, /'\/admin\/partners'/, 'Approvals no longer lights the page: exactly one row does');
  const placement = read('frontend/src/lib/adminPlacement.js');
  assert.match(placement, /\{ key: '\/admin\/partners', kind: 'row', label: 'Partner Invitations', route: '\/admin\/partner-invitations', hqOnly: false,\s*\.\.\.admin\('Community', 'card link'\), how: [^}]*also: \[admin\('Approvals', 'lane'\)\] \}/);
  assert.match(read('frontend/src/pages/admin/HeldApprovals.jsx'), /<Link to="\/admin\/partner-invitations" className=\{CONSOLE\}>\/admin\/partner-invitations<\/Link>/);
  assert.match(read('frontend/src/pages/admin/adminStudioOverview.js'), /'Partner invitations': '\/admin\/partner-invitations',/);
  assert.match(read('frontend/src/pages/admin/community/AdminCommunity.jsx'), /<Link to="\/admin\/partner-invitations" className=\{LINK\}>Open partner invitations<\/Link>/);
  assert.match(read('frontend/src/lib/railPages.js'), /own\('\/admin\/partner-invitations', key\(AD, 'Community', 'Partner invitations'\)\)/);
  assert.match(read('frontend/src/lib/railOptions/admin.js'), /id: 'S31', section: 'Community', module: 'Partner invitations', route: '\/admin\/partner-invitations', files: \['pages\/admin\/PartnerInvitations\.jsx'\], rail: FRAME/);
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/admin\/partners' \}, \/\/ D923/);
  assert.match(read('cloudflare-worker/src/services/partnerDeals.ts'), /Admin panel: \/admin\/partner-invitations\/referrals`/);
  assert.match(read('frontend/src/App.jsx'), /Getting a partner INTO the system is\s+\/admin\/partner-invitations, the invitation flow/);
});

test('the desk reads only D923 §2\'s reads through existing clients, and draws nothing §3 leaves undrawn', () => {
  const src = DESK_FILES.map((f) => codeOnly(read(f))).join('\n');
  for (const call of ['api.adminPartners.listInvitations(', 'api.adminPartners.listDeals(', 'api.adminPartners.listTopDeals(', 'api.adminPartners.dealRedemptions(',
    'api.adminListPartnerDeals(', 'api.adminPartners.listFirmLinks(', 'api.esignDetail(', 'api.esignTemplate(\'partner_services\')', 'dd.listCases(',
    'api.trustScoreBatch(', 'api.adminListUsers(', 'api.adminGetProfile(']) assert.ok(src.includes(call), `the desk no longer reads ${call}`);
  for (const write of ['createInvitation(', 'resendInvitation(', 'revokeInvitation(', 'terminateDeal(']) assert.ok(src.includes(`api.adminPartners.${write}`), write);
  // D952: attaching an account to a firm is decided on Advisors & Partners › Firms now, not on the desk.
  assert.ok(!src.includes('api.adminPartners.setFirmLink('), 'the desk still writes firm links');
  for (const imp of src.matchAll(/import \{([^}]+)\} from '[./]+lib\/api'/g)) {
    for (const name of imp[1].split(',').map((s) => s.trim()).filter(Boolean)) assert.ok(['api', 'dd'].includes(name), `a new client: ${name}`);
  }
  assert.doesNotMatch(src, /adminGetContract|adminContractDetail|partner_deal:|adminListContracts\(|esignList\(/, 'the Contracts detail and the Agreements union hide failures');
  assert.doesNotMatch(src, /window\.confirm|useToast|setTimeout\([^)]*on(?:Close|Created)|dangerouslySetInnerHTML/, 'no pop-up, no toast, no timer that closes a dialog');
  assert.doesNotMatch(src, /'—'|"—"|\?\? 0\b/, 'no dash or zero standing in for a value');
  assert.doesNotMatch(src, /<svg|recharts|Export CSV|Adjust terms|Founder Pro|\bDelivered\b|Agreement blocked|could not be sent/);
  for (const sample of ['Lio Testwell', 'Mara Example', 'Teo Sample', 'Ada Placeholder', '[12 Oct]', '[42]', 'partner/invite/']) assert.ok(!src.includes(sample), `a canvas sample reached the desk: ${sample}`);
  // The dates go through ui/parseStamp.js, the one rule both desks read.
  assert.match(read('frontend/src/pages/admin/partners/partnersDeskModel.js'), /import \{ parseStamp \} from '\.\.\/\.\.\/\.\.\/ui\/parseStamp\.js';/);
  assert.doesNotMatch(read('frontend/src/pages/admin/partners/partnersDeskModel.js'), /function parseStamp/);
});

test('docs: the folder is documented, ROUTE_MAP has the row, and the canvas is graded', () => {
  assert.ok(existsSync(resolve(root, 'frontend/src/pages/admin/partners/README.md')));
  assert.match(read('frontend/src/pages/admin/README.md'), /`partners\/`/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /\n\| Partner invitations \| admin, super-admin \| `\/admin\/partner-invitations`/);
  const incoming = read('design/incoming/README.md');
  assert.doesNotMatch(incoming, /S1's integration lands next and records its grade\s+here\./);
  assert.match(incoming, /\*\*Grade: UPGRADE\.\*\* `\/admin\/partner-invitations` is live\./);
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const LIVE = Date.now();
const liveInv = (id, o = {}) => inv(id, o, LIVE);

/** D927's overview reply, every block available and empty; `kinds` lays Needs-you rows over it. */
function overviewReply(kinds = {}) {
  const ok = (o) => ({ available: true, ...o });
  const k = {
    lapsed: ok({ rows: [] }), agreement_blocked: ok({ agreement: { state: 'ready' }, rows: [] }), failed_send: ok({ rows: [] }), deal_ending: ok({ rows: [] }),
    unattached_account: ok({ rows: [] }), due_diligence_open: ok({ rows: [] }), revshare_closing: ok({ rows: [] }), ...kinds,
  };
  return {
    as_of: new Date().toISOString(),
    tiles: Object.fromEntries(['open', 'lapsed', 'signed_90d', 'redemptions_90d'].map((t) => [t, ok({ count: 0 })]).concat([
      ['days_to_sign', ok({ median_days: null, over_signed: 0 })], ['active_deals', ok({ count: 0, ending_within_30d: 0, term_over_not_closed: 0 })],
      ['awaiting_signature', ok({ count: 0, invitation_lapsed: 0 })], ['failed_sends_30d', ok({ count: 0, by_reason: {} })]])),
    needs_you: { available: true, kinds: k, rows: Object.values(k).flatMap((x) => x.rows || []), unreadable_kinds: [] },
    c1: ok({ stages: {}, closed: { signed: 0, lapsed: 0, revoked: 0, signed_after_lapse: 0 } }), c2: ok({ weeks: [] }), c3: ok({ by_type: {} }), c4: ok({ weeks: [] }),
  };
}

function worker({
  invitations = [], deals = {}, contracts, links = { accounts: [], firms: [], attached: 0, unattached: 0 }, template = { doc_type: 'partner_services', fields: [] },
  top = [], cases = [], redemptions = {}, envelopes = {}, users = [], writes = {}, overview = overviewReply(),
} = {}) {
  const call = (v, ...a) => (typeof v === 'function' ? v(...a) : response(v));
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (method === 'POST') {
      if (path === '/api/trust/score/batch') return call(writes.trust || ((o) => response({ scores: JSON.parse(o.body).user_ids.map((id) => ({ user_id: id, score: 100, missing: [], required_total: 0 })) })), options);
      const kind = path === '/api/admin/partners/invitations' ? 'create' : path === '/api/admin/partners/links' ? 'link' : path.split('/').pop();
      return writes[kind] ? writes[kind](options, path) : response({ ok: true });
    }
    if (path === '/api/admin/partners/overview') return call(overview);
    if (path === '/api/admin/partners/invitations') {
      if (typeof invitations === 'function') return invitations(q);
      const email = q.get('email');
      return response({ items: email ? invitations.filter((i) => i.recipient_email.includes(email)) : invitations });
    }
    if (path === '/api/admin/partners/deals/top') return call(top);
    if (path === '/api/admin/partners/deals') {
      const v = deals[q.get('status')] ?? [];
      return typeof v === 'function' ? v(q) : response({ items: v });
    }
    const red = /^\/api\/admin\/partners\/deals\/(\d+)\/redemptions$/.exec(path);
    if (red) return call(redemptions[red[1]] ?? { deal: { id: Number(red[1]) }, items: [] });
    if (path === '/api/admin/contracts/partner-deals') {
      if (contracts !== undefined) return call(contracts);
      const all = Object.values(deals).filter(Array.isArray).flat();
      return response({ items: all.map((d) => ({ id: d.id, status: d.status, deal_type: d.deal_type, redemption_count: d.redemptions_count })), total: all.length, limit: 500, offset: 0 });
    }
    if (path === '/api/admin/partners/links') return call(links);
    if (path === '/api/legal/esign/templates/partner_services') return call(template);
    if (path === '/api/dd/cases') return call({ items: cases });
    const env = /^\/api\/legal\/esign\/(\d+)$/.exec(path);
    if (env) return envelopes[env[1]] ? call(envelopes[env[1]]) : response({ error: 'Envelope not found' }, 404);
    if (path === '/api/admin/users') return call(users, q);
    return response({});
  };
}

async function mounted(url, handle, { clipboard } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (clipboard) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(PartnerInvitations), h(Probe))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  // The test DOM keeps no attributes, so each node's React props are read instead.
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, flush, at, text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    props: (id) => props(byId(id)),
    within: (id, pred) => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; const top = byId(id); return top ? walk(top).filter((n) => pred(props(n), n)) : []; },
    nodeProps: props,
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    /** A button by its words. */
    async press(label, scope = null) {
      const pool = scope ? (() => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(byId(scope)); })() : nodes();
      const node = pool.find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}"`);
      await act(async () => { await props(node).onClick(event); });
      await flush();
    },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async key(id, key) { const n = byId(id); await act(async () => { props(n).onKeyDown({ key, target: n, currentTarget: n, preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async wait(ms) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
      restore();
    },
  };
}

const INVITATIONS_UNREADABLE = 'The invitations could not be read. A failed list is not a claim that there are none.';

test('a failed invitations read is Unreadable with Try again, never "No partner invitations yet"; a {} reply is a failed read too', async () => {
  for (const down of [() => response({ error: 'down' }, 503), () => response({})]) {
    let tries = 0;
    const view = await mounted('/admin/partner-invitations/invitations', worker({ invitations: () => { tries += 1; return down(); } }));
    try {
      assert.ok(view.has('partners-inv-read-unreadable'), 'the block says it could not read');
      assert.equal(view.textOf('partners-inv-read-unreadable').replace('Try again', '').trim(), INVITATIONS_UNREADABLE);
      assert.ok(!view.text().includes(EMPTY_TITLE), 'a failed list never says there are none');
      assert.ok(!view.has('partners-inv-first-use') && !view.has('partners-inv-table'));
      assert.ok(!view.has('partners-tab-invitations-count'), 'no count stands in for an unread list');
      assert.ok(view.has('partners-tab-deals-count'), 'the rest of the page stands');
      const before = tries;
      await view.press('Try again', 'partners-inv-read-unreadable');
      assert.equal(tries, before + 1, 'Try again reads it again');
    } finally { await view.close(); }
  }
  const overview = await mounted('/admin/partner-invitations', worker({ invitations: () => response({ error: 'down' }, 503) }));
  try {
    assert.ok(!overview.has('partners-first-use'), 'a failed read is never first use');
    assert.match(overview.textOf('partners-tile-open'), /^Open invitations0/, 'the tiles are the overview read\'s, which answered');
  } finally { await overview.close(); }
});

test('after a failed refresh the rows stay, only under a "Could not refresh" line', async () => {
  let calls = 0;
  const rows = [liveInv(1, { recipient_name: 'Mara Example' })];
  const view = await mounted('/admin/partner-invitations/invitations', worker({ invitations: () => { calls += 1; return calls === 1 ? response({ items: rows }) : response({ error: 'down' }, 503); } }));
  try {
    assert.ok(view.has('partners-inv-row-1'));
    await view.click('partners-inv-menu-1');
    await view.click('partners-inv-menu-1-revoke');
    await view.click('partners-revoke-go');
    await view.click('partners-revoke-go-done');
    assert.ok(view.has('partners-inv-read-stale'), 'the failed refresh is said');
    assert.equal(view.textOf('partners-inv-read-stale').replace('Try again', '').trim(), 'Could not refresh the invitations. The rows below are from the last read.');
    assert.ok(view.has('partners-inv-row-1'), 'and the earlier rows stay under it');
  } finally { await view.close(); }
});

test('at the cap the counts say what they cover: "200+" on the tab, "within the newest 200" on the pager', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ invitations: many(CAPS.invitations, (i) => liveInv(i)) }));
  try {
    assert.equal(view.textOf('partners-tab-invitations-count'), '200+, Within the newest 200 by first send; there may be more');
    assert.equal(view.textOf('partners-inv-range'), '1–25 of 200 · within the newest 200 by first send');
  } finally { await view.close(); }
  const below = await mounted('/admin/partner-invitations/invitations', worker({ invitations: many(3, (i) => liveInv(i)) }));
  try {
    assert.equal(below.textOf('partners-tab-invitations-count'), '3, Every invitation');
    assert.equal(below.textOf('partners-inv-range'), '1–3 of 3');
  } finally { await below.close(); }
});

test('a row opens on Enter, its menu is labelled "Actions for [name]", its dots carry a label, and closing returns to the tab', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ invitations: [liveInv(1, { recipient_name: 'Mara Example', status: 'selected' })] }));
  try {
    assert.equal(view.props('partners-inv-menu-1')['aria-label'], 'Actions for Mara Example');
    assert.ok(view.within('partners-inv-stage-1', (p) => p.role === 'img' && p['aria-label'] === 'Step 5 of 7: Offer chosen').length, 'the dots carry their text label');
    await view.key('partners-inv-row-1', 'Enter');
    assert.equal(view.at.path, '/admin/partner-invitations/invitations/1');
    assert.ok(view.has('partners-invitation'), 'the record opens as a Lightbox over its tab');
    assert.ok(view.has('partners-inv-table'), 'the tab stays under it');
    assert.match(view.textOf('partners-invitation'), /Mara Example/);
    assert.equal(view.textOf('partners-progress-chosen'), 'Offer chosenNot recorded', 'at Offer chosen with every deal list read and no deal row');
    assert.equal(view.textOf('partners-progress-profiled'), 'Profile doneNot read here yet');
    assert.match(view.textOf('partners-invitation-history'), /Sent by Admin A ·/);
    await view.click('partners-invitation-close');
    assert.equal(view.at.path, '/admin/partner-invitations/invitations');
    assert.ok(!view.has('partners-invitation'));
  } finally { await view.close(); }
});

test('the create result stays in the dialog until Done; the checks are one debounced request each; Copy has a failure path', async () => {
  const lio = liveInv(4, { recipient_email: 'lio@example.com', recipient_name: 'Lio Testwell' });
  let created = null;
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    invitations: [lio], users: [{ email: 'lio@example.com', role: 'founder' }],
    writes: { create: (o) => { created = JSON.parse(o.body); return response({ id: 99, token: 'new', link: 'https://axal.vc/partners/onboard?token=new', expires_at: isoAt(LIVE + 14 * DAY), email_sent: false, allowed_deal_types: created.allowed_deal_types }, 201); } },
  }), { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  try {
    await view.click('partners-new-button');
    assert.ok(view.has('partners-new'), 'a Lightbox, not a browser pop-up');
    await view.change('partners-new-email', { value: 'a@b.co' });
    await view.change('partners-new-email', { value: 'lio@example.com' });
    await view.wait(450);
    const checks = view.requests.filter((r) => r.url.startsWith('/api/admin/partners/invitations?email=') || r.url.startsWith('/api/admin/users?q='));
    assert.deepEqual(checks.map((r) => r.url), ['/api/admin/partners/invitations?email=lio%40example.com', '/api/admin/users?q=lio%40example.com'], 'one request per check, for the address left in the field');
    assert.match(view.textOf('partners-new-dup'), /^An open invitation to this address exists, sent \d+ \w{3} \d{4}\. Open it instead\?Open it$/);
    assert.equal(view.textOf('partners-new-member'), 'This address belongs to a member (Founder). Signing keeps their role.');
    assert.equal(view.props('partners-new-send').disabled, true, 'no type picked yet');
    for (const t of ['services_partnership', 'deal_sourcing_revshare', 'custom']) await view.change(`partners-new-type-${t}-box`, { checked: true });
    assert.equal(view.props('partners-new-type-equity_partnership-box').disabled, true, 'O-CAP: a fourth type is disabled');
    assert.match(view.textOf('partners-new-type-equity_partnership'), /Three are picked; clear one to choose this\./);
    assert.match(view.textOf('partners-new-type-capital_partnership'), /Needs KYC and accreditation after signing\./);
    await view.change('partners-new-message', { value: 'Hello Lio' });
    assert.equal(view.textOf('partners-new-message-count'), '9 / 2,000 · Shown in the email and at the start of the onboarding chat.');
    await view.click('partners-new-send');
    assert.deepEqual(created, { recipient_email: 'lio@example.com', allowed_deal_types: ['services_partnership', 'deal_sourcing_revshare', 'custom'], personal_message: 'Hello Lio' });
    assert.equal(view.textOf('partners-new-not-sent'), 'The email was not sent. Copy the link and send it yourself.');
    assert.ok(!view.has('partners-new-sent'), '"Invitation sent" only when the Worker reports the email went');
    await view.wait(1700);
    assert.ok(view.has('partners-new-result'), 'no timer closes the dialog');
    await view.click('partners-new-copy');
    assert.equal(view.textOf('partners-new-copy-result'), 'Copy failed. Select the link and copy it.');
    assert.equal(view.props('partners-new-copy-field').value, 'https://axal.vc/partners/onboard?token=new', 'the link stays in a field to select by hand');
    const reads = view.requests.filter((r) => r.url === '/api/admin/partners/invitations').length;
    await view.click('partners-new-done');
    assert.ok(!view.has('partners-new'), 'Done closes it');
    assert.ok(view.requests.filter((r) => r.url === '/api/admin/partners/invitations').length > reads, 'and the desk reads again');
  } finally { await view.close(); }
  const sent = await mounted('/admin/partner-invitations', worker({ writes: { create: () => response({ id: 5, link: 'https://axal.vc/partners/onboard?token=s', email_sent: true }, 201) } }), { clipboard: { writeText: async () => {} } });
  try {
    await sent.click('partners-new-button');
    await sent.change('partners-new-email', { value: 'new@example.com' });
    await sent.change('partners-new-type-equity_partnership-box', { checked: true });
    await sent.click('partners-new-send');
    assert.equal(sent.textOf('partners-new-sent'), 'Invitation sent to new@example.com.');
    await sent.click('partners-new-copy');
    assert.equal(sent.textOf('partners-new-copy-result'), 'Copied');
  } finally { await sent.close(); }
});

test('a check\'s late reply for an address no longer in the field is dropped', async () => {
  const later = (ms, body) => new Promise((done) => setTimeout(() => done(response(body)), ms));
  const view = await mounted('/admin/partner-invitations', worker({
    users: (q) => (q.get('q') === 'ann@example.com'
      ? later(900, [{ email: 'ann@example.com', role: 'founder' }])
      : later(0, [{ email: 'bob@example.com', role: 'investor' }])),
  }));
  try {
    await view.click('partners-new-button');
    await view.change('partners-new-email', { value: 'ann@example.com' });
    await view.wait(450); // Ann's check is sent; its reply takes 900 ms.
    await view.change('partners-new-email', { value: 'bob@example.com' });
    // Two waits: React holds a render queued inside one act() until it ends,
    // so the first wait lets Bob's check start (and answer) before Ann's reply.
    await view.wait(450);
    assert.equal(view.textOf('partners-new-member'), 'This address belongs to a member (Investor). Signing keeps their role.');
    await view.wait(1000); // Ann's late reply lands now, for an address no longer in the field.
    assert.equal(view.textOf('partners-new-member'), 'This address belongs to a member (Investor). Signing keeps their role.');
  } finally { await view.close(); }
});

test('Terminate is disabled until a reason is typed; its result and its refusal stay in the dialog', async () => {
  const lio = deal(7, { partner_name: 'Lio Testwell', redemptions_count: 3, expires_at: isoAt(LIVE + 100 * DAY) });
  let body = null;
  const view = await mounted('/admin/partner-invitations/deals/7', worker({
    deals: { active: [lio] }, redemptions: { 7: () => response({ error: 'down' }, 503) },
    writes: { terminate: (o) => { body = JSON.parse(o.body); return response({ ok: true, tiers_revoked: true, redemptions_revoked: 4 }); } },
  }));
  try {
    assert.ok(view.has('partners-deal'), 'one deal opens over Deals');
    assert.equal(view.textOf('partners-deal-count'), 'Redemptions: 3', 'the count comes from the row');
    assert.ok(view.has('partners-deal-redeemers-unreadable'), 'a failed R4 reads Unreadable');
    const r4 = () => view.requests.filter((r) => r.url.endsWith('/deals/7/redemptions')).length;
    assert.equal(r4(), 2, 'once for the record and once for the fan-out');
    await view.wait(50);
    assert.equal(r4(), 2, 'and never again: a failure does not re-read in a loop');
    assert.equal(view.textOf('partners-deal-obligations-line'), 'No obligations recorded');
    assert.match(view.textOf('partners-deal-terms'), /Tiers grantedFounder grant: no plan/);
    await view.click('partners-deal-terminate');
    assert.ok(view.has('partners-terminate-dialog'));
    assert.equal(view.props('partners-terminate-go').disabled, true, 'disabled until a reason is typed');
    assert.match(view.textOf('partners-terminate-lines'), /3 members registered with Lio Testwell’s code\. Those still on the grant it gave lose it\./);
    await view.change('partners-terminate-reason', { value: '   ' });
    assert.equal(view.props('partners-terminate-go').disabled, true, 'spaces are not a reason');
    await view.change('partners-terminate-reason', { value: 'Breach of terms' });
    assert.equal(view.props('partners-terminate-go').disabled, false);
    assert.equal(view.textOf('partners-terminate-count'), '15 / 500');
    await view.click('partners-terminate-go');
    assert.deepEqual(body, { reason: 'Breach of terms' });
    assert.equal(view.textOf('partners-terminate-result'), 'Deal terminated.');
    assert.doesNotMatch(view.textOf('partners-terminate-dialog'), /4 member|revoked/i, 'the reply\'s revoked counts are not turned into member counts');
    assert.ok(view.has('partners-terminate-dialog'), 'the result stays in the dialog');
  } finally { await view.close(); }
  const refused = await mounted('/admin/partner-invitations/deals/7', worker({ deals: { active: [lio] }, writes: { terminate: () => response({ error: 'Deal is not active or not found' }, 409) } }));
  try {
    await refused.click('partners-deal-terminate');
    await refused.change('partners-terminate-reason', { value: 'Breach' });
    await refused.click('partners-terminate-go');
    assert.equal(refused.textOf('partners-terminate-go-refusal'), DEAL_NOT_ACTIVE);
    assert.equal(refused.props('partners-terminate-reason').value, 'Breach', 'the typed reason is not lost');
  } finally { await refused.close(); }
});

test('the old address lands on Overview with the moved notice; first use draws the empty state and the Firms door', async () => {
  const links = { accounts: [{ id: 1, email: 'a@x.co', partner_id: null }, { id: 2, email: 'b@x.co', partner_id: null }], firms: [] };
  const view = await mounted(MOVED_PATH, worker({ invitations: [], links, overview: overviewReply({ unattached_account: { available: true, rows: [{ kind: 'unattached_account', id: 1 }, { kind: 'unattached_account', id: 2 }] } }) }));
  try {
    assert.equal(view.textOf('partners-moved'), `${MOVED_LINE}Dismiss`);
    assert.ok(view.has('partners-first-use'));
    assert.match(view.textOf('partners-first-use'), /No partner invitations yet\.Invite an operating partner to start\. They answer a short profile, choose an offer, and sign\.New invitation/);
    assert.equal(view.textOf('partners-needs-firms'), 'Firms2 partner accounts are not attached to a firm.Open Firms');
    assert.ok(view.hrefs().includes('/admin/advisors-partners/firms'));
    assert.ok(!view.hrefs().includes('/admin/partner-invitations/firm-links'));
    assert.match(view.textOf('partners-tab-overview-count'), /^1, Rows in Needs you$/);
    await view.press('Dismiss');
    assert.equal(view.at.path, '/admin/partner-invitations');
    assert.ok(!view.has('partners-moved'));
  } finally { await view.close(); }
});

test('Deals: names before signing come from the invitation, the lapsed cross-check is drawn, and the Contracts total is the tab count', async () => {
  const lapsed = liveInv(2, { recipient_name: 'Teo Sample', status: 'selected', createdMs: LIVE - 30 * DAY, is_expired: true });
  const view = await mounted('/admin/partner-invitations/deals', worker({
    invitations: [lapsed],
    deals: { active: [deal(7, { expires_at: isoAt(LIVE + 10 * DAY) })], proposed: [deal(8, { status: 'proposed', invitation_id: 2, user_id: null, partner_email: null, partner_name: null, referral_code: null, activated_at: null, expires_at: null, envelope_id: null })] },
    contracts: { items: [{ id: 7, redemption_count: 0 }, { id: 8, redemption_count: 0 }], total: 2, limit: 500, offset: 0 },
    cases: [{ uid: 'c1', subject_id: 507, status: 'open' }],
  }));
  try {
    assert.match(view.textOf('partners-tab-deals-count'), /^2, Every deal, in every state$/);
    assert.ok(view.has('partners-deals-row-7') && !view.has('partners-deals-row-8'), 'Active is on by default');
    assert.match(view.textOf('partners-deals-row-7'), /Founder grant: no plan/);
    assert.match(view.textOf('partners-deals-row-7'), /10 days/);
    assert.ok(view.hrefs().includes('/admin/due-diligence/c1'));
    await view.click('partners-deals-chip-proposed');
    const row = view.textOf('partners-deals-row-8');
    assert.match(row, /Teo Sample/);
    assert.match(row, /Lapsed before signing · Resend to continue/);
    assert.match(row, /Starts on signing/);
    assert.match(row, /Issued on signing/);
    assert.match(row, /Code not issued/);
    assert.match(row, /Not opened before signing/);
    assert.match(row, /Offer chosen, not sent/);
  } finally { await view.close(); }
});

test('Referrals under Guard F: one deal\'s failed read makes every fan-out figure say so, never a smaller number; all time stays exact from R5', async () => {
  const revshare = deal(7, { deal_type: 'deal_sourcing_revshare', redemptions_count: 2 });
  const plain = deal(8, { redemptions_count: 1 });
  const items7 = [
    redemption(1, LIVE - 10 * DAY, { attribution_kind: 'deal_sourcing_revshare', revshare_window_remaining_days: 20 }),
    redemption(2, LIVE - 200 * DAY, { attribution_kind: 'deal_sourcing_revshare', revshare_window_remaining_days: 165 }),
  ];
  const reply7 = { deal: { id: 7, deal_type: 'deal_sourcing_revshare', status: 'active', partner_name: 'Dana 7', referral_code: 'PART-7' }, items: items7 };
  const down = await mounted('/admin/partner-invitations/referrals', worker({ deals: { active: [revshare, plain] }, redemptions: { 7: reply7, 8: () => response({ error: 'down' }, 503) } }));
  try {
    assert.equal(down.textOf('partners-ref-tile-all'), 'Redemptions, all time3', 'R5 is uncapped, so its count is exact');
    for (const key of ['last90', 'open', 'closing']) {
      assert.match(down.textOf(`partners-ref-tile-${key}`), /Could not be read for 1 of 2 deals1 of 2 deals did not answer, so no partial sum is drawn\.Try again$/, key);
    }
    assert.ok(down.has('partners-ref-unreadable') && !down.has('partners-ref-table') && !down.has('partners-ref-none'), 'no partial list, and no empty-list sentence');
    assert.match(down.textOf('partners-ref-unreadable'), /1 of 2 deals did not answer, so no partial sum is drawn\./);
  } finally { await down.close(); }
  const reply8 = { deal: { id: 8, deal_type: 'services_partnership', status: 'active', partner_name: 'Dana 8', referral_code: 'PART-8' }, items: [redemption(3, LIVE - 5 * DAY)] };
  const up = await mounted('/admin/partner-invitations/referrals?deal=7', worker({ deals: { active: [revshare, plain] }, redemptions: { 7: reply7, 8: reply8 } }));
  try {
    assert.equal(up.textOf('partners-ref-tile-last90'), 'Last 90 days2');
    assert.equal(up.textOf('partners-ref-tile-open'), 'Rev-share windows open2On active deals only');
    assert.equal(up.textOf('partners-ref-tile-closing'), 'Closing within 30 days1');
    assert.match(up.textOf('partners-referrals-deal'), /^Deal #7 only\./);
    assert.ok(up.has('partners-ref-row-7:1') && up.has('partners-ref-row-7:2') && !up.has('partners-ref-row-8:3'), '?deal= narrows the table to one deal');
    assert.match(up.textOf('partners-ref-row-7:1'), /Role: Not read here yet/);
    assert.match(up.textOf('partners-ref-row-7:1'), /20 days left/);
    assert.match(up.textOf('partners-ref-foot'), /^Payouts are handled in Contracts\.Open payouts in Contracts$/);
    assert.ok(up.hrefs().includes('/admin/contracts?tab=partner-deals'));
  } finally { await up.close(); }
});
