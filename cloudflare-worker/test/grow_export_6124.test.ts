/**
 * D6124 (#6124) — GET /api/cycles/grow/modules/:slug/export: a writer's CSV of
 * a Grow table's filtered rows (every page), with its source and date; a
 * reader is refused, a module without an export is not found, and no applicant
 * name reaches the file. Same SQLite fixture as cycle_grow_d664.test.ts.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/grow_export_6124.test.ts
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
import revenue from '../src/routes/revenue.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { GROW_EXPORT_SLUGS, growExportCsv, text, wordOf } from '../src/services/growExport.ts';
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
const module_ = (f: any, who: number, slug: string) => call(f, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}`);

async function download(f: { env: any }, who: number, slug: string, qs = '') {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/cycles/grow/modules/${slug}/export?project=${PID}${qs}`, {
    headers: { Authorization: `Bearer ${token}` } }), f.env, ctx as any);
  return { status: res.status, type: res.headers.get('Content-Type'), disposition: res.headers.get('Content-Disposition'),
    rows: res.headers.get('X-Export-Rows'), text: await res.text() };
}
const lines = (text: string) => text.split('\r\n');
const TODAY = new Date().toISOString().slice(0, 10);

function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO growth_partners (uid, project_id, name, type, stage, terms) VALUES
    ('gp1', ${PID}, 'Acme, Inc.', 'reseller', 'signed', NULL), ('gp2', ${PID}, 'Beta', 'integration', 'talking', NULL)`);
  db.exec(`INSERT INTO markets (uid, project_id, name, state) VALUES ('m1', ${PID}, 'Spain', 'not_now')`);
  db.exec(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title, status) VALUES (5, 'eng', ${FOUNDER}, ${PID}, 'Engineer', 'published')`);
  db.exec(`INSERT INTO job_applications (posting_id, name, email) VALUES (5, 'Applicant Zed', 'zed@applicant.example')`);
}

test('D6124: four modules export, by their own slugs', () => {
  assert.deepEqual([...GROW_EXPORT_SLUGS], ['team-expansion', 'partner-network', 'market-expansion', 'durable-company-building']);
  assert.deepEqual(['not_set_up', 'signed', null, ''].map(wordOf), ['Not set up', 'Signed', null, null]);
});

test('D6124: a typed cell a spreadsheet would run as a formula is neutralised', () => {
  assert.deepEqual(['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', '\tx', '-12.5', 'Acme'].map(text),
    ["'=HYPERLINK(\"x\")", "'+1", '-2', "'@SUM(A1)", "'\tx", '-12.5', 'Acme']);
  assert.match(growExportCsv('durable-company-building', [{ title: '=cmd()', owner_name: '@me' }], 'Obligations', '2026-11-14'), /^'=cmd\(\),,,'@me,/m);
});

test('D6124: a missing value is an empty cell, never 0; money is in dollars', () => {
  const csv = growExportCsv('partner-network', [{ name: 'A', type: 'other', stage: 'terms', terms: null, revenue_cents: null },
    { name: 'B', type: 'agency', stage: 'ended', terms: '10% of revenue', revenue_cents: 123450 }], 'Partners', '2026-11-14');
  assert.deepEqual(lines(csv), ['Partner,Type,Stage,Terms,Revenue sourced (USD),Source,As of',
    'A,Other,Terms,,,Partners,2026-11-14', 'B,Agency,Ended,10% of revenue,1234.50,Partners,2026-11-14']);
  const roles = growExportCsv('team-expansion', [{ title: 'Eng', team: null, applicants: 0, in_interview: 0, target_start: null }], 'Roles', '2026-11-14');
  assert.equal(lines(roles)[1], 'Eng,,0,0,,Roles,2026-11-14', 'a counted zero is 0; an unset team or start is empty');
  assert.equal(lines(growExportCsv('team-expansion', [{ title: 'Ops', applicants: null, in_interview: undefined }], 'Roles', '2026-11-14'))[1],
    'Ops,,,,,Roles,2026-11-14', 'a count nobody read is empty, not 0');
});

test('D6124: a writer downloads every filtered row with the table\'s columns, its source and the date', async () => {
  const f = await fixture(); seed(f.db);
  const all = await download(f, FOUNDER, 'partner-network');
  assert.equal(all.status, 200);
  assert.equal(all.type, 'text/csv; charset=utf-8');
  assert.equal(all.disposition, `attachment; filename="partner-network-${PID}-${TODAY}.csv"`);
  assert.deepEqual(lines(all.text), ['Partner,Type,Stage,Terms,Revenue sourced (USD),Source,As of',
    `"Acme, Inc.",Reseller,Signed,,,Partners and partner-sourced revenue,${TODAY}`,
    `Beta,Integration,Talking,,,Partners and partner-sourced revenue,${TODAY}`]);
  assert.equal(all.rows, '2');
  const signed = await download(f, FOUNDER, 'partner-network', '&filter=stage:signed');
  assert.deepEqual([signed.rows, lines(signed.text).length], ['1', 2]);
  const searched = await download(f, FOUNDER, 'partner-network', '&q=beta&sort=-name');
  assert.match(lines(searched.text)[1], /^Beta,/);
  assert.equal(lines((await download(f, FOUNDER, 'market-expansion')).text)[1], `Spain,Not now,,Demand,,,Markets,${TODAY}`);
});

test('D6124: every page goes into the file, not the first one', async () => {
  const f = await fixture();
  const ins = f.db.prepare(`INSERT INTO growth_partners (uid, project_id, name, type) VALUES (?, ${PID}, ?, 'other')`);
  for (let i = 0; i < 130; i += 1) ins.run(`p${i}`, `Partner ${String(i).padStart(3, '0')}`);
  const out = await download(f, FOUNDER, 'partner-network');
  assert.deepEqual([out.rows, lines(out.text).length], ['130', 131]);
});

test('D6124: no applicant\'s name or address reaches a roles export', async () => {
  const f = await fixture(); seed(f.db);
  const out = await download(f, FOUNDER, 'team-expansion');
  assert.deepEqual(lines(out.text), ['Role,Team,Applicants,In interview,Target start,Source,As of',
    `Engineer,,1,0,,"Team roster, hiring plan and open roles",${TODAY}`]);
  assert.doesNotMatch(out.text, /Zed|applicant\.example/);
});

test('D6124: a reader and a stranger are refused; a module without an export is not found; the read says who may', async () => {
  const f = await fixture(); seed(f.db);
  const reader = await download(f, ADVISOR, 'partner-network');
  assert.equal(reader.status, 403);
  assert.doesNotMatch(reader.text, /Acme/);
  assert.equal((await download(f, STRANGER, 'partner-network')).status, 403);
  for (const slug of ['distribution', 'product-improvement', 'revenue-and-traction', 'nope']) {
    assert.equal((await download(f, FOUNDER, slug)).status, 404, slug);
  }
  assert.equal((await module_(f, FOUNDER, 'partner-network')).body.records.exportable, true);
  assert.equal((await module_(f, ADVISOR, 'partner-network')).body.records.exportable, undefined, 'a reader is not offered Export');
  assert.equal((await module_(f, FOUNDER, 'distribution')).body.records.exportable, undefined, 'a module without an export');
});

test('D6124: a failed read is refused with its source, never an empty file', async () => {
  const f = await fixture();
  f.db.exec('DROP TABLE growth_partners');
  const out = await download(f, FOUNDER, 'partner-network');
  assert.equal(out.status, 503);
  assert.match(JSON.parse(out.text).detail, /^Unreadable: Partners and partner-sourced revenue could not be read/);
});
