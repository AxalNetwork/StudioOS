/**
 * D5864 (#5864, part 2b of #2401) — "Add TikTok as a channel", against the stubbed Display API and the Grow world the
 * part 2a test uses (`tiktok_grow_5863.test.ts`): real SQL on node:sqlite, the real routes. Every name, id and figure
 * is invented.
 *
 *  1. A sync raises the proposal once; Accept creates exactly one `growth_channels` row through the existing writer.
 *  2. It is not raised when a TikTok channel exists, and Accept never makes a second one.
 *  3. A dismissed proposal never returns after a re-sync.
 *  4. Only the founder accepts or dismisses; a support session and a co-founder are refused.
 *  5. The writes are logged through `logGrowWrite`, counts only.
 *  6. Disconnect and the deauthorization webhook delete the connection's proposals; an accepted channel stays.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/tiktok_proposals_5864.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { getProviderImpl } from '../src/integrations/registry.ts';
import '../src/integrations/providers/tiktok.ts';
import { SENTENCES, purgeByOpenIdStatements } from '../src/services/tiktok/grow.ts';
import { COFOUNDER, FOUNDER, PID, ROLE, growDb } from './_mercury_grow_fixture.ts';

const TT = 61;
const COMPANY = 70;
const OPEN_ID = 'open-id-fixture-2';
const M = 'cloudflare-worker/sql/migrations';
const migration = (issue: number, slug: string) => readdirSync(M).find((f) => /^\d{12}_/.test(f) && f.slice(13) === `${issue}_${slug}.sql`)!;
// D5614: a fixed clock. The sync stamps today's snapshot from Date, so Date is mocked to one instant.
mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 16, 10, 0, 0) });
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.list'];

/** TikTok's Display API, as the client reads it: one account, one video. */
function tiktokApi() {
  const s = { revoked: 0 };
  const fetch = async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === '/v2/oauth/revoke/') { s.revoked += 1; return new Response('{}', { status: 200 }); }
    if (url.origin !== 'https://open.tiktokapis.com') throw new Error(`unexpected origin ${url.origin}`);
    if (url.pathname === '/v2/user/info/') return Response.json({ data: { user: { follower_count: 4321, following_count: 7, likes_count: 8765, video_count: 1 } }, error: { code: 'ok' } });
    if (url.pathname === '/v2/video/list/') {
      return Response.json({ data: { videos: [{ id: '9101', create_time: 1762000000, title: 'Demo reel', view_count: 6543 }], cursor: 0, has_more: false }, error: { code: 'ok' } });
    }
    return new Response('{}', { status: 404 });
  };
  return { s, fetch };
}

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function world() {
  const { db, env } = await growDb();
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  db.exec(readFileSync(`${M}/435_connector_companies.sql`, 'utf8'));
  // The channel writer's columns (D4486), so Accept runs the real `addChannel`.
  db.exec(readFileSync(`${M}/202611041912_growth_channel_details.sql`, 'utf8'));
  db.exec(readFileSync(`${M}/${migration(5863, 'tiktok_grow_facts')}`, 'utf8'));
  db.exec(readFileSync(`${M}/${migration(5864, 'tiktok_proposals')}`, 'utf8'));
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY, FOUNDER);
  env.RATE_LIMITS = kv();
  env.TIKTOK_CLIENT_KEY = 'fake-key';
  env.TIKTOK_CLIENT_SECRET = 'fake-secret';
  const enc = await encryptCredentials(env, `tt-${TT}`, { access_token: 'tok-61', refresh_token: 'r', open_id: OPEN_ID, scope: SCOPES.join(','), expires_at: Date.now() + 3_600_000 } as any);
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc, scopes_json, external_account_id) VALUES (?, ?, ?, 'tiktok', 'active', 'oauth2', ?, ?, ?)")
    .run(TT, `tt-${TT}`, FOUNDER, enc, JSON.stringify(SCOPES), OPEN_ID);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(TT, COMPANY);
  return { db, env, api: tiktokApi() };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);

async function call(w: any, who: number, method: string, path: string, body?: unknown, support = false) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...(support ? { impersonated_by: 3 } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const real = globalThis.fetch;
  globalThis.fetch = w.api.fetch as any;
  try {
    const res = await app.fetch(new Request(`http://t${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), w.env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json() as any };
  } finally { globalThis.fetch = real; }
}

const sync = (w: any) => call(w, FOUNDER, 'POST', '/api/cycles/grow/tiktok/sync', { project: PID });
const proposalPart = async (w: any, who = FOUNDER) => (await call(w, who, 'GET', `/api/cycles/grow/modules/distribution?project=${PID}`)).body.parts.from_tiktok.proposal;
const decide = (w: any, id: number, verb: 'accept' | 'dismiss', who = FOUNDER, support = false) =>
  call(w, who, 'POST', `/api/cycles/grow/tiktok/proposals/${id}/${verb}`, { project: PID }, support);
const proposals = (db: any) => db.prepare('SELECT id, integration_id, kind, subject, state, growth_channel_id, decided_by FROM tiktok_proposals').all().map((r: any) => ({ ...r }));
const tiktokChannels = (db: any) => db.prepare("SELECT id, uid, name, utm_source, kind, created_by FROM growth_channels WHERE project_id = ? AND utm_source = 'tiktok'").all(PID).map((r: any) => ({ ...r }));
const activity = (db: any, action: string) => db.prepare('SELECT entity_id, details FROM activity_logs WHERE action = ?').all(action).map((r: any) => ({ ...r }));

test('1. a sync raises the proposal once; Accept creates exactly one growth_channels row through the existing writer', async () => {
  const w = await world();
  const first = await sync(w);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.counts.proposals, 1);
  const [p] = proposals(w.db);
  assert.deepEqual([p.integration_id, p.kind, p.subject, p.state], [TT, 'add_channel', 'tiktok', 'pending']);
  assert.equal((await sync(w)).body.counts.proposals, 0, 'a pending proposal is not raised twice');
  assert.equal(proposals(w.db).length, 1);

  assert.deepEqual(await proposalPart(w), { id: p.id, kind: 'add_channel', state: 'pending', can_decide: true, sentence: SENTENCES.add_channel, channel: null });
  assert.equal((await proposalPart(w, COFOUNDER)).can_decide, false, 'a co-founder sees it but cannot decide it');

  const ok = await decide(w, p.id, 'accept');
  assert.deepEqual([ok.status, ok.body], [200, { ok: true, id: p.id, state: 'accepted' }]);
  const channels = tiktokChannels(w.db);
  assert.equal(channels.length, 1, 'exactly one TikTok channel');
  assert.deepEqual([channels[0].name, channels[0].utm_source, channels[0].kind, channels[0].created_by], ['TikTok', 'tiktok', 'organic', FOUNDER]);
  // The existing writer (`addChannel`) logs its own row; a second writer would not.
  assert.deepEqual(activity(w.db, 'grow_channel_added').map((a: any) => a.entity_id), [channels[0].uid]);
  assert.deepEqual(proposals(w.db).map((r: any) => [r.state, r.growth_channel_id, r.decided_by]), [['accepted', channels[0].id, FOUNDER]]);

  const again = await decide(w, p.id, 'accept');
  assert.deepEqual([again.status, again.body.error], [409, 'proposal_decided']);
  assert.equal((await sync(w)).body.counts.proposals, 0);
  assert.equal(tiktokChannels(w.db).length, 1, 'still exactly one');
  assert.deepEqual(await proposalPart(w), { id: p.id, kind: 'add_channel', state: 'accepted', can_decide: false, sentence: null, channel: { uid: channels[0].uid, name: 'TikTok' } });
});

test('2. it is not raised when a TikTok channel exists, and Accept never makes a second one', async () => {
  const w = await world();
  const added = await call(w, FOUNDER, 'POST', '/api/cycles/grow/channels', { project: PID, name: 'Short video', utm_source: 'TikTok' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const out = await sync(w);
  assert.equal(out.body.counts.proposals, 0);
  assert.deepEqual(proposals(w.db), [], 'nothing raised');
  assert.equal(await proposalPart(w), null);

  // Raised first, then the founder adds a TikTok channel by hand: the proposal is hidden and Accept adds nothing.
  const v = await world();
  await sync(v);
  const [p] = proposals(v.db);
  await call(v, FOUNDER, 'POST', '/api/cycles/grow/channels', { project: PID, name: 'TikTok organic', utm_source: 'tiktok' });
  assert.equal(await proposalPart(v), null, 'a TikTok channel already exists');
  const accept = await decide(v, p.id, 'accept');
  assert.deepEqual([accept.status, accept.body.error], [409, 'channel_exists']);
  assert.equal(tiktokChannels(v.db).length, 1);
  assert.equal(proposals(v.db)[0].state, 'pending');
});

test('3. a dismissed proposal never returns after a re-sync', async () => {
  const w = await world();
  await sync(w);
  const [p] = proposals(w.db);
  const out = await decide(w, p.id, 'dismiss');
  assert.deepEqual([out.status, out.body], [200, { ok: true, id: p.id, state: 'dismissed' }]);
  for (let i = 0; i < 2; i += 1) assert.equal((await sync(w)).body.counts.proposals, 0);
  assert.deepEqual(proposals(w.db).map((r: any) => [r.id, r.state, r.decided_by]), [[p.id, 'dismissed', FOUNDER]]);
  assert.equal(await proposalPart(w), null);
  assert.deepEqual([(await decide(w, p.id, 'accept')).status, (await decide(w, p.id, 'dismiss')).body.error], [409, 'proposal_decided']);
  assert.deepEqual(tiktokChannels(w.db), [], 'no channel after a dismissal');
  assert.deepEqual([(await decide(w, p.id + 99, 'dismiss')).status, (await decide(w, p.id + 99, 'accept')).body.error], [404, 'proposal_not_found']);
});

test('4. only the founder accepts or dismisses; a support session and a co-founder are refused', async () => {
  const w = await world();
  await sync(w);
  const [p] = proposals(w.db);
  for (const verb of ['accept', 'dismiss'] as const) {
    const support = await decide(w, p.id, verb, FOUNDER, true);
    assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
    const cofounder = await decide(w, p.id, verb, COFOUNDER);
    assert.deepEqual([cofounder.status, cofounder.body.error], [403, 'not_founder']);
  }
  assert.equal(proposals(w.db)[0].state, 'pending');
  assert.deepEqual(tiktokChannels(w.db), []);
  assert.equal((await proposalPart(w)).can_decide, true);
});

test('5. the writes are logged through logGrowWrite, counts only', async () => {
  const w = await world();
  const lines: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    await sync(w);
    const [p] = proposals(w.db);
    await decide(w, p.id, 'accept');
  } finally { Object.assign(console, keep); }
  const id = proposals(w.db)[0].id;
  assert.deepEqual(activity(w.db, 'grow_tiktok_synced').map((a: any) => a.details), ['Grow synced from TikTok: 1 snapshot, 1 videos, 0 kept deleted, 1 proposal']);
  assert.deepEqual(activity(w.db, 'grow_tiktok_channel_accepted'), [{ entity_id: String(id), details: 'TikTok channel proposal accepted: 1 channel added' }]);

  const v = await world();
  await sync(v);
  await decide(v, proposals(v.db)[0].id, 'dismiss');
  assert.deepEqual(activity(v.db, 'grow_tiktok_channel_dismissed').map((a: any) => a.details), ['TikTok channel proposal dismissed']);

  const logged = JSON.stringify([lines, w.db.prepare('SELECT * FROM activity_logs').all()]);
  for (const never of ['4321', '8765', '6543', 'Demo reel', OPEN_ID, 'tok-61']) assert.ok(!logged.includes(never), `a log holds ${never}`);
});

test('6. disconnect and the deauthorization webhook delete the connection\'s proposals; an accepted channel stays', async () => {
  const w = await world();
  await sync(w);
  await decide(w, proposals(w.db)[0].id, 'accept');
  const real = globalThis.fetch;
  globalThis.fetch = w.api.fetch as any;
  try {
    await getProviderImpl('tiktok')!.disconnect!({ env: w.env } as any, { id: FOUNDER } as any, w.db.prepare('SELECT * FROM integrations WHERE id = ?').get(TT));
  } finally { globalThis.fetch = real; }
  assert.equal(w.api.s.revoked, 1);
  assert.deepEqual(proposals(w.db), [], 'the proposal went with the connection');
  assert.equal(tiktokChannels(w.db).length, 1, 'the channel the founder accepted is the venture\'s');

  const v = await world();
  await sync(v);
  await decide(v, proposals(v.db)[0].id, 'dismiss');
  // The webhook's cutoff is TikTok's event time; take it from the row's own stamp, so no clock is read.
  const cutoff = Number(v.db.prepare('SELECT unixepoch(updated_at) AS t FROM integrations WHERE id = ?').get(TT).t);
  await v.env.DB.batch(purgeByOpenIdStatements(v.env, OPEN_ID, cutoff));
  assert.deepEqual(proposals(v.db), []);
});
