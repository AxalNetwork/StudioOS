/** D7814: real transactional rollback, CAS refusal, immutable candidate evidence and whole-field validation.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7814: transaction rollback, CAS,
 * preserved evidence and whole-candidate validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import competitors from '../src/routes/competitors.ts';
import { openSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
const SECRET = 'unit-test-7814-competitor-save-atomic-secret';
function fixture() {
  const db = openSchema();
  db.exec(`INSERT INTO users(id,email,name,role) VALUES(1,'owner@example.test','Owner','founder');
    INSERT INTO competitor_analyses(id,user_id,title,mode,status,inputs_json,edited) VALUES('a',1,'Before','custom','complete','{"subject":{"uid":"subject","name":"Subject","domain":"subject.example"}}',0);
    INSERT INTO competitor_analysis_outputs(analysis_id,output_json,edited,version) VALUES('a','{"notes":"Before"}',0,1);
    INSERT INTO competitor_candidates(id,analysis_id,name,category,relevance_score,scores_json,summary,details_json,origin,domain,url,position)
      VALUES('c1','a','One','direct',0.65,'{"score":3}','Before one','{"pricing":"$17"}','manual','one.example','https://one.example',7),
            ('c2','a','Two','adjacent',0.8,'{"score":4}','Before two','{"pricing":"$23"}','discovery','two.example','https://two.example',9);
    INSERT INTO competitor_sources(id,analysis_id,candidate_id,url,kind,origin) VALUES('s1','a','c1','https://source.example','web','manual');
    INSERT INTO competitor_signals(id,analysis_id,candidate_id,signal_type,label,detail) VALUES('g1','a','c1','pricing','Quoted price','$17');`);
  return db;
}
async function call(db: any, path: string, body: unknown, race = false) {
  const app = new Hono<any>(); app.route('/api/competitors', competitors);
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const d1 = d1Over(db); const batch = d1.batch.bind(d1);
  if (race) d1.batch = async (statements: any[]) => { db.exec("UPDATE competitor_analysis_outputs SET version = 2 WHERE analysis_id = 'a'"); return batch(statements); };
  const response = await app.fetch(new Request(`https://test.invalid/api/competitors/a${path}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { DB: d1, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: response.status, body: await response.json() as any };
}
function state(db: any) {
  return Object.fromEntries(['competitor_analyses','competitor_analysis_outputs','competitor_analysis_versions','competitor_candidates','competitor_sources','competitor_signals'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
test('an interruption after candidate one rolls back text, history, version and every candidate', async t => {
  const db = fixture(); t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_second_7814 BEFORE UPDATE ON competitor_candidates WHEN OLD.id = 'c2' BEGIN SELECT RAISE(ABORT, 'synthetic interruption'); END;");
  const before = state(db);
  const result = await call(db, '', { base_version: 1, title: 'After', output: { notes: 'After' }, candidates: [{ id: 'c1', name: 'Changed one' }, { id: 'c2', name: 'Changed two' }] });
  assert.equal(result.status, 503);
  assert.deepEqual(state(db), before);
});
test('a completed list save keeps row identity, evidence, pricing, scores and positions; only text moves the version', async t => {
  const db = fixture(); t.after(() => db.close()); const before = state(db);
  const result = await call(db, '', { base_version: 1, title: 'After', output: { notes: 'After' }, candidates: [{ id: 'c1', name: 'Renamed', category: 'adjacent', summary: 'Changed', relevance_score: 0, scores: {}, details: {}, origin: 'discovery', url: 'https://malicious.example', domain: 'malicious.example', position: 0 }] });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.version, 2);
  const after = state(db); const candidate = after.competitor_candidates[0] as any;
  for (const key of ['id','relevance_score','scores_json','details_json','origin','url','domain','position']) assert.equal(candidate[key], (before.competitor_candidates[0] as any)[key], key);
  assert.equal(candidate.name, 'Renamed'); assert.equal(candidate.category, 'adjacent'); assert.equal(candidate.summary, 'Changed');
  assert.deepEqual(after.competitor_candidates[1], before.competitor_candidates[1]);
  assert.deepEqual(after.competitor_sources, before.competitor_sources); assert.deepEqual(after.competitor_signals, before.competitor_signals);
  const candidateOnly = await call(db, '', { base_version: 2, candidates: [{ id: 'c1', summary: 'Later' }] });
  assert.equal(candidateOnly.status, 200); assert.equal(candidateOnly.body.version, 2);
});
test('stale, unversioned and foreign-candidate saves refuse without any partial text write', async t => {
  const db = fixture(); t.after(() => db.close());
  for (const [body, status] of [[{ base_version: 99, title: 'Stale', candidates: [{ id: 'c1', name: 'Changed' }] },409], [{ title: 'Unversioned', candidates: [] },400], [{ base_version: 1, title: 'Foreign', candidates: [{ id: 'elsewhere', name: 'Changed' }] },400]] as const) {
    const before = state(db); assert.equal((await call(db, '', body)).status, status); assert.deepEqual(state(db), before);
  }
});
test('a version changing between read and batch holds all guarded writes and the snapshot', async t => {
  const db = fixture(); t.after(() => db.close()); const before = state(db);
  const result = await call(db, '', { base_version: 1, title: 'Raced', output: { notes: 'Raced' }, candidates: [{ id: 'c1', name: 'Raced' }] }, true);
  assert.equal(result.status, 409); assert.equal(result.body.current_version, 2);
  const after = state(db); assert.deepEqual(after.competitor_analyses, before.competitor_analyses); assert.deepEqual(after.competitor_candidates, before.competitor_candidates); assert.deepEqual(after.competitor_analysis_versions, before.competitor_analysis_versions);
});
test('candidate validation happens before its one write and the subject is refused on both save paths', async t => {
  const db = fixture(); t.after(() => db.close());
  for (const path of ['', '/candidates/c1']) {
    const before = state(db);
    for (const category of ['invalid', ['direct'], { value: 'direct' }]) {
      const edits = { id: 'c1', name: 'Valid rename', category };
      const invalid = path ? edits : { base_version: 1, title: 'Should not persist', candidates: [edits] };
      assert.equal((await call(db, path, invalid)).status, 400, `${path}: ${JSON.stringify(category)}`);
      assert.deepEqual(state(db), before);
    }
    const self = path ? { name: ' Subject ' } : { base_version: 1, candidates: [{ id: 'c1', name: 'Subject' }] };
    const refused = await call(db, path, self); assert.equal(refused.status, 400); assert.equal(refused.body.error, 'subject_not_candidate'); assert.deepEqual(state(db), before);
  }
  const saved = await call(db, '/candidates/c1', { name: 'After', summary: 'After' });
  assert.equal(saved.status, 200); assert.equal(saved.body.version, 1); assert.equal(saved.body.edited, true);
});

test('a current-version snapshot left by an older failed claim is refreshed atomically before a successful text save', async t => {
  const db = fixture(); t.after(() => db.close());
  db.exec(`INSERT INTO competitor_analysis_versions(analysis_id,version,snapshot_json,saved_at) VALUES('a',1,'{"title":"Outdated failed claim"}','old');`);
  const result = await call(db, '', { base_version: 1, title: 'After', output: { notes: 'After' } });
  assert.equal(result.status, 200); assert.equal(result.body.version, 2);
  const kept = JSON.parse(String((db.prepare("SELECT snapshot_json FROM competitor_analysis_versions WHERE analysis_id = 'a' AND version = 1").get() as any).snapshot_json));
  assert.equal(kept.title, 'Before'); assert.equal(kept.output.notes, 'Before'); assert.equal(kept.candidates.length, 2);
});
