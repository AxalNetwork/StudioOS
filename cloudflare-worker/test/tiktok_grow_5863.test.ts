/**
 * D5863 (#5863, part 2a of #2401) — a founder's own TikTok in Grow, against a stubbed Display API, on the Grow world
 * Mercury's tests use (`_mercury_grow_fixture.ts`): real SQL on node:sqlite, the real routes. Every name, id and
 * figure is invented.
 *
 *  1. A sync lands today's snapshot and the public videos through the ledger, links the venture, and writes no KPI.
 *  2. A re-sync updates the same rows, and a deleted fact stays deleted.
 *  3. A scope not granted is not read and reads Not recorded; a count TikTok did not give is null; never 0.
 *  4. A failed read is partial or a refusal; an unreadable part keeps the module.
 *  5. The page budget stops "Partly synced" with a cursor, and the next sync resumes from it.
 *  6. Who: a support session and a company switched off are refused; one account per venture, both ways.
 *  7. Disconnect and the deauthorization webhook remove the connection's facts and ledger rows.
 *  8. Logs carry counts only; the feeds list, the registry and the page agree; only the client calls the API.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/tiktok_grow_5863.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, getProviderImpl } from '../src/integrations/registry.ts';
import '../src/integrations/providers/tiktok.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { TIKTOK_BUILT_FEEDS, TIKTOK_FEEDS, TIKTOK_FEED_LIST } from '../src/integrations/tiktokFeeds.ts';
import { parseVideos, TITLE_MAX } from '../src/services/tiktok/client.ts';
import { SENTENCES, VIDEO_PAGE_BUDGET } from '../src/services/tiktok/grow.ts';
import { COFOUNDER, FOUNDER, PID, ROLE, growDb } from './_mercury_grow_fixture.ts';

const TT = 61;
const OTHER = 62;
const COMPANY = 70;
const OPEN_ID = 'open-id-fixture-1';
const M = 'cloudflare-worker/sql/migrations';
const MIGRATION = readdirSync(M).find((f) => /^\d{12}_5863_tiktok_grow_facts\.sql$/.test(f))!;
// D5614: a fixed clock. The sync stamps today's snapshot from Date, so Date is mocked to one instant.
const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);
const TODAY = '2026-11-15';
mock.timers.enable({ apis: ['Date'], now: NOW });
const ALL_SCOPES = ['user.info.basic', 'user.info.stats', 'video.list'];

/** TikTok's Display API, as the client reads it. */
function tiktokApi() {
  const s = {
    user: { follower_count: 1240, following_count: 18, likes_count: 5310, video_count: 3 } as Record<string, unknown>,
    pages: [[
      { id: '7301', create_time: 1762000000, title: 'Launch day', duration: 42, view_count: 9100, like_count: 410, comment_count: 22, share_count: 9, cover_image_url: 'https://cdn.example/cover.jpg', embed_link: 'https://tiktok.example/embed' },
      { id: '7302', create_time: 1761000000, title: 'x'.repeat(200), duration: 15, view_count: 300, like_count: 12, comment_count: 0, share_count: 0 },
    ], [
      { id: '7303', create_time: 1760000000, title: null, duration: 9, like_count: 4 },
    ]] as Array<Array<Record<string, unknown>>>,
    fail: {} as Record<string, number>,
    calls: [] as Array<{ path: string; body: unknown; method: string }>,
    revoked: 0,
  };
  const fetch = async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET');
    if (url.pathname === '/v2/oauth/revoke/') { s.revoked += 1; return new Response('{}', { status: 200 }); }
    if (url.origin !== 'https://open.tiktokapis.com') throw new Error(`unexpected origin ${url.origin}`);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    s.calls.push({ path: url.pathname, body, method });
    if (s.fail[url.pathname]) return new Response(JSON.stringify({ error: { code: s.fail[url.pathname] === 429 ? 'rate_limit_exceeded' : 'internal_error' } }), { status: s.fail[url.pathname] });
    if (url.pathname === '/v2/user/info/') return Response.json({ data: { user: { ...s.user, open_id: OPEN_ID, display_name: 'Founder' } }, error: { code: 'ok' } });
    if (url.pathname === '/v2/video/list/') {
      const at = body?.cursor ? Number(body.cursor) : 0;
      const videos = s.pages[at] ?? [];
      const more = at + 1 < s.pages.length;
      return Response.json({ data: { videos, cursor: more ? at + 1 : 0, has_more: more }, error: { code: 'ok' } });
    }
    return new Response('{}', { status: 404 });
  };
  return { s, fetch };
}

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function signedIn(db: any, env: any, id: number, user: number, scopes = ALL_SCOPES, company = COMPANY) {
  const uid = `tt-${id}`;
  const enc = await encryptCredentials(env, uid, { access_token: `tok-${id}`, refresh_token: 'r', open_id: OPEN_ID, scope: scopes.join(','), expires_at: Date.now() + 3_600_000 } as any);
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc, scopes_json, external_account_id) VALUES (?, ?, ?, 'tiktok', 'active', 'oauth2', ?, ?, ?)")
    .run(id, uid, user, enc, JSON.stringify(scopes), OPEN_ID);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(id, company);
}

async function world(scopes = ALL_SCOPES) {
  const { db, env } = await growDb();
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  db.exec(readFileSync(`${M}/435_connector_companies.sql`, 'utf8'));
  db.exec(readFileSync(`${M}/${MIGRATION}`, 'utf8'));
  // D5864: a sync also raises the channel proposal (`tiktok_proposals_5864.test.ts`).
  db.exec(readFileSync(`${M}/${readdirSync(M).find((f) => /^\d{12}_5864_tiktok_proposals\.sql$/.test(f))}`, 'utf8'));
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY, FOUNDER);
  env.RATE_LIMITS = kv();
  env.TIKTOK_CLIENT_KEY = 'fake-key';
  env.TIKTOK_CLIENT_SECRET = 'fake-secret';
  await signedIn(db, env, TT, FOUNDER, scopes);
  return { db, env, api: tiktokApi() };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);

async function call(env: any, api: any, who: number, method: string, path: string, body?: unknown, support = false) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...(support ? { impersonated_by: 3 } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const real = globalThis.fetch;
  globalThis.fetch = api.fetch as any;
  try {
    const res = await app.fetch(new Request(`http://t${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json() as any };
  } finally { globalThis.fetch = real; }
}

const sync = (w: any, who = FOUNDER, support = false) => call(w.env, w.api, who, 'POST', '/api/cycles/grow/tiktok/sync', { project: PID }, support);
const read = (w: any, slug: string, who = FOUNDER) => call(w.env, w.api, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}`);
const snapshots = (db: any) => db.prepare('SELECT * FROM tiktok_account_facts ORDER BY snapshot_date').all() as any[];
const videos = (db: any) => db.prepare('SELECT * FROM tiktok_video_facts ORDER BY video_id').all() as any[];
const ledger = (db: any) => db.prepare('SELECT kind, local_table, local_id FROM connector_fed_items ORDER BY kind, external_id').all() as any[];

test('1. a sync lands today\'s snapshot and the public videos through the ledger, links the venture, and writes no KPI', async () => {
  const w = await world();
  const out = await sync(w);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.counts, { snapshots: 1, videos: 3, kept_deleted: 0, scopes_missing: [], partial: false, outcome: 'Synced', proposals: 1 });
  assert.deepEqual(snapshots(w.db).map((r) => [r.snapshot_date, r.followers, r.following, r.likes_total, r.video_count]), [[TODAY, 1240, 18, 5310, 3]]);
  assert.deepEqual(videos(w.db).map((v) => [v.video_id, v.posted_on, v.views, v.likes, v.comments, v.shares]), [
    ['7301', '2025-11-01', 9100, 410, 22, 9], ['7302', '2025-10-20', 300, 12, 0, 0], ['7303', '2025-10-09', null, 4, null, null],
  ]);
  assert.equal(videos(w.db)[1].title.length, TITLE_MAX, 'a title is cut at 150 characters');
  assert.deepEqual(ledger(w.db).map((l) => [l.kind, l.local_table]), [
    ['tiktok_account_snapshot', 'tiktok_account_facts'], ['tiktok_video', 'tiktok_video_facts'], ['tiktok_video', 'tiktok_video_facts'], ['tiktok_video', 'tiktok_video_facts'],
  ]);
  assert.deepEqual(w.db.prepare('SELECT integration_id, project_id, video_cursor FROM tiktok_account_links').all().map((r: any) => ({ ...r })), [{ integration_id: TT, project_id: PID, video_cursor: null }]);
  const stored = JSON.stringify([snapshots(w.db), videos(w.db), ledger(w.db)]);
  for (const never of ['cover.jpg', 'embed', OPEN_ID]) assert.ok(!stored.includes(never), `${never} is stored`);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM project_metrics").get().n, 0, 'no TikTok figure is a metric');
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM custom_kpi_values").get().n, 0, 'no TikTok figure is a KPI value');
  assert.deepEqual(w.api.s.calls.map((c: any) => `${c.method} ${c.path}`), ['GET /v2/user/info/', 'POST /v2/video/list/', 'POST /v2/video/list/']);

  const rev = await read(w, 'revenue-and-traction');
  const part = rev.body.parts.from_tiktok;
  assert.equal(part.state, 'ok');
  assert.equal(part.source, `From TikTok, as of ${TODAY}`);
  assert.equal(part.note, SENTENCES.not_revenue);
  assert.deepEqual(part.figures.map((f: any) => [f.key, f.count]), [['followers', 1240], ['likes_total', 5310], ['video_count', 3]]);
  const dist = (await read(w, 'distribution')).body;
  assert.deepEqual(dist.parts.from_tiktok.videos.map((v: any) => v.video_id), ['7301', '7302', '7303']);
  assert.deepEqual(dist.parts.from_tiktok.videos[2].reasons, { views: 'Not recorded: TikTok gave no figure for this video', comments: 'Not recorded: TikTok gave no figure for this video', shares: 'Not recorded: TikTok gave no figure for this video' });
  // The funnel's Visit row is PostHog's (D6107), which never reads TikTok: a view is not a visit. D5867's reach line
  // sits beside the funnel, never in it (`tiktok_part3_5867.test.ts`).
  assert.doesNotMatch(readFileSync('cloudflare-worker/src/services/posthog/visits.ts', 'utf8'), /tiktok/i);
});

test('2. a re-sync updates the same rows, and a deleted fact stays deleted', async () => {
  const w = await world();
  await sync(w);
  const before = videos(w.db).map((v) => v.id);
  w.api.s.pages[0][0].view_count = 9500;
  const again = await sync(w);
  assert.equal(again.body.counts.videos, 3);
  assert.deepEqual(videos(w.db).map((v) => v.id), before, 'the same rows');
  assert.equal(videos(w.db)[0].views, 9500);
  assert.equal(snapshots(w.db).length, 1, 'one snapshot per day');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM connector_fed_items').get().n, 4, 'no ledger row is duplicated');

  const victim = videos(w.db)[0].id;
  const del = await call(w.env, w.api, COFOUNDER, 'DELETE', `/api/cycles/grow/tiktok/facts/${victim}?project=${PID}&kind=video`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const snap = snapshots(w.db)[0].id;
  assert.equal((await call(w.env, w.api, FOUNDER, 'DELETE', `/api/cycles/grow/tiktok/facts/${snap}?project=${PID}&kind=account`)).status, 200);
  const third = await sync(w);
  assert.equal(third.body.counts.kept_deleted, 2);
  assert.deepEqual(videos(w.db).map((v) => v.video_id), ['7302', '7303'], 'the deleted video is not re-created');
  assert.equal(snapshots(w.db).length, 0, 'the deleted snapshot is not re-created');
  assert.equal((await call(w.env, w.api, FOUNDER, 'DELETE', `/api/cycles/grow/tiktok/facts/${victim}?project=${PID}&kind=video`)).status, 404);
  assert.equal((await call(w.env, w.api, FOUNDER, 'DELETE', `/api/cycles/grow/tiktok/facts/1?project=${PID}`)).body.error, 'bad_kind');
});

test('3. a scope not granted is not read and reads Not recorded; a missing count is null; never 0', async () => {
  const w = await world(['user.info.basic', 'video.list']);
  const out = await sync(w);
  assert.deepEqual(out.body.counts.scopes_missing, ['user.info.stats']);
  assert.ok(!w.api.s.calls.some((c: any) => c.path === '/v2/user/info/'), 'the stats were not asked for');
  const part = (await read(w, 'revenue-and-traction')).body.parts.from_tiktok;
  assert.deepEqual([part.state, part.reason], ['not_recorded', SENTENCES.stats_scope]);

  const v = await world(['user.info.basic', 'user.info.stats']);
  await sync(v);
  const dist = (await read(v, 'distribution')).body.parts.from_tiktok;
  assert.deepEqual([dist.state, dist.reason], ['not_recorded', SENTENCES.video_scope]);

  const n = await world();
  n.api.s.user = { follower_count: 1240 };
  await sync(n);
  const figures = (await read(n, 'revenue-and-traction')).body.parts.from_tiktok.figures;
  assert.deepEqual(figures.map((f: any) => [f.key, f.count]), [['followers', 1240], ['likes_total', null], ['video_count', null]]);
  assert.equal(figures[1].reason, 'Not recorded: TikTok has given no total likes yet');
  assert.deepEqual(parseVideos({ videos: [{ id: '1', view_count: -3, like_count: 1.5 }, { id: 'bad id!' }] }).videos.map((x) => [x.views, x.likes]), [[null, null]]);
});

test('4. a failed read is partial or a refusal; an unreadable part keeps the module', async () => {
  const w = await world();
  w.api.s.fail['/v2/user/info/'] = 500;
  const half = await sync(w);
  assert.equal(half.status, 200);
  assert.deepEqual([half.body.counts.snapshots, half.body.counts.videos, half.body.counts.outcome], [0, 3, 'Partly synced']);

  w.api.s.fail['/v2/video/list/'] = 500;
  const none = await sync(w);
  assert.deepEqual([none.status, none.body.error], [502, 'tiktok_unreadable']);
  w.api.s.fail['/v2/user/info/'] = 429;
  assert.deepEqual([(await sync(w)).status, (await sync(w)).body.error], [429, 'rate_limited']);

  w.db.exec('DROP TABLE tiktok_video_facts');
  const mod = await read(w, 'distribution');
  assert.equal(mod.status, 200);
  assert.deepEqual(mod.body.parts.from_tiktok, { state: 'unreadable', reason: SENTENCES.unreadable });
  assert.ok(mod.body.module, 'the rest of the module still loads');
});

test('5. the page budget stops "Partly synced" with a cursor, and the next sync resumes from it', async () => {
  const w = await world();
  w.api.s.pages = Array.from({ length: VIDEO_PAGE_BUDGET + 2 }, (_, p) => [{ id: `v${p}`, create_time: 1760000000 + p, view_count: p }]);
  const first = await sync(w);
  assert.deepEqual([first.body.counts.videos, first.body.counts.outcome], [VIDEO_PAGE_BUDGET, 'Partly synced']);
  assert.equal(w.db.prepare('SELECT video_cursor FROM tiktok_account_links').get().video_cursor, String(VIDEO_PAGE_BUDGET));
  assert.equal((await read(w, 'distribution')).body.parts.from_tiktok.link.partly_synced, true);
  w.api.s.calls.length = 0;
  const second = await sync(w);
  assert.deepEqual(w.api.s.calls.filter((c: any) => c.path === '/v2/video/list/').map((c: any) => c.body.cursor), [VIDEO_PAGE_BUDGET, VIDEO_PAGE_BUDGET + 1]);
  assert.deepEqual([second.body.counts.videos, second.body.counts.outcome], [2, 'Synced']);
  assert.equal(w.db.prepare('SELECT video_cursor FROM tiktok_account_links').get().video_cursor, null, 'read to the end: the cursor is cleared');
  assert.equal(videos(w.db).length, VIDEO_PAGE_BUDGET + 2);
});

test('6. who: a support session and a company switched off are refused; one account per venture, both ways', async () => {
  const w = await world();
  assert.deepEqual([(await sync(w, FOUNDER, true)).status, (await sync(w, FOUNDER, true)).body.error], [403, 'support_session_refused']);
  assert.equal((await sync(w, COFOUNDER)).body.error, 'tiktok_not_connected');
  assert.equal(w.api.s.calls.length, 0, 'nothing was read');

  // A teammate's TikTok, switched on for the same company, while the founder's already serves the venture.
  await sync(w);
  await signedIn(w.db, w.env, OTHER, COFOUNDER);
  const served = await sync(w, COFOUNDER);
  assert.deepEqual([served.status, served.body.error], [409, 'venture_served']);

  // The founder's TikTok, already serving the venture, asked for a second one.
  w.db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (8, 'p8', 'Second', 10, ?)").run(COMPANY);
  w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (8, ?, 'cofounder', 'accepted')").run(FOUNDER);
  const elsewhere = await call(w.env, w.api, FOUNDER, 'POST', '/api/cycles/grow/tiktok/sync', { project: 8 });
  assert.deepEqual([elsewhere.status, elsewhere.body.error], [409, 'serves_other_venture']);

  w.db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(TT);
  assert.deepEqual([(await sync(w)).status, (await sync(w)).body.error], [403, 'company_not_enabled']);
});

test('7. disconnect and the deauthorization webhook remove the connection\'s facts and ledger rows', async () => {
  const w = await world();
  await sync(w);
  const row = w.db.prepare('SELECT * FROM integrations WHERE id = ?').get(TT);
  const real = globalThis.fetch;
  globalThis.fetch = w.api.fetch as any;
  try { await getProviderImpl('tiktok')!.disconnect!({ env: w.env } as any, { id: FOUNDER } as any, row); } finally { globalThis.fetch = real; }
  assert.equal(w.api.s.revoked, 1);
  assert.deepEqual([snapshots(w.db).length, videos(w.db).length, ledger(w.db).length], [0, 0, 0]);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM tiktok_account_links').get().n, 0);

  // A failed revoke deletes nothing.
  const f = await world();
  await sync(f);
  const failing = async () => new Response('{}', { status: 500 });
  globalThis.fetch = failing as any;
  try {
    await assert.rejects(getProviderImpl('tiktok')!.disconnect!({ env: f.env } as any, { id: FOUNDER } as any, f.db.prepare('SELECT * FROM integrations WHERE id = ?').get(TT)));
  } finally { globalThis.fetch = real; }
  assert.equal(videos(f.db).length, 3, 'nothing removed when TikTok did not revoke');

  // The webhook deletes the row, so it deletes the facts first, in the same batch.
  const src = readFileSync('cloudflare-worker/src/routes/tiktok_webhook.ts', 'utf8');
  assert.match(src, /\.\.\.purgeByOpenIdStatements\(c\.env, event\.user_openid, cutoff\)/);
  const { purgeByOpenIdStatements } = await import('../src/services/tiktok/grow.ts');
  // The webhook's cutoff is TikTok's event time; take it from the row's own stamp, so no clock is read.
  const cutoff = Number(f.db.prepare('SELECT unixepoch(updated_at) AS t FROM integrations WHERE id = ?').get(TT).t);
  await f.env.DB.batch(purgeByOpenIdStatements(f.env, OPEN_ID, cutoff));
  assert.deepEqual([snapshots(f.db).length, videos(f.db).length, ledger(f.db).length], [0, 0, 0]);
});

test('8. logs carry counts only; the feeds list, the registry and the page agree; only the client calls the API', async () => {
  const w = await world();
  const lines: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try { await sync(w); w.api.s.fail['/v2/user/info/'] = 500; await sync(w); } finally { Object.assign(console, keep); }
  const activity = JSON.stringify(w.db.prepare('SELECT * FROM activity_logs').all());
  for (const never of ['1240', '9100', 'Launch day', OPEN_ID, 'tok-']) {
    assert.ok(!lines.join('\n').includes(never), `a log line holds ${never}`);
    assert.ok(!activity.includes(never), `the activity log holds ${never}`);
  }
  assert.match(activity, /Grow synced from TikTok: 1 snapshot, 3 videos/);

  const meta = CONNECTOR_METADATA.tiktok;
  assert.deepEqual(meta.pulls, TIKTOK_BUILT_FEEDS.map((f) => ({ what: f.what, module: f.module })));
  assert.deepEqual(meta.feeds, [...TIKTOK_FEEDS]);
  assert.deepEqual([...TIKTOK_FEEDS].sort(), ['distribution', 'revenue_and_traction']);
  const page = CONNECTOR_PAGES.tiktok;
  // A page tool names a call; the channel proposal (D5864) is computed from local data and calls nothing.
  assert.deepEqual(page.tools.map((t) => [t.lands_in, t.calls]), TIKTOK_BUILT_FEEDS.filter((f) => f.calls.length).map((f) => [f.module, [...f.calls]]));
  assert.deepEqual(TIKTOK_FEED_LIST.filter((f) => f.kind === 'proposal').map((f) => [f.key, f.built, f.calls.length]), [['channel', true, 0]]);

  const files = readdirSync('cloudflare-worker/src', { recursive: true }) as string[];
  const callers = files.filter((f) => f.endsWith('.ts') && readFileSync(`cloudflare-worker/src/${f}`, 'utf8').includes('/v2/video/list/') && !f.endsWith('tiktokFeeds.ts') && !f.endsWith('connectorPages.ts'));
  assert.deepEqual(callers.map((f) => f.replaceAll('\\', '/')), ['services/tiktok/client.ts']);
});
