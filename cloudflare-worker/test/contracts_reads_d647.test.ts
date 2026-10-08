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
    'projects', 'founders', 'deals', 'esign_envelopes', 'esign_recipients', 'pairwise_ndas', 'partner_deals', 'partner_referral_redemptions', 'legal_templates']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/332_contract_doc_type_registry.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/416_contract_doc_type_pending_draft.sql', 'utf8'));
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
async function call(db: DatabaseSync, path: string, who: number | null = 2, method = 'GET') {
  const headers: Record<string,string> = {};
  if (who) headers.Authorization = `Bearer ${await new SignJWT({user_id: who, role: who <= 2 ? 'admin' : 'founder'})
    .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  const res = await app.request(`/contracts${path}`, {method,headers}, {JWT_SECRET:SECRET,ENVIRONMENT:'development',DB:d1Over(db)});
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

test('D647: template fields derive from the body, hide unusable templates and never invent publication',async()=>{
  const db=fixture();
  db.prepare("INSERT INTO legal_templates(slug,title,body_md,merge_fields,version) VALUES('safe','SAFE',?,'[\"stale\"]',3)")
    .run('{{recipient_email}} {{counterparty.name}} {{price}} {{price}} {{scope}}');
  const r=await call(db,'/templates/store/safe/fields'); assert.equal(r.status,200); assert.equal(r.body.version,3);
  assert.deepEqual(r.body.fields.map((f:any)=>[f.key,f.required,f.filled_by]),[
    ['counterparty.name',false,'send'],['price',true,'sender'],['recipient_email',false,'send'],['scope',true,'sender'],
  ]);
  assert.equal(r.body.fields[0].label,'counterparty name');
  assert.equal(r.body.publication_state,'not_recorded'); assert.ok(r.body.publication_reason.length>30);
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
