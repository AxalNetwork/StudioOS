/**
 * D6686 part 2 (#6686): the owner's two answers of 2026-11-16.
 *   - Every stage but draft through quoted keeps a formation_case_stages
 *     record: entering opens it, leaving completes it (by whom, when), in the
 *     transition's own guarded batch.
 *   - One admin log per filing step: the route's own, not the service's too.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_case_stages_6686.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { formationScreeningFixture } from './_formation_screening_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { RECORDED_STAGES, STAGES, ensureCaseForOrder, transition } from '../src/services/formationCase.ts';
import adminIncorporations from '../src/routes/admin_incorporations.ts';

const ADMIN = 1, FOUNDER = 10;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BACKFILL = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611161045_6686_formation_case_stage_records.sql'), 'utf8');

function fresh() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES (${ADMIN}, 'admin', 'Hq Admin', 'hq@axal.example', 1), (${FOUNDER}, 'founder', 'Fay', 'fay@example.test', 1);
    INSERT INTO projects (id, name) VALUES (1, 'Acme');
    INSERT INTO documents (id, project_id, title, doc_type, status) VALUES (51, 1, 'Packet', 'other', 'generated');`);
  return db;
}
const order = (db: any, id: number, status: string, extra: Record<string, unknown> = {}) => {
  const cols = { id, user_id: FOUNDER, project_id: 1, jurisdiction_id: 'us_de_ccorp', company_name: `Co ${id}`, amount_cents: 50000, status, ...extra };
  db.prepare(`INSERT INTO incorporations (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')})`).run(...Object.values(cols));
};
const rows = (db: any, caseId: number) => db.prepare('SELECT stage, responsible_role, completed_by, completed_at IS NOT NULL AS done FROM formation_case_stages WHERE case_id = ? ORDER BY id').all(caseId).map((r: any) => ({ ...r }));

test('the recorded stages are every stage but draft through quoted', () => {
  const before = STAGES.slice(0, STAGES.indexOf('quoted') + 1);
  assert.deepEqual(before, ['draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted']);
  assert.deepEqual([...RECORDED_STAGES], STAGES.filter((s) => !before.includes(s)));
});

test('a legacy case: opening records its stage; each move completes the stage it leaves and opens the next', async () => {
  const db = fresh();
  order(db, 1, 'paid', { paid_at: '2026-11-01 09:00:00' });
  const env: any = { DB: d1Over(db) };
  const c = await ensureCaseForOrder(env, 1);
  assert.deepEqual(rows(db, c!.id), [{ stage: 'paid', responsible_role: 'hq', completed_by: null, done: 0 }]);
  assert.equal((await transition(env, c!.id, 'preparing', { party: 'system' })).ok, true);
  assert.equal((await transition(env, c!.id, 'ready_to_file', { party: 'hq', userId: ADMIN })).ok, true);
  assert.equal((await transition(env, c!.id, 'submitted', { party: 'hq', userId: ADMIN })).ok, true);
  assert.deepEqual(rows(db, c!.id), [
    { stage: 'paid', responsible_role: 'hq', completed_by: null, done: 1 },
    { stage: 'preparing', responsible_role: 'hq', completed_by: ADMIN, done: 1 },
    { stage: 'ready_to_file', responsible_role: 'hq', completed_by: ADMIN, done: 1 },
    { stage: 'submitted', responsible_role: 'registry', completed_by: null, done: 0 },
  ]);
});

test('a stage left twice keeps its first completion; the later pass is in the timeline', async () => {
  const db = fresh();
  order(db, 4, 'packet_ready', { paid_at: '2026-11-01 09:00:00', packet_ready_at: '2026-11-02 09:00:00' });
  const env: any = { DB: d1Over(db) };
  const c = await ensureCaseForOrder(env, 4);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES (2, 'admin', 'Second Admin', 'second@axal.example', 1)`);
  assert.equal((await transition(env, c!.id, 'submitted', { party: 'hq', userId: ADMIN })).ok, true);
  assert.equal((await transition(env, c!.id, 'registry_query', { party: 'hq', userId: ADMIN })).ok, true);
  assert.equal((await transition(env, c!.id, 'submitted', { party: 'hq', userId: 2 })).ok, true);
  assert.equal((await transition(env, c!.id, 'registry_query', { party: 'hq', userId: 2 })).ok, true);
  const sub = db.prepare("SELECT completed_by FROM formation_case_stages WHERE case_id = ? AND stage = 'submitted'").get(c!.id) as any;
  assert.equal(sub.completed_by, ADMIN, 'the first completion stands');
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM formation_case_events WHERE case_id = ? AND from_stage = 'submitted'").get(c!.id) as any).n), 2, 'both passes are in the timeline');
});

test('stages before paid write no record; entering paid opens the first', async () => {
  const db = fresh();
  db.exec(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, path, stage) VALUES (70, 'v2a', ${FOUNDER}, 'convert_project', 1, 'v2', 'simple', 'draft')`);
  const env: any = { TOKENS: formationScreeningFixture(db, 70), DB: d1Over(db) };
  for (const to of ['options_shown', 'chosen', 'structure_review', 'details', 'quoted'] as const) {
    assert.equal((await transition(env, 70, to, { party: 'founder', userId: FOUNDER })).ok, true, to);
  }
  assert.deepEqual(rows(db, 70), [], 'draft through quoted keep no record');
  assert.equal((await transition(env, 70, 'paid', { party: 'system' })).ok, true);
  assert.deepEqual(rows(db, 70), [{ stage: 'paid', responsible_role: 'hq', completed_by: null, done: 0 }]);
});

test('a transition that loses its race writes no stage record', async () => {
  const db = fresh();
  order(db, 2, 'paid', { paid_at: '2026-11-01 09:00:00' });
  const inner = d1Over(db);
  const c = await ensureCaseForOrder({ DB: inner } as any, 2);
  const DB = { ...inner, prepare: inner.prepare.bind(inner), batch: async (s: any) => { db.exec(`UPDATE formation_cases SET revision = revision + 5 WHERE id = ${c!.id}`); return inner.batch(s); } };
  const out = await transition({ DB } as any, c!.id, 'preparing', { party: 'system' });
  assert.deepEqual(out, { ok: false, status: 409, error: 'case_moved' });
  assert.deepEqual(rows(db, c!.id), [{ stage: 'paid', responsible_role: 'hq', completed_by: null, done: 0 }], 'paid not completed, preparing not opened');
});

test('the backfill opens each case\'s current stage once, and only a recorded one', () => {
  const db = fresh();
  db.exec(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, stage) VALUES
      (80, 'a', ${FOUNDER}, 'convert_project', 1, 'legacy_v1', 'preparing'),
      (81, 'b', ${FOUNDER}, 'convert_project', 1, 'legacy_v1', 'registered'),
      (82, 'c', ${FOUNDER}, 'new_company', NULL, 'v2', 'quoted'),
      (83, 'd', ${FOUNDER}, 'new_company', NULL, 'v2', 'submitted');`);
  db.exec(BACKFILL);
  db.exec(BACKFILL);
  assert.deepEqual(db.prepare('SELECT case_id, stage, responsible_role FROM formation_case_stages ORDER BY case_id').all().map((r: any) => ({ ...r })), [
    { case_id: 80, stage: 'preparing', responsible_role: 'hq' },
    { case_id: 81, stage: 'registered', responsible_role: 'hq' },
    { case_id: 83, stage: 'submitted', responsible_role: 'registry' },
  ]);
});

test('one admin log per filing step: the route\'s own, not the service\'s too', async () => {
  const db = fresh();
  order(db, 3, 'packet_processing', { paid_at: '2026-11-01 09:00:00' });
  const app = new Hono<any>();
  app.route('/admin/incorporations', adminIncorporations);
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const w = console.warn; console.warn = () => {};
  try {
    assert.equal((await post('/admin/incorporations/3/packet-ready', { document_id: 51 })).status, 200);
    assert.equal((await post('/admin/incorporations/3/filed', { filed_on: '2026-11-02' })).status, 200);
  } finally { console.warn = w; }
  const actions = db.prepare('SELECT action FROM activity_logs ORDER BY id').all().map((r: any) => r.action);
  assert.deepEqual(actions.filter((a: string) => /incorporation|formation_case/.test(a)), ['incorporation_packet_ready', 'incorporation_filed']);
});
