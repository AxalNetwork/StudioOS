/**
 * D6020 (#6020): Change strength on a hypothesis record's Evidence rows.
 *
 * Covers each acceptance point: a writer changes a pain link's strength
 * (through `setEvidenceStrength`) and an evidence link's (through the new
 * `setLinkStrength` update), the experiments list's Strength filter follows a
 * pain link's change, the record's activity logs the change, a reader gets no
 * control, and another venture's link or claim is refused with nothing written.
 *
 * Mutation checks (each broke, a test here failed, then restored):
 *   - setLinkStrength: dropping `AND hypothesis_id = ?` from the evidence-link
 *     SELECT (another claim's link on this venture was updated) → "another claim" test.
 *   - setLinkStrength: dropping the pain-link ownership SELECT → "another claim" test.
 *   - setLinkStrength: dropping the logCycleWriteStatement from the batch → activity test.
 *   - setLinkStrength: binding `input.strength` unchecked (no EVIDENCE_STRENGTHS check) → 400 test.
 *   - records/validate.ts: the Evidence row action back to `unlink` → row-action test.
 *   - records/validate.ts: dropping the action's `references` → cross-venture test
 *     still refuses (the writer's own check), so `references` is defence in depth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { RECORD_SPECS } from '../src/services/records/index.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (name: string) => readFileSync(resolve('cloudflare-worker/sql/migrations', name), 'utf8');
const KEY = ['fixture', 'key', 'for', 'd6020', 'tests'].join('-');
const roles: Record<number, string> = { 10: 'founder', 20: 'founder', 40: 'partner' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
    'discovery_interviews', 'hypothesis_pain_links', 'competitor_analyses', 'competitor_candidates', 'competitor_signals',
    'waitlist_signups', 'metric_targets', 'interview_pain_severities', 'pain_group_aliases', 'competitor_sources',
    'validate_proposals']) {
    db.exec(tableFromBaseline(BASE, t));
  }
  for (const m of ['311_revenue_entries.sql', '440_validate_cycle_stores.sql', '438_interview_sessions.sql']) db.exec(migration(m));
  applySessionTranslationColumns(db);
  for (const m of ['447_assistant_interviews.sql', '453_interview_processing.sql', '531_meeting_bots.sql',
    '459_cycle_activity_convention.sql', '460_validate_record_stores.sql', '755_posthog_metrics.sql',
    '439_validate_proposals_structuring.sql', '446_interview_structure_receipts.sql', '246_fills_the_blanks_everywhere.sql',
    '489_interview_findings.sql', '228_research_company_directory.sql', '249_project_metrics.sql']) db.exec(migration(m));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  for (const [id, role, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [40, 'partner', null]] as const) {
    u.run(id, role, `User ${id}`, `user${id}@example.test`, founder);
  }
  db.exec(`
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Project One', 1001), (2, 'Project Two', 1002);
    INSERT INTO pain_groups (id, project_id, title) VALUES (11, 1, 'Theme One'), (22, 2, 'Theme Two');
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json, stage, done_at)
      VALUES (1, 1, 'Fixture Person', '["Theme One"]', 'done', '2026-10-12 10:00:00'),
             (22, 2, 'Other Person', '["Theme Two"]', 'done', '2026-10-09 10:00:00');
    INSERT INTO hypotheses (id, project_id, code, claim, sort_order) VALUES
      (5, 1, 'H1', 'Fixture claim one', 1), (6, 1, 'H2', 'Fixture claim two', 2), (22, 2, 'H1', 'Their claim', 1);
    INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction, strength) VALUES
      (61, 5, 11, 'supports', 'anecdote'), (62, 6, 11, 'supports', 'anecdote'), (63, 22, 22, 'supports', 'anecdote');
    INSERT INTO hypothesis_experiments (id, uid, project_id, hypothesis_id, title, status)
      VALUES (12, 'ex-a', 1, 5, 'Landing page', 'running'), (23, 'ex-b', 2, 22, 'Their test', 'planned');
    INSERT INTO hypothesis_evidence_links (id, uid, project_id, hypothesis_id, kind, ref_id, direction, strength) VALUES
      (71, 'el-a', 1, 5, 'experiment', '12', 'supports', 'anecdote'),
      (72, 'el-b', 1, 6, 'experiment', '12', 'supports', 'anecdote'),
      (73, 'el-c', 2, 22, 'experiment', '23', 'supports', 'anecdote');
  `);
  return db;
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const app = new Hono<any>();
  app.route('/api/cycles', createCycleRecords(RECORD_SPECS));
  app.route('/api/cycles/validate', cycleValidate);
  app.onError((error: Error, c) => c.json({ detail: error.message }, 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const res = await withThrownResponses(() => app.request(`/api/cycles${path}`, { method, headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, body: body === undefined ? undefined : JSON.stringify(body) },
  { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const rec = (id: string, suffix = '') => `/validate/modules/experiments/records/${id}${suffix}?project=1`;
const change = (db: DatabaseSync, link: string, strength: string, who = 10, id = '5') =>
  call(db, who, 'POST', rec(id, '/actions/evidence-strength'), { link, strength });
const strengths = (db: DatabaseSync) => ({
  pain: db.prepare('SELECT id, strength FROM hypothesis_pain_links ORDER BY id').all().map((r: any) => `${r.id}:${r.strength}`),
  evidence: db.prepare('SELECT id, strength FROM hypothesis_evidence_links ORDER BY id').all().map((r: any) => `${r.id}:${r.strength}`),
});
const logs = (db: DatabaseSync) => db.prepare("SELECT entity_type, entity_id, details AS summary FROM activity_logs WHERE action = 'evidence_strength_set' ORDER BY id").all()
  .map((r: any) => [r.entity_type, String(r.entity_id), r.summary]);

test('#6020: each Evidence row carries Change strength for its own link, and the record declares the form', async () => {
  const db = fixture();
  const r = await call(db, 10, 'GET', rec('5'));
  assert.equal(r.status, 200);
  const evidence = r.body.main.find((s: any) => s.key === 'evidence');
  assert.deepEqual(evidence.rows.map((row: any) => row.action), [
    { key: 'evidence-strength', body: { link: 'pain-61' } },
    { key: 'evidence-strength', body: { link: 'evidence-71' } },
  ]);
  const action = r.body.actions.find((a: any) => a.key === 'evidence-strength');
  assert.equal(action.label, 'Change strength');
  assert.deepEqual(action.form.fields.map((f: any) => [f.key, f.required, f.options.map((o: any) => o.value)]), [
    ['link', true, ['pain-61', 'evidence-71']],
    ['strength', true, ['anecdote', 'pattern', 'measured']],
  ]);
  // Unlink stays among the record's actions.
  assert.ok(r.body.actions.some((a: any) => a.key === 'unlink'));
});

test('#6020: a writer changes a pain link and an evidence link; the record and the list Strength filter follow', async () => {
  const db = fixture();
  const filtered = async (s: string) => (await call(db, 10, 'GET', `/validate/modules/experiments?project=1&filter=strength:${s}`))
    .body.records.rows.map((row: any) => row.id);
  assert.deepEqual(await filtered('measured'), []);
  assert.equal((await change(db, 'pain-61', 'measured')).status, 200);
  assert.equal((await change(db, 'evidence-71', 'pattern')).status, 200);
  assert.deepEqual(strengths(db), { pain: ['61:measured', '62:anecdote', '63:anecdote'], evidence: ['71:pattern', '72:anecdote', '73:anecdote'] });
  // The list's Strength filter is the claim's strongest pain link (unchanged policy): H1 now reads Measured.
  assert.deepEqual(await filtered('measured'), [5]);
  assert.deepEqual(await filtered('anecdote'), [6]);
  const r = await call(db, 10, 'GET', rec('5'));
  assert.deepEqual(r.body.main.find((s: any) => s.key === 'evidence').rows.map((row: any) => row.c), ['Supports · Measured', 'Supports · Pattern']);
  assert.equal(r.body.facts.find((f: any) => f.label === 'Strength').value, 'Measured');
});

test('#6020: the change is logged in the record activity, with the strength and no evidence text', async () => {
  const db = fixture();
  await change(db, 'pain-61', 'measured');
  await change(db, 'evidence-71', 'pattern');
  assert.deepEqual(logs(db), [
    ['validate.experiments', '5', 'Evidence strength measured'],
    ['validate.problem-discovery', '11', 'H1 evidence strength measured'],
    ['validate.experiments', '5', 'Evidence strength pattern'],
  ]);
  const activity = await call(db, 10, 'GET', rec('5', '/activity'));
  assert.equal(activity.status, 200);
  const text = JSON.stringify(activity.body);
  assert.match(text, /Evidence strength measured/);
  assert.match(text, /Evidence strength pattern/);
});

test('#6020: a reader has no control and is refused the write', async () => {
  const db = fixture();
  const r = await call(db, 40, 'GET', rec('5'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.actions, []);
  for (const row of r.body.main.find((s: any) => s.key === 'evidence').rows) assert.equal(row.action, undefined);
  assert.equal((await change(db, 'pain-61', 'measured', 40)).status, 403);
  assert.equal((await change(db, 'evidence-71', 'measured', 40)).status, 403);
  assert.deepEqual(logs(db), []);
});

test('#6020: another venture\'s link or claim, and another claim\'s link on this venture, are refused; nothing is written', async () => {
  const db = fixture();
  const before = strengths(db);
  // Another venture's links through this venture's claim.
  assert.equal((await change(db, 'pain-63', 'measured')).status, 404);
  assert.equal((await change(db, 'evidence-73', 'measured')).status, 404);
  // Another venture's claim.
  assert.equal((await change(db, 'evidence-73', 'measured', 10, '22')).status, 404);
  // The other venture's founder cannot reach this venture's links.
  assert.equal((await call(db, 20, 'POST', `/validate/modules/experiments/records/5/actions/evidence-strength?project=1`, { link: 'evidence-71', strength: 'measured' })).status, 403);
  // Another claim's links on this venture, through H1's record.
  assert.equal((await change(db, 'pain-62', 'measured')).status, 404);
  assert.equal((await change(db, 'evidence-72', 'measured')).status, 404);
  assert.deepEqual(strengths(db), before);
  assert.deepEqual(logs(db), []);
});

test('#6020: a malformed link or an unknown strength answers 400 and writes nothing', async () => {
  const db = fixture();
  const before = strengths(db);
  for (const [link, strength] of [['evidence-71', 'proof'], ['evidence-71', ''], ['pain-61', 'strong']]) {
    assert.equal((await change(db, link, strength)).status, 400, `${link} ${strength}`);
  }
  assert.notEqual((await change(db, 'theme-11', 'measured')).status, 200);
  assert.deepEqual(strengths(db), before);
  assert.deepEqual(logs(db), []);
});
