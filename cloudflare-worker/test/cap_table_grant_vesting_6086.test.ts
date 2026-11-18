/**
 * D6086 (#6086) — a vesting schedule recorded with an option grant, without
 * Carta: the owner records it, a co-founder's proposal carries it to the
 * owner's Accept, Void removes the plan's row with the grant, Carta's record
 * refuses it, and the equity plan reads it back with vested worked out from
 * the dates on a given day.
 *
 * Real SQL: the baseline and every migration (`loadSchema`), synthetic people
 * and figures only. No clock: every "today" is a fixed date.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_grant_vesting_6086.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { equityPlanBody, monthsElapsed, vestedOnSchedule } from '../src/services/capTableRegister.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6086-0123456789';
const OWNER = 4, COFOUNDER = 5, ADMIN = 1;

function fresh() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES
      (1, 'u-1', 'admin@example.test', 'Synthetic Admin', 'admin', NULL, 1, 'studio'),
      (4, 'u-4', 'owner@example.test', 'Synthetic Owner', 'founder', 40, 1, 'studio'),
      (5, 'u-5', 'cofounder@example.test', 'Synthetic Cofounder', 'founder', 50, 1, 'studio');
    INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (10, 5, 'cofounder', 'accepted');
    INSERT INTO cap_table_holders (id, user_id, project_id, name, kind) VALUES (101, 4, 10, 'Synthetic Engineer', 'employee');
  `);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}
const all = (f: any, sql: string, ...args: any[]) => f.db.prepare(sql).all(...args) as any[];

const SCHEDULE = { start_date: '2026-03-01', total_months: 48, cliff_months: 12 };

async function pool(f: any) {
  const r = await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Synthetic Plan', kind: 'option_pool', authorized_shares: 100_000 });
  assert.equal(r.status, 201, r.text);
  return r.body.class.uid as string;
}
const grant = (poolUid: string, extra: Record<string, unknown> = {}) => ({ kind: 'grant', holder_id: 101, class_uid: poolUid, shares: 48_000, issued_on: '2026-03-01', ...extra });
const planRows = (f: any) => all(f, 'SELECT project_id, holder_id, user_id, start_date, total_months, cliff_months, total_shares, vested_shares, source, issuance_id FROM cap_table_vesting ORDER BY id');

test('the owner records a grant with its schedule: the issuance carries it and the plan gets one row tied to it', async () => {
  const f = fresh();
  const uid = await pool(f);
  const r = await call(f, OWNER, '/record/10/issuances', 'POST', grant(uid, { vesting: SCHEDULE }));
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body.issuance.vesting, SCHEDULE, 'the answer carries the schedule');
  const id = all(f, 'SELECT id FROM cap_table_issuances WHERE uid = ?', r.body.issuance.uid)[0].id;
  assert.deepEqual(planRows(f).map((x) => ({ ...x })), [{
    project_id: 10, holder_id: 101, user_id: OWNER, start_date: '2026-03-01', total_months: 48, cliff_months: 12,
    total_shares: 48_000, vested_shares: null, source: 'manual', issuance_id: id,
  }], 'one plan row, on the holder’s account, with the grant’s options and no stored vested count');
  const rec = await call(f, OWNER, '/record/10');
  assert.deepEqual(rec.body.issuances.rows.find((x: any) => x.uid === r.body.issuance.uid).vesting, SCHEDULE, 'the record reads it back');

  const plan = await call(f, OWNER, '/equity-plan?project_id=10');
  assert.equal(plan.status, 200, plan.text);
  const g = plan.body.grants[0];
  assert.equal(g.issuance_uid, r.body.issuance.uid, 'the plan names the grant it came from');
  assert.equal(g.vested_basis, 'schedule');
  assert.match(g.vested_as_of, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(g.vested_shares, vestedOnSchedule(g, g.vested_as_of), 'vested is the schedule’s on the day the answer names');
  assert.equal(g.unvested_shares, 48_000 - g.vested_shares);
});

test('a grant recorded without a schedule writes no plan row, and a schedule is refused on any other kind', async () => {
  const f = fresh();
  const uid = await pool(f);
  assert.equal((await call(f, OWNER, '/record/10/issuances', 'POST', grant(uid))).status, 201);
  assert.equal(planRows(f).length, 0);
  const rec = await call(f, OWNER, '/record/10');
  assert.equal(rec.body.issuances.rows[0].vesting, null, 'a grant with no schedule says so');
  const common = (await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Common', kind: 'common' })).body.class.uid;
  const founding = await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'founding', holder_id: 101, class_uid: common, shares: 10, issued_on: '2026-01-01', vesting: SCHEDULE });
  assert.equal(founding.status, 400);
  assert.equal(founding.body.error, 'bad_vesting');
  assert.equal(all(f, "SELECT COUNT(*) AS n FROM cap_table_issuances WHERE kind = 'founding'")[0].n, 0, 'nothing is written');
});

test('a schedule the record cannot hold is refused before anything is written', async () => {
  const f = fresh();
  const uid = await pool(f);
  for (const vesting of [
    { ...SCHEDULE, cliff_months: 60 },
    { ...SCHEDULE, start_date: '2026-02-30' },
    { ...SCHEDULE, total_months: 601 },
    { ...SCHEDULE, total_months: 0 },
    { start_date: '2026-03-01', total_months: 48 },
  ]) {
    const r = await call(f, OWNER, '/record/10/issuances', 'POST', grant(uid, { vesting }));
    assert.equal(r.status, 400, JSON.stringify(vesting));
    assert.equal(r.body.error, 'bad_vesting', JSON.stringify(vesting));
  }
  assert.equal(all(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances')[0].n, 0);
  assert.equal(all(f, 'SELECT COUNT(*) AS n FROM cap_table_issuance_vesting')[0].n, 0);
  assert.equal(planRows(f).length, 0);
  const edge = await call(f, OWNER, '/record/10/issuances', 'POST', grant(uid, { vesting: { ...SCHEDULE, total_months: 600, cliff_months: 600 } }));
  assert.equal(edge.status, 201, 'a cliff as long as the schedule, at the longest length, is a schedule');
});

test('a co-founder’s proposal carries its schedule to the owner’s Accept; nothing reaches the plan before', async () => {
  const f = fresh();
  const uid = await pool(f);
  const p = await call(f, COFOUNDER, '/record/10/proposals', 'POST', grant(uid, { issued_on: null, vesting: SCHEDULE }));
  assert.equal(p.status, 201, p.text);
  assert.deepEqual(p.body.issuance.vesting, SCHEDULE);
  assert.equal(planRows(f).length, 0, 'a proposal changes nothing on the plan');
  const rec = await call(f, OWNER, '/record/10');
  assert.deepEqual(rec.body.proposals.rows[0].vesting, SCHEDULE, 'the owner reads the schedule on the proposal');

  const blank = await call(f, OWNER, `/record/10/proposals/${p.body.issuance.uid}/accept`, 'POST', {});
  assert.equal(blank.status, 400, 'Granted on is still blank');
  assert.equal(planRows(f).length, 0);
  const ok = await call(f, OWNER, `/record/10/proposals/${p.body.issuance.uid}/accept`, 'POST', { issued_on: '2026-03-01' });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body.issuance.vesting, SCHEDULE);
  const rows = planRows(f);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].start_date, rows[0].total_months, rows[0].cliff_months, rows[0].total_shares], ['2026-03-01', 48, 12, 48_000]);
});

test('the Accept may change the schedule, or clear it', async () => {
  const f = fresh();
  const uid = await pool(f);
  const a = (await call(f, COFOUNDER, '/record/10/proposals', 'POST', grant(uid, { vesting: SCHEDULE }))).body.issuance.uid;
  const changed = await call(f, OWNER, `/record/10/proposals/${a}/accept`, 'POST', { vesting: { start_date: '2026-04-01', total_months: 36, cliff_months: 0 } });
  assert.equal(changed.status, 200, changed.text);
  assert.deepEqual(changed.body.issuance.vesting, { start_date: '2026-04-01', total_months: 36, cliff_months: 0 });
  assert.deepEqual([planRows(f)[0].start_date, planRows(f)[0].total_months, planRows(f)[0].cliff_months], ['2026-04-01', 36, 0]);

  const b = (await call(f, COFOUNDER, '/record/10/proposals', 'POST', grant(uid, { vesting: SCHEDULE }))).body.issuance.uid;
  const cleared = await call(f, OWNER, `/record/10/proposals/${b}/accept`, 'POST', { vesting: null });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.body.issuance.vesting, null);
  assert.equal(planRows(f).length, 1, 'the cleared grant has no plan row');
  assert.equal(all(f, 'SELECT COUNT(*) AS n FROM cap_table_issuance_vesting')[0].n, 1);
});

test('a dismissed proposal never reaches the plan', async () => {
  const f = fresh();
  const uid = await pool(f);
  const p = (await call(f, COFOUNDER, '/record/10/proposals', 'POST', grant(uid, { vesting: SCHEDULE }))).body.issuance.uid;
  assert.equal((await call(f, OWNER, `/record/10/proposals/${p}/dismiss`, 'POST', {})).status, 200);
  assert.equal(planRows(f).length, 0);
});

test('Void removes the plan’s row with the grant; the struck-through row keeps its schedule', async () => {
  const f = fresh();
  const uid = await pool(f);
  const keep = (await call(f, OWNER, '/record/10/issuances', 'POST', grant(uid, { shares: 1_000, vesting: SCHEDULE }))).body.issuance.uid;
  const gone = (await call(f, OWNER, '/record/10/issuances', 'POST', grant(uid, { vesting: SCHEDULE }))).body.issuance.uid;
  assert.equal(planRows(f).length, 2);
  const v = await call(f, OWNER, `/record/10/issuances/${gone}/void`, 'POST', { reason: 'Recorded twice.' });
  assert.equal(v.status, 200, v.text);
  const left = planRows(f);
  assert.equal(left.length, 1, 'only the voided grant’s row goes');
  assert.equal(left[0].issuance_id, all(f, 'SELECT id FROM cap_table_issuances WHERE uid = ?', keep)[0].id);
  assert.deepEqual(v.body.issuance.vesting, SCHEDULE, 'History still shows what the void row carried');
  const plan = await call(f, OWNER, '/equity-plan?project_id=10');
  assert.deepEqual(plan.body.grants.map((g: any) => g.issuance_uid), [keep]);
});

test('while Carta is the record, a schedule is refused and nothing is written', async () => {
  const f = fresh();
  const uid = await pool(f);
  f.db.exec(`INSERT INTO cap_table_vesting (user_id, project_id, holder_id, start_date, total_shares, vested_shares, source)
    VALUES (4, 10, NULL, '2025-01-01', 100, 50, 'connector_carta')`);
  for (const [who, path] of [[OWNER, '/record/10/issuances'], [COFOUNDER, '/record/10/proposals']] as const) {
    const r = await call(f, who, path, 'POST', grant(uid, { vesting: SCHEDULE }));
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body.error, 'carta_is_record');
  }
  assert.equal(all(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances')[0].n, 0);
  assert.equal(planRows(f).length, 1, 'only Carta’s row');
  assert.equal((await call(f, OWNER, '/record/10/issuances', 'POST', grant(uid))).status, 201, 'a grant without a schedule still records');
});

test('an admin’s schedule without the reason the founder reads is refused, and nothing reaches the plan', async () => {
  const f = fresh();
  const uid = await pool(f);
  const bare = await call(f, ADMIN, '/record/10/issuances', 'POST', grant(uid, { vesting: SCHEDULE }));
  assert.equal(bare.status, 400, bare.text);
  assert.equal(bare.body.error, 'reason_required');
  assert.equal(planRows(f).length, 0);
});

test('vested from the dates: nothing before the cliff, the months since the start at it, then monthly to the total', () => {
  const v = { start_date: '2026-03-01', total_months: 48, cliff_months: 12, total_shares: 48_000 };
  assert.equal(vestedOnSchedule(v, '2026-02-01'), 0, 'before the start');
  assert.equal(vestedOnSchedule(v, '2027-02-28'), 0, 'a day before the cliff');
  assert.equal(vestedOnSchedule(v, '2027-03-01'), 12_000, 'the cliff');
  assert.equal(vestedOnSchedule(v, '2027-04-01'), 13_000);
  assert.equal(vestedOnSchedule(v, '2030-02-28'), 47_000);
  assert.equal(vestedOnSchedule(v, '2030-03-01'), 48_000, 'all of it at the end');
  assert.equal(vestedOnSchedule(v, '2040-01-01'), 48_000, 'never more than the total');
  assert.equal(vestedOnSchedule({ ...v, cliff_months: 0 }, '2026-04-01'), 1_000, 'no cliff vests monthly from the first month');
  assert.equal(vestedOnSchedule({ ...v, total_shares: 1_000, total_months: 3, cliff_months: 0 }, '2026-04-01'), 333, 'rounded down');
  assert.equal(vestedOnSchedule({ ...v, total_months: null }, '2027-03-01'), null, 'an incomplete schedule is not 0');
  assert.equal(vestedOnSchedule({ ...v, total_shares: null }, '2027-03-01'), null);
  assert.equal(monthsElapsed('2026-01-31', '2026-02-28'), 1, 'a month ends on the last day of a shorter month');
  assert.equal(monthsElapsed('2026-01-31', '2026-02-27'), 0);
  assert.equal(monthsElapsed('2028-01-31', '2028-02-29'), 1, 'a leap February');
  assert.equal(monthsElapsed('2026-03-15', '2026-04-14'), 0);
  assert.equal(monthsElapsed('2026-03-15', '2026-04-15'), 1);
});

test('the plan keeps a stored count (Carta’s as imported) and works out only what StudioOS holds without one', () => {
  const base = { id: 1, holder_id: 1, security_id: null, start_date: '2026-03-01', cliff_months: 12, total_months: 48, total_shares: 48_000, updated_at: null };
  const body = equityPlanBody([], [
    { ...base, id: 1, vested_shares: null, source: 'manual' },
    { ...base, id: 2, vested_shares: 5, source: 'connector_carta' },
    { ...base, id: 3, vested_shares: null, source: 'connector_carta' },
    { ...base, id: 4, vested_shares: 7, source: 'manual' },
  ], '2027-03-01');
  assert.deepEqual(body.grants.map((g: any) => [g.id, g.vested_shares, g.vested_basis, g.vested_as_of]), [
    [1, 12_000, 'schedule', '2027-03-01'], [2, 5, 'recorded', null], [3, null, null, null], [4, 7, 'recorded', null],
  ]);
  assert.deepEqual(body.grants.map((g: any) => g.unvested_shares), [36_000, 47_995, null, 47_993]);
  assert.equal(body.summary.vested_shares, null, 'one row has no vested count, so there is no total');
  const two = equityPlanBody([], [{ ...base, vested_shares: null, source: 'manual' }, { ...base, id: 2, vested_shares: 5, source: 'connector_carta' }], '2027-03-01');
  assert.deepEqual([two.summary.granted_shares, two.summary.vested_shares, two.summary.unvested_shares], [96_000, 12_005, 83_995]);
  const noDay = equityPlanBody([], [{ ...base, vested_shares: null, source: 'manual' }]);
  assert.equal(noDay.grants[0].vested_shares, null, 'without a day nothing is worked out');
});
