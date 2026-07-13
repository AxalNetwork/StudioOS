/**
 * Task #19 — Best-Fit conversational write-routing unit tests.
 *
 * Exercises the REAL routeAnswer() fit branch (services/advisor/writeRouter.ts)
 * and bankFor() fit-bank inclusion against an in-memory SQLite database wrapped
 * in a minimal D1 adapter. Asserts the structured fan-out the spec requires:
 *
 *   1. bankFor appends each persona's fit bank (advisor carries advisor + coach).
 *   2. axal_value  → axal_values   (score = raw/5, confidence = 1).
 *   3. skill_axis  → user_skills   (self_level = raw on the rep skill); a 0
 *      writes no phantom skill row.
 *   4. value_dim   → user_values   (raw 0..5 → -2..+2).
 *   5. rubric-only → status 'saved', saved_to = field_sources (no structured write).
 *   6. A non-integer / out-of-range answer is rejected as 'invalid'.
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/writeRouter.fit.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { routeAnswer } from '../src/services/advisor/writeRouter.ts';
import { bankFor, fitMeasuresIndex, fitV2BankFor, type FitMeasureEntry, type Question } from '../src/services/advisor/questionBank.ts';
import type { Env, User } from '../src/types';

// ── Minimal D1 adapter over node:sqlite ────────────────────────────────────
// routeAnswer + getSQL only touch prepare().bind().{run,first,all}().
function makeEnv(): Env {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE skill_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
      label TEXT, is_radar_axis INTEGER DEFAULT 1, display_order INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
      category_slug TEXT NOT NULL, label TEXT, display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE value_dimensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
      label TEXT, family TEXT, display_order INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE axal_values (
      user_id INTEGER NOT NULL, value_key TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, value_key));
    CREATE TABLE user_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL, self_level INTEGER NOT NULL DEFAULT 0,
      evidence_url TEXT, years REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      taxonomy_version TEXT,
      UNIQUE (user_id, skill_id), CHECK (self_level >= 0 AND self_level <= 5));
    CREATE TABLE user_values (
      user_id INTEGER NOT NULL, dimension_id INTEGER NOT NULL,
      score REAL NOT NULL, confidence REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      taxonomy_version TEXT,
      PRIMARY KEY (user_id, dimension_id));
  `);

  // Seed the 8 radar axes + one representative skill each.
  const AXES = ['product', 'engineering', 'design', 'gtm_sales',
    'marketing_brand', 'finance_ops', 'legal_compliance', 'capital_network'];
  for (const slug of AXES) {
    db.prepare(`INSERT INTO skill_categories (slug, label) VALUES (?, ?)`).run(slug, slug);
    db.prepare(`INSERT INTO skills (slug, category_slug, label, display_order) VALUES (?, ?, ?, 0)`)
      .run(`${slug}_rep`, slug, `${slug} rep`);
  }
  // Seed the founder value dimensions referenced by the fit bank.
  for (const slug of ['founder_mission_vs_profit', 'founder_speed_vs_quality',
    'founder_risk_appetite', 'founder_growth_vs_sustain', 'founder_autonomy_vs_structure']) {
    db.prepare(`INSERT INTO value_dimensions (slug, label) VALUES (?, ?)`).run(slug, slug);
  }

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
  return { DB, __raw: db } as unknown as Env;
}

const USER: User = { id: 1, email: 'f@example.com', name: 'F', role: 'founder' } as User;

function founderEntry(pick: (m: FitMeasureEntry['measures']) => boolean): FitMeasureEntry {
  const e = fitMeasuresIndex().find((x) => x.persona === 'founder' && pick(x.measures));
  assert.ok(e, 'expected a founder fit question matching the predicate');
  return e!;
}

// ── bankFor inclusion ──────────────────────────────────────────────────────
test('bankFor appends each persona fit bank; advisor carries advisor + coach', () => {
  const ids = (p: Parameters<typeof bankFor>[0]) => bankFor(p).map((q) => q.id);

  assert.ok(ids('founder').some((id) => id.startsWith('fit.founder.')));
  assert.ok(ids('investor').some((id) => id.startsWith('fit.investor.')));
  assert.ok(ids('partner').some((id) => id.startsWith('fit.partner.')));

  const advisorIds = ids('advisor');
  assert.ok(advisorIds.some((id) => id.startsWith('fit.advisor.')));
  assert.ok(advisorIds.some((id) => id.startsWith('fit.coach.')));

  // Admin carries no fit bank.
  assert.ok(!ids('admin').some((id) => id.startsWith('fit.')));

  // Fit questions trail the base bank (importance:'low').
  const founderIds = ids('founder');
  const firstFit = founderIds.findIndex((id) => id.startsWith('fit.'));
  const lastBase = founderIds.map((id) => id.startsWith('fit.')).lastIndexOf(false);
  assert.ok(firstFit > lastBase, 'fit questions should come after all base questions');
});

// ── axal_value → axal_values ───────────────────────────────────────────────
test('routeAnswer: axal_value answer writes axal_values (score = raw/5, conf = 1)', async () => {
  const env = makeEnv();
  const e = founderEntry((m) => !!m.axal_value);
  const res = await routeAnswer(env, USER, e.question_id, '4');
  assert.equal(res.status, 'saved');
  assert.equal(res.saved_to?.table, 'axal_values');
  const row = await env.DB.prepare(
    `SELECT score, confidence FROM axal_values WHERE user_id = ? AND value_key = ?`,
  ).bind(USER.id, e.measures.axal_value).first<{ score: number; confidence: number }>();
  assert.ok(row);
  assert.equal(row!.score, 0.8);
  assert.equal(row!.confidence, 1);
});

// ── skill_axis → user_skills (and the 0 = no-write guard) ───────────────────
test('routeAnswer: skill_axis answer writes user_skills.self_level on the rep skill', async () => {
  const env = makeEnv();
  const e = founderEntry((m) => !!m.skill_axis && !m.axal_value);
  const res = await routeAnswer(env, USER, e.question_id, '3');
  assert.equal(res.status, 'saved');
  const row = await env.DB.prepare(
    `SELECT us.self_level FROM user_skills us
       JOIN skills s ON s.id = us.skill_id
      WHERE us.user_id = ? AND s.category_slug = ?`,
  ).bind(USER.id, e.measures.skill_axis).first<{ self_level: number }>();
  assert.ok(row, 'expected a user_skills row for the rep skill');
  assert.equal(row!.self_level, 3);
});

test('routeAnswer: a 0 skill_axis answer writes no phantom user_skills row', async () => {
  const env = makeEnv();
  const e = founderEntry((m) => !!m.skill_axis && !m.axal_value);
  const res = await routeAnswer(env, USER, e.question_id, '0');
  assert.equal(res.status, 'saved'); // still saves (raw 0 lands in field_sources)
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM user_skills WHERE user_id = ?`,
  ).bind(USER.id).first<{ n: number }>();
  assert.equal(row!.n, 0);
});

// ── value_dim → user_values ────────────────────────────────────────────────
test('routeAnswer: value_dim answer writes user_values (raw 5 → +2)', async () => {
  const env = makeEnv();
  const e = founderEntry((m) => !!m.value_dim && !m.rubric_category);
  const res = await routeAnswer(env, USER, e.question_id, '5');
  assert.equal(res.status, 'saved');
  const row = await env.DB.prepare(
    `SELECT uv.score FROM user_values uv
       JOIN value_dimensions vd ON vd.id = uv.dimension_id
      WHERE uv.user_id = ? AND vd.slug = ?`,
  ).bind(USER.id, e.measures.value_dim).first<{ score: number }>();
  assert.ok(row, 'expected a user_values row');
  assert.equal(row!.score, 2);
});

// ── rubric-only → field_sources only ───────────────────────────────────────
test('routeAnswer: rubric-only answer saves without a structured table write', async () => {
  const env = makeEnv();
  const e = founderEntry((m) => !!m.rubric_category && !m.axal_value && !m.skill_axis && !m.value_dim);
  const res = await routeAnswer(env, USER, e.question_id, '4');
  assert.equal(res.status, 'saved');
  assert.equal(res.saved_to?.table, 'field_sources');
});

// ── validation ─────────────────────────────────────────────────────────────
test('routeAnswer: non-integer / out-of-range fit answers are invalid', async () => {
  const env = makeEnv();
  const e = founderEntry((m) => !!m.axal_value);
  for (const bad of ['7', '-1', '3.5', 'soon']) {
    const res = await routeAnswer(env, USER, e.question_id, bad);
    assert.equal(res.status, 'invalid', `expected '${bad}' to be invalid`);
    assert.equal(res.error, 'schema_validation_failed');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Fit v2 — the routeFitV2Answer branch (runs BEFORE the v1 fit branch).
// ════════════════════════════════════════════════════════════════════════════

const FOUNDER_V2 = fitV2BankFor('founder', { coreOnly: false });
function v2Item(pick: (q: Question) => boolean): Question {
  const q = FOUNDER_V2.find((x) => x.fit_v2 && pick(x));
  assert.ok(q, 'expected a founder v2 item matching the predicate');
  return q!;
}

test('v2: ambition likert writes axal_values under the new key (raw/5)', async () => {
  const env = makeEnv();
  const q = v2Item((x) => x.fit_v2!.value_key === 'ambition' && x.fit_v2!.kind === 'likert' && !x.fit_v2!.reverse_scored);
  const res = await routeAnswer(env, USER, q.id, '4');
  assert.equal(res.status, 'saved');
  assert.equal(res.saved_to?.table, 'axal_values');
  const row = await env.DB.prepare(
    `SELECT score, confidence FROM axal_values WHERE user_id = ? AND value_key = 'ambition'`,
  ).bind(USER.id).first<{ score: number; confidence: number }>();
  assert.ok(row, 'expected an ambition axal_values row');
  assert.equal(row!.score, 0.8);
  assert.equal(row!.confidence, 1);
});

test('v2: tradeoff answers accept option key OR label; junk is invalid with a hint', async () => {
  const env = makeEnv();
  const q = v2Item((x) => x.fit_v2!.kind === 'tradeoff' && x.fit_v2!.value_key === 'integrity');
  const opt = q.fit_v2!.options_v2![0];

  const byKey = await routeAnswer(env, USER, q.id, opt.key);
  assert.equal(byKey.status, 'saved');
  assert.equal(byKey.saved_to?.table, 'field_sources'); // choice kinds carry no structured write

  const byLabel = await routeAnswer(env, USER, q.id, opt.label);
  assert.equal(byLabel.status, 'saved');

  const junk = await routeAnswer(env, USER, q.id, 'not-an-option');
  assert.equal(junk.status, 'invalid');
  assert.ok(junk.hint, 'invalid v2 answers carry a user-facing hint');
});

test('v2: skill self-rating writes user_skills by fitv2_* slug; recency probes and a missing seed do not', async () => {
  const env = makeEnv();
  // Seed one fitv2 priority-skill row (migration 151 shape).
  await env.DB.prepare(
    `INSERT INTO skills (slug, category_slug, label, display_order) VALUES ('fitv2_product_thinking', 'product', 'Product Thinking', 904)`,
  ).bind().run();

  const self = v2Item((x) => x.fit_v2!.kind === 'likert' && x.fit_v2!.skill_v2?.slug === 'fitv2_product_thinking' && x.fit_v2!.skill_v2?.weight == null);
  const res = await routeAnswer(env, USER, self.id, '4');
  assert.equal(res.status, 'saved');
  const row = await env.DB.prepare(
    `SELECT us.self_level FROM user_skills us JOIN skills s ON s.id = us.skill_id
      WHERE us.user_id = ? AND s.slug = 'fitv2_product_thinking'`,
  ).bind(USER.id).first<{ self_level: number }>();
  assert.ok(row, 'expected a user_skills row keyed by the fitv2 slug');
  assert.equal(row!.self_level, 4);

  // Recency probes carry a weight override → engine-only, no user_skills write.
  const recency = v2Item((x) => x.fit_v2!.kind === 'likert' && x.fit_v2!.skill_v2?.weight != null);
  const res2 = await routeAnswer(env, USER, recency.id, '5');
  assert.equal(res2.status, 'saved');
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM user_skills WHERE user_id = ?`,
  ).bind(USER.id).first<{ n: number }>();
  assert.equal(count!.n, 1, 'recency answers must not add user_skills rows');

  // A self-rating whose seed row is absent degrades to field_sources-only.
  const other = v2Item((x) => x.fit_v2!.kind === 'likert' && x.fit_v2!.skill_v2?.slug === 'fitv2_diligence' && x.fit_v2!.skill_v2?.weight == null);
  const res3 = await routeAnswer(env, USER, other.id, '3');
  assert.equal(res3.status, 'saved');
  assert.equal(res3.saved_to?.table, 'field_sources');
});

test('v2: behavioral evidence enforces a minimum length', async () => {
  const env = makeEnv();
  const q = v2Item((x) => x.fit_v2!.kind === 'behavioral_evidence' && x.fit_v2!.value_key === 'integrity');
  const short = await routeAnswer(env, USER, q.id, 'we shipped it');
  assert.equal(short.status, 'invalid');
  const long = await routeAnswer(env, USER, q.id,
    'In March 2025 I returned a $40k retainer to a client after we missed the agreed scope, told the board the mistake was my call, and rebuilt the plan with them over two weeks.');
  assert.equal(long.status, 'saved');
});

test('v2: staged-only prefixes (internal_hire) route through the v2 branch too', async () => {
  const env = makeEnv();
  const bank = fitV2BankFor('internal_hire', { coreOnly: false });
  const q = bank.find((x) => x.fit_v2?.value_key === 'ambition' && x.fit_v2?.kind === 'likert' && !x.fit_v2?.reverse_scored);
  assert.ok(q);
  const res = await routeAnswer(env, USER, q!.id, '5');
  assert.equal(res.status, 'saved');
  const row = await env.DB.prepare(
    `SELECT score FROM axal_values WHERE user_id = ? AND value_key = 'ambition'`,
  ).bind(USER.id).first<{ score: number }>();
  assert.equal(row!.score, 1);
});
