/**
 * D4964 (#4964) — Company settings reads and the matching fields' structure.
 *
 * What is pinned:
 *   - the company detail reads its roster in ONE joined query, whatever the team size: a company of 60 members is
 *     answered with the same number of statements as a company of 2 (the old serializer made one per member);
 *   - membership and the edit capability come from that roster (`viewer_can_edit`), and an email still goes to its
 *     own member only;
 *   - regions are canonical codes: stored codes win; a row with none derives them from its legacy text, lists what no
 *     code covers, and stores them on its first committed save; a PATCH takes only codes from the list;
 *   - revenue is a band from the list, links must be openable (LinkedIn on linkedin.com), the count a whole number,
 *     prose bounded; each check bites only on a value that changes, so a legacy value survives an unrelated save;
 *   - the frontend's lists are the Worker's, code for code.
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_settings_reads_4964.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import companyRoutes from '../src/routes/company.ts';
import { REGION_CODES, REVENUE_CODES, regionCodesOf, regionsOf, checkProfileUrl } from '../src/services/companyProfileVocab.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'test-secret-4964-'.padEnd(40, 'x');
const ADA = 1, BEN = 2, ZED = 3, EVE = 4;
const NORTH = 1, SOUTH = 2;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [ZED]: 'founder', [EVE]: 'admin' };

function fixture(extraMembers = 0) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, n] of [[ADA, 'Ada'], [BEN, 'Ben'], [ZED, 'Zed'], [EVE, 'Eve']] as const) u.run(id, ROLE[id], `${n} Made-up`, `${n.toLowerCase()}@example.test`);
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, international_presence, revenue_range, website, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind', 'UK, United States, Atlantis', '£1m-ish', 'northwind.example'); // legacy values
  c.run(SOUTH, 'co-south', 'Southwind', null, null, null);
  const l = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')");
  l.run('l-1', NORTH, ADA, 'Owner', 1); l.run('l-2', NORTH, BEN, 'Member', 0);
  l.run('l-s', SOUTH, ZED, 'Owner', 1);
  for (let i = 0; i < extraMembers; i += 1) {
    const id = 100 + i;
    u.run(id, 'founder', `Member ${i} Made-up`, `m${i}@example.test`);
    l.run(`l-x${i}`, NORTH, id, 'Member', 0);
  }
  return db;
}

/** A D1 double that counts the statements the request prepared. */
function counted(db: DatabaseSync) {
  const inner = d1Over(db);
  const log: string[] = [];
  return { log, DB: { ...inner, prepare(sql: string) { log.push(sql.replace(/\s+/g, ' ').trim()); return inner.prepare(sql); }, batch: (s: any[]) => inner.batch(s) } };
}

async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] ?? 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono(); app.route('/api', companyRoutes);
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const envOf = (DB: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB }) as any;
const GET = '/api/company/co-north';

// ── one joined roster read ────────────────────────────────────────────────

test('the detail reads its roster in one joined query: 60 members cost what 2 do', async () => {
  const small = counted(fixture(0));
  const big = counted(fixture(58));
  const a = await call(envOf(small.DB), ADA, 'GET', GET);
  const b = await call(envOf(big.DB), ADA, 'GET', GET);
  assert.equal(a.body.members.length, 2);
  assert.equal(b.body.members.length, 60);
  assert.equal(big.log.length, small.log.length, `statements grew with the team: ${small.log.length} → ${big.log.length}`);
  // The old serializer's per-member read (the viewer's own auth lookup is another statement, and is counted above).
  assert.equal(big.log.filter((s) => /SELECT id, name, email FROM users WHERE id = \?/.test(s)).length, 0, 'no per-member user lookup');
  assert.equal(big.log.filter((s) => /JOIN users u ON u\.id = l\.user_id/.test(s)).length, 1, 'one joined roster read');
  // From the company read on (auth's own reads come before it): the company, the route's member gate, the roster.
  const own = big.log.slice(big.log.findIndex((q) => /FROM company_profiles WHERE uid = \?/.test(q)));
  assert.ok(own.length <= 3, `a bounded handful of statements, got ${own.length}: ${own.join(' | ')}`);
});

test('membership and edit capability come from the roster; an email goes to its own member only', async () => {
  const db = fixture(0); const env = envOf(d1Over(db));
  const ada = await call(env, ADA, 'GET', GET);
  assert.deepEqual([ada.body.viewer_is_member, ada.body.viewer_can_edit], [true, true]);
  const ben = await call(env, BEN, 'GET', GET);
  assert.deepEqual([ben.body.viewer_is_member, ben.body.viewer_can_edit], [true, false], 'a Member reads but does not edit');
  assert.deepEqual(ben.body.members.map((m: any) => [m.user_id, 'email' in m]), [[ADA, false], [BEN, true]]);
  assert.ok(!('carry_bps' in ben.body.members.find((m: any) => m.user_id === ADA)), 'carry stays withheld from a non-editor');
  const eve = await call(env, EVE, 'GET', GET);
  assert.deepEqual([eve.body.viewer_is_member, eve.body.viewer_can_edit], [true, true], 'a platform admin, as before');
  assert.equal((await call(env, ZED, 'GET', GET)).status, 404, 'a non-member still reads not-found');
});

// ── regions ───────────────────────────────────────────────────────────────

test('regions: legacy text derives codes, lists what no code covers, and is stored on the first committed save', async () => {
  const db = fixture(0); const env = envOf(d1Over(db));
  const before = await call(env, ADA, 'GET', GET);
  assert.deepEqual(before.body.region_codes, ['north_america', 'uk_ireland']);
  assert.deepEqual(before.body.regions, { source: 'derived', unmapped: ['Atlantis'] });
  assert.equal(before.body.international_presence, 'UK, United States, Atlantis', 'the legacy text is kept as it was');
  // A save that changes something else stores the derived codes, once.
  const saved = await call(env, ADA, 'PATCH', GET, { description: 'Hello', expected_version: before.body.profile_version });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((db.prepare('SELECT region_codes FROM company_profiles WHERE id = ?').get(NORTH) as any).region_codes, '["north_america","uk_ireland"]');
  assert.deepEqual(saved.body.regions, { source: 'stored', unmapped: [] });
  const ev = JSON.parse((db.prepare("SELECT after_json FROM company_membership_events WHERE kind = 'profile_update' ORDER BY id DESC").get() as any).after_json);
  assert.deepEqual(ev.fields, ['description', 'region_codes'], 'the stored codes are named in the audit');
  // Choosing codes stores them, in the list's order, without repeats.
  const chose = await call(env, ADA, 'PATCH', GET, { region_codes: ['oceania', 'europe', 'europe'], expected_version: saved.body.profile_version });
  assert.deepEqual(chose.body.region_codes, ['europe', 'oceania']);
  for (const bad of [['atlantis'], 'europe', [1], { a: 1 }]) {
    const r = await call(env, ADA, 'PATCH', GET, { region_codes: bad });
    assert.deepEqual([r.status, r.body.error], [422, 'region_codes_invalid'], JSON.stringify(bad));
  }
  const cleared = await call(env, ADA, 'PATCH', GET, { region_codes: [], expected_version: chose.body.profile_version });
  assert.deepEqual([cleared.body.region_codes, cleared.body.regions.source], [['north_america', 'uk_ireland'], 'derived'], 'cleared codes fall back to the text, never lost');
});

test('a save that changes nothing stores nothing, derived codes included', async () => {
  const db = fixture(0); const env = envOf(d1Over(db));
  const r = await call(env, ADA, 'PATCH', GET, { description: null, expected_version: 1 });
  assert.equal(r.status, 200);
  assert.equal((db.prepare('SELECT region_codes, profile_version FROM company_profiles WHERE id = ?').get(NORTH) as any).region_codes, null);
});

test('regionCodesOf and regionsOf: aliases fold, case and punctuation do not matter, unknowns are kept', () => {
  assert.deepEqual(regionCodesOf('uk; U.S.A / EMEA,  latam ,'), { codes: ['latin_america', 'uk_ireland', 'europe'], unmapped: ['U.S.A'] });
  assert.deepEqual(regionCodesOf(null), { codes: [], unmapped: [] });
  assert.deepEqual(regionsOf({ region_codes: '["oceania","nope"]', international_presence: 'UK' }), { codes: ['oceania'], source: 'stored', unmapped: [] });
  assert.equal(regionsOf({ region_codes: 'not json', international_presence: '' }).source, 'none');
});

// ── the other matching fields ─────────────────────────────────────────────

test('revenue is a band, links must open, the count is whole, prose is bounded: each refused before any write', async () => {
  const db = fixture(0); const env = envOf(d1Over(db));
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ revenue_range: '£2m' }, 'revenue_range_invalid'],
    [{ website: 'javascript:alert(1)' }, 'website_invalid'],
    [{ website: 'northwind' }, 'website_invalid'],
    [{ linkedin_url: 'https://example.com/northwind' }, 'linkedin_invalid'],
    [{ employee_count: -1 }, 'employee_count_invalid'],
    [{ employee_count: 2.5 }, 'employee_count_invalid'],
    [{ employee_count: 'ten' }, 'employee_count_invalid'],
    [{ current_products: 'x'.repeat(501) }, 'prose_too_long'],
    [{ expansion_goals: 'x'.repeat(501) }, 'prose_too_long'],
  ];
  for (const [body, code] of cases) {
    const r = await call(env, ADA, 'PATCH', GET, body);
    assert.deepEqual([r.status, r.body.error], [422, code], JSON.stringify(body).slice(0, 80));
    assert.equal(typeof r.body.message, 'string');
  }
  assert.equal((db.prepare('SELECT profile_version FROM company_profiles WHERE id = ?').get(NORTH) as any).profile_version, 1, 'nothing was written');
  const ok = await call(env, ADA, 'PATCH', GET, {
    revenue_range: '1m_5m', website: ' https://northwind.example.com ', linkedin_url: 'https://www.linkedin.com/company/northwind',
    employee_count: '12', expected_version: 1,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.revenue_range, ok.body.website, ok.body.employee_count], ['1m_5m', 'https://northwind.example.com', 12]);
});

test('a legacy value is not re-checked on a save that leaves it alone', async () => {
  const db = fixture(0); const env = envOf(d1Over(db));
  // The row holds '£1m-ish' and 'northwind.example', both written before the rules; the form resends them unchanged.
  const r = await call(env, ADA, 'PATCH', GET, { revenue_range: '£1m-ish', website: 'northwind.example', description: 'Kept', expected_version: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.revenue_range, r.body.website, r.body.description], ['£1m-ish', 'northwind.example', 'Kept']);
});

test('checkProfileUrl: http(s) with a dotted host; LinkedIn only on linkedin.com', () => {
  assert.equal(checkProfileUrl('https://a.example'), true);
  assert.equal(checkProfileUrl('ftp://a.example'), false);
  assert.equal(checkProfileUrl('https://localhost'), false);
  assert.equal(checkProfileUrl('https://linkedin.com.evil.example/x', { linkedin: true }), false);
  assert.equal(checkProfileUrl('https://uk.linkedin.com/in/a', { linkedin: true }), true);
});

test('the frontend lists are the Worker lists, code for code', () => {
  const model = readFileSync(resolve(process.cwd(), 'frontend/src/pages/account/companies/generalFormModel.js'), 'utf8');
  const block = (name: string) => model.slice(model.indexOf(`export const ${name} = Object.freeze([`), model.indexOf(']);', model.indexOf(`export const ${name} = Object.freeze([`)));
  const codes = (src: string) => [...src.matchAll(/\['([a-z0-9_]+)', '/g)].map((m) => m[1]);
  assert.deepEqual(codes(block('REGIONS')), [...REGION_CODES]);
  assert.deepEqual(codes(block('REVENUE_RANGES')), [...REVENUE_CODES]);
});
