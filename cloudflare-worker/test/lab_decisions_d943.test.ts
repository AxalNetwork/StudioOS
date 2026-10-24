import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import admin from '../src/routes/admin.ts';
import cohort from '../src/routes/admin_cohort.ts';
import { adminLabHosts } from '../src/routes/lab_hosts.ts';
import { AUTH_ERROR_STATUSES, branchSuspendedBody } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const KEY = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
globalThis.fetch = async () => new Response('Providers are stubbed', { status: 599 });
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(baseline);
  db.exec(readFileSync(new URL('../sql/migrations/313_lab_host_applications.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../sql/migrations/316_spinout_application_interviews.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../sql/migrations/256_branch_local_copies.sql', import.meta.url), 'utf8'));
  for (const [id, role] of [[1, 'admin'], [2, 'founder'], [3, 'founder']] as const) {
    db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,1)').run(id, role, 'Synthetic', `synthetic${id}@example.test`);
  }
  db.prepare("INSERT INTO cohort_cycles(id,year,month,start_at,end_at,app_status) VALUES(1,2035,1,'2035-01-01 05:00:00','2035-02-01 05:00:00','open')").run();
  for (const [id, user] of [[1, 2], [2, 3]]) {
    db.prepare("INSERT INTO spinout_applications(id,user_id,company_name,idea) VALUES(?,?,'Synthetic','Synthetic')").run(id,user);
    db.prepare('INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id) VALUES(?,?,?,1)').run(id,id,user);
  }
  db.exec("INSERT INTO cohort_settings(key,value) VALUES('max_cohort_size','1')");
  const env: any = { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'test' };
  return { db, env };
}
const app = new Hono<any>();
app.route('/api/admin/cohort', cohort);
app.route('/api/admin/lab-hosts', adminLabHosts);
app.route('/api/admin', admin);
app.onError((e: any,c) => {
  const status = AUTH_ERROR_STATUSES[e.message];
  return status === 423 ? c.json(branchSuspendedBody(e),423) : c.json({ error: status ? e.message : 'Request failed' }, status || 500);
});
async function post(w: any, path: string, body: unknown, who: number | null = 1) {
  const jwt = who ? await new SignJWT({ user_id: who, role: who === 1 ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY)) : null;
  const res = await app.request(path, { method: 'POST', headers: { 'Content-Type':'application/json', ...(jwt ? { Authorization:`Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }, w.env);
  return { status: res.status, body: await res.json() as any };
}
const cyclePath = (id = 1) => `/api/admin/cohort/applications/${id}/decide`;
const legacyPath = (id = 1) => `/api/admin/spinout-applications/${id}/decide`;
function rows(w: any) {
  return JSON.stringify(Object.fromEntries(['cohort_applicants','spinout_applications','cohort_cycle_events','user_spinout_flags','company_week_status','stage_transition_log','lab_host_applications'].map(t => [t,w.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()])));
}

test('D943: both doors require a reason and make the same scheduled decision', async () => {
  for (const [status, decision] of [['approved','accepted'],['rejected','refused']] as const) {
    const results = [];
    for (const legacy of [false,true]) {
      const w = world();
      try {
        const path = legacy ? legacyPath() : cyclePath();
        const payload = legacy ? { decision } : { status };
        const before = rows(w);
        assert.equal((await post(w,path,payload)).status,400);
        assert.equal(rows(w),before);
        const r = await post(w,path,{ ...payload,reason:'Synthetic review' });
        assert.equal(r.status,200,JSON.stringify(r));
        assert.equal(r.body.status,legacy?decision:status);
        if (legacy) assert.equal(r.body.cohort,status==='approved'?'January 2035':null);
        const applicant = w.db.prepare('SELECT status,decision_reason,decided_by FROM cohort_applicants WHERE id=1').get();
        assert.equal(applicant.status,status);
        assert.equal(applicant.decision_reason,'Synthetic review');
        assert.equal(applicant.decided_by,'admin:1');
        const user = w.db.prepare('SELECT spinout_lab_active,spinout_lab_started_at FROM users WHERE id=2').get();
        assert.equal(Number(user.spinout_lab_active ?? 0),0,'decision cannot start the workspace early');
        assert.equal(user.spinout_lab_started_at,null);
        assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM user_spinout_flags WHERE spinout_lab_admitted=1').get().n,0);
        results.push({ ...applicant, legacy:w.db.prepare('SELECT status FROM spinout_applications WHERE id=1').get().status });
      } finally { w.db.close(); }
    }
    assert.deepEqual(results[0],results[1]);
  }
});

test('D943: legacy requires a real current cohort and rejects a free-text cohort label', async () => {
  const w = world();
  try {
    assert.equal((await post(w,legacyPath(),{ decision:'accepted', reason:'Synthetic', cohort:'Cohort 99' })).status,400);
    w.db.exec('DELETE FROM cohort_applicants');
    const before = rows(w);
    const r = await post(w,legacyPath(),{ decision:'accepted', reason:'Synthetic' });
    assert.equal(r.status,400);assert.equal(r.body.error,'cohort_required');assert.equal(rows(w),before);
    assert.equal((await post(w,legacyPath(999),{ decision:'accepted', reason:'Synthetic' })).status,404);
  } finally { w.db.close(); }
});

test('D943: places require the boolean confirmation, counted across approved and activated applicants', async () => {
  for (const held of ['approved','activated']) {
    const w = world();
    try {
      w.db.prepare('UPDATE cohort_applicants SET status=? WHERE id=2').run(held);
      for (const path of [cyclePath(),legacyPath()]) {
        for (const confirm_over_places of [undefined,false,'true',1]) {
          const before = rows(w);
          const r = await post(w,path,{ status:'approved',decision:'accepted',reason:'Synthetic',confirm_over_places });
          assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.error,'over_places');assert.equal(rows(w),before);
        }
      }
      const r = await post(w,legacyPath(),{ decision:'accepted',reason:'Synthetic',confirm_over_places:true });
      assert.equal(r.status,200,JSON.stringify(r));
      const audit = w.db.prepare('SELECT event_type,details,actor FROM cohort_cycle_events').get();
      assert.equal(audit.event_type,'applicant_approved');assert.match(audit.details,/confirm_over_places=true/);assert.equal(audit.actor,'admin:1');
      assert.equal((await post(w,cyclePath(),{ status:'approved',reason:'Synthetic again' })).status,200,'already approved consumes no new place');
    } finally { w.db.close(); }
  }
});

test('D943: simultaneous approvals cannot both take the final place', async () => {
  const w = world();
  try {
    const r = await Promise.all([post(w,legacyPath(),{ decision:'accepted',reason:'Synthetic' }),post(w,cyclePath(2),{ status:'approved',reason:'Synthetic' })]);
    assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM cohort_applicants WHERE status='approved'").get().n,1);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM cohort_cycle_events').get().n,1);
  } finally { w.db.close(); }
});

test('D943: terminal applicants and changed admin roles cannot be approved through either door', async () => {
  const w = world();
  try {
    for (const status of ['activated','rolled_forward','withdrawn']) {
      w.db.prepare('UPDATE cohort_applicants SET status=? WHERE id=1').run(status);
      const before = rows(w);
      for (const path of [cyclePath(),legacyPath()]) {
        assert.equal((await post(w,path,{ status:'approved',decision:'accepted',reason:'Synthetic',confirm_over_places:true })).status,409);
        assert.equal(rows(w),before);
      }
    }
    w.db.exec("UPDATE cohort_applicants SET status='pending' WHERE id=1; UPDATE users SET role='admin' WHERE id=2");
    for (const path of [cyclePath(),legacyPath()]) {
      assert.equal((await post(w,path,{ status:'approved',decision:'accepted',reason:'Synthetic' })).status,400);
    }
    assert.equal((await post(w,legacyPath(),{ decision:'refused',reason:'Synthetic' })).status,200);
  } finally { w.db.close(); }
});

test('D943: two decisions on the same previously read applicant save only one verdict', async () => {
  const w = world();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = w.env.DB;
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve,reject) => { release=resolve;timer=setTimeout(()=>reject(new Error('Synthetic barrier timed out')),30000); });
    w.env.DB = { ...db, prepare(sql: string) {
      const st = db.prepare(sql);
      if (sql.startsWith('SELECT ca.*')) {
        const first = st.first.bind(st);
        st.first = async () => { const row = await first();if(++arrived===2){clearTimeout(timer);release();}await barrier;return row; };
      }
      return st;
    } };
    const results = await Promise.all([post(w,cyclePath(),{ status:'approved',reason:'Synthetic' }),post(w,legacyPath(),{ decision:'refused',reason:'Synthetic' })]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal(results.find(r=>r.status===409)?.body.error,'decision_conflict');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM cohort_cycle_events').get().n,1);
    const status = w.db.prepare('SELECT status FROM cohort_applicants WHERE id=1').get().status;
    assert.equal(w.db.prepare('SELECT status FROM spinout_applications WHERE id=1').get().status,status==='approved'?'pending':'refused');
  } finally { clearTimeout(timer);w.db.close(); }
});

test('D943: legacy resolves the latest assigned cycle; other cycles do not consume its places', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_applicants SET status='rolled_forward' WHERE id=1; UPDATE cohort_applicants SET status='approved' WHERE id=2");
    w.db.exec("INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES(2,2035,2,'2035-02-01 05:00:00','2035-03-01 05:00:00')");
    w.db.exec('INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id) VALUES(3,1,2,2)');
    assert.equal((await post(w,legacyPath(),{ decision:'accepted',reason:'Synthetic' })).status,200);
    assert.equal(w.db.prepare('SELECT status FROM cohort_applicants WHERE id=1').get().status,'rolled_forward');
    assert.equal(w.db.prepare('SELECT status FROM cohort_applicants WHERE id=3').get().status,'approved');
    assert.equal(w.db.prepare('SELECT cohort_cycle_id FROM cohort_cycle_events').get().cohort_cycle_id,2);
  } finally { w.db.close(); }
});

test('D943: full and zero-place cohorts still allow rejection or waitlisting', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_settings SET value='0' WHERE key='max_cohort_size'");
    assert.equal((await post(w,cyclePath(),{ status:'approved',reason:'Synthetic' })).body.error,'over_places');
    assert.equal((await post(w,cyclePath(),{ status:'waitlisted',reason:'Synthetic' })).status,200);
    assert.equal((await post(w,legacyPath(),{ decision:'refused',reason:'Synthetic' })).status,200);
    assert.equal(w.db.prepare('SELECT status FROM spinout_applications WHERE id=1').get().status,'refused');
  } finally { w.db.close(); }
});

test('D943: unreadable settings and failed audit writes leave the decision unchanged', async () => {
  const w = world();
  try {
    const db = w.env.DB;
    w.env.DB = { ...db, prepare(sql: string) { if(sql.startsWith('SELECT key, value FROM cohort_settings')) throw new Error('Synthetic unreadable settings'); return db.prepare(sql); } };
    const before = rows(w);
    for (const path of [cyclePath(),legacyPath()]) {
      const r = await post(w,path,{ status:'approved',decision:'accepted',reason:'Synthetic',confirm_over_places:true });
      assert.equal(r.status,503);assert.equal(r.body.error,'cohort_settings_unreadable');assert.equal(rows(w),before);
    }
    w.env.DB = { ...db, prepare(sql: string) { return db.prepare(sql.startsWith('INSERT INTO cohort_cycle_events') ? 'INSERT INTO missing_d943 VALUES(1)' : sql); } };
    const r = await post(w,cyclePath(),{ status:'approved',reason:'Synthetic' });
    assert.equal(r.status,500);
    assert.equal(w.db.prepare('SELECT status FROM cohort_applicants WHERE id=1').get().status,'pending');
    assert.equal(rows(w),before);
  } finally { w.db.close(); }
});

const writes = [
  ['/api/admin/cohort/grace',{user_id:2,cycle_id:1,week:1,hours:2,reason:'Synthetic'}],
  ['/api/admin/cohort/override',{user_id:2,cycle_id:1,week:1,decision:'pass',reason:'Synthetic'}],
  ['/api/admin/cohort/applications/settings',{max_cohort_size:2}],
  ['/api/admin/cohort/applications/cycles/1/force-proceed',{reason:'Synthetic'}],
  [cyclePath(),{status:'approved',reason:'Synthetic'}],
  [legacyPath(),{decision:'accepted',reason:'Synthetic'}],
  ['/api/admin/cohort/applications/1/interview',{scheduled_at:'2035-01-02T12:00:00Z'}],
  ['/api/admin/cohort/applications/1/interview/cancel',{}],
  ['/api/admin/lab-hosts/synthetic-host/decision',{decision:'approve'}],
  ['/api/admin/lab-hosts/synthetic-host/decision',{decision:'reject'}],
  ['/api/admin/lab-hosts/synthetic-host/decision',{decision:'revoke'}],
] as const;
for (const [path,body] of writes) test(`D943: ${path}${'decision' in body ? ' · '+body.decision : ''} freezes after authentication and works on an active branch`, async () => {
  const w = world();
  try {
    w.db.exec("INSERT INTO branch_licence(id,licence_uid,territory,status,pushed_at) VALUES(1,'synthetic','Synthetic','suspended',datetime('now'))");
    w.db.prepare("INSERT INTO lab_host_applications(uid,user_id,host_kind,host_id,capacity,status) VALUES('synthetic-host',2,'partner',20,'partner',?)").run('decision' in body && body.decision==='revoke'?'approved':'pending');
    w.db.exec("INSERT INTO spinout_application_interviews(application_id,user_id,scheduled_at,scheduled_by) VALUES(1,2,'2035-01-02 12:00:00',1)");
    w.env.BRANCH_CODE='fr';w.env.APP_URL='https://fr.axal.vc';w.env.PUBLIC_BASE_URL='https://fr.axal.vc';
    const before = rows(w);
    assert.equal((await post(w,path,body,null)).status,401);
    assert.equal((await post(w,path,body,2)).status,403);
    const frozen = await post(w,path,body);
    assert.equal(frozen.status,423,JSON.stringify(frozen));assert.equal(rows(w),before);
    w.db.exec("UPDATE branch_licence SET status='active'");
    const active = await post(w,path,body);
    assert.ok(active.status>=200 && active.status<300,JSON.stringify(active));
  } finally { w.db.close(); }
});
