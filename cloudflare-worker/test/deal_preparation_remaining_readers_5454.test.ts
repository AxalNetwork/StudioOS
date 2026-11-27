/**
 * D5454 part 4 (#5454, R4) — the last R4 readers apply the preparation guard. Real `node:sqlite`, the full baseline
 * schema, the D5454 migration and the diligence migrations, through the real route handlers, provider entry points and
 * service functions. Every venture, person, deal, amount and credential is invented; no request leaves the process
 * (`fetch` is replaced by a recorder).
 *
 *   - `integrations/providers/hubspot.ts` and `salesforce.ts`: the push export (`push`, `preview`, `sync`'s outbound);
 *   - `routes/dd.ts`: Open a case's subject search and deal list, an investor opening a case, a case's linked deal,
 *     and the asking team's name on a founder's requests;
 *   - `services/ventureScoring/access.ts`: the investors' "listed" switch and a deal's venture;
 *   - `services/ventureScoring/collectors.ts`: raise progress.
 *
 * What it proves:
 *   - a private preparation (a mixed-version row written past CHECK `dp_private_owns_no_deal`) and a deal with unknown
 *     preparation metadata reach none of them, for an admin too;
 *   - a withdrawn or archived release stays for the transactional readers (the export to the venture's own CRM,
 *     diligence's staff and on-deal investors, the scorecard switch) and leaves raise progress, a stored figure every
 *     investor on any of the venture's deals reads (`discovery`);
 *   - legacy, unreleased `legacy_attach` and published deals are unchanged;
 *   - a database without the preparation table hides nothing (the guard's own rule), and a preparation table that
 *     cannot be read fails each reader closed: a refused push with nothing sent, a 500, a rejected read, an unreadable
 *     input, never an unfiltered result.
 *
 * MUTATION CHECKS (`scripts/mutation-check.mjs`; 18 mutations, 18 caught, 0 equivalent):
 *   M1  hubspot: drop `refuseHiddenDeal` from `pushOne`                      → push test fails (a request is sent)
 *   M2  hubspot: drop `refuseHiddenDeal` from `previewOne`                   → preview test fails
 *   M3  hubspot: drop the `NOT IN` from `sync`'s outbound query              → sync test fails
 *   M4  salesforce: drop `refuseHiddenDeal` from `previewOne`                → preview test fails
 *   M4b salesforce: drop `refuseHiddenDeal` from `pushOne`                   → push test fails
 *   M5  salesforce: drop the `NOT IN` from `sync`'s outbound query           → sync test fails
 *   M6  `refuseHiddenDeal` without `Number(...)` (a string id slips past)    → preview test fails
 *   M7  dd: drop the guard from `withDeals`                                  → staff subjects test fails
 *   M8  dd: drop the guard from the investor subject search                  → investor subjects test fails
 *   M9  dd: drop the guard from `investorOnVisibleProjectDeal`               → open-a-case test fails
 *   M10 dd: drop `dealHiddenFrom` from `caseContextFrom`                     → linked-deal test fails
 *   M11 dd: an empty hidden set for the asking team's name                   → requests test fails
 *   M12 access: `discovery` in place of `transactional` for "listed"         → switch test fails (withdrawn venture)
 *   M13 access: drop the guard from "listed"                                 → switch test fails (private venture)
 *   M14 access: drop the guard from `dealProject`                            → deal venture test fails
 *   M15 collectors: `transactional` in place of `discovery`                  → raise progress test fails
 *   M16 collectors: read unfiltered when the guard fails                     → unreadable test fails
 *   M17 collectors: drop the guard from the deal sums                        → raise progress test fails
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_preparation_remaining_readers_5454.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import '../src/integrations/providers/hubspot.ts';
import '../src/integrations/providers/salesforce.ts';
import { getProviderImpl } from '../src/integrations/registry.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import dd from '../src/routes/dd.ts';
import { dealProject, investorsMaySee } from '../src/services/ventureScoring/access.ts';
import { collectScope } from '../src/services/ventureScoring/collectors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { randomBytes } from 'node:crypto';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const D5454 = read('cloudflare-worker/sql/migrations/202611150148_5454_deal_preparations.sql');
const EXTRA = ['435_connector_companies', '249_project_metrics', '442_raise_cycle_stores', '626_venture_score_access', '463_raise_record_stores', '339_dd_section_signoff', '620_dd_case_lifecycle', '622_dd_documents_due_reminders', '623_dd_team_templates']
  .map((m) => read(`cloudflare-worker/sql/migrations/${m}.sql`));
// A fresh signing key per run, never a literal (a literal trips the secret scan).
const SECRET = randomBytes(32).toString('hex');

/** Deals by what their preparation metadata makes them. Venture 10 holds five, WITHDRAWN alone is venture 30 and
 *  PRIVATE_ROW alone is venture 20, so a venture can be reached through one class only. */
const LEGACY = 1, PUBLISHED = 2, WITHDRAWN = 3, ARCHIVED = 4, ATTACHED = 5, CORRUPT = 6, PRIVATE_ROW = 7;
const ALL = [LEGACY, PUBLISHED, WITHDRAWN, ARCHIVED, ATTACHED, CORRUPT, PRIVATE_ROW];
/** What staff, the venture and an investor on the deal may see: everything but private and unknown. */
const TRANSACTIONAL = [LEGACY, PUBLISHED, WITHDRAWN, ARCHIVED, ATTACHED];
const VENTURE_OF: Record<number, number> = { 1: 10, 2: 10, 3: 30, 4: 10, 5: 10, 6: 10, 7: 20 };
const amountOf = (id: number) => id * 1000 + 7;

/** 1 admin · 3 investor, invited to WITHDRAWN and committed on PRIVATE_ROW for firm 71 · 4 investor committed on
 *  LEGACY and ARCHIVED · 6 founder of every venture, member of company 70 and owner of both CRM connections. */
function baseDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const sql of EXTRA) db.exec(sql);
  // The CRM providers scope their outbound batch (and Salesforce its push by id) by `founders.user_id`, a column no
  // migration creates: on the real schema those reads fail before the guard matters (a separate defect, out of this
  // slice). The fixture adds the column the providers expect so the guard itself is what these tests exercise.
  db.exec('ALTER TABLE founders ADD COLUMN user_id INTEGER');
  // Migration 042's typed runway, which the financial collector reads beside raise progress.
  db.exec('ALTER TABLE projects ADD COLUMN runway_months INTEGER');
  db.exec(`
    INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Harbor Ledger Inc'), (71, 'co-71', 'Fixture Capital');
    INSERT INTO founders (id, name, email, user_id) VALUES (106, 'Fixture Founder', 'member-6@example.test', 6);
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (1, 'u1', 'member-1@example.test', 'Fixture Admin', 'admin', 1),
      (3, 'u3', 'member-3@example.test', 'Fixture Investor', 'investor', 1),
      (4, 'u4', 'member-4@example.test', 'Fixture Second Investor', 'investor', 1),
      (6, 'u6', 'member-6@example.test', 'Fixture Founder', 'founder', 1);
    UPDATE users SET founder_id = 106 WHERE id = 6;
    UPDATE users SET investor_tier = 'professional' WHERE role = 'investor';
    INSERT INTO projects (id, name, company_id, founder_id, sector) VALUES
      (10, 'Harbor Ledger', 70, 106, 'fintech'), (20, 'Quill Works', 70, 106, 'fintech'), (30, 'Tern Labs', 70, 106, 'fintech');
    INSERT INTO deals (id, uid, project_id, status, amount, target_raise, capital_committed, hubspot_deal_id, sf_opportunity_id, updated_at) VALUES
      (${LEGACY}, 'g1', 10, 'active', ${amountOf(LEGACY)}, ${amountOf(LEGACY)}, ${LEGACY}, 'hs-1', 'sf-1', '2026-11-26 09:00:00'),
      (${PUBLISHED}, 'g2', 10, 'active', ${amountOf(PUBLISHED)}, ${amountOf(PUBLISHED)}, ${PUBLISHED}, 'hs-2', 'sf-2', '2026-11-26 09:00:00'),
      (${WITHDRAWN}, 'g3', 30, 'active', ${amountOf(WITHDRAWN)}, ${amountOf(WITHDRAWN)}, ${WITHDRAWN}, 'hs-3', 'sf-3', '2026-11-26 09:00:00'),
      (${ARCHIVED}, 'g4', 10, 'funded', ${amountOf(ARCHIVED)}, ${amountOf(ARCHIVED)}, ${ARCHIVED}, 'hs-4', 'sf-4', '2026-11-26 09:00:00'),
      (${ATTACHED}, 'g5', 10, 'scored', ${amountOf(ATTACHED)}, ${amountOf(ATTACHED)}, ${ATTACHED}, 'hs-5', 'sf-5', '2026-11-26 09:00:00'),
      (${CORRUPT}, 'g6', 10, 'active', ${amountOf(CORRUPT)}, ${amountOf(CORRUPT)}, ${CORRUPT}, 'hs-6', 'sf-6', '2026-11-26 09:00:00'),
      (${PRIVATE_ROW}, 'g7', 20, 'applied', ${amountOf(PRIVATE_ROW)}, ${amountOf(PRIVATE_ROW)}, ${PRIVATE_ROW}, 'hs-7', 'sf-7', '2026-11-26 09:00:00');
    INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (${WITHDRAWN}, 3);
    INSERT INTO commitments (uid, deal_id, investor_user_id, company_id, amount) VALUES
      ('k1', ${PRIVATE_ROW}, 3, 71, 1000), ('k2', ${LEGACY}, 4, NULL, 1000), ('k3', ${ARCHIVED}, 4, NULL, 1000);
    INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('ucl-6', 70, 6);
    INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, last_synced_at) VALUES
      (1, 'int-1', 6, 'hubspot', 'active', 'oauth2', '2026-11-20 09:00:00'),
      (2, 'int-2', 6, 'salesforce', 'active', 'oauth2', '2026-11-20 09:00:00');
    INSERT OR IGNORE INTO integration_companies (integration_id, company_id, enabled) VALUES (1, 70, 1), (2, 70, 1);
    INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status) VALUES
      (1, 'case-ledger', 'project', 10, 'Harbor Ledger', 1, 1, 'open'),
      (2, 'case-quill', 'project', 20, 'Quill Works', 1, 1, 'open');
    INSERT INTO dd_requests (case_id, title, state, created_by_user_id) VALUES (2, 'Send the cap table', 'requested', 3);
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
      (103, 'prep-wd', 'hq', 70, 30, ${WITHDRAWN}, 'legacy_attach', 'withdrawn', 1031, 1),
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
const env = (db: DatabaseSync) => ({ DB: d1Over(db), ENVIRONMENT: 'development', JWT_SECRET: SECRET, APP_URL: 'https://example.test' }) as any;
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const err = console.error, warn = console.warn, log = console.log;
  console.error = () => {}; console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.error = err; console.warn = warn; console.log = log; }
};
const sorted = (xs: Iterable<number>) => [...xs].sort((a, b) => a - b);

async function call(db: DatabaseSync, method: string, path: string, user: number, body?: unknown) {
  const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const headers: Record<string, string> = { Cookie: `studioos_auth=${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res: Response = await quiet(() => dd.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env(db),
    { waitUntil() {}, passThroughOnException() {} }));
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------------------------------------------------
// integrations/providers/hubspot.ts and salesforce.ts — the push export
// ---------------------------------------------------------------------------------------------------------------------

/** Replaces `fetch` with a recorder for `fn`; every call answers 200 with a body both providers accept. */
async function recordingFetch<T>(fn: () => Promise<T>): Promise<{ out: T; urls: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    urls.push(String(input?.url ?? input));
    return new Response(JSON.stringify({ id: 'created-1', results: [], records: [], done: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  try { return { out: await quiet(fn), urls }; } finally { globalThis.fetch = real; }
}

async function connection(db: DatabaseSync, key: 'hubspot' | 'salesforce') {
  const row = db.prepare('SELECT * FROM integrations WHERE provider_key = ?').get(key) as any;
  const creds = key === 'hubspot'
    ? { access_token: 'synthetic-access', is_private_app: true }
    : { access_token: 'synthetic-access', instance_url: 'https://crm.example.test' };
  row.credentials_enc = await encryptCredentials(env(db), row.uid, creds);
  db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(row.credentials_enc, row.id);
  return row;
}

/** The deal ids whose CRM record a set of request URLs touched (`hs-N`, `sf-N`). */
const pushedIds = (urls: string[]) => sorted(new Set(urls.flatMap((u) => [...u.matchAll(/\/(?:hs|sf)-(\d+)(?:[/?]|$)/g)].map((m) => Number(m[1])))));

for (const key of ['hubspot', 'salesforce'] as const) {
  test(`R4 · ${key} preview: private and unknown deals are not found, for any id form; withdrawn and archived preview`, async () => {
    const db = fullDb();
    try {
      const impl = getProviderImpl(key)!;
      const row = await connection(db, key);
      for (const id of [PRIVATE_ROW, CORRUPT]) {
        await assert.rejects(() => impl.preview!(env(db), row, { deal_id: id }), /deal_not_found/, `${key} previewed hidden deal ${id}`);
        await assert.rejects(() => impl.preview!(env(db), row, { deal_id: String(id) }), /deal_not_found/, `${key} previewed hidden deal "${id}"`);
      }
      for (const id of TRANSACTIONAL) {
        const preview = await impl.preview!(env(db), row, { deal_id: id });
        assert.ok(preview.target, `${key} preview of deal ${id}`);
      }
    } finally { db.close(); }
  });

  test(`R4 · ${key} push: a hidden deal is refused before any request; a withdrawn release is still sent`, async () => {
    const db = fullDb();
    try {
      const impl = getProviderImpl(key)!;
      const row = await connection(db, key);
      const c = { env: env(db) } as any;
      for (const id of [PRIVATE_ROW, CORRUPT]) {
        const { urls } = await recordingFetch(() => assert.rejects(() => impl.push(c, { id: 6 } as any, row, { deal_id: id }), /deal_not_found/));
        assert.deepEqual(urls, [], `${key} sent a request for hidden deal ${id}`);
      }
      const sent = await recordingFetch(() => impl.push(c, { id: 6 } as any, row, { deal_id: WITHDRAWN }));
      assert.deepEqual(pushedIds(sent.urls), [WITHDRAWN]);
    } finally { db.close(); }
  });

  test(`R4 · ${key} sync: the outbound batch leaves out private and unknown deals; no table hides nothing; a broken guard sends nothing`, async () => {
    const db = fullDb();
    try {
      const row = await connection(db, key);
      const { urls } = await recordingFetch(() => getProviderImpl(key)!.sync!({ env: env(db) } as any, { id: 6 } as any, row));
      assert.deepEqual(pushedIds(urls), TRANSACTIONAL);
    } finally { db.close(); }
    const legacy = baseDb();
    try {
      const row = await connection(legacy, key);
      const { urls } = await recordingFetch(() => getProviderImpl(key)!.sync!({ env: env(legacy) } as any, { id: 6 } as any, row));
      assert.deepEqual(pushedIds(urls), ALL);
    } finally { legacy.close(); }
    const broken = brokenDb();
    try {
      const row = await connection(broken, key);
      const { urls } = await recordingFetch(() => assert.rejects(() => getProviderImpl(key)!.sync!({ env: env(broken) } as any, { id: 6 } as any, row)));
      assert.deepEqual(urls, [], `${key} synced past an unreadable guard`);
    } finally { broken.close(); }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// routes/dd.ts — Open a case, a case's linked deal, a founder's requests
// ---------------------------------------------------------------------------------------------------------------------

const subjectDeals = (items: Array<{ deals: Array<{ id: number }> }>) => sorted(items.flatMap((p) => p.deals.map((d) => Number(d.id))));

test('R4 · dd subjects: staff link every deal but private and unknown ones; withdrawn and archived stay', async () => {
  const db = fullDb();
  try {
    const res = await call(db, 'GET', '/subjects?type=project&q=', 1);
    assert.equal(res.status, 200);
    assert.deepEqual(subjectDeals(res.body.items), TRANSACTIONAL);
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    assert.deepEqual(subjectDeals((await call(legacy, 'GET', '/subjects?type=project&q=', 1)).body.items), ALL);
  } finally { legacy.close(); }
  const broken = brokenDb();
  try {
    const res = await call(broken, 'GET', '/subjects?type=project&q=', 1);
    assert.equal(res.status, 500);
    assert.equal(res.body?.items, undefined);
  } finally { broken.close(); }
});

test('R4 · dd subjects: an investor finds the venture of the withdrawn deal they are on, never the private one', async () => {
  const db = fullDb();
  try {
    const res = await call(db, 'GET', '/subjects?type=project&q=', 3);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((p: any) => Number(p.id)), [30]);
    assert.deepEqual(subjectDeals(res.body.items), [WITHDRAWN]);
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    const res = await call(legacy, 'GET', '/subjects?type=project&q=', 3);
    assert.deepEqual(sorted(res.body.items.map((p: any) => Number(p.id))), [20, 30], 'no table: the commitment still counts');
  } finally { legacy.close(); }
});

test('R4 · dd open a case: an investor whose only deal is private is refused; the withdrawn deal still opens one', async () => {
  const db = fullDb();
  try {
    const refused = await call(db, 'POST', '/cases', 3, { subject_type: 'project', subject_id: 20, subject_label: 'Quill Works' });
    assert.equal(refused.status, 403);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM dd_cases WHERE subject_id = 20 AND owner_user_id = 3").get() as any).n), 0);
    const opened = await call(db, 'POST', '/cases', 3, { subject_type: 'project', subject_id: 30, subject_label: 'Tern Labs' });
    assert.ok(opened.status < 300, `withdrawn release, invited investor: ${opened.status}`);
  } finally { db.close(); }
  const broken = brokenDb();
  try {
    const res = await call(broken, 'POST', '/cases', 3, { subject_type: 'project', subject_id: 30, subject_label: 'Tern Labs' });
    assert.equal(res.status, 500);
    assert.equal(Number((broken.prepare('SELECT COUNT(*) AS n FROM dd_cases WHERE owner_user_id = 3').get() as any).n), 0);
  } finally { broken.close(); }
});

test('R4 · dd linked deal: a private or unknown deal cannot be linked, even by an admin; a withdrawn one can', async () => {
  const db = fullDb();
  try {
    for (const id of [PRIVATE_ROW, CORRUPT]) {
      const res = await call(db, 'PATCH', '/cases/case-quill', 1, { deal_id: id });
      assert.equal(res.status, 404, `deal ${id}`);
    }
    assert.equal((db.prepare("SELECT deal_id FROM dd_cases WHERE uid = 'case-quill'").get() as any).deal_id, null);
    const ok = await call(db, 'PATCH', '/cases/case-ledger', 1, { deal_id: ARCHIVED });
    assert.equal(ok.status, 200);
    assert.equal(Number((db.prepare("SELECT deal_id FROM dd_cases WHERE uid = 'case-ledger'").get() as any).deal_id), ARCHIVED);
  } finally { db.close(); }
});

test('R4 · dd requests: the asking team is never named from a commitment on a private deal', async () => {
  const db = fullDb();
  try {
    const res = await call(db, 'GET', '/requests/mine', 6);
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].asking_team_name, null);
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    assert.equal((await call(legacy, 'GET', '/requests/mine', 6)).body.items[0].asking_team_name, 'Fixture Capital', 'no table: legacy rule');
  } finally { legacy.close(); }
  const broken = brokenDb();
  try {
    const res = await call(broken, 'GET', '/requests/mine', 6);
    assert.equal(res.status, 500);
    assert.equal(res.body?.items, undefined);
  } finally { broken.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// services/ventureScoring/access.ts — the investors' switch and a deal's venture
// ---------------------------------------------------------------------------------------------------------------------

test('R4 · scorecard switch: a venture listed only by a private deal is not listed; one listed only by a withdrawn release is', async () => {
  const db = fullDb();
  try {
    assert.deepEqual(await investorsMaySee(env(db), 20), { on: false, set: false }, 'private only');
    assert.deepEqual(await investorsMaySee(env(db), 30), { on: true, set: false }, 'withdrawn only: on for the investors already on it');
    assert.deepEqual(await investorsMaySee(env(db), 10), { on: true, set: false });
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    assert.deepEqual(await investorsMaySee(env(legacy), 20), { on: true, set: false }, 'no table: legacy rule');
  } finally { legacy.close(); }
  const broken = brokenDb();
  try {
    await assert.rejects(() => investorsMaySee(env(broken), 10));
  } finally { broken.close(); }
});

test('R4 · scorecard deal: a private or unknown deal has no venture; a withdrawn or archived one keeps it', async () => {
  const db = fullDb();
  try {
    for (const id of ALL) {
      assert.equal(await dealProject(env(db), id), TRANSACTIONAL.includes(id) ? VENTURE_OF[id] : null, `deal ${id}`);
    }
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    assert.equal(await dealProject(env(legacy), PRIVATE_ROW), 20, 'no table: legacy rule');
  } finally { legacy.close(); }
  const broken = brokenDb();
  try {
    await assert.rejects(() => dealProject(env(broken), LEGACY));
  } finally { broken.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// services/ventureScoring/collectors.ts — raise progress
// ---------------------------------------------------------------------------------------------------------------------

async function raiseProgress(db: DatabaseSync, projectId: number) {
  const facts = await quiet(() => collectScope(env(db), 'financial', projectId, { stage: null, status: null }, '2026-11-27'));
  return facts.find((f: any) => f.key === 'raise_progress') as any;
}

test('R4 · raise progress: sums only deals discovery shows; withdrawn, archived, private and unknown deals are left out', async () => {
  const db = fullDb();
  try {
    const fact = await raiseProgress(db, 10);
    // Venture 10 shows LEGACY, PUBLISHED and ATTACHED; ARCHIVED and CORRUPT are left out.
    const shown = [LEGACY, PUBLISHED, ATTACHED];
    assert.equal(fact.recorded, true);
    assert.equal(fact.raw.n, shown.reduce((s, id) => s + id, 0), 'committed');
    assert.equal(fact.raw.of, shown.reduce((s, id) => s + amountOf(id), 0), 'target');
    assert.equal(fact.source.rows, shown.length);
    assert.ok(!fact.unreadable);
    assert.equal((await raiseProgress(db, 30)).recorded, false, 'the withdrawn release is not summed into the stored score');
    assert.equal((await raiseProgress(db, 20)).recorded, false, 'nor is the private deal');
  } finally { db.close(); }
  const legacy = baseDb();
  try {
    const fact = await raiseProgress(legacy, 10);
    assert.equal(fact.source.rows, 5, 'no table: every deal of the venture');
    assert.equal((await raiseProgress(legacy, 30)).raw.n, WITHDRAWN);
  } finally { legacy.close(); }
});

test('R4 · raise progress: an unreadable guard makes raise progress unreadable, never an unfiltered sum', async () => {
  const broken = brokenDb();
  try {
    const fact = await raiseProgress(broken, 10);
    assert.equal(fact.unreadable, true);
    assert.equal(fact.recorded, false);
    assert.deepEqual(fact.raw, {});
  } finally { broken.close(); }
});
