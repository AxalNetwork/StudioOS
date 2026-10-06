/**
 * D562 stage 2 — the Learning screens wired to D557's routes (#1158, merged
 * as #1179): the catalog, a course, a lesson, a standalone item, my record,
 * and the Super Admin's studio.
 *
 * Every fixture here is in the shape `routes/learning.ts` or
 * `routes/admin_learning.ts` sends, and the first test reads those files to
 * hold the fixtures to them. Writes are checked through the real client
 * against a stubbed `fetch`, so the method, the path and the body are the
 * ones the page would send.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_wire_d562.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, matchRoutes } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { readRoutesSource } from './_routesSource.mjs';

import {
  catalogRow, findLesson, moveInOrder, parseLength, formatLength, videoPlayback,
} from '../src/pages/learning/learningModel.js';
import {
  markItemComplete, markLessonComplete, readCatalog, readCourse, readItem, readMe,
} from '../src/pages/learning/learningReads.js';
import {
  addLesson, addModule, courseBody, deleteLesson, deleteModule, itemBody, moveLesson, moveModule, readStudioCourse,
  readStudioCourses, readStudioItems, renameModule, saveCourse, saveItem, setCourseStatus, setItemStatus, studioRows,
  updateLesson,
} from '../src/pages/learning/studioActions.js';
import { CatalogList, ContinueLearning, LearningHomeView, catalogFor } from '../src/pages/learning/LearningHome.jsx';
import { CourseView, ItemView, LessonView, MeView, courseCoverage, itemFor } from '../src/pages/learning/LearningWired.jsx';
import { StudioView, sayingAt, targetOf } from '../src/pages/learning/LearningStudio.jsx';
import StudioItemEditor from '../src/pages/learning/StudioItemEditor.jsx';
import StudioCourseBuilder, { LessonForm, refLabel } from '../src/pages/learning/StudioCourseBuilder.jsx';
import { ConfirmRow, StatusActions } from '../src/pages/learning/studioParts.jsx';
import LearningPage from '../src/pages/learning/LearningPage.jsx';

process.env.TZ = 'UTC';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el, path = '/learning') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
// `&amp;` is decoded last, so an escaped entity such as `&amp;quot;` reads as
// `&quot;`, never as a quote (CodeQL's double-unescaping rule).
const flat = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const text = (el, path) => flat(html(el, path));
const page = (url, pattern, props) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: pattern, element: h(LearningPage, props) }))),
);
function tagOf(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
}
const count = (markup, needle) => markup.split(needle).length - 1;

// ── Fixtures, in the routes' own shapes ────────────────────────────────────

const EVENT_REASON = 'The event store could not be read, so this is not a claim that there are no upcoming events.';
/** `GET /api/learning/catalog` with no kind: `{ items, sources, limit, offset }`. */
const CATALOG_ALL = {
  items: [
    { kind: 'course', id: 'seed-basics', title: 'Seed basics', summary: 'Raise your first round', href: '/learning/courses/seed-basics', date: '2026-10-04T10:00:00.000Z', source: 'learning', level: 'intro', estimated_minutes: 80, cover_url: null, status: 'published' },
    { kind: 'video', id: 'v-cap', title: 'Cap tables in ten minutes', summary: null, href: '/learning/items/v-cap', date: '2026-10-03T10:00:00.000Z', source: 'learning', topic: 'Finance', level: 'intro', duration_seconds: 600, thumbnail_url: null, status: 'published' },
    { kind: 'reading', id: 'r-terms', title: 'Term sheet glossary', summary: null, href: '/learning/items/r-terms', date: null, source: 'learning', topic: null, level: null, duration_seconds: null, thumbnail_url: null, status: 'draft' },
    { kind: 'article', id: 'how-we-price-a-seed-round', title: 'How we price a seed round', summary: 'Three numbers, one page', href: '/articles/how-we-price-a-seed-round', date: '2026-10-02 09:30:00', source: 'articles', author: { name: 'Ada Founder', role: 'founder' }, read_minutes: 6 },
    { kind: 'publication', id: 'q3-sector-heat', title: 'Q3 sector heat', summary: 'Where rounds moved', href: '/insights/public/q3-sector-heat', date: '2026-10-01 08:00:00', source: 'publications', section: 'sector_heat', file: { recorded: false, reason: 'Publications are read on the page; the store holds no PDF.' } },
  ],
  sources: {
    course: { status: 'ready', total: 1 }, video: { status: 'ready', total: 1 }, reading: { status: 'ready', total: 1 },
    article: { status: 'ready', total: 9 }, publication: { status: 'ready', total: 1 }, event: { status: 'unreadable', reason: EVENT_REASON },
  },
  limit: 24,
  offset: 0,
};
/** `GET /api/learning/courses/:slug`: `{ course, modules, progress }`, no lesson lengths. */
const COURSE_REPLY = {
  course: {
    uid: 'c1', slug: 'seed-basics', title: 'Seed basics', summary: 'Raise your first round', cover_url: null, level: 'intro',
    estimated_minutes: 80, resources: [{ title: 'Term sheet template', url: 'https://example.com/term-sheet.pdf' }],
    status: 'published', published_at: '2026-10-04T10:00:00.000Z',
  },
  modules: [
    { uid: 'm1', title: 'Foundations', position: 0, lessons: [
      { uid: 'l1', title: 'What a seed round is', position: 0, kind: 'video', ref_uid: 'v-yt', required: true, progress: { status: 'completed', percent: null, completed_at: '2026-10-05T09:00:00.000Z' } },
      { uid: 'l2', title: 'Term sheet glossary', position: 1, kind: 'reading', ref_uid: 'r-terms', required: true, progress: null },
    ] },
    { uid: 'm2', title: 'Meeting investors', position: 1, lessons: [
      { uid: 'l3', title: 'Founder office hours', position: 0, kind: 'webinar', ref_uid: 'founder-office-hours', required: false, progress: null },
    ] },
  ],
  progress: { required: 2, completed: 1, percent: 50 },
};
const VIDEO = {
  uid: 'v-yt', kind: 'video', title: 'What a seed round is', summary: 'The round, in twelve minutes', body: null, video_source: 'url',
  video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration_seconds: 720, thumbnail_url: null,
  transcript: 'A seed round is the first priced round.\nIt sets the pre-money valuation.', topic: 'Fundraising', level: 'intro',
  status: 'published', published_at: '2026-10-02T10:00:00.000Z', updated_at: '2026-10-02T10:00:00.000Z',
};
/** `GET /api/learning/items/:uid`: `{ item, transcript_recorded, progress }`. */
const ITEM_VIDEO = { item: VIDEO, transcript_recorded: true, progress: null };
const ITEM_R2 = { item: { ...VIDEO, uid: 'v-r2', video_source: 'r2', video_url: null, transcript: null }, transcript_recorded: false, progress: { status: 'completed', percent: 100, position_seconds: null, completed_at: '2026-10-05T09:00:00.000Z' } };
const ITEM_READING = {
  item: { uid: 'r-terms', kind: 'reading', title: 'Term sheet glossary', summary: null, body: '## Pre-money\n\nThe value **before** the round.', video_source: null, video_url: null, duration_seconds: null, thumbnail_url: null, transcript: null, topic: null, level: null, status: 'published', published_at: null, updated_at: '2026-10-03T10:00:00.000Z' },
  transcript_recorded: false,
  progress: null,
};
/** `GET /api/learning/me`: `{ in_progress, completed }`. */
const ME_REPLY = {
  in_progress: [
    { subject_kind: 'course', subject_uid: 'c1', status: 'started', percent: 50, started_at: '2026-10-05T09:00:00.000Z', completed_at: null, updated_at: '2026-10-05T09:00:00.000Z', title: 'Seed basics', item_kind: null, course_slug: 'seed-basics' },
    { subject_kind: 'lesson', subject_uid: 'l9', status: 'started', percent: null, started_at: '2026-10-05T09:00:00.000Z', completed_at: null, updated_at: '2026-10-05T09:00:00.000Z', title: 'A lesson', item_kind: null, course_slug: null },
  ],
  completed: [
    { subject_kind: 'item', subject_uid: 'v-yt', status: 'completed', percent: 100, started_at: '2026-10-04T09:00:00.000Z', completed_at: '2026-10-04T09:30:00.000Z', updated_at: '2026-10-04T09:30:00.000Z', title: 'What a seed round is', item_kind: 'video', course_slug: null },
    { subject_kind: 'course', subject_uid: 'c0', status: 'completed', percent: 100, started_at: '2026-10-01T09:00:00.000Z', completed_at: '2026-10-03T09:00:00.000Z', updated_at: '2026-10-03T09:00:00.000Z', title: 'Orientation', item_kind: null, course_slug: 'orientation' },
  ],
};
/** `GET /api/admin/learning/items` and `/courses`: every row, drafts and archived included. */
const STUDIO_ITEMS = [
  { uid: 'v-yt', kind: 'video', title: 'What a seed round is', summary: null, body: null, video_source: 'url', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration_seconds: 725, thumbnail_url: null, transcript: null, topic: null, level: 'intro', visibility: 'open', status: 'published', created_by: 1, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-05T10:00:00.000Z', published_at: '2026-10-02T10:00:00.000Z' },
  { uid: 'r-terms', kind: 'reading', title: 'Term sheet glossary', summary: null, body: 'Text', video_source: null, video_url: null, duration_seconds: null, thumbnail_url: null, transcript: null, topic: null, level: null, visibility: 'program', status: 'draft', created_by: 1, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-03T10:00:00.000Z', published_at: null },
  { uid: 'v-old', kind: 'video', title: 'An archived video', summary: null, body: null, video_source: 'url', video_url: 'https://vimeo.com/76979871', duration_seconds: null, thumbnail_url: null, transcript: null, topic: null, level: null, visibility: 'open', status: 'archived', created_by: 1, created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-02T10:00:00.000Z', published_at: null },
];
const STUDIO_COURSES = [
  { uid: 'c1', slug: 'seed-basics', title: 'Seed basics', summary: null, cover_url: null, level: 'intro', estimated_minutes: 80, resources_json: '[]', visibility: 'open', status: 'draft', created_by: 1, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-04T10:00:00.000Z', published_at: null },
];
/** `courseTree`: the admin course with its modules and lessons. */
const TREE = {
  uid: 'c1', slug: 'seed-basics', title: 'Seed basics', summary: null, cover_url: null, level: 'intro', estimated_minutes: 80,
  visibility: 'open', status: 'draft', created_by: 1, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-04T10:00:00.000Z', published_at: null,
  resources: [{ title: 'Term sheet template', url: 'https://example.com/term-sheet.pdf' }],
  modules: [
    { uid: 'm1', title: 'Foundations', position: 0, lessons: [
      { uid: 'l1', title: 'What a seed round is', position: 0, kind: 'video', ref_uid: 'v-yt', required: true },
      { uid: 'l2', title: 'Founder office hours', position: 1, kind: 'webinar', ref_uid: 'founder-office-hours', required: false },
    ] },
    { uid: 'm2', title: 'Pricing', position: 1, lessons: [] },
  ],
};

/** The real client against a stubbed fetch: each call recorded, each reply taken in turn. */
async function withFetch(replies, run) {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const queue = [...replies];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', path: String(url).replace(/^.*\/api/, ''), body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = queue.shift() ?? { status: 200, body: {} };
    const reply = next.status ? next : { status: 200, body: next };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = orig; }
  return calls;
}

// ── The routes' shapes ─────────────────────────────────────────────────────

test('the reads and writes call the routes D557 mounted, in the shapes those routes send', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /app\.route\('\/api\/learning', learning\w*\);/);
  assert.match(index, /app\.route\('\/api\/admin\/learning', adminLearning\w*\);/);
  const member = read('cloudflare-worker/src/routes/learning.ts');
  for (const route of ["r.get('/catalog'", "r.get('/courses/:slug'", "r.get('/items/:uid'", "r.post('/progress'", "r.get('/me'"]) {
    assert.ok(member.includes(route), `learning.ts no longer declares ${route}`);
  }
  // The reply keys the reads take apart.
  assert.ok(member.includes('return c.json({ items: rows.slice(0, limit), sources, limit, offset });'));
  for (const key of ['course: {', 'modules: (mods.results', 'progress: { required: required.length, completed: done, percent:', 'transcript_recorded:', 'in_progress: list.filter', 'completed: list.filter']) {
    assert.ok(member.includes(key), `learning.ts no longer sends ${key}`);
  }
  // What each catalog row carries for its kind, as the fixtures above do.
  for (const field of ["href: `/learning/items/${x.uid}`", "author: { name: x.author_name ?? null, role: x.author_role ?? null }", 'event_type: x.type ?? null', 'estimated_minutes: x.estimated_minutes ?? null']) {
    assert.ok(member.includes(field), `the catalog row no longer carries ${field}`);
  }
  // The course route sends no lesson length: the outline says so once.
  const lessonSelect = member.slice(member.indexOf('SELECT l.uid, l.module_id'), member.indexOf('FROM learning_lessons l JOIN'));
  assert.doesNotMatch(lessonSelect, /duration/);
  const admin = read('cloudflare-worker/src/routes/admin_learning.ts');
  for (const reply of ["return c.json({ items: res.results || [] });", "return c.json({ courses: (res.results || []).map", "c.json({ course: await courseTree(", "c.json({ item: await c.env.DB.prepare(ITEM_SELECT"]) {
    assert.ok(admin.includes(reply), `admin_learning.ts no longer answers ${reply}`);
  }
  // A webinar lesson names an event by its slug.
  assert.ok(admin.includes("A webinar lesson names an event by its slug."));
  // A file is attached only through D561's upload routes, never by setting
  // video_source on the item: the studio still offers a link until it calls them.
  assert.ok(admin.includes("bad('video_source_by_upload'"));
});

test('the member reads: the catalog, a course, an item and my record, each mapped from its reply', async () => {
  let all; let courses; let course; let item; let me;
  const calls = await withFetch([CATALOG_ALL, { ...CATALOG_ALL, items: [CATALOG_ALL.items[0]], sources: { course: { status: 'ready', total: 30 } }, offset: 24 }, COURSE_REPLY, ITEM_VIDEO, ME_REPLY], async () => {
    all = await readCatalog({ q: 'seed' });
    courses = await readCatalog({ kind: 'course', offset: 24 });
    course = await readCourse('seed-basics');
    item = await readItem('v-yt');
    me = await readMe();
  });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /learning/catalog?q=seed&limit=24',
    'GET /learning/catalog?kind=course&limit=24&offset=24',
    'GET /learning/courses/seed-basics',
    'GET /learning/items/v-yt',
    'GET /learning/me',
  ]);
  assert.deepEqual(all.rows.map((r) => [r.kind, r.href]), [
    ['course', '/learning/courses/seed-basics'],
    // A video opens at its own route; a reading at the href the catalog sends.
    ['video', '/learning/videos/v-cap'],
    ['reading', '/learning/items/r-terms'],
    ['article', '/articles/how-we-price-a-seed-round'],
    ['publication', '/insights/public/q3-sector-heat'],
  ]);
  assert.equal(all.sources.event.reason, EVENT_REASON, 'the route\'s own reason is kept');
  assert.equal(all.rows[2].draft, 'Draft');
  assert.deepEqual([courses.kind, courses.offset, courses.sources.course.total], ['course', 24, 30]);
  assert.equal(course.progress.percent, 50);
  assert.equal(item.transcriptRecorded, true);
  assert.deepEqual(me.in_progress.map((r) => r.href), ['/learning/courses/seed-basics', null], 'a bare lesson has nowhere to open');
  assert.deepEqual(me.completed.map((r) => r.href), ['/learning/videos/v-yt', '/learning/courses/orientation']);
  // A reply in the wrong shape is a failed read, and a 404 keeps its status for "no such".
  await withFetch([{ rows: [] }, { items: [] }, { course: null }, { status: 404, body: { error: 'not_found', message: 'No such course.', detail: 'No such course.' } }], async () => {
    await assert.rejects(readCatalog(), /cannot read/);
    await assert.rejects(readCatalog(), /without its sources/);
    await assert.rejects(readCourse('x'), /cannot read/);
    await assert.rejects(readCourse('gone'), (err) => err.status === 404 && err.message === 'No such course.');
  });
});

test('"Mark complete" records the lesson, then the course at the server\'s own percent', async () => {
  const done = { ...COURSE_REPLY, progress: { required: 2, completed: 2, percent: 100 } };
  let fresh;
  const calls = await withFetch([{ progress: {} }, done, { progress: {} }], async () => {
    fresh = await markLessonComplete({ course: COURSE_REPLY.course, lessonUid: 'l2', slug: 'seed-basics' });
  });
  assert.deepEqual(calls, [
    { method: 'POST', path: '/learning/progress', body: { subject_kind: 'lesson', subject_uid: 'l2', status: 'completed' } },
    { method: 'GET', path: '/learning/courses/seed-basics', body: undefined },
    { method: 'POST', path: '/learning/progress', body: { subject_kind: 'course', subject_uid: 'c1', status: 'completed', percent: 100 } },
  ]);
  assert.equal(fresh.progress.percent, 100);
  // Part of the way: the course is started, at the route's percent.
  const halfway = await withFetch([{ progress: {} }, COURSE_REPLY, { progress: {} }], () => markLessonComplete({ course: COURSE_REPLY.course, lessonUid: 'l1', slug: 'seed-basics' }));
  assert.deepEqual(halfway[2].body, { subject_kind: 'course', subject_uid: 'c1', status: 'started', percent: 50 });
  // No required lesson: no percentage is invented.
  const none = await withFetch([{ progress: {} }, { ...COURSE_REPLY, progress: { required: 0, completed: 0, percent: null } }, { progress: {} }],
    () => markLessonComplete({ course: COURSE_REPLY.course, lessonUid: 'l3', slug: 'seed-basics' }));
  assert.deepEqual(none[2].body, { subject_kind: 'course', subject_uid: 'c1', status: 'started' });
  const item = await withFetch([{ progress: { status: 'completed' } }], () => markItemComplete('v-yt'));
  assert.deepEqual(item, [{ method: 'POST', path: '/learning/progress', body: { subject_kind: 'item', subject_uid: 'v-yt', status: 'completed' } }]);
});

test('the studio\'s writes go out with the right method, path and body', async () => {
  const video = {
    title: 'What a seed round is', summary: '', video_url: 'https://youtu.be/dQw4w9WgXcQ', length: '12:05', thumbnail_url: '',
    transcript: 'Hello', body: 'ignored for a video', topic: 'Fundraising', level: 'intro', visibility: 'open',
  };
  const calls = await withFetch([
    { items: STUDIO_ITEMS }, { courses: STUDIO_COURSES }, { course: TREE },
    { item: STUDIO_ITEMS[0] }, { item: STUDIO_ITEMS[1] }, { item: {} }, { item: {} }, { item: {} },
    { course: TREE }, { course: TREE }, { course: TREE }, { course: TREE }, { course: TREE }, { course: TREE }, { course: TREE },
    { course: TREE }, { course: TREE }, { course: TREE }, { course: TREE },
  ], async () => {
    await readStudioItems();
    await readStudioCourses();
    await readStudioCourse('c1');
    await saveItem({ uid: null, kind: 'video', form: video });
    await saveItem({ uid: 'r-terms', kind: 'reading', form: { ...video, length: '', level: '', visibility: 'program', body: '# Glossary' } });
    await setItemStatus('v-yt', 'publish');
    await setItemStatus('v-yt', 'unpublish');
    await setItemStatus('v-yt', 'archive');
    await saveCourse({ uid: null, form: { title: 'Seed basics', slug: 'seed-basics', summary: '', cover_url: '', level: '', estimated_minutes: ' 80 ', visibility: 'open', resources: [{ title: 'Template', url: 'https://example.com/t.pdf' }, { title: ' ', url: '' }] } });
    await saveCourse({ uid: 'c1', form: { title: 'Seed basics', slug: 'seed-basics', summary: 'S', cover_url: '', level: 'advanced', estimated_minutes: '', visibility: 'program', resources: [] } });
    await setCourseStatus('c1', 'publish');
    await addModule('c1', 'Pricing');
    await renameModule('m2', 'Pricing a round');
    await moveModule(TREE, 'm2', -1);
    await deleteModule('m2');
    await addLesson('m1', { kind: 'reading', title: 'Glossary', ref_uid: 'r-terms', required: false });
    // The lesson form holds the kind too; PATCH takes none, so it is not sent.
    await updateLesson('l1', { kind: 'video', title: 'What a seed round is', ref_uid: 'v-yt', required: true });
    await moveLesson(TREE.modules[0], 'l2', -1);
    await deleteLesson('l2');
  });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /admin/learning/items',
    'GET /admin/learning/courses',
    'GET /admin/learning/courses/c1',
    'POST /admin/learning/items',
    'PATCH /admin/learning/items/r-terms',
    'POST /admin/learning/items/v-yt/publish',
    'POST /admin/learning/items/v-yt/unpublish',
    'POST /admin/learning/items/v-yt/archive',
    'POST /admin/learning/courses',
    'PATCH /admin/learning/courses/c1',
    'POST /admin/learning/courses/c1/publish',
    'POST /admin/learning/courses/c1/modules',
    'PATCH /admin/learning/modules/m2',
    'POST /admin/learning/courses/c1/modules/order',
    'DELETE /admin/learning/modules/m2',
    'POST /admin/learning/modules/m1/lessons',
    'PATCH /admin/learning/lessons/l1',
    'POST /admin/learning/modules/m1/lessons/order',
    'DELETE /admin/learning/lessons/l2',
  ]);
  const bodyOf = (i) => calls[i].body;
  // A new video: its kind, its link and transcript, the length in whole seconds, and no reading text.
  assert.deepEqual(bodyOf(3), {
    kind: 'video', title: 'What a seed round is', summary: '', duration_seconds: 725, thumbnail_url: '', topic: 'Fundraising',
    level: 'intro', visibility: 'open', video_url: 'https://youtu.be/dQw4w9WgXcQ', transcript: 'Hello',
  });
  // An edited reading: its text, no kind (PATCH takes none), and no video fields; an unset level is null.
  assert.deepEqual(bodyOf(4), {
    title: 'What a seed round is', summary: '', duration_seconds: null, thumbnail_url: '', topic: 'Fundraising',
    level: null, visibility: 'program', body: '# Glossary',
  });
  for (const i of [5, 6, 7, 10]) assert.equal(bodyOf(i), undefined, 'a status change sends no body');
  // A course: blank resource rows dropped, the minutes trimmed for the route to read.
  assert.deepEqual(bodyOf(8), {
    title: 'Seed basics', slug: 'seed-basics', summary: '', cover_url: '', level: null, estimated_minutes: '80', visibility: 'open',
    resources: [{ title: 'Template', url: 'https://example.com/t.pdf' }],
  });
  assert.deepEqual(bodyOf(9).resources, []);
  assert.deepEqual(bodyOf(11), { title: 'Pricing' });
  assert.deepEqual(bodyOf(12), { title: 'Pricing a round' });
  // Up and down send the complete new order, as the route requires.
  assert.deepEqual(bodyOf(13), { order: ['m2', 'm1'] });
  assert.deepEqual(bodyOf(15), { kind: 'reading', title: 'Glossary', ref_uid: 'r-terms', required: false });
  assert.deepEqual(bodyOf(16), { title: 'What a seed round is', ref_uid: 'v-yt', required: true });
  assert.deepEqual(bodyOf(17), { order: ['l2', 'l1'] });
  assert.equal(bodyOf(14), undefined);
  // Already at its end: nothing is sent.
  const still = await withFetch([], async () => {
    assert.equal(await moveModule(TREE, 'm1', -1), null);
    assert.equal(await moveLesson(TREE.modules[0], 'l2', 1), null);
  });
  assert.deepEqual(still, []);
});

test('a refusal reaches the studio in the route\'s own words, and a bad length is refused before anything is sent', async () => {
  const refusal = { error: 'no_video', message: 'A video needs its link before it is published.', detail: 'A video needs its link before it is published.' };
  await withFetch([{ status: 409, body: refusal }], async () => {
    await assert.rejects(setItemStatus('v-new', 'publish'), (err) => err.message === refusal.message && err.code === 'no_video' && err.status === 409);
  });
  const notEmpty = { error: 'module_not_empty', message: 'Remove the module’s lessons first.', detail: 'Remove the module’s lessons first.' };
  await withFetch([{ status: 409, body: notEmpty }], async () => {
    await assert.rejects(deleteModule('m1'), (err) => err.message === 'Remove the module’s lessons first.');
  });
  const sent = await withFetch([], async () => {
    await assert.rejects(saveItem({ uid: 'v-yt', kind: 'video', form: { title: 'x', length: 'twelve' } }), /Length is minutes, or minutes and seconds as 12:05\./);
  });
  assert.deepEqual(sent, [], 'a length the page cannot read went to the route anyway');
  // And the studio draws the sentence it got, as it got it.
  const editor = html(h(StudioItemEditor, { item: STUDIO_ITEMS[0], kind: 'video', onSave: () => {}, onStatus: () => {}, error: refusal.message }));
  assert.match(tagOf(editor, 'studio-error'), /role="alert"/);
  assert.ok(flat(editor).includes(refusal.message));
  const builder = html(h(StudioCourseBuilder, { course: TREE, items: STUDIO_ITEMS, handlers: {}, error: { where: 'modules', message: notEmpty.message } }));
  assert.ok(flat(builder.slice(builder.indexOf('data-testid="studio-modules"'))).includes(notEmpty.message));
  assert.equal(count(builder, 'Remove the module’s lessons first.'), 1, 'a module refusal is shown once, beside the modules');
});

// ── The screens, from the routes' shapes ───────────────────────────────────

const allState = () => ({ status: 'ready', ...{ rows: CATALOG_ALL.items.map(catalogRow), sources: CATALOG_ALL.sources, offset: 0, kind: null } });

test('All reads the catalog: every kind labelled, its own href, a draft marked, and each source\'s state kept', () => {
  const markup = html(h(CatalogList, { state: allState(), q: '' }));
  const out = flat(markup);
  for (const line of [
    'Course Seed basics Intro · 1 h 20 min',
    'Video Cap tables in ten minutes 10 min · Finance · Intro',
    'Reading Draft Term sheet glossary',
    'Article How we price a seed round Ada Founder · 6 min read · 2 Oct 2026',
    'Publication Q3 sector heat 1 Oct 2026 · Sector Heat',
  ]) assert.ok(out.includes(line), `All lost "${line}"`);
  assert.match(markup, /href="\/learning\/videos\/v-cap"/);
  assert.match(markup, /href="\/learning\/items\/r-terms"/);
  // The events source failed: its reason, in the route's words, and no "no events".
  assert.ok(flat(tagOf(markup, 'source-unreadable-event') + markup.slice(markup.indexOf('data-testid="source-unreadable-event"'), markup.indexOf('</p>', markup.indexOf('data-testid="source-unreadable-event"')))).includes(EVENT_REASON));
  assert.equal(count(markup, 'data-testid="source-unreadable-'), 1);
  assert.doesNotMatch(markup, /learning-empty/);
  assert.match(out, /The newest 5 across courses, videos, readings, articles, publications and events/);
  // Every failed, nothing returned: the reasons, never an empty state.
  const bare = html(h(CatalogList, { state: { status: 'ready', rows: [], sources: { course: { status: 'unreadable', reason: 'The course store could not be read, so this is not a claim that there are no courses.' } }, offset: 0 }, q: '' }));
  assert.match(bare, /source-unreadable-course/);
  assert.doesNotMatch(bare, /learning-empty/);
  assert.match(html(h(CatalogList, { state: { status: 'ready', rows: [], sources: { course: { status: 'ready', total: 0 } }, offset: 0 }, q: '' })), /learning-empty/);
  assert.match(html(h(CatalogList, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(flat(html(h(CatalogList, { state: { status: 'unreadable' }, onRetry: () => {} }))), /The catalogue could not be read\. This is not a claim that nothing is published\./);
});

test('Courses and Videos page one kind through the catalog, and a failed source is not "no courses"', () => {
  const rows = [catalogRow(CATALOG_ALL.items[0])];
  const first = html(h(CatalogList, { state: { status: 'ready', rows, sources: { course: { status: 'ready', total: 30 } }, offset: 0, kind: 'course' }, kind: 'course', onPage: () => {} }));
  assert.match(flat(first), /1–1 of 30/);
  assert.match(tagOf(first, 'button-catalog-prev'), /disabled=""/);
  assert.doesNotMatch(tagOf(first, 'button-catalog-next'), /disabled=""/);
  const last = html(h(CatalogList, { state: { status: 'ready', rows, sources: { course: { status: 'ready', total: 25 } }, offset: 24, kind: 'course' }, kind: 'course', onPage: () => {} }));
  assert.match(flat(last), /25–25 of 25/);
  assert.match(tagOf(last, 'button-catalog-next'), /disabled=""/);
  const failed = flat(html(h(CatalogList, { state: { status: 'ready', rows: [], sources: { video: { status: 'unreadable', reason: 'The video store could not be read, so this is not a claim that there are no videos.' } }, offset: 0, kind: 'video' }, kind: 'video' })));
  assert.match(failed, /The video store could not be read, so this is not a claim that there are no videos\./);
  assert.doesNotMatch(failed, /No video published yet/);
  assert.match(text(h(CatalogList, { state: { status: 'ready', rows: [], sources: { video: { status: 'ready', total: 0 } }, offset: 0, kind: 'video' }, kind: 'video' })), /No video published yet/);
  // The home: Courses and Videos are live tabs, read from the catalog.
  const view = html(h(LearningHomeView, { gated: false, tab: 'videos', catalog: { status: 'ready', rows: [catalogRow(CATALOG_ALL.items[1])], sources: { video: { status: 'ready', total: 1 } }, offset: 0, kind: 'video' } }));
  assert.match(tagOf(view, 'panel-videos'), /data-mode="live"/);
  assert.match(view, /data-testid="list-catalog-video"/);
});

test('Continue learning reads my record', () => {
  const me = { status: 'ready', in_progress: ME_REPLY.in_progress.map((r) => ({ ...r, href: r.course_slug ? `/learning/courses/${r.course_slug}` : null })), completed: [] };
  const markup = html(h(ContinueLearning, { state: me }));
  assert.match(flat(markup), /Seed basics 50%/);
  assert.match(markup, /href="\/learning\/courses\/seed-basics"/);
  assert.equal(count(markup, 'data-testid="row-continue"'), 1, 'a bare lesson with nowhere to open was listed');
  assert.match(text(h(ContinueLearning, { state: { status: 'ready', in_progress: [], completed: [] } })), /Nothing in progress/);
  assert.match(html(h(ContinueLearning, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(flat(html(h(ContinueLearning, { state: { status: 'unreadable' }, onRetry: () => {} }))), /Your progress could not be read\. This is not a claim that you have started nothing\./);
});

test('a course page from GET /courses/:slug: progress over required lessons, lengths said once, resources, certificate', () => {
  const state = { status: 'ready', ...COURSE_REPLY };
  const markup = html(h(CourseView, { state }));
  const out = flat(markup);
  assert.match(out, /50% · 1 of 2 required lessons/);
  assert.match(markup, /data-testid="course-lengths-note"/);
  assert.match(out, /Lesson lengths are not recorded\./);
  // The course's own length is a column the route sends; a lesson's is not.
  assert.match(out, /1 h 20 min/);
  assert.equal(count(markup, 'Length not recorded'), 0, 'no row says it again');
  assert.doesNotMatch(out, /length not recorded/, 'no module claims a total');
  const unsized = html(h(CourseView, { state: { ...state, course: { ...state.course, estimated_minutes: null } } }));
  assert.equal(count(unsized, 'Length not recorded'), 1, 'the summary pill only: no row repeats it');
  assert.match(markup, /data-testid="lesson-done-l1"/);
  assert.doesNotMatch(markup, /lesson-done-l2/);
  // The webinar lesson opens its event (D557: a webinar lesson names an event by its slug).
  assert.match(markup, /href="\/events\/founder-office-hours"/);
  assert.match(markup, /href="\/learning\/courses\/seed-basics\/l2"[^>]*>|data-testid="link-course-continue"/);
  assert.match(tagOf(markup, 'link-course-continue'), /href="\/learning\/courses\/seed-basics\/l2"/);
  assert.match(markup, /href="https:\/\/example\.com\/term-sheet\.pdf" target="_blank" rel="noopener noreferrer"/);
  // The route stores https links only; anything else is drawn, never linked.
  const odd = html(h(CourseView, { state: { ...state, course: { ...state.course, resources: [{ title: 'Odd', url: 'javascript:alert(1)' }] } } }));
  assert.match(flat(odd), /Odd/);
  assert.doesNotMatch(odd, /href="javascript:/);
  assert.match(out, /Certificate Not recorded Certificates are not issued for courses yet\./);
  assert.deepEqual(courseCoverage(state), ['2 modules and 3 lessons in “Seed basics”', '1 of 2 required lessons completed']);
  // No resources, a course with no required lesson, no such course, loading, unreadable.
  const bare = { ...state, course: { ...state.course, resources: [] }, progress: { required: 0, completed: 0, percent: null } };
  const bareOut = text(h(CourseView, { state: bare }));
  assert.match(bareOut, /No resources/);
  assert.match(bareOut, /No lesson is required, so there is no percentage\./);
  assert.doesNotMatch(html(h(CourseView, { state: bare })), /role="progressbar"/);
  assert.match(text(h(CourseView, { state: { status: 'missing' } })), /No such course/);
  assert.match(html(h(CourseView, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(html(h(CourseView, { state: { status: 'unreadable' }, onRetry: () => {} })), /learning-unreadable/);
});

test('a lesson plays its item: a YouTube link embedded, its transcript, previous and next, and Mark complete', () => {
  const courseState = { status: 'ready', ...COURSE_REPLY };
  const markup = html(h(LessonView, { courseState, itemState: { status: 'ready', ...readItemShape(ITEM_VIDEO) }, lessonUid: 'l1', onMark: () => {} }));
  assert.match(markup, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(flat(markup), /A seed round is the first priced round\. It sets the pre-money valuation\./);
  assert.doesNotMatch(markup, /No transcript is recorded/);
  assert.match(tagOf(markup, 'link-lesson-next'), /href="\/learning\/courses\/seed-basics\/l2"/);
  assert.match(flat(markup), /Foundations · lesson 1 of 3/);
  // l1 is completed in the course read; l2 is not, and its button is live.
  assert.match(markup, /data-testid="text-lesson-completed"/);
  const l2 = html(h(LessonView, { courseState, itemState: { status: 'ready', ...readItemShape(ITEM_READING) }, lessonUid: 'l2', onMark: () => {} }));
  assert.match(l2, /<h2>Pre-money<\/h2>/);
  assert.ok(tagOf(l2, 'button-mark-complete'));
  assert.doesNotMatch(tagOf(l2, 'button-mark-complete'), /disabled=""/);
  assert.match(tagOf(l2, 'link-lesson-prev'), /href="\/learning\/courses\/seed-basics\/l1"/);
  assert.match(tagOf(l2, 'lesson-row-l2'), /aria-current="step"/);
  // A refusal on Mark complete is shown as it came.
  assert.match(flat(html(h(LessonView, { courseState, itemState: { status: 'ready', ...readItemShape(ITEM_READING) }, lessonUid: 'l2', onMark: () => {}, markError: 'No such item, lesson or course.' }))), /No such item, lesson or course\./);
  // States: the course loading or unreadable, the item loading, the item not published, no such lesson.
  assert.match(html(h(LessonView, { courseState: { status: 'loading' }, itemState: { status: 'idle' }, lessonUid: 'l1' })), /learning-loading/);
  assert.match(html(h(LessonView, { courseState: { status: 'unreadable' }, itemState: { status: 'idle' }, lessonUid: 'l1', onRetryCourse: () => {} })), /learning-unreadable/);
  assert.match(html(h(LessonView, { courseState, itemState: { status: 'loading' }, lessonUid: 'l1' })), /learning-loading/);
  assert.match(text(h(LessonView, { courseState, itemState: { status: 'missing' }, lessonUid: 'l1' })), /The video or reading this lesson opens is not published\./);
  assert.match(text(h(LessonView, { courseState, itemState: { status: 'idle' }, lessonUid: 'nope' })), /No such lesson/);
});

/** What `readItem` hands a view, from a reply. */
function readItemShape(reply) {
  return { item: reply.item, transcriptRecorded: reply.transcript_recorded === true, progress: reply.progress || null };
}

test('how a video plays: each allow-listed host embedded its own way, an upload not recorded until #1162', () => {
  const play = (video_url, extra = {}) => videoPlayback({ kind: 'video', video_source: 'url', video_url, ...extra });
  assert.deepEqual(play('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', embed: true });
  assert.deepEqual(play('https://youtu.be/dQw4w9WgXcQ?t=4'), { src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', embed: true });
  assert.deepEqual(play('https://m.youtube.com/shorts/dQw4w9WgXcQ'), { src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', embed: true });
  assert.deepEqual(play('https://vimeo.com/76979871'), { src: 'https://player.vimeo.com/video/76979871', embed: true });
  assert.deepEqual(play('https://player.vimeo.com/video/76979871?h=abc'), { src: 'https://player.vimeo.com/video/76979871', embed: true });
  const stream = '0123456789abcdef0123456789abcdef';
  assert.deepEqual(play(`https://customer-abc123.cloudflarestream.com/${stream}/watch`), { src: `https://customer-abc123.cloudflarestream.com/${stream}/iframe`, embed: true });
  assert.deepEqual(play(`https://videodelivery.net/${stream}`), { src: `https://iframe.videodelivery.net/${stream}`, embed: true });
  // A link that names no video it can embed: the reason, and the link.
  assert.deepEqual(play('https://www.youtube.com/@axal'), { reason: 'This link cannot be played on this page.', href: 'https://www.youtube.com/@axal' });
  assert.match(play('http://youtu.be/dQw4w9WgXcQ').reason, /not https/);
  assert.match(play('').reason, /No video link is recorded/);
  // An upload has no stream route yet.
  const r2 = videoPlayback(ITEM_R2.item);
  assert.equal(r2.src, undefined);
  assert.match(r2.reason, /streaming is not live yet/);
  assert.equal(videoPlayback(ITEM_READING.item), null, 'a reading is not a video');
  const view = html(h(ItemView, { state: { status: 'ready', ...readItemShape(ITEM_R2) } }));
  assert.match(view, /data-testid="lesson-video-absent"/);
  assert.match(flat(view), /Not recorded · This video was uploaded to be streamed here, and streaming is not live yet\./);
  assert.match(flat(view), /No transcript is recorded for this video\./);
  assert.match(view, /data-testid="text-lesson-completed"/, 'the stored progress is shown');
  const elsewhere = html(h(ItemView, { state: { status: 'ready', item: { ...VIDEO, video_url: 'https://www.youtube.com/@axal' }, progress: null } }));
  assert.match(tagOf(elsewhere, 'link-video-elsewhere'), /href="https:\/\/www\.youtube\.com\/@axal"/);
});

test('a lesson that opens elsewhere: a webinar opens its event, an exercise waits on #1160', () => {
  const courseState = { status: 'ready', ...COURSE_REPLY };
  const webinar = html(h(LessonView, { courseState, itemState: { status: 'idle' }, lessonUid: 'l3' }));
  assert.match(webinar, /data-testid="lesson-elsewhere"/);
  assert.match(webinar, /href="\/events\/founder-office-hours"/);
  const withExercise = {
    ...courseState,
    modules: [{ uid: 'm9', title: 'Practice', position: 0, lessons: [{ uid: 'l9', title: 'Write it', position: 0, kind: 'exercise', ref_uid: 'e1', required: true, progress: null }] }],
  };
  assert.match(text(h(LessonView, { courseState: withExercise, itemState: { status: 'idle' }, lessonUid: 'l9' })), /Not recorded Exercises are not live yet\./);
  assert.deepEqual(findLesson(COURSE_REPLY.modules, 'l2').prev.uid, 'l1');
  assert.equal(findLesson(COURSE_REPLY.modules, 'l3').next, null);
  // The stored positions decide the order, not the order the rows arrive in.
  const shuffled = [...COURSE_REPLY.modules].reverse().map((m) => ({ ...m, lessons: [...m.lessons].reverse() }));
  assert.deepEqual([findLesson(shuffled, 'l2').prev.uid, findLesson(shuffled, 'l2').next.uid, findLesson(shuffled, 'l2').index], ['l1', 'l3', 1]);
});

test('a standalone video or reading at /learning/videos/:uid and /learning/items/:uid', () => {
  const video = html(h(ItemView, { state: { status: 'ready', ...readItemShape(ITEM_VIDEO) }, onMark: () => {} }));
  assert.match(video, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.doesNotMatch(video, /link-lesson-next|link-lesson-prev/, 'a standalone item has no course to step through');
  assert.doesNotMatch(flat(video), /Previous|Next/, 'not even a disabled step');
  assert.doesNotMatch(tagOf(video, 'button-mark-complete'), /disabled=""/);
  const reading = html(h(ItemView, { state: { status: 'ready', ...readItemShape(ITEM_READING) }, onMark: () => {} }));
  assert.match(reading, /<strong>before<\/strong>/);
  assert.doesNotMatch(reading, /lesson-transcript/);
  assert.match(text(h(ItemView, { state: { status: 'missing' } })), /No such video or reading/);
  assert.match(html(h(ItemView, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(html(h(ItemView, { state: { status: 'unreadable' }, onRetry: () => {} })), /learning-unreadable/);
  // Both addresses are routes, and the catalog's own href resolves.
  const declared = [...readRoutesSource().matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
  const best = (url) => matchRoutes(declared.map((path) => ({ path })), url)?.at(-1)?.route.path;
  assert.equal(best('/learning/videos/v-cap'), '/learning/videos/:uid');
  assert.equal(best('/learning/items/r-terms'), '/learning/items/:uid');
  for (const row of CATALOG_ALL.items) assert.notEqual(best(row.href), undefined, `the catalog's href ${row.href} lands on the 404`);
});

test('My learning from GET /me: courses with their links, videos watched, exercises and exams still not recorded', () => {
  const state = {
    status: 'ready',
    in_progress: ME_REPLY.in_progress.map((r) => ({ ...r, href: r.course_slug ? `/learning/courses/${r.course_slug}` : null })),
    completed: ME_REPLY.completed.map((r) => ({ ...r, href: r.subject_kind === 'item' ? `/learning/videos/${r.subject_uid}` : `/learning/courses/${r.course_slug}` })),
  };
  const markup = html(h(MeView, { state }));
  const out = flat(markup);
  assert.match(out, /Courses in progress 1 Seed basics 50%/);
  assert.match(out, /Completed 1 Orientation 3 Oct 2026/);
  assert.match(out, /Videos watched 1 What a seed round is 4 Oct 2026/);
  assert.match(markup, /href="\/learning\/videos\/v-yt"/);
  const exercises = markup.slice(markup.indexOf('data-testid="my-exercises"'), markup.indexOf('data-testid="my-exams"'));
  assert.match(exercises, /learning-not-live/);
  assert.match(html(h(MeView, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(html(h(MeView, { state: { status: 'unreadable' }, onRetry: () => {} })), /learning-unreadable/);
  assert.match(html(h(MeView, { state: { status: 'ready', in_progress: [], completed: [] } })), /learning-empty/);
});

// ── The studio ─────────────────────────────────────────────────────────────

test('the studio: the table from both lists, a failed list named, each row opening its editor', () => {
  const rows = studioRows(STUDIO_ITEMS, STUDIO_COURSES);
  assert.deepEqual(rows.map((r) => [r.kind, r.uid, r.href]), [
    ['video', 'v-yt', '/learning/studio?item=v-yt'],
    ['course', 'c1', '/learning/studio?course=c1'],
    ['reading', 'r-terms', '/learning/studio?item=r-terms'],
    ['video', 'v-old', '/learning/studio?item=v-old'],
  ]);
  assert.ok(rows.every((r) => r.programs === null), 'programs read as "None" before #1159 exists');
  const markup = html(h(StudioView, { items: { status: 'ready', rows: STUDIO_ITEMS }, courses: { status: 'ready', rows: STUDIO_COURSES } }), '/learning/studio');
  assert.match(tagOf(markup, 'link-studio-open-c1'), /href="\/learning\/studio\?course=c1"/);
  assert.match(flat(markup), /Course Seed basics Draft Open Not recorded 4 Oct 2026/);
  assert.match(flat(markup), /Reading Term sheet glossary Draft Program Not recorded 3 Oct 2026/);
  const oneFailed = flat(html(h(StudioView, { items: { status: 'unreadable' }, courses: { status: 'ready', rows: STUDIO_COURSES }, onRetryItems: () => {} }), '/learning/studio'));
  assert.match(oneFailed, /The item list could not be read\. This is not a claim that there are no videos or readings\./);
  assert.match(oneFailed, /Seed basics/);
  const bothFailed = html(h(StudioView, { items: { status: 'unreadable' }, courses: { status: 'unreadable' } }), '/learning/studio');
  assert.equal(count(bothFailed, 'data-testid="learning-unreadable"'), 1, 'two failures are one unreadable table');
  assert.match(html(h(StudioView, { items: { status: 'loading' }, courses: { status: 'ready', rows: [] } }), '/learning/studio'), /learning-loading/);
  assert.match(html(h(StudioView, { items: { status: 'ready', rows: [] }, courses: { status: 'ready', rows: [] } }), '/learning/studio'), /learning-empty/);
  // An open editor is the page, with the way back.
  const open = html(h(StudioView, { items: { status: 'ready', rows: [] }, courses: { status: 'ready', rows: [] }, editor: h('div', { 'data-testid': 'an-editor' }) }), '/learning/studio');
  assert.match(open, /data-testid="link-studio-all"/);
  assert.doesNotMatch(open, /studio-content/);
});

test('the item editor: a link not an upload, the fields the route takes, the status actions by status', () => {
  const fresh = html(h(StudioItemEditor, { item: null, kind: 'video', onSave: () => {}, onStatus: () => {} }));
  assert.match(tagOf(fresh, 'input-item-upload'), /disabled=""/);
  assert.match(flat(fresh), /Uploading a video file is not live yet\. Paste a link instead\./);
  assert.match(fresh, /data-testid="input-item-video-url"/);
  assert.doesNotMatch(fresh, /input-item-body|studio-status-actions/);
  assert.match(flat(fresh), /Create draft/);
  const reading = html(h(StudioItemEditor, { item: null, kind: 'reading', onSave: () => {}, onStatus: () => {} }));
  assert.match(reading, /data-testid="input-item-body"/);
  assert.doesNotMatch(reading, /input-item-video-url|input-item-upload/);
  // A stored item: its fields, the length as m:ss, and the actions its status allows.
  const published = html(h(StudioItemEditor, { item: STUDIO_ITEMS[0], kind: 'video', onSave: () => {}, onStatus: () => {} }));
  assert.match(tagOf(published, 'input-item-title'), /value="What a seed round is"/);
  assert.match(tagOf(published, 'input-item-length'), /value="12:05"/);
  assert.doesNotMatch(published, /button-studio-publish/);
  assert.match(published, /button-studio-unpublish/);
  assert.match(published, /button-studio-archive/);
  const draft = html(h(StudioItemEditor, { item: STUDIO_ITEMS[1], kind: 'reading', onSave: () => {}, onStatus: () => {} }));
  assert.match(draft, /button-studio-publish/);
  assert.doesNotMatch(draft, /button-studio-unpublish/);
  const archived = html(h(StudioItemEditor, { item: STUDIO_ITEMS[2], kind: 'video', onSave: () => {}, onStatus: () => {} }));
  assert.match(archived, /button-studio-publish/);
  assert.doesNotMatch(archived, /button-studio-archive/);
  assert.deepEqual([parseLength('12'), parseLength('12:05'), parseLength(''), parseLength('12:60'), parseLength('soon')], [720, 725, null, undefined, undefined]);
  assert.deepEqual([formatLength(725), formatLength(null), formatLength(60)], ['12:05', '', '1:00']);
  assert.deepEqual(itemBody({ title: 't', length: '1:00', level: '', visibility: '' }, 'reading').visibility, 'open', 'visibility is never sent as null');
  assert.throws(() => itemBody({ length: '1:2' }, 'video'), /Length is minutes/);
});

test('the course builder: fields and resources, modules and lessons in order, up and down disabled at the ends, exercise and exam held', () => {
  const markup = html(h(StudioCourseBuilder, { course: TREE, items: STUDIO_ITEMS, handlers: {} }));
  const out = flat(markup);
  assert.match(tagOf(markup, 'input-course-slug'), /value="seed-basics"/);
  assert.match(markup, /value="Term sheet template"/);
  assert.ok(out.indexOf('Module 1 · Foundations') < out.indexOf('Module 2 · Pricing'));
  assert.match(out, /Video What a seed round is opens “What a seed round is”/);
  assert.match(out, /Webinar Founder office hours opens the event “founder-office-hours” Optional/);
  assert.match(out, /No lesson in this module yet\./);
  // Up on the first module and down on the last are disabled; the others are not.
  const ups = [...markup.matchAll(/<button[^>]*aria-label="Move module up"[^>]*>/g)].map((m) => m[0]);
  const downs = [...markup.matchAll(/<button[^>]*aria-label="Move module down"[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual([ups.map((b) => b.includes('disabled=""')), downs.map((b) => b.includes('disabled=""'))], [[true, false], [false, true]]);
  const lessonUps = [...markup.matchAll(/<button[^>]*aria-label="Move lesson up"[^>]*>/g)].map((m) => m[0].includes('disabled=""'));
  assert.deepEqual(lessonUps, [true, false]);
  assert.deepEqual(moveInOrder(['m1', 'm2', 'm3'], 'm2', 1), ['m1', 'm3', 'm2']);
  assert.equal(moveInOrder(['m1', 'm2'], 'm1', -1), null);
  // A new course: only its fields, no modules until it exists.
  const fresh = html(h(StudioCourseBuilder, { course: null, items: [], handlers: {} }));
  assert.doesNotMatch(fresh, /studio-modules|studio-status-actions/);
  assert.match(flat(fresh), /Create draft/);
  // The lesson form: exercise and exam drawn disabled, a video lesson choosing among videos, archived ones left out.
  const form = html(h(LessonForm, { items: STUDIO_ITEMS, onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Add lesson' }));
  assert.match(form, /<option value="exercise" disabled="">Exercise \(not built yet\)<\/option>/);
  assert.match(form, /<option value="exam" disabled="">Exam \(not built yet\)<\/option>/);
  assert.match(form, /<option value="v-yt">What a seed round is<\/option>/);
  assert.doesNotMatch(form, /value="v-old"|value="r-terms"/);
  assert.equal(refLabel({ kind: 'reading', ref_uid: 'gone' }, STUDIO_ITEMS), 'item gone');
  assert.deepEqual(courseBody({ title: 't', slug: 's', resources: [{ title: '', url: '' }] }).resources, []);
});

test('archiving asks first, and only the confirmation archives', () => {
  const actions = html(h(StatusActions, { status: 'published', what: 'video', onStatus: () => {} }));
  assert.doesNotMatch(actions, /studio-confirm-archive/, 'the confirmation shows before anyone asked');
  const src = codeOnly(read('frontend/src/pages/learning/studioParts.jsx'));
  // The Archive button opens the confirmation; only the confirmation calls the route.
  assert.match(src, /onClick=\{\(\) => setConfirming\(true\)\} disabled=\{busy\} data-testid="button-studio-archive"/);
  assert.match(src, /onConfirm=\{\(\) => \{ setConfirming\(false\); onStatus\('archive'\); \}\}/);
  assert.equal(count(src, "onStatus('archive')"), 1, 'something else archives without asking');
  const row = flat(html(h(ConfirmRow, { text: 'Archive this video? Members lose it at once; it stays here, and can be published again.', action: 'Archive', onConfirm: () => {}, onCancel: () => {} })));
  assert.match(row, /Archive this video\? Members lose it at once; it stays here, and can be published again\. Archive Cancel/);
});

test('a screen never draws another read\'s reply, and the studio\'s words stay with their editor', () => {
  // A tab switch renders once before its read starts: All's rows are "loading" under Courses.
  const all = allState();
  assert.deepEqual(catalogFor(all, 'course'), { status: 'loading' });
  assert.equal(catalogFor(all, null), all);
  const courses = { status: 'ready', rows: [], sources: {}, offset: 0, kind: 'course' };
  assert.deepEqual(catalogFor(courses, 'video'), { status: 'loading' });
  assert.equal(catalogFor(courses, 'course'), courses);
  assert.deepEqual(catalogFor({ status: 'unreadable' }, 'course'), { status: 'unreadable' });
  // The next lesson: the last lesson's item is "loading" until this one's arrives.
  const video = { status: 'ready', ...readItemShape(ITEM_VIDEO) };
  assert.deepEqual(itemFor(video, 'r-terms'), { status: 'loading' });
  assert.equal(itemFor(video, 'v-yt'), video);
  assert.deepEqual(itemFor({ status: 'missing' }, 'r-terms'), { status: 'missing' });
  // Another course or item is another page: each wired view is keyed by what it reads.
  const pageSrc = codeOnly(read('frontend/src/pages/learning/LearningPage.jsx'));
  assert.match(pageSrc, /<CoursePage key=\{params\.slug\} slug=\{params\.slug\} \/>/);
  assert.match(pageSrc, /<ItemPage key=\{params\.uid\} uid=\{params\.uid\} \/>/);
  // The studio: a refusal made in one editor is not shown in another.
  assert.equal(targetOf('item', 'v-yt'), 'item:v-yt');
  assert.equal(targetOf('', null), '');
  const said = { error: { where: 'item', message: 'A video needs its link before it is published.' }, at: 'item:v-new' };
  assert.deepEqual(sayingAt(said, 'item:v-new'), { error: said.error, notice: '' });
  assert.deepEqual(sayingAt(said, 'item:v-yt'), { error: null, notice: '' });
  assert.deepEqual(sayingAt({ notice: 'Draft created.', at: 'course:c9' }, 'course:c9'), { error: null, notice: 'Draft created.' });
  assert.deepEqual(sayingAt(null, ''), { error: null, notice: '' });
});

// ── The gate ───────────────────────────────────────────────────────────────

test('the gate still holds: a gated profile reads nothing from Learning and keeps Articles', () => {
  for (const role of ['founder', 'investor', 'partner', 'advisor']) {
    for (const [url, pattern, view] of [
      ['/learning/videos/v-yt', '/learning/videos/:uid', 'item'],
      ['/learning/items/r-terms', '/learning/items/:uid', 'item'],
      ['/learning/courses/seed-basics', '/learning/courses/:slug', 'course'],
      ['/learning/me', '/learning/me', 'me'],
    ]) {
      const markup = page(url, pattern, { view, user: { role }, activeRole: role });
      assert.match(markup, /data-testid="learning-coming-soon"/, `${role} at ${url}`);
      assert.doesNotMatch(markup, /learning-loading|lesson-player|course-outline/, `${role} at ${url} starts a Learning read`);
    }
    // The home: Articles open; All, Courses and Videos closed, and Continue learning not asked for.
    for (const tab of ['all', 'courses', 'videos']) {
      const home = page(`/learning?tab=${tab}`, '/learning', { view: 'home', user: { role }, activeRole: role });
      assert.match(tagOf(home, `panel-${tab}`), /data-mode="coming_soon"/);
      assert.doesNotMatch(home, /learning-loading|section-continue|list-catalog/);
    }
    const articles = page('/learning', '/learning', { view: 'home', user: { role }, activeRole: role });
    assert.match(tagOf(articles, 'panel-articles'), /data-mode="live"/);
  }
  // The reads themselves are asked for only when the gate lets the profile see them
  // (a server render makes none, so the switches are read from the source).
  const homeSrc = codeOnly(read('frontend/src/pages/learning/LearningHome.jsx'));
  assert.match(homeSrc, /const live = tabMode\(tab, gated\) === 'live';/);
  assert.match(homeSrc, /\{ enabled: live && \(tab === 'all' \|\| Boolean\(kind\)\), scope: 'catalog' \}/);
  assert.match(homeSrc, /useLearningRead\(readMe, \[\], \{ enabled: !gated, scope: 'me' \}\)/);
  assert.match(codeOnly(read('frontend/src/pages/learning/LearningPage.jsx')), /if \(!gated && Wired\) return <Wired/);
  // The studio stays the Super Admin's: an admin is admitted by the route's guard and the page is the studio.
  const route = readRoutesSource();
  assert.ok(route.includes(`<Route path="/learning/studio" element={guard(['admin'], hqOnly(<LearningPage view="studio"`));
  const studio = page('/learning/studio', '/learning/studio', { view: 'studio', user: { role: 'admin', is_super_admin: 1 }, activeRole: 'admin' });
  assert.match(studio, /data-testid="learning-studio"/);
  assert.match(studio, /data-testid="studio-new"/);
});
