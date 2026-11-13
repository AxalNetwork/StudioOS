// D1614 (#3968): the real engine mount reads E3 runs, not the old empty seam.
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
  w.agent(AGENT); w.task(200, AGENT); w.task(201, AGENT);
  w.db.exec(`INSERT INTO agent_task_runs (id,uid,agent_id,task_id,attempt,status) VALUES
    (20,'old-attempt',50,200,1,'failed'),(1,'latest-attempt',50,200,2,'waiting_decision'),
    (3,'other-task-run',50,201,1,'done')`);
  w.db.exec(`INSERT INTO ai_usage_logs (id,user_id,task,model,charged_microusd,guard_for) VALUES
    (900,10,'fixture','fixture',10,NULL),(901,10,'fixture','fixture',0,NULL),
    (902,10,'fixture','fixture',4,901),(903,10,'fixture','fixture',700,NULL)`);
  w.db.exec('UPDATE agent_task_runs SET usage_log_id=CASE id WHEN 20 THEN 900 WHEN 1 THEN 901 ELSE 903 END');
}
async function read(w: World, path: string, user = SPONSOR) {
  const token = await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const app = new Hono(); app.route('/api/teams',engine);
  const r = await app.request('/api/teams'+path,{headers:{Authorization:`Bearer ${token}`}},w.env);
  return {status:r.status, body:await r.json() as any};
}
test('latest attempt, guard-inclusive charge and all-attempt total stay within selected tasks',async()=>{
  const w=world(); try {
    seed(w); const runs=await recordedWorkRuns(w.env,[200]); const r=runs.get(200)!;
    assert.deepEqual([...runs.keys()],[200]); assert.equal(r.uid,'latest-attempt');
    assert.equal(r.status,'waiting_decision'); assert.equal(r.charged_microusd,4);
    assert.equal(r.total_cost,14); assert.equal(r.missing_cost,0);
    w.db.exec('UPDATE ai_usage_logs SET charged_microusd=NULL WHERE id=902');
    const unknown=(await recordedWorkRuns(w.env,[200])).get(200)!;
    assert.equal(unknown.charged_microusd,null); assert.equal(unknown.total_cost,null); assert.equal(unknown.missing_cost,1);
    w.db.exec('DELETE FROM ai_usage_logs WHERE id=902; UPDATE ai_usage_logs SET charged_microusd=NULL WHERE id=900');
    const zero=(await recordedWorkRuns(w.env,[200])).get(200)!;
    assert.equal(zero.charged_microusd,0,'a recorded zero remains zero'); assert.equal(zero.total_cost,null,'an older unknown charge makes the task total unknown');
  } finally {w.close();}
});
test('real engine board and item expose the recorded run under their existing scope gate',async()=>{
  const w=world(); try {
    seed(w);
    const board=await read(w,'/project/7/work/board'); assert.equal(board.status,200);
    const card=board.body.items.find((x:any)=>x.uid===hex(200,'c'));
    assert.equal(card.run.uid,'latest-attempt'); assert.equal(card.run.status,'waiting');
    assert.deepEqual(card.run.cost,{available:true,value_microusd:4}); assert.deepEqual(card.cost,{available:true,value_microusd:14});
    const item=await read(w,'/tasks/'+hex(200,'c')); assert.equal(item.status,200); assert.deepEqual(item.body.task.run,card.run);
    for (const [raw, status] of [['refused','skipped'],['halted','skipped'],['step_lost','failed'],['scope_moved','failed'],['cancelled','cancelled'],['admitted','running']]) {
      w.db.prepare('UPDATE agent_task_runs SET status=?,refusal=? WHERE id=1').run(raw,raw==='refused'?'scope_paused':null);
      const changed=(await read(w,'/tasks/'+hex(200,'c'))).body.task.run;
      assert.equal(changed.status,status); assert.equal(changed.recorded_status,raw);
    }
    w.db.exec("UPDATE agent_task_runs SET status='refused',refusal='not_ready' WHERE id=1");
    assert.equal((await read(w,'/tasks/'+hex(200,'c'))).body.task.run.status,'failed');
    w.db.exec("UPDATE agent_task_runs SET status='failed',refusal='spend_limit' WHERE id=1");
    assert.equal((await read(w,'/tasks/'+hex(200,'c'))).body.task.run.status,'skipped');
    assert.equal((await read(w,'/project/7/work/board',STRANGER)).status,403);
    assert.equal((await read(w,'/tasks/'+hex(200,'c'),STRANGER)).status,404);
    assert.doesNotMatch(JSON.stringify(card),/@example|usage_log_id|agent_id/);
  } finally {w.close();}
});
test('usage failure preserves run identity with unknown costs; run-store failure rejects the read',async()=>{
  const w=world(); try {
    seed(w); const DB=w.env.DB;
    w.env.DB={prepare(sql:string){if(sql.includes('ai_usage_logs'))throw new Error('synthetic usage failure');return DB.prepare(sql);}};
    const r=(await recordedWorkRuns(w.env,[200])).get(200)!;
    assert.equal(r.uid,'latest-attempt'); assert.equal(r.charged_microusd,null); assert.equal(r.total_cost,null); assert.equal(r.missing_cost,1);
    w.env.DB={prepare(){throw new Error('synthetic run-store failure');}};
    await assert.rejects(recordedWorkRuns(w.env,[200]),/run-store failure/);
    assert.equal((await recordedWorkRuns(w.env,[])).size,0,'empty task selections make no read');
  } finally {w.close();}
});
test('a new attempt between reads cannot attach its cost to the old run',async()=>{
  const w=world(); try {
    seed(w); const DB=w.env.DB; let changed=false;
    w.env.DB={prepare(sql:string){
      if(sql.includes('WITH attempt_costs')&&!changed){changed=true;w.db.exec("INSERT INTO agent_task_runs (id,uid,agent_id,task_id,attempt,status,usage_log_id) VALUES (30,'concurrent-attempt',50,200,3,'running',903)");}
      return DB.prepare(sql);
    }};
    const r=(await recordedWorkRuns(w.env,[200])).get(200)!;
    assert.equal(r.uid,'latest-attempt'); assert.equal(r.charged_microusd,null); assert.equal(r.total_cost,null);
  } finally {w.close();}
});
