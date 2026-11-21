/** D7672 (#7672): source-only directory plans over migrated SQLite; synthetic records only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildDirectoryPlan, professionalUrl, WRITE_TABLES } from '../../scripts/lib/networkDirectoryPlan.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const migration = readFileSync(new URL('../sql/migrations/202611191414_7672_network_directory.sql',import.meta.url),'utf8');
const observed_at='2026-11-19T12:00:00.000Z';
const air=(id,name,fields={})=>({source:'airtable_angels',source_record_id:id,observed_at,raw_fields:{Name:name,Type:'Angel',...fields}});
const folk=(id,name,companies=['Example Ventures'],fields={})=>({source:'folk_french_vcs',source_record_id:id,observed_at,raw_fields:{Person:name,Companies:companies,'Job title':'Partner',...fields}});
const accept=(r,kind='person',extra={})=>({source:r.source,source_record_id:r.source_record_id,entity_kind:kind,disposition:'accept',reasons:[],...extra});
const manifest=(rows,organizations=[])=>({version:1,rows,organizations});
const org=(name='Example Ventures',extra={})=>({source:'folk_french_vcs',source_organization_key:name,name,disposition:'accept',reasons:[],website:'https://example.com',...extra});
function db() {
  const d=new DatabaseSync(':memory:');
  d.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);');
  d.exec(migration); return d;
}
function batch(d,b) {
  d.exec('BEGIN');
  try { for(const s of b.statements)d.prepare(s.sql).run(...s.params);d.exec('COMMIT'); }
  catch(e) {d.exec('ROLLBACK');throw e;}
}
function execute(d,p){for(const b of p.batches)batch(d,b);}
const count=(d,table)=>d.prepare(`SELECT count(*) n FROM ${table}`).get().n;
const fixture=()=>{
  const a=air('rec-alpha','Example Person',{'LinkedIn':'https://www.linkedin.com/in/example-person/?trk=x',Email:'private@example.com','Currently investing?':'No','Previous Investments':'Example Widgets'});
  const b=folk('shared-beta','Second Person',['Example Ventures'],{Urls:'https://linkedin.com/in/second-example',Industry:['Software'],'Investment Stage':['Seed']});
  return {records:[a,b],manifest:manifest([accept(a),accept(b,'person',{affiliation_disposition:'accept_source_claim'})],[org()])};
};

test('fresh repository schema contains typed directory constraints and replayable additive migration',()=>{
  const d=new DatabaseSync(':memory:',SCHEMA_OPTIONS);loadSchema(d);
  assert.ok(d.prepare("SELECT name FROM sqlite_master WHERE name='network_directory_entries'").get());
  assert.equal(d.prepare("SELECT dflt_value FROM pragma_table_info('network_directory_private_sources') WHERE name='access_scope'").get().dflt_value,"'operator_only'");
  d.exec(migration);
  assert.ok(d.prepare("SELECT name FROM sqlite_master WHERE name='idx_network_directory_affiliation_org'").get());d.close();
});

test('canonical people, source organizations and associations replay without account, book or membership writes',()=>{
  const d=db(),p=buildDirectoryPlan(fixture());execute(d,p);execute(d,p);
  assert.equal(count(d,'network_directory_entries'),3);assert.equal(count(d,'network_directory_affiliations'),1);
  assert.equal(count(d,'network_directory_source_records'),3);assert.equal(count(d,'network_directory_import_runs'),1);
  assert.equal(count(d,'network_directory_book_links'),0);assert.equal(count(d,'users'),0);assert.equal(count(d,'company_profiles'),0);
  assert.equal(count(d,'network_directory_research_links'),0);
  assert.equal(d.prepare('SELECT status FROM network_directory_import_runs').get().status,'complete');
  assert.deepEqual(d.prepare('SELECT is_current,start_date,end_date,relation_kind,verification_status FROM network_directory_affiliations').get(),
    Object.assign(Object.create(null),{is_current:null,start_date:null,end_date:null,relation_kind:'source_association',verification_status:'unverified_source_claim'}));
  const targets=p.batches.flatMap(b=>b.statements).map(s=>s.sql.match(/(?:INSERT INTO|UPDATE) (\w+)/)[1]);
  assert.ok(targets.every(t=>WRITE_TABLES.includes(t)));
  assert.ok(!targets.some(t=>['user_company_links','company_people','network_connections','partner_relationships','contacts'].includes(t)));
  d.close();
});

test('email cells remain only in operator raw storage and public claims retain tri-state and source fields',()=>{
  const d=db(),p=buildDirectoryPlan(fixture());execute(d,p);
  assert.ok(d.prepare('SELECT raw_json FROM network_directory_private_sources').all().some(r=>r.raw_json.includes('private@example.com')));
  assert.ok(d.prepare('SELECT claims_json FROM network_directory_source_records').all().every(r=>!r.claims_json.includes('private@example.com')));
  const a=d.prepare("SELECT * FROM network_directory_entries WHERE display_name='Example Person'").get();
  assert.equal(a.currently_investing,0);assert.equal(a.previous_investments_raw,'Example Widgets');assert.equal(a.linked_user_id,null);assert.equal(a.linked_company_id,null);
  assert.equal(a.publication_status,'staged');assert.equal(a.roles_json,'[]');assert.equal(a.source_categories_json,'["Angel"]');
  assert.equal(d.prepare("SELECT currently_investing FROM network_directory_entries WHERE display_name='Second Person'").get().currently_investing,null);
  assert.throws(()=>d.prepare("UPDATE network_directory_private_sources SET access_scope='members'").run(),/CHECK/);d.close();
});

test('same names remain distinct; exact personal profile collisions are quarantined, never merged',()=>{
  const a=air('rec-a','Same Name'),b=air('rec-b','Same Name');
  const p=buildDirectoryPlan({records:[a,b],manifest:manifest([accept(a),accept(b)])});
  assert.equal(p.summary.people,2);
  const namesakes=db();execute(namesakes,p);assert.equal(count(namesakes,'network_directory_entries'),2);namesakes.close();
  a.raw_fields.LinkedIn='https://linkedin.com/in/same-example';b.raw_fields.LinkedIn='https://www.linkedin.com/in/same-example/';
  const q=buildDirectoryPlan({records:[a,b],manifest:manifest([accept(a),accept(b)])});
  assert.equal(q.summary.people,0);assert.equal(q.summary.source_rows.review,2);assert.equal(q.summary.duplicate_identity_groups,1);
  const d=db();execute(d,q);assert.equal(count(d,'network_directory_entries'),0);assert.equal(count(d,'network_directory_reviews'),3);d.close();
});

test('organization personal LinkedIn is retained as raw input, never org identity or invented employment',()=>{
  const a=air('rec-p','Example Person',{LinkedIn:'https://linkedin.com/in/example-person'}),b=air('rec-o','Example Capital',{Type:'CVC',LinkedIn:'https://linkedin.com/in/example-person'});
  const p=buildDirectoryPlan({records:[a,b],manifest:manifest([accept(a),accept(b,'organization')])});
  const d=db();execute(d,p);assert.equal(count(d,'network_directory_entries'),2);
  assert.equal(d.prepare("SELECT profile_url FROM network_directory_entries WHERE kind='organization'").get().profile_url,null);
  assert.equal(count(d,'network_directory_affiliations'),0);d.close();
});

test('ambiguous affiliations and titles remain source-only; unknown organization is not fabricated',()=>{
  const a=folk('shared-a','Example Person',['Unreviewed Ventures']);
  const b=folk('shared-b','Other Person',['Example Ventures']);
  const p=buildDirectoryPlan({records:[a,b],manifest:manifest([accept(a,'person',{affiliation_disposition:'accept_source_claim'}),accept(b,'person',{affiliation_disposition:'accept_source_claim',title_disposition:'review'})],[org()])});
  const d=db();execute(d,p);assert.equal(p.summary.affiliations_needing_review,1);
  assert.equal(count(d,'network_directory_affiliations'),1);assert.equal(d.prepare('SELECT title FROM network_directory_affiliations').get().title,null);
  assert.equal(d.prepare("SELECT count(*) n FROM network_directory_entries WHERE display_name='Unreviewed Ventures'").get().n,0);d.close();
});

test('malformed URL and mismatched reviewed organization quarantine the affiliation',()=>{
  for(const value of ['javascript:alert(1)','https://user:pass@example.com','https://user:pass@linkedin.com/in/example','http://127.0.0.1','https://linkedin.com.evil.com/in/example','https://linkedin.com/company/example'])assert.equal(professionalUrl(value,'person'),null);
  assert.equal(professionalUrl('https://www.linkedin.com/in/example/?trk=x','person'),'https://linkedin.com/in/example');
  assert.equal(professionalUrl('www.linkedin.com/in/Example/','person'),'https://linkedin.com/in/example');
  assert.equal(professionalUrl('https://au.linkedin.com/in/Example/','person'),'https://linkedin.com/in/example');
  assert.equal(professionalUrl('linkedin.com/company/example/mycompany/','organization'),'https://linkedin.com/company/example');
  const a=folk('shared-a','Example Person');
  const p=buildDirectoryPlan({records:[a],manifest:manifest([accept(a,'person',{affiliation_disposition:'accept_source_claim'})],[org('Example Ventures',{website:'javascript:alert(1)'})])});
  assert.equal(p.summary.organizations,0);assert.equal(p.summary.affiliations,0);assert.equal(p.summary.derived_organizations.review,1);
});

test('source snapshots preserve updates; older replays and verified corrections are not overwritten',()=>{
  const d=db(),input=fixture(),first=buildDirectoryPlan(input);execute(d,first);
  input.records[0].raw_fields.Name='Updated Name';input.records[0].observed_at='2026-11-20T12:00:00.000Z';
  execute(d,buildDirectoryPlan(input));execute(d,first);
  assert.equal(d.prepare("SELECT display_name FROM network_directory_entries WHERE source_external_id='rec-alpha'").get().display_name,'Updated Name');
  assert.equal(count(d,'network_directory_source_records'),4);
  d.prepare("UPDATE network_directory_entries SET display_name='Reviewed Name',verification_status='reviewed' WHERE source_external_id='rec-alpha'").run();
  input.records[0].observed_at='2026-11-21T12:00:00.000Z';input.records[0].raw_fields.Name='Later source claim';
  execute(d,buildDirectoryPlan(input));assert.equal(d.prepare("SELECT display_name FROM network_directory_entries WHERE source_external_id='rec-alpha'").get().display_name,'Reviewed Name');d.close();
});

test('subsecond source order, staged publication and independently linked facts survive replay',()=>{
  const d=db(),input=fixture();input.records[0].observed_at='2026-11-19T12:00:00.100Z';const old=buildDirectoryPlan(input);execute(d,old);
  input.records[0].observed_at='2026-11-19T12:00:00.900Z';input.records[0].raw_fields.Name='Newer';execute(d,buildDirectoryPlan(input));execute(d,old);
  assert.equal(d.prepare("SELECT display_name FROM network_directory_entries WHERE source_external_id='rec-alpha'").get().display_name,'Newer');
  d.exec('INSERT INTO users(id) VALUES (1);');
  d.prepare("UPDATE network_directory_entries SET linked_user_id=1,link_verified_by=1,link_verified_at=? WHERE source_external_id='rec-alpha'").run(observed_at);
  input.records[0].observed_at='2026-11-20T12:00:00.000Z';input.records[0].raw_fields.Name='Must stay source-only';execute(d,buildDirectoryPlan(input));
  assert.equal(d.prepare("SELECT display_name FROM network_directory_entries WHERE source_external_id='rec-alpha'").get().display_name,'Newer');
  d.prepare("UPDATE network_directory_entries SET publication_status='published' WHERE source_external_id='shared-beta'").run();
  input.records[1].raw_fields.Person='Must also stay source-only';input.records[1].observed_at='2026-11-20T12:00:00.000Z';execute(d,buildDirectoryPlan(input));
  assert.equal(d.prepare("SELECT display_name FROM network_directory_entries WHERE source_external_id='shared-beta'").get().display_name,'Second Person');d.close();
});

test('explicit reviewed title null is honored without falling back to source headline',()=>{
  const a=folk('shared-a','Example Person');
  const p=buildDirectoryPlan({records:[a],manifest:manifest([accept(a,'person',{affiliation_disposition:'accept_source_claim',title:null})],[org()])});
  const d=db();execute(d,p);assert.equal(d.prepare('SELECT title FROM network_directory_affiliations').get().title,null);d.close();
});

test('equal-time conflicting revisions preserve the staged projection and create review evidence',()=>{
  const d=db(),input=fixture();execute(d,buildDirectoryPlan(input));
  input.records[0].raw_fields.Name='Conflicting Name';input.manifest.rows[1].title='Different title';execute(d,buildDirectoryPlan(input));
  assert.equal(d.prepare("SELECT display_name FROM network_directory_entries WHERE source_external_id='rec-alpha'").get().display_name,'Example Person');
  assert.equal(d.prepare('SELECT title FROM network_directory_affiliations').get().title,'Partner');
  assert.equal(d.prepare("SELECT count(*) n FROM network_directory_reviews WHERE reason='equal_time_source_conflict'").get().n,2);
  assert.equal(count(d,'network_directory_source_records'),5);d.close();
});

test('untrusted source rows cannot impersonate internally reviewed organization records',()=>{
  const a={...air('rec-injected','Example'),derived_organization:true,display_name:'Injected Organization',decision:{entity_kind:'organization',disposition:'accept'}};
  assert.throws(()=>buildDirectoryPlan({records:[a],manifest:manifest([])}),/Reserved source/);
  const b=air('rec-real','Example');const p=buildDirectoryPlan({records:[b],manifest:manifest([])});
  assert.equal(p.summary.source_rows.review,1);assert.equal(p.summary.organizations,0);
});

test('partial failure rolls back its row and rerun resumes; completion cannot precede reconciled rows',()=>{
  const d=db(),p=buildDirectoryPlan(fixture());batch(d,p.batches[0]);batch(d,p.batches.at(-1));
  assert.equal(d.prepare('SELECT status FROM network_directory_import_runs').get().status,'planned');
  const broken={...p.batches[1],statements:[...p.batches[1].statements,{sql:'INSERT INTO missing_table (a) VALUES (?)',params:[1]}]};
  assert.throws(()=>batch(d,broken),/missing_table/);assert.equal(count(d,'network_directory_entries'),0);
  execute(d,p);assert.equal(d.prepare('SELECT status FROM network_directory_import_runs').get().status,'complete');assert.equal(count(d,'network_directory_entries'),3);d.close();
});

test('entity kind, reviewed account linkage, affiliation kinds and reconciliation are database invariants',()=>{
  const d=db();execute(d,buildDirectoryPlan(fixture()));
  d.exec('INSERT INTO users(id) VALUES (1);INSERT INTO company_profiles(id) VALUES (1);');
  assert.throws(()=>d.prepare("UPDATE network_directory_entries SET linked_user_id=1 WHERE kind='person'").run(),/CHECK/);
  assert.throws(()=>d.prepare("UPDATE network_directory_entries SET linked_company_id=1,link_verified_by=1,link_verified_at=? WHERE kind='person'").run(observed_at),/CHECK/);
  assert.throws(()=>d.prepare("UPDATE network_directory_affiliations SET person_uid=organization_uid").run(),/FOREIGN KEY/);
  assert.throws(()=>d.prepare("UPDATE network_directory_affiliations SET source_record_uid=(SELECT uid FROM network_directory_source_records WHERE entry_kind='organization' LIMIT 1)").run(),/FOREIGN KEY/);
  assert.throws(()=>d.prepare('UPDATE network_directory_import_runs SET input_count=999').run(),/CHECK/);d.close();
});

test('input ordering is deterministic, conflicting identities review, duplicate rows reconcile',()=>{
  const input=fixture(),p=buildDirectoryPlan(input);assert.deepEqual(buildDirectoryPlan({...input,records:[...input.records].reverse()}),p);
  const a=air('rec-a','Name'),b={...a,raw_fields:{Name:'Another'}};
  const q=buildDirectoryPlan({records:[a,b],manifest:manifest([accept(a)])});assert.equal(q.summary.source_rows.review,2);assert.equal(q.summary.people,0);
  const r=buildDirectoryPlan({records:[a,a],manifest:manifest([accept(a)])});assert.deepEqual(r.summary.source_rows,{input:2,accepted:1,review:0,skipped:1});
  const d=db();execute(d,r);assert.equal(count(d,'network_directory_entries'),1);assert.equal(count(d,'network_directory_import_rows'),2);d.close();
  assert.throws(()=>buildDirectoryPlan({records:[a],manifest:manifest([accept(a),accept(a)])}),/Duplicate manifest/);
  const newer={...a,observed_at:'2026-11-20T12:00:00.000Z'};
  const n=buildDirectoryPlan({records:[a,newer],manifest:manifest([accept(a)])});
  assert.deepEqual(n,buildDirectoryPlan({records:[newer,a],manifest:manifest([accept(a)])}));
  const nd=db();execute(nd,n);assert.equal(nd.prepare('SELECT observed_at FROM network_directory_entries').get().observed_at,newer.observed_at);
  assert.equal(nd.prepare('SELECT count(DISTINCT observed_at) n FROM network_directory_import_rows').get().n,2);nd.close();
});

test('reviewed organization candidates require source evidence and use only their claimants observation date',()=>{
  const a=folk('shared-a','Example Person'),b={...folk('shared-b','Other Person',['Other Ventures']),observed_at:'2026-11-20T12:00:00.000Z'};
  assert.throws(()=>buildDirectoryPlan({records:[a],manifest:manifest([accept(a)],[org('Absent Ventures')])}),/no source association/);
  const p=buildDirectoryPlan({records:[a,b],manifest:manifest([accept(a),accept(b)],[org()])});const d=db();execute(d,p);
  assert.equal(d.prepare("SELECT observed_at FROM network_directory_entries WHERE kind='organization'").get().observed_at,observed_at);d.close();
});

test('Research links use real directory identities, typed organization provenance and one reviewed target',()=>{
  const d=new DatabaseSync(':memory:',SCHEMA_OPTIONS);loadSchema(d);d.exec('PRAGMA foreign_keys=ON');
  // Recreate only this empty local bridge from the migration under test. The
  // parent Research tables remain the real migrated schema, including UID keys.
  d.exec('DROP TABLE network_directory_research_links');d.exec(migration);
  execute(d,buildDirectoryPlan(fixture()));
  d.prepare("INSERT INTO users (id,uid,email,name,role) VALUES (880001,'7672-reviewer','reviewer@synthetic.invalid','Example Reviewer','admin')").run();
  for(const n of [1,2]) {
    d.prepare('INSERT INTO research_company_directory (uid,name,website,source_name,source_url,as_of) VALUES (?,?,?,?,?,?)').run(`7672-company-${n}`,'Example Company','https://example.com','Synthetic fixture','https://example.com/evidence',observed_at);
    d.prepare('INSERT INTO research_fund_directory (uid,name,source_name,source_url,as_of) VALUES (?,?,?,?,?)').run(`7672-fund-${n}`,'Example Manager','Synthetic fixture','https://example.com/evidence',observed_at);
  }
  const organization=d.prepare("SELECT uid FROM network_directory_entries WHERE kind='organization'").get().uid;
  const person=d.prepare("SELECT uid FROM network_directory_entries WHERE kind='person' LIMIT 1").get().uid;
  const source=d.prepare('SELECT uid FROM network_directory_source_records WHERE entry_uid=?').get(organization).uid;
  const personSource=d.prepare('SELECT uid FROM network_directory_source_records WHERE entry_uid=?').get(person).uid;
  const insert=d.prepare('INSERT INTO network_directory_research_links (uid,organization_uid,company_directory_uid,fund_directory_uid,target_kind,source_record_uid,reviewed_by_user_id,reviewed_at,evidence_url) VALUES (?,?,?,?,?,?,?,?,?)');
  const link=(id,o,c,f,k,s=source,reviewer=880001)=>insert.run(id,o,c,f,k,s,reviewer,observed_at,'https://example.com/evidence');
  link('company-link',organization,'7672-company-1',null,'company');
  link('manager-link',organization,null,'7672-fund-1','fund_manager');
  assert.equal(count(d,'network_directory_research_links'),2);
  assert.throws(()=>link('person-link',person,'7672-company-2',null,'company',personSource),/FOREIGN KEY/);
  assert.throws(()=>link('both-targets',organization,'7672-company-2','7672-fund-2','company'),/CHECK/);
  assert.throws(()=>link('no-target',organization,null,null,'company'),/CHECK/);
  assert.throws(()=>link('orphan',organization,'7672-company-absent',null,'company'),/FOREIGN KEY/);
  assert.throws(()=>link('orphan-fund',organization,null,'7672-fund-absent','fund_manager'),/FOREIGN KEY/);
  assert.throws(()=>link('wrong-evidence',organization,'7672-company-2',null,'company',personSource),/FOREIGN KEY/);
  assert.throws(()=>link('duplicate-company',organization,'7672-company-1',null,'company'),/UNIQUE/);
  assert.throws(()=>link('duplicate-fund',organization,null,'7672-fund-1','fund_manager'),/UNIQUE/);
  assert.throws(()=>link('wrong-kind',organization,'7672-company-2',null,'fund_manager'),/CHECK/);
  assert.throws(()=>link('no-reviewer',organization,'7672-company-2',null,'company',source,null),/NOT NULL/);
  d.close();
});

test('CLI creates restricted local plan, prints only counts and has no execute option',()=>{
  const dir=mkdtempSync(join(tmpdir(),'network-directory-test-'));
  try {
    const input=fixture(),r=join(dir,'records.json'),m=join(dir,'review.json'),o=join(dir,'plan.json');
    writeFileSync(r,JSON.stringify(input.records));writeFileSync(m,JSON.stringify(input.manifest));
    const args=['scripts/plan-network-directory.mjs','--records',r,'--manifest',m,'--out',o];
    const ok=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(ok.status,0,ok.stderr);assert.equal(statSync(o).mode&0o777,0o600);
    assert.ok(!ok.stdout.includes('private@example.com'));assert.ok(!ok.stdout.includes('Example Person'));assert.equal(JSON.parse(ok.stdout).production_written,false);
    const failed=spawnSync(process.execPath,[...args.slice(0,-1),join(dir,'apply.json'),'--apply'],{encoding:'utf8'});assert.equal(failed.status,1);assert.ok(!failed.stderr.includes('private@example.com'));
    const bad=spawnSync(process.execPath,[...args.slice(0,-1),'scripts/should-not-exist.json'],{encoding:'utf8'});assert.equal(bad.status,1);
    writeFileSync(m,JSON.stringify({...input.manifest,source_snapshot_sha256:{'records.json':'0'.repeat(64)}}));
    const mismatch=spawnSync(process.execPath,[...args.slice(0,-1),join(dir,'mismatch.json')],{encoding:'utf8'});assert.equal(mismatch.status,1);
    writeFileSync(m,JSON.stringify({...input.manifest,source_snapshot_sha256:{'records.json':createHash('sha256').update(readFileSync(r)).digest('hex')}}));
    const matched=spawnSync(process.execPath,[...args.slice(0,-1),join(dir,'matched.json')],{encoding:'utf8'});assert.equal(matched.status,0,matched.stderr);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
