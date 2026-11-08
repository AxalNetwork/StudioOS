/**
 * D4805 (#4805, Programs audit 2/7) — a signature proves a specific terms revision,
 * and a lifecycle action commits whole or not at all.
 *
 *   1. A terms change BEFORE the signature: the envelope sent for revision 1 completes after revision 2 exists.
 *      It is recorded as signed (it was), but the grant is not marked signed and waits on an amendment;
 *      revision 2 gets its own schedule, which signs it.
 *   2. A terms change AFTER the signature: the grant stops reading as signed and waits on an amendment;
 *      the previous signed record stays on its schedule row; a re-grant after an end does the same.
 *   3. Terms edited without a revision bump are caught by the fingerprint: the old envelope signs nothing.
 *   4. A stale terms change loses to a newer one, and writes no history, supersession or owed push.
 *   5. A send that loses to a terms change records no schedule; the envelope that went out signs nothing.
 *   6. An injected history failure leaves the prior state intact: the state, the terms, the revision and
 *      the signature are as they were, and no database text reaches the answer.
 *   7. The branch push is owed from the commit: it is retried from durable state without repeating the
 *      change, including when the inline push never got as far as reading the licence.
 *
 * The database is the baseline plus every numbered migration above the cutoff (schema only), as
 * `program_schedule_d1120.test.ts` builds it. Every studio, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_grant_revisions_d4805.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import { onProgramScheduleEnvelopeCompleted } from '../src/services/programSchedule.ts';
import { retryPendingLicencePushes } from '../src/services/licencePush.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, SIGNER = 3;
const LIVE = 'lic_live';
const REASON = 'Send the schedule agreed at the November review.';
const SIGNED_AT = '2026-11-05T12:00:00Z';
const DB_TEXT = /injected|SQLITE|RAISE|constraint|D1_ERROR/i;

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const SEED = (() => {
  const sql = readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO program_grant_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture({ deployed = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(SIGNER, 'partner', 'Lee Licensee', 'lee@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(SUPER, `totp-${SUPER}`);
  db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  if (deployed) db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name) VALUES (?, 'fr', 'north.example.test', 'axal-fr', 'axal-fr-db')").run(LIVE);
  return db;
}

type Race = { match: string; run: () => void };
/** The D1 binding, with a competing write that lands just before the first batch whose first statement names `match`. */
function wrap(db: DatabaseSync, o: { race?: Race; log?: string[][]; failPushRead?: boolean } = {}) {
  const d1: any = d1Over(db);
  let pending = o.race ?? null;
  return {
    ...d1,
    prepare(sql: string) {
      if (o.failPushRead && /^SELECT \* FROM territory_licences WHERE id = \?$/.test(sql)) {
        const dead: any = { bind: () => dead, first: async () => { throw new Error('db unavailable'); }, all: async () => { throw new Error('db unavailable'); }, run: async () => { throw new Error('db unavailable'); } };
        return dead;
      }
      const api = d1.prepare(sql);
      api.sql = sql;
      return api;
    },
    batch: async (stmts: any[]) => {
      o.log?.push(stmts.map((s) => String(s.sql)));
      if (pending && String(stmts[0]?.sql).includes(pending.match)) { const r = pending; pending = null; r.run(); }
      return d1.batch(stmts);
    },
  };
}

const app = new Hono<any>();
app.route('/api/admin/program-grants', grantsRoute);

function branch(mode: 'ok' | 'down' = 'ok') {
  const calls: any[] = [];
  return { calls, binding: { applyLicence: async (r: any) => { calls.push(r); if (mode === 'down') throw new Error('branch unreachable'); return { applied: true }; } } };
}

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, o: Parameters<typeof wrap>[1] & { branch?: any } = {}) {
  const token = await new SignJWT({ user_id: SUPER, role: 'admin', jti: `totp-${SUPER}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/program-grants${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: wrap(db, o), ...(o.branch ? { BRANCH_FR: o.branch } : {}) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const grant = (db: DatabaseSync, terms: Record<string, unknown> = {}) => call(db, 'POST', `/licences/${LIVE}/learning`, { reason: 'Granted at the November HQ review.', terms });
const send = (db: DatabaseSync, o = {}) => call(db, 'POST', `/licences/${LIVE}/learning/schedule/send`, { reason: REASON }, o);
const change = (db: DatabaseSync, terms: Record<string, unknown>, o = {}) => call(db, 'PATCH', `/licences/${LIVE}/learning`, { reason: 'Capacity raised after the November review.', terms }, o);
const row = (db: DatabaseSync) => db.prepare("SELECT * FROM program_grants WHERE program_key = 'learning'").get() as any;
const schedules = (db: DatabaseSync) => (db.prepare('SELECT revision, terms_hash, envelope_uuid, signed_at, superseded_at FROM program_grant_schedules ORDER BY id').all() as any[]).map((r) => ({ ...r }));
const events = (db: DatabaseSync) => (db.prepare("SELECT detail_json FROM licence_events WHERE event = 'program_changed' ORDER BY id").all() as any[]).map((e) => JSON.parse(e.detail_json));
const pending = (db: DatabaseSync) => (db.prepare('SELECT * FROM licence_push_pending').all() as any[]).map((r) => ({ ...r }));
const view = async (db: DatabaseSync) => (await call(db, 'GET', `/licences/${LIVE}`)).body.grants[0];
const complete = (db: DatabaseSync, uuid: string, at = SIGNED_AT) => onProgramScheduleEnvelopeCompleted({ DB: d1Over(db) } as any, uuid, at);

test('1. a terms change before the signature: the old envelope signs only the revision it showed', async () => {
  const db = fixture();
  assert.equal((await grant(db, { capacity_cap: 60 })).status, 201);
  assert.equal(row(db).terms_revision, 1);
  const sent = await send(db);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const uuid1 = sent.body.grant.schedule.contract_uid as string;
  const doc1 = db.prepare('SELECT document_body FROM esign_envelopes WHERE envelope_uuid = ?').get(uuid1) as any;
  assert.match(doc1.document_body, /Revision 1 · terms fingerprint [0-9a-f]{16}\./);
  const [rec1] = schedules(db);
  assert.deepEqual([rec1.revision, rec1.envelope_uuid, rec1.signed_at, rec1.superseded_at], [1, uuid1, null, null]);
  assert.match(rec1.terms_hash, /^[0-9a-f]{64}$/);

  const changed = await change(db, { capacity_cap: 80 });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual([row(db).terms_revision, row(db).schedule_contract_uid, row(db).schedule_signed_at], [2, null, null]);
  assert.notEqual(schedules(db)[0].superseded_at, null, 'revision 1\'s schedule is no longer current');
  const old = db.prepare('SELECT e.status, (SELECT r.status FROM esign_recipients r WHERE r.envelope_id = e.id) AS recipient FROM esign_envelopes e WHERE e.envelope_uuid = ?').get(uuid1) as any;
  assert.deepEqual({ ...old }, { status: 'void', recipient: 'void' }, 'the studio can no longer sign the earlier terms');

  // The old envelope completes now.
  const done = await complete(db, uuid1);
  assert.deepEqual(done, { changed: false, stale: true, licence_id: 1, program_key: 'learning' });
  assert.equal(row(db).schedule_signed_at, null, 'it cannot make the newer terms look signed');
  assert.equal(row(db).signed_revision, 1);
  const g = await view(db);
  assert.equal(g.schedule.status, 'amendment_needed');
  assert.equal(g.in_force, false);
  assert.deepEqual(g.waiting_on, ['schedule_signed']);
  assert.equal(schedules(db)[0].signed_at, SIGNED_AT, 'the record of what the studio signed is kept');
  assert.equal(events(db).filter((e) => e.action === 'schedule_signed_stale').length, 1);

  // Revision 2 gets its own schedule, which signs it.
  const resent = await send(db);
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  const uuid2 = resent.body.grant.schedule.contract_uid as string;
  const doc2 = db.prepare('SELECT document_body FROM esign_envelopes WHERE envelope_uuid = ?').get(uuid2) as any;
  assert.match(doc2.document_body, /Revision 2 ·/);
  assert.match(doc2.document_body, /- Capacity: 80/);
  assert.equal((await view(db)).schedule.status, 'sent');
  assert.deepEqual(await complete(db, uuid2, '2026-11-06T09:00:00Z'), { changed: true, stale: false, licence_id: 1, program_key: 'learning' });
  const after = await view(db);
  assert.deepEqual([after.schedule.status, after.schedule.signed_revision, after.in_force], ['signed', 2, true]);
  db.close();
});

test('2. a terms change after the signature: the grant waits on an amendment and the signed record stays', async () => {
  const db = fixture();
  await grant(db, { capacity_cap: 60 });
  const uuid1 = (await send(db)).body.grant.schedule.contract_uid as string;
  assert.equal((await complete(db, uuid1))!.changed, true);
  assert.equal((await view(db)).in_force, true);

  assert.equal((await change(db, { capacity_cap: 75 })).status, 200);
  const g = await view(db);
  assert.deepEqual([g.schedule.status, g.in_force, g.waiting_on, g.schedule.revision, g.schedule.signed_revision], ['amendment_needed', false, ['schedule_signed'], 2, 1]);
  assert.equal(row(db).schedule_signed_at, null);
  const [rec] = schedules(db);
  assert.equal(rec.signed_at, SIGNED_AT, 'the signature on revision 1 is not destroyed');
  assert.notEqual(rec.superseded_at, null);
  assert.equal((await complete(db, uuid1, '2026-11-09T00:00:00Z'))!.changed, false, 'completing it again changes nothing');
  assert.equal(schedules(db)[0].signed_at, SIGNED_AT);

  // End and grant again: a new revision, the schedule cleared, the earlier signature still on record.
  assert.equal((await call(db, 'POST', `/licences/${LIVE}/learning/end`, { reason: 'The studio paused the programme.' })).status, 200);
  assert.equal((await grant(db, { capacity_cap: 50 })).status, 200);
  assert.deepEqual([row(db).terms_revision, row(db).schedule_contract_uid, row(db).schedule_signed_at, row(db).signed_revision], [3, null, null, 1]);
  assert.equal((await view(db)).schedule.status, 'amendment_needed');
  db.close();
});

test('3. terms edited without a revision bump are caught by the fingerprint', async () => {
  const db = fixture();
  await grant(db, { capacity_cap: 60 });
  const uuid = (await send(db)).body.grant.schedule.contract_uid as string;
  db.prepare("UPDATE program_grants SET capacity_cap = 99 WHERE program_key = 'learning'").run();
  assert.deepEqual(await complete(db, uuid), { changed: false, stale: true, licence_id: 1, program_key: 'learning' });
  assert.equal(row(db).schedule_signed_at, null);
  assert.equal((await view(db)).in_force, false);
  db.close();
});

test('4. a stale terms change loses to a newer one and writes nothing', async () => {
  const db = fixture({ deployed: true });
  await grant(db, { capacity_cap: 60 });
  const uuid = (await send(db)).body.grant.schedule.contract_uid as string;
  db.prepare('DELETE FROM licence_push_pending').run();
  const eventsBefore = events(db).length;
  const race = { match: 'UPDATE program_grants SET starts_on', run: () => {
    db.prepare("UPDATE program_grants SET capacity_cap = 70, terms_revision = terms_revision + 1 WHERE program_key = 'learning'").run();
  } };
  const lost = await change(db, { capacity_cap: 80 }, { race });
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.doesNotMatch(JSON.stringify(lost.body), DB_TEXT);
  assert.deepEqual([row(db).capacity_cap, row(db).terms_revision], [70, 2], 'only the winner\'s change stands');
  assert.equal(row(db).schedule_contract_uid, uuid, 'the loser cleared nothing');
  assert.equal(schedules(db)[0].superseded_at, null, 'and superseded nothing');
  assert.equal(events(db).length, eventsBefore, 'no history line for the change that lost');
  assert.deepEqual(pending(db), [], 'no push owed for it');
  db.close();
});

test('5. a send that loses to a terms change records no schedule, and the envelope that went out signs nothing', async () => {
  const db = fixture();
  await grant(db, { capacity_cap: 60 });
  const eventsBefore = events(db).length;
  const race = { match: 'UPDATE program_grants SET schedule_contract_uid', run: () => {
    db.prepare("UPDATE program_grants SET capacity_cap = 90, terms_revision = terms_revision + 1 WHERE program_key = 'learning'").run();
  } };
  const lost = await send(db, { race });
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.equal(lost.body.error, 'terms_changed');
  assert.deepEqual(schedules(db), [], 'no schedule recorded');
  assert.equal(row(db).schedule_contract_uid, null);
  assert.equal(events(db).length, eventsBefore);
  const out = db.prepare('SELECT envelope_uuid FROM esign_envelopes').get() as any;
  assert.ok(out?.envelope_uuid, 'the envelope did go out');
  assert.equal(await complete(db, out.envelope_uuid), null, 'but nothing names it, so it signs nothing');
  assert.equal(row(db).schedule_signed_at, null);
  db.close();
});

test('6. an injected history failure leaves the prior state, terms, revision and signature intact', async () => {
  const db = fixture({ deployed: true });
  await grant(db, { capacity_cap: 60 });
  const uuid = (await send(db)).body.grant.schedule.contract_uid as string;
  await complete(db, uuid);
  db.prepare('DELETE FROM licence_push_pending').run();
  const before = { row: row(db), schedules: schedules(db), events: events(db).length };
  db.exec("CREATE TRIGGER inject_history BEFORE INSERT ON licence_events BEGIN SELECT RAISE(ABORT, 'D1_ERROR: injected history failure: SQLITE_ABORT'); END;");

  for (const [name, res] of [
    ['pause', await call(db, 'POST', `/licences/${LIVE}/learning/pause`, { reason: 'The studio asked for a pause.' })],
    ['terms', await change(db, { capacity_cap: 80 })],
    ['end', await call(db, 'POST', `/licences/${LIVE}/learning/end`, { reason: 'The studio ended the programme.' })],
  ] as const) {
    assert.equal(res.status, 500, `${name}: a storage failure is ours, not the caller's`);
    assert.doesNotMatch(JSON.stringify(res.body), DB_TEXT, `${name}: no database text reaches the UI`);
  }
  assert.deepEqual(row(db), before.row, 'the grant is exactly as it was: state, terms, revision, signature');
  assert.deepEqual(schedules(db), before.schedules, 'and so are its schedule records');
  assert.equal(events(db).length, before.events);
  assert.deepEqual(pending(db), [], 'no push is owed for a change that did not happen');

  db.exec('DROP TRIGGER inject_history');
  assert.equal((await change(db, { capacity_cap: 80 })).status, 200, 'the same change commits once the failure is gone');
  assert.equal(row(db).terms_revision, 2);
  db.close();
});

test('7. the branch push is owed from the commit and retried without repeating the change', async () => {
  const db = fixture({ deployed: true });
  await grant(db, { capacity_cap: 60 });
  db.prepare('DELETE FROM licence_push_pending').run();

  // The branch is unreachable: the change commits, the push is left owed.
  const down = branch('down');
  const done = await change(db, { capacity_cap: 80 }, { branch: down.binding });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.pushed.ok, false);
  assert.equal(pending(db).length, 1);
  const eventsAfter = events(db).length;
  const revision = row(db).terms_revision;

  // Later the branch is back: the retry sends the licence as it is now and repeats nothing.
  const up = branch('ok');
  const r = await retryPendingLicencePushes({ DB: d1Over(db), BRANCH_FR: up.binding } as any, new Date(Date.now() + 2 * 3600_000)) as any;
  assert.deepEqual([r.tried, r.ok, r.failed], [1, 1, 0]);
  assert.deepEqual(pending(db), []);
  assert.equal(up.calls.length, 1);
  assert.match(String(up.calls[0].program_grants_json), /"capacity_cap":80/, 'the copy carries the new terms');
  assert.equal(events(db).length, eventsAfter, 'the business action was not repeated');
  assert.equal(row(db).terms_revision, revision);
  db.close();
});

test('7b. the push is durable even when the inline push never got as far as reading the licence', async () => {
  const db = fixture({ deployed: true });
  await grant(db, { capacity_cap: 60 });
  db.prepare('DELETE FROM licence_push_pending').run();
  const log: string[][] = [];
  // The licence read the inline push starts with fails, so the inline push records nothing of its own.
  const done = await change(db, { capacity_cap: 80 }, { failPushRead: true, log });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.pushed.ok, false);
  const owed = pending(db);
  assert.equal(owed.length, 1, 'the row was written by the change\'s own batch');
  assert.deepEqual([owed[0].licence_id, owed[0].code, owed[0].reason, owed[0].attempts], [1, 'fr', 'queued with the change', 0]);
  assert.ok(log.some((b) => b.some((s) => /INSERT INTO licence_push_pending/.test(s)) && b.some((s) => /UPDATE program_grants SET starts_on/.test(s))), 'queued in the same batch as the change');

  const up = branch('ok');
  const r = await retryPendingLicencePushes({ DB: d1Over(db), BRANCH_FR: up.binding } as any, new Date()) as any;
  assert.deepEqual([r.tried, r.ok], [1, 1], 'picked up at the next tick, without waiting out the window');
  assert.equal(up.calls.length, 1);
  db.close();
});
