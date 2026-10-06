/**
 * D602 (#1006) — the archetype card's published-member matches:
 * `GET /api/profile/published-members?archetypes=…`.
 *
 * What is pinned:
 *   - only members who published, whose account is active, and whose LATEST
 *     snapshot (per persona) displays a named archetype are listed, never the caller;
 *   - a row carries name, role, persona, slug and label, and no trait,
 *     confidence, history, skill or value;
 *   - the archetype list is checked (known slugs, 1 to 10) before any read;
 *   - a caller whose archetype is locked (D594) gets `locked`, with no members;
 *   - a failed read is a 503, never an empty list.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/profile_published_members_d602.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import profileHistory, { PUBLISHED_MEMBERS_LIMIT } from '../src/routes/profile_history.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

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


// id, role, name, subscription tier, active, published
const USERS: Array<[number, string, string, string, number, number | null]> = [
  [2, 'founder', 'Caller Founder', 'growth', 1, 1],     // the caller, published: never listed
  [1, 'founder', 'Free Founder', 'free', 1, null],      // a locked caller
  [20, 'investor', 'Ivy Investor', 'free', 1, 1],       // published, displays inv_thesis_backer
  [21, 'partner', 'Pat Partner', 'free', 1, 1],         // published; latest snapshot moved off pt_systems_builder
  [22, 'advisor', 'Ada Advisor', 'free', 1, 0],         // unpublished
  [23, 'founder', 'Gone Founder', 'growth', 0, 1],      // published, inactive
  [24, 'founder', 'Rocket Founder', 'growth', 1, 1],    // published, displays fo_rocketeer
  [25, 'partner', 'Bea Builder', 'free', 1, 1],         // published, displays pt_systems_builder
];
const ROLE: Record<number, string> = Object.fromEntries(USERS.map((u) => [u[0], u[1]]));

function seeded() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  const ins = db.prepare(`INSERT INTO users (id, email, name, role, is_active, subscription_tier, subscription_status)
                          VALUES (?, ?, ?, ?, ?, ?, 'active')`);
  const pub = db.prepare(`INSERT INTO profile_archetype_publish (user_id, published) VALUES (?, ?)`);
  for (const [id, role, name, tier, active, published] of USERS) {
    ins.run(id, `u${id}@example.test`, name, role, active, tier);
    if (published != null) pub.run(id, published);
  }
  const snap = db.prepare(`INSERT INTO profile_snapshots (user_id, persona, engine_version, trigger_kind, displayed_slug, computed_slug,
      secondary_slug, confidence, margin, traits_json, skills_json, values_json, axal_values_json, hysteresis_json, computed_at)
    VALUES (?, ?, 'v2', 'answer', ?, ?, NULL, 0.9, 0.3, '{"builder":4.5}', '{"product":4}', '{"risk_appetite":3}', '{}', '{}', ?)`);
  snap.run(2, 'founder', 'fo_missionary', 'fo_missionary', '2026-10-01T00:00:00Z');
  snap.run(20, 'investor', 'inv_thesis_backer', 'inv_thesis_backer', '2026-10-01T00:00:00Z');
  snap.run(21, 'partner', 'pt_systems_builder', 'pt_systems_builder', '2026-09-01T00:00:00Z');
  snap.run(21, 'partner', 'pt_growth_catalyst', 'pt_growth_catalyst', '2026-10-01T00:00:00Z');
  snap.run(22, 'advisor', 'mt_sage_guide', 'mt_sage_guide', '2026-10-01T00:00:00Z');
  snap.run(23, 'founder', 'fo_rocketeer', 'fo_rocketeer', '2026-10-01T00:00:00Z');
  snap.run(24, 'founder', 'fo_rocketeer', 'fo_rocketeer', '2026-10-01T00:00:00Z');
  snap.run(25, 'partner', 'pt_systems_builder', 'pt_systems_builder', '2026-10-01T00:00:00Z');
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
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

const MISSIONARY_MATCHES = 'fo_rocketeer,fo_maverick,inv_thesis_backer,mt_sage_guide,pt_systems_builder,fo_missionary';
const q = (slugs: string) => `/published-members?archetypes=${encodeURIComponent(slugs)}`;

test('D602: only published, active members whose latest snapshot displays a named archetype; never the caller', async () => {
  const { env } = seeded();
  const r = await call(profileHistory, env, 2, q(MISSIONARY_MATCHES));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.locked, false);
  assert.deepEqual(r.body.items.map((m: any) => [m.user_id, m.slug]),
    [[20, 'inv_thesis_backer'], [25, 'pt_systems_builder'], [24, 'fo_rocketeer']].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
  const ids = r.body.items.map((m: any) => m.user_id);
  assert.ok(!ids.includes(2), 'the caller was listed');
  assert.ok(!ids.includes(22), 'an unpublished member was listed');
  assert.ok(!ids.includes(23), 'an inactive member was listed');
  assert.ok(!ids.includes(21), 'an archetype the member no longer displays was listed');
  assert.equal(r.body.more, false);
});

test('D602: a row is the published archetype and whose it is, nothing else', async () => {
  const { env } = seeded();
  const r = await call(profileHistory, env, 2, q('inv_thesis_backer'));
  // D605 adds `values_fit` (a band and a count, never a value); no values are seeded here.
  assert.deepEqual(r.body.items, [{ user_id: 20, name: 'Ivy Investor', role: 'investor', persona: 'investor', slug: 'inv_thesis_backer', label: 'Thesis-Driven Backer', values_fit: { band: null, compared: 0 } }]);
  assert.doesNotMatch(r.text, /builder|risk_appetite|product|0\.9|confidence|traits|email|example\.test/,
    'a trait, skill, value, confidence or email left the route');
});

test('D602: the archetype list is checked before any read', async () => {
  const { env } = seeded();
  for (const bad of ['', 'not_an_archetype', 'fo_rocketeer,nope', Array.from({ length: 11 }, () => 'x').join(',')]) {
    const r = await call(profileHistory, env, 2, q(bad));
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error, 'invalid_archetypes');
  }
  const eleven = 'fo_missionary,fo_rocketeer,fo_architect,fo_maverick,inv_thesis_backer,inv_network_amplifier,inv_hands_on_partner,inv_disciplined_allocator,pt_strategic_connector,pt_embedded_operator,pt_growth_catalyst';
  assert.equal((await call(profileHistory, env, 2, q(eleven))).status, 400, 'eleven slugs were accepted');
  assert.equal((await call(profileHistory, env, 2, q("fo_rocketeer' OR 1=1 --"))).status, 400);
});

test('D602: a caller whose archetype is locked gets locked, and no member', async () => {
  const { env } = seeded();
  const r = await call(profileHistory, env, 1, q(MISSIONARY_MATCHES));
  assert.equal(r.status, 200);
  assert.equal(r.body.locked, true);
  assert.equal(r.body.archetype_access.required_plan.tier, 'growth');
  assert.equal('items' in r.body, false);
});

test('D602: the list is capped and says there are more', async () => {
  const { db, env } = seeded();
  const u = db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, 'founder', 1)`);
  const p = db.prepare(`INSERT INTO profile_archetype_publish (user_id, published) VALUES (?, 1)`);
  const s = db.prepare(`INSERT INTO profile_snapshots (user_id, persona, engine_version, trigger_kind, displayed_slug, computed_slug,
      traits_json, skills_json, values_json, axal_values_json, computed_at) VALUES (?, 'founder', 'v2', 'answer', 'fo_maverick', 'fo_maverick', '{}', '{}', '{}', '{}', '2026-10-01')`);
  for (let i = 0; i < PUBLISHED_MEMBERS_LIMIT + 3; i += 1) { u.run(100 + i, `m${i}@example.test`, `Member ${i}`); p.run(100 + i); s.run(100 + i); }
  const r = await call(profileHistory, env, 2, q('fo_maverick'));
  assert.deepEqual([r.body.items.length, r.body.more], [PUBLISHED_MEMBERS_LIMIT, true]);
});

test('D602: a failed read is a 503, never an empty list', async () => {
  const { db, env } = seeded();
  db.exec('DROP TABLE profile_archetype_publish');
  const r = await call(profileHistory, env, 2, q('fo_rocketeer'));
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'published_members_unreadable');
  assert.equal('items' in r.body, false);
});
