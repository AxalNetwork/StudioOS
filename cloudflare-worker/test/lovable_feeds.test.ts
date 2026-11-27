import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { LOVABLE_FEEDS, lovablePulls, lovableFedModules } from '../src/integrations/lovableFeeds.ts';
import { getDescriptor, CONNECTOR_METADATA, publicDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { pageDescriptor, CATEGORY_ORDER } from '../src/integrations/connectorPages.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import integrations from '../src/routes/integrations.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
const secret='synthetic-lovable-directory-secret-0123456789';
const founder={role:'founder',hq:true,venture:true};
const investor={role:'investor',hq:true,venture:false};
test('four planned landings do not claim any shipped read, write, feed, sign-in or provider implementation',()=>{
 const row=getDescriptor('lovable')!;const page=pageDescriptor(row,founder)!;
 assert.equal(row.status,'beta');assert.equal(row.auth_type,'none');assert.equal(row.audience_rule,'venture');
 assert.equal(CONNECTOR_METADATA.lovable.category,'Design and build');assert.ok(CATEGORY_ORDER.includes('Design and build'));
 assert.deepEqual(LOVABLE_FEEDS.map(f=>[f.module,f.direction,f.part,f.built]),[['experiments','out',2,true],['experiments','in',3,false],['prototype_mvp','out',2,true],['prototype_mvp','in',3,false]]);
 assert.ok(Object.isFrozen(LOVABLE_FEEDS));assert.ok(LOVABLE_FEEDS.every(Object.isFrozen));
 assert.deepEqual(CONNECTOR_METADATA.lovable.pulls,lovablePulls());assert.deepEqual(CONNECTOR_METADATA.lovable.feeds,lovableFedModules());
 assert.deepEqual(lovablePulls(),[]);assert.deepEqual(lovableFedModules(),[]);assert.deepEqual(CONNECTOR_METADATA.lovable.sends,[]);
 assert.equal(getProviderImpl('lovable'),null);assert.equal(writesProjectData('lovable'),false);
 assert.equal(page.sign_in.kind,'none');assert.equal(page.sign_in.label,'Works without signing in');assert.deepEqual(page.endpoints,{sign_in:null,api:null});
 assert.deepEqual(page.tools,[]);assert.deepEqual(page.prompts,[]);assert.equal(page.verified_on,null);
 assert.deepEqual(page.works_without_signing_in?.map(x=>x.built),[true,false]);
 assert.match(page.works_without_signing_in!.map(x=>x.what).join(' '),/Part 2:.*open Lovable in your browser \(D1082\)\..*Part 3:.*Not built yet/s);
 assert.deepEqual(page.never_does,['No Lovable sign-in or stored Lovable key.','No prompt sent by the Worker.','Nothing built or published for you.']);
 assert.equal(pageDescriptor(row,investor),null);
 assert.equal(publicDescriptor(row,founder).auth_type,'none');
});
test('founder sees the directory entry, investor cannot; no connection is created and the Worker never calls Lovable',async()=>{
 const db=new DatabaseSync(':memory:', {enableForeignKeyConstraints:false});const schema=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
 for(const t of ['users','super_admins']) db.exec(tableFromBaseline(schema,t));
 db.exec("INSERT INTO users(id,email,name,role,is_active) VALUES (1,'founder@example.test','Synthetic founder','founder',1),(2,'investor@example.test','Synthetic investor','investor',1)");
 const app=new Hono<any>();app.route('/api/connectors',integrations);const env={DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any;
 const call=async(id:number,path:string,method='GET',body?:unknown)=>{
  const token=await new SignJWT({user_id:id,role:id===1?'founder':'investor'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  return app.request('/api/connectors'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},env);
 };
 const before=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('No provider may be called by a directory test');};
 try{
  const found=await call(1,'/directory/lovable');assert.equal(found.status,200);const data=await found.json() as any;
  assert.equal(data.connector.page_href,'/account/connectors/lovable');assert.equal(data.connector.sign_in.kind,'none');
  assert.equal((await call(2,'/directory/lovable')).status,404);
  const available=await(await call(1,'/available')).json() as any;assert.ok(available.items.some((p:any)=>p.key==='lovable'));
  const hidden=await(await call(2,'/available')).json() as any;assert.ok(!hidden.items.some((p:any)=>p.key==='lovable'));
  const connect=await call(1,'/connect','POST',{provider_key:'lovable'});assert.equal(connect.status,409);assert.equal((await connect.json() as any).error,'sign_in_not_required');
  assert.equal((db.prepare("SELECT COUNT(*) n FROM integrations WHERE provider_key='lovable'").get() as any).n,0);
 }finally{globalThis.fetch=before;db.close();}
});
