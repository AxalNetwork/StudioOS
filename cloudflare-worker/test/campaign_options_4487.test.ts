/** D4487: campaign selector choices on the existing writer-gated form-options route. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRecords from '../src/routes/cycle_records.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
const secret='synthetic-campaign-options-secret-0123456789';
function fixture(){
  const db=new DatabaseSync(':memory:',{enableDoubleQuotedStringLiterals:true});loadSchema(db);db.exec('PRAGMA foreign_keys=ON');
  db.exec(`INSERT INTO founders(id,name,email) VALUES(10,'One','one@example.test'),(20,'Two','two@example.test');
    INSERT INTO users(id,email,name,role,founder_id) VALUES(1,'one@example.test','One','founder',10),(2,'two@example.test','Two','founder',20),(3,'advisor@example.test','Advisor','founder',NULL);
    INSERT INTO projects(id,name,founder_id) VALUES(7,'First',10),(8,'Second',20);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES(7,3,'advisor','accepted');
    INSERT INTO growth_channels(id,uid,project_id,name,utm_source) VALUES(1,'ours',7,'Newsletter','email'),(2,'theirs',8,'Private channel','private');
    INSERT INTO customer_segments(id,project_id,name,name_norm,source) VALUES(1,7,'Saved audience','saved','manual'),(2,7,'Ideal customer','ideal','icp_definition'),(3,8,'Private audience','private','manual');
    INSERT INTO content_calendar_items(id,uid,project_id,title,channel_id) VALUES(1,'piece',7,'A planned piece',1),(2,'private-piece',8,'Private piece',2);
    INSERT INTO publish_drafts(id,uid,project_id,module,author_user_id,body_json,status) VALUES(1,'draft',7,'distribution',1,'{"text":"A manual post"}','draft'),(2,'private-draft',8,'distribution',2,'{"text":"Private post"}','draft'),(3,'archived',7,'distribution',1,'{}','archived');`);
  return {db,env:{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any};
}
const app=new Hono<any>();app.route('/api/cycles',cycleRecords);
async function read(f:ReturnType<typeof fixture>,user=1,project=7,extra='&campaign=1'){
  const token=await new SignJWT({user_id:user,role:'founder'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const response=await app.request(`/api/cycles/grow/modules/distribution/form-options?project=${project}${extra}`,{headers:{Authorization:`Bearer ${token}`}},f.env);
  return {status:response.status,body:await response.json() as any};
}
test('D4487: choices preserve segment source, list existing work and never cross the venture',async()=>{
  const f=fixture();try{
    const response=await read(f);assert.equal(response.status,200);
    assert.ok(Array.isArray(response.body.segments));
    assert.deepEqual(response.body.segments.map((s:any)=>[s.id,s.name,s.source]),[[1,'Saved audience','manual'],[2,'Ideal customer','icp_definition']]);
    assert.deepEqual(response.body.channels.map((c:any)=>c.uid),['ours']);
    assert.equal(response.body.channels[0].connected,null);
    assert.match(response.body.channels[0].connection_reason,/Not recorded/);
    assert.deepEqual(response.body.pieces.map((p:any)=>[p.uid,p.channel_uid]),[['piece','ours']]);
    assert.deepEqual(response.body.drafts.map((d:any)=>[d.uid,d.title]),[['draft','A manual post']]);
    assert.doesNotMatch(JSON.stringify(response.body),/Private|private-|example\.test/);
    const legacy=await read(f,1,7,'');assert.equal(legacy.status,200);assert.ok(Array.isArray(legacy.body.kinds));assert.equal(legacy.body.segments,undefined);
  }finally{f.db.close();}
});
test('D4487: the existing project/writer gates protect all campaign selector data',async()=>{
  const f=fixture();try{
    assert.equal((await read(f,2,7)).status,403);
    assert.equal((await read(f,1,8)).status,403);
    assert.equal((await read(f,3,7)).status,403);
    assert.equal((await read(f,1,999)).status,404);
  }finally{f.db.close();}
});
test('D4487: permission is the venture membership verdict, not the account role',async()=>{
  const f=fixture();try{
    assert.deepEqual((await read(f,1,7,'&campaign=permission')).body,{can_write:true});
    const advisor=await read(f,3,7,'&campaign=permission');
    assert.equal(advisor.status,200);
    assert.deepEqual(advisor.body,{can_write:false});
    assert.equal((await read(f,2,7,'&campaign=permission')).status,403);
  }finally{f.db.close();}
});
