/** D4485 (#4485): Distribution overview on migrated SQLite; no connector or production reads. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { distributionOverview, overviewSpend, overviewWeek } from '../src/services/distribution/overview.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
after(removeMigratedDatabases);
const now = new Date('2026-11-11T12:00:00Z');
function fixture() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,role,name,email) VALUES (1,'founder','Synthetic owner','synthetic-owner@example.invalid');
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
  return { db, env: { DB: d1Over(db) } as any };
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
