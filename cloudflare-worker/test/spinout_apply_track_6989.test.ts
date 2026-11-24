/**
 * D6989 (#6989): the Spin-Out Lab starting point (`track`) is validated and stored with the application.
 *
 * Through the real router (`routes/spinout_lab.ts`) on `node:sqlite`: the tables from `schema_baseline.sql`, then
 * migrations 315, 316 and 602 and this issue's migration, applied from their files.
 *   1. a known track is stored on the row and answered back;
 *   2. an unknown value is refused (400 `track_unknown`) and nothing is stored;
 *   3. a missing or empty value stores NULL, with and without answers;
 *   4. a database the track migration has not reached still takes an application without a track;
 *   5. the column refuses anything but the three ids at the database too.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/spinout_apply_track_6989.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import spinoutLab, { applicationTrack, LAB_TRACK_IDS } from '../src/routes/spinout_lab.ts';

const JWT_SECRET = 'unit-test-jwt-secret-6989-0123456789-abcdef';
const FOUNDER_ID = 117;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATIONS = ['315_spinout_application_lifecycle.sql', '316_spinout_application_interviews.sql', '602_lab_interview_outcome_and_reached_weeks.sql']
  .map((f) => read(`cloudflare-worker/sql/migrations/${f}`));
const TRACK_FILE = readdirSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations')).filter((f) => /^\d{12}_6989_/.test(f));
const M6989 = read(`cloudflare-worker/sql/migrations/${TRACK_FILE[0]}`);

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
const TABLES = ['users', 'user_spinout_flags', 'spinout_applications', 'spinout_lab_milestones',
  'cohort_cycles', 'cohort_applicants', 'cohort_cycle_events', 'cohort_app_notification_ledger',
  'activity_logs', 'admin_audit_log', 'week_windows'];

function freshDb({ track = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(ddl(t));
  for (const m of MIGRATIONS) db.exec(m);
  if (track) db.exec(M6989);
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', 'Ada Founder', 'ada@example.test', 1)`).run(FOUNDER_ID);
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x; return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(list: any[]) {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

const app = new Hono<any>();
app.route('/', spinoutLab);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 500));

async function apply(db: InstanceType<typeof DatabaseSync>, body: Record<string, unknown>) {
  const jwt = await new SignJWT({ user_id: FOUNDER_ID, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request('http://x/apply', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), APP_URL: 'https://example.test' } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const BASICS = { company_name: 'Test Robotics', idea: 'Warehouse picking arms', incorporated: 'no', stage: 'Idea / pre-formation' };
const ANSWERS = {
  origin: 'university', institution: 'Example University', research_group: 'Robotics Lab', tto_status: 'negotiating',
  ip: ['patent_filed'], team_size: 3, team_roles: 'Two researchers and an engineer', commercial_lead: false,
  traction: '', why_axal: 'We need the formation track and a cohort.',
};
const rows = (db: any) => (db.prepare('SELECT track FROM spinout_applications WHERE user_id = ?').all(FOUNDER_ID) as any[]).map((r) => ({ ...r }));

test('6989: one migration, named by its minute and this issue', () => {
  assert.equal(TRACK_FILE.length, 1);
  assert.match(M6989, /ALTER TABLE spinout_applications ADD COLUMN track TEXT CHECK \(track IS NULL OR track IN \('form', 'fit', 'line'\)\);/);
});

test('6989: the three ids, and the parse', () => {
  assert.deepEqual([...LAB_TRACK_IDS], ['form', 'fit', 'line']);
  for (const t of LAB_TRACK_IDS) assert.equal(applicationTrack(t), t);
  for (const none of [undefined, null, '']) assert.equal(applicationTrack(none), null);
  for (const bad of ['FIT', 'fit ', 'scale', 1, true, ['fit'], { id: 'fit' }]) assert.equal(applicationTrack(bad), 'invalid', JSON.stringify(bad));
});

test('6989: a known track is stored and answered back, with and without answers', async () => {
  for (const withAnswers of [true, false]) {
    const db = freshDb();
    const r = await apply(db, { ...BASICS, ...(withAnswers ? { answers: ANSWERS } : {}), track: 'fit' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(rows(db), [{ track: 'fit' }]);
    assert.equal(r.body.application.track, 'fit');
  }
});

test('6989: an unknown track is refused with a code, and nothing is stored', async () => {
  const db = freshDb();
  const r = await apply(db, { ...BASICS, answers: ANSWERS, track: 'scale' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'track_unknown');
  assert.match(r.body.message, /Form, Fit or Line/);
  assert.deepEqual(rows(db), []);
});

test('6989: a missing or empty track stores null, and the answer says null', async () => {
  for (const track of [undefined, '', null]) {
    const db = freshDb();
    const r = await apply(db, { ...BASICS, answers: ANSWERS, ...(track === undefined ? {} : { track }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(rows(db), [{ track: null }]);
    assert.equal(r.body.application.track, null);
  }
});

test('6989: a database without the track migration still takes an application without a track', async () => {
  const db = freshDb({ track: false });
  const r = await apply(db, { ...BASICS, answers: ANSWERS });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.application.track, null, 'read back without the column: not recorded');
  assert.equal(r.body.application.company_name, 'Test Robotics');
});

test('6989: the column refuses anything but the three ids', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO spinout_applications (user_id, company_name, idea, track) VALUES (?, 'Co', 'Idea', ?)`);
  ins.run(FOUNDER_ID, 'line');
  assert.throws(() => ins.run(FOUNDER_ID, 'scale'), /CHECK constraint failed/);
});
