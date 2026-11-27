/** D647 — real routes over the canonical SQLite schema, including >200 agreements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import registry from '../src/routes/admin_contract_doc_registry.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-d647-012345678901234567';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const seedNow = Date.now();
const ago = (days: number) => new Date(seedNow - days * 86400000).toISOString();
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents',
    'projects', 'founders', 'deals', 'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'pairwise_ndas', 'partner_deals', 'partner_referral_redemptions', 'legal_templates', 'legal_template_versions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/332_contract_doc_type_registry.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/416_contract_doc_type_pending_draft.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/434_contract_template_publications.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/479_template_kind_party.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/264_admin_notices.sql', 'utf8'));
  const user = db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)');
  user.run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  user.run(2, 'admin', 'Plain admin', 'admin@example.test', 1);
  user.run(3, 'founder', 'Founder', 'founder@example.test', 1);
  user.run(4, 'investor', 'Literal%_ investor', 'literal@example.test', 1);
  user.run(5, 'investor', 'Inactive', 'inactive@example.test', 0);
  db.exec('INSERT INTO super_admins(user_id) VALUES(1)');
  db.exec("INSERT INTO projects(id,name) VALUES(9,'Acme'),(10,'Beta'); INSERT INTO deals(id,project_id) VALUES(90,10)");
  const doc = db.prepare("INSERT INTO documents(uid,title,doc_type,status,template_name,project_id,created_at) VALUES(?,?,'safe','generated','safe',9,?)");
  for (let i = 0; i < 250; i++) doc.run(`doc-${i}`, `Agreement ${String(i).padStart(3,'0')}`, ago(40));
  const envelope = db.prepare("INSERT INTO esign_envelopes(id,envelope_uuid,deal_id,document_type,document_title,document_body,body_sha256,created_by,status,created_at,completed_at,provider) VALUES(?,?,90,'investor_nda_axal',?,'body','hash',1,?,?,?,?)");
  const statuses = ['completed', 'viewed', 'rejected', 'completed', 'completed', 'sent'];
  for (let i = 0; i < statuses.length; i++) {
    const signed = i === 0 ? ago(1) : i === 3 ? ago(50) : i === 4 ? ago(-2) : null;
    envelope.run(i+1, `env-${i}`, `Envelope ${i}`, statuses[i], ago(60), signed, i === 2 ? 'docusign' : 'native');
    db.prepare('INSERT INTO esign_recipients(envelope_id,recipient_name,recipient_email,signing_token,token_expires_at) VALUES(?,?,?,?,?)')
      .run(i+1, 'Ivy', 'asigner@example.test', `private-token-${i}`, ago(-7));
  }
  db.exec("INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(3,4,'pending'); INSERT INTO partner_deals(user_id,deal_type,status,proposal_json) VALUES(4,'services','pending','{}')");
  return db;
}
const app = new Hono<any>();
app.route('/contracts/registry', registry);
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, path: string, who: number | null = 2, method = 'GET', body?: unknown, extraEnv = {}) {
  const headers: Record<string,string> = {};
  if (who) headers.Authorization = `Bearer ${await new SignJWT({user_id: who, role: who <= 2 ? 'admin' : 'founder'})
    .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app.request(`/contracts${path}`, {method,headers, ...(body !== undefined ? {body:JSON.stringify(body)} : {})}, {JWT_SECRET:SECRET,ENVIRONMENT:'development',DB:d1Over(db), ...extraEnv});
  return {status:res.status,body:await res.json() as any};
}

test('D647: all four stores page past 200 with a stable order and exact total', async () => {
  const db=fixture();
  const pages=[];
  for (const offset of [0,100,200]) {
    const r=await call(db,`?limit=100&offset=${offset}&sort=title&direction=asc`);
    assert.equal(r.status,200); assert.equal(r.body.total,258); assert.equal(r.body.offset,offset);
    assert.equal(r.body.sort,'title'); assert.equal(r.body.direction,'asc');
    assert.equal(r.body.items.length,offset===200?58:100); pages.push(...r.body.items);
  }
  assert.equal(new Set(pages.map(r=>`${r.source}:${r.id}`)).size,258);
  assert.equal(pages[0].uid,'doc-0'); assert.equal(pages[199].uid,'doc-199');
  assert.deepEqual([...new Set(pages.map(r=>r.source))].sort(),['documents','esign','pairwise_nda','partner_deal']);
  const desc=await call(db,'?limit=1&sort=title&direction=desc'); assert.equal(desc.body.items[0].source,'partner_deal');
  const same=await call(db,'?limit=3&offset=200&sort=created_at&direction=asc');
  assert.deepEqual(same.body.items.map((r:any)=>r.uid),['doc-194','doc-195','doc-196']);
  const signed=await call(db,'?limit=500&sort=signed_at&direction=desc');
  assert.equal(signed.body.items[0].uid,'env-4'); assert.equal(signed.body.items.at(-1).signed_at,null);
  const days=await call(db,'?limit=1&sort=days_to_sign&direction=asc'); assert.equal(days.body.items[0].uid,'env-3');
  const recipient=await call(db,'?limit=500&sort=recipient&direction=asc'); assert.equal(recipient.body.items[0].recipient_email,'asigner@example.test');
});

test('D647: counts, template links, company, recipient, role, provider and recent-signature filters agree', async () => {
  const db=fixture();
  for(const [query,total] of [['status=awaiting_signature',254],['template=safe',250],['q=Beta',6],['q=Ivy',6],['party_role=investor&provider=docusign',1],['signed_recent=true',1],['status=all',258],['project_id=10',6]] as const) {
    const r=await call(db,`?${query}`); assert.equal(r.status,200,query); assert.equal(r.body.total,total,query);
  }
  const viewed=await call(db,'?status=sent&q=Envelope%201'); assert.equal(viewed.body.items[0].raw_status,'viewed');
  const declined=await call(db,'?status=void'); assert.equal(declined.body.items[0].raw_status,'rejected');
  const stats=await call(db,'/stats'); assert.equal(stats.body.total,258); assert.equal(stats.body.pending_signature,254);
  assert.equal(stats.body.signed_last_30d,1); assert.equal(stats.body.avg_days_to_sign,43.7);
  db.prepare("UPDATE esign_envelopes SET completed_at=NULL").run();
  assert.equal((await call(db,'/stats')).body.avg_days_to_sign,null);
});

test('D647: malformed paging, sorting and filters are refused, never reinterpreted', async()=>{
  const db=fixture();
  for(const query of ['limit=-1','limit=0','limit=501','offset=-1','offset=1x','offset=9007199254740992','sort=__proto__','direction=sideways','status=invalid','provider=unknown','party_role=unknown','project_id=1x','signed_recent=no',`q=${'x'.repeat(201)}`]) {
    assert.equal((await call(db,`?${query}`)).status,400,query);
  }
  const defaults=await call(db,''); assert.equal(defaults.body.limit,50); assert.equal(defaults.body.offset,0); assert.equal(defaults.body.items.length,50);
  const zero=await call(db,'?offset=1000000'); assert.equal(zero.body.items.length,0); assert.equal(zero.body.total,258);
});

test('D647: picker searches are literal, paged, minimal and scoped away from other admins',async()=>{
  const db=fixture();
  const plain=await call(db,'/recipients?limit=2'); assert.equal(plain.body.total,3);
  assert.deepEqual(plain.body.items.map((r:any)=>r.id),[3,4]);
  assert.deepEqual(Object.keys(plain.body.items[0]).sort(),['email','id','name','role']);
  const rest=await call(db,'/recipients?limit=2&offset=2'); assert.deepEqual(rest.body.items.map((r:any)=>r.id),[2]);
  assert.equal((await call(db,'/recipients',1)).body.total,4);
  const literal=await call(db,'/recipients?q=%25_'); assert.deepEqual(literal.body.items.map((r:any)=>r.id),[4]);
  assert.equal((await call(db,"/recipients?q=' OR 1=1 --")).body.total,0);
  const deal=await call(db,'/deal-options?q=Beta'); assert.equal(deal.body.total,1);
  assert.deepEqual(deal.body.items[0],{id:90,uid:db.prepare('SELECT uid FROM deals').get()!.uid,status:'applied',project_id:10,project_name:'Beta'});
  assert.equal((await call(db,'/deal-options?offset=1')).body.items.length,0);
  assert.equal((await call(db,'/deal-options?q=%25')).body.total,0);
});

test('D647: template fields derive from the body, hide unusable templates and never infer publication from a draft',async()=>{
  const db=fixture();
  db.prepare("INSERT INTO legal_templates(slug,title,body_md,merge_fields,version) VALUES('safe','SAFE',?,'[\"stale\"]',3)")
    .run('{{recipient_email}} {{counterparty.name}} {{price}} {{price}} {{scope}}');
  const r=await call(db,'/templates/store/safe/fields'); assert.equal(r.status,200); assert.equal(r.body.version,3);
  assert.deepEqual(r.body.fields.map((f:any)=>[f.key,f.required,f.filled_by]),[
    ['counterparty.name',false,'send'],['price',true,'sender'],['recipient_email',false,'send'],['scope',true,'sender'],
  ]);
  assert.equal(r.body.fields[0].label,'counterparty name');
  assert.equal(r.body.publication_state,'unpublished'); assert.ok(r.body.publication_reason.length>30);
  for(const update of ['is_stub=1','is_stub=0,is_active=0',"is_active=1,body_md=' '"]) {
    db.exec(`UPDATE legal_templates SET ${update}`); assert.equal((await call(db,'/templates/store/safe/fields')).status,404);
  }
  assert.equal((await call(db,'/templates/store/missing/fields')).status,404);
  assert.equal((await call(db,'/templates/store/a%27/fields')).status,404);
});

test('D647: missing union stores and picker reads fail visibly instead of reporting zero',async()=>{
  for(const table of ['pairwise_ndas','partner_deals','esign_envelopes','documents']) {
    const db=fixture(); db.exec(`DROP TABLE ${table}`);
    for(const path of ['','/stats']) {
      const r=await call(db,path); assert.equal(r.status,503,table); assert.equal(r.body.code,'contracts_unreadable'); assert.equal(r.body.total,undefined);
    }
  }
  const db=fixture(); db.exec('DROP TABLE deals'); assert.equal((await call(db,'/deal-options')).status,503);
});

test('D647: admin reads refuse anonymous/members; every registry route refuses plain admins',async()=>{
  const db=fixture();
  for(const path of ['','/recipients','/deal-options','/templates/store/safe/fields']) {
    assert.equal((await call(db,path,null)).status,401,path); assert.equal((await call(db,path,3)).status,403,path);
  }
  for(const [path,method] of [['/registry','GET'],['/registry/doc-types','GET'],['/registry/draft','POST'],['/registry/safe/publish','POST']] as const) {
    const r=await call(db,path,2,method); assert.equal(r.status,403,`${method} ${path}`);
    assert.equal(r.body.error,'Super admin required');
  }
  assert.equal((await call(db,'/registry',1)).status,200);
});

test('D647: the desk uses recorded send times, not creation or synthetic activity dates', async () => {
  const db=fixture();
  db.exec("UPDATE pairwise_ndas SET status='active',updated_at='2026-10-07T10:00:00Z'; UPDATE partner_deals SET status='active'");
  db.prepare("INSERT INTO esign_audit_events(envelope_id,ts,action) VALUES(1,?,'email_sent')").run(ago(3));
  const rows=await call(db,'?recorded=true&sort=sent_at&limit=500');
  assert.equal(rows.status,200);
  const signed=rows.body.items.find((r:any)=>r.uid==='env-0');
  assert.equal(signed.sent_at,ago(3)); assert.equal(signed.days_to_sign,2);
  assert.equal(rows.body.items.find((r:any)=>r.uid==='env-3').days_to_sign,null);
  assert.equal(rows.body.items.find((r:any)=>r.source==='pairwise_nda').signed_at,null);
  const stats=await call(db,'/stats?recorded=true'); assert.equal(stats.body.avg_days_to_sign,2);
  db.exec('DELETE FROM esign_audit_events'); assert.equal((await call(db,'/stats?recorded=true')).body.avg_days_to_sign,null);
  db.exec('DROP TABLE esign_audit_events'); assert.equal((await call(db,'?recorded=true')).status,503);
});

test('D647: published picker, preview and send verify the same version and body before any write', async()=>{
  const db=fixture();
  db.exec("INSERT INTO legal_templates(slug,title,body_md,version) VALUES('safe','SAFE','Hello {{recipient_name}} {{price}}',3)");
  assert.equal((await call(db,'/published-templates')).body.items.length,0);
  const publish=await call(db,'/published-templates/publish',1,'POST',{}); assert.equal(publish.status,200); assert.equal(publish.body.template_count,1);
  const picker=await call(db,'/published-templates'); assert.equal(picker.body.items[0].version,3); assert.equal(picker.body.items[0].body_md,undefined);
  const input={template_slug:'safe',template_version:3,recipient_name:'New signer',recipient_email:'new@example.test',fields:{price:'100'},provider:'native'};
  const count=()=>Number(db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get()!.n);
  const before=count();
  const missing=await call(db,'/envelopes/preview',1,'POST',{...input,fields:{}}); assert.equal(missing.status,422); assert.deepEqual(missing.body.fields,['price']);
  const preview=await call(db,'/envelopes/preview',1,'POST',input); assert.equal(preview.status,200); assert.ok(atob(preview.body.pdf_base64).startsWith('%PDF-')); assert.match(preview.body.body_sha256,/^[a-f0-9]{64}$/);
  db.exec("UPDATE legal_templates SET body_md='Draft change',version=4");
  const stillApproved=await call(db,'/envelopes/preview',1,'POST',input); assert.equal(stillApproved.body.body_sha256,preview.body.body_sha256);
  const forged=await call(db,'/envelopes/send',1,'POST',{...input,preview_sha256:'forged'}); assert.equal(forged.status,409); assert.equal(count(),before);
  const changed=await call(db,'/envelopes/send',1,'POST',{...input,fields:{price:'200'},preview_sha256:preview.body.body_sha256}); assert.equal(changed.status,409); assert.equal(count(),before);
  await call(db,'/published-templates/publish',1,'POST',{});
  const stale=await call(db,'/envelopes/send',1,'POST',{...input,preview_sha256:preview.body.body_sha256}); assert.equal(stale.status,409); assert.equal(count(),before);
});

test('D647: signing history projects no bearer secrets, scopes other admins, hashes actual PDF bytes',async()=>{
  const db=fixture();
  db.exec("INSERT INTO esign_audit_events(envelope_id,action,meta,ip) VALUES(1,'envelope_signed','{\"signing_url\":\"secret-test-link\"}','203.0.113.1'); UPDATE esign_envelopes SET signed_r2_key='esign/signed/test.pdf' WHERE id=1");
  assert.equal((await call(db,'/env-0/history',2)).status,403);
  const history=await call(db,'/env-0/history',1); assert.equal(history.status,200); assert.equal(history.body.parties[0].email,'asigner@example.test'); assert.equal(history.body.timeline[0].action,'envelope_signed'); assert.doesNotMatch(JSON.stringify(history.body),/signing_token|secret-test-link|meta/);
  const bytes=new TextEncoder().encode('%PDF-1.7\nactual signed document');
  const pdf=await call(db,'/env-0/signed-pdf',1,'GET',undefined,{FILES:{get:async()=>({size:bytes.length,arrayBuffer:async()=>bytes.buffer})}});
  assert.equal(pdf.status,200); assert.equal(pdf.body.available,true); assert.equal(atob(pdf.body.pdf_base64),new TextDecoder().decode(bytes));
  const expected=await crypto.subtle.digest('SHA-256',bytes); assert.equal(pdf.body.sha256,Array.from(new Uint8Array(expected),b=>b.toString(16).padStart(2,'0')).join(''));
  assert.equal((await call(db,'/env-0/signed-pdf',2)).status,403);
  assert.equal((await call(db,'/env-0/signed-pdf',1,'GET',undefined,{FILES:{get:async()=>null}})).status,503);
  assert.equal((await call(db,'/env-1/signed-pdf',1)).body.available,false);
  db.exec('DROP TABLE esign_audit_events'); assert.equal((await call(db,'/env-0/history',1)).status,503);
});

test('D647: NDA/deal tabs count and page real rows; missing stores never become empty answers',async()=>{
  const db=fixture();
  const nda=await call(db,'/pairwise-ndas?q=Founder&limit=1'); assert.equal(nda.body.total,1); assert.equal(nda.body.items.length,1);
  const next=await call(db,'/pairwise-ndas?offset=1'); assert.equal(next.body.total,1); assert.equal(next.body.items.length,0);
  const deals=await call(db,'/partner-deals?status=pending&deal_type=services'); assert.equal(deals.body.total,1); assert.equal(deals.body.items[0].redemption_count,0);
  db.exec('DROP TABLE pairwise_ndas; DROP TABLE partner_deals');
  assert.equal((await call(db,'/pairwise-ndas')).status,503); assert.equal((await call(db,'/partner-deals')).status,503);
});

test('D647: the guided native send stores the approved body, binds its signer and omits bearer URLs',async()=>{
  const db=fixture();
  db.exec("INSERT INTO legal_templates(slug,title,body_md,version) VALUES('safe','SAFE','Hello {{recipient_name}} {{price}}',3)");
  await call(db,'/published-templates/publish',1,'POST',{});
  const input={template_slug:'safe',template_version:3,recipient_name:'Founder',recipient_email:'founder@example.test',fields:{price:'100'},provider:'native'};
  const preview=await call(db,'/envelopes/preview',1,'POST',input);
  const result=await call(db,'/envelopes/send',1,'POST',{...input,preview_sha256:preview.body.body_sha256});
  assert.equal(result.status,200); assert.equal(result.body.signing_url,undefined); assert.equal(result.body.template_version,3);
  const env=db.prepare('SELECT document_body,body_sha256,created_by FROM esign_envelopes WHERE envelope_uuid=?').get(result.body.envelope_uuid)!;
  assert.equal(env.document_body,'Hello Founder 100'); assert.equal(env.body_sha256,preview.body.body_sha256); assert.equal(env.created_by,1);
  const signer=db.prepare('SELECT user_id FROM esign_recipients WHERE envelope_id=?').get(result.body.envelope_id)!; assert.equal(signer.user_id,3);
  const audit=db.prepare("SELECT user_id,details FROM activity_logs WHERE action='contract_envelope_send_requested'").get()!; assert.equal(audit.user_id,1); assert.equal(JSON.parse(String(audit.details)).template_version,3); assert.doesNotMatch(String(audit.details),/founder@example|signing_url/);
});

test('D647: every new publication/envelope/history route rejects anonymous and member callers',async()=>{
  const db=fixture();
  for(const [path,method] of [['/published-templates','GET'],['/published-templates/publish','POST'],['/envelope-providers','GET'],['/envelopes/preview','POST'],['/envelopes/send','POST'],['/env-0/history','GET'],['/env-0/signed-pdf','GET']] as const){
    assert.equal((await call(db,path,null,method,method==='POST'?{}:undefined)).status,401,path);
    assert.equal((await call(db,path,3,method,method==='POST'?{}:undefined)).status,403,path);
  }
});

test('D647: a recorded successful resend supplies the missing send date and timeline',async()=>{
  const db=fixture();
  db.prepare("INSERT INTO activity_logs(action,details,created_at) VALUES('contract_resent',?,?)").run(JSON.stringify({envelope_uuid:'env-0',email_sent:true}),ago(3));
  db.prepare("INSERT INTO activity_logs(action,details,created_at) VALUES('contract_resent',?,?)").run(JSON.stringify({envelope_uuid:'env-0',email_sent:false}),ago(4));
  const list=await call(db,'?recorded=true&sort=sent_at&limit=500'); const row=list.body.items.find((r:any)=>r.uid==='env-0');
  assert.equal(row.sent_at,ago(3)); assert.equal(row.days_to_sign,2);
  const history=await call(db,'/env-0/history',1); assert.equal(history.body.timeline.length,1); assert.equal(history.body.timeline[0].action,'email_resent'); assert.equal(history.body.timeline[0].ts,ago(3));
});

test('D647 successful DocuSign sends have a recorded send time and named timeline event',async()=>{
  const db=fixture();db.exec("UPDATE esign_envelopes SET provider='docusign' WHERE id=4");
  db.prepare("INSERT INTO esign_audit_events(envelope_id,ts,action,meta) VALUES(4,?,'envelope_created','{\"provider\":\"docusign\"}')").run(ago(52));
  const list=await call(db,'?recorded=true&limit=500');const row=list.body.items.find((r:any)=>r.uid==='env-3');assert.equal(row.sent_at,ago(52));assert.equal(row.days_to_sign,2);
  const history=await call(db,'/env-3/history',1);assert.equal(history.body.timeline[0].action,'provider_sent');
});
