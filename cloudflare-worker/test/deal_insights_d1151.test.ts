import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import insights from '../src/routes/deal_insights.ts';
import { ARCHETYPES } from '../src/services/archetypeScoring.ts';
const secret = 'synthetic-d1151-only-'.repeat(3);
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter(n => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
    if (migrationNumber(name) > BASELINE_CUTOFF) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map(r => r.sql).join(';\n');
  db.close(); return sql;
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id) VALUES
    (1,'admin@example.test','Staff','admin',NULL), (2,'founder@example.test','Founder','founder',20),
    (3,'investor@example.test','Invited','investor',NULL), (4,'stranger@example.test','Stranger','investor',NULL),
    (5,'partner@example.test','Partner','partner',NULL), (6,'other@example.test','Other founder','founder',60),
    (7,'hire@example.test','Published hire','founder',NULL), (8,'hidden@example.test','Private hire','founder',NULL),
    (9,'inactive@example.test','Inactive','founder',NULL);
    UPDATE users SET is_active=0 WHERE id=9;
    INSERT INTO projects(id,name,founder_id,sector,stage,tagline,tam,sam,som) VALUES
      (10,'Venture',20,'Climate','build','Public headline',1000,NULL,0),(20,'Other',60,'Other','idea','Other headline',99999,99999,99999);
    INSERT INTO deals(id,project_id,status) VALUES(100,10,'active'),(200,20,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(100,3);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES
      (10,7,'engineer','accepted'),(10,8,'designer','accepted'),(10,9,'cto','accepted'),(10,6,'invited','invited');
    INSERT INTO user_settings(user_id,visibility,visibility_chosen_at) VALUES(8,'private','2026-10-01');
    INSERT INTO user_profile_ext(user_id,experience) VALUES(2,'[{"title":"Builder","company":"Prior Co","start":"2020","email":"PRIVATE"}]');
    INSERT INTO market_sources(project_id,title,url) VALUES(10,'General source','https://example.test/market');
    INSERT INTO customer_segments(project_id,name,name_norm) VALUES(10,'Buyers','buyers'),(20,'PRIVATE','private');
    INSERT INTO markets(uid,project_id,name,state) VALUES('test-market',10,'Canada','served');
    INSERT INTO competitor_tracking(uid,project_id,name_norm) VALUES('tracked',10,'Kept competitor'),('stopped',10,'PRIVATE');
    UPDATE competitor_tracking SET stopped_at='2026-01-01' WHERE uid='stopped';`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' } as any };
}
function nda(f: ReturnType<typeof fixture>, status='active', expiry: string | null=null) {
  f.db.prepare('DELETE FROM pairwise_ndas').run();
  f.db.prepare('INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status,valid_until) VALUES(2,3,?,?)').run(status,expiry);
}
async function read(f: ReturnType<typeof fixture>, path: string, who=3) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg:'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await insights.request(path, { headers: { Authorization: `Bearer ${token}` } }, f.env);
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() as any };
}
function sharedUpdate(f: ReturnType<typeof fixture>, period: string, value: number, audience: string, status='submitted', source: string | null='typed', project=10) {
  f.db.prepare(`INSERT INTO portfolio_updates(uid,project_id,author_user_id,period,title,status,audience_json,metrics_json)
    VALUES(lower(hex(randomblob(16))),?,2,?,'Synthetic update',?,?,?)`).run(project,period,status,audience,JSON.stringify([
      { key:'mrr',label:'MRR',value,source,unit:'usd',as_of:period+'-01' },
      { key:'cash',label:'PRIVATE',value:99999,source:'bank',unit:'usd' }]));
}

test('D1151: authentication and canonical deal ownership precede every section', async () => {
  const f=fixture();
  try {
    const unauth=await insights.request('/100/team',{},f.env);
    assert.equal(unauth.status,401);
    for (const section of ['team','market','traction']) {
      for (const [path,who,status] of [[`/100/${section}`,4,404],[`/100/${section}`,6,404],[`/200/${section}`,3,404],[`/999/${section}`,1,404],[`/0/${section}`,3,400],[`/1e2/${section}`,3,400]] as const) {
        assert.equal((await read(f,path,who)).status,status);
      }
      for (const who of [1,2,5]) {
        const result=await read(f,`/100/${section}`,who);
        assert.deepEqual([result.status,result.body.masked],[200,false]);
      }
    }
    f.db.prepare('DELETE FROM deal_invitations').run();
    f.db.prepare("INSERT INTO commitments(deal_id,investor_user_id,amount,status) VALUES(100,3,100,'withdrawn')").run();
    assert.equal((await read(f,'/100/team')).status,200);
  } finally { f.db.close(); }
});

test('D1151: missing, expired, malformed and wrong-pair NDAs reveal only the public mask', async () => {
  const f=fixture();
  try {
    // Break every section store. A masked response must not read any of them.
    for (const table of ['project_members','market_sources','portfolio_updates']) f.db.exec(`DROP TABLE ${table}`);
    for (const [status,expiry] of [['pending',null],['active','2000-01-01'],['active','not-a-date'],['revoked',null]] as const) {
      nda(f,status,expiry);
      for (const section of ['team','market','traction']) {
        const result=await read(f,`/100/${section}`);
        assert.deepEqual(result,{ status:200,cache:'private, no-store',body:{ masked:true,reason:'no_pairwise_nda',project:{name:'Venture',sector:'Climate',stage:'build',headline:'Public headline'} } });
      }
    }
    f.db.exec("DELETE FROM pairwise_ndas; INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(6,3,'active')");
    assert.equal((await read(f,'/100/team')).body.masked,true);
    f.db.exec('DELETE FROM pairwise_ndas');
    assert.equal((await read(f,'/100/team')).body.masked,true);
  } finally { f.db.close(); }
});

test('D1151: published team projection omits private/inactive/invited people and individual attributes', async () => {
  const f=fixture();
  try {
    nda(f);
    const archetype=ARCHETYPES.founder[0];
    f.db.prepare(`INSERT INTO profile_snapshots(user_id,persona,engine_version,trigger_kind,displayed_slug,traits_json,skills_json,values_json,axal_values_json,computed_at)
      VALUES(2,'founder','test','answer',?,'{"PRIVATE":5}','{"PRIVATE":5}','{"PRIVATE":5}','{"PRIVATE":5}','2026-10-01')`).run(archetype.slug);
    f.db.exec('INSERT INTO profile_archetype_publish(user_id,published) VALUES(2,0)');
    const result=await read(f,'/100/team');
    assert.deepEqual(result.body.people.data,[
      {uid:f.db.prepare('SELECT uid FROM users WHERE id=2').get()!.uid,name:'Founder',role:'founder',prior_roles:[{title:'Builder',company:'Prior Co',start:'2020',end:null}],archetype:null,full_time_since:null,full_time_reason:'Not recorded',founder_market_fit:null,founder_market_fit_reason:'No published evidence recorded'},
      {uid:f.db.prepare('SELECT uid FROM users WHERE id=7').get()!.uid,name:'Published hire',role:'engineer',prior_roles:[],archetype:null,full_time_since:null,full_time_reason:'Not recorded',founder_market_fit:null,founder_market_fit_reason:'No published evidence recorded'},
    ]);
    assert.deepEqual(result.body.coverage.data.map((x:any)=>x.coverage_band),Array(8).fill(null));
    assert.deepEqual(result.body.values_band,{ value:null,state:'not_recorded',reason:'No recorded consent to share a team values band' });
    f.db.exec('UPDATE profile_archetype_publish SET published=1 WHERE user_id=2');
    assert.deepEqual((await read(f,'/100/team')).body.people.data[0].archetype,{slug:archetype.slug,label:archetype.label});
    f.db.prepare(`UPDATE users SET privacy_prefs='{"public_profile":{"name":false}}' WHERE id=7`).run();
    f.db.prepare(`UPDATE users SET privacy_prefs='{"public_profile":{"background":false}}' WHERE id=2`).run();
    assert.deepEqual((await read(f,'/100/team')).body.people.data.map((x:any)=>[x.name,x.prior_roles]),[['Founder',[]]]);
  } finally { f.db.close(); }
});

test('D1151: eight-axis coverage is a team aggregate and never fills a missing axis with zero', async () => {
  const f=fixture();
  try {
    nda(f);
    f.db.exec("INSERT INTO skills(id,slug,label,category_slug,is_active) VALUES(9911,'synthetic-engineering','Synthetic engineering','engineering',1)");
    const skill=f.db.prepare("SELECT id FROM skills WHERE category_slug='engineering' AND is_active=1 LIMIT 1").get()!;
    f.db.prepare('INSERT INTO user_skills(user_id,skill_id,self_level) VALUES(2,?,3),(7,?,4),(8,?,5)').run(skill.id,skill.id,skill.id);
    const axes=(await read(f,'/100/team')).body.coverage.data;
    assert.deepEqual(axes.filter((x:any)=>x.coverage_band!=null).map((x:any)=>[x.slug,x.coverage_band,x.reason]),[['engineering','covered',null]]);
    f.db.exec('UPDATE user_skills SET self_level=0 WHERE user_id=2; UPDATE user_skills SET self_level=5 WHERE user_id=7');
    assert.equal((await read(f,'/100/team')).body.coverage.data.find((x:any)=>x.slug==='engineering').coverage_band,'partial');
    f.db.exec('UPDATE user_skills SET self_level=0 WHERE user_id=7');
    assert.equal((await read(f,'/100/team')).body.coverage.data.find((x:any)=>x.slug==='engineering').coverage_band,'gap');
    f.db.prepare(`UPDATE users SET privacy_prefs='{"public_profile":{"background":false}}' WHERE id=7`).run();
    assert.deepEqual((await read(f,'/100/team')).body.coverage.data.map((x:any)=>x.coverage_band),Array(8).fill(null));
    f.db.prepare('UPDATE users SET privacy_prefs=NULL WHERE id=7').run();
    f.db.prepare('DELETE FROM user_skills WHERE user_id=7').run();
    assert.deepEqual((await read(f,'/100/team')).body.coverage.data.map((x:any)=>x.coverage_band),Array(8).fill(null));
  } finally { f.db.close(); }
});

test('D1151: corrupt career history affects only that field, never other people or coverage', async () => {
  const f=fixture();
  try {
    nda(f);
    f.db.prepare("UPDATE user_profile_ext SET experience='not-json' WHERE user_id=2").run();
    const result=(await read(f,'/100/team')).body;
    assert.deepEqual([result.people.state,result.people.data.length,result.people.data[0].prior_roles,result.people.data[0].prior_roles_state,result.people.data[1].name,result.coverage.state],['recorded',2,null,'unreadable','Published hire','recorded']);
    f.db.prepare("UPDATE users SET privacy_prefs='not-json' WHERE id=2").run();
    const corrupt=(await read(f,'/100/team')).body;
    assert.deepEqual([corrupt.people.state,corrupt.people.publication_state,corrupt.people.data.map((x:any)=>x.name),corrupt.coverage.state],['recorded','unreadable',['Published hire'],'recorded']);
  } finally { f.db.close(); }
});

test('D1151: market preserves provenance gaps, recorded zero and project scoping; one failure stays local', async () => {
  const f=fixture();
  try {
    nda(f);
    const market=(await read(f,'/100/market')).body;
    assert.deepEqual(market.sizing.data,{tam:{value:1000,source:null,reason:'No source recorded for this figure'},sam:{value:null,source:null,reason:'Not recorded'},som:{value:0,source:null,reason:'No source recorded for this figure'}});
    assert.deepEqual(market.sources.data,[{title:'General source',url:'https://example.test/market',kind:'manual'}]);
    assert.deepEqual(market.who_pays.data,[{name:'Buyers',description:null,source:'manual'}]);
    assert.deepEqual(market.company_markets.data.map((x:any)=>[x.name,x.state,x.demand_score]),[['Canada','served',null]]);
    assert.deepEqual(market.competitors.data,[{name:'Kept competitor',why_it_matters:null,price_position:null,depth_position:null}]);
    f.db.exec('DROP TABLE market_sources');
    const failed=(await read(f,'/100/market')).body;
    assert.deepEqual(failed.sources,{state:'unreadable',reason:'Unreadable. Try again.'});
    assert.deepEqual(failed.sizing,market.sizing);
  } finally { f.db.close(); }
});

test('D1151: traction requires explicit sharing and a source, preserves zero and missing months, never exposes bank data', async () => {
  const f=fixture();
  try {
    nda(f);
    const now=new Date();
    const month=now.toISOString().slice(0,7);
    const previous=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
    sharedUpdate(f,month,0,'{"investors":true}');
    sharedUpdate(f,previous,999,'{}');
    sharedUpdate(f,month,888,'{"investors":"true"}');
    sharedUpdate(f,month,777,'{"investors":true}','draft');
    sharedUpdate(f,month,666,'{"investors":true}','submitted','typed',20);
    sharedUpdate(f,previous,555,'{"investors":true}','submitted',null);
    const history=(await read(f,'/100/traction')).body.history.data;
    assert.equal(history.length,12);
    assert.deepEqual(history.at(-1),{month,state:'reported',reason:null,figures:[{key:'mrr',label:'MRR',value:0,unit:'usd',source:'typed',as_of:month+'-01',reason:null}]});
    assert.deepEqual(history.at(-2),{month:previous,state:'not_reported',reason:'Not reported',figures:[]});
    f.db.prepare(`UPDATE portfolio_updates SET audience_json='{}' WHERE project_id=10`).run();
    assert.deepEqual((await read(f,'/100/traction')).body.history.data.flatMap((x:any)=>x.figures),[]);
    const update=f.db.prepare('SELECT id FROM portfolio_updates WHERE project_id=10 ORDER BY id LIMIT 1').get()!;
    f.db.prepare("INSERT INTO update_recipients(update_id,user_id,audience) VALUES(?,4,'investor')").run(update.id);
    assert.deepEqual((await read(f,'/100/traction')).body.history.data.flatMap((x:any)=>x.figures),[]);
    f.db.prepare('UPDATE update_recipients SET user_id=3').run();
    assert.deepEqual((await read(f,'/100/traction')).body.history.data.flatMap((x:any)=>x.figures).map((x:any)=>x.value),[0]);
    f.db.exec('DROP TABLE portfolio_updates');
    assert.deepEqual((await read(f,'/100/traction')).body.history,{state:'unreadable',reason:'Unreadable. Try again.'});
  } finally { f.db.close(); }
});
