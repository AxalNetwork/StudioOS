/**
 * D983 (#2774, part 2 of #2376) — a studio's program requests: three kinds,
 * on HQ's lane and the branch's, checked against D982's grants, and HQ's
 * answer behind the write bar.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as D982's test builds it, so the requests' SQL runs
 * against production's columns. Every studio, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_requests_d983.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import requestsRoute from '../src/routes/admin_program_requests.ts';
import licenceRequests from '../src/routes/licence_requests.ts';
import adminEscalations from '../src/routes/admin_escalations.ts';
import { ESCALATION_KINDS, LICENCE_REQUESTS_OPEN_MAX, SLA_HOURS, recordEscalation } from '../src/rpc/hqOps.ts';
import {
  NEW_REQUEST_KINDS, REQUEST_KINDS, REQUEST_REFUSALS, REQUESTABLE_PROGRAMS, decodeRequestDetail, encodeRequestDetail,
  parseNoteFor, parseRequest,
} from '../src/services/escalationRequests.ts';
import { PROGRAM_REQUEST_REFUSALS } from '../src/services/programRequests.ts';
import { PROGRAM_KEYS } from '../src/services/programGrants.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, PLAIN_ADMIN = 2, STUDIO_ADMIN = 3, OTHER_ADMIN = 4;
const LIVE = 'lic_live', OTHER = 'lic_other', BRANCHED = 'lic_branch';
const BRANCH = 'lisbon';
const REASON = 'Approved at the October HQ review.';
const WHY = 'Forty founders want the course in Portuguese.';

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const SEED = (() => {
  const sql = readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO program_grant_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(STUDIO_ADMIN, 'admin', 'Ana Studio', 'ana@example.test');
  u.run(OTHER_ADMIN, 'admin', 'Oli Other', 'oli@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN_ADMIN, STUDIO_ADMIN, OTHER_ADMIN]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const lic = db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)');
  lic.run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31');
  lic.run(2, OTHER, 'AXL-002', 'Studio East SAS', 'Studio East', 'active', '2027-10-31');
  lic.run(3, BRANCHED, 'AXL-003', 'Studio Lisbon Lda', 'Studio Lisbon', 'active', '2027-10-31');
  db.prepare('INSERT INTO licence_admins (licence_id, user_id) VALUES (1, ?)').run(STUDIO_ADMIN);
  db.prepare('INSERT INTO licence_admins (licence_id, user_id) VALUES (2, ?)').run(OTHER_ADMIN);
  db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name) VALUES (?, ?, 'lisbon.example.test', 'studioos-lisbon', 'studioos-lisbon-db')`)
    .run(BRANCHED, BRANCH);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/program-grants/requests', requestsRoute);
app.route('/api/admin/program-grants', grantsRoute);
app.route('/api/licence', licenceRequests);
app.route('/api/admin', adminEscalations);

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, envOf(db)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

const ask = (db: DatabaseSync, kind: string, request: unknown, detail: unknown = WHY, who = STUDIO_ADMIN) =>
  call(db, who, 'POST', '/api/licence/mine/requests', { kind, subject: `Program request: ${kind}`, request, detail });
const grantNow = (db: DatabaseSync, uid: string, key: string, terms: Record<string, unknown> = {}) =>
  call(db, SUPER, 'POST', `/api/admin/program-grants/licences/${uid}/${key}`, { reason: REASON, terms });
const events = (db: DatabaseSync) => (db.prepare("SELECT licence_id, detail_json, note FROM licence_events WHERE event = 'program_changed' ORDER BY id").all() as any[])
  .map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));
const grants = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS n FROM program_grants').get() as any).n);
const fromBranch = (db: DatabaseSync, kind: string, request: unknown, note: string | null = WHY) =>
  recordEscalation(envOf(db), BRANCH, { kind, subject: `Program request: ${kind}`, detail: encodeRequestDetail(request as any, note) } as any);

// ---------------------------------------------------------------- the kinds and their fields

test('three program kinds join both lists, each answered within 3 days, on D982\'s program keys', () => {
  for (const k of ['program_grant', 'program_terms_change', 'program_end']) {
    assert.ok((REQUEST_KINDS as readonly string[]).includes(k), k);
    assert.ok((NEW_REQUEST_KINDS as readonly string[]).includes(k), `${k} needs its fields on every door`);
    assert.ok((ESCALATION_KINDS as readonly string[]).includes(k), k);
    assert.equal((SLA_HOURS as any)[k], 72, k);
  }
  assert.deepEqual([...REQUESTABLE_PROGRAMS], PROGRAM_KEYS, 'the request list and the store name the same nine');
});

test('the fields: a program named, a terms change with its term and what is asked, and what it stands at never sent', () => {
  assert.deepEqual(parseRequest('program_grant', { program: 'learning' }), { ok: true, request: { program: 'learning' } });
  assert.deepEqual(parseRequest('program_end', { program: 'perks' }), { ok: true, request: { program: 'perks' } });
  assert.deepEqual(parseRequest('program_terms_change', { program: 'perks', term: 'credits_per_quarter', asked: '600' }),
    { ok: true, request: { program: 'perks', term: 'credits_per_quarter', asked: '600' } });
  const no = (kind: string, raw: unknown) => (parseRequest(kind, raw) as any).error;
  assert.equal(no('program_grant', undefined), 'request_required');
  assert.equal(no('program_grant', {}), 'program_required');
  assert.equal(no('program_grant', { program: 'fundraising' }), 'bad_program');
  assert.equal(no('program_grant', { program: 'learning', terms: {} }), 'unknown_request_field');
  assert.equal(no('program_terms_change', { program: 'perks', asked: '600' }), 'program_term_required');
  assert.equal(no('program_terms_change', { program: 'perks', term: 'credits_per_quarter' }), 'program_asked_required');
  assert.equal(no('program_terms_change', { program: 'perks', term: 'credits_per_quarter', current: '400', asked: '600' }), 'program_current_not_accepted');
  assert.equal(no('program_terms_change', { program: 'perks', term: 'x', asked: 'y'.repeat(301) }), 'term_value_too_long');
  // The note is required on a program request, and stays optional on the others.
  assert.equal((parseNoteFor('program_grant', '  ') as any).error, 'program_note_required');
  assert.equal(REQUEST_REFUSALS.program_note_required, 'Say why your studio needs it. HQ reads the note to decide.');
  assert.deepEqual(parseNoteFor('renewal', ''), { ok: true, note: null });
});

// ---------------------------------------------------------------- HQ's lane

test('HQ\'s lane: a grant request is recorded against the studio\'s own licence, with its note', async () => {
  const db = fixture();
  const r = await ask(db, 'program_grant', { program: 'learning' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.request, { program: 'learning' });
  assert.equal(r.body.note, WHY);
  assert.equal(r.body.subject_ref, LIVE);
  assert.equal(grants(db), 0, 'a request grants nothing');
});

test('HQ\'s lane refuses a program HQ does not offer, one already held, and a second open request of the same kind', async () => {
  const db = fixture();
  const locked = await ask(db, 'program_grant', { program: 'product-testing' });
  assert.deepEqual([locked.status, locked.body.error], [409, 'program_not_offered']);
  // Locked by its readiness, whatever its switch says: a switch set on by hand still does not offer it.
  db.prepare("UPDATE program_grant_defaults SET grantable = 1 WHERE program_key = 'ai-native-venture'").run();
  const notReady = await ask(db, 'program_grant', { program: 'ai-native-venture' });
  assert.deepEqual([notReady.status, notReady.body.error], [409, 'program_not_offered']);
  db.prepare("UPDATE program_grant_defaults SET grantable = 0 WHERE program_key = 'perks'").run();
  const off = await ask(db, 'program_grant', { program: 'perks' });
  assert.deepEqual([off.status, off.body.error], [409, 'program_not_offered'], 'switched off on Default terms');
  await grantNow(db, LIVE, 'learning');
  const held = await ask(db, 'program_grant', { program: 'learning' });
  assert.deepEqual([held.status, held.body.error, held.body.message], [409, 'program_already_held', PROGRAM_REQUEST_REFUSALS.program_already_held]);
  assert.equal((await ask(db, 'program_grant', { program: 'mentor-cohorts' })).status, 201);
  const twice = await ask(db, 'program_grant', { program: 'mentor-cohorts' });
  assert.deepEqual([twice.status, twice.body.error], [409, 'program_request_open']);
  // Another studio's open request is not this one's.
  assert.equal((await ask(db, 'program_grant', { program: 'mentor-cohorts' }, WHY, OTHER_ADMIN)).status, 201);
  const noNote = await ask(db, 'program_grant', { program: 'spinout-lab' }, '');
  assert.deepEqual([noNote.status, noNote.body.error], [400, 'program_note_required']);
});

test('HQ\'s lane: a change or an end needs the program held, and what the term stands at is read from the grant', async () => {
  const db = fixture();
  const none = await ask(db, 'program_end', { program: 'perks' });
  assert.deepEqual([none.status, none.body.error], [409, 'program_not_held']);
  await grantNow(db, LIVE, 'perks', { credits_per_quarter: 400 });
  const wrong = await ask(db, 'program_terms_change', { program: 'perks', term: 'cohorts_per_year', asked: '4' });
  assert.deepEqual([wrong.status, wrong.body.error], [409, 'program_term_not_for_program']);
  const set = await ask(db, 'program_terms_change', { program: 'perks', term: 'credits_per_quarter', asked: '600' });
  assert.equal(set.status, 201, JSON.stringify(set.body));
  assert.deepEqual(set.body.request, { program: 'perks', term: 'credits_per_quarter', current: '400', asked: '600' });
  const same = await ask(db, 'program_terms_change', { program: 'perks', term: 'credits_per_quarter', asked: '700' });
  assert.deepEqual([same.status, same.body.error], [409, 'program_request_open'], 'the same term asked twice is one question');
  // Another term of the same program is another question.
  const unset = await ask(db, 'program_terms_change', { program: 'perks', term: 'hq_share_bps', asked: '500' });
  assert.equal(unset.body.request.current, 'Not recorded', 'a term nobody set is Not recorded, never 0');
  assert.equal((await ask(db, 'program_end', { program: 'perks' })).status, 201);
  // A paused grant is still held.
  await call(db, SUPER, 'POST', `/api/admin/program-grants/licences/${LIVE}/perks/pause`, { reason: REASON });
  assert.equal((await ask(db, 'program_terms_change', { program: 'perks', term: 'fee_cents', asked: '0' })).status, 201);
});

test('HQ\'s lane keeps the open-request cap', async () => {
  const db = fixture();
  const ins = db.prepare(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, subject_ref, status, due_at) VALUES (?, 'hq', 'other', 's', ?, 'open', '2030-01-01')`);
  for (let i = 0; i < LICENCE_REQUESTS_OPEN_MAX; i += 1) ins.run(`e${i}`, LIVE);
  const r = await ask(db, 'program_grant', { program: 'learning' });
  assert.deepEqual([r.status, r.body.error], [409, 'too_many_open']);
});

// ---------------------------------------------------------------- the branch's lane

test('the branch\'s lane: HQ checks a program request against the licence the branch runs under', async () => {
  const db = fixture();
  const ok = await fromBranch(db, 'program_grant', { program: 'learning' });
  assert.equal((ok as any).status, 'open', JSON.stringify(ok));
  const stored = db.prepare('SELECT branch_code, detail FROM hq_escalations WHERE uid = ?').get((ok as any).uid) as any;
  assert.equal(stored.branch_code, BRANCH);
  assert.deepEqual(decodeRequestDetail(stored.detail), { request: { program: 'learning' }, note: WHY });
  assert.equal((await fromBranch(db, 'program_grant', { program: 'learning' }) as any).refused, 'program_request_open');
  assert.equal((await fromBranch(db, 'program_grant', { program: 'investor-cohorts' }) as any).refused, 'program_not_offered');
  assert.equal((await fromBranch(db, 'program_end', { program: 'perks' }) as any).refused, 'program_not_held');
  assert.equal((await fromBranch(db, 'program_grant', { program: 'perks' }, null) as any).refused, 'program_note_required');
  // What the term stands at is HQ's, filled where HQ records it.
  await grantNow(db, BRANCHED, 'perks', { credits_per_quarter: 300 });
  const change = await fromBranch(db, 'program_terms_change', { program: 'perks', term: 'credits_per_quarter', asked: '500' });
  const row = db.prepare('SELECT detail FROM hq_escalations WHERE uid = ?').get((change as any).uid) as any;
  assert.equal(decodeRequestDetail(row.detail).request!.current, '300');
  // A branch that sends what it stands at is refused, whatever it says.
  assert.equal((await fromBranch(db, 'program_terms_change', { program: 'perks', term: 'credits_per_quarter', current: '9', asked: '5' }) as any).refused, 'program_current_not_accepted');
});

test('the branch\'s lane keeps the open-request cap for program requests', async () => {
  const db = fixture();
  const ins = db.prepare(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, detail, status, due_at) VALUES (?, ?, 'program_end', 's', ?, 'open', '2030-01-01')`);
  for (let i = 0; i < LICENCE_REQUESTS_OPEN_MAX; i += 1) ins.run(`b${i}`, BRANCH, encodeRequestDetail({ program: 'perks' }, WHY));
  assert.equal((await fromBranch(db, 'program_grant', { program: 'learning' }) as any).refused, 'too_many_open');
});

// ---------------------------------------------------------------- HQ's answer

test('HQ\'s list: every program request, from both lanes, with its licence and program, for the Super Admin only', async () => {
  const db = fixture();
  await ask(db, 'program_grant', { program: 'learning' });
  await fromBranch(db, 'program_grant', { program: 'mentor-cohorts' });
  db.prepare(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at) VALUES ('x1', 'hq', 'renewal', 'not a program', 'open', '2030-01-01')`).run();
  const plain = await call(db, PLAIN_ADMIN, 'GET', '/api/admin/program-grants/requests');
  assert.equal(plain.status, 403);
  const r = await call(db, SUPER, 'GET', '/api/admin/program-grants/requests');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((i: any) => [i.lane, i.program_key, i.asks_for, i.licence?.uid, i.status]), [
    ['hq', 'learning', 'Grant', LIVE, 'open'],
    ['branch', 'mentor-cohorts', 'Grant', BRANCHED, 'open'],
  ]);
  assert.equal(r.body.items[0].program_name, 'Learning');
  assert.equal(r.body.items[0].note, WHY);
  assert.equal(r.body.complete, true);
  assert.equal((await call(db, SUPER, 'GET', '/api/admin/program-grants/requests?status=answered')).body.items.length, 0);
  assert.equal((await call(db, SUPER, 'GET', '/api/admin/program-grants/requests?status=maybe')).status, 400);
});

test('approve: the answer and a draft from the defaults with HQ\'s terms over them, and nothing granted', async () => {
  const db = fixture();
  await call(db, SUPER, 'PUT', '/api/admin/program-grants/defaults/learning', { reason: REASON, terms: { fee_cents: 200000, currency: 'EUR' } });
  const req = (await ask(db, 'program_grant', { program: 'learning' })).body;
  const before = events(db).length;
  const r = await call(db, SUPER, 'POST', `/api/admin/program-grants/requests/${req.uid}/approve`, { reason: REASON, terms: { capacity_cap: 60 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'answered');
  assert.equal(r.body.answer, REASON, 'the studio reads HQ\'s note');
  assert.equal(r.body.notified.ok, true, 'the raiser is told in the bell');
  assert.equal(grants(db), 0, 'an approval is a decision; Grant stays part 1\'s write');
  const ev = events(db).slice(before);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].licence_id, 1);
  assert.equal(ev[0].detail.action, 'request_approved');
  assert.equal(ev[0].detail.request_uid, req.uid);
  assert.equal(ev[0].detail.draft.action, 'grant');
  assert.equal(ev[0].detail.draft.terms.fee_cents, 200000, 'from the defaults');
  assert.equal(ev[0].detail.draft.terms.capacity_cap, 60, 'what HQ named wins');
  assert.equal(ev[0].detail.draft.terms.hq_share_bps, null, 'a term nobody set stays null');
  const list = await call(db, SUPER, 'GET', '/api/admin/program-grants/requests');
  assert.equal(list.body.items[0].draft.terms.capacity_cap, 60, 'the list carries the draft to finish');
  // Part 1's write then grants it.
  assert.equal((await grantNow(db, LIVE, 'learning', { capacity_cap: 60 })).status, 201);
});

test('decline: the reason the studio reads, and the history row', async () => {
  const db = fixture();
  const req = (await ask(db, 'program_grant', { program: 'learning' })).body;
  const r = await call(db, SUPER, 'POST', `/api/admin/program-grants/requests/${req.uid}/decline`, { reason: 'Not this year; ask again in spring.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'declined');
  assert.equal(events(db).at(-1)!.detail.action, 'request_declined');
  const mine = await call(db, STUDIO_ADMIN, 'GET', '/api/licence/mine/requests');
  assert.equal(mine.body.items[0].answer, 'Not this year; ask again in spring.');
  assert.equal(mine.body.items[0].status, 'declined');
});

test('the answer\'s refusals: the write bar, a reason, one answer only, and what no longer holds', async () => {
  const db = fixture();
  const req = (await ask(db, 'program_grant', { program: 'learning' })).body;
  const path = `/api/admin/program-grants/requests/${req.uid}`;
  assert.equal((await call(db, PLAIN_ADMIN, 'POST', `${path}/approve`, { reason: REASON })).status, 403, 'a plain admin');
  db.prepare("UPDATE user_sessions SET created_at = datetime('now', '-3 hours') WHERE user_id = ?").run(SUPER);
  assert.equal((await call(db, SUPER, 'POST', `${path}/approve`, { reason: REASON })).status, 403, 'a stale step-up');
  assert.equal((await call(db, SUPER, 'GET', '/api/admin/program-grants/requests')).status, 200, 'a read needs no fresh step-up');
  db.prepare("UPDATE user_sessions SET created_at = datetime('now') WHERE user_id = ?").run(SUPER);
  const short = await call(db, SUPER, 'POST', `${path}/approve`, { reason: 'ok' });
  assert.deepEqual([short.status, short.body.error], [400, 'reason_required']);
  const badTerms = await call(db, SUPER, 'POST', `${path}/approve`, { reason: REASON, terms: { credits_per_quarter: 5 } });
  assert.deepEqual([badTerms.status, badTerms.body.error], [400, 'bad_terms'], 'credits do not apply to Learning');
  assert.equal((await call(db, SUPER, 'POST', `${path}/decline`, { reason: REASON, terms: {} })).body.error, 'terms_not_for_kind');
  // Granted meanwhile: the approval would be of something that already happened.
  await grantNow(db, LIVE, 'learning');
  const stale = await call(db, SUPER, 'POST', `${path}/approve`, { reason: REASON });
  assert.deepEqual([stale.status, stale.body.error], [409, 'program_already_held']);
  assert.equal((await call(db, SUPER, 'POST', `${path}/decline`, { reason: REASON })).status, 200);
  const again = await call(db, SUPER, 'POST', `${path}/decline`, { reason: REASON });
  assert.deepEqual([again.status, again.body.error], [409, 'not_open']);
  assert.equal((await call(db, SUPER, 'POST', '/api/admin/program-grants/requests/nope/decline', { reason: REASON })).status, 404);
  // A terms change carries no terms on approval: HQ changes them with part 1's write.
  await call(db, SUPER, 'POST', `/api/admin/program-grants/licences/${LIVE}/learning/end`, { reason: REASON });
  await grantNow(db, LIVE, 'perks');
  const tc = (await ask(db, 'program_terms_change', { program: 'perks', term: 'credits_per_quarter', asked: '600' })).body;
  const withTerms = await call(db, SUPER, 'POST', `/api/admin/program-grants/requests/${tc.uid}/approve`, { reason: REASON, terms: { credits_per_quarter: 600 } });
  assert.equal(withTerms.body.error, 'terms_not_for_kind');
  const approved = await call(db, SUPER, 'POST', `/api/admin/program-grants/requests/${tc.uid}/approve`, { reason: REASON });
  assert.deepEqual(approved.body.draft, { program_key: 'perks', action: 'change_terms', term: 'credits_per_quarter', current: 'Not recorded', asked: '600' });
});

test('the escalation queue\'s generic answer refuses a program request, and still answers the others', async () => {
  const db = fixture();
  const req = (await ask(db, 'program_grant', { program: 'learning' })).body;
  const r = await call(db, SUPER, 'PATCH', `/api/admin/escalations/${req.uid}`, { answer: 'Fine.', status: 'answered' });
  assert.deepEqual([r.status, r.body.error], [409, 'answer_on_program_grants']);
  assert.equal((db.prepare('SELECT status FROM hq_escalations WHERE uid = ?').get(req.uid) as any).status, 'open');
  const other = (await call(db, STUDIO_ADMIN, 'POST', '/api/licence/mine/requests', { kind: 'other', subject: 'A question' })).body;
  assert.equal((await call(db, SUPER, 'PATCH', `/api/admin/escalations/${other.uid}`, { answer: 'Answered.' })).status, 200);
});

// ---------------------------------------------------------------- the grid

test('the grid reads requests waiting and requests by month, measured, never null when the store answers', async () => {
  const db = fixture();
  await ask(db, 'program_grant', { program: 'learning' });
  const declined = (await ask(db, 'program_grant', { program: 'perks' })).body;
  await call(db, SUPER, 'POST', `/api/admin/program-grants/requests/${declined.uid}/decline`, { reason: REASON });
  await fromBranch(db, 'program_grant', { program: 'mentor-cohorts' });
  const { body } = await call(db, SUPER, 'GET', '/api/admin/program-grants');
  assert.equal(body.tiles.requests_waiting, 2, 'open on both lanes');
  assert.equal(body.tiles.requests_waiting_reason, null);
  const months = body.series.requests_by_month;
  assert.equal(months.length, 6);
  const now = months.at(-1);
  assert.equal(now.month, new Date().toISOString().slice(0, 7));
  assert.equal(now.so_far, true);
  assert.deepEqual([now.waiting, now.approved, now.declined], [2, 0, 1]);
  assert.ok(months.slice(0, -1).every((m: any) => m.waiting === 0 && !m.so_far));
});

test('the grid says the requests could not be read when their store fails, never 0', async () => {
  const db = fixture();
  db.exec('DROP TABLE hq_escalations');
  const { status, body } = await call(db, SUPER, 'GET', '/api/admin/program-grants');
  assert.equal(status, 200, 'the grants still answer');
  assert.equal(body.tiles.requests_waiting, null);
  assert.match(body.tiles.requests_waiting_reason, /could not be read\. That is not the same as none\./);
  assert.equal(body.series.requests_by_month, null);
});
