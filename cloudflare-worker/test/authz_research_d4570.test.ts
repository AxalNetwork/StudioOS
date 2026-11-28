// #4570 slice 10 (S1 of #4554) — the `/api/research` ledger routes, on the real Worker.
//
// Every `unreviewed` route under `/api/research`, asked through the research routers on the fully migrated schema,
// mounted in the Worker's order (market data, markets, sectors, client prep, then research.ts with its collections),
// with the Worker's own table of refusal statuses. Three groups:
//
//   * A member's own records (24 routes): Library documents, saved Ask answers, benchmarks, collections, zone
//     drafts, fund dossiers and their quarterly reports, market readings, brief notes and proposal attachments.
//     Each is read and written only `WHERE ... owner_user_id = <the caller>`, so every other account gets the
//     answer a missing record gets: 404, naming nothing, changing nothing. That includes an admin and the Super
//     Admin (a member's research is theirs alone), and an advisor a document was shared with: a share opens the
//     download (slice 7, D4570-p7), never a write.
//   * The research catalogue (7 routes): companies, funds, markets, sectors, geographies and country statistics.
//     No member owns a row. A signed-in account reads them; Companies follows D7178's licence rule, decided
//     before the record is read.
//   * The Google Sheets OAuth callback: no session; the signed, single-use state names who started Connect, and
//     only a Super Admin's state may land a token.
//
// For every refusal: no credentials and a disabled owner get 401; the body names nothing of the record; no row
// changes (the records, their memberships, the queue, the audit and activity rows); no object is erased and no
// outbound call is made. The last tests run the rightful owner on every route, so each refusal is the gate.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/authz_research_d4570.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import researchMarketData from '../src/routes/research_market_data.ts';
import researchMarkets from '../src/routes/research_markets.ts';
import researchSectors, { sectorSlug } from '../src/routes/research_sectors.ts';
import researchClientPrep from '../src/routes/research_client_prep.ts';
import research from '../src/routes/research.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { makeSheetsState } from '../src/services/fundSheets.ts';
import { SECTORS } from '../src/services/market_intel/aggregator.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'd4570-research-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.
const THIS_TEST = 'cloudflare-worker/test/authz_research_d4570.test.ts';

// The parties.
const OWNER = 2;          // founder of venture 20: the Library, Ask, benchmark, collection, draft and fund dossier
const ADVISOR = 3;        // live grant on venture 20, the owner's document shared to them; owns a brief note
const PARTNER = 4;        // Operating Partner of firm 112: a market reading and its proposal attachment
const OTHER_FOUNDER = 5, INVESTOR = 6, REVOKED_ADVISOR = 7, OTHER_PARTNER = 8, ADMIN = 9, SUPER = 10;
const WHO: Record<number, string> = {
  [OWNER]: 'the owner founder', [ADVISOR]: 'the advisor the document was shared with', [PARTNER]: 'the firm\'s partner',
  [OTHER_FOUNDER]: 'another founder', [INVESTOR]: 'an investor', [REVOKED_ADVISOR]: 'an advisor whose grant was revoked',
  [OTHER_PARTNER]: 'another firm\'s partner', [ADMIN]: 'an admin', [SUPER]: 'the Super Admin',
};
const EVERYONE = [OWNER, ADVISOR, PARTNER, OTHER_FOUNDER, INVESTOR, REVOKED_ADVISOR, OTHER_PARTNER, ADMIN, SUPER];

// Markers a leak check can find. None is a real person, company or fund.
const LEAKS = ['Numbat', 'numbat', 'NUMBAT'];

/** One route on one record, with the account that owns it and a body that owner could send. */
interface Owned { route: string; owner: number; method: string; path: string; body?: unknown; missing: string }
const OWNED: Owned[] = [
  { route: 'POST /api/research/documents/:uid/reindex', owner: OWNER, method: 'POST', path: '/api/research/documents/doc-n/reindex', missing: '/api/research/documents/doc-zz/reindex' },
  { route: 'PATCH /api/research/documents/:uid', owner: OWNER, method: 'PATCH', path: '/api/research/documents/doc-n', body: { title: 'Renamed' }, missing: '/api/research/documents/doc-zz' },
  { route: 'DELETE /api/research/documents/:uid', owner: OWNER, method: 'DELETE', path: '/api/research/documents/doc-n', missing: '/api/research/documents/doc-zz' },
  { route: 'PATCH /api/research/ask/answers/:uid', owner: OWNER, method: 'PATCH', path: '/api/research/ask/answers/ans-n', body: { saved: true }, missing: '/api/research/ask/answers/ans-zz' },
  { route: 'DELETE /api/research/benchmarks/:uid', owner: OWNER, method: 'DELETE', path: '/api/research/benchmarks/bm-n', missing: '/api/research/benchmarks/bm-zz' },
  { route: 'PATCH /api/research/collections/:uid', owner: OWNER, method: 'PATCH', path: '/api/research/collections/col-n', body: { name: 'Renamed' }, missing: '/api/research/collections/col-zz' },
  { route: 'DELETE /api/research/collections/:uid', owner: OWNER, method: 'DELETE', path: '/api/research/collections/col-n', missing: '/api/research/collections/col-zz' },
  { route: 'POST /api/research/collections/:uid/documents', owner: OWNER, method: 'POST', path: '/api/research/collections/col-n/documents', body: { document_uid: 'doc-n2' }, missing: '/api/research/collections/col-zz/documents' },
  { route: 'DELETE /api/research/collections/:uid/documents/:documentUid', owner: OWNER, method: 'DELETE', path: '/api/research/collections/col-n/documents/doc-n', missing: '/api/research/collections/col-zz/documents/doc-n' },
  { route: 'PATCH /api/research/drafts/:uid', owner: OWNER, method: 'PATCH', path: '/api/research/drafts/dr-n', body: { body: 'Accepted text' }, missing: '/api/research/drafts/dr-zz' },
  { route: 'DELETE /api/research/drafts/:uid', owner: OWNER, method: 'DELETE', path: '/api/research/drafts/dr-n', missing: '/api/research/drafts/dr-zz' },
  { route: 'PATCH /api/research/funds/:uid', owner: OWNER, method: 'PATCH', path: '/api/research/funds/fund-n', body: { note: 'Changed' }, missing: '/api/research/funds/fund-zz' },
  { route: 'DELETE /api/research/funds/:uid', owner: OWNER, method: 'DELETE', path: '/api/research/funds/fund-n', missing: '/api/research/funds/fund-zz' },
  { route: 'GET /api/research/funds/:uid/reports', owner: OWNER, method: 'GET', path: '/api/research/funds/fund-n/reports', missing: '/api/research/funds/fund-zz/reports' },
  { route: 'POST /api/research/funds/:uid/reports', owner: OWNER, method: 'POST', path: '/api/research/funds/fund-n/reports', body: { period: '2026-Q3', nav_cents: 100, source_url: 'https://example.test/q3.pdf' }, missing: '/api/research/funds/fund-zz/reports' },
  { route: 'DELETE /api/research/funds/:uid/reports/:reportUid', owner: OWNER, method: 'DELETE', path: '/api/research/funds/fund-n/reports/rep-n', missing: '/api/research/funds/fund-n/reports/rep-zz' },
  { route: 'GET /api/research/market-readings/:uid', owner: PARTNER, method: 'GET', path: '/api/research/market-readings/mr-n', missing: '/api/research/market-readings/mr-zz' },
  { route: 'DELETE /api/research/market-readings/:uid', owner: PARTNER, method: 'DELETE', path: '/api/research/market-readings/mr-n', missing: '/api/research/market-readings/mr-zz' },
  { route: 'PATCH /api/research/brief-notes/:uid', owner: ADVISOR, method: 'PATCH', path: '/api/research/brief-notes/bn-n', body: { open: false }, missing: '/api/research/brief-notes/bn-zz' },
  { route: 'DELETE /api/research/brief-notes/:uid', owner: ADVISOR, method: 'DELETE', path: '/api/research/brief-notes/bn-n', missing: '/api/research/brief-notes/bn-zz' },
  { route: 'DELETE /api/research/attachments/:uid', owner: PARTNER, method: 'DELETE', path: '/api/research/attachments/att-n', missing: '/api/research/attachments/att-zz' },
];

/** The catalogue: no member owns a row. Each with a record the fixture holds. */
const CATALOGUE: { route: string; path: string; companies?: true }[] = [
  { route: 'GET /api/research/company-directory/:uid', path: '/api/research/company-directory/co-numbat', companies: true },
  { route: 'GET /api/research/fund-directory/:uid', path: '/api/research/fund-directory/fd-numbat' },
  { route: 'GET /api/research/market-directory/:slug', path: '/api/research/market-directory/numbat-tech' },
  { route: 'GET /api/research/markets/:slug', path: '/api/research/markets/numbat-tech' },
  { route: 'GET /api/research/geographies/:code', path: '/api/research/geographies/NB' },
  { route: 'GET /api/research/market-data/countries/:code', path: '/api/research/market-data/countries/NBT' },
  { route: 'GET /api/research/sectors/:slug', path: `/api/research/sectors/${sectorSlug(SECTORS[0])}` },
];
const CALLBACK = 'GET /api/research/funds/sheet/callback';

const pending: Promise<unknown>[] = [];
const ctx: any = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
// The Worker's mounts at /api/research, in its order (index.ts and routes/_registry.ts).
const app = new Hono<any>()
  .route('/api/research', researchMarketData)
  .route('/api/research', researchMarkets)
  .route('/api/research', researchSectors)
  .route('/api/research', researchClientPrep)
  .route('/api/research', research);
// As app.onError: a mapped refusal answers its own status; anything else is a 500, never a pass.
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const mapped = AUTH_ERROR_STATUSES[String(err?.message ?? '')];
  return mapped ? c.json({ detail: err.message }, mapped) : c.json({ detail: 'Internal server error', why: String(err?.message) }, 500);
});
let realFetch: typeof fetch;
const outbound: string[] = [];
const sessions: Record<number, string> = {};
const jwt = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));

/** A fresh, seeded Worker: every person and record is synthetic. */
function fixture() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users (id, uid, name, email, role, founder_id, partner_id, is_active) VALUES
    (${OWNER},'u-own','Owner Founder','owner@example.test','founder',102,NULL,1),
    (${ADVISOR},'u-adv','Shared Advisor','advisor@example.test','advisor',NULL,NULL,1),
    (${PARTNER},'u-ptr','Firm Partner','partner@example.test','partner',NULL,112,1),
    (${OTHER_FOUNDER},'u-of','Other Founder','of@example.test','founder',103,NULL,1),
    (${INVESTOR},'u-inv','Some Investor','inv@example.test','investor',NULL,NULL,1),
    (${REVOKED_ADVISOR},'u-ra','Revoked Advisor','ra@example.test','advisor',NULL,NULL,1),
    (${OTHER_PARTNER},'u-op','Other Partner','op@example.test','partner',NULL,116,1),
    (${ADMIN},'u-adm','Admin','admin@example.test','admin',NULL,NULL,1),
    (${SUPER},'u-sup','Super Admin','super@example.test','admin',NULL,NULL,1);
  INSERT INTO super_admins (user_id) VALUES (${SUPER});
  INSERT INTO projects (id, uid, name, founder_id) VALUES (20,'p-numbat','Numbat venture',102), (30,'p-else','Elsewhere venture',103);
  INSERT INTO advisor_client_grants (id, uid, project_id, advisor_user_id, granted_by_user_id, scope_project, status) VALUES
    (41,'g-live',20,${ADVISOR},${OWNER},1,'active'), (42,'g-revoked',20,${REVOKED_ADVISOR},${OWNER},1,'revoked');

  INSERT INTO research_documents (id, uid, owner_user_id, title, kind, r2_key, content_type, size_bytes, index_state, chunk_count) VALUES
    (51,'doc-n',${OWNER},'Numbat pricing memo','document','research/${OWNER}/doc-n.pdf','application/pdf',10,'ready',0),
    (52,'doc-n2',${OWNER},'Numbat second memo','document','research/${OWNER}/doc-n2.pdf','application/pdf',10,'ready',0),
    (53,'doc-of',${OTHER_FOUNDER},'Elsewhere memo','document','research/${OTHER_FOUNDER}/doc-of.pdf','application/pdf',10,'ready',0);
  INSERT INTO advisor_client_document_shares (uid, document_id, advisor_user_id, shared_by_user_id, status) VALUES
    ('sh-live',51,${ADVISOR},${OWNER},'active'), ('sh-revoked',51,${REVOKED_ADVISOR},${OWNER},'active');
  INSERT INTO research_ask_sessions (id, uid, owner_user_id) VALUES (61,'ses-n',${OWNER});
  INSERT INTO research_ask_answers (id, uid, session_id, owner_user_id, question, answer, reason, saved) VALUES
    (62,'ans-n',61,${OWNER},'Numbat question','Numbat answer','answered',0);
  INSERT INTO research_benchmarks (id, uid, owner_user_id, metric, our_value, peer_value, peer_source, peer_sample_size, peer_as_of) VALUES
    (71,'bm-n',${OWNER},'Numbat churn','4%','6%','Numbat survey',12,'2026-10-01');
  INSERT INTO research_benchmark_constituents (uid, benchmark_id, owner_user_id, name, value) VALUES ('bmc-n',71,${OWNER},'Numbat peer','5%');
  INSERT INTO research_collections (id, uid, owner_user_id, name, created_by) VALUES
    (81,'col-n',${OWNER},'Numbat shelf',${OWNER}), (82,'col-of',${OTHER_FOUNDER},'Elsewhere shelf',${OTHER_FOUNDER}),
    (83,'col-adv',${ADVISOR},'Advisor shelf',${ADVISOR});
  INSERT INTO research_collection_documents (collection_id, document_id, created_by) VALUES (81,51,${OWNER}), (82,53,${OTHER_FOUNDER});
  INSERT INTO research_zone_drafts (id, uid, owner_user_id, surface, scope_key, body) VALUES (91,'dr-n',${OWNER},'research/funds','fund-n','Numbat drafted brief');
  INSERT INTO research_funds (id, uid, owner_user_id, name, note, created_at, updated_at) VALUES
    (101,'fund-n',${OWNER},'Numbat Capital I','Numbat partner passed','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z'),
    (102,'fund-of',${OTHER_FOUNDER},'Elsewhere Fund','theirs','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
  INSERT INTO research_fund_reports (uid, fund_uid, owner_user_id, period, nav_cents, source_url, notes) VALUES
    ('rep-n','fund-n',${OWNER},'2026-Q2',4242,'https://example.test/numbat-q2.pdf','Numbat letter');
  INSERT INTO research_market_readings (id, uid, owner_user_id, metric, range_low_cents, range_high_cents, comparable_count, ran_at, scope) VALUES
    (111,'mr-n',${PARTNER},'Numbat retainer',100000,200000,4,'2026-11-01','Numbat scope');
  INSERT INTO research_brief_notes (uid, owner_user_id, project_id, section, body, open) VALUES ('bn-n',${ADVISOR},20,'Numbat section','Numbat note body',1);
  INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables) VALUES (121,'q-n',1,112,5000,'Numbat deliverables');
  INSERT INTO research_attachments (uid, owner_user_id, kind, ref_key, quote_id) VALUES ('att-n',${PARTNER},'reading','mr-n',121);

  INSERT INTO research_company_directory (uid, name, website, country, sector, source_url, as_of) VALUES
    ('co-numbat','Numbat Robotics','https://numbat.example','Numbatland','robotics','https://www.wikidata.org/wiki/Q1','2026-10-04');
  INSERT INTO research_fund_directory (uid, name, source_name, source_url, as_of) VALUES ('fd-numbat','Numbat Ventures Fund','Numbat list','https://example.test/list','2026-10-01');
  INSERT INTO research_market_directory (slug, name, company_count, source_name, source_boundary, as_of) VALUES
    ('numbat-tech','Numbat tech',3,'Axal','Discovery counts only','2026-10-01');
  INSERT INTO research_countries (code, name, region) VALUES ('NB','Numbatland','Oceania');
  INSERT INTO research_market_sources (id, name, source_url, dataset_or_edition, refresh_policy) VALUES (131,'Numbat statistics','https://example.test/stats','2026','manual');
  INSERT INTO research_market_observations (source_id, metric_key, metric_label, geography_type, geography_code, period, value, unit, observation_status, retrieved_at, source_observation_key, vintage)
    VALUES (131,'gdp','Numbat GDP','country','NBT','2025',1.5,'usd_bn','actual','2026-10-01','nbt-gdp-2025','2026-10');`);
  const objects = new Map<string, string>([['research/2/doc-n.pdf', 'bytes'], ['research/2/doc-n2.pdf', 'bytes']]);
  const erased: string[] = [];
  const FILES = {
    async put(key: string, body: unknown) { objects.set(key, String(body)); return {}; },
    async get(key: string) { return objects.has(key) ? { body: objects.get(key), text: async () => objects.get(key), httpMetadata: {}, customMetadata: {} } : null; },
    async head(key: string) { return objects.has(key) ? { key, size: 5, httpMetadata: {}, customMetadata: {} } : null; },
    async delete(key: string | string[]) { for (const k of [key].flat()) { erased.push(k); objects.delete(k); } },
    async list() { return { objects: [], truncated: false }; },
  };
  const env: any = {
    DB: d1Over(db), FILES, JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(),
    APP_URL: 'https://unit.test', PUBLIC_BASE_URL: 'https://unit.test',
    // A fixture OAuth client, so the callback reaches its gate; every Google call goes to the fake fetch.
    GOOGLE_SHEETS_CLIENT_ID: 'fixture-client', GOOGLE_SHEETS_CLIENT_SECRET: 'fixture-secret',
  };
  async function call(who: number | null, method: string, path: string, body?: unknown) {
    const read = method === 'GET' || method === 'DELETE';
    const res = await app.fetch(new Request(`https://unit.test${path}`, {
      method, redirect: 'manual',
      headers: { ...(who ? { authorization: `Bearer ${sessions[who]}` } : {}), ...(read ? {} : { 'content-type': 'application/json' }) },
      body: read ? undefined : JSON.stringify(body ?? {}),
    // A fresh limiter per request: this suite is about gates, and the limiter would otherwise answer 429 first.
    }), { ...env, RATE_LIMITS: memKV() }, ctx);
    await Promise.all(pending.splice(0));
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, json, location: res.headers.get('location') };
  }
  const TABLES = ['research_documents', 'advisor_client_document_shares', 'research_ask_answers', 'research_benchmarks',
    'research_benchmark_constituents', 'research_collections', 'research_collection_documents', 'research_zone_drafts',
    'research_funds', 'research_fund_reports', 'research_market_readings', 'research_brief_notes', 'research_attachments',
    'advisor_client_access_log', 'queue_jobs', 'google_sheets_oauth_tokens', 'oauth_state_tokens'];
  /** Everything a refused route could have changed. */
  const snapshot = () => JSON.stringify([
    ...TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()),
    db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get(),
    // The app-wide request log writes its own `http_*` row for every request, refused or not: not the route's write.
    db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action NOT LIKE 'http\\_%' ESCAPE '\\'").get(),
    [...objects.keys()].sort(),
  ]);
  return { db, env, call, snapshot, erased };
}

const named = (r: { text: string; location?: string | null }) => LEAKS.filter((l) => r.text.includes(l) || (r.location ?? '').includes(l));

before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    outbound.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', scope: 'sheets' });
    if (u.includes('googleapis.com/oauth2')) return Response.json({ email: 'super@example.test', id: '42' });
    return Response.json({ error: 'not a fixture path' }, { status: 404 });
  }) as typeof fetch;
  for (const id of EVERYONE) sessions[id] = await jwt({ user_id: id });
});
after(() => { if (realFetch) globalThis.fetch = realFetch; removeMigratedDatabases(); });

test('#4570 slice 10: the suite covers every /api/research route the ledger left unreviewed, and each is verified by it', () => {
  const ledger = JSON.parse(readFileSync(new URL('../../scripts/baselines/auth-inventory/%252Fapi%252Fresearch.json', import.meta.url), 'utf8'));
  const mine = Object.entries<any>(ledger).filter(([, e]) => e.test === THIS_TEST).map(([k]) => k).sort();
  const covered = [...OWNED.map((o) => o.route), ...CATALOGUE.map((c) => c.route), CALLBACK].sort();
  assert.deepEqual(mine, covered);
  for (const key of covered) assert.equal(ledger[key].state, 'verified', key);
  assert.deepEqual(Object.entries<any>(ledger).filter(([, e]) => e.state === 'unreviewed').map(([k]) => k), [],
    'no /api/research route is left unreviewed');
});

test('#4570 slice 10: a member\'s research record answers every other account as a missing one, names nothing and changes nothing', async () => {
  const f = fixture();
  const before = f.snapshot();
  for (const o of OWNED) {
    for (const who of EVERYONE.filter((w) => w !== o.owner)) {
      const r = await f.call(who, o.method, o.path, o.body);
      const gone = await f.call(who, o.method, o.missing, o.body);
      assert.equal(r.status, 404, `${o.route}: ${WHO[who]} got ${r.status} ${r.text.slice(0, 120)}`);
      assert.deepEqual([r.status, r.text], [gone.status, gone.text], `${o.route}: ${WHO[who]} can tell the record exists`);
      assert.deepEqual(named(r), [], `${o.route}: ${WHO[who]}'s refusal names the record`);
      assert.equal(f.snapshot(), before, `${o.route}: ${WHO[who]}'s refusal changed a row`);
    }
  }
  assert.deepEqual(f.erased, [], 'a refusal erased a stored object');
  assert.deepEqual(outbound.splice(0), [], 'a refusal made an outbound call');
});

test('#4570 slice 10: no credentials, and an owner whose account is disabled, get 401 on every route', async () => {
  const f = fixture();
  const before = f.snapshot();
  for (const o of OWNED) {
    assert.equal((await f.call(null, o.method, o.path, o.body)).status, 401, `${o.route}: no credentials`);
    f.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(o.owner);
    const r = await f.call(o.owner, o.method, o.path, o.body);
    f.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(o.owner);
    assert.equal(r.status, 401, `${o.route}: the disabled owner got ${r.status}`);
    assert.deepEqual(named(r), []);
  }
  for (const c of CATALOGUE) {
    assert.equal((await f.call(null, 'GET', c.path)).status, 401, `${c.route}: no credentials`);
    f.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(OWNER);
    const r = await f.call(OWNER, 'GET', c.path);
    f.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(OWNER);
    assert.equal(r.status, 401, `${c.route}: a disabled account got ${r.status}`);
    assert.deepEqual(named(r), [], `${c.route}: a 401 names the record`);
  }
  assert.equal(f.snapshot(), before);
  assert.deepEqual(outbound.splice(0), []);
});

test('#4570 slice 10: a record of another member cannot be reached through one\'s own', async () => {
  const f = fixture();
  const before = f.snapshot();
  // Another founder's own collection, naming the owner's document: the document is not theirs.
  let r = await f.call(OTHER_FOUNDER, 'POST', '/api/research/collections/col-of/documents', { document_uid: 'doc-n' });
  assert.equal(r.status, 404);
  // The advisor the document was shared with may read it (slice 7), never file it: their own collection refuses it.
  r = await f.call(ADVISOR, 'POST', '/api/research/collections/col-adv/documents', { document_uid: 'doc-n' });
  assert.equal(r.status, 404);
  // Removing the owner's document from one's own collection, or another's report under one's own fund.
  r = await f.call(OTHER_FOUNDER, 'DELETE', '/api/research/collections/col-of/documents/doc-n');
  assert.equal(r.status, 404);
  // A stale revision on another member's fund is still the missing record's 404, never the stored row to compare.
  r = await f.call(OTHER_FOUNDER, 'PATCH', '/api/research/funds/fund-n', { note: 'Changed', expected_updated_at: 'stale' });
  assert.equal(r.status, 404);
  assert.deepEqual(named(r), []);
  r = await f.call(OTHER_FOUNDER, 'DELETE', '/api/research/funds/fund-of/reports/rep-n');
  assert.equal(r.status, 404);
  // The owner's own report named under another member's fund is not theirs either.
  r = await f.call(OWNER, 'DELETE', '/api/research/funds/fund-of/reports/rep-n');
  assert.equal(r.status, 404);
  assert.equal(f.snapshot(), before);
});

test('#4570 slice 10: the catalogue is read by every signed-in account; Companies by D7178\'s rule, decided before the read', async () => {
  const f = fixture();
  const before = f.snapshot();
  for (const c of CATALOGUE) {
    for (const who of EVERYONE) {
      const r = await f.call(who, 'GET', c.path);
      const refusedCompanies = c.companies && (who === INVESTOR || who === PARTNER || who === OTHER_PARTNER);
      if (refusedCompanies) {
        const gone = await f.call(who, 'GET', '/api/research/company-directory/co-missing');
        assert.equal(r.status, 403, `${c.route}: ${WHO[who]} got ${r.status}`);
        assert.equal(r.json?.error, 'companies_licence_required');
        assert.deepEqual([r.status, r.text], [gone.status, gone.text], `${c.route}: ${WHO[who]} can tell the company exists`);
        assert.deepEqual(named(r), []);
      } else {
        assert.equal(r.status, 200, `${c.route}: ${WHO[who]} got ${r.status} ${r.text.slice(0, 160)}`);
      }
    }
  }
  assert.equal(f.snapshot(), before, 'a catalogue read changed a row');
});

test('#4570 slice 10: the Sheets callback lands a token only for a Super Admin\'s own unspent, signed state', async () => {
  const f = fixture();
  const cb = (state: string | null) => `/api/research/funds/sheet/callback?code=fixture-code${state === null ? '' : `&state=${encodeURIComponent(state)}`}`;
  const tokens = () => f.db.prepare('SELECT user_id FROM google_sheets_oauth_tokens ORDER BY user_id').all().map((x: any) => x.user_id);
  const superState = await makeSheetsState(f.env, SUPER);
  const [nonce] = superState.split('.');
  const refused: [string, string | null, number | null][] = [
    ['no state', null, null],
    ['an unsigned nonce', nonce, null],
    ['a forged signature', `${nonce}.${'A'.repeat(43)}`, null],
    ['a signed nonce never issued', await makeSheetsState({ ...f.env, DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } } as any, SUPER), null],
    ['an admin who is not the Super Admin', await makeSheetsState(f.env, ADMIN), null],
    ['a founder', await makeSheetsState(f.env, OWNER), null],
  ];
  const expired = await makeSheetsState(f.env, SUPER);
  f.db.prepare("UPDATE oauth_state_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE state = ?").run(expired.split('.')[0]);
  refused.push(['an expired state', expired, null]);
  for (const [why, state] of refused) {
    for (const who of [null, SUPER]) {
      const r = await f.call(who, 'GET', cb(state));
      assert.equal(r.status, 302, why);
      assert.match(String(r.location), /\?sheets=error&reason=/, `${why}: ${r.location}`);
      assert.deepEqual(tokens(), [], `${why}: a token landed`);
      assert.deepEqual(outbound.splice(0), [], `${why}: the code was exchanged`);
    }
  }
  // The rightful state lands one token, on the Super Admin, whoever's browser carries it back; it is spent.
  const ok = await f.call(null, 'GET', cb(superState));
  assert.match(String(ok.location), /\?sheets=connected$/);
  assert.deepEqual(tokens(), [SUPER]);
  assert.ok(outbound.splice(0).some((u) => u.includes('oauth2.googleapis.com/token')), 'the rightful code is exchanged');
  const again = await f.call(null, 'GET', cb(superState));
  assert.match(String(again.location), /reason=invalid_state/, 'a state is spent on first use');
  assert.deepEqual(outbound.splice(0), []);
});

test('#4570 slice 10: the owner passes every gate, so each refusal above is the gate', async () => {
  for (const o of OWNED) {
    const f = fixture();
    const before = f.snapshot();
    const r = await f.call(o.owner, o.method, o.path, o.body);
    assert.ok(r.status >= 200 && r.status < 300, `${o.route}: the owner got ${r.status} ${r.text.slice(0, 160)}`);
    if (o.method === 'GET') assert.notDeepEqual(named(r), [], `${o.route}: the owner's read is empty`);
    else assert.notEqual(f.snapshot(), before, `${o.route}: the owner's write changed nothing`);
    if (o.route === 'DELETE /api/research/documents/:uid') assert.ok(f.erased.includes('research/2/doc-n.pdf'), 'the owner\'s delete erases the stored object');
  }
  outbound.length = 0;
});
