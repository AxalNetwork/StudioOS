/** D944: both mounted reads on real SQLite, uncapped aggregates and source failures. */
import test, { mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminCohort from '../src/routes/admin_cohort.ts';
import { labWeeks } from '../src/routes/admin_lab.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET } from './_esign_harness.ts';

const NOW=Date.UTC(2026,10,3,5,30);
beforeEach(()=>mock.timers.enable({apis:['Date'],now:NOW}));
afterEach(()=>mock.timers.reset());
const baseline=readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8');
const app=new Hono<any>();app.route('/api/admin/cohort',adminCohort);
app.onError((err,c)=>c.json({error:err.message},err.message==='Unauthorized'?401:err.message==='Admin required'?403:500));
function fixture() {
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
  for(const name of ['users','cohort_cycles','cohort_applicants','spinout_applications','company_week_status','week_windows','spinout_lab_milestones','spinout_certificates']){
    const start=baseline.indexOf(`CREATE TABLE ${name} (`);assert.ok(start>=0,name);
    db.exec(baseline.slice(start,baseline.indexOf(');',start)+2));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/315_spinout_application_lifecycle.sql','utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/316_spinout_application_interviews.sql','utf8'));
  db.exec(`INSERT INTO cohort_cycles (id,year,month,start_at,end_at,status,app_status) VALUES
    (10,2026,10,'2026-10-01T04:00:00Z','2026-10-29T04:00:00Z','completed','active'),
    (11,2026,11,'2026-11-01T04:00:00Z','2026-11-29T05:00:00Z','active','active');
    INSERT INTO users (id,role,email,name,is_active) VALUES (900,'admin','admin@example.test','Synthetic Admin',1);`);
  for(let i=1;i<=9;i++){
    db.prepare('INSERT INTO users (id,role,email,name,is_active) VALUES (?, ?, ?, ?, 1)').run(i,'founder',`fixture-${i}@example.test`,`Founder ${i}`);
    const statuses=['activated','pending','pending','approved','waitlisted','rejected','withdrawn','rolled_forward','activated'];
    const answers=i===3?null:JSON.stringify({origin:i===1?'university':i===2?'corporate':'independent',institution:i===1?'Fixture University':null,tto_status:i===1?'negotiating':i===2?'disclosed':'not_applicable',team_size:i===5?8:i});
    db.prepare(`INSERT INTO spinout_applications (id,user_id,company_name,idea,incorporated,stage,status,created_at,answers_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(i,i,i===1?'Northwind Lab':i===3?'Literal %_ Lab':`Company ${i}`,i===1?'Reconciliation research':'Synthetic idea',i===4?'yes':'no',i===1?'prototype':'idea','pending',i===1?'2026-11-02 04:30:00':`2026-10-${String(i+10).padStart(2,'0')} 12:00:00`,answers);
    db.prepare('INSERT INTO cohort_applicants (id,application_id,user_id,cohort_cycle_id,status,created_at,decided_at) VALUES (?,?,?,10,?,?,?)').run(i,i,i,statuses[i-1],`2026-10-${String(i).padStart(2,'0')} 12:00:00`,i===5?'2026-10-30 10:00:00':null);
  }
  db.exec(`INSERT INTO cohort_applicants (id,application_id,user_id,cohort_cycle_id,status,rolled_from_cycle_id,created_at) VALUES (18,8,8,11,'pending',10,'2026-11-01 04:00:00');
    INSERT INTO spinout_application_interviews (id,application_id,user_id,scheduled_at,status) VALUES (1,2,2,'2026-10-20 12:00:00','cancelled'),(2,2,2,'2026-11-05 15:00:00','scheduled');
    INSERT INTO company_week_status (user_id,cohort_cycle_id,week_number,status) VALUES (1,10,1,'passed'),(1,10,4,'passed'),(9,10,1,'failed'),(9,10,2,'grace'),(9,10,3,'grace');
    INSERT INTO spinout_lab_milestones (user_id,week,milestone_key,completed_at) VALUES (1,4,'incorporation_completed','2026-10-28 12:00:00');
    INSERT INTO spinout_certificates (user_id,credential_id,public_token,public_name,public_company,public_cohort,public_issued_on,status) VALUES
      (1,'fixture-cert','fixture-token','Synthetic graduate','Northwind Lab','October 2026 Cohort','2026-10-29','issued');`);
  for(let w=1;w<=4;w++)db.prepare('INSERT INTO week_windows (cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES (10,?,?,?)').run(w,`2026-10-${String(1+(w-1)*7).padStart(2,'0')} 04:00:00`,`2026-10-${String(1+w*7).padStart(2,'0')} 04:00:00`);
  db.exec("UPDATE cohort_applicants SET created_at='2026-09-01 12:00:00' WHERE id=5");
  const env:any={JWT_SECRET,ENVIRONMENT:'development',DB:d1Over(db)};
  const call=async(path:string,who:number|null=900)=>{
    const headers:Record<string,string>={};
    if(who)headers.Authorization=`Bearer ${await new SignJWT({user_id:who,role:who===900?'admin':'founder'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
    const r=await app.request(`/api/admin/cohort${path}`,{headers},env);return{status:r.status,body:await r.json() as any};
  };
  return{db,env,call};
}
const october=(r:any)=>r.body.blocks.cohorts.items.find((c:any)=>c.cohort==='2026-10');

test('D944: cohort counts use uncapped pool records; grants and distinct grace counts are not conflated',async()=>{
  const f=fixture();const r=await f.call('/overview?cohort=2026-10');assert.equal(r.status,200);
  const c=october(r);
  for(const [k,v] of Object.entries({applied:9,approved:3,undecided:2,waiting:1,interview_set:1,waitlisted:1,declined:1,withdrawn:1,carried_forward:1,started:2,in_grace:1,incorporated:1,certificates_issued:1}))assert.deepEqual(c[k],{available:true,value:v},k);
  const november=r.body.blocks.cohorts.items.find((c:any)=>c.cohort==='2026-11');assert.equal(november.carried_in.value,1);
  assert.equal(c.weeks.items[0].passed,1);assert.equal(c.weeks.items[0].failed,1);assert.equal(c.weeks.items[3].passed,1);
  assert.equal(c.weeks.items[0].reached.recorded,false);
  assert.equal(c.interviewed.recorded,false);assert.match(c.interviewed.reason,/does not prove/);
  assert.equal(r.body.blocks.funnel.cohort,'2026-10');assert.equal(r.body.blocks.funnel.steps.started_week_1.value,2);assert.equal(r.body.blocks.funnel.steps.passed_week_4.value,1);
  f.db.close();
});

test('D944: ET weekly submissions exclude carry duplicates, future times and drafts; the current week is partial',async()=>{
  const f=fixture();
  const r=await f.call('/overview');const items=r.body.blocks.applications_per_week.items;
  assert.equal(items.length,12);assert.equal(items.filter((x:any)=>x.partial).length,1);assert.equal(items[11].partial,true);
  // 04:30Z Monday 2 Nov is Sunday 1 Nov 23:30 EST, not Monday.
  assert.equal(items[10].applied,1);assert.equal(items[11].applied,0);
  assert.equal(items.reduce((n:number,x:any)=>n+x.applied,0),9);
  f.db.prepare("UPDATE spinout_applications SET created_at='2026-11-04 12:00:00' WHERE id=1").run();
  const future=await f.call('/overview');assert.equal(future.body.blocks.applications_per_week.items.reduce((n:number,x:any)=>n+x.applied,0),8);
  f.db.close();
});

test('D944: ET week boundaries cross both DST changes and the year boundary correctly',()=>{
  const fall=labWeeks(Date.UTC(2026,10,3));assert.equal(fall[10].end,fall[11].start);assert.equal(fall[10].start,'2026-10-26T04:00:00.000Z');assert.equal(fall[10].end,'2026-11-02T05:00:00.000Z');
  const spring=labWeeks(Date.UTC(2026,2,10));assert.equal((Date.parse(spring[10].end)-Date.parse(spring[10].start))/3600000,167);
  assert.equal(labWeeks(Date.UTC(2027,0,1,1))[11].start,'2026-12-28T05:00:00.000Z');
});

for(const table of ['cohort_applicants','spinout_application_interviews','company_week_status','week_windows','spinout_lab_milestones','spinout_certificates','cohort_cycles'])test(`D944: ${table} failure stays in its own blocks`,async()=>{
  const f=fixture();f.db.exec(`DROP TABLE ${table}`);
  const r=await f.call('/overview?cohort=2026-10');assert.equal(r.status,200);assert.equal(r.body.blocks.applications_per_week.available,true);
  if(table==='cohort_cycles'){assert.equal(r.body.blocks.cohorts.available,false);assert.equal(r.body.blocks.funnel.available,false);}
  else{
    const c=october(r);
    const k=({cohort_applicants:'applied',spinout_application_interviews:'interview_set',company_week_status:'in_grace',week_windows:'weeks',spinout_lab_milestones:'incorporated',spinout_certificates:'certificates_issued'} as any)[table];
    assert.equal(c[k].available,false);assert.ok(c[k].reason);assert.equal(c[k].value,undefined);
    if(table!=='cohort_applicants')assert.equal(c.applied.value,9);
    if(!['cohort_applicants','company_week_status','week_windows'].includes(table))assert.equal(c.weeks.available,true);
  }
  f.db.close();
});

test('D944: a failed weekly submission read leaves the cohort pool and outcomes readable',async()=>{
  const f=fixture();f.db.exec('DROP TABLE spinout_applications');const r=await f.call('/overview');
  assert.equal(r.body.blocks.applications_per_week.available,false);assert.equal(october(r).applied.value,9);assert.equal(october(r).weeks.available,true);f.db.close();
});

test('D944: ambiguous incorporation attribution is Not recorded; declarations and revoked certificates are not formation counts',async()=>{
  const f=fixture();f.db.exec("INSERT INTO cohort_applicants (application_id,user_id,cohort_cycle_id,status) VALUES (1,1,11,'activated'); UPDATE spinout_certificates SET status='revoked'");
  const c=october(await f.call('/overview'));assert.equal(c.incorporated.recorded,false);assert.equal(c.incorporated.value,undefined);assert.equal(c.certificates_issued.value,0);f.db.close();
});

test('D944: server filtering covers every SL2 filter without reusing capped browser lists',async()=>{
  const f=fixture();
  for(const [q,ids] of [
    ['status=waiting',[18,3]],['status=interview_set',[2]],['status=started',[9,1]],['status=declined',[6]],
    ['origin=university',[1]],['origin=unknown',[3]],['tech_transfer=negotiating',[1]],['tech_transfer=unknown',[3]],
    ['stage=prototype',[1]],['incorporated=yes',[4]],['interview=scheduled',[2]],['interview=cancelled',[]],
    ['carried_forward=yes',[18]],['carried_forward=no&cohort=2026-11',[]],['cohort=2026-11',[18]],
    ['q=Fixture%20University',[1]],['q=Reconciliation',[1]],['q=Founder%202',[2]],['q=%25_',[3]],
  ] as Array<[string,number[]]>){
    const r=await f.call(`/applications/list?${q}`);assert.equal(r.status,200,q);assert.equal(r.body.available,true,q);
    assert.deepEqual(r.body.items.map((x:any)=>x.id).sort((a:number,b:number)=>a-b),[...ids].sort((a,b)=>a-b),q);assert.equal(r.body.total,ids.length,q);
  }
  f.db.close();
});

test('D944: all four sorts paginate deterministically; unknown answers do not become independent founders or zero-size teams',async()=>{
  const f=fixture();
  const waiting=await f.call('/applications/list?cohort=2026-10&sort=waiting_longest&limit=3');assert.deepEqual(waiting.body.items.map((x:any)=>x.id),[2,3,5]);
  const newest=await f.call('/applications/list?sort=newest&limit=1');assert.equal(newest.body.items[0].id,1);
  const company=await f.call('/applications/list?sort=company&limit=1');assert.equal(company.body.items[0].id,2);
  const team=await f.call('/applications/list?sort=team_size&limit=1');assert.equal(team.body.items[0].id,9);
  const unknown=await f.call('/applications/list?origin=unknown');assert.equal(unknown.body.items[0].origin,null);assert.equal(unknown.body.items[0].team_size,null);assert.equal(unknown.body.items[0].answers_status,'not_recorded');
  const after=await f.call('/applications/list?limit=2&offset=999');assert.deepEqual(after.body.items,[]);assert.equal(after.body.total,10);
  f.db.close();
});

test('D944: malformed answers are isolated to their row, and SQL-looking search is literal',async()=>{
  const f=fixture();f.db.exec("UPDATE spinout_applications SET answers_json='not json' WHERE id=1");
  const r=await f.call('/applications/list?q=Northwind');assert.equal(r.body.available,true);assert.equal(r.body.items[0].answers_status,'unreadable');assert.equal(r.body.items[0].origin,null);
  const attack=await f.call('/applications/list?q='+encodeURIComponent("' OR 1=1 --"));assert.equal(attack.body.total,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get()!.n,10);f.db.close();
});

test('D944: page totals and overview pools stay uncapped beyond 200 rows',async()=>{
  const f=fixture();
  for(let n=100;n<325;n++){
    f.db.prepare("INSERT INTO spinout_applications (id,user_id,company_name,idea,status) VALUES (?,1,'Additional synthetic company','Synthetic','pending')").run(n);
    f.db.prepare("INSERT INTO cohort_applicants (application_id,user_id,cohort_cycle_id,status) VALUES (?,1,10,'pending')").run(n);
  }
  const r=await f.call('/applications/list?cohort=2026-10&offset=220&limit=25');assert.equal(r.body.total,234);assert.equal(r.body.items.length,14);
  assert.equal(october(await f.call('/overview')).applied.value,234);f.db.close();
});

test('D944: application failure reports unknown total, and invalid filters are refused',async()=>{
  const f=fixture();
  for(const q of ['status=bogus','sort=DROP','cohort=2026-13','origin=bogus','tech_transfer=bogus','interview=completed','limit=1x','offset=-1','offset=99999999999999999'])assert.equal((await f.call('/applications/list?'+q)).status,400,q);
  assert.equal((await f.call('/overview?cohort=2026-00')).status,400);
  f.db.exec('DROP TABLE spinout_applications');const r=await f.call('/applications/list');assert.equal(r.status,200);assert.equal(r.body.available,false);assert.equal(r.body.total,null);assert.equal(r.body.items,null);f.db.close();
});

test('D944: both reads require admin authorization',async()=>{
  const f=fixture();for(const path of ['/overview','/applications/list']){assert.equal((await f.call(path,null)).status,401);assert.equal((await f.call(path,1)).status,403);}f.db.close();
});

test('D944: empty stores are readable zeros, but absence of a selected cohort is not a zero funnel',async()=>{
  const f=fixture();f.db.exec('DELETE FROM cohort_applicants; DELETE FROM spinout_applications');
  const r=await f.call('/overview?cohort=2099-01');assert.equal(october(r).applied.value,0);assert.equal(r.body.blocks.funnel.available,false);
  const page=await f.call('/applications/list');assert.equal(page.body.available,true);assert.deepEqual(page.body.items,[]);assert.equal(page.body.total,0);f.db.close();
});

test('D944: cohort counts and selected funnels include cohorts beyond the old twelve-cycle cap',async()=>{
  const f=fixture();
  for(let month=1;month<=12;month++)f.db.prepare("INSERT INTO cohort_cycles (year,month,start_at,end_at) VALUES (2025,?, '2025-01-01T05:00:00Z', '2025-01-29T05:00:00Z')").run(month);
  const r=await f.call('/overview?cohort=2025-01');assert.equal(r.body.blocks.cohorts.items.length,14);assert.equal(r.body.blocks.funnel.cohort,'2025-01');assert.equal(r.body.blocks.funnel.steps.applied.value,0);f.db.close();
});

test('D944: pre-cohort incorporation milestones are not attributed to a later activation',async()=>{
  const f=fixture();f.db.exec("UPDATE spinout_lab_milestones SET completed_at='2026-09-01 00:00:00'");
  assert.equal(october(await f.call('/overview')).incorporated.value,0);f.db.close();
});

test('D944: a failed D1 result and a malformed week timestamp stay visibly unreadable',async()=>{
  const f=fixture();const original=f.env.DB;
  f.env.DB={...original,prepare(sql:string){const st=original.prepare(sql);if(sql.includes('FROM spinout_certificates'))st.all=async()=>({success:false,results:[]});return st;}};
  f.db.exec("UPDATE week_windows SET unlock_at='not a date' WHERE week_number=1");
  const c=october(await f.call('/overview'));assert.equal(c.certificates_issued.available,false);assert.equal(c.certificates_issued.value,undefined);assert.equal(c.weeks.items[0].state,'unreadable');assert.equal(c.applied.value,9);f.db.close();
});

test('D944: ET week intervals are half-open, and a future cohort is not the default funnel',async()=>{
  const f=fixture();f.db.exec("UPDATE spinout_applications SET created_at='2026-11-02 05:00:00' WHERE id=1; INSERT INTO cohort_cycles (year,month,start_at,end_at) VALUES (2027,1,'2027-01-01T05:00:00Z','2027-01-29T05:00:00Z')");
  const r=await f.call('/overview');const w=r.body.blocks.applications_per_week.items;
  assert.equal(w[10].applied,0);assert.equal(w[11].applied,1);assert.equal(r.body.blocks.funnel.cohort,'2026-11');f.db.close();
});

test('D944: large application pages respect D1’s per-row size limit instead of aggregating the page into one row',async()=>{
  const f=fixture();
  const answers=JSON.stringify({origin:'independent',team_size:2,why_axal:'例'.repeat(4000),traction:'例'.repeat(4000),team_roles:'例'.repeat(2000)});
  for(let n=500;n<600;n++){
    f.db.prepare("INSERT INTO spinout_applications (id,user_id,company_name,idea,answers_json) VALUES (?,1,'Large payload',?,?)").run(n,'例'.repeat(5000),answers);
    f.db.prepare("INSERT INTO cohort_applicants (application_id,user_id,cohort_cycle_id,status) VALUES (?,1,10,'pending')").run(n);
  }
  const original=f.env.DB;
  f.env.DB={...original,prepare(sql:string){const st=original.prepare(sql);const all=st.all.bind(st);st.all=async()=>{
    const result=await all();for(const row of result.results)if(new TextEncoder().encode(JSON.stringify(row)).length>2*1024*1024)throw new Error('D1 row exceeds 2 MiB');return result;
  };return st;}};
  const r=await f.call('/applications/list?q=Large%20payload&limit=100');assert.equal(r.body.available,true);assert.equal(r.body.total,100);assert.equal(r.body.items.length,100);assert.equal(r.body.items[0].answers.why_axal.length,4000);f.db.close();
});

test('D944: a pool-summary query failure does not discard independently readable waiting and interview counts',async()=>{
  const f=fixture();const original=f.env.DB;
  f.env.DB={...original,prepare(sql:string){const st=original.prepare(sql);if(sql.includes('COUNT(*) AS applied'))st.all=async()=>{throw new Error('synthetic pool summary failure');};return st;}};
  const c=october(await f.call('/overview'));assert.equal(c.applied.available,false);assert.equal(c.waiting.value,1);assert.equal(c.interview_set.value,1);assert.equal(c.weeks.available,true);f.db.close();
});
