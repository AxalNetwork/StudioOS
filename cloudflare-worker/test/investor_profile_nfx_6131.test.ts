/**
 * #6131 (D6128 Q2): PUT /api/investor-profile/me keeps the NFX sectors and
 * anti-thesis sectors that investor onboarding sends, against real SQLite,
 * and the Settings "My thesis" read and write still round-trip: legacy
 * labels stay accepted, omitted fields are preserved (D6136) and an omitted
 * consent is unchanged (#6392).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { investorProfile, NFX_SECTORS, LEGACY_SECTOR_OPTIONS } from '../src/routes/investor_signals.ts';
import { NFX_SECTORS as FRONTEND_NFX_SECTORS } from '../../frontend/src/lib/nfxSectors.js';
import { investorProfilePayload } from '../../frontend/src/lib/onboarding.js';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES
    (2, 'investor', 'Investor', 'investor@example.test', 1);`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}
const app = new Hono<any>(); app.route('/api/investor-profile', investorProfile);
const path = '/api/investor-profile/me';
async function call(env: any, method: string, body?: unknown) {
  const token = await new SignJWT({ user_id: 2 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as any));
  return { status: response.status, body: await response.json() as any };
}
function stored(db: DatabaseSync) {
  return db.prepare(`SELECT sectors_json, anti_thesis_sectors_json, contribute_to_signals, completed_at, firm_name
    FROM investor_profiles WHERE user_id = 2`).get() as any;
}

// What OnboardingInvestorPage's finish sends, built by its own payload helper.
const onboardingValues = {
  investor_type: 'angel', check_size: '$10k-$50k', stages: ['Seed'], geos: ['Europe'],
  sectors: ['FinTech', 'Creator/Passion Economy', 'Generative Tech/AI'],
  anti_thesis_sectors: ['Web3/Crypto', 'Gaming/eSports'], anti_thesis_stages: ['Growth'],
  thesis_text: 'Technical founders in embedded finance.', contribute_to_signals: false,
  firm_name: 'Halden Family Office', accreditation_status: 'accredited', country: 'Canada', lp_intent: 'maybe',
};

// What useInvestorProfile.save sends: the stored thesis columns whole, then the card's edits.
function settingsSave(profile: any, edits: Record<string, unknown>) {
  return {
    investor_type: profile.investor_type, sectors: profile.sectors ?? [], stages: profile.stages ?? [],
    geos: profile.geos ?? [], ticket_band: profile.ticket_band, thesis_text: profile.thesis_text,
    anti_thesis_sectors: profile.anti_thesis_sectors ?? [], anti_thesis_stages: profile.anti_thesis_stages ?? [],
    value_weights: profile.value_weights ?? {}, ...edits,
  };
}

test('the Worker accepts exactly the NFX list the onboarding offers, in its order', () => {
  assert.deepEqual([...NFX_SECTORS], [...FRONTEND_NFX_SECTORS]);
  assert.equal(NFX_SECTORS.length, 82);
});

test('onboarding NFX sectors and exclusions persist, read back and complete the profile', async () => {
  const { db, env } = fixture();
  const saved = await call(env, 'PUT', investorProfilePayload(onboardingValues));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.profile.sectors, onboardingValues.sectors);
  assert.deepEqual(saved.body.profile.anti_thesis_sectors, onboardingValues.anti_thesis_sectors);
  assert.deepEqual(saved.body.profile.anti_thesis_stages, ['Growth']);
  assert.equal(saved.body.profile.contribute_to_signals, false);
  assert.ok(saved.body.profile.completed_at, 'a profile with an NFX sector is complete');
  const row = stored(db);
  assert.deepEqual(JSON.parse(row.sectors_json), onboardingValues.sectors);
  assert.deepEqual(JSON.parse(row.anti_thesis_sectors_json), onboardingValues.anti_thesis_sectors);
  assert.equal(row.contribute_to_signals, 0);
  const read = await call(env, 'GET');
  assert.deepEqual(read.body.profile.sectors, onboardingValues.sectors);
  assert.deepEqual(read.body.profile.anti_thesis_sectors, onboardingValues.anti_thesis_sectors);
});

test('every NFX sector can be picked at once; unknown and repeated values are dropped', async () => {
  const { env } = fixture();
  const all = [...FRONTEND_NFX_SECTORS];
  const saved = await call(env, 'PUT', investorProfilePayload({
    ...onboardingValues, sectors: [...all, 'Not A Sector', all[0], '  '], anti_thesis_sectors: ['fintech', 'Web3/Crypto'],
  }));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.profile.sectors, all);
  assert.deepEqual(saved.body.profile.anti_thesis_sectors, ['Web3/Crypto'], 'matching is exact, as the list is');
});

test('Settings "My thesis" reads the onboarding row and its save keeps it whole', async () => {
  const { db, env } = fixture();
  await call(env, 'PUT', investorProfilePayload(onboardingValues));
  const { profile } = (await call(env, 'GET')).body;
  // The card toggles a sector it offers (a legacy label) on top of the NFX picks.
  const thesis = await call(env, 'PUT', settingsSave(profile, { sectors: [...profile.sectors, 'Climate'] }));
  assert.equal(thesis.status, 200);
  assert.deepEqual(thesis.body.profile.sectors, [...onboardingValues.sectors, 'Climate']);
  assert.deepEqual(thesis.body.profile.anti_thesis_sectors, onboardingValues.anti_thesis_sectors);
  // Consent was omitted, so the onboarding opt-out stands (#6392).
  assert.equal(thesis.body.profile.contribute_to_signals, false);
  assert.equal(stored(db).contribute_to_signals, 0);
  // The onboarding-only fields were omitted, so they stay (D6136).
  for (const key of ['firm_name', 'accreditation_status', 'country', 'lp_intent'] as const) {
    assert.equal(thesis.body.profile[key], (onboardingValues as any)[key], key);
  }
  // One onboarding field corrected alone: the NFX thesis and exclusions survive.
  const corrected = await call(env, 'PUT', settingsSave(thesis.body.profile, { country: 'France' }));
  assert.equal(corrected.body.profile.country, 'France');
  assert.deepEqual(corrected.body.profile.sectors, [...onboardingValues.sectors, 'Climate']);
  assert.deepEqual(corrected.body.profile.anti_thesis_sectors, onboardingValues.anti_thesis_sectors);
  assert.equal(corrected.body.profile.firm_name, 'Halden Family Office');
});

test('a profile saved with the legacy labels round-trips through a Settings save', async () => {
  const { env } = fixture();
  const legacy = [...LEGACY_SECTOR_OPTIONS];
  const first = await call(env, 'PUT', { investor_type: 'angel', sectors: legacy, stages: ['Seed'], ticket_band: '$10k-$50k', anti_thesis_sectors: ['Crypto'] });
  assert.deepEqual(first.body.profile.sectors, legacy);
  const weights = await call(env, 'PUT', settingsSave(first.body.profile, { value_weights: { speed: 0.5 } }));
  assert.deepEqual(weights.body.profile.sectors, legacy);
  assert.deepEqual(weights.body.profile.anti_thesis_sectors, ['Crypto']);
  assert.ok(weights.body.profile.completed_at);
});

test('omitted sector arrays are preserved; an explicit empty array clears them', async () => {
  const { env } = fixture();
  await call(env, 'PUT', investorProfilePayload(onboardingValues));
  const partial = await call(env, 'PUT', { firm_name: 'Renamed' });
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.profile.sectors, onboardingValues.sectors);
  assert.deepEqual(partial.body.profile.anti_thesis_sectors, onboardingValues.anti_thesis_sectors);
  assert.equal(partial.body.profile.contribute_to_signals, false);
  const cleared = await call(env, 'PUT', { anti_thesis_sectors: [] });
  assert.deepEqual(cleared.body.profile.anti_thesis_sectors, []);
  assert.deepEqual(cleared.body.profile.sectors, onboardingValues.sectors);
});
