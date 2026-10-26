/**
 * D1230 (#3238) — KYC part 2: sanctions screening on submission, the review
 * write for a match, and Send to HQ (migration 615) with HQ's decide route.
 *
 * Runs the real routes on an in-memory D1 holding migration 615 as written,
 * with the three list hosts stubbed: no test reaches a real provider.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/kyc_hq_d1230.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import kyc from '../src/routes/kyc.ts';
import trust from '../src/routes/trust.ts';
import { ensureSanctionsSchema } from '../src/services/sanctions.ts';
import { caseScreening } from '../src/services/kycHq.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'synthetic-test-secret-d1230-not-production';
const MIGRATION = readFileSync('cloudflare-worker/sql/migrations/615_kyc_hq_referrals.sql', 'utf8');
const ADMIN = 1;
const SUPER = 2;
const MEMBER = 7;
const LISTED = { first: 'Fixture Listed', last: 'Entity', dob: '1970-01-01' };
const CLEAR = { first: 'Fixture', last: 'Unrelated Member', dob: '1990-01-02' };

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      kyc_status TEXT, kyc_data TEXT, kyc_provider TEXT, kyc_submitted_at TEXT,
      kyc_reviewed_at TEXT, kyc_reviewed_by INTEGER, kyc_rejection_reason TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_sessions (jti TEXT PRIMARY KEY, user_id INTEGER, factor TEXT, created_at TEXT, last_step_up_at TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, details TEXT, actor TEXT, user_id INTEGER);
    CREATE TABLE corporate_profiles (user_id INTEGER PRIMARY KEY, sanctions_last_checked_at TEXT, entity_name TEXT, registered_country TEXT);
    INSERT INTO users (id, email, name, role, kyc_status) VALUES
      (1, 'admin@example.invalid', 'Admin A', 'admin', 'not_started'),
      (2, 'super@example.invalid', 'Super Admin B', 'admin', 'not_started'),
      (7, 'member@example.invalid', 'Member C', 'founder', 'not_started');
    INSERT INTO super_admins (user_id) VALUES (2);
  `);
  db.exec(MIGRATION);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureSanctionsSchema(env);
  return { db, env };
}

const BODIES: Record<string, unknown> = {
  ofac: [{ displayName: 'Fixture Listed Entity', uid: 'fixture-ofac', dateOfBirth: LISTED.dob }],
  eu: { entries: [{ nameAlias: [{ wholeName: 'Fixture EU Designation' }], id: 'fixture-eu' }] },
  uk_hmt: { Designations: [{ PrimaryName: 'Fixture UK Designation', GroupID: 'fixture-uk' }] },
};
function hostOf(url: string) {
  const h = new URL(url).hostname;
  if (h === 'sanctionslistservice.ofac.treas.gov') return 'ofac';
  if (h === 'webgate.ec.europa.eu') return 'eu';
  if (h === 'ofsistorage.blob.core.windows.net') return 'uk_hmt';
  throw new Error('Unexpected network request');
}
/** The list hosts, stubbed; `down` makes one fail, so no screening completes. */
function stubLists(t: any, down: string | null = null) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const p = hostOf(String(input));
    if (p === down) throw new Error('Fixture provider unavailable');
    return Response.json(BODIES[p]);
  }) as any;
  t.after(() => { globalThis.fetch = original; });
}

const app = (() => {
  const a = new Hono();
  a.route('/api/kyc', kyc as any);
  a.route('/api/trust', trust as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: String(err?.message || 'Internal server error') }, 500);
  });
  return a;
})();

/** A call as `userId`; `stepUp` gives the session a fresh TOTP factor. */
async function call(env: any, db: DatabaseSync, userId: number, method: string, path: string, body?: unknown, { stepUp = true } = {}) {
  const jti = `jti-${userId}-${Math.random().toString(36).slice(2)}`;
  if (stepUp) {
    db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES (?, ?, 'totp', strftime('%Y-%m-%d %H:%M:%S','now'))").run(jti, userId);
  }
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any).role;
  const tok = await new SignJWT({ user_id: userId, role, jti }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const submission = (p: { first: string; last: string; dob: string }, extra: Record<string, unknown> = {}) => ({
  legal_first_name: p.first, legal_last_name: p.last, date_of_birth: p.dob, country: 'GB', address_line1: '1 Fixture Road',
  city: 'Fixture City', postal_code: 'FX1 1XF', id_type: 'passport', id_number: 'FX123456',
  id_document_base64: 'data:image/png;base64,iVBORw0KGgo=', ...extra,
});
const rows = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];

// ---------------------------------------------------------------- the migration

test('615: one undecided referral per person and reason; reasons, verdicts and outcomes are checked', async () => {
  const { db } = await fixture();
  db.exec("INSERT INTO kyc_hq_referrals (user_id, reason) VALUES (7, 'pep')");
  assert.throws(() => db.exec("INSERT INTO kyc_hq_referrals (user_id, reason) VALUES (7, 'pep')"), /UNIQUE/);
  db.exec("INSERT INTO kyc_hq_referrals (user_id, reason) VALUES (7, 'admin')");
  db.exec("UPDATE kyc_hq_referrals SET decided_at = CURRENT_TIMESTAMP, decision = 'approved' WHERE reason = 'pep'");
  db.exec("INSERT INTO kyc_hq_referrals (user_id, reason) VALUES (7, 'pep')");
  assert.throws(() => db.exec("INSERT INTO kyc_hq_referrals (user_id, reason) VALUES (7, 'other')"), /CHECK/);
  assert.throws(() => db.exec("UPDATE kyc_hq_referrals SET decision = 'maybe'"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO kyc_screening_attempts (user_id, outcome) VALUES (7, 'clear')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO kyc_screening_attempts (user_id, outcome, reason) VALUES (7, 'unreadable', 'Fixture Listed Entity')"), /CHECK/, 'a reason is a code, never list text');
});

// ---------------------------------------------------------------- screening on submission

test('a submission that matches is screened, recorded, and sent to HQ on its own; the member is not told', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  const r = await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(LISTED));
  assert.equal(r.status, 200);
  assert.equal(r.body.kyc_status, 'pending');
  assert.doesNotMatch(r.text, /sanction|match|screen|HQ/i, 'the member reads nothing of the screening');
  const [s] = rows(db, 'SELECT id, hit, severity FROM sanctions_screenings WHERE user_id = ?', MEMBER);
  assert.equal(s.hit, 1);
  assert.deepEqual(rows(db, 'SELECT outcome, reason, screening_id FROM kyc_screening_attempts').map((a) => ({ ...a })), [{ outcome: 'screened', reason: null, screening_id: s.id }]);
  const refs = rows(db, 'SELECT reason, raised_by, screening_id, decided_at FROM kyc_hq_referrals WHERE user_id = ?', MEMBER).map((x) => ({ ...x }));
  assert.deepEqual(refs, [{ reason: 'sanctions_match', raised_by: null, screening_id: s.id, decided_at: null }], 'raised by the Worker, not a person');
  const view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.equal(view.body.screening.state, 'match');
  assert.equal(view.body.screening.reviewed, null);
  assert.equal(view.body.hq.state, 'ready');
  assert.equal(view.body.hq.with_hq, true);
  assert.deepEqual(view.body.hq.open.map((x: any) => x.reason), ['sanctions_match']);
});

test('a clear submission with a PEP disclosure goes to HQ for PEP alone; the case reads clear', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  const r = await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(CLEAR, { pep_self_disclosed: true }));
  assert.equal(r.status, 200);
  assert.deepEqual(rows(db, 'SELECT reason FROM kyc_hq_referrals').map((x) => x.reason), ['pep']);
  const view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.equal(view.body.screening.state, 'clear');
  assert.equal(view.body.hq.open[0].reason, 'pep');
  assert.equal(view.body.hq.open[0].raised_by, null);
});

test('a clear submission with no PEP disclosure is not sent to HQ', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(CLEAR));
  assert.equal(rows(db, 'SELECT * FROM kyc_hq_referrals').length, 0);
  const view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.deepEqual([view.body.screening.state, view.body.hq.with_hq], ['clear', false]);
});

test('an unreadable screening never reads as clear: the submission stands, the attempt says why, and a failed read says so too', async (t) => {
  const { db, env } = await fixture();
  stubLists(t, 'eu');
  const r = await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(CLEAR));
  assert.equal(r.status, 200);
  assert.equal(r.body.kyc_status, 'pending', 'a list that is down does not fail the submission');
  assert.equal(rows(db, 'SELECT * FROM sanctions_screenings').length, 0, 'no result is recorded');
  assert.deepEqual(rows(db, 'SELECT outcome, reason FROM kyc_screening_attempts').map((a) => ({ ...a })), [{ outcome: 'unreadable', reason: 'lists_unavailable' }]);
  let view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.equal(view.body.screening.state, 'unreadable');
  assert.equal(view.body.screening.reason, 'lists_unavailable');
  // An older clear run does not cover a later failed one.
  db.exec("INSERT INTO sanctions_screenings (user_id, provider, run_at, hit, severity) VALUES (7, 'aggregate', '2000-01-01 00:00:00', 0, 'none')");
  view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.equal(view.body.screening.state, 'unreadable');
  // A run after the failure is the answer.
  db.exec("INSERT INTO sanctions_screenings (user_id, provider, run_at, hit, severity) VALUES (7, 'aggregate', '2999-01-01 00:00:00', 0, 'none')");
  view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.equal(view.body.screening.state, 'clear');
  // A store that cannot be read is unreadable, and HQ's block is too.
  db.exec('DROP TABLE kyc_screening_attempts; DROP TABLE kyc_hq_referrals;');
  view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.deepEqual([view.body.screening.state, view.body.screening.reason], ['unreadable', 'read_failed']);
  assert.equal(view.body.hq.state, 'unreadable', 'a failed read is never "not with HQ"');
});

test('a screening whose result could not be written is unreadable, never clear', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  // The schema is already ensured for this env, so the insert simply fails.
  db.exec('DROP TABLE sanctions_screenings');
  const r = await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(CLEAR));
  assert.equal(r.status, 200);
  assert.deepEqual(rows(db, 'SELECT outcome, reason FROM kyc_screening_attempts').map((a) => ({ ...a })), [{ outcome: 'unreadable', reason: 'not_recorded' }]);
});

test('a person never screened reads not run, never clear', async () => {
  const { env } = await fixture();
  assert.deepEqual(await caseScreening(env, MEMBER), { state: 'not_run' });
});

// ---------------------------------------------------------------- deciding a case with HQ

async function withHq(t: any) {
  const f = await fixture();
  stubLists(t);
  await call(f.env, f.db, MEMBER, 'POST', '/kyc/submit', submission(LISTED, { pep_self_disclosed: true }));
  return f;
}

test('a studio Admin cannot decide a case sent to HQ, and neither can a Super Admin on the studio\'s routes', async (t) => {
  const { db, env } = await withHq(t);
  for (const who of [ADMIN, SUPER]) {
    const a = await call(env, db, who, 'PATCH', `/kyc/admin/${MEMBER}/approve`);
    assert.equal(a.status, 409);
    assert.equal(a.body.error, 'sent_to_hq');
    assert.deepEqual(a.body.reasons.sort(), ['pep', 'sanctions_match']);
    const r = await call(env, db, who, 'PATCH', `/kyc/admin/${MEMBER}/reject`, { reason: 'Fixture reason text' });
    assert.equal(r.body.error, 'sent_to_hq');
  }
  assert.equal((db.prepare('SELECT kyc_status FROM users WHERE id = 7').get() as any).kyc_status, 'pending');
  const decide = await call(env, db, ADMIN, 'POST', `/kyc/admin/${MEMBER}/hq/decide`, { verdict: 'approved' });
  assert.equal(decide.status, 403, 'HQ\'s route is a Super Admin\'s alone');
  assert.equal(decide.body.detail, 'Super admin required');
  assert.equal(rows(db, 'SELECT * FROM kyc_hq_referrals WHERE decided_at IS NOT NULL').length, 0);
});

test('a case whose HQ state cannot be read is not decided by the studio', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(CLEAR));
  db.exec('DROP TABLE kyc_hq_referrals');
  const a = await call(env, db, ADMIN, 'PATCH', `/kyc/admin/${MEMBER}/approve`);
  assert.deepEqual([a.status, a.body.error], [503, 'hq_unreadable']);
  assert.equal((db.prepare('SELECT kyc_status FROM users WHERE id = 7').get() as any).kyc_status, 'pending');
});

test('a Super Admin decides on HQ\'s route, with step-up; every open referral closes with the verdict', async (t) => {
  const { db, env } = await withHq(t);
  const noStep = await call(env, db, SUPER, 'POST', `/kyc/admin/${MEMBER}/hq/decide`, { verdict: 'approved' }, { stepUp: false });
  assert.equal(noStep.status, 403);
  assert.equal(noStep.body.detail, 'step_up_required');
  const bad = await call(env, db, SUPER, 'POST', `/kyc/admin/${MEMBER}/hq/decide`, { verdict: 'maybe' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'bad_verdict']);
  const noNote = await call(env, db, SUPER, 'POST', `/kyc/admin/${MEMBER}/hq/decide`, { verdict: 'rejected' });
  assert.deepEqual([noNote.status, noNote.body.error], [400, 'note_required']);
  const ok = await call(env, db, SUPER, 'POST', `/kyc/admin/${MEMBER}/hq/decide`, { verdict: 'approved', note: 'Fixture HQ note' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.kyc_status, 'approved');
  assert.equal(ok.body.closed.length, 2);
  const u = db.prepare('SELECT kyc_status, kyc_reviewed_by FROM users WHERE id = 7').get() as any;
  assert.deepEqual([u.kyc_status, u.kyc_reviewed_by], ['approved', SUPER]);
  const refs = rows(db, 'SELECT decided_by, decision, decision_note FROM kyc_hq_referrals').map((x) => ({ ...x }));
  assert.deepEqual(refs, [
    { decided_by: SUPER, decision: 'approved', decision_note: 'Fixture HQ note' },
    { decided_by: SUPER, decision: 'approved', decision_note: 'Fixture HQ note' },
  ]);
  assert.equal(rows(db, "SELECT * FROM activity_logs WHERE action = 'kyc_hq_decided'").length, 1);
  const again = await call(env, db, SUPER, 'POST', `/kyc/admin/${MEMBER}/hq/decide`, { verdict: 'approved' });
  assert.deepEqual([again.status, again.body.error], [409, 'not_sent_to_hq']);
  const view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.equal(view.body.hq.with_hq, false);
  assert.equal(view.body.hq.decided[0].decided_by.name, 'Super Admin B');
});

test('HQ rejects with the note as the member\'s reason', async (t) => {
  const { db, env } = await withHq(t);
  const r = await call(env, db, SUPER, 'POST', `/kyc/admin/${MEMBER}/hq/decide`, { verdict: 'rejected', note: 'Fixture rejection note' });
  assert.equal(r.status, 200);
  const u = db.prepare('SELECT kyc_status, kyc_rejection_reason FROM users WHERE id = 7').get() as any;
  assert.deepEqual([u.kyc_status, u.kyc_rejection_reason], ['rejected', 'Fixture rejection note']);
});

test('a case not with HQ is still the studio\'s to decide', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(CLEAR));
  const a = await call(env, db, ADMIN, 'PATCH', `/kyc/admin/${MEMBER}/approve`);
  assert.equal(a.status, 200);
  assert.equal(a.body.kyc_status, 'approved');
});

// ---------------------------------------------------------------- an admin sends a case to HQ

test('an admin sends a case to HQ with a note; once, until HQ decides; the log holds no note', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(CLEAR));
  const none = await call(env, db, ADMIN, 'POST', `/kyc/admin/${MEMBER}/hq`, { note: 'no' });
  assert.deepEqual([none.status, none.body.error], [400, 'note_required']);
  const missing = await call(env, db, ADMIN, 'POST', '/kyc/admin/99/hq', { note: 'Fixture send note' });
  assert.deepEqual([missing.status, missing.body.error], [404, 'user_not_found']);
  const sent = await call(env, db, ADMIN, 'POST', `/kyc/admin/${MEMBER}/hq`, { note: 'Fixture send note' });
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.body.raised_by, { id: ADMIN, name: 'Admin A' });
  const twice = await call(env, db, ADMIN, 'POST', `/kyc/admin/${MEMBER}/hq`, { note: 'Fixture send note again' });
  assert.deepEqual([twice.status, twice.body.error], [409, 'already_sent_to_hq']);
  const [log] = rows(db, "SELECT details FROM activity_logs WHERE action = 'kyc_sent_to_hq'");
  assert.doesNotMatch(log.details, /Fixture send note/);
  const view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.deepEqual([view.body.hq.open[0].reason, view.body.hq.open[0].note, view.body.hq.open[0].raised_by.name], ['admin', 'Fixture send note', 'Admin A']);
  const blocked = await call(env, db, ADMIN, 'PATCH', `/kyc/admin/${MEMBER}/approve`);
  assert.equal(blocked.body.error, 'sent_to_hq');
});

// ---------------------------------------------------------------- reviewing a match

test('the review write: a match only, once, with notes, behind step-up; the case read shows who and when', async (t) => {
  const { db, env } = await fixture();
  stubLists(t);
  await call(env, db, MEMBER, 'POST', '/kyc/submit', submission(LISTED));
  const [s] = rows(db, 'SELECT id FROM sanctions_screenings');
  db.exec("INSERT INTO sanctions_screenings (user_id, provider, hit, severity) VALUES (7, 'aggregate', 0, 'none')");
  const clearId = (db.prepare('SELECT max(id) AS id FROM sanctions_screenings').get() as any).id;

  const noStep = await call(env, db, ADMIN, 'POST', `/trust/sanctions/${s.id}/review`, { notes: 'Fixture review notes' }, { stepUp: false });
  assert.equal(noStep.body.detail, 'step_up_required');
  const short = await call(env, db, ADMIN, 'POST', `/trust/sanctions/${s.id}/review`, { notes: 'ok' });
  assert.deepEqual([short.status, short.body.error], [400, 'notes_required']);
  const gone = await call(env, db, ADMIN, 'POST', '/trust/sanctions/999/review', { notes: 'Fixture review notes' });
  assert.deepEqual([gone.status, gone.body.error], [404, 'screening_not_found']);
  const clear = await call(env, db, ADMIN, 'POST', `/trust/sanctions/${clearId}/review`, { notes: 'Fixture review notes' });
  assert.deepEqual([clear.status, clear.body.error], [409, 'not_a_match']);

  const ok = await call(env, db, ADMIN, 'POST', `/trust/sanctions/${s.id}/review`, { notes: 'Fixture review notes' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.reviewed_by, { id: ADMIN, name: 'Admin A' });
  const row = db.prepare('SELECT reviewed_by, reviewed_at, review_notes FROM sanctions_screenings WHERE id = ?').get(s.id) as any;
  assert.equal(row.reviewed_by, ADMIN);
  assert.ok(row.reviewed_at);
  assert.equal(row.review_notes, 'Fixture review notes');
  const twice = await call(env, db, SUPER, 'POST', `/trust/sanctions/${s.id}/review`, { notes: 'Fixture second notes' });
  assert.deepEqual([twice.status, twice.body.error, twice.body.reviewed_by.name], [409, 'already_reviewed', 'Admin A']);
  const [log] = rows(db, "SELECT details FROM activity_logs WHERE action = 'sanctions_match_reviewed'");
  assert.doesNotMatch(log.details, /Fixture review notes|Listed/);

  // The case's latest run is the clear one inserted above; drop it to read the reviewed match.
  db.prepare('DELETE FROM sanctions_screenings WHERE id = ?').run(clearId);
  const view = await call(env, db, ADMIN, 'GET', `/kyc/admin/${MEMBER}`);
  assert.equal(view.body.screening.state, 'match');
  assert.deepEqual([view.body.screening.reviewed.by.name, view.body.screening.reviewed.notes], ['Admin A', 'Fixture review notes']);
});
