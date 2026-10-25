/** #2639: form normalisation never loosens the Worker or recovery boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SignJWT } from 'jose';
import sms from '../src/routes/auth_sms.ts';
import recover from '../src/routes/auth_recover.ts';
import { persistSmsEnrollment } from '../src/services/authSms.ts';
import { updatePersonalProfile, decryptPersonalSecret } from '../src/services/profileExpansion.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'synthetic-phone-2639-key-'.repeat(3);
const PHONE = '+41790000000'; // fictional all-zero Swiss subscriber digits
async function fixture(t: any) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url),'utf8'));
  for (const name of ['277_user_recovery_state.sql','302_push_subscriptions.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url),'utf8'));
  db.exec("INSERT INTO users (id,email,name,role,country,email_verified) VALUES (1,'phone-fixture@example.test','Fixture','founder','CH',1)");
  const kv = new Map();
  const env: any = { DB: d1Over(db), ENVIRONMENT:'production', JWT_SECRET:SECRET, KEK_PII:'synthetic-pii-test-key-2639'.repeat(3), GCIP_API_KEY:'synthetic-gcip-key',
    RATE_LIMITS: { async get(k: string) {return kv.get(k) ?? null;}, async put(k: string,v: string) {kv.set(k,v);}, async delete(k: string) {kv.delete(k);} },
    EMAIL_QUEUE: {async send() {}}, PIPELINE_ROOM: {idFromName:(name: string)=>name,get:()=>({fetch:async()=>new Response('ok')})}, ONBOARDING_CHAT: {idFromName:(name: string)=>name,get:()=>({fetch:async()=>new Response('ok')})}, APP_URL:'https://example.test' };
  const provider: any[] = [];
  t.mock.method(globalThis,'fetch',async (url: any, init: any) => {
    assert.ok(String(url).startsWith('https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode'), 'only the synthetic SMS provider may be called');
    provider.push(JSON.parse(init.body));
    return Response.json({sessionInfo:'synthetic-session'});
  });
  const token=await new SignJWT({user_id:1}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const headers={Cookie:`studioos_auth=${token}`,'content-type':'application/json'};
  return {db,env,provider,kv,headers};
}
async function enrollment(t: any, route=sms) {
  const f=await fixture(t);
  const send=(phone: string)=>route.request('/sms/start-enrollment',{method:'POST',headers:f.headers,body:JSON.stringify({phone,country:'CH'})},f.env);
  assert.equal((await send('079 000 00 00')).status,400,'server must keep refusing national input');
  assert.equal(f.provider.length,0);
  assert.equal((await send(PHONE)).status,200);
  assert.equal(f.provider[0].phoneNumber,PHONE);
  assert.equal(JSON.parse(f.kv.get('sms-enroll:1:synthetic-session')).phone,PHONE);
}
test('#2639: SMS Worker still requires strict E.164 and binds the canonical candidate to verification',t=>enrollment(t));
async function profile(t: any, update=updatePersonalProfile) {
  const f=await fixture(t);
  await assert.rejects(()=>update(f.env,1,{phone_e164:'079 000 00 00'}),{field:'phone_e164'});
  const result=await update(f.env,1,{phone_e164:PHONE});
  assert.equal(result.has_phone,true);
  assert.equal(result.phone_last4,'0000');
  assert.equal(await decryptPersonalSecret(f.env,1,'phone_e164'),PHONE);
  assert.equal(JSON.stringify(result).includes(PHONE),false,'reads stay masked');
}
test('#2639: profile Worker keeps strict validation and encrypts canonical phone',t=>profile(t));
async function recovery(t: any, route=recover) {
  const f=await fixture(t);
  await persistSmsEnrollment(f.env,1,PHONE,'CH','synthetic-firebase');
  const response=await route.request('/sms/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'phone-fixture@example.test',phone:'+12025550123',country:'US'})},f.env);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(f.provider[0].phoneNumber,PHONE,'recovery must use the enrolled canonical phone, ignoring request-supplied destinations');
  const body: any=await response.json();
  assert.equal(body.last4,'0000');
  assert.equal(JSON.stringify(body).includes(PHONE),false);
}
test('#2639: recovery sends to the enrolled canonical number and ignores an injected destination',t=>recovery(t));

let serial=0;
function moduleUrl(source: string, base: URL) {
  const js=stripTypeScriptTypes(source).replace(/(from\s+|import\()(['"])([^'"]+)\2/g, (all,prefix,_quote,spec)=>{
    if (/\s/.test(spec)) return all;
    const path=new URL(spec,base);
    const resolved=spec.startsWith('.') ? [path.href,path.href+'.ts',path.href+'.js'].find(p=>statSync(new URL(p),{throwIfNoEntry:false})?.isFile()) : import.meta.resolve(spec);
    return `${prefix}'${resolved}'`;
  });
  return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64')+'#2639-'+serial++;
}
test('#2639: strict validation and recovery binding assertions reject guard mutations, then pass restored sources',async t=>{
  const smsUrl=new URL('../src/routes/auth_sms.ts',import.meta.url);
  const smsSource=readFileSync(smsUrl,'utf8');
  const mutant=(await import(moduleUrl(smsSource.replace('if (!isE164(phone))','if (false)'),smsUrl))).default;
  await assert.rejects(()=>enrollment(t,mutant),{name:'AssertionError'});
  await enrollment(t);
  const profileUrl=new URL('../src/services/profileExpansion.ts',import.meta.url);
  const profileSource=readFileSync(profileUrl,'utf8');
  const before="if (!/^\\+[1-9]\\d{6,14}$/.test(s))";
  assert.ok(profileSource.includes(before));
  const badProfile=await import(moduleUrl(profileSource.replace(before,'if (false)'),profileUrl));
  await assert.rejects(()=>profile(t,badProfile.updatePersonalProfile),{name:'AssertionError'});
  await profile(t);
  const recoverUrl=new URL('../src/routes/auth_recover.ts',import.meta.url);
  const recoverSource=readFileSync(recoverUrl,'utf8');
  const send='sendVerificationCode(c.env, sms_.phone, body?.recaptcha_token || null)';
  assert.ok(recoverSource.includes(send));
  const badRecover=(await import(moduleUrl(recoverSource.replace(send,'sendVerificationCode(c.env, body.phone, body?.recaptcha_token || null)'),recoverUrl))).default;
  await assert.rejects(()=>recovery(t,badRecover),{name:'AssertionError'});
  await recovery(t);
});
