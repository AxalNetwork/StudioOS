/**
 * D982 (#2773, part 1 of #2376) — the program grant store, HQ's reads and its
 * step-up writes.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, so migration 553 runs as it ships and the routes' SQL runs
 * against production's columns. Every studio, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_grants_d982.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute, { SQL_TERM_COLUMNS } from '../src/routes/admin_program_grants.ts';
import { PROGRAMS, TERM_KEYS, termsFor, validateTerms } from '../src/services/programGrants.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, PLAIN_ADMIN = 2;
const LIVE = 'lic_live', SUSPENDED = 'lic_susp', ENDED = 'lic_term', DRAFT = 'lic_draft', PENDING = 'lic_pend';
const REASON = 'Approved at the October HQ review.';

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

/** Migration 553's seed rows, which a schema-only replay leaves out. */
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
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN_ADMIN]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const lic = db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)');
  lic.run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31');
  lic.run(2, SUSPENDED, 'AXL-002', 'Studio East SAS', 'Studio East', 'suspended', '2027-10-31');
  lic.run(3, ENDED, 'AXL-003', 'Studio West SAS', 'Studio West', 'terminated', null);
  lic.run(4, DRAFT, 'AXL-004', 'Studio South SAS', 'Studio South', 'draft', null);
  lic.run(5, PENDING, 'AXL-005', 'Studio Isle SAS', 'Studio Isle', 'pending_activation', null);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/program-grants', grantsRoute);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/program-grants${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const grant = (db: DatabaseSync, uid: string, key: string, body: Record<string, unknown> = {}, who = SUPER) =>
  call(db, who, 'POST', `/licences/${uid}/${key}`, { reason: REASON, ...body });
const events = (db: DatabaseSync) => (db.prepare("SELECT licence_id, detail_json, note, actor_user_id FROM licence_events WHERE event = 'program_changed' ORDER BY id").all() as any[])
  .map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));

test('the programs are the frontend grid\'s nine, in its order and readiness', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/lib/programGrants.js'), 'utf8');
  const fe = [...src.matchAll(/\{ key: '([a-z-]+)', name: '([^']+)', group: '([^']+)', grant: '(yes|hq|notready)'/g)].map((m) => [m[1], m[2], m[3], m[4]]);
  assert.equal(fe.length, 9);
  assert.deepEqual(PROGRAMS.map((p) => [p.key, p.name, p.group, p.readiness]), fe);
  // The migration's CHECK names the same keys.
  const sql = readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8');
  for (const p of PROGRAMS) assert.ok(sql.includes(`'${p.key}'`), p.key);
});

test('the written-out SQL names the term columns in TERM_KEYS order', () => {
  assert.equal(SQL_TERM_COLUMNS, TERM_KEYS.join(', '));
});

test('a fresh store: every program\'s defaults are Not recorded but the flag and the schedule rule, and the locked three are off', async () => {
  const db = fixture();
  const { status, body } = await call(db, SUPER, 'GET', '/defaults');
  assert.equal(status, 200);
  assert.deepEqual(body.programs.map((p: any) => p.program_key), PROGRAMS.map((p) => p.key));
  for (const p of body.programs) {
    const locked = ['product-testing', 'ai-native-venture', 'investor-cohorts'].includes(p.program_key);
    assert.equal(p.grantable, !locked, p.program_key);
    assert.equal(Boolean(p.locked_reason), locked, p.program_key);
    for (const [k, v] of Object.entries(p.terms)) {
      assert.equal(v, k === 'requires_signed_schedule' ? 1 : null, `${p.program_key}.${k} starts Not recorded`);
    }
  }
});

test('grant: defaults fill the terms, what HQ names wins, and one program_changed event records it', async () => {
  const db = fixture();
  await call(db, SUPER, 'PUT', '/defaults/learning', { reason: REASON, terms: { fee_cents: 200000, currency: 'eur', reporting: 'quarterly' } });
  const r = await grant(db, LIVE, 'learning', { terms: { capacity_cap: 60, starts_on: '2026-11-01', ends_with_licence: true }, note: 'Report enrolments each quarter.' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const g = r.body.grant;
  assert.equal(g.state, 'granted');
  assert.equal(g.terms.fee_cents, 200000, 'from the defaults');
  assert.equal(g.terms.currency, 'EUR');
  assert.equal(g.terms.reporting, 'quarterly');
  assert.equal(g.terms.capacity_cap, 60, 'what HQ named');
  assert.equal(g.terms.requires_signed_schedule, 1, 'starts only when the schedule is signed: on by default');
  assert.equal(g.terms.hq_share_bps, null, 'a term nobody set reads null, not 0');
  assert.equal(g.terms.credits_per_quarter, undefined, 'credits do not apply to Learning, so they are not a term of it');
  assert.equal(g.effective_end, '2027-10-31', 'ends with the licence term');
  assert.equal(g.in_force, false);
  assert.deepEqual(g.waiting_on, ['schedule_signed', 'start_date'].filter((w) => w !== 'start_date' || '2026-11-01' > new Date().toISOString().slice(0, 10)));
  assert.equal(g.note, 'Report enrolments each quarter.');
  const ev = events(db);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].licence_id, 1);
  assert.equal(ev[0].note, REASON);
  assert.equal(ev[0].actor_user_id, SUPER);
  assert.equal(ev[0].detail.action, 'granted');
  assert.equal(ev[0].detail.program_key, 'learning');
  assert.ok(ev[0].detail.changed.some((x: any) => x.key === 'capacity_cap' && x.after === 60));
});

test('refusals: a locked program, a switched-off one, a frozen licence, a duplicate, a bad term and a short reason', async () => {
  const db = fixture();
  for (const key of ['product-testing', 'ai-native-venture', 'investor-cohorts']) {
    const r = await grant(db, LIVE, key);
    assert.equal(r.status, 422, key);
    assert.equal(r.body.error, 'not_grantable', key);
  }
  await call(db, SUPER, 'PUT', '/defaults/perks', { reason: REASON, grantable: false });
  assert.equal((await grant(db, LIVE, 'perks')).body.error, 'not_grantable', 'switched off in the defaults');
  for (const uid of [SUSPENDED, ENDED, DRAFT]) {
    const r = await grant(db, uid, 'learning');
    assert.equal(r.status, 409, uid);
    assert.equal(r.body.error, 'licence_frozen', uid);
  }
  assert.equal((await grant(db, PENDING, 'learning')).status, 201, 'a pending licence may be granted; the grant waits for activation');
  assert.equal((await grant(db, LIVE, 'learning')).status, 201);
  const dup = await grant(db, LIVE, 'learning');
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'already_granted');
  const bad = await grant(db, LIVE, 'spinout-lab', { terms: { credits_per_quarter: 300 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /credits_per_quarter does not apply to Spin-Out Lab/);
  assert.equal((await grant(db, LIVE, 'spinout-lab', { terms: { hq_share_bps: 10001 } })).body.error, 'invalid_terms');
  assert.equal((await grant(db, LIVE, 'spinout-lab', { terms: { capacity_cap: 0 } })).body.error, 'invalid_terms');
  assert.equal((await grant(db, LIVE, 'spinout-lab', { terms: { capacity_cap: 10, capacity_uncapped: true } })).body.error, 'invalid_terms');
  assert.equal((await grant(db, LIVE, 'spinout-lab', { terms: { brand: 'other' } })).body.error, 'invalid_terms');
  assert.equal((await grant(db, LIVE, 'spinout-lab', { reason: 'too short' })).body.error, 'reason_required');
  assert.equal((await grant(db, LIVE, 'nope')).status, 404);
  assert.equal((await grant(db, 'lic_missing', 'learning')).status, 404);
  assert.equal(events(db).length, 2, 'only the two grants that landed are recorded');
});

test('who may write: a plain admin is refused, and so is a stale step-up; reads need the Super Admin too', async () => {
  const db = fixture();
  assert.equal((await grant(db, LIVE, 'learning', {}, PLAIN_ADMIN)).status, 403);
  assert.equal((await call(db, PLAIN_ADMIN, 'GET', '')).status, 403);
  assert.equal((await call(db, PLAIN_ADMIN, 'GET', `/licences/${LIVE}`)).status, 403);
  assert.equal((await call(db, PLAIN_ADMIN, 'PUT', '/defaults/perks', { reason: REASON, grantable: false })).status, 403);
  db.prepare("UPDATE user_sessions SET created_at = datetime('now', '-3 hours') WHERE user_id = ?").run(SUPER);
  assert.equal((await grant(db, LIVE, 'learning')).status, 403, 'a stale step-up is refused');
  assert.equal((await call(db, SUPER, 'GET', '')).status, 200, 'a read needs no fresh step-up');
  assert.equal(events(db).length, 0);
});

test('change terms: only the named keys change, null clears one, and the event carries before and after', async () => {
  const db = fixture();
  await grant(db, LIVE, 'refer-and-earn', { terms: { credits_per_quarter: 300, hq_share_bps: 1000 } });
  const r = await call(db, SUPER, 'PATCH', `/licences/${LIVE}/refer-and-earn`, { reason: 'Referral volume doubled since July.', terms: { credits_per_quarter: 400, hq_share_bps: null } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.grant.terms.credits_per_quarter, 400);
  assert.equal(r.body.grant.terms.hq_share_bps, null);
  assert.deepEqual(r.body.changed, [{ key: 'credits_per_quarter', before: 300, after: 400 }, { key: 'hq_share_bps', before: 1000, after: null }]);
  const ev = events(db).at(-1)!;
  assert.equal(ev.detail.action, 'terms_changed');
  assert.equal(ev.note, 'Referral volume doubled since July.');
  const same = await call(db, SUPER, 'PATCH', `/licences/${LIVE}/refer-and-earn`, { reason: REASON, terms: { credits_per_quarter: 400 } });
  assert.equal(same.body.error, 'no_change');
  assert.equal((await call(db, SUPER, 'PATCH', `/licences/${LIVE}/perks`, { reason: REASON, terms: { credits_per_quarter: 1 } })).body.error, 'not_granted');
});

test('pause, resume and end, each from the states it may leave; a suspended licence may be paused and ended, never resumed', async () => {
  const db = fixture();
  await grant(db, LIVE, 'perks');
  const act = (uid: string, key: string, verb: string) => call(db, SUPER, 'POST', `/licences/${uid}/${key}/${verb}`, { reason: REASON });
  assert.equal((await act(LIVE, 'perks', 'resume')).body.error, 'wrong_state', 'nothing to resume');
  const paused = await act(LIVE, 'perks', 'pause');
  assert.equal(paused.status, 200);
  assert.equal(paused.body.grant.state, 'paused');
  assert.ok(paused.body.grant.paused_at);
  assert.equal(paused.body.grant.in_force, false);
  assert.equal((await act(LIVE, 'perks', 'pause')).body.error, 'wrong_state');
  const resumed = await act(LIVE, 'perks', 'resume');
  assert.equal(resumed.body.grant.state, 'granted');
  assert.equal(resumed.body.grant.paused_at, null);
  const ended = await act(LIVE, 'perks', 'end');
  assert.equal(ended.body.grant.state, 'ended');
  assert.ok(ended.body.grant.ended_at);
  assert.equal((await act(LIVE, 'perks', 'end')).body.error, 'wrong_state');
  // An ended grant may be granted again: the same row, fresh terms.
  const again = await grant(db, LIVE, 'perks', { terms: { credits_per_quarter: 50 } });
  assert.equal(again.status, 200);
  assert.equal(again.body.grant.state, 'granted');
  assert.equal(again.body.grant.ended_at, null);
  assert.deepEqual(events(db).map((e) => e.detail.action), ['granted', 'paused', 'resumed', 'ended', 'regranted']);
  // The freeze: a suspended licence's grant may be paused and ended; resume and change are refused.
  db.prepare("UPDATE territory_licences SET status = 'suspended' WHERE uid = ?").run(LIVE);
  assert.equal((await act(LIVE, 'perks', 'pause')).status, 200, 'pause stays open');
  assert.equal((await act(LIVE, 'perks', 'resume')).body.error, 'licence_frozen');
  assert.equal((await call(db, SUPER, 'PATCH', `/licences/${LIVE}/perks`, { reason: REASON, terms: { credits_per_quarter: 9 } })).body.error, 'licence_frozen');
  assert.equal((await act(LIVE, 'perks', 'end')).status, 200, 'end stays open');
});

test('a grant is in force only when the licence is active, its schedule is signed and its dates hold', async () => {
  const db = fixture();
  await grant(db, LIVE, 'spinout-lab', { terms: { starts_on: '2020-01-01' } });
  const read = async () => (await call(db, SUPER, 'GET', `/licences/${LIVE}`)).body.grants.find((g: any) => g.program_key === 'spinout-lab');
  assert.deepEqual((await read()).waiting_on, ['schedule_signed']);
  db.prepare("UPDATE program_grants SET schedule_signed_at = '2026-10-02T10:00:00Z' WHERE program_key = 'spinout-lab'").run();
  assert.equal((await read()).in_force, true);
  db.prepare("UPDATE program_grants SET ends_on = '2021-01-01' WHERE program_key = 'spinout-lab'").run();
  assert.deepEqual((await read()).waiting_on, ['ended_by_date']);
  db.prepare("UPDATE program_grants SET ends_on = NULL, schedule_signed_at = NULL, requires_signed_schedule = 0 WHERE program_key = 'spinout-lab'").run();
  assert.equal((await read()).in_force, true, 'HQ switched the schedule rule off for this grant');
  db.prepare("UPDATE program_grants SET requires_signed_schedule = NULL WHERE program_key = 'spinout-lab'").run();
  assert.equal((await read()).in_force, false, 'a rule nobody recorded is treated as on');
});

test('the grid: rows leave out drafts and terminated licences, and the tiles and series count only what is stored', async () => {
  const db = fixture();
  await grant(db, LIVE, 'perks', { terms: { fee_cents: 200000, currency: 'EUR' } });
  await grant(db, LIVE, 'learning', { terms: { fee_cents: 100000, currency: 'EUR', ends_on: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) } });
  await grant(db, LIVE, 'spinout-lab');
  await grant(db, PENDING, 'perks', { terms: { fee_cents: 50000, currency: 'USD' } });
  await call(db, SUPER, 'POST', `/licences/${LIVE}/spinout-lab/pause`, { reason: REASON });
  const { status, body } = await call(db, SUPER, 'GET', '');
  assert.equal(status, 200);
  assert.deepEqual(body.licences.map((l: any) => l.uid), [LIVE, SUSPENDED, PENDING]);
  assert.deepEqual(Object.keys(body.licences[0].grants).sort(), ['learning', 'perks', 'spinout-lab']);
  assert.equal(body.tiles.granted, 3);
  assert.equal(body.tiles.paused, 1);
  assert.equal(body.tiles.in_force, 0, 'no schedule is signed, so nothing is in force yet');
  assert.equal(body.tiles.ending_in_90_days, 1);
  assert.deepEqual(body.tiles.fees_a_year, [{ currency: 'EUR', cents: 300000 }, { currency: 'USD', cents: 50000 }]);
  assert.equal(body.tiles.fees_not_recorded, 0);
  // D983 (#2774) reads the requests: none raised here is a measured 0, with six months on the axis.
  assert.equal(body.tiles.requests_waiting, 0);
  assert.equal(body.tiles.requests_waiting_reason, null);
  assert.equal(body.series.requests_by_month.length, 6);
  const perks = body.series.holding.find((h: any) => h.program_key === 'perks');
  assert.deepEqual([perks.granted, perks.paused], [2, 0]);
  const lab = body.series.holding.find((h: any) => h.program_key === 'spinout-lab');
  assert.deepEqual([lab.granted, lab.paused], [0, 1]);
  assert.equal(body.programs.length, 9);
});

test('history: one licence\'s program events, newest first, filterable by program; defaults go to the admin audit log', async () => {
  const db = fixture();
  await grant(db, LIVE, 'perks');
  await grant(db, LIVE, 'learning');
  await call(db, SUPER, 'POST', `/licences/${LIVE}/perks/pause`, { reason: 'Paused for the quarter.' });
  const all = await call(db, SUPER, 'GET', `/licences/${LIVE}/history`);
  assert.deepEqual(all.body.history.map((h: any) => [h.action, h.program_key]), [['paused', 'perks'], ['granted', 'learning'], ['granted', 'perks']]);
  assert.equal(all.body.history[0].reason, 'Paused for the quarter.');
  assert.equal(all.body.history[0].actor_name, 'Sue Super');
  const perks = await call(db, SUPER, 'GET', `/licences/${LIVE}/history?program=perks`);
  assert.equal(perks.body.history.length, 2);
  const d = await call(db, SUPER, 'PUT', '/defaults/mentor-cohorts', { reason: REASON, terms: { cohorts_per_year: 12 } });
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.changed, [{ key: 'cohorts_per_year', before: null, after: 12 }]);
  const audit = db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action = 'program_grant_defaults_changed'").all() as any[];
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].filters_json).program_key, 'mentor-cohorts');
  assert.equal(events(db).length, 3, 'a defaults change is not a licence event');
});

test('defaults: the locked three cannot be switched on; a term only the grant carries is refused', async () => {
  const db = fixture();
  for (const key of ['product-testing', 'ai-native-venture', 'investor-cohorts']) {
    const r = await call(db, SUPER, 'PUT', `/defaults/${key}`, { reason: REASON, grantable: true });
    assert.equal(r.status, 422, key);
  }
  assert.equal((await call(db, SUPER, 'PUT', '/defaults/perks', { reason: REASON, terms: { starts_on: '2026-01-01' } })).body.error, 'invalid_terms');
  assert.equal((await call(db, SUPER, 'PUT', '/defaults/perks', { reason: 'short' })).body.error, 'reason_required');
});

test('a D1 failure is a 5xx, never an empty grid', async () => {
  const db = fixture();
  db.exec('DROP TABLE program_grants');
  const r = await call(db, SUPER, 'GET', '');
  assert.ok(r.status >= 500, String(r.status));
});

test('the readiness refusal holds even if a locked program\u2019s defaults row says it can be granted', async () => {
  const db = fixture();
  db.exec("UPDATE program_grant_defaults SET grantable = 1 WHERE program_key IN ('product-testing', 'investor-cohorts')");
  for (const key of ['product-testing', 'investor-cohorts']) {
    const r = await grant(db, LIVE, key);
    assert.equal(r.status, 422, key);
    assert.match(r.body.message, /stays at HQ|not ready to grant/, key);
  }
});

test('a pending licence\u2019s grant waits for activation; ending in 90 days counts only ends inside the window', async () => {
  const db = fixture();
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await grant(db, PENDING, 'perks', { terms: { requires_signed_schedule: false } });
  const pend = (await call(db, SUPER, 'GET', `/licences/${PENDING}`)).body.grants[0];
  assert.deepEqual(pend.waiting_on, ['licence_active']);
  assert.equal(pend.in_force, false);
  await grant(db, LIVE, 'perks', { terms: { ends_on: day(200) } });
  await grant(db, LIVE, 'learning', { terms: { ends_on: day(-5) } });
  await grant(db, LIVE, 'spinout-lab', { terms: { ends_on: day(89) } });
  const tiles = (await call(db, SUPER, 'GET', '')).body.tiles;
  assert.equal(tiles.ending_in_90_days, 1, 'one end inside the window; one past it, one already passed');
});

test('migration 553 restores the licence_events seal on the full chain, and the history kind is admitted', () => {
  const db = fixture();
  const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'licence_events' ORDER BY name").all() as any[]).map((t) => t.name);
  assert.deepEqual(triggers, ['licence_events_block_delete', 'licence_events_block_update']);
  db.prepare("INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id) VALUES (1, 'program_changed', '{}', 'r', 1)").run();
  assert.throws(() => db.exec("UPDATE licence_events SET note = 'x'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM licence_events'), /append-only/);
  assert.throws(() => db.prepare("INSERT INTO licence_events (licence_id, event) VALUES (1, 'not_a_kind')").run(), /CHECK/);
});

test('migration 553 keeps every licence event the rebuild copies', () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF && migrationNumber(n) < 553)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  db.exec("INSERT INTO users (id, role, name, email) VALUES (9, 'admin', 'A', 'a@example.test')");
  db.exec("INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (1, 'u', 'R', 'E', 'B', 'active')");
  db.exec("INSERT INTO licence_events (id, licence_id, event, note, actor_user_id) VALUES (41, 1, 'created', 'n', 9), (42, 1, 'contract_sent', NULL, 9)");
  db.exec(readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8'));
  const rows = db.prepare('SELECT id, event, note FROM licence_events ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => [r.id, r.event, r.note]), [[41, 'created', 'n'], [42, 'contract_sent', null]]);
});

test('validateTerms: each program takes only its own terms', () => {
  for (const p of PROGRAMS) {
    for (const k of TERM_KEYS) {
      const r = validateTerms(p.key, { [k]: null });
      assert.equal(r.ok, termsFor(p.key).includes(k), `${p.key}.${k}`);
    }
  }
  assert.deepEqual(validateTerms('learning', { currency: 'gbp', ends_with_licence: false }), { ok: true, terms: { currency: 'GBP', ends_with_licence: 0 } });
  assert.equal(validateTerms('learning', { starts_on: '2026-02-30x' }).ok, false);
  assert.equal(validateTerms('learning', { fee_cents: 1.5 }).ok, false);
  assert.equal(validateTerms('learning', ['x']).ok, false);
});
