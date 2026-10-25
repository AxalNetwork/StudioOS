/**
 * D954 (#2787) — Programs part 1: migration 560, the registry and the
 * playbook store, the catalogue read with its per-studio form, Learning's
 * enrolment events, dates and assigned-admin count, sessions booked with a
 * mentor, and each program's activity.
 *
 * Run on a database built from the baseline and every migration through 560,
 * as production builds it; 560 is applied whole and must apply cleanly. The
 * catalogue's figures run on a fixed clock (a Wednesday) so each is worked out
 * by hand from the fixture; the routes run on the real clock for the gates.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_programs_d954.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import adminPrograms from '../src/routes/admin_programs.ts';
import learningPrograms from '../src/routes/learning_programs.ts';
import adminLearningPrograms from '../src/routes/admin_learning_programs.ts';
import { branchPrograms } from '../src/rpc/branchOps.ts';
import {
  HQ_READS_REASON, PART4_CLAIMS_REASON, PART4_STRATEGIC_REASON, REFERRAL_REWARDS_REASON,
  loadProgramsForBranch, programCatalogue,
} from '../src/services/programCatalogue.ts';
import { PROGRAM_KEYS, PAUSE_NOT_DECIDED } from '../src/services/programRegistry.ts';
import { MENTOR_ACCESS_ACTIONS, NOT_AUDITED_YET } from '../src/services/programActivity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const M560 = readFileSync(resolve(MIGRATIONS, '560_program_registry.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const NOW = Date.parse('2026-10-21T12:00:00Z'); // a Wednesday; 4 weeks is 2026-09-28 to 2026-10-26
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const SUPER = 1, ADMIN = 2, ADV1 = 3, FORMER = 4, FOUNDER = 5, LEARNER = 6, LEARNER2 = 7;
const ROLE: Record<number, string> = {
  [SUPER]: 'admin', [ADMIN]: 'admin', [ADV1]: 'advisor', [FORMER]: 'investor', [FOUNDER]: 'founder', [LEARNER]: 'founder', [LEARNER2]: 'investor',
};

/** The baseline and every migration before 560, statement by statement, as the other suites build it. */
function beforeM560(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 560)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}

const BUILT = beforeM560();
BUILT.exec(M560); // whole, as the deploy applies it: a failure here fails the file
// D955 (#2788): 561 adds programs.licence_uid, which every registry read now selects; the deploy applies it after 560.
BUILT.exec(readFileSync(resolve(MIGRATIONS, '561_program_proposals.sql'), 'utf8'));

/** A copy of BUILT, its schema and every row it holds (560's seed and 381's rules included). */
function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const o of objs.filter((x) => x.type === 'table')) {
    const rows = BUILT.prepare(`SELECT * FROM "${o.name}"`).all() as any[];
    for (const r of rows) {
      const cols = Object.keys(r);
      db.prepare(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => r[c]));
    }
  }
  const users = [[SUPER, 'Sam Super'], [ADMIN, 'Ada Admin'], [ADV1, 'Ava Advisor'], [FORMER, 'Finn Former'],
    [FOUNDER, 'Fay Founder'], [LEARNER, 'Lia Learner'], [LEARNER2, 'Leo Learner']] as const;
  for (const [id, name] of users) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(id, `u-${id}`, `person${id}@example.test`, name, ROLE[id]);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  return db;
}

/** Every Programs response this file reads, so the last test covers them all. */
const SEEN: string[] = [];

async function call(app: any, db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown; env?: Record<string, unknown> } = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(init.env || {}) } as any).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  const text = await res.text();
  if (app === adminPrograms) SEEN.push(text);
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body };
}
const progs = (db: DatabaseSync, who: number, path: string, init?: Parameters<typeof call>[4]) => call(adminPrograms, db, who, path, init);

const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', ...extra }) as any;

/** The catalogue's fixture: every figure below is worked out by hand from it. */
function catalogueFixture(db: DatabaseSync) {
  const h = (n: number) => at(NOW - n * HOUR);
  db.exec('DELETE FROM perks;'); // migration 366's seeded listings
  // Cycles: A scheduled, B running, C postponed, D completed.
  db.exec(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status, app_status) VALUES
    (1, 2026, 11, '2026-11-01 04:00:00', '2026-11-29 05:00:00', 'scheduled', 'open'),
    (2, 2026, 10, '2026-10-01 04:00:00', '2026-10-29 04:00:00', 'active', 'closed'),
    (3, 2026, 12, '2026-12-01 05:00:00', '2026-12-29 05:00:00', 'scheduled', 'postponed'),
    (4, 2026, 9, '2026-09-01 04:00:00', '2026-09-29 04:00:00', 'completed', 'closed');`);
  // ADV1 covers A; FORMER (no longer an Advisor) holds B; ADV1's ended row on D.
  db.exec(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, unassigned_at, is_active) VALUES
    ('as-1', ${ADV1}, 1, '2026-10-05 10:00:00', NULL, 1),
    ('as-2', ${FORMER}, 2, '2026-09-20 10:00:00', NULL, 1),
    ('as-3', ${ADV1}, 4, '2026-08-20 10:00:00', '2026-09-30 10:00:00', 0);`);
  // Queues: two cohort applications (2 h and 80 h), two open referrals (30 h, 1 h waiting on the member),
  // one closed referral, one perk in review (edited 50 h ago), one pending host (10 h).
  db.prepare(`INSERT INTO cohort_applicants (application_id, user_id, cohort_cycle_id, status, created_at) VALUES (1, ?, 1, 'pending', ?), (2, ?, 1, 'pending', ?), (3, ?, 1, 'accepted', ?)`)
    .run(FOUNDER, h(2), LEARNER, h(80), LEARNER2, h(5));
  db.prepare(`INSERT INTO referral_submissions (uid, referrer_user_id, category, referred_name, status, created_at) VALUES
    ('rs-1', ?, 'startup', 'Rita Referred', 'submitted', ?), ('rs-2', ?, 'customer', 'Cory Customer', 'more_info_needed', ?),
    ('rs-3', ?, 'startup', 'Old One', 'closed', ?)`).run(FOUNDER, h(30), FOUNDER, h(1), FOUNDER, '2026-06-01 10:00:00');
  db.prepare(`INSERT INTO perks (id, uid, partner_name, category, offer, kind, status, created_at, updated_at) VALUES
    (1, 'pk-1', 'Acme', 'software', 'Ten seats', 'credits', 'in_review', ?, ?),
    (2, 'pk-2', 'Beta', 'software', 'A month free', 'credits', 'live', ?, ?),
    (3, 'pk-3', 'Gone', 'software', 'Expired', 'credits', 'live', ?, ?)`)
    .run(h(400), h(50), h(400), h(400), h(400), h(400));
  db.exec(`UPDATE perks SET ends_at = '2026-01-01' WHERE id = 3;`);
  db.prepare(`INSERT INTO lab_host_applications (uid, user_id, host_kind, host_id, capacity, status, created_at) VALUES ('lh-1', ?, 'advisor', 1, 'advisor', 'pending', ?)`)
    .run(ADV1, h(10));
  // One perk claim this period by FOUNDER (also a referrer: one person).
  db.prepare(`INSERT INTO perk_claims (uid, perk_id, user_id, created_at) VALUES ('pc-1', 2, ?, ?)`).run(FOUNDER, h(24));
  // Learning: P1 published (ADMIN assigned, two active), P2 published (one active), P3 a draft (one active).
  db.exec(`INSERT INTO learning_programs (id, uid, name, enrolment, status, created_by) VALUES
    (1, 'lp-1', 'Nordics', 'open', 'published', ${SUPER}), (2, 'lp-2', 'Iberia', 'invite', 'published', ${SUPER}),
    (3, 'lp-3', 'Draft', 'invite', 'draft', ${SUPER});
    INSERT INTO learning_program_admins (program_id, user_id, assigned_by) VALUES (1, ${ADMIN}, ${SUPER});`);
  db.prepare(`INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES
    (1, ?, ?, ?, 'active', ?), (1, ?, ?, ?, 'active', ?), (2, ?, ?, ?, 'active', ?), (3, ?, ?, ?, 'active', ?)`)
    .run(LEARNER, LEARNER, h(100), h(100), LEARNER2, SUPER, h(48), h(48), LEARNER, SUPER, h(3), h(3), FOUNDER, SUPER, h(3), h(3));
  db.prepare(`INSERT INTO learning_enrolment_events (program_id, user_id, kind, by_user_id, at) VALUES
    (1, ?, 'enrolled', ?, ?), (1, ?, 'enrolled', ?, ?), (2, ?, 'enrolled', ?, ?)`)
    .run(LEARNER, LEARNER, h(100), LEARNER2, SUPER, h(48), LEARNER, SUPER, h(3));
  // Lab applications: two this period, one the period before.
  db.prepare(`INSERT INTO spinout_applications (user_id, company_name, idea, created_at) VALUES (?, 'A', 'x', ?), (?, 'B', 'y', ?), (?, 'C', 'z', ?)`)
    .run(FOUNDER, h(5), LEARNER, h(200), LEARNER2, '2026-09-10 10:00:00');
  // Product testing: one open program with two applications, one withdrawn; one closed program.
  db.exec(`INSERT INTO testing_programmes (id, uid, owner_kind, created_by, product_name, places, status) VALUES
    (1, 'tp-1', 'hq', ${SUPER}, 'App', 5, 'open'), (2, 'tp-2', 'hq', ${SUPER}, 'Old', 5, 'closed');
    INSERT INTO testing_applications (uid, programme_id, user_id, status) VALUES ('ta-1', 1, ${FOUNDER}, 'applied'), ('ta-2', 1, ${LEARNER}, 'withdrawn'), ('ta-3', 2, ${LEARNER2}, 'applied');`);
  // The credit ledger, this month: a Lab grant 50, a bounty 20, a manual grant 10, a pre-381 grant 5,
  // a spend of 30, a deduction of 10 and a refund of 5.
  const t = h(48);
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, created_at, rule_key) VALUES
    (?, 50, 'grant', 'g1', ?, 'lab:okrs_created'), (?, 20, 'grant', 'g2', ?, 'bug_low'), (?, 10, 'grant', 'g3', ?, 'manual'),
    (?, 5, 'grant', 'g4', ?, NULL), (?, -30, 'spend', 'perk:x', ?, NULL), (?, -10, 'admin_adjust', 'revoke:1', ?, 'lab:okrs_created'),
    (?, 5, 'refund', 'perk:y', ?, NULL)`)
    .run(FOUNDER, t, FOUNDER, t, FOUNDER, t, FOUNDER, t, FOUNDER, t, FOUNDER, t, FOUNDER, t);
}

const rowOf = (cat: any, key: string) => cat.programs.rows.find((r: any) => r.key === key);

// ---------------------------------------------------------------------------
// 1. Migration 560
// ---------------------------------------------------------------------------

test('560 seeds the nine programs in order, with no bracketed sample and AI-native Venture unrecorded', () => {
  const rows = BUILT.prepare('SELECT key, grp, name, purpose, who, join_method, status, position FROM programs ORDER BY position').all() as any[];
  assert.deepEqual(rows.map((r) => r.key), [...PROGRAM_KEYS]);
  assert.deepEqual(rows.map((r) => r.status), ['live', 'proposed', 'live', 'not_built', 'partly_built', 'live', 'live', 'live', 'live']);
  const ain = rows.find((r) => r.key === 'ai-native-venture');
  assert.equal(ain.purpose, null);
  assert.equal(ain.who, null);
  assert.equal(ain.join_method, null);
  // D953 §3's corrected purposes, not the canvas's.
  assert.match(rows.find((r) => r.key === 'refer-and-earn').purpose, /introduction credit/);
  assert.equal(rows.find((r) => r.key === 'perks').purpose, 'Partners list perks; founders claim them with credits, a plan or payment.');
  const texts = (BUILT.prepare('SELECT purpose AS t FROM programs UNION ALL SELECT who FROM programs UNION ALL SELECT title FROM program_playbook_sections UNION ALL SELECT body FROM program_playbook_sections').all() as any[])
    .map((r) => String(r.t ?? ''));
  assert.ok(!texts.some((t) => t.includes('[')), 'no bracketed canvas sample is stored');
});

test('560 publishes version 1 where D953 writes How it runs, copies it to the draft, and drafts AI-native Venture unset', () => {
  const versions = BUILT.prepare('SELECT program_key, version FROM program_playbook_versions ORDER BY program_key').all() as any[];
  assert.deepEqual(versions.map((v) => v.program_key).sort(),
    ['investor-cohorts', 'learning', 'mentor-cohorts', 'perks', 'refer-and-earn', 'referral-partners']);
  assert.ok(versions.every((v) => v.version === 1));
  const v1 = BUILT.prepare('SELECT COUNT(*) AS n FROM program_playbook_sections WHERE version = 1').get() as any;
  const v0 = BUILT.prepare("SELECT COUNT(*) AS n FROM program_playbook_sections WHERE version = 0 AND program_key <> 'ai-native-venture'").get() as any;
  assert.equal(v0.n, v1.n);
  const cycle = BUILT.prepare("SELECT body, computed FROM program_playbook_sections WHERE program_key = 'mentor-cohorts' AND version = 1 AND section_key = 'cycle'").get() as any;
  assert.deepEqual({ ...cycle }, { body: null, computed: 1 });
  const ain = BUILT.prepare("SELECT version, title, body FROM program_playbook_sections WHERE program_key = 'ai-native-venture' ORDER BY position").all() as any[];
  assert.equal(ain.length, 7);
  assert.ok(ain.every((s) => s.version === 0 && s.body === null));
  assert.deepEqual(ain.map((s) => s.title), ['Thesis', 'Who it is for', 'Length', 'Seats per cohort', 'Tools included', 'Capital terms', 'Contracts']);
});

test('560 backfills one enrolled event per enrolment and one removed event per removed row', () => {
  const db = beforeM560();
  db.exec(`INSERT INTO learning_programs (id, uid, name, created_by) VALUES (1, 'lp-1', 'P', 1);
    INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES
      (1, 10, 10, '2026-09-01T10:00:00.000Z', 'active', '2026-09-01T10:00:00.000Z'),
      (1, 11, 1, '2026-09-02T10:00:00.000Z', 'removed', '2026-09-20T10:00:00.000Z');`);
  db.exec(M560);
  const ev = db.prepare('SELECT user_id, kind, by_user_id, at FROM learning_enrolment_events ORDER BY user_id, kind').all() as any[];
  assert.deepEqual(ev.map((e) => ({ ...e })), [
    { user_id: 10, kind: 'enrolled', by_user_id: 10, at: '2026-09-01T10:00:00.000Z' },
    { user_id: 11, kind: 'enrolled', by_user_id: 1, at: '2026-09-02T10:00:00.000Z' },
    { user_id: 11, kind: 'removed', by_user_id: null, at: '2026-09-20T10:00:00.000Z' },
  ]);
});

// ---------------------------------------------------------------------------
// 2. The registry
// ---------------------------------------------------------------------------

test('a Super Admin edits purpose, who, join and status, audited; paused is refused; an Admin cannot write', async () => {
  const db = fresh();
  const ok = await progs(db, SUPER, '/learning', { method: 'PATCH', body: { purpose: '  New words.  ', join_method: null } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.program.purpose, 'New words.');
  assert.equal(ok.body.program.join_method, null);
  assert.equal(ok.body.program.who, 'Not open to members yet', 'a field not sent is left alone');
  const audit = db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action = 'program.registry.update'").all() as any[];
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0].filters_json), { program_key: 'learning', fields: ['purpose', 'join_method'] });

  const statusOnly = await progs(db, SUPER, '/learning', { method: 'PATCH', body: { status: 'partly_built' } });
  assert.equal(statusOnly.body.program.status, 'partly_built');
  assert.equal(statusOnly.body.program.purpose, 'New words.', 'a purpose not sent is left alone');

  const paused = await progs(db, SUPER, '/perks', { method: 'PATCH', body: { status: 'paused' } });
  assert.equal(paused.status, 400);
  assert.equal(paused.body.code, 'pause_not_decided');
  assert.equal(paused.body.message, PAUSE_NOT_DECIDED);
  assert.equal((db.prepare("SELECT status FROM programs WHERE key = 'perks'").get() as any).status, 'live');

  const bad = await progs(db, SUPER, '/perks', { method: 'PATCH', body: { status: 'gone' } });
  assert.equal(bad.body.code, 'bad_status');
  const none = await progs(db, SUPER, '/perks', { method: 'PATCH', body: {} });
  assert.equal(none.body.code, 'nothing_to_change');

  const admin = await progs(db, ADMIN, '/perks', { method: 'PATCH', body: { purpose: 'x' } });
  assert.equal(admin.status, 403);
});

test('an unknown key is 404 unknown_program on every /:key route', async () => {
  const db = fresh();
  for (const [who, path, method, body] of [
    [ADMIN, '/nope', 'GET', undefined], [SUPER, '/nope', 'PATCH', { purpose: 'x' }],
    [SUPER, '/nope/playbook/sections/purpose', 'PUT', { body: 'x' }], [SUPER, '/nope/playbook/publish', 'POST', undefined],
    [ADMIN, '/nope/activity', 'GET', undefined],
  ] as const) {
    const r = await progs(db, who, path, { method, body });
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.body.code, 'unknown_program', `${method} ${path}`);
  }
});

// ---------------------------------------------------------------------------
// 3. The playbook
// ---------------------------------------------------------------------------

test('the playbook: an Admin reads what is published; a Super Admin edits the draft and publishes it as the next version', async () => {
  const db = fresh();
  db.exec(`INSERT INTO legal_templates (slug, title, is_active) VALUES ('advisor-agreement', 'Advisor agreement', 1), ('old-one', 'Withdrawn', 0);`);

  const a = await progs(db, ADMIN, '/mentor-cohorts');
  assert.equal(a.status, 200);
  assert.equal(a.body.playbook.version, 1);
  assert.equal(a.body.playbook.sections.length, 11);
  assert.equal(a.body.draft, undefined, 'an Admin never reads the draft');

  const s0 = await progs(db, SUPER, '/mentor-cohorts');
  assert.equal(s0.body.draft.differs, false);
  assert.equal(s0.body.draft.edited_at, null);

  const unknown = await progs(db, SUPER, '/mentor-cohorts/playbook/sections/terms', { method: 'PUT', body: { template_keys: ['advisor-agreement', 'old-one'] } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 'unknown_template');
  assert.match(unknown.body.message, /old-one/);
  const computed = await progs(db, SUPER, '/mentor-cohorts/playbook/sections/cycle', { method: 'PUT', body: { body: 'Four weeks.' } });
  assert.equal(computed.body.code, 'computed_section');
  const missing = await progs(db, SUPER, '/mentor-cohorts/playbook/sections/nope', { method: 'PUT', body: { body: 'x' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'unknown_section');

  const edit = await progs(db, SUPER, '/mentor-cohorts/playbook/sections/terms', {
    method: 'PUT', body: { body: 'The advisor agreement applies.', template_keys: ['advisor-agreement'] },
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.draft.differs, true);
  assert.ok(edit.body.draft.edited_at);
  const terms = edit.body.draft.sections.find((s: any) => s.key === 'terms');
  assert.deepEqual(terms.template_keys, ['advisor-agreement']);
  assert.equal(edit.body.playbook.sections.find((s: any) => s.key === 'terms').body, 'No contract template is linked to this program yet.',
    'an edit never reaches the published playbook');

  const pub = await progs(db, SUPER, '/mentor-cohorts/playbook/publish', { method: 'POST' });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.playbook.version, 2);
  assert.equal(pub.body.draft.differs, false);
  const again = await progs(db, SUPER, '/mentor-cohorts/playbook/publish', { method: 'POST' });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'nothing_to_publish');

  const reread = await progs(db, ADMIN, '/mentor-cohorts');
  assert.equal(reread.body.playbook.version, 2);
  assert.equal(reread.body.playbook.sections.find((s: any) => s.key === 'terms').body, 'The advisor agreement applies.');
  const actions = (db.prepare("SELECT action FROM admin_audit_log WHERE action LIKE 'program.playbook.%' ORDER BY id").all() as any[]).map((x) => x.action);
  assert.deepEqual(actions, ['program.playbook.edit', 'program.playbook.publish']);

  const adminEdit = await progs(db, ADMIN, '/mentor-cohorts/playbook/sections/terms', { method: 'PUT', body: { body: 'x' } });
  assert.equal(adminEdit.status, 403);
  const adminPub = await progs(db, ADMIN, '/mentor-cohorts/playbook/publish', { method: 'POST' });
  assert.equal(adminPub.status, 403);
});

test('AI-native Venture has a draft and no published playbook', async () => {
  const db = fresh();
  const s = await progs(db, SUPER, '/ai-native-venture');
  assert.deepEqual(s.body.playbook, { published: false, version: null, published_at: null, sections: [] });
  assert.equal(s.body.draft.sections.length, 7);
  assert.ok(s.body.draft.sections.every((x: any) => x.body === null));
  assert.equal(s.body.draft.differs, true);
});

// ---------------------------------------------------------------------------
// 4. The catalogue read
// ---------------------------------------------------------------------------

test('the catalogue: the queues, their bands and the Waiting total, exact', async () => {
  const db = fresh();
  catalogueFixture(db);
  const cat = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  assert.deepEqual(cat.week_axis, ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
  const w = cat.waiting as any;
  assert.deepEqual(w.cohort, {
    available: true, count: 2, oldest_hours: 80, bands: { under_24: 1, from_24_to_72: 0, over_72: 1 }, age_not_recorded: 0, aged: 'since applied',
  });
  assert.equal(w.referrals.count, 2);
  assert.equal(w.referrals.waiting_on_member, 1);
  assert.deepEqual(w.referrals.bands, { under_24: 1, from_24_to_72: 1, over_72: 0 });
  assert.equal(w.referrals.aged, 'since submitted');
  assert.deepEqual({ count: w.perks.count, oldest: w.perks.oldest_hours, aged: w.perks.aged }, { count: 1, oldest: 50, aged: 'since last edit' });
  assert.equal(w.hosts.count, 1);
  assert.deepEqual(w.strategic, { available: false, pending: true, reason: PART4_STRATEGIC_REASON });
  const tile = cat.tiles.waiting as any;
  assert.equal(tile.count, 6);
  assert.equal(tile.oldest_hours, 80);
  assert.deepEqual(tile.covers, ['cohort', 'referrals', 'perks', 'hosts']);
  assert.deepEqual(tile.left_out.map((x: any) => x.queue), ['strategic']);
});

test('the catalogue leaves a deactivated Advisor out (D960): no mentor, no cohort covered', async () => {
  const db = fresh();
  catalogueFixture(db);
  // A third Advisor holds the running cycle B, which only FORMER held, on a deactivated account.
  db.exec(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (9, 'u-9', 'person9@example.test', 'Ola Off', 'advisor', 0);
    INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, unassigned_at, is_active) VALUES ('as-9', 9, 2, '2026-10-02 10:00:00', NULL, 1);`);
  const mentor = rowOf(await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW), 'mentor-cohorts');
  assert.deepEqual(mentor.figures.mentors, { available: true, count: 1 }, 'ADV1 only: the deactivated Advisor is not an active mentor');
  assert.deepEqual(mentor.figures.coverage, { available: true, cohorts: 2, covered: 1, uncovered: 1 }, 'B stays uncovered');
  db.exec('UPDATE users SET is_active = 1 WHERE id = 9');
  const back = rowOf(await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW), 'mentor-cohorts');
  assert.deepEqual(back.figures.mentors, { available: true, count: 2 }, 'reactivated, they count again');
  assert.deepEqual(back.figures.coverage, { available: true, cohorts: 2, covered: 2, uncovered: 0 });
});

test('the catalogue: each card\'s figures and Needs you, and Programs running', async () => {
  const db = fresh();
  catalogueFixture(db);
  const sa = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  assert.deepEqual(sa.tiles.running, {
    available: true, running: 6, total: 9,
    by_status: { live: 6, partly_built: 1, not_built: 1, proposed: 1, paused: 0 },
  });
  const lab = rowOf(sa, 'spinout-lab');
  assert.deepEqual(lab.figures, { cohort_applications: { available: true, count: 2 } });
  assert.deepEqual(lab.needs_you, { available: true, count: 3, cohort_applications: 2, hosts: 1 });

  const mentor = rowOf(sa, 'mentor-cohorts');
  assert.deepEqual(mentor.figures.mentors, { available: true, count: 1 }, 'no reason: deactivated accounts are left out (D960)');
  assert.deepEqual(mentor.figures.coverage, { available: true, cohorts: 2, covered: 1, uncovered: 1 });
  assert.deepEqual(mentor.needs_you, { available: true, count: 2, cohorts_without_mentor: 1, holders_not_advisor: 1 });

  const refer = rowOf(sa, 'refer-and-earn');
  assert.deepEqual(refer.figures.open_referrals, { available: true, count: 2, waiting_on_member: 1 });
  assert.equal(refer.needs_you.count, 2);
  assert.deepEqual(refer.needs_you.strategic_requests, { available: false, pending: true, reason: PART4_STRATEGIC_REASON });

  const perks = rowOf(sa, 'perks');
  assert.deepEqual(perks.figures.live, { available: true, count: 1 });
  assert.deepEqual(perks.needs_you, { available: true, count: 1 });

  assert.deepEqual(rowOf(sa, 'learning').figures.programs,
    { available: true, published_programs: 2, active_enrolments: 3, join_methods: ['open', 'invite'], scope: 'every' });
  assert.deepEqual(rowOf(sa, 'product-testing').figures, { programs: { available: true, open: 1, applications: 1 } });
  for (const k of ['ai-native-venture', 'investor-cohorts', 'referral-partners']) {
    assert.equal(rowOf(sa, k).figures, null, k);
    assert.equal(rowOf(sa, k).needs_you, null, k);
  }

  const admin = await programCatalogue(envOf(db), { id: ADMIN, superAdmin: false }, 4, NOW);
  assert.deepEqual(rowOf(admin, 'learning').figures.programs,
    { available: true, published_programs: 1, active_enrolments: 2, join_methods: ['open'], scope: 'assigned' },
    'an Admin counts only the programs assigned to them');
  assert.equal(rowOf(admin, 'product-testing').figures, null, 'an Admin gets no Product testing figure');
});

test('a figure waiting on part 4 answers pending with its reason, never unreadable or 0', async () => {
  const db = fresh();
  catalogueFixture(db);
  const cat = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  for (const [where, b] of [
    ['perk claims', rowOf(cat, 'perks').figures.claims], ['perks per week', cat.joins_weekly.perks],
    ['strategic queue', cat.waiting.strategic], ['strategic requests', rowOf(cat, 'refer-and-earn').needs_you.strategic_requests],
  ] as const) {
    assert.equal((b as any).pending, true, where);
    assert.equal((b as any).available, false, where);
    assert.equal('unreadable' in (b as any), false, where);
    assert.equal('count' in (b as any), false, where);
  }
  assert.equal((cat.joins_weekly.perks as any).reason, PART4_CLAIMS_REASON);
});

test('People taking part counts distinct accounts across the programs, and the period before', async () => {
  const db = fresh();
  catalogueFixture(db);
  const cat = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  // Now: ADV1 and FORMER (assignments), LEARNER and LEARNER2 (published enrolments; FOUNDER's is in a draft),
  // FOUNDER (referrals and a claim). Before (2026-08-31 to 2026-09-28): ADV1 (row on D), FORMER, LEARNER2 is enrolled 48 h ago,
  // LEARNER 100 h ago: neither before. Referral rs-3 is June. So 2.
  const p = cat.tiles.people as any;
  assert.equal(p.count, 5);
  // Someone enrolled only in a draft program is not taking part.
  db.exec(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (8, 'u-8', 'person8@example.test', 'Dee Draft', 'founder', 1);
    INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES (3, 8, 1, '${at(NOW - HOUR)}', 'active', '${at(NOW - HOUR)}');`);
  assert.equal(((await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW)).tiles.people as any).count, 5);
  assert.equal(p.previous, 2);
  assert.deepEqual(p.covers, ['mentor-cohorts', 'learning', 'refer-and-earn', 'perks']);
  assert.equal(p.left_out[0].program, 'spinout-lab');
});

test('joins per week: referrals, Learning in the viewer\'s scope, and Lab applications in its own query', async () => {
  const db = fresh();
  catalogueFixture(db);
  const sa = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  const counts = (b: any) => b.weeks.map((w: any) => w.count);
  assert.deepEqual(counts(sa.joins_weekly.referrals), [0, 0, 0, 2]);
  assert.equal((sa.joins_weekly.referrals as any).previous_total, 0);
  assert.deepEqual(counts(sa.joins_weekly.learning), [0, 0, 1, 2]);
  assert.deepEqual(counts(sa.joins_weekly.lab), [0, 0, 1, 1]);
  assert.equal((sa.joins_weekly.lab as any).previous_total, 1);
  const admin = await programCatalogue(envOf(db), { id: ADMIN, superAdmin: false }, 4, NOW);
  assert.deepEqual(counts(admin.joins_weekly.learning), [0, 0, 1, 1], 'an Admin counts only their assigned programs');
});

test('credits: a Super Admin gets each month by source, spent, deducted and refunded; an Admin gets no figure', async () => {
  const db = fresh();
  catalogueFixture(db);
  const sa = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  const cm = sa.credits_monthly as any;
  assert.deepEqual(cm.months.map((m: any) => m.month), ['2026-09', '2026-10']);
  const oct = cm.months[1];
  assert.deepEqual(oct.granted, { lab: 50, bounty: 20, manual: 10, referral: null, other_rule: 0, no_rule: 5 });
  assert.deepEqual({ t: oct.granted_total, s: oct.spent, d: oct.deducted, r: oct.refunded }, { t: 85, s: 30, d: 10, r: 5 });
  assert.deepEqual(cm.referral, { recorded: false, reason: REFERRAL_REWARDS_REASON });
  assert.deepEqual(sa.tiles.credits, { available: true, granted: 85, spent: 30, deducted: 10, refunded: 5, referral: cm.referral });

  db.exec(`INSERT INTO credit_reward_rules (key, credits, usd_value_cents) VALUES ('referral:signup', 10, 1000);
    INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, created_at, rule_key) VALUES (${FOUNDER}, 10, 'grant', 'g9', '${at(NOW - HOUR)}', 'referral:signup');`);
  const paid = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  assert.equal((paid.credits_monthly as any).months[1].granted.referral, 10);
  assert.deepEqual((paid.credits_monthly as any).referral, { available: true });

  const admin = await programCatalogue(envOf(db), { id: ADMIN, superAdmin: false }, 4, NOW);
  assert.deepEqual(admin.tiles.credits, { available: false, pending: true, reason: HQ_READS_REASON });
  assert.deepEqual(admin.credits_monthly, { available: false, pending: true, reason: HQ_READS_REASON });
});

test('a block that fails fails alone: the hosts table gone leaves every other block standing', async () => {
  const db = fresh();
  catalogueFixture(db);
  db.exec('DROP TABLE lab_host_applications');
  const cat = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  assert.equal((cat.waiting.hosts as any).unreadable, true);
  assert.equal((cat.tiles.waiting as any).unreadable, true, 'a total missing a queue is not drawn');
  assert.match((cat.tiles.waiting as any).reason, /hosts/);
  assert.equal(rowOf(cat, 'spinout-lab').needs_you.unreadable, true);
  assert.deepEqual(rowOf(cat, 'spinout-lab').figures.cohort_applications, { available: true, count: 2 });
  assert.equal((cat.waiting.cohort as any).count, 2);
  assert.equal(rowOf(cat, 'mentor-cohorts').needs_you.count, 2);
  assert.equal((cat.tiles.people as any).count, 5);

  db.exec('DROP TABLE programs');
  const noRegistry = await programCatalogue(envOf(db), { id: SUPER, superAdmin: true }, 4, NOW);
  assert.equal((noRegistry.programs as any).unreadable, true);
  assert.equal((noRegistry.tiles.running as any).unreadable, true);
  assert.equal((noRegistry.waiting.cohort as any).count, 2, 'the registry failing takes no queue with it');
});

test('the route: weeks and scope are checked before any read', async () => {
  const db = fresh();
  const def = await progs(db, ADMIN, '/');
  assert.equal(def.status, 200);
  assert.equal(def.body.weeks, 12);
  assert.equal(def.body.week_axis.length, 12);
  for (const w of ['5', '12.0', 'year']) {
    const r = await progs(db, ADMIN, `/?weeks=${w}`);
    assert.equal(r.status, 400, w);
    assert.equal(r.body.code, 'bad_weeks', w);
  }
  const own = await progs(db, ADMIN, '/?scope=hq&weeks=4');
  assert.equal(own.status, 200);
  const other = await progs(db, ADMIN, '/?scope=no');
  assert.equal(other.status, 403);
  assert.equal(other.body.code, 'hq_only');
  const malformed = await progs(db, SUPER, '/?scope=NOT%20A%20CODE!');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'bad_scope');
  const member = await progs(db, FOUNDER, '/');
  assert.equal(member.status, 403);
});

test('the per-studio form: a branch answers counts only through programs(), HQ adds the names; a branch that does not answer is unreadable', async () => {
  const branchDb = fresh();
  catalogueFixture(branchDb);
  const branchEnv = envOf(branchDb, { BRANCH_CODE: 'no' });
  const ans = await branchPrograms(branchEnv, { weeks: '4', email: 'x@y.z' }, loadProgramsForBranch);
  const rows = (ans.programs as any).programs.rows;
  assert.equal(rows.length, 9);
  assert.ok(rows.every((r: any) => !('name' in r)), 'countsOnly drops the names before the branch answers');
  assert.equal((ans.programs as any).weeks, 4);
  await assert.rejects(() => branchPrograms(branchEnv, { weeks: '5' }, loadProgramsForBranch), /weeks must be 4, 12 or 52/);

  const hq = fresh();
  const binding = { programs: (p: unknown) => branchPrograms(branchEnv, p, loadProgramsForBranch) };
  const r = await progs(hq, SUPER, '/?scope=no&weeks=4', { env: { BRANCH_NO: binding } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.scope.key, 'no');
  assert.equal(r.body.branch.status, 'ok');
  assert.equal(r.body.programs.rows.find((x: any) => x.key === 'learning').name, 'Learning', 'HQ adds the name from its registry');
  assert.equal(r.body.waiting.cohort.count >= 0, true);
  assert.equal(JSON.stringify(r.body).includes('@example.test'), false);

  const down = await progs(hq, SUPER, '/?scope=de&weeks=4');
  assert.equal(down.status, 200);
  assert.equal(down.body.branch.status, 'not_deployed');
  for (const b of [down.body.programs, down.body.tiles.running, down.body.tiles.people, down.body.tiles.waiting, down.body.tiles.credits,
    down.body.waiting.cohort, down.body.joins_weekly.lab, down.body.credits_monthly]) {
    assert.equal(b.unreadable, true);
    assert.match(b.reason, /not bound to this Worker/);
    assert.equal('count' in b, false, 'never a 0');
  }
});

// ---------------------------------------------------------------------------
// 5. Learning
// ---------------------------------------------------------------------------

test('Learning: a re-enrolment counts twice, an active learner is not counted again, and removal writes an event', async () => {
  const db = fresh();
  db.exec(`INSERT INTO learning_programs (id, uid, name, enrolment, status, created_by) VALUES
    (1, 'lp-1', 'Nordics', 'open', 'published', ${SUPER}), (2, 'lp-2', 'Iberia', 'invite', 'published', ${SUPER});
    INSERT INTO learning_program_admins (program_id, user_id, assigned_by) VALUES (1, ${ADMIN}, ${SUPER}), (1, ${SUPER}, ${SUPER});`);
  const sa = (path: string, init?: Parameters<typeof call>[4]) => call(adminLearningPrograms, db, SUPER, path, init);
  assert.equal((await sa('/programs/lp-1/enrollments', { method: 'POST', body: { user_uid: `u-${LEARNER}` } })).status, 200);
  assert.equal((await sa('/programs/lp-1/enrollments', { method: 'POST', body: { user_uid: `u-${LEARNER}` } })).status, 200, 'already active');
  assert.equal((await sa(`/programs/lp-1/enrollments/u-${LEARNER}`, { method: 'DELETE' })).status, 200);
  assert.equal((await sa(`/programs/lp-1/enrollments/u-${LEARNER}`, { method: 'DELETE' })).status, 404, 'removing twice changes nothing');
  assert.equal((await sa('/programs/lp-1/enrollments', { method: 'POST', body: { user_uid: `u-${LEARNER}` } })).status, 200, 're-enrolled');
  assert.equal((await sa('/programs/lp-2/enrollments', { method: 'POST', body: { user_uid: `u-${LEARNER2}` } })).status, 200);
  // A self-enrolment writes its event too.
  assert.equal((await call(learningPrograms, db, LEARNER2, '/programs/lp-1/enrol', { method: 'POST' })).status, 201);

  const ev = (db.prepare('SELECT program_id, user_id, kind FROM learning_enrolment_events ORDER BY id').all() as any[]).map((e) => `${e.program_id}:${e.user_id}:${e.kind}`);
  assert.deepEqual(ev, [`1:${LEARNER}:enrolled`, `1:${LEARNER}:removed`, `1:${LEARNER}:enrolled`, `2:${LEARNER2}:enrolled`, `1:${LEARNER2}:enrolled`]);

  const weekly = await call(learningPrograms, db, SUPER, '/programs/mine/enrolments?weeks=4');
  assert.equal(weekly.status, 200, JSON.stringify(weekly.body));
  assert.equal(weekly.body.total, 4);
  const lp1 = weekly.body.programs.find((p: any) => p.uid === 'lp-1');
  assert.equal(lp1.total, 3, 'the re-enrolment counts again, and the removal does not take one away');
  assert.equal(weekly.body.by_week.length, 4);

  const admin = await call(learningPrograms, db, ADMIN, '/programs/mine/enrolments?weeks=4');
  assert.deepEqual(admin.body.programs.map((p: any) => p.uid), ['lp-1'], 'an Admin reads only their assigned programs');
  assert.equal(admin.body.total, 3);
  assert.equal((await call(learningPrograms, db, ADMIN, '/programs/mine/enrolments?weeks=7')).body.error, 'bad_weeks');
  assert.equal((await call(learningPrograms, db, FOUNDER, '/programs/mine/enrolments')).status, 403);

  const mine = await call(learningPrograms, db, ADMIN, '/programs/mine');
  assert.equal(mine.body.programs[0].admins, 2, 'the assigned-admin count, never names');
});

test('Learning: each learner\'s dates, last activity and an item\'s kind', async () => {
  const db = fresh();
  db.exec(`INSERT INTO learning_programs (id, uid, name, enrolment, status, created_by) VALUES (1, 'lp-1', 'Nordics', 'open', 'published', ${SUPER});
    INSERT INTO learning_program_admins (program_id, user_id, assigned_by) VALUES (1, ${ADMIN}, ${SUPER});
    INSERT INTO learning_items (id, uid, kind, title, status, created_by) VALUES (1, 'it-1', 'video', 'Welcome', 'published', ${SUPER}), (2, 'it-2', 'reading', 'Rules', 'published', ${SUPER});
    INSERT INTO learning_courses (id, uid, slug, title, status, created_by) VALUES (1, 'co-1', 'c1', 'Course', 'published', ${SUPER});
    INSERT INTO learning_course_modules (id, uid, course_id, title, position) VALUES (1, 'mo-1', 1, 'M', 0);
    INSERT INTO learning_lessons (id, uid, module_id, kind, title, required, position) VALUES
      (1, 'le-1', 1, 'reading', 'L1', 1, 0), (2, 'le-2', 1, 'reading', 'L2', 1, 1), (3, 'le-3', 1, 'reading', 'Optional', 0, 2);
    INSERT INTO learning_exams (id, uid, title, status, pass_mark_percent, created_by) VALUES (1, 'ex-1', 'Check', 'published', 50, ${SUPER});
    INSERT INTO learning_exercises (id, uid, title, status, submission_kind, created_by) VALUES (1, 'xr-1', 'Plan', 'published', 'text', ${SUPER});
    INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid, position) VALUES
      (1, 'item', 'it-1', 0), (1, 'item', 'it-2', 1), (1, 'course', 'co-1', 2), (1, 'exam', 'ex-1', 3), (1, 'exercise', 'xr-1', 4);
    INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES
      (1, ${LEARNER}, ${LEARNER}, '2026-10-01T09:00:00.000Z', 'active', '2026-10-01T09:00:00.000Z');
    INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, completed_at, updated_at) VALUES
      (${LEARNER}, 'item', 'it-1', 'completed', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z'),
      (${LEARNER}, 'item', 'it-2', 'started', NULL, '2026-10-03T10:00:00.000Z'),
      (${LEARNER}, 'lesson', 'le-1', 'completed', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:00.000Z'),
      (${LEARNER}, 'lesson', 'le-2', 'completed', '2026-10-06T10:00:00.000Z', '2026-10-06T10:00:00.000Z'),
      (${LEARNER}, 'lesson', 'le-3', 'started', NULL, '2026-10-07T10:00:00.000Z'),
      (${LEARNER}, 'item', 'outside', 'started', NULL, '2026-10-20T10:00:00.000Z');
    INSERT INTO learning_exam_attempts (uid, exam_id, user_id, started_at, submitted_at, score_percent, passed, question_order_json) VALUES
      ('at-1', 1, ${LEARNER}, '2026-10-05T09:00:00.000Z', '2026-10-05T09:30:00.000Z', 40, 0, '[]'),
      ('at-2', 1, ${LEARNER}, '2026-10-08T09:00:00.000Z', '2026-10-08T09:30:00.000Z', 80, 1, '[]'),
      ('at-3', 1, ${LEARNER}, '2026-10-09T09:00:00.000Z', '2026-10-09T09:30:00.000Z', 90, 1, '[]');
    INSERT INTO learning_exercise_submissions (uid, exercise_id, user_id, body, status, submitted_at, reviewed_at) VALUES
      ('sb-1', 1, ${LEARNER}, 'v1', 'needs_work', '2026-10-05T12:00:00.000Z', '2026-10-06T12:00:00.000Z'),
      ('sb-2', 1, ${LEARNER}, 'v2', 'accepted', '2026-10-10T12:00:00.000Z', '2026-10-11T12:00:00.000Z');`);
  const r = await call(learningPrograms, db, ADMIN, '/programs/lp-1/learners');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.contents.map((x: any) => x.kind), ['video', 'reading', null, null, null]);
  const l = r.body.learners[0];
  assert.equal(l.last_activity_at, '2026-10-10T12:00:00.000Z', 'the latest activity on these contents only');
  const [video, reading, course, exam, exercise] = l.completion;
  assert.equal(video.completed_at, '2026-10-02T10:00:00.000Z');
  assert.equal(reading.completed_at, null);
  assert.equal(course.status, 'completed');
  assert.equal(course.completed_at, '2026-10-06T10:00:00.000Z', 'a course done through its required lessons takes the latest');
  assert.equal(exam.passed_at, '2026-10-08T09:30:00.000Z', 'the first passing attempt');
  assert.deepEqual({ s: exercise.status, a: exercise.submitted_at, b: exercise.reviewed_at },
    { s: 'accepted', a: '2026-10-10T12:00:00.000Z', b: '2026-10-11T12:00:00.000Z' });
  const one = await call(learningPrograms, db, ADMIN, `/programs/lp-1/learners/u-${LEARNER}`);
  assert.equal(one.body.learner.last_activity_at, '2026-10-10T12:00:00.000Z');
});

// ---------------------------------------------------------------------------
// 6. Sessions booked with a mentor
// ---------------------------------------------------------------------------

test('sessions: bookings not cancelled, on live slots, with the cycle\'s mentors, inside its window', async () => {
  const db = fresh();
  catalogueFixture(db);
  db.exec(`INSERT INTO advisors (id, uid, user_id, display_name) VALUES (10, 'ad-1', ${ADV1}, 'Ava'), (11, 'ad-2', ${FORMER}, 'Finn');
    INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at, is_cancelled) VALUES
      (1, 's1', 10, '2026-11-03 15:00:00', '2026-11-03 16:00:00', 0),
      (2, 's2', 10, '2026-11-04 15:00:00', '2026-11-04 16:00:00', 0),
      (3, 's3', 10, '2026-11-05 15:00:00', '2026-11-05 16:00:00', 1),
      (4, 's4', 10, '2026-12-05 15:00:00', '2026-12-05 16:00:00', 0),
      (5, 's5', 11, '2026-11-06 15:00:00', '2026-11-06 16:00:00', 0),
      (6, 's6', 10, '2026-09-10 15:00:00', '2026-09-10 16:00:00', 0);
    INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status) VALUES
      ('b1', 1, 10, ${FOUNDER}, 'confirmed'), ('b2', 2, 10, ${FOUNDER}, 'cancelled'), ('b3', 3, 10, ${FOUNDER}, 'confirmed'),
      ('b4', 4, 10, ${FOUNDER}, 'confirmed'), ('b5', 5, 11, ${FOUNDER}, 'completed'), ('b6', 6, 10, ${LEARNER}, 'no_show');`);
  const r = await progs(db, ADMIN, '/mentor-cohorts/sessions');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = new Map(r.body.cycles.map((x: any) => [`${x.year}-${x.month}`, x]));
  assert.equal((by.get('2026-11') as any).sessions, 1, 'only b1: b2 cancelled, b3 on a cancelled slot, b4 outside, b5 another mentor');
  assert.equal((by.get('2026-11') as any).mentors, 1);
  assert.equal((by.get('2026-9') as any).sessions, 1, 'an ended assignment still counts its window');
  assert.equal((by.get('2026-12') as any).sessions, 0, 'b4 falls in a cycle ADV1 is not assigned to');
  assert.equal(JSON.stringify(r.body).includes('@'), false);
  assert.equal((await progs(db, FOUNDER, '/mentor-cohorts/sessions')).status, 403);
});

// ---------------------------------------------------------------------------
// 7. Activity
// ---------------------------------------------------------------------------

test('activity: the program\'s own rows, newest first, paged, by hq or admin; Learning scoped for an Admin; what is not audited is said', async () => {
  const db = fresh();
  catalogueFixture(db);
  const audit = (who: number, action: string, details: Record<string, unknown>, when: string) =>
    db.prepare('INSERT INTO admin_audit_log (admin_user_id, action, filters_json, exported_at) VALUES (?, ?, ?, ?)').run(who, action, JSON.stringify(details), when);
  audit(SUPER, 'program.registry.update', { program_key: 'learning', fields: ['purpose'] }, '2026-10-10 10:00:00');
  audit(SUPER, 'program.registry.update', { program_key: 'perks', fields: ['who'] }, '2026-10-10 11:00:00');
  audit(SUPER, 'learning.program.enrol', { uid: 'lp-1', user_uid: `u-${LEARNER}` }, '2026-10-11 10:00:00');
  audit(SUPER, 'learning.program.enrol', { uid: 'lp-2', user_uid: `u-${LEARNER}` }, '2026-10-12 10:00:00');
  audit(ADMIN, 'learning.program.update', { uid: 'lp-1', fields: ['name'] }, '2026-10-13 10:00:00');
  db.prepare("INSERT INTO admin_audit_log (admin_user_id, action, filters_json, exported_at) VALUES (?, 'learning.program.update', 'not json', '2026-10-14 10:00:00')").run(SUPER);

  const sa = await progs(db, SUPER, '/learning/activity');
  assert.equal(sa.status, 200, JSON.stringify(sa.body));
  assert.deepEqual(sa.body.rows.map((x: any) => [x.kind, x.by]), [
    ['learning.program.update', 'hq'], ['learning.program.update', 'admin'], ['learning.program.enrol', 'hq'],
    ['learning.program.enrol', 'hq'], ['program.registry.update', 'hq'],
  ]);
  assert.deepEqual(sa.body.rows[0].concerns, {}, 'a row whose details are not JSON is listed, naming nothing');
  assert.deepEqual(sa.body.rows[1].concerns, { learning_program: { uid: 'lp-1', name: 'Nordics' } });
  assert.deepEqual(sa.body.rows[4].concerns, { program: 'learning', fields: ['purpose'] });
  assert.equal(sa.body.not_audited, null);

  const admin = await progs(db, ADMIN, '/learning/activity');
  assert.deepEqual(admin.body.rows.map((x: any) => x.concerns.learning_program?.uid ?? x.concerns.program), ['lp-1', 'lp-1', 'learning'],
    'an Admin reads only the Learning programs assigned to them');
  assert.equal(admin.body.scope, 'assigned');

  const p1 = await progs(db, SUPER, '/learning/activity?limit=2');
  assert.equal(p1.body.rows.length, 2);
  assert.ok(p1.body.next_before);
  const p2 = await progs(db, SUPER, `/learning/activity?limit=2&before=${encodeURIComponent(p1.body.next_before)}`);
  assert.deepEqual(p2.body.rows.map((x: any) => x.kind), ['learning.program.enrol', 'learning.program.enrol']);
  const p3 = await progs(db, SUPER, `/learning/activity?limit=2&before=${encodeURIComponent(p2.body.next_before)}`);
  assert.deepEqual(p3.body.rows.map((x: any) => x.kind), ['program.registry.update']);
  assert.equal(p3.body.next_before, null);
  assert.equal((await progs(db, SUPER, '/learning/activity?before=yesterday')).body.code, 'bad_cursor');
  assert.equal((await progs(db, SUPER, '/learning/activity?limit=51')).body.code, 'bad_limit');

  const mentor = await progs(db, ADMIN, '/mentor-cohorts/activity');
  assert.equal(mentor.body.not_audited, null, 'D960 audits assign and end, so nothing is said to be missing');
  assert.equal(NOT_AUDITED_YET['mentor-cohorts'], undefined);
  assert.deepEqual(mentor.body.rows, []);
  const perks = await progs(db, ADMIN, '/perks/activity');
  assert.deepEqual(perks.body.rows.map((x: any) => x.concerns.program), ['perks']);
  assert.equal(perks.body.not_audited.recorded, false);
});

test('activity: Mentor reads D960\'s assign and end rows, naming the cohort and never the mentor', async () => {
  const db = fresh();
  catalogueFixture(db);
  const audit = (who: number, action: string, details: Record<string, unknown>, when: string) =>
    db.prepare('INSERT INTO admin_audit_log (admin_user_id, action, filters_json, exported_at) VALUES (?, ?, ?, ?)').run(who, action, JSON.stringify(details), when);
  // The shape routes/advisors.ts writes.
  audit(ADMIN, 'advisor_cohort.assigned', { target_user_id: ADV1, assignment_id: 1, cohort_cycle_id: 1 }, '2026-10-05 10:00:00');
  audit(SUPER, 'advisor_cohort.ended', { target_user_id: ADV1, assignment_id: 3, cohort_cycle_id: 4 }, '2026-10-06 10:00:00');
  audit(SUPER, 'learning.program.enrol', { uid: 'lp-1', user_uid: `u-${LEARNER}` }, '2026-10-07 10:00:00');
  const r = await progs(db, ADMIN, '/mentor-cohorts/activity');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.rows.map((x: any) => [x.kind, x.by, x.concerns]), [
    ['advisor_cohort.ended', 'hq', { cohort_cycle_id: 4 }],
    ['advisor_cohort.assigned', 'admin', { cohort_cycle_id: 1 }],
  ], 'Learning\'s row is Learning\'s');
  assert.ok(!JSON.stringify(r.body).includes('target_user_id'), 'the mentor is a person and is never named');
  // The action names are the ones the route writes.
  const route = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/advisors.ts'), 'utf8');
  for (const a of MENTOR_ACCESS_ACTIONS) assert.ok(route.includes(`'${a}'`), a);
});

test('activity: Refer & Earn reads the admin review timeline, never the referrer\'s own rows', async () => {
  const db = fresh();
  catalogueFixture(db);
  db.exec(`INSERT INTO referral_submission_events (submission_id, label, status, actor_user_id, created_at) VALUES
    (1, 'Submitted', 'submitted', ${FOUNDER}, '2026-10-19 10:00:00'),
    (1, 'Under review', 'under_review', ${ADMIN}, '2026-10-19 11:00:00'),
    (2, 'More info needed', 'more_info_needed', ${SUPER}, '2026-10-20 11:00:00'),
    (2, 'Updated', NULL, NULL, '2026-10-20 12:00:00');`);
  const r = await progs(db, ADMIN, '/refer-and-earn/activity');
  assert.deepEqual(r.body.rows.map((x: any) => [x.kind, x.by, x.concerns.status]), [
    ['referral.review', 'hq', 'more_info_needed'], ['referral.review', 'admin', 'under_review'],
  ]);
  assert.deepEqual(r.body.rows[0].concerns, { referral: 'rs-2', category: 'customer', status: 'more_info_needed' });
});

test('no Programs response in this file carries an email address or a person\'s name', () => {
  const all = SEEN.join('\n');
  assert.equal(/person\d+@example\.test/.test(all), false);
  for (const name of ['Sam Super', 'Ada Admin', 'Ava Advisor', 'Finn Former', 'Fay Founder']) assert.equal(all.includes(name), false, name);
});
