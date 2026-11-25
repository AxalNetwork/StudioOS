/**
 * D7835 (#7835) — saved competitive contexts, on a schema built from the baseline plus every
 * migration (this issue's included): owner scope, the versioned write and its stale refusal, the
 * support-session refusal, the criteria vocabulary of #7828, the directory record read through the
 * served rows under the Companies rule, customer countries from the taxonomy's list, the fields
 * shared with #7719 and their limits, the immutable version history, and a context table with no
 * column that references a project, a study or a study segment.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_competitive_contexts_7835.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import contexts, { mount } from '../src/routes/research_competitive_contexts.ts';
import { CONTEXT_LIMITS, CUSTOMER_COUNTRIES_MAX, CONTEXTS_PER_OWNER_MAX } from '../src/services/competitiveContexts.ts';
import { CUSTOMER_COUNTRIES_MAX as STUDY_COUNTRIES_MAX, SEGMENT_LIMITS, STUDY_LIMITS } from '../src/routes/research_studies.ts';
import { COMPANY_FACT_ATTRIBUTES } from '../src/services/researchCompanyFacts.ts';

const app = new Hono().route(mount.path, contexts);
app.onError((error, c) => c.json({ detail: error.message }, error.message === 'Unauthorized' ? 401 : 500));
const SECRET = 'unit-competitive-contexts-7835-0123456789abcdef';
const OWNER = 783501, OTHER = 783502, INVESTOR = 783503;
const SERVED = 'synthetic-7835-served', WITHDRAWN = 'synthetic-7835-withdrawn';

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES
      (${OWNER}, '7835-owner@example.invalid', 'Owner', 'founder', 1),
      (${OTHER}, '7835-other@example.invalid', 'Other', 'founder', 1),
      (${INVESTOR}, '7835-investor@example.invalid', 'Investor', 'investor', 1);
    INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('PT', 'Portugal', 'Europe'), ('DE', 'Germany', 'Europe');
    INSERT INTO research_market_directory (slug, name, company_count, source_name, source_boundary, as_of)
      VALUES ('synthetic-scheduling', 'Synthetic scheduling', 3, 'Synthetic', 'Synthetic boundary', '2026-11-01');`);
  for (const uid of [SERVED, WITHDRAWN]) {
    db.prepare(
      `INSERT INTO research_company_directory (uid, name, website, country, source_url, source_name, source_license, as_of)
       VALUES (?, ?, 'https://synthetic.example', 'Portugal', 'https://synthetic.example/source', 'Synthetic directory', 'Synthetic terms', '2026-10-01')`,
    ).run(uid, `Name of ${uid}`);
  }
  db.exec(`INSERT INTO research_company_reviews (uid, status, reason_code, admin_note, reviewer, reviewed_on)
    VALUES ('${WITHDRAWN}', 'withdrawn', 'source_withdrawn', 'PRIVATE_SENTINEL', 1, '2026-11-01')`);
  db.exec('PRAGMA foreign_keys=ON');
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, method: string, path: string, body?: unknown, who = OWNER, support = false) {
  const token = await new SignJWT({ user_id: who, ...(support ? { impersonated_by: 9000 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research/competitive-contexts${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const count = (f: F, table: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
const receipts = (f: F) => f.db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'research_competitive_%' ORDER BY id").all() as any[];
const FULL = {
  name: 'Clinic scheduling against incumbents',
  product: 'Clinic scheduling',
  buyer: 'Practice manager',
  customer_segment: 'Small outpatient clinics',
  customer_problem: 'No-shows fill the diary with gaps',
  use_case: 'Rebook a cancelled slot within the hour',
  customer_countries: ['pt', 'DE'],
  business_model: 'Subscription per clinic',
  delivery_model: 'Hosted software',
  purpose: 'Decide whether to enter Germany',
  market_slug: 'synthetic-scheduling',
  criteria: ['pricing_model', 'product', 'markets_served'],
};
async function created(f: F, body: Record<string, unknown> = FULL, who = OWNER) {
  const r = await call(f, 'POST', '', body, who);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('the context table references no project, study or study segment, and keeps #7719’s limits', () => {
  const f = fixture();
  const references = f.db.prepare("SELECT \"table\" AS target, \"from\" AS col FROM pragma_foreign_key_list('research_competitive_contexts')").all() as any[];
  // Mutation checked: add `study_project_id INTEGER REFERENCES research_studies(project_id)` → this fails.
  assert.deepEqual(references.map((r) => `${r.col}->${r.target}`), ['owner_user_id->users']);
  const columns = (f.db.prepare("SELECT name FROM pragma_table_info('research_competitive_contexts')").all() as any[]).map((r) => r.name);
  assert.equal(columns.some((name: string) => /(^|_)(project|study|studies)(_|$)/.test(name) || /segment_(id|uid)$/.test(name)), false, columns.join(', '));
  assert.ok(['product', 'business_model', 'buyer', 'customer_countries_json'].every((n) => columns.includes(n)));
  const insert = (product: string | null, extra = '') => f.db.prepare(
    `INSERT INTO research_competitive_contexts (uid, owner_user_id, name, product${extra ? ', directory_record_uid' : ''}) VALUES (?, ${OWNER}, 'N', ?${extra ? ', ?' : ''})`,
  ).run(...([`ctx-${Math.random().toString(36).slice(2, 12)}`, product, ...(extra ? [extra] : [])] as any[]));
  assert.throws(() => insert('x'.repeat(STUDY_LIMITS.product + 1)), /CHECK/);
  assert.throws(() => insert(''), /CHECK/);
  // The subject is one or the other: a product and a directory record together are refused.
  assert.throws(() => insert('Mine', SERVED), /CHECK/);
  insert('x'.repeat(STUDY_LIMITS.product));
  // The shared fields take #7719's numbers, read from its exported limits.
  assert.equal(CONTEXT_LIMITS.product, STUDY_LIMITS.product);
  assert.equal(CONTEXT_LIMITS.business_model, STUDY_LIMITS.business_model);
  assert.equal(CONTEXT_LIMITS.buyer, SEGMENT_LIMITS.buyer);
  assert.equal(CUSTOMER_COUNTRIES_MAX, STUDY_COUNTRIES_MAX);
});

test('a saved version is never changed, and goes with its context', async () => {
  const f = fixture();
  const ctx = await created(f);
  // Mutation checked: drop trg_research_competitive_context_versions_immutable → the update succeeds.
  assert.throws(() => f.db.prepare("UPDATE research_competitive_context_versions SET fields_json = '{}'").run(), /never changed/);
  assert.equal((await call(f, 'DELETE', `/${ctx.uid}?version=1`)).status, 200);
  assert.equal(count(f, 'research_competitive_context_versions'), 0);
});

test('the owner saves, reads, lists, edits, reuses and deletes a context', async () => {
  const f = fixture();
  const ctx = await created(f);
  assert.equal(ctx.version, 1);
  assert.deepEqual(ctx.customer_countries, ['PT', 'DE']);
  assert.deepEqual(ctx.criteria, FULL.criteria, 'criteria keep the order given');
  for (const k of ['product', 'buyer', 'customer_segment', 'customer_problem', 'use_case', 'business_model', 'delivery_model', 'purpose', 'market_slug']) {
    assert.equal(ctx[k], (FULL as any)[k], k);
  }
  const listed = await call(f, 'GET', '');
  assert.deepEqual(listed.body.items.map((x: any) => x.uid), [ctx.uid]);
  const edited = await call(f, 'PUT', `/${ctx.uid}`, { ...FULL, version: 1, purpose: 'Price against the leader' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.version, 2);
  assert.equal(edited.body.purpose, 'Price against the leader');
  // Reused: read again later, the context is as last saved.
  const again = await call(f, 'GET', `/${ctx.uid}`);
  assert.deepEqual(again.body, edited.body);
  // The first version is kept exactly as it was.
  const v1 = await call(f, 'GET', `/${ctx.uid}/versions/1`);
  assert.equal(v1.status, 200);
  assert.equal(v1.body.fields.purpose, FULL.purpose);
  assert.equal((await call(f, 'GET', `/${ctx.uid}/versions/2`)).body.fields.purpose, 'Price against the leader');
  assert.equal((await call(f, 'GET', `/${ctx.uid}/versions/3`)).body.error, 'version_not_found');
  // A PUT replaces: a field left out is no longer recorded.
  const cleared = await call(f, 'PUT', `/${ctx.uid}`, { name: 'Bare', version: 2 });
  assert.equal(cleared.body.product, null);
  assert.deepEqual(cleared.body.customer_countries, []);
  assert.deepEqual(cleared.body.criteria, []);
  const gone = await call(f, 'DELETE', `/${ctx.uid}?version=3`);
  assert.deepEqual(gone.body, { deleted: true, uid: ctx.uid });
  assert.equal((await call(f, 'GET', `/${ctx.uid}`)).status, 404);
  // Receipts name the uid and the fields, never the text typed.
  const logs = receipts(f);
  assert.deepEqual(logs.map((l) => l.action), [
    'research_competitive_context_created', 'research_competitive_context_updated',
    'research_competitive_context_updated', 'research_competitive_context_deleted',
  ]);
  assert.equal(logs.some((l) => /no-shows|Practice manager|Price against/i.test(l.details)), false);
  assert.deepEqual(JSON.parse(logs[1].details).fields, ['purpose']);
});

test('another account’s context answers exactly as one that does not exist', async () => {
  const f = fixture();
  const ctx = await created(f);
  const routes: Array<[string, string, unknown?]> = [
    ['GET', `/${ctx.uid}`], ['PUT', `/${ctx.uid}`, { ...FULL, version: 1, name: 'Mine now' }],
    ['DELETE', `/${ctx.uid}?version=1`], ['GET', `/${ctx.uid}/versions/1`],
  ];
  for (const [method, path, body] of routes) {
    const theirs = await call(f, method, path, body, OTHER);
    const missing = await call(f, method, path.replace(ctx.uid, 'no-such-context'), body, OTHER);
    // Mutation checked: drop `AND owner_user_id = ?` from readOwnContext → another account reads and writes it.
    assert.deepEqual([theirs.status, theirs.body.error], [404, 'context_not_found'], `${method} ${path}`);
    assert.deepEqual(theirs.body, missing.body);
  }
  assert.deepEqual((await call(f, 'GET', '', undefined, OTHER)).body.items, []);
  assert.equal((await call(f, 'GET', `/${ctx.uid}`)).body.name, FULL.name, 'unchanged for its owner');
});

test('a stale update or delete is refused with the current version and changes nothing', async () => {
  const f = fixture();
  const ctx = await created(f);
  assert.equal((await call(f, 'PUT', `/${ctx.uid}`, { ...FULL, version: 1, name: 'First edit' })).status, 200);
  const stale = await call(f, 'PUT', `/${ctx.uid}`, { ...FULL, version: 1, name: 'Lost edit' });
  // Mutation checked: skip the version comparison → the stale write saves.
  assert.deepEqual([stale.status, stale.body.error, stale.body.current_version], [409, 'context_changed', 2]);
  assert.equal((await call(f, 'GET', `/${ctx.uid}`)).body.name, 'First edit');
  assert.equal(count(f, 'research_competitive_context_versions'), 2);
  const staleDelete = await call(f, 'DELETE', `/${ctx.uid}?version=1`);
  assert.deepEqual([staleDelete.status, staleDelete.body.current_version], [409, 2]);
  assert.equal(count(f, 'research_competitive_contexts'), 1);
  assert.equal((await call(f, 'PUT', `/${ctx.uid}`, { ...FULL, name: 'No version' })).body.error, 'invalid_version');
});

test('a support session reads but cannot write', async () => {
  const f = fixture();
  const ctx = await created(f);
  for (const [method, path, body] of [
    ['POST', '', FULL], ['PUT', `/${ctx.uid}`, { ...FULL, version: 1 }], ['DELETE', `/${ctx.uid}?version=1`],
  ] as Array<[string, string, unknown?]>) {
    const r = await call(f, method, path, body, OWNER, true);
    // Mutation checked: drop the support_session check → each write goes through.
    assert.deepEqual([r.status, r.body.error], [403, 'support_read_only'], `${method} ${path}`);
  }
  assert.equal(count(f, 'research_competitive_contexts'), 1);
  assert.equal((await call(f, 'GET', `/${ctx.uid}`, undefined, OWNER, true)).status, 200);
});

test('comparison criteria come from #7828’s attribute list, each once', async () => {
  const f = fixture();
  const outside = await call(f, 'POST', '', { ...FULL, criteria: ['product', 'headcount'] });
  // Mutation checked: accept any string as a criterion → 'headcount' saves.
  assert.deepEqual([outside.status, outside.body.error], [400, 'unknown_criterion']);
  assert.equal((await call(f, 'POST', '', { ...FULL, criteria: ['product', 'product'] })).body.error, 'duplicate_criterion');
  assert.equal((await call(f, 'POST', '', { ...FULL, criteria: 'product' })).body.error, 'invalid_criteria');
  const all = await created(f, { ...FULL, criteria: [...COMPANY_FACT_ATTRIBUTES].reverse() });
  assert.deepEqual(all.criteria, [...COMPANY_FACT_ATTRIBUTES].reverse());
  assert.equal(count(f, 'research_competitive_contexts'), 1);
});

test('a directory record not served to the member is refused without naming it', async () => {
  const f = fixture();
  const subject = { ...FULL, product: null };
  const cases: Array<[string, number]> = [[WITHDRAWN, OWNER], ['synthetic-7835-absent', OWNER], [SERVED, INVESTOR]];
  const bodies = [];
  for (const [uid, who] of cases) {
    const r = await call(f, 'POST', '', { ...subject, directory_record_uid: uid }, who);
    // Mutation checked: skip the served-rows read → the withdrawn record saves; skip admitsCompanies → the investor saves.
    assert.deepEqual([r.status, r.body.error], [404, 'directory_record_not_available'], uid);
    assert.equal(JSON.stringify(r.body).includes(uid), false, 'the refusal does not name the record');
    bodies.push(r.body);
  }
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[0], bodies[2]);
  assert.equal(count(f, 'research_competitive_contexts'), 0);
  const ok = await created(f, { ...subject, directory_record_uid: SERVED, customer_countries: [] });
  assert.deepEqual(ok.directory_record, { uid: SERVED, state: 'served', name: `Name of ${SERVED}` });
  // The record's country (Portugal) never fills customer countries.
  assert.deepEqual(ok.customer_countries, []);
  // Once withdrawn, a read keeps the uid the member wrote and no longer names the record.
  f.db.exec(`INSERT INTO research_company_reviews (uid, status, reason_code, admin_note, reviewer, reviewed_on)
    VALUES ('${SERVED}', 'withdrawn', 'source_withdrawn', 'n', 1, '2026-11-02')`);
  assert.deepEqual((await call(f, 'GET', `/${ok.uid}`)).body.directory_record, { uid: SERVED, state: 'not_available' });
  // An edit that keeps the record is not refused for it; naming a new unserved one is.
  assert.equal((await call(f, 'PUT', `/${ok.uid}`, { ...subject, directory_record_uid: SERVED, version: 1, name: 'Kept' })).status, 200);
  assert.equal((await call(f, 'PUT', `/${ok.uid}`, { ...subject, directory_record_uid: WITHDRAWN, version: 2 })).body.error, 'directory_record_not_available');
  assert.equal((await call(f, 'POST', '', { ...FULL, directory_record_uid: SERVED })).body.error, 'product_or_record');
});

test('customer countries are two-letter codes from the taxonomy’s list and start empty', async () => {
  const f = fixture();
  const bare = await created(f, { name: 'Only a name' });
  assert.deepEqual(bare.customer_countries, []);
  assert.equal((f.db.prepare('SELECT customer_countries_json AS j FROM research_competitive_contexts').get() as any).j, null);
  // Mutation checked: skip countriesKnown → 'ZZ' (two letters, not on the list) saves.
  assert.equal((await call(f, 'POST', '', { ...FULL, customer_countries: ['ZZ'] })).body.error, 'invalid_customer_country');
  assert.equal((await call(f, 'POST', '', { ...FULL, customer_countries: ['Portugal'] })).body.error, 'invalid_customer_country');
  assert.equal((await call(f, 'POST', '', { ...FULL, customer_countries: 'PT' })).body.error, 'invalid_customer_country');
  const tooMany = Array.from({ length: CUSTOMER_COUNTRIES_MAX + 1 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)));
  assert.equal((await call(f, 'POST', '', { ...FULL, customer_countries: tooMany })).body.error, 'too_many_customer_countries');
  assert.equal((await call(f, 'POST', '', { ...FULL, market_slug: 'not-a-market' })).body.error, 'unknown_market');
  assert.equal(count(f, 'research_competitive_contexts'), 1);
});

test('a value over a shared limit is refused, never truncated', async () => {
  const f = fixture();
  for (const [field, limit] of [
    ['product', STUDY_LIMITS.product], ['business_model', STUDY_LIMITS.business_model], ['buyer', SEGMENT_LIMITS.buyer],
    ['delivery_model', CONTEXT_LIMITS.delivery_model], ['purpose', CONTEXT_LIMITS.purpose], ['name', CONTEXT_LIMITS.name],
  ] as Array<[string, number]>) {
    const over = await call(f, 'POST', '', { ...FULL, [field]: 'x'.repeat(limit + 1) });
    assert.deepEqual([over.status, over.body.error], [400, `${field}_too_long`], field);
    const at = await call(f, 'POST', '', { ...FULL, [field]: 'x'.repeat(limit) });
    assert.equal(at.status, 201, field);
    assert.equal(at.body[field], 'x'.repeat(limit));
  }
  assert.equal((await call(f, 'POST', '', { ...FULL, name: '  ' })).body.error, 'name_required');
});

test('one member keeps a bounded number of contexts', async () => {
  const f = fixture();
  const insert = f.db.prepare(`INSERT INTO research_competitive_contexts (uid, owner_user_id, name) VALUES (?, ${OWNER}, 'N')`);
  for (let i = 0; i < CONTEXTS_PER_OWNER_MAX; i += 1) insert.run(`ctx-limit-${String(i).padStart(4, '0')}`);
  const r = await call(f, 'POST', '', FULL);
  assert.deepEqual([r.status, r.body.error], [409, 'context_limit']);
  assert.equal(count(f, 'research_competitive_context_versions'), 0, 'no version without its context');
  assert.equal((await call(f, 'POST', '', FULL, OTHER)).status, 201, 'the limit is per member');
});
