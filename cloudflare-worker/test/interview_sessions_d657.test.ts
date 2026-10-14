/**
 * D657 — interview sessions: consent, chunks, the final transcript, the budget,
 * deletion, and the model list (issue #1470).
 *
 * Real SQLite: migration 438 applied whole, the D629/D640 budget migrations
 * through the shared fixture, and `discovery_interviews` as the recording
 * columns leave it. R2 and Workers AI are in-memory stand-ins that record what
 * they were asked, so "runs nothing" and "stores nothing" are counted, not
 * assumed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import sessions, { markCeiling } from '../src/routes/founder_validate_sessions.ts';
import { sweepInterviewSessions, missingLine } from '../src/services/sessionSweeper.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { listSttModels, isChoosable } from '../src/services/sttModels.ts';
import { parseAudioOutput, parseLiveEvent, speakerLabel } from '../src/services/sttFormats.ts';
import { blocksFor, billedMinutes, splitCost } from '../src/services/liveTranscription.ts';

const JWT_SECRET = 'd657-fixture-only-signing-secret-0123456789';
const MIGRATION = readFileSync(new URL('../sql/migrations/438_interview_sessions.sql', import.meta.url), 'utf8');
const FOUNDER = 2;      // owns project 10
const OTHER = 3;        // owns nothing here
const LAB = 4;          // an admitted Spin-Out Lab member, role 'exploring', owns project 20

function fixture({ dayMicro = 50_000_000, monthMicro = 500_000_000 } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  const db = f.db;
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, interviewee_name TEXT NOT NULL,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      -- D685: the columns production carries (211, 440) that the session routes now write.
      interviewee_company TEXT, interview_date TEXT, quote_consent INTEGER,
      stage TEXT, invited_at TEXT, booked_at TEXT, done_at TEXT, channel TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE hypotheses (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, code TEXT NOT NULL, claim TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0, retired_at TEXT);
  `);
  db.exec(MIGRATION);
  // 447 adds submitted_via (an assistant's or a channel's session); 452 is D685's setup.
  db.exec('ALTER TABLE interview_sessions ADD COLUMN submitted_via TEXT');
  db.exec(readFileSync(new URL('../sql/migrations/452_record_session_setup.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../sql/migrations/453_interview_processing.sql', import.meta.url), 'utf8'));
  // D658 (#1471): the receipt read also lists the structuring lines, which
  // live in `interview_structure_receipts`, beside 439's columns on 214/246's
  // `validate_proposals`, as they will in production.
  for (const m of ['214_validate_proposals.sql', '246_fills_the_blanks_everywhere.sql', '439_validate_proposals_structuring.sql', '446_interview_structure_receipts.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${m}`, import.meta.url), 'utf8'));
  }
  db.prepare("UPDATE users SET founder_id = 100 WHERE id = 2").run();
  db.prepare("UPDATE users SET founder_id = 300 WHERE id = 3").run();
  db.prepare("UPDATE users SET founder_id = 400, role = 'exploring', spinout_lab_active = 1 WHERE id = 4").run();
  db.exec(`INSERT INTO projects VALUES (10, 'Venture', 100), (20, 'Lab venture', 400);
           INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (1, 10, 'Dana'), (2, 20, 'Sam');`);
  for (const key of ['founder:free', 'other']) {
    db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, ?, ?, 1)')
      .run(key, dayMicro, monthMicro);
  }

  const objects = new Map<string, Uint8Array>();
  const r2Calls = { put: 0, del: [] as string[] };
  const FILES = {
    async put(key: string, value: ArrayBuffer) { r2Calls.put++; objects.set(key, new Uint8Array(value)); },
    async get(key: string) {
      const v = objects.get(key);
      return v ? { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) } : null;
    },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) { r2Calls.del.push(k); objects.delete(k); } },
  };
  const aiCalls: Array<{ model: string; input: any }> = [];
  let aiReply: (model: string, input: any) => any = (model) => model === '@cf/deepgram/nova-3'
    ? { results: { channels: [{ detected_language: 'en', alternatives: [{ transcript: 'Hi. Tell me.', words: [
        { word: 'hi', punctuated_word: 'Hi.', start: 0, end: 0.5, speaker: 0 },
        { word: 'tell', punctuated_word: 'Tell', start: 1, end: 1.4, speaker: 1 },
        { word: 'me', punctuated_word: 'me.', start: 1.4, end: 1.8, speaker: 1 }] }] }] } }
    : { text: 'We lose a day a week to invoicing.', transcription_info: { language: 'en' },
        segments: [{ start: 0, end: 2.5, text: 'We lose a day a week to invoicing.' }] };
  const AI = { async run(model: string, input: any) { aiCalls.push({ model, input }); return aiReply(model, input); } };
  const env = { DB: f.DB, JWT_SECRET, ENVIRONMENT: 'development', FILES, AI } as any;
  return { db, env, objects, r2Calls, aiCalls, setAi: (fn: typeof aiReply) => { aiReply = fn; } };
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

const audioSession = (f: any, consent?: unknown, extra: Record<string, unknown> = {}, user = FOUNDER, interview = 1) =>
  call(f.env, user, 'POST', `/interviews/${interview}/sessions`, { channel: 'in_person', consent, ...extra });
const putChunk = (f: any, id: number, seq: number, bytes = new Uint8Array(4000).fill(seq + 1), user = FOUNDER) =>
  call(f.env, user, 'PUT', `/sessions/${id}/chunks/${seq}`, bytes, { 'content-type': 'audio/webm' });

// ── Consent ──────────────────────────────────────────────────────────────────

test('an audio session cannot start without consent; the Worker refuses it', async () => {
  const f = fixture();
  const none = await audioSession(f);
  assert.equal(none.status, 201);
  const id = none.body.session.id;
  const r = await call(f.env, FOUNDER, 'POST', `/sessions/${id}/start`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'consent_not_recorded');
  assert.equal(f.db.prepare('SELECT status FROM interview_sessions WHERE id = ?').get(id).status, 'draft');
  // A chunk is refused too: no audio is kept without consent.
  assert.equal((await putChunk(f, id, 0)).status, 409);
  assert.equal(f.r2Calls.put, 0);

  const declined = await audioSession(f, { status: 'declined' });
  const d = await call(f.env, FOUNDER, 'POST', `/sessions/${declined.body.session.id}/start`);
  assert.equal(d.status, 409);
  assert.match(d.body.message, /declined/);

  const given = await audioSession(f, { status: 'given', method: 'verbal' });
  const ok = await call(f.env, FOUNDER, 'POST', `/sessions/${given.body.session.id}/start`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.session.status, 'recording');
  assert.equal(ok.body.session.consent_method, 'verbal');
  assert.ok(ok.body.session.consent_at);
});

test('consent "given" needs a method; text and manual sessions need none', async () => {
  const f = fixture();
  assert.equal((await audioSession(f, { status: 'given' })).status, 400);
  const t = await call(f.env, FOUNDER, 'POST', '/interviews/1/sessions', {
    channel: 'text', messages: [{ author: 'Me', text: 'How do you invoice?', at_ms: 0 }, { author: 'Dana', text: 'By hand.', at_ms: 4000 }],
  });
  assert.equal(t.status, 201);
  assert.equal(t.body.session.status, 'transcribed');
  const segs = f.db.prepare("SELECT source, speaker_label, text, start_ms FROM interview_transcript_segments WHERE session_id = ? ORDER BY id").all(t.body.session.id);
  assert.deepEqual(segs.map((s: any) => [s.source, s.speaker_label, s.text, s.start_ms]),
    [['final', 'Me', 'How do you invoice?', 0], ['final', 'Dana', 'By hand.', 4000]]);
  assert.equal(f.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = 1').get().transcript, 'How do you invoice?\nBy hand.');
  assert.equal(f.aiCalls.length, 0, 'text chat runs no model');
});

// ── Chunks ───────────────────────────────────────────────────────────────────

test('a chunk uploaded twice is stored once', async () => {
  const f = fixture();
  const s = await audioSession(f, { status: 'given', method: 'in_app' });
  const id = s.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/start`);
  const first = await putChunk(f, id, 0);
  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);
  const again = await putChunk(f, id, 0, new Uint8Array(4000).fill(9));
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(f.r2Calls.put, 1, 'the repeat wrote to R2');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_session_chunks WHERE session_id = ?').get(id).n, 1);
  assert.equal(f.db.prepare('SELECT audio_bytes FROM interview_sessions WHERE id = ?').get(id).audio_bytes, 4000);
  const [key] = [...f.objects.keys()];
  assert.match(key, new RegExp(`^validate-audio/${FOUNDER}/sessions/[0-9a-f-]+/000000\\.webm$`));
  assert.equal(f.objects.get(key)![0], 1, 'the first upload’s bytes were replaced');
});

test('chunks refuse the wrong type, a bad sequence number and another founder', async () => {
  const f = fixture();
  const s = await audioSession(f, { status: 'given', method: 'verbal' });
  const id = s.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/start`);
  assert.equal((await call(f.env, FOUNDER, 'PUT', `/sessions/${id}/chunks/0`, new Uint8Array(10), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await putChunk(f, id, -1)).status, 400);
  assert.equal((await putChunk(f, id, 0, new Uint8Array(10), OTHER)).status, 404, 'D685: another member gets 404, not 403');
  assert.equal((await call(f.env, OTHER, 'GET', `/sessions/${id}`)).status, 404);
});

// ── The final transcript ─────────────────────────────────────────────────────

async function recorded(f: any, extra: Record<string, unknown> = {}) {
  const s = await audioSession(f, { status: 'given', method: 'verbal' }, extra);
  const id = s.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/start`);
  await putChunk(f, id, 0);
  await putChunk(f, id, 1);
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/stop`);
  return id;
}

test('the final transcript replaces the live draft, and the interview’s transcript matches it', async () => {
  const f = fixture();
  const id = await recorded(f);
  f.db.prepare("INSERT INTO interview_transcript_segments (session_id, source, text, model) VALUES (?, 'live', 'we loose a day', '@cf/deepgram/nova-3')").run(id);
  const r = await call(f.env, FOUNDER, 'POST', `/sessions/${id}/transcribe`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const segs = f.db.prepare('SELECT source, text, start_ms FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(id);
  assert.ok(segs.every((s: any) => s.source === 'final'), 'a live draft survived the final transcript');
  assert.equal(segs.length, 2, 'one passage per chunk');
  assert.ok(!segs.some((s: any) => s.text.includes('loose')));
  const interview = f.db.prepare('SELECT transcript, transcribed_by_model FROM discovery_interviews WHERE id = 1').get();
  assert.equal(interview.transcript, segs.map((s: any) => s.text).join('\n'));
  assert.equal(interview.transcribed_by_model, '@cf/openai/whisper-large-v3-turbo');
  const session = f.db.prepare('SELECT status, language, final_model FROM interview_sessions WHERE id = ?').get(id);
  assert.deepEqual({ ...session }, { status: 'transcribed', language: 'en', final_model: '@cf/openai/whisper-large-v3-turbo' });
  assert.equal(f.aiCalls.length, 2, 'each chunk is transcribed on its own');
  const receipt = f.db.prepare("SELECT kind, model, outcome, audio_minutes, cost_microusd FROM interview_session_receipts WHERE session_id = ?").all(id);
  assert.equal(receipt.length, 1);
  assert.deepEqual([receipt[0].kind, receipt[0].outcome, receipt[0].audio_minutes], ['final', 'ok', 2]);
  assert.ok(receipt[0].cost_microusd > 0, 'a transcription must not cost zero');
});

test('Nova-3 batch labels "Me" and the interviewee; an unlabelled passage is "Speaker ?" until assigned', async () => {
  const f = fixture();
  const id = await recorded(f, { final_model: '@cf/deepgram/nova-3' });
  const r = await call(f.env, FOUNDER, 'POST', `/sessions/${id}/transcribe`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const labels = f.db.prepare('SELECT DISTINCT speaker_label FROM interview_transcript_segments WHERE session_id = ? ORDER BY speaker_label').all(id).map((x: any) => x.speaker_label);
  assert.deepEqual(labels, ['Dana', 'Me']);
  assert.equal(f.aiCalls[0].input.diarize, true);
  assert.equal(speakerLabel(null, 'Dana'), 'Speaker ?');
  assert.equal(speakerLabel(2, 'Dana'), 'Speaker ?');
  const seg = f.db.prepare('SELECT id FROM interview_transcript_segments WHERE session_id = ? LIMIT 1').get(id);
  const p = await call(f.env, FOUNDER, 'PATCH', `/sessions/${id}/segments/${seg.id}`, { speaker_label: 'Dana' });
  assert.equal(p.status, 200);
  assert.equal(f.db.prepare('SELECT speaker_label FROM interview_transcript_segments WHERE id = ?').get(seg.id).speaker_label, 'Dana');
});

test('a spent budget runs nothing and stores nothing', async () => {
  const f = fixture({ dayMicro: 0, monthMicro: 0 });
  const id = await recorded(f);
  f.db.prepare("INSERT INTO interview_transcript_segments (session_id, source, text) VALUES (?, 'live', 'draft')").run(id);
  const before = f.db.prepare("SELECT COUNT(*) n FROM ai_budget_reservations WHERE status = 'settled'").get().n;
  const r = await call(f.env, FOUNDER, 'POST', `/sessions/${id}/transcribe`, {});
  assert.equal(r.status, 402);
  assert.equal(r.body.message, 'The included AI allowance and top-up balance cannot cover this run. Add tokens to continue.');
  assert.equal(f.aiCalls.length, 0, 'a model ran on a spent budget');
  assert.deepEqual(f.db.prepare('SELECT source, text FROM interview_transcript_segments WHERE session_id = ?').all(id).map((s: any) => [s.source, s.text]),
    [['live', 'draft']], 'the transcript changed');
  assert.equal(f.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = 1').get().transcript, null);
  assert.equal(f.db.prepare('SELECT status FROM interview_sessions WHERE id = ?').get(id).status, 'stopped');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_budget_reservations WHERE status = 'settled'").get().n, before, 'something was charged');
  const receipt = f.db.prepare('SELECT outcome, refusal, cost_microusd FROM interview_session_receipts WHERE session_id = ?').get(id);
  assert.deepEqual([receipt.outcome, receipt.cost_microusd], ['refused', 0]);
  assert.match(receipt.refusal, /^budget_/);
});

test('a budget that covers part of the job runs none of it', async () => {
  // Each 4,000-byte chunk bills one minute at $0.0005 (500 µ$). 600 µ$ covers
  // the first chunk and not the second: without the up-front hold for the whole
  // job, the first would run, be charged, and its words be thrown away.
  const f = fixture({ dayMicro: 600, monthMicro: 600 });
  const id = await recorded(f);
  const r = await call(f.env, FOUNDER, 'POST', `/sessions/${id}/transcribe`, {});
  assert.equal(r.status, 402);
  assert.equal(f.aiCalls.length, 0, 'a chunk ran before the budget ran out');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?').get(id).n, 0);
});

test('every live model listed is priced, and every final choice is a router alternate', async () => {
  const m = listSttModels();
  for (const x of m.live) assert.equal(typeof x.price_usd_per_minute, 'number', `${x.model} (live) has no price`);
  for (const x of m.final.filter((y: any) => y.choosable)) {
    assert.equal(typeof x.price_usd_per_minute, 'number', `${x.model} is choosable with no price`);
  }
});

test('a model not offered is refused, and Whisper Tiny EN (unpriced) cannot be chosen', async () => {
  const f = fixture();
  const id = await recorded(f);
  const r = await call(f.env, FOUNDER, 'POST', `/sessions/${id}/transcribe`, { model: '@cf/openai/whisper-tiny-en' });
  assert.equal(r.status, 400);
  assert.equal(r.body.detail, 'model_not_offered');
  assert.equal(f.aiCalls.length, 0);
  assert.equal((await audioSession(f, { status: 'given', method: 'verbal' }, { live_model: '@cf/openai/whisper' })).status, 400);
});

// ── Deletion ─────────────────────────────────────────────────────────────────

test('deleting a session removes its audio keys, its rows, and leaves an audit row', async () => {
  const f = fixture();
  const id = await recorded(f);
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/transcribe`, {});
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/marks`, { offset_ms: 1200, label: 'pain' });
  const keys = f.db.prepare('SELECT r2_key FROM interview_session_chunks WHERE session_id = ?').all(id).map((r: any) => r.r2_key);
  assert.equal(keys.length, 2);
  const r = await call(f.env, FOUNDER, 'DELETE', `/sessions/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.audio_chunks_deleted, 2);
  assert.deepEqual([...f.r2Calls.del].sort(), [...keys].sort());
  for (const k of keys) assert.equal(f.objects.has(k), false, `${k} is still in R2`);
  for (const t of ['interview_sessions', 'interview_session_chunks', 'interview_transcript_segments', 'interview_session_marks', 'interview_session_receipts']) {
    const col = t === 'interview_sessions' ? 'id' : 'session_id';
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = ?`).get(id).n, 0, `${t} kept a row`);
  }
  const audit = f.db.prepare("SELECT details, user_id, project_id FROM activity_logs WHERE action = 'interview_session_deleted'").get();
  assert.ok(audit, 'no audit row');
  assert.equal(JSON.parse(audit.details).audio_chunks, 2);
  assert.deepEqual([audit.user_id, audit.project_id], [FOUNDER, 10]);
});

// ── Spin-Out Lab ─────────────────────────────────────────────────────────────

test('a Lab venture’s interview records a session with no Lab-specific code', async () => {
  const f = fixture();
  const s = await audioSession(f, { status: 'given', method: 'written' }, {}, LAB, 2);
  assert.equal(s.status, 201);
  const id = s.body.session.id;
  assert.equal((await call(f.env, LAB, 'POST', `/sessions/${id}/start`)).status, 200);
  assert.equal((await putChunk(f, id, 0, undefined, LAB)).status, 201);
  assert.equal((await call(f.env, LAB, 'POST', `/sessions/${id}/stop`)).status, 200);
  const t = await call(f.env, LAB, 'POST', `/sessions/${id}/transcribe`, {});
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.ok(f.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = 2').get().transcript);
  assert.equal((await call(f.env, FOUNDER, 'GET', `/sessions/${id}`)).status, 404, 'another founder read a Lab session');
});

// ── Duration, receipt, models ────────────────────────────────────────────────

test('the duration is the server’s, and a client-sent duration is never read', async () => {
  const f = fixture();
  const s = await audioSession(f, { status: 'given', method: 'verbal' });
  const id = s.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/start`);
  f.db.prepare("UPDATE interview_sessions SET recording_since = datetime('now', '-90 seconds') WHERE id = ?").run(id);
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/pause`);
  const paused = f.db.prepare('SELECT active_ms, recording_since FROM interview_sessions WHERE id = ?').get(id);
  assert.ok(paused.active_ms >= 89_000 && paused.active_ms <= 92_000, `active_ms ${paused.active_ms}`);
  assert.equal(paused.recording_since, null);
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${id}/pause`)).status, 409, 'paused twice');
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/resume`);
  const stop = await call(f.env, FOUNDER, 'POST', `/sessions/${id}/stop`, { duration_ms: 99_999_999 });
  assert.ok(stop.body.session.active_ms < 100_000, 'a client duration was read');
  assert.equal(stop.body.session.status, 'stopped');
});

test('the receipt lists each job and the budget left today and this month', async () => {
  const f = fixture();
  const id = await recorded(f);
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/transcribe`, {});
  const r = await call(f.env, FOUNDER, 'GET', `/sessions/${id}/receipt`);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.equal(r.body.items[0].model, '@cf/openai/whisper-large-v3-turbo');
  assert.ok(r.body.total_cost_microusd > 0);
  assert.ok(r.body.budget.day_left_microusd < 50_000_000, 'the spend did not reach the budget');
  assert.ok(r.body.budget.month_left_microusd < 500_000_000);
});

test('the model list carries the router’s prices, tags, and what can be chosen', async () => {
  const m = listSttModels();
  const live = Object.fromEntries(m.live.map((x: any) => [x.model, x]));
  const fin = Object.fromEntries(m.final.map((x: any) => [x.model, x]));
  assert.equal(live['@cf/deepgram/nova-3'].price_usd_per_minute, 0.0092);
  assert.equal(live['@cf/deepgram/flux'].price_usd_per_minute, 0.0077);
  assert.equal(fin['@cf/deepgram/nova-3'].price_usd_per_minute, 0.0052);
  assert.equal(fin['@cf/openai/whisper-large-v3-turbo'].price_usd_per_minute, 0.0005);
  assert.ok(fin['@cf/openai/whisper-large-v3-turbo'].tags.includes('Default'));
  assert.equal(fin['@cf/openai/whisper-tiny-en'].price_usd_per_minute, null);
  assert.equal(fin['@cf/openai/whisper-tiny-en'].choosable, false);
  assert.ok(fin['@cf/openai/whisper-tiny-en'].tags.includes('Beta'));
  assert.equal(isChoosable('@cf/deepgram/flux', 'final'), false, 'Flux is WebSocket only');
  assert.equal(isChoosable('@cf/deepgram/nova-3', 'live'), true);
  const f = fixture();
  const r = await call(f.env, FOUNDER, 'GET', '/sessions/models');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.defaults, { live: '@cf/deepgram/nova-3', final: '@cf/openai/whisper-large-v3-turbo' });
});

// ── Live ─────────────────────────────────────────────────────────────────────

test('live: "Live transcript off" opens no socket; a non-upgrade request is refused', async () => {
  const f = fixture();
  const s = await audioSession(f, { status: 'given', method: 'verbal' }, { live_model: null });
  const id = s.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/start`);
  const off = await call(f.env, FOUNDER, 'GET', `/sessions/${id}/live`, undefined, { upgrade: 'websocket' });
  assert.equal(off.status, 409);
  assert.equal(off.body.detail, 'live_off');
  assert.equal(f.aiCalls.length, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_budget_reservations').get().n, 0, 'live off held budget');
  const on = await audioSession(f, { status: 'given', method: 'verbal' });
  assert.equal((await call(f.env, FOUNDER, 'GET', `/sessions/${on.body.session.id}/live`)).status, 426);
});

test('live: a spent budget refuses the stream before any socket opens', async () => {
  const f = fixture({ dayMicro: 0, monthMicro: 0 });
  const s = await audioSession(f, { status: 'given', method: 'verbal' });
  const id = s.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${id}/start`);
  const r = await call(f.env, FOUNDER, 'GET', `/sessions/${id}/live`, undefined, { upgrade: 'websocket' });
  assert.equal(r.status, 402);
  assert.equal(r.body.message, 'The included AI allowance and top-up balance cannot cover this run. Add tokens to continue.');
  assert.equal(f.aiCalls.length, 0);
});

test('live events: only finished passages are stored; budget blocks and splits', () => {
  const nova = { type: 'Results', is_final: true, start: 1.5, duration: 2, channel: { alternatives: [{ transcript: 'It takes hours.', words: [{ speaker: 1 }] }] } };
  assert.deepEqual(parseLiveEvent('@cf/deepgram/nova-3', JSON.stringify(nova)), { start_ms: 1500, end_ms: 3500, text: 'It takes hours.', speaker: 1 });
  assert.equal(parseLiveEvent('@cf/deepgram/nova-3', { ...nova, is_final: false }), null, 'an interim result was stored');
  assert.deepEqual(parseLiveEvent('@cf/deepgram/flux', { event: 'EndOfTurn', transcript: 'Every Friday.', audio_window_start: 4, audio_window_end: 5.25 }),
    { start_ms: 4000, end_ms: 5250, text: 'Every Friday.', speaker: null });
  assert.equal(parseLiveEvent('@cf/deepgram/flux', { event: 'Update', transcript: 'Every' }), null);
  assert.equal(parseLiveEvent('@cf/deepgram/flux', 'not json'), null);
  assert.equal(blocksFor(0), 1);
  assert.equal(blocksFor(4 * 60_000), 1);
  assert.equal(blocksFor(4 * 60_000 + 1), 2);
  assert.equal(billedMinutes(61_000), 2);
  assert.equal(billedMinutes(0), 0);
  assert.deepEqual(splitCost(50, 36, 2), [36, 14]);
  assert.deepEqual(splitCost(10, 36, 2), [10, 0]);
});

test('batch output: Whisper Turbo keeps its segments and language', () => {
  const t = parseAudioOutput('@cf/openai/whisper-large-v3-turbo', {
    text: 'a b', transcription_info: { language: 'fr' }, segments: [{ start: 0, end: 1, text: ' a ' }, { start: 1, end: 2, text: 'b' }],
  });
  assert.deepEqual(t, { text: 'a b', language: 'fr', segments: [
    { start_ms: 0, end_ms: 1000, text: 'a', speaker: null }, { start_ms: 1000, end_ms: 2000, text: 'b', speaker: null }] });
  const plain = parseAudioOutput('@cf/openai/whisper', { text: '' });
  assert.deepEqual(plain, { text: '', language: null, segments: [] }, 'silence is an answer, not a passage');
});

// ===========================================================================
// D685 S03-A (#1583) — the setup call, talking points, language, the
// interview's stage and channel, one live session per member, and the
// interview delete. Same fixture: migration 452 and the 211/440 columns.
// ===========================================================================

const P = '/sessions';
const setup = (f: any, body: any, user = FOUNDER) => call(f.env, user, 'POST', P, { project_id: 10, live_model: null, ...body });
const interviewRow = (f: any, id: number) => f.db.prepare('SELECT * FROM discovery_interviews WHERE id = ?').get(id) as any;

test('D685: the setup call creates the interview from Who, booked today, and opens the session on it', async () => {
  const f = fixture();
  const r = await setup(f, { channel: 'video', call_provider: 'zoom', meeting_url: 'https://acme.zoom.us/j/123456789',
    interviewee: { name: 'Priya', company: 'Northwind' }, consent: { status: 'given', method: 'verbal' }, client_key: 'k1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.interview.interviewee_name, 'Priya');
  assert.equal(r.body.interview.interviewee_company, 'Northwind');
  assert.equal(r.body.interview.stage, 'booked');
  assert.equal(r.body.call_label, 'Video call · Zoom');
  assert.equal(r.body.meeting_url, 'https://acme.zoom.us/j/123456789');
  const row = interviewRow(f, r.body.interview.id);
  assert.equal(row.channel, 'video');
  assert.ok(row.booked_at);
  assert.equal(row.interview_date, new Date().toISOString().slice(0, 10));
  // A reload keeps the interviewee and the company: GET /sessions/:id carries them.
  const read = await call(f.env, FOUNDER, 'GET', `/sessions/${r.body.session.id}`);
  assert.equal(read.body.interview.interviewee_company, 'Northwind');
  assert.equal(read.body.call_label, 'Video call · Zoom');
  // The per-interview list carries the interview too.
  const list = await call(f.env, FOUNDER, 'GET', `/interviews/${r.body.interview.id}/sessions`);
  assert.equal(list.body.interview.interviewee_name, 'Priya');
  assert.equal(list.body.items[0].call_label, 'Video call · Zoom');
});

test('D685: a repeated client_key answers the same pair; a double Start makes one interview', async () => {
  const f = fixture();
  const body = { channel: 'in_person', interviewee: { name: 'Lee' }, consent: { status: 'given', method: 'written' }, client_key: 'same' };
  const a = await setup(f, body);
  const b = await setup(f, body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.body.session.id, a.body.session.id);
  assert.equal(b.body.interview.id, a.body.interview.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM discovery_interviews WHERE interviewee_name = 'Lee'").get().n, 1);
  // Another member's key is their own.
  assert.equal((await call(f.env, OTHER, 'POST', P, { project_id: 10, ...body })).status, 404, 'not their project');
});

test('D685: a picked interview must be on the project and still to come', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name, stage) VALUES (5, 10, 'Kim', 'invited'), (6, 10, 'Held', 'done'), (7, 20, 'Elsewhere', 'lead')");
  const ok = await setup(f, { channel: 'text', interview_id: 5, messages: [{ author: 'Kim', text: 'Hello' }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.interview.id, 5);
  assert.equal((await setup(f, { channel: 'text', interview_id: 6 })).status, 409, 'already held');
  assert.equal((await setup(f, { channel: 'text', interview_id: 7 })).status, 404, 'another project');
  // A text session is held the moment its chat is in.
  assert.equal(interviewRow(f, 5).stage, 'done');
});

test('D685: the free tier cap applies to the interviews the setup call creates', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.db.prepare('INSERT INTO discovery_interviews (project_id, interviewee_name) VALUES (10, ?)').run(`P${i}`);
  const r = await setup(f, { channel: 'text', interviewee: { name: 'Sixth' } });
  assert.equal(r.status, 402);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM discovery_interviews WHERE interviewee_name = 'Sixth'").get().n, 0);
});

test('D685: channel × call provider pairs and the meeting-link host rules', async () => {
  const f = fixture();
  const one = (b: any) => setup(f, { interviewee: { name: 'X' }, consent: { status: 'given', method: 'verbal' }, ...b });
  assert.equal((await one({ channel: 'in_person', call_provider: 'zoom' })).status, 400);
  assert.equal((await one({ channel: 'phone', call_provider: 'zoom' })).status, 400);
  assert.equal((await one({ channel: 'phone', call_provider: 'signal' })).status, 201);
  assert.equal((await one({ channel: 'video', call_provider: 'zoom', meeting_url: 'http://zoom.us/j/1' })).status, 400, 'not https');
  assert.equal((await one({ channel: 'video', call_provider: 'zoom', meeting_url: 'https://zoom.us.evil.com/j/1' })).status, 400, 'host spoof');
  assert.equal((await one({ channel: 'video', call_provider: 'google_meet', meeting_url: 'https://acme.zoom.us/j/1' })).status, 400, 'wrong provider');
  const wa = await one({ channel: 'video', call_provider: 'whatsapp', meeting_url: 'https://wa.me/1' });
  assert.equal(wa.status, 400);
  assert.match(wa.body.message, /no meeting link to check/);
  assert.equal((await one({ channel: 'video', call_provider: 'teams', meeting_url: 'https://teams.microsoft.com/l/meetup' })).status, 201);
  const audioLink = await one({ channel: 'phone', call_provider: 'whatsapp', meeting_url: 'https://teams.microsoft.com/l/x' });
  assert.equal(audioLink.status, 400);
  assert.equal(audioLink.body.message, 'Only a video call has a meeting link.');
  const phone = await one({ channel: 'phone', call_provider: 'whatsapp' });
  assert.equal(phone.body.call_label, 'Audio call · WhatsApp call');
  assert.equal((await one({ channel: 'manual' })).status, 400, 'manual is no longer offered by the setup call');
});

test('D685: language per model — stored, passed to Nova-3 and Turbo, never to Whisper v1; Flux is English only', async () => {
  const f = fixture();
  const flux = await setup(f, { channel: 'in_person', live_model: '@cf/deepgram/flux', language: 'fr', interviewee: { name: 'A' } });
  assert.equal(flux.status, 400);
  assert.match(flux.body.message, /English only/);
  const fluxDetect = await setup(f, { channel: 'in_person', live_model: '@cf/deepgram/flux', interviewee: { name: 'B' } });
  assert.equal(fluxDetect.body.session.language, 'en', 'a Flux session on Detect stores en');
  assert.equal((await setup(f, { channel: 'in_person', language: 'xx', interviewee: { name: 'C' } })).status, 400);
  const models = await call(f.env, FOUNDER, 'GET', '/sessions/models');
  assert.deepEqual(models.body.languages.map((l: any) => l.code), ['en', 'es', 'fr', 'de', 'hi', 'ru', 'pt', 'ja', 'it', 'nl']);
  const { audioInputFor, liveInputFor } = await import('../src/services/sttFormats.ts');
  const bytes = new Uint8Array([1, 2]);
  assert.equal(audioInputFor('@cf/openai/whisper-large-v3-turbo', bytes, 'audio/webm', 'fr').language, 'fr');
  assert.equal('language' in audioInputFor('@cf/openai/whisper', bytes, 'audio/webm', 'fr'), false);
  const nova = audioInputFor('@cf/deepgram/nova-3', bytes, 'audio/webm', 'de');
  assert.equal(nova.language, 'de');
  assert.equal('detect_language' in nova, false, 'a set language replaces detection');
  assert.equal(audioInputFor('@cf/deepgram/nova-3', bytes, 'audio/webm', null).detect_language, true);
  assert.equal(liveInputFor('@cf/deepgram/nova-3', 'es').language, 'es');
  assert.equal('language' in liveInputFor('@cf/deepgram/flux', 'en'), false);
});

test('D685: talking points — checked against the project, capped, snapshotted, ticked on the Worker clock', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO hypotheses (id, project_id, code, claim, sort_order, retired_at) VALUES
    (1, 10, 'H1', 'Ops leads lose a day a week', 0, NULL),
    (2, 10, 'H2', 'They would pay', 1, NULL),
    (3, 10, 'H3', 'Retired claim', 2, '2026-01-01'),
    (4, 20, 'H9', 'Another project', 0, NULL)`);
  for (let i = 10; i < 22; i++) f.db.prepare("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (?, 10, ?, 'c')").run(i, `X${i}`);
  const r = await setup(f, { channel: 'in_person', interviewee: { name: 'Pat' }, consent: { status: 'given', method: 'verbal' },
    points: [2, 1, 3, 4, 2] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.points.map((p: any) => p.text), ['H2 · They would pay', 'H1 · Ops leads lose a day a week'],
    'retired and other-project ids dropped, duplicates once, order kept');
  const many = await setup(f, { channel: 'in_person', interviewee: { name: 'Q' }, points: [1, 2, ...Array.from({ length: 12 }, (_, i) => 10 + i)] });
  assert.equal(many.body.points.length, 10, 'capped at 10');

  const sid = r.body.session.id;
  const [p1, p2] = r.body.points;
  f.db.prepare("UPDATE interview_sessions SET status = 'paused', active_ms = 61000, recording_since = NULL WHERE id = ?").run(sid);
  const tick = await call(f.env, FOUNDER, 'PUT', `/sessions/${sid}/points/${p1.id}`, { covered: true, covered_offset_ms: 5 });
  assert.equal(tick.status, 200);
  assert.equal(tick.body.points_covered, 1);
  const stored = f.db.prepare('SELECT covered_at, covered_offset_ms FROM interview_session_points WHERE id = ?').get(p1.id) as any;
  assert.equal(stored.covered_offset_ms, 61000, 'the Worker clock, never the client value');
  assert.ok(stored.covered_at);
  const untick = await call(f.env, FOUNDER, 'PUT', `/sessions/${sid}/points/${p1.id}`, { covered: false });
  assert.equal(untick.body.points_covered, 0);
  const cleared = f.db.prepare('SELECT covered_at, covered_offset_ms FROM interview_session_points WHERE id = ?').get(p1.id) as any;
  assert.equal(cleared.covered_at, null);
  assert.equal(cleared.covered_offset_ms, null);
  // Another session's point, or another member, is 404.
  assert.equal((await call(f.env, FOUNDER, 'PUT', `/sessions/${many.body.session.id}/points/${p2.id}`, { covered: true })).status, 404);
  assert.equal((await call(f.env, OTHER, 'PUT', `/sessions/${sid}/points/${p2.id}`, { covered: true })).status, 404);
  // Deleting the session deletes its points explicitly, not by the CASCADE.
  f.db.exec('PRAGMA foreign_keys = OFF');
  await call(f.env, FOUNDER, 'DELETE', `/sessions/${sid}`);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM interview_session_points WHERE session_id = ?').get(sid).n, 0);
});

test('D685 #1587: the setup call refuses a second audio session while one is live, before writing anything', async () => {
  const f = fixture();
  const consent = { status: 'given', method: 'verbal' };
  const a = await setup(f, { channel: 'in_person', interviewee: { name: 'One' }, consent, client_key: 'ka' });
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${a.body.session.id}/start`)).status, 200);
  const count = () => f.db.prepare('SELECT COUNT(*) AS n FROM discovery_interviews').get().n;
  const before = count();
  const refused = await setup(f, { channel: 'phone', interviewee: { name: 'Two' }, consent });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'session_active');
  assert.equal(refused.body.session_id, a.body.session.id);
  assert.match(refused.body.message, /already recording another session/);
  assert.equal(count(), before, 'no interview is made for a refused Start');
  // The same Start again (its client_key) still answers its own session.
  assert.equal((await setup(f, { channel: 'in_person', interviewee: { name: 'One' }, consent, client_key: 'ka' })).status, 200);
  // A text chat records nothing, so it is not refused.
  assert.equal((await setup(f, { channel: 'text', call_provider: 'paste', interviewee: { name: 'Three' }, messages: [{ author: 'Three', text: 'Hi' }] })).status, 201);
  // Paused still counts; stopped does not.
  await call(f.env, FOUNDER, 'POST', `/sessions/${a.body.session.id}/pause`);
  assert.equal((await setup(f, { channel: 'video', interviewee: { name: 'Four' }, consent })).status, 409);
  await call(f.env, FOUNDER, 'POST', `/sessions/${a.body.session.id}/stop`);
  assert.equal((await setup(f, { channel: 'video', interviewee: { name: 'Four' }, consent })).status, 201);
});

test('D685: stopping moves the interview to done, through both stop paths; one live session per member', async () => {
  const f = fixture();
  const consent = { status: 'given', method: 'verbal' };
  const a = await setup(f, { channel: 'in_person', interviewee: { name: 'One' }, consent });
  const b = await setup(f, { channel: 'in_person', interviewee: { name: 'Two' }, consent });
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${a.body.session.id}/start`)).status, 200);
  const second = await call(f.env, FOUNDER, 'POST', `/sessions/${b.body.session.id}/start`);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'session_active');
  assert.equal(second.body.session_id, a.body.session.id);
  // An assistant's or a channel's session does not count.
  f.db.prepare("UPDATE interview_sessions SET submitted_via = 'chatgpt' WHERE id = ?").run(a.body.session.id);
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${b.body.session.id}/start`)).status, 200);
  f.db.prepare('UPDATE interview_sessions SET submitted_via = NULL WHERE id = ?').run(a.body.session.id);

  // Path 1: the stop action.
  assert.equal(interviewRow(f, b.body.interview.id).stage, 'booked');
  await call(f.env, FOUNDER, 'POST', `/sessions/${b.body.session.id}/stop`);
  const held = interviewRow(f, b.body.interview.id);
  assert.equal(held.stage, 'done');
  assert.ok(held.done_at);
  // Path 2: consent withdrawn while paused stops it.
  await call(f.env, FOUNDER, 'POST', `/sessions/${a.body.session.id}/pause`);
  await call(f.env, FOUNDER, 'PATCH', `/sessions/${a.body.session.id}/consent`, { status: 'declined' });
  assert.equal(interviewRow(f, a.body.interview.id).stage, 'done');
  // Idempotent: a second pass over a held interview writes nothing more.
  const { markInterviewHeld } = await import('../src/services/sessionSetup.ts');
  const before = f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'interview_stage_set'").get().n;
  await markInterviewHeld(f.env, { interview_id: b.body.interview.id, project_id: 10, channel: 'in_person' }, null);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'interview_stage_set'").get().n, before);
  // The channel fills only where none was set.
  f.db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name, stage, channel) VALUES (9, 10, 'Chan', 'booked', 'phone')");
  const c9 = await setup(f, { channel: 'in_person', interview_id: 9, consent });
  await call(f.env, FOUNDER, 'POST', `/sessions/${c9.body.session.id}/start`);
  await call(f.env, FOUNDER, 'POST', `/sessions/${c9.body.session.id}/stop`);
  assert.equal(interviewRow(f, 9).channel, 'phone');
});

test('D685: a text session records quote consent when a method is picked, and nothing when none is', async () => {
  const f = fixture();
  const with_ = await setup(f, { channel: 'text', interviewee: { name: 'T1' }, consent: { method: 'in_app' }, messages: [{ text: 'hi' }] });
  assert.equal(interviewRow(f, with_.body.interview.id).quote_consent, 1);
  const without = await setup(f, { channel: 'text', interviewee: { name: 'T2' }, messages: [{ text: 'hi' }] });
  assert.equal(interviewRow(f, without.body.interview.id).quote_consent, null);
});

test('D685: the meeting link falls back to a scheduled D684 call\'s join link', async () => {
  const f = fixture();
  f.db.exec(readFileSync(new URL('../sql/migrations/449_interview_channels.sql', import.meta.url), 'utf8')
    .split(';').filter((sql) => /interview_channel_refs/.test(sql) && /CREATE TABLE/.test(sql)).map((sql) => `${sql};`).join('\n'));
  const r = await setup(f, { channel: 'video', call_provider: 'zoom', interviewee: { name: 'Z' }, consent: { status: 'given', method: 'verbal' } });
  assert.equal(r.body.meeting_url, null);
  f.db.prepare("INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, join_url) VALUES ('u', 'zoom', '123456', ?, ?, 2, 'https://zoom.us/j/123456')")
    .run(r.body.session.id, r.body.interview.id);
  assert.equal((await call(f.env, FOUNDER, 'GET', `/sessions/${r.body.session.id}`)).body.meeting_url, 'https://zoom.us/j/123456');
});

test('D685 §5.11: deleting an interview deletes its sessions the way DELETE /sessions/:id does — audio, rows, pending proposals', async () => {
  const f = fixture();
  const { default: progress } = await import('../src/routes/progress.ts');
  // progress.ts reads the project the way the rest of the product does.
  for (const col of ['company_id INTEGER', 'deleted_at TEXT', 'status TEXT', 'owner_id INTEGER']) {
    try { f.db.exec(`ALTER TABLE projects ADD COLUMN ${col}`); } catch { /* present */ }
  }
  const papp = new Hono();
  papp.route('/api/progress', progress as any);
  papp.onError((err: any, c) => (err instanceof Response ? err : c.json({ detail: String(err?.message) }, 500)));
  const s = await setup(f, { channel: 'in_person', interviewee: { name: 'Gone' }, consent: { status: 'given', method: 'verbal' } });
  const sid = s.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/start`);
  assert.equal((await putChunk(f, sid, 0, new Uint8Array(32))).status, 201);
  assert.equal(f.objects.size, 1);
  f.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, status, session_id, citation_json)
     VALUES (10, 'pain_tag', '{}', 'pending', ?, '{"quote":"q"}')`).run(sid);
  const tok = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await papp.request(`/api/progress/discovery/interview/${s.body.interview.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } }, f.env);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(f.objects.size, 0, 'the R2 audio is gone');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM interview_sessions WHERE id = ?').get(sid).n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM validate_proposals WHERE session_id = ?').get(sid).n, 0, 'pending proposals and their quotes are gone');
  assert.equal(interviewRow(f, s.body.interview.id), undefined);
});

// ===========================================================================
// D685 S03-B (#1584) — Stop leads to the findings: upload → transcribe →
// summarise → place findings, as a resumable job. The AI is mocked by model.
// ===========================================================================

import { runInterviewProcessJob, isStale } from '../src/services/interviewProcessing.ts';
import { checkSummary } from '../src/services/interviewStructuring.ts';

/** A recorded, stopped session with `n` chunks, the queue captured. */
async function recordedForProcessing(f: any, n: number, opts: { consent?: boolean } = {}) {
  // structureSession re-checks the member's account (D684's writableSession).
  for (const col of ['deletion_requested_at TEXT', 'deleted_at TEXT']) {
    try { f.db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* present */ }
  }
  for (const col of ['company_id INTEGER', 'deleted_at TEXT']) {
    try { f.db.exec(`ALTER TABLE projects ADD COLUMN ${col}`); } catch { /* present */ }
  }
  f.db.exec('CREATE TABLE IF NOT EXISTS pain_groups (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT)');
  const sent: any[] = [];
  f.env.USE_CF_QUEUE = 'true';
  f.env.JOB_QUEUE = { async send(body: any) { sent.push(body); } };
  const r = await setup(f, { channel: 'in_person', interviewee: { name: 'Robin' }, consent: { status: 'given', method: 'verbal' } });
  const sid = r.body.session.id;
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/start`);
  for (let i = 0; i < n; i++) assert.equal((await putChunk(f, sid, i, new Uint8Array(64 + i))).status, 201);
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/stop`);
  if (opts.consent === false) f.db.prepare("UPDATE interview_sessions SET consent_status = 'declined' WHERE id = ?").run(sid);
  return { sid, interviewId: r.body.interview.id, sent };
}

/** Whisper transcribes; Llama answers the summary and the structuring prompts. */
function llmAi(f: any, opts: { summary?: string; budgetOn?: string } = {}) {
  f.setAi((model: string, input: any) => {
    if (model.includes('whisper') || model.includes('nova')) {
      return { text: 'We reconcile by hand every Friday.', transcription_info: { language: 'en' },
        segments: [{ start: 0, end: 3, text: 'We reconcile by hand every Friday.' }] };
    }
    const sys = String(input?.messages?.[0]?.content || '');
    if (sys.startsWith('Summarise')) {
      return { response: opts.summary ?? JSON.stringify({ sentences: [
        { text: 'They reconcile two systems by hand each week.', cites: [{ from: 0, to: 3000 }] },
        { text: 'They love the product.', cites: [{ from: 999000, to: 999500 }] },
      ] }) };
    }
    return { response: JSON.stringify({ placements: [] }) };
  });
}

const stage = (f: any, sid: number) => f.db.prepare('SELECT processing_stage AS s, processing_done AS d, processing_total AS t, processing_error AS e, status FROM interview_sessions WHERE id = ?').get(sid) as any;
const job = (f: any, sid: number) => runInterviewProcessJob(f.env, { session_id: sid, user_id: FOUNDER });

test('D685 §5.9: /finish counts the chunks; a late chunk queues the job; the job transcribes, summarises and places findings', async () => {
  const f = fixture();
  llmAi(f);
  const { sid, sent } = await recordedForProcessing(f, 2);
  // Three chunks expected, two stored: uploading 2 of 3, nothing queued.
  const fin = await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 2 });
  assert.equal(fin.status, 202);
  assert.deepEqual([fin.body.processing.stage, fin.body.processing.done, fin.body.processing.total], ['uploading', 2, 3]);
  assert.equal(sent.length, 0);
  // The late chunk is accepted after stop and queues the job.
  assert.equal((await putChunk(f, sid, 2, new Uint8Array(70))).status, 201);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].job_type, 'interview_process');
  assert.deepEqual(sent[0].payload, { session_id: sid, user_id: FOUNDER });
  assert.equal(stage(f, sid).d, 3);

  assert.equal(await job(f, sid), 'done');
  const st = stage(f, sid);
  assert.equal(st.s, 'done');
  assert.equal(st.e, null);
  assert.equal(st.status, 'structured', 'structureSession ran and moved it on');
  const read = await call(f.env, FOUNDER, 'GET', `/sessions/${sid}`);
  assert.equal(read.body.processing.stage, 'done');
  assert.equal(read.body.summary.sentences.length, 1, 'the uncited sentence was dropped');
  assert.equal(read.body.summary.sentences[0].text, 'They reconcile two systems by hand each week.');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id = ? AND source = 'final'").get(sid).n, 3);
  // Each AI step left its receipt line, the summary's in the same read.
  const receipt = await call(f.env, FOUNDER, 'GET', `/sessions/${sid}/receipt`);
  const kinds = receipt.body.items.map((i: any) => i.kind);
  assert.ok(kinds.includes('final') && kinds.includes('summarised') && kinds.includes('structured'), kinds.join(','));
  // structureSession was the one that ran, with its own receipt.
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM interview_structure_receipts WHERE session_id = ? AND step = 'structured'").get(sid).n, 1);
});

test('D685 §5.9: a failed chunk fails the run with a sentence; a retry resumes without billing a chunk twice', async () => {
  const f = fixture();
  let failSeq1 = true;
  let whisperCalls = 0;
  f.setAi((model: string, input: any) => {
    if (model.includes('whisper')) {
      whisperCalls += 1;
      if (failSeq1 && Array.isArray(input?.audio) && input.audio.length === 65) throw new Error('upstream down');
      return { text: 'ok', segments: [{ start: 0, end: 1, text: 'ok' }] };
    }
    return { response: JSON.stringify({ sentences: [], placements: [] }) };
  });
  const { sid, sent } = await recordedForProcessing(f, 3);
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 2 });
  assert.equal(await job(f, sid), 'failed');
  let st = stage(f, sid);
  assert.equal(st.s, 'failed');
  assert.match(st.e, /could not be transcribed/);
  assert.equal(st.status, 'stopped', 'back where a person can act');
  const staged = f.db.prepare('SELECT COUNT(*) AS n FROM interview_chunk_transcripts WHERE session_id = ?').get(sid).n;
  assert.equal(staged, 1, 'chunk 0 is staged');
  const before = whisperCalls;
  failSeq1 = false;
  const retry = await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/process`);
  assert.equal(retry.status, 202);
  assert.notEqual(sent[sent.length - 1].idempotency_key, sent[0].idempotency_key, 'a retry gets a fresh key');
  assert.equal(await job(f, sid), 'done');
  assert.equal(whisperCalls - before, 2, 'only chunks 1 and 2 were transcribed again; chunk 0 was not billed twice');
  st = stage(f, sid);
  assert.equal(st.s, 'done');
});

test('D685 §5.9: a spent budget is recorded and shown in the budget\'s words', async () => {
  const f = fixture({ dayMicro: 1 });
  llmAi(f);
  const { sid } = await recordedForProcessing(f, 1);
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 0 });
  assert.equal(await job(f, sid), 'failed');
  const st = stage(f, sid);
  assert.match(st.e, /allowance/i, st.e);
  const receipt = await call(f.env, FOUNDER, 'GET', `/sessions/${sid}/receipt`);
  assert.ok(receipt.body.items.some((i: any) => i.outcome === 'refused' && String(i.refusal).startsWith('budget')));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id = ? AND source = 'final'").get(sid).n, 0);
});

test('D685 §5.9: consent and ownership — no consent, no processing; another member gets 404', async () => {
  const f = fixture();
  llmAi(f);
  const { sid } = await recordedForProcessing(f, 1, { consent: false });
  const fin = await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 0 });
  assert.equal(fin.status, 409);
  assert.equal(fin.body.error, 'consent_not_recorded');
  f.db.prepare("UPDATE interview_sessions SET processing_stage = 'transcribing', expected_last_seq = 0 WHERE id = ?").run(sid);
  assert.equal(await job(f, sid), 'failed', 'the job re-checks consent');
  assert.match(stage(f, sid).e, /consent/);
  assert.equal(f.aiCalls.length, 0, 'no AI ran');
  for (const path of ['finish', 'process', 'summarise']) {
    assert.equal((await call(f.env, OTHER, 'POST', `/sessions/${sid}/${path}`, { last_seq: 0 })).status, 404, path);
  }
  f.db.prepare("UPDATE interview_sessions SET consent_status = 'given', processing_stage = 'transcribing' WHERE id = ?").run(sid);
  assert.equal(await runInterviewProcessJob(f.env, { session_id: sid, user_id: OTHER }), null, 'the job runs only for the member who recorded it');
  assert.equal(f.aiCalls.length, 0, 'and runs no AI for anyone else');
});

test('D685 §5.9: Manual mode stops after Transcribing; /transcribe and /structure wait while the job runs', async () => {
  const f = fixture();
  llmAi(f);
  const { sid } = await recordedForProcessing(f, 1);
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 0, auto: false });
  const busy = await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/transcribe`);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error, 'processing');
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/summarise`)).body.error, 'processing');
  assert.equal(await job(f, sid), 'done');
  assert.equal(stage(f, sid).status, 'transcribed', 'no summary, no placements in Manual mode');
  assert.equal(f.db.prepare('SELECT summary FROM interview_sessions WHERE id = ?').get(sid).summary, null);
  // Done: a re-run is allowed again.
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/summarise`)).status, 201);
});

test('D685 §5.9: a stale run, and a session the old route left in transcribing, are recovered', async () => {
  const f = fixture();
  llmAi(f);
  const { sid } = await recordedForProcessing(f, 1);
  f.db.prepare("UPDATE interview_sessions SET status = 'transcribing', processing_stage = NULL, updated_at = datetime('now', '-1 hour') WHERE id = ?").run(sid);
  // DELETE lets a stale legacy row through; /process recovers it.
  const rec = await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/process`);
  assert.equal(rec.status, 202, JSON.stringify(rec.body));
  assert.equal(await job(f, sid), 'done');
  assert.ok(isStale({ processing_stage: 'transcribing', processing_updated_at: '2020-01-01 00:00:00' } as any));
  assert.equal(isStale({ processing_stage: 'done', processing_updated_at: '2020-01-01 00:00:00' } as any), false);
  assert.equal(isStale({ processing_stage: 'transcribing', processing_updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) } as any), false);
  // A run that is moving refuses a second /process.
  f.db.prepare("UPDATE interview_sessions SET processing_stage = 'transcribing', processing_updated_at = datetime('now') WHERE id = ?").run(sid);
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/process`)).status, 409);
  assert.equal((await call(f.env, FOUNDER, 'DELETE', `/sessions/${sid}`)).status, 409, 'a moving run is waited for');
  f.db.prepare("UPDATE interview_sessions SET processing_stage = 'failed' WHERE id = ?").run(sid);
  assert.equal((await call(f.env, FOUNDER, 'DELETE', `/sessions/${sid}`)).status, 200, 'a failed run can be deleted');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM interview_chunk_transcripts WHERE session_id = ?').get(sid).n, 0);
});

test('D685 §5.10: summary sentences keep only citations inside the transcript; a text session is summarised; refusals use #1470\'s codes', async () => {
  const segs = [{ start: 0, end: 2000, text: 'a', speaker: 'Me' }, { start: 2000, end: 4000, text: 'b', speaker: 'Dana' }] as any;
  const out = checkSummary(JSON.stringify({ sentences: [
    { text: 'Cited.', cites: [{ from: 0, to: 1000 }] },
    { text: 'Outside.', cites: [{ from: 9000, to: 9500 }] },
    { text: 'No cite.' },
    { text: '', cites: [{ from: 0, to: 1000 }] },
  ] }), segs);
  assert.deepEqual(out.sentences.map((s) => s.text), ['Cited.']);
  assert.equal(out.dropped, 3);

  const f = fixture();
  llmAi(f);
  const t = await setup(f, { channel: 'text', interviewee: { name: 'Chat' }, messages: [{ author: 'Chat', text: 'We reconcile by hand.', at_ms: 0 }] });
  const tid = t.body.session.id;
  f.db.prepare("UPDATE interview_transcript_segments SET start_ms = 0, end_ms = 3000 WHERE session_id = ?").run(tid);
  const s1 = await call(f.env, FOUNDER, 'POST', `/sessions/${tid}/summarise`);
  assert.equal(s1.status, 201, JSON.stringify(s1.body));
  assert.equal(s1.body.summary.sentences.length, 1);
  assert.equal((await call(f.env, FOUNDER, 'POST', `/sessions/${tid}/summarise`, { model: 'not a model' })).status, 400);
  const g = fixture({ dayMicro: 1 });
  llmAi(g);
  const t2 = await setup(g, { channel: 'text', interviewee: { name: 'Chat' }, messages: [{ author: 'Chat', text: 'x', at_ms: 0 }] });
  const spent = await call(g.env, FOUNDER, 'POST', `/sessions/${t2.body.session.id}/summarise`);
  assert.equal(spent.status, 402);
  assert.match(spent.body.message, /allowance/i);
  // The second run is a re-summary.
  await call(f.env, FOUNDER, 'POST', `/sessions/${tid}/summarise`);
  const steps = f.db.prepare('SELECT step FROM interview_summary_receipts WHERE session_id = ? ORDER BY id').all(tid).map((r: any) => r.step);
  assert.deepEqual(steps, ['summarised', 're_summarised']);
});

// ── D685 §5.6 and §5.7 (#1584): the active read, the sweeper, the marks gate ──

/** A session on interview 1 put straight into a state: one recording at a time and the free tier's interview cap are the routes' rules, not this test's. */
async function sessionIn(f: any, status: string, extra = '', user = FOUNDER) {
  const r = await audioSession(f, { status: 'given', method: 'verbal' }, {}, user);
  const id = r.body.session.id;
  f.db.prepare(`UPDATE interview_sessions SET status = ?, recording_since = CASE WHEN ? = 'recording' THEN datetime('now') END ${extra} WHERE id = ?`).run(status, status, id);
  return id;
}

test('D685 §5.6: GET /sessions/active is the caller\'s own, newest first, without channel sessions, and is not read as an id', async () => {
  const f = fixture();
  const ida = await sessionIn(f, 'recording');
  await putChunk(f, ida, 0);
  const idb = await sessionIn(f, 'paused', ", channel = 'phone'");
  await sessionIn(f, 'draft');
  await sessionIn(f, 'recording', ", submitted_via = 'telegram'");
  await sessionIn(f, 'structured');
  const r = await call(f.env, FOUNDER, 'GET', '/sessions/active');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((x: any) => [x.id, x.status]), [[idb, 'paused'], [ida, 'recording']]);
  const first = r.body.items[1];
  assert.deepEqual([first.interviewee_name, first.project_id, first.channel, first.chunk_seqs, first.processing], [interviewRow(f, 1).interviewee_name, 10, 'in_person', [0], null]);
  assert.equal(r.body.items[0].call_label, 'Audio call');
  assert.ok(first.recording_since && 'active_ms' in first);
  // Another member sees none of them.
  assert.deepEqual((await call(f.env, OTHER, 'GET', '/sessions/active')).body.items, []);
  // Processing that is not done counts; done does not.
  f.db.prepare("UPDATE interview_sessions SET status = 'stopped', processing_stage = 'transcribing' WHERE id = ?").run(idb);
  f.db.prepare("UPDATE interview_sessions SET status = 'structured', processing_stage = 'done' WHERE id = ?").run(ida);
  const later = await call(f.env, FOUNDER, 'GET', '/sessions/active');
  assert.deepEqual(later.body.items.map((x: any) => [x.id, x.processing?.stage]), [[idb, 'transcribing']]);
});

test('D685 §5.6: migration 453 adds the creator/status index', () => {
  const sql = readFileSync(new URL('../sql/migrations/453_interview_processing.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_interview_sessions_creator_status\s+ON interview_sessions\s*\(created_by_user_id, status\)/);
});

test('D685 §5.6: the sweeper deletes stale drafts (and the interview made for one), pauses silent recordings, and goes on with uploads that stalled', async () => {
  const f = fixture();
  const sent: any[] = [];
  f.env.USE_CF_QUEUE = 'true';
  f.env.JOB_QUEUE = { async send(body: any) { sent.push(body); } };
  const made = await setup(f, { channel: 'in_person', interviewee: { name: 'Robin' }, consent: { status: 'given', method: 'verbal' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const onLogged = await sessionIn(f, 'draft');
  const fresh = await sessionIn(f, 'draft');
  // An interview logged by hand long before, whose only session is a stale draft: the draft goes, the interview stays.
  const handId = Number(f.db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name, stage, created_at) VALUES (10, 'Hand logged', 'booked', datetime('now', '-40 days'))").run().lastInsertRowid);
  const handDraft = (await audioSession(f, { status: 'given', method: 'verbal' }, {}, FOUNDER, handId)).body.session.id;
  f.db.prepare("UPDATE interview_sessions SET created_at = datetime('now', '-25 hours') WHERE id = ?").run(handDraft);
  const old = "datetime('now', '-25 hours')";
  f.db.prepare(`UPDATE interview_sessions SET created_at = ${old} WHERE id IN (?, ?)`).run(made.body.session.id, onLogged);
  f.db.prepare(`UPDATE discovery_interviews SET created_at = ${old} WHERE id = ?`).run(made.body.interview.id);
  // A silent recording: one chunk 20 minutes ago, recording for 30.
  const rid = await sessionIn(f, 'recording', ", active_ms = 5000");
  await putChunk(f, rid, 0);
  f.db.prepare("UPDATE interview_sessions SET recording_since = datetime('now', '-30 minutes') WHERE id = ?").run(rid);
  f.db.prepare("UPDATE interview_session_chunks SET created_at = datetime('now', '-20 minutes') WHERE session_id = ?").run(rid);
  // A recording that is still talking is left alone.
  const live = await sessionIn(f, 'recording');
  f.db.prepare("UPDATE interview_sessions SET recording_since = datetime('now', '-30 minutes') WHERE id = ?").run(live);
  await putChunk(f, live, 0);
  // An upload stuck for 40 minutes with parts 2 and 4 of 4 missing.
  const up = await sessionIn(f, 'recording');
  await putChunk(f, up, 0); await putChunk(f, up, 2);
  f.db.prepare("UPDATE interview_sessions SET status = 'stopped', recording_since = NULL WHERE id = ?").run(up);
  const fin = await call(f.env, FOUNDER, 'POST', `/sessions/${up}/finish`, { last_seq: 3, auto: true });
  assert.equal(fin.status, 202, JSON.stringify(fin.body));
  f.db.prepare("UPDATE interview_sessions SET processing_updated_at = datetime('now', '-40 minutes') WHERE id = ?").run(up);
  const queuedBefore = sent.length;

  const r = await sweepInterviewSessions(f.env, new Date());
  assert.deepEqual(r, { drafts: 3, paused: 1, resumed: 1 });
  assert.ok(interviewRow(f, handId), 'an interview logged by hand stays, even with its only draft gone');
  const row = (id: number) => f.db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(id) as any;
  assert.equal(row(made.body.session.id), undefined);
  assert.equal(interviewRow(f, made.body.interview.id), undefined, 'the interview made for the draft goes too');
  assert.equal(row(onLogged), undefined);
  assert.ok(interviewRow(f, 1), 'an interview logged by hand stays');
  assert.equal(row(fresh).status, 'draft', 'a draft under 24 hours stays');
  const paused = row(rid);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.recording_since, null);
  assert.ok(paused.active_ms >= 5000 + 9 * 60_000 && paused.active_ms <= 5000 + 11 * 60_000, `counted to the last chunk, not to now: ${paused.active_ms}`);
  assert.equal(row(live).status, 'recording');
  const stuck = row(up);
  assert.equal(stuck.processing_stage, 'transcribing');
  assert.equal(stuck.processing_error, 'Parts 2 and 4 of the recording never arrived, so the transcript goes on without them.');
  assert.equal(sent.length, queuedBefore + 1);
  // A second sweep does nothing more.
  assert.deepEqual(await sweepInterviewSessions(f.env, new Date()), { drafts: 0, paused: 0, resumed: 0 });
  assert.equal(missingLine([0]), 'Part 1 of the recording never arrived, so the transcript goes on without it.');
});

test('D685 §5.6: the missing-parts note survives the run to done', async () => {
  const f = fixture();
  llmAi(f);
  const { sid } = await recordedForProcessing(f, 1);
  f.db.prepare("UPDATE interview_sessions SET expected_last_seq = 1, processing_stage = 'uploading', processing_updated_at = datetime('now', '-40 minutes') WHERE id = ?").run(sid);
  await sweepInterviewSessions(f.env, new Date());
  assert.equal(await job(f, sid), 'done');
  assert.equal(stage(f, sid).e, 'Part 2 of the recording never arrived, so the transcript goes on without it.');
});

test('D685 §5.7: a mark is taken while recording, paused or stopped; a client_key replay answers the stored mark; the offset is capped', async () => {
  const f = fixture();
  const r = await setup(f, { channel: 'in_person', interviewee: { name: 'Robin' }, consent: { status: 'given', method: 'verbal' } });
  const sid = r.body.session.id;
  const mark = (body: any) => call(f.env, FOUNDER, 'POST', `/sessions/${sid}/marks`, body);
  assert.equal((await mark({ offset_ms: 0 })).status, 409, 'a draft takes no mark');
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/start`);
  f.db.prepare("UPDATE interview_sessions SET active_ms = 60000, recording_since = datetime('now', '-30 seconds') WHERE id = ?").run(sid);
  const one = await mark({ offset_ms: 70_000, label: 'Pricing', client_key: 'k-1' });
  assert.equal(one.status, 201);
  const again = await mark({ offset_ms: 70_000, label: 'Pricing', client_key: 'k-1' });
  assert.deepEqual([again.status, again.body.duplicate, again.body.mark.id], [200, true, one.body.mark.id]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM interview_session_marks WHERE session_id = ?').get(sid).n, 1);
  const far = await mark({ offset_ms: 9_999_999, client_key: 'k-2' });
  assert.ok(far.body.mark.offset_ms >= 89_000 && far.body.mark.offset_ms <= 92_000, `capped at the time recorded: ${far.body.mark.offset_ms}`);
  assert.equal((await mark({ offset_ms: 1, client_key: 'bad key!' })).status, 400);
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/pause`);
  assert.equal((await mark({ offset_ms: 10, client_key: 'k-3' })).status, 201, 'paused takes a mark');
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/resume`);
  await call(f.env, FOUNDER, 'POST', `/sessions/${sid}/stop`);
  assert.equal((await mark({ offset_ms: 10, client_key: 'k-4' })).status, 201, 'stopped takes the last flush');
  f.db.prepare("UPDATE interview_sessions SET status = 'transcribed' WHERE id = ?").run(sid);
  assert.equal((await mark({ offset_ms: 10, client_key: 'k-5' })).status, 409);
  assert.equal(markCeiling({ active_ms: 1000, recording_since: null }), 1000);
  assert.equal(markCeiling({ active_ms: 1000, recording_since: '2026-01-01 00:00:00' }, Date.parse('2026-01-01T00:00:05Z')), 6000);
});
