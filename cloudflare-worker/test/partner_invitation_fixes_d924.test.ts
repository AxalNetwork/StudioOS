// D924 (#2720): real migrated SQLite, synthetic accounts; all email transport is local.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { envFor, token, call as esignCall, ADMIN } from './_esign_harness.ts';
import onboard from '../src/routes/partner_onboarding.ts';
import adminPartners from '../src/routes/admin_partners.ts';
import { activatePartnerDealOnSignature, ALL_PARTNER_DEAL_TYPES } from '../src/services/partnerDeals.ts';
import { sendPartnerInvitationEmail, sendPartnerInvitationEmailResult, sendAgreementAssignedEmail, sendAgreementAssignedEmailResult } from '../src/services/email.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const migration = read('cloudflare-worker/sql/migrations/547_partner_invitation_sends.sql');
const scratch = mkdtempSync(join(tmpdir(), 'partner-d924-'));
const seed = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seed, { enableForeignKeyConstraints: false });
schema.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
for (const name of readdirSync('cloudflare-worker/sql/migrations').filter(n => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF && migrationNumber(n) < 547).sort()) schema.exec(read('cloudflare-worker/sql/migrations/'+name));
schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function fixture(upgrade = true) {
  const file = join(scratch, `${++serial}.sqlite`); copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec("INSERT INTO users(id,role,name,email,is_active) VALUES(5,'admin','Synthetic inviter','inviter@example.invalid',1),(8,'admin','Synthetic resender','resender@example.invalid',1),(9,'founder','Synthetic outsider','outsider@example.invalid',1)");
  if (upgrade) {
    db.exec(migration);
    for (const name of readdirSync('cloudflare-worker/sql/migrations').filter(n => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > 547).sort()) db.exec(read('cloudflare-worker/sql/migrations/'+name));
  }
  const env: any = envFor(db);
  const app = new Hono<any>().route('/', adminPartners);
  app.onError((err,c) => c.json({error:err.message}, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;
async function call(f:F, method:string, path:string, body?:unknown, who:number|null=8) {
 const headers:any = {'Content-Type':'application/json'};
 if(who) headers.Authorization = 'Bearer '+await token(who, who === 9 ? 'founder' : 'admin');
 const r = await f.app.request(path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},f.env);
 return {status:r.status,body:await r.json() as any};
}
function invite(f:F, status='selected', email='partner@example.invalid') {
 return Number(f.db.prepare(`INSERT INTO partner_invitations(token,recipient_email,invited_by_user_id,allowed_deal_types,status,expires_at) VALUES(?,?,5,'["custom"]',?,'2000-01-01T00:00:00Z')`).run(crypto.randomUUID(),email,status).lastInsertRowid);
}
const row = (f:F,id:number) => f.db.prepare('SELECT * FROM partner_invitations WHERE id=?').get(id) as any;
function transport(kind:'ok'|'refused'|'failed') {
 const original = globalThis.fetch; const mails:string[]=[];
 globalThis.fetch = async (input:any, init:any) => {
  const url=String(input);
  if(url==='https://oauth2.googleapis.com/token') return Response.json({access_token:'synthetic-local-token'});
  assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  if(kind==='failed') throw new Error('synthetic transport failure');
  const raw=JSON.parse(init.body).raw; mails.push(Buffer.from(raw,'base64url').toString('utf8'));
  return Response.json(kind==='ok'?{id:'synthetic-message'}:{error:'synthetic refusal'},{status:kind==='ok'?200:403});
 };
 return {mails,restore:()=>{globalThis.fetch=original;}};
}
function credentials(f:F) { Object.assign(f.env,{GMAIL_CLIENT_ID:'synthetic-id',GMAIL_CLIENT_SECRET:'synthetic-secret',GMAIL_REFRESH_TOKEN:'synthetic-refresh'}); }

for(const stage of ['sent','viewed','profiled','proposed','selected','finalized']) test(`D924 resend preserves ${stage}, extends expiry and stores failed send`,async()=>{
 const f=fixture();try{const id=invite(f,stage); const r=await call(f,'POST',`/invitations/${id}/resend`);
 assert.equal(r.status,200);const inv=row(f,id);assert.equal(inv.status,stage);assert.ok(Date.parse(inv.expires_at)>Date.now()+13*86400000);
 assert.equal(inv.send_count,2);assert.equal(inv.last_send_ok,0);assert.equal(inv.last_send_reason,'not_configured');assert.match(inv.last_sent_at,/T.*Z$/);
 const list=await call(f,'GET','/invitations');assert.equal(list.body.items[0].send_count,2);assert.equal(list.body.items[0].last_send_reason,'not_configured');assert.equal(list.body.items[0].last_sent_at,inv.last_sent_at);assert.equal(list.body.items[0].last_send_ok,0);
 }finally{f.db.close();}
});

test('D924 create deduplicates, keeps three types and rejects a fourth without inserting or sending',async()=>{
 const f=fixture();try{
 const types=ALL_PARTNER_DEAL_TYPES.slice(0,3);
 const r=await call(f,'POST','/invitations',{recipient_email:'new@example.invalid',allowed_deal_types:[...types,types[0],types[1].toUpperCase()]});
 assert.equal(r.status,201);assert.deepEqual(r.body.allowed_deal_types,types);const inv=row(f,r.body.id);assert.equal(inv.send_count,1);assert.equal(inv.last_send_ok,0);assert.equal(inv.last_send_reason,'not_configured');assert.match(inv.last_sent_at,/T.*Z$/);
 const bad=await call(f,'POST','/invitations',{recipient_email:'four@example.invalid',allowed_deal_types:ALL_PARTNER_DEAL_TYPES.slice(0,4)});
 assert.equal(bad.status,400);assert.equal(bad.body.error,'too_many_deal_types');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partner_invitations').get()!.n,1);
 }finally{f.db.close();}
});

for(const kind of ['ok','refused','failed'] as const) test(`D924 create/resend persist ${kind}, legacy email callers retain booleans`,async()=>{
 const f=fixture();credentials(f);const tx=transport(kind);try{
 const created=await call(f,'POST','/invitations',{recipient_email:'mail@example.invalid',allowed_deal_types:['custom']});assert.equal(created.status,201);
 const expected=kind==='ok'?null:kind;
 assert.equal(row(f,created.body.id).last_send_ok,kind==='ok'?1:0);assert.equal(row(f,created.body.id).last_send_reason,expected);
 const resent=await call(f,'POST',`/invitations/${created.body.id}/resend`);assert.equal(resent.body.email_sent,kind==='ok');assert.equal(row(f,created.body.id).send_count,2);assert.equal(row(f,created.body.id).last_send_reason,expected);
 assert.equal(await sendPartnerInvitationEmail(f.env,'mail@example.invalid','Synthetic','Admin','https://example.invalid',''),kind==='ok');
 assert.equal(await sendAgreementAssignedEmail(f.env,'mail@example.invalid','Synthetic','Agreement','https://example.invalid','Admin'),kind==='ok');
 }finally{tx.restore();f.db.close();}
});

test('D924 suppression is recorded without any transport call',async()=>{
 const f=fixture();credentials(f);try{
 f.db.prepare("INSERT INTO email_suppressions(email,reason) VALUES('blocked@example.invalid','complaint')").run();
 const orig=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not send');};
 try{const r=await call(f,'POST','/invitations',{recipient_email:'blocked@example.invalid',allowed_deal_types:['custom']});assert.equal(r.status,201);assert.equal(row(f,r.body.id).last_send_reason,'suppressed');assert.equal(row(f,r.body.id).last_send_ok,0);
 assert.deepEqual(await sendAgreementAssignedEmailResult(f.env,'blocked@example.invalid','','Agreement','https://example.invalid','Admin'),{ok:false,reason:'suppressed'});assert.equal(calls,0);
 }finally{globalThis.fetch=orig;}
 }finally{f.db.close();}
});

test('D924 email filter treats %, _ and backslash literally',async()=>{
 const f=fixture();try{
 for(const email of ['a%b@example.invalid','axb@example.invalid','a_b@example.invalid','a\\b@example.invalid'])invite(f,'selected',email);
 for(const needle of ['%','_','\\']){const r=await call(f,'GET','/invitations?email='+encodeURIComponent(needle));assert.equal(r.status,200);assert.deepEqual(r.body.items.map((i:any)=>i.recipient_email),[`a${needle}b@example.invalid`]);}
 assert.equal((await call(f,'GET','/invitations?email=EXAMPLE')).body.items.length,4);
 }finally{f.db.close();}
});

test('D924 signed/revoked/missing invitations retain resend refusals and no writes; outside roles denied',async()=>{
 const f=fixture();try{
 for(const stage of ['signed','revoked']){const id=invite(f,stage);const before=row(f,id);assert.equal((await call(f,'POST',`/invitations/${id}/resend`)).status,409);assert.deepEqual(row(f,id),before);}
 assert.equal((await call(f,'POST','/invitations/999/resend')).status,404);
 const id=invite(f);for(const who of [null,9]){const r=await call(f,'POST',`/invitations/${id}/resend`,undefined,who);assert.ok([401,403].includes(r.status));}assert.equal(row(f,id).send_count,1);
 const list=await call(f,'GET','/invitations');assert.ok(list.body.items.filter((i:any)=>['signed','revoked'].includes(i.status)).every((i:any)=>i.is_expired===false));
 }finally{f.db.close();}
});

async function agreement(f:F) {
 // Warm the real e-sign bootstrap, then create a small synthetic native envelope.
 await esignCall(f.env,'GET','/99999',ADMIN);
 const id=invite(f,'finalized');
 const envId=Number(f.db.prepare(`INSERT INTO esign_envelopes(envelope_uuid,document_type,document_title,document_body,body_sha256,status,created_by) VALUES(?,'partner_services','Synthetic partnership','Synthetic terms','synthetic','sent',5)`).run(crypto.randomUUID()).lastInsertRowid);
 f.db.prepare('UPDATE partner_invitations SET envelope_id=? WHERE id=?').run(envId,id);
 f.db.prepare(`INSERT INTO esign_recipients(envelope_id,recipient_email,recipient_name,signing_token,token_expires_at,status) VALUES(?,'PARTNER@example.invalid','Synthetic Partner',?,'2000-01-01','pending')`).run(envId,'a'.repeat(64));
 f.db.prepare(`INSERT INTO partner_deals(invitation_id,deal_type,proposal_json,envelope_id,status) VALUES(?,'custom','{}',?,'awaiting_signature')`).run(id,envId);
 return {id,envId};
}

test('D924 a different admin renews the matching agreement link for the full 14 days, without leaking it',async()=>{
 const f=fixture();const {id,envId}=await agreement(f);credentials(f);const tx=transport('ok');try{
 // Another recipient and another envelope must not be renewed or emailed.
 f.db.prepare(`INSERT INTO esign_recipients(envelope_id,recipient_email,signing_token,token_expires_at,status) VALUES(?,'other@example.invalid',?,'2000-01-01','pending')`).run(envId,'b'.repeat(64));
 const r=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(r.status,200);assert.equal(r.body.email_sent,true);
 const recipient:any=f.db.prepare("SELECT * FROM esign_recipients WHERE recipient_email='PARTNER@example.invalid'").get();assert.notEqual(recipient.signing_token,'a'.repeat(64));assert.equal(recipient.token_expires_at,row(f,id).expires_at);assert.ok(Date.parse(recipient.token_expires_at)>Date.now()+13*86400000);
 assert.equal(row(f,id).status,'finalized');assert.equal(row(f,id).last_send_ok,1);assert.equal(row(f,id).last_send_reason,null);
 assert.equal(tx.mails.length,1);assert.match(tx.mails[0],/PARTNER@example.invalid/);const decoded=Buffer.from(tx.mails[0].split('Content-Transfer-Encoding: base64')[1].split('\r\n\r\n')[1].split('\r\n--')[0].replace(/\s/g,''),'base64').toString('utf8');assert.ok(decoded.includes(recipient.signing_token));assert.match(decoded,/expires in 14 days/);
 assert.ok(!JSON.stringify(r.body).includes(recipient.signing_token));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM esign_audit_events').all()).includes(recipient.signing_token));
 assert.equal((f.db.prepare("SELECT signing_token FROM esign_recipients WHERE recipient_email='other@example.invalid'").get() as any).signing_token,'b'.repeat(64));
 assert.equal((f.db.prepare("SELECT signer_id FROM esign_audit_events WHERE action='partner_signing_link_renewed'").get() as any).signer_id,8);
 assert.equal((await esignCall(f.env,'GET','/sign/'+ 'a'.repeat(64),null)).status,404);
 assert.equal((await esignCall(f.env,'GET','/sign/'+recipient.signing_token,null)).status,200);
 }finally{tx.restore();f.db.close();}
});

for(const reason of ['invitation_revoked','link_lapsed'] as const) test(`D924 activation persists ${reason} and grants nothing`,async()=>{
 const f=fixture();try{const {id,envId}=await agreement(f);
 f.db.prepare("UPDATE esign_envelopes SET status='completed' WHERE id=?").run(envId);
 if(reason==='invitation_revoked')f.db.prepare("UPDATE partner_invitations SET status='revoked' WHERE id=?").run(id);
 const result=await activatePartnerDealOnSignature(f.env,envId);assert.equal(result?.activated,false);assert.equal(result?.void_reason,reason);
 const deal:any=f.db.prepare('SELECT * FROM partner_deals WHERE envelope_id=?').get(envId);assert.equal(deal.status,'voided');assert.equal(deal.void_reason,reason);assert.equal(deal.user_id,null);assert.equal(deal.referral_code,null);assert.equal(row(f,id).status,reason==='link_lapsed'?'expired':'revoked');
 const list=await call(f,'GET','/deals?status=voided');assert.equal(list.body.items[0].void_reason,reason);
 }finally{f.db.close();}
});

test('D924 admin revocation persists its distinct reason',async()=>{
 const f=fixture();try{const {id,envId}=await agreement(f);const r=await call(f,'POST',`/invitations/${id}/revoke`,{reason:'Synthetic revocation'});assert.equal(r.status,200);assert.equal((f.db.prepare('SELECT void_reason FROM partner_deals WHERE envelope_id=?').get(envId) as any).void_reason,'admin_revoked');assert.equal((f.db.prepare('SELECT status FROM esign_envelopes WHERE id=?').get(envId) as any).status,'voided');
 }finally{f.db.close();}
});

test('D924 migration applies to fresh canonical schema and backfills only recorded sends, once per dual audit',()=>{
 const f=fixture(false);try{
 const id=invite(f), unknown=invite(f);
 const payload=JSON.stringify({invitation_id:id,email_sent:true});
 f.db.prepare("INSERT INTO admin_audit_log(admin_user_id,action,filters_json,exported_at) VALUES(5,'partner_invitation_created',?,'2026-01-01 12:00:00')").run(payload);
 f.db.prepare("INSERT INTO activity_logs(action,details,created_at) VALUES('partner_invitation_created',?,'2026-01-01 12:00:00')").run(payload);
 f.db.prepare("INSERT INTO activity_logs(action,details,created_at) VALUES('partner_invitation_resent',?,'2026-01-02 12:00:00')").run(JSON.stringify({invitation_id:id,email_sent:false}));
 f.db.exec("INSERT INTO activity_logs(action,details) VALUES('partner_invitation_resent','not-json')");
 f.db.exec(migration);
 assert.equal(row(f,id).send_count,2);assert.equal(row(f,id).last_send_ok,0);assert.equal(row(f,id).last_send_reason,null);assert.equal(row(f,id).last_sent_at,'2026-01-02T12:00:00.000Z');
 assert.equal(row(f,unknown).send_count,1);assert.equal(row(f,unknown).last_send_ok,null);assert.equal(row(f,unknown).last_send_reason,null);assert.equal(row(f,unknown).last_sent_at,null);
 assert.throws(()=>f.db.prepare('UPDATE partner_invitations SET last_send_ok=2 WHERE id=?').run(id));assert.throws(()=>f.db.prepare("UPDATE partner_invitations SET last_send_reason='delivered' WHERE id=?").run(id));
 }finally{f.db.close();}
});

for(const reason of ['invitation_revoked','link_lapsed','admin_revoked'] as const) test(`D924 completion tells sender signed but voided: ${reason}`,async()=>{
 const f=fixture();try{const {id,envId}=await agreement(f);
 f.db.prepare("UPDATE esign_recipients SET token_expires_at='2999-01-01' WHERE envelope_id=?").run(envId);
 if(reason==='invitation_revoked'||reason==='admin_revoked')f.db.prepare("UPDATE partner_invitations SET status='revoked' WHERE id=?").run(id);
 if(reason==='admin_revoked')f.db.prepare("UPDATE partner_deals SET status='voided',void_reason='admin_revoked' WHERE envelope_id=?").run(envId);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
 const signed=await esignCall(f.env,'POST','/sign/'+'a'.repeat(64),null,{accepted:true,typed_name:'Synthetic Partner',signature_data_url:png});assert.equal(signed.status,200,JSON.stringify(signed.body));
 const notice:any=f.db.prepare("SELECT title,body FROM notifications_inbox WHERE user_id=5 AND type='contract_signed'").get();assert.ok(notice);assert.match(notice.title,/Signed, deal voided/);assert.doesNotMatch(notice.title,/executed/);assert.match(notice.body,reason==='link_lapsed'?/link lapsed before signing/:reason==='admin_revoked'?/admin revoked the deal/:/invitation was revoked/);assert.match(notice.body,/No partner benefits were activated/);
 assert.equal((f.db.prepare('SELECT void_reason FROM partner_deals WHERE envelope_id=?').get(envId) as any).void_reason,reason);
 }finally{f.db.close();}
});

test('D924 detailed missing configuration and boolean false agree',async()=>{
 const f=fixture();try{
 assert.deepEqual(await sendPartnerInvitationEmailResult(f.env,'partner@example.invalid','','Admin','https://example.invalid',''),{ok:false,reason:'not_configured'});
 assert.deepEqual(await sendAgreementAssignedEmailResult(f.env,'partner@example.invalid','','Agreement','https://example.invalid','Admin'),{ok:false,reason:'not_configured'});
 }finally{f.db.close();}
});

for(const kind of ['refused','failed'] as const) test(`D924 agreement resend records ${kind} and still preserves progress`,async()=>{
 const f=fixture();const {id}=await agreement(f);credentials(f);const tx=transport(kind);try{
 const r=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(r.status,200);assert.equal(r.body.email_sent,false);assert.equal(row(f,id).last_send_reason,kind);assert.equal(row(f,id).last_send_ok,0);assert.equal(row(f,id).status,'finalized');
 const previous:any=f.db.prepare("SELECT signing_token,token_expires_at FROM esign_recipients WHERE envelope_id=(SELECT envelope_id FROM partner_invitations WHERE id=?)").get(id);assert.equal(previous.signing_token,'a'.repeat(64));assert.equal(previous.token_expires_at,'2000-01-01');
 const audit:any=f.db.prepare("SELECT meta FROM esign_audit_events WHERE action='partner_signing_link_renewal_failed'").get();assert.equal(JSON.parse(audit.meta).link_renewed,false);assert.equal(JSON.parse(audit.meta).previous_link_restored,true);
 }finally{tx.restore();f.db.close();}
});

test('D924 failed renewal keeps a still-valid prior signing link and Remind has a separate throttle',async()=>{
 const f=fixture();const {id,envId}=await agreement(f);credentials(f);const tx=transport('refused');try{
 f.db.prepare("UPDATE esign_recipients SET token_expires_at='2999-01-01' WHERE envelope_id=?").run(envId);
 const resent=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(resent.body.email_sent,false);
 assert.equal((await esignCall(f.env,'GET','/sign/'+'a'.repeat(64),null)).status,200);
 assert.equal((f.db.prepare('SELECT token_expires_at FROM esign_recipients WHERE envelope_id=?').get(envId) as any).token_expires_at,'2999-01-01');
 }finally{tx.restore();f.db.close();}
 const g=fixture();const other=await agreement(g);credentials(g);const ok=transport('ok');try{
 await call(g,'POST',`/invitations/${other.id}/resend`);
 const reminded=await esignCall(g.env,'POST',`/${other.envId}/remind`,5);assert.equal(reminded.status,200,JSON.stringify(reminded.body));
 }finally{ok.restore();g.db.close();}
});

test('D924 no pending partner signature falls back to invitation mail and does not touch a countersigner',async()=>{
 const f=fixture();const {id,envId}=await agreement(f);credentials(f);const tx=transport('ok');try{
 f.db.prepare("UPDATE esign_recipients SET status='signed' WHERE envelope_id=?").run(envId);
 f.db.prepare(`INSERT INTO esign_recipients(envelope_id,recipient_email,signing_token,token_expires_at,status) VALUES(?,'counter@example.invalid',?,'2999-01-01','pending')`).run(envId,'c'.repeat(64));
 const resent=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(resent.body.email_sent,true);assert.equal(row(f,id).last_send_reason,null);assert.equal(tx.mails.length,1);assert.match(tx.mails[0],/To: partner@example.invalid/);assert.equal((f.db.prepare("SELECT signing_token FROM esign_recipients WHERE recipient_email='counter@example.invalid'").get() as any).signing_token,'c'.repeat(64));
 }finally{tx.restore();f.db.close();}
});

test('D924 concurrent failed resend cannot restore over a newer successful signing link',async()=>{
 const f=fixture();const {id,envId}=await agreement(f);credentials(f);const original=globalThis.fetch;let sends=0;let newer='';
 globalThis.fetch=async(input:any)=>{
  if(String(input)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic'});
  assert.equal(String(input),'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  if(++sends===1){const second=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(second.body.email_sent,true);newer=(f.db.prepare('SELECT signing_token FROM esign_recipients WHERE envelope_id=?').get(envId) as any).signing_token;return Response.json({error:'synthetic refusal'},{status:403});}
  return Response.json({id:'synthetic-message'});
 };
 try{const first=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(first.body.email_sent,false);assert.equal(sends,2);assert.notEqual(newer,'a'.repeat(64));assert.equal((f.db.prepare('SELECT signing_token FROM esign_recipients WHERE envelope_id=?').get(envId) as any).signing_token,newer);assert.equal(row(f,id).send_count,3);assert.equal((await esignCall(f.env,'GET','/sign/'+newer,null)).status,200);
 }finally{globalThis.fetch=original;f.db.close();}
});

test('D924 backfill preserves distinct same-second attempts when one audit store missed a write',()=>{
 const f=fixture(false);try{const id=invite(f);
 const good=JSON.stringify({invitation_id:id,email_sent:true}),bad=JSON.stringify({invitation_id:id,email_sent:false});
 f.db.prepare("INSERT INTO admin_audit_log(admin_user_id,action,filters_json,exported_at) VALUES(5,'partner_invitation_resent',?,'2026-01-01 12:00:00')").run(good);
 const add=f.db.prepare("INSERT INTO activity_logs(action,details,created_at) VALUES('partner_invitation_resent',?,'2026-01-01 12:00:00')");add.run(good);add.run(good);add.run(bad);
 f.db.exec(migration);assert.equal(row(f,id).send_count,4);
 }finally{f.db.close();}
});

test('D924 historical counts include initial send and resend audits with unknown outcomes',()=>{
 const f=fixture(false);try{const id=invite(f), other=invite(f);
 const addAdmin=f.db.prepare("INSERT INTO admin_audit_log(admin_user_id,action,filters_json,exported_at) VALUES(5,'partner_invitation_resent',?,?)");
 const addActivity=f.db.prepare("INSERT INTO activity_logs(action,details,created_at) VALUES('partner_invitation_resent',?,?)");
 const good=JSON.stringify({invitation_id:id,email_sent:true}),unknown=JSON.stringify({invitation_id:id});
 for(const add of [addAdmin,addActivity]){add.run(good,'2026-01-01 12:00:00');add.run(unknown,'2026-01-02 12:00:00');}
 addAdmin.run(JSON.stringify({invitation_id:other,email_sent:false}),'2026-01-01 12:00:00');
 f.db.exec(migration);assert.equal(row(f,id).send_count,3);assert.equal(row(f,id).last_send_ok,null);assert.equal(row(f,id).last_sent_at,'2026-01-02T12:00:00.000Z');assert.equal(row(f,other).send_count,2);assert.equal(row(f,other).last_send_ok,0);
 }finally{f.db.close();}
});

for(const phase of ['expiry','token'])test(`D924 concurrent revoke at ${phase} refuses resend without mail`,async()=>{
 const f=fixture();const {id,envId}=await agreement(f);credentials(f);const tx=transport('ok');const prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=(sql:string)=>{const statement=prepare(sql);const run=statement.run.bind(statement);
 if((phase==='expiry'&&sql.includes('UPDATE partner_invitations SET expires_at'))||(phase==='token'&&sql.includes('UPDATE esign_recipients SET signing_token'))){statement.run=async()=>{f.db.prepare("UPDATE partner_invitations SET status='revoked' WHERE id=?").run(id);f.db.prepare("UPDATE esign_envelopes SET status='voided' WHERE id=?").run(envId);return run();};}
 return statement;};
 try{const r=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(r.status,409);assert.equal(r.body.error,'Invitation has been revoked');assert.equal(tx.mails.length,0);assert.equal(row(f,id).send_count,1);assert.equal((f.db.prepare('SELECT signing_token FROM esign_recipients WHERE envelope_id=?').get(envId) as any).signing_token,'a'.repeat(64));if(phase==='expiry')assert.equal(row(f,id).expires_at,'2000-01-01T00:00:00Z');
 }finally{tx.restore();f.db.close();}
});

test('D924 stored expired stage survives resend and the renewed public onboarding read is usable',async()=>{
 const f=fixture();const {id,envId}=await agreement(f);credentials(f);const tx=transport('ok');try{
 f.db.prepare("UPDATE partner_invitations SET status='expired' WHERE id=?").run(id);
 f.db.prepare("UPDATE esign_envelopes SET status='completed' WHERE id=?").run(envId);
 f.db.prepare("UPDATE partner_deals SET status='voided',void_reason='link_lapsed' WHERE envelope_id=?").run(envId);
 const sent=await call(f,'POST',`/invitations/${id}/resend`);assert.equal(sent.status,200);assert.equal(sent.body.email_sent,true);assert.equal(row(f,id).status,'expired');assert.equal(row(f,id).last_send_ok,1);
 const publicApp=new Hono<any>().route('/',onboard);const opened=await publicApp.request('/'+row(f,id).token,{},f.env);assert.equal(opened.status,200);const body:any=await opened.json();assert.equal(body.invitation.status,'expired');assert.equal(body.deal.status,'voided');assert.equal((f.db.prepare('SELECT void_reason FROM partner_deals WHERE envelope_id=?').get(envId) as any).void_reason,'link_lapsed');
 }finally{tx.restore();f.db.close();}
});

test('D924 assigned migration 547 also applies after already-recorded migration 548',()=>{
 const f=fixture(false);try{
 f.db.exec(read('cloudflare-worker/sql/migrations/548_partner_deal_activation_error.sql'));
 const id=invite(f);
 f.db.prepare("INSERT INTO partner_deals(invitation_id,deal_type,proposal_json,activation_error,status) VALUES(?,'custom','{}','activation_failed','awaiting_signature')").run(id);
 f.db.exec(migration);
 const deal:any=f.db.prepare('SELECT activation_error,void_reason FROM partner_deals WHERE invitation_id=?').get(id);assert.equal(deal.activation_error,'activation_failed');assert.equal(deal.void_reason,null);assert.equal(row(f,id).send_count,1);
 }finally{f.db.close();}
});
