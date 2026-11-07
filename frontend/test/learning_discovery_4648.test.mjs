/**
 * #4648 (Learning audit 3/5) — discovery and reporting, in the real Learning home.
 *
 *   · typing in the search on Exercises or Exams changes the rows AND the total, from the Worker's own filter;
 *   · a new query, clearing it, a new tab and browser Back all start from the right page: an offset belongs to the tab
 *     and query it was read for;
 *   · reading, failed, no-match and nothing-published are four different screens;
 *   · "Your progress": the figures say where they come from and over what time; there is no "watch time"; a readable
 *     zero is 0 and an unreadable figure is "Not recorded".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import LearningHome, { AssessmentList, ProgressStrip } from '../src/pages/learning/LearningHome.jsx';
import { ALL_LIMIT, STAT_DEFINITIONS, statsTiles } from '../src/pages/learning/learningModel.js';
import { readExams, readExercises } from '../src/pages/learning/learningReads.js';
import { learningApi } from '../src/lib/api/learning.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const nodeText = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(nodeText).join('') : n?.textContent || '');
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// A fake Worker for the two lists: it filters by title, counts the filtered rows and pages them, as the real routes do.
function titles(prefix, n) { return Array.from({ length: n }, (_, i) => `${prefix} ${String(i + 1).padStart(2, '0')}`); }
const EXERCISES = [...titles('Pricing exercise', ALL_LIMIT + 6), 'Cap table drill', 'Hiring plan'];
const EXAMS = ['Term sheets', 'Term sheet traps', 'Cap tables'];
function fakeList(all, uidPrefix, hrefDir, calls, failing) {
  return async (p) => {
    calls.push({ ...p });
    if (failing.on) throw new Error('private failure detail');
    const q = String(p.q || '').toLowerCase();
    const hit = all.filter((t) => t.toLowerCase().includes(q));
    const page = hit.slice(p.offset || 0, (p.offset || 0) + p.limit);
    return {
      items: page.map((title) => ({ uid: `${uidPrefix}-${title.replace(/\W+/g, '-')}`, title, where: null, status: null, updated_at: null, question_count: 3, time_limit_minutes: null, pass_mark_percent: 70, attempts_left: null, best_score_percent: null, href: `/learning/${hrefDir}/x` })),
      total: hit.length, limit: p.limit, offset: p.offset || 0, q: p.q || '',
    };
  };
}
function stub({ exercises = EXERCISES, exams = EXAMS } = {}) {
  const before = { ...learningApi };
  const calls = { exercises: [], exams: [] };
  const failing = { on: false };
  learningApi.exercises = fakeList(exercises, 'ex', 'exercises', calls.exercises, failing);
  learningApi.exams = fakeList(exams, 'exam', 'exams', calls.exams, failing);
  learningApi.catalog = async () => ({ items: [], sources: {} });
  learningApi.me = async () => ({ in_progress: [], completed: [] });
  learningApi.myStats = async () => ({});
  learningApi.programs = learningApi.myEnrolledPrograms = async () => ({ programs: [] });
  learningApi.webinars = async () => ({ webinars: [] });
  return { calls, failing, restore() { Object.assign(learningApi, before); } };
}

async function mountHome(url) {
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let at = { search: '' }; let go;
  function Probe() { at = useLocation(); go = useNavigate(); return null; }
  const ui = await mountContracts(h(React.Fragment, null, h(Probe), h(LearningHome, { gated: false })), url, { id: 1, role: 'founder' });
  await ui.flush();
  const byId = (id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id);
  const rows = (kind) => ui.nodes().filter((n) => ui.props(n)?.['data-testid'] === `${kind}-row-title`);
  const type = async (value) => { await act(async () => ui.props(byId('input-learning-search')).onChange({ target: { value } })); await act(async () => { await new Promise((r) => setTimeout(r, 380)); }); await ui.flush(); };
  const page = async (id) => { await act(async () => ui.props(byId(id)).onClick({ stopPropagation() {} })); await ui.flush(); };
  return { ui, byId, rows, type, page, list: (kind) => nodeText(byId(`${kind}-list`)), search: () => new URLSearchParams(at.search), back: async () => { await act(async () => go(-1)); await ui.flush(); }, text: () => ui.text(),
    close: async () => { await ui.unmount(); globalThis.matchMedia = oldMedia; } };
}

test('typing on Exercises changes the rows and the total; the Worker is asked for that query from the first page', async () => {
  const s = stub(); const m = await mountHome('/learning?tab=exercises');
  try {
    assert.equal(m.rows('exercise').length, ALL_LIMIT, 'the first page of everything');
    assert.match(m.text(), new RegExp(`1.${ALL_LIMIT} of ${EXERCISES.length}`));
    await m.type('cap table');
    // Mutation checked: the query not passed to the read → the call has no q and the list does not change.
    assert.equal(s.calls.exercises.at(-1).q, 'cap table');
    assert.equal(s.calls.exercises.at(-1).offset, 0);
    assert.match(m.text(), /Cap table drill/);
    assert.doesNotMatch(m.text(), /Pricing exercise 01/);
    assert.match(m.text(), /1.1 of 1/, 'the total is the matching total');
    assert.equal(m.search().get('q'), 'cap table', 'the query is in the address');
  } finally { await m.close(); s.restore(); }
});

test('a query typed from page two starts at page one; clearing it restores the list and its total; Back restores the earlier query', async () => {
  const s = stub(); const m = await mountHome('/learning?tab=exercises');
  try {
    await m.page('button-exercise-pager-next');
    assert.equal(s.calls.exercises.at(-1).offset, ALL_LIMIT, 'page two');
    await m.type('pricing');
    // Mutation checked: the offset kept across a new query → this read asks for offset ALL_LIMIT of a shorter list.
    assert.equal(s.calls.exercises.at(-1).q, 'pricing');
    assert.equal(s.calls.exercises.at(-1).offset, 0, 'a new query starts at the first page');
    assert.ok(m.rows('exercise').length > 0, 'and shows rows, not an empty page two');
    await m.page('button-exercise-pager-next');
    assert.equal(s.calls.exercises.at(-1).offset, ALL_LIMIT);
    await m.type('');
    assert.equal(s.calls.exercises.at(-1).offset, 0, 'clearing the search starts at the first page');
    assert.equal(s.calls.exercises.at(-1).q, undefined, 'no query is sent');
    assert.match(m.text(), new RegExp(`of ${EXERCISES.length}`), 'the unfiltered total is back');
    await m.type('hiring'); assert.match(m.text(), /Hiring plan/);
    // Leave for Exams (a history entry) and come Back: the address still names the query, the list is its first page.
    await m.ui.click('Exams');
    assert.equal(m.search().get('tab'), 'exams');
    assert.equal(s.calls.exams.at(-1).offset, 0);
    await m.back();
    assert.equal(m.search().get('tab'), 'exercises');
    assert.equal(m.search().get('q'), 'hiring', 'Back restores the query with the address');
    assert.equal(s.calls.exercises.at(-1).q, 'hiring');
    assert.equal(s.calls.exercises.at(-1).offset, 0, 'at the first page of that query');
    assert.match(m.list('exercise'), /Hiring plan/);
    assert.doesNotMatch(m.list('exercise'), /Pricing exercise 01/);
    assert.match(m.text(), /1.1 of 1/, 'with that query\'s own total');
  } finally { await m.close(); s.restore(); }
});

test('Exams: a restored address with a query reads that query; the other tab\'s query and page do not leak across tabs', async () => {
  const s = stub(); const m = await mountHome('/learning?tab=exams&q=term+sheet');
  try {
    assert.equal(s.calls.exams.at(-1).q, 'term sheet');
    assert.deepEqual([...m.text().matchAll(/Term sheets?( traps)?/g)].length > 0, true);
    assert.match(m.text(), /1.2 of 2/);
    assert.doesNotMatch(m.text(), /Cap tables/);
    assert.equal(s.calls.exercises.length, 0, 'the Exercises tab is not read while Exams is open');
  } finally { await m.close(); s.restore(); }
});

test('reading, a failed read, no match and nothing published are four different screens', async () => {
  const s = stub(); const m = await mountHome('/learning?tab=exercises');
  try {
    await m.type('zzzz');
    // Mutation checked: the no-match words shown for a search that failed (or the other way round) → one of these fails.
    assert.match(m.list('exercise'), /No exercise title matches “zzzz”/);
    assert.match(m.list('exercise'), /Try another word, or clear the search/);
    assert.doesNotMatch(m.list('exercise'), /No exercises published yet|could not be read/);
    s.failing.on = true;
    await m.type('zzzzz');
    assert.match(m.list('exercise'), /could not be read/i);
    assert.match(m.list('exercise'), /not a claim that there are no exercises/);
    assert.doesNotMatch(m.list('exercise'), /No exercise title matches|No exercises published yet|private failure detail/);
  } finally { await m.close(); s.restore(); }
  const e = stub({ exercises: [] }); const n = await mountHome('/learning?tab=exercises');
  try {
    assert.match(n.list('exercise'), /No exercises published yet/);
    assert.doesNotMatch(n.list('exercise'), /title matches|could not be read/);
  } finally { await n.close(); e.restore(); }
  const loading = flat(renderToStaticMarkup(h(MemoryRouter, null, h(AssessmentList, { state: { status: 'loading' }, kind: 'exam', q: 'term' }))));
  assert.doesNotMatch(loading, /No exam title matches|No exams published yet|could not be read/, 'reading says none of the others');
});

test('the reads send a query only when there is one, and echo it', async () => {
  const seen = [];
  const before = { ...learningApi };
  learningApi.exercises = async (p) => { seen.push(p); return { items: [], total: 0, q: p.q || '' }; };
  learningApi.exams = async (p) => { seen.push(p); return { items: [], total: 0, q: p.q || '' }; };
  try {
    assert.equal((await readExercises({ offset: 5, q: '  cap  ' })).q, 'cap');
    await readExams({ q: '' });
    await readExercises({});
    assert.deepEqual(seen.map((p) => p.q), ['cap', undefined, undefined]);
    assert.equal(seen[0].offset, 5);
  } finally { Object.assign(learningApi, before); }
});

test('Your progress: every figure says where it comes from and over what time; there is no watch time; a readable 0 is 0', () => {
  const tiles = statsTiles({ courses_in_progress: 2, lessons_completed_this_month: 0, videos_played_this_month: 0, exams: { passed: 1, sat: 2 } });
  assert.deepEqual(tiles.map((t) => t.label), ['Courses in progress', 'Lessons completed this month', 'Videos played this month', 'Exams passed']);
  assert.deepEqual(tiles.map((t) => t.value), ['2', '0', '0', '1 of 2'], 'a readable nothing is 0');
  assert.deepEqual(tiles.map((t) => t.key).sort(), Object.keys(STAT_DEFINITIONS).sort(), 'each figure has a definition and each definition a figure');
  for (const t of tiles) assert.ok(t.source && t.definition && t.window, `${t.key} has a source, a definition and a window`);
  const unread = statsTiles({ courses_in_progress: null, lessons_completed_this_month: null, videos_played_this_month: null, exams: null });
  assert.deepEqual(unread.map((t) => t.value), ['Not recorded', 'Not recorded', 'Not recorded', 'Not recorded'], 'an unreadable figure is never 0');
  const old = statsTiles({ watch_seconds_this_month: 3600 });
  assert.equal(old.some((t) => /watch time/i.test(t.label) || t.value === '1 h'), false, 'a stale reply cannot draw a watch-time figure');
  const strip = flat(renderToStaticMarkup(h(MemoryRouter, null, h(ProgressStrip, { state: { status: 'ready', tiles } }))));
  assert.match(strip, /Videos you played: each video whose position was saved this month, counted once\. This is not time watched\. This calendar month \(UTC\)\./);
  assert.match(strip, /Courses you have started and not completed\. Right now\./);
  assert.doesNotMatch(strip, /Watch time/i);
});
