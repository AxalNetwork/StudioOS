/**
 * D953 (#2371) — Admin › Programs: the catalogue at /admin/programs, one page
 * per program with its tabs as sub-paths, and the blocks whose reads exist,
 * each drawn truthfully.
 *
 * What this file holds the pages to:
 *   · the addresses, the three redirects (query, hash and moved notice kept),
 *     and every wiring place D953 §1 names;
 *   · Waiting for you: the four readable queues, "Could not be read" when any
 *     fails, "at least" at R3's cap, a real 0 on first use;
 *   · Refer & Earn's oldest and Overdue from R1's referrals lane, and its
 *     "Could not be read" when that lane is null while the R8 counts stand;
 *   · S-CNT and S-COV: demoted holders, postponed and scheduled cycles;
 *   · Learning counts published rows only; Perks counts `in_review` only,
 *     prices "No credit cost" and keeps the stored note on Approve;
 *   · the commissions door for a Super Admin only, refusals by code, Guard L;
 *   · mounted against a stubbed Worker: each failed read marks only its own
 *     blocks.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_programs_d953.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import { ADMIN_BOARDS } from '../src/lib/railOptions/admin.js';
import { ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import { LANE_CONSOLES, NO_QUEUE_CONSOLES } from '../src/pages/admin/adminStudioOverview.js';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import ProgramsCatalogue from '../src/pages/admin/programs/ProgramsCatalogue.jsx';
import MentorCohortAccess from '../src/pages/admin/programs/MentorCohortAccess.jsx';
import ReferAndEarn from '../src/pages/admin/programs/ReferAndEarn.jsx';
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import HeldProgramsRedirect from '../src/pages/admin/programs/HeldProgramsRedirect.jsx';
import AdvisorCohortsRedirect from '../src/pages/admin/programs/AdvisorCohortsRedirect.jsx';
import ReferEarnRedirect from '../src/pages/admin/programs/ReferEarnRedirect.jsx';
import {
  ACTIVE_MENTORS_LINE, ASSIGNED_LINE, CAPS, FROZEN, HQ_READS_COMMISSIONS, LINE_ADMIN, LINE_SUPER, MOVED_NOTICES, NOTHING_WAITING,
  NOT_READ_YET, NOT_RECORDED, PAGES, PERK_APPROVED, PROGRAMS, PRODUCT_TESTING_FOOT, SCOPE_LABEL, SCOPE_NOT_PER_STUDIO,
  SCOPE_TITLE, SCOPE_UNREAD, SUSPENDED, TRY_AGAIN, WAITING_LABEL, ageText, approveBody, bandOf, cohortName, cycleForStrip,
  etStamp, laneFrom, learningFigures, learningJoin, mentorFigures, mentorNeeds, movedNotice, openReferrals, perkPrice,
  perkQueueFrom, referralOverview, refusalText, rejectBody, routeFor, scopeChip, waitingForYou, weekLines, withoutMoved,
} from '../src/pages/admin/programs/programsModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const NOW = Date.now();
const H = 3_600_000;
const d1 = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends
 * ------------------------------------------------------------------ */

const ready = (data) => ({ status: 'ready', data, error: null, at: NOW });
const failed = (error = { status: 503 }) => ({ status: 'error', data: null, error, at: null });
const loading = () => ({ status: 'loading', data: null, error: null, at: null });

// R1 — one lane of `approvals.lanes` (`queuePressure`).
const lane = (key, count, oldest = null, sla = 'ok') => ({ key, label: key, count, oldest_age_hours: oldest, sla });
const glanceBody = (lanes) => ({ tier: 'hq', approvals: { recorded: true, lanes } });
// R2 — `GET /api/admin/lab-hosts?status=pending`.
const hostsBody = (pending, approved, items = []) => ({ status: 'pending', items, counts: { pending, approved, rejected: 0, withdrawn: 0, revoked: 0 } });
const host = (i, ageH) => ({ uid: `h${i}`, status: 'pending', created_at: d1(NOW - ageH * H), applicant_name: `Host ${i}` });
// R3 — a perk row (`p.*`).
const perk = (uid, status, o = {}) => ({
  uid, status, offer: `Offer ${uid}`, partner_name: `Partner ${uid}`, kind: 'credits', credits: 100, required_tier: null, price_cents: null,
  review_note: null, created_at: d1(NOW - 30 * H), updated_at: d1(NOW - 5 * H), ...o,
});
// R5 — an assignment row.
const assignment = (id, advisor, cycle, o = {}) => ({
  id, uid: `a${id}`, advisor_user_id: advisor, cohort_cycle_id: cycle, assigned_at: '2026-10-01 10:00:00', unassigned_at: null,
  is_active: true, note: null, advisor_name: `Mentor ${advisor}`, advisor_email: `m${advisor}@example.com`, advisor_role: 'advisor', advisor_is_active: true, ...o,
});
// R7 — a cycle.
const cycle = (id, year, month, status, appStatus = 'open', windows = []) => ({
  id, year, month, status, app_status: appStatus, start_at: new Date(Date.UTC(year, month - 1, 1, 5)).toISOString(),
  end_at: new Date(Date.UTC(year, month - 1, 29, 5)).toISOString(), windows,
});
// R8 — a referral (`toWire` plus the referrer's name and email).
const referral = (uid, status, ageH, o = {}) => ({
  uid, category: 'startup', category_name: 'Startup or founder', referred_name: `Referred ${uid}`, referred_org: null, status,
  created_at: d1(NOW - ageH * H), updated_at: d1(NOW - ageH * H), referrer_name: `Referrer ${uid}`, referrer_email: `r${uid}@example.com`, ...o,
});
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

// The mentor fixture: one current Advisor on two cycles, a demoted holder, an
// ended row; a running cycle, a scheduled one, a scheduled one with no
// windows and no mentor, a postponed one, a completed one, and a scheduled
// one held only by the demoted holder.
const ROWS = [
  assignment(1, 11, 1, { advisor_role: 'Advisor' }),
  assignment(2, 11, 2),
  assignment(3, 12, 1, { advisor_role: 'investor', advisor_name: 'Ana Former' }),
  assignment(4, 13, 3, { is_active: false, unassigned_at: '2026-10-10 10:00:00' }),
  assignment(5, 12, 6, { advisor_role: 'investor', advisor_name: 'Ana Former' }),
];
const CYCLES = [
  cycle(6, 2027, 1, 'scheduled'),
  cycle(3, 2026, 12, 'scheduled'),
  cycle(2, 2026, 11, 'scheduled', 'reviewing', [
    { week_number: 1, unlock_at: '2026-11-01T04:00:00.000Z', deadline_at: '2026-11-08T05:00:00.000Z' },
    { week_number: 2, unlock_at: '2026-11-08T05:00:00.000Z', deadline_at: '2026-11-15T05:00:00.000Z' },
  ]),
  cycle(1, 2026, 10, 'active', 'active'),
  cycle(4, 2026, 9, 'active', 'postponed'),
  cycle(5, 2026, 8, 'completed', 'active'),
];

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the addresses: the catalogue, each program\'s tabs as static sub-paths, and the three moved keys where their redirects land', () => {
  assert.deepEqual(routeFor('/admin/programs'), { program: null, tab: 'catalogue' });
  assert.deepEqual(routeFor('/admin/programs/'), { program: null, tab: 'catalogue' });
  assert.deepEqual(routeFor('/admin/programs/mentor-cohorts'), { program: 'mentor-cohorts', tab: 'overview' });
  assert.deepEqual(routeFor('/admin/programs/mentor-cohorts/people'), { program: 'mentor-cohorts', tab: 'people' });
  assert.deepEqual(routeFor('/admin/programs/refer-and-earn/queue'), { program: 'refer-and-earn', tab: 'queue' });
  assert.deepEqual(routeFor('/admin/programs/refer-and-earn/settings'), { program: 'refer-and-earn', tab: 'settings' });
  assert.deepEqual(routeFor('/admin/programs/perks/queue'), { program: 'perks', tab: 'queue' });
  assert.deepEqual(routeFor('/admin/programs/learning/people'), { program: 'learning', tab: 'people' });
  assert.deepEqual(routeFor('/admin/programs/referral-partners/how-it-runs'), { program: 'referral-partners', tab: 'how' });
  assert.deepEqual(routeFor('/admin/programs/investor-cohorts'), { program: 'investor-cohorts', tab: 'page' });
  assert.deepEqual(routeFor('/admin/programs/ai-native-venture'), { program: 'ai-native-venture', tab: 'page' });
  // A program has only the tabs it has today; one tab is no strip.
  assert.deepEqual(Object.fromEntries(Object.entries(PAGES).map(([k, p]) => [k, p.tabs.map((t) => t.label)])), {
    'mentor-cohorts': ['Overview', 'How it runs', 'People'],
    'refer-and-earn': ['Overview', 'How it runs', 'Queue', 'Settings'],
    perks: ['Overview', 'How it runs', 'Queue'],
    learning: ['Overview', 'How it runs', 'People'],
    'referral-partners': ['Overview', 'How it runs'],
    'investor-cohorts': [],
    'ai-native-venture': [],
  });
  assert.equal(movedNotice('/admin/programs', '?moved=held'), 'Programs has a new address. Update your bookmark.');
  assert.equal(movedNotice('/admin/programs/mentor-cohorts/people', '?moved=advisor-cohorts'), 'Advisor cohort access is now Mentor cohort access, under Programs.');
  assert.equal(movedNotice('/admin/programs/refer-and-earn/queue', '?moved=refer-earn'), 'Referral review is now Refer & Earn, under Programs.');
  assert.equal(movedNotice('/admin/programs/refer-and-earn', '?moved=refer-earn'), null, 'a notice shows only where its redirect lands');
  assert.equal(movedNotice('/admin/programs', '?moved=partners'), null);
  assert.equal(withoutMoved('?moved=held&x=1'), '?x=1');
  assert.equal(withoutMoved('?moved=held'), '');
  assert.equal(PROGRAMS.length, 9, 'S-RUN: nine programs');
  assert.deepEqual(PAGES['mentor-cohorts'].workspace, 'Advisor cohort access');
  assert.deepEqual(PAGES['refer-and-earn'].workspace, 'Referrals');
});

const QUEUES = () => ({
  glance: ready(glanceBody([lane('cohort', 2, 30, 'due_soon'), lane('referrals', 3, 80, 'past')])),
  hosts: ready(hostsBody(1, 4, [host(1, 10)])),
  perkQueue: ready({ items: [perk('p1', 'in_review'), perk('p2', 'draft', { updated_at: d1(NOW - 400 * H) })] }),
});

test('Waiting for you: the four queues, with a draft not counted, the oldest age and an amber Overdue from 72 hours', () => {
  const w = waitingForYou({ ...QUEUES(), now: NOW });
  assert.equal(w.state, 'ready');
  assert.equal(w.total, 2 + 3 + 1 + 1, 'cohort, referrals, one pending host and one in_review listing; the draft is not backlog');
  assert.equal(w.value, '7');
  assert.equal(w.oldest, 'oldest 3 days', 'the referrals lane\'s 80 hours, not the draft\'s 400');
  assert.equal(w.overdue, true);
  const young = waitingForYou({ ...QUEUES(), glance: ready(glanceBody([lane('cohort', 2, 30), lane('referrals', 3, 50)])), now: NOW });
  assert.equal(young.overdue, false, 'under 72 hours is not overdue');
  assert.equal(WAITING_LABEL, 'cohort applications, Refer & Earn reviews, office-hours hosts and perk listings');
});

test('Waiting for you reads "Could not be read" when any one of the four cannot be read, never a smaller total', () => {
  const cases = {
    'cohort applications': { glance: ready(glanceBody([lane('cohort', null), lane('referrals', 3)])) },
    'Refer & Earn reviews': { glance: ready(glanceBody([lane('cohort', 2)])) },
    'office-hours hosts': { hosts: failed() },
    'perk listings': { perkQueue: failed() },
  };
  for (const [what, broken] of Object.entries(cases)) {
    const w = waitingForYou({ ...QUEUES(), ...broken, now: NOW });
    assert.equal(w.state, 'unreadable', what);
    assert.deepEqual(w.failed, [what]);
    assert.equal(w.total, undefined, 'no partial total');
  }
  const glanceDown = waitingForYou({ ...QUEUES(), glance: failed(), now: NOW });
  assert.deepEqual(glanceDown.failed, ['cohort applications', 'Refer & Earn reviews']);
  assert.equal(waitingForYou({ ...QUEUES(), hosts: loading(), now: NOW }).state, 'loading');
});

test('Waiting for you reads "at least [n]" when R3 returns its 200 rows, drafts included; a real 0 says nothing is waiting', () => {
  const full = [...many(150, (i) => perk(`r${i}`, 'in_review')), ...many(50, (i) => perk(`d${i}`, 'draft'))];
  const w = waitingForYou({ ...QUEUES(), perkQueue: ready({ items: full }), now: NOW });
  assert.equal(w.total, 2 + 3 + 1 + 150);
  assert.equal(w.value, 'at least 156');
  assert.equal(w.empty, false);
  const below = waitingForYou({ ...QUEUES(), perkQueue: ready({ items: full.slice(1) }), now: NOW });
  assert.equal(below.value, '155', 'below the cap the count is exact');
  const none = waitingForYou({
    glance: ready(glanceBody([lane('cohort', 0), lane('referrals', 0)])), hosts: ready(hostsBody(0, 4)), perkQueue: ready({ items: [] }), now: NOW,
  });
  assert.deepEqual([none.value, none.empty, none.oldest, none.overdue], ['0', true, null, false]);
});

test('R1: a failed glance, a missing lane and a null count are each unreadable, never a zero', () => {
  assert.equal(laneFrom(failed(), 'cohort').state, 'unreadable');
  assert.equal(laneFrom(ready({}), 'cohort').state, 'unreadable');
  assert.equal(laneFrom(ready(glanceBody([lane('referrals', 1)])), 'cohort').state, 'unreadable');
  assert.equal(laneFrom(ready(glanceBody([lane('cohort', null)])), 'cohort').state, 'unreadable');
  assert.deepEqual(laneFrom(ready(glanceBody([lane('cohort', 0, null)])), 'cohort'), { state: 'ready', count: 0, oldestHours: null, sla: 'ok' });
});

const SETS = (o = {}) => ({
  submitted: ready([referral('s1', 'submitted', 2), referral('s2', 'submitted', 30)]),
  under_review: ready([referral('u1', 'under_review', 80)]),
  more_info_needed: ready([referral('m1', 'more_info_needed', 10)]),
  ...o,
});

test('Refer & Earn: each open status from its own R8 call; the oldest and Overdue from R1\'s referrals lane, "since submitted"', () => {
  const o = referralOverview(SETS(), ready(glanceBody([lane('referrals', 4, 100, 'past')])), NOW);
  assert.deepEqual(Object.fromEntries(Object.entries(o.calls).map(([k, c]) => [k, c.text])), { submitted: '2', under_review: '1', more_info_needed: '1' });
  assert.equal(o.totalText, '4');
  assert.deepEqual(o.bands, { fresh: 2, soon: 1, over: 1, undated: 0 });
  assert.equal(o.bandsCover, null);
  assert.equal(o.oldest, '4 days', 'from the lane\'s 100 hours, not from R8\'s rows (80 hours)');
  assert.equal(o.overdue, true, 'the lane\'s sla is past');
  const due = referralOverview(SETS(), ready(glanceBody([lane('referrals', 4, 100, 'due_soon')])), NOW);
  assert.equal(due.overdue, false, 'Overdue follows the lane\'s sla');
});

test('Refer & Earn: a null referrals lane reads "Could not be read" for the oldest and Overdue, and the R8 counts still stand', () => {
  const o = referralOverview(SETS(), ready(glanceBody([lane('cohort', 2), lane('referrals', null)])), NOW);
  assert.equal(o.lane.state, 'unreadable');
  assert.equal(o.oldest, null);
  assert.equal(o.overdue, false);
  assert.equal(o.state, 'ready');
  assert.equal(o.totalText, '4', 'the counts stand');
  const one = referralOverview(SETS({ under_review: failed() }), ready(glanceBody([lane('referrals', 4, 100, 'past')])), NOW);
  assert.equal(one.state, 'unreadable');
  assert.equal(one.totalText, null, 'no total while a status could not be read');
  assert.equal(one.calls.submitted.text, '2', 'the other statuses stand');
});

test('Guard L on R8: a call at its 200 reads "200+", and the bands say "of the newest 200 in each status"', () => {
  const o = referralOverview(SETS({ submitted: ready(many(200, (i) => referral(`s${i}`, 'submitted', 1))) }), ready(glanceBody([lane('referrals', 260, 10)])), NOW);
  assert.equal(o.calls.submitted.text, '200+');
  assert.equal(o.totalText, '202+');
  assert.equal(o.bandsCover, 'of the newest 200 in each status');
  const merged = openReferrals(SETS());
  assert.deepEqual(merged.rows.map((r) => r.uid), ['s1', 'm1', 's2', 'u1'], 'the open statuses merged newest first');
  assert.equal(merged.capped, false);
  assert.equal(openReferrals(SETS({ more_info_needed: failed() })).state, 'unreadable');
});

test('S-CNT: distinct current Advisors on open rows; a demoted holder and an ended row are not counted', () => {
  const f = mentorFigures(ready({ items: ROWS }), ready({ cycles: CYCLES }));
  assert.equal(f.mentors, 1, 'advisor 11 holds two rows and counts once; the demoted holder reads nothing');
  assert.deepEqual(f.stale.map((r) => r.id), [3, 5], 'open rows whose holder is no longer an Advisor');
  assert.equal(f.capped, false);
  assert.equal(mentorFigures(ready({ items: many(CAPS.assignments, (i) => assignment(i, i, 1)) }), ready({ cycles: [] })).capped, true);
  assert.equal(mentorFigures(failed(), ready({ cycles: CYCLES })).state, 'unreadable');
  assert.equal(mentorFigures(ready({ items: ROWS }), loading()).state, 'loading');
});

test('S-CNT and S-COV leave a deactivated account out (D960): it counts as no mentor and covers no cohort', () => {
  const off = (row) => ({ ...row, advisor_is_active: false });
  const f = mentorFigures(ready({ items: [off(ROWS[0]), ROWS[1], ...ROWS.slice(2)] }), ready({ cycles: CYCLES }));
  assert.equal(f.mentors, 1, 'advisor 11 still holds cycle 2 on an active account');
  const g = mentorFigures(ready({ items: ROWS.map((r) => (r.advisor_user_id === 11 ? off(r) : r)) }), ready({ cycles: CYCLES }));
  const base = mentorFigures(ready({ items: ROWS }), ready({ cycles: CYCLES }));
  assert.equal(g.mentors, 0, 'a deactivated Advisor is not an active mentor');
  assert.equal(g.covered, base.covered - 2, 'the two cycles only advisor 11 covered are uncovered now');
  assert.equal(mentorFigures(ready({ items: [{ ...ROWS[1], advisor_is_active: null }] }), ready({ cycles: [] })).mentors, 0,
    'an account the Worker could not find is not counted either');
});

test('S-COV: scheduled and running cycles count, a postponed one is left out by name, a scheduled one with no windows counts', () => {
  const f = mentorFigures(ready({ items: ROWS }), ready({ cycles: CYCLES }));
  assert.equal(f.total, 4, 'October (running), November, December and January (scheduled); not the postponed September or the completed August');
  assert.equal(f.covered, 2, 'October and November; January is held only by a demoted holder');
  assert.deepEqual(f.uncovered.map((c) => c.id), [6, 3]);
  const needs = mentorNeeds(f).map((n) => n.text);
  assert.deepEqual(needs, [
    'January 2027 starts 1 Jan with no mentor.',
    'December 2026 starts 1 Dec with no mentor.',
    'Ana Former is no longer an Advisor. Their access is already refused, but the assignment is still open.',
    'Ana Former is no longer an Advisor. Their access is already refused, but the assignment is still open.',
  ]);
  const running = mentorFigures(ready({ items: [] }), ready({ cycles: [cycle(1, 2026, 10, 'active', 'active')] }));
  assert.equal(mentorNeeds(running)[0].text, 'October 2026 is running with no mentor.');
  assert.equal(cohortName({ year: 2026, month: 11 }), 'November 2026');
});

test('the cycle strip: the running cohort, or else the next scheduled one, with deadlines at 00:00 ET and inclusive', () => {
  assert.equal(cycleForStrip(ready({ cycles: CYCLES })).id, 1, 'the running cohort first');
  assert.equal(cycleForStrip(ready({ cycles: CYCLES.filter((c) => c.status !== 'active') })).id, 2, 'else the next scheduled one');
  assert.equal(cycleForStrip(ready({ cycles: [cycle(4, 2026, 9, 'active', 'postponed')] })), null, 'never a postponed one');
  const weeks = weekLines(CYCLES[2]);
  assert.equal(weeks[0].text, 'Week 1 · opens 1 Nov 00:00 ET · deadline 8 Nov 00:00 ET');
  assert.equal(etStamp('2026-11-08T05:00:00.000Z'), '8 Nov 00:00 ET');
  assert.doesNotMatch(weeks.map((w) => w.text).join(' '), /23:59/);
});

test('Learning counts enrolments in published programs only; a Super Admin\'s Join is derived from them', () => {
  const rows = [
    { uid: 'l1', name: 'Founder basics', status: 'published', enrolment: 'open', learners: 5, contents: 4 },
    { uid: 'l2', name: 'Drafted', status: 'draft', enrolment: 'invite', learners: 9, contents: 1 },
    { uid: 'l3', name: 'Old', status: 'archived', enrolment: 'open', learners: 3, contents: 2 },
    { uid: 'l4', name: 'Fundraising', status: 'published', enrolment: 'open', learners: 2, contents: 6 },
  ];
  const f = learningFigures(ready({ programs: rows }));
  assert.deepEqual([f.published, f.enrolments, f.rows.length], [2, 7, 4], 'draft and archived rows are listed but not counted');
  assert.equal(learningJoin(rows), 'Open', 'from the published rows only; the draft is by invitation');
  assert.equal(learningJoin([...rows, { status: 'published', enrolment: 'invite' }]), 'Open or by invitation');
  assert.equal(learningFigures(ready({ programs: many(CAPS.learning, (i) => ({ uid: `x${i}`, status: 'draft' })) })).capped, true);
});

test('Perks: the queue counts in_review rows only, "at least" at R3\'s cap; "No credit cost" never "0 credits"; Approve keeps the stored note', () => {
  const q = perkQueueFrom(ready({ items: [perk('a', 'in_review'), perk('b', 'draft'), perk('c', 'in_review', { updated_at: d1(NOW - 90 * H) })] }), NOW);
  assert.deepEqual(q.rows.map((r) => r.uid), ['a', 'c']);
  assert.equal(q.text, '2');
  assert.equal(Math.round(q.oldestHours), 90, 'a listing waits from its last edit');
  const full = perkQueueFrom(ready({ items: [...many(3, (i) => perk(`r${i}`, 'in_review')), ...many(197, (i) => perk(`d${i}`, 'draft'))] }), NOW);
  assert.deepEqual([full.count, full.text, full.atLeast], [3, 'at least 3', true]);
  assert.equal(perkPrice({ kind: 'credits', credits: 0 }), 'No credit cost');
  assert.doesNotMatch(perkPrice({ kind: 'credits', credits: 0 }), /0 credits/);
  assert.equal(perkPrice({ kind: 'credits', credits: 150 }), '150 credits');
  assert.equal(perkPrice({ kind: 'credits', credits: 1 }), '1 credit');
  assert.equal(perkPrice({ kind: 'money', price_cents: 50000 }), '$500, paid to the partner');
  assert.equal(perkPrice({ kind: 'tier', required_tier: 'growth' }, () => 'Validate + Build'), 'Included in Validate + Build');
  const seeded = perk('s', 'in_review', { review_note: 'Seeded from the partner’s own terms.' });
  assert.deepEqual(approveBody(seeded), { action: 'approve', review_note: 'Seeded from the partner’s own terms.' }, 'no note typed: the stored one goes back');
  assert.deepEqual(approveBody(seeded, { note: '  Checked.  ', featured: true, editorial: 'Our pick.' }),
    { action: 'approve', review_note: 'Checked.', featured: true, editorial_note: 'Our pick.' });
  assert.deepEqual(approveBody(perk('n', 'in_review')), { action: 'approve', review_note: '' });
  assert.deepEqual(rejectBody({ note: ' Off-topic. ' }), { action: 'reject', review_note: 'Off-topic.' });
});

test('refusals are one sentence keyed on the code: admin_frozen and branch_suspended, wherever the code arrives', () => {
  assert.equal(refusalText({ status: 423, code: 'admin_frozen' }), FROZEN);
  assert.equal(refusalText({ status: 423, data: { error: 'admin_frozen' } }), FROZEN);
  assert.equal(refusalText({ status: 423, code: 'branch_suspended' }), SUSPENDED);
  assert.equal(refusalText({ status: 423, data: { code: 'branch_suspended' } }), SUSPENDED);
  assert.equal(refusalText({ status: 500 }), TRY_AGAIN);
  assert.equal(refusalText({ status: 400, message: 'Pick an advisor.' }, 'Pick an advisor.'), 'Pick an advisor.');
  assert.equal(FROZEN, 'Changes are refused while HQ has paused your admin access. Reading still works.');
  assert.equal(SUSPENDED, 'This studio’s licence is suspended, so changes here are paused until HQ lifts it.');
});

test('the scope chip follows D893, keyed on R12 for a Super Admin: its reason replaces SCOPE_TITLE', () => {
  assert.deepEqual(scopeChip(false, failed()), { label: SCOPE_LABEL, title: SCOPE_TITLE });
  assert.deepEqual(scopeChip(true, ready({ scopes: [{ code: 'hq', kind: 'hq' }], reason: 'The deployment registry could not be read.' })),
    { label: SCOPE_LABEL, title: 'The deployment registry could not be read.' });
  assert.deepEqual(scopeChip(true, ready({ scopes: [{ code: 'hq', kind: 'hq' }] })), { label: SCOPE_LABEL, title: SCOPE_TITLE });
  assert.deepEqual(scopeChip(true, ready({ scopes: [{ code: 'hq', kind: 'hq' }, { code: 'pt', kind: 'branch' }] })), { label: SCOPE_LABEL, title: SCOPE_NOT_PER_STUDIO });
  assert.equal(scopeChip(true, failed()).title, SCOPE_UNREAD);
});

test('ages and bands are the shared 24 and 72 hours', () => {
  assert.deepEqual([bandOf(23.9), bandOf(24), bandOf(71.9), bandOf(72)], ['fresh', 'soon', 'soon', 'over']);
  assert.deepEqual([ageText(0.5), ageText(1), ageText(30), ageText(48), ageText(100)], ['under an hour', '1 hour', '30 hours', '2 days', '4 days']);
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});

function worker(o = {}) {
  const {
    glance = glanceBody([lane('cohort', 2, 30, 'due_soon'), lane('referrals', 3, 80, 'past')]),
    hosts = hostsBody(1, 4, [host(1, 10)]),
    perkQueue = { items: [perk('p1', 'in_review'), perk('p2', 'draft')] },
    perks = { items: many(5, (i) => ({ uid: `live${i}` })) },
    assignments = { items: ROWS }, assignable = { items: [{ id: 21, name: 'Mentor 21', email: 'm21@example.com', has_advisor_profile: true }] },
    timeline = { cycles: CYCLES },
    referrals = { submitted: [referral('s1', 'submitted', 2)], under_review: [referral('u1', 'under_review', 80, { referrer_name: null, referrer_email: null })], more_info_needed: [referral('m1', 'more_info_needed', 10)] },
    learning = { programs: [
      { uid: 'l1', name: 'Founder basics', region: 'Lisbon', status: 'published', enrolment: 'open', learners: 5, contents: 4 },
      { uid: 'l2', name: 'Drafted', region: null, status: 'draft', enrolment: 'invite', learners: 9, contents: 1 },
      { uid: 'l4', name: 'Fundraising', region: 'Iberia', status: 'published', enrolment: 'invite', learners: 2, contents: 6 },
    ] },
    learners = {},
    testing = { items: [{ uid: 't1', status: 'open', applicant_count: 4 }, { uid: 't2', status: 'open', applicant_count: 5 }, { uid: 't3', status: 'closed', applicant_count: 0 }] },
    scopes = { scopes: [{ code: 'hq', label: 'HQ-held', kind: 'hq', bound: true }] },
    user = null, writes = {},
  } = o;
  const call = (v, ...a) => (typeof v === 'function' ? v(...a) : response(v));
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (method !== 'GET') {
      if (/^\/api\/perks\/admin\/[^/]+\/review$/.test(path)) return writes.perk ? writes.perk(options, path) : response({ ok: true, status: 'live' });
      if (/^\/api\/refer-earn\/admin\/submissions\/[^/]+$/.test(path)) return writes.referral ? writes.referral(options, path) : response({ ok: true });
      if (path === '/api/advisors/admin/cohort-assignments') return writes.assign ? writes.assign(options) : response({ id: 99, is_active: true });
      return never();
    }
    if (path === '/api/auth/me') return user ? response(user) : never();
    if (path === '/api/admin/studio/glance') return call(glance);
    if (path === '/api/admin/lab-hosts') return call(hosts, q);
    if (path === '/api/perks/admin/queue') return call(perkQueue);
    if (path === '/api/perks') return call(perks);
    if (path === '/api/advisors/admin/cohort-assignments') return call(assignments);
    if (path === '/api/advisors/admin/cohort-assignments/assignable') return call(assignable);
    if (path === '/api/admin/cohort/timeline') return call(timeline);
    if (path === '/api/refer-earn/admin/submissions') {
      const v = referrals[q.get('status') || 'all'] ?? [];
      return typeof v === 'function' ? v(q) : response(v);
    }
    if (path === '/api/learning/programs/mine') return call(learning);
    const l = /^\/api\/learning\/programs\/([^/]+)\/learners$/.exec(path);
    if (l) return call(learners[l[1]] ?? { learners: [] });
    if (path === '/api/admin/testing/programmes') return call(testing);
    if (path === '/api/admin/insights/scopes') return call(scopes);
    return never();
  };
}

const down = () => response({ error: 'down' }, 503);
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };

async function mounted(url, page, handle, { user = null } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}${l.hash}`; return null; }
  const tree = user ? h(AuthProvider, null, h(page), h(Probe)) : [h(page, { key: 'p' }), h(Probe, { key: 'q' })];
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, tree)));
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
    props: (id) => props(byId(id)),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    nodes, nodeProps: props,
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async press(label, scope = null) {
      const pool = scope ? (() => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(byId(scope)); })() : nodes();
      const node = pool.find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}"`);
      await act(async () => { await props(node).onClick(event); });
      await flush();
    },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      restore();
    },
  };
}

const PROGRAM_DOORS = ['/admin/programs/spinout-lab', '/admin/programs/ai-native-venture', '/admin/programs/mentor-cohorts', '/admin/programs/investor-cohorts',
  '/admin/programs/referral-partners', '/admin/programs/refer-and-earn', '/admin/programs/perks', '/admin/programs/learning'];

test('the catalogue for an Admin: the header, the three tiles, nine cards with their figures, Needs you and doors, and the foot', async () => {
  const view = await mounted('/admin/programs', ProgramsCatalogue, worker());
  try {
    assert.equal(view.textOf('programs-catalogue-line'), LINE_ADMIN);
    assert.equal(view.textOf('programs-scope-chip'), SCOPE_LABEL);
    assert.equal(view.props('programs-scope-chip').title, SCOPE_TITLE);
    assert.match(view.textOf('programs-asof'), /^Updated \d\d:\d\d$/);
    assert.equal(view.textOf('programs-tile-running'), `Programs running${NOT_RECORDED}No registry records which programs run yet.`);
    assert.equal(view.textOf('programs-tile-people'), `People taking part${NOT_READ_YET}Each program stores its own members; no read counts them across programs yet.`);
    assert.equal(view.textOf('programs-tile-waiting-value'), '7');
    assert.match(view.textOf('programs-tile-waiting'), /oldest 3 days/);
    assert.ok(view.has('programs-tile-waiting-overdue'), 'an amber Overdue from 72 hours');
    assert.match(view.textOf('programs-tile-waiting'), /Strategic referral access is not read here yet\./);
    assert.equal(view.textOf('programs-catalogue-count'), '9 programs');
    assert.equal(view.textOf('programs-card-spinout-lab-figure'), '2 cohort applications waiting');
    assert.equal(view.textOf('programs-card-spinout-lab-applications'), `Lab applications: ${NOT_READ_YET}Their read cannot yet tell a failure from none.`);
    assert.equal(view.textOf('programs-card-spinout-lab-needs'), '!Needs you 3', 'cohort applications and pending hosts');
    assert.match(view.textOf('programs-card-mentor-cohorts-figure'), /^1 mentor · 2 of 4 cohorts covered/);
    assert.doesNotMatch(view.textOf('programs-card-mentor-cohorts-figure'), /not left out/, 'deactivated accounts are left out now (D960)');
    assert.equal(view.textOf('programs-card-mentor-cohorts-needs'), '!Needs you 4', 'two cohorts with no mentor and two open rows of a former Advisor');
    assert.equal(view.textOf('programs-card-refer-and-earn-figure'), '3 open referralsincluding those waiting on the member');
    assert.equal(view.textOf('programs-card-refer-and-earn-needs'), '!Needs you 3');
    assert.equal(view.textOf('programs-card-perks-figure'), '5 live');
    assert.equal(view.textOf('programs-card-perks-needs'), '!Needs you 1', 'the in_review listing; a draft is not backlog');
    assert.equal(view.textOf('programs-card-learning-figure'), '2 published programs · 7 active enrolments in themassigned to you');
    assert.equal(view.textOf('programs-card-investor-cohorts-figure'), 'Not running');
    assert.match(view.textOf('programs-card-ai-native-venture-purpose'), /^Not recordedThe playbook is not written yet\.$/);
    assert.equal(view.textOf('programs-card-product-testing-foot'), PRODUCT_TESTING_FOOT);
    assert.ok(!view.has('programs-card-product-testing-figure'), 'no figures for an Admin');
    assert.equal(view.textOf('programs-card-referral-partners-grant'), '⌂HQ-held', 'S-HELD: only a granted card reads HQ-held');
    assert.equal(view.textOf('programs-card-ai-native-venture-grant'), '–Not offered yet');
    assert.equal(view.textOf('programs-card-product-testing-grant'), '⌂Runs at HQ');
    const hrefs = view.hrefs();
    for (const d of PROGRAM_DOORS) assert.ok(hrefs.includes(d), `no door onto ${d}`);
    assert.ok(!hrefs.includes('/admin?tab=product-testing'), 'Product testing has no door for an Admin');
    assert.ok(!hrefs.includes('/admin?tab=lab-applications'), 'one Spin-Out Lab card, not two doors to one console');
    assert.ok(hrefs.includes('/admin/profiling-trends'));
    assert.match(view.textOf('programs-foot'), /^Profiling trends is not a program\. It stays here until its home is decided\.Open profiling trends$/);
    assert.ok(!view.requests.some((r) => /spinout-(applications|participants)/.test(r.url)), 'Guard H: the reads that hide failure are not made');
    assert.ok(!view.requests.some((r) => r.url.startsWith('/api/admin/testing') || r.url.startsWith('/api/admin/insights')), 'R11 and R12 are the Super Admin\'s');
    // The group chips filter in the browser.
    await view.click('programs-group-Access');
    assert.ok(view.has('programs-card-mentor-cohorts') && view.has('programs-card-investor-cohorts') && !view.has('programs-card-perks'));
    await view.click('programs-group-all');
    assert.ok(view.has('programs-card-perks'));
  } finally { await view.close(); }
});

test('each failed read marks only the blocks it feeds', async () => {
  const perksDown = await mounted('/admin/programs', ProgramsCatalogue, worker({ perks: down }));
  try {
    assert.match(perksDown.textOf('programs-card-perks-figure').trim(), /^Live perks could not be read\. That is not the same as none\.Try again$/);
    assert.equal(perksDown.textOf('programs-tile-waiting-value'), '7', 'Waiting for you does not read R4');
    assert.equal(perksDown.textOf('programs-card-perks-needs'), '!Needs you 1', 'the Needs you pill reads R3, which answered');
    assert.equal(perksDown.textOf('programs-card-refer-and-earn-figure'), '3 open referralsincluding those waiting on the member');
    assert.match(perksDown.textOf('programs-asof'), /^Updated/);
  } finally { await perksDown.close(); }
  const glanceDown = await mounted('/admin/programs', ProgramsCatalogue, worker({ glance: down }));
  try {
    assert.match(glanceDown.textOf('programs-tile-waiting'), /Could not be readcohort applications, Refer & Earn reviews could not be read, so no total is drawn\.Try again/);
    assert.ok(!glanceDown.has('programs-tile-waiting-value'), 'no smaller total');
    assert.match(glanceDown.textOf('programs-card-spinout-lab-figure').trim(), /^Cohort applications could not be read\./);
    assert.match(glanceDown.textOf('programs-card-refer-and-earn-figure').trim(), /^Open referrals could not be read\./);
    assert.equal(glanceDown.textOf('programs-card-spinout-lab-needs'), 'Needs you could not be read');
    assert.match(glanceDown.textOf('programs-card-mentor-cohorts-figure'), /^1 mentor/, 'the mentor card reads R5 and R7');
    assert.equal(glanceDown.textOf('programs-card-perks-figure'), '5 live');
  } finally { await glanceDown.close(); }
  const mentorsDown = await mounted('/admin/programs', ProgramsCatalogue, worker({ assignments: down }));
  try {
    assert.match(mentorsDown.textOf('programs-card-mentor-cohorts-figure').trim(), /^The mentors and cohorts could not be read\./);
    assert.equal(mentorsDown.textOf('programs-tile-waiting-value'), '7');
    assert.equal(mentorsDown.textOf('programs-card-learning-figure'), '2 published programs · 7 active enrolments in themassigned to you');
  } finally { await mentorsDown.close(); }
  const allDown = await mounted('/admin/programs', ProgramsCatalogue, () => down());
  try {
    assert.equal(allDown.textOf('programs-asof'), 'Could not be read', 'when every read fails, the header says so');
    assert.equal(allDown.textOf('programs-tile-running'), `Programs running${NOT_RECORDED}No registry records which programs run yet.`, 'a block with no read stands');
  } finally { await allDown.close(); }
});

test('first use: four empty queues are a real 0 with "Nothing is waiting.", and the queue cards draw no Needs-you pill', async () => {
  const view = await mounted('/admin/programs', ProgramsCatalogue, worker({
    glance: glanceBody([lane('cohort', 0), lane('referrals', 0)]), hosts: hostsBody(0, 0), perkQueue: { items: [] },
  }));
  try {
    assert.equal(view.textOf('programs-tile-waiting-value'), '0');
    assert.match(view.textOf('programs-tile-waiting'), new RegExp(NOTHING_WAITING.replace('.', '\\.')));
    for (const k of ['spinout-lab', 'refer-and-earn', 'perks']) assert.ok(!view.has(`programs-card-${k}-needs`), k);
    assert.ok(view.has('programs-card-mentor-cohorts-needs'), 'Mentor counts its own rows: a scheduled cohort with no mentor is one');
  } finally { await view.close(); }
});

test('the catalogue for a Super Admin (PG2): HQ\'s line, the chip keyed on R12, no Needs-you pills, Product testing\'s figures and door', async () => {
  const view = await mounted('/admin/programs', ProgramsCatalogue, worker({
    user: SUPER, scopes: { scopes: [{ code: 'hq', kind: 'hq' }], reason: 'The deployment registry could not be read.' },
  }), { user: SUPER });
  try {
    assert.equal(view.textOf('programs-catalogue-line'), LINE_SUPER);
    assert.equal(view.props('programs-scope-chip').title, 'The deployment registry could not be read.');
    for (const p of PROGRAMS) assert.ok(!view.has(`programs-card-${p.key}-needs`), `${p.key} draws a Needs-you pill for HQ`);
    assert.equal(view.textOf('programs-card-product-testing-figure'), '2 open · 9 applied, not withdrawn');
    assert.ok(view.hrefs().includes('/admin?tab=product-testing'));
    assert.ok(!view.has('programs-card-product-testing-foot'));
    assert.equal(view.textOf('programs-card-ai-native-venture-grant'), '⌂HQ only');
    assert.equal(view.textOf('programs-card-mentor-cohorts-grant'), '⌂HQ-held');
    assert.match(view.textOf('programs-card-learning-who'), /Join: Open or by invitation$/, 'derived from the published rows: one open, one by invitation');
    assert.ok(view.hrefs().includes('/learning/studio/programs'), 'the program studio\'s door');
    assert.ok(view.requests.some((r) => r.url.startsWith('/api/admin/testing/programmes')));
  } finally { await view.close(); }
});

test('the redirects keep the query and the hash, add ?moved=, and land where the function now lives', async () => {
  for (const [from, Redirect, to] of [
    ['/admin/held/programs?scope=hq#cards', HeldProgramsRedirect, '/admin/programs?scope=hq&moved=held#cards'],
    ['/admin/advisor-cohorts?x=1#rows', AdvisorCohortsRedirect, '/admin/programs/mentor-cohorts/people?x=1&moved=advisor-cohorts#rows'],
    ['/admin/refer-earn?status=submitted', ReferEarnRedirect, '/admin/programs/refer-and-earn/queue?status=submitted&moved=refer-earn'],
  ]) {
    const restore = installDocument();
    const at = { path: null };
    function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}${l.hash}`; return null; }
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(h(MemoryRouter, { initialEntries: [from] },
        h(Routes, null, h(Route, { path: from.split(/[?#]/)[0], element: h(Redirect) }), h(Route, { path: '*', element: h(Probe) })))));
      assert.equal(at.path, to, from);
    } finally { await act(async () => root.unmount()); restore(); }
  }
});

test('the moved notice sits under the title where a redirect lands, and Dismiss drops ?moved=', async () => {
  const view = await mounted('/admin/programs?moved=held', ProgramsCatalogue, worker());
  try {
    assert.equal(view.textOf('programs-moved'), `${MOVED_NOTICES.held.text}Dismiss`);
    assert.equal(view.props('programs-moved').role, 'status');
    await view.press('Dismiss');
    assert.equal(view.at.path, '/admin/programs');
    assert.ok(!view.has('programs-moved'));
  } finally { await view.close(); }
});

test('Mentor cohort access · Overview: S-CNT and S-COV tiles with their lines, Needs you rows to People, and every host counted', async () => {
  const view = await mounted('/admin/programs/mentor-cohorts', MentorCohortAccess, worker());
  try {
    assert.match(view.textOf('programs-crumb'), /^Programs › Mentor cohort access$/);
    assert.equal(view.textOf('programs-facts'), 'Who: Advisors· Join: Assigned by an admin· Cycle: monthly cohorts of four weeks');
    assert.equal(view.textOf('programs-tile-mentors-value'), '1');
    assert.match(view.textOf('programs-tile-mentors'), new RegExp(ACTIVE_MENTORS_LINE.replace('.', '\\.')));
    assert.equal(view.textOf('programs-tile-covered-value'), '2 of 4');
    assert.match(view.textOf('programs-tile-covered'), /2 of 4 cohorts, scheduled or running/);
    assert.match(view.textOf('programs-tile-hidden'), /Not read here yetFounders’ choices are stored; no admin read counts them yet\./);
    assert.match(view.textOf('programs-mentor-needs-cycle-3'), /December 2026 starts 1 Dec with no mentor\.Open People$/);
    assert.match(view.textOf('programs-mentor-needs-row-3'), /Ana Former is no longer an Advisor\. Their access is already refused, but the assignment is still open\./);
    assert.equal(view.textOf('programs-mentor-hosts-line'), '4 approved · 1 waiting, every host');
    assert.ok(view.hrefs().includes('/admin/programs/mentor-cohorts/people'));
    assert.ok(view.hrefs().includes('/admin/programs/spinout-lab'));
  } finally { await view.close(); }
  const hostsDown = await mounted('/admin/programs/mentor-cohorts', MentorCohortAccess, worker({ hosts: down }));
  try {
    assert.ok(hostsDown.has('programs-mentor-hosts-unreadable'));
    assert.equal(hostsDown.textOf('programs-tile-mentors-value'), '1', 'only the hosts card is marked');
  } finally { await hostsDown.close(); }
});

test('Mentor cohort access · How it runs: the playbook constant, locked for an Admin, with the cycle strip at 00:00 ET', async () => {
  const view = await mounted('/admin/programs/mentor-cohorts/how-it-runs', MentorCohortAccess, worker({ timeline: { cycles: CYCLES.filter((c) => c.id !== 1) } }));
  try {
    const how = view.textOf('programs-mentor-how');
    assert.match(how, /A mentor sees a founder once that founder’s first week is recorded\./);
    assert.match(how, /Set by HQ/);
    assert.equal(view.textOf('programs-mentor-how-foot'), 'HQ writes the playbook.');
    assert.match(view.textOf('programs-mentor-cycle'), /November 2026 · scheduledWeek 1 · opens 1 Nov 00:00 ET · deadline 8 Nov 00:00 ET/);
    assert.match(view.textOf('programs-mentor-cycle'), /Times are America\/New_York\. Cohort dates are fixed by the Lab’s calendar\./);
    assert.match(view.textOf('programs-mentor-measures'), /Founders hiddenNot read here yet/);
    assert.ok(view.hrefs().includes('/admin/contracts?tab=templates'));
  } finally { await view.close(); }
});

test('Mentor cohort access · People: the assignments body with the moved notice, the new Assign line, and "within the newest 500"', async () => {
  let sent = null;
  const view = await mounted('/admin/programs/mentor-cohorts/people?moved=advisor-cohorts', MentorCohortAccess, worker({
    assignments: { items: many(CAPS.assignments, (i) => assignment(i, 100 + i, 1)) },
    writes: { assign: (o) => { sent = JSON.parse(o.body); return response({ id: 999, is_active: true }); } },
  }));
  try {
    assert.equal(view.textOf('programs-moved'), `${MOVED_NOTICES['advisor-cohorts'].text}Dismiss`);
    assert.ok(view.has('advisor-cohort-assignments'));
    assert.match(view.textOf('advisor-cohort-count'), /— 500, within the newest 500$/);
    assert.ok(!view.text().includes('Advisor cohort accessAn assignment'), 'the body\'s own heading gives way to the program header');
    const selects = view.nodes().filter((n) => String(n.tagName).toUpperCase() === 'SELECT');
    await act(async () => { view.nodeProps(selects[0]).onChange({ target: { value: '21' } }); });
    await act(async () => { view.nodeProps(selects[1]).onChange({ target: { value: '1' } }); });
    const form = view.nodes().find((n) => String(n.tagName).toUpperCase() === 'FORM');
    await act(async () => { await view.nodeProps(form).onSubmit({ preventDefault() {} }); });
    await view.flush();
    assert.deepEqual(sent, { advisor_user_id: 21, cohort_cycle_id: 1, note: null });
    assert.equal(view.textOf('advisor-cohort-note'), ASSIGNED_LINE);
    assert.equal(ASSIGNED_LINE, 'Assigned. The advisor sees a founder in that cohort once that founder’s first week is recorded.');
  } finally { await view.close(); }
});

test('Refer & Earn · Overview: the three statuses, their total and bands, and the oldest and Overdue from R1', async () => {
  const view = await mounted('/admin/programs/refer-and-earn', ReferAndEarn, worker({ glance: glanceBody([lane('cohort', 0), lane('referrals', 3, 100, 'past')]) }));
  try {
    assert.match(view.textOf('programs-refer-status-more_info_needed'), /^Waiting on the member1$/);
    assert.match(view.textOf('programs-refer-total'), /^Total3Under 24 hours: 2 · 24 to 72 hours: 0 · 72 hours or more: 1$/);
    assert.match(view.textOf('programs-refer-oldest'), /^Oldest: 4 days since submitted/);
    assert.ok(view.has('programs-refer-overdue'));
    assert.equal(view.textOf('programs-tab-queue-count'), '3, Every open referral', 'the Queue tab\'s count is Overview\'s total');
    assert.match(view.textOf('programs-refer-strategic'), /Not read here yetMembers’ requests are stored; no admin read lists them yet\./);
  } finally { await view.close(); }
  const laneDown = await mounted('/admin/programs/refer-and-earn', ReferAndEarn, worker({ glance: glanceBody([lane('cohort', 0), lane('referrals', null)]) }));
  try {
    assert.match(laneDown.textOf('programs-refer-oldest'), /^Oldest and Overdue: Could not be read/);
    assert.ok(!laneDown.has('programs-refer-overdue'));
    assert.match(laneDown.textOf('programs-refer-total'), /^Total3/, 'the R8 counts still stand');
  } finally { await laneDown.close(); }
});

test('Refer & Earn · Queue: the open statuses merged, "Not recorded" for a nameless referrer, the commissions door for a Super Admin only', async () => {
  const view = await mounted('/admin/programs/refer-and-earn/queue?moved=refer-earn', ReferAndEarn, worker());
  try {
    assert.equal(view.textOf('programs-moved'), `${MOVED_NOTICES['refer-earn'].text}Dismiss`);
    assert.ok(view.has('referral-review-row-s1') && view.has('referral-review-row-u1') && view.has('referral-review-row-m1'), 'the three open statuses');
    assert.match(view.textOf('referral-review-row-u1-meta'), /· from Not recorded$/);
    assert.doesNotMatch(view.textOf('referral-review-row-u1-meta'), /u1/, 'never the submission\'s id');
    assert.equal(view.textOf('referral-review-commissions-hq'), HQ_READS_COMMISSIONS);
    assert.ok(!view.hrefs().includes('/admin/commissions'), 'the route is hqOnly');
    assert.equal(view.props('referral-review-chip-open')['aria-pressed'], true, 'the Queue opens on the open statuses');
    assert.ok(!view.requests.some((r) => r.url.includes('/refer-earn/admin/submissions?limit=')), 'the Queue reads no fourth list for its default view');
    assert.ok(view.requests.filter((r) => r.url.startsWith('/api/refer-earn/admin/submissions')).every((r) => r.url.includes('limit=200')));
    await view.click('referral-review-chip-all');
    assert.ok(view.requests.some((r) => r.url === '/api/refer-earn/admin/submissions?limit=200'), 'All reads 200 rows, not the default 100');
  } finally { await view.close(); }
  const hq = await mounted('/admin/programs/refer-and-earn/queue', ReferAndEarn, worker({ user: SUPER }), { user: SUPER });
  try {
    assert.ok(hq.hrefs().includes('/admin/commissions'));
    assert.ok(!hq.has('referral-review-commissions-hq'));
  } finally { await hq.close(); }
});

test('Refer & Earn · Queue: a review saved under another chip re-reads the open statuses, so the Open view and the tab count follow', async () => {
  const view = await mounted('/admin/programs/refer-and-earn/queue', ReferAndEarn, worker());
  try {
    await view.click('referral-review-chip-submitted');
    await view.click('referral-review-open-s1');
    const before = view.requests.length;
    await view.press('Save', 'referral-review-form-s1');
    const after = view.requests.slice(before).filter((r) => r.method === 'GET' && r.url.startsWith('/api/refer-earn/admin/submissions'));
    for (const status of ['submitted', 'under_review', 'more_info_needed']) {
      assert.ok(after.some((r) => new URLSearchParams(r.url.split('?')[1]).get('status') === status), `${status} is read again after the save`);
    }
  } finally { await view.close(); }
});

test('Refer & Earn · Queue: a failed read never also says the queue is empty; a full call says "The newest 200"', async () => {
  const view = await mounted('/admin/programs/refer-and-earn/queue', ReferAndEarn, worker({ referrals: { submitted: [], under_review: down, more_info_needed: [] } }));
  try {
    assert.ok(view.has('referral-review-error'));
    assert.ok(!view.has('referral-review-empty'), 'N6: no empty sentence under the error');
    assert.doesNotMatch(view.text(), /Nothing in this queue|Nothing is waiting/);
    assert.ok(!view.has('programs-tab-queue-count'), 'no count stands in for an unread list');
  } finally { await view.close(); }
  const full = await mounted('/admin/programs/refer-and-earn/queue', ReferAndEarn, worker({ referrals: { submitted: many(200, (i) => referral(`s${i}`, 'submitted', 1)), under_review: [], more_info_needed: [] } }));
  try {
    assert.equal(full.textOf('referral-review-full'), 'The newest 200 in each open status. Older ones are not listed here.');
    assert.equal(full.textOf('programs-tab-queue-count'), '200+, The newest 200 in each open status');
  } finally { await full.close(); }
  const empty = await mounted('/admin/programs/refer-and-earn/queue', ReferAndEarn, worker({ referrals: { submitted: [], under_review: [], more_info_needed: [] } }));
  try {
    assert.match(empty.textOf('referral-review-empty'), /^Nothing is waiting\. Members submit referrals/);
  } finally { await empty.close(); }
});

test('Refer & Earn · Queue: a refusal is one sentence under its own Save, keyed on the code', async () => {
  for (const [body, sentence] of [[{ error: 'branch_suspended', detail: 'Suspended' }, SUSPENDED], [{ error: 'admin_frozen' }, FROZEN]]) {
    const view = await mounted('/admin/programs/refer-and-earn/queue', ReferAndEarn, worker({ writes: { referral: () => response(body, 423) } }));
    try {
      await view.click('referral-review-open-s1');
      await view.click('referral-review-save-s1');
      assert.equal(view.textOf('referral-review-refusal-s1'), sentence);
      assert.ok(!view.has('referral-review-done'));
    } finally { await view.close(); }
  }
});

test('Perks: Overview counts in_review only; the Queue prices "No credit cost", keeps the stored note on Approve, and refuses under its own row', async () => {
  const items = [
    perk('a', 'in_review', { credits: 0, review_note: 'Seeded from the partner’s own terms.' }),
    perk('b', 'in_review', { credits: 200 }),
    perk('c', 'draft'),
  ];
  const overview = await mounted('/admin/programs/perks', ProgramPage, worker({ perkQueue: { items } }));
  try {
    assert.equal(overview.textOf('programs-tile-waiting-value'), '2');
    assert.equal(overview.textOf('programs-tab-queue-count'), '2, Listings in review');
    assert.match(overview.textOf('programs-tile-credits'), /Not read here yetHQ reads these figures\./, 'O-MONEY for an Admin');
    assert.match(overview.textOf('programs-tile-claims'), /Not read here yetNo admin read counts claims yet\./);
  } finally { await overview.close(); }
  let sent = [];
  const queue = await mounted('/admin/programs/perks/queue', ProgramPage, worker({
    perkQueue: { items },
    writes: { perk: (o, path) => { sent.push({ path, body: JSON.parse(o.body) }); return path.includes('/b/') ? response({ error: 'admin_frozen' }, 423) : response({ ok: true, status: 'live' }); } },
  }));
  try {
    assert.ok(queue.has('programs-perks-row-a') && queue.has('programs-perks-row-b') && !queue.has('programs-perks-row-c'), 'a draft is not listed');
    assert.equal(queue.textOf('programs-perks-row-a-meta'), 'Partner a · No credit cost');
    assert.doesNotMatch(queue.textOf('programs-perks-queue'), /\b0 credits\b/);
    assert.equal(queue.textOf('programs-perks-row-b-meta'), 'Partner b · 200 credits');
    assert.match(queue.textOf('programs-perks-row-a-age'), /since last edit$/);
    assert.equal(queue.props('programs-perks-row-a-reject').disabled, true, 'Reject waits for the reason the partner sees');
    await queue.click('programs-perks-row-b-approve');
    assert.equal(queue.textOf('programs-perks-row-b-refusal'), FROZEN);
    assert.ok(!queue.has('programs-perks-row-a-refusal'), 'N10: the refusal sits under its own row only');
    await queue.click('programs-perks-row-a-approve');
    assert.deepEqual(sent.find((s) => s.path.includes('/a/')).body, { action: 'approve', review_note: 'Seeded from the partner’s own terms.' });
    assert.equal(queue.textOf('programs-perks-done'), PERK_APPROVED);
  } finally { await queue.close(); }
  const hq = await mounted('/admin/programs/perks', ProgramPage, worker({ user: SUPER }), { user: SUPER });
  try {
    assert.match(hq.textOf('programs-tile-credits'), /Not read here yetNo read sums members’ balances yet\./);
  } finally { await hq.close(); }
});

test('Learning: Overview counts published rows only and lists every row; People reads one program, and a 403 marks only it', async () => {
  const view = await mounted('/admin/programs/learning', ProgramPage, worker());
  try {
    assert.equal(view.textOf('programs-tile-published-value'), '2');
    assert.equal(view.textOf('programs-tile-enrolments-value'), '7', 'the draft\'s nine enrolments are not counted');
    assert.ok(view.has('programs-learning-row-l2'), 'the table lists the draft with its own count');
    assert.equal(view.textOf('programs-learning-admin-line'), 'You follow the programs HQ assigns you. Progress is read only.');
    assert.ok(view.hrefs().includes('/learning/programs'));
  } finally { await view.close(); }
  const people = await mounted('/admin/programs/learning/people', ProgramPage, worker({
    learners: { l1: { learners: [{ uid: 'u1', name: 'Lea Learner', enrolled_at: '2026-10-02T10:00:00.000Z' }] }, l4: () => response({ code: 'not_assigned', message: 'No.' }, 403) },
  }));
  try {
    await people.change('programs-learning-pick', { value: 'l4' });
    assert.equal(people.textOf('programs-learning-learners-refused'), 'This program is not assigned to you, so its learners are not read here.');
    await people.change('programs-learning-pick', { value: 'l1' });
    assert.equal(people.textOf('programs-learning-learner-u1'), 'Lea LearnerEnrolled 2 Oct 2026');
    assert.doesNotMatch(people.textOf('programs-learning-learners'), /@/, 'never an email');
  } finally { await people.close(); }
});

test('Referral partners links D923\'s tabs, with Commissions for a Super Admin only; Investor and AI-native are one page each', async () => {
  const admin = await mounted('/admin/programs/referral-partners', ProgramPage, worker());
  try {
    for (const d of ['/admin/partner-invitations/deals', '/admin/partner-invitations/referrals', '/admin/partner-invitations']) assert.ok(admin.hrefs().includes(d), d);
    assert.ok(!admin.hrefs().includes('/admin/commissions'));
    assert.equal(admin.textOf('programs-partners-hq'), HQ_READS_COMMISSIONS);
    assert.ok(!admin.has('programs-facts'), 'Who, Join and Terms wait for part 5');
  } finally { await admin.close(); }
  const hq = await mounted('/admin/programs/referral-partners', ProgramPage, worker({ user: SUPER }), { user: SUPER });
  try {
    assert.ok(hq.hrefs().includes('/admin/commissions'));
  } finally { await hq.close(); }
  const investor = await mounted('/admin/programs/investor-cohorts', ProgramPage, worker());
  try {
    assert.equal(investor.textOf('programs-investor-banner'), 'New program. This is the design; nothing runs yet.');
    assert.ok(!investor.has('programs-tabs'), 'one tab is no strip');
    assert.equal(investor.textOf('programs-header-status'), '○Not built yet');
  } finally { await investor.close(); }
  const ai = await mounted('/admin/programs/ai-native-venture', ProgramPage, worker());
  try {
    assert.match(ai.textOf('programs-header-line'), /^Not recordedThe playbook is not written yet\.$/);
    assert.ok(!ai.has('programs-tabs'));
    assert.ok(!/\[A venture program/.test(ai.text()), 'the bracketed sample never ships');
  } finally { await ai.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring and the source
 * ------------------------------------------------------------------ */

const PROGRAM_FILES = readdirSync(resolve(root, 'frontend/src/pages/admin/programs')).filter((f) => /\.jsx?$/.test(f)).map((f) => `frontend/src/pages/admin/programs/${f}`);
const APP = read('frontend/src/App.jsx');

test('the routes: each address under today\'s guard, never hqOnly, and the three redirects each its own lazy *Redirect element', () => {
  const pages = {
    AdminProgramsCatalogue: ['/admin/programs'],
    AdminMentorCohortAccess: ['/admin/programs/mentor-cohorts', '/admin/programs/mentor-cohorts/how-it-runs', '/admin/programs/mentor-cohorts/people'],
    AdminReferAndEarn: ['/admin/programs/refer-and-earn', '/admin/programs/refer-and-earn/how-it-runs', '/admin/programs/refer-and-earn/queue', '/admin/programs/refer-and-earn/settings'],
    AdminProgramPage: ['/admin/programs/perks', '/admin/programs/perks/how-it-runs', '/admin/programs/perks/queue', '/admin/programs/learning',
      '/admin/programs/learning/how-it-runs', '/admin/programs/learning/people', '/admin/programs/referral-partners',
      '/admin/programs/referral-partners/how-it-runs', '/admin/programs/investor-cohorts', '/admin/programs/ai-native-venture'],
  };
  for (const [component, paths] of Object.entries(pages)) {
    for (const p of paths) assert.ok(APP.includes(`\n      <Route path="${p}" element={guard(['admin'], <${component} />)} />`), p);
    assert.equal((APP.match(new RegExp(`<${component} />`, 'g')) || []).length, paths.length, component);
  }
  assert.doesNotMatch(codeOnly(APP).split('\n').filter((l) => l.includes('/admin/programs')).join('\n'), /hqOnly\(/, 'no hqOnly');
  for (const [path, component, file] of [
    ['/admin/held/programs', 'HeldProgramsRedirect', 'HeldProgramsRedirect'],
    ['/admin/advisor-cohorts', 'AdvisorCohortsRedirect', 'AdvisorCohortsRedirect'],
    ['/admin/refer-earn', 'ReferEarnRedirect', 'ReferEarnRedirect'],
  ]) {
    assert.ok(APP.includes(`\n      <Route path="${path}" element={<${component} />} />`), `${path} is not its redirect's whole element`);
    assert.ok(APP.includes(`const ${component} = lazy(() => import('./pages/admin/programs/${file}'));`), `${component} is not lazy-imported`);
  }
  // Each redirect takes its path and moved key from the one model, each path a literal.
  const model = read('frontend/src/pages/admin/programs/programsModel.js');
  for (const line of ["export const PROGRAMS_PATH = '/admin/programs';", "export const MENTOR_PEOPLE_PATH = '/admin/programs/mentor-cohorts/people';",
    "export const REFER_QUEUE_PATH = '/admin/programs/refer-and-earn/queue';"]) assert.ok(model.includes(line), line);
  assert.match(read('frontend/src/pages/admin/programs/HeldProgramsRedirect.jsx'), /import \{ MOVED_HELD, PROGRAMS_PATH \} from '\.\/programsModel';/);
  assert.match(read('frontend/src/pages/admin/programs/AdvisorCohortsRedirect.jsx'), /import \{ MENTOR_PEOPLE_PATH, MOVED_ADVISOR_COHORTS \} from '\.\/programsModel';/);
  assert.match(read('frontend/src/pages/admin/programs/ReferEarnRedirect.jsx'), /import \{ MOVED_REFER_EARN, REFER_QUEUE_PATH \} from '\.\/programsModel';/);
  assert.doesNotMatch(APP, /<HeldPrograms \/>|<AdminReferralReview \/>|<AdvisorCohortAssignments \/>/, 'the old pages are not routed');
  assert.ok(!existsSync(resolve(root, 'frontend/src/pages/admin/HeldPrograms.jsx')), 'HeldPrograms.jsx goes');
  const counted = REDIRECT_ROUTES.map((r) => r.path);
  for (const p of ['/admin/held/programs', '/admin/advisor-cohorts', '/admin/refer-earn']) assert.ok(counted.includes(p), `${p} is not counted for #2319`);
});

test('each frame is one literal AdminBoardFrame, named for its board, as the whole body of a no-argument default export', () => {
  for (const [file, name, workspace] of [
    ['ProgramsCatalogue.jsx', 'ProgramsCatalogue', 'Programs'], ['MentorCohortAccess.jsx', 'MentorCohortAccess', 'Advisor cohort access'],
    ['ReferAndEarn.jsx', 'ReferAndEarn', 'Referrals'], ['ProgramPage.jsx', 'ProgramPage', 'Programs'],
  ]) {
    const code = codeOnly(read(`frontend/src/pages/admin/programs/${file}`));
    assert.match(code, new RegExp(`export default function ${name}\\(\\) \\{\\s*return \\(\\s*<AdminBoardFrame workspace="${workspace}" note="Eadwyn reads the program figures on this page\\. Nothing changes until you act\\."`), file);
    assert.equal((code.match(/<AdminBoardFrame\b/g) || []).length, 1, `${file} draws one frame`);
  }
  // The consoles' bodies are mounted, never their default exports, so each page has one rail.
  assert.match(read('frontend/src/pages/admin/AdvisorCohortAssignments.jsx'), /export function AdvisorCohortAssignmentsBody\(/);
  assert.match(read('frontend/src/pages/admin/ReferralReview.jsx'), /export function ReferralReviewBody\(/);
  assert.match(read('frontend/src/pages/admin/programs/MentorCohortAccess.jsx'), /import \{ AdvisorCohortAssignmentsBody \} from '\.\.\/AdvisorCohortAssignments';/);
  assert.match(read('frontend/src/pages/admin/programs/ReferAndEarn.jsx'), /import \{ ReferralReviewBody \} from '\.\.\/ReferralReview';/);
  for (const f of PROGRAM_FILES) assert.doesNotMatch(codeOnly(read(f)), /<(AdvisorCohortAssignments|ReferralReview|WorkerRail|HeldZone)\b/, `${f} mounts a second rail`);
  // ReferralReview keeps its literal commissions door (D569), drawn for a Super Admin only.
  const review = codeOnly(read('frontend/src/pages/admin/ReferralReview.jsx'));
  assert.match(review, /\{superAdmin \? \(\s*<Link\s+to="\/admin\/commissions"/);
  assert.match(review, /limit: CAPS\.referrals/);
  assert.match(review, /r\.referrer_name \|\| r\.referrer_email \|\| NOT_RECORDED/);
  assert.doesNotMatch(review, /`user \$\{r\.uid\}`/, 'N6: never the submission\'s id as its referrer');
});

test('the rail boards: S19 is framed on the catalogue, S9 and S18 take the Queue and People, and each lists only its routed file', () => {
  const by = Object.fromEntries(ADMIN_BOARDS.map((b) => [b.id, b]));
  assert.deepEqual([by.S19.route, by.S19.files, by.S19.rail], ['/admin/programs', ['pages/admin/programs/ProgramsCatalogue.jsx'], 'pages/admin/AdminBoardFrame.jsx']);
  assert.deepEqual([by.S9.route, by.S9.files], ['/admin/programs/refer-and-earn/queue', ['pages/admin/programs/ReferAndEarn.jsx']]);
  assert.deepEqual([by.S18.route, by.S18.files], ['/admin/programs/mentor-cohorts/people', ['pages/admin/programs/MentorCohortAccess.jsx']]);
  assert.deepEqual([by.S21.route, by.S21.files, by.S21.alias], ['/admin/programs/mentor-cohorts/people', ['pages/admin/programs/MentorCohortAccess.jsx'], 'S18']);
});

test('the rail keys: /admin/programs owns Admin · Programs exactly, the held row is gone, and the subtrees are aliases', () => {
  assert.equal(pageKeyFor('/admin/programs', 'admin'), 'Admin · Programs');
  assert.equal(pageKeyFor('/admin/programs/spinout-lab', 'admin'), 'Admin · Programs · Spin-Out Lab', 'D937 keeps the Lab board identity separate from the catalogue; D317 still suppresses its rail');
  for (const p of ['/admin/programs/perks', '/admin/programs/perks/queue', '/admin/programs/learning/people', '/admin/programs/referral-partners',
    '/admin/programs/investor-cohorts', '/admin/programs/ai-native-venture']) assert.equal(pageKeyFor(p, 'admin'), 'Admin · Programs', p);
  for (const p of ['/admin/programs/mentor-cohorts', '/admin/programs/mentor-cohorts/people']) assert.equal(pageKeyFor(p, 'admin'), 'Admin · Approvals · Advisor cohort access', p);
  for (const p of ['/admin/programs/refer-and-earn', '/admin/programs/refer-and-earn/queue']) assert.equal(pageKeyFor(p, 'admin'), 'Admin · Approvals · Referrals', p);
  assert.equal(pageKeyFor('/branch/programs', 'branch_admin'), 'Admin · Programs');
  const rail = read('frontend/src/lib/railPages.js');
  assert.match(rail, /exact\(own\('\/admin\/programs', key\(AD, 'Programs'\)\)\)/);
  assert.doesNotMatch(rail, /own\('\/admin\/held\/programs'/);
  assert.equal(pageKeyFor('/admin/programs', 'super_admin'), null, 'a Super Admin\'s rail here has no key of its own');
});

test('the sidebars: the Admin row and its match, Approvals without /admin/refer-earn, and HQ\'s row after Licences', () => {
  const admin = SIDEBAR_GROUPS.admin.flatMap((g) => g.items || []);
  const programs = admin.find((r) => r.label === 'Programs');
  assert.equal(programs.to, '/admin/programs');
  assert.deepEqual(programs.match, ['/admin/programs', '/admin/held/programs', '/admin/advisor-cohorts', '/admin/refer-earn', '/admin/spinout-lab', '/admin/profiling-trends']);
  assert.ok(!admin.find((r) => r.label === 'Approvals').match.includes('/admin/refer-earn'), 'exactly one row lights each page');
  const lit = (path) => admin.filter((r) => r.to === path || (r.match || []).some((m) => path === m || path.startsWith(`${m}/`))).map((r) => r.label);
  for (const p of ['/admin/programs', '/admin/programs/perks/queue', '/admin/programs/mentor-cohorts/people', '/admin/refer-earn']) assert.deepEqual(lit(p), ['Programs'], p);
  const hq = SIDEBAR_GROUPS.super_admin.flatMap((g) => g.items || []);
  const at = hq.findIndex((r) => r.label === 'Programs');
  assert.equal(hq[at - 1].label, 'Licences');
  assert.deepEqual([hq[at].to, hq[at].match], ['/admin/programs', ['/admin/programs']]);
  assert.ok(hq[at].icon, 'with its icon');
  assert.match(read('frontend/src/sidebarConfig.js'), /The approved canvas has ELEVEN rows/, 'the canvas sentence stays');
});

test('Approvals: lane 16 says No queue at People, lane 2 and the branch console take the Queue, and the placement map follows', () => {
  const held = read('frontend/src/pages/admin/HeldApprovals.jsx');
  assert.match(held, /<tr data-lane="2">.*<Link to="\/admin\/programs\/refer-and-earn\/queue" className=\{CONSOLE\}>\/admin\/programs\/refer-and-earn\/queue<\/Link>/);
  assert.match(held, /<tr data-lane="16">.*<Link to="\/admin\/programs\/mentor-cohorts\/people" className=\{CONSOLE\}>\/admin\/programs\/mentor-cohorts\/people<\/Link>.*noQueue="Advisor cohort access"/);
  assert.equal(LANE_CONSOLES.referrals, '/admin/programs/refer-and-earn/queue');
  assert.equal(NO_QUEUE_CONSOLES['Advisor cohort access'], '/admin/programs/mentor-cohorts/people');
  assert.match(read('frontend/src/pages/branch/BranchApprovals.jsx'), /referrals: \{ to: '\/admin\/programs\/refer-and-earn\/queue'/);
  const adv = ADMIN_PLACEMENT.find((e) => e.key === '/admin/advisor-cohorts');
  const ref = ADMIN_PLACEMENT.find((e) => e.key === '/admin/refer-earn');
  assert.deepEqual([adv.route, adv.row, adv.form, adv.also], ['/admin/programs/mentor-cohorts/people', 'Programs', 'card link', [{ tier: 'Admin', row: 'Approvals', form: 'lane' }]]);
  assert.match(adv.how, /No queue/);
  assert.deepEqual([ref.route, ref.row, ref.form, ref.also], ['/admin/programs/refer-and-earn/queue', 'Programs', 'card link', [{ tier: 'Admin', row: 'Approvals', form: 'lane' }]]);
  const src = PROGRAM_FILES.map((f) => read(f)).join('\n');
  assert.doesNotMatch(src, /Also an Approvals lane/);
  assert.doesNotMatch(read('frontend/src/lib/adminPlacement.js').split('\n').filter((l) => l.includes('Advisor Cohort Access') || l.includes('No queue')).join('\n'), /Also an Approvals lane/);
});

test('the tab strips are literal NavLinks, equal to PAGES, and the card doors are literal', () => {
  const tabs = codeOnly(read('frontend/src/pages/admin/programs/ProgramTabs.jsx'));
  const doors = [...tabs.matchAll(/<Tab to="([^"]+)"/g)].map((m) => m[1]);
  const want = Object.values(PAGES).flatMap((p) => p.tabs.map((t) => t.path));
  assert.deepEqual(doors, want, 'the strips and PAGES list the same doors');
  for (const p of Object.values(PAGES).filter((x) => x.tabs.length)) assert.ok(tabs.includes(`<Tab to="${p.tabs[0].path}" end `), `${p.title}'s Overview is lit only on its own address`);
  const catalogue = codeOnly(read('frontend/src/pages/admin/programs/ProgramsCatalogue.jsx'));
  for (const d of PROGRAM_DOORS) assert.ok(catalogue.includes(`<Link to="${d}"`), `the ${d} door is not literal`);
});

test('the pages read only D953 §2\'s reads through existing clients, and draw nothing §3 leaves undrawn', () => {
  const src = PROGRAM_FILES.map((f) => codeOnly(read(f))).join('\n');
  for (const call of ['api.adminStudioGlance(', "api.adminLabHosts('pending')", 'api.perkReviewQueue(', 'api.perksCatalog(', 'api.adminAdvisorCohortAssignments(',
    'api.adminCohortTimeline(', 'api.adminReferralSubmissions(', 'learningApi.assignedPrograms(', 'learningApi.programLearners(', 'adminTestingApi.programmes(',
    'insightsApi.insightsScopes(', 'api.perkReview(']) assert.ok(src.includes(call), `the pages no longer read ${call}`);
  const clients = [...src.matchAll(/import \{([^}]+)\} from '[./]+lib\/api(?:\/(\w+))?'/g)]
    .flatMap((imp) => imp[1].split(',').map((s) => `${imp[2] || 'api'}:${s.trim()}`).filter((s) => !s.endsWith(':')));
  assert.deepEqual([...new Set(clients)].sort(), ['api:api', 'insights:insightsApi', 'learning:learningApi', 'productTesting:adminTestingApi'],
    'the existing clients, each from its own module (lib/api re-exports them, but a named import of lib/api must name what api.js itself declares)');
  assert.doesNotMatch(src, /adminSpinoutApplications|adminSpinoutParticipants|spinout-applications|spinout-participants/, 'Guard H');
  assert.doesNotMatch(src, /window\.confirm|useToast|dangerouslySetInnerHTML|<svg|recharts|Export CSV|Propose a program|Pause program/);
  assert.doesNotMatch(src, /\?\? 0\b/, 'no zero standing in for a value');
  for (const sample of ['[Studio Lisbon]', '[48]', '[A venture program', 'Granted to your studio', '0 credits']) assert.ok(!src.includes(sample), `a canvas sample reached the pages: ${sample}`);
  assert.match(read('frontend/src/pages/admin/programs/programsModel.js'), /import \{ parseStamp \} from '\.\.\/\.\.\/\.\.\/ui\/parseStamp\.js';/);
  assert.doesNotMatch(src, /\bprogramme\b/i, 'spelling: "program" in all new copy');
});

test('docs: the folder is documented, the admin README names it, ROUTE_MAP has the row', () => {
  assert.ok(existsSync(resolve(root, 'frontend/src/pages/admin/programs/README.md')));
  const readme = read('frontend/src/pages/admin/programs/README.md');
  for (const f of PROGRAM_FILES.map((p) => p.split('/').pop())) assert.ok(readme.includes(`\`${f}\``), `the README does not name ${f}`);
  assert.match(read('scripts/check-folder-docs.mjs'), /\['frontend\/src\/pages\/admin\/programs', +'Admin › Programs \(D953\)/);
  const admin = read('frontend/src/pages/admin/README.md');
  assert.match(admin, /`programs\/` is D953's Admin › Programs[\s\S]*see its own README/);
  assert.doesNotMatch(admin, /`HeldPrograms\.jsx`/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /\n\| Admin · Programs \| admin, super-admin \| [^|]+ \| `\/admin\/programs` live \(D953, #2371\)/);
});
