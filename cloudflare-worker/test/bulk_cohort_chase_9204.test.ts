/** D9204: cohort reads and chase writes have fixed query preparation counts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cohort from '../src/routes/admin_cohort.ts';
import portfolio from '../src/routes/portfolio.ts';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const secret = '9204-synthetic-jwt-secret-0123456789';
const app = new Hono();
app.route('/api/admin/cohort', cohort);
app.route('/api/portfolio', portfolio);
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec("INSERT INTO users(id,role,name,email,is_active) VALUES(1,'admin','Admin','admin@example.test',1)");
  return db;
}
async function call(db: DatabaseSync, path: string, body?: unknown, expectedStatus = 200) {
  const token = await new SignJWT({ user_id: 1, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const d1 = d1Over(db);
  let prepares = 0, batches = 0;
  const writes = new WeakSet<object>();
  const counted = { ...d1, prepare(sql: string) {
    prepares++;
    const template = d1.prepare(sql);
    if (!sql.startsWith('INSERT INTO portfolio_update_chases')) return template;
    return { ...template, bind(...args: any[]) { const stmt = template.bind(...args); writes.add(stmt); return stmt; } };
  }, async batch(stmts: any[]) { if (stmts.some(s => writes.has(s))) batches++; return d1.batch(stmts); } };
  const res = await app.request(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, { JWT_SECRET: secret, ENVIRONMENT: 'development', DB: counted });
  const data: any = await res.json();
  assert.equal(res.status, expectedStatus, JSON.stringify(data));
  return { data, prepares, batches };
}
test('timeline prepares stay constant for one and twelve cycles, with isolated child rows', async () => {
  const db = fixture();
  const cycle = db.prepare("INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES(?,2026,?, ?, ?)");
  for (let id = 1; id <= 12; id++) {
    const start = `2026-${String(id).padStart(2,'0')}-01 00:00:00`;
    cycle.run(id,id,start,`${2026 + (id === 12 ? 1 : 0)}-${String(id === 12 ? 1 : id+1).padStart(2,'0')}-01 00:00:00`);
    db.prepare('INSERT INTO users(id,role,name,email,spinout_lab_active,spinout_lab_started_at) VALUES(?,\'founder\',\'Founder\',?,1,?)').run(100+id,`u${id}@example.test`,start);
    db.prepare('INSERT INTO week_windows(cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES(?,1,?,?)').run(id,start,start);
    db.prepare('INSERT INTO company_week_status(user_id,cohort_cycle_id,week_number,status) VALUES(?,?,1,?)').run(100+id,id,id%2 ? 'failed' : 'passed');
  }
  const twelve = await call(db,'/api/admin/cohort/timeline');
  assert.equal(twelve.data.cycles.length,12);
  assert.deepEqual(twelve.data.cycles.map((c: any) => [c.id,c.participant_count,c.windows.length,c.status_counts]), Array.from({length:12},(_,i)=>[12-i,1,1,[{week_number:1,status:(12-i)%2 ? 'failed' : 'passed',n:1}]]));
  db.exec('DELETE FROM cohort_cycles WHERE id <> 1');
  const one = await call(db,'/api/admin/cohort/timeline');
  assert.equal(twelve.prepares,one.prepares,'twelve cycles must not prepare per-cycle queries');
  db.close();
});
test('twenty chase targets use fixed prepares and one write batch; repeats never write', async () => {
  const db = fixture();
  for(let id=1;id<=20;id++) {
    db.prepare("INSERT INTO projects(id,uid,name,founder_id) VALUES(?,?,?,?)").run(id,`p${id}`,`Venture ${id}`,100+id);
    db.prepare("INSERT INTO portfolio_positions(uid,project_id,round_name,invested_amount,position_date) VALUES(?,?,'Seed',100,'2026-01-01')").run(`position${id}`,id);
    db.prepare("INSERT INTO reporting_duties(closing_id,closing_line_id,closing_line_uid,project_id,holder_user_id,kind,cadence,due_rule,due_days,source_document,source_clause,source_kind,starts_on,status) VALUES(1,?,?,?,1,'quarterly_kpi','quarterly','after_end',0,'IRA','1','closing_template','2026-01-01','active')").run(id,`line${id}`,id);
  }
  const ids = Array.from({length:20},(_,i)=>i+1);
  const many = await call(db,'/api/portfolio/chase',{project_ids:ids});
  assert.deepEqual(many.data.chased.map((r:any)=>[r.project_id,r.already]),ids.map(id=>[id,false]));
  assert.deepEqual(many.data.skips,[]);
  assert.equal(many.batches,1);
  db.exec('DELETE FROM portfolio_update_chases');
  const one = await call(db,'/api/portfolio/chase',{project_ids:[1]});
  assert.equal(many.prepares,one.prepares,'twenty targets must not prepare per-project queries');
  const repeat = await call(db,'/api/portfolio/chase',{project_ids:[1]});
  assert.equal(repeat.data.chased[0].uid,one.data.chased[0].uid);
  assert.equal(repeat.data.chased[0].already,true);
  assert.equal(repeat.batches,0);
  db.close();
});

test('review batches participants and milestones without mixing windows or people', async () => {
  const db = fixture();
  const now = Date.now(); // clock-ok: relative
  const stamp = (ms: number) => new Date(ms).toISOString().replace('T',' ').slice(0,19);
  const start = stamp(now - 86400000), end = stamp(now + 86400000);
  db.prepare('INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES(1,2026,1,?,?)').run(start,end);
  db.prepare('INSERT INTO week_windows(cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES(1,1,?,?)').run(start,end);
  const insert = db.prepare("INSERT INTO users(id,role,name,email,spinout_lab_active,spinout_lab_started_at) VALUES(?,'founder','Founder',?,1,?)");
  insert.run(101,'one@example.test',start);
  db.prepare("INSERT INTO spinout_lab_milestones(user_id,week,milestone_key,completed_at) VALUES(101,1,'project_created',?)").run(start);
  const one = await call(db,'/api/admin/cohort/review');
  for (let id=102;id<=120;id++) insert.run(id,`${id}@example.test`,start);
  const many = await call(db,'/api/admin/cohort/review');
  assert.equal(many.prepares,one.prepares);
  assert.deepEqual(many.data.at_risk.map((r:any)=>r.user_id).sort((a:number,b:number)=>a-b),Array.from({length:20},(_,i)=>101+i));
  assert.ok(many.data.at_risk.every((r:any)=>r.cycle_id===1 && r.week===1 && r.done===(r.user_id===101?1:0) && r.required===4 && r.missing.length===(r.user_id===101?3:4)));
  db.close();
});

test('applications keep counts, per-cycle limits and optional-field fallbacks in fixed batches', async () => {
  const db = fixture();
  db.exec("INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES(1,2026,1,'2026-01-01','2026-02-01')");
  db.exec("INSERT INTO spinout_applications(id,user_id,company_name,idea,answers_json) VALUES(1,1,'Synthetic','Synthetic','{}')");
  db.exec('INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id) VALUES(1,1,1,1)');
  const one = await call(db,'/api/admin/cohort/applications');
  for(let id=2;id<=12;id++) {
    db.prepare("INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES(?,2026,?,'2026-01-01','2026-02-01')").run(id,id);
    db.prepare('INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id) VALUES(?,1,1,?)').run(id,id);
  }
  // Each application has one row per cycle; the final cycle has 201 applicants.
  for(let id=100;id<300;id++) {
    db.prepare("INSERT INTO spinout_applications(id,user_id,company_name,idea) VALUES(?,1,'Synthetic','Synthetic')").run(id);
    db.prepare("INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id,status) VALUES(?,?,1,12,'approved')").run(id,id);
  }
  const many = await call(db,'/api/admin/cohort/applications');
  assert.equal(many.prepares,one.prepares);
  assert.equal(many.data.cycles.length,12);
  const last = many.data.cycles[0];
  assert.equal(last.applicants.length,200);
  assert.deepEqual(last.applicant_counts,{approved:200,pending:1});
  assert.equal(last.applicants[0].status,'pending');
  assert.equal(last.applicants[0].answers_recorded,true);
  assert.equal(last.applicants[0].interview,null);
  assert.equal(last.applicants[0].week1_plan,null);
  assert.equal(last.applicants[0].week1_plan_unreadable,false);
  assert.ok(many.data.cycles.slice(1).every((c:any)=>c.applicants.length===1 && c.applicant_counts.pending===1));
  db.exec('DROP TABLE spinout_application_interviews; DROP TABLE spinout_week1_plans');
  const degraded = await call(db,'/api/admin/cohort/applications');
  assert.equal(degraded.data.cycles[0].applicants[0].answers_recorded,true);
  assert.equal(degraded.data.cycles[0].applicants[0].interview,null);
  assert.equal(degraded.data.cycles[0].applicants[0].week1_plan_unreadable,true);
  db.close();
});

test('chase batch rolls back all targets when one insert is refused', async () => {
  const db = fixture();
  for (const id of [1,2]) {
    db.prepare("INSERT INTO projects(id,uid,name,founder_id) VALUES(?,?,'Venture',?)").run(id,`p${id}`,100+id);
    db.prepare("INSERT INTO portfolio_positions(uid,project_id,round_name,invested_amount,position_date) VALUES(?,?,'Seed',100,'2026-01-01')").run(`pos${id}`,id);
    // A zero-day duty keeps the completed period due on every date.
    db.prepare("INSERT INTO reporting_duties(closing_id,closing_line_id,closing_line_uid,project_id,holder_user_id,kind,cadence,due_rule,due_days,source_document,source_clause,source_kind,starts_on,status) VALUES(1,?,?,?,1,'quarterly_kpi','quarterly','after_end',0,'IRA','1','closing_template','2026-01-01','active')").run(id,`l${id}`,id);
  }
  db.exec("CREATE TRIGGER refuse_second BEFORE INSERT ON portfolio_update_chases WHEN NEW.project_id = 2 BEGIN SELECT RAISE(ABORT,'synthetic refusal'); END");
  const refused = await call(db,'/api/portfolio/chase',{project_ids:[1,2]},400);
  assert.match(refused.data.detail,/synthetic refusal/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_update_chases').get() as any).n,0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type='portfolio_update_chase'").get() as any).n,0);
  db.close();
});

test('ineligible targets do not depend on the chase log being readable', async () => {
  const db = fixture();
  db.exec("INSERT INTO projects(id,uid,name,founder_id) VALUES(1,'p1','Synthetic',101)");
  db.exec('DROP TABLE portfolio_update_chases');
  const result = await call(db,'/api/portfolio/chase',{project_ids:[1]});
  assert.deepEqual(result.data.chased,[]);
  assert.deepEqual(result.data.skipped,[1]);
  assert.deepEqual(result.data.skips.map((row:any)=>[row.project_id,row.reason,row.period,row.due_date]),[[1,'no_obligation',null,null]]);
  assert.equal(result.batches,0);
  db.close();
});
