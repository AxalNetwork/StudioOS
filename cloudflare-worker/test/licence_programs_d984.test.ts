/**
 * D984 (#2775, part 3 of #2376) — the Administrator's read of their licence's
 * programs, and the dated copy HQ pushes to the licence's branch.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, so migrations 553 and 554 run as they ship. HQ and the branch
 * each get their own database, as they do in production: the branch's copy is
 * built by HQ's own assembler and applied by the branch's own writer. Every
 * studio, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_programs_d984.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import programsRoute from '../src/routes/licence_programs.ts';
import { PROGRAMS } from '../src/services/programGrants.ts';
import { COPY_COLUMNS, UNLINKED_REASON } from '../src/services/licencePrograms.ts';
import { assembleLicenceRecord } from '../src/services/licencePush.ts';
import { applyLicenceCopy } from '../src/rpc/branchOps.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, HOLDER = 2, DELEGATE = 3, HQ_ADMIN = 4, MEMBER = 5, OTHER_HOLDER = 6;
const LIVE = 'lic_live', SECOND = 'lic_second';
const REASON = 'Approved at the October HQ review.';
const PAST = '2026-01-01';

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

function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(HOLDER, 'admin', 'Hana Holder', 'hana@example.test');
  u.run(DELEGATE, 'admin', 'Dan Delegate', 'dan@example.test');
  u.run(HQ_ADMIN, 'admin', 'Hal Hq', 'hal@example.test');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test');
  u.run(OTHER_HOLDER, 'admin', 'Oli Other', 'oli@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, HOLDER, DELEGATE, HQ_ADMIN, MEMBER, OTHER_HOLDER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  return db;
}

/** HQ: two licences, an Administrator and a delegate bound to the first, another holder to the second. */
function hq() {
  const db = database();
  const lic = db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, kind, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  lic.run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'subsidiary', 'active', '2027-10-31');
  lic.run(2, SECOND, 'AXL-002', 'Studio East SAS', 'Studio East', 'subsidiary', 'active', '2027-10-31');
  const la = db.prepare('INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (?, ?, ?)');
  la.run(1, HOLDER, 'principal');
  la.run(1, DELEGATE, 'delegate');
  la.run(2, OTHER_HOLDER, 'principal');
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/program-grants', grantsRoute);
app.route('/api/licence', programsRoute);
app.onError((err, c) => {
  const status = AUTH_ERROR_STATUSES[(err as Error).message];
  return status ? c.json({ error: (err as Error).message }, status) : c.json({ error: 'internal' }, 500);
});

async function call(db: DatabaseSync, who: number | null, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}, d1?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) {
    const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${token}`;
  }
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1 ?? d1Over(db), ...extra } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const mine = (db: DatabaseSync, who: number | null, extra: Record<string, unknown> = {}, d1?: any) =>
  call(db, who, 'GET', '/api/licence/mine/programs', undefined, extra, d1);
const grant = (db: DatabaseSync, uid: string, key: string, body: Record<string, unknown> = {}) =>
  call(db, SUPER, 'POST', `/api/admin/program-grants/licences/${uid}/${key}`, { reason: REASON, ...body });
const byKey = (programs: any[]) => Object.fromEntries(programs.map((p) => [p.program_key, p]));
const signSchedule = (db: DatabaseSync, key: string) =>
  db.prepare("UPDATE program_grants SET schedule_signed_at = '2026-02-01T00:00:00Z' WHERE licence_id = 1 AND program_key = ?").run(key);

/** HQ's copy of licence 1, through HQ's own assembler, applied by the branch's own writer. */
async function pushTo(branch: DatabaseSync, from: DatabaseSync, pushedAt: string) {
  const licence = from.prepare('SELECT * FROM territory_licences WHERE id = 1').get() as any;
  const record = await assembleLicenceRecord({ DB: d1Over(from) } as any, licence, pushedAt);
  await applyLicenceCopy({ DB: d1Over(branch), BRANCH_CODE: 'fr' } as any, record);
  return record;
}
const BRANCH = { BRANCH_CODE: 'fr', APP_URL: 'https://fr.example.test', PUBLIC_BASE_URL: 'https://fr.example.test' };

test('554 adds the copy column to branch_licence, nullable, and nothing else', () => {
  const cols = (database().prepare("SELECT name, \"notnull\" AS nn, dflt_value FROM pragma_table_info('branch_licence') WHERE name = 'program_grants_json'").all() as any[]);
  assert.deepEqual(cols.map((c) => [c.name, c.nn, c.dflt_value]), [['program_grants_json', 0, null]]);
  const sql = readFileSync(resolve(MIGRATIONS, '554_branch_program_grants.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.deepEqual(sql.split(';').map((s) => s.trim()).filter(Boolean), ['ALTER TABLE branch_licence ADD COLUMN program_grants_json TEXT']);
});

test('on HQ, the Administrator reads the nine programs in order, each in its own word, from the store', async () => {
  const db = hq();
  await call(db, SUPER, 'PUT', '/api/admin/program-grants/defaults/perks', { reason: REASON, grantable: false });
  assert.equal((await grant(db, LIVE, 'learning', { terms: { capacity_cap: 60, starts_on: PAST, fee_cents: 200000, currency: 'EUR' }, note: 'Report enrolments each quarter.' })).status, 201);
  assert.equal((await grant(db, LIVE, 'spinout-lab', { terms: { starts_on: PAST } })).status, 201);
  signSchedule(db, 'spinout-lab');
  assert.equal((await grant(db, LIVE, 'mentor-cohorts')).status, 201);
  assert.equal((await call(db, SUPER, 'POST', `/api/admin/program-grants/licences/${LIVE}/mentor-cohorts/pause`, { reason: REASON })).status, 200);
  assert.equal((await grant(db, LIVE, 'referral-partners')).status, 201);
  assert.equal((await call(db, SUPER, 'POST', `/api/admin/program-grants/licences/${LIVE}/referral-partners/end`, { reason: REASON })).status, 200);
  assert.equal((await grant(db, SECOND, 'refer-and-earn')).status, 201, 'another licence\'s grant');

  const r = await mine(db, HOLDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.linked, true);
  assert.equal(r.body.source, 'hq');
  assert.equal(r.body.as_of, null, 'HQ reads its own store, so there is no copy to date');
  assert.deepEqual(r.body.licence, { uid: LIVE, licence_ref: 'AXL-001', brand_name: 'Studio North', kind: 'subsidiary', status: 'active' });
  assert.deepEqual(r.body.programs.map((p: any) => p.program_key), PROGRAMS.map((p) => p.key));
  const p = byKey(r.body.programs);
  assert.deepEqual(Object.fromEntries(r.body.programs.map((x: any) => [x.program_key, x.standing])), {
    'spinout-lab': 'in_force',
    'ai-native-venture': 'not_offered',
    'mentor-cohorts': 'paused',
    'investor-cohorts': 'not_offered',
    'referral-partners': 'ended',
    'refer-and-earn': 'not_recorded',
    perks: 'switched_off',
    learning: 'granted',
    'product-testing': 'hq_only',
  });
  assert.equal(p['refer-and-earn'].word, 'Not recorded', 'another licence\'s grant is not this one\'s, and no row is never "Not granted"');
  assert.equal(p['refer-and-earn'].grant, null);
  assert.equal(p.perks.word, 'Not offered');
  assert.equal(p['product-testing'].word, 'Runs at HQ');
  assert.equal(p.learning.word, 'Granted, not in force yet');
  assert.deepEqual(p.learning.grant.waiting_on, ['schedule_signed']);
  assert.equal(p.learning.grant.terms.capacity_cap, 60);
  assert.equal(p.learning.grant.terms.fee_cents, 200000);
  assert.equal(p.learning.grant.terms.hq_share_bps, null, 'a term nobody set is null, read "Not recorded"');
  assert.equal(p.learning.grant.note, 'Report enrolments each quarter.');
  assert.equal(p.learning.grant.effective_end, null);
  assert.equal(p['spinout-lab'].grant.in_force, true);
  assert.equal(p['spinout-lab'].grant.schedule.signed_at, '2026-02-01T00:00:00Z');
  for (const x of r.body.programs.filter((y: any) => y.grant)) {
    assert.equal('set_by_user_id' in x.grant, false, 'who at HQ set it is HQ\'s record');
  }
  assert.ok(!JSON.stringify(r.body).includes('@example.test'), 'no email in the answer');

  const d = await mine(db, DELEGATE);
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.programs, r.body.programs, 'a delegate reads the same licence');
  const o = byKey((await mine(db, OTHER_HOLDER)).body.programs);
  assert.equal(o['refer-and-earn'].standing, 'granted', 'each Administrator reads their own licence');
  assert.equal(o.learning.standing, 'not_recorded');
});

test('a suspended licence\'s grants are not in force, and say they wait on the licence', async () => {
  const db = hq();
  await grant(db, LIVE, 'spinout-lab', { terms: { starts_on: PAST } });
  signSchedule(db, 'spinout-lab');
  db.prepare("UPDATE territory_licences SET status = 'suspended' WHERE id = 1").run();
  const p = byKey((await mine(db, HOLDER)).body.programs);
  assert.equal(p['spinout-lab'].standing, 'granted');
  assert.deepEqual(p['spinout-lab'].grant.waiting_on, ['licence_active']);
});

test('an account no licence binds reads its own answer: HQ runs every program, never an empty list or a 404', async () => {
  const db = hq();
  for (const who of [HQ_ADMIN, MEMBER]) {
    const r = await mine(db, who);
    assert.equal(r.status, 200, String(who));
    assert.equal(r.body.linked, false);
    assert.equal(r.body.licence, null);
    assert.equal(r.body.reason, UNLINKED_REASON);
    assert.equal(r.body.reason, 'Your account is not linked to a licence. On HQ-held accounts, HQ runs every program.');
    assert.deepEqual(r.body.programs.map((p: any) => [p.program_key, p.standing]), PROGRAMS.map((p) => [p.key, 'hq_runs']));
  }
});

test('the read refuses an anonymous caller, and a D1 failure is a 503, never an empty list', async () => {
  const db = hq();
  assert.equal((await mine(db, null)).status, 401);
  const DB = d1Over(db);
  const faulty = { ...DB, prepare(sql: string) { if (/FROM program_grants WHERE licence_id/.test(sql)) throw new Error('Synthetic read failure'); return DB.prepare(sql); } };
  const r = await mine(db, HOLDER, {}, faulty);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'licence_programs_unreadable');
  assert.match(r.body.message, /not the same as none/);
  assert.ok(!JSON.stringify(r.body).includes('Synthetic'), 'the raw error is logged, not answered');
});

test('the copy HQ assembles carries the rows and what HQ grants, without who set them; a store that cannot be read omits it', async () => {
  const db = hq();
  await grant(db, LIVE, 'learning', { terms: { starts_on: PAST } });
  const licence = db.prepare('SELECT * FROM territory_licences WHERE id = 1').get() as any;
  const record = await assembleLicenceRecord({ DB: d1Over(db) } as any, licence, '2026-10-20T10:00:00Z');
  const copy = JSON.parse(String(record.program_grants_json));
  assert.deepEqual(Object.keys(copy).sort(), ['grants', 'offered']);
  assert.equal(copy.grants.length, 1);
  assert.deepEqual(Object.keys(copy.grants[0]), COPY_COLUMNS);
  assert.equal(copy.grants[0].program_key, 'learning');
  assert.equal('set_by_user_id' in copy.grants[0], false);
  assert.equal('licence_id' in copy.grants[0], false);
  assert.equal(copy.offered.learning, true);
  assert.equal(copy.offered['product-testing'], false);

  const DB = d1Over(db);
  const faulty = { ...DB, prepare(sql: string) { if (/FROM program_grants WHERE licence_id/.test(sql)) throw new Error('Synthetic read failure'); return DB.prepare(sql); } };
  const saved = console.warn; console.warn = () => {};
  try {
    const without = await assembleLicenceRecord({ DB: faulty } as any, licence, '2026-10-20T10:00:00Z');
    assert.equal('program_grants_json' in without, false, 'omitted, so the branch keeps what it has, never an empty set');
    assert.equal(without.licence_uid, LIVE, 'and the rest of the copy still goes');
  } finally { console.warn = saved; }
});

test('on a branch, an admin reads the programs from HQ\'s dated copy, with its age, and in force by the branch\'s own day', async () => {
  const head = hq();
  await grant(head, LIVE, 'spinout-lab', { terms: { starts_on: PAST, cohorts_per_year: 2 } });
  signSchedule(head, 'spinout-lab');
  await grant(head, LIVE, 'learning', { terms: { starts_on: '2999-01-01' } });
  const branch = database();
  await pushTo(branch, head, '2026-10-20T10:00:00Z');

  const r = await mine(branch, HOLDER, BRANCH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.source, 'copy');
  assert.equal(r.body.as_of, '2026-10-20T10:00:00Z', 'HQ\'s time for the copy, not the branch\'s write');
  assert.ok(r.body.age_seconds > 0);
  assert.equal(r.body.licence.uid, LIVE);
  const p = byKey(r.body.programs);
  assert.equal(p['spinout-lab'].standing, 'in_force');
  assert.equal(p['spinout-lab'].grant.terms.cohorts_per_year, 2);
  assert.equal(p.learning.standing, 'granted');
  assert.deepEqual(p.learning.grant.waiting_on, ['schedule_signed', 'start_date']);
  assert.equal(p['refer-and-earn'].standing, 'not_recorded');
  assert.equal(p['product-testing'].standing, 'hq_only');
  // The same answer HQ gives the same Administrator, but for the copy's date.
  const fromHq = await mine(head, HOLDER);
  assert.deepEqual(r.body.programs, fromHq.body.programs);
});

test('on a branch, a member is refused, and a copy not sent yet or unreadable says so', async () => {
  const head = hq();
  const branch = database();
  assert.equal((await mine(branch, MEMBER, BRANCH)).status, 403, 'the copy carries HQ\'s fees: admins only, as GET /mine');

  const none = await mine(branch, HOLDER, BRANCH);
  assert.equal(none.status, 200);
  assert.equal(none.body.programs, null);
  assert.match(none.body.reason, /holds no copy of its licence yet/);

  await pushTo(branch, head, '2026-10-20T10:00:00Z');
  branch.prepare('UPDATE branch_licence SET program_grants_json = NULL').run();
  const unsent = await mine(branch, HOLDER, BRANCH);
  assert.equal(unsent.status, 200);
  assert.equal(unsent.body.programs, null, 'not sent is not "none granted"');
  assert.equal(unsent.body.as_of, '2026-10-20T10:00:00Z');
  assert.match(unsent.body.reason, /has not sent this branch its programs yet/);

  branch.prepare("UPDATE branch_licence SET program_grants_json = '{\"grants\": 3}'").run();
  const bad = await mine(branch, HOLDER, BRANCH);
  assert.equal(bad.status, 503);
  assert.equal(bad.body.error, 'licence_programs_unreadable');
});

test('an older push arriving late never overwrites a newer copy of the programs', async () => {
  const head = hq();
  const branch = database();
  await grant(head, LIVE, 'learning', { terms: { starts_on: PAST } });
  const newer = await pushTo(branch, head, '2026-10-20T10:00:00Z');
  const older = { ...newer, pushed_at: '2026-10-19T10:00:00Z', program_grants_json: JSON.stringify({ grants: [], offered: {} }) };
  await applyLicenceCopy({ DB: d1Over(branch), BRANCH_CODE: 'fr' } as any, older);
  const row = branch.prepare('SELECT pushed_at, program_grants_json FROM branch_licence WHERE id = 1').get() as any;
  assert.equal(row.pushed_at, '2026-10-20T10:00:00Z');
  assert.equal(JSON.parse(row.program_grants_json).grants.length, 1);
});

test('each grant write pushes the licence, and the branch\'s binding receives the programs', async () => {
  const db = hq();
  db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name) VALUES (?, 'fr', 'fr.example.test', 'studioos-fr', 'studioos-fr-db')").run(LIVE);
  const seen: any[] = [];
  const binding = { applyLicence: async (record: any) => { seen.push(record); return { applied: true }; } };
  const send = (method: string, path: string, body: Record<string, unknown> = {}) =>
    call(db, SUPER, method, `/api/admin/program-grants/licences/${LIVE}/learning${path}`, { reason: REASON, ...body }, { BRANCH_FR: binding });
  const steps: Array<[string, string, Record<string, unknown>, string]> = [
    ['POST', '', {}, 'granted'],
    ['PATCH', '', { terms: { capacity_cap: 30 } }, 'granted'],
    ['POST', '/pause', {}, 'paused'],
    ['POST', '/resume', {}, 'granted'],
    ['POST', '/end', {}, 'ended'],
  ];
  for (const [method, path, body, state] of steps) {
    const r = await send(method, path, body);
    assert.ok([200, 201].includes(r.status), `${method} ${path} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.pushed.ok, true, `${method} ${path} pushed`);
    const copy = JSON.parse(seen[seen.length - 1].program_grants_json);
    assert.equal(copy.grants.find((g: any) => g.program_key === 'learning').state, state, `${method} ${path} carries the new state`);
  }
  assert.equal(seen.length, steps.length);
  assert.equal(JSON.parse(seen[1].program_grants_json).grants[0].capacity_cap, 30);
  // No branch for the second licence: the write stands and says nothing landed.
  const r = await grant(db, SECOND, 'learning');
  assert.equal(r.status, 201);
  assert.equal(r.body.pushed.ok, false);
  assert.equal(r.body.pushed.code, null);
});
