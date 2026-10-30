/** D1262 (#3285): landed stores, source provenance and independent money states. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { cards, checkInputs, computeReadiness, dataRoomCard, figures, loadReadiness, latestScores, readinessCard, teamReadiness } from '../src/services/raiseCycle.ts';
import { runCheck, scoreReadinessItem, rescoreReadiness } from '../src/services/raiseWriters.ts';
const migrations = new URL('../sql/migrations/', import.meta.url);
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const n of readdirSync(migrations).filter(n => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
    if (migrationNumber(n) > BASELINE_CUTOFF) db.exec(readFileSync(new URL(n, migrations), 'utf8'));
  }
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map(r => r.sql).join(';\n');
  db.close(); return sql;
})();
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); db.exec(ddl);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Synthetic founder','founder@example.invalid',11,1),
    (2,'investor','Synthetic investor','investor@example.invalid',NULL,1),
    (3,'founder','Other synthetic founder','other@example.invalid',33,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES(1,'one','Synthetic venture',11),(2,'two','Other venture',33);`);
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development' };
  return { db, env, ctx: { env, projectId: 1, today: new Date().toISOString().slice(0,10) } };
}
const ago=(days:number)=>{const d=new Date();d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);};
const proof = async (env: any) => (await computeReadiness(env, 1)).find(x => x.key === 'traction')!;
const figure = async (ctx: any, key: string): Promise<any> => (await figures(ctx)).find(x => x.key === key)!;
function narrative(db: DatabaseSync, selected: string | null) {
  db.exec("INSERT INTO spinout_deck_overrides(project_id,field_key,value,version) VALUES(1,'traction.takeaway','$900 MRR and $600 monthly revenue',1)");
  db.prepare('INSERT INTO narrative_version_meta(project_id,version,check_against_json) VALUES(1,1,?)').run(selected);
}

test('#3715: empty team inputs use plain words, muted tones and venture-scoped next steps', async () => {
  const f = fixture();
  try {
    const result = await teamReadiness(f.env, 1);
    assert.deepEqual(result.reads.map(({ b, c, tone, note, next }) => ({ b, c, tone, note, next })), [
      { b: 'No founders recorded yet', c: 'Missing', tone: 'muted', note: undefined,
        next: { text: 'Add founders', href: '/build/founding-team?project=1' } },
      { b: 'No vesting recorded', c: 'Missing', tone: 'muted', note: undefined,
        next: { text: 'Add vesting', href: '/raise/cap-table?project=1' } },
      { b: 'GitHub · 0 contributors in the last 90 days', c: 'Missing', tone: 'muted',
        note: '0 commits · dates not available', next: undefined },
    ]);
    assert.deepEqual((await teamReadiness(f.env, 2)).reads.flatMap(r => r.next ? [r.next.href] : []),
      ['/build/founding-team?project=2', '/raise/cap-table?project=2']);
  } finally { f.db.close(); }
});

/** Collect display values, excluding record keys, routes and other protocol identifiers. */
function memberWords(value: any): string[] {
  if (Array.isArray(value)) return value.flatMap(memberWords);
  if (value == null || typeof value !== 'object') return [];
  const display = new Set(['a', 'b', 'c', 'label', 'caption', 'source', 'reason', 'missing', 'text', 'title', 'note', 'value']);
  return Object.entries(value).flatMap(([key, item]) => typeof item === 'string'
    ? display.has(key) ? [item] : [] : memberWords(item));
}

test('#3715: every Raise card and headline uses display words rather than a snake_case table name', async () => {
  const f = fixture();
  try {
    const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .map(r => r.name).filter(name => /^[a-z][a-z0-9_]*$/.test(name) && name.includes('_'));
    const internalName = new RegExp(`\\b(?:${tables.join('|')})\\b`, 'i');
    for (const state of ['empty', 'populated', 'unreadable']) {
      if (state === 'populated') {
        team(f.db); narrative(f.db, '["metrics"]');
        f.db.exec(`INSERT INTO project_metrics(project_id,snapshot_date,source,mrr,paying_accounts,cash_balance,net_burn)
          VALUES(1,date('now'),'stripe',1000,10,12000,1000);
          INSERT INTO raise_rounds(uid,project_id,name,status,target_amount) VALUES('guard-round',1,'Seed','active',100000);
          INSERT INTO revenue_entries(uid,project_id,customer,amount_cents,currency,revenue_type,received_on,source,verification)
          VALUES('guard-revenue',1,'Synthetic customer',10000,'usd','one_time',date('now','start of month','-1 month','+2 days'),'stripe','verified');`);
        f.db.exec("UPDATE spinout_deck_overrides SET value = value || ' Raising $150k with 15 paying customers.' WHERE project_id = 1 AND version = 1");
        await runCheck(f.env, 1, 1);
        await scoreReadinessItem(f.env, { projectId: 1, userId: 1, key: 'team', score: 7, evidence: 'pattern', missing: null });
      }
      if (state === 'unreadable') f.env.DB.prepare = () => { throw new Error('Synthetic cap_table_holders/project_metrics read failure'); };
      const surface = { cards: await cards(f.ctx), figures: await figures(f.ctx),
        checks: state === 'unreadable' ? await teamReadiness(f.env, 1) : await computeReadiness(f.env, 1) };
      assert.equal(surface.cards.length, 7, 'the guard covers all seven Raise cards');
      assert.doesNotMatch(memberWords(surface).join('\n'), internalName, `${state}: visible labels, values, sources and reasons`);
      if (state === 'populated') {
        const rows = (surface.cards.find(card => card.slug === 'fundraising-readiness')!.series as any[]).find(spec => spec.kind === 'rows' && spec.items.some((r: any) => r.label === 'Founders with vesting'));
        assert.deepEqual(rows.items.map((r: any) => r.next?.href).filter(Boolean), ['/build/founding-team?project=1', '/raise/cap-table?project=1']);
        assert.match(rows.items.find((r: any) => r.label === 'GitHub activity')?.note ?? '', /dates not available/);
      }
    }
  } finally { f.db.close(); }
});

test('the stored check selection controls reads and clears old mismatches without inventing a deck', async () => {
  const f = fixture(); try {
    narrative(f.db, '["metrics"]');
    f.db.exec("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr) VALUES(1,'2026-10-01','stripe',1000),(1,'2026-10-20','manual',900)");
    const checked = await runCheck(f.env, 1, 1);
    assert.equal(checked[0].metric_value, 1000); assert.match(checked[0].metric_source, /Stripe.*2026-10-01/);
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = (sql: string) => {
      if (/project_metrics|revenue_entries|mercury_raise_facts|raise_rounds/.test(sql)) throw new Error('Unselected source read');
      return prepare(sql);
    };
    for (const selection of ['["deck"]', '[]', 'broken']) {
      f.db.prepare('UPDATE narrative_version_meta SET check_against_json=?').run(selection);
      assert.deepEqual(await runCheck(f.env, 1, 1), []);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM narrative_checks').get()!.n, 0);
    }
  } finally { f.db.close(); }
});

test('typed MRR stays stated; Stripe and typed snapshots remain separately named, dated and scoped', async () => {
  const f = fixture(); try {
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr) VALUES(1,?,'manual',900),(2,?,'stripe',999999)").run(ago(1),ago(0));
    assert.equal((await proof(f.env)).evidence, 'stated');
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr,paying_accounts) VALUES(1,?,'stripe',1000,10),(1,?,'stripe',1200,NULL)").run(ago(10),ago(9));
    const p = await proof(f.env); assert.equal(p.evidence, 'measured');
    const rows = JSON.stringify(p.reads); assert.match(rows, /MRR · Connector.*1,200/); assert.match(rows, /MRR · Typed.*900.*manual/);assert.ok(rows.includes(ago(9)));assert.ok(rows.includes(ago(1)));
    assert.doesNotMatch(rows, /999,999/);
    narrative(f.db, '["metrics"]'); const inputs = await checkInputs(f.env, 1, 1);
    assert.equal(inputs.metrics.mrr!.value, 1200); assert.equal(inputs.metrics.paying_customers!.value, 10);
    f.db.exec('UPDATE project_metrics SET mrr=0,paying_accounts=0 WHERE project_id=1');
    f.db.exec('UPDATE projects SET mrr=0,revenue=0,paying_customers=0 WHERE id=1');
    const zero = await proof(f.env); assert.equal(zero.score, 0);
    assert.match(zero.reads.find(r => r.a === 'MRR (stated)')!.b, /^\$0 · Typed/);
    assert.match(zero.reads.find(r => r.a === 'MRR · Connector')!.b, /^\$0/);
    assert.equal(zero.reads.find(r => r.a === 'MRR · Connector')!.c,'Partial');
    assert.equal(zero.reads.find(r => r.a === 'MRR (stated)')!.c,'Partial');
    f.db.exec('UPDATE project_metrics SET source=NULL WHERE project_id=1');
    assert.match((await checkInputs(f.env,1,1)).metrics.mrr!.source,/source not recorded/);
  } finally { f.db.close(); }
});

test('revenue proof names Connector, Document and Typed records and keeps period and currency boundaries', async () => {
  const f = fixture(); try {
    narrative(f.db, '["metrics"]');
    const insert = f.db.prepare(`INSERT INTO revenue_entries(uid,project_id,customer,amount_cents,currency,revenue_type,received_on,source,verification,proof_document_id)
      VALUES(?,?,'Synthetic private customer',?,?,'one_time',date('now','start of month',?, '+5 days'),?,?,?)`);
    insert.run('stripe',1,50000,'usd','-1 month','stripe','verified',null);
    insert.run('typed',1,20000,'usd','-1 month','csv','manual',null);
    insert.run('document',1,3000,'usd','-1 month','manual','supported',7);
    insert.run('bank',1,10000,'usd','-1 month','mercury','supported',null);
    for (const [uid, project, currency, month] of [['foreign',2,'usd','-1 month'],['eur',1,'eur','-1 month'],['old',1,'usd','-2 months'],['current',1,'usd','+0 months']] as const) insert.run(uid,project,999999,currency,month,'stripe','verified',null);
    insert.run('stripe-document',1,10000,'usd','-1 month','stripe','verified',8);
    const p = await proof(f.env); assert.equal(p.evidence, 'measured');
    const rows = JSON.stringify(p.reads); assert.match(rows, /Connector · Stripe/); assert.match(rows, /Connector · Mercury/); assert.match(rows, /Document · revenue proof/); assert.match(rows, /Typed · csv/);
    assert.match(p.reads.find(r=>r.a==='Revenue entries · Connector · Stripe')!.b,/^\$500 ·/);
    assert.equal(p.reads.filter(r=>r.a.startsWith('Revenue entries ·')).length,5);
    assert.equal(p.reads.find(r=>r.a==='Verified revenue')!.b.match(/Connector · Stripe/g)!.length,1);
    const stripeRows=p.reads.filter(r=>r.a==='Revenue entries · Connector · Stripe');
    assert.match(stripeRows.find(r=>r.b.startsWith('$100 ·'))!.b,/ · verified · proof document recorded/);assert.match(stripeRows.find(r=>r.b.startsWith('$500 ·'))!.b,/ · verified · no proof document recorded/);
    assert.doesNotMatch(rows, /10,000|Synthetic private customer/);
    const checked = await checkInputs(f.env,1,1); assert.equal(checked.metrics.revenue!.value,600); assert.match(checked.metrics.revenue!.source,/Verified revenue.*Connector · Stripe/); assert.equal(checked.metrics.mrr,undefined);
    f.db.exec("DELETE FROM revenue_entries WHERE uid IN ('stripe','stripe-document') OR uid IN ('foreign','eur','old','current')");
    assert.equal((await proof(f.env)).evidence,'pattern');
    f.db.exec("DELETE FROM revenue_entries WHERE verification='supported'");
    assert.equal((await proof(f.env)).evidence,'stated');
  } finally { f.db.close(); }
});

function team(db: DatabaseSync) {
  db.exec(`UPDATE projects SET founder_id=11 WHERE id=2;
    INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES(4,'founder','Teammate','mate@example.invalid',11,1),(5,'founder','Disconnected teammate','off@example.invalid',11,1);
    INSERT INTO cap_table_holders(id,user_id,project_id,name,founder_role) VALUES(1,1,1,'Private founder A','CTO'),(2,1,1,'Private founder B','CEO'),(3,1,1,'Employee',NULL),(4,3,2,'Foreign founder','CTO');
    INSERT INTO cap_table_vesting(user_id,holder_id,start_date,total_months) VALUES(3,1,'2026-01-01',48),(1,2,'2026-01-01',48);
    INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(10,'gh-one',1,'github','oauth','active'),(11,'gh-two',4,'github','oauth','active'),(12,'gh-foreign',3,'github','oauth','active'),(13,'gh-off',5,'github','oauth','disconnected'),(14,'other-provider',1,'mercury','oauth','active');
    INSERT INTO github_contributors(integration_id,project_id,repository,login,commits_90d,updated_at) VALUES
    (10,1,'org/one','private-login',10,'2099-01-01'),(11,1,'org/one','private-login',8,'2099-01-02'),(10,1,'org/two','private-login',3,'2099-01-01'),(10,1,'org/one','private-other',4,'2099-01-01'),
    (10,2,'org/foreign','foreign',999,'2099-01-01'),(12,1,'org/bad-owner','foreign-owner',999,'2099-01-01'),(13,1,'org/off','off',999,'2099-01-01'),(14,1,'org/wrong','wrong-provider',999,'2099-01-01');`);
}

test('Team reads real founders, matching vesting and scoped GitHub facts without inventing a score or activity date', async () => {
  const f = fixture(); try {
    team(f.db); const result = await teamReadiness(f.env,1);
    assert.equal(result.score,null); const rows = JSON.stringify(result.reads);
    assert.match(rows,/2 founders recorded/); assert.match(rows,/1 founder with vesting/); assert.match(rows,/2 contributors in the last 90 days.*15 commits/);
    assert.match(rows,/dates not available/); assert.doesNotMatch(rows,/Private founder|private-login|foreign-owner|2099|999/);
    f.db.exec('UPDATE users SET is_active=0 WHERE id=1');
    assert.match(JSON.stringify((await teamReadiness(f.env,1)).reads.find(r=>r.a.includes('GitHub'))),/1 contributor in the last 90 days.*8 commits/);
    f.db.exec('UPDATE users SET is_active=1 WHERE id=1');
    f.db.exec("INSERT INTO project_members(project_id,user_id,status) VALUES(1,3,'accepted')");
    assert.match(JSON.stringify((await teamReadiness(f.env,1)).reads.find(r=>r.a.includes('GitHub'))),/3 contributors in the last 90 days.*1014 commits/);
    f.db.exec("UPDATE project_members SET status='removed' WHERE user_id=3");
    assert.match(JSON.stringify((await teamReadiness(f.env,1)).reads.find(r=>r.a.includes('GitHub'))),/2 contributors in the last 90 days.*15 commits/);
    await scoreReadinessItem(f.env,{projectId:1,userId:1,key:'team',score:7,evidence:'pattern',missing:null});
    const rescored=await rescoreReadiness(f.env,{projectId:1,userId:1}); assert.equal(rescored.items.includes('team'),false);
    const stored=await loadReadiness(f.ctx); const id=stored.items.find(i=>i.item_key==='team')!.id;
    assert.equal(latestScores(stored.scores).get(id)!.score,7);
    assert.match(JSON.stringify((await readinessCard(f.ctx)).series),/2 contributors in the last 90 days.*15 commits/);
  } finally { f.db.close(); }
});

test('a failed Team source stays Unreadable while its other source remains available', async () => {
  const f=fixture();try {
    team(f.db); const prepare=f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare=(sql:string)=>{if(sql.includes('FROM github_contributors'))throw new Error('Synthetic refusal');return prepare(sql);};
    let result=await teamReadiness(f.env,1); assert.match(result.reads.find(r=>r.a.includes('GitHub'))!.b,/Could not be read/); assert.match(result.reads[0].b,/2 founders/);
    assert.deepEqual(result.reads.filter(r => r.c === 'Unreadable').map(r => r.tone), ['bad']);
    f.env.DB.prepare=(sql:string)=>{if(sql.includes('FROM cap_table_holders'))throw new Error('Synthetic refusal');return prepare(sql);};
    result=await teamReadiness(f.env,1); assert.match(result.reads[0].b,/Could not be read/); assert.match(result.reads.find(r=>r.a.includes('GitHub'))!.b,/2 contributors/);
    assert.deepEqual(result.reads.filter(r => r.c === 'Unreadable').map(r => r.tone), ['bad']);
  }finally{f.db.close();}
});

test('data-room readiness counts downloadable coverage; only open_room and download count as opens',async()=>{
  const f=fixture();try {
    const file=f.db.prepare("INSERT INTO data_room_files(id,uid,project_id,name,r2_key,visibility,access_tier,access_expires_at,checklist_item) VALUES(?,?,1,'Synthetic file','synthetic/file',?,?,?,?)");
    file.run(1,'one','open','invited',null,'incorporation');file.run(2,'private','open','nobody',null,'financial_model');file.run(3,'uncommitted','open','committed',null,'board_consents');file.run(4,'nda','nda','invited',null,'ip_assignment');file.run(5,'expired','open','invited','2000-01-01','security');
    f.db.exec("INSERT INTO data_room_grants(uid,project_id,investor_user_id,granted_by_user_id,status) VALUES('grant',1,2,1,'active')");
    const ready=(await computeReadiness(f.env,1)).find(x=>x.key==='data_room')!;assert.match(ready.reads[0].b,/^1 in/);assert.match(ready.reads[1].b,/^1 of 12/);
    f.db.exec("INSERT INTO data_room_access_log(project_id,user_id,file_id,action) VALUES(1,2,1,'blocked'),(1,2,1,'view'),(2,2,1,'download')");
    let card:any=await dataRoomCard(f.ctx);assert.equal(card.series[1].items[0].value,0);
    f.db.exec("INSERT INTO data_room_access_log(project_id,user_id,file_id,action) VALUES(1,2,1,'open_room'),(1,2,1,'download')");
    card=await dataRoomCard(f.ctx);assert.equal(card.series[1].items[0].value,'2 opens');
  }finally{f.db.close();}
});

test('received, wired, signed and soft are disjoint; only actual receipts are received and soft never joins the firm total',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO raise_rounds(uid,project_id,name,status,target_amount) VALUES('round',1,'Seed','active',100000)");
    f.db.exec("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(10,'receipt-bank',1,'mercury','oauth_mcp','active')");
    const p=f.db.prepare("INSERT INTO raise_prospects(id,uid,project_id,name,stage,commit_status,amount) VALUES(?,?,?,'Private investor','committed',?,?)");
    p.run(1,'wired',1,'wired',1000);p.run(2,'signed',1,'signed',2000);p.run(3,'soft',1,'soft',4000);p.run(4,'received',1,'wired',5000);p.run(5,'foreign',2,'wired',999999);
    const receipt=f.db.prepare("INSERT INTO mercury_personal_matches(uid,user_id,integration_id,mercury_transaction_id,account_last_four,amount_cents,posted_on,target_kind,target_id,state) VALUES(?,1,10,?,'1234',?,'2026-10-01',?,?,?)");
    receipt.run('receipt','bank-one',500000,'raise_prospect',4,'confirmed');receipt.run('withdrawn','bank-two',100000,'raise_prospect',1,'withdrawn');receipt.run('wrong-kind','bank-three',200000,'engagement_invoice',2,'confirmed');
    let result=await figure(f.ctx,'committed');assert.deepEqual(result.breakdown,{received:5000,wired:1000,signed:2000,soft:4000,unclassified:0});assert.deepEqual(result.value,[8000,100000]);
    assert.doesNotMatch(JSON.stringify(result),/Private investor|1234|bank-one|999999/);
    f.db.exec("UPDATE mercury_personal_matches SET state='withdrawn' WHERE uid='receipt'");result=await figure(f.ctx,'committed');assert.equal(result.breakdown.received,0);assert.equal(result.breakdown.wired,6000);
    f.db.exec('UPDATE raise_prospects SET amount=NULL WHERE id=2');result=await figure(f.ctx,'committed');assert.equal(result.value,null);assert.equal(result.breakdown.signed,null);assert.equal(result.state,'not_recorded');
    f.db.exec('DELETE FROM raise_prospects WHERE id!=3');result=await figure(f.ctx,'committed');assert.deepEqual(result.value,[0,100000]);assert.equal(result.breakdown.soft,4000);
  }finally{f.db.close();}
});

test('runway prefers a Connector snapshot, names its date and source, and never mixes typed points into its history',async()=>{
  const f=fixture();try {
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,cash_balance,net_burn) VALUES(1,?,'mercury',400,100),(1,?,'mercury',500,100),(1,?,'mercury',600,100),(1,?,'manual',99999,1),(2,?,'mercury',99999,1)").run(ago(30),ago(20),ago(10),ago(1),ago(0));
    let result=await figure(f.ctx,'runway_months');assert.equal(result.value,6);assert.equal(result.as_of,ago(10));assert.match(result.source,/Connector · Mercury/);assert.deepEqual(result.spark,[4,5,6]);
    f.db.prepare("UPDATE project_metrics SET net_burn=0 WHERE project_id=1 AND source='mercury' AND snapshot_date=?").run(ago(10));result=await figure(f.ctx,'runway_months');assert.equal(result.value,null);assert.equal(result.state,'not_recorded');
    f.db.exec("DELETE FROM project_metrics WHERE project_id=1 AND source='mercury'");result=await figure(f.ctx,'runway_months');assert.equal(result.value,99999);assert.match(result.source,/stated: manual/);
    f.db.exec('DELETE FROM project_metrics WHERE project_id=1');result=await figure(f.ctx,'runway_months');assert.equal(result.value,null);assert.equal(result.state,'not_recorded');
  }finally{f.db.close();}
});

test('only the venture founder’s matching receipt is received; retained proofs survive disconnect',async()=>{
  const f=fixture();try {
    f.db.exec(`INSERT INTO raise_rounds(uid,project_id,name,status,target_amount) VALUES('round',1,'Seed','active',10000);
      INSERT INTO raise_prospects(id,uid,project_id,name,stage,commit_status,amount) VALUES(1,'prospect',1,'Synthetic investor','committed','wired',1000);
      INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(10,'owner-bank',1,'mercury','oauth_mcp','active'),(20,'other-bank',3,'mercury','oauth_mcp','active'),(30,'other-provider',1,'github','oauth','active');
      INSERT INTO mercury_personal_matches(uid,user_id,integration_id,mercury_transaction_id,account_last_four,amount_cents,posted_on,target_kind,target_id,state)
      VALUES('proof',1,10,'synthetic-credit','1234',100000,'2026-10-01','raise_prospect',1,'confirmed');`);
    assert.equal((await figure(f.ctx,'committed')).breakdown.received,1000);
    f.db.exec("UPDATE mercury_personal_matches SET user_id=3,integration_id=20");
    assert.equal((await figure(f.ctx,'committed')).breakdown.received,0);
    f.db.exec("INSERT INTO project_members(project_id,user_id,status) VALUES(1,3,'accepted')");
    assert.equal((await figure(f.ctx,'committed')).breakdown.received,0,'personal receipts require the founder, not merely a project member');
    f.db.exec('UPDATE mercury_personal_matches SET user_id=1');
    assert.equal((await figure(f.ctx,'committed')).breakdown.received,0,'another user’s connection is not the founder’s');
    f.db.exec('UPDATE mercury_personal_matches SET integration_id=30');
    assert.equal((await figure(f.ctx,'committed')).breakdown.received,0,'the integration must be Mercury');
    f.db.exec('UPDATE mercury_personal_matches SET integration_id=10,amount_cents=99999');
    assert.equal((await figure(f.ctx,'committed')).breakdown.received,0,'a receipt must still match the stated amount');
    f.db.exec('UPDATE mercury_personal_matches SET amount_cents=100000; DELETE FROM integrations WHERE id=10');
    const retained=await figure(f.ctx,'committed');assert.equal(retained.breakdown.received,1000);assert.equal(retained.breakdown.wired,0);
    f.db.exec("UPDATE raise_prospects SET amount=1000.005 WHERE id=1; UPDATE mercury_personal_matches SET amount_cents=100001,state='confirmed'");
    assert.equal((await figure(f.ctx,'committed')).breakdown.received,0,'a fractional-cent amount cannot be a matched receipt');
  }finally{f.db.close();}
});

test('stale metrics do not prove current traction or outrank a recent typed runway',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr,cash_balance,net_burn) VALUES(1,'2000-01-01','stripe',1000,NULL,NULL),(1,'2000-01-02','mercury',NULL,99999,1)");
    let traction=await proof(f.env);assert.equal(traction.score,0);assert.notEqual(traction.evidence,'measured');assert.match(JSON.stringify(traction.reads),/Outside the current 90-day window/);
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,cash_balance,net_burn) VALUES(1,?,'manual',20,2)").run(ago(1));
    let runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,10);assert.match(runway.source,/stated: manual/);
    f.db.exec("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(40,'stale-bank',1,'mercury','oauth_mcp','active'); INSERT INTO mercury_raise_facts(integration_id,project_id,kind,fact_key,label,amount_cents,burn_cents,value,as_of) VALUES(40,1,'runway','runway','Runway',999999,100,9999,'2000-01-01')");
    runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,10,'an old bank fact does not override a recent snapshot');
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr) VALUES(1,?,'stripe',1000)").run(ago(90));
    traction=await proof(f.env);assert.equal(traction.evidence,'measured');assert.equal(traction.score,10);
    f.db.exec("DELETE FROM project_metrics WHERE project_id=1 AND source='stripe'");
    narrative(f.db, '["metrics"]');
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr,paying_accounts) VALUES(1,?,'stripe',1200,12),(1,?,'stripe',9999,99)").run(ago(1),ago(-1));
    traction=await proof(f.env);assert.equal(traction.score,10);assert.equal(traction.evidence,'measured');assert.doesNotMatch(JSON.stringify(traction.reads),/9,999|99 · Stripe/);
    let compared=await checkInputs(f.env,1,1);assert.equal(compared.metrics.mrr!.value,1200);assert.equal(compared.metrics.paying_customers!.value,12);
    f.db.prepare("DELETE FROM project_metrics WHERE source='stripe' AND snapshot_date=?").run(ago(1));
    assert.equal((await proof(f.env)).score,0,'a future observation cannot prove current traction');
    compared=await checkInputs(f.env,1,1);assert.equal(compared.metrics.mrr,undefined);assert.equal(compared.metrics.paying_customers,undefined);
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,cash_balance,net_burn) VALUES(1,?,'mercury',888,1)").run(ago(-1));
    assert.equal((await figure(f.ctx,'runway_months')).value,10,'future cash does not replace the recorded current snapshot');
    f.db.exec('DELETE FROM project_metrics WHERE project_id=1 AND cash_balance=20');
    runway=await figure(f.ctx,'runway_months');assert.match(runway.reason,/Stale/);assert.equal(runway.as_of,'2000-01-02');
    f.db.exec("UPDATE mercury_raise_facts SET as_of='2000-01-03'");
    runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,10000);assert.equal(runway.as_of,'2000-01-03');assert.match(runway.source,/Connector · Mercury/);assert.match(runway.reason,/Stale/);
    f.db.exec("UPDATE mercury_raise_facts SET as_of='2000-01-02'");
    assert.equal((await figure(f.ctx,'runway_months')).value,10000,'Mercury wins a stale-date tie');
    f.db.exec('UPDATE mercury_raise_facts SET burn_cents=0');
    runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,null);assert.equal(runway.state,'not_recorded');assert.match(runway.reason,/positive recorded net burn/);
    f.db.exec('DELETE FROM project_metrics WHERE project_id=1; UPDATE mercury_raise_facts SET burn_cents=100');
    runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,10000);assert.equal(runway.as_of,'2000-01-02');assert.match(runway.reason,/Stale/);
    f.db.prepare('UPDATE mercury_raise_facts SET as_of=?').run(ago(-1));
    runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,null);assert.equal(runway.as_of,ago(-1));assert.match(runway.reason,/Stored Mercury runway fact is outside the current 90-day window/);
    f.db.exec('DELETE FROM mercury_raise_facts');
    runway=await figure(f.ctx,'runway_months');assert.equal(runway.as_of,null);assert.match(runway.reason,/^No metrics snapshot/);
  }finally{f.db.close();}
});


test('runway keeps eight same-source history points even when other sources interleave, including unknown provenance',async()=>{
  const f=fixture();try {
    const insert=f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,cash_balance,net_burn) VALUES(1,?,?,?,1)");
    for(let n=0;n<10;n++){
      insert.run(ago(n*4), 'manual', 10+n);
      insert.run(ago(n*4+1), 'csv', 999);
      insert.run(ago(n*4+2), 'import', 888);
    }
    let runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,10);assert.equal(runway.as_of,ago(0));assert.deepEqual(runway.spark,[17,16,15,14,13,12,11,10]);
    f.db.exec("UPDATE project_metrics SET source=NULL WHERE source='manual'");
    runway=await figure(f.ctx,'runway_months');assert.equal(runway.value,10);assert.match(runway.source,/source not recorded/);assert.deepEqual(runway.spark,[17,16,15,14,13,12,11,10]);
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,cash_balance,net_burn) VALUES(2,?,NULL,777,1)").run(ago(0));
    assert.deepEqual((await figure(f.ctx,'runway_months')).spark,[17,16,15,14,13,12,11,10]);
  }finally{f.db.close();}
});


test('Mercury metric provenance stays Connector independently of recurring-revenue evidence strength',async()=>{
  const f=fixture();try{
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr,paying_accounts) VALUES(1,?,'mercury',700,7)").run(ago(0));
    const result=await proof(f.env);assert.equal(result.evidence,'stated');
    assert.match(result.reads.find(r=>r.a==='MRR · Connector')!.b,/^\$700 · Mercury \(stated\)/);
    assert.match(result.reads.find(r=>r.a==='Paying customers · Connector')!.b,/^7 · Mercury \(stated\)/);
    assert.equal(result.reads.some(r=>r.a==='MRR · Typed'||r.a==='Paying customers · Typed'),false);
  }finally{f.db.close();}
});
