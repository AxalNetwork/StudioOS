/**
 * D5020 (#5020) — country pricing 7/7, the Worker/API slice: HQ's reads across
 * the ledger, the Needs HQ pricing signals, the audit events and the issue's
 * sixteen end-to-end scenarios.
 *
 * Real SQLite over every migration, the real routers: the D5020 reads, the
 * D5014/D5016 catalogue and models, the D5017 licence pricing, the D5018
 * program grants and reference prices, and the D5019 exclusivity. Nothing is
 * stubbed but the branch binding (absent, so a deployed licence's push fails
 * after HQ commits, as it does in production when a binding is missing).
 *
 * The real clock is never read here: due dates are in 2020 and not-due ones in
 * 2999, so every assertion holds on any day the suite runs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_pricing_hq_5020.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as hqMount } from '../src/routes/admin_licence_pricing_hq.ts';
import { mount as pricingMount } from '../src/routes/admin_licence_pricing.ts';
import { mount as applyMount } from '../src/routes/admin_licence_pricing_apply.ts';
import { mount as exclusivityMount } from '../src/routes/admin_licence_exclusivity.ts';
import { mount as programPricingMount } from '../src/routes/admin_program_pricing.ts';
import grantsRoute from '../src/routes/admin_program_grants.ts';
import { verifySnapshot } from '../src/services/licencePricingSnapshots.ts';
import { V1_MODEL_DRAFT } from '../src/services/licencePricing.ts';
import { nextReviewOn } from '../src/services/licencePricingApply.ts';
import { completenessOf, reviewQueue, signalsFromParam } from '../src/services/licencePricingHq.ts';

const SECRET = ['d5020', 'pricing', 'hq', 'fixture', 'secret'].join('-');
const SUPER = 1, ADMIN = 3;
const REASON = 'Agreed at the HQ pricing review';
const HQ = '/api/admin/licence-pricing';
const L = (uid: string) => `/api/admin/licences/${uid}/pricing`;
const READS = [`${HQ}/catalogue`, `${HQ}/catalogue/FR`, `${HQ}/model-versions`, `${HQ}/review-queue`, `${HQ}/signals`];
const PAST_EFFECTIVE = '2019-01-01', PAST_REVIEW = '2020-01-01', FAR_REVIEW = '2999-01-01';

type Lic = { uid: string; ref: string; countries: string[] };

function fixture(opts: { licences?: Lic[]; branch?: string } = {}) {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(SUPER, 'totp-1'); s.run(ADMIN, 'totp-3');
  // The seeded v1 draft (D5016), activated; three markets recorded with their sources, the other 46 as seeded.
  db.exec("UPDATE pricing_models SET status = 'active', activated_at = '2026-01-01T00:00:00.000Z' WHERE uid = 'pricing-model-v1-seed'");
  const prof = db.prepare(`UPDATE country_market_profiles SET
      population = ?, population_status = 'recorded', population_source = 'World Bank WDI SP.POP.TOTL', population_as_of = ?,
      ppp_gdp_per_capita = ?, ppp_status = 'recorded', ppp_source = 'IMF WEO', ppp_as_of = ?,
      startup_ecosystem_score = ?, startup_score_status = 'recorded', startup_source = 'StartupBlink', startup_as_of = ?,
      regulatory_class = ? WHERE country_code = ?`);
  prof.run(68_000_000, '2025-07-01', 58_000, '2025-10-01', 30_000, '2025-06-01', 'medium', 'FR');
  prof.run(11_700_000, '2025-07-01', 62_000, '2025-10-01', 12_000, '2025-06-01', 'low', 'BE');
  prof.run(84_000_000, '2025-07-01', 66_000, '2025-10-01', 45_000, '2025-06-01', 'medium', 'DE');
  const lic = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (?, ?, ?, 'Licensee', 'Brand', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2027-10-31')`);
  const terr = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?, ?)');
  (opts.licences ?? []).forEach((l, i) => { lic.run(i + 1, l.uid, l.ref); for (const c of l.countries) terr.run(i + 1, c); });
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', ...(opts.branch ? { BRANCH_CODE: opts.branch } : {}) } as any;
  const app = new Hono<any>();
  for (const m of [...hqMount, ...pricingMount, ...applyMount, ...exclusivityMount, ...programPricingMount]) app.route(m.path, m.router);
  app.route('/api/admin/program-grants', grantsRoute);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  const incidents: any[] = [];
  async function call(who: number | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who !== null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const saved = [console.warn, console.error, console.info];
    console.warn = (...a: unknown[]) => {
      try { const j = JSON.parse(String(a[0])); if (j?.event === 'country_pricing_incident') incidents.push(j); } catch { /* another line */ }
    };
    console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const audit = (action: string) => all('SELECT admin_user_id, action, filters_json AS details FROM admin_audit_log WHERE action = ? ORDER BY id', action)
    .map((r) => ({ ...r, details: JSON.parse(r.details || '{}') }));
  const terms = (uid: string) => one('SELECT annual_fee_cents, revenue_share_bps, currency, terms_revision FROM territory_licences WHERE uid = ?', uid);
  const signalsOf = async (uid: string) => (await call(SUPER, 'GET', `${HQ}/signals?licence=${uid}`)).body.items[0];
  return { db, env, call, all, one, audit, terms, signalsOf, incidents };
}

type F = ReturnType<typeof fixture>;
const snapshot = async (f: F, uid: string) => {
  const r = await f.call(SUPER, 'POST', `${L(uid)}/snapshot`, {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.snapshot;
};
const apply = (f: F, uid: string, snapUid: string, extra: Record<string, unknown> = {}) =>
  f.call(SUPER, 'POST', `${L(uid)}/apply`, {
    snapshot_uid: snapUid, expected_terms_revision: f.terms(uid).terms_revision, effective_from: '2026-01-01',
    pricing_review_on: FAR_REVIEW, reason: 'Annual pricing applied', ...extra,
  });
const signContract = (f: F, uid: string) => f.db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title,
    body_md, body_sha256, unfilled_fields, status, created_by_user_id, created_at, updated_at)
  VALUES (?, ?, 'slug', 1, 'Licence agreement', 'Body', 'abc', '[]', 'signed', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run(`ct_${uid}`, uid);
const addInvoice = (f: F, uid: string) => f.db.prepare(`INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency,
    reference, issued_at, due_at, status, figures_json, figures_sha256)
  VALUES (?, ?, '2026–27', '2026-01-01', '2026-12-31', 1000000, 'EUR', ?, '2026-11-01', '2026-12-01', 'issued', '{}', 'x')`).run(`inv_${uid}`, uid, `REF-${uid}`);
/** A decision whose review came due in 2020, so the licence is due today whatever today is. */
const applyPastDue = async (f: F, uid: string) => {
  const snap = await snapshot(f, uid);
  const r = await apply(f, uid, snap.uid, { effective_from: PAST_EFFECTIVE, pricing_review_on: PAST_REVIEW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return snap;
};
const PRICING_TABLES = ['pricing_models', 'country_market_profiles', 'country_market_observations', 'country_pricing_snapshots',
  'licence_pricing_snapshots', 'licence_pricing_decisions', 'licence_pricing_reviews', 'licence_pricing_policies',
  'licence_exclusivity_terms', 'licence_exclusivity_reviews', 'program_pricing_decisions', 'admin_audit_log'];
const everything = (f: F) => Object.fromEntries(PRICING_TABLES.map((t) => [t, f.all(`SELECT * FROM ${t}`)]));

// ── Access ───────────────────────────────────────────────────────────────────

test('every D5020 read is Super Admin and HQ only: allowed for the Super Admin, refused for an admin, a stranger and a branch', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  for (const path of READS) {
    assert.equal((await f.call(SUPER, 'GET', path)).status, 200, `${path} answers the Super Admin`);
    assert.equal((await f.call(ADMIN, 'GET', path)).status, 403, `${path} refuses a plain admin`);
    assert.equal((await f.call(null, 'GET', path)).status, 401, `${path} refuses a request with no session`);
  }
  const branch = fixture({ branch: 'fr-paris' });
  for (const path of READS) {
    const r = await branch.call(SUPER, 'GET', path);
    assert.notEqual(r.status, 200, `${path} is refused on a branch deployment`);
    assert.ok(r.status >= 400 && r.status < 500, `${path} on a branch: ${r.status}`);
  }
});

// ── 1. zero licences / no side effects ───────────────────────────────────────

test('E2E 1 · zero licences: every read answers, nothing is flagged, and no read writes a row', async () => {
  const f = fixture();
  const before = everything(f);
  const cat = await f.call(SUPER, 'GET', `${HQ}/catalogue`);
  assert.equal(cat.status, 200);
  assert.equal(cat.body.total, 49, 'the 49-market catalogue');
  assert.equal(cat.body.stored, false);
  assert.equal(cat.body.model.version, 'v1');
  assert.deepEqual({ complete: cat.body.counts.complete, incomplete: cat.body.counts.incomplete }, { complete: 3, incomplete: 46 });
  const ro = cat.body.countries.find((c: any) => c.country_code === 'RO');
  assert.equal(ro.data_completeness.state, 'incomplete');
  assert.equal(ro.recommendation.available, false);
  assert.equal(ro.recommendation.recommended_annual_fee_cents, null, 'an unpriced market is null, never 0');
  assert.equal(ro.recommendation.recommended_initial_fee_cents, null);
  assert.ok(ro.recommendation_reason, 'and says why');
  assert.equal(ro.last_source_update, null);
  assert.equal(ro.last_source_update_reason, 'Not recorded');
  assert.equal(ro.regulatory_class_reason, 'Not recorded');
  const q = await f.call(SUPER, 'GET', `${HQ}/review-queue?within_days=366`);
  assert.deepEqual([q.body.items, q.body.no_decision, q.body.total], [[], [], 0]);
  const sig = await f.call(SUPER, 'GET', `${HQ}/signals`);
  assert.deepEqual(sig.body.items, []);
  assert.deepEqual(Object.values(sig.body.counts).map((c: any) => c.count), [0, 0, 0, 0]);
  await f.call(SUPER, 'GET', `${HQ}/catalogue/FR`);
  await f.call(SUPER, 'GET', `${HQ}/model-versions`);
  assert.deepEqual(everything(f), before, 'reads write nothing: no snapshot, decision, review, audit row or profile change');
});

// ── 2. single-country recommendation ─────────────────────────────────────────

test('E2E 2 · one country: the catalogue, the country detail and the frozen snapshot agree, with trace and provenance', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const snap = await snapshot(f, 'lic_a');
  const country = f.one('SELECT * FROM country_pricing_snapshots WHERE uid = ?', snap.lead_snapshot_uid);
  const fr = (await f.call(SUPER, 'GET', `${HQ}/catalogue?q=fr`)).body.countries.find((c: any) => c.country_code === 'FR');
  assert.equal(fr.recommendation.recommended_annual_fee_cents, country.recommended_annual_fee_cents);
  assert.equal(fr.recommendation.recommended_initial_fee_cents, country.recommended_initial_fee_cents);
  assert.equal(fr.recommendation.country_index, country.country_index);
  assert.equal(fr.recommendation.tier, country.tier);
  assert.equal(fr.regulatory_class, 'medium');
  assert.equal(fr.data_completeness.state, 'complete');
  assert.equal(fr.last_source_update, '2025-10-01', 'the newest source as-of date');
  const d = await f.call(SUPER, 'GET', `${HQ}/catalogue/FR`);
  assert.equal(d.status, 200);
  assert.equal(d.body.model.version, 'v1', 'the recommendation names its model version');
  assert.equal(d.body.calculation.source_digest, country.source_digest, 'calculated now, it reproduces the frozen snapshot exactly');
  assert.equal(d.body.calculation.stored, false);
  assert.ok(d.body.calculation.recommendation.trace && Object.keys(d.body.calculation.recommendation.trace).length > 0, 'the calculation trace');
  assert.deepEqual(
    { value: d.body.inputs.purchasing_power.value, status: d.body.inputs.purchasing_power.status, source: d.body.inputs.purchasing_power.source, as_of: d.body.inputs.purchasing_power.as_of },
    { value: 58_000, status: 'recorded', source: 'IMF WEO', as_of: '2025-10-01' }, 'each input carries its provenance');
  assert.ok(d.body.snapshots.some((s: any) => s.uid === country.uid));
  assert.equal((await f.call(SUPER, 'GET', `${HQ}/catalogue/ZZ`)).status, 404);
  assert.equal((await f.call(SUPER, 'GET', `${HQ}/catalogue/1x`)).status, 400);
  // A refresh is not a decision: the licence has none recorded and is listed apart, never as due.
  const s = await f.signalsOf('lic_a');
  assert.equal(s.pricing_decision, 'not_recorded');
  assert.equal(s.pricing_decision_reason, 'No pricing decision recorded');
  assert.deepEqual(s.signals, { pricing_review_due: false, pricing_data_incomplete: false, pricing_overridden: false, exclusivity_at_risk: false });
  const q = (await f.call(SUPER, 'GET', `${HQ}/review-queue`)).body;
  assert.deepEqual(q.items, []);
  assert.deepEqual(q.no_decision.map((x: any) => [x.licence_uid, x.reason]), [['lic_a', 'No pricing decision recorded']]);
});

// ── 3. provisional ecosystem data ────────────────────────────────────────────

test('E2E 3 · provisional ecosystem data: not priced by default, priced and flagged when allowed, and the licence is flagged', async () => {
  const f = fixture({ licences: [{ uid: 'lic_be', ref: 'AXL-BE', countries: ['BE'] }] });
  const rev = f.one("SELECT revision FROM country_market_profiles WHERE country_code = 'BE'").revision;
  const marked = await f.call(SUPER, 'PUT', `${HQ}/countries/BE/fields/startup_ecosystem_score/status`, { status: 'provisional', reason: 'Proxy approved by HQ', expected_revision: rev });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  const be = (await f.call(SUPER, 'GET', `${HQ}/catalogue`)).body.countries.find((c: any) => c.country_code === 'BE');
  assert.equal(be.data_completeness.state, 'provisional');
  assert.deepEqual(be.data_completeness.provisional_inputs, ['startup_ecosystem']);
  assert.equal(be.recommendation.available, false);
  assert.equal(be.recommendation.recommended_annual_fee_cents, null);
  const allowed = (await f.call(SUPER, 'GET', `${HQ}/catalogue?allow_provisional=1`)).body.countries.find((c: any) => c.country_code === 'BE');
  assert.equal(allowed.recommendation.available, true);
  assert.equal(allowed.recommendation.complete, false, 'a provisional figure is never complete');
  assert.ok(Number.isInteger(allowed.recommendation.recommended_annual_fee_cents));
  const s = await f.signalsOf('lic_be');
  assert.equal(s.signals.pricing_data_incomplete, true);
  assert.match(s.reasons.pricing_data_incomplete, /BE/);
  assert.deepEqual(s.pricing_data.countries, [{ country_code: 'BE', state: 'provisional', missing: [], provisional: ['startup_ecosystem'] }]);
  const snap = await snapshot(f, 'lic_be');
  assert.equal(snap.available, false);
  assert.ok(f.incidents.some((i) => i.kind === 'market_data_incomplete' && i.licence_uid === 'lic_be'), 'the logs say the market data is incomplete');
  const incomplete = (await f.call(SUPER, 'GET', `${HQ}/signals?needs=pricing_data_incomplete`)).body;
  assert.deepEqual(incomplete.items.map((x: any) => x.licence_uid), ['lic_be']);
});

// ── 4. apply recommendation ──────────────────────────────────────────────────

test('E2E 4 · apply: the decision is recorded, nothing is flagged, and the audit names the decision', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const snap = await snapshot(f, 'lic_a');
  const r = await apply(f, 'lic_a', snap.uid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await f.signalsOf('lic_a');
  assert.equal(s.pricing_decision, 'recorded');
  assert.equal(s.latest_decision.decision, 'accepted');
  assert.equal(s.next_review_on, FAR_REVIEW);
  assert.deepEqual(s.signals, { pricing_review_due: false, pricing_data_incomplete: false, pricing_overridden: false, exclusivity_at_risk: false });
  const q = (await f.call(SUPER, 'GET', `${HQ}/review-queue`)).body;
  assert.deepEqual([q.items, q.no_decision], [[], []]);
  const [a] = f.audit('licence_pricing_applied');
  assert.equal(a.admin_user_id, SUPER);
  assert.equal(a.details.decision, 'accepted');
  assert.equal(a.details.model_version, 'v1');
  assert.equal(a.details.review_uid, null);
  const [taken] = f.audit('licence_pricing_snapshot_taken');
  assert.deepEqual(taken.details.country_snapshots, [{ country_code: 'FR', snapshot_uid: snap.lead_snapshot_uid, weight_bps: 10000 }],
    'the snapshot audit names every country snapshot it froze');
});

// ── 5. manual override ───────────────────────────────────────────────────────

test('E2E 5 · override: the ledger flags overridden pricing, and the Needs HQ filter finds exactly it', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }, { uid: 'lic_b', ref: 'AXL-B', countries: ['DE'] }] });
  const sa = await snapshot(f, 'lic_a');
  const sb = await snapshot(f, 'lic_b');
  assert.equal((await apply(f, 'lic_a', sa.uid, { accepted: { annual_fee_cents: 4_200_000 }, override_reason: 'Launch discount agreed with the board' })).status, 200);
  assert.equal((await apply(f, 'lic_b', sb.uid)).status, 200);
  const s = await f.signalsOf('lic_a');
  assert.equal(s.signals.pricing_overridden, true);
  assert.match(s.reasons.pricing_overridden, /Launch discount/);
  assert.equal((await f.signalsOf('lic_b')).signals.pricing_overridden, false);
  const filtered = (await f.call(SUPER, 'GET', `${HQ}/signals?needs=pricing_overridden`)).body;
  assert.deepEqual(filtered.items.map((x: any) => x.licence_uid), ['lic_a']);
  assert.equal(filtered.counts.pricing_overridden.count, 1);
  assert.equal((await f.call(SUPER, 'GET', `${HQ}/signals?needs=nonsense`)).status, 400);
  const over = f.audit('licence_pricing_applied').find((x) => x.details.licence_uid === 'lic_a');
  assert.equal(over.details.decision, 'overridden');
  assert.equal(over.details.override_reason, 'Launch discount agreed with the board');
});

// ── 6. stale terms revision ──────────────────────────────────────────────────

test('E2E 6 · a stale terms revision writes nothing, is not audited as applied, and is logged as a stale conflict', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const snap = await snapshot(f, 'lic_a');
  const rev = f.terms('lic_a').terms_revision;
  const body = { snapshot_uid: snap.uid, expected_terms_revision: rev, effective_from: '2026-01-01', reason: 'Annual pricing applied' };
  assert.equal((await f.call(SUPER, 'POST', `${L('lic_a')}/apply`, body)).status, 200);
  const after = f.terms('lic_a');
  const stale = await f.call(SUPER, 'POST', `${L('lic_a')}/apply`, { ...body, accepted: { annual_fee_cents: 1 }, override_reason: 'The stale editor typed this' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code ?? stale.body.error, 'terms_conflict');
  assert.deepEqual(f.terms('lic_a'), after);
  assert.equal(f.all('SELECT * FROM licence_pricing_decisions').length, 1);
  assert.equal(f.audit('licence_pricing_applied').length, 1, 'the lost write is not audited as a decision');
  assert.ok(f.incidents.some((i) => i.kind === 'stale_revision_conflict' && i.code === 'terms_conflict'));
  assert.equal((await f.signalsOf('lic_a')).signals.pricing_overridden, false, 'the stale override never reached the ledger');
});

// ── 7. market refresh after signed licence ───────────────────────────────────

test('E2E 7 · a market refresh after the licence is signed changes no term, agreement or snapshot; only future figures move', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const snap = await snapshot(f, 'lic_a');
  assert.equal((await apply(f, 'lic_a', snap.uid)).status, 200);
  signContract(f, 'lic_a');
  const before = { terms: f.terms('lic_a'), contract: f.all('SELECT * FROM licence_contracts'), decisions: f.all('SELECT * FROM licence_pricing_decisions'), snapshots: f.all('SELECT * FROM country_pricing_snapshots') };
  const rev = f.one("SELECT revision FROM country_market_profiles WHERE country_code = 'FR'").revision;
  const obs = await f.call(SUPER, 'POST', `${HQ}/countries/FR/observations`, { field: 'ppp_gdp_per_capita', value: 90_000, status: 'recorded', source: 'IMF WEO', as_of: '2026-10-01', reason: 'October release', expected_revision: rev });
  assert.equal(obs.status, 201, JSON.stringify(obs.body));
  assert.deepEqual({ terms: f.terms('lic_a'), contract: f.all('SELECT * FROM licence_contracts'), decisions: f.all('SELECT * FROM licence_pricing_decisions'), snapshots: f.all('SELECT * FROM country_pricing_snapshots') }, before);
  assert.equal((await verifySnapshot(f.env, snap.lead_snapshot_uid)).matches, true, 'the old snapshot still reproduces from itself');
  const d = (await f.call(SUPER, 'GET', `${HQ}/catalogue/FR`)).body;
  assert.notEqual(d.calculation.source_digest, before.snapshots[0].source_digest, 'the catalogue prices from the new data');
  assert.equal(d.last_source_update, '2026-10-01');
  assert.equal(d.observations[0].as_of, '2026-10-01', 'the observation history carries the new source');
  const [o] = f.audit('licence_pricing_observation_recorded');
  assert.equal(o.details.country_code, 'FR');
});

// ── 8. annual repricing kept without change ──────────────────────────────────

test('E2E 8 · a due review with no open row is in the queue and flagged; HQ keeps the terms and it leaves the queue', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }, { uid: 'lic_b', ref: 'AXL-B', countries: ['DE'] }] });
  await applyPastDue(f, 'lic_a');
  const sb = await snapshot(f, 'lic_b');
  assert.equal((await apply(f, 'lic_b', sb.uid)).status, 200);
  // S1 2026-11-09 23:51Z: due, and nobody opened a review for it.
  assert.equal(f.all('SELECT * FROM licence_pricing_reviews').length, 0);
  const q = (await f.call(SUPER, 'GET', `${HQ}/review-queue`)).body;
  assert.deepEqual(q.items.map((x: any) => [x.licence_uid, x.due_on, x.review_row, x.due]), [['lic_a', PAST_REVIEW, 'none', true]]);
  assert.equal(q.without_open_review, 1);
  assert.ok(q.items[0].days_overdue > 300);
  const s = await f.signalsOf('lic_a');
  assert.equal(s.signals.pricing_review_due, true);
  assert.match(s.reasons.pricing_review_due, /no review is open/);
  assert.equal((await f.signalsOf('lic_b')).signals.pricing_review_due, false);
  // HQ opens it: still listed, now with its row.
  const opened = await f.call(SUPER, 'POST', `${L('lic_a')}/reviews`, {});
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  assert.equal(opened.body.review.due_on, PAST_REVIEW);
  const q2 = (await f.call(SUPER, 'GET', `${HQ}/review-queue`)).body;
  assert.deepEqual(q2.items.map((x: any) => [x.licence_uid, x.review_row, x.open_review?.uid]), [['lic_a', 'open', opened.body.review.uid]]);
  const before = f.terms('lic_a');
  const kept = await f.call(SUPER, 'POST', `${L('lic_a')}/reviews/${opened.body.review.uid}/resolve`, { action: 'keep', reason: 'Market unchanged; keep the terms', expected_revision: 1 });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.deepEqual(f.terms('lic_a'), before, 'keeping changes no term');
  assert.deepEqual((await f.call(SUPER, 'GET', `${HQ}/review-queue`)).body.items, [], 'a kept review is not due again for a year');
  assert.equal((await f.signalsOf('lic_a')).signals.pricing_review_due, false);
  const resolved = f.audit('licence_pricing_review_resolved');
  assert.deepEqual(resolved.map((x) => [x.details.review_uid, x.details.action]), [[opened.body.review.uid, 'keep']]);
});

// ── 9 & 10. annual repricing applied → agreement mismatch; issued invoice frozen ─

test('E2E 9–10 · a due review applied: the review closes, the agreement reads mismatch, and the issued invoice is frozen', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  addInvoice(f, 'lic_a');
  const invoices = f.all('SELECT * FROM licence_fee_invoices');
  await applyPastDue(f, 'lic_a');
  signContract(f, 'lic_a');
  const opened = (await f.call(SUPER, 'POST', `${L('lic_a')}/reviews`, {})).body;
  // Make the review's recommendation differ from the current terms, so applying it changes a contractual figure.
  const r = await apply(f, 'lic_a', opened.snapshot.uid, {
    review_uid: opened.review.uid, accepted: { annual_fee_cents: 7_750_000 }, override_reason: 'Repriced at the annual review', acknowledge_agreement_mismatch: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(f.one('SELECT state FROM licence_pricing_reviews WHERE uid = ?', opened.review.uid).state, 'overridden');
  assert.equal((await f.call(SUPER, 'GET', L('lic_a'))).body.agreement.state, 'mismatch');
  assert.deepEqual((await f.call(SUPER, 'GET', `${HQ}/review-queue`)).body.items, [], 'the review is decided and leaves the queue');
  assert.deepEqual(f.all('SELECT * FROM licence_fee_invoices'), invoices, 'an issued invoice is frozen');
  const applied = f.audit('licence_pricing_applied').pop()!;
  assert.equal(applied.details.review_uid, opened.review.uid, 'the annual review decision is on the audit record');
  assert.equal(applied.details.decision, 'overridden');
});

// ── 11 & 12. program grant accepts derived price; renewal reprices, old term frozen ─

test('E2E 11–12 · a program grant takes the derived price; a later repricing is a new decision and the old one stays', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const pub = await f.call(SUPER, 'POST', '/api/admin/program-pricing/defaults/spinout-lab', { currency: 'EUR', base_annual_fee_cents: 2_000_000, effective_from: '2026-12-01', reason: 'Reference price v1', expected_version: 0 });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  const s1 = await snapshot(f, 'lic_a');
  const index1 = f.one('SELECT country_index FROM country_pricing_snapshots WHERE uid = ?', s1.lead_snapshot_uid).country_index;
  const expected1 = Math.round((2_000_000 * index1) / 1_000_000 / 250_000) * 250_000;
  const G = '/api/admin/program-grants/licences/lic_a/spinout-lab';
  const granted = await f.call(SUPER, 'POST', G, { reason: REASON, pricing: { licence_snapshot_uid: s1.uid } });
  assert.equal(granted.status, 201, JSON.stringify(granted.body));
  assert.equal(granted.body.grant.terms.fee_cents, expected1);
  const first = f.one('SELECT * FROM program_pricing_decisions WHERE sequence = 1');
  const [a1] = f.audit('program_pricing_decided');
  assert.deepEqual([a1.admin_user_id, a1.details.decision, a1.details.accepted_annual_fee_cents, a1.details.licence_snapshot_uid, a1.details.write],
    [SUPER, 'accepted', expected1, s1.uid, 'grant'], 'the program pricing decision is audited');
  // The market moves; HQ reprices the program at renewal from a fresh recommendation.
  f.db.prepare("UPDATE country_market_profiles SET ppp_gdp_per_capita = 90000, revision = revision + 1 WHERE country_code = 'FR'").run();
  const s2 = await snapshot(f, 'lic_a');
  assert.equal(f.one("SELECT fee_cents FROM program_grants WHERE program_key = 'spinout-lab'").fee_cents, expected1, 'a refresh alone never reprices a grant');
  const index2 = f.one('SELECT country_index FROM country_pricing_snapshots WHERE uid = ?', s2.lead_snapshot_uid).country_index;
  const expected2 = Math.round((2_000_000 * index2) / 1_000_000 / 250_000) * 250_000;
  assert.notEqual(expected2, expected1, 'the fixture moves the price');
  const renewed = await f.call(SUPER, 'PATCH', G, { reason: REASON, pricing: { licence_snapshot_uid: s2.uid } });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(f.one("SELECT fee_cents FROM program_grants WHERE program_key = 'spinout-lab'").fee_cents, expected2);
  assert.deepEqual(f.one('SELECT * FROM program_pricing_decisions WHERE sequence = 1'), first, 'the old term stays frozen');
  assert.equal(f.one('SELECT accepted_annual_fee_cents FROM program_pricing_decisions WHERE sequence = 2').accepted_annual_fee_cents, expected2);
  assert.deepEqual(f.audit('program_pricing_decided').map((x) => [x.details.write, x.details.accepted_annual_fee_cents]), [['grant', expected1], ['terms_changed', expected2]]);
});

// ── 13. multi-country basket ─────────────────────────────────────────────────

test('E2E 13 · a basket: complete only while every country is; one country losing data flags the licence and unprices it', async () => {
  const f = fixture({ licences: [{ uid: 'lic_bf', ref: 'AXL-BF', countries: ['BE', 'FR'] }] });
  const needBasis = await f.signalsOf('lic_bf');
  assert.ok(needBasis.pricing_data.basis_problem, 'two countries and no basis: the read says a basis is needed');
  assert.equal((await f.call(SUPER, 'PUT', `${L('lic_bf')}/policy`, { basis: 'basket_weighted', weights: { FR: 6000, BE: 4000 }, reason: 'Weighted by revenue', expected_revision: 0 })).status, 200);
  const s = await f.signalsOf('lic_bf');
  assert.equal(s.pricing_data.basis_problem, null);
  assert.deepEqual(s.pricing_data.countries.map((c: any) => [c.country_code, c.state]), [['BE', 'complete'], ['FR', 'complete']]);
  assert.equal(s.signals.pricing_data_incomplete, false);
  assert.equal((await snapshot(f, 'lic_bf')).available, true);
  const rev = f.one("SELECT revision FROM country_market_profiles WHERE country_code = 'BE'").revision;
  assert.equal((await f.call(SUPER, 'PUT', `${HQ}/countries/BE/fields/ppp_gdp_per_capita/status`, { status: 'not_recorded', reason: 'Source withdrawn', expected_revision: rev })).status, 200);
  const after = await f.signalsOf('lic_bf');
  assert.equal(after.signals.pricing_data_incomplete, true);
  assert.match(after.reasons.pricing_data_incomplete, /BE/);
  assert.doesNotMatch(after.reasons.pricing_data_incomplete, /FR/);
  assert.equal((await snapshot(f, 'lic_bf')).available, false, 'a basket is never priced from the countries that happen to have data');
  const be = (await f.call(SUPER, 'GET', `${HQ}/catalogue?incomplete=1`)).body.countries.find((c: any) => c.country_code === 'BE');
  assert.deepEqual(be.data_completeness.missing, ['purchasing_power']);
});

// ── 14. exclusivity review ───────────────────────────────────────────────────

test('E2E 14 · exclusivity: a missed commitment flags the licence at risk; HQ continues it and the flag clears', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const X = '/api/admin/licences/lic_a/exclusivity';
  const set = await f.call(SUPER, 'PUT', X, { reason: REASON, expected_revision: 0, scope_type: 'country_exclusive', territory: { countries: ['FR'] },
    targets: [{ year: 1, period_start: '2020-01-01', period_end: '2020-12-31', min_revenue_cents: 10_000_000 }], cure_period_days: 90 });
  assert.equal(set.status, 201, JSON.stringify(set.body));
  assert.equal((await f.signalsOf('lic_a')).signals.exclusivity_at_risk, false);
  const obs = await f.call(SUPER, 'POST', `${X}/observations`, { metric: 'qualifying_revenue_cents', period_start: '2020-01-01', period_end: '2020-12-31', value: 1_000_000, source: 'Audited statement 2020', reason: 'Year-end figures' });
  assert.equal(obs.status, 201, JSON.stringify(obs.body));
  const risk = await f.signalsOf('lic_a');
  assert.equal(risk.signals.exclusivity_at_risk, true);
  assert.equal(risk.exclusivity.state, 'at_risk');
  assert.equal(risk.exclusivity.review_open, true);
  assert.deepEqual((await f.call(SUPER, 'GET', `${HQ}/signals?needs=exclusivity_at_risk`)).body.items.map((x: any) => x.licence_uid), ['lic_a']);
  const review = f.one("SELECT uid FROM licence_exclusivity_reviews WHERE state = 'open'");
  const rev = f.one('SELECT revision FROM licence_exclusivity_terms WHERE superseded_at IS NULL').revision;
  const cont = await f.call(SUPER, 'POST', `${X}/reviews/${review.uid}/resolve`, { action: 'continue', reason: REASON, acknowledge_consequence: true, expected_revision: rev });
  assert.equal(cont.status, 200, JSON.stringify(cont.body));
  assert.equal((await f.signalsOf('lic_a')).signals.exclusivity_at_risk, false);
  assert.equal(f.audit('licence_exclusivity_set').length, 1);
  assert.deepEqual(f.audit('licence_exclusivity_review_resolved').map((x) => x.details.action), ['continue']);
});

// ── 15. branch push failure after HQ commit ──────────────────────────────────

test('E2E 15 · the branch push fails after HQ commits: the decision stands, the answer says partial, the logs say so', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  f.db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
    VALUES ('lic_a', 'fr-paris', 'fr-paris.example.test', 'studioos-fr-paris', 'studioos-fr-paris', 'live')`).run();
  const snap = await snapshot(f, 'lic_a');
  const r = await apply(f, 'lic_a', snap.uid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.committed, true);
  assert.equal(r.body.push_outcome, 'partial');
  assert.equal(r.body.pushed.ok, false);
  assert.equal(f.terms('lic_a').annual_fee_cents, snap.recommended.annual_fee_cents, 'HQ\'s commit stands');
  assert.equal(f.all('SELECT * FROM licence_pricing_decisions').length, 1);
  assert.equal(f.audit('licence_pricing_applied')[0].details.push, 'partial');
  const inc = f.incidents.find((i) => i.kind === 'branch_push_partial');
  assert.ok(inc, 'the partial push is its own log line');
  assert.equal(inc.licence_uid, 'lic_a');
  assert.equal(inc.decision_uid, r.body.decision.uid);
});

// ── 16. model v2 activation leaves v1 snapshots reproducible ─────────────────

test('E2E 16 · activating v2 retires v1; v1 snapshots still reproduce; the versions read shows the history', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const v1Snap = await snapshot(f, 'lic_a');
  const v1Country = f.one('SELECT * FROM country_pricing_snapshots WHERE uid = ?', v1Snap.lead_snapshot_uid);
  const draft = await f.call(SUPER, 'POST', `${HQ}/models`, { ...V1_MODEL_DRAFT, version: 'v2', reference_annual_fee_cents: 6_000_000, effective_from: '2027-01-01' });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const drafts = (await f.call(SUPER, 'GET', `${HQ}/model-versions`)).body;
  assert.deepEqual(drafts.drafts.map((m: any) => m.version), ['v2']);
  assert.equal(drafts.current.version, 'v1');
  // The selector previews a draft without activating it.
  const preview = (await f.call(SUPER, 'GET', `${HQ}/catalogue?model=${draft.body.model.uid}`)).body;
  assert.equal(preview.model.status, 'draft');
  assert.equal((await f.call(SUPER, 'GET', `${HQ}/catalogue?model=nope`)).status, 404);
  assert.equal((await f.call(SUPER, 'GET', `${HQ}/catalogue?model=bad%20id`)).status, 400);
  const act = await f.call(SUPER, 'POST', `${HQ}/models/${draft.body.model.uid}/activate`, { reason: 'Approved v2 fixtures' });
  assert.equal(act.status, 200, JSON.stringify(act.body));
  const v = (await f.call(SUPER, 'GET', `${HQ}/model-versions`)).body;
  assert.equal(v.current.version, 'v2');
  assert.deepEqual(v.retired.map((m: any) => m.version), ['v1']);
  assert.equal(v.retired[0].usage.country_snapshots, 1);
  assert.equal(v.retired[0].usage.licence_snapshots, 1);
  assert.ok(v.history.some((h: any) => h.event === 'activated' && h.version === 'v2' && h.by === `user:${SUPER}`));
  assert.ok(v.history.some((h: any) => h.event === 'retired' && h.version === 'v1'));
  assert.equal((await verifySnapshot(f.env, v1Snap.lead_snapshot_uid)).matches, true, 'a v1 snapshot reproduces after v2 is active');
  const now = (await f.call(SUPER, 'GET', `${HQ}/catalogue`)).body;
  assert.equal(now.model.version, 'v2', 'every displayed recommendation names its model version');
  const old = (await f.call(SUPER, 'GET', `${HQ}/catalogue/FR?model=pricing-model-v1-seed`)).body;
  assert.equal(old.model.status, 'retired');
  assert.equal(old.calculation.source_digest, v1Country.source_digest, 'the retired version recalculates its own snapshot exactly');
  const [a] = f.audit('licence_pricing_model_activated');
  assert.equal(a.details.version, 'v2');
  assert.equal(a.details.retired_model_uid, 'pricing-model-v1-seed');
});

// ── Audit events and honesty ─────────────────────────────────────────────────

test('every audit event the issue lists is written, with its actor', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  const rev = f.one("SELECT revision FROM country_market_profiles WHERE country_code = 'FR'").revision;
  assert.equal((await f.call(SUPER, 'PATCH', `${HQ}/countries/FR`, { regulatory_class: 'high', reason: 'Regulator update', expected_revision: rev })).status, 200);
  const snap = await snapshot(f, 'lic_a');
  assert.equal((await apply(f, 'lic_a', snap.uid, { accepted: { annual_fee_cents: 3_000_000 }, override_reason: 'Board discount' })).status, 200);
  const opened = (await f.call(SUPER, 'POST', `${L('lic_a')}/reviews`, {})).body;
  assert.equal((await f.call(SUPER, 'POST', `${L('lic_a')}/reviews/${opened.review.uid}/resolve`, { action: 'keep', reason: 'Keep for now', expected_revision: 1 })).status, 200);
  assert.equal((await f.call(SUPER, 'PUT', '/api/admin/licences/lic_a/exclusivity', { reason: REASON, expected_revision: 0, scope_type: 'country_exclusive', territory: { countries: ['FR'] } })).status, 201);
  await f.call(SUPER, 'POST', '/api/admin/program-pricing/defaults/spinout-lab', { currency: 'EUR', base_annual_fee_cents: 2_000_000, effective_from: '2026-12-01', reason: 'Reference price v1', expected_version: 0 });
  assert.equal((await f.call(SUPER, 'POST', '/api/admin/program-grants/licences/lic_a/spinout-lab', { reason: REASON, pricing: {} })).status, 201);
  const draft = (await f.call(SUPER, 'POST', `${HQ}/models`, { ...V1_MODEL_DRAFT, version: 'v2', effective_from: '2027-01-01' })).body.model;
  assert.equal((await f.call(SUPER, 'POST', `${HQ}/models/${draft.uid}/activate`, { reason: 'Approved v2' })).status, 200);
  const expected = {
    'country profile change': 'licence_pricing_profile_updated',
    'model activation': 'licence_pricing_model_activated',
    'snapshot creation': 'licence_pricing_snapshot_taken',
    'apply/override': 'licence_pricing_applied',
    'annual review decision': 'licence_pricing_review_resolved',
    'exclusivity change': 'licence_exclusivity_set',
    'program pricing decision': 'program_pricing_decided',
  };
  for (const [what, action] of Object.entries(expected)) {
    const rows = f.audit(action);
    assert.equal(rows.length, 1, `${what} is audited once as ${action}`);
    assert.equal(rows[0].admin_user_id, SUPER, `${what} names its actor`);
  }
});

test('a store that cannot be read makes its signal Unreadable (null), never a clear "no"', async () => {
  const f = fixture({ licences: [{ uid: 'lic_a', ref: 'AXL-A', countries: ['FR'] }] });
  f.db.exec('DROP TABLE licence_exclusivity_reviews');
  const s = await f.signalsOf('lic_a');
  assert.equal(s.signals.exclusivity_at_risk, null);
  assert.match(s.reasons.exclusivity_at_risk, /Unreadable/);
  assert.equal(s.signals.pricing_data_incomplete, false, 'the other signals still answer');
  const counts = (await f.call(SUPER, 'GET', `${HQ}/signals`)).body.counts;
  assert.deepEqual(counts.exclusivity_at_risk, { count: 0, unreadable: 1 });
});

test('the pure rules: a kept review moves the next date a year on; completeness; the queue window; the needs param', () => {
  const r = (state: string, extra: Record<string, unknown> = {}) => ({ state, due_on: '2020-01-01', postponed_until: null, resolved_at: null, ...extra }) as any;
  assert.equal(nextReviewOn('2020-01-01', []), '2020-01-01');
  assert.equal(nextReviewOn('2020-01-01', [r('kept', { resolved_at: '2026-03-04T10:00:00.000Z' })]), '2027-03-04', 'keep: due again a year after it was kept');
  assert.equal(nextReviewOn('2030-01-01', [r('kept', { resolved_at: '2026-03-04T10:00:00.000Z' })]), '2030-01-01', 'a later decision date wins');
  assert.equal(nextReviewOn('2020-01-01', [r('postponed', { postponed_until: '2028-01-01' })]), '2028-01-01');
  assert.equal(nextReviewOn('2030-01-01', [r('open', { due_on: '2021-05-05' })]), '2021-05-05', 'an open review\'s due date wins');
  assert.equal(nextReviewOn(null, []), null, 'no decision, no review: no date');
  const p = (s: [string, string, string]) => ({ ppp_status: s[0], startup_score_status: s[1], population_status: s[2] }) as any;
  assert.equal(completenessOf(p(['recorded', 'recorded', 'recorded'])).state, 'complete');
  assert.equal(completenessOf(p(['recorded', 'provisional', 'recorded'])).state, 'provisional');
  assert.equal(completenessOf(p(['not_recorded', 'provisional', 'recorded'])).state, 'incomplete', 'missing wins over provisional');
  const st = (uid: string, next: string | null, decided = true) => ({
    licence_uid: uid, licence_ref: uid, brand_name: '', status: 'active', terms: {}, territory: [], pricing_decision: decided ? 'recorded' : 'not_recorded',
    latest_decision: null, next_review_on: next, open_review: null, pricing_data: null, exclusivity: null,
    signals: { pricing_review_due: false, pricing_data_incomplete: false, pricing_overridden: false, exclusivity_at_risk: false }, reasons: {},
  }) as any;
  const q = reviewQueue([st('a', '2026-03-01'), st('b', '2026-03-20'), st('c', '2026-01-01'), st('d', null, false)], '2026-03-10', 15);
  assert.deepEqual(q.items.map((i: any) => [i.licence_uid, i.due, i.days_overdue]), [['c', true, 68], ['a', true, 9], ['b', false, 0]]);
  assert.equal(q.due, 2);
  assert.deepEqual(q.no_decision.map((x: any) => x.licence_uid), ['d']);
  assert.deepEqual(reviewQueue([st('b', '2026-03-20')], '2026-03-10', 0).items, [], 'without a window, only what is due');
  assert.deepEqual(signalsFromParam('exclusivity_at_risk,pricing_review_due,bogus'), ['pricing_review_due', 'exclusivity_at_risk']);
});
