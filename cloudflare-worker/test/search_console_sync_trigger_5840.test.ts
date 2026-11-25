/**
 * D5840 part 2 (#5840) — the Search Console sync trigger and results read, end to end through the routes,
 * against a fake Google: D5839's sign-in and property bind, then `POST /api/search-console/sync` and
 * `GET /api/search-console/results`. Every venture, person, token, site and figure is invented; no request
 * leaves the process.
 *
 *  1. Dark until the owner's approval flag: both routes 503, nothing sent to Google.
 *  2. The bound member's sync reads only the selected property with that member's token, finalized web
 *     data, no query dimension; the results carry the property, Pacific Time, coverage and weighted CTR.
 *  3. A duplicate run writes nothing; a teammate reads the results but cannot start a sync.
 *  4. Cross-venture, a stranger, a support session, no selection and a switched-off company are refused
 *     before any Google request.
 *  5. The token dependency: a busy refresh lease and a failing token endpoint fail the run without touching
 *     the selection; a revoked grant marks it `revoked` and the next sync is refused.
 *  6. Nothing logged names the property, a page or a token.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/search_console_sync_trigger_5840.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import integrations from '../src/routes/integrations.ts';
import searchConsole, { SEARCH_CONSOLE_REFUSALS, SEARCH_CONSOLE_SYNC_OUTCOMES } from '../src/routes/search_console.ts';
import { encryptCredentials, decryptCredentials } from '../src/integrations/secrets.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';
import { SEARCH_CONSOLE_SCOPE } from '../src/integrations/searchConsoleOAuth.ts';
import { addDays, pacificDate } from '../src/services/searchConsoleWeeks.ts';
import { personalFixture } from './_mercury_personal_d713.ts';
import { triggerSearchConsoleSync } from '../src/services/searchConsoleTrigger.ts';

const COMPANY = 77;
const KEY = 'google_search_console';
const MIGRATION = readFileSync('cloudflare-worker/sql/migrations/202611150136_5840_search_console_sync.sql', 'utf8');
const SITE = 'sc-domain:example.test';
const OTHER_SITE = 'https://shop.example.test/';
const SYNC = '/api/search-console/sync';
// A fixed clock: Sunday 22 Nov 2026, 12:00 in Los Angeles. The routes read `Date`, so the whole file runs at it.
const NOW = new Date('2026-11-22T20:00:00Z');
mock.timers.enable({ apis: ['Date'], now: NOW });
const RESULTS = '/api/search-console/results';

/** Deterministic daily figures for any date; one date a true zero. */
function figures(date: string): [number, number] {
  const n = Number(date.slice(8, 10));
  return n === 5 ? [0, 0] : [n, n * 10 + 5];
}

function google() {
  const s = {
    sites: [{ siteUrl: SITE, permissionLevel: 'siteOwner' }, { siteUrl: OTHER_SITE, permissionLevel: 'siteFullUser' }],
    revoked: false, tokenStatus: 200,
    calls: [] as Array<{ host: string; path: string; body: any; auth: string | null }>,
  };
  const f = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const raw = init.body ? String(init.body) : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* a form */ }
    s.calls.push({ host: url.host, path: url.pathname, body, auth: init.headers?.Authorization ?? null });
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
      if (s.tokenStatus !== 200) return new Response('{}', { status: s.tokenStatus });
      if (s.revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const refreshing = new URLSearchParams(raw ?? '').get('grant_type') === 'refresh_token';
      return Response.json({
        access_token: refreshing ? 'fixture-access-2' : 'fixture-access-1', expires_in: 3599, scope: SEARCH_CONSOLE_SCOPE,
        ...(refreshing ? {} : { refresh_token: 'fixture-refresh-1' }),
      });
    }
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke') return new Response(null, { status: 200 });
    if ((url.origin === 'https://www.googleapis.com' || url.origin === 'https://searchconsole.googleapis.com') && url.pathname.startsWith('/webmasters/v3/sites')) {
      if (s.revoked) return Response.json({ error: { code: 401 } }, { status: 401 });
      const rest = url.pathname.slice('/webmasters/v3/sites'.length);
      if (!rest) return Response.json({ siteEntry: s.sites });
      const m = /^\/([^/]+)(\/searchAnalytics\/query)?$/.exec(rest);
      const asked = m ? decodeURIComponent(m[1]) : '';
      const site = s.sites.find((x) => x.siteUrl === asked);
      if (!site) return Response.json({ error: { code: 403 } }, { status: 403 });
      if (!m![2]) return Response.json(site);
      if (body.dimensions[0] === 'date') {
        const rows = [];
        for (let d = body.startDate; d <= body.endDate; d = addDays(d, 1)) {
          if (Number(d.slice(8, 10)) === 4) continue; // no row: missing, never zero
          const [clicks, impressions] = figures(d);
          rows.push({ keys: [d], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: 3.5 });
        }
        return Response.json({ rows: rows.slice(body.startRow, body.startRow + body.rowLimit), responseAggregationType: 'byProperty' });
      }
      return Response.json({ rows: [
        { keys: ['https://example.test/pricing'], clicks: 9, impressions: 90, ctr: 0.1, position: 2 },
        { keys: ['https://example.test/blog'], clicks: 2, impressions: 80, ctr: 0.025, position: 7 },
      ], responseAggregationType: 'byPage' });
    }
    throw new Error(`unexpected host ${url.origin}`);
  }) as typeof fetch;
  return Object.assign(s, { fetch: f });
}

function memoryKv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(env0: Record<string, string> = {}) {
  _clearOauthCredsCache();
  const { db, env } = await personalFixture();
  db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
  db.exec(`UPDATE projects SET company_id = ${COMPANY}`);
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (11, 'founder', 'Fixture cofounder', 'cofounder@example.test', 100)");
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY}), (11, ${COMPANY})`);
  db.exec(MIGRATION);
  const kv = memoryKv();
  Object.assign(env, {
    RATE_LIMITS: kv, OAUTH_CALLBACK_BASE_URL: 'https://app.example.test',
    GOOGLE_SEARCH_CONSOLE_APPROVED: '1', GOOGLE_SEARCH_CONSOLE_CLIENT_ID: 'fixture-client.apps.example.test',
    GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: 'fixture-client-secret', ...env0,
  });
  const g = google();
  const app = new Hono<any>();
  app.route('/api/connectors', integrations);
  app.route('/api/search-console', searchConsole);
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return { db, env, g, app, kv };
}
type T = Awaited<ReturnType<typeof setup>>;

const ROLES: Record<number, string> = { 10: 'founder', 11: 'founder', 20: 'partner', 30: 'investor' };
async function req(t: T, who: number, path: string, o: { method?: string; body?: unknown; impersonated?: boolean } = {}) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(o.impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(t.env.JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'X-Company-Id': String(COMPANY) };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const real = globalThis.fetch;
  globalThis.fetch = t.g.fetch;
  try {
    const res = await t.app.request(path, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }, t.env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a redirect */ }
    return { status: res.status, body, text, location: res.headers.get('Location') };
  } finally { globalThis.fetch = real; }
}

const row = (t: T, user = 10) => t.db.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?').get(user, KEY) as any;
const selection = (t: T, project = 1) => t.db.prepare('SELECT * FROM search_console_selections WHERE project_id = ?').get(project) as any;
const count = (t: T, table: string) => (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n as number;
const analytics = (t: T) => t.g.calls.filter((c) => c.host === 'searchconsole.googleapis.com');

/** Signed in, switched on for the company, and (for `site`) the venture bound through the picker. */
async function bound(t: T, who = 10, project = 1, site: string | null = SITE) {
  const start = await req(t, who, `/api/connectors/oauth/${KEY}/start`);
  assert.equal(start.status, 200, start.text);
  await req(t, who, `/api/connectors/oauth/${KEY}/callback?code=fixture-code&state=${encodeURIComponent(start.body.state)}`);
  t.db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1').run(row(t, who).id, COMPANY);
  if (site) {
    const b = await req(t, who, '/api/search-console/property', { method: 'PUT', body: { project, site_url: site } });
    assert.equal(b.status, 200, b.text);
  }
}
async function expire(t: T, who = 10) {
  const r = row(t, who);
  const creds = await decryptCredentials(t.env, r.uid, r.credentials_enc);
  t.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(await encryptCredentials(t.env, r.uid, { ...creds!, expires_at: 1 }), r.id);
}

test('1. dark until the owner sets the approval flag: both routes answer 503 and Google is not asked', async () => {
  const t = await setup();
  await bound(t);
  t.env.GOOGLE_SEARCH_CONSOLE_APPROVED = '';
  const before = t.g.calls.length;
  for (const r of [await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } }), await req(t, 10, `${RESULTS}?project=1`)]) {
    assert.equal(r.status, 503, r.text);
    assert.equal(r.body.error, 'search_console_unavailable');
    assert.equal(r.body.detail, SEARCH_CONSOLE_REFUSALS.search_console_unavailable);
  }
  // The start path checks the flag itself, so a later scheduled caller is dark too.
  await assert.rejects(triggerSearchConsoleSync(t.env, { id: 10, role: 'founder', founder_id: 100 } as any, 1, 'cron'),
    (e: any) => e.status === 503 && e.code === 'search_console_unavailable');
  assert.equal(t.g.calls.length, before, 'nothing sent to Google');
  assert.equal(count(t, 'search_console_sync_runs'), 0, 'no run recorded');
});

test('2. the bound member syncs only the selected property, with their own token, and reads weekly results', async () => {
  const t = await setup();
  await bound(t);
  const r = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.sync.status, 'ok', r.text);
  assert.equal(r.body.sync.site_url, SITE);
  assert.equal(r.body.sync.error_code, null);
  assert.ok(r.body.sync.days_written > 0);
  const today = pacificDate(NOW);
  assert.equal(today, '2026-11-22');
  assert.equal(r.body.sync.range_to, '2026-11-21', 'provider dates end yesterday in Pacific Time');
  assert.equal(r.body.sync.range_from, '2026-08-03', 'sixteen whole Monday-start weeks');
  const calls = analytics(t);
  assert.ok(calls.length > 1);
  for (const c of calls) {
    assert.ok(c.path.startsWith(`/webmasters/v3/sites/${encodeURIComponent(SITE)}`), 'only the selected property is asked for');
    assert.equal(c.auth, 'Bearer fixture-access-1', "the binding member's own token");
    if (c.body) {
      assert.equal(c.body.type, 'web');
      assert.equal(c.body.dataState, 'final');
      assert.ok(!c.body.dimensions.includes('query'), 'no search query dimension');
    }
  }
  const sites = t.db.prepare("SELECT DISTINCT site_url FROM search_console_daily_totals UNION SELECT DISTINCT site_url FROM search_console_top_pages").all() as any[];
  assert.deepEqual(sites.map((s) => s.site_url), [SITE], 'data lands only for the selected property');
  const run = t.db.prepare('SELECT trigger, status FROM search_console_sync_runs').get() as any;
  assert.deepEqual({ ...run }, { trigger: 'manual', status: 'ok' });
  assert.doesNotMatch(r.text, /fixture-(access|refresh)|fixture-client-secret/, 'no token in the answer');

  const w = await req(t, 10, `${RESULTS}?project=1`);
  assert.equal(w.status, 200, w.text);
  assert.doesNotMatch(w.text, /fixture-(access|refresh)/);
  assert.equal(w.body.property.site_url, SITE);
  assert.equal(w.body.search_type, 'web');
  assert.equal(w.body.data_state, 'final');
  assert.equal(w.body.timezone, 'America/Los_Angeles');
  assert.equal(w.body.last_status, 'ok');
  assert.equal(w.body.last_error_detail, null);
  assert.equal(w.body.weeks.length, 16, 'the bounded initial window');
  const full = w.body.weeks.find((x: any) => x.complete);
  assert.ok(full, 'a complete week');
  let clicks = 0, impressions = 0;
  for (let d = full.week_start; d <= addDays(full.week_start, 6); d = addDays(d, 1)) {
    if (Number(d.slice(8, 10)) === 4) continue;
    clicks += figures(d)[0]; impressions += figures(d)[1];
  }
  assert.equal(full.clicks, clicks, 'weekly clicks are the sum of reported days');
  assert.equal(full.impressions, impressions);
  assert.equal(full.ctr, clicks / impressions, 'weekly CTR is total clicks over total impressions');
  assert.equal(full.top_pages.top_rows_only, true);
  assert.equal(full.top_pages.rows.length, 2);
});

test('3. a duplicate run writes nothing; a teammate reads the results but cannot start a sync', async () => {
  const t = await setup();
  await bound(t);
  await bound(t, 11, 1, null);
  assert.equal((await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } })).body.sync.status, 'ok');
  const days = count(t, 'search_console_daily_totals');
  const again = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(again.body.sync.status, 'ok');
  assert.equal(again.body.sync.days_written, 0, 'the overlap re-read changed nothing');
  assert.equal(again.body.sync.corrections, 0);
  assert.equal(count(t, 'search_console_daily_totals'), days);
  assert.equal(count(t, 'search_console_revisions'), 0);

  const before = t.g.calls.length;
  const theirs = await req(t, 11, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(theirs.status, 403, theirs.text);
  assert.equal(theirs.body.error, 'not_your_binding');
  assert.equal(t.g.calls.length, before, "a teammate never spends the binding member's grant");
  const read = await req(t, 11, `${RESULTS}?project=1`);
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.property.site_url, SITE);
});

test('4. cross-venture, a stranger, a support session, no selection and a switched-off company are refused first', async () => {
  const t = await setup();
  await bound(t);
  const before = t.g.calls.length;
  const stranger = await req(t, 30, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.error, 'forbidden');
  assert.equal((await req(t, 30, `${RESULTS}?project=1`)).body.error, 'forbidden', 'a stranger reads nothing');
  const support = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 }, impersonated: true });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  assert.equal((await req(t, 10, `${RESULTS}?project=1`, { impersonated: true })).body.error, 'support_session_refused');
  const unbound = await req(t, 10, SYNC, { method: 'POST', body: { project: 2 } });
  assert.equal(unbound.status, 409);
  assert.equal(unbound.body.error, 'no_property_selected');
  const other = await req(t, 10, `${RESULTS}?project=2`);
  assert.equal(other.status, 200);
  assert.equal(other.body.property, null, "venture 2 never sees venture 1's property");
  assert.match(other.body.reason, /^Not recorded/);
  assert.equal((await req(t, 10, SYNC, { method: 'POST', body: { project: 'x' } })).body.error, 'project_required');
  t.db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(row(t).id);
  const off = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(off.status, 409);
  assert.equal(off.body.error, 'company_not_enabled');
  assert.equal(t.g.calls.length, before, 'refused before any Google request');
  assert.equal(count(t, 'search_console_sync_runs'), 0);
  for (const code of ['no_property_selected', 'not_your_binding', 'company_not_enabled', 'property_denied', 'property_revoked', 'property_malformed', 'forbidden', 'project_required', 'project_not_found', 'not_connected']) {
    assert.ok(SEARCH_CONSOLE_REFUSALS[code], `${code} has a sentence`);
  }
});

test('5. the token dependency: busy and failing refreshes leave the selection; a revoked grant marks it and refuses the next sync', async () => {
  const t = await setup();
  await bound(t);
  // Another isolate holds this connection's refresh lease.
  t.kv.m.set(`${KEY}:refresh:${row(t).uid}`, 'someone-else');
  const busy = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(busy.status, 200, busy.text);
  assert.equal(busy.body.sync.status, 'failed');
  assert.equal(busy.body.sync.error_code, 'token_busy');
  assert.equal(busy.body.sync.detail, SEARCH_CONSOLE_SYNC_OUTCOMES.token_busy);
  assert.equal(selection(t).access_state, 'ok', 'a busy lease never unbinds the property');
  assert.equal(analytics(t).length, 0);
  t.kv.m.clear();

  await expire(t);
  t.g.tokenStatus = 503;
  const down = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(down.body.sync.status, 'failed');
  assert.equal(down.body.sync.error_code, 'google_unavailable');
  assert.equal(selection(t).access_state, 'ok', "Google's token endpoint failing is not a revoked grant");
  const w = await req(t, 10, `${RESULTS}?project=1`);
  assert.equal(w.body.last_error_code, 'google_unavailable');
  assert.equal(w.body.last_error_detail, SEARCH_CONSOLE_SYNC_OUTCOMES.google_unavailable);
  assert.match(w.body.reason, /^Unreadable: the last sync failed/, 'a failed sync is never served as zeros');

  t.g.tokenStatus = 200;
  t.g.revoked = true;
  const gone = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(gone.body.sync.status, 'revoked');
  assert.equal(gone.body.sync.error_code, 'grant_revoked');
  assert.equal(selection(t).access_state, 'revoked');
  const next = await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
  assert.equal(next.status, 409);
  assert.equal(next.body.error, 'property_revoked');
  assert.equal(count(t, 'search_console_daily_totals'), 0, 'nothing landed from any failed run');
  for (const code of ['property_denied', 'grant_revoked', 'rate_limited', 'google_unavailable', 'request_budget', 'malformed_response', 'selection_changed', 'sync_in_progress', 'token_busy', 'token_unavailable']) {
    assert.ok(SEARCH_CONSOLE_SYNC_OUTCOMES[code], `${code} has a sentence`);
  }
});

test('6. nothing logged names the property, a landing page or a token', async () => {
  const t = await setup();
  await bound(t);
  const lines: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of ['log', 'warn', 'error', 'info'] as const) (console as any)[k] = (...a: unknown[]) => { lines.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); };
  try {
    await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
    t.g.revoked = true;
    await req(t, 10, SYNC, { method: 'POST', body: { project: 1 } });
    await req(t, 10, `${RESULTS}?project=1`);
  } finally { Object.assign(console, keep); }
  assert.ok(lines.some((l) => l.includes('grant_revoked')), 'the outcome code is logged');
  for (const l of lines) assert.doesNotMatch(l, /example\.test|fixture-(access|refresh)/, l);
});
