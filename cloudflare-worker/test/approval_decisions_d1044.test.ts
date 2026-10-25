/**
 * D1044 (#2892, part 6 of #2390) — the decision log, the weekly
 * arrived-and-decided series and the "Decided this week" tile, each lane read
 * from its own store.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, as `approval_lanes_d1041.test.ts` builds it, so every lane's SQL
 * runs against production's columns. Every name, note and figure is made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import approvalsRoute from '../src/routes/admin_approvals.ts';
import { APPROVAL_SOURCES, NOT_COUNTED_YET } from '../src/services/approvalSources.ts';
import { HQ_APPROVAL_SOURCES } from '../src/services/hqApprovalSources.ts';
import { VERDICT_STATUSES } from '../src/services/referralSubmissions.ts';
import {
  DECISION_LANES, REFERRAL_VERDICTS_SQL, countSql, listSql, weekStart,
} from '../src/services/approvalDecisions.ts';
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
const SUPER = 1, PLAIN = 2, MEMBER = 3, OTHER = 4;
// A Sunday: the week runs from Monday 19 Oct 2026.
const NOW = Date.parse('2026-10-25T12:00:00Z');
const sqlAt = (h: number) => new Date(NOW - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
const isoAt = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const pin = (t: any) => t.mock.timers.enable({ apis: ['Date'], now: NOW });

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(PLAIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test');
  u.run(OTHER, 'founder', 'Ola Other', 'ola@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN, MEMBER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  return db;
}
const env = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' }) as any;

/** Decided rows in several lanes, a waiting row or two, and rows that are not decisions. */
function seed(db: DatabaseSync) {
  db.exec(`
    -- LP: approved this week (waited 50 h), declined last month, pending, withdrawn.
    INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status, reviewed_by, reviewed_at, review_note, created_at) VALUES
      (1, ${MEMBER}, 'f1', 'individual', 'approved', ${PLAIN}, '${sqlAt(10)}', NULL, '${sqlAt(60)}'),
      (2, ${OTHER}, 'f2', 'individual', 'declined', ${SUPER}, '${sqlAt(2000)}', 'Not accredited yet.', '${sqlAt(2020)}'),
      (3, ${OTHER}, 'f3', 'individual', 'pending', NULL, NULL, NULL, '${sqlAt(30)}'),
      (4, ${MEMBER}, 'f4', 'individual', 'withdrawn', NULL, NULL, NULL, '${sqlAt(30)}'),
      -- In review is a move, not a decision, though it stamps reviewed_at.
      (5, ${OTHER}, 'f5', 'individual', 'in_review', ${PLAIN}, '${sqlAt(4)}', NULL, '${sqlAt(30)}');
    -- Referrals: the earliest verdict is the decision; later ones are not new decisions.
    INSERT INTO referral_submissions (id, uid, referrer_user_id, referred_name, status, created_at) VALUES
      (1, 'rs1', ${MEMBER}, 'Acme', 'converted', '${sqlAt(100)}'),
      (2, 'rs2', ${OTHER}, 'Beta', 'under_review', '${sqlAt(20)}');
    INSERT INTO referral_submission_events (submission_id, label, status, note, actor_user_id, created_at) VALUES
      (1, 'Submitted', 'submitted', NULL, NULL, '${sqlAt(100)}'),
      (1, 'Qualified', 'qualified', 'A warm intro.', ${PLAIN}, '${sqlAt(40)}'),
      (1, 'Converted', 'converted', NULL, ${SUPER}, '${sqlAt(5)}'),
      (2, 'Under review', 'under_review', NULL, ${PLAIN}, '${sqlAt(10)}');
    -- Cohort: by an admin, and by the scheduler.
    INSERT INTO cohort_applicants (id, application_id, user_id, cohort_cycle_id, status, decided_at, decided_by, decision_reason, created_at) VALUES
      (1, 1, ${MEMBER}, 1, 'approved', '${sqlAt(20)}', 'admin:${SUPER}', 'Strong team.', '${sqlAt(90)}'),
      (2, 2, ${OTHER}, 1, 'waitlisted', '${sqlAt(30)}', 'system', NULL, '${sqlAt(90)}'),
      (3, 3, ${OTHER}, 1, 'pending', NULL, NULL, NULL, '${sqlAt(15)}');
    -- Moderation: a case resolved by suspending (a new case opened at once), and one closed.
    INSERT INTO spinout_moderation_cases (id, user_id, status, reason_code, opened_by, opened_at, resolved_by, resolved_at, summary, created_at) VALUES
      (1, ${MEMBER}, 'under_review', 'conduct', ${PLAIN}, '${sqlAt(80)}', ${PLAIN}, '${sqlAt(8)}', NULL, '${sqlAt(80)}'),
      (2, ${MEMBER}, 'suspended', 'conduct', ${PLAIN}, '${sqlAt(8)}', NULL, NULL, 'Two weeks off.', '${sqlAt(8)}'),
      (3, ${OTHER}, 'under_review', 'spam', ${PLAIN}, '${sqlAt(70)}', ${SUPER}, '${sqlAt(7)}', NULL, '${sqlAt(70)}');
    -- KYC: approved after submission; a resubmission after an old review is not decided.
    UPDATE users SET kyc_status = 'approved', kyc_submitted_at = '${sqlAt(30)}', kyc_reviewed_at = '${sqlAt(6)}', kyc_reviewed_by = ${SUPER} WHERE id = ${MEMBER};
    UPDATE users SET kyc_status = 'rejected', kyc_submitted_at = '${sqlAt(3)}', kyc_reviewed_at = '${sqlAt(300)}', kyc_reviewed_by = ${SUPER},
      kyc_rejection_reason = 'Blurry photo.' WHERE id = ${OTHER};
    -- Articles: approved, and sent back by a revision.
    INSERT INTO articles (id, slug, title, author_user_id, reviewer_user_id, status, submitted_at, approved_at, created_at) VALUES
      (1, 'a1', 'One', ${MEMBER}, ${PLAIN}, 'approved', '${isoAt(48)}', '${isoAt(4)}', '${sqlAt(200)}');
    INSERT INTO article_revisions (article_id, rev, title, body_markdown, status_at_save, saved_by, reason, created_at) VALUES
      (1, 1, 'One', 'x', 'in_review', ${PLAIN}, 'request_changes', '${sqlAt(30)}');
    -- Perks: live, with no arrival kept once reviewed.
    INSERT INTO perks (id, uid, partner_name, category, offer, status, review_note, reviewed_by_user_id, reviewed_at, created_at, updated_at) VALUES
      (1, 'pk1', 'Fixture Partner', 'tools', 'Two months free', 'live', NULL, ${PLAIN}, '${isoAt(9)}', '${sqlAt(500)}', '${isoAt(9)}');
    -- Product testers: their own log.
    INSERT INTO product_testers (id, user_id, status, applied_at, decided_at, decided_by, reason) VALUES
      (1, ${OTHER}, 'declined', '${sqlAt(26)}', '${sqlAt(2)}', ${PLAIN}, 'No availability given.');
    INSERT INTO product_tester_events (tester_id, user_id, action, from_status, to_status, actor_user_id, reason, created_at) VALUES
      (1, ${OTHER}, 'applied', NULL, 'applied', ${OTHER}, NULL, '${sqlAt(26)}'),
      (1, ${OTHER}, 'declined', 'applied', 'declined', ${PLAIN}, 'No availability given.', '${sqlAt(2)}');
    -- HQ: a support answer by a named HQ admin, and a payout paid.
    INSERT INTO hq_escalations (id, uid, branch_code, kind, subject, raised_by_name, status, created_at, answer, answered_by_user_id, answered_at, answered_by_name) VALUES
      (1, 'q1', 'lisbon', 'question', 'Fees', 'Rita Branch', 'answered', '${sqlAt(30)}', 'They are due in May.', ${SUPER}, '${isoAt(1)}', 'Sue Super'),
      (2, 'q2', 'lisbon', 'question', 'Open one', 'Rita Branch', 'open', '${sqlAt(12)}', NULL, NULL, NULL, NULL),
      -- A program request is the grants lane's, never Support's (D1132).
      (3, 'q3', 'lisbon', 'program_grant', 'Learning', 'Rita Branch', 'declined', '${sqlAt(40)}', 'Not this year.', ${SUPER}, '${isoAt(2)}', 'Sue Super');
    INSERT INTO payouts (id, user_id, amount_cents, status, payout_method, processed_by, created_at, completed_at) VALUES
      (1, ${MEMBER}, 5000, 'completed', 'bank', ${SUPER}, '${sqlAt(100)}', '${sqlAt(3)}');
  `);
}

const app = new Hono<any>();
app.route('/api/admin/approvals', approvalsRoute);
async function call(db: DatabaseSync, who: number, path: string) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/approvals${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, env(db)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

// ---------------------------------------------------------------- the lane list

test('every lane is in the log, in the canvas\'s order, and every recorded lane reads on the full chain', () => {
  assert.deepEqual(DECISION_LANES.map((l) => l.key), [
    ...APPROVAL_SOURCES.map((s) => s.key), ...NOT_COUNTED_YET.map((n) => n.key), ...HQ_APPROVAL_SOURCES.map((s) => s.key),
  ]);
  for (const l of DECISION_LANES) {
    const src = [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES].find((s) => s.key === l.key);
    assert.equal(l.scope, src?.scope, `${l.key}'s scope differs from its inbox lane`);
  }
  const db = fixture();
  for (const l of DECISION_LANES) {
    if (!l.recorded) { assert.ok(l.reason.length > 20, `${l.key} says why it does not record`); continue; }
    db.prepare(listSql(l)).all(null, null, null, null, null, null, null, null, 5);
    db.prepare(countSql(l)).get(null, null, null, null, null, null, null, null);
  }
  assert.deepEqual(DECISION_LANES.filter((l) => !l.recorded).map((l) => l.key),
    ['jobs', 'best_fit', 'due_diligence', 'kyb', 'wellbeing_experts', 'ai_runs', 'grants']);
});

test('a referral\'s verdicts are the store\'s own list', () => {
  const words = [...REFERRAL_VERDICTS_SQL.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...words].sort(), [...VERDICT_STATUSES].sort());
});

test('weeks start on Monday, UTC', () => {
  assert.equal(new Date(weekStart(NOW)).toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(new Date(weekStart(Date.parse('2026-10-19T00:00:00Z'))).toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(new Date(weekStart(Date.parse('2026-10-18T23:59:59Z'))).toISOString(), '2026-10-12T00:00:00.000Z');
});

// ---------------------------------------------------------------- the log

test('GET /decided: newest first, with outcome, who decided, the wait and whether the person sees the note', async (t) => {
  pin(t);
  const db = fixture(); seed(db);
  const { status, body } = await call(db, SUPER, '/decided');
  assert.equal(status, 200);
  const at = (lane: string, id: number) => body.items.filter((r: any) => r.lane === lane && r.item_id === id);
  const keys = body.items.map((r: any) => r.decided_at);
  assert.deepEqual(keys, [...keys].sort().reverse(), 'not newest first');

  const [lp] = at('lp', 1);
  assert.deepEqual([lp.outcome, lp.outcome_word, lp.decided_by.name, lp.wait_hours, lp.note, lp.note_shown], ['approved', 'Approved', 'Pat Plain', 50, null, false]);
  const [ref] = at('referrals', 1);
  assert.deepEqual([ref.outcome_word, ref.decided_by.name, ref.wait_hours, ref.note, ref.note_shown], ['Approved', 'Pat Plain', 60, 'A warm intro.', true]);
  assert.equal(at('referrals', 2).length, 0, 'a referral under review was listed as decided');
  assert.deepEqual(at('cohort', 1).map((r: any) => [r.decided_by.name, r.note, r.note_shown]), [['Sue Super', 'Strong team.', false]]);
  assert.deepEqual(at('cohort', 2).map((r: any) => [r.outcome, r.outcome_word, r.decided_by.name]), [['other', 'Waitlisted', 'The scheduler']]);
  assert.deepEqual(at('moderation', 1).map((r: any) => [r.outcome, r.outcome_word, r.note]), [['declined', 'Suspended', 'Two weeks off.']]);
  assert.deepEqual(at('moderation', 3).map((r: any) => r.outcome_word), ['Closed']);
  assert.deepEqual(at('kyc', MEMBER).map((r: any) => r.wait_hours), [24]);
  assert.equal(at('kyc', OTHER).length, 0, 'a resubmitted KYC kept its old review as a decision');
  assert.deepEqual(at('articles', 1).map((r: any) => r.outcome_word).sort(), ['Approved', 'Sent back']);
  assert.deepEqual(at('perk_listings', 1).map((r: any) => r.wait_hours), [null], 'a perk\'s wait is not recorded');
  assert.deepEqual(at('product_testers', 1).map((r: any) => [r.outcome, r.note, r.note_shown]), [['declined', 'No availability given.', true]]);
  assert.deepEqual(at('support', 1).map((r: any) => [r.outcome_word, r.decided_by.name, r.note_shown]), [['Answered', 'Sue Super', true]]);
  assert.equal(at('support', 3).length, 0, 'a program request was listed under Support');
  assert.deepEqual(at('grants', 3).map((r: any) => [r.outcome, r.note, r.wait_hours]), [['declined', 'Not this year.', 38]]);
  assert.equal(at('lp', 3).length + at('lp', 4).length + at('lp', 5).length, 0, 'pending, withdrawn or in-review LP rows were listed');

  assert.equal(body.total, 15);
  assert.deepEqual(body.unreadable, []);
  const jobs = body.lanes.find((l: any) => l.key === 'jobs');
  assert.deepEqual([jobs.recorded, jobs.since], [false, null]);
  assert.match(jobs.reason, /no decision time/);
  assert.equal(body.lanes.find((l: any) => l.key === 'partner_profiles').since, '2026-10-25');
  assert.equal(body.lanes.find((l: any) => l.key === 'lp').count, 2);
  assert.ok(body.not_recorded.includes('Wellbeing experts'));
});

test('HQ\'s lanes are a Super Admin\'s: a plain Admin reads none and cannot name one', async (t) => {
  pin(t);
  const db = fixture(); seed(db);
  const plain = await call(db, PLAIN, '/decided');
  assert.equal(plain.status, 200);
  assert.ok(!plain.body.items.some((r: any) => ['support', 'payouts'].includes(r.lane)));
  assert.ok(!plain.body.lanes.some((l: any) => l.scope === 'hq'));
  assert.equal(plain.body.total, 12);
  assert.equal((await call(db, PLAIN, '/decided?lane=support')).body.error, 'bad_lane');
  assert.equal((await call(db, SUPER, '/decided?lane=support')).body.total, 1);
  const weekly = await call(db, PLAIN, '/decided/weekly');
  assert.ok(!weekly.body.lanes.some((l: any) => l.key === 'payouts'));
  assert.equal((await call(db, MEMBER, '/decided')).status, 403);
});

test('filters: lane, outcome, decided by and days; a bad one is refused in words', async (t) => {
  pin(t);
  const db = fixture(); seed(db);
  const declined = await call(db, SUPER, '/decided?outcome=declined');
  assert.ok(declined.body.items.length > 0 && declined.body.items.every((r: any) => r.outcome === 'declined'));
  const byPat = await call(db, SUPER, `/decided?decided_by=${PLAIN}`);
  assert.ok(byPat.body.items.every((r: any) => r.decided_by?.id === PLAIN));
  assert.equal(byPat.body.total, byPat.body.items.length);
  const lastMonth = await call(db, SUPER, '/decided?to=2026-09-30');
  assert.deepEqual(lastMonth.body.items.map((r: any) => [r.lane, r.item_id]), [['lp', 2]]);
  const today = await call(db, SUPER, '/decided?to=2026-10-25&lane=lp');
  assert.deepEqual(today.body.items.map((r: any) => r.item_id), [1, 2], 'to= is not the whole day');
  const thisWeek = await call(db, SUPER, '/decided?from=2026-10-19&lane=lp');
  assert.deepEqual(thisWeek.body.items.map((r: any) => r.item_id), [1]);
  const jobs = await call(db, SUPER, '/decided?lane=jobs');
  assert.deepEqual([jobs.body.items.length, jobs.body.total], [0, null]);
  assert.match(jobs.body.total_reason, /does not record its decisions/);
  for (const [q, code] of [['outcome=maybe', 'bad_outcome'], ['decided_by=x', 'bad_decided_by'], ['from=2026-13-01', 'bad_date'],
    ['from=2026-10-20&to=2026-10-19', 'bad_date'], ['page=0', 'bad_page'], ['page=41', 'bad_page'], ['lane=nope', 'bad_lane']]) {
    const r = await call(db, SUPER, `/decided?${q}`);
    assert.deepEqual([r.status, r.body.error], [400, code], q);
  }
});

test('pages merge the lanes exactly: 25 a page, and the total is the sum of every lane', async (t) => {
  pin(t);
  const db = fixture();
  const ins = db.prepare("INSERT INTO lp_applications (user_id, fund_slug, investor_type, status, reviewed_by, reviewed_at, created_at) VALUES (?, ?, 'individual', 'approved', ?, ?, ?)");
  for (let i = 0; i < 30; i += 1) ins.run(MEMBER, `f${i}`, PLAIN, sqlAt(i * 2 + 1), sqlAt(200));
  const hq = db.prepare("INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, created_at, answered_at, answered_by_user_id) VALUES (?, 'b', 'question', 's', 'answered', ?, ?, ?)");
  for (let i = 0; i < 12; i += 1) hq.run(`e${i}`, sqlAt(300), sqlAt(i * 2 + 2), SUPER);
  const one = await call(db, SUPER, '/decided');
  const two = await call(db, SUPER, '/decided?page=2');
  assert.equal(one.body.total, 42);
  assert.deepEqual([one.body.items.length, two.body.items.length], [25, 17]);
  const all = [...one.body.items, ...two.body.items].map((r: any) => r.decided_at);
  assert.deepEqual(all, [...all].sort().reverse());
  assert.equal(new Set([...one.body.items, ...two.body.items].map((r: any) => `${r.lane}:${r.item_id}`)).size, 42);
});

test('one failed lane is named, its total is null, and every other lane still answers', async (t) => {
  pin(t);
  const db = fixture(); seed(db);
  db.exec('DROP TABLE product_tester_events');
  const { body } = await call(db, SUPER, '/decided');
  assert.deepEqual(body.unreadable, ['Product testers']);
  assert.equal(body.total, null);
  assert.match(body.total_reason, /Product testers could not be read/);
  assert.equal(body.lanes.find((l: any) => l.key === 'product_testers').count, null);
  assert.ok(body.items.some((r: any) => r.lane === 'lp'));
});

// ---------------------------------------------------------------- the series and the tile

test('GET /decided/weekly: eight weeks to this one, arrived and decided per lane, and the tile', async (t) => {
  pin(t);
  const db = fixture(); seed(db);
  const { status, body } = await call(db, SUPER, '/decided/weekly');
  assert.equal(status, 200);
  assert.equal(body.weeks.length, 8);
  assert.deepEqual([body.weeks[0].week_start, body.weeks[7].week_start, body.weeks[7].to_date, body.weeks[6].to_date],
    ['2026-08-31', '2026-10-19', true, false]);
  const lane = (k: string) => body.lanes.find((l: any) => l.key === k);
  // LP: one decided this week; arrivals are the decided one (60 h ago, this week) and the pending one.
  assert.deepEqual(lane('lp').decided.slice(6), [0, 1]);
  assert.deepEqual(lane('lp').arrived.slice(6), [0, 2]);
  assert.equal(lane('lp').decided.reduce((a: number, b: number) => a + b, 0), 1, 'a decision before the eight weeks was counted');
  // Support: the open one and the answered one arrived this week.
  assert.deepEqual(lane('support').arrived.slice(7), [2]);
  // Perks keep no arrival once decided: decided counts, arrivals do not.
  assert.equal(lane('perk_listings').arrived, null);
  assert.match(lane('perk_listings').reason, /no arrival time/);
  assert.deepEqual(lane('perk_listings').decided.slice(7), [1]);
  // A lane that does not record is not a zero.
  assert.deepEqual([lane('jobs').available, lane('jobs').decided, lane('jobs').arrived], [false, null, null]);
  assert.ok(body.totals.decided_leaves_out.includes('Jobs'));
  assert.equal(body.totals.decided[7], body.lanes.filter((l: any) => l.decided).reduce((s: number, l: any) => s + l.decided[7], 0));
  // The tile: every decision this week, and the median wait of those with both ends.
  assert.equal(body.tile.decided_this_week, 14);
  assert.equal(typeof body.tile.median_wait_hours, 'number');
  assert.ok(body.tile.leaves_out.includes('Wellbeing experts'));
});

test('weekly: a failed lane makes the tile unknown, never a short count', async (t) => {
  pin(t);
  const db = fixture(); seed(db);
  db.exec('DROP TABLE payouts');
  const { body } = await call(db, SUPER, '/decided/weekly');
  assert.equal(body.tile.decided_this_week, null);
  assert.match(body.tile.reason, /Payouts could not be read|could not be read/);
  assert.ok(body.unreadable.length >= 1);
  assert.equal(body.lanes.find((l: any) => l.key === 'lp').available, true);
});
