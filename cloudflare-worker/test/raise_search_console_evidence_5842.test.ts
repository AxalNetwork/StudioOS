/**
 * D5842 (#5842) — one founder-selected Search Console aggregate as a Raise evidence candidate, previewed and
 * rechecked from D5840's stored rows through `GET /api/cycles/raise/evidence/search-console/{preview,recheck}`.
 *
 *  1. Dark until the owner's approval flag; founders only (admin, investor, a non-founder member, a support
 *     session and a founder of another venture are refused).
 *  2. Clicks, impressions and weighted CTR for a whole week: exact property, window, search type, units, coverage
 *     and per-day revisions; private; no top page, no other property, no query; repeated choice is deterministic.
 *  3. A property the venture did not select, a week not stored, an incomplete week and an undefined CTR offer no
 *     figure; a day Google returned no row for is disclosed, never counted as zero.
 *  4. Recheck: current; a corrected day gives the original revision's value beside the revised one and requires
 *     review; a forged or cross-venture reference is `missing`; revoked access, a switched-off connection and an
 *     unbound property are `revoked`; an old week is stale.
 *  5. Organic search counts never back paying customers, revenue or conversions.
 *
 * Real SQLite with the production schema; every person, venture, property and figure is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_search_console_evidence_5842.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import cycleRaise from '../src/routes/cycle_raise.ts';
import scEvidence from '../src/routes/raise_search_console_evidence.ts';
import { SEARCH_CONSOLE_NEVER_BACKS, searchConsoleMayBack, materialOf, previewSearchConsoleEvidence, recheckSearchConsoleEvidence, parseSearchConsoleReference } from '../src/services/raiseSearchConsoleEvidence.ts';

const NOW = new Date('2026-11-22T20:00:00Z');
mock.timers.enable({ apis: ['Date'], now: NOW });

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 'e'.repeat(64); // in-memory test signing seed only
const SITE = 'sc-domain:example.test';
const OTHER_SITE = 'https://other.example.test/';
const WEEK = '2026-11-09'; // Monday; the week ends Sunday 15 November
const OLD_WEEK = '2026-07-06';
const PAGE = 'https://example.test/private-landing-page';
const BASE = '/api/cycles/raise/evidence/search-console';

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1),(2,'Synthetic Cofounder','two@example.invalid','founder',100,1),
   (3,'Synthetic Admin','three@example.invalid','admin',NULL,1),(4,'Synthetic Second Founder','four@example.invalid','founder',200,1),
   (5,'Synthetic Investor','five@example.invalid','investor',NULL,1),(6,'Synthetic Member','six@example.invalid','founder',300,1);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One'),(20,'company-two','Synthetic Two');
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10),(2,'venture-two','Second Venture',200,20);
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('l1',1,10),('l2',2,10),('l3',3,10),('l4',4,20),('l6',6,10);
   INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,6,'advisor','accepted');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development', GOOGLE_SEARCH_CONSOLE_APPROVED: '1' };
  const app = new Hono<any>();
  app.route('/api/cycles/raise', scEvidence); app.route('/api/cycles/raise', cycleRaise);
  return { db, env, app };
}
type World = ReturnType<typeof world>;

/** The binding member's active connection, switched on for the venture's company, and the venture's selection. */
function bind(w: World, project: number, user: number, company: number, site: string, integrationId: number) {
  w.db.prepare("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(?,?,?,'google_search_console','oauth2','active')").run(integrationId, 'sc-' + integrationId, user);
  w.db.prepare('INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES(?,?,1)').run(integrationId, company);
  w.db.prepare("INSERT INTO search_console_selections(project_id,user_id,site_url,property_kind,access_state) VALUES(?,?,?,?,'ok')")
    .run(project, user, site, site.startsWith('sc-domain:') ? 'domain' : 'url_prefix');
}
function addDays(day: string, n: number) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** Seven stored days. `figures(i)` is [clicks, impressions] or null for a final date Google returned no row for. */
function storeWeek(w: World, project: number, site: string, week: string, figures: (i: number) => [number, number] | null, skip: number[] = []) {
  for (let i = 0; i < 7; i++) {
    if (skip.includes(i)) continue;
    const f = figures(i), date = addDays(week, i);
    w.db.prepare(`INSERT INTO search_console_daily_totals(project_id,site_url,search_type,data_date,row_state,clicks,impressions,fingerprint,source_revision)
      VALUES(?,?,'web',?,?,?,?,?,1)`).run(project, site, date, f ? 'reported' : 'not_returned', f ? f[0] : null, f ? f[1] : null, `fixture-${f ? f.join('/') : 'none'}`);
  }
  w.db.prepare("INSERT INTO search_console_page_weeks(project_id,site_url,search_type,week_start,week_end,fetched_through,row_limit,rows_returned,truncated,complete,fingerprint) VALUES(?,?,'web',?,?,?,25,1,0,1,'fixture-pages')")
    .run(project, site, week, addDays(week, 6), addDays(week, 6));
  w.db.prepare("INSERT INTO search_console_top_pages(project_id,site_url,search_type,week_start,page,rank,clicks,impressions) VALUES(?,?,'web',?,?,1,999,9999)").run(project, site, week, PAGE);
}
/** A late correction exactly as D5840 records one: the row moves to revision 2, the history keeps revision 1. */
function correct(w: World, project: number, site: string, date: string, clicks: number, impressions: number) {
  const old: any = w.db.prepare("SELECT * FROM search_console_daily_totals WHERE project_id=? AND site_url=? AND data_date=?").get(project, site, date);
  w.db.prepare("UPDATE search_console_daily_totals SET row_state='reported', clicks=?, impressions=?, fingerprint=?, source_revision=? WHERE id=?")
    .run(clicks, impressions, `fixture-${clicks}/${impressions}`, old.source_revision + 1, old.id);
  w.db.prepare(`INSERT INTO search_console_revisions(project_id,site_url,search_type,dataset,period_key,source_revision,fingerprint,previous_fingerprint,previous_json)
    VALUES(?,?,'web','daily_totals',?,?,?,?,?)`).run(project, site, date, old.source_revision + 1, `fixture-${clicks}/${impressions}`, old.fingerprint,
    JSON.stringify({ row_state: old.row_state, clicks: old.clicks, impressions: old.impressions, ctr: null, position: null }));
}
async function call(w: World, who: number, tail: string, params: Record<string, string>, o: { project?: number; company?: number; impersonated?: boolean } = {}) {
  const jwt = await new SignJWT({ user_id: who, ...(o.impersonated ? { impersonated_by: 3 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const qs = new URLSearchParams({ project: String(o.project ?? 1), ...params });
  const r = await w.app.request(`${BASE}/${tail}?${qs}`, { headers: { Authorization: 'Bearer ' + jwt, 'X-Company-Id': String(o.company ?? 10) } }, w.env);
  const text = await r.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, text };
}
const preview = (w: World, metric: string, extra: Record<string, string> = {}, who = 1, o = {}) => call(w, who, 'preview', { site_url: SITE, week_start: WEEK, metric, ...extra }, o);
const refOf = (c: any) => ({ source_ref: c.source_ref, snapshot_hash: c.snapshot_hash, revision_key: c.search_console.revision_key });
// Days: Mon 10/100, Tue 20/200, Wed no row (not_returned), Thu 0/0 (a true zero), Fri 5/50, Sat 3/40, Sun 2/10.
const FIG: Array<[number, number] | null> = [[10, 100], [20, 200], null, [0, 0], [5, 50], [3, 40], [2, 10]];
function standard() {
  const w = world();
  bind(w, 1, 1, 10, SITE, 501);
  bind(w, 2, 4, 20, OTHER_SITE, 502);
  storeWeek(w, 1, SITE, WEEK, (i) => FIG[i]);
  storeWeek(w, 2, OTHER_SITE, WEEK, () => [777, 7777]);
  return w;
}

test('dark until the approval flag, and founders of this venture only', async () => {
  const w = standard();
  w.env.GOOGLE_SEARCH_CONSOLE_APPROVED = '0';
  const dark = await preview(w, 'clicks');
  // Mutation checked: drop `approved()` from the preview → 200 with a candidate and this fails.
  assert.equal(dark.status, 503); assert.equal(dark.body.error, 'search_console_unavailable');
  assert.doesNotMatch(dark.text, /"value_num"/);
  w.env.GOOGLE_SEARCH_CONSOLE_APPROVED = '1';
  assert.equal((await preview(w, 'clicks', {}, 2)).status, 200, 'a cofounder of the venture may choose');
  for (const who of [3, 5, 6]) {
    const r = await preview(w, 'clicks', {}, who);
    assert.equal(r.status, 403, `user ${who} is refused`); assert.doesNotMatch(r.text, /value_num|example\.test/);
  }
  const support = await preview(w, 'clicks', {}, 1, { impersonated: true });
  assert.equal(support.status, 403); assert.equal(support.body.error, 'support_session_refused');
  const otherFounder = await preview(w, 'clicks', {}, 4, { project: 1, company: 20 });
  assert.equal(otherFounder.status, 403, 'a founder of another venture cannot read this one');
  const recheck = await call(w, 5, 'recheck', { source_ref: 'search-console:web:2026-11-09:clicks:0123456789abcdef', snapshot_hash: 'a'.repeat(64), revision_key: '1.1.1.1.1.1.1' });
  assert.equal(recheck.status, 403);
});

test('clicks, impressions and weighted CTR come with the exact property, window, units, coverage and revisions, private and without page or query detail', async () => {
  const w = standard();
  const clicks = await preview(w, 'clicks');
  assert.equal(clicks.status, 200, clicks.text);
  const c = clicks.body.preview.candidate;
  assert.equal(clicks.body.preview.state, 'selectable');
  // Mutation checked: count a not_returned day as 0 reported, or sum Wednesday → days_reported/value change and this fails.
  assert.equal(c.value_num, 40); assert.equal(c.value_unit, 'count');
  assert.deepEqual(c.search_console.window, { from: '2026-11-09', to: '2026-11-15' });
  assert.equal(c.search_console.site_url, SITE); assert.equal(c.search_console.search_type, 'web');
  assert.equal(c.search_console.data_state, 'final'); assert.equal(c.search_console.aggregation_type, 'byProperty');
  assert.equal(c.search_console.timezone, 'America/Los_Angeles');
  assert.deepEqual(c.search_console.coverage, {
    days: 7, days_reported: 6, days_not_returned: 1, days_not_fetched: 0, complete: true, incomplete_reason: null,
    note: 'Google returned no row for 1 of 7 days (missing or suppressed); they add nothing and are not zero.',
  });
  assert.equal(c.search_console.revision_key, '1.1.1.1.1.1.1');
  assert.equal(c.visibility, 'private'); assert.equal(c.private_reason, null);
  assert.equal(c.kind, 'search-console-aggregate'); assert.equal(c.source_table, 'search_console_daily_totals');
  assert.equal(c.provider, 'google_search_console'); assert.equal(c.source_label, 'connector'); assert.equal(c.strength, 'measured');
  assert.equal(c.observed_on, '2026-11-15'); assert.equal(c.stale, false);
  assert.match(c.source_ref, /^search-console:web:2026-11-09:clicks:[a-f0-9]{16}$/);
  assert.doesNotMatch(c.source_ref, /example/, 'the reference names no URL');
  assert.match(c.snapshot_hash, /^[a-f0-9]{64}$/);
  assert.match(c.summary, /not paying customers, revenue or attributed conversions/);
  // Only the selected aggregate: no top page, no other venture's property or figure, no query.
  assert.doesNotMatch(clicks.text, /private-landing-page|other\.example|777|9999|"query"|"page"/);

  const impressions = (await preview(w, 'impressions')).body.preview.candidate;
  assert.equal(impressions.value_num, 400);
  const ctr = (await preview(w, 'ctr')).body.preview.candidate;
  // Weighted: 40 / 400, not the mean of daily CTRs (which would be about 0.083 over the days with impressions).
  assert.equal(ctr.value_num, 0.1); assert.equal(ctr.value_unit, 'ratio');
  assert.equal(ctr.search_console.numerator, 40); assert.equal(ctr.search_console.denominator, 400);
  assert.notEqual(ctr.snapshot_hash, c.snapshot_hash); assert.notEqual(ctr.source_ref, c.source_ref);

  // Repeated choice of the same aggregate: the same reference and hash, and nothing is written.
  const before = w.db.prepare("SELECT (SELECT COUNT(*) FROM raise_evidence_items) + (SELECT COUNT(*) FROM ai_rail_proposals) AS n").get() as any;
  const again = (await preview(w, 'clicks')).body.preview.candidate;
  assert.equal(again.snapshot_hash, c.snapshot_hash); assert.equal(again.source_ref, c.source_ref);
  const after = w.db.prepare("SELECT (SELECT COUNT(*) FROM raise_evidence_items) + (SELECT COUNT(*) FROM ai_rail_proposals) AS n").get() as any;
  assert.equal(after.n, before.n);
});

test('the second founder sees only their own property; an unselected property, an unstored week, an incomplete week and an undefined CTR offer no figure', async () => {
  const w = standard();
  const second = await call(w, 4, 'preview', { site_url: OTHER_SITE, week_start: WEEK, metric: 'clicks' }, { project: 2, company: 20 });
  assert.equal(second.status, 200, second.text);
  assert.equal(second.body.preview.candidate.value_num, 777 * 7);
  assert.doesNotMatch(second.text, /sc-domain:example\.test/);
  // Venture one asking for venture two's property: never read.
  // Mutation checked: drop the `sel.site_url !== selection.site_url` test → venture two's figures are read and this fails.
  const foreign = await preview(w, 'clicks', { site_url: OTHER_SITE });
  assert.equal(foreign.body.preview.state, 'not_selected'); assert.equal(foreign.body.preview.candidate, null);
  assert.doesNotMatch(foreign.text, /777/);

  const unstored = await preview(w, 'clicks', { week_start: '2026-11-02' });
  assert.equal(unstored.body.preview.state, 'not_recorded'); assert.equal(unstored.body.preview.candidate, null);

  storeWeek(w, 1, SITE, '2026-10-26', () => [4, 40], [6]);
  const partial = await preview(w, 'clicks', { week_start: '2026-10-26' });
  // Mutation checked: accept an incomplete week → a candidate summing six days appears and this fails.
  assert.equal(partial.body.preview.state, 'incomplete'); assert.equal(partial.body.preview.candidate, null);
  assert.equal(partial.body.preview.coverage.days_not_fetched, 1);
  assert.equal(partial.body.preview.reason, 'Incomplete: 1 of 7 days not fetched as final');

  storeWeek(w, 1, SITE, '2026-10-19', () => [0, 0]);
  const zeroClicks = await preview(w, 'clicks', { week_start: '2026-10-19' });
  assert.equal(zeroClicks.body.preview.state, 'selectable'); assert.equal(zeroClicks.body.preview.candidate.value_num, 0, 'a reported zero is a true zero');
  const zeroCtr = await preview(w, 'ctr', { week_start: '2026-10-19' });
  assert.equal(zeroCtr.body.preview.state, 'undefined'); assert.equal(zeroCtr.body.preview.candidate, null);
  assert.equal(zeroCtr.body.preview.reason, 'No impressions: CTR is undefined');

  storeWeek(w, 1, SITE, '2026-10-12', () => null);
  const noRows = await preview(w, 'clicks', { week_start: '2026-10-12' });
  assert.equal(noRows.body.preview.state, 'undefined'); assert.equal(noRows.body.preview.candidate, null);
});

test('malformed choices and references are refused before any read', async () => {
  const w = standard();
  for (const extra of [{ week_start: '2026-11-10' }, { metric: 'conversions' }, { metric: 'position' }, { search_type: 'image' }, { site_url: 'example.test' }, { week_start: '2026-02-30' }]) {
    const r = await preview(w, 'clicks', extra);
    assert.equal(r.status, 400, JSON.stringify(extra)); assert.equal(r.body.error, 'invalid');
  }
  for (const ref of [
    { source_ref: 'search-console:web:2026-11-10:clicks:0123456789abcdef', snapshot_hash: 'a'.repeat(64), revision_key: '1.1.1.1.1.1.1' },
    { source_ref: 'search-console:web:2026-11-09:clicks:0123456789abcdef', snapshot_hash: 'xyz', revision_key: '1.1.1.1.1.1.1' },
    { source_ref: 'search-console:web:2026-11-09:clicks:0123456789abcdef', snapshot_hash: 'a'.repeat(64), revision_key: '1.1.1' },
    { source_ref: 'kpi-snapshot:1', snapshot_hash: 'a'.repeat(64), revision_key: '1.1.1.1.1.1.1' },
  ]) {
    const r = await call(w, 1, 'recheck', ref);
    assert.equal(r.status, 400, JSON.stringify(ref)); assert.equal(r.body.error, 'invalid');
  }
});

test('recheck: current, then a corrected day gives the original revision beside the revised value and requires review', async () => {
  const w = standard();
  const c = (await preview(w, 'clicks')).body.preview.candidate;
  const ctr = (await preview(w, 'ctr')).body.preview.candidate;
  const current = await call(w, 1, 'recheck', refOf(c));
  assert.equal(current.status, 200, current.text);
  assert.equal(current.body.recheck.state, 'current'); assert.equal(current.body.recheck.requires_review, false);
  assert.equal(current.body.recheck.revised.value, 40);

  correct(w, 1, SITE, '2026-11-11', 6, 60); // Wednesday: no row → a reported 6/60
  correct(w, 1, SITE, '2026-11-13', 7, 50); // Friday: 5 → 7
  const after = await call(w, 1, 'recheck', refOf(c));
  const r = after.body.recheck;
  // Mutation checked: compare only the hash and skip the history rebuild → `original` is null and this fails;
  // rebuild from the current row instead of previous_json → original.value is 48 and this fails.
  assert.equal(r.state, 'corrected'); assert.equal(r.requires_review, true);
  assert.deepEqual(r.corrected_days, ['2026-11-11', '2026-11-13']);
  assert.equal(r.original.value, 40); assert.equal(r.original.revision_key, '1.1.1.1.1.1.1');
  assert.equal(r.revised.value, 48); assert.equal(r.revised.revision_key, '1.1.2.1.2.1.1');
  assert.notEqual(r.snapshot_hash, c.snapshot_hash);
  const ctrAfter = (await call(w, 1, 'recheck', refOf(ctr))).body.recheck;
  assert.equal(ctrAfter.state, 'corrected'); assert.equal(ctrAfter.original.value, 0.1); assert.equal(ctrAfter.revised.value, 48 / 460);
  // Mutation checked: skip verifying the rebuilt original against the recorded hash → a forged hash on an older revision
  // is reported `corrected` with an unverified original, and this fails.
  const forgedOld = (await call(w, 1, 'recheck', { ...refOf(c), snapshot_hash: 'c'.repeat(64) })).body.recheck;
  assert.equal(forgedOld.state, 'missing'); assert.equal(forgedOld.original, null);

  // The revised preview is a new candidate, never a silent replacement of the recorded one.
  const revised = (await preview(w, 'clicks')).body.preview.candidate;
  assert.equal(revised.value_num, 48); assert.equal(revised.search_console.revision_key, '1.1.2.1.2.1.1');
  assert.equal(revised.source_ref, c.source_ref); assert.notEqual(revised.snapshot_hash, c.snapshot_hash);
  assert.equal((await call(w, 1, 'recheck', refOf(revised))).body.recheck.state, 'current');
});

test('recheck: a forged or cross-venture reference is missing; lost access, a switched-off connection and an unbound property are revoked; an old week is stale', async () => {
  const w = standard();
  const c = (await preview(w, 'clicks')).body.preview.candidate;
  // Mutation checked: return `current` whenever the revision key matches → the forged hash passes and this fails.
  const forged = (await call(w, 1, 'recheck', { ...refOf(c), snapshot_hash: 'b'.repeat(64) })).body.recheck;
  assert.equal(forged.state, 'missing'); assert.equal(forged.requires_review, true); assert.equal(forged.original, null);
  const futureRevision = (await call(w, 1, 'recheck', { ...refOf(c), revision_key: '1.1.1.1.1.1.9' })).body.recheck;
  assert.equal(futureRevision.state, 'missing');

  // Two ventures binding the same property: venture one's reference never verifies in venture two.
  w.db.prepare("UPDATE search_console_selections SET site_url=?, property_kind='domain' WHERE project_id=2").run(SITE);
  storeWeek(w, 2, SITE, WEEK, (i) => FIG[i]);
  const cross = await call(w, 4, 'recheck', refOf(c), { project: 2, company: 20 });
  assert.equal(cross.status, 200, cross.text);
  // Mutation checked: leave project_id out of the snapshot hash → the cross-venture reference is `current` and this fails.
  assert.equal(cross.body.recheck.state, 'missing');

  w.db.prepare("UPDATE search_console_selections SET access_state='revoked' WHERE project_id=1").run();
  const revoked = (await call(w, 1, 'recheck', refOf(c))).body.recheck;
  assert.equal(revoked.state, 'revoked'); assert.equal(revoked.revised, null);
  assert.equal((await preview(w, 'clicks')).body.preview.state, 'revoked');
  w.db.prepare("UPDATE search_console_selections SET access_state='ok' WHERE project_id=1").run();

  w.db.prepare('UPDATE integration_companies SET enabled=0 WHERE integration_id=501').run();
  // Mutation checked: skip the `projectEnabled` check → `selectable` and this fails.
  assert.equal((await preview(w, 'clicks')).body.preview.state, 'revoked');
  w.db.prepare('UPDATE integration_companies SET enabled=1 WHERE integration_id=501').run();
  w.db.prepare("UPDATE integrations SET status='revoked' WHERE id=501").run();
  assert.equal((await call(w, 1, 'recheck', refOf(c))).body.recheck.state, 'revoked');
  w.db.prepare("UPDATE integrations SET status='active' WHERE id=501").run();
  assert.equal((await call(w, 1, 'recheck', refOf(c))).body.recheck.state, 'current');

  w.db.prepare('DELETE FROM search_console_selections WHERE project_id=1').run();
  const unbound = (await call(w, 1, 'recheck', refOf(c))).body.recheck;
  assert.equal(unbound.state, 'revoked'); assert.match(unbound.reason, /no longer selected/);
  // The venture now selects a different property with the same week stored: the old reference is revoked, not re-read.
  // Mutation checked: drop the property-key check → the other property's rows are read, the answer is `missing`, and this fails.
  w.db.prepare("INSERT INTO search_console_selections(project_id,user_id,site_url,property_kind,access_state) VALUES(1,1,?,'url_prefix','ok')").run(OTHER_SITE);
  storeWeek(w, 1, OTHER_SITE, WEEK, (i) => FIG[i]);
  const switched = (await call(w, 1, 'recheck', refOf(c))).body.recheck;
  assert.equal(switched.state, 'revoked'); assert.equal(switched.revised, null);
  w.db.prepare('DELETE FROM search_console_selections WHERE project_id=1').run();

  w.db.prepare("INSERT INTO search_console_selections(project_id,user_id,site_url,property_kind,access_state) VALUES(1,1,?,'domain','ok')").run(SITE);
  storeWeek(w, 1, SITE, OLD_WEEK, () => [1, 10]);
  const old = (await preview(w, 'clicks', { week_start: OLD_WEEK })).body.preview.candidate;
  // Mutation checked: drop the stale flag → `stale` is null/false and this fails.
  assert.equal(old.stale, true);
  assert.equal((await call(w, 1, 'recheck', refOf(old))).body.recheck.stale, true);
});

test('the service refuses a non-founder context directly, not only behind the route gate', async () => {
  const w = standard();
  const ctx: any = { env: w.env, user: w.db.prepare('SELECT * FROM users WHERE id=3').get(), projectId: 1, companyId: 10, founder: false };
  const sel = { site_url: SITE, week_start: WEEK, search_type: 'web' as const, metric: 'clicks' as const };
  // Mutation checked: drop `founderOnly` → the preview returns a candidate and this fails.
  await assert.rejects(previewSearchConsoleEvidence(ctx, sel), (e: any) => e.code === 'forbidden' && e.status === 403);
  const ref = parseSearchConsoleReference({ source_ref: 'search-console:web:2026-11-09:clicks:0123456789abcdef', snapshot_hash: 'a'.repeat(64), revision_key: '1.1.1.1.1.1.1' });
  await assert.rejects(recheckSearchConsoleEvidence(ctx, ref), (e: any) => e.code === 'forbidden');
});

test('organic search counts never back paying customers, revenue or conversions', () => {
  for (const metric of ['clicks', 'impressions', 'ctr'] as const) {
    for (const key of SEARCH_CONSOLE_NEVER_BACKS) assert.equal(searchConsoleMayBack(metric, key), false, `${metric} → ${key}`);
    assert.equal(searchConsoleMayBack(metric, 'organic_search'), true);
  }
  for (const key of ['paying_customers', 'revenue', 'attributed_conversions', 'mrr']) assert.ok(SEARCH_CONSOLE_NEVER_BACKS.includes(key));
  assert.equal(searchConsoleMayBack('clicks', 'organic_search_impressions'), false, 'a metric backs only its own claim');
  // The pure material: a week of not_returned days has no figure, never zero.
  const m = materialOf('2026-11-09', 'clicks', Array.from({ length: 7 }, (_, i) => ({
    data_date: addDays('2026-11-09', i), row_state: 'not_returned' as const, clicks: null, impressions: null, fingerprint: 'f', source_revision: 1,
  })));
  assert.equal(m.value, null); assert.equal(m.coverage.days_not_returned, 7);
});
