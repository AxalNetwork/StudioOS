/** #6316: real SQLite snapshot keysets survive edits and timestamp ties without exposing another venture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { prospectPipeline } from '../src/services/growProspects.ts';

test('all 250 cards remain reachable once across ties, edits and independent status cursors',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id INTEGER PRIMARY KEY);
    CREATE TABLE contacts(id INTEGER PRIMARY KEY,uid TEXT,project_id INTEGER,audience TEXT,status TEXT,updated_at TEXT,created_at TEXT,name TEXT,organization TEXT,source TEXT,utm_json TEXT);
    CREATE TABLE contact_tasks(contact_id INTEGER,due_date TEXT,done INTEGER);
    CREATE TABLE contact_replies(contact_id INTEGER,direction TEXT,created_at TEXT);
    INSERT INTO projects VALUES(7),(8);`);
  db.exec(readFileSync(new URL('../sql/migrations/202611151923_6316_prospect_pages.sql',import.meta.url),'utf8'));
  const insert=db.prepare("INSERT INTO contacts VALUES(?,?,7,'customer',?,?,?,'Fixture',NULL,'manual',NULL)");
  for(let i=1;i<=500;i++)insert.run(i,`p-${i}`,i<=250?'new':'active',`2026-11-${i%2?'14':'15'} 00:00:00`,'2026-11-01');
  const env={DB:d1Over(db)} as any;
  try{
    const first=await prospectPipeline(env,7,{per_status:'100'});
    assert.equal(first.total,500);
    const expected=db.prepare("SELECT uid FROM contacts WHERE status='new' ORDER BY updated_at DESC,id DESC").all().map(r=>r.uid);
    const initial=first.columns.find(c=>c.status==='new')!;
    assert.equal(initial.more,150);assert.equal(initial.cards.length,100);
    const seen=initial.cards.map(r=>r.uid);
    // One unseen row jumps ahead of the live cursor, while a seen row moves behind it.
    db.prepare('UPDATE contacts SET updated_at=? WHERE uid=?').run('2099-01-01',expected[125]);
    db.prepare('UPDATE contacts SET updated_at=? WHERE uid=?').run('2000-01-01',expected[0]);
    let cursor=initial.next_cursor;
    while(cursor){
      const page=await prospectPipeline(env,7,{per_status:'100',cursor});
      assert.equal(page.total,500);assert.equal(page.columns.length,1);assert.equal(page.columns[0].count,250);
      seen.push(...page.columns[0].cards.map(r=>r.uid));cursor=page.columns[0].next_cursor;
    }
    assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,250);
    const active=first.columns.find(c=>c.status==='active')!;
    const nextActive=await prospectPipeline(env,7,{per_status:'100',cursor:active.next_cursor!});
    assert.equal(nextActive.columns[0].cards.length,100);assert.equal(nextActive.columns[0].more,50);
    for(const filter of [{source:'website'},{}]){
      await assert.rejects(()=>prospectPipeline(env,filter.source?7:8,{...filter,cursor:initial.next_cursor!}),{status:409});
    }
    await assert.rejects(()=>prospectPipeline(env,7,{cursor:'garbage'}),{status:400});
    const forged=JSON.parse(atob(initial.next_cursor!));forged.id=9999;
    await assert.rejects(()=>prospectPipeline(env,7,{cursor:btoa(JSON.stringify(forged))}),{status:409});
    db.exec("UPDATE grow_prospect_pages SET expires_at='2000-01-01'");
    await assert.rejects(()=>prospectPipeline(env,7,{cursor:initial.next_cursor!}),{status:409});
    await prospectPipeline(env,7,{});
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM grow_prospect_pages').get() as any).n,1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM grow_prospect_page_items').get() as any).n,500);
  }finally{db.close();}
});
