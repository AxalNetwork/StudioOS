/**
 * D7825 (#7825): record identity of Research company and fund records (`routes/research_record_identity.ts`,
 * `services/researchRecordIdentity.ts`, migration 202611222146_7825). Real schema (`loadSchema`), the real router and
 * D7819/D7178/D7166 reads it answers through; synthetic records only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_record_identity_7825.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import identity, { mount } from '../src/routes/research_record_identity.ts';
import { identityForMatching, SCHEMES } from '../src/services/researchRecordIdentity.ts';
import { readCompanyByUid } from '../src/services/researchCompanyRead.ts';
import { MAINTENANCE_WRITERS, PENDING_READERS, checkReaders } from './research_company_read_guard_7819.test.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d7825-record-identity-0123456789';
const ADMIN = 1, FOUNDER = 2, INVESTOR = 3;
const PROOF = 'https://evidence.example.test/domain-review/1';
const SELF = 'cloudflare-worker/src/services/researchRecordIdentity.ts';
const MIGRATION = readFileSync(resolve(import.meta.dirname, '../sql/migrations/202611222146_7825_research_record_identity.sql'), 'utf8');

const COMPANIES: [string, string, string][] = [
  ['ch-01234567', 'SYNTHETIC LEDGER LIMITED', 'https://www.ledger.example.test/'],
  ['q987654321', 'Synthetic Wiki Co', 'https://wiki-co.example.test'],
  ['no-brreg:999888777', 'Syntetisk AS', 'https://syntetisk.example.test'],
  ['fi-prh:9999999-9', 'Synteettinen Oy', 'https://synteettinen.example.test'],
  ['ee-rik:99999999', 'Sünteetiline OÜ', 'https://synteetiline.example.test'],
  ['acme-7825', 'Acme Undefined Form', 'https://acme.example.test'],
  ['twin-a', 'Twin Alpha', 'https://twins.example.test'],
  ['twin-b', 'Twin Beta', 'https://twins.example.test'],
  ['held-7825', 'Held Co', 'https://held.example.test'],
  ['gone-7825', 'Withdrawn Co', 'https://gone.example.test'],
];

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example');
  u.run(FOUNDER, 'founder', 'Fay', 'fay@co.example');
  u.run(INVESTOR, 'investor', 'Ivo', 'ivo@angel.example');
  const add = db.prepare(`INSERT INTO research_company_directory(uid,name,website,source_url,source_name,source_license,as_of)
    VALUES (?,?,?,'https://source.example.test/record','Synthetic publisher','Synthetic terms','2026-01-01')`);
  for (const [uid, name, site] of COMPANIES) add.run(uid, name, site);
  const review = db.prepare(`INSERT INTO research_company_reviews(uid,status,reason_code,reviewer,reviewed_on) VALUES (?,?,?,9,'2026-02-01 00:00:00')`);
  review.run('held-7825', 'held', 'quality_hold');
  review.run('gone-7825', 'withdrawn', 'source_withdrawn');
  db.exec(`INSERT INTO research_fund_sources (source_name,title,terms_status,evidence,verdict,verdict_reason,reviewed_on)
    VALUES ('Synthetic open list','Open','not found','x','cite only','x','2026-01-01'), ('Synthetic withdrawn list','Gone','not found','x','not allowed','Terms forbid republication','2026-01-01');
    INSERT INTO research_fund_directory (uid,name,website,source_name,source_url,as_of) VALUES
      ('fund-7825','Synthetic Fund I','https://fund.example.test','Synthetic open list','https://list.example.test','2026-01-01'),
      ('fund-gone-7825','Withdrawn Fund','https://gone-fund.example.test','Synthetic withdrawn list','https://list.example.test','2026-01-01');
    INSERT INTO research_fund_directory_uid_moves (old_uid,new_uid,moved_on) VALUES ('fund-old-7825','fund-7825','2026-03-01');`);
  db.exec(MIGRATION); // the backfill, run again over the fixture's rows (idempotent: IF NOT EXISTS, OR IGNORE)
  return db;
}

const app = new Hono<any>();
app.route(mount.path, identity);

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role;
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t${mount.path}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) { if (e instanceof Response) res = e; else throw e; }
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [w, e] = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { console.warn = w; console.error = e; }
};
const read = (db: DatabaseSync, uid: string, who = FOUNDER, kind = 'company') => quiet(() => call(db, who, 'GET', `/${kind}/${encodeURIComponent(uid)}`));
const admin = (db: DatabaseSync, method: string, path: string, body?: unknown) => quiet(() => call(db, ADMIN, method, path, body));
const env = (db: DatabaseSync) => ({ DB: d1Over(db) }) as any;

test('backfill: Companies House gives its number and legal name; Wikidata its id and no legal name; the registers theirs', async () => {
  const db = fixture();
  const ch = await read(db, 'ch-01234567');
  assert.equal(ch.status, 200, ch.text);
  assert.deepEqual(ch.body.identifiers.map((i: any) => [i.scheme, i.value]), [['gb_companies_house', '01234567']]);
  assert.equal(ch.body.legal_name, 'SYNTHETIC LEDGER LIMITED');
  const wd = await read(db, 'q987654321');
  assert.deepEqual(wd.body.identifiers.map((i: any) => [i.scheme, i.value]), [['wikidata', 'Q987654321']]);
  assert.equal(wd.body.legal_name, null);
  assert.equal(wd.body.legal_name_label, 'Not recorded');
  for (const [uid, scheme, value] of [['no-brreg:999888777', 'no_brreg', '999888777'], ['fi-prh:9999999-9', 'fi_prh', '9999999-9'], ['ee-rik:99999999', 'ee_rik', '99999999']]) {
    const r = await read(db, uid);
    assert.deepEqual(r.body.identifiers.map((i: any) => [i.scheme, i.value]), [[scheme, value]], uid);
    assert.equal(r.body.legal_name, COMPANIES.find((c) => c[0] === uid)![1], `${uid}: the register's name is its legal name`);
  }
});

test('a record whose uid form is not defined reads Not recorded, and is counted', async () => {
  const db = fixture();
  const r = await read(db, 'acme-7825');
  assert.equal(r.body.recorded, false);
  assert.equal(r.body.not_recorded, 'Not recorded');
  assert.deepEqual([r.body.names, r.body.identifiers], [[], []]);
  const uncounted: any = db.prepare(`SELECT COUNT(*) AS n FROM research_company_directory d WHERE d.uid IN (${COMPANIES.map(() => '?').join(',')})
    AND NOT EXISTS (SELECT 1 FROM research_record_identifiers i WHERE i.record_kind='company' AND i.record_uid=d.uid)`).get(...COMPANIES.map((c) => c[0]));
  assert.equal(uncounted.n, 5, 'acme, the twins, held and withdrawn have no uid form main defines');
  assert.match(MIGRATION, /Every other company record, and every fund, gets no row and reads "Not recorded"\. How many:/);
  const fund = await read(db, 'fund-7825', FOUNDER, 'fund');
  assert.equal(fund.body.not_recorded, 'Not recorded', 'no fund is backfilled');
});

test('a match key is stored and never returned as a name; the matching function returns keys, identifiers and reviewed hosts', async () => {
  const db = fixture();
  const added = await admin(db, 'POST', '/company/acme-7825/names', { name_type: 'match_key', name: 'acmeundefinedform', source_name: 'Axal normaliser' });
  assert.equal(added.status, 201, added.text);
  await admin(db, 'POST', '/company/acme-7825/names', { name_type: 'alias', name: 'Acme', source_name: 'Synthetic publisher', source_url: 'https://source.example.test/a' });
  await admin(db, 'POST', '/company/acme-7825/identifiers', { scheme: 'lei', value: '5299000SYNTHETIC0001', source_name: 'Synthetic LEI list' });
  await admin(db, 'POST', '/company/acme-7825/domains', { host: 'acme.example.test', state: 'reviewed', proof_url: PROOF, note: 'PRIVATE_NOTE' });
  const member = await read(db, 'acme-7825');
  assert.deepEqual(member.body.names.map((n: any) => [n.name_type, n.name]), [['alias', 'Acme']]);
  assert.doesNotMatch(member.text, /acmeundefinedform/);
  const m = (await identityForMatching(env(db), 'company', ['acme-7825'])).get('acme-7825')!;
  assert.deepEqual(m.match_keys, ['acmeundefinedform']);
  assert.deepEqual(m.identifiers, [{ scheme: 'lei', value: '5299000SYNTHETIC0001' }]);
  assert.deepEqual(m.reviewed_hosts, ['acme.example.test']);
});

test('domains: the recorded website reads not reviewed; an admin review with proof sets the profile’s verified date; a rejection clears it; another host never sets it', async () => {
  const db = fixture();
  const before = await read(db, 'ch-01234567');
  assert.deepEqual(before.body.domains, [{ host: 'ledger.example.test', review_state: 'not_reviewed', reviewed_on: null, proof_url: null, from: 'recorded_website' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_record_domains').get().n, 0, 'no row is copied from the website column');

  const other = await admin(db, 'POST', '/company/ch-01234567/domains', { host: 'elsewhere.example.test', state: 'reviewed', proof_url: PROOF });
  assert.equal(other.status, 200, other.text);
  assert.equal((await readCompanyByUid(env(db), 'ch-01234567') as any).website_verified_at, null, 'another host never sets it');

  const ok = await admin(db, 'POST', '/company/ch-01234567/domains', { host: 'WWW.Ledger.Example.Test', state: 'reviewed', proof_url: PROOF, note: 'PRIVATE_NOTE' });
  assert.equal(ok.status, 200, ok.text);
  const profile: any = await readCompanyByUid(env(db), 'ch-01234567');
  assert.ok(profile.website_verified_at, 'the profile answers verified');
  assert.equal(profile.dates.verified, profile.website_verified_at, 'with that date');
  const after = await read(db, 'ch-01234567');
  const row = after.body.domains.find((d: any) => d.host === 'ledger.example.test');
  assert.deepEqual(Object.keys(row).sort(), ['host', 'proof_url', 'review_state', 'reviewed_on']);
  assert.equal(row.review_state, 'reviewed');
  assert.ok(row.reviewed_on);
  assert.doesNotMatch(after.text, /PRIVATE_NOTE|"reviewer"/, 'never the reviewer or the note');

  const rejected = await admin(db, 'POST', '/company/ch-01234567/domains', { host: 'ledger.example.test', state: 'rejected', proof_url: PROOF });
  assert.equal(rejected.status, 200);
  assert.equal((await readCompanyByUid(env(db), 'ch-01234567') as any).website_verified_at, null, 'a rejection clears it');
  await admin(db, 'POST', '/company/ch-01234567/domains', { host: 'ledger.example.test', state: 'reviewed', proof_url: PROOF });
  await admin(db, 'POST', '/company/ch-01234567/domains', { host: 'ledger.example.test', state: 'not_reviewed' });
  assert.equal((await readCompanyByUid(env(db), 'ch-01234567') as any).website_verified_at, null, 'a withdrawn review clears it');

  const noProof = await admin(db, 'POST', '/company/ch-01234567/domains', { host: 'ledger.example.test', state: 'reviewed' });
  assert.equal(noProof.status, 400, 'a review needs proof');
});

test('two records sharing a name, identifier or host stay two; the read of one names no other', async () => {
  const db = fixture();
  for (const uid of ['twin-a', 'twin-b']) {
    assert.equal((await admin(db, 'POST', `/company/${uid}/names`, { name_type: 'brand', name: 'Twins', source_name: 'Synthetic publisher' })).status, 201);
    assert.equal((await admin(db, 'POST', `/company/${uid}/identifiers`, { scheme: 'lei', value: '5299000TWINS00000001', source_name: 'Synthetic LEI list' })).status, 201);
    assert.equal((await admin(db, 'POST', `/company/${uid}/domains`, { host: 'twins.example.test', state: 'reviewed', proof_url: PROOF })).status, 200);
  }
  const a = await read(db, 'twin-a');
  assert.equal(a.body.uid, 'twin-a');
  assert.doesNotMatch(a.text, /twin-b/);
  assert.equal(db.prepare("SELECT COUNT(DISTINCT uid) AS n FROM research_company_directory WHERE uid IN ('twin-a','twin-b')").get().n, 2);
});

test('access: the read answers as the record’s own profile route does for each account', async () => {
  const db = fixture();
  // Outside the Companies rule: one refusal, the same for an existing and a missing record, with no identity field.
  const there = await read(db, 'ch-01234567', INVESTOR);
  const missing = await read(db, 'ch-nowhere', INVESTOR);
  assert.equal(there.status, 403);
  assert.deepEqual(there.body, missing.body);
  assert.equal(there.body.error, 'companies_licence_required');
  assert.doesNotMatch(there.text, /identifiers|legal_name|domains|SYNTHETIC/);
  // A held company is served, with its identity; a withdrawn one answers its state only.
  assert.equal((await read(db, 'held-7825')).status, 200);
  const gone = await read(db, 'gone-7825');
  assert.equal(gone.status, 410);
  assert.equal(gone.body.review_status, 'withdrawn');
  assert.doesNotMatch(gone.text, /identifiers|legal_name|domains|gone\.example/);
  assert.equal((await read(db, 'ch-nowhere')).status, 404);
  // Funds: the catalogue's rule (signed in), SERVED_FUNDS, a withdrawn list, a moved uid one hop.
  assert.equal((await read(db, 'fund-7825', INVESTOR, 'fund')).status, 200, 'the fund catalogue admits any signed-in account');
  const removed = await read(db, 'fund-gone-7825', FOUNDER, 'fund');
  assert.equal(removed.status, 410);
  assert.equal(removed.body.error, 'source_withdrawn');
  assert.doesNotMatch(removed.text, /identifiers|domains|gone-fund/);
  const moved = await read(db, 'fund-old-7825', FOUNDER, 'fund');
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.body.uid, moved.body.moved_from], ['fund-7825', 'fund-old-7825']);
  assert.equal((await read(db, 'x', FOUNDER, 'person')).status, 404);
});

test('a non-admin write is refused; each admin write is in the admin audit log', async () => {
  const db = fixture();
  const writes: [string, string, unknown][] = [
    ['POST', '/company/acme-7825/names', { name_type: 'alias', name: 'X', source_name: 'S' }],
    ['PATCH', '/company/acme-7825/names/1', { name_type: 'alias', name: 'X', source_name: 'S' }],
    ['DELETE', '/company/acme-7825/names/1', undefined],
    ['POST', '/company/acme-7825/identifiers', { scheme: 'lei', value: 'X', source_name: 'S' }],
    ['PATCH', '/company/acme-7825/identifiers/1', { scheme: 'lei', value: 'X', source_name: 'S' }],
    ['DELETE', '/company/acme-7825/identifiers/1', undefined],
    ['POST', '/company/acme-7825/domains', { host: 'acme.example.test', state: 'reviewed', proof_url: PROOF }],
  ];
  for (const [method, path, body] of writes) {
    const r = await quiet(() => call(db, FOUNDER, method, path, body));
    assert.ok([401, 403].includes(r.status), `${method} ${path} → ${r.status}`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_record_names WHERE record_uid='acme-7825'").get().n, 0);

  const name = await admin(db, 'POST', '/company/acme-7825/names', { name_type: 'former', name: 'Acme Old', source_name: 'Synthetic publisher' });
  await admin(db, 'PATCH', `/company/acme-7825/names/${name.body.id}`, { name_type: 'former', name: 'Acme Older', source_name: 'Synthetic publisher' });
  const id = await admin(db, 'POST', '/company/acme-7825/identifiers', { scheme: 'lei', value: '5299000ACME000000001', source_name: 'Synthetic LEI list' });
  await admin(db, 'PATCH', `/company/acme-7825/identifiers/${id.body.id}`, { scheme: 'lei', value: '5299000ACME000000002', source_name: 'Synthetic LEI list' });
  await admin(db, 'DELETE', `/company/acme-7825/identifiers/${id.body.id}`);
  await admin(db, 'DELETE', `/company/acme-7825/names/${name.body.id}`);
  await admin(db, 'POST', '/company/acme-7825/domains', { host: 'acme.example.test', state: 'reviewed', proof_url: PROOF });
  const log = (db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'research_record_%' ORDER BY id").all() as any[]).map((r) => r.action);
  assert.deepEqual(log, ['research_record_name_add', 'research_record_name_correct', 'research_record_identifier_add', 'research_record_identifier_correct',
    'research_record_identifier_remove', 'research_record_name_remove', 'research_record_domain_review']);
  assert.equal((await admin(db, 'POST', '/company/ch-nowhere/names', { name_type: 'alias', name: 'X', source_name: 'S' })).status, 404, 'a missing record is refused');
  assert.equal((await admin(db, 'POST', '/company/acme-7825/identifiers', { scheme: 'network_directory', value: '1', source_name: 'S' })).status, 400, 'no Network id scheme');
});

test('the scheme list holds no Network or source-list id; nothing here touches a network_directory_* table', () => {
  assert.ok(!SCHEMES.some((s) => /network|list|source/.test(s)));
  for (const p of ['../src/services/researchRecordIdentity.ts', '../src/routes/research_record_identity.ts']) {
    const src = readFileSync(resolve(import.meta.dirname, p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /network_directory_/, p);
  }
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ''), /network_directory_/);
});

test('the guard lists this service as a maintenance writer, fails without that line, and its pending list is unchanged', () => {
  assert.ok(MAINTENANCE_WRITERS.includes(SELF));
  assert.ok(!PENDING_READERS.includes(SELF));
  const service = readFileSync(resolve(import.meta.dirname, '../src/services/researchRecordIdentity.ts'), 'utf8');
  assert.deepEqual(checkReaders({ [SELF]: service }, PENDING_READERS, [SELF]).filter((e) => e.includes('researchRecordIdentity')), []);
  assert.match(checkReaders({ [SELF]: service }, PENDING_READERS, []).join('\n'), /New physical directory reference.*researchRecordIdentity\.ts/);
});
