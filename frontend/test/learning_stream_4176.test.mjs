// #4176 (D4176, part 1 of #3726) — the player's Stream branch and the Super Admin's Stream client.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_stream_4176.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STREAM_FAILED, STREAM_PROCESSING, videoPlayback } from '../src/pages/learning/learningModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const VIDEO = { uid: 'vid-1', kind: 'video', video_source: 'url', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
const READY = {
  state: 'ready', iframe_url: 'https://customer-abc123.cloudflarestream.com/tok-1/iframe', hls_url: 'https://customer-abc123.cloudflarestream.com/tok-1/manifest/video.m3u8',
  poster_url: 'https://customer-abc123.cloudflarestream.com/tok-1/thumbnails/thumbnail.jpg', captions: [{ language: 'en', label: 'English' }], duration_seconds: 252,
};

test('a ready Stream video plays first, in Stream\'s own iframe; processing and failed say so in the canvas\'s words', () => {
  // Mutation checked: drop the video_stream branch → the YouTube link plays instead and this fails.
  const ready = videoPlayback({ ...VIDEO, video_stream: READY });
  assert.equal(ready.embed, true);
  assert.equal(ready.src, READY.iframe_url);
  assert.deepEqual(ready.stream.captions, [{ language: 'en', label: 'English' }]);
  assert.deepEqual(videoPlayback({ ...VIDEO, video_stream: { state: 'processing' } }), { reason: STREAM_PROCESSING });
  assert.equal(STREAM_PROCESSING, 'This video is still processing.');
  assert.deepEqual(videoPlayback({ ...VIDEO, video_stream: { state: 'error' } }), { reason: STREAM_FAILED });
  assert.equal(STREAM_FAILED, 'This video could not be processed. Ask HQ to upload it again.');
  assert.match(videoPlayback({ ...VIDEO, video_stream: null }).src, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/, 'no Stream video: the link plays as before');
  // Mutation checked: drop the host check → a foreign iframe is embedded and this fails.
  const foreign = videoPlayback({ ...VIDEO, video_stream: { ...READY, iframe_url: 'https://evil.example/tok/iframe' } });
  assert.ok(foreign.reason && !foreign.src, 'only Stream\'s own hosts are embedded');
});

test('the Super Admin\'s Stream client calls the Stream routes', () => {
  const client = read('frontend/src/lib/api/adminLearning.js');
  for (const [m, path] of [
    ['startStreamUpload', '/stream/uploads`'], ['streamTusEndpoint', '/stream/uploads/tus`'], ['streamStatus', '/stream`'],
    ['abandonStreamUpload', '/abandon`'], ['generateCaptions', '/stream/captions/generate`'], ['uploadCaptions', '/stream/captions/${enc(language)}`'],
    ['deleteCaptions', '/stream/captions/${enc(language)}`'], ['setStreamThumbnail', '/stream/thumbnail`'],
  ]) {
    const line = client.split('\n').find((l) => l.trimStart().startsWith(`${m}:`));
    assert.ok(line, m);
    assert.ok(client.slice(client.indexOf(`${m}:`), client.indexOf(`${m}:`) + 260).includes(path), `${m} → ${path}`);
  }
});
