/**
 * D1120 (#3000, part of #2376) — a program grant's schedule: HQ sends it for
 * signature, and its envelope's completion records the signature once, so a
 * grant waiting on `schedule_signed` comes into force.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, as `program_grants_d982.test.ts` builds it. Every studio,
 * person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_schedule_d1120.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import { onProgramScheduleEnvelopeCompleted, scheduleDocument, termLine, PROGRAM_SCHEDULE_DOC_TYPE } from '../src/services/programSchedule.ts';
import { scheduleStatus } from '../src/services/programGrants.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, PLAIN_ADMIN = 2, SIGNER = 3, EAST_SIGNER = 4;
const LIVE = 'lic_live', SUSPENDED = 'lic_susp', NO_ADMIN = 'lic_bare';
const REASON = 'Send the schedule agreed at the October review.';

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const SEED = (() => {
  const sql = readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO program_grant_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(SIGNER, 'partner', 'Lee Licensee', 'lee@example.test');
  u.run(EAST_SIGNER, 'partner', 'Eve East', 'eve@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN_ADMIN]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const lic = db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)');
  lic.run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31');
  lic.run(2, SUSPENDED, 'AXL-002', 'Studio East SAS', 'Studio East', 'active', '2027-10-31');
  lic.run(3, NO_ADMIN, 'AXL-003', 'Studio West SAS', 'Studio West', 'active', '2027-10-31');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (2, ?, 'principal')").run(EAST_SIGNER);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/program-grants', grantsRoute);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/program-grants${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const grant = (db: DatabaseSync, uid: string, key: string, terms: Record<string, unknown> = {}) =>
  call(db, SUPER, 'POST', `/licences/${uid}/${key}`, { reason: 'Granted at the October HQ review.', terms });
const send = (db: DatabaseSync, uid: string, key: string, body: Record<string, unknown> = { reason: REASON }, who = SUPER) =>
  call(db, who, 'POST', `/licences/${uid}/${key}/schedule/send`, body);
const grantRow = (db: DatabaseSync, licenceId: number, key: string) =>
  db.prepare('SELECT * FROM program_grants WHERE licence_id = ? AND program_key = ?').get(licenceId, key) as any;
const events = (db: DatabaseSync) => (db.prepare("SELECT detail_json, note, actor_user_id FROM licence_events WHERE event = 'program_changed' ORDER BY id").all() as any[])
  .map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));

test('send refuses a plain admin, a stale step-up and a missing reason, and records nothing', async () => {
  const db = fixture();
  assert.equal((await grant(db, LIVE, 'learning')).status, 201);
  assert.equal((await send(db, LIVE, 'learning', { reason: REASON }, PLAIN_ADMIN)).status, 403, 'a plain admin');
  const none = await send(db, LIVE, 'learning', {});
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'reason_required');
  assert.equal((await send(db, LIVE, 'learning', { reason: 'too short' })).body.error, 'reason_required');
  db.prepare("UPDATE user_sessions SET created_at = datetime('now', '-3 hours') WHERE user_id = ?").run(SUPER);
  assert.equal((await send(db, LIVE, 'learning')).status, 403, 'a stale step-up');
  assert.equal(grantRow(db, 1, 'learning').schedule_contract_uid, null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get() as any).n, 0, 'no envelope was written');
});

test('send: the schedule carries the grant\'s terms, goes to the principal administrator, and names its envelope on the grant', async () => {
  const db = fixture();
  await call(db, SUPER, 'PUT', '/defaults/learning', { reason: 'Set the Learning fee for 2027.', terms: { fee_cents: 200000, currency: 'eur' } });
  await grant(db, LIVE, 'learning', { capacity_cap: 60 });
  const before = (await call(db, SUPER, 'GET', `/licences/${LIVE}`)).body.grants[0];
  assert.equal(before.schedule.status, 'not_sent');
  assert.deepEqual(before.waiting_on, ['schedule_signed']);
  const r = await send(db, LIVE, 'learning');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const env = db.prepare('SELECT * FROM esign_envelopes').get() as any;
  assert.equal(env.document_type, PROGRAM_SCHEDULE_DOC_TYPE);
  assert.equal(env.user_id, SIGNER, 'the licence\'s principal administrator signs');
  assert.equal(env.document_title, 'Program schedule: Learning');
  assert.match(env.document_body, /- Capacity: 60/);
  assert.match(env.document_body, /- Fee: 2000 EUR/);
  assert.match(env.document_body, /- HQ's share: Not recorded/, 'a term nobody set is Not recorded, never a zero');
  const rec = db.prepare('SELECT recipient_email FROM esign_recipients WHERE envelope_id = ?').get(env.id) as any;
  assert.equal(rec.recipient_email, 'lee@example.test');
  assert.equal(grantRow(db, 1, 'learning').schedule_contract_uid, env.envelope_uuid);
  assert.equal(r.body.grant.schedule.status, 'sent');
  assert.equal(r.body.grant.schedule.contract_uid, env.envelope_uuid);
  assert.equal(r.body.grant.in_force, false, 'sent is not signed');
  const ev = events(db).at(-1)!;
  assert.equal(ev.detail.action, 'schedule_sent');
  assert.equal(ev.note, REASON);
  assert.equal(ev.actor_user_id, SUPER);
  const audit = db.prepare("SELECT action FROM admin_audit_log WHERE action = 'program_grant_schedule_sent'").all() as any[];
  assert.equal(audit.length, 1, 'the admin audit log records the send');
});

test('send refuses what has nothing to send: no grant, an ended grant, the rule off, a frozen licence, no signer, one already out', async () => {
  const db = fixture();
  assert.equal((await send(db, LIVE, 'learning')).body.error, 'wrong_state', 'not granted');
  await grant(db, LIVE, 'perks', { requires_signed_schedule: false });
  assert.equal((await send(db, LIVE, 'perks')).body.error, 'schedule_not_required');
  await grant(db, SUSPENDED, 'learning');
  db.prepare("UPDATE territory_licences SET status = 'suspended' WHERE uid = ?").run(SUSPENDED);
  assert.equal((await send(db, SUSPENDED, 'learning')).body.error, 'licence_frozen');
  await grant(db, NO_ADMIN, 'learning');
  assert.equal((await send(db, NO_ADMIN, 'learning')).body.error, 'no_signer');
  await grant(db, LIVE, 'learning');
  assert.equal((await send(db, LIVE, 'learning')).status, 200);
  const again = await send(db, LIVE, 'learning');
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_sent');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get() as any).n, 1, 'one envelope');
  // A voided envelope can be replaced by a new send.
  db.prepare("UPDATE esign_envelopes SET status = 'void'").run();
  const resent = await send(db, LIVE, 'learning');
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  assert.notEqual(resent.body.grant.schedule.contract_uid, again.body.contract_uid);
  await call(db, SUPER, 'POST', `/licences/${LIVE}/learning/end`, { reason: 'The studio stopped running it.' });
  assert.equal((await send(db, LIVE, 'learning')).body.error, 'wrong_state', 'ended');
});

test('the signature is recorded once, and a grant waiting only on it comes into force', async () => {
  const db = fixture();
  await grant(db, LIVE, 'learning');
  const r = await send(db, LIVE, 'learning');
  const uuid = r.body.grant.schedule.contract_uid as string;
  const DB = d1Over(db);
  const first = await onProgramScheduleEnvelopeCompleted({ DB } as any, uuid, '2026-10-25T12:00:00Z');
  assert.deepEqual(first, { changed: true, licence_id: 1, program_key: 'learning' });
  const second = await onProgramScheduleEnvelopeCompleted({ DB } as any, uuid, '2026-10-26T12:00:00Z');
  assert.equal(second!.changed, false, 'a second completion changes nothing');
  assert.equal(grantRow(db, 1, 'learning').schedule_signed_at, '2026-10-25T12:00:00Z', 'the first signature stands');
  assert.equal(events(db).filter((e) => e.detail.action === 'schedule_signed').length, 1, 'one event');
  assert.equal(await onProgramScheduleEnvelopeCompleted({ DB } as any, 'not-a-schedule'), null, 'an envelope no grant names');
  const g = (await call(db, SUPER, 'GET', `/licences/${LIVE}`)).body.grants[0];
  assert.equal(g.schedule.status, 'signed');
  assert.deepEqual(g.waiting_on, []);
  assert.equal(g.in_force, true);
  assert.equal((await send(db, LIVE, 'learning')).body.error, 'already_signed');
});

test('both completion paths call the schedule hook, the in-house one only after it won the completion', () => {
  const esign = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/esign.ts'), 'utf8');
  const won = esign.indexOf('if (wonRace) try {');
  const hook = esign.indexOf('onProgramScheduleEnvelopeCompleted(c.env, envelopeRow.envelope_uuid)');
  assert.ok(won > 0 && hook > won, 'inside the won-race block');
  assert.match(esign, /const PROGRAM_SCHEDULE_DOC_TYPE = 'program_schedule';/);
  assert.equal(PROGRAM_SCHEDULE_DOC_TYPE, 'program_schedule');
  const ds = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/integrations/providers/docusign.ts'), 'utf8');
  assert.match(ds, /onProgramScheduleEnvelopeCompleted\(env, local\.envelope_uuid\)/);
});

test('the schedule text: Not recorded for a blank term, no merge slot, and the status words', () => {
  assert.equal(termLine('fee_cents', null, {}), 'Not recorded');
  assert.equal(termLine('fee_cents', 150050, { currency: 'USD' }), '1500.50 USD');
  assert.equal(termLine('fee_cents', 0, { currency: 'USD' }), '0 USD', 'a recorded zero is a zero');
  assert.equal(termLine('hq_share_bps', 1250, {}), '12.5%');
  assert.equal(termLine('hq_share_bps', 1000, {}), '10%');
  assert.equal(termLine('requires_signed_schedule', 1, {}), 'Yes');
  const doc = scheduleDocument({ id: 1, uid: 'u', licence_ref: 'AXL-9', brand_name: 'Studio {{x}}', kind: null, status: 'active', renews_on: null },
    { program_key: 'perks', note: null }, '2026-10-25');
  assert.ok(!doc.body.includes('{{'), 'no merge slot survives');
  assert.equal(scheduleStatus({}), 'not_sent');
  assert.equal(scheduleStatus({ schedule_contract_uid: 'e' }), 'sent');
  assert.equal(scheduleStatus({ schedule_contract_uid: 'e', schedule_signed_at: 't' }), 'signed');
});
