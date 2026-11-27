/**
 * D8815 (#8815, part 3a of #2403) — a founder's own X in Grow, against a fake X API, on the Grow world Mercury's
 * tests use (`_mercury_grow_fixture.ts`): real SQL on node:sqlite, the real routes. No test reaches X. Every name, id,
 * token and figure is invented.
 *
 *  1. A sync lands today's snapshot and the founder's posts through the ledger, links the venture, writes no KPI and
 *     no post text, and the two module parts read them by post and by month.
 *  2. A figure X did not give reads Not recorded, never 0; engagement is computed and says so.
 *  3. A re-sync updates the same rows, and a deleted fact stays deleted.
 *  4. The monthly budget: a spent month refuses before any call to X; reads reserve before and refund after; the
 *     budget running out mid-sync stops it "Partly synced".
 *  5. A failed read is partial or a refusal; an unreadable part keeps the module.
 *  6. Who: a support session, no connection and a switched-off company are refused; one account per venture; the
 *     figures are the team's only.
 *  7. Disconnect deletes the fed facts, their ledger rows and the link, whether or not X revokes; the budget stays.
 *  8. Logs carry counts only; the feeds, the registry, "Now fed by" and the page agree; only reads.ts names the reads.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/x_grow_8815.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, getProviderImpl } from '../src/integrations/registry.ts';
import '../src/integrations/providers/x.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { fedCounts } from '../src/integrations/fed.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';
import { X_BUILT_FEEDS, X_FEEDS, X_FEED_LIST } from '../src/integrations/xFeeds.ts';
import { parseAudience, parsePosts, PAGE_MAX } from '../src/services/x/reads.ts';
import { X_FOUNDER_MONTHLY_READS } from '../src/services/x/budget.ts';
import { SENTENCES } from '../src/services/x/growFeeds.ts';
import { ADMIN, ADVISOR, COFOUNDER, FOUNDER, PID, ROLE, growDb } from './_mercury_grow_fixture.ts';

const XI = 81;
const OTHER = 82;
const COMPANY = 70;
const X_USER = '4242';
const M = 'cloudflare-worker/sql/migrations';
const MIGRATION = readdirSync(M).find((f) => /^\d{12}_8815_x_grow_facts\.sql$/.test(f))!;
// D5614: a fixed clock. The sync stamps today's snapshot and the budget's month from Date.
const NOW = Date.UTC(2026, 10, 27, 10, 0, 0);
const TODAY = '2026-11-27';
const MONTH = '2026-11';
mock.timers.enable({ apis: ['Date'], now: NOW });

const post = (id: string, at: string, m: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id, created_at: at, text: `secret words ${id}`, author_id: X_USER, public_metrics: m, ...extra });
const full = (impressions: number, likes: number) => ({ impression_count: impressions, like_count: likes, retweet_count: 2, reply_count: 1, quote_count: 0, bookmark_count: 3 });

/** X's API v2, as the founder's reads and the provider's revoke call it. */
function xApi() {
  const s = {
    me: { followers_count: 1530, following_count: 210, tweet_count: 88, listed_count: 4 } as Record<string, unknown>,
    pages: [[
      post('1901', '2026-11-20T09:00:00Z', full(4000, 120)),
      post('1902', '2026-11-02T09:00:00Z', { impression_count: 900, like_count: 30, retweet_count: 1, reply_count: 0, quote_count: 0 }),
    ], [
      post('1801', '2026-10-15T09:00:00Z', { like_count: 4, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0 }),
    ]] as Array<Array<Record<string, unknown>>>,
    fail: {} as Record<string, number>,
    failRevoke: false,
    calls: [] as Array<{ path: string; query: URLSearchParams; method: string }>,
    revoked: 0,
  };
  const fetch = async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://api.x.com') throw new Error(`unexpected origin ${url.origin}`);
    const method = String(init.method || 'GET');
    s.calls.push({ path: url.pathname, query: url.searchParams, method });
    if (url.pathname === '/2/oauth2/revoke') { if (s.failRevoke) return new Response('no', { status: 503 }); s.revoked += 1; return Response.json({ revoked: true }); }
    const key = url.pathname === '/2/users/me' ? 'me' : url.pathname === `/2/users/${X_USER}/tweets` ? 'posts' : null;
    if (!key) return new Response('{}', { status: 404 });
    if (s.fail[key]) return new Response('{"detail":"upstream words"}', { status: s.fail[key] });
    if (key === 'me') return Response.json({ data: { id: X_USER, name: 'Fixture Founder', username: 'fixture_founder', public_metrics: s.me } });
    const at = url.searchParams.get('pagination_token') ? Number(url.searchParams.get('pagination_token')!.slice(1)) : 0;
    const more = at + 1 < s.pages.length;
    return Response.json({ data: s.pages[at] ?? [], meta: { result_count: (s.pages[at] ?? []).length, ...(more ? { next_token: `p${at + 1}` } : {}) } });
  };
  return { s, fetch };
}

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function signedIn(db: any, env: any, id: number, user: number, company = COMPANY) {
  const uid = `xi-${id}`;
  const enc = await encryptCredentials(env, uid, { access_token: `fixture-access-${id}`, refresh_token: `fixture-refresh-${id}`, scope: 'tweet.read users.read offline.access', expires_at: Date.now() + 3_600_000 } as any);
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc, scopes_json, config_json, external_account_id)
    VALUES (?, ?, ?, 'x', 'active', 'oauth2', ?, ?, ?, ?)`)
    .run(id, uid, user, enc, JSON.stringify(['tweet.read', 'users.read', 'offline.access']),
      JSON.stringify({ x_user_id: X_USER, handle: 'fixture_founder', granted_scopes: ['tweet.read', 'users.read', 'offline.access'], publish_on: false }), X_USER);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(id, company);
}

async function world() {
  _clearOauthCredsCache();
  const { db, env } = await growDb();
  db.exec(readFileSync(`${M}/435_connector_companies.sql`, 'utf8'));
  db.exec(readFileSync(`${M}/${MIGRATION}`, 'utf8'));
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY, FOUNDER);
  env.RATE_LIMITS = kv();
  env.X_FOUNDERS_CLIENT_ID = 'fixture-founders-client';
  env.X_FOUNDERS_CLIENT_SECRET = crypto.randomUUID();
  await signedIn(db, env, XI, FOUNDER);
  return { db, env, api: xApi() };
}
type W = Awaited<ReturnType<typeof world>>;

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);

async function call(w: W, who: number, method: string, path: string, body?: unknown, support = false) {
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

const sync = (w: W, who = FOUNDER, support = false) => call(w, who, 'POST', '/api/cycles/grow/x/sync', { project: PID }, support);
const read = (w: W, slug: string, who = FOUNDER) => call(w, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}`);
const snapshots = (db: any) => db.prepare('SELECT * FROM x_grow_audience_facts ORDER BY snapshot_date').all() as any[];
const posts = (db: any) => db.prepare('SELECT * FROM x_grow_post_facts ORDER BY post_id').all() as any[];
const ledger = (db: any) => db.prepare('SELECT kind, module, local_table, local_id FROM connector_fed_items ORDER BY kind, external_id').all() as any[];
const used = (db: any, user = FOUNDER) => (db.prepare('SELECT reads FROM x_founder_usage WHERE user_id = ? AND period = ?').get(user, MONTH) as any)?.reads ?? null;
const spend = (db: any, reads: number, user = FOUNDER) => db.prepare('INSERT INTO x_founder_usage (user_id, period, reads) VALUES (?, ?, ?) ON CONFLICT(user_id, period) DO UPDATE SET reads = excluded.reads').run(user, MONTH, reads);
const xCalls = (w: W) => w.api.s.calls.filter((c) => c.path !== '/2/oauth2/revoke').map((c) => `${c.method} ${c.path}`);

test('1. a sync lands the snapshot and the founder\'s posts through the ledger, links the venture, and the parts read them', async () => {
  const w = await world();
  const out = await sync(w);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.counts, { snapshots: 1, posts: 3, kept_deleted: 0, partial: false, outcome: 'Synced', capped: false });
  assert.deepEqual(out.body.reads, { used: 4, left: X_FOUNDER_MONTHLY_READS - 4, cap: X_FOUNDER_MONTHLY_READS });
  assert.deepEqual(snapshots(w.db).map((r) => [r.snapshot_date, r.followers, r.following, r.post_count, r.integration_id]), [[TODAY, 1530, 210, 88, XI]]);
  assert.deepEqual(posts(w.db).map((p) => [p.post_id, p.posted_on, p.impressions, p.likes, p.reposts, p.replies, p.quotes, p.bookmarks]), [
    ['1801', '2026-10-15', null, 4, 0, 0, 0, 0], ['1901', '2026-11-20', 4000, 120, 2, 1, 0, 3], ['1902', '2026-11-02', 900, 30, 1, 0, 0, null],
  ]);
  assert.deepEqual(ledger(w.db).map((l) => [l.kind, l.module, l.local_table]), [
    ['x_audience_snapshot', 'revenue_and_traction', 'x_grow_audience_facts'],
    ['x_post', 'distribution', 'x_grow_post_facts'], ['x_post', 'distribution', 'x_grow_post_facts'], ['x_post', 'distribution', 'x_grow_post_facts'],
  ]);
  assert.deepEqual(w.db.prepare('SELECT integration_id, project_id, partly_synced FROM x_grow_links').all().map((r: any) => ({ ...r })), [{ integration_id: XI, project_id: PID, partly_synced: 0 }]);
  const stored = JSON.stringify([snapshots(w.db), posts(w.db), ledger(w.db)]);
  for (const never of ['secret words', 'fixture_founder', 'Fixture Founder']) assert.ok(!stored.includes(never), `${never} is stored`);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM project_metrics').get().n, 0, 'no X figure is a metric');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM custom_kpi_values').get().n, 0, 'no X figure is a KPI value');
  assert.deepEqual(xCalls(w), ['GET /2/users/me', `GET /2/users/${X_USER}/tweets`, `GET /2/users/${X_USER}/tweets`]);
  const first = w.api.s.calls[1].query;
  assert.deepEqual([first.get('max_results'), first.get('exclude'), first.get('tweet.fields'), first.get('pagination_token')], [String(PAGE_MAX), 'retweets', 'created_at,public_metrics', null]);
  assert.equal(w.api.s.calls[2].query.get('pagination_token'), 'p1');

  const rev = (await read(w, 'revenue-and-traction')).body.parts.from_x;
  assert.equal(rev.state, 'ok');
  assert.equal(rev.source, `From X, as of ${TODAY}`);
  assert.equal(rev.note, SENTENCES.not_revenue);
  assert.deepEqual(rev.figures.map((f: any) => [f.key, f.count, f.change]), [['followers', 1530, null]]);
  assert.deepEqual(rev.months.map((m: any) => [m.period, m.followers.count, m.posts.count, m.impressions.count, m.engagement.count]), [
    ['2026-11', 1530, 2, 4900, 126], ['2026-10', null, 1, null, 4],
  ]);
  assert.equal(rev.posts, undefined, 'Revenue and traction lists no posts');
  const dist = (await read(w, 'distribution')).body.parts.from_x;
  assert.deepEqual(dist.posts.map((p: any) => [p.post_id, p.engagement]), [['1901', 126], ['1902', null], ['1801', 4]]);
  assert.equal(dist.note, SENTENCES.own_posts);
  assert.equal(dist.engagement_note, SENTENCES.engagement);
});

test('2. a figure X did not give reads Not recorded, never 0', async () => {
  const w = await world();
  w.api.s.me = { followers_count: -1, tweet_count: 12 };
  await sync(w);
  assert.deepEqual(snapshots(w.db).map((r) => [r.followers, r.following, r.post_count]), [[null, null, 12]]);
  const rev = (await read(w, 'revenue-and-traction')).body.parts.from_x;
  assert.deepEqual([rev.figures[0].count, rev.figures[0].reason], [null, SENTENCES.no_followers]);
  const [nov, oct] = rev.months;
  assert.deepEqual([nov.followers.count, nov.followers.reason], [null, SENTENCES.no_followers]);
  assert.deepEqual([oct.followers.count, oct.followers.reason], [null, SENTENCES.no_month_followers]);
  assert.deepEqual([oct.impressions.count, oct.impressions.reason], [null, 'Not recorded: X gave no impressions for these posts']);
  assert.deepEqual([nov.engagement.count, nov.engagement.reason], [126, '1 post had no engagement from X; the total leaves it out']);
  assert.equal(nov.impressions.reason, null);
  const dist = (await read(w, 'distribution')).body.parts.from_x;
  const byId = Object.fromEntries(dist.posts.map((p: any) => [p.post_id, p]));
  assert.deepEqual(byId['1902'].reasons, { bookmarks: 'Not recorded: X gave no figure for this post', engagement: 'Not recorded: X did not give every part of this post’s engagement' });
  assert.deepEqual(byId['1801'].reasons, { impressions: 'Not recorded: X gave no figure for this post' });
  assert.deepEqual(byId['1901'].reasons, {});

  // Field by field: a negative, a fraction or a string is null; a post id that is not X's digits is dropped.
  assert.deepEqual(parseAudience({ data: { public_metrics: { followers_count: 1.5, following_count: '9', tweet_count: 0 } } }), { followers: null, following: null, post_count: 0 });
  const page = parsePosts({ data: [{ id: '77', created_at: 'not a date', public_metrics: { impression_count: -4, like_count: 2 } }, { id: 'abc' }, null], meta: { next_token: 'bad token!' } });
  assert.deepEqual([page.posts.map((p) => [p.id, p.posted_on, p.impressions, p.likes, p.reposts]), page.next, page.returned], [[['77', null, null, 2, null]], null, 3]);

  // Linked, nothing landed: not synced yet. Not linked: how to connect.
  const e = await world();
  assert.deepEqual([(await read(e, 'distribution')).body.parts.from_x.state, (await read(e, 'distribution')).body.parts.from_x.connect_href], ['not_linked', '/account/connectors/x']);
  e.api.s.me = {};
  e.api.s.pages = [[]];
  await sync(e);
  const none = (await read(e, 'distribution')).body.parts.from_x;
  assert.deepEqual([none.state, none.reason], ['not_recorded', SENTENCES.not_synced]);
});

test('3. a re-sync updates the same rows, and a deleted fact stays deleted', async () => {
  const w = await world();
  await sync(w);
  const before = posts(w.db).map((p) => p.id);
  (w.api.s.pages[0][0].public_metrics as any).impression_count = 5200;
  const again = await sync(w);
  assert.equal(again.body.counts.posts, 3);
  assert.deepEqual(posts(w.db).map((p) => p.id), before, 'the same rows');
  assert.equal(posts(w.db).find((p) => p.post_id === '1901').impressions, 5200);
  assert.equal(snapshots(w.db).length, 1, 'one snapshot per day');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM connector_fed_items').get().n, 4, 'no ledger row is duplicated');

  const victim = posts(w.db).find((p) => p.post_id === '1901').id;
  const del = await call(w, COFOUNDER, 'DELETE', `/api/cycles/grow/x/facts/${victim}?project=${PID}&kind=post`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const snap = snapshots(w.db)[0].id;
  assert.equal((await call(w, FOUNDER, 'DELETE', `/api/cycles/grow/x/facts/${snap}?project=${PID}&kind=audience`)).status, 200);
  const third = await sync(w);
  assert.equal(third.body.counts.kept_deleted, 2);
  assert.deepEqual(posts(w.db).map((p) => p.post_id), ['1801', '1902'], 'the deleted post is not re-created');
  assert.equal(snapshots(w.db).length, 0, 'the deleted snapshot is not re-created');
  assert.equal((await call(w, FOUNDER, 'DELETE', `/api/cycles/grow/x/facts/${victim}?project=${PID}&kind=post`)).body.error, 'fact_not_found');
  assert.equal((await call(w, FOUNDER, 'DELETE', `/api/cycles/grow/x/facts/1?project=${PID}`)).body.error, 'bad_kind');
  assert.equal((await call(w, ADVISOR, 'DELETE', `/api/cycles/grow/x/facts/${snap}?project=${PID}&kind=audience`)).status, 403, 'a reader cannot delete');
});

test('4. the monthly budget: refused before any call once spent; reserved before and refunded after; partial when it runs out', async () => {
  const w = await world();
  spend(w.db, X_FOUNDER_MONTHLY_READS);
  const refused = await sync(w);
  assert.deepEqual([refused.status, refused.body.error, refused.body.detail], [429, 'x_monthly_cap_reached', 'You have used this month’s X reads. Nothing was read from X; sync again next month.']);
  assert.equal(w.api.s.calls.length, 0, 'nothing was sent to X, not even a token refresh');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM x_grow_links').get().n, 0, 'no link before the refusal');
  assert.equal(used(w.db), X_FOUNDER_MONTHLY_READS);
  // A spent month is the founder's, not the connection's: another month is a fresh budget.
  w.db.prepare("UPDATE x_founder_usage SET period = '2026-10'").run();
  assert.equal((await sync(w)).status, 200);
  assert.equal(used(w.db), 4, 'one user read and three posts returned: the page\'s unused reservation was refunded');

  // Left: one user read and 7 posts. The first page asks for what is left; the second finds fewer than X's minimum.
  const p = await world();
  spend(p.db, X_FOUNDER_MONTHLY_READS - 8);
  p.api.s.pages = [[post('1901', '2026-11-20T09:00:00Z', full(10, 1)), post('1902', '2026-11-19T09:00:00Z', full(10, 1)), post('1903', '2026-11-18T09:00:00Z', full(10, 1))], [post('1801', '2026-10-15T09:00:00Z', full(10, 1))]];
  const part = await sync(p);
  assert.equal(part.status, 200, JSON.stringify(part.body));
  assert.deepEqual([part.body.counts.snapshots, part.body.counts.posts, part.body.counts.capped, part.body.counts.outcome], [1, 3, true, 'Partly synced']);
  assert.equal(p.api.s.calls[1].query.get('max_results'), '7');
  assert.deepEqual(xCalls(p), ['GET /2/users/me', `GET /2/users/${X_USER}/tweets`], 'the second page was not asked for');
  assert.equal(used(p.db), X_FOUNDER_MONTHLY_READS - 4);
  assert.equal((await read(p, 'distribution')).body.parts.from_x.link.partly_synced, true);
  assert.match(JSON.stringify(p.db.prepare('SELECT details FROM activity_logs').all()), /monthly reads used/);

  // A failed call is refunded: X bills nothing it did not return.
  const f = await world();
  f.api.s.fail.me = 500;
  f.api.s.fail.posts = 500;
  assert.equal((await sync(f)).status, 502);
  assert.equal(used(f.db), 0);
});

test('5. a failed read is partial or a refusal; an unreadable part keeps the module', async () => {
  const w = await world();
  w.api.s.fail.me = 500;
  const half = await sync(w);
  assert.equal(half.status, 200);
  assert.deepEqual([half.body.counts.snapshots, half.body.counts.posts, half.body.counts.outcome], [0, 3, 'Partly synced']);

  w.api.s.fail.posts = 500;
  const none = await sync(w);
  assert.deepEqual([none.status, none.body.error], [502, 'x_unreadable']);
  assert.doesNotMatch(JSON.stringify(none.body), /upstream words/, 'X\'s body never reaches the founder');
  w.api.s.fail.me = 429; w.api.s.fail.posts = 429;
  const limited = await sync(w);
  assert.deepEqual([limited.status, limited.body.error], [429, 'rate_limited']);
  w.api.s.fail.me = 401; w.api.s.fail.posts = 401;
  const again = await sync(w);
  assert.deepEqual([again.status, again.body.error], [409, 'sign_in_again']);

  w.db.exec('DROP TABLE x_grow_post_facts');
  const mod = await read(w, 'distribution');
  assert.equal(mod.status, 200);
  assert.deepEqual(mod.body.parts.from_x, { state: 'unreadable', reason: SENTENCES.unreadable });
  assert.ok(mod.body.module, 'the rest of the module still loads');
});

test('6. who: refusals, one account per venture, and the figures are the team\'s only', async () => {
  const w = await world();
  const support = await sync(w, FOUNDER, true);
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  assert.equal((await sync(w, COFOUNDER)).body.error, 'x_not_connected');
  assert.equal(w.api.s.calls.length, 0, 'nothing was read');

  await sync(w);
  await signedIn(w.db, w.env, OTHER, COFOUNDER);
  const served = await sync(w, COFOUNDER);
  assert.deepEqual([served.status, served.body.error], [409, 'venture_served']);

  w.db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (8, 'p8', 'Second', 10, ?)").run(COMPANY);
  w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (8, ?, 'cofounder', 'accepted')").run(FOUNDER);
  const elsewhere = await call(w, FOUNDER, 'POST', '/api/cycles/grow/x/sync', { project: 8 });
  assert.deepEqual([elsewhere.status, elsewhere.body.error], [409, 'serves_other_venture']);

  // The team sees the figures; an admin or an advisor who reads the venture does not.
  assert.equal((await read(w, 'distribution', COFOUNDER)).body.parts.from_x.state, 'ok');
  assert.equal((await read(w, 'distribution', COFOUNDER)).body.parts.from_x.can_sync, false, 'only the member whose X serves the venture syncs it');
  for (const who of [ADMIN, ADVISOR]) {
    const r = await read(w, 'revenue-and-traction', who);
    assert.equal(r.status, 200, `${who}`);
    assert.deepEqual(r.body.parts.from_x, { state: 'team_only', reason: SENTENCES.team_only });
  }

  w.db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(XI);
  const off = await sync(w);
  assert.deepEqual([off.status, off.body.error], [403, 'company_not_enabled']);
});

test('7. disconnect deletes the fed facts, their ledger rows and the link, whether or not X revokes; the budget stays', async () => {
  for (const failRevoke of [false, true]) {
    const w = await world();
    await sync(w);
    w.api.s.failRevoke = failRevoke;
    const row = w.db.prepare('SELECT * FROM integrations WHERE id = ?').get(XI);
    const real = globalThis.fetch;
    globalThis.fetch = w.api.fetch as any;
    try { await getProviderImpl('x')!.disconnect!({ env: w.env } as any, { id: FOUNDER } as any, row); } finally { globalThis.fetch = real; }
    assert.equal(w.api.s.revoked, failRevoke ? 0 : 2, 'both tokens revoked when X answers');
    assert.deepEqual([snapshots(w.db).length, posts(w.db).length, ledger(w.db).length], [0, 0, 0], `purged (failRevoke=${failRevoke})`);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM x_grow_links').get().n, 0);
    assert.equal(used(w.db), 4, 'reconnecting does not reset a spent month');
  }
});

test('8. logs carry counts only; the feeds, the registry, Now fed by and the page agree; only reads.ts names the reads', async () => {
  const w = await world();
  const lines: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try { await sync(w); w.api.s.fail.me = 500; await sync(w); } finally { Object.assign(console, keep); }
  const activity = JSON.stringify(w.db.prepare('SELECT * FROM activity_logs').all());
  for (const never of ['1530', '4000', '1901', 'fixture_founder', 'fixture-access', 'secret words']) {
    assert.ok(!lines.join('\n').includes(never), `a log line holds ${never}`);
    assert.ok(!activity.includes(never), `the activity log holds ${never}`);
  }
  assert.match(activity, /Grow synced from X: 1 snapshot, 3 posts, 0 kept deleted/);

  const meta = CONNECTOR_METADATA.x;
  assert.deepEqual(meta.pulls, X_BUILT_FEEDS.map((f) => ({ what: f.what, module: f.module })));
  assert.deepEqual([...X_FEEDS].sort(), ['distribution', 'revenue_and_traction']);
  assert.deepEqual(meta.feeds, [...X_FEEDS]);
  assert.deepEqual(X_FEED_LIST.map((f) => [f.key, f.built]), [['audience', true], ['posts', true], ['channel', false]], 'the channel proposal is a later part');
  const page = CONNECTOR_PAGES.x as any;
  assert.deepEqual(page.tools.map((t: any) => [t.name, t.lands_in, t.calls]), X_BUILT_FEEDS.map((f) => [f.key, f.module, [...f.calls]]));

  const fed = await fedCounts(w.env, XI, 'x');
  assert.deepEqual(fed.map((m) => [m.module, m.count, m.linked]).sort(), [['distribution', 3, 3], ['revenue_and_traction', 1, 1]]);

  const files = readdirSync('cloudflare-worker/src', { recursive: true }) as string[];
  const callers = files.filter((f) => f.endsWith('.ts') && readFileSync(`cloudflare-worker/src/${f}`, 'utf8').includes("'/users/:id/tweets'")
    && !f.endsWith('xFeeds.ts') && !f.endsWith('connectorPages.ts'));
  assert.deepEqual(callers.map((f) => f.replaceAll('\\', '/')), ['services/x/reads.ts']);
});
