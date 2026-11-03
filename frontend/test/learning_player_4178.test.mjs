// #4178 (D4178, L3 of #3726) — the Stream lesson player: the adaptive player
// on the signed source, chapters that seek, a click-to-seek transcript from
// the caption's timed cues (malformed cues tolerated), resume and the position
// throttle, the not-ready states, and the library's hover preview.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_player_4178.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  CUES_UNREADABLE, PLAIN_TRANSCRIPT_LINE, STREAM_FAILED, STREAM_PROCESSING, captionChoices, chapterAt, chaptersOf, cueAt,
  parseVtt, positionWriter, previewOf, streamSourceOf, videoPlayback, vttSeconds,
} from '../src/pages/learning/learningModel.js';
import { readItemCaption, readItemPreview } from '../src/pages/learning/learningReads.js';
import { learningApi } from '../src/lib/api/learning.js';
import LessonPlayer, { Chapters, Transcript } from '../src/pages/learning/LessonPlayer.jsx';
import { HoverPreview } from '../src/pages/learning/LearningHome.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/learning'] }, el));
const TOKEN = 'synthetic-signed-token-4178-not-a-jwt';
const IFRAME = `https://customer-abc123.cloudflarestream.com/${TOKEN}/iframe`;
const READY = {
  state: 'ready', iframe_url: IFRAME, hls_url: `https://customer-abc123.cloudflarestream.com/${TOKEN}/manifest/video.m3u8`,
  poster_url: `https://customer-abc123.cloudflarestream.com/${TOKEN}/thumbnails/thumbnail.jpg`,
  preview_url: `https://customer-abc123.cloudflarestream.com/${TOKEN}/thumbnails/thumbnail.gif?duration=4s`,
  captions: [{ language: 'en', label: 'English' }, { language: 'fr', label: null }], duration_seconds: 1800,
};
const VIDEO = { uid: 'vid-1', kind: 'video', title: 'Pricing basics', duration_seconds: 1800 };
const VTT = [
  'WEBVTT',
  '',
  '1',
  '00:00:00.000 --> 00:00:04.000',
  'Welcome to <v Mia>pricing</v> &amp; packaging.',
  '',
  'NOTE written by HQ',
  '',
  '00:00:04.000 --> 00:00:09.500 align:start',
  'Start with the problem.',
].join('\n');

test('videoPlayback: a ready Stream video plays first, ahead of the uploaded file and the link, on its own player', () => {
  const both = videoPlayback({ ...VIDEO, video_stream: READY, video_source: 'r2', video_stream_url: '/api/learning/items/vid-1/video', video_url: 'https://youtu.be/abcdefghij' });
  assert.equal(both.src, IFRAME);
  assert.equal(both.embed, true);
  assert.deepEqual(both.player, { src: TOKEN, customerCode: 'abc123' });
  assert.equal(both.stream.preview, READY.preview_url);
  // Without Stream the uploaded file plays, then the link.
  assert.deepEqual(videoPlayback({ ...VIDEO, video_stream: null, video_stream_url: '/api/learning/items/vid-1/video', video_url: 'https://youtu.be/abcdefghij' }), { src: '/api/learning/items/vid-1/video', embed: false });
  assert.equal(videoPlayback({ ...VIDEO, video_stream: null, video_url: 'https://youtu.be/abcdefghij' }).src, 'https://www.youtube-nocookie.com/embed/abcdefghij');
  // A Stream address on another host is never played.
  assert.match(videoPlayback({ ...VIDEO, video_stream: { ...READY, iframe_url: `https://evil.example/${TOKEN}/iframe` } }).reason, /not Stream's own/);
});

test('videoPlayback: processing and failed say so in the canvas words, ahead of any other source', () => {
  const r2 = { video_source: 'r2', video_stream_url: '/api/learning/items/vid-1/video' };
  assert.deepEqual(videoPlayback({ ...VIDEO, ...r2, video_stream: { state: 'processing' } }), { reason: STREAM_PROCESSING });
  assert.deepEqual(videoPlayback({ ...VIDEO, ...r2, video_stream: { state: 'error' } }), { reason: STREAM_FAILED });
  assert.equal(STREAM_PROCESSING, 'This video is still processing.');
  assert.equal(STREAM_FAILED, 'This video could not be processed. Ask HQ to upload it again.');
  const m = html(h(LessonPlayer, { status: 'ready', lesson: null, item: VIDEO, video: { reason: STREAM_PROCESSING } }));
  assert.match(m, /data-testid="lesson-video-absent"/);
  assert.ok(m.includes(STREAM_PROCESSING));
});

test('the player source: the signed token and customer code, from either Stream host; anything else is none', () => {
  assert.deepEqual(streamSourceOf(IFRAME), { src: TOKEN, customerCode: 'abc123' });
  assert.deepEqual(streamSourceOf(`https://iframe.videodelivery.net/${TOKEN}`), { src: TOKEN, customerCode: null });
  for (const bad of ['', 'not a url', `http://customer-abc123.cloudflarestream.com/${TOKEN}/iframe`, `https://customer-abc123.cloudflarestream.com/${TOKEN}`,
    `https://customer-abc123.cloudflarestream.com/${TOKEN}/manifest/video.m3u8`, `https://cloudflarestream.com.evil.example/${TOKEN}/iframe`, `https://customer-abc123.evil.example/${TOKEN}/iframe`, 'https://iframe.videodelivery.net/a/b']) {
    assert.equal(streamSourceOf(bad), null, bad);
  }
});

test('the Stream player is given the signed source, the resume point and the first caption', () => {
  const video = videoPlayback({ ...VIDEO, video_stream: READY });
  const m = html(h(LessonPlayer, { status: 'ready', lesson: null, item: VIDEO, video, resumeFrom: 725, onPosition: () => {} }));
  assert.match(m, /data-testid="lesson-video-stream"/, 'the Stream player, not the plain iframe');
  assert.doesNotMatch(m, /data-testid="lesson-video-embed"/);
  // @cloudflare/stream-react draws its iframe in the browser only, so its props are read from the source.
  const player = read('pages/learning/LessonPlayer.jsx');
  for (const prop of ['src={source.src}', 'customerCode={source.customerCode || undefined}', 'startTime={startAt ?? undefined}', 'defaultTextTrack={language || undefined}', 'streamRef={api}', 'controls', 'responsive']) {
    assert.ok(player.includes(prop), prop);
  }
  assert.match(player, /language=\{captionChoices\(video\)\[0\]\?\.language\}/);
  assert.match(player, /startAt=\{resumeFrom\}/);
  // A plain embed (no player source) stays a plain iframe.
  const plain = html(h(LessonPlayer, { status: 'ready', lesson: null, item: VIDEO, video: { src: 'https://player.vimeo.com/video/1', embed: true } }));
  assert.match(plain, /data-testid="lesson-video-embed"/);
});

test('WebVTT: cues in time order, tags and entities stripped, NOTE blocks skipped, a BOM and CRLF read', () => {
  assert.equal(vttSeconds('01:02:03.500'), 3723.5);
  assert.equal(vttSeconds('02:03.5'), 123.5);
  assert.equal(vttSeconds('02:61.000'), null);
  assert.deepEqual(parseVtt(VTT), [
    { start: 0, end: 4, text: 'Welcome to pricing & packaging.' },
    { start: 4, end: 9.5, text: 'Start with the problem.' },
  ]);
  assert.deepEqual(parseVtt(`﻿${VTT.replace(/\n/g, '\r\n')}`), parseVtt(VTT));
  assert.deepEqual(parseVtt('not a caption file\n\n00:00:00.000 --> 00:00:01.000\nHi'), [], 'a file that is not WebVTT has no cues');
  assert.deepEqual(parseVtt(''), []);
  assert.deepEqual(parseVtt(null), []);
});

test('WebVTT: a malformed cue is skipped and the rest are kept', () => {
  const messy = [
    'WEBVTT - a lesson',
    '',
    'STYLE',
    '::cue { color: lime }',
    '',
    '00:00:01.000 --> 00:00:02.000',
    'Good one.',
    '',
    '00:00:03.000 -> 00:00:04.000',
    'No proper arrow.',
    '',
    '00:00:xx.000 --> 00:00:06.000',
    'Unreadable start.',
    '',
    '00:00:09.000 --> 00:00:08.000',
    'Ends before it starts.',
    '',
    '00:00:10.000 --> 00:00:11.000',
    '<b></b>',
    '',
    'id-without-timing',
    'just text',
    '',
    '00:00:12.000 --> 00:00:13.000',
    'Last good one.',
  ].join('\n');
  assert.deepEqual(parseVtt(messy).map((c) => c.text), ['Good one.', 'Last good one.']);
});

test('the current cue and chapter: the one playing, -1 between cues and before the first chapter', () => {
  const cues = parseVtt(VTT);
  assert.equal(cueAt(cues, 0), 0);
  assert.equal(cueAt(cues, 3.99), 0);
  assert.equal(cueAt(cues, 4), 1);
  assert.equal(cueAt(cues, 20), -1);
  const chapters = chaptersOf({ chapters: [{ start_seconds: 725, title: 'The script' }, { start_seconds: 0, title: 'Intro' }, { start_seconds: 'x', title: 'Bad' }, { start_seconds: 30, title: '' }] });
  assert.deepEqual(chapters, [{ start: 0, title: 'Intro' }, { start: 725, title: 'The script' }]);
  assert.equal(chapterAt(chapters, 724), 0);
  assert.equal(chapterAt(chapters, 725), 1);
  assert.equal(chapterAt([{ start: 10, title: 'Late' }], 5), -1);
  assert.deepEqual(captionChoices({ stream: READY }), [{ language: 'en', label: 'English' }, { language: 'fr', label: 'fr' }]);
});

test('resume: at most one position write every 15 s while playing, and one on pause', async () => {
  let clock = 0;
  const writes = [];
  const w = positionWriter((s, p) => { writes.push([s, p]); }, { now: () => clock });
  assert.equal(w.tick(10, 100), true, 'the first tick writes');
  await new Promise((r) => setTimeout(r, 0));
  clock = 14_999;
  assert.equal(w.tick(25, 100), false, 'not before 15 s');
  clock = 15_000;
  assert.equal(w.tick(26, 100), true, 'at 15 s');
  await new Promise((r) => setTimeout(r, 0));
  clock = 16_000;
  assert.equal(w.flush(27.9, 100), true, 'a pause always writes');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes, [[10, 10], [26, 26], [27, 27]]);
  // The Stream player and the file player both write through it.
  const player = read('pages/learning/LessonPlayer.jsx');
  assert.equal((player.match(/= usePositionWriter\(onPosition,/g) || []).length, 2, "the Stream player and the file player");
  assert.match(player, /onTimeUpdate=\{\(\) => \{ const \[t, d\] = at\(\); onTime\?\.\(Number\(t\) \|\| 0\); writer\?\.tick\(t, d\); \}\}/);
  assert.match(player, /onPause=\{writer \? \(\) => \{ const \[t, d\] = at\(\); writer\.flush\(t, d\); \} : undefined\}/);
});

test('chapters: the current one is marked, and a click seeks', async () => {
  const item = { chapters: [{ start_seconds: 0, title: 'Intro' }, { start_seconds: 60, title: 'The script' }] };
  const seeks = [];
  const m = await mountContracts(h(Chapters, { item, now: 75, onSeek: (t) => seeks.push(t) }), '/learning');
  try {
    const buttons = m.nodes().filter((n) => n.tagName === 'BUTTON');
    assert.equal(buttons.length, 2);
    assert.equal(m.props(buttons[1])['aria-current'], 'true', 'the playing chapter is marked');
    assert.equal(m.props(buttons[0])['aria-current'], undefined);
    await m.click('00:00Intro');
    assert.deepEqual(seeks, [0]);
  } finally { await m.unmount(); }
  // A player that cannot be seeked draws text, not dead buttons.
  const still = html(h(Chapters, { item, now: 0, onSeek: null }));
  assert.doesNotMatch(still, /<button/);
  assert.match(still, /data-testid="text-chapter"/);
  assert.match(html(h(Chapters, { item: {}, now: 0 })), /data-testid="lesson-chapters-none"/);
});

test('transcript: the caption is read as cues, the current one marked, and a click seeks', async () => {
  const asked = [];
  const seeks = [];
  const video = { stream: READY, player: { src: TOKEN } };
  const m = await mountContracts(h(Transcript, { text: 'Plain text.', video, now: 5, onSeek: (t) => seeks.push(t), loadCaption: async (l) => { asked.push(l); return parseVtt(VTT); } }), '/learning');
  try {
    await m.flush();
    assert.deepEqual(asked, ['en'], 'the first ready caption is read');
    const cues = m.nodes().filter((n) => n.tagName === 'BUTTON');
    assert.equal(cues.length, 2);
    assert.equal(m.props(cues[1])['aria-current'], 'true');
    assert.doesNotMatch(m.text(), /Plain text\./, 'cues replace the plain text');
    await m.click('00:04Start with the problem.');
    assert.deepEqual(seeks, [4]);
    // Two languages: a picker, and choosing one reads it.
    await m.fill('Transcript language', 'fr');
    await m.flush();
    assert.deepEqual(asked, ['en', 'fr']);
  } finally { await m.unmount(); }
});

test('transcript: without cues the plain transcript says why; unreadable captions say so; none at all says none', async () => {
  const video = { stream: READY, player: { src: TOKEN } };
  const failed = await mountContracts(h(Transcript, { text: 'Plain text.', video, loadCaption: async () => { throw new Error('503'); } }), '/learning');
  try {
    await failed.flush();
    assert.ok(failed.text().includes(CUES_UNREADABLE));
    assert.ok(failed.text().includes('Plain text.'), 'a failed read is never an empty transcript');
  } finally { await failed.unmount(); }
  const noCaptions = html(h(Transcript, { text: 'Plain text.', video: { src: '/media/x', embed: false } }));
  assert.ok(noCaptions.includes(PLAIN_TRANSCRIPT_LINE));
  assert.ok(noCaptions.includes('Plain text.'));
  const nothing = html(h(Transcript, { text: '', video: { src: '/media/x', embed: false } }));
  assert.match(nothing, /No transcript is recorded for this video\./);
});

test('the caption read: a member route, parsed into cues; a reply in another shape is a failure, never no cues', async () => {
  const real = learningApi.itemCaption;
  try {
    learningApi.itemCaption = async (uid, lang) => { assert.deepEqual([uid, lang], ['vid-1', 'en']); return { language: 'en', vtt: VTT }; };
    assert.equal((await readItemCaption('vid-1', 'en')).length, 2);
    learningApi.itemCaption = async () => ({});
    await assert.rejects(() => readItemCaption('vid-1', 'en'));
  } finally { learningApi.itemCaption = real; }
  assert.match(read('lib/api/learning.js'), /itemCaption: \(uid, language\) => request\(`\/learning\/items\/\$\{encodeURIComponent\(uid\)\}\/captions\/\$\{encodeURIComponent\(language\)\}`\)/);
  const wired = read('pages/learning/LearningWired.jsx');
  assert.equal((wired.match(/loadCaption=\{/g) || []).length, 2, 'a lesson and a standalone video');
});

test('lr7 the hover preview: a ready video\'s signed preview, read once per video, and nothing otherwise', async () => {
  assert.equal(previewOf({ video_stream: READY }), READY.preview_url);
  assert.equal(previewOf({ video_stream: { state: 'processing' } }), null);
  assert.equal(previewOf({ video_stream: { ...READY, preview_url: 'https://evil.example/x.gif' } }), null);
  assert.equal(previewOf(null), null);
  const real = learningApi.item;
  let reads = 0;
  try {
    learningApi.item = async () => { reads += 1; return { item: { ...VIDEO, video_stream: READY } }; };
    assert.equal(await readItemPreview('vid-preview', 0), READY.preview_url);
    assert.equal(await readItemPreview('vid-preview', 1000), READY.preview_url);
    assert.equal(reads, 1, 'read once');
    learningApi.item = async () => { throw new Error('down'); };
    assert.equal(await readItemPreview('vid-down', 0), null, 'a failed read draws nothing');
  } finally { learningApi.item = real; }
  // Hidden until a pointer rests on the card, and never read by assistive technology.
  const m = html(h(HoverPreview, { uid: 'vid-1', read: async () => READY.preview_url }));
  assert.match(m, /aria-hidden="true"/);
  assert.doesNotMatch(m, /<img/);
  assert.match(read('pages/learning/LearningHome.jsx'), /row\.kind === 'video' && row\.uid \? <HoverPreview uid=\{row\.uid\} \/> : null/);
});

test('the layout: chapters beside the player on a wide screen, below it on a tablet or phone; the package is pinned exactly', () => {
  const m = html(h(LessonPlayer, { status: 'ready', lesson: null, item: VIDEO, video: videoPlayback({ ...VIDEO, video_stream: READY }) }));
  assert.match(m, /data-testid="lesson-player-layout" class="grid gap-4 lg:grid-cols-\[minmax\(0,1fr\)_18rem\] lg:items-start"|class="grid gap-4 lg:grid-cols-\[minmax\(0,1fr\)_18rem\] lg:items-start" data-testid="lesson-player-layout"/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.dependencies['@cloudflare/stream-react'], /^\d+\.\d+\.\d+$/, 'an exact pin');
});
