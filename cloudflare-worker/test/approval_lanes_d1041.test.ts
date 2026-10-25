/**
 * D1041 (#2889, part 3 of #2390) — the canvas's new lanes, HQ decides, and
 * what each lane tells and where it is decided.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, as `program_grants_d982.test.ts` builds it, so every lane's SQL
 * runs against production's columns. Every name and figure is made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import glanceRoute from '../src/routes/admin_studio_glance.ts';
import approvalsRoute from '../src/routes/admin_approvals.ts';
import {
  APPROVAL_SOURCES, NOT_COUNTED_YET, SUB_COUNTS_NOT_YET, approvalBoard, countLanes, laneCounts,
} from '../src/services/approvalSources.ts';
import { HQ_APPROVAL_SOURCES, HQ_NOT_COUNTED_YET, hqLanes } from '../src/services/hqApprovalSources.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const SUPER = 1, PLAIN = 2, MEMBER = 3;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(PLAIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  return db;
}
const env = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', ...extra }) as any;

/** One waiting row and one row in every decided state, per new lane. */
function seed(db: DatabaseSync) {
  db.exec(`
    INSERT INTO company_profiles (id, uid, company_name) VALUES
      (1, 'cp1', 'Fixture Co'), (2, 'cp2', 'Fixture Two'), (3, 'cp3', 'Done Co'), (4, 'cp4', 'Unsent Co');
    INSERT INTO company_kyb_records (uid, company_id, started_by_user_id, status, entity_name, submitted_at) VALUES
      ('k1', 1, 3, 'in_review', 'Fixture Co Ltd', '${at(80)}'),
      ('k2', 2, 3, 'pending', 'Fixture Two Ltd', '${at(20)}'),
      ('k3', 3, 3, 'approved', 'Done Ltd', '${at(500)}'),
      ('k4', 4, 3, 'not_started', 'Unsent Ltd', NULL);
    INSERT INTO partners (id, name, email) VALUES (1, 'Fixture Partner', 'fp@example.test');
    INSERT INTO comarketing_pitches (uid, partner_id, submitter_user_id, title, summary, status, published_at, created_at) VALUES
      ('c1', 1, 3, 'Joint webinar', 's', 'proposed', NULL, '2026-10-24T10:00:00.000Z'),
      ('c2', 1, 3, 'Approved post', 's', 'approved', NULL, '2026-10-20T10:00:00.000Z'),
      ('c3', 1, 3, 'Published post', 's', 'published', '2026-10-21T10:00:00.000Z', '2026-10-19T10:00:00.000Z'),
      ('c4', 1, 3, 'No', 's', 'rejected', NULL, '2026-10-18T10:00:00.000Z'),
      ('c5', 1, 3, 'Pulled', 's', 'withdrawn', NULL, '2026-10-18T10:00:00.000Z');
    INSERT INTO experts (uid, user_id, name, headline, verified, is_active, profile_completion_pct, hidden_by_admin, created_at) VALUES
      ('ex1', 3, 'Ready Expert', 'Coach', 0, 1, 85, 0, '${at(30)}'),
      ('seed_ex2', NULL, 'Sample Expert', 'Coach', 0, 1, 95, 0, '${at(30)}'),
      ('ex3', NULL, 'Hidden Expert', 'Coach', 0, 1, 95, 1, '${at(30)}'),
      ('ex4', NULL, 'Verified Expert', 'Coach', 1, 1, 95, 0, '${at(30)}'),
      ('ex5', NULL, 'Thin Expert', 'Coach', 0, 1, 69, 0, '${at(30)}'),
      ('ex6', NULL, 'Gone Expert', 'Coach', 0, 0, 95, 0, '${at(30)}');
    INSERT INTO perks (uid, partner_name, category, offer, status, created_at, updated_at) VALUES
      ('p1', 'Fixture Partner', 'tools', 'Two months free', 'in_review', '${at(100)}', '${at(10)}'),
      ('p2', 'Fixture Partner', 'tools', 'Draft offer', 'draft', '${at(5)}', '${at(5)}'),
      ('p3', 'Fixture Partner', 'tools', 'Live offer', 'live', '${at(500)}', '${at(400)}'),
      ('p4', 'Fixture Partner', 'tools', 'No', 'rejected', '${at(500)}', '${at(400)}');
    INSERT INTO referral_strategic_access (user_id, status, created_at) VALUES (3, 'requested', '${at(12)}'), (2, 'granted', '${at(300)}');
    INSERT INTO lab_host_applications (uid, user_id, host_kind, host_id, capacity, status, created_at) VALUES
      ('h1', 3, 'advisor', 1, 'advisor', 'pending', '${at(50)}'),
      ('h2', 2, 'advisor', 2, 'advisor', 'approved', '${at(300)}');
    INSERT INTO projects (id, name) VALUES (1, 'Fixture Venture');
    INSERT INTO score_snapshots (project_id, total_score, tier, admin_review_status, is_sandbox, created_at) VALUES
      (1, 70, 'B', 'flagged', 0, '${at(40)}'),
      (1, 70, 'B', 'flagged', 1, '${at(40)}'),
      (1, 70, 'B', 'approved', 0, '${at(400)}'),
      (1, 70, 'B', 'auto_approved', 0, '${at(400)}');
    INSERT INTO articles (slug, title, author_user_id, status, submitted_at, created_at) VALUES
      ('a1', 'On pricing', 3, 'submitted', '2026-10-23T09:00:00.000Z', '${at(300)}'),
      ('a2', 'On hiring', 3, 'in_review', '2026-10-22T09:00:00.000Z', '${at(300)}'),
      ('a3', 'Back to you', 3, 'changes_requested', '2026-10-20T09:00:00.000Z', '${at(300)}'),
      ('a4', 'Ready to go', 3, 'approved', '2026-10-20T09:00:00.000Z', '${at(300)}'),
      ('a5', 'Still writing', 3, 'draft', NULL, '${at(300)}');
  `);
}

/** One waiting row and one decided row, per HQ lane. */
function seedHq(db: DatabaseSync) {
  db.exec(`
    INSERT INTO testing_programmes (uid, owner_kind, owner_partner_id, created_by, product_name, places, status, created_at, updated_at) VALUES
      ('t1', 'partner', 1, 3, 'Fixture App', 10, 'submitted', '${at(90)}', '${at(60)}'),
      ('t2', 'hq', NULL, 1, 'HQ App', 10, 'submitted', '${at(90)}', '${at(60)}'),
      ('t3', 'partner', 1, 3, 'Old App', 10, 'approved', '${at(900)}', '${at(800)}');
    INSERT INTO learning_exercises (id, uid, title, submission_kind, created_by) VALUES (1, 'le1', 'Write your ICP', 'text', 1);
    INSERT INTO learning_exercise_submissions (uid, exercise_id, user_id, body, status, submitted_at) VALUES
      ('ls1', 1, 3, 'b', 'submitted', '${at(30)}'),
      ('ls2', 1, 3, 'b', 'accepted', '${at(300)}'),
      ('ls3', 1, 3, 'b', 'needs_work', '${at(300)}');
    INSERT INTO tickets (id, title, type, user_id, created_at) VALUES
      (1, 'Dark mode', 'feature', 3, '${at(70)}'),
      (2, 'Reviewed idea', 'feature', 3, '${at(700)}'),
      (3, 'Write a guide', 'task', 3, '${at(20)}'),
      (4, 'Done task', 'task', 3, '${at(700)}'),
      (5, 'A bug', 'bug', 3, '${at(700)}');
    INSERT INTO feature_request_reviews (ticket_id, status) VALUES (2, 'approved');
    -- Migration 383's trigger writes each task ticket's pending row; decide one.
    UPDATE community_tasks SET created_at = '${at(20)}' WHERE ticket_id = 3;
    UPDATE community_tasks SET status = 'approved', created_at = '${at(700)}' WHERE ticket_id = 4;
    -- A task the label sync later re-typed to a bug keeps its pending row; HQ
    -- review reads it no more, so neither does the lane.
    INSERT INTO tickets (id, title, type, user_id, created_at) VALUES (6, 'Was a task', 'task', 3, '${at(900)}');
    UPDATE tickets SET type = 'bug' WHERE id = 6;
    UPDATE community_tasks SET created_at = '${at(900)}' WHERE ticket_id = 6;
    INSERT INTO payouts (user_id, amount_cents, payout_method, status, created_at) VALUES
      (3, 5000, 'bank', 'requested', '${at(15)}'),
      (3, 5000, 'bank', 'processing', '${at(25)}'),
      (3, 5000, 'bank', 'completed', '${at(250)}'),
      (3, 5000, 'bank', 'failed', '${at(250)}');
    INSERT INTO ai_budget_reservations (uid, user_id, day_key, month_key, included_microusd, topup_microusd, expires_at, status, settlement_uid, actual_included_microusd, actual_topup_microusd, created_at) VALUES
      ('r1', 3, '2026-10-25', '2026-10', 10, 0, '2026-10-26', 'review', NULL, NULL, NULL, '${at(8)}'),
      ('r2', 3, '2026-10-25', '2026-10', 10, 0, '2026-10-26', 'settled', 'st1', 10, 0, '${at(80)}');
    INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (1, 'lic1', 'AXL-1', 'Fixture SAS', 'Fixture Studio', 'active');
    INSERT INTO admin_notices (uid, user_id, licence_id, kind, subject, body, respond_by, status, responded_at, created_at) VALUES
      ('n1', 3, 1, 'fees', 'Fee change', 'b', '2026-11-01', 'responded', '${at(45)}', '${at(400)}'),
      ('n2', 3, 1, 'fees', 'Old', 'b', '2026-11-01', 'accepted', '${at(450)}', '${at(500)}');
    INSERT INTO hq_escalations (uid, branch_code, kind, subject, raised_by_name, status, created_at) VALUES
      ('e1', 'fr', 'question', 'Seats', 'Fixture Admin', 'open', '${at(35)}'),
      ('e2', 'fr', 'question', 'Old', 'Fixture Admin', 'answered', '${at(350)}');
    INSERT INTO program_proposals (uid, created_by_user_id, licence_uid, status, name, sent_at, created_at) VALUES
      ('pp1', 3, 'lic1', 'sent', 'Founder circles', '${at(55)}', '${at(60)}'),
      ('pp2', 3, NULL, 'draft', 'Unsent', NULL, '${at(60)}'),
      ('pp3', 3, NULL, 'approved', 'Done', '${at(600)}', '${at(600)}');
  `);
}

const glanceApp = new Hono<any>();
glanceApp.route('/api/admin/studio', glanceRoute);
async function glance(db: DatabaseSync, who: number, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => glanceApp.request('/api/admin/studio/glance', {
      headers: { Authorization: `Bearer ${token}` },
    }, env(db, extra)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

const inboxApp = new Hono<any>();
inboxApp.route('/api/admin/approvals', approvalsRoute);
async function inbox(db: DatabaseSync, who: number, path: string, init: RequestInit = {}, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => inboxApp.request(`/api/admin/approvals${path === '/' ? '' : path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }, env(db, extra)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

test('every lane, the studios\' and HQ\'s, reads on the full migration chain — none is unreadable', async () => {
  const db = fixture();
  const counts = await laneCounts(env(db));
  assert.deepEqual(counts.filter((c) => c.count === null).map((c) => c.key), []);
  const hq = await countLanes(env(db), HQ_APPROVAL_SOURCES);
  assert.deepEqual(hq.filter((c) => c.count === null).map((c) => c.key), []);
  // The rows queries read too: an empty database is an empty board, not a failed one.
  const board = await approvalBoard(env(db), 10, NOW);
  assert.deepEqual(board.unreadable, []);
  for (const s of HQ_APPROVAL_SOURCES) await db.prepare(s.rowsSql).all(10);
});

test('each new lane counts only what waits on an admin, and its rows agree with its count', async () => {
  const db = fixture();
  seed(db);
  const counts = Object.fromEntries((await laneCounts(env(db))).map((c) => [c.key, c]));
  assert.deepEqual(
    Object.fromEntries(['kyb', 'comarketing', 'wellbeing_experts', 'perk_listings', 'strategic_access', 'lab_hosts', 'score_flags', 'articles']
      .map((k) => [k, counts[k].count])),
    { kyb: 2, comarketing: 1, wellbeing_experts: 1, perk_listings: 1, strategic_access: 1, lab_hosts: 1, score_flags: 1, articles: 2 },
  );
  // The KYC lane is people only: no business reaches it.
  assert.equal(counts.kyc.count, 0);
  // The co-marketing sub-count: approved, not published yet.
  assert.deepEqual(counts.comarketing.sub, { label: 'approved, not published yet', count: 1 });
  // Oldest first, by each store's own clock: the in-review KYB (80 h) leads
  // the KYB lane; a perk waits from its submit (`updated_at`, 10 h), not its creation.
  assert.equal(counts.kyb.oldest_at, at(80));
  assert.equal(counts.perk_listings.oldest_at, at(10));
  assert.equal(counts.articles.oldest_at, '2026-10-22 09:00:00');

  const board = await approvalBoard(env(db), 100, NOW);
  for (const s of APPROVAL_SOURCES) {
    assert.equal(board.items.filter((i) => i.lane === s.key).length, counts[s.key].count, s.key);
  }
  for (const it of board.items) assert.ok(it.who.trim() && it.what.trim(), `${it.lane}:${it.id}`);
  assert.equal(board.items.find((i) => i.lane === 'kyb' && i.age_hours === 80)?.who, 'Fixture Co');
  assert.equal(board.items.find((i) => i.lane === 'comarketing')?.who, 'Fixture Partner');
  assert.equal(board.items.find((i) => i.lane === 'score_flags')?.who, 'Fixture Venture');
});

test('each HQ lane counts only its queue\'s own open items', async () => {
  const db = fixture();
  seedHq(db);
  const hq = Object.fromEntries((await countLanes(env(db), HQ_APPROVAL_SOURCES)).map((c) => [c.key, c]));
  assert.deepEqual(Object.fromEntries(Object.entries(hq).map(([k, v]) => [k, v.count])), {
    testing_programs: 1, learning: 1, tickets: 2, payouts: 2, ai_runs: 1, notices: 1, support: 1, proposals: 1,
  });
  // Features and tasks: the oldest is the unreviewed feature (70 h), not the reviewed one.
  assert.equal(hq.tickets.oldest_at, at(70));
  // A notice waits from its response, not its issue.
  assert.equal(hq.notices.oldest_at, at(45));
  for (const s of HQ_APPROVAL_SOURCES) {
    const rows = (await db.prepare(s.rowsSql).all(100)) as any[];
    assert.equal(rows.length, hq[s.key].count, s.key);
    for (const r of rows) assert.ok(String(r.who).trim() && String(r.what).trim(), `${s.key}:${r.id}`);
  }
  const support = (await db.prepare(HQ_APPROVAL_SOURCES.find((s) => s.key === 'support')!.rowsSql).all(10)) as any[];
  assert.equal(support[0].who, 'Fixture Admin');
  const props = (await db.prepare(HQ_APPROVAL_SOURCES.find((s) => s.key === 'proposals')!.rowsSql).all(10)) as any[];
  assert.equal(props[0].who, 'Fixture Studio');
});

/**
 * The CHECK list a migration gives a table's column, parsed from that table's
 * CREATE. The patterns are literal and the names are compared after matching,
 * so no expression is built from an argument.
 */
function checkList(file: string, table: string, column: string): string[] {
  const all = readFileSync(resolve(MIGRATIONS, file), 'utf8');
  const create = [...all.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)\s*\(/gi)].find((m) => m[1] === table);
  assert.ok(create, `${file} no longer creates ${table}`);
  const start = create!.index!;
  const next = all.slice(start + 1).search(/CREATE (?:TABLE|INDEX|TRIGGER|UNIQUE)/i);
  const sql = next < 0 ? all.slice(start) : all.slice(start, start + 1 + next);
  const m = [...sql.matchAll(/CHECK\s*\(\s*([a-z_]+)\s+IN\s*\(([^)]*)\)/gi)].find((x) => x[1] === column);
  assert.ok(m, `${file} no longer CHECKs ${table}.${column}`);
  return [...m![2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}
/** The words a lane's SQL compares a column against (an alias such as `k.` is dropped). */
function wordsIn(sql: string, column: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\b([a-z_][a-z0-9_.]*)\s*(?:=\s*'([a-z_]+)'|IN\s*\(([^)]*)\))/g)) {
    if (m[1].split('.').pop() !== column) continue;
    if (m[2]) out.push(m[2]);
    else out.push(...[...m[3].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  }
  return [...new Set(out)];
}

test('every status word a lane reads is its store\'s own, held to the migration\'s CHECK', () => {
  const src = (key: string) => [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES].find((s) => s.key === key)!;
  const cases: Array<[string, string, string, string, string[]]> = [
    ['perk_listings', '186_perks.sql', 'perks', 'status', ['in_review']],
    ['lab_hosts', '313_lab_host_applications.sql', 'lab_host_applications', 'status', ['pending']],
    ['strategic_access', '175_referral_submissions.sql', 'referral_strategic_access', 'status', ['requested']],
    ['testing_programs', '516_product_testing.sql', 'testing_programmes', 'status', ['submitted']],
    ['learning', '390_learning_exercises_exams.sql', 'learning_exercise_submissions', 'status', ['submitted']],
    ['ai_runs', '419_ai_caps_topups.sql', 'ai_budget_reservations', 'status', ['review']],
    ['notices', '264_admin_notices.sql', 'admin_notices', 'status', ['responded']],
    ['proposals', '561_program_proposals.sql', 'program_proposals', 'status', ['sent']],
  ];
  for (const [key, file, table, col, expected] of cases) {
    const allowed = checkList(file, table, col);
    const used = wordsIn(src(key).countSql, col);
    assert.deepEqual(used.sort(), expected.sort(), `${key} counts other words than its waiting state`);
    for (const w of used) assert.ok(allowed.includes(w), `${key}: '${w}' is not in ${file}'s CHECK`);
    assert.deepEqual(wordsIn(src(key).rowsSql, col).sort(), used.sort(), `${key}: the rows and the count disagree`);
  }
  // Community tasks, the second store under Features and tasks.
  assert.ok(checkList('383_community_tasks.sql', 'community_tasks', 'status').includes('pending'));
  // Stores with no CHECK keep their writers' words, spelled here so a change shows.
  assert.deepEqual(wordsIn(src('kyb').countSql, 'status').sort(), ['in_review', 'pending']);
  assert.deepEqual(wordsIn(src('comarketing').countSql, 'status'), ['proposed']);
  assert.deepEqual(wordsIn(src('articles').countSql, 'status').sort(), ['in_review', 'submitted']);
  assert.deepEqual(wordsIn(src('score_flags').countSql, 'admin_review_status'), ['flagged']);
  assert.deepEqual(wordsIn(src('payouts').countSql, 'status').sort(), ['processing', 'requested']);
  assert.deepEqual(wordsIn(src('support').countSql, 'status'), ['open']);
});

test('every lane says who it tells and where it is decided; the gaps are named, never laned', () => {
  for (const s of [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES]) {
    assert.ok(s.notifies.trim(), `${s.key} has no notifies`);
    assert.ok(s.decidedOn || s.undecidedReason, `${s.key} has neither a page nor a reason`);
  }
  const by = Object.fromEntries([...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES].map((s) => [s.key, s]));
  // Read off the decide routes (D1041 §4): only these tell anyone today.
  assert.deepEqual(
    Object.fromEntries(Object.entries(by).filter(([, s]) => s.notifies !== 'Nobody yet').map(([k, s]) => [k, s.notifies])),
    {
      cohort: 'The member', partner_profiles: 'The partner, when an agreement is sent', jobs: 'The host', events: 'The host',
      articles: 'The author', testing_programs: 'The partner', tickets: 'The member', notices: 'The studio', support: 'The studio',
    },
  );
  assert.equal(by.kyb.decidedOn, null);
  assert.match(by.kyb.undecidedReason!, /No admin route decides/);
  const keys = new Set([...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES].map((s) => s.key));
  for (const n of [...NOT_COUNTED_YET, ...HQ_NOT_COUNTED_YET]) assert.ok(!keys.has(n.key as any), `${n.key} is both laned and not`);
  assert.deepEqual(NOT_COUNTED_YET.map((n) => n.key), ['product_testers']);
  assert.deepEqual(HQ_NOT_COUNTED_YET.map((n) => n.key), ['grants']);
  assert.deepEqual(SUB_COUNTS_NOT_YET.map((n) => `${n.lane}:${n.label}`), ['due_diligence:ready for sign-off']);
  // HQ's lanes are not every studio's: none of them reaches a branch's board or backlog.
  for (const s of HQ_APPROVAL_SOURCES) assert.ok(!APPROVAL_SOURCES.some((a) => a.key === (s.key as string)), s.key);
});

test('the glance: HQ decides for a Super Admin only, with notifies and decided_on on every lane', async () => {
  const db = fixture();
  seed(db);
  seedHq(db);
  const sup = await glance(db, SUPER);
  assert.equal(sup.status, 200, JSON.stringify(sup.body));
  const ap = sup.body.approvals;
  const lane = (k: string) => ap.lanes.find((l: any) => l.key === k);
  assert.deepEqual([lane('articles').notifies, lane('articles').decided_on], ['The author', 'Content queue']);
  assert.deepEqual(lane('comarketing').sub, { label: 'approved, not published yet', count: 1 });
  assert.equal(lane('kyb').decided_on, null);
  assert.ok(lane('kyb').undecided_reason);
  assert.deepEqual(ap.not_counted.map((n: any) => n.key), ['product_testers']);
  assert.equal(ap.hq_decides.lanes.length, HQ_APPROVAL_SOURCES.length);
  assert.equal(ap.hq_decides.pending_total, 10);
  assert.deepEqual(ap.hq_decides.not_counted.map((n: any) => n.key), ['grants']);
  // HQ's total stays apart from the studios' lanes.
  assert.equal(ap.pending_total, ap.lanes.reduce((t: number, l: any) => t + l.count, 0));

  const plain = await glance(db, PLAIN);
  assert.equal(plain.status, 200);
  assert.equal(plain.body.approvals.hq_decides, undefined, 'an Admin who is not the Super Admin saw HQ decides');
  assert.ok(plain.body.approvals.lanes.find((l: any) => l.key === 'articles'), 'an Admin still sees every studio lane');
});

test('one failed lane is null with its reason and leaves the others; a failed sub-count leaves its lane', async () => {
  const db = fixture();
  seed(db);
  seedHq(db);
  db.exec('DROP TABLE payouts');
  const hq = await hqLanes(env(db), NOW);
  const payouts = hq.lanes.find((l) => l.key === 'payouts')!;
  assert.equal(payouts.count, null);
  assert.equal(hq.pending_total, null, 'a total over a failed lane must not be shown as the total');
  assert.deepEqual(hq.unreadable, ['Payout requests']);
  assert.ok(hq.lanes.filter((l) => l.key !== 'payouts').every((l) => typeof l.count === 'number'));
  const sup = await glance(db, SUPER);
  assert.ok(sup.body.approvals.hq_decides.lanes.find((l: any) => l.key === 'payouts').reason);

  // The co-marketing sub-count alone failing: the lane keeps its count.
  db.exec('ALTER TABLE comarketing_pitches RENAME COLUMN published_at TO published_when');
  const lanes = Object.fromEntries((await laneCounts(env(db))).map((c) => [c.key, c]));
  assert.equal(lanes.comarketing.count, 1);
  assert.deepEqual(lanes.comarketing.sub, { label: 'approved, not published yet', count: null });
});

test('HQ\'s inbox (D1040) carries HQ\'s lanes for a Super Admin only: read, assigned and its history', async () => {
  const db = fixture();
  seed(db);
  seedHq(db);
  const HQ_KEYS = HQ_APPROVAL_SOURCES.map((s) => s.key as string);
  const sup = await inbox(db, SUPER, '/');
  assert.equal(sup.status, 200, JSON.stringify(sup.body));
  assert.deepEqual(sup.body.unreadable, [], 'every lane, HQ\'s included, reads on the full chain');
  const supLanes = new Set(sup.body.items.map((it: any) => it.lane));
  for (const k of HQ_KEYS) assert.ok(supLanes.has(k), `the Super Admin's inbox has no ${k} item`);
  const plain = await inbox(db, PLAIN, '/');
  assert.equal(plain.status, 200);
  assert.equal(plain.body.items.some((it: any) => HQ_KEYS.includes(it.lane)), false, 'an Admin saw an HQ item');
  assert.equal(plain.body.lanes.some((l: any) => HQ_KEYS.includes(l.key)), false);
  assert.ok(plain.body.items.some((it: any) => it.lane === 'articles'), 'an Admin still sees the studio lanes');
  assert.equal(sup.body.total, plain.body.total + 10, 'HQ\'s ten open items are the whole difference');

  const support = sup.body.items.find((it: any) => it.lane === 'support');
  const item = [{ lane: 'support', item_id: support.id }];
  const post = (who: number) => inbox(db, who, '/assignments', { method: 'POST', body: JSON.stringify({ assignee_user_id: PLAIN, items: item }) });
  assert.equal((await post(PLAIN)).body.error, 'bad_item', 'an Admin assigned on an HQ lane');
  assert.equal((await inbox(db, PLAIN, `/history?lane=support&item_id=${support.id}`)).body.error, 'bad_item');
  assert.equal((await post(SUPER)).status, 200);
  assert.equal((await inbox(db, SUPER, `/history?lane=support&item_id=${support.id}`)).body.items.length, 1);

  const onBranch = await inbox(db, SUPER, '/', {}, { BRANCH_CODE: 'pt' });
  assert.equal(onBranch.body.items.some((it: any) => HQ_KEYS.includes(it.lane)), false, 'an HQ lane read on a branch');
});
