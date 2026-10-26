/** D957 item15 / OD8 A: real schema, authenticated read, one aggregate snapshot. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignJWT } from 'jose';
import perks from '../src/routes/perks.ts';
import { perkCreditSummary } from '../src/services/perkCreditSummary.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const scratch=mkdtempSync(join(tmpdir(),'credit-summary-d957-')),seed=join(scratch,'seed.sqlite');
const base=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
base.exec(readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8'));
const dir='cloudflare-worker/sql/migrations';
for(const file of readdirSync(dir).filter(f=>/^\d+_.*\.sql$/.test(f)&&migrationNumber(f)>BASELINE_CUTOFF).sort())base.exec(readFileSync(`${dir}/${file}`,'utf8'));
base.prepare('VACUUM INTO ?').run(seed);base.close();
after(()=>rmSync(scratch,{recursive:true,force:true}));
const SECRET='fixture-jwt-key-'.repeat(4);let serial=0;
function fixture(){
 const file=join(scratch,`${++serial}.sqlite`);copyFileSync(seed,file);
 const db=new DatabaseSync(file,{enableForeignKeyConstraints:false});
 const add=db.prepare('INSERT INTO users(id,name,email,role,is_active) VALUES(?,?,?,?,?)');
 for(const [id,role,active] of [[1,'admin',1],[2,'admin',1],[3,'founder',1],[4,'investor',1],[5,'partner',1],[6,'advisor',1],[7,'exploring',1],[8,'founder',0],[9,'partner',0],[10,'founder',1],[11,'advisor',1],[12,'admin',0]] as const)add.run(id,`Fixture person ${id}`,`fixture-${id}@example.test`,role,active);
 db.prepare('INSERT INTO super_admins(user_id) VALUES(?)').run(1);
 const entries=db.prepare("INSERT INTO perk_credit_ledger(user_id,delta,kind,source_ref,created_at) VALUES(?,?,'admin_adjust',?,?)");
 let entry=0;
 const credit=(id:number,delta:number,date='2026-10-01')=>entries.run(id,delta,`fixture:${++entry}`,date);
 // Per-user nets: founder100, investor30, partner-7, advisor0, exploring5.
 credit(3,150,'2000-01-01');credit(3,-50);credit(4,40);credit(4,-10);credit(5,10);credit(5,-17);credit(6,20);credit(6,-20);credit(7,5);
 // These must never enter the active member aggregate, regardless of sign.
 credit(1,1000);credit(2,2000);credit(8,3000);credit(9,-4000);credit(12,-5000);
 const binding=d1Over(db);let aggregateReads=0;
 const state:{fault?:string;fake?:unknown}={};
 const DB:any={...binding,prepare(sql:string){
  const statement=binding.prepare(sql);
  if(sql.includes('WITH balances AS')){
   const all=statement.all;statement.all=async()=>{aggregateReads++;if(state.fault)throw new Error(state.fault);if(state.fake!==undefined)return state.fake;return all();};
  }
  return statement;
 }};
 const env:any={DB,JWT_SECRET:SECRET,ENVIRONMENT:'development'};
 const call=async(who:number|null=1,path='/admin/credits/summary',claims:Record<string,unknown>={})=>{
  const headers:Record<string,string>={};
  if(who!==null)headers.authorization='Bearer '+await new SignJWT({user_id:who,...claims}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r=await perks.request(path,{headers},env);
  return {status:r.status,headers:r.headers,body:await r.json() as any};
 };
 return {db,env,state,credit,call,reads:()=>aggregateReads,close:()=>db.close()};
}

test('OD8 counts active non-admin positive net holders, lists eligible roles, and keeps negatives separate',async()=>{
 const f=fixture();try{
  const before=f.db.prepare('SELECT COUNT(*) AS n FROM perk_credit_ledger').get();
  const r=await f.call();assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body,{credits_held:135,accounts:3,roles:['advisor','exploring','founder','investor','partner'],negative_balances:{total:-7,accounts:1}});
  assert.match(r.headers.get('cache-control')||'',/private.*no-store/);
  assert.equal(f.reads(),1,'totals, holder counts and role scope share one snapshot');
  assert.deepEqual(f.db.prepare('SELECT COUNT(*) AS n FROM perk_credit_ledger').get(),before);
  assert.ok(!JSON.stringify(r.body).includes('Fixture person'));assert.ok(!JSON.stringify(r.body).includes('@example.test'));assert.ok(!JSON.stringify(r.body).includes('user_id'));
 }finally{f.close();}
});

test('the HQ Super Admin gate rejects every other role, forged elevation, inactive accounts and branch elevation',async()=>{
 const f=fixture();try{
  assert.equal((await f.call(null)).status,401);
  for(const id of [2,3,4,5,6,7,8,12])assert.equal((await f.call(id)).status,id===8||id===12?401:403);
  assert.equal((await f.call(2,undefined,{is_super_admin:1,role:'admin'})).status,403);
  assert.equal(f.reads(),0,'unauthorized callers never execute the financial aggregate');
  f.env.BRANCH_CODE='fixture';const branch=await f.call();assert.equal(branch.status,403);assert.equal(branch.body.error,'forbidden');assert.equal(f.reads(),0);
 }finally{f.close();}
});

test('literal summary route wins before member-id parsing and existing member detail keeps its shape',async()=>{
 const f=fixture();try{
  assert.equal((await f.call()).status,200);
  const detail=await f.call(1,'/admin/credits/3');assert.equal(detail.status,200);assert.equal(detail.body.member.id,3);assert.equal(detail.body.balance,100);assert.equal(detail.body.ledger.length,2);assert.ok(!('credits_held' in detail.body));
  assert.equal((await f.call(1,'/admin/credits/not-an-id')).status,400);
 }finally{f.close();}
});

test('zero and missing ledger balances are measured zeros; an empty eligible population has no roles',async()=>{
 const f=fixture();try{
  f.db.exec('DELETE FROM perk_credit_ledger');
  assert.deepEqual((await f.call()).body,{credits_held:0,accounts:0,roles:['advisor','exploring','founder','investor','partner'],negative_balances:{total:0,accounts:0}});
  f.db.exec("UPDATE users SET is_active=0 WHERE role<>'admin'");
  assert.deepEqual((await f.call()).body,{credits_held:0,accounts:0,roles:[],negative_balances:{total:0,accounts:0}});
 }finally{f.close();}
});

test('no row cap or time window drops active holders',async()=>{
 const f=fixture();try{
  const add=f.db.prepare("INSERT INTO users(id,name,email,role,is_active) VALUES(?,?,?,'founder',1)");
  for(let i=100;i<355;i++){add.run(i,`Fixture member ${i}`,`member-${i}@example.test`);f.credit(i,1,'1999-01-01');}
  const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.credits_held,390);assert.equal(r.body.accounts,258);assert.equal(r.body.negative_balances.total,-7);
 }finally{f.close();}
});

test('database errors and malformed aggregate envelopes refuse with a safe coded 503, never fabricated zeros',async()=>{
 const f=fixture();const old=console.error,logs:string[]=[];console.error=(...a:any[])=>logs.push(a.join(' '));
 try{
  f.state.fault='synthetic private balance 987654321 or provider detail';
  const error=await f.call();assert.equal(error.status,503);assert.equal(error.body.error,'credit_summary_unreadable');assert.match(error.body.message,/Try again/);assert.ok(!('credits_held' in error.body));assert.ok(!JSON.stringify(error.body).includes('987654321'));
  delete f.state.fault;
  for(const fake of [{success:false,results:[]},{success:true},{success:true,results:null},{success:true,results:[{role:'founder',credits_held:'0',accounts:0,negative_total:0,negative_accounts:0}]}]){
   f.state.fake=fake;assert.equal((await f.call()).status,503);
  }
  assert.ok(!logs.join(' ').includes('987654321'));
 }finally{console.error=old;f.close();}
});

test('unsafe integer totals are unreadable instead of being rounded on the wire',async()=>{
 const f=fixture();try{
  f.state.fake={success:true,results:[{role:'founder',credits_held:Number.MAX_SAFE_INTEGER,accounts:1,negative_total:0,negative_accounts:0},{role:'partner',credits_held:1,accounts:1,negative_total:0,negative_accounts:0}]};
  assert.equal((await f.call()).status,503);
  f.state.fake={success:true,results:[{role:'founder',credits_held:9007199254740992,accounts:1,negative_total:0,negative_accounts:0}]};
  await assert.rejects(perkCreditSummary(f.env),/credit_summary_unreadable/);
 }finally{f.close();}
});
