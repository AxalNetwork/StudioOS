/** D7920: actual IC router/SQLite ordering at the vote write, with only synthetic members and records. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SignJWT} from 'jose';
import ic from '../src/routes/ic.ts';
import {d1Over} from './_d1_sqlite.mjs';
const JWT_SECRET='synthetic-closed-vote-fixture-key-7920';
const AUTHOR=10,COLLEAGUE=11,ADMIN=12,OUTSIDER=13,CO=21,PROJ=7,DEAL=71,DEC='dec-alpha',MTG='mtg-alpha';
function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT,
      investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT, partner_id INTEGER
    );
    CREATE TABLE user_recovery_state (
      user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, is_primary_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, sector TEXT, stage TEXT,
      status TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER);
    CREATE TABLE ic_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER, deal_id INTEGER, title TEXT NOT NULL, memo TEXT,
      terms_json TEXT, status TEXT NOT NULL DEFAULT 'draft', decision TEXT,
      outcome TEXT, created_by INTEGER, decided_at TEXT, dd_case_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      company_id INTEGER
    );
    CREATE TABLE ic_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ic_decision_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, vote TEXT NOT NULL, rationale TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ic_decision_id, user_id)
    );
    -- D6143: the voting roster (migration 202611180056_6143); empty, so every decision here has none.
    CREATE TABLE ic_decision_voters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ic_decision_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, added_by INTEGER NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ic_decision_id, user_id)
    );
    CREATE TABLE decision_journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, owner_user_id INTEGER,
      project_id INTEGER, deal_id INTEGER, ic_decision_id INTEGER,
      decision TEXT, conviction TEXT, thesis TEXT, outcome_status TEXT,
      decided_at TEXT, created_at TEXT, updated_at TEXT,
      -- D624: the vote path reads both (baseline and migration 415).
      outcome_recorded_at TEXT, edited_after_outcome_at TEXT
    );
    CREATE TABLE ic_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      ic_decision_id INTEGER NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT, resolved_by INTEGER, owner_user_id INTEGER, owner_label TEXT
    );
    CREATE TABLE ic_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, agenda TEXT, start_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 60, deal_id INTEGER,
      organizer_user_id INTEGER NOT NULL, location_kind TEXT NOT NULL DEFAULT 'video',
      location_uri TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
      cancelled_at TEXT, cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      minutes TEXT, minutes_recorded_by INTEGER, minutes_recorded_at TEXT
    );
    CREATE TABLE ic_meeting_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, rsvp TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(meeting_id, user_id)
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(AUTHOR, 'investor', 'Ann Author');
  u.run(COLLEAGUE, 'investor', 'Col Colleague');
  u.run(ADMIN, 'admin', 'Ada Admin');
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(CO, AUTHOR);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(CO, COLLEAGUE);
  db.prepare('INSERT INTO projects (id, uid, name) VALUES (?, ?, ?)').run(PROJ, 'p-alpha', 'Alpha');
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(DEAL, 'd-alpha', PROJ);
  db.prepare(
    `INSERT INTO ic_decisions (uid, project_id, deal_id, title, status, created_by, company_id)
     VALUES (?, ?, ?, ?, 'voting', ?, ?)`,
  ).run(DEC, PROJ, DEAL, 'Alpha — IC review', AUTHOR, CO);
  db.prepare(
    `INSERT INTO ic_meetings (uid, title, start_at, deal_id, organizer_user_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(MTG, 'Alpha IC', '2026-09-20 15:00', DEAL, AUTHOR);
  return db;
}

type Hooks={beforeVote?:()=>Promise<void>;afterVote?:()=>Promise<void>};
function fixture(t:any){
 const db=freshDb(),hooks:Hooks={},base=d1Over(db);
 t.after(()=>db.close());
 db.prepare('INSERT INTO users (id,role,name) VALUES (?, ?, ?)').run(OUTSIDER,'investor','Synthetic other firm');
 // Another firm's open record must never satisfy this decision's write gate.
 db.prepare("INSERT INTO ic_decisions (uid,title,status,created_by,company_id) VALUES ('dec-unrelated','Synthetic other decision','voting',?,?)").run(OUTSIDER,CO+1);
 const env:any={JWT_SECRET,ENVIRONMENT:'development',DB:{...base,prepare(sql:string){
  const statement=base.prepare(sql);
  // These hooks schedule a second real HTTP request at the SQL boundary.
  // They never replace query results: every query runs on the same SQLite DB.
  if(/^\s*INSERT INTO ic_votes\b/.test(sql))for(const method of ['first','run','all'] as const){
   const execute=statement[method].bind(statement);
   statement[method]=async(...args:any[])=>{
    const before=hooks.beforeVote;delete hooks.beforeVote;if(before)await before();
    const result=await execute(...args);
    const after=hooks.afterVote;delete hooks.afterVote;if(after)await after();
    return result;
   };
  }
  return statement;
 }}};
 async function call(user:number,method:string,path:string,body?:unknown){
  const token=await new SignJWT({user_id:user,role:user===ADMIN?'admin':'investor'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const response=await ic.request(path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  return {status:response.status,body:await response.json() as any};
 }
 const vote=(choice:string,user=COLLEAGUE)=>call(user,'POST',`/${DEC}/vote`,{vote:choice,rationale:`Synthetic ${choice} rationale`});
 const record=(decision='invest')=>call(AUTHOR,'PUT',`/${DEC}`,{decision});
 const detail=()=>call(AUTHOR,'GET',`/${DEC}`);
 const snapshot=()=>({decision:{...db.prepare('SELECT * FROM ic_decisions WHERE uid=?').get(DEC)},votes:db.prepare('SELECT * FROM ic_votes ORDER BY id').all().map(r=>({...r})),journal:db.prepare('SELECT * FROM decision_journal_entries ORDER BY id').all().map(r=>({...r}))});
 return {db,hooks,call,vote,record,detail,snapshot};
}
function closed(result:{status:number;body:any}){
 assert.equal(result.status,409,JSON.stringify(result.body));
 assert.equal(result.body.error,'voting_closed');
 assert.match(result.body.message,/Voting is closed/);
}

test('recorded invest/pass/defer decisions refuse new votes, re-votes and recusals without changing journal or tally',async t=>{
 for(const decision of ['invest','pass','defer']){
  const f=fixture(t);assert.equal((await f.vote('yes')).status,200);
  // Graded journal history must also survive a late re-vote or recusal.
  f.db.prepare("UPDATE decision_journal_entries SET outcome_recorded_at='2026-11-01',edited_after_outcome_at=NULL").run();
  assert.equal((await f.record(decision)).status,200);
  const before=f.snapshot(),tally=(await f.detail()).body.tally;
  for(const user of [AUTHOR,COLLEAGUE,ADMIN])for(const choice of ['yes','no','abstain','recused']){
   closed(await f.vote(choice,user));assert.deepEqual(f.snapshot(),before);assert.deepEqual((await f.detail()).body.tally,tally);
  }
 }
});

test('a recording that wins immediately before the first vote write refuses every vote kind without a journal draft',async t=>{
 for(const status of ['draft','voting'])for(const choice of ['yes','no','abstain','recused']){
  const f=fixture(t);f.db.prepare('UPDATE ic_decisions SET status=?').run(status);
  let afterRecord:any;
  f.hooks.beforeVote=async()=>{assert.equal((await f.record()).status,200);afterRecord=f.snapshot();};
  closed(await f.vote(choice));assert.ok(afterRecord,'the recording ran between the read and actual write');
  assert.deepEqual(f.snapshot(),afterRecord);assert.equal(afterRecord.votes.length,0);assert.equal(afterRecord.journal.length,0);
  assert.deepEqual((await f.detail()).body.tally,{yes:0,no:0,abstain:0,recused:0});
 }
});

test('a recording that wins against an existing-vote upsert preserves the old vote and graded journal',async t=>{
 for(const choice of ['yes','no','abstain','recused']){
  const f=fixture(t);assert.equal((await f.vote('yes')).status,200);
  f.db.prepare("UPDATE decision_journal_entries SET outcome_recorded_at='2026-11-01',edited_after_outcome_at=NULL").run();
  let afterRecord:any;
  f.hooks.beforeVote=async()=>{assert.equal((await f.record('pass')).status,200);afterRecord=f.snapshot();};
  closed(await f.vote(choice));assert.ok(afterRecord);assert.deepEqual(f.snapshot(),afterRecord);
  assert.deepEqual((await f.detail()).body.tally,{yes:1,no:0,abstain:0,recused:0});
 }
});

test('a first vote that wins before recording cannot promote the recorded decision back into voting',async t=>{
 const f=fixture(t);f.db.prepare("UPDATE ic_decisions SET status='draft'").run();
 f.hooks.afterVote=async()=>{assert.equal((await f.record('pass')).status,200);};
 const result=await f.vote('yes');assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(result.body.status,'decided');assert.equal(result.body.decision,'pass');
 assert.deepEqual(result.body.tally,{yes:1,no:0,abstain:0,recused:0});
 assert.equal(f.snapshot().journal[0].decision,'invest','the accepted vote retains its normal private journal draft');
 const before=f.snapshot();closed(await f.vote('no'));assert.deepEqual(f.snapshot(),before);
});

test('an open draft still starts voting and normal re-votes/recusal retain existing behavior',async t=>{
 const f=fixture(t);f.db.prepare("UPDATE ic_decisions SET status='draft'").run();
 const first=await f.vote('yes');assert.equal(first.status,200);assert.equal(first.body.status,'voting');
 assert.equal((await f.vote('no')).status,200);assert.equal(f.snapshot().journal[0].decision,'pass');
 const recused=await f.vote('recused');assert.equal(recused.status,200);assert.equal(recused.body.tally.recused,1);
 const before=f.snapshot();const refused=await f.vote('yes');assert.equal(refused.status,409);assert.equal(refused.body.error,'recusal_is_final');assert.deepEqual(f.snapshot(),before);
});

test('company and roster refusal still precede closed-vote disclosure, without any state change',async t=>{
 const f=fixture(t);const id=f.snapshot().decision.id;
 f.db.prepare('INSERT INTO ic_decision_voters (ic_decision_id,user_id,added_by) VALUES (?,?,?)').run(id,AUTHOR,AUTHOR);
 assert.equal((await f.vote('yes')).status,403);assert.equal((await f.record()).status,200);
 const before=f.snapshot();assert.equal((await f.vote('yes',OUTSIDER)).status,404);assert.equal((await f.vote('yes')).status,403);closed(await f.vote('yes',AUTHOR));assert.deepEqual(f.snapshot(),before);
});

test('a recusal that wins at the same write boundary remains final and keeps its graded journal trace',async t=>{
 const f=fixture(t);assert.equal((await f.vote('yes')).status,200);
 f.db.prepare("UPDATE decision_journal_entries SET outcome_recorded_at='2026-11-01',edited_after_outcome_at=NULL").run();
 let afterRecusal:any;
 f.hooks.beforeVote=async()=>{assert.equal((await f.vote('recused')).status,200);afterRecusal=f.snapshot();};
 const refused=await f.vote('no');assert.equal(refused.status,409);assert.equal(refused.body.error,'recusal_is_final');assert.ok(afterRecusal);assert.deepEqual(f.snapshot(),afterRecusal);assert.equal(afterRecusal.journal[0].decision,'other');assert.ok(afterRecusal.journal[0].edited_after_outcome_at);
});
