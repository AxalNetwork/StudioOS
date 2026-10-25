/**
 * D594 (#1233) — the archetype is unlocked by each licence's first paid plan,
 * and every route that returns the caller's own archetype sends none of it to a
 * free account.
 *
 * What is pinned:
 *   - each row of the tier table, both ways: free and paid founders; free,
 *     trialing, lapsed-trial and paid investors; a seat reading its primary's
 *     plan; partner, advisor and admin; an active Lab participant;
 *   - the locked reply names the plan that unlocks it, and carries no archetype
 *     key on /api/best-fit/me, /api/assessment/results/me and /api/profile/history;
 *   - the person's skills, values and answers are not locked;
 *   - /api/events/suggested drops its archetype framing on a free plan.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/archetype_entitlement_d594.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import bestFit from '../src/routes/best_fit.ts';
import assessment from '../src/routes/assessment.ts';
import profileHistory from '../src/routes/profile_history.ts';
import events from '../src/routes/events.ts';
import { archetypeAccess } from '../src/services/archetypeEntitlement.ts';
import { ensureArchetypeSchema } from '../src/services/archetypeScoring.ts';
import { ensureAssessmentSchema } from '../src/services/assessmentSchema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const DAY = 24 * 60 * 60 * 1000;
const future = new Date(Date.now() + 10 * DAY).toISOString();
const past = new Date(Date.now() - 10 * DAY).toISOString();

// id, role, founder tier, founder status, investor tier, investor status, trial end, seat primary, lab
const USERS: Array<[number, string, string, string, string, string, string | null, number | null, number]> = [
  [1, 'founder', 'free', 'active', 'free', 'free', null, null, 0],               // free founder
  [2, 'founder', 'growth', 'active', 'free', 'free', null, null, 0],             // paid founder
  [3, 'founder', 'studio', 'unpaid', 'free', 'free', null, null, 0],             // founder who stopped paying: Stripe gave up (D1052)
  [4, 'investor', 'free', 'active', 'free', 'free', null, null, 0],              // free investor
  [5, 'investor', 'free', 'active', 'professional', 'active', null, null, 0],    // paid investor
  [6, 'investor', 'free', 'active', 'professional', 'trialing', future, null, 0],// active trial
  [7, 'investor', 'free', 'active', 'professional', 'trialing', past, null, 0],  // lapsed trial
  [8, 'investor', 'free', 'active', 'institutional', 'active', null, null, 0],   // institutional primary
  [9, 'investor', 'free', 'active', 'free', 'free', null, 8, 0],                 // seat of 8, stale copy
  [10, 'investor', 'free', 'active', 'institutional', 'active', null, 4, 0],     // seat of free 4, stale paid copy
  [11, 'partner', 'free', 'active', 'free', 'free', null, null, 0],
  [12, 'advisor', 'free', 'active', 'free', 'free', null, null, 0],
  [13, 'admin', 'free', 'active', 'free', 'free', null, null, 0],
  [14, 'exploring', 'free', 'active', 'free', 'free', null, null, 1],            // active Lab participant
  [15, 'exploring', 'free', 'active', 'free', 'free', null, null, 0],            // Lab not active
];
const ROLE: Record<number, string> = Object.fromEntries(USERS.map((u) => [u[0], u[1]]));

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

async function seeded() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  // The seeded results name no session or game row; the gate is what is under test.
  db.exec('PRAGMA foreign_keys = OFF');
  const ins = db.prepare(`INSERT INTO users (id, email, name, role, is_active, subscription_tier, subscription_status,
      investor_tier, investor_subscription_status, investor_trial_ends_at, investor_seat_primary_user_id, spinout_lab_active)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [id, role, ft, fs, it, is, trial, seat, lab] of USERS) {
    ins.run(id, `u${id}@example.test`, `User ${id}`, role, ft, fs, it, is, trial, seat, lab);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (13);`);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensureArchetypeSchema(env);
  await ensureAssessmentSchema(env);
  for (const uid of [1, 2]) {
    db.prepare(`INSERT INTO profile_archetypes (user_id, persona, archetype_slug, archetype_label, traits_json, confidence, distance, narrative)
                VALUES (?, 'founder', 'visionary', 'The Visionary', '{"vision":0.9}', 0.8, 0.1, 'You see far.')`).run(uid);
    db.prepare(`INSERT INTO assessment_results (session_id, user_id, game_id, track, value_vector_json, skill_vector_json, archetype_slug, archetype_label)
                VALUES (?, ?, 1, 'founder', '{"impact":0.7}', '{"sales":0.6}', 'visionary', 'The Visionary')`).run(uid, uid);
    db.prepare(`INSERT INTO profile_snapshots (user_id, persona, engine_version, trigger_kind, displayed_slug, computed_slug, secondary_slug,
                  confidence, margin, traits_json, skills_json, values_json, axal_values_json, hysteresis_json, computed_at)
                VALUES (?, 'founder', 'v2', 'answer', 'visionary', 'visionary', 'operator', 0.8, 0.2, '{"vision":0.9}', '{"sales":0.6}',
                        '{"impact":0.7}', '{}', '{}', '2026-10-01T00:00:00Z')`).run(uid);
  }
  return { db, env };
}

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

const userRow = (db: DatabaseSync, id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;

test('each row of the tier table, both ways', async () => {
  const { db, env } = await seeded();
  const locked = async (id: number) => (await archetypeAccess(env, userRow(db, id))).locked;
  const plan = async (id: number) => ((await archetypeAccess(env, userRow(db, id))) as any).required_plan;
  assert.equal(await locked(1), true, 'a free founder saw the archetype');
  assert.deepEqual(await plan(1), { licence: 'founder', tier: 'growth', name: 'Validate + Build', price_label: '$20 / month' });
  assert.equal(await locked(2), false, 'a Growth founder was locked out');
  assert.equal(await locked(3), true, 'a past-due founder kept the archetype');
  assert.equal(await locked(4), true, 'a free investor saw the archetype');
  assert.deepEqual(await plan(4), { licence: 'investor', tier: 'professional', price_label: '$149 / month' });
  assert.equal(await locked(5), false, 'a Professional investor was locked out');
  assert.equal(await locked(6), false, 'an active investor trial was locked out');
  assert.equal(await locked(7), true, 'a lapsed investor trial kept the archetype');
  assert.equal(await locked(8), false);
  assert.equal(await locked(9), false, 'a seat did not read its Institutional primary\'s plan');
  assert.equal(await locked(10), true, 'a seat read its own stale copy instead of its free primary\'s plan');
  for (const id of [11, 12, 13]) assert.equal(await locked(id), false, `role ${ROLE[id]} was locked out`);
  assert.equal(await locked(14), false, 'an active Lab participant was locked out');
  assert.equal(await locked(15), true, 'a Lab account outside the programme saw the archetype on Free');
});

test('the archetype routes send a free account no archetype key, and the plan that unlocks it', async () => {
  const { env } = await seeded();
  const free = await call(bestFit, env, 1, '/me');
  assert.equal(free.status, 200);
  assert.equal('archetype' in free.body, false, 'best-fit sent a free founder the archetype');
  assert.equal('archetypes' in free.body, false, 'best-fit sent a free founder the archetype list');
  assert.doesNotMatch(free.text, /visionary|The Visionary|You see far/i, 'archetype text reached a free founder');
  assert.deepEqual(free.body.archetype_access, { locked: true, required_plan: { licence: 'founder', tier: 'growth', name: 'Validate + Build', price_label: '$20 / month' } });
  assert.ok('fit' in free.body && 'axal_values' in free.body, 'the fit and values were locked too');
  const paid = await call(bestFit, env, 2, '/me');
  assert.equal(paid.body.archetype?.slug, 'visionary', 'a Growth founder lost the archetype');
  assert.deepEqual(paid.body.archetype_access, { locked: false });

  const freeRes = await call(assessment, env, 1, '/results/me');
  assert.equal(freeRes.status, 200);
  const r1 = freeRes.body.results[0];
  assert.equal('archetype_slug' in r1 || 'archetype_label' in r1, false, 'an assessment result kept its archetype');
  assert.deepEqual([r1.value_vector, r1.skill_vector], [{ impact: 0.7 }, { sales: 0.6 }], 'skills or values were locked');
  assert.equal(freeRes.body.archetype_access.locked, true);
  assert.equal((await call(assessment, env, 2, '/results/me')).body.results[0].archetype_slug, 'visionary');

  const freeHist = await call(profileHistory, env, 1, '/history');
  assert.equal(freeHist.status, 200);
  const h = freeHist.body.items[0];
  for (const k of ['displayed_slug', 'computed_slug', 'secondary_slug', 'confidence', 'margin', 'traits', 'hysteresis']) {
    assert.equal(k in h, false, `a free snapshot kept ${k}`);
  }
  assert.deepEqual([h.skills, h.values], [{ sales: 0.6 }, { impact: 0.7 }], 'snapshot skills or values were locked');
  assert.equal((await call(profileHistory, env, 2, '/history')).body.items[0].displayed_slug, 'visionary');
});

test('the events suggestion drops its archetype framing on a free plan', async () => {
  const { env } = await seeded();
  const free = await call(events, env, 1, '/suggested');
  assert.equal(free.status, 200);
  assert.equal(free.body.archetype, null, 'events framed a free founder with their archetype');
  assert.equal(free.body.track, 'founder', 'the track stopped personalising');
  assert.equal((await call(events, env, 2, '/suggested')).body.archetype?.slug, 'visionary');
});
