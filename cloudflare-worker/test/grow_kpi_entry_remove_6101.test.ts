/**
 * D6101 (#6101) — remove a KPI typed with the wrong value.
 *
 *   1  History lists each hand entry with its day and a Remove (a row action
 *      with the entry's id), and a connected source's last figure each month
 *      with none; Remove is declared `row_only`, so no header button.
 *   2  Removing a typed MRR entry: the KPI table, the record, the Overview and
 *      a report draft read the next latest value; a sent report's frozen
 *      figures do not change; activity keeps who removed it and when; a row
 *      holding another KPI keeps it.
 *   3  A connected source's figure (Stripe) is refused (409,
 *      `kpi_entry_connected`) and nothing changes; a missing, foreign or
 *      empty entry is refused with its own code.
 *   4  A custom KPI's hand entry is removed from `custom_kpi_values`; a
 *      connector's value of it is refused.
 *   5  Writers only: an advisor (a reader) sees no Remove on a row and is
 *      refused the action; another venture's founder is refused.
 *   6  Removing a Burn entry moves Runway: it crosses a Runway alert, and
 *      removing the other way clears one.
 *
 * The database is the baseline plus every migration, with foreign keys on, as
 * D1 runs them. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_kpi_entry_remove_6101.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { growFigures } from '../src/services/growCycle.ts';
import { assembleReport } from '../src/services/reportFigures.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'd6101', 'kpi', 'remove'].join('-');
const FOUNDER = 10, OTHER_FOUNDER = 20, ADVISOR = 12;
const A = 1, B = 2;
const PEOPLE: Array<[number, string]> = [[FOUNDER, 'Ana Wren'], [OTHER_FOUNDER, 'Ola Kestrel'], [ADVISOR, 'Dee Advisor']];
const DAY = 86_400_000;
// The record route, the KPI table and the alert check read the real clock (the 35-day Stripe window), so the days are relative to it.
const NOW = Date.now(); // clock-ok: relative
const ago = (days: number) => new Date(NOW - days * DAY).toISOString().slice(0, 10);
const FROZEN = JSON.stringify([{ key: 'mrr', label: 'MRR', value: 9000, as_of: ago(2) }]);

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, name] of PEOPLE) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare("INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, 'founder', ?, ?, ?, 1)").run(id, name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Kestrel Mill', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  // MRR: an older hand entry, the wrong one two days ago (with Customers on the same manual row), and a stale Stripe row.
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, mrr, paying_accounts, source, created_by) VALUES
    (1, ${A}, '${ago(9)}', 4000, NULL, 'manual', ${FOUNDER}),
    (2, ${A}, '${ago(2)}', 9000, 12, 'manual', ${FOUNDER}),
    (3, ${A}, '2026-01-20', 3000, NULL, 'stripe', NULL),
    (4, ${A}, '2026-01-05', 2900, NULL, 'stripe', NULL),
    (5, ${B}, '${ago(2)}', 7000, NULL, 'manual', ${OTHER_FOUNDER})`);
  // A report already sent froze 9,000.
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, sent_at, figures_json) VALUES ('up-1', ?, ?, 'October', 'submitted', ?, ?)`)
    .run(A, FOUNDER, `${ago(1)} 10:00:00`, FROZEN);
  db.exec(`INSERT INTO custom_kpis (id, uid, project_id, label, unit) VALUES (1, 'kpa1', ${A}, 'Subscribers', 'count')`);
  db.exec(`INSERT INTO custom_kpi_values (uid, kpi_id, as_of, value, source, created_by) VALUES
    ('cv-old', 1, '${ago(10)}', 300, 'manual', ${FOUNDER}),
    ('cv-typo', 1, '${ago(3)}', 30000, 'manual', ${FOUNDER}),
    ('cv-feed', 1, '${ago(5)}', 310, 'beehiiv', NULL)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
const envOf = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' }) as any;

async function call(db: DatabaseSync, method: string, path: string, { who = FOUNDER, body, project = A }: { who?: number; body?: unknown; project?: number } = {}) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await withThrownResponses(() => app.request(`${path}${sep}project=${project}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, envOf(db)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const rec = (db: DatabaseSync, id: string, who = FOUNDER) => call(db, 'GET', `/api/cycles/grow/modules/revenue-and-traction/records/${id}`, { who });
const remove = (db: DatabaseSync, id: string, entry: unknown, who = FOUNDER, project = A) =>
  call(db, 'POST', `/api/cycles/grow/modules/revenue-and-traction/records/${id}/actions/remove-entry`, { who, body: entry === undefined ? {} : { entry }, project });
const history = (r: any) => r.body.main.find((s: any) => s.key === 'history').rows;
const kpiTable = async (db: DatabaseSync, id: string) =>
  (await call(db, 'GET', '/api/cycles/grow/modules/revenue-and-traction')).body.records.rows.find((r: any) => r.id === id);
const logged = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT user_id, created_at, details FROM activity_logs WHERE entity_type = 'grow.revenue-and-traction' AND entity_id = ? AND action = 'grow_kpi_entry_removed'")
    .all(id).map((row) => ({ ...row })) as any[];

test('1: History lists each hand entry with its day and a Remove; a connected source has none', async () => {
  const db = fixture();
  const r = await rec(db, 'mrr');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(history(r), [
    { a: ago(2), b: '$9,000', c: 'By hand', tone: 'grey', action: { key: 'remove-entry', body: { entry: '2' } } },
    { a: ago(9), b: '$4,000', c: 'By hand', tone: 'grey', action: { key: 'remove-entry', body: { entry: '1' } } },
    // Stripe writes a row a day, so History keeps its last figure each month.
    { a: '2026-01-20', b: '$3,000', c: 'stripe', tone: 'vio' },
  ]);
  const action = r.body.actions.find((a: any) => a.key === 'remove-entry');
  assert.equal(action.kind, 'write');
  assert.equal(action.tone, 'danger');
  assert.equal(action.row_only, true);
  assert.equal(action.confirm.title, 'Remove this MRR entry?');
  // Runway is derived: no entries, no Remove, its months as before.
  const runway = await rec(db, 'runway');
  assert.equal(runway.body.actions.some((a: any) => a.key === 'remove-entry'), false);
});

test('2: removing the wrong MRR re-reads the next latest everywhere; a sent report keeps its figures; activity keeps who and when', async () => {
  const db = fixture();
  assert.equal((await kpiTable(db, 'mrr')).value, 9000);
  // An MRR alert the wrong figure kept quiet.
  db.exec(`INSERT INTO kpi_alerts (uid, project_id, kpi_key, measure, op, threshold_cents, created_by) VALUES ('al-mrr', ${A}, 'mrr', 'value', 'below', 500000, ${FOUNDER})`);
  const r = await remove(db, 'mrr', '2');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, record: { id: 'mrr', entry: '2', as_of: ago(2), value: 9000, removed: true } });
  // The KPI table and the record read the next latest hand entry.
  const row = await kpiTable(db, 'mrr');
  assert.equal(row.value, 4000);
  assert.equal(row.as_of, ago(9));
  assert.equal((await rec(db, 'mrr')).body.facts[0].value, '$4,000');
  // The KPI's own alert is checked at once: $4,000 is below $5,000.
  assert.ok((db.prepare("SELECT last_crossed_at FROM kpi_alerts WHERE uid = 'al-mrr'").get() as any).last_crossed_at, 'the MRR alert is crossed');
  // The Overview figure and a report draft read it too.
  const env = envOf(db);
  const overview = (await growFigures({ env, projectId: A, now: NOW, href: (s: string) => s } as any)).find((f: any) => f.key === 'mrr') as any;
  assert.equal(overview.value, 4000);
  const draft = await assembleReport(env, A, { start: ago(30), end: ago(0) }, ago(0));
  assert.equal(draft.figures.find((f) => f.key === 'mrr')!.value, 4000);
  // The sent report's frozen figures are untouched.
  assert.equal((db.prepare("SELECT figures_json FROM portfolio_updates WHERE uid = 'up-1'").get() as any).figures_json, FROZEN);
  // The row still holds Customers, so only its MRR went.
  assert.deepEqual({ ...db.prepare('SELECT mrr, paying_accounts FROM project_metrics WHERE id = 2').get() as any }, { mrr: null, paying_accounts: 12 });
  // Activity: who and when, on the KPI's record.
  const log = logged(db, 'mrr');
  assert.equal(log.length, 1);
  assert.equal(log[0].user_id, FOUNDER);
  assert.match(String(log[0].created_at), /^\d{4}-\d{2}-\d{2}/);
  assert.match(String(log[0].details), /Hand entry removed: \$9,000 for /);
  const activity = (await rec(db, 'mrr')).body.activity;
  assert.ok(activity.some((a: any) => /Hand entry removed/.test(JSON.stringify(a))), JSON.stringify(activity));
  // A hand entry alone on its row takes the row with it.
  assert.equal((await remove(db, 'mrr', '1')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_metrics WHERE id = 1').get()!.n, 0);
});

test('3: a connected source\'s figure is refused; a missing, foreign or empty entry has its own code', async () => {
  const db = fixture();
  const r = await remove(db, 'mrr', '3');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'kpi_entry_connected');
  assert.match(r.body.detail, /comes from stripe, a connected source/);
  assert.equal((db.prepare('SELECT mrr FROM project_metrics WHERE id = 3').get() as any).mrr, 3000);
  assert.equal(logged(db, 'mrr').length, 0);
  // Another venture's row, an entry with no MRR, a non-number and none at all.
  for (const [entry, status, code] of [['5', 404, 'kpi_entry_not_found'], ['999', 404, 'kpi_entry_not_found'], ['1 OR 1=1', 404, 'kpi_entry_not_found'], [undefined, 400, 'kpi_entry_required']] as const) {
    const x = await remove(db, 'mrr', entry);
    assert.equal(x.status, status, `${entry}`);
    assert.equal(x.body.code, code, `${entry}`);
  }
  assert.equal((db.prepare('SELECT mrr FROM project_metrics WHERE id = 5').get() as any).mrr, 7000);
  // An entry of Customers is not one of MRR's: row 1 holds no Customers.
  assert.equal((await remove(db, 'paying_accounts', '1')).body.code, 'kpi_entry_not_found');
});

test('4: a custom KPI\'s hand entry is removed from custom_kpi_values; a connector\'s value is refused', async () => {
  const db = fixture();
  const before = await rec(db, 'custom-kpa1');
  assert.deepEqual(history(before).map((r: any) => [r.b, r.c, r.action?.body?.entry ?? null]),
    [['30,000', 'By hand', 'cv-typo'], ['310', 'beehiiv', null], ['300', 'By hand', 'cv-old']]);
  const refused = await remove(db, 'custom-kpa1', 'cv-feed');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'kpi_entry_connected');
  const r = await remove(db, 'custom-kpa1', 'cv-typo');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM custom_kpi_values WHERE uid = 'cv-typo'").get()!.n, 0);
  assert.equal((await kpiTable(db, 'custom-kpa1')).value, 310);
  assert.equal(logged(db, 'custom-kpa1').length, 1);
});

test('5: writers only', async () => {
  const db = fixture();
  const read = await rec(db, 'mrr', ADVISOR);
  assert.equal(read.status, 200);
  assert.ok(history(read).every((r: any) => r.action === undefined), 'a reader sees no Remove');
  assert.deepEqual(read.body.actions, []);
  assert.equal((await remove(db, 'mrr', '2', ADVISOR)).status, 403);
  assert.equal((await remove(db, 'mrr', '2', OTHER_FOUNDER)).status, 403);
  assert.equal((db.prepare('SELECT mrr FROM project_metrics WHERE id = 2').get() as any).mrr, 9000);
  assert.equal(logged(db, 'mrr').length, 0);
});

test('6: removing a Burn entry moves Runway across its alert, and back', async () => {
  const db = fixture();
  // Cash 60,000. Burn 5,000 (12 months), then 20,000 typed in error (3 months).
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, cash_balance, source, created_by) VALUES (20, ${A}, '${ago(20)}', 60000, 'manual', ${FOUNDER})`);
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, net_burn, source, created_by) VALUES
    (21, ${A}, '${ago(15)}', 5000, NULL, ${FOUNDER}), (22, ${A}, '${ago(4)}', 20000, 'manual', ${FOUNDER})`);
  db.exec(`INSERT INTO kpi_alerts (uid, project_id, kpi_key, measure, op, threshold, created_by, last_crossed_at) VALUES
    ('al-runway', ${A}, 'runway', 'value', 'below', 6, ${FOUNDER}, '${ago(4)}T09:00:00.000Z')`);
  const crossed = () => (db.prepare("SELECT last_crossed_at FROM kpi_alerts WHERE uid = 'al-runway'").get() as any).last_crossed_at;
  assert.equal((await kpiTable(db, 'runway')).value, 3);
  // Removing the 20,000 brings Runway back to 12 months: the alert is cleared, so it re-arms.
  assert.equal((await remove(db, 'net_burn', '22')).status, 200);
  assert.equal((await kpiTable(db, 'runway')).value, 12);
  assert.equal(crossed(), null);
  // The other way: a 5,000 typed over a true 20,000. Removing it crosses the alert, which notifies once.
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, net_burn, source, created_by) VALUES
    (23, ${A}, '${ago(3)}', 20000, 'mercury', NULL), (24, ${A}, '${ago(1)}', 5000, 'manual', ${FOUNDER})`);
  assert.equal((await kpiTable(db, 'runway')).value, 12);
  assert.equal((await remove(db, 'net_burn', '24')).status, 200);
  assert.equal((await kpiTable(db, 'runway')).value, 3);
  assert.ok(crossed(), 'the Runway alert is crossed');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'grow_kpi_alert'").get(FOUNDER)!.n, 1);
  // A NULL-source burn is a founder's own entry (migration 249), so it is removable; Mercury's is not.
  assert.equal((await remove(db, 'net_burn', '23')).body.code, 'kpi_entry_connected');
  assert.equal((await remove(db, 'net_burn', '21')).status, 200);
});
