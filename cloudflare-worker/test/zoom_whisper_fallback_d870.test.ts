/**
 * D870 (#2517) — a Zoom call with no native transcript: its authorized
 * audio-only recording, cut into chunks within Workers limits and transcribed
 * by Workers AI Whisper on the AI token ledger.
 *
 *  1. The source: the VTT for an English or unknown-language call, the M4A
 *     otherwise or when there is no VTT, waiting while a file is processed,
 *     and nothing with the reason.
 *  2. The M4A: the audio track's samples are read wherever its index sits and
 *     beside a video track, malformed files are refused, and each chunk is a
 *     complete M4A holding exactly its samples, within the byte and time
 *     bounds, end to end.
 *  3. A call with only an M4A imports as Whisper text: offsets on one
 *     timeline, "Speaker ?", transcript_source 'whisper', its charge on the
 *     ledger, and the chunks in R2 under the call's session.
 *  4. A call with a VTT imports as today, with transcript_source 'native' and
 *     no AI call.
 *  5. A Spanish call with an English VTT takes Whisper, in Spanish, once the
 *     founder sets Spanish; the language reaches a restarted call's instance.
 *  6. A long call continues on the queue a few chunks at a time.
 *  7. A duplicate webhook, a second event for the same instance, or a retry
 *     after a failure, charges each chunk once.
 *  8. No AI tokens: failed with a sentence, the audio kept; Retry finishes it.
 *  9. Consent first: no consent, no download. An over-cap file is refused.
 * 10. Tenancy is the ref's: a payload's host and account are never read, and
 *     only the member's own token is sent, to Zoom's host only.
 * 11. No transcript text or audio reaches a log.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/zoom_whisper_fallback_d870.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AI_FIXTURE_PLANS, aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import { withGuard } from './_guard_stub.mjs';
import { memR2 } from './_channels_fixture.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import meetingsRouter, { zoomWebhook } from '../src/routes/founder_validate_meetings.ts';
import { MEETING_ERRORS, normalCallLang, setCallLanguage } from '../src/services/channels/meetings.ts';
import {
  AudioUnreadable, CHUNK_MAX_MS, chooseRecordingSource, demuxM4a, planChunks, prefersNative, remuxChunk, STT_CHUNKS_PER_RUN,
} from '../src/services/channels/meetingAudio.ts';
import { MAX_CHUNK_BYTES } from '../src/services/interviewSessions.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { openSession, writableInterview } from '../src/services/interviewIntake.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const JWT_SECRET = 'd870-fixture-only-signing-secret-0123456789';
const WEBHOOK_SECRET = 'zoom-webhook-fixture-secret';
const ME = 2, OTHER = 3, FOUNDER = 9, PROJECT = 7, INTERVIEW = 101;
const MEETING_ID = '85746065432';
const UUID = 'Mtg+uuid==';
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const WHISPER = '@cf/openai/whisper-large-v3-turbo';

// ── an M4A, written independently of the code under test ─────────────────────

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
function bx(type: string, ...parts: number[][]): number[] {
  const body = parts.flat();
  return [...be32(body.length + 8), ...tag(type), ...body];
}
const SAMPLE_DURATION = 1024; // AAC frames at 16 kHz: 64 ms each
const TIMESCALE = 16000;
const sampleBytes = (i: number) => {
  const n = 300 + (i % 7) * 10;
  return Array.from({ length: n }, (_, k) => (i * 31 + k) % 251);
};
/** A track's boxes; `chunkOffsets` are filled in once the file is laid out. */
function trak(handler: string, sizes: number[], chunkOffsets: number[], samplesPerChunk: number, entry: string) {
  return bx('trak',
    bx('tkhd', be32(3), new Array(80).fill(0)),
    bx('mdia',
      bx('mdhd', be32(0), be32(0), be32(0), be32(TIMESCALE), be32(sizes.length * SAMPLE_DURATION), [0x55, 0xc4, 0, 0]),
      bx('hdlr', be32(0), be32(0), tag(handler), new Array(12).fill(0), tag('x\0')),
      bx('minf',
        bx('stbl',
          bx('stsd', be32(0), be32(1), bx(entry, new Array(28).fill(0), bx('esds', be32(0), [3, 25, 0, 1, 0, 4, 17, 64, 21, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 2, 20, 8]))),
          bx('stts', be32(0), be32(1), be32(sizes.length), be32(SAMPLE_DURATION)),
          bx('stsc', be32(0), be32(1), be32(1), be32(samplesPerChunk), be32(1)),
          bx('stsz', be32(0), be32(0), be32(sizes.length), ...sizes.map(be32)),
          bx('stco', be32(0), be32(chunkOffsets.length), ...chunkOffsets.map(be32)),
        ),
      ),
    ),
  );
}
/** `minutes` of audio; `moovFirst` puts the index before the samples; `video` adds a video track first. */
function m4a(minutes: number, opts: { moovFirst?: boolean; video?: boolean; codec?: string; offsetShift?: number } = {}): Uint8Array {
  const count = Math.round((minutes * 60 * TIMESCALE) / SAMPLE_DURATION);
  const samples = Array.from({ length: count }, (_, i) => sampleBytes(i));
  const sizes = samples.map((s) => s.length);
  const per = 50;
  const chunkCount = Math.ceil(count / per);
  const ftyp = bx('ftyp', tag('M4A '), be32(0), tag('M4A isom'));
  const media = samples.flat();
  const build = (offsets: number[]) => bx('moov', bx('mvhd', new Array(100).fill(0)),
    ...(opts.video ? [trak('vide', [10], [0], 1, 'avc1')] : []), trak('soun', sizes, offsets, per, opts.codec ?? 'mp4a'));
  const placeholder = build(new Array(chunkCount).fill(0));
  const mdatStart = (opts.moovFirst ? ftyp.length + placeholder.length : ftyp.length) + 8;
  const offsets: number[] = [];
  let at = mdatStart;
  for (let c = 0; c < chunkCount; c++) {
    offsets.push(at);
    for (let k = c * per; k < Math.min(count, (c + 1) * per); k++) at += sizes[k];
  }
  const moov = build(offsets.map((o) => o + (opts.offsetShift ?? 0)));
  const mdat = [...be32(media.length + 8), ...tag('mdat'), ...media];
  return new Uint8Array(opts.moovFirst ? [...ftyp, ...moov, ...mdat] : [...ftyp, ...mdat, ...moov]);
}

// ── the world ─────────────────────────────────────────────────────────────────

function world(over: Record<string, unknown> = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO founders VALUES (${FOUNDER}, ${ME});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER});
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE oauth_state_tokens (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      pkce_verifier TEXT, extra_json TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TIMESTAMP);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const t of ['integrations', 'google_oauth_tokens', 'waitlist_signups', 'metric_targets', 'competitor_analyses',
    'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    '529_meeting_transcript_source.sql',
    '452_record_session_setup.sql', '454_channel_voice_failures.sql',
    '457_integrations_last_error_at.sql', '458_channel_link_consent.sql', '488_channel_consents.sql']) db.exec(mig(m));
  applyEngineSchema(db);
  const jobs: any[] = [];
  const aiCalls: { model: string; language: string | null; bytes: number }[] = [];
  const ai = { fail: null as null | ((n: number) => boolean) };
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48), FILES: memR2(),
    ZOOM_CLIENT_ID: 'zoom-client-id', ZOOM_CLIENT_SECRET: 'zoom-client-secret', ZOOM_WEBHOOK_SECRET_TOKEN: WEBHOOK_SECRET,
    PUBLIC_BASE_URL: 'https://axal.test', APP_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(body: unknown) { jobs.push(body); } },
    AI: withGuard({
      async run(model: string, input: any) {
        const n = aiCalls.length;
        aiCalls.push({ model, language: input?.language ?? null, bytes: Array.isArray(input?.audio) ? input.audio.length : 0 });
        if (ai.fail?.(n)) throw new Error('fixture model down');
        return {
          text: `Words of part ${n + 1}.`,
          transcription_info: { language: input?.language ?? 'en' },
          segments: [{ start: 0.5, end: 2.0, text: `Words of part ${n + 1}.` }, { start: 3.0, end: 4.5, text: 'And more.' }],
        };
      },
    }),
    ...over,
  };
  return { env, db, jobs, aiCalls, ai };
}
type World = ReturnType<typeof world>;

async function connectZoom(f: World, userId = ME, token = 'zoom-at') {
  const uid = `zoom-${userId}`;
  const enc = await encryptCredentials(f.env, uid, { access_token: token, refresh_token: 'zoom-rt', token_type: 'bearer', expires_at: Date.now() + HOUR });
  f.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (?, ?, 'zoom', 'active', 'oauth2', ?)`).run(uid, userId, enc);
}

/** A scheduled Zoom call whose interview has consent recorded (or not). */
async function seedRef(f: World, opts: { consent?: boolean; lang?: string | null } = {}) {
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const session = await openSession(f.env, scoped, 'zoom', 'video', opts.consent === false ? null : { method: 'verbal' });
  const uid = crypto.randomUUID();
  f.db.prepare(`INSERT INTO interview_channel_refs
      (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status, call_lang, updated_at)
      VALUES (?, 'zoom', ?, ?, ?, ?, 'https://zoom.us/j/85746065432', ?, ?, 'ended', ?, '2026-01-01 00:00:00')`).run(
    uid, MEETING_ID, session.id, INTERVIEW, ME, iso(-2 * HOUR), iso(-HOUR), opts.lang ?? null);
  return { uid, sessionId: session.id };
}
const refRow = (f: World, uid: string) => ({ ...(f.db.prepare('SELECT * FROM interview_channel_refs WHERE uid = ?').get(uid) as any) });
const instanceRow = (f: World) => ({ ...(f.db.prepare("SELECT * FROM interview_channel_refs WHERE external_ref = ?").get(`${MEETING_ID}:${UUID}`) as any) });
const count = (f: World, sql: string, ...args: unknown[]) => Number((f.db.prepare(sql).get(...args) as any)?.n ?? 0);

// ── Zoom, mocked ──────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const VTT = ['WEBVTT', '', '1', '00:00:01.000 --> 00:00:03.000', 'Dana Ruiz: Hello there.', ''].join('\n');
const AUDIO_FILE = { file_type: 'M4A', file_extension: 'M4A', status: 'completed', recording_type: 'audio_only', download_url: 'https://zoom.us/rec/download/audio-file' };
const TRANSCRIPT_FILE = { file_type: 'TRANSCRIPT', file_extension: 'VTT', status: 'completed', recording_type: 'audio_transcript', download_url: 'https://zoom.us/rec/download/transcript-file' };

function mockZoom(t: any, opts: { files: unknown[]; audio?: Uint8Array; audioHeaders?: Record<string, string> }) {
  const calls: { key: string; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = `${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`;
    calls.push({ key, auth: new Headers(init.headers).get('Authorization') });
    if (/^GET https:\/\/api\.zoom\.us\/v2\/past_meetings\/\d+\/instances$/.test(key)) return json({ meetings: [] });
    if (/^GET https:\/\/api\.zoom\.us\/v2\/meetings\/[^/]+\/recordings$/.test(key)) return json({ uuid: UUID, id: Number(MEETING_ID), start_time: iso(-2 * HOUR + 60_000), recording_files: opts.files });
    if (key === 'GET https://zoom.us/rec/download/transcript-file') return new Response(VTT, { status: 200 });
    if (key === 'GET https://zoom.us/rec/download/audio-file') return new Response(opts.audio ?? m4a(3), { status: 200, headers: opts.audioHeaders ?? {} });
    throw new Error(`unmocked fetch: ${key}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', meetingsRouter as any);
  a.route('/api/channels', zoomWebhook as any);
  a.onError((err: any, c) => c.json({ detail: err.message }, AUTH_ERROR_STATUSES[err?.message ?? ''] ?? 500));
  return a;
})();
async function call(env: any, user: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const hmac = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex');
function signed(body: string, secret = WEBHOOK_SECRET) {
  const ts = Math.floor(Date.now() / 1000);
  return { 'x-zm-signature': `v0=${hmac(secret, `v0:${ts}:${body}`)}`, 'x-zm-request-timestamp': String(ts), 'content-type': 'application/json' };
}
async function zoomPost(env: any, payload: unknown) {
  const body = JSON.stringify(payload);
  const res = await app.fetch(new Request('http://x/api/channels/zoom/webhook', { method: 'POST', headers: signed(body), body }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const recordingEvent = (event = 'recording.completed', id: string | number = Number(MEETING_ID)) => ({
  event, event_ts: Date.now(),
  payload: { account_id: 'someone-elses-account', object: { id, uuid: UUID, host_id: 'someone-else', recording_files: [{ file_type: 'M4A', download_url: 'https://evil.example/not-from-payload' }] } },
});

/** Run every queued meeting_import job, including the ones a job queues, at most `limit` times. */
async function drain(f: World, limit = 10) {
  let ran = 0;
  while (f.jobs.length && ran < limit) {
    const job = f.jobs.shift();
    await runChannelJob(f.env, 'meeting_import', job.payload).catch(() => undefined);
    ran += 1;
  }
  return ran;
}
const segmentsOf = (f: World, sessionId: number) => f.db.prepare(
  "SELECT start_ms, end_ms, speaker_label, text, model FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY start_ms, id",
).all(sessionId).map((r: any) => ({ ...r }));

// ── 1. the source ─────────────────────────────────────────────────────────────

test('1. the source: VTT for English or unknown, M4A otherwise or without a VTT, waiting while processing, none with the reason', () => {
  const usable = (f: { download_url?: string }) => !!f.download_url;
  const vtt = { file_type: 'TRANSCRIPT', status: 'completed', download_url: 'v' };
  const cc = { file_type: 'CC', status: 'completed', download_url: 'c' };
  const audio = { file_type: 'M4A', status: 'completed', download_url: 'a' };
  const video = { file_type: 'MP4', status: 'completed', download_url: 'm' };
  assert.deepEqual(chooseRecordingSource([audio, vtt], null, usable), { kind: 'native', file: vtt });
  assert.deepEqual(chooseRecordingSource([audio, vtt], 'en-GB', usable), { kind: 'native', file: vtt });
  assert.deepEqual(chooseRecordingSource([audio, cc], null, usable), { kind: 'native', file: cc }, 'live captions when there is no transcript, as today');
  assert.deepEqual(chooseRecordingSource([video, audio], null, usable), { kind: 'audio', file: audio });
  assert.deepEqual(chooseRecordingSource([audio, vtt], 'es', usable), { kind: 'audio', file: audio }, 'not English: Whisper');
  assert.deepEqual(chooseRecordingSource([vtt], 'es', usable), { kind: 'native', file: vtt }, 'not English and no audio: the transcript after all');
  assert.deepEqual(chooseRecordingSource([audio, { ...vtt, status: 'processing' }], null, usable), { kind: 'waiting' }, 'a transcript on its way is waited for, never pre-empted');
  assert.deepEqual(chooseRecordingSource([{ ...audio, status: 'processing' }], null, usable), { kind: 'waiting' });
  assert.deepEqual(chooseRecordingSource([video], null, usable), { kind: 'none' }, 'a video file alone is not the audio path');
  assert.deepEqual(chooseRecordingSource([{ ...audio, download_url: '' }], null, usable), { kind: 'waiting' }, 'a file off Zoom’s host is never used');
  assert.equal(prefersNative(undefined), true);
  assert.equal(prefersNative('EN'), true);
  assert.equal(prefersNative('fr'), false);
  assert.equal(normalCallLang(' ES '), 'es');
  assert.equal(normalCallLang('pt-BR'), 'pt-br');
  assert.equal(normalCallLang('spanish please'), null);
  assert.equal(normalCallLang(''), null);
});

// ── 2. the M4A ────────────────────────────────────────────────────────────────

test('2. the audio track is read wherever its index sits and beside video; chunks are complete M4As within the bounds', () => {
  for (const opts of [{}, { moovFirst: true }, { video: true }]) {
    const file = m4a(25, opts);
    const a = demuxM4a(file);
    const count = Math.round((25 * 60 * TIMESCALE) / SAMPLE_DURATION);
    assert.equal(a.samples.length, count, JSON.stringify(opts));
    assert.equal(a.timescale, TIMESCALE);
    for (const i of [0, 1, 777, count - 1]) {
      assert.deepEqual([...file.subarray(a.samples[i].offset, a.samples[i].offset + a.samples[i].size)], sampleBytes(i), `sample ${i}`);
    }
    const plans = planChunks(a);
    assert.equal(plans.length, 3, 'ten-minute chunks');
    assert.deepEqual(plans.map((p) => p.startMs), [0, 600_000 - (600_000 % 64), plans[2].startMs]);
    assert.equal(plans[0].from, 0);
    for (let k = 1; k < plans.length; k++) assert.equal(plans[k].from, plans[k - 1].to, 'contiguous, no sample lost or repeated');
    assert.equal(plans.at(-1)!.to, count);
    for (const p of plans) {
      assert.ok(p.endMs - p.startMs <= CHUNK_MAX_MS);
      const chunk = remuxChunk(a, file, p);
      assert.ok(chunk.length <= MAX_CHUNK_BYTES);
      const back = demuxM4a(chunk);
      assert.equal(back.samples.length, p.to - p.from);
      assert.deepEqual([...back.stsd], [...a.stsd], 'the codec description is copied byte for byte');
      for (const k of [0, back.samples.length - 1]) {
        const s = back.samples[k];
        assert.deepEqual([...chunk.subarray(s.offset, s.offset + s.size)], sampleBytes(p.from + k));
        assert.equal(s.duration, SAMPLE_DURATION);
      }
    }
  }
  // Byte bound: a small cap gives more, smaller chunks.
  const a = demuxM4a(m4a(5));
  const small = planChunks(a, 64 * 1024, CHUNK_MAX_MS);
  assert.ok(small.length > 1);
  for (const p of small) assert.ok(remuxChunk(a, m4a(5), p).length <= 64 * 1024);

  // Malformed files are refused, never guessed at.
  const good = m4a(1);
  const bad = [
    good.slice(0, good.length - 40),                                   // truncated index
    good.slice(0, 24),                                                 // no moov
    new Uint8Array([...good].map((b, i) => (i >= 4 && i < 8 ? 0 : b))), // no ftyp
    new Uint8Array(1000),
    (() => { const f = m4a(1, { moovFirst: true }); return f.slice(0, demuxM4a(f).samples[10].offset); })(), // samples cut short
    m4a(1, { offsetShift: 50_000_000 }),                               // whole boxes, but the index points past the file
    m4a(1, { codec: 'ac-3' }),                                          // not AAC
  ];
  for (const b of bad) assert.throws(() => demuxM4a(b), AudioUnreadable);
  const video = demuxM4a(m4a(1, { video: true }));
  assert.ok(video.samples.length > 900, 'the video track is skipped, the audio read');
});

// ── 3–4. the import ───────────────────────────────────────────────────────────

test('3. a call with only an M4A imports as Whisper text on one timeline, with its charge, its chunks under the session', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f);
  mockZoom(t, { files: [AUDIO_FILE], audio: m4a(25) });
  const posted = await zoomPost(f.env, recordingEvent());
  assert.equal(posted.status, 200);
  assert.equal(f.jobs.length, 1);
  await drain(f);
  const instance = instanceRow(f);
  assert.equal(instance.status, 'imported');
  assert.equal(instance.transcript_source, 'whisper');
  assert.equal(refRow(f, uid).status, 'imported', 'the call shows its instance');
  assert.equal(f.aiCalls.filter((c) => c.model === WHISPER).length, 3, 'one request per chunk');
  const segs = segmentsOf(f, sessionId);
  assert.equal(segs.length, 6);
  const second = 600_000 - (600_000 % 64);
  assert.deepEqual(segs.slice(0, 3).map((s: any) => [s.start_ms, s.end_ms, s.text]),
    [[500, 2000, 'Words of part 1.'], [3000, 4500, 'And more.'], [second + 500, second + 2000, 'Words of part 2.']]);
  assert.ok(segs.every((s: any) => s.speaker_label === 'Speaker ?'), 'Whisper names no speaker');
  assert.ok(segs.every((s: any) => s.model === WHISPER));
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id = ?', sessionId), 3);
  assert.equal([...f.env.FILES.objects.keys()].filter((k: string) => k.startsWith('validate-audio/')).length, 3, 'stored in R2 under the session');
  const charged = f.db.prepare(`SELECT COUNT(*) AS n, SUM(est_cost_usd) AS usd FROM ai_usage_logs WHERE model = ?`).get(WHISPER) as any;
  assert.equal(Number(charged.n), 3, 'every request is on the ledger');
  assert.ok(Number(charged.usd) > 0, 'priced by the minute');
  assert.ok(Number(f.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'settled'").get()!.n) >= 3, 'each hold settled');
  assert.ok(instance.stt_reservation_uid, 'the audio run has its key');
  const meta = [...f.env.FILES.objects.values()].map((o: any) => o.customMetadata.stt_run);
  assert.ok(meta.every((m: string) => m === instance.stt_reservation_uid));
});

test('4. a call with a VTT imports as today: native, no AI call, no audio fetched', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f);
  const calls = mockZoom(t, { files: [AUDIO_FILE, TRANSCRIPT_FILE] });
  await zoomPost(f.env, recordingEvent('recording.transcript_completed'));
  await drain(f);
  assert.equal(instanceRow(f).transcript_source, 'native');
  assert.equal(refRow(f, uid).status, 'imported');
  assert.equal(f.aiCalls.length, 0);
  assert.ok(!calls.some((c) => c.key.endsWith('/audio-file')));
  assert.deepEqual(segmentsOf(f, sessionId).map((s: any) => [s.speaker_label, s.text, s.model]), [['Dana Ruiz', 'Hello there.', 'zoom_transcript']]);
});

test('5. a Spanish call with an English VTT takes Whisper in Spanish once the founder sets Spanish', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid } = await seedRef(f);
  const set = await setCallLanguage(f.env, ME, INTERVIEW, uid, 'ES');
  assert.equal(set!.call_lang, 'es');
  assert.equal(await setCallLanguage(f.env, OTHER, INTERVIEW, uid, 'fr'), null, 'another member’s call is not there');
  mockZoom(t, { files: [TRANSCRIPT_FILE, AUDIO_FILE], audio: m4a(3) });
  await zoomPost(f.env, recordingEvent('recording.transcript_completed'));
  await drain(f);
  const instance = instanceRow(f);
  assert.equal(instance.call_lang, 'es', 'the instance carries the call’s language');
  assert.equal(instance.transcript_source, 'whisper');
  assert.deepEqual(f.aiCalls.filter((c) => c.model === WHISPER).map((c) => c.language), ['es']);
});

test('6. a long call continues on the queue, a few chunks a run, and imports once at the end', async (t) => {
  const f = world();
  await connectZoom(f);
  const { sessionId } = await seedRef(f);
  mockZoom(t, { files: [AUDIO_FILE], audio: m4a(35) });
  await zoomPost(f.env, recordingEvent());
  await runChannelJob(f.env, 'meeting_import', f.jobs.shift().payload);
  assert.equal(f.aiCalls.filter((c) => c.model === WHISPER).length, STT_CHUNKS_PER_RUN);
  assert.equal(instanceRow(f).status, 'transcript_ready', 'part-way: waiting on its next run');
  assert.equal(segmentsOf(f, sessionId).length, 0, 'nothing is imported half-done');
  assert.equal(f.jobs.length, 1, 'the next run is queued');
  await drain(f);
  assert.equal(instanceRow(f).status, 'imported');
  assert.equal(f.aiCalls.filter((c) => c.model === WHISPER).length, 4);
  assert.equal(segmentsOf(f, sessionId).length, 8);
});

test('7. a duplicate webhook, the other event for the same instance, or a retry after a failure charges each chunk once', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid } = await seedRef(f);
  const calls = mockZoom(t, { files: [AUDIO_FILE], audio: m4a(25) });
  await zoomPost(f.env, recordingEvent());
  const dup = await zoomPost(f.env, recordingEvent());
  assert.equal(dup.body.duplicate, true);
  await zoomPost(f.env, recordingEvent('recording.transcript_completed'));
  // The model fails on the second chunk: the call fails retryably, the first chunk stays transcribed.
  f.ai.fail = (n) => n === 1;
  await drain(f, 1);
  assert.equal(instanceRow(f).status, 'failed');
  assert.equal(instanceRow(f).last_error, MEETING_ERRORS.stt_failed);
  f.ai.fail = null;
  const retried = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  await drain(f);
  assert.equal(instanceRow(f).status, 'imported');
  // 1 ok + 1 failed + the 2 left: never the first again.
  assert.equal(f.aiCalls.filter((c) => c.model === WHISPER).length, 4);
  assert.equal(Number(f.db.prepare(`SELECT COUNT(*) AS n FROM ai_usage_logs WHERE model = ? AND refusal IS NULL AND est_cost_usd > 0`).get(WHISPER)!.n), 3, 'three chunks, three charges');
  assert.equal(calls.filter((c) => c.key.endsWith('/audio-file')).length, 1, 'the audio is fetched once');
  const again = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`);
  assert.equal(f.aiCalls.filter((c) => c.model === WHISPER).length, 4, 'an imported call is never transcribed again');
  assert.ok(again.status === 200 || again.status === 409);
});

test('8. no AI tokens: failed with a sentence, the audio kept; Retry after a top-up finishes it with one charge per chunk', async (t) => {
  const f = world();
  setFixtureAllowance(f.db, 0);
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f);
  mockZoom(t, { files: [AUDIO_FILE], audio: m4a(3) });
  await zoomPost(f.env, recordingEvent());
  await drain(f);
  const failed = instanceRow(f);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.last_error, MEETING_ERRORS.stt_budget);
  assert.match(MEETING_ERRORS.stt_budget, /AI tokens/);
  assert.doesNotMatch(MEETING_ERRORS.stt_budget, /credits/i);
  assert.equal(f.aiCalls.filter((c) => c.model === WHISPER).length, 0, 'refused at the hold, before the model');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id = ?', sessionId), 1, 'the audio is kept for a retry');
  const listed = await call(f.env, ME, 'GET', `/interviews/${INTERVIEW}/meetings`);
  assert.equal(listed.body.meetings[0].error_code, 'stt_budget');
  f.db.exec(AI_FIXTURE_PLANS);
  const retried = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`);
  assert.equal(retried.status, 200);
  assert.equal(refRow(f, uid).status, 'imported');
  assert.equal(f.aiCalls.filter((c) => c.model === WHISPER).length, 1);
});

test('9. consent first: no consent, no download and no AI; an over-cap recording is refused before transcription', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid } = await seedRef(f, { consent: false });
  const calls = mockZoom(t, { files: [AUDIO_FILE] });
  await zoomPost(f.env, recordingEvent());
  await drain(f);
  assert.equal(instanceRow(f).last_error, MEETING_ERRORS.stt_consent_missing);
  assert.equal(refRow(f, uid).status, 'no_transcript');
  assert.ok(!calls.some((c) => c.key.endsWith('/audio-file')), 'the audio is never fetched');
  assert.equal(f.aiCalls.length, 0);

  const g = world();
  await connectZoom(g);
  await seedRef(g);
  t.after(() => undefined);
  mockZoom(t, { files: [AUDIO_FILE], audioHeaders: { 'content-length': String(200 * 1024 * 1024) } });
  await zoomPost(g.env, recordingEvent());
  await drain(g);
  assert.equal(instanceRow(g).last_error, MEETING_ERRORS.zoom_audio_too_large);
  assert.equal(g.aiCalls.length, 0);

  const h = world();
  await connectZoom(h);
  await seedRef(h);
  mockZoom(t, { files: [AUDIO_FILE], audio: new TextEncoder().encode('not an m4a at all, just bytes') });
  await zoomPost(h.env, recordingEvent());
  await drain(h);
  assert.equal(instanceRow(h).last_error, MEETING_ERRORS.zoom_audio_unreadable);
  assert.equal(h.aiCalls.length, 0);
});

test('10. tenancy is the ref’s: the payload’s link, host and account are never used; only the member’s token, to Zoom only', async (t) => {
  const f = world();
  await connectZoom(f, ME, 'zoom-at-me');
  await connectZoom(f, OTHER, 'zoom-at-other');
  await seedRef(f);
  const calls = mockZoom(t, { files: [AUDIO_FILE], audio: m4a(1) });
  const unknown = await zoomPost(f.env, recordingEvent('recording.completed', '11111111111'));
  assert.equal(unknown.body.ignored, 'unknown_meeting');
  await zoomPost(f.env, recordingEvent());
  await drain(f);
  assert.ok(!calls.some((c) => c.key.includes('evil.example')), 'the payload’s download link is never fetched');
  const authed = calls.filter((c) => c.auth);
  assert.ok(authed.length > 0);
  assert.ok(authed.every((c) => c.auth === 'Bearer zoom-at-me'), 'only the member’s own token');
  assert.ok(authed.every((c) => /^GET https:\/\/(api\.)?zoom\.us\//.test(c.key)), 'and only to Zoom');
  assert.equal(instanceRow(f).user_id, ME);

  // A listed file whose link is off Zoom's host is never fetched, so no token goes there.
  const g = world();
  await connectZoom(g);
  await seedRef(g);
  const offHost = mockZoom(t, { files: [{ ...AUDIO_FILE, download_url: 'https://zoom.us.evil.example/rec/audio' }] });
  await zoomPost(g.env, recordingEvent());
  await drain(g);
  assert.ok(!offHost.some((c) => c.key.includes('evil.example')));
  assert.equal(g.aiCalls.length, 0);
  assert.deepEqual([instanceRow(g).status, instanceRow(g).last_error], ['ended', null], 'a file Axal cannot fetch is not ready: the call waits');
});

test('11. no transcript text or audio reaches a log', async (t) => {
  const logged: string[] = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(keep) as Array<keyof typeof keep>) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    const f = world();
    await connectZoom(f);
    await seedRef(f);
    mockZoom(t, { files: [AUDIO_FILE], audio: m4a(3) });
    await zoomPost(f.env, recordingEvent());
    f.ai.fail = () => true;
    await drain(f);
    f.ai.fail = null;
  } finally { Object.assign(console, keep); }
  for (const line of logged) {
    assert.doesNotMatch(line, /Words of part|And more|zoom-at|rec\/download/, 'customer content, a token or a link was logged');
  }
});
