// D1614 W1: real SQLite and authenticated Hono, prepared schema until S1
// assigns the production migration. No external providers or production rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import engine, { agentEngineEnabled } from '../src/routes/agent_engine.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { workBoardRoutes } from '../src/routes/work_board.ts';
import { projectBoard, setWorkDeps, updateWorkTask, WorkRefusal, type WorkRunReader, type WorkTask } from '../src/services/agents/workBoard.ts';
import { taskByUid } from '../src/services/agents/tasks.ts';
import { loadScope } from '../src/services/agents/teams.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`,import.meta.url),'utf8');
const baseline = sql('schema_baseline.sql');
const secret = 'fixture'.repeat(12);
test.after(removeMigratedDatabases);
const OWNER=10,MEMBER=11,OTHER=12,STRANGER=13;
// The E3 run-reader contract is injected; W1 never creates or guesses E3's
// future production table. Synthetic rows below prove its DTO contract.
const runReader: WorkRunReader = async (env,taskIds) => {
  const exists=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_task_runs'").first();
  if(!exists) return new Map();
  const rows=await env.DB.prepare(`SELECT * FROM (SELECT r.task_id,r.uid,r.status,r.started_at,r.ended_at,l.charged_microusd,
    ROW_NUMBER() OVER (PARTITION BY r.task_id ORDER BY r.attempt DESC,r.id DESC) AS row_num,
    SUM(l.charged_microusd) OVER (PARTITION BY r.task_id) AS total_cost,
    SUM(CASE WHEN l.charged_microusd IS NULL THEN 1 ELSE 0 END) OVER (PARTITION BY r.task_id) AS missing_cost
    FROM agent_task_runs r LEFT JOIN ai_usage_logs l ON l.id=r.usage_log_id WHERE r.task_id IN (SELECT value FROM json_each(?))) WHERE row_num=1`)
    .bind(JSON.stringify(taskIds)).all();
  return new Map((rows.results??[]).map((r:any)=>[r.task_id,r]));
};
function world() {
  const {DB,db}=makeD1(['users','company_profiles','user_company_links','projects','roadmap_okrs'].map(t=>stripForeignKeys(tableFromBaseline(baseline,t))).join('\n')+AI_LOG_SCHEMA+sql('migrations/506_ai_rail_proposals.sql'));
  addColumnsFrom(db,sql('migrations/597_company_archive_and_events.sql'),'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  db.exec(readFileSync(new URL('./fixtures/work_board_3969.sql',import.meta.url),'utf8'));
  db.exec(`CREATE TABLE project_members (id INTEGER PRIMARY KEY,project_id INTEGER,user_id INTEGER,role TEXT,status TEXT,created_at TEXT,updated_at TEXT)`);
  for(const [id,name,role,founder] of [[OWNER,'Pat Owner','founder',100],[MEMBER,'Max Member','founder',101],[OTHER,'Ali Other','founder',102],[STRANGER,'Sam Stranger','founder',103]])
    db.prepare("INSERT INTO users (id,uid,email,name,role,founder_id,subscription_tier,subscription_status) VALUES (?,?,?,?,?,?,'growth','active')").run(id,`u-${id}`,`fixture-${id}@example.test`,name,role,founder);
  db.exec("INSERT INTO company_profiles (id,uid,company_name) VALUES (1,'co-one','Company One')");
  db.exec("INSERT INTO user_company_links (uid,user_id,company_id,role_in_company) VALUES ('link-owner',10,1,'Founder')");
  db.exec("INSERT INTO projects (id,uid,name,founder_id,company_id) VALUES (7,'p-seven','Project Seven',100,1),(8,'p-eight','Project Eight',100,NULL)");
  db.exec("INSERT INTO project_members (project_id,user_id,role,status) VALUES (7,11,'advisor','accepted'),(7,12,'advisor','accepted')");
  const env:any={DB,JWT_SECRET:secret,ENVIRONMENT:'development',AGENT_ENGINE:'on',TEAM_AGENTS_ENABLED:'true'};
  const app=new Hono(); app.route('/api/teams',workBoardRoutes(agentEngineEnabled,runReader));app.route('/api/teams',engine);app.route('/api/teams',teamAgents);
  return {DB,db,env,app};
}
type W=ReturnType<typeof world>;
async function call(w:W,who:number|null,method:string,path:string,b?:unknown) {
  const token=who===null?null:await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const r=await w.app.request(`/api/teams${path}`,{method,headers:{'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:b===undefined?undefined:JSON.stringify(b)},w.env);
  return {status:r.status,body:await r.json() as any};
}
async function create(w:W,b:any={},project=7) {
  const r=await call(w,OWNER,'POST',`/project/${project}/tasks`,{title:'Prepare launch',...b});
  assert.equal(r.status,201,JSON.stringify(r.body)); return r.body.task;
}
const raw=async(w:W,uid:string)=>(await taskByUid(w.env,uid)) as WorkTask;
const user=(w:W,id=OWNER)=>w.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
const close=(w:W,uid:string,reason='completed',extra={})=>call(w,OWNER,'PATCH',`/tasks/${uid}`,{state:'closed',close_reason:reason,...extra});

test('board gates, engine flags and project-only boundary; company E1 tasks still work',async()=>{
  const w=world();try{
    assert.equal((await call(w,null,'GET','/project/7/work/board')).status,401);
    assert.equal((await call(w,STRANGER,'GET','/project/7/work/board')).status,403);
    assert.equal((await call(w,MEMBER,'GET','/project/7/work/board')).status,200);
    assert.equal((await call(w,MEMBER,'POST','/project/7/tasks',{title:'No'})).status,403);
    assert.equal((await call(w,OWNER,'GET','/company/co-one/work/board')).status,404);
    const co=await call(w,OWNER,'POST','/company/co-one/tasks',{title:'Existing company task'});
    assert.equal(co.status,201);
    assert.equal((await call(w,OWNER,'PATCH',`/tasks/${co.body.task.uid}/move`,{column:'ready'})).status,404);
    for(const change of [{AGENT_ENGINE:'off'},{AGENT_ENGINE:undefined},{TEAM_AGENTS_ENABLED:'false'}]){
      const env={...w.env};Object.assign(w.env,change);
      const r=await call(w,OWNER,'GET','/project/7/work/board');assert.deepEqual([r.status,r.body.error],[404,'agent_engine_off']);Object.assign(w.env,env);
    }
  }finally{w.db.close();}
});

test('numbering is per project and concurrent creates are distinct; body, type, estimates, labels, order and filters persist',async()=>{
  const w=world();try{
    const a=await create(w,{title:'Alpha',body:'Markdown **launch**',type:'feature',estimate_points:0,position:2,labels:['finance']});
    const b=await create(w,{title:'Beta',estimate_points:3,position:1});
    const other=await create(w,{title:'Other project'},8);
    const [c,d]=await Promise.all([create(w,{title:'Concurrent C'}),create(w,{title:'Concurrent D'})]);
    assert.deepEqual([a.task_number,b.task_number,other.task_number],[1,2,1]);assert.notEqual(c.task_number,d.task_number);
    const board=(await call(w,OWNER,'GET','/project/7/work/board')).body;
    assert.deepEqual(board.items.map((t:any)=>t.title),['Concurrent C','Concurrent D','Beta','Alpha']);
    const backlog=board.columns.find((c:any)=>c.key==='backlog');assert.equal(backlog.count,4);assert.equal(backlog.estimate_points,null);
    assert.deepEqual([a.body,a.type,a.estimate_points,a.labels],['Markdown **launch**','feature',0,['finance']]);
    const filtered=(await call(w,OWNER,'GET','/project/7/work/board?filter=label%3Afinance')).body;
    assert.equal(filtered.count,1);assert.equal(filtered.columns.find((c:any)=>c.key==='backlog').estimate_points,0);
    assert.ok(!JSON.stringify(board).includes('@example.test'));assert.ok(!JSON.stringify(board).includes('assignee_user_id'));
    assert.equal(board.items.some((t:any)=>t.uid===other.uid),false);
    assert.equal(a.cost.available,false);assert.equal(a.run,null);
    assert.equal((await call(w,OWNER,'GET','/project/7/work/board?filter=secret%3Aabc')).status,400);
  }finally{w.db.close();}
});

test('a person moves only their own item; a move keeps E1 status consistent and records the actor atomically',async()=>{
  const w=world();try{
    const a=await create(w,{assignee:{kind:'person',uid:`u-${MEMBER}`}}),b=await create(w);
    const moved=await call(w,MEMBER,'PATCH',`/tasks/${a.uid}/move`,{column:'in_review',position:4});
    assert.equal(moved.status,200);assert.deepEqual([moved.body.task.column,moved.body.task.status,moved.body.task.position],['in_review','waiting_decision',4]);
    assert.equal((await call(w,OTHER,'PATCH',`/tasks/${a.uid}/move`,{column:'ready'})).status,403);
    assert.equal((await call(w,MEMBER,'PATCH',`/tasks/${b.uid}/move`,{column:'ready'})).status,403);
    assert.equal((await call(w,MEMBER,'PATCH',`/tasks/${a.uid}`,{title:'Unauthorized'})).status,403);
    const event=w.db.prepare("SELECT * FROM scope_task_events WHERE task_id=? AND kind='moved'").get((await raw(w,a.uid)).id) as any;
    assert.equal(event.actor_user_id,MEMBER);assert.equal(event.actor_agent_id,null);assert.deepEqual([JSON.parse(event.detail_json).from,JSON.parse(event.detail_json).to],['backlog','in_review']);
    const previous=await raw(w,a.uid);
    await updateWorkTask(w.env,previous,{column:'backlog'},{user:user(w)});
    await assert.rejects(()=>updateWorkTask(w.env,previous,{column:'ready'},{user:user(w)}),(e:any)=>e.code==='task_changed');
    assert.equal((await raw(w,a.uid)).board_column,'backlog');
  }finally{w.db.close();}
});

test('close reasons, reopening and duplicates stay in the project; malformed fields cannot bypass state rules',async()=>{
  const w=world();try{
    const a=await create(w),b=await create(w),elsewhere=await create(w,{},8);
    assert.equal((await close(w,a.uid,'duplicate')).status,400);
    assert.equal((await close(w,a.uid,'duplicate',{duplicate_of:elsewhere.uid})).status,400);
    const dup=await close(w,a.uid,'duplicate',{duplicate_of:b.uid});
    assert.equal(dup.status,200);assert.deepEqual([dup.body.task.state,dup.body.task.status,dup.body.task.close_reason,dup.body.task.duplicate_of.uid],['closed','cancelled','duplicate',b.uid]);
    const open=await call(w,OWNER,'PATCH',`/tasks/${a.uid}`,{state:'open'});
    assert.deepEqual([open.body.task.column,open.body.task.close_reason,open.body.task.duplicate_of],['backlog',null,null]);
    const completed=await close(w,a.uid);assert.deepEqual([completed.body.task.status,completed.body.task.close_reason],['done','completed']);
    for(const patch of [{estimate_points:-1},{position:'2'},{labels:['x'.repeat(81)]},{type:'secret'},{column:'done',status:'open'},{task_number:999},{actor_agent_id:1}])
      assert.equal((await call(w,OWNER,'PATCH',`/tasks/${b.uid}`,patch)).status,400,JSON.stringify(patch));
  }finally{w.db.close();}
});

test('blockers refuse readiness and work for people and assigned agents; only final completion unblocks and notifies',async()=>{
  const w=world();try{
    const a=await create(w,{title:'First blocker'}),b=await create(w,{title:'Last blocker'}),waiting=await create(w,{assignee:{kind:'person',uid:`u-${MEMBER}`}});
    const deps=await call(w,OWNER,'PUT',`/tasks/${waiting.uid}/deps`,{depends_on:[a.uid,b.uid]});assert.equal(deps.status,200);
    for(const column of ['ready','in_progress']) {
      const r=await call(w,MEMBER,'PATCH',`/tasks/${waiting.uid}/move`,{column});
      assert.deepEqual([r.status,r.body.error],[409,'task_blocked']);assert.deepEqual(r.body.blockers.map((b:any)=>b.task_number),[a.task_number,b.task_number]);
    }
    await close(w,a.uid);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM scope_task_events WHERE kind='unblocked'").get().n,0);
    const notifications:any[]=[];
    await updateWorkTask(w.env,await raw(w,b.uid),{state:'closed',close_reason:'completed'},{user:user(w)},async(_env,args)=>{notifications.push(args);});
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM scope_task_events WHERE kind='unblocked'").get().n,1);
    assert.equal(notifications.length,1);assert.equal(notifications[0].userId,MEMBER);assert.equal(notifications[0].payload.task_uid,waiting.uid);
    assert.equal((await call(w,MEMBER,'PATCH',`/tasks/${waiting.uid}/move`,{column:'ready'})).status,200);
  }finally{w.db.close();}
});

test('not planned or duplicate never unblocks; dependencies reject cross-project ids and cycles',async()=>{
  const w=world();try{
    const a=await create(w),b=await create(w),c=await create(w),other=await create(w,{},8);
    assert.equal((await call(w,OWNER,'PUT',`/tasks/${b.uid}/deps`,{depends_on:[a.uid]})).status,200);
    assert.equal((await call(w,OWNER,'PUT',`/tasks/${a.uid}/deps`,{depends_on:[b.uid]})).body.error,'dependency_cycle');
    assert.equal((await call(w,OWNER,'PUT',`/tasks/${c.uid}/deps`,{depends_on:[other.uid]})).body.error,'cross_scope');
    assert.equal((await close(w,a.uid,'not_planned')).status,200);
    const e=w.db.prepare("SELECT kind,detail_json FROM scope_task_events WHERE task_id=? AND kind='dependency_incomplete'").get((await raw(w,b.uid)).id) as any;
    assert.equal(JSON.parse(e.detail_json).unblocks,false);
    assert.equal((await call(w,OWNER,'PATCH',`/tasks/${b.uid}/move`,{column:'ready'})).body.error,'task_blocked');
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM scope_task_events WHERE kind='unblocked'").get().n,0);
    const r=await call(w,OWNER,'PATCH',`/tasks/${a.uid}`,{state:'open'});assert.equal(r.status,200);
    await close(w,a.uid,'duplicate',{duplicate_of:c.uid});
    assert.equal((await call(w,OWNER,'PATCH',`/tasks/${b.uid}/move`,{column:'in_progress'})).body.error,'task_blocked');
    // A later correction to completed, without a reopen, really does unblock.
    const corrected=await close(w,a.uid,'completed');assert.equal(corrected.status,200);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM scope_task_events WHERE kind='unblocked'").get().n,1);
  }finally{w.db.close();}
});

test('an assigned agent moves within its work, cannot close, cannot take a blocked item, and is named in events',async()=>{
  const w=world();try{
    const made=await call(w,OWNER,'POST','/project/7/agents',{role_key:'cfo',first_name:'Carla',last_name:'Cash',model_id:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',monthly_cap_microusd:5000000});
    assert.equal(made.status,201,JSON.stringify(made.body));
    const agent=made.body.agent.uid,agentId=w.db.prepare('SELECT id FROM team_agents WHERE uid=?').get(agent).id as number;
    const a=await create(w,{module:'use-of-funds',assignee:{kind:'agent',uid:agent}});
    const moved=await updateWorkTask(w.env,await raw(w,a.uid),{column:'in_progress'},{agentId});assert.equal(moved.status,'in_progress');
    await assert.rejects(()=>updateWorkTask(w.env,moved,{column:'done'},{agentId}),(e:any)=>e instanceof WorkRefusal&&e.code==='agent_cannot_close');
    await assert.rejects(()=>updateWorkTask(w.env,moved,{status:'done'},{agentId}),(e:any)=>e.code==='agent_cannot_close');
    const ev=w.db.prepare("SELECT actor_agent_id FROM scope_task_events WHERE task_id=? AND kind='moved'").get(moved.id) as any;assert.equal(ev.actor_agent_id,agentId);
    const blocker=await create(w),waiting=await create(w,{module:'use-of-funds'});
    await call(w,OWNER,'PUT',`/tasks/${waiting.uid}/deps`,{depends_on:[blocker.uid]});
    assert.equal((await call(w,OWNER,'PATCH',`/tasks/${waiting.uid}`,{assignee:{kind:'agent',uid:agent}})).body.error,'task_blocked');
    await call(w,OWNER,'PUT',`/tasks/${a.uid}/deps`,{depends_on:[blocker.uid]});
    await assert.rejects(async()=>updateWorkTask(w.env,await raw(w,a.uid),{column:'ready'},{agentId}),(e:any)=>e.code==='task_blocked');
    const board=await projectBoard(w.env,(await loadScope(w.env,'project','7')) as any);
    const card=board.items.find((c)=>c.uid===a.uid)!;assert.equal(card.ready,false);assert.equal(card.assignee.kind,'agent');
  }finally{w.db.close();}
});

test('two simultaneous final blockers produce one unblock; stale dependency edits and concurrent cycles write no partial graph',async()=>{
  const w=world();try{
    const a=await create(w),b=await create(w),waiting=await create(w);
    await call(w,OWNER,'PUT',`/tasks/${waiting.uid}/deps`,{depends_on:[a.uid,b.uid]});
    await Promise.all([close(w,a.uid),close(w,b.uid)]);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM scope_task_events WHERE kind='unblocked'").get().n,1);
    const x=await create(w),y=await create(w);
    const results=await Promise.allSettled([setWorkDeps(w.env,await raw(w,x.uid),[y.uid],user(w)),setWorkDeps(w.env,await raw(w,y.uid),[x.uid],user(w))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM scope_task_deps WHERE task_id IN (?,?)').get((await raw(w,x.uid)).id,(await raw(w,y.uid)).id).n,1);
    const old=await raw(w,waiting.uid);
    await call(w,OWNER,'PATCH',`/tasks/${waiting.uid}`,{title:'New title'});
    await assert.rejects(()=>setWorkDeps(w.env,old,[],user(w)),(e:any)=>e.code==='task_changed');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM scope_task_deps WHERE task_id=?').get(old.id).n,2);
  }finally{w.db.close();}
});

test('audit failure rolls back the move; a blocker added after validation is checked again inside the write',async()=>{
  const w=world();try{
    const a=await create(w),blocker=await create(w),t=await raw(w,a.uid);
    // Fault only the batch's event insert; the real SQLite batch must roll back.
    const DB=w.env.DB;
    w.env.DB={...DB,batch:async(statements:any[])=>DB.batch([...statements,DB.prepare('INSERT INTO missing_audit_table VALUES (1)')])};
    const refused=await call(w,OWNER,'PATCH',`/tasks/${a.uid}/move`,{column:'ready'});assert.equal(refused.status,500);
    w.env.DB=DB;assert.equal((await raw(w,a.uid)).work_version,t.work_version);assert.equal((await raw(w,a.uid)).board_column,'backlog');
    w.env.DB={...DB,batch:async(statements:any[])=>{
      w.db.prepare('INSERT INTO scope_task_deps (task_id,depends_on_task_id) VALUES (?,?)').run(t.id,(await raw(w,blocker.uid)).id);
      return DB.batch(statements);
    }};
    const blocked=await call(w,OWNER,'PATCH',`/tasks/${a.uid}/move`,{column:'in_progress'});
    assert.deepEqual([blocked.status,blocked.body.error],[409,'task_blocked']);
    w.env.DB=DB;assert.equal(w.db.prepare("SELECT COUNT(*) n FROM scope_task_events WHERE task_id=? AND kind='moved'").get(t.id).n,0);
  }finally{w.db.close();}
});

test('parent references are scoped and acyclic; database CHECKs preserve the status/column/close invariants',async()=>{
  const w=world();try{
    const a=await create(w),b=await create(w),other=await create(w,{},8);
    const linked=await call(w,OWNER,'PATCH',`/tasks/${b.uid}`,{parent_task_id:a.uid});assert.equal(linked.body.task.parent.uid,a.uid);
    assert.equal((await call(w,OWNER,'PATCH',`/tasks/${a.uid}`,{parent_task_id:b.uid})).status,400);
    assert.equal((await call(w,OWNER,'PATCH',`/tasks/${a.uid}`,{parent_task_id:other.uid})).status,400);
    const id=(await raw(w,a.uid)).id;
    assert.throws(()=>w.db.prepare("UPDATE scope_tasks SET board_column='invented' WHERE id=?").run(id));
    assert.throws(()=>w.db.prepare("UPDATE scope_tasks SET board_column='done',status='open' WHERE id=?").run(id));
    assert.throws(()=>w.db.prepare("UPDATE scope_tasks SET close_reason='duplicate' WHERE id=?").run(id));
    assert.throws(()=>w.db.prepare("UPDATE scope_tasks SET task_number=2 WHERE id=?").run(id));
    const child=await create(w,{parent_task_id:a.uid});assert.equal(child.parent.uid,a.uid);
    const [x,y]=[await create(w),await create(w)];
    const [tx,ty]=[await raw(w,x.uid),await raw(w,y.uid)];
    const race=await Promise.allSettled([updateWorkTask(w.env,tx,{parent_task_id:y.uid},{user:user(w)}),updateWorkTask(w.env,ty,{parent_task_id:x.uid},{user:user(w)})]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  }finally{w.db.close();}
});

test('recorded last run status/cost and genuine empty counts; a read failure is never a successful empty board',async()=>{
  const w=world();try{
    const empty=(await call(w,OWNER,'GET','/project/7/work/board')).body;assert.equal(empty.count,0);assert.equal(empty.columns.length,6);
    const a=await create(w);const t=await raw(w,a.uid);
    w.db.exec('CREATE TABLE agent_task_runs (id INTEGER PRIMARY KEY,uid TEXT,task_id INTEGER,attempt INTEGER,status TEXT,started_at TEXT,ended_at TEXT,usage_log_id INTEGER)');
    w.db.prepare("INSERT INTO agent_task_runs VALUES (1,'run-old',?,1,'failed',NULL,NULL,NULL),(2,'run-new',?,2,'waiting_decision',NULL,NULL,NULL)").run(t.id,t.id);
    const card=(await call(w,OWNER,'GET','/project/7/work/board')).body.items[0];
    assert.deepEqual([card.run.uid,card.run.status,card.run.cost.available],['run-new','waiting',false]);
    w.db.exec("INSERT INTO ai_usage_logs (id,user_id,task,model,charged_microusd) VALUES (1,10,'fixture','fixture',0),(2,10,'fixture','fixture',12)");
    w.db.exec('UPDATE agent_task_runs SET usage_log_id=id');
    const recorded=(await call(w,OWNER,'GET','/project/7/work/board')).body.items[0];
    assert.deepEqual([recorded.run.cost,recorded.cost],[{available:true,value_microusd:12},{available:true,value_microusd:12}]);
    // Same number of reads for one or many cards: no per-card D1 queries.
    for(let i=0;i<12;i++) await create(w,{title:`Extra ${i}`});
    let reads=0;const DB=w.env.DB;w.env.DB={...DB,prepare:(sql:string)=>{reads++;return DB.prepare(sql);}};
    await projectBoard(w.env,(await loadScope(w.env,'project','7')) as any,'',runReader);assert.equal(reads,6);w.env.DB=DB;
    w.db.exec('ALTER TABLE scope_tasks RENAME TO unreadable_scope_tasks');
    const bad=await call(w,OWNER,'GET','/project/7/work/board');assert.equal(bad.status,500);assert.equal(bad.body.items,undefined);
  }finally{w.db.close();}
});

test('prepared migration preserves legacy tasks, event ids, deleted-id high water, indexes and foreign keys on the full migrated schema',()=>{
  const db=migratedDatabase();try{
    db.exec("INSERT INTO projects (id,uid,name) VALUES (700,'fixture-project','Fixture Project')");
    db.exec("INSERT INTO scope_tasks (id,uid,scope_kind,project_id,title,status) VALUES (1,'legacy-one','project',700,'Legacy completed','done'),(2,'legacy-two','project',700,'Legacy open','open')");
    db.exec("INSERT INTO scope_task_events (id,task_id,kind) VALUES (5,1,'created'),(100,2,'created'); DELETE FROM scope_task_events WHERE id=100;");
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(readFileSync(new URL('./fixtures/work_board_3969.sql',import.meta.url),'utf8'));
    assert.deepEqual(db.prepare('SELECT title,status,task_number,estimate_points,board_column FROM scope_tasks ORDER BY id').all().map((r:any)=>({...r})),[
      {title:'Legacy completed',status:'done',task_number:1,estimate_points:null,board_column:null},
      {title:'Legacy open',status:'open',task_number:2,estimate_points:null,board_column:null},
    ]);
    assert.equal(db.prepare('SELECT kind FROM scope_task_events WHERE id=5').get().kind,'created');
    const fresh=db.prepare("INSERT INTO scope_task_events (task_id,kind) VALUES (2,'unblocked')").run();assert.ok(Number(fresh.lastInsertRowid)>100);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scope_task_events_task'").get().name,'idx_scope_task_events_task');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.throws(()=>db.prepare("UPDATE scope_tasks SET close_reason='completed' WHERE id=2").run());
  }finally{db.close();}
});

test('a recorded manual block remains visible independently of dependency blockers',async()=>{
  const w=world();try{
    const a=await create(w,{status:'blocked',blocked_reason:'Waiting for a signature'});
    assert.deepEqual([a.blocked,a.blocked_reason,a.ready],[true,'Waiting for a signature',false]);
    const moved=await call(w,OWNER,'PATCH',`/tasks/${a.uid}/move`,{column:'ready'});
    assert.deepEqual([moved.status,moved.body.task.status,moved.body.task.blocked_reason],[200,'open',null]);
  }finally{w.db.close();}
});
