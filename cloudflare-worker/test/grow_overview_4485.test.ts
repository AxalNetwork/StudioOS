/** D4485 (#4485): Distribution overview on migrated SQLite; no connector or production reads. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { distributionOverview, overviewSpend, overviewWeek } from '../src/services/distribution/overview.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
after(removeMigratedDatabases);
const now = new Date('2026-11-11T12:00:00Z');
function fixture() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO founders(id,name,email) VALUES (1,'Synthetic owner','synthetic-owner@example.invalid'),(2,'Other founder','other@example.invalid');
    INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES (1,'founder','Synthetic owner','synthetic-owner@example.invalid',1,1),(2,'founder','Other founder','other@example.invalid',2,1);
    INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',1),(2,'Other venture',2);
    INSERT INTO grow_campaigns(id,uid,project_id,name,goal,status,utm_campaign,created_by,updated_by) VALUES
      (1,'ours',1,'Our campaign','demos','active','launch',1,1),
      (2,'theirs',2,'Other campaign','signups','active','foreign',1,1);
    INSERT INTO contacts(id,uid,project_id,audience,email,utm_json,created_at) VALUES
      (1,'a',1,'customer','a@example.invalid','{"utm_campaign":"launch"}','2026-11-01 00:00:00'),
      (2,'b',1,'customer','b@example.invalid','{"utm_campaign":" LAUNCH "}','2026-11-30T23:59:59Z'),
      (3,'c',1,'customer','c@example.invalid','{"utm_campaign":"foreign"}','2026-11-11'),
      (4,'d',2,'customer','d@example.invalid','{"utm_campaign":"launch"}','2026-11-11'),
      (5,'e',1,'customer','e@example.invalid','{"utm_campaign":"launch"}','2026-10-31 23:59:59'),
      (6,'f',1,'customer','f@example.invalid','{"utm_campaign":"launch"}','2026-12-01'),
      (7,'g',1,'customer','g@example.invalid','not-json','2026-11-11'),
      (8,'h',1,'customer','h@example.invalid','{"utm_campaign":42}','2026-11-11');
    INSERT INTO contact_replies(contact_id,direction,created_at) VALUES
      (1,'inbound','2026-11-11'),(1,'outbound','2026-11-11'),(4,'inbound','2026-11-11'),(1,'inbound','2026-10-31');
    INSERT INTO growth_channels(id,uid,project_id,name,utm_source) VALUES (1,'social',1,'Social','social'),(2,'other',2,'Other','other');
    INSERT INTO content_calendar_items(uid,project_id,title,planned_on,status,channel_id) VALUES
      ('mon',1,'Monday','2026-11-09','planned',1),('sun',1,'Sunday','2026-11-15','scheduled',1),
      ('before',1,'Before','2026-11-08','planned',1),('after',1,'After','2026-11-16','planned',1),
      ('foreign',2,'Other venture','2026-11-11','planned',2),('dropped',1,'Dropped','2026-11-11','dropped',1);`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: 'test-only'.repeat(8), ENVIRONMENT: 'development' } as any };
}
const readEmpty = async () => ({ campaigns: [] });
const channel = (source: 'manual' | 'mercury', cents: number, month = '2026-11') => ({ uid: 'social', spend_cents: cents, spend_reason: null, spend_months: [{ month, source, spend_cents: cents }] });
const campaign = (channels: ReturnType<typeof channel>[], uid = 'ours') => ({ uid, name: 'Synthetic campaign', status: 'active', budget_cents: 10000, channels });

test('D4485: unknown reach/clicks stay null, leads use only venture tags in this month, replies are inbound and scoped', async () => {
  const f = fixture();
  try {
    const data = await distributionOverview(f.env, 1, { now, readCampaigns: readEmpty });
    for (const name of ['reach', 'clicks'] as const) {
      assert.equal(data.kpis[name].value, null);
      assert.equal(data.kpis[name].reason, 'Not recorded: no connected ad or social account reports it');
      assert.deepEqual(data.kpis[name].sources, []);
    }
    assert.equal(data.kpis.leads.value, 2);
    assert.deepEqual(data.kpis.leads.sources, ['connector']);
    assert.equal(data.kpis.replies.value, 1);
    assert.equal(data.kpis.cost_per_lead.value, null);
    assert.ok(data.kpis.cost_per_lead.reason);
    const actual = await distributionOverview(f.env, 1, { now });
    assert.deepEqual(actual.campaigns.items?.map((c) => c.uid), ['ours']);
    assert.equal(actual.kpis.spend_vs_budget.value, null);
    assert.equal((await distributionOverview(f.env, 2, { now, readCampaigns: readEmpty })).kpis.leads.value, 0);
  } finally { f.db.close(); }
});

test('D4485: spend uses authoritative month provenance, deduplicates shared channels, and cost names spend and leads sources', async () => {
  const f = fixture();
  try {
    const readCampaigns = async () => ({ campaigns: [campaign([channel('manual', 1000)]), campaign([channel('mercury', 2400)], 'second')] });
    const data = await distributionOverview(f.env, 1, { now, readCampaigns });
    assert.equal(data.kpis.spend_vs_budget.value, 2400);
    assert.equal(data.kpis.spend_vs_budget.budget_cents, 20000);
    assert.deepEqual(data.kpis.spend_vs_budget.sources, ['mercury']);
    assert.equal(data.kpis.cost_per_lead.value, 1200);
    assert.deepEqual(data.kpis.cost_per_lead.sources, ['mercury', 'connector']);
    const manual = await distributionOverview(f.env, 1, { now, readCampaigns: async () => ({ campaigns: [campaign([channel('manual', 600)])] }) });
    assert.deepEqual(manual.kpis.cost_per_lead.sources, ['manual', 'connector']);
    assert.equal(overviewSpend([campaign([channel('mercury', 2400)]), campaign([channel('manual', 1000)], 'second')]).value, 2400);
    const zero = overviewSpend([campaign([channel('manual', 0)])]);
    assert.equal(zero.value, 0, 'a recorded zero is distinct from missing spend');
    const mixed = overviewSpend([campaign([{ ...channel('manual', 100), spend_cents: 300, spend_months: [channel('manual', 100, '2026-10').spend_months[0], channel('mercury', 200).spend_months[0]] }])]);
    assert.equal(mixed.value, 300);
    assert.deepEqual(mixed.sources, ['manual', 'mercury']);
  } finally { f.db.close(); }
});

test('D4485: ISO weeks include Monday and Sunday, exclude other ventures and weeks, and retain channel names', async () => {
  const f = fixture();
  try {
    const data = await distributionOverview(f.env, 1, { now, week: '2026-W46', readCampaigns: readEmpty });
    assert.deepEqual(data.week.items?.map((r: any) => [r.uid, r.channel]), [['mon', 'Social'], ['sun', 'Social']]);
    assert.deepEqual([data.week.from, data.week.until], ['2026-11-09', '2026-11-16']);
    assert.equal(overviewWeek('2026-11-11').key, '2026-W46');
    assert.equal(overviewWeek(undefined, now).from, '2026-11-09');
    assert.equal(overviewWeek('2027-01-01').key, '2026-W53');
    for (const value of ['2026-W00', '2025-W53', '2026-02-30', "2026-W46' OR 1=1"]) assert.throws(() => overviewWeek(value), /real ISO week/);
  } finally { f.db.close(); }
});

test('D4485: failed blocks stay unreadable while independent blocks remain available; no division by zero', async () => {
  const f = fixture();
  try {
    f.db.exec('DROP TABLE contact_replies');
    const data = await distributionOverview(f.env, 1, { now, readCampaigns: async () => { throw new Error('synthetic private error'); } });
    assert.equal(data.kpis.replies.value, null);
    assert.match(data.kpis.replies.reason!, /^Unreadable:/);
    assert.equal(data.campaigns.items, null);
    assert.match(data.campaigns.reason!, /^Unreadable:/);
    assert.equal(data.kpis.leads.value, 2);
    assert.equal(data.week.items?.length, 2);
    assert.ok(!JSON.stringify(data).includes('synthetic private error'));
    f.db.exec('DELETE FROM contacts');
    const none = await distributionOverview(f.env, 1, { now, readCampaigns: async () => ({ campaigns: [campaign([channel('manual', 100)])] }) });
    assert.equal(none.kpis.leads.value, 0);
    assert.equal(none.kpis.cost_per_lead.value, null);
    f.db.exec('DROP TABLE content_calendar_items');
    const week = await distributionOverview(f.env, 1, { now, readCampaigns: readEmpty });
    assert.equal(week.week.items, null);
    assert.match(week.week.reason!, /^Unreadable:/);
  } finally { f.db.close(); }
});


test('D4485: owner decision — cost uses current-month spend and its sources, while budget uses campaign-window spend', async () => {
  const f = fixture();
  try {
    const both = { ...channel('mercury', 200), spend_cents: 300, spend_months: [channel('manual', 100, '2026-10').spend_months[0], channel('mercury', 200).spend_months[0]] };
    const result = await distributionOverview(f.env, 1, { now, readCampaigns: async () => ({ campaigns: [campaign([both])] }) });
    assert.equal(result.kpis.spend_vs_budget.value, 300);
    assert.deepEqual(result.kpis.spend_vs_budget.sources, ['manual', 'mercury']);
    assert.equal(result.kpis.cost_per_lead.value, 100);
    assert.deepEqual(result.kpis.cost_per_lead.sources, ['mercury', 'connector']);
    const absent = await distributionOverview(f.env, 1, { now, readCampaigns: async () => ({ campaigns: [campaign([channel('manual', 100, '2026-10')])] }) });
    assert.equal(absent.kpis.cost_per_lead.value, null);
    assert.match(absent.kpis.cost_per_lead.reason!, /current-month spend/);
  } finally { f.db.close(); }
});


test('D4485: mounted overview uses the Grow project gate and rejects invalid weeks and anonymous reads', async () => {
  const f = fixture();
  const app = new Hono<any>().route('/api/cycles/grow', cycleGrow);
  app.onError((e, c) => c.json({ detail: 'Request refused' }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const call = async (user: number | null, project: number, week = '2026-W46') => {
    const token = user === null ? null : await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
    const res = await app.request(`/api/cycles/grow/distribution/overview?project=${project}&week=${encodeURIComponent(week)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, f.env);
    return { status: res.status, body: await res.json() as any };
  };
  try {
    f.db.exec("INSERT INTO integrations(uid,user_id,provider_key,status,auth_type) VALUES ('route-link',1,'whatsapp_link','active','api_key')");
    const own = await call(1, 1);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual(own.body.update_asks.items, []);
    assert.equal(own.body.update_asks.can_add, true);
    assert.equal(own.body.channels.items.at(-1).status, 'Connected');
    assert.deepEqual(own.body.campaigns.items.map((c: any) => c.uid), ['ours']);
    assert.deepEqual(own.body.week.items.map((i: any) => i.uid), ['mon', 'sun']);
    assert.equal((await call(2, 1)).status, 403);
    assert.equal((await call(1, 2)).status, 403);
    assert.equal((await call(null, 1)).status, 401);
    const invalid = await call(1, 1, '2026-W99');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.field, 'week');
  } finally { f.db.close(); }
});

test('D4485: real campaign reader keeps Mercury precedence, foreign facts out, and CPL within the current month', async () => {
  const f = fixture();
  try {
    f.db.exec(`UPDATE grow_campaigns SET starts_on='2026-10-01',ends_on='2026-11-30',budget_cents=10000 WHERE id=1;
      INSERT INTO grow_campaign_channels(campaign_id,channel_id,planned_budget_cents) VALUES (1,1,10000);
      INSERT INTO channel_spend(channel_id,month,spend_cents) VALUES (1,'2026-10',100),(1,'2026-11',1000);
      INSERT INTO mercury_grow_facts(integration_id,project_id,module,kind,period,subject,amount_cents,as_of) VALUES
        (1,1,'distribution','channel_spend','2026-11','social',2000,'2026-11-11'),
        (1,2,'distribution','channel_spend','2026-11','social',9999,'2026-11-11');`);
    const result = await distributionOverview(f.env, 1, { now });
    assert.equal(result.kpis.spend_vs_budget.value, 2100);
    assert.equal(result.kpis.cost_per_lead.value, 1000);
    assert.deepEqual(result.kpis.cost_per_lead.sources, ['mercury','connector']);
    assert.equal(result.kpis.leads.value, 2);
  } finally { f.db.close(); }
});


test('D4485: no active campaigns is distinct from no campaigns, and an unreadable list has no fabricated total', async () => {
  const f = fixture();
  try {
    f.db.exec("UPDATE grow_campaigns SET status='draft' WHERE project_id=1");
    const draft = await distributionOverview(f.env, 1, { now });
    assert.deepEqual(draft.campaigns.items, []);
    assert.equal(draft.campaigns.total, 1);
    f.db.exec('DELETE FROM grow_campaigns WHERE project_id=1');
    const empty = await distributionOverview(f.env, 1, { now });
    assert.equal(empty.campaigns.total, 0);
    const failed = await distributionOverview(f.env, 1, { now, readCampaigns: async () => { throw new Error('unavailable'); } });
    assert.equal(failed.campaigns.total, null);
    assert.equal(failed.campaigns.items, null);
  } finally { f.db.close(); }
});


test('D4485: last-update customer identities are writer-only, project scoped, and independently unreadable', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO portfolio_updates(id,uid,project_id,author_user_id,title,status,created_at) VALUES
      (1,'old',1,1,'Old','submitted','2026-11-01'),(2,'last',1,1,'Last','submitted','2026-11-02'),
      (3,'foreign-update',2,2,'Foreign','submitted','2026-11-03'),(4,'draft',1,1,'Draft','draft','2026-11-04');
      INSERT INTO update_asks(id,uid,update_id,kind,text) VALUES (1,'old-ask',1,'customer','Old ask'),(2,'last-ask',2,'customer','Recorded ask'),(3,'foreign-ask',3,'customer','Other'),(4,'draft-ask',4,'customer','Draft'),(5,'partner-ask',2,'partner','Partner');
      INSERT INTO update_ask_replies(uid,ask_id,name,email,message) VALUES
      ('old-reply',1,'Old','old@example.invalid','Old'),('last-reply',2,'Synthetic reply','reply@example.invalid','Recorded reply'),
      ('foreign-reply',3,'Other','other@example.invalid','Other'),('draft-reply',4,'Draft','draft@example.invalid','Draft'),('partner-reply',5,'Partner','partner@example.invalid','Partner');`);
    const options = { now, readCampaigns: readEmpty, canWrite: true, canAddProspects: true };
    const writer = await distributionOverview(f.env, 1, options);
    assert.deepEqual(JSON.parse(JSON.stringify(writer.update_asks)), { items: [{ uid: 'last-reply', name: 'Synthetic reply', email: 'reply@example.invalid', message: 'Recorded reply', ask_text: 'Recorded ask' }], reason: null, can_add: true });
    const reader = await distributionOverview(f.env, 1, { ...options, canWrite: false });
    assert.equal(reader.update_asks.items, null);
    assert.equal(reader.update_asks.can_add, false);
    assert.doesNotMatch(JSON.stringify(reader), /reply@example/);
    assert.equal((await distributionOverview(f.env, 2, options)).update_asks.items?.length, 1);
    f.db.exec('DROP TABLE update_ask_replies');
    const failed = await distributionOverview(f.env, 1, options);
    assert.equal(failed.update_asks.items, null);
    assert.match(failed.update_asks.reason!, /^Unreadable:/);
    assert.equal(failed.kpis.leads.value, 2);
  } finally { f.db.close(); }
});

test('D4485: connection status belongs only to the signed-in user, never a channel plan or profile sign-in', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO integrations(uid,user_id,provider_key,status,auth_type) VALUES ('their-link',2,'whatsapp_link','active','api_key'),('profile',1,'linkedin','active','oauth2');`);
    const options = { now, readCampaigns: readEmpty, userId: 1 };
    let data = await distributionOverview(f.env, 1, options);
    assert.deepEqual(data.channels.items?.map((c) => c.status), ['Not offered yet','Not offered yet','Not offered yet','Not offered yet','Not offered yet','Not connected']);
    f.db.exec(`INSERT INTO integrations(uid,user_id,provider_key,status,auth_type) VALUES ('my-link',1,'whatsapp_link','active','api_key');`);
    assert.equal((await distributionOverview(f.env, 1, options)).channels.items?.at(-1)?.status, 'Connected');
    for (const [status, expected] of [['error','Reconnect'],['paused','Paused'],['disconnected','Not connected']]) {
      f.db.prepare('UPDATE integrations SET status = ? WHERE user_id = 1').run(status);
      assert.equal((await distributionOverview(f.env, 1, options)).channels.items?.at(-1)?.status, expected);
    }
    f.db.exec("UPDATE integrations SET status = 'active', last_error = 'synthetic private error' WHERE user_id = 1");
    data = await distributionOverview(f.env, 1, options);
    assert.equal(data.channels.items?.at(-1)?.status, 'Reconnect');
    assert.doesNotMatch(JSON.stringify(data), /synthetic private error/);
    f.db.exec('DROP TABLE integrations');
    data = await distributionOverview(f.env, 1, options);
    assert.equal(data.channels.items, null);
    assert.match(data.channels.reason!, /^Unreadable:/);
    assert.equal(data.kpis.leads.value, 2);
  } finally { f.db.close(); }
});
