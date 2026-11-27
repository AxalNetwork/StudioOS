// D4459 (#4459): no-call attempts have no charge; mutation responses use the live run reader.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { world, AGENT, SPONSOR, STRANGER, hex, type World } from './_agent_engine_fixture.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';
import engine from '../src/routes/agent_engine.ts';
import { recordedWorkRuns } from '../src/services/agents/workRuns.ts';
after(removeMigratedDatabases);
function seed(w: World) {
  w.agent(AGENT); w.task(200, AGENT, { board: 'in_review', status: 'waiting_decision' });
  w.db.exec(`UPDATE scope_tasks SET task_number=1 WHERE id=200;
    INSERT INTO ai_usage_logs (id,user_id,task,model,charged_microusd) VALUES (900,10,'synthetic','synthetic',50);
    INSERT INTO agent_task_runs (id,uid,agent_id,task_id,attempt,status,usage_log_id) VALUES
      (1,'charged-attempt',50,200,1,'done',900), (2,'no-call-attempt',50,200,2,'refused',NULL);`);
}
async function call(w: World, method: string, path: string, body?: unknown, user=SPONSOR) {
  const token=await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const app=new Hono();app.route('/api/teams',engine);
  const r=await app.request('/api/teams'+path,{method,headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},w.env);
  return {status:r.status,body:await r.json() as any};
}
test('no-call attempts preserve charged totals and are zero themselves; real missing charges remain unknown',async()=>{
  const w=world();try{
    seed(w);
    for(const [status,refusal] of [['refused','scope_paused'],['refused','agent_not_active'],['refused','not_ready'],['refused','daily_limit'],['admitted',null],['running',null]]){
      w.db.prepare('UPDATE agent_task_runs SET status=?,refusal=? WHERE id=2').run(status,refusal);
      const r=(await recordedWorkRuns(w.env,[200])).get(200)!;
      assert.equal(r.uid,'no-call-attempt');assert.equal(r.charged_microusd,0);
      assert.equal(r.total_cost,50);assert.equal(r.missing_cost,0);
    }
    w.db.exec('DELETE FROM agent_task_runs WHERE id=1');
    const free=(await recordedWorkRuns(w.env,[200])).get(200)!;
    assert.equal(free.total_cost,0);assert.equal(free.missing_cost,0);
    w.db.exec('UPDATE agent_task_runs SET usage_log_id=900 WHERE id=2; UPDATE ai_usage_logs SET charged_microusd=NULL WHERE id=900');
    const unknown=(await recordedWorkRuns(w.env,[200])).get(200)!;
    assert.equal(unknown.charged_microusd,null);assert.equal(unknown.total_cost,null);assert.equal(unknown.missing_cost,1);
    w.db.exec(`UPDATE ai_usage_logs SET charged_microusd=50 WHERE id=900;
      INSERT INTO agent_task_runs (id,uid,agent_id,task_id,attempt,status,usage_log_id) VALUES (1,'charged-attempt',50,200,1,'done',900);
      UPDATE agent_task_runs SET usage_log_id=999 WHERE id=2;`);
    assert.equal((await recordedWorkRuns(w.env,[200])).get(200)!.total_cost,null,'a non-null usage reference without its row stays unknown');
  }finally{w.close();}
});
test('real engine labels, milestone and review responses preserve the item reader’s run and cost',async()=>{
  const w=world();try{
    seed(w);
    const get=()=>call(w,'GET','/tasks/'+hex(200,'c'));
    const initial=await get();assert.equal(initial.status,200);
    assert.deepEqual(initial.body.task.cost,{available:true,value_microusd:50});
    assert.equal(initial.body.task.run.uid,'no-call-attempt');
    const label=await call(w,'POST','/project/7/work/labels',{name:'Synthetic label'});assert.equal(label.status,201);
    const milestone=await call(w,'POST','/project/7/work/milestones',{title:'Synthetic milestone'});assert.equal(milestone.status,201);
    for(const [method,suffix,body] of [
      ['PUT','labels',{labels:[label.body.label.uid]}],
      ['PUT','milestone',{milestone:milestone.body.milestone.uid}],
      ['POST','review',{decision:'approve'}],
    ] as const){
      const r=await call(w,method,'/project/7/tasks/1/'+suffix,body);assert.equal(r.status,200,JSON.stringify(r.body));
      const fresh=await get();assert.equal(fresh.status,200);
      assert.deepEqual(r.body.task.run,initial.body.task.run);assert.deepEqual(r.body.task.run,fresh.body.task.run);
      assert.deepEqual(r.body.task.cost,initial.body.task.cost);assert.deepEqual(r.body.task.cost,fresh.body.task.cost);
    }
    assert.equal((await call(w,'PUT','/project/7/tasks/1/labels',{labels:[]},STRANGER)).status,404);
  }finally{w.close();}
});
