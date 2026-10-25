/**
 * D949 (#2754) — the Lab's Participants tab (SL7), one participant (SL8) and
 * its three dialogs (SL8a–c), drawn from D946's read.
 *
 *   - the pure model (`participantsModel.js`) on rows shaped as the Worker
 *     sends them, worked out by hand;
 *   - the tab mounted on a stubbed `fetch`: the segments, the standing bar and
 *     its table, the filters and pages as the query the Worker gets, a failed
 *     read, the drawer, and each dialog's write and refusal;
 *   - the source: no browser pop-up anywhere in the Lab's files.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lab_participants_d949.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import LabParticipants from '../src/pages/admin/lab/LabParticipants.jsx';
import { tabOf } from '../src/pages/admin/lab/labModel.js';
import {
  GRACE_MAX, PARTICIPANTS_PATH, cannotDecide, cohortOptions, deadlineText, graceHours, historyRows, milestoneWord, participantOf,
  participantRow, participantsCount, queryOf, standingOf, toolsOf, weekCards,
} from '../src/pages/admin/lab/participantsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-11-10T15:00:00Z');

/** One row as `GET /api/admin/cohort/participants` sends it (D946 §2). */
const ROW = (o = {}) => ({
  user_id: 41, uid: 'u-41', name: 'Ada Founder', company: 'Bluefern Health', sector: 'Health', status: 'active', cohort: '2026-11',
  cohort_cycle_id: 3, started_at: '2026-11-01 04:00:00', week: 2, day: 10, days_left: 19, paused: false,
  progress: { done: 7, required: 10 }, this_week: 'at_risk', failed_week: null, deadline_at: '2026-11-15 05:00:00', grace_until: null,
  missing: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'], incorporated: false, moderation: null, ...o,
});
const PAGE = (items, o = {}) => ({
  available: true, items, total: items.length, limit: 25, offset: 0,
  standing: { on_track: 15, at_risk: 3, grace: 2, failed: 2, graduated: 0, not_in_cohort: 1, everyone: 23, needs_decision: 7 }, ...o,
});
const DETAIL = (o = {}) => ({
  available: true,
  participant: ROW(),
  weeks: [
    { week: 1, unlock_at: '2026-11-01 04:00:00', deadline_at: '2026-11-08 05:00:00', unlocked: true, status: 'passed', required: [{ key: 'project_created', completed: true }, { key: 'customer_interview_logged_1', completed: true }] },
    { week: 2, unlock_at: '2026-11-08 05:00:00', deadline_at: '2026-11-15 05:00:00', unlocked: true, status: 'pending', required: [{ key: 'okrs_created', completed: false }, { key: 'pitch_deck_drafted', completed: true }] },
    { week: 3, unlock_at: '2026-11-15 05:00:00', deadline_at: '2026-11-22 05:00:00', unlocked: false, status: 'pending', required: [{ key: 'any_of:advisor_meeting_booked|cofounder_request_sent', completed: false }] },
    { week: 4, unlock_at: '2026-11-22 05:00:00', deadline_at: '2026-11-29 05:00:00', unlocked: false, status: 'pending', required: [{ key: 'incorporation_completed', completed: false }] },
  ],
  tools: { unlocked: ['spinout-lab', 'projects', 'roadmap'], total: 20, all: ['spinout-lab', 'projects', 'roadmap', 'scoring'] },
  history: [{ at: '2026-11-08 05:00:00', week: 1, status: 'passed', by: 'clock' }, { at: '2026-11-03 14:00:00', week: 1, status: 'grace', by: 'admin' }],
  ...o,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a row: week and day, progress, this week, the deadline in ET, missing items in words, moderation', () => {
  const r = participantRow(ROW(), NOW);
  assert.deepEqual([r.weekDay, r.progress.text, r.thisWeek.word, r.deadline], ['W2 · D10', '7 / 10', 'At risk', '14 Nov 23:59 ET']);
  assert.equal(r.missing, 'Set 3+ OKRs, Draft Brand v1 +1');
  assert.deepEqual(r.moderation, { text: 'No open case', muted: true });
  assert.deepEqual([r.userId, r.cycleId, r.decideWeek, r.canDecide], [41, 3, 2, true]);
  const failed = participantRow(ROW({ this_week: 'failed', paused: true, failed_week: 1, week: 1 }), NOW);
  assert.deepEqual([failed.weekDay, failed.thisWeek.sub, failed.decideWeek], ['W1 · paused', 'Failed Week 1', 1]);
  assert.equal(participantRow(ROW({ this_week: 'grace', grace_until: '2026-11-16 05:00:00' }), NOW).thisWeek.sub, 'In grace until 16 Nov');
  // A field whose read failed says so; it is never a zero or "none".
  const unread = participantRow(ROW({ this_week: null, progress: null, missing: null, moderation: undefined, week: null }), NOW);
  assert.deepEqual([unread.thisWeek.word, unread.progress, unread.missing, unread.moderation.text, unread.weekDay], ['Not read', null, null, 'Not read', 'Not read']);
  assert.equal(participantRow(ROW({ missing: [] }), NOW).missing, 'Nothing');
  assert.equal(participantRow(ROW({ moderation: { state: 'under_review', since: '2026-11-09 08:00:00' } }), NOW).moderation.text, 'Under review');
  assert.equal(deadlineText('2026-11-15 05:00:00', NOW), '14 Nov 23:59 ET', 'a deadline stored as the next 00:00 ET reads as 23:59 the day before');
});

test('milestone keys in words, any-of read as one of, and an unknown key said rather than dropped', () => {
  assert.equal(milestoneWord('okrs_created'), 'Set 3+ OKRs');
  assert.equal(milestoneWord('any_of:advisor_meeting_booked|cofounder_request_sent'), 'One of: Establish advisor cadence or Decide co-founder track');
  assert.equal(milestoneWord('brand_new_key'), 'An item not named here');
});

test('the query: only what was chosen, Needs a decision by default, and the page as an offset', () => {
  assert.deepEqual(queryOf({}), { cohort: undefined, status: undefined, week: undefined, this_week: undefined, incorporated: undefined, needs: true, q: undefined, sort: 'days_left', limit: 25, offset: 0 });
  const q = queryOf({ show: 'everyone', cohort: '2026-11', thisWeek: 'grace', q: '  blue ', sort: 'progress', page: 3 });
  assert.deepEqual([q.needs, q.cohort, q.this_week, q.q, q.sort, q.offset], [false, '2026-11', 'grace', 'blue', 'progress', 50]);
});

test('Where [cohort] stands: the bar of outcomes, its sentence, and who is not in it', () => {
  const s = standingOf(PAGE([]), 'Nov 2026');
  assert.equal(s.title, 'Where Nov 2026 stands');
  assert.deepEqual(s.chart.parts.map((p) => [p.label, p.value]), [['On track', 15], ['At risk', 3], ['In grace', 2], ['Failed a week', 2], ['Graduated', 0]]);
  assert.equal(s.alt, 'Of 23 founders: 15 on track, 3 at risk, 2 in grace, 2 failed a week, 0 graduated.');
  assert.deepEqual(s.lines, ['1 founder is not in a cohort now, and is not in the bar.']);
  assert.deepEqual([s.needs, s.everyone], [7, 23]);
  assert.equal(standingOf({}), null);
  assert.equal(standingOf(PAGE([]), null).title, 'Where the Lab stands');
});

test('the drawer: weeks and their checklists, tools, history by the Lab\'s clock or an admin', () => {
  const w = weekCards(DETAIL(), NOW);
  assert.deepEqual(w.map((x) => x.status.word), ['Passed', 'Not decided', 'Not started', 'Not started']);
  assert.equal(w[0].deadline, '7 Nov 23:59 ET');
  assert.deepEqual(w[1].items.map((i) => [i.word, i.done]), [['Set 3+ OKRs', false], ['Draft pitch deck v1', true]]);
  assert.equal(weekCards({ weeks: null }), null, 'weeks unread is said, not drawn empty');
  const t = toolsOf(DETAIL());
  assert.equal(t.title, 'Tools unlocked 3 of 20');
  assert.deepEqual(t.tools.map((x) => [x.word, x.on]), [['Spin-Out Lab', true], ['Startups', true], ['Roadmap', true], ['Scoring Engine', false]]);
  assert.equal(toolsOf({ tools: null }), null);
  assert.deepEqual(historyRows(DETAIL(), NOW).map((x) => x.text), ['Week 1 passed (the Lab’s clock)', 'Week 1 in grace (an admin)']);
  assert.equal(historyRows({ history: null }), null);
});

test('the addresses, the tab count, the cohort options, grace hours and who cannot be changed', () => {
  assert.equal(participantOf(`${PARTICIPANTS_PATH}/u-41`), 'u-41');
  assert.equal(participantOf(PARTICIPANTS_PATH), null);
  assert.equal(tabOf(`${PARTICIPANTS_PATH}/u-41`), 'participants', 'one founder opens over the Participants tab');
  assert.deepEqual(participantsCount({ status: 'loading', data: null }), { kind: 'load' });
  assert.equal(participantsCount({ status: 'error', data: null }).kind, 'dash', 'a failed read is a dash, never 0');
  assert.deepEqual(participantsCount({ status: 'ready', data: PAGE([]) }), { kind: 'num', value: '23' });
  assert.deepEqual(cohortOptions({ status: 'ready', data: { cycles: [{ year: 2026, month: 10 }, { year: 2026, month: 11 }] } }).map((o) => o.label), ['Cohort: any', 'Cohort: Nov 2026', 'Cohort: Oct 2026']);
  assert.deepEqual(cohortOptions({ status: 'error', data: null }).map((o) => o.value), ['']);
  assert.deepEqual([graceHours('24'), graceHours('168'), graceHours('0'), graceHours(String(GRACE_MAX + 1)), graceHours('2.5'), graceHours('')], [24, 168, null, null, null, null]);
  assert.match(cannotDecide(participantRow(ROW({ cohort_cycle_id: null }), NOW)), /not in a cohort now/);
  assert.equal(cannotDecide(participantRow(ROW(), NOW)), null);
});

/* ------------------------------------------------------------------ *
 * Mounted on a stubbed Worker
 * ------------------------------------------------------------------ */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function worker({ page = PAGE([ROW(), ROW({ user_id: 42, uid: 'u-42', name: 'Ben', company: 'Orchid Materials', this_week: 'grace', cohort_cycle_id: null })]), detail = DETAIL(), stepUp = null, writes = {} } = {}) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = String(init.method || 'GET').toUpperCase();
    seen.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null });
    const p = u.pathname;
    if (p === '/api/admin/cohort/participants') return typeof page === 'function' ? page(u) : json(page);
    if (p.startsWith('/api/admin/cohort/participants/')) return typeof detail === 'function' ? detail(u) : json(detail);
    if (p === '/api/admin/cohort/timeline') return json({ cycles: [{ id: 3, year: 2026, month: 11 }] });
    if (p === '/api/auth/step-up') return stepUp ? stepUp() : json({ ok: true });
    if (p === '/api/admin/cohort/grace') return writes.grace ? writes.grace() : json({ ok: true, grace_until: '2026-11-11 15:00:00' });
    if (p === '/api/admin/cohort/override') return writes.override ? writes.override() : json({ ok: true, status: 'failed' });
    if (p.startsWith('/api/admin/impersonate/')) return writes.impersonate ? writes.impersonate() : json({ token: 'tok', user: { id: 41 } });
    return json({});
  };
  return seen;
}

async function mount(url, w, extra = {}) {
  const restore = installDocument();
  const seen = worker(w);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = l.pathname + l.search; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(LabParticipants, { now: NOW, ...extra }), h(Probe))); });
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, at, flush,
    has: (id) => Boolean(byId(id)),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    props: (id) => props(byId(id)) || {},
    async click(id) { const p = props(byId(id)); assert.ok(p?.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const p = props(byId(id)); assert.ok(p?.onChange, `no ${id} to type in`); await act(async () => { p.onChange({ target: { value } }); }); await flush(); },
    async submit(id) { const n = byId(id); const form = (function up(x) { return !x ? null : x.tagName === 'FORM' ? x : up(x.parentNode); })(n); await act(async () => { props(form).onSubmit({ preventDefault() {} }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const reads = (seen) => seen.filter((s) => s.path === '/api/admin/cohort/participants');

test('mounted SL7: the segments carry the read\'s counts, the bar and its table, the rows, and the query the Worker gets', async () => {
  const m = await mount(PARTICIPANTS_PATH);
  try {
    assert.equal(reads(m.seen)[0].query.needs, '1', 'Needs a decision is the first view');
    assert.equal(m.of('lab-part-count-needs'), '7');
    assert.equal(m.of('lab-part-count-everyone'), '23');
    assert.match(m.props('lab-part-standing-chart')['aria-label'], /^Of 23 founders: 15 on track/);
    await m.click('lab-part-standing-toggle');
    assert.ok(m.has('lab-part-standing-table') && !m.has('lab-part-standing-chart'));
    assert.match(m.of('lab-part-row-u-41'), /Ada Founder.*Bluefern Health.*2026-11.*W2 · D10.*7 \/ 10.*At risk.*14 Nov 23:59 ET.*Set 3\+ OKRs/s);
    assert.equal(m.props('lab-part-open-u-41').href, `${PARTICIPANTS_PATH}/u-41`);
    await m.click('lab-part-show-everyone');
    assert.equal(reads(m.seen).at(-1).query.needs, undefined, 'Everyone sends no needs filter');
    await m.type('lab-part-this-week', 'grace');
    await m.type('lab-part-sort', 'progress');
    const q = reads(m.seen).at(-1).query;
    assert.deepEqual([q.this_week, q.sort, q.offset], ['grace', 'progress', '0']);
    await m.type('lab-part-search', 'blue');
    assert.notEqual(reads(m.seen).at(-1).query.q, 'blue', 'typing alone does not read');
    await m.submit('lab-part-search');
    assert.equal(reads(m.seen).at(-1).query.q, 'blue');
  } finally { await m.unmount(); }
});

test('mounted SL7: pages ask the Worker for the next offset; a failed read says so and draws no zero; an inner read failing is said', async () => {
  const many = PAGE(Array.from({ length: 25 }, (_, i) => ROW({ user_id: 100 + i, uid: `u-${100 + i}` })), { total: 30 });
  const m = await mount(PARTICIPANTS_PATH, { page: many });
  try {
    assert.equal(m.of('lab-part-pager').startsWith('1–25 of 30'), true);
    await m.click('lab-part-next');
    assert.equal(reads(m.seen).at(-1).query.offset, '25', 'the next page is the Worker\'s, by offset');
  } finally { await m.unmount(); }
  const down = await mount(PARTICIPANTS_PATH, { page: () => json({ error: 'lab_participants_unreadable', message: 'Lab participants could not be read. That is not the same as none.' }, 503) });
  try {
    assert.ok(down.has('lab-part-read-unreadable'));
    assert.ok(!down.has('lab-part-standing') && !down.has('lab-part-table'), 'no bar and no table stand in for a failed read');
    assert.ok(!down.has('lab-part-count-needs'), 'no count without the read');
  } finally { await down.unmount(); }
  const part = await mount(PARTICIPANTS_PATH, { page: PAGE([ROW({ moderation: undefined })], { unreadable: { moderation: 'Moderation cases could not be read, so whether a founder has an open case is not shown.' } }) });
  try {
    assert.match(part.of('lab-part-unread'), /Moderation cases could not be read/);
    assert.match(part.of('lab-part-row-u-41'), /Not read/);
  } finally { await part.unmount(); }
  const empty = await mount(PARTICIPANTS_PATH, { page: PAGE([], { total: 0 }) });
  try { assert.equal(empty.of('lab-part-empty'), 'Nothing needs a decision now.'); } finally { await empty.unmount(); }
});

test('mounted SL8: /participants/:uid opens the founder over the list — strip, weeks, tools, moderation, history', async () => {
  const m = await mount(`${PARTICIPANTS_PATH}/u-41`);
  try {
    assert.ok(m.seen.some((s) => s.path === '/api/admin/cohort/participants/u-41'));
    assert.equal(m.of('lab-part-strip'), 'Started 1 Nov · Week 2 of 4 · Day 10 of 28 · 19 days left · Incorporated: No');
    assert.match(m.of('lab-part-week-card-2'), /Week 2.*Not decided.*Deadline 14 Nov 23:59 ET.*Set 3\+ OKRs.*not done.*Draft pitch deck v1.*done/s);
    assert.match(m.of('lab-part-week-card-3'), /One of: Establish advisor cadence or Decide co-founder track/);
    assert.match(m.of('lab-part-tools'), /Tools unlocked 3 of 20.*Scoring Engine · locked/s);
    assert.match(m.of('lab-part-moderation'), /No open case/);
    assert.match(m.of('lab-part-history'), /Week 1 passed \(the Lab’s clock\).*Week 1 in grace \(an admin\)/s);
  } finally { await m.unmount(); }
  const gone = await mount(`${PARTICIPANTS_PATH}/u-9`, { detail: () => json({ error: 'not_a_participant' }, 404) });
  try { assert.ok(gone.has('lab-part-drawer-missing')); } finally { await gone.unmount(); }
  const down = await mount(`${PARTICIPANTS_PATH}/u-41`, { detail: () => json({ error: 'lab_participants_unreadable' }, 503) });
  try { assert.ok(down.has('lab-part-drawer-read-unreadable') && !down.has('lab-part-strip')); } finally { await down.unmount(); }
  const unread = await mount(`${PARTICIPANTS_PATH}/u-41`, { detail: DETAIL({ weeks: null, tools: null, history: null, participant: ROW({ moderation: undefined }) }) });
  try {
    assert.match(unread.of('lab-part-weeks-none'), /could not be read/);
    assert.match(unread.of('lab-part-tools'), /could not be read/);
    assert.match(unread.of('lab-part-history'), /could not be read/);
    assert.match(unread.of('lab-part-moderation'), /could not be read/);
  } finally { await unread.unmount(); }
});

test('dialog A, Give grace: hours and a reason are required, 1 to 168, and the write is the founder\'s week', async () => {
  const m = await mount(PARTICIPANTS_PATH);
  try {
    await m.click('lab-part-menu-u-41');
    await m.click('lab-part-grace-u-41');
    assert.match(m.of('lab-part-grace'), /Give Ada Founder grace for Week 2.*The deadline moves for this founder only/s);
    assert.equal(m.props('lab-part-grace-go').disabled, true, 'nothing is chosen until the admin chooses');
    await m.click('lab-part-grace-custom');
    await m.type('lab-part-grace-hours', '200');
    await m.type('lab-part-grace-reason', 'Clinic visit this week');
    assert.equal(m.props('lab-part-grace-go').disabled, true, 'more than 168 hours is refused before any write');
    await m.click('lab-part-grace-48');
    assert.equal(m.of('lab-part-grace-cutoff'), 'New cutoff: 12 Nov 10:00 ET. Ada Founder is told now.');
    await m.click('lab-part-grace-go');
    const w = m.seen.find((s) => s.path === '/api/admin/cohort/grace');
    assert.deepEqual(w.body, { user_id: 41, cycle_id: 3, week: 2, hours: 48, reason: 'Clinic visit this week' });
    assert.match(m.of('lab-part-grace-result'), /Grace given until 11 Nov 10:00 ET\. Ada Founder has been told\./);
  } finally { await m.unmount(); }
});

test('dialog B, Change this week: Passed or Failed with a reason; a founder not in a cohort is told why, with no write', async () => {
  const m = await mount(PARTICIPANTS_PATH);
  try {
    await m.click('lab-part-menu-u-41');
    await m.click('lab-part-week-u-41');
    assert.match(m.of('lab-part-week'), /Change Week 2 for Ada Founder.*Passed · Week 3 opens for them now\..*Failed · Their workspace pauses at Week 2\. They are told\./s);
    assert.equal(m.props('lab-part-week-go').disabled, true);
    await m.type('lab-part-week-reason', 'Reviewed the deck with the founder');
    assert.equal(m.props('lab-part-week-go').disabled, true, 'no outcome chosen yet');
    await act(async () => { m.props('lab-part-week-choice-fail').onChange(); });
    await m.flush();
    await m.click('lab-part-week-go');
    assert.deepEqual(m.seen.find((s) => s.path === '/api/admin/cohort/override').body, { user_id: 41, cycle_id: 3, week: 2, decision: 'fail', reason: 'Reviewed the deck with the founder' });
    assert.match(m.of('lab-part-week-result'), /Week 2 is failed\. Ada Founder has been told\./);
  } finally { await m.unmount(); }
  const out = await mount(PARTICIPANTS_PATH);
  try {
    await out.click('lab-part-menu-u-42');
    await out.click('lab-part-grace-u-42');
    assert.match(out.of('lab-part-cannot-why'), /Ben is not in a cohort now, so there is no week to change\./);
    assert.ok(!out.seen.some((s) => s.method === 'POST'));
  } finally { await out.unmount(); }
});

test('dialog C, Open workspace: a reason of ten or more and the authenticator code, confirmed before the session opens', async () => {
  const opened = [];
  const m = await mount(PARTICIPANTS_PATH, {}, { onImpersonate: (token, user, to) => opened.push([token, user.id, to]) });
  try {
    await m.click('lab-part-menu-u-41');
    await m.click('lab-part-workspace-u-41');
    assert.match(m.of('lab-part-workspace'), /Open Ada Founder’s workspace.*support session, recorded with your reason.*It needs a recent authenticator code/s);
    await m.type('lab-part-workspace-reason', 'Too short');
    assert.match(m.of('lab-part-workspace-left'), /^1 more character\.$/);
    await m.type('lab-part-workspace-code', '123456');
    assert.equal(m.props('lab-part-workspace-go').disabled, true, 'a reason under ten characters opens nothing, even with the code');
    await m.type('lab-part-workspace-reason', 'Founder cannot open the cap table');
    await m.type('lab-part-workspace-code', '12a45');
    assert.equal(m.props('lab-part-workspace-go').disabled, true, 'a reason without a six-digit code opens nothing');
    await m.type('lab-part-workspace-code', '123456');
    assert.equal(m.props('lab-part-workspace-go').disabled, false);
    await m.click('lab-part-workspace-go');
    const posts = m.seen.filter((s) => s.method === 'POST').map((s) => s.path);
    assert.deepEqual(posts, ['/api/auth/step-up', '/api/admin/impersonate/41'], 'the code is confirmed first');
    assert.deepEqual(m.seen.find((s) => s.path === '/api/auth/step-up').body, { totp_code: '123456' });
    assert.equal(m.seen.find((s) => s.path === '/api/admin/impersonate/41').query.context, 'Founder cannot open the cap table');
    assert.deepEqual(opened, [['tok', 41, '/spinout-lab']]);
  } finally { await m.unmount(); }
  const wrong = await mount(PARTICIPANTS_PATH, { stepUp: () => json({ error: 'invalid_code', message: 'That code did not work. Try the current one.' }, 401) });
  try {
    await wrong.click('lab-part-menu-u-41');
    await wrong.click('lab-part-workspace-u-41');
    await wrong.type('lab-part-workspace-reason', 'Founder cannot open the cap table');
    await wrong.type('lab-part-workspace-code', '000000');
    await wrong.click('lab-part-workspace-go');
    assert.ok(!wrong.seen.some((s) => s.path.startsWith('/api/admin/impersonate/')), 'no session opens without the code');
    assert.ok(wrong.has('lab-part-workspace-refusal'));
  } finally { await wrong.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('no browser pop-up anywhere in the Lab\'s files, and Guard H\'s line is gone', () => {
  const dir = 'frontend/src/pages/admin/lab';
  for (const f of readdirSync(resolve(process.cwd(), dir)).filter((x) => /\.jsx?$/.test(x))) {
    assert.doesNotMatch(read(`${dir}/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /window\.(prompt|confirm|alert)\(|\balert\(/, f);
  }
  assert.doesNotMatch(read('frontend/src/pages/admin/AdminSpinoutLab.jsx'), /PARTICIPANTS_EMPTY_UNTRUSTED|cannot yet tell an empty Lab/);
  assert.match(read('frontend/src/App.jsx'), /path="\/admin\/programs\/spinout-lab\/participants\/:uid"/);
});
