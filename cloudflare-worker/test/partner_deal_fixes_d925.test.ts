/** D925 (#2721): real SQL, atomic D1 batches, injected I/O failures and races. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import adminPartners from '../src/routes/admin_partners.ts';
import { activatePartnerDealOnSignature, expirePartnerDeals } from '../src/services/partnerDeals.ts';
import { ensureInvestorPaywallSchema } from '../src/middleware/requireInvestorTier.ts';
import { createAndSendEnvelope } from '../src/routes/esign.ts';
import { AUTH_ERROR_STATUSES, branchSuspendedBody } from '../src/util/authErrors.ts';
import { BRANCH_SUSPENDED } from '../src/util/branch.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { ADMIN, SENDER, freshDb, envFor, token, call as esignCall } from './_esign_harness.ts';

const app = new Hono<any>();
app.route('/api/admin/partners', adminPartners);
app.onError((err, c) => {
  const status = AUTH_ERROR_STATUSES[err.message];
  if (status) return c.json(err.message === BRANCH_SUSPENDED ? branchSuspendedBody(err) : { detail: err.message }, status);
  return c.json({ error: 'unexpected test failure' }, 500);
});

async function fixture() {
  const db = freshDb();
  db.exec(readFileSync('cloudflare-worker/sql/migrations/028_partner_deals.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/548_partner_deal_activation_error.sql', 'utf8'));
  db.exec(`ALTER TABLE users ADD COLUMN subscription_tier TEXT DEFAULT 'free';
    ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'active';
    ALTER TABLE users ADD COLUMN subscription_renews_at TEXT;
    ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
    CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT, suspended_at TEXT, suspended_note TEXT);
    INSERT INTO branch_licence VALUES (1, 'active', NULL, NULL);`);
  const env: any = { ...envFor(db), DB: d1Over(db) };
  await ensureInvestorPaywallSchema(env);
  // The real envelope creator applies the production e-sign schema too.
  const envelope = await createAndSendEnvelope(env, { documentType: 'founder_nda_v1', recipientEmail: 'sender@example.test', recipientName: 'Sam Sender', adminUserId: ADMIN, adminName: 'Ada Admin', recipientUserId: SENDER, appUrl: 'https://app.example.test', renderedBody: { title: 'Synthetic agreement', body: 'Synthetic test agreement.' } } as any);
  assert.ok(envelope, 'fixture envelope was created');
  db.prepare("UPDATE esign_envelopes SET status = 'completed' WHERE id = ?").run(envelope!.envelope_id);
  db.prepare(`INSERT INTO partner_invitations (id,token,recipient_email,recipient_name,invited_by_user_id,expires_at,status)
    VALUES (1,'fixture-invitation','sender@example.test','Sam Sender',?,?,'finalized')`).run(ADMIN, new Date(Date.now() + 86400000).toISOString());
  db.prepare(`INSERT INTO partner_deals (id,invitation_id,user_id,deal_type,proposal_json,granted_tier_founder,granted_tier_investor,envelope_id,status)
    VALUES (7,1,?,'services_partnership','{}','founder_pro','professional',?,'awaiting_signature')`).run(SENDER,envelope!.envelope_id);
  const call = async (path: string, body: any = {}, who: number | null = ADMIN, method = 'POST') => {
    const headers: Record<string,string> = { 'Content-Type':'application/json' };
    if (who) headers.Authorization = `Bearer ${await token(who, who === ADMIN ? 'admin' : 'founder')}`;
    const r = await app.request(`/api/admin/partners${path}`, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }, env);
    return { status:r.status, body:await r.json() as any };
  };
  const row = () => db.prepare('SELECT * FROM partner_deals WHERE id=7').get() as any;
  const user = (id = SENDER) => db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
  return { db, env, call, row, user, envelope: envelope! };
}

/** Fail the selected SQL once or repeatedly without replacing query semantics. */
function failSQL(env: any, pattern: RegExp, method = 'run', once = false) {
  const original = env.DB;
  let fired = false;
  env.DB = { ...original, prepare(sql: string) {
    const st = original.prepare(sql);
    const run = st[method].bind(st);
    st[method] = async (...args: any[]) => {
      if (pattern.test(sql) && (!once || !fired)) { fired = true; throw new Error('synthetic injected database failure'); }
      return run(...args);
    };
    return st;
  } };
  return () => { env.DB = original; };
}

function active(f: any) {
  f.db.exec("UPDATE partner_deals SET status='active'; UPDATE users SET subscription_tier='founder_pro', subscription_status='partner_grant', investor_tier='professional', investor_subscription_status='partner_grant' WHERE id=1");
}
function redeem(f: any, id: number) {
  f.db.prepare(`INSERT INTO users (id,role,email,name,subscription_tier,subscription_status,investor_tier,investor_subscription_status)
    VALUES (?,'founder',?,'Synthetic member','founder_pro','partner_referral','professional','partner_referral')`).run(id, `fixture-${id}@example.test`);
  f.db.prepare("INSERT INTO partner_referral_redemptions (partner_deal_id,redeemed_by_user_id,granted_tier_founder,granted_tier_investor) VALUES (7,?,'founder_pro','professional')").run(id);
}

test('D925: two racing terminates have exactly one winner and one audit', async () => {
  const f = await fixture(); active(f);
  // Hold both reads at the active snapshot, so changes=0 is actually exercised.
  const original = f.env.DB; let reads = 0; let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  f.env.DB = { ...original, prepare(sql: string) {
    const st = original.prepare(sql);
    if (/SELECT id, user_id, granted_tier_founder/.test(sql)) {
      const first = st.first.bind(st);
      st.first = async () => { const r = await first(); if (++reads === 2) release(); await gate; return r; };
    }
    return st;
  } };
  const replies = await Promise.all([f.call('/deals/7/terminate',{ reason:'fixture' }),f.call('/deals/7/terminate',{ reason:'fixture' })]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='partner_deal_terminated'").get()!.n,1);
  assert.equal(f.row().status,'terminated');
  f.db.close();
});

test('D925: terminate counts distinct reverted redeemers and actual partner updates, preserving paid upgrades', async () => {
  const f = await fixture(); active(f); redeem(f,20); redeem(f,21);
  f.db.exec("UPDATE users SET subscription_tier='studio', subscription_status='active', investor_tier='institutional', investor_subscription_status='active' WHERE id IN (1,21)");
  const r = await f.call('/deals/7/terminate',{ reason:'fixture' });
  assert.equal(r.status,200);
  assert.deepEqual(r.body,{ok:true,members_revoked:1,partner_tiers_reverted:false,failures:[]});
  assert.equal(f.user().subscription_tier,'studio'); assert.equal(f.user(21).investor_tier,'institutional');
  assert.equal(f.user(20).subscription_tier,'free'); assert.equal(f.user(20).investor_tier,'free');
  assert.equal((await f.call('/deals?status=terminated',{},ADMIN,'GET')).body.items[0].terminated_by_name,'Ada Admin');
  f.db.close();
});

test('D925: termination reports each partner and redeemer failure and keeps processing other grants', async () => {
  const f = await fixture(); active(f); redeem(f,20); redeem(f,21);
  const restore = failSQL(f.env,/UPDATE users SET subscription_tier/);
  const r = await f.call('/deals/7/terminate',{reason:'fixture'}); restore();
  assert.equal(r.status,200); assert.equal(r.body.partner_tiers_reverted,true); assert.equal(r.body.members_revoked,2);
  assert.deepEqual(r.body.failures,[{step:'partner_founder_revoke',user_id:1},{step:'redeemer_founder_revoke',user_id:20},{step:'redeemer_founder_revoke',user_id:21}]);
  assert.equal(f.user(21).investor_tier,'free'); assert.equal(f.user(21).subscription_tier,'founder_pro');
  f.db.close();
});

test('D925: a failed redeemer read is a failure, never an empty successful cascade', async () => {
  const f = await fixture(); active(f);
  failSQL(f.env,/SELECT redeemed_by_user_id/, 'all');
  const r = await f.call('/deals/7/terminate',{reason:'fixture'});
  assert.equal(r.status,200); assert.deepEqual(r.body.failures,[{step:'redeemers_read'}]); assert.equal(r.body.partner_tiers_reverted,true);
  f.db.close();
});

for (const [pattern,method,step] of [
  [/UPDATE partner_deals SET status = 'voided'/,'run','revoke_cascade'],
  [/SELECT envelope_id FROM partner_deals/,'all','revoke_cascade'],
  [/UPDATE esign_envelopes SET status = 'voided'/,'run','void_envelope'],
  [/UPDATE esign_recipients SET status = 'declined'/,'run','decline_recipients'],
] as const) test(`D925: revoke reports ${pattern.source} failures`, async () => {
  const f = await fixture(); f.db.exec("UPDATE esign_envelopes SET status='sent'");
  failSQL(f.env,pattern,method);
  const r=await f.call('/invitations/1/revoke');
  assert.equal(r.status,200); assert.equal(r.body.failures[0].step,step); assert.equal(r.body.failures.length,1);
  assert.equal(f.row().status,step==='revoke_cascade' && method==='run' ? 'awaiting_signature' : 'voided');
  f.db.close();
});

test('D925: free plans receive grants once; retry does not renew or reactivate a deal', async () => {
  const f=await fixture();
  assert.equal((await f.call('/deals/7/activate')).status,200);
  assert.equal(f.user().subscription_tier,'founder_pro'); assert.equal(f.user().investor_tier,'professional');
  assert.equal(f.row().activation_preserved_founder,0); assert.equal(f.row().activation_preserved_investor,0);
  const expiry=f.row().expires_at;
  assert.equal((await f.call('/deals/7/activate')).status,409); assert.equal(f.row().expires_at,expiry);
  assert.equal((await activatePartnerDealOnSignature(f.env,f.envelope.envelope_id))!.activated,false);
  f.db.close();
});

for (const founder of ['growth','studio']) for (const investor of ['professional','institutional']) test(`D925: activation preserves paid ${founder}/${investor}, records it and expiry cannot revoke it`, async () => {
  const f=await fixture();
  f.db.prepare(`UPDATE users SET subscription_tier=?,subscription_status='active',subscription_renews_at='2030-01-01',stripe_subscription_id='fixture-paid',
    investor_tier=?,investor_subscription_status='active',investor_subscription_renews_at='2030-02-01',investor_dealroom_max=77 WHERE id=1`).run(founder,investor);
  const before=f.user(); assert.equal((await f.call('/deals/7/activate')).status,200);
  const u=f.user();
  for(const key of ['subscription_tier','subscription_status','subscription_renews_at','stripe_subscription_id','investor_tier','investor_subscription_status','investor_subscription_renews_at','investor_dealroom_max']) assert.equal(u[key],before[key],key);
  assert.equal(f.row().activation_preserved_founder,1);assert.equal(f.row().activation_preserved_investor,1);
  f.db.exec("UPDATE partner_deals SET expires_at='2000-01-01'"); await expirePartnerDeals(f.env);
  assert.equal(f.user().subscription_tier,founder); assert.equal(f.user().investor_tier,investor);
  f.db.close();
});

test('D925: a grant failure rolls back both plans and records a safe error; admin retry clears it', async () => {
  const f=await fixture();
  f.db.exec("CREATE TRIGGER fixture_fail_grant BEFORE UPDATE OF investor_tier ON users BEGIN SELECT RAISE(ABORT, 'synthetic grant failure'); END");
  assert.equal((await f.call('/deals/7/activate')).status,503);
  assert.equal(f.row().status,'awaiting_signature'); assert.equal(f.row().activation_error,'activation_failed'); assert.ok(f.row().activation_failed_at);
  assert.equal(f.user().subscription_tier,'free');
  assert.equal((await f.call('/deals?status=awaiting_signature',{},ADMIN,'GET')).body.items[0].activation_error,'activation_failed');
  f.db.exec('DROP TRIGGER fixture_fail_grant');
  assert.equal((await f.call('/deals/7/activate')).status,200); assert.equal(f.row().activation_error,null); assert.equal(f.row().activation_failed_at,null);
  f.db.close();
});

for(const state of ['proposed','active','terminated','expired','voided']) test(`D925: retry refuses deal state ${state}`,async()=>{
  const f=await fixture(); f.db.prepare('UPDATE partner_deals SET status=?').run(state);
  assert.equal((await f.call('/deals/7/activate')).status,409); assert.equal(f.row().status,state);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='partner_deal_activation_retried'").get()!.n,0); f.db.close();
});

test('D925: retry requires this deal’s completed envelope and admin; failure causes no grants',async()=>{
  const f=await fixture();
  f.db.exec("UPDATE esign_envelopes SET status='sent'"); assert.equal((await f.call('/deals/7/activate')).status,409);
  f.db.exec('UPDATE partner_deals SET envelope_id=99999'); assert.equal((await f.call('/deals/7/activate')).status,409);
  assert.equal((await f.call('/deals/7/activate',{},SENDER)).status,403); assert.equal((await f.call('/deals/7/activate',{},null)).status,401);
  assert.equal(f.user().subscription_tier,'free');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='partner_deal_activation_retried'").get()!.n,0); f.db.close();
});

test('D925: every partner write is suspended with 423, while reads remain available',async()=>{
  const f=await fixture(); f.env.BRANCH_CODE='fixture'; f.db.exec("UPDATE branch_licence SET status='suspended'");
  for (const path of ['/invitations','/invitations/1/resend','/invitations/1/revoke','/deals/7/terminate','/deals/7/activate','/links','/1/directory']) {
    const r=await f.call(path); assert.equal(r.status,423,path);assert.equal(r.body.code,'branch_suspended');
  }
  assert.equal((await f.call('/deals?status=awaiting_signature',{},ADMIN,'GET')).status,200);
  assert.equal(f.row().status,'awaiting_signature'); f.db.close();
});

test('D925: redemption total is uncapped, truncated says whether rows are missing',async()=>{
  const f=await fixture();
  const before=await f.call('/deals/7/redemptions',{},ADMIN,'GET'); assert.equal(before.body.redemptions_total,0);assert.equal(before.body.truncated,false);
  for(let n=0;n<501;n++) f.db.prepare('INSERT INTO partner_referral_redemptions (partner_deal_id,redeemed_by_user_id) VALUES (7,?)').run(n+1000);
  const r=await f.call('/deals/7/redemptions',{},ADMIN,'GET');
  assert.equal(r.body.items.length,500);assert.equal(r.body.redemptions_total,501);assert.equal(r.body.truncated,true); f.db.close();
});

test('D925: real e-sign completion survives an activation throw, records it, and admin re-runs it', async () => {
  const f=await fixture();
  f.db.exec("UPDATE esign_envelopes SET status='sent'");
  const recipient=f.db.prepare('SELECT signing_token FROM esign_recipients WHERE envelope_id=?').get(f.envelope.envelope_id) as any;
  const restore=failSQL(f.env,/SELECT id, role FROM users/,'first',true);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
  const signed=await esignCall(f.env,'POST',`/sign/${recipient.signing_token}`,SENDER,{accepted:true,typed_name:'Synthetic signer',signature_data_url:png});
  restore();
  assert.equal(signed.status,200,JSON.stringify(signed.body));
  assert.equal(f.db.prepare('SELECT status FROM esign_envelopes WHERE id=?').get(f.envelope.envelope_id)!.status,'completed');
  assert.equal(f.row().status,'awaiting_signature');assert.equal(f.row().activation_error,'activation_failed');
  assert.match(f.row().activation_failed_at,/^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await f.call('/deals/7/activate')).status,200);assert.equal(f.row().activation_error,null);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='partner_deal_activation_retried'").get()!.n,1);
  f.db.close();
});

test('D925: simultaneous completed-envelope activation grants once and emits one activation audit',async()=>{
  const f=await fixture();
  const r=await Promise.all([activatePartnerDealOnSignature(f.env,f.envelope.envelope_id),activatePartnerDealOnSignature(f.env,f.envelope.envelope_id)]);
  assert.deepEqual(r.map(v=>v!.activated).sort(),[false,true]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='partner_deal_activated'").get()!.n,1);
  assert.equal(f.user().subscription_status,'partner_grant'); f.db.close();
});

for(const family of ['founder','investor']) test(`D925: only the paid ${family} family is preserved; the other receives its grant`,async()=>{
  const f=await fixture();
  f.db.exec(family==='founder' ? "UPDATE users SET subscription_tier='growth',subscription_status='active' WHERE id=1" : "UPDATE users SET investor_tier='institutional',investor_subscription_status='active' WHERE id=1");
  assert.equal((await f.call('/deals/7/activate')).status,200);
  assert.equal(f.user().subscription_tier,family==='founder'?'growth':'founder_pro');
  assert.equal(f.user().investor_tier,family==='investor'?'institutional':'professional');
  assert.equal(f.row().activation_preserved_founder,family==='founder'?1:0);
  assert.equal(f.row().activation_preserved_investor,family==='investor'?1:0); f.db.close();
});

test('D925: investor revoke failures are reported individually without losing founder counts',async()=>{
  const f=await fixture();active(f);redeem(f,20);redeem(f,21);
  failSQL(f.env,/UPDATE users SET investor_tier/);
  const r=await f.call('/deals/7/terminate',{reason:'fixture'});
  assert.equal(r.status,200);assert.equal(r.body.members_revoked,2);assert.equal(r.body.partner_tiers_reverted,true);
  assert.deepEqual(r.body.failures,[{step:'partner_investor_revoke',user_id:1},{step:'redeemer_investor_revoke',user_id:20},{step:'redeemer_investor_revoke',user_id:21}]);
  assert.equal(f.user(21).subscription_tier,'free');assert.equal(f.user(21).investor_tier,'professional');f.db.close();
});
