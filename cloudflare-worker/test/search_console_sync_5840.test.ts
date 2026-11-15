/**
 * D5840 (#5840) — Search Console: finalized daily property totals and weekly top landing pages, from fixtures.
 *
 * Covers URL-prefix and `sc-domain:` properties, Pacific Time and week boundaries, a zero denominator,
 * late corrections, truncated page lists, a denied property and a revoked grant, 429 and 5xx with backoff,
 * interrupted pagination, duplicate runs, cross-venture access, and that new data lands only for the
 * selected property. Every venture, person, site and figure is made up; no request leaves the process.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/search_console_sync_5840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  LIMITS, SearchConsoleError, SearchConsoleRefusal, pagesBody, propertyKind, searchConsoleWeekly, siteUrlPath, syncSearchConsole, totalsBody,
} from '../src/services/searchConsoleSync.ts';
import { addDays, pacificDate, weekStartOf, weekTotals } from '../src/services/searchConsoleWeeks.ts';

const URL_SITE = 'https://shop.example.test/';
const DOMAIN_SITE = 'sc-domain:example.test';
const NOW = new Date('2026-11-15T20:00:00Z'); // Sunday 15 Nov, 12:00 in Los Angeles
const FOUNDER = { id: 1, role: 'founder' as const, founder_id: 11 };
const OTHER = { id: 2, role: 'founder' as const, founder_id: 22 };
const ADVISOR = { id: 3, role: 'founder' as const, founder_id: 33 };
const SMALL = { initialWeeks: 2, chunkWeeks: 1 };

/** Week of 2 Nov: a true zero (5 Nov), one date with no row (4 Nov), clicks 35 over 400 impressions. */
const WEEK1: Record<string, [number, number]> = {
  '2026-11-02': [10, 100], '2026-11-03': [0, 50], '2026-11-05': [0, 0], '2026-11-06': [20, 200], '2026-11-07': [1, 10], '2026-11-08': [4, 40],
};
const WEEK2: Record<string, [number, number]> = { '2026-11-09': [3, 30], '2026-11-10': [2, 20], '2026-11-11': [5, 50], '2026-11-12': [1, 10], '2026-11-13': [7, 70] };

function world() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users (id, uid, email, name, role, founder_id, is_active) VALUES
      (1, 'u1', 'one@example.invalid', 'Synthetic one', 'founder', 11, 1),
      (2, 'u2', 'two@example.invalid', 'Synthetic two', 'founder', 22, 1),
      (3, 'u3', 'three@example.invalid', 'Synthetic three', 'founder', 33, 1);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p10', 'Venture A', 11), (20, 'p20', 'Venture B', 22);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (10, 3, 'advisor', 'accepted');`);
  return { db, env: { DB: d1Over(db) } as any };
}
function select(db: DatabaseSync, project: number, site: string, user = 1) {
  db.prepare(`INSERT INTO search_console_selections (project_id, user_id, site_url, property_kind, permission_level) VALUES (?, ?, ?, ?, 'siteOwner')
    ON CONFLICT(project_id) DO UPDATE SET site_url = excluded.site_url, property_kind = excluded.property_kind, access_state = 'ok'`)
    .run(project, user, site, propertyKind(site));
}

type Rows = Record<string, [number, number]>;
type Call = { url: string; method: string; body: any; n: number };
/** A fake Search Analytics API: per site, daily rows and a page list; `fail` may answer any call first. */
function google(data: Record<string, Rows>, opts: { fail?: (c: Call) => Response | null | undefined; pages?: (site: string, from: string, to: string) => any[]; perm?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: any) => {
    const call: Call = { url, method: init.method, body: init.body ? JSON.parse(init.body) : null, n: calls.length + 1 };
    calls.push(call);
    const forced = opts.fail?.(call);
    if (forced) return forced;
    const m = /^https:\/\/searchconsole\.googleapis\.com\/webmasters\/v3\/sites\/([^/]+)(\/searchAnalytics\/query)?$/.exec(url);
    if (!m) return new Response('no', { status: 400 });
    const site = decodeURIComponent(m[1]);
    if (!data[site]) return new Response('{}', { status: 403 });
    if (!m[2]) return Response.json({ siteUrl: site, permissionLevel: opts.perm?.[site] ?? 'siteFullUser' });
    const b = call.body;
    if (b.dimensions[0] === 'date') {
      const rows = Object.entries(data[site]).filter(([d]) => d >= b.startDate && d <= b.endDate).sort()
        .map(([d, [clicks, impressions]]) => ({ keys: [d], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: 4.5 }));
      return Response.json({ rows: rows.slice(b.startRow, b.startRow + b.rowLimit), responseAggregationType: 'byProperty' });
    }
    const pages = opts.pages ? opts.pages(site, b.startDate, b.endDate) : [
      { keys: [site.replace('sc-domain:', 'https://') + (site.endsWith('/') ? '' : '/') + 'pricing'], clicks: 9, impressions: 90, ctr: 0.1, position: 2 },
      { keys: [site.replace('sc-domain:', 'https://') + (site.endsWith('/') ? '' : '/') + 'blog'], clicks: 2, impressions: 80, ctr: 0.025, position: 7 },
    ];
    return Response.json({ rows: pages.slice(0, b.rowLimit), responseAggregationType: 'byPage' });
  };
  return { calls, fetcher };
}
function deps(fetcher: any, extra: any = {}) {
  const sleeps: number[] = [];
  return {
    sleeps,
    d: { accessToken: async () => 'fixture-token', fetcher, now: () => NOW, sleep: async (ms: number) => { sleeps.push(ms); }, limits: { ...SMALL, ...(extra.limits || {}) }, ...extra.d },
  };
}
const count = (db: DatabaseSync, table: string, where = '1') => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as any).n;
const day = (db: DatabaseSync, site: string, date: string) => db.prepare('SELECT * FROM search_console_daily_totals WHERE site_url = ? AND data_date = ?').get(site, date) as any;

test('property identifiers: sc-domain and URL-prefix are kept exactly and encoded into the request path', () => {
  assert.equal(propertyKind(DOMAIN_SITE), 'domain');
  assert.equal(propertyKind(URL_SITE), 'url_prefix');
  assert.equal(propertyKind('https://shop.example.test'), null, 'a URL prefix ends with a slash');
  assert.equal(propertyKind('https://shop.example.test/?q=1'), null);
  assert.equal(propertyKind('sc-domain:Example.test'), null, 'Search Console lists domain properties in lower case');
  assert.equal(propertyKind('ftp://example.test/'), null);
  assert.equal(siteUrlPath(DOMAIN_SITE), 'https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.test');
  assert.equal(siteUrlPath(URL_SITE, '/searchAnalytics/query'), 'https://searchconsole.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fshop.example.test%2F/searchAnalytics/query');
});

test('request bodies: finalized web data, date-only byProperty totals, byPage top pages, never the query dimension', () => {
  assert.deepEqual(totalsBody('2026-11-02', '2026-11-08', 25000, 0), { startDate: '2026-11-02', endDate: '2026-11-08', dimensions: ['date'], type: 'web', aggregationType: 'byProperty', dataState: 'final', rowLimit: 25000, startRow: 0 });
  assert.deepEqual(pagesBody('2026-11-02', '2026-11-08', 25), { startDate: '2026-11-02', endDate: '2026-11-08', dimensions: ['page'], type: 'web', aggregationType: 'byPage', dataState: 'final', rowLimit: 25, startRow: 0 });
});

for (const site of [URL_SITE, DOMAIN_SITE]) {
  test(`first sync of ${site}: bounded window, exact property, final rows, missing vs true zero, top pages kept apart`, async () => {
    const { db, env } = world();
    select(db, 10, site);
    const g = google({ [site]: { ...WEEK1, ...WEEK2 } });
    const { d } = deps(g.fetcher);
    const r = await syncSearchConsole(env, FOUNDER, 10, d);
    assert.equal(r.status, 'ok');
    assert.equal(r.range_from, '2026-11-02', 'two whole weeks back from the last requested date');
    assert.equal(r.range_to, '2026-11-14', 'yesterday in Pacific Time');
    assert.equal(r.fetched_through, '2026-11-13', 'the latest final date Google returned');
    for (const c of g.calls) {
      assert.ok(c.url.startsWith(siteUrlPath(site)), 'every call names the selected property');
      assert.ok(!JSON.stringify(c.body ?? {}).includes('query'), 'no search query dimension is ever requested');
    }
    const totals = g.calls.filter((c) => c.body?.dimensions[0] === 'date');
    assert.deepEqual(totals.map((c) => [c.body.startDate, c.body.endDate]), [['2026-11-02', '2026-11-08'], ['2026-11-09', '2026-11-14']]);
    assert.equal(count(db, 'search_console_daily_totals', `site_url <> '${site.replace(/'/g, "''")}'`), 0);
    assert.equal(day(db, site, '2026-11-05').row_state, 'reported');
    assert.equal(day(db, site, '2026-11-05').impressions, 0, 'a reported zero stays a zero');
    assert.equal(day(db, site, '2026-11-04').row_state, 'not_returned');
    assert.equal(day(db, site, '2026-11-04').clicks, null, 'a date with no row is never 0');
    assert.equal(day(db, site, '2026-11-14'), undefined, 'a date not yet final is not written');
    const state = db.prepare('SELECT * FROM search_console_sync_state WHERE project_id = 10').get() as any;
    assert.equal(state.site_url, site);
    assert.equal(state.search_type, 'web');
    assert.equal(state.data_state, 'final');
    assert.equal(state.provider_timezone, 'America/Los_Angeles');
    assert.deepEqual(JSON.parse(state.units_json), { clicks: 'count', impressions: 'count', ctr: 'ratio', position: 'average_rank' });
    assert.equal(state.run_token, null, 'the claim is released');

    const w = await searchConsoleWeekly(env, FOUNDER, 10);
    assert.equal(w.property!.site_url, site);
    const [first, second] = w.weeks as any[];
    assert.equal(first.clicks, 35);
    assert.equal(first.impressions, 400);
    assert.equal(first.ctr, 35 / 400, 'weekly CTR is total clicks over total impressions');
    assert.equal(first.days_reported, 6);
    assert.equal(first.days_not_returned, 1);
    assert.equal(first.complete, true);
    assert.equal(second.complete, false, 'the week holding dates not yet final is flagged');
    assert.match(second.incomplete_reason, /Not final yet: fetched through 2026-11-13/);
    assert.equal(second.clicks, 18);
    const pageClicks = first.top_pages.rows.reduce((s: number, p: any) => s + p.clicks, 0);
    assert.equal(pageClicks, 11);
    assert.notEqual(pageClicks, first.clicks, 'property totals never come from top-page detail');
    assert.equal(first.top_pages.top_rows_only, true);
    assert.equal(first.top_pages.truncated, false);
    assert.equal(second.top_pages.complete, false);
    assert.equal(second.top_pages.fetched_through, '2026-11-13');
    assert.ok(w.top_rows_note.includes('never summed'));
  });
}

test('no column anywhere in the Search Console tables can hold a search query', () => {
  const { db } = world();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'search_console_%'").all() as any[]).map((t) => t.name);
  assert.equal(tables.length >= 7, true);
  for (const t of tables) {
    for (const c of db.prepare(`PRAGMA table_info(${t})`).all() as any[]) assert.doesNotMatch(c.name, /query|queries|keyword/i, `${t}.${c.name}`);
  }
});

test('Pacific Time: provider dates follow Los Angeles across both DST changes, and weeks start on Monday', async () => {
  assert.equal(pacificDate(new Date('2026-03-09T06:30:00Z')), '2026-03-08', 'UTC has moved to the 9th, Los Angeles has not');
  assert.equal(pacificDate(new Date('2026-11-01T07:30:00Z')), '2026-11-01', '00:30 PDT on the day PDT ends');
  assert.equal(pacificDate(new Date('2026-11-02T07:30:00Z')), '2026-11-01', '23:30 PST');
  assert.equal(pacificDate(new Date('2026-11-02T08:00:00Z')), '2026-11-02');
  assert.equal(weekStartOf('2026-11-08'), '2026-11-02', 'Sunday closes the week');
  assert.equal(weekStartOf('2026-11-09'), '2026-11-09');
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');

  const { db, env } = world();
  select(db, 10, URL_SITE);
  const g = google({ [URL_SITE]: {} });
  const r = await syncSearchConsole(env, FOUNDER, 10, { ...deps(g.fetcher).d, now: () => new Date('2026-03-09T06:30:00Z') });
  assert.equal(r.range_to, '2026-03-07', 'yesterday is taken in Pacific Time, not UTC');
});

test('weekly math: zero impressions leave CTR undefined, a week of no rows is not a zero, failures read as unreadable', () => {
  const zero = weekTotals('2026-11-02', ['02', '03', '04', '05', '06', '07', '08'].map((d) => ({ data_date: `2026-11-${d}`, row_state: 'reported' as const, clicks: 0, impressions: 0 })), { fetchedThrough: '2026-11-13', initialFrom: '2026-11-02' });
  assert.equal(zero.clicks, 0);
  assert.equal(zero.impressions, 0);
  assert.equal(zero.ctr, null, 'zero impressions give no CTR, never 0');
  assert.match(zero.ctr_reason!, /No impressions/);
  const none = weekTotals('2026-11-02', [{ data_date: '2026-11-02', row_state: 'not_returned', clicks: null, impressions: null }], { fetchedThrough: '2026-11-02', initialFrom: '2026-11-02' });
  assert.equal(none.clicks, null);
  assert.equal(none.ctr, null);
  assert.equal(none.complete, false);
  const failed = weekTotals('2026-11-09', [], { fetchedThrough: '2026-11-08', initialFrom: '2026-11-02', failure: 'rate_limited' });
  assert.match(failed.incomplete_reason!, /^Unreadable: the last sync failed \(rate_limited\)/);
  assert.equal(failed.days_not_fetched, 7);
});

test('late corrections get a new revision with the previous values; a duplicate run writes nothing new', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  const data = { [URL_SITE]: { ...WEEK1, ...WEEK2 } };
  const g = google(data);
  await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d);
  const before = { days: count(db, 'search_console_daily_totals'), pages: count(db, 'search_console_top_pages'), revs: count(db, 'search_console_revisions') };
  assert.equal(before.revs, 0);

  const again = await syncSearchConsole(env, FOUNDER, 10, deps(google(data).fetcher).d);
  assert.equal(again.status, 'ok');
  assert.equal(again.range_from, '2026-11-06', 'later runs overlap the last fetched days');
  assert.equal(again.days_written, 0, 'a duplicate run changes nothing');
  assert.equal(again.corrections, 0);
  assert.deepEqual({ days: count(db, 'search_console_daily_totals'), pages: count(db, 'search_console_top_pages'), revs: count(db, 'search_console_revisions') }, before);

  data[URL_SITE]['2026-11-07'] = [3, 12]; // Google corrected a final date
  const fixed = await syncSearchConsole(env, FOUNDER, 10, deps(google(data).fetcher).d);
  assert.equal(fixed.corrections, 1);
  const row = day(db, URL_SITE, '2026-11-07');
  assert.equal(row.clicks, 3);
  assert.equal(row.source_revision, 2);
  const rev = db.prepare("SELECT * FROM search_console_revisions WHERE dataset = 'daily_totals'").get() as any;
  assert.equal(rev.period_key, '2026-11-07');
  assert.equal(rev.source_revision, 2);
  assert.equal(JSON.parse(rev.previous_json).clicks, 1);
  assert.equal(rev.fingerprint, row.fingerprint);
  assert.notEqual(rev.previous_fingerprint, row.fingerprint);
  const w = await searchConsoleWeekly(env, FOUNDER, 10);
  assert.equal((w.weeks as any[])[0].clicks, 37, 'the corrected value is the one summed');
});

test('a full top-page list is flagged truncated', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  const many = Array.from({ length: 5 }, (_, i) => ({ keys: [`https://shop.example.test/p${i}`], clicks: 5 - i, impressions: 50, ctr: 0.1, position: 3 }));
  const g = google({ [URL_SITE]: WEEK1 }, { pages: () => many });
  await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher, { limits: { topPagesLimit: 3 } }).d);
  const pw = db.prepare("SELECT * FROM search_console_page_weeks WHERE week_start = '2026-11-02'").get() as any;
  assert.equal(pw.rows_returned, 3);
  assert.equal(pw.truncated, 1);
  assert.equal(count(db, 'search_console_top_pages', "week_start = '2026-11-02'"), 3);
  const short = world();
  select(short.db, 10, URL_SITE);
  await syncSearchConsole(short.env, FOUNDER, 10, deps(google({ [URL_SITE]: WEEK1 }, { pages: () => many.slice(0, 2) }).fetcher, { limits: { topPagesLimit: 3 } }).d);
  assert.equal((short.db.prepare("SELECT truncated FROM search_console_page_weeks WHERE week_start = '2026-11-02'").get() as any).truncated, 0);
});

test('a denied property stores nothing, marks the selection and refuses the next sync; an unverified user is denied too', async () => {
  for (const setup of [{ data: {}, perm: undefined }, { data: { [URL_SITE]: WEEK1 }, perm: { [URL_SITE]: 'siteUnverifiedUser' } }]) {
    const { db, env } = world();
    select(db, 10, URL_SITE);
    const g = google(setup.data, { perm: setup.perm });
    const r = await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d);
    assert.equal(r.status, 'denied');
    assert.equal(r.error_code, 'property_denied');
    assert.equal(count(db, 'search_console_daily_totals'), 0);
    assert.equal(count(db, 'search_console_top_pages'), 0);
    assert.equal((db.prepare('SELECT access_state FROM search_console_selections').get() as any).access_state, 'denied');
    assert.equal((db.prepare('SELECT last_status FROM search_console_sync_state').get() as any).last_status, 'denied');
    await assert.rejects(syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d), (e: any) => e instanceof SearchConsoleRefusal && e.code === 'property_denied' && e.status === 409);
  }
});

test('a revoked grant (401 or a token that cannot be minted) marks the selection revoked', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  const g = google({ [URL_SITE]: WEEK1 }, { fail: () => new Response('', { status: 401 }) });
  const r = await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d);
  assert.equal(r.status, 'revoked');
  assert.equal(g.calls.length, 1, '401 is never retried');
  assert.equal((db.prepare('SELECT access_state FROM search_console_selections').get() as any).access_state, 'revoked');
  const b = world();
  select(b.db, 10, URL_SITE);
  const r2 = await syncSearchConsole(b.env, FOUNDER, 10, { ...deps(google({ [URL_SITE]: WEEK1 }).fetcher).d, accessToken: async () => { throw new SearchConsoleError('grant_revoked'); } });
  assert.equal(r2.status, 'revoked');
});

test('429 backs off as Retry-After says and then succeeds; persistent 503 backs off exponentially and fails without data', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  let limited = 0;
  const g = google({ [URL_SITE]: WEEK1 }, { fail: (c) => (c.body?.dimensions[0] === 'date' && limited++ < 2 ? new Response('', { status: 429, headers: { 'Retry-After': '7' } }) : null) });
  const { d, sleeps } = deps(g.fetcher);
  const r = await syncSearchConsole(env, FOUNDER, 10, d);
  assert.equal(r.status, 'ok');
  assert.equal(r.retries, 2);
  assert.deepEqual(sleeps, [7000, 7000]);

  const b = world();
  select(b.db, 10, URL_SITE);
  const down = google({ [URL_SITE]: WEEK1 }, { fail: (c) => (c.body ? new Response('', { status: 503 }) : null) });
  const x = deps(down.fetcher);
  const r2 = await syncSearchConsole(b.env, FOUNDER, 10, x.d);
  assert.equal(r2.status, 'failed');
  assert.equal(r2.error_code, 'google_unavailable');
  assert.deepEqual(x.sleeps, [1000, 2000, 4000]);
  assert.equal(down.calls.filter((c) => c.body).length, LIMITS.maxAttempts);
  assert.equal(count(b.db, 'search_console_daily_totals'), 0);
  const state = b.db.prepare('SELECT * FROM search_console_sync_state').get() as any;
  assert.equal(state.fetched_through, null, 'a failed fetch advances nothing');
  assert.equal(state.last_status, 'failed');
  assert.equal(state.run_token, null);
  const w = await searchConsoleWeekly(b.env, FOUNDER, 10);
  assert.match((w as any).reason, /^Unreadable: the last sync failed \(google_unavailable\)/, 'a failed fetch is not reported as zero');
  const rl = world();
  select(rl.db, 10, URL_SITE);
  const r3 = await syncSearchConsole(rl.env, FOUNDER, 10, deps(google({ [URL_SITE]: WEEK1 }, { fail: (c) => (c.body ? new Response('', { status: 429 }) : null) }).fetcher).d);
  assert.equal(r3.error_code, 'rate_limited');
});

test('interrupted pagination keeps the chunks before it, writes nothing of the broken one, and a rerun finishes', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  const data = { [URL_SITE]: { ...WEEK1, ...WEEK2 } };
  const g = google(data, { fail: (c) => (c.body?.startDate === '2026-11-09' && c.body.startRow > 0 ? new Response('', { status: 500 }) : null) });
  const r = await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher, { limits: { totalsRowLimit: 3 } }).d);
  assert.equal(r.status, 'partial');
  assert.equal(r.fetched_through, '2026-11-08');
  const pagedFirst = g.calls.filter((c) => c.body?.startDate === '2026-11-02' && c.body.dimensions[0] === 'date').map((c) => c.body.startRow);
  assert.deepEqual(pagedFirst, [0, 3, 6], 'pages while a page comes back full');
  assert.equal(count(db, 'search_console_daily_totals', "data_date >= '2026-11-09'"), 0, 'none of the interrupted chunk is written');
  assert.equal(count(db, 'search_console_page_weeks', "week_start = '2026-11-09'"), 0);
  assert.equal(count(db, 'search_console_daily_totals'), 7);
  assert.equal((db.prepare('SELECT fetched_through FROM search_console_sync_state').get() as any).fetched_through, '2026-11-08');

  const ok = await syncSearchConsole(env, FOUNDER, 10, deps(google(data).fetcher, { limits: { totalsRowLimit: 3 } }).d);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.fetched_through, '2026-11-13');
  assert.equal(count(db, 'search_console_daily_totals'), 12);
});

test('a run already holding the claim makes a concurrent duplicate answer busy without calling Google', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  db.exec("INSERT INTO search_console_sync_state (project_id, site_url, run_token, run_started_at) VALUES (10, 'https://shop.example.test/', 'other-run', '2026-11-15 19:58:00')");
  const g = google({ [URL_SITE]: WEEK1 });
  const r = await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d);
  assert.equal(r.status, 'busy');
  assert.equal(g.calls.length, 0);
  assert.equal(count(db, 'search_console_daily_totals'), 0);
  db.exec("UPDATE search_console_sync_state SET run_started_at = '2026-11-15 19:30:00'");
  assert.equal((await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d)).status, 'ok', 'a claim older than 15 minutes is taken over');
});

test('cross-venture: another founder neither syncs nor reads, an advisor reads but cannot sync, and data stays per venture', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  select(db, 20, DOMAIN_SITE, 2);
  const g = google({ [URL_SITE]: WEEK1, [DOMAIN_SITE]: WEEK2 });
  await assert.rejects(syncSearchConsole(env, OTHER, 10, deps(g.fetcher).d), (e: any) => e.status === 403);
  await assert.rejects(searchConsoleWeekly(env, OTHER, 10), (e: any) => e.status === 403);
  await assert.rejects(syncSearchConsole(env, ADVISOR, 10, deps(g.fetcher).d), (e: any) => e.status === 403);
  assert.equal(g.calls.length, 0);
  await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d);
  await syncSearchConsole(env, OTHER, 20, deps(g.fetcher).d);
  assert.equal((await searchConsoleWeekly(env, ADVISOR, 10)).property!.site_url, URL_SITE);
  assert.equal(count(db, 'search_console_daily_totals', `project_id = 10 AND site_url <> '${URL_SITE}'`), 0);
  assert.equal(count(db, 'search_console_daily_totals', `project_id = 20 AND site_url <> '${DOMAIN_SITE}'`), 0);
  const b = await searchConsoleWeekly(env, OTHER, 20);
  assert.equal((b.weeks as any[])[1].clicks, 18);
  await assert.rejects(syncSearchConsole(env, FOUNDER, 99, deps(g.fetcher).d), (e: any) => e.status === 404);
});

test('new data lands only for the selected property: a selection changed mid-run writes nothing for the old one', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  const g = google({ [URL_SITE]: WEEK1, [DOMAIN_SITE]: WEEK1 }, {
    fail: (c) => { if (c.body?.dimensions[0] === 'page') select(db, 10, DOMAIN_SITE); return null; },
  });
  const r = await syncSearchConsole(env, FOUNDER, 10, deps(g.fetcher).d);
  assert.equal(r.status, 'failed');
  assert.equal(r.error_code, 'selection_changed');
  assert.equal(count(db, 'search_console_daily_totals'), 0);
  assert.equal(count(db, 'search_console_top_pages'), 0);

  const next = await syncSearchConsole(env, FOUNDER, 10, deps(google({ [URL_SITE]: WEEK1, [DOMAIN_SITE]: WEEK1 }).fetcher).d);
  assert.equal(next.site_url, DOMAIN_SITE);
  assert.equal(count(db, 'search_console_daily_totals', `site_url = '${URL_SITE}'`), 0);
  assert.ok(count(db, 'search_console_daily_totals', `site_url = '${DOMAIN_SITE}'`) > 0);
  assert.equal((await searchConsoleWeekly(env, FOUNDER, 10)).property!.site_url, DOMAIN_SITE);
  const none = world();
  await assert.rejects(syncSearchConsole(none.env, FOUNDER, 10, deps(g.fetcher).d), (e: any) => e.code === 'no_property_selected');
  assert.match(((await searchConsoleWeekly(none.env, FOUNDER, 10)) as any).reason, /^Not recorded: no Search Console property selected/);
});

test('a chunk not final to its end stops the run: later dates are never written past the gap', async () => {
  const { db, env } = world();
  select(db, 10, URL_SITE);
  const gap = { '2026-11-02': [1, 10], '2026-11-03': [1, 10], '2026-11-04': [1, 10], '2026-11-05': [1, 10], ...WEEK2 } as Rows;
  const r = await syncSearchConsole(env, FOUNDER, 10, deps(google({ [URL_SITE]: gap }).fetcher, { limits: { finalLagDays: 9 } }).d);
  assert.equal(r.fetched_through, '2026-11-06', 'today − 9 days, past the latest row of the first chunk');
  assert.equal(count(db, 'search_console_daily_totals', "data_date > '2026-11-06'"), 0);
});
