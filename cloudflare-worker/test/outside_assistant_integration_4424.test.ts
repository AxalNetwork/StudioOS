// D4424: real OAuth provider + SQLite; outside identity, live role/policy checks, proposals and both removal directions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline, addColumnsFrom } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { memKV } from './_mem_kv.mjs';
import { withGuard } from './_guard_stub.mjs';
import { routeMcp, oauthHelpers } from '../src/mcp/oauth.ts';
import { callTool, registeredTools, listedTools, type McpTool } from '../src/mcp/server.ts';
import { assistantGrants, mcpConsent } from '../src/routes/mcp_consent.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { agentRun, agentQuote } from '../src/services/agents/agentRun.ts';
import { outsideAgentForGrant } from '../src/services/agents/outsideAssistant.ts';
import { roleOf } from '../src/services/agents/catalogue.ts';
import { METERING_POLICY, toolOperation } from '../src/services/metering.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const baseline = sql('schema_baseline.sql');
const JWT = 'outside-assistant-unit-test-secret';
function world() {
  const { DB, db } = makeD1(['users','company_profiles','user_company_links','projects','activity_logs']
    .map(t => stripForeignKeys(tableFromBaseline(baseline,t))).join('\n') + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  addColumnsFrom(db,sql('migrations/597_company_archive_and_events.sql'),'company_profiles');
  for (const name of ['712_team_agents.sql','202611021724_team_agents_persona.sql','727_scope_goals_and_tasks.sql',
    '728_agent_engine.sql','202611041438_team_allowlists.sql','202611041609_outside_assistant_bindings.sql',
    '202611041648_outside_assistant_tool_policy.sql','524_api_usage_events.sql']) db.exec(stripForeignKeys(sql(`migrations/${name}`)));
  db.exec(`INSERT INTO users(id,uid,email,name,role,founder_id,subscription_tier,subscription_status) VALUES
    (1,'editor','editor@example.test','Editor','founder',1001,'growth','active'),
    (2,'member','member@example.test','Member','founder',1002,'growth','active');
    INSERT INTO company_profiles(id,uid,company_name) VALUES(11,'company-a','Company A'),(12,'company-b','Company B');
    INSERT INTO user_company_links(uid,user_id,company_id,role_in_company) VALUES('owner',1,11,'Owner'),('member',2,11,'Member');
    INSERT INTO projects(id,uid,name,company_id,founder_id) VALUES(101,'p101','Project A',11,1001),(102,'p102','Project B',12,1001);`);
  let generated = 0; let guarded = 0;
  const env: any = { DB, JWT_SECRET: JWT, ENVIRONMENT:'development', TEAM_AGENTS_ENABLED:'true', MCP_SERVER_ENABLED:'true',
    AGENT_ENGINE_ENABLED:'off', RATE_LIMITS:memKV(), OAUTH_KV:memKV(), TOKENS:memKV(),
    AI:withGuard({ run:async()=>{ generated++; throw new Error('No generation model may run'); } },()=>{ guarded++; return 'safe'; }) };
  const app = new Hono(); app.onError((e,c)=>c.json({detail:e.message},500));
  app.route('/api/teams',teamAgents); app.route('/api/mcp/consent',mcpConsent); app.route('/api/connectors/assistants',assistantGrants);
  const user: any = db.prepare('SELECT * FROM users WHERE id=1').get();
  return {db,env,app,user,generated:()=>generated,guarded:()=>guarded};
}
type W = ReturnType<typeof world>;
async function asUser(w: W, method: string,path: string,body?:unknown,who=1) {
  const jwt=await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT));
  const res=await w.app.request(path,{method,headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},w.env);
  return {status:res.status,body:await res.json() as any};
}
const REDIRECT='https://assistant.example/callback', VERIFIER='v'.repeat(64);
async function hit(w: W,path:string,init:RequestInit={}) {
  return routeMcp(new Request(`https://axal.vc${path}`,init),w.env,{waitUntil(){},passThroughOnException(){}} as any);
}
async function parked(w: W,scopes='validate:read validate:write team:propose') {
  const reg=await hit(w,'/api/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    redirect_uris:[REDIRECT],client_name:'Outside app',token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token']})});
  assert.equal(reg.status,201,await reg.clone().text()); const clientId=(await reg.json() as any).client_id;
  const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(VERIFIER))).toString('base64url');
  const params=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:REDIRECT,resource:'https://axal.vc/mcp',scope:scopes,code_challenge:challenge,code_challenge_method:'S256'});
  const auth=await hit(w,`/api/oauth/authorize?${params}`);
  assert.equal(auth.status,302); return {clientId,id:new URL(auth.headers.get('location')!).searchParams.get('request')!};
}
async function connect(w: W, roleKey = 'cpo') {
  const p=await parked(w);
  const approved=await asUser(w,'POST',`/api/mcp/consent/${p.id}/approve`,{companies:[101],team_agent:{company_uid:'company-a',role_key:roleKey}});
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  const code=new URL(approved.body.redirectTo).searchParams.get('code')!;
  const exchanged=await hit(w,'/api/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:REDIRECT,client_id:p.clientId,code_verifier:VERIFIER,resource:'https://axal.vc/mcp'})});
  assert.equal(exchanged.status,200,await exchanged.clone().text());
  const tokens=await exchanged.json() as any; const token=tokens.access_token;
  const binding:any=w.db.prepare('SELECT * FROM team_agent_mcp_bindings').get();
  const agent:any=w.db.prepare('SELECT * FROM team_agents').get();
  const props:any={userId:1,clientId:p.clientId,companies:[101],clientName:'Outside app',redirectHost:'assistant.example',redirectUri:REDIRECT,grantedAt:Math.floor(Date.now()/1000),outsideBindingUid:binding.uid};
  return {token,refreshToken:tokens.refresh_token,binding,agent,props};
}
const decoded=(r:any)=>JSON.parse(r.content[0].text);
const proposalTool=()=>registeredTools().find(t=>t.name==='team.propose')!;
const args=()=>({company:101,module:'experiments',option:'fill:hypothesis',text:'Interview teams about their current workflow.',request_id:crypto.randomUUID()});
function retention(w: W, agentId: number) {
  w.db.prepare("INSERT INTO agent_memory_notes(uid,agent_id,scope_kind,company_id,kind,body) VALUES('note',?,'company',11,'fact','Kept team fact')").run(agentId);
  w.db.prepare("INSERT INTO agent_duties(uid,agent_id,template_key,title,cadence,hour_utc,next_due_at) VALUES('duty',?,'cpo.test','Test duty','daily',0,'2099-01-01')").run(agentId);
}

test('OAuth consent offers only real manageable companies; a selected company cannot borrow another project or member’s authority',async()=>{
  const w=world(); const p=await parked(w);
  const choices=await asUser(w,'GET',`/api/mcp/consent/${p.id}`);
  assert.deepEqual(choices.body.outside_assistant.companies,[{uid:'company-a',name:'Company A'}]);
  const member=await asUser(w,'GET',`/api/mcp/consent/${p.id}`,undefined,2);
  assert.deepEqual(member.body.outside_assistant.companies,[]);
  for(const body of [{companies:[102],team_agent:{company_uid:'company-a',role_key:'cpo'}},{companies:[101],team_agent:{company_uid:'company-b',role_key:'cpo'}}]) {
    assert.equal((await asUser(w,'POST',`/api/mcp/consent/${p.id}/approve`,body)).status,403);
  }
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM team_agents').get().n,0); w.db.close();
});

test('completed OAuth binds one actual provider grant and lists only the current role’s read/proposal tools',async()=>{
  const w=world(); const c=await connect(w);
  assert.equal(c.binding.state,'active'); assert.equal(c.agent.source,'mcp_client'); assert.equal(c.agent.persona_key,null);
  const grants=await oauthHelpers(w.env).listUserGrants('1');
  assert.equal(grants.items[0].id,c.binding.grant_id);
  assert.equal((grants.items[0].metadata as any).outsideBindingUid,c.binding.uid);
  const available=await listedTools(w.env,c.props,['validate:read','validate:write','team:propose'],c.binding.grant_id);
  const names=available.tools.map(t=>t.name);
  assert.ok(names.includes('list_companies')); assert.ok(names.includes('team.propose'));
  assert.ok(names.includes('get_validate_context'));
  assert.equal(names.includes('submit_interview'),false); assert.equal(names.includes('get_build_progress'),false);
  const ordinary=await listedTools(w.env,{...c.props,outsideBindingUid:undefined},['team:propose'],c.binding.grant_id);
  assert.equal(ordinary.tools.length,0); w.db.close();
});

test('outside direct writes refuse before execution; ordinary member MCP writes keep D665’s existing gates',async()=>{
  const w=world(); const c=await connect(w); let ran=0;
  const tool:McpTool={name:'submit_interview',requiredScope:'validate:write',source:'axal',version:'1',company:true,readOnly:false,title:'write',description:'write',inputSchema:{},run:async()=>{ran++;return {ok:true};}};
  const outside=await callTool(w.env,c.props,c.binding.grant_id,tool,{company:101},['validate:write']);
  assert.equal(decoded(outside).code,'tool_not_allowed'); assert.equal(ran,0);
  for (const patch of [{name:'list_companies',requiredScope:'validate:read' as const},{name:'list_companies',readOnly:true}]) {
    const disguised=await callTool(w.env,c.props,c.binding.grant_id,{...tool,...patch},{company:101},['validate:read','validate:write']);
    assert.equal(decoded(disguised).code,'tool_not_allowed'); assert.equal(ran,0);
  }
  const member=await callTool(w.env,{...c.props,outsideBindingUid:undefined},c.binding.grant_id,tool,{company:101},['validate:write']);
  assert.equal(member.isError,undefined); assert.equal(ran,1); w.db.close();
});

test('read/proposal policy is company inherited, manager-only and rechecked; [] denies instead of reverting to defaults',async()=>{
  const w=world(); const c=await connect(w);
  assert.equal((await asUser(w,'PUT','/api/teams/company/company-a/outside-assistant-tools',{tools:[]},2)).status,403);
  assert.equal((await asUser(w,'PUT','/api/teams/company/company-a/outside-assistant-tools',{tools:['unknown']})).status,400);
  assert.equal((await asUser(w,'PUT','/api/teams/company/company-a/outside-assistant-tools',{tools:[]})).status,200);
  assert.deepEqual((await asUser(w,'GET','/api/teams/project/101/outside-assistant-tools')).body.tools,[]);
  assert.equal((await listedTools(w.env,c.props,['validate:read','team:propose'],c.binding.grant_id)).tools.length,0);
  const refused=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose']);
  assert.equal(decoded(refused).code,'tool_not_allowed');
  assert.equal((await asUser(w,'PUT','/api/teams/company/company-a/outside-assistant-tools',{tools:null})).status,200);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='team_outside_tools_changed'").get().n,2);
  w.db.exec('UPDATE projects SET company_id=12 WHERE id=101');
  assert.equal(decoded(await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose'])).code,'refused'); w.db.close();
});

test('safety-checked text is one agent-attributed proposal; replay does no model work and a human decides it',async()=>{
  const w=world(); const c=await connect(w); const a=args();
  const first=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),a,['team:propose']);
  assert.equal(first.isError,undefined,JSON.stringify(decoded(first)));
  const p=decoded(first).proposal;
  assert.equal(p.status,'proposed'); assert.equal(p.payload.text,a.text); assert.equal(p.model,'external');
  assert.equal(w.db.prepare('SELECT agent_id FROM ai_rail_proposals').get().agent_id,c.agent.id);
  const guardCalls=w.guarded(); assert.ok(guardCalls>0);
  const again=decoded(await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),a,['team:propose']));
  assert.equal(again.replayed,true); assert.equal(again.proposal.uid,p.uid);
  assert.equal(w.guarded(),guardCalls);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,1); assert.equal(w.generated(),0);
  assert.equal(w.db.prepare('SELECT COALESCE(SUM(charged_microusd),0) AS n FROM ai_usage_logs').get().n,0);
  const queue=await asUser(w,'GET','/api/teams/company/company-a/queue?module=experiments');
  assert.equal(queue.status,200); assert.equal(queue.body.items[0].uid,p.uid); assert.equal(queue.body.items[0].module,'experiments');
  const decided=await asUser(w,'POST',`/api/teams/queue/${p.uid}/decide`,{decision:'accept'});
  assert.equal(decided.status,200,JSON.stringify(decided.body));
  assert.equal(w.db.prepare('SELECT decided_by_user_id FROM ai_rail_proposals').get().decided_by_user_id,1); w.db.close();
});

test('unsafe text and an option outside the role leave no proposal or generation charge',async()=>{
  const w=world(); const c=await connect(w);
  for (const patch of [{module:'solution-design',option:'draft:build/roadmap'},
    {module:'product-roadmap',option:'draft:build/plan'},{module:'experiments',option:'draft:build/roadmap'}]) {
    const noRole=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),{...args(),...patch},['team:propose']);
    assert.equal(decoded(noRole).code,'option_not_allowed');
  }
  w.env.AI=withGuard({run:async()=>{throw new Error('unexpected generation');}},'unsafe\nS1');
  const unsafe=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose']);
  assert.equal(decoded(unsafe).code,'safety_refused');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0); assert.equal(w.generated(),0); w.db.close();
});

test('Team removal and Connected apps revocation both invalidate D1 and the actual OAuth grant',async()=>{
  for(const side of ['team','apps']) {
    const w=world(); const c=await connect(w);
    retention(w,c.agent.id);
    const path=side==='team'?`/api/teams/agents/${c.agent.uid}`:`/api/connectors/assistants/${c.binding.grant_id}`;
    const removed=await asUser(w,'DELETE',path); assert.equal(removed.status,200,JSON.stringify(removed.body));
    assert.equal(w.db.prepare('SELECT status FROM team_agents').get().status,'removed');
    assert.equal(w.db.prepare('SELECT state FROM team_agent_mcp_bindings').get().state,'revoked');
    assert.notEqual(w.db.prepare('SELECT expires_at FROM agent_memory_notes').get().expires_at,null);
    assert.equal(w.db.prepare('SELECT status FROM agent_duties').get().status,'removed');
    assert.equal((await oauthHelpers(w.env).listUserGrants('1')).items.length,0);
    const rpc=await hit(w,'/mcp',{method:'POST',headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
    assert.equal(rpc.status,401);
    await assert.rejects(outsideAgentForGrant(w.env,w.user,{bindingUid:c.binding.uid,clientId:c.props.clientId,grantId:c.binding.grant_id}),{code:'connection_revoked'});
    w.db.close();
  }
});

test('platform run/quote and cap/name/sponsor mutation cannot turn an outside connection into a paid platform agent',async()=>{
  const w=world(); const c=await connect(w);
  const runInput={agent:c.agent,module:'problem-discovery',option:'fill:hypothesis',prompt:'draft'};
  assert.equal((await agentRun(w.env,runInput) as any).code,'outside_assistant');
  assert.equal((await agentQuote(w.env,runInput) as any).code,'outside_assistant');
  for(const body of [{monthly_cap_microusd:50000},{first_name:'someone else'}]) assert.equal((await asUser(w,'PATCH',`/api/teams/agents/${c.agent.uid}`,body)).status,409);
  assert.equal((await asUser(w,'PUT',`/api/teams/agents/${c.agent.uid}/sponsor`,{sponsor_uid:'member',reason:'Change sponsor please'})).status,409);
  assert.equal(w.generated(),0); w.db.close();
});

test('the actual MCP transport derives the bound identity from the OAuth token and leaves a proposal',async()=>{
  const w=world(); const c=await connect(w);
  const response=await hit(w,'/mcp',{method:'POST',headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json',
    Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},
    body:JSON.stringify({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'team.propose',arguments:args()}})});
  assert.equal(response.status,200);
  const rpc:any=await response.json();
  assert.equal(rpc.result.isError,undefined,JSON.stringify(rpc));
  assert.equal(JSON.parse(rpc.result.content[0].text).proposal.status,'proposed');
  assert.equal(w.db.prepare('SELECT agent_id FROM ai_rail_proposals').get().agent_id,c.agent.id);
  const dto=await asUser(w,'GET',`/api/teams/agents/${c.agent.uid}`);
  assert.equal(dto.body.agent.billing,'own_assistant'); assert.equal(dto.body.agent.monthly_cap_microusd,null);
  assert.deepEqual(dto.body.agent.month_spend,{available:false}); w.db.close();
});

test('empty forged binding, feature off and lost sponsor access fail closed on every call',async()=>{
  const w=world(); const c=await connect(w); const scopes=['validate:read','team:propose'];
  assert.equal(decoded(await callTool(w.env,{...c.props,outsideBindingUid:''},c.binding.grant_id,proposalTool(),args(),scopes)).code,'connection_revoked');
  w.env.TEAM_AGENTS_ENABLED='false';
  assert.equal(decoded(await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),scopes)).code,'team_agents_off');
  w.env.TEAM_AGENTS_ENABLED='true';
  w.db.exec("UPDATE user_company_links SET role_in_company='Member' WHERE user_id=1");
  assert.equal(decoded(await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),scopes)).code,'agent_unavailable');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0); w.db.close();
});

test('changed role reads apply immediately; a corrupt rule book never falls back to broader defaults',async()=>{
  const w=world(); const c=await connect(w); const rules={...roleOf('cpo')!.default_rules,reads:[]};
  w.db.prepare("INSERT INTO team_rulebooks(uid,scope_kind,company_id,role_key,version,rules_json,created_by) VALUES('book','company',11,'cpo',1,?,1)").run(JSON.stringify(rules));
  const read=registeredTools().find(t=>t.name==='list_companies')!;
  assert.equal(decoded(await callTool(w.env,c.props,c.binding.grant_id,read,{},['validate:read'])).code,'tool_not_allowed');
  w.db.exec("UPDATE team_rulebooks SET rules_json='{'");
  const listing=await listedTools(w.env,c.props,['validate:read','team:propose'],c.binding.grant_id);
  assert.deepEqual(listing.tools,[]); assert.match(listing.refusal!,/rule book could not be read/);
  assert.equal(decoded(await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose'])).code,'unavailable');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0); w.db.close();
});

test('revocation while the safety check is in flight leaves no proposal',async()=>{
  const w=world(); const c=await connect(w);
  w.env.AI=withGuard({run:async()=>{throw new Error('unexpected generation');}},()=>{
    w.db.exec("UPDATE team_agent_mcp_bindings SET state='revoked'; UPDATE team_agents SET status='removed'"); return 'safe';
  });
  const r=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose']);
  assert.equal(decoded(r).code,'connection_revoked');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0); w.db.close();
});

test('a future nonzero tool fee still cannot charge the outside assistant’s sponsor or team cap',async()=>{
  const w=world(); const c=await connect(w);
  const policy={...METERING_POLICY,operations:{...METERING_POLICY.operations,[toolOperation('team.propose')]:{price_microusd:999999,unit:'call' as const}}};
  const r=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose'],policy);
  assert.equal(r.isError,undefined,JSON.stringify(decoded(r)));
  assert.equal(w.db.prepare('SELECT COALESCE(SUM(charged_microusd),0) AS n FROM ai_usage_logs').get().n,0);
  assert.equal(w.db.prepare('SELECT reservation_uid FROM api_usage_events').get().reservation_uid,null);
  assert.equal(w.generated(),0); w.db.close();
});

test('refreshing the OAuth token preserves its outside binding and cannot regain ordinary direct-write tools',async()=>{
  const w=world(); const c=await connect(w);
  const res=await hit(w,'/api/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
    grant_type:'refresh_token',refresh_token:c.refreshToken,client_id:c.props.clientId,resource:'https://axal.vc/mcp'})});
  assert.equal(res.status,200,await res.clone().text()); const token=(await res.json() as any).access_token;
  const list=await hit(w,'/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',
    Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/list'})});
  assert.equal(list.status,200); const rpc:any=await list.json(); const names=rpc.result.tools.map((t:any)=>t.name);
  assert.ok(names.includes('team.propose')); assert.equal(names.includes('submit_interview'),false);
  const schema=rpc.result.tools.find((t:any)=>t.name==='team.propose').inputSchema;
  assert.ok(schema.properties.module.enum.includes('experiments')); assert.equal(schema.properties.module.enum.includes('use-of-funds'),false);
  assert.ok(schema.properties.option.enum.includes('fill:hypothesis'));
  assert.equal(schema.properties.option.enum.includes('draft:build/plan'),false); w.db.close();
});

test('the atomic insert refuses a connection revoked or project moved after the final pre-write read',async()=>{
  for (const change of ["UPDATE team_agent_mcp_bindings SET state='revoked'", "UPDATE team_agents SET status='removed'",'UPDATE projects SET company_id=12 WHERE id=101']) {
    const w=world(); const c=await connect(w); const batch=w.env.DB.batch.bind(w.env.DB);
    w.env.DB.batch=async(statements:unknown[])=>{w.db.exec(change);return batch(statements);};
    const r=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose']);
    assert.equal(decoded(r).code,'connection_revoked');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0); w.db.close();
  }
});

test('a tool policy changed during the safety check is applied before the proposal is stored',async()=>{
  const w=world(); const c=await connect(w);
  w.env.AI=withGuard({run:async()=>{throw new Error('unexpected generation');}},()=>{
    w.db.exec("INSERT INTO team_allowlists(scope_kind,scope_id,axal_tools_json,updated_by) VALUES('company',11,'[]',1)"); return 'safe';
  });
  const r=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose']);
  assert.equal(decoded(r).code,'tool_not_allowed');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0); w.db.close();
});

test('unreadable policy and invalid rule-book shape refuse instead of returning defaults or an empty successful read',async()=>{
  const w=world(); const c=await connect(w);
  w.db.exec("INSERT INTO team_allowlists(scope_kind,scope_id,axal_tools_json,updated_by) VALUES('company',11,'[\"unknown\"]',1)");
  const listing=await listedTools(w.env,c.props,['validate:read','team:propose'],c.binding.grant_id);
  assert.deepEqual(listing.tools,[]); assert.match(listing.refusal!,/allowed tools could not be read/);
  w.db.exec('UPDATE team_allowlists SET axal_tools_json=NULL');
  w.db.exec("INSERT INTO team_rulebooks(uid,scope_kind,company_id,role_key,version,rules_json,created_by) VALUES('bad','company',11,'cpo',1,'{}',1)");
  const rules=await listedTools(w.env,c.props,['validate:read','team:propose'],c.binding.grant_id);
  assert.deepEqual(rules.tools,[]); assert.match(rules.refusal!,/rule book could not be verified/); w.db.close();
});

test('a sponsor who can still read a project after ownership changes cannot use team proposals to bypass its write gate',async()=>{
  const w=world(); const c=await connect(w);
  w.db.exec('UPDATE users SET spinout_lab_active=1 WHERE id=1; UPDATE projects SET founder_id=1002 WHERE id=101');
  const r=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose']);
  assert.equal(decoded(r).code,'refused'); assert.match(decoded(r).error,/no longer write to/);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0); assert.equal(w.guarded(),0); w.db.close();
});

test('provider revocation failure still cleans up retention/duties, blocks calls and is retryable from Team',async()=>{
  const w=world(); const c=await connect(w); retention(w,c.agent.id);
  const remove=w.env.OAUTH_KV.delete.bind(w.env.OAUTH_KV);
  w.env.OAUTH_KV.delete=async()=>{throw new Error('simulated provider outage');};
  const failed=await asUser(w,'DELETE',`/api/teams/agents/${c.agent.uid}`);
  assert.equal(failed.status,503); assert.equal(failed.body.error,'connection_cleanup_pending');
  assert.equal(w.db.prepare('SELECT state FROM team_agent_mcp_bindings').get().state,'revoked');
  assert.notEqual(w.db.prepare('SELECT expires_at FROM agent_memory_notes').get().expires_at,null);
  assert.equal(w.db.prepare('SELECT status FROM agent_duties').get().status,'removed');
  assert.equal(decoded(await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),args(),['team:propose'])).code,'connection_revoked');
  w.env.OAUTH_KV.delete=remove;
  assert.equal((await asUser(w,'DELETE',`/api/teams/agents/${c.agent.uid}`)).status,200);
  assert.equal((await oauthHelpers(w.env).listUserGrants('1')).items.length,0);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM team_agent_events WHERE kind='removed'").get().n,1); w.db.close();
});

test('a shared Build option does not let a CTO propose in a module outside its role',async()=>{
  const w=world(); const c=await connect(w,'cto');
  const outside={...args(),module:'company-creation',option:'draft:build/plan'};
  const refused=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),outside,['team:propose']);
  assert.equal(decoded(refused).code,'option_not_allowed');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,0);
  const inside=await callTool(w.env,c.props,c.binding.grant_id,proposalTool(),{...outside,module:'solution-design',request_id:crypto.randomUUID()},['team:propose']);
  assert.equal(inside.isError,undefined,JSON.stringify(decoded(inside)));
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n,1); w.db.close();
});
