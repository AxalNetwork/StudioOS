/**
 * D6686 (#6686, E6 of #6680) — the formation case store.
 *
 * Over the full migrated schema (baseline plus every migration, these two
 * included), pinned:
 *   - the backfill gives one legacy case per order at paid or later and none
 *     to a pending order; a second run changes nothing; no incorporations
 *     value changes; an unknown status is reported, not cased;
 *   - after the payment webhook and the packet job, the case is at preparing
 *     and the order at packet_processing;
 *   - two transitions raced from the same read: one moves, one answers 409,
 *     and stage and status still agree;
 *   - the legacy admin steps refuse a v2 case with case_not_legacy;
 *   - the projection of every stage onto the order status;
 *   - the runtime mirror declares the migration's columns.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_cases_6686.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { STAGES, statusForStage, transition, ensureCaseForOrder, readCase } from '../src/services/formationCase.ts';
import { recordPaidIncorporation } from '../src/services/incorporations.ts';
import { handleJob } from '../src/services/queueWorker.ts';
import { markFiled, markPacketReady } from '../src/services/incorporationFiling.ts';

const MIG = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const TABLES = readFileSync(`${MIG}/202611151733_6686_formation_cases.sql`, 'utf8');
const BACKFILL = readFileSync(`${MIG}/202611151734_6686_formation_cases_backfill.sql`, 'utf8');
const ADMIN = 1, FOUNDER = 10;

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
const all = (db: any, sql: string, ...a: unknown[]) => db.prepare(sql).all(...a).map((r: any) => ({ ...r }));
const one = (db: any, sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...a); return r ? { ...r } : r; };
const quiet = async <T>(fn: () => Promise<T>) => { const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.error = e; } };

test('the backfill: one case per order at paid or later, none for pending, twice changes nothing, no order value changes', () => {
  const db = fresh();
  // Two pending and two paid orders on one project, plus one at each later status and one unknown.
  order(db, 1, 'pending_payment');
  order(db, 2, 'pending_payment');
  order(db, 3, 'paid', { paid_at: '2026-10-01 09:00:00' });
  order(db, 4, 'paid', { paid_at: '2026-10-02 09:00:00' });
  order(db, 5, 'packet_processing', { paid_at: '2026-10-03 09:00:00', updated_at: '2026-10-03 10:00:00' });
  order(db, 6, 'packet_ready', { paid_at: '2026-10-04 09:00:00', packet_ready_at: '2026-10-05 09:00:00', packet_ready_by: ADMIN, packet_document_id: 51 });
  order(db, 7, 'filed', { paid_at: '2026-10-06 09:00:00', packet_ready_at: '2026-10-07 09:00:00', packet_ready_by: ADMIN, filed_on: '2026-10-08', filed_recorded_at: '2026-10-08 12:00:00', filed_by: ADMIN });
  order(db, 8, 'refunded', { paid_at: '2026-10-09 09:00:00' });
  const before = all(db, 'SELECT * FROM incorporations ORDER BY id');

  db.exec(BACKFILL);
  const paidOrLater = one(db, "SELECT COUNT(*) AS n FROM incorporations WHERE status IN ('paid', 'packet_processing', 'packet_ready', 'filed')").n;
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM formation_cases').n, paidOrLater, 'one case per order at paid or later');
  assert.equal(paidOrLater, 5);
  assert.deepEqual(all(db, 'SELECT incorporation_id FROM formation_case_orders ORDER BY incorporation_id').map((r: any) => r.incorporation_id), [3, 4, 5, 6, 7]);
  assert.deepEqual(
    all(db, "SELECT o.incorporation_id AS id, c.stage, c.track, c.uid, c.waiting_on FROM formation_cases c JOIN formation_case_orders o ON o.case_id = c.id ORDER BY o.incorporation_id"),
    [
      { id: 3, stage: 'paid', track: 'legacy_v1', uid: 'fc_legacy_3', waiting_on: 'hq' },
      { id: 4, stage: 'paid', track: 'legacy_v1', uid: 'fc_legacy_4', waiting_on: 'hq' },
      { id: 5, stage: 'preparing', track: 'legacy_v1', uid: 'fc_legacy_5', waiting_on: 'hq' },
      { id: 6, stage: 'ready_to_file', track: 'legacy_v1', uid: 'fc_legacy_6', waiting_on: 'hq' },
      { id: 7, stage: 'registered', track: 'legacy_v1', uid: 'fc_legacy_7', waiting_on: 'nobody' },
    ],
  );
  // The timeline from the order's own dates.
  assert.deepEqual(
    all(db, "SELECT c.uid, e.to_stage, e.at, e.actor_user_id, e.kind FROM formation_case_events e JOIN formation_cases c ON c.id = e.case_id WHERE c.uid = 'fc_legacy_7' ORDER BY e.at"),
    [
      { uid: 'fc_legacy_7', to_stage: 'paid', at: '2026-10-06 09:00:00', actor_user_id: null, kind: 'backfill' },
      { uid: 'fc_legacy_7', to_stage: 'ready_to_file', at: '2026-10-07 09:00:00', actor_user_id: ADMIN, kind: 'backfill' },
      { uid: 'fc_legacy_7', to_stage: 'registered', at: '2026-10-08 12:00:00', actor_user_id: ADMIN, kind: 'backfill' },
    ],
  );
  assert.deepEqual(all(db, 'SELECT incorporation_id, status FROM formation_backfill_skips'), [{ incorporation_id: 8, status: 'refunded' }], 'the unknown status is reported');

  const snapshot = (t: string) => all(db, `SELECT * FROM ${t} ORDER BY 1`);
  const after1 = ['formation_cases', 'formation_case_orders', 'formation_case_events', 'formation_backfill_skips'].map(snapshot);
  db.exec(BACKFILL);
  assert.deepEqual(['formation_cases', 'formation_case_orders', 'formation_case_events', 'formation_backfill_skips'].map(snapshot), after1, 'a second run changes nothing');
  assert.deepEqual(all(db, 'SELECT * FROM incorporations ORDER BY id'), before, 'no incorporations value changed');
});

test('after the payment webhook and the packet job, the case is at preparing and the order at packet_processing', async () => {
  const db = fresh();
  order(db, 20, 'pending_payment');
  const sent: any[] = [];
  const env: any = { DB: d1Over(db), USE_CF_QUEUE: 'true', JOB_QUEUE: { send: async (m: any) => { sent.push(m); } } };
  await quiet(() => recordPaidIncorporation(env, { id: 'cs_1', metadata: { incorporation_id: '20' }, payment_status: 'paid', amount_total: 50000, currency: 'usd' }));
  assert.equal(one(db, 'SELECT status FROM incorporations WHERE id = 20').status, 'paid');
  assert.equal(one(db, "SELECT stage FROM formation_cases WHERE uid = 'fc_legacy_20'").stage, 'paid', 'the paid recorder opened the case');
  assert.equal(sent.length, 1);
  const job = { id: 1, job_type: sent[0].job_type, payload: JSON.stringify(sent[0].payload), status: 'pending', attempts: 0, max_retries: 3, error: null, created_at: '' };
  await quiet(() => handleJob(env, job as any));
  assert.equal(one(db, "SELECT stage FROM formation_cases WHERE uid = 'fc_legacy_20'").stage, 'preparing');
  assert.equal(one(db, 'SELECT status FROM incorporations WHERE id = 20').status, 'packet_processing');
  assert.deepEqual(
    all(db, "SELECT e.kind, e.from_stage, e.to_stage, e.to_revision FROM formation_case_events e JOIN formation_cases c ON c.id = e.case_id WHERE c.uid = 'fc_legacy_20' ORDER BY e.id"),
    [{ kind: 'case_opened', from_stage: null, to_stage: 'paid', to_revision: null }, { kind: 'stage_change', from_stage: 'paid', to_stage: 'preparing', to_revision: 1 }],
  );
  // A replayed job changes nothing.
  await quiet(() => handleJob(env, job as any));
  assert.equal(one(db, "SELECT revision FROM formation_cases WHERE uid = 'fc_legacy_20'").revision, 1);
  // A replayed webhook opens no second case.
  await quiet(() => recordPaidIncorporation(env, { id: 'cs_1', metadata: { incorporation_id: '20' }, payment_status: 'paid' }));
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM formation_cases').n, 1);
});

test('two transitions raced from the same read: one moves, one answers 409, and stage and status agree', async () => {
  const db = fresh();
  order(db, 30, 'paid', { paid_at: '2026-10-01 09:00:00' });
  const inner = d1Over(db);
  const c = await ensureCaseForOrder({ DB: inner } as any, 30);
  assert.ok(c);
  // Both callers read the case before either writes: the second batch runs
  // while the first is held at its batch() call.
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const atBatch = new Promise<void>((r) => { entered = r; });
  let held = false;
  const DB = { ...inner, prepare: inner.prepare.bind(inner), batch: async (s: any) => { if (!held) { held = true; entered(); await gate; } return inner.batch(s); } };
  const env: any = { DB };
  const first = transition(env, c!.id, 'preparing', { party: 'system' });
  await atBatch; // the first caller has read the case and is held at its batch
  const second = transition(env, c!.id, 'ready_to_file', { party: 'system' });
  const secondOut = await second;
  release();
  const firstOut = await first;
  const outs = [firstOut, secondOut];
  assert.equal(outs.filter((o) => o.ok).length, 1, 'exactly one moved');
  assert.deepEqual(outs.find((o) => !o.ok), { ok: false, status: 409, error: 'case_moved' });
  const cs = one(db, 'SELECT stage, revision FROM formation_cases WHERE id = ?', c!.id);
  const st = one(db, 'SELECT status FROM incorporations WHERE id = 30').status;
  assert.equal(st, statusForStage(cs.stage), 'the order status is the case stage projected');
  assert.equal(cs.revision, 1);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_case_events WHERE case_id = ? AND kind = 'stage_change'", c!.id).n, 1, 'the loser wrote no event');
});

test('a transition whose order moved under it writes nothing at all', async () => {
  const db = fresh();
  order(db, 31, 'paid', { paid_at: '2026-10-01 09:00:00' });
  const inner = d1Over(db);
  const c = await ensureCaseForOrder({ DB: inner } as any, 31);
  // The order moves between the read and the batch (outside the service).
  const DB = { ...inner, prepare: inner.prepare.bind(inner), batch: async (s: any) => { db.exec("UPDATE incorporations SET status = 'packet_processing' WHERE id = 31"); return inner.batch(s); } };
  const out = await transition({ DB } as any, c!.id, 'ready_to_file', { party: 'system' });
  assert.deepEqual(out, { ok: false, status: 409, error: 'case_moved' });
  assert.equal(one(db, 'SELECT stage FROM formation_cases WHERE id = ?', c!.id).stage, 'paid');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM formation_case_events WHERE kind = 'stage_change'").n, 0);
});

test('the legacy admin steps refuse a v2 case with case_not_legacy', async () => {
  const db = fresh();
  order(db, 40, 'packet_processing', { paid_at: '2026-10-01 09:00:00' });
  order(db, 41, 'packet_ready', { paid_at: '2026-10-01 09:00:00', packet_ready_at: '2026-10-02 09:00:00', packet_document_id: 51 });
  db.exec(`INSERT INTO formation_cases (id, uid, user_id, intent, project_id, track, path, stage, waiting_on) VALUES
      (900, 'fc_v2_a', ${FOUNDER}, 'convert_project', 1, 'v2', 'simple', 'preparing', 'hq'),
      (901, 'fc_v2_b', ${FOUNDER}, 'incorporate_company', NULL, 'v2', 'simple', 'ready_to_file', 'hq');
    INSERT INTO formation_case_orders (case_id, incorporation_id) VALUES (900, 40), (901, 41);`);
  const env: any = { DB: d1Over(db) };
  assert.deepEqual(await quiet(() => markPacketReady(env, 40, 51, ADMIN)), { ok: false, status: 409, error: 'case_not_legacy' });
  assert.deepEqual(await quiet(() => markFiled(env, 41, '2026-10-03', ADMIN)), { ok: false, status: 409, error: 'case_not_legacy' });
  assert.equal(one(db, 'SELECT status FROM incorporations WHERE id = 40').status, 'packet_processing');
  assert.equal(one(db, 'SELECT status FROM incorporations WHERE id = 41').status, 'packet_ready');
});

test('the legacy admin steps move the case with the order, and log the admin', async () => {
  const db = fresh();
  order(db, 50, 'packet_processing', { paid_at: '2026-10-01 09:00:00' });
  const env: any = { DB: d1Over(db) };
  assert.equal((await quiet(() => markPacketReady(env, 50, 51, ADMIN, 'hq@axal.example'))).ok, true);
  assert.deepEqual(one(db, "SELECT stage, revision FROM formation_cases WHERE uid = 'fc_legacy_50'"), { stage: 'ready_to_file', revision: 1 });
  assert.deepEqual(one(db, 'SELECT status, packet_document_id, packet_ready_by FROM incorporations WHERE id = 50'), { status: 'packet_ready', packet_document_id: 51, packet_ready_by: ADMIN });
  assert.equal((await quiet(() => markFiled(env, 50, '2026-10-02', ADMIN, '2026-11-15', 'hq@axal.example'))).ok, true);
  assert.deepEqual(one(db, "SELECT stage, revision, waiting_on FROM formation_cases WHERE uid = 'fc_legacy_50'"), { stage: 'registered', revision: 2, waiting_on: 'nobody' });
  assert.equal(one(db, 'SELECT status FROM incorporations WHERE id = 50').status, 'filed');
  assert.deepEqual(
    all(db, "SELECT user_id, json_extract(details, '$.to') AS t FROM activity_logs WHERE action = 'formation_case_transition' ORDER BY id"),
    [{ user_id: ADMIN, t: 'ready_to_file' }, { user_id: ADMIN, t: 'registered' }],
  );
});

test('every stage projects onto the order status as the issue lists', () => {
  const expected: Record<string, string> = {
    draft: 'pending_payment', options_shown: 'pending_payment', chosen: 'pending_payment', structure_review: 'pending_payment',
    details: 'pending_payment', quoted: 'pending_payment', paid: 'paid', preparing: 'packet_processing',
    ready_to_file: 'packet_ready', submitted: 'packet_ready', registry_query: 'packet_ready',
    registered: 'filed', activating: 'filed', handed_off: 'filed',
  };
  assert.deepEqual(Object.fromEntries(STAGES.map((s) => [s, statusForStage(s)])), expected);
});

test('one open v2 case per project; legacy cases on the same project are exempt', () => {
  const db = fresh();
  const ins = db.prepare(`INSERT INTO formation_cases (uid, user_id, intent, project_id, track, stage) VALUES (?, ${FOUNDER}, 'convert_project', 1, ?, 'paid')`);
  ins.run('l1', 'legacy_v1'); ins.run('l2', 'legacy_v1');
  ins.run('v1', 'v2');
  assert.throws(() => ins.run('v2b', 'v2'), /UNIQUE/);
  db.exec("UPDATE formation_cases SET closed_at = datetime('now'), close_reason = 'cancelled' WHERE uid = 'v1'");
  ins.run('v2c', 'v2');
});

test('the runtime mirror declares the migration\'s four tables with the same columns', async () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/incorporations.ts'), 'utf8');
  for (const t of ['formation_cases', 'formation_case_orders', 'formation_case_stages', 'formation_case_events']) {
    const block = (text: string) => {
      const at = text.indexOf(`CREATE TABLE IF NOT EXISTS ${t} (`);
      assert.ok(at >= 0, `${t} declared`);
      return text.slice(at, text.indexOf('\n)', at)).split('\n').map((l) => l.trim()).filter(Boolean);
    };
    assert.deepEqual(block(src), block(TABLES), `${t}: the mirror matches the migration`);
  }
  // And a database the runner never reached gets them at runtime.
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  db.exec(`CREATE TABLE incorporations (id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, company_id INTEGER, status TEXT, paid_at TEXT);
    INSERT INTO incorporations (id, user_id, project_id, status) VALUES (60, ${FOUNDER}, 1, 'paid');`);
  const c = await ensureCaseForOrder({ DB: d1Over(db) } as any, 60);
  assert.equal(c?.stage, 'paid');
  assert.equal((await readCase({ DB: d1Over(db) } as any, c!.id))?.uid, 'fc_legacy_60');
});
