import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SignJWT} from 'jose';
import {screenUser, ensureSanctionsSchema} from '../src/services/sanctions.ts';
import trust from '../src/routes/trust.ts';
import {d1Over} from './_d1_sqlite.mjs';

const providers = ['ofac','eu','uk_hmt'] as const;
const subject = {full_legal_name:'Fixture Unrelated Subject'};
const secret = 'synthetic-test-secret-2444-not-production';
async function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE corporate_profiles(user_id INTEGER PRIMARY KEY, sanctions_last_checked_at TEXT, entity_name TEXT, registered_country TEXT);
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,role TEXT,is_active INTEGER,jwt_min_iat INTEGER);
 INSERT INTO users VALUES(1,'Fixture Admin','admin@example.invalid','admin',1,NULL),(7,'Fixture Unrelated Subject','subject@example.invalid','founder',1,NULL);
 INSERT INTO corporate_profiles VALUES(7,'2000-01-01',NULL,NULL);`);
 const env = {DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any;
 await ensureSanctionsSchema(env);
 db.exec("INSERT INTO sanctions_screenings(user_id,provider,severity) VALUES(7,'aggregate','review')");
 return {db,env};
}
function providerFor(url: string) {
 const parsed = new URL(url);
 if (parsed.protocol !== 'https:') throw new Error('Unexpected network request');
 if (parsed.hostname === 'sanctionslistservice.ofac.treas.gov') return 'ofac';
 if (parsed.hostname === 'webgate.ec.europa.eu') return 'eu';
 if (parsed.hostname === 'ofsistorage.blob.core.windows.net') return 'uk_hmt';
 throw new Error('Unexpected network request');
}
const bodies = {
 ofac:[{displayName:'Fixture Listed Entity',uid:'fixture-ofac',dateOfBirth:'1970-01-01'}],
 eu:{entries:[{nameAlias:[{wholeName:'Fixture EU Designation'}],id:'fixture-eu'}]},
 uk_hmt:{Designations:[{PrimaryName:'Fixture UK Designation',GroupID:'fixture-uk'}]},
};
function stubFetch(t:any, fail?: string, mode = 'throw') {
 const original = globalThis.fetch;
 const calls:string[]=[];
 globalThis.fetch = async (input:any) => {
  const provider = providerFor(String(input)); calls.push(provider);
  if (provider === fail) {
   if (mode === 'throw') throw new Error('Fixture provider unavailable');
   if (mode === 'http') return new Response('{}',{status:503});
   if (mode === 'invalid-json') return new Response('invalid',{status:200});
   return Response.json(provider==='ofac'?[]:provider==='eu'?{entries:[]}:{Designations:[]});
  }
  return Response.json(bodies[provider]);
 };
 t.after(()=>{globalThis.fetch=original;});
 return calls;
}
function unchanged(db:any) {
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sanctions_screenings').get().n,1);
 assert.equal(db.prepare('SELECT severity FROM sanctions_screenings').get().severity,'review');
 assert.equal(db.prepare('SELECT sanctions_last_checked_at AS at FROM corporate_profiles WHERE user_id=7').get().at,'2000-01-01');
}
for (const provider of providers) {
 for(const mode of ['throw','http','invalid-json','empty']) {
  test(`2444: ${provider} ${mode} cannot record a clear screening or advance last_checked`, async t => {
   const {db,env}=await fixture(); t.after(()=>db.close()); stubFetch(t,provider,mode);
   await assert.rejects(screenUser(env,7,subject), e => e instanceof Error && e.name === 'IncompleteSanctionsScreeningError' && (e as any).missingLists.includes(provider));
   unchanged(db);
  });
 }
}
test('2444: an empty cached provider is reloaded and cannot hide a failed loader',async t=>{
 const {db,env}=await fixture(); t.after(()=>db.close()); const calls=stubFetch(t,'eu');
 env.TOKENS={get:async(key:string)=>key.endsWith(':eu')?[]:null,put:async()=>{}};
 await assert.rejects(screenUser(env,7,subject),e => e instanceof Error && e.name === 'IncompleteSanctionsScreeningError');
 assert.ok(calls.includes('eu')); unchanged(db);
});
test('2444: all valid lists can record a clear result and timestamp',async t=>{
 const {db,env}=await fixture(); t.after(()=>db.close()); stubFetch(t);
 const result=await screenUser(env,7,subject);
 assert.equal(result.hit,false); assert.equal(result.severity,'none'); assert.ok(result.id>0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sanctions_screenings').get().n,2);
 assert.notEqual(db.prepare('SELECT sanctions_last_checked_at AS at FROM corporate_profiles WHERE user_id=7').get().at,'2000-01-01');
});
test('2444: valid cached lists need no network and retain positive matching',async t=>{
 const {db,env}=await fixture(); t.after(()=>db.close()); const calls=stubFetch(t);
 env.TOKENS={get:async(key:string)=>[{source:key.split(':').at(-1),name:'fixture listed entity',aliases:[],dob:'1970-01-01',nationality:null,ref:'fixture'}]};
 const result=await screenUser(env,7,{full_legal_name:'Fixture Listed Entity',date_of_birth:'1970-01-01'});
 assert.equal(result.hit,true); assert.equal(result.severity,'block'); assert.equal(calls.length,0);
});
test('2444: admin route answers 503 with missing providers and no new verdict',async t=>{
 const {db,env}=await fixture(); t.after(()=>db.close()); stubFetch(t,'uk_hmt');
 const token=await new SignJWT({user_id:1,role:'admin'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
 const res=await trust.request('/sanctions/screen/7',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'},env);
 assert.equal(res.status,503);const body=await res.json();
 assert.equal(body.code,'screening_incomplete'); assert.deepEqual(body.missing_lists,['uk_hmt']);
 assert.match(body.detail,/not completed/); unchanged(db);
});

test('2444: the provider stub refuses lookalike hosts and provider names in URL paths',()=>{
 for (const url of [
  'https://ofac.treas.gov.example.invalid/SDN.JSON',
  'https://example.invalid/ec.europa.eu',
  'https://example.invalid/ofsistorage',
  'http://sanctionslistservice.ofac.treas.gov/SDN.JSON',
 ]) assert.throws(()=>providerFor(url),/Unexpected network request/);
});
