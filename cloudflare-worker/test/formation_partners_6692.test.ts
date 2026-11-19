/**
 * D6692 (#6692, P1 of #6680) — the formation partner registry at
 * /api/admin/formation/partners, on the migrated schema (baseline plus every
 * migration, 202611151734_6692_formation_partners.sql included).
 *
 *   1. the schema: five tables with their checks and the one-live-member index;
 *   2. reads need `requireHqAdmin`: signed out 401, a member 403, a branch 403;
 *   3. verify, suspend, end and `cost_minor` need the Super Admin behind
 *      `requireSuperAdminWriteBar`: a plain Admin is refused
 *      `super_admin_required`, a Super Admin without the bar is refused;
 *   4. `cost_minor` is never returned to a plain Admin; `founder_price_minor` is;
 *   5. coverage on is refused `partner_not_verified`, `credential_missing` and
 *      `credential_expired`, and allowed with a current licence;
 *   6. verify without `dpa_signed_on` is refused `dpa_missing`;
 *   7. a suspension switches coverage off in the same batch as the status;
 *   8. every write records its action through `logAdminAction`.
 *
 * Every firm, person, licence and price is made up. Dates are fixed far in
 * the past or the future, so no clock is read here.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_partners_6692.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router, { mount } from '../src/routes/admin_formation_partners.ts';
import { FORMATION_PARTNER_ACTIONS, statusChangeBatch } from '../src/services/formationPartners.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'formation-partners-6692-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, SCHEMA_OPTIONS);
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

const JWT_SECRET = 'synthetic-6692-only-not-a-real-credential'.repeat(2);
const SUPER = 1; const ADMIN = 2; const MEMBER = 3; const STAFF = 4;
const BASE = '/api/admin/formation/partners';
const PAST = '2000-01-01';
const FUTURE = '2999-12-31';
let n = 0;

function fixture(env: Record<string, unknown> = {}) {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, SCHEMA_OPTIONS);
  const user = db.prepare('INSERT INTO users(id, email, name, role) VALUES (?, ?, ?, ?)');
  user.run(SUPER, 'super@example.invalid', 'Sam Super', 'admin');
  user.run(ADMIN, 'plain@example.invalid', 'Pat Plain', 'admin');
  user.run(MEMBER, 'member@example.invalid', 'Mo Member', 'founder');
  user.run(STAFF, 'staff@example.invalid', 'Sky Staff', 'partner');
  db.prepare('DELETE FROM super_admins').run();
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO partners(id, uid, name, company, email) VALUES (10, 'firm-a', 'Made-up Formations', 'Made-up Formations Ltd', 'firm-a@example.invalid')").run();
  db.prepare("INSERT INTO partners(id, uid, name, email) VALUES (11, 'firm-b', 'Fictional Filings', 'firm-b@example.invalid')").run();
  db.prepare("INSERT INTO partner_deals(id, deal_type, proposal_json) VALUES (20, 'services_partnership', '{}')").run();
  db.prepare("INSERT INTO documents(id, title) VALUES (30, 'Synthetic data agreement')").run();
  const jti = grantWriteBar(db, SUPER);
  const DB = d1Over(db) as any;
  const batches: number[] = [];
  const batch = DB.batch.bind(DB);
  DB.batch = async (stmts: unknown[]) => { batches.push(stmts.length); return batch(stmts); };
  const app = new Hono<any>().route(BASE, router);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, batches, jti, env: { DB, JWT_SECRET, ENVIRONMENT: 'development', ...env } as any };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number | null, method: string, path: string, body?: unknown, opts: { bar?: boolean } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who !== null) {
    const claims: Record<string, unknown> = { user_id: who };
    if (opts.bar) claims.jti = f.jti;
    headers.Authorization = `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await f.app.request(`${BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const actions = (f: F) => (f.db.prepare('SELECT action FROM admin_audit_log ORDER BY id').all() as any[]).map((r) => r.action);
const coverageOn = (f: F, uid: string) => Number((f.db.prepare('SELECT is_on FROM formation_partner_coverage WHERE uid = ?').get(uid) as any).is_on);

/** A registered draft partner with a GB coverage row, as the plain Admin made it. */
async function draft(f: F) {
  const made = await call(f, ADMIN, 'POST', '', { partner_uid: 'firm-a', deal_id: 20 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const uid = made.body.uid as string;
  const cov = await call(f, ADMIN, 'POST', `/${uid}/coverage`, { country: 'GB', form_key: 'gb_private_limited', service: 'formation', target_hours: 48 });
  assert.equal(cov.status, 201, JSON.stringify(cov.body));
  return { uid, coverageUid: cov.body.coverage[0].uid as string };
}
const DPA = { data_role: 'processor', dpa_document_id: 30, dpa_signed_on: '2026-01-15', transfer_mechanism: 'Standard contractual clauses', deletion_contact: 'privacy@example.invalid' };
const VERIFY = { what_was_checked: 'Licence register entry and the signed data agreement (synthetic).', next_review_on: FUTURE };

test('1. the migration: five tables, their checks, and one live membership per user', () => {
  const f = fixture();
  const cols = (t: string) => (f.db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  assert.ok(['partner_id', 'status', 'deal_id', 'verified_by', 'verified_at', 'what_was_checked', 'next_review_on', 'data_role',
    'dpa_document_id', 'dpa_signed_on', 'transfer_mechanism', 'retention_terms', 'deletion_contact', 'restricted_places_json']
    .every((c) => cols('formation_partners').includes(c)), 'formation_partners carries the issue’s columns');
  assert.ok(['country', 'licence_type', 'licence_number', 'regulator', 'valid_until', 'evidence_document_id', 'checked_by', 'checked_on']
    .every((c) => cols('formation_partner_credentials').includes(c)));
  assert.ok(['country', 'form_key', 'service', 'target_hours', 'priority', 'is_on'].every((c) => cols('formation_partner_coverage').includes(c)));
  assert.ok(['coverage_id', 'founder_price_minor', 'cost_minor', 'currency', 'cadence', 'effective_from', 'effective_to']
    .every((c) => cols('formation_partner_prices').includes(c)));
  assert.ok(['user_id', 'role', 'granted_by', 'revoked_at'].every((c) => cols('formation_partner_members').includes(c)));
  f.db.prepare("INSERT INTO formation_partners(id, partner_id) VALUES (1, 10)").run();
  assert.throws(() => f.db.prepare("INSERT INTO formation_partners(partner_id, status) VALUES (11, 'approved')").run(), /CHECK/, 'status is one of four');
  assert.throws(() => f.db.prepare("INSERT INTO formation_partners(partner_id) VALUES (10)").run(), /UNIQUE/, 'a firm registers once');
  assert.throws(() => f.db.prepare("INSERT INTO formation_partner_coverage(formation_partner_id, country, form_key, service) VALUES (1, 'GB', 'x_form', 'notary')").run(), /CHECK/);
  f.db.prepare("INSERT INTO formation_partner_members(formation_partner_id, user_id, role) VALUES (1, 4, 'staff')").run();
  assert.throws(() => f.db.prepare("INSERT INTO formation_partner_members(formation_partner_id, user_id, role) VALUES (1, 4, 'lead')").run(), /UNIQUE/);
  f.db.prepare("UPDATE formation_partner_members SET revoked_at = datetime('now')").run();
  f.db.prepare("INSERT INTO formation_partner_members(formation_partner_id, user_id, role) VALUES (1, 4, 'lead')").run();
  f.db.close();
});

test('2. it mounts itself, reads need an HQ admin, and a branch is refused', async () => {
  // Mutation checked: the requireHqAdmin call removed from GET / → signed out and the member both read (200 ≠ 401, 403).
  assert.deepEqual([mount.path, mount.router === router], [BASE, true]);
  const f = fixture();
  assert.equal((await call(f, null, 'GET', '')).status, 401);
  assert.equal((await call(f, MEMBER, 'GET', '')).status, 403);
  const { uid } = await draft(f);
  assert.equal((await call(f, MEMBER, 'GET', `/${uid}`)).status, 403);
  const list = await call(f, ADMIN, 'GET', '');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((x: any) => [x.uid, x.status, x.partner.uid, x.coverage_total, x.coverage_on]), [[uid, 'draft', 'firm-a', 1, 0]]);
  assert.equal((await call(f, ADMIN, 'GET', `/${uid}`)).status, 200);
  assert.equal((await call(f, ADMIN, 'GET', '/nope')).body.error, 'formation_partner_not_found');
  f.db.close();

  const b = fixture({ BRANCH_CODE: 'synthetic-branch' });
  for (const [method, path, body] of [['GET', '', undefined], ['POST', '', { partner_uid: 'firm-a' }]] as const) {
    const res = await call(b, SUPER, method, path, body, { bar: true });
    assert.deepEqual([res.status, res.body.detail], [403, 'HQ only'], `${method} on a branch`);
  }
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM formation_partners').get()!.n, 0);
  b.db.close();
});

test('3. verify, suspend, end and cost_minor are the Super Admin’s, behind the write bar', async () => {
  // Mutation checked: superAdminWrite skipping requireSuperAdminWriteBar → the bar-less Super Admin verifies (200 ≠ 403);
  // the cost_minor gate removed from POST prices → the plain Admin's cost is stored (201 ≠ 403).
  const f = fixture();
  const { uid, coverageUid } = await draft(f);
  await call(f, ADMIN, 'PATCH', `/${uid}/data-terms`, DPA);
  for (const [path, body] of [[`/${uid}/verify`, VERIFY], [`/${uid}/suspend`, { reason: 'Synthetic.' }], [`/${uid}/end`, { reason: 'Synthetic.' }]] as const) {
    const plain = await call(f, ADMIN, 'POST', path, body);
    assert.deepEqual([plain.status, plain.body.error], [403, 'super_admin_required'], `plain Admin: ${path}`);
    const noBar = await call(f, SUPER, 'POST', path, body);
    assert.equal(noBar.status, 403, `Super Admin without the bar: ${path}`);
  }
  assert.equal(f.db.prepare('SELECT status FROM formation_partners WHERE uid = ?').get(uid)!.status, 'draft', 'nothing changed');

  const price = { founder_price_minor: 49_900, currency: 'USD', cadence: 'one_time', effective_from: '2026-01-01' };
  const plainCost = await call(f, ADMIN, 'POST', `/${uid}/coverage/${coverageUid}/prices`, { ...price, cost_minor: 20_000 });
  assert.deepEqual([plainCost.status, plainCost.body.error], [403, 'super_admin_required']);
  assert.equal((await call(f, SUPER, 'POST', `/${uid}/coverage/${coverageUid}/prices`, { ...price, cost_minor: 20_000 })).status, 403, 'no bar');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM formation_partner_prices').get()!.n, 0);
  assert.equal((await call(f, ADMIN, 'POST', `/${uid}/coverage/${coverageUid}/prices`, price)).status, 201, 'a plain Admin sets the founder price');
  const withCost = await call(f, SUPER, 'POST', `/${uid}/coverage/${coverageUid}/prices`, { ...price, effective_from: '2027-01-01', cost_minor: 20_000 }, { bar: true });
  assert.equal(withCost.status, 201);
  const puid = withCost.body.coverage[0].prices[0].uid;
  assert.deepEqual([(await call(f, ADMIN, 'PATCH', `/${uid}/prices/${puid}`, { cost_minor: 1 })).body.error], ['super_admin_required']);
  assert.equal(f.db.prepare('SELECT cost_minor FROM formation_partner_prices WHERE uid = ?').get(puid)!.cost_minor, 20_000);
  f.db.close();
});

test('4. cost_minor is never returned to a plain Admin; founder_price_minor is', async () => {
  // Mutation checked: presentPrice ignoring `superAdmin` → the plain Admin's read carries cost_minor.
  const f = fixture();
  const { uid, coverageUid } = await draft(f);
  await call(f, SUPER, 'POST', `/${uid}/coverage/${coverageUid}/prices`,
    { founder_price_minor: 49_900, cost_minor: 20_000, currency: 'GBP', cadence: 'annual', effective_from: '2026-01-01' }, { bar: true });
  const plain = await call(f, ADMIN, 'GET', `/${uid}`);
  const p = plain.body.coverage[0].prices[0];
  assert.equal(p.founder_price_minor, 49_900);
  assert.equal(p.currency, 'GBP');
  assert.equal('cost_minor' in p, false, 'no cost_minor key at all, not a 0');
  // Each uid is 32 random hex characters and can hold "20000" by chance; the cost may not appear anywhere else.
  const outsideUids = JSON.stringify(plain.body).replace(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/g, '<uid>');
  assert.equal(outsideUids.includes('20000'), false, 'the cost appears nowhere in the body');
  assert.equal(plain.body.cost_visible, false);
  // A plain Admin's own write answers with the same read.
  const edited = await call(f, ADMIN, 'PATCH', `/${uid}/prices/${p.uid}`, { founder_price_minor: 45_000 });
  assert.equal(edited.status, 200);
  assert.equal('cost_minor' in edited.body.coverage[0].prices[0], false);
  const sup = await call(f, SUPER, 'GET', `/${uid}`);
  assert.deepEqual([sup.body.coverage[0].prices[0].cost_minor, sup.body.coverage[0].prices[0].founder_price_minor, sup.body.cost_visible], [20_000, 45_000, true]);
  f.db.close();
});

test('5. coverage is switched on only for a verified partner with a current licence for the country', async () => {
  // Mutation checked: coverageOnRefusal returning null → each refusal below is a 200; `>=` → `<` in the expiry test → the
  // current licence is refused and the expired one allowed.
  const f = fixture();
  const { uid, coverageUid } = await draft(f);
  const on = () => call(f, ADMIN, 'PATCH', `/${uid}/coverage/${coverageUid}`, { on: true });
  assert.deepEqual([(await on()).status, (await on()).body.error], [409, 'partner_not_verified']);
  await call(f, ADMIN, 'PATCH', `/${uid}/data-terms`, DPA);
  assert.equal((await call(f, SUPER, 'POST', `/${uid}/verify`, VERIFY, { bar: true })).status, 200);
  assert.deepEqual([(await on()).status, (await on()).body.error], [409, 'credential_missing']);
  const licence = { licence_type: 'Trust or company service provider', licence_number: 'SYN-0001', regulator: 'Synthetic Regulator' };
  await call(f, ADMIN, 'POST', `/${uid}/credentials`, { ...licence, country: 'FR', valid_until: FUTURE });
  assert.equal((await on()).body.error, 'credential_missing', 'a licence for another country does not count');
  const expired = await call(f, ADMIN, 'POST', `/${uid}/credentials`, { ...licence, country: 'GB', valid_until: PAST });
  assert.equal(expired.status, 201);
  assert.equal(expired.body.credentials.find((x: any) => x.country === 'GB').current, false);
  assert.deepEqual([(await on()).status, (await on()).body.error], [409, 'credential_expired']);
  assert.equal(coverageOn(f, coverageUid), 0);
  const gb = expired.body.credentials.find((x: any) => x.country === 'GB').uid;
  const renewed = await call(f, ADMIN, 'PATCH', `/${uid}/credentials/${gb}`, { valid_until: FUTURE, checked_on: '2026-11-01' });
  assert.equal(renewed.body.credentials.find((x: any) => x.uid === gb).current, true);
  const ok = await on();
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.coverage[0].on, true);
  assert.equal(coverageOn(f, coverageUid), 1);
  // Switching off never needs a licence.
  f.db.prepare("UPDATE formation_partner_credentials SET valid_until = ?").run(PAST);
  assert.equal((await call(f, ADMIN, 'PATCH', `/${uid}/coverage/${coverageUid}`, { on: false })).status, 200);
  assert.equal(coverageOn(f, coverageUid), 0);
  f.db.close();
});

test('6. verify is refused without a signed data agreement (dpa_missing)', async () => {
  // Mutation checked: verifyRefusal skipping the dpa_signed_on test → the first verify is a 200.
  const f = fixture();
  const { uid } = await draft(f);
  const refused = await call(f, SUPER, 'POST', `/${uid}/verify`, VERIFY, { bar: true });
  assert.deepEqual([refused.status, refused.body.error], [409, 'dpa_missing']);
  await call(f, ADMIN, 'PATCH', `/${uid}/data-terms`, { ...DPA, dpa_signed_on: null });
  assert.equal((await call(f, SUPER, 'POST', `/${uid}/verify`, VERIFY, { bar: true })).body.error, 'dpa_missing', 'a document without a signing day is not signed');
  assert.equal(f.db.prepare('SELECT status FROM formation_partners WHERE uid = ?').get(uid)!.status, 'draft');
  await call(f, ADMIN, 'PATCH', `/${uid}/data-terms`, DPA);
  const ok = await call(f, SUPER, 'POST', `/${uid}/verify`, VERIFY, { bar: true });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.status, ok.body.verification.by, ok.body.verification.what_was_checked], ['verified', SUPER, VERIFY.what_was_checked]);
  // A verified partner keeps its agreement.
  const cleared = await call(f, ADMIN, 'PATCH', `/${uid}/data-terms`, { dpa_signed_on: null });
  assert.deepEqual([cleared.status, cleared.body.error], [409, 'dpa_missing']);
  f.db.close();
});

test('7. a suspension switches coverage off in the same batch as the status change', async () => {
  // Mutation checked: the coverage statement dropped from statusChangeBatch → coverage stays on and the batch holds 1 statement;
  // its status guard removed → the no-op batch below switches coverage off.
  const f = fixture();
  const { uid, coverageUid } = await draft(f);
  await call(f, ADMIN, 'PATCH', `/${uid}/data-terms`, DPA);
  await call(f, SUPER, 'POST', `/${uid}/verify`, VERIFY, { bar: true });
  await call(f, ADMIN, 'POST', `/${uid}/credentials`, { country: 'GB', licence_type: 'Synthetic', licence_number: 'SYN-2', regulator: 'Synthetic Regulator', valid_until: FUTURE });
  assert.equal((await call(f, ADMIN, 'PATCH', `/${uid}/coverage/${coverageUid}`, { on: true })).status, 200);
  f.batches.length = 0;
  const res = await call(f, SUPER, 'POST', `/${uid}/suspend`, { reason: 'Synthetic licence review.' }, { bar: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(f.batches, [2], 'one batch: the status change and the coverage switch');
  assert.equal(res.body.status, 'suspended');
  assert.equal(res.body.coverage[0].on, false);
  assert.equal(coverageOn(f, coverageUid), 0);
  assert.equal((await call(f, ADMIN, 'PATCH', `/${uid}/coverage/${coverageUid}`, { on: true })).body.error, 'partner_not_verified');
  assert.equal((await call(f, SUPER, 'POST', `/${uid}/suspend`, { reason: 'Again.' }, { bar: true })).body.error, 'partner_not_verified');

  // The coverage statement acts only when the status statement before it took: a guarded no-op switches nothing off.
  f.db.prepare("UPDATE formation_partners SET status = 'verified'").run();
  f.db.prepare('UPDATE formation_partner_coverage SET is_on = 1').run();
  const id = f.db.prepare('SELECT id FROM formation_partners WHERE uid = ?').get(uid)!.id as number;
  const [status, coverage] = await f.env.DB.batch(statusChangeBatch(f.env, id, 'suspended', ['draft'], SUPER, 'Synthetic.'));
  assert.deepEqual([status.meta.changes, coverage.meta.changes, coverageOn(f, coverageUid)], [0, 0, 1]);
  f.db.close();
});

test('8. every write records its action through logAdminAction, and an end switches coverage off too', async () => {
  // Mutation checked: deleting the logAdminAction call in POST /:uid/members/:muid/revoke → member_revoked is missing.
  const f = fixture();
  const { uid, coverageUid } = await draft(f);
  await call(f, ADMIN, 'PATCH', `/${uid}`, { next_review_on: FUTURE });
  await call(f, ADMIN, 'PATCH', `/${uid}/data-terms`, { ...DPA, restricted_places: ['Synthetic Region'] });
  const cred = await call(f, ADMIN, 'POST', `/${uid}/credentials`, { country: 'GB', licence_type: 'Synthetic', licence_number: 'SYN-3', regulator: 'Synthetic Regulator', valid_until: FUTURE, evidence_document_id: 30 });
  await call(f, ADMIN, 'PATCH', `/${uid}/credentials/${cred.body.credentials[0].uid}`, { licence_number: 'SYN-4' });
  const price = await call(f, ADMIN, 'POST', `/${uid}/coverage/${coverageUid}/prices`, { founder_price_minor: 10_000, currency: 'USD', cadence: 'monthly', effective_from: '2026-01-01' });
  await call(f, ADMIN, 'PATCH', `/${uid}/prices/${price.body.coverage[0].prices[0].uid}`, { effective_to: '2026-12-31' });
  await call(f, SUPER, 'POST', `/${uid}/verify`, VERIFY, { bar: true });
  await call(f, ADMIN, 'PATCH', `/${uid}/coverage/${coverageUid}`, { on: true, priority: 10 });
  const member = await call(f, ADMIN, 'POST', `/${uid}/members`, { user_id: STAFF, role: 'lead' });
  assert.equal(member.status, 201);
  assert.equal((await call(f, ADMIN, 'POST', `/${uid}/members`, { user_id: STAFF, role: 'staff' })).body.error, 'member_exists');
  await call(f, ADMIN, 'POST', `/${uid}/members/${member.body.members[0].uid}/revoke`);
  await call(f, SUPER, 'POST', `/${uid}/suspend`, { reason: 'Synthetic.' }, { bar: true });
  // Verified again from suspended, coverage switched back on, then ended.
  assert.equal((await call(f, SUPER, 'POST', `/${uid}/verify`, VERIFY, { bar: true })).status, 200);
  assert.equal((await call(f, ADMIN, 'PATCH', `/${uid}/coverage/${coverageUid}`, { on: true })).status, 200);
  f.batches.length = 0;
  const ended = await call(f, SUPER, 'POST', `/${uid}/end`, { reason: 'Synthetic end.' }, { bar: true });
  assert.equal(ended.status, 200);
  assert.deepEqual([ended.body.status, ended.body.coverage[0].on, coverageOn(f, coverageUid), f.batches], ['ended', false, 0, [2]]);
  assert.equal((await call(f, ADMIN, 'POST', `/${uid}/coverage`, { country: 'GB', form_key: 'gb_llp', service: 'formation' })).body.error, 'partner_ended');

  assert.deepEqual([...new Set(actions(f))].sort(), [...FORMATION_PARTNER_ACTIONS].sort(), 'every action, each recorded');
  const added = f.db.prepare("SELECT admin_user_id, viewed_user_id FROM admin_audit_log WHERE action = 'formation_partner.member_added'").get() as any;
  assert.deepEqual([added.admin_user_id, added.viewed_user_id], [ADMIN, STAFF], 'the actor and the member it names');
  // A refused write records nothing.
  const before = actions(f).length;
  await call(f, ADMIN, 'POST', '', { partner_uid: 'firm-a' });
  await call(f, ADMIN, 'POST', '', { partner_uid: 'firm-missing' });
  assert.equal(actions(f).length, before);
  f.db.close();
});

test('9. bad input is refused with a code and stores nothing', async () => {
  const f = fixture();
  const { uid, coverageUid } = await draft(f);
  const cases: Array<[string, string, unknown, string]> = [
    ['POST', '', { partner_uid: 'firm-a' }, 'formation_partner_exists'],
    ['POST', '', { partner_uid: 'firm-b', deal_id: 999 }, 'deal_not_found'],
    ['POST', `/${uid}/coverage`, { country: 'gb', form_key: 'gb_ltd', service: 'formation' }, 'invalid_country'],
    ['POST', `/${uid}/coverage`, { country: 'GB', form_key: 'GB Ltd', service: 'formation' }, 'invalid_form_key'],
    ['POST', `/${uid}/coverage`, { country: 'GB', form_key: 'gb_ltd', service: 'notary' }, 'unknown_service'],
    ['POST', `/${uid}/coverage`, { country: 'GB', form_key: 'gb_private_limited', service: 'formation' }, 'coverage_exists'],
    ['POST', `/${uid}/coverage/${coverageUid}/prices`, { founder_price_minor: 10.5, currency: 'USD', cadence: 'one_time', effective_from: '2026-01-01' }, 'invalid_price'],
    ['POST', `/${uid}/coverage/${coverageUid}/prices`, { founder_price_minor: 100, currency: 'usd', cadence: 'one_time', effective_from: '2026-01-01' }, 'invalid_currency'],
    ['POST', `/${uid}/credentials`, { country: 'GB', licence_type: 'x', licence_number: 'y', regulator: 'z', valid_until: '2026-02-30' }, 'invalid_date'],
    ['PATCH', `/${uid}/data-terms`, { dpa_document_id: 999 }, 'document_not_found'],
    ['PATCH', `/${uid}/data-terms`, { data_role: 'owner' }, 'invalid_data_role'],
    ['POST', `/${uid}/members`, { user_id: 999, role: 'staff' }, 'user_not_found'],
  ];
  for (const [method, path, body, code] of cases) {
    const res = await call(f, ADMIN, method, path, body);
    assert.equal(res.body.error, code, `${method} ${path} ${JSON.stringify(body)}`);
    assert.ok(res.status >= 400 && res.status < 500);
  }
  assert.deepEqual([
    f.db.prepare('SELECT COUNT(*) AS n FROM formation_partners').get()!.n,
    f.db.prepare('SELECT COUNT(*) AS n FROM formation_partner_coverage').get()!.n,
    f.db.prepare('SELECT COUNT(*) AS n FROM formation_partner_prices').get()!.n,
    f.db.prepare('SELECT COUNT(*) AS n FROM formation_partner_credentials').get()!.n,
  ], [1, 1, 0, 0]);
  f.db.close();
});
