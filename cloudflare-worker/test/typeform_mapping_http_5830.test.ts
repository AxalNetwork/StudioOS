/** #5830: mapping HTTP permission, transaction and replay fixtures on the actual migrated schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import typeform from '../src/routes/typeform.ts';
import mappings from '../src/routes/typeform_mappings.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { followTypeformBinding } from '../src/services/typeform/selection.ts';
import integrations, { returnBase, returnQuery } from '../src/routes/integrations.ts';
import { pilotReturn } from '../src/integrations/pilotReturn.ts';
const JWT_SECRET = 'synthetic-mapping-secret';
const COMPANY=77, PROJECT=41, UNBOUND=42, OWNER=10, TEAMMATE=11, ADVISOR=12, STRANGER=13, MINE=501, THEIRS=502;
const FORM_A='FrmSyncA1', FORM_B='FrmSyncB2';
const EU_TOKEN='SYNTHETIC-EU-ACCESS', US_TOKEN='SYNTHETIC-US-ACCESS';
function fakeTypeform() {
 const calls: string[] = [];
 return { calls, fetch: (async (input: any) => {
   calls.push(String(input));
   return Response.json({id: FORM_A, title: 'Private form title', fields:[
     {id:'choice',ref:'stable-ref',type:'multiple_choice',title:'Private question title',properties:{choices:[{id:'yes',label:'Private answer title'},{id:'no'}]}},
     {id:'email',ref:'identity',type:'email',title:'Respondent address'}
   ]});
 }) as typeof fetch };
}
async function world(env0: Record<string, string> = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4), TYPEFORM_APP_APPROVED: '1', ...env0 };
  db.exec(`INSERT INTO users (id, email, name, role, is_active, founder_id) VALUES
      (${OWNER}, 'owner@example.invalid', 'Synthetic owner', 'founder', 1, 100),
      (${TEAMMATE}, 'mate@example.invalid', 'Synthetic teammate', 'founder', 1, 101),
      (${ADVISOR}, 'advisor@example.invalid', 'Synthetic advisor', 'exploring', 1, NULL),
      (${STRANGER}, 'stranger@example.invalid', 'Synthetic stranger', 'founder', 1, 102);
    INSERT INTO projects (id, name, company_id, founder_id) VALUES (${PROJECT}, 'Synthetic venture', ${COMPANY}, 100), (${UNBOUND}, 'Unbound venture', ${COMPANY}, 100);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PROJECT}, ${TEAMMATE}, 'cofounder', 'accepted'), (${PROJECT}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('ucl-owner', ${COMPANY}, ${OWNER}), ('ucl-mate', ${COMPANY}, ${TEAMMATE});`);
  const far = Date.now() + 7 * 24 * 3600_000; // clock-ok: relative
  const connect = async (id: number, user: number, region: unknown, token: string) => {
    const uid = `typeform-5828-${id}`;
    const enc = await encryptCredentials(env, uid, { access_token: token, refresh_token: 'SYNTHETIC-REFRESH', expires_at: far, ...(region === undefined ? {} : { region }) } as any);
    db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, status, credentials_enc) VALUES (?, ?, ?, 'typeform', 'oauth2', 'active', ?)").run(id, uid, user, enc);
    db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(id, COMPANY);
  };
  await connect(MINE, OWNER, 'eu', EU_TOKEN);
  await connect(THEIRS, TEAMMATE, 'us', US_TOKEN);
  db.prepare("INSERT INTO typeform_form_bindings (uid, integration_id, project_id, form_id, fields_json, bound_by) VALUES ('bind-a', ?, ?, ?, '[]', ?)").run(MINE, PROJECT, FORM_A, OWNER);
  const tf = fakeTypeform();
  const app = new Hono<any>();
  app.route('/api/connectors', integrations);
  app.route('/api/typeform', typeform);
  app.route('/api/typeform/mappings', mappings);
  app.onError((e: any, c) => c.json({ detail: 'refused' }, AUTH_ERROR_STATUSES[e.message] || 500));
  const logs: string[] = [];
  const call = async (who: number | null, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) => {
    const headers: Record<string, string> = { 'X-Company-Id': String(COMPANY) };
    if (who != null) {
      const jwt = await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      headers.Authorization = `Bearer ${jwt}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const real = globalThis.fetch; const warn = console.warn; const log = console.log; const error = console.error;
    const capture = (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    globalThis.fetch = tf.fetch; console.warn = capture; console.log = capture; console.error = capture;
    try {
      const res = await app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: json, text };
    } finally { globalThis.fetch = real; console.warn = warn; console.log = log; console.error = error; }
  };
  const syncs = () => (db.prepare('SELECT integration_id, project_id, form_id, status, sync_state, region, checkpoint_submitted_at FROM typeform_form_syncs ORDER BY id').all() as any[]).map((r) => ({ ...r }));
  const syncIdOf = (form: string) => Number((db.prepare('SELECT id FROM typeform_form_syncs WHERE form_id = ?').get(form) as any).id);
  return { db, env, tf, call, logs, syncs, syncIdOf };
}

const path='/api/typeform/mappings';
const rule={field_id:'choice',kind:'waitlist',choices:['yes'],keep_text:false};
async function ready() {const w=await world(); await followTypeformBinding(w.env,PROJECT); return w;}
async function save(w: Awaited<ReturnType<typeof ready>>, rules: unknown[] = [rule]) {
 const view = await w.call(OWNER,'GET',`${path}?project=${PROJECT}`);
 assert.equal(view.status,200,view.text);
 return w.call(OWNER,'PUT',path,{project:PROJECT,mappings:rules,expected_mapping_revision:view.body.revision});
}
test('mapping GET is owner-scoped/read-only, dark-gated, and exposes stable fields without titles or grant data',async()=>{
 const w=await ready(); const r=await w.call(OWNER,'GET',`${path}?project=${PROJECT}`);
 assert.equal(r.status,200);assert.deepEqual(r.body.items,[]);assert.match(r.body.revision,/^[a-f0-9]{64}$/);assert.equal(w.tf.calls.length,0);
 for(const who of [null,TEAMMATE,ADVISOR,STRANGER]) assert.notEqual((await w.call(who,'GET',`${path}?project=${PROJECT}`)).status,200);
 assert.equal((await w.call(OWNER,'PUT',path,{project:PROJECT,mappings:[rule]},{impersonated_by:99})).status,403);
 w.env.TYPEFORM_APP_APPROVED='';assert.equal((await w.call(OWNER,'GET',`${path}?project=${PROJECT}`)).status,503);
 assert.equal(w.tf.calls.length,0);w.db.close();
});
test('mapping writes validate against the exact recorded-region form, are idempotent, and never import or confirm evidence',async()=>{
 const w=await ready();
 for(let i=0;i<2;i++) assert.equal((await save(w)).status,200);
 assert.equal(w.tf.calls.length,2);assert.ok(w.tf.calls.every(u=>u==='https://api.eu.typeform.com/forms/FrmSyncA1'));
 const result=await w.call(OWNER,'GET',`${path}?project=${PROJECT}`);
 assert.equal(result.body.items.length,1); assert.equal(result.body.items[0].field_id,'choice');
 assert.ok(!/Private|SYNTHETIC/.test(result.text));
 for(const table of ['typeform_responses','typeform_answers','demand_signals']) assert.equal((w.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n,0);
 for(const bad of [{...rule,choices:['invented']},{...rule,field_id:'email'}, {...rule,kind:'prototype'},rule,rule]) {
  const body=bad===rule?[rule,rule]:[bad];
  assert.equal((await save(w,body)).status,400);
 }
 assert.equal((w.db.prepare('SELECT COUNT(*) n FROM typeform_field_mappings').get() as any).n,1);w.db.close();
});
test('revoking company permission immediately before the write batch rolls back all mapping changes',async()=>{
 const w=await ready();
 const db=w.env.DB;w.env.DB=new Proxy(db,{get(t,k){if(k==='batch') return (stmts:any[])=>{
  w.db.prepare('UPDATE integration_companies SET enabled=0 WHERE integration_id=?').run(MINE);
  return t.batch(stmts);
 };const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 const r=await save(w);
 assert.equal(r.status,409);assert.equal((w.db.prepare('SELECT COUNT(*) n FROM typeform_field_mappings').get() as any).n,0);
 assert.equal((w.db.prepare('SELECT COUNT(*) n FROM decision_guard').get() as any).n,0);w.db.close();
});
test('switching the selected form while its provider read is pending refuses the old mapping',async()=>{
 const w=await ready();const original=w.tf.fetch;
 w.tf.fetch=(async(...args:any[])=>{const response=await (original as any)(...args);w.db.prepare('UPDATE typeform_form_bindings SET form_id=?').run(FORM_B);return response;}) as typeof fetch;
 const r=await save(w);
 assert.equal(r.status,409);assert.equal((w.db.prepare('SELECT COUNT(*) n FROM typeform_field_mappings').get() as any).n,0);w.db.close();
});
test('OAuth pilot return is a provider-bound fixed route, never an arbitrary redirect or inherited object key',()=>{
 assert.deepEqual(pilotReturn('typeform','validate_research','41'),{path:'/validate/customer-research',projectId:41});
 assert.deepEqual(pilotReturn('google_search_console','grow_results',41),{path:'/grow/distribution/results',projectId:41});
 for(const task of ['https://example.invalid','//example.invalid','constructor','__proto__']) assert.equal(pilotReturn('typeform',task,41),null);
 assert.equal(pilotReturn('github','grow_results',41),null);assert.equal(pilotReturn('typeform','grow_results',41),null);
 for(const project of [0,-1,'41x',Number.MAX_SAFE_INTEGER+1,null]) assert.equal(pilotReturn('typeform','validate_research',project),null);
});

test('the mounted OAuth handler uses only sealed provider/task/venture extras, retaining the existing Build fallback',()=>{
 const extra={pilot_provider:'typeform',return_to:'validate_research',project_id:41};
 assert.equal(returnBase(extra),'/validate/customer-research');assert.equal(returnQuery(extra,'oauth=ok'),'/validate/customer-research?oauth=ok&project_id=41');
 assert.equal(returnQuery({...extra,pilot_provider:'github'},'oauth=error'),'/integrations?oauth=error');
 assert.equal(returnQuery({...extra,return_to:'https://unexpected.example.invalid'},'oauth=ok'),'/integrations?oauth=ok');
 assert.equal(returnQuery({return_to:'build',project_id:41},'oauth=ok'),'/build/connect?oauth=ok&project_id=41');
});

test('actual disconnect stops the selected source but does not automatically delete accepted signals or hypothesis links',async()=>{
 const w=await ready();
 w.db.exec(`INSERT INTO hypotheses (id,project_id,code,claim) VALUES (101,41,'H1','Synthetic claim');
 INSERT INTO demand_signals (id,project_id,kind,signal_date,status,source_kind,source_typeform_key) VALUES (901,41,'need_to_have','2026-11-01','confirmed','typeform','synthetic-source');
 INSERT INTO hypothesis_evidence_links (uid,project_id,hypothesis_id,kind,ref_id,direction) VALUES ('synthetic-link',41,101,'signal','signal-901','supports');
 INSERT INTO typeform_reviews (project_id,integration_id,source_key,evidence_mapping_id,mapping_version,signal_id,status) VALUES (41,501,'synthetic-source',1,1,901,'confirmed');`);
 const response=await w.call(OWNER,'DELETE','/api/connectors/typeform-5828-501');
 assert.equal(response.status,200,response.text);
 assert.equal((w.db.prepare('SELECT COUNT(*) n FROM typeform_form_bindings WHERE integration_id=501').get() as any).n,0);
 assert.equal((w.db.prepare('SELECT COUNT(*) n FROM integrations WHERE id=501').get() as any).n,0);
 assert.equal((w.db.prepare("SELECT COUNT(*) n FROM demand_signals WHERE id=901 AND status='confirmed'").get() as any).n,1);
 assert.equal((w.db.prepare("SELECT COUNT(*) n FROM hypothesis_evidence_links WHERE ref_id='signal-901'").get() as any).n,1);w.db.close();
});


test('an unread or stale mapping list refuses replacement before provider access and preserves newer rules',async()=>{
 const w=await ready();
 const before=await w.call(OWNER,'GET',`${path}?project=${PROJECT}`);
 assert.equal((await w.call(OWNER,'PUT',path,{project:PROJECT,mappings:[rule]})).status,409);
 assert.equal(w.tf.calls.length,0);
 assert.equal((await save(w)).status,200);
 const after=await w.call(OWNER,'GET',`${path}?project=${PROJECT}`);
 assert.notEqual(after.body.revision,before.body.revision);
 const calls=w.tf.calls.length;
 const stale=await w.call(OWNER,'PUT',path,{project:PROJECT,mappings:[],expected_mapping_revision:before.body.revision});
 assert.equal(stale.status,409);assert.equal(w.tf.calls.length,calls);
 assert.deepEqual((await w.call(OWNER,'GET',`${path}?project=${PROJECT}`)).body,after.body);
 w.db.close();
});

test('a mapping change immediately before the write batch rolls back replacement and its retractions',async()=>{
 const w=await ready();assert.equal((await save(w)).status,200);
 const mappingId=Number((w.db.prepare('SELECT id FROM typeform_field_mappings').get() as any).id);
 w.db.prepare("INSERT INTO typeform_responses(id,sync_id,response_id,response_type,first_seen_at,last_seen_at) VALUES(701,?,'synthetic-response','completed',?,?)").run(w.syncIdOf(FORM_A),'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');
 w.db.prepare("INSERT INTO typeform_answers(id,response_row_id,mapping_id,field_id,answer_text,created_at) VALUES(801,701,?,'choice','synthetic private answer',?)").run(mappingId,'2026-11-01T00:00:00Z');
 w.db.exec(`INSERT INTO hypotheses (id,project_id,code,claim) VALUES (101,41,'H1','Synthetic claim');
 INSERT INTO demand_signals (id,project_id,kind,signal_date,status,source_kind,source_typeform_key) VALUES (901,41,'waitlist','2026-11-01','confirmed','typeform','synthetic-source');
 INSERT INTO hypothesis_evidence_links (uid,project_id,hypothesis_id,kind,ref_id,direction) VALUES ('synthetic-link',41,101,'signal','signal-901','supports');
 INSERT INTO typeform_reviews (project_id,integration_id,source_key,evidence_mapping_id,mapping_version,answer_id,signal_id,status) VALUES (41,501,'synthetic-source',1,1,801,901,'confirmed');`);
 const db=w.env.DB;let raced=false;
 w.env.DB=new Proxy(db,{get(t,k){if(k==='batch')return(stmts:any[])=>{
  raced=true;w.db.prepare("UPDATE typeform_field_mappings SET kind='would_pay' WHERE field_id='choice'").run();
  return t.batch(stmts);
 };const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 const r=await save(w,[]);
 assert.equal(raced,true);assert.equal(r.status,409,r.text);
 assert.equal((w.db.prepare("SELECT kind FROM typeform_field_mappings WHERE field_id='choice'").get() as any).kind,'would_pay');
 assert.equal((w.db.prepare('SELECT COUNT(*) n FROM decision_guard').get() as any).n,0);
 assert.equal((w.db.prepare('SELECT COUNT(*) n FROM typeform_answers WHERE id=801').get() as any).n,1);
 assert.equal((w.db.prepare('SELECT COUNT(*) n FROM demand_signals WHERE id=901').get() as any).n,1);
 assert.equal((w.db.prepare("SELECT COUNT(*) n FROM hypothesis_evidence_links WHERE ref_id='signal-901'").get() as any).n,1);
 assert.equal((w.db.prepare("SELECT status FROM typeform_reviews WHERE answer_id=801").get() as any).status,'confirmed');
 w.db.close();
});
