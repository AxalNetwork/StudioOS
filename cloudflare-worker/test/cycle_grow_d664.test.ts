/**
 * D664 (#1477) — the Grow stores (migration 443) and /api/cycles/grow, on real
 * SQLite over the production baseline (compliance_events) and migrations
 * 119, 127 + 166 (contacts), 132 (job board), 311 (revenue ledger), 326 (team
 * roster), 437 (Share an update), 443 and 462 (D691, #1697).
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
import { CARD_STATES, MIN_POINTS, figure, pageOf, seriesState, settleCard } from '../src/services/cycleCards.ts';
import { billingPeriods, cohortRetention, computeMovements, movementGap, recomputeRevenueMovements, type LedgerRecurring } from '../src/services/revenueMovements.ts';
import { nrrFromLedger, planMonth, readiness, utmSource, DURABILITY_ITEMS } from '../src/services/growCycle.ts';
import { landReply } from '../src/services/updateShare.ts';
import { STRIPE_NO_CUSTOMER } from '../src/services/revenueLedger.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const M = resolve(here, '../sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1; const ADVISOR = 2; const STRANGER = 3;
const PID = 7;

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
  assert.equal(movementGap([row('Acme', 1, '2026-07-01')]), 'Not recorded: needs 2 billings');
  assert.equal(movementGap([row('Acme', 1, '2026-07-01'), row('Acme', 1, '2026-09-01')]), 'Not recorded: no two billing months in a row');
  assert.equal(movementGap([row('Acme', 1, '2026-08-01'), row('Acme', 1, '2026-09-01')]), null);
  assert.equal(nrrFromLedger([row('Acme', 1, '2026-07-01'), row('Acme', 1, '2026-09-01')]).reason, 'Not recorded: no two billing months in a row');
  assert.equal(nrrFromLedger([row('Acme', 100, '2026-08-01'), row('Acme', 120, '2026-09-01')]).value, 120);
});

test('a hiring plan names its month: a date, a month, a quarter or a half', () => {
  assert.deepEqual(['2027-03', '2027-03-31', 'Q1 2027', '2027 Q4', 'q2 2027', 'H2 2027', 'H1 2027', 'next year', ''].map(planMonth),
    ['2027-03', '2027-03', '2027-03', '2027-12', '2027-06', '2027-12', '2027-06', null, null]);
});

// ── The shared read ─────────────────────────────────────────────────────────

test('cycleCards: the five states; too_little under three points; a thrown read is unreadable, naming the source', async () => {
  assert.deepEqual([...CARD_STATES], ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable']);
  assert.equal(MIN_POINTS, 3);
  assert.deepEqual([seriesState(0), seriesState(2), seriesState(3)], ['empty', 'too_little', 'ok']);
  assert.equal(figure({ key: 'k', label: 'K', unit: 'n', value: 1, delta_30d: null, spark: [1, 2], source: 's', as_of: null }).state, 'too_little');
  const bad = await settleCard({ slug: 'x', name: 'X', range: 'r', caption: 'c', source: 'The X store' }, async () => { throw new Error('no such table: x'); });
  assert.deepEqual([bad.state, bad.reason, bad.series], ['unreadable', 'Unreadable: The X store could not be read', null]);
  assert.doesNotMatch(JSON.stringify(bad), /no such table/, 'the raw error is never returned');
  assert.deepEqual(pageOf([1, 2, 3, 4, 5], 2, 2), { rows: [3, 4], total: 5, page: 2, page_size: 2 });
});

test('a market\'s readiness is out of 40 only when all four parts are scored; the weakest part names a gap first', () => {
  const m: any = { demand_score: 8, demand_source: 's', regulation_score: null, regulation_source: null, partners_score: 5, partners_source: 's', cost_score: 4, cost_source: 's' };
  assert.deepEqual(readiness(m), { score: null, weakest: 'Regulation', missing: ['Regulation'] });
  assert.deepEqual(readiness({ ...m, regulation_score: 6, regulation_source: 's' }), { score: 23, weakest: 'Cost to enter', missing: [] });
  assert.equal(utmSource('{"utm_source":" LinkedIn "}'), 'linkedin');
  assert.equal(utmSource('not json'), null);
});

test('records: search, field filter and sort; a missing value sorts last, never as 0', () => {
  const rows = [{ name: 'A', cac: 300 }, { name: 'B', cac: null }, { name: 'C', cac: 120 }];
  assert.deepEqual(shapeRecords(rows, '', '', 'cac').map((r) => r.name), ['C', 'A', 'B']);
  assert.deepEqual(shapeRecords(rows, '', '', '-cac').map((r) => r.name), ['A', 'C', 'B']);
  assert.deepEqual(shapeRecords(rows, 'b', '', '').map((r) => r.name), ['B']);
  assert.deepEqual(shapeRecords([{ s: 'Open' }, { s: 'shipped' }], '', 's:SHIPPED', '').length, 1);
});

// ── The routes ──────────────────────────────────────────────────────────────

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, deleted_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
           CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, project_id INTEGER, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT, actor TEXT);
           CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER, email TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')));
           CREATE TABLE spinout_lab_milestones (id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT);`);
  const baseline = readFileSync(resolve(here, '../sql/schema_baseline.sql'), 'utf8');
  db.exec(tableFromBaseline(baseline, 'entities'));
  db.exec(tableFromBaseline(baseline, 'compliance_events'));
  for (const p of ['034', '119', '127', '132', '326']) db.exec(ddl(p));
  db.exec(file('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(ddl('125')); db.exec(file('437'));
  db.exec(file('443'));
  db.exec(file('462'));
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
  }
  assert.match(r.body.figures.find((x: any) => x.key === 'nrr').reason, /needs 2 billings/);
  for (const c of r.body.cards) assert.notEqual(c.state, 'unreadable', c.slug);
  assert.equal((await overview(f, STRANGER)).status, 403);
  assert.equal((await overview(f, ADVISOR)).status, 200, 'an advisor reads');
});

test('a shipped feedback insert records its shipping date', async () => {
  const f = await fixture();
  const posted = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback',
    { project: PID, body: 'Make setup easier', source: 'customer', status: 'shipped', roadmap_item_label: 'Setup' });
  assert.equal(posted.status, 201, JSON.stringify(posted.body));
  const row = f.db.prepare('SELECT status, shipped_on FROM product_feedback WHERE uid = ?').get(posted.body.uid) as any;
  assert.deepEqual([row.status, row.shipped_on], ['shipped', new Date().toISOString().slice(0, 10)]);
});

test('Distribution and Partner network expose update ask replies beside their own rows', async () => {
  const f = await fixture();
  f.db.exec(`INSERT INTO portfolio_updates (id,uid,project_id,author_user_id,title,status,sent_at) VALUES
    (101,'u101',7,1,'September','submitted','2026-09-30');
    INSERT INTO update_asks (id,uid,update_id,kind,text) VALUES
    (201,'a201',101,'customer','Customer intro'),(202,'a202',101,'partner','Partner intro');
    INSERT INTO update_ask_replies (uid,ask_id,name,message,landed_module,landed_reason) VALUES
    ('r1',201,'Alex','An intro','contacts',NULL),('r2',202,'Blair','A lead',NULL,'No store accepted it');`);
  const distribution = (await module_(f, 'distribution')).body;
  const partners = (await module_(f, 'partner-network')).body;
  assert.deepEqual(distribution.parts.from_update_asks.map((r: any) => [r.uid, r.landed_module, r.landed_reason]), [['r1', 'contacts', null]]);
  assert.deepEqual(partners.parts.from_update_asks.map((r: any) => [r.uid, r.landed_module, r.landed_reason]), [['r2', null, 'No store accepted it']]);
  assert.equal(distribution.records.rows.some((r: any) => r.uid === 'r1'), false);
  assert.equal(partners.records.rows.some((r: any) => r.uid === 'r2'), false);
});

test('Updates history is newest first with grouped counts, author links, legacy nulls and unreadable failure', async () => {
  const f = await fixture();
  f.db.exec(`INSERT INTO portfolio_updates (id,uid,project_id,author_user_id,title,period,status,submitted_at,sent_at,period_start,period_end,updated_at) VALUES
    (101,'older',7,1,'Old sent','2026-08','submitted','2026-09-02','2026-09-02','2026-08-01','2026-08-31','2026-09-02'),
    (102,'legacy',7,1,'Legacy','2026-09','submitted','2026-09-15',NULL,NULL,NULL,'2026-09-15'),
    (103,'newer',7,1,'New sent','2026-09','submitted','2026-09-30','2026-09-30','2026-09-01','2026-09-30','2026-09-30'),
    (104,'draft',7,1,'Draft','2026-10','draft',NULL,NULL,NULL,NULL,'2026-10-10');
    INSERT INTO update_recipients (update_id,audience,user_id,delivered_via,opened_at) VALUES
    (103,'investor',2,'notification','2026-10-01'),(103,'investor',NULL,NULL,NULL),
    (103,'team',1,'notification',NULL),(103,'network',3,'notification','2026-10-02');
    INSERT INTO update_asks (id,uid,update_id,kind,text,asked_again_at) VALUES
    (201,'ask1',103,'customer','Intro',NULL),(202,'ask2',103,'partner','Partner','2026-10-12'),
    (203,'ask3',103,'hire','Role',NULL);
    INSERT INTO update_ask_replies (uid,ask_id,name,message) VALUES ('reply1',203,'Alex','I know someone');`);
  const before = (f.db.prepare('SELECT COUNT(*) AS n FROM portfolio_updates').get() as any).n;
  const module = (await module_(f, 'durable-company-building')).body;
  const rows = module.parts.updates;
  assert.deepEqual(rows.map((u: any) => u.uid), ['newer', 'legacy', 'older']);
  assert.deepEqual(rows[0].sent_to, { investors: 2, team: 1, network: 1 });
  assert.deepEqual([rows[0].delivered, rows[0].opened, rows[0].asks, rows[0].replies, rows[0].asks_to_ask_again], [3, 2, 3, 1, 1]);
  assert.equal(rows[0].href, '/updates/newer');
  assert.deepEqual([rows[1].label, rows[1].period, rows[1].sent_to, rows[1].delivered, rows[1].asks_to_ask_again],
    ["Submitted to the investors' inbox", '2026-09', null, null, null]);
  assert.equal(rows[1].href, null, 'legacy submissions do not have a sent update page');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM portfolio_updates').get() as any).n, before);
  const advisor = await call(f, ADVISOR, 'GET', `/api/cycles/grow/modules/durable-company-building?project=${PID}`);
  assert.equal(advisor.status, 200);
  assert.equal(advisor.body.parts.updates[0].href, null);
  f.db.exec('DROP TABLE update_recipients');
  const unreadable = (await module_(f, 'durable-company-building')).body.parts;
  assert.equal(unreadable.updates, null);
  assert.match(unreadable.updates_reason, /^Unreadable:/);
});

test('one failing source makes only its card unreadable', async () => {
  const f = await fixture();
  f.db.exec('DROP TABLE growth_partners');
  const r = await overview(f);
  assert.equal(r.status, 200);
  const byState = Object.fromEntries(r.body.cards.map((c: any) => [c.slug, c.state]));
  assert.equal(byState['partner-network'], 'unreadable');
  assert.match(r.body.cards.find((c: any) => c.slug === 'partner-network').reason, /Partners and partner-sourced revenue could not be read/);
  assert.deepEqual(Object.entries(byState).filter(([s, v]) => s !== 'partner-network' && v === 'unreadable'), []);
  const mod = await module_(f, 'partner-network');
  assert.deepEqual([mod.body.card.state, mod.body.records_state], ['unreadable', 'unreadable']);
});

test('a typed figure is labelled manual; a computed one names its source and date', async () => {
  const f = await fixture();
  const s = f.db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (?, ?, ?, ?, ?)');
  s.run(PID, '2026-08-12', 30000, 70, null);
  s.run(PID, '2026-09-12', 34000, 80, null);
  s.run(PID, '2026-10-12', 38400, 86, 'stripe');
  const figs = Object.fromEntries((await overview(f)).body.figures.map((x: any) => [x.key, x]));
  assert.deepEqual([figs.mrr.value, figs.mrr.source, figs.mrr.as_of], [38400, 'stripe', '2026-10-12']);
  f.db.prepare(`UPDATE project_metrics SET source = NULL WHERE snapshot_date = '2026-10-12'`).run();
  const typed = Object.fromEntries((await overview(f)).body.figures.map((x: any) => [x.key, x]));
  assert.equal(typed.mrr.source, 'manual');
  assert.equal(typed.customers.source, 'manual');
  const kpis = (await module_(f, 'revenue-and-traction')).body.records.rows;
  assert.equal(kpis.find((k: any) => k.kpi === 'MRR').source, 'manual');
  // Spend and partner revenue are typed, and say so.
  const ch = await call(f, FOUNDER, 'POST', '/api/cycles/grow/channels', { project: PID, name: 'LinkedIn', utm_source: 'LinkedIn' });
  assert.equal(ch.status, 201);
  const month = new Date().toISOString().slice(0, 7);
  const spend = await call(f, FOUNDER, 'PUT', `/api/cycles/grow/channels/${ch.body.uid}/spend/${month}`, { project: PID, spend_cents: 144000 });
  assert.equal(spend.body.source, 'manual');
  const rows = (await module_(f, 'distribution')).body.records.rows;
  assert.deepEqual([rows[0].spend_cents, rows[0].spend_source, rows[0].customers, rows[0].cac_cents], [144000, 'manual', 0, null]);
  assert.match(rows[0].cac_reason, /no customer attributed/);
});

test('churn reads "Needs 2 billings" until the ledger holds two; expansion splits only when customers can be told apart', async () => {
  const f = await fixture();
  const add = (customer: string, cents: number, on: string, source = 'manual') => f.db.prepare(
    `INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on, source, verification)
     VALUES (?, ?, ?, ?, 'recurring', ?, ?, ?)`).run(crypto.randomUUID(), PID, customer, cents, on, source, source === 'stripe' ? 'verified' : 'manual');
  add('Acme', 100000, '2026-08-03');
  await recomputeRevenueMovements(f.env, PID);
  const one = (await module_(f, 'revenue-and-traction')).body.records.rows;
  const churn = one.find((k: any) => k.kpi === 'Churn');
  assert.deepEqual([churn.value, churn.reason], [null, 'Needs 2 billings']);
  assert.equal((await overview(f)).body.cards.find((c: any) => c.slug === 'revenue-and-traction').series.churn.reason, 'Needs 2 billings');
  add('Acme', 140000, '2026-09-03');
  await recomputeRevenueMovements(f.env, PID);
  const two = Object.fromEntries((await module_(f, 'revenue-and-traction')).body.records.rows.map((k: any) => [k.kpi, k]));
  assert.deepEqual([two['Expansion MRR'].value, two['Churn'].value, two['New MRR'].value], [40000, 0, 0], 'recorded movements, including a recorded 0');
  assert.match(two['Expansion MRR'].source, /^Revenue ledger · manual$/);
  add(STRIPE_NO_CUSTOMER, 5000, '2026-09-20', 'stripe');
  await recomputeRevenueMovements(f.env, PID);
  const anon = Object.fromEntries((await module_(f, 'revenue-and-traction')).body.records.rows.map((k: any) => [k.kpi, k]));
  assert.equal(anon['Expansion MRR'].value, null);
  assert.match(anon['Expansion MRR'].reason, /cannot tell new from expansion/);
  const card = (await overview(f)).body.cards.find((c: any) => c.slug === 'revenue-and-traction');
  assert.match(card.next.text, /Name the customer on the Stripe charges/);
});

test('a ledger write through the revenue route rewrites the movements', async () => {
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
  const card = (await overview(f)).body.cards.find((c: any) => c.slug === 'product-improvement');
  assert.equal(card.next.text, 'Tell the 1 customer who asked that CSV export shipped.');
  assert.deepEqual(card.series, [{ theme: 'Exports', open: 0, planned: 1, shipped: 1 }]);
});

test('a market score needs its source; replies to a market ask are read under that market', async () => {
  const f = await fixture();
  const bad = await call(f, FOUNDER, 'POST', '/api/cycles/grow/markets', { project: PID, name: 'Spain', demand_score: 8 });
  assert.deepEqual([bad.status, bad.body.field], [400, 'demand_source']);
  assert.equal((await call(f, FOUNDER, 'POST', '/api/cycles/grow/markets', { project: PID, name: 'Spain', demand_score: 11, demand_source: 'x' })).status, 400);
  const m = await call(f, FOUNDER, 'POST', '/api/cycles/grow/markets', { project: PID, name: 'Spain', demand_score: 8, demand_source: 'Survey of 40 buyers' });
  assert.equal(m.status, 201);
  const rec = (await module_(f, 'market-expansion')).body.records.rows[0];
  assert.equal(rec.readiness, null);
  assert.match(rec.readiness_reason, /Regulation, Partners, Cost to enter not scored/);
  assert.equal(rec.weakest_part, 'Regulation');
  const card = (await overview(f)).body.cards.find((c: any) => c.slug === 'market-expansion');
  assert.equal(card.next.text, 'Source the regulation score for Spain.');
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
  const replies = (await module_(f, 'market-expansion')).body.records.rows[0].replies;
  assert.deepEqual(replies.map((x: any) => x.message), ['Talk to Lucia']);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM update_ask_replies').get() as any).n, 3, 'read, not copied');
  assert.throws(() => f.db.exec(`INSERT INTO markets (uid, project_id, name, demand_score) VALUES ('mx', ${PID}, 'France', 6)`),
    /CHECK constraint failed/, 'migration 443: a score names its source');
});

test('team expansion: an application\'s stage moves; the card counts new applicants by stage', async () => {
  const f = await fixture();
  f.db.exec(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title, status) VALUES (5, 'eng', ${FOUNDER}, ${PID}, 'Engineer', 'published')`);
  f.db.exec(`INSERT INTO job_applications (id, posting_id, email) VALUES (1, 5, 'a@x.example'), (2, 5, 'b@x.example')`);
  assert.equal((f.db.prepare('SELECT stage FROM job_applications WHERE id = 1').get() as any).stage, 'applied');
  const moved = await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/applications/1/stage', { project: PID, stage: 'interview' });
  assert.deepEqual([moved.status, moved.body.stage], [200, 'interview']);
  assert.equal((await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/applications/1/stage', { project: PID, stage: 'submitted' })).status, 400);
  assert.throws(() => f.db.exec(`UPDATE job_applications SET stage = 'submitted' WHERE id = 2`), /CHECK constraint failed/, 'migration 443: only the six stages');
  assert.equal((await call(f, ADVISOR, 'PATCH', '/api/cycles/grow/applications/2/stage', { project: PID, stage: 'screen' })).status, 403);
  await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/roles/5', { project: PID, team: 'Engineering', target_start: '2027-01' });
  const rec = (await module_(f, 'team-expansion')).body.records.rows[0];
  assert.deepEqual([rec.team, rec.applicants, rec.in_interview, rec.target_start], ['Engineering', 2, 1, '2027-01']);
  const card = (await overview(f)).body.cards.find((c: any) => c.slug === 'team-expansion');
  assert.equal(card.next.text, 'Review the 1 new applicant.');
});

test('durable company-building: the checklist starts from the Lab\'s gates; obligations carry an owner', async () => {
  const f = await fixture();
  assert.ok(DURABILITY_ITEMS.some((i) => i.key === 'section83b_filed' && i.lab === 'section83b_filed'));
  f.db.exec(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (${FOUNDER}, 4, 'section83b_filed', '2026-09-01')`);
  await call(f, FOUNDER, 'PUT', '/api/cycles/grow/checklist/key_person_cover', { project: PID, done: true });
  const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const ob = await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations', { project: PID, title: 'Board meeting', kind: 'governance', due_at: due });
  assert.equal(ob.status, 201);
  const stored = () => f.db.prepare('SELECT * FROM compliance_events WHERE id = ?').get(ob.body.id) as any;
  assert.deepEqual([stored().due_date, stored().completion_status, stored().recurrence, stored().event_type,
    stored().source, stored().kind, stored().jurisdiction, stored().entity_id, stored().created_by_user_id, stored().created_by],
    [due, 'pending', 'one_time', 'board_meeting', 'manual', 'governance', 'Unspecified', null, FOUNDER, FOUNDER]);
  const duplicate = await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations',
    { project: PID, title: 'Another board', kind: 'governance', due_at: due });
  assert.deepEqual([duplicate.status, duplicate.body.detail],
    [409, `Another governance obligation is already due on ${due}. Pick another date.`]);
  const missing = await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations', { project: PID, title: 'No date', kind: 'compliance' });
  assert.deepEqual([missing.status, missing.body.detail], [400, 'An obligation has a due date.']);
  f.db.exec(`INSERT INTO entities (id, name, entity_type, jurisdiction) VALUES (9, 'Example entity', 'project', 'Example jurisdiction'); UPDATE projects SET entity_id = 9 WHERE id = ${PID}`);
  const entityOb = await call(f, FOUNDER, 'POST', '/api/cycles/grow/obligations',
    { project: PID, title: 'Culture gathering', kind: 'culture', due_at: due });
  assert.equal(entityOb.status, 201);
  const entityRow = f.db.prepare('SELECT entity_id, jurisdiction, event_type FROM compliance_events WHERE id = ?').get(entityOb.body.id) as any;
  assert.deepEqual([entityRow.entity_id, entityRow.jurisdiction, entityRow.event_type], [9, 'Example jurisdiction', 'culture']);
  const mod = await module_(f, 'durable-company-building');
  assert.equal(mod.status, 200);
  assert.deepEqual(mod.body.records.rows.find((r: any) => r.id === ob.body.id),
    { id: ob.body.id, title: 'Board meeting', kind: 'governance', due_at: due, owner_name: null, status: 'scheduled', repeats: 'once', due_window: 'next_30' });
  const list = Object.fromEntries(mod.body.parts.checklist.map((i: any) => [i.key, i]));
  assert.deepEqual([list.section83b_filed.done, list.section83b_filed.source], [true, 'Spin-Out Lab']);
  assert.deepEqual([list.key_person_cover.done, list.key_person_cover.source], [true, 'manual']);
  assert.equal(list.ein_received.done, false);
  const card = (await overview(f)).body.cards.find((c: any) => c.slug === 'durable-company-building');
  assert.deepEqual(card.series.checklist, { done: 2, total: DURABILITY_ITEMS.length, pct: Math.round((2 / DURABILITY_ITEMS.length) * 100) });
  assert.equal(card.next.text, 'Give Board meeting an owner.');
  assert.ok(card.series.calendar.some((event: any) => event.title === 'Board meeting' && event.due === due));
  const patch = (body: any) => call(f, FOUNDER, 'PATCH', `/api/cycles/grow/obligations/${ob.body.id}`, { project: PID, ...body });
  assert.equal((await patch({ status: 'done' })).status, 200);
  assert.deepEqual([stored().completion_status, stored().completed_by_user_id], ['completed', FOUNDER]);
  assert.ok(stored().completed_at);
  assert.equal((await patch({ status: 'overdue' })).status, 200);
  assert.deepEqual([stored().completion_status, stored().completed_at, stored().completed_by_user_id], ['pending', null, null]);
  f.db.prepare("UPDATE compliance_events SET reminders_sent_json = '[14]' WHERE id = ?").run(ob.body.id);
  assert.equal((await patch({ due_at: '2020-01-01' })).status, 200);
  assert.equal(stored().reminders_sent_json, '[]');
  const past = (await module_(f, 'durable-company-building')).body.records.rows.find((r: any) => r.id === ob.body.id);
  assert.deepEqual([past.due_at, past.status], ['2020-01-01', 'overdue']);
  f.db.prepare(`INSERT INTO compliance_events (project_id, jurisdiction, event_type, title, due_date)
    VALUES (?, 'Unspecified', 'franchise_tax', 'Seeded tax', ?), (?, 'Unspecified', 'board_meeting', 'Seeded board', ?)`)
    .run(PID, due, PID, due);
  const seeded = (await module_(f, 'durable-company-building')).body.records.rows;
  assert.deepEqual(seeded.filter((r: any) => r.title.startsWith('Seeded')).sort((a: any, b: any) => a.title.localeCompare(b.title)).map((r: any) => [r.title, r.kind, r.status]),
    [['Seeded board', 'governance', 'scheduled'], ['Seeded tax', 'compliance', 'upcoming']]);
  assert.equal((await call(f, FOUNDER, 'PUT', '/api/cycles/grow/checklist/made_up', { project: PID, done: true })).status, 404);
});

// ── #1753: the fixes from S1's review of #1488 ──────────────────────────────

const cardOf = async (f: any, slug: string) => (await overview(f)).body.cards.find((c: any) => c.slug === slug);
const monthAgo = (back: number, day: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, day)).toISOString().slice(0, 10);
};

test('CAC counts customers in the same calendar month as the spend, not a rolling 30 days', async () => {
  const f = await fixture();
  const ch = await call(f, FOUNDER, 'POST', '/api/cycles/grow/channels', { project: PID, name: 'Ads', utm_source: 'ads' });
  const month = new Date().toISOString().slice(0, 7);
  await call(f, FOUNDER, 'PUT', `/api/cycles/grow/channels/${ch.body.uid}/spend/${month}`, { project: PID, spend_cents: 50000 });
  // Last month's 28th can fall inside a rolling 30 days; it is not this month.
  const c = f.db.prepare(`INSERT INTO contacts (uid, project_id, email, audience, utm_json, created_at) VALUES (?, ?, ?, 'customer', '{"utm_source":"ads"}', ?)`);
  c.run('c1', PID, 'old@x.example', `${monthAgo(1, 28)} 10:00:00`);
  c.run('c2', PID, 'new@x.example', `${month}-01 10:00:00`);
  const rows = (await module_(f, 'distribution')).body.records.rows;
  assert.deepEqual([rows[0].customers, rows[0].cac_cents], [1, 50000]);
  const w = f.db.prepare(`INSERT INTO waitlist_signups (project_id, email, created_at) VALUES (?, ?, ?)`);
  w.run(PID, 'a@x.example', `${monthAgo(1, 28)} 10:00:00`);
  w.run(PID, 'b@x.example', `${month}-01 10:00:00`);
  const card = await cardOf(f, 'distribution');
  assert.equal(card.range, 'This month');
  assert.equal(card.series.funnel.find((s: any) => s.stage === 'Sign-up').value, 1, 'sign-ups by the same month');
  assert.equal(card.series.channels[0].cac_cents, 50000);
});

test('revenue movements are computed from the ledger when read, and a gap month says so', async () => {
  const f = await fixture();
  const add = (customer: string, cents: number, on: string) => f.db.prepare(
    `INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on, source, verification)
     VALUES (?, ?, ?, ?, 'recurring', ?, 'manual', 'manual')`).run(crypto.randomUUID(), PID, customer, cents, on);
  // Two billing months with a gap between them: no movement can be read.
  add('Acme', 100000, monthAgo(3, 3)); add('Acme', 100000, monthAgo(1, 3));
  const gapRows = Object.fromEntries((await module_(f, 'revenue-and-traction')).body.records.rows.map((k: any) => [k.kpi, k]));
  assert.deepEqual([gapRows['Churn'].value, gapRows['Churn'].reason], [null, 'Not recorded: no two billing months in a row']);
  const gapCard = await cardOf(f, 'revenue-and-traction');
  assert.deepEqual([gapCard.state, gapCard.reason, gapCard.series.churn.reason],
    ['not_recorded', 'Not recorded: no two billing months in a row', 'Not recorded: no two billing months in a row']);
  const nrr = (await overview(f)).body.figures.find((x: any) => x.key === 'nrr');
  assert.equal(nrr.reason, 'Not recorded: no two billing months in a row');
  // A ledger that predates 443: nothing ever wrote revenue_movements, and the read still splits.
  add('Acme', 140000, monthAgo(0, 3));
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM revenue_movements').get() as any).n, 0);
  const rows = Object.fromEntries((await module_(f, 'revenue-and-traction')).body.records.rows.map((k: any) => [k.kpi, k]));
  assert.deepEqual([rows['Expansion MRR'].value, rows['Churn'].value, rows['New MRR'].value], [40000, 0, 0]);
  const card = await cardOf(f, 'revenue-and-traction');
  assert.deepEqual(card.series.movements.map((m: any) => [m.month, m.expansion]), [[monthAgo(0, 3).slice(0, 7), 40000]]);
  assert.equal(card.series.churn, null);
  assert.equal(card.source, 'Revenue ledger · manual');
});

test('the revenue caption says MRR is cash by the month it was received', async () => {
  const f = await fixture();
  assert.match((await cardOf(f, 'revenue-and-traction')).caption, /MRR is cash by the month it was received, so an annual invoice or a late payment reads as churn and then new revenue/);
});

test('the Lab ticks the checklist only when its founder holds this one venture', async () => {
  const f = await fixture();
  f.db.exec(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (${FOUNDER}, 4, 'ein_received', '2026-09-01')`);
  const item = async () => (await module_(f, 'durable-company-building')).body.parts.checklist.find((i: any) => i.key === 'ein_received');
  assert.deepEqual([(await item()).done, (await item()).source], [true, 'Spin-Out Lab']);
  f.db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (8, 'p8', 'Second venture', 10)`);
  assert.equal((await item()).done, false, 'two ventures: nothing says which one the milestone was for');
  f.db.exec(`UPDATE projects SET deleted_at = '2026-10-01' WHERE id = 8`);
  assert.equal((await item()).done, true, 'a deleted venture is not a second one');
});

test('a hiring plan labelled by quarter or half is drawn at its month', async () => {
  const f = await fixture();
  f.db.exec(`INSERT INTO company_people (uid, company_id, name, person_type, status, start_date, created_by) VALUES
    ('pa', 70, 'Ann', 'employee', 'active', '2025-01-01', ${FOUNDER}), ('pb', 70, 'Bob', 'employee', 'active', '2025-02-01', ${FOUNDER})`);
  // Last quarter's last month falls inside the card's six months.
  const ref = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 3, 1));
  const q = Math.floor(ref.getUTCMonth() / 3) + 1;
  const quarterEnd = `${ref.getUTCFullYear()}-${String(q * 3).padStart(2, '0')}`;
  f.db.exec(`INSERT INTO company_headcount_plan (uid, company_id, period_label, target_headcount, updated_by) VALUES ('hp', 70, 'Q${q} ${ref.getUTCFullYear()}', 4, ${FOUNDER})`);
  const card = await cardOf(f, 'team-expansion');
  assert.equal(card.series.plan[card.series.months.indexOf(quarterEnd)], 4, 'the quarter\'s target is drawn at its last month');
  assert.equal(card.series.plan.filter((v: any) => v != null).length, 1);
});
