/**
 * D1059 (#2929, part 3 of #2427) — a report built from the Grow modules:
 *
 *   · REPORT_FIGURES: one key per figure, Share an update's five and
 *     migration 168's KPI rule keys mapped onto it, and the assembler held to
 *     it (every figure it returns is in the registry, from an allowed source);
 *   · assembleReport: each figure from its store with its source and as_of,
 *     nothing missing read as 0, a Mercury figure team only, one unreadable
 *     module saying so while the others answer;
 *   · the routes: the founders draft, choose, preview and send; send re-reads
 *     every sourced figure and refuses a drift or a stale digest, runs the
 *     privacy check, freezes, and marks each due period met; a correction is a
 *     new revision; the open is recorded once; statements are private and
 *     no-store; an admin reads only, and an investor reads only what they
 *     received and never another recipient.
 *
 * Real SQLite over the baseline and every later migration. `fetch` is stubbed
 * and counted; R2 is an in-memory map. Every name and figure is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/report_figures_d1059.test.ts
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
import { METRIC_KEYS } from '../src/services/updateShare.ts';
import { GROW_MODULES } from '../src/services/growCycle.ts';
import {
  KPI_RULES_REQUIRED, MODULE_ORDER, REPORT_FIGURES, applyChoices, assembleReport, figureFor, readerFigures, requiredFiguresOf,
} from '../src/services/reportFigures.ts';

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
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-d1059';

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
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D1059'); }) as any; });
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

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

test('REPORT_FIGURES: one key per figure, Share an update’s five and the KPI rules mapped onto it, every module a Grow module', () => {
  const names = REPORT_FIGURES.flatMap((f) => [f.key, ...f.aliases]);
  assert.equal(new Set(names).size, names.length, 'a key or alias is used twice');
  for (const k of METRIC_KEYS) assert.ok(figureFor(k), `Share an update's ${k} has no report figure`);
  assert.equal(figureFor('burn')!.key, 'net_burn');
  assert.equal(figureFor('runway_months')!.key, 'runway');
  // Migration 168's seed rows: every KPI key maps, and the required ones by cadence are KPI_RULES_REQUIRED.
  const seeds = [...read('cloudflare-worker/sql/migrations/168_portfolio_marks_distributions.sql')
    .matchAll(/\(NULL, '(\w+)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'(monthly|quarterly)',\s*([01]),/g)].map((m) => ({ key: m[1], cadence: m[2], required: m[3] === '1' }));
  assert.equal(seeds.length, 8);
  for (const s of seeds) assert.ok(figureFor(s.key), `KPI rule ${s.key} has no report figure`);
  for (const cadence of ['monthly', 'quarterly'] as const) {
    assert.deepEqual([...KPI_RULES_REQUIRED[cadence]].sort(), seeds.filter((s) => s.required && s.cadence === cadence).map((s) => s.key).sort(), cadence);
  }
  const slugs = new Set(GROW_MODULES.map((m: any) => m.slug));
  assert.deepEqual([...MODULE_ORDER], GROW_MODULES.map((m: any) => m.slug));
  for (const f of REPORT_FIGURES) assert.ok(slugs.has(f.module), `${f.key} names no Grow module`);
});

test('requiredFiguresOf: the signed paper’s figures win; a KPI duty takes the KPI rules; an update requires none', () => {
  assert.deepEqual(requiredFiguresOf({ kind: 'quarterly_kpi', required_figures: '["burn","mrr","nonsense"]' }), ['net_burn', 'mrr']);
  assert.deepEqual(requiredFiguresOf({ kind: 'monthly_financials', required_figures: '[]' }), ['cash_balance', 'net_burn', 'runway', 'revenue']);
  assert.deepEqual(requiredFiguresOf({ kind: 'quarterly_kpi', required_figures: '[]' }), ['cash_balance', 'net_burn', 'runway', 'revenue', 'arr', 'headcount']);
  assert.deepEqual(requiredFiguresOf({ kind: 'quarterly_update', required_figures: '[]' }), []);
  assert.deepEqual(requiredFiguresOf({ kind: 'annual_audited', required_figures: 'not json' }), []);
});

/* ------------------------------------------------------------------ *
 * The assembler
 * ------------------------------------------------------------------ */

test('assembleReport: each figure from its store, with its source and date; nothing missing is 0; Mercury is team only', async () => {
  const db = freshDb();
  try {
    const { figures, unreadable } = await assembleReport(makeEnv(db), 7, { start: Q.start, end: Q.end }, TODAY);
    assert.deepEqual(unreadable, []);
    // Held to the registry: every key once, in its order, each from a source it allows.
    assert.deepEqual(figures.map((f) => f.key), REPORT_FIGURES.map((f) => f.key));
    for (const f of figures) {
      const def = figureFor(f.key)!;
      assert.equal(f.unit, def.unit); assert.equal(f.module, def.module);
      if (f.value == null) { assert.equal(f.source, null); assert.ok(f.reason, `${f.key} is unrecorded without a reason`); }
      else assert.ok((def.sources as readonly string[]).includes(f.source!.provider), `${f.key} from ${f.source!.provider}`);
    }
    const v = (k: string) => fig(figures, k);
    assert.deepEqual([v('mrr').value, v('mrr').source, v('mrr').as_of], [12000, { word: 'Connector', provider: 'stripe', computed: false }, '2026-09-30']);
    assert.equal(v('customers').value, 44);
    assert.equal(v('arr').value, 144000);
    assert.deepEqual([v('growth').value, v('growth').source.computed], [20, true], 'growth against the last MRR before the period');
    assert.deepEqual([v('cash_balance').value, v('cash_balance').source.word], [300000, 'Typed']);
    assert.deepEqual([v('net_burn').value, v('net_burn').team_only], [25000, true]);
    assert.deepEqual([v('runway').value, v('runway').team_only, v('runway').source.computed], [12, true, true], 'computed from Mercury burn is team only');
    assert.deepEqual([v('headcount').value, v('headcount').source.word, v('headcount').as_of], [3, 'Recorded', TODAY], 'active employees on the roster');
    assert.equal(v('open_roles').value, 2);
    assert.equal(v('partners_signed').value, 1);
    assert.equal(v('markets_entering').value, 1);
    assert.equal(v('checklist_done').value, 1, 'an item done after the period is not counted');
    assert.equal(v('shipped_items').value, 0, 'a measured zero is a zero');
    for (const k of ['revenue', 'gross_margin', 'net_retention']) assert.equal(v(k).value, null, `${k} is not recorded, never 0`);
    assert.match(v('gross_margin').reason, /no Grow store records gross margin/);
    assert.equal(figures.filter((f) => f.team_only).map((f) => f.key).sort().join(), 'net_burn,runway');
  } finally { db.close(); }
});

test('assembleReport: an unreadable module says so; the other modules still answer', async () => {
  const db = freshDb();
  try {
    db.exec('DROP TABLE job_postings');
    const { figures, unreadable } = await assembleReport(makeEnv(db), 7, { start: Q.start, end: Q.end }, TODAY);
    assert.deepEqual(unreadable, ['team-expansion']);
    assert.match(fig(figures, 'open_roles').reason, /^Unreadable: Team expansion/);
    assert.equal(fig(figures, 'open_roles').value, null);
    assert.equal(fig(figures, 'mrr').value, 12000);
  } finally { db.close(); }
});

test('applyChoices and readerFigures: a team-only figure is out until shared, and never named to a reader unshared', () => {
  const base = [
    { key: 'mrr', label: 'MRR', module: 'revenue-and-traction', unit: 'usd', value: 5, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-09-30', reason: null, team_only: false },
    { key: 'net_burn', label: 'Net burn', module: 'revenue-and-traction', unit: 'usd', value: 9, source: { word: 'Connector', provider: 'mercury', computed: false }, as_of: '2026-09-30', reason: null, team_only: true },
  ] as any[];
  const out = applyChoices(base, [], [], false);
  assert.deepEqual(out.map((f) => [f.key, f.included]), [['mrr', true], ['net_burn', false]]);
  assert.throws(() => applyChoices(base, [{ key: 'net_burn', share: true }], [], false), /Only the venture.s founder/);
  const shared = applyChoices(base, [{ key: 'net_burn', share: true }], [], true);
  assert.deepEqual(fig(shared, 'net_burn'), { ...base[1], included: true, shared: true, typed: false, left_out_reason: null });
  const reader = readerFigures(out, new Set(['net_burn', 'mrr']));
  assert.deepEqual(reader.map((f) => f.key), ['mrr'], 'an unshared team-only figure is not even named');
  assert.equal(readerFigures(shared, new Set())[1].shared_from_mercury, true);
});

/* ------------------------------------------------------------------ *
 * The routes
 * ------------------------------------------------------------------ */

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

test('draft: the founders open the period’s report once; an admin, an advisor, an investor and a support session are refused', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const first = await call(env, 'POST', `/api/reporting/periods/${PERIOD_A}/draft`, FOUNDER);
    assert.equal(first.status, 201, first.text);
    assert.equal(first.body.status, 'draft');
    assert.equal(first.body.period.label, Q.label);
    assert.deepEqual(first.body.meets.map((m: any) => m.period_uid).sort(), [PERIOD_A, PERIOD_B, PERIOD_B2].sort(), 'every open period of the window, not the monthly one');
    assert.equal(fig(first.body.figures, 'net_burn').included, false, 'a team-only figure starts left out');
    assert.equal(fig(first.body.figures, 'net_burn').value, 25000, 'the venture’s founder sees their Mercury figure');
    const again = await call(env, 'POST', `/api/reporting/periods/${PERIOD_B}/draft`, COFOUNDER);
    assert.equal(again.status, 200, again.text);
    assert.equal(again.body.uid, first.body.uid, 'the same window opens the same draft');
    assert.equal(fig(again.body.figures, 'net_burn').value, null, 'a co-founder outside the company link sees no Mercury figure');
    assert.equal(fig(again.body.figures, 'net_burn').reason.startsWith('From the founder'), true);
    assert.equal((await call(env, 'POST', `/api/reporting/periods/${PERIOD_A}/draft`, ADMIN)).status, 403);
    for (const who of [ADVISOR, INV_A, STRANGER_FOUNDER]) assert.equal((await call(env, 'POST', `/api/reporting/periods/${PERIOD_A}/draft`, who)).status, who === ADVISOR ? 403 : 404, `user ${who}`);
    const support = await call(env, 'POST', `/api/reporting/periods/${PERIOD_A}/draft`, FOUNDER, undefined, { impersonated_by: ADMIN });
    assert.equal(support.status, 403); assert.equal(support.body.error, 'support_session_refused');
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM portfolio_updates WHERE kind = 'report'").n, 1);
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'draft_built'").n, 1);
    // Share an update's own routes never touch a report row.
    for (const [m, p] of [['PUT', ''], ['POST', '/submit'], ['PUT', '/share'], ['POST', '/send']]) {
      const r = await call(env, m, `/api/portfolio-updates/${first.body.uid}${p}`, FOUNDER, {});
      assert.equal(r.status, 409, `${m} ${p}`); assert.equal(r.body.code, 'report_row');
    }
  } finally { db.close(); }
});

test('choices: only the venture’s founder shares a Mercury figure; a typed figure is the company’s own; bad input is refused', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const d = await draft(env);
    const co = await call(env, 'PUT', `/api/reporting/reports/${d.uid}`, COFOUNDER, { figures: [{ key: 'net_burn', share: true }] });
    assert.equal(co.status, 400); assert.match(co.body.detail, /Only the venture.s founder/);
    const admin = await call(env, 'PUT', `/api/reporting/reports/${d.uid}`, ADMIN, { title: 'x' });
    assert.equal(admin.status, 403);
    const ok = await call(env, 'PUT', `/api/reporting/reports/${d.uid}`, FOUNDER, {
      figures: [{ key: 'burn', share: true }, { key: 'customers', include: false }],
      typed: [{ label: 'Pilots signed', value: 3, unit: 'count', as_of: '2026-09-30' }],
      highlights: [{ text: 'MRR grew', source: { label: 'Connector · Stripe' } }],
    });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual([fig(ok.body.figures, 'net_burn').included, fig(ok.body.figures, 'net_burn').shared], [true, true], 'the alias reaches its figure');
    assert.equal(fig(ok.body.figures, 'customers').included, false);
    assert.deepEqual([fig(ok.body.figures, 'typed-1').source.word, fig(ok.body.figures, 'typed-1').included], ['Typed', true]);
    assert.equal(all(db, "SELECT ref FROM reporting_events WHERE event = 'mercury_figure_shared'").map((x: any) => x.ref.split(':').at(-1)).join(), 'net_burn');
    assert.ok(!JSON.stringify(all(db, 'SELECT * FROM reporting_events')).includes('25000'), 'an event never holds a figure');
    for (const [b, code] of [[{ figures: [{ key: 'nope' }] }, 'invalid_figures'], [{ typed: [{ label: 'x', value: 'a', unit: 'count', as_of: '2026-09-30' }] }, 'invalid_figures'],
      [{ highlights: [{ text: 'no source' }] }, 'invalid_lines'], [{ correction_reason: 'not yet' }, 'not_a_correction'], [{ title: '' }, 'invalid_title']] as const) {
      const r = await call(env, 'PUT', `/api/reporting/reports/${d.uid}`, FOUNDER, b);
      assert.equal(r.status, 400, JSON.stringify(b)); assert.equal(r.body.error, code);
    }
  } finally { db.close(); }
});

test('preview: as an investor it never names an unshared team-only figure; it says when Send would refuse', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const d = await draft(env);
    const inv = await call(env, 'GET', `/api/reporting/reports/${d.uid}/preview?as=investor`, FOUNDER);
    assert.equal(inv.status, 200, inv.text);
    assert.equal(fig(inv.body.figures, 'net_burn'), undefined);
    assert.equal(fig(inv.body.figures, 'revenue').left_out, true, 'a required figure left out shows, with its reason');
    assert.equal(inv.body.stale, false);
    const team = await call(env, 'GET', `/api/reporting/reports/${d.uid}/preview?as=team`, FOUNDER);
    assert.equal(fig(team.body.figures, 'net_burn').value, 25000);
    db.exec(`UPDATE project_metrics SET mrr = 99999 WHERE project_id = 7 AND snapshot_date = '2026-09-30' AND source = 'stripe'`);
    const stale = await call(env, 'GET', `/api/reporting/reports/${d.uid}/preview?as=investor`, FOUNDER);
    assert.equal(stale.body.stale, true);
    assert.equal((await call(env, 'GET', `/api/reporting/reports/${d.uid}/preview?as=board`, FOUNDER)).status, 400);
    assert.equal((await call(env, 'GET', `/api/reporting/reports/${d.uid}/preview`, INV_A)).status, 404);
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'preview_opened'").n, 3);
  } finally { db.close(); }
});

test('send: a stale digest, a drifted figure, a missing reason and private details are refused; nothing is written', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const d = await draft(env);
    const noReason = await call(env, 'POST', `/api/reporting/reports/${d.uid}/send`, FOUNDER, { figures_sha256: d.figures_sha256 });
    assert.equal(noReason.status, 400); assert.equal(noReason.body.error, 'reason_required');
    assert.deepEqual(noReason.body.figures.sort(), ['net_burn', 'revenue', 'runway'], 'each required figure left out without a reason');
    const r = await ready(env);
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${d.uid}/send`, FOUNDER, { figures_sha256: d.figures_sha256 })).body.error, 'content_changed',
      'the digest read before the last save');
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${d.uid}/send`, FOUNDER, {})).body.error, 'content_changed');
    db.exec(`UPDATE project_metrics SET mrr = 12500 WHERE project_id = 7 AND snapshot_date = '2026-09-30' AND source = 'stripe'`);
    const drift = await call(env, 'POST', `/api/reporting/reports/${d.uid}/send`, FOUNDER, { figures_sha256: r.figures_sha256 });
    assert.equal(drift.status, 409); assert.equal(drift.body.error, 'figures_changed');
    db.exec(`UPDATE project_metrics SET mrr = 12000 WHERE project_id = 7 AND snapshot_date = '2026-09-30' AND source = 'stripe'`);
    const pii = await call(env, 'PUT', `/api/reporting/reports/${d.uid}`, FOUNDER, { body: 'Questions to ceo.private@example.test' });
    const leak = await call(env, 'POST', `/api/reporting/reports/${d.uid}/send`, FOUNDER, { figures_sha256: pii.body.figures_sha256 });
    assert.equal(leak.status, 422); assert.equal(leak.body.error, 'pii_found');
    assert.deepEqual(leak.body.findings, [{ kind: 'email', in: 'body' }]);
    assert.ok(!leak.text.includes('ceo.private'), 'the refusal never repeats what it caught');
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${d.uid}/send`, COFOUNDER, { figures_sha256: pii.body.figures_sha256 }, { impersonated_by: ADMIN })).status, 403);
    assert.equal(one(db, `SELECT sent_at FROM portfolio_updates WHERE uid = '${d.uid}'`).sent_at, null);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM update_recipients').n, 0);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM reporting_periods WHERE met_update_id IS NOT NULL').n, 0);
  } finally { db.close(); }
});

test('send: freezes the figures, meets every due period of the window, reaches the holders and the team, and is told once', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    db.exec(`UPDATE reporting_periods SET waived_at = datetime('now') WHERE uid = '${PERIOD_B2}'`);
    const r = await ready(env);
    const sent = await call(env, 'POST', `/api/reporting/reports/${r.uid}/send`, COFOUNDER, { figures_sha256: r.figures_sha256 });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.body.recipients, 3, 'Ivy, Ben and the founder: never the advisor, Cal or the sender');
    assert.deepEqual(all(db, 'SELECT user_id, audience FROM update_recipients ORDER BY user_id'),
      [{ user_id: FOUNDER, audience: 'team' }, { user_id: INV_A, audience: 'investor' }, { user_id: INV_B, audience: 'investor' }]);
    const row = one(db, `SELECT id, status, sent_at, figures_json, figures_sha256 FROM portfolio_updates WHERE uid = '${r.uid}'`);
    assert.equal(row.figures_sha256, r.figures_sha256);
    assert.deepEqual(all(db, 'SELECT uid, met_update_id FROM reporting_periods ORDER BY id').map((p: any) => [p.uid, p.met_update_id]),
      [[PERIOD_A, row.id], [PERIOD_B, row.id], [PERIOD_B2, null], [PERIOD_C, null]], 'a waived period and another window are not met');
    assert.deepEqual(sent.body.meets.find((m: any) => m.period_uid === PERIOD_A).without, [{ key: 'revenue', label: 'Revenue', reason: 'Shared at the board meeting instead' }]);
    const events = all(db, `SELECT event, period_id, ref FROM reporting_events WHERE event IN ('sent', 'figure_left_out') ORDER BY id`);
    assert.deepEqual(events.filter((e: any) => e.event === 'sent').map((e: any) => e.period_id), [1, 2]);
    assert.ok(events[0].ref.includes(`sha256:${r.figures_sha256.slice(0, 16)}`));
    assert.deepEqual(events.filter((e: any) => e.event === 'figure_left_out').map((e: any) => e.ref), ['revenue: Shared at the board meeting instead']);
    // Frozen: the trigger refuses an edit, and the routes refuse a second send or change.
    assert.throws(() => db.exec(`UPDATE portfolio_updates SET figures_json = '[]' WHERE id = ${row.id}`), /frozen/);
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${r.uid}/send`, FOUNDER, { figures_sha256: r.figures_sha256 })).status, 409);
    assert.equal((await call(env, 'PUT', `/api/reporting/reports/${r.uid}`, FOUNDER, { title: 'Later' })).status, 409);
    // The desk reads both periods as sent.
    const desk = await call(env, 'GET', '/api/reporting/desk?project=7', FOUNDER);
    assert.deepEqual(desk.body.periods.filter((p: any) => p.label === Q.label).map((p: any) => p.state).sort(), ['sent', 'sent', 'waived']);
  } finally { db.close(); }
});

test('send: a period waived while the report is sent is not met by it, and the answer says so', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const r = await ready(env);
    // The investor waives between the founders' read and the send's batch.
    const batch = env.DB.batch.bind(env.DB);
    env.DB = { ...env.DB, batch: async (stmts: any[]) => { db.exec(`UPDATE reporting_periods SET waived_at = datetime('now') WHERE uid = '${PERIOD_B}'`); return batch(stmts); } };
    const sent = await call(env, 'POST', `/api/reporting/reports/${r.uid}/send`, FOUNDER, { figures_sha256: r.figures_sha256 });
    assert.equal(sent.status, 200, sent.text);
    assert.deepEqual(sent.body.not_met, [{ period_uid: PERIOD_B, label: Q.label }]);
    assert.equal(one(db, `SELECT met_update_id FROM reporting_periods WHERE uid = '${PERIOD_B}'`).met_update_id, null);
    assert.ok(one(db, `SELECT met_update_id FROM reporting_periods WHERE uid = '${PERIOD_A}'`).met_update_id);
  } finally { db.close(); }
});

test('read: a recipient reads only their own report, its open recorded once; nobody else’s name; an admin and an advisor read only', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const r = await ready(env);
    await call(env, 'POST', `/api/reporting/reports/${r.uid}/send`, FOUNDER, { figures_sha256: r.figures_sha256 });
    const a = await call(env, 'GET', `/api/reporting/reports/${r.uid}`, INV_A);
    assert.equal(a.status, 200, a.text);
    assert.equal(a.body.view, 'reader');
    assert.deepEqual(a.body.meets.map((m: any) => m.period_uid), [PERIOD_A], 'only their own duty');
    for (const name of ['Ben Beta', 'Cal Gamma', 'Fay Founder', 'ben@example.test', 'recipients']) assert.ok(!a.text.includes(name), name);
    assert.equal(fig(a.body.figures, 'net_burn').value, 25000);
    assert.equal(fig(a.body.figures, 'net_burn').shared_from_mercury, true);
    assert.deepEqual([fig(a.body.figures, 'revenue').left_out, fig(a.body.figures, 'revenue').left_out_reason], [true, 'Shared at the board meeting instead']);
    await call(env, 'GET', `/api/reporting/reports/${r.uid}`, INV_A);
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'opened'`).n, 1, 'the open is recorded once');
    assert.ok(one(db, `SELECT opened_at FROM update_recipients WHERE user_id = ${INV_A}`).opened_at);
    assert.equal(one(db, `SELECT opened_at FROM update_recipients WHERE user_id = ${INV_B}`).opened_at, null);
    assert.equal((await call(env, 'GET', `/api/reporting/reports/${r.uid}`, INV_C)).status, 404, 'an investor who did not receive it');
    assert.equal((await call(env, 'GET', `/api/reporting/reports/${r.uid}`, STRANGER_FOUNDER)).status, 404);
    for (const who of [ADMIN, ADVISOR]) {
      const ro = await call(env, 'GET', `/api/reporting/reports/${r.uid}`, who);
      assert.equal(ro.status, 200, `user ${who}`); assert.equal(ro.body.read_only, true); assert.equal(ro.body.recipients, undefined);
    }
    const team = await call(env, 'GET', `/api/reporting/reports/${r.uid}`, FOUNDER);
    assert.deepEqual(team.body.recipients.map((x: any) => [x.name, x.audience]).sort(), [['Ben Beta', 'investor'], ['Cora Cofounder', 'team'], ['Ivy Alpha', 'investor']]);
    assert.equal(team.headers.get('Cache-Control'), 'private, no-store');
  } finally { db.close(); }
});

test('correct: a new revision with its reason; once per revision; its send tells everyone the last one reached', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const r = await ready(env);
    // The co-founder sends; the founder, a team recipient of that send, corrects it and is never their own recipient.
    const first = await call(env, 'POST', `/api/reporting/reports/${r.uid}/send`, COFOUNDER, { figures_sha256: r.figures_sha256 });
    assert.equal(first.status, 200, first.text);
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${r.uid}/correct`, FOUNDER, { reason: 'x' })).status, 400);
    const rev = await call(env, 'POST', `/api/reporting/reports/${r.uid}/correct`, FOUNDER, { reason: 'Stripe refund' });
    assert.equal(rev.status, 201, rev.text);
    assert.deepEqual([rev.body.revision, rev.body.status, rev.body.correction_reason], [2, 'draft', 'Stripe refund']);
    assert.equal(fig(rev.body.figures, 'net_burn').shared, true, 'the choices carry over');
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${r.uid}/correct`, FOUNDER, { reason: 'Again' })).body.error, 'already_corrected');
    db.exec(`UPDATE project_metrics SET paying_accounts = 43 WHERE project_id = 7 AND snapshot_date = '2026-09-30' AND source = 'stripe'`);
    const saved = await call(env, 'PUT', `/api/reporting/reports/${rev.body.uid}`, FOUNDER, {});
    assert.equal(fig(saved.body.figures, 'customers').value, 43);
    const sent = await call(env, 'POST', `/api/reporting/reports/${rev.body.uid}/send`, FOUNDER, { figures_sha256: saved.body.figures_sha256 });
    assert.equal(sent.status, 200, sent.text);
    const revId = one(db, `SELECT id FROM portfolio_updates WHERE uid = '${rev.body.uid}'`).id;
    assert.deepEqual(all(db, `SELECT user_id FROM update_recipients WHERE update_id = ${revId} ORDER BY user_id`).map((x: any) => x.user_id), [INV_A, INV_B, COFOUNDER]);
    const firstId = one(db, `SELECT id FROM portfolio_updates WHERE uid = '${r.uid}'`).id;
    assert.deepEqual(all(db, `SELECT DISTINCT met_update_id AS m FROM reporting_periods WHERE period_label = '${Q.label}' AND met_update_id IS NOT NULL`).map((x: any) => x.m), [firstId],
      'periods stay met by the first revision');
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'corrected'`).n, 3);
    const old = await call(env, 'GET', `/api/reporting/reports/${r.uid}`, INV_B);
    assert.deepEqual([old.body.corrected_by.revision, old.body.corrected_by.reason], [2, 'Stripe refund']);
    assert.equal(fig(old.body.figures, 'customers').value, 44, 'the old revision keeps its frozen figures');
    const now = await call(env, 'GET', `/api/reporting/reports/${rev.body.uid}`, INV_B);
    assert.equal(fig(now.body.figures, 'customers').value, 43);
    assert.deepEqual(now.body.meets.map((m: any) => m.period_uid).sort(), [PERIOD_B, PERIOD_B2].sort());
  } finally { db.close(); }
});

test('documents: a PDF on a draft, private R2, served no-store to the founders and, once sent, to its recipients only', async () => {
  const db = freshDb(); const files: Files = new Map(); const env = makeEnv(db, files);
  try {
    const r = await ready(env);
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 fixture statement').toString('base64')}`;
    const up = await call(env, 'POST', `/api/reporting/reports/${r.uid}/documents`, FOUNDER, { filename: 'Q3 statements.pdf', label: 'Unaudited statements', data: pdf });
    assert.equal(up.status, 201, up.text);
    const key = [...files.keys()][0];
    assert.match(key, new RegExp(`^reports/proj-seven/${r.uid}/[0-9a-f]{32}\\.pdf$`));
    assert.ok(!up.text.includes(key), 'the storage key never leaves the Worker');
    for (const [b, status] of [[{ filename: 'x.pdf', data: `data:application/pdf;base64,${Buffer.from('not a pdf').toString('base64')}` }, 400],
      [{ filename: 'x.pdf', data: 'data:text/plain;base64,AAAA' }, 400],
      [{ filename: 'x.pdf', data: `data:application/pdf;base64,${'A'.repeat(9 * 1024 * 1024)}` }, 413]] as const) {
      assert.equal((await call(env, 'POST', `/api/reporting/reports/${r.uid}/documents`, FOUNDER, b)).status, status);
    }
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${r.uid}/documents`, ADMIN, { filename: 'x.pdf', data: pdf })).status, 403);
    const doc = up.body.document.uid;
    for (const who of [INV_A, ADMIN, ADVISOR]) assert.equal((await call(env, 'GET', `/api/reporting/documents/${doc}`, who)).status, 404, `a draft’s statement is the founders’ only (${who})`);
    const own = await call(env, 'GET', `/api/reporting/documents/${doc}`, FOUNDER);
    assert.equal(own.status, 200);
    await call(env, 'POST', `/api/reporting/reports/${r.uid}/send`, FOUNDER, { figures_sha256: r.figures_sha256 });
    const got = await call(env, 'GET', `/api/reporting/documents/${doc}`, INV_A);
    assert.equal(got.status, 200);
    assert.equal(new TextDecoder().decode(got.bytes), '%PDF-1.4 fixture statement');
    assert.equal(got.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(got.headers.get('Content-Type'), 'application/pdf');
    assert.match(got.headers.get('Content-Disposition') || '', /^attachment; filename="Q3 statements.pdf"$/);
    assert.equal(got.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal((await call(env, 'GET', `/api/reporting/documents/${doc}`, INV_C)).status, 404);
    assert.equal((await call(env, 'GET', `/api/reporting/documents/${doc}`, ADMIN)).status, 200);
    assert.equal((await call(env, 'POST', `/api/reporting/reports/${r.uid}/documents`, FOUNDER, { filename: 'late.pdf', data: pdf })).status, 409);
    const sentReport = await call(env, 'GET', `/api/reporting/reports/${r.uid}`, INV_A);
    assert.deepEqual(sentReport.body.documents.map((d: any) => [d.filename, d.label]), [['Q3 statements.pdf', 'Unaudited statements']]);
  } finally { db.close(); }
});

test('wiring: mounted on /api/reporting, every statement bound, the client spells each route', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /app\.route\('\/api\/reporting', reportingReports\);/);
  const src = read('cloudflare-worker/src/routes/reporting_reports.ts') + read('cloudflare-worker/src/services/reportFigures.ts');
  assert.ok(!/prepare\(`[^`]*\$\{/.test(src), 'no interpolated SQL');
  const client = read('frontend/src/lib/api/reporting.js');
  for (const p of ['/draft', '/preview?as=', '/send', '/correct', '/documents', '/reporting/reports/', '/api/reporting/documents/']) assert.ok(client.includes(p), p);
});
