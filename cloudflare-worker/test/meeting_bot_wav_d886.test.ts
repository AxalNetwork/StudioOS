/**
 * D886 B2 (#2580): the Worker admits the meeting bot's audio chunks exactly
 * as it admits a D872 upload part. The bot's encoder lives in
 * `meeting-bot/src/wav.ts`; this holds it to the Worker's own `isUploadWav`,
 * so a change on either side that breaks the other fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUploadWav } from '../src/services/interviewSessions';
import { Chunker, encodeWav } from '../../meeting-bot/src/wav.ts';

test('every chunk of a call, the partial last one included, is a WAV the chunk route admits', () => {
  const c = new Chunker();
  const parts = [...c.push(new Int16Array(16000 * 61).fill(1200)), c.flush()!];
  assert.equal(parts.length, 3);
  for (const p of parts) assert.equal(isUploadWav(p.wav), true, `seq ${p.seq}`);
  assert.equal(isUploadWav(encodeWav(new Int16Array(160), 48000)), false, 'a rate other than 16 kHz is refused');
  assert.equal(isUploadWav(encodeWav(new Int16Array(0))), false, 'an empty part is refused');
});
