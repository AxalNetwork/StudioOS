/**
 * D562 stage 3 (#1163) — the four stage-3 parts mounted in the Learning
 * screens, and the two upload fixes the video part asked for.
 *
 * What this pins:
 *   - every Learning view is wired: the program, exercise, exam and webinar
 *     routes render their own pages, each reading its store, and the gate
 *     still holds before any of them mounts;
 *   - the studio opens the exercise and exam editors and the webinar
 *     scheduler from its address, merges exercises and exams into its content
 *     table (a failed list on its own line), lists webinars under it, and
 *     hands the course builder both lists;
 *   - an upload hands the stored item back to the studio's list;
 *   - a video part's deadline follows its size, and Cancel stops the part on
 *     its way rather than waiting for it.
 *
 * Each part's own screens are pinned in its own file: learning_programs_d558_ui,
 * learning_assessments_d559, learning_webinars_d560_ui and learning_video_d561_ui.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_stage3_d562.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import { LONG_TIMEOUT_MS } from '../src/lib/api.js';
import { adminLearningApi } from '../src/lib/api/adminLearning.js';
import LearningPage from '../src/pages/learning/LearningPage.jsx';
import { StudioView } from '../src/pages/learning/LearningStudio.jsx';
import { uploadVideo } from '../src/pages/learning/studioActions.js';
import { runVideoUpload, stopUpload, uploadToken } from '../src/pages/learning/StudioItemEditor.jsx';
import { UPLOAD_CANCELLED } from '../src/pages/learning/videoUpload.js';

process.env.TZ = 'UTC';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
// `&amp;` is decoded last, so an escaped entity is never decoded twice.
const flat = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const html = (el, path = '/learning/studio') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
function tagOf(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
}
/** A Learning route rendered the way the router renders it, params and all. */
const page = (url, pattern, props) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: pattern, element: h(LearningPage, props) }))),
);
const ADMIN = { role: 'admin', is_super_admin: 0 };
const SUPER = { role: 'admin', is_super_admin: 1 };
const STALE = /(Webinars|Exercises|Exams|Regional programs) are not live yet\./;

// ── Every view is wired ───────────────────────────────────────────────────

test('every view is wired: programs, exercises, exams and webinars render their own pages, each reading its store', () => {
  for (const [url, pattern, view, user, frame] of [
    ['/learning/programs', '/learning/programs', 'programs', ADMIN, 'learning-programs'],
    ['/learning/programs/p1', '/learning/programs/:program', 'program', ADMIN, 'learning-program'],
    ['/learning/studio/programs', '/learning/studio/programs', 'studioPrograms', SUPER, 'learning-studio-programs'],
    ['/learning/studio/programs/p1', '/learning/studio/programs/:program', 'studioProgram', SUPER, 'learning-studio-program'],
    ['/learning/exercises/e1', '/learning/exercises/:slug', 'exercise', ADMIN, 'learning-exercise'],
    ['/learning/exams/x1', '/learning/exams/:slug', 'exam', ADMIN, 'learning-exam'],
    ['/learning/webinars/w1', '/learning/webinars/:slug', 'webinar', ADMIN, 'learning-webinar'],
  ]) {
    const markup = page(url, pattern, { view, user, activeRole: 'admin' });
    assert.ok(markup.includes(`data-testid="${frame}"`), `${url} does not render its own page`);
    assert.match(markup, /data-testid="learning-loading"/, `${url} does not read its store`);
    assert.doesNotMatch(flat(markup), STALE, `${url} still says its store is not live`);
    assert.doesNotMatch(markup, /learning-coming-soon/);
  }
  // The held-write button the program list drew before D558 is gone with its view.
  assert.doesNotMatch(page('/learning/studio/programs', '/learning/studio/programs', { view: 'studioPrograms', user: SUPER, activeRole: 'admin' }), /cursor-not-allowed[^>]*button-program-new|button-program-new[^>]*disabled/);
  // The gate still comes first: an admin browsing as a founder sees the card on an admin route, and nothing reads.
  const viewAs = page('/learning/studio/programs/p1', '/learning/studio/programs/:program', { view: 'studioProgram', user: SUPER, activeRole: 'founder' });
  assert.match(viewAs, /data-testid="learning-coming-soon"/);
  assert.doesNotMatch(viewAs, /learning-loading|learning-studio-program"/);
  assert.match(flat(viewAs), /Worker AI · Learning studio/, 'the card keeps the tier’s rail');
  // Each wired page is keyed by the uid it reads, so another one starts from loading.
  const src = codeOnly(read('frontend/src/pages/learning/LearningPage.jsx'));
  for (const line of [
    /webinar: \(\{ params \}\) => <WebinarPage key=\{params\.slug\} uid=\{params\.slug\} \/>/,
    /exercise: \(\{ params \}\) => <ExercisePage key=\{params\.slug\} uid=\{params\.slug\} \/>/,
    /exam: \(\{ params \}\) => <ExamPage key=\{params\.slug\} uid=\{params\.slug\} \/>/,
    /program: \(\{ params, config \}\) => <ProgramPage key=\{params\.program\} uid=\{params\.program\} sub=\{config\.sub\} \/>/,
    /studioProgram: \(\{ params, config \}\) => <StudioProgramPage key=\{params\.program\} uid=\{params\.program\} sub=\{config\.sub\} \/>/,
  ]) assert.match(src, line);
  // Nothing on the page waits on a store any more.
  assert.doesNotMatch(src, /ViewBody|WaitingAction|HEADER_ACTION|NOT_LIVE/);
});

test('the home reads My programs and the upcoming webinars only for a profile the gate admits, and the past ones only on their tab', () => {
  // A server render makes no read, so the switches are read from the source, as stage 2's are.
  const src = codeOnly(read('frontend/src/pages/learning/LearningHome.jsx'));
  assert.match(src, /useLearningRead\(\(\) => readWebinars\('upcoming'\), \[\], \{ enabled: !gated, scope: 'webinars-upcoming' \}\)/);
  assert.match(src, /useLearningRead\(\(\) => readWebinars\('past'\), \[\],\s*\{ enabled: live && tab === 'webinars', scope: 'webinars-past' \}\)/);
  assert.match(src, /const programs = useMyPrograms\(!gated\);/);
  // One upcoming read feeds both the section and the tab: the drop-ins that read on their own are not mounted.
  assert.doesNotMatch(src, /<WebinarsTab[\s/>]|<UpcomingWebinars[\s/>]|<MyPrograms[\s/>]/);
  // And a gated profile's home draws none of the three.
  const gated = page('/learning', '/learning', { view: 'home', user: { role: 'founder' }, activeRole: 'founder' });
  assert.doesNotMatch(gated, /section-programs|section-webinars|webinars-tab/);
});

// ── The studio ────────────────────────────────────────────────────────────

const studio = (search) => page(`/learning/studio${search}`, '/learning/studio', { view: 'studio', user: SUPER, activeRole: 'admin' });

test('the studio opens the exercise and exam editors and the webinar scheduler from its address', () => {
  const table = studio('');
  assert.match(table, /data-testid="studio-content"/);
  assert.match(table, /data-testid="studio-webinars"/, 'the webinar list is not under the table');
  const news = table.slice(table.indexOf('data-testid="studio-new"'));
  const order = [...news.slice(0, news.indexOf('</span>')).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['video', 'reading', 'exercise', 'exam', 'webinar', 'course'].map((k) => `/learning/studio?new=${k}`));
  for (const [search, mark, absent] of [
    ['?new=exercise', 'form-studio-exercise', null],
    ['?new=exam', 'form-studio-exam', null],
    ['?new=webinar', 'form-studio-webinar', null],
    ['?exercise=e1', null, 'Reading the exercise…'],
    ['?exam=x1', null, 'Reading the exam…'],
    ['?webinar=w1', null, 'Reading the webinar…'],
  ]) {
    const markup = studio(search);
    assert.match(markup, /data-testid="link-studio-all"/, `${search} does not open an editor`);
    assert.doesNotMatch(markup, /data-testid="studio-content"|data-testid="studio-webinars"/, `${search} still draws the table`);
    if (mark) assert.ok(markup.includes(`data-testid="${mark}"`), `${search} does not draw ${mark}`);
    if (absent) assert.ok(flat(markup).includes(absent), `${search} does not read what it opens`);
  }
  // A video or reading, and a course, open as before.
  assert.match(studio('?new=video'), /data-testid="studio-item-editor"/);
  assert.match(studio('?new=course'), /data-testid="form-studio-course"|data-testid="studio-course-builder"/);
});

const ITEM = { uid: 'i1', kind: 'video', title: 'Cap tables', status: 'published', visibility: 'open', updated_at: '2026-10-03T10:00:00.000Z' };
const COURSE = { uid: 'c1', slug: 'seed-basics', title: 'Seed basics', status: 'draft', visibility: 'open', updated_at: '2026-10-01T10:00:00.000Z' };
const EXERCISE = { uid: 'e1', title: 'Write your one-liner', status: 'draft', visibility: 'program', updated_at: '2026-10-05T10:00:00.000Z' };
const EXAM = { uid: 'x1', title: 'Seed round check', status: 'published', visibility: 'open', updated_at: '2026-10-02T10:00:00.000Z' };
const ok = (rows) => ({ status: 'ready', rows });

test('the content table merges exercises and exams, newest edit first, and a failed list says so on its own line', () => {
  const markup = html(h(StudioView, { items: ok([ITEM]), courses: ok([COURSE]), exercises: ok([EXERCISE]), exams: ok([EXAM]) }));
  const opened = [...markup.matchAll(/data-testid="link-studio-open-([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(opened, ['e1', 'i1', 'x1', 'c1']);
  assert.match(tagOf(markup, 'link-studio-open-e1'), /href="\/learning\/studio\?exercise=e1"/);
  assert.match(tagOf(markup, 'link-studio-open-x1'), /href="\/learning\/studio\?exam=x1"/);
  // The programs column says why it is not recorded, and no longer that programs are not live.
  assert.ok(flat(markup).includes('Not recorded'));
  assert.match(markup, /title="The content list does not say which programs hold this\. Each program&#x27;s page lists what it holds\."/);
  assert.doesNotMatch(flat(markup), STALE);
  // One list failed: it is named, and every other row is still drawn.
  const oneFailed = html(h(StudioView, { items: ok([ITEM]), courses: ok([COURSE]), exercises: { status: 'unreadable' }, exams: ok([EXAM]), onRetryExercises: () => {} }));
  assert.ok(flat(oneFailed).includes('This is not a claim that there are no exercises.'));
  assert.doesNotMatch(flat(oneFailed), /there are no exams\.|there are no courses\./);
  assert.deepEqual([...oneFailed.matchAll(/data-testid="link-studio-open-([^"]+)"/g)].map((m) => m[1]), ['i1', 'x1', 'c1']);
  // Every list failed: one unreadable table, not four lines.
  const allFailed = flat(html(h(StudioView, { items: { status: 'unreadable' }, courses: { status: 'unreadable' }, exercises: { status: 'unreadable' }, exams: { status: 'unreadable' } })));
  assert.doesNotMatch(allFailed, /This is not a claim that there are no exercises\./);
  assert.match(allFailed, /The content list could not be read\. This is not a claim that nothing has been authored\./);
  // Any list still reading holds the table at loading.
  assert.match(html(h(StudioView, { items: ok([]), courses: ok([]), exercises: ok([]), exams: { status: 'loading' } })), /data-testid="learning-loading"/);
  // A caller with no exercise or exam list keeps stage 2's table.
  assert.deepEqual([...html(h(StudioView, { items: ok([ITEM]), courses: ok([COURSE]) })).matchAll(/data-testid="link-studio-open-([^"]+)"/g)].map((m) => m[1]), ['i1', 'c1']);
});

test('the studio hands the course builder both lists, and an upload hands its stored row back to the list', () => {
  const src = codeOnly(read('frontend/src/pages/learning/LearningStudio.jsx'));
  assert.match(src, /const choices = \{ exercises: rowsOf\(assessments\.exercises\), exams: rowsOf\(assessments\.exams\) \};/);
  assert.equal((src.match(/<StudioCourseBuilder [^>]*\{\.\.\.choices\}/g) || []).length, 2, 'a course builder mount is not handed the lists');
  // Without this the list keeps the item as it was before the upload: reopening it draws the
  // old link, and a save would put that link back over the uploaded file.
  assert.match(src, /onUploaded: \(stored\) => upsert\(setItems, stored\),/);
  // The webinar scheduler is not keyed, so "Draft created." survives the move to `?webinar=<uid>`.
  assert.match(src, /<WebinarStudio uid=\{creating === 'webinar' \? null : webinarUid\} items=\{items\} onRetryItems=\{retryItems\} \/>/);
  // Each exercise and exam editor is keyed by what it opens.
  assert.match(src, /<StudioAssessment key=\{`\$\{kind\}:\$\{uid\}`\} kind=\{kind\} uid=\{uid\} onStored=\{assessments\.upsert\} \/>/);
});

// ── The upload: a part's deadline, and Cancel ─────────────────────────────

const REF = { key: 'learning/videos/v1/abc.mp4', upload_id: 'up-1', part_number: 1 };

/** A fetch that never answers, recording each call's init, and that rejects as a browser does on abort. */
function hangingFetch() {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const seen = [];
  const orig = globalThis.fetch;
  const aborted = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  globalThis.fetch = (url, init = {}) => new Promise((_, reject) => {
    seen.push({ url: String(url), init });
    // As a browser's fetch does: a signal already aborted rejects at once.
    if (init.signal?.aborted) { reject(aborted()); return; }
    init.signal?.addEventListener('abort', () => reject(aborted()));
  });
  // A timeout is also reported (`reportError`'s beacon goes through fetch), so the parts are read by path.
  const parts = () => seen.filter((s) => s.url.includes('/video/uploads/part'));
  return { seen, parts, restore: () => { globalThis.fetch = orig; } };
}

test('a video part waits as long as its size needs at 1 Mbit/s, never less than the long deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const net = hangingFetch();
  try {
    // A small part: the long deadline, 180 s, not the 30 s default.
    const small = adminLearningApi.uploadVideoPart('v1', REF, new Blob([new Uint8Array(10)]));
    small.catch(() => {});
    await Promise.resolve();
    t.mock.timers.tick(LONG_TIMEOUT_MS - 1);
    assert.equal(net.parts()[0].init.signal.aborted, false, 'a small part was cut off before the long deadline');
    t.mock.timers.tick(1);
    assert.equal(net.parts()[0].init.signal.aborted, true);
    await assert.rejects(small, /did not respond within 180s\. Whether this was saved is not known/);
    // The largest part the route sends, 95 MiB: what 1 Mbit/s needs, 797 s.
    const big = adminLearningApi.uploadVideoPart('v1', { ...REF, part_number: 2 }, { size: 95 * 1024 * 1024 });
    big.catch(() => {});
    await Promise.resolve();
    t.mock.timers.tick(796_999);
    assert.equal(net.parts()[1].init.signal.aborted, false, 'a 95 MiB part was cut off before 1 Mbit/s could send it');
    t.mock.timers.tick(1);
    await assert.rejects(big, /did not respond within 797s/);
    // A size that is not a number gets the long deadline, never none and never zero.
    const odd = adminLearningApi.uploadVideoPart('v1', { ...REF, part_number: 3 }, { size: Number.NaN });
    odd.catch(() => {});
    await Promise.resolve();
    t.mock.timers.tick(LONG_TIMEOUT_MS - 1);
    assert.equal(net.parts()[2].init.signal.aborted, false);
    t.mock.timers.tick(1);
    await assert.rejects(odd, /within 180s/);
    // A caller's own deadline still wins.
    const own = adminLearningApi.uploadVideoPart('v1', { ...REF, part_number: 4 }, new Blob([new Uint8Array(10)]), { timeoutMs: 5000 });
    own.catch(() => {});
    await Promise.resolve();
    t.mock.timers.tick(5000);
    await assert.rejects(own, /within 5s/);
  } finally {
    net.restore();
  }
});

test('Cancel stops the part on its way: the fetch is aborted, the upload closed, and it reads as cancelled', async () => {
  const net = hangingFetch();
  const answered = [];
  const orig = globalThis.fetch;
  // The start and the abort answer; a part hangs until it is aborted.
  globalThis.fetch = (url, init = {}) => {
    const path = String(url).replace(/^.*?\/api/, '');
    answered.push(`${init.method || 'GET'} ${path.split('?')[0]}`);
    if (path.endsWith('/video/uploads')) {
      return Promise.resolve(new Response(JSON.stringify({ key: REF.key, upload_id: REF.upload_id, part_size: 100, parts: 3 }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    }
    if (path.endsWith('/video/uploads/abort')) return Promise.resolve(new Response('{"aborted":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return orig(url, init);
  };
  try {
    const token = uploadToken();
    const file = new File([new Uint8Array(250)], 'clip.mp4', { type: 'video/mp4' });
    const run = uploadVideo({ uid: 'v1', file, isCancelled: () => token.cancelled, signal: token.controller.signal });
    // Wait until part 1 is on its way, then press Cancel.
    for (let i = 0; i < 50 && !net.parts().length; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(net.parts().length, 1, 'part 1 never left');
    stopUpload(token);
    assert.equal(net.parts()[0].init.signal.aborted, true, 'Cancel did not stop the part on its way');
    await assert.rejects(run, (err) => err.code === UPLOAD_CANCELLED && /cancelled, so nothing was attached/.test(err.message));
    assert.deepEqual(answered, [
      'POST /admin/learning/items/v1/video/uploads',
      'PUT /admin/learning/items/v1/video/uploads/part',
      'POST /admin/learning/items/v1/video/uploads/abort',
    ]);
    // Stopping twice, or with no upload running, changes nothing.
    stopUpload(token);
    stopUpload(null);
    assert.equal(token.cancelled, true);
    // A caller's signal alone stops it too, with no flag to ask: aborted before a part is sent,
    // nothing is sent but the start and the abort, and it reads as the cancel it was.
    answered.length = 0;
    const early = new AbortController();
    early.abort();
    await assert.rejects(uploadVideo({ uid: 'v1', file, signal: early.signal }), (err) => err.code === UPLOAD_CANCELLED);
    assert.deepEqual(answered, ['POST /admin/learning/items/v1/video/uploads', 'POST /admin/learning/items/v1/video/uploads/abort']);
    // Aborted while a part is on its way: the fetch's own abort is reported as the cancel, not as an error.
    const late = new AbortController();
    const lateRun = uploadVideo({ uid: 'v1', file, signal: late.signal });
    const sentBefore = net.parts().length;
    for (let i = 0; i < 50 && net.parts().length === sentBefore; i += 1) await new Promise((r) => setImmediate(r));
    late.abort();
    await assert.rejects(lateRun, (err) => err.code === UPLOAD_CANCELLED && !/abort/i.test(err.name));
    // The editor's own run hands its token's signal to the upload: its Cancel stops the part too.
    const editorToken = uploadToken();
    const states = [];
    const setUpload = (next) => states.push(typeof next === 'function' ? next(states.at(-1) || {}) : next);
    const editorRun = runVideoUpload({
      uid: 'v1', file, token: editorToken, latestItem: () => null, setUpload, setUploaded: () => {}, setForm: () => {},
    });
    const editorBefore = net.parts().length;
    for (let i = 0; i < 50 && net.parts().length === editorBefore; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(net.parts().length, editorBefore + 1, 'the editor\'s part never left');
    stopUpload(editorToken);
    assert.equal(net.parts().at(-1).init.signal.aborted, true, 'the editor\'s Cancel did not stop the part on its way');
    await editorRun;
    assert.equal(states.at(-1).phase, 'cancelled');
  } finally {
    net.restore();
  }
});
