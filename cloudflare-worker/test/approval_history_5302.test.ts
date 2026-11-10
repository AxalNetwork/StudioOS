/**
 * D5302 (#5302, package 3 of #4716) — decision history reconciled across the
 * Approvals lanes.
 *
 *   · cross-registry: a lane whose store keeps a decision column is recorded
 *     on Decided; the inbox, the page's Lanes model and Decided name the same
 *     lanes, and agree that each is decidable;
 *   · Wellbeing experts reads D1043's decision history, through the real
 *     verify and decline routes, and a credential change does not erase it;
 *   · Co-marketing keeps its approval's actor and time through publishing and
 *     a withdrawal; a pitch published before the fix is left out, not shown
 *     with its publish as its approval;
 *   · Due diligence and KYB read their decide routes' columns and events,
 *     KYB scoped as its inbox lane is.
 *
 * The database is the baseline plus every migration above the cutoff, schema
 * only. Every person, business and pitch is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/approval_history_5302.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import approvalsRoute from '../src/routes/admin_approvals.ts';
import comarketingRoute from '../src/routes/comarketing.ts';
import wellbeingRoute from '../src/routes/wellbeing.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { HQ_APPROVAL_SOURCES } from '../src/services/hqApprovalSources.ts';
import { DECISION_LANES } from '../src/services/approvalDecisions.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

// No notice in this file may reach a real provider.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No external request in this fixture'); };
after(() => { globalThis.fetch = originalFetch; });

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, ADA = 2, BEA = 3, MEMBER = 4, PARTNER = 5, EXPERT = 6, CARL = 7;
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, partner_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', null);
  u.run(ADA, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(BEA, 'admin', 'Bea Admin', 'bea@example.test', null);
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test', null);
  u.run(PARTNER, 'partner', 'Pia Partner', 'pia@example.test', 1);
  u.run(EXPERT, 'founder', 'Eli Expert', 'eli@example.test', null);
  u.run(CARL, 'admin', 'Carl Admin', 'carl@example.test', null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADA, BEA, CARL, EXPERT]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  db.exec("INSERT INTO partners (id, name, company, email) VALUES (1, 'Pia Partner', 'Partner Co', 'partner-co@example.test')");
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/approvals', approvalsRoute);
app.route('/api/comarketing', comarketingRoute);
app.route('/api/wellbeing', wellbeingRoute);
app.onError((e, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] ?? 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, extraEnv: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', ...extraEnv } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const decided = async (db: DatabaseSync, lane: string, who = SUPER, env: Record<string, unknown> = {}) => {
  const r = await call(db, who, 'GET', `/api/admin/approvals/decided?lane=${lane}`, undefined, env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const one = (db: DatabaseSync, sql: string) => db.prepare(sql).get() as any;

// ───────────────────────────────────────────── cross-registry

/** A column a decide route writes: who or when a review, decision or answer happened. */
const DECISION_COLUMN = /(^|_)(decided|reviewed|approved|rejected|resolved|answered|archived)_(at|by)(_user_id)?$|^decision$/;
const storeOf = (countSql: string) => /\bFROM (\w+)/.exec(countSql)![1];

test('a lane whose store keeps a decision column is recorded on Decided', () => {
  const db = fixture();
  const cols = (t: string) => (db.prepare('SELECT name FROM pragma_table_info(?)').all(t) as any[]).map((r) => String(r.name));
  const offenders: string[] = [];
  for (const s of [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES]) {
    const store = storeOf(s.countSql);
    const decisionCols = cols(store).filter((c) => DECISION_COLUMN.test(c));
    assert.ok(cols(store).length > 0, `${s.key}'s store ${store} was not found`);
    const lane = DECISION_LANES.find((l) => l.key === s.key)!;
    if (decisionCols.length && !lane.recorded) offenders.push(`${s.key} (${store}: ${decisionCols.join(', ')})`);
  }
  assert.deepEqual(offenders, [], 'these lanes record decisions but Decided says they do not');
  // The three lanes that do not record keep no such column: the rule above is what keeps them honest.
  assert.deepEqual(DECISION_LANES.filter((l) => !l.recorded).map((l) => l.key), ['jobs', 'best_fit', 'ai_runs']);
});

test('the inbox, the Lanes model and Decided name the same lanes and agree each is decidable', async () => {
  const model = await import(pathToFileURL(resolve(process.cwd(), 'frontend/src/pages/admin/approvals/approvalsModel.js')).href);
  const inbox = [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES];
  const sorted = (xs: string[]) => [...xs].sort();
  assert.deepEqual(sorted(DECISION_LANES.map((l) => l.key)), sorted(inbox.map((s) => s.key)), 'Decided and the inbox');
  const page = [...model.LANES, ...model.HQ_LANES];
  assert.deepEqual(sorted(page.map((l: any) => l.key)), sorted(inbox.map((s) => s.key)), 'Lanes and the inbox');
  for (const s of inbox) {
    const onPage = page.find((l: any) => l.key === s.key);
    const pageDecides = Boolean(onPage.door || onPage.here);
    assert.equal(pageDecides, s.decidedOn !== null, `${s.key}: Lanes says ${pageDecides ? '' : 'not '}decidable, the inbox says ${s.decidedOn ?? 'nothing decides it'}`);
    const lane = DECISION_LANES.find((l) => l.key === s.key)!;
    // A lane the inbox says is decided somewhere never reads on Decided as though nothing decides it.
    if (!lane.recorded && s.decidedOn !== null) {
      assert.doesNotMatch(lane.reason, /nothing decides|no (admin )?route (decides|completes)|not built/i, `${s.key}'s reason says nothing decides it`);
    }
  }
});

// ───────────────────────────────────────────── Wellbeing experts

test('wellbeing experts: verify and decline read on Decided with time, actor, outcome and note; a credential change keeps them', async () => {
  const db = fixture();
  db.exec(`INSERT INTO experts (id, uid, user_id, name, created_at) VALUES
    (10, 'expert-v', ${EXPERT}, 'Vera Verified', '2026-10-01 00:00:00'),
    (11, 'expert-d', ${MEMBER}, 'Dan Declined', '2026-10-02 00:00:00'),
    (12, 'seed_sample', NULL, 'A sample', '2026-10-02 00:00:00');
    -- Verified before migration 577: no actor, no time, so not a decision on record.
    INSERT INTO experts (id, uid, name, verified, decision_state) VALUES (13, 'expert-legacy', 'Lee Legacy', 1, 'verified');`);
  const wb = '/api/wellbeing/admin/experts';
  // A verify's note is the admins' own; only a decline's reason goes to the expert.
  assert.equal((await call(db, ADA, 'POST', `${wb}/expert-v/verify`, { verified: true, credentials_checked: true, expected_version: 0, reason: 'Board register checked.' })).status, 200);
  assert.equal((await call(db, BEA, 'POST', `${wb}/expert-d/decline`, { reason: 'Please add the issuing board.' })).status, 200);
  // A hide is the directory's visibility, not a verification decision.
  assert.equal((await call(db, ADA, 'POST', `${wb}/expert-d/hide`, { hidden: true })).status, 200);
  const body = await decided(db, 'wellbeing_experts');
  const lane = body.lanes.find((l: any) => l.key === 'wellbeing_experts');
  assert.deepEqual([lane.recorded, lane.count, lane.since], [true, 2, '2026-10-26']);
  const rows = body.items.map((r: any) => [r.item_id, r.outcome, r.outcome_word, r.decided_by?.name, r.note, r.note_shown]);
  assert.deepEqual(rows.sort(), [
    [10, 'approved', 'Verified', 'Ada Admin', 'Board register checked.', false],
    [11, 'declined', 'Declined', 'Bea Admin', 'Please add the issuing board.', true],
  ]);
  const v = body.items.find((r: any) => r.item_id === 10);
  assert.equal(v.decided_at, one(db, "SELECT datetime(decided_at) AS t FROM expert_review_decisions WHERE decision = 'verified'").t);
  assert.ok(v.wait_hours > 0, 'the wait runs from the expert\'s arrival');
  assert.ok(!body.not_recorded?.includes('Wellbeing experts'));

  // The expert changes their credentials: the current fields clear, the history stays.
  assert.equal((await call(db, EXPERT, 'PATCH', '/api/wellbeing/experts/me/credentials', { licence_number: 'SYN-1' })).status, 200);
  assert.equal(one(db, 'SELECT decided_at FROM experts WHERE id = 10').decided_at, null);
  const again = await decided(db, 'wellbeing_experts');
  assert.deepEqual(again.items.map((r: any) => r.item_id).sort(), [10, 11], 'a later state change erased a decision');

  // Removing a verification is the lane's own decision too.
  db.exec("UPDATE experts SET licence_number = NULL, review_version = 2 WHERE id = 10");
  assert.equal((await call(db, ADA, 'POST', `${wb}/expert-v/verify`, { verified: true, credentials_checked: true, expected_version: 2 })).status, 200);
  assert.equal((await call(db, ADA, 'POST', `${wb}/expert-v/verify`, { verified: false })).status, 200);
  const words = (await decided(db, 'wellbeing_experts')).items.filter((r: any) => r.item_id === 10).map((r: any) => [r.outcome, r.outcome_word]);
  assert.deepEqual(words.sort(), [['approved', 'Verified'], ['approved', 'Verified'], ['other', 'Verification removed']]);
});

// ───────────────────────────────────────────── Co-marketing

function pitches(db: DatabaseSync) {
  db.exec(`INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, asset_type, status, created_at, updated_at) VALUES
    (1, 'pitch-pub', 1, ${PARTNER}, 'Hiring your first engineer', 'A webinar.', 'webinar', 'proposed', '2026-10-01 00:00:00', '2026-10-01 00:00:00'),
    (2, 'pitch-wd', 1, ${PARTNER}, 'The LP letter', 'A blog post.', 'blog', 'proposed', '2026-10-02 00:00:00', '2026-10-02 00:00:00');
    -- Published before the fix: the review columns hold the publish.
    INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, asset_type, status,
      reviewed_by_user_id, reviewed_at, published_at, published_url, created_at, updated_at) VALUES
    (3, 'pitch-old', 1, ${PARTNER}, 'Old news', 'A podcast.', 'podcast', 'published', ${BEA},
      '2026-10-05T10:00:00.001Z', '2026-10-05T10:00:00.000Z', 'https://example.test/old', '2026-10-03 00:00:00', '2026-10-05 00:00:00');`);
}

test('co-marketing: publishing keeps the approval\'s actor and time, and records who published apart', async () => {
  const db = fixture(); pitches(db);
  const cm = '/api/comarketing/admin/pitches';
  assert.equal((await call(db, ADA, 'POST', `${cm}/pitch-pub/approve`, {})).status, 200);
  const approved = one(db, 'SELECT reviewed_by_user_id AS by, reviewed_at AS at FROM comarketing_pitches WHERE id = 1');
  assert.equal(approved.by, ADA);
  const pub = await call(db, BEA, 'POST', `${cm}/pitch-pub/publish`, { published_url: 'https://example.test/post', notes: 'Live on the blog.' });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const row = one(db, 'SELECT status, reviewed_by_user_id AS rb, reviewed_at AS ra, published_by_user_id AS pb, published_at AS pa FROM comarketing_pitches WHERE id = 1');
  assert.deepEqual([row.status, row.rb, row.ra, row.pb], ['published', ADA, approved.at, BEA], 'publishing overwrote the approval');
  assert.ok(row.pa && row.pa >= approved.at);
  assert.equal(pub.body.reviewed_at, approved.at);

  // The board's one-pitch read still says who published it, and when.
  const item = await call(db, ADA, 'GET', `${cm}/pitch-pub`);
  assert.deepEqual([item.body.decided.status, item.body.decided.by.id, item.body.decided.at], ['published', BEA, row.pa]);
  // A pitch published before the fix keeps naming the reviewer column's publisher.
  assert.deepEqual((await call(db, ADA, 'GET', `${cm}/pitch-old`)).body.decided.by.id, BEA);

  const body = await decided(db, 'comarketing');
  const listed = body.items.map((r: any) => [r.item_id, r.outcome, r.decided_by?.name, r.decided_at]);
  assert.deepEqual(listed, [[1, 'approved', 'Ada Admin', one(db, 'SELECT datetime(reviewed_at) AS t FROM comarketing_pitches WHERE id = 1').t]],
    'the published pitch is listed under its approval; the one published before the fix is left out');
  assert.match(body.lanes.find((l: any) => l.key === 'comarketing').caveat, /published before 10 Nov 2026/);
});

test('co-marketing: a withdrawal after approval keeps the approval on Decided', async () => {
  const db = fixture(); pitches(db);
  assert.equal((await call(db, CARL, 'POST', '/api/comarketing/admin/pitches/pitch-wd/approve', {})).status, 200);
  db.exec("UPDATE comarketing_pitches SET status = 'withdrawn' WHERE id = 2");
  const body = await decided(db, 'comarketing');
  assert.deepEqual(body.items.map((r: any) => [r.item_id, r.outcome_word, r.decided_by?.name]), [[2, 'Approved', 'Carl Admin']]);
  // A pitch withdrawn while proposed was never decided.
  db.exec("UPDATE comarketing_pitches SET status = 'withdrawn' WHERE id = 1");
  assert.equal((await decided(db, 'comarketing')).total, 1);
});

// ───────────────────────────────────────────── Due diligence and KYB

test('due diligence: a decision and an archive read on Decided with their actor and time', async () => {
  const db = fixture();
  db.exec(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id, status, created_at, decision, decided_by, decided_at) VALUES
      (1, 'dd-1', 'project', 1, 'Acme', ${MEMBER}, 'completed', '2026-10-01 00:00:00', 'proceed_with_conditions', ${ADA}, '2026-10-04 00:00:00'),
      (2, 'dd-2', 'project', 2, 'Beta', ${MEMBER}, 'open', '2026-10-02 00:00:00', NULL, NULL, NULL);
    INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id, status, created_at, archived_by, archived_at) VALUES
      (3, 'dd-3', 'project', 3, 'Gamma', ${MEMBER}, 'archived', '2026-10-02 00:00:00', ${BEA}, '2026-10-06 00:00:00');`);
  const body = await decided(db, 'due_diligence');
  assert.deepEqual(body.items.map((r: any) => [r.item_id, r.outcome, r.outcome_word, r.decided_by?.name, r.decided_at, r.wait_hours]), [
    [3, 'other', 'Archived', 'Bea Admin', '2026-10-06 00:00:00', 96],
    [1, 'approved', 'Proceed with conditions', 'Ada Admin', '2026-10-04 00:00:00', 72],
  ]);
});

test('kyb: its staff decisions read from the case events, scoped as the inbox lane is', async () => {
  const db = fixture();
  db.exec(`INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (5, 'cp-5', 'Acme Ltd', '2026-10-01 00:00:00', '2026-10-01 00:00:00'),
      (6, 'cp-6', 'Other Studio Co', '2026-10-01 00:00:00', '2026-10-01 00:00:00');
    INSERT INTO kyb_cases (uid, studio_code, status, source_revision, reviewed_by, reviewed_at) VALUES
      ('company-5', 'hq', 'approved', 'x', ${ADA}, '2026-10-05 00:00:00'),
      ('company-6', 'lisbon', 'rejected', 'x', ${ADA}, '2026-10-05 00:00:00');
    INSERT INTO kyb_case_events (uid, case_uid, action, actor_id, created_at) VALUES
      ('e1', 'company-5', 'kyb_documents_requested', ${BEA}, '2026-10-03 00:00:00'),
      ('e2', 'company-5', 'kyb_owners_updated', ${BEA}, '2026-10-04 00:00:00'),
      ('e3', 'company-5', 'kyb_approved', ${ADA}, '2026-10-05 00:00:00'),
      ('e4', 'company-6', 'kyb_rejected', ${ADA}, '2026-10-05 00:00:00');`);
  const body = await decided(db, 'kyb');
  assert.deepEqual(body.items.map((r: any) => [r.item_id, r.who, r.outcome, r.outcome_word, r.decided_by?.name]), [
    [20, 'Acme Ltd', 'approved', 'Approved', 'Ada Admin'],
    [20, 'Acme Ltd', 'other', 'Documents requested', 'Bea Admin'],
  ], 'an owners edit is not a decision, and another studio\'s case is not this one\'s');
  // The Lisbon studio reads its own case, and not HQ's.
  const lisbon = await decided(db, 'kyb', SUPER, { BRANCH_CODE: 'lisbon' });
  assert.deepEqual(lisbon.items.map((r: any) => [r.item_id, r.outcome_word]), [[24, 'Rejected']]);
  // A business linked to an admin is the Super Admin's queue, as on the inbox.
  db.exec(`UPDATE kyb_cases SET linked_user_id = ${CARL} WHERE uid = 'company-5'`);
  assert.equal((await decided(db, 'kyb')).total, 0);
});
