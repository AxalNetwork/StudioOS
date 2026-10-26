/**
 * D1038 (#2390) — Admin › Approvals at /admin/approvals: the addresses, the
 * twenty lanes from the Studio glance (a failed lane never 0, an uncounted
 * lane never 0), the Inbox oldest first, HQ decides for a Super Admin only,
 * and the three lane boards on the reads that exist.
 *
 * D1047 (#2895), part 9: the phone at 390 (APR15) and dark (APR16), at the end.
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
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import {
  HQ_LANES, LANES, MOVED_KEY, ageText, bandOf, boardOf, expertBoard, expertState, laneViews,
  oldestLine, pitchRows, tabOf, attributionTotals,
  answerPairs, credentialsText, decisionCopy, doneLine, profileChart, publishUrlOk, reasonReady, refusalLine, tabPath, testerActions, testerHistory, testerRows,
} from '../src/pages/admin/approvals/approvalsModel.js';
import { filterTesters, readAllTesters } from '../src/pages/admin/approvals/TesterBoard.jsx';
import { readAllExperts } from '../src/pages/admin/approvals/ExpertBoard.jsx';
import { oldestApproved } from '../src/pages/admin/approvals/PitchBoard.jsx';
import {
  assigneeOf, assignChoices, assignTitle, decidedNotes, decidedPageLine, decidedQueryOf, decidedRows, errorRef, hasNextPage,
  hqBandLine, hqLaneViews, inboxGroupCounts, inboxQueryOf, inboxRows, inboxTiles, itemOfPath, itemPath, itemView, laneAgeChart,
  notifiesOf, pageLine, refusalToast, waitingOnHq, weekChart, historyLines, cardAge, filterCount, sortLabel,
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

test('experts on part 5\'s review read: Declined is a tab, a sample is no item, counts are not drawn when the read stopped short (D1046)', () => {
  assert.equal(expertState({ decision_state: 'pending', profile_completion_pct: 92 }), 'verify');
  assert.equal(expertState({ decision_state: 'pending', profile_completion_pct: 41 }), 'incomplete');
  assert.equal(expertState({ verified: true, hidden: true }), 'hidden');
  assert.equal(expertState({ decision_state: 'declined', profile_completion_pct: 90 }), 'declined');
  assert.equal(expertState({ decision_state: 'verified', verified: true }), 'verified');
  assert.equal(expertState({ decision_state: 'pending', profile_completion_pct: 99, is_sample: true }), null);
  const now = Date.parse('2026-10-21T16:00:00Z');
  const reply = { items: [
    { uid: 'e2', name: 'Expert B', decision_state: 'pending', profile_completion_pct: 74, created_at: '2026-10-20 10:00:00', credentials: { files: [] } },
    { uid: 'e1', name: 'Expert A', decision_state: 'pending', profile_completion_pct: 92, created_at: '2026-10-19 07:00:00', credentials: { licence_number: 'WB-4821', files: [{ uid: 'f1' }, { uid: 'f2' }] } },
    { uid: 'e3', name: 'Expert C', decision_state: 'pending', profile_completion_pct: 41, credentials: {} },
    { uid: 'e4', name: 'Expert D', decision_state: 'verified', verified: true, decided_at: '2026-10-10 09:00:00', credentials: { files: [{ uid: 'f3' }] } },
    { uid: 'e5', name: 'Expert E', decision_state: 'declined', credentials: {} },
  ], total: 5 };
  const b = expertBoard(reply, 'verify', now);
  assert.deepEqual(b.counts, { verify: 2, incomplete: 1, verified: 1, declined: 1, hidden: 0 });
  assert.deepEqual(b.rows.map((r) => [r.name, r.age, r.credentials]), [['Expert A', '2 d 9 h', 'Licence and 2 files'], ['Expert B', '1 d 6 h', null]]);
  assert.equal(b.oldest, '2 d 9 h');
  assert.equal(b.partial, false);
  assert.equal(expertBoard(reply, 'verified', now).rows[0].decidedOn, '10 Oct 2026');
  assert.equal(expertBoard({ ...reply, total: 80 }, 'verify').partial, true);
  assert.equal(expertBoard({ items: [] }, 'verify').partial, true, 'no total, no counts');
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

// ---------------------------------------------------------------- D1046: the boards decide

/**
 * A board with every read it makes and every POST recorded. `route` answers
 * `(path, params, method, body)` with a Response, or null for `{}`.
 */
async function board(url, route) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  const seen = [];
  const posts = [];
  globalThis.fetch = async (u, opts = {}) => {
    const x = new URL(String(u), 'http://x');
    const method = String(opts.method || 'GET');
    const body = method === 'POST' ? JSON.parse(opts.body || '{}') : null;
    seen.push(`${method} ${x.pathname}${x.search}`);
    if (method === 'POST' && x.pathname !== '/api/client-error') posts.push({ path: x.pathname, body });
    return (await route(x.pathname, x.searchParams, method, body)) || json({});
  };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = l.pathname; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(LaneBoards) })), h(Probe))); });
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    seen, posts, at, flush,
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value, checked = true) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked } }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}
const gets = (v, prefix) => v.seen.filter((p) => p.startsWith(`GET ${prefix}`));

const TOTALS = { applied: 2, active: 1, paused: 0, declined: 0, removed: 0, total: 3 };
const member = (id, name, role, verified = true) => ({ id, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, role, email_verified: verified, kyc_status: 'approved' });
const TESTERS = [
  { id: 1, user_id: 11, status: 'applied', applied_at: '2026-10-17 09:00:00', availability: '3 hours a week', consent_email_at: '2026-10-17 09:00:00', consent_version: 'v2', answers: [{ question: 'What do you want to test?', answer: 'B2B tools for small funds.' }], member: member(11, 'Gus Demo', 'investor') },
  { id: 3, user_id: 13, status: 'applied', applied_at: '2026-10-20 09:00:00', availability: null, consent_email_at: null, answers: [], member: member(13, 'Ben Sample', 'founder', false) },
  { id: 2, user_id: 12, status: 'active', applied_at: '2026-07-01 09:00:00', decided_at: '2026-08-14 10:00:00', decided_by_name: 'Admin B', answers: [], programmes: { applied: 1, picked: 1 }, member: member(12, 'Eva Demo', 'advisor') },
];
const testerRoute = (over = {}) => async (path, q, method, body) => {
  if (path === '/api/admin/product-testers' && q.get('in_programme') === 'yes') return json({ rows: [], matching: 1, totals: TOTALS, page: 1, page_size: 1 });
  if (path === '/api/admin/product-testers') return json({ rows: TESTERS, matching: 3, totals: TOTALS, page: 1, page_size: 100 });
  const m = /^\/api\/admin\/product-testers\/(\d+)(?:\/(\w+))?$/.exec(path);
  if (m && method === 'POST') return over.decide ? over.decide(m[2], body) : json({ ok: true, places_ended: m[2] === 'remove' ? 2 : 0 });
  if (m) {
    const t = TESTERS.find((x) => String(x.id) === m[1]);
    return t ? json({ tester: t, programs: [{ application_uid: 'a1', application_status: 'picked', applied_at: '2026-09-01', product_name: 'Product Alpha' }], events: [{ id: 9, action: 'approve', actor_name: 'Admin B', created_at: '2026-08-14 10:00:00' }] })
      : json({ code: 'tester_not_found', message: 'No product tester has that number.' }, 404);
  }
  return null;
};

test('the board model: item addresses, tabs, tester rows, the chart, answers, history and actions (D1046)', () => {
  assert.deepEqual(boardOf('/admin/approvals/product-testers/active'), { board: 'product-testers', tab: 'active' });
  assert.deepEqual(boardOf('/admin/approvals/product-testers/12'), { board: 'product-testers', tab: 'waiting', item: '12' });
  assert.deepEqual(boardOf('/admin/approvals/co-marketing/pitch%20one'), { board: 'co-marketing', tab: 'proposed', item: 'pitch one' });
  assert.deepEqual(boardOf('/admin/approvals/wellbeing-experts/declined'), { board: 'wellbeing-experts', tab: 'declined' });
  assert.deepEqual(boardOf('/admin/approvals/wellbeing-experts/e1'), { board: 'wellbeing-experts', tab: 'verify', item: 'e1' });
  assert.equal(boardOf('/admin/approvals/co-marketing/a/b'), null, 'two segments past a board is nothing');
  assert.equal(tabPath('product-testers', 'removed'), '/admin/approvals/product-testers/removed');
  assert.equal(tabPath('co-marketing', 'proposed'), '/admin/approvals/co-marketing');
  const now = Date.parse('2026-10-21T09:00:00Z');
  const rows = testerRows(TESTERS, now);
  assert.deepEqual(rows.map((r) => [r.name, r.profile, r.age, r.consent, r.emailVerified]), [
    ['Gus Demo', 'Investor', '4 d 0 h', 'Given · v2', true], ['Ben Sample', 'Founder', '1 d 0 h', null, false], ['Eva Demo', 'Advisor', '112 d 0 h', null, true],
  ]);
  assert.deepEqual([rows[2].decidedBy, rows[2].decidedOn, rows[2].programmes], ['Admin B', '14 Aug 2026', { applied: 1, picked: 1 }]);
  assert.deepEqual(filterTesters(rows, { q: 'ben', sort: 'waiting' }).map((r) => r.id), [3]);
  assert.deepEqual(filterTesters(rows, { q: 'b', sort: 'waiting' }).map((r) => r.id), [1, 3, 2], 'one character does not filter');
  assert.deepEqual(filterTesters(rows, { verified: 'no' }).map((r) => r.id), [3]);
  assert.deepEqual(filterTesters(rows, { consent: 'yes' }).map((r) => r.id), [1]);
  assert.deepEqual(filterTesters(rows, { profile: 'advisor' }).map((r) => r.id), [2]);
  assert.deepEqual(filterTesters(rows, { sort: 'newest' }).map((r) => r.id), [3, 1, 2]);
  const chart = profileChart(TESTERS, { now });
  assert.equal(chart.sentence, 'Applications to test products in the last 12 weeks: founders 1, investors 1, advisors 0, operating partners 0, explorers 0.');
  assert.equal(chart.total, 2, 'July is older than twelve weeks');
  assert.equal(profileChart(TESTERS, { complete: false }).partial, true);
  assert.deepEqual(answerPairs([{ question: 'Q', answer: 'A' }, 'plain', '']), [{ q: 'Q', a: 'A' }, { q: 'Answer 2', a: 'plain' }]);
  assert.deepEqual(answerPairs({ Setup: 'Laptop' }), [{ q: 'Setup', a: 'Laptop' }]);
  assert.deepEqual(testerHistory([{ id: 1, action: 'decline', actor_name: 'Admin A', created_at: '2026-10-21 10:00:00', reason: 'Not this time.' }]), [{ key: 1, line: 'Declined by Admin A', on: '21 Oct 2026', reason: 'Not this time.' }]);
  assert.deepEqual([testerActions('applied'), testerActions('active'), testerActions('paused'), testerActions('removed')], [['decline', 'approve'], ['pause-remove'], ['remove', 'resume'], []]);
  assert.equal(credentialsText({ licence_number: 'X', files: [{}] }), 'Licence and 1 file');
  assert.equal(credentialsText({}), null);
});

test('every decision says what changes, who is told and what is recorded; reasons and links are checked as the Worker does (D1046)', () => {
  const kinds = ['tester_approve', 'tester_decline', 'tester_pause', 'tester_remove', 'tester_resume', 'pitch_approve', 'pitch_reject', 'pitch_publish',
    'expert_verify', 'expert_decline', 'expert_hide', 'expert_restore', 'expert_unverify'];
  for (const k of kinds) {
    const c = decisionCopy(k, { who: 'Gus Demo', partner: 'Partner A', profile: 'Investor', version: 3 });
    assert.ok(c.title && c.changes && c.button, k);
    assert.match(c.told, /told/, `${k} says who is told`);
    assert.match(c.recorded, /^Recorded/, `${k} says what is recorded`);
    assert.notEqual(doneLine(k, 'Gus Demo'), 'Saved.', k);
  }
  assert.equal(decisionCopy('nope'), null);
  assert.equal(decisionCopy('tester_approve', { who: 'Gus Demo', profile: 'Investor' }).changes, 'They join the tester pool, and testing programs can pick them. They keep their Investor profile.');
  assert.match(decisionCopy('expert_verify', { who: 'A', version: 3 }).recorded, /review version 3/);
  for (const k of ['tester_decline', 'pitch_reject', 'expert_decline']) {
    assert.match(decisionCopy(k, { who: 'A' }).told, /with your reason/, `${k}: the reason reaches them`);
    assert.equal(reasonReady(k, '  too short '), false);
    assert.equal(reasonReady(k, 'Long enough now.'), true);
  }
  assert.equal(reasonReady('tester_pause', ''), false);
  assert.equal(reasonReady('tester_pause', 'x'), true);
  assert.match(doneLine('tester_remove', 'Eva', { places_ended: 2 }), /2 open program places ended/);
  assert.deepEqual(['https://example.com/post', 'http://example.com', 'https://u:p@example.com', 'not a url', `https://e.com/${'a'.repeat(500)}`].map(publishUrlOk), [true, false, false, false, false]);
  assert.equal(refusalLine(Object.assign(new Error('Gus’s email is not verified, so they cannot be told.'), { status: 409 })), 'Gus’s email is not verified, so they cannot be told.');
  assert.match(refusalLine(Object.assign(new Error('Internal'), { status: 503 })), /Nothing changed/);
  assert.match(refusalLine(new Error('Network down')), /Nothing changed/, 'no status is never shown as saved');
});

test('the boards read every page: testers to a thousand, experts to a thousand, and say when they stopped (D1046)', async () => {
  let calls = 0;
  const one = await readAllTesters({ testers: async () => { calls += 1; return { rows: [{ id: calls }], matching: 2, totals: TOTALS }; } });
  assert.deepEqual([one.rows.length, one.complete, calls], [2, true, 2]);
  calls = 0;
  const cut = await readAllTesters({ testers: async () => { calls += 1; return { rows: [{ id: calls }], matching: 5000, totals: TOTALS }; } });
  assert.deepEqual([cut.rows.length, cut.complete, calls], [10, false, 10]);
  const ex = await readAllExperts({ experts: async ({ offset }) => ({ items: offset < 400 ? Array.from({ length: 200 }, (_, i) => ({ uid: `${offset}-${i}` })) : [{ uid: 'last' }], total: 401 }) });
  assert.deepEqual([ex.items.length, ex.total], [401, 401]);
  assert.equal(oldestApproved({ items: [{ reviewed_at: '2026-10-10 09:00:00' }], total: 1 }, Date.parse('2026-10-21T09:00:00Z')), '11 d 0 h');
  assert.equal(oldestApproved({ items: [{ reviewed_at: '2026-10-10 09:00:00' }], total: 30 }), null, 'not every approval is on the page');
});

test('mounted, Product testers (APR4): five tabs with counts, the facts, intake paused, three tiles, the chart, the table; nothing is a 0 for a gap', async () => {
  const v = await board('/admin/approvals/product-testers', testerRoute());
  try {
    assert.match(v.of('approvals-board-header'), /Approvals.*Product testers.*New lane/s);
    assert.match(v.of('testers-tab-waiting'), /Waiting\s*2/);
    assert.match(v.of('testers-tab-active'), /Active\s*1/);
    assert.match(v.of('testers-tab-removed'), /Removed\s*0/);
    assert.match(v.of('testers-facts'), /Admins cannot apply/);
    assert.match(v.of('testers-intake-paused'), /Member intake is paused\. Nobody can apply now\./);
    assert.match(v.of('testers-tile-waiting'), /Waiting\s*2\s*oldest/);
    assert.match(v.of('testers-tile-active'), /Active testers\s*1/);
    assert.match(v.of('testers-tile-in-program'), /In a testing program now\s*1/);
    assert.match(v.props('testers-chart-bars')['aria-label'], /^Applications to test products in the last 12 weeks: /);
    assert.match(v.of('tester-1'), /Gus Demo\s*gus@example\.com\s*Investor.*3 hours a week\s*Given · v2\s*Approved\s*Verified/s);
    assert.match(v.of('tester-3'), /Ben Sample.*Not given.*! Not given.*! Not verified/s);
    assert.ok(!v.has('tester-2'), 'an active tester is not on Waiting');
    assert.ok(gets(v, '/api/admin/product-testers?').some((p) => p.includes('in_programme=yes')), 'the in-program tile is the Worker\'s count');
  } finally { await v.unmount(); }
  const failed = await board('/admin/approvals/product-testers/active', async (path) => (path === '/api/admin/product-testers' ? json({ code: 'product_testers_unreadable' }, 503) : null));
  try {
    assert.match(failed.of('testers-failed'), /could not be read\. That is not the same as having none\./);
    assert.match(failed.of('testers-tab-active'), /Active\s*—/);
    assert.match(failed.of('testers-tile-active'), /Active testers\s*—/);
  } finally { await failed.unmount(); }
});

test('mounted, a tester (APR5): the row opens their address over the board; A approves, says who is told and what is recorded, and the board reads again', async () => {
  const v = await board('/admin/approvals/product-testers', testerRoute());
  try {
    await v.click('tester-open-1');
    assert.equal(v.at.path, '/admin/approvals/product-testers/1');
    assert.match(v.of('tester-drawer-content'), /Investor.*Applied\s*17 Oct 2026.*Email\s*Verified\s*gus@example\.com.*What do you want to test\?\s*B2B tools for small funds\..*Email consent: given on 17 Oct 2026, version v2\..*Product Alpha · picked.*Approved by Admin B · 14 Aug 2026/s);
    assert.ok(v.has('testers-tab-waiting'), 'the board stays under the drawer');
    assert.ok(v.has('tester-assign'), 'Assign is the inbox\'s');
    assert.equal(v.props('tester-assign').href, '/admin/approvals/items/product_testers-1');
    await v.click('tester-action-approve');
    assert.match(v.of('tester-dialog-approve-told'), /They are told by email and in their inbox\./);
    assert.match(v.of('tester-dialog-approve-recorded'), /Recorded in their history: who approved them and when/);
    const before = gets(v, '/api/admin/product-testers?').length;
    await v.change('tester-dialog-note', 'Strong fit');
    await v.click('tester-dialog-approve-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/product-testers/1/approve', body: { note: 'Strong fit', reason: null } }]);
    assert.match(v.of('board-done'), /Gus Demo is a product tester now\. They are told\./);
    assert.ok(!v.has('tester-dialog-approve'), 'the dialog closes');
    assert.ok(gets(v, '/api/admin/product-testers?').length > before, 'the board reads again');
    await v.click('tester-drawer-close');
    assert.equal(v.at.path, '/admin/approvals/product-testers', 'closing returns to the tab it came from');
    assert.ok(!v.has('tester-drawer-content'));
  } finally { await v.unmount(); }
});

test('mounted, a tester: an unverified email is refused before sending (APR5r); B needs a reason they see; a refusal is the Worker\'s sentence', async () => {
  let v = await board('/admin/approvals/product-testers/3', testerRoute());
  try {
    await v.click('tester-action-approve');
    assert.match(v.of('tester-dialog-approve-blocked'), /Ben Sample’s email is not verified, so they cannot be told\. Ask them to verify it first\./);
    assert.equal(v.props('tester-dialog-approve-send').disabled, true);
    assert.deepEqual(v.posts, []);
  } finally { await v.unmount(); }
  v = await board('/admin/approvals/product-testers/1', testerRoute({ decide: () => json({ code: 'tester_changed', message: 'This tester changed while you were looking at it. Reload and try again.' }, 409) }));
  try {
    await v.click('tester-action-decline');
    assert.match(v.of('tester-dialog-decline'), /Decline Gus Demo’s application\?.*They can apply again after 90 days\./s);
    await v.change('tester-dialog-reason', 'Too short');
    assert.equal(v.props('tester-dialog-decline-send').disabled, true, 'nine characters is not a reason');
    await v.change('tester-dialog-reason', 'We are full for this quarter.');
    await v.click('tester-dialog-decline-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/product-testers/1/decline', body: { note: null, reason: 'We are full for this quarter.' } }]);
    assert.match(v.of('tester-dialog-decline-refused'), /This tester changed while you were looking at it/);
    assert.ok(!v.has('board-done'), 'a refusal is never shown as done');
  } finally { await v.unmount(); }
});

test('mounted, a tester: C pauses or removes an active tester, with a reason; a removal says the places it ended; a missing tester says so', async () => {
  const v = await board('/admin/approvals/product-testers/2', testerRoute());
  try {
    assert.match(v.of('tester-drawer-content'), /Advisor/);
    await v.click('tester-action-pause-remove');
    assert.match(v.of('tester-dialog-pause-remove'), /Pause or remove Eva Demo\?.*Pause: no new programs; current ones carry on.*Remove: they leave the pool; their open program places end/s);
    await v.change('tester-choice-remove');
    await v.change('tester-dialog-reason', 'Left the company.');
    assert.match(v.of('tester-dialog-pause-remove-send'), /Remove/);
    await v.click('tester-dialog-pause-remove-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/product-testers/2/remove', body: { note: null, reason: 'Left the company.' } }]);
    assert.match(v.of('board-done'), /Eva Demo is removed from the pool, and 2 open program places ended\./);
  } finally { await v.unmount(); }
  const fromActive = await board('/admin/approvals/product-testers/active', testerRoute());
  try {
    await fromActive.click('tester-open-2');
    assert.equal(fromActive.at.path, '/admin/approvals/product-testers/2');
    assert.ok(fromActive.has('tester-2') && fromActive.has('tester-drawer-content'), 'the Active tab stays under the drawer it opened');
    await fromActive.click('tester-drawer-close');
    assert.equal(fromActive.at.path, '/admin/approvals/product-testers/active');
  } finally { await fromActive.unmount(); }
  const gone = await board('/admin/approvals/product-testers/99', testerRoute());
  try { assert.match(gone.of('tester-drawer-missing'), /No product tester has that number\./); } finally { await gone.unmount(); }
});

const PITCHES = {
  proposed: [{ uid: 'p1', title: 'Hiring your first engineer', asset_type: 'webinar', partner_company: 'Partner A', created_at: '2026-10-18 13:00:00', proposed_date: '2026-11-14', target_audience: 'Seed founders, Europe' }],
  approved: [{ uid: 'p2', title: 'Fundraising in a down market', asset_type: 'podcast', partner_company: 'Firm Name', attribution_code: 'CM-7Q2K', reviewed_at: '2026-10-10 09:00:00', attribution_30d: { visit: 0 } }],
  published: [{ uid: 'p3', title: 'Seed pricing', asset_type: 'webinar', partner_company: 'Partner A', attribution_30d: { visit: 188, signup: 4, lead: 2, conversion: 1 } }],
};
const pitchRoute = (over = {}) => async (path, q, method, body) => {
  if (path === '/api/comarketing/admin/queue') {
    const st = q.get('status');
    if (over.failState === st) return json({ code: 'queue_unreadable' }, 503);
    const items = PITCHES[st] || [];
    return json({ items, total: items.length, limit: Number(q.get('limit')), offset: Number(q.get('offset')), attribution_30d: st === 'published' ? { visit: 412, signup: 9, lead: 3, conversion: 1 } : { visit: 0, signup: 0 } });
  }
  const m = /^\/api\/comarketing\/admin\/pitches\/([^/]+)(?:\/(\w+))?$/.exec(path);
  if (m && method === 'POST') return over.decide ? over.decide(m[2], body) : json({ ok: true });
  if (m) {
    const p = Object.values(PITCHES).flat().find((x) => x.uid === decodeURIComponent(m[1]));
    return p ? json({ ...p, status: Object.keys(PITCHES).find((k) => PITCHES[k].includes(p)), summary: 'A one-hour webinar.', angle: 'The first hire sets the bar', what_you_bring: 'Two hiring managers', distribution_channels: 'Webinar, newsletter', created_at: '2026-10-18 13:00:00', decided: null })
      : json({ code: 'pitch_not_found', message: 'That pitch does not exist.' }, 404);
  }
  return null;
};

test('mounted, Co-marketing (APR6): five states read alone and paged, the tiles over 30 days, a failed state a dash; the pitch opens over the board', async () => {
  const v = await board('/admin/approvals/co-marketing', pitchRoute({ failState: 'withdrawn' }));
  try {
    assert.equal(gets(v, '/api/comarketing/admin/queue').length, 5);
    assert.ok(gets(v, '/api/comarketing/admin/queue').every((p) => /limit=25/.test(p) && /offset=0/.test(p)), 'part 5\'s pages');
    assert.match(v.of('pitches-tab-proposed'), /Proposed\s*1/);
    assert.match(v.of('pitches-tab-withdrawn'), /Withdrawn\s*—/, 'a failed state is a dash, never 0');
    assert.match(v.of('pitches-tile-visits'), /Visits from published pitches, 30 days\s*412/);
    assert.match(v.of('pitches-tile-signups'), /Sign-ups\s*9\s*from published pitches, 30 days/);
    assert.match(v.of('pitches-tile-approved'), /Approved, not yet published\s*1\s*oldest/);
    assert.match(v.of('pitch-p1'), /Hiring your first engineer\s*Webinar\s*Partner A\s*14 Nov 2026\s*Seed founders, Europe/);
    await v.click('pitch-open-p1');
    assert.equal(v.at.path, '/admin/approvals/co-marketing/p1');
    assert.match(v.of('pitch-drawer-content'), /Summary\s*A one-hour webinar\..*Angle\s*The first hire sets the bar.*What they bring\s*Two hiring managers.*Attribution code: issued on approval\..*Proposed by Partner A · 18 Oct 2026/s);
    await v.click('pitch-action-approve');
    assert.match(v.of('pitch-dialog-approve'), /Approve Partner A’s pitch\?.*An attribution code is issued.*Partner A is told by email and in their inbox\..*Recorded on the pitch: who approved it and when\./s);
    await v.click('pitch-dialog-approve-send');
    assert.deepEqual(v.posts, [{ path: '/api/comarketing/admin/pitches/p1/approve', body: { notes: null } }]);
    assert.match(v.of('board-done'), /Hiring your first engineer is approved, with an attribution code\. The partner is told\./);
  } finally { await v.unmount(); }
});

test('mounted, Co-marketing (APR7): Decline needs a reason they see; Publish needs an https link and sends it', async () => {
  let v = await board('/admin/approvals/co-marketing/p1', pitchRoute());
  try {
    await v.click('pitch-action-reject');
    await v.change('pitch-dialog-notes', 'Short');
    assert.equal(v.props('pitch-dialog-reject-send').disabled, true);
    await v.change('pitch-dialog-notes', 'Not a fit for this quarter.');
    await v.click('pitch-dialog-reject-send');
    assert.deepEqual(v.posts, [{ path: '/api/comarketing/admin/pitches/p1/reject', body: { notes: 'Not a fit for this quarter.' } }]);
  } finally { await v.unmount(); }
  v = await board('/admin/approvals/co-marketing/approved', pitchRoute());
  try {
    assert.match(v.of('pitch-p2'), /Fundraising in a down market.*Firm Name\s*CM-7Q2K\s*0\s*10 Oct 2026/s);
    await v.click('pitch-publish-p2');
    await v.change('pitch-dialog-url', 'http://example.com/ep');
    assert.equal(v.props('pitch-dialog-publish-send').disabled, true, 'http is not enough');
    assert.match(v.of('pitch-dialog-url-bad'), /complete https address/);
    await v.change('pitch-dialog-url', 'https://example.com/ep');
    await v.click('pitch-dialog-publish-send');
    assert.deepEqual(v.posts, [{ path: '/api/comarketing/admin/pitches/p2/publish', body: { published_url: 'https://example.com/ep', notes: null } }]);
    assert.match(v.of('board-done'), /is published\. The partner is told\./);
  } finally { await v.unmount(); }
});

const EXPERTS = [
  { uid: 'e1', name: 'Expert A', headline: 'Founder coach', bio: 'Coaches first-time founders.', decision_state: 'pending', profile_completion_pct: 92, review_version: 3, created_at: '2026-10-19 07:00:00', credentials: { licence_number: 'WB-4821', issuer: 'Board Name', expires_on: '2028-03-31', files: [{ uid: 'f1', file_name: 'Licence.pdf', url: '/api/wellbeing/experts/credentials/files/f1' }] } },
  { uid: 'e2', name: 'Expert B', decision_state: 'pending', profile_completion_pct: 74, review_version: 1, created_at: '2026-10-20 07:00:00', credentials: { licence_number: 'OLD-1', expires_on: '2020-01-01', files: [] } },
  { uid: 'e3', name: 'Expert C', decision_state: 'declined', profile_completion_pct: 80, review_version: 2, decline_reason: 'Add a licence.', credentials: { files: [] } },
  { uid: 'e4', name: 'Expert D', decision_state: 'verified', verified: true, hidden: true, review_version: 5, credentials: { files: [] } },
];
const expertRoute = (over = {}) => async (path, q, method, body) => {
  if (path === '/api/wellbeing/admin/experts') return over.list ? over.list(q) : json({ items: EXPERTS, total: EXPERTS.length, limit: 200, offset: 0 });
  const r = /^\/api\/wellbeing\/admin\/experts\/([^/]+)\/(review|verify|hide|decline)$/.exec(path);
  if (r && method === 'POST') return json({ ok: true });
  if (r) { const e = EXPERTS.find((x) => x.uid === r[1]); return e ? json({ expert: e, history: [] }) : json({ code: 'expert_not_found' }, 404); }
  const pub = /^\/api\/wellbeing\/experts\/([^/]+)$/.exec(path);
  if (pub) return pub[1] === 'e1' ? json({ uid: 'e1', categories: ['Coaching'], languages: ['English', 'Portuguese'], timezones: ['Europe/Lisbon'], hourly_rate_usd: 120, booking_url: 'https://book.example.com' }) : json({ detail: 'Expert not found' }, 404);
  return null;
};

test('mounted, Wellbeing experts (APR8): five tabs with Declined, the tiles, the credentials column; a short read draws no counts', async () => {
  let v = await board('/admin/approvals/wellbeing-experts', expertRoute());
  try {
    assert.ok(gets(v, '/api/wellbeing/admin/experts').some((p) => /state=all/.test(p) && /limit=200/.test(p)));
    assert.match(v.of('experts-tab-verify'), /To verify\s*2/);
    assert.match(v.of('experts-tab-declined'), /Declined\s*1/);
    assert.match(v.of('experts-tab-hidden'), /Hidden\s*1/);
    assert.match(v.of('experts-tile-verify'), /To verify\s*2\s*oldest/);
    assert.match(v.of('expert-e1'), /Expert A\s*Founder coach\s*92%\s*Licence and 1 file/);
    assert.match(v.of('expert-e2'), /Expert B.*Licence/s);
  } finally { await v.unmount(); }
  v = await board('/admin/approvals/wellbeing-experts/declined', expertRoute());
  try { assert.match(v.of('expert-e3'), /Expert C.*! None given/s); } finally { await v.unmount(); }
  v = await board('/admin/approvals/wellbeing-experts', expertRoute({ list: (q) => json({ items: q.get('offset') === '0' ? EXPERTS.slice(0, 1) : [], total: 80 }) }));
  try {
    assert.match(v.of('experts-tab-verify'), /To verify\s*—/);
    assert.match(v.of('experts-tile-verify'), /To verify\s*—/);
    assert.match(v.of('experts-partial'), /first 1 of 80/);
  } finally { await v.unmount(); }
});

test('mounted, an expert (APR8d, APR8a, APR8b): credentials and profile; Verify needs "I checked their credentials" and sends the version; Decline needs a reason; an expired licence is refused first', async () => {
  let v = await board('/admin/approvals/wellbeing-experts/e1', expertRoute());
  try {
    assert.match(v.of('expert-drawer-content'), /92% complete\s*Coaching.*Languages\s*English, Portuguese.*Pricing\s*\$120 an hour.*Licence number WB-4821 · issued by Board Name · expires 31 Mar 2028.*Licence\.pdf/s);
    assert.equal(v.props('expert-file-f1').href, '/api/wellbeing/experts/credentials/files/f1');
    await v.click('expert-action-verify');
    assert.equal(v.props('expert-dialog-verify-send').disabled, true, 'not until they say they checked');
    assert.match(v.of('expert-dialog-verify-recorded'), /that you checked their credentials \(review version 3\)/);
    await v.change('expert-dialog-checked', null, true);
    await v.click('expert-dialog-verify-send');
    assert.deepEqual(v.posts, [{ path: '/api/wellbeing/admin/experts/e1/verify', body: { verified: true, credentials_checked: true, expected_version: 3 } }]);
    assert.match(v.of('board-done'), /Expert A is verified and listed\. They are told\./);
    await v.click('expert-action-decline');
    await v.change('expert-dialog-reason', 'Please add your licence.');
    await v.click('expert-dialog-decline-send');
    assert.deepEqual(v.posts.at(-1), { path: '/api/wellbeing/admin/experts/e1/decline', body: { reason: 'Please add your licence.' } });
    await v.click('expert-action-hide');
    await v.click('expert-dialog-hide-send');
    assert.deepEqual(v.posts.at(-1), { path: '/api/wellbeing/admin/experts/e1/hide', body: { hidden: true } });
  } finally { await v.unmount(); }
  v = await board('/admin/approvals/wellbeing-experts/e2', expertRoute());
  try {
    assert.match(v.of('expert-expired'), /This credential expired on 1 Jan 2020\./);
    assert.match(v.of('expert-profile-none'), /No active directory profile/);
    await v.click('expert-action-verify');
    await v.change('expert-dialog-checked', null, true);
    assert.match(v.of('expert-dialog-verify-blocked'), /The recorded credential has expired\. Ask the expert to update it\./);
    assert.equal(v.props('expert-dialog-verify-send').disabled, true);
  } finally { await v.unmount(); }
  v = await board('/admin/approvals/wellbeing-experts/e4', expertRoute());
  try {
    assert.ok(!v.has('expert-action-verify') && !v.has('expert-action-hide'), 'a hidden expert can only be restored');
    await v.click('expert-action-restore');
    await v.click('expert-dialog-restore-send');
    assert.deepEqual(v.posts, [{ path: '/api/wellbeing/admin/experts/e4/hide', body: { hidden: false } }]);
  } finally { await v.unmount(); }
});

test('the retired doors: Co-marketing has no Review queue and points here; the Wellbeing roster decides nothing and points here; no board uses alert or confirm', () => {
  const cm = read('frontend/src/pages/CoMarketingPage.jsx');
  assert.ok(!cm.includes("label: 'Review queue'") && !cm.includes('function AdminView') && !cm.includes('approveCoMarketingPitch'), 'the Review queue is retired');
  assert.ok(cm.includes('<Link to="/admin/approvals/co-marketing"'));
  const wb = read('frontend/src/pages/admin/consoles/WellbeingConsole.jsx');
  assert.ok(!/wellbeingAdmin(Verify|Hide)/.test(wb), 'the roster decides nothing');
  assert.ok(wb.includes('<Link to={`/admin/approvals/wellbeing-experts/${encodeURIComponent(e.uid)}`}'));
  for (const f of ['TesterBoard.jsx', 'PitchBoard.jsx', 'ExpertBoard.jsx', 'boardParts.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/admin/approvals/${f}`), /window\.(alert|confirm)|\balert\(|\bconfirm\(/, f);
  }
  // Every item link is a literal template one segment past its board, which the reachability walk resolves.
  assert.ok(read('frontend/src/pages/admin/approvals/TesterBoard.jsx').includes('to={`/admin/approvals/product-testers/${r.id}`}'));
  assert.ok(read('frontend/src/pages/admin/approvals/PitchBoard.jsx').includes('to={`/admin/approvals/co-marketing/${encodeURIComponent(r.key)}`}'));
  assert.ok(read('frontend/src/pages/admin/approvals/ExpertBoard.jsx').includes('to={`/admin/approvals/wellbeing-experts/${encodeURIComponent(r.key)}`}'));
});

// ---------------------------------------------------------------- the wiring

test('the routes under one guard, the redirect, the row lit on every sub-path, and the canvas in design/incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/approvals', '/admin/approvals/lanes', '/admin/approvals/decided', '/admin/approvals/items/:ref']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <AdminApprovals />)} />`), p);
  }
  for (const p of ['/admin/approvals/product-testers', '/admin/approvals/co-marketing', '/admin/approvals/co-marketing/declined', '/admin/approvals/wellbeing-experts/hidden',
    // D1046: the testers' tabs, wellbeing's Declined, and one item's address on each board.
    '/admin/approvals/product-testers/active', '/admin/approvals/product-testers/paused', '/admin/approvals/product-testers/declined', '/admin/approvals/product-testers/removed',
    '/admin/approvals/wellbeing-experts/declined', '/admin/approvals/product-testers/:item', '/admin/approvals/co-marketing/:item', '/admin/approvals/wellbeing-experts/:item']) {
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

// ------------------------------------------------------------------ D1047 (#2895): the phone (APR15) and dark (APR16)

test('D1047: a phone card\'s age pill and the Filters count, from the rows and the address', () => {
  const [kyc, dd, jobs] = inboxRows(INBOX);
  assert.deepEqual(cardAge(kyc), { text: '4 d 7 h · Over 72 hours', tone: 'bad' });
  assert.deepEqual(cardAge(dd), { text: '1 d 6 h · 24 to 72 hours', tone: 'warn' });
  assert.deepEqual(cardAge(jobs), { text: 'Age not recorded', tone: null }, 'no band for an age it does not know');
  assert.deepEqual(cardAge({ age: '3 h', band: { key: 'ok', label: 'Under 24 hours', tone: null } }), { text: '3 h', tone: null }, 'under 24 hours has no band');
  assert.equal(filterCount(inboxQueryOf('?group=people&age=past&sort=newest&q=ab').filters), 3, 'the order is not a filter');
  assert.equal(filterCount(inboxQueryOf('?q=a').filters), 0, 'one search character does not filter');
  assert.equal(filterCount({}), 0);
  assert.equal(sortLabel(undefined), 'Waiting longest');
  assert.equal(sortLabel('who'), 'Who');
});

test('D1047 (APR15a): on a phone the inbox is cards — lane, who, what, the age pill and where it is decided — and the table is above md', async () => {
  const v = await mount('/admin/approvals', h(AdminApprovals));
  try {
    assert.deepEqual(v.ids('approvals-card-').filter((x) => /^approvals-card-[a-z_]+:\d+$/.test(x)), ['approvals-card-kyc:41', 'approvals-card-due_diligence:9', 'approvals-card-jobs:3']);
    assert.match(v.of('approvals-card-kyc:41'), /KYC\s*Person A\s*Identity check\s*4 d 7 h · Over 72 hours\s*Decided on KYC & KYB ›/);
    assert.equal(v.of('approvals-card-age-jobs:3'), 'Age not recorded');
    assert.equal(v.props('approvals-card-open-kyc:41').href, '/admin/approvals/items/kyc-41');
    assert.match(v.props('approvals-cards').className, /\bmd:hidden\b/);
    assert.match(v.props('approvals-tiles').className, /\bgrid-cols-2\b/, 'the tiles are two by two');
    assert.match(v.props('approvals-card-more-kyc:41').className, /\bh-11 w-11\b/, 'the ⋯ is 44 by 44');
    await v.click('approvals-card-more-kyc:41');
    assert.ok(v.has('approvals-row-sheet'));
    assert.equal(v.props('approvals-row-sheet-layer')['data-phone'], 'sheet', '⋯ is a bottom sheet');
    assert.equal(v.props('approvals-row-sheet-open').href, '/admin/approvals/items/kyc-41');
    await v.click('approvals-row-sheet-assign');
    assert.ok(!v.has('approvals-row-sheet'), 'the sheet closes');
    assert.ok(v.has('approvals-assign'), 'Assign… opens its dialog');
  } finally { await v.unmount(); }
});

test('D1047 (APR15b): Filters with its count and Sort open one bottom sheet; each choice lands in the address; Clear empties it', async () => {
  const v = await mount('/admin/approvals?age=past', h(AdminApprovals));
  try {
    assert.match(v.props('approvals-filters').className, /\bhidden\b.*\bsm:flex\b/, 'the desktop filters are not drawn on a phone');
    assert.match(v.props('approvals-phone-filters').className, /\bsm:hidden\b/);
    assert.equal(v.of('approvals-filters-count'), '1');
    assert.equal(v.of('approvals-sort-open'), 'Sort: Waiting longest ▾');
    await v.click('approvals-filters-open');
    assert.equal(v.props('approvals-filters-sheet-layer')['data-phone'], 'sheet');
    assert.match(v.of('approvals-filters-sheet'), /Filters and sort.*Search.*Group.*Lane.*Age.*Assigned.*Sort/s);
    assert.equal(v.of('approvals-filters-done'), 'Show 123');
    await v.change('approvals-sheet-lane', 'kyc');
    assert.match(v.at.path, /lane=kyc/);
    assert.match(v.at.path, /age=past/);
    assert.equal(v.of('approvals-filters-count'), '2');
    assert.ok(v.has('approvals-filters-sheet'), 'the sheet stays open while choosing');
    await v.change('approvals-sheet-sort', 'who');
    assert.match(v.at.path, /sort=who/);
    assert.equal(v.of('approvals-filters-count'), '2', 'the order does not count');
    await v.click('approvals-filters-clear');
    assert.equal(v.at.path, '/admin/approvals');
    await v.click('approvals-filters-done');
    assert.ok(!v.has('approvals-filters-sheet'));
  } finally { await v.unmount(); }
});

test('D1047 (APR15c): a board\'s drawer has "‹ [lane]" back on a phone; dialog and drawer buttons are full width', async () => {
  const v = await board('/admin/approvals/product-testers/1', testerRoute());
  try {
    assert.equal(v.of('tester-drawer-back'), '‹ Product testers');
    assert.match(v.props('tester-drawer-back').className, /\bmin-h-\[44px\].*\bsm:hidden\b/);
    await v.click('tester-drawer-back');
    assert.equal(v.at.path, '/admin/approvals/product-testers', 'back is the board it came from');
  } finally { await v.unmount(); }
  const parts = read('frontend/src/pages/admin/approvals/boardParts.jsx');
  assert.match(parts, /export const FOOT = 'flex justify-end gap-2 max-sm:\*:flex-1';/);
  assert.match(parts, /<div className=\{FOOT\}>\s*<button type="button" className=\{BTN\} onClick=\{onClose\} data-testid=\{`\$\{testId\}-cancel`\}>/, 'the decision dialog\'s buttons');
  for (const [f, label] of [['TesterBoard', 'Product testers'], ['PitchBoard', 'Co-marketing'], ['ExpertBoard', 'Wellbeing experts']]) {
    const src = read(`frontend/src/pages/admin/approvals/${f}.jsx`);
    assert.ok(src.includes(`<PhoneBack label="${label}" onClose={onClose}`), f);
    assert.ok(src.includes('<div className={`${FOOT} flex-wrap items-center`}>'), `${f}: the drawer's buttons`);
  }
  assert.ok(read('frontend/src/pages/admin/approvals/AdminApprovals.jsx').includes('<PhoneBack label="Approvals" onClose={onClose} testId="approvals-item-back" />'), 'the item drawer too');
});

test('D1047: every tap target on a phone is at least 44 by 44', () => {
  const page = read('frontend/src/pages/admin/approvals/AdminApprovals.jsx');
  const parts = read('frontend/src/pages/admin/approvals/boardParts.jsx');
  for (const name of ['CHIP', 'BTN', 'BTN_PRIMARY', 'SELECT']) {
    const m = new RegExp(`const ${name} = '([^']+)'`).exec(page);
    assert.ok(m && /\bmin-h-\[44px\]/.test(m[1]) && /\bsm:min-h-\[3[46]px\]/.test(m[1]), `AdminApprovals ${name}: ${m?.[1]}`);
  }
  for (const name of ['BTN', 'BTN_PRIMARY', 'BTN_DANGER', 'SELECT']) {
    const m = new RegExp(`export const ${name} = '([^']+)'`).exec(parts);
    assert.ok(m && /\bmin-h-\[44px\]/.test(m[1]), `boardParts ${name}: ${m?.[1]}`);
  }
  assert.match(page, /const SHEET_ITEM = 'flex min-h-\[44px\]/);
});

test('D1047 (APR16): dark — the guard is green, and every status pill keeps its own dark pair', () => {
  execFileSync(process.execPath, ['scripts/check-dark-mode.mjs'], { stdio: 'pipe' });
  const page = read('frontend/src/pages/admin/approvals/AdminApprovals.jsx');
  const pills = /const PILL = \{([\s\S]*?)\n\};/.exec(page)[1];
  for (const tone of ['warn', 'bad', 'good', 'plain']) {
    const line = new RegExp(`${tone}: '([^']+)'`).exec(pills)[1];
    for (const kind of ['border', 'bg', 'text']) assert.match(line, new RegExp(`\\bdark:${kind}-`), `${tone} has dark:${kind}`);
  }
  const parts = read('frontend/src/pages/admin/approvals/boardParts.jsx');
  const warn = /export const WARN_PILL = '([^']+)'/.exec(parts)[1];
  for (const kind of ['border', 'bg', 'text']) assert.match(warn, new RegExp(`\\bdark:${kind}-`), `WARN_PILL has dark:${kind}`);
});
