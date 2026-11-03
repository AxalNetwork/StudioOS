/**
 * #4177 (L2 of #3726, on L1's routes, D4176) — the Learning studio's video on
 * Cloudflare Stream: the upload state machine, the 200 MB switch between basic
 * POST and tus, the 10-second poll, the thumbnail, captions (WebVTT only) and
 * chapters (times increase, at most 100), the content table's Video column
 * and the Copy to Stream state that waits for L4 (#4179), and that no control
 * is drawn before L1's routes answer.
 *
 * The Worker calls run through the real client against a stubbed `fetch`
 * whose replies are in `routes/learning_stream.ts`'s own shapes; the two
 * transports to Stream itself (XHR and tus-js-client) are replaced, since
 * they leave the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_stream_studio_4177.test.mjs
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

import {
  CAPTION_LANGUAGES, CHAPTER_LIMIT, CHAPTER_ORDER, CHAPTER_TIME, CHAPTER_TITLE, STORAGE_BANNER_LINE, STREAM_FAILED_LINE,
  STREAM_LIMITS_LINE, STREAM_TYPE_RULE, STREAM_UPLOAD, UPLOAD_CANCELLED, VTT_ONLY, captionRows, chapterProblem, chapterRows,
  chaptersBody, formatClock, frameUrl, nextChapter, parseClock, readyLine, stillOnStorage, storageBanner, streamCopyOf,
  streamField, streamFileProblem, streamPollMs, streamProtocolFor, streamTypeOf, thumbLabel, videoColumn, vttProblem,
} from '../src/pages/learning/videoUpload.js';
import {
  readItemChapters, readStreamStatus, saveChapters, studioRows, tusFailure, uploadCaptionFile, uploadToStream,
} from '../src/pages/learning/studioActions.js';
import StreamStudio, {
  STREAM_READING, StreamCaptions, StreamChapters, StreamThumbnail, StreamVideoField,
} from '../src/pages/learning/StudioStreamParts.jsx';
import StudioItemEditor from '../src/pages/learning/StudioItemEditor.jsx';
import StudioContentTable from '../src/pages/learning/StudioContentTable.jsx';
import { escapeRe } from './_escapeRe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/learning/studio'] }, el));
const flat = (m) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const MB = 1024 * 1024;

// ── Fixtures, in learning_stream.ts's own shapes ──────────────────────────
const SUID = '0123456789abcdef0123456789abcdef';
const SUID2 = 'fedcba9876543210fedcba9876543210';
const refusal = (code, message) => ({ error: code, message, detail: message });
/** `POST …/stream/uploads` (201). */
const START = { stream_uid: SUID, protocol: 'post', upload_url: 'https://upload.videodelivery.net/abc123', expires_at: '2026-11-03T10:30:00.000Z' };
const video = (over = {}) => ({
  stream_uid: SUID, origin: 'upload', state: 'ready', error_code: null, error_message: null, duration_seconds: 872,
  size_bytes: 104857600, thumbnail_pct: null, ready_at: '2026-11-03T10:05:00.000Z', captions: [], ...over,
});
/** `GET …/stream`. */
const status = (videos, current = null) => ({ status: 'ready', data: { current, videos } });
const ITEM = {
  uid: 'v-1', kind: 'video', title: 'The script', summary: null, body: null, video_source: null, video_url: null, duration_seconds: null,
  thumbnail_url: null, transcript: null, topic: null, level: null, visibility: 'open', status: 'draft', created_by: 1,
  created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z', published_at: null,
};
/** A file of a declared size whose bytes are never read. */
const declared = (size, type = 'video/mp4', name = 'the-script.mp4') => ({ name, type, size, slice: () => { throw new Error('bytes read'); } });

async function withFetch(replies, run) {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const queue = [...replies];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { method: init.method || 'GET', path: String(url).replace(/^.*?\/api/, ''), type: init.headers?.['Content-Type'] };
    if (typeof init.body === 'string') { try { call.body = JSON.parse(init.body); } catch { call.text = init.body; } }
    calls.push(call);
    const next = queue.shift() ?? { status: 200, body: {} };
    const reply = next.status ? next : { status: 200, body: next };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = orig; }
  return calls;
}
const lines = (calls) => calls.map((c) => `${c.method} ${c.path}`);

// ── The route's limits ─────────────────────────────────────────────────────

test('the limits are the route\'s: its four types, its 200 MB basic cap, its 1 MB caption cap, its sentence for a type', () => {
  const svc = read('cloudflare-worker/src/services/learningStream.ts');
  assert.ok(svc.includes('export const BASIC_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;'));
  assert.equal(STREAM_UPLOAD.basicMaxBytes, 200 * MB);
  assert.ok(svc.includes('export const VTT_MAX_BYTES = 1024 * 1024;'));
  assert.equal(STREAM_UPLOAD.vttMaxBytes, MB);
  const types = svc.slice(svc.indexOf('export const VIDEO_TYPES'), svc.indexOf('as const', svc.indexOf('export const VIDEO_TYPES')));
  assert.deepEqual(Object.keys(STREAM_UPLOAD.types), [...types.matchAll(/'(video\/[\w-]+)'/g)].map((m) => m[1]));
  assert.ok(svc.includes('v.length > 100'), 'the route no longer caps chapters at 100');
  assert.equal(STREAM_UPLOAD.maxChapters, 100);
  assert.ok(read('cloudflare-worker/src/routes/learning_stream.ts').includes(`message: '${STREAM_TYPE_RULE}'`));
  // Mutation checked: drop 'video/x-matroska' from STREAM_UPLOAD.types → the deepEqual above fails.
  assert.equal(streamFileProblem(declared(10, 'video/avi', 'a.avi')), `${STREAM_TYPE_RULE} This file is video/avi.`);
  assert.equal(streamFileProblem(declared(0)), 'This file is empty.');
  assert.equal(streamTypeOf({ name: 'Lecture.MKV', type: '' }), 'video/x-matroska', 'an MKV the browser does not type is typed by its extension');
  assert.equal(streamFileProblem(declared(10, '', 'clip.mov')), null);
  assert.equal(STREAM_LIMITS_LINE, 'MP4, WebM, MOV or MKV. Files over 200 MB go up resumably.');
});

// ── The 200 MB switch ──────────────────────────────────────────────────────

test('the 200 MB switch: up to and including 200 MB by basic POST to upload_url, above it by tus at the Worker\'s tus route', async () => {
  // Mutation checked: `<=` → `<` in streamProtocolFor → exactly 200 MB goes by tus and this fails.
  assert.equal(streamProtocolFor(200 * MB), 'post');
  assert.equal(streamProtocolFor(200 * MB + 1), 'tus');
  const posted = [];
  const tussed = [];
  const postFile = async (url, file, { onProgress }) => { posted.push([url, file.size]); onProgress(file.size / 2); };
  const tusUpload = async ({ endpoint, file, onProgress }) => { tussed.push([endpoint, file.size]); onProgress(file.size); return { stream_uid: SUID2 }; };
  const progress = [];
  let done;
  const basic = await withFetch([{ status: 201, body: START }], async () => {
    done = await uploadToStream({ uid: 'v-1', file: declared(200 * MB), postFile, tusUpload, onProgress: (p) => progress.push(p) });
  });
  assert.deepEqual(lines(basic), ['POST /admin/learning/items/v-1/stream/uploads']);
  assert.deepEqual(basic[0].body, { size_bytes: 200 * MB, content_type: 'video/mp4', name: 'the-script.mp4' });
  assert.deepEqual(posted, [[START.upload_url, 200 * MB]]);
  assert.deepEqual(tussed, []);
  assert.deepEqual(done, { stream_uid: SUID, protocol: 'post' });
  assert.deepEqual(progress.map((p) => [p.protocol, p.sent]), [['post', 0], ['post', 100 * MB], ['post', 200 * MB]]);
  // Over 200 MB: no basic start at all; tus goes to the Worker's own tus route.
  const big = await withFetch([], async () => {
    done = await uploadToStream({ uid: 'v-1', file: declared(200 * MB + 1, 'video/quicktime', 'long.mov'), postFile, tusUpload });
  });
  assert.deepEqual(lines(big), []);
  assert.deepEqual(tussed, [['/api/admin/learning/items/v-1/stream/uploads/tus', 200 * MB + 1]]);
  assert.deepEqual(done, { stream_uid: SUID2, protocol: 'tus' });
  // tus-js-client is pinned exactly, and only loaded when a large file is chosen.
  const pkg = JSON.parse(read('frontend/package.json'));
  assert.equal(pkg.dependencies['tus-js-client'], '4.3.1');
  const actions = codeOnly(read('frontend/src/pages/learning/studioActions.js'));
  assert.match(actions, /await import\('tus-js-client'\)/);
  assert.doesNotMatch(actions, /^import .*tus-js-client/m);
  // The session's headers reach only the Worker's creation request, never Stream's chunk URLs.
  assert.match(actions, /if \(req\.getMethod\(\) !== 'POST' \|\| !ours\(req\.getURL\(\)\)\) return;/);
});

test('a file the route would refuse is refused before anything is sent', async () => {
  let threw;
  const calls = await withFetch([], async () => {
    threw = await uploadToStream({ uid: 'v-1', file: declared(10, 'video/avi', 'a.avi'), postFile: () => assert.fail('sent'), tusUpload: () => assert.fail('sent') }).catch((e) => e);
  });
  assert.deepEqual(calls, []);
  assert.equal(threw.message, `${STREAM_TYPE_RULE} This file is video/avi.`);
});

// ── The upload state machine ───────────────────────────────────────────────

test('the upload state machine: reading, off, unreadable, idle, uploading, cancelling, processing, ready, failed', () => {
  const file = declared(100 * MB);
  assert.equal(streamField({ read: { status: 'loading' } }).kind, 'reading');
  assert.equal(streamField({ read: { status: 'unavailable', message: 'Video on Stream is not switched on yet.' } }).kind, 'off');
  assert.equal(streamField({ read: { status: 'unreadable' } }).kind, 'unreadable');
  assert.equal(streamField({ read: status([]) }).kind, 'idle');
  const up = streamField({ read: status([]), upload: { phase: 'uploading', file, sent: 48 * MB, total: 100 * MB } });
  assert.deepEqual([up.kind, up.percent, up.protocol], ['uploading', 48, 'post']);
  // The local upload wins over any read, even one that has not answered.
  assert.equal(streamField({ read: { status: 'loading' }, upload: { phase: 'cancelling', file, sent: 0, total: 1 } }).kind, 'cancelling');
  assert.equal(streamField({ read: status([video({ state: 'awaiting_upload' })]) }).kind, 'processing');
  // Mutation checked: drop the 'processing' branch → a processing video reads idle and this fails.
  assert.equal(streamField({ read: status([video({ state: 'processing' })]) }).kind, 'processing');
  const ready = streamField({ read: status([video({ width: 1920, height: 1080 })], SUID) });
  assert.equal(ready.kind, 'ready');
  assert.equal(readyLine(ready.video), 'Ready · 14:32 · 1920×1080');
  assert.equal(readyLine(video({ duration_seconds: null })), 'Ready · length not recorded · dimensions not recorded', 'the read does not send dimensions yet: never 0×0');
  // Failed: Stream's own words, as the route stored them.
  const failed = streamField({ read: status([video({ state: 'error', error_message: 'the container is not supported.' })]) });
  assert.deepEqual([failed.kind, failed.message], ['failed', 'the container is not supported.']);
  assert.equal(streamField({ read: status([video({ state: 'error' })]) }).message, STREAM_FAILED_LINE);
  // A refusal of this upload stays until another file is chosen.
  const tusOff = 'Files over 200 MB need the Stream API token.';
  assert.deepEqual(streamField({ read: status([]), upload: { phase: 'failed', file, message: tusOff } }).message, tusOff);
  // Superseded videos are passed over; a newer one processing shows while the old one still plays.
  assert.equal(streamField({ read: status([video({ stream_uid: SUID2, state: 'superseded' }), video()], SUID) }).kind, 'ready');
  assert.equal(streamField({ read: status([video({ stream_uid: SUID2, state: 'processing' }), video()], SUID) }).kind, 'processing');
  assert.equal(streamField({ read: status([]), upload: { phase: 'cancelled', file } }).cancelled, true);
});

test('processing is read again every 10 s, and only while a video or a caption is on its way', () => {
  assert.equal(STREAM_UPLOAD.pollMs, 10_000);
  // Mutation checked: return null for 'processing' → this fails.
  assert.equal(streamPollMs(status([video({ state: 'processing' })])), 10_000);
  assert.equal(streamPollMs(status([video({ state: 'awaiting_upload' })])), 10_000);
  assert.equal(streamPollMs(status([video({ captions: [{ language: 'pt', label: null, source: 'generated', state: 'pending' }] })], SUID)), 10_000);
  assert.equal(streamPollMs(status([video()], SUID)), null);
  assert.equal(streamPollMs(status([video({ state: 'error' })])), null);
  assert.equal(streamPollMs({ status: 'loading' }), null);
  const parts = codeOnly(read('frontend/src/pages/learning/StudioStreamParts.jsx'));
  assert.match(parts, /const poll = streamPollMs\(read\);/);
  assert.match(parts, /const t = setTimeout\(refresh, poll\);\s*return \(\) => clearTimeout\(t\);/);
});

test('a cancel or a failure after Stream made the video abandons it, and the route\'s words stand', async () => {
  const file = declared(10 * MB);
  // A refusal of the start: the route's sentence, nothing to abandon.
  const tooLarge = refusal('video_too_large', 'A file over 200 MB uses the resumable upload.');
  let err;
  let calls = await withFetch([{ status: 413, body: tooLarge }], async () => {
    err = await uploadToStream({ uid: 'v-1', file, postFile: () => assert.fail('posted') }).catch((e) => e);
  });
  assert.deepEqual(lines(calls), ['POST /admin/learning/items/v-1/stream/uploads']);
  assert.deepEqual([err.message, err.code], [tooLarge.message, 'video_too_large']);
  // Stream refuses the POST: the video is abandoned, and Stream's words are what the field shows.
  calls = await withFetch([{ status: 201, body: START }, { abandoned: true }], async () => {
    err = await uploadToStream({ uid: 'v-1', file, postFile: async () => { throw new Error('Stream did not take the file: Invalid video.'); } }).catch((e) => e);
  });
  // Mutation checked: drop `await abandon(start.stream_uid)` → the abandon line is missing and this fails.
  assert.deepEqual(lines(calls), ['POST /admin/learning/items/v-1/stream/uploads', `POST /admin/learning/items/v-1/stream/${SUID}/abandon`]);
  assert.equal(err.message, 'Stream did not take the file: Invalid video.');
  // Cancel: the request on its way is aborted, the video abandoned, and the error is the cancel.
  const controller = new AbortController();
  calls = await withFetch([{ status: 201, body: START }, { abandoned: true }], async () => {
    err = await uploadToStream({
      uid: 'v-1', file, signal: controller.signal,
      postFile: (url, f, { signal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); controller.abort(); }),
    }).catch((e) => e);
  });
  assert.equal(err.code, UPLOAD_CANCELLED);
  assert.equal(lines(calls)[1], `POST /admin/learning/items/v-1/stream/${SUID}/abandon`);
  // tus: a cancel after creation abandons the video it made.
  calls = await withFetch([{ abandoned: true }], async () => {
    err = await uploadToStream({ uid: 'v-1', file: declared(300 * MB), tusUpload: async () => { const e = new Error('x'); e.stream_uid = SUID2; throw e; } }).catch((e) => e);
  });
  assert.deepEqual(lines(calls), [`POST /admin/learning/items/v-1/stream/${SUID2}/abandon`]);
  // tus refused by the Worker's creation route: its own sentence, read from the reply's body.
  const tusOff = refusal('stream_tus_unavailable', 'Files over 200 MB need the Stream API token.');
  const e = tusFailure({ originalResponse: { getBody: () => JSON.stringify(tusOff), getStatus: () => 503 } });
  assert.deepEqual([e.message, e.code, e.status], [tusOff.message, 'stream_tus_unavailable', 503]);
  assert.ok(read('cloudflare-worker/src/routes/learning_stream.ts').includes(`message: '${tusOff.message}'`));
});

test('the Stream read: 503 stream_unavailable is "off" (D561\'s field), any other failure is unreadable, never "no video"', async () => {
  let got;
  const off = refusal('stream_unavailable', 'Video on Stream is not switched on yet.');
  await withFetch([{ status: 503, body: off }], async () => { got = await readStreamStatus('v-1'); });
  assert.deepEqual(got, { status: 'unavailable', message: off.message });
  assert.ok(read('cloudflare-worker/src/routes/learning_stream.ts').includes(`code: 'stream_unavailable', message: '${off.message}'`));
  let err;
  await withFetch([{ status: 500, body: refusal('server_error', 'The store could not be read.') }], async () => { err = await readStreamStatus('v-1').catch((x) => x); });
  assert.equal(err.message, 'The store could not be read.');
  await withFetch([{ current: null, videos: [video()] }], async () => { got = await readStreamStatus('v-1'); });
  assert.equal(got.status, 'ready');
  await withFetch([{ nothing: true }], async () => { err = await readStreamStatus('v-1').catch((x) => x); });
  assert.match(err.message, /shape this page cannot read/);
});

// ── No control before the routes answer ────────────────────────────────────

test('no control is drawn before L1\'s routes answer', () => {
  // The editor of a stored video, as the page mounts it: the Stream read has not answered.
  const editor = html(h(StudioItemEditor, { item: ITEM, kind: 'video', onSave: () => {}, onStatus: () => {} }));
  assert.ok(flat(editor).includes(STREAM_READING));
  // Mutation checked: draw the idle field for 'reading' in streamField → input-stream-file appears and this fails.
  for (const control of ['input-stream-file', 'button-stream-pick', 'button-stream-cancel', 'input-item-upload', 'button-upload-start', 'stream-thumbnail', 'stream-captions', 'stream-chapters']) {
    assert.doesNotMatch(editor, new RegExp(`data-testid="${control}"`), `${control} was drawn before the Stream read answered`);
  }
  // A failed read: unreadable, still no upload control.
  const broken = html(h(StreamStudio, { uid: 'v-1', initial: { status: 'unreadable', message: 'x' } }));
  assert.match(broken, /learning-unreadable/);
  assert.doesNotMatch(broken, /type="file"/);
  // Off: D561's R2 field, after the route's own sentence.
  const off = flat(html(h(StreamStudio, { uid: 'v-1', initial: { status: 'unavailable', message: 'Video on Stream is not switched on yet.' }, renderOff: () => h('span', null, 'R2 FIELD') })));
  assert.match(off, /Video on Stream is not switched on yet\. The file goes to storage as before\. R2 FIELD/);
  // Answered, the chapters not yet read: the field draws, no chapter control does.
  const answered = html(h(StreamStudio, { uid: 'v-1', initial: status([]) }));
  assert.match(answered, /data-testid="input-stream-file"/);
  assert.doesNotMatch(answered, /button-chapter-add|button-chapters-save/);
  // A new video: no uid, so no Stream read, and D561's field waits for the draft.
  const fresh = html(h(StudioItemEditor, { item: null, kind: 'video', onSave: () => {}, onStatus: () => {} }));
  assert.doesNotMatch(fresh, /stream-reading|stream-video-field/);
  assert.match(flat(fresh), /Create the draft first, then upload its file\./);
});

// ── The field, drawn (lr14, lr14b, lr20e) ──────────────────────────────────

test('the field in each state, in the board\'s words', () => {
  const draw = (field, extra = {}) => html(h(StreamVideoField, { id: 'f', field, ...extra }));
  const idle = flat(draw({ kind: 'idle' }));
  assert.match(idle, /Video file Drop a video here, or browse · MP4, WebM, MOV or MKV\. Files over 200 MB go up resumably\./);
  const up = draw(streamField({ read: status([]), upload: { phase: 'uploading', file: declared(100 * MB), sent: 48 * MB, total: 100 * MB } }));
  assert.match(flat(up), /the-script\.mp4 · uploading 48% Keep this page open until the upload finishes\. Cancel upload/);
  assert.match(up, /aria-valuenow="48"/);
  const tus = flat(draw(streamField({ read: status([]), upload: { phase: 'uploading', file: declared(300 * MB), sent: 0, total: 300 * MB } })));
  assert.match(tus, /Over 200 MB, so it goes up resumably\./);
  assert.match(flat(draw({ kind: 'processing' })), /Stream is processing this video Processing Checked again every 10 s\./);
  const ready = flat(draw({ kind: 'ready', video: video({ width: 1920, height: 1080 }) }, { fileName: 'the-script.mp4' }));
  assert.match(ready, /the-script\.mp4 Ready · 14:32 · 1920×1080 Replace/);
  const failed = draw({ kind: 'failed', message: 'Stream rejected the file: the container is not supported.' });
  assert.match(flat(failed), /Stream rejected the file: the container is not supported\. Try again/);
  assert.match(failed, /role="alert"/);
  assert.match(flat(draw({ kind: 'idle', cancelled: true })), /Cancelled\. Nothing was uploaded to Stream\./);
  // Phone (lr20e): every control is at least 44 px tall below 640 px.
  assert.match(up, /data-testid="button-stream-cancel"/);
  assert.match(up.slice(up.lastIndexOf('<', up.indexOf('button-stream-cancel')), up.indexOf('button-stream-cancel')), /max-sm:min-h-11/);
});

// ── Captions (lr15) ────────────────────────────────────────────────────────

test('captions: Generate by language, Upload VTT, each row\'s source and state; only WebVTT is accepted', async () => {
  const v = video({ captions: [
    { language: 'en', label: 'English', source: 'generated', state: 'ready' },
    { language: 'fr', label: null, source: 'uploaded', state: 'ready' },
    { language: 'pt', label: null, source: 'generated', state: 'pending' },
    { language: 'de', label: null, source: 'uploaded', state: 'error' },
  ] });
  assert.deepEqual(captionRows(v).map((r) => [r.name, r.source, r.state]), [
    ['English', 'Generated', 'Ready'], ['Français', 'Uploaded', 'Ready'], ['Português', 'Generated', 'Pending'], ['Deutsch', 'Uploaded', 'Error'],
  ]);
  assert.deepEqual(captionRows(video({ captions: [{ language: 'xx', source: 'odd', state: 'odd' }] })).map((r) => [r.source, r.state]), [['Not recorded', 'Not recorded']]);
  const drawn = flat(html(h(StreamCaptions, { id: 'c', video: v })));
  assert.match(drawn, /Captions Generate ▾ Upload VTT English en Generated Ready Delete Français fr Uploaded Ready Delete/);
  assert.ok(CAPTION_LANGUAGES.every(([tag]) => /^[a-z]{2,3}$/.test(tag)), 'every tag is one the route\'s LANGUAGE_RE takes');
  // WebVTT only, refused before anything is sent.
  const srt = new File(['1\n00:00:01,000 --> 00:00:02,000\nHello'], 'captions.srt', { type: 'application/x-subrip' });
  let err;
  let calls = await withFetch([], async () => { err = await uploadCaptionFile('v-1', 'en', srt).catch((e) => e); });
  assert.deepEqual(calls, []);
  // Mutation checked: return null from vttProblem → the PUT is sent and this fails.
  assert.equal(err.message, 'Only WebVTT files are accepted. captions.srt was not uploaded.');
  assert.equal(VTT_ONLY, 'Only WebVTT files are accepted.');
  assert.equal(vttProblem({ name: 'renamed.vtt', size: 10 }, 'not a vtt'), 'Only WebVTT files are accepted. renamed.vtt was not uploaded.', 'a .vtt name alone is not WebVTT');
  assert.equal(vttProblem({ name: 'big.vtt', size: MB + 1 }, 'WEBVTT\n'), 'A caption file is at most 1 MB.');
  const vtt = new File(['WEBVTT\n\n00:01.000 --> 00:02.000\nHello'], 'captions.vtt', { type: 'text/vtt' });
  calls = await withFetch([{ caption: { language: 'en', label: null, source: 'uploaded', state: 'ready' } }], async () => { await uploadCaptionFile('v-1', 'en', vtt); });
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.type, c.text?.slice(0, 6)]), [['PUT', '/admin/learning/items/v-1/stream/captions/en', 'text/vtt', 'WEBVTT']]);
});

// ── Chapters (lr15) ────────────────────────────────────────────────────────

test('chapters: times must increase, at most 100, each with a title; checked before the PATCH', async () => {
  assert.equal(CHAPTER_ORDER, 'Each chapter must start after the one before it.');
  assert.deepEqual([parseClock('03:40'), parseClock('1:02:05'), parseClock('75'), parseClock('3:4'), parseClock('ab')], [220, 3725, 75, undefined, undefined]);
  assert.deepEqual([formatClock(872), formatClock(3725), formatClock(null)], ['14:32', '1:02:05', null]);
  const ok = [{ start: '00:00', title: 'Why interview' }, { start: '03:40', title: 'Finding people' }];
  assert.equal(chapterProblem(ok), null);
  // Mutation checked: `start <= last` → `start < last` → an equal start passes and this fails.
  assert.deepEqual(chapterProblem([...ok, { start: '03:40', title: 'Again' }]), { index: 2, message: CHAPTER_ORDER });
  assert.deepEqual(chapterProblem([...ok, { start: '01:00', title: 'Earlier' }]), { index: 2, message: CHAPTER_ORDER });
  assert.deepEqual(chapterProblem([{ start: 'soon', title: 'x' }]), { index: 0, message: CHAPTER_TIME });
  assert.deepEqual(chapterProblem([{ start: '00:00', title: '  ' }]), { index: 0, message: CHAPTER_TITLE });
  const hundred = Array.from({ length: 100 }, (_, i) => ({ start: String(i), title: `C${i}` }));
  assert.equal(chapterProblem(hundred), null);
  // Mutation checked: maxChapters 100 → 101 → the 101st passes and this fails.
  assert.deepEqual(chapterProblem([...hundred, { start: '100', title: 'One more' }]), { index: 100, message: CHAPTER_LIMIT });
  assert.equal(CHAPTER_LIMIT, 'A video has at most 100 chapters.');
  assert.deepEqual(nextChapter([]), { start: '00:00', title: '' });
  assert.deepEqual(nextChapter(ok), { start: '04:40', title: '' });
  // Drawn: the problem under the rows, Save waits; at 100, Add waits.
  const bad = html(h(StreamChapters, { id: 'ch', state: 'ready', rows: [...ok, { start: '02:00', title: 'Back' }] }));
  assert.match(flat(bad), /Chapter 3: Each chapter must start after the one before it\./);
  assert.match(bad, /disabled="" data-testid="button-chapters-save"/);
  assert.match(bad, /aria-invalid="true"/);
  const full = html(h(StreamChapters, { id: 'ch', state: 'ready', rows: hundred }));
  assert.match(full, /disabled="" data-testid="button-chapter-add"/);
  assert.match(flat(full), /A video has at most 100 chapters\./);
  assert.match(flat(html(h(StreamChapters, { id: 'ch', state: 'ready', rows: ok }))), /Chapters Start times must increase\. Up to 100 chapters\. Add/);
  assert.match(html(h(StreamChapters, { id: 'ch', state: 'unreadable', rows: [] })), /learning-unreadable/);
  // The PATCH carries the chapters alone, in the route's shape; a bad list sends nothing.
  let calls = await withFetch([{ item: ITEM }], async () => { await saveChapters('v-1', ok); });
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [['PATCH', '/admin/learning/items/v-1', { chapters: [{ start_seconds: 0, title: 'Why interview' }, { start_seconds: 220, title: 'Finding people' }] }]]);
  let err;
  calls = await withFetch([], async () => { err = await saveChapters('v-1', [...ok, { start: '00:10', title: 'x' }]).catch((e) => e); });
  assert.deepEqual([calls.length, err.message], [0, CHAPTER_ORDER]);
  assert.throws(() => chaptersBody([{ start: '', title: 'x' }]), { message: CHAPTER_TIME });
  // The stored chapters come from the item read, which sends them.
  let got;
  calls = await withFetch([{ item: { ...ITEM, chapters: [{ start_seconds: 220, title: 'Finding people' }], video_stream: { state: 'ready', poster_url: 'https://customer-a.cloudflarestream.com/t/thumbnails/thumbnail.jpg' } } }], async () => { got = await readItemChapters('v-1'); });
  assert.deepEqual(lines(calls), ['GET /learning/items/v-1']);
  assert.deepEqual(chapterRows(got.chapters), [{ start: '03:40', title: 'Finding people' }]);
  await withFetch([{ item: { ...ITEM } }], async () => { err = await readItemChapters('v-1').catch((e) => e); });
  assert.match(err.message, /shape this page cannot read/, 'a read without chapters is unreadable, never "no chapters"');
});

// ── The thumbnail (lr15) ───────────────────────────────────────────────────

test('the thumbnail: a slider over the video, the frame from Stream\'s own host only, Use this frame', () => {
  assert.equal(thumbLabel(130 / 872, 872), '02:10 of 14:32');
  assert.match(thumbLabel(0.5, null), /50% of the video/);
  const poster = 'https://customer-a.cloudflarestream.com/tok/thumbnails/thumbnail.jpg';
  assert.equal(frameUrl(poster, 0.5, 872), `${poster}?time=436s`);
  assert.equal(frameUrl('https://evil.example/thumb.jpg', 0.5, 872), null);
  const drawn = html(h(StreamThumbnail, { id: 't', video: video(), posterUrl: poster, value: 130 / 872 }));
  assert.match(flat(drawn), /Thumbnail Pick a frame as the poster\. 00:00 02:10 of 14:32 14:32 Use this frame/);
  assert.match(drawn, /aria-valuetext="02:10 of 14:32"/);
  assert.match(drawn, /data-testid="stream-thumbnail-frame"/);
  assert.doesNotMatch(html(h(StreamThumbnail, { id: 't', video: video(), posterUrl: null, value: 0 })), /stream-thumbnail-frame/);
});

// ── The content table (lr16) ───────────────────────────────────────────────

test('the content table\'s Video column, and Copy to Stream drawn only when the read carries L4\'s copy state', () => {
  const row = (over) => ({ kind: 'video', uid: 'v', title: 'T', status: 'published', visibility: 'open', programs: null, updated_at: '2026-10-30', ...over });
  assert.deepEqual(videoColumn(row({ stream_uid: SUID, video_source: 'r2' })), ['Stream · Ready', 'ok']);
  assert.deepEqual(videoColumn(row({ video_source: 'r2' })), ['Uploaded file', 'warn']);
  assert.deepEqual(videoColumn(row({ video_source: 'url', video_url: 'https://vimeo.com/1' })), ['Link', 'neutral']);
  assert.deepEqual(videoColumn(row({ video_source: null, stream_uid: null })), ['None', 'neutral']);
  // Mutation checked: answer ['None'] when `stream_uid` is absent → this fails.
  assert.equal(videoColumn(row({ video_source: null })), null, 'without stream_uid in the read, "None" would be a claim nobody can make');
  assert.equal(videoColumn(row({ kind: 'reading' })), null);
  // studioRows keeps an absent field absent.
  const [plain] = studioRows([{ ...ITEM, video_source: 'r2' }], []);
  assert.ok(!Object.hasOwn(plain, 'stream_uid') && !Object.hasOwn(plain, 'stream_copy'));
  const [carried] = studioRows([{ ...ITEM, video_source: 'r2', stream_uid: null, stream_copy: null }], []);
  assert.deepEqual([carried.stream_uid, carried.stream_copy], [null, null]);
  // Today (no L4): no copy state, no banner, no Copy to Stream.
  const today = html(h(StudioContentTable, { status: 'ready', rows: [row({ uid: 'a', video_source: 'r2' })] }));
  assert.match(flat(today), /Programs Video Updated/);
  assert.match(flat(today), /Uploaded file/);
  assert.doesNotMatch(today, /studio-storage-banner|Copy to Stream|Copying|Verified/);
  assert.equal(stillOnStorage([row({ video_source: 'r2' })]), null);
  // With L4's field (a guess, `stream_copy`): each state, and the banner.
  const rows = [
    row({ uid: 'a', video_source: 'r2', stream_uid: null, stream_copy: null }),
    row({ uid: 'b', video_source: 'r2', stream_uid: null, stream_copy: { state: 'copying' } }),
    row({ uid: 'c', video_source: 'r2', stream_uid: null, stream_copy: { state: 'verified' } }),
    row({ uid: 'd', video_source: 'r2', stream_uid: null, stream_copy: { state: 'failed', error_message: 'Stream rejected the file: unsupported container.' } }),
    row({ uid: 'e', video_source: 'r2', stream_uid: SUID, stream_copy: null }),
  ];
  assert.deepEqual(rows.map(streamCopyOf), ['copy', 'copying', 'verified', 'failed', null]);
  assert.equal(stillOnStorage(rows), 3);
  assert.equal(storageBanner(3), '3 uploaded videos still play from storage.');
  const later = html(h(StudioContentTable, { status: 'ready', rows, onCopyToStream: () => {} }));
  assert.match(flat(later), new RegExp(`3 uploaded videos still play from storage\\. ${escapeRe(STORAGE_BANNER_LINE)}`));
  assert.match(later, /data-testid="button-copy-stream-a"/);
  assert.match(flat(later), /Copying…/);
  assert.match(flat(later), /Verified/);
  assert.match(flat(later), /Stream rejected the file: unsupported container\. Copy failed · Try again/);
  assert.doesNotMatch(later, /button-copy-stream-e/, 'a video already on Stream is not copied again');
  // No handler (no L4 route): the states draw, the buttons do not.
  const noRoute = html(h(StudioContentTable, { status: 'ready', rows }));
  assert.doesNotMatch(noRoute, /button-copy-stream|Try again/);
  assert.match(flat(noRoute), /Copy failed/);
  // No route is invented: since #4179 (L4) the client's copy call is the Worker's mounted route, and the
  // studio still passes no handler.
  if (/stream\/migrations/.test(read('frontend/src/lib/api/adminLearning.js'))) {
    assert.match(read('cloudflare-worker/src/routes/learning_stream.ts'), /admin\.post\('\/stream\/migrations'/);
  }
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/learning/LearningStudio.jsx')), /onCopyToStream/);
});

test('the AI surfaces\' words, and no email, in the new code', () => {
  for (const f of ['StudioStreamParts.jsx', 'videoUpload.js', 'studioActions.js', 'StudioContentTable.jsx']) {
    const src = read(`frontend/src/pages/learning/${f}`);
    assert.doesNotMatch(src, /\badvi(c|s)e|advisor/i, `${f} says advisor or advice`);
    assert.doesNotMatch(src, /[\w.]+@[\w-]+\.[a-z]{2,}/i, `${f} carries an email`);
    assert.doesNotMatch(codeOnly(src), /window\.(confirm|alert|prompt)\(/, `${f} opens a browser dialog`);
  }
});
