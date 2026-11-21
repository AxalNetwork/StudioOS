/**
 * D5859 (#5859, part 2a of #2399) — a linked Facebook Page in Grow, against a stubbed Graph API, on the Grow world
 * Mercury's tests use (`_mercury_grow_fixture.ts`): real SQL on node:sqlite, the real routes. Every name, id and
 * figure is invented.
 *
 *  1. A venture links one chosen Page; the first sync lands followers and 270 days of insights through the ledger,
 *     stops "Partly synced" with a cursor, and writes no KPI.
 *  2. The next sync reads back to 12 months, clears the cursor, and updates the same rows.
 *  3. A deleted figure stays deleted.
 *  4. A metric Facebook did not return reads Not recorded; a 0 it returned is 0; the parser drops what is not a count.
 *  5. A failed read is partial or a refusal; an unreadable part keeps the module.
 *  6. Who: support, no connection, a company switched off, a Page not chosen or no longer granted, a teammate's link,
 *     one Page per venture.
 *  7. Disconnect removes the facts, ledger rows and links after Facebook revokes; a failed revoke removes nothing.
 *  8. Logs carry counts only; the feeds list, the registry and the page agree; only insights.ts reads Page figures.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/facebook_grow_5859.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, getProviderImpl } from '../src/integrations/registry.ts';
import '../src/integrations/providers/facebook.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { FACEBOOK_BUILT_FEEDS, FACEBOOK_FEEDS, FACEBOOK_FEED_LIST } from '../src/integrations/facebookFeeds.ts';
import { parseInsights } from '../src/services/facebook/insights.ts';
import { SENTENCES } from '../src/services/facebook/grow.ts';
import { COFOUNDER, FOUNDER, PID, ROLE, growDb } from './_mercury_grow_fixture.ts';

const FB = 81;
const OTHER = 82;
const COMPANY = 70;
const PAGE = '801';
const ACCOUNT = '5001';
const M = 'cloudflare-worker/sql/migrations';
const MIGRATION = readdirSync(M).find((f) => /^\d{12}_5859_facebook_page_facts\.sql$/.test(f))!;
// D5614: a fixed clock. The sync stamps today's snapshot and its windows from Date.
mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 15, 10, 0, 0) });
const TODAY = '2026-11-15';
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'read_insights'];
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Meta's Graph API, as the provider and insights.ts call it. */
function graphApi() {
  const s = {
    pages: [{ id: PAGE, name: 'Acme Page', access_token: 'page-tok-801' }, { id: '802', name: 'Side Page', access_token: 'page-tok-802' }] as Array<Record<string, unknown>>,
    followers: 1500 as number | undefined,
    metrics: ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements'],
    value: (metric: string, _day: string): unknown => ({ page_media_view: 100, page_total_media_view_unique: 40, page_post_engagements: 7 } as Record<string, number>)[metric],
    fail: {} as Record<string, { status: number; code: number }>,
    windows: [] as Array<[string, string]>,
    /** Return one day either side of the asked range, as an API may. */
    leak: false,
    revoked: 0,
  };
  const fetch = async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://graph.facebook.com') throw new Error(`unexpected origin ${url.origin}`);
    const path = url.pathname.replace(/^\/v26\.0/, '');
    const method = String(init.method || 'GET');
    const key = path.endsWith('/insights') ? 'insights' : path === `/${PAGE}` ? 'followers' : path;
    if (s.fail[key]) return Response.json({ error: { code: s.fail[key].code } }, { status: s.fail[key].status });
    if (method === 'DELETE' && path.includes('/permissions/')) { s.revoked += 1; return Response.json({ success: true }); }
    if (path === '/me/permissions') return Response.json({ data: SCOPES.map((permission) => ({ permission, status: 'granted' })) });
    if (path === '/me/accounts') return Response.json({ data: s.pages });
    if (path === `/${PAGE}`) return Response.json({ id: PAGE, ...(s.followers === undefined ? {} : { followers_count: s.followers }) });
    if (path === `/${PAGE}/insights`) {
      const since = url.searchParams.get('since')!;
      const until = url.searchParams.get('until')!;
      s.windows.push([since, until]);
      const data = s.metrics.map((name) => {
        const values = [];
        for (let d = since; d < until; d = nextDay(d)) values.push({ value: s.value(name, d), end_time: `${nextDay(d)}T08:00:00+0000` });
        if (s.leak) values.push({ value: 9, end_time: `${since}T08:00:00+0000` }, { value: 9, end_time: `${nextDay(until)}T08:00:00+0000` });
        return { name, period: 'day', values };
      });
      return Response.json({ data });
    }
    return Response.json({ error: { code: 100 } }, { status: 400 });
  };
  return { s, fetch };
}

async function connection(db: any, env: any, id: number, user: number, chosen: string[] = [PAGE]) {
  const uid = `fb-${id}`;
  const enc = await encryptCredentials(env, uid, { access_token: `user-tok-${id}` } as any);
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc, scopes_json, external_account_id, config_json)
              VALUES (?, ?, ?, 'facebook', 'active', 'oauth2', ?, ?, ?, ?)`)
    .run(id, uid, user, enc, JSON.stringify(SCOPES), ACCOUNT, JSON.stringify({ pages_by_company: { [COMPANY]: chosen } }));
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(id, COMPANY);
}

async function world() {
  const { db, env } = await growDb();
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  db.exec(readFileSync(`${M}/435_connector_companies.sql`, 'utf8'));
  db.exec(readFileSync(`${M}/${MIGRATION}`, 'utf8'));
  db.exec(readFileSync(`${M}/${readdirSync(M).find((f) => /^\d{12}_5860_facebook_proposals\.sql$/.test(f))!}`, 'utf8'));
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY, FOUNDER);
  Object.assign(env, { WHATSAPP_APP_ID: '123', WHATSAPP_APP_SECRET: randomBytes(32).toString('hex'), FACEBOOK_LOGIN_CONFIG_ID: '456', FACEBOOK_APP_APPROVED: '1' });
  await connection(db, env, FB, FOUNDER);
  return { db, env, api: graphApi() };
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

const link = (w: any, page: string | null = PAGE, who = FOUNDER, project = PID) => call(w, who, 'PUT', '/api/cycles/grow/facebook/page', { project, page_id: page });
const sync = (w: any, who = FOUNDER, support = false) => call(w, who, 'POST', '/api/cycles/grow/facebook/sync', { project: PID }, support);
const read = (w: any, slug: string, who = FOUNDER) => call(w, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}`);
const facts = (db: any, kind?: string) => (kind
  ? db.prepare('SELECT * FROM facebook_page_facts WHERE kind = ? ORDER BY period').all(kind)
  : db.prepare('SELECT * FROM facebook_page_facts ORDER BY kind, period').all()) as any[];
const linkRow = (db: any) => db.prepare('SELECT * FROM facebook_page_links').get() as any;

test('1. a venture links one chosen Page; the first sync lands followers and 270 days through the ledger, partly synced, no KPI', async () => {
  const w = await world();
  const linked = await link(w);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.deepEqual(linked.body.link, { page_id: PAGE, page_name: 'Acme Page' });
  const out = await sync(w);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.counts, { followers: 1, daily: 810, kept_deleted: 0, partial: true, outcome: 'Partly synced' });
  assert.deepEqual(w.api.s.windows, [['2026-08-18', '2026-11-16'], ['2026-05-20', '2026-08-18'], ['2026-02-19', '2026-05-20']]);
  assert.deepEqual(facts(w.db, 'followers').map((f) => [f.period, f.value, f.module, f.subject]), [[TODAY, 1500, 'revenue_and_traction', PAGE]]);
  const views = facts(w.db, 'views');
  assert.deepEqual([views.length, views[0].period, views.at(-1).period, views[0].module], [270, '2026-02-19', TODAY, 'distribution']);
  assert.deepEqual([linkRow(w.db).insights_cursor, linkRow(w.db).backfilled], ['2026-02-19', 0]);
  const ledger = w.db.prepare("SELECT COUNT(*) AS n, COUNT(local_id) AS linked FROM connector_fed_items WHERE kind = 'facebook_page_fact' AND local_table = 'facebook_page_facts'").get();
  assert.deepEqual([ledger.n, ledger.linked], [811, 811]);
  for (const t of ['project_metrics', 'custom_kpi_values']) {
    if (w.db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t)) assert.equal(w.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} was written`);
  }
  const part = (await read(w, 'revenue-and-traction')).body.parts.from_facebook;
  assert.deepEqual([part.state, part.followers.count, part.source, part.link.page_name, part.link.partly_synced], ['ok', 1500, `From Facebook, as of ${TODAY}`, 'Acme Page', true]);
  assert.equal(part.note, SENTENCES.not_revenue);
});

test('2. the next sync reads back to 12 months, clears the cursor, and updates the same rows', async () => {
  const w = await world();
  await link(w);
  await sync(w);
  w.api.s.windows.length = 0;
  w.api.s.value = (m) => (m === 'page_media_view' ? 120 : m === 'page_total_media_view_unique' ? 40 : 7);
  w.api.s.followers = 1525;
  const out = await sync(w);
  assert.deepEqual(out.body.counts.outcome, 'Synced');
  assert.deepEqual(w.api.s.windows, [['2026-08-18', '2026-11-16'], ['2025-11-21', '2026-02-19'], ['2025-11-16', '2025-11-21']]);
  assert.deepEqual([linkRow(w.db).insights_cursor, linkRow(w.db).backfilled], [null, 1]);
  const views = facts(w.db, 'views');
  assert.deepEqual([views.length, views[0].period], [365, '2025-11-16'], 'twelve months, no day twice');
  assert.equal(views.at(-1).value, 120, 'a re-read day is updated in place');
  assert.deepEqual(facts(w.db, 'followers').map((f) => f.value), [1525], 'one snapshot per day, updated');
  const part = (await read(w, 'distribution')).body.parts.from_facebook;
  assert.deepEqual([part.state, part.link.partly_synced, part.days.length, part.days[0].day], ['ok', false, 28, TODAY]);
  assert.deepEqual(part.totals.views, { count: 120 * 28, days_recorded: 28, of_days: 28 });
  assert.deepEqual(part.totals.viewers, { count: null, reason: SENTENCES.unique_per_day });
  // Fully read: a later sync asks only for the newest window.
  w.api.s.windows.length = 0;
  await sync(w);
  assert.deepEqual(w.api.s.windows, [['2026-08-18', '2026-11-16']]);
});

test('3. a deleted figure stays deleted', async () => {
  const w = await world();
  await link(w);
  await sync(w);
  const victim = facts(w.db, 'views').find((f) => f.period === TODAY);
  const del = await call(w, FOUNDER, 'DELETE', `/api/cycles/grow/facebook/facts/${victim.id}?project=${PID}`);
  assert.deepEqual([del.status, del.body.id], [200, victim.id]);
  assert.equal(w.db.prepare("SELECT local_id FROM connector_fed_items WHERE local_table = 'facebook_page_facts' AND external_id LIKE ?").get(`%:views:${TODAY}`).local_id, null,
    'the delete unlinks its ledger row at once');
  // A row removed some other way (not through the route) is still read as deleted by the ledger.
  const gone = facts(w.db, 'engagements').find((f) => f.period === TODAY);
  w.db.prepare('DELETE FROM facebook_page_facts WHERE id = ?').run(gone.id);
  const follower = facts(w.db, 'followers')[0];
  await call(w, FOUNDER, 'DELETE', `/api/cycles/grow/facebook/facts/${follower.id}?project=${PID}`);
  const again = await sync(w);
  assert.equal(again.body.counts.kept_deleted, 3);
  assert.ok(!facts(w.db, 'engagements').some((f) => f.period === TODAY), 'a row removed outside the route is not re-created');
  assert.ok(!facts(w.db, 'views').some((f) => f.period === TODAY), 'the deleted day is not re-created');
  assert.equal(facts(w.db, 'followers').length, 0, 'the deleted snapshot is not re-created');
  assert.equal((await call(w, FOUNDER, 'DELETE', `/api/cycles/grow/facebook/facts/${victim.id}?project=${PID}`)).status, 404);
  const day = (await read(w, 'distribution')).body.parts.from_facebook.days.find((d: any) => d.day === TODAY);
  assert.deepEqual(day.views, { count: null, reason: SENTENCES.not_given });
});

test('4. a metric Facebook did not return reads Not recorded; a 0 it returned is 0; the parser drops what is not a count', async () => {
  const w = await world();
  w.api.s.metrics = ['page_media_view', 'page_post_engagements'];
  w.api.s.value = (m) => (m === 'page_post_engagements' ? 0 : 55);
  w.api.s.followers = undefined;
  w.api.s.leak = true;
  await link(w);
  const out = await sync(w);
  assert.deepEqual([out.body.counts.followers, out.body.counts.daily], [0, 540]);
  const days = facts(w.db, 'views').map((f) => f.period);
  assert.deepEqual([days.length, days[0], days.at(-1)], [270, '2026-02-19', TODAY], 'a day outside the asked range is dropped');
  const rt = (await read(w, 'revenue-and-traction')).body.parts.from_facebook;
  assert.deepEqual([rt.state, rt.reason], ['not_recorded', SENTENCES.not_synced]);
  const dist = (await read(w, 'distribution')).body.parts.from_facebook;
  assert.deepEqual(dist.days[0].viewers, { count: null, reason: SENTENCES.not_given });
  assert.equal(dist.days[0].engagements.count, 0, 'a 0 Facebook gave is 0');
  assert.deepEqual(dist.totals.engagements, { count: 0, days_recorded: 28, of_days: 28 });
  assert.deepEqual(parseInsights({ data: [
    { name: 'page_media_view', period: 'day', values: [{ value: -3, end_time: '2026-11-02T08:00:00+0000' }, { value: 1.5, end_time: '2026-11-03T08:00:00+0000' }, { value: 9, end_time: 'nonsense' }, { value: 4, end_time: '2026-11-04T08:00:00+0000' }] },
    { name: 'page_media_view', period: 'week', values: [{ value: 70, end_time: '2026-11-04T08:00:00+0000' }] },
    { name: 'page_fans', period: 'day', values: [{ value: 5, end_time: '2026-11-04T08:00:00+0000' }] },
  ] }), [{ kind: 'views', day: '2026-11-03', value: 4 }]);
});

test('5. a failed read is partial or a refusal; an unreadable part keeps the module', async () => {
  const w = await world();
  await link(w);
  w.api.s.fail.insights = { status: 500, code: 2 };
  const half = await sync(w);
  assert.equal(half.status, 200);
  assert.deepEqual([half.body.counts.followers, half.body.counts.daily, half.body.counts.outcome], [1, 0, 'Partly synced']);
  assert.equal(linkRow(w.db).insights_cursor, null, 'nothing older was read, so the cursor did not move');

  w.api.s.fail.followers = { status: 500, code: 2 };
  const none = await sync(w);
  assert.deepEqual([none.status, none.body.error], [502, 'facebook_unreadable']);
  w.api.s.fail.followers = { status: 400, code: 4 };
  w.api.s.fail.insights = { status: 400, code: 4 };
  assert.equal((await sync(w)).body.error, 'rate_limited');
  w.api.s.fail['/me/accounts'] = { status: 400, code: 190 };
  assert.deepEqual([(await sync(w)).status, (await sync(w)).body.error], [409, 'sign_in_again']);

  w.db.exec('DROP TABLE facebook_page_facts');
  const mod = await read(w, 'distribution');
  assert.equal(mod.status, 200);
  assert.deepEqual(mod.body.parts.from_facebook, { state: 'unreadable', reason: SENTENCES.unreadable });
  assert.ok(mod.body.module, 'the rest of the module still loads');
});

test('6. who: support, no connection, company off, a Page not chosen or not granted, a teammate\'s link, one Page per venture', async () => {
  const w = await world();
  const before = (await read(w, 'distribution')).body.parts.from_facebook;
  assert.deepEqual([before.state, before.reason, before.connect_href, before.can_link, before.can_sync], ['not_linked', SENTENCES.not_linked, '/account/connectors/facebook', true, false]);
  assert.deepEqual([(await sync(w)).status, (await sync(w)).body.error], [409, 'facebook_page_not_linked']);
  assert.deepEqual([(await link(w, PAGE, FOUNDER)).status], [200]);
  assert.deepEqual([(await sync(w, FOUNDER, true)).status, (await sync(w, FOUNDER, true)).body.error], [403, 'support_session_refused']);
  assert.equal((await sync(w, COFOUNDER)).body.error, 'facebook_not_connected');
  assert.equal((await link(w, '802')).body.error, 'page_not_chosen', 'a Page the company did not choose');
  assert.equal((await link(w, 'abc')).body.error, 'bad_page');

  // A teammate's connection, with the same Page chosen, while the founder's link serves the venture.
  await connection(w.db, w.env, OTHER, COFOUNDER);
  assert.deepEqual([(await link(w, PAGE, COFOUNDER)).status, (await link(w, PAGE, COFOUNDER)).body.error], [409, 'venture_served']);
  assert.equal((await link(w, null, COFOUNDER)).body.error, 'venture_served', 'a teammate cannot unlink it either');
  assert.deepEqual([(await sync(w, COFOUNDER)).status, (await sync(w, COFOUNDER)).body.error], [409, 'venture_served'], 'nor sync it');
  const theirs = (await read(w, 'distribution', COFOUNDER)).body.parts.from_facebook;
  assert.deepEqual([theirs.can_sync, theirs.can_link], [false, false]);

  // The same Page on a second venture of the same company.
  w.db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (8, 'p8', 'Second', 10, ?)").run(COMPANY);
  w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (8, ?, 'cofounder', 'accepted')").run(FOUNDER);
  assert.equal((await link(w, PAGE, FOUNDER, 8)).body.error, 'page_elsewhere');

  // The token no longer lists the Page: the sync re-reads /me/accounts and refuses.
  w.api.s.pages = w.api.s.pages.filter((p) => p.id !== PAGE);
  assert.deepEqual([(await sync(w)).status, (await sync(w)).body.error], [403, 'facebook_page_not_granted']);
  assert.equal(facts(w.db).length, 0, 'nothing was read');

  w.db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(FB);
  assert.deepEqual([(await sync(w)).status, (await sync(w)).body.error], [403, 'company_not_enabled']);
  w.db.prepare('UPDATE integration_companies SET enabled = 1 WHERE integration_id = ?').run(FB);
  assert.equal((await link(w, null)).status, 200);
  assert.equal(linkRow(w.db), undefined, 'unlinked');
});

test('7. disconnect removes the facts, ledger rows and links after Facebook revokes; a failed revoke removes nothing', async () => {
  const w = await world();
  await link(w);
  await sync(w);
  const real = globalThis.fetch;
  globalThis.fetch = w.api.fetch as any;
  try { await getProviderImpl('facebook')!.disconnect!({ env: w.env } as any, { id: FOUNDER } as any, w.db.prepare('SELECT * FROM integrations WHERE id = ?').get(FB)); } finally { globalThis.fetch = real; }
  assert.equal(w.api.s.revoked, SCOPES.length);
  assert.deepEqual([facts(w.db).length, w.db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE kind = 'facebook_page_fact'").get().n, linkRow(w.db)], [0, 0, undefined]);

  const f = await world();
  await link(f);
  await sync(f);
  globalThis.fetch = (async () => Response.json({ error: { code: 2 } }, { status: 500 })) as any;
  try {
    await assert.rejects(getProviderImpl('facebook')!.disconnect!({ env: f.env } as any, { id: FOUNDER } as any, f.db.prepare('SELECT * FROM integrations WHERE id = ?').get(FB)));
  } finally { globalThis.fetch = real; }
  assert.equal(facts(f.db, 'views').length, 270, 'nothing removed when Facebook did not revoke');
});

test('8. logs carry counts only; the feeds list, the registry and the page agree; only insights.ts reads Page figures', async () => {
  const w = await world();
  const lines: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try { await link(w); await sync(w); w.api.s.fail.insights = { status: 500, code: 2 }; await sync(w); } finally { Object.assign(console, keep); }
  const activity = JSON.stringify(w.db.prepare('SELECT * FROM activity_logs').all());
  for (const never of ['1500', 'Acme Page', 'page-tok', 'user-tok', ACCOUNT]) {
    assert.ok(!lines.join('\n').includes(never), `a log line holds ${never}`);
    assert.ok(!activity.includes(never), `the activity log holds ${never}`);
  }
  assert.match(activity, /Grow synced from Facebook: 1 follower snapshot, 810 daily figures, 0 kept deleted, partly synced/);

  const meta = CONNECTOR_METADATA.facebook;
  assert.deepEqual(meta.pulls, FACEBOOK_BUILT_FEEDS.map((f) => ({ what: f.what, module: f.module })));
  assert.deepEqual(meta.feeds, [...FACEBOOK_FEEDS]);
  assert.deepEqual([...FACEBOOK_FEEDS].sort(), ['distribution', 'revenue_and_traction']);
  const page = CONNECTOR_PAGES.facebook as any;
  // Local channel decisions add a feed, without adding a Facebook API tool.
  assert.deepEqual(page.tools.map((t: any) => [t.lands_in, t.calls]), FACEBOOK_BUILT_FEEDS.filter((f) => f.calls.length).map((f) => [f.module, [...f.calls]]));
  assert.ok(FACEBOOK_FEED_LIST.some((f) => f.built && f.kind === 'proposal' && f.decision === 'D5860'), 'the channel proposal is built');

  const files = readdirSync('cloudflare-worker/src', { recursive: true }) as string[];
  const src = (f: string) => readFileSync(`cloudflare-worker/src/${f}`, 'utf8');
  const ts = files.filter((f) => f.endsWith('.ts')).map((f) => f.replaceAll('\\', '/'));
  // The Page reads go through the provider's Graph call, and only insights.ts makes them.
  assert.deepEqual(ts.filter((f) => src(f).includes('facebookGraph(') && !f.endsWith('providers/facebook.ts')), ['services/facebook/insights.ts']);
  assert.deepEqual(ts.filter((f) => /INSIGHT_METRICS|page_media_view/.test(src(f))), ['services/facebook/insights.ts']);
});
