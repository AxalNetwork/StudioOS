/**
 * D5454 part 3 (#5454, R4) — four readers whose audience is already staff, the venture's owner or an investor on the
 * deal now apply the preparation guard. Real `node:sqlite`, the full baseline schema and the D5454 migration, through
 * the real route handlers and service functions. Every venture, person, deal and amount is invented.
 *
 *   - `routes/calendar.ts` `GET /deals` (the IC meeting deal picker);
 *   - `routes/private-data.ts` `GET /portfolio/metrics` (a partner's own deals, the admin totals);
 *   - `services/eadwynReaders.ts` (the HubSpot and Salesforce AI context lines);
 *   - `services/scoreAccess.ts` (`mayReadProjectDeal`, `counterpartiesOf`).
 *
 * What it proves:
 *   - a private preparation (a mixed-version row written past CHECK `dp_private_owns_no_deal`) and a deal with unknown
 *     preparation metadata reach none of the four, for an admin too;
 *   - a withdrawn or archived release stays for staff, the venture's company and an investor already on the deal, and
 *     is dropped for a non-staff reader of a list (`private-data`'s discovery mode);
 *   - legacy, unreleased `legacy_attach` and published deals are unchanged;
 *   - a database without the preparation table hides nothing (the guard's own rule), and a preparation table that
 *     cannot be read fails each reader closed: a 500, a rejected read, never an unfiltered list.
 *
 * MUTATION CHECKS (each was run; each turns at least one test here red):
 *   M1  calendar: drop `AND d.id NOT IN (… json_each(?))` from the picker      → picker tests fail
 *   M2  calendar: `discovery` in place of `transactional`                      → staff and investor lose the withdrawn deal
 *   M3  private-data: drop the guard from the admin totals                     → totals test fails
 *   M4  private-data: `transactional` for every reader                         → the non-staff partner_id list fails
 *   M5  eadwyn: drop the guard from the CRM query                              → context lines test fails
 *   M6  eadwyn: catch a guard failure and read unfiltered                      → unreadable test fails
 *   M7  scoreAccess: drop the guard from `mayReadProjectDeal`                  → project access test fails
 *   M8  scoreAccess: drop the guard from `counterpartiesOf`'s open deals       → counterparty test fails
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_preparation_relationship_readers_5454.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import privateData from '../src/routes/private-data.ts';
import { CONNECTOR_READERS } from '../src/services/eadwynReaders.ts';
import { counterpartiesOf, mayReadProjectDeal } from '../src/services/scoreAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const D5454 = read('cloudflare-worker/sql/migrations/202611150148_5454_deal_preparations.sql');
const CONNECTOR_COMPANIES = read('cloudflare-worker/sql/migrations/435_connector_companies.sql');
const SECRET = 'synthetic-5454-readers-'.repeat(3);

/** Deals by what their preparation metadata makes them. PRIVATE_ROW sits on a second venture. */
const LEGACY = 1, PUBLISHED = 2, WITHDRAWN = 3, ARCHIVED = 4, ATTACHED = 5, CORRUPT = 6, PRIVATE_ROW = 7;
const ALL = [LEGACY, PUBLISHED, WITHDRAWN, ARCHIVED, ATTACHED, CORRUPT, PRIVATE_ROW];
/** What staff, the venture and an investor on the deal may see: everything but private and unknown. */
const TRANSACTIONAL = [LEGACY, PUBLISHED, WITHDRAWN, ARCHIVED, ATTACHED];
/** What a list shows anyone else: also without the withdrawn and archived releases. */
const DISCOVERY = [LEGACY, PUBLISHED, ATTACHED];
const amountOf = (id: number) => id * 1000 + 7;

/** 1 admin · 2 partner (partner record 50) · 3 investor on WITHDRAWN and PRIVATE_ROW · 4 investor linked to partner
 *  record 50 (not staff) · 5 founder of venture 10 · 6 member of company 70, owner of the CRM connection · 7 founder
 *  of venture 20. */
function baseDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  db.exec(CONNECTOR_COMPANIES);
  db.exec(`
    INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Harbor Ledger Inc');
    INSERT INTO partners (id, name, email) VALUES (50, 'Fixture Partner', 'partner-50@example.test');
    INSERT INTO users (id, uid, email, name, role, founder_id, partner_id) VALUES
      (1, 'u1', 'member-1@example.test', 'Fixture Admin', 'admin', NULL, NULL),
      (2, 'u2', 'member-2@example.test', 'Fixture Partner', 'partner', NULL, 50),
      (3, 'u3', 'member-3@example.test', 'Fixture Investor', 'investor', NULL, NULL),
      (4, 'u4', 'member-4@example.test', 'Fixture Linked Investor', 'investor', NULL, 50),
      (5, 'u5', 'member-5@example.test', 'Fixture Founder', 'founder', 105, NULL),
      (6, 'u6', 'member-6@example.test', 'Fixture Member', 'founder', NULL, NULL),
      (7, 'u7', 'member-7@example.test', 'Fixture Second Founder', 'founder', 107, NULL);
    UPDATE users SET investor_tier = 'professional' WHERE role = 'investor';
    INSERT INTO projects (id, name, company_id, founder_id, sector) VALUES
      (10, 'Harbor Ledger', 70, 105, 'fintech'), (20, 'Quill Works', 70, 107, 'fintech');
    INSERT INTO deals (id, uid, project_id, partner_id, status, amount, hubspot_deal_id, sf_opportunity_id) VALUES
      (${LEGACY}, 'g1', 10, 50, 'active', ${amountOf(LEGACY)}, 'hs-1', 'sf-1'),
      (${PUBLISHED}, 'g2', 10, 50, 'active', ${amountOf(PUBLISHED)}, 'hs-2', 'sf-2'),
      (${WITHDRAWN}, 'g3', 10, 50, 'active', ${amountOf(WITHDRAWN)}, 'hs-3', 'sf-3'),
      (${ARCHIVED}, 'g4', 10, 50, 'funded', ${amountOf(ARCHIVED)}, 'hs-4', 'sf-4'),
      (${ATTACHED}, 'g5', 10, 50, 'scored', ${amountOf(ATTACHED)}, 'hs-5', 'sf-5'),
      (${CORRUPT}, 'g6', 10, 50, 'active', ${amountOf(CORRUPT)}, 'hs-6', 'sf-6'),
      (${PRIVATE_ROW}, 'g7', 20, 50, 'applied', ${amountOf(PRIVATE_ROW)}, 'hs-7', 'sf-7');
    INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (${WITHDRAWN}, 3), (${PRIVATE_ROW}, 3);
    INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('ucl-6', 70, 6);
    INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, last_synced_at) VALUES
      (1, 'int-1', 6, 'hubspot', 'active', 'oauth2', '2026-11-20 09:00:00'),
      (2, 'int-2', 6, 'salesforce', 'active', 'oauth2', '2026-11-20 09:00:00');
    INSERT OR IGNORE INTO integration_companies (integration_id, company_id, enabled) VALUES (1, 70, 1), (2, 70, 1);
  `);
  return db;
}

function withPreparations(db: DatabaseSync): DatabaseSync {
  db.exec(D5454);
  db.exec(`
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state, created_by_user_id)
      VALUES (100, 'prep-draft', 'hq', 70, 10, NULL, 'preparation', 'draft', 'unreleased', 1);
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, released_revision_id, created_by_user_id) VALUES
      (102, 'prep-pub', 'hq', 70, 10, ${PUBLISHED}, 'preparation', 'published', 1021, 1),
      (103, 'prep-wd', 'hq', 70, 10, ${WITHDRAWN}, 'legacy_attach', 'withdrawn', 1031, 1),
      (104, 'prep-arch', 'hq', 70, 10, ${ARCHIVED}, 'preparation', 'archived', 1041, 1);
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, created_by_user_id)
      VALUES (105, 'prep-att', 'hq', 70, 10, ${ATTACHED}, 'legacy_attach', 'unreleased', 1);
  `);
  // Rows no current writer can produce, written past the CHECKs: an unknown publication state, and a never-released
  // private preparation that owns a deals row. Both must read as private.
  db.exec('PRAGMA ignore_check_constraints = ON');
  db.exec(`INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, created_by_user_id) VALUES
    (106, 'prep-bad', 'hq', 70, 10, ${CORRUPT}, 'legacy_attach', 'mystery', 1),
    (107, 'prep-private-row', 'hq', 70, 20, ${PRIVATE_ROW}, 'preparation', 'unreleased', 1)`);
  db.exec('PRAGMA ignore_check_constraints = OFF');
  return db;
}

/** A preparation table the guard's query cannot read: a real SQLite failure that is not "no such table". */
function brokenDb(): DatabaseSync {
  const db = baseDb();
  db.exec('CREATE TABLE deal_preparations (broken TEXT)');
  return db;
}

const fullDb = () => withPreparations(baseDb());
const env = (db: DatabaseSync) => ({ DB: d1Over(db), ENVIRONMENT: 'production', JWT_SECRET: SECRET, APP_URL: 'https://example.test' }) as any;
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const err = console.error, warn = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = err; console.warn = warn; }
};

async function call(app: { request: Function }, db: DatabaseSync, path: string, user: number) {
  const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const res: Response = await quiet(() => app.request(path, { headers: { Cookie: `studioos_auth=${token}` } }, env(db),
    { waitUntil() {}, passThroughOnException() {} }));
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const ids = (rows: Array<{ id: unknown }>) => rows.map((r) => Number(r.id)).sort((a, b) => a - b);

// ---------------------------------------------------------------------------------------------------------------------
// routes/calendar.ts — GET /deals
// ---------------------------------------------------------------------------------------------------------------------

test('R4 · calendar deal picker: staff see every deal but private and unknown ones; withdrawn and archived stay', async () => {
  const db = fullDb();
  try {
    const admin = await call(calendar, db, '/deals', 1);
    assert.equal(admin.status, 200);
    assert.deepEqual(ids(admin.body.items), TRANSACTIONAL, 'admin');
    const partner = await call(calendar, db, '/deals', 2);
    assert.deepEqual(ids(partner.body.items), TRANSACTIONAL, 'partner');
  } finally { db.close(); }
});

test('R4 · calendar deal picker: an investor keeps the withdrawn deal they are on, never the private one', async () => {
  const db = fullDb();
  try {
    const investor = await call(calendar, db, '/deals', 3);
    assert.equal(investor.status, 200);
    assert.deepEqual(ids(investor.body.items), [WITHDRAWN]);
    // The private deal's venture is searchable by name and still not offered.
    assert.deepEqual((await call(calendar, db, '/deals?q=quill', 3)).body.items, []);
    assert.deepEqual((await call(calendar, db, '/deals?q=quill', 1)).body.items, [], 'not for an admin either');
  } finally { db.close(); }
});

test('R4 · calendar deal picker: no preparation table hides nothing; an unreadable one is a 500 with no list', async () => {
  const db = baseDb();
  try {
    assert.deepEqual(ids((await call(calendar, db, '/deals', 1)).body.items), ALL);
  } finally { db.close(); }
  const broken = brokenDb();
  try {
    const res = await call(calendar, broken, '/deals', 1);
    assert.equal(res.status, 500);
    assert.equal(res.body.items, undefined);
  } finally { broken.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// routes/private-data.ts — GET /portfolio/metrics
// ---------------------------------------------------------------------------------------------------------------------

test('R4 · private-data: the admin totals count every deal but private and unknown ones', async () => {
  const db = fullDb();
  try {
    const res = await call(privateData, db, '/portfolio/metrics', 1);
    assert.equal(res.status, 200);
    assert.equal(res.body.overview.total_deals, TRANSACTIONAL.length);
    // ARCHIVED is funded, so it is not active.
    assert.equal(res.body.overview.active_deals, TRANSACTIONAL.length - 1);
  } finally { db.close(); }
});

test('R4 · private-data: a partner lists their deals less private ones; a non-staff partner link reads as discovery', async () => {
  const db = fullDb();
  try {
    const partner = await call(privateData, db, '/portfolio/metrics', 2);
    assert.equal(partner.status, 200);
    assert.deepEqual(ids(partner.body.deals), TRANSACTIONAL);
    assert.equal(partner.body.total_deals, TRANSACTIONAL.length);
    const linked = await call(privateData, db, '/portfolio/metrics', 4);
    assert.equal(linked.status, 200);
    assert.deepEqual(ids(linked.body.deals), DISCOVERY, 'an investor is not deal staff: withdrawn and archived drop');
    assert.equal(linked.body.total_deals, DISCOVERY.length);
  } finally { db.close(); }
});

test('R4 · private-data: no preparation table hides nothing; an unreadable one is a 500, never unfiltered totals', async () => {
  const db = baseDb();
  try {
    assert.equal((await call(privateData, db, '/portfolio/metrics', 1)).body.overview.total_deals, ALL.length);
  } finally { db.close(); }
  const broken = brokenDb();
  try {
    for (const user of [1, 2]) {
      const res = await call(privateData, broken, '/portfolio/metrics', user);
      assert.equal(res.status, 500, `user ${user}`);
      assert.equal(res.body?.overview, undefined);
      assert.equal(res.body?.deals, undefined);
    }
  } finally { broken.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// services/eadwynReaders.ts — the CRM context lines
// ---------------------------------------------------------------------------------------------------------------------

async function crmLines(db: DatabaseSync, key: 'hubspot' | 'salesforce') {
  const row = db.prepare('SELECT * FROM integrations WHERE provider_key = ?').get(key) as any;
  return (await CONNECTOR_READERS[key](env(db), { id: 6 } as any, row, 70)).facts;
}
const amountsIn = (facts: string[]) => ALL.filter((id) => facts.some((f) => f.includes(`amount ${amountOf(id).toLocaleString('en-US')}`)));

test('R4 · eadwyn CRM context: the company reads its deals less private and unknown ones; withdrawn and archived stay', async () => {
  const db = fullDb();
  try {
    for (const key of ['hubspot', 'salesforce'] as const) {
      const facts = await crmLines(db, key);
      assert.deepEqual(amountsIn(facts), TRANSACTIONAL, key);
      assert.ok(!facts.some((f) => f.includes('Quill Works')), `${key}: the private deal's venture reached the model`);
    }
  } finally { db.close(); }
});

test('R4 · eadwyn CRM context: no preparation table hides nothing; an unreadable one throws, so no line is read', async () => {
  const db = baseDb();
  try {
    assert.deepEqual(amountsIn(await crmLines(db, 'hubspot')), ALL);
  } finally { db.close(); }
  const broken = brokenDb();
  try {
    for (const key of ['hubspot', 'salesforce'] as const) {
      await assert.rejects(() => crmLines(broken, key), undefined, `${key} read past an unreadable guard`);
    }
  } finally { broken.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// services/scoreAccess.ts — project access through a deal, and score counterparties
// ---------------------------------------------------------------------------------------------------------------------

test('R4 · scoreAccess: a private deal opens no venture; a withdrawn one still does for the investor on it', async () => {
  const db = fullDb();
  try {
    const investor = { id: 3, role: 'investor' } as any;
    assert.equal(await mayReadProjectDeal(env(db), investor, 10), true, 'withdrawn release, invited investor');
    assert.equal(await mayReadProjectDeal(env(db), investor, 20), false, 'private preparation row');
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    assert.equal(await mayReadProjectDeal(env(legacy), { id: 3, role: 'investor' } as any, 20), true, 'no table: legacy rule');
  } finally { legacy.close(); }
  const broken = brokenDb();
  try {
    await assert.rejects(() => mayReadProjectDeal(env(broken), { id: 3, role: 'investor' } as any, 10));
  } finally { broken.close(); }
});

test('R4 · scoreAccess: a private deal makes no counterparty; a withdrawn one still does between its parties', async () => {
  const db = fullDb();
  try {
    assert.deepEqual([...await counterpartiesOf(env(db), 3, [5, 7], false)], [5]);
    assert.deepEqual([...await counterpartiesOf(env(db), 7, [3], false)], [], 'the private deal\'s founder');
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    assert.deepEqual([...await counterpartiesOf(env(legacy), 3, [5, 7], false)].sort(), [5, 7], 'no table: legacy rule');
  } finally { legacy.close(); }
  const broken = brokenDb();
  try {
    await assert.rejects(() => counterpartiesOf(env(broken), 3, [5, 7], false));
  } finally { broken.close(); }
});
