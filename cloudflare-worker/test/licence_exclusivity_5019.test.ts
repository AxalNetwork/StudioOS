/**
 * D5019 (#5019) — exclusivity, development commitments and regional /
 * master-franchise territories.
 *
 * Real SQLite over every migration, the real router. Pinned, from the issue's
 * acceptance criteria:
 *   · the operating fee and exclusivity are independent;
 *   · a missed target opens an HQ review and marks the exclusivity at risk, nothing more;
 *   · regional and master structures are representable;
 *   · a parent and its children never read as competing operating rights;
 *   · every change is a new, frozen version, revision-checked and audited;
 *   · a contractual change asks for the agreement to be acknowledged and never edits it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_exclusivity_5019.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount } from '../src/routes/admin_licence_exclusivity.ts';
import { exclusivityValues } from '../src/services/licenceContract.ts';
import { previewAction, progressOf, scopesClash, validateTermsBody } from '../src/services/licenceExclusivity.ts';

const SECRET = ['d5019', 'exclusivity', 'fixture', 'secret'].join('-');
const SUPER = 1, ADMIN = 3;
const A = 'lic_a', B = 'lic_b', M = 'lic_m', US = 'lic_us';
const REASON = 'Agreed at the HQ review';

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(SUPER, 'totp-1'); s.run(ADMIN, 'totp-3');
  const lic = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency, revenue_share_bps)
    VALUES (?, ?, ?, 'Entity', 'Brand', 'active', 5000000, 'EUR', 600)`);
  lic.run(1, A, 'AXL-A'); lic.run(2, B, 'AXL-B'); lic.run(3, M, 'AXL-M'); lic.run(4, US, 'AXL-US');
  const t = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?, ?)');
  t.run(1, 'FR'); t.run(2, 'BE'); t.run(4, 'US');
  db.exec(`INSERT INTO territory_regions (id, kind, name, countries_json, created_by) VALUES
    ('US-CA', 'subnational', 'California', '["US"]', 'user:1'),
    ('US-WEST', 'subnational', 'US West', '["US"]', 'user:1'),
    ('BENELUX', 'multi_country', 'Benelux', '["BE","NL","LU"]', 'user:1')`);
  db.exec("UPDATE territory_regions SET parent_region_id = 'US-WEST' WHERE id = 'US-CA'");
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  for (const m of mount) app.route(m.path, m.router);
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
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  return { db, call, all, one };
}

const P = (uid: string) => `/api/admin/licences/${uid}/exclusivity`;
const set = (call: any, uid: string, body: Record<string, unknown>, rev = 0) => call(SUPER, 'PUT', P(uid), { reason: REASON, expected_revision: rev, ...body });
const TARGETS = [
  { year: 1, period_start: '2025-01-01', period_end: '2025-12-31', min_revenue_cents: 10_000_000, min_cohorts: 2 },
  { year: 2, period_start: '2026-01-01', period_end: '2099-12-31', min_revenue_cents: 20_000_000, min_cohorts: 3 },
];

test('exclusivity is its own versioned term; the operating fee does not change and grants none', async () => {
  const { call, one, db, all } = fixture();
  const before = one('SELECT * FROM territory_licences WHERE uid = ?', A);
  const read = await call(SUPER, 'GET', P(A));
  assert.equal(read.status, 200);
  assert.equal(read.body.exclusivity, null);
  assert.match(read.body.exclusivity_reason, /non-exclusive/);
  assert.equal(read.body.operating.annual_fee_cents, 5_000_000);
  assert.equal((await call(ADMIN, 'GET', P(A))).status, 403);
  const v1 = await set(call, A, { scope_type: 'country_exclusive', territory: { countries: ['FR'] }, targets: TARGETS, cure_period_days: 90 });
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  assert.equal(v1.body.exclusivity.revision, 1);
  assert.deepEqual(one('SELECT * FROM territory_licences WHERE uid = ?', A), before, 'the operating licence and its fee are untouched');
  // Outside the operating territory, refused.
  const out = await set(call, A, { scope_type: 'country_exclusive', territory: { countries: ['FR', 'BE'] } }, 1);
  assert.equal(out.status, 409);
  assert.match(out.body.message, /BE is outside this licence's operating territory/);
  // A stale revision, refused; the current one, a new version.
  assert.equal((await set(call, A, { scope_type: 'non_exclusive' }, 0)).status, 409);
  const v2 = await set(call, A, { scope_type: 'country_exclusive', territory: { countries: ['FR'] }, targets: TARGETS, cure_period_days: 60 }, 1);
  assert.equal(v2.status, 200, JSON.stringify(v2.body));
  assert.equal(v2.body.exclusivity.revision, 2);
  assert.equal(all('SELECT * FROM licence_exclusivity_terms WHERE licence_uid = ? AND superseded_at IS NULL', A).length, 1);
  assert.throws(() => db.exec(`UPDATE licence_exclusivity_terms SET cure_period_days = 1 WHERE licence_uid = '${A}' AND revision = 1`), /frozen/);
  assert.throws(() => db.exec('DELETE FROM licence_exclusivity_terms'), /frozen/);
  assert.equal(all("SELECT * FROM admin_audit_log WHERE action = 'licence_exclusivity_set'").length, 2);
});

test('a missed target opens an HQ review and marks the exclusivity at risk; it is never revoked by itself', async () => {
  const { call, all } = fixture();
  await set(call, A, { scope_type: 'country_exclusive', territory: { countries: ['FR'] }, targets: TARGETS, cure_period_days: 90 });
  const progress0 = (await call(SUPER, 'GET', P(A))).body.progress;
  assert.equal(progress0[0].status, 'not_recorded', 'an unmeasured year is not recorded, never missed or 0');
  assert.equal(progress0[0].metrics[0].measured, null);
  const obs = await call(SUPER, 'POST', `${P(A)}/observations`, { metric: 'qualifying_revenue_cents', period_start: '2025-01-01', period_end: '2025-12-31', value: 4_000_000, source: 'Audited statement 2025', reason: 'Year-end figures' });
  assert.equal(obs.status, 201, JSON.stringify(obs.body));
  assert.equal(obs.body.exclusivity_changed, false);
  assert.ok(obs.body.review_opened, 'a completed year below target opens a review');
  const read = await call(SUPER, 'GET', P(A));
  assert.equal(read.body.exclusivity.state, 'at_risk');
  assert.equal(read.body.exclusivity.scope_type, 'country_exclusive', 'the scope stays as it was');
  assert.deepEqual(read.body.exclusivity.territory.countries, ['FR']);
  assert.equal(read.body.progress[0].status, 'missed');
  assert.equal(all("SELECT * FROM licence_exclusivity_reviews WHERE state = 'open'").length, 1);
  // A second observation does not open a second review.
  await call(SUPER, 'POST', `${P(A)}/observations`, { metric: 'cohorts', period_start: '2025-01-01', period_end: '2025-12-31', value: 1, source: 'Cohort ledger', reason: 'Year-end figures' });
  assert.equal(all('SELECT * FROM licence_exclusivity_reviews').length, 1);
});

test('a review action needs its preview acknowledged and a reason; each writes the next version', async () => {
  const { call, one, all } = fixture();
  await set(call, A, { scope_type: 'country_exclusive', territory: { countries: ['FR'] }, targets: TARGETS, cure_period_days: 90 });
  await call(SUPER, 'POST', `${P(A)}/observations`, { metric: 'qualifying_revenue_cents', period_start: '2025-01-01', period_end: '2025-12-31', value: 1, source: 'Audited statement', reason: 'Year-end figures' });
  const review = one("SELECT * FROM licence_exclusivity_reviews WHERE state = 'open'");
  const rev = one('SELECT revision FROM licence_exclusivity_terms WHERE superseded_at IS NULL').revision;
  const preview = await call(SUPER, 'POST', `${P(A)}/reviews/${review.uid}/preview`, { action: 'convert_non_exclusive' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.stored, false);
  assert.match(preview.body.consequence, /no longer exclusive/);
  assert.match(preview.body.consequence, /agreement/, 'a contractual exclusivity says what happens to the agreement');
  assert.equal(one('SELECT revision FROM licence_exclusivity_terms WHERE superseded_at IS NULL').revision, rev, 'a preview writes nothing');
  const noAck = await call(SUPER, 'POST', `${P(A)}/reviews/${review.uid}/resolve`, { action: 'convert_non_exclusive', reason: REASON, expected_revision: rev });
  assert.equal(noAck.body.code ?? noAck.body.error, 'consequence_unacknowledged');
  const noReason = await call(SUPER, 'POST', `${P(A)}/reviews/${review.uid}/resolve`, { action: 'cure_period', acknowledge_consequence: true, expected_revision: rev });
  assert.equal(noReason.status, 400);
  const cure = await call(SUPER, 'POST', `${P(A)}/reviews/${review.uid}/resolve`, { action: 'cure_period', reason: REASON, acknowledge_consequence: true, expected_revision: rev });
  assert.equal(cure.status, 200, JSON.stringify(cure.body));
  assert.equal(cure.body.exclusivity.state, 'at_risk');
  assert.ok(cure.body.exclusivity.cure_until);
  assert.equal(cure.body.review.state, 'resolved');
  assert.equal(cure.body.review.action, 'cure_period');
  assert.match(cure.body.review.consequence, /stays, at risk/);
  assert.equal((await call(SUPER, 'POST', `${P(A)}/reviews/${review.uid}/resolve`, { action: 'continue', reason: REASON, acknowledge_consequence: true, expected_revision: rev + 1 })).status, 409, 'a closed review stays closed');
  // A new review, ended.
  const opened = await call(SUPER, 'POST', `${P(A)}/reviews`, { reason: 'Cure period lapsed' });
  assert.equal(opened.status, 201);
  const end = await call(SUPER, 'POST', `${P(A)}/reviews/${opened.body.review.uid}/resolve`, { action: 'end_exclusivity', reason: REASON, acknowledge_consequence: true, expected_revision: rev + 1 });
  assert.equal(end.status, 200, JSON.stringify(end.body));
  assert.equal(end.body.exclusivity.state, 'ended');
  assert.equal(all('SELECT * FROM licence_exclusivity_terms WHERE licence_uid = ?', A).length, 4, 'one version per change, none rewritten');
  assert.equal(all('SELECT * FROM licence_territories WHERE licence_id = 1').length, 1, 'the operating territory is untouched');
});

test('regional and master structures: a master lists its children; competing rights are refused', async () => {
  const { call } = fixture();
  // A regional exclusivity inside the US licence's territory.
  const ca = await set(call, US, { scope_type: 'regional_exclusive', territory: { regions: ['US-CA'] } });
  assert.equal(ca.status, 201, JSON.stringify(ca.body));
  // A master over Benelux cannot take BE, which AXL-B operates, until it lists AXL-B as its child.
  const rival = await set(call, M, { scope_type: 'master_franchise', territory: { regions: ['BENELUX'] } });
  assert.equal(rival.status, 409);
  assert.match(rival.body.message, /BE is operated by AXL-B/);
  const master = await set(call, M, { scope_type: 'master_franchise', territory: { regions: ['BENELUX'] }, child_licence_uids: [B] });
  assert.equal(master.status, 201, JSON.stringify(master.body));
  // The child names its parent and sits inside it; it is not a clash.
  const child = await set(call, B, { scope_type: 'country_exclusive', territory: { countries: ['BE'] }, parent_licence_uid: M });
  assert.equal(child.status, 201, JSON.stringify(child.body));
  // A licence the master does not list cannot claim it as a parent.
  const stranger = await set(call, A, { scope_type: 'country_exclusive', territory: { countries: ['FR'] }, parent_licence_uid: M });
  assert.equal(stranger.status, 409);
  assert.match(stranger.body.message, /does not list this licence/);
  // A second master over the same ground is refused as a clash.
  const rows = await call(SUPER, 'GET', P(B));
  assert.equal(rows.body.master.licence_ref, 'AXL-M');
  const second = await set(call, A, { scope_type: 'master_franchise', territory: { countries: ['NL'] } });
  assert.equal(second.status, 409);
  assert.match(second.body.message, /NL is already exclusive to AXL-M/);
  const unknown = await set(call, A, { scope_type: 'regional_exclusive', territory: { regions: ['FR-IDF'] } });
  assert.equal(unknown.status, 409);
  assert.match(unknown.body.message, /No region is recorded as FR-IDF/);
});

test('a contractual change asks for the agreement to be acknowledged and never edits it', async () => {
  const { call, db, one } = fixture();
  await set(call, A, { scope_type: 'country_exclusive', territory: { countries: ['FR'] } });
  db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md, body_sha256, unfilled_fields, status, created_by_user_id, created_at, updated_at)
    VALUES ('ct_1', ?, 'slug', 1, 'Licence agreement', 'Body', 'abc', '[]', 'signed', 1, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`).run(A);
  const before = one("SELECT * FROM licence_contracts WHERE uid = 'ct_1'");
  const noAck = await set(call, A, { scope_type: 'non_exclusive' }, 1);
  assert.equal(noAck.body.code ?? noAck.body.error, 'agreement_ack_required');
  const ok = await set(call, A, { scope_type: 'non_exclusive', acknowledge_agreement_mismatch: true }, 1);
  assert.equal(ok.status, 200);
  assert.deepEqual(one("SELECT * FROM licence_contracts WHERE uid = 'ct_1'"), before);
  assert.equal((await call(SUPER, 'GET', P(A))).body.agreement.state, 'mismatch');
});

test('territory regions: recorded with a reason, inside their parent, refused when malformed', async () => {
  const { call } = fixture();
  const R = '/api/admin/territory-regions';
  assert.equal((await call(SUPER, 'POST', R, { id: 'US-NYC', kind: 'metro', name: 'New York metro', countries: ['US'], reason: 'Large market split' })).status, 201);
  assert.equal((await call(SUPER, 'POST', R, { id: 'US-NYC', kind: 'metro', name: 'Again', countries: ['US'], reason: 'Duplicate' })).status, 409);
  assert.equal((await call(SUPER, 'POST', R, { id: 'DE-BY', kind: 'subnational', name: 'Bavaria', countries: ['DE', 'AT'], reason: 'Two countries' })).status, 400);
  assert.equal((await call(SUPER, 'POST', R, { id: 'US-SF', kind: 'metro', name: 'SF', countries: ['FR'], parent_region_id: 'US-CA', reason: 'Wrong country' })).status, 400);
  const list = await call(SUPER, 'GET', R);
  assert.ok(list.body.regions.some((r: any) => r.id === 'US-NYC'));
});

test('the pure rules: clashes, progress, previews, contract fields', () => {
  const regions = [
    { id: 'US-CA', kind: 'subnational', name: 'CA', countries: ['US'], parent_region_id: 'US-WEST' },
    { id: 'US-WEST', kind: 'subnational', name: 'West', countries: ['US'], parent_region_id: null },
    { id: 'US-NYC', kind: 'metro', name: 'NYC', countries: ['US'], parent_region_id: null },
  ] as any;
  assert.deepEqual(scopesClash({ countries: ['US'], regions: [] }, { countries: [], regions: ['US-CA'] }, regions), ['US (US-CA)']);
  assert.deepEqual(scopesClash({ countries: [], regions: ['US-CA'] }, { countries: [], regions: ['US-WEST'] }, regions), ['US-CA / US-WEST'], 'a region inside another clashes');
  assert.deepEqual(scopesClash({ countries: [], regions: ['US-CA'] }, { countries: [], regions: ['US-NYC'] }, regions), [], 'two separate regions of one country do not');
  const p = progressOf(TARGETS as any, [{ uid: 'o', metric: 'qualifying_revenue_cents', period_start: '2025-02-01', period_end: '2025-11-30', value: 12_000_000 } as any], '2026-06-01');
  assert.equal(p[0].status, 'in_progress', 'one metric met, one not recorded: not missed');
  const met = progressOf([{ ...TARGETS[0], min_cohorts: null }] as any, [{ uid: 'o', metric: 'qualifying_revenue_cents', period_start: '2025-01-01', period_end: '2025-12-31', value: 12_000_000 } as any], '2026-06-01');
  assert.equal(met[0].status, 'met');
  const v = validateTermsBody({ scope_type: 'country_exclusive', territory: { countries: ['fr'] }, reason: 'x' });
  assert.equal(v.ok, false, 'a reason is required');
  assert.equal(validateTermsBody({ scope_type: 'regional_exclusive', territory: { countries: ['FR'] }, reason: 'Because' }).ok, false, 'regional names regions');
  assert.equal(validateTermsBody({ scope_type: 'country_exclusive', territory: { countries: ['FR'] }, child_licence_uids: ['x'], reason: 'Because' }).ok, false, 'only a master lists children');
  const cur = { scope_type: 'country_exclusive', territory: { countries: ['FR', 'BE'], regions: [] }, parent_licence_uid: null, child_licence_uids: [], starts_on: null, ends_on: null, review_on: null, cure_period_days: null, targets: [], state: 'at_risk', contractual: true, reason: 'r', note: null, cure_until: null } as any;
  assert.equal(previewAction(cur, 'cure_period', {}, '2026-01-01', []).ok, false, 'no cure period recorded, none invented');
  assert.equal(previewAction(cur, 'reduce_territory', { territory: { countries: ['FR', 'BE', 'DE'], regions: [] } }, '2026-01-01', []).ok, false, 'a reduction adds nothing');
  const red = previewAction(cur, 'reduce_territory', { territory: { countries: ['FR'], regions: [] } }, '2026-01-01', []);
  assert.ok(red.ok && /BE is no longer exclusive/.test(red.consequence));
  const f = exclusivityValues({ scope_type: 'country_exclusive', countries: ['FR'], regions: [], starts_on: '2026-01-01', ends_on: null, review_on: null, cure_period_days: 90,
    targets: [{ year: 1, period_start: '2026-01-01', period_end: '2026-12-31', min_revenue_cents: 10_000_000, min_cohorts: null, min_active_members: null }] }, 'EUR');
  assert.equal(f.territory, 'FR');
  assert.equal(f.year_1_min_revenue, 'EUR 100,000');
  assert.equal(f.year_1_min_cohorts, null, 'no target is left unfilled, never 0');
});
