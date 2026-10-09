/**
 * D664 (#1477) — the Grow stores (migration 443) and /api/cycles/grow, on real
 * SQLite over the DDL that creates each table: `compliance_events` as
 * production has it (`schema_baseline.sql`, not migration 034's), 119, 127 + 166 (contacts), 132 (job board), 311 (revenue ledger), 326 (team
 * roster), 437 (Share an update) and 443.
 *
 * Every card and records table is checked through D661's own rules
 * (`frontend/src/pages/cycles/cycleModel.js`), so the read is the shape the
 * cycle pages draw.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/cycle_grow_d664.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow, { shapeRecords } from '../src/routes/cycle_grow.ts';
import revenue from '../src/routes/revenue.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { billingPeriods, cohortRetention, computeMovements, type LedgerRecurring } from '../src/services/revenueMovements.ts';
import { readiness, utmSource, planMonth, movementGap, DURABILITY_ITEMS } from '../src/services/growCycle.ts';
// @ts-ignore — plain JS, D661's rules for what the cycle pages draw.
import { cardView, cellView, drawableSeries, figureValue } from '../../frontend/src/pages/cycles/cycleModel.js';
import { landReply } from '../src/services/updateShare.ts';
import { STRIPE_NO_CUSTOMER } from '../src/services/revenueLedger.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const M = resolve(here, '../sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1; const ADVISOR = 2; const STRANGER = 3;
const PID = 7;

const BASELINE = readFileSync(resolve(here, '../sql/schema_baseline.sql'), 'utf8');
/** One table's CREATE statement as production has it. */
const baseline = (table: string) => BASELINE.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))![0];
const file = (p: string) => readFileSync(resolve(M, readdirSync(M).find((f) => f.startsWith(`${p}_`))!), 'utf8');
const ddl = (p: string) => file(p).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const row = (customer: string, amount: number, on: string, verification: LedgerRecurring['verification'] = 'verified'): LedgerRecurring =>
  ({ customer, amount_cents: amount, received_on: on, verification });

// ── Movements ───────────────────────────────────────────────────────────────

test('churn with fewer than two billing periods is not recorded: no movement, never 0', () => {
  const one = [row('Acme', 1000, '2026-09-03'), row('Beta', 500, '2026-09-10')];
  assert.equal(billingPeriods(one), 1);
  assert.deepEqual(computeMovements(one), [], 'one billing period: nothing to compare');
  assert.equal(billingPeriods([]), 0);
  // A gap month is not a churned month.
  const gap = [row('Acme', 1000, '2026-07-03'), row('Acme', 1000, '2026-09-03')];
  assert.deepEqual(computeMovements(gap), [], 'August holds no rows: September is not compared with an empty month');
});

test('new, expansion and churned split by customer when the rows can tell them apart', () => {
  const rows = [
    row('Acme', 1000, '2026-08-03'), row('Beta', 500, '2026-08-05'), row('Gone', 300, '2026-08-07', 'manual'),
    row('Acme', 1400, '2026-09-03'), row('Beta', 400, '2026-09-05'), row('New Co', 200, '2026-09-09'),
  ];
  const by = Object.fromEntries(computeMovements(rows).map((m) => [m.kind, m]));
  assert.deepEqual([by.new.amount_cents, by.new.customers], [200, 1]);
  assert.deepEqual([by.expansion.amount_cents, by.expansion.customers], [400, 1]);
  assert.deepEqual([by.churned.amount_cents, by.churned.customers], [400, 1], 'Gone lost 300 and is the one churned customer; Beta shrank by 100, which is not');
  assert.equal(by.new.source, 'manual', 'the weakest proof level of the rows behind it');
  assert.equal(by.new.as_of, '2026-09-09');
  assert.equal(by.unsplit, undefined);
});

test('expansion is not split from new when a month holds a Stripe charge with no customer', () => {
  const rows = [row('Acme', 1000, '2026-08-03'), row('Acme', 1000, '2026-09-03'), row(STRIPE_NO_CUSTOMER, 700, '2026-09-04')];
  const mv = computeMovements(rows);
  assert.deepEqual(mv.map((m) => [m.kind, m.amount_cents]), [['unsplit', 700]]);
  assert.ok(!mv.some((m) => m.kind === 'expansion' || m.kind === 'new' || m.kind === 'churned'));
});

test('cohort retention follows identified customers; a month with no rows is null, not 0%', () => {
  const rows = [row('Acme', 1, '2026-07-01'), row('Beta', 1, '2026-07-02'), row('Acme', 1, '2026-08-01'), row('Acme', 1, '2026-10-01')];
  assert.deepEqual(cohortRetention(rows), [{ cohort: '2026-07', size: 2, retention: [100, 50, null, 50] }]);
  // A month whose only charge names no customer is not recorded either, not 0%.
  const anon = [row('Acme', 1, '2026-07-01'), row(STRIPE_NO_CUSTOMER, 1, '2026-08-01'), row('Acme', 1, '2026-09-01')];
  assert.deepEqual(cohortRetention(anon), [{ cohort: '2026-07', size: 1, retention: [100, null, 100] }]);
});

test('churn needs two billings, and two in a row: a gap month is not a second period', () => {
  assert.equal(movementGap([row('Acme', 1, '2026-07-01')]), 'Needs 2 billings');
  assert.equal(movementGap([row('Acme', 1, '2026-07-01'), row('Acme', 1, '2026-09-01')]), 'Not recorded: no two billing months in a row');
  assert.equal(movementGap([row('Acme', 1, '2026-08-01'), row('Acme', 1, '2026-09-01')]), null);
});

test('a hiring plan names its month: a date, a month, a quarter or a half', () => {
  assert.deepEqual(['2027-03', '2027-03-31', 'Q1 2027', '2027 Q4', 'q2 2027', 'H2 2027', 'next year'].map(planMonth),
    ['2027-03', '2027-03', '2027-03', '2027-12', '2027-06', '2027-12', null]);
});

// ── The shared read ─────────────────────────────────────────────────────────

test('a market\'s readiness is out of 40 only when all four parts are scored; the weakest part names a gap first', () => {
  const m: any = { demand_score: 8, demand_source: 's', regulation_score: null, regulation_source: null, partners_score: 5, partners_source: 's', cost_score: 4, cost_source: 's' };
  assert.deepEqual(readiness(m), { score: null, weakest: 'Regulation', missing: ['Regulation'] });
  assert.deepEqual(readiness({ ...m, regulation_score: 6, regulation_source: 's' }), { score: 23, weakest: 'Cost to enter', missing: [] });
  assert.equal(utmSource('{"utm_source":" LinkedIn "}'), 'linkedin');
  assert.equal(utmSource('not json'), null);
});

test('records: search, several field filters and sort; a missing value sorts last, never as 0', () => {
  const rows = [{ name: 'A', cac: 300 }, { name: 'B', cac: null }, { name: 'C', cac: 120 }].map((raw) => ({ raw }));
  assert.deepEqual(shapeRecords(rows, '', '', 'cac').map((r) => r.raw.name), ['C', 'A', 'B']);
  assert.deepEqual(shapeRecords(rows, '', '', '-cac').map((r) => r.raw.name), ['A', 'C', 'B']);
  assert.deepEqual(shapeRecords(rows, 'b', '', '').map((r) => r.raw.name), ['B']);
  const fb = [{ status: 'open', source: 'customer' }, { status: 'open', source: 'team' }, { status: 'shipped', source: 'customer' }].map((raw) => ({ raw }));
  assert.equal(shapeRecords(fb, '', 'status:open,source:customer', '').length, 1, 'every pair must match');
  assert.equal(shapeRecords(fb, '', 'status:SHIPPED', '').length, 1);
});

// ── The routes ──────────────────────────────────────────────────────────────

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
           CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT);
           CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER, email TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')));
           CREATE TABLE spinout_lab_milestones (id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT);`);
  db.exec(baseline('compliance_events'));
  for (const p of ['119', '127', '132', '326']) db.exec(ddl(p));
  db.exec(file('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(ddl('125')); db.exec(file('437'));
  db.exec(file('443'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  u.run(ADVISOR, 'founder', 20, 'Ada', 'ada@co.example');
  u.run(STRANGER, 'founder', 30, 'Sam', 'sam@else.example');
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, 'p7', 'Venture', 10, 70)`).run(PID);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')`).run(PID, ADVISOR);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensureProjectMetricsSchema(env);
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/revenue', revenue);
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, ctx as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}
const overview = (f: any, who = FOUNDER) => call(f, who, 'GET', `/api/cycles/grow/overview?project=${PID}`);
const module_ = (f: any, slug: string, qs = '') => call(f, FOUNDER, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}${qs}`);

/** A module read's rows as `{ id, [colKey]: cell text }`, through D661's `cellView`. */
const table = (records: any) => {
  assert.ok(records.cols.every((c: any) => typeof c.key === 'string' && typeof c.label === 'string' && c.label), 'cols are [{ key, label }]');
  return records.rows.map((r: any) => ({ id: r.id, ...Object.fromEntries(records.cols.map((c: any) => [c.key, cellView(r.cells[c.key]).text])) }));
};
const cardOf = async (f: any, slug: string) => (await overview(f)).body.cards.find((c: any) => c.slug === slug);

test('the overview: the question, four figures and seven cards in tab order; an empty venture is empty or not recorded, never 0', async () => {
  const f = await fixture();
  const r = await overview(f);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.question, 'How does this venture become larger and more enduring?');
  assert.deepEqual(r.body.cards.map((c: any) => c.name), ['Product improvement', 'Distribution', 'Revenue and traction',
    'Team expansion', 'Partner network', 'Market expansion', 'Durable company-building']);
  assert.deepEqual(r.body.figures.map((x: any) => x.key), ['mrr', 'nrr', 'customers', 'headcount']);
  for (const x of r.body.figures) {
    assert.equal(x.value, null, `${x.key} is not recorded`);
    assert.equal(x.state, 'not_recorded');
    assert.match(x.reason, /^Not recorded/);
    assert.equal(figureValue(x), null);
  }
  assert.match(r.body.figures.find((x: any) => x.key === 'nrr').reason, /needs 2 billings/);
  for (const c of r.body.cards) {
    assert.ok(['empty', 'not_recorded'].includes(c.state), `${c.slug}: ${c.state}`);
    assert.equal(cardView(c).state, c.state, `${c.slug} draws as its own state`);
  }
  assert.equal((await overview(f, STRANGER)).status, 403);
  assert.equal((await overview(f, ADVISOR)).status, 200, 'an advisor reads');
});

test('one failing source makes only its card unreadable', async () => {
  const f = await fixture();
  f.db.exec('DROP TABLE growth_partners');
  const r = await overview(f);
  assert.equal(r.status, 200);
  const byState = Object.fromEntries(r.body.cards.map((c: any) => [c.slug, c.state]));
  assert.equal(byState['partner-network'], 'unreadable');
  assert.match(r.body.cards.find((c: any) => c.slug === 'partner-network').reason, /Partners and partner-sourced revenue could not be read/);
  assert.doesNotMatch(JSON.stringify(r.body), /no such table/, 'the raw error is never returned');
  assert.deepEqual(Object.entries(byState).filter(([s, v]) => s !== 'partner-network' && v === 'unreadable'), []);
  const mod = await module_(f, 'partner-network');
  assert.deepEqual([mod.body.card.state, mod.body.records.state, mod.body.records.total], ['unreadable', 'unreadable', null]);
});

test('a typed figure is labelled manual; a computed one names its source and date', async () => {
  const f = await fixture();
  const s = f.db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (?, ?, ?, ?, ?)');
  s.run(PID, '2026-08-12', 30000, 70, null);
  s.run(PID, '2026-09-12', 34000, 80, null);
  s.run(PID, '2026-10-12', 38400, 86, 'stripe');
  const figs = Object.fromEntries((await overview(f)).body.figures.map((x: any) => [x.key, x]));
  assert.deepEqual([figs.mrr.value, figs.mrr.unit, figs.mrr.source, figs.mrr.as_of], [38400, 'usd', 'stripe', '2026-10-12']);
  assert.equal(figureValue(figs.mrr), '$38.4k');
  f.db.prepare(`UPDATE project_metrics SET source = NULL WHERE snapshot_date = '2026-10-12'`).run();
  const typed = Object.fromEntries((await overview(f)).body.figures.map((x: any) => [x.key, x]));
  assert.equal(typed.mrr.source, 'manual');
  assert.equal(typed.customers.source, 'manual');
  const kpis = table((await module_(f, 'revenue-and-traction')).body.records);
  assert.equal(kpis.find((k: any) => k.kpi === 'MRR').source, 'manual');
  // Spend and partner revenue are typed, and say so.
  const ch = await call(f, FOUNDER, 'POST', '/api/cycles/grow/channels', { project: PID, name: 'LinkedIn', utm_source: 'LinkedIn' });
  assert.equal(ch.status, 201);
  const month = new Date().toISOString().slice(0, 7);
  const spend = await call(f, FOUNDER, 'PUT', `/api/cycles/grow/channels/${ch.body.uid}/spend/${month}`, { project: PID, spend_cents: 144000 });
  assert.equal(spend.body.source, 'manual');
  const rows = table((await module_(f, 'distribution')).body.records);
  assert.deepEqual([rows[0].spend, rows[0].customers, rows[0].cac], ['$1,440 · manual', '0', 'Not recorded: no customer attributed to this channel this month']);
});

test('CAC counts customers in the same calendar month as the spend, not a rolling 30 days', async () => {
  const f = await fixture();
  const ch = await call(f, FOUNDER, 'POST', '/api/cycles/grow/channels', { project: PID, name: 'Ads', utm_source: 'ads' });
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  await call(f, FOUNDER, 'PUT', `/api/cycles/grow/channels/${ch.body.uid}/spend/${month}`, { project: PID, spend_cents: 50000 });
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 28)).toISOString().slice(0, 10);
  const c = f.db.prepare(`INSERT INTO contacts (uid, project_id, email, audience, utm_json, created_at) VALUES (?, ?, ?, 'customer', '{"utm_source":"ads"}', ?)`);
  c.run('c1', PID, 'old@x.example', `${lastMonth} 10:00:00`);
  c.run('c2', PID, 'new@x.example', `${month}-01 10:00:00`);
  const rows = table((await module_(f, 'distribution')).body.records);
  assert.deepEqual([rows[0].customers, rows[0].cac], ['1', '$500']);
});

test('revenue: churn reads "Needs 2 billings" until the ledger holds two; computed at read time; expansion splits only when customers can be told apart', async () => {
  const f = await fixture();
  const add = (customer: string, cents: number, on: string, source = 'manual') => f.db.prepare(
    `INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on, source, verification)
     VALUES (?, ?, ?, ?, 'recurring', ?, ?, ?)`).run(crypto.randomUUID(), PID, customer, cents, on, source, source === 'stripe' ? 'verified' : 'manual');
  const now = new Date();
  const m = (back: number, day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, day)).toISOString().slice(0, 10);
  add('Acme', 100000, m(1, 3));
  const one = table((await module_(f, 'revenue-and-traction')).body.records);
  assert.equal(one.find((k: any) => k.kpi === 'Churn').value, 'Needs 2 billings');
  const c1 = await cardOf(f, 'revenue-and-traction');
  assert.deepEqual([c1.state, c1.reason], ['not_recorded', 'Needs 2 billings']);
  // Nothing has written revenue_movements: the read computes from the ledger.
  add('Acme', 140000, m(0, 3));
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM revenue_movements').get() as any).n, 0);
  const two = Object.fromEntries(table((await module_(f, 'revenue-and-traction')).body.records).map((k: any) => [k.kpi, k]));
  assert.deepEqual([two['Expansion MRR'].value, two['Churn'].value, two['New MRR'].value], ['$400', '$0', '$0'], 'recorded movements, including a recorded 0');
  assert.equal(two['Expansion MRR'].source, 'Revenue ledger · manual');
  const c2 = await cardOf(f, 'revenue-and-traction');
  assert.equal(c2.state, 'too_little', 'one month of movement draws no chart');
  // Four billing periods draw.
  add('Acme', 100000, m(3, 3)); add('Acme', 100000, m(2, 3));
  const c4 = await cardOf(f, 'revenue-and-traction');
  assert.equal(c4.state, 'ok');
  assert.deepEqual(drawableSeries(c4.series).map((x: any) => x.kind), ['vstack', 'heat']);
  assert.equal(cardView(c4).state, 'ok');
  add(STRIPE_NO_CUSTOMER, 5000, m(0, 20), 'stripe');
  const anon = Object.fromEntries(table((await module_(f, 'revenue-and-traction')).body.records).map((k: any) => [k.kpi, k]));
  assert.equal(anon['Expansion MRR'].value, 'Not recorded: the ledger cannot tell new from expansion for this month');
  assert.match((await cardOf(f, 'revenue-and-traction')).next.text, /Name the customer on the Stripe charges/);
});

test('a ledger write through the revenue route rewrites the stored movements', async () => {
  const f = await fixture();
  const today = new Date();
  const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 5)).toISOString().slice(0, 10);
  const post = (on: string, cents: number) => call(f, FOUNDER, 'POST', `/api/revenue/projects/${PID}/entries`,
    { customer: 'Northwind', amount_cents: cents, revenue_type: 'recurring', received_on: on });
  assert.equal((await post(last, 1000)).status, 200);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM revenue_movements').get() as any).n, 0, 'one billing period: no movement');
  assert.equal((await post(today.toISOString().slice(0, 10), 1500)).status, 200);
  const mv = f.db.prepare(`SELECT kind, amount_cents FROM revenue_movements ORDER BY kind`).all() as any[];
  assert.deepEqual(mv.map((m) => [m.kind, m.amount_cents]), [['churned', 0], ['expansion', 500], ['new', 0]]);
});

test('writes: owners and co-founders write, an advisor or a stranger cannot; each row records its actor and logs it', async () => {
  const f = await fixture();
  const fb = { project: PID, body: 'Export to CSV please', source: 'customer', theme: 'Exports', from_email: 'a@x.example' };
  assert.equal((await call(f, ADVISOR, 'POST', '/api/cycles/grow/feedback', fb)).status, 403);
  assert.equal((await call(f, STRANGER, 'POST', '/api/cycles/grow/feedback', fb)).status, 403);
  const ok = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', fb);
  assert.equal(ok.status, 201);
  assert.equal((f.db.prepare('SELECT created_by FROM product_feedback').get() as any).created_by, FOUNDER);
  assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'grow_feedback_logged' AND user_id = ?`).get(FOUNDER) as any).n, 1);
  assert.equal((await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { ...fb, source: 'press' })).status, 400);
  // Shipped with a named item: the card's next step counts the customers to tell.
  await call(f, FOUNDER, 'PATCH', `/api/cycles/grow/feedback/${ok.body.uid}`, { project: PID, status: 'shipped', roadmap_item_label: 'CSV export' });
  // Planned, not shipped: not one of the customers to tell yet.
  await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { ...fb, from_email: 'b@x.example', status: 'planned', roadmap_item_label: 'CSV export' });
  await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { ...fb, source: 'team', theme: 'Speed' });
  const card = await cardOf(f, 'product-improvement');
  assert.equal(card.next.text, 'Tell the 1 customer who asked that CSV export shipped.');
  assert.equal(cardView(card).state, 'ok', 'the stack draws through D661');
  assert.deepEqual(card.series[0].rows, [{ label: 'Exports', parts: [0, 1, 1] }, { label: 'Speed', parts: [1, 0, 0] }]);
  // Several filters at once, all of which must match.
  const recs = (await module_(f, 'product-improvement', '&filter=status:open,source:team')).body.records;
  assert.deepEqual([recs.total, table(recs)[0].theme], [1, 'Speed']);
  assert.equal((await module_(f, 'product-improvement', '&filter=status:open,source:customer')).body.records.total, 0);
});

test('a market score needs its source; replies to a market ask are read under that market', async () => {
  const f = await fixture();
  const bad = await call(f, FOUNDER, 'POST', '/api/cycles/grow/markets', { project: PID, name: 'Spain', demand_score: 8 });
  assert.deepEqual([bad.status, bad.body.field], [400, 'demand_source']);
  assert.equal((await call(f, FOUNDER, 'POST', '/api/cycles/grow/markets', { project: PID, name: 'Spain', demand_score: 11, demand_source: 'x' })).status, 400);
  const m = await call(f, FOUNDER, 'POST', '/api/cycles/grow/markets', { project: PID, name: 'Spain', demand_score: 8, demand_source: 'Survey of 40 buyers' });
  assert.equal(m.status, 201);
  const rec = table((await module_(f, 'market-expansion')).body.records)[0];
  assert.equal(rec.readiness, 'Not recorded: Regulation, Partners, Cost to enter not scored');
  assert.equal(rec.weakest_part, 'Regulation');
  assert.equal(rec.decision, 'Not recorded');
  const card = await cardOf(f, 'market-expansion');
  assert.equal(card.next.text, 'Source the regulation score for Spain.');
  assert.equal(cardView(card).state, 'ok');
  // Share an update: a market ask linked to Spain; its reply lands there and is read, never copied.
  const marketId = (f.db.prepare('SELECT id FROM markets WHERE uid = ?').get(m.body.uid) as any).id;
  const landed = await landReply(f.env, PID, { kind: 'market', link_ref: String(marketId), text: 'Someone in Spain' }, { name: 'Ana', email: null, message: 'Talk to Lucia', userId: null });
  assert.deepEqual(landed, { module: 'market-expansion', ref: m.body.uid, reason: null });
  assert.equal((await landReply(f.env, PID, { kind: 'market', link_ref: null, text: 'x' }, { name: null, email: null, message: 'm', userId: null })).module, null);
  f.db.exec(`INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, title, status) VALUES (1, 'u1', ${PID}, ${FOUNDER}, 'Oct', 'submitted')`);
  f.db.exec(`INSERT INTO update_asks (id, uid, update_id, kind, text, link_ref) VALUES (1, 'a1', 1, 'market', 'Someone in Spain', '${marketId}'), (2, 'a2', 1, 'market', 'Unlinked', NULL)`);
  // A hire ask whose link happens to hold the same number is not a market ask.
  f.db.exec(`INSERT INTO update_asks (id, uid, update_id, kind, text, link_ref) VALUES (3, 'a3', 1, 'hire', 'Engineer', '${marketId}')`);
  f.db.exec(`INSERT INTO update_ask_replies (uid, ask_id, name, message) VALUES ('r1', 1, 'Ana', 'Talk to Lucia'), ('r2', 2, 'Bo', 'Elsewhere'), ('r3', 3, 'Cy', 'A candidate')`);
  const replies = (await module_(f, 'market-expansion')).body.parts.replies[m.body.uid];
  assert.deepEqual(replies.map((x: any) => x.message), ['Talk to Lucia']);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM update_ask_replies').get() as any).n, 3, 'read, not copied');
  assert.throws(() => f.db.exec(`INSERT INTO markets (uid, project_id, name, demand_score) VALUES ('mx', ${PID}, 'France', 6)`),
    /CHECK constraint failed/, 'migration 443: a score names its source');
});

test('migration 443 replaces the stale "no Market expansion store" reason on earlier replies, and moves none', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, founder_id INTEGER); CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER);`);
  db.exec(baseline('compliance_events'));
  for (const p of ['132']) db.exec(ddl(p));
  db.exec(ddl('125')); db.exec(file('437'));
  db.exec(`INSERT INTO update_ask_replies (uid, ask_id, name, message, landed_reason) VALUES
    ('r1', 1, 'Ana', 'm', 'Not recorded: there is no Market expansion store yet, so the reply stays on the ask'),
    ('r2', 2, 'Bo', 'm', 'Something else')`);
  db.exec(file('443'));
  const got = db.prepare('SELECT uid, landed_module, landed_reason FROM update_ask_replies ORDER BY uid').all() as any[];
  assert.deepEqual(got.map((r) => [r.uid, r.landed_module, r.landed_reason]), [
    ['r1', null, 'Not recorded: the ask is linked to no market, so the reply stays on the ask'],
    ['r2', null, 'Something else'],
  ]);
});

test('team expansion: an application\'s stage moves; the card counts new applicants; a quarter plan draws', async () => {
  const f = await fixture();
  f.db.exec(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title, status) VALUES (5, 'eng', ${FOUNDER}, ${PID}, 'Engineer', 'open')`);
  f.db.exec(`INSERT INTO job_applications (id, posting_id, email) VALUES (1, 5, 'a@x.example'), (2, 5, 'b@x.example')`);
  assert.equal((f.db.prepare('SELECT stage FROM job_applications WHERE id = 1').get() as any).stage, 'applied');
  const moved = await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/applications/1/stage', { project: PID, stage: 'interview' });
  assert.deepEqual([moved.status, moved.body.stage], [200, 'interview']);
  assert.equal((await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/applications/1/stage', { project: PID, stage: 'submitted' })).status, 400);
  assert.throws(() => f.db.exec(`UPDATE job_applications SET stage = 'submitted' WHERE id = 2`), /CHECK constraint failed/, 'migration 443: only the six stages');
  assert.equal((await call(f, ADVISOR, 'PATCH', '/api/cycles/grow/applications/2/stage', { project: PID, stage: 'screen' })).status, 403);
  await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/roles/5', { project: PID, team: 'Engineering', target_start: '2027-01' });
  const rec = table((await module_(f, 'team-expansion')).body.records)[0];
  assert.deepEqual([rec.team, rec.applicants, rec.in_interview, rec.target_start], ['Engineering', '2', '1', '2027-01']);
  const card = await cardOf(f, 'team-expansion');
  assert.equal(card.next.text, 'Review the 1 new applicant.');
  // A roster and a plan labelled by quarter.
  // Last quarter: its last month falls inside the card's six months.
  const now = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 3, 1));
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  f.db.exec(`INSERT INTO company_people (uid, company_id, name, person_type, status, start_date, created_by) VALUES ('pa', 70, 'Ann', 'employee', 'active', '2025-01-01', ${FOUNDER}), ('pb', 70, 'Bob', 'employee', 'active', '2025-02-01', ${FOUNDER})`);
  f.db.exec(`INSERT INTO company_headcount_plan (uid, company_id, period_label, target_headcount, updated_by) VALUES ('hp', 70, 'Q${q} ${now.getUTCFullYear()}', 4, ${FOUNDER})`);
  const team = await cardOf(f, 'team-expansion');
  assert.equal(team.state, 'ok');
  assert.equal(cardView(team).state, 'ok');
  const line = team.series.find((x: any) => x.kind === 'line');
  assert.deepEqual(line.values, [2, 2, 2, 2, 2, 2]);
  assert.ok(line.plan.includes(4), 'the quarter\'s target is drawn');
});

test('durable company-building: production\'s compliance_events; the checklist starts from the Lab\'s gates; obligations carry an owner', async () => {
  const f = await fixture();
  assert.ok(DURABILITY_ITEMS.some((i) => i.key === 'section83b_filed' && i.lab === 'section83b_filed'));
  f.db.exec(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (${FOUNDER}, 4, 'section83b_filed', '2026-09-01')`);
  await call(f, FOUNDER, 'PUT', '/api/cycles/grow/checklist/key_person_cover', { project: PID, done: true });
  const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations', { project: PID, title: 'No date' })).status, 400);
  const ob = await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations', { project: PID, title: 'Board meeting', event_type: 'board_meeting', due_date: due });
  assert.equal(ob.status, 201, JSON.stringify(ob.body));
  const stored = f.db.prepare('SELECT jurisdiction, event_type, completion_status, source, created_by_user_id FROM compliance_events WHERE id = ?').get(ob.body.id) as any;
  assert.deepEqual({ ...stored }, { jurisdiction: 'Unspecified', event_type: 'board_meeting', completion_status: 'pending', source: 'manual', created_by_user_id: FOUNDER });
  await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations', { project: PID, title: 'Franchise tax', event_type: 'franchise_tax', due_date: later, owner_name: 'Fay' });
  assert.equal((await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations', { project: PID, title: 'Dup', event_type: 'board_meeting', due_date: due })).status, 409);
  const mod = await module_(f, 'durable-company-building');
  const list = Object.fromEntries(mod.body.parts.checklist.map((i: any) => [i.key, i]));
  assert.deepEqual([list.section83b_filed.done, list.section83b_filed.source], [true, 'Spin-Out Lab']);
  assert.deepEqual([list.key_person_cover.done, list.key_person_cover.source], [true, 'manual']);
  assert.equal(list.ein_received.done, false);
  assert.deepEqual(table(mod.body.records).map((r: any) => [r.obligation, r.kind, r.owner, r.state]),
    [['Board meeting', 'board_meeting', 'Not recorded', 'pending'], ['Franchise tax', 'franchise_tax', 'Fay', 'pending']]);
  const card = await cardOf(f, 'durable-company-building');
  assert.equal(cardView(card).state, 'ok');
  assert.deepEqual(card.series.map((x: any) => x.kind), ['timeline', 'progress']);
  assert.equal(card.series[1].items[0].pct, Math.round((2 / DURABILITY_ITEMS.length) * 100));
  assert.equal(card.next.text, 'Give Board meeting an owner.');
  // An owner must be someone on this venture; a stranger's id is refused.
  assert.equal((await call(f, FOUNDER, 'PATCH', `/api/cycles/grow/obligations/${ob.body.id}`, { project: PID, owner_user_id: STRANGER })).status, 400);
  const own = await call(f, FOUNDER, 'PATCH', `/api/cycles/grow/obligations/${ob.body.id}`, { project: PID, owner_user_id: ADVISOR, completion_status: 'completed' });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  const after = f.db.prepare('SELECT owner_user_id, owner_name, completion_status, completed_by_user_id FROM compliance_events WHERE id = ?').get(ob.body.id) as any;
  assert.deepEqual({ ...after }, { owner_user_id: ADVISOR, owner_name: 'Ada', completion_status: 'completed', completed_by_user_id: FOUNDER });
  // Every obligation now has an owner: the next step is the first open checklist item.
  assert.equal((await cardOf(f, 'durable-company-building')).next.text, 'Tax ID (EIN) received.');
  assert.equal((await call(f, FOUNDER, 'PUT', '/api/cycles/grow/checklist/made_up', { project: PID, done: true })).status, 404);
});

test('the Lab ticks the checklist only when its founder holds this one venture', async () => {
  const f = await fixture();
  f.db.exec(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (${FOUNDER}, 4, 'ein_received', '2026-09-01')`);
  const done = async () => (await module_(f, 'durable-company-building')).body.parts.checklist.find((i: any) => i.key === 'ein_received').done;
  assert.equal(await done(), true);
  f.db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (8, 'p8', 'Second venture', 10)`);
  assert.equal(await done(), false, 'two ventures: nothing says which one the milestone was for');
});
