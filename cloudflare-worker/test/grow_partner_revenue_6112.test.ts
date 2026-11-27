/**
 * D6112 (#6112) — Partner network's record: Enter revenue (a month and an
 * amount in dollars, through `setPartnerRevenue`) and the Revenue by month
 * section, each month with its source.
 *
 *   - Entering a month writes one `partner_revenue` row, typed, and the
 *     record's Revenue sourced, the module table and the module chart read it.
 *   - Typing a typed month again replaces it; a bad month or amount writes nothing.
 *   - A month another source filled keeps its figure and its source: the
 *     record action and the route both refuse (409). Migration 443 allows only
 *     'manual', so the test lifts the CHECK to plant such a row.
 *   - A reader without write access sees the months and no action, and its POST is a 403.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY MIGRATION (`loadSchema`). Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_partner_revenue_6112.test.ts
 */
import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'd6112', 'partner', 'revenue'].join('-');
const FOUNDER = 10, ADVISOR = 12;
const A = 1;
// The form opens on this month and the chart reads the six months before it, so the clock is fixed (D5614).
const NOW = Date.parse('2026-10-18T05:35:00Z');
const MONTH = '2026-10';
const MONTH_LABEL = 'Oct 2026';
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
afterEach(() => mock.timers.reset());

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, name] of [[FOUNDER, 'Ana Wren'], [ADVISOR, 'Dee Advisor']] as const) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare("INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, 'founder', ?, ?, ?, 1)").run(id, name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT INTO growth_partners (id, uid, project_id, name, type, stage, created_by) VALUES (1, 'pt1', ${A}, 'Lantern Resellers', 'reseller', 'signed', ${FOUNDER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, { who = FOUNDER, body }: { who?: number; body?: unknown } = {}) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const rec = (db: DatabaseSync, who = FOUNDER) => call(db, 'GET', `/api/cycles/grow/modules/partner-network/records/pt1?project=${A}`, { who });
const enter = (db: DatabaseSync, body: unknown, who = FOUNDER) =>
  call(db, 'POST', `/api/cycles/grow/modules/partner-network/records/pt1/actions/enter-revenue?project=${A}`, { who, body });
const months = (db: DatabaseSync) => db.prepare('SELECT month, amount_cents, source, recorded_by FROM partner_revenue ORDER BY month').all().map((r) => ({ ...r as any }));
const revenueSection = (r: any) => r.body.main.find((s: any) => s.key === 'revenue');
const revenueFact = (r: any) => r.body.facts.find((f: any) => f.label === 'Revenue sourced');

test('D6112: Enter revenue writes a typed month that the record, the table and the chart read', async () => {
  const db = fixture();
  const before = await rec(db);
  assert.deepEqual(revenueFact(before), { label: 'Revenue sourced', value: null, reason: 'No partner revenue entered' });
  assert.deepEqual(revenueSection(before).rows, []);
  assert.equal(revenueSection(before).empty, 'No month entered.');
  const declared = before.body.actions.find((a: any) => a.key === 'enter-revenue');
  assert.equal(declared.kind, 'form');
  assert.deepEqual(declared.form.fields.map((f: any) => [f.key, f.input ?? null, f.required === true]), [['month', null, true], ['amount', 'money', true]]);
  assert.equal(declared.form.fields[0].value, MONTH, 'the month opens on this one');
  assert.equal(declared.execute, undefined, 'the callback stays on the server');

  const r = await enter(db, { month: MONTH, amount: '$1,200' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(months(db), [{ month: MONTH, amount_cents: 120000, source: 'manual', recorded_by: FOUNDER }]);
  const after = await rec(db);
  assert.equal(revenueFact(after).value, '$1,200');
  assert.deepEqual(revenueSection(after).rows, [{ a: MONTH_LABEL, b: 'typed', c: '$1,200' }]);
  const log = db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'grow_partner_revenue'").get() as any;
  assert.equal(log.n, 1, 'the write is logged as the route logs it');

  const mod = await call(db, 'GET', `/api/cycles/grow/modules/partner-network?project=${A}`);
  assert.equal(mod.status, 200);
  const row = mod.body.records.rows.find((p: any) => p.uid === 'pt1');
  assert.deepEqual([row.revenue_cents, row.revenue_source], [120000, 'manual']);
  assert.deepEqual(mod.body.card.series.revenue.find((m: any) => m.month === MONTH), { month: MONTH, cents: 120000 });
});

test('D6112: typing a typed month again replaces it; a bad month or amount writes nothing', async () => {
  const db = fixture();
  assert.equal((await enter(db, { month: MONTH, amount: '1200' })).status, 200);
  assert.equal((await enter(db, { month: MONTH, amount: '40.50' })).status, 200);
  assert.deepEqual(months(db), [{ month: MONTH, amount_cents: 4050, source: 'manual', recorded_by: FOUNDER }]);
  for (const body of [{ month: MONTH, amount: 'lots' }, { month: MONTH, amount: '-5' }, { month: MONTH, amount: '' }]) {
    const r = await enter(db, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.field, 'amount');
  }
  for (const month of ['2026-13', '2026-1', '', 'October']) {
    const r = await enter(db, { month, amount: '10' });
    assert.equal(r.status, 400, month);
    assert.equal(r.body.field, 'month');
  }
  assert.deepEqual(months(db), [{ month: MONTH, amount_cents: 4050, source: 'manual', recorded_by: FOUNDER }]);
});

test('D6112: a month another source filled keeps its figure and its source', async () => {
  const db = fixture();
  // Migration 443 allows only 'manual'; lift the CHECK to plant the month a connector would fill.
  db.exec('PRAGMA ignore_check_constraints = ON');
  db.exec("INSERT INTO partner_revenue (partner_id, month, amount_cents, source) VALUES (1, '2026-09', 90000, 'mercury')");
  db.exec('PRAGMA ignore_check_constraints = OFF');
  assert.deepEqual(revenueSection(await rec(db)).rows, [{ a: 'Sep 2026', b: 'From Mercury', c: '$900' }]);
  const r = await enter(db, { month: '2026-09', amount: '5' });
  assert.equal(r.status, 409);
  assert.match(r.body.detail, /came from Mercury/);
  const route = await call(db, 'PUT', '/api/cycles/grow/partners/pt1/revenue/2026-09', { body: { project: A, amount_cents: 500 } });
  assert.equal(route.status, 409, 'the route runs the same writer');
  assert.deepEqual(months(db), [{ month: '2026-09', amount_cents: 90000, source: 'mercury', recorded_by: null }]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'grow_partner_revenue'").get() as any).n, 0);
});

test('D6112: a reader without write access sees the months and no action', async () => {
  const db = fixture();
  assert.equal((await enter(db, { month: MONTH, amount: '300' })).status, 200);
  const adv = await rec(db, ADVISOR);
  assert.equal(adv.status, 200);
  assert.deepEqual(adv.body.actions, []);
  assert.deepEqual(revenueSection(adv).rows, [{ a: MONTH_LABEL, b: 'typed', c: '$300' }]);
  assert.equal((await enter(db, { month: MONTH, amount: '1' }, ADVISOR)).status, 403);
  assert.deepEqual(months(db).map((m) => m.amount_cents), [30000]);
});
