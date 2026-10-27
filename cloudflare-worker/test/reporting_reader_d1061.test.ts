/**
 * D1061 (#2931, part 5 of #2427) — what the investor's company page reads
 * from the Worker, added for it:
 *
 *   · each period names the report that met it (`report_uid`), so the reader
 *     opens it; each duty names the holding's route (`holding.route`), never
 *     the closing line or a name;
 *   · `GET /api/reporting/companies/:projectUid/figures`: the frozen figures
 *     of each report the caller received, the latest revision of each chain,
 *     cut to the caller's own duties — and reading it records no open.
 *
 * The fixture is D1059's (real SQLite over the baseline and every later
 * migration; the report is drafted, readied and sent through the routes).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/reporting_reader_d1061.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import reporting from '../src/routes/reporting.ts';
import reportingReports from '../src/routes/reporting_reports.ts';
import portfolioUpdates from '../src/routes/portfolio_updates.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const MIGRATIONS = readdirSync(resolve(ROOT, 'cloudflare-worker/sql/migrations')).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  for (const f of MIGRATIONS) if (migrationNumber(f) > BASELINE_CUTOFF) db.exec(read(`cloudflare-worker/sql/migrations/${f}`));
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all() as any[]).map((r) => r.sql as string);
  db.close();
  return out;
})();
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-d1061';

const app = new Hono<any>();
app.route('/api/reporting', reporting);
app.route('/api/reporting', reportingReports);
app.route('/api/portfolio-updates', portfolioUpdates);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D1061'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const ADMIN = 1, FOUNDER = 3, STRANGER_FOUNDER = 4, INV_A = 6, INV_B = 7, INV_C = 8, COFOUNDER = 9, ADVISOR = 10;
const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 4: 'founder', 6: 'investor', 7: 'investor', 8: 'investor', 9: 'founder', 10: 'advisor' };
const TODAY = new Date().toISOString().slice(0, 10);
const Q = { label: '2026-Q3', start: '2026-07-01', end: '2026-09-30', due: '2026-11-14' };
const PERIOD_A = 'a'.repeat(32), PERIOD_B = 'b'.repeat(32), PERIOD_B2 = 'c'.repeat(32), PERIOD_C = 'd'.repeat(32);

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  DDL.forEach((s) => db.exec(s));
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test'), (32, 'Otis Other', 'otis@example.test');
    INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL, 1), (3, 'founder', 'Fay Founder', 'fay@example.test', 31, 1),
      (4, 'founder', 'Otis Other', 'otis@example.test', 32, 1), (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL, 1),
      (7, 'investor', 'Ben Beta', 'ben@example.test', NULL, 1), (8, 'investor', 'Cal Gamma', 'cal@example.test', NULL, 1),
      (9, 'founder', 'Cora Cofounder', 'cora@example.test', NULL, 1), (10, 'advisor', 'Avi Advisor', 'avi@example.test', NULL, 1);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (5, 'cp-five', 'Fixture Robotics');
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (7, 'proj-seven', 'Fixture Robotics', 31, 5), (8, 'proj-eight', 'Other Venture', 32, NULL);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, 9, 'cofounder', 'accepted'), (7, 10, 'advisor', 'accepted');
    INSERT INTO reporting_duties (id, uid, closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_days,
        source_document, source_clause, source_kind, starts_on) VALUES
      (1, 'duty-a', 1, 11, 'ln-a', 7, 6, 'quarterly_kpi', 'quarterly', 45, 'voting_rights', '§1.1(b)', 'closing_template', '2026-01-01'),
      (2, 'duty-b', 1, 12, 'ln-b', 7, 7, 'quarterly_kpi', 'quarterly', 45, 'voting_rights', '§1.1(b)', 'closing_template', '2026-01-01'),
      (3, 'duty-b2', 1, 12, 'ln-b', 7, 7, 'quarterly_update', 'quarterly', 45, 'term_sheet', 'deal pack', 'closing_template', '2026-01-01'),
      (4, 'duty-c', 1, 13, 'ln-c', 7, 8, 'monthly_financials', 'monthly', 30, 'voting_rights', '§1.1(a)', 'closing_template', '2026-01-01');
    INSERT INTO reporting_periods (id, uid, duty_id, period_label, period_start, period_end, due_on) VALUES
      (1, '${PERIOD_A}', 1, '${Q.label}', '${Q.start}', '${Q.end}', '${Q.due}'),
      (2, '${PERIOD_B}', 2, '${Q.label}', '${Q.start}', '${Q.end}', '${Q.due}'),
      (3, '${PERIOD_B2}', 3, '${Q.label}', '${Q.start}', '${Q.end}', '${Q.due}'),
      (4, '${PERIOD_C}', 4, '2026-09', '2026-09-01', '2026-09-30', '2026-10-30');
    -- Revenue and traction: Stripe MRR and customers, a typed cash balance, and burn only from Mercury (team only).
    INSERT INTO project_metrics (project_id, snapshot_date, source, mrr, paying_accounts) VALUES (7, '2026-06-30', 'stripe', 10000, 38);
    INSERT INTO project_metrics (project_id, snapshot_date, source, mrr, paying_accounts) VALUES (7, '2026-08-31', 'stripe', 11000, 41);
    INSERT INTO project_metrics (project_id, snapshot_date, source, mrr, paying_accounts, arr) VALUES (7, '2026-09-30', 'stripe', 12000, 44, 144000);
    INSERT INTO project_metrics (project_id, snapshot_date, source, cash_balance) VALUES (7, '2026-09-30', 'manual', 300000);
    INSERT INTO project_metrics (project_id, snapshot_date, source, net_burn) VALUES (7, '2026-09-30', 'mercury', 25000);
    -- Team expansion: three active employees, a contractor and a leaver; two open roles and a closed one.
    INSERT INTO company_people (uid, company_id, name, person_type, status, created_by) VALUES ('cp1', 5, 'P1', 'employee', 'active', 3), ('cp2', 5, 'P2', 'employee', 'active', 3),
      ('cp3', 5, 'P3', 'employee', 'active', 3), ('cp4', 5, 'P4', 'contractor', 'active', 3), ('cp5', 5, 'P5', 'employee', 'departed', 3);
    INSERT INTO job_postings (project_id, slug, title, status) VALUES (7, 'eng', 'Engineer', 'open'), (7, 'des', 'Designer', 'published'), (7, 'old', 'Old', 'closed');
    INSERT INTO growth_partners (uid, project_id, name, type, stage) VALUES ('gp1', 7, 'Partner One', 'reseller', 'signed'), ('gp2', 7, 'Partner Two', 'reseller', 'talking');
    INSERT INTO markets (uid, project_id, name, state) VALUES ('m1', 7, 'Lisbon', 'entering'), ('m2', 7, 'Berlin', 'considering');
    INSERT INTO durability_checklist (project_id, item_key, done_at) VALUES (7, 'a', '2026-08-01 10:00:00'), (7, 'b', NULL), (7, 'c', '2026-10-20 10:00:00');
  `);
  return db;
}

type Files = Map<string, { bytes: Uint8Array; contentType: string }>;
function makeEnv(db: DatabaseSync, files: Files = new Map()) {
  return {
    JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    FILES: {
      async put(key: string, bytes: Uint8Array, opts: any) { files.set(key, { bytes, contentType: opts?.httpMetadata?.contentType }); },
      async get(key: string) { const v = files.get(key); return v ? { body: v.bytes, size: v.bytes.length } : null; },
      async delete(key: string) { files.delete(key); },
    },
  } as any;
}
async function token(user: number, extra: Record<string, unknown> = {}) {
  return new SignJWT({ user_id: user, role: ROLE[user], ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(env: any, method: string, path: string, as: number, body?: unknown, claims: Record<string, unknown> = {}) {
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${await token(as, claims)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text, bytes: buf, headers: res.headers };
}
const all = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
const one = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).get() ?? null));
const fig = (list: any[], key: string) => list.find((f) => f.key === key);
/** The required figures the fixture cannot give, each left out with a reason, and the Mercury burn shared. */
const READY = [{ key: 'revenue', include: false, reason: 'Shared at the board meeting instead' }, { key: 'net_burn', share: true }, { key: 'runway', share: true }];

async function draft(env: any) {
  const r = await call(env, 'POST', `/api/reporting/periods/${PERIOD_A}/draft`, FOUNDER);
  assert.ok([200, 201].includes(r.status), r.text);
  return r.body;
}
async function ready(env: any, extra: Record<string, unknown> = {}) {
  const d = await draft(env);
  const r = await call(env, 'PUT', `/api/reporting/reports/${d.uid}`, FOUNDER, { figures: READY, ...extra });
  assert.equal(r.status, 200, r.text);
  return r.body;
}

async function sent(env: any) {
  const r = await ready(env);
  const s = await call(env, 'POST', `/api/reporting/reports/${r.uid}/send`, FOUNDER, { figures_sha256: r.figures_sha256 });
  assert.equal(s.status, 200, s.text);
  return r.uid as string;
}
function lines(db: DatabaseSync) {
  db.exec(`INSERT INTO closing_lines (uid, closing_id, commitment_id, investor_user_id, route, amount_cents, status, created_by) VALUES
    ('ln-a', 1, 101, 6, 'direct', 2500000, 'received', 1), ('ln-b', 1, 102, 7, 'syndicate', 4000000, 'received', 1)`);
}

test('the investor’s company read names each period’s report and the holding’s route, and nothing of the line', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    lines(db);
    const before = await call(env, 'GET', '/api/reporting/companies/proj-seven', INV_A);
    assert.equal(before.status, 200, before.text);
    assert.equal(before.body.company.periods[0].report_uid, null, 'not sent: no report');
    assert.deepEqual(before.body.company.duties[0].holding, { route: 'direct' });
    assert.ok(!('closing_line_uid' in before.body.company.duties[0]), 'never the closing line');
    const uid = await sent(env);
    const after = await call(env, 'GET', '/api/reporting/companies/proj-seven', INV_A);
    assert.equal(after.body.company.periods[0].report_uid, uid);
    assert.equal((await call(env, 'GET', '/api/reporting/companies/proj-seven', INV_B)).body.company.duties[0].holding.route, 'syndicate');
    const desk = await call(env, 'GET', '/api/reporting/desk?project=7', FOUNDER);
    assert.ok(desk.body.periods.some((p: any) => p.report_uid === uid), 'the desk names it too');
    assert.ok(!('holding' in desk.body.duties[0]), 'the founder’s view keeps its holder, not the investor’s holding');
    assert.doesNotMatch(JSON.stringify(after.body), /Ben Beta|Cal Gamma|ln-a|ln-b/, 'no other investor and no line');
  } finally { db.close(); }
});

test('the figures read: the frozen figures of each report received, cut to the caller’s duty, and it records no open', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    assert.equal((await call(env, 'GET', '/api/reporting/companies/proj-seven/figures', INV_A)).status, 404, 'before any report: none');
    const uid = await sent(env);
    // Ben's duty now names gross margin; Ivy's does not. Ivy never reads a figure only another holder's duty requires.
    db.exec(`UPDATE reporting_duties SET required_figures = '["gross_margin"]' WHERE uid = 'duty-b'`);
    assert.ok(fig((await call(env, 'GET', '/api/reporting/companies/proj-seven/figures', INV_B)).body.reports[0].figures, 'gross_margin'), 'Ben’s duty names it');
    const r = await call(env, 'GET', '/api/reporting/companies/proj-seven/figures', INV_A);
    assert.equal(fig(r.body.reports[0].figures, 'gross_margin'), undefined, 'cut to Ivy’s own duty');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.reports.length, 1);
    const rep = r.body.reports[0];
    assert.equal(rep.uid, uid);
    assert.deepEqual(rep.period, { label: '2026-Q3', start: '2026-07-01', end: '2026-09-30' });
    assert.equal(rep.corrected, false);
    // Reading the figures records no open; only the reader's read does.
    assert.equal(one(db, `SELECT opened_at FROM update_recipients WHERE user_id = ${INV_A}`).opened_at, null);
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'opened'`).n, 0);
    assert.equal(fig(rep.figures, 'mrr').value, 12000);
    assert.equal(fig(rep.figures, 'revenue').left_out, true);
    assert.equal(fig(rep.figures, 'revenue').value, null, 'left out: no value, never 0');
    const reader = await call(env, 'GET', `/api/reporting/reports/${uid}`, INV_A);
    assert.deepEqual(rep.figures, reader.body.figures, 'exactly the figures the reader shows');
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'opened'`).n, 1, 'the reader records the open');
    assert.equal((await call(env, 'GET', '/api/reporting/companies/proj-seven/figures', INV_C)).status, 404, 'Cal received no Q3 report');
    assert.equal((await call(env, 'GET', '/api/reporting/companies/proj-eight/figures', INV_A)).status, 404);
    assert.equal((await call(env, 'GET', '/api/reporting/companies/bad uid!/figures', INV_A)).status, 404);
  } finally { db.close(); }
});

test('the figures read keeps the latest revision of a corrected report, marked corrected', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const uid = await sent(env);
    const c = await call(env, 'POST', `/api/reporting/reports/${uid}/correct`, FOUNDER, { reason: 'The September MRR was restated' });
    assert.ok([200, 201].includes(c.status), c.text);
    const fix = await call(env, 'PUT', `/api/reporting/reports/${c.body.uid}`, FOUNDER, { figures: READY });
    const s = await call(env, 'POST', `/api/reporting/reports/${c.body.uid}/send`, FOUNDER, { figures_sha256: fix.body.figures_sha256 });
    assert.equal(s.status, 200, s.text);
    const r = await call(env, 'GET', '/api/reporting/companies/proj-seven/figures', INV_A);
    assert.deepEqual(r.body.reports.map((x: any) => [x.uid, x.revision, x.corrected]), [[c.body.uid, 2, true]]);
  } finally { db.close(); }
});
