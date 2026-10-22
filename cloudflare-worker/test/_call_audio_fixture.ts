/**
 * D877 (#2524) — the session fixture the call-audio tests share
 * (`call_retention_d877`, `meeting_readiness_d877`): real SQLite as D872's
 * upload test builds it (migration 438 and the ones after it, then 489 and
 * 530), in-memory R2, a Workers AI stand-in that counts its calls, and the
 * real session routes behind a signed session. Invented names and words only.
 */
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
import { AUDIO_PREFIX } from '../src/services/interviewSessions.ts';

export const JWT_SECRET = 'd877-fixture-only-signing-secret-0123456789';
export const mig = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
export const FOUNDER = 2;
export const OTHER = 3;
export const PROJECT = 10;
export const INTERVIEW = 1;
export const NOW = new Date('2026-10-22T12:00:00.000Z');
// Invented words; no customer content anywhere in this file.
export const SAID = 'Synthetic transcript line for D877.';

export function fixture({ monthMicro = 500_000_000 } = {}) {
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
      stage TEXT, invited_at TEXT, booked_at TEXT, done_at TEXT, channel TEXT, segment_id INTEGER,
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
  db.exec(mig('489_interview_findings.sql'));
  db.exec(mig('530_call_audio_retention.sql'));
  db.prepare('UPDATE users SET founder_id = 100 WHERE id = 2').run();
  db.prepare('UPDATE users SET founder_id = 300 WHERE id = 3').run();
  db.exec(`INSERT INTO projects VALUES (${PROJECT}, 'Venture', 100);
           INSERT INTO discovery_interviews (id, project_id, interviewee_name, stage, quote_consent) VALUES (${INTERVIEW}, ${PROJECT}, 'Dana', 'done', 1);`);
  applyEngineSchema(db);
  applySessionTranslationColumns(db); // D857: migration 527's segment columns, as production has them.
  db.exec(mig('529_meeting_transcript_source.sql')); // D870: the ref's transcript source.
  setFixtureAllowance(db, monthMicro);

  const objects = new Map<string, Uint8Array>();
  const FILES = {
    async put(key: string, value: ArrayBuffer) { objects.set(key, new Uint8Array(value)); },
    async get(key: string) { const v = objects.get(key); return v ? { arrayBuffer: async () => v.buffer } : null; },
    async head(key: string) { return objects.has(key) ? {} : null; },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) objects.delete(k); },
  };
  const stt: number[] = [];
  const AI = withGuard({
    async run(model: string, input: any) {
      if (/whisper|nova/.test(model)) {
        stt.push(Array.isArray(input?.audio) ? input.audio.length : 0);
        return { text: SAID, transcription_info: { language: 'en' }, segments: [{ start: 0, end: 3, text: SAID }] };
      }
      return { response: JSON.stringify({ sentences: [], placements: [] }) };
    },
  });
  const env = { DB: f.DB, JWT_SECRET, ENVIRONMENT: 'development', FILES, AI } as any;
  return { db, env, objects, stt };
}

let serial = 0;
/**
 * One session with `chunks` audio parts that arrived `ageDays` before NOW, and
 * one final segment. `kind` makes it a Zoom call (a ref), an upload, or the
 * in-person recorder (neither: not a call).
 */
export function seed(w: ReturnType<typeof fixture>, { kind = 'upload', ageDays = 31, chunks = 2, owner = FOUNDER, stage = 'done' as string | null } = {}) {
  const uid = `d877-${++serial}`;
  const ts = new Date(NOW.getTime() - ageDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  w.db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, submitted_via, processing_stage, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'transcribed', 'given', ?, ?, ?, ?)`)
    .run(uid, INTERVIEW, PROJECT, owner, kind === 'recorder' ? 'in_person' : 'video', kind === 'upload' ? 'upload' : null, stage, ts, ts);
  const id = Number((w.db.prepare('SELECT id FROM interview_sessions WHERE uid = ?').get(uid) as any).id);
  if (kind === 'zoom') {
    w.db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, status)
                  VALUES (?, 'zoom', ?, ?, ?, ?, 'imported')`).run(`ref-${uid}`, `mtg-${uid}`, id, INTERVIEW, owner);
  }
  for (let seq = 0; seq < chunks; seq += 1) {
    const key = `${AUDIO_PREFIX}${owner}/${uid}/${seq}.wav`;
    w.objects.set(key, new Uint8Array([1, 2, 3]));
    w.db.prepare('INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, 3, ?)')
      .run(id, seq, key, 'audio/wav', ts);
  }
  w.db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text) VALUES (?, 'final', 0, 1000, 'Speaker 1', ?)`)
    .run(id, SAID);
  return id;
}

export const n = (db: any, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as any).n);
export const chunkCount = (w: any, id: number) => n(w.db, 'SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id = ?', id);
export const segmentCount = (w: any, id: number) => n(w.db, 'SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id = ?', id);
export const objectsOf = (w: any, id: number) => {
  const uid = (w.db.prepare('SELECT uid FROM interview_sessions WHERE id = ?').get(id) as any)?.uid;
  return [...w.objects.keys()].filter((k) => uid && k.includes(`/${uid}/`)).length;
};
export const removed = (w: any, id: number) => w.db.prepare('SELECT audio_removed_at AS at, audio_removed_reason AS reason FROM interview_sessions WHERE id = ?').get(id) as any;

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', sessions as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

export async function call(env: any, user: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

