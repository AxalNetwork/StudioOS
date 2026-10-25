import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import progress from '../src/routes/progress.ts';
import founderValidate from '../src/routes/founder_validate.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { hashEmail } from '../src/util/hashEmail.ts';
import { activityFor, COMPETITOR_ADDED, CREATE_ACTIONS, logCycleWrite, logCycleWriteStatement } from '../src/services/cycleActivity.ts';
import { fillKind } from '../src/services/fills/registry.ts';
import {
  addMarketSource, removeMarketSource, setInterviewsTarget, setMarketMark, setWaitlistTarget,
  writeCompetitorMention, writeDemandSignal, writeSegment,
} from '../src/services/validateWriters.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

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
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  db.exec(migration('447_assistant_interviews.sql'));
  db.exec(migration('453_interview_processing.sql'));
  db.exec(migration('459_cycle_activity_convention.sql'));
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (10, 'founder', 'Fixture Founder', 'founder@example.test', 10)");
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Fixture Venture', 10), (2, 'Other Venture', 10)");
  return { db, env: { DB: d1Over(db) } as any };
}

test('D690 migration 459 adds only creator columns and a scoped activity index', () => {
  const { db } = fixture();
  const migrations = resolve('cloudflare-worker/sql/migrations');
  // Every other file, later numbers included: 463 and up already ran before 459
  // on every existing database, so a duplicate column there aborts the deploy.
  const others = readdirSync(migrations).filter((name) => name.endsWith('.sql') && name !== '459_cycle_activity_convention.sql');
  assert.ok(others.some((name) => Number(name.split('_')[0]) > 459), 'the grep must reach files above 459');
  for (const table of ['pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs']) {
    assert.equal((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).filter((r) => r.name === 'created_by').length, 1);
    assert.doesNotMatch(tableFromBaseline(BASE, table), /created_by/);
    for (const name of others) {
      const sql = migration(name).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const alter = new RegExp(`\\bALTER\\s+TABLE\\s+${table}\\s+ADD\\s+(?:COLUMN\\s+)?created_by\\b`, 'i');
      const create = new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\([^;]*\\bcreated_by\\b`, 'i');
      assert.doesNotMatch(sql, alter, `${name} adds ${table}.created_by outside 459`);
      assert.doesNotMatch(sql, create, `${name} creates ${table}.created_by outside 459`);
    }
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
  // A decision's row (D-f) carries the hypothesis id under `validate.verdict`;
  // the hypothesis's own history never returns it.
  db.exec("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (11, 1, 'H1', 'Fixture claim')");
  db.exec("INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details) VALUES (1, 10, 'validate.verdict', '11', 'decision_recorded', 'Proceed')");
  await logCycleWrite(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'experiments', entityId: 11,
    action: 'hypothesis_updated', summary: 'H1 updated' });
  const claim = await activityFor(env, { projectId: 1, entityType: 'validate.experiments', entityId: '11', store: 'hypotheses' });
  assert.deepEqual(claim.items.map((r) => r.action).sort(), ['created', 'hypothesis_updated']);
  assert.equal(claim.total, 2);
  assert.equal(JSON.stringify(claim.items).includes('Proceed'), false);
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
  const key = ['fixture', 'key', 'for', 'd690', 'tests'].join('-');
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
  assert.deepEqual(logs.map((r) => r.details), [
    `Interview ${interviewId} created`, `Interview ${interviewId} updated`, `Interview ${interviewId} deleted`,
    'Manual work created', 'Ship a prototype created', 'Prototype created',
  ]);
  assert.equal(JSON.stringify(logs).includes('Fixture Interviewee'), false);
  assert.equal((db.prepare('SELECT created_by FROM pain_groups WHERE project_id = 1').get() as any).created_by, 10);
  assert.equal((db.prepare('SELECT created_by FROM roadmap_okrs WHERE project_id = 1').get() as any).created_by, 10);
  assert.equal((db.prepare('SELECT created_by FROM mvp_features WHERE project_id = 1').get() as any).created_by, 10);
});

test('D690 founder writes attribute a claim and both sides of its pain link', async () => {
  const { db, env } = fixture();
  const key = ['fixture', 'key', 'for', 'd690', 'tests'].join('-');
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
  // The same link again writes no row, so it logs none.
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
  // Each side names the other by code or title (decision 5): the theme reads
  // "Linked to H1", the claim "Linked to <theme>". An interview keeps its id.
  assert.deepEqual(logs.map((r) => r.details), [
    'Hypothesis H1 created', 'H1 updated', 'Linked to Manual work', 'Linked to H1',
    'Unlinked from Manual work', 'Unlinked from H1', 'Interview 5 evidence updated',
    'Interview 5 pain severity set', 'Interview 5 pain severity cleared',
  ]);
  assert.equal(JSON.stringify(logs).includes('Fixture Interviewee'), false);
});

// ---------------------------------------------------------------------------
// S1's review of #1736: module-level writes, segment creates, the create set,
// the full Build step 6 list, and logging that never fails a landed write.
// ---------------------------------------------------------------------------

/** Every store Build step 6's writes touch, with 440 and 459 over the baseline. */
function wideFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'pain_groups', 'pain_group_aliases', 'hypotheses', 'mvp_features',
    'roadmap_okrs', 'discovery_interviews', 'interview_pain_severities', 'hypothesis_pain_links', 'validate_proposals',
    'metric_targets', 'waitlist_signups', 'competitor_analyses', 'competitor_candidates', 'competitor_sources',
    'competitor_signals']) {
    db.exec(tableFromBaseline(BASE, t));
  }
  db.exec('CREATE UNIQUE INDEX idx_hypothesis_pain_links_unique ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction)');
  db.exec('CREATE UNIQUE INDEX idx_interview_pain_sev_unique ON interview_pain_severities (interview_id, phrase_norm)');
  db.exec('CREATE UNIQUE INDEX idx_pain_group_aliases_project_phrase ON pain_group_aliases (project_id, phrase_norm)');
  db.exec(migration('438_interview_sessions.sql'));
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  db.exec(migration('440_validate_cycle_stores.sql'));
  db.exec(migration('447_assistant_interviews.sql'));
  db.exec(migration('453_interview_processing.sql'));
  db.exec(migration('459_cycle_activity_convention.sql'));
  db.exec("INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (10, 'founder', 'Fixture Founder', 'founder@example.test', 10, 1)");
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Fixture Venture', 10), (2, 'Other Venture', 10)");
  const key = ['fixture', 'key', 'for', 'd690', 'tests'].join('-');
  const env = { DB: d1Over(db), JWT_SECRET: key, ENVIRONMENT: 'development' } as any;
  let token = '';
  const call = async (app: any, method: string, path: string, body?: unknown) => {
    token ||= await new SignJWT({ user_id: 10, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(key));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) }, env);
      return { status: res.status as number, body: await res.json().catch(() => null) as any };
    } finally { [console.warn, console.error] = saved; }
  };
  const lastLog = () => Number((db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM activity_logs').get() as any).n);
  const logsAfter = (id: number) => (db.prepare('SELECT project_id, entity_type, entity_id FROM activity_logs WHERE id > ? ORDER BY id')
    .all(id) as any[]).map((r) => [r.project_id, r.entity_type, r.entity_id]);
  return { db, env, call, lastLog, logsAfter };
}

test('D690 a module-level write logs entity_id NULL, so no record whose id is the project id inherits it', async () => {
  const { db, env } = wideFixture();
  // Interview 1 in project 1: before the ruling, the target rows landed in its history.
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (1, 1, 'Fixture Person')");
  db.exec("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('analysis1', 10, 1)");
  db.exec("INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('1', 'analysis1', 'Rival One'), ('Acme Corp', 'analysis1', 'Rival Two')");
  await setInterviewsTarget(env, { projectId: 1, userId: 10, value: 12 });
  await setInterviewsTarget(env, { projectId: 1, userId: 10, value: null });
  await setWaitlistTarget(env, { projectId: 1, userId: 10, value: 40 });
  await setWaitlistTarget(env, { projectId: 1, userId: 10, value: null });
  await setMarketMark(env, { projectId: 1, userId: 10, item: 'positioning_map', done: true });
  const source = await addMarketSource(env, { projectId: 1, userId: 10, title: 'Fixture report' });
  await removeMarketSource(env, { projectId: 1, userId: 10, sourceId: source.id });
  // A candidate whose id fails the pattern has no record address either.
  await writeCompetitorMention(env, { projectId: 1, userId: 10, name: 'Rival Two' });
  const history = await activityFor(env, { projectId: 1, entityType: 'validate.customer-research', entityId: '1', store: 'discovery_interviews' });
  assert.deepEqual(history.items.filter((r) => r.action.startsWith('interviews_target_')), []);
  const market = await activityFor(env, { projectId: 1, entityType: 'validate.market-intelligence', entityId: '1', store: 'competitor_candidates' });
  assert.deepEqual(market.items.filter((r) => r.action.startsWith('market_') || r.action.startsWith('competitor_')), []);
  const rows = db.prepare('SELECT entity_type, entity_id, action FROM activity_logs ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => [r.entity_type, r.entity_id, r.action]), [
    ['validate.customer-research', null, 'interviews_target_set'],
    ['validate.customer-research', null, 'interviews_target_cleared'],
    ['validate.demand-signals', null, 'waitlist_target_set'],
    ['validate.demand-signals', null, 'waitlist_target_cleared'],
    ['validate.market-intelligence', null, 'market_mark_set'],
    ['validate.market-intelligence', null, 'market_source_added'],
    ['validate.market-intelligence', null, 'market_source_removed'],
    ['validate.market-intelligence', null, 'competitor_mention_written'],
  ]);
  // The explicit module-level form is `null`; a malformed record id still refuses.
  assert.throws(() => logCycleWriteStatement(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'experiments',
    entityId: 'Acme Corp', action: 'x_set', summary: 'x' }), /record id/);
});

test('D690 a segment create logs under Ideal customer profile, where the segment\'s record and links are', async () => {
  const { db, env } = wideFixture();
  const seg = await writeSegment(env, { projectId: 1, userId: 10, name: 'Fleet operators' });
  const row = db.prepare("SELECT entity_type, entity_id, details FROM activity_logs WHERE action = 'segment_written'").get() as any;
  assert.deepEqual({ ...row }, { entity_type: 'validate.ideal-customer-profile', entity_id: String(seg.id), details: 'Fleet operators created' });
  const history = await activityFor(env, { projectId: 1, entityType: 'validate.ideal-customer-profile', entityId: String(seg.id), store: 'customer_segments' });
  assert.deepEqual(history.items.map((r) => [r.a, r.action]), [['Created by Fixture Founder', 'segment_written']]);
  assert.equal(history.total, 1);
});

test('D690 a create logged under a kept action name reads as one "Created by" line and counts once', async () => {
  const { db, env } = wideFixture();
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (7, 1, 'Fixture Person')");
  db.exec("INSERT INTO waitlist_signups (id, project_id, audience, email) VALUES (8, 1, 'customer', 'signup@example.test')");
  db.exec("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('analysis1', 10, 1)");
  db.exec("INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('rival-1', 'analysis1', 'Rival One')");
  db.exec("INSERT INTO hypotheses (id, project_id, code, claim, created_by) VALUES (9, 1, 'H1', 'Fleets pay', 10)");
  const signal = await writeDemandSignal(env, { projectId: 1, userId: 10, kind: 'loi' });
  const seg = await writeSegment(env, { projectId: 1, userId: 10, name: 'Fleet operators' });
  await logCycleWrite(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'experiments', entityId: 9,
    action: 'hypothesis_created', summary: 'Hypothesis H1 created' });
  await logCycleWrite(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'customer-research', entityId: '7',
    action: 'interview_logged', summary: 'Interview 7 created' });
  await logCycleWrite(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'demand-signals', entityId: 'waitlist-8',
    action: 'waitlist_promoted', summary: 'Waitlist entry promoted to interview 7' });
  await logCycleWrite(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'market-intelligence', entityId: 'rival-1',
    action: COMPETITOR_ADDED.action, summary: COMPETITOR_ADDED.summary });
  const read = (entityType: string, entityId: string, store: any) => activityFor(env, { projectId: 1, entityType, entityId, store });
  for (const [entityType, entityId, store, action] of [
    ['validate.experiments', '9', 'hypotheses', 'hypothesis_created'],
    ['validate.demand-signals', `signal-${signal.id}`, 'demand_signals', 'demand_signal_written'],
    ['validate.ideal-customer-profile', String(seg.id), 'customer_segments', 'segment_written'],
    ['validate.customer-research', '7', 'discovery_interviews', 'interview_logged'],
    ['validate.demand-signals', 'waitlist-8', 'waitlist_signups', 'waitlist_promoted'],
    ['validate.market-intelligence', 'rival-1', 'competitor_candidates', 'competitor_mention_written'],
  ] as const) {
    const page = await read(entityType, entityId, store);
    assert.deepEqual(page.items.map((r) => [r.a, r.action]), [['Created by Fixture Founder', action]], `${action} on ${entityId}`);
    assert.equal(page.total, 1, `${action} is counted once`);
  }
  // A signal on a candidate already listed is not its create.
  await logCycleWrite(env, { projectId: 1, userId: 10, cycle: 'validate', module: 'market-intelligence', entityId: 'rival-1',
    action: COMPETITOR_ADDED.action, summary: 'Competitor signal added' });
  const rival = await read('validate.market-intelligence', 'rival-1', 'competitor_candidates');
  assert.deepEqual(rival.items.map((r) => r.a), ['Competitor signal added by Fixture Founder', 'Created by Fixture Founder']);
  assert.equal(rival.total, 2);
  assert.deepEqual([...CREATE_ACTIONS].sort(), ['demand_signal_written', 'interview_logged', 'segment_written', 'waitlist_promoted']);
});

test('D690 every write Build step 6 lists logs exactly its rows, with project, entity type and entity id', async () => {
  const { db, env, call, lastLog, logsAfter } = wideFixture();
  db.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (41, 1, 'Manual work'), (42, 1, 'Slow quotes'), (43, 1, 'Theme to delete')");
  db.exec("INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (1, 41, 'manual step', 'Manual step')");
  db.exec("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (51, 1, 'H1', 'Fleets pay')");
  db.exec("INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction) VALUES (61, 51, 41, 'supports')");
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json) VALUES (71, 1, 'Fixture Interviewee', '[\"Manual step\",\"Slow quote\"]')");
  db.exec("INSERT INTO roadmap_okrs (id, project_id, objective, key_results_json, kanban_status) VALUES (81, 1, 'Ship a prototype', '[]', 'now')");
  db.exec("INSERT INTO mvp_features (id, project_id, title) VALUES (91, 1, 'Quote builder')");
  db.exec("INSERT INTO waitlist_signups (id, project_id, audience, email, name) VALUES (101, 1, 'customer', 'signup@example.test', 'Fixture Signup'), (102, 1, 'customer', 'other@example.test', NULL)");
  db.exec("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('analysis1', 10, 1)");
  db.exec("INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('Acme Corp', 'analysis1', 'Rival Two')");
  const fill = (kind: string, payload: Record<string, unknown>, ref = '') =>
    fillKind(kind)!.apply({ env, user: { id: 10, role: 'founder' } as any, projectId: 1 } as any, payload, ref);
  const ids: Record<string, string> = {};
  const P = 1;
  type Row = [number, string | null, string | null];
  const cases: Array<[string, () => Promise<unknown>, () => Row[]]> = [
    ['segment create', async () => { const r = await call(cycleValidate, 'POST', '/segments?project=1', { name: 'Fleet operators' }); ids.seg = String(r.body?.id); return r; },
      () => [[P, 'validate.ideal-customer-profile', ids.seg]]],
    ['interview segment (a link: one row on each side)', () => call(cycleValidate, 'PUT', '/interviews/71/segment?project=1', { segment_id: Number(ids.seg) }),
      () => [[P, 'validate.customer-research', '71'], [P, 'validate.ideal-customer-profile', ids.seg]]],
    ['interview stage', () => call(cycleValidate, 'PUT', '/interviews/71/stage?project=1', { stage: 'booked' }),
      () => [[P, 'validate.customer-research', '71']]],
    ['demand signal create', async () => { const r = await call(cycleValidate, 'POST', '/demand-signals?project=1', { kind: 'loi' }); ids.signal = String(r.body?.id); return r; },
      () => [[P, 'validate.demand-signals', `signal-${ids.signal}`]]],
    ['demand signal status', () => call(cycleValidate, 'PUT', `/demand-signals/${ids.signal}/status?project=1`, { status: 'counted' }),
      () => [[P, 'validate.demand-signals', `signal-${ids.signal}`]]],
    ['waitlist target set', () => call(cycleValidate, 'PUT', '/waitlist-target?project=1', { value: 40 }), () => [[P, 'validate.demand-signals', null]]],
    ['waitlist target cleared', () => call(cycleValidate, 'PUT', '/waitlist-target?project=1', { value: null }), () => [[P, 'validate.demand-signals', null]]],
    ['interviews target set', () => call(cycleValidate, 'PUT', '/interviews-target?project=1', { value: 8 }), () => [[P, 'validate.customer-research', null]]],
    ['interviews target cleared', () => call(cycleValidate, 'PUT', '/interviews-target?project=1', { value: null }), () => [[P, 'validate.customer-research', null]]],
    ['competitor mention, new candidate', async () => { const r = await call(cycleValidate, 'POST', '/competitor-mentions?project=1', { name: 'Haulr' }); ids.rival = String(r.body?.candidate_id); return r; },
      () => [[P, 'validate.market-intelligence', ids.rival]]],
    ['competitor mention, unaddressable candidate', () => call(cycleValidate, 'POST', '/competitor-mentions?project=1', { name: 'Rival Two' }),
      () => [[P, 'validate.market-intelligence', null]]],
    ['market mark', () => call(cycleValidate, 'PUT', '/market-marks/positioning_map?project=1', { done: true }), () => [[P, 'validate.market-intelligence', null]]],
    ['market source added', async () => { const r = await call(cycleValidate, 'POST', '/market-sources?project=1', { title: 'Fixture report' }); ids.source = String(r.body?.id); return r; },
      () => [[P, 'validate.market-intelligence', null]]],
    ['market source removed', () => call(cycleValidate, 'DELETE', `/market-sources/${ids.source}?project=1`), () => [[P, 'validate.market-intelligence', null]]],
    ['hypothesis plan', () => call(cycleValidate, 'PUT', '/hypotheses/51/plan?project=1', { sprint: 'Sprint 2' }), () => [[P, 'validate.experiments', '51']]],
    ['evidence strength (both sides)', () => call(cycleValidate, 'PUT', '/evidence-links/61/strength?project=1', { strength: 'pattern' }),
      () => [[P, 'validate.experiments', '51'], [P, 'validate.problem-discovery', '41']]],
    ['pain_tag fill', () => fill('pain_tag', { pain_group_id: 42, phrase: 'Slow quote' }), () => [[P, 'validate.problem-discovery', '42']]],
    ['hypothesis fill', async () => { await fill('hypothesis', { claim: 'Dispatchers will switch tools' }, 'hypotheses');
      ids.h = String((db.prepare("SELECT id FROM hypotheses WHERE claim = 'Dispatchers will switch tools'").get() as any).id); },
    () => [[P, 'validate.experiments', ids.h]]],
    ['competitor fill', async () => { await fill('competitor', { name: 'Routely', analysis_id: 'analysis1' }, 'competitor_analysis:analysis1');
      ids.fillRival = String((db.prepare("SELECT id FROM competitor_candidates WHERE name = 'Routely'").get() as any).id); },
    () => [[P, 'validate.market-intelligence', ids.fillRival]]],
    ['pain group assign', () => call(progress, 'POST', '/pain-groups/1/assign', { phrase: 'Slow quote', group_id: 41 }), () => [[P, 'validate.problem-discovery', '41']]],
    ['pain group unassign', () => call(progress, 'POST', '/pain-groups/1/assign', { phrase: 'Slow quote' }), () => [[P, 'validate.problem-discovery', '41']]],
    ['pain group rename', () => call(progress, 'PATCH', '/pain-groups/42', { title: 'Slow quoting' }), () => [[P, 'validate.problem-discovery', '42']]],
    ['pain group delete', () => call(progress, 'DELETE', '/pain-groups/43'), () => [[P, 'validate.problem-discovery', '43']]],
    ['roadmap update', () => call(progress, 'PUT', '/roadmap/okr/81', { objective: 'Ship the prototype', key_results: [] }), () => [[P, 'build.product-roadmap', '81']]],
    ['roadmap move', () => call(progress, 'POST', '/roadmap/okr/81/move', { kanban_status: 'next' }), () => [[P, 'build.product-roadmap', '81']]],
    ['MVP update', () => call(progress, 'PUT', '/mvp-scope/feature/91', { title: 'Quote builder v2', added_value: 'High', effort: 'M' }), () => [[P, 'build.solution-design', '91']]],
    ['MVP delete', () => call(progress, 'DELETE', '/mvp-scope/feature/91'), () => [[P, 'build.solution-design', '91']]],
    ['roadmap delete', () => call(progress, 'DELETE', '/roadmap/okr/81'), () => [[P, 'build.product-roadmap', '81']]],
    ['waitlist promote (the interview it creates and the sign-up)', async () => {
      const r = await call(progress, 'POST', '/discovery/1/waitlist/101/promote'); ids.promoted = String(r.body?.interview?.id); return r; },
    () => [[P, 'validate.customer-research', ids.promoted], [P, 'validate.demand-signals', 'waitlist-101']]],
    // S1's scope ruling: outreach keeps the row it wrote before D690, with no record address.
    ['waitlist outreach', () => call(progress, 'POST', '/discovery/1/waitlist/102/invite'), () => [[P, null, null]]],
  ];
  for (const [label, run, expected] of cases) {
    const before = lastLog();
    const result = await run() as any;
    if (result && typeof result.status === 'number') assert.ok(result.status < 300, `${label}: ${result.status} ${JSON.stringify(result.body)}`);
    assert.deepEqual(logsAfter(before), expected(), label);
  }
  // Summaries name records by code or title, and never the interviewee or the sign-up.
  const details = (db.prepare('SELECT details FROM activity_logs WHERE entity_type IS NOT NULL').all() as any[]).map((r) => r.details);
  assert.equal(details.some((d) => /Fixture Interviewee|Fixture Signup/.test(d)), false);
  for (const expected of ['Segment Fleet operators', 'H1 plan updated', 'H1 evidence strength pattern', 'Phrase linked to Slow quotes',
    'Phrase assigned to Manual work', 'Phrase removed from Manual work', 'Renamed to Slow quoting', 'Theme to delete deleted',
    'Ship the prototype updated', 'Ship the prototype moved to next', 'Ship the prototype deleted',
    'Quote builder v2 updated', 'Quote builder v2 deleted']) {
    assert.ok(details.includes(expected), `no summary reads "${expected}": ${JSON.stringify(details)}`);
  }
});

test('D690 a failed activity insert never fails an interview create, a promote or an outreach that already happened', async () => {
  const { db, call } = wideFixture();
  db.exec("INSERT INTO waitlist_signups (id, project_id, audience, email) VALUES (101, 1, 'customer', 'signup@example.test'), (102, 1, 'customer', 'other@example.test')");
  db.exec("CREATE TRIGGER activity_down BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT, 'activity store unavailable'); END");
  const created = await call(progress, 'POST', '/discovery/1', { interviewee_name: 'Fixture Interviewee', pains: [] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const promoted = await call(progress, 'POST', '/discovery/1/waitlist/101/promote');
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  const invited = await call(progress, 'POST', '/discovery/1/waitlist/102/invite');
  assert.equal(invited.status, 200, JSON.stringify(invited.body));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM discovery_interviews').get() as any).n, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n, 0);
});

test('D690 outreach reads as it did before D690: only an unconfigured mailer says "not delivered"', async () => {
  const { db, call } = wideFixture();
  db.exec("INSERT INTO waitlist_signups (id, project_id, audience, email) VALUES (102, 1, 'customer', 'other@example.test')");
  assert.equal((await call(progress, 'POST', '/discovery/1/waitlist/102/invite')).status, 200);
  const row = db.prepare("SELECT action, details, entity_type, entity_id, actor, user_id, project_id FROM activity_logs WHERE action = 'waitlist_invited'").get() as any;
  assert.deepEqual({ ...row }, { action: 'waitlist_invited', entity_type: null, entity_id: null,
    details: 'Project Fixture Venture: sent product invitation to other@example.test (email not delivered: not configured)',
    actor: await hashEmail('founder@example.test'), user_id: 10, project_id: 1 });
});

test('D690 migration 470 re-files only the rows #1736 misfiled after its deploy', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(tableFromBaseline(BASE, 'activity_logs'));
  const row = db.prepare('INSERT INTO activity_logs (id, project_id, entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const AFTER = '2026-10-17 16:51:00', BEFORE = '2026-10-17 15:59:59';
  // Re-filed: module-level actions addressed to their own project's id, after the cutoff.
  row.run(1, 7, 'validate.customer-research', '7', 'interviews_target_set', 'Monthly interviews target 12', AFTER);
  row.run(2, 7, 'validate.customer-research', '7', 'interviews_target_cleared', 'Monthly interviews target cleared', AFTER);
  row.run(3, 7, 'validate.demand-signals', '7', 'waitlist_target_set', 'Waitlist target 40', AFTER);
  row.run(4, 7, 'validate.demand-signals', '7', 'waitlist_target_cleared', 'Waitlist target cleared', AFTER);
  row.run(5, 7, 'validate.market-intelligence', '7', 'market_mark_set', 'positioning_map done', AFTER);
  row.run(6, 7, 'validate.market-intelligence', '7', 'market_source_added', 'Market source 3 added', AFTER);
  row.run(7, 7, 'validate.market-intelligence', '7', 'market_source_removed', 'Market source 3 removed', AFTER);
  row.run(8, 7, 'validate.customer-segments', '4', 'segment_written', 'Segment 4 created', AFTER);
  // Kept: a record's own rows, another project's id, older rows, and rows the ruling did not name.
  row.run(9, 7, 'validate.customer-research', '7', 'interview_stage_set', 'Interview stage booked', AFTER);
  row.run(10, 7, 'validate.customer-research', '8', 'interviews_target_set', 'Monthly interviews target 12', AFTER);
  row.run(11, 7, 'validate.customer-research', '7', 'interviews_target_set', 'Monthly interviews target 12', BEFORE);
  row.run(12, 7, 'validate.customer-segments', '4', 'segment_written', 'Segment 4 created', BEFORE);
  row.run(13, 7, 'validate.market-intelligence', '7', 'competitor_mention_written', 'Competitor added', AFTER);
  row.run(14, 7, null, null, 'interview_logged', 'Older free-text row', AFTER);
  const before = db.prepare('SELECT * FROM activity_logs ORDER BY id').all() as any[];
  db.exec(migration('470_cycle_activity_misfiled_rows.sql'));
  const after = db.prepare('SELECT * FROM activity_logs ORDER BY id').all() as any[];
  assert.deepEqual(after.map((r) => [r.id, r.entity_type, r.entity_id]), [
    [1, 'validate.customer-research', null], [2, 'validate.customer-research', null],
    [3, 'validate.demand-signals', null], [4, 'validate.demand-signals', null],
    [5, 'validate.market-intelligence', null], [6, 'validate.market-intelligence', null], [7, 'validate.market-intelligence', null],
    [8, 'validate.ideal-customer-profile', '4'],
    [9, 'validate.customer-research', '7'], [10, 'validate.customer-research', '8'], [11, 'validate.customer-research', '7'],
    [12, 'validate.customer-segments', '4'], [13, 'validate.market-intelligence', '7'], [14, null, null],
  ]);
  // Nothing else on any row changes: no summary, action, actor or date is rewritten.
  const rest = (rows: any[]) => rows.map(({ entity_type: _t, entity_id: _i, ...r }) => r);
  assert.deepEqual(rest(after), rest(before));
  // A second run changes nothing.
  db.exec(migration('470_cycle_activity_misfiled_rows.sql'));
  assert.deepEqual(db.prepare('SELECT * FROM activity_logs ORDER BY id').all(), after);
});
