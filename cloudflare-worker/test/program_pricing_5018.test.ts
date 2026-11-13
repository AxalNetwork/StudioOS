/**
 * D5018 (#5018) — program prices from the country index; frozen grant economics.
 *
 * Real SQLite over every migration, the real routers (program grants, program
 * pricing, licence pricing). Pinned, from the issue's acceptance criteria:
 *   · every priced program shows base → country-adjusted → accepted;
 *   · a missing base price is "Not recorded", never zero or free;
 *   · accepted grant economics survive country and model updates, and pausing
 *     or resuming never reprices;
 *   · an override needs a reason and records its actor;
 *   · one licence holds different accepted prices for different programs;
 *   · the history is queryable and exportable.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_pricing_5018.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as pricingApplyMount } from '../src/routes/admin_licence_pricing_apply.ts';
import { mount as programPricingMount } from '../src/routes/admin_program_pricing.ts';
import grantsRoute from '../src/routes/admin_program_grants.ts';
import { recommendProgramFee, validateDefaultBody } from '../src/services/programPricing.ts';

const SECRET = ['d5018', 'program', 'pricing', 'fixture', 'secret'].join('-');
const SUPER = 1, ADMIN = 3;
const LIC = 'lic_5018';
const REASON = 'Approved at the November HQ review.';

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(SUPER, 'totp-1'); s.run(ADMIN, 'totp-3');
  db.exec("UPDATE pricing_models SET status = 'active', activated_at = datetime('now') WHERE uid = 'pricing-model-v1-seed'");
  db.prepare(`UPDATE country_market_profiles SET population = 68000000, population_status = 'recorded', ppp_gdp_per_capita = 58000, ppp_status = 'recorded',
      startup_ecosystem_score = 30000, startup_score_status = 'recorded', regulatory_class = 'medium' WHERE country_code = 'FR'`).run();
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-5018', 'Licensee', 'Brand', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2027-10-31')`).run(LIC);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  for (const m of [...programPricingMount, ...pricingApplyMount]) app.route(m.path, m.router);
  app.route('/api/admin/program-grants', grantsRoute);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json, type: res.headers.get('Content-Type') };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  return { db, call, all, one };
}

const D = '/api/admin/program-pricing/defaults';
const publish = (call: any, program: string, base: number, expected = 0, extra: Record<string, unknown> = {}) =>
  call(SUPER, 'POST', `${D}/${program}`, { currency: 'EUR', base_annual_fee_cents: base, effective_from: '2026-12-01', reason: 'Reference price v1', expected_version: expected, ...extra });
const G = `/api/admin/program-grants/licences/${LIC}`;

test('a reference price is versioned and frozen; a missing one reads Not recorded', async () => {
  const { call, db, one } = fixture();
  const read = await call(SUPER, 'GET', D);
  const spin = read.body.programs.find((p: any) => p.program_key === 'spinout-lab');
  assert.equal(spin.active, null);
  assert.match(spin.reason, /Not free|not free/);
  assert.equal((await call(ADMIN, 'GET', D)).status, 403);
  const v1 = await publish(call, 'spinout-lab', 2_000_000);
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  assert.equal(v1.body.default.version, 1);
  assert.equal((await publish(call, 'spinout-lab', 2_100_000, 0)).status, 409, 'a stale publish is refused');
  const v2 = await publish(call, 'spinout-lab', 2_200_000, 1);
  assert.equal(v2.status, 201);
  assert.equal(one("SELECT status FROM program_pricing_defaults WHERE version = 1 AND program_key = 'spinout-lab'").status, 'retired');
  assert.throws(() => db.exec("UPDATE program_pricing_defaults SET base_annual_fee_cents = 1 WHERE version = 2 AND program_key = 'spinout-lab'"), /immutable/);
  assert.throws(() => db.exec("DELETE FROM program_pricing_defaults"), /immutable/);
  assert.equal((await publish(call, 'no-such-program', 1)).status, 404);
});

test('base → country-adjusted → accepted, through the grant write, and frozen against market updates', async () => {
  const { call, all, one, db } = fixture();
  await publish(call, 'spinout-lab', 2_000_000);
  const snap = (await call(SUPER, 'POST', `/api/admin/licences/${LIC}/pricing/snapshot`, {})).body.snapshot;
  const index = one('SELECT country_index FROM country_pricing_snapshots WHERE uid = ?', snap.lead_snapshot_uid).country_index;
  const view = await call(SUPER, 'GET', `/api/admin/licences/${LIC}/program-pricing`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.country_index_ppm, index);
  const sp = view.body.programs.find((p: any) => p.program_key === 'spinout-lab');
  const expected = Math.round((2_000_000 * index) / 1_000_000 / 250_000) * 250_000;
  assert.equal(sp.recommendation.recommended_annual_fee_cents, expected);
  assert.equal(sp.base.annual_fee_cents, 2_000_000);
  assert.equal(sp.accepted, null);
  const perks = view.body.programs.find((p: any) => p.program_key === 'perks');
  assert.equal(perks.base, null);
  assert.match(perks.base_reason, /Not recorded/);
  assert.equal(perks.recommendation.recommended_annual_fee_cents, null, 'no base is never priced as zero');

  const granted = await call(SUPER, 'POST', `${G}/spinout-lab`, { reason: REASON, pricing: { licence_snapshot_uid: snap.uid } });
  assert.equal(granted.status, 201, JSON.stringify(granted.body));
  assert.equal(granted.body.grant.terms.fee_cents, expected);
  assert.equal(granted.body.pricing_decision.decision, 'accepted');
  const d = one('SELECT * FROM program_pricing_decisions');
  assert.equal(d.sequence, 1);
  assert.equal(d.licence_snapshot_uid, snap.uid);
  assert.equal(d.country_index_ppm, index);
  assert.equal(d.created_by, `user:${SUPER}`);
  assert.ok(JSON.parse(d.trace_json).annual.unrounded_microcents, 'the unrounded trace is kept');

  // A market update and a fresh snapshot: the grant and its decision stay as accepted.
  db.prepare("UPDATE country_market_profiles SET ppp_gdp_per_capita = 90000, revision = revision + 1 WHERE country_code = 'FR'").run();
  await call(SUPER, 'POST', `/api/admin/licences/${LIC}/pricing/snapshot`, {});
  assert.equal(one("SELECT fee_cents FROM program_grants WHERE program_key = 'spinout-lab'").fee_cents, expected);
  // Pausing and resuming never reprice.
  assert.equal((await call(SUPER, 'POST', `${G}/spinout-lab/pause`, { reason: REASON })).status, 200);
  assert.equal((await call(SUPER, 'POST', `${G}/spinout-lab/resume`, { reason: REASON })).status, 200);
  assert.equal(all('SELECT * FROM program_pricing_decisions').length, 1);
  assert.equal(one("SELECT fee_cents FROM program_grants WHERE program_key = 'spinout-lab'").fee_cents, expected);
  // A change of terms that leaves the fee alone records no pricing decision.
  assert.equal((await call(SUPER, 'PATCH', `${G}/spinout-lab`, { reason: REASON, terms: { cohorts_per_year: 3 } })).status, 200);
  assert.equal(all('SELECT * FROM program_pricing_decisions').length, 1);
});

test('an override needs its reason; one licence holds different prices per program; history exports', async () => {
  const { call, all, one } = fixture();
  await publish(call, 'spinout-lab', 2_000_000);
  await call(SUPER, 'POST', `/api/admin/licences/${LIC}/pricing/snapshot`, {});
  const bare = await call(SUPER, 'POST', `${G}/spinout-lab`, { reason: REASON, pricing: { accepted_annual_fee_cents: 1_234_500 } });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.error, 'override_reason_required');
  assert.equal(all('SELECT * FROM program_grants').length, 0, 'nothing was granted');
  const over = await call(SUPER, 'POST', `${G}/spinout-lab`, { reason: REASON, pricing: { accepted_annual_fee_cents: 1_234_500, override_reason: 'Pilot studio discount' } });
  assert.equal(over.status, 201, JSON.stringify(over.body));
  assert.equal(over.body.pricing_decision.decision, 'overridden');
  // No base for Perks: accepting a recommendation is impossible, an override with a reason is recorded with no base.
  const noBase = await call(SUPER, 'POST', `${G}/perks`, { reason: REASON, pricing: {} });
  assert.equal(noBase.status, 400);
  assert.equal(noBase.body.error, 'accepted_value_required');
  const perks = await call(SUPER, 'POST', `${G}/perks`, { reason: REASON, terms: { currency: 'EUR' }, pricing: { accepted_annual_fee_cents: 300_000, override_reason: 'No reference price yet; agreed with the studio' } });
  assert.equal(perks.status, 201, JSON.stringify(perks.body));
  const rows = all('SELECT program_key, accepted_annual_fee_cents, base_annual_fee_cents, decision, override_reason FROM program_pricing_decisions ORDER BY program_key');
  assert.deepEqual(rows.map((r) => [r.program_key, r.accepted_annual_fee_cents, r.decision]), [['perks', 300_000, 'overridden'], ['spinout-lab', 1_234_500, 'overridden']]);
  assert.equal(rows[0].base_annual_fee_cents, null, 'a missing base is stored as missing, not as 0');
  // A change of price through change-terms is a new decision, numbered after the first.
  const changed = await call(SUPER, 'PATCH', `${G}/spinout-lab`, { reason: REASON, pricing: { override_reason: 'Back to the recommendation? No: renewal price', accepted_annual_fee_cents: 1_500_000 } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(one("SELECT MAX(sequence) AS n FROM program_pricing_decisions WHERE program_key = 'spinout-lab'").n, 2);
  assert.equal((await call(SUPER, 'PATCH', `${G}/spinout-lab`, { reason: REASON, terms: { fee_cents: 1 }, pricing: {} })).body.error, 'fee_from_pricing');
  // Queryable and exportable.
  const json = await call(SUPER, 'GET', `/api/admin/program-pricing/decisions?licence=${LIC}&program=spinout-lab`);
  assert.equal(json.body.total, 2);
  const csv = await call(SUPER, 'GET', `/api/admin/program-pricing/decisions.csv?licence=${LIC}`);
  assert.equal(csv.status, 200);
  assert.match(String(csv.type), /text\/csv/);
  const lines = String(csv.body).trim().split('\n');
  assert.match(lines[0], /^licence_uid,program_key,sequence,decision/);
  assert.equal(lines.length, 4);
});

test('a grant fee set without pricing is recorded as HQ\'s own, with the write\'s reason', async () => {
  const { call, one } = fixture();
  const r = await call(SUPER, 'POST', `${G}/spinout-lab`, { reason: REASON, terms: { fee_cents: 500_000, currency: 'EUR' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const d = one('SELECT * FROM program_pricing_decisions');
  assert.equal(d.decision, 'overridden');
  assert.equal(d.override_reason, REASON);
  assert.equal(d.recommended_annual_fee_cents, null);
});

test('the pure rules: floor and ceiling, rounding, currency, no base', () => {
  const base = { uid: 'd', program_key: 'p', version: 1, status: 'active', currency: 'EUR', base_annual_fee_cents: 1_000_000, base_initial_fee_cents: null,
    floor_multiplier_ppm: 800_000, ceiling_multiplier_ppm: 1_200_000, fee_rounding_cents: 10_000, effective_from: '2026-12-01', reason: 'x', created_at: '', created_by: '', retired_at: null } as any;
  assert.equal(recommendProgramFee(base, { ppm: 500_000, currency: 'EUR', rounding_cents: 250_000 }).recommended_annual_fee_cents, 800_000, 'the floor holds');
  assert.equal(recommendProgramFee(base, { ppm: 2_000_000, currency: 'EUR', rounding_cents: 250_000 }).recommended_annual_fee_cents, 1_200_000, 'the ceiling holds');
  assert.equal(recommendProgramFee(base, { ppm: 1_034_000, currency: 'EUR', rounding_cents: 250_000 }).recommended_annual_fee_cents, 1_030_000, 'the program\'s increment wins over the model\'s');
  assert.equal(recommendProgramFee({ ...base, fee_rounding_cents: null }, { ppm: 1_100_000, currency: 'EUR', rounding_cents: 250_000 }).recommended_annual_fee_cents, 1_000_000, 'with none, the model\'s increment');
  assert.equal(recommendProgramFee(base, { ppm: 1_000_000, currency: 'USD', rounding_cents: 250_000 }).available, false);
  const none = recommendProgramFee(null, { ppm: 1_000_000, currency: 'EUR', rounding_cents: 250_000 });
  assert.equal(none.available, false);
  assert.equal(none.recommended_annual_fee_cents, null);
  assert.equal(validateDefaultBody({ currency: 'EUR', base_annual_fee_cents: 0, effective_from: '2026-12-01' }).ok, false, 'a base of 0 is refused: free is not a price');
  assert.equal(validateDefaultBody({ currency: 'EUR', base_annual_fee_cents: 100, effective_from: '2026-12-01', floor_multiplier_ppm: 2, ceiling_multiplier_ppm: 1 }).ok, false);
});
