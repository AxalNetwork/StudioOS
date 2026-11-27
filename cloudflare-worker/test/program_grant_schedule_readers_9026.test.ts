/**
 * D9026 (#9026) — the readers of a grant's schedule envelope moved from `program_grants.schedule_contract_uid` to
 * the grant's current `program_schedule` agreement version (`program_grant_schedule_envelopes`).
 *
 *   1. Before and after, on the same rows: through every write path (grant, send, a voided envelope, resend,
 *      completion, terms change, end, re-grant) and on legacy grants D5048's backfill reached, each reader answers
 *      what the column answered: the grant read's schedule status and contract uid, the send's "already sent"
 *      envelope and the history's `before`, the completion guard, and the branch copy.
 *   2. A backfilled legacy grant (`origin = 'backfill_d5048'`) reads as sent or signed from its agreement row alone.
 *   3. No Worker file reads the column: every mention is a write the Worker one version back still needs, or an
 *      entry on the allowlist below. A new reader fails this test.
 *
 * Real node:sqlite, the schema as migrations build it, synthetic studios, people and envelopes.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_grant_schedule_readers_9026.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import { onProgramScheduleEnvelopeCompleted } from '../src/services/programSchedule.ts';
import { presentGrant, scheduleStatus } from '../src/services/programGrants.ts';
import { withScheduleEnvelopes } from '../src/services/programAgreements.ts';
import { programCopy, studioPrograms } from '../src/services/licencePrograms.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const D5048 = readFileSync(resolve(MIGRATIONS, '202611082025_licence_program_agreements.sql'), 'utf8');
const VIEW = readFileSync(resolve(MIGRATIONS, '202611272239_9026_program_grant_schedule_envelopes.sql'), 'utf8');
const SUPER = 1, SIGNER = 3;
const LIVE = 'lic_live';
const REASON = 'Send the schedule agreed at the November review.';
const SHA = (c: string) => c.repeat(64).slice(0, 64);
const LICENCE = { id: 1, uid: LIVE, licence_ref: 'AXL-001', brand_name: 'Studio North', kind: null, status: 'active', renews_on: '2027-10-31' };
const TODAY = '2026-11-27';

const DDL = (below?: number) => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db, below ? { below } : {});
  const out = (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
  db.close();
  return out;
};
const SEED = (() => {
  const sql = readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO program_grant_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture(ddl: string[]) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of ddl) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(SIGNER, 'partner', 'Lee Licensee', 'lee@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(SUPER, `totp-${SUPER}`);
  db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/program-grants', grantsRoute);
const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);

async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: SUPER, role: 'admin', jti: `totp-${SUPER}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/program-grants${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env(db)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const grant = (db: DatabaseSync, key = 'learning', terms: Record<string, unknown> = {}) =>
  call(db, 'POST', `/licences/${LIVE}/${key}`, { reason: 'Granted at the November HQ review.', terms });
const send = (db: DatabaseSync, key = 'learning') => call(db, 'POST', `/licences/${LIVE}/${key}/schedule/send`, { reason: REASON });
const change = (db: DatabaseSync, terms: Record<string, unknown>, key = 'learning') =>
  call(db, 'PATCH', `/licences/${LIVE}/${key}`, { reason: 'Capacity raised after the November review.', terms });
/** The studio signs: the envelope completes, as the e-sign route records it, then the completion hook runs. */
const complete = (db: DatabaseSync, uuid: string) => {
  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = '2026-11-20T12:00:00Z' WHERE envelope_uuid = ? AND status <> 'void'").run(uuid);
  return onProgramScheduleEnvelopeCompleted({ DB: d1Over(db) } as any, uuid, '2026-11-20T12:00:00Z');
};
const newest = (db: DatabaseSync) => (db.prepare('SELECT envelope_uuid FROM esign_envelopes ORDER BY id DESC LIMIT 1').get() as any).envelope_uuid as string;
const rawGrants = (db: DatabaseSync) => (db.prepare('SELECT * FROM program_grants ORDER BY id').all() as any[]).map((r) => ({ ...r }));

/** What the column answered, by the code as it was before D9026 (the grant row's own column). */
function before(raw: Record<string, any>, envelopes: string[]) {
  return {
    status: scheduleStatus(raw),
    contract_uid: raw.schedule_contract_uid ?? null,
    completes: Object.fromEntries(envelopes.map((e) => [e, raw.schedule_contract_uid === e])),
  };
}

/** What each moved reader answers now. */
async function after(db: DatabaseSync, raw: Record<string, any>, envelopes: string[], o: { route?: boolean } = {}) {
  const [decorated] = await withScheduleEnvelopes(env(db), [raw]);
  const presented = presentGrant(decorated, LICENCE as any, TODAY).schedule;
  // The completion guard's predicate, as programSchedule.ts writes it.
  const guard = db.prepare('SELECT ? = (SELECT v.envelope_uuid FROM program_grant_schedule_envelopes v WHERE v.grant_id = ?) AS m');
  const out: Record<string, unknown> = {
    status: presented.status,
    contract_uid: presented.contract_uid,
    completes: Object.fromEntries(envelopes.map((e) => [e, Number((guard.get(e, raw.id) as any).m) === 1])),
  };
  if (o.route) {
    const read = await call(db, 'GET', `/licences/${LIVE}`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const g = read.body.grants.find((x: any) => x.uid === raw.uid);
    assert.deepEqual([g.schedule.status, g.schedule.contract_uid], [out.status, out.contract_uid], 'the grant read is the presented schedule');
    // The grid (`readGrid`) presents the same schedule.
    const grid = await call(db, 'GET', '');
    assert.equal(grid.status, 200, JSON.stringify(grid.body));
    const onGrid = JSON.stringify(grid.body).includes(`"uid":"${raw.uid}"`)
      ? (function find(v: any): any { if (v && typeof v === 'object') { if (v.uid === raw.uid && v.schedule) return v; for (const x of Object.values(v)) { const f = find(x); if (f) return f; } } return null; })(grid.body)
      : null;
    assert.ok(onGrid, `grant ${raw.uid} is on the grid`);
    assert.deepEqual([onGrid.schedule.status, onGrid.schedule.contract_uid], [out.status, out.contract_uid], 'the grid presents the same schedule');
    // The branch copy carries the same envelope, and a branch presents the same schedule from it.
    const copy = await programCopy(env(db), 1);
    const copied = copy.grants.find((x) => x.uid === raw.uid)!;
    assert.equal(copied.schedule_contract_uid ?? null, out.contract_uid, 'the branch copy carries the agreement row\'s envelope');
    const studio = studioPrograms(JSON.parse(JSON.stringify(copy)), LICENCE as any, TODAY).find((p: any) => p.program_key === raw.program_key);
    if (studio?.grant) assert.deepEqual([studio.grant.schedule.status, studio.grant.schedule.contract_uid], [out.status, out.contract_uid]);
  }
  return out;
}

async function same(db: DatabaseSync, step: string, o: { route?: boolean } = {}) {
  const envelopes = [...(db.prepare('SELECT envelope_uuid FROM esign_envelopes ORDER BY id').all() as any[]).map((r) => r.envelope_uuid), 'env-elsewhere'];
  for (const raw of rawGrants(db)) {
    assert.deepEqual(await after(db, raw, envelopes, o), before(raw, envelopes), `${step}: grant ${raw.program_key} reads as the column did`);
  }
}

// ═══════════════════════════════════════════════════════════════════ 1

test('1. through every write path, each reader answers what the column answered', async () => {
  const db = fixture(DDL());
  const r = { route: true };
  assert.equal((await grant(db)).status, 201);
  assert.equal((await grant(db, 'perks')).status, 201);
  await same(db, 'granted, not sent', r);

  assert.equal((await send(db)).status, 200);
  const first = newest(db);
  await same(db, 'sent', r);
  const again = await send(db);
  assert.deepEqual([again.status, again.body.error, again.body.contract_uid], [409, 'already_sent', first], 'resend refused while the envelope is live');

  // The envelope is voided: the grant still names it until the schedule is sent again, and a resend is allowed.
  db.prepare("UPDATE esign_envelopes SET status = 'void' WHERE envelope_uuid = ?").run(first);
  db.prepare("UPDATE esign_recipients SET status = 'void' WHERE envelope_id = (SELECT id FROM esign_envelopes WHERE envelope_uuid = ?)").run(first);
  await same(db, 'envelope voided', r);
  const resent = await send(db);
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  const second = newest(db);
  const hist = (db.prepare("SELECT detail_json FROM licence_events WHERE event = 'program_changed' ORDER BY id DESC LIMIT 1").get() as any).detail_json;
  assert.deepEqual(JSON.parse(hist).changed, [{ key: 'schedule_contract_uid', before: first, after: second }], 'the history names the envelope it replaced');
  await same(db, 'resent', r);

  // The replaced envelope completing signs nothing; the current one signs the grant.
  assert.equal((await complete(db, first))?.changed, false);
  assert.equal(rawGrants(db)[0].schedule_signed_at, null);
  assert.equal((await complete(db, second))?.changed, true);
  await same(db, 'signed', r);

  // A terms change clears it: amendment needed, then a new revision's schedule is out.
  assert.equal((await change(db, { capacity_cap: 80 })).status, 200);
  await same(db, 'terms changed', r);
  assert.equal((await send(db)).status, 200);
  const third = newest(db);
  await same(db, 'amendment sent', r);
  // Completion for superseded terms: the old revision's envelope signs nothing.
  assert.equal((await complete(db, second))?.changed, false);
  await same(db, 'superseded completion', r);

  // End and grant again: the schedule starts over.
  assert.equal((await call(db, 'POST', `/licences/${LIVE}/learning/end`, { reason: 'The studio ended the programme.' })).status, 200);
  await same(db, 'ended', r);
  assert.equal((await grant(db)).status, 200);
  await same(db, 're-granted', r);
  assert.equal((await complete(db, third))?.changed, false, 'the earlier grant\'s envelope signs nothing after a re-grant');
  assert.equal((await send(db)).status, 200);
  assert.equal((await complete(db, newest(db)))?.changed, true);
  await same(db, 're-granted and signed', r);
  db.close();
});

// ═══════════════════════════════════════════════════════════════════ 2

/** Legacy grants as they stood before D5048, each with the envelope its column names. */
function legacy(db: DatabaseSync) {
  const grantRow = db.prepare(`INSERT INTO program_grants (id, uid, licence_id, program_key, state, schedule_contract_uid, schedule_signed_at, set_at, terms_revision, signed_revision)
                               VALUES (?, ?, 1, ?, 'granted', ?, ?, '2026-10-01T00:00:00Z', ?, ?)`);
  const envRow = db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by, completed_at)
                             VALUES (?, 'program_schedule', 'Program schedule', 'body', ?, ?, 1, ?)`);
  const sched = db.prepare('INSERT INTO program_grant_schedules (grant_id, revision, terms_hash, envelope_uuid, sent_at, signed_at, superseded_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // 20: out for signature.
  grantRow.run(20, 'g20', 'learning', 'env-20', null, 1, null);
  envRow.run('env-20', SHA('a'), 'sent', null);
  sched.run(20, 1, 'legacy', 'env-20', '2026-10-02T00:00:00Z', null, null);
  // 21: signed.
  grantRow.run(21, 'g21', 'perks', 'env-21', '2026-10-06T00:00:00Z', 1, 1);
  envRow.run('env-21', SHA('b'), 'completed', '2026-10-06T00:00:00Z');
  sched.run(21, 1, 'legacy', 'env-21', '2026-10-02T00:00:00Z', '2026-10-06T00:00:00Z', null);
  // 22: voided and never sent again: the column still names it.
  grantRow.run(22, 'g22', 'spinout-lab', 'env-22', null, 1, null);
  envRow.run('env-22', SHA('c'), 'void', null);
  sched.run(22, 1, 'legacy', 'env-22', '2026-10-02T00:00:00Z', null, null);
  // 23: voided, then the terms changed: the column was cleared.
  grantRow.run(23, 'g23', 'mentor-cohorts', null, null, 2, null);
  envRow.run('env-23', SHA('d'), 'void', null);
  sched.run(23, 1, 'legacy', 'env-23', '2026-10-02T00:00:00Z', null, '2026-10-08T00:00:00Z');
  // 24: signed, terms changed, the amended schedule out.
  grantRow.run(24, 'g24', 'referral-partners', 'env-24b', null, 2, 1);
  envRow.run('env-24a', SHA('e'), 'completed', '2026-10-04T00:00:00Z');
  envRow.run('env-24b', SHA('f'), 'sent', null);
  sched.run(24, 1, 'legacy', 'env-24a', '2026-10-02T00:00:00Z', '2026-10-04T00:00:00Z', '2026-10-09T00:00:00Z');
  sched.run(24, 2, 'legacy', 'env-24b', '2026-10-10T00:00:00Z', null, null);
  // 25: sent, then the terms changed and nothing was sent again: the column was cleared.
  grantRow.run(25, 'g25', 'refer-and-earn', null, null, 2, null);
  envRow.run('env-25', SHA('g'), 'sent', null);
  sched.run(25, 1, 'legacy', 'env-25', '2026-10-02T00:00:00Z', null, '2026-10-07T00:00:00Z');
  // 26: an envelope only the grant names (no schedule row), out for signature.
  grantRow.run(26, 'g26', 'ai-native-venture', 'env-26', null, 1, null);
  envRow.run('env-26', SHA('h'), 'sent', null);
  // 27: nothing ever sent.
  grantRow.run(27, 'g27', 'investor-cohorts', null, null, 1, null);
}

test('2. legacy grants D5048 backfilled read as the column did, and a backfilled grant reads from its agreement row alone', async () => {
  const db = fixture(DDL(202611082025));
  legacy(db);
  const envelopes = [...(db.prepare('SELECT envelope_uuid FROM esign_envelopes ORDER BY id').all() as any[]).map((r) => r.envelope_uuid), 'env-elsewhere'];
  const oracle = Object.fromEntries(rawGrants(db).map((g) => [g.id, before(g, envelopes)]));
  db.exec(D5048);
  db.exec(VIEW);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM licence_program_agreements WHERE origin = 'backfill_d5048'").get() as any).n, 8);
  for (const raw of rawGrants(db)) {
    assert.deepEqual(await after(db, raw, envelopes), oracle[raw.id], `legacy grant ${raw.id} (${raw.program_key}) reads as the column did`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(oracle).map(([id, o]) => [id, o.status])), {
    20: 'sent', 21: 'signed', 22: 'sent', 23: 'not_sent', 24: 'sent', 25: 'not_sent', 26: 'sent', 27: 'not_sent',
  });
  // The answers come from the agreement rows: with the column emptied, as the drop will leave it, nothing changes.
  const sources = (db.prepare('SELECT grant_id, source FROM program_grant_schedule_envelopes ORDER BY grant_id').all() as any[]).map((r) => [r.grant_id, r.source]);
  assert.deepEqual(sources, [[20, 'agreement'], [21, 'agreement'], [22, 'agreement'], [23, 'agreement'], [24, 'agreement'], [25, 'agreement'], [26, 'agreement'], [27, 'legacy_column']]);
  // A grant written outside the send path after the backfill, its envelope only in the column: the legacy fallback.
  db.prepare(`INSERT INTO program_grants (id, uid, licence_id, program_key, state, schedule_contract_uid, set_at, terms_revision)
              VALUES (28, 'g28', 1, 'product-testing', 'paused', 'env-28', '2026-10-01T00:00:00Z', 1)`).run();
  const g28 = rawGrants(db).find((g) => g.id === 28)!;
  assert.deepEqual(await after(db, g28, envelopes), before(g28, envelopes), 'a grant with no agreement row reads its column');
  assert.equal((await after(db, g28, envelopes)).contract_uid, 'env-28');
  db.prepare('DELETE FROM program_grants WHERE id = 28').run();
  db.prepare('UPDATE program_grants SET schedule_contract_uid = NULL').run();
  for (const raw of rawGrants(db)) {
    const now = await after(db, raw, envelopes);
    assert.deepEqual([now.status, now.contract_uid], [oracle[raw.id].status, oracle[raw.id].contract_uid], `legacy grant ${raw.id} without its column`);
  }
  db.close();
});

test('2b. a backfilled legacy grant reads as sent, then signed, on HQ\'s grant read and the branch copy', async () => {
  const db = fixture(DDL());
  // A grant from before D5048, its schedule only in the column, then backfilled (the migration applies twice).
  db.prepare(`INSERT INTO program_grants (id, uid, licence_id, program_key, state, requires_signed_schedule, schedule_contract_uid, set_at, terms_revision)
              VALUES (40, 'g40', 1, 'learning', 'granted', 1, 'env-40', '2026-10-01T00:00:00Z', 1)`).run();
  db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by)
              VALUES ('env-40', 'program_schedule', 'Program schedule', 'body', ?, 'sent', 1)`).run(SHA('a'));
  db.prepare("INSERT INTO program_grant_schedules (grant_id, revision, terms_hash, envelope_uuid, sent_at) VALUES (40, 1, 'legacy', 'env-40', '2026-10-02T00:00:00Z')").run();
  db.exec(D5048);
  const row = db.prepare("SELECT origin, status, program_grant_id FROM licence_program_agreements WHERE envelope_uuid = 'env-40'").get() as any;
  assert.deepEqual({ ...row }, { origin: 'backfill_d5048', status: 'sent', program_grant_id: 40 });
  db.prepare('UPDATE program_grants SET schedule_contract_uid = NULL WHERE id = 40').run();
  const read = async () => (await call(db, 'GET', `/licences/${LIVE}`)).body.grants.find((g: any) => g.uid === 'g40').schedule;
  assert.deepEqual([(await read()).status, (await read()).contract_uid], ['sent', 'env-40'], 'sent, from the backfilled row alone');
  assert.equal((await programCopy(env(db), 1)).grants[0].schedule_contract_uid, 'env-40');
  // A resend is refused while it is live, from the agreement row.
  assert.deepEqual([(await send(db)).body?.error], ['already_sent']);
  // Its completion signs the grant through the guard on the agreement row.
  assert.equal((await complete(db, 'env-40'))?.changed, true);
  assert.deepEqual([(await read()).status, (await read()).contract_uid], ['signed', 'env-40']);
  db.close();
});

// ═══════════════════════════════════════════════════════════════════ 3

/**
 * Every mention of the column left in the Worker, by file and the text it must contain. Writes keep the column
 * true for the Worker one version back until the drop (D9026 §4); the rest name a field, not the column.
 */
const ALLOWED: Array<{ file: string; text: string; why: string }> = [
  { file: 'routes/admin_program_grants.ts', text: 'paused_at = NULL, ended_at = NULL, schedule_contract_uid = NULL, schedule_signed_at = NULL,', why: 'write: re-grant clears it' },
  { file: 'routes/admin_program_grants.ts', text: '  schedule_contract_uid = NULL, schedule_signed_at = NULL, terms_revision = terms_revision + 1', why: 'write: a terms change clears it' },
  { file: 'routes/admin_program_grants.ts', text: "const RECORD_SCHEDULE = 'UPDATE program_grants SET schedule_contract_uid = ? WHERE", why: 'write: the send names the envelope' },
  { file: 'routes/admin_program_grants.ts', text: "changed: [{ key: 'schedule_contract_uid', before: existing.schedule_envelope_uuid", why: 'the history key, not a read' },
  { file: 'services/programGrants.ts', text: 'export function scheduleStatus(row: { schedule_contract_uid?: unknown;', why: "scheduleStatus's argument: the presented envelope" },
  { file: 'services/programGrants.ts', text: "if (row.schedule_contract_uid) return 'sent';", why: "scheduleStatus's argument: the presented envelope" },
  { file: 'services/programGrants.ts', text: 'scheduleStatus({ schedule_contract_uid: row.schedule_envelope_uuid ?? null,', why: 'presentGrant hands it the agreement row\'s envelope' },
  { file: 'services/licencePrograms.ts', text: "  'schedule_contract_uid', 'schedule_signed_at', 'terms_revision',", why: 'the branch copy\'s field name' },
  { file: 'services/licencePrograms.ts', text: "(k === 'schedule_contract_uid' ? row.schedule_envelope_uuid : row[k])", why: 'the branch copy, filled from the agreement row' },
  { file: 'services/licencePrograms.ts', text: 'schedule_envelope_uuid: row.schedule_envelope_uuid ?? row.schedule_contract_uid ?? null', why: 'a branch reading a copy' },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = resolve(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|js|mjs)$/.test(n) ? [p] : [];
  });
}
/** A file's code with its comments blanked, line numbers kept. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

test('3. no Worker file reads schedule_contract_uid outside the allowlist, and no allowlist entry is stale', () => {
  const SRC = resolve(process.cwd(), 'cloudflare-worker/src');
  const found: string[] = [];
  const used = new Set<number>();
  for (const path of sources(SRC)) {
    const rel = relative(SRC, path);
    const lines = code(readFileSync(path, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('schedule_contract_uid')) return;
      const hits = line.split('schedule_contract_uid').length - 1;
      const entry = ALLOWED.findIndex((a) => a.file === rel && line.includes(a.text));
      // One mention per allowed line; a second on the same line is a new one.
      if (entry < 0 || hits > 1) { found.push(`${rel}:${i + 1}: ${line.trim()}`); return; }
      used.add(entry);
    });
  }
  assert.deepEqual(found, [], 'a new reader of program_grants.schedule_contract_uid: read the schedule envelope with withScheduleEnvelopes');
  assert.deepEqual(ALLOWED.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.text}`), [], 'an allowlist entry no longer matches: remove it');
  // No SQL in the Worker selects or filters on the column: its only SQL mentions are the three writes.
  const sqlReads = ALLOWED.filter((a) => /SELECT|WHERE[^=]*schedule_contract_uid/.test(a.text));
  assert.deepEqual(sqlReads, []);
});
