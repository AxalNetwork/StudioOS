/** D1102: real SQLite and mounted routes; all people and files are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import room from '../src/routes/data_room.ts';
import activity from '../src/routes/activity.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom } from './_baseline.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';

const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const migration = (name: string) => readFileSync('cloudflare-worker/sql/migrations/' + name, 'utf8');
const app = new Hono<any>(); app.route('/api/data-room', room); app.route('/api/activity', activity); app.route('/api/cycles', cycleRecords);
app.onError((e, c) => {
  if (e.message === 'Unauthorized') return c.json({ error: 'unauthorized' }, 401);
  if (e.message === 'Admin required') return c.json({ error: 'admin_required' }, 403);
  throw e;
});
const roles: Record<number, string> = { 1: 'founder', 2: 'investor', 3: 'founder', 4: 'partner', 900: 'admin' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users','projects','company_profiles','user_company_links','data_room_files','data_room_folders','data_room_grants','data_room_access_log','raise_prospects','pairwise_ndas','activity_logs','admin_audit_log','dd_cases','dd_requests','project_members']) {
    db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  }
  db.exec(migration('594_data_room_grant_folders.sql'));
  addColumnsFrom(db, migration('442_raise_cycle_stores.sql'), 'data_room_files');
  addColumnsFrom(db, migration('463_raise_record_stores.sql'), 'data_room_files');
  db.exec(stripForeignKeys(tableFromBaseline(migration('463_raise_record_stores.sql'), 'data_room_file_versions')));
  db.exec(stripForeignKeys(tableFromBaseline(migration('401_lab_report_shares.sql'), 'lab_report_shares')));
  for (const [id, role] of Object.entries(roles)) db.prepare('INSERT INTO users (id,role,name,email,password_hash,founder_id,is_active) VALUES (?,?,?,?,?,?,1)')
    .run(Number(id), role, 'Synthetic member ' + id, `synthetic-${id}@example.test`, 'synthetic-hash', id === '1' ? 11 : id === '3' ? 33 : 11);
  db.exec(`INSERT INTO projects (id,uid,name,founder_id) VALUES (1,'room-one','Synthetic venture',11),(2,'room-two','Other venture',33);
    INSERT INTO data_room_folders (id,uid,project_id,name) VALUES (1,'folder-one',1,'Private folder'),(2,'folder-two',2,'Other private folder');
    INSERT INTO data_room_files (id,uid,project_id,folder_id,name,r2_key,visibility,checklist_item) VALUES
      (1,'file-one',1,1,'Private strategy.pdf','synthetic/one','nda','incorporation'),
      (2,'file-two',1,1,'Private model.xlsx','synthetic/two','open','incorporation'),
      (3,'file-other',2,2,'Other private file','synthetic/other','nda','incorporation'),
      (4,'file-three',1,1,'Private plan.pdf','synthetic/three','nda',NULL);
    INSERT INTO data_room_grants (id,uid,project_id,investor_user_id,granted_by_user_id,status,expires_at) VALUES
      (1,'grant-one',1,2,1,'active',NULL),(2,'grant-expired',1,3,1,'active','2000-01-01'),
      (3,'grant-revoked',1,4,1,'revoked',NULL),(4,'legacy-admin-grant',1,900,1,'active',NULL),
      (5,'other-grant',2,2,3,'active',NULL);
    INSERT INTO project_members (project_id,user_id,role,status) VALUES (1,900,'cofounder','accepted');
    INSERT INTO pairwise_ndas (party_a_user_id,party_b_user_id,status) VALUES (1,2,'active');`);
  const storage = { puts: 0, deletes: 0 };
  const binding = d1Over(db); const statements: string[] = [];
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: { ...binding,
    prepare(sql: string) { statements.push(sql); return binding.prepare(sql); },
  }, FILES: { async put() { storage.puts++; }, async delete() { storage.deletes++; } } };
  const call = async (method: string, path: string, body?: unknown, who: number | null = 900) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who) headers.Authorization = `Bearer ${await token(who, roles[who])}`;
    const r = await app.request(path.startsWith('/api/') ? path : '/api/data-room' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  };
  return { db, env, call, storage, statements };
}

test('admin summary contains scoped counts and recorded coverage, no private rows or names', async () => {
  const f = fixture(); try {
    const r = await f.call('GET', '/room-one'); assert.equal(r.status, 200);
    assert.equal(r.body.mode, 'summary'); assert.equal(r.body.read_only, true);
    assert.deepEqual(r.body.files, { available: true, total: 3, open: 1, nda: 2, other_gates: 0 });
    assert.deepEqual(r.body.folders, { available: true, total: 1 });
    assert.equal(r.body.coverage.covered_items, 1); assert.equal(r.body.coverage.matched_files, 2);
    assert.deepEqual(r.body.grants, { available: true, total: 4, active: 2, expired: 1, revoked: 1, unknown: 0 });
    assert.doesNotMatch(JSON.stringify(r.body), /Private|private|@|grant-one|file-one|folder-one|recent_access|investor_user_id|r2_key/);
    assert.equal(activityCount(f.db), 0);
  } finally { f.db.close(); }
});

for (const table of ['data_room_files', 'data_room_folders', 'data_room_grants']) test(`summary ${table} failure stays unavailable in its own block`, async () => {
  const f = fixture(); try {
    f.db.exec('DROP TABLE ' + table);
    const r = await f.call('GET', '/room-one'); assert.equal(r.status, 200);
    const key = ({ data_room_files: 'files', data_room_folders: 'folders', data_room_grants: 'grants' } as any)[table];
    assert.equal(r.body[key].available, false); assert.equal(r.body[key].total, undefined);
    assert.match(r.body[key].reason, /could not be read/);
    const other = key === 'files' ? 'folders' : 'files'; assert.equal(r.body[other].available, true);
    if (key === 'files') assert.equal(r.body.coverage.available, false);
  } finally { f.db.close(); }
});

test('every founder write refuses admins, including admins with a residual founder id, with no DB or storage changes', async () => {
  const f = fixture(); try {
    const before = snapshot(f.db);
    for (const [method, path, body] of [
      ['POST','/room-one/folders',{ name: 'Attempt' }], ['PATCH','/room-one/folders/folder-one',{ name: 'Attempt', visibility: 'open', apply_to_contents: true }],
      ['DELETE','/room-one/folders/folder-one',undefined], ['POST','/room-one/files',{ name: 'Attempt', data: 'data:text/plain;base64,eA==' }],
      ['PATCH','/room-one/files/file-one',{ visibility: 'open' }], ['DELETE','/room-one/files/file-one',undefined],
      ['POST','/room-one/grants',{ email: 'synthetic-3@example.test' }], ['PATCH','/room-one/grants/grant-one',{folders:null}],
      ['POST','/room-one/files/file-one/versions/1/current',undefined],
      ['POST','/room-one/files/file-one/download',undefined],
      ['POST','/room-one/files/file-one/versions/1/download',undefined], ['DELETE','/room-one/grants/grant-one',undefined],
    ] as const) {
      f.statements.length=0;
      assert.equal((await f.call(method, path, body)).status, 404, method + ' ' + path);
      assert.ok(!f.statements.some(sql=>/FROM data_room_(files|file_versions)/.test(sql)), 'admin refusal precedes private file reads');
      assert.deepEqual(snapshot(f.db), before);
    }
    assert.deepEqual(f.storage, { puts: 0, deletes: 0 });
    delete f.env.FILES;
    assert.equal((await f.call('POST','/room-one/files',{})).status,404);
  } finally { f.db.close(); }
});

test('legacy admin grants cannot bypass the reasoned support path', async () => {
  const f = fixture(); try {
    for (const [method, path] of [['GET','/shared'],['GET','/shared/room-one'],['POST','/shared/room-one/files/file-one/download']]) {
      const r = await f.call(method, path); assert.equal(r.status, 403); assert.equal(r.body.error, 'support_read_required');
      assert.doesNotMatch(JSON.stringify(r.body), /Private|@|file-one|synthetic\/one/);
    }
    assert.equal((await f.call('GET','/shared/room-one', undefined, 2)).status, 200);
  } finally { f.db.close(); }
});

test('owner reads stay detailed, and another founder or converted role cannot use them', async () => {
  const f = fixture(); try {
    const r = await f.call('GET','/room-one', undefined, 1); assert.equal(r.status, 200);
    assert.equal(r.body.files.length, 3); assert.equal(r.body.files[0].name, 'Private model.xlsx');
    for (const who of [3,4]) assert.equal((await f.call('GET','/room-one', undefined, who)).status, 404);
    assert.equal((await f.call('GET','/room-one', undefined, null)).status, 401);
  } finally { f.db.close(); }
});

test('support requires admin and a bounded reason before it reads or writes anything private', async () => {
  const f = fixture(); try {
    for (const reason of [undefined, null, '', '  ', 1, 'x'.repeat(501)]) {
      const r = await f.call('POST','/room-one/support-read',{ reason }); assert.equal(r.status, 400);
      assert.equal(r.body.error, 'support_reason_required'); assert.equal(activityCount(f.db), 0);
    }
    assert.equal((await f.call('POST','/room-one/support-read',{ reason:'Support' },1)).status,403);
    assert.equal((await f.call('POST','/room-one/support-read',{ reason:'Support' },null)).status,401);
  } finally { f.db.close(); }
});

test('support read records the actor and exact reason for the founder and HQ; it grants no write access', async () => {
  const f = fixture(); try {
    const reason = "Investigate checklist mapping; literal ' and ? are data.";
    const r = await f.call('POST','/room-one/support-read',{ reason }); assert.equal(r.status,200);
    assert.equal(r.body.mode,'support'); assert.equal(r.body.role,'support'); assert.equal(r.body.read_only,true); assert.equal(r.body.files.length,3);
    const audit = f.db.prepare("SELECT * FROM activity_logs WHERE user_id=1 AND action='data_room_support_read'").get() as any;
    assert.ok(audit); assert.equal(audit.project_id,1); assert.equal(audit.actor,'user:900');
    assert.deepEqual(JSON.parse(audit.details),{ admin_user_id:900, reason, read_only:true });
    const visible = await f.call('GET','/api/activity',undefined,1);
    assert.equal(visible.body.items.filter((x:any)=>x.action==='data_room_support_read').length,1);
    assert.equal(JSON.parse(visible.body.items[0].details).reason,reason);
    const hq = f.db.prepare("SELECT * FROM admin_audit_log WHERE action='data_room_support_read'").get() as any;
    assert.ok(hq); assert.equal(hq.admin_user_id,900); assert.equal(hq.viewed_user_id,1); assert.equal(JSON.parse(hq.filters_json).reason,reason);
    assert.equal((await f.call('PATCH','/room-one/files/file-one',{ visibility:'open' })).status,404);
    assert.equal((f.db.prepare('SELECT visibility FROM data_room_files WHERE id=1').get() as any).visibility,'nda');
  } finally { f.db.close(); }
});

test('failed founder audit refuses support before loading private file details', async () => {
  const f = fixture(); try {
    f.db.exec('DROP TABLE activity_logs'); f.statements.length=0;
    const r = await f.call('POST','/room-one/support-read',{reason:'Investigate unavailable room'});
    assert.equal(r.status,503); assert.equal(r.body.error,'support_read_unavailable');
    assert.doesNotMatch(JSON.stringify(r.body),/Private|@|no such table|activity_logs/);
    assert.ok(!f.statements.some(sql=>/FROM data_room_(files|folders|grants)/.test(sql)));
  } finally { f.db.close(); }
});

test('a failed or zero-row audit result cannot open support details', async () => {
  for (const result of [{ success:false, meta:{changes:1} }, { success:true, meta:{changes:0} }]) {
    const f=fixture(); try {
      const db=f.env.DB;
      f.env.DB={...db,prepare(sql:string) {
        if (sql.includes('INSERT INTO activity_logs')) {
          const st={bind(..._values:unknown[]){return st;},async run(){return result;}}; return st;
        }
        return db.prepare(sql);
      }};
      const r=await f.call('POST','/room-one/support-read',{reason:'Investigate access'});
      assert.equal(r.status,503); assert.equal(r.body.error,'support_read_unavailable');
      assert.ok(!f.statements.some(sql=>/FROM data_room_(files|folders|grants)/.test(sql)));
    } finally { f.db.close(); }
  }
});

test('failed or malformed summary result is unreadable rather than a plausible zero', async () => {
  for (const result of [{success:false,results:[]},{success:true,results:[{visibility:'nda',checklist_item:null,n:-1}]},{success:true,results:[{visibility:'nda',checklist_item:null,n:'2'}]}]) {
    const f=fixture(); try {
      const db=f.env.DB;
      f.env.DB={...db,prepare(sql:string) {
        if (sql.startsWith('SELECT visibility, checklist_item')) {
          const st={bind(..._values:unknown[]){return st;},async all(){return result;}}; return st;
        }
        return db.prepare(sql);
      }};
      const r=await f.call('GET','/room-one'); assert.equal(r.status,200);
      assert.equal(r.body.files.available,false); assert.equal(r.body.files.total,undefined);
      assert.equal(r.body.coverage.available,false); assert.equal(r.body.folders.available,true);
    } finally { f.db.close(); }
  }
});

test('support refuses an absent or ambiguous owner instead of making an invisible audit row', async () => {
  const f=fixture(); try {
    f.db.exec("UPDATE users SET role='investor' WHERE id=1");
    assert.equal((await f.call('POST','/room-one/support-read',{reason:'Investigate room'})).status,409);
    f.db.exec("UPDATE users SET role='founder' WHERE id IN (1,4)");
    assert.equal((await f.call('POST','/room-one/support-read',{reason:'Investigate room'})).status,409);
    assert.equal(activityCount(f.db),0);
  } finally { f.db.close(); }
});

test('an unreadable owner query cannot be treated as one confirmed owner', async () => {
  const f=fixture(); try {
    const db=f.env.DB;
    f.env.DB={...db,prepare(sql:string) {
      if (sql.startsWith('SELECT id FROM users WHERE founder_id')) {
        const st={bind(..._values:unknown[]){return st;},async all(){return {success:false,results:[{id:1}]};}}; return st;
      }
      return db.prepare(sql);
    }};
    const r=await f.call('POST','/room-one/support-read',{reason:'Investigate room'});
    assert.equal(r.status,503); assert.equal(activityCount(f.db),0);
    assert.ok(!f.statements.some(sql=>/FROM data_room_(files|folders|grants)/.test(sql)));
  } finally { f.db.close(); }
});

test('owner uploads default to NDA, while an explicit Open remains an intentional choice', async () => {
  const f=fixture(); try {
    for (const [visibility,expected] of [[undefined,'nda'],['open','open'],['nda','nda']]) {
      const r=await f.call('POST','/room-one/files',{name:'Synthetic upload',data:'data:text/plain;base64,eA==',...(visibility===undefined?{}:{visibility})},1);
      assert.equal(r.status,201); const row=f.db.prepare('SELECT visibility FROM data_room_files WHERE uid=?').get(r.body.uid) as any;
      assert.equal(row.visibility,expected);
    }
  } finally { f.db.close(); }
});

function activityCount(db:DatabaseSync) { return Number((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n); }
function snapshot(db:DatabaseSync) {
  return { files: db.prepare('SELECT * FROM data_room_files ORDER BY id').all(),
    folders: db.prepare('SELECT * FROM data_room_folders ORDER BY id').all(), grants: db.prepare('SELECT * FROM data_room_grants ORDER BY id').all(),
    logs: db.prepare('SELECT * FROM activity_logs ORDER BY id').all() };
}

test('shared data-room records, activity, form options and actions use the same owner-only gate', async () => {
  const f=fixture(); try {
    const base='/api/cycles/raise/modules/data-room';
    const before=snapshot(f.db);
    for (const [method,path] of [
      ['GET',base+'/records/1?project=1'],['GET',base+'/records/1/activity?project=1'],['GET',base+'/form-options?project=1'],
      ['POST',base+'/records/1/actions/remove?project=1'],['POST',base+'/records/1/actions/replace?project=1'],
      ['PATCH',base+'/records/1?project=1'],['DELETE',base+'/records/1?project=1'],
    ]) {
      assert.equal((await f.call(method,path,method==='GET'?undefined:{reason:'Support reason is not write authority'})).status,403,method+' '+path);
      assert.deepEqual(snapshot(f.db),before);
    }
    const owner=await f.call('GET',base+'/records/1?project=1',undefined,1);
    assert.equal(owner.status,200);assert.equal(owner.body.title,'Private strategy.pdf');
    assert.equal((await f.call('GET',base+'/records/1?project=1',undefined,3)).status,403);
  } finally { f.db.close(); }
});
