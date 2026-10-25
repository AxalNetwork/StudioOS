/**
 * D962 (#2795) — Programs part 9: Mentor cohort access, Refer & Earn, Perks
 * and Learning complete on parts 1, 4 and 7's reads.
 *
 * What this file holds the pages to (#2795's "Done when"):
 *   · each tab present only where its part fills it: Activity on the four
 *     pages, no Terms tab anywhere;
 *   · each dialog, its refusals in place keyed on `code`, and its result in place;
 *   · an already-active pair marked and not sent, and the Worker's 409
 *     `already_assigned` drawn in the dialog;
 *   · Mentor's Activity line on founders' hides and role changes;
 *   · the referral timeline from part 4's single-referral read, and Status
 *     sent only when it changed;
 *   · Founders visible as "—" on ended, role-changed and deactivated rows;
 *   · an Admin's Credits held by members as "Not read here yet";
 *   · People and Assign on a phone.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_programs_d962.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { pageKeyFor } from '../src/lib/railPages.js';
import MentorCohortAccess from '../src/pages/admin/programs/MentorCohortAccess.jsx';
import ReferAndEarn from '../src/pages/admin/programs/ReferAndEarn.jsx';
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import { HQ_READS_MONEY, NOT_READ_YET, PAGES, routeFor } from '../src/pages/admin/programs/programsModel.js';
import {
  ACTIVE_PAIR, ASSIGNED_DONE, CREDITS_FOOT, ENDED_DONE, FUNNEL_REASON, LEARNER_FOOT, MENTOR_ACTIVITY_GAP, REFUSALS,
  REVIEW_MOVES, REVIEW_SAVED, REVIEW_TOLD, VISIBLE_DASH, activityText, completionRows, cohortPlace, endedInWindow,
  episodesOf, finishedTotal, hasFinished, hiddenFrom, isDone, listingActions, listingBody, mentorsPerCohort, peopleRows,
  playbookFrom, refusalSentence, reviewPatch, sectionEdit, statusChoices, versionLine,
} from '../src/pages/admin/programs/programPagesModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const NOW = Date.now();
const H = 3_600_000;
const DAY = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const d1 = (ms) => iso(ms).slice(0, 19).replace('T', ' ');
const ready = (data) => ({ status: 'ready', data, error: null, at: NOW });
const failed = (error = { status: 503 }) => ({ status: 'error', data: null, error, at: null });

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends
 * ------------------------------------------------------------------ */

// R7 — cycles: one running (week 2 open), one scheduled, one ended, one postponed.
const cycle = (id, year, month, status, o = {}) => ({
  id, year, month, status, app_status: 'open',
  start_at: iso(Date.UTC(year, month - 1, 1, 5)), end_at: iso(Date.UTC(year, month - 1, 29, 5)), windows: [], ...o,
});
const RUNNING = cycle(1, 2026, 10, 'active', {
  start_at: iso(NOW - 10 * DAY), end_at: iso(NOW + 18 * DAY),
  windows: [{ week_number: 1, unlock_at: iso(NOW - 10 * DAY), deadline_at: iso(NOW - 3 * DAY) }, { week_number: 2, unlock_at: iso(NOW - 3 * DAY), deadline_at: iso(NOW + 4 * DAY) }],
});
const SCHEDULED = cycle(2, 2026, 12, 'scheduled', { start_at: iso(NOW + 30 * DAY), end_at: iso(NOW + 58 * DAY) });
const ENDED = cycle(3, 2026, 8, 'completed', { start_at: iso(NOW - 90 * DAY), end_at: iso(NOW - 62 * DAY) });
const CYCLES = [SCHEDULED, RUNNING, ENDED];

// R5 — an assignment (D960 adds `advisor_is_active` and `founders_hidden`).
const assignment = (id, advisor, cycleId, o = {}) => ({
  id, uid: `a${id}`, advisor_user_id: advisor, cohort_cycle_id: cycleId, assigned_at: d1(NOW - 20 * DAY), unassigned_at: null,
  is_active: true, note: null, advisor_name: `Mentor ${advisor}`, advisor_email: `m${advisor}@example.com`, advisor_role: 'advisor',
  advisor_is_active: true, founders_hidden: 0, ...o,
});
const ROWS = [
  assignment(1, 11, 1, { note: 'Fintech founders' }),
  assignment(2, 12, 1, { advisor_role: 'investor', advisor_name: 'Ana Former' }),
  assignment(3, 13, 1, { advisor_is_active: false, advisor_name: 'Dee Activated' }),
  assignment(4, 14, 3, { is_active: false, unassigned_at: d1(NOW - 5 * DAY) }),
];
// The only holder of the scheduled cycle is deactivated, so it reads uncovered.
ROWS.push(assignment(5, 15, 2, { advisor_is_active: false, advisor_name: 'Old Holder' }));
const HISTORY = [
  { kind: 'ended', created_at: d1(NOW - 5 * DAY), assignment_id: 4, advisor_user_id: 14, cohort_cycle_id: 3, by_admin: true },
  { kind: 'assigned', created_at: d1(NOW - 20 * DAY), assignment_id: 1, advisor_user_id: 11, cohort_cycle_id: 1, by_admin: true },
  { kind: 'ended', created_at: d1(NOW - 40 * DAY), assignment_id: 1, advisor_user_id: 11, cohort_cycle_id: 1, by_admin: false },
  { kind: 'assigned', created_at: d1(NOW - 60 * DAY), assignment_id: 1, advisor_user_id: 11, cohort_cycle_id: 1, by_admin: true },
];

// R8/F1 — a referral (`toWire` plus the referrer's name).
const referral = (uid, status, ageH, o = {}) => ({
  uid, category: 'startup', category_name: 'Startup / founder referrals', referred_name: `Referred ${uid}`, referred_org: 'Bluefern Health',
  status, next_step: 'Book a call', reward_label: null, fit_notes: null, created_at: d1(NOW - ageH * H), updated_at: d1(NOW - ageH * H),
  referrer_name: `Referrer ${uid}`, referrer_email: `r${uid}@example.com`, your_role: 'Founder', ...o,
});
// K1 — a listing (`p.*`).
const listing = (uid, status, o = {}) => ({
  uid, status, offer: `Offer ${uid}`, partner_name: `Partner ${uid}`, kind: 'credits', credits: 200, required_tier: null, price_cents: null,
  review_note: null, featured: 0, editorial_note: null, created_at: d1(NOW - 50 * H), updated_at: d1(NOW - 30 * H), ...o,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the tabs: Activity on the four pages only where part 1 fills it, and no page has a Terms tab', () => {
  const labels = Object.fromEntries(Object.entries(PAGES).map(([k, p]) => [k, p.tabs.map((t) => t.label)]));
  for (const k of ['mentor-cohorts', 'refer-and-earn', 'perks', 'learning']) assert.equal(labels[k].at(-1), 'Activity', k);
  for (const k of ['referral-partners', 'investor-cohorts', 'ai-native-venture']) assert.ok(!labels[k].includes('Activity'), `${k} is part 10's`);
  assert.ok(Object.values(labels).every((l) => !l.includes('Terms')), 'part 1’s store holds no program’s terms');
  for (const [k, p] of [['mentor-cohorts', '/admin/programs/mentor-cohorts/activity'], ['refer-and-earn', '/admin/programs/refer-and-earn/activity'],
    ['perks', '/admin/programs/perks/activity'], ['learning', '/admin/programs/learning/activity']]) {
    assert.deepEqual(routeFor(p), { program: k, tab: 'activity' });
  }
  // Each tab resolves to its page's rail key; the subtrees are the existing aliases.
  assert.equal(pageKeyFor('/admin/programs/mentor-cohorts/activity', 'admin'), 'Admin · Approvals · Advisor cohort access');
  assert.equal(pageKeyFor('/admin/programs/refer-and-earn/activity', 'admin'), 'Admin · Approvals · Referrals');
  assert.equal(pageKeyFor('/admin/programs/perks/activity', 'admin'), 'Admin · Programs');
  assert.equal(pageKeyFor('/admin/programs/learning/activity', 'admin'), 'Admin · Programs');
  const app = read('frontend/src/App.jsx');
  for (const [p, c] of [['/admin/programs/mentor-cohorts/activity', 'AdminMentorCohortAccess'], ['/admin/programs/refer-and-earn/activity', 'AdminReferAndEarn'],
    ['/admin/programs/perks/activity', 'AdminProgramPage'], ['/admin/programs/learning/activity', 'AdminProgramPage']]) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <${c} />)} />`), p);
  }
});

test('D957’s referral moves are the Worker’s, one for one, and the dialog offers only them', () => {
  const src = read('cloudflare-worker/src/services/referralSubmissions.ts');
  const block = src.slice(src.indexOf('export const REVIEW_MOVES'), src.indexOf('};', src.indexOf('export const REVIEW_MOVES')) + 2);
  const json = block.slice(block.indexOf('{')).replace(/;$/, '').replace(/'/g, '"').replace(/(\w+):/g, '"$1":').replace(/,(\s*[}\]])/g, '$1');
  assert.deepEqual({ ...REVIEW_MOVES }, JSON.parse(json));
  assert.deepEqual(statusChoices('under_review'), ['under_review', 'more_info_needed', 'qualified', 'rejected', 'closed']);
  assert.deepEqual(statusChoices('rejected'), ['rejected'], 'a rejection is final');
});

test('Save sends Status only when it moved, each field only when it changed, and the note only when written', () => {
  const row = referral('x', 'under_review', 5, { fit_notes: 'Strong fit' });
  assert.equal(reviewPatch(row, { status: 'under_review', nextStep: 'Book a call', rewardLabel: '', fitNotes: 'Strong fit', note: '' }), null);
  assert.deepEqual(reviewPatch(row, { status: 'under_review', nextStep: 'Book a call', rewardLabel: '', fitNotes: 'Strong fit', note: ' Thanks ' }), { note: 'Thanks' });
  assert.deepEqual(reviewPatch(row, { status: 'qualified', nextStep: 'Intro', rewardLabel: '', fitNotes: '', note: '' }), { status: 'qualified', nextStep: 'Intro', fitNotes: null });
  assert.equal(reviewPatch(row, { status: 'under_review', nextStep: 'x'.repeat(300), rewardLabel: '', fitNotes: 'Strong fit', note: '' }).nextStep.length, 240);
});

test('OD9: Done is a course or item completed, an exercise accepted, an exam passed; Finished is every row Done', () => {
  assert.equal(isDone({ subject_kind: 'course', status: 'completed' }), true);
  assert.equal(isDone({ subject_kind: 'item', status: 'in_progress' }), false);
  assert.equal(isDone({ subject_kind: 'exercise', status: 'submitted' }), false);
  assert.equal(isDone({ subject_kind: 'exercise', status: 'accepted' }), true);
  assert.equal(isDone({ subject_kind: 'exam', status: 'not_passed' }), false);
  assert.equal(isDone({ subject_kind: 'exam', status: 'passed' }), true);
  assert.equal(hasFinished({ completion: [] }), false, 'a program with no contents has no one finished');
  const done = { completion: [{ subject_kind: 'course', status: 'completed' }, { subject_kind: 'exam', status: 'passed' }] };
  const notYet = { completion: [{ subject_kind: 'course', status: 'completed' }, { subject_kind: 'exercise', status: 'needs_work' }] };
  const rows = completionRows([{ uid: 'l1', name: 'Founder basics' }, { uid: 'l4', name: 'Fundraising' }], { l1: ready({ learners: [done, notYet] }), l4: failed() });
  assert.deepEqual(rows.map((r) => [r.state, r.finished ?? null, r.learners ?? null]), [['ready', 1, 2], ['unreadable', null, null]]);
  assert.equal(finishedTotal(rows).state, 'unreadable', 'a program whose learners could not be read makes no total');
  assert.deepEqual(finishedTotal(rows.slice(0, 1)), { state: 'ready', count: 1 });
});

test('Mentor: Ended is the last 30 days from 565’s history, "at least" past a full page; Founders hidden is null-honest', () => {
  assert.deepEqual(endedInWindow(ready({ items: HISTORY, total: HISTORY.length }), NOW), { state: 'ready', count: 1, atLeast: false, text: '1' });
  const full = Array.from({ length: 200 }, (_, i) => ({ kind: i % 2 ? 'ended' : 'assigned', created_at: d1(NOW - i * H), assignment_id: i }));
  assert.equal(endedInWindow(ready({ items: full, total: 500 }), NOW).text, 'at least 100');
  assert.equal(endedInWindow(failed(), NOW).state, 'unreadable');
  assert.deepEqual(hiddenFrom(ready({ items: ROWS, founders_hidden_total: 3 })), { state: 'ready', count: 3, text: '3' });
  assert.equal(hiddenFrom(ready({ items: ROWS, founders_hidden_total: null })).state, 'unreadable', 'D960’s null is never 0');
});

test('Mentor: Mentors per cohort draws one bar per cohort S-COV counts; a deactivated sole holder leaves it "None"', () => {
  const m = mentorsPerCohort(ready({ items: ROWS }), ready({ cycles: CYCLES }));
  assert.deepEqual(m.rows.map((r) => [r.label, r.value, r.text, r.tone]), [['October 2026', 1, '1 mentor', 'violet'], ['December 2026', 0, '! None', 'amber']]);
  assert.deepEqual(m.notes, ['December 2026 has no mentor yet.']);
  assert.ok(!/founders/.test(m.alt), 'no founder count until O-FND');
});

test('People: the columns, "—" for Founders visible on ended, role-changed and deactivated rows, and the earlier episodes', () => {
  const p = peopleRows(ready({ items: ROWS }), ready({ cycles: CYCLES }), ready({ items: HISTORY, total: 4 }), NOW);
  const by = Object.fromEntries(p.rows.map((r) => [r.id, r]));
  assert.equal(by[1].visible, null, 'an open Advisor row waits for O-FND');
  for (const id of [2, 3, 4]) assert.equal(by[id].visible, VISIBLE_DASH, `row ${id}`);
  assert.equal(by[1].cohort, 'October 2026 · week 2');
  assert.equal(by[5].cohort, 'December 2026 · not started');
  assert.equal(by[4].cohort, 'August 2026 · ended');
  assert.equal(by[1].note, 'Fintech founders');
  assert.match(by[1].assigned, / by an admin$/);
  assert.equal(by[2].notAdvisor, true);
  assert.equal(by[3].deactivated, true);
  assert.equal(by[1].earlier.length, 1, 'the episode a re-assign overwrote is drawn (N16)');
  assert.ok(!JSON.stringify(p.rows.map(({ row, ...r }) => r)).includes('@example.com'), 'no email column');
  assert.deepEqual(episodesOf(HISTORY, 1).map((e) => Boolean(e.to)), [true, false]);
  const unknown = peopleRows(ready({ items: [assignment(9, 19, 77)] }), ready({ cycles: CYCLES }), ready({ items: [], total: 0 }), NOW);
  assert.equal(unknown.rows[0].cohort, 'Cycle #77');
  assert.equal(cohortPlace(SCHEDULED, NOW), 'not started');
});

test('Activity: every kind is a sentence, a mentor row names its cohort and never the mentor, and an unknown kind still reads', () => {
  const cycles = CYCLES;
  assert.equal(activityText({ kind: 'advisor_cohort.assigned', by: 'admin', concerns: { cohort_cycle_id: 1 } }, cycles), 'A mentor was assigned to October 2026 by an admin');
  assert.equal(activityText({ kind: 'advisor_cohort.ended', by: 'hq', concerns: { cohort_cycle_id: 99 } }, cycles), 'A mentor’s access to cycle #99 was ended by HQ');
  assert.equal(activityText({ kind: 'referral.review', by: 'admin', concerns: { category: 'customer', status: 'qualified' } }), 'A platform user referral moved to Qualified by an admin');
  assert.equal(activityText({ kind: 'learning.program.enrol', by: 'admin', concerns: { learning_program: { name: 'Founder basics' } } }), 'A learner was enrolled in Founder basics by an admin');
  assert.equal(activityText({ kind: 'program.playbook.publish', by: 'hq', concerns: { version: 3 } }), 'Playbook version 3 was published by HQ');
  assert.equal(activityText({ kind: 'something.new', by: 'admin', concerns: {} }), 'A change was recorded by an admin');
});

test('Perks: the actions per state, Reject final with its note, Approve keeping the stored note, the feature switch an approve on live', () => {
  assert.deepEqual(listingActions(listing('a', 'in_review')), ['approve', 'reject']);
  assert.deepEqual(listingActions(listing('a', 'live')), ['pause', 'feature']);
  assert.deepEqual(listingActions(listing('a', 'live', { featured: 1 })), ['pause', 'unfeature']);
  assert.deepEqual(listingActions(listing('a', 'paused')), ['approve']);
  assert.deepEqual(listingActions(listing('a', 'rejected')), [], 'a rejection is final');
  assert.deepEqual(listingBody('approve', listing('a', 'in_review', { review_note: 'Seeded by HQ' })), { action: 'approve', review_note: 'Seeded by HQ' });
  assert.deepEqual(listingBody('reject', listing('a', 'in_review'), { note: ' Not a fit ' }), { action: 'reject', review_note: 'Not a fit' });
  assert.deepEqual(listingBody('unfeature', listing('a', 'live', { featured: 1 })), { action: 'approve', featured: false });
  assert.deepEqual(listingBody('pause', listing('a', 'live')), { action: 'pause' });
});

test('refusals are one sentence keyed on the code; a codeless 400 reads the Worker’s own sentence', () => {
  for (const code of ['already_assigned', 'already_ended', 'account_inactive', 'bad_transition', 'already_decided', 'not_reviewable', 'nothing_to_publish', 'not_assigned']) {
    assert.equal(refusalSentence({ status: 409, code }), REFUSALS[code], code);
  }
  assert.equal(refusalSentence({ status: 400, message: 'Only a user with the advisor role can be assigned a cohort' }), 'Only a user with the advisor role can be assigned a cohort. Nothing changed.');
  assert.equal(refusalSentence({ status: 500 }, 'Fallback.'), 'Fallback.');
});

test('the playbook: an Admin reads the published version; a Super Admin edits the draft, a computed section by its title only', () => {
  const detail = {
    program: { key: 'mentor-cohorts' },
    playbook: { published: true, version: 2, published_at: '2026-10-02 10:00:00', sections: [{ key: 'purpose', title: 'Purpose', body: 'Published text', computed: false, template_keys: [] }] },
    draft: { sections: [{ key: 'purpose', title: 'Purpose', body: 'Draft text\nSecond line', computed: false, template_keys: [] }, { key: 'cycle', title: 'The cycle', body: null, computed: true, template_keys: [] }], edited_at: '2026-10-20 09:00:00', differs: true },
  };
  const admin = playbookFrom(ready(detail), false);
  assert.deepEqual([admin.editing, admin.sections[0].lines], [false, ['Published text']]);
  const sup = playbookFrom(ready(detail), true);
  assert.deepEqual([sup.editing, sup.sections[0].lines, sup.differs], [true, ['Draft text', 'Second line'], true]);
  assert.equal(versionLine(sup), 'Version 2 · edited 20 Oct');
  assert.deepEqual(sectionEdit(sup.sections[1], { title: 'The cycle', body: 'ignored' }), {}, 'a computed section never sends a body');
  assert.deepEqual(sectionEdit(sup.sections[0], { title: 'Purpose', body: 'Draft text\nSecond line' }), {});
  assert.deepEqual(sectionEdit(sup.sections[0], { title: 'Why', body: '' }), { title: 'Why', body: null });
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const paged = (items, total = items.length) => ({ items, total });
const refusal = (status, code, message) => response({ error: code, message, detail: message }, status);

const ACTIVITY = {
  program: 'mentor-cohorts',
  rows: [
    { at: d1(NOW - 2 * DAY), kind: 'advisor_cohort.assigned', by: 'admin', concerns: { cohort_cycle_id: 1 } },
    { at: d1(NOW - 5 * DAY), kind: 'advisor_cohort.ended', by: 'hq', concerns: { cohort_cycle_id: 3 } },
  ],
  next_before: '2026-10-01 10:00:00~a:12', not_audited: null,
};
const PLAYBOOK = {
  program: { key: 'mentor-cohorts' },
  playbook: { published: true, version: 1, published_at: '2026-10-01 10:00:00', sections: [
    { key: 'purpose', title: 'Purpose', body: 'Give each Lab cohort advisors.', computed: false, template_keys: [] },
    { key: 'cycle', title: 'The cycle', body: null, computed: true, template_keys: [] },
    { key: 'terms', title: 'Terms and contracts', body: 'No contract template is linked to this program yet.', computed: false, template_keys: [] },
    { key: 'measure', title: 'How we measure it', body: 'Mentors per cohort', computed: false, template_keys: [] },
  ] },
};

function worker(o = {}) {
  const {
    user = null, assignments = { items: ROWS, founders_hidden_total: 2 }, history = paged(HISTORY), timeline = { cycles: CYCLES },
    assignable = { items: [{ id: 11, name: 'Mentor 11', email: 'm11@example.com', has_advisor_profile: true }, { id: 21, name: 'Mentor 21', email: 'm21@example.com', has_advisor_profile: false }] },
    activity = ACTIVITY, detail = PLAYBOOK, sessions = { cycles: [{ cycle_id: 1, year: 2026, month: 10, mentors: 2, sessions: 7 }], rule: 'Bookings not cancelled.' },
    referrals = (q) => paged([referral('s1', 'submitted', 2), referral('u1', 'under_review', 80)], 2), one = null, weekly = { from: '2026-08-03', items: [{ week: '2026-10-19', startup: 2, customer: 1, strategic: 0 }] },
    strategic = paged([{ user_id: 41, name: 'Ivy Investor', role: 'investor', note: 'Two family offices in Porto.', status: 'requested', requested_at: d1(NOW - 4 * DAY) }]),
    listings = (q) => paged([listing('p1', 'in_review', { review_note: 'Seeded by HQ' }), listing('p2', 'live')], 2),
    claims = { from: '2026-08-03', by_listing: [{ uid: 'p2', offer: 'Offer p2', partner_name: 'Partner p2', claims: 4, redeemed: 3 }], by_week: [{ week: '2026-10-19', kind_at_claim: 'credits', claims: 4, redeemed: 3 }], totals: {} },
    perks = { items: [{ uid: 'live1' }] }, glance = { tier: 'hq', approvals: { recorded: true, lanes: [{ key: 'referrals', count: 2, oldest_age_hours: 80, sla: 'past' }] } },
    learning = { programs: [{ uid: 'l1', name: 'Founder basics', region: 'Lisbon', status: 'published', enrolment: 'open', learners: 2, contents: 2, admins: 2 }] },
    learners = { l1: { learners: [
      { uid: 'u1', name: 'Lea Learner', enrolled_at: d1(NOW - 9 * DAY), completion: [{ subject_kind: 'course', status: 'completed' }, { subject_kind: 'exam', status: 'passed' }] },
      { uid: 'u2', name: 'Noa Notyet', enrolled_at: d1(NOW - 8 * DAY), completion: [{ subject_kind: 'course', status: 'completed' }, { subject_kind: 'exercise', status: 'submitted' }] },
    ] } },
    enrolments = { weeks: 12, by_week: [{ week: '2026-10-19', count: 3, to_date: true }], total: 3, programs: [] },
    learner = null, writes = {},
  } = o;
  // A fixture is a body, or a function of the query that answers a body or a response.
  const call = (v, ...a) => {
    const out = typeof v === 'function' ? v(...a) : v;
    return out && typeof out.json === 'function' ? out : response(out);
  };
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (method !== 'GET') {
      if (path === '/api/advisors/admin/cohort-assignments') return writes.assign ? writes.assign(options) : response({ id: 99, is_active: true, founders_notified: null });
      if (/^\/api\/advisors\/admin\/cohort-assignments\/\d+$/.test(path)) return writes.end ? writes.end(options, path) : response({ ok: true });
      if (/^\/api\/refer-earn\/admin\/submissions\/[^/]+$/.test(path)) return writes.referral ? writes.referral(options) : response({ ...referral('u1', 'under_review', 80), history: [{ label: 'Updated', status: null, note: 'Thanks', created_at: d1(NOW) }] });
      if (/^\/api\/refer-earn\/admin\/strategic-access\/\d+\/decision$/.test(path)) return writes.strategic ? writes.strategic(options) : response({ status: 'granted' });
      if (/^\/api\/perks\/admin\/[^/]+\/review$/.test(path)) return writes.perk ? writes.perk(options) : response({ ok: true, status: 'live' });
      if (/^\/api\/admin\/programs\/[^/]+\/playbook\/sections\/[^/]+$/.test(path)) return writes.section ? writes.section(options) : response(PLAYBOOK);
      if (/^\/api\/admin\/programs\/[^/]+\/playbook\/publish$/.test(path)) return writes.publish ? writes.publish(options) : response(PLAYBOOK);
      return never();
    }
    if (path === '/api/auth/me') return user ? response(user) : never();
    if (path === '/api/advisors/admin/cohort-assignments') return call(assignments);
    if (path === '/api/advisors/admin/cohort-assignments/assignable') return call(assignable);
    if (path === '/api/advisors/admin/cohort-assignments/history') return call(history, q);
    if (path === '/api/admin/cohort/timeline') return call(timeline);
    if (path === '/api/admin/lab-hosts') return response({ status: 'pending', items: [], counts: { pending: 0, approved: 1 } });
    if (path === '/api/admin/studio/glance') return call(glance);
    if (path === '/api/admin/programs/mentor-cohorts/sessions') return call(sessions);
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return call(activity, q, path);
    if (/^\/api\/admin\/programs\/[^/]+$/.test(path)) return call(detail, path);
    if (path === '/api/refer-earn/admin/submissions/weekly') return call(weekly);
    if (path === '/api/refer-earn/admin/submissions') return call(referrals, q);
    if (/^\/api\/refer-earn\/admin\/submissions\/[^/]+$/.test(path)) return call(one || { ...referral('u1', 'under_review', 80), history: [{ label: 'Submitted', status: 'submitted', note: null, created_at: d1(NOW - 80 * H) }, { label: 'Under review', status: 'under_review', note: null, created_at: d1(NOW - 60 * H) }] });
    if (path === '/api/refer-earn/admin/strategic-access') return call(strategic, q);
    if (path === '/api/perks/admin/listings') return call(listings, q);
    if (path === '/api/perks/admin/claims') return call(claims);
    if (path === '/api/perks') return call(perks);
    if (path === '/api/learning/programs/mine') return call(learning);
    if (path === '/api/learning/programs/mine/enrolments') return call(enrolments);
    const one2 = /^\/api\/learning\/programs\/([^/]+)\/learners\/([^/]+)$/.exec(path);
    if (one2) return call(learner || { program: { name: 'Founder basics', region: 'Lisbon' }, contents: [{ subject_kind: 'item', subject_uid: 'i1', title: 'Why validate first', kind: 'video' }, { subject_kind: 'exam', subject_uid: 'x1', title: 'Validation basics' }], learner: { uid: one2[2], name: 'Lea Learner', last_activity_at: d1(NOW - 2 * DAY), completion: [{ subject_kind: 'item', subject_uid: 'i1', status: 'completed', completed_at: d1(NOW - 3 * DAY) }, { subject_kind: 'exam', subject_uid: 'x1', status: 'not_passed', attempts: 2, best_score_percent: 60, passed_at: null }] } });
    const l = /^\/api\/learning\/programs\/([^/]+)\/learners$/.exec(path);
    if (l) return call(learners[l[1]] ?? { learners: [] });
    return never();
  };
}

const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };

async function mounted(url, page, handle, { user = null, phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const loc = useLocation(); at.path = `${loc.pathname}${loc.search}`; return null; }
  const tree = user ? h(AuthProvider, null, h(page), h(Probe)) : [h(page, { key: 'p' }), h(Probe, { key: 'q' })];
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, tree)));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, flush, at, text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async press(label, scope = null) {
      const pool = scope ? walk(byId(scope)) : nodes();
      const node = pool.find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}"`);
      assert.ok(!props(node).disabled, `"${label}" is disabled`);
      await act(async () => { await props(node).onClick(event); });
      await flush();
    },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async close() {
      await act(async () => rootNode.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      restore();
    },
  };
}

const writesTo = (view, pattern, method) => view.requests.filter((r) => r.method === method && pattern.test(r.url));

test('Mentor · Overview: four tiles, Mentors per cohort, Needs you that opens Assign with its cohort chosen, and Recent activity', async () => {
  const view = await mounted('/admin/programs/mentor-cohorts', MentorCohortAccess, worker());
  try {
    assert.equal(view.textOf('programs-tile-mentors-value'), '1', 'the demoted and the deactivated holders are not counted');
    assert.equal(view.textOf('programs-tile-hidden-value'), '2', 'part 7’s founders_hidden_total');
    assert.equal(view.textOf('programs-tile-ended-value'), '1');
    assert.match(view.textOf('programs-tile-ended'), /In the last 30 days\./);
    assert.match(view.textOf('programs-mentor-per-cohort'), /December 2026 has no mentor yet\./);
    assert.match(view.textOf('programs-mentor-recent'), /A mentor was assigned to October 2026 by an admin/);
    assert.match(view.textOf('programs-mentor-recent-gap'), new RegExp(MENTOR_ACTIVITY_GAP.slice(0, 30)));
    assert.ok(view.requests.some((r) => r.url === '/api/admin/programs/mentor-cohorts/activity?limit=5'), 'the five newest');
    assert.ok(view.hrefs().includes('/admin/programs/mentor-cohorts/activity'), 'See all goes to Activity');
    // A no-mentor row opens Assign with its cohort chosen.
    await view.click('programs-mentor-needs-cycle-2-act');
    assert.ok(view.has('programs-assign-dialog'));
    assert.equal(view.props('programs-assign-cohort').value, '2');
    await view.press('Back', 'programs-assign-dialog');
    // A role-changed row opens End access on that row.
    await view.click('programs-mentor-needs-row-2-act');
    assert.match(view.textOf('programs-end-dialog'), /Ana Former can no longer read October 2026’s founders\./);
  } finally { await view.close(); }
});

test('Assign: an already-active pair is marked and nothing is sent; the Worker’s 409 already_assigned sits in the dialog; a grant answers in place', async () => {
  let reply = () => refusal(409, 'already_assigned', 'This mentor already has access to this cohort, so nothing changed.');
  const view = await mounted('/admin/programs/mentor-cohorts/people', MentorCohortAccess, worker({ writes: { assign: () => reply() } }));
  try {
    await view.click('programs-mentor-assign');
    await view.click('programs-assign-advisor-11');
    await view.change('programs-assign-cohort', { value: '1' });
    assert.equal(view.textOf('programs-assign-active'), ACTIVE_PAIR);
    assert.equal(view.props('programs-assign-go').disabled, true, 'nothing is sent for an active pair');
    assert.equal(writesTo(view, /cohort-assignments$/, 'POST').length, 0);
    // A pair the page read as free, which the Worker says is held (another admin, meanwhile).
    await view.click('programs-assign-advisor-21');
    assert.match(view.textOf('programs-assign-advisor-21'), /No advisor profile yet/);
    await view.click('programs-assign-go');
    assert.equal(view.textOf('programs-assign-go-refusal'), REFUSALS.already_assigned);
    assert.deepEqual(JSON.parse(writesTo(view, /cohort-assignments$/, 'POST')[0].body), { advisor_user_id: 21, cohort_cycle_id: 1, note: null });
    reply = () => response({ id: 100, is_active: true, founders_notified: null });
    await view.click('programs-assign-go');
    assert.equal(view.textOf('programs-assign-go-done'), ASSIGNED_DONE);
    assert.match(view.textOf('programs-assign-grants'), /names and email addresses of the founders in October 2026/);
    assert.ok(!/founders told|notified/i.test(view.textOf('programs-assign-dialog')), 'no founders-told figure');
  } finally { await view.close(); }
});

test('People: the toolbar and columns, no email, "—" Founders visible, End access as a dialog whose 409 already_ended sits in place', async () => {
  let end = () => refusal(409, 'already_ended', 'This access has already ended, so nothing changed.');
  const view = await mounted('/admin/programs/mentor-cohorts/people', MentorCohortAccess, worker({ writes: { end: () => end() } }));
  try {
    assert.match(view.textOf('advisor-cohort-count'), /^1–5 of 5$/);
    assert.ok(!/@example\.com/.test(view.textOf('advisor-cohort-table')), 'the email is not drawn');
    assert.equal(view.textOf('advisor-cohort-row-2-visible'), VISIBLE_DASH);
    assert.equal(view.textOf('advisor-cohort-row-3-visible'), VISIBLE_DASH);
    assert.equal(view.textOf('advisor-cohort-row-4-visible'), VISIBLE_DASH);
    assert.equal(view.textOf('advisor-cohort-row-1-visible'), NOT_READ_YET);
    assert.ok(view.has('advisor-cohort-row-2-role') && view.has('advisor-cohort-row-3-deactivated'));
    assert.match(view.textOf('advisor-cohort-row-1-earlier'), /^Earlier: /);
    assert.ok(!view.has('advisor-cohort-row-4-end'), 'End access is offered on active rows only');
    assert.match(view.textOf('advisor-cohort-foot'), /Ended access stays on record\./);
    await view.change('advisor-cohort-filter-role', { checked: true });
    assert.match(view.textOf('advisor-cohort-count'), /^1–1 of 1$/);
    await view.click('advisor-cohort-row-2-end');
    assert.equal(writesTo(view, /cohort-assignments\/2$/, 'DELETE').length, 0, 'the dialog says what ending does first');
    await view.click('programs-end-go');
    assert.equal(view.textOf('programs-end-go-refusal'), REFUSALS.already_ended);
    end = () => response({ ok: true, id: 2, is_active: false, founders_notified: null });
    await view.click('programs-end-go');
    assert.equal(view.textOf('programs-end-go-done'), ENDED_DONE);
  } finally { await view.close(); }
});

test('People and Assign on a phone: cards with a count line and a 44 px menu, no header button, and Assign as a page with ‹ People', async () => {
  const view = await mounted('/admin/programs/mentor-cohorts/people', MentorCohortAccess, worker(), { phone: true });
  try {
    assert.ok(!view.has('programs-mentor-assign'), 'no header buttons on a phone');
    assert.ok(view.has('advisor-cohort-cards') && !view.has('advisor-cohort-table'));
    assert.match(view.textOf('advisor-cohort-card-1'), /October 2026 · week 2 · Not read here yet visible/);
    assert.match(view.props('advisor-cohort-card-1-menu').className, /h-\[44px\] w-\[44px\]/);
    assert.ok(!view.has('advisor-cohort-card-4-menu'), 'an ended row has no menu');
    await view.click('advisor-cohort-phone-assign');
    assert.ok(view.text().includes('‹ People'), 'the page’s bar steps back to People');
    assert.ok(view.has('programs-assign-search'));
  } finally { await view.close(); }
  const over = await mounted('/admin/programs/mentor-cohorts', MentorCohortAccess, worker(), { phone: true });
  try {
    assert.ok(over.has('programs-mentor-needs') && over.has('programs-tile-mentors'), 'PG20b: the tiles and Needs you');
    assert.ok(!over.has('programs-mentor-per-cohort'), 'the phone board draws tiles and Needs you only');
  } finally { await over.close(); }
});

test('Mentor · Activity: the read’s rows, its line on founders’ hides and role changes, and Show older on the cursor', async () => {
  const view = await mounted('/admin/programs/mentor-cohorts/activity', MentorCohortAccess, worker());
  try {
    assert.equal(view.textOf('programs-mentor-activity-gap'), MENTOR_ACTIVITY_GAP);
    assert.match(view.textOf('programs-mentor-activity-row-1'), /A mentor’s access to August 2026 was ended by HQ/);
    await view.click('programs-mentor-activity-older');
    assert.ok(view.requests.some((r) => r.url.includes('before=2026-10-01+10%3A00%3A00%7Ea%3A12')), 'the next page reads from the cursor');
  } finally { await view.close(); }
  const empty = await mounted('/admin/programs/mentor-cohorts', MentorCohortAccess, worker({ assignments: { items: [], founders_hidden_total: 0 } }));
  try {
    assert.match(empty.textOf('programs-mentor-none'), /No mentors yet\.Assign one before December 2026 starts\./);
  } finally { await empty.close(); }
  const down = await mounted('/admin/programs/mentor-cohorts', MentorCohortAccess, worker({ assignments: () => response({ error: 'down' }, 503) }));
  try {
    assert.ok(!down.has('programs-mentor-none'), 'a failed read is never "No mentors yet."');
    assert.match(down.textOf('programs-tile-hidden'), /Could not be read/);
  } finally { await down.close(); }
});

test('Mentor · How it runs: part 1’s published playbook for an Admin, with the measures read now; a Super Admin edits and publishes through dialogs', async () => {
  const view = await mounted('/admin/programs/mentor-cohorts/how-it-runs', MentorCohortAccess, worker());
  try {
    assert.match(view.textOf('programs-mentor-how-purpose'), /Set by HQGive each Lab cohort advisors\./);
    assert.equal(view.textOf('programs-mentor-how-foot'), 'HQ writes the playbook.');
    assert.match(view.textOf('programs-mentor-measure-hidden'), /^Founders hidden2 now/);
    assert.match(view.textOf('programs-mentor-measure-sessions'), /7 across the 1 newest cohorts/);
    assert.ok(view.has('programs-mentor-terms-none'));
    assert.ok(!view.has('programs-mentor-how-publish'), 'an Admin cannot publish');
  } finally { await view.close(); }
  const draft = { ...PLAYBOOK, draft: { sections: PLAYBOOK.playbook.sections, edited_at: null, differs: false } };
  let publish = () => refusal(409, 'nothing_to_publish', 'The draft is the same as the published playbook.');
  const sup = await mounted('/admin/programs/mentor-cohorts/how-it-runs', MentorCohortAccess,
    worker({ user: SUPER, detail: draft, writes: { section: () => response({ ...draft, draft: { ...draft.draft, differs: true, edited_at: d1(NOW) } }), publish: () => publish() } }), { user: SUPER });
  try {
    assert.equal(sup.textOf('programs-mentor-how-version'), 'Version 1 · not edited since it was published');
    assert.equal(sup.props('programs-mentor-how-publish').disabled, true, 'nothing to publish yet');
    await sup.click('programs-mentor-how-purpose-edit');
    await sup.change('programs-playbook-edit-body', { value: 'A sharper purpose.' });
    await sup.click('programs-playbook-edit-go');
    assert.deepEqual(JSON.parse(writesTo(sup, /playbook\/sections\/purpose$/, 'PUT')[0].body), { body: 'A sharper purpose.' }, 'only what changed');
    await sup.click('programs-mentor-how-publish');
    await sup.click('programs-playbook-publish-go');
    assert.equal(sup.textOf('programs-playbook-publish-go-refusal'), REFUSALS.nothing_to_publish);
  } finally { await sup.close(); }
});

test('Refer & Earn · Overview: exact totals with their window, the funnel’s current tags, the weekly chart, and Grant through a dialog', async () => {
  const totals = { 'submitted,under_review,more_info_needed': 5, '': 48, 'converted,reward_eligible,reward_issued': 9, submitted: 2, under_review: 2, more_info_needed: 1, rejected: 5, closed: 2 };
  let decide = () => refusal(409, 'already_decided', 'Strategic referral access is already granted.');
  const view = await mounted('/admin/programs/refer-and-earn', ReferAndEarn, worker({
    referrals: (q) => (q.get('limit') === '1' ? paged([], totals[q.get('status') || ''] ?? 0) : paged([referral('o1', 'submitted', 100), referral('o2', 'under_review', 10)], 5)),
    writes: { strategic: () => decide() },
  }));
  try {
    assert.equal(view.textOf('programs-tile-referrals-value'), '48');
    assert.match(view.textOf('programs-tile-referrals'), /All time\./);
    assert.equal(view.textOf('programs-tile-converted-value'), '9');
    assert.equal(view.textOf('programs-tile-waiting-value'), '5');
    assert.ok(view.has('programs-tile-waiting-overdue'), 'Overdue from R1’s referrals lane');
    assert.match(view.textOf('programs-refer-bands'), /of the oldest 2 of 5/, 'the bands say what they cover');
    assert.match(view.textOf('programs-refer-funnel-bars'), new RegExp(FUNNEL_REASON.slice(0, 40)));
    assert.equal(view.textOf('programs-refer-funnel-rejected'), 'Rejected 5');
    assert.match(view.textOf('programs-refer-weekly-window'), /The last 12 weeks/);
    assert.ok(!/No one can be granted access yet/.test(view.textOf('programs-refer-strategic')), 'that line goes once Grant ships');
    assert.equal(writesTo(view, /\/decision$/, 'POST').length, 0);
    await view.click('programs-refer-strategic-41-grant');
    await view.click('programs-strategic-go');
    assert.equal(view.textOf('programs-strategic-go-refusal'), REFUSALS.already_decided);
    decide = () => response({ status: 'granted' });
    await view.click('programs-strategic-go');
    assert.match(view.textOf('programs-strategic-go-done'), /^Granted\./);
    assert.deepEqual(JSON.parse(writesTo(view, /strategic-access\/41\/decision$/, 'POST')[1].body), { decision: 'granted' });
  } finally { await view.close(); }
});

test('Refer & Earn · Queue: part 4’s pages with their total, waiting longest first; the referral opens with its timeline and sends Status only when it moved', async () => {
  let save = null;
  const view = await mounted('/admin/programs/refer-and-earn/queue', ReferAndEarn, worker({ writes: { referral: (o) => (save ? save(o) : response({ ...referral('u1', 'under_review', 80), history: [{ label: 'Updated', status: null, note: 'Thanks', created_at: d1(NOW) }] })) } }));
  try {
    const list = view.requests.find((r) => r.url.startsWith('/api/refer-earn/admin/submissions?') && r.url.includes('limit=25'));
    const q = new URLSearchParams(list.url.split('?')[1]);
    assert.deepEqual([q.get('status'), q.get('sort'), q.get('offset')], ['submitted,under_review,more_info_needed', 'oldest', '0']);
    assert.equal(view.textOf('referral-review-count'), '1–2 of 2');
    assert.ok(!/toast/i.test(codeOnly(read('frontend/src/pages/admin/ReferralReview.jsx'))), 'no corner toast');
    await view.click('referral-review-open-u1');
    assert.match(view.textOf('referral-dialog-timeline'), /Submitted.*Under review/);
    assert.ok(view.requests.some((r) => r.url === '/api/refer-earn/admin/submissions/u1'), 'part 4’s single-referral read');
    assert.equal(view.textOf('referral-dialog-told'), REVIEW_TOLD);
    const options = view.props('referral-dialog-status').children.map((c) => c.props.value);
    assert.deepEqual(options, ['under_review', 'more_info_needed', 'qualified', 'rejected', 'closed'], 'only D957’s moves');
    await view.change('referral-dialog-note', { value: 'Thanks' });
    await view.click('referral-dialog-save');
    assert.deepEqual(JSON.parse(writesTo(view, /submissions\/u1$/, 'PATCH')[0].body), { note: 'Thanks' }, 'Status is not sent when it did not move');
    assert.equal(view.textOf('referral-dialog-done'), REVIEW_SAVED);
    assert.match(view.textOf('referral-dialog-timeline'), /UpdatedThanks/, 'the timeline is the history the PATCH returned');
    save = () => refusal(409, 'bad_transition', 'That move is not allowed.');
    await view.change('referral-dialog-status', { value: 'qualified' });
    await view.click('referral-dialog-save');
    assert.equal(JSON.parse(writesTo(view, /submissions\/u1$/, 'PATCH')[1].body).status, 'qualified');
    assert.equal(view.textOf('referral-dialog-save-refusal'), REFUSALS.bad_transition);
  } finally { await view.close(); }
});

test('Perks · Overview: claims with their window; an Admin’s Credits held reads "Not read here yet" with "HQ reads these figures."', async () => {
  const view = await mounted('/admin/programs/perks', ProgramPage, worker());
  try {
    assert.equal(view.textOf('programs-tile-claims-value'), '4 · 3 redeemed');
    assert.match(view.textOf('programs-tile-claims'), /The last 12 weeks/);
    assert.equal(view.textOf('programs-tile-waiting-value'), '2', 'the listings in review, exact');
    assert.match(view.textOf('programs-tile-credits'), new RegExp(`${NOT_READ_YET}${HQ_READS_MONEY.replace('.', '\\.')}`));
    assert.ok(view.has('programs-perks-credits-locked') && !view.has('programs-perks-credits'));
  } finally { await view.close(); }
  const sup = await mounted('/admin/programs/perks', ProgramPage, worker({ user: SUPER }), { user: SUPER });
  try {
    await sup.click('programs-perks-credits-open');
    assert.equal(sup.textOf('programs-credits-foot'), CREDITS_FOOT, 'the member sees the amount and the note');
  } finally { await sup.close(); }
});

test('Perks · Queue: every state paged with its total; Reject needs its reason, a refusal sits in the dialog, Approve keeps the stored note', async () => {
  let perk = () => refusal(409, 'not_reviewable', 'This listing is live; reject does not apply to that state.');
  const view = await mounted('/admin/programs/perks/queue', ProgramPage, worker({ writes: { perk: (o) => perk(o) } }));
  try {
    assert.equal(view.textOf('programs-perks-count'), '1–2 of 2');
    const q = new URLSearchParams(view.requests.find((r) => r.url.startsWith('/api/perks/admin/listings?') && r.url.includes('limit=25')).url.split('?')[1]);
    assert.deepEqual([q.get('status'), q.get('sort')], ['in_review', 'oldest']);
    await view.click('programs-perks-row-p1-reject');
    assert.equal(view.props('programs-listing-go').disabled, true, 'Reject needs the note the partner sees');
    await view.change('programs-listing-note', { value: 'Not a fit for founders' });
    await view.click('programs-listing-go');
    assert.equal(view.textOf('programs-listing-go-refusal'), REFUSALS.not_reviewable);
    await view.press('Back', 'programs-listing-dialog');
    perk = () => response({ ok: true, status: 'live' });
    await view.click('programs-perks-row-p1-approve');
    assert.match(view.textOf('programs-listing-stored'), /Seeded by HQ/);
    await view.click('programs-listing-go');
    assert.deepEqual(JSON.parse(writesTo(view, /perks\/admin\/p1\/review$/, 'POST').at(-1).body), { action: 'approve', review_note: 'Seeded by HQ' });
    assert.match(view.textOf('programs-listing-go-done'), /^Approved\./);
    assert.ok(view.has('programs-perks-row-p2-pause') && view.has('programs-perks-row-p2-feature'), 'a live listing pauses and features');
  } finally { await view.close(); }
});

test('Learning: Finished by OD9’s rule, enrolments with their window and assigned admins; a learner opens their record, never an email', async () => {
  const view = await mounted('/admin/programs/learning', ProgramPage, worker());
  try {
    assert.equal(view.textOf('programs-tile-finished-value'), '50%');
    assert.match(view.textOf('programs-tile-finished'), /1 of 2/);
    assert.equal(view.textOf('programs-tile-enrolled-value'), '3');
    assert.match(view.textOf('programs-tile-enrolled'), /A re-enrolment counts again\./);
    assert.equal(view.textOf('programs-learning-row-l1-admins'), '2');
  } finally { await view.close(); }
  const people = await mounted('/admin/programs/learning/people', ProgramPage, worker());
  try {
    await people.change('programs-learning-pick', { value: 'l1' });
    await people.click('programs-learning-learner-u1-open');
    assert.match(people.textOf('programs-learner-row-item-i1'), /^VideoWhy validate firstDone/);
    assert.match(people.textOf('programs-learner-row-exam-x1'), /Best 60% · 2 attempts.*Not yet/);
    assert.equal(people.textOf('programs-learner-foot'), LEARNER_FOOT);
    assert.ok(!/@/.test(people.textOf('programs-learner-dialog')));
  } finally { await people.close(); }
  const refused = await mounted('/admin/programs/learning/people', ProgramPage, worker({ learner: () => refusal(403, 'not_assigned', 'You can follow the learners of programs assigned to you.') }));
  try {
    await refused.change('programs-learning-pick', { value: 'l1' });
    await refused.click('programs-learning-learner-u1-open');
    assert.equal(refused.textOf('programs-learner-refused'), REFUSALS.not_assigned);
  } finally { await refused.close(); }
});

test('the source: every write is a dialog, no corner toast, part 1’s client in its own module, and /perks links its Review queue', () => {
  const files = ['MentorCohortAccess.jsx', 'MentorDialogs.jsx', 'ReferAndEarn.jsx', 'PerksPages.jsx', 'LearningPages.jsx', 'PlaybookEditor.jsx', 'ActivityTab.jsx']
    .map((f) => codeOnly(read(`frontend/src/pages/admin/programs/${f}`)));
  const src = [...files, codeOnly(read('frontend/src/pages/admin/AdvisorCohortAssignments.jsx')), codeOnly(read('frontend/src/pages/admin/ReferralReview.jsx'))].join('\n');
  assert.doesNotMatch(src, /ToastMessage|useToast|window\.confirm/);
  assert.match(read('frontend/src/lib/api.js'), /^export \* from '\.\/api\/programs\.js';$/m);
  assert.match(read('frontend/src/pages/PerksPage.jsx'), /k: 'review', label: 'Review queue', icon: ClipboardCheck, to: PERKS_REVIEW_PATH/);
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/PerksPage.jsx')), /api\.perkReview\(/);
  // Each write the pages make sits inside a Lightbox component's handler.
  for (const call of ['api.adminAssignAdvisorCohort(', 'api.adminEndAdvisorCohortAssignment(', 'api.adminReferralReview(', 'api.adminStrategicAccessDecision(', 'api.perkReview(', 'programsApi.editSection(', 'programsApi.publish(']) {
    const at = src.indexOf(call);
    assert.ok(at > 0, `${call} is not made`);
    const fn = src.lastIndexOf('function ', at);
    assert.match(src.slice(fn, src.indexOf('\n}\n', at)), /<Lightbox\b/, `${call} is not made from a dialog`);
  }
});
