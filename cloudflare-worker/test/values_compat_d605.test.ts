/**
 * D605 (#1296) — values compatibility across roles (PROFILING_V2.md §6) on
 * the card's published-member matches.
 *
 * Pinned, on the pure service and through `GET /api/profile/published-members`:
 *   - a caller who has not published gets no comparison, with the reason;
 *   - fewer than 3 dimensions recorded on both sides is null, never aligned;
 *   - one far-apart dimension makes the band far_apart, whatever the others;
 *   - a pair with no founder compares the Axal values only;
 *   - an investor's founder_risk_appetite is compared with a founder's;
 *   - the thresholds (D605) and the scale normalisation;
 *   - no dimension name, score or confidence leaves the route;
 *   - a failed values read is a 503.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/values_compat_d605.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import profileHistory from '../src/routes/profile_history.ts';
import {
  ALIGNED, AXAL_KEYS, FAR_APART, MIN_COMPARED, pairDimensions, sideOf, valuesFit, type ValueProfile,
} from '../src/services/valuesCompat.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';


// ---------------------------------------------------------------------------
// The pure service.
// ---------------------------------------------------------------------------

const rec = (score: number, confidence = 0.8) => ({ score, confidence });
const axal = (scores: Record<string, number>) => Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, rec(v)]));
const P = (a: Record<string, number> = {}, v: Record<string, number> = {}): ValueProfile =>
  ({ axal: axal(a), values: Object.fromEntries(Object.entries(v).map(([k, s]) => [k, rec(s)])) });

test('D605: the thresholds are D605\'s, and the pairs are §6\'s', () => {
  assert.deepEqual([MIN_COMPARED, ALIGNED, FAR_APART], [3, 0.25, 0.5]);
  assert.deepEqual([...AXAL_KEYS], ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition']);
  assert.deepEqual([...pairDimensions('founder', 'investor')],
    ['founder_risk_appetite', 'founder_growth_vs_sustain', 'schwartz_achievement', 'schwartz_benevolence', 'schwartz_universalism']);
  assert.deepEqual([...pairDimensions('partner', 'founder')],
    ['founder_autonomy_vs_structure', 'schwartz_achievement', 'schwartz_benevolence', 'schwartz_universalism', 'schwartz_self_direction']);
  assert.equal(pairDimensions('founder', 'advisor').length, 4);
  assert.equal(pairDimensions('founder', 'founder').length, 9);
  assert.deepEqual([...pairDimensions('investor', 'partner')], [], 'no founder: the Axal values only');
  assert.deepEqual([sideOf('coach'), sideOf('admin'), sideOf('Founder')], ['advisor', 'other', 'founder']);
});

test('D605: fewer than 3 dimensions recorded on both sides is null, never aligned', () => {
  const r = valuesFit({ side: 'founder', profile: P({ integrity: 0.9, curiosity: 0.9 }) },
    { side: 'investor', profile: P({ integrity: 0.9, curiosity: 0.9, resilience: 0.9 }) });
  assert.deepEqual(r, { band: null, compared: 2 });
  const zeroConf = valuesFit({ side: 'founder', profile: { axal: { integrity: rec(0.5, 0), curiosity: rec(0.5), resilience: rec(0.5) }, values: {} } },
    { side: 'founder', profile: P({ integrity: 0.5, curiosity: 0.5, resilience: 0.5 }) });
  assert.deepEqual(zeroConf, { band: null, compared: 2 }, 'a confidence of 0 is not a recorded value');
});

test('D605: one far-apart dimension makes the band far_apart, whatever the others say', () => {
  const same = { integrity: 0.8, stewardship: 0.8, curiosity: 0.8, resilience: 0.8, collaboration: 0.8 };
  const a = { side: 'founder' as const, profile: P({ ...same, ambition: 0.9 }) };
  assert.equal(valuesFit(a, { side: 'founder', profile: P({ ...same, ambition: 0.9 }) }).band, 'aligned');
  assert.equal(valuesFit(a, { side: 'founder', profile: P({ ...same, ambition: 0.4 }) }).band, 'far_apart', 'exactly 0.5 apart is far');
  assert.equal(valuesFit(a, { side: 'founder', profile: P({ ...same, ambition: 0.55 }) }).band, 'mixed');
  assert.equal(valuesFit(a, { side: 'founder', profile: P({ ...same, ambition: 0.65 }) }).band, 'aligned', '0.25 apart is aligned');
});

test('D605: a pair with no founder compares the Axal values only', () => {
  const v = { founder_risk_appetite: 2, schwartz_achievement: 2, schwartz_benevolence: 2 };
  const far = { founder_risk_appetite: -2, schwartz_achievement: -2, schwartz_benevolence: -2 };
  const r = valuesFit({ side: 'investor', profile: P({ integrity: 0.5, curiosity: 0.5, resilience: 0.5 }, v) },
    { side: 'partner', profile: P({ integrity: 0.5, curiosity: 0.5, resilience: 0.5 }, far) });
  assert.deepEqual(r, { band: 'aligned', compared: 3 }, 'a spectrum was compared between two non-founders');
});

test('D605: an investor\'s founder_risk_appetite is compared with a founder\'s, on the 0..1 scale', () => {
  const base = { integrity: 0.5, curiosity: 0.5 };
  const founder = { side: 'founder' as const, profile: P(base, { founder_risk_appetite: 2 }) };
  const r = valuesFit(founder, { side: 'investor', profile: P(base, { founder_risk_appetite: 0 }) });
  assert.deepEqual(r, { band: 'far_apart', compared: 3 }, '+2 against 0 is 0.5 apart');
  assert.equal(valuesFit(founder, { side: 'investor', profile: P(base, { founder_risk_appetite: 1 }) }).band, 'aligned', '+2 against +1 is 0.25 apart');
  const neutral = { side: 'founder' as const, profile: P(base, { founder_risk_appetite: 0 }) };
  assert.equal(valuesFit(neutral, { side: 'investor', profile: P(base, { founder_risk_appetite: 1 }) }).band, 'aligned',
    '0 against +1 is 0.25 apart once −2..+2 is put on 0..1');
  assert.equal(valuesFit(founder, { side: 'advisor', profile: P(base, { founder_risk_appetite: -2 }) }).compared, 2,
    'an advisor is not asked risk appetite, so it is not compared');
});
function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const BUILT = builtFromMigrations();



// ---------------------------------------------------------------------------
// Through the route.
// ---------------------------------------------------------------------------

const ROLE: Record<number, string> = { 2: 'founder', 3: 'founder', 20: 'investor', 21: 'investor', 22: 'partner' };
const DIMS = ['founder_risk_appetite', 'founder_growth_vs_sustain', 'founder_autonomy_vs_structure', 'schwartz_achievement', 'schwartz_benevolence'];

function seeded({ callerPublished = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  const u = db.prepare(`INSERT INTO users (id, email, name, role, is_active, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 1, 'growth', 'active')`);
  const pub = db.prepare(`INSERT INTO profile_archetype_publish (user_id, published) VALUES (?, ?)`);
  const snap = db.prepare(`INSERT INTO profile_snapshots (user_id, persona, engine_version, trigger_kind, displayed_slug, computed_slug,
      traits_json, skills_json, values_json, axal_values_json, computed_at) VALUES (?, ?, 'v2', 'answer', ?, ?, '{}', '{}', '{}', '{}', '2026-10-01')`);
  for (const [id, role] of Object.entries(ROLE)) {
    u.run(Number(id), `u${id}@example.test`, `Member ${id}`, role);
    pub.run(Number(id), Number(id) === 2 ? (callerPublished ? 1 : 0) : Number(id) === 3 ? 0 : 1);
  }
  snap.run(2, 'founder', 'fo_missionary', 'fo_missionary');
  snap.run(20, 'investor', 'inv_thesis_backer', 'inv_thesis_backer');   // aligned with the caller
  snap.run(21, 'investor', 'inv_thesis_backer', 'inv_thesis_backer');   // far apart on risk appetite only
  snap.run(22, 'partner', 'pt_systems_builder', 'pt_systems_builder');  // too little recorded
  const dim = db.prepare(`INSERT INTO value_dimensions (slug, label, family) VALUES (?, ?, 'test')`);
  for (const d of DIMS) dim.run(d, d);
  const id = (slug: string) => (db.prepare('SELECT id FROM value_dimensions WHERE slug = ?').get(slug) as any).id;
  const uv = db.prepare(`INSERT INTO user_values (user_id, dimension_id, score, confidence) VALUES (?, ?, ?, 0.8)`);
  const av = db.prepare(`INSERT INTO axal_values (user_id, value_key, score, confidence) VALUES (?, ?, ?, 0.7)`);
  for (const k of ['integrity', 'curiosity', 'collaboration']) { av.run(2, k, 0.8); av.run(20, k, 0.75); av.run(21, k, 0.8); }
  av.run(22, 'integrity', 0.8);
  uv.run(2, id('founder_risk_appetite'), 1.5);
  uv.run(20, id('founder_risk_appetite'), 1.2);
  uv.run(21, id('founder_risk_appetite'), -1.5);
  uv.run(22, id('founder_autonomy_vs_structure'), 2);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  return { db, env };
}

const Q = '/published-members?archetypes=inv_thesis_backer,pt_systems_builder';

test('D605 route: each match carries a band and a count; one far dimension makes far_apart', async () => {
  const { env } = seeded();
  const r = await call(profileHistory, env, 2, Q);
  assert.equal(r.status, 200, r.text);
  const fit = Object.fromEntries(r.body.items.map((m: any) => [m.user_id, m.values_fit]));
  assert.deepEqual(fit[20], { band: 'aligned', compared: 4 });
  assert.deepEqual(fit[21], { band: 'far_apart', compared: 4 }, 'the one gap was averaged away');
  assert.deepEqual(fit[22], { band: null, compared: 1 }, 'too little recorded must be null');
  assert.equal(r.body.values_fit_reason, null);
});

test('D605 route: a caller who has not published gets no comparison, and the reason', async () => {
  const { env } = seeded({ callerPublished: false });
  const r = await call(profileHistory, env, 2, Q);
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length > 0);
  assert.ok(r.body.items.every((m: any) => m.values_fit === null));
  assert.match(r.body.values_fit_reason, /Publish your own archetype/);
});

test('D605 route: no dimension name, score or confidence leaves the reply', async () => {
  const { env } = seeded();
  const r = await call(profileHistory, env, 2, Q);
  assert.doesNotMatch(r.text, /founder_|schwartz_|integrity|curiosity|collaboration|ambition|risk|0\.8|0\.75|1\.5|confidence|score/);
});

test('D605 route: a failed values read is a 503, never a list of null bands', async () => {
  const { db, env } = seeded();
  db.exec('DROP TABLE value_dimensions');
  const r = await call(profileHistory, env, 2, Q);
  assert.equal(r.status, 503);
  assert.equal('items' in r.body, false);
});
async function tokenFor(who: number) {
  return new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(app: any, env: any, who: number, path: string) {
  const res: Response = await app.request(path, { headers: { Authorization: `Bearer ${await tokenFor(who)}` } }, env)
    .catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body, text };
}

