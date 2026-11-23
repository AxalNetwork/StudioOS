/** D6704 (#6704): fixture-only deterministic comparisons and immutable case evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formationRules, type RuleCatalogue, type FormationAnswers } from '../src/services/formationRules.ts';
import type { CatalogueForm } from '../src/services/formationCatalogue.ts';
import { openSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { grantWriteBar } from './_write_bar_session.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import router from '../src/routes/formation_cases.ts';
const keys = ['gb_ltd','us_de_ccorp','us_de_llc','us_wy_ccorp','ee_ou'];
function catalogue(): RuleCatalogue {
  const forms = keys.map(key => ({ version:{id:9904,version:9904,status:'published',published_at:'2026-11-20'}, jurisdiction:{country:key.slice(0,2).toUpperCase(),subdivision:null,registry_name:null,vocabulary:{}},form:{key,label:key,offer_mode:'orderable',legal_form_family:null,legacy_gate:null,legacy_display:null,allow_axal_collection:false},facts:[{key:'registered_office',value:'Synthetic fixture requirement',status:'recorded',blocking:true,source:{id:9904,kind:'registry',title:'Synthetic fixture',url:'https://example.test'},checked_on:'2026-11-20'}],fees:[],pack:[] })) as CatalogueForm[];
  return {version:9904,status:'published',forms,rules:forms.flatMap(f => ['GB','US','EE'].map(country => ({country,form_key:f.form.key,scenario:12,when:{},reasons:['Compare the recorded circumstances'],what_would_change_it:['A different operating country']})))};
}
const answers: FormationAnswers = {founders:[{residence_country:'GB'}],operating_countries:['GB'],management_country:'GB'};
test('same answers/version are byte-identical; costs never select Estonia; explicit opens reach each form', () => {
  const cat = catalogue();
  const first = formationRules(answers,cat);
  assert.equal(JSON.stringify(first),JSON.stringify(formationRules(answers,cat)));
  assert.equal(first.options.some(o => o.form_key==='ee_ou'),false);
  const estonian = {...answers,founders:[{residence_country:'EE'}],operating_countries:['EE'],management_country:'EE'};
  assert.throws(()=>formationRules(estonian,cat));
  assert.equal(formationRules(estonian,cat,'ee_ou').options[0].form_key,'ee_ou');
  assert.equal(JSON.stringify(first), JSON.stringify(formationRules({...answers, cost:'lowest'} as FormationAnswers,cat)));
  for (const key of keys) assert.ok(formationRules(answers,cat,key).options.some(o=>o.form_key===key),key);
  assert.equal(formationRules(answers,cat,'ee_ou').options.find(o=>o.form_key==='ee_ou')!.path,'specialist');
  assert.equal(formationRules(answers,cat,'us_de_ccorp').options.find(o=>o.form_key==='us_de_ccorp')!.path,'simple');
  assert.equal(formationRules({...answers,payments:true},cat,'us_de_ccorp').options[0].path,'specialist');
  const cross = formationRules({...answers,founders:[{residence_country:'US'}]},cat);
  assert.ok(cross.options.some(o=>o.form_key==='gb_ltd'));
  assert.ok(cross.options.some(o=>o.form_key==='us_de_ccorp'));
  assert.ok(cross.options.every(o=>o.path==='specialist'));
  assert.doesNotMatch(JSON.stringify(first),/tax|saving|index.?rank|\d+%/i);
  cat.forms[0].facts.push({...cat.forms[0].facts[0],key:'tax_rate',value:'99%'});
  assert.doesNotMatch(JSON.stringify(formationRules(answers,cat)),/99%|tax_rate/);
  assert.throws(()=>formationRules(answers,{...cat,status:'draft'}));
  assert.throws(()=>formationRules(answers,{...cat,rules:[]}));
  assert.throws(()=>formationRules({...answers,management_country:undefined},cat));
  assert.throws(()=>formationRules({...answers,written_us_investor_requirement:true},cat));
  assert.throws(()=>formationRules({...answers,payments:'true'} as unknown as FormationAnswers,cat));
  for (const flag of ['cross_border','regulated','spinout','flip','fund','grant','payments','health']) assert.ok(formationRules({...answers,[flag]:true},cat).options.every(o=>o.path==='specialist'),flag);
  assert.equal(first.options[0].requirements[0].source!.id,9904);
  assert.equal(first.options[0].requirements[0].checked_on,'2026-11-20');
  const us = {...answers, founders:[{residence_country:'US'}],operating_countries:['US'],management_country:'US',founder_state:'CA'};
  assert.ok(formationRules(us,cat).information.includes('home-state LLC'));
  assert.equal(formationRules(us,cat).options.some(o=>o.form_key==='us_de_llc'||o.form_key==='us_wy_ccorp'),false);
  assert.ok(formationRules({...us,founder_state:'DE'},cat).options.some(o=>o.form_key==='us_de_llc'));
  const scenarioOne = {...cat,rules:[{scenario:1,country:'US',form_key:'us_de_llc',when:{},reasons:['Fixture home-state option'],what_would_change_it:['Founder state changes']}]};
  const home = formationRules(us,scenarioOne);
  assert.deepEqual(home.information,['home-state LLC']);
  assert.equal(home.scenario,1);
  assert.equal(home.path,'simple');
  assert.equal(home.options.length,0);
  assert.equal(formationRules(us,scenarioOne,'us_de_llc').options.length,0);
  assert.equal(formationRules({...us,founder_state:'DE'},scenarioOne).options[0].form_key,'us_de_llc');
  assert.ok(formationRules({...answers,written_us_investor_requirement:true,us_investor_requirement_document:'Fixture written requirement'},cat).options.some(o=>o.form_key==='us_de_ccorp'));
});

const SECRET='synthetic-formation-6704-secret-only'.repeat(2);
async function setup() {
  const db=openSchema();
  db.exec(`INSERT INTO founders(id,name,email) VALUES(9904,'Fixture','fixture6704@example.test');
    INSERT INTO users(id,name,email,role,founder_id) VALUES(9904,'Fixture','fixture6704@example.test','founder',9904),(9905,'Other','other6704@example.test','founder',NULL),(9906,'HQ','hq6704@example.test','admin',NULL);
    INSERT INTO super_admins(user_id) VALUES(9906);
    INSERT INTO partners(id,uid,name,email) VALUES(9904,'partner6704','Fixture Partner','partner6704@example.test');
    INSERT INTO formation_partners(id,partner_id,status) VALUES(9904,9904,'draft');
    INSERT INTO projects(id,uid,name,founder_id) VALUES(9904,'project6704','Fixture',9904);
    INSERT INTO formation_cases(id,uid,user_id,intent,project_id,track,stage,waiting_on) VALUES(9904,'case6704',9904,'convert_project',9904,'v2','draft','founder');
    INSERT INTO formation_case_answers(uid,case_id,case_revision,answers_json,prefill_json,created_by) VALUES('answers6704',9904,0,'{"founders":[{"residence_country":"GB"}],"operating_countries":["GB"],"management_country":"GB","payments":true}','{}',9904);
    UPDATE formation_catalogue_versions SET is_current=0 WHERE is_current=1;
    INSERT INTO formation_catalogue_versions(id,version,status) VALUES(9904,9904,'draft');
    INSERT INTO formation_jurisdictions(id,version_id,country) VALUES(9904,9904,'GB');
    INSERT INTO formation_entity_forms(id,version_id,jurisdiction_id,form_key,label,offer_mode) VALUES(9904,9904,9904,'gb_ltd','Fixture form','orderable');`);
  db.prepare("INSERT INTO formation_rules(version_id,rule_key,kind,rule_json) VALUES(9904,'fixture','recommend',?)").run(JSON.stringify(catalogue().rules[0]));
  db.exec("UPDATE formation_catalogue_versions SET status='published',is_current=1,published_by=9904,published_at='2026-11-20' WHERE id=9904");
  const jti=grantWriteBar(db,9906);
  const app=new Hono<any>();app.route('/api/formation/cases',router);app.onError((e,c)=>c.json({error:e.message}, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const env={DB:d1Over(db),JWT_SECRET:SECRET,ENVIRONMENT:'development'} as any;
  async function req(method:string,path:string,body?:unknown,user=9904) {
    const token=await new SignJWT({user_id:user,...(user===9906?{jti}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r=await app.request('/api/formation/cases/case6704'+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
    return {status:r.status,body:await r.json() as any};
  }
  return {db,req,env};
}
test('flag off returns no output; access is scoped; payments cannot waive; changed answers invalidate a suggestion',async t=>{
  const f=await setup();t.after(()=>f.db.close());
  const off=await f.req('GET','/options');assert.equal(off.body.error,'options_off');assert.equal(off.body.options,undefined);
  assert.equal((await f.req('GET','/options',undefined,9905)).status,404);
  f.db.exec("UPDATE feature_flags SET enabled=1 WHERE key='formation_options' AND scope='global'");
  const shown=await f.req('GET','/options');assert.equal(shown.status,200,JSON.stringify(shown.body));
  assert.equal(f.db.prepare('SELECT count(*) n FROM formation_case_suggestions WHERE case_id=9904').get()!.n,1);
  const choice={revision:0,suggestion_uid:shown.body.suggestion_uid,notice_hash:shown.body.notice_hash,form_key:'gb_ltd',own_reason:'Fixture choice',confirmation:'waiver'};
  assert.equal((await f.req('POST','/choice',choice)).body.error,'waiver_not_available');
  assert.equal((await f.req('POST','/choice',{...choice,confirmation:'self'})).body.error,'structure_memo_required');
  assert.equal((await f.req('POST','/choice',{...choice,confirmation:'structure_memo',memo_uid:'missing'})).body.error,'structure_memo_required');
  assert.equal(f.db.prepare('SELECT stage FROM formation_cases WHERE id=9904').get()!.stage,'draft');
  assert.equal(f.db.prepare('SELECT count(*) n FROM formation_case_choices WHERE case_id=9904').get()!.n,0);
  f.db.exec(`INSERT INTO formation_case_answers(uid,case_id,case_revision,answers_json,prefill_json,created_by) VALUES('new6704',9904,1,'{}','{}',9904)`);
  assert.equal((await f.req('POST','/choice',choice)).body.error,'choice_evidence_changed');
});
test('a changed simple choice appends rows; database refuses mutation of shown and chosen evidence',async t=>{
  const f=await setup();t.after(()=>f.db.close());
  f.db.exec("UPDATE feature_flags SET enabled=1 WHERE key='formation_options' AND scope='global'");
  // New answer set, not an update to the existing evidence.
  f.db.exec(`INSERT INTO formation_case_answers(uid,case_id,case_revision,answers_json,prefill_json,created_by) VALUES('simple6704',9904,1,'{"founders":[{"residence_country":"GB"}],"operating_countries":["GB"],"management_country":"GB"}','{}',9904)`);
  const shown=(await f.req('GET','/options')).body;
  const body={revision:0,suggestion_uid:shown.suggestion_uid,notice_hash:shown.notice_hash,form_key:'gb_ltd',own_reason:'First reason',confirmation:'self'};
  const first=await f.req('POST','/choice',body);assert.equal(first.status,200,JSON.stringify(first.body));
  const second=await f.req('POST','/choice',{...body,revision:first.body.revision,own_reason:'Changed reason'});assert.equal(second.status,200,JSON.stringify(second.body));
  const rows=f.db.prepare('SELECT own_reason FROM formation_case_choices WHERE case_id=9904 ORDER BY id').all();assert.deepEqual(rows.map(r=>r.own_reason),['First reason','Changed reason']);
  for(const table of ['formation_case_choices','formation_case_suggestions']) {
    assert.throws(()=>f.db.exec(`UPDATE ${table} SET created_by=9905 WHERE case_id=9904`),/immutable/);
    assert.throws(()=>f.db.exec(`DELETE FROM ${table} WHERE case_id=9904`),/immutable/);
  }
});

test('memo requires named professional and HQ-recorded accepting partner acknowledgement; only that answers set can pass chosen',async t=>{
  const f=await setup();t.after(()=>f.db.close());
  f.db.exec("UPDATE feature_flags SET enabled=1 WHERE key='formation_options' AND scope='global'; UPDATE formation_cases SET partner_id=9904 WHERE id=9904");
  const b={answers_uid:'answers6704',document:'Synthetic signed structure memo',author_name:'Fixture Professional',firm:'Fixture Firm',licensing_body:'Fixture Licensing Body',country:'GB',memo_date:'2026-11-20',partner_id:9904,partner_acknowledgement:'Acknowledged by the accepting fixture partner'};
  assert.equal((await f.req('POST','/memos',b)).status,403,'founder cannot attest partner acknowledgement');
  for(const field of ['document','author_name','firm','licensing_body','country','memo_date','partner_acknowledgement']) assert.equal((await f.req('POST','/memos',{...b,[field]:''},9906)).status,400,field);
  assert.equal((await f.req('POST','/memos',{...b,partner_id:9905},9906)).status,400);
  const memo=await f.req('POST','/memos',b,9906);assert.equal(memo.status,200,JSON.stringify(memo.body));
  const shown=(await f.req('GET','/options')).body;
  const choice={revision:0,suggestion_uid:shown.suggestion_uid,notice_hash:shown.notice_hash,form_key:'gb_ltd',own_reason:'Fixture professional memo checked',confirmation:'structure_memo',memo_uid:memo.body.memo_uid};
  const chosen=await f.req('POST','/choice',choice);assert.equal(chosen.status,200,JSON.stringify(chosen.body));
  assert.equal(f.db.prepare('SELECT stage FROM formation_cases WHERE id=9904').get()!.stage,'chosen');
  assert.throws(()=>f.db.exec("UPDATE formation_case_memos SET author_name='Changed' WHERE case_id=9904"),/immutable/);
  assert.throws(()=>f.db.exec('DELETE FROM formation_case_memos WHERE case_id=9904'),/immutable/);
});

test('a racing first choice or changed choice cannot append under another request’s next revision',async t=>{
  for(const stage of ['draft','chosen']) {
    const f=await setup();t.after(()=>f.db.close());
    f.db.exec("UPDATE feature_flags SET enabled=1 WHERE key='formation_options' AND scope='global'");
    f.db.prepare('UPDATE formation_cases SET stage=? WHERE id=9904').run(stage);
    f.db.exec(`INSERT INTO formation_case_answers(uid,case_id,case_revision,answers_json,prefill_json,created_by) VALUES('race6704',9904,1,'{"founders":[{"residence_country":"GB"}],"operating_countries":["GB"],"management_country":"GB"}','{}',9904)`);
    const shown=(await f.req('GET','/options')).body;
    const batch=f.env.DB.batch.bind(f.env.DB);let raced=false;
    f.env.DB.batch=async (statements: unknown[])=>{
      if(!raced) {
        raced=true;
        f.db.exec(`UPDATE formation_cases SET stage='chosen',revision=1 WHERE id=9904;
          INSERT INTO formation_case_events(case_id,actor_user_id,party,kind,to_stage,to_revision,visibility,detail_json) VALUES(9904,9904,'founder','stage_changed','chosen',1,'all','{"choice_uid":"another-request"}')`);
      }
      return batch(statements);
    };
    const result=await f.req('POST','/choice',{revision:0,suggestion_uid:shown.suggestion_uid,notice_hash:shown.notice_hash,form_key:'gb_ltd',own_reason:'Losing request',confirmation:'self'});
    assert.equal(result.status,409,stage);
    assert.equal(f.db.prepare('SELECT count(*) n FROM formation_case_choices WHERE case_id=9904').get()!.n,0,stage);
    assert.equal(f.db.prepare('SELECT count(*) n FROM formation_case_events WHERE case_id=9904').get()!.n,1,stage);
  }
});
