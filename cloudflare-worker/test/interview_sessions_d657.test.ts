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
import sessions from '../src/routes/founder_validate_sessions.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { listSttModels, isChoosable } from '../src/services/sttModels.ts';
import { parseAudioOutput, parseLiveEvent, speakerLabel } from '../src/services/sttFormats.ts';
import { blocksFor, billedMinutes, splitCost } from '../src/services/liveTranscription.ts';

const JWT_SECRET = 'd657-fixture-only-signing-secret-0123456789';
import { STRUCTURE_RECEIPTS_SQL } from './_structure_receipts_schema.mjs';
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
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  db.exec(MIGRATION);
  // D658 (#1471): the receipt read also lists the structuring lines, which
  // live in `interview_structure_receipts`, beside 439's columns on 214/246's
  // `validate_proposals`, as they will in production.
  for (const m of ['214_validate_proposals.sql', '246_fills_the_blanks_everywhere.sql', '439_validate_proposals_structuring.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${m}`, import.meta.url), 'utf8'));
  }
  db.exec(STRUCTURE_RECEIPTS_SQL);
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
  assert.equal((await putChunk(f, id, 0, new Uint8Array(10), OTHER)).status, 403);
  assert.equal((await call(f.env, OTHER, 'GET', `/sessions/${id}`)).status, 403);
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
  assert.equal((await call(f.env, FOUNDER, 'GET', `/sessions/${id}`)).status, 403, 'another founder read a Lab session');
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
