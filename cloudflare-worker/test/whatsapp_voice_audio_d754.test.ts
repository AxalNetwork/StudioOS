/**
 * D754 W3 (#1935) — a consented WhatsApp voice note is kept and transcribed as
 * the recorder's audio is, appended to the chat's session, then the engine.
 *
 * What these prove, on the D684 harness (SQLite D1, Graph stubbed, FILES in
 * memory, every model call counted):
 *   · consent given: one note is one R2 object under `validate-audio/`, one
 *     chunk row, one receipt line; its segment is APPENDED under the
 *     interviewee's label, the chat's text stays in the transcript and its
 *     mirror, and the placeholder goes; since D765 no digest is queued;
 *   · no consent: no download, no object, and the note waits;
 *   · two notes racing on one session get two `seq` and two objects; one
 *     note's job run twice at once appends once;
 *   · a declared size over 5 MB or a declared type the recorder does not take
 *     downloads nothing, and the reason is kept on the note;
 *   · the one model call is the recorder's own per-chunk stage;
 *   · the sweeper resumes a chat session's stuck chunk in voice-note mode;
 *   · deleting the session removes its R2 keys.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/whatsapp_voice_audio_d754.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { deleteSession, loadSession } from '../src/services/interviewSessions.ts';
import { recoverSession, runInterviewProcessJob } from '../src/services/interviewProcessing.ts';
import { sweepInterviewSessions } from '../src/services/sessionSweeper.ts';
import { DEFAULT_FINAL_MODEL } from '../src/services/sttModels.ts';
import { GUARD_MODEL } from './_guard_stub.mjs';
import {
  AUDIO, call, consentGiven, count, INTERVIEW, ME, mockFetch, noSecretsSeen, now, PNID, type Route, seen,
  WA_CUSTOMER, waHook, waPayload, waText, world,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const MB5 = 5 * 1024 * 1024;

/** Graph and Meta's media host, one file per media id. */
function graph(files: Record<string, { bytes?: Uint8Array; size?: number; mime?: string }>): Route {
  return (url) => {
    if (url.hostname === 'graph.facebook.com') {
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      const f = files[id];
      if (f) return { json: { url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${id}`, mime_type: f.mime ?? 'audio/ogg', file_size: f.size ?? 4000, id } };
    }
    if (url.hostname === 'lookaside.fbsbx.com') {
      const f = files[url.searchParams.get('mid') ?? ''];
      if (f) return { body: f.bytes ?? AUDIO.OGG, headers: { 'content-type': 'application/octet-stream' } };
    }
    return undefined;
  };
}

/** A WhatsApp chat in an interview, its consent given, its text moved. */
async function consentedChat(w: any) {
  await waHook(w.env, waText(PNID, 'wamid.T1', 'We close the books by hand every month.'));
  const [t] = (await call(w.env, ME, 'GET', '/threads')).body.items;
  const a = await call(w.env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  await consentGiven(w.env, w.db, t.uid);
  const session = w.db.prepare('SELECT id, uid FROM interview_sessions WHERE id = ?').get(Number(a.body.session_id));
  return { thread: t.uid as string, sessionId: Number(session.id), sessionUid: String(session.uid) };
}
async function voiceNote(w: any, wamid: string, mediaId: string, mime = 'audio/ogg; codecs=opus') {
  await waHook(w.env, waPayload(PNID, {
    contacts: [{ profile: { name: 'Priya Shah' }, wa_id: WA_CUSTOMER }],
    messages: [{ from: WA_CUSTOMER, id: wamid, timestamp: String(now()), type: 'audio', audio: { id: mediaId, mime_type: mime, voice: true } }],
  }));
}
const voiceJobs = (queued: any[]) => queued.filter((j) => j.job_type === 'channel_followup' && j.payload?.kind === 'voice');
const lastVoiceJob = (queued: any[]) => voiceJobs(queued).at(-1);
const digests = (queued: any[], trigger = 'voice_note_added') => queued.filter((j) => j.job_type === 'session_structure' && j.payload?.trigger === trigger);
const segments = (db: any, sessionId: number) => db.prepare('SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(sessionId)
  .map((s: any) => [s.speaker_label, s.text]);
const chunks = (db: any, sessionId: number) => db.prepare('SELECT seq, r2_key, mime, size_bytes FROM interview_session_chunks WHERE session_id = ? ORDER BY seq').all(sessionId);
const noteErrors = (db: any) => db.prepare('SELECT transcribe_error AS e FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL ORDER BY id').all().map((r: any) => r.e);

test('D754 W3 consent given: one R2 object, one chunk, one receipt; appended after the chat\'s text; placeholder gone; the engine once', async () => {
  const w: any = await world({ seed: true });
  const { sessionId, sessionUid } = await consentedChat(w);
  const textSegments = segments(w.db, sessionId);
  assert.equal(textSegments.length, 1, 'the chat text moved on consent');
  const before = digests(w.queued).length;
  await voiceNote(w, 'wamid.V1', 'MEDIA-1');
  const f = mockFetch(graph({ 'MEDIA-1': {} }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
  } finally { f.restore(); }

  const rows = chunks(w.db, sessionId);
  assert.equal(rows.length, 1, 'one chunk row');
  const placeholderId = rows[0].seq;
  assert.ok(Number.isSafeInteger(placeholderId) && placeholderId > 0, 'the seq is the note\'s own message id');
  assert.match(rows[0].r2_key, new RegExp(`^validate-audio/${ME}/sessions/${sessionUid}/\\d{6,}\\.ogg$`));
  assert.deepEqual([rows[0].mime, rows[0].size_bytes], ['audio/ogg', AUDIO.OGG.byteLength]);
  assert.deepEqual([...w.r2.objects.keys()], [rows[0].r2_key], 'one R2 object, under the prefix');
  assert.deepEqual(w.r2.objects.get(rows[0].r2_key).customMetadata.side, 'contact');

  const receipts = w.db.prepare(`SELECT kind, model, outcome FROM interview_session_receipts WHERE session_id = ?`).all(sessionId);
  assert.deepEqual(receipts.map((r: any) => [r.kind, r.model, r.outcome]), [['final', DEFAULT_FINAL_MODEL, 'ok']]);
  assert.equal(count(w.db, 'SELECT COUNT(*) n FROM interview_chunk_transcripts WHERE session_id = ?', sessionId), 1, 'staged once');

  const all = segments(w.db, sessionId);
  assert.deepEqual(all.slice(0, 1), textSegments, 'the chat\'s text is kept, never replaced');
  assert.deepEqual(all.slice(1), [[textSegments[0][0], 'We lose a whole day every month to this.']], 'appended under the interviewee\'s label');
  const mirror = String(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript);
  assert.match(mirror, /We close the books by hand every month\.\nWe lose a whole day every month to this\./);
  assert.equal(count(w.db, 'SELECT COUNT(*) n FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL'), 0, 'the placeholder went with the append');

  const s = w.db.prepare('SELECT processing_auto, processing_stage, digest_status FROM interview_sessions WHERE id = ?').get(sessionId);
  // D765 (#2090), D720 §6: transcribed, and no summary is queued; the founder presses it.
  assert.deepEqual([s.processing_auto, s.processing_stage, s.digest_status], [0, 'done', null]);
  assert.equal(digests(w.queued).length - before, 0, 'no digest is queued');
  assert.equal(w.aiCalls.length, 1);

  // The webhook's event is done, recorded in the same batch.
  assert.equal(w.db.prepare(`SELECT status FROM channel_events WHERE kind = 'voice' ORDER BY id DESC LIMIT 1`).get().status, 'done');
  // A redelivered job finds no note and does nothing.
  await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
  assert.equal(w.aiCalls.length, 1);
  assert.equal(segments(w.db, sessionId).length, 2);
});

test('D754 W3 no consent: no download, no object, and the note waits', async () => {
  const w: any = await world({ seed: true });
  const { thread, sessionId } = await consentedChat(w);
  await voiceNote(w, 'wamid.V2', 'MEDIA-2');
  w.db.prepare(`UPDATE channel_threads SET consent_state = 'withdrawn' WHERE uid = ?`).run(thread);
  const f = mockFetch(graph({ 'MEDIA-2': {} }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
    assert.equal(f.calls.length, 0, 'not even the lookup');
  } finally { f.restore(); }
  assert.equal(w.r2.objects.size, 0);
  assert.equal(chunks(w.db, sessionId).length, 0);
  assert.deepEqual(noteErrors(w.db), ['no_consent']);
  assert.equal(w.aiCalls.length, 0);
});

test('D754 W3 racing: two notes get two seq and two objects; one note\'s job twice at once appends once', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  await voiceNote(w, 'wamid.R1', 'MEDIA-R1');
  await voiceNote(w, 'wamid.R2', 'MEDIA-R2', 'audio/mpeg');
  const [a, b] = voiceJobs(w.queued).slice(-2);
  const f = mockFetch(graph({ 'MEDIA-R1': {}, 'MEDIA-R2': { bytes: AUDIO.MP3_ID3, mime: 'audio/mpeg' } }));
  try {
    await Promise.all([runChannelJob(w.env, 'channel_followup', a.payload), runChannelJob(w.env, 'channel_followup', b.payload)]);
  } finally { f.restore(); }
  const rows = chunks(w.db, sessionId);
  assert.equal(new Set(rows.map((r: any) => r.seq)).size, 2, 'two distinct seq');
  assert.equal(w.r2.objects.size, 2, 'two objects, none overwritten');
  assert.deepEqual(rows.map((r: any) => r.mime).sort(), ['audio/mpeg', 'audio/ogg']);
  assert.equal(segments(w.db, sessionId).length, 3, 'the text and two notes');

  await voiceNote(w, 'wamid.R3', 'MEDIA-R3');
  const job = lastVoiceJob(w.queued);
  // Both runs are held inside the model until both have arrived, so both pass every check before either appends.
  // Llama Guard's own calls (D763, inside run()) pass straight through: only the transcription is counted and held.
  const run = w.env.AI.run;
  let arrived = 0;
  let release!: () => void;
  const both = new Promise<void>((resolve) => { release = resolve; });
  w.env.AI.run = async (model: string, input: any) => {
    if (model === GUARD_MODEL) return run(model, input);
    if (++arrived === 2) release();
    await both;
    return run(model, input);
  };
  const g = mockFetch(graph({ 'MEDIA-R3': {} }));
  try {
    await Promise.all([runChannelJob(w.env, 'channel_followup', job.payload), runChannelJob(w.env, 'channel_followup', job.payload)]);
  } finally { g.restore(); w.env.AI.run = run; }
  assert.equal(arrived, 2, 'both runs transcribed it');
  assert.equal(segments(w.db, sessionId).length, 4, 'appended once: the second batch fails on the staged row and rolls back');
  assert.equal(chunks(w.db, sessionId).length, 3);
  assert.equal(count(w.db, 'SELECT COUNT(*) n FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL'), 0);
});

test('D754 W3 a declared size over 5 MB or an unadmitted declared type downloads nothing, and the note says why', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  await voiceNote(w, 'wamid.BIG', 'MEDIA-BIG');
  let f = mockFetch(graph({ 'MEDIA-BIG': { size: MB5 + 1 } }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
    assert.deepEqual(f.calls.map((c) => new URL(c.url).hostname), ['graph.facebook.com'], 'the lookup only');
  } finally { f.restore(); }
  await voiceNote(w, 'wamid.AAC', 'MEDIA-AAC', 'audio/aac');
  f = mockFetch(graph({ 'MEDIA-AAC': {} }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
    assert.equal(f.calls.length, 0, 'no call at all');
  } finally { f.restore(); }
  await voiceNote(w, 'wamid.JUNK', 'MEDIA-JUNK');
  f = mockFetch(graph({ 'MEDIA-JUNK': { bytes: AUDIO.JUNK } }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
  } finally { f.restore(); }
  assert.deepEqual(noteErrors(w.db), ['too_large', 'unsupported_format', 'unsupported_format']);
  assert.equal(w.r2.objects.size, 0);
  assert.equal(chunks(w.db, sessionId).length, 0);
  assert.equal(w.aiCalls.length, 0);
  assert.equal(Number(w.db.prepare(`SELECT COALESCE(SUM(n), 0) AS n FROM channel_counters WHERE counter = 'transcriptions_day'`).get().n), 0, 'no day\'s cap taken');
});

test('D754 W3 the one model call is the recorder\'s per-chunk stage; no direct call, structure or summary per note', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  await voiceNote(w, 'wamid.M1', 'MEDIA-M1');
  const f = mockFetch(graph({ 'MEDIA-M1': {} }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
  } finally { f.restore(); }
  assert.equal(w.aiCalls.length, 1);
  assert.equal(w.aiCalls[0].model, DEFAULT_FINAL_MODEL, 'the session\'s final model, the recorder\'s default for a chat');
  assert.ok(w.aiCalls[0].input.audio, 'audio, from the stored chunk');
  assert.equal(w.db.prepare('SELECT digest_status FROM interview_sessions WHERE id = ?').get(sessionId).digest_status, null, 'D765: no summary is queued, and none runs');

  // D754 §6: a note is ONE final segment under its speaker, however many the model returned.
  const run = w.env.AI.run;
  w.env.AI.run = async (model: string, input: any) => {
    w.aiCalls.push({ model, input });
    return { text: 'First part. Second part.', transcription_info: { language: 'en' }, segments: [{ start: 0, end: 1, text: 'First part.' }, { start: 1, end: 2, text: 'Second part.' }] };
  };
  await voiceNote(w, 'wamid.M2', 'MEDIA-M2');
  const g = mockFetch(graph({ 'MEDIA-M2': {} }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
  } finally { g.restore(); w.env.AI.run = run; }
  const last = w.db.prepare('SELECT speaker_label, text, start_ms, end_ms FROM interview_transcript_segments WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId);
  assert.deepEqual([last.text, last.start_ms, last.end_ms], ['First part. Second part.', null, null]);
  assert.equal(segments(w.db, sessionId).length, 3, 'the text and two notes, one segment each');

  const route = read('../src/routes/channels.ts');
  const branch = route.slice(route.indexOf("if (provider === 'whatsapp') {"), route.indexOf('const r = await aiRun(env, {'));
  assert.ok(branch.includes('ingestChannelAudio('), 'the WhatsApp branch hands the bytes to the shared step');
  assert.ok(branch.includes('return;'), 'and returns before the direct model call');
  const audio = read('../src/services/channels/channelAudio.ts');
  for (const banned of ['aiRun', 'structureSession', 'summariseSession', 'replaceWithFinal', 'digestSession']) {
    assert.equal(new RegExp(`\\b${banned}\\(`).test(audio), false, `channelAudio.ts calls ${banned}`);
  }
  const proc = read('../src/services/interviewProcessing.ts');
  const mode = proc.slice(proc.indexOf('export async function transcribeVoiceNote('), proc.indexOf('// The summary (shared'));
  assert.ok(mode.includes('appendSegments(') && mode.includes('transcribeChunk('));
  for (const banned of ['replaceWithFinal', 'digestSession', 'summariseSession', 'aiRun']) {
    assert.equal(new RegExp(`\\b${banned}\\(`).test(mode), false, `voice-note mode calls ${banned}`);
  }
  assert.equal(mode.includes('enqueueDigest('), false, 'D765: a voice note queues no digest');
});

test('D754 W3 recovery: the sweeper resumes a chat session\'s stuck chunk in voice-note mode; a chat with no chunk is refused', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  await voiceNote(w, 'wamid.S1', 'MEDIA-S1');
  // The job dies after the chunk is stored: the append's batch fails once.
  w.db.exec(`CREATE TRIGGER fail_append BEFORE INSERT ON interview_transcript_segments BEGIN SELECT RAISE(ABORT, 'd1 hiccup'); END;`);
  const f = mockFetch(graph({ 'MEDIA-S1': {} }));
  try {
    await assert.rejects(runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload));
  } finally { f.restore(); }
  w.db.exec('DROP TRIGGER fail_append');
  assert.equal(chunks(w.db, sessionId).length, 1, 'the chunk is stored');
  assert.equal(segments(w.db, sessionId).length, 1, 'nothing appended');
  assert.equal(count(w.db, 'SELECT COUNT(*) n FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL'), 1, 'the note still waits');
  assert.equal(w.db.prepare('SELECT processing_stage FROM interview_sessions WHERE id = ?').get(sessionId).processing_stage, 'transcribing');

  w.db.prepare(`UPDATE interview_sessions SET processing_updated_at = datetime('now', '-20 minutes') WHERE id = ?`).run(sessionId);
  const swept = await sweepInterviewSessions(w.env);
  assert.equal(swept.recovered, 1);
  assert.equal(w.db.prepare('SELECT processing_stage FROM interview_sessions WHERE id = ?').get(sessionId).processing_stage, 'transcribing',
    'a chat resumes at its notes, never at the summary');
  const job = w.queued.filter((j: any) => j.job_type === 'interview_process').at(-1);
  assert.ok(job, 'a voice-note run is queued');
  const before = digests(w.queued).length;
  assert.equal(await runInterviewProcessJob(w.env, job.payload), 'done');
  assert.deepEqual(segments(w.db, sessionId).at(-1), [segments(w.db, sessionId)[0][0], 'We lose a whole day every month to this.']);
  assert.equal(segments(w.db, sessionId).length, 2, 'appended, the chat text kept');
  assert.equal(count(w.db, 'SELECT COUNT(*) n FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL'), 0, 'its placeholder went with it');
  const s = w.db.prepare('SELECT processing_stage, processing_auto FROM interview_sessions WHERE id = ?').get(sessionId);
  assert.deepEqual([s.processing_stage, s.processing_auto], ['done', 0]);
  assert.equal(digests(w.queued).length - before, 0, 'D765: no digest is queued');

  // A chat session with no chunk has nothing to resume.
  const other: any = await world({ seed: true });
  const { sessionId: bare } = await consentedChat(other);
  other.db.prepare(`UPDATE interview_sessions SET processing_stage = 'failed' WHERE id = ?`).run(bare);
  const out = await recoverSession(other.env, (await loadSession(other.env, bare))!, ME);
  assert.deepEqual(out.ok ? null : out.detail, 'no_audio_on_this_channel');
});

test('D754 W3 deleting the session removes its R2 keys', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  await voiceNote(w, 'wamid.D1', 'MEDIA-D1');
  const f = mockFetch(graph({ 'MEDIA-D1': {} }));
  try {
    await runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);
  } finally { f.restore(); }
  assert.equal(w.r2.objects.size, 1);
  const { keys } = await deleteSession(w.env, (await loadSession(w.env, sessionId))!, ME);
  assert.equal(keys.length, 1);
  assert.equal(w.r2.objects.size, 0, 'the audio went with the session');
});
