/**
 * Task #19 — Best-Fit counterparty matching service tests.
 *
 * Exercises the REAL computeCounterpartyMatches() (services/bestFit.ts) against
 * an in-memory SQLite database wrapped in a minimal D1 adapter. Asserts the
 * counterparty taxonomy + privacy rules the spec requires:
 *
 *   1. Five counterparty types are always returned, in canonical order.
 *   2. Role pools: cofounder=role 'founder', investor='investor', partner='partner'.
 *   3. advisors directory splits by price: free office-hours → advisor,
 *      paid (hourly_rate_usd > 0) → coach (mutually exclusive).
 *   4. The viewer is never matched against themselves.
 *   5. Role pools are consent-gated (user_settings.matching_opt_in); an opted-out
 *      founder is excluded. The advisor directory is its own opt-in (is_active).
 *   6. Candidates with no values/skills signal are skipped.
 *   7. Each match carries identity + a 0..100 score + band.
 *
 * Run via the strip-types loader (see package.json test:drift).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { computeCounterpartyMatches, COUNTERPARTY_TYPES, buildBestFitReport } from '../src/services/bestFit.ts';
import { loadUserVectors } from '../src/services/matchingVectors.ts';
import type { Env } from '../src/types';

const AXES = ['product', 'engineering', 'design', 'gtm_sales',
  'marketing_brand', 'finance_ops', 'legal_compliance', 'capital_network'];
const DIMS = ['founder_mission_vs_profit', 'founder_speed_vs_quality', 'founder_risk_appetite'];

function makeEnv(): { env: Env; raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT,
      role TEXT NOT NULL DEFAULT 'founder', is_active INTEGER DEFAULT 1);
    CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, matching_opt_in INTEGER DEFAULT 0);
    CREATE TABLE advisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, display_name TEXT,
      hourly_rate_usd INTEGER, is_active INTEGER DEFAULT 1);
    CREATE TABLE skill_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE);
    CREATE TABLE skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE,
      category_slug TEXT, self_level INTEGER);
    CREATE TABLE value_dimensions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE);
    CREATE TABLE user_values (user_id INTEGER, dimension_id INTEGER, score REAL,
      confidence REAL, PRIMARY KEY (user_id, dimension_id));
    CREATE TABLE user_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
      skill_id INTEGER, self_level INTEGER);
  `);
  for (const slug of AXES) {
    db.prepare(`INSERT INTO skill_categories (slug) VALUES (?)`).run(slug);
    db.prepare(`INSERT INTO skills (slug, category_slug) VALUES (?, ?)`).run(`${slug}_rep`, slug);
  }
  for (const slug of DIMS) db.prepare(`INSERT INTO value_dimensions (slug) VALUES (?)`).run(slug);

  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...vals: unknown[]) { bound = vals; return stmt; },
        async run() { db.prepare(sql).run(...(bound as any[])); return { success: true } as any; },
        async first<T = any>() { return (db.prepare(sql).get(...(bound as any[])) ?? null) as T | null; },
        async all<T = any>() { return { results: db.prepare(sql).all(...(bound as any[])) as T[] } as any; },
      };
      return stmt;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 } as any; },
    async batch(stmts: any[]) { return Promise.all(stmts.map((s) => s.run())); },
  };
  return { env: { DB } as unknown as Env, raw: db };
}

function seedUser(
  db: DatabaseSync,
  id: number, role: string, name: string, optIn: boolean,
) {
  db.prepare(`INSERT INTO users (id, uid, name, role, is_active) VALUES (?, ?, ?, ?, 1)`)
    .run(id, `u${id}`, name, role);
  db.prepare(`INSERT INTO user_settings (user_id, matching_opt_in) VALUES (?, ?)`)
    .run(id, optIn ? 1 : 0);
}

function seedVectors(db: DatabaseSync, userId: number, skillLevel: number, valueScore: number) {
  for (const slug of AXES) {
    const skillId = (db.prepare(`SELECT id FROM skills WHERE slug = ?`).get(`${slug}_rep`) as any).id;
    db.prepare(`INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, ?, ?)`)
      .run(userId, skillId, skillLevel);
  }
  for (const slug of DIMS) {
    const dimId = (db.prepare(`SELECT id FROM value_dimensions WHERE slug = ?`).get(slug) as any).id;
    db.prepare(`INSERT INTO user_values (user_id, dimension_id, score, confidence) VALUES (?, ?, ?, 0.8)`)
      .run(userId, dimId, valueScore);
  }
}

async function buildWorld() {
  const { env, raw: db } = makeEnv();
  // Viewer (founder), strong on every axis so candidates can complement.
  seedUser(db, 1, 'founder', 'Viewer', true);
  seedVectors(db, 1, 4, 2);
  // Co-founder pool: one opted-in founder with signal, one opted-OUT founder.
  seedUser(db, 2, 'founder', 'Cofounder Cand', true);
  seedVectors(db, 2, 1, 2); // weak skills → complementary
  seedUser(db, 7, 'founder', 'Opted Out Founder', false);
  seedVectors(db, 7, 1, 2);
  // Investor + partner pools (opted in, with signal).
  seedUser(db, 3, 'investor', 'Investor Cand', true);
  seedVectors(db, 3, 2, 1);
  seedUser(db, 4, 'partner', 'Partner Cand', true);
  seedVectors(db, 4, 3, 1);
  // Advisor directory: free office-hours advisor (id 5) + paid coach (id 6).
  seedUser(db, 5, 'founder', 'Free Advisor', false);
  seedVectors(db, 5, 5, 1);
  db.prepare(`INSERT INTO advisors (user_id, display_name, hourly_rate_usd, is_active) VALUES (?, ?, ?, 1)`)
    .run(5, 'Free Advisor', 0);
  seedUser(db, 6, 'founder', 'Paid Coach', false);
  seedVectors(db, 6, 5, 1);
  db.prepare(`INSERT INTO advisors (user_id, display_name, hourly_rate_usd, is_active) VALUES (?, ?, ?, 1)`)
    .run(6, 'Paid Coach', 250);

  const viewerVectors = await loadUserVectors(env, 1);
  const results = await computeCounterpartyMatches(env, 1, viewerVectors, { limit: 5 });
  const byType = Object.fromEntries(results.map((r) => [r.type, r]));
  return { env, db, results, byType };
}

test('returns all five counterparty types in canonical order', async () => {
  const { results } = await buildWorld();
  assert.deepEqual(results.map((r) => r.type), [...COUNTERPARTY_TYPES]);
});

test('role pools resolve by users.role and exclude opted-out + self', async () => {
  const { byType } = await buildWorld();
  // Co-founder: only the opted-in founder (id 2); opted-out (7) and self (1) excluded.
  assert.equal(byType.cofounder.count, 1);
  assert.equal(byType.cofounder.matches[0].user_id, 2);
  assert.equal(byType.investor.count, 1);
  assert.equal(byType.investor.matches[0].user_id, 3);
  assert.equal(byType.partner.count, 1);
  assert.equal(byType.partner.matches[0].user_id, 4);
});

test('advisor directory splits by price into advisor vs coach (mutually exclusive)', async () => {
  const { byType } = await buildWorld();
  assert.equal(byType.advisor.count, 1);
  assert.equal(byType.advisor.matches[0].user_id, 5);
  assert.equal(byType.coach.count, 1);
  assert.equal(byType.coach.matches[0].user_id, 6);
});

test('matches carry identity + a 0..100 score + band', async () => {
  const { byType } = await buildWorld();
  const m = byType.cofounder.matches[0];
  assert.equal(typeof m.name, 'string');
  assert.equal(m.uid, 'u2');
  assert.ok(m.match_score >= 0 && m.match_score <= 100);
  assert.ok(['strong', 'good', 'fair', 'low'].includes(m.band));
});

test('candidates with no signal are skipped', async () => {
  const { env, db } = await buildWorld();
  // Add an opted-in investor with NO vectors → must not appear.
  db.prepare(`INSERT INTO users (id, uid, name, role, is_active) VALUES (8, 'u8', 'Empty Investor', 'investor', 1)`).run();
  db.prepare(`INSERT INTO user_settings (user_id, matching_opt_in) VALUES (8, 1)`).run();
  const viewerVectors = await loadUserVectors(env, 1);
  const results = await computeCounterpartyMatches(env, 1, viewerVectors, { limit: 5 });
  const investor = results.find((r) => r.type === 'investor')!;
  assert.equal(investor.count, 1); // still only id 3, not the empty id 8
  assert.ok(!investor.matches.some((m) => m.user_id === 8));
});

test('buildBestFitReport returns null for a nonexistent user', async () => {
  const { env } = await buildWorld();
  assert.equal(await buildBestFitReport(env, 99999), null);
});

test('buildBestFitReport assembles subject, matches, gaps, and explicit nulls', async () => {
  const { env } = await buildWorld();
  // Subject = the weak-skilled co-founder candidate (id 2, every axis level 1).
  const report = await buildBestFitReport(env, 2);
  assert.ok(report);
  assert.equal(report!.subject.user_id, 2);
  assert.equal(report!.subject.name, 'Cofounder Cand');
  // Five counterparty types, in canonical order.
  assert.deepEqual(report!.matches.map((m) => m.type), [...COUNTERPARTY_TYPES]);
  // All 8 axes are below 2.5 → every axis is a gap.
  assert.equal(report!.gaps_to_fill.length, AXES.length);
  // No project owned → no spin-out assessment, no fabricated fallback.
  assert.equal(report!.venture, null);
  // No stored fit scores in this fixture → empty fit + null primary persona.
  assert.deepEqual(report!.fit, []);
  assert.equal(report!.primary_persona, null);
  // Axal values always resolves to the 5-key default vector.
  assert.equal(report!.axal_values.length, 5);
});
