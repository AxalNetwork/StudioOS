/**
 * D7118 part 2 (#7118): the reflection screens to the Wellness Member Home canvas (WLM-02, WLM-03, WLM-08 to
 * WLM-10): Today, This week and This month, each its own record and state; the heart opening Today; the Account
 * sheet row; a failed save keeping the draft; history with only the intended period.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_reflections_7118.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import * as M from '../src/pages/wellbeing/reflectionsModel.js';
import { PeriodCards, ReflectionView } from '../src/pages/wellbeing/Reflections.jsx';
import FounderWellbeingMenu, { loadReflectionEditor } from '../src/components/FounderWellbeingMenu.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const DAY = { uid: 'd1', cadence: 'day', period_start: '2026-11-17', period_end: '2026-11-17', timezone: 'UTC', scores: { energy: 3, stress: 2, sleep: 4 }, text: 'Long walk at lunch.', topics: [], readable: true, revision: 2, created_at: '2026-11-17 08:12:00', updated_at: '2026-11-17 08:12:00' };
const WEEK = { uid: 'w1', cadence: 'week', period_start: '2026-11-16', period_end: '2026-11-22', timezone: 'UTC', scores: { stress: 3 }, text: null, topics: ['Sleep'], readable: true, revision: 1, created_at: '2026-11-16 21:40:00', updated_at: '2026-11-16 21:40:00' };
const TODAY = (over = {}) => ({
  today: '2026-11-17', timezone: 'UTC',
  day: { period_start: '2026-11-17', period_end: '2026-11-17', reflection: null },
  week: { period_start: '2026-11-16', period_end: '2026-11-22', reflection: WEEK },
  month: { period_start: '2026-11-01', period_end: '2026-11-30', reflection: null },
  ...over,
});

// ── The model ───────────────────────────────────────────────────────────────────────────────────────────────

test('model: each period’s date in the member’s calendar, a week across a month end, and the ?period= addresses', () => {
  assert.equal(M.dayLabel('2026-11-17'), 'Tue 17 Nov 2026');
  assert.equal(M.weekLabel('2026-11-16', '2026-11-22'), '16–22 Nov 2026');
  assert.equal(M.weekLabel('2026-11-30', '2026-12-06'), '30 Nov – 6 Dec 2026');
  assert.equal(M.weekLabel('2026-12-28', '2027-01-03'), '28 Dec 2026 – 3 Jan 2027');
  assert.equal(M.monthLabel('2026-11-01'), 'November 2026');
  assert.equal(M.historyLabel('week', '2026-11-09'), 'Week of 9 Nov');
  assert.equal(M.dayLabel('2026-02-30x'), null);
  assert.equal(M.periodHref('day'), '/wellbeing?period=today');
  assert.equal(M.cadenceOfParam('month'), 'month');
  assert.equal(M.cadenceOfParam('year'), null);
  assert.equal(M.cadenceOfParam('constructor'), null);
});

test('model: each period has its own state; nothing saved is Not yet, never a zero or a miss; undecryptable is not Not yet', () => {
  assert.deepEqual(M.periodState('day', { reflection: null }, 'UTC'), { kind: 'notyet', word: 'Not yet today' });
  assert.deepEqual(M.periodState('month', { reflection: null }, 'UTC'), { kind: 'notyet', word: 'Not yet this month' });
  assert.deepEqual(M.periodState('day', { reflection: DAY }, 'UTC'), { kind: 'saved', word: 'Saved 08:12' });
  assert.deepEqual(M.periodState('week', { reflection: WEEK }, 'UTC'), { kind: 'saved', word: 'Saved Mon 16 Nov' });
  assert.equal(M.periodState('day', { reflection: DAY }, 'Asia/Tokyo').word, 'Saved 17:12', 'the time reads in the member’s zone');
  assert.equal(M.periodState('day', { reflection: { ...DAY, readable: false } }, 'UTC').kind, 'unreadable');
});

test('model: the questions are the Worker’s keys; a save sends only what was answered, its revision and one request id', () => {
  const keys = ['mood', 'stress', 'sleep', 'energy', 'focus', 'social', 'support', 'decisions'];
  for (const c of ['day', 'week']) for (const x of M.QUESTIONS[c]) assert.ok(keys.includes(x.key), x.key);
  assert.deepEqual(M.QUESTIONS.day.map((x) => x.key), ['energy', 'stress', 'sleep']);
  assert.deepEqual(M.QUESTIONS.week.map((x) => x.key), ['stress', 'sleep', 'support', 'decisions', 'energy']);
  const d = M.draftFrom('day', null);
  assert.equal(M.draftEmpty('day', d), true, 'an empty reflection is never sent');
  const body = M.saveBody('day', { ...d, scores: { energy: 3 }, text: '  slow start  ' }, null, 'Europe/Lisbon', 'rf-1');
  assert.deepEqual(body, { timezone: 'Europe/Lisbon', base_revision: 0, scores: { energy: 3 }, text: 'slow start', request_id: 'rf-1' });
  const edit = M.saveBody('week', M.draftFrom('week', WEEK), WEEK, 'UTC', null);
  assert.deepEqual(edit, { timezone: 'UTC', base_revision: 1, scores: { stress: 3 }, text: null, topics: ['Sleep'] });
  assert.equal('topics' in M.saveBody('day', M.draftFrom('day', DAY), DAY, 'UTC'), false, 'a day sends no topics');
  let t = [];
  for (let i = 0; i < 10; i += 1) t = M.toggleTopic(t, `t${i}`);
  assert.equal(t.length, 8, 'at most eight topics');
  assert.notEqual(M.newRequestId(), M.newRequestId());
});

test('model: the month’s two prompts round-trip through one text, and older text keeps every word', () => {
  const text = M.monthText({ supported: 'A walk on Sundays.', carry: 'Earlier nights.' });
  assert.deepEqual(M.monthParts(text), { supported: 'A walk on Sundays.', carry: 'Earlier nights.' });
  assert.deepEqual(M.monthParts(M.monthText({ supported: '', carry: 'Only this.' })), { supported: '', carry: 'Only this.' });
  assert.deepEqual(M.monthParts('Written another way.'), { supported: 'Written another way.', carry: '' });
  assert.equal(M.monthText({ supported: ' ', carry: '' }), '');
  assert.equal(M.draftEmpty('month', M.draftFrom('month', null)), true);
});

test('model: a failed save says what happened and that the words are still there; history lines never invent a value', () => {
  const err = (code) => Object.assign(new Error('raw'), { data: { error: code } });
  assert.match(M.saveRefusal(err('reflection_protection_unavailable')), /can’t be stored encrypted right now\. They are still here/);
  assert.match(M.saveRefusal(err('reflection_changed')), /changed somewhere else/);
  assert.equal(M.isChanged(err('reflection_changed')), true);
  assert.match(M.saveRefusal(new Error('socket hang up')), /still here/);
  assert.doesNotMatch(M.saveRefusal(new Error('socket hang up')), /socket/);
  assert.equal(M.historyLine('day', DAY, 'UTC'), 'Energy 3 · Stress 2 · Sleep 4');
  assert.equal(M.historyLine('day', { ...DAY, scores: {} }, 'UTC'), 'No scores');
  assert.equal(M.historyNote('day', { ...DAY, text: '' }), 'No note');
  assert.equal(M.historyLine('week', WEEK, 'UTC'), 'Saved Mon 16 Nov, 21:40');
  assert.deepEqual(M.summaryLines({ days_recorded: 9, weeks: [{ period_start: '2026-11-02' }, { period_start: '2026-11-09' }, { period_start: '2026-11-16' }] }),
    { days: { n: 9, note: 'days you chose to write' }, weeks: { n: 3, note: 'weeks of 2 Nov, 9 Nov and 16 Nov' } });
});

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
async function mount(tree, routes) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '').replace(/\?.*$/, '');
    const key = `${opts.method || 'GET'} ${path}`;
    asked.push({ key, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[key];
    const out = typeof hit === 'function' ? await hit(opts) : hit;
    if (out && out.__status) return response({ error: out.code, message: 'refused' }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'founder', name: 'Synthetic' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, tree)));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id), props: (id) => pr(by(id)), text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    submit: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await flush(); },
    radio: async (group, n) => {
      const g = by(group); assert.ok(g, `no ${group}`);
      const b = walk(g).find((x) => pr(x).role === 'radio' && String(x.textContent).trim() === String(n));
      await act(async () => { pr(b).onClick({}); });
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

test('home: three periods, each with its date and its own state; a failed read says so with Retry, never Not yet', async () => {
  const v = await mount(h(PeriodCards, { read: { state: 'ok', value: TODAY({ day: { period_start: '2026-11-17', period_end: '2026-11-17', reflection: DAY } }) }, timezone: 'UTC', onRetry() {} }), {});
  try {
    assert.equal(v.text('reflection-period-date-day'), 'Tue 17 Nov 2026');
    assert.equal(v.text('reflection-period-date-week'), '16–22 Nov 2026');
    assert.equal(v.text('reflection-period-date-month'), 'November 2026');
    assert.match(v.text('reflection-period-state-day'), /Saved 08:12/);
    assert.match(v.text('reflection-period-state-month'), /Not yet this month/);
    assert.equal(v.props('reflection-period-open-day').href, '/wellbeing?period=today');
    assert.match(v.text('reflection-period-open-month'), /Write monthly reflection/);
  } finally { await v.close(); }
  let retried = 0;
  const bad = await mount(h(PeriodCards, { read: { state: 'unreadable' }, timezone: 'UTC', onRetry() { retried += 1; } }), {});
  try {
    assert.match(bad.text('reflection-periods-unreadable'), /Couldn’t load your reflections\. They are unchanged/);
    assert.equal(bad.has('reflection-period-state-day'), false);
    await bad.click('button-retry-reflections');
    assert.equal(retried, 1);
  } finally { await bad.close(); }
});

test('Today: saving writes the day only; a 503 keeps every word on screen, and the retry reuses the request id', async () => {
  let calls = 0;
  const v = await mount(h(ReflectionView, { cadence: 'day', read: { state: 'ok', value: TODAY() }, timezone: 'UTC', onRetry() {}, onChanged() {} }), {
    'GET /wellbeing/reflections': { cadence: 'day', reflections: [DAY], retention: 'until_member_deletes' },
    'PUT /wellbeing/reflections/day/2026-11-17': () => (++calls === 1 ? { __status: 503, code: 'reflection_protection_unavailable' } : { ...DAY, created: true }),
  });
  try {
    assert.match(v.text('reflection-view-date'), /Tue 17 Nov 2026 · your local day \(UTC\)/);
    await v.radio('score-day-energy', 3);
    await v.change('reflection-text-day', 'Slow start, good afternoon.');
    await v.submit('reflection-editor-day');
    assert.match(v.text('reflection-save-error'), /can’t be stored encrypted right now/);
    assert.equal(v.props('reflection-text-day').value, 'Slow start, good afternoon.', 'the draft is kept');
    await v.submit('reflection-editor-day');
    const puts = v.asked.filter((a) => a.key.startsWith('PUT'));
    assert.equal(puts.length, 2);
    assert.equal(puts[0].key, 'PUT /wellbeing/reflections/day/2026-11-17', 'today’s own record, never the week’s');
    assert.deepEqual(puts[0].body.scores, { energy: 3 });
    assert.equal(puts[0].body.base_revision, 0);
    assert.ok(puts[0].body.request_id && puts[0].body.request_id === puts[1].body.request_id, 'the retry is the same attempt');
    assert.match(v.text('reflection-save-ok'), /Saved/);
    // History lists only days.
    assert.equal(v.has('reflection-history-row-2026-11-17'), true);
    assert.equal(v.asked.some((a) => a.key === 'GET /wellbeing/reflections'), true);
  } finally { await v.close(); }
});

test('This week: a copy changed elsewhere is refused and reloadable; the earlier check-ins are listed apart', async () => {
  let reloaded = 0;
  const v = await mount(h(ReflectionView, { cadence: 'week', read: { state: 'ok', value: TODAY() }, timezone: 'UTC', onRetry() { reloaded += 1; }, onChanged() {} }), {
    'GET /wellbeing/reflections': { cadence: 'week', reflections: [WEEK], retention: 'until_member_deletes' },
    'GET /wellbeing/reflections/earlier': { earlier: [{ kind: 'earlier_checkin', uid: 'e1', day: '2026-10-05', week_start: '2026-10-05', label: 'Earlier check-in' }] },
    'PUT /wellbeing/reflections/week/2026-11-16': { __status: 409, code: 'reflection_changed' },
  });
  try {
    await v.click('reflection-topic-Fundraising');
    await v.submit('reflection-editor-week');
    const put = v.asked.find((a) => a.key.startsWith('PUT'));
    assert.equal(put.body.base_revision, 1);
    assert.deepEqual(put.body.topics, ['Sleep', 'Fundraising']);
    assert.match(v.text('reflection-save-error'), /changed somewhere else/);
    await v.click('button-reflection-reload');
    assert.equal(reloaded, 1);
    assert.match(v.text('reflection-earlier'), /Earlier check-ins.*Mon 5 Oct 2026/);
  } finally { await v.close(); }
});

test('This month: what was recorded, counted only from what was written; Edit reflection opens a past month', async () => {
  const OCT = { uid: 'm0', cadence: 'month', period_start: '2026-10-01', period_end: '2026-10-31', timezone: 'UTC', scores: {}, text: M.monthText({ supported: 'Friends.', carry: '' }), topics: [], readable: true, revision: 1, created_at: '2026-10-31 18:20:00', updated_at: '2026-10-31 18:20:00' };
  const v = await mount(h(ReflectionView, { cadence: 'month', read: { state: 'ok', value: TODAY() }, timezone: 'UTC', onRetry() {}, onChanged() {} }), {
    'GET /wellbeing/reflections': { cadence: 'month', reflections: [OCT], retention: 'until_member_deletes' },
    'GET /wellbeing/reflections/months/2026-11/summary': { month: '2026-11', days_in_month: 30, days_recorded: 9, days: [], weeks: [{ period_start: '2026-11-16' }], month_reflection: null, topics: [] },
  });
  try {
    assert.match(v.text('reflection-month-days'), /^9 days you chose to write/);
    assert.match(v.text('reflection-month-weeks'), /^1 weeks of 16 Nov/);
    await v.click('button-reflection-edit-2026-10-01');
    assert.equal(v.props('reflection-month-supported').value, 'Friends.');
    assert.match(v.text('reflection-view-date'), /October 2026/);
  } finally { await v.close(); }
});

test('the heart opens Today: loading, a failed read with Retry, not yet with Save today, and saved with Edit reflection', async () => {
  // #8438: the popover's editor is React.lazy. Its dynamic import resolves on module-loader time, not on a count of
  // event-loop turns, so under CPU load it outlasted mount()'s flush and the editor was still the Suspense fallback.
  // Wait for the module itself: lazy() shares this promise, so once it settles the editor renders within a flush.
  await loadReflectionEditor();
  let first = true;
  const v = await mount(h(FounderWellbeingMenu), {
    'GET /wellbeing/reflections/today': () => { if (first) { first = false; return { __status: 503, code: 'reflections_unreadable' }; } return TODAY(); },
    'PUT /wellbeing/reflections/day/2026-11-17': { ...DAY },
  });
  try {
    await v.click('wellness-heart');
    assert.match(v.text('wellness-popover-error'), /Couldn’t load your check-in\. Your reflections are unchanged/);
    await v.click('button-wellness-retry');
    assert.match(v.text('wellness-popover-state'), /Not yet today/);
    assert.equal(v.has('reflection-editor-day'), true, 'Today opens directly in the popover');
    assert.equal(v.props('wellness-open-home').href, '/wellbeing');
  } finally { await v.close(); }
  const saved = await mount(h(FounderWellbeingMenu), { 'GET /wellbeing/reflections/today': TODAY({ day: { period_start: '2026-11-17', period_end: '2026-11-17', reflection: DAY } }) });
  try {
    await saved.click('wellness-heart');
    assert.equal(saved.props('wellness-popover-edit').href, '/wellbeing?period=today');
    assert.equal(saved.has('reflection-editor-day'), false);
  } finally { await saved.close(); }
});

test('wiring: the home reads ?period=, the old weekly writer is gone from the page, the sheet row is Wellness, dark pairs', () => {
  const page = read('frontend/src/pages/WellbeingPage.jsx');
  assert.match(page, /cadenceOfParam\(params\.get\('period'\)\)/);
  assert.match(page, /<ReflectionView cadence=\{cadence\}/);
  assert.match(page, /<PeriodCards read=\{reflections\.read\}/);
  assert.doesNotMatch(page, /<CheckinCard\b/, 'the weekly check-in no longer writes from the home');
  assert.doesNotMatch(page, /api\.wellbeingSubmit\(/);
  const sheet = read('frontend/src/ui/phone/AccountSheet.jsx');
  assert.match(sheet, /<SheetRow title="Wellness" to="\/wellbeing\?period=today"/);
  assert.doesNotMatch(sheet, /'Unreadable'/);
  for (const f of ['frontend/src/pages/wellbeing/Reflections.jsx', 'frontend/src/components/FounderWellbeingMenu.jsx']) {
    const src = read(f);
    for (const m of src.matchAll(/className=\{?[`"]([^`"]*)/g)) {
      const cls = m[1];
      if (/\bbg-white\b/.test(cls)) assert.match(cls, /dark:bg-/, `${f}: ${cls}`);
      if (/\bborder-stone-(200|300)\b/.test(cls)) assert.match(cls, /dark:border-/, `${f}: ${cls}`);
    }
    assert.doesNotMatch(src, /streak|missed|score of your/i, `${f}: no streaks, no "missed"`);
  }
});
