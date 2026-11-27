import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import type { Env } from '../src/types';
import { makeD1 } from './_d1_sqlite.mjs';
import { drainSectionIncidents, enqueueSectionIncident } from '../src/services/sectionIncidentOutbox';

const section = 'axalvc-superadmin-platform';
const impacted = 'axalvc-admin-programs';
const channel = 'CTEST00001';
const team = 'TTEST00001';
const root = '1794000000.000001';
const time = (minutes: number) => new Date(Date.UTC(2026, 10, 14) + minutes * 60_000);

function fixture(t: TestContext) {
  const { DB, db } = makeD1(readFileSync(new URL('../sql/migrations/202611141540_5979_section_incident_outbox.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  const env = { DB, SLACK_BOT_TOKEN: 'fixture', AXAL_SECTION_SLACK_TEAM_ID: team,
    AXAL_SECTION_SLACK_CHANNELS: JSON.stringify({ [section]: channel, [impacted]: 'CTEST00002' }) } as unknown as Env;
  const posts: Array<{ channel: string; text: string; thread_ts?: string }> = [];
  const replies: Response[] = [];
  let verified = true, unavailable = false;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/api/auth.test') {
      if (unavailable) return new Response('', { status: 503 });
      return Response.json({ ok: true, team_id: verified ? team : 'TOTHER0001', bot_id: 'BTEST00001' });
    }
    if (path === '/api/users.conversations') return Response.json({ ok: true, channels: [{ id: channel, name: section,
      is_channel: true, is_private: true, is_archived: false, is_shared: false, is_ext_shared: false, is_pending_ext_shared: false }] });
    assert.equal(path, '/api/chat.postMessage');
    posts.push(JSON.parse(String(init.body)));
    return replies.shift() ?? Response.json({ ok: true, channel, ts: posts.length === 1 ? root : '1794000000.000002' });
  });
  const enqueue = (details: { eventId: string } & ({ kind: 'occurrence' | 'recovery' } | { kind: 'version'; version: string })) => {
    const tasks: Promise<unknown>[] = [];
    enqueueSectionIncident(env, { waitUntil: task => tasks.push(task) }, {
      episodeId: 'episode-1', fingerprint: 'fingerprint-1', section, impactedSections: [impacted], ...details,
    });
    return Promise.all(tasks);
  };
  return { env, enqueue, posts, replies, drain: (minutes: number) => drainSectionIncidents(env, time(minutes)),
    rejectPermission: () => { verified = false; }, stopProvider: () => { unavailable = true; },
    rows: () => db.prepare('SELECT * FROM section_incident_outbox').all() };
}

test('one root, deduplicated observations, and threaded recurrence, version and recovery', async t => {
  const f = fixture(t);
  await Promise.all([f.enqueue({ kind: 'occurrence', eventId: 'a' }), f.enqueue({ kind: 'occurrence', eventId: 'a' })]);
  await Promise.all([f.drain(0), f.drain(0)]);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0].checkpoint, 1);
  assert.equal(f.posts.length, 1);
  assert.match(f.posts[0].text, /axalvc-admin-programs/);
  await f.enqueue({ kind: 'recovery', eventId: 'delayed-recovery' });
  await f.enqueue({ kind: 'occurrence', eventId: 'b' });
  await f.enqueue({ kind: 'version', eventId: 'v1', version: 'v1' });
  for (const minute of [15, 30, 45, 60]) await f.drain(minute);
  assert.deepEqual(f.posts.map(p => [p.channel, p.thread_ts]), [[channel, undefined], [channel, root], [channel, root], [channel, root]]);
  assert.deepEqual(f.posts.slice(1).map(p => p.text), [
    'Incident recurred. Recorded occurrences: 2.', 'Version: v1.', 'Incident recovered.',
  ]);
  assert.equal(f.rows()[0].state, 'delivered');
  assert.equal(f.rows()[0].occurrence_total, 2);
});

test('missing bindings and destination never post', async t => {
  const f = fixture(t);
  await f.enqueue({ kind: 'occurrence', eventId: 'a' });
  const channels = f.env.AXAL_SECTION_SLACK_CHANNELS;
  delete f.env.AXAL_SECTION_SLACK_CHANNELS;
  assert.equal(await f.drain(0), 'unconfigured');
  f.env.AXAL_SECTION_SLACK_CHANNELS = '{}';
  await f.drain(0);
  assert.equal(f.rows()[0].last_reason, 'unknown_section');
  f.env.AXAL_SECTION_SLACK_CHANNELS = channels;
  f.rejectPermission();
  await f.drain(15);
  assert.equal(f.rows()[0].last_reason, 'workspace_mismatch');
  assert.equal(f.posts.length, 0);
});

test('Slack outage is bounded, provider throttling honors Retry-After, and ambiguous posts never retry', async t => {
  const f = fixture(t);
  await f.enqueue({ kind: 'occurrence', eventId: 'a' });
  f.replies.push(new Response('', { status: 429, headers: { 'Retry-After': '1800' } }));
  await f.drain(0);
  await f.drain(29);
  assert.equal(f.posts.length, 1);
  f.replies.push(Response.json({ ok: true, channel }));
  await f.drain(30);
  await f.enqueue({ kind: 'recovery', eventId: 'b' });
  await f.drain(300);
  assert.equal(f.posts.length, 2);
  assert.equal(f.rows()[0].state, 'uncertain');
});

test('preflight outage exhausts after five definite failures without posting', async t => {
  const f = fixture(t);
  await f.enqueue({ kind: 'occurrence', eventId: 'a' });
  f.stopProvider();
  for (const minute of [0, 15, 45, 105, 225, 500]) await f.drain(minute);
  assert.equal(f.rows()[0].state, 'exhausted');
  assert.equal(f.rows()[0].attempts, 5);
  assert.equal(f.posts.length, 0);
});

test('background storage failure is caught and logged with a fixed diagnostic', async t => {
  const log = t.mock.method(console, 'warn', () => {});
  const env = { DB: { prepare() { throw new Error('storage down'); } } } as unknown as Env;
  const tasks: Promise<unknown>[] = [];
  assert.doesNotThrow(() => enqueueSectionIncident(env, { waitUntil: task => tasks.push(task) }, {
    episodeId: 'episode', eventId: 'event', fingerprint: 'fingerprint', section, kind: 'occurrence',
  }));
  assert.equal(tasks.length, 1);
  await Promise.all(tasks);
  assert.deepEqual(log.mock.calls[0].arguments, ['[section-incident-outbox] enqueue failed', { count: 1 }]);
});
