/**
 * D1146 (#3032) — GET /api/cycles/raise/pmf/model: the model RD4 draws, read
 * from `scoring_model_versions` on node:sqlite with migration 598.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/pmf_model_d1146.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { recomputePmf } from '../src/services/scoring/pmfStore.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { GRADES, PMF_MODEL_V1 } from '../src/services/scoring/pmf.ts';

const TODAY = '2026-10-25', SECRET = 'synthetic-pmf-model-test-secret-0123456789';
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'data_room_files', 'raise_prospects', 'spinout_deck_overrides', 'discovery_interviews', 'interview_pain_severities', 'pain_groups', 'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets', 'validation_decisions', 'roadmap_okrs', 'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(baseline, t));
  for (const f of ['311_revenue_entries.sql', '440_validate_cycle_stores.sql', '464_verdict_decisions.sql', '460_validate_record_stores.sql', '438_interview_sessions.sql', '499_github_roadmap.sql', '442_raise_cycle_stores.sql', '536_readiness_stated_evidence.sql', '558_readiness_scores_nullable_score.sql', '598_venture_scorecards.sql']) db.exec(read('../sql/migrations/' + f));
  db.exec("INSERT INTO users(id,email,name,role,is_active,founder_id) VALUES (1,'owner@example.test','Synthetic founder','founder',1,101),(2,'other@example.test','Other founder','founder',1,102),(3,'admin@example.test','Synthetic admin','admin',1,NULL),(4,'partner@example.test','Synthetic partner','partner',1,NULL),(5,'investor@example.test','Synthetic investor','investor',1,NULL)");
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',101),(2,'Other venture',102)");
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
async function get(env: any, id: number | null, path: string) {
  const headers: any = {};
  if (id !== null) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request('/api/cycles/raise' + path, { headers }, env);
  return { status: res.status, body: await res.json() as any };
}

test('before any score the read says the model is not stored yet and answers the definition the first score publishes', async () => {
  const { db, env } = fixture();
  try {
    const r = await get(env, 1, '/pmf/model?project=1');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.version, r.body.stored, r.body.scored_with, r.body.published_at], ['1.0', false, false, null]);
    assert.deepEqual(r.body.model.inputs.map((i: any) => [i.key, i.weight]), PMF_MODEL_V1.inputs.map((i) => [i.key, i.weight]));
    assert.deepEqual(r.body.grades, GRADES);
  } finally { db.close(); }
});

test('after a score the read answers the stored model row the point was scored with, not the code', async () => {
  // Mutation checked: reading PMF_MODEL_V1 in place of model_json → the edited weight is not seen.
  const { db, env } = fixture();
  try {
    await recomputePmf(env, 1, 1, 'module_read', TODAY);
    // The stored row is the source of truth: change it under the code, as a later publication would.
    const stored = JSON.parse((db.prepare("SELECT model_json FROM scoring_model_versions WHERE scope = 'pmf'").get() as any).model_json);
    stored.inputs[0].weight = 12; stored.inputs[0].label = 'Interviews held (stored)';
    db.prepare("UPDATE scoring_model_versions SET model_json = ?, published_at = '2026-10-24' WHERE scope = 'pmf'").run(JSON.stringify(stored));
    const r = await get(env, 1, '/pmf/model?project=1');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.version, r.body.stored, r.body.scored_with, r.body.published_at], ['1.0', true, true, '2026-10-24']);
    assert.deepEqual([r.body.model.inputs[0].label, r.body.model.inputs[0].weight], ['Interviews held (stored)', 12]);
    assert.equal(r.body.model.inputs.length, 10);
  } finally { db.close(); }
});

test('the model is the latest point\'s version; a missing or undrawable row is unreadable, never the code\'s copy', async () => {
  // Mutation checked: falling back to PMF_MODEL_V1 when the point's row is missing → 200.
  const { db, env } = fixture();
  try {
    await recomputePmf(env, 1, 1, 'module_read', TODAY);
    db.exec("INSERT INTO scoring_model_versions(scope,version,model_json,published_at) VALUES ('pmf','1.1','{\"version\":\"1.1\"}','2026-10-26')");
    db.exec("UPDATE venture_scorecards SET model_version = '1.1'");
    const bad = await get(env, 1, '/pmf/model?project=1');
    assert.equal(bad.status, 503, 'a row RD4 cannot draw');
    assert.equal(bad.body.detail, 'How Product-market fit is scored could not be read');
    db.exec("UPDATE venture_scorecards SET model_version = '9.9'");
    assert.equal((await get(env, 1, '/pmf/model?project=1')).status, 503, 'the point\'s model row is missing');
    db.exec('DROP TABLE scoring_model_versions');
    assert.equal((await get(env, 1, '/pmf/model?project=1')).status, 503);
  } finally { db.close(); }
});

test('the read keeps Raise\'s venture gate: the founder and an admin, never another founder, a partner or an investor', async () => {
  const { db, env } = fixture();
  try {
    for (const id of [null, 2, 4, 5]) assert.ok([401, 403].includes((await get(env, id, '/pmf/model?project=1')).status), `user ${id}`);
    assert.equal((await get(env, 3, '/pmf/model?project=1')).status, 200);
    assert.equal((await get(env, 2, '/pmf/model?project=2')).status, 200);
  } finally { db.close(); }
});
