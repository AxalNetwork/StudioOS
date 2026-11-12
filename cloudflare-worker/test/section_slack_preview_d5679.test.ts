import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import adminSlack from '../src/routes/admin_slack.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { postToChannel } from '../src/services/slackBus.ts';
import { sendSectionPreview } from '../src/services/sectionSlackPreview.ts';

const team = 'TTEST00001';
const channel = 'CTEST00001';
const slug = 'axalvc-founder-build';
const ts = '1780000000.000123';
const destination = { id: channel, name: slug, is_channel: true, is_private: true, is_archived: false,
  is_shared: false, is_ext_shared: false, is_pending_ext_shared: false, context_team_id: team, shared_team_ids: [team] };
const env = { AXAL_SECTION_SLACK_TEAM_ID: team, AXAL_SECTION_SLACK_CHANNELS: JSON.stringify({ [slug]: channel }),
  SLACK_BOT_TOKEN: 'test-only-placeholder', JWT_SECRET: 'local-fixture-only-5679-secret-key' };
const bot = { ok: true, team_id: team, bot_id: 'BTEST00001' };
const receipt = { ok: true, ts, channel };

function slack(t, fixtures) {
  const calls: { path: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    assert.equal(new URL(url).origin, 'https://slack.com');
    assert.equal(init.headers.Authorization, 'Bearer ' + env.SLACK_BOT_TOKEN);
    assert.equal(init.method, path.endsWith('users.conversations') ? 'GET' : 'POST');
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    const value = fixtures[calls.length - 1];
    if (!value) throw new Error('Unexpected Slack request');
    return value instanceof Response ? value : Response.json(value);
  });
  return calls;
}

test('private membership on a later page produces one fixed message and confirmed timestamp', async t => {
  const calls = slack(t, [bot, { ok: true, channels: [], response_metadata: { next_cursor: 'next' } },
    { ok: true, channels: [destination] }, receipt]);
  assert.deepEqual(await sendSectionPreview(env, slug), { ok: true, ts, channel });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3], { path: '/api/chat.postMessage', body: {
    channel, text: '[axalvc][founder][build][test] Section notification delivery check from StudioOS.',
  } });
});

for (const [name, change] of Object.entries({ renamed: { name: 'elsewhere' }, archived: { is_archived: true },
  public: { is_private: false }, shared: { is_shared: true }, external: { is_ext_shared: true },
  pending: { is_pending_ext_shared: true }, wrongWorkspace: { context_team_id: 'TTEST00002' },
  missingSharingState: { is_shared: undefined }, hiddenShare: { shared_team_ids: [team, 'TTEST00002'] } })) {
  test('refuses ' + name + ' before posting', async t => {
    const calls = slack(t, [bot, { ok: true, channels: [{ ...destination, ...change }] }]);
    assert.deepEqual(await sendSectionPreview(env, slug), { ok: false, reason: 'destination_unverified' });
    assert.equal(calls.length, 2);
  });
}

test('unknown family, unassigned section, invalid map and raw IDs do not contact Slack', async t => {
  const calls = slack(t, []);
  for (const key of ['axalvc-unknown-build', 'axalvc-founder-unmapped', '__proto__', channel]) {
    assert.deepEqual(await sendSectionPreview(env, key), { ok: false, reason: 'unknown_section' });
  }
  for (const raw of ['bad json', '[]', JSON.stringify({ [slug]: 'https://example.invalid' })]) {
    assert.deepEqual(await sendSectionPreview({ ...env, AXAL_SECTION_SLACK_CHANNELS: raw }, slug),
      { ok: false, reason: 'invalid_configuration' });
  }
  assert.deepEqual(await sendSectionPreview({}, slug), { ok: false, reason: 'unconfigured' });
  assert.equal(calls.length, 0);
});

test('checks the token workspace and bot identity before reading channels', async t => {
  const calls = slack(t, [{ ...bot, team_id: 'TTEST00002' }, { ...bot, bot_id: null }]);
  for (let i = 0; i < 2; i++) assert.deepEqual(await sendSectionPreview(env, slug), { ok: false, reason: 'workspace_mismatch' });
  assert.ok(calls.every(c => c.path.endsWith('auth.test')));
});

for (const [name, reply, expected] of [
  ['rate limit', new Response('', { status: 429, headers: { 'Retry-After': '8' } }), { ok: false, reason: 'rate_limited', retry_after_seconds: 8 }],
  ['different channel', { ...receipt, channel: 'CTEST00002' }, { ok: false, reason: 'receipt_unconfirmed' }],
  ['missing timestamp', { ok: true, channel }, { ok: false, reason: 'receipt_unconfirmed' }],
  ['logical rejection', { ok: false, error: 'not_in_channel' }, { ok: false, reason: 'post_rejected' }],
]) {
  test('returns explicit outcome for ' + name, async t => {
    const calls = slack(t, [bot, { ok: true, channels: [destination] }, reply]);
    assert.deepEqual(await sendSectionPreview(env, slug), expected);
    assert.equal(calls.length, 3);
  });
}

test('legacy channel-key send still receives and deduplicates a genuine receipt', async t => {
  const calls = slack(t, [receipt]);
  const args = { channel: 'ops' as const, text: 'legacy-5679' };
  const legacy = { ...env, SLACK_CHANNEL_OPS: channel };
  assert.deepEqual(await postToChannel(legacy as any, args), receipt);
  assert.deepEqual(await postToChannel(legacy as any, args), { ok: false, reason: 'deduped' });
  assert.equal(calls.length, 1);
});

test('mounted HQ route enforces elevation, refuses custom input and audits the actual receipt', async t => {
  const schema = ['schema_baseline.sql', 'migrations/277_user_recovery_state.sql',
    'migrations/241_advisor_money_model.sql', 'migrations/264_admin_notices.sql'].map(name =>
    readFileSync('cloudflare-worker/sql/' + name, 'utf8').replaceAll('CREATE TABLE IF NOT EXISTS ', 'CREATE TABLE ')
  ).join('\n');
  const { db, DB } = makeD1(['users', 'super_admins', 'admin_audit_log', 'activity_logs', 'mi_pro_subscriptions',
    'user_recovery_state', 'platform_settings', 'admin_notices'].map(table => {
    const start = schema.indexOf('CREATE TABLE ' + table + ' (');
    assert.ok(start >= 0);
    return schema.slice(start, schema.indexOf(');', start) + 2);
  }).join('\n'));
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=OFF'); // Only the tables read or written in this route are in the fixture.
  db.exec("INSERT INTO users (id,role,name,email) VALUES (1,'admin','HQ','hq@example.test'),(2,'admin','Other','other@example.test')");
  db.exec('INSERT INTO super_admins (user_id) VALUES (1)');
  const a = new Hono().route('/api/admin/slack', adminSlack);
  a.onError((e,c) => c.json({ error: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  const calls = slack(t, [bot, { ok: true, channels: [destination] }, receipt]);
  async function request(user: number, body?: string, branch?: string) {
    const jwt = await new SignJWT({ user_id: user, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
    return a.request('/api/admin/slack/sections/' + slug + '/test', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt }, body },
      { ...env, DB, BRANCH_CODE: branch });
  }
  assert.equal((await request(2)).status, 403);
  assert.equal((await request(1, undefined, 'branch')).status, 403);
  assert.equal((await request(1, JSON.stringify({ channel, text: 'custom' }))).status, 400);
  assert.equal(calls.length, 0);
  const res = await request(1);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), receipt);
  const audit = db.prepare("SELECT filters_json FROM admin_audit_log WHERE action='section_slack_delivery_test'").get();
  assert.deepEqual(JSON.parse(audit.filters_json), { section: slug, ...receipt });
});
