/** D1100: synthetic members, real SQLite, no Stripe or production requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { rateLimitMiddleware } from '../src/middleware/rateLimit.ts';
import { aiLicenceKey } from '../src/services/aiBudget.ts';
import { GRACE_DAYS, inGrace } from '../src/middleware/planSubscription.ts';
import { userMeetsTier } from '../src/middleware/requireTier.ts';
import { effectiveInvestorTier, getIntroQuotaState } from '../src/middleware/requireInvestorTier.ts';
import { userHasMiPro } from '../src/middleware/miAccess.ts';
import { monthlyAllowanceFor } from '../src/services/introductions.ts';
import { primaryCover } from '../src/routes/investor_seats.ts';
import { loadAdvisorGate } from '../src/routes/advisor.ts';
import { routeAnswer } from '../src/services/advisor/writeRouter.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const inside = new Date(NOW - 20 * DAY).toISOString();
const outside = new Date(NOW - 22 * DAY).toISOString();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8');
  for (const table of ['users','investor_profiles','activity_logs']) db.exec(stripForeignKeys(tableFromBaseline(baseline,table)));
  db.exec("INSERT INTO users (id,role,name,email,is_active,investor_tier,subscription_tier,subscription_status,investor_subscription_status) VALUES (1,'investor','Synthetic member','grace@example.test',1,'institutional','studio','free','free')");
  return {db,env:{DB:d1Over(db),ENVIRONMENT:'test'} as any};
}

test('inGrace bounds retries at exactly period end + 21 UTC days and fails closed on missing/invalid dates', () => {
  assert.equal(GRACE_DAYS,21);
  const end = '2026-10-01T12:00:00Z';
  assert.equal(inGrace('past_due',end,Date.parse(end)+21*DAY),true);
  assert.equal(inGrace('past_due',end,Date.parse(end)+21*DAY+1),false);
  assert.equal(inGrace('past_due','2026-10-01 12:00:00',Date.parse(end)+21*DAY),true);
  assert.equal(inGrace('past_due','2026-10-01 12:00:00',Date.parse(end)+21*DAY+1),false);
  assert.equal(inGrace('past_due','2026-10-01T14:00:00+02:00',Date.parse(end)+21*DAY),true);
  for (const date of [null,undefined,'','invalid','123']) assert.equal(inGrace('past_due',date,NOW),false);
  assert.equal(inGrace('past_due',end,NaN),false);
  assert.equal(inGrace('past_due',end,-Infinity),false);
  for (const status of ['active','trialing']) assert.equal(inGrace(status,null,NOW),true);
  for (const status of ['unpaid','cancelled','canceled','free','unknown',null]) assert.equal(inGrace(status,inside,NOW),false);
});

for (const [status,date,paid] of [
  ['past_due',inside,true],['past_due',outside,false],['past_due',null,false],['past_due','invalid',false],
  ['unpaid',inside,false],['cancelled',inside,false],['canceled',inside,false],['active',null,true],['trialing',null,true],
] as const) test(`seven gates: ${status}, ${date === inside ? 'inside' : date === outside ? 'outside' : String(date)}`, async (t) => {
  t.mock.method(Date,'now',()=>NOW);
  const sub:any={id:1,role:'founder',subscription_tier:'studio',subscription_status:status,subscription_renews_at:date,
    investor_tier:'institutional',investor_subscription_status:status,investor_subscription_renews_at:date,
    mi_subscription_status:status,mi_subscription_period_end:date};
  assert.equal(userMeetsTier(sub,'studio'),paid);
  assert.equal(aiLicenceKey(sub),paid?'founder:studio':'founder:free');
  assert.equal(aiLicenceKey({...sub,role:'investor'}),paid?'investor:institutional':'investor:free');
  assert.equal(effectiveInvestorTier({...sub,role:'investor'}),paid?'institutional':'free');
  assert.equal(userHasMiPro(sub),paid);
  assert.equal(monthlyAllowanceFor(sub),paid?25:3);
  assert.equal(monthlyAllowanceFor({...sub,role:'investor'}),paid?25:3);
  const {db,env}=fixture();try {
    db.prepare('UPDATE users SET subscription_status=?,subscription_renews_at=?,investor_subscription_status=?,investor_subscription_renews_at=? WHERE id=1').run(status,date,status,date);
    assert.equal((await primaryCover(env,1)).ok,paid);
    const tiers=(await loadAdvisorGate(env,{id:1,role:'investor'} as any)).tiers;
    assert.equal(tiers.has('subscriber'),paid);assert.equal(tiers.has('investor_pro'),paid);
    const result=await routeAnswer(env,{id:1,role:'investor'} as any,'investor.profile.thesis','Synthetic investment thesis');
    assert.equal(result.status,paid?'saved':'paywalled');
    const profile=db.prepare('SELECT thesis_text FROM investor_profiles WHERE user_id=1').get() as any;
    assert.equal(profile?.thesis_text,paid?'Synthetic investment thesis':undefined);
    assert.equal((await getIntroQuotaState(env,1)).cap,paid?100:3);
  } finally {db.close();}
});

test('advisor gates use each family’s date, not the other subscription’s grace', async(t) => {
  t.mock.method(Date,'now',()=>NOW);
  const {db,env}=fixture();try {
    for (const [investorDate,founderDate,investor,founder] of [[inside,outside,true,false],[outside,inside,false,true],[outside,outside,false,false]] as const) {
      db.prepare("UPDATE users SET investor_subscription_status='past_due',subscription_status='past_due',investor_subscription_renews_at=?,subscription_renews_at=? WHERE id=1").run(investorDate,founderDate);
      const tiers=(await loadAdvisorGate(env,{id:1,role:'investor'} as any)).tiers;
      assert.equal(tiers.has('investor_pro'),investor);assert.equal(tiers.has('subscriber'),founder);
      assert.equal((await routeAnswer(env,{id:1,role:'investor'} as any,'investor.profile.thesis','Synthetic updated thesis')).status,investor||founder?'saved':'paywalled');
    }
  }finally{db.close();}
});

test('existing role bypasses, free access and partner grant expiry stay intact',t=>{
  t.mock.method(Date,'now',()=>NOW);
  assert.equal(userMeetsTier({role:'admin',subscription_status:'unpaid'} as any,'studio'),true);
  assert.equal(userHasMiPro({role:'admin',mi_subscription_status:'unpaid'} as any),true);
  assert.equal(userMeetsTier({role:'founder',subscription_status:'unpaid'} as any,'free'),true);
  for(const status of ['partner_grant','partner_referral']){
    assert.equal(userMeetsTier({role:'founder',subscription_tier:'studio',subscription_status:status,subscription_renews_at:inside} as any,'studio'),false);
    assert.equal(userMeetsTier({role:'founder',subscription_tier:'studio',subscription_status:status,subscription_renews_at:new Date(NOW+DAY).toISOString()} as any,'studio'),true);
    assert.equal(effectiveInvestorTier({investor_tier:'institutional',investor_subscription_status:status,investor_subscription_renews_at:inside} as any),'free');
  }
});


test('Confirm has a shared per-user 10/minute KV budget across alert IDs and fails closed',async(t)=>{
  let clock=NOW;t.mock.method(Date,'now',()=>clock);
  const values=new Map<string,string>();let down=false;
  const kv={async get(key:string){if(down)throw new Error('Synthetic unavailable KV');return values.get(key)??null;},async put(key:string,value:string){values.set(key,value);}};
  const app=new Hono<any>();
  app.use('*',async(c,next)=>{c.set('currentUser',{id:Number(c.req.header('x-synthetic-user')||1),role:'founder'});await next();});
  app.use('*',rateLimitMiddleware());app.all('*',c=>c.json({ok:true}));
  const env:any={RATE_LIMITS:kv,DB:{prepare(){return {bind(){return {async run(){return {success:true};}};}};}}};
  const hit=async(method:string,path:string,user=1)=>app.fetch(new Request('https://fixture.example.test'+path,{method,headers:{'x-synthetic-user':String(user)}}),env,{waitUntil(_p:Promise<unknown>){},passThroughOnException(){}} as any);
  for(let n=1;n<=10;n++)assert.equal((await hit('POST',`/api/billing/alerts/${n}/confirm`)).status,200);
  const blocked=await hit('POST','/api/billing/alerts/11/confirm');assert.equal(blocked.status,429);assert.equal(blocked.headers.get('X-RateLimit-Bucket'),'billing_alert_confirm');
  assert.equal((await hit('POST','/api/billing/alerts/12/confirm',2)).status,200);
  assert.equal((await hit('GET','/api/billing/alerts/12/confirm')).status,200);
  assert.equal((await hit('POST','/api/billing/alerts/12/confirm-extra')).status,200);
  clock+=60_000;assert.equal((await hit('POST','/api/billing/alerts/12/confirm')).status,200);
  down=true;
  const unavailable=await hit('POST','/api/billing/alerts/12/confirm',3);assert.equal(unavailable.status,503);assert.equal((await unavailable.json() as any).bucket,'billing_alert_confirm');
});
