/**
 * D1064 (#2934, part 1 of #2426) — the Worker half of Validate → Build's fixes:
 *
 *   - a trashed venture takes no decision: Validate's and Verdict's project
 *     lookups skip a row with `deleted_at`, as Build's do;
 *   - Build's three creates answer with the row they wrote, even when another
 *     write (a GitHub sync) commits between the batch and the answer;
 *   - a must-have's activity line is Prototype / MVP's.
 *
 * node:sqlite over every migration, the way build_writes_d690 runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import build from '../src/routes/cycle_build.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import cycleVerdict from '../src/routes/cycle_verdict.ts';
import { createdId, featureCreateStatements, mustHaveCreateStatements, roadmapCreateStatements } from '../src/services/buildCreates.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const FOUNDER = 10, ADMIN = 13;
const P = 1, P_TRASHED = 3;

function freshBuild(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return db;
}
const BUILT_DDL = (freshBuild().prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);

function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES
    (${FOUNDER}, 'founder', 'Founder', 'f@example.test', 1, 1001, 'studio'), (${ADMIN}, 'admin', 'Admin', 'a@example.test', 1, NULL, 'free')`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id, deleted_at) VALUES
    (${P}, 'Kestrel Works', 1001, 5, NULL), (${P_TRASHED}, 'Old Venture', 1001, 6, '2026-10-01 00:00:00')`);
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', ${FOUNDER}, 5), ('l2', ${FOUNDER}, 6)`);
  db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status) VALUES (6, ${P}, 'Ship reconciliation', 'now')`);
  db.exec(`INSERT INTO product_feedback (uid, project_id, theme, status, body, source) VALUES ('fb1', ${P}, 'exports', 'open', 'Need CSV', 'customer')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/validate/decisions', cycleVerdict);
app.route('/api/cycles/validate', cycleValidate);
app.route('/api/cycles/build', build);
app.onError((e, c) => c.json({ error: e.message }, 500));

/**
 * A D1 whose batch is followed, before the route can read anything else, by
 * another writer's commit: a GitHub sync adding a feature and a roadmap item
 * to the same venture. The old readback (`SELECT MAX(id)` after the batch)
 * answered with the sync's row.
 */
function racedDb(db: DatabaseSync) {
  const d1 = d1Over(db) as any;
  return new Proxy(d1, {
    get(target, key) {
      if (key !== 'batch') return target[key];
      return async (stmts: unknown[]) => {
        const out = await target.batch(stmts);
        db.exec(`INSERT INTO mvp_features (project_id, title, is_must_have) VALUES (${P}, 'From GitHub', 0)`);
        db.exec(`INSERT INTO roadmap_okrs (project_id, objective, kanban_status) VALUES (${P}, 'From GitHub', 'later')`);
        return out;
      };
    },
  });
}

async function call(db: DatabaseSync, method: string, path: string, body: unknown, opts: { project?: number; raced?: boolean; userId?: number } = {}) {
  const userId = opts.userId ?? FOUNDER;
  const token = await new SignJWT({ user_id: userId, role: userId === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const env = { DB: opts.raced ? racedDb(db) : d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  const r = await withThrownResponses(() => app.request(`/api/cycles${path}${path.includes('?') ? '&' : '?'}project=${opts.project ?? P}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env));
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);

test('item 2: a trashed venture takes no decision and no Validate write; a live one still does', async () => {
  const db = seeded();
  for (const userId of [FOUNDER, ADMIN]) {
    const verdict = await call(db, 'POST', '/validate/decisions', { decision: 'proceed', for: 'venture', reasoning: 'Enough signal' }, { project: P_TRASHED, userId });
    assert.equal(verdict.status, 404, JSON.stringify(verdict.body));
    assert.equal(verdict.body.detail, 'Project not found');
    const segment = await call(db, 'POST', '/validate/segments', { name: 'Controllers' }, { project: P_TRASHED, userId });
    assert.equal(segment.status, 404, JSON.stringify(segment.body));
    assert.equal(segment.body.detail, 'Project not found');
  }
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM validation_decisions WHERE project_id = ${P_TRASHED}`), 0);
  const live = await call(db, 'POST', '/validate/decisions', { decision: 'proceed', for: 'venture', reasoning: 'Enough signal' });
  assert.equal(live.status, 201, JSON.stringify(live.body));
  db.close();
});

test('item 3: each create answers with its own row when a sync commits right after the batch', async () => {
  const db = seeded();
  const feature = await call(db, 'POST', '/build/features', { title: 'CSV export', impact: 'High' }, { raced: true });
  assert.equal(feature.status, 201, JSON.stringify(feature.body));
  assert.equal((db.prepare('SELECT title FROM mvp_features WHERE id = ?').get(feature.body.id) as any).title, 'CSV export');

  const must = await call(db, 'POST', '/build/must-haves', { title: 'Bank sync', links: ['https://github.com/kestrel/app/issues/42'] }, { raced: true });
  assert.equal(must.status, 201, JSON.stringify(must.body));
  assert.equal((db.prepare('SELECT title FROM mvp_features WHERE id = ?').get(must.body.id) as any).title, 'Bank sync');
  assert.equal((db.prepare('SELECT feature_id FROM mvp_feature_links').get() as any).feature_id, must.body.id, 'the link is the must-have\'s');

  const item = await call(db, 'POST', '/build/roadmap', { title: 'Exports', column: 'now', waits_on_id: 6, feedback_theme: 'exports' }, { raced: true });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  assert.equal((db.prepare('SELECT objective FROM roadmap_okrs WHERE id = ?').get(item.body.id) as any).objective, 'Exports');
  assert.equal((db.prepare('SELECT blocks_okr_id FROM okr_dependencies WHERE okr_id = 6').get() as any).blocks_okr_id, item.body.id, 'Waits on names the new item');
  assert.equal((db.prepare(`SELECT roadmap_item_ref FROM product_feedback WHERE theme = 'exports'`).get() as any).roadmap_item_ref, String(item.body.id));

  // The activity lines name the founder's rows, never the sync's.
  const logged = (db.prepare(`SELECT action, entity_id FROM activity_logs ORDER BY id`).all() as any[]).map((x) => [x.action, x.entity_id]);
  assert.deepEqual(logged, [
    ['build_feature_created', String(feature.body.id)],
    ['build_must_have_created', String(must.body.id)],
    ['build_roadmap_item_created', String(item.body.id)],
  ]);
  db.close();
});

test('item 4: a must-have is logged under Prototype / MVP, a feature under Solution design', async () => {
  const db = seeded();
  await call(db, 'POST', '/build/features', { title: 'CSV export' });
  await call(db, 'POST', '/build/must-haves', { title: 'Bank sync' });
  const rows = (db.prepare('SELECT action, entity_type FROM activity_logs ORDER BY id').all() as any[]).map((x) => [x.action, x.entity_type]);
  assert.deepEqual(rows, [['build_feature_created', 'build.solution-design'], ['build_must_have_created', 'build.prototype-mvp']]);
  db.close();
});

test('the statement builders batch inside another batch, and createdId reads the first statement', async () => {
  const db = seeded();
  const env = { DB: d1Over(db) } as any;
  const feature = featureCreateStatements(env, { projectId: P, userId: FOUNDER, title: 'Accepted from GitHub', description: null, impact: 'Medium', effort: 'M', scope: null, painId: null, hypothesisId: null });
  const results = await env.DB.batch(feature);
  const id = createdId(results);
  assert.equal((db.prepare('SELECT title FROM mvp_features WHERE id = ?').get(id) as any).title, 'Accepted from GitHub');
  const must = mustHaveCreateStatements(env, { projectId: P, userId: FOUNDER, title: 'M', hypothesisId: null, status: 'Backlog', owner: null, due: null, links: [] });
  const item = roadmapCreateStatements(env, { projectId: P, userId: FOUNDER, title: 'R', column: 'next', sortOrder: 0, owner: null, due: null, kpi: null, theme: null, featureId: null, waitsOn: null });
  assert.equal(must.length, 2);
  assert.equal(item.length, 2);
  assert.throws(() => createdId([{ results: [] }]), /returned no id/);
  db.close();
});
