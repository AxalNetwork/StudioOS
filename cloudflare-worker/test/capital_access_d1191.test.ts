/** D1191: real routers and SQLite; all identities and investor records are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import contacts from '../src/routes/contacts.ts';
import records from '../src/routes/cycle_records.ts';
import { capitalCanWork, capitalMemberProjectIds, capitalOwner, capitalPage, capitalRequestPath, capitalStaffRequestAllowed, CAPITAL_SUPPORT_ACTION } from '../src/services/capRelAccess.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const SECRET = 'synthetic-capital-access-d1191-'.repeat(3);
const folder = mkdtempSync(join(tmpdir(),'studioos-capital-access-'));
let fixtureNumber = 0;
let schemaReady = false;
test.after(()=>rmSync(folder,{recursive:true,force:true}));
function fixture() {
  const template = join(folder,'schema.sqlite');
  if (!schemaReady) {
  const schema = new DatabaseSync(template, { enableForeignKeyConstraints: false });
  schema.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  const migrations = readdirSync(new URL('../sql/migrations/', import.meta.url)).filter(name => name.endsWith('.sql') && migrationNumber(name) > BASELINE_CUTOFF).sort(compareMigrations);
  for (const name of migrations) {
    schema.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  schema.close(); schemaReady = true;
  }
  const file = join(folder,`fixture-${fixtureNumber++}.sqlite`); copyFileSync(template,file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`INSERT INTO users (id,name,email,role,founder_id) VALUES
    (1,'Fixture Owner','owner@example.test','founder',11),(2,'Fixture Co-founder','cofounder@example.test','founder',22),
    (3,'Fixture Other','other@example.test','founder',33),(4,'Fixture Advisor','advisor@example.test','advisor',NULL),
    (5,'Fixture Removed','removed@example.test','founder',55),(6,'Fixture Investor','investor@example.test','investor',NULL),
    (7,'Fixture Editor','editor@example.test','founder',77),
    (30,'Fixture Admin','staff@example.test','admin',NULL),(31,'Fixture Super Admin','super@example.test','admin',NULL);
    INSERT INTO projects (id,uid,name,founder_id) VALUES (101,'venture-a','Fixture venture A',11),(202,'venture-b','Fixture venture B',22),(303,'venture-c','Fixture venture C',33);
    INSERT INTO project_members (project_id,user_id,role,status) VALUES (101,2,'cofounder','accepted'),(101,4,'advisor','accepted'),(101,5,'cofounder','removed'),(101,6,'cofounder','accepted'),(101,7,'owner','accepted');
    INSERT INTO super_admins (user_id,granted_by_user_id) VALUES (31,31);
    INSERT INTO raise_prospects (id,uid,project_id,name,email,firm,notes,stage,amount) VALUES
      (1,'investor-a',101,'Fixture Private Investor','private@example.test','Fixture Private Fund','Fixture private notes','meeting',123456),
      (2,'investor-b',202,'Fixture Other Investor','foreign@example.test','Other Fund','Foreign private notes','contacted',987654);
    INSERT INTO raise_rounds (id,uid,project_id,name,target_amount,status) VALUES (1,'round-a',101,'Fixture round',456789,'active'),(2,'round-b',202,'Fixture other round',987654,'active');
    INSERT INTO contacts (id,uid,project_id,name,email,audience,status,promoted_to,promoted_ref_id) VALUES
      (1,'contact-private',101,'Fixture Private Investor','private@example.test','investor','qualified','raise',1),
      (2,'contact-public',101,'Fixture Customer','customer@example.test','customer','new',NULL,NULL),
      (3,'contact-linked',101,'Fixture Linked Investor','linked@example.test','customer','new',NULL,NULL);
    UPDATE raise_prospects SET contact_id=3 WHERE id=1;`);
  const trace: Array<{ sql: string; args: any[] }> = [];
  let poison = ''; let auditFailure = ''; let requireAudit = false; let losePromotion = false; let legacyAuditFailure = 0;
  const privateRead = (sql: string) => /^\s*SELECT\s+\*/i.test(sql) && /FROM raise_(?:prospects|rounds)/i.test(sql);
  function before(sql: string, args: any[]) {
    trace.push({ sql, args });
    if (poison && sql.includes(poison)) throw new Error('Synthetic private detail must not escape');
    if (requireAudit && privateRead(sql)) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_logs WHERE project_id=101 AND user_id=1 AND action=?').get(CAPITAL_SUPPORT_ACTION)?.n, 1, 'persist the founder-visible audit before a private read');
  }
  const DB: any = {
    prepare(sql: string) {
      let args: any[] = [];
      const statement: any = {
        bind(...values: any[]) { args = values.map(value => value ?? null); return statement; },
        async first() { before(sql,args); return db.prepare(sql).get(...args) || null; },
        async all() { before(sql,args); return { success: true, results: db.prepare(sql).all(...args) }; },
        async run() {
          before(sql,args);
          if (legacyAuditFailure > 0 && sql.includes("'prospect_created'") && sql.includes('INSERT INTO activity_logs') && --legacyAuditFailure === 0) throw new Error('Synthetic private legacy audit error');
          if (losePromotion && sql.includes("UPDATE contacts SET promoted_to='raise'") && args[4]===4) {
            losePromotion=false;
            db.prepare("INSERT INTO raise_prospects (id,uid,project_id,contact_id,name,stage) VALUES (1001,'fixture-winner',101,4,'Fixture winner','to_contact')").run();
            db.prepare("UPDATE contacts SET promoted_to='raise',promoted_ref_id=1001 WHERE id=4").run();
            // Run the actual CAS below against the concurrent winner.
          }
          if (auditFailure && sql.includes('INSERT INTO activity_logs') && args.includes(CAPITAL_SUPPORT_ACTION)) {
            if (auditFailure === 'throw') throw new Error('Synthetic private audit error');
            return { success: auditFailure !== 'unsuccessful', meta: { changes: auditFailure === 'no_change' ? 0 : 1, last_row_id: 0 } };
          }
          const result = db.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      }; return statement;
    },
    async exec(sql: string) { db.exec(sql); return { success: true }; },
    async batch(statements: any[]) { db.exec('BEGIN'); try { const rows=[]; for (const statement of statements) rows.push(await statement.run()); db.exec('COMMIT'); return rows; } catch(error) { db.exec('ROLLBACK'); throw error; } },
  };
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://axal.vc' };
  const app = new Hono<any>().route('/api/cycles/raise',cycleRaise).route('/api/contacts',contacts).route('/api/cycles',records);
  app.onError((error,c) => c.json({ detail: error.message === 'Unauthorized' ? 'Unauthorized' : 'Request unavailable' },error.message === 'Unauthorized' ? 401 : 503));
  async function request(path: string, actor: number | null = 1, method = 'GET', body?: unknown, impersonator?: number, company?: number) {
    const headers: Record<string,string> = { 'content-type': 'application/json' };
    if(company!=null)headers['X-Company-Id']=String(company);
    if (actor != null) {
      const token = await new SignJWT({ user_id: actor, ...(impersonator ? { impersonated_by: impersonator } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
      headers.Cookie = `${env.BRANCH_CODE ? 'studioos_auth_' + env.BRANCH_CODE : 'studioos_auth'}=${token}`;
    }
    const response = await app.request('https://axal.vc'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},env,{waitUntil(){},passThroughOnException(){}} as any);
    const text = await response.text(); let data: any; try { data=JSON.parse(text); } catch { data={ detail:text }; } return { status: response.status, data };
  }
  return { db,env,request,trace,privateReads:()=>trace.filter(row=>privateRead(row.sql)),reset(){trace.length=0;},poison(value:string){poison=value;},auditFailure(value:string){auditFailure=value;},requireAudit(){requireAudit=true;},losePromotion(){losePromotion=true;},failLegacyAuditAt(value:number){legacyAuditFailure=value;},close(){db.close();} };
}

const originalFetch = globalThis.fetch;
test.beforeEach(()=>{globalThis.fetch=async()=>{throw new Error('Unexpected external provider call');};});
test.afterEach(()=>{globalThis.fetch=originalFetch;});

test('D1191: owner and accepted co-founder work the pipeline through both APIs and record sections',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO users (id,name,email,role,founder_id,spinout_lab_active) VALUES (8,'Fixture Lab owner','lab@example.test','exploring',11,1)");
    for(const actor of [1,2,7,8]) {
      for(const path of ['/api/cycles/raise/modules/capital-relationships?project=101','/api/contacts/raise-prospects?project_id=101','/api/contacts/raise-prospects/1','/api/cycles/raise/modules/capital-relationships/records/1?project=101']) {
        const result=await f.request(path,actor);assert.equal(result.status,200,JSON.stringify({path,...result}));assert.match(JSON.stringify(result.data),/Fixture Private Investor/);
      }
      const edited=await f.request('/api/cycles/raise/prospects/1?project=101',actor,'PATCH',{next_step:'Fixture follow-up'});assert.equal(edited.status,200);
      assert.equal((await f.request('/api/contacts/raise-prospects/1',actor,'PUT',{firm:'Fixture updated firm'})).status,200);
    }
    const record=await f.request('/api/cycles/raise/modules/capital-relationships/records/1?project=101',2);
    assert.ok(record.data.main.some((section:any)=>section.key==='timeline'));
    assert.ok(record.data.actions.some((action:any)=>action.key==='edit'));
    const log=await f.request('/api/cycles/raise/modules/capital-relationships/records/1/actions/log?project=101',2,'POST',{kind:'call',note:'Fixture contact'});
    assert.equal(log.status,200,JSON.stringify(log));
    f.db.exec('UPDATE users SET spinout_lab_active=0 WHERE id=8');
    assert.equal((await f.request('/api/cycles/raise/modules/capital-relationships?project=101',8)).status,403);
  }finally{f.close();}
});

test('D1191: outsiders, advisors, removed members and investors cannot read or work another venture',async()=>{
  const f=fixture();try {
    for(const actor of [3,4,5,6]) {
      for(const path of ['/api/cycles/raise/modules/capital-relationships?project=101','/api/contacts/raise-prospects/1','/api/cycles/raise/modules/capital-relationships/records/1?project=101']) {
        const result=await f.request(path,actor);assert.equal(result.status,403,JSON.stringify({path,...result}));assert.doesNotMatch(JSON.stringify(result.data),/private@example|Fixture Private Investor|123456/);
      }
      assert.equal((await f.request('/api/cycles/raise/prospects/1?project=101',actor,'PATCH',{notes:'Forbidden'})).status,403);
      assert.equal((await f.request('/api/contacts/raise-prospects/1',actor,'PUT',{notes:'Forbidden'})).status,403);
      assert.equal((await f.request('/api/contacts/raise-prospects',actor,'POST',{project_id:101,name:'Forbidden'})).status,403);
      assert.equal((await f.request('/api/contacts/raise-prospects/import',actor,'POST',{project_id:101,rows:[{name:'Forbidden'}]})).status,403);
    }
    assert.equal(f.db.prepare('SELECT notes FROM raise_prospects WHERE id=1').get()?.notes,'Fixture private notes');
    assert.equal(await capitalCanWork(f.env,{id:101,founder_id:11},{id:2,role:'founder',founder_id:22} as any),true);
    assert.equal(capitalOwner({id:101,founder_id:11},{id:2,role:'founder',founder_id:22} as any),false);
    assert.equal(capitalOwner({id:101,founder_id:11},{id:30,role:'admin',founder_id:11,spinout_lab_active:1} as any),false);
    assert.equal(capitalOwner({id:101,founder_id:11},{id:6,role:'investor',founder_id:11,spinout_lab_active:1} as any),false);
    assert.equal((await f.request('/api/contacts/raise-round',2,'PUT',{project_id:101,target_amount:1})).status,403);
    assert.notEqual((await f.request('/api/contacts/raise-prospects/1',2,'DELETE')).status,200);
    assert.equal(f.db.prepare('SELECT target_amount FROM raise_rounds WHERE id=1').get()?.target_amount,456789);
    assert.equal((await f.request('/api/contacts/raise-round',1,'PUT',{project_id:101,target_amount:500000})).status,200);
  }finally{f.close();}
});

test('D1191: Admin and Super Admin receive local summaries with no investor details or private reads',async()=>{
  const f=fixture();try {
    f.db.exec('UPDATE users SET founder_id=11,spinout_lab_active=1 WHERE id=30');
    let remote=0;f.env.BRANCH_FR={fetch(){remote++;throw new Error('Remote studio must not be read');}};
    for(const actor of [30,31]) {
      for(const path of ['/api/cycles/raise/overview?project=101','/api/cycles/raise/modules/capital-relationships?project=101','/api/cycles/raise/capital-relationships/summary?project=101','/api/contacts/raise-prospects?project_id=101']) {
        f.reset();const result=await f.request(path,actor);assert.equal(result.status,200,JSON.stringify({path,...result}));assert.equal(result.data.mode,'summary');
        assert.doesNotMatch(JSON.stringify(result.data),/Fixture Private Investor|private@example|Fixture private notes|123456|456789/);assert.equal(f.privateReads().length,0);
        if(result.data.ventures){assert.equal(result.data.ventures[0].project.id,101);assert.equal(result.data.ventures[0].total,1);assert.equal(result.data.ventures[0].stages.find((row:any)=>row.stage==='meeting').count,1);}
        if(result.data.cards){assert.equal(result.data.cards.length,7);assert.deepEqual(result.data.figures.map((figure:any)=>figure.key),['readiness_score','runway_months']);}
        if(result.data.records){assert.equal(result.data.module.records_title,'Pipeline counts');assert.equal(result.data.records.state,'ok');assert.equal(result.data.records.linkable,false);assert.equal(result.data.records.rows.length,7);assert.equal(result.data.records.rows.find((row:any)=>row.id==='summary-meeting').cells.count,1);}
      }
      for(const path of ['/api/contacts/raise-prospects/1','/api/contacts/raise-round?project_id=101','/api/contacts/raise-closes?project_id=101','/api/contacts/raise-pro-rata?project_id=101','/api/cycles/raise/modules/capital-relationships/records/1?project=101','/api/cycles/raise/capital-relationships/commitments?project=101','/api/cycles/raise/capital-relationships/match?project=101']) {
        f.reset();assert.equal((await f.request(path,actor)).status,403,path);assert.equal(f.privateReads().length,0,path);
      }
    }
    assert.equal(remote,0);
    assert.equal((await f.request('/api/cycles/raise/capital-relationships/summary?project=999',30)).status,404);
    assert.equal((await f.request('/api/cycles/raise/capital-relationships/summary',99)).status,401);
    assert.equal((await f.request('/api/cycles/raise/capital-relationships/summary',null)).status,401);
  }finally{f.close();}
});

test('D1191 owner decision: co-founders record investor commitments but cannot change round or tranche settings',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO raise_closes (id,uid,project_id,round_id,name) VALUES (7,'fixture-close',101,1,'Fixture first close')");
    const edited=await f.request('/api/contacts/raise-prospects/1',2,'PUT',{stage:'committed',amount:350,commit_status:'signed',instrument:'safe',close_id:7});
    assert.equal(edited.status,200);assert.equal(edited.data.amount,350);assert.equal(edited.data.commit_status,'signed');assert.equal(edited.data.instrument,'safe');assert.equal(edited.data.close_id,7);
    assert.equal((await f.request('/api/contacts/raise-round',2,'PUT',{project_id:101,target_amount:1})).status,403);
    assert.equal((await f.request('/api/contacts/raise-closes/7',2,'PUT',{name:'Forbidden',state:'closed'})).status,403);
    assert.equal(f.db.prepare('SELECT target_amount FROM raise_rounds WHERE id=1').get()?.target_amount,456789);
    assert.equal(f.db.prepare('SELECT name FROM raise_closes WHERE id=7').get()?.name,'Fixture first close');
  }finally{f.close();}
});

test('D1191: staff cannot bypass investor privacy through Contacts hub reads or mutations',async()=>{
  const f=fixture();try {
    const hub=await f.request('/api/contacts',30);assert.equal(hub.status,200);assert.deepEqual(hub.data.items.map((item:any)=>item.uid),['contact-public']);
    for(const actor of [30,31]) {
      for(const uid of ['contact-private','contact-linked']) for(const method of ['GET','PUT']) assert.equal((await f.request('/api/contacts/'+uid,actor,method,method==='PUT'?{name:'Forbidden'}:undefined)).status,403);
      for(const [path,method,data] of [
        ['/api/contacts/raise-prospects','POST',{project_id:101,name:'Forbidden'}],['/api/contacts/raise-prospects/1','PUT',{notes:'Forbidden'}],
        ['/api/contacts/raise-prospects/import','POST',{project_id:101,rows:[{name:'Forbidden'}]}],['/api/contacts/raise-round','PUT',{project_id:101,target_amount:1}],
        ['/api/contacts','POST',{project_id:101,email:'new@example.test',audience:'investor'}],['/api/contacts/invite','POST',{project_id:101,email:'new@example.test',audience:'investor'}],
        ['/api/contacts/contact-public','PUT',{audience:'investor'}],['/api/contacts/contact-private/promote','POST',{}],
        ['/api/cycles/raise/prospects','POST',{name:'Forbidden'}],['/api/cycles/raise/prospects/1','PATCH',{notes:'Forbidden'}],
      ] as const) assert.equal((await f.request(path+(path.startsWith('/api/cycles/raise')?'?project=101':''),actor,method,data)).status,403,path);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM raise_prospects').get()?.n,2);
  }finally{f.close();}
});

test('D1191: each private support read persists its founder-visible reason first and gives no write or later GET grant',async()=>{
  const f=fixture();try {
    for(const actor of [30,31]) {
      if(actor===31)f.db.exec("UPDATE users SET role='exploring',spinout_lab_active=1 WHERE id=1");
      f.db.exec('DELETE FROM activity_logs');f.requireAudit();f.reset();
      const result=await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',actor,'POST',{reason:'Fixture support reason'});
      assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.read_only,true);assert.equal(result.data.mode,'support');assert.deepEqual(result.data.actions,[]);
      assert.equal(result.data.items.length,1);assert.equal(result.data.items[0].name,'Fixture Private Investor');assert.equal(result.data.round.target_amount,456789);
      const audit=f.db.prepare('SELECT user_id,actor,details FROM activity_logs WHERE id=?').get(result.data.audit_id) as any;
      assert.equal(audit.user_id,1);assert.equal(audit.actor,`user:${actor}`);assert.deepEqual(JSON.parse(audit.details),{admin_user_id:actor,reason:'Fixture support reason',read_only:true,page:1,prospect_id:null});
      const staffAudit=f.db.prepare('SELECT viewed_user_id,filters_json FROM admin_audit_log WHERE admin_user_id=? AND action=? ORDER BY id DESC LIMIT 1').get(actor,CAPITAL_SUPPORT_ACTION) as any;
      assert.ok(staffAudit);assert.equal(staffAudit.viewed_user_id,1);assert.deepEqual(JSON.parse(staffAudit.filters_json),{project_id:101,reason:'Fixture support reason',read_only:true,page:1,prospect_id:null});
      const history=await f.request('/api/cycles/raise/capital-relationships/support-reads?project=101',1);assert.equal(history.status,200);assert.equal(history.data.reads.length,1);assert.equal(history.data.reads[0].reason,'Fixture support reason');assert.match(history.data.reads[0].reader.name,/Fixture/);assert.doesNotMatch(JSON.stringify(history.data),/@example/);
      assert.equal((await f.request('/api/cycles/raise/capital-relationships/support-reads?project=101',2)).status,200);
      assert.deepEqual((await f.request('/api/cycles/raise/capital-relationships/support-reads?project=202',2)).data.reads,[]);
      assert.equal((await f.request('/api/cycles/raise/capital-relationships/support-reads?project=101',3)).status,403);
      assert.equal((await f.request('/api/contacts/raise-prospects/1',actor)).status,403);
      assert.equal((await f.request('/api/contacts/raise-prospects/1',actor,'PUT',{reason:'Fixture support reason',notes:'Forbidden'})).status,403);
    }
  }finally{f.close();}
});

test('D1191: failed, ineffective or unresolvable support audits refuse before any private read',async()=>{
  const f=fixture();try {
    for(const mode of ['throw','no_change','unsuccessful']) {
      f.auditFailure(mode);f.reset();const result=await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason:'Fixture reason'});
      assert.equal(result.status,503,JSON.stringify(result));assert.equal(f.privateReads().length,0);assert.doesNotMatch(JSON.stringify(result.data),/Synthetic private|Fixture Private Investor/);
    }
    f.auditFailure('');f.db.exec("INSERT INTO users (id,name,email,role,founder_id,is_active) VALUES (88,'Fixture ambiguous owner','ambiguous@example.test','founder',11,1)");f.reset();
    assert.equal((await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason:'Fixture reason'})).status,409);assert.equal(f.privateReads().length,0);
    f.db.exec("DELETE FROM users WHERE id=88; UPDATE users SET role='exploring',spinout_lab_active=0 WHERE id=1; UPDATE users SET founder_id=11,spinout_lab_active=1 WHERE id=30");f.reset();
    assert.equal((await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason:'Fixture reason'})).status,409);assert.equal(f.privateReads().length,0);
  }finally{f.close();}
});

test('D1191: invalid reasons and impersonation cannot open a private pipeline',async()=>{
  const f=fixture();try {
    for(const reason of ['', ' ', 'x'.repeat(501),123,{}]) {f.reset();assert.equal((await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason})).status,400);assert.equal(f.privateReads().length,0);}
    for(const path of ['/api/cycles/raise/modules/capital-relationships?project=101','/api/cycles/raise/modules/%63apital-relationships?project=101','/api/cycles/raise/overview?project=101','/api/contacts/raise-prospects?project_id=101','/api/cycles/raise/modules/capital-relationships/records/1?project=101']) assert.equal((await f.request(path,1,'GET',undefined,30)).status,403,path);
    assert.equal((await f.request('/api/contacts/contact-private',1,'GET',undefined,30)).status,403);
    const hub=await f.request('/api/contacts',1,'GET',undefined,30);assert.equal(hub.status,200);assert.deepEqual(hub.data.items.map((item:any)=>item.uid),['contact-public']);
    assert.equal((await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',1,'POST',{reason:'Fixture reason'})).status,403);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs WHERE action=?').get(CAPITAL_SUPPORT_ACTION)?.n,0);
  }finally{f.close();}
});

test('D1191: missing summary data is unreadable, summaries and support reads are paged',async()=>{
  const f=fixture();try {
    f.poison('GROUP BY stage');const missing=await f.request('/api/cycles/raise/capital-relationships/summary?project=101',30);assert.equal(missing.status,200);assert.equal(missing.data.ventures[0].state,'unreadable');assert.equal(missing.data.ventures[0].total,null);assert.doesNotMatch(JSON.stringify(missing.data),/Synthetic private/);
    f.poison('');for(let id=400;id<430;id++)f.db.prepare('INSERT INTO projects (id,uid,name,founder_id) VALUES (?,?,?,?)').run(id,`paged-${id}`,'Fixture paged venture',11);
    f.db.exec("UPDATE raise_prospects SET stage='Fixture private stage' WHERE id=1");
    const odd=await f.request('/api/cycles/raise/capital-relationships/summary?project=101',30);assert.equal(odd.data.ventures[0].status_not_recorded,1);assert.doesNotMatch(JSON.stringify(odd.data),/Fixture private stage/);
    const first=await f.request('/api/cycles/raise/capital-relationships/summary',30);const next=await f.request('/api/cycles/raise/capital-relationships/summary?page=2',30);
    assert.equal(first.data.ventures.length,25);assert.equal(first.data.has_more,true);assert.equal(next.data.ventures.length,8);assert.equal(next.data.has_more,false);
    for(let id=10;id<40;id++)f.db.prepare('INSERT INTO raise_prospects (id,uid,project_id,name) VALUES (?,?,?,?)').run(id,`paged-investor-${id}`,101,'Fixture paged investor');
    const read=await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason:'Fixture paged reason'});assert.equal(read.status,200);assert.equal(read.data.items.length,25);assert.equal(read.data.has_more,true);
    const beforeInvalid=f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs WHERE action=?').get(CAPITAL_SUPPORT_ACTION)?.n;
    for(const prospectId of [2,9999]) {
      f.reset();assert.equal((await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason:'Fixture detail reason',prospect_id:prospectId})).status,404);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs WHERE action=?').get(CAPITAL_SUPPORT_ACTION)?.n,beforeInvalid);assert.equal(f.privateReads().length,0);
    }
    const own=await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason:'Fixture detail reason',prospect_id:1,page:2});assert.equal(own.status,200);assert.equal(own.data.items.length,1);assert.equal(own.data.items[0].id,1);
    const detail=f.db.prepare('SELECT details FROM activity_logs WHERE id=?').get(own.data.audit_id) as any;assert.deepEqual(JSON.parse(detail.details),{admin_user_id:30,reason:'Fixture detail reason',read_only:true,page:2,prospect_id:1});
    const history=await f.request('/api/cycles/raise/capital-relationships/support-reads?project=101',1);assert.equal(history.data.reads[0].page,2);assert.equal(history.data.reads[0].prospect_id,1);
  }finally{f.close();}
});

test('D1191: a legacy create audit failure rolls back its prospect and import reports prior rows accurately',async()=>{
  const f=fixture();try {
    f.failLegacyAuditAt(1);
    const create=await f.request('/api/contacts/raise-prospects',2,'POST',{project_id:101,name:'Fixture failed creation'});
    assert.equal(create.status,503);assert.match(create.data.detail,/could not be saved/);assert.doesNotMatch(JSON.stringify(create.data),/Synthetic private/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM raise_prospects').get()?.n,2);
    f.failLegacyAuditAt(2);
    const imported=await f.request('/api/contacts/raise-prospects/import',2,'POST',{project_id:101,rows:[{name:'Fixture first saved'},{name:'Fixture failed second'},{name:'Fixture unprocessed third'}]});
    assert.equal(imported.status,200);assert.equal(imported.data.created,1);assert.deepEqual(imported.data.skipped.map((row:any)=>row.row),[2,3]);assert.doesNotMatch(JSON.stringify(imported.data),/Synthetic private/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM raise_prospects').get()?.n,3);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE user_id=2 AND action='prospect_created'").get()?.n,1);
  }finally{f.close();}
});

test('D1191: co-founder creates/imports/edits are scoped and actor-audited through the canonical prospect writers',async()=>{
  const f=fixture();try {
    const made=await f.request('/api/contacts/raise-prospects',2,'POST',{project_id:101,name:'Fixture New Investor',email:'new@example.test',amount:250,stage:'committed',commit_status:'signed'});
    assert.equal(made.status,201,JSON.stringify(made));assert.equal(made.data.amount,250);assert.equal(made.data.commit_status,'signed');
    const imported=await f.request('/api/contacts/raise-prospects/import',2,'POST',{project_id:101,rows:[{name:'Fixture Imported',email:'imported@example.test'},{name:'Duplicate',email:'new@example.test'},{}]});
    assert.equal(imported.status,200);assert.equal(imported.data.created,1);assert.equal(imported.data.skipped.length,2);
    const edited=await f.request('/api/contacts/raise-prospects/'+made.data.id,2,'PUT',{stage:'meeting',notes:'Fixture new note'});assert.equal(edited.status,200);assert.equal(edited.data.commit_status,null);
    const audit=f.db.prepare("SELECT user_id,entity_id,action FROM activity_logs WHERE project_id=101 AND entity_type='raise.capital-relationships' ORDER BY id").all() as any[];
    assert.deepEqual(audit.map(row=>row.user_id),[2,2,2]);assert.deepEqual(audit.map(row=>row.action),['prospect_created','prospect_created','prospect_updated']);
    assert.equal((await f.request('/api/cycles/raise/prospects/2?project=101',2,'PATCH',{notes:'Foreign edit'})).status,404);
    assert.equal(f.db.prepare('SELECT notes FROM raise_prospects WHERE id=2').get()?.notes,'Foreign private notes');
    f.db.exec("INSERT INTO contacts (id,uid,project_id,name,email,audience,status) VALUES (40,'unpromoted',101,'Fixture Promotion','promotion@example.test','investor','new')");
    const promoted=await f.request('/api/contacts/unpromoted/promote',1,'POST',{});assert.equal(promoted.status,200);assert.ok(promoted.data.record.id);
    const repeated=await f.request('/api/contacts/unpromoted/promote',1,'POST',{});assert.equal(repeated.data.record.id,promoted.data.record.id);assert.equal(repeated.data.already_promoted,true);
    const promotionHistory=f.db.prepare("SELECT details FROM activity_logs WHERE action='contact_promoted' AND project_id=101 AND user_id=1").all() as any[];
    assert.equal(promotionHistory.length,1);assert.match(promotionHistory[0].details,/promoted an investor/);assert.doesNotMatch(promotionHistory[0].details,/promotion@example|Fixture Promotion/);
    const last=f.db.prepare("SELECT user_id,action FROM activity_logs WHERE entity_type='raise.capital-relationships' ORDER BY id DESC LIMIT 1").get() as any;assert.equal(last.user_id,1);assert.equal(last.action,'prospect_created');
  }finally{f.close();}
});

test('D1191: explicit memberships do not inherit company/role/owner privileges and deleted ventures stay closed',async()=>{
  const f=fixture();try {
    f.db.exec("UPDATE projects SET company_id=10 WHERE id=101; UPDATE projects SET company_id=20 WHERE id=202; INSERT INTO user_company_links (uid,user_id,company_id) VALUES ('owner-link',1,10),('member-link',2,20)");
    assert.equal((await f.request('/api/contacts/raise-prospects?project_id=101',2,'GET',undefined,undefined,20)).status,200);
    for(const [id,role,expected] of [[2,'founder',[101]],[4,'advisor',[]],[5,'founder',[]],[6,'investor',[]],[30,'admin',[]]] as const) {
      assert.deepEqual(await capitalMemberProjectIds(f.env,{id,role} as any),expected);
    }
    assert.deepEqual(await capitalMemberProjectIds(f.env,{id:2,role:'Admin'} as any),[]);
    assert.deepEqual(await capitalMemberProjectIds(f.env,{id:6,role:'Investor'} as any),[]);
    assert.equal(await capitalCanWork(f.env,{id:101,founder_id:33},{id:3,role:'founder',founder_id:33} as any),false);
    assert.equal(await capitalCanWork(f.env,{id:999,founder_id:11},{id:1,role:'founder',founder_id:11} as any),false);
    f.db.exec("UPDATE projects SET founder_id=11,company_id=30 WHERE id=303; INSERT INTO raise_prospects (id,uid,project_id,name) VALUES (3,'other-company',303,'Fixture Other Company Investor')");
    assert.equal((await f.request('/api/contacts/raise-prospects/3',1,'GET',undefined,undefined,10)).status,403);
    f.db.exec("UPDATE projects SET deleted_at=datetime('now') WHERE id=101");
    assert.equal((await f.request('/api/cycles/raise/modules/capital-relationships?project=101',2)).status,404);
    assert.equal((await f.request('/api/cycles/raise/modules/capital-relationships?project=101',30)).status,404);
    assert.equal((await f.request('/api/cycles/raise/modules/capital-relationships/records/1?project=101',2)).status,403);
    assert.equal((await f.request('/api/contacts/raise-prospects/1',2)).status,403);
    assert.deepEqual(await capitalMemberProjectIds(f.env,{id:2,role:'founder'} as any),[]);
    const summary=await f.request('/api/cycles/raise/capital-relationships/summary',30);assert.ok(summary.data.ventures.every((venture:any)=>venture.project.id!==101));
    assert.equal((await f.request('/api/cycles/raise/capital-relationships/summary?project=101',30)).status,404);
  }finally{f.close();}
});

test('D1191: canonical Contacts promotion preserves the concurrent winner and removes its losing prospect',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO contacts (id,uid,project_id,name,email,audience,status) VALUES (4,'race-contact',101,'Fixture race contact','race@example.test','investor','new')");f.losePromotion();
    const result=await f.request('/api/contacts/race-contact/promote',1,'POST',{});assert.equal(result.status,200);assert.equal(result.data.already_promoted,true);assert.equal(result.data.record.id,1001);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM raise_prospects WHERE contact_id=4').get()?.n,1);
    assert.equal(f.db.prepare('SELECT promoted_ref_id FROM contacts WHERE id=4').get()?.promoted_ref_id,1001);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='contact_promoted'").get()?.n,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='prospect_created'").get()?.n,0);
  }finally{f.close();}
});

test('D1191: unreadable membership and support history fail closed with fixed words',async()=>{
  const f=fixture();try {
    f.poison('SELECT role FROM project_members');const access=await f.request('/api/cycles/raise/modules/capital-relationships?project=101',2);assert.equal(access.status,503);assert.doesNotMatch(JSON.stringify(access.data),/Synthetic private/);
    f.poison('JOIN project_members');const legacy=await f.request('/api/contacts/raise-prospects/1',2);assert.equal(legacy.status,503);assert.doesNotMatch(JSON.stringify(legacy.data),/Synthetic private/);
    f.poison('SELECT id, company_id FROM projects');const own=await f.request('/api/contacts/raise-prospects/1',1);assert.equal(own.status,503);assert.doesNotMatch(JSON.stringify(own.data),/Synthetic private/);
    f.poison('FROM activity_logs a');const history=await f.request('/api/cycles/raise/capital-relationships/support-reads?project=101',1);assert.equal(history.status,503);assert.doesNotMatch(JSON.stringify(history.data),/Synthetic private/);
  }finally{f.close();}
});

test('D1191: encoded access paths and page bounds are normalized before classification',()=>{
  assert.equal(capitalRequestPath('/api/contacts/%72aise-prospects'),'/api/contacts/raise-prospects');
  assert.equal(capitalRequestPath('/api/cycles/raise/modules/%63apital-relationships'),'/api/cycles/raise/modules/capital-relationships');
  assert.throws(()=>capitalRequestPath('/api/contacts/%broken'),/Invalid request path/);
  for(const raw of [null,undefined,'',0,-1,1.2,100001,'invalid'])assert.equal(capitalPage(raw),1);
  for(const raw of [2,'3',100000])assert.equal(capitalPage(raw),Number(raw));
  const base='/api/cycles/raise';
  assert.equal(capitalStaffRequestAllowed('GET',base+'/modules/capital-relationships'),true);
  assert.equal(capitalStaffRequestAllowed('POST',base+'/capital-relationships/support-read'),true);
  for(const [method,path] of [['GET','/capital-relationships/commitments'],['GET','/capital-relationships/match'],['GET','/capital-relationships/future-private-read'],['GET','/prospects/future-private-read'],['POST','/prospects/other/support-read'],['PUT','/modules/capital-relationships'],['GET','/capital-relationships/support-read']])assert.equal(capitalStaffRequestAllowed(method,base+path),false);
});

test('D1191: malformed paths fail closed before private queries for members, staff and impersonation',async()=>{
  const f=fixture();try {
    for(const [actor,impersonator] of [[1,undefined],[30,undefined],[1,30]]) {
      for(const [path,method] of [['/api/contacts/raise-prospects/%broken','GET'],['/api/cycles/raise/prospects/%broken?project=101','PATCH']]) {
        f.reset();const response=await f.request(path,actor,method,method==='GET'?undefined:{notes:'Forbidden'},impersonator);
        assert.equal(response.status,400);assert.equal(f.privateReads().length,0);assert.doesNotMatch(JSON.stringify(response.data),/%broken|Forbidden/);
      }
    }
  }finally{f.close();}
});

test('D1191: promotion and its actor audit roll back together, and a retry records both histories once',async()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO contacts (id,uid,project_id,name,email,audience,status) VALUES (40,'audit-promotion',101,'Fixture promotion','audit-promotion@example.test','investor','new')");
    f.failLegacyAuditAt(1);
    const failed=await f.request('/api/contacts/audit-promotion/promote',1,'POST',{});assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.data),/Synthetic private/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM raise_prospects').get()?.n,2);
    assert.equal(f.db.prepare('SELECT promoted_ref_id FROM contacts WHERE id=40').get()?.promoted_ref_id,null);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('prospect_created','contact_promoted')").get()?.n,0);
    const retried=await f.request('/api/contacts/audit-promotion/promote',1,'POST',{});assert.equal(retried.status,200);
    const again=await f.request('/api/contacts/audit-promotion/promote',1,'POST',{});assert.equal(again.data.already_promoted,true);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM raise_prospects').get()?.n,3);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='prospect_created'").get()?.n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='contact_promoted'").get()?.n,1);
  }finally{f.close();}
});

test('D1191: a failed secondary staff audit preserves the mandatory founder audit without logging private errors',async()=>{
  const f=fixture();const originalWarn=console.warn;const originalError=console.error;const logs:unknown[][]=[];
  console.warn=(...args)=>logs.push(args);console.error=(...args)=>logs.push(args);
  try {
    f.poison('INSERT INTO admin_audit_log');f.requireAudit();
    const result=await f.request('/api/cycles/raise/capital-relationships/support-read?project=101',30,'POST',{reason:'Fixture secondary audit reason'});
    assert.equal(result.status,200);assert.equal(result.data.items.length,1);assert.ok(f.privateReads().length>0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs WHERE user_id=1 AND action=?').get(CAPITAL_SUPPORT_ACTION)?.n,1);
    assert.deepEqual(logs,[]);assert.doesNotMatch(JSON.stringify(result.data),/Synthetic private/);
  }finally{console.warn=originalWarn;console.error=originalError;f.close();}
});
