/**
 * D872 (#2519) — a call recording uploaded into Record a Session.
 *
 * Real SQLite as D657's session tests build it (migration 438 and the ones
 * after it, the budget migrations through the shared fixture), in-memory R2
 * and a Workers AI stand-in that counts its calls. The frontend's own
 * uploader (`frontend/src/lib/recordingUpload.js`) drives the real routes
 * through a small adapter, so the parts the browser makes are the parts the
 * Worker checks, stores and transcribes.
 *
 * Covers the upload source and its attestation, the format and the cap on
 * parts, a 45-minute recording becoming one session of transcribed segments,
 * a resumed upload with no duplicates, AI tokens charged once per part, and a
 * refusal that keeps the parts for a retry.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/recording_upload_d872.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';
import { withGuard } from './_guard_stub.mjs';
import sessions from '../src/routes/founder_validate_sessions.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { chunkAudioMinutes, runInterviewProcessJob } from '../src/services/interviewProcessing.ts';
import { MAX_UPLOAD_MS, UPLOAD_BYTES_PER_SECOND, isUploadWav, wavInfo } from '../src/services/interviewSessions.ts';
import { encodeWav, PART_SECONDS, UPLOAD_SAMPLE_RATE, uploadRecording } from '../../frontend/src/lib/recordingUpload.js';

const JWT_SECRET = 'd872-fixture-only-signing-secret-0123456789';
const mig = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const FOUNDER = 2;
const OTHER = 3;
const PROJECT = 10;
const INTERVIEW = 1;
const ATTESTED = { agreed: true, method: 'written' };

function fixture({ monthMicro = 500_000_000 } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  const db = f.db;
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, interviewee_name TEXT NOT NULL,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      interviewee_company TEXT, interview_date TEXT, quote_consent INTEGER,
      stage TEXT, invited_at TEXT, booked_at TEXT, done_at TEXT, channel TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE hypotheses (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, code TEXT NOT NULL, claim TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0, retired_at TEXT);
  `);
  db.exec(mig('438_interview_sessions.sql'));
  db.exec('ALTER TABLE interview_sessions ADD COLUMN submitted_via TEXT');
  db.exec(mig('452_record_session_setup.sql'));
  db.exec(mig('453_interview_processing.sql'));
  db.exec(mig('449_interview_channels.sql').split(';').filter((sql) => /interview_channel_refs|channel_threads \(/.test(sql) && /CREATE TABLE/.test(sql)).map((sql) => `${sql};`).join('\n'));
  db.exec(mig('488_channel_consents.sql'));
  for (const m of ['214_validate_proposals.sql', '246_fills_the_blanks_everywhere.sql', '439_validate_proposals_structuring.sql', '446_interview_structure_receipts.sql']) db.exec(mig(m));
  db.prepare('UPDATE users SET founder_id = 100 WHERE id = 2').run();
  db.prepare('UPDATE users SET founder_id = 300 WHERE id = 3').run();
  db.exec(`INSERT INTO projects VALUES (${PROJECT}, 'Venture', 100);
           INSERT INTO discovery_interviews (id, project_id, interviewee_name, stage) VALUES (${INTERVIEW}, ${PROJECT}, 'Dana', 'done');`);
  applyEngineSchema(db);
  applySessionTranslationColumns(db); // D857: production applies migration 527 before the Worker ships.
  setFixtureAllowance(db, monthMicro);

  const objects = new Map<string, Uint8Array>();
  const FILES = {
    async put(key: string, value: ArrayBuffer) { objects.set(key, new Uint8Array(value)); },
    async get(key: string) {
      const v = objects.get(key);
      return v ? { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) } : null;
    },
    async head(key: string) { return objects.has(key) ? {} : null; },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) objects.delete(k); },
  };
  const whisper: Array<{ bytes: number }> = [];
  const AI = withGuard({
    async run(model: string, input: any) {
      if (/whisper|nova/.test(model)) {
        whisper.push({ bytes: Array.isArray(input?.audio) ? input.audio.length : 0 });
        return { text: 'We reconcile by hand every Friday.', transcription_info: { language: 'en' }, segments: [{ start: 0, end: 3, text: 'We reconcile by hand every Friday.' }] };
      }
      return { response: JSON.stringify({ sentences: [], placements: [] }) };
    },
  });
  const sent: any[] = [];
  const env = { DB: f.DB, JWT_SECRET, ENVIRONMENT: 'development', FILES, AI, USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(b: any) { sent.push(b); } } } as any;
  return { db, env, objects, whisper, sent };
}

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', sessions as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, user: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const h: Record<string, string> = { Authorization: `Bearer ${tok}`, ...headers };
  let payload: BodyInit | undefined;
  if (body instanceof Uint8Array) payload = body;
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, { method, headers: h, body: payload }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

/** `interviewSessionsApi`'s four calls, over the real routes; a refusal throws as `request()` does. */
function routeApi(env: any, opts: { failAtSeq?: number } = {}) {
  const ok = (r: { status: number; body: any }) => {
    if (r.status >= 400) throw Object.assign(new Error(r.body?.detail || String(r.status)), { status: r.status, body: r.body });
    return r.body;
  };
  return {
    open: async (body: any) => ok(await call(env, FOUNDER, 'POST', '/sessions', body)),
    get: async (id: number) => ok(await call(env, FOUNDER, 'GET', `/sessions/${id}`)),
    uploadChunk: async (id: number, seq: number, blob: Blob, startMs: number) => {
      if (seq === opts.failAtSeq) throw new Error('network lost');
      return ok(await call(env, FOUNDER, 'PUT', `/sessions/${id}/chunks/${seq}`, new Uint8Array(await blob.arrayBuffer()),
        { 'content-type': blob.type, 'x-chunk-start-ms': String(startMs) }));
    },
    finish: async (id: number, lastSeq: number, auto: boolean) => ok(await call(env, FOUNDER, 'POST', `/sessions/${id}/finish`, { last_seq: lastSeq, auto })),
  };
}

const RATE = UPLOAD_SAMPLE_RATE;
/** A decoded recording of `seconds`: the browser's step, already done. */
const decoded = (seconds: number) => async () => ({ samples: new Float32Array(Math.round(seconds * RATE)), durationMs: Math.round(seconds * 1000) });
const file = { name: 'call-45min.m4a', size: 42_000_000, lastModified: 1_760_000_000_000 };
const n = (db: any, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as any).n);
const body = (extra: Record<string, unknown> = {}) => ({
  project_id: PROJECT, interview_id: INTERVIEW, channel: 'video', source: 'upload', attestation: ATTESTED, duration_ms: 60_000, ...extra,
});
/** Run the processing job until it settles (it transcribes 20 parts a message). */
async function settle(f: any, sid: number) {
  let stage: string | null = null;
  for (let i = 0; i < 10; i++) {
    stage = await runInterviewProcessJob(f.env, { session_id: sid, user_id: FOUNDER });
    if (stage === 'done' || stage === 'failed' || stage === null) break;
  }
  return stage;
}

test('the upload source: a stopped session, consent from the attestation with its method and time, nothing live', async () => {
  const f = fixture();
  const r = await call(f.env, FOUNDER, 'POST', '/sessions', body({ duration_ms: 2_700_000, live_model: '@cf/deepgram/nova-3' }));
  assert.equal(r.status, 201);
  const s = f.db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(r.body.session.id) as any;
  assert.deepEqual(
    [s.submitted_via, s.status, s.consent_status, s.consent_method, s.live_model, s.active_ms, s.channel],
    ['upload', 'stopped', 'given', 'written', null, 2_700_000, 'video'],
  );
  assert.ok(s.consent_at && s.started_at && s.stopped_at, 'the attestation\'s time, and the session closed');
  const log = JSON.parse((f.db.prepare(`SELECT details FROM activity_logs WHERE action = 'interview_session_created'`).get() as any).details);
  assert.deepEqual([log.source, log.attested, log.consent], ['upload', 'written', 'given']);
  // An already-held interview takes an upload.
  assert.equal((f.db.prepare('SELECT stage FROM discovery_interviews WHERE id = ?').get(INTERVIEW) as any).stage, 'done');
  // A recording live elsewhere does not stop an upload, which records nothing live.
  const live = await call(f.env, FOUNDER, 'POST', `/interviews/${INTERVIEW}/sessions`, { channel: 'in_person', consent: { status: 'given', method: 'verbal' } });
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${live.body.session.id}/start`)).status, 200);
  const fresh = await call(f.env, FOUNDER, 'POST', '/sessions', body({ interview_id: undefined, interviewee: { name: 'Robin' } }));
  assert.equal(fresh.status, 201);
  // A new interviewee's interview is created and, its call uploaded, marked held.
  assert.equal((f.db.prepare('SELECT stage FROM discovery_interviews WHERE id = ?').get(fresh.body.session.interview_id) as any).stage, 'done');
  // The same client_key answers the same session.
  const k1 = await call(f.env, FOUNDER, 'POST', '/sessions', body({ client_key: 'upload-abc' }));
  const k2 = await call(f.env, FOUNDER, 'POST', '/sessions', body({ client_key: 'upload-abc' }));
  assert.deepEqual([k1.status, k2.status, k2.body.session.id], [201, 200, k1.body.session.id]);
});

test('no upload without the attestation; a length past three hours or a text channel is refused; nothing is written', async () => {
  const f = fixture();
  const before = () => [n(f.db, 'SELECT COUNT(*) n FROM interview_sessions'), n(f.db, 'SELECT COUNT(*) n FROM discovery_interviews')];
  const start = before();
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ attestation: undefined }, 400, 'attestation_required'],
    [{ attestation: { method: 'verbal' } }, 400, 'attestation_required'],
    [{ attestation: { agreed: true, method: 'in_app' } }, 400, 'attestation_required'],
    [{ attestation: { agreed: false, method: 'verbal' } }, 400, 'attestation_required'],
    [{ duration_ms: undefined }, 400, 'duration_required'],
    [{ duration_ms: MAX_UPLOAD_MS + 1 }, 413, 'upload_too_long'],
    [{ channel: 'text' }, 400, 'upload_needs_audio_channel'],
    [{ source: 'zoom' }, 400, 'invalid_source'],
    // A new interviewee, refused before the interview is created.
    [{ interview_id: undefined, interviewee: { name: 'Robin' }, attestation: undefined }, 400, 'attestation_required'],
  ];
  for (const [extra, status, detail] of cases) {
    const r = await call(f.env, FOUNDER, 'POST', '/sessions', body(extra));
    assert.deepEqual([r.status, r.body.detail], [status, detail], JSON.stringify(extra));
  }
  assert.match((await call(f.env, FOUNDER, 'POST', '/sessions', body({ attestation: undefined }))).body.message, /everyone recorded agreed/);
  assert.deepEqual(before(), start, 'nothing was written');
  // Another member cannot upload onto this venture.
  assert.equal((await call(f.env, OTHER, 'POST', '/sessions', body())).status, 404);
});

test('an upload\'s parts: the uploader\'s WAV only, a repeat stored once, and never past three hours', async () => {
  const f = fixture();
  const sid = (await call(f.env, FOUNDER, 'POST', '/sessions', body())).body.session.id;
  const put = (seq: number, bytes: Uint8Array, type = 'audio/wav') => call(f.env, FOUNDER, 'PUT', `/sessions/${sid}/chunks/${seq}`, bytes, { 'content-type': type });
  const part = encodeWav(new Float32Array(RATE * 2));
  assert.equal(isUploadWav(part), true);
  // Not the uploader's format: a webm, or a WAV at another rate or with two channels.
  const at44k = encodeWav(new Float32Array(100), 0, 100, 44_100);
  const stereo = part.slice(); new DataView(stereo.buffer).setUint16(22, 2, true);
  const eightBit = part.slice(); new DataView(eightBit.buffer).setUint16(34, 8, true);
  for (const [bytes, type] of [[new Uint8Array(4000).fill(1), 'audio/webm'], [at44k, 'audio/wav'], [stereo, 'audio/wav'], [eightBit, 'audio/wav'], [part.slice(0, 44), 'audio/wav']] as const) {
    const r = await put(0, bytes as Uint8Array, type);
    assert.ok([415, 400].includes(r.status), `${type} ${r.status}`);
  }
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM interview_session_chunks WHERE session_id = ?', sid), 0);
  assert.deepEqual([(await put(0, part)).status, (await put(0, part)).body.duplicate], [201, true]);
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM interview_session_chunks WHERE session_id = ?', sid), 1);

  // The cap: parts already holding 3 hours less one second of audio; a two-second part does not fit.
  const capBytes = (MAX_UPLOAD_MS / 1000) * UPLOAD_BYTES_PER_SECOND;
  f.db.prepare(`INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes) VALUES (?, 1, 'validate-audio/x/1', 'audio/wav', ?)`)
    .run(sid, capBytes - UPLOAD_BYTES_PER_SECOND - 2 * UPLOAD_BYTES_PER_SECOND + 44);
  const over = await put(2, part);
  assert.deepEqual([over.status, over.body.detail], [413, 'upload_too_long']);
  // A part that fits, and a repeat of a stored one, still go in.
  assert.equal((await put(2, encodeWav(new Float32Array(RATE)))).status, 201);
  assert.equal((await put(0, part)).body.duplicate, true);
});

test('a 45-minute recording becomes one session of transcribed segments, each part charged once, its true minutes', async () => {
  const f = fixture();
  const r = await uploadRecording({ file, api: routeApi(f.env), target: { project_id: PROJECT, interview_id: INTERVIEW }, attestation: ATTESTED, decode: decoded(45 * 60) });
  assert.deepEqual([r.parts, r.sent, r.skipped], [23, 23, 0]);
  const sid = r.sessionId;
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM interview_session_chunks WHERE session_id = ?', sid), 23);
  assert.equal(f.sent.length, 1, 'the last part queued the job');
  assert.equal(await settle(f, sid), 'done');
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ? AND source = 'final'", sid), 23);
  assert.equal(f.whisper.length, 23, 'one transcription per part');
  // Placed on one timeline: each part at its own start.
  const starts = (f.db.prepare("SELECT start_ms FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY start_ms").all(sid) as any[]).map((x) => x.start_ms);
  assert.deepEqual(starts.slice(0, 3), [0, 120_000, 240_000]);
  // Charged on the audio's true length: 22 parts of two minutes and one of one, never the 32 kbps guess.
  const receipt = f.db.prepare("SELECT audio_minutes FROM interview_session_receipts WHERE session_id = ? AND kind = 'final' AND outcome = 'ok'").get(sid) as any;
  assert.equal(receipt.audio_minutes, 45);
  const chunk = f.db.prepare('SELECT mime, size_bytes FROM interview_session_chunks WHERE session_id = ? AND seq = 0').get(sid) as any;
  assert.equal(chunkAudioMinutes(chunk, { submitted_via: 'upload' }), 2);
  assert.equal(chunkAudioMinutes(chunk, { submitted_via: null }), 17, 'the 32 kbps guess, for any other session: 17 minutes for 2');
  assert.equal(wavInfo(f.objects.values().next().value!)!.durationMs, PART_SECONDS * 1000);
  // A retry of a finished run transcribes nothing again.
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/process`);
  await settle(f, sid);
  assert.equal(f.whisper.length, 23);
});

test('an interrupted upload resumes on the same session, sends only the rest, and stores no part twice', async () => {
  const f = fixture();
  const target = { project_id: PROJECT, interview_id: INTERVIEW };
  await assert.rejects(uploadRecording({ file, api: routeApi(f.env, { failAtSeq: 4 }), target, attestation: ATTESTED, decode: decoded(10 * 60 + 30) }), /network lost/);
  const sid = (f.db.prepare("SELECT id FROM interview_sessions WHERE submitted_via = 'upload'").get() as any).id;
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM interview_session_chunks WHERE session_id = ?', sid), 4);
  assert.equal(f.sent.length, 0, 'nothing processed before finish');
  const r = await uploadRecording({ file, api: routeApi(f.env), target, attestation: ATTESTED, decode: decoded(10 * 60 + 30) });
  assert.deepEqual([r.sessionId, r.parts, r.sent, r.skipped], [sid, 6, 2, 4]);
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM interview_sessions WHERE submitted_via = 'upload'"), 1, 'one session');
  assert.deepEqual((f.db.prepare('SELECT seq FROM interview_session_chunks WHERE session_id = ? ORDER BY seq').all(sid) as any[]).map((x) => x.seq), [0, 1, 2, 3, 4, 5]);
  assert.equal(await settle(f, sid), 'done');
  assert.equal(f.whisper.length, 6);
});

test('a refusal for AI tokens keeps the parts; a retry with tokens transcribes each part once', async () => {
  const f = fixture({ monthMicro: 1 });
  const r = await uploadRecording({ file, api: routeApi(f.env), target: { project_id: PROJECT, interview_id: INTERVIEW }, attestation: ATTESTED, decode: decoded(5 * 60) });
  assert.equal(await settle(f, r.sessionId), 'failed');
  assert.equal(f.whisper.length, 0, 'nothing ran without AI tokens');
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM interview_session_chunks WHERE session_id = ?', r.sessionId), 3, 'the parts wait for a retry');
  assert.equal((f.db.prepare("SELECT outcome FROM interview_session_receipts WHERE session_id = ? ORDER BY id DESC").get(r.sessionId) as any).outcome, 'refused');
  setFixtureAllowance(f.db, 500_000_000);
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${r.sessionId}/process`)).status, 202);
  assert.equal(await settle(f, r.sessionId), 'done');
  assert.equal(f.whisper.length, 3);
});
