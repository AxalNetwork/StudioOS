/**
 * D561 in the Learning screens (D562 stage 3, video): the Super Admin's
 * upload of a video file in the studio, and a member's playback of it.
 *
 * The upload runs through the real client against a stubbed `fetch` whose
 * replies are in the shapes `routes/learning_video.ts` sends, so every
 * method, path, query and body is the one the page would send. The limits
 * and the sentences are read from the route and its service, so the page's
 * refusals cannot drift from the route's. The editor's state sequence is
 * driven through `runVideoUpload`, the function its "Upload" button calls,
 * and each state is drawn through `VideoFileField`. Playback is drawn through
 * the item and lesson views with the item read's own shape, which sends
 * `video_stream_url` and never the bucket key.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_video_d561_ui.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import { itemStreamPath, videoPlayback } from '../src/pages/learning/learningModel.js';
import { itemBody, itemForm, setItemStatus, uploadVideo } from '../src/pages/learning/studioActions.js';
import {
  IDLE_UPLOAD, UPLOAD_CANCELLED, VIDEO_ACCEPT, VIDEO_LIMITS_LINE, VIDEO_UPLOAD, chooseVideoFile, formAfterUpload,
  formatBytes, shownItem, storedAfterUpload, uploadFailure, uploadPercent, videoFileProblem,
} from '../src/pages/learning/videoUpload.js';
import StudioItemEditor, {
  UPLOAD_NEEDS_DRAFT, VideoFileField, cancelling, runVideoUpload,
} from '../src/pages/learning/StudioItemEditor.jsx';
import { VideoUnreadable } from '../src/pages/learning/LessonPlayer.jsx';
import { ItemView, LessonView } from '../src/pages/learning/LearningWired.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/learning'] }, el));
// `&amp;` is decoded last, so an escaped entity is never decoded twice.
const flat = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
function tagOf(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
}
/** The text an element opens with, up to its first child or its end: a sentence drawn as it came. */
function textOf(markup, id) {
  const tag = tagOf(markup, id);
  if (!tag) return null;
  const at = markup.indexOf(tag) + tag.length;
  return flat(markup.slice(at, markup.indexOf('<', at))).trim();
}
const enc = encodeURIComponent;
const GiB = 1024 * 1024 * 1024;

// ── Fixtures, in the routes' own shapes ────────────────────────────────────

const KEY = 'learning/videos/v-new/0123456789abcdef0123456789abcdef.mp4';
/** `POST …/video/uploads` (201). A 100-byte part, so a 250-byte file goes up in three. */
const START = { key: KEY, upload_id: 'up-1-abc', part_size: 100, parts: 3 };
/** `POST …/video/uploads/complete`: the stored object's real size and type. */
const COMPLETE = { uid: 'v-new', video_source: 'r2', size_bytes: 250, content_type: 'video/mp4' };
const refusal = (code, message) => ({ error: code, message, detail: message });
/** `GET /api/admin/learning/items/:uid`'s item (ITEM_SELECT: no bucket key). */
const LINKED = {
  uid: 'v-new', kind: 'video', title: 'Cap tables in ten minutes', summary: null, body: null, video_source: 'url',
  video_url: 'https://youtu.be/dQw4w9WgXcQ', duration_seconds: 600, thumbnail_url: null, transcript: null, topic: null,
  level: null, visibility: 'open', status: 'draft', created_by: 1, created_at: '2026-10-06T10:00:00.000Z',
  updated_at: '2026-10-06T10:00:00.000Z', published_at: null,
};
const STORED = { ...LINKED, video_source: 'r2', video_url: null, updated_at: '2026-10-06T12:00:00.000Z' };
/** `GET /api/learning/items/:uid`'s item for an uploaded video: the stream path, never the key. */
const MEMBER_R2 = {
  uid: 'v-r2', kind: 'video', title: 'Cap tables in ten minutes', summary: null, body: null, video_source: 'r2',
  video_url: null, duration_seconds: 600, thumbnail_url: null, transcript: 'A cap table lists who owns what.',
  topic: 'Finance', level: 'intro', status: 'published', published_at: '2026-10-06T12:00:00.000Z',
  updated_at: '2026-10-06T12:00:00.000Z', video_stream_url: '/api/learning/items/v-r2/video',
};
const MEMBER_LINK = { ...MEMBER_R2, uid: 'v-link', video_source: 'url', video_url: 'https://vimeo.com/76979871', video_stream_url: null };

/** A 250-byte MP4 whose byte i is i, so each part's slice can be checked. */
const clip = (name = 'cap-tables.mp4', type = 'video/mp4', size = 250) =>
  new File([Uint8Array.from({ length: size }, (_, i) => i % 256)], name, { type });
/** A file of any declared size, for the limits: nothing may read its bytes. */
const declared = (size, type = 'video/mp4', name = 'big.mp4') => ({
  name, type, size, slice: () => { throw new Error('a file outside the limits was read'); },
});

/**
 * The real client against a stubbed fetch: each call recorded (a part's raw
 * bytes and its Content-Type too), each reply taken in turn. `onCall` runs as
 * each request goes, as a click would while a part is on its way.
 */
async function withFetch(replies, run, onCall = () => {}) {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const queue = [...replies];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { method: init.method || 'GET', path: String(url).replace(/^.*?\/api/, ''), type: init.headers?.['Content-Type'] };
    if (init.body instanceof Blob) call.bytes = new Uint8Array(await init.body.arrayBuffer());
    else if (init.body !== undefined) call.body = JSON.parse(init.body);
    calls.push(call);
    onCall(call, calls.length);
    const next = queue.shift() ?? { status: 200, body: {} };
    const reply = next.status ? next : { status: 200, body: next };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = orig; }
  return calls;
}
const lines = (calls) => calls.map((c) => `${c.method} ${c.path}`);
const START_PATH = 'POST /admin/learning/items/v-new/video/uploads';
const partPath = (n) => `PUT /admin/learning/items/v-new/video/uploads/part?key=${enc(KEY)}&upload_id=up-1-abc&part_number=${n}`;
const COMPLETE_PATH = 'POST /admin/learning/items/v-new/video/uploads/complete';
const ABORT_PATH = 'POST /admin/learning/items/v-new/video/uploads/abort';
const PARTS_OK = [{ part_number: 1, etag: 'etag-1' }, { part_number: 2, etag: 'etag-2' }, { part_number: 3, etag: 'etag-3' }];

/** A React state setter's contract (a value or an updater), recording every state it passes through. */
function box(initial) {
  const seen = [];
  let value = initial;
  return { set: (next) => { value = typeof next === 'function' ? next(value) : next; seen.push(value); }, get: () => value, seen };
}

// ── The route's limits and sentences ───────────────────────────────────────

test('the limits are the route\'s own, shown as the route says them, and a file outside them is refused in its words', () => {
  const svc = read('cloudflare-worker/src/services/learningVideo.ts');
  const product = (name) => {
    const m = new RegExp(`export const ${name} = ([\\d\\s*]+);`).exec(svc);
    assert.ok(m, `services/learningVideo.ts no longer declares ${name} as a product of numbers`);
    return m[1].split('*').map(Number).reduce((a, b) => a * b, 1);
  };
  assert.equal(VIDEO_UPLOAD.maxBytes, product('VIDEO_MAX_BYTES'));
  assert.equal(VIDEO_UPLOAD.partMaxBytes, product('VIDEO_PART_MAX_BYTES'));
  const types = svc.slice(svc.indexOf('export const VIDEO_TYPES'), svc.indexOf('};', svc.indexOf('export const VIDEO_TYPES')));
  assert.deepEqual(Object.keys(VIDEO_UPLOAD.types), [...types.matchAll(/'(video\/\w+)':/g)].map((m) => m[1]));
  // What the field shows, and what the file input accepts.
  assert.equal(VIDEO_LIMITS_LINE, 'MP4 or WebM, at most 2 GB.');
  assert.equal(VIDEO_ACCEPT, 'video/mp4,video/webm');
  assert.deepEqual([formatBytes(2 * GiB), formatBytes(95 * 1024 * 1024), formatBytes(250), formatBytes(1.25 * GiB), formatBytes(null)], ['2 GB', '95 MB', '250 bytes', '1.3 GB', null]);
  // The route's two sentences, which the page's own refusals begin with.
  const route = read('cloudflare-worker/src/routes/learning_video.ts');
  for (const sentence of ['A video is video/mp4 or video/webm.', 'A video is at most 2 GB.']) {
    assert.ok(route.includes(`message: '${sentence}'`), `learning_video.ts no longer refuses with "${sentence}"`);
  }
  assert.equal(videoFileProblem(declared(2 * GiB + 1)), 'A video is at most 2 GB. This file is 2.1 GB.', 'one byte over reads as over, never as "2 GB"');
  assert.equal(videoFileProblem(declared(2 * GiB)), null, 'exactly 2 GB is allowed, as the route allows it');
  assert.equal(videoFileProblem(declared(10, 'video/quicktime', 'clip.mov')), 'A video is video/mp4 or video/webm. This file is video/quicktime.');
  assert.equal(videoFileProblem(declared(10, '')), 'A video is video/mp4 or video/webm. The browser did not say what type this file is.');
  assert.equal(videoFileProblem(declared(10, ' VIDEO/WEBM ')), null, 'the route reads the type trimmed and lower-cased');
  assert.equal(videoFileProblem(declared(0)), 'This file is empty.');
});

// ── The upload: start, parts, complete; abort on cancel or failure ─────────

test('an upload starts with the type and size, sends each part_size slice with its number, completes with every etag, then reads the item again', async () => {
  const file = clip();
  const progress = [];
  let done;
  const calls = await withFetch([
    { status: 201, body: START },
    { part_number: 1, etag: 'etag-1' }, { part_number: 2, etag: 'etag-2' }, { part_number: 3, etag: 'etag-3' },
    COMPLETE,
    { item: STORED },
  ], async () => {
    done = await uploadVideo({ uid: 'v-new', file, onProgress: (p) => progress.push(p) });
  });
  assert.deepEqual(lines(calls), [START_PATH, partPath(1), partPath(2), partPath(3), COMPLETE_PATH, 'GET /admin/learning/items/v-new']);
  assert.deepEqual(calls[0].body, { content_type: 'video/mp4', size_bytes: 250 });
  // Each part is its slice of the file, raw, and together they are the file.
  assert.deepEqual(calls.slice(1, 4).map((c) => [c.type, c.bytes.length, c.bytes[0]]), [
    ['application/octet-stream', 100, 0], ['application/octet-stream', 100, 100], ['application/octet-stream', 50, 200],
  ]);
  assert.deepEqual([...calls.slice(1, 4).flatMap((c) => [...c.bytes])], [...new Uint8Array(await file.arrayBuffer())]);
  assert.deepEqual(calls[4].body, { key: KEY, upload_id: 'up-1-abc', parts: PARTS_OK });
  assert.deepEqual(done, { attached: COMPLETE, item: STORED });
  // Progress after the start and each part, then the attach.
  assert.deepEqual(progress.map((p) => [p.step, p.sent, p.part, p.parts, p.total]), [
    ['parts', 0, 0, 3, 250], ['parts', 100, 1, 3, 250], ['parts', 200, 2, 3, 250], ['parts', 250, 3, 3, 250], ['complete', 250, 3, 3, 250],
  ]);
  // The route's own part size: a file under 95 MB goes up whole, in one part.
  const one = await withFetch([{ status: 201, body: { ...START, part_size: VIDEO_UPLOAD.partMaxBytes, parts: 1 } }, { part_number: 1, etag: 'e1' }, COMPLETE, { item: STORED }],
    () => uploadVideo({ uid: 'v-new', file }));
  assert.deepEqual(lines(one), [START_PATH, partPath(1), COMPLETE_PATH, 'GET /admin/learning/items/v-new']);
  assert.equal(one[1].bytes.length, 250);
  // A failed read afterwards does not undo the attach: the completion reply stands.
  let fallback;
  await withFetch([{ status: 201, body: START }, ...PARTS_OK, COMPLETE, { status: 500, body: refusal('server_error', 'The item could not be read.') }], async () => {
    fallback = await uploadVideo({ uid: 'v-new', file });
  });
  assert.deepEqual(fallback, { attached: COMPLETE, item: null });
});

test('a refusal at any step is the route\'s own sentence, and every failure after the start aborts the upload', async () => {
  const file = clip();
  const notOpen = refusal('upload_not_open', 'That upload is not open: it was completed, aborted or never started.');
  // A part refused: the upload is aborted with its key and id, and nothing completes.
  let err;
  const part = await withFetch([{ status: 201, body: START }, PARTS_OK[0], { status: 409, body: notOpen }, { aborted: true }], async () => {
    err = await uploadVideo({ uid: 'v-new', file }).catch((e) => e);
  });
  assert.deepEqual(lines(part), [START_PATH, partPath(1), partPath(2), ABORT_PATH]);
  assert.deepEqual(part[3].body, { key: KEY, upload_id: 'up-1-abc' });
  assert.equal(err.message, notOpen.message);
  assert.equal(err.code, 'upload_not_open');
  // The field shows it as it came, with a way to try again.
  const failed = html(h(VideoFileField, { id: 'f', hasUpload: false, hasLink: true, upload: uploadFailure(err, file) }));
  assert.match(tagOf(failed, 'studio-upload-error'), /role="alert"/);
  assert.equal(textOf(failed, 'studio-upload-error'), notOpen.message);
  assert.match(failed, /data-testid="button-upload-start"[^>]*>Try again</);
  // The completion refused (the stored object was not a video): aborted, in the route's words.
  const removed = refusal('bad_video_type', 'A video is video/mp4 or video/webm. The upload was removed.');
  const complete = await withFetch([{ status: 201, body: START }, ...PARTS_OK, { status: 415, body: removed }, { status: 409, body: notOpen }], async () => {
    err = await uploadVideo({ uid: 'v-new', file }).catch((e) => e);
  });
  assert.deepEqual(lines(complete), [START_PATH, partPath(1), partPath(2), partPath(3), COMPLETE_PATH, ABORT_PATH]);
  assert.equal(err.message, removed.message, 'an abort that fails too never replaces the route\'s sentence');
  // The start refused: nothing was opened, so nothing is aborted.
  const noBucket = refusal('video_storage_unavailable', 'Video storage is not configured on this deployment, so nothing can be uploaded or played.');
  const start = await withFetch([{ status: 503, body: noBucket }], async () => {
    err = await uploadVideo({ uid: 'v-new', file }).catch((e) => e);
  });
  assert.deepEqual(lines(start), [START_PATH]);
  assert.equal(err.message, noBucket.message);
  // A start reply the page cannot read (a part larger than a request may carry) is closed at once.
  const odd = await withFetch([{ status: 201, body: { ...START, part_size: VIDEO_UPLOAD.partMaxBytes + 1 } }, { aborted: true }], async () => {
    err = await uploadVideo({ uid: 'v-new', file }).catch((e) => e);
  });
  assert.deepEqual(lines(odd), [START_PATH, ABORT_PATH]);
  assert.match(err.message, /could not start: the reply came back in a shape this page cannot read/);
  // With no upload id there is nothing to close, so nothing is sent.
  const noId = await withFetch([{ status: 201, body: { key: KEY, part_size: 100, parts: 3 } }], async () => {
    err = await uploadVideo({ uid: 'v-new', file }).catch((e) => e);
  });
  assert.deepEqual(lines(noId), [START_PATH]);
  assert.match(err.message, /could not start/);
  // A part answered without its etag cannot be completed: aborted.
  const noEtag = await withFetch([{ status: 201, body: START }, { part_number: 1 }, { aborted: true }], async () => {
    err = await uploadVideo({ uid: 'v-new', file }).catch((e) => e);
  });
  assert.deepEqual(lines(noEtag), [START_PATH, partPath(1), ABORT_PATH]);
  assert.match(err.message, /Part 1 of 3 came back without its etag/);
});

test('a file outside the limits is refused before anything is sent', async () => {
  let err;
  const big = await withFetch([], async () => { err = await uploadVideo({ uid: 'v-new', file: declared(2 * GiB + 1) }).catch((e) => e); });
  assert.deepEqual(big, [], 'a file over 2 GB went to the route');
  assert.equal(err.message, 'A video is at most 2 GB. This file is 2.1 GB.');
  const mov = await withFetch([], async () => { err = await uploadVideo({ uid: 'v-new', file: clip('clip.mov', 'video/quicktime') }).catch((e) => e); });
  assert.deepEqual(mov, [], 'a QuickTime file went to the route');
  assert.equal(err.message, 'A video is video/mp4 or video/webm. This file is video/quicktime.');
  // Chosen in the field: the sentence, and no Upload button to press.
  const refused = html(h(VideoFileField, { id: 'f', hasUpload: false, hasLink: false, upload: chooseVideoFile(declared(2 * GiB + 1)) }));
  assert.match(flat(refused), /A video is at most 2 GB\. This file is 2\.1 GB\./);
  assert.match(tagOf(refused, 'studio-upload-error'), /role="alert"/);
  assert.doesNotMatch(refused, /button-upload-start/);
  // A file within them waits for "Upload", named with its size.
  const ready = html(h(VideoFileField, { id: 'f', hasUpload: false, hasLink: false, upload: chooseVideoFile(clip()) }));
  assert.match(flat(ready), /cap-tables\.mp4 · 250 bytes/);
  assert.match(ready, /data-testid="button-upload-start"[^>]*>Upload</);
  assert.equal(chooseVideoFile(null), IDLE_UPLOAD, 'a closed file dialog chooses nothing');
});

test('cancel: the upload is closed before its next part, and nothing is attached', async () => {
  const file = clip();
  let err;
  let sentParts = 0;
  const calls = await withFetch([{ status: 201, body: START }, PARTS_OK[0], { aborted: true }], async () => {
    err = await uploadVideo({ uid: 'v-new', file, isCancelled: () => sentParts >= 1 }).catch((e) => e);
  }, (call) => { if (call.method === 'PUT') sentParts += 1; });
  assert.deepEqual(lines(calls), [START_PATH, partPath(1), ABORT_PATH]);
  assert.equal(err.code, UPLOAD_CANCELLED);
  // Cancelled after the last part: still closed, never completed.
  const late = await withFetch([{ status: 201, body: START }, ...PARTS_OK, { aborted: true }], async () => {
    sentParts = 0;
    err = await uploadVideo({ uid: 'v-new', file, isCancelled: () => sentParts >= 3 }).catch((e) => e);
  }, (call) => { if (call.method === 'PUT') sentParts += 1; });
  assert.deepEqual(lines(late), [START_PATH, partPath(1), partPath(2), partPath(3), ABORT_PATH]);
  assert.deepEqual(uploadFailure(err, file), { phase: 'cancelled', file });
  assert.match(flat(html(h(VideoFileField, { id: 'f', hasUpload: false, hasLink: false, upload: { phase: 'cancelled', file } }))), /Cancelled\. The upload was closed, and nothing was attached\./);
});

// ── The editor: its state from "Upload" to the outcome ─────────────────────

test('the editor\'s upload: progress part by part, then the item as stored, the form\'s link cleared and the page told', async () => {
  const file = clip();
  const upload = box({ phase: 'ready', file });
  const uploaded = box(null);
  const form = box(itemForm(LINKED));
  const told = [];
  await withFetch([{ status: 201, body: START }, ...PARTS_OK, COMPLETE, { item: STORED }], () => runVideoUpload({
    uid: 'v-new', file, token: { cancelled: false }, latestItem: () => LINKED,
    setUpload: upload.set, setUploaded: uploaded.set, setForm: form.set, onUploaded: (row) => told.push(row),
  }));
  assert.deepEqual(upload.seen.map((s) => [s.phase, s.sent, s.part]), [
    ['uploading', 0, 0], ['uploading', 0, 0], ['uploading', 100, 1], ['uploading', 200, 2], ['uploading', 250, 3], ['uploading', 250, 3], ['done', undefined, undefined],
  ]);
  assert.equal(upload.seen.at(-2).step, 'complete');
  assert.deepEqual(upload.get(), { phase: 'done', file, attached: COMPLETE });
  // The route cleared the link, so the form does: a save now cannot send it back over the file.
  assert.equal(form.get().video_url, '');
  assert.equal(form.get().title, LINKED.title);
  assert.equal(itemBody(form.get(), 'video').video_url, '', 'the next save sends no link');
  assert.deepEqual(uploaded.get(), { from: LINKED, row: STORED });
  assert.deepEqual(told, [STORED]);
  // The item as stored, when the read after the upload failed: the reply's source, the link cleared.
  assert.deepEqual(storedAfterUpload(LINKED, { attached: COMPLETE, item: null }), { ...LINKED, video_source: 'r2', video_url: null });
  assert.deepEqual(formAfterUpload({ title: 't', video_url: 'https://youtu.be/dQw4w9WgXcQ' }), { title: 't', video_url: '' });
  // What the editor draws: its upload's row while the page still hands it the old item
  // (the page's list is not told without `onUploaded`), the page's item once it hands a newer one.
  assert.equal(shownItem(LINKED, uploaded.get()), uploaded.get().row);
  assert.deepEqual(shownItem(LINKED, uploaded.get()), STORED);
  const relinked = { ...STORED, video_source: 'url', video_url: 'https://vimeo.com/76979871', updated_at: '2026-10-06T13:00:00.000Z' };
  assert.equal(shownItem(relinked, uploaded.get()), relinked, 'a link saved after the upload was drawn as the upload');
  assert.equal(shownItem(LINKED, null), LINKED);
  assert.match(codeOnly(read('frontend/src/pages/learning/StudioItemEditor.jsx')), /const current = shownItem\(item, uploaded\);/);
});

test('the editor\'s upload stopped: the route\'s words, or a cancel asked for while a part was on its way', async () => {
  const file = clip();
  const tooBig = refusal('part_too_large', 'A part is at most 99614720 bytes.');
  const upload = box({ phase: 'ready', file });
  const form = box(itemForm(LINKED));
  const uploaded = box(null);
  const told = [];
  const run = (token) => runVideoUpload({
    uid: 'v-new', file, token, latestItem: () => LINKED, setUpload: upload.set, setUploaded: uploaded.set, setForm: form.set, onUploaded: (row) => told.push(row),
  });
  await withFetch([{ status: 201, body: START }, { status: 413, body: tooBig }, { aborted: true }], () => run({ cancelled: false }));
  assert.deepEqual(upload.get(), { phase: 'failed', file, message: tooBig.message });
  assert.equal(form.get().video_url, LINKED.video_url, 'a failed upload left the link in place');
  assert.deepEqual([uploaded.seen, told], [[], []]);
  // "Cancel upload" pressed while part 2 is on its way, with a token that holds no controller
  // (no AbortController): it finishes, the field keeps saying "cancelling" through its
  // progress, and the upload is closed before part 3. With one, the part on its way is
  // stopped too (learning_stage3_d562.test.mjs).
  const token = { cancelled: false };
  const calls = await withFetch([{ status: 201, body: START }, ...PARTS_OK.slice(0, 2), { aborted: true }], () => run(token), (call) => {
    if (call.path === partPath(2).slice(4)) { token.cancelled = true; upload.set(cancelling); }
  });
  assert.deepEqual(lines(calls), [START_PATH, partPath(1), partPath(2), ABORT_PATH]);
  const after = upload.seen.slice(upload.seen.findIndex((s) => s.phase === 'cancelling'));
  assert.deepEqual(after.map((s) => [s.phase, s.part ?? null]), [['cancelling', 1], ['cancelling', 2], ['cancelled', null]]);
  assert.deepEqual([uploaded.seen, told], [[], []]);
  // A cancel arriving after the upload ended changes nothing.
  assert.deepEqual(cancelling({ phase: 'done', file }), { phase: 'done', file });
  // The editor's own wiring: Upload runs this, Cancel and leaving the editor stop the token.
  const src = codeOnly(read('frontend/src/pages/learning/StudioItemEditor.jsx'));
  assert.match(src, /const token = uploadToken\(\);\s*running\.current = token;/);
  assert.match(src, /await runVideoUpload\(\{\s*uid: item\.uid, file, token, latestItem: \(\) => latest\.current, setUpload, setUploaded, setForm, onUploaded,/);
  assert.match(src, /const cancelUpload = \(\) => \{\s*stopUpload\(running\.current\);\s*setUpload\(cancelling\);/);
  assert.match(src, /useEffect\(\(\) => \(\) => stopUpload\(running\.current\), \[\]\);/);
  assert.match(src, /onStart=\{startUpload\}\s*onCancel=\{cancelUpload\}/);
  // While a file is on its way, saving and the status actions wait.
  assert.match(src, /<StatusActions status=\{current\.status\} what=\{noun\} onStatus=\{onStatus\} busy=\{busy \|\| sending\} \/>/);
  assert.match(src, /<button type="submit" className=\{PRIMARY\} disabled=\{busy \|\| sending\} data-testid="button-item-save">/);
});

// ── The editor's field, drawn ──────────────────────────────────────────────

test('the field: what the item plays, the limits, progress by part, attaching, cancelling, done; the bucket key never drawn', () => {
  const file = clip();
  const field = (upload, extra = {}) => html(h(VideoFileField, { id: 'f', hasUpload: false, hasLink: true, upload, ...extra }));
  const idle = field(IDLE_UPLOAD);
  assert.match(flat(idle), /Link This video plays its link\. Uploading a file replaces the link\./);
  assert.equal(textOf(idle, 'studio-upload-limits'), 'MP4 or WebM, at most 2 GB.');
  assert.match(tagOf(idle, 'input-item-upload'), /accept="video\/mp4,video\/webm"/);
  assert.doesNotMatch(tagOf(idle, 'input-item-upload'), /disabled=""/);
  // Sending part 2 of 3: the bar at the bytes already sent, the part on its way named, Cancel live.
  const sending = field({ phase: 'uploading', file, sent: 100, total: 250, part: 1, parts: 3, step: 'parts' });
  assert.match(sending, /role="progressbar"[^>]*aria-valuenow="40"/);
  assert.match(sending, /style="width:40%"/);
  assert.match(flat(sending), /Sending part 2 of 3 · 100 bytes of 250 bytes sent \(40%\)/);
  assert.match(flat(sending), /Keep this page open until the upload finishes\./);
  assert.match(tagOf(sending, 'input-item-upload'), /disabled=""/, 'another file can be chosen mid-upload');
  assert.doesNotMatch(tagOf(sending, 'button-upload-cancel'), /disabled=""/);
  assert.doesNotMatch(sending, /button-upload-start/);
  assert.match(flat(field({ phase: 'uploading', file, sent: 0, total: 250, part: 0, parts: null, step: 'start' })), /Starting the upload…/);
  // Attaching: too late to cancel.
  const attaching = field({ phase: 'uploading', file, sent: 250, total: 250, part: 3, parts: 3, step: 'complete' });
  assert.match(flat(attaching), /Attaching the file: the server checks its size and type\./);
  assert.match(tagOf(attaching, 'button-upload-cancel'), /disabled=""/);
  const cancellingNow = field({ phase: 'cancelling', file, sent: 100, total: 250, part: 1, parts: 3, step: 'parts' });
  assert.match(flat(cancellingNow), /Cancelling: the part on its way finishes, then the upload is closed\./);
  assert.match(tagOf(cancellingNow, 'button-upload-cancel'), /disabled=""/);
  // Done: the source is the file, and the notice gives the route's own size for it.
  const done = field({ phase: 'done', file, attached: { ...COMPLETE, size_bytes: 3 * 1024 * 1024 } }, { hasUpload: true, hasLink: false });
  assert.match(flat(done), /Uploaded file This video plays its uploaded file\./);
  assert.match(flat(done), /Uploaded and attached: cap-tables\.mp4, 3 MB\./);
  // Once a saved link has replaced the file, the notice about it is not drawn.
  assert.doesNotMatch(field({ phase: 'done', file, attached: COMPLETE }, { hasUpload: false, hasLink: true }), /studio-upload-done/);
  // A new video: no uid for the routes yet, and the limits shown before it exists.
  const blocked = field(IDLE_UPLOAD, { blocked: UPLOAD_NEEDS_DRAFT, hasLink: false });
  assert.match(tagOf(blocked, 'input-item-upload'), /disabled=""/);
  assert.match(flat(blocked), /No video yet Upload a file or save a link: a video with neither cannot be published\./);
  assert.equal(textOf(blocked, 'studio-upload-limits'), 'Create the draft first, then upload its file. MP4 or WebM, at most 2 GB.');
  assert.match(tagOf(idle, 'input-item-upload'), /aria-describedby="f-limits"/);
  assert.match(tagOf(idle, 'studio-upload-limits'), /id="f-limits"/);
  assert.equal(uploadPercent({ sent: 250, total: 0 }), 0);
  for (const markup of [idle, sending, attaching, cancellingNow, done, blocked]) {
    assert.doesNotMatch(markup, /learning\/videos\//, 'a bucket key reached the page');
  }
});

test('the editor with an uploaded file: a saved link replaces it, an empty link leaves it, and a video with neither is refused in the route\'s words', async () => {
  const markup = html(h(StudioItemEditor, { item: STORED, kind: 'video', onSave: () => {}, onStatus: () => {} }));
  assert.match(flat(markup), /Video file Uploaded file This video plays its uploaded file\./);
  assert.match(flat(markup), /Or paste a link https, from YouTube, Vimeo or Cloudflare Stream\. Saving a link replaces the uploaded file\./);
  assert.match(tagOf(markup, 'input-item-video-url'), /value=""/);
  assert.doesNotMatch(tagOf(markup, 'input-item-upload'), /disabled=""/, 'a stored video takes a file');
  // The file is offered before the link, as the canvas's Source row is.
  assert.ok(markup.indexOf('data-testid="input-item-upload"') < markup.indexOf('data-testid="input-item-video-url"'));
  const linked = flat(html(h(StudioItemEditor, { item: LINKED, kind: 'video', onSave: () => {}, onStatus: () => {} })));
  assert.match(linked, /Link This video plays its link\. Uploading a file replaces the link\./);
  assert.doesNotMatch(linked, /Saving a link replaces the uploaded file/);
  // What a save sends for it, and the route's two rules that make that safe.
  assert.equal(itemBody(itemForm(STORED), 'video').video_url, '', 'an empty link is sent as empty, which the route stores as null');
  const admin = read('cloudflare-worker/src/routes/admin_learning.ts');
  assert.ok(admin.includes("UPDATE learning_items SET video_source = 'url', r2_key = NULL WHERE uid = ?"), 'a link no longer replaces an upload');
  assert.ok(admin.includes("UPDATE learning_items SET video_source = NULL WHERE uid = ? AND video_source = 'url'"), 'clearing a link no longer leaves an upload');
  // Neither a link nor a file: publishing is the route's refusal, and the editor shows its sentence.
  const noVideo = "A video needs its link or an uploaded file before it is published.";
  assert.ok(admin.includes(`code: 'no_video', message: '${noVideo}'`));
  let err;
  await withFetch([{ status: 409, body: refusal('no_video', noVideo) }], async () => { err = await setItemStatus('v-new', 'publish').catch((e) => e); });
  assert.deepEqual([err.message, err.code, err.status], [noVideo, 'no_video', 409]);
  const bare = html(h(StudioItemEditor, { item: { ...LINKED, video_source: null, video_url: null }, kind: 'video', onSave: () => {}, onStatus: () => {}, error: err.message }));
  assert.match(flat(bare), /No video yet Upload a file or save a link: a video with neither cannot be published\./);
  assert.match(tagOf(bare, 'studio-error'), /role="alert"/);
  assert.ok(flat(bare).includes(noVideo));
});

// ── Playback ───────────────────────────────────────────────────────────────

test('playback: an uploaded file plays in the browser\'s own player from its stream route, a link embeds, an upload with no address is not recorded', () => {
  // The route's own address for the stream, which the item read sends.
  const member = read('cloudflare-worker/src/routes/learning.ts');
  assert.ok(member.includes("video_stream_url: item.video_source === 'r2' ? `/api/learning/items/${encodeURIComponent(item.uid)}/video` : null"));
  assert.equal(itemStreamPath('v-r2'), MEMBER_R2.video_stream_url);
  assert.ok(read('cloudflare-worker/src/routes/learning_video.ts').includes("learningVideo.get('/items/:uid/video'"));
  assert.deepEqual(videoPlayback(MEMBER_R2), { src: '/api/learning/items/v-r2/video', embed: false });
  // A standalone video: <video controls> from that path, metadata first, with its transcript.
  const view = html(h(ItemView, { state: { status: 'ready', item: MEMBER_R2, progress: null }, onMark: () => {} }));
  const video = tagOf(view, 'lesson-video');
  assert.match(video, /^<video /);
  assert.match(video, /src="\/api\/learning\/items\/v-r2\/video"/);
  assert.match(video, /controls=""/);
  assert.match(video, /preload="metadata"/);
  assert.match(video, /aria-label="Cap tables in ten minutes, 10 min"/);
  assert.doesNotMatch(view, /<iframe|lesson-video-absent/);
  assert.match(flat(view), /Transcript A cap table lists who owns what\./);
  // A lesson whose item is the upload plays the same way.
  const course = {
    status: 'ready',
    course: { uid: 'c1', slug: 'seed-basics', title: 'Seed basics', summary: null, cover_url: null, level: 'intro', estimated_minutes: 30, resources: [], status: 'published', published_at: null },
    modules: [{ uid: 'm1', title: 'Foundations', position: 0, lessons: [{ uid: 'l1', title: 'Cap tables', position: 0, kind: 'video', ref_uid: 'v-r2', required: true, progress: null }] }],
    progress: { required: 1, completed: 0, percent: 0 },
  };
  const lesson = html(h(LessonView, { courseState: course, itemState: { status: 'ready', item: MEMBER_R2, progress: null }, lessonUid: 'l1', onMark: () => {} }));
  assert.match(tagOf(lesson, 'lesson-video'), /src="\/api\/learning\/items\/v-r2\/video"/);
  // A link still embeds, though the read now sends a null stream address beside it.
  assert.deepEqual(videoPlayback(MEMBER_LINK), { src: 'https://player.vimeo.com/video/76979871', embed: true });
  assert.match(html(h(ItemView, { state: { status: 'ready', item: MEMBER_LINK, progress: null } })), /<iframe src="https:\/\/player\.vimeo\.com\/video\/76979871"/);
  // An upload whose read sent no address: Not recorded, with the reason, and no player.
  const bare = html(h(ItemView, { state: { status: 'ready', item: { ...MEMBER_R2, video_stream_url: null }, progress: null } }));
  assert.match(bare, /data-testid="lesson-video-absent"/);
  assert.match(flat(bare), /Not recorded · This video was uploaded, but the page was not sent an address to stream it from\./);
  assert.doesNotMatch(bare, /<video/);
  // Only this item's own stream route is played; a query after it is kept.
  for (const stream of [
    'https://studioos-files.r2.cloudflarestorage.com/learning/videos/v-r2/0123456789abcdef0123456789abcdef.mp4',
    '/api/learning/items/v-other/video',
    '//evil.example/api/learning/items/v-r2/video',
  ]) {
    const play = videoPlayback({ ...MEMBER_R2, video_stream_url: stream });
    assert.equal(play.src, undefined, `${stream} was played`);
    assert.match(play.reason, /not this item’s own, so it is not played here/);
  }
  assert.deepEqual(videoPlayback({ ...MEMBER_R2, video_stream_url: '/api/learning/items/v-r2/video?v=2' }), { src: '/api/learning/items/v-r2/video?v=2', embed: false });
});

test('playback that fails to load is Unreadable, with a retry, never a black box', () => {
  const markup = html(h(VideoUnreadable, { onRetry: () => {} }));
  assert.match(markup, /data-testid="lesson-video-unreadable"/);
  assert.match(flat(markup), /The video could not be read\. This is not a claim that the video is gone\. Retry/);
  // The player's own wiring: an error event swaps the player for it, and Retry loads the file again.
  const src = codeOnly(read('frontend/src/pages/learning/LessonPlayer.jsx'));
  assert.match(src, /if \(failed\) return <VideoUnreadable onRetry=\{\(\) => \{ setFailed\(false\); setAttempt\(\(n\) => n \+ 1\); \}\} \/>;/);
  assert.match(src, /key=\{attempt\}[\s\S]*?onError=\{\(\) => setFailed\(true\)\}/);
  // A failure belongs to its file: the player is keyed by it, so the next video starts afresh.
  assert.match(src, /<StreamPlayer\s+key=\{video\.src\}\s+src=\{video\.src\}/);
});
