import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import progress from '../src/routes/progress.ts';
import founderValidate from '../src/routes/founder_validate.ts';
import { activityFor, logCycleWrite, logCycleWriteStatement } from '../src/services/cycleActivity.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (name: string) => readFileSync(resolve('cloudflare-worker/sql/migrations', name), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'pain_groups', 'pain_group_aliases', 'hypotheses', 'mvp_features',
    'roadmap_okrs', 'discovery_interviews', 'interview_pain_severities', 'hypothesis_pain_links',
    'validate_proposals', 'metric_targets']) {
    db.exec(tableFromBaseline(BASE, t));
  }
  db.exec('CREATE UNIQUE INDEX idx_hypothesis_pain_links_unique ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction)');
  db.exec('CREATE UNIQUE INDEX idx_interview_pain_sev_unique ON interview_pain_severities (interview_id, phrase_norm)');
  db.exec(migration('438_interview_sessions.sql'));
  db.exec(migration('447_assistant_interviews.sql'));
  db.exec(migration('453_interview_processing.sql'));
  db.exec(migration('459_cycle_activity_convention.sql'));
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (10, 'founder', 'Fixture Founder', 'founder@example.test', 10)");
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Fixture Venture', 10), (2, 'Other Venture', 10)");
  return { db, env: { DB: d1Over(db) } as any };
}

test('D690 migration 459 adds only creator columns and a scoped activity index', () => {
  const { db } = fixture();
  for (const table of ['pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs']) {
    assert.equal((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).filter((r) => r.name === 'created_by').length, 1);
    assert.doesNotMatch(tableFromBaseline(BASE, table), /created_by/);
  }
  const index = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_activity_logs_project_entity'").get() as any;
  assert.match(index.sql, /project_id, entity_type, entity_id, created_at DESC/);
});

test('D690 activity is exact, newest-first, paged and never recovers unrelated free-text rows', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO pain_groups (id, project_id, title, created_by) VALUES (11, 1, 'Theme', 10)");
  db.exec("INSERT INTO activity_logs (project_id, user_id, action, details) VALUES (1, 10, 'old_sentence', 'Fixture Person was interviewed')");
  for (let n = 1; n <= 23; n++) await logCycleWrite(env, { projectId: 1, userId: 10, cycle: 'validate',
    module: 'problem-discovery', entityId: 11, action: 'theme_updated', summary: `Theme update ${n}` });
  await logCycleWrite(env, { projectId: 2, userId: 10, cycle: 'validate', module: 'problem-discovery',
    entityId: 11, action: 'theme_updated', summary: 'Other venture' });
  const first = await activityFor(env, { projectId: 1, entityType: 'validate.problem-discovery', entityId: '11', page: 1, store: 'pain_groups' });
  assert.equal(first.total, 24); // 23 writes plus the creator from the stored row.
  assert.equal(first.items.length, 20);
  assert.match(first.items[0].a, /Theme update 23 by Fixture Founder/);
  const second = await activityFor(env, { projectId: 1, entityType: 'validate.problem-discovery', entityId: '11', page: 2, store: 'pain_groups' });
  assert.equal(second.items.length, 4);
  assert.match(second.items[3].a, /Created by Fixture Founder/);
  assert.equal(JSON.stringify([...first.items, ...second.items]).includes('Fixture Person'), false);
  assert.equal(JSON.stringify(first.items).includes('Other venture'), false);
  assert.equal((await activityFor(env, { projectId: 1, entityType: 'validate.verdict', entityId: '11' })).total, 0);
  assert.equal((db.prepare('SELECT actor FROM activity_logs WHERE entity_type = ? LIMIT 1').get('validate.problem-discovery') as any).actor, 'user:10');
});

test('D690 a legacy record with no creator reports its stored date without inventing a name', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO pain_groups (id, project_id, title, created_at) VALUES (12, 1, 'Older theme', '2026-09-01 12:00:00')");
  const out = await activityFor(env, { projectId: 1, entityType: 'validate.problem-discovery', entityId: '12', store: 'pain_groups' });
  assert.equal(out.total, 1);
  assert.equal(out.items[0].a, 'Created 2026-09-01');
});

test('D690 a batched log reads its newly created MAX id or UID with bound values', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (5, 1, 'Fixture Person')");
  await env.DB.batch([
    env.DB.prepare('INSERT INTO pain_groups (project_id, title, created_by) VALUES (?, ?, ?)').bind(1, 'Theme', 10),
    logCycleWriteStatement(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'problem-discovery',
      action: 'theme_created', summary: 'Theme created', readback: { table: 'pain_groups', by: 'max' } }),
  ]);
  const theme = db.prepare("SELECT entity_id FROM activity_logs WHERE action = 'theme_created'").get() as any;
  assert.equal(theme.entity_id, '1');
  assert.equal((await activityFor(env, { projectId: 1, entityType: 'validate.problem-discovery', entityId: '1' })).items[0].a,
    'Created by Fixture Founder');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel) VALUES (?, ?, ?, ?, ?)")
      .bind('fixture-session', 5, 1, 10, 'video'),
    logCycleWriteStatement(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'customer-research',
      action: 'session_created', summary: 'Session created', readback: { table: 'interview_sessions', by: 'uid', uid: 'fixture-session' } }),
  ]);
  const session = db.prepare("SELECT entity_id FROM activity_logs WHERE action = 'session_created'").get() as any;
  assert.equal(session.entity_id, '1');
});

test('D690 oldRows includes only explicitly named older shapes without changing them', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO activity_logs (project_id, action, details, entity_type, entity_id) VALUES (1, 'old', 'Older row', 'old.module', 'h-11')");
  db.exec("INSERT INTO activity_logs (project_id, action, details) VALUES (1, 'old_json', '{\"id\":11}'), (1, 'unrelated', '{\"id\":11}')");
  const out = await activityFor(env, { projectId: 1, entityType: 'validate.experiments', entityId: 'h-11',
    oldRows: { entityTypes: ['old.module'], actions: ['old_json'], idWithoutPrefix: 'h-' } });
  assert.equal(out.total, 2);
  assert.deepEqual(out.items.map((r) => r.action).sort(), ['old', 'old_json']);
  assert.equal((db.prepare("SELECT details FROM activity_logs WHERE action = 'old_json'").get() as any).details, '{"id":11}');
});

test('D690 progress writes attribute interviews, themes, roadmap and MVP rows without a person in summaries', async () => {
  const { db, env } = fixture();
  const key = 'fixture-key-for-d690-tests';
  env.JWT_SECRET = key;
  env.ENVIRONMENT = 'development';
  const token = await new SignJWT({ user_id: 10, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(key));
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await progress.request(path, { method, headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const created = await call('POST', '/discovery/1', { interviewee_name: 'Fixture Interviewee', pains: ['Manual step'] });
  assert.equal(created.status, 200);
  const interviewId = created.body.id;
  assert.equal((await call('PUT', `/discovery/interview/${interviewId}`, { interviewee_name: 'Fixture Interviewee' })).status, 200);
  assert.equal((await call('DELETE', `/discovery/interview/${interviewId}`)).status, 200);
  // A logged phrase is needed to assign it to a new curated theme.
  db.exec("INSERT INTO discovery_interviews (project_id, interviewee_name, pains_json) VALUES (1, 'Another Fixture', '[\"Manual step\"]')");
  const assigned = await call('POST', '/pain-groups/1/assign', { phrase: 'Manual step', new_title: 'Manual work' });
  assert.equal(assigned.status, 200);
  const roadmap = await call('POST', '/roadmap/1', { objective: 'Ship a prototype', key_results: [] });
  assert.equal(roadmap.status, 200);
  const feature = await call('POST', '/mvp-scope/1', { title: 'Prototype', added_value: 'High', effort: 'M' });
  assert.equal(feature.status, 200);
  const logs = db.prepare('SELECT project_id, user_id, entity_type, entity_id, action, details FROM activity_logs WHERE entity_type IS NOT NULL ORDER BY id').all() as any[];
  assert.deepEqual(logs.map((r) => [r.entity_type, r.action]), [
    ['validate.customer-research', 'interview_logged'],
    ['validate.customer-research', 'interview_updated'],
    ['validate.customer-research', 'interview_deleted'],
    ['validate.problem-discovery', 'pain_group_created'],
    ['build.product-roadmap', 'roadmap_created'],
    ['build.solution-design', 'mvp_feature_created'],
  ]);
  assert.ok(logs.every((r) => r.project_id === 1 && r.user_id === 10 && /^\d+$/.test(String(r.entity_id))));
  assert.equal(JSON.stringify(logs).includes('Fixture Interviewee'), false);
  assert.equal((db.prepare('SELECT created_by FROM pain_groups WHERE project_id = 1').get() as any).created_by, 10);
  assert.equal((db.prepare('SELECT created_by FROM roadmap_okrs WHERE project_id = 1').get() as any).created_by, 10);
  assert.equal((db.prepare('SELECT created_by FROM mvp_features WHERE project_id = 1').get() as any).created_by, 10);
});

test('D690 founder writes attribute a claim and both sides of its pain link', async () => {
  const { db, env } = fixture();
  const key = 'fixture-key-for-d690-tests';
  env.JWT_SECRET = key;
  env.ENVIRONMENT = 'development';
  db.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (41, 1, 'Manual work')");
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json) VALUES (5, 1, 'Fixture Interviewee', '[\"Manual step\"]')");
  const token = await new SignJWT({ user_id: 10, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(key));
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await founderValidate.request(path, { method, headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const claim = await call('POST', '/board/1/hypotheses', { claim: 'Fixture hypothesis' });
  assert.equal(claim.status, 201);
  assert.equal((db.prepare('SELECT created_by FROM hypotheses WHERE id = ?').get(claim.body.id) as any).created_by, 10);
  assert.equal((await call('PATCH', `/hypotheses/${claim.body.id}`, { claim: 'Revised hypothesis' })).status, 200);
  assert.equal((await call('POST', `/hypotheses/${claim.body.id}/links`, { pain_group_id: 41, direction: 'supports' })).status, 201);
  const link = db.prepare('SELECT id FROM hypothesis_pain_links').get() as any;
  assert.equal((await call('DELETE', `/links/${link.id}`)).status, 200);
  assert.equal((await call('PATCH', '/interviews/5/evidence', { quote_consent: true })).status, 200);
  assert.equal((await call('PUT', '/interviews/5/pain-severity', { phrase: 'Manual step', severity: 'real' })).status, 200);
  assert.equal((await call('PUT', '/interviews/5/pain-severity', { phrase: 'Manual step', severity: null })).status, 200);
  const logs = db.prepare('SELECT entity_type, entity_id, action, details FROM activity_logs WHERE entity_type IS NOT NULL ORDER BY id').all() as any[];
  assert.deepEqual(logs.map((r) => r.action), [
    'hypothesis_created', 'hypothesis_updated', 'hypothesis_pain_linked', 'hypothesis_pain_linked',
    'hypothesis_pain_unlinked', 'hypothesis_pain_unlinked', 'interview_evidence_updated',
    'pain_severity_set', 'pain_severity_cleared',
  ]);
  assert.deepEqual(logs.filter((r) => r.action === 'hypothesis_pain_linked').map((r) => [r.entity_type, r.entity_id]),
    [['validate.experiments', String(claim.body.id)], ['validate.problem-discovery', '41']]);
  assert.deepEqual(logs.filter((r) => r.action === 'hypothesis_pain_unlinked').map((r) => [r.entity_type, r.entity_id]),
    [['validate.experiments', String(claim.body.id)], ['validate.problem-discovery', '41']]);
  assert.equal(JSON.stringify(logs).includes('Fixture Interviewee'), false);
});
