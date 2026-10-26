/**
 * D1038 (#2390) — Admin › Approvals at /admin/approvals: the addresses, the
 * twenty lanes from the Studio glance (a failed lane never 0, an uncounted
 * lane never 0), the Inbox oldest first, HQ decides for a Super Admin only,
 * and the three lane boards on the reads that exist.
 *
 * D1045 (#2893), part 7: the Inbox on HQ's inbox read (items, tiles, the two
 * charts with their sentences, filters in the address, the ⋯ menu, the bulk
 * bar, the pager), the item at its own address with Assign and History,
 * Notifies and HQ's counts on Lanes, the Decided log, and the states.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_d1038.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import {
  HQ_LANES, LANES, MOVED_KEY, ageText, bandOf, boardOf, expertBoard, expertState, laneViews,
  oldestLine, pitchRows, tabOf, attributionTotals,
} from '../src/pages/admin/approvals/approvalsModel.js';
import {
  assigneeOf, assignChoices, assignTitle, decidedNotes, decidedPageLine, decidedQueryOf, decidedRows, errorRef, hasNextPage,
  hqBandLine, hqLaneViews, inboxGroupCounts, inboxQueryOf, inboxRows, inboxTiles, itemOfPath, itemPath, itemView, laneAgeChart,
  notifiesOf, pageLine, refusalToast, waitingOnHq, weekChart, historyLines,
} from '../src/pages/admin/approvals/inboxModel.js';
import { glancesFromStudioGlance } from '../src/pages/admin/adminStudioOverview.js';
import AdminApprovals, { ApprovalsPage } from '../src/pages/admin/approvals/AdminApprovals.jsx';
import LaneBoards from '../src/pages/admin/approvals/LaneBoards.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// The glance as the Worker answers on HQ: worst first, one lane failed (lp), one empty (events).
const GLANCE = {
  tier: 'hq',
  approvals: {
    pending_total: null,
    lanes: [
      { key: 'due_diligence', label: 'Due diligence', count: 6, oldest_age_hours: 146, sla: 'past' },
      { key: 'kyc', label: 'KYC', count: 10, oldest_age_hours: 103, sla: 'past' },
      { key: 'exploring', label: 'Exploring', count: 60, oldest_age_hours: 2, sla: 'ok' },
      { key: 'partner_profiles', label: 'Partner profiles', count: 4, oldest_age_hours: 30, sla: 'due_soon' },
      { key: 'events', label: 'Events', count: 0, oldest_age_hours: null, sla: 'ok' },
      { key: 'jobs', label: 'Jobs', count: 3, oldest_age_hours: null, sla: 'unknown' },
      { key: 'lp', label: 'LP applications', count: null, oldest_age_hours: null, sla: 'unknown' },
      { key: 'referrals', label: 'Referrals', count: 0, oldest_age_hours: null, sla: 'ok' },
      { key: 'cohort', label: 'Cohort applications', count: 7, oldest_age_hours: 50, sla: 'due_soon' },
      { key: 'moderation', label: 'Spinout moderation', count: 1, oldest_age_hours: 9, sla: 'ok' },
      { key: 'best_fit', label: 'Best-Fit consultations', count: 1, oldest_age_hours: 20, sla: 'ok' },
      // D1041 (#2889): part 3's eight lanes, measured empty here so the sums above hold.
      // D1132 (#3012): and Product testers, counted once part 4's store landed.
      ...['kyb', 'comarketing', 'wellbeing_experts', 'perk_listings', 'strategic_access', 'lab_hosts', 'score_flags', 'articles', 'product_testers']
        .map((key) => ({ key, label: key, count: 0, oldest_age_hours: null, sla: 'ok' })),
    ],
    no_queue: [],
  },
};
const ALL_READ = { ...GLANCE, approvals: { ...GLANCE.approvals, lanes: GLANCE.approvals.lanes.map((l) => (l.key === 'lp' ? { ...l, count: 3, oldest_age_hours: 12 } : l)) } };
const ready = (payload) => ({ status: 'ready', hq: glancesFromStudioGlance(payload, null).hq });

// D1045: HQ's inbox read (D1040, D1132) as the Worker answers it: three items,
// one assigned, one nobody's, one whose assignment was not read; LP failed.
const INBOX = {
  items: [
    { lane: 'kyc', lane_label: 'KYC', id: 41, who: 'Person A', what: 'Identity check', created_at: '2026-10-20 08:00:00', age_hours: 103, sla: 'past', assignee: { user_id: 7, name: 'Admin A' } },
    { lane: 'due_diligence', lane_label: 'Due diligence', id: 9, who: 'Company B', what: 'Seed round', created_at: '2026-10-24 12:00:00', age_hours: 30, sla: 'due_soon', assignee: null },
    { lane: 'jobs', lane_label: 'Jobs', id: 3, who: 'Company C', what: 'Engineer', created_at: null, age_hours: null, sla: 'unknown' },
  ],
  total: 123,
  unfiltered_total: 123,
  page: 1,
  page_size: 25,
  lanes: [
    { key: 'kyc', label: 'KYC', group: 'people', count: 10, bands: { ok: 2, due_soon: 3, past: 5, unknown: 0 } },
    { key: 'due_diligence', label: 'Due diligence', group: 'deals', count: 6, bands: { ok: 0, due_soon: 6, past: 0, unknown: 0 } },
    { key: 'jobs', label: 'Jobs', group: 'community', count: 3, bands: { ok: 0, due_soon: 0, past: 0, unknown: 3 } },
    { key: 'exploring', label: 'Exploring', group: 'programs', count: 104, bands: { ok: 100, due_soon: 4, past: 0, unknown: 0 } },
    { key: 'lp', label: 'LP applications', group: 'deals', count: null, bands: null, bands_reason: 'LP applications could not be read.' },
  ],
  unreadable: ['LP applications'],
  reason: 'LP applications could not be read.',
  capped: false,
  tiles: { over_72h: 5, assigned_to_me: 2, per_admin: [{ id: 7, name: 'Admin A', count: 14 }, { id: 8, name: 'Admin B', count: 3 }] },
  reviewers: [{ id: 7, name: 'Admin A' }, { id: 8, name: 'Admin B' }],
  decides: false,
};
const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const WEEKLY = {
  weeks: WEEKS.map((w) => ({ week_start: w })),
  totals: { arrived: [10, 12, 9, 14, 11, 13, 15, 6], decided: [8, 11, 10, 12, 9, 14, 12, 4], arrived_leaves_out: [], decided_leaves_out: ['Wellbeing experts', 'Exploring'] },
  tile: { decided_this_week: 12, median_wait_hours: 33 },
  unreadable: [],
};
const REQUESTS = { items: [
  { uid: 'r1', kind: 'renewal', subject: 'Renewal', status: 'open', sla: 'ok', created_at: '2026-10-20 10:00:00' },
  { uid: 'r2', kind: 'seat_increase', subject: 'Seats', status: 'answered', created_at: '2026-10-01 10:00:00' },
] };
const ITEM = {
  item: INBOX.items[0],
  lane: { key: 'kyc', label: 'KYC', group: 'people', notifies: 'The member, by email', decided_on: '/admin/kyc', hq: false },
  history: { available: true, items: [{ kind: 'assigned', created_at: '2026-10-21 09:00:00', actor_user_id: 8, actor_name: 'Admin B', assignee_user_id: 7, assignee_name: 'Admin A' }] },
  decides: false,
};
const DECIDED = {
  items: [{ lane: 'kyc', lane_label: 'KYC', item_id: 40, who: 'Person D', outcome: 'approved', outcome_word: 'Approved', decided_at: '2026-10-25 14:00:00', decided_by: { id: 7, name: 'Admin A' }, wait_hours: 33, note: 'Welcome aboard', note_shown: true }],
  total: 357,
  page: 1,
  page_size: 25,
  lanes: [
    { key: 'kyc', label: 'KYC', recorded: true, since: null, count: 300 },
    { key: 'wellbeing_experts', label: 'Wellbeing experts', recorded: true, since: '2026-10-21', count: 2 },
    { key: 'exploring', label: 'Exploring', recorded: false, reason: 'Explorers do not record who decided.' },
  ],
  unreadable: [],
};

// ---------------------------------------------------------------- the model

test('the addresses, the tabs, the boards, and the redirect\'s key', () => {
  assert.equal(tabOf('/admin/approvals'), 'inbox');
  assert.equal(tabOf('/admin/approvals/lanes/'), 'lanes');
  assert.equal(tabOf('/admin/approvals/decided'), 'decided');
  assert.deepEqual(boardOf('/admin/approvals/co-marketing/declined'), { board: 'co-marketing', tab: 'rejected' });
  assert.deepEqual(boardOf('/admin/approvals/wellbeing-experts'), { board: 'wellbeing-experts', tab: 'verify' });
  assert.deepEqual(boardOf('/admin/approvals/product-testers'), { board: 'product-testers', tab: 'waiting' });
  assert.equal(boardOf('/admin/approvals/lanes'), null);
  assert.equal(MOVED_KEY, 'held-approvals');
  assert.equal(tabOf('/admin/approvals/items/kyc-41'), 'inbox', 'an item opens over the Inbox');
  assert.equal(itemPath('kyc', 41), '/admin/approvals/items/kyc-41');
  assert.deepEqual(itemOfPath('/admin/approvals/items/partner_profiles-7'), { lane: 'partner_profiles', id: 7 });
  for (const bad of ['/admin/approvals/items/kyc-0', '/admin/approvals/items/kyc', '/admin/approvals/items/kyc-4x', '/admin/approvals/lanes']) {
    assert.equal(itemOfPath(bad), null, bad);
  }
});

test('the twenty lanes in four groups; nine new; all twenty the glance counts (D1041, D1132); HQ\'s nine', () => {
  assert.equal(LANES.length, 20);
  assert.deepEqual([...new Set(LANES.map((l) => l.group))], ['people', 'programs', 'community', 'deals']);
  assert.equal(LANES.filter((l) => l.isNew).length, 9);
  assert.equal(LANES.filter((l) => l.glance).length, 20, 'D1132: every lane is counted');
  assert.deepEqual(LANES.filter((l) => !l.glance).map((l) => l.key), [], 'D1132: Product testers is counted now that its store exists');
  assert.deepEqual(LANES.filter((l) => l.here).map((l) => l.key), ['product_testers', 'wellbeing_experts', 'comarketing']);
  assert.equal(HQ_LANES.length, 9);
});

test('ages and bands: "6 d 2 h", none under 24 hours, amber to 72, red from 72; unknown is null', () => {
  assert.equal(ageText(146), '6 d 2 h');
  assert.equal(ageText(9), '9 h');
  assert.equal(ageText(0.5), '30 min');
  assert.equal(ageText(null), null);
  assert.equal(bandOf(23.9).tone, null);
  assert.equal(bandOf(24).tone, 'warn');
  assert.equal(bandOf(72).tone, 'bad');
  assert.equal(bandOf(null), null);
});

test('a lane is a number, unreadable (never 0), not counted yet (never 0), or loading', () => {
  const views = laneViews(ready(GLANCE));
  const v = (k) => views.find((x) => x.key === k);
  assert.deepEqual([v('kyc').state, v('kyc').count, v('kyc').age, v('kyc').band.tone], ['ready', 10, '4 d 7 h', 'bad']);
  assert.deepEqual([v('lp').state, v('lp').count], ['unreadable', null]);
  assert.deepEqual([v('events').state, v('events').count, v('events').band], ['ready', 0, null], 'a measured 0 is fine');
  assert.deepEqual([v('product_testers').state, v('product_testers').count], ['ready', 0], 'D1132: Product testers reads its count');
  assert.deepEqual([v('comarketing').state, v('comarketing').count], ['ready', 0], 'D1041: a part 3 lane reads its count');
  const pitched = { ...GLANCE, approvals: { ...GLANCE.approvals, lanes: GLANCE.approvals.lanes.map((l) => (l.key === 'comarketing' ? { ...l, count: 2, oldest_age_hours: 80 } : l)) } };
  const c = laneViews(ready(pitched)).find((x) => x.key === 'comarketing');
  assert.deepEqual([c.state, c.count, c.age, c.band.tone], ['ready', 2, '3 d 8 h', 'bad']);
  const noLane = { ...GLANCE, approvals: { ...GLANCE.approvals, lanes: GLANCE.approvals.lanes.filter((l) => l.key !== 'articles') } };
  assert.deepEqual([laneViews(ready(noLane)).find((x) => x.key === 'articles').state, laneViews(ready(noLane)).find((x) => x.key === 'articles').count], ['unrecorded', undefined], 'a glance from before part 3 is not a 0');
  assert.equal(laneViews({ status: 'loading', hq: null })[0].state, 'loading');
  assert.equal(laneViews({ status: 'unreadable', hq: null }).find((x) => x.key === 'kyc').state, 'unreadable');
});

test('the Over 72 hours tile\'s line names the oldest lane from the glance', () => {
  assert.equal(oldestLine(laneViews(ready(GLANCE))), 'oldest 6 d 2 h, Due diligence');
});

// ---------------------------------------------------------------- part 7's model (D1045)

test('the inbox query from the address: search from two characters, a bad value dropped, oldest the default', () => {
  assert.deepEqual(inboxQueryOf('?q=k&group=people&age=past&assigned=me&sort=newest&page=2'), { page: 2, filters: { group: 'people', age: 'past', assigned: 'me', sort: 'newest' }, typed: 'k' });
  assert.deepEqual(inboxQueryOf('?q=ky').filters, { q: 'ky' });
  assert.deepEqual(inboxQueryOf('?group=hq&age=old&assigned=-1&sort=random&page=0'), { page: 1, filters: {}, typed: '' }, 'HQ is no group for an Admin');
  assert.deepEqual(inboxQueryOf('?group=hq&assigned=8', true).filters, { group: 'hq', assigned: '8' });
});

test('rows: the band pill, the group, and who holds it — "Not read" is never "Unassigned"', () => {
  const rows = inboxRows(INBOX);
  assert.deepEqual(rows.map((r) => [r.key, r.age, r.band.label, r.group, r.assignee.text]), [
    ['kyc:41', '4 d 7 h', 'Over 72 hours', 'People and accounts', 'Admin A'],
    ['due_diligence:9', '1 d 6 h', '24 to 72 hours', 'Deals and portfolio', 'Unassigned'],
    ['jobs:3', 'Age not recorded', 'Age not recorded', 'Community and content', 'Not read'],
  ]);
  assert.equal(rows[0].href, '/admin/approvals/items/kyc-41');
  assert.deepEqual(assigneeOf({}), { kind: 'unread', text: 'Not read' });
  assert.equal(pageLine(INBOX), '1–3 of 123 +', 'a failed lane leaves the total short, and says so');
  assert.equal(pageLine({ ...INBOX, unreadable: [] }), '1–3 of 123');
  assert.equal(pageLine({ ...INBOX, total: null }), '1–3 of —');
  assert.equal(hasNextPage({ ...INBOX, total: 123 }), true);
  assert.equal(hasNextPage({ ...INBOX, page: 5 }), false);
});

test('the four tiles: numbers from the reads, "Could not be read" with why, never a 0 for a gap', () => {
  const t = inboxTiles({ status: 'ready', reply: INBOX }, { status: 'ready', reply: WEEKLY });
  assert.deepEqual([t.waiting.value, t.waiting.sub], ['123 +', 'LP applications could not be read']);
  assert.deepEqual([t.over72.value, t.mine.value, t.decided.value, t.decided.sub], ['5', '2', '12', 'median wait 1 d 9 h']);
  const whole = inboxTiles({ status: 'ready', reply: { ...INBOX, unreadable: [] } }, null);
  assert.equal(whole.waiting.sub, 'across 5 lanes');
  assert.equal(whole.decided.state, 'loading');
  const withheld = inboxTiles({ status: 'ready', reply: { ...INBOX, tiles: { over_72h: null, assigned_to_me: null, reason: 'Assignments could not be read.' } } }, { status: 'error' });
  assert.deepEqual([withheld.over72.state, withheld.mine.reason, withheld.decided.state], ['unreadable', 'Assignments could not be read.', 'unreadable']);
  assert.equal(inboxTiles({ status: 'error' }, null).waiting.state, 'unreadable');
  const counts = inboxGroupCounts(INBOX, false);
  assert.deepEqual([counts.people, counts.deals, counts.all], [10, null, null], 'a failed lane leaves its group with no total');
});

test('Waiting by lane: split by band, worst first, a failed lane a row that says so; the sentence names the most and the oldest', () => {
  const c = laneAgeChart(INBOX);
  assert.equal(c.type, 'stackbars');
  assert.deepEqual(c.rows.map((r) => [r.key, r.total]), [['kyc', '10 waiting'], ['due_diligence', '6 waiting'], ['exploring', '104 waiting'], ['jobs', '3 waiting'], ['lp', 'Could not be read']]);
  assert.deepEqual(c.rows[0].parts.map((p) => p.value), [2, 3, 5, 0]);
  assert.equal(c.sum, 'Items waiting by lane in age bands. Explorers ready for a profile holds the most, 104; KYC has 5 over 72 hours. LP applications is not split: it could not be read in full.');
});

test('the weekly chart: two lines, this week to date, its sentence, and the lanes Decided leaves out', () => {
  const w = weekChart(WEEKLY);
  assert.equal(w.drawable, true);
  assert.deepEqual([w.chart.type, w.chart.labels[0], w.chart.currentIndex, w.chart.series.map((x) => x.label)], ['lines', '31 Aug', 7, ['Arrived', 'Decided']]);
  assert.match(w.sum, /^Items that arrived and were decided each week for eight weeks\. Arrivals went from 10 to 6 a week\. Decisions went from 8 to 4\. This week is not finished\.$/);
  assert.equal(w.foot, 'Wellbeing experts, Exploring do not record when they were decided, so they are not in Decided.');
  assert.equal(weekChart({ weeks: [], totals: {}, unreadable: ['KYC'] }).reason, 'KYC could not be read.');
});

test('the item: its facts and history, or why not (gone, missing, unread with a reference)', () => {
  const v = itemView({ status: 'ready', reply: ITEM });
  assert.deepEqual([v.who, v.laneLabel, v.submitted, v.age, v.assignee.text, v.group], ['Person A', 'KYC', '20 Oct 2026, 08:00', '4 d 7 h', 'Admin A', 'People and accounts']);
  assert.deepEqual(v.history.lines, [{ text: 'Assigned to Admin A by Admin B', day: '21 Oct 2026' }]);
  assert.equal(historyLines({ available: true, items: [{ actor_user_id: 7, assignee_user_id: 7, assignee_name: 'Admin A', created_at: null }] }).lines[0].text, 'Admin A took it');
  assert.equal(historyLines(null).state, 'unread');
  const err = (status, code, message) => ({ status: 'error', error: Object.assign(new Error(message || 'x'), { status, code }) });
  assert.equal(itemView(err(404, 'item_not_waiting', 'This item is not waiting any more.')).state, 'gone');
  assert.equal(itemView(err(404, 'item_not_found')).state, 'missing');
  const unread = itemView(err(503, 'lane_unreadable', 'KYC could not be read.'));
  assert.deepEqual([unread.state, unread.ref], ['unread', 'HTTP 503 · lane_unreadable']);
  assert.equal(errorRef({}), null);
});

test('Assign: each admin with what they hold now, the caller marked; the title; a refusal said with the list re-read', () => {
  assert.deepEqual(assignChoices(INBOX, 7).choices.map((c) => c.label), ['Admin A · you · 14 now', 'Admin B · 3 now']);
  assert.equal(assignChoices({ reviewers: null, reviewers_reason: 'Admins could not be read.' }, 7).text, 'Admins could not be read.');
  assert.equal(assignTitle([{ who: 'Person A', laneLabel: 'KYC' }]), 'Assign Person A’s identity check');
  assert.equal(assignTitle([{}, {}, {}]), 'Assign 3 items');
  assert.equal(refusalToast(Object.assign(new Error('Admin B is not a reviewer'), { code: 'not_a_reviewer' })), 'Admin B is not a reviewer. The list is up to date now.');
  assert.equal(refusalToast(new Error('Request failed')), 'That could not be done. The list is up to date now.');
});

test('Lanes: Notifies with "Nobody yet" a warning; HQ\'s counts from the glance, never 0 for a gap', () => {
  assert.deepEqual(notifiesOf({ notifies: 'Nobody yet' }), { state: 'ready', text: 'Nobody yet', warn: true });
  assert.equal(notifiesOf({}).text, 'Not read here yet');
  const hq = hqLaneViews({ lanes: [{ key: 'payouts', count: 4, oldest_age_hours: 80 }, { key: 'tickets', count: null }], pending_total: null, unreadable: ['Tickets'] });
  const by = (k) => hq.find((l) => l.key === k);
  assert.deepEqual([by('payouts').state, by('payouts').count, by('payouts').age], ['ready', 4, '3 d 8 h']);
  assert.deepEqual([by('tickets').state, by('tickets').count], ['unreadable', null]);
  assert.equal(by('grants').state, 'unrecorded');
  assert.ok(hqLaneViews(null).every((l) => l.state === 'unrecorded'));
  assert.equal(hqBandLine({ pending_total: 22 }), 'HQ decides · 22 waiting · only Super Admins see this group');
  assert.match(hqBandLine({ pending_total: null, unreadable: ['Tickets'] }), /Tickets could not be read, so no total/);
});

test('Decided: rows in the store\'s words, the "not recorded before" line, the query, the page line', () => {
  const r = decidedRows(DECIDED)[0];
  assert.deepEqual([r.when, r.lane, r.outcome.word, r.outcome.tone, r.by, r.wait, r.shown], ['25 Oct 2026, 14:00', 'KYC', 'Approved', 'good', 'Admin A', '1 d 9 h', true]);
  const n = decidedNotes(DECIDED);
  assert.deepEqual(n.since, ['Wellbeing experts: decisions were not recorded before 21 Oct 2026.']);
  assert.deepEqual(n.notRecorded, [{ label: 'Explorers ready for a profile', reason: 'Explorers do not record who decided.' }]);
  assert.equal(decidedPageLine(DECIDED), '1–1 of 357');
  assert.deepEqual(decidedQueryOf('?lane=kyc&outcome=approved&decided_by=7&from=2026-10-01&to=bad&page=41'), { page: 1, lane: 'kyc', outcome: 'approved', decided_by: '7', from: '2026-10-01' });
});

test('Waiting on HQ: the open requests; an account with no licence asks HQ nothing, never "0"', () => {
  const v = waitingOnHq({ status: 'ready', reply: REQUESTS }, Date.parse('2026-10-26T10:00:00Z'));
  assert.deepEqual(v.rows.map((r) => [r.text, r.sub]), [['Renewal', 'sent 20 Oct 2026 · 6 d 0 h']]);
  assert.equal(waitingOnHq({ status: 'error', error: { status: 404, code: 'no_licence' } }).state, 'none');
  assert.equal(waitingOnHq({ status: 'error', error: { status: 503 } }).state, 'unread');
});

test('pitches oldest first in the canvas\'s words; attribution summed over the published', () => {
  const now = Date.parse('2026-10-21T16:00:00Z');
  const rows = pitchRows([
    { uid: 'b', title: 'The LP letter, explained', asset_type: 'blog', partner_company: 'Firm Name', partner_name: 'Ben', created_at: '2026-10-20 16:00:00', target_audience: 'First-time LPs' },
    { uid: 'a', title: 'Hiring your first engineer', asset_type: 'webinar', partner_company: 'Partner A', created_at: '2026-10-18 13:00:00', proposed_date: '2026-11-14' },
  ], now);
  assert.deepEqual(rows.map((r) => [r.key, r.type, r.age, r.date, r.audience]), [['a', 'Webinar', '3 d 3 h', '14 Nov 2026', 'Not given'], ['b', 'Blog', '1 d 0 h', 'No date', 'First-time LPs']]);
  assert.equal(rows[1].submitter, 'Ben');
  assert.deepEqual(attributionTotals([{ attribution: { visit: 3, signup: 1 } }, { attribution: { visit: 2 } }]), { visits: 5, signups: 1, leads: 0, conversions: 0 });
});

test('experts by the directory\'s bar; a sample is no item; counts are not drawn when the read stopped short', () => {
  assert.equal(expertState({ verified: false, profile_completion_pct: 92 }), 'verify');
  assert.equal(expertState({ verified: false, profile_completion_pct: 41 }), 'incomplete');
  assert.equal(expertState({ verified: true, hidden: true }), 'hidden');
  assert.equal(expertState({ verified: false, profile_completion_pct: 99, is_sample: true }), null);
  const reply = { matches: [
    { uid: 'e1', name: 'Expert A', verified: false, profile_completion_pct: 92, hourly_rate_usd: 120, categories: ['Coaching'] },
    { uid: 'e2', name: 'Expert B', verified: false, profile_completion_pct: 74, first_session_free: true },
    { uid: 'e3', name: 'Expert C', verified: false, profile_completion_pct: 41 },
    { uid: 'e4', name: 'Expert D', verified: true },
  ], total_active: 4 };
  const b = expertBoard(reply, 'verify');
  assert.deepEqual(b.counts, { verify: 2, incomplete: 1, verified: 1, hidden: 0 });
  assert.deepEqual(b.rows.map((r) => [r.name, r.pricing]), [['Expert A', '$120 an hour'], ['Expert B', 'Free first session']]);
  assert.equal(b.partial, false);
  assert.equal(expertBoard({ ...reply, total_active: 80 }, 'verify').partial, true);
});

// ---------------------------------------------------------------- mounted

async function render(url, el) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: el }))));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    ids: (prefix) => walk(container).map((n) => props(n)?.['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    hrefs: () => walk(container).filter((n) => n.tagName === 'A').map((n) => props(n)?.href),
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub({ glance = () => json(GLANCE), queue = (s) => json({ items: [] }), experts = () => json({ matches: [], total_active: 0 }) } = {}) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(`${u.pathname}${u.search}`);
    if (u.pathname === '/api/admin/studio/glance') return glance();
    if (u.pathname === '/api/comarketing/admin/queue') return queue(u.searchParams.get('status'));
    if (u.pathname === '/api/wellbeing/experts') return experts();
    return json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}
const reads = (s) => [...new Set(s.seen.filter((p) => !p.startsWith('/api/ai') && !p.startsWith('/api/rail')).map((p) => p.split('?')[0]))].sort();

// D1045: the page with every read it makes, focus kept (so focus return reads), POSTs recorded.
const PART7 = {
  inbox: () => json(INBOX), weekly: () => json(WEEKLY), requests: () => json(REQUESTS), item: () => json(ITEM),
  decided: () => json(DECIDED), assign: () => json({ ok: true, assigned: 1 }),
};
async function mount(url, el, over = {}) {
  const restore = installDocument('', { focus: true });
  const original = { fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  const on = { glance: () => json(GLANCE), ...PART7, ...over };
  const seen = [];
  const posts = [];
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { copied.push(t); } } } });
  globalThis.fetch = async (u, opts = {}) => {
    const x = new URL(String(u), 'http://x');
    seen.push(`${x.pathname}${x.search}`);
    if (String(opts.method || 'GET') === 'POST') posts.push({ path: x.pathname, body: JSON.parse(opts.body || '{}') });
    if (x.pathname === '/api/admin/studio/glance') return on.glance();
    if (x.pathname === '/api/admin/approvals') return on.inbox(x.searchParams);
    if (x.pathname === '/api/admin/approvals/decided/weekly') return on.weekly();
    if (x.pathname === '/api/admin/approvals/decided') return on.decided(x.searchParams);
    if (x.pathname === '/api/admin/approvals/assignments') return on.assign();
    if (x.pathname.startsWith('/api/admin/approvals/items/')) return on.item(x.pathname);
    if (x.pathname === '/api/licence/mine/requests') return on.requests();
    return json({});
  };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: el })), h(Probe))); });
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    seen, posts, copied, at, flush,
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    ids: (prefix) => walk(container).map((n) => props(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    hrefs: () => walk(container).filter((n) => n.tagName === 'A').map((n) => props(n).href),
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    focus(id) { const n = byId(id); assert.ok(n, `no ${id} to focus`); n.focus(); },
    focused: () => (document.activeElement && document.activeElement !== document.body ? props(document.activeElement)['data-testid'] || 'other' : 'body'),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked: true } }); }); await flush(); },
    async unmount() {
      await act(async () => root.unmount());
      globalThis.fetch = original.fetch;
      if (original.navigator) Object.defineProperty(globalThis, 'navigator', original.navigator); else delete globalThis.navigator;
      restore();
    },
  };
}
const api = (v) => [...new Set(v.seen.filter((p) => p.startsWith('/api/admin/approvals') || p.startsWith('/api/licence') || p.startsWith('/api/admin/studio')).map((p) => p.split('?')[0]))].sort();

test('mounted, Inbox (APR1): the tiles, the two charts with their sentences, the items with their doors, the partial note and Waiting on HQ', async () => {
  const v = await mount('/admin/approvals?moved=held-approvals', h(AdminApprovals));
  try {
    assert.equal(v.h1s(), 1);
    assert.match(v.of('approvals-header'), /Approvals has a new address\. Update your bookmark\./);
    assert.match(v.of('approvals-tab-inbox'), /Inbox\s*123 \+/);
    assert.match(v.of('approvals-tile-waiting'), /Waiting\s*123 \+\s*LP applications could not be read/);
    assert.match(v.of('approvals-tile-over72'), /Over 72 hours\s*5\s*oldest 6 d 2 h, Due diligence/);
    assert.match(v.of('approvals-tile-assigned'), /Assigned to you\s*2/);
    assert.match(v.of('approvals-tile-decided'), /Decided this week\s*12\s*median wait 1 d 9 h/);
    assert.equal(v.props('approvals-chart-lanes-img')['aria-label'], laneAgeChart(INBOX).sum, 'the chart\'s one sentence');
    assert.equal(v.props('approvals-chart-weeks-img').role, 'img');
    assert.match(v.of('approvals-chart-weeks'), /Wellbeing experts, Exploring do not record when they were decided/);
    await v.click('approvals-chart-lanes-toggle');
    assert.match(v.of('approvals-chart-lanes'), /View as chart.*KYC\s*2\s*3\s*5\s*0\s*10 waiting/s, 'View as table: the same rows');
    assert.deepEqual(v.ids('approvals-row-'), ['approvals-row-kyc:41', 'approvals-row-due_diligence:9', 'approvals-row-jobs:3']);
    assert.match(v.of('approvals-row-kyc:41'), /4 d 7 h\s*Over 72 hours\s*KYC\s*People and accounts\s*Person A\s*Identity check\s*Admin A\s*KYC & KYB/);
    assert.match(v.of('approvals-row-due_diligence:9'), /Unassigned\s*Due diligence/);
    assert.match(v.of('approvals-row-jobs:3'), /Age not recorded.*Not read\s*Jobs/s, 'an unread assignment is never "Unassigned"');
    assert.equal(v.props('approvals-open-kyc:41').href, '/admin/approvals/items/kyc-41?moved=held-approvals');
    assert.match(v.of('approvals-partial'), /LP applications could not be read, so its items are missing below\. The other 4 lanes are complete\. Try again/);
    assert.equal(v.of('approvals-count'), '1–3 of 123 +');
    assert.match(v.of('approvals-waiting-on-hq'), /What this studio asked HQ\.\s*Renewal\s*sent 20 Oct 2026/);
    assert.doesNotMatch(v.of('approvals-waiting-on-hq'), /Seat increase/, 'an answered request is not waiting');
    assert.match(v.of('approvals-group-people'), /People and accounts\s*10/);
    assert.match(v.of('approvals-group-deals'), /Deals and portfolio\s*—/, 'a failed lane is a dash, never 0');
    assert.ok(!v.has('approvals-group-hq'), 'an Admin has no HQ group');
    assert.deepEqual(api(v), ['/api/admin/approvals', '/api/admin/approvals/decided/weekly', '/api/admin/studio/glance', '/api/licence/mine/requests']);
    assert.ok(!v.seen.some((p) => /decide|approve|reject/.test(p.split('?')[0].replace('/decided', ''))), 'nothing decides here');
  } finally { await v.unmount(); }
});

test('mounted, Inbox: filters live in the address and reach the Worker; one search character does not filter; the pager', async () => {
  const v = await mount('/admin/approvals?group=people&age=past&assigned=me&sort=lane&q=k', h(AdminApprovals));
  try {
    const sent = v.seen.find((p) => p.startsWith('/api/admin/approvals?'));
    assert.equal(sent, '/api/admin/approvals?page=1&group=people&age=past&assigned=me&sort=lane');
    assert.equal(v.props('approvals-assigned').value, 'me');
    await v.click('approvals-next');
    assert.equal(v.at.path, '/admin/approvals?group=people&age=past&assigned=me&sort=lane&q=k&page=2');
    assert.ok(v.seen.includes('/api/admin/approvals?page=2&group=people&age=past&assigned=me&sort=lane'));
    await v.change('approvals-search', 'ky');
    assert.ok(!v.at.path.includes('page='), 'a new search starts at page 1');
    assert.ok(v.seen.includes('/api/admin/approvals?page=1&q=ky&group=people&age=past&assigned=me&sort=lane'));
  } finally { await v.unmount(); }
});

test('mounted, Inbox: the ⋯ menu copies the item\'s link; the bulk bar assigns the picked items and a refusal is a toast, the list re-read', async () => {
  let refuse = false;
  const v = await mount('/admin/approvals', h(ApprovalsPage, { viewer: { id: 7, role: 'admin', is_super_admin: 0 } }), {
    assign: () => (refuse ? json({ code: 'item_not_waiting', message: 'This item is not waiting any more: it was decided, withdrawn or moved.' }, 404) : json({ ok: true, assigned: 2 })),
  });
  try {
    await v.click('approvals-menu-kyc:41');
    await v.click('approvals-menu-kyc:41-copy');
    assert.deepEqual(v.copied.map((u) => u.replace(/^[a-z]+:\/\/[^/]*/, '')), ['/admin/approvals/items/kyc-41']);
    assert.match(v.of('approvals-toast'), /Link copied\./);
    await v.change('approvals-pick-kyc:41');
    await v.change('approvals-pick-jobs:3');
    assert.match(v.of('approvals-bulk'), /2 selected\s*Assign…\s*Clear/);
    await v.click('approvals-bulk-assign');
    assert.match(v.of('approvals-assign'), /Assign 2 items\s*They see it under Assigned to me\. Assigning decides nothing\./);
    assert.match(v.of('approvals-assign-7'), /Admin A · you · 14 now/);
    assert.equal(v.props('approvals-assign-send').disabled, true, 'nobody chosen, nothing sent');
    await v.change('approvals-assign-pick-8');
    const before = v.seen.filter((p) => p.startsWith('/api/admin/approvals?')).length;
    await v.click('approvals-assign-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/approvals/assignments', body: { assignee_user_id: 8, items: [{ lane: 'kyc', item_id: 41 }, { lane: 'jobs', item_id: 3 }] } }]);
    assert.match(v.of('approvals-toast'), /Assigned to Admin B\./);
    assert.ok(!v.has('approvals-assign'));
    assert.ok(v.seen.filter((p) => p.startsWith('/api/admin/approvals?')).length > before, 'the list is read again');
    refuse = true;
    await v.click('approvals-menu-due_diligence:9');
    await v.click('approvals-menu-due_diligence:9-assign');
    assert.match(v.of('approvals-assign'), /Assign Company B’s item/);
    await v.change('approvals-assign-pick-7');
    await v.click('approvals-assign-send');
    assert.equal(v.of('approvals-toast').replace('×', ''), 'This item is not waiting any more: it was decided, withdrawn or moved. The list is up to date now.');
  } finally { await v.unmount(); }
});

test('mounted, the item (APR3): its own address over the Inbox, the facts, Assigned, History, the deciding page; closing gives focus back to the row', async () => {
  const v = await mount('/admin/approvals', h(ApprovalsPage, { viewer: { id: 7, role: 'admin', is_super_admin: 0 } }));
  try {
    v.focus('approvals-open-kyc:41');
    await v.click('approvals-open-kyc:41');
    assert.equal(v.at.path, '/admin/approvals/items/kyc-41');
    assert.ok(v.has('approvals-inbox'), 'the Inbox stays underneath');
    assert.ok(v.seen.includes('/api/admin/approvals/items/kyc/41'));
    assert.match(v.of('approvals-item'), /Item\s*Person A\s*Esc to close/);
    assert.match(v.of('approvals-item-facts'), /Submitted\s*20 Oct 2026, 08:00\s*Profile\s*Identity check\s*Item ID\s*41\s*Lane\s*KYC · People and accounts/);
    assert.match(v.of('approvals-item-assigned'), /Assigned\s*Admin A\s*Assign…/);
    assert.match(v.of('approvals-item-history'), /Assigned to Admin A by Admin B · 21 Oct 2026/);
    assert.match(v.of('approvals-item'), /Open in KYC & KYB\s*This lane is decided on its own page, where its rules and messages live\./);
    await v.click('approvals-item-close');
    assert.equal(v.at.path, '/admin/approvals');
    assert.ok(!v.has('approvals-item'));
    assert.equal(v.focused(), 'approvals-open-kyc:41', 'Esc and Close give focus back to the row');
  } finally { await v.unmount(); }
  const gone = await mount('/admin/approvals/items/kyc-41', h(AdminApprovals), { item: () => json({ code: 'item_not_waiting', message: 'This item is not waiting any more: it was decided, withdrawn or moved.' }, 404) });
  try {
    assert.match(gone.of('approvals-item-gone'), /This item is not waiting any more.*Back to the inbox/);
  } finally { await gone.unmount(); }
  const down = await mount('/admin/approvals/items/kyc-41', h(AdminApprovals), { item: () => json({ code: 'lane_unreadable', message: 'KYC could not be read.' }, 503) });
  try {
    assert.match(down.of('approvals-item-failed'), /This item could not be read\.\s*KYC could not be read\.\s*Try again/);
    assert.match(down.of('approvals-item-failed-details'), /Details\s*HTTP 503 · lane_unreadable/);
  } finally { await down.unmount(); }
});

test('mounted, states: skeletons while reading (APR12); nothing waiting (APR11a); a failed inbox with Details, never empty (APR13b); the HQ-lane card (APR14a)', async () => {
  let v = await mount('/admin/approvals', h(AdminApprovals), { inbox: () => new Promise(() => {}) });
  try {
    assert.ok(v.has('approvals-skeleton'));
    assert.ok(!v.has('approvals-empty'));
  } finally { await v.unmount(); }
  v = await mount('/admin/approvals', h(AdminApprovals), { inbox: () => json({ ...INBOX, items: [], total: 0, unfiltered_total: 0, unreadable: [] }) });
  try {
    assert.match(v.of('approvals-empty'), /Nothing is waiting on you\..*See what was decided/s);
    assert.ok(v.hrefs().includes('/admin/approvals/decided'));
  } finally { await v.unmount(); }
  v = await mount('/admin/approvals?age=past', h(AdminApprovals), { inbox: () => json({ ...INBOX, items: [], total: 0, unreadable: [] }) });
  try {
    assert.match(v.of('approvals-empty'), /Nothing matches these filters\.\s*Clear filters/);
  } finally { await v.unmount(); }
  v = await mount('/admin/approvals', h(AdminApprovals), { inbox: () => json({ code: 'assigned_unreadable', message: 'Assignments could not be read.' }, 503) });
  try {
    assert.match(v.of('approvals-failed'), /We could not load Approvals\.\s*The rest of the admin still works/);
    assert.match(v.of('approvals-failed-details'), /HTTP 503 · assigned_unreadable/);
    assert.ok(!v.has('approvals-empty'), 'a failed read is not "nothing waiting"');
    assert.match(v.of('approvals-tile-waiting'), /Could not be read/);
  } finally { await v.unmount(); }
  v = await mount('/admin/approvals?lane=payouts', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 0 } }));
  try {
    assert.match(v.of('approvals-hq-only'), /This lane belongs to the Super Admin\..*Show my inbox/s);
    assert.ok(!v.has('approvals-inbox'));
  } finally { await v.unmount(); }
});

test('mounted, Super Admin: the HQ decides band and the HQ group chip', async () => {
  const glance = { ...GLANCE, approvals: { ...GLANCE.approvals, hq_decides: { lanes: [{ key: 'payouts', count: 22, oldest_age_hours: 30 }], pending_total: 22, unreadable: [] } } };
  const v = await mount('/admin/approvals', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 1 } }), { glance: () => json(glance) });
  try {
    assert.equal(v.of('approvals-hq-band'), 'HQ decides · 22 waiting · only Super Admins see this group');
    assert.ok(v.has('approvals-group-hq'));
  } finally { await v.unmount(); }
  const admin = await mount('/admin/approvals', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 0 } }), { glance: () => json(glance) });
  try {
    assert.ok(!admin.has('approvals-hq-band'), 'an Admin never sees the HQ band, whatever the glance carries');
  } finally { await admin.unmount(); }
});

test('mounted, Decided (APR10): the log in the store\'s words, "not recorded before", the filters in the address, the count', async () => {
  const v = await mount('/admin/approvals/decided?outcome=approved', h(AdminApprovals));
  try {
    assert.ok(v.seen.includes('/api/admin/approvals/decided?page=1&outcome=approved'));
    assert.match(v.of('approvals-tab-decided'), /Decided\s*357/);
    assert.match(v.of('approvals-decided-notes'), /Wellbeing experts: decisions were not recorded before 21 Oct 2026\.\s*Explorers ready for a profile: Explorers do not record who decided\./);
    assert.match(v.of('approvals-decided-kyc:40:2026-10-25 14:00:00'), /25 Oct 2026, 14:00\s*KYC\s*Person D\s*Approved\s*Admin A\s*1 d 9 h\s*Welcome aboard\s*◉ They see this/);
    assert.equal(v.of('approvals-decided-count'), '1–1 of 357');
    assert.ok(!v.seen.some((p) => p.startsWith('/api/admin/approvals?')), 'Decided reads no inbox');
  } finally { await v.unmount(); }
  const down = await mount('/admin/approvals/decided', h(AdminApprovals), { decided: () => json({ code: 'bad_page', message: 'x' }, 503) });
  try {
    assert.match(down.of('approvals-decided-failed'), /We could not load what was decided\./);
    assert.match(down.of('approvals-tab-decided'), /Decided\s*—/, 'no count, never 0');
  } finally { await down.unmount(); }
});

test('mounted, Lanes: each group\'s lanes with New pills, Could not be read with Try again, Not read here yet, and HQ decides only for a Super Admin', async () => {
  // D1045: each lane's Notifies (D1041) and HQ's counts ride on the glance.
  const told = { kyc: 'The member, by email', comarketing: 'Nobody yet' };
  const lanesGlance = {
    ...GLANCE,
    approvals: {
      ...GLANCE.approvals,
      lanes: GLANCE.approvals.lanes.map((l) => (told[l.key] ? { ...l, notifies: told[l.key] } : l)),
      hq_decides: { lanes: [{ key: 'payouts', count: 4, oldest_age_hours: 80 }, { key: 'tickets', count: null }], pending_total: null, unreadable: ['Tickets'] },
    },
  };
  const s = stub({ glance: () => json(lanesGlance) });
  let v = await render('/admin/approvals/lanes', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 0 } }));
  try {
    assert.match(v.of('approvals-lane-lp'), /LP applications\s*Could not be read Try again/);
    assert.equal(v.of('approvals-notifies-kyc'), 'The member, by email');
    assert.equal(v.of('approvals-notifies-comarketing'), 'Nobody yet');
    assert.equal(v.of('approvals-notifies-events'), 'Not read here yet', 'a glance without it is not read here, never "Nobody"');
    assert.match(v.of('approvals-tab-lanes'), /Lanes\s*20/);
    // D1041: KYB is counted now (the stub's glance answers 0); D1132: so is Product testers.
    assert.match(v.of('approvals-lane-kyb'), /KYB\s*New\s*0/);
    assert.match(v.of('approvals-lane-product_testers'), /Product testers\s*New\s*0\s*—\s*Here/);
    assert.match(v.of('approvals-lane-events'), /Events\s*0\s*—\s*Events › Review/);
    assert.match(v.of('approvals-not-a-queue'), /Partner invitations: An open invitation waits on the invitee, not an admin\./);
    assert.ok(!v.has('approvals-hq-lanes'), 'an Admin never sees the HQ group');
  } finally { await v.unmount(); }
  v = await render('/admin/approvals/lanes', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 1 } }));
  try {
    assert.match(v.of('approvals-hq-lanes'), /HQ decides · Tickets could not be read, so no total/);
    assert.match(v.of('approvals-hq-payouts'), /Payout requests\s*4\s*3 d 8 h\s*Commissions/);
    assert.equal(v.of('approvals-hq-count-tickets'), 'Could not be read');
    assert.equal(v.of('approvals-hq-count-grants'), 'Not read here yet', 'a lane off the glance is never 0');
    assert.match(v.of('approvals-tab-lanes'), /Lanes\s*29/);
    assert.match(v.of('approvals-hq-proposals'), /not built yet/);
    // D1132: Program-grant requests opens HQ's Requests page (D987), not "not built yet".
    assert.match(v.of('approvals-hq-grants'), /Licences › Program grants › Requests/);
    assert.doesNotMatch(v.of('approvals-hq-grants'), /not built yet/);
    assert.ok(v.hrefs().includes('/admin/licences/programs/requests'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, boards: co-marketing reads its five states alone and decides nowhere; wellbeing\'s partial read draws no counts; testers read nothing', async () => {
  const items = { proposed: [{ uid: 'p1', title: 'Hiring your first engineer', asset_type: 'webinar', partner_company: 'Partner A', created_at: '2026-10-18 13:00:00' }] };
  let s = stub({ queue: (st) => (st === 'withdrawn' ? json({ detail: 'down' }, 503) : json({ items: items[st] || [] })) });
  let v = await render('/admin/approvals/co-marketing', h(LaneBoards));
  try {
    assert.match(v.of('approvals-board-header'), /Approvals.*Co-marketing pitches.*New lane/s);
    assert.match(v.of('pitches-tab-proposed'), /Proposed\s*1/);
    assert.match(v.of('pitches-tab-withdrawn'), /Withdrawn\s*—/, 'a failed state is a dash, never 0');
    assert.match(v.of('pitch-p1'), /Hiring your first engineer\s*Webinar\s*Partner A/);
    assert.match(v.of('pitches-decide-line'), /stay on Co-marketing/);
    assert.equal(s.seen.filter((p) => p.startsWith('/api/comarketing/admin/queue')).length, 5);
    assert.ok(!s.seen.some((p) => /\/admin\/pitches\//.test(p)), 'nothing is decided from this board');
  } finally { await v.unmount(); s.restore(); }
  s = stub({ experts: () => json({ matches: [{ uid: 'e1', name: 'Expert A', verified: false, profile_completion_pct: 92 }], total_active: 80 }) });
  v = await render('/admin/approvals/wellbeing-experts', h(LaneBoards));
  try {
    assert.match(v.of('experts-tab-verify'), /To verify\s*—/);
    assert.match(v.of('experts-partial'), /first 1 of 80/);
    assert.match(v.of('expert-e1'), /Expert A/);
  } finally { await v.unmount(); s.restore(); }
  s = stub();
  v = await render('/admin/approvals/product-testers', h(LaneBoards));
  try {
    assert.match(v.of('approvals-testers-none'), /counted on the Inbox, under Product testers/);
    assert.deepEqual(reads(s), [], 'no store, no read');
  } finally { await v.unmount(); s.restore(); }
});

// ---------------------------------------------------------------- the wiring

test('the routes under one guard, the redirect, the row lit on every sub-path, and the canvas in design/incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/approvals', '/admin/approvals/lanes', '/admin/approvals/decided', '/admin/approvals/items/:ref']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <AdminApprovals />)} />`), p);
  }
  for (const p of ['/admin/approvals/product-testers', '/admin/approvals/co-marketing', '/admin/approvals/co-marketing/declined', '/admin/approvals/wellbeing-experts/hidden']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <ApprovalsLaneBoards />)} />`), p);
  }
  assert.ok(app.includes('<Route path="/admin/held/approvals" element={<HeldApprovalsRedirect />} />'));
  const row = SIDEBAR_GROUPS.admin.flatMap((g) => g.items).find((r) => r.label === 'Approvals');
  assert.equal(row.to, '/admin/approvals');
  assert.ok(row.match.includes('/admin/approvals'), 'the lane boards light the row');
  assert.ok(read('design/incoming/Approvals · Boards.dc.html').includes('APR16'));
  assert.ok(read('design/incoming/Approvals Page.dc.html').length > 1000);
  for (const f of ['LaneBoards.jsx', 'AdminApprovals.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/admin/approvals/${f}`), /window\.(alert|confirm)|\balert\(|\bconfirm\(/, f);
  }
  // D1045: the item link is a literal template the reachability walk resolves to the one-segment route.
  const page = read('frontend/src/pages/admin/approvals/AdminApprovals.jsx');
  assert.ok(page.includes('<Link to={`/admin/approvals/items/${r.lane}-${r.id}${loc.search}`}'));
  // APR14b: a non-admin on any /admin path meets RoleGuard's one card (D940), not a page of its own.
  assert.ok(app.includes("return <AdminOnlyNotice home={ROLE_DEFAULT_PATH[effectiveRole] || '/studio'} />;"));
});
