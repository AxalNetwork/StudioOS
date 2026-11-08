/**
 * D4657 (#4657) — Lab admission follows the recorded enrollment, and progress
 * follows the saved work. The real routers and services run over the fully
 * migrated schema (node:sqlite); every value is invented.
 *
 *   · /start: an admitted cohort member starts on the cycle's own instant; a
 *     founder never admitted, one under a moderation sanction, a graduate and
 *     one whose cohort opens later are refused; a legacy enrollment starts; a
 *     read the decision needs that fails is a retryable 503, never a start;
 *   · /milestone: no saved work, no milestone and no credit; another founder's
 *     project proves nothing; a replay pays once; a gate or evidence read that
 *     fails is 503 and records nothing;
 *   · recovery: a milestone whose credit was lost, and saved work no request
 *     recorded, are both caught up by the reconciler, once;
 *   · the cron walk is bounded and wraps;
 *   · the cycle activation writes the enrollment, and the calendar gate and the
 *     cycle's participants follow the assigned cycle, not the start instant;
 *   · the migration records today's founders as cohort or legacy;
 *   · every completion rule runs on the real schema, and the catalog and the
 *     rules name the same keys.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_admission_evidence_4657.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { proveMilestone, labProject } from './_lab_evidence.ts';
import spinoutLab from '../src/routes/spinout_lab.ts';
import { resolveLabEligibility } from '../src/services/labEnrollment.ts';
import { MILESTONE_EVIDENCE, evidenceFor } from '../src/services/labEvidence.ts';
import { reconcileLabProgress, runLabReconcileTick, recordLabMilestone } from '../src/services/labProgress.ts';
import { getCohortGate } from '../src/services/cohortTiming.ts';
import { VALID_MILESTONE_KEYS } from '../src/services/spinoutLabCatalog.ts';

afterAll(() => removeMigratedDatabases());
const MIG381 = readFileSync(new URL('../sql/migrations/381_credit_reward_rules.sql', import.meta.url), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 201, OUTSIDER = 202, SUSPENDED = 203, LATER = 204, LEGACY = 205, GRAD = 206, OTHER = 207;
const NOW = Date.parse('2026-11-10T12:00:00Z');
const NOV_START = '2026-11-01 05:00:00'; // SQLite UTC text, as the Worker stores it
const DEC_START = '2026-12-01 05:00:00';

function world(): DatabaseSync {
  const db = migratedDatabase();
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active, spinout_lab_week, is_incorporated)
                        VALUES (?, 'founder', 'Synthetic', ?, 1, ?, ?, 1, ?)`);
  for (const [id, active, inc] of [[MEMBER, 0, 0], [OUTSIDER, 0, 0], [SUSPENDED, 0, 0], [LATER, 0, 0], [LEGACY, 1, 0], [GRAD, 0, 1], [OTHER, 1, 0]]) {
    u.run(id, `u${id}@example.test`, id, active, inc);
  }
  db.prepare(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status, app_status) VALUES (11, 2026, 11, ?, '2026-11-29 05:00:00', 'active', 'active')`).run(NOV_START);
  db.prepare(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status, app_status) VALUES (12, 2026, 12, ?, '2026-12-29 05:00:00', 'scheduled', 'reviewing')`).run(DEC_START);
  const e = db.prepare(`INSERT INTO spinout_lab_enrollments (user_id, kind, cohort_cycle_id, cycle_source, started_at) VALUES (?, ?, ?, ?, ?)`);
  e.run(MEMBER, 'cohort', 11, 'assigned', NOV_START);
  e.run(SUSPENDED, 'cohort', 11, 'assigned', NOV_START);
  e.run(LATER, 'cohort', 12, 'assigned', DEC_START);
  e.run(LEGACY, 'legacy', null, null, null);
  e.run(OTHER, 'legacy', null, null, null);
  e.run(GRAD, 'legacy', null, null, null);
  db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, 'November 2026 Cohort')`).run(MEMBER);
  db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, 'Earlier')`).run(LEGACY);
  db.prepare(`INSERT INTO spinout_moderation_cases (user_id, status, reason_code, severity, opened_by) VALUES (?, 'suspended', 'spam', 'medium', 1)`).run(SUSPENDED);
  // The migrated template carries schema, not seed rows: the shipped credit rules (migration 381).
  for (const st of MIG381.split(/;\s*\n/).filter((x) => /INSERT/i.test(x))) db.exec(st);
  return db;
}

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

async function call(db: DatabaseSync, method: string, path: string, who: number, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await spinoutLab.request(path, init, envOf(db));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.info = i; }
};
const milestones = (db: DatabaseSync, who: number) =>
  (db.prepare('SELECT milestone_key, evidence_kind, evidence_ref, evidence_project_id, recorded_by FROM spinout_lab_milestones WHERE user_id = ? ORDER BY id').all(who) as any[]).map((r) => ({ ...r }));
const grants = (db: DatabaseSync, who: number) =>
  (db.prepare(`SELECT source_ref FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' ORDER BY id`).all(who) as any[]).map((r) => r.source_ref);
const activate = (db: DatabaseSync, who: number) =>
  db.prepare(`UPDATE users SET spinout_lab_active = 1, spinout_lab_started_at = COALESCE(spinout_lab_started_at, ?) WHERE id = ?`).run(NOV_START, who);

test('#4657 /start: an admitted cohort member starts on their cycle\'s own instant', async () => {
  const db = world();
  try {
    const r = await quiet(() => call(db, 'POST', '/start', MEMBER));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const u = db.prepare('SELECT spinout_lab_active AS a, spinout_lab_started_at AS s FROM users WHERE id = ?').get(MEMBER) as any;
    assert.deepEqual([u.a, u.s], [1, NOV_START], 'the start is the assigned cycle\'s, not the click\'s');
  } finally { db.close(); }
});

test('#4657 /start: never admitted, sanctioned, graduated, or a cohort that opens later — refused, nothing switched on', async () => {
  const db = world();
  try {
    // Mutation checked: /start back on startLab alone → the outsider gets 200 and an active Lab.
    const cases: Array<[number, number, string]> = [
      [OUTSIDER, 403, 'lab_not_admitted'], [SUSPENDED, 403, 'lab_restricted'], [GRAD, 409, 'lab_graduated'],
    ];
    for (const [who, status, code] of cases) {
      const r = await quiet(() => call(db, 'POST', '/start', who));
      assert.deepEqual([r.status, r.body?.code], [status, code], `user ${who}`);
      const a = (db.prepare('SELECT spinout_lab_active AS a FROM users WHERE id = ?').get(who) as any).a;
      assert.notEqual(a, 1, `user ${who} stays off`);
    }
    // LATER's December cycle has not started at the real clock's "now" only if it is before Dec 1; decide with a fixed clock.
    const e = await resolveLabEligibility(envOf(db), LATER, NOW);
    assert.equal(e.status, 'not_started');
    assert.equal((e as any).opens_at, '2026-12-01T05:00:00.000Z');
  } finally { db.close(); }
});

test('#4657 a legacy enrollment is explicit and permitted; a read that fails is retryable and never permission', async () => {
  const db = world();
  try {
    assert.equal((await resolveLabEligibility(envOf(db), LEGACY, NOW)).status, 'legacy');
    // Mutation checked: the moderation catch returning "eligible" → the sanctioned founder starts.
    db.exec('ALTER TABLE spinout_moderation_cases RENAME TO spinout_moderation_cases_gone');
    const e = await quiet(() => resolveLabEligibility(envOf(db), MEMBER, NOW));
    assert.deepEqual(e, { status: 'unavailable', part: 'moderation' });
    const r = await quiet(() => call(db, 'POST', '/start', MEMBER));
    assert.deepEqual([r.status, r.body?.code, r.body?.retryable], [503, 'lab_eligibility_unavailable', true]);
    assert.equal((db.prepare('SELECT spinout_lab_active AS a FROM users WHERE id = ?').get(MEMBER) as any).a, 0);
    db.exec('ALTER TABLE spinout_moderation_cases_gone RENAME TO spinout_moderation_cases');
    db.exec('ALTER TABLE spinout_lab_enrollments RENAME TO spinout_lab_enrollments_gone');
    assert.deepEqual(await quiet(() => resolveLabEligibility(envOf(db), MEMBER, NOW)), { status: 'unavailable', part: 'enrollment' });
  } finally { db.close(); }
});

test('#4657 an activated applicant whose enrollment row is missing is healed from the applicant, not refused', async () => {
  const db = world();
  try {
    db.prepare(`INSERT INTO spinout_applications (id, user_id, company_name, idea) VALUES (900, ?, 'Synthetic', 'Synthetic')`).run(OUTSIDER);
    db.prepare(`INSERT INTO cohort_applicants (id, application_id, user_id, cohort_cycle_id, status) VALUES (900, 900, ?, 11, 'activated')`).run(OUTSIDER);
    const e = await resolveLabEligibility(envOf(db), OUTSIDER, NOW);
    assert.equal(e.status, 'eligible');
    const row = db.prepare('SELECT kind, cohort_cycle_id, cohort_applicant_id FROM spinout_lab_enrollments WHERE user_id = ?').get(OUTSIDER) as any;
    assert.deepEqual({ ...row }, { kind: 'cohort', cohort_cycle_id: 11, cohort_applicant_id: 900 });
  } finally { db.close(); }
});

test('#4657 /milestone: no saved work, no milestone and no credit; the saved work records it once, with its evidence', async () => {
  const db = world();
  try {
    activate(db, LEGACY);
    // Mutation checked: the evidence check skipped → the first call records okrs_created and pays 50.
    const before = await quiet(() => call(db, 'POST', '/milestone', LEGACY, { milestone_key: 'okrs_created' }));
    assert.deepEqual([before.status, before.body?.code], [409, 'milestone_evidence_missing']);
    assert.deepEqual(milestones(db, LEGACY), []);
    assert.deepEqual(grants(db, LEGACY), []);
    proveMilestone(db, LEGACY, 'okrs_created');
    const project = labProject(db, LEGACY);
    const r = await quiet(() => call(db, 'POST', '/milestone', LEGACY, { milestone_key: 'okrs_created' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(milestones(db, LEGACY), [{
      milestone_key: 'okrs_created', evidence_kind: 'saved_work', evidence_ref: `roadmap_okrs:project:${project}:n=3`,
      evidence_project_id: project, recorded_by: 'member',
    }]);
    assert.deepEqual(grants(db, LEGACY), [`lab:${LEGACY}:okrs_created`]);
    // Replay: the same request again records nothing and pays nothing.
    const again = await quiet(() => call(db, 'POST', '/milestone', LEGACY, { milestone_key: 'okrs_created' }));
    assert.equal(again.status, 200);
    assert.equal(milestones(db, LEGACY).length, 1);
    assert.deepEqual(grants(db, LEGACY), [`lab:${LEGACY}:okrs_created`]);
  } finally { db.close(); }
});

test('#4657 another founder\'s project proves nothing; a person-level step is the user\'s own', async () => {
  const db = world();
  try {
    activate(db, LEGACY);
    proveMilestone(db, OTHER, 'customer_interview_logged_3');
    proveMilestone(db, OTHER, 'advisor_meeting_booked');
    // Mutation checked: OWNED without the founder join → OTHER's interviews count for LEGACY.
    for (const key of ['customer_interview_logged_1', 'advisor_meeting_booked']) {
      const r = await quiet(() => call(db, 'POST', '/milestone', LEGACY, { milestone_key: key }));
      assert.deepEqual([r.status, r.body?.code], [409, 'milestone_evidence_missing'], key);
    }
    assert.deepEqual(milestones(db, LEGACY), []);
  } finally { db.close(); }
});

test('#4657 a gate or an evidence read that fails is 503 and records nothing', async () => {
  const db = world();
  try {
    activate(db, MEMBER);
    proveMilestone(db, MEMBER, 'customer_interview_logged_1');
    // The calendar's own bootstrap recreates a missing table, so fail the read itself.
    const env = envOf(db);
    const real = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => {
      if (/FROM week_windows WHERE cohort_cycle_id/.test(sql)) throw new Error('D1_ERROR: synthetic outage');
      return real(sql);
    };
    // Mutation checked: the gate catch restored to "legacy behaviour" → 200 and a recorded milestone.
    const g = await quiet(() => recordLabMilestone(env, MEMBER, 'customer_interview_logged_1', 'member', NOW));
    assert.deepEqual([g.ok, (g as any).status, (g as any).code], [false, 503, 'lab_gate_unavailable']);
    db.exec('ALTER TABLE discovery_interviews RENAME TO discovery_interviews_gone');
    const ev = await quiet(() => recordLabMilestone(envOf(db), MEMBER, 'customer_interview_logged_1', 'member', NOW));
    assert.deepEqual([ev.ok, (ev as any).status, (ev as any).code], [false, 503, 'lab_evidence_unavailable']);
    assert.deepEqual(milestones(db, MEMBER), []);
  } finally { db.close(); }
});

test('#4657 recovery: a lost credit and unrecorded saved work are caught up once by the reconciler', async () => {
  const db = world();
  try {
    activate(db, LEGACY);
    proveMilestone(db, LEGACY, 'pitch_deck_drafted');
    const r = await quiet(() => recordLabMilestone(envOf(db), LEGACY, 'pitch_deck_drafted', 'member', NOW));
    assert.ok(r.ok);
    // The isolate died after the insert: the grant never landed.
    db.prepare('DELETE FROM perk_credit_ledger WHERE user_id = ?').run(LEGACY);
    // And interviews were saved while no Lab page was open.
    proveMilestone(db, LEGACY, 'customer_interview_logged_2');
    // Mutation checked: the unpaid sweep removed → the pitch deck grant is never restored.
    const pass = await quiet(() => reconcileLabProgress(envOf(db), LEGACY, NOW));
    assert.equal(pass.status, 'done');
    assert.deepEqual(pass.recorded.sort(), ['customer_interview_logged_1', 'customer_interview_logged_2', 'project_created']);
    assert.deepEqual(new Set(grants(db, LEGACY)), new Set([`lab:${LEGACY}:pitch_deck_drafted`]),
      'the lost grant is paid; interviews 1-2 have no rule');
    assert.equal(milestones(db, LEGACY).filter((m) => m.recorded_by === 'reconcile').length, 3);
    // A second pass changes nothing.
    const again = await quiet(() => reconcileLabProgress(envOf(db), LEGACY, NOW));
    assert.deepEqual([again.recorded, again.credited], [[], 0]);
    assert.equal(grants(db, LEGACY).length, 1);
  } finally { db.close(); }
});

test('#4657 the reconciler never touches a founder outside the Lab, or rows from before the migration', async () => {
  const db = world();
  try {
    proveMilestone(db, OUTSIDER, 'pitch_deck_drafted');
    assert.equal((await quiet(() => reconcileLabProgress(envOf(db), OUTSIDER, NOW))).status, 'skipped');
    activate(db, LEGACY);
    db.prepare(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, evidence_kind) VALUES (?, 2, 'brand_basics_filled', 'legacy')`).run(LEGACY);
    await quiet(() => reconcileLabProgress(envOf(db), LEGACY, NOW));
    assert.deepEqual(grants(db, LEGACY), [], 'a legacy row is the D541 backfill\'s, not the reconciler\'s');
    assert.deepEqual(milestones(db, OUTSIDER), []);
  } finally { db.close(); }
});

test('#4657 the cron walk is bounded and wraps', async () => {
  const db = world();
  try {
    activate(db, LEGACY); activate(db, OTHER); activate(db, MEMBER);
    const a = await quiet(() => runLabReconcileTick(envOf(db), { limit: 2, nowMs: NOW }));
    assert.equal(a.walked, 2);
    const cur1 = (db.prepare('SELECT after_user_id AS a FROM spinout_lab_reconcile_cursor').get() as any).a;
    const b = await quiet(() => runLabReconcileTick(envOf(db), { limit: 2, nowMs: NOW }));
    assert.equal(b.walked, 1, 'the rest of the list');
    const c = await quiet(() => runLabReconcileTick(envOf(db), { limit: 2, nowMs: NOW }));
    assert.equal(c.walked, 2, 'wrapped to the start');
    assert.ok(cur1 > 0);
  } finally { db.close(); }
});

test('#4657 the activation writes the enrollment; the gate and the participants follow the assigned cycle', async () => {
  const db = world();
  try {
    // A founder whose start instant falls in November but who is enrolled in December.
    db.prepare(`UPDATE users SET spinout_lab_active = 1, spinout_lab_started_at = '2026-11-03 00:00:00' WHERE id = ?`).run(LATER);
    for (const [cyc, y, m] of [[11, 2026, 11], [12, 2026, 12]] as const) {
      for (let w = 1; w <= 4; w++) {
        db.prepare('INSERT OR IGNORE INTO week_windows (cohort_cycle_id, week_number, unlock_at, deadline_at) VALUES (?, ?, ?, ?)')
          .run(cyc, w, `${y}-${String(m).padStart(2, '0')}-0${w} 05:00:00`, `${y}-${String(m).padStart(2, '0')}-1${w} 05:00:00`);
      }
    }
    // Mutation checked: getCohortGate back on the start-instant range → cycle 11.
    const gate = await getCohortGate(envOf(db), LATER, NOW);
    assert.equal(gate?.cycle_id, 12);
    // The activation, through the real cron tick.
    db.prepare(`INSERT INTO spinout_applications (id, user_id, company_name, idea) VALUES (901, ?, 'Synthetic', 'Synthetic')`).run(OUTSIDER);
    db.prepare(`INSERT INTO cohort_applicants (id, application_id, user_id, cohort_cycle_id, status) VALUES (901, 901, ?, 12, 'approved')`).run(OUTSIDER);
    db.exec('UPDATE cohort_cycles SET force_proceed = 1 WHERE id = 12'); // a one-founder cohort runs
    const { runCohortApplicationsTick } = await import('../src/services/cohortApplications.ts');
    await quiet(() => runCohortApplicationsTick(envOf(db), new Date('2026-12-01T05:01:00Z')));
    const row = db.prepare('SELECT kind, cohort_cycle_id, cohort_applicant_id, started_at FROM spinout_lab_enrollments WHERE user_id = ?').get(OUTSIDER) as any;
    assert.deepEqual({ ...row }, { kind: 'cohort', cohort_cycle_id: 12, cohort_applicant_id: 901, started_at: DEC_START });
  } finally { db.close(); }
});

test('#4657 the migration records today\'s founders as cohort or legacy, once', () => {
  const db = migratedDatabase();
  try {
    // The template already ran the migration; re-run its backfill over fresh rows the way production's would.
    db.exec('DELETE FROM spinout_lab_enrollments');
    db.prepare(`INSERT INTO users (id, role, name, email, is_active, spinout_lab_active, spinout_lab_started_at) VALUES (301, 'founder', 'S', 's301@example.test', 1, 1, '2026-11-02 00:00:00')`).run();
    db.prepare(`INSERT INTO users (id, role, name, email, is_active, spinout_lab_active) VALUES (302, 'founder', 'S', 's302@example.test', 1, 0)`).run();
    db.prepare(`INSERT INTO users (id, role, name, email, is_active, spinout_lab_active) VALUES (303, 'founder', 'S', 's303@example.test', 1, 0)`).run();
    db.prepare(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at) VALUES (11, 2026, 11, ?, '2026-11-29 05:00:00')`).run(NOV_START);
    db.prepare(`INSERT INTO cohort_applicants (id, application_id, user_id, cohort_cycle_id, status) VALUES (1, 1, 302, 11, 'activated')`).run();
    const sql = readFileSync(new URL('../sql/migrations/202611071700_spinout_lab_enrollments.sql', import.meta.url), 'utf8');
    const backfill = sql.split(/;\s*\n/).filter((s) => /INSERT OR IGNORE INTO spinout_lab_enrollments/.test(s));
    for (const s of [...backfill, ...backfill]) db.exec(s); // twice: idempotent
    const rows = (db.prepare('SELECT user_id, kind, cohort_cycle_id, cycle_source FROM spinout_lab_enrollments ORDER BY user_id').all() as any[]).map((r) => ({ ...r }));
    assert.deepEqual(rows, [
      { user_id: 301, kind: 'legacy', cohort_cycle_id: 11, cycle_source: 'inferred_start' },
      { user_id: 302, kind: 'cohort', cohort_cycle_id: 11, cycle_source: 'assigned' },
    ], 'never-enrolled 303 gets nothing');
  } finally { db.close(); }
});

test('#4657 every catalog key has a completion rule, and every rule runs on the real schema', async () => {
  assert.deepEqual([...VALID_MILESTONE_KEYS].sort(), Object.keys(MILESTONE_EVIDENCE).sort());
  const db = world();
  try {
    const ctx = { env: envOf(db), userId: LEGACY, enrollmentProjectId: null };
    for (const key of Object.keys(MILESTONE_EVIDENCE)) {
      assert.equal(await evidenceFor(ctx, key), null, `${key}: nothing saved, nothing proved`);
    }
    for (const key of Object.keys(MILESTONE_EVIDENCE)) {
      proveMilestone(db, LEGACY, key);
      const e = await evidenceFor(ctx, key);
      assert.ok(e, `${key}: the saved work proves it`);
    }
  } finally { db.close(); }
});

test('#4657 the two steps that save nothing need the work they summarise', async () => {
  const db = world();
  try {
    const ctx = { env: envOf(db), userId: LEGACY, enrollmentProjectId: null };
    assert.equal(await evidenceFor(ctx, 'market_research_shared'), null);
    proveMilestone(db, LEGACY, 'market_sizing_completed');
    const e = await evidenceFor(ctx, 'market_research_shared');
    assert.equal(e?.kind, 'attested');
    assert.match(String(e?.ref), /^attested_over:projects:\d+:market_sizing$/);
  } finally { db.close(); }
});
