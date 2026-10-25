/**
 * D929 (#2725) — Partner invitations part 6: the Overview complete, on part
 * 4's overview read (`GET /api/admin/partners/overview`, D927). What this file
 * holds the Overview to:
 *   · every tile, Needs-you row and chart comes from the overview read, and
 *     each block draws D893's states — Reading…, could not be read (with Try
 *     again, naming the block that failed), or the figures — with a zero only
 *     when its block was read;
 *   · C1 counts open invitations by stage with "oldest [n] days" at that
 *     stage, says an invitation with no record of when it got there, and puts
 *     Lapsed under Closed with Signed and Revoked; C2 draws sends and
 *     signatures by Monday week (UTC); C3 deals by type and state group, term
 *     over counted as Ended; C4 redemptions by attribution;
 *   · each chart's "View as table" holds the same figures, and no colour
 *     carries meaning alone;
 *   · a C1 bar opens Invitations at that stage and a C3 segment Deals of that
 *     type and state, filters those tabs read back;
 *   · "Sends that failed" in part 1's words, every Needs-you kind with its one
 *     action (the failed send and due diligence included), PI9's states, the
 *     phone and dark rules, and the charts' home in `ui/`, all mounted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PartnerInvitations from '../src/pages/admin/PartnerInvitations.jsx';
import { ChartTable, Legend } from '../src/ui/Charts.jsx';
import {
  DEAL_STATE_KEYS, NEEDS_KINDS, OVERVIEW_FAILED, dealFiltersFromSearch, dealTiles, dealsByTypeState, invitationTiles,
  needsYou, overviewAgreement, overviewBlock, overviewReply, sendReasonWord, stageChart, stagesFromSearch, tabCounts,
  weekLabel, weekStart, weekStarts, weeklyInvitations, weeklyRedemptions,
} from '../src/pages/admin/partners/partnersDeskModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 86_400_000;
const isoAt = (ms) => new Date(ms).toISOString();

const ready = (data) => ({ status: 'ready', data, error: null });
const failed = (error = { status: 503 }) => ({ status: 'error', data: null, error });
const loading = () => ({ status: 'loading', data: null, error: null });
const stale = (data) => ({ status: 'error', data, error: { status: 503 } });
const lists = (o = {}) => Object.fromEntries(DEAL_STATE_KEYS.map((k) => [k, o[k] ?? ready([])]));
const table = (block) => renderToStaticMarkup(h(ChartTable, { chart: block.chart, caption: block.alt }));
const cells = (html) => [...html.matchAll(/<t[dh][^>]*>([^<]*)<\/t[dh]>/g)].map((m) => m[1]);
const down = (what) => ({ available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` });

// GET /api/admin/partners/invitations — one row, for the names Needs you draws.
const inv = (id, o = {}) => ({
  id, recipient_email: `p${id}@example.com`, recipient_name: `Partner ${id}`, allowed_deal_types: ['services_partnership'], status: 'sent',
  expires_at: isoAt(NOW + 10 * DAY), created_at: '2026-10-20 09:00:00', viewed_at: null, signed_at: null, envelope_id: null, revoked_at: null, ...o,
});
// GET /api/admin/partners/deals?status= — one row.
const deal = (id, o = {}) => ({
  id, invitation_id: null, user_id: 500 + id, deal_type: 'services_partnership', status: 'active', expires_at: '2027-06-29T10:00:00.000Z',
  partner_email: `d${id}@example.com`, partner_name: `Dana ${id}`, redemptions_count: 0, ...o,
});

/** Twelve Monday weeks as the Worker writes them (D927 §2), the last `to_date`. */
const weeksAt = (now, f = () => ({})) => weekStarts(now).map((ms, i) => ({ week_start: isoAt(ms).slice(0, 10), ...(i === 11 ? { to_date: true } : {}), ...f(i) }));
const stage = (o = {}) => ({ count: 0, oldest_entered_at: null, oldest_days: null, entered_not_recorded: 0, ...o });
const STAGES = ['sent', 'viewed', 'profiled', 'proposed', 'selected', 'finalized'];
const STATES0 = { proposed: 0, awaiting_signature: 0, active: 0, term_over: 0, terminated: 0, expired: 0, voided: 0, other: 0 };

/** A whole overview reply, every block available and empty, with `o` laid over it. */
function overview(o = {}, now = NOW) {
  const kinds = {
    lapsed: { available: true, rows: [] }, agreement_blocked: { available: true, agreement: { state: 'ready' }, rows: [] },
    failed_send: { available: true, rows: [] }, deal_ending: { available: true, rows: [] }, unattached_account: { available: true, rows: [] },
    due_diligence_open: { available: true, rows: [] }, revshare_closing: { available: true, rows: [] }, ...(o.kinds || {}),
  };
  return {
    as_of: isoAt(now),
    tiles: {
      open: { available: true, count: 0, oldest_first_sent_at: null }, lapsed: { available: true, count: 0 }, signed_90d: { available: true, count: 0 },
      days_to_sign: { available: true, median_days: null, over_signed: 0 },
      active_deals: { available: true, count: 0, ending_within_30d: 0, term_over_not_closed: 0 },
      awaiting_signature: { available: true, count: 0, invitation_lapsed: 0 }, redemptions_90d: { available: true, count: 0 },
      failed_sends_30d: { available: true, count: 0, by_reason: {} }, ...(o.tiles || {}),
    },
    needs_you: {
      available: true, kinds,
      rows: Object.values(kinds).flatMap((k) => (k.available ? k.rows : [])),
      unreadable_kinds: Object.entries(kinds).filter(([, k]) => !k.available).map(([k]) => k),
    },
    c1: o.c1 ?? { available: true, stages: Object.fromEntries(STAGES.map((s) => [s, stage()])), closed: { signed: 0, lapsed: 0, revoked: 0, signed_after_lapse: 0 } },
    c2: o.c2 ?? { available: true, weeks: weeksAt(now, () => ({ sent: 0, signed: 0 })) },
    c3: o.c3 ?? { available: true, by_type: {} },
    c4: o.c4 ?? { available: true, weeks: weeksAt(now, () => ({ referral: 0, deal_sourcing_revshare: 0, other: 0 })) },
  };
}


/* ------------------------------------------------------------------ *
 * The read and its blocks
 * ------------------------------------------------------------------ */

test('a reply without its blocks is a failed read, never an empty Overview; one block failing leaves the others standing', () => {
  assert.throws(() => overviewReply({}), /did not come back whole/);
  assert.throws(() => overviewReply(null));
  assert.ok(overviewReply(overview()));
  assert.deepEqual(overviewBlock(loading(), (d) => d.c1), { state: 'loading' });
  assert.deepEqual(overviewBlock(failed(), (d) => d.c1), { state: 'unreadable', reason: OVERVIEW_FAILED });
  const one = overview({ c2: down('Invitations sent and signed per week') });
  assert.equal(overviewBlock(ready(one), (d) => d.c2).state, 'unreadable');
  assert.match(overviewBlock(ready(one), (d) => d.c2).reason, /^Invitations sent and signed per week could not be read/);
  assert.equal(overviewBlock(ready(one), (d) => d.c1).state, 'ready');
  // A stale read keeps its figures (the page says it could not refresh).
  assert.equal(overviewBlock(stale(one), (d) => d.c1).state, 'ready');
});

/* ------------------------------------------------------------------ *
 * Tiles
 * ------------------------------------------------------------------ */

test('the tiles: every figure from the read, words where nothing was timed, and a zero only in a block that was read', () => {
  const ov = overview({
    tiles: {
      open: { available: true, count: 4, oldest_first_sent_at: '2026-10-14T09:00:00.000Z' }, lapsed: { available: true, count: 2 },
      signed_90d: { available: true, count: 3 }, days_to_sign: { available: true, median_days: 15.6, over_signed: 7 },
      active_deals: { available: true, count: 9, ending_within_30d: 2, term_over_not_closed: 1 }, awaiting_signature: { available: true, count: 3, invitation_lapsed: 1 },
      redemptions_90d: { available: true, count: 0 }, failed_sends_30d: { available: true, count: 3, by_reason: { suppressed: 1, not_configured: 2 } },
    },
  });
  const t = Object.fromEntries([...invitationTiles(ready(ov)), ...dealTiles(ready(ov))].map((x) => [x.key, x]));
  assert.deepEqual([t.open.value, t.open.sub], ['4', 'oldest first sent 14 Oct 2026']);
  assert.deepEqual([t.lapsed.value, t.lapsed.sub, t.lapsed.tone], ['2', 'link expired before signing', 'amber']);
  assert.equal(t.signed90.value, '3');
  assert.deepEqual([t.median.value, t.median.sub], ['16', 'median, over the last 7 signed']);
  assert.deepEqual([t.active.value, t.active.sub, t.active.subTone, t.active.extra], ['9', '2 end within 30 days', 'amber', '1 is past its end, not yet closed']);
  assert.deepEqual([t.awaiting.value, t.awaiting.sub], ['3', '1 whose invitation has lapsed']);
  assert.equal(t.redemptions90.value, '0', 'a read zero is a zero');
  // "Emails not delivered" is "Sends that failed", in part 1's words: Sent and Not sent.
  assert.deepEqual([t.sends.label, t.sends.value, t.sends.tone], ['Sends that failed', '3', 'amber']);
  assert.match(t.sends.sub, /^Not sent,/);
  assert.equal(t.sends.cover, '2 email is not set up · 1 the address is suppressed');
  assert.equal(sendReasonWord(null), 'no reason recorded');
  const none = Object.fromEntries(invitationTiles(ready(overview())).map((x) => [x.key, x]));
  assert.deepEqual([none.median.value, none.median.words], ['None signed yet', true], 'never a median of 0');
  assert.equal(none.open.sub, null);
  assert.deepEqual(invitationTiles(loading()).map((x) => x.state), ['loading', 'loading', 'loading', 'loading']);
  assert.deepEqual(dealTiles(failed()).map((x) => x.state), ['unreadable', 'unreadable', 'unreadable', 'unreadable']);
  const oneDown = Object.fromEntries(dealTiles(ready(overview({ tiles: { failed_sends_30d: down('The failed sends') } }))).map((x) => [x.key, x]));
  assert.equal(oneDown.sends.state, 'unreadable');
  assert.match(oneDown.sends.reason, /^The failed sends could not be read/);
  assert.equal(oneDown.active.state, 'ready', 'the other tiles still draw');
  assert.ok(![...invitationTiles(ready(overview())), ...dealTiles(ready(overview()))].some((x) => /not delivered|Not read here yet/i.test(JSON.stringify(x))));
});

/* ------------------------------------------------------------------ *
 * Needs you
 * ------------------------------------------------------------------ */

test('Needs you: every kind the read returns, each with its one action, named from the lists the page holds', () => {
  const ov = overview({
    kinds: {
      lapsed: { available: true, rows: [{ kind: 'lapsed', id: 2, stage: 'selected', lapsed_at: '2026-10-08T09:00:00.000Z' }, { kind: 'lapsed', id: 404, stage: 'viewed', lapsed_at: '2026-10-09T09:00:00.000Z' }] },
      agreement_blocked: { available: true, agreement: { state: 'not_ready', why: 'template_has_no_body' }, rows: [{ kind: 'agreement_blocked', id: 3 }] },
      failed_send: { available: true, rows: [{ kind: 'failed_send', id: 3, reason: 'suppressed', last_sent_at: '2026-10-22T08:00:00.000Z' }] },
      deal_ending: { available: true, rows: [{ kind: 'deal_ending', id: 8, ends_at: '2026-11-20T10:00:00.000Z' }, { kind: 'deal_ending', id: 7, ends_at: '2026-11-13T10:00:00.000Z' }] },
      unattached_account: { available: true, rows: [{ kind: 'unattached_account', id: 31 }, { kind: 'unattached_account', id: 32 }] },
      due_diligence_open: { available: true, rows: [{ kind: 'due_diligence_open', id: 7, case_uid: 'dd_7', case_status: 'in_review' }] },
      revshare_closing: { available: true, rows: [{ kind: 'revshare_closing', id: 9, windows: 2 }] },
    },
  });
  const invitations = ready([inv(2, { recipient_name: 'Mara Example' }), inv(3, { recipient_name: 'Teo Sample' })]);
  const deals = lists({ active: ready([deal(7), deal(8, { deal_type: 'custom' }), deal(9, { deal_type: 'deal_sourcing_revshare' })]) });
  const needs = needsYou(ready(ov), { invitations, deals });
  assert.equal(needs.settled, true);
  assert.deepEqual(needs.rows.map((r) => [r.kind, r.text, r.action.label, r.action.to ?? null]), [
    ['Lapsed', 'The invitation to Mara Example lapsed on 8 Oct 2026 at Offer chosen.', 'Resend', null],
    ['Lapsed', 'The invitation to invitation 404 lapsed on 9 Oct 2026 at Opened.', 'Open invitation', '/admin/partner-invitations/invitations/404'],
    ['Not sent', 'The latest send to Teo Sample on 22 Oct 2026 was Not sent: the address is suppressed.', 'Resend', null],
    ['Agreement', 'Teo Sample chose an offer, but the agreement cannot be sent yet: the Partner Services agreement is not ready.', 'Open in Contracts', '/admin/contracts?tab=templates'],
    ['Term ending', 'The Services partnership with Dana 7 ends on 13 Nov 2026.', 'Open deal', '/admin/partner-invitations/deals/7'],
    ['Term ending', 'The custom deal with Dana 8 ends on 20 Nov 2026.', 'Open deal', '/admin/partner-invitations/deals/8'],
    ['Due diligence', 'The partner on the Services partnership with Dana 7 has a due-diligence case in review.', 'Open in Due diligence', '/admin/due-diligence/dd_7'],
    ['Firms', '2 partner accounts are not attached to a firm.', 'Open Firms', '/admin/advisors-partners/firms'],
    ['Rev-share', '2 rev-share windows on the Deal-sourcing revenue share with Dana 9 close within 30 days.', 'Open Referrals', '/admin/partner-invitations/referrals?deal=9'],
  ]);
  assert.equal(needs.rows[0].action.resend.id, 2, 'Resend opens the dialog on that invitation');
  assert.doesNotMatch(JSON.stringify(needs.rows), /blocked|could not be sent|not delivered|Delivered/i);
  assert.equal(overviewAgreement(ready(ov)).state, 'not_ready');
  assert.equal(tabCounts({ invitations, deals, contracts: failed(), needs }).overview.text, '9', 'the Overview tab counts the rows drawn');
});

test('Needs you: a kind that could not be read is named, the read failing says so, and loading is not "nothing needs you"', () => {
  const ov = overview({ kinds: { due_diligence_open: down('The due-diligence cases'), lapsed: { available: true, rows: [{ kind: 'lapsed', id: 2, stage: 'sent', lapsed_at: null }] } } });
  const needs = needsYou(ready(ov), { invitations: failed(), deals: lists() });
  assert.deepEqual(needs.failed.map((f) => [f.key, f.what]), [['due_diligence_open', NEEDS_KINDS.due_diligence_open]]);
  assert.match(needs.failed[0].reason, /could not be read/);
  assert.equal(needs.rows[0].text, 'The invitation to invitation 2 lapsed on Not recorded at Sent.', 'a list that failed still leaves the row, named by its number');
  assert.equal(needs.rows[0].action.to, '/admin/partner-invitations/invitations/2');
  assert.deepEqual(needsYou(failed(), {}), { rows: [], failed: [{ key: 'overview', what: 'The overview', reason: OVERVIEW_FAILED }], settled: true });
  assert.equal(needsYou(loading(), {}).settled, false);
  assert.equal(tabCounts({ invitations: failed(), deals: lists(), contracts: failed(), needs: needsYou(loading(), {}) }).overview, null, 'no count while it reads');
  assert.equal(overviewAgreement(ready(overview({ kinds: { agreement_blocked: down('The agreement check') } }))), null);
});

/* ------------------------------------------------------------------ *
 * Weeks
 * ------------------------------------------------------------------ */

test('weeks: twelve Monday weeks in UTC, the last the current one, labelled as the canvas labels them', () => {
  assert.deepEqual(weekStarts(NOW).map(weekLabel), ['3 Aug', '10 Aug', '17 Aug', '24 Aug', '31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct', '19 Oct']);
  assert.equal(weekStart(Date.parse('2026-10-19T00:00:00Z')), Date.parse('2026-10-19T00:00:00Z'), 'a Monday starts its own week');
  assert.equal(weekStart(Date.parse('2026-10-25T23:59:59Z')), Date.parse('2026-10-19T00:00:00Z'), 'Sunday is the end of the week');
});

/* ------------------------------------------------------------------ *
 * C1 — Where open invitations stand
 * ------------------------------------------------------------------ */

const c1Block = (o = {}) => ({
  available: true,
  stages: {
    ...Object.fromEntries(STAGES.map((s) => [s, stage()])),
    sent: stage({ count: 2, oldest_days: 12, oldest_entered_at: isoAt(NOW - 12 * DAY) }),
    viewed: stage({ count: 1, oldest_days: 0, oldest_entered_at: isoAt(NOW - 3_600_000) }),
    selected: stage({ count: 1, oldest_days: null, entered_not_recorded: 1 }),
    finalized: stage({ count: 1, oldest_days: 3, oldest_entered_at: isoAt(NOW - 3 * DAY) }),
  },
  closed: { signed: 4, lapsed: 1, revoked: 2, signed_after_lapse: 1 },
  ...o,
});

test('C1: its states, open invitations per stage with "oldest [n] days" at that stage, an untimed one said, Lapsed under Closed', () => {
  assert.equal(stageChart(loading()).state, 'loading');
  assert.equal(stageChart(failed()).state, 'unreadable');
  const blockDown = stageChart(ready(overview({ c1: down('Where open invitations stand') })));
  assert.deepEqual([blockDown.state, blockDown.title], ['unreadable', 'Where open invitations stand']);
  const none = stageChart(ready(overview()));
  assert.equal(none.state, 'ready');
  assert.ok(none.chart.rows.every((r) => r.value === 0 && r.text === '0'), 'a read zero, with no "oldest"');
  const b = stageChart(ready(overview({ c1: c1Block() })));
  assert.deepEqual(b.chart.rows.map((r) => [r.label, r.value, r.text, r.group]), [
    ['Sent', 2, '2 · oldest 12 days', 'sent'], ['Opened', 1, '1 · oldest 0 days', 'viewed'], ['Profile done', 0, '0', 'profiled'],
    ['Offers shown', 0, '0', 'proposed'], ['Offer chosen', 1, '1 · oldest not recorded', 'selected'], ['Agreement out', 1, '1 · oldest 3 days', 'finalized'],
  ]);
  assert.deepEqual(b.closed.map((c) => [c.word, c.n]), [['Signed', 4], ['Lapsed', 1], ['Revoked', 2]]);
  assert.deepEqual(b.lines, [
    '1 open invitation has no record of when it reached its stage, so it is counted but not timed.',
    '1 invitation was signed after the link lapsed, and the deal voided.',
  ]);
  assert.match(b.foot, /A lapsed invitation keeps the stage it reached, and a revoked one does not\./);
  assert.match(b.foot, /how long the oldest has been at that stage/);
  assert.equal(b.alt, '5 open invitations by stage now: sent 2, opened 1, profile done 0, offers shown 0, offer chosen 1, agreement out 1.');
});

test('C1: a bar and a closed count open Invitations at that stage, a filter the Invitations tab reads back', () => {
  for (const s of [...STAGES, 'signed', 'lapsed', 'revoked']) {
    assert.deepEqual(stagesFromSearch(`?stage=${s}`), [s], s);
  }
  const b = stageChart(ready(overview({ c1: c1Block() })));
  assert.ok(b.chart.clickable);
  assert.equal(b.chart.rows[0].aria, 'Open Invitations at Sent: 2');
});

/* ------------------------------------------------------------------ *
 * C2 — Invitations per week
 * ------------------------------------------------------------------ */

test('C2: its states; sends and signatures per Monday week, the current week hatched, a read 0 drawn as 0', () => {
  assert.equal(weeklyInvitations(loading()).state, 'loading');
  assert.equal(weeklyInvitations(ready(overview({ c2: down('Invitations sent and signed per week') }))).state, 'unreadable');
  const b = weeklyInvitations(ready(overview({ c2: { available: true, weeks: weeksAt(NOW, (i) => ({ sent: i === 11 ? 3 : i === 0 ? 1 : 0, signed: i === 10 ? 2 : 0 })) } })));
  assert.equal(b.chart.type, 'grouped');
  assert.equal(b.chart.rows.length, 12);
  assert.deepEqual(b.chart.rows.at(-1), { label: '19 Oct', values: [3, 0], toDate: true });
  assert.deepEqual(b.chart.rows[0], { label: '3 Aug', values: [1, 0], toDate: false });
  assert.deepEqual(b.chart.rows.at(-2).values, [0, 2]);
  assert.equal(b.alt, 'Invitations per week for twelve weeks: 4 sent and 2 signed. The current week is not finished.');
});

/* ------------------------------------------------------------------ *
 * C3 — Deals by type and state
 * ------------------------------------------------------------------ */

const c3Block = () => ({
  available: true,
  by_type: {
    services_partnership: { ...STATES0, active: 3, awaiting_signature: 1, proposed: 2, term_over: 1, terminated: 1 },
    deal_sourcing_revshare: { ...STATES0, active: 1, voided: 1, other: 1 },
    equity_partnership: { ...STATES0 }, capital_partnership: { ...STATES0 }, custom: { ...STATES0, expired: 2 },
  },
});

test('C3: its states; deals per type and state group, term over counted as Ended and said, a state not recognised said', () => {
  assert.equal(dealsByTypeState(loading()).state, 'loading');
  assert.equal(dealsByTypeState(ready(overview({ c3: down('Deals by type and state') }))).state, 'unreadable');
  const b = dealsByTypeState(ready(overview({ c3: c3Block() })));
  assert.deepEqual(b.chart.rows.map((r) => [r.key, r.total, r.parts.map((p) => p.value)]), [
    ['services_partnership', '8', [3, 1, 2, 2]], ['deal_sourcing_revshare', '2', [1, 0, 0, 1]],
    ['equity_partnership', '0', [0, 0, 0, 0]], ['capital_partnership', '0', [0, 0, 0, 0]], ['custom', '2', [0, 0, 0, 2]],
  ]);
  assert.deepEqual(b.legend.map((l) => l.label), ['Active 4', 'Awaiting signature 1', 'Offer chosen, not sent 2', 'Ended 5']);
  assert.deepEqual(b.lines, [
    '1 active deal is past its end, not yet closed: it counts as Ended here, and Deals lists it as Active.',
    '1 deal is in a state not recognised and is not drawn.',
  ]);
  assert.match(b.foot, /^Ended counts term over, terminated, expired and voided\./);
});

test('C3: a segment opens Deals of that type and state, a filter the Deals tab reads back', () => {
  const b = dealsByTypeState(ready(overview({ c3: c3Block() })));
  const seg = b.chart.rows[0].parts;
  assert.deepEqual(seg.map((p) => p.to), [
    '/admin/partner-invitations/deals?type=services_partnership&state=active',
    '/admin/partner-invitations/deals?type=services_partnership&state=awaiting_signature',
    '/admin/partner-invitations/deals?type=services_partnership&state=proposed',
    '/admin/partner-invitations/deals?type=services_partnership&state=expired,terminated,voided',
  ]);
  assert.deepEqual(dealFiltersFromSearch('?type=services_partnership&state=expired,terminated,voided'), { type: 'services_partnership', states: ['expired', 'terminated', 'voided'] });
  assert.equal(seg[0].aria, 'Open Deals: Services partnership, Active, 3');
});

/* ------------------------------------------------------------------ *
 * C4 — Referral redemptions per week
 * ------------------------------------------------------------------ */

test('C4: its states; referral solid and rev-share dashed by week, the current week only a hollow point, the unattributed said', () => {
  assert.equal(weeklyRedemptions(loading()).state, 'loading');
  assert.equal(weeklyRedemptions(ready(overview({ c4: down('Redemptions per week') }))).state, 'unreadable');
  const b = weeklyRedemptions(ready(overview({ c4: { available: true, weeks: weeksAt(NOW, (i) => ({ referral: i === 11 ? 2 : 0, deal_sourcing_revshare: i === 9 ? 1 : 0, other: i === 8 ? 1 : 0 })) } })));
  assert.deepEqual(b.chart.series.map((s) => [s.label, s.dash, s.values.reduce((t, n) => t + n, 0)]), [['Referral', false, 2], ['Deal-sourcing rev-share', true, 1]]);
  assert.equal(b.chart.labels.at(-1), '19 Oct');
  assert.deepEqual(b.lines, ['1 redemption in these weeks has no recorded attribution and is not drawn.']);
  assert.deepEqual(b.legend.map((l) => l.tone), ['violet', 'sky', 'hollow']);
});

test('each chart\'s "View as table" holds the figures the chart draws', () => {
  const c2 = weeklyInvitations(ready(overview({ c2: { available: true, weeks: weeksAt(NOW, (i) => ({ sent: i === 11 ? 1 : 0, signed: 0 })) } })));
  const t2 = cells(table(c2));
  assert.deepEqual(t2.slice(0, 3), ['Week', 'Sent', 'Signed']);
  assert.deepEqual(t2.slice(-3), ['19 Oct (so far)', '1', '0']);
  const t1 = cells(table(stageChart(ready(overview({ c1: c1Block() })))));
  assert.ok(t1.includes('2 · oldest 12 days') && t1.includes('Offer chosen'));
  const t3 = cells(table(dealsByTypeState(ready(overview({ c3: c3Block() })))));
  assert.ok(t3.includes('Services partnership · 8') && t3.includes('Ended'));
  const c4 = weeklyRedemptions(ready(overview({ c4: { available: true, weeks: weeksAt(NOW, (i) => ({ referral: i === 11 ? 1 : 0, deal_sourcing_revshare: i === 11 ? 1 : 0, other: 0 })) } })));
  const t4 = cells(table(c4));
  assert.deepEqual(t4.slice(0, 3), ['Week', 'Referral', 'Deal-sourcing rev-share']);
  assert.deepEqual(t4.slice(-3), ['19 Oct (so far)', '1', '1']);
});

test('no colour carries meaning alone: every series is named in a legend or a label, and C4\'s series differ by dash too', () => {
  const html = renderToStaticMarkup(h(Legend, { items: weeklyRedemptions(ready(overview())).legend }));
  assert.match(html, /border-dashed[^"]*border-\[#0ea5e9\][^>]*><\/span>Deal-sourcing rev-share · dashed/);
  assert.match(html, /border-solid[^"]*border-axal-violet[^>]*><\/span>Referral · solid/);
  for (const b of [weeklyInvitations(ready(overview())), dealsByTypeState(ready(overview({ c3: c3Block() })))]) {
    assert.ok(b.legend.every((l) => l.label), `${b.key}: every swatch has its words`);
  }
  assert.ok(stageChart(ready(overview())).chart.rows.every((r) => r.label && r.aria), 'C1 bars are labelled, and each button names what it opens');
});

test('the charts live in ui/ (D915 §6): one palette, Insights and Community import them from the barrel, no second copy', () => {
  const charts = read('frontend/src/ui/Charts.jsx');
  for (const part of ['HBars', 'Columns', 'GroupedColumns', 'StackBars', 'WeekLine', 'WeekLines', 'Bar100', 'Donut', 'Legend', 'ChartTable', 'Chart', 'RunningTotal']) {
    assert.match(charts, new RegExp(`export function ${part}\\(`), part);
  }
  assert.match(read('frontend/src/ui/index.js'), /GroupedColumns, HBars, Legend, RunningTotal, StackBars, WeekLine, WeekLines/);
  for (const f of ['frontend/src/pages/admin/insights/AdminInsights.jsx', 'frontend/src/pages/admin/community/AdminCommunity.jsx', 'frontend/src/pages/admin/partners/PartnersOverview.jsx']) {
    assert.doesNotMatch(read(f), /InsightsCharts/, f);
  }
  // The five tones, and only violet changes in dark mode.
  // #faf9fc is the table header's ground, D893's own; every other hex is a palette tone.
  assert.doesNotMatch(charts, /#(?!0ea5e9|f59e0b|10b981|a78bfa|7c3aed|faf9fc)[0-9a-f]{6}\b/i, 'no colour outside the one palette');
  assert.doesNotMatch(read('frontend/src/pages/admin/partners/PartnersOverview.jsx'), /#[0-9a-f]{6}\b|axal-(?!hairline|ink|lavender|lavender-edge|violet|violet-deep|muted)[a-z-]+/i, 'no colour of its own, no new axal-* token');
});

test('PI11a and PI12: tiles two up, Needs you as cards and one chart per card on a phone; every class has its dark pair', () => {
  const src = read('frontend/src/pages/admin/partners/PartnersOverview.jsx');
  assert.match(src, /grid grid-cols-2 gap-3\.5 lg:grid-cols-4" data-testid="partners-tiles-invitations"/);
  assert.match(src, /grid grid-cols-1 gap-3\.5 lg:grid-cols-2" data-testid="partners-charts"/);
  assert.match(src, /max-lg:rounded-\[10px\] max-lg:border max-lg:px-3/);
  // PI12: the parts' light classes each carry their dark pair, and only violet changes tone.
  const charts = read('frontend/src/ui/Charts.jsx');
  for (const [light, dark] of [['fill-white', 'dark:fill-gray-900'], ['fill-axal-ink', 'dark:fill-gray-200'], ['stroke-axal-hairline', 'dark:stroke-gray-700'], ['fill-axal-violet', 'dark:fill-[#a78bfa]'], ['stroke-axal-violet', 'dark:stroke-[#a78bfa]'], ['border-axal-violet', 'dark:border-[#a78bfa]']]) {
    const bare = charts.split(light).length - 1;
    assert.ok(bare > 0, `${light} is used`);
    assert.equal(charts.split(`${light} ${dark}`).length - 1, bare, `${light} always has ${dark}`);
  }
});

test('the Overview reads one route for its figures: no list, fan-out or cap reaches a tile, a row or a chart', () => {
  const src = read('frontend/src/pages/admin/partners/PartnersOverview.jsx');
  assert.doesNotMatch(src, /reads\.(invitations|deals|contracts|links|template|calls)\b(?!\))/, 'only first use reads R1');
  assert.match(src, /isFirstUse\(reads\.invitations\)/);
  assert.match(read('frontend/src/pages/admin/partners/usePartnerDesk.js'), /api\.adminPartners\.overview\(\)\.then\(overviewReply\)/);
  assert.doesNotMatch(src, /WITHIN_INVITATIONS|WITHIN_DEALS|fanFigure|not checked here yet/);
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const LIVE = Date.now();

function worker({ invitations = [inv(1)], deals = {}, ov = overview({}, LIVE) } = {}) {
  const call = (v, ...a) => (typeof v === 'function' ? v(...a) : response(v));
  return (url) => {
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (path === '/api/admin/partners/overview') return call(ov);
    if (path === '/api/admin/partners/invitations') return call(typeof invitations === 'function' ? invitations : { items: invitations });
    if (path === '/api/admin/partners/deals/top') return response({ items: [] });
    if (path === '/api/admin/partners/deals') return call(deals[q.get('status')] ?? { items: [] });
    if (/^\/api\/admin\/partners\/deals\/\d+\/redemptions$/.test(path)) return response({ items: [] });
    if (path === '/api/admin/contracts/partner-deals') return response({ items: [], total: 0, limit: 500, offset: 0 });
    if (path === '/api/admin/partners/links') return response({ accounts: [], firms: [], attached: 0, unattached: 0 });
    if (path === '/api/legal/esign/templates/partner_services') return response({ doc_type: 'partner_services', fields: [] });
    if (path === '/api/dd/cases') return response({ items: [] });
    return response({});
  };
}

async function mounted(url, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(PartnerInvitations), h(Probe))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    at, flush,
    has: (id) => Boolean(byId(id)),
    textOf: (id) => text(byId(id)),
    props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async key(id, key) { const n = byId(id); await act(async () => { props(n).onKeyDown({ key, preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; restore(); },
  };
}

const liveOverview = () => overview({
  c1: { ...c1Block(), closed: { signed: 1, lapsed: 0, revoked: 0, signed_after_lapse: 0 } },
  c2: { available: true, weeks: weeksAt(LIVE, (i) => ({ sent: i === 11 ? 2 : 0, signed: 0 })) },
  c3: c3Block(),
  c4: { available: true, weeks: weeksAt(LIVE, (i) => ({ referral: i === 11 ? 1 : 0, deal_sourcing_revshare: 0, other: 0 })) },
  tiles: { failed_sends_30d: { available: true, count: 1, by_reason: { refused: 1 } } },
  kinds: {
    failed_send: { available: true, rows: [{ kind: 'failed_send', id: 1, reason: 'refused', last_sent_at: isoAt(LIVE - DAY) }] },
    due_diligence_open: { available: true, rows: [{ kind: 'due_diligence_open', id: 11, case_uid: 'dd_11', case_status: 'open' }] },
  },
}, LIVE);

test('mounted: the tiles, Needs you and C1–C4 draw from the overview read, and "View as table" swaps the chart for its table', async () => {
  const view = await mounted('/admin/partner-invitations', worker({ ov: liveOverview(), deals: { active: { items: [deal(11)] } } }));
  try {
    for (const k of ['c1', 'c2', 'c3', 'c4']) assert.ok(view.has(`partners-${k}-chart`), `${k} draws`);
    assert.match(view.props('partners-c1-chart')['aria-label'], /^5 open invitations by stage now: sent 2, opened 1,/);
    assert.match(view.props('partners-c4-chart')['aria-label'], /: 1 through referral and 0 through deal-sourcing rev-share/);
    assert.equal(view.textOf('partners-c1-closed'), 'Closed: Signed 1 · Lapsed 0 · Revoked 0');
    assert.match(view.textOf('partners-tile-sends'), /^Sends that failed1Not sent,.*1 the mail service refused it$/);
    assert.equal(view.textOf('partners-needs-send-1'), 'Not sentThe latest send to Partner 1 on ' + new Date(LIVE - DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ' was Not sent: the mail service refused it.Resend');
    assert.equal(view.textOf('partners-needs-dd-11'), 'Due diligenceThe partner on the Services partnership with Dana 11 has a due-diligence case open.Open in Due diligence');
    assert.equal(view.props('partners-needs-dd-11-go').href, '/admin/due-diligence/dd_11');
    assert.match(view.textOf('partners-tab-overview-count'), /^2, Rows in Needs you$/);
    await view.click('partners-c2-table-toggle');
    assert.ok(view.has('partners-c2-table') && !view.has('partners-c2-chart'));
    assert.equal(view.props('partners-c2-table-toggle')['aria-pressed'], true);
    assert.match(view.textOf('partners-c2-table'), /WeekSentSigned/);
  } finally { await view.close(); }
});

test('mounted: a C1 bar opens Invitations at that stage with its chip on; a C3 segment opens Deals of that type and state', async () => {
  const view = await mounted('/admin/partner-invitations', worker({ ov: liveOverview(), invitations: [inv(1), inv(2, { status: 'viewed' })] }));
  try {
    assert.equal(view.props('partners-c1-closed-signed').href, '/admin/partner-invitations/invitations?stage=signed');
    await view.click('partners-c1-viewed');
    assert.equal(view.at.path, '/admin/partner-invitations/invitations?stage=viewed');
    assert.equal(view.props('partners-inv-chip-viewed')['aria-pressed'], true, 'the chip the bar named is on');
  } finally { await view.close(); }
  const deals = await mounted('/admin/partner-invitations', worker({ ov: liveOverview() }));
  try {
    await deals.key('partners-c3-services_partnership-proposed', 'Enter');
    assert.equal(deals.at.path, '/admin/partner-invitations/deals?type=services_partnership&state=proposed');
    assert.equal(deals.props('partners-deals-chip-proposed')['aria-pressed'], true);
  } finally { await deals.close(); }
});

test('mounted PI9: the read failing, one block unreadable while the rest draw, loading, first use, the banner', async () => {
  const gone = await mounted('/admin/partner-invitations', worker({ ov: () => response({ error: 'down' }, 503) }));
  try {
    for (const k of ['c1', 'c2', 'c3', 'c4']) assert.ok(gone.has(`partners-${k}-unreadable`), `${k} says it could not be read`);
    assert.match(gone.textOf('partners-tile-open'), /could not be read/);
    assert.ok(gone.has('partners-needs-failed-overview'));
    assert.ok(!gone.has('partners-needs-none'), 'never "Nothing here needs you" when it could not be read');
    assert.ok(!gone.has('partners-first-use'));
  } finally { await gone.close(); }
  const one = await mounted('/admin/partner-invitations', worker({ ov: overview({ c3: down('Deals by type and state'), kinds: { due_diligence_open: down('The due-diligence cases') } }, LIVE) }));
  try {
    assert.ok(one.has('partners-c3-unreadable'));
    assert.match(one.textOf('partners-c3-unreadable'), /Deals by type and state could not be read on this database\. That is not the same as none\.\s*Try again/);
    assert.ok(one.has('partners-c1-chart') && one.has('partners-c2-chart') && one.has('partners-c4-chart'), 'the other charts still draw');
    assert.ok(!one.has('partners-c3-table-toggle'), 'no table toggle beside a failed block');
    assert.ok(one.has('partners-needs-failed-due_diligence_open'));
  } finally { await one.close(); }
  const slow = await mounted('/admin/partner-invitations', worker({ ov: () => new Promise(() => {}) }));
  try {
    assert.equal(slow.textOf('partners-c1-loading'), 'Reading…');
    assert.match(slow.textOf('partners-needs'), /Reading…/);
  } finally { await slow.close(); }
  const first = await mounted('/admin/partner-invitations', worker({ invitations: [] }));
  try {
    assert.ok(first.has('partners-first-use'));
    assert.ok(!first.has('partners-charts'), 'first use draws no empty chart');
  } finally { await first.close(); }
  const banner = await mounted('/admin/partner-invitations', worker({ ov: overview({ kinds: { agreement_blocked: { available: true, agreement: { state: 'not_ready', why: 'template_has_no_body' }, rows: [] } } }, LIVE) }));
  try {
    assert.ok(banner.has('partners-agreement-banner') && banner.has('partners-charts'), 'the banner sits above a drawn Overview');
  } finally { await banner.close(); }
});
