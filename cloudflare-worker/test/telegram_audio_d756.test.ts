/**
 * D756 (#1978) — a consented Telegram voice note, audio file or audio
 * document is stored and transcribed as recorder audio, through D754's shared
 * voice-note step (`ingestChannelAudio`, #1935): an R2 object under the
 * session, its speaker from its side, a receipt, then the engine. There is no
 * second path: Telegram's direct model call is gone.
 *
 * On the D684 harness (SQLite D1, `getFile` and the file server stubbed, FILES
 * in memory, every model call counted):
 *   · YES, then: one object under `validate-audio/`, the segment appended
 *     under the interviewee (or "Me"), the chat's text kept in the transcript
 *     and its mirror, `enqueueDigest` once;
 *   · no consent: no fetch; a declared 6 MB: no fetch; a round video: no fetch;
 *   · the day's cap: no model and nothing stored;
 *   · a 429 with `retry_after`: the next try waits at least that long;
 *   · the wrong member: nothing fetched;
 *   · two notes at once: two `seq`, no overwrite;
 *   · no `expired` for Telegram: an old note is still fetched;
 *   · deleted at the source before the download: dropped; after: kept;
 *   · ignoring the chat or disconnecting Telegram leaves the stored audio;
 *     deleting the session removes it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/telegram_audio_d756.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { CHANNEL_LIMITS } from '../src/services/channels/types.ts';
import { deleteSession, loadSession } from '../src/services/interviewSessions.ts';
import { DEFAULT_FINAL_MODEL } from '../src/services/sttModels.ts';
import {
  AUDIO, businessMessage, call, consentGiven, count, ids, INTERVIEW, ME, mockFetch, noSecretsSeen, now, OTHER, type Route, seen,
  telegramApi, TG_ME, TG_OTHER, tgHook, world,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const MB = 1024 * 1024;

/** Telegram with one file per id: getFile names a path per id, the file server serves its bytes. */
function files(map: Record<string, { bytes?: Uint8Array; size?: number; status?: number; json?: unknown }>): Route {
  return (url, init) => {
    if (url.pathname.endsWith('/getFile')) {
      const id = String(JSON.parse(String(init.body)).file_id);
      const f = map[id];
      if (f?.json) return { status: f.status ?? 200, json: f.json };
      if (f) return { json: { ok: true, result: { file_id: id, file_size: f.size ?? 4000, file_path: `voice/${id}.oga` } } };
    }
    const m = /\/file\/bot[^/]+\/voice\/(.+)\.oga$/.exec(url.pathname);
    if (m && map[m[1]]) return { body: map[m[1]].bytes ?? AUDIO.OGG, headers: { 'content-type': 'application/octet-stream' } };
    return telegramApi(url, init);
  };
}
const fetched = (f: { calls: { url: string }[] }) => f.calls.filter((c) => c.url.includes('/getFile') || c.url.includes('/file/bot')).length;

/** A Telegram chat in an interview, the interviewee's YES given, its text moved. */
async function consentedChat(w: any, chat = 8001) {
  await tgHook(w.env, businessMessage('BC-ME', { chat, text: 'We reconcile invoices by hand every Friday.' }));
  const [t] = (await call(w.env, ME, 'GET', '/threads?status=pending')).body.items;
  const a = await call(w.env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  await consentGiven(w.env, w.db, t.uid);
  const s = w.db.prepare('SELECT id, uid FROM interview_sessions WHERE id = ?').get(Number(a.body.session_id));
  return { thread: t.uid as string, sessionId: Number(s.id), sessionUid: String(s.uid) };
}
const voiceJobs = (queued: any[]) => queued.filter((j) => j.job_type === 'channel_followup' && j.payload?.kind === 'voice');
const lastVoiceJob = (queued: any[]) => voiceJobs(queued).at(-1);
const digests = (queued: any[]) => queued.filter((j) => j.job_type === 'session_structure' && j.payload?.trigger === 'voice_note_added');
const segments = (db: any, sessionId: number) => db.prepare('SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(sessionId)
  .map((s: any) => [s.speaker_label, s.text]);
const chunkRows = (db: any, sessionId: number) => db.prepare('SELECT seq, r2_key, mime FROM interview_session_chunks WHERE session_id = ? ORDER BY seq').all(sessionId);
const waiting = (db: any) => count(db, 'SELECT COUNT(*) n FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL');
const noteErrors = (db: any) => db.prepare('SELECT transcribe_error AS e FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL ORDER BY id').all().map((r: any) => r.e);
const run = (w: any) => runChannelJob(w.env, 'channel_followup', lastVoiceJob(w.queued).payload);

test('D756 #1978 YES, then: an R2 object under the session, appended under its side, the chat text kept, the engine once', async () => {
  const w: any = await world({ seed: true });
  const { sessionId, sessionUid } = await consentedChat(w);
  const before = digests(w.queued).length;
  const f = mockFetch(files({ CONTACT: {}, OWNER: { bytes: AUDIO.MP3_ID3 } }));
  try {
    await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'CONTACT', mime_type: 'audio/ogg', duration: 4 } }));
    await run(w);
    await tgHook(w.env, businessMessage('BC-ME', { from: Number(TG_ME), audio: { file_id: 'OWNER', mime_type: 'audio/mpeg', duration: 9 } }));
    await run(w);
  } finally { f.restore(); }

  const rows = chunkRows(w.db, sessionId);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.match(r.r2_key, new RegExp(`^validate-audio/${ME}/sessions/${sessionUid}/\\d{6,}\\.(ogg|mp3)$`));
  assert.deepEqual([...w.r2.objects.keys()].sort(), rows.map((r: any) => r.r2_key).sort(), 'one object per note, under the prefix');
  assert.deepEqual(rows.map((r: any) => w.r2.objects.get(r.r2_key).customMetadata.side), ['contact', 'me']);
  assert.deepEqual(segments(w.db, sessionId), [
    ['Dana Ruiz', 'We reconcile invoices by hand every Friday.'],
    ['Dana Ruiz', 'We lose a whole day every month to this.'],
    ['Me', 'We lose a whole day every month to this.'],
  ], 'appended after the chat text, the speaker from the side, never "Speaker ?"');
  const mirror = String(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript);
  assert.match(mirror, /^We reconcile invoices by hand every Friday\.\n/, 'the chat text is still in the transcript');
  const receipts = w.db.prepare('SELECT kind, model, outcome FROM interview_session_receipts WHERE session_id = ?').all(sessionId);
  assert.deepEqual(receipts.map((r: any) => [r.kind, r.model, r.outcome]), [['final', DEFAULT_FINAL_MODEL, 'ok'], ['final', DEFAULT_FINAL_MODEL, 'ok']]);
  assert.equal(w.aiCalls.length, 2);
  assert.equal(digests(w.queued).length - before, 2, 'enqueueDigest once per note');
  assert.equal(waiting(w.db), 0);
});

test('D756 #1978 no YES, a declared 6 MB, or a round video: nothing is fetched', async () => {
  const w: any = await world({ seed: true });
  const { thread, sessionId } = await consentedChat(w);
  const f = mockFetch(files({ BIG: {}, ROUND: {}, NOYES: {} }));
  try {
    await tgHook(w.env, businessMessage('BC-ME', { audio: { file_id: 'BIG', mime_type: 'audio/mpeg', file_size: 6 * MB } }));
    await run(w);
    await tgHook(w.env, businessMessage('BC-ME', { video_note: { file_id: 'ROUND', duration: 8, length: 384 } }));
    await run(w);
    await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'NOYES', mime_type: 'audio/ogg' } }));
    w.db.prepare(`UPDATE channel_threads SET consent_state = 'withdrawn' WHERE uid = ?`).run(thread);
    await run(w);
    assert.equal(fetched(f), 0, 'no getFile and no download');
  } finally { f.restore(); }
  assert.deepEqual(noteErrors(w.db), ['too_large', 'video_note_unsupported', 'no_consent']);
  assert.equal(w.r2.objects.size, 0);
  assert.equal(chunkRows(w.db, sessionId).length, 0);
  assert.equal(w.aiCalls.length, 0);
});

test('D756 #1978 the day\'s cap: no model and nothing stored; a 429 with retry_after waits at least that long', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  const integration = w.db.prepare(`SELECT id FROM integrations WHERE uid = 'tg-me'`).get().id;
  w.db.prepare(`INSERT INTO channel_counters (integration_id, counter, window_start, n) VALUES (?, 'transcriptions_day', date('now'), ?)`)
    .run(integration, CHANNEL_LIMITS.transcriptionsPerDay);
  const f = mockFetch(files({ CAP: {}, SLOW: { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1200 } } } }));
  try {
    await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'CAP', mime_type: 'audio/ogg' } }));
    await run(w);
    assert.equal(w.r2.objects.size, 0, 'nothing stored over the cap');
    assert.equal(w.aiCalls.length, 0);

    await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'SLOW', mime_type: 'audio/ogg' } }));
    const jobsBefore = voiceJobs(w.queued).length;
    await run(w);
    assert.equal(voiceJobs(w.queued).length, jobsBefore + 1, 'the job queued its own next try');
    const opts = w.queuedOpts[w.queued.lastIndexOf(lastVoiceJob(w.queued))];
    assert.ok(Number(opts?.delaySeconds) >= 1200, `waits retry_after (${opts?.delaySeconds}s)`);
  } finally { f.restore(); }
  assert.deepEqual(noteErrors(w.db), ['transcription_cap', 'provider_unreachable']);
  assert.equal(chunkRows(w.db, sessionId).length, 0);
});

test('D756 #1978 the wrong member: a note on a thread another member holds is never fetched', async () => {
  const w: any = await world({ seed: true });
  const { thread } = await consentedChat(w);
  await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'THEIRS', mime_type: 'audio/ogg' } }));
  // The thread now sits on another member's Telegram connection.
  const theirs = w.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id, external_account_name, config_json)
                               VALUES ('tg-other', ?, 'telegram', 'webhook', ?, '@other', '{}')`).run(OTHER, TG_OTHER).lastInsertRowid;
  w.db.prepare('UPDATE channel_threads SET integration_id = ? WHERE uid = ?').run(Number(theirs), thread);
  const f = mockFetch(files({ THEIRS: {} }));
  try {
    await run(w);
    assert.equal(fetched(f), 0);
  } finally { f.restore(); }
  assert.equal(w.r2.objects.size, 0);
  assert.equal(w.aiCalls.length, 0);
});

test('D756 #1978 two notes at once get two seq and two objects; an old note is still fetched (no expired for Telegram)', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  const f = mockFetch(files({ ONE: {}, TWO: { bytes: AUDIO.WAV }, OLD: {} }));
  try {
    await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'ONE', mime_type: 'audio/ogg' } }));
    await tgHook(w.env, businessMessage('BC-ME', { audio: { file_id: 'TWO', mime_type: 'audio/wav' } }));
    const [a, b] = voiceJobs(w.queued).slice(-2);
    // Both downloads are held until both are asked for, so both jobs reach the shared step together.
    const inner = globalThis.fetch;
    let asked = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      if (String(typeof input === 'string' ? input : input.url).includes('/file/bot')) { if (++asked === 2) release(); await both; }
      return inner(input, init);
    }) as typeof fetch;
    try {
      await Promise.all([runChannelJob(w.env, 'channel_followup', a.payload), runChannelJob(w.env, 'channel_followup', b.payload)]);
    } finally { globalThis.fetch = inner; }
    assert.equal(asked, 2);
    const rows = chunkRows(w.db, sessionId);
    assert.equal(new Set(rows.map((r: any) => r.seq)).size, 2);
    assert.equal(w.r2.objects.size, 2, 'no overwrite');

    // Sent 30 days ago: Telegram documents no file_id expiry, so it is fetched like any other.
    const old = businessMessage('BC-ME', { voice: { file_id: 'OLD', mime_type: 'audio/ogg' } }) as any;
    old.business_message.date = now() - 30 * 86_400;
    await tgHook(w.env, old);
    await run(w);
  } finally { f.restore(); }
  assert.equal(chunkRows(w.db, sessionId).length, 3);
  assert.equal(w.r2.objects.size, 3);
  assert.equal(waiting(w.db), 0, 'nothing marked expired');
});

test('D756 #1978 deleted at the source: before the download it is dropped; after the import it is kept', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await consentedChat(w);
  const f = mockFetch(files({ GONE: {}, KEPT: {} }));
  const del = (id: number) => tgHook(w.env, { update_id: ++ids.update, deleted_business_messages: { business_connection_id: 'BC-ME', chat: { id: 8001, type: 'private' }, message_ids: [id] } });
  try {
    await tgHook(w.env, businessMessage('BC-ME', { id: 9101, voice: { file_id: 'GONE', mime_type: 'audio/ogg' } }));
    await del(9101);
    await run(w);
    assert.equal(fetched(f), 0, 'dropped before any download');

    await tgHook(w.env, businessMessage('BC-ME', { id: 9102, voice: { file_id: 'KEPT', mime_type: 'audio/ogg' } }));
    await run(w);
    await del(9102);
  } finally { f.restore(); }
  assert.equal(w.r2.objects.size, 1, 'the imported note stays');
  assert.equal(segments(w.db, sessionId).length, 2, 'and so does its transcript');
});

test('D756 #1978 ignoring the chat or disconnecting Telegram keeps the stored audio; deleting the session removes it', async () => {
  const w: any = await world({ seed: true });
  const { thread, sessionId } = await consentedChat(w);
  const f = mockFetch(files({ STAY: {} }));
  try {
    await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'STAY', mime_type: 'audio/ogg' } }));
    await run(w);
    assert.equal(w.r2.objects.size, 1);
    await call(w.env, ME, 'POST', `/threads/${thread}/ignore`, {});
    assert.equal(w.r2.objects.size, 1, 'ignoring the chat keeps it');
    await call(w.env, ME, 'DELETE', '/telegram');
    assert.equal(w.r2.objects.size, 1, 'disconnecting keeps it');
  } finally { f.restore(); }
  const { keys } = await deleteSession(w.env, (await loadSession(w.env, sessionId))!, ME);
  assert.equal(keys.length, 1);
  assert.equal(w.r2.objects.size, 0, 'the audio goes with the session');
});

test('D756 #1978 source: one path for both providers, no direct model call, no WhatsApp-only branch in the shared step', () => {
  const route = read('../src/routes/channels.ts');
  const job = route.slice(route.indexOf('export async function runVoiceFollowup('), route.indexOf('export async function runConsentFollowup('));
  assert.ok(job.includes('ingestChannelAudio('));
  assert.equal(/\baiRun\(|storeVoiceTranscript\(/.test(job), false, 'the voice job calls no model and stores no text-only transcript');
  assert.equal(/provider === 'whatsapp'\) \{/.test(job), false, 'no WhatsApp-only branch around the shared step');
  const audio = read('../src/services/channels/channelAudio.ts');
  assert.equal(/'whatsapp'|'telegram'/.test(audio.slice(audio.indexOf('export async function ingestChannelAudio('))), false, 'the shared step names no provider');
  assert.equal(/never stored/.test(route.slice(0, route.indexOf('import '))), false, 'the header no longer says the audio is never stored');
});
