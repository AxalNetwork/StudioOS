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
 *     Done, Firm links asks before saving, Terminate waits for a reason.
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
  AGREEMENT_BANNER, AGREEMENT_LAPSE_WARNING, CAPS, COMMUNITY_PATH, CONTRACTS_PAUSED, COULD_NOT_READ, DEAL_NOT_ACTIVE, DEAL_STATE_KEYS, EMPTY_TITLE,
  FIRM_LINKS_PATH, FOUNDER_NO_PLAN, FROZEN, INVITATION_CLOSED, LINE, MISSING_DEAL, MISSING_INVITATION, MOVED_LINE, MOVED_PATH, NO_DEAL, NO_INVITATION,
  NOT_IN_READ, NOT_READ_YET, NOT_RECORDED, READING, RESENT_NOT_SENT, RESENT_SENT,
  STORED_EXPIRED_WORD, TABS, TITLE, TRY_AGAIN, TYPE_FULL, WITHIN_DEALS, WITHIN_INVITATIONS, agreementReady,
  allTimeRedemptions, cameFromOldAddress, copyFailed, countClosing30, countLast90, countOpenWindows, createdLines, day,
  daysLeft, daysUsed, ddFor, dealForInvitation, dealFromSearch, dealPartner, dealState, dealTiles, dealTypeWord, dealsCount, dealsUnion, dotsLabel, duplicateCheck,
  expiresCell, fanFigure, fanOut, filterInvitations, findDeal, findInvitation, firmCounts, invitationForDeal, invitationRow, invitationTiles, isCompleteEmail,
  isFirstUse, isLapsed, memberCheck, needsYou, noMatchLine, obligationsLine, offeredTypes, pageOf, parseStamp, partialWrite, pausedLine, rangeText,
  redemptionDealSet, redemptionRow, refusalText, resendCopy, resentAt, resentResult, revokeCopy, revokeVariant, revokedLine, routeFor,
  signingLink, stageOf, tabCounts, tabPath, terminateCopy, terminateReady, terminatedLine, termText, tiersText, toggleType, topDealRows, windowOf,
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

test('the addresses: four tabs, one address per invitation and per deal, Firm links without a tab, the old address moved', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [
    ['Overview', '/admin/partner-invitations'], ['Invitations', '/admin/partner-invitations/invitations'],
    ['Deals', '/admin/partner-invitations/deals'], ['Referrals', '/admin/partner-invitations/referrals'],
  ]);
  assert.deepEqual(routeFor('/admin/partner-invitations'), { tab: 'overview', record: null });
  assert.deepEqual(routeFor('/admin/partner-invitations/'), { tab: 'overview', record: null });
  assert.deepEqual(routeFor('/admin/partner-invitations/invitations/12'), { tab: 'invitations', record: { kind: 'invitation', id: '12' } });
  assert.deepEqual(routeFor('/admin/partner-invitations/deals/41'), { tab: 'deals', record: { kind: 'deal', id: '41' } });
  assert.deepEqual(routeFor('/admin/partner-invitations/firm-links'), { tab: 'firm-links', record: null });
  assert.deepEqual(routeFor('/admin/partner-invitations/referrals'), { tab: 'referrals', record: null });
  assert.equal(tabPath('firm-links'), FIRM_LINKS_PATH);
  assert.equal(tabPath('deals'), '/admin/partner-invitations/deals');
  assert.ok(!TABS.some((t) => t.path === FIRM_LINKS_PATH), 'Firm links has an address and no tab');
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
  assert.equal(invitationTiles(full, { proposed: ready([]), now: NOW })[0].cover, WITHIN_INVITATIONS);
  assert.equal(invitationTiles(some, { proposed: ready([]), now: NOW })[0].cover, null);
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
  assert.equal(firmCounts({ accounts: accounts.slice(0, 20), firms: [{ id: 4 }] }).text, '2 attached · 18 not · 1 firm on record', 'one firm is "1 firm"');
  assert.equal(firmCounts({ accounts: accounts.slice(0, 20), firms: [{ id: 4 }, { id: 5 }] }).text, '2 attached · 18 not · 2 firms on record');
  assert.equal(firmCounts({ accounts, firms: many(CAPS.links, (i) => ({ id: i })) }).text, '482 attached · 18 not · 500+ firms on record', 'at the cap the firms say what they cover');
  const firms = needsYou({ invitations: ready([]), deals: lists(), links: ready({ accounts, firms: [] }), template: ready({ fields: [] }), fan: { state: 'ready', items: [], exact: true }, now: NOW }).rows.find((r) => r.kind === 'Firms');
  assert.equal(firms.text, '18 partner accounts of the first 500 are not attached to a firm.');
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

test('Resend says the renewed date, then one line by stage: the stage is kept, and at Agreement out a pending signing link is renewed too (D924)', () => {
  const recipient = (o = {}) => ({ recipient_email: 'p1@example.com', status: 'pending', token_expires_at: '2026-10-28T10:00:00.000Z', ...o });
  const env = (status = 'sent', recipients = [recipient()]) => ready({ id: 77, status, created_at: '2026-10-20 10:00:00', recipients });
  const copy = (o, envelope = loading()) => resendCopy(inv(1, { recipient_name: 'Mara Example', ...o }), stageOf(inv(1, o), { proposed: ready([]), now: NOW }), envelope, NOW);
  const out = { status: 'finalized', envelope_id: 77 };
  assert.equal(copy({}).title, 'Resend the invitation to Mara Example?');
  assert.deepEqual(copy({}).lines, ['The link gets a new 14 days, until 7 Nov 2026.']);
  assert.equal(copy({ status: 'selected' }).lines[1], 'Mara Example’s chosen offer is kept.');
  // D924: resend keeps the stored stage at every step, so nothing "goes back to Sent".
  assert.equal(copy({ status: 'profiled' }).lines[1], 'Their answers are kept. The stage stays at Profile done.');
  assert.equal(copy({ status: 'proposed' }).lines[1], 'Their answers are kept. The stage stays at Offers shown.');
  // D924: with the invitee's own signature pending, the signing link is renewed to the new date, live or lapsed alike.
  const RENEWS = 'The agreement’s signing link is renewed too, until 7 Nov 2026, and the email carries it.';
  for (const envelope of [env(), env('sent', [recipient({ token_expires_at: '2026-10-20T10:00:00.000Z' })]), env('partially_signed'), env('sent', [recipient({ recipient_email: 'P1@Example.com ' })])]) {
    assert.equal(copy(out, envelope).lines[1], RENEWS);
  }
  // No signature pending from the invitee: the onboarding email goes instead. A future token date never makes a closed envelope's link live.
  const INSTEAD = 'so no signing link is renewed. Resending sends the onboarding email instead.';
  assert.equal(copy(out, env('completed')).lines[1], `The agreement already sent is signed, ${INSTEAD}`);
  for (const status of ['voided', 'declined']) assert.equal(copy(out, env(status)).lines[1], `The agreement already sent was voided, ${INSTEAD}`, status);
  for (const envelope of [env('draft'), env('sent', [recipient({ status: 'signed' })]), env('sent', [recipient({ recipient_email: 'someone@else.co' })])]) {
    assert.equal(copy(out, envelope).lines[1], `No signature from Mara Example is pending on the agreement, ${INSTEAD}`);
  }
  assert.deepEqual(['completed', 'voided', 'draft'].map((st) => signingLink(env(st), NOW).state), ['signed', 'voided', 'other']);
  // Not known: reading, failed, or paused by a cool-off (finding 8), each said as such.
  assert.equal(copy(out).lines[1], 'Reading whether the agreement is still out for signature…');
  assert.equal(copy(out, failed()).lines[1], 'The agreement’s envelope could not be read, so whether its signing link is renewed too is not known.');
  const paused = copy(out, failed({ status: 423, code: 'recovery_cool_off_active' })).lines[1];
  assert.equal(paused, 'Reading the agreement’s envelope is paused after a recent account recovery. It resumes when the 24-hour cool-off ends. Until then, whether its signing link is renewed too is not shown.');
  assert.doesNotMatch(paused, /could not be read/, 'a 423 cool-off is said as paused');
  assert.equal(resendCopy(inv(1, { recipient_name: null }), stageOf(inv(1), { now: NOW }), loading(), NOW).title, 'Resend the invitation to p1@example.com?');
  assert.doesNotMatch(JSON.stringify([copy({ status: 'selected' }), copy(out, env()), copy({ status: 'profiled' })]), /Her progress|Delivered|goes back to Sent|does not renew/);
  // The result is what the reply reports: whether the email went. See the C5 test below.
  assert.deepEqual(resentResult({ email_sent: true }), { text: 'Sent.', sent: true });
  assert.deepEqual(resentResult({ email_sent: false }), { text: 'Not sent. Copy the link instead.', sent: false, copy: true });
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

test('Needs you draws only the rows whose data exists, and names a source it could not read', () => {
  const mara = inv(2, { recipient_name: 'Mara Example', status: 'selected', createdMs: NOW - 30 * DAY, is_expired: true });
  const teo = inv(3, { recipient_name: 'Teo Sample', status: 'selected' });
  const deals = lists({ active: ready([deal(7, { expires_at: isoAt(NOW + 20 * DAY) }), deal(8)]) });
  const links = ready({ accounts: [{ id: 1, partner_id: null }, { id: 2, partner_id: null }, { id: 3, partner_id: 4 }], firms: [] });
  const fan = { state: 'ready', items: [{ attribution_kind: 'deal_sourcing_revshare', revshare_window_remaining_days: 9, deal: { deal_type: 'deal_sourcing_revshare', status: 'active' } }], complete: true, short: [], firstOnly: [], exact: true };
  const notReady = failed({ status: 409, code: 'template_has_no_body' });
  const needs = needsYou({ invitations: ready([mara, teo]), deals, links, template: notReady, fan, now: NOW });
  assert.equal(needs.settled, true);
  assert.deepEqual(needs.rows.map((r) => [r.kind, r.text]), [
    ['Lapsed', 'The invitation to Mara Example lapsed on 8 Oct 2026 at Offer chosen.'],
    ['Agreement', 'Teo Sample chose an offer, but the agreement cannot be sent yet: the Partner Services agreement is not ready.'],
    ['Term ending', 'The Services partnership with Dana 7 ends on 13 Nov 2026.'],
    ['Firms', '2 partner accounts are not attached to a firm.'],
    ['Rev-share', '1 rev-share window closes within 30 days.'],
  ]);
  assert.doesNotMatch(JSON.stringify(needs.rows), /blocked|could not be sent|not delivered/i);
  const ready_ = needsYou({ invitations: ready([teo]), deals, links, template: ready({ fields: [] }), fan, now: NOW });
  assert.ok(!ready_.rows.some((r) => r.kind === 'Agreement'), 'no agreement row while the template is ready');
  const down = needsYou({ invitations: failed(), deals, links: failed(), template: notReady, fan, now: NOW });
  assert.deepEqual(down.failed.map((f) => f.what), ['The invitations', 'The partner accounts']);
  assert.equal(needsYou({ invitations: loading(), deals, links, template: notReady, fan, now: NOW }).settled, false);
  assert.equal(tabCounts({ invitations: ready([mara, teo]), deals, contracts: failed(), needs }).overview.text, '5', 'Overview counts the Needs-you rows drawn');
});

test('the Overview tiles: real figures from reads that succeeded, and words for what is not read', () => {
  const list = ready([
    inv(1, { createdMs: NOW - 4 * DAY }),
    inv(3, { createdMs: NOW - 10 * DAY }),
    inv(2, { status: 'selected', createdMs: NOW - 30 * DAY, is_expired: true }),
    inv(4, { status: 'signed', createdMs: NOW - 40 * DAY, signed_at: d1(NOW - 28 * DAY), is_expired: true }),
    inv(5, { status: 'signed', createdMs: NOW - 200 * DAY, signed_at: d1(NOW - 180 * DAY), is_expired: true }),
  ]);
  const t = Object.fromEntries(invitationTiles(list, { proposed: ready([]), now: NOW }).map((x) => [x.key, x]));
  assert.equal(t.open.value, '2');
  assert.equal(t.open.sub, 'oldest first sent 14 Oct 2026');
  assert.equal(t.lapsed.value, '1');
  assert.equal(t.lapsed.sub, 'link expired before signing');
  assert.equal(t.signed90.value, '1');
  assert.equal(t.median.value, '16');
  assert.equal(t.median.sub, 'median, over the last 2 signed');
  assert.equal(invitationTiles(ready([inv(1)]), { now: NOW })[3].value, 'None signed yet', 'never 0 with no signed rows');
  assert.deepEqual(invitationTiles(failed(), { now: NOW }).map((x) => x.state), ['unreadable', 'unreadable', 'unreadable', 'unreadable']);
  assert.equal(isFirstUse(ready([])), true);
  assert.equal(isFirstUse(failed()), false, 'a failed read is never first use');
  const d = Object.fromEntries(dealTiles({
    deals: lists({ active: ready([deal(7, { expires_at: isoAt(NOW + 20 * DAY) }), deal(8), deal(9, { expires_at: isoAt(NOW - DAY) })]), awaiting_signature: ready([deal(10, { status: 'awaiting_signature', invitation_id: 2, user_id: null })]) }),
    invitations: list, fan: { state: 'ready', items: [], complete: true, short: [], firstOnly: [], exact: true }, now: NOW,
  }).map((x) => [x.key, x]));
  assert.equal(d.active.value, '3');
  assert.equal(d.active.sub, '1 end within 30 days');
  assert.equal(d.active.extra, '1 is past its end, not yet closed');
  assert.equal(d.awaiting.sub, '1 whose invitation has lapsed');
  assert.equal(d.redemptions90.value, '0');
  // D929 renamed it in part 1's words; it stays "Not read here yet" until part 4's read.
  assert.deepEqual([d.sends.label, d.sends.state, d.sends.note.text], ['Sends that failed', 'note', 'Not read here yet']);
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
 * The build review's findings (D923)
 * ------------------------------------------------------------------ */

const stale = (data) => ({ status: 'error', data, error: { status: 503 }, at: 1 });

test('a record address that cannot be decoded opens no record and never crashes (finding 13); a missing record says why (C1)', () => {
  assert.deepEqual(routeFor('/admin/partner-invitations/invitations/%E0'), { tab: 'invitations', record: { kind: 'invitation', id: '%E0' } });
  assert.deepEqual(routeFor('/admin/partner-invitations/deals/50%'), { tab: 'deals', record: { kind: 'deal', id: '50%' } });
  assert.equal(routeFor('/admin/partner-invitations/deals/12%2F').record.id, '12/', 'a good escape still decodes');
  // C1: "missing" only past a cap; a complete list, or no record id at all, is "none".
  assert.deepEqual(findInvitation('12', ready([inv(1)])), { state: 'none' });
  assert.deepEqual(findInvitation('12', ready(many(CAPS.invitations, (i) => inv(1000 + i)))), { state: 'missing' });
  assert.deepEqual(findInvitation('%E0', loading()), { state: 'none' }, 'no invitation can have an address that is no record id');
  assert.deepEqual(findInvitation('12', stale([inv(1)])), { state: 'unreadable' }, 'a refresh that failed is no claim either way');
  assert.deepEqual(findInvitation('12', { ...ready([inv(1)]), refreshing: true }), { state: 'loading' }, 'nor is a list still being read again');
  assert.equal(findInvitation('12', ready([]), new Map([['12', ready(inv(12))]])).state, 'ready', 'a row read for its address');
  assert.deepEqual(findDeal('12', lists({ active: ready([deal(1)]) })), { state: 'none' });
  assert.deepEqual(findDeal('12', lists({ active: ready(many(CAPS.deals, (i) => deal(1000 + i))) })), { state: 'missing' });
  assert.deepEqual(findDeal('x', lists()), { state: 'none' });
  assert.equal(NO_INVITATION, 'No invitation in the list has this address.');
  assert.equal(NO_DEAL, 'No deal in the lists has this address.');
});

test('a deal between two lists while they are read again is loading, and one whose list could not refresh is unreadable, never "not in this read" (finding 19)', () => {
  // Terminate moved deal 12 from active to terminated: active has answered, terminated is still being read again.
  const moving = lists({ active: ready([deal(1)]), terminated: { ...ready([]), refreshing: true } });
  assert.deepEqual(findDeal('12', moving), { state: 'loading' });
  assert.deepEqual(findDeal('12', lists({ active: ready([deal(1)]), terminated: stale([]) })), { state: 'unreadable' });
  assert.equal(dealsUnion(moving).refreshing.join(), 'terminated');
  // The same race on the invitation record: a revoke moves its deal from proposed to voided.
  assert.deepEqual(dealForInvitation(inv(5), lists({ proposed: ready([]), voided: { ...ready([]), refreshing: true } })), { state: 'loading' });
  assert.deepEqual(dealForInvitation(inv(5), lists({ voided: stale([]) })), { state: 'unreadable' });
  assert.deepEqual(dealForInvitation(inv(5), lists()), { state: 'none' });
});

test('the six lists hold each deal once: a deal in an old list and a fresh one is counted once, from the fresh copy (finding 2)', () => {
  const was = deal(41, { redemptions_count: 7 });
  const now = deal(41, { status: 'terminated', terminated_at: '2026-10-24 11:00:00', redemptions_count: 7 });
  const other = deal(42, { redemptions_count: 2 });
  for (const active of [stale([was, other]), { ...ready([was, other]), refreshing: true }, { ...ready([was, other]), at: 1 }]) {
    const deals = lists({ active, terminated: { ...ready([now]), at: 2 } });
    assert.equal(dealsCount(failed({ status: 423, code: 'recovery_cool_off_active' }), deals).text, '2');
    assert.equal(allTimeRedemptions(failed(), deals).value, '9', '7 + 2, not 16');
    assert.deepEqual(redemptionDealSet(failed(), deals).deals.map((d) => d.id).sort(), ['41', '42']);
    assert.equal(findDeal('41', deals).deal.status, 'terminated', 'the fresh copy wins');
    assert.equal(dealsUnion(deals).rows.length, 2);
  }
});

test('the days-used bar and the Days left column agree to the day, past the half day too (finding 3)', () => {
  const d = deal(1, { activated_at: '2025-11-08 06:00:00', expires_at: isoAt(Date.parse('2025-11-08T06:00:00Z') + 360 * DAY) });
  for (const at of ['2026-10-24T18:00:00Z', '2026-10-25T05:59:00Z', '2026-10-24T12:00:00Z', '2026-11-02T20:00:00Z']) {
    const t = Date.parse(at);
    assert.equal(daysUsed(d, t).left, daysLeft(d, t).days, at);
    assert.equal(daysUsed(d, t).used + daysUsed(d, t).left, 360, at);
  }
  assert.deepEqual([daysUsed(d, Date.parse('2026-10-24T18:00:00Z')).used, daysLeft(d, Date.parse('2026-10-24T18:00:00Z')).text], [350, '10 days']);
  assert.equal(daysUsed(d, Date.parse('2026-11-02T20:00:00Z')).left, 1, 'an active deal with a day to run never reads "0 left"');
});

test('the obligations line names the terms and privacy every partner is seeded with (finding 4)', () => {
  const scores = ready({ scores: [{ user_id: 507, missing: ['tos_v1', 'privacy_v1', 'kyb_v1'], required_total: 4 }] });
  assert.equal(obligationsLine(scores, 507).text, 'Outstanding: Terms of service, Privacy, KYB');
});

test('Awaiting signature: a deal whose invitation is outside R1\'s newest 200 is said, never dropped from the lapsed count (finding 5)', () => {
  const newest = many(CAPS.invitations - 1, (i) => inv(1000 + i));
  const lapsedInv = inv(500, { status: 'finalized', envelope_id: 77, createdMs: NOW - 30 * DAY, is_expired: true });
  const tile = (awaiting, invitations) => dealTiles({ deals: lists({ awaiting_signature: ready(awaiting) }), invitations: ready(invitations), fan: { state: 'loading' }, now: NOW }).find((t) => t.key === 'awaiting');
  const unseen = tile([deal(9, { status: 'awaiting_signature', invitation_id: 999, user_id: null })], [...newest, inv(1999)]);
  assert.equal(unseen.sub, null);
  assert.equal(unseen.cover, '1 whose invitation is not in this read.');
  const both = tile([deal(8, { status: 'awaiting_signature', invitation_id: 500, user_id: null }), deal(9, { status: 'awaiting_signature', invitation_id: 999, user_id: null })], [...newest, lapsedInv]);
  assert.equal(both.sub, '1+ whose invitation has lapsed', 'a floor, at the cap');
  assert.equal(both.subTone, 'amber');
  assert.equal(both.cover, '1 whose invitation is not in this read.');
  const below = tile([deal(8, { status: 'awaiting_signature', invitation_id: 500, user_id: null }), deal(9, { status: 'awaiting_signature', invitation_id: 999, user_id: null })], [lapsedInv]);
  assert.deepEqual([below.sub, below.cover], ['1 whose invitation has lapsed', null], 'below the cap the count is exact');
});

test('Revoke takes the long variant when a deal list could not refresh (finding 10)', () => {
  assert.equal(revokeVariant(inv(1), lists({ proposed: stale([]) })), 'long');
  assert.equal(revokeVariant(inv(1), lists({ awaiting_signature: stale([deal(3, { status: 'awaiting_signature', invitation_id: 9 })]) })), 'long');
  assert.equal(revokeVariant(inv(1), lists()), 'short');
});

test('the revoke and terminate results say what D925\'s replies report, failures included, and never an exception', () => {
  assert.equal(revokedLine({ ok: true, voided_deals: 1, voided_envelopes: 0, failures: [{ step: 'void_envelope', envelope_id: 77 }] }), 'Invitation revoked. 1 deal voided. Some agreements could not be voided. Check them in Contracts.');
  assert.equal(revokedLine({ ok: true, voided_deals: 0, voided_envelopes: 0, failures: [{ step: 'revoke_cascade' }] }), 'Invitation revoked. Any chosen offer or agreement out for signature could not be voided. Check them in Contracts.');
  assert.equal(revokedLine({ ok: true, voided_deals: 0, voided_envelopes: 0, failures: [] }), 'Invitation revoked.', 'an empty list is success');
  assert.equal(terminatedLine({ ok: true, members_revoked: 3, partner_tiers_reverted: true, failures: [] }), 'Deal terminated. 3 members’ tiers revoked.');
  assert.equal(terminatedLine({ ok: true, members_revoked: 1, partner_tiers_reverted: false, failures: [] }), 'Deal terminated. 1 member’s tiers revoked.');
  assert.equal(terminatedLine({ ok: true, members_revoked: 0, partner_tiers_reverted: true, failures: [] }), 'Deal terminated.', 'a zero is never read as "no member lost a tier"');
  assert.equal(terminatedLine({ ok: true, members_revoked: 2, partner_tiers_reverted: false, failures: [{ step: 'redeemer_founder_revoke', user_id: 9 }] }),
    'Deal terminated. 2 members’ tiers revoked. Some tier changes did not complete, so the partner or a member may still hold this deal’s grant.');
  assert.equal(terminatedLine({ ok: true, redemptions_revoked: 4 }), 'Deal terminated.', 'a redemption count is never turned into a member count');
  assert.deepEqual([partialWrite({ failures: [{ step: 'x' }] }), partialWrite({ failures: [] }), partialWrite({})], [true, false, false]);
  for (const line of [revokedLine({ failures: [{ step: 'void_envelope', message: 'D1_ERROR: boom' }] }), terminatedLine({ failures: [{ step: 'redeemers_read', error: 'SQLITE_BUSY' }] })]) {
    assert.doesNotMatch(line, /D1_ERROR|SQLITE|boom|void_envelope|redeemers_read/);
  }
});

test('Needs you at a cap says what it checked, and is never "Nothing here needs you now." or a bare 0 (finding 1)', () => {
  const quiet = (o) => needsYou({ invitations: ready([]), deals: lists(), links: ready({ accounts: [], firms: [] }), template: ready({ fields: [] }), fan: { state: 'ready', items: [], exact: true }, now: NOW, ...o });
  const active = quiet({ deals: lists({ active: ready(many(CAPS.deals, (i) => deal(i, { expires_at: isoAt(NOW + 200 * DAY) }))) }) });
  assert.deepEqual([active.rows.length, active.failed.length, active.settled], [0, 0, true]);
  assert.deepEqual(active.cover.map((c) => c.text), ['Deals ending are checked over the newest 200 active deals.']);
  assert.deepEqual(tabCounts({ invitations: ready([]), deals: lists(), contracts: failed(), needs: active }).overview, { text: '0+', amber: false, title: 'Rows drawn in Needs you; some lists stop at their cap' });
  const invs = quiet({ invitations: ready(many(CAPS.invitations, (i) => inv(i))) });
  assert.deepEqual(invs.cover.map((c) => c.text), ['Lapsed invitations and chosen offers are checked within the newest 200 by first send.']);
  const below = quiet({});
  assert.deepEqual(below.cover, []);
  assert.deepEqual(tabCounts({ invitations: ready([]), deals: lists(), contracts: failed(), needs: below }).overview, { text: '0', amber: false, title: 'Rows in Needs you' }, 'below the caps a 0 is real');
});

test('Copy names what it copies: a referral code is a code, not a link (finding 12)', () => {
  assert.equal(copyFailed('code'), 'Copy failed. Select the code and copy it.');
  assert.equal(copyFailed(), 'Copy failed. Select the link and copy it.');
});

test('Top deals leaves out the deals with no redemption (finding 22)', () => {
  assert.deepEqual(topDealRows([{ id: 1, redemptions_count: 2 }, { id: 2, redemptions_count: 0 }, { id: 3, redemptions_count: null }, { id: 4 }, { id: 5, redemptions_count: '7' }]).map((d) => d.id), [1, 5]);
  assert.deepEqual(topDealRows(null), []);
});

test('a 423 cool-off is said as paused, with a verb that holds for any subject, and R5\'s pause is said where its figures are drawn (finding 23)', () => {
  assert.equal(pausedLine('The due-diligence cases'), 'Reading the due-diligence cases is paused after a recent account recovery. It resumes when the 24-hour cool-off ends.');
  assert.equal(pausedLine('The envelope'), 'Reading the envelope is paused after a recent account recovery. It resumes when the 24-hour cool-off ends.');
  const coolOff = failed({ status: 423, code: 'recovery_cool_off_active' });
  const deals = lists({ active: ready([deal(1, { redemptions_count: 2 })]) });
  assert.deepEqual(dealsCount(coolOff, deals), { text: '1', title: `Every deal, in every state. ${CONTRACTS_PAUSED}` });
  assert.equal(CONTRACTS_PAUSED, 'Reading every deal from Contracts is paused after a recent account recovery, so the deal lists are counted instead.');
  assert.equal(allTimeRedemptions(coolOff, deals).cover, CONTRACTS_PAUSED);
  assert.equal(tabCounts({ invitations: ready([]), deals, contracts: coolOff, needs: null }).referrals.title, `Redemptions, all time. ${CONTRACTS_PAUSED}`);
  // Any other failure of R5 falls back as D923 §2 decides, without the pause.
  assert.deepEqual(dealsCount(failed(), deals), { text: '1', title: 'Every deal, in every state' });
  assert.equal(allTimeRedemptions(failed(), deals).cover, undefined);
  assert.equal(ddFor(deal(1), coolOff).text, 'Paused after a recent account recovery');
});

/* ------------------------------------------------------------------ *
 * Wiring and the source
 * ------------------------------------------------------------------ */

const DESK_FILES = ['frontend/src/pages/admin/PartnerInvitations.jsx',
  ...readdirSync(resolve(root, 'frontend/src/pages/admin/partners')).filter((f) => /\.jsx?$/.test(f)).map((f) => `frontend/src/pages/admin/partners/${f}`)];

test('the routes: each address under today\'s guard at App.jsx\'s six-space indent, static paths before :id, and the old address an inline Navigate', () => {
  const app = read('frontend/src/App.jsx');
  const paths = ['/admin/partner-invitations', '/admin/partner-invitations/invitations', '/admin/partner-invitations/invitations/:id',
    '/admin/partner-invitations/deals', '/admin/partner-invitations/deals/:id', '/admin/partner-invitations/referrals', '/admin/partner-invitations/firm-links'];
  const lines = paths.map((p) => `\n      <Route path="${p}" element={guard(['admin'], <AdminPartnerInvitations />)} />`);
  for (const l of lines) assert.ok(app.includes(l), l.trim());
  assert.equal((app.match(/<AdminPartnerInvitations \/>/g) || []).length, 7);
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
  // Firm links' one door is Overview's Needs-you row, written out.
  assert.match(read('frontend/src/pages/admin/partners/PartnersOverview.jsx'), /<Link to="\/admin\/partner-invitations\/firm-links"/);
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
  for (const write of ['createInvitation(', 'resendInvitation(', 'revokeInvitation(', 'terminateDeal(', 'setFirmLink(']) assert.ok(src.includes(`api.adminPartners.${write}`), write);
  for (const imp of src.matchAll(/import \{([^}]+)\} from '[./]+lib\/api'/g)) {
    for (const name of imp[1].split(',').map((s) => s.trim()).filter(Boolean)) assert.ok(['api', 'dd'].includes(name), `a new client: ${name}`);
  }
  assert.doesNotMatch(src, /adminGetContract|adminContractDetail|partner_deal:|adminListContracts\(|esignList\(/, 'the Contracts detail and the Agreements union hide failures');
  assert.doesNotMatch(src, /window\.confirm|useToast|dangerouslySetInnerHTML/, 'no pop-up, no toast');
  // No timer closes a dialog: each setTimeout's first argument, up to the comma that ends it (two levels of
  // parentheses deep), must not name a closer. The old `setTimeout\([^)]*on(?:Close|Created)` stopped at the
  // first ")", so `setTimeout(() => onClose(), 1500)` passed it.
  const timerClosers = (code) => [...code.matchAll(/setTimeout\(\s*((?:[^(),]|\((?:[^()]|\([^()]*\))*\))*)/g)]
    .map((m) => m[1]).filter((arg) => /\b(?:on(?:Close|Created)|close(?:Dialog|Record)?|finish)\b/.test(arg));
  assert.deepEqual(timerClosers(src), [], 'no timer that closes a dialog');
  assert.equal(timerClosers('setTimeout(() => onClose(), 1500); setTimeout(close, 1500); setTimeout(() => onCreated(r), 1500); setTimeout(() => { setX(1); onClose(); }, 9);').length, 4, 'the arrow and bare forms are caught');
  assert.deepEqual(timerClosers('const timer = setTimeout(() => setCheckFor(typed), CHECK_DELAY_MS);'), [], 'the email check\'s debounce is not a closer');
  assert.match(src, /setTimeout\(\(\) => setCheckFor\(typed\), CHECK_DELAY_MS\)/, 'and that debounce is still the desk\'s one timer');
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

function worker({
  invitations = [], deals = {}, contracts, links = { accounts: [], firms: [], attached: 0, unattached: 0 }, template = { doc_type: 'partner_services', fields: [] },
  top = { items: [], status: 'all', limit: 5 }, cases = [], redemptions = {}, envelopes = {}, users = [], writes = {},
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
    if (path === '/api/dd/cases') return typeof cases === 'function' ? cases() : response({ items: cases });
    const env = /^\/api\/legal\/esign\/(\d+)$/.exec(path);
    if (env) return envelopes[env[1]] ? call(envelopes[env[1]]) : response({ error: 'Envelope not found' }, 404);
    if (path === '/api/admin/users') return call(users, q);
    return response({});
  };
}

async function mounted(url, handle, { clipboard, phone = false } = {}) {
  // Focus mode: `focus()` moves `document.activeElement`, so focus return can be read.
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  // `phone`: usePhoneWidth's (max-width: 1023px) matches, so a record is a page (PI11c).
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
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
    node: byId,
    /** What a keyboard user has focused: the node's own `focus()`. */
    focus(id) { const n = byId(id); assert.ok(n, `no ${id} to focus`); n.focus(); },
    /** The data-testid of the focused node, or a word for <body>, nothing, or a node no longer in the page. */
    focused() {
      const a = document.activeElement;
      if (!a) return 'nothing';
      if (a === document.body) return 'body';
      if (a.isConnected === false) return `removed:${props(a)['data-testid'] || text(a).trim()}`;
      return props(a)['data-testid'] || `text:${text(a).trim()}`;
    },
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
    assert.match(overview.textOf('partners-tile-open'), /^Open invitations\s*Open invitations could not be read\. A failed list is not a claim that there are none\./);
    assert.ok(overview.has('partners-needs-failed-invitations'));
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

test('Firm links asks before it saves, and says the result on the page', async () => {
  let saved = null;
  const links = { accounts: [{ id: 31, email: 'ann@firm.co', name: 'Ann', partner_id: null, firm_name: null, firm_company: null }], firms: [{ id: 4, name: 'Northwind', company: 'Northwind LLC', email: null, accounts: 2 }], attached: 0, unattached: 1 };
  const view = await mounted('/admin/partner-invitations/firm-links', worker({ links, writes: { link: (o) => { saved = JSON.parse(o.body); return response({ ok: true, user_id: 31, partner_id: 4, firm_name: 'Northwind' }); } } }));
  try {
    assert.equal(view.textOf('partners-firm-counts'), '0 attached · 1 not · 1 firm on record');
    await view.change('partners-firm-select-31', { value: '4' });
    assert.ok(view.has('partners-firm-confirm'), 'a change asks first');
    assert.match(view.textOf('partners-firm-confirm'), /Attach Ann to Northwind LLC\?/);
    assert.equal(view.textOf('partners-firm-confirm-body'), 'Every partner page Ann opens then belongs to Northwind LLC. The change is recorded in the admin audit log.');
    assert.equal(view.requests.filter((r) => r.method === 'POST').length, 0, 'nothing is saved before the confirm');
    await view.click('partners-firm-save');
    assert.deepEqual(saved, { user_id: 31, partner_id: 4 });
    assert.equal(view.textOf('partners-firm-saved'), 'Attached to Northwind.');
    assert.ok(!view.has('partners-firm-confirm'));
  } finally { await view.close(); }
});

test('Terminate is disabled until a reason is typed; its result and its refusal stay in the dialog', async () => {
  const lio = deal(7, { partner_name: 'Lio Testwell', redemptions_count: 3, expires_at: isoAt(LIVE + 100 * DAY) });
  let body = null;
  const view = await mounted('/admin/partner-invitations/deals/7', worker({
    deals: { active: [lio] }, redemptions: { 7: () => response({ error: 'down' }, 503) },
    // D925's reply; a legacy `redemptions_revoked` is kept in to prove it is never read as members.
    writes: { terminate: (o) => { body = JSON.parse(o.body); return response({ ok: true, members_revoked: 2, partner_tiers_reverted: true, failures: [], redemptions_revoked: 4 }); } },
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
    assert.equal(view.textOf('partners-terminate-result'), 'Deal terminated. 2 members’ tiers revoked.', 'D925\'s members_revoked, the distinct members');
    assert.doesNotMatch(view.textOf('partners-terminate-dialog'), /4 member/i, 'the reply\'s redemption count is not turned into a member count');
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

test('the old address lands on Overview with the moved notice; first use draws the empty state and keeps the Firm links door', async () => {
  const links = { accounts: [{ id: 1, email: 'a@x.co', partner_id: null }, { id: 2, email: 'b@x.co', partner_id: null }], firms: [] };
  const view = await mounted(MOVED_PATH, worker({ invitations: [], links }));
  try {
    assert.equal(view.textOf('partners-moved'), `${MOVED_LINE}Dismiss`);
    assert.ok(view.has('partners-first-use'));
    assert.match(view.textOf('partners-first-use'), /No partner invitations yet\.Invite an operating partner to start\. They answer a short profile, choose an offer, and sign\.New invitation/);
    assert.equal(view.textOf('partners-needs-firms'), 'Firms2 partner accounts are not attached to a firm.Open firm links');
    assert.ok(view.hrefs().includes('/admin/partner-invitations/firm-links'));
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
    // R5 holds a deal no R2 list returned here, so its total (3) is not the lists' sum (2).
    contracts: { items: [{ id: 7, redemption_count: 0 }, { id: 8, redemption_count: 0 }, { id: 9, redemption_count: 0 }], total: 3, limit: 500, offset: 0 },
    cases: [{ uid: 'c1', subject_id: 507, status: 'open' }],
  }));
  try {
    assert.match(view.textOf('partners-tab-deals-count'), /^3, Every deal, in every state$/, 'R5\'s total, not the six lists\' sum of 2');
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

/* ------------------------------------------------------------------ *
 * Mounted: the build review's findings
 * ------------------------------------------------------------------ */

const keyEvent = (key) => ({ key, preventDefault() {}, stopPropagation() {} });
const clickEvent = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };

test('a row-menu dialog gives focus to Done after the write and back to the row\'s "Actions for [name]" on close; the menu is a disclosure (findings 7, 9, 14, 21)', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    invitations: [liveInv(1, { recipient_name: 'Mara Example' })],
    writes: { revoke: () => response({ ok: true, voided_deals: 1, voided_envelopes: 0, failures: [{ step: 'void_envelope', envelope_id: 77 }] }) },
  }));
  try {
    assert.equal(view.props('partners-inv-menu-1')['aria-haspopup'], undefined, 'not an ARIA menu: no arrow keys are promised');
    await view.click('partners-inv-menu-1');
    const list = view.props('partners-inv-menu-1-list');
    assert.equal(list.role, undefined);
    assert.equal(view.props('partners-inv-menu-1')['aria-expanded'], true);
    assert.equal(view.props('partners-inv-menu-1')['aria-controls'], list.id, 'the button names the list it shows');
    assert.equal(view.props('partners-inv-menu-1-revoke').role, undefined);
    // A keyboard user is on Revoke when they pick it.
    view.focus('partners-inv-menu-1-revoke');
    await view.click('partners-inv-menu-1-revoke');
    assert.ok(view.has('partners-revoke-dialog'));
    assert.equal(view.focused(), 'partners-inv-menu-1', 'focus moved to ⋯ before the item unmounted, so the dialog records ⋯ as its opener');
    await view.click('partners-revoke-go');
    assert.equal(view.focused(), 'partners-revoke-go-done', 'the write swapped the action for Done, and Done has focus');
    assert.equal(view.textOf('partners-revoke-result'), 'Invitation revoked. 1 deal voided. Some agreements could not be voided. Check them in Contracts.');
    await view.click('partners-revoke-go-done');
    assert.ok(!view.has('partners-revoke-dialog'));
    assert.equal(view.focused(), 'partners-inv-menu-1', 'closing gives focus back to the row\'s ⋯, never to <body>');
    // Escape on an open menu puts focus on ⋯ too.
    await view.click('partners-inv-menu-1');
    view.focus('partners-inv-menu-1-resend');
    await act(async () => { view.nodeProps(view.node('partners-inv-menu-1').parentNode).onKeyDown(keyEvent('Escape')); });
    assert.ok(!view.has('partners-inv-menu-1-list'));
    assert.equal(view.focused(), 'partners-inv-menu-1');
  } finally { await view.close(); }
});

test('when the row that opened a dialog leaves its list after the write, focus goes to the lit tab, never to <body> (finding 7)', async () => {
  let ended = false;
  const lio = deal(7, { partner_name: 'Lio Testwell', expires_at: isoAt(LIVE + 100 * DAY) });
  const view = await mounted('/admin/partner-invitations/deals', worker({
    deals: {
      active: () => response({ items: ended ? [] : [lio] }),
      terminated: () => response({ items: ended ? [{ ...lio, status: 'terminated', terminated_at: d1(LIVE) }] : [] }),
    },
    writes: { terminate: () => { ended = true; return response({ ok: true, members_revoked: 0, partner_tiers_reverted: true, failures: [] }); } },
  }));
  try {
    await view.click('partners-deals-menu-7');
    view.focus('partners-deals-menu-7-terminate');
    await view.click('partners-deals-menu-7-terminate');
    await view.change('partners-terminate-reason', { value: 'Breach' });
    await view.click('partners-terminate-go');
    await view.click('partners-terminate-go-done');
    assert.ok(!view.has('partners-deals-row-7'), 'the terminated deal left the Active list on the reload');
    assert.equal(view.focused(), 'partners-tab-deals', 'focus is on the Deals tab, not on the removed row');
  } finally { await view.close(); }
});

test('on a phone a record is a page over a tab that stays mounted: its search survives, and Back gives focus to the row (finding 16)', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    invitations: [liveInv(1, { recipient_name: 'Ann One' }), liveInv(2, { recipient_name: 'Zed Two' }), liveInv(3, { recipient_name: 'Cy Three' })],
  }), { phone: true });
  try {
    await view.change('partners-inv-search', { value: 'Zed' });
    assert.ok(view.has('partners-inv-row-2') && !view.has('partners-inv-row-1'));
    view.focus('partners-inv-row-2');
    await view.key('partners-inv-row-2', 'Enter');
    assert.ok(view.has('partners-invitation-page'), 'a full page on a phone (PI11c)');
    assert.equal(view.props('partners-tab-area').hidden, true, 'the tab is hidden under it, not unmounted');
    assert.ok(view.has('partners-inv-search'));
    view.focus('partners-invitation-back');
    await view.click('partners-invitation-back');
    assert.equal(view.at.path, '/admin/partner-invitations/invitations');
    assert.equal(view.props('partners-tab-area').hidden, false);
    assert.equal(view.props('partners-inv-search').value, 'Zed', 'the search is as it was');
    assert.ok(view.has('partners-inv-row-2') && !view.has('partners-inv-row-1') && !view.has('partners-inv-row-3'), 'and so are its rows');
    assert.equal(view.focused(), 'partners-inv-row-2', 'focus is back on the row that opened the record');
  } finally { await view.close(); }
});

test('a deal opened from another tab\'s link closes onto Deals with focus on its tab, never on <body> (finding 16)', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    invitations: [liveInv(1, { status: 'signed', resulting_deal_id: 7, resulting_user_id: 507, signed_at: d1(LIVE - DAY) })], deals: { active: [deal(7)] },
  }));
  try {
    const link = view.within('partners-inv-row-1', (p) => p.href === '/admin/partner-invitations/deals/7')[0];
    assert.ok(link, 'the Result column links the deal');
    link.focus();
    await act(async () => { view.nodeProps(link).onClick(clickEvent); });
    await view.flush();
    assert.equal(view.at.path, '/admin/partner-invitations/deals/7');
    assert.ok(view.has('partners-deal') && view.has('partners-deals'), 'the deal opens over its own tab, as D923 §1 decides');
    await view.click('partners-deal-close');
    assert.equal(view.at.path, '/admin/partner-invitations/deals');
    assert.equal(view.focused(), 'partners-tab-deals', 'the link that opened it is gone, so focus goes to the lit tab');
  } finally { await view.close(); }
});

test('the row menu is fixed off its button, so no table scroller clips it, and it opens upward near the bottom (finding 15)', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ invitations: [liveInv(1)] }));
  const was = { innerHeight: globalThis.innerHeight, innerWidth: globalThis.innerWidth };
  try {
    globalThis.innerHeight = 800;
    globalThis.innerWidth = 1280;
    const trigger = view.node('partners-inv-menu-1');
    trigger.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 1200, right: 1234, width: 34, height: 30 });
    await view.click('partners-inv-menu-1');
    assert.deepEqual(view.props('partners-inv-menu-1-list').style, { position: 'fixed', top: 136, bottom: undefined, right: 46, maxHeight: 652 });
    assert.doesNotMatch(view.props('partners-inv-menu-1-list').className, /\babsolute\b/, 'never positioned inside the overflow-x box');
    await view.click('partners-inv-menu-1');
    // The only row of a short table, near the bottom of the window: more room above, so it opens upward.
    trigger.getBoundingClientRect = () => ({ top: 700, bottom: 730, left: 1200, right: 1234, width: 34, height: 30 });
    await view.click('partners-inv-menu-1');
    assert.deepEqual(view.props('partners-inv-menu-1-list').style, { position: 'fixed', top: undefined, bottom: 106, right: 46, maxHeight: 682 });
  } finally {
    globalThis.innerHeight = was.innerHeight;
    globalThis.innerWidth = was.innerWidth;
    await view.close();
  }
});

test('New invitation moves focus to the result\'s Done after Send (finding 9)', async () => {
  const view = await mounted('/admin/partner-invitations', worker({ writes: { create: () => response({ id: 5, link: 'https://axal.vc/partners/onboard?token=s', email_sent: true }, 201) } }));
  try {
    await view.click('partners-new-button');
    await view.change('partners-new-email', { value: 'new@example.com' });
    await view.change('partners-new-type-equity_partnership-box', { checked: true });
    view.focus('partners-new-send');
    await view.click('partners-new-send');
    assert.ok(view.has('partners-new-result'));
    assert.equal(view.focused(), 'partners-new-done');
  } finally { await view.close(); }
});

test('Resend at Agreement out says before the write that a pending signing link is renewed, and its result says only whether the email went (D924, C5)', async () => {
  const out = liveInv(3, { recipient_name: 'Teo Sample', status: 'finalized', envelope_id: 77 });
  const envelope = { id: 77, status: 'sent', created_at: d1(LIVE - 2 * DAY), recipients: [{ recipient_email: 'p3@example.com', status: 'pending', token_expires_at: isoAt(LIVE + 3 * DAY) }] };
  for (const sent of [true, false]) {
    const view = await mounted('/admin/partner-invitations/invitations', worker({
      invitations: [out], envelopes: { 77: envelope },
      // Both of the Worker's paths (the signing link renewed, or the onboarding email instead) reply in this one shape.
      writes: { resend: () => response({ ok: true, email_sent: sent, link: 'https://axal.vc/partners/onboard?token=tok3-reply', expires_at: '2026-12-01T10:00:00.000Z' }) },
    }));
    try {
      await view.click('partners-inv-menu-3');
      await view.click('partners-inv-menu-3-resend');
      // D924: what the Worker does at Agreement out, from R7 as the dialog opens.
      assert.match(view.textOf('partners-resend-lines'), /The agreement’s signing link is renewed too, until \d+ \w{3} \d{4}, and the email carries it\./);
      assert.doesNotMatch(view.textOf('partners-resend-dialog'), /does not renew|Open the envelope/, 'before the write nothing says the link stays as it was');
      await view.click('partners-resend-go');
      // C5: the reply does not say whether this write renewed the signing link, so the result never says it was, or was not.
      assert.equal(view.textOf('partners-resend-result'), sent ? RESENT_SENT : `${RESENT_NOT_SENT}Copy link`);
      assert.doesNotMatch(view.textOf('partners-resend-dialog').replace(view.textOf('partners-resend-lines'), ''), /renew/i);
      assert.ok(!view.has('partners-resend-envelope'), 'no envelope link from what R7 said before the write');
      assert.equal(view.has('partners-resend-copy'), !sent, 'when no email went, the reply\'s link is there to copy');
      if (!sent) assert.equal(view.props('partners-resend-copy-field').value, 'https://axal.vc/partners/onboard?token=tok3-reply', 'the reply\'s own link');
    } finally { await view.close(); }
  }
});

test('a record opened from a row read for its address is read again after a write, so it never offers writes the Worker now refuses (finding 11)', async () => {
  let row = liveInv(999, { recipient_email: 'old@example.com', recipient_name: 'Old Partner', createdMs: LIVE - 60 * DAY, is_expired: true });
  const view = await mounted('/admin/partner-invitations', worker({
    invitations: (q) => response({ items: q.get('email') ? (row.recipient_email.includes(q.get('email')) ? [row] : []) : many(CAPS.invitations, (i) => liveInv(i)) }),
    writes: { revoke: () => { row = { ...row, status: 'revoked', revoked_at: d1(LIVE) }; return response({ ok: true, voided_deals: 0, voided_envelopes: 0, failures: [] }); } },
  }));
  try {
    await view.click('partners-new-button');
    await view.change('partners-new-email', { value: 'old@example.com' });
    await view.wait(450);
    const open = view.within('partners-new-dup', (p, n) => String(n.tagName).toUpperCase() === 'A')[0];
    assert.ok(open, 'the duplicate check offers "Open it"');
    await act(async () => { view.nodeProps(open).onClick(clickEvent); });
    await view.flush();
    assert.equal(view.at.path, '/admin/partner-invitations/invitations/999');
    assert.ok(view.has('partners-invitation-revoke'), 'the record, outside the newest 200, opens from the row read for its address');
    await view.click('partners-invitation-revoke');
    await view.click('partners-revoke-go');
    await view.click('partners-revoke-go-done');
    assert.match(view.textOf('partners-invitation-stage'), /Revoked/, 'the record shows the Worker\'s state after the write');
    assert.ok(!view.has('partners-invitation-resend') && !view.has('partners-invitation-revoke'), 'and offers no write the Worker now refuses');
  } finally { await view.close(); }
});

test('a deal before signing never says its address is "not recorded" when the invitations were not read in full (finding 17)', async () => {
  const proposed = deal(8, { status: 'proposed', invitation_id: 2, user_id: null, partner_email: null, partner_name: null, referral_code: null, activated_at: null, expires_at: null, envelope_id: null });
  for (const [invitations, title] of [[() => response({ error: 'down' }, 503), 'Could not be read'], [many(CAPS.invitations, (i) => liveInv(1000 + i)), NOT_IN_READ]]) {
    const view = await mounted('/admin/partner-invitations/deals/8', worker({ invitations, deals: { proposed: [proposed] } }));
    try {
      assert.match(view.textOf('partners-deal'), new RegExp(`${title}Deal #8`));
      assert.doesNotMatch(view.textOf('partners-deal'), /address not recorded/, 'the address is stored; it was not read here');
    } finally { await view.close(); }
  }
  const complete = await mounted('/admin/partner-invitations/deals/8', worker({ invitations: [liveInv(5)], deals: { proposed: [proposed] } }));
  try {
    assert.match(complete.textOf('partners-deal'), /Not recordedDeal #8 · address not recorded/, 'read in full with no invitation for it: then it is not recorded');
  } finally { await complete.close(); }
});

test('a deal record whose list could not be read offers Try again inside the dialog (finding 18)', async () => {
  let tries = 0;
  const view = await mounted('/admin/partner-invitations/deals/41', worker({ deals: { active: [deal(7)], expired: () => { tries += 1; return response({ error: 'down' }, 503); } } }));
  try {
    assert.equal(view.textOf('partners-deal-read-expired-unreadable').trim(), 'The deals in “Term over” could not be read. So this deal could not be looked up. That is not a claim that it does not exist.Try again');
    assert.doesNotMatch(view.textOf('partners-deal-absent'), /Not in this read/);
    const before = tries;
    await view.press('Try again', 'partners-deal-absent');
    assert.equal(tries, before + 1, 'Try again reads the lists again');
  } finally { await view.close(); }
});

test('after Terminate from the record, the record never says "Not in this read" while the lists answer one by one (finding 19)', async () => {
  let ended = false;
  const lio = deal(7, { partner_name: 'Lio Testwell', expires_at: isoAt(LIVE + 100 * DAY) });
  const later = (ms, body) => new Promise((done) => setTimeout(() => done(response(body)), ms));
  const view = await mounted('/admin/partner-invitations/deals/7', worker({
    deals: {
      active: () => response({ items: ended ? [] : [lio] }),
      terminated: () => (ended ? later(300, { items: [{ ...lio, status: 'terminated', terminated_at: d1(LIVE) }] }) : response({ items: [] })),
    },
    writes: { terminate: () => { ended = true; return response({ ok: true, members_revoked: 0, partner_tiers_reverted: true, failures: [] }); } },
  }));
  try {
    await view.click('partners-deal-terminate');
    await view.change('partners-terminate-reason', { value: 'Breach' });
    await view.click('partners-terminate-go');
    await view.click('partners-terminate-go-done');
    // Active has answered without deal 7; Terminated is still being read again.
    assert.ok(!view.has('partners-deal-absent-reason'));
    assert.doesNotMatch(view.textOf('partners-deal'), /Not in this read/);
    await view.wait(350);
    assert.match(view.textOf('partners-deal-state'), /Terminated/);
  } finally { await view.close(); }
});

test('Top deals reads R3 across every state and lists only the deals with redemptions (finding 22)', async () => {
  const view = await mounted('/admin/partner-invitations/deals', worker({ top: { items: [deal(1, { redemptions_count: 3 }), deal(2, { redemptions_count: 0 })], status: 'all', limit: 5 } }));
  try {
    assert.ok(view.requests.some((r) => r.url === '/api/admin/partners/deals/top?limit=5&status=all'), 'every state, five rows');
    assert.match(view.textOf('partners-top'), /Dana 1/);
    assert.doesNotMatch(view.textOf('partners-top'), /Dana 2/, 'a deal with no redemption is left out');
    assert.ok(!view.has('partners-top-read-unreadable'));
  } finally { await view.close(); }
  const none = await mounted('/admin/partner-invitations/deals', worker());
  try { assert.match(none.textOf('partners-top'), /No deal has a redemption yet\./); } finally { await none.close(); }
  const down = await mounted('/admin/partner-invitations/deals', worker({ top: () => response({ error: 'x' }, 500) }));
  try {
    assert.ok(down.has('partners-top-read-unreadable'));
    assert.doesNotMatch(down.textOf('partners-top'), /No deal has a redemption yet/);
  } finally { await down.close(); }
});

test('a 423 cool-off on R9 and R5 is said as paused on Deals, never as unread or as a silent fallback (finding 23)', async () => {
  const coolOff = () => response({ error: 'recovery_cool_off_active' }, 423);
  const view = await mounted('/admin/partner-invitations/deals', worker({ deals: { active: [deal(7, { expires_at: isoAt(LIVE + 50 * DAY) })] }, cases: coolOff, contracts: coolOff }));
  try {
    assert.equal(view.textOf('partners-deals-cases-unreadable'), 'Reading the due-diligence cases is paused after a recent account recovery. It resumes when the 24-hour cool-off ends.Try again');
    assert.match(view.textOf('partners-deals-row-7'), /Paused after a recent account recovery/);
    assert.doesNotMatch(view.textOf('partners-deals-row-7'), /No case on record|Could not be read|Not opened/);
    assert.equal(view.textOf('partners-deals-contracts-paused'), CONTRACTS_PAUSED);
    assert.equal(view.textOf('partners-tab-deals-count'), `1, Every deal, in every state. ${CONTRACTS_PAUSED}`);
  } finally { await view.close(); }
});

test('copying a referral code that fails says to select the code, in a field named for it (finding 12)', async () => {
  const view = await mounted('/admin/partner-invitations/deals', worker({ deals: { active: [deal(7)] } }), { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  try {
    await view.click('partners-deals-copy-7');
    assert.equal(view.textOf('partners-deals-copy-7-result'), 'Copy failed. Select the code and copy it.');
    assert.equal(view.props('partners-deals-copy-7-field')['aria-label'], 'The code');
    assert.equal(view.props('partners-deals-copy-7-field').value, 'PART-7');
  } finally { await view.close(); }
});

test('a record not in the lists says why: past a cap, or no record has the address; an undecodable address never crashes (C1, finding 13)', async () => {
  const cases = [
    ['/admin/partner-invitations/invitations/12', worker({ invitations: [liveInv(1)] }), 'partners-invitation', NO_INVITATION],
    ['/admin/partner-invitations/invitations/12', worker({ invitations: many(CAPS.invitations, (i) => liveInv(1000 + i)) }), 'partners-invitation', MISSING_INVITATION],
    ['/admin/partner-invitations/invitations/%E0', worker(), 'partners-invitation', NO_INVITATION],
    ['/admin/partner-invitations/deals/12', worker({ deals: { active: [deal(1)] } }), 'partners-deal', NO_DEAL],
    ['/admin/partner-invitations/deals/12', worker({ deals: { active: many(CAPS.deals, (i) => deal(1000 + i)) } }), 'partners-deal', MISSING_DEAL],
    ['/admin/partner-invitations/deals/50%', worker(), 'partners-deal', NO_DEAL],
  ];
  for (const [url, handle, id, reason] of cases) {
    const view = await mounted(url, handle);
    try {
      assert.equal(view.textOf(`${id}-absent`), `${NOT_IN_READ}${reason}`, url);
    } finally { await view.close(); }
  }
});

test('Needs you at a cap is never "Nothing here needs you now.", and its count says it is a floor (finding 1)', async () => {
  const view = await mounted('/admin/partner-invitations', worker({ invitations: [liveInv(1)], deals: { active: many(CAPS.deals, (i) => deal(i, { expires_at: isoAt(LIVE + 200 * DAY) })) } }));
  try {
    assert.ok(!view.has('partners-needs-none'));
    assert.equal(view.textOf('partners-needs-cover-active'), 'Deals ending are checked over the newest 200 active deals.');
    assert.equal(view.textOf('partners-tab-overview-count'), '0+, Rows drawn in Needs you; some lists stop at their cap');
  } finally { await view.close(); }
});

/* ------------------------------------------------------------------ *
 * The fix commit's check (D923): C1–C6 and S1
 * ------------------------------------------------------------------ */

/** The listeners the page adds to window and document, so a test can fire a scroll or a pointerdown. */
function listen() {
  const on = [];
  const was = { wa: globalThis.addEventListener, wr: globalThis.removeEventListener, da: document.addEventListener, dr: document.removeEventListener };
  const add = (where) => (type, fn) => { on.push({ where, type, fn }); };
  const remove = (where) => (type, fn) => { const i = on.findIndex((l) => l.where === where && l.type === type && l.fn === fn); if (i >= 0) on.splice(i, 1); };
  globalThis.addEventListener = add('window'); globalThis.removeEventListener = remove('window');
  document.addEventListener = add('document'); document.removeEventListener = remove('document');
  return {
    count: (where, type) => on.filter((l) => l.where === where && l.type === type).length,
    async fire(where, type, event = {}) { await act(async () => { for (const l of on.filter((x) => x.where === where && x.type === type)) l.fn(event); }); },
    restore() { globalThis.addEventListener = was.wa; globalThis.removeEventListener = was.wr; document.addEventListener = was.da; document.removeEventListener = was.dr; },
  };
}

test('a record from a read that could not refresh is stale, and a copy from a read that answered wins (C1)', () => {
  assert.deepEqual(findInvitation('12', ready([]), new Map([['12', stale(inv(12))]])), { state: 'ready', inv: inv(12), stale: true }, 'an adopted row whose read by address failed stays, stale');
  assert.deepEqual(findInvitation('12', ready([]), new Map([['12', ready(inv(12))]])), { state: 'ready', inv: inv(12), stale: false });
  assert.deepEqual(findInvitation('12', stale([inv(12, { status: 'viewed' })]), new Map([['12', ready(inv(12))]])), { state: 'ready', inv: inv(12), stale: false }, 'the fresh copy wins');
  assert.equal(findInvitation('12', ready([inv(12, { status: 'viewed' })]), new Map([['12', stale(inv(12))]])).inv.status, 'viewed');
  assert.deepEqual(findInvitation('12', stale([inv(12)])), { state: 'ready', inv: inv(12), stale: true }, 'R1\'s own stale row says so too');
});

test('an adopted record whose read by address fails stays under "Could not refresh" with Try again; it goes only when that read answers without it (C1)', async () => {
  let row = liveInv(999, { recipient_email: 'old@example.com', recipient_name: 'Old Partner', createdMs: LIVE - 60 * DAY, is_expired: true });
  let byAddress = 'ok';
  let afterWrite = 'down';
  const view = await mounted('/admin/partner-invitations', worker({
    // R1 at its cap without 999; the read by address answers as `byAddress` says.
    invitations: (q) => {
      if (!q.get('email')) return response({ items: many(CAPS.invitations, (i) => liveInv(i)) });
      if (byAddress === 'down') return response({ error: 'down' }, 503);
      return response({ items: byAddress === 'gone' ? [] : [row] });
    },
    writes: {
      resend: () => {
        byAddress = afterWrite;
        row = { ...row, expires_at: isoAt(LIVE + 14 * DAY), is_expired: false };
        return response({ ok: true, email_sent: true, link: row.link, expires_at: row.expires_at });
      },
    },
  }));
  const resend = async () => { await view.click('partners-invitation-resend'); await view.click('partners-resend-go'); await view.click('partners-resend-go-done'); };
  try {
    await view.click('partners-new-button');
    await view.change('partners-new-email', { value: 'old@example.com' });
    await view.wait(450);
    const open = view.within('partners-new-dup', (p, n) => String(n.tagName).toUpperCase() === 'A')[0];
    await act(async () => { view.nodeProps(open).onClick(clickEvent); });
    await view.flush();
    assert.match(view.textOf('partners-invitation-stage'), /Lapsed/);
    assert.ok(!view.has('partners-invitation-read-stale'));
    // Done reads it again by its address, and that read answers 503.
    await resend();
    assert.ok(!view.has('partners-invitation-absent'), 'the record stays: a failed read is not "Not in this read"');
    assert.doesNotMatch(view.textOf('partners-invitation'), /Not in this read|not among the newest 200/);
    assert.equal(view.textOf('partners-invitation-read-stale'), 'Could not refresh this invitation. The record below is from the last read.Try again');
    assert.match(view.textOf('partners-invitation-stage'), /Lapsed/, 'drawn from the last read, under the line');
    // Try again reads it again; it answers, and the line goes.
    byAddress = 'ok';
    await view.press('Try again', 'partners-invitation-read-stale');
    assert.ok(!view.has('partners-invitation-read-stale'));
    assert.doesNotMatch(view.textOf('partners-invitation-stage'), /Lapsed/, 'the Worker\'s state after the write');
    // Only a read that answers without it drops it.
    afterWrite = 'gone';
    await resend();
    assert.equal(view.textOf('partners-invitation-absent'), `${NOT_IN_READ}${MISSING_INVITATION}`);
  } finally { await view.close(); }
});

test('a deal\'s partner and invitation are "Not recorded" only when R1 answered on its latest read (C2)', () => {
  const before = deal(8, { status: 'proposed', invitation_id: 77, user_id: null, partner_email: null, partner_name: null });
  const retrying = (data) => ({ ...stale(data), status: 'loading', refreshing: true });
  assert.deepEqual(invitationForDeal(before, ready([inv(1)])), { state: 'none' });
  assert.deepEqual(invitationForDeal(before, stale([inv(1)])), { state: 'unreadable' });
  assert.deepEqual(invitationForDeal(before, retrying([inv(1)])), { state: 'loading' });
  assert.deepEqual(dealPartner(before, ready([inv(1)])), { name: NOT_RECORDED, email: null }, 'read in full, with no invitation for it');
  assert.deepEqual(dealPartner(before, stale([inv(1)])), { name: COULD_NOT_READ, email: null }, 'a refresh that failed: the invitation can be newer than the last good read');
  assert.deepEqual(dealPartner(before, retrying([inv(1)])), { name: READING, email: null }, 'nor while that list is read again');
  assert.equal(dealPartner(before, stale([inv(77)])).email, 'p77@example.com', 'a stale row that holds it still names it');
  // The Awaiting tile counts a deal whose invitation it could not check, and never drops it.
  const tile = dealTiles({ deals: lists({ awaiting_signature: ready([{ ...before, status: 'awaiting_signature' }]) }), invitations: stale([inv(1)]), fan: { state: 'loading' }, now: NOW }).find((t) => t.key === 'awaiting');
  assert.equal(tile.cover, '1 whose invitation is not in this read.');
});

test('a deal before signing says the invitations could not be read, never "address not recorded", after R1 could not refresh (C2)', async () => {
  let r1 = 0;
  let p = 0;
  const proposed = deal(8, { status: 'proposed', invitation_id: 77, user_id: null, partner_email: null, partner_name: null, referral_code: null, activated_at: null, expires_at: null, envelope_id: null });
  const view = await mounted('/admin/partner-invitations/deals/8', worker({
    invitations: () => { r1 += 1; return r1 === 1 ? response({ items: [liveInv(1)] }) : r1 === 2 ? response({ error: 'down' }, 503) : response({ items: [liveInv(1), liveInv(77)] }); },
    deals: { proposed: () => { p += 1; return p === 1 ? response({ error: 'down' }, 503) : response({ items: [proposed] }); } },
  }));
  try {
    // R2 `proposed` answers on Try again; R1 fails that time, so it keeps [1] from its first read, which is not 77.
    await view.press('Try again', 'partners-deal-absent');
    assert.match(view.textOf('partners-deal'), new RegExp(`${COULD_NOT_READ}Deal #8`));
    assert.doesNotMatch(view.textOf('partners-deal'), /not recorded/i, 'invitation 77 and its address are stored; they were not read');
    assert.equal(view.textOf('partners-deal-invitation-read-unreadable').trim(), 'The invitations could not be read. A failed list is not a claim that there are none.Try again');
    await view.press('Try again', 'partners-deal-invitation');
    assert.match(view.textOf('partners-deal'), /Partner 77Deal #8 · p77@example\.com/);
  } finally { await view.close(); }
});

test('on a phone the row menu closes on a pointerdown outside it, keeps its place while its tab is hidden, and is placed again when the tab shows (C3)', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    invitations: [liveInv(1, { recipient_name: 'Ann One' }), liveInv(2, { recipient_name: 'Zed Two' }), liveInv(3, { recipient_name: 'Cy Three' })],
  }), { phone: true });
  const was = { innerHeight: globalThis.innerHeight, innerWidth: globalThis.innerWidth };
  const ears = listen();
  try {
    globalThis.innerHeight = 700;
    globalThis.innerWidth = 375;
    let rect = { top: 100, bottom: 130, left: 306, right: 340, width: 34, height: 30 };
    // An element under `hidden` (display: none) has no box: its rect is all zeros.
    view.node('partners-inv-menu-1').getBoundingClientRect = () => (view.props('partners-tab-area').hidden ? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } : rect);
    const style = () => view.props('partners-inv-menu-1-list').style;
    await view.click('partners-inv-menu-1');
    const placed = { position: 'fixed', top: 136, bottom: undefined, right: 35, maxHeight: 552 };
    assert.deepEqual(style(), placed);
    await ears.fire('document', 'pointerdown', { target: view.node('partners-inv-menu-1-resend') });
    assert.ok(view.has('partners-inv-menu-1-list'), 'a pointerdown inside the menu keeps it open');
    // A keyboard user opens another row with the menu still open: the tab is hidden under the record page.
    await view.key('partners-inv-row-2', 'Enter');
    assert.ok(view.has('partners-invitation-page'));
    await ears.fire('window', 'scroll');
    assert.ok(view.has('partners-inv-menu-1-list'), 'a hidden ⋯ is kept open for its tab to show again');
    assert.deepEqual(style(), placed, 'a ⋯ with no box keeps its last placing, never one from a zero rect (right 375, off screen)');
    // The record page scrolled the tab: ⋯ is lower when it shows again.
    rect = { top: 200, bottom: 230, left: 306, right: 340, width: 34, height: 30 };
    await view.click('partners-invitation-back');
    assert.equal(view.props('partners-tab-area').hidden, false);
    assert.deepEqual(style(), { ...placed, top: 236, maxHeight: 452 }, 'placed beside ⋯ again as the tab shows, with no scroll or resize');
    // A tap on another row: the pointerdown closes the menu before that row's record opens.
    await ears.fire('document', 'pointerdown', { target: view.node('partners-inv-row-3') });
    assert.ok(!view.has('partners-inv-menu-1-list'));
    assert.equal(view.props('partners-inv-menu-1')['aria-expanded'], false);
    assert.deepEqual([ears.count('window', 'scroll'), ears.count('window', 'resize'), ears.count('document', 'pointerdown')], [0, 0, 0], 'and it stops listening');
  } finally {
    ears.restore();
    globalThis.innerHeight = was.innerHeight;
    globalThis.innerWidth = was.innerWidth;
    await view.close();
  }
});

test('the row menu closes when ⋯ leaves the box that clips it or the window, and its height never passes the window (C4)', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ invitations: [liveInv(1)] }));
  const was = { innerHeight: globalThis.innerHeight, innerWidth: globalThis.innerWidth, getComputedStyle: globalThis.getComputedStyle };
  const ears = listen();
  try {
    globalThis.innerHeight = 900;
    globalThis.innerWidth = 1280;
    // The app's scroller (`[data-app-scroll]` main) starts under the 56px top bar; the desk stands in for it here.
    const main = view.node('partners-desk');
    main.getBoundingClientRect = () => ({ top: 56, bottom: 900, left: 0, right: 1280, width: 1280, height: 844 });
    const clips = new Set([main]);
    globalThis.getComputedStyle = (n) => (clips.has(n) ? { overflowX: 'hidden', overflowY: 'auto' } : { overflowX: 'visible', overflowY: 'visible' });
    let rect = { top: 70, bottom: 100, left: 1200, right: 1234, width: 34, height: 30 };
    view.node('partners-inv-menu-1').getBoundingClientRect = () => rect;
    const style = () => view.props('partners-inv-menu-1-list').style;
    const scroll = async (r) => { rect = r; await ears.fire('window', 'scroll', { target: main }); };
    await view.click('partners-inv-menu-1');
    assert.deepEqual(style(), { position: 'fixed', top: 106, bottom: undefined, right: 46, maxHeight: 782 });
    await scroll({ ...rect, top: 40, bottom: 70 });
    assert.ok(view.has('partners-inv-menu-1-list'), 'partly under the top bar ⋯ is still in sight, so the list stays');
    assert.equal(style().top, 76, 'and follows it');
    await scroll({ ...rect, top: 10, bottom: 40 });
    assert.ok(!view.has('partners-inv-menu-1-list'), 'wholly under the top bar it is out of main: the list closes, never left over the bar');
    assert.equal(view.props('partners-inv-menu-1')['aria-expanded'], false);
    // The table's own overflow box clips sideways.
    const box = view.node('partners-inv-table').parentNode;
    box.getBoundingClientRect = () => ({ top: 56, bottom: 900, left: 240, right: 1180, width: 940, height: 844 });
    clips.add(box);
    rect = { top: 300, bottom: 330, left: 1100, right: 1134, width: 34, height: 30 };
    await view.click('partners-inv-menu-1');
    assert.ok(view.has('partners-inv-menu-1-list'));
    await scroll({ ...rect, left: 1190, right: 1224 });
    assert.ok(!view.has('partners-inv-menu-1-list'), 'scrolled sideways out of the table\'s box, it closes');
    // With no box to clip it, a ⋯ cut by the window's top edge opens downward, no taller than the window less its edges.
    globalThis.getComputedStyle = was.getComputedStyle;
    rect = { top: -26, bottom: 4, left: 1200, right: 1234, width: 34, height: 30 };
    await view.click('partners-inv-menu-1');
    assert.deepEqual(style(), { position: 'fixed', top: 10, bottom: undefined, right: 46, maxHeight: 876 });
    await scroll({ ...rect, top: -40, bottom: -10 });
    assert.ok(!view.has('partners-inv-menu-1-list'), 'out of the window, it closes');
  } finally {
    ears.restore();
    globalThis.innerHeight = was.innerHeight;
    globalThis.innerWidth = was.innerWidth;
    globalThis.getComputedStyle = was.getComputedStyle;
    await view.close();
  }
});

test('the resend result is the reply\'s, whatever the dialog read before the write (C5)', () => {
  assert.equal(RESENT_SENT, 'Sent.');
  assert.equal(RESENT_NOT_SENT, 'Not sent. Copy the link instead.');
  const reply = (sent) => ({ ok: true, email_sent: sent, link: 'https://axal.vc/partners/onboard?token=tok3', expires_at: '2026-11-07T12:00:00.000Z' });
  // A second argument is what the dialog used to pass: its read of R7 before the write. It changes nothing.
  for (const before of [true, false, null]) {
    assert.deepEqual(resentResult(reply(true), before), { text: RESENT_SENT, sent: true });
    assert.deepEqual(resentResult(reply(false), before), { text: RESENT_NOT_SENT, sent: false, copy: true });
  }
  assert.match(read('frontend/src/pages/admin/partners/partnersDeskModel.js'), /#2723 \(part 4\) adds a `signing_link` answer to this reply; part 7 \(#2726\)/);
});

test('the revoke result says what each failed step means, and never an exception (C6)', () => {
  const line = (failures, voided = {}) => revokedLine({ ok: true, voided_deals: 1, voided_envelopes: 1, ...voided, failures });
  const UNDECLINED = 'An agreement was voided, but its signers were not all marked declined. Check it in Contracts.';
  for (const step of ['void_envelope', 'decline_recipients', 'revoke_cascade', 'later_step']) {
    const said = line([{ step, envelope_id: 77, message: 'D1_ERROR: boom', error: 'SQLITE_BUSY', stack: 'at x' }]);
    assert.doesNotMatch(said, /D1_ERROR|SQLITE|boom|at x|void_envelope|decline_recipients|revoke_cascade|later_step|77/, step);
    assert.equal(partialWrite({ failures: [{ step }] }), true, step);
  }
  // `decline_recipients` runs only after the envelope update voided it: never "could not be voided".
  assert.equal(line([{ step: 'decline_recipients', envelope_id: 77 }]), `Invitation revoked. 1 deal voided. 1 agreement voided. ${UNDECLINED}`);
  assert.equal(line([{ step: 'decline_recipients', envelope_id: 77 }, { step: 'decline_recipients', envelope_id: 78 }], { voided_envelopes: 2 }),
    'Invitation revoked. 1 deal voided. 2 agreements voided. Some agreements were voided, but their signers were not all marked declined. Check them in Contracts.');
  assert.equal(line([{ step: 'void_envelope', envelope_id: 77 }, { step: 'decline_recipients', envelope_id: 78 }]),
    `Invitation revoked. 1 deal voided. 1 agreement voided. Some agreements could not be voided. Check them in Contracts. ${UNDECLINED}`);
  // `revoke_cascade` never assumes an offer or an agreement exists: the short variant's invitation can have neither.
  const cascade = line([{ step: 'revoke_cascade' }], { voided_deals: 0, voided_envelopes: 0 });
  assert.equal(cascade, 'Invitation revoked. Any chosen offer or agreement out for signature could not be voided. Check them in Contracts.');
  assert.equal(line([{ step: 'redeemers_read' }], { voided_deals: 0, voided_envelopes: 0 }), 'Invitation revoked. Some of the voiding did not complete. Check the agreements in Contracts.', 'a step this page does not know is still said');
});

test('Revoke takes the long variant while a deal list that could not refresh is read again, not for an ordinary refresh (S1)', () => {
  const retrying = { ...stale([]), status: 'loading', refreshing: true };
  assert.deepEqual(dealsUnion(lists({ proposed: retrying })).retrying, ['proposed']);
  assert.equal(revokeVariant(inv(1), lists({ proposed: retrying })), 'long', 'its rows are still from before the failed refresh: unsure');
  assert.equal(revokeVariant(inv(1), lists({ awaiting_signature: retrying })), 'long');
  assert.equal(revokeVariant(inv(1), lists({ proposed: { ...ready([]), refreshing: true } })), 'short', 'a list that answered last time, read again, is no less sure');
});

test('Revoke opened while a list that could not refresh is read again says the long variant, until that read answers (S1)', async () => {
  let calls = 0;
  const later = (ms, body) => new Promise((done) => setTimeout(() => done(response(body)), ms));
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    invitations: [liveInv(1, { recipient_name: 'Mara Example' })],
    deals: { proposed: () => { calls += 1; return calls === 1 ? response({ items: [] }) : calls === 2 ? response({ error: 'down' }, 503) : later(300, { items: [] }); } },
  }));
  // Any write's Done reads every list again.
  const reload = async () => { await view.click('partners-inv-menu-1'); await view.click('partners-inv-menu-1-resend'); await view.click('partners-resend-go'); await view.click('partners-resend-go-done'); };
  try {
    await reload();
    await reload();
    assert.equal(calls, 3, '`proposed` could not refresh, and is being read again');
    await view.click('partners-inv-menu-1');
    await view.click('partners-inv-menu-1-revoke');
    assert.equal(view.textOf('partners-revoke-body'), 'The link stops working. The chosen offer, and any agreement out for signature, are voided. This cannot be undone.');
    await view.wait(350);
    assert.equal(view.textOf('partners-revoke-body'), 'The link stops working. This cannot be undone.', 'the read answered with no deal for the invitation');
  } finally { await view.close(); }
});
