/** D957: real Hono routes and node:sqlite, including guarded competing writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { freshDb, makeD1, token, ADMIN, FOUNDER, PARTNER, addPerk } from './_perks_harness.ts';
import { ensureAdminAuditLogTable } from '../src/routes/admin.ts';
import refer from '../src/routes/refer_earn.ts';
import perks from '../src/routes/perks.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { ensureReferralSubmissionsSchema, reviewSubmission, STATUSES, listStrategicAccess, referralWeekly } from '../src/services/referralSubmissions.ts';
import { perkClaimsCounts } from '../src/services/perkClaims.ts';

async function harness() {
  const db = freshDb();
  db.exec("ALTER TABLE users ADD COLUMN referral_code TEXT; ALTER TABLE users ADD COLUMN legacy_referral_code TEXT; UPDATE users SET referral_code='ref_' || id");
  const hooks = { beforeBatch: null as ((db: any) => void) | null };
  const env: any = { JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', ENVIRONMENT: 'development', DB: makeD1(db, hooks) };
  await ensureReferralSubmissionsSchema(env);
  await ensureAdminAuditLogTable(env);
  const app = new Hono().route('/refer', refer).route('/perks', perks);
  app.onError((e, c) => mapError(c as any, e));
  const call = async (path: string, method = 'GET', data?: any, who = ADMIN) => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${await token(who)}`, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const referral = (uid = 'r1', status = 'submitted', date = '2026-10-20 12:00:00', category = 'startup') => {
    db.prepare(`INSERT INTO referral_submissions (uid, referrer_user_id, category, referred_name, status, created_at) VALUES (?, ?, ?, 'Test Referral', ?, ?)`).run(uid, FOUNDER, category, status, date);
  };
  return { db, env, hooks, call, referral };
}

test('strategic queue is exact, oldest first, paged, shared and without email; decisions retain request note and audit actor/note', async () => {
  const h = await harness();
  try {
    h.db.prepare(`INSERT INTO referral_strategic_access(user_id,note,status,created_at) VALUES (?, 'member note', 'requested', '2026-10-01')`).run(FOUNDER);
    h.db.prepare(`INSERT INTO referral_strategic_access(user_id,status,created_at) VALUES (?, 'requested', '2026-10-02')`).run(PARTNER);
    const q = await h.call('/refer/admin/strategic-access?limit=1&offset=1');
    assert.equal(q.status, 200); assert.equal(q.body.total, 2); assert.equal(q.body.items[0].user_id, PARTNER);
    const shared = await listStrategicAccess(h.env, { limit: 1 });
    assert.equal(shared.items[0].user_id, FOUNDER);
    assert.deepEqual(Object.keys(shared.items[0]).sort(), ['decided_at','name','note','requested_at','role','status','user_id']);
    assert.equal((await h.call(`/refer/admin/strategic-access/${FOUNDER}/decision`, 'POST', { decision: 'oops' })).body.error, 'bad_decision');
    const before = await h.call('/refer/overview','GET',undefined,FOUNDER);
    assert.equal(before.body.categories.find((x:any)=>x.key==='strategic').locked,true);
    const grant = await h.call(`/refer/admin/strategic-access/${FOUNDER}/decision`, 'POST', { decision: 'granted', note: 'admin note' });
    const after = await h.call('/refer/overview','GET',undefined,FOUNDER);
    assert.equal(after.body.categories.find((x:any)=>x.key==='strategic').locked,false);
    assert.equal(grant.status, 200); assert.equal(grant.body.status, 'granted'); assert.ok(grant.body.decided_at);
    assert.equal(h.db.prepare('SELECT note FROM referral_strategic_access WHERE user_id=?').get(FOUNDER)?.note, 'member note');
    const again = await h.call(`/refer/admin/strategic-access/${FOUNDER}/decision`, 'POST', { decision: 'declined' });
    assert.equal(again.status, 409); assert.equal(again.body.error, 'already_decided'); assert.match(again.body.message, /granted/);
    assert.equal((await h.call('/refer/admin/strategic-access/9999/decision', 'POST', { decision: 'granted' })).status, 404);
    assert.equal((await h.call(`/refer/admin/strategic-access/${PARTNER}/decision`, 'POST', { decision: 'declined' })).body.status, 'declined');
    const audit = h.db.prepare('SELECT admin_user_id, action, viewed_user_id, filters_json FROM admin_audit_log ORDER BY id').all();
    assert.deepEqual(audit.map((r) => r.action), ['referral_strategic_access.granted', 'referral_strategic_access.declined']);
    assert.equal(audit[0].admin_user_id, ADMIN); assert.equal(audit[0].viewed_user_id, FOUNDER);
    assert.equal(JSON.parse(String(audit[0].filters_json)).note, 'admin note');
    const all = await h.call('/refer/admin/strategic-access?status=all'); assert.equal(all.body.total, 2);
  } finally { h.db.close(); }
});

test('referral list keeps legacy array, binds multi-status filters, pages past 200, sorts oldest and carries referrer id; detail has timeline', async () => {
  const h = await harness();
  try {
    for (let i=0;i<205;i++) h.referral(`r${i}`, i%2 ? 'under_review' : 'submitted');
    h.referral('converted', 'converted');
    const member = await h.call('/refer/submissions','GET',undefined,FOUNDER);
    assert.ok(!('referrer_user_id' in member.body[0]));
    const old = await h.call('/refer/admin/submissions?limit=1'); assert.ok(Array.isArray(old.body)); assert.equal(old.body[0].referrer_user_id, FOUNDER);
    const page = await h.call('/refer/admin/submissions?status=submitted,under_review&limit=200&offset=200&sort=oldest');
    assert.equal(page.body.total, 205); assert.equal(page.body.items.length, 5); assert.equal(page.body.items[0].uid, 'r200');
    assert.equal((await h.call('/refer/admin/submissions?status=converted,reward_eligible,reward_issued&offset=0&limit=1')).body.total, 1);
    h.db.prepare(`INSERT INTO referral_submission_events(submission_id,label,status,note,actor_user_id) SELECT id,'Submitted','submitted','opened',? FROM referral_submissions WHERE uid='r0'`).run(FOUNDER);
    const detail = await h.call('/refer/admin/submissions/r0'); assert.equal(detail.status, 200); assert.equal(detail.body.referrer_user_id, FOUNDER);
    assert.equal(detail.body.history[0].note, 'opened');
    const missing = await h.call('/refer/admin/submissions/missing'); assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'not_found');
    assert.equal((await h.call('/refer/admin/submissions?status=submitted%27%29&offset=0')).status, 400);
  } finally { h.db.close(); }
});

const MOVES: Record<string,string[]> = {
  draft:['submitted','rejected','closed'], submitted:['under_review','more_info_needed','qualified','rejected','closed'],
  under_review:['more_info_needed','qualified','rejected','closed'], more_info_needed:['under_review','qualified','rejected','closed'],
  qualified:['in_conversation','rejected','closed'], in_conversation:['converted','rejected','closed'], converted:['reward_eligible','closed'],
  reward_eligible:['reward_issued','closed'], reward_issued:[],rejected:[],closed:[],
};
test('every referral move is checked; identical-status saves annotate without a status event; a racing change writes no event', async () => {
  const h = await harness();
  try {
    h.referral();
    for (const from of STATUSES) for (const to of STATUSES) {
      h.db.prepare("UPDATE referral_submissions SET status=?, next_step=NULL WHERE uid='r1'").run(from);
      h.db.exec('DELETE FROM referral_submission_events');
      if (to === from || MOVES[from].includes(to)) {
        const row = await reviewSubmission(h.env, 'r1', ADMIN, { status: to, nextStep: 'next' });
        assert.equal(row.status, to); assert.equal(row.next_step, 'next');
        assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM referral_submission_events').get()?.n, to===from ? 0 : 1, `${from} to ${to}`);
      } else {
        await assert.rejects(reviewSubmission(h.env, 'r1', ADMIN, { status: to, nextStep: 'must not save' }), (e: any) => e.code==='bad_transition' && e.httpStatus===409 && e.message.includes(from) && e.message.includes(to));
        assert.equal(h.db.prepare("SELECT status,next_step FROM referral_submissions WHERE uid='r1'").get()?.status, from);
        assert.equal(h.db.prepare("SELECT next_step FROM referral_submissions WHERE uid='r1'").get()?.next_step, null);
        assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM referral_submission_events').get()?.n, 0);
      }
    }
    h.db.exec("UPDATE referral_submissions SET status='submitted'; DELETE FROM referral_submission_events");
    h.hooks.beforeBatch = (db) => db.exec("UPDATE referral_submissions SET status='closed'");
    await assert.rejects(reviewSubmission(h.env,'r1',ADMIN,{status:'under_review'}), (e:any)=>e.code==='bad_transition');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM referral_submission_events').get()?.n, 0);
    const same = await h.call('/refer/admin/submissions/r1','PATCH',{status:'closed',nextStep:'recorded'});
    assert.equal(same.status,200); assert.equal(same.body.next_step,'recorded');
  } finally { h.db.close(); }
});

test('weekly referrals normalize stamps, fill empty Mondays, reject bad weeks and fail instead of fabricating zeros', async () => {
  const h = await harness();
  try {
    h.referral('a','submitted','2026-10-19 00:00:00'); h.referral('b','converted','2026-10-19T12:00:00Z','customer');
    h.referral('old','submitted','2020-01-01');
    const data = await referralWeekly(h.env,4,new Date('2026-10-24T12:00:00Z'));
    assert.equal(data.from,'2026-09-28'); assert.equal(data.items.length,4);
    assert.deepEqual(data.items[0],{week:'2026-09-28',startup:0,customer:0,strategic:0});
    assert.deepEqual(data.items[3],{week:'2026-10-19',startup:1,customer:1,strategic:0});
    assert.equal((await h.call('/refer/admin/submissions/weekly?weeks=5')).body.error,'bad_weeks');
    assert.equal((await h.call('/refer/admin/submissions/weekly?weeks=4')).status,200);
    h.db.exec('DROP TABLE referral_submissions');
    assert.equal((await h.call('/refer/admin/submissions/weekly?weeks=4')).status,500);
  } finally { h.db.close(); }
});

test('perk review state matrix, explicit un-feature and kept notes; live approval edits features only and audits', async () => {
  const h = await harness();
  try {
    addPerk(h.db,'perk',{status:'in_review',featured:1});
    const expected: Record<string,string[]>={approve:['in_review','draft','paused','live'],reject:['in_review','draft'],pause:['live']};
    for (const state of ['in_review','draft','paused','live','rejected']) for (const action of ['approve','reject','pause']) {
      h.db.prepare("UPDATE perks SET status=?,review_note='provenance',featured=1,reviewed_by_user_id=NULL,reviewed_at=NULL,updated_at='2026-10-01' WHERE uid='perk'").run(state);
      const res = await h.call('/perks/admin/perk/review','POST',{action,featured:false,review_note:action==='reject'?'why':''});
      if (!expected[action].includes(state)) { assert.equal(res.status,409,`${state}/${action}`); assert.equal(res.body.error,'not_reviewable'); }
      else {
        assert.equal(res.status,200,`${state}/${action}`);
        const row=h.db.prepare("SELECT * FROM perks WHERE uid='perk'").get()!;
        assert.equal(row.featured,0); assert.equal(row.review_note,action==='reject'?'why':'provenance');
        if (state==='live' && action==='approve') { assert.equal(row.reviewed_at,null); assert.equal(row.reviewed_by_user_id,null); }
      }
    }
    h.db.exec("UPDATE perks SET status='live',featured=1,review_note='keep',updated_at='2026-10-01'");
    assert.equal((await h.call('/perks/admin/perk/review','POST',{action:'approve',review_note:'ignore',editorial_note:'quote'})).status,200);
    const row=h.db.prepare('SELECT * FROM perks').get()!; assert.equal(row.featured,1); assert.equal(row.review_note,'keep'); assert.equal(row.editorial_note,'quote');
    const audits=h.db.prepare('SELECT action,viewed_user_id,filters_json FROM admin_audit_log').all();
    assert.ok(audits.some((x)=>x.action==='perk.approved')); assert.ok(audits.some((x)=>x.action==='perk.rejected')); assert.ok(audits.some((x)=>x.action==='perk.paused'));
    const feature=audits.find((x)=>x.action==='perk.feature_updated')!; assert.equal(feature.viewed_user_id,PARTNER); assert.equal(JSON.parse(String(feature.filters_json)).featured_changed,true);
    assert.equal((await h.call('/perks/admin/perk/review','POST',{action:'bad'})).body.error,'bad_action');
    assert.equal((await h.call('/perks/admin/absent/review','POST',{action:'approve'})).body.error,'not_found');
    assert.equal((await h.call('/perks/admin/perk/review','POST',{action:'reject'})).body.error,'note_required');
  } finally { h.db.close(); }
});

function claim(h:any,uid:string,perk:string,kind:string,date:string,status='issued') {
  h.db.prepare(`INSERT INTO perk_claims (uid,perk_id,user_id,kind_at_claim,status,created_at) SELECT ?,id,?,?,?,? FROM perks WHERE uid=?`).run(uid,FOUNDER,kind,status,date,perk);
}
test('claims totals, ranked listings and zero-filled Monday/kind weeks share one bounded window; listings keep totals and legacy queue',async()=>{
  const h=await harness();
  try {
    addPerk(h.db,'one',{status:'live'}); addPerk(h.db,'two',{status:'paused'}); addPerk(h.db,'three',{status:'rejected'}); addPerk(h.db,'four',{status:'in_review'});
    claim(h,'x','one','credits','2026-10-19 00:00:00','redeemed'); claim(h,'y','two','money','2026-10-20T12:00:00Z');
    // One claim per member/listing: historical and future claims use different listings.
    claim(h,'z','three','tier','2020-01-01'); claim(h,'future','four','tier','2030-01-01');
    const data=await perkClaimsCounts(h.env,4,new Date('2026-10-24T12:00:00Z'));
    assert.deepEqual(data.totals,{claims:2,redeemed:1}); assert.equal(data.from,'2026-09-28'); assert.equal(data.by_week.length,12);
    assert.deepEqual(data.by_week[0],{week:'2026-09-28',kind_at_claim:'credits',claims:0,redeemed:0});
    assert.equal(data.by_listing.length,2); assert.equal(data.by_listing[0].uid,'one'); assert.equal(data.by_listing[0].redeemed,1);
    assert.equal(data.by_week.find(x=>x.week==='2026-10-19'&&x.kind_at_claim==='money')?.claims,1);
    assert.equal((await h.call('/perks/admin/claims?weeks=0')).body.error,'bad_weeks');
    assert.equal((await h.call('/perks/admin/claims?weeks=4')).status,200);
    const page=await h.call('/perks/admin/listings?limit=1&offset=1&sort=oldest'); assert.equal(page.body.total,4); assert.equal(page.body.items.length,1); assert.equal(page.body.items[0].uid,'two'); assert.equal(page.body.items[0].claim_count,1);
    for(const state of ['paused','rejected']) {const x=await h.call(`/perks/admin/listings?status=${state}`);assert.equal(x.body.total,1);assert.equal(x.body.items[0].status,state);}
    const queue=await h.call('/perks/admin/queue'); assert.ok(Array.isArray(queue.body.items)); assert.equal(queue.body.items.length,1);
    h.db.exec('DROP TABLE perk_claims'); assert.equal((await h.call('/perks/admin/claims?weeks=4')).status,500);
  } finally {h.db.close();}
});

test('admin reads refuse members; suspended branches can read but cannot decide strategic access or perks',async()=>{
  const h=await harness();
  try {
    for(const path of ['/refer/admin/submissions','/refer/admin/submissions/weekly','/refer/admin/submissions/x','/refer/admin/strategic-access','/perks/admin/claims','/perks/admin/listings']) assert.equal((await h.call(path,'GET',undefined,FOUNDER)).status,403,path);
    h.db.exec("CREATE TABLE branch_licence(id INTEGER PRIMARY KEY,status TEXT); INSERT INTO branch_licence VALUES(1,'suspended')");
    h.env.BRANCH_CODE='fr'; h.env.APP_URL='https://fr.axal.vc'; h.env.PUBLIC_BASE_URL='https://fr.axal.vc';
    addPerk(h.db,'p',{status:'in_review'});
    const p=await h.call('/perks/admin/p/review','POST',{action:'approve'}); assert.equal(p.status,423); assert.equal(p.body.code,'branch_suspended');
    const s=await h.call(`/refer/admin/strategic-access/${FOUNDER}/decision`,'POST',{decision:'granted'}); assert.equal(s.status,423);
    assert.equal((await h.call('/perks/admin/listings')).status,200);
    assert.equal(h.db.prepare("SELECT status FROM perks WHERE uid='p'").get()?.status,'in_review');
  } finally {h.db.close();}
});


test('perk and strategic decisions refuse a competing decision without an audit or overwrite', async()=>{
  const h=await harness();
  try {
    addPerk(h.db,'race',{status:'in_review'});
    h.db.prepare("INSERT INTO referral_strategic_access(user_id,status) VALUES (?,'requested')").run(FOUNDER);
    const prepare=h.env.DB.prepare.bind(h.env.DB);
    let races=0;
    h.env.DB.prepare=(sql:string)=>{
      const stmt=prepare(sql), run=stmt.run;
      if(sql.startsWith('UPDATE perks SET status')) stmt.run=async()=>{
        races++; h.db.exec("UPDATE perks SET status='rejected', review_note='other reviewer' WHERE uid='race'"); return run();
      };
      if(sql.startsWith('UPDATE referral_strategic_access SET status')) stmt.run=async()=>{
        races++; h.db.prepare("UPDATE referral_strategic_access SET status='declined' WHERE user_id=?").run(FOUNDER); return run();
      };
      return stmt;
    };
    const p=await h.call('/perks/admin/race/review','POST',{action:'approve'});
    assert.equal(p.status,409); assert.equal(p.body.error,'not_reviewable');
    assert.equal(h.db.prepare("SELECT review_note FROM perks WHERE uid='race'").get()?.review_note,'other reviewer');
    const s=await h.call(`/refer/admin/strategic-access/${FOUNDER}/decision`,'POST',{decision:'granted'});
    assert.equal(s.status,409); assert.equal(s.body.error,'already_decided'); assert.equal(races,2);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()?.n,0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()?.n,0);
  }finally{h.db.close();}
});
