/**
 * D778 part 6 (#2103) — the founder's transcriptions through the run path:
 * `transcribe:recording` (an interview's attached recording, and a stopped
 * session's Transcribe), `transcribe:session` (Stop and process, in the job)
 * and `transcribe:voice-answer` (the Studio mic). Each run names the page and
 * option D771's inventory gives it; a mounted rail's page and the press's
 * option win where the run has a request. The session cases are in
 * `interview_sessions_d657.test.ts`, on its fixture.
 *
 * Real SQLite (the baseline plus every migration above BASELINE_CUTOFF), a
 * stubbed, guarded model, an in-memory R2, made-up data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/founder_transcribe_d778.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import founderValidate from '../src/routes/founder_validate.ts';
import { CUSTOMER_RESEARCH_PAGE, TRANSCRIBE_OPTIONS } from '../src/services/interviewProcessing.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { ADVISOR_RAIL_OPTIONS as ADVISOR_OPTIONS } from '../../frontend/src/lib/railOptions/advisor.js';
import { PARTNER_RAIL_OPTIONS as PARTNER_OPTIONS } from '../../frontend/src/lib/railOptions/partner.js';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d778-transcribe-0123456789';
const FOUNDER = 1; const PID = 7; const IID = 31;
const KEY = `validate-audio/interviews/${IID}.webm`;
const SAID = 'We reconcile freight invoices by hand every Friday.';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Kestrel Labs', 10);
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${FOUNDER}, 5000000);`);
  db.prepare('INSERT INTO discovery_interviews (id, project_id, interviewee_name, recording_r2_key, recording_size_bytes) VALUES (?, ?, ?, ?, ?)')
    .run(IID, PID, 'Ola Ops', KEY, 64);
  return db;
}

async function transcribe(db: any, headers: Record<string, string> = {}) {
  const audio = new Uint8Array(64).fill(7);
  const FILES = { async get(k: string) { return k === KEY ? { arrayBuffer: async () => audio.buffer.slice(0) } : null; } };
  const AI = withGuard({ run: async () => ({ text: SAID, transcription_info: { language: 'en' }, segments: [{ start: 0, end: 3, text: SAID }] }) });
  const app = new Hono<any>();
  app.route('/api/founder/validate', founderValidate);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/founder/validate/interviews/${IID}/transcribe`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers },
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI, FILES } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const runs = (db: any) => (db.prepare(`SELECT user_id, rail_page, rail_option, record_ref FROM ai_usage_logs WHERE task = 'transcribe' AND guard_for IS NULL ORDER BY id`).all() as any[]).map((r) => ({ ...r }));

test('D778: the transcribe options name the page and keys D771\'s inventory gives them', () => {
  const rows = (key: string) => FOUNDER_OPTIONS.filter((o: any) => o.key === key);
  for (const key of Object.values(TRANSCRIBE_OPTIONS)) {
    assert.equal(rows(key).length, 1, key);
    assert.equal(rows(key)[0].page, CUSTOMER_RESEARCH_PAGE, key);
  }
  // The Studio mic is one route for three profiles, and each inventory names it the same.
  for (const list of [FOUNDER_OPTIONS, ADVISOR_OPTIONS, PARTNER_OPTIONS]) {
    assert.ok(list.some((o: any) => o.key === 'transcribe:voice-answer'), 'every profile names the mic transcribe:voice-answer');
  }
  const advisor = readFileSync(resolve(here, '../src/routes/advisor.ts'), 'utf8');
  const post = advisor.slice(advisor.indexOf("advisor.post('/transcribe'"));
  assert.match(post.slice(0, post.indexOf('\n});')), /railFor\(c, \{ page: pageFromPath\(AI_SURFACE\.studio, 'studio'\), option: 'transcribe:voice-answer' \}\)/);
});

test('D778: an interview\'s recording, transcribed with no rail context, names the inventoried page and option', async () => {
  // Mutation checked: keep the old fallback → the row reads 'validate' and 'transcribe:interview'.
  const db = fixture();
  const r = await transcribe(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.transcript, SAID);
  assert.deepEqual(runs(db), [{ user_id: FOUNDER, rail_page: CUSTOMER_RESEARCH_PAGE, rail_option: 'transcribe:recording', record_ref: `interview:${IID}` }]);
});

test('D778: a mounted rail\'s page and the press\'s option win; the record stays the route\'s interview', async () => {
  const db = fixture();
  const r = await transcribe(db, { 'X-Rail-Page': 'validate', 'X-Rail-Option': encodeURIComponent('transcribe:recording'), 'X-Rail-Record': 'interview:999' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(runs(db).map((x) => [x.rail_page, x.rail_option, x.record_ref]), [['validate', 'transcribe:recording', `interview:${IID}`]],
    'the mounted page holds the member\'s Manual switch; the browser\'s record label never replaces the scoped interview');
});
