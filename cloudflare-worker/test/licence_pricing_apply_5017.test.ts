/**
 * D5017 (#5017) — country pricing applied to a licence.
 *
 * Real SQLite over every migration, the real routers. Pinned, from the issue's
 * acceptance criteria:
 *   · applying needs an exact snapshot and the expected terms revision;
 *   · a stale editor gets 409 and writes nothing (no terms, no decision);
 *   · an override needs its reason and records who made it;
 *   · a market refresh alone never changes a licence;
 *   · issued invoices and the agreement row stay as they were;
 *   · a contractual change marks the agreement as not matching;
 *   · a multi-country basis is explicit, its weights total 10000 and are frozen;
 *   · the branch push outcome is reported apart from HQ's commit.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_pricing_apply_5017.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount } from '../src/routes/admin_licence_pricing_apply.ts';
import { addYear, classifyReview, combine, effectiveBasis, planApply, validatePolicyBody } from '../src/services/licencePricingApply.ts';

const SECRET = ['d5017', 'pricing', 'apply', 'fixture', 'secret'].join('-');
const SUPER = 1, SUPER_PW = 2, ADMIN = 3;
const LIC = 'lic_5017';
const P = `/api/admin/licences/${LIC}/pricing`;

function fixture(countries: string[] = ['FR']) {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, SUPER_PW, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_PW})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(SUPER, 'totp-super', 'totp');
  s.run(SUPER_PW, 'pw-super', 'password');
  s.run(ADMIN, 'totp-3', 'totp');
  // The seeded v1 draft (D5016), activated, and three recorded markets.
  db.exec("UPDATE pricing_models SET status = 'active', activated_at = datetime('now') WHERE uid = 'pricing-model-v1-seed'");
  const prof = db.prepare(`UPDATE country_market_profiles SET population = ?, population_status = 'recorded', ppp_gdp_per_capita = ?, ppp_status = 'recorded',
      startup_ecosystem_score = ?, startup_score_status = 'recorded', regulatory_class = ? WHERE country_code = ?`);
  prof.run(68_000_000, 58_000, 30_000, 'medium', 'FR');
  prof.run(11_700_000, 62_000, 12_000, 'low', 'BE');
  prof.run(84_000_000, 66_000, 45_000, 'medium', 'DE');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-5017', 'Licensee', 'Brand', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2027-01-01')`).run(LIC);
  const t = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (1, ?)');
  for (const c of countries) t.run(c);
  db.prepare(`INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency,
      reference, issued_at, due_at, status, figures_json, figures_sha256)
    VALUES ('inv_1', ?, '2026–27', '2026-01-01', '2026-12-31', 1000000, 'EUR', 'REF-1', '2026-11-01', '2026-12-01', 'issued', '{}', 'x')`).run(LIC);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  for (const m of mount) app.route(m.path, m.router);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const jti = who === SUPER ? 'totp-super' : who === SUPER_PW ? 'pw-super' : `totp-${who}`;
    const token = await new SignJWT({ user_id: who, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const licence = () => one('SELECT annual_fee_cents, revenue_share_bps, currency, terms_revision, revision FROM territory_licences WHERE id = 1');
  return { db, env, call, all, one, licence };
}

const applyBody = (snapshot_uid: string, rev: number, extra: Record<string, unknown> = {}) => ({
  snapshot_uid, expected_terms_revision: rev, effective_from: '2027-01-01', reason: 'Annual pricing applied', ...extra,
});

test('a refresh records a recommendation and changes nothing on the licence', async () => {
  const { call, licence, all } = fixture();
  const before = licence();
  const read = await call(SUPER, 'GET', P);
  assert.equal(read.status, 200);
  assert.equal(read.body.basis.basis, 'primary_country');
  assert.equal(read.body.basis.implied, true, 'one country prices itself');
  assert.equal(read.body.recommendation, null);
  assert.equal(read.body.model.version, 'v1');
  const snap = await call(SUPER, 'POST', `${P}/snapshot`, {});
  assert.equal(snap.status, 201);
  assert.equal(snap.body.licence_changed, false);
  assert.equal(snap.body.snapshot.available, true);
  assert.equal(snap.body.snapshot.components.length, 1);
  assert.equal(snap.body.snapshot.components[0].weight_bps, 10000);
  assert.deepEqual(licence(), before, 'a market refresh alone never changes the licence');
  assert.equal(all('SELECT * FROM licence_pricing_decisions').length, 0);
  const again = await call(SUPER, 'GET', P);
  assert.equal(again.body.recommendation.uid, snap.body.snapshot.uid);
  assert.equal(again.body.drift.fields.annual_fee_cents.current, 1000000);
  assert.equal(again.body.drift.fields.annual_fee_cents.difference, snap.body.snapshot.recommended.annual_fee_cents - 1000000);
});

test('apply takes the exact snapshot and revision, writes core terms, and leaves issued invoices alone', async () => {
  const { call, licence, all, one } = fixture();
  const invoicesBefore = all('SELECT * FROM licence_fee_invoices');
  const snap = (await call(SUPER, 'POST', `${P}/snapshot`, {})).body.snapshot;
  const rec = snap.recommended;
  const rev = licence().terms_revision;
  const noSnap = await call(SUPER, 'POST', `${P}/apply`, { expected_terms_revision: rev, effective_from: '2027-01-01', reason: 'x applied' });
  assert.equal(noSnap.status, 400);
  const noRev = await call(SUPER, 'POST', `${P}/apply`, { snapshot_uid: snap.uid, effective_from: '2027-01-01', reason: 'x applied' });
  assert.equal(noRev.status, 400);
  assert.equal(noRev.body.code ?? noRev.body.error, 'revision_required');
  const res = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, rev));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.committed, true);
  assert.equal(res.body.decision.decision, 'accepted');
  assert.ok('pushed' in res.body && 'push_outcome' in res.body, 'the push outcome is reported apart from the commit');
  const after = licence();
  assert.equal(after.annual_fee_cents, rec.annual_fee_cents);
  assert.equal(after.revenue_share_bps, rec.royalty_bps);
  assert.equal(after.terms_revision, rev + 1);
  const d = one('SELECT * FROM licence_pricing_decisions');
  assert.equal(d.licence_snapshot_uid, snap.uid);
  assert.equal(d.terms_revision_before, rev);
  assert.equal(d.terms_revision_after, rev + 1);
  assert.equal(d.created_by, `user:${SUPER}`);
  assert.equal(d.pricing_review_on, '2028-01-01');
  assert.equal(d.accepted_initial_fee_cents, rec.initial_fee_cents, 'the initial fee is recorded on the decision');
  assert.deepEqual(all('SELECT * FROM licence_fee_invoices'), invoicesBefore, 'an issued invoice is frozen');
  const ev = one("SELECT * FROM licence_events WHERE event = 'terms_changed'");
  assert.equal(JSON.parse(ev.detail_json).source, 'country_pricing');
  // An unknown snapshot, or another licence's, is refused.
  const ghost = await call(SUPER, 'POST', `${P}/apply`, applyBody('00000000-0000-0000-0000-000000000000', rev + 1));
  assert.equal(ghost.status, 404);
});

test('a stale editor gets 409 and nothing is written, neither terms nor decision', async () => {
  const { call, licence, all } = fixture();
  const snap = (await call(SUPER, 'POST', `${P}/snapshot`, {})).body.snapshot;
  const rev = licence().terms_revision;
  // Another save got there first.
  const first = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, rev));
  assert.equal(first.status, 200);
  const before = licence();
  const stale = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, rev, { accepted: { annual_fee_cents: 1 }, override_reason: 'Stale editor typed this' }));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code ?? stale.body.error, 'terms_conflict');
  assert.equal(stale.body.current_revision, rev + 1);
  assert.deepEqual(licence(), before);
  assert.equal(all('SELECT * FROM licence_pricing_decisions').length, 1, 'the stale decision was not recorded');
});

test('an override needs its reason, and records who, why and both figures', async () => {
  const { call, licence, one } = fixture();
  const snap = (await call(SUPER, 'POST', `${P}/snapshot`, {})).body.snapshot;
  const rev = licence().terms_revision;
  const accepted = { annual_fee_cents: 4_200_000 };
  const bare = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, rev, { accepted }));
  assert.equal(bare.status, 400);
  assert.equal(bare.body.code ?? bare.body.error, 'override_reason_required');
  assert.equal(licence().terms_revision, rev);
  const ok = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, rev, { accepted, override_reason: 'Launch discount agreed with the board' }));
  assert.equal(ok.status, 200);
  const d = one('SELECT * FROM licence_pricing_decisions');
  assert.equal(d.decision, 'overridden');
  assert.equal(d.override_reason, 'Launch discount agreed with the board');
  assert.equal(d.accepted_annual_fee_cents, 4_200_000);
  assert.equal(d.recommended_annual_fee_cents, snap.recommended.annual_fee_cents);
  assert.equal(d.created_by, `user:${SUPER}`);
  assert.equal(licence().annual_fee_cents, 4_200_000);
});

test('the write bar: a plain admin is refused, a password-only Super Admin cannot write', async () => {
  const { call } = fixture();
  assert.equal((await call(ADMIN, 'GET', P)).status, 403);
  const pw = await call(SUPER_PW, 'POST', `${P}/snapshot`, {});
  assert.ok([401, 403].includes(pw.status), `got ${pw.status}`);
});

test('several countries need an explicit basis; weights total 10000 and are frozen on the snapshot', async () => {
  const { call, licence, one, db } = fixture(['BE', 'FR']);
  const read = await call(SUPER, 'GET', P);
  assert.equal(read.body.basis.required, true);
  assert.equal(read.body.basis.code, 'pricing_basis_required');
  const refused = await call(SUPER, 'POST', `${P}/snapshot`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code ?? refused.body.error, 'pricing_basis_required');
  const off = await call(SUPER, 'PUT', `${P}/policy`, { basis: 'basket_weighted', weights: { FR: 6000, BE: 3000 }, reason: 'Weighted by revenue', expected_revision: 0 });
  assert.equal(off.status, 400, 'weights that do not total 10000 are refused');
  const partial = await call(SUPER, 'PUT', `${P}/policy`, { basis: 'basket_weighted', weights: { FR: 10000 }, reason: 'Weighted by revenue', expected_revision: 0 });
  assert.equal(partial.status, 400, 'a basket names every country of the territory');
  const set = await call(SUPER, 'PUT', `${P}/policy`, { basis: 'basket_weighted', weights: { FR: 6000, BE: 4000 }, reason: 'Weighted by revenue', expected_revision: 0 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.policy.revision, 1);
  const stalePolicy = await call(SUPER, 'PUT', `${P}/policy`, { basis: 'primary_country', primary_country: 'FR', reason: 'Price from France', expected_revision: 0 });
  assert.equal(stalePolicy.status, 409);
  const snap = (await call(SUPER, 'POST', `${P}/snapshot`, {})).body.snapshot;
  assert.equal(snap.basis, 'basket_weighted');
  assert.deepEqual(snap.components.map((c: any) => [c.country_code, c.weight_bps]), [['BE', 4000], ['FR', 6000]]);
  // Reproducible from the frozen country snapshots.
  const fr = one('SELECT * FROM country_pricing_snapshots WHERE uid = ?', snap.components.find((c: any) => c.country_code === 'FR').snapshot_uid);
  const be = one('SELECT * FROM country_pricing_snapshots WHERE uid = ?', snap.components.find((c: any) => c.country_code === 'BE').snapshot_uid);
  const expectRoyalty = Math.round((fr.recommended_royalty_bps * 6000 + be.recommended_royalty_bps * 4000) / 10000);
  assert.equal(snap.recommended.royalty_bps, expectRoyalty);
  assert.equal(snap.recommended.annual_fee_cents % 250_000, 0, 'a basket fee is re-rounded to the commercial increment');
  assert.equal(snap.lead_snapshot_uid, fr.uid, 'the heaviest country carries the decision');
  // The territory changes: the snapshot no longer describes the licence.
  db.exec("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'DE')");
  const stale = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, licence().terms_revision));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code ?? stale.body.error, 'pricing_basis_stale');
});

test('an HQ-set basis makes every apply an override', async () => {
  const { call, licence } = fixture(['BE', 'FR']);
  assert.equal((await call(SUPER, 'PUT', `${P}/policy`, { basis: 'hq_override', primary_country: 'FR', reason: 'Strategic pricing', expected_revision: 0 })).status, 200);
  const snap = (await call(SUPER, 'POST', `${P}/snapshot`, {})).body.snapshot;
  const r1 = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, licence().terms_revision));
  assert.equal(r1.status, 400);
  assert.equal(r1.body.code ?? r1.body.error, 'override_reason_required');
  const r2 = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, licence().terms_revision, { override_reason: 'HQ-set figures for this market' }));
  assert.equal(r2.status, 200);
  assert.equal(r2.body.decision.decision, 'overridden');
});

test('a contractual change asks for acknowledgement, leaves the agreement untouched, and marks it as not matching', async () => {
  const { call, licence, db, one } = fixture();
  db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md, body_sha256, unfilled_fields, status, created_by_user_id, created_at, updated_at)
    VALUES ('ct_1', ?, 'slug', 1, 'Licence agreement', 'Body', 'abc', '[]', 'signed', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run(LIC);
  const contractBefore = one("SELECT * FROM licence_contracts WHERE uid = 'ct_1'");
  assert.equal((await call(SUPER, 'GET', P)).body.agreement.state, 'matches');
  const snap = (await call(SUPER, 'POST', `${P}/snapshot`, {})).body.snapshot;
  const rev = licence().terms_revision;
  const noAck = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, rev));
  assert.equal(noAck.status, 409);
  assert.equal(noAck.body.code ?? noAck.body.error, 'agreement_ack_required');
  assert.equal(licence().terms_revision, rev);
  const ok = await call(SUPER, 'POST', `${P}/apply`, applyBody(snap.uid, rev, { acknowledge_agreement_mismatch: true }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.agreement.state, 'mismatch');
  assert.deepEqual(one("SELECT * FROM licence_contracts WHERE uid = 'ct_1'"), contractBefore, 'an executed agreement is never edited');
  const read = await call(SUPER, 'GET', P);
  assert.equal(read.body.agreement.state, 'mismatch');
  assert.equal(read.body.latest_decision.contractual_change, true);
});

test('the annual review: opening one changes no term; keep and postpone need a reason; apply closes it', async () => {
  const { call, licence, one } = fixture();
  const before = licence();
  const open = await call(SUPER, 'POST', `${P}/reviews`, {});
  assert.equal(open.status, 201, JSON.stringify(open.body));
  assert.equal(open.body.licence_changed, false);
  assert.deepEqual(licence(), before);
  assert.equal(open.body.review.kind, open.body.snapshot.recommended.annual_fee_cents > 1000000 ? 'increase' : 'decrease');
  assert.equal((await call(SUPER, 'POST', `${P}/reviews`, {})).status, 409, 'one open review at a time');
  const review = open.body.review;
  const noReason = await call(SUPER, 'POST', `${P}/reviews/${review.uid}/resolve`, { action: 'postpone', postponed_until: '2099-01-01', expected_revision: 1 });
  assert.equal(noReason.status, 400);
  const applied = await call(SUPER, 'POST', `${P}/apply`, applyBody(open.body.snapshot.uid, before.terms_revision, { review_uid: review.uid }));
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const closed = one('SELECT * FROM licence_pricing_reviews WHERE uid = ?', review.uid);
  assert.equal(closed.state, 'applied');
  assert.equal(closed.decision_uid, applied.body.decision.uid);
  const read = await call(SUPER, 'GET', P);
  assert.equal(read.body.next_review_on, '2028-01-01');
  // A second review, postponed with a reason and a date.
  const second = await call(SUPER, 'POST', `${P}/reviews`, {});
  assert.equal(second.status, 201);
  assert.equal(second.body.review.kind, 'unchanged');
  const post = await call(SUPER, 'POST', `${P}/reviews/${second.body.review.uid}/resolve`, { action: 'postpone', postponed_until: '2099-06-30', reason: 'Wait for the 2027 PPP release', expected_revision: 1 });
  assert.equal(post.status, 200);
  assert.equal(post.body.review.state, 'postponed');
  assert.equal((await call(SUPER, 'GET', P)).body.next_review_on, '2099-06-30');
  const twice = await call(SUPER, 'POST', `${P}/reviews/${second.body.review.uid}/resolve`, { action: 'keep', reason: 'Keep as is', expected_revision: 2 });
  assert.equal(twice.status, 409, 'a closed review stays closed');
});

test('the pure rules: no invisible average, unknown stays unknown, review kinds', () => {
  assert.equal(effectiveBasis(null, ['BE', 'FR']).ok, false);
  const e = effectiveBasis(null, ['FR']);
  assert.ok(e.ok && e.value.implied && e.value.weights.FR === 10000);
  assert.equal(validatePolicyBody({ basis: 'basket_weighted', weights: { FR: 5000, BE: 5001 } }, ['BE', 'FR']).ok, false);
  assert.equal(validatePolicyBody({ basis: 'basket_weighted', weights: { FR: 5000, BE: 5000 } }, ['BE', 'FR']).ok, true);
  assert.equal(validatePolicyBody({ basis: 'primary_country', primary_country: 'DE' }, ['BE', 'FR']).ok, false);
  const v = (n: number | null) => ({ initial_fee_cents: n, annual_fee_cents: n, royalty_bps: n === null ? null : 600, minimum_royalty_cents: n, regulatory_surcharge_cents: null });
  const missing = combine([
    { country_code: 'FR', weight_bps: 5000, snapshot_uid: 'a', available: true, values: v(5_000_000), unavailable_reason: null, provisional: [] },
    { country_code: 'BE', weight_bps: 5000, snapshot_uid: 'b', available: false, values: v(null), unavailable_reason: 'PPP not recorded.', provisional: [] },
  ], 250_000);
  assert.equal(missing.available, false, 'a basket is never priced from the countries that happen to have data');
  assert.equal(missing.values.annual_fee_cents, null);
  const both = combine([
    { country_code: 'FR', weight_bps: 7000, snapshot_uid: 'a', available: true, values: v(5_000_000), unavailable_reason: null, provisional: [] },
    { country_code: 'BE', weight_bps: 3000, snapshot_uid: 'b', available: true, values: v(4_000_000), unavailable_reason: null, provisional: [] },
  ], 250_000);
  assert.equal(both.values.annual_fee_cents, 4_750_000);
  assert.equal(both.values.regulatory_surcharge_cents, null, 'an unknown surcharge stays unknown, never 0');
  assert.equal(classifyReview({ available: false, recommended: v(null) } as any, { annual_fee_cents: 1, revenue_share_bps: 1 }), 'incomplete');
  assert.equal(classifyReview({ available: true, recommended: v(5) } as any, { annual_fee_cents: 5, revenue_share_bps: 600 }), 'unchanged');
  assert.equal(classifyReview({ available: true, recommended: v(6) } as any, { annual_fee_cents: 5, revenue_share_bps: 600 }), 'increase');
  assert.equal(classifyReview({ available: true, recommended: v(4) } as any, { annual_fee_cents: 5, revenue_share_bps: 600 }), 'decrease');
  const snap = { available: true, basis: 'primary_country', recommended: v(5_000_000) } as any;
  const same = planApply(snap, { annual_fee_cents: 5_000_000, revenue_share_bps: 600 }, {}, null);
  assert.ok(same.ok && same.plan.decision === 'accepted' && !same.plan.contractual_change);
  const unavailable = planApply({ ...snap, available: false, recommended: v(null) }, { annual_fee_cents: 1, revenue_share_bps: 1 }, {}, 'x');
  assert.ok(!unavailable.ok && unavailable.code === 'accepted_value_required', 'no recommendation is never applied as zero');
  assert.equal(addYear('2028-02-29'), '2029-02-28');
  assert.equal(addYear('2027-01-01'), '2028-01-01');
});

// Regression for #5652 — synthetic supported-route interleaving.
test('review closure racing the apply must not commit new pricing terms', async () => {
  const {call,env,licence}=fixture();
  const opened=await call(SUPER,'POST',`${P}/reviews`,{});
  assert.equal(opened.status,201);
  const before=licence();
  const original=env.DB.batch.bind(env.DB);
  let raced=false;
  env.DB.batch=async (statements:any[])=>{
    if(raced)return original(statements);raced=true;
    const kept=await call(SUPER,'POST',`${P}/reviews/${opened.body.review.uid}/resolve`,{action:'keep',expected_revision:1,reason:'Keep the current terms'});
    assert.equal(kept.status,200,JSON.stringify(kept));
    return original(statements);
  };
  const response=await call(SUPER,'POST',`${P}/apply`,applyBody(opened.body.snapshot.uid,before.terms_revision,{review_uid:opened.body.review.uid}));
  assert.equal(response.status,409,'the concurrent closed review must win');
  assert.deepEqual(licence(),before,'no terms outlive a review that did not close in this batch');
});

// Regression for #5653 — synthetic supported-route interleaving.
test('a pricing policy change racing the apply must make the snapshot stale at commit', async () => {
  const {call,env,licence}=fixture();
  const snapshot=await call(SUPER,'POST',`${P}/snapshot`,{});
  assert.equal(snapshot.status,201);
  const before=licence();
  const original=env.DB.batch.bind(env.DB);
  let raced=false;
  env.DB.batch=async (statements:any[])=>{
    if(raced)return original(statements);raced=true;
    const changed=await call(SUPER,'PUT',`${P}/policy`,{basis:'primary_country',primary_country:'FR',expected_revision:0,reason:'Record the pricing basis'});
    assert.equal(changed.status,200,JSON.stringify(changed));
    return original(statements);
  };
  const response=await call(SUPER,'POST',`${P}/apply`,applyBody(snapshot.body.snapshot.uid,before.terms_revision));
  assert.equal(response.status,409,'a snapshot at policy revision zero cannot be applied after revision one lands');
  assert.deepEqual(licence(),before);
});
