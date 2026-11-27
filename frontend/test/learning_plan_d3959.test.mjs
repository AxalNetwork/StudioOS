// D3959 (#3959) — a member's own learning plan, the frontend half.
//
//   1. the model: the sheet's body and its refusals (a webinar sends no time,
//      a study block needs a name, the duration and the time are checked, an
//      exam only reserves time), the reschedule body, Upcoming and Past, goals
//      with no percent, and what a Learning entry on the Calendar offers;
//   2. the sheet: Add to my plan sends the body; a webinar registers at its
//      own time; a refusal is said in the member's words; the Calendar's
//      picker plans a study block;
//   3. /learning/plan: upcoming and past rows, goals, the empty and unreadable
//      states, never a 0% before anything is done;
//   4. the actions on a plan row and a Calendar entry: Mark done, Remove (a
//      dialog first); a webinar the member is only registered for just opens;
//   5. the wiring: each Learning page offers Add to my plan, /learning/plan is
//      routed, and the Calendar's New › Plan learning and entry actions.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_plan_d3959.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { learningPlanApi } from '../src/lib/api/learningPlan.js';
import { learningApi } from '../src/lib/api/learning.js';
import { PlanSheet } from '../src/pages/learning/PlanSheet.jsx';
import { PlanRowActions } from '../src/pages/learning/PlanRowActions.jsx';
import LearningPlanPage from '../src/pages/learning/LearningPlanPage.jsx';
import { newMenu } from '../src/pages/calendarItemModel.js';
import {
  KIND_NOTES, calendarActions, goalRows, planBody, refusalOf, rescheduleBody, splitPlan, statusLine,
} from '../src/pages/learning/learningPlanModel.js';

const h = React.createElement;
const NOW = Date.parse('2026-11-03T12:00:00Z');
const FORM = { date: '2026-11-10', time: '09:00', duration: 30, repeat: 'none', until: '', remind: 30, title: '', goal: '', goalDate: '' };

test('1. the model: the body and its refusals, the reschedule, Upcoming and Past, goals, the Calendar entry', () => {
  // Mutation checked: a webinar sending a time → the webinar body fails; the study-block name check dropped → its refusal fails;
  // the duration bounds dropped → the 500-minute refusal fails; a goal shown as a percent → the goal state fails;
  // Mark done offered on a done item → the done case fails; Reschedule offered on a webinar → the webinar case fails.
  const at = new Date('2026-11-10T09:00:00').toISOString();
  assert.deepEqual(planBody({ kind: 'course', uid: 'c1' }, FORM, NOW).body,
    { item_kind: 'course', item_uid: 'c1', remind_min_before: 30, starts_at: at, duration_min: 30, repeat: 'none' });
  assert.deepEqual(planBody({ kind: 'webinar', uid: 'w1' }, { ...FORM, date: '' }, NOW).body, { item_kind: 'webinar', item_uid: 'w1', remind_min_before: 30 }, 'a webinar sends no time');
  assert.equal(planBody({ kind: 'study_block' }, FORM, NOW).error, 'Name the study block.');
  assert.equal(planBody({ kind: 'study_block' }, { ...FORM, title: 'Read the term sheet guide' }, NOW).body.title_override, 'Read the term sheet guide');
  assert.equal(planBody({ kind: 'exam' }, FORM, NOW).error, 'Choose what to plan.');
  assert.match(planBody({ kind: 'lesson', uid: 'l1' }, { ...FORM, duration: 500 }, NOW).error, /5 to 480 minutes/);
  assert.equal(planBody({ kind: 'lesson', uid: 'l1' }, { ...FORM, date: '2026-11-01' }, NOW).error, 'Choose a time that has not passed.');
  assert.equal(planBody({ kind: 'lesson', uid: 'l1' }, { ...FORM, repeat: 'weekly', until: '2026-11-01' }, NOW).error, 'Repeat until comes after the start.');
  assert.equal(planBody({ kind: 'lesson', uid: 'l1' }, { ...FORM, repeat: 'weekly', until: '2026-12-15' }, NOW).body.repeat_until, '2026-12-15');
  assert.deepEqual(planBody({ kind: 'course', uid: 'c1' }, { ...FORM, goal: ' Finish Fundraising 101 ', goalDate: '2026-12-15' }, NOW).body.goal, { text: 'Finish Fundraising 101', target_date: '2026-12-15' });
  assert.match(KIND_NOTES.exam, /never starts the exam/);
  assert.equal(rescheduleBody({ item_kind: 'webinar' }, '2026-11-11', '10:00', NOW).error, 'A webinar keeps its own time.');
  assert.deepEqual(rescheduleBody({ item_kind: 'study_block' }, '2026-11-11', '10:00', NOW).body, { starts_at: new Date('2026-11-11T10:00:00').toISOString() });
  assert.equal(refusalOf({ code: 'full', message: 'x' }), 'This webinar is full.');
  assert.equal(refusalOf({ message: 'Something else.' }), 'Something else.');

  const items = [
    { uid: 'a', item_kind: 'course', title: 'Fundraising 101', href: '/learning/courses/f101', duration_min: 30, repeat: 'weekly', status: 'planned',
      occurrences: ['2026-10-27T09:00:00Z', '2026-11-10T09:00:00Z', '2026-11-03T13:00:00Z'], goal: { text: 'Finish by 15 Dec', target_date: '2026-12-15' } },
    { uid: 'b', item_kind: 'exam', title: 'Term sheets', href: '/learning/exams/x', duration_min: 60, repeat: 'none', status: 'done', done_recorded_by: 'learning', occurrences: ['2026-11-01T09:00:00Z'], goal: { text: 'Pass it' } },
  ];
  const { upcoming, past } = splitPlan(items, NOW);
  assert.deepEqual(upcoming.map((r) => r.at), ['2026-11-03T13:00:00Z', '2026-11-10T09:00:00Z'], 'soonest first');
  assert.deepEqual(past.map((r) => r.at), ['2026-11-01T09:00:00Z', '2026-10-27T09:00:00Z'], 'latest first');
  assert.equal(statusLine(past[0]), 'Done · recorded by Learning');
  assert.equal(statusLine(past[1]), 'Not marked done');
  assert.deepEqual(goalRows(items).map((g) => [g.text, g.target, g.state]), [['Finish by 15 Dec', '2026-12-15', 'In progress'], ['Pass it', null, 'Done']]);
  assert.ok(goalRows(items).every((g) => !/%/.test(g.state)), 'no percent before anything is done');

  const ev = (o) => ({ kind: 'learning', source_uid: 'p1', status: 'planned', url: '/learning/courses/f101', learning: { item_kind: 'course', plan: true }, ...o });
  assert.deepEqual(calendarActions(ev({})).map((a) => a.key), ['done', 'reschedule', 'open', 'remove']);
  assert.deepEqual(calendarActions(ev({ status: 'done' })).map((a) => a.key), ['reschedule', 'open', 'remove']);
  assert.deepEqual(calendarActions(ev({ learning: { item_kind: 'webinar', plan: true } })).map((a) => a.key), ['done', 'open', 'remove']);
  assert.deepEqual(calendarActions(ev({ learning: { item_kind: 'webinar', plan: false }, url: '/learning/webinars/w1' })).map((a) => a.key), ['open'], 'a registration only opens');
  assert.deepEqual(calendarActions({ kind: 'ic_meeting' }), []);
  assert.ok(newMenu('advisor').some((x) => x.key === 'learning' && x.label === 'Plan learning'));
});

async function mount(element, mocks = {}) {
  const calls = [];
  const origPlan = { ...learningPlanApi };
  const origLearning = { ...learningApi };
  for (const k of ['list', 'create', 'update', 'remove', 'markDone']) {
    learningPlanApi[k] = async (...a) => { calls.push([k, ...a]); if (mocks[k]) return mocks[k](...a); return { item: { uid: 'new' } }; };
  }
  Object.assign(learningApi, mocks.learning || {});
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => [...walk(container), ...walk(document.body)];
  const by = (id) => all().find((n) => pr(n)['data-testid'] === id);
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  return {
    calls, by, pr, text: (n) => textOf(n).replace(/\s+/g, ' '),
    async press(id) { const n = by(id); assert.ok(n, `${id} drawn`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = by(id); assert.ok(n, `${id} drawn`); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(learningPlanApi, origPlan); Object.assign(learningApi, origLearning); },
  };
}

test('2. the sheet: Add to my plan sends the body; a webinar registers at its own time; a refusal in the member\'s words; the picker', async () => {
  // Mutation checked: the save not sending planBody's body → the create call fails; the webinar's date fields drawn → their absence fails;
  // refusalOf bypassed → the full sentence fails.
  let v = await mount(h(PlanSheet, { subject: { kind: 'exam', uid: 'x1', title: 'Term sheets' }, now: new Date(NOW), onDone() {}, onClose() {} }));
  try {
    assert.match(v.text(v.by('plan-sheet-note')), /never starts the exam/);
    await v.type('plan-sheet-date', '2026-11-10');
    await v.type('plan-sheet-time', '09:00');
    await v.press('plan-sheet-save');
    const [, body] = v.calls.find(([k]) => k === 'create');
    assert.deepEqual([body.item_kind, body.item_uid, body.duration_min, body.repeat], ['exam', 'x1', 30, 'none']);
  } finally { await v.unmount(); }
  v = await mount(h(PlanSheet, { subject: { kind: 'webinar', uid: 'w1', title: 'Demo day', startsAt: '2026-11-20T17:00:00Z' }, now: new Date(NOW), onDone() {}, onClose() {} }),
    { create: async () => { throw Object.assign(new Error('Conflict'), { status: 409, code: 'full' }); } });
  try {
    assert.equal(v.by('plan-sheet-date'), undefined, 'a webinar is planned at its own time');
    assert.ok(v.by('plan-sheet-webinar-time'));
    assert.match(v.text(v.by('plan-sheet-save')), /Add and register/);
    await v.press('plan-sheet-save');
    assert.equal(v.calls.find(([k]) => k === 'create')[1].starts_at, undefined);
    assert.equal(v.text(v.by('plan-sheet-error')), 'This webinar is full.');
  } finally { await v.unmount(); }
  v = await mount(h(PlanSheet, { picker: true, now: new Date(NOW), onDone() {}, onClose() {} }), { learning: { catalog: async () => ({ items: [{ id: 'f101', title: 'Fundraising 101' }] }), course: async () => ({ course: { uid: 'c-uid' } }) } });
  try {
    assert.ok(v.by('plan-picker'));
    await v.press('plan-picker-course:f101');
    assert.match(v.text(v.by('plan-sheet-subject')), /Course · Fundraising 101/);
    await v.type('plan-sheet-date', '2026-11-10');
    await v.press('plan-sheet-save');
    assert.equal(v.calls.find(([k]) => k === 'create')[1].item_uid, 'c-uid', 'the course is planned by its uid, read on pick');
  } finally { await v.unmount(); }
});

test('3. /learning/plan: upcoming and past, goals, the empty and unreadable states', async () => {
  // Mutation checked: the unreadable state drawn as the empty plan → its check fails; goals not drawn → the goal check fails.
  const items = [{ uid: 'a', item_kind: 'study_block', title: 'Read', href: null, available: true, duration_min: 30, repeat: 'none', status: 'planned',
    occurrences: [new Date(Date.now() + 86_400_000).toISOString()], goal: { text: 'Finish by Friday', target_date: '2026-12-15' } }];
  let v = await mount(h(LearningPlanPage), { list: async () => ({ items }) });
  try {
    assert.ok(v.by('plan-upcoming'));
    assert.match(v.text(v.by('plan-goals')), /Finish by Friday .*By 2026-12-15 · In progress/);
    assert.doesNotMatch(v.text(v.by('plan-goals')), /0%/);
    assert.ok(v.by('plan-actions-a'));
    await v.press('plan-add-study');
    assert.ok(v.by('plan-sheet-title'), 'Add a study block opens the sheet named for it');
  } finally { await v.unmount(); }
  v = await mount(h(LearningPlanPage), { list: async () => ({ items: [] }) });
  try { assert.ok(v.by('plan-empty')); } finally { await v.unmount(); }
  v = await mount(h(LearningPlanPage), { list: async () => { throw new Error('down'); } });
  try { assert.ok(v.by('plan-unreadable')); assert.equal(v.by('plan-empty'), undefined, 'unreadable, not an empty plan'); } finally { await v.unmount(); }
});

test('4. a plan row and a Calendar entry: Mark done, Remove after its dialog; a registration only opens', async () => {
  // Mutation checked: Remove sent without its dialog → the call appears before the confirm; Mark done calling update → the markDone call fails.
  const ev = { kind: 'learning', source_uid: 'p1', status: 'planned', url: '/learning/courses/f101', learning: { item_kind: 'course', plan: true } };
  let changed = 0;
  let v = await mount(h(PlanRowActions, { ev, onChanged: () => { changed += 1; } }));
  try {
    await v.press('plan-action-done');
    assert.deepEqual(v.calls.at(-1), ['markDone', 'p1']);
    await v.press('plan-action-remove');
    assert.ok(v.by('plan-remove'));
    assert.ok(!v.calls.some(([k]) => k === 'remove'), 'nothing is removed before the dialog is confirmed');
    await v.press('plan-remove-confirm');
    assert.deepEqual(v.calls.at(-1), ['remove', 'p1']);
    assert.equal(changed, 2);
  } finally { await v.unmount(); }
  v = await mount(h(PlanRowActions, { ev: { ...ev, learning: { item_kind: 'webinar', plan: false }, url: '/learning/webinars/w1' } }));
  try {
    assert.ok(v.by('plan-action-open'));
    assert.equal(v.by('plan-action-done'), undefined);
    assert.equal(v.by('plan-action-remove'), undefined);
  } finally { await v.unmount(); }
});

test('5. the wiring: Add to my plan on each page, /learning/plan routed, the Calendar\'s New › Plan learning and entry actions', () => {
  // Mutation checked: the webinar page's action removed → its pin fails; the Calendar's learning row actions removed → its pin fails.
  const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  const wired = read('pages/learning/LearningWired.jsx');
  for (const k of ['course', 'lesson', 'video']) assert.match(wired, new RegExp(`<AddToPlan subject=\\{\\{ kind: '${k}'`), k);
  assert.match(read('pages/learning/LearningWebinars.jsx'), /<AddToPlan subject=\{\{ kind: 'webinar', uid: webinar\.uid, title: webinar\.title, startsAt: webinar\.starts_at \}\} \/>/);
  const assess = read('pages/learning/LearningAssessments.jsx');
  for (const k of ['exercise', 'exam']) assert.match(assess, new RegExp(`<AddToPlan subject=\\{\\{ kind: '${k}'`), k);
  assert.match(read('routes/learning.jsx'), /<Route path="\/learning\/plan" element=\{guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <LearningPage view="plan"/);
  const cal = read('pages/CalendarPage.jsx');
  assert.match(cal, /k === 'learning' \? setShowLearning\(true\)/);
  assert.match(cal, /\{showLearning && <PlanSheet picker /);
  assert.match(cal, /\{ev\.kind === 'learning' && <div className="cal-ev-actions"><PlanRowActions ev=\{ev\} onChanged=\{onChanged\} \/><\/div>\}/);
});
