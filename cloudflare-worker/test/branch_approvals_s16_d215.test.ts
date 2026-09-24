/**
 * S16 (D215) — Approvals takes in the queues the live console kept on their
 * own pages.
 *
 * THE FIXTURE IS THE BASELINE, NOT A HAND-TRIMMED COPY. Seven new queries name
 * seven stores' columns, and D130's own comment records the cost of guessing:
 * two of its first four table names were wrong, and that failed as a lane
 * reading "unreadable" forever — a plausible answer that is never right. So
 * every table here is cut from `sql/schema_baseline.sql`, and the first test
 * fails if any lane cannot be read against production's own shapes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  APPROVAL_SOURCES,
  NOT_LANED,
  approvalBoard,
  laneCounts,
} from '../src/services/approvalSources.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const TABLES = [
  'users', 'lp_applications', 'referral_submissions', 'cohort_applicants',
  'partner_profiles', 'user_role_review', 'job_postings', 'events', 'admin_consultation_bookings', 'dd_cases',
];
const NOW = Date.parse('2026-09-24T12:00:00Z');
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

function db() {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of TABLES) d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  // NOT IN THE BASELINE: `spinout_moderation.ts` creates it lazily on first
  // use. Trimmed from that route's own DDL.
  d.exec(`CREATE TABLE spinout_moderation_cases (id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, status TEXT NOT NULL, reason_code TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  return d;
}

/**
 * One OPEN and one DECIDED row per new lane. The decided row is the point:
 * a predicate that counted everything would still find the open one, so
 * without it the test could not tell the right status from no status at all.
 */
function seed(d: DatabaseSync) {
  d.exec(`
    INSERT INTO users (id, email, name, role, kyc_status, kyc_submitted_at, created_at) VALUES
      (1, 'kyc@x.test', 'Kay', 'founder', 'pending', '${at(90)}', '${at(900)}'),
      (2, 'done@x.test', 'Done', 'founder', 'approved', '${at(95)}', '${at(900)}'),
      (3, 'exp@x.test', '', 'exploring', 'not_started', NULL, '${at(500)}'),
      (4, 'host@x.test', 'Hostess', 'partner', 'not_started', NULL, '${at(900)}');
    INSERT INTO user_role_review (user_id, suggested_role, onboarded_at) VALUES (3, 'investor', '${at(40)}');
    INSERT INTO partner_profiles (email, persona, legal_entity_name, admin_status, created_at) VALUES
      ('orphan@x.test', 'consultant', 'Orphan LLC', 'pending', '${at(60)}'),
      ('ok@x.test', 'consultant', 'Verified Co', 'verified', '${at(600)}');
    INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES
      (5, 'j1', 4, 'Founding engineer', 'pending_review', '${at(30)}'),
      (6, 'j2', 4, 'Old job', 'published', '${at(600)}');
    INSERT INTO events (id, slug, host_user_id, title, starts_at, status, created_at) VALUES
      (7, 'e1', 4, 'Demo night', '2026-10-01 18:00:00', 'pending_review', '${at(20)}'),
      (8, 'e2', 4, 'Past', '2026-01-01 18:00:00', 'published', '${at(600)}');
    INSERT INTO admin_consultation_bookings (id, user_id, status, topic, created_at) VALUES
      (9, 4, 'requested', 'Fit review', '${at(10)}'),
      (10, 4, 'completed', 'Old', '${at(600)}');
    INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, status, owner_user_id, created_at) VALUES
      (11, 'u11', 'project', 1, 'Acme', 'open', 4, '${at(5)}'),
      (12, 'u12', 'project', 2, 'Beta', 'in_review', 4, '${at(4)}'),
      (13, 'u13', 'project', 3, 'Gamma', 'completed', 4, '${at(600)}');
  `);
}

test('every lane reads against the baseline shapes — none is unreadable', async () => {
  const d = db();
  const board = await approvalBoard({ DB: d1Over(d) } as any, 100, NOW);
  assert.deepEqual(board.unreadable, [], `a lane names a column production does not have: ${board.reason}`);
  const counts = await laneCounts({ DB: d1Over(d) } as any);
  assert.ok(counts.every((c) => c.count === 0), 'an empty database is measured empty, lane by lane');
});

test('each new lane holds only what waits on an admin', async () => {
  const d = db();
  seed(d);
  const env = { DB: d1Over(d) } as any;
  const counts = Object.fromEntries((await laneCounts(env)).map((c) => [c.key, c.count]));
  assert.deepEqual(
    { kyc: counts.kyc, partner_profiles: counts.partner_profiles, exploring: counts.exploring, jobs: counts.jobs,
      events: counts.events, best_fit: counts.best_fit, due_diligence: counts.due_diligence },
    { kyc: 1, partner_profiles: 1, exploring: 1, jobs: 1, events: 1, best_fit: 1, due_diligence: 2 },
  );

  const board = await approvalBoard(env, 100, NOW);
  const byLane = (k: string) => board.items.filter((i) => i.lane === k);
  // The board and the count read the same predicate: same rows, lane by lane.
  for (const s of APPROVAL_SOURCES) assert.equal(byLane(s.key).length, counts[s.key], s.key);

  // Oldest first across lanes: KYC (90h) before the profile (60h) before
  // Exploring, whose age is `onboarded_at` (40h), not the account's 500h.
  assert.deepEqual(board.items.slice(0, 3).map((i) => i.lane), ['kyc', 'partner_profiles', 'exploring']);
  assert.equal(byLane('exploring')[0].age_hours, 40);
  assert.equal(byLane('kyc')[0].sla, 'past');
});

test('who never renders blank, orphan rows included', async () => {
  const d = db();
  seed(d);
  const board = await approvalBoard({ DB: d1Over(d) } as any, 100, NOW);
  for (const it of board.items) assert.ok(it.who.trim(), `${it.lane}:${it.id} has no who`);
  // The profile has no user row: it falls back to its own key, the email.
  assert.equal(board.items.find((i) => i.lane === 'partner_profiles')!.who, 'orphan@x.test');
  // An empty name falls back to the email.
  assert.equal(board.items.find((i) => i.lane === 'exploring')!.who, 'exp@x.test');
});

test('the four canvas lanes with no open state are named, not laned', () => {
  const laned = new Set(APPROVAL_SOURCES.map((s) => s.label));
  assert.deepEqual(NOT_LANED.map((n) => n.label),
    ['Directory', 'Circles', 'Partner invitations', 'Advisor cohort access']);
  for (const n of NOT_LANED) {
    assert.ok(!laned.has(n.label), `${n.label} is both laned and not`);
    assert.ok(n.reason.length > 20, `${n.label} needs its reason`);
  }
  // Four from D130 plus seven from S16: eleven lanes, four stated gaps.
  assert.equal(APPROVAL_SOURCES.length, 11);
});

test('the route sends the gaps with the board', () => {
  const src = readFileSync(new URL('../src/routes/branch_approvals.ts', import.meta.url), 'utf8');
  assert.match(src, /not_laned:\s*NOT_LANED/);
});
