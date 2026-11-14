// D6024: real Build record actions, protected references, atomic removal and honest plan history.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import records, { nextFor } from '../src/routes/cycle_records.ts';
import { readPlan } from '../src/services/buildPlanner.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = '6024-local-test-secret-0123456789-abcdef';
const app = new Hono<any>();
app.route('/api/cycles', records);
app.route('/api/cycles/build', build);
app.onError((error, c) => c.json({ detail: error.message }, 500));
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
    (10,'owner@example.test','Owner','founder',1001,1), (11,'reader@example.test','Reader','partner',NULL,1),
    (12,'other@example.test','Other','founder',1002,1), (13,'admin@example.test','Admin','admin',NULL,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES (1,'Example',1001,5),(2,'Other',1002,6);
    INSERT INTO user_company_links(uid,user_id,company_id) VALUES ('owner',10,5);
    INSERT INTO mvp_features(id,project_id,title,is_must_have,delivery_status,done_at) VALUES
    (7,1,'Recorded feature',1,'Done','2026-11-01'), (8,1,'Keep this feature',1,'Backlog',NULL),
    (9,2,'Other venture feature',1,'Backlog',NULL);`);
  // Match production cascades. Preexisting schema seed references are not the subject of this fixture.
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
const envFor = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' }) as any;
async function request(db: DatabaseSync, path: string, method = 'GET', user = 10, env = envFor(db)) {
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(1).setExpirationTime(4102444800).sign(new TextEncoder().encode(SECRET));
  const response = await withThrownResponses(() => app.request('/api/cycles/build' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  }, env));
  return { status: response.status, body: await response.json() as any };
}
const record = (slug: string, id = 7, project = 1) => `/modules/${slug}/records/${id}?project=${project}`;
const action = (slug: string, key: string, id = 7, project = 1) => `/modules/${slug}/records/${id}/actions/${key}?project=${project}`;
const n = (db: DatabaseSync, table: string) => Number(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get()!.n);
function plan(db: DatabaseSync) {
  db.exec(`INSERT INTO build_plans(id,uid,project_id,scope,trigger,status,evidence_hash,created_by) VALUES (1,'plan',1,'venture','manual','open','hash',10);`);
  for (const [uid, module, kind, id] of [['feature','solution-design','feature',7],['must','prototype-mvp','must-have',7],['foreign','solution-design','feature',9]]) {
    db.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,kind,payload_json,status) VALUES (?,10,'build','plan','proposal','{"title":"Original proposal"}','accepted')`).run(uid);
    db.prepare(`INSERT INTO build_plan_items(uid,plan_id,project_id,module,kind,item_key,proposal_uid,evidence_json,marker,landed_table,landed_id)
      VALUES (?,1,1,?,?,?,?, '[]',?,'mvp_features',?)`).run(uid, module, kind, uid, uid, uid, String(id));
  }
}
const item = (value: any, module: string, uid: string) => value.modules[module].find((row: any) => row.uid === uid);

test('writers get both confirmed actions; readers and foreign record requests cannot run them', async () => {
  const db = fixture();
  try {
    for (const [slug,key,label] of [['solution-design','delete','Remove feature'],['prototype-mvp','unmark-must-have','No longer a must-have']]) {
      for (const user of [10,13]) {
        const result = await request(db, record(slug), 'GET', user);
        assert.equal(result.status, 200);
        const declaration = result.body.actions.find((a: any) => a.key === key);
        assert.equal(declaration.label, label); assert.equal(declaration.kind, 'write'); assert.equal(declaration.tone, 'danger');
        assert.ok(declaration.confirm.title && declaration.confirm.body && declaration.confirm.cta);
        assert.notEqual(result.body.next?.action,key,'removal is never promoted to the fallback Next step');
        assert.equal(nextFor([],result.body.actions)?.action,'edit','the action list preserves Edit when no section supplies a next step');
      }
      assert.deepEqual((await request(db, record(slug), 'GET', 11)).body.actions, []);
      assert.equal((await request(db, action(slug,key), 'POST', 11)).status, 403);
      assert.equal((await request(db, action(slug,key,9), 'POST')).status, 404);
      assert.equal((await request(db, action(slug,key), 'POST', 12)).status, 403);
    }
    assert.equal(n(db,'mvp_features'),3); assert.equal(n(db,'activity_logs'),0);
  } finally { db.close(); }
});

test('feature removal cascades its links/checks, logs the actor and preserves the original plan acceptance', async () => {
  const db = fixture();
  try {
    plan(db);
    db.exec(`INSERT INTO mvp_feature_links(feature_id,kind,url) VALUES (7,'figma','https://figma.com/file/example'),(8,'github','https://github.com/example/repo/issues/1');
      INSERT INTO mvp_release_checks(feature_id,label) VALUES (7,'Check to remove'),(8,'Keep this check');`);
    assert.equal(item(await readPlan(envFor(db),1),'solution-design','feature').landed_state,'present');
    assert.equal((await request(db,action('solution-design','delete'),'POST')).status,200);
    assert.equal((await request(db,record('solution-design'))).status,404);
    assert.equal((await request(db,record('prototype-mvp'))).status,404);
    assert.equal(n(db,'mvp_features'),2); assert.equal(n(db,'mvp_feature_links'),1); assert.equal(n(db,'mvp_release_checks'),1);
    assert.deepEqual({ ...db.prepare('SELECT project_id,user_id,entity_type,entity_id,action,details,actor FROM activity_logs').get() },
      { project_id:1,user_id:10,entity_type:'build.solution-design',entity_id:'7',action:'build_feature_removed',details:'Feature removed',actor:'user:10' });
    const value = await readPlan(envFor(db),1);
    for (const [slug,uid] of [['solution-design','feature'],['prototype-mvp','must'],['solution-design','foreign']]) {
      const row = item(value,slug,uid); assert.equal(row.landed_state,'removed'); assert.equal(row.status,'accepted');
      assert.equal(row.payload.title,'Original proposal'); assert.equal(row.landed_table,'mvp_features');
    }
    assert.equal(n(db,'build_plan_items'),3);
  } finally { db.close(); }
});

test('No longer a must-have preserves the feature and all related work through patchFeature', async () => {
  const db = fixture();
  try {
    plan(db);
    db.exec(`INSERT INTO roadmap_okrs(project_id,objective,feature_id) VALUES (1,'Keep roadmap',7);
      INSERT INTO venture_risks(project_id,title,severity,feature_id,created_by) VALUES (1,'Keep risk','low',7,10);
      INSERT INTO mvp_test_sessions(project_id,feature_id,title) VALUES (1,7,'Keep session');`);
    const before = { ...db.prepare('SELECT * FROM mvp_features WHERE id=7').get() } as any;
    assert.equal((await request(db,action('prototype-mvp','unmark-must-have'),'POST')).status,200);
    assert.equal((await request(db,record('prototype-mvp'))).status,404);
    assert.equal((await request(db,record('solution-design'))).status,200);
    const after = { ...db.prepare('SELECT * FROM mvp_features WHERE id=7').get() } as any;
    assert.equal(after.is_must_have,0);
    for (const key of Object.keys(before).filter(key => !['is_must_have','updated_at'].includes(key))) assert.equal(after[key],before[key],key);
    assert.equal(n(db,'roadmap_okrs'),1); assert.equal(n(db,'venture_risks'),1); assert.equal(n(db,'mvp_test_sessions'),1);
    const value=await readPlan(envFor(db),1); assert.equal(item(value,'prototype-mvp','must').landed_state,'not_must_have');
    assert.equal(item(value,'solution-design','feature').landed_state,'present');
    assert.equal(item(value,'solution-design','foreign').landed_state,'removed');
    assert.equal(db.prepare('SELECT action FROM activity_logs').get()!.action,'build_feature_details_changed');
  } finally { db.close(); }
});

test('D1 cascade-inclusive change metadata still reports a successful parent removal',async()=>{
  const db=fixture();try{
    db.exec(`INSERT INTO mvp_feature_links(feature_id,kind,url) VALUES (7,'figma','https://figma.com/file/example');
      INSERT INTO mvp_release_checks(feature_id,label) VALUES (7,'Release check');`);
    const env=envFor(db),batch=env.DB.batch.bind(env.DB);
    // Observed with the native Miniflare D1 binding: one parent + two cascades
    // has meta.changes=3, while DELETE RETURNING still has one parent row.
    env.DB.batch=async(statements:any[])=>{
      const results=await batch(statements);results[0].meta.changes=3;return results;
    };
    const result=await request(db,action('solution-design','delete'),'POST',10,env);
    assert.equal(result.status,200);assert.equal(result.body.ok,true);
    assert.equal(n(db,'mvp_features'),2);assert.equal(n(db,'mvp_feature_links'),0);assert.equal(n(db,'mvp_release_checks'),0);
    assert.equal(n(db,'activity_logs'),1);
  }finally{db.close();}
});

const protectedReferences = [
  ['roadmap_okrs',"INSERT INTO roadmap_okrs(project_id,objective,feature_id) VALUES (1,'Linked item',7)",'1 roadmap item'],
  ['venture_risks',"INSERT INTO venture_risks(project_id,title,severity,feature_id,created_by) VALUES (1,'Linked risk','low',7,10)",'1 risk'],
  ['mvp_test_sessions',"INSERT INTO mvp_test_sessions(project_id,feature_id,title) VALUES (1,7,'Linked session')",'1 test session'],
];
for (const [table,sql,label] of protectedReferences) test(`feature removal refuses ${table} and names its blocker without changing any row`,async () => {
  const db=fixture();try {
    db.exec(sql);const result=await request(db,action('solution-design','delete'),'POST');
    assert.equal(result.status,409);assert.ok(result.body.detail.includes(label));
    assert.equal(n(db,'mvp_features'),3);assert.equal(n(db,table),1);assert.equal(n(db,'activity_logs'),0);
  } finally {db.close();}
});

for (const [table,sql,label] of protectedReferences) test(`a ${table} reference arriving between the read and batch prevents deletion and a false audit`,async () => {
  const db=fixture();try {
    const env=envFor(db),batch=env.DB.batch.bind(env.DB);
    env.DB.batch=async (statements: any[]) => {
      db.exec(table === 'roadmap_okrs' ? sql.replace('VALUES (1,', 'VALUES (2,') : sql);
      return batch(statements);
    };
    const result=await request(db,action('solution-design','delete'),'POST',10,env);
    assert.equal(result.status,409);assert.ok(result.body.detail.includes(label));
    assert.equal(n(db,'mvp_features'),3);assert.equal(n(db,table),1);assert.equal(n(db,'activity_logs'),0);
  } finally {db.close();}
});

test('an audit failure rolls the removal and cascaded child rows back',async () => {
  const db=fixture();try {
    db.exec(`INSERT INTO mvp_release_checks(feature_id,label) VALUES (7,'Keep after rollback');
      CREATE TRIGGER reject_feature_removal BEFORE INSERT ON activity_logs WHEN NEW.action='build_feature_removed'
      BEGIN SELECT RAISE(ABORT,'fixture log failure'); END;`);
    assert.equal((await request(db,action('solution-design','delete'),'POST')).status,500);
    assert.equal(n(db,'mvp_features'),3);assert.equal(n(db,'mvp_release_checks'),1);assert.equal(n(db,'activity_logs'),0);
  } finally {db.close();}
});

for (const [slug,key] of [['solution-design','delete'],['prototype-mvp','unmark-must-have']]) test(`${key} refreshes must-have counts, burn-up and overview figures from the canonical rows`,async () => {
  const db=fixture();try {
    for (const [id,month] of [[20,'08'],[21,'09'],[22,'10']]) db.prepare("INSERT INTO mvp_features(id,project_id,title,is_must_have,delivery_status,done_at) VALUES (?,1,'Completed feature',1,'Done',?)").run(id,`2026-${month}-01`);
    const before=await request(db,'/modules/prototype-mvp?project=1');assert.equal(before.status,200);
    assert.equal(before.body.facts.total,5);assert.equal(before.body.facts.done,4);assert.equal(before.body.card.series[0].target,5);
    assert.equal((await request(db,action(slug,key),'POST')).status,200);
    const after=await request(db,'/modules/prototype-mvp?project=1');assert.equal(after.status,200);
    assert.equal(after.body.records.total,4);assert.equal(after.body.facts.total,4);assert.equal(after.body.facts.done,3);
    assert.equal(after.body.card.series[0].target,4);assert.equal(after.body.card.series[0].values.at(-1),3);
    const overview=await request(db,'/overview?project=1');assert.equal(overview.status,200);
    assert.deepEqual(overview.body.figures.find((f: any) => f.key==='must_haves_done').value,[3,4]);
  } finally {db.close();}
});
