/**
 * D5842 part 2 (#5842) — the lifecycle of one founder-chosen Search Console aggregate as Raise evidence, through
 * `/api/cycles/raise/evidence/search-console/selections` and the existing evidence paths it reuses:
 *
 *  1. Pin: dark until the approval flag; founders only (an admin, an investor, a non-founder member and a support
 *     session are refused, nothing written); another venture's founder, claim or property is refused; the item is
 *     pinned and Private; the same choice again writes nothing; a hash the founder did not see is refused.
 *  2. Claims: organic search never backs paying customers, revenue, conversions or traction proof, through the pin,
 *     the generic claim link or the claim check; an organic-search claim stated in the narrative is backed.
 *  3. Sharing is separate: only the selected aggregate and its context reach the investor, never the property URL, a
 *     page or another property; a Summary share carries no figure; switching sharing off removes it.
 *  4. A corrected week reads "changed", leaves every shared view, cannot be confirmed in place, and is re-reviewed onto
 *     the revised revision as a new Private item, with the original beside the revised value.
 *  5. Revoked access, a switched-off connection and an unselected property withdraw it from every shared view;
 *     withdrawal does so for good, and an investor opening the shared claim afterwards sees nothing of it. An old week is stale.
 *  6. Scoring, Eadwyn's pack and an admin's read never carry it; the narrative parser states the organic figures.
 *
 * Real SQLite with the production schema; every person, venture, property and figure is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_search_console_lifecycle_5842.test.ts
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
import { checkClaims } from '../src/services/raiseClaims.ts';
import { parseStatedFigures } from '../src/services/raiseCycle.ts';
import { evidencePack, investorEvidence, readRaiseEvidence } from '../src/services/raiseEvidence.ts';
import { packFacts } from '../src/services/raiseShareProposals.ts';

const NOW = new Date('2026-11-22T20:00:00Z');
mock.timers.enable({ apis: ['Date'], now: NOW });

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 'f'.repeat(64); // in-memory test signing seed only
const SITE = 'sc-domain:example.test';
const OTHER_SITE = 'https://other.example.test/';
const WEEK = '2026-11-09'; // Monday; the week ends Sunday 15 November
const OLD_WEEK = '2026-07-06';
const PAGE = 'https://example.test/private-landing-page';
const BASE = '/api/cycles/raise/evidence/search-console';
const FOUNDER = 1, COFOUNDER = 2, ADMIN = 3, SECOND = 4, INVESTOR = 5, MEMBER = 6;
/** Nothing an investor reads may name the property, a page or the other venture's property. */
const NEVER_SHARED = /example\.test|private-landing-page|fixture-|search-console:web|777/;

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1),(2,'Synthetic Cofounder','two@example.invalid','founder',100,1),
   (3,'Synthetic Admin','three@example.invalid','admin',NULL,1),(4,'Synthetic Second Founder','four@example.invalid','founder',200,1),
   (5,'Synthetic Investor','five@example.invalid','investor',NULL,1),(6,'Synthetic Member','six@example.invalid','founder',300,1);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One'),(20,'company-two','Synthetic Two');
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10),(2,'venture-two','Second Venture',200,20);
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('l1',1,10),('l2',2,10),('l3',3,10),('l4',4,20),('l6',6,10);
   INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,6,'advisor','accepted');
   INSERT INTO raise_claims(id,uid,project_id,surface,surface_version,field_key,claim_kind,stated_value) VALUES
     (1,'claim-clicks',1,'deck','v1','slide:1#organic_search_clicks','organic_search_clicks','40'),
     (2,'claim-clicks-two',1,'deck','v1','slide:2#organic_search_clicks','organic_search_clicks','40'),
     (3,'claim-ctr',1,'deck','v1','slide:3#organic_search_ctr','organic_search_ctr','10'),
     (4,'claim-customers',1,'deck','v1','slide:4#paying_customers','paying_customers','40'),
     (5,'claim-revenue',1,'deck','v1','slide:5#revenue','revenue','40'),
     (6,'claim-traction',1,'readiness','current','traction','traction_proof',NULL),
     (7,'claim-conversions',1,'deck','v1','slide:6#conversions','conversions','40'),
     (8,'claim-other',2,'deck','v1','slide:1#organic_search_clicks','organic_search_clicks','777');
   INSERT INTO readiness_items(project_id,item_key,label,position) VALUES(1,'traction','Traction proof',1);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development', GOOGLE_SEARCH_CONSOLE_APPROVED: '1' };
  const app = new Hono<any>();
  app.route('/api/cycles/raise', scEvidence); app.route('/api/cycles/raise', cycleRaise);
  return { db, env, app };
}
type World = ReturnType<typeof world>;

function bind(w: World, project: number, user: number, company: number, site: string, integrationId: number) {
  w.db.prepare("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(?,?,?,'google_search_console','oauth2','active')").run(integrationId, 'sc-' + integrationId, user);
  w.db.prepare('INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES(?,?,1)').run(integrationId, company);
  w.db.prepare("INSERT INTO search_console_selections(project_id,user_id,site_url,property_kind,access_state) VALUES(?,?,?,?,'ok')")
    .run(project, user, site, site.startsWith('sc-domain:') ? 'domain' : 'url_prefix');
}
function addDays(day: string, n: number) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function storeWeek(w: World, project: number, site: string, week: string, figures: (i: number) => [number, number] | null) {
  for (let i = 0; i < 7; i++) {
    const f = figures(i), date = addDays(week, i);
    w.db.prepare(`INSERT INTO search_console_daily_totals(project_id,site_url,search_type,data_date,row_state,clicks,impressions,fingerprint,source_revision)
      VALUES(?,?,'web',?,?,?,?,?,1)`).run(project, site, date, f ? 'reported' : 'not_returned', f ? f[0] : null, f ? f[1] : null, `fixture-${date}-${f ? f.join('/') : 'none'}`);
  }
  w.db.prepare("INSERT INTO search_console_top_pages(project_id,site_url,search_type,week_start,page,rank,clicks,impressions) VALUES(?,?,'web',?,?,1,999,9999)").run(project, site, week, PAGE);
}
/** A late correction exactly as D5840 records one: the row moves to revision 2, the history keeps revision 1. */
function correct(w: World, project: number, site: string, date: string, clicks: number, impressions: number) {
  const old: any = w.db.prepare('SELECT * FROM search_console_daily_totals WHERE project_id=? AND site_url=? AND data_date=?').get(project, site, date);
  w.db.prepare("UPDATE search_console_daily_totals SET row_state='reported', clicks=?, impressions=?, fingerprint=?, source_revision=? WHERE id=?")
    .run(clicks, impressions, `fixture-${date}-${clicks}/${impressions}`, old.source_revision + 1, old.id);
  w.db.prepare(`INSERT INTO search_console_revisions(project_id,site_url,search_type,dataset,period_key,source_revision,fingerprint,previous_fingerprint,previous_json)
    VALUES(?,?,'web','daily_totals',?,?,?,?,?)`).run(project, site, date, old.source_revision + 1, `fixture-${date}-${clicks}/${impressions}`, old.fingerprint,
    JSON.stringify({ row_state: old.row_state, clicks: old.clicks, impressions: old.impressions, ctr: null, position: null }));
}
async function call(w: World, who: number, method: string, path: string, body?: unknown, o: { project?: number; company?: number; impersonated?: boolean; query?: Record<string, string> } = {}) {
  const jwt = await new SignJWT({ user_id: who, ...(o.impersonated ? { impersonated_by: 3 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const qs = new URLSearchParams({ project: String(o.project ?? 1), ...(o.query ?? {}) });
  const r = await w.app.request(`${path}?${qs}`, { method, headers: { Authorization: 'Bearer ' + jwt, 'X-Company-Id': String(o.company ?? 10), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  const text = await r.text(); let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed, text };
}
async function previewOf(w: World, metric: string, o: { week?: string; site?: string; who?: number; project?: number; company?: number } = {}) {
  const r = await call(w, o.who ?? FOUNDER, 'GET', `${BASE}/preview`, undefined,
    { project: o.project, company: o.company, query: { site_url: o.site ?? SITE, week_start: o.week ?? WEEK, metric, search_type: 'web' } });
  assert.equal(r.status, 200, r.text);
  return r.body.preview;
}
async function choice(w: World, metric: string, claim: string, o: { week?: string; site?: string; who?: number; project?: number; company?: number } = {}) {
  const p = await previewOf(w, metric, o);
  assert.equal(p.state, 'selectable', JSON.stringify(p));
  return { site_url: o.site ?? SITE, week_start: o.week ?? WEEK, metric, search_type: 'web', snapshot_hash: p.candidate.snapshot_hash, claim_id: claim };
}
const pinCall = (w: World, body: unknown, who = FOUNDER, o: { project?: number; company?: number; impersonated?: boolean } = {}) => call(w, who, 'POST', `${BASE}/selections`, body, o);
async function pin(w: World, metric = 'clicks', claim = 'claim-clicks', o: { week?: string } = {}) {
  const r = await pinCall(w, await choice(w, metric, claim, o));
  assert.equal(r.status, 201, r.text);
  return r.body.selection;
}
const count = (w: World, table: string) => Number((w.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
const itemOf = (w: World, uid: string) => w.db.prepare('SELECT * FROM raise_evidence_items WHERE uid=?').get(uid) as any;
const share = (w: World, uid: string, visibility: string, extra: Record<string, unknown> = {}) =>
  call(w, FOUNDER, 'PATCH', `/api/cycles/raise/evidence/items/${uid}`, { version: itemOf(w, uid).version, visibility, ...extra });
function audience(w: World) {
  w.db.exec(`INSERT INTO data_room_grants(id,uid,project_id,investor_user_id,granted_by_user_id,status) VALUES(5,'grant-5',1,5,1,'active');
    INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(1,5,'active');`);
}
const scRows = (view: any) => (view.items?.rows ?? []).filter((r: any) => r.kind === 'search-console-aggregate');
const founderCtx = (w: World): any => ({ env: w.env, user: w.db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true });
const adminCtx = (w: World): any => ({ env: w.env, user: w.db.prepare('SELECT * FROM users WHERE id=3').get(), projectId: 1, companyId: 10, founder: false });
function standard() {
  const w = world();
  bind(w, 1, FOUNDER, 10, SITE, 501);
  bind(w, 2, SECOND, 20, OTHER_SITE, 502);
  // Days: Mon 10/100, Tue 20/200, Wed no row (not_returned), Thu 0/0, Fri 5/50, Sat 3/40, Sun 2/10 → 40 clicks, 400 impressions, CTR 0.1.
  const FIG: Array<[number, number] | null> = [[10, 100], [20, 200], null, [0, 0], [5, 50], [3, 40], [2, 10]];
  storeWeek(w, 1, SITE, WEEK, (i) => FIG[i]);
  storeWeek(w, 2, OTHER_SITE, WEEK, () => [777, 7777]);
  return w;
}

test('the migration: one current selection per aggregate, and the chosen aggregate is never edited', () => {
  const w = world();
  const cols = (w.db.prepare('PRAGMA table_info(raise_search_console_selections)').all() as any[]).map(c => c.name);
  for (const c of ['source_ref', 'site_url', 'week_start', 'week_end', 'metric', 'unit', 'value', 'numerator', 'denominator', 'days_reported', 'days_not_returned',
    'revision_key', 'fingerprints', 'snapshot_hash', 'claim_id', 'item_id', 'replaces_id', 'status', 'selected_by', 'closed_token']) assert.ok(cols.includes(c), c);
  const insert = (uid: string, status: string) => w.db.prepare(`INSERT INTO raise_search_console_selections(uid,project_id,source_ref,site_url,week_start,week_end,metric,unit,value,
    days_reported,days_not_returned,revision_key,fingerprints,snapshot_hash,area,status,selected_by) VALUES(?,1,'ref',?,?,?,'clicks','count',40,6,1,'1.1.1.1.1.1.1','f','h','Investor narrative and Pitch deck',?,1)`)
    .run(uid, SITE, WEEK, addDays(WEEK, 6), status);
  insert('a'.repeat(32), 'current');
  assert.throws(() => insert('b'.repeat(32), 'current'), /UNIQUE/);
  insert('c'.repeat(32), 'replaced');
  assert.throws(() => w.db.prepare("UPDATE raise_search_console_selections SET value=41 WHERE uid=?").run('a'.repeat(32)), /never edited/);
  assert.throws(() => w.db.prepare("UPDATE raise_search_console_selections SET revision_key='2.1.1.1.1.1.1' WHERE uid=?").run('a'.repeat(32)), /never edited/);
  w.db.prepare("UPDATE raise_search_console_selections SET status='withdrawn' WHERE uid=?").run('a'.repeat(32)); // the lifecycle columns stay writable
});

test('pin: dark until approved, founders of this venture only, Private, and the same choice twice writes nothing', async () => {
  const w = standard();
  const body = await choice(w, 'clicks', 'claim-clicks');
  w.env.GOOGLE_SEARCH_CONSOLE_APPROVED = '0';
  const dark = await pinCall(w, body);
  assert.equal(dark.status, 503); assert.equal(dark.body.error, 'search_console_unavailable');
  // Mutation checked: drop `approved()` from the founder's read → 200 and this fails.
  assert.equal((await call(w, FOUNDER, 'GET', `${BASE}/selections`)).status, 503);
  w.env.GOOGLE_SEARCH_CONSOLE_APPROVED = '1';
  for (const who of [ADMIN, INVESTOR, MEMBER]) {
    const r = await pinCall(w, body, who);
    assert.equal(r.status, 403, `user ${who}`); assert.doesNotMatch(r.text, /example\.test|"value"/);
  }
  const support = await pinCall(w, body, FOUNDER, { impersonated: true });
  assert.equal(support.body.error, 'support_session_refused');
  // Another venture's founder cannot pin into this venture, nor this founder another venture's claim or property.
  assert.equal((await pinCall(w, body, SECOND, { project: 1, company: 20 })).status, 403);
  assert.equal((await pinCall(w, { ...body, claim_id: 'claim-other' })).body.error, 'not_found');
  // The other venture's founder naming this venture's property in their own venture: not their selected property, never read.
  const theirs = await pinCall(w, { ...body, claim_id: 'claim-other' }, SECOND, { project: 2, company: 20 });
  assert.equal(theirs.status, 409); assert.equal(theirs.body.error, 'not_selected');
  // A hash the founder never saw (a figure that changed, or a guessed one) is refused.
  const unseen = await pinCall(w, { ...body, snapshot_hash: 'd'.repeat(64) });
  // Mutation checked: skip the seen-hash comparison → 201 and this fails.
  assert.deepEqual([unseen.status, unseen.body.error], [409, 'changed']);
  assert.equal((await pinCall(w, { ...body, value_num: 400 })).status, 400, 'no figure is taken from the request');
  assert.equal(count(w, 'raise_search_console_selections'), 0); assert.equal(count(w, 'raise_evidence_items'), 0);

  const r = await pinCall(w, body);
  assert.equal(r.status, 201, r.text);
  const s = r.body.selection;
  assert.equal(r.body.repeated, false); assert.equal(s.status, 'current');
  assert.deepEqual(s.aggregate.window, { from: WEEK, to: '2026-11-15' });
  assert.equal(s.aggregate.value, 40); assert.equal(s.aggregate.unit, 'count'); assert.equal(s.aggregate.site_url, SITE, 'the founder reads their own property');
  assert.deepEqual(s.aggregate.coverage, { days: 7, days_reported: 6, days_not_returned: 1 });
  assert.equal(s.aggregate.revision_key, '1.1.1.1.1.1.1');
  assert.equal(s.source.state, 'current'); assert.equal(s.source.requires_review, false);
  assert.equal(s.claim.uid, 'claim-clicks');
  const item = itemOf(w, s.item.uid);
  // Mutation checked: write visibility 'after_nda' on the pin → this fails.
  assert.equal(item.visibility, 'private'); assert.equal(item.state, 'pinned');
  assert.equal(item.kind, 'search-console-aggregate'); assert.equal(item.source_table, 'raise_search_console_selections');
  assert.equal(item.source_ref, `${s.uid}:clicks`); assert.equal(item.value_num, 40); assert.equal(item.value_unit, 'count'); assert.equal(item.provider, 'google_search_console');
  assert.doesNotMatch(JSON.stringify(item), /example\.test/, 'the item names no URL');
  const link: any = w.db.prepare('SELECT how FROM raise_claim_evidence WHERE item_id=? AND claim_id=1').get(item.id);
  assert.equal(link.how, 'founder');
  // The pin and the evidence source agree: the founder's read says "recorded", not "changed".
  const read = await readRaiseEvidence(founderCtx(w));
  const mine = (read as any).items.rows.find((i: any) => i.uid === s.item.uid);
  // Mutation checked: leave `current_fingerprints` out of the pinned row → the fingerprints differ and this reads `changed`.
  assert.equal(mine.source_state, 'recorded');
  assert.equal(mine.stale, false);

  // A cofounder of the venture (a founder) repeating the same choice for the same claim gets the same selection and writes nothing.
  const before = [count(w, 'raise_search_console_selections'), count(w, 'raise_evidence_items'), count(w, 'fill_provenance'), count(w, 'raise_claim_evidence')];
  const again = await pinCall(w, body, COFOUNDER);
  assert.equal(again.status, 200, again.text); assert.equal(again.body.repeated, true); assert.equal(again.body.selection.uid, s.uid);
  // Mutation checked: drop the existing-selection lookup → the unique index refuses a second row (`already_selected`) and this fails.
  assert.deepEqual([count(w, 'raise_search_console_selections'), count(w, 'raise_evidence_items'), count(w, 'fill_provenance'), count(w, 'raise_claim_evidence')], before);
  const elsewhere = await pinCall(w, { ...body, claim_id: 'claim-clicks-two' });
  assert.deepEqual([elsewhere.status, elsewhere.body.error], [409, 'already_selected']);
  // The other venture's founder pins its own property's week, which this venture never sees.
  const other = await pinCall(w, await choice(w, 'clicks', 'claim-other', { site: OTHER_SITE, who: SECOND, project: 2, company: 20 }), SECOND, { project: 2, company: 20 });
  assert.equal(other.status, 201, other.text); assert.equal(other.body.selection.aggregate.value, 777 * 7);
  const list = await call(w, FOUNDER, 'GET', `${BASE}/selections`);
  assert.deepEqual(list.body.selections.map((x: any) => x.uid), [s.uid]);
});

test('organic search never backs paying customers, revenue, conversions or traction proof; an organic claim is backed', async () => {
  const w = standard();
  for (const [metric, claim] of [['clicks', 'claim-customers'], ['clicks', 'claim-revenue'], ['impressions', 'claim-conversions'], ['ctr', 'claim-traction'], ['clicks', 'claim-ctr']]) {
    const r = await pinCall(w, await choice(w, metric, claim));
    // Mutation checked: drop `searchConsoleMayBack` from `claimOf` → 201 and this fails.
    assert.deepEqual([r.status, r.body.error], [409, 'claim_refused'], `${metric} → ${claim}`);
  }
  assert.equal(count(w, 'raise_evidence_items'), 0);
  const s = await pin(w, 'clicks', 'claim-clicks');
  const item = itemOf(w, s.item.uid);
  // The generic claim link refuses the same claims.
  for (const claim of ['claim-customers', 'claim-revenue', 'claim-traction', 'claim-ctr']) {
    const r = await call(w, FOUNDER, 'POST', `/api/cycles/raise/evidence/claims/${claim}/link`, { item_id: item.uid, item_version: item.version });
    // Mutation checked: drop the `claimMayBack` check in `linkClaim` → 200 and this fails.
    assert.deepEqual([r.status, r.body.error], [409, 'claim_refused'], claim);
  }
  assert.equal((await call(w, FOUNDER, 'POST', '/api/cycles/raise/evidence/claims/claim-clicks-two/link', { item_id: item.uid, item_version: item.version })).status, 200);
  // A link that reached a traction claim by another way still never backs it in the claim check.
  w.db.prepare("INSERT INTO raise_claim_evidence(project_id,claim_id,item_id,how,created_by,mutation_uid) VALUES(1,6,?,'founder',1,'manual-fixture')").run(item.id);
  const check = await checkClaims(w.env, 1);
  const traction = check.claims.find(c => c.claim_kind === 'traction_proof')!;
  // Mutation checked: drop `claimMayBack` from the readiness filter → traction_proof reads `backed` and this fails.
  assert.equal(traction.state, 'not_backed');
  // An organic-search claim the narrative states is backed by the pinned week: 40 stated, 40 measured.
  w.db.exec(`INSERT INTO spinout_deck_overrides(project_id,version,field_key,value) VALUES(1,1,'_version','1'),(1,1,'traction.summary','We saw 40 organic search clicks in one week.')`);
  const after = await checkClaims(w.env, 1);
  const organic = after.claims.find(c => c.claim_kind === 'organic_search_clicks' && c.surface === 'narrative');
  // Mutation checked: drop the `organic_search_clicks` measure → `not_backed` and this fails.
  assert.equal(organic?.state, 'backed', JSON.stringify(after.surfaces));
  assert.ok(!after.claims.some(c => c.claim_kind === 'paying_customers' && c.state === 'backed'));
});

test('sharing is separate: only the aggregate and its context reach the investor; Summary carries no figure; sharing off removes it', async () => {
  const w = standard();
  audience(w);
  const s = await pin(w, 'ctr', 'claim-ctr');
  assert.equal(scRows(await investorEvidence(w.env, 1, INVESTOR)).length, 0, 'Private until the founder shares it');
  const r = await share(w, s.item.uid, 'after_nda');
  assert.equal(r.status, 200, r.text);
  const view: any = await investorEvidence(w.env, 1, INVESTOR);
  const [row] = scRows(view);
  assert.ok(row, JSON.stringify(view.items));
  assert.equal(row.value_num, 0.1); assert.equal(row.value_unit, 'ratio');
  assert.deepEqual(row.search_console.window, { from: WEEK, to: '2026-11-15' });
  assert.equal(row.search_console.metric, 'ctr'); assert.equal(row.search_console.numerator, 40); assert.equal(row.search_console.denominator, 400);
  assert.match(row.search_console.meaning, /not paying customers, revenue or attributed conversions/);
  // Mutation checked: let the property URL into the shared context → this fails.
  assert.doesNotMatch(JSON.stringify(view), NEVER_SHARED);
  assert.deepEqual(view.claims.rows.find((c: any) => c.uid === 'claim-ctr')?.items, [s.item.uid]);
  await share(w, s.item.uid, 'summary');
  const [summary] = scRows(await investorEvidence(w.env, 1, INVESTOR));
  // Mutation checked: keep the figure in a Summary share's context → this fails.
  assert.equal(summary.value_num, null); assert.equal(summary.search_console.value, null); assert.equal(summary.search_console.numerator, null);
  await share(w, s.item.uid, 'private');
  assert.equal(scRows(await investorEvidence(w.env, 1, INVESTOR)).length, 0, 'sharing switched off');
  // Neither the scoring pack, Eadwyn's pack nor an admin's read carries it.
  await share(w, s.item.uid, 'after_nda');
  assert.ok(!(await evidencePack(w.env, 1, { audience: 'scoring' })).items.some((i: any) => i.kind === 'search-console-aggregate'));
  const facts = await packFacts(w.env, 1, 'investor');
  assert.ok(facts, 'the pack reads');
  // Mutation checked: drop the founder-chosen filter from `packFacts` → Eadwyn's pack lists the item and this fails.
  assert.ok(!facts!.items.some((i) => i.uid === s.item.uid));
  const admin: any = await readRaiseEvidence(adminCtx(w));
  // Mutation checked: drop the kind from FOUNDER_CHOSEN_KINDS → the admin read lists the item and this fails.
  assert.ok(!(admin.items.rows ?? []).some((i: any) => i.kind === 'search-console-aggregate'));
});

test('a corrected week reads changed, leaves every shared view, and is re-reviewed as a new Private item beside the original', async () => {
  const w = standard();
  audience(w);
  const s = await pin(w, 'clicks', 'claim-clicks');
  await share(w, s.item.uid, 'after_nda');
  assert.equal(scRows(await investorEvidence(w.env, 1, INVESTOR)).length, 1);
  const noChange = await call(w, FOUNDER, 'POST', `${BASE}/selections/${s.uid}/review`, { snapshot_hash: 'a'.repeat(64) });
  assert.deepEqual([noChange.status, noChange.body.error], [409, 'not_changed']);

  correct(w, 1, SITE, '2026-11-13', 13, 50); // Friday: 5 → 13 clicks
  // Mutation checked: read the pinned revisions as the current ones → the old hash still matches and the investor keeps reading 40.
  assert.equal(scRows(await investorEvidence(w.env, 1, INVESTOR)).length, 0, 'a corrected week leaves every shared view');
  const founderRead: any = await readRaiseEvidence(founderCtx(w));
  assert.equal(founderRead.items.rows.find((i: any) => i.uid === s.item.uid).source_state, 'changed');
  const confirm = await share(w, s.item.uid, 'after_nda', { confirm_current: true });
  // Mutation checked: drop the founder-chosen kind from the `confirm_current` refusal → 200 and the revised figure is shared in place.
  assert.deepEqual([confirm.status, confirm.body.error], [409, 'changed']);

  const listed = (await call(w, FOUNDER, 'GET', `${BASE}/selections`)).body.selections[0];
  assert.equal(listed.source.state, 'corrected'); assert.equal(listed.source.requires_review, true);
  assert.equal(listed.source.original.value, 40); assert.equal(listed.source.revised.value, 48);
  assert.deepEqual(listed.source.corrected_days, ['2026-11-13']);
  assert.equal(listed.aggregate.value, 40, 'the pin keeps its original figure');

  const stale = await call(w, FOUNDER, 'POST', `${BASE}/selections/${s.uid}/review`, { snapshot_hash: (await choice(w, 'clicks', 'claim-clicks')).snapshot_hash.replace(/^./, '0') });
  assert.deepEqual([stale.status, stale.body.error], [409, 'changed']);
  const revisedHash = (await choice(w, 'clicks', 'claim-clicks')).snapshot_hash;
  const refused = await call(w, FOUNDER, 'POST', `${BASE}/selections/${s.uid}/review`, { snapshot_hash: revisedHash, claim_id: 'claim-revenue' });
  assert.deepEqual([refused.status, refused.body.error], [409, 'claim_refused']);
  const rv = await call(w, FOUNDER, 'POST', `${BASE}/selections/${s.uid}/review`, { snapshot_hash: revisedHash });
  assert.equal(rv.status, 201, rv.text);
  const next = rv.body.selection;
  assert.equal(next.replaces, s.uid); assert.equal(next.aggregate.value, 48); assert.equal(next.aggregate.revision_key, '1.1.1.1.2.1.1');
  assert.equal(next.source.state, 'current'); assert.equal(next.claim.uid, 'claim-clicks');
  const oldRow: any = w.db.prepare('SELECT status FROM raise_search_console_selections WHERE uid=?').get(s.uid);
  assert.equal(oldRow.status, 'replaced');
  const oldItem = itemOf(w, s.item.uid), newItem = itemOf(w, next.item.uid);
  assert.deepEqual([oldItem.state, oldItem.visibility], ['unpinned', 'private']);
  // Mutation checked: write the re-reviewed item as 'after_nda' → this fails.
  assert.deepEqual([newItem.state, newItem.visibility], ['pinned', 'private'], 'the founder shares the revised figure again explicitly');
  assert.equal(count(w, 'raise_claim_evidence'), 1);
  assert.equal(scRows(await investorEvidence(w.env, 1, INVESTOR)).length, 0);
  assert.equal((await call(w, FOUNDER, 'POST', `${BASE}/selections/${s.uid}/review`, { snapshot_hash: revisedHash })).body.error, 'decided');
});

test('revoked access, a switched-off connection and an unselected property withdraw what was shared; withdrawal is for good', async () => {
  const w = standard();
  audience(w);
  const crossed = await pinCall(w, await choice(w, 'impressions', 'claim-ctr'));
  assert.deepEqual([crossed.status, crossed.body.error], [409, 'claim_refused'], 'impressions never back a CTR claim');
  w.db.exec("INSERT INTO raise_claims(id,uid,project_id,surface,surface_version,field_key,claim_kind,stated_value) VALUES(9,'claim-impressions',1,'deck','v1','slide:9#organic_search_impressions','organic_search_impressions','400')");
  const sel = await pin(w, 'impressions', 'claim-impressions');
  await share(w, sel.item.uid, 'after_nda');
  const shown = async () => scRows(await investorEvidence(w.env, 1, INVESTOR)).length;
  assert.equal(await shown(), 1);

  w.db.prepare("UPDATE search_console_selections SET access_state='revoked' WHERE project_id=1").run();
  // Mutation checked: drop `v.access_state='ok'` from the source query → the investor keeps reading it and this fails.
  assert.equal(await shown(), 0);
  const mine = (await call(w, FOUNDER, 'GET', `${BASE}/selections`)).body.selections[0];
  assert.equal(mine.source.state, 'revoked'); assert.equal(mine.aggregate.value, 400, 'the founder keeps the pinned figure');
  w.db.prepare("UPDATE search_console_selections SET access_state='ok' WHERE project_id=1").run();
  assert.equal(await shown(), 1);
  w.db.prepare('UPDATE integration_companies SET enabled=0 WHERE integration_id=501').run();
  // Mutation checked: drop `ic.enabled=1` from the source query → this fails.
  assert.equal(await shown(), 0);
  w.db.prepare('UPDATE integration_companies SET enabled=1 WHERE integration_id=501').run();
  w.db.prepare("UPDATE integrations SET status='revoked' WHERE id=501").run();
  assert.equal(await shown(), 0);
  w.db.prepare("UPDATE integrations SET status='active' WHERE id=501").run();
  w.db.prepare('UPDATE search_console_selections SET site_url=? WHERE project_id=1').run(OTHER_SITE);
  assert.equal(await shown(), 0, 'another property selected now');
  w.db.prepare('UPDATE search_console_selections SET site_url=? WHERE project_id=1').run(SITE);
  assert.equal(await shown(), 1);

  // Withdrawal: an investor opening the shared claim afterwards sees nothing of it.
  const wd = await call(w, FOUNDER, 'POST', `${BASE}/selections/${sel.uid}/withdraw`, {});
  assert.equal(wd.status, 200, wd.text);
  assert.equal(wd.body.selection.status, 'withdrawn'); assert.equal(wd.body.selection.source.state, 'withdrawn');
  const after: any = await investorEvidence(w.env, 1, INVESTOR);
  // Mutation checked: leave the item's state and sharing alone in `closeItem` → the item stays pinned and shared and this fails.
  assert.equal(scRows(after).length, 0);
  assert.ok(!(after.claims.rows ?? []).some((c: any) => c.items.includes(sel.item.uid)), 'the claim no longer lists it');
  assert.doesNotMatch(JSON.stringify(after), NEVER_SHARED);
  const item = itemOf(w, sel.item.uid);
  assert.deepEqual([item.state, item.visibility], ['unpinned', 'private']);
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM raise_claim_evidence WHERE item_id=?').get(item.id) as any).n), 0);
  assert.equal((await call(w, FOUNDER, 'POST', `${BASE}/selections/${sel.uid}/withdraw`, {})).body.error, 'decided');
  const reshare = await share(w, sel.item.uid, 'after_nda', { state: 'pinned' });
  assert.equal(reshare.status, 409, 'a withdrawn selection has no current source to share');
  assert.equal((await call(w, ADMIN, 'POST', `${BASE}/selections/${'0'.repeat(32)}/withdraw`, {})).status, 403);
});

test('an old week is stale, an incomplete week cannot be pinned, and the narrative states the organic figures', async () => {
  const w = standard();
  storeWeek(w, 1, SITE, OLD_WEEK, () => [1, 10]);
  w.db.exec("INSERT INTO raise_claims(id,uid,project_id,surface,surface_version,field_key,claim_kind,stated_value) VALUES(10,'claim-old',1,'deck','v1','slide:10#organic_search_clicks','organic_search_clicks','7')");
  const old = await pin(w, 'clicks', 'claim-old', { week: OLD_WEEK });
  assert.equal(old.source.stale, true);
  const read: any = await readRaiseEvidence(founderCtx(w));
  assert.equal(read.items.rows.find((i: any) => i.uid === old.item.uid).stale, true);
  const partial = '2026-11-16';
  for (let i = 0; i < 3; i++) w.db.prepare(`INSERT INTO search_console_daily_totals(project_id,site_url,search_type,data_date,row_state,clicks,impressions,fingerprint) VALUES(1,?,'web',?,'reported',1,1,'p')`).run(SITE, addDays(partial, i));
  const p = await previewOf(w, 'clicks', { week: partial });
  assert.equal(p.state, 'incomplete');
  const r = await pinCall(w, { site_url: SITE, week_start: partial, metric: 'clicks', search_type: 'web', snapshot_hash: 'a'.repeat(64), claim_id: 'claim-clicks' });
  assert.deepEqual([r.status, r.body.error], [409, 'incomplete']);

  const figures = (t: string) => parseStatedFigures('traction', t).map(f => [f.figure, f.value]);
  assert.deepEqual(figures('4,200 organic search clicks and 61,000 organic search impressions a week at a 6.9% organic search CTR'),
    [['organic_search_clicks', 4200], ['organic_search_impressions', 61000], ['organic_search_ctr', 6.9]]);
  assert.deepEqual(figures('4,200 clicks and 1,000 paying customers'), [['paying_customers', 1000]], 'a bare "clicks" is not an organic search claim');
});
