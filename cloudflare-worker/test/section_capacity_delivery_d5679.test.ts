/** HQ capacity cron producer → D1 episodes → private Slack send and measured recovery (#5679). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { GB } from '../src/services/platformCapacity.ts';
import { sweepPlatformCapacity } from '../src/services/platformCapacityHistory.ts';

const slug = 'axalvc-superadmin-platform', channel = 'CTEST00001', team = 'TTEST00001';
const start = '2026-11-12T10:00:00.000Z';
const time = (minutes: number) => new Date(Date.parse(start) + minutes * 60_000);
const rootTs = '1794000000.000001';
const migration = (name: string) => readFileSync('cloudflare-worker/sql/migrations/' + name, 'utf8');
const schema = migration('202611072340_platform_capacity_history.sql') + migration('202611121106_5679_section_capacity_slack.sql') +
  'CREATE TABLE users(id INTEGER,role TEXT,is_active INTEGER,notification_prefs TEXT); CREATE TABLE super_admins(user_id INTEGER);';

function fixture(t) {
  const { DB, db } = makeD1(schema);
  t.after(() => db.close());
  let size: number | null = 8 * GB;
  const binding = new Proxy(DB, { get(target, key) {
    if (key === 'prepare') return (sql: string) => sql === 'SELECT 1' ?
      { run: async () => ({ meta: { size_after: size } }) } : target.prepare(sql);
    return target[key];
  } });
  const env = { DB: binding, AXAL_SECTION_CAPACITY_SLACK_START_UTC: start,
    AXAL_SECTION_SLACK_TEAM_ID: team, AXAL_SECTION_SLACK_CHANNELS: JSON.stringify({ [slug]: channel }),
    SLACK_BOT_TOKEN: 'fixture-token' };
  const posts: any[] = [], replies: Response[] = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const last = new URL(url).pathname;
    if (last === '/api/auth.test') return Response.json({ ok: true, team_id: team, bot_id: 'BTEST00001' });
    if (last === '/api/users.conversations') return Response.json({ ok: true, channels: [{ id: channel, name: slug,
      is_channel: true, is_private: true, is_archived: false, is_shared: false, is_ext_shared: false, is_pending_ext_shared: false }] });
    assert.equal(last, '/api/chat.postMessage');
    posts.push(JSON.parse(init.body));
    return replies.shift() || Response.json({ ok: true, channel, ts: posts.length === 1 ? rootTs : '1794000000.000002' });
  });
  const rows = () => db.prepare('SELECT stage,state,attempts,last_reason,channel_id,message_ts FROM section_capacity_slack_deliveries ORDER BY stage').all();
  return { env, posts, replies, rows, db, setSize: (v: number | null) => { size=v; },
    sweep: (minute: number) => sweepPlatformCapacity(env as any, time(minute)) };
}

test('real sweep opens once, holds through unreadable telemetry and threads a measured recovery', async t => {
  const f = fixture(t);
  await Promise.all([f.sweep(0), f.sweep(0)]);
  await f.sweep(15);
  f.setSize(null);
  await f.sweep(30);
  assert.equal(f.posts.length, 1);
  assert.equal(f.rows()[0].state, 'delivered');
  assert.equal(f.rows()[0].message_ts, rootTs);
  f.setSize(GB);
  await Promise.all([f.sweep(45),f.sweep(45)]);
  await f.sweep(60);
  assert.deepEqual(f.posts, [
    { channel, text: '[axalvc][superadmin][platform][capacity][incident] HQ database size crossed its configured alert threshold. Open HQ Platform at /admin/platform.' },
    { channel, thread_ts: rootTs, text: '[axalvc][superadmin][platform][capacity][recovery] HQ database size returned within its configured threshold. Open HQ Platform at /admin/platform.' },
  ]);
  assert.deepEqual(f.rows().map(r=>[r.state,r.attempts]), [['delivered',1],['delivered',1]]);
});

test('definite rate-limit retries only after Retry-After and a safe delay', async t => {
  const f = fixture(t);
  f.replies.push(new Response('', { status: 429, headers: { 'Retry-After': '1500' } }));
  await f.sweep(0);
  assert.deepEqual([f.rows()[0].state,f.rows()[0].last_reason], ['pending','rate_limited']);
  await f.sweep(15);
  assert.equal(f.posts.length, 1);
  await f.sweep(30);
  assert.equal(f.rows()[0].state, 'delivered');
  assert.equal(f.rows()[0].attempts, 2);
});

test('unconfirmed post is held through replay, with no duplicate root or unparented recovery', async t => {
  const f = fixture(t);
  f.replies.push(Response.json({ ok: true, channel }));
  await f.sweep(0);
  f.setSize(GB);
  await f.sweep(15);
  await f.sweep(180);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.rows().map(r=>[r.stage,r.state]), [['firing','uncertain']]);
});

test('expired sending lease is held for reconciliation and never blindly resent', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO platform_capacity_alerts(id,scope,metric_key,severity,opened_at,last_seen_at) VALUES(1,'hq','d1.size_bytes','critical','2026-11-12T10:00:00.000Z','2026-11-12T10:00:00.000Z')");
  f.db.exec("INSERT INTO section_capacity_slack_deliveries(alert_id,stage,state,attempts,lease_until,claim_token) VALUES (1,'firing','sending',1,1,'old')");
  await f.sweep(15);
  assert.equal(f.posts.length, 0);
  assert.deepEqual([f.rows()[0].state,f.rows()[0].last_reason], ['uncertain','lease_expired']);
});

test('opt-out, prior episodes, excluded families and branch execution send nothing', async t => {
  const f = fixture(t);
  f.env.AXAL_SECTION_CAPACITY_SLACK_START_UTC='';
  await f.sweep(-30);
  f.env.AXAL_SECTION_CAPACITY_SLACK_START_UTC=start;
  await f.sweep(15);
  f.setSize(GB);
  await f.sweep(30);
  f.db.prepare("INSERT INTO platform_capacity_alerts(scope,metric_key,severity,opened_at,last_seen_at) VALUES('hq','queue.job.oldest_age_seconds','critical',?,?)").run(time(15).toISOString(),time(15).toISOString());
  await f.sweep(45);
  f.setSize(8*GB);
  assert.deepEqual(await sweepPlatformCapacity({ ...f.env,BRANCH_CODE:'branch' } as any,time(60)),{skipped:'branch'});
  assert.deepEqual(f.rows(), []);
  assert.equal(f.posts.length, 0);
});

test('muted active episode holds pending write, and changing destination cannot divert a recovery', async t => {
  const f=fixture(t);
  f.replies.push(new Response('',{status:429,headers:{'Retry-After':'1'}}));
  await f.sweep(0);
  f.db.prepare("UPDATE platform_capacity_alerts SET muted_until=? WHERE id=1").run(time(25).toISOString());
  await f.sweep(15);
  assert.equal(f.posts.length,1);
  await f.sweep(30);
  assert.equal(f.rows()[0].state,'delivered');
  f.env.AXAL_SECTION_SLACK_CHANNELS=JSON.stringify({[slug]:'CTEST00002'});
  f.setSize(GB);
  await f.sweep(45);
  assert.equal(f.posts.length,2);
  assert.equal(f.rows()[1].last_reason,'destination_unverified');
});

test('five known rejections exhaust the delivery and later sweeps stay quiet', async t => {
  const f = fixture(t);
  for (let i=0; i<5; i++) f.replies.push(Response.json({ ok: false, error: 'not_in_channel' }));
  for (const minute of [0,15,45,105,225,600]) await f.sweep(minute);
  assert.equal(f.posts.length,5);
  assert.deepEqual([f.rows()[0].state,f.rows()[0].attempts],['exhausted',5]);
});

test('unreadable source after initial warning cannot synthesize a recovery', async t => {
  const f=fixture(t);
  f.setSize(5.5*GB);
  await f.sweep(0);
  f.setSize(null);
  await f.sweep(15);
  f.setSize(8*GB);
  await f.sweep(30);
  f.setSize(null);
  await f.sweep(45);
  assert.equal(f.posts.length,1);
  assert.equal(f.rows().length,1);
  assert.equal(f.rows()[0].state,'delivered');
});

test('missing migration or invalid activation config preserves the source sweep, HQ alerts and later recovery', async t => {
  const f=fixture(t), warnings: string[]=[];
  t.mock.method(console,'warn',(...args) => { if (String(args[0]).startsWith('[section-capacity-slack]')) warnings.push(args.join(' ')); });
  f.db.exec('DROP TABLE section_capacity_slack_deliveries');
  const opening = await f.sweep(0);
  assert.equal(opening.section_delivery,'unavailable');
  assert.equal(f.db.prepare("SELECT state FROM platform_capacity_alerts WHERE metric_key='d1.size_bytes'").get().state,'open');
  f.setSize(GB);
  f.env.AXAL_SECTION_CAPACITY_SLACK_START_UTC='invalid';
  const closing = await f.sweep(15);
  assert.equal(closing.section_delivery,'unavailable');
  assert.equal(f.db.prepare("SELECT state FROM platform_capacity_alerts WHERE metric_key='d1.size_bytes'").get().state,'cleared');
  assert.deepEqual(warnings,Array(2).fill('[section-capacity-slack] delivery pass unavailable'));
  assert.equal(f.posts.length,0);
});
