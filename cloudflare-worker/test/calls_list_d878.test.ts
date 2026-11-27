/**
 * D878 (#2525) — GET /api/founder/validate/meetings, the read Record a
 * session › Calls draws its Calls and Retention tabs from, on D684's channel
 * world and the real meetings router.
 *
 *   1. Only the caller's own calls and uploads, in a company they may write.
 *   2. Each call as D874 lists it, plus how its text was made (D870).
 *   3. Each session's audio: held with the date D877's sweep removes it,
 *      kept for good under "until I delete it", or removed with its reason.
 *   4. No join link, meeting id or passcode in the answer.
 *
 * Every name and value is invented.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/calls_list_d878.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import meetings from '../src/routes/founder_validate_meetings.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { audioExpiresAt } from '../src/services/channels/callsList.ts';
import { INTERVIEW, JWT_SECRET, ME, mig, OTHER, OTHER_PROJECT, PROJECT, world } from './_channels_fixture.ts';

const MEETING_ID = '85746065432';
const JOIN = `https://zoom.us/j/${MEETING_ID}?pwd=fixturePwd`;
const OTHER_INTERVIEW = 202;

const app = new Hono();
app.route('/api/founder/validate', meetings as any);
app.onError((err: any, c) => {
  const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
  if (st) return c.json({ detail: err.message }, st);
  console.error(err);
  return c.json({ detail: 'Internal server error' }, 500);
});

async function get(env: any, user: number) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request('https://axal.vc/api/founder/validate/meetings', { headers: { authorization: `Bearer ${tok}` } }), env);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

/**
 * ME: a Zoom call imported from its own transcript (native) with audio held;
 * a Meet call imported by Whisper whose audio was removed after retention;
 * an upload with audio held; and an upload on OTHER_PROJECT (not ME's
 * company), which must not be listed. OTHER: a call on ME's interview.
 */
async function setup() {
  const w: any = await world({ seed: true });
  const { db } = w;
  db.exec(mig('530_call_audio_retention.sql'));
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${OTHER_INTERVIEW}, ${OTHER_PROJECT}, 'Lee')`);
  const session = (uid: string, interview: number, project: number, user: number, via: string | null) => {
    db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at, submitted_via)
                VALUES (?, ?, ?, ?, 'video', 'stopped', 'given', 'verbal', datetime('now'), ?)`).run(uid, interview, project, user, via);
    return Number(db.prepare('SELECT id FROM interview_sessions WHERE uid = ?').get(uid).id);
  };
  const chunk = (sessionId: number, seq: number, at: string) => db.prepare(
    `INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes, start_ms, created_at) VALUES (?, ?, ?, 'audio/wav', 100, ?, ?)`,
  ).run(sessionId, seq, `fixture/${sessionId}/${seq}`, seq * 120000, at);
  const ref = (uid: string, provider: string, sessionId: number, interviewId: number, user: number, status: string, source: string | null, join = JOIN, external = MEETING_ID) =>
    db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status, transcript_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-20 09:00:00', '2026-10-20 10:00:00', ?, ?)`).run(uid, provider, external, sessionId, interviewId, user, join, status, source);

  const z = session('s-zoom', INTERVIEW, PROJECT, ME, 'zoom');
  ref('ref-z', 'zoom', z, INTERVIEW, ME, 'imported', 'native');
  chunk(z, 0, '2026-10-20 10:05:00');
  chunk(z, 1, '2026-10-21 08:00:00');

  const m = session('s-meet', INTERVIEW, PROJECT, ME, 'google_meet');
  ref('ref-m', 'google_meet', m, INTERVIEW, ME, 'imported', 'whisper', 'https://meet.google.com/abc-mnop-xyz', 'abc-mnop-xyz');
  db.prepare("UPDATE interview_sessions SET audio_removed_at = '2026-10-22 03:00:00', audio_removed_reason = 'retention' WHERE id = ?").run(m);

  const u = session('s-up', INTERVIEW, PROJECT, ME, 'upload');
  chunk(u, 0, '2026-10-22 12:00:00');
  const away = session('s-away', OTHER_INTERVIEW, OTHER_PROJECT, ME, 'upload');
  chunk(away, 0, '2026-10-22 12:00:00');

  const o = session('s-other', INTERVIEW, PROJECT, OTHER, 'zoom');
  ref('ref-o', 'zoom', o, INTERVIEW, OTHER, 'scheduled', null, 'https://zoom.us/j/11122233344', '11122233344');
  return { ...w, ids: { z, m, u, away, o } };
}

test('the expiry date is D877’s rule: newest chunk plus the retention, never with "until I delete it"', () => {
  assert.equal(audioExpiresAt('2026-10-21 08:00:00', 30), '2026-11-20T08:00:00.000Z');
  assert.equal(audioExpiresAt('2026-10-21T08:00:00Z', 7), '2026-10-28T08:00:00.000Z');
  assert.equal(audioExpiresAt('2026-10-21 08:00:00', null), null);
  assert.equal(audioExpiresAt(null, 30), null);
  assert.equal(audioExpiresAt('not a date', 30), null);
});

test('the caller’s own calls and uploads, in a company they may write; each audio’s state; no link or meeting id', async () => {
  const s = await setup();
  const r = await get(s.env, ME);
  assert.equal(r.status, 200);
  const calls = r.body.calls;
  // OTHER's call on ME's interview is OTHER's: listMeetings reads the caller's refs only.
  assert.deepEqual(calls.map((c: any) => c.id).sort(), ['ref-m', 'ref-z']);
  const byId = Object.fromEntries(calls.map((c: any) => [c.id, c]));
  // Mutation checked: drop the source lookup → both read null.
  assert.equal(byId['ref-z'].transcript_source, 'native');
  assert.equal(byId['ref-m'].transcript_source, 'whisper');
  assert.equal(byId['ref-z'].session_id, s.ids.z);
  assert.equal(byId['ref-z'].company.name, 'Ledger tool');

  // Mutation checked: drop the company filter on uploads → s-away (another company) appears.
  assert.deepEqual(r.body.uploads.map((u: any) => u.session_id), [s.ids.u]);
  assert.equal(r.body.uploads[0].interviewee, 'Dana Ruiz');

  const audio = Object.fromEntries(r.body.audio.map((a: any) => [a.session_id, a]));
  assert.equal(r.body.retention.days, 30, 'no choice made: the default');
  // Counted from the newest chunk, not the first (D877). Mutation checked: MIN instead of MAX → the date moves.
  assert.equal(audio[s.ids.z].held, true);
  assert.equal(audio[s.ids.z].expires_at, '2026-11-20T08:00:00.000Z');
  assert.equal(audio[s.ids.m].held, false);
  assert.equal(audio[s.ids.m].removed_reason, 'retention');
  assert.equal(audio[s.ids.m].expires_at, null);
  assert.equal(audio[s.ids.u].held, true);
  assert.equal(audio[s.ids.away], undefined, 'another company’s session is not read');

  assert.ok(!r.text.includes(MEETING_ID), 'no meeting id');
  assert.ok(!/zoom\.us|meet\.google\.com|pwd/.test(r.text), 'no join link or passcode');
});

test('"Until I delete it" keeps every audio without a date; a member with nothing gets empty lists', async () => {
  const s = await setup();
  s.db.prepare('INSERT INTO member_call_audio_settings (user_id, call_audio_retention_days) VALUES (?, NULL)').run(ME);
  const r = await get(s.env, ME);
  assert.equal(r.body.retention.days, null);
  assert.equal(r.body.retention.chosen, true);
  for (const a of r.body.audio.filter((x: any) => x.held)) assert.equal(a.expires_at, null);

  s.db.prepare('DELETE FROM interview_channel_refs').run();
  s.db.prepare("DELETE FROM interview_sessions WHERE submitted_via = 'upload'").run();
  const empty = await get(s.env, ME);
  assert.deepEqual([empty.body.calls, empty.body.uploads, empty.body.audio], [[], [], []]);
});

test('a company the member can no longer write drops out', async () => {
  // Mutation checked: skip `canWrite` → the calls and uploads stay.
  const s = await setup();
  // ME's venture passes to another founder: canWrite now refuses it.
  s.db.prepare('UPDATE projects SET founder_id = 99 WHERE id = ?').run(PROJECT);
  const r = await get(s.env, ME);
  assert.deepEqual([r.body.calls.length, r.body.uploads.length, r.body.audio.length], [0, 0, 0]);
});

test('signed out is refused', async () => {
  const s = await setup();
  const res = await app.fetch(new Request('https://axal.vc/api/founder/validate/meetings'), s.env);
  assert.equal(res.status, 401);
});
