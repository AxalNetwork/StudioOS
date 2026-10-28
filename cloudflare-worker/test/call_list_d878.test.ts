/**
 * D878 (#2525) — Record a session › Calls: one venture's calls across its
 * interviews (`GET /meetings/calls`), each with its ref, its audio and what
 * waits for the founder, and Rename speaker across a session
 * (`PATCH /sessions/:id/speakers`). Full schema; every person and figure is
 * invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/call_list_d878.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import sessionsRouter from '../src/routes/founder_validate_sessions.ts';
import { CALL_LIST_MAX, callAudio } from '../src/services/channels/callList.ts';
import { MEETING_ERRORS } from '../src/services/channels/meetings.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in D878 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const secret = 'synthetic-d878-only-'.repeat(3);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('../sql/schema_baseline.sql'));
  for (const name of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
    if (migrationNumber(name) > BASELINE_CUTOFF) db.exec(read(`../sql/migrations/${name}`));
  }
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

// 1 the venture's founder, 2 another founder, 11 an admin.
const ROLES: Record<number, string> = { 1: 'founder', 2: 'founder', 11: 'admin' };
const SECRET_TEXT = 'PRIVATE TRANSCRIPT LINE';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
      (1,'f@example.test','Synthetic Founder','founder',20,1),(2,'o@example.test','Other Founder','founder',30,1),(11,'h@example.test','Plain Admin','admin',NULL,1);
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage) VALUES (10,'Synthetic venture',20,'spinout','seed','build'),(12,'Other venture',30,'spinout','seed','build');
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,interviewee_company) VALUES (4,10,'[Person A]','[Company A]'),(5,10,'[Person C]',NULL),(6,12,'[Person X]',NULL);
    INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel,status,consent_status,consent_method,submitted_via,created_at)
      VALUES (40,'s40',4,10,1,'video','stopped','given','verbal',NULL,'2026-10-21 10:00:00'),
             (41,'s41',5,10,1,'video','stopped','given','written','upload','2026-10-21 16:00:00'),
             (42,'s42',4,10,1,'in_person','stopped','given','verbal',NULL,'2026-10-22 09:00:00'),
             (43,'s43',5,10,1,'video','stopped','given','verbal',NULL,'2026-09-18 10:00:00'),
             (60,'s60',6,12,2,'video','stopped','given','verbal','upload','2026-10-21 12:00:00');
    UPDATE interview_sessions SET audio_removed_at = '2026-10-18 03:00:00', audio_removed_reason = 'retention' WHERE id = 43;
    INSERT INTO interview_channel_refs(uid,provider,external_ref,session_id,interview_id,user_id,join_url,starts_at,ends_at,status,last_error,transcript_source)
      VALUES ('r40','google_meet','evt-1',40,4,1,'https://meet.google.com/abc-mnop-xyz','2026-10-21T10:00:00Z','2026-10-21T10:42:00Z','imported',NULL,'native'),
             ('r43','zoom','85746065432',43,5,1,'https://zoom.us/j/85746065432','2026-09-18T10:00:00Z','2026-09-18T10:30:00Z','no_transcript',NULL,'whisper'),
             ('r43b','zoom','85746065432:2',43,5,1,'https://zoom.us/j/85746065432','2026-09-18T10:31:00Z',NULL,'scheduled',NULL,NULL);
    INSERT INTO interview_session_chunks(session_id,seq,r2_key,mime,size_bytes,start_ms,created_at)
      VALUES (41,0,'k0','audio/wav',10,0,'2026-10-21 16:01:00'),(41,1,'k1','audio/wav',10,120000,'2026-10-21 16:02:00');
    INSERT INTO interview_transcript_segments(session_id,source,start_ms,end_ms,speaker_label,text)
      VALUES (40,'final',8000,9000,'[Name] (you)','Is it all right if I record this call?'),
             (40,'final',302000,305000,'Speaker 3','${SECRET_TEXT}'),
             (40,'final',400000,402000,'Speaker 3','Another line.'),
             (40,'live',302000,305000,'Speaker 3','live copy'),
             (41,'final',1000,2000,'Speaker 3','Not this session.');
    INSERT INTO validate_proposals(project_id,session_id,status,kind,payload_json) VALUES (10,40,'pending','decision','{}'),(10,40,'accepted','decision','{}');`);
  // A ref stores the error's sentence, as `setRefStatus` writes it.
  db.prepare(`UPDATE interview_channel_refs SET last_error = ? WHERE uid = 'r43'`).run(MEETING_ERRORS.zoom_no_transcript);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const app = new Hono().route('/v', sessionsRouter as any);
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const tok = await new SignJWT({ user_id: who, role: ROLES[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    const res = await app.request(path, {
      method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    }, env).catch((e) => { if (e instanceof Response) return e; throw e; });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  return { db, call };
}

test('a venture\'s calls: Meet, uploads and Zoom across its interviews, never an in-person recording or another venture\'s', async () => {
  const f = fixture();
  const r = await f.call(1, 'GET', '/v/meetings/calls?project_id=10');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.calls.map((c: any) => c.session_id), [41, 40, 43], 'newest first; the in-person session (42) is not a call');
  assert.equal(r.body.truncated, false);
  const by = Object.fromEntries(r.body.calls.map((c: any) => [c.session_id, c]));
  assert.deepEqual([by[40].source, by[41].source, by[43].source], ['google_meet', 'upload', 'zoom']);
  assert.deepEqual([by[40].meeting.status, by[40].meeting.transcript_source, by[40].meeting.label], ['imported', 'native', 'Google Meet']);
  assert.equal(by[43].meeting.uid, 'r43', 'a restarted Zoom call shows its first instance');
  assert.equal(by[43].meeting.error_code, 'zoom_no_transcript');
  assert.equal(by[41].meeting, null, 'an upload has no ref');
  assert.deepEqual([by[40].interviewee_name, by[40].interviewee_company, by[40].interview_id], ['[Person A]', '[Company A]', 4]);
  assert.equal(by[40].session.consent_method, 'verbal');
  assert.equal(by[40].pending_proposals, 1, 'only pending proposals count');
  assert.equal(by[41].pending_proposals, 0);
  // Audio: held until the newest chunk plus the default 30 days; removed with its reason; none for a text-only call.
  assert.deepEqual(by[41].audio, { state: 'held', kept_until: '2026-11-20T16:02:00.000Z', removed_at: null, removed_reason: null });
  assert.deepEqual(by[43].audio, { state: 'removed', kept_until: null, removed_at: '2026-10-18 03:00:00', removed_reason: 'retention' });
  assert.equal(by[40].audio.state, 'none');
  assert.doesNotMatch(JSON.stringify(r.body), new RegExp(`${SECRET_TEXT}|Other venture|\\[Person X\\]`), 'a transcript line or another venture left');
  // The founder's own retention moves the date; "keep until deleted" has none.
  f.db.exec(`INSERT INTO member_call_audio_settings(user_id,call_audio_retention_days,updated_at) VALUES (1,7,'2026-10-21')`);
  assert.equal((await f.call(1, 'GET', '/v/meetings/calls?project_id=10')).body.calls[0].audio.kept_until, '2026-10-28T16:02:00.000Z');
  f.db.exec(`UPDATE member_call_audio_settings SET call_audio_retention_days = NULL WHERE user_id = 1`);
  assert.deepEqual((await f.call(1, 'GET', '/v/meetings/calls?project_id=10')).body.calls[0].audio, { state: 'held', kept_until: null, removed_at: null, removed_reason: null });
});

test('the calls read is the venture\'s founder\'s (or an admin\'s); another founder learns nothing; a bad id is refused', async () => {
  const f = fixture();
  assert.equal((await f.call(2, 'GET', '/v/meetings/calls?project_id=10')).status, 404);
  assert.equal((await f.call(1, 'GET', '/v/meetings/calls?project_id=12')).status, 404);
  assert.equal((await f.call(1, 'GET', '/v/meetings/calls?project_id=999')).status, 404);
  assert.equal((await f.call(11, 'GET', '/v/meetings/calls?project_id=10')).status, 200);
  for (const q of ['', '?project_id=x', '?project_id=0', '?project_id=-1']) {
    const r = await f.call(1, 'GET', `/v/meetings/calls${q}`);
    assert.deepEqual([r.status, r.body.detail], [400, 'project_id_required'], q);
  }
});

test('the list stops at its cap and says so', async () => {
  const f = fixture();
  const rows = Array.from({ length: CALL_LIST_MAX + 1 }, (_, i) =>
    `(${1000 + i},'u${i}',4,10,1,'video','stopped','given','verbal','upload','2026-08-01 00:00:00')`).join(',');
  f.db.exec(`INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel,status,consent_status,consent_method,submitted_via,created_at) VALUES ${rows}`);
  const r = await f.call(1, 'GET', '/v/meetings/calls?project_id=10');
  assert.equal(r.body.calls.length, CALL_LIST_MAX);
  assert.equal(r.body.truncated, true);
});

test('callAudio reads SQLite and ISO times alike, and a missing chunk time is no audio, never a date', () => {
  const keep = { days: 2, chosen: true };
  assert.equal(callAudio({ audio_removed_at: null, audio_removed_reason: null, last_chunk_at: '2026-10-01 00:00:00' }, keep).kept_until, '2026-10-03T00:00:00.000Z');
  assert.equal(callAudio({ audio_removed_at: null, audio_removed_reason: null, last_chunk_at: '2026-10-01T00:00:00Z' }, keep).kept_until, '2026-10-03T00:00:00.000Z');
  assert.equal(callAudio({ audio_removed_at: null, audio_removed_reason: null, last_chunk_at: null }, keep).state, 'none');
  assert.equal(callAudio({ audio_removed_at: null, audio_removed_reason: null, last_chunk_at: 'garbage' }, keep).state, 'none');
});

test('Rename speaker: one name for every passage of that speaker in the session, and nowhere else', async () => {
  const f = fixture();
  const r = await f.call(1, 'PATCH', '/v/sessions/40/speakers', { from: 'Speaker 3', to: '  [Person B]  ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, speaker_label: '[Person B]', renamed: 3 });
  const labels = f.db.prepare('SELECT session_id, speaker_label FROM interview_transcript_segments ORDER BY id').all() as any[];
  assert.deepEqual(labels.map((l) => `${l.session_id}:${l.speaker_label}`),
    ['40:[Name] (you)', '40:[Person B]', '40:[Person B]', '40:[Person B]', '41:Speaker 3'], 'another session\'s Speaker 3 was renamed');
  const none = await f.call(1, 'PATCH', '/v/sessions/40/speakers', { from: 'Speaker 9', to: 'X' });
  assert.equal(none.status, 404);
  for (const body of [{ from: 'Speaker 3' }, { to: 'X' }, { from: ' ', to: 'X' }, { from: 'Speaker 3', to: 7 }]) {
    const bad = await f.call(1, 'PATCH', '/v/sessions/40/speakers', body);
    assert.deepEqual([bad.status, bad.body.detail], [400, 'speaker_label_required'], JSON.stringify(body));
  }
  assert.equal((await f.call(2, 'PATCH', '/v/sessions/40/speakers', { from: '[Person B]', to: 'Y' })).status, 404, 'another founder renamed a speaker');
  const long = await f.call(1, 'PATCH', '/v/sessions/40/speakers', { from: '[Person B]', to: 'n'.repeat(120) });
  assert.equal(long.body.speaker_label.length, 80);
});
