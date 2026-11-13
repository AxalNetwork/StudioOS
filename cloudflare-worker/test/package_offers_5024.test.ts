/** Real SQLite/JWT regressions for atomic package offers, grants, legal freezes and retry (#5024). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as offers } from '../src/routes/admin_package_offers.ts';
import { mount as snapshots } from '../src/routes/admin_licence_pricing_apply.ts';
import policies from '../src/routes/admin_licence_agreement_policies.ts';
import grants from '../src/routes/admin_program_grants.ts';
import agreements from '../src/routes/admin_licence_agreements.ts';
import { holdingsOf, requirementFor, programLegalStatus, policyVersionStatements, freezeHoldingStatements } from '../src/services/agreementPolicies.ts';
import { insertGrantStatement } from '../src/services/programGrants.ts';
import { getPackageOffer, packageOfferForAgreement } from '../src/services/packageOffers.ts';
import { agreementMergeValues } from '../src/services/agreementTemplates.ts';
import { activePackageDetail, draftNextVersion, publishVersion } from '../src/services/licencePackagesStore.ts';

const CLOCK = Date.UTC(2026, 10, 13, 12);
const SECRET = 'synthetic-package-offer-5024-test-secret';
const LIC = 'lic_5024', OTHER = 'lic_other_5024';
// A test-only published version. The seeded v1 includes HQ-only Influencers and must be refused.
const CORE = ['referral-partners', 'refer-and-earn', 'perks'];
const BASE = `/api/admin/licences/${LIC}/package-offers`;
const REASON = 'Commercial package reviewed with the licence operator';
const clockContexts = new WeakSet<object>();

function fixture(ctx: any) {
  if (!clockContexts.has(ctx)) { ctx.mock.timers.enable({ apis: ['Date'], now: CLOCK }); clockContexts.add(ctx); }
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  ctx.after(() => db.close());
  for (const [id, role] of [[1, 'admin'], [2, 'admin'], [3, 'admin']] as const) {
    db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(id, role, `Operator ${id}`, `test${id}@example.test`);
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', ?)")
      .run(id, `totp-${id}`, new Date(id === 3 ? CLOCK - 7_200_000 : CLOCK).toISOString());
  }
  db.exec('INSERT INTO super_admins (user_id) VALUES (1), (3)');
  db.exec("UPDATE pricing_models SET status = 'active', activated_at = '2026-11-01' WHERE uid = 'pricing-model-v1-seed'");
  db.exec(`UPDATE country_market_profiles SET population = 68000000, population_status = 'recorded',
    ppp_gdp_per_capita = 58000, ppp_status = 'recorded', startup_ecosystem_score = 30000,
    startup_score_status = 'recorded', regulatory_class = 'medium' WHERE country_code = 'FR'`);
  for (const [id, uid] of [[1, LIC], [2, OTHER]] as const) {
    db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
      VALUES (?, ?, ?, 'Test licensee', 'Test studio', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2028-01-01')`)
      .run(id, uid, `AXL-5024-${id}`);
    db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?, ?)').run(id, id === 1 ? 'FR' : 'DE');
  }
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route(offers.path, offers.router);
  for (const m of snapshots) app.route(m.path, m.router);
  app.route('/api/admin/licence-agreement-policies', policies);
  app.route('/api/admin/program-grants', grants);
  app.route('/api/admin/licence-agreements', agreements);
  const call = async (method: string, path: string, body?: unknown, user: number | null = 1) => {
    const token = user == null ? null : await new SignJWT({ user_id: user, role: 'admin', jti: `totp-${user}` })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(path, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env));
    return { status: res.status, body: await res.json() as any };
  };
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
  let seq = 0;
  const setup = async (strategy = 'none', gate = 'optional', compatibleCatalogue = true) => {
    if (compatibleCatalogue) {
      const original = await activePackageDetail(env, 'core_network');
      const draft = await draftNextVersion(env, 'core_network', { ...original, items: original.items.filter((p) => p.program_key !== 'influencer') }, 'user:1');
      await publishVersion(env, 'core_network', draft.version, 'user:1');
    }
    const p = await call('POST', '/api/admin/licence-agreement-policies/package/core_network', {
      strategy, legal_gate: gate, programs: compatibleCatalogue ? CORE : [...CORE, 'influencer'], reason: REASON,
    });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const s = await call('POST', `/api/admin/licences/${LIC}/pricing/snapshot`, {});
    assert.equal(s.status, 201, JSON.stringify(s.body));
  };
  const create = async (extra = {}) => {
    const r = await call('POST', BASE, { package_key: 'core_network', starts_on: '2026-11-13', ends_on: '2027-10-31',
      reason: REASON, idempotency_key: `create-5024-${++seq}`, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.offer;
  };
  const offered = async (extra = {}) => {
    const o = await create(extra);
    const r = await call('POST', `${BASE}/${o.uid}/offer`, { expected_revision: o.revision, reason: REASON });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.offer;
  };
  const review = async (o: any, price = {}) => {
    const r = await call('POST', `${BASE}/${o.uid}/review`, price);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const accept = async (o: any, price = {}) => {
    const r = await review(o, price);
    return call('POST', `${BASE}/${o.uid}/accept`, { ...price, expected_revision: o.revision, review_hash: r.review_hash,
      reason: REASON, idempotency_key: `accept-5024-${++seq}` });
  };
  return { db, env, call, one, all, setup, create, offered, review, accept };
}

test('a package acceptance freezes its whole composition, grants and real offer policy together', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  const offer = await f.offered();
  assert.equal(offer.package_version, 2);
  assert.ok(offer.recommendation.uid);
  const reviewed = await f.review(offer);
  assert.deepEqual(reviewed.conflicts, []);
  const accepted = await f.accept(offer);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.outcome, 'accepted');
  assert.deepEqual(accepted.body.grants.map((p: any) => p.program_key), CORE);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 3);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_items').n, 3);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM licence_package_events WHERE action = 'accepted'").n, 1);
  assert.equal(f.one('SELECT annual_fee_cents FROM territory_licences WHERE uid = ?', LIC).annual_fee_cents, 1000000, 'package price does not rewrite the territory fee');
  const held = await holdingsOf(f.env, LIC);
  assert.equal(held.find((h) => h.scope_kind === 'package')?.package_offer_uid, offer.uid);
  assert.equal(held.find((h) => h.scope_kind === 'package')?.package_version, 2);
  const history = await f.call('GET', `${BASE}/${offer.uid}/history`);
  assert.deepEqual(history.body.items.map((e: any) => e.action), ['created', 'offered', 'accepted'], 'same-time decisions retain causal order');
  for (const g of f.all('SELECT * FROM program_grants')) {
    assert.equal(g.starts_on, '2026-11-13'); assert.equal(g.ends_on, '2027-10-31');
    assert.equal(g.fee_cents, null, 'unallocated program economics are not invented as zero');
    assert.equal(g.requires_signed_schedule, 1, 'package acceptance cannot bypass Program Grants schedules');
  }
});

test('creation and acceptance replay exact requests; changed payloads cannot reuse a key', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  const o = await f.create({ idempotency_key: 'same-create-5024' });
  const replay = await f.call('POST', BASE, { package_key: 'core_network', starts_on: '2026-11-13', ends_on: '2027-10-31', reason: REASON, idempotency_key: 'same-create-5024' });
  assert.deepEqual([replay.status, replay.body.created, replay.body.offer.uid], [200, false, o.uid]);
  const wrong = await f.call('POST', BASE, { package_key: 'core_network', starts_on: '2026-11-13', ends_on: '2027-10-30', reason: REASON, idempotency_key: 'same-create-5024' });
  assert.equal(wrong.body.error, 'idempotency_key_reused');
  const offered = (await f.call('POST', `${BASE}/${o.uid}/offer`, { expected_revision: 0, reason: REASON })).body.offer;
  const r = await f.review(offered);
  const body = { expected_revision: 1, review_hash: r.review_hash, reason: REASON, idempotency_key: 'same-accept-5024' };
  assert.equal((await f.call('POST', `${BASE}/${o.uid}/accept`, body)).status, 200);
  assert.equal((await f.call('POST', `${BASE}/${o.uid}/accept`, body)).body.replayed, true);
  assert.equal((await f.call('POST', `${BASE}/${o.uid}/accept`, { ...body, reason: 'Different decision reason' })).body.error, 'already_accepted');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 3);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM licence_package_events WHERE action = 'accepted'").n, 1);
});

test('override needs its own reason and review; unknown or unsafe prices are refused', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const o = await f.offered();
  for (const fee of [null, -1, 1.5, '100', Number.MAX_SAFE_INTEGER]) {
    assert.equal((await f.call('POST', `${BASE}/${o.uid}/review`, { accepted_annual_fee_cents: fee })).status, 400);
  }
  assert.equal((await f.call('POST', `${BASE}/${o.uid}/review`, { accepted_annual_fee_cents: 123400 })).status, 400);
  const accepted = await f.accept(o, { accepted_annual_fee_cents: 123400, override_reason: 'Agreed commercial exception for this term' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual([accepted.body.accepted_annual_fee_cents, accepted.body.overridden], [123400, true]);
});

test('seeded HQ-only and unready items block the entire package, without silent grant exceptions', async (ctx) => {
  const f = fixture(ctx); await f.setup('none', 'optional', false);
  const o = await f.offered();
  const review = await f.review(o);
  assert.ok(review.conflicts.some((p: any) => p.program_key === 'influencer' && p.code === 'not_grantable'));
  assert.equal((await f.accept(o)).status, 409);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 0);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_items').n, 0);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_agreement_policy_holdings').n, 0);
});

test('all offer reads require Super Admin; writes require its recent authentication', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const o = await f.offered();
  const paths = [BASE, `${BASE}/${o.uid}`, `${BASE}/${o.uid}/history`, `${BASE}/${o.uid}/review`];
  for (const path of paths) {
    const method = path.endsWith('/review') ? 'POST' : 'GET';
    assert.equal((await f.call(method, path, method === 'POST' ? {} : undefined, null)).status, 401);
    assert.equal((await f.call(method, path, method === 'POST' ? {} : undefined, 2)).status, 403);
  }
  for (const path of [BASE, ...['offer', 'accept', 'decline', 'expire', 'supersede'].map((s) => `${BASE}/${o.uid}/${s}`)]) {
    assert.equal((await f.call('POST', path, {}, 2)).status, 403);
    assert.equal((await f.call('POST', path, {}, 3)).status, 403);
  }
  const other = BASE.replace(LIC, OTHER);
  for (const suffix of ['', '/history', '/review', '/accept']) {
    const method = ['/review', '/accept'].includes(suffix) ? 'POST' : 'GET';
    const r = await f.call(method, `${other}/${o.uid}${suffix}`, method === 'POST' ? { reason: REASON, expected_revision: 1, idempotency_key: 'aaaaaaaa' } : undefined);
    assert.equal(r.status, 404);
  }
});

test('compatible existing grants are linked unchanged and outside programs remain standalone', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  for (const program of [CORE[0], 'learning']) {
    const r = await f.call('POST', `/api/admin/program-grants/licences/${LIC}/${program}`, { reason: REASON,
      terms: { starts_on: '2026-01-01', ends_on: '2028-01-01', requires_signed_schedule: 0, fee_cents: 10000, currency: 'EUR' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const existing = f.one('SELECT * FROM program_grants WHERE program_key = ?', CORE[0]);
  const outside = f.one("SELECT * FROM program_grants WHERE program_key = 'learning'");
  const o = await f.offered(); const accepted = await f.accept(o);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.grants.find((g: any) => g.program_key === CORE[0]).action, 'retained');
  assert.deepEqual(f.one('SELECT * FROM program_grants WHERE uid = ?', existing.uid), existing);
  assert.deepEqual(f.one('SELECT * FROM program_grants WHERE uid = ?', outside.uid), outside);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_items WHERE program_key = ?', 'learning').n, 0);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 4);
});

test('conflicting grant terms, dates and states require explicit resolution; review never mutates them', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  const granted = await f.call('POST', `/api/admin/program-grants/licences/${LIC}/${CORE[0]}`, { reason: REASON,
    terms: { starts_on: '2026-01-01', ends_on: '2028-01-01', reporting: 'quarterly', requires_signed_schedule: 0 } });
  assert.equal(granted.status, 201, JSON.stringify(granted.body));
  const o = await f.offered({ program_terms: { [CORE[0]]: { reporting: 'monthly' } } });
  const before = f.one('SELECT * FROM program_grants');
  const r = await f.review(o);
  assert.ok(r.conflicts.some((p: any) => p.code === 'grant_terms_conflict'));
  assert.equal((await f.accept(o)).status, 409);
  assert.deepEqual(f.one('SELECT * FROM program_grants'), before);
  f.db.prepare("UPDATE program_grants SET reporting = 'monthly', state = 'paused', terms_revision = terms_revision + 1 WHERE uid = ?").run(before.uid);
  assert.ok((await f.review(o)).conflicts.some((p: any) => p.code === 'grant_state_conflict'));
  f.db.prepare("UPDATE program_grants SET state = 'granted', ends_on = '2027-01-01', terms_revision = terms_revision + 1 WHERE uid = ?").run(before.uid);
  assert.ok((await f.review(o)).conflicts.some((p: any) => p.code === 'grant_dates_conflict'));
  f.db.prepare("UPDATE program_grants SET ends_on = '2028-01-01', terms_revision = terms_revision + 1 WHERE uid = ?").run(before.uid);
  const stale = await f.call('POST', `${BASE}/${o.uid}/accept`, { reason: REASON, expected_revision: o.revision, review_hash: r.review_hash, idempotency_key: 'old-review-5024' });
  assert.equal(stale.body.error, 'review_changed');
  assert.equal((await f.accept(o)).status, 200);
});

test('offer transitions, expiry, licence freeze and accepted-term overlap are revision safe', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  const o = await f.offered();
  assert.equal((await f.call('POST', `${BASE}/${o.uid}/decline`, { expected_revision: 0, reason: REASON })).body.error, 'changed_since_open');
  assert.equal((await f.call('POST', `${BASE}/${o.uid}/decline`, { expected_revision: 1, reason: REASON })).status, 200);
  assert.equal((await f.accept(o)).status, 409);
  const expired = await f.offered({ expires_on: '2026-11-12' });
  assert.ok((await f.review(expired)).conflicts.some((p: any) => p.code === 'offer_expired'));
  assert.equal((await f.accept(expired)).status, 409);
  const live = await f.offered();
  f.db.exec("UPDATE territory_licences SET status = 'suspended', revision = revision + 1 WHERE id = 1");
  assert.ok((await f.review(live)).conflicts.some((p: any) => p.code === 'licence_not_active'));
  f.db.exec("UPDATE territory_licences SET status = 'active', revision = revision + 1 WHERE id = 1");
  assert.equal((await f.accept(live)).status, 200);
  const overlapping = await f.offered();
  assert.ok((await f.review(overlapping)).conflicts.some((p: any) => p.code === 'package_term_conflict'));
  assert.equal((await f.accept(overlapping)).status, 409);
  assert.equal((await f.call('POST', `${BASE}/${live.uid}/supersede`, { expected_revision: 2, reason: REASON })).status, 409, 'accepted commercial history cannot be rewritten');
});

test('a late failure rolls back accepted price, every grant, items, policy and audit event', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const o = await f.offered();
  const real = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => {
    const stmt = real(sql);
    if (/INSERT INTO licence_package_items/.test(sql)) stmt.runSync = () => { throw new Error('SQLITE_ERROR: injected package item failure'); };
    return stmt;
  };
  assert.equal((await f.accept(o)).status, 500);
  assert.equal(f.one('SELECT state FROM licence_package_offers WHERE uid = ?', o.uid).state, 'offered');
  for (const table of ['program_grants', 'licence_package_items', 'licence_agreement_policy_holdings']) assert.equal(f.one(`SELECT COUNT(*) AS n FROM ${table}`).n, 0);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM licence_package_events WHERE action = 'accepted'").n, 0);
});

test('a licence, policy or grant enablement change between review and commit rolls back the whole decision', async (ctx) => {
  for (const mode of ['licence', 'policy', 'enablement']) {
    const f = fixture(ctx); await f.setup(); const o = await f.offered();
    const real = f.env.DB.batch.bind(f.env.DB); let once = true;
    f.env.DB.batch = async (stmts: any[]) => {
      if (once) {
        once = false;
        if (mode === 'licence') f.db.exec('UPDATE territory_licences SET revision = revision + 1 WHERE id = 1');
        else if (mode === 'enablement') f.db.prepare('UPDATE program_grant_defaults SET grantable = 0 WHERE program_key = ?').run(CORE[0]);
        else await real(policyVersionStatements(f.env, { scope_kind: 'package', scope_key: 'core_network', strategy: 'none', legal_gate: 'optional',
          programs: CORE, required_schedules: null, reason: 'New legal policy recorded concurrently' }, { uid: 'concurrent-policy-5024', actorId: 1, at: new Date().toISOString() }));
      }
      return real(stmts);
    };
    const r = await f.accept(o);
    assert.deepEqual([r.status, r.body.error], [409, 'review_changed']);
    assert.equal(f.one('SELECT state FROM licence_package_offers WHERE uid = ?', o.uid).state, 'offered');
    assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 0);
    assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_agreement_policy_holdings').n, 0);
  }
});

test('a concurrently created standalone grant cannot leave a half-granted package', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const o = await f.offered();
  const real = f.env.DB.batch.bind(f.env.DB); let once = true;
  f.env.DB.batch = async (stmts: any[]) => {
    if (once) {
      once = false;
      await real([insertGrantStatement(f.env, { uid: 'concurrent-grant-5024', licenceId: 1, programKey: CORE[0],
        terms: o.programs[0].terms, note: 'Independent grant', actorId: 1, at: new Date().toISOString() })]);
    }
    return real(stmts);
  };
  const r = await f.accept(o);
  assert.deepEqual([r.status, r.body.error], [409, 'acceptance_conflict']);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 1);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_items').n, 0);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_agreement_policy_holdings').n, 0);
});

test('policy publication after acceptance cannot change the licence’s frozen strategy', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const o = await f.offered();
  assert.equal((await f.accept(o)).status, 200);
  assert.equal((await f.call('POST', '/api/admin/licence-agreement-policies/package/core_network', {
    strategy: 'package_master', legal_gate: 'required_before_grant', programs: CORE, reason: 'A new policy for future package terms' })).status, 201);
  const held = await holdingsOf(f.env, LIC);
  const requirement = requirementFor(CORE[0], held);
  assert.equal(requirement.strategy, 'none'); assert.equal(requirement.policy_version, 1);
  assert.equal(requirement.legal_gate, 'optional');
  assert.equal((await f.call('POST', `/api/admin/licence-agreement-policies/licences/${LIC}/package-acceptances`, {
    package_key: 'core_network', package_offer_uid: o.uid, reason: REASON })).body.error, 'package_offer_required');
  assert.equal((await holdingsOf(f.env, LIC)).find((h) => h.scope_kind === 'package')?.policy_version, 1);
});

test('accepted merge values and composition survive a new catalogue version and new market data', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const o = await f.offered();
  assert.equal((await f.accept(o, { accepted_annual_fee_cents: 123400, override_reason: 'Frozen negotiated package price for this term' })).status, 200);
  const row = await getPackageOffer(f.env, LIC, o.uid);
  const input: any = { licence: f.one('SELECT * FROM territory_licences WHERE uid = ?', LIC), territories: ['FR'], seats: [], licenceTerms: null,
    grant: null, program_key: null, package_key: row.package_key, package_name: row.package_name, package_version: row.package_version,
    packageOffer: row, signer: null, agreement: { kind: 'package_master', prepared_on: '2026-11-13' } };
  const before = agreementMergeValues(input);
  assert.equal(before['package.annual_fee'], 'EUR 1,234');
  assert.equal(before['package.offer_uid'], o.uid);
  assert.equal(before['package.programs'], CORE.join(', '));
  const current = await activePackageDetail(f.env, 'core_network');
  const next = await draftNextVersion(f.env, 'core_network', { ...current, name: 'Renamed future package', base_annual_fee_cents: 9000000,
    items: current.items.filter((p) => p.program_key !== 'perks') }, 'user:1');
  await publishVersion(f.env, 'core_network', next.version, 'user:1');
  f.db.exec("UPDATE country_market_profiles SET population = 99000000 WHERE country_code = 'FR'");
  const frozen = await packageOfferForAgreement(f.env, LIC, 'core_network', null, null);
  assert.equal(frozen?.uid, o.uid);
  assert.deepEqual(agreementMergeValues({ ...input, packageOffer: frozen }), before);
  f.db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, is_stub)
    VALUES ('package_core_network_master', 'Core Network Master', 'compliance', ?, 1, 1, 0)`)
    .run('{{package.name}} v{{package.version}} — {{package.annual_fee}} — {{package.programs}}');
  const drafted = await f.call('POST', `/api/admin/licence-agreements/licences/${LIC}/drafts`, {
    agreement_kind: 'package_master', package_key: 'core_network', template_slug: 'package_core_network_master', reason: REASON,
  });
  assert.equal(drafted.status, 201, JSON.stringify(drafted.body));
  const agreement = f.one('SELECT * FROM licence_program_agreements WHERE licence_uid = ?', LIC);
  assert.equal(agreement.package_offer_uid, o.uid);
  assert.equal(agreement.package_version, 2);
  const values = JSON.parse(agreement.merge_values_json);
  assert.equal(values['package.name'], o.package_name);
  assert.equal(values['package.annual_fee'], 'EUR 1,234');
  assert.equal(agreement.body_md, `${o.package_name} v2 — EUR 1,234 — ${CORE.join(', ')}`);
  assert.equal((await f.call('POST', `/api/admin/licence-agreements/licences/${OTHER}/drafts`, {
    agreement_kind: 'package_master', package_key: 'core_network', package_offer_uid: o.uid,
    template_slug: 'package_core_network_master', reason: REASON,
  })).status, 404, 'an accepted price cannot be sourced from another licence');
  assert.equal((await f.call('GET', `${BASE}/${o.uid}`)).body.accepted_items.length, 3);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_events WHERE actor_user_id = 1').n, 3);
});

function executedMaster(f: ReturnType<typeof fixture>, uid: string, offerUid: string, version: number) {
  f.db.prepare(`INSERT INTO licence_program_agreements
    (uid, licence_uid, agreement_kind, slot_key, package_key, package_version, package_offer_uid, template_slug, status, envelope_uuid, created_at, signed_at)
    VALUES (?, ?, 'package_master', 'package_master', 'core_network', ?, ?, 'package_core_network_master', 'executed', ?, ?, ?)`)
    .run(uid, LIC, version, offerUid, `envelope-${uid}`, new Date(CLOCK).toISOString(), new Date(CLOCK).toISOString());
}

test('required-before-grant refuses acceptance until this exact offer’s master is executed', async (ctx) => {
  const f = fixture(ctx); await f.setup('package_master', 'required_before_grant');
  const o = await f.offered();
  assert.ok((await f.review(o)).conflicts.some((p: any) => p.code === 'agreement_required_before_grant'));
  assert.equal((await f.accept(o)).status, 409);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 0);
  executedMaster(f, 'master-for-this-offer', o.uid, o.package_version);
  const accepted = await f.accept(o);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.legal.legal_gate, 'required_before_grant');
});

test('a master for an old offer/version cannot put a newly accepted package in force', async (ctx) => {
  const f = fixture(ctx); await f.setup('package_master', 'required_before_in_force');
  executedMaster(f, 'old-master', 'old-commercial-offer', 1);
  const o = await f.offered();
  assert.equal((await f.accept(o)).status, 200);
  const held = await holdingsOf(f.env, LIC);
  const requirement = requirementFor(CORE[0], held);
  const old = f.one("SELECT * FROM licence_program_agreements WHERE uid = 'old-master'");
  const row = { ...f.one('SELECT * FROM program_grants WHERE program_key = ?', CORE[0]), requires_signed_schedule: 0 };
  const before = programLegalStatus(row, [old], requirement, { grantInForce: true });
  assert.deepEqual(before.missing, ['package_master']);
  assert.equal(before.legally_in_force, false);
  f.db.exec("UPDATE licence_program_agreements SET status = 'superseded', revision = revision + 1, superseded_at = '2026-11-13T12:00:00Z' WHERE uid = 'old-master'");
  executedMaster(f, 'current-master', o.uid, o.package_version);
  const current = f.one("SELECT * FROM licence_program_agreements WHERE uid = 'current-master'");
  const after = programLegalStatus(row, [current], requirement, { grantInForce: true });
  assert.deepEqual(after.missing, []);
  assert.equal(after.legally_in_force, true);
});

test('failed branch delivery leaves a durable normal licence push, never a second entitlement model', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  f.db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
    VALUES (?, 'fr', 'fr.example.test', 'branch-fr', 'branch-fr-db', 'deployed')`).run(LIC);
  f.env.BRANCH_FR = { applyLicence: async () => { throw new Error('Synthetic branch unavailable'); } };
  const o = await f.offered();
  let atomicIntent: number | null = null;
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => { const stmt = prepare(sql); stmt.sql = sql; return stmt; };
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = async (stmts: any[]) => {
    const result = await batch(stmts);
    if (stmts.some((s) => /UPDATE licence_package_offers SET state = 'accepted'/.test(s.sql ?? ''))) {
      atomicIntent = f.one('SELECT COUNT(*) AS n FROM licence_push_pending WHERE licence_id = 1').n;
    }
    return result;
  };
  const accepted = await f.accept(o);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(atomicIntent, 1, 'delivery intent must commit with acceptance, before any follow-up sync or RPC');
  assert.equal(accepted.body.pushed.ok, false);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 3);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_items').n, 3);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_push_pending WHERE licence_id = 1').n, 1);
  assert.equal(f.one('SELECT state FROM licence_package_offers WHERE uid = ?', o.uid).state, 'accepted');
});

test('a future package does not change the policy of an already current included program early', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  assert.equal((await f.call('POST', `/api/admin/program-grants/licences/${LIC}/${CORE[0]}`, { reason: REASON,
    terms: { starts_on: '2026-01-01', ends_on: '2028-01-01', requires_signed_schedule: 0 } })).status, 201);
  const o = await f.offered({ starts_on: '2027-01-01' });
  assert.ok((await f.review(o)).conflicts.some((p: any) => p.code === 'scheduled_existing_grant'));
  assert.equal((await f.accept(o)).status, 409);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_agreement_policy_holdings').n, 0);
});

test('a package move cannot drop an outside grant’s held legal policy or replace it early', async (ctx) => {
  const f = fixture(ctx); await f.setup();
  assert.equal((await f.call('POST', `/api/admin/program-grants/licences/${LIC}/learning`, { reason: REASON,
    terms: { starts_on: '2026-01-01', ends_on: '2028-01-01', requires_signed_schedule: 0 } })).status, 201);
  assert.equal((await f.call('POST', '/api/admin/licence-agreement-policies/package/core_network', {
    strategy: 'package_master', legal_gate: 'required_before_in_force', programs: [...CORE, 'learning'], reason: REASON,
  })).status, 201);
  await f.env.DB.batch(freezeHoldingStatements(f.env, { uid: 'old-package-holding', licenceUid: LIC,
    scopeKind: 'package', scopeKey: 'core_network', origin: 'package_offer_accepted', packageOfferUid: 'legacy-offer',
    actorId: 1, at: new Date().toISOString(), reason: REASON }));
  assert.equal((await f.call('POST', '/api/admin/licence-agreement-policies/package/core_network', {
    strategy: 'none', legal_gate: 'optional', programs: CORE, reason: REASON,
  })).status, 201);
  const before = await holdingsOf(f.env, LIC);
  const now = await f.offered();
  assert.ok((await f.review(now)).conflicts.some((p: any) => p.code === 'package_move_requires_review'));
  assert.equal((await f.accept(now)).status, 409);
  const future = await f.offered({ starts_on: '2027-01-01' });
  assert.ok((await f.review(future)).conflicts.some((p: any) => p.code === 'scheduled_package_policy'));
  assert.equal((await f.accept(future)).status, 409);
  assert.deepEqual(await holdingsOf(f.env, LIC), before);
  assert.equal(requirementFor('learning', before).legal_gate, 'required_before_in_force');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_items').n, 0);
});

test('competing overlapping offers serialize; a losing acceptance has no partial result', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const first = await f.offered(); const second = await f.offered();
  const real = f.env.DB.batch.bind(f.env.DB); let once = true;
  f.env.DB.batch = async (stmts: any[]) => {
    if (once) { once = false; assert.equal((await f.accept(second)).status, 200); }
    return real(stmts);
  };
  const lost = await f.accept(first);
  assert.deepEqual([lost.status, lost.body.error], [409, 'review_changed']);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 3);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM licence_package_items').n, 3);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM licence_package_offers WHERE state = 'accepted'").n, 1);
  assert.equal(f.one('SELECT state FROM licence_package_offers WHERE uid = ?', first.uid).state, 'offered');
});

test('a simultaneous retry of the same accepted request gets the original receipt', async (ctx) => {
  const f = fixture(ctx); await f.setup(); const o = await f.offered(); const r = await f.review(o);
  const body = { expected_revision: 1, review_hash: r.review_hash, reason: REASON, idempotency_key: 'concurrent-same-key-5024' };
  const real = f.env.DB.batch.bind(f.env.DB); let once = true;
  f.env.DB.batch = async (stmts: any[]) => {
    if (once) { once = false; assert.equal((await f.call('POST', `${BASE}/${o.uid}/accept`, body)).status, 200); }
    return real(stmts);
  };
  const replay = await f.call('POST', `${BASE}/${o.uid}/accept`, body);
  assert.deepEqual([replay.status, replay.body.replayed], [200, true]);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 3);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM licence_package_events WHERE action = 'accepted'").n, 1);
});
