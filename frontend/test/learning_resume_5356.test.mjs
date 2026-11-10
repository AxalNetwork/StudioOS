/**
 * #5356 part 1 (D5356) — Continue learning opens the lesson the learner left, and the player starts at its saved
 * position, on desktop and phone. A course with no resumable lesson keeps its course link.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_resume_5356.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { learningApi } from '../src/lib/api/learning.js';
import { meRowHref, readMe, resumeLabel } from '../src/pages/learning/learningReads.js';
import { ContinueLearning, learningPhoneGroups } from '../src/pages/learning/LearningHome.jsx';
import { LessonView } from '../src/pages/learning/LearningWired.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const RESUME = { lesson_uid: 'l1', lesson_title: 'What a seed round is', lesson_kind: 'video', item_uid: 'v-yt', item_kind: 'video', position_seconds: 252, rule: 'last_started' };
const COURSE_ROW = { subject_kind: 'course', subject_uid: 'c1', status: 'started', percent: 50, title: 'Seed basics', item_kind: null, course_slug: 'seed-basics', updated_at: '2026-11-09T10:00:00.000Z', resume: RESUME };
const BARE_ROW = { ...COURSE_ROW, subject_uid: 'c2', title: 'Pre-seed', course_slug: 'pre-seed', resume: null };

const COURSE = {
  status: 'ready',
  course: { uid: 'c1', slug: 'seed-basics', title: 'Seed basics', status: 'published' },
  modules: [{ uid: 'm1', title: 'Foundations', position: 0, lessons: [
    { uid: 'l1', title: 'What a seed round is', position: 0, kind: 'video', ref_uid: 'v-yt', required: true, progress: { status: 'started' } },
    { uid: 'l2', title: 'Term sheets', position: 1, kind: 'reading', ref_uid: 'r-terms', required: true, progress: null },
  ] }],
  progress: { required: 2, completed: 0, percent: 0 },
};
const VIDEO = { uid: 'v-yt', kind: 'video', title: 'What a seed round is', video_source: 'url', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration_seconds: 720, transcript: null, status: 'published' };

test('a course row with a resume lesson opens that lesson; without one it keeps the course link', () => {
  assert.equal(meRowHref(COURSE_ROW), '/learning/courses/seed-basics/l1');
  assert.equal(meRowHref(BARE_ROW), '/learning/courses/pre-seed');
  assert.equal(meRowHref({ ...COURSE_ROW, resume: { ...RESUME, lesson_uid: '' } }), '/learning/courses/seed-basics', 'an empty uid is not a lesson');
  assert.equal(meRowHref({ ...COURSE_ROW, course_slug: null }), null, 'no slug, no link: the lesson cannot be reached without its course');
  assert.equal(resumeLabel(COURSE_ROW), 'Resume What a seed round is at 04:12');
  assert.equal(resumeLabel({ ...COURSE_ROW, resume: { ...RESUME, position_seconds: null } }), 'Resume What a seed round is', 'no position recorded, no time claimed');
  assert.equal(resumeLabel(BARE_ROW), null);
});

test('readMe carries the lesson link and the resume label from GET /me', async () => {
  const real = learningApi.me;
  learningApi.me = async () => ({ in_progress: [COURSE_ROW, BARE_ROW], completed: [] });
  try {
    const me = await readMe();
    assert.deepEqual(me.in_progress.map((r) => [r.href, r.resume_label]), [
      ['/learning/courses/seed-basics/l1', 'Resume What a seed round is at 04:12'],
      ['/learning/courses/pre-seed', null],
    ]);
  } finally { learningApi.me = real; }
});

test('desktop Continue learning links the lesson and says where it resumes', () => {
  const rows = [COURSE_ROW, BARE_ROW].map((r) => ({ ...r, href: meRowHref(r), resume_label: resumeLabel(r) }));
  const markup = html(h(ContinueLearning, { state: { status: 'ready', in_progress: rows, completed: [] } }));
  assert.match(markup, /href="\/learning\/courses\/seed-basics\/l1"/);
  assert.match(markup, /href="\/learning\/courses\/pre-seed"/);
  assert.match(flat(markup), /Resume What a seed round is at 04:12/);
  assert.equal((markup.match(/data-testid="continue-resume"/g) || []).length, 1, 'only the row with a resume lesson says so');
});

test('the phone Continue learning row opens the lesson too, and a course without one keeps its course link', () => {
  const phoneRow = (row) => {
    const r = { ...row, href: meRowHref(row), resume_label: resumeLabel(row) };
    const groups = learningPhoneGroups({ gated: false, me: { status: 'ready', in_progress: [r], completed: [] } });
    const found = [];
    const walk = (n) => { if (n && typeof n === 'object' && !n.$$typeof) { if (n.testid === 'learning-phone-continue-row') found.push(n); Object.values(n).forEach(walk); } };
    walk(groups);
    assert.equal(found.length, 1);
    return [found[0].to, found[0].description];
  };
  assert.deepEqual(phoneRow(COURSE_ROW), ['/learning/courses/seed-basics/l1', 'Resume What a seed round is at 04:12']);
  assert.equal(phoneRow(BARE_ROW)[0], '/learning/courses/pre-seed');
});

test('the journey: first lesson -> home -> Continue opens that lesson, and the player starts at the saved position', () => {
  // The lesson the Continue link names, opened with the item read the lesson page makes (its own saved position).
  const href = meRowHref(COURSE_ROW);
  const lessonUid = decodeURIComponent(href.split('/').pop());
  const itemState = { status: 'ready', item: VIDEO, transcriptRecorded: false, progress: { status: 'started', percent: 35, position_seconds: RESUME.position_seconds } };
  const markup = html(h(LessonView, { courseState: COURSE, itemState, lessonUid, onMark: () => {} }));
  assert.match(markup, /data-testid="lesson-resume"/);
  assert.match(flat(markup), /Resume from 04:12/);
  assert.match(flat(markup), /Lesson 1 of 2 in Foundations/);
});
