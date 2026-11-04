/** D4423: inert rollout preparation, cohort admission and audited HQ access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { world, ADMIN, SPONSOR, STRANGER, PROJECT, COMPANY, AGENT } from './_agent_engine_fixture.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { engineRefusal } from '../src/agents/engine.ts';
import { engineVar } from '../src/agents/runtime.ts';
import { addToCohort, removeFromCohort, cohortList } from '../src/services/agents/cohort.ts';
import adminRoutes from '../src/routes/admin_ai_agents.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { agentGatewayOption } from '../src/services/aiRouter.ts';
test.after(()=>removeMigratedDatabases());
const P={kind:'project' as const,id:PROJECT};

test('both runtimes admit cohort founders only when listed; admins stay admitted',async()=>{
 for(const runtime of ['do','sdk'] as const){const w=world({engine:'cohort',runtime});try{
  w.agent(AGENT);w.task(200,AGENT);
  assert.equal(engineVar(w.env),'cohort');
  assert.equal((await w.runtime.admit(P,{agentId:AGENT,taskId:200,by:SPONSOR,source:'person'}) as any).code,'engine_paused');
  assert.equal(await engineRefusal(w.env,ADMIN,P),null);
  await addToCohort(w.env,ADMIN,{email:' SPONSOR@EXAMPLE.TEST '});
  assert.equal((await w.runtime.admit(P,{agentId:AGENT,taskId:200,by:SPONSOR,source:'person'})).ok,true);
  assert.equal((await engineRefusal(w.env,STRANGER,P))?.code,'engine_paused');
 }finally{w.close();}}
});

test('cohort supports explicit project/company scopes, removal, unavailable targets, halt and unreadable data',async()=>{
 const w=world({engine:'cohort'});try{
  await addToCohort(w.env,ADMIN,{scope:P});
  assert.equal(await engineRefusal(w.env,null,P),null);
  assert.equal((await engineRefusal(w.env,null,{kind:'project',id:999}))?.code,'engine_paused');
  await addToCohort(w.env,ADMIN,{scope:{kind:'company',id:COMPANY}});
  assert.equal(await engineRefusal(w.env,null,{kind:'company',id:COMPANY}),null);
  w.db.prepare('UPDATE company_profiles SET archived_at=CURRENT_TIMESTAMP WHERE id=?').run(COMPANY);
  assert.equal((await engineRefusal(w.env,null,{kind:'company',id:COMPANY}))?.code,'engine_paused');
  const rows=await cohortList(w.env);await removeFromCohort(w.env,ADMIN,rows.entries.find((r)=>r.kind==='project')!.uid);
  assert.equal((await engineRefusal(w.env,null,P))?.code,'engine_paused');
  await w.kv.put('agents:halt','test');assert.equal((await engineRefusal(w.env,ADMIN,P))?.code,'engine_paused');await w.kv.delete('agents:halt');
  w.db.exec('DROP TABLE agent_engine_cohort');assert.equal((await engineRefusal(w.env,SPONSOR,P))?.code,'engine_paused');
 }finally{w.close();}
});

test('off, canary and on retain admission behavior and a listed user loses access when deactivated',async()=>{
 const w=world({engine:'cohort'});try{
  await addToCohort(w.env,ADMIN,{email:'sponsor@example.test'});
  for(const [mode,who,allowed] of [['off',ADMIN,false],['canary',SPONSOR,false],['canary',ADMIN,true],['on',STRANGER,true],['on',null,true]] as const){w.env.AGENT_ENGINE=mode;assert.equal(await engineRefusal(w.env,who,P)===null,allowed);}
  w.env.AGENT_ENGINE='cohort';w.db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(SPONSOR);
  assert.equal((await engineRefusal(w.env,SPONSOR,P))?.code,'engine_paused');
 }finally{w.close();}
});

test('HQ list/add/remove requires Super Admin and records actor audits without email',async()=>{
 const w=world();try{
  w.db.prepare('INSERT INTO super_admins(user_id) VALUES(?)').run(ADMIN);
  const app=new Hono<any>().route('/api/admin/ai-agents',adminRoutes);
  app.onError((e,c)=>c.json({detail:e.message},(AUTH_ERROR_STATUSES[e.message]||500) as any));
  const call=async(who:number,method:string,path:string,body?:unknown)=>{
   const token=await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
   const res=await app.request('/api/admin/ai-agents'+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined||method==='GET'?{}:{body:JSON.stringify(body)})},w.env);
   return {status:res.status,body:await res.json() as any};
  };
  w.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(STRANGER);
  for(const who of [SPONSOR,STRANGER]) for(const method of ['GET','POST','DELETE'])assert.equal((await call(who,method,method==='DELETE'?'/cohort/not-an-entry':'/cohort',{email:'sponsor@example.test'})).status,403);
  assert.equal((await call(ADMIN,'POST','/cohort',{email:'sponsor@example.test'})).status,201);
  assert.equal((await call(ADMIN,'POST','/cohort',{email:'sponsor@example.test'})).status,201);
  let list=await call(ADMIN,'GET','/cohort');assert.equal(list.body.entries.length,1);assert.doesNotMatch(JSON.stringify(list.body),/@/);
  const uid=list.body.entries[0].uid;assert.equal((await call(ADMIN,'DELETE',`/cohort/${uid}`)).status,200);
  list=await call(ADMIN,'GET','/cohort');assert.equal(list.body.entries.length,0);
  const audit=w.db.prepare("SELECT admin_user_id,action,before_json,after_json,reason FROM ai_admin_audit WHERE action LIKE 'cohort.%' ORDER BY id").all();
  assert.deepEqual(audit.map((r:any)=>r.action),['cohort.add','cohort.add','cohort.remove']);assert.equal(audit.every((r:any)=>r.admin_user_id===ADMIN),true);assert.doesNotMatch(JSON.stringify(audit),/@/);
 }finally{w.close();}
});

test('agent gateway always disables payload logs and cache',()=>{
 const options=agentGatewayOption({} as any,{task:'workspace_explain',userId:SPONSOR,gatewayId:'agents'} as any);
 assert.equal(options.gateway?.collectLog,false);assert.equal(options.gateway?.skipCache,true);
 assert.equal(options.gateway?.id,'agents');
});
