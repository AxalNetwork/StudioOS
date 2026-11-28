/** D6562: recorded input snapshots, legacy uncertainty, readiness and frozen body through mounted HQ routes on the full schema.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D6562: recorded rendered-input
 * snapshots, truthful comparisons, independent readiness, legacy uncertainty, frozen text and
 * unready-send refusal over the full migrated schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/admin_licences_contracts';
import { agreementInputs, agreementReadiness, compareAgreementTerms, parseAgreementSnapshot } from '../src/services/licenceAgreementRevision';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { sha256Hex } from '../src/services/pdf';
test.after(removeMigratedDatabases);
const secret='synthetic-6562-test-only-'.repeat(4);
function fixture(){
  const db=migratedDatabase();
  db.exec(`INSERT INTO users(id,name,email,role,is_active) VALUES (2,'HQ','hq@example.test','admin',1),(3,'Member','member@example.test','partner',1);
    INSERT INTO super_admins(user_id) VALUES (2);
    INSERT INTO user_sessions(user_id,jti,factor,assurance_level,created_at) VALUES (2,'unit-6562','totp','totp',datetime('now'));
    INSERT INTO territory_licences(id,uid,licence_ref,legal_entity_name,brand_name,signatory_name,signatory_title,status,term_years,annual_fee_cents,currency,revenue_share_bps,token_split_bps,starts_on,renews_on,created_by_user_id)
      VALUES (1,'lic-unit','AXL-UNIT','Synthetic Entity','Synthetic Brand','Synthetic Signer','Director','draft',5,10000,'EUR',1000,2000,'2026-01-01','2027-01-01',2);
    INSERT INTO licence_territories(licence_id,country_code) VALUES(1,'FR');
    INSERT INTO licence_terms(licence_uid,governing_law,revision) VALUES('lic-unit','France',1);
    INSERT INTO legal_templates(slug,title,category,body_md,version,is_active) VALUES('unit-6562','Synthetic agreement','gp','Agreement for {{legal_entity_name}}: {{annual_fee}} under {{terms.governing_law}}.',1,1);`);
  const env:any={DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'};
  const app=new Hono<any>().route('/api/admin/licences',routes);
  async function call(path='',method='GET',body?:unknown,who:number|null=2){
    const token=who===null?null:await new SignJWT({user_id:who,jti:'unit-6562'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
    const r=await app.request('https://unit.test/api/admin/licences/lic-unit/contract'+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
    return{status:r.status,body:await r.json() as any};
  }
  const licence=()=>db.prepare("SELECT * FROM territory_licences WHERE uid='lic-unit'").get() as any;
  return{db,env,call,licence};
}
test('new contracts capture the rendered revisions and text; value differences count terms, not revision increments',async()=>{
 const f=fixture();const made=await f.call('','POST',{template_slug:'unit-6562'});assert.equal(made.status,201,JSON.stringify(made.body));assert.equal(made.body.readiness.ready,true);
 const stored:any=f.db.prepare('SELECT * FROM licence_contracts WHERE uid=?').get(made.body.uid);const snapshot=parseAgreementSnapshot(stored.terms_snapshot_json);
 assert.deepEqual([stored.terms_revision,stored.schedule_revision],[0,1]);assert.ok(snapshot);assert.equal(await sha256Hex(stored.body_md),stored.body_sha256);assert.match(stored.body_md,/EUR 100.00 under France/);
 f.db.prepare("UPDATE licence_contracts SET status='signed',signed_at='2026-11-01' WHERE uid=?").run(made.body.uid);
 assert.deepEqual((await f.call()).body.terms_differ,{differs:false,changed_terms:0,fields:[]});
 f.db.exec("UPDATE territory_licences SET annual_fee_cents=20000,terms_revision=terms_revision+9; UPDATE licence_terms SET governing_law='Switzerland',revision=revision+3;");
 const read=await f.call();assert.deepEqual(read.body.terms_differ,{differs:true,changed_terms:2,fields:['annual_fee_cents','schedule.governing_law']});
 assert.equal(read.body.contracts[0].body_md,stored.body_md);assert.equal(read.body.contracts[0].body_sha256,stored.body_sha256);assert.equal('terms_snapshot_json' in read.body.contracts[0],false);
 const replacement=await f.call('','POST',{template_slug:'unit-6562'});assert.equal(replacement.status,201);const again=await f.call();assert.equal(again.body.terms_differ.changed_terms,2);assert.equal(again.body.contracts.find((c:any)=>c.uid===made.body.uid).status,'signed');
});
test('legacy and missing-source comparisons remain unknown; readiness fields fail independently and zero fees are recorded',async()=>{
 const f=fixture();f.db.exec("INSERT INTO licence_contracts(uid,licence_uid,template_slug,template_version,template_title,body_md,status) VALUES('legacy','lic-unit','unit-6562',1,'Legacy','Unchanged legacy','signed')");
 const legacy=await f.call();assert.equal(legacy.body.terms_differ,null);assert.match(legacy.body.terms_differ_reason,/no recorded terms snapshot/);
 const snapshot=(await agreementInputs(f.env,f.licence())).snapshot;assert.equal(agreementReadiness(snapshot).ready,true);
 for(const [key,field] of [['legal_entity_name','legal_entity'],['territory','territory'],['annual_fee_cents','commercial_terms'],['schedule.governing_law','governing_law'],['signatory_title','signatory_title']] as const){
  const missing=structuredClone(snapshot);missing.values[key]=key==='territory'?[]:null;const r=agreementReadiness(missing);assert.equal(r.ready,false);assert.equal(r.fields.find(v=>v.key===field)?.state,'not_recorded');assert.equal(r.fields.filter(v=>v.state==='ready').length,4);
 }
 snapshot.values.annual_fee_cents=0;assert.equal(agreementReadiness(snapshot).ready,true);assert.equal(agreementReadiness(null).ready,false);assert.equal(parseAgreementSnapshot('{bad'),null);assert.equal(parseAgreementSnapshot({version:1,terms_revision:0,schedule_revision:0,values:{}}),null);
 f.db.exec('DROP TABLE licence_terms');const failed=await f.call();assert.equal(failed.body.terms_differ,null);assert.match(failed.body.terms_differ_reason,/could not be read/);assert.equal(failed.body.readiness.ready,false);
});
test('comparison ignores revision-only changes and detects removed and added contractual values',async()=>{
 const f=fixture();const a=(await agreementInputs(f.env,f.licence())).snapshot;const b=structuredClone(a);b.terms_revision+=8;b.schedule_revision+=7;assert.equal(compareAgreementTerms(a,b)?.differs,false);
 b.values['seats.founder']=10;assert.equal(compareAgreementTerms(a,b)?.changed_terms,1);delete b.values['seats.founder'];b.values.signatory_title=null;assert.equal(compareAgreementTerms(a,b)?.changed_terms,1);assert.equal(compareAgreementTerms(null,b),null);
});
test('unready frozen drafts cannot send and non-HQ readers cannot read agreement contents',async()=>{
 const f=fixture();f.db.exec('UPDATE territory_licences SET signatory_title=NULL');const made=await f.call('','POST',{template_slug:'unit-6562'});assert.equal(made.status,201);assert.equal(made.body.readiness.ready,false);
 const refusal=await f.call('/'+made.body.uid+'/send','POST');assert.equal(refusal.status,409);assert.equal(refusal.body.error,'agreement_not_ready');assert.equal(Number((f.db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get() as any).n),0);
 assert.equal((await f.call('','GET',undefined,3)).status,401);assert.equal((await f.call('','GET',undefined,null)).status,401);
});

test('an unreadable envelope prevents an authoritative executed comparison, even with an older readable executed row',async()=>{
 const f=fixture();const first=await f.call('','POST',{template_slug:'unit-6562'});assert.equal(first.status,201);
 f.db.prepare("UPDATE licence_contracts SET status='signed' WHERE uid=?").run(first.body.uid);
 const second=await f.call('','POST',{template_slug:'unit-6562'});assert.equal(second.status,201);
 f.db.prepare("UPDATE licence_contracts SET status='signed',envelope_uid='missing-envelope-6562' WHERE uid=?").run(second.body.uid);
 const read=await f.call();assert.equal(read.body.terms_differ,null);assert.match(read.body.terms_differ_reason,/envelope could not be read/);
});
