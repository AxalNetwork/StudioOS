/**
 * D383 — the Spin-Out Lab application lifecycle, backend half: answers, the
 * draft, withdrawal, the partner interview, the applicant-facing note, and
 * the applicant block on GET /state.
 *
 * Driven through the real routers (`routes/spinout_lab.ts`,
 * `routes/admin_cohort.ts`) on real `node:sqlite`: every table from
 * `schema_baseline.sql`, then migrations 315 and 316 applied from their own
 * files — so this also proves the migrations run on the production schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import spinoutLab from '../src/routes/spinout_lab.ts';
import adminCohort from '../src/routes/admin_cohort.ts';
import { normaliseAnswers, missingForSubmit, applicantView } from '../src/services/applicationLifecycle.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_ID = 900;
const FOUNDER_ID = 117;
const INVESTOR_ID = 118;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const M315 = read('cloudflare-worker/sql/migrations/315_spinout_application_lifecycle.sql');
const M316 = read('cloudflare-worker/sql/migrations/316_spinout_application_interviews.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const TABLES = ['users', 'user_spinout_flags', 'spinout_applications', 'spinout_lab_milestones',
  'cohort_cycles', 'cohort_applicants', 'cohort_cycle_events', 'cohort_app_notification_ledger',
  'activity_logs', 'admin_audit_log', 'week_windows'];

function freshDb({ migrate = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(ddl(t));
  if (migrate) { db.exec(M315); db.exec(M316); }
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  u.run(ADMIN_ID, 'admin', 'Admin One', 'admin@example.test');
  u.run(FOUNDER_ID, 'founder', 'Ada Founder', 'ada@example.test');
  u.run(INVESTOR_ID, 'investor', 'Ivy Investor', 'ivy@example.test');
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x; return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // Real D1 runs a batch as one transaction; so does this.
    async batch(list: any[]) {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

/**
 * `app.onError` lives in index.ts and is not in the chain for a directly
 * dispatched sub-app, so the auth refusals are mapped here as index.ts maps
 * them; anything else surfaces as the 500 it would be.
 */
const wrapped = new Map<any, any>();
function appFor(router: any) {
  if (!wrapped.has(router)) {
    const a = new Hono<any>();
    a.route('/', router);
    a.onError((err: any, c) => {
      const msg = String(err?.message || '');
      if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
      if (msg === 'Admin required') return c.json({ detail: msg }, 403);
      return c.json({ detail: msg }, 500);
    });
    wrapped.set(router, a);
  }
  return wrapped.get(router);
}

async function call(router: any, db: InstanceType<typeof DatabaseSync>, path: string, init: RequestInit = {}, as = FOUNDER_ID) {
  const role = as === ADMIN_ID ? 'admin' : as === INVESTOR_ID ? 'investor' : 'founder';
  const jwt = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await appFor(router).fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), APP_URL: 'https://example.test' } as any,
  );
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}
const lab = (db: any, path: string, init?: RequestInit, as?: number) => call(spinoutLab, db, path, init, as);
const admin = (db: any, path: string, init?: RequestInit) => call(adminCohort, db, path, init, ADMIN_ID);
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

const ANSWERS = {
  origin: 'university', institution: 'Example University', research_group: 'Robotics Lab',
  tto_status: 'negotiating', ip: ['patent_filed', 'inventors_identified', 'not_a_flag'],
  team_size: 3, team_roles: 'Two researchers and an engineer', commercial_lead: false,
  traction: '', why_axal: 'We need the formation track and a cohort.', stray_key: 'dropped',
};
const BASICS = { company_name: 'Test Robotics', idea: 'Warehouse picking arms', incorporated: 'no', stage: 'Idea / pre-formation' };

async function apply(db: any, extra: Record<string, unknown> = {}) {
  return lab(db, '/apply', json('POST', { ...BASICS, answers: ANSWERS, ...extra }));
}
const appRow = (db: any) => db.prepare(`SELECT * FROM spinout_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(FOUNDER_ID) as any;
const poolRow = (db: any) => db.prepare(`SELECT * FROM cohort_applicants WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(FOUNDER_ID) as any;

// ---------------------------------------------------------------------------
// The pure half.
// ---------------------------------------------------------------------------

test('answers normalise to closed sets; unknown values become null, unknown keys drop', () => {
  const a = normaliseAnswers({ ...ANSWERS, origin: 'moon', tto_status: 'maybe', team_size: 99 });
  assert.equal(a.origin, null);
  assert.equal(a.tto_status, null);
  assert.equal(a.team_size, null, 'a team size outside 1–50 is not recorded');
  assert.deepEqual(a.ip, ['patent_filed', 'inventors_identified']);
  assert.equal(a.traction, null, 'an empty optional answer is not recorded');
  assert.ok(!('stray_key' in a));
});

test('what a submission must carry depends on the origin', () => {
  assert.deepEqual(missingForSubmit(normaliseAnswers(ANSWERS)), []);
  assert.deepEqual(missingForSubmit(normaliseAnswers({ ...ANSWERS, tto_status: null })), ['tto_status']);
  assert.deepEqual(missingForSubmit(normaliseAnswers({ ...ANSWERS, origin: 'independent', tto_status: null, institution: null })), []);
  assert.deepEqual(missingForSubmit(normaliseAnswers({})), ['origin', 'team_size', 'why_axal']);
});

test('the applicant view never carries the internal decision reason', () => {
  const v = applicantView(
    { id: 1, status: 'refused', created_at: 'x', decided_at: 'y', applicant_note: 'Timing, not a verdict.', applicant_asks_json: '["a","b","c","d"]' },
    { status: 'rejected', decided_at: 'y', cycle_label: 'November 2026', cycle_app_status: 'reviewing', cycle_start_at: null, cycle_close_at: null,
      // A stray field the loader must never pass: proven not to leak.
      ...({ decision_reason: 'INTERNAL: capacity roll' } as any) },
    null,
    { label: 'December 2026', opens_at: 'o', closes_at: 'c' },
  );
  assert.ok(!JSON.stringify(v).includes('INTERNAL'), 'the admin’s internal reason reached the applicant view');
  assert.deepEqual(v!.note!.asks, ['a', 'b', 'c'], 'more than three asks reached the applicant');
  assert.equal(v!.reapply!.label, 'December 2026');
});

// ---------------------------------------------------------------------------
// The draft.
// ---------------------------------------------------------------------------

test('a draft saves, reads back, replaces and discards', async () => {
  const db = freshDb();
  assert.deepEqual((await lab(db, '/apply/draft')).body, { draft: null });
  const s1 = await lab(db, '/apply/draft', json('PUT', { answers: { company_name: 'Draft Co', origin: 'independent' } }));
  assert.equal(s1.status, 200);
  assert.ok(s1.body.updated_at, 'the save did not report when it happened');
  await lab(db, '/apply/draft', json('PUT', { answers: { company_name: 'Draft Co 2' } }));
  const g = await lab(db, '/apply/draft');
  assert.equal(g.body.draft.answers.company_name, 'Draft Co 2', 'a second save did not replace the first');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM spinout_application_drafts`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM spinout_applications`).get().n, 0, 'a draft became an application');
  await lab(db, '/apply/draft', json('DELETE'));
  assert.deepEqual((await lab(db, '/apply/draft')).body, { draft: null });
});

test('an account that cannot apply cannot draft either', async () => {
  const db = freshDb();
  const r = await lab(db, '/apply/draft', json('PUT', { answers: { company_name: 'x' } }), INVESTOR_ID);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'role_cannot_apply');
});

// ---------------------------------------------------------------------------
// Submission with answers.
// ---------------------------------------------------------------------------

test('a submission with incomplete answers is refused and stores nothing', async () => {
  const db = freshDb();
  const r = await apply(db, { answers: { ...ANSWERS, why_axal: '' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'answers_incomplete');
  assert.deepEqual(r.body.missing, ['why_axal']);
  assert.equal(appRow(db), undefined);
});

test('a submission stores its normalised answers in the same row, and clears the draft', async () => {
  const db = freshDb();
  await lab(db, '/apply/draft', json('PUT', { answers: { company_name: 'Draft Co' } }));
  const r = await apply(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const stored = JSON.parse(appRow(db).answers_json);
  assert.equal(stored.origin, 'university');
  assert.deepEqual(stored.ip, ['patent_filed', 'inventors_identified']);
  assert.ok(!('stray_key' in stored));
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM spinout_application_drafts`).get().n, 0, 'the draft outlived the submission');
});

test('an older client that sends no answers still applies, and the view says none were asked', async () => {
  const db = freshDb();
  const r = await lab(db, '/apply', json('POST', BASICS));
  assert.equal(r.status, 200);
  assert.equal(appRow(db).answers_json, null);
  const s = await lab(db, '/state');
  assert.equal(s.body.applicant.answers_recorded, false);
  assert.equal(s.body.applicant.answers, null);
});

// ---------------------------------------------------------------------------
// /state's applicant block.
// ---------------------------------------------------------------------------

test('/state shows the applicant their pool status and cycle, never the internal reason', async () => {
  const db = freshDb();
  await apply(db);
  const pool = poolRow(db);
  assert.ok(pool, 'the application was not placed in a cycle');
  db.prepare(`UPDATE cohort_applicants SET status = 'waitlisted', decision_reason = 'INTERNAL: over capacity' WHERE id = ?`).run(pool.id);
  const s = await lab(db, '/state');
  assert.equal(s.status, 200);
  assert.equal(s.body.applicant.status, 'pending');
  assert.equal(s.body.applicant.pool.status, 'waitlisted');
  assert.ok(s.body.applicant.pool.cycle.label, 'the cycle has no label');
  assert.equal(s.body.applicant.reapply, null, 'an applicant still in review was told when to reapply');
  assert.ok(!JSON.stringify(s.body).includes('INTERNAL'), 'the internal decision reason reached the applicant');
});

test('/state on a database without migration 315 answers with applicant null, not an error', async () => {
  const db = freshDb({ migrate: false });
  db.prepare(`INSERT INTO spinout_applications (user_id, company_name, idea) VALUES (?, 'Old Co', 'Old idea')`).run(FOUNDER_ID);
  const s = await lab(db, '/state');
  assert.equal(s.status, 200);
  assert.equal(s.body.applicant, null);
  assert.equal(s.body.application.company_name, 'Old Co', 'the legacy application block regressed');
});

test('on a database without migration 315, answers and withdrawal refuse with a code, never a 500', async () => {
  const db = freshDb({ migrate: false });
  const a = await apply(db);
  assert.equal(a.status, 503);
  assert.equal(a.body.error, 'application_not_saved');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM spinout_applications`).get().n, 0,
    'the application was stored without the answers it was submitted with');
  db.prepare(`INSERT INTO spinout_applications (user_id, company_name, idea) VALUES (?, 'Old Co', 'Old idea')`).run(FOUNDER_ID);
  const w = await lab(db, '/apply/withdraw', json('POST', {}));
  assert.equal(w.status, 503);
  assert.equal(w.body.error, 'withdraw_unavailable');
  assert.equal(appRow(db).status, 'pending');
});

// ---------------------------------------------------------------------------
// The admin's decision and the applicant-facing note.
// ---------------------------------------------------------------------------

test('a declined applicant is shown the note written for them, three asks at most, and when to reapply', async () => {
  const db = freshDb();
  await apply(db);
  const pool = poolRow(db);
  const d = await admin(db, `/applications/${pool.id}/decide`, json('POST', {
    status: 'rejected', reason: 'INTERNAL: commercial gap',
    applicant_note: 'The technology is credible; the commercial side is not yet.',
    applicant_asks: ['Ten customer conversations.', 'A commercial co-founder.', 'The licence signed.', 'A fourth ask'],
  }));
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.applicant_note_saved, true);
  const s = await lab(db, '/state');
  assert.equal(s.body.applicant.note.text, 'The technology is credible; the commercial side is not yet.');
  assert.equal(s.body.applicant.note.asks.length, 3);
  assert.ok(s.body.applicant.reapply?.label, 'a declined applicant is not told when to reapply');
  assert.ok(!JSON.stringify(s.body).includes('INTERNAL'), 'the internal reason reached the applicant');
});

test('a decision without an applicant note records none', async () => {
  const db = freshDb();
  await apply(db);
  const d = await admin(db, `/applications/${poolRow(db).id}/decide`, json('POST', { status: 'waitlisted', reason: 'Cohort full' }));
  assert.equal(d.body.applicant_note_saved, null);
  assert.equal((await lab(db, '/state')).body.applicant.note, null);
});

// ---------------------------------------------------------------------------
// Withdrawal.
// ---------------------------------------------------------------------------

test('withdrawing clears the file, leaves the pool, cancels the interview, and frees a reapplication', async () => {
  const db = freshDb();
  await apply(db);
  const pool = poolRow(db);
  const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
  assert.equal((await admin(db, `/applications/${pool.id}/interview`, json('POST', { scheduled_at: later }))).status, 201);
  const w = await lab(db, '/apply/withdraw', json('POST'));
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const row = appRow(db);
  assert.equal(row.status, 'withdrawn');
  assert.equal(row.answers_json, null, 'the answers survived a withdrawal');
  assert.equal(row.idea, '', 'the idea survived a withdrawal');
  assert.ok(row.withdrawn_at);
  assert.equal(poolRow(db).status, 'withdrawn', 'the pool still counts a withdrawn applicant');
  assert.equal(db.prepare(`SELECT status FROM spinout_application_interviews ORDER BY id DESC LIMIT 1`).get().status, 'cancelled');
  assert.equal((await lab(db, '/apply/withdraw', json('POST'))).body.error, 'not_withdrawable');
  const again = await apply(db);
  assert.equal(again.status, 200, 'a withdrawn applicant could not apply again');
});

test('a decided application cannot be withdrawn', async () => {
  const db = freshDb();
  await apply(db);
  await admin(db, `/applications/${poolRow(db).id}/decide`, json('POST', { status: 'rejected', reason: 'No' }));
  const w = await lab(db, '/apply/withdraw', json('POST'));
  assert.equal(w.status, 409);
  assert.equal(w.body.error, 'not_withdrawable');
});

test('an admin cannot decide an applicant who withdrew', async () => {
  const db = freshDb();
  await apply(db);
  const pool = poolRow(db);
  await lab(db, '/apply/withdraw', json('POST'));
  const d = await admin(db, `/applications/${pool.id}/decide`, json('POST', { status: 'approved', reason: 'Yes' }));
  assert.equal(d.status, 409);
  assert.equal(poolRow(db).status, 'withdrawn');
});

// ---------------------------------------------------------------------------
// The interview.
// ---------------------------------------------------------------------------

test('an admin schedules, re-schedules and cancels; the applicant sees only the live one', async () => {
  const db = freshDb();
  await apply(db);
  const pool = poolRow(db);
  const past = await admin(db, `/applications/${pool.id}/interview`, json('POST', { scheduled_at: '2020-01-01T10:00:00Z' }));
  assert.equal(past.body.error, 'time_in_past');
  const t1 = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const t2 = new Date(Date.now() + 5 * 86_400_000).toISOString();
  assert.equal((await admin(db, `/applications/${pool.id}/interview`, json('POST', { scheduled_at: t1, duration_min: 45, location: 'Video' }))).status, 201);
  assert.equal((await admin(db, `/applications/${pool.id}/interview`, json('POST', { scheduled_at: t2 }))).status, 201);
  const rows = db.prepare(`SELECT status FROM spinout_application_interviews ORDER BY id`).all().map((r: any) => r.status);
  assert.deepEqual(rows, ['cancelled', 'scheduled'], 'a re-schedule left two live interviews');
  const s = await lab(db, '/state');
  assert.equal(s.body.applicant.interview.scheduled_at, t2.replace('T', ' ').slice(0, 19));
  assert.equal((await admin(db, `/applications/${pool.id}/interview/cancel`, json('POST'))).status, 200);
  assert.equal((await lab(db, '/state')).body.applicant.interview, null, 'a cancelled interview is still shown');
  assert.equal((await admin(db, `/applications/${pool.id}/interview/cancel`, json('POST'))).body.error, 'no_scheduled_interview');
  assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'cohort_interview_scheduled'`).get().n >= 2,
    'scheduling was not recorded');
});

test('a founder cannot schedule an interview', async () => {
  const db = freshDb();
  await apply(db);
  const r = await call(adminCohort, db, `/applications/${poolRow(db).id}/interview`,
    json('POST', { scheduled_at: new Date(Date.now() + 86_400_000).toISOString() }), FOUNDER_ID);
  assert.equal(r.status, 403);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM spinout_application_interviews`).get().n, 0);
});

test('the applicant can ask to move the interview; it does not move', async () => {
  const db = freshDb();
  await apply(db);
  assert.equal((await lab(db, '/apply/interview/reschedule', json('POST', { reason: 'Travelling' }))).body.error, 'no_scheduled_interview');
  const t1 = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await admin(db, `/applications/${poolRow(db).id}/interview`, json('POST', { scheduled_at: t1 }));
  assert.equal((await lab(db, '/apply/interview/reschedule', json('POST', { reason: ' ' }))).body.error, 'reason_required');
  const r = await lab(db, '/apply/interview/reschedule', json('POST', { reason: 'Any afternoon next week' }));
  assert.equal(r.status, 200);
  assert.ok(r.body.applicant.interview.reschedule_requested_at, 'the request was not recorded');
  assert.equal(r.body.applicant.interview.scheduled_at, t1.replace('T', ' ').slice(0, 19), 'asking moved the interview');
});

test('the admin list carries each applicant’s answers, note and live interview', async () => {
  const db = freshDb();
  await apply(db);
  const pool = poolRow(db);
  await admin(db, `/applications/${pool.id}/interview`, json('POST', { scheduled_at: new Date(Date.now() + 86_400_000).toISOString() }));
  const l = await admin(db, '/applications');
  assert.equal(l.status, 200);
  const a = l.body.cycles.flatMap((c: any) => c.applicants).find((x: any) => x.id === pool.id);
  assert.equal(a.answers.origin, 'university');
  assert.equal(a.answers_recorded, true);
  assert.equal(a.interview.status, 'scheduled');
});
