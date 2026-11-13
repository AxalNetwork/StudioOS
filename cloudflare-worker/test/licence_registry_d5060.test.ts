/**
 * D5060 (#5060, user licences 4/4) — HQ's Licences registry across every family, and the user licence
 * agreements in Contracts.
 *
 *   1. The family filter isolates operator, Founder, Investor, Operating Partner and Advisor licences; `all` is
 *      every row, and the counts are the registry's.
 *   2. A user licence row carries no territory field at all; an operator row carries its territory block.
 *   3. One agreement, one id: the registry row, the registry detail and Contracts name the same canonical
 *      agreement (the master licence contract's uid; a user licence agreement's envelope uuid), and Contracts
 *      lists each envelope once, with the licence type and holder on the row.
 *   4. Contracts filters by licence family, type, holder and territory; an unknown value is refused.
 *   5. Only a Super Admin reads the registry.
 *   6. Not recorded and Unreadable: a user licence's programs and billing are Not recorded with the reason; a
 *      database without the registry answers Not recorded, not an empty list; an agreement store that fails to
 *      read is Unreadable, never "none".
 *   7. The four templates read as Contracts' rows, authored or not.
 *
 * The database is the baseline plus every migration (`_schema_once.mjs`). Every studio, person and figure is
 * made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_registry_d5060.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import registryRoute from '../src/routes/admin_licence_registry.ts';
import contractsRoute from '../src/routes/admin_contracts.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, ADMIN = 2, FOUNDER = 5, ADVISOR = 6;
const LIVE = 'lic_live';
const SHA = (ch: string) => ch.repeat(64);

const BUILT = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const out = (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
  db.close();
  return out;
})();

const app = new Hono<any>();
app.route('/api/admin/licence-registry', registryRoute);
app.route('/api/admin/contracts', contractsRoute);

async function call(db: DatabaseSync, path: string, as = SUPER) {
  const token = await new SignJWT({ user_id: as, role: 'admin', jti: `totp-${as}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const ok = async (db: DatabaseSync, path: string) => {
  const r = await call(db, path);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/**
 * A territory licence (FR, master agreement executed); a Founder licence and an Investor licence held by one
 * account; an Advisor licence ending in ten days with no agreement. The founder's licence agreement was signed
 * twice (the first is history); the investor's is out for signature.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test');
  u.run(3, 'partner', 'Lee Licensee', 'lee@example.test');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test');
  u.run(ADVISOR, 'advisor', 'Avi Advisor', 'avi@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  // The territory licence; its shared row comes from D5057's insert trigger.
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on, created_at)
              VALUES (1, ?, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31', '2026-01-01T09:00:00Z')`).run(LIVE);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, completed_at, signed_r2_key, created_at)
              VALUES ('env-master', 3, 'subsidiary_licence_agreement', 'Subsidiary Licence Agreement', 'body', ?, 'completed', 1, '2026-09-01T00:00:00Z', 'esign/signed/m.pdf', '2026-08-20T00:00:00Z')`).run(SHA('m'));
  db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md, body_sha256, unfilled_fields, status, envelope_uid, created_at, updated_at, sent_at)
              VALUES ('lc-1', ?, 'subsidiary_licence_agreement', 3, 'Subsidiary Licence Agreement', 'body', ?, '[]', 'sent', 'env-master', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')`).run(LIVE, SHA('m'));
  // User licences: rows of their own in the shared registry.
  const lic = db.prepare(`INSERT INTO licences (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, starts_on, ends_on, created_at)
                          VALUES (?, ?, 'user', ?, 'user', ?, 'active', '2026-01-01', ?, '2026-01-01T00:00:00Z')`);
  lic.run('ulic_5_founder', 'USR-5-FOUNDER', 'founder', String(FOUNDER), null);
  lic.run('ulic_5_investor', 'USR-5-INVESTOR', 'investor', String(FOUNDER), null);
  lic.run('ulic_6_advisor', 'USR-6-ADVISOR', 'advisor', String(ADVISOR), inDays(10));
  // The founder licence agreement, signed twice; the investor one sent.
  const env = db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, completed_at, signed_r2_key, created_at)
                          VALUES (?, ?, ?, ?, 'body', ?, ?, 1, ?, ?, ?)`);
  env.run('env-founder-1', FOUNDER, 'founder_licence_agreement', 'Founder Licence Agreement', SHA('a'), 'completed', '2026-02-01T00:00:00Z', 'esign/signed/f1.pdf', '2026-01-20T00:00:00Z');
  env.run('env-founder-2', FOUNDER, 'founder_licence_agreement', 'Founder Licence Agreement', SHA('b'), 'completed', '2026-06-01T00:00:00Z', 'esign/signed/f2.pdf', '2026-05-20T00:00:00Z');
  // An amendment out for signature: newer, but the signed version stays the one in force until it is signed.
  env.run('env-founder-3', FOUNDER, 'founder_licence_agreement', 'Founder Licence Agreement', SHA('d'), 'sent', null, null, '2026-10-15T00:00:00Z');
  env.run('env-investor-1', FOUNDER, 'investor_licence_agreement', 'Investor Licence Agreement', SHA('c'), 'sent', null, null, '2026-10-01T00:00:00Z');
  return db;
}

test('1. the family filter isolates each licence family; the counts are the registry\'s', async () => {
  const db = fixture();
  const all = await ok(db, '/api/admin/licence-registry');
  assert.equal(all.available, true);
  assert.deepEqual(all.items.map((r: any) => r.licence_ref).sort(), ['AXL-001', 'USR-5-FOUNDER', 'USR-5-INVESTOR', 'USR-6-ADVISOR']);
  assert.equal(all.total, 4);
  assert.deepEqual(all.counts, { all: 4, operator: 1, founder: 1, investor: 1, operating_partner: 0, advisor: 1 });
  const refs = async (family: string) => (await ok(db, `/api/admin/licence-registry?family=${family}`)).items.map((r: any) => r.licence_ref);
  assert.deepEqual(await refs('operator'), ['AXL-001']);
  assert.deepEqual(await refs('founder'), ['USR-5-FOUNDER']);
  assert.deepEqual(await refs('investor'), ['USR-5-INVESTOR']);
  assert.deepEqual(await refs('advisor'), ['USR-6-ADVISOR']);
  const op = await ok(db, '/api/admin/licence-registry?family=operating_partner');
  assert.deepEqual(op.items, []);
  assert.equal(op.total, 0);
  // By holder: both of the founder account's licences, and nothing else.
  assert.deepEqual((await ok(db, `/api/admin/licence-registry?holder=user:${FOUNDER}`)).items.map((r: any) => r.licence_type), ['founder', 'investor']);
  // Search reaches the holder's name.
  assert.deepEqual((await ok(db, '/api/admin/licence-registry?q=avi')).items.map((r: any) => r.licence_ref), ['USR-6-ADVISOR']);
  // A page and its cursor.
  const p1 = await ok(db, '/api/admin/licence-registry?limit=2');
  const p2 = await ok(db, `/api/admin/licence-registry?limit=2&cursor=${p1.next_cursor}`);
  assert.deepEqual([...p1.items, ...p2.items].map((r: any) => r.licence_ref), ['AXL-001', 'USR-5-FOUNDER', 'USR-5-INVESTOR', 'USR-6-ADVISOR']);
  assert.equal(p2.next_cursor, null);
  for (const bad of ['family=administrator', 'holder=founder', 'cursor=nope', 'status=Active!']) {
    const r = await call(db, `/api/admin/licence-registry?${bad}`);
    assert.equal(r.status, 400, bad);
  }
});

test('2. a user licence row carries no territory field; an operator row carries its territory', async () => {
  const db = fixture();
  const { items } = await ok(db, '/api/admin/licence-registry');
  const operator = items.find((r: any) => r.licence_ref === 'AXL-001');
  assert.equal(operator.licence_family, 'operator');
  assert.equal(operator.territory.available, true);
  assert.deepEqual(operator.territory.countries, ['FR']);
  assert.equal(operator.holder.name, 'Studio North SAS');
  assert.equal(operator.renewal.on, '2027-10-31');
  for (const r of items.filter((x: any) => x.licence_family === 'user')) {
    assert.equal('territory' in r, false, `${r.licence_ref} has no territory field`);
    const flat = JSON.stringify(r);
    for (const field of ['countries', 'territory_licence_id', 'brand_name', 'legal_entity_name']) assert.equal(flat.includes(field), false, `${r.licence_ref}: ${field}`);
    assert.equal(r.holder.type, 'user');
  }
  const founder = items.find((r: any) => r.licence_ref === 'USR-5-FOUNDER');
  assert.equal(founder.holder.name, 'Fay Founder');
  assert.equal(founder.licence_type_label, 'Founder licence');
  // The advisor licence ends in ten days and has no agreement: both are attention.
  const advisor = items.find((r: any) => r.licence_ref === 'USR-6-ADVISOR');
  assert.deepEqual(advisor.attention.map((a: any) => a.code), ['renewal_due', 'agreement_not_executed']);
  assert.equal(advisor.agreement.state, 'none');
  assert.deepEqual(founder.attention, []);
  // The detail is shaped by the family.
  const detail = await ok(db, '/api/admin/licence-registry/ulic_5_founder');
  assert.equal(detail.layout, 'user');
  assert.equal('territory' in detail, false);
  assert.equal(detail.overview.account.email, 'fay@example.test');
  const opDetail = await ok(db, `/api/admin/licence-registry/${LIVE}`);
  assert.equal(opDetail.layout, 'operator');
  assert.deepEqual(opDetail.territory.countries, ['FR']);
  assert.equal(opDetail.operator_detail, `/api/admin/licences/${LIVE}`);
  assert.equal((await call(db, '/api/admin/licence-registry/no_such_licence')).status, 404);
});

test('3. one agreement, one id across the registry, its detail and Contracts; each envelope listed once', async () => {
  const db = fixture();
  const { items } = await ok(db, '/api/admin/licence-registry');
  const row = (ref: string) => items.find((r: any) => r.licence_ref === ref);
  assert.equal(row('AXL-001').agreement.agreement_uid, 'lc-1');
  assert.equal(row('AXL-001').agreement.state, 'executed');
  assert.equal(row('USR-5-FOUNDER').agreement.agreement_uid, 'env-founder-2', 'the agreement in force, not the one it replaced');
  assert.equal(row('USR-5-FOUNDER').agreement.state, 'executed');
  assert.equal(row('USR-5-INVESTOR').agreement.agreement_uid, 'env-investor-1');
  assert.equal(row('USR-5-INVESTOR').agreement.state, 'awaiting_signature');

  const detail = await ok(db, '/api/admin/licence-registry/ulic_5_founder');
  assert.deepEqual(detail.agreement.versions.items.map((v: any) => [v.agreement_uid, v.legal_status]),
    [['env-founder-1', 'superseded'], ['env-founder-2', 'executed'], ['env-founder-3', 'awaiting_signature']]);
  assert.equal(detail.agreement.primary.agreement_uid, 'env-founder-2');

  const contracts = (await ok(db, '/api/admin/contracts?limit=200')).items as any[];
  const envelopes = contracts.filter((r) => r.source === 'esign').map((r) => r.uid);
  assert.equal(new Set(envelopes).size, envelopes.length, 'no envelope listed twice');
  const userRows = contracts.filter((r) => r.agreement?.licence_family === 'user');
  assert.deepEqual(userRows.map((r) => r.uid).sort(), ['env-founder-1', 'env-founder-2', 'env-founder-3', 'env-investor-1']);
  for (const r of userRows) {
    assert.equal(r.source, 'esign', 'the envelope row itself, not a second row');
    assert.equal(r.agreement.agreement_uid, r.uid);
    assert.deepEqual(r.agreement.holder, { type: 'user', id: String(FOUNDER), name: 'Fay Founder' });
  }
  const founder2 = contracts.find((r) => r.uid === 'env-founder-2').agreement;
  assert.equal(founder2.licence_uid, 'ulic_5_founder');
  assert.equal(founder2.licence_type, 'founder');
  assert.equal(founder2.agreement_type, 'founder_licence');
  assert.equal(founder2.agreement_type_label, 'Founder Licence Agreement');
  assert.equal(contracts.find((r) => r.uid === 'env-founder-1').agreement.legal_status, 'superseded');
  assert.equal(contracts.find((r) => r.uid === 'env-investor-1').agreement.licence_uid, 'ulic_5_investor');
  // The master licence agreement names its operator licence and its holder too.
  const master = contracts.find((r) => r.uid === 'env-master').agreement;
  assert.equal(master.agreement_uid, 'lc-1');
  assert.equal(master.licence_family, 'operator');
  assert.equal(master.licence_type, 'territory');
  assert.equal(master.holder.name, 'Studio North SAS');
});

test('4. Contracts filters by licence family, type, holder and territory; an unknown value is refused', async () => {
  const db = fixture();
  const uids = async (q: string) => ((await ok(db, `/api/admin/contracts?limit=200&${q}`)).items as any[]).map((r) => r.uid).sort();
  assert.deepEqual(await uids('licence_family=user'), ['env-founder-1', 'env-founder-2', 'env-founder-3', 'env-investor-1']);
  assert.deepEqual(await uids('licence_family=operator'), ['env-master']);
  assert.deepEqual(await uids('licence_type=investor'), ['env-investor-1']);
  assert.deepEqual(await uids('agreement_type=founder_licence'), ['env-founder-1', 'env-founder-2', 'env-founder-3']);
  assert.deepEqual(await uids(`holder=user:${FOUNDER}&agreement_status=executed`), ['env-founder-2']);
  assert.deepEqual(await uids('territory=fr'), ['env-master']);
  assert.deepEqual(await uids('licence_type=advisor'), []);
  for (const bad of ['licence_family=administrator', 'licence_type=admin', 'holder=5', 'territory=FRA']) {
    const r = await call(db, `/api/admin/contracts?${bad}`);
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.field, bad.split('=')[0]);
  }
});

test('5. only a Super Admin reads the registry', async () => {
  const db = fixture();
  for (const path of ['/api/admin/licence-registry', '/api/admin/licence-registry/templates', '/api/admin/licence-registry/ulic_5_founder']) {
    const r = await call(db, path, ADMIN);
    assert.equal(r.status, 403, path);
    assert.equal(JSON.stringify(r.body).includes('Fay'), false);
    assert.equal((await call(db, path, SUPER)).status, 200, path);
  }
});

test('6. Not recorded and Unreadable are said, never zero or none', async () => {
  const db = fixture();
  const { items } = await ok(db, '/api/admin/licence-registry');
  const founder = items.find((r: any) => r.licence_ref === 'USR-5-FOUNDER');
  assert.equal(founder.programs.available, false);
  assert.equal(founder.programs.state, 'not_recorded');
  assert.match(founder.programs.reason, /#5059/);
  db.exec(`INSERT INTO program_licence_rules
    (uid, program_key, licence_type, version, eligible, agreement_required, effective_from, reason, origin)
    VALUES ('fixture-learning', 'learning', 'founder', 1, 1, 0, '2026-01-01', 'Registry test fixture.', 'hq')`);
  const detail = await ok(db, '/api/admin/licence-registry/ulic_5_founder');
  assert.equal(detail.programs.available, true);
  const learning = detail.programs.items.find((program: any) => program.program_key === 'learning');
  assert.ok(learning, 'the registry detail reads the Founder licence’s program rules');
  assert.equal(learning.granted, false);
  assert.deepEqual(detail.overview.entitlements, detail.programs);
  assert.equal(detail.billing.state, 'not_recorded');
  assert.deepEqual(detail.history, { available: true, items: [] });

  // An agreement store that fails to read is Unreadable on the row, and attention says so; never "none".
  db.exec('ALTER TABLE licence_contracts RENAME COLUMN superseded_at TO superseded_at_x');
  const broken = (await ok(db, '/api/admin/licence-registry?family=operator')).items[0];
  assert.equal(broken.agreement.available, false);
  assert.equal(broken.agreement.state, 'unreadable');
  assert.ok(broken.attention.some((a: any) => a.code === 'agreement_unreadable'));

  // A database without the registry: Not recorded, not an empty list.
  const bare = fixture();
  bare.exec('DROP TABLE licences');
  const none = await ok(bare, '/api/admin/licence-registry');
  assert.equal(none.available, false);
  assert.equal(none.state, 'not_recorded');
  assert.equal(none.items, null);
  assert.equal(none.total, null);
});

test('user detail reads this licence’s lifecycle events, newest first, and distinguishes a missing store from a failed read', async () => {
  const db = fixture();
  const path = '/api/admin/licence-registry/ulic_5_founder';
  const add = db.prepare(`INSERT INTO user_licence_events
    (licence_uid, user_id, licence_type, action, to_status, revision, reason)
    VALUES (?, ?, ?, ?, ?, ?, 'Synthetic history fixture')`);
  add.run('ulic_5_founder', FOUNDER, 'founder', 'activate', 'active', 1);
  add.run('ulic_5_investor', FOUNDER, 'investor', 'activate', 'active', 1);
  add.run('ulic_5_founder', FOUNDER, 'founder', 'suspend', 'suspended', 2);

  const history = (await ok(db, path)).history;
  assert.equal(history.available, true);
  assert.deepEqual(history.items.map((event: any) => [event.licence_uid, event.action, event.revision]), [
    ['ulic_5_founder', 'suspend', 2], ['ulic_5_founder', 'activate', 1],
  ]);

  db.exec('ALTER TABLE user_licence_events RENAME COLUMN licence_uid TO old_uid');
  assert.equal((await ok(db, path)).history.state, 'unreadable');
  db.exec('DROP TABLE user_licence_events');
  assert.equal((await ok(db, path)).history.state, 'not_recorded');
  db.close();
});

test('7. the four user licence agreement templates are Contracts\' rows, authored or not', async () => {
  const db = fixture();
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, is_stub) VALUES ('founder_licence_agreement', 'Founder Licence Agreement', 'compliance', '# Founder licence for {{signer.name}}', 2, 1, 0)").run();
  const { items } = await ok(db, '/api/admin/licence-registry/templates');
  assert.deepEqual(items.map((t: any) => t.slug), ['founder_licence_agreement', 'investor_licence_agreement', 'operating_partner_licence_agreement', 'advisor_licence_agreement']);
  const founder = items.find((t: any) => t.slug === 'founder_licence_agreement');
  assert.equal(founder.authored, true);
  assert.equal(founder.version, 2);
  for (const t of items.filter((x: any) => x.slug !== 'founder_licence_agreement')) {
    assert.equal(t.authored, false);
    assert.match(t.refusal, /not authored/);
  }
});
