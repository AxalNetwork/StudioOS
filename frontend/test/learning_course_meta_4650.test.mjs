/**
 * #4650 part 2 (D4650) — the course page's "About this course" and the
 * studio's metadata fields.
 *
 *   1. `courseAbout` lists each recorded field in a fixed order and names each
 *      one that is not; nothing is inferred;
 *   2. the course page draws the rows, names what is missing, and says so in
 *      one sentence when nothing is recorded;
 *   3. the studio form reads a course's metadata and sends it back unchanged.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_course_meta_4650.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CourseOutline from '../src/pages/learning/CourseOutline.jsx';
import { ABOUT_NOT_RECORDED, courseAbout } from '../src/pages/learning/learningModel.js';
import { courseBody, courseForm } from '../src/pages/learning/studioActions.js';

const META = {
  audience: ['founder', 'investor'], stage: 'Pre-seed', outcomes: ['Read a term sheet', 'Price a round'],
  prerequisites: ['Know what equity is'], author: 'A. Author', reviewer: 'R. Reviewer', reviewed_on: '2026-10-01',
  practical_output: 'A model cap table',
};
const NONE = { audience: [], stage: null, outcomes: [], prerequisites: [], author: null, reviewer: null, reviewed_on: null, practical_output: null };

test('1. courseAbout lists what is recorded, in order, and names what is not', () => {
  // Mutation checked: the stage row dropped → the keys differ; a missing field not named → `missing` differs.
  const full = courseAbout(META);
  assert.deepEqual(full.rows.map((r) => r.key), ['audience', 'stage', 'outcomes', 'prerequisites', 'practical_output', 'people']);
  assert.equal(full.rows[0].value, 'Founders, Investors');
  assert.equal(full.rows[5].value, 'Written by A. Author, reviewed by R. Reviewer on 2026-10-01');
  assert.deepEqual(full.missing, []);
  const some = courseAbout({ ...NONE, outcomes: ['Read a term sheet'], author: 'A. Author' });
  assert.deepEqual(some.rows.map((r) => r.key), ['outcomes', 'people']);
  assert.deepEqual(some.missing, ['who it is for', 'stage', 'prerequisites', 'what you leave with']);
  assert.equal(courseAbout(NONE).empty, true);
  assert.equal(courseAbout(undefined).empty, true, 'an older read without meta is not recorded, not an error');
});

const page = (meta) => renderToStaticMarkup(h(MemoryRouter, null, h(CourseOutline, {
  status: 'ready', course: { uid: 'c1', slug: 'seed', title: 'Seed', level: 'intro', estimated_minutes: 30, status: 'published', meta },
  modules: [{ uid: 'm1', title: 'Basics', position: 0, lessons: [{ uid: 'l1', title: 'Watch', position: 0, kind: 'video', ref_uid: 'v1', required: true, progress: null }] }],
  progress: { required: 1, completed: 0, percent: 0 },
})));

test('2. the course page draws the rows, names what is missing, and says when nothing is recorded', () => {
  // Mutation checked: CourseAbout not mounted in the summary → the section is absent.
  const full = page(META);
  assert.match(full, /data-testid="course-about"/);
  assert.match(full, /About this course/);
  assert.match(full, /data-testid="course-about-outcomes"[^>]*><ul[^>]*><li>Read a term sheet<\/li><li>Price a round<\/li>/);
  assert.match(full, /You&#x27;ll leave with/);
  assert.doesNotMatch(full, /course-about-missing/);
  const some = page({ ...NONE, stage: 'Seed' });
  assert.match(some, /Not recorded: who it is for, outcomes, prerequisites, what you leave with, author and reviewer\./);
  const none = page(NONE);
  assert.match(none, /data-testid="course-about-empty"/);
  assert.ok(none.includes(ABOUT_NOT_RECORDED.replace(/'/g, '&#x27;')));
});

test('3. the studio form reads a course\'s metadata and sends it back unchanged', () => {
  // Mutation checked: courseForm joining outcomes with ", " → the body splits them wrong.
  const body = courseBody(courseForm({ title: 'Seed', slug: 'seed', meta: META }));
  const { title: _t, slug: _s, summary: _su, cover_url: _c, level: _l, estimated_minutes: _e, visibility: _v, resources: _r, ...meta } = body;
  assert.deepEqual(meta, META);
  const empty = courseBody(courseForm({ title: 'Seed', slug: 'seed' }));
  assert.deepEqual([empty.audience, empty.stage, empty.outcomes, empty.reviewed_on], [[], null, [], null]);
});
