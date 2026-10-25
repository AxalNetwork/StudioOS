/** D948 (#2753): SL3's one-application read and the overview's settings, mounted on real SQLite. */
import test, { mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminCohort from '../src/routes/admin_cohort.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET } from './_esign_harness.ts';

const NOW = Date.UTC(2026, 10, 3, 5, 30);
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
afterEach(() => mock.timers.reset());
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const app = new Hono<any>(); app.route('/api/admin/cohort', adminCohort);
app.onError((err, c) => c.json({ error: err.message }, err.message === 'Unauthorized' ? 401 : err.message === 'Admin required' ? 403 : 500));

function fixture({ plans = true, settings = true, lifecycle = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const tables = ['users', 'cohort_cycles', 'cohort_applicants', 'spinout_applications', 'company_week_status', 'week_windows', 'spinout_lab_milestones', 'spinout_certificates'];
  if (settings) tables.push('cohort_settings');
  for (const name of tables) {
    const start = baseline.indexOf(`CREATE TABLE ${name} (`); assert.ok(start >= 0, name);
    db.exec(baseline.slice(start, baseline.indexOf(');', start) + 2));
  }
  if (lifecycle) {
    db.exec(readFileSync('cloudflare-worker/sql/migrations/315_spinout_application_lifecycle.sql', 'utf8'));
    db.exec(readFileSync('cloudflare-worker/sql/migrations/316_spinout_application_interviews.sql', 'utf8'));
  }
  if (plans) db.exec(readFileSync('cloudflare-worker/sql/migrations/396_spinout_week1_plans.sql', 'utf8'));
  db.exec(`INSERT INTO cohort_cycles (id,year,month,start_at,end_at,status,app_status,applications_close_at,force_proceed) VALUES
      (11,2026,11,'2026-11-01T04:00:00Z','2026-11-29T05:00:00Z','active','active',NULL,0),
      (12,2026,12,'2026-12-01T05:00:00Z','2026-12-29T05:00:00Z','scheduled','open','2026-11-25 04:59:00',1),
      (13,2027,1,'2027-01-01T05:00:00Z','2027-01-29T05:00:00Z','scheduled','open','2026-12-25 04:59:00',0);
    INSERT INTO users (id,role,email,name,is_active) VALUES (900,'admin','admin@example.test','Synthetic Admin',1),
      (1,'founder','fixture-1@example.test','Founder One',1),(2,'founder','fixture-2@example.test','Founder Two',1);`);
  if (settings) db.exec(`INSERT INTO cohort_settings (key,value) VALUES ('min_cohort_size','3'),('max_cohort_size','25');`);
  const cols = lifecycle ? ',answers_json,applicant_note,applicant_asks_json' : '';
  const vals = lifecycle ? `,'{"origin":"university","institution":"Fixture University","tto_status":"negotiating","team_size":3}','Thanks for applying.','["Find a commercial lead"]'` : '';
  db.exec(`INSERT INTO spinout_applications (id,user_id,company_name,idea,incorporated,stage,status,created_at${cols})
      VALUES (1,1,'Northwind Lab','Reconciliation research','no','prototype','pending','2026-10-20 12:00:00'${vals}),
             (2,2,'Second Lab','Synthetic idea','no','idea','pending','2026-11-02 12:00:00'${lifecycle ? ",NULL,NULL,NULL" : ''});
    INSERT INTO cohort_applicants (id,application_id,user_id,cohort_cycle_id,status,rolled_from_cycle_id,created_at) VALUES
      (21,1,1,12,'pending',11,'2026-11-01 04:00:00'),(22,2,2,13,'waitlisted',NULL,'2026-11-02 12:00:00');`);
  if (lifecycle) db.exec(`INSERT INTO spinout_application_interviews (id,application_id,user_id,scheduled_at,duration_min,location,note,status,reschedule_requested_at,reschedule_reason) VALUES
      (1,1,1,'2026-11-10 15:00:00',30,'Fixture room','Old note','cancelled',NULL,NULL),
      (2,1,1,'2026-11-18 20:00:00',30,'Fixture link','We will walk through the IP.','scheduled','2026-11-04 10:00:00','I teach on Wednesdays.');`);
  if (plans) db.exec(`INSERT INTO spinout_week1_plans (user_id,rule_key,steps_json,started,computed_by,created_at,updated_at)
      VALUES (1,'negotiating','["project_created","icp_defined"]',0,'system','2026-11-01 04:00:00','2026-11-01 04:00:00');`);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const call = async (path: string, who: number | null = 900) => {
    const headers: Record<string, string> = {};
    if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === 900 ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
    const r = await app.request(`/api/admin/cohort${path}`, { headers }, env); return { status: r.status, body: await r.json() as any };
  };
  return { db, call };
}

test('D948: one application is the queue’s row, with what the founder was told, the latest interview, its cohorts and the plan', async () => {
  const f = fixture();
  const list = await f.call('/applications/list?cohort=2026-12');
  const r = await f.call('/applications/21');
  assert.equal(r.status, 200); assert.equal(r.body.available, true);
  assert.deepEqual(r.body.item, list.body.items[0], 'the drawer reads the same row the queue lists');
  assert.equal(r.body.item.display_status, 'interview_set');
  assert.equal(r.body.founder.applicant_note, 'Thanks for applying.');
  assert.deepEqual(r.body.founder.applicant_asks, ['Find a commercial lead']);
  assert.equal(r.body.interview.latest.id, 2, 'the latest interview, not the cancelled one');
  assert.equal(r.body.interview.latest.note, 'We will walk through the IP.');
  assert.equal(r.body.interview.latest.reschedule_reason, 'I teach on Wednesdays.');
  assert.equal(r.body.cohort.own.cohort, '2026-12'); assert.equal(r.body.cohort.own.force_proceed, true);
  assert.equal(r.body.cohort.next.cohort, '2027-01');
  assert.equal(r.body.cohort.carried_from.cohort, '2026-11');
  assert.equal(r.body.week1_plan.available, true); assert.deepEqual(r.body.week1_plan.plan.steps, ["project_created", "icp_defined"]);
  const other = await f.call('/applications/22');
  assert.equal(other.body.cohort.carried_from, null); assert.equal(other.body.cohort.next, null, 'no cohort is stored after January');
  assert.equal(other.body.interview.latest, null); assert.equal(other.body.week1_plan.plan, null);
  f.db.close();
});

test('D948: a missing application is 404; a non-number never reaches the route; a founder is refused', async () => {
  const f = fixture();
  const missing = await f.call('/applications/999');
  assert.equal(missing.status, 404); assert.equal(missing.body.error, 'applicant_not_found');
  const list = await f.call('/applications/list');
  assert.equal(list.status, 200); assert.equal(list.body.available, true, '/applications/list is still the list');
  assert.equal((await f.call('/applications/21', 1)).status, 403);
  assert.equal((await f.call('/applications/21', null)).status, 401);
  f.db.close();
});

test('D948: each block answers alone; a failed plan or interview read never blanks the application', async () => {
  const f = fixture({ plans: false });
  const r = await f.call('/applications/21');
  assert.equal(r.body.available, true);
  assert.equal(r.body.week1_plan.available, false); assert.match(r.body.week1_plan.reason, /not the same as none/);
  assert.equal(r.body.interview.available, true); assert.equal(r.body.item.company_name, 'Northwind Lab');
  f.db.exec('DROP TABLE spinout_application_interviews');
  const r2 = await f.call('/applications/21');
  assert.equal(r2.body.available, false, 'the pool row itself joins the interviews, so the whole read says it failed');
  assert.match(r2.body.reason, /could not be read/); assert.equal(r2.body.item, undefined);
  f.db.close();
});

test('D948: the overview carries the settings for the capacity bar, or says they could not be read', async () => {
  const f = fixture();
  const r = await f.call('/overview');
  assert.deepEqual(r.body.blocks.settings, { available: true, min: 3, places: 25 });
  const dec = r.body.blocks.cohorts.items.find((c: any) => c.cohort === '2026-12');
  assert.equal(dec.force_proceed, 1);
  f.db.close();
  const g = fixture({ settings: false });
  const u = await g.call('/overview');
  assert.equal(u.body.blocks.settings.available, false); assert.match(u.body.blocks.settings.reason, /Minimum and places/);
  assert.equal(u.body.blocks.cohorts.available, true, 'the cohorts still answer');
  g.db.close();
});
