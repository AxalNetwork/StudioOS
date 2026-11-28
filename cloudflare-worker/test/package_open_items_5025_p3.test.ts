/** Open items of the programs a package downgrade or change ends, per source, for the licence's holders (#8830, D5025-p3). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount } from '../src/routes/admin_package_lifecycle.ts';
import {
  HOLDERS_SCOPE, NO_DEPENDENTS_STORE, NO_HOLDERS, OPEN_ITEM_PROGRAMS, OPEN_ITEMS_CAP, STORE_MISSING, STORE_UNREADABLE,
} from '../src/services/packageLifecycle.ts';

const CLOCK = Date.UTC(2026, 10, 23, 12); // 2026-11-23 12:00Z
const SECRET = crypto.randomUUID();
const LIC = 'lic_8830';
const MAPPED = ['investor-cohorts', 'influencer', 'learning', 'mentor-cohorts', 'perks', 'product-testing', 'referral-partners', 'refer-and-earn', 'spinout-lab'];
const comp = (...keys: string[]) => JSON.stringify(keys.map((k, i) => ({ program_key: k, position: i, metadata: null, terms: {} })));
// Holders are 3 (principal) and 5 (delegate); 4 holds no role on the licence.
const TABLES = ['cohort_applicants', 'learning_enrollments', 'investor_cohort_access', 'advisor_cohort_assignments', 'perk_claims',
  'referral_submissions', 'referral_partner_terms', 'influencers', 'product_testers', 'licence_package_offers', 'program_grants'];

function fixture(ctx: any) {
  ctx.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  ctx.after(() => db.close());
  for (const id of [1, 3, 4, 5]) db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'admin', ?, ?)").run(id, `User ${id}`, `u${id}@example.test`);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (1, 'totp-1', 'totp', 'totp', ?)").run(new Date(CLOCK).toISOString());
  db.exec('INSERT INTO super_admins (user_id) VALUES (1)');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
    annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-8830', 'Test licensee', 'Test studio', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2028-01-01')`).run(LIC);
  db.exec(`INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, 3, 'principal'), (1, 5, 'delegate')`);
  const offer = (uid: string, state: string, starts: string, ends: string, composition: string, key = 'core_network') => {
    const accepted = state === 'accepted';
    db.prepare(`INSERT INTO licence_package_offers (uid, licence_uid, package_uid, package_key, package_version, package_name,
      pricing_recommendation_uid, country_pricing_snapshot_uid, currency, recommended_annual_fee_cents, accepted_annual_fee_cents,
      state, override_reason, starts_on, ends_on, composition_json, recommendation_json, created_at, created_by, create_key, create_hash,
      decided_by, acceptance_json) VALUES (?, ?, 'pkg', ?, 1, 'Package', 'rec', 'snap', 'EUR', 1000000, ?, ?, NULL, ?, ?, ?, '{}', '2026-01-01T00:00:00Z', 1, ?, 'h', ?, ?)`)
      .run(uid, LIC, key, accepted ? 1_000_000 : null, state, starts, ends, composition, `key-${uid}`, accepted ? 1 : null, accepted ? '{}' : null);
  };
  // Cohort cycles: 1 running, 2 completed.
  db.exec(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status) VALUES
    (1, 2026, 11, '2026-11-01T05:00:00Z', '2026-11-29T05:00:00Z', 'active'), (2, 2026, 9, '2026-09-01T04:00:00Z', '2026-09-29T04:00:00Z', 'completed')`);
  db.exec(`INSERT INTO cohort_applicants (id, application_id, user_id, cohort_cycle_id, status) VALUES
    (11, 1, 3, 1, 'approved'), (12, 2, 3, 2, 'activated'), (13, 3, 5, 1, 'rejected'), (14, 4, 4, 1, 'pending')`);
  db.exec(`INSERT INTO learning_programs (id, uid, name, status, created_by) VALUES (1, 'course-1', 'Course', 'published', 1), (2, 'course-2', 'Old', 'archived', 1)`);
  db.exec(`INSERT INTO learning_enrollments (id, program_id, user_id, enrolled_by, status) VALUES
    (21, 1, 3, 3, 'active'), (22, 2, 3, 3, 'active'), (23, 1, 5, 5, 'removed'), (24, 1, 4, 4, 'active')`);
  db.exec(`INSERT INTO investor_cohort_access (uid, investor_user_id, cohort_cycle_id, ends_at, ended_at, end_reason) VALUES
    ('ica-today', 3, 1, '2026-11-23T08:00:00Z', NULL, NULL), ('ica-past', 3, 2, '2026-11-22T23:00:00Z', NULL, NULL),
    ('ica-ended', 5, 1, '2027-01-01T00:00:00Z', '2026-11-01 00:00:00', 'admin'), ('ica-other', 4, 1, '2027-01-01T00:00:00Z', NULL, NULL)`);
  db.exec(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, is_active, unassigned_at) VALUES
    ('aca-open', 3, 1, 1, NULL), ('aca-done', 3, 2, 1, NULL), ('aca-off', 5, 1, 0, '2026-11-02 00:00:00'), ('aca-other', 4, 1, 1, NULL)`);
  const perk = db.prepare("INSERT INTO perks (id, uid, partner_name, category, offer) VALUES (?, ?, 'Partner', 'tools', 'Offer')");
  for (let i = 0; i < 3 + OPEN_ITEMS_CAP; i++) perk.run(8830 + i, `perk-${8830 + i}`);
  db.exec(`INSERT INTO perk_claims (uid, perk_id, user_id, status, expires_at) VALUES
    ('pc-open', 8830, 3, 'issued', NULL), ('pc-later', 8831, 3, 'issued', '2026-11-23T13:00:00.000Z'), ('pc-lapsed', 8832, 3, 'issued', '2026-11-23 11:00:00'),
    ('pc-redeemed', 8830, 5, 'redeemed', NULL), ('pc-other', 8830, 4, 'issued', NULL)`);
  db.exec(`INSERT INTO referral_submissions (uid, referrer_user_id, referred_name, status) VALUES
    ('rs-open', 3, 'A', 'under_review'), ('rs-draft', 3, 'B', 'draft'), ('rs-paid', 5, 'C', 'reward_issued'), ('rs-other', 4, 'D', 'submitted')`);
  db.exec(`INSERT INTO referral_partners (id, user_id, segment, added_by) VALUES (1, 3, 'venture_scouts', 1), (2, 5, 'influencers', 1), (3, 4, 'deal_makers', 1)`);
  const signed = `submitted_at, approved_by, approved_at, envelope_id, sent_at, signed_at`;
  db.exec(`INSERT INTO referral_partner_terms (uid, partner_id, segment, status, starts_on, ends_on, created_by, submitted_at) VALUES
    ('rt-open', 1, 'venture_scouts', 'submitted', '2026-11-01', NULL, 1, '2026-11-01 00:00:00'),
    ('rt-influencer', 2, 'influencers', 'submitted', '2026-11-01', NULL, 1, '2026-11-01 00:00:00'),
    ('rt-other', 3, 'deal_makers', 'submitted', '2026-11-01', NULL, 1, '2026-11-01 00:00:00')`);
  db.exec(`INSERT INTO referral_partner_terms (uid, partner_id, segment, status, starts_on, ends_on, created_by, ${signed}) VALUES
    ('rt-past', 1, 'venture_scouts', 'active', '2026-01-01', '2026-11-22', 1, '2026-01-01', 1, '2026-01-01', 1, '2026-01-01', '2026-01-01'),
    ('rt-today', 1, 'venture_scouts', 'active', '2026-01-01', '2026-11-23', 1, '2026-01-01', 1, '2026-01-01', 1, '2026-01-01', '2026-01-01')`);
  db.exec(`INSERT INTO influencers (uid, user_id, tier, admitted_by, status) VALUES
    ('inf-open', 3, 'affiliate_creator', 1, 'paused'), ('inf-ended', 5, 'affiliate_creator', 1, 'ended'), ('inf-other', 4, 'affiliate_creator', 1, 'active')`);
  db.exec(`INSERT INTO product_testers (id, user_id, status, decided_at) VALUES (31, 3, 'applied', NULL), (32, 5, 'declined', '2026-11-01'), (33, 4, 'active', '2026-11-01')`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route(mount.path, mount.router);
  const call = async (path: string) => {
    const token = await new SignJWT({ user_id: 1, role: 'admin', jti: 'totp-1' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env));
    return { status: res.status, body: await res.json() as any };
  };
  const snapshot = () => JSON.stringify(TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  return { db, offer, call, snapshot };
}

const review = (call: any, offer = 'down') => call(`/api/admin/licences/${LIC}/package-offers/${offer}/change-review`);
const byKey = (b: any) => Object.fromEntries(b.ending_dependents.programs.map((p: any) => [p.program_key, p]));

test('a downgrade lists each ending program\'s open items for the licence holders, per source; nothing changes', async (t) => {
  const { offer, call, snapshot } = fixture(t);
  assert.deepEqual([...OPEN_ITEM_PROGRAMS], MAPPED.slice().sort());
  offer('cur', 'accepted', '2026-01-01', '2026-12-31', comp(...MAPPED, 'ai-native-venture'));
  offer('down', 'offered', '2027-01-01', '2027-12-31', comp('ai-native-venture'), 'lite');
  const before = snapshot();
  const res = await review(call);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.kind, 'downgrade');
  const d = res.body.ending_dependents;
  assert.equal(d.status, 'read');
  assert.equal(d.read_only, true);
  assert.deepEqual(d.holders, { scope: HOLDERS_SCOPE, user_ids: [3, 5] });
  const p = byKey(res.body);
  assert.deepEqual(Object.keys(p).sort(), MAPPED.slice().sort());
  const refs = (k: string) => [p[k].status, p[k].count, p[k].items.map((i: any) => i.ref), p[k].truncated];
  assert.deepEqual(refs('spinout-lab'), ['read', 1, ['11'], false]);
  assert.deepEqual(refs('learning'), ['read', 1, ['21'], false]);
  assert.deepEqual(refs('investor-cohorts'), ['read', 1, ['ica-today'], false]);
  assert.deepEqual(refs('mentor-cohorts'), ['read', 1, ['aca-open'], false]);
  assert.deepEqual(refs('perks'), ['read', 2, ['pc-open', 'pc-later'], false]);
  assert.deepEqual(refs('refer-and-earn'), ['read', 1, ['rs-open'], false]);
  assert.deepEqual(refs('referral-partners'), ['read', 2, ['rt-open', 'rt-today'], false]);
  assert.deepEqual(refs('influencer'), ['read', 1, ['inf-open'], false]);
  assert.deepEqual(refs('product-testing'), ['read', 1, ['31'], false]);
  assert.deepEqual(p.perks.items[0], { ref: 'pc-open', user_id: 3 });
  assert.equal(p.perks.source, 'perk_claims');
  assert.match(p.perks.open_means, /issued/);
  assert.equal(snapshot(), before, 'the review writes nothing');
});

test('a downgrade whose holders have no open items reads 0 per source, not "not recorded"', async (t) => {
  const { db, offer, call } = fixture(t);
  db.exec('DELETE FROM licence_admins WHERE user_id = 3'); // 5 holds only closed items
  offer('cur', 'accepted', '2026-01-01', '2026-12-31', comp(...MAPPED, 'ai-native-venture'));
  offer('down', 'offered', '2027-01-01', '2027-12-31', comp('ai-native-venture'), 'lite');
  const d = (await review(call)).body.ending_dependents;
  assert.equal(d.status, 'read');
  assert.deepEqual(d.holders.user_ids, [5]);
  for (const p of d.programs) assert.deepEqual([p.program_key, p.status, p.count, p.items], [p.program_key, 'read', 0, []]);
});

test('an unmapped program reads not_recorded with a reason, never an empty list or 0', async (t) => {
  const { offer, call } = fixture(t);
  offer('cur', 'accepted', '2026-01-01', '2026-12-31', comp('perks', 'learning', 'ai-native-venture'));
  offer('down', 'offered', '2027-01-01', '2027-12-31', comp('perks'), 'lite');
  const res = await review(call);
  assert.equal(res.body.kind, 'downgrade');
  const d = res.body.ending_dependents;
  assert.equal(d.status, 'partial');
  const p = byKey(res.body);
  assert.deepEqual(p['ai-native-venture'], { program_key: 'ai-native-venture', status: 'not_recorded', reason: NO_DEPENDENTS_STORE });
  assert.equal(p['ai-native-venture'].count, undefined);
  assert.equal(p['ai-native-venture'].items, undefined);
  assert.deepEqual([p.learning.status, p.learning.count], ['read', 1]);
});

test('no holder, a missing store and an unreadable store each read as such; the identifiers are capped, the count is not', async (t) => {
  const { db, offer, call } = fixture(t);
  offer('cur', 'accepted', '2026-01-01', '2026-12-31', comp('perks', 'influencer', 'product-testing', 'ai-native-venture'));
  offer('down', 'offered', '2027-01-01', '2027-12-31', comp('ai-native-venture'), 'lite');
  const claim = db.prepare("INSERT INTO perk_claims (uid, perk_id, user_id, status) VALUES (?, ?, 5, 'issued')");
  for (let i = 0; i < OPEN_ITEMS_CAP; i++) claim.run(`pc-bulk-${String(i).padStart(3, '0')}`, 8833 + i);
  db.exec('DROP TABLE product_testers');
  db.exec('ALTER TABLE influencers RENAME COLUMN status TO lifecycle');
  let p = byKey((await review(call)).body);
  assert.deepEqual([p.perks.count, p.perks.items.length, p.perks.truncated], [OPEN_ITEMS_CAP + 2, OPEN_ITEMS_CAP, true]);
  assert.deepEqual(p['product-testing'], { program_key: 'product-testing', status: 'not_recorded', reason: STORE_MISSING });
  assert.deepEqual(p.influencer, { program_key: 'influencer', status: 'unreadable', reason: STORE_UNREADABLE });
  db.exec('DELETE FROM licence_admins');
  const body = (await review(call)).body;
  p = byKey(body);
  assert.equal(body.ending_dependents.status, 'not_read');
  assert.deepEqual(body.ending_dependents.holders.user_ids, []);
  assert.deepEqual(p.perks, { program_key: 'perks', status: 'not_recorded', reason: NO_HOLDERS });
});

test('an upgrade reads no dependents', async (t) => {
  const { offer, call } = fixture(t);
  offer('cur', 'accepted', '2026-01-01', '2026-12-31', comp('perks'));
  offer('up', 'offered', '2027-01-01', '2027-12-31', comp('perks', 'learning'));
  assert.equal((await review(call, 'up')).body.ending_dependents, null);
});
