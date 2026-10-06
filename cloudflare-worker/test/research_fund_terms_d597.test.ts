/**
 * D597 (#1232) — each fund list's publisher and terms (migration 406), cited
 * on every fund, and a list whose terms forbid republishing never served.
 *
 * Real SQLite: migration 406 whole, the fund directory's CREATE from 365, and
 * 376 and 229 for the facet labels. Every list in the repo's migrations is
 * read by running those migrations, never by pattern-matching their text.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_terms_d597.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import { EUR_SOURCE, FUND_SOURCE_VERDICTS, SOURCE_NOT_REVIEWED } from '../src/services/researchFundDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const MIGRATIONS = resolve(here, '../sql/migrations');
const M406 = readFileSync(resolve(MIGRATIONS, '406_research_fund_sources.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 12;
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';
const SHAI = 'Shai Goldman — new VC funds at/below $200M';
const UNREVIEWED = 'A list nobody has reviewed';

function ddl(file: string): string {
  return readFileSync(resolve(MIGRATIONS, file), 'utf8')
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s))
    .map((s) => `${s};`).join('\n');
}

function sources(db = new DatabaseSync(':memory:')) {
  db.exec(M406);
  return db;
}

// ── Migration 406 ────────────────────────────────────────────────────────────

test('406: the verdicts are only the three allowed, in the CHECK and in the Worker', () => {
  const check = M406.match(/verdict\s+TEXT NOT NULL CHECK \(verdict IN \(([^)]*)\)\)/);
  assert.ok(check, 'the verdict CHECK is declared');
  assert.deepEqual(check[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')), [...FUND_SOURCE_VERDICTS]);
  const db = sources();
  const insert = (name: string, verdict: string, terms = 'not found', quote: string | null = null, url: string | null = null) =>
    db.prepare(`INSERT INTO research_fund_sources (source_name, title, terms_status, terms_quote, evidence_url, evidence,
                  verdict, verdict_reason, reviewed_on) VALUES (?, 't', ?, ?, ?, 'e', ?, 'r', '2026-10-06')`)
      .run(name, terms, quote, url, verdict);
  for (const bad of ['cite-only', 'allowed', 'Not allowed', '']) {
    assert.throws(() => insert(`bad ${bad}`, bad), /CHECK constraint failed/, `"${bad}" is refused`);
  }
  for (const ok of FUND_SOURCE_VERDICTS.filter((v) => v !== 'republish allowed')) insert(`ok ${ok}`, ok);
  assert.throws(() => insert('no terms', 'republish allowed'), /CHECK constraint failed/,
    'terms not found is never "republish allowed"');
  insert('quoted', 'republish allowed', 'found', 'You may reuse this list.', 'https://terms.example');
  assert.throws(() => insert('found, unquoted', 'cite only', 'found'), /CHECK constraint failed/,
    'terms "found" carry the quote and where it was read');
  const verdicts = db.prepare('SELECT DISTINCT verdict FROM research_fund_sources').all().map((r: any) => r.verdict);
  assert.ok(verdicts.every((v) => (FUND_SOURCE_VERDICTS as readonly string[]).includes(v)));
});

test('406: every list the migrations load, and the production-only list, has a review with its evidence', () => {
  // Run every migration that writes fund rows, in order, and read the lists back.
  const db = new DatabaseSync(':memory:');
  const loaders = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .filter((f) => /INTO research_fund_directory \(/.test(readFileSync(resolve(MIGRATIONS, f), 'utf8')));
  assert.ok(loaders.length >= 2, `found the fund loaders: ${loaders.join(', ')}`);
  for (const f of loaders) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  sources(db);
  const loaded = db.prepare('SELECT DISTINCT source_name AS n FROM research_fund_directory ORDER BY n').all().map((r: any) => r.n);
  assert.deepEqual(loaded, [DEEP, EUR_SOURCE]);
  const reviewed = new Map(db.prepare('SELECT * FROM research_fund_sources').all().map((r: any) => [r.source_name, r]));
  for (const name of loaded) assert.ok(reviewed.has(name), `${name} has a terms review`);
  // The third list is on production only (S1 on #1081): reviewed by its exact name, and no file in the repo.
  assert.deepEqual([...reviewed.keys()].sort(), [DEEP, EUR_SOURCE, SHAI].sort());
  const shai = reviewed.get(SHAI) as any;
  assert.equal(shai.repo_copy, null);
  assert.match(shai.repo_copy_note, /Not in the repo/);
  for (const r of reviewed.values() as Iterable<any>) {
    assert.match(r.title, /\S/, `${r.source_name}: its title`);
    assert.match(r.publisher, /\S/, `${r.source_name}: its publisher`);
    assert.match(r.published_url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit$/, `${r.source_name}: where it is published`);
    assert.match(r.evidence_url, /^https:\/\//, `${r.source_name}: where the terms were looked for`);
    assert.ok(r.evidence.length > 80, `${r.source_name}: the evidence says what was read`);
    assert.match(r.reviewed_on, /^\d{4}-\d{2}-\d{2}$/);
    // #1232: terms not found → recorded as such, and cite only.
    assert.deepEqual([r.terms_status, r.terms_quote, r.verdict], ['not found', null, 'cite only'], r.source_name);
    if (r.repo_copy) assert.ok(existsSync(resolve(ROOT, r.repo_copy)), `${r.repo_copy} is in the repo`);
  }
});

test('406: re-running it adds nothing and never undoes a later verdict', () => {
  const db = sources();
  db.prepare(`UPDATE research_fund_sources SET verdict = 'not allowed' WHERE source_name = ?`).run(DEEP);
  db.exec(M406);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_fund_sources').get() as any).n, 3);
  assert.equal((db.prepare('SELECT verdict FROM research_fund_sources WHERE source_name = ?').get(DEEP) as any).verdict, 'not allowed');
});

// ── The route ───────────────────────────────────────────────────────────────

type Fund = { uid: string; name: string; source: string; url?: string; hq?: string; focus?: string; size_eur_m?: number };
const FUNDS: Fund[] = [
  { uid: 'eu1', name: 'Alpha Ventures', source: EUR_SOURCE, hq: 'Germany', focus: 'Fintech', size_eur_m: 50 },
  { uid: 'eu2', name: 'Beta Capital', source: EUR_SOURCE, hq: 'France', focus: 'Fintech', size_eur_m: 120 },
  { uid: 'dt1', name: 'Gamma Deep', source: DEEP, hq: 'Germany', focus: 'Fintech' },
  { uid: 'dt2', name: 'Delta Deep', source: DEEP, hq: 'France' },
  { uid: 'sg1', name: 'Alpha Seed', source: SHAI, hq: 'USA', focus: 'Fintech' },
  { uid: 'un1', name: 'Epsilon Unreviewed', source: UNREVIEWED, url: 'https://unreviewed.example/list' },
];

function fixture(takenDown: string[] = [SHAI]) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Ana', 'ana@axal.example')`).run(USER);
  db.exec(ddl('365_research_eurotech_fund_directory.sql'));
  db.exec(readFileSync(resolve(MIGRATIONS, '376_research_taxonomy.sql'), 'utf8'));
  db.exec(ddl('229_research_market_directory.sql'));
  sources(db);
  const ins = db.prepare(`INSERT INTO research_fund_directory (uid, name, hq, sector_focus, fund_size_cents, source_name, source_url, as_of)
                          VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-04')`);
  for (const f of FUNDS) {
    ins.run(f.uid, f.name, f.hq ?? null, f.focus ?? null, f.size_eur_m == null ? null : f.size_eur_m * 100_000_000,
      f.source, f.url ?? `https://github.com/AxalNetwork/StudioOS/blob/main/attached_assets/${f.uid}.csv`);
  }
  db.prepare(`INSERT INTO research_fund_directory_reports (fund_uid, period, fund_size_cents, source_url)
              VALUES ('sg1', '2025', 100, 'https://sheet.example')`).run();
  // A takedown is one UPDATE of the verdict in a later migration (406's header).
  const down = db.prepare(`UPDATE research_fund_sources SET verdict = 'not allowed',
    verdict_reason = 'Its terms forbid republishing.' WHERE source_name = ?`);
  for (const name of takenDown) down.run(name);
  return db;
}

const app = new Hono<any>();
app.route('/api/research', research);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, err?.message === 'Unauthorized' ? 401 : 500));

async function get(db: DatabaseSync, path: string) {
  const token = await new SignJWT({ user_id: USER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/research${path}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

const uids = (body: any) => body.items.map((x: any) => x.uid).sort();

test('the route never returns a row from a "not allowed" list: rows, search, filters, facets, coverage, sources', async () => {
  const db = fixture();
  const all = await get(db, '/fund-directory?limit=100');
  assert.equal(all.status, 200);
  assert.deepEqual(uids(all.body), ['dt1', 'dt2', 'eu1', 'eu2', 'un1']);
  assert.equal(all.body.total, 5);
  assert.equal(all.body.coverage.total, 5, 'coverage counts the served directory only');
  assert.ok(!all.body.sources.some((s: any) => s.name === SHAI), 'the removed list is not among the lists served');
  // A search that matches the removed fund by name, and filters that would select it.
  assert.deepEqual(uids((await get(db, '/fund-directory?q=Alpha')).body), ['eu1']);
  assert.deepEqual(uids((await get(db, '/fund-directory?hq_country=US')).body), []);
  assert.deepEqual(uids((await get(db, '/fund-directory?focus=none&limit=100')).body), ['dt2', 'un1']);
  const facets = all.body.facets;
  assert.ok(!facets.hq_country.some((f: any) => f.value === 'US'), 'no facet counts the removed list');
  const sum = (xs: any[]) => xs.reduce((n, x) => n + x.count, 0);
  assert.equal(sum(facets.hq_country) + all.body.facets_unmapped.hq_country, 5);
  assert.equal(sum(facets.size_band) + facets.size_not_comparable, 5);
  assert.deepEqual(all.body.removed_sources.map((s: any) => [s.name, s.publisher, s.reason, s.funds_withheld]),
    [[SHAI, 'Shai Goldman (@shaig)', 'Its terms forbid republishing.', 1]]);
  assert.match(all.body.removed_sources[0].published_url, /^https:\/\/docs\.google\.com\//);
  // With nothing taken down, the same list is served.
  const open = await get(fixture([]), '/fund-directory?limit=100');
  assert.deepEqual(uids(open.body), ['dt1', 'dt2', 'eu1', 'eu2', 'sg1', 'un1']);
  assert.deepEqual(open.body.removed_sources, []);
  assert.deepEqual(uids((await get(fixture([]), '/fund-directory?hq_country=US')).body), ['sg1'], 'the US filter does select it while served');
});

test('the profile of a fund from a removed list says it was removed and why, and shows none of the fund', async () => {
  const r = await get(fixture(), '/fund-directory/sg1');
  assert.equal(r.status, 410);
  assert.equal(r.body.detail, 'Removed');
  assert.match(r.body.reason, /taken down\. Its terms forbid republishing\./);
  assert.deepEqual([r.body.removed.name, r.body.removed.verdict], [SHAI, 'not allowed']);
  assert.equal(r.body.item, undefined);
  assert.equal(r.body.reports, undefined);
  assert.doesNotMatch(JSON.stringify(r.body), /Alpha Seed|USA/, 'not one field of the fund');
  assert.equal((await get(fixture([]), '/fund-directory/sg1')).status, 200, 'served while its list stands');
  assert.equal((await get(fixture(), '/fund-directory/nope')).status, 404, 'no such fund is still "Not found"');
});

test('every returned row carries its source name and URL, with its publisher and terms verdict', async () => {
  const db = fixture();
  const { body } = await get(db, '/fund-directory?limit=100');
  for (const item of body.items) {
    assert.match(item.source.name, /\S/, `${item.uid}: source name`);
    assert.match(item.source.url, /^https:\/\//, `${item.uid}: source URL`);
    assert.equal(item.source.name, item.source_name);
  }
  const eu = body.items.find((x: any) => x.uid === 'eu1').source;
  assert.deepEqual([eu.title, eu.publisher, eu.verdict, eu.terms_status], ['Euro Tech VC Funds (from 1/2016)', '@Euro_VC', 'cite only', 'not found']);
  assert.match(eu.url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/1cRd/, 'cited at the publisher, not the repo copy');
  assert.equal(body.items.find((x: any) => x.uid === 'dt1').source.publisher, 'Hello Tomorrow');
  const un = body.items.find((x: any) => x.uid === 'un1').source;
  assert.deepEqual([un.verdict, un.publisher, un.reason, un.url], [null, null, SOURCE_NOT_REVIEWED, 'https://unreviewed.example/list'],
    'a list with no review is cited by the row\'s own link and says its terms were not reviewed');
  const sourceRow = body.sources.find((s: any) => s.name === DEEP);
  assert.deepEqual([sourceRow.publisher, sourceRow.verdict, sourceRow.rows], ['Hello Tomorrow', 'cite only', 2]);
  const profile = await get(db, '/fund-directory/eu1');
  assert.equal(profile.status, 200);
  assert.deepEqual([profile.body.item.source.name, profile.body.item.source.verdict], [EUR_SOURCE, 'cite only']);
  assert.match(profile.body.item.source.url, /^https:\/\/docs\.google\.com\//);
});

test('an unreadable terms table fails closed: "Unreadable", never every list served', async () => {
  const db = fixture();
  db.exec('DROP TABLE research_fund_sources');
  const list = await get(db, '/fund-directory');
  assert.deepEqual([list.status, list.body.detail], [503, 'Unreadable']);
  const one = await get(db, '/fund-directory/eu1');
  assert.deepEqual([one.status, one.body.detail], [503, 'Unreadable']);
});
