import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deals from '../src/routes/deals.ts';
import networkfx from '../src/routes/networkfx.ts';
import legalcap from '../src/routes/legalcap.ts';
import capital from '../src/routes/capital.ts';
import contacts from '../src/routes/contacts.ts';
import deckActions from '../src/routes/deck_share_actions.ts';
import { computeRoundProgress } from '../src/services/roundMath.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const secret = 'synthetic-recorded-terms-test-secret-2443';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of ['users', 'partners', 'projects', 'deals', 'commitments', 'deal_invitations', 'activity_logs', 'user_company_links', 'super_admins',
    'legal_documents', 'esign_envelopes', 'esign_recipients', 'subsidiaries', 'capital_calls', 'syndicates', 'syndicate_members',
    'shared_services_log', 'mi_pro_subscriptions', 'raise_prospects', 'raise_rounds', 'raise_closes', 'documents', 'pitch_decks', 'pitch_deck_share_tokens']) {
    db.exec(tableFromBaseline(baseline, table));
  }
  db.exec("ALTER TABLE pitch_deck_share_tokens ADD COLUMN revoked_at TEXT");
  db.exec("ALTER TABLE pitch_deck_share_tokens ADD COLUMN allow_forwarding INTEGER DEFAULT 1");
  // 463: who a link was made for. D902 offers no deal pack on a link made for an investor.
  db.exec("ALTER TABLE pitch_deck_share_tokens ADD COLUMN prospect_id INTEGER");
  db.exec("ALTER TABLE pitch_deck_share_tokens ADD COLUMN investor_label TEXT");
  db.exec("ALTER TABLE pitch_deck_share_tokens ADD COLUMN bound_viewer_hash TEXT");
  for (const [col, type] of [['commit_status','TEXT'], ['amount','REAL'], ['close_id','INTEGER'], ['instrument','TEXT']]) {
    try { db.exec(`ALTER TABLE raise_prospects ADD COLUMN ${col} ${type}`); } catch {}
  }
  for (const [id, role] of [[1,'investor'], [2,'investor'], [3,'founder'], [4,'admin'], [5,'partner'], [6,'advisor'], [7,'exploring']]) {
    db.prepare('INSERT INTO users(id,role,email,name,founder_id,is_active,kyc_status) VALUES(?,?,?,?,?,1,?)')
      .run(id,role,`synthetic${id}@example.invalid`,'Synthetic member',id === 3 ? 30 : null,'approved');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES(1,'Synthetic venture',30),(2,'Other venture',30)");
  db.exec("INSERT INTO deals(id,project_id,status,minimum_check,capital_committed) VALUES(1,1,'active',100,9999)");
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('synthetic-1',1,10),('synthetic-2',2,20)");
  db.exec('INSERT INTO deal_invitations(deal_id,investor_user_id,company_id) VALUES(1,1,10),(1,2,20)');
  const env: any = { DB:d1Over(db), JWT_SECRET:secret, ENVIRONMENT:'development' };
  const app = new Hono<any>();
  app.route('/api/deals',deals).route('/api/networkfx',networkfx).route('/api/legalcap',legalcap)
    .route('/api/capital',capital).route('/api/contacts',contacts).route('/api/decks',deckActions);
  app.onError((err,c) => c.json({error:err.message},500));
  return { db, env, app };
}
async function call(f: ReturnType<typeof fixture>, uid: number, path: string, body?: any, method='POST') {
  const jwt = await new SignJWT({user_id:uid}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await f.app.request(path,{method,headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)},f.env);
  return {status:res.status,body:await res.json().catch(()=>null)};
}

test('pending repeats update one firm-scoped row, count only confirmed, audit and withdraw',async()=>{
  const f=fixture();try {
    let r=await call(f,1,'/api/deals/1/commitments',{amount:200});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.capital_committed,0);
    const uid=r.body.uid;
    r=await call(f,1,'/api/deals/1/commitments',{amount:300});assert.equal(r.status,200);assert.equal(r.body.uid,uid);
    assert.deepEqual({...f.db.prepare('SELECT amount,company_id,status FROM commitments').get()},{amount:300,company_id:10,status:'pending'});
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commitments').get()?.n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='deal_commitment_pending' AND user_id=1").get()?.n,2);
    f.db.exec("UPDATE commitments SET status='confirmed'");
    const read = await call(f,4,'/api/deals/1',undefined,'GET');
    assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(read.body.capital_committed,300);
    r=await call(f,1,'/api/deals/1/commitments',{amount:400});assert.equal(r.status,409);
    assert.equal((await call(f,2,`/api/deals/1/commitments/${uid}/withdraw`,{})).status,404);
    assert.equal((await call(f,1,`/api/deals/1/commitments/${uid}/withdraw`,{})).status,200);
    assert.equal(f.db.prepare('SELECT status FROM commitments').get()?.status,'withdrawn');
    assert.equal(f.db.prepare('SELECT capital_committed FROM deals').get()?.capital_committed,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='deal_commitment_withdrawn' AND user_id=1").get()?.n,1);
  }finally{f.db.close();}
});
test('commitments refuse closed deals, below-minimum amounts and uninvited callers without writes',async()=>{
  const f=fixture();try {
    assert.equal((await call(f,1,'/api/deals/1/commitments',{amount:99})).status,400);
    f.db.exec("UPDATE deals SET status='funded'");assert.equal((await call(f,1,'/api/deals/1/commitments',{amount:200})).status,409);
    f.db.exec("UPDATE deals SET status='active'; DELETE FROM deal_invitations");assert.equal((await call(f,1,'/api/deals/1/commitments',{amount:200})).status,403);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commitments').get()?.n,0);
  }finally{f.db.close();}
});
test('simultaneous pending requests do not add two rows',async()=>{
  const f=fixture();try {
    const results=await Promise.all([call(f,1,'/api/deals/1/commitments',{amount:200}),call(f,1,'/api/deals/1/commitments',{amount:300})]);
    assert.ok(results.every(r=>r.status===200));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commitments').get()?.n,1);
    assert.equal(f.db.prepare('SELECT capital_committed FROM deals').get()?.capital_committed,0);
  }finally{f.db.close();}
});
test('pledges reaching a syndicate target stay open',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO syndicates(id,deal_id,name,target_cents,min_commitment_cents,status,created_by) VALUES(1,1,'Synthetic',10000,100,'open',2)");
    const r=await call(f,1,'/api/networkfx/syndicates/1/join',{commitment_cents:10000});assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(f.db.prepare('SELECT status FROM syndicates').get()?.status,'open');
    assert.equal(f.db.prepare('SELECT closed_at FROM syndicates').get()?.closed_at,null);
  }finally{f.db.close();}
});
test('legal generation names absent terms and writes no document or money',async()=>{
  const f=fixture();try {
    const r=await call(f,4,'/api/legalcap/legal/generate',{deal_id:1,type:'SAFE'});assert.equal(r.status,400,JSON.stringify(r.body));
    assert.ok(r.body.missing_fields.includes('amount'));assert.ok(r.body.missing_fields.includes('valuation_cap'));assert.ok(r.body.missing_fields.includes('discount_rate'));assert.ok(r.body.missing_fields.includes('investor_name'));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM legal_documents').get()?.n,0);
  }finally{f.db.close();}
});
test('spin-out refuses missing paper terms before any automatic side effects',async()=>{
  const f=fixture();try {
    const r=await call(f,4,'/api/legalcap/subsidiary/spinout',{deal_id:1,force:true});assert.equal(r.status,400,JSON.stringify(r.body));
    for(const table of ['subsidiaries','legal_documents','capital_calls']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,0);
  }finally{f.db.close();}
});
for(const who of [1,2,3,4,5,6,7]) test(`retired bulk capital call is 404 for caller ${who}`,async()=>{
  const f=fixture();try {assert.equal((await call(f,who,'/api/capital/capitalCall',{startup_id:1,amount:250000})).status,404);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM capital_calls').get()?.n,0);}finally{f.db.close();}
});
test('legal signing requires the same body, deal, type, originator and completed envelope',async()=>{
  const f=fixture();try {
    const body='Synthetic agreed terms';const hash=createHash('sha256').update(body).digest('hex');
    f.db.prepare("INSERT INTO legal_documents(id,deal_id,type,status,content,generated_by) VALUES(1,1,'SAFE','generated',?,4)").run(JSON.stringify({body}));
    assert.equal((await call(f,4,'/api/legalcap/legal/docs/1/sign',{},'PATCH')).status,409);
    f.db.prepare("INSERT INTO esign_envelopes(id,envelope_uuid,deal_id,document_type,document_title,document_body,body_sha256,status,created_by) VALUES(1,'synthetic',1,'SAFE','Synthetic',?,?,'sent',4)").run(body,hash);
    assert.equal((await call(f,4,'/api/legalcap/legal/docs/1/sign',{},'PATCH')).status,409);
    f.db.exec("UPDATE esign_envelopes SET status='completed',completed_at=CURRENT_TIMESTAMP,signed_r2_key='synthetic.pdf'");
    for(const [col,bad,good] of [['body_sha256','wrong',hash],['deal_id',2,1],['document_type','wrong','SAFE'],['created_by',5,4]]) {
      f.db.prepare(`UPDATE esign_envelopes SET ${col}=?`).run(bad);assert.equal((await call(f,4,'/api/legalcap/legal/docs/1/sign',{},'PATCH')).status,409);f.db.prepare(`UPDATE esign_envelopes SET ${col}=?`).run(good);
    }
    assert.equal((await call(f,5,'/api/legalcap/legal/docs/1/sign',{},'PATCH')).status,404);
    assert.equal((await call(f,4,'/api/legalcap/legal/docs/1/sign',{},'PATCH')).status,200);
    assert.equal(f.db.prepare('SELECT status FROM legal_documents').get()?.status,'signed');
  }finally{f.db.close();}
});
async function share(f:ReturnType<typeof fixture>) {
  const body=Buffer.from(JSON.stringify({k:'deck:1:v1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const token=`${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
  f.db.exec("INSERT INTO pitch_decks(id,project_id,title,slides) VALUES(1,1,'Synthetic deck','[]')");
  f.db.prepare("INSERT INTO pitch_deck_share_tokens(id,deck_id,token_hash,expires_at,created_by,allow_forwarding) VALUES(1,1,?,datetime('now','+1 day'),3,1)").run(createHash('sha256').update(token).digest('hex'));
  return `/api/decks/share/${token}`;
}
test('deal pack missing terms writes nothing; only its viewer with a linked completed envelope can sign',async()=>{
  const f=fixture();try {
    const path=await share(f);
    let r=await call(f,1,`${path}/deal-pack`,{});assert.equal(r.status,400,JSON.stringify(r.body));assert.deepEqual(r.body.missing_fields,['check_size','valuation_cap','discount']);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM documents').get()?.n,0);
    r=await call(f,1,`${path}/deal-pack`,{check_size:'100',valuation_cap:'1000000',discount:'0%'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.documents.length,3);
    const ids=r.body.documents.map((d:any)=>d.id);
    r=await call(f,1,`${path}/deal-pack/sign`,{document_ids:ids,signed_by:'Synthetic'});assert.deepEqual(r.body.signed_ids,[]);
    const doc=f.db.prepare('SELECT content FROM documents WHERE id=?').get(ids[0]);
    f.db.prepare("INSERT INTO esign_envelopes(id,envelope_uuid,user_id,document_type,document_title,document_body,body_sha256,status,created_by,completed_at,signed_r2_key) VALUES(1,'synthetic',1,'deal_pack_safe','Synthetic',?,'hash','completed',3,CURRENT_TIMESTAMP,'synthetic.pdf')").run(doc?.content);
    f.db.prepare('UPDATE documents SET migrated_to_esign_id=1 WHERE id=?').run(ids[0]);
    r=await call(f,2,`${path}/deal-pack/sign`,{document_ids:ids,signed_by:'Synthetic'});assert.deepEqual(r.body.signed_ids,[]);
    r=await call(f,1,`${path}/deal-pack/sign`,{document_ids:ids,signed_by:'Synthetic'});assert.deepEqual(r.body.signed_ids,[ids[0]]);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM documents WHERE status='signed'").get()?.n,1);
  }finally{f.db.close();}
});
test('unset statuses never count as signed, unknown amounts stay distinct from zero',()=>{
  const p=computeRoundProgress([{amount:100,status:null},{amount:null,status:'signed'},{amount:0,status:'soft'},{amount:20,status:'signed'}],100);
  assert.equal(p.committed,20);assert.equal(p.signed,20);assert.equal(p.soft,0);assert.equal(p.amount_not_recorded_count,1);assert.equal(p.status_not_set_count,1);
});
test('prospect update records actor once, and unknown allocation is excluded from both round totals',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO raise_prospects(id,uid,project_id,name,stage,amount) VALUES(1,'synthetic',1,'Synthetic investor','meeting',100)");
    let r=await call(f,3,'/api/contacts/raise-prospects/1',{stage:'committed'},'PUT');assert.equal(r.status,200,JSON.stringify(r.body));
    const log=f.db.prepare("SELECT user_id,project_id,entity_type,entity_id FROM activity_logs WHERE action='prospect_updated'").all();assert.equal(log.length,1);assert.deepEqual({...log[0]},{user_id:3,project_id:1,entity_type:'raise.capital-relationships',entity_id:'1'});
    r=await call(f,3,'/api/contacts/raise-round?project_id=1',undefined,'GET');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.raised,0);assert.equal(r.body.progress.signed,0);assert.equal(r.body.progress.status_not_set_count,1);
    f.db.exec('UPDATE raise_prospects SET amount=NULL');
    r=await call(f,3,'/api/contacts/raise-round?project_id=1',undefined,'GET');assert.equal(r.body.progress.amount_not_recorded_count,1);
  }finally{f.db.close();}
});

test('a valid spin-out creates only supplied papers and never attempts a capital call',async()=>{
  const f=fixture();try {
    const source=readFileSync(new URL('../src/routes/legalcap.ts',import.meta.url),'utf8');
    const fields=[...new Set([...source.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]))];
    const variables=Object.fromEntries(fields.map(k=>[k,'Synthetic supplied term']));
    Object.assign(variables,{amount:'123',valuation_cap:'1000000',discount_rate:'0',holding_equity_pct:'10',founder_equity_pct:'80',option_pool_pct:'10'});
    f.db.exec("INSERT INTO syndicates(id,deal_id,name,status,created_by) VALUES(1,1,'Synthetic','open',2)");
    const base=f.env.DB;let calls=0;
    f.env.DB={...base,prepare(sql:string){if(/INSERT\s+INTO\s+capital_calls/i.test(sql))calls++;return base.prepare(sql);}};
    const r=await call(f,4,'/api/legalcap/subsidiary/spinout',{deal_id:1,force:true,variables});
    assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(calls,0);assert.equal(r.body.capital_call,null);
    const papers=f.db.prepare('SELECT content FROM legal_documents').all();assert.equal(papers.length,3);
    for(const paper of papers){const content=JSON.parse(String(paper.content));assert.equal(content.vars.amount,'123');assert.equal(content.vars.holding_equity_pct,'10');}
  }finally{f.db.close();}
});

test('deck NDA acceptance explicitly grants no data-room access and is not successful if persistence fails',async()=>{
  const f=fixture();try {
    const path=await share(f);
    const {ensureLegalTemplatesSchema}=await import('../src/services/legalTemplateStore.ts');
    await ensureLegalTemplatesSchema(f.env);
    f.db.prepare("INSERT INTO legal_templates(slug,title,category,body_md,is_stub) VALUES('investor_nda_axal','Synthetic NDA','portfolio','Synthetic NDA for {{recipient_name}} with {{counterparty_name}}',0)").run();
    const r=await call(f,1,`${path}/nda`,{signed_by:'Untrusted supplied name'});
    assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data_room_access_granted,false);assert.match(r.body.message,/does not grant data-room access/);
    assert.ok(r.body.document_id);assert.equal(f.db.prepare('SELECT signed_by FROM documents WHERE id=?').get(r.body.document_id)?.signed_by,'Synthetic member');
    const base=f.env.DB;
    f.env.DB={...base,prepare(sql:string){if(/INSERT INTO documents/.test(sql))throw new Error('Synthetic write failure');return base.prepare(sql);}};
    const failed=await call(f,1,`${path}/nda`,{signed_by:'Synthetic'});assert.equal(failed.status,503);
  }finally{f.db.close();}
});
