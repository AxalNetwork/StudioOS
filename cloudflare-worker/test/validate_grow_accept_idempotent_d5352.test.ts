/**
 * D5352 (#5352) — the remaining ordinary Validate/Grow target writers use
 * the proposal id as their retry key after a partial failure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import founderValidate from '../src/routes/founder_validate.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const USER = 1;
const PROJECT = 7;
const JWT_SECRET = 'synthetic-d5352-fixture-secret';
const count = (db: any, table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);

function flaky(DB: any, matches: (sql: string) => boolean, timesToFail = 1) {
  let left = timesToFail;
  return {
    prepare(sql: string) {
      const real = DB.prepare(sql);
      if (!matches(sql)) return real;
      const api: any = {
        bind(...args: any[]) { real.bind(...args); return api; },
        all: async () => { if (left-- > 0) throw new Error('injected failure'); return real.all(); },
        first: async (column?: string) => { if (left-- > 0) throw new Error('injected failure'); return real.first(column); },
        run: async () => { if (left-- > 0) throw new Error('injected failure'); return real.run(); },
      };
      return api;
    },
    batch: (statements: any[]) => DB.batch(statements),
    exec: (sql: string) => DB.exec(sql),
  };
}

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare('INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(USER, 'founder@example.test', 'Founder', 'founder', 1001);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(PROJECT, 'Harbour', 1001);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}

async function accept(env: any, proposalId: number) {
  const jwt = await new SignJWT({ user_id: USER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono();
  app.onError((error: any, c) => c.json({ detail: String(error?.message) }, (AUTH_ERROR_STATUSES[error?.message] || 500) as any));
  app.route('/api/founder/validate', founderValidate);
  const response = await app.request(`/api/founder/validate/proposals/${proposalId}/accept`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: '{}',
  }, env);
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

function proposal(db: any, kind: string, payload: Record<string, unknown>, targetRef: string, fillClass: string) {
  const citation = fillClass === 'sourced'
    ? JSON.stringify({ kind: 'research', task: 'competitor_scan', query: 'synthetic', source: 'https://example.test', quote: 'Synthetic source.' })
    : null;
  const result = db.prepare(
    `INSERT INTO validate_proposals
       (project_id, kind, payload_json, status, created_by, surface, fill_class, target_ref, citation_json)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  ).run(PROJECT, kind, JSON.stringify(payload), USER, kind === 'competitor' ? 'market/competitors' : 'grow/feedback-themes', fillClass, targetRef, citation);
  return Number(result.lastInsertRowid);
}

test('D5352: competitor retry after its target write reuses one deterministic candidate and records provenance once', async () => {
  const { db, env } = world();
  const analysis = 'analysis-d5352';
  db.prepare('INSERT INTO competitor_analyses (id, user_id, project_id, inputs_json) VALUES (?, ?, ?, ?)')
    .run(analysis, USER, PROJECT, JSON.stringify({ market: 'Operations software' }));
  const id = proposal(db, 'competitor', {
    name: 'Synthetic Rival', category: 'direct', note: 'A documented rival.', analysis_id: analysis,
  }, `competitor_analysis:${analysis}`, 'sourced');

  env.DB = flaky(env.DB, (sql: string) => sql.includes('INSERT INTO activity_logs'), 1);
  const first = await accept(env, id);
  assert.equal(first.status, 500, JSON.stringify(first.body));
  assert.equal(count(db, 'competitor_candidates'), 1, 'the target landed before the injected failure');
  const original = db.prepare('SELECT id, position FROM competitor_candidates').get() as any;
  assert.equal(original.id, `fill-proposal-${id}`);
  assert.equal((db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id) as any).status, 'pending');

  const second = await accept(env, id);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(count(db, 'competitor_candidates'), 1, 'retry must not allocate a second candidate');
  assert.deepEqual({ ...(db.prepare('SELECT id, position FROM competitor_candidates').get() as any) }, { id: original.id, position: original.position });
  assert.equal(count(db, 'fill_provenance'), 1);
  assert.equal((db.prepare('SELECT proposal_id FROM fill_provenance').get() as any).proposal_id, id);
});

test('D5352: feedback-theme retry recognizes the row it already themed and completes one provenance record', async () => {
  const { db, env } = world();
  db.prepare("INSERT INTO product_feedback (uid, project_id, body, source, theme, created_by) VALUES ('theme-seed', ?, 'Seed', 'team', 'Onboarding', ?)")
    .run(PROJECT, USER);
  db.prepare("INSERT INTO product_feedback (uid, project_id, body, source, created_by) VALUES ('feedback-open', ?, 'Setup is slow', 'customer', ?)")
    .run(PROJECT, USER);
  const id = proposal(db, 'feedback_theme', {
    uid: 'feedback-open', theme: 'Onboarding', body: 'Setup is slow', readable: 'Setup is slow → Onboarding',
  }, 'product_feedback:feedback-open', 'restatement');

  env.DB = flaky(env.DB, (sql: string) => sql.includes('INSERT INTO fill_provenance'), 1);
  const first = await accept(env, id);
  assert.equal(first.status, 500, JSON.stringify(first.body));
  const themed = db.prepare("SELECT id, theme, theme_source_proposal_id FROM product_feedback WHERE uid = 'feedback-open'").get() as any;
  assert.deepEqual({ theme: themed.theme, source: themed.theme_source_proposal_id }, { theme: 'Onboarding', source: id });
  assert.equal((db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id) as any).status, 'pending');
  assert.equal(count(db, 'fill_provenance'), 0);

  const second = await accept(env, id);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM product_feedback WHERE uid = 'feedback-open'").get() as any).n, 1);
  assert.equal(count(db, 'fill_provenance'), 1);
  const provenance = db.prepare('SELECT proposal_id, target_row_id, target_column FROM fill_provenance').get() as any;
  assert.deepEqual({ ...provenance }, { proposal_id: id, target_row_id: themed.id, target_column: 'theme' });
});
