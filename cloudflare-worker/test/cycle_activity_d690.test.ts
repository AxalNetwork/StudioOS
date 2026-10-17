import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { activityFor, logCycleWrite, logCycleWriteStatement } from '../src/services/cycleActivity.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (name: string) => readFileSync(resolve('cloudflare-worker/sql/migrations', name), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'pain_groups', 'hypotheses', 'mvp_features',
    'roadmap_okrs', 'discovery_interviews', 'validate_proposals']) db.exec(tableFromBaseline(BASE, t));
  db.exec(migration('438_interview_sessions.sql'));
  db.exec(migration('447_assistant_interviews.sql'));
  db.exec(migration('453_interview_processing.sql'));
  db.exec(migration('459_cycle_activity_convention.sql'));
  db.exec("INSERT INTO users (id, role, name, email) VALUES (10, 'founder', 'Fixture Founder', 'founder@example.test')");
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
