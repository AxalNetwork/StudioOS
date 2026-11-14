/**
 * D6103 (#6103) — Grow's CSV exports: GET /api/cycles/grow/modules/:slug/export
 * for Product improvement (Feedback) and Revenue and traction (KPIs, monthly),
 * on real SQLite over the migrations the Grow read uses.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/grow_export_6103.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { csvSafe } from '../src/services/csv.ts';
import { FEEDBACK_HEADER, GROW_EXPORT_ROW_CAP, feedbackCsv, kpiCsv } from '../src/services/growExport.ts';
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

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, deleted_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, project_id INTEGER, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT, actor TEXT);`);
  const baseline = readFileSync(resolve(here, '../sql/schema_baseline.sql'), 'utf8');
  db.exec(tableFromBaseline(baseline, 'entities'));
  db.exec(tableFromBaseline(baseline, 'compliance_events'));
  for (const p of ['034', '119', '127', '132', '326']) db.exec(ddl(p));
  db.exec(file('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(ddl('125')); db.exec(file('437')); db.exec(file('202611091055'));
  db.exec(file('443'));
  db.exec(file('462'));
  db.exec(file('202611041912'));
  db.exec(file('507'));
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
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function get(f: { env: any }, who: number, path: string) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, { headers: { Authorization: `Bearer ${token}` } }), f.env, ctx as any);
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const exportOf = (f: any, slug: string, qs = '', who = FOUNDER) => get(f, who, `/api/cycles/grow/modules/${slug}/export?project=${PID}${qs}`);
const lines = (csv: string) => csv.split('\r\n');
const logs = (f: any) => f.db.prepare(`SELECT action, entity_type, entity_id, details, user_id FROM activity_logs WHERE action LIKE '%exported'`).all() as any[];

function feedback(f: any, body: string, extra: Record<string, unknown> = {}) {
  const row = { source: 'customer', status: 'open', from_name: null, from_email: null, theme: null, created_at: '2026-10-01 09:00:00', ...extra };
  f.db.prepare(`INSERT INTO product_feedback (uid, project_id, body, source, status, from_name, from_email, theme, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), PID, body, row.source, row.status, row.from_name, row.from_email, row.theme, row.created_at);
}

test('writers only: an advisor who reads the table, a stranger and a missing project cannot export', async () => {
  const f = await fixture();
  feedback(f, 'Make setup easier');
  assert.equal((await exportOf(f, 'product-improvement', '', ADVISOR)).status, 403, 'an advisor reads Grow but does not write it');
  assert.equal((await exportOf(f, 'product-improvement', '', STRANGER)).status, 403);
  assert.equal((await get(f, FOUNDER, '/api/cycles/grow/modules/product-improvement/export')).status, 400);
  const ok = await exportOf(f, 'product-improvement');
  assert.equal(ok.status, 200);
  assert.deepEqual(logs(f).length, 1, 'a refused export logs nothing; the writer\'s one is logged');
  // The module read says who may export, so the page draws Export only for them.
  const read = async (who: number, slug: string) => JSON.parse((await get(f, who, `/api/cycles/grow/modules/${slug}?project=${PID}`)).text).records.can_export;
  assert.equal(await read(FOUNDER, 'product-improvement'), true);
  assert.equal(await read(FOUNDER, 'revenue-and-traction'), true);
  assert.equal(await read(ADVISOR, 'product-improvement'), false, 'a reader is not offered it');
  assert.equal(await read(FOUNDER, 'distribution'), false, 'a module with no export is not offered it');
});

test('a module with no export is a 404, and so is a slug that is not a Grow module', async () => {
  const f = await fixture();
  const dist = await exportOf(f, 'distribution');
  assert.equal(dist.status, 404);
  assert.equal(JSON.parse(dist.text).detail, 'Distribution has no export');
  assert.equal((await exportOf(f, 'nope')).status, 404);
  assert.equal(logs(f).length, 0);
});

test('Feedback: an attachment with a safe name, the table\'s search and filter, the name for a writer, never an email', async () => {
  const f = await fixture();
  feedback(f, 'Make setup easier', { from_name: 'Aoife Brennan', from_email: 'aoife@cust.example', theme: 'Onboarding', created_at: '2026-10-02 09:00:00' });
  feedback(f, 'Dark mode please', { source: 'team', status: 'planned', from_name: 'Tom', from_email: 'tom@cust.example', created_at: '2026-10-03 09:00:00' });
  feedback(f, 'Setup took an hour', { status: 'shipped', created_at: '2026-10-01 09:00:00' });
  const r = await exportOf(f, 'product-improvement');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.match(r.headers.get('Content-Disposition')!, /^attachment; filename="feedback-7-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const all = lines(r.text);
  assert.deepEqual(all[0].split(','), [...FEEDBACK_HEADER, 'From']);
  assert.deepEqual(all.slice(1), [
    'Dark mode please,Team,,,Planned,2026-10-03,Tom',
    'Make setup easier,Customer,Onboarding,,Open,2026-10-02,Aoife Brennan',
    'Setup took an hour,Customer,,,Shipped,2026-10-01,',
  ], 'newest first, as the table sorts by default; a missing name or theme is an empty cell');
  assert.doesNotMatch(r.text, /@cust\.example|aoife@/i, 'from_email is never exported');
  // The table's own search and filter.
  const searched = lines((await exportOf(f, 'product-improvement', '&q=setup&filter=status:shipped')).text);
  assert.deepEqual(searched.slice(1), ['Setup took an hour,Customer,,,Shipped,2026-10-01,']);
  const oldest = lines((await exportOf(f, 'product-improvement', '&sort=created_at')).text);
  assert.match(oldest[1], /^Setup took an hour/);
  // Logged, with counts only: never the search text or a name.
  const l = logs(f);
  assert.equal(l.length, 3);
  assert.deepEqual([l[0].action, l[0].entity_type, l[0].entity_id, l[0].user_id], ['grow_feedback_exported', 'grow.product-improvement', null, FOUNDER]);
  assert.match(l[0].details, /Feedback exported as CSV: 3 rows/);
  assert.match(l[1].details, /: 1 row\b/);
  assert.doesNotMatch(JSON.stringify(l), /setup|Aoife/i);
});

test('the name column follows the read\'s writer rule, and the builder never writes an email', () => {
  const rows = [{ body: 'Hi', source: 'customer', status: 'open', from_name: 'Aoife', from_email: 'a@x.example', created_at: '2026-10-01 09:00:00' }];
  const label = (v: unknown) => v;
  const reader = feedbackCsv(rows, false, label);
  assert.deepEqual(lines(reader)[0].split(','), [...FEEDBACK_HEADER]);
  assert.doesNotMatch(reader, /Aoife/);
  const writer = feedbackCsv(rows, true, label);
  assert.match(writer, /Aoife/);
  assert.doesNotMatch(writer, /a@x\.example/);
});

test('a cell a person typed never runs as a formula; quotes, commas and newlines are escaped', async () => {
  const f = await fixture();
  feedback(f, '=HYPERLINK("http://evil.example","click")', { from_name: '@Mallory', created_at: '2026-10-05 09:00:00' });
  feedback(f, '+1, then\nanother line', { from_name: '-Dash', theme: '\tTabbed', created_at: '2026-10-04 09:00:00' });
  const r = await exportOf(f, 'product-improvement');
  assert.ok(r.text.includes(`"'=HYPERLINK(""http://evil.example"",""click"")",Customer,,,Open,2026-10-05,'@Mallory`), r.text);
  assert.ok(r.text.includes(`"'+1, then\nanother line",Customer,'\tTabbed,,Open,2026-10-04,'-Dash`), r.text);
  for (const [v, out] of [['-42', '-42'], ['-1.5', '-1.5'], ['12', '12'], ['-x', "'-x"], ['\rx', `"'\rx"`], ['a"b', '"a""b"'], [null, ''], [0, '0']] as const) {
    assert.equal(csvSafe(v), out, String(v));
  }
});

test('past the row cap the export is refused with a sentence, never cut short, and nothing is logged', async () => {
  const f = await fixture();
  const s = f.db.prepare(`INSERT INTO product_feedback (uid, project_id, body, source) VALUES (?, ?, ?, 'customer')`);
  f.db.exec('BEGIN');
  for (let i = 0; i <= GROW_EXPORT_ROW_CAP; i++) s.run(`u${i}`, PID, i % 2 ? 'odd one' : 'even one');
  f.db.exec('COMMIT');
  const r = await exportOf(f, 'product-improvement');
  assert.equal(r.status, 422);
  assert.equal(JSON.parse(r.text).detail, 'This export holds at most 5,000 rows and 5,001 feedback rows match. Narrow the search or a filter, then export again.');
  assert.equal(logs(f).length, 0);
  const narrowed = await exportOf(f, 'product-improvement', '&q=odd');
  assert.equal(narrowed.status, 200, 'the search narrows it under the cap');
  assert.equal(lines(narrowed.text).length - 1, Math.floor((GROW_EXPORT_ROW_CAP + 1) / 2));
});

test('KPIs: one row per KPI per month, the month\'s last value; money in cents with its currency; missing is empty, never 0', async () => {
  const f = await fixture();
  const s = f.db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (?, ?, ?, ?, ?)');
  s.run(PID, '2026-09-03', 30000, 70, 'manual');
  s.run(PID, '2026-09-20', 34000.5, null, 'manual');
  s.run(PID, '2026-10-12', 0, 0, 'manual');
  const r = await exportOf(f, 'revenue-and-traction');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Disposition')!, /^attachment; filename="kpis-7-\d{4}-\d{2}-\d{2}\.csv"$/);
  const all = lines(r.text);
  assert.equal(all[0], 'KPI,Key,Month,Value,Amount (cents),Currency,Unit,Note');
  const of = (key: string) => all.filter((l) => l.split(',')[1] === key);
  assert.deepEqual(of('mrr'), [
    'MRR,mrr,2026-10,,0,USD,cents,Last value held in this month',
    'MRR,mrr,2026-09,,3400050,USD,cents,Last value held in this month',
  ], 'September\'s last entry, not its first; a real 0 stays 0');
  assert.deepEqual(of('paying_accounts'), [
    'Customers,paying_accounts,2026-10,0,,,count,Last value held in this month',
    'Customers,paying_accounts,2026-09,70,,,count,Last value held in this month',
  ]);
  assert.deepEqual(of('net_burn'), ['Burn,net_burn,,,,,,Not recorded'], 'a KPI with nothing stored is one line of empty cells and its reason');
  assert.deepEqual(of('runway'), ['Runway,runway,,,,,,Not recorded: needs cash and burn']);
  // The table's filter applies: only the KPIs whose latest period is October.
  const oct = lines((await exportOf(f, 'revenue-and-traction', '&filter=period:2026-10')).text).slice(1);
  assert.deepEqual([...new Set(oct.map((l) => l.split(',')[1]))], ['mrr', 'paying_accounts']);
  const l = logs(f);
  assert.equal(l[0].action, 'grow_kpis_exported');
  assert.equal(l[0].entity_type, 'grow.revenue-and-traction');
  assert.match(l[0].details, /KPIs exported as CSV: \d+ rows/);
});

test('the KPI builder: a custom money KPI is cents, a reading with no history says so, a percent names its unit', () => {
  const base = { change_30d: null, source: 'manual', as_of: '2026-10-01', reason: null };
  const csv = kpiCsv([
    { row: { ...base, id: 'custom-a', kpi: 'ARPA', value: 1250, unit: 'usd_cents', period: '2026-10' }, months: [{ month: '2026-10', value: 1250 }] },
    { row: { ...base, id: 'posthog-b', kpi: 'Activation', value: 41.5, unit: 'pct', period: '2026-10' }, months: [] },
    { row: { ...base, id: 'custom-c', kpi: '=cmd', value: null, unit: null, period: null, reason: 'Not recorded: no value entered yet' }, months: [] },
    { row: { ...base, id: 'mrr', kpi: 'MRR', value: null, unit: 'usd', period: null, reason: 'Not recorded' }, months: [] },
  ]);
  assert.deepEqual(lines(csv).slice(1), [
    'ARPA,custom-a,2026-10,,1250,USD,cents,Last value held in this month',
    'Activation,posthog-b,2026-10,41.5,,,percent,Current reading; no monthly history is stored for this KPI',
    "'=cmd,custom-c,,,,,,Not recorded: no value entered yet",
    'MRR,mrr,,,,,,Not recorded',
  ], 'a money KPI with no value has no amount and no currency: empty, never 0');
});
