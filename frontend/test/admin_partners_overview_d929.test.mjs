/**
 * D929 (#2725) — Partner invitations part 6: the Overview complete on D923's
 * reads. What this file holds the Overview to:
 *   · C1–C4 each draw D893's four states — Reading…, could not be read (with
 *     Try again), Not recorded, or the chart — and a zero only when read;
 *   · C1 counts open invitations by stage with "oldest [n] days" from the
 *     first send, Lapsed under Closed with Signed and Revoked; C2 buckets
 *     sends and signatures into twelve Monday weeks (UTC); C3 counts deals by
 *     type and state group; C4 counts the fan-out's redemptions by
 *     attribution, under Guard F;
 *   · each chart's "View as table" holds the same figures;
 *   · a C1 bar opens Invitations at that stage and a C3 segment Deals of that
 *     type and state, and the list they open counts what the chart counted;
 *   · the "Sends that failed" tile, Needs you as cards on a phone, one chart
 *     per card, the charts' move to `ui/`, and PI9's states mounted.
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
  C3_STATES, DEAL_STATE_KEYS, WITHIN_DEALS, WITHIN_INVITATIONS, dealFiltersFromSearch, dealRow, dealTiles, dealsByTypeState,
  dealsOfTypeState, dealsUnion, filterDeals, filterInvitations, invitationRow, invitationsAtStage, stageChart, stagesFromSearch,
  weekLabel, weekStart, weekStarts, weeklyInvitations, weeklyRedemptions,
} from '../src/pages/admin/partners/partnersDeskModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 86_400_000;
const d1 = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const isoAt = (ms) => new Date(ms).toISOString();

// GET /api/admin/partners/invitations — one row, never resent.
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
  id, invitation_id: null, user_id: 500 + id, deal_type: 'services_partnership', granted_tier_founder: 'founder_pro', granted_tier_investor: null,
  term_months: 12, referral_code: `PART-${id}`, envelope_id: 900 + id, status: 'active', activated_at: '2026-07-04 10:00:00',
  expires_at: '2027-06-29T10:00:00.000Z', terminated_at: null, created_at: '2026-06-30 09:00:00', partner_email: `d${id}@example.com`,
  partner_name: `Dana ${id}`, redemptions_count: 0, ...o,
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
const fanOf = (items, o = {}) => ({ state: 'ready', items, m: 1, complete: true, short: [], firstOnly: [], exact: true, ...o });
const table = (block) => renderToStaticMarkup(h(ChartTable, { chart: block.chart, caption: block.alt }));
const cells = (html) => [...html.matchAll(/<t[dh][^>]*>([^<]*)<\/t[dh]>/g)].map((m) => m[1]);

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

const c1Rows = () => [
  inv(1, { createdMs: NOW - 12 * DAY }), inv(2, { createdMs: NOW - 3 * DAY }),
  inv(3, { status: 'viewed', createdMs: NOW - 9 * DAY }),
  inv(4, { status: 'selected', createdMs: NOW - 10 * DAY }),
  inv(5, { status: 'finalized', envelope_id: 77, createdMs: NOW - 3 * DAY }),
  inv(6, { status: 'selected', createdMs: NOW - 30 * DAY, is_expired: true }), // lapsed at Offer chosen
  inv(7, { status: 'signed', signed_at: d1(NOW - DAY), createdMs: NOW - 20 * DAY }),
  inv(8, { status: 'revoked', createdMs: NOW - 8 * DAY }),
  inv(9, { status: 'expired', createdMs: NOW - 40 * DAY }),
];

test('C1: its four states, and a zero only when the invitations were read', () => {
  assert.equal(stageChart(loading(), { now: NOW }).state, 'loading');
  const down = stageChart(failed(), { now: NOW });
  assert.deepEqual([down.state, down.reason], ['unreadable', 'The invitations could not be read. A failed list is not a claim that there are none.']);
  assert.ok(!('chart' in down), 'no bars beside a failed read');
  const blank = stageChart(ready([inv(1, { status: null })]), { now: NOW });
  assert.deepEqual([blank.state, blank.reason], ['unrecorded', 'No invitation read here carries its stage.']);
  const none = stageChart(ready([]), { now: NOW });
  assert.equal(none.state, 'ready');
  assert.deepEqual(none.chart.rows.map((r) => r.text), ['0', '0', '0', '0', '0', '0'], 'a read with none is a real zero');
  assert.deepEqual(none.closed.map((c) => c.n), [0, 0, 0]);
});

test('C1: open invitations per stage with "oldest [n] days" from the first send; Lapsed sits under Closed with Signed and Revoked', () => {
  const b = stageChart(ready(c1Rows()), { proposed: ready([]), now: NOW });
  assert.deepEqual(b.chart.rows.map((r) => [r.label, r.value, r.text]), [
    ['Sent', 2, '2 · oldest 12 days'], ['Opened', 1, '1 · oldest 9 days'], ['Profile done', 0, '0'], ['Offers shown', 0, '0'],
    ['Offer chosen', 1, '1 · oldest 10 days'], ['Agreement out', 1, '1 · oldest 3 days'],
  ]);
  assert.deepEqual(b.closed.map((c) => [c.word, c.n]), [['Signed', 1], ['Lapsed', 1], ['Revoked', 1]]);
  assert.equal(b.alt, '5 open invitations by stage now: sent 2, opened 1, profile done 0, offers shown 0, offer chosen 1, agreement out 1.');
  assert.deepEqual(b.lines, ['1 invitation was signed after the link lapsed, and the deal voided.']);
  assert.match(b.foot, /A lapsed invitation keeps the stage it reached, and a revoked one does not\./);
  assert.match(b.foot, /Days count from the first send: time in a stage is not recorded yet\./);
  assert.doesNotMatch(b.foot, /How far a lapsed or revoked one got is not recorded/, 'the canvas\'s caption is reworded');
});

test('C1: Guard I lifts a resent row from its deal, Guard L says what a capped list covers', () => {
  // Resent: created 20 days ago, its link renewed 2 days ago; R2 holds its deal, so it is at Offer chosen.
  const resent = inv(1, { createdMs: NOW - 20 * DAY, expires_at: isoAt(NOW - 2 * DAY + 14 * DAY) });
  const b = stageChart(ready([resent]), { proposed: ready([deal(5, { status: 'proposed', invitation_id: 1 })]), now: NOW });
  assert.equal(b.chart.rows.find((r) => r.label === 'Offer chosen').value, 1);
  const lag = stageChart(ready([resent]), { proposed: failed(), now: NOW });
  assert.deepEqual(lag.lines, ['1 resent invitation may sit at an earlier stage than it reached.']);
  const capped = stageChart(ready(many(200, (i) => inv(i))), { proposed: ready([]), now: NOW });
  assert.deepEqual(capped.lines, [`${WITHIN_INVITATIONS}.`]);
});

test('C1: a bar opens Invitations at that stage, and that list counts what the bar counted', () => {
  const rows = c1Rows();
  const b = stageChart(ready(rows), { proposed: ready([]), now: NOW });
  const all = rows.map((i) => ({ inv: i, row: invitationRow(i, { proposed: ready([]), now: NOW }) }));
  for (const bar of b.chart.rows) {
    const href = invitationsAtStage(bar.group);
    assert.ok(href.startsWith('/admin/partner-invitations/invitations?stage='));
    const stages = stagesFromSearch(href.split('?')[1]);
    assert.deepEqual(stages, [bar.group]);
    assert.equal(filterInvitations(all, { stages, now: NOW }).length, bar.value, `${bar.label}: the bar and its list agree`);
  }
  for (const c of b.closed) assert.equal(filterInvitations(all, { stages: stagesFromSearch(invitationsAtStage(c.key).split('?')[1]), now: NOW }).length, c.n, c.word);
  assert.deepEqual(stagesFromSearch('?stage=viewed,nope,viewed'), ['viewed'], 'only known stages, once');
  assert.deepEqual(stagesFromSearch(''), []);
});

/* ------------------------------------------------------------------ *
 * C2 — Invitations per week
 * ------------------------------------------------------------------ */

test('C2: its four states; sends and signatures by week, the current week hatched, a true 0 below the cap', () => {
  assert.equal(weeklyInvitations(loading(), { now: NOW }).state, 'loading');
  assert.equal(weeklyInvitations(failed(), { now: NOW }).state, 'unreadable');
  assert.equal(weeklyInvitations(ready([inv(1, { created_at: null })]), { now: NOW }).state, 'unrecorded');
  const b = weeklyInvitations(ready([
    inv(1, { createdMs: NOW - DAY }), // this week (Mon 19 Oct)
    inv(2, { createdMs: NOW - 8 * DAY, status: 'signed', signed_at: d1(NOW - 2 * DAY) }), // sent 16 Oct, signed this week
    inv(3, { createdMs: NOW - 9 * DAY }), // 15 Oct
    inv(4, { createdMs: NOW - 200 * DAY }), // before the window
    inv(5, { createdMs: NOW - 3 * DAY, status: 'revoked', signed_at: d1(NOW - DAY) }), // not signed
    inv(6, { createdMs: NOW + 3 * DAY }), // a stamp after now is no week's
  ]), { now: NOW });
  assert.equal(b.state, 'ready');
  assert.deepEqual(b.chart.series.map((s) => [s.label, s.tone]), [['Sent', 'violet'], ['Signed', 'sky']]);
  assert.deepEqual(b.chart.rows.map((r) => r.values), [...many(10, () => [0, 0]), [2, 0], [2, 1]]);
  assert.deepEqual(b.chart.rows.map((r) => r.toDate), [...many(11, () => false), true]);
  assert.equal(b.alt, 'Invitations per week for twelve weeks: 4 sent and 1 signed. The current week is not finished.');
  assert.deepEqual(b.lines, []);
  assert.equal(b.foot, 'Hatched columns are the current week, so far. Weeks start on Monday, UTC.');
  const capped = weeklyInvitations(ready(many(200, (i) => inv(i, { createdMs: NOW - i * 60_000 }))), { now: NOW });
  assert.match(capped.lines[0], new RegExp(`^${WITHIN_INVITATIONS}: weeks before \\d+ Oct 2026 are not complete`));
});

/* ------------------------------------------------------------------ *
 * C3 — Deals by type and state
 * ------------------------------------------------------------------ */

const c3Deals = () => lists({
  active: ready([deal(1), deal(2), deal(3, { deal_type: 'deal_sourcing_revshare' }), deal(4, { expires_at: isoAt(NOW - DAY) })]),
  awaiting_signature: ready([deal(5, { status: 'awaiting_signature', invitation_id: 31, user_id: null })]),
  proposed: ready([deal(6, { status: 'proposed', deal_type: 'equity_partnership', invitation_id: 32, user_id: null })]),
  expired: ready([deal(7, { status: 'expired' })]),
  terminated: ready([deal(8, { status: 'terminated', deal_type: 'custom' })]),
  voided: ready([deal(9, { status: 'voided' })]),
});

test('C3: its four states; a failed list is named and never draws a smaller bar', () => {
  assert.equal(dealsByTypeState({ deals: lists({ voided: loading() }), invitations: ready([]), now: NOW }).state, 'loading');
  const down = dealsByTypeState({ deals: lists({ terminated: failed() }), invitations: ready([]), now: NOW });
  assert.deepEqual([down.state, down.reason], ['unreadable', 'The deal lists (terminated) could not be read. A failed list is not a claim that there are none.']);
  assert.equal(dealsByTypeState({ deals: lists({ active: ready([deal(1, { deal_type: null })]) }), invitations: ready([]), now: NOW }).state, 'unrecorded');
  const none = dealsByTypeState({ deals: lists(), invitations: ready([]), now: NOW });
  assert.equal(none.state, 'ready');
  assert.deepEqual(none.chart.rows.map((r) => [r.word, r.total]), [
    ['Services partnership', '0'], ['Deal-sourcing revenue share', '0'], ['Equity partnership', '0'], ['Capital partnership', '0'], ['Custom', '0'],
  ], 'every type in the canvas\'s order, a real zero');
});

test('C3: deals per type and state group; Ended is term over, terminated and voided; the lapsed join and the past-end deal are said', () => {
  const invitations = ready([inv(31, { is_expired: true }), inv(32)]);
  const b = dealsByTypeState({ deals: c3Deals(), invitations, now: NOW });
  const by = Object.fromEntries(b.chart.rows.map((r) => [r.key, Object.fromEntries(r.parts.map((p) => [p.key, p.value]))]));
  assert.deepEqual(by.services_partnership, { active: 3, awaiting: 1, proposed: 0, ended: 2 });
  assert.deepEqual(by.deal_sourcing_revshare, { active: 1, awaiting: 0, proposed: 0, ended: 0 });
  assert.deepEqual(by.equity_partnership, { active: 0, awaiting: 0, proposed: 1, ended: 0 });
  assert.deepEqual(by.custom, { active: 0, awaiting: 0, proposed: 0, ended: 1 });
  assert.deepEqual(b.legend.map((l) => [l.label, l.tone]), [['Active 4', 'violet'], ['Awaiting signature 1', 'sky'], ['Offer chosen, not sent 1', 'amber'], ['Ended 3', 'muted']]);
  assert.deepEqual(b.lines, ['1 deal before signing belongs to an invitation whose link has lapsed.', '1 active deal is past its end, not yet closed, and counts as Active.']);
  const blind = dealsByTypeState({ deals: c3Deals(), invitations: failed(), now: NOW });
  assert.equal(blind.lines[0], 'Lapsed invitations could not be checked, so deals before signing are drawn without that check.');
  const capped = dealsByTypeState({ deals: lists({ active: ready(many(200, (i) => deal(i))) }), invitations: ready([]), now: NOW });
  assert.deepEqual(capped.lines, [`${WITHIN_DEALS}.`]);
  const odd = dealsByTypeState({ deals: lists({ active: ready([deal(1, { deal_type: 'mystery' })]) }), invitations: ready([]), now: NOW });
  const other = odd.chart.rows.find((r) => r.key === 'other');
  assert.equal(other.label, 'Another deal type · 1');
  assert.ok(other.parts.every((p) => p.to === null), 'a type the Deals filter cannot name opens nothing');
});

test('C3: a segment opens Deals of that type and state, and that list counts what the segment counted', () => {
  const invitations = ready([inv(31), inv(32)]);
  const deals = c3Deals();
  const b = dealsByTypeState({ deals, invitations, now: NOW });
  const all = dealsUnion(deals).rows.map((d) => ({ deal: d, row: dealRow(d, { invitations, cases: ready([]), now: NOW }) }));
  for (const row of b.chart.rows) {
    for (const part of row.parts) {
      const group = C3_STATES.find((g) => g.key === part.key);
      assert.equal(part.to, dealsOfTypeState(row.key, group.states));
      const f = dealFiltersFromSearch(part.to.split('?')[1]);
      assert.deepEqual(f, { type: row.key, states: group.states });
      assert.equal(filterDeals(all, { ...f, now: NOW }).length, part.value, `${row.key} · ${part.key}`);
    }
  }
  assert.equal(dealsOfTypeState('custom', ['expired', 'terminated', 'voided']), '/admin/partner-invitations/deals?type=custom&state=expired,terminated,voided');
  assert.deepEqual(dealFiltersFromSearch('?type=nope&state=bogus'), { type: '', states: null }, 'unknown words keep the tab\'s defaults');
});

/* ------------------------------------------------------------------ *
 * C4 — Referral redemptions per week
 * ------------------------------------------------------------------ */

test('C4: its four states under Guard F; referral solid, rev-share dashed, the current week only a hollow point', () => {
  assert.equal(weeklyRedemptions({ state: 'loading' }, { now: NOW }).state, 'loading');
  const down = weeklyRedemptions({ state: 'unreadable', text: 'Could not be read for 1 of 3 deals', claim: '1 of 3 deals did not answer, so no partial sum is drawn.' }, { now: NOW });
  assert.deepEqual([down.state, down.reason], ['unreadable', 'Could not be read for 1 of 3 deals. 1 of 3 deals did not answer, so no partial sum is drawn.']);
  assert.equal(weeklyRedemptions(fanOf([{ ...redemption(1, NOW), redeemed_at: null }]), { now: NOW }).state, 'unrecorded');
  const none = weeklyRedemptions(fanOf([]), { now: NOW });
  assert.deepEqual(none.chart.series.map((s) => s.values), [many(12, () => 0), many(12, () => 0)], 'nothing to cover is a real zero');
  const b = weeklyRedemptions(fanOf([
    redemption(1, NOW - DAY), redemption(2, NOW - 2 * DAY, { attribution_kind: 'deal_sourcing_revshare' }),
    redemption(3, NOW - 8 * DAY), redemption(4, NOW - 300 * DAY), redemption(5, NOW - DAY, { attribution_kind: null }),
  ]), { now: NOW });
  assert.deepEqual(b.chart.series.map((s) => [s.label, s.tone, s.dash]), [['Referral', 'violet', false], ['Deal-sourcing rev-share', 'sky', true]]);
  assert.deepEqual(b.chart.series[0].values, [...many(10, () => 0), 1, 1]);
  assert.deepEqual(b.chart.series[1].values, [...many(11, () => 0), 1]);
  assert.equal(b.alt, 'Members who registered with a partner code per week: 2 through referral and 1 through deal-sourcing rev-share in twelve weeks.');
  assert.deepEqual(b.lines, ['1 redemption in these weeks has no recorded attribution and is not drawn.']);
  assert.equal(b.foot, 'The hollow point is the current week, so far. Weeks start on Monday, UTC.');
  const partial = weeklyRedemptions(fanOf([], { complete: false, exact: false }), { now: NOW });
  assert.deepEqual(partial.lines, [`${WITHIN_DEALS}.`]);
});

/* ------------------------------------------------------------------ *
 * View as table, the legend, the tiles
 * ------------------------------------------------------------------ */

test('each chart\'s "View as table" holds the figures the chart draws', () => {
  const c1 = stageChart(ready(c1Rows()), { proposed: ready([]), now: NOW });
  assert.deepEqual(cells(table(c1)), ['Item', 'Value', 'Sent', '2 · oldest 12 days', 'Opened', '1 · oldest 9 days', 'Profile done', '0', 'Offers shown', '0', 'Offer chosen', '1 · oldest 10 days', 'Agreement out', '1 · oldest 3 days']);
  const c2 = weeklyInvitations(ready([inv(1, { createdMs: NOW - DAY })]), { now: NOW });
  const t2 = cells(table(c2));
  assert.deepEqual(t2.slice(0, 3), ['Week', 'Sent', 'Signed']);
  assert.deepEqual(t2.slice(-3), ['19 Oct (so far)', '1', '0']);
  const c3 = dealsByTypeState({ deals: c3Deals(), invitations: ready([]), now: NOW });
  const t3 = cells(table(c3));
  assert.deepEqual(t3.slice(0, 6), ['Type', 'Active', 'Awaiting signature', 'Offer chosen, not sent', 'Ended', 'Total']);
  assert.deepEqual(t3.slice(6, 12), ['Services partnership · 6', '3', '1', '0', '2', '6']);
  const c4 = weeklyRedemptions(fanOf([redemption(1, NOW - DAY), redemption(2, NOW - DAY, { attribution_kind: 'deal_sourcing_revshare' })]), { now: NOW });
  const t4 = cells(table(c4));
  assert.deepEqual(t4.slice(0, 3), ['Week', 'Referral', 'Deal-sourcing rev-share']);
  assert.deepEqual(t4.slice(-3), ['19 Oct (so far)', '1', '1']);
});

test('no colour carries meaning alone: every series is named in a legend or a label, and C4\'s series differ by dash too', () => {
  const html = renderToStaticMarkup(h(Legend, { items: weeklyRedemptions(fanOf([]), { now: NOW }).legend }));
  assert.match(html, /border-dashed[^"]*border-\[#0ea5e9\][^>]*><\/span>Deal-sourcing rev-share · dashed/);
  assert.match(html, /border-solid[^"]*border-axal-violet[^>]*><\/span>Referral · solid/);
  for (const b of [weeklyInvitations(ready([]), { now: NOW }), dealsByTypeState({ deals: lists(), invitations: ready([]), now: NOW })]) {
    assert.ok(b.legend.every((l) => l.label), `${b.key}: every swatch has its words`);
  }
  assert.ok(stageChart(ready([]), { now: NOW }).chart.rows.every((r) => r.label && r.aria), 'C1 bars are labelled, and each button names what it opens');
});

test('the tile row says "Sends that failed", in part 1\'s words, until part 4 reads it', () => {
  const t = dealTiles({ deals: lists(), invitations: ready([]), fan: fanOf([]), now: NOW });
  const sends = t.find((x) => x.key === 'sends');
  assert.deepEqual([sends.label, sends.state, sends.note.text], ['Sends that failed', 'note', 'Not read here yet']);
  assert.match(sends.note.reason, /Sent or Not sent/);
  assert.ok(!t.some((x) => /not delivered/i.test(x.label)), 'never "not delivered"');
  assert.doesNotMatch(read('frontend/src/pages/admin/partners/PartnersOverview.jsx'), /Undelivered|Emails not delivered/);
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

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const LIVE = Date.now();

function worker({ invitations = [], deals = {}, redemptions = {}, template = { doc_type: 'partner_services', fields: [] } } = {}) {
  const call = (v, ...a) => (typeof v === 'function' ? v(...a) : response(v));
  return (url) => {
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    // D950: the tab reads D926's page, so the stub filters by stage (Lapsed computed) and pages, with a total.
    if (path === '/api/admin/partners/invitations') {
      if (typeof invitations === 'function') return call(invitations);
      const stages = q.getAll('stage');
      const rows = stages.length ? invitations.filter((i) => stages.includes(i.is_expired && !['signed', 'revoked', 'expired'].includes(i.status) ? 'lapsed' : i.status)) : invitations;
      const offset = Number(q.get('offset') || 0);
      return response({ items: rows.slice(offset, offset + (q.get('limit') ? Number(q.get('limit')) : 200)), total: rows.length });
    }
    if (path === '/api/admin/partners/deals/top') return response({ items: [] });
    if (path === '/api/admin/partners/deals') return call(deals[q.get('status')] ?? { items: [] });
    const red = /^\/api\/admin\/partners\/deals\/(\d+)\/redemptions$/.exec(path);
    if (red) return call(redemptions[red[1]] ?? { deal: { id: Number(red[1]) }, items: [] });
    if (path === '/api/admin/contracts/partner-deals') {
      const all = Object.values(deals).map((v) => v?.items).filter(Array.isArray).flat();
      return response({ items: all.map((d) => ({ id: d.id, status: d.status, deal_type: d.deal_type, redemption_count: d.redemptions_count })), total: all.length, limit: 500, offset: 0 });
    }
    if (path === '/api/admin/partners/links') return response({ accounts: [], firms: [], attached: 0, unattached: 0 });
    if (path === '/api/legal/esign/templates/partner_services') return call(template);
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

const liveRows = () => [
  inv(1, { createdMs: LIVE - 3 * DAY }, LIVE), inv(2, { status: 'viewed', createdMs: LIVE - 2 * DAY }, LIVE),
  inv(3, { status: 'signed', signed_at: d1(LIVE - DAY), createdMs: LIVE - 9 * DAY }, LIVE),
];
const liveDeals = () => ({
  active: { items: [deal(11, { redemptions_count: 1, expires_at: isoAt(LIVE + 200 * DAY) }), deal(12, { deal_type: 'custom', expires_at: isoAt(LIVE + 200 * DAY) })] },
  proposed: { items: [deal(13, { status: 'proposed', invitation_id: 99, user_id: null })] },
});

test('mounted: C1–C4 draw from the reads, and "View as table" swaps the chart for its table', async () => {
  const view = await mounted('/admin/partner-invitations', worker({ invitations: liveRows(), deals: liveDeals(), redemptions: { 11: { deal: { id: 11, status: 'active' }, items: [redemption(1, LIVE - DAY)] } } }));
  try {
    for (const k of ['c1', 'c2', 'c3', 'c4']) assert.ok(view.has(`partners-${k}-chart`), `${k} draws`);
    assert.match(view.props('partners-c1-chart')['aria-label'], /^2 open invitations by stage now: sent 1, opened 1,/);
    assert.match(view.props('partners-c4-chart')['aria-label'], /: 1 through referral and 0 through deal-sourcing rev-share/);
    assert.equal(view.textOf('partners-c1-closed'), 'Closed: Signed 1 · Lapsed 0 · Revoked 0');
    await view.click('partners-c2-table-toggle');
    assert.ok(view.has('partners-c2-table') && !view.has('partners-c2-chart'));
    assert.equal(view.props('partners-c2-table-toggle')['aria-pressed'], true);
    assert.match(view.textOf('partners-c2-table'), /WeekSentSigned/);
  } finally { await view.close(); }
});

test('mounted: a C1 bar opens Invitations at that stage with its chip on; a closed count does too', async () => {
  const view = await mounted('/admin/partner-invitations', worker({ invitations: liveRows(), deals: liveDeals() }));
  try {
    await view.click('partners-c1-viewed');
    assert.equal(view.at.path, '/admin/partner-invitations/invitations?stage=viewed');
    assert.equal(view.props('partners-inv-chip-viewed')['aria-pressed'], true, 'the chip the bar named is on');
    assert.ok(view.has('partners-inv-row-2') && !view.has('partners-inv-row-1'), 'and the list holds what the bar counted');
  } finally { await view.close(); }
  const closed = await mounted('/admin/partner-invitations', worker({ invitations: liveRows(), deals: liveDeals() }));
  try {
    assert.equal(closed.props('partners-c1-closed-signed').href, '/admin/partner-invitations/invitations?stage=signed');
  } finally { await closed.close(); }
});

test('mounted: a C3 segment opens Deals of that type and state, by click or by key', async () => {
  const view = await mounted('/admin/partner-invitations', worker({ invitations: liveRows(), deals: liveDeals() }));
  try {
    await view.key('partners-c3-services_partnership-proposed', 'Enter');
    assert.equal(view.at.path, '/admin/partner-invitations/deals?type=services_partnership&state=proposed');
    assert.equal(view.props('partners-deals-chip-proposed')['aria-pressed'], true);
    assert.equal(view.props('partners-deals-chip-active')['aria-pressed'], false, 'the default Active chip gives way to the link');
  } finally { await view.close(); }
});

test('mounted PI9: one block unreadable while the rest draw; loading says Reading…; first use draws no chart', async () => {
  const down = await mounted('/admin/partner-invitations', worker({ invitations: () => response({ error: 'down' }, 503), deals: liveDeals() }));
  try {
    assert.ok(down.has('partners-c1-unreadable') && down.has('partners-c2-unreadable'), 'the charts on the failed read say so');
    assert.match(down.textOf('partners-c1-unreadable'), /could not be read\. The invitations could not be read\. A failed list is not a claim that there are none\.\s*Try again/);
    assert.ok(down.has('partners-c3-chart') && down.has('partners-c4-chart'), 'the charts on other reads still draw');
    assert.ok(!down.has('partners-c1-table-toggle'), 'no table toggle beside a failed read');
  } finally { await down.close(); }
  const slow = await mounted('/admin/partner-invitations', worker({ invitations: () => new Promise(() => {}), deals: liveDeals() }));
  try {
    assert.ok(slow.has('partners-c1-loading') && slow.has('partners-c2-loading'));
    assert.equal(slow.textOf('partners-c1-loading'), 'Reading…');
  } finally { await slow.close(); }
  const first = await mounted('/admin/partner-invitations', worker({ invitations: [] }));
  try {
    assert.ok(first.has('partners-first-use'));
    assert.ok(!first.has('partners-charts'), 'first use draws no empty chart');
  } finally { await first.close(); }
  const banner = await mounted('/admin/partner-invitations', worker({ invitations: liveRows(), deals: liveDeals(), template: () => response({ error: 'template_has_no_body', code: 'template_has_no_body' }, 409) }));
  try {
    assert.ok(banner.has('partners-agreement-banner') && banner.has('partners-charts'), 'the banner sits above a drawn Overview');
  } finally { await banner.close(); }
});
