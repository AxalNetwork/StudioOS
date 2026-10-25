/** D971 (#2756): real SQLite tests of mounted Lab operations and D954 playbook writes.
 * Builds the baseline and migrations through 560; no string-matching database stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import adminPrograms from '../src/routes/admin_programs.ts';
import adminOperations from '../src/routes/admin_lab_operations.ts';
import adminCohort from '../src/routes/admin_cohort.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const M560 = readFileSync(resolve(MIGRATIONS, '560_program_registry.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';


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
BUILT.exec(M560);
// D955 landed while this tab was being built; the registry now selects licence_uid.
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
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body };
}
const progs = (db: DatabaseSync, who: number, path: string, init?: Parameters<typeof call>[4]) => call(adminPrograms, db, who, path, init);




test('Lab: no read writes, first draft is Super Admin only, validated, audited and published as an immutable version', async () => {
  const db = fresh();
  const count = () => Number(db.prepare("SELECT COUNT(*) n FROM program_playbook_sections WHERE program_key = 'spinout-lab'").get()!.n);
  const first = await progs(db, ADMIN, '/spinout-lab');
  assert.equal(first.status, 200);
  assert.equal(first.body.section_catalogue.length, 10);
  assert.equal(first.body.playbook.published, false);
  assert.equal(count(), 0, 'read must not initialise draft rows');
  assert.equal((await progs(db, ADMIN, '/spinout-lab/playbook/sections/purpose', { method: 'PUT', body: { body: 'HQ draft' } })).status, 403);
  assert.equal((await progs(db, SUPER, '/spinout-lab/playbook/sections/purpose', { method: 'PUT', body: { body: 'x'.repeat(5001) } })).status, 400);
  assert.equal((await progs(db, SUPER, '/spinout-lab/playbook/sections/unknown', { method: 'PUT', body: { body: 'x' } })).status, 404);
  assert.equal((await progs(db, SUPER, '/learning/playbook/sections/new-lab-key', { method: 'PUT', body: { body: 'x' } })).status, 404);
  assert.equal(count(), 0);
  const edit = await progs(db, SUPER, '/spinout-lab/playbook/sections/purpose', { method: 'PUT', body: { body: 'HQ draft' } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.draft.sections[0].body, 'HQ draft');
  assert.equal(edit.body.playbook.published, false);
  assert.equal((await progs(db, ADMIN, '/spinout-lab')).body.draft, undefined);
  assert.equal((await progs(db, ADMIN, '/spinout-lab/playbook/publish', { method: 'POST' })).status, 403);
  assert.equal((await progs(db, SUPER, '/spinout-lab/playbook/publish', { method: 'POST' })).body.playbook.version, 1);
  await progs(db, SUPER, '/spinout-lab/playbook/sections/purpose', { method: 'PUT', body: { body: 'New draft' } });
  assert.equal((await progs(db, ADMIN, '/spinout-lab')).body.playbook.sections[0].body, 'HQ draft');
  const published = await progs(db, SUPER, '/spinout-lab/playbook/publish', { method: 'POST' });
  assert.equal(published.status, 200);
  assert.equal(published.body.playbook.version, 2);
  assert.equal(db.prepare("SELECT body FROM program_playbook_sections WHERE program_key='spinout-lab' AND version=1").get()!.body, 'HQ draft');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='program.playbook.edit'").get()!.n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='program.playbook.publish'").get()!.n, 2);
  db.close();
});

function eventsFixture(db: DatabaseSync) {
  db.exec(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at) VALUES
    (1, 2026, 11, '2026-11-01 04:00:00', '2026-11-29 05:00:00'),
    (2, 2026, 12, '2026-12-01 05:00:00', '2026-12-29 05:00:00');
    INSERT INTO cohort_cycle_events (cohort_cycle_id,event_type,actor,details,created_at) VALUES
    (1,'applications_closed','scheduler','secret-admin-name','2026-11-01 04:00:00'),
    (1,'applicant_approved','admin:2','secret-admin-name','2026-11-02 04:00:00'),
    (2,'cycle_activated','scheduler','secret-admin-name','2026-12-01T05:00:00Z');
    INSERT INTO cohort_app_notification_ledger (user_id,cohort_cycle_id,notif_type,status,sent_at) VALUES
    (${FOUNDER},1,'approved','failed','2026-11-03 04:00:00'),
    (${ADMIN},1,'approved','sent','2026-11-03 05:00:00');
    INSERT INTO stage_transition_log (user_id,cohort_cycle_id,week_number,to_status,triggered_by,reason,created_at)
      VALUES (${FOUNDER},1,1,'passed','scheduler','secret-admin-name','2026-11-07 04:59:00');
    INSERT INTO spinout_application_interviews (application_id,user_id,scheduled_at,created_at,updated_at)
      VALUES (99,${FOUNDER},'2026-11-10 17:00:00','2026-11-02 14:00:00','2026-11-02 14:00:00');
    INSERT INTO cohort_applicants (application_id,user_id,cohort_cycle_id,status) VALUES (99,${FOUNDER},1,'pending');
    INSERT INTO admin_audit_log (admin_user_id,action,viewed_user_id,filters_json,exported_at) VALUES
      (${ADMIN},'lab_host.approve',${ADMIN},'{"reason":"secret-admin-name"}','2026-11-04 12:00:00'),
      (${SUPER},'program.playbook.publish',NULL,'{"program_key":"spinout-lab"}','2026-11-05 12:00:00'),
      (${SUPER},'program.playbook.publish',NULL,'{"program_key":"learning"}','2026-11-05 12:00:00'),
      (${ADMIN},'unrelated',NULL,'{}','2026-11-05 12:00:00');`);
}
test('one mounted Lab log: exact count, source separation, filters, literal search, stable pages and no staff identities', async () => {
  const db = fresh(); eventsFixture(db);
  const all = await call(adminCohort, db, ADMIN, '/activity?limit=2');
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 9);
  assert.equal(all.body.items.length, 2);
  assert.equal(all.body.items[0].event, 'cycle_activated');
  assert.doesNotMatch(JSON.stringify((await call(adminOperations, db, ADMIN, '/activity')).body), /secret-admin-name|Ada Admin|Sam Super|person\d@|admin:2|admin_user_id/);
  const next = await call(adminOperations, db, ADMIN, '/activity?limit=2&offset=2');
  assert.equal(next.body.total, 9);
  assert.equal(new Set([...all.body.items, ...next.body.items].map((x) => x.id)).size, 4);
  const empty = await call(adminOperations, db, ADMIN, '/activity?offset=99');
  assert.equal(empty.body.total, 9); assert.deepEqual(empty.body.items, []);
  assert.equal((await call(adminOperations, db, ADMIN, '/activity?type=decisions&cohort=2026-11&by=admin')).body.total, 1);
  assert.equal((await call(adminOperations, db, ADMIN, '/activity?cohort=2026-12')).body.total, 1);
  assert.equal((await call(adminOperations, db, ADMIN, '/activity?q=Fay')).body.total, 3);
  assert.equal((await call(adminOperations, db, ADMIN, '/activity?q=%25')).body.total, 0, 'search wildcards are literal');
  assert.equal((await call(adminOperations, db, ADMIN, '/activity?sort=oldest&limit=1')).body.items[0].event, 'applications_closed');
  assert.equal((await call(adminOperations, db, FOUNDER, '/activity')).status, 403);
  for (const query of ['type=oops', 'cohort=2026-13', 'by=2', 'sort=wrong', 'limit=101', 'offset=-1', 'offset=1.5']) {
    assert.equal((await call(adminOperations, db, ADMIN, '/activity?' + query)).status, 400);
  }
  db.close();
});
test('interview attribution is not guessed when an application has two cohorts; missing names remain null', async () => {
  const db = fresh(); eventsFixture(db);
  db.exec(`INSERT INTO cohort_applicants (application_id,user_id,cohort_cycle_id,status) VALUES (99,${FOUNDER},2,'rolled_forward');
    DELETE FROM users WHERE id=${FOUNDER}`);
  const reply = await call(adminOperations, db, ADMIN, '/activity?type=interviews');
  assert.equal(reply.status, 200);
  assert.equal(reply.body.items[0].cohort, null);
  assert.equal(reply.body.items[0].about, null);
  db.close();
});
test('settings default is operative, explicit zero stays zero, and save uses the existing mounted audited write', async () => {
  const db = fresh();
  assert.equal((await call(adminOperations, db, ADMIN, '/settings')).status, 200);
  const write = await call(adminCohort, db, ADMIN, '/applications/settings', { method: 'POST', body: { min_cohort_size: 3, max_cohort_size: 0 } });
  assert.equal(write.status, 200);
  assert.deepEqual((await call(adminCohort, db, ADMIN, '/settings')).body.settings, { min: 3, max: 0 });
  assert.equal(db.prepare("SELECT actor FROM cohort_cycle_events WHERE event_type='settings_updated'").get()!.actor, `admin:${ADMIN}`);
  assert.equal((await call(adminOperations, db, FOUNDER, '/settings')).status, 403);
  db.close();
});
test('each failed read is a 503 with a retry sentence; no schema bootstrap or empty successful feed', async () => {
  const db = fresh();
  db.exec('DROP TABLE cohort_settings');
  const settings = await call(adminOperations, db, ADMIN, '/settings');
  assert.equal(settings.status, 503);
  assert.match(settings.body.error, /Try again/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='cohort_settings'").get()!.n, 0);
  db.exec('DROP TABLE stage_transition_log');
  const log = await call(adminOperations, db, ADMIN, '/activity');
  assert.equal(log.status, 503);
  assert.match(log.body.error, /Try again/);
  db.close();
});

test('Formation includes only recorded actions for Lab ventures, with no invented historical cohort or staff payload', async () => {
  const db = fresh();
  db.exec(`UPDATE users SET spinout_lab_active=1, founder_id=900 WHERE id=${FOUNDER};
    INSERT INTO projects (id,name,founder_id) VALUES (11,'Synthetic Lab venture',900),(12,'Other venture',901);
    INSERT INTO incorporations (id,user_id,project_id,jurisdiction_id,company_name,amount_cents) VALUES
      (31,${FOUNDER},11,'delaware','Synthetic Lab venture',100), (32,${LEARNER},12,'delaware','Other venture',100);
    INSERT INTO admin_audit_log (admin_user_id,action,filters_json) VALUES
      (${ADMIN},'incorporation_packet_ready','{"incorporation_id":31,"reason":"secret-admin-name"}'),
      (${ADMIN},'incorporation_filed','{"incorporation_id":32}'),
      (${ADMIN},'section_83b_operator_review_recorded','{"project_id":11,"operator_user_id":2}'),
      (${ADMIN},'section_83b_operator_review_recorded','malformed');`);
  const reply = await call(adminOperations, db, ADMIN, '/activity?type=formation');
  assert.equal(reply.status, 200); assert.equal(reply.body.total, 2);
  assert.deepEqual(reply.body.items.map((x: any) => x.about), ['Synthetic Lab venture', 'Synthetic Lab venture']);
  assert.ok(reply.body.items.every((x: any) => x.cohort === null));
  assert.doesNotMatch(JSON.stringify(reply.body), /secret-admin-name|Other venture|operator_user_id/);
  assert.equal((await call(adminOperations, db, ADMIN, '/activity?type=formation&cohort=2026-11')).body.total, 0);
  db.close();
});
