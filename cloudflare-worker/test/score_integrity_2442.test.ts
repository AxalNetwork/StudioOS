import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SignJWT} from 'jose';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import scoring from '../src/routes/scoring.ts';
import projects from '../src/routes/projects.ts';
import {d1Over} from './_d1_sqlite.mjs';
const secret='synthetic-test-secret-2442-not-production';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
test('2442: score and intake refuse client adjustments before creating a project',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,founder_id INTEGER,is_active INTEGER,jwt_min_iat INTEGER); INSERT INTO users VALUES(1,'admin',NULL,1,NULL)");
 const token=await new SignJWT({user_id:1,role:'admin'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
 for(const [router,path] of [[scoring,'/score'],[projects,'/submit']] as const){
  for(const value of [0,15,-10,null]){
   const res=await router.request(path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({ai_adjustment:value})},{JWT_SECRET:secret,ENVIRONMENT:'development',DB:d1Over(db)} as any);
   assert.equal(res.status,400,path);
   assert.equal((await res.json()).code,'reserved_field',path);
  }
 }
 db.close();
});
// Execute the route's status-selection block with a recording SQL boundary.
// This pins the persisted status decision without mocking scoring mathematics.
test('2442: official low scores preserve status, high scores keep existing tiers',async()=>{
 const source=read('../src/routes/scoring.ts');
 const block=source.slice(source.indexOf('  let newStatus = project.status;'),source.indexOf('\n  await sql.end();',source.indexOf('  let newStatus = project.status;')));
 for(const score of [0,69.9,70,85]){
  const writes:any[]=[];
  const context=vm.createContext({project:{status:'applied'},result:{total_score:score},effectiveSandbox:false,reviewStatus:'auto_approved',projectId:7,sql:async(strings:any,...values:any[])=>writes.push(values)});
  await vm.runInContext(`(async()=>{${block}; globalThis.status=newStatus;})()`,context);
  assert.equal(context.status,score>=85?'tier_1':score>=70?'tier_2':'applied');
  assert.equal(writes.length,score>=70?1:0);
 }
});
test('2442: intake low scores preserve project status and create an applied deal',()=>{
 const source=read('../src/routes/projects.ts');
 const start=source.indexOf('  let newStatus =');
 const block=source.slice(start,source.indexOf('\n  await sql`UPDATE projects',start));
 for(const review of ['flagged','auto_approved']){
  const ctx=vm.createContext({project:{status:'draft',stage:'idea'},result:{total_score:20},intakeReview:review});
  vm.runInContext(`${block}; globalThis.output=[newStatus,dealStatus,newStage]`,ctx);
  assert.deepEqual(Array.from(ctx.output),['draft','applied','idea']);
 }
});
test('2442: both paths flag low scores for a person, preserving sandbox behavior',()=>{
 for(const path of ['../src/routes/scoring.ts','../src/routes/projects.ts']){
  const source=read(path);
  const block=source.match(/  if \((?:!effectiveSandbox && )?result.total_score < 70\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(block,path);
  for(const score of [20,80]){
   const flags:any[]=[];
   vm.runInNewContext(block,{result:{total_score:score},flags,intakeFlags:flags,effectiveSandbox:false});
   assert.equal(flags.length,score<70?1:0,path);
   if(score<70) assert.equal(flags[0].type,'low_score_review');
  }
 }
});
