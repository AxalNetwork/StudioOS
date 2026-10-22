/**
 * D877 (#2524) — a call's audio kept for its founder's retention, apart from
 * its text: the daily purge, the audio-only delete, the session delete, and an
 * accepted finding that outlives its session.
 *
 * On `_call_audio_fixture.ts` (real SQLite, in-memory R2, the real routes).
 * Sessions are seeded with audio chunks and transcript segments directly, with
 * chunk arrival times in the past, so the purge's age rule is tested at the
 * day either side of each retention.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/call_retention_d877.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteSessionAudio, loadSession } from '../src/services/interviewSessions.ts';
import { DEFAULT_CALL_AUDIO_RETENTION_DAYS, purgeExpiredCallAudio, retentionFor, validRetention } from '../src/services/callAudioRetention.ts';
import { findingsFor } from '../src/services/interviewSuggestions.ts';
import {
  FOUNDER, INTERVIEW, NOW, OTHER, PROJECT, SAID, call, chunkCount, fixture, n, objectsOf, removed, seed, segmentCount,
} from './_call_audio_fixture.ts';

test('the purge: a call\'s audio past the default 30 days goes, its text stays and the session says "audio removed"; a day younger stays', async () => {
  const w = fixture();
  assert.equal(DEFAULT_CALL_AUDIO_RETENTION_DAYS, 30);
  const old = seed(w, { kind: 'upload', ageDays: 30.5 });
  const young = seed(w, { kind: 'upload', ageDays: 29.5 });
  const zoom = seed(w, { kind: 'zoom', ageDays: 45 });
  const r = await purgeExpiredCallAudio(w.env, NOW);
  assert.deepEqual(r, { sessions: 2, objects: 4 });
  for (const id of [old, zoom]) {
    assert.equal(chunkCount(w, id), 0, 'the chunk rows are gone');
    assert.equal(objectsOf(w, id), 0, 'the R2 objects are gone');
    assert.equal(segmentCount(w, id), 1, 'the text stays');
    assert.equal(removed(w, id).reason, 'retention');
    assert.ok(removed(w, id).at);
  }
  assert.equal(chunkCount(w, young), 2);
  assert.equal(objectsOf(w, young), 2);
  assert.equal(removed(w, young).at, null);
  // Idempotent: a second run finds nothing.
  assert.deepEqual(await purgeExpiredCallAudio(w.env, NOW), { sessions: 0, objects: 0 });
  // The audit row names the session and the reason, never its words.
  const logs = w.db.prepare(`SELECT * FROM activity_logs WHERE action = 'interview_session_audio_deleted'`).all() as any[];
  assert.equal(logs.length, 2);
  for (const l of logs) {
    assert.deepEqual(Object.keys(JSON.parse(l.details)).sort(), ['audio_chunks', 'interview_id', 'reason', 'session_uid']);
    assert.equal(JSON.parse(l.details).reason, 'retention');
    assert.equal(l.actor, 'system:call_audio_retention');
  }
  assert.ok(!JSON.stringify(logs).includes(SAID));
});

test('the purge follows each founder\'s own retention: 90 days, or kept until deleted; it never touches the recorder, a moving run, or another founder\'s choice', async () => {
  const w = fixture();
  w.db.prepare('INSERT INTO member_call_audio_settings (user_id, call_audio_retention_days) VALUES (?, 90)').run(FOUNDER);
  w.db.prepare('INSERT INTO member_call_audio_settings (user_id, call_audio_retention_days) VALUES (?, NULL)').run(OTHER);
  const ninetyKept = seed(w, { ageDays: 89.5 });
  const ninetyGone = seed(w, { ageDays: 90.5 });
  const keptForever = seed(w, { ageDays: 4000, owner: OTHER });
  const recorder = seed(w, { kind: 'recorder', ageDays: 4000 });
  const moving = seed(w, { ageDays: 400, stage: 'transcribing' });
  await purgeExpiredCallAudio(w.env, NOW);
  assert.equal(chunkCount(w, ninetyKept), 2);
  assert.equal(chunkCount(w, ninetyGone), 0);
  assert.equal(chunkCount(w, keptForever), 2, 'null keeps the audio until the founder deletes it');
  assert.equal(chunkCount(w, recorder), 2, 'the in-person recorder is not a call');
  assert.equal(chunkCount(w, moving), 2, 'a run that is moving keeps its audio');
  assert.deepEqual(await retentionFor(w.env, FOUNDER), { days: 90, chosen: true });
  assert.deepEqual(await retentionFor(w.env, OTHER), { days: null, chosen: true });
  assert.deepEqual(await retentionFor(w.env, 99), { days: 30, chosen: false });
});

test('the retention routes: the default, a choice, keep-until-deleted, and a refusal', async () => {
  const w = fixture();
  const read = await call(w.env, FOUNDER, 'GET', '/sessions/audio-retention');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { days: 30, chosen: false, default_days: 30, min_days: 1, max_days: 3650 });
  assert.deepEqual((await call(w.env, FOUNDER, 'PUT', '/sessions/audio-retention', { days: 90 })).body, { days: 90, chosen: true });
  assert.deepEqual((await call(w.env, FOUNDER, 'PUT', '/sessions/audio-retention', { days: null })).body, { days: null, chosen: true });
  for (const bad of [{ days: 0 }, { days: 3651 }, { days: 1.5 }, { days: '30' }, {}]) {
    const r = await call(w.env, FOUNDER, 'PUT', '/sessions/audio-retention', bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.detail, 'invalid_retention');
  }
  assert.deepEqual((await call(w.env, FOUNDER, 'GET', '/sessions/audio-retention')).body.days, null, 'a refusal changed nothing');
  // The rule itself, not only the route's: a missing value is no choice.
  for (const v of [undefined, 0, -1, 3651, 1.5, '30', NaN]) assert.equal(validRetention(v), false, String(v));
  for (const v of [null, 1, 30, 3650]) assert.equal(validRetention(v), true, String(v));
  // Each member reads and writes only their own.
  assert.equal((await call(w.env, OTHER, 'GET', '/sessions/audio-retention')).body.days, 30);
});

test('the audio-only delete: the founder removes the audio, the text stays, and playback says why', async () => {
  const w = fixture();
  const id = seed(w, { ageDays: 1 });
  assert.equal((await call(w.env, OTHER, 'DELETE', `/sessions/${id}/audio`)).status, 404, 'not another founder\'s');
  assert.equal(chunkCount(w, id), 2);
  const r = await call(w.env, FOUNDER, 'DELETE', `/sessions/${id}/audio`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.audio_chunks_deleted, 2);
  assert.equal(r.body.audio_removed_reason, 'deleted');
  assert.equal(chunkCount(w, id), 0);
  assert.equal(objectsOf(w, id), 0);
  assert.equal(segmentCount(w, id), 1, 'the text stays');
  const play = await call(w.env, FOUNDER, 'GET', `/sessions/${id}/audio`);
  assert.equal(play.status, 404);
  assert.equal(play.body.detail, 'audio_removed');
  assert.equal(play.body.reason, 'deleted');
  const got = await call(w.env, FOUNDER, 'GET', `/sessions/${id}`);
  assert.equal(got.body.session.audio_removed_reason, 'deleted');
  // Again: nothing left to delete, and the first reason stands.
  const again = await call(w.env, FOUNDER, 'DELETE', `/sessions/${id}/audio`);
  assert.equal(again.body.audio_chunks_deleted, 0);
  await deleteSessionAudio(w.env, (await loadSession(w.env, id))!, null, 'retention');
  assert.equal(removed(w, id).reason, 'deleted');
});

test('the audio-only delete waits for a transcription that is moving', async () => {
  const w = fixture();
  const id = seed(w, { ageDays: 1, stage: 'transcribing' });
  w.db.prepare(`UPDATE interview_sessions SET processing_updated_at = datetime('now') WHERE id = ?`).run(id);
  const r = await call(w.env, FOUNDER, 'DELETE', `/sessions/${id}/audio`);
  assert.equal(r.status, 409);
  assert.equal(chunkCount(w, id), 2);
});

test('deleting the session removes audio and text; an accepted finding stays and reads "Source deleted"', async () => {
  const w = fixture();
  const id = seed(w, { ageDays: 1 });
  const kept = seed(w, { ageDays: 1 });
  const finding = (session: number, value: string) => w.db.prepare(
    `INSERT INTO interview_findings (uid, project_id, interview_id, session_id, module, kind, key_norm, payload_json, quote)
     VALUES (?, ?, ?, ?, 'ideal-customer-profile', 'firmographic', ?, ?, ?)`,
  ).run(`f-${session}`, PROJECT, INTERVIEW, session, `firmographic:${value}`, JSON.stringify({ attribute: value, value: 'Synthetic' }), SAID);
  finding(id, 'industry');
  finding(kept, 'geography');
  const uid = (w.db.prepare('SELECT uid FROM interview_sessions WHERE id = ?').get(id) as any).uid;
  const r = await call(w.env, FOUNDER, 'DELETE', `/sessions/${id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(n(w.db, 'SELECT COUNT(*) AS n FROM interview_sessions WHERE id = ?', id), 0);
  assert.equal(chunkCount(w, id), 0);
  assert.equal(segmentCount(w, id), 0);
  assert.equal([...w.objects.keys()].filter((k) => k.includes(`/${uid}/`)).length, 0, 'its R2 objects are gone');
  assert.equal(objectsOf(w, kept), 2, 'another session keeps its audio');
  const rows = await findingsFor(w.env, { projectId: PROJECT, kinds: ['firmographic'], writer: true });
  const byDetail = Object.fromEntries(rows.map((f) => [f.what, f]));
  assert.equal(rows.length, 2, 'the accepted finding stays');
  assert.equal(byDetail.Industry.source_deleted, true);
  assert.equal(byDetail.Industry.quote, null, 'its quote went with the session');
  assert.equal(byDetail.Geography.source_deleted, false);
  // Removing only the audio is not a deleted source.
  await call(w.env, FOUNDER, 'DELETE', `/sessions/${kept}/audio`);
  const after = await findingsFor(w.env, { projectId: PROJECT, kinds: ['firmographic'], writer: true });
  assert.equal(after.find((f) => f.what === 'Geography')!.source_deleted, false);
  const src = readFileSync(new URL('../src/services/records/validate.ts', import.meta.url), 'utf8');
  assert.match(src, /f\.source_deleted \? `\$\{f\.interviewee \?\? 'Interview'\} · Source deleted`/);
});
