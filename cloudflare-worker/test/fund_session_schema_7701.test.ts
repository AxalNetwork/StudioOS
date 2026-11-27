/** D7701 (#7701): data-preserving fund target expansion, over the complete migrated SQLite schema.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7701: data-preserving fund target CHECK
 * expansion, all session/duty fields, indexes, foreign keys, constraints and deleted AUTOINCREMENT
 * high-water marks on populated and empty tables.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const MIGRATION = '202611191914_7701_fund_session_targets.sql';
const sql = readFileSync(new URL('../sql/migrations/' + MIGRATION, import.meta.url), 'utf8');
function before(t: any) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db, { below: Number(MIGRATION.slice(0, 12)) });
  db.exec(`
    INSERT INTO users(id,uid,role,name,email) VALUES(1,'schema-user','founder','Synthetic founder','schema@example.test');
    INSERT INTO company_profiles(id,uid,company_name) VALUES(1,'schema-company','Synthetic company');
    INSERT INTO team_agents(id,uid,scope_kind,company_id,role_key,model_id,sponsor_user_id,monthly_cap_microusd,created_by)
      VALUES(1,'schema-agent','company',1,'ceo','synthetic-model',1,1000,1);
    INSERT INTO agent_skills(id,uid,scope,slug,name,purpose,output_kind,created_by)
      VALUES(1,'schema-skill','hq','schema-skill','Synthetic skill','Synthetic schema check','draft',1);
  `);
  db.exec('PRAGMA foreign_keys=ON'); t.after(() => db.close());
  return db;
}
function session(db: DatabaseSync, uid: string, target = 'document') {
  return db.prepare(`INSERT INTO agent_duties(uid,agent_id,kind,title,cadence,hour_utc,minute_utc,zone,local_time,
    run_at,skill_id,skill_version,target_kind,target_id,instruction,next_due_at,created_by,created_at,updated_at)
    VALUES(?,1,'session','Synthetic session','once',9,15,'UTC','09:15','2026-12-01T09:15:00Z',1,1,?,'12',
      'Synthetic instruction','2026-12-01T09:15:00Z',1,'2026-11-19T12:00:00Z','2026-11-19T12:00:00Z')`).run(uid, target);
}
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM agent_duties ORDER BY id').all().map(r => ({ ...r }));
const indexes = (db: DatabaseSync) => db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='agent_duties' AND sql IS NOT NULL ORDER BY name").all().map(r => ({ ...r }));
const foreignKeys = (db: DatabaseSync) => db.prepare("PRAGMA foreign_key_list('agent_duties')").all().map(r => ({ ...r }));

test('fund target expansion keeps every existing duty and session field, index and foreign key', t => {
  const db = before(t);
  session(db, 'document-session');
  db.exec(`INSERT INTO agent_duties(uid,agent_id,template_key,title,cadence,weekday,hour_utc,next_due_at,status,created_by)
    VALUES('weekly-duty',1,'weekly-summary','Synthetic duty','weekly',2,10,'2026-12-01T10:00:00Z','paused',1)`);
  const original = rows(db), originalIndexes = indexes(db), originalKeys = foreignKeys(db);
  db.exec(sql);
  assert.deepEqual(rows(db), original);
  assert.deepEqual(indexes(db), originalIndexes);
  assert.deepEqual(foreignKeys(db), originalKeys);
  const id = Number(session(db, 'fund-session', 'fund').lastInsertRowid);
  assert.deepEqual({ ...db.prepare('SELECT target_kind,target_id,kind FROM agent_duties WHERE id=?').get(id) },
    { target_kind: 'fund', target_id: '12', kind: 'session' });
});

test('fund target expansion preserves the deleted high-water mark on populated and empty tables', t => {
  for (const empty of [false, true]) {
    const db = before(t); session(db, 'old-session');
    db.exec("UPDATE sqlite_sequence SET seq=900 WHERE name='agent_duties'");
    if (empty) db.exec('DELETE FROM agent_duties');
    db.exec(sql);
    assert.equal(Number(session(db, 'new-fund-session', 'fund').lastInsertRowid), 901, `empty=${empty}`);
  }
});

test('the expanded target check keeps target pairing, allowed kinds and duty uniqueness', t => {
  const db = before(t); db.exec(sql); session(db, 'fund-session', 'fund');
  assert.throws(() => session(db, 'bad-target', 'unknown'), /CHECK/);
  assert.throws(() => db.exec("UPDATE agent_duties SET target_id=NULL WHERE uid='fund-session'"), /CHECK/);
  assert.throws(() => db.exec("UPDATE agent_duties SET skill_id=NULL WHERE uid='fund-session'"), /CHECK/);
  db.exec(`INSERT INTO agent_duties(uid,agent_id,template_key,title,cadence,hour_utc,next_due_at)
    VALUES('duty-one',1,'same-template','Synthetic duty','daily',9,'2026-12-01T09:00:00Z')`);
  assert.throws(() => db.exec(`INSERT INTO agent_duties(uid,agent_id,template_key,title,cadence,hour_utc,next_due_at)
    VALUES('duty-two',1,'same-template','Synthetic duty','daily',9,'2026-12-01T09:00:00Z')`), /UNIQUE/);
  assert.throws(() => db.exec("UPDATE agent_duties SET agent_id=999 WHERE uid='fund-session'"), /FOREIGN KEY/);
});

test('a fresh database with every migration accepts a selected fund and retains old session kinds', t => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  const ddl = String(db.prepare("SELECT sql FROM sqlite_master WHERE name='agent_duties'").get()!.sql);
  assert.match(ddl, /'document', 'fund'/);
  assert.equal(indexes(db).length, 3);
});
