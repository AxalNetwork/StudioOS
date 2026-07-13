/**
 * Fit v2 — route-level tests for /api/fit (routes/fit.ts).
 *
 * Real behavior, minimal stubbing: a node:sqlite database behind a D1 adapter
 * (writeRouter.fit.test.ts pattern), a jose JWT (advisor.answered.test.ts
 * pattern), and a tiny wrapper app that mirrors index.ts's onError mapping so
 * thrown 'Unauthorized'/'Forbidden' surface as 401/403 like production.
 *
 * Locks in the staged-flow contract:
 *   1. POST /sessions creates ONE hidden advisor conversation (state='fit_v2')
 *      and resumes the same in_progress session on repeat calls;
 *   2. POST /sessions/:uid/answers batches through the shared writeRouter
 *      pipeline → advisor_answers (on the hidden conversation) + field_sources
 *      (evidence_text = raw), with structured fan-out (ambition → axal_values)
 *      and per-item invalid handling;
 *   3. answers are rejected on someone else's session (403) and on unknown ids;
 *   4. POST /sessions/:uid/submit persists an append-only fit_decisions row and
 *      stamps the session scored; GET /decisions/me returns it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import fitRoutes from '../src/routes/fit.ts';
import { fitV2BankFor } from '../src/services/advisor/questionBank.ts';
import type { Env } from '../src/types';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

function makeEnv(): Env {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT,
      is_active INTEGER DEFAULT 1, email_verified INTEGER DEFAULT 1,
      advisor_locked INTEGER DEFAULT 0, advisor_shadow_flag INTEGER DEFAULT 0,
      investor_subscription_status TEXT, subscription_status TEXT,
      spinout_lab_active INTEGER DEFAULT 0, spinout_lab_week INTEGER DEFAULT 1);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, jti TEXT, user_id INTEGER, revoked_at TEXT);
    CREATE TABLE mi_pro_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT, subscription_id TEXT);
    -- Fit v2 tables created eagerly: services/fitV2Schema.ts memoizes its
    -- ensure with a module-global _ready flag, so only the FIRST test's env
    -- would get the lazy bootstrap — every fresh :memory: DB needs the shape.
    CREATE TABLE fit_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      user_id INTEGER NOT NULL, role_context TEXT NOT NULL, bank_version TEXT NOT NULL DEFAULT 'v2.0',
      core_only INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'in_progress',
      current_stage TEXT NOT NULL DEFAULT 'context', conversation_id INTEGER, progress_json TEXT,
      decision_id INTEGER, source TEXT NOT NULL DEFAULT 'staged',
      started_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT);
    CREATE TABLE fit_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      user_id INTEGER NOT NULL, session_id INTEGER, role_context TEXT NOT NULL,
      bank_version TEXT NOT NULL DEFAULT 'v2.0', engine_version TEXT NOT NULL DEFAULT 'v2.0',
      outcome TEXT NOT NULL, culture_score REAL NOT NULL DEFAULT 0, role_score REAL NOT NULL DEFAULT 0,
      archetype_primary TEXT, archetype_secondary TEXT, archetype_margin REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0, evidence_quality REAL NOT NULL DEFAULT 0,
      coverage_json TEXT, values_json TEXT, skills_json TEXT, rubric_json TEXT,
      gaps_json TEXT, flags_json TEXT, contradictions_json TEXT, narrative TEXT,
      computed_by INTEGER, computed_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE fit_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, subject_user_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL, evidence_ratings_json TEXT, override_outcome TEXT, override_reason TEXT,
      requires_followup INTEGER NOT NULL DEFAULT 0, followup_json TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (decision_id, reviewer_id));
    CREATE TABLE profile_archetypes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, persona TEXT, archetype_slug TEXT,
      archetype_label TEXT, traits_json TEXT, confidence REAL, distance REAL, narrative TEXT,
      computed_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE advisor_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER, persona TEXT,
      state TEXT, current_question_id TEXT, total_questions INTEGER DEFAULT 0,
      answered_count INTEGER DEFAULT 0, skipped_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE advisor_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, user_id INTEGER,
      question_id TEXT NOT NULL, raw_value TEXT, saved_to_table TEXT, saved_to_column TEXT,
      saved_to_id TEXT, saved_status TEXT, saved_error TEXT,
      created_at TEXT DEFAULT (datetime('now')), UNIQUE (conversation_id, question_id));
    CREATE TABLE field_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question_id TEXT NOT NULL,
      page_target TEXT, saved_to_table TEXT, saved_to_column TEXT, saved_to_id TEXT,
      source TEXT DEFAULT 'advisor', evidence_text TEXT,
      filled_at TEXT DEFAULT (datetime('now')), UNIQUE (user_id, question_id));
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE axal_values (
      user_id INTEGER NOT NULL, value_key TEXT NOT NULL, score REAL DEFAULT 0,
      confidence REAL DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, value_key));
    CREATE TABLE axal_fit_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, persona TEXT, total_score REAL,
      band TEXT, rubric_json TEXT, red_flags_json TEXT, signal_quality REAL,
      narrative_fit TEXT, computed_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE skill_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, label TEXT, is_radar_axis INTEGER DEFAULT 1, display_order INTEGER DEFAULT 0);
    CREATE TABLE skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, category_slug TEXT, label TEXT, display_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
    CREATE TABLE user_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, skill_id INTEGER,
      self_level INTEGER DEFAULT 0, taxonomy_version TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, skill_id));
    CREATE TABLE value_dimensions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, label TEXT, family TEXT, display_order INTEGER DEFAULT 0);
  `);
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (1, 'subject@example.com', 'Subject', 'founder')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (2, 'other@example.com', 'Other', 'investor')`).run();

  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...vals: unknown[]) { bound = vals; return stmt; },
        async run() { db.prepare(sql).run(...(bound as never[])); return { success: true } as never; },
        async first<T = unknown>() { return (db.prepare(sql).get(...(bound as never[])) ?? null) as T | null; },
        async all<T = unknown>() { return { results: db.prepare(sql).all(...(bound as never[])) as T[] } as never; },
      };
      return stmt;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 } as never; },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) { return Promise.all(stmts.map((s) => s.run())); },
  };
  return { DB, JWT_SECRET, ENVIRONMENT: 'development', __raw: db } as unknown as Env;
}

// Mirror index.ts's onError string→status mapping for the sub-router.
function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.onError((err, c) => {
    const msg = (err as Error).message || '';
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
    return c.json({ detail: 'Internal server error', error: msg }, 500);
  });
  app.route('/', fitRoutes);
  return app;
}

async function mintToken(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function jsonReq(method: string, body?: unknown, token?: string) {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

const FOUNDER_BANK = fitV2BankFor('founder', { coreOnly: false });
const AMBITION_ID = 'fit.founder.v2_val_ambition_direct';
const TRADE_ID = 'fit.founder.v2_val_integrity_trade';

test('sessions: create → hidden fit_v2 conversation; repeat POST resumes the same session', async () => {
  const app = makeApp();
  const env = makeEnv();
  const token = await mintToken(1, 'founder');

  const res1 = await app.request('/sessions', jsonReq('POST', { role_context: 'founder' }, token), env);
  assert.equal(res1.status, 200);
  const body1 = (await res1.json()) as never as Record<string, never>;
  const session1 = body1.session as unknown as { uid: string; role_context: string; status: string };
  assert.ok(session1.uid);
  assert.equal(session1.role_context, 'founder');
  assert.equal(session1.status, 'in_progress');
  // Stage envelope covers the full core bank.
  const stages = body1.stages as unknown as Array<{ key: string; question_ids: string[] }>;
  assert.deepEqual(stages.map((s) => s.key), ['context', 'values', 'archetypes', 'skills', 'validation']);

  // The hidden conversation exists exactly once, state='fit_v2'.
  const raw = (env as never as { __raw: DatabaseSync }).__raw;
  const convs = raw.prepare(`SELECT state, user_id FROM advisor_conversations`).all() as Array<{ state: string; user_id: number }>;
  assert.equal(convs.length, 1);
  assert.equal(convs[0].state, 'fit_v2');
  assert.equal(convs[0].user_id, 1);

  const res2 = await app.request('/sessions', jsonReq('POST', { role_context: 'founder' }, token), env);
  const body2 = (await res2.json()) as never as Record<string, never>;
  assert.equal((body2.session as unknown as { uid: string }).uid, session1.uid, 'resume, not duplicate');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM fit_sessions`).get()!.n, 1);
});

test('answers: batch routes through writeRouter → advisor_answers + field_sources + fan-out; invalid ids rejected per-item', async () => {
  const app = makeApp();
  const env = makeEnv();
  const token = await mintToken(1, 'founder');
  const start = (await (await app.request('/sessions', jsonReq('POST', { role_context: 'founder' }, token), env)).json()) as never as Record<string, never>;
  const uid = (start.session as unknown as { uid: string }).uid;

  const tradeOpt = FOUNDER_BANK.find((q) => q.id === TRADE_ID)!.fit_v2!.options_v2![0].key;
  const res = await app.request(`/sessions/${uid}/answers`, jsonReq('POST', {
    stage: 'values',
    answers: [
      { question_id: AMBITION_ID, value: '5' },
      { question_id: TRADE_ID, value: tradeOpt },
      { question_id: 'fit.founder.not_a_v2_id', value: '3' },
      { question_id: 'founder.financials.mrr', value: '99999' }, // smuggle attempt
    ],
  }, token), env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as never as { results: Array<{ question_id: string; status: string }> };
  const byId = Object.fromEntries(body.results.map((r) => [r.question_id, r.status]));
  assert.equal(byId[AMBITION_ID], 'saved');
  assert.equal(byId[TRADE_ID], 'saved');
  assert.equal(byId['fit.founder.not_a_v2_id'], 'invalid');
  assert.equal(byId['founder.financials.mrr'], 'invalid', 'non-v2 ids cannot ride the staged batch');

  const raw = (env as never as { __raw: DatabaseSync }).__raw;
  // advisor_answers rows live on the hidden conversation.
  const answers = raw.prepare(`SELECT question_id, raw_value, saved_status FROM advisor_answers ORDER BY question_id`).all() as Array<Record<string, string>>;
  assert.equal(answers.length, 2);
  // field_sources carries the raw answer (the engine's source of truth).
  const fs = raw.prepare(`SELECT question_id, evidence_text, source FROM field_sources ORDER BY question_id`).all() as Array<Record<string, string>>;
  assert.equal(fs.length, 2);
  assert.ok(fs.every((r) => r.source === 'fit_staged'));
  assert.equal(fs.find((r) => r.question_id === AMBITION_ID)!.evidence_text, '5');
  // Structured fan-out: ambition landed in axal_values.
  const ambition = raw.prepare(`SELECT score FROM axal_values WHERE user_id = 1 AND value_key = 'ambition'`).get() as { score: number } | undefined;
  assert.ok(ambition);
  assert.equal(ambition!.score, 1);
});

test('answers: someone else’s session is 403; unauthenticated is 401', async () => {
  const app = makeApp();
  const env = makeEnv();
  const owner = await mintToken(1, 'founder');
  const start = (await (await app.request('/sessions', jsonReq('POST', {}, owner), env)).json()) as never as Record<string, never>;
  const uid = (start.session as unknown as { uid: string }).uid;

  const intruder = await mintToken(2, 'investor');
  const res = await app.request(`/sessions/${uid}/answers`, jsonReq('POST', { answers: [{ question_id: AMBITION_ID, value: '5' }] }, intruder), env);
  assert.equal(res.status, 403);

  const anon = await app.request('/sessions', jsonReq('POST', {}), env);
  assert.equal(anon.status, 401);
});

test('submit: persists an append-only decision, stamps the session, and /decisions/me returns it', async () => {
  const app = makeApp();
  const env = makeEnv();
  const token = await mintToken(1, 'founder');
  const start = (await (await app.request('/sessions', jsonReq('POST', { role_context: 'founder' }, token), env)).json()) as never as Record<string, never>;
  const uid = (start.session as unknown as { uid: string }).uid;

  // Thin profile → still submits, lands insufficient_evidence honestly.
  await app.request(`/sessions/${uid}/answers`, jsonReq('POST', {
    answers: [{ question_id: AMBITION_ID, value: '5' }],
  }, token), env);
  const res = await app.request(`/sessions/${uid}/submit`, jsonReq('POST', {}, token), env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as never as { decision: Record<string, unknown> };
  assert.equal(body.decision.outcome, 'insufficient_evidence');
  assert.equal(body.decision.role_context, 'founder');
  assert.ok(body.decision.playbook, 'decision ships with its playbook copy');

  const raw = (env as never as { __raw: DatabaseSync }).__raw;
  const sessionRow = raw.prepare(`SELECT status, decision_id, submitted_at FROM fit_sessions`).get() as Record<string, unknown>;
  assert.equal(sessionRow.status, 'scored');
  assert.ok(sessionRow.decision_id);
  assert.ok(sessionRow.submitted_at);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM fit_decisions`).get()!.n, 1);

  const me = await app.request('/decisions/me?role=founder', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(me.status, 200);
  const meBody = (await me.json()) as never as { latest: Record<string, unknown> | null; history: unknown[] };
  assert.ok(meBody.latest);
  assert.equal(meBody.latest!.outcome, 'insufficient_evidence');
  assert.equal(meBody.history.length, 1);
});

test('config: strips scoring internals from the subject payload', async () => {
  const app = makeApp();
  const env = makeEnv();
  const token = await mintToken(1, 'founder');
  const res = await app.request('/config?role=founder&full=1', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as never as { questions: Array<Record<string, unknown>>; roles: unknown[] };
  assert.equal(body.roles && (body.roles as unknown[]).length, 6);
  for (const q of body.questions) {
    assert.equal('signal_notes' in q, false);
    assert.equal('validation_pair' in q, false);
    assert.equal('measures' in q, false);
    for (const o of (q.options as Array<Record<string, unknown>> | null) || []) {
      assert.equal('loads' in o, false, 'option loads are stripped');
      assert.equal('score' in o, false, 'option scores are stripped');
      assert.equal('flag' in o, false, 'option flags are stripped');
    }
  }
});
